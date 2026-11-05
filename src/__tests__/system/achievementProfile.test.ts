import { CombatPhase, GamePhase, Rarity, POIType } from '@/models/types';
import { makeUnit } from '../support/fixtures';

const mockDisk = new Map<string, string>();
let mockReadFails = false;
let mockWriteFails = false;
jest.mock('@/platform/keyValueStore', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => { if (mockReadFails) throw Error('read failed'); return mockDisk.get(key) ?? null; },
    setItem: async (key: string, value: string) => { if (mockWriteFails) throw Error('write failed'); mockDisk.set(key, value); },
    removeItem: async (key: string) => { mockDisk.delete(key); },
  },
}));

function launch() {
  jest.resetModules();
  return {
    profile: (require('@/stores/achievementStore') as typeof import('@/stores/achievementStore')).useAchievementStore,
    tracking: require('@/systems/progression/achievementEvents') as typeof import('@/systems/progression/achievementEvents'),
    battle: require('@/systems/progression/achievementBattle') as typeof import('@/systems/progression/achievementBattle'),
    bus: require('@/utils/achievementBus') as typeof import('@/utils/achievementBus'),
    save: require('@/systems/save/persistence') as typeof import('@/systems/save/persistence'),
    hardcore: require('@/systems/save/hardcore') as typeof import('@/systems/save/hardcore'),
    run: (require('@/stores/runSettingsStore') as typeof import('@/stores/runSettingsStore')).useRunSettingsStore,
    game: (require('@/stores/gameStore') as typeof import('@/stores/gameStore')).useGameStore,
    party: (require('@/stores/partyStore') as typeof import('@/stores/partyStore')).usePartyStore,
    bag: (require('@/stores/inventoryStore') as typeof import('@/stores/inventoryStore')).useInventoryStore,
    combat: (require('@/stores/combatStore') as typeof import('@/stores/combatStore')).useCombatStore,
    location: (require('@/stores/locationStore') as typeof import('@/stores/locationStore')).useLocationStore,
    world: (require('@/stores/worldMapStore') as typeof import('@/stores/worldMapStore')).useWorldMapStore,
    empire: (require('@/stores/empireStore') as typeof import('@/stores/empireStore')).useEmpireStore,
    quests: require('@/systems/quests/questEvents') as typeof import('@/systems/quests/questEvents'),
    locations: require('@/locations') as typeof import('@/locations'),
    items: require('@/data/items/itemTemplates') as typeof import('@/data/items/itemTemplates'),
    factory: require('@/systems/economy/itemFactory') as typeof import('@/systems/economy/itemFactory'),
  };
}
type App = ReturnType<typeof launch>;
async function campaign(difficulty: 'easy' | 'medium' | 'hard' = 'medium', hardcore = false) {
  const app = launch();
  await app.profile.getState().hydrate();
  app.tracking.installAchievementTracking();
  app.game.getState().startHeroSelect(42, { difficulty, hardcore });
  app.party.getState().addHero('warrior');
  app.game.getState().confirmHeroSelect('warrior');
  return app;
}
const units = (key: string) => [makeUnit({ id: `hero-${key}`, heroId: 'hero' }), makeUnit({ id: `foe-${key}`, isPlayer: false, currentHp: 0 })];
function win(app: App, key: string) {
  app.game.getState().startEncounter('road');
  app.battle.reportCampaignVictory(units(key), 'road');
}
async function flush() { await new Promise<void>(resolve => setImmediate(resolve)); }
beforeEach(() => { mockDisk.clear(); mockReadFails = false; mockWriteFails = false; });

it('real victories count once, save/load preserves the counter, and a new campaign keeps earned dates', async () => {
  const app = await campaign();
  for (let i = 0; i < 9; i++) { win(app, String(i)); win(app, String(i)); }
  expect(app.run.getState().achievementVictories).toHaveLength(9);
  expect(app.profile.getState().earned.roadward).toBeUndefined();
  const date = app.profile.getState().earned['still-standing'];
  app.game.getState().setPhase(GamePhase.WorldMap);
  await app.save.saveGame();
  await flush();
  const next = launch();
  await next.profile.getState().hydrate();
  next.tracking.installAchievementTracking();
  expect(await next.save.loadGame()).toBe(true);
  expect(next.profile.getState().notices).toEqual([]);
  win(next, 'last');
  expect(next.run.getState().achievementVictories).toHaveLength(10);
  expect(next.profile.getState().earned.roadward).toBeDefined();
  expect(next.profile.getState().earned['still-standing']).toBe(date);
  next.game.getState().startHeroSelect(43);
  next.party.getState().reset();
  next.bag.getState().reset();
  expect(next.run.getState().achievementVictories).toEqual([]);
  expect(next.profile.getState().earned['still-standing']).toBe(date);
});

it('Easy and harness actions cannot advance counters or earn achievements', async () => {
  const app = await campaign('easy');
  win(app, 'easy');
  app.bus.reportAchievement({ kind: 'castle' });
  expect(app.profile.getState().earned).toEqual({});
  expect(app.run.getState().achievementVictories).toEqual([]);
  app.run.getState().begin({ difficulty: 'hard', hardcore: true });
  const sim = (require('@/stores/simStore') as typeof import('@/stores/simStore')).useSimStore;
  sim.setState({ active: true });
  win(app, 'harness');
  app.bus.reportAchievement({ kind: 'lairs', cleared: 3 });
  expect(app.profile.getState().earned).toEqual({});
  expect(app.run.getState().achievementVictories).toEqual([]);
});

it('all lairs unlock from spent boss triggers, while repeated resolution never queues a second notice', async () => {
  const app = await campaign('hard', true);
  for (const id of ['lair_warren', 'lair_wyrm', 'lair_barrow'] as const) {
    app.location.getState().enter(id);
    app.location.getState().hold(app.locations.getLocation(id).lair!.bossAt);
    app.location.getState().resolvePending();
  }
  expect(app.profile.getState().earned['three-doors-shut']).toBeDefined();
  expect(app.profile.getState().earned['one-life-deep-breath']).toBeDefined();
  const notices = app.profile.getState().notices;
  app.location.getState().resolvePending();
  expect(app.profile.getState().notices).toBe(notices);
});

it('malformed victory counters are rejected as invalid current-version saves', async () => {
  const app = await campaign();
  await app.save.saveGame();
  const saved = JSON.parse(mockDisk.get('engine_save')!);
  for (const counter of [undefined, null, 10, ['same', 'same'], [42], Array.from({ length: 11 }, (_, i) => String(i))]) {
    mockDisk.set('engine_save', JSON.stringify({ ...saved, game: { ...saved.game, achievementVictories: counter } }));
    expect(await app.save.hasSaveGame()).toBe(false);
    expect(await app.save.loadGame()).toBe(false);
  }
});

it('earned Hardcore achievements survive a real wipe, disk deletion, and restart on Easy', async () => {
  const app = await campaign('hard', true);
  win(app, 'first');
  await flush();
  await app.save.saveGame();
  app.combat.getState().initCombat([makeUnit({ id: 'hero', heroId: 'hero' })], [makeUnit({ id: 'foe', isPlayer: false })]);
  app.hardcore.installHardcoreGuard();
  app.combat.getState().damageUnit('hero', 999999);
  await flush();
  expect(app.run.getState().lossPersistence).toBe('done');
  expect(mockDisk.has('engine_save')).toBe(false);
  const next = launch();
  await next.profile.getState().hydrate();
  next.game.getState().startHeroSelect(44, { difficulty: 'easy', hardcore: false });
  expect(next.profile.getState().earned['one-life-first-blood']).toBeDefined();
});

it('successful recruitment and mastery purchases emit; starters and refused actions do not', async () => {
  const app = await campaign();
  expect(app.profile.getState().earned).toEqual({});
  const warrior = app.party.getState().heroes[0];
  expect(app.party.getState().chooseMastery(warrior.id, 'bulwark')).toBe(false);
  app.location.getState().enter('lair_warren');
  app.location.getState().hold(app.locations.getLocation('lair_warren').lair!.bossAt);
  app.location.getState().resolvePending();
  app.party.getState().addHero('mage');
  expect(app.profile.getState().earned['a-second-chair']).toBeDefined();
  expect(app.profile.getState().earned['sparks-at-your-side']).toBeDefined();
  expect(app.profile.getState().earned['steel-at-your-side']).toBeUndefined();
  app.party.setState(s => ({ heroes: s.heroes.map(h => h.id === warrior.id ? { ...h, level: 5, masteryPoints: 5 } : h) }));
  expect(app.party.getState().chooseMastery(warrior.id, 'bulwark')).toBe(true);
  expect(app.party.getState().unlockMasteryNode(warrior.id, 'bulwark_spite')).toBe(true);
  expect(app.profile.getState().earned['a-path-of-your-own']).toBeDefined();
  expect(app.profile.getState().earned['first-lesson']).toBeDefined();
  const notices = app.profile.getState().notices;
  app.party.getState().addHero('mage');
  app.party.getState().chooseMastery(warrior.id, 'templar');
  expect(app.profile.getState().notices).toBe(notices);
});

it('real item acquisitions, well use, paid tribute and final castle completion unlock their milestones', async () => {
  const app = await campaign('hard');
  for (const rarity of [Rarity.Rare, Rarity.Epic, Rarity.Legendary]) {
    const template = app.items.itemTemplates.find(t => t.rarity === rarity)!;
    app.bag.getState().addItem(app.factory.mintItem(template, () => 0, 10));
  }
  app.world.getState().drinkMagicWell({ q: 1, r: 1 });
  app.empire.getState().settleWeek(1, 0);
  expect(app.profile.getState().earned['the-emperors-due']).toBeUndefined();
  app.empire.getState().settleWeek(2, 100);
  app.empire.getState().endCastleRun(true);
  expect(app.profile.getState().earned['no-more-tribute']).toBeUndefined();
  app.empire.setState({ castleTier: 1, castleStage: 3, emperorDefeated: true });
  app.empire.getState().endCastleRun(true);
  for (const id of ['worth-keeping', 'a-fine-find', 'a-story-in-steel', 'water-remembers', 'the-emperors-due', 'no-more-tribute', 'a-hard-crown']) {
    expect(app.profile.getState().earned[id]).toBeDefined();
  }
  expect(app.profile.getState().earned['one-life-no-emperor']).toBeUndefined();
});

it('peaceful site investigation and defeat never unlock combat site or victory achievements', async () => {
  const app = await campaign();
  app.quests.reportSiteInvestigated('quest_bell');
  app.quests.reportPoiCleared(POIType.QuestSite, 'quest_bell');
  app.combat.getState().setPhase(CombatPhase.Defeat);
  app.battle.reportCampaignVictory([makeUnit({ heroId: 'hero', currentHp: 0 })], 'road');
  expect(app.profile.getState().earned).toEqual({});
  app.quests.reportPoiCleared(POIType.QuestSite, 'quest_0');
  expect(app.profile.getState().earned['trouble-at-the-stones']).toBeDefined();
});

it('read failures do not overwrite an existing profile, and read/write retries preserve unlocks', async () => {
  mockDisk.set('engine_achievements', JSON.stringify({ 'still-standing': '2026-10-03T00:00:00.000Z' }));
  const app = launch();
  mockReadFails = true;
  await app.profile.getState().hydrate();
  expect(app.profile.getState().hydrated).toBe(false);
  expect(app.profile.getState().error).toBe('achievementsScreen.error.load');
  app.profile.getState().unlock(['a-full-table']);
  expect(JSON.parse(mockDisk.get('engine_achievements')!)).toEqual({ 'still-standing': '2026-10-03T00:00:00.000Z' });
  mockReadFails = false;
  await app.profile.getState().hydrate();
  mockWriteFails = true;
  app.profile.getState().unlock(['a-full-table']);
  await flush();
  expect(app.profile.getState().error).toBe('achievementsScreen.error.save');
  mockWriteFails = false;
  await app.profile.getState().retrySave();
  expect(app.profile.getState().error).toBeNull();
  expect(JSON.parse(mockDisk.get('engine_achievements')!)['a-full-table']).toBeDefined();
});

it('queued rapid unlock writes keep every entry and duplicate notices are suppressed', async () => {
  const app = await campaign();
  app.profile.getState().unlock(['still-standing']);
  app.profile.getState().unlock(['a-full-table']);
  app.profile.getState().unlock(['still-standing']);
  await flush();
  expect(Object.keys(JSON.parse(mockDisk.get('engine_achievements')!)).sort()).toEqual(['a-full-table', 'still-standing']);
  expect(app.profile.getState().notices).toEqual(['still-standing', 'a-full-table']);
});
