import { BALANCE } from '@/data/balanceConstants';
import { BAG_KINDS, BAG_KIND_ORDER, bagKindCap } from '@/data/items/bagKinds';
import { bagFrom, bagOrder, stackCount, validBag, withStack } from '@/data/items/bag';
import { itemTemplates } from '@/data/items/itemTemplates';
import { BagKind, GamePhase, Item, Rarity, ResourceType } from '@/models/types';
import { mintItem } from '@/systems/economy/itemFactory';
import { slotsFor } from '@/systems/progression/equipRules';
import { rationCap } from '@/systems/economy/rations';
import { captureSave, loadGame, saveGame } from '@/systems/save/persistence';
import { isLoadable, SAVE_VERSION } from '@/systems/save/saveFormat';
import {
  selectGear, selectGems, selectRations, selectTownPortal, selectWards, useInventoryStore,
} from '@/stores/inventoryStore';
import { useGameStore } from '@/stores/gameStore';
import { useLocationStore } from '@/stores/locationStore';
import { usePartyStore } from '@/stores/partyStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { generateMap } from '@/systems/world/mapGenerator';

const mockDisk = new Map<string, string>();
jest.mock('@/platform/keyValueStore', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockDisk.set(key, value); },
  },
}));

const inv = () => useInventoryStore.getState();
const setGold = (gold: number) => useInventoryStore.setState((s) => ({ resources: { ...s.resources, gold } }));
const epic = (): Item => mintItem(itemTemplates.find((t) => t.rarity === Rarity.Epic)!, () => 0.99);

beforeEach(() => {
  useInventoryStore.getState().reset();
});

describe('bag kinds', () => {
  it('declares every kind once, in the grid order, with a panel and at least one action', () => {
    expect([...BAG_KIND_ORDER].sort()).toEqual(Object.keys(BAG_KINDS).sort());
    for (const kind of BAG_KIND_ORDER) {
      expect(BAG_KINDS[kind].kind).toBe(kind);
      expect(BAG_KINDS[kind].actions.length).toBeGreaterThan(0);
    }
    expect(BAG_KINDS.gear.stackable).toBe(false);
    expect(BAG_KIND_ORDER.filter((k) => BAG_KINDS[k].stackable)).toEqual(['gem', 'ration', 'townPortal', 'incense']);
  });

  it('pins each kind\'s cap: one portal, WARD_CARRY incense, rations per hero, none on gear or gems', () => {
    expect(bagKindCap('townPortal', 4)).toBe(1);
    expect(bagKindCap('incense', 4)).toBe(BALANCE.WARD_CARRY);
    for (const party of [0, 1, 4]) {
      expect(bagKindCap('ration', party)).toBe(party * BALANCE.RATIONS_PER_HERO);
      expect(rationCap(party)).toBe(bagKindCap('ration', party));
    }
    expect(bagKindCap('gear', 4)).toBeNull();
    expect(bagKindCap('gem', 4)).toBeNull();
  });

  it('keeps one entry per stack and drops a stack that reaches zero', () => {
    let bag = withStack([], { kind: 'gem', gem: 'ruby_cut' }, 2);
    bag = withStack(bag, { kind: 'gem', gem: 'ruby_cut' }, 1);
    expect(bag).toEqual([{ kind: 'gem', gem: 'ruby_cut', count: 3 }]);
    bag = withStack(bag, { kind: 'gem', gem: 'ruby_cut' }, -3);
    expect(bag).toEqual([]);
    expect(validBag([{ kind: 'ration', count: 1 }, { kind: 'ration', count: 1 }])).toBe(false);
    expect(validBag([{ kind: 'ration', count: 0 }])).toBe(false);
    expect(validBag([{ kind: 'tonic', count: 1 }])).toBe(false);
  });

  it('lists gear first, then the stacks by kind', () => {
    const sword = { ...epic(), id: 'sword' };
    const bag = bagOrder([{ kind: 'incense', count: 1 }, { kind: 'gem', gem: 'jade_cut', count: 1 }, { kind: 'gear', item: sword }, { kind: 'ration', count: 2 }]);
    expect(bag.map((e) => e.kind)).toEqual(['gear', 'gem', 'ration', 'incense']);
  });
});

describe('store actions on bag entries', () => {
  it('reads gear through one selector that never sees a stack, and is stable for one bag', () => {
    inv().addItem(epic());
    inv().addGem('ruby_cut');
    const gear = selectGear(inv());
    expect(gear).toHaveLength(1);
    expect(selectGear(inv())).toBe(gear);
    expect(inv().gear()).toBe(gear);
  });

  it('refuses a second portal, short gold, and spending what is not carried', () => {
    expect(inv().spendTownPortal()).toBe(false);
    setGold(BALANCE.TOWN_PORTAL_GOLD - 1);
    expect(inv().buyTownPortal()).toBe(false);
    setGold(BALANCE.TOWN_PORTAL_GOLD * 2);
    expect(inv().buyTownPortal()).toBe(true);
    expect(inv().buyTownPortal()).toBe(false);
    expect(stackCount(inv().bag, { kind: 'townPortal' })).toBe(1);
    expect(inv().spendTownPortal()).toBe(true);
    expect(selectTownPortal(inv())).toBe(false);
  });

  it('refuses incense past WARD_CARRY or on short gold, and lighting with none', () => {
    expect(inv().spendWard()).toBe(false);
    setGold(BALANCE.WARD_GOLD * (BALANCE.WARD_CARRY + 1));
    for (let i = 0; i < BALANCE.WARD_CARRY; i += 1) expect(inv().buyWard()).toBe(true);
    expect(inv().buyWard()).toBe(false);
    expect(selectWards(inv())).toBe(BALANCE.WARD_CARRY);
    setGold(0);
    expect(inv().spendWard()).toBe(true);
    expect(inv().buyWard()).toBe(false);
  });

  it('adds whole rations only and refuses to eat from an empty pack', () => {
    expect(selectRations(inv())).toBe(BALANCE.STARTING_RATIONS);
    inv().addRations(0);
    inv().addRations(-2);
    expect(selectRations(inv())).toBe(BALANCE.STARTING_RATIONS);
    for (let i = 0; i < BALANCE.STARTING_RATIONS; i += 1) expect(inv().spendRation()).toBe(true);
    expect(inv().spendRation()).toBe(false);
    expect(inv().bag.some((e) => e.kind === 'ration')).toBe(false);
  });

  it('refuses a brilliant at the shop, a short gem stack and a short cut', () => {
    setGold(1000);
    expect(inv().buyGem('ruby_brilliant')).toBe(false);
    expect(inv().spendGem('ruby_cut')).toBe(false);
    expect(inv().buyGem('ruby_cut')).toBe(true);
    expect(inv().mergeGem('ruby', 'brilliant')).toBe(false);
    expect(inv().buyGem('ruby_cut')).toBe(true);
    expect(inv().mergeGem('ruby', 'brilliant')).toBe(true);
    expect(selectGems(inv()).ruby_cut).toBe(0);
    expect(selectGems(inv()).ruby_brilliant).toBe(1);
  });

  it('refuses setting into a filled socket or without the gem, and taking from an empty one or without gold', () => {
    const id = inv().addItem({ ...epic(), sockets: [null, null] });
    setGold(1000);
    expect(inv().socketGem(id, 0, 'amber_cut')).toBe(false);
    inv().addGem('amber_cut', 2);
    expect(inv().recoverGem(id, 0)).toBe(false);
    expect(inv().socketGem(id, 0, 'amber_cut')).toBe(true);
    expect(inv().socketGem(id, 0, 'amber_cut')).toBe(false);
    setGold(BALANCE.GEM_RECOVER_GOLD - 1);
    expect(inv().recoverGem(id, 0)).toBe(false);
    expect(inv().getItem(id)?.sockets).toEqual(['amber_cut', null]);
  });

  it('sets a gem into a worn piece for free without unequipping it, and takes it out for GEM_RECOVER_GOLD', () => {
    usePartyStore.getState().reset();
    usePartyStore.getState().addHero('warrior');
    const piece = { ...epic(), sockets: [null] as Item['sockets'] };
    const id = inv().addItem(piece);
    const slot = slotsFor(piece.slot)[0];
    usePartyStore.setState((s) => ({ heroes: s.heroes.map((h) => ({ ...h, equipment: { ...h.equipment, [slot]: id } })) }));
    inv().addGem('ruby_cut');
    setGold(1000);

    expect(inv().socketGem(id, 0, 'ruby_cut')).toBe(true);
    expect(inv().resources.gold).toBe(1000);
    expect(inv().getItem(id)?.sockets).toEqual(['ruby_cut']);
    expect(selectGems(inv()).ruby_cut).toBe(0);
    expect(usePartyStore.getState().heroes[0].equipment[slot]).toBe(id);

    expect(inv().recoverGem(id, 0)).toBe(true);
    expect(inv().resources.gold).toBe(1000 - BALANCE.GEM_RECOVER_GOLD);
    expect(inv().getItem(id)?.sockets).toEqual([null]);
    expect(selectGems(inv()).ruby_cut).toBe(1);
    expect(usePartyStore.getState().heroes[0].equipment[slot]).toBe(id);
  });

  it('clearResources (a siege loss) empties every stackable kind and keeps the gear', () => {
    const id = inv().addItem(epic());
    useInventoryStore.setState((s) => ({
      bag: [...s.bag, ...bagFrom({ gems: { ruby_cut: 2, jade_brilliant: 1 }, rations: 3, townPortal: 1, incense: 2 })],
    }));
    const stackable = BAG_KIND_ORDER.filter((k) => BAG_KINDS[k].stackable);
    for (const kind of stackable) expect(inv().bag.some((e) => e.kind === kind)).toBe(true);
    inv().clearResources();
    for (const kind of stackable) expect([kind, inv().bag.some((e) => e.kind === kind)]).toEqual([kind, false]);
    expect(selectWards(inv())).toBe(0);
    expect(selectGear(inv()).map((i) => i.id)).toEqual([id]);
    expect(inv().resources[ResourceType.Gold]).toBe(0);
  });
});

describe('the bag in a save', () => {
  beforeEach(() => {
    useLocationStore.getState().reset();
    useGameStore.getState().newGame(20261017);
    useWorldMapStore.getState().setTiles(generateMap(20261017), 20261017);
    usePartyStore.getState().addHero('warrior');
    useGameStore.getState().confirmHeroSelect('warrior');
    useLocationStore.getState().leave();
    useGameStore.getState().setPhase(GamePhase.WorldMap);
  });

  it('round-trips gear, two gem stacks, rations, a portal and incense', async () => {
    useInventoryStore.getState().reset();
    const id = inv().addItem(epic());
    useInventoryStore.setState((s) => ({
      bag: [...s.bag, ...bagFrom({ gems: { ruby_cut: 2, sapphire_brilliant: 1 }, townPortal: 1, incense: 2 })],
    }));
    inv().addRations(2);
    const held = JSON.parse(JSON.stringify(inv().bag));
    expect(isLoadable(JSON.parse(JSON.stringify(captureSave())))).toBe(true);
    await saveGame();
    useInventoryStore.getState().reset();
    expect(await loadGame()).toBe(true);
    expect(inv().bag).toEqual(held);
    expect(selectGear(inv()).map((i) => i.id)).toEqual([id]);
    expect(selectGems(inv())).toMatchObject({ ruby_cut: 2, sapphire_brilliant: 1 });
    expect(selectRations(inv())).toBe(BALANCE.STARTING_RATIONS + 2);
    expect(selectTownPortal(inv())).toBe(true);
    expect(selectWards(inv())).toBe(2);
  });

  it('refuses an older version and a bag it cannot read, as the format has no migrations', () => {
    const save = JSON.parse(JSON.stringify(captureSave()));
    expect(isLoadable(save)).toBe(true);
    expect(isLoadable({ ...save, version: SAVE_VERSION - 1 })).toBe(false);
    // The fields the bag replaced, with no bag: the shape of a version-62 file
    const legacy = { ...save, inventory: { items: [], resources: save.inventory.resources, gems: {}, rations: 1, townPortal: false, wards: 0 } };
    expect(isLoadable(legacy)).toBe(false);
    const unknownKind = { ...save, inventory: { ...save.inventory, bag: [{ kind: 'tonic' as BagKind, count: 1 }] } };
    expect(isLoadable(unknownKind)).toBe(false);
  });
});
