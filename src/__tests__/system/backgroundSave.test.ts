import { GamePhase, POIType } from '@/models/types';
import { generateMap } from '@/systems/world/mapGenerator';

/**
 * The save `App` takes each time the app leaves the screen.
 *
 * It fires on whatever screen the player is on, so what keeps it safe is what
 * `saveGame` agrees to write. On the menu before Continue, memory holds the
 * empty game the app opened with, and writing that replaced the player's
 * campaign with a save that loads cleanly — onto the menu, with nobody in it.
 * Each `launch()` is the app started cold over the same disk, because a cold
 * start is how a player reaches that menu.
 */

const mockDisk = new Map<string, string>();
const mockWrites: string[] = [];

// A disk that outlives `jest.resetModules`: the factory runs again for every
// launch, but the map it writes to is this file's.
jest.mock('@/platform/keyValueStore', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    removeItem: async (key: string) => { mockDisk.delete(key); },
    setItem: async (key: string, value: string) => {
      mockWrites.push(key);
      mockDisk.set(key, value);
    },
  },
}));

interface App {
  save: typeof import('@/systems/save/persistence');
  game: typeof import('@/stores/gameStore').useGameStore;
  party: typeof import('@/stores/partyStore').usePartyStore;
  world: typeof import('@/stores/worldMapStore').useWorldMapStore;
}

/** The app started cold: every module evaluated afresh, every store as it opens. */
function launch(): App {
  jest.resetModules();
  return {
    save: require('@/systems/save/persistence'),
    game: require('@/stores/gameStore').useGameStore,
    party: require('@/stores/partyStore').usePartyStore,
    world: require('@/stores/worldMapStore').useWorldMapStore,
  };
}

const SEED = 20261001;
const onDisk = () => mockDisk.get('engine_save');
const saved = () => JSON.parse(onDisk()!);

/** New Campaign, as `useNewGame` presses it: a world, and nobody in it yet. */
function newCampaign(app: App) {
  const tiles = generateMap(SEED);
  app.world.getState().setTiles(tiles);
  app.world.getState().moveParty(tiles.find((t) => t.poi === POIType.City)!.coord);
  app.game.getState().startHeroSelect(SEED);
}

/** A hero chosen, as `HeroSelectScreen` confirms it: the campaign opens in the city. */
function chooseHero(app: App) {
  app.party.getState().addHero('warrior');
  app.game.getState().confirmHeroSelect('warrior');
}

/** A campaign begun and saved as the app went behind, then closed. */
async function campaignOnDisk(): Promise<string> {
  const app = launch();
  newCampaign(app);
  chooseHero(app);
  await app.save.saveOnAppStateChange('background');
  mockWrites.length = 0;
  return onDisk()!;
}

beforeEach(() => {
  mockDisk.clear();
  mockWrites.length = 0;
});

it('persists a purchased meal tier and expiry and rejects an older save', async () => {
  const app = launch(); newCampaign(app); chooseHero(app);
  const city = require('@/stores/cityStore').useCityStore;
  const clock = require('@/stores/calendarStore').useCalendarStore;
  const inventory = require('@/stores/inventoryStore').useInventoryStore;
  city.setState((s: { buildings: { type: string; level: number }[] }) => ({ buildings: s.buildings.map(b => b.type === 'tavern' ? { ...b, level: 2 } : b) }));
  inventory.getState().addResource('gold', 500);
  clock.getState().loadClock(90);
  expect(city.getState().buyMeal(1)).toBe(true);
  await app.save.saveGame();
  const stamp = saved().city.meal;
  expect(stamp).toEqual({ tier:2, week:1 });
  const restarted = launch();
  expect(await restarted.save.loadGame()).toBe(true);
  expect(require('@/stores/cityStore').useCityStore.getState().meal).toEqual(stamp);
  const old = saved(); old.version -= 1;
  mockDisk.set('engine_save', JSON.stringify(old));
  expect(await launch().save.loadGame()).toBe(false);
});

describe('the save taken when the app leaves the screen', () => {
  it('writes the campaign in play, wherever in it the party stands', async () => {
    const app = launch();
    newCampaign(app);
    chooseHero(app);

    await app.save.saveOnAppStateChange('background');
    expect(saved().game.phase).toBe(GamePhase.Location);
    expect(saved().party.heroes.map((h: { templateId: string }) => h.templateId)).toEqual(['warrior']);

    app.game.getState().setPhase(GamePhase.WorldMap);
    await app.save.saveOnAppStateChange('inactive');
    expect(saved().game.phase).toBe(GamePhase.WorldMap);

    app.game.getState().startEncounter('background_save_test');
    await app.save.saveOnAppStateChange('background');
    expect(saved().game.phase).toBe(GamePhase.Combat);
    expect(mockWrites).toHaveLength(3);
  });

  it('writes nothing while the app is still in front', async () => {
    const app = launch();
    newCampaign(app);
    chooseHero(app);
    for (const state of ['active', 'unknown', 'extension']) await app.save.saveOnAppStateChange(state);
    expect(mockWrites).toEqual([]);
  });

  it('never writes from the menu before Continue, so Continue still finds the campaign', async () => {
    const campaign = await campaignOnDisk();

    const app = launch();
    expect(app.game.getState().phase).toBe(GamePhase.Menu);
    expect(app.party.getState().heroes).toEqual([]);
    await app.save.saveOnAppStateChange('inactive');
    await app.save.saveOnAppStateChange('background');
    expect(mockWrites).toEqual([]);
    expect(onDisk()).toBe(campaign);

    // Continue — and from there on, leaving the screen saves again
    await expect(app.save.loadGame()).resolves.toBe(true);
    expect(app.game.getState().phase).toBe(GamePhase.WorldMap);
    expect(app.party.getState().heroes.map((h) => h.templateId)).toEqual(['warrior']);
    await app.save.saveOnAppStateChange('background');
    expect(mockWrites).toHaveLength(1);
    expect(saved().party.heroes).toHaveLength(1);
  });

  it('never rewrites a campaign left for the menu, which Continue would then resume on the menu', async () => {
    const app = launch();
    newCampaign(app);
    chooseHero(app);
    app.game.getState().setPhase(GamePhase.WorldMap);
    // Leave the Field: saved where it stands, then the menu
    await app.save.saveGame();
    app.game.getState().returnToMenu();
    const left = onDisk();

    await app.save.saveOnAppStateChange('background');
    expect(mockWrites).toHaveLength(1);
    expect(onDisk()).toBe(left);

    const next = launch();
    await expect(next.save.loadGame()).resolves.toBe(true);
    expect(next.game.getState().phase).toBe(GamePhase.WorldMap);
  });

  it('never writes a new campaign before its hero is chosen', async () => {
    const campaign = await campaignOnDisk();

    const app = launch();
    newCampaign(app);
    await app.save.saveOnAppStateChange('background');
    app.game.getState().setPhase(GamePhase.HeroSelect);
    await app.save.saveOnAppStateChange('background');
    expect(mockWrites).toEqual([]);
    expect(onDisk()).toBe(campaign);
  });

  it('never writes from the harness screens, before a harness fight has guarded anything', async () => {
    const campaign = await campaignOnDisk();

    const app = launch();
    for (const phase of [GamePhase.SimSetup, GamePhase.PerfLaunch, GamePhase.SaveCreator]) {
      app.game.getState().setPhase(phase);
      await app.save.saveOnAppStateChange('background');
    }
    expect(mockWrites).toEqual([]);
    expect(onDisk()).toBe(campaign);
  });
});


it('a created save replaces the campaign on disk and loads as the campaign', async () => {
  await campaignOnDisk();
  Object.assign(globalThis, { __DEV__: true });
  const app = launch();
  const recipe = require('@/systems/sim/scenarioCreator').defaultScenario();
  const data = require('@/systems/sim/scenarioCreator').buildScenario({ ...recipe, party: [...recipe.party, { ...recipe.party[0], templateId: 'mage' }] }).save;
  await app.save.writeCreatedSave(data);
  expect(JSON.parse(onDisk()!).party.heroes).toHaveLength(2);
  expect(await app.save.loadGame()).toBe(true);
  expect(app.party.getState().heroes).toHaveLength(2);
});

it('cold-loads the committed encounter, initial HP and hunt streak rather than rolling a different fight', async () => {
  const app = launch(); newCampaign(app); chooseHero(app);
  const { makeUnit } = require('../support/fixtures');
  const location = require('@/stores/locationStore').useLocationStore;
  const empire = require('@/stores/empireStore').useEmpireStore;
  const hunt = require('@/stores/huntStore').useHuntStore;
  location.getState().enter('lair_warren'); location.getState().hold({ q: 2, r: 0 });
  empire.setState({ castleTier: 2, castleStage: 1 });
  hunt.setState({ streak: { key: 'wolf', misses: 2 } });
  app.game.getState().startEncounter('random_danger');
  const entry = { id: 'random_danger', plan: { enemies: ['wolf'], factionId: 'beasts' as const, shape: null },
    players: [makeUnit({ currentHp: 45 })], enemies: [makeUnit({ isPlayer: false, templateId: 'wolf' })],
    partyLevel: 3, powerScale: 1.2, resolved: false };
  app.game.setState({ encounterEntry: entry });
  await app.save.saveOnAppStateChange('background');
  const cold = launch();
  expect(await cold.save.loadGame()).toBe(true);
  expect(cold.game.getState().phase).toBe(GamePhase.Combat);
  expect(cold.game.getState().currentEncounterId).toBe('random_danger');
  expect(cold.game.getState().encounterEntry).toEqual(entry);
  expect(require('@/stores/locationStore').useLocationStore.getState().pending).toEqual({ q: 2, r: 0 });
  expect(require('@/stores/empireStore').useEmpireStore.getState().castleStage).toBe(1);
  expect(require('@/stores/huntStore').useHuntStore.getState().streak.misses).toBe(2);
});

it('saves accepted rewards beyond the encounter entry, including the next castle stage', () => {
  const app = launch(); newCampaign(app); chooseHero(app);
  const empire = require('@/stores/empireStore').useEmpireStore;
  const entry = { id: 'castle_t2_s1', plan: { factionId: null, shape: null, enemies: [] },
    players: [], enemies: [], partyLevel: 3, powerScale: 1, resolved: true };
  app.game.setState({ phase: GamePhase.Combat, encounterEntry: entry });
  empire.setState({ castleTier: 2, castleStage: 1 });
  const next = app.save.captureSave();
  expect(next.game.phase).toBe(GamePhase.Combat);
  expect(next.game.encounterEntry).toBeNull();
  expect(next.empire.castleStage).toBe(2);
  expect(next.game.currentEncounterId).toBe(require('@/systems/world/castle').castleEncounterId(2, 2));
  empire.setState({ castleTier: null, castleStage: 0 });
  const finished = app.save.captureSave();
  expect(finished.game.phase).toBe(GamePhase.WorldMap);
  expect(finished.game.currentEncounterId).toBeNull();
  expect(finished.game.encounterEntry).toBeNull();
});
