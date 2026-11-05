import { GamePhase, MapTile, POIType, TileType } from '@/models/types';
import { generateMap } from '@/systems/world/mapGenerator';
import { restoreTiles, tileMutations } from '@/systems/world/worldState';
import { worldDef, worldSeed } from '@/data/worlds';
import { BALANCE } from '@/data/balanceConstants';
import { hexKey } from '@/utils/hexUtils';

/**
 * Worlds are saved as seed plus the player's marks, and several coexist under
 * one clock (`systems/world/worldState.ts`). Each `launch()` is a cold start
 * over the same disk.
 */

const mockDisk = new Map<string, string>();

jest.mock('@/platform/keyValueStore', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockDisk.set(key, value); },
  },
}));

const SEED = 20261015;
const HOURS_PER_WEEK = BALANCE.HOURS_PER_DAY * BALANCE.DAYS_PER_WEEK;

function launch() {
  jest.resetModules();
  return {
    save: require('@/systems/save/persistence') as typeof import('@/systems/save/persistence'),
    game: require('@/stores/gameStore').useGameStore as typeof import('@/stores/gameStore').useGameStore,
    party: require('@/stores/partyStore').usePartyStore as typeof import('@/stores/partyStore').usePartyStore,
    world: require('@/stores/worldMapStore').useWorldMapStore as typeof import('@/stores/worldMapStore').useWorldMapStore,
    clock: require('@/stores/calendarStore').useCalendarStore as typeof import('@/stores/calendarStore').useCalendarStore,
  };
}
type App = ReturnType<typeof launch>;

function campaign(app: App) {
  const tiles = generateMap(SEED);
  app.world.getState().setTiles(tiles, SEED);
  app.world.getState().moveParty(tiles.find((t) => t.poi === POIType.City)!.coord);
  app.game.getState().startHeroSelect(SEED);
  app.party.getState().addHero('warrior');
  app.game.getState().confirmHeroSelect('warrior');
  app.game.getState().setPhase(GamePhase.WorldMap);
}

/** Walk the party to a far explored-or-not tile without a route: the reveal is what matters. */
function wander(app: App, steps = 6): void {
  const tiles = [...app.world.getState().tiles.values()].filter((t) => t.type !== TileType.Water && !t.poi);
  for (let i = 1; i <= steps; i++) app.world.getState().moveParty(tiles[Math.floor((tiles.length * i) / (steps + 1))].coord);
}

const explored = (tiles: Map<string, MapTile>) => [...tiles.values()].filter((t) => t.explored).map((t) => hexKey(t.coord)).sort();
const firstWell = (app: App) => [...app.world.getState().tiles.values()].find((t) => t.poi === POIType.MagicWell)!.coord;
const arriveHome = (tiles: Map<string, MapTile>) => [...tiles.values()].find((t) => t.poi === POIType.WorldGate)?.coord ?? worldDef('empire').home;

beforeEach(() => mockDisk.clear());

describe('a world saved as seed and mutations', () => {
  it('keeps explored ground, beaten sites, wells and finds through a reload', async () => {
    const app = launch();
    campaign(app);
    wander(app);
    const site = [...app.world.getState().tiles.values()].find((t) => t.poi === POIType.QuestSite)!;
    app.world.getState().markDefeated(site.coord);
    app.world.getState().drinkMagicWell(firstWell(app));
    const taken = [...app.world.getState().finds.values()][0];
    app.world.getState().claimFind(taken.coord);
    const before = app.world.getState();
    await app.save.saveGame();

    const back = launch();
    expect(await back.save.loadGame()).toBe(true);
    const after = back.world.getState();
    expect(explored(after.tiles)).toEqual(explored(before.tiles));
    expect(after.tiles.get(hexKey(site.coord))?.defeated).toBe(true);
    expect([...after.usedMagicWells]).toEqual([...before.usedMagicWells]);
    expect([...after.finds.keys()]).toEqual([...before.finds.keys()]);
    expect(after.partyPosition).toEqual(before.partyPosition);
    // Every generated field is the generator's: the regenerated map is the map.
    for (const [key, tile] of before.tiles) {
      expect({ ...after.tiles.get(key), explored: tile.explored }).toEqual(tile);
    }
  });

  it('recharges wells and deals a new week of finds after reload, as before', async () => {
    const app = launch();
    campaign(app);
    app.world.getState().drinkMagicWell(firstWell(app));
    await app.save.saveGame();

    const back = launch();
    await back.save.loadGame();
    const week = back.clock.getState().weekNumber;
    const position = back.world.getState().partyPosition;
    back.world.getState().moveParty(position, HOURS_PER_WEEK);
    expect(back.clock.getState().weekNumber).toBe(week + 1);
    expect(back.world.getState().usedMagicWells.size).toBe(0);
    expect(back.world.getState().finds.size).toBeGreaterThan(0);
  });

  it('is materially smaller than the whole tiles it replaces', async () => {
    const app = launch();
    campaign(app);
    wander(app, 12);
    await app.save.saveGame();
    const raw = mockDisk.get('engine_save')!;
    const wholeTiles = JSON.stringify([...app.world.getState().tiles.values()]).length;
    const world = JSON.stringify(JSON.parse(raw).worldMap).length;
    expect(world * 10).toBeLessThan(wholeTiles);
  });

  it('regenerates exactly the map a mutation list was taken from', () => {
    const tiles = generateMap(SEED).map((t, i) => (i % 7 === 0 ? { ...t, explored: true } : t));
    const marks = tileMutations(tiles);
    expect(restoreTiles('empire', SEED, marks.explored, marks.defeated)).toEqual(tiles);
  });
});

describe('several worlds under one clock', () => {
  it('keeps each world’s own mutations across switches and a reload', async () => {
    const app = launch();
    campaign(app);
    wander(app);
    app.world.getState().drinkMagicWell(firstWell(app));
    const empire = app.world.getState();
    const empireExplored = explored(empire.tiles);
    const empireWells = [...empire.usedMagicWells];
    const hoursBefore = app.clock.getState().totalHours;

    const jadeSeed = worldSeed(SEED, 'jadeveil');
    app.world.getState().switchWorld('jadeveil', jadeSeed, arriveHome);
    expect(app.world.getState().worldId).toBe('jadeveil');
    expect(app.world.getState().tiles.size).toBe(BALANCE.JADEVEIL_MAP_WIDTH * BALANCE.JADEVEIL_MAP_HEIGHT);
    expect(app.world.getState().cityCoord).toBeNull();
    wander(app, 3);
    const jade = app.world.getState();
    const jadeExplored = explored(jade.tiles);
    const jadePosition = jade.partyPosition;
    expect(app.clock.getState().totalHours).toBeGreaterThan(hoursBefore);

    await app.save.saveGame();
    const back = launch();
    expect(await back.save.loadGame()).toBe(true);
    expect(back.world.getState().worldId).toBe('jadeveil');
    expect(explored(back.world.getState().tiles)).toEqual(jadeExplored);
    expect(back.world.getState().partyPosition).toEqual(jadePosition);
    expect(back.clock.getState().totalHours).toBe(app.clock.getState().totalHours);

    // Same day: the Empire is exactly as it was left.
    back.world.getState().switchWorld('empire', SEED, arriveHome);
    expect(explored(back.world.getState().tiles)).toEqual(
      expect.arrayContaining(empireExplored));
    expect([...back.world.getState().usedMagicWells]).toEqual(empireWells);
    expect(back.world.getState().cityCoord).not.toBeNull();

    // And Jadeveil kept its own marks while the party was home.
    back.world.getState().switchWorld('jadeveil', jadeSeed, arriveHome);
    expect(explored(back.world.getState().tiles)).toEqual(expect.arrayContaining(jadeExplored));
  });

  it('lets the world left behind catch up on the shared clock', () => {
    const app = launch();
    campaign(app);
    app.world.getState().drinkMagicWell(firstWell(app));
    app.world.getState().switchWorld('jadeveil', worldSeed(SEED, 'jadeveil'), arriveHome);
    const week = app.clock.getState().weekNumber;
    app.world.getState().moveParty(app.world.getState().partyPosition, HOURS_PER_WEEK);
    expect(app.clock.getState().weekNumber).toBe(week + 1);

    app.world.getState().switchWorld('empire', SEED, arriveHome);
    expect(app.world.getState().usedMagicWells.size).toBe(0);
    expect(app.world.getState().finds.size).toBeGreaterThan(0);
    expect(app.clock.getState().weekNumber).toBe(week + 1);
  });
});

describe("Jadeveil's wrath and vows in the save", () => {
  it('reads the same wrath, floor, window and vows after a reload, and decays from the same clock', async () => {
    const app = launch();
    campaign(app);
    const ascent = require('@/stores/ascentStore').useAscentStore as typeof import('@/stores/ascentStore').useAscentStore;
    const { liveWrath } = require('@/systems/world/wrath') as typeof import('@/systems/world/wrath');
    app.world.getState().switchWorld('jadeveil', worldSeed(SEED, 'jadeveil'), arriveHome);
    ascent.getState().gainWrath('lair');
    ascent.getState().gainWrath('lair');
    ascent.getState().vow(0, 'mountain_stride');
    ascent.getState().vow(1, 'rain_walker');
    app.world.getState().moveParty(app.world.getState().partyPosition, 30);
    const reading = liveWrath(ascent.getState().wrath, app.clock.getState().totalHours);
    await app.save.saveGame();

    const back = launch();
    expect(await back.save.loadGame()).toBe(true);
    const restored = require('@/stores/ascentStore').useAscentStore as typeof import('@/stores/ascentStore').useAscentStore;
    const wrath = require('@/systems/world/wrath') as typeof import('@/systems/world/wrath');
    expect(restored.getState().vows).toEqual(['mountain_stride', 'rain_walker', null, null]);
    expect(restored.getState().wrath.floor).toBe(25);
    expect(wrath.liveWrath(restored.getState().wrath, back.clock.getState().totalHours)).toBe(reading);
    // A lull after the reload falls exactly as it would have without one
    back.world.getState().moveParty(back.world.getState().partyPosition, 50);
    expect(wrath.liveWrath(restored.getState().wrath, back.clock.getState().totalHours))
      .toBeCloseTo(Math.max(25, reading - BALANCE.WRATH_DECAY_PER_HOUR * 50));
  });

  it('refuses a save without them', async () => {
    const { isLoadable } = require('@/systems/save/saveFormat') as typeof import('@/systems/save/saveFormat');
    const app = launch();
    campaign(app);
    const data = app.save.captureSave();
    expect(isLoadable(data)).toBe(true);
    expect(isLoadable({ ...data, ascent: undefined } as never)).toBe(false);
    expect(isLoadable({ ...data, ascent: { ...data.ascent, vows: ['storm_eye', null, null, null] } } as never)).toBe(false);
  });
});
