import { withStackCount } from '@/data/items/bag';
import { ResourceType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { useInventoryStore, selectWards } from '@/stores/inventoryStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { usePartyStore } from '@/stores/partyStore';
import { useGameStore } from '@/stores/gameStore';
import { generateMap } from '@/systems/world/mapGenerator';
import { lightWard, wardHoursLeft } from '@/systems/world/ward';
import { captureSave } from '@/systems/save/persistence';
import { isLoadable } from '@/systems/save/saveFormat';

/**
 * Warding incense (playtest 2026-10-14: "a new item which lowers the chance of
 * encounter for a week"), a bag entry beside the town portal and rations.
 */
const SEED = 20261014;

beforeEach(() => {
  useInventoryStore.getState().reset();
  useWorldMapStore.getState().reset();
  usePartyStore.getState().reset();
  useGameStore.getState().newGame(SEED);
  useWorldMapStore.getState().setTiles(generateMap(SEED), SEED);
  jest.restoreAllMocks();
});

it('is bought at its price, up to the pack\'s limit', () => {
  const bag = useInventoryStore.getState();
  bag.addResource(ResourceType.Gold, 1000);
  const gold = useInventoryStore.getState().resources.gold;
  for (let i = 0; i < BALANCE.WARD_CARRY; i++) expect(useInventoryStore.getState().buyWard()).toBe(true);
  expect(useInventoryStore.getState().buyWard()).toBe(false);
  expect(selectWards(useInventoryStore.getState())).toBe(BALANCE.WARD_CARRY);
  expect(useInventoryStore.getState().resources.gold).toBe(gold - BALANCE.WARD_CARRY * BALANCE.WARD_GOLD);
});

it('burns for seven days from the hour it is lit, and needs one in the pack', () => {
  expect(lightWard()).toBe(false);
  useInventoryStore.setState((s) => ({ bag: withStackCount(s.bag, { kind: 'incense' }, 1) }));
  const now = useCalendarStore.getState().totalHours;
  expect(lightWard()).toBe(true);
  expect(selectWards(useInventoryStore.getState())).toBe(0);
  expect(useWorldMapStore.getState().wardUntil).toBe(now + BALANCE.WARD_HOURS);
  expect(wardHoursLeft()).toBe(BALANCE.WARD_HOURS);
});

it('thins today\'s live encounters at once and halves each day\'s roll while it burns', () => {
  const live = useWorldMapStore.getState().activeEncounterTiles.size;
  expect(live).toBeGreaterThan(10);
  useInventoryStore.setState((s) => ({ bag: withStackCount(s.bag, { kind: 'incense' }, 1) }));
  // Keeps an encounter on a draw under the multiplier, drops it otherwise
  let flip = 0;
  jest.spyOn(Math, 'random').mockImplementation(() => (flip++ % 2 === 0 ? 0.2 : 0.8));
  lightWard();
  expect(useWorldMapStore.getState().activeEncounterTiles.size).toBe(Math.ceil(live / 2));

  // A draw that wins an ordinary haunted roll (0.42 × 0.55 ≈ 0.23) loses a warded one
  jest.spyOn(Math, 'random').mockReturnValue(0.2);
  useWorldMapStore.getState().setTiles(generateMap(SEED), SEED);
  expect(useWorldMapStore.getState().activeEncounterTiles.size).toBe(0);
  useWorldMapStore.setState({ wardUntil: 0 });
  useWorldMapStore.getState().setTiles(generateMap(SEED), SEED);
  expect(useWorldMapStore.getState().activeEncounterTiles.size).toBeGreaterThan(0);
});

it('rides in the save', () => {
  useInventoryStore.setState((s) => ({ bag: withStackCount(s.bag, { kind: 'incense' }, 2) }));
  useWorldMapStore.setState({ wardUntil: 300 });
  const save = captureSave();
  expect(save.inventory.bag).toContainEqual({ kind: 'incense', count: 2 });
  expect(save.worldMap.wardUntil).toBe(300);
  expect(isLoadable(save)).toBe(true);
});
