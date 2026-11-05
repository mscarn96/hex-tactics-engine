import { POIType } from '@/models/types';
import { generateMap } from '@/systems/world/mapGenerator';
import { CAMPAIGN_STAGE_IDS } from '@/systems/sim/campaignStages';
import { hexKey } from '@/utils/hexUtils';

/**
 * The ledger through a real save, and what a release build must not have. Each `launch()` is a
 * cold start over the same disk.
 */

const mockDisk = new Map<string, string>();

jest.mock('@/platform/keyValueStore', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockDisk.set(key, value); },
    removeItem: async (key: string) => { mockDisk.delete(key); },
  },
}));

const SEED = 20261104;
const SAVE_KEY = 'engine_save';

function launch() {
  jest.resetModules();
  const entitlements = require('@/stores/entitlementStore') as typeof import('@/stores/entitlementStore');
  entitlements.resetEntitlementsForTest(['jadeveil']);
  return {
    save: require('@/systems/save/persistence') as typeof import('@/systems/save/persistence'),
    format: require('@/systems/save/saveFormat') as typeof import('@/systems/save/saveFormat'),
    stages: require('@/systems/sim/campaignStages') as typeof import('@/systems/sim/campaignStages'),
    travel: require('@/systems/world/worldTravel') as typeof import('@/systems/world/worldTravel'),
    gates: require('@/systems/world/worldGates') as typeof import('@/systems/world/worldGates'),
    cap: require('@/data/levelCap') as typeof import('@/data/levelCap'),
    bands: require('@/stores/worldBandStore').useWorldBandStore as typeof import('@/stores/worldBandStore').useWorldBandStore,
    mythic: require('@/stores/mythicStore').useMythicStore as typeof import('@/stores/mythicStore').useMythicStore,
    ascent: require('@/stores/ascentStore').useAscentStore as typeof import('@/stores/ascentStore').useAscentStore,
    game: require('@/stores/gameStore').useGameStore as typeof import('@/stores/gameStore').useGameStore,
    world: require('@/stores/worldMapStore').useWorldMapStore as typeof import('@/stores/worldMapStore').useWorldMapStore,
    empire: require('@/stores/empireStore').useEmpireStore as typeof import('@/stores/empireStore').useEmpireStore,
    party: require('@/stores/partyStore').usePartyStore as typeof import('@/stores/partyStore').usePartyStore,
  };
}

function atTheGate(app: ReturnType<typeof launch>) {
  app.world.getState().setTiles(generateMap(SEED), SEED);
  app.game.getState().startHeroSelect(SEED);
  app.party.getState().addHero('warrior');
  app.game.getState().confirmHeroSelect('warrior');
  app.empire.getState().setEmperorDefeated(true);
  const gate = [...app.world.getState().tiles.values()].find((t) => t.poi === POIType.WorldGate)!;
  app.world.getState().moveParty(gate.coord);
}

const PICKS = [
  { heroClass: 'warrior', masteryPath: null }, { heroClass: 'mage', masteryPath: null },
  { heroClass: 'healer', masteryPath: null }, { heroClass: 'ranger', masteryPath: null },
] as unknown as Parameters<ReturnType<typeof launch>['stages']['buildStageSave']>[1];

// Each suite states its build: the tests' own default is neither
beforeEach(() => {
  mockDisk.clear();
  Object.assign(globalThis, { __DEV__: true });
});
afterEach(() => {
  delete (globalThis as { __DEV__?: boolean }).__DEV__;
});

describe('the ledger in the save', () => {
  it('keeps a band and a finished mark across save and load', async () => {
    const app = launch();
    atTheGate(app);
    expect(app.travel.crossWorldGate()).toBe(true);
    app.ascent.getState().clearSummit(1);
    expect(app.bands.getState().ledger).toEqual({ bands: { jadeveil: 1 }, finished: ['jadeveil'] });
    await app.save.saveGame();

    const back = launch();
    expect(back.cap.levelCap()).toBe(20);
    expect(await back.save.loadGame()).toBe(true);
    expect(back.bands.getState().ledger).toEqual({ bands: { jadeveil: 1 }, finished: ['jadeveil'] });
    // Two worlds owned in a development build, one finished: the next crossing is open
    expect(back.cap.levelCap()).toBe(30);
  });

  it('keeps the mythic counter across save and load, refuses a save without it, and a new campaign empties it', async () => {
    const app = launch();
    atTheGate(app);
    app.mythic.getState().setKills(9);
    await app.save.saveGame();
    const written = JSON.parse(mockDisk.get(SAVE_KEY)!);
    const { mythicKills: _kills, ...older } = written;
    expect(app.format.isLoadable(older)).toBe(false);
    expect(app.format.isLoadable({ ...written, mythicKills: -1 })).toBe(false);

    const back = launch();
    expect(back.mythic.getState().kills).toBe(0);
    expect(await back.save.loadGame()).toBe(true);
    expect(back.mythic.getState().kills).toBe(9);
    back.game.getState().startHeroSelect(SEED);
    expect(back.mythic.getState().kills).toBe(0);
  });

  it('marks Jadeveil finished on Kairen’s first kill only', () => {
    const app = launch();
    expect(app.ascent.getState().clearSummit(1).firstKill).toBe(true);
    expect(app.bands.getState().ledger.finished).toEqual(['jadeveil']);
    expect(app.ascent.getState().clearSummit(2).firstKill).toBe(false);
    expect(app.bands.getState().ledger.finished).toEqual(['jadeveil']);
  });

  it('refuses a save from before the bump, and one without a ledger', async () => {
    const app = launch();
    atTheGate(app);
    await app.save.saveGame();
    const written = JSON.parse(mockDisk.get(SAVE_KEY)!);
    expect(app.format.isLoadable(written)).toBe(true);
    expect(app.format.isLoadable({ ...written, version: app.format.SAVE_VERSION - 1 })).toBe(false);
    const { worldBands: _ledger, ...older } = written;
    expect(app.format.isLoadable(older)).toBe(false);
  });

  it('starts a new campaign with an empty ledger', () => {
    const app = launch();
    app.bands.getState().cross('jadeveil');
    app.game.getState().startHeroSelect(SEED);
    expect(app.bands.getState().ledger).toEqual({ bands: {}, finished: [] });
  });
});

describe('Save Creator’s world orders', () => {
  it('loads Jadeveil as the second world, at cap 30, with the party at the start of the band', async () => {
    const app = launch();
    const { save } = app.stages.buildStageSave('jadeveil_second', PICKS, 3);
    expect(save.worldBands).toEqual({ bands: { archipelago: 1, jadeveil: 2 }, finished: ['archipelago'] });
    expect(Math.max(...save.party.heroes.map((h) => h.level))).toBeLessThanOrEqual(25);
    expect(Math.max(...save.party.heroes.map((h) => h.level))).toBeGreaterThan(20);
    await app.save.writeCreatedSave(save);
    expect(await app.save.loadGame()).toBe(true);
    expect(app.world.getState().worldId).toBe('jadeveil');
    expect(app.cap.levelCap()).toBe(30);
  });

  it('loads the archipelago as the second world with Jadeveil’s road behind it', async () => {
    const app = launch();
    const { save } = app.stages.buildStageSave('archipelago_second', PICKS, 3);
    await app.save.writeCreatedSave(save);
    expect(await app.save.loadGame()).toBe(true);
    expect(app.world.getState().worldId).toBe('archipelago');
    expect(app.ascent.getState().summit.slain).toBe(true);
    expect(app.cap.levelCap()).toBe(30);
  });

  it('gives a stage’s first world band 1', () => {
    const { save } = launch().stages.buildStageSave('jadeveil', PICKS, 3);
    expect(save.worldBands).toEqual({ bands: { jadeveil: 1 }, finished: [] });
  });
});

describe('the development row', () => {
  it('walks a new campaign through any order: archipelago, finish it, then Jadeveil', async () => {
    let app = launch();
    atTheGate(app);
    expect(await app.save.devWorldToFinish()).toBeNull();
    expect(app.travel.crossWorldGate('archipelago')).toBe(true);
    expect(app.cap.levelCap()).toBe(25);
    await app.save.saveGame();
    expect(await app.save.devWorldToFinish()).toBe('archipelago');
    expect(await app.save.devFinishSavedWorld()).toBe(true);
    expect(await app.save.devWorldToFinish()).toBeNull();

    app = launch();
    expect(await app.save.loadGame()).toBe(true);
    expect(app.cap.levelCap()).toBe(30);
    app.world.getState().moveParty(
      [...app.world.getState().tiles.values()].find((t) => t.poi === POIType.IsleCamp)!.coord, 0);
    expect(app.travel.crossWorldGate()).toBe(true);
    const gate = [...app.world.getState().tiles.values()].find((t) => t.poi === POIType.WorldGate)!;
    app.world.getState().moveParty(gate.coord, 0);
    expect(app.travel.crossWorldGate('jadeveil')).toBe(true);
    expect(app.bands.getState().ledger.bands).toEqual({ archipelago: 1, jadeveil: 2 });
    expect(hexKey(app.world.getState().partyPosition)).not.toBe(hexKey(gate.coord));
  });
});

describe('a release build', () => {
  const release = (saveCreator: boolean) => {
    Object.assign(globalThis, { __DEV__: false });
    if (saveCreator) process.env.ENGINE_SAVE_CREATOR = '1';
    return launch();
  };

  afterEach(() => {
    delete process.env.ENGINE_SAVE_CREATOR;
  });

  it('offers no archipelago crossing, and counts no such world toward the cap', () => {
    const app = release(false);
    expect(app.gates.gateRoads('empire')).toEqual(['jadeveil']);
    atTheGate(app);
    expect(app.cap.roadState().owned).toEqual(['jadeveil']);
    expect(app.cap.levelCap()).toBe(25);
    expect(app.travel.crossWorldGate('archipelago')).toBe(false);
    expect(app.world.getState().worldId).toBe('empire');
    app.ascent.getState().clearSummit(1);
    expect(app.cap.levelCap()).toBe(25);
  });

  it('has no development action, whatever the save holds', async () => {
    const app = release(false);
    atTheGate(app);
    app.bands.getState().cross('jadeveil');
    await app.save.saveGame();
    expect(await app.save.devWorldToFinish()).toBeNull();
    expect(await app.save.devFinishSavedWorld()).toBe(false);
    expect(JSON.parse(mockDisk.get(SAVE_KEY)!).worldBands.finished).toEqual([]);
  });

  it('offers only the stages that stand on a real crossing, even bundled with Save Creator', () => {
    const app = release(true);
    const offered = app.stages.offeredCampaignStages();
    expect(offered).toEqual(['troll', 'dragon', 'heart', 'castle', 'jadeveil']);
    expect(CAMPAIGN_STAGE_IDS.filter((id) => !offered.includes(id))).toEqual(['jadeveil_second', 'archipelago', 'archipelago_second']);
    expect(() => app.stages.buildStageSave('jadeveil_second', PICKS, 3)).toThrow();
  });
});
