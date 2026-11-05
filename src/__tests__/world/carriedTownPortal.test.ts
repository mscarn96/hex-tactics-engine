import { withStackCount } from '@/data/items/bag';
import { GamePhase, POIType, ResourceType } from '@/models/types';
import { useInventoryStore, selectTownPortal } from '@/stores/inventoryStore';
import { useGameStore } from '@/stores/gameStore';
import { useLocationStore } from '@/stores/locationStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { canUseCarriedTownPortal, consumeCarriedTownPortal, returnThroughTownPortal, townPortalTile } from '@/systems/world/townPortal';
import { captureSave, saveGame, loadGame } from '@/systems/save/persistence';
import { usePartyStore } from '@/stores/partyStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { generateMap } from '@/systems/world/mapGenerator';
import { ARCHIPELAGO_WORLD, EMPIRE_WORLD, JADEVEIL_WORLD, WorldDef, worldSeed } from '@/data/worlds';
import { getLocation } from '@/locations';
import { LocationId, triggerKey } from '@/locations/types';

const mockDisk = new Map<string, string>();
jest.mock('@/platform/keyValueStore', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockDisk.set(key, value); },
  },
}));

beforeEach(() => {
  useInventoryStore.getState().reset();
  useLocationStore.getState().reset();
  useGameStore.getState().newGame(20261013);
  useWorldMapStore.getState().setTiles(generateMap(20261013), 20261013);
  usePartyStore.getState().addHero('warrior');
  useGameStore.getState().confirmHeroSelect('warrior');
  useLocationStore.getState().leave();
  useGameStore.getState().setPhase(GamePhase.WorldMap);
});

it('costs exactly 50 gold, caps at one and refuses an unaffordable purchase', () => {
  const bag = useInventoryStore.getState();
  useInventoryStore.setState({ resources: { ...bag.resources, gold: 49 } });
  expect(bag.buyTownPortal()).toBe(false);
  bag.addResource(ResourceType.Gold, 51);
  expect(bag.buyTownPortal()).toBe(true);
  expect(useInventoryStore.getState().resources.gold).toBe(50);
  expect(bag.buyTownPortal()).toBe(false);
  expect(useInventoryStore.getState().resources.gold).toBe(50);
});

it('consumes once on the map or in a lair, without advancing time or healing', () => {
  for (const location of [null, 'lair_warren'] as const) {
    useInventoryStore.setState((s) => ({ bag: withStackCount(s.bag, { kind: 'townPortal' }, 1) }));
    if (location) useGameStore.getState().enterLocation(location);
    else { useLocationStore.getState().leave(); useGameStore.getState().setPhase(GamePhase.WorldMap); }
    const hours = useCalendarStore.getState().totalHours;
    const hp = usePartyStore.getState().heroes[0].currentHp;
    expect(consumeCarriedTownPortal()).toBe(true);
    expect(useLocationStore.getState().current).toBe('city');
    expect(useWorldMapStore.getState().partyPosition).toEqual([...useWorldMapStore.getState().tiles.values()].find(t => t.poi === POIType.City)!.coord);
    expect(useCalendarStore.getState().totalHours).toBe(hours);
    expect(usePartyStore.getState().heroes[0].currentHp).toBe(hp);
    expect(consumeCarriedTownPortal()).toBe(false);
  }
});

it('refuses combat and town without consuming the portal', () => {
  useInventoryStore.setState((s) => ({ bag: withStackCount(s.bag, { kind: 'townPortal' }, 1) }));
  useGameStore.getState().setPhase(GamePhase.Combat);
  expect(consumeCarriedTownPortal()).toBe(false);
  useGameStore.getState().enterLocation('city');
  expect(consumeCarriedTownPortal()).toBe(false);
  expect(selectTownPortal(useInventoryStore.getState())).toBe(true);
});

it('saves and reloads the held portal, and reset empties its slot', async () => {
  useInventoryStore.setState((s) => ({ bag: withStackCount(s.bag, { kind: 'townPortal' }, 1) }));
  expect(captureSave().inventory.bag).toContainEqual({ kind: 'townPortal', count: 1 });
  await saveGame();
  useInventoryStore.getState().reset();
  expect(selectTownPortal(useInventoryStore.getState())).toBe(false);
  expect(await loadGame()).toBe(true);
  expect(selectTownPortal(useInventoryStore.getState())).toBe(true);
});

/**
 * Both portals — the carried one and a cleared lair's — open onto the home of
 * the world the party stands in (playtest 2026-10-21-b): the city in the
 * Empire, the foothill camp in Jadeveil, whose map has no city, so both did
 * nothing there. The archipelago's camp is not a walked place yet, and both
 * refuse there.
 */
describe('a portal opens onto the world’s home', () => {
  const SEED = 20261013;
  const standIn = (world: WorldDef) =>
    useWorldMapStore.getState().setTiles(generateMap(worldSeed(SEED, world.id), world), worldSeed(SEED, world.id), world.id);
  const onTheMap = () => {
    useLocationStore.getState().leave();
    useGameStore.getState().setPhase(GamePhase.WorldMap);
  };
  const carry = () => useInventoryStore.setState((s) => ({ bag: withStackCount(s.bag, { kind: 'townPortal' }, 1) }));
  /** A cleared lair, its boss's trigger spent so its portal stands. */
  const inClearedLair = (lair: LocationId) => {
    const boss = getLocation(lair).lair!.bossAt;
    useGameStore.getState().enterLocation(lair);
    useLocationStore.setState((s) => ({ spentTriggers: new Set([...s.spentTriggers, triggerKey(lair, boss)]) }));
    expect(townPortalTile(lair, useLocationStore.getState().spentTriggers, false)?.coord).toEqual(boss);
  };

  it.each([
    ['empire', EMPIRE_WORLD, 'city', 'lair_warren'],
    ['jadeveil', JADEVEIL_WORLD, 'camp_jadeveil', 'lair_silk'],
    ['jadeveil', JADEVEIL_WORLD, 'camp_jadeveil', 'lair_hall'],
  ] as const)('in %s: the carried portal and the cleared lair’s both open onto %s', (_name, world, home, lair) => {
    standIn(world);
    expect(useWorldMapStore.getState().worldId).toBe(world.id);

    // The carried portal, from the map
    carry();
    onTheMap();
    expect(canUseCarriedTownPortal()).toBe(true);
    expect(consumeCarriedTownPortal()).toBe(true);
    expect(useLocationStore.getState().current).toBe(home);
    expect(useGameStore.getState().phase).toBe(GamePhase.Location);
    expect(useWorldMapStore.getState().partyPosition).toEqual(world.home);
    expect(selectTownPortal(useInventoryStore.getState())).toBe(false);
    // Already home, a second one is refused and kept
    carry();
    expect(consumeCarriedTownPortal()).toBe(false);

    // The carried portal, from inside a lair
    inClearedLair(lair);
    expect(consumeCarriedTownPortal()).toBe(true);
    expect(useLocationStore.getState().current).toBe(home);

    // A cleared lair's own portal, free
    inClearedLair(lair);
    expect(returnThroughTownPortal()).toBe(true);
    expect(useLocationStore.getState().current).toBe(home);
    expect(useWorldMapStore.getState().partyPosition).toEqual(world.home);
  });

  it('in the Empire, home is the city’s own hex', () => {
    standIn(EMPIRE_WORLD);
    const city = [...useWorldMapStore.getState().tiles.values()].find((t) => t.poi === POIType.City)!.coord;
    expect(EMPIRE_WORLD.home).toEqual(city);
  });

  it('in the archipelago, whose camp is not a place yet, both refuse and nothing is spent', () => {
    standIn(ARCHIPELAGO_WORLD);
    const at = useWorldMapStore.getState().partyPosition;
    carry();
    onTheMap();
    expect(canUseCarriedTownPortal()).toBe(false);
    expect(consumeCarriedTownPortal()).toBe(false);
    expect(selectTownPortal(useInventoryStore.getState())).toBe(true);
    expect(returnThroughTownPortal()).toBe(false);
    expect(useGameStore.getState().phase).toBe(GamePhase.WorldMap);
    expect(useLocationStore.getState().current).toBeNull();
    expect(useWorldMapStore.getState().partyPosition).toEqual(at);
  });
});
