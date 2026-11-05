import { GamePhase } from '@/models/types';
import { makeUnit } from '../support/fixtures';

const mockDisk = new Map<string, string>();
let mockWriteHold: (() => Promise<void>) | null = null;
let mockRemoveHold: (() => Promise<void>) | null = null;
let mockRemoveFails = false;
jest.mock('@/platform/keyValueStore', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (mockWriteHold && JSON.parse(value).version) await mockWriteHold();
      mockDisk.set(key, value);
    },
    removeItem: async (key: string) => {
      if (mockRemoveHold) await mockRemoveHold();
      if (mockRemoveFails) throw Error('disk unavailable');
      mockDisk.delete(key);
    },
  },
}));

function launch() {
  jest.resetModules();
  return {
    save: require('@/systems/save/persistence') as typeof import('@/systems/save/persistence'),
    hardcore: require('@/systems/save/hardcore') as typeof import('@/systems/save/hardcore'),
    run: (require('@/stores/runSettingsStore') as typeof import('@/stores/runSettingsStore')).useRunSettingsStore,
    game: (require('@/stores/gameStore') as typeof import('@/stores/gameStore')).useGameStore,
    party: (require('@/stores/partyStore') as typeof import('@/stores/partyStore')).usePartyStore,
    combat: (require('@/stores/combatStore') as typeof import('@/stores/combatStore')).useCombatStore,
    sim: (require('@/stores/simStore') as typeof import('@/stores/simStore')).useSimStore,
  };
}

type App = ReturnType<typeof launch>;
async function campaign(difficulty: 'easy' | 'medium' | 'hard' = 'hard', hardcore = true) {
  const app = launch();
  app.game.getState().startHeroSelect(1234, { difficulty, hardcore });
  app.party.getState().addHero('warrior');
  app.party.getState().addHero('mage');
  app.game.getState().confirmHeroSelect('warrior');
  await app.save.saveGame();
  return app;
}
const heroes = () => [makeUnit({ id: 'one', heroId: 'h1' }), makeUnit({ id: 'two', heroId: 'h2' })];
function fight(app: App, where = 'map') {
  app.game.getState().startEncounter(where);
  app.combat.getState().initCombat(heroes(), [makeUnit({ id: 'foe', isPlayer: false })]);
  return app.hardcore.installHardcoreGuard();
}
function wipe(app: App) {
  app.combat.getState().damageUnit('one', 999999);
  app.combat.getState().damageUnit('two', 999999);
}
async function flush() { await new Promise<void>(resolve => setImmediate(resolve)); }
beforeEach(() => { mockDisk.clear(); mockWriteHold = null; mockRemoveHold = null; mockRemoveFails = false; });

it.each(['easy', 'medium', 'hard'] as const)('persists the fixed %s difficulty and only allows Hardcore on Hard', async difficulty => {
  const app = await campaign(difficulty);
  const saved = JSON.parse(mockDisk.get('engine_save')!);
  expect(saved.game.difficulty).toBe(difficulty);
  expect(saved.game.hardcore).toBe(difficulty === 'hard');
  const next = launch();
  expect(await next.save.loadGame()).toBe(true);
  expect(next.run.getState().difficulty).toBe(difficulty);
  expect(next.run.getState().hardcore).toBe(difficulty === 'hard');
  next.game.getState().startHeroSelect(9);
  expect(next.run.getState()).toMatchObject({ difficulty: 'medium', hardcore: false, summary: null });
});

it('rejects missing or invalid run settings and the previous save version', async () => {
  await campaign();
  const valid = JSON.parse(mockDisk.get('engine_save')!);
  const next = launch();
  for (const game of [{ ...valid.game, difficulty: undefined }, { ...valid.game, difficulty: 'boss' }, { ...valid.game, difficulty: 'medium', hardcore: true }, { ...valid.game, hardcore: undefined }]) {
    mockDisk.set('engine_save', JSON.stringify({ ...valid, game }));
    expect(await next.save.loadGame()).toBe(false);
    expect(await next.save.hasSaveGame()).toBe(false);
  }
  mockDisk.set('engine_save', JSON.stringify({ ...valid, version: valid.version - 1 }));
  expect(await next.save.loadGame()).toBe(false);
});

it.each(['map', 'lair', 'castle'])('permanently erases a Hardcore wipe in %s before the result can be shown', async where => {
  const app = await campaign();
  mockDisk.set('engine_audio', 'preferences');
  mockDisk.set('engine_achievements', 'profile');
  const dispose = fight(app, where);
  wipe(app);
  // Synchronous: no background save can write a live campaign from this moment.
  expect(app.game.getState().phase).toBe(GamePhase.RunOver);
  expect(app.run.getState().lossPersistence).toBe('pending');
  expect(app.run.getState().summary).toMatchObject({ encounter: where, highestLevel: Math.max(...app.party.getState().heroes.map(h => h.level)) });
  await app.save.saveOnAppStateChange('inactive');
  await flush();
  expect(app.run.getState().lossPersistence).toBe('done');
  expect(mockDisk.has('engine_save')).toBe(false);
  expect(mockDisk.get('engine_audio')).toBe('preferences');
  expect(mockDisk.get('engine_achievements')).toBe('profile');
  dispose();
  // App killed while the run-over screen is open, then started cold.
  const next = launch();
  expect(await next.save.hasSaveGame()).toBe(false);
  expect(await next.save.loadGame()).toBe(false);
});

it('keeps a single death revivable, but a surviving summon cannot prevent a party wipe', async () => {
  const app = await campaign();
  const dispose = fight(app);
  const before = mockDisk.get('engine_save');
  app.combat.getState().damageUnit('one', 999999);
  await flush();
  expect(app.run.getState().summary).toBeNull();
  expect(mockDisk.get('engine_save')).toBe(before);
  app.combat.getState().addUnits([makeUnit({ id: 'ally', summonedBy: 'one', heroId: undefined })]);
  app.combat.getState().damageUnit('two', 999999);
  await flush();
  expect(await app.save.hasSaveGame()).toBe(false);
  dispose();
});

it.each(['easy', 'medium', 'hard'] as const)('keeps a normal %s run on a wipe', async difficulty => {
  const app = await campaign(difficulty, false);
  const dispose = fight(app);
  wipe(app);
  await flush();
  expect(app.run.getState().summary).toBeNull();
  expect(await app.save.hasSaveGame()).toBe(true);
  dispose();
});

it('does not erase the real campaign for a tuning-harness wipe', async () => {
  const app = await campaign();
  const dispose = fight(app);
  app.sim.getState().enter();
  expect(app.run.getState()).toMatchObject({ difficulty: 'medium', hardcore: false });
  wipe(app);
  await flush();
  expect(app.run.getState().summary).toBeNull();
  expect(await app.save.hasSaveGame()).toBe(true);
  app.sim.getState().exit();
  expect(app.run.getState()).toMatchObject({ difficulty: 'hard', hardcore: true });
  dispose();
});

it('orders loss after an in-flight write and refuses all later background saves', async () => {
  const app = await campaign();
  const dispose = fight(app);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  mockWriteHold = () => held;
  const saving = app.save.saveGame();
  await flush();
  wipe(app);
  await app.save.saveOnAppStateChange('background');
  release();
  await saving;
  await flush();
  expect(app.run.getState().lossPersistence).toBe('done');
  expect(mockDisk.has('engine_save')).toBe(false);
  dispose();
});

it('cannot Continue after an app kill between the loss marker and save removal', async () => {
  const app = await campaign();
  const dispose = fight(app);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  mockRemoveHold = () => held;
  wipe(app);
  await flush();
  expect(JSON.parse(mockDisk.get('engine_save')!)).toEqual({ ended: true });
  dispose();
  const restarted = launch();
  expect(await restarted.save.hasSaveGame()).toBe(false);
  expect(await restarted.save.loadGame()).toBe(false);
  release();
  await flush();
});

it('keeps a failed deletion un-loadable, blocks saving and permits a retry', async () => {
  const app = await campaign();
  const dispose = fight(app);
  mockRemoveFails = true;
  wipe(app);
  await flush();
  expect(app.run.getState().lossPersistence).toBe('failed');
  expect(await app.save.hasSaveGame()).toBe(false);
  await app.save.saveGame();
  expect(JSON.parse(mockDisk.get('engine_save')!)).toEqual({ ended: true });
  mockRemoveFails = false;
  await app.hardcore.persistHardcoreLoss();
  expect(app.run.getState().lossPersistence).toBe('done');
  expect(mockDisk.has('engine_save')).toBe(false);
  dispose();
});
