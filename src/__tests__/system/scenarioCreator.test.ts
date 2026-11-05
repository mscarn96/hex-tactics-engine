import { buildScenario, defaultScenario } from '@/systems/sim/scenarioCreator';
import { isLoadable } from '@/systems/save/saveFormat';
import { QUEST_IDS, QUESTS } from '@/quests/questData';
import { startRecord } from '@/systems/quests/quests';
import { defaultHeroConfig } from '@/systems/sim/simHarness';
import { cancelTravelIntent, rememberTravelDestination, resumeTravelAfterVictory, takeTravelResume } from '@/utils/travelIntent';

it('builds reproducible, loadable recipes', () => {
  const recipe = { ...defaultScenario(), party: [defaultHeroConfig('warrior', 10), defaultHeroConfig('mage', 10)] };
  const a = buildScenario(recipe), b = buildScenario(recipe);
  expect(isLoadable(a.save)).toBe(true);
  expect(a).toEqual(b);
  expect(a.save.party.heroes).toHaveLength(2);
});

it('starts beside a named door, and refuses Jadeveil before the Emperor and unknown spent triggers', () => {
  const recipe = { ...defaultScenario(), party: [defaultHeroConfig('warrior', 20)] };
  expect(isLoadable(buildScenario({ ...recipe, start: 'castle' }).save)).toBe(true);
  expect(() => buildScenario({ ...recipe, world: 'jadeveil', start: 'gate' })).toThrow();
  expect(() => buildScenario({ ...recipe, spentTriggers: ['lair_warren:99,99'] })).toThrow();
  expect(() => buildScenario({ ...recipe, start: 'nowhere' })).toThrow();
});

it('rejects invalid party, overspent or wrong-class mastery and unknown equipment before writing anything', () => {
  const recipe = defaultScenario();
  expect(() => buildScenario({ ...recipe, party: [] })).toThrow();
  expect(() => buildScenario({ ...recipe, party: [{ ...defaultHeroConfig('mage', 20), masteryPath: 'templar' }] })).toThrow();
  expect(() => buildScenario({ ...recipe, party: [{ ...defaultHeroConfig('warrior', 5), masteryPath: 'templar', masteryNodes: ['templar_faith'] }] })).toThrow();
  expect(() => buildScenario({ ...recipe, party: [{ ...recipe.party[0], equipment: { mainHand: 'missing' } }] })).toThrow();
});

it('closes completed quest dependencies and rejects impossible objective counters', () => {
  const recipe = { ...defaultScenario(), party: [defaultHeroConfig('warrior', 20)] };
  const id = 'snares_and_stakes';
  const condition = QUESTS[id].unlockedBy!;
  const gate = condition.kind === 'all' ? condition.of.find(p => p.kind === 'questDone')! : condition;
  if (gate.kind !== 'questDone') throw new Error('Fixture gate');
  const built = buildScenario({ ...recipe, quests: { [id]: 'completed' } });
  expect(built.save.quests.completed).toContain(gate.quest);
  const first = QUEST_IDS[0];
  const active = startRecord(QUESTS[first]);
  expect(() => buildScenario({ ...recipe, quests: { [first]: { ...active, progress: active.progress.map(() => 100000) } } })).toThrow();
});

it('keeps travel cancellation across consecutive victories', () => {
  const destination = { q: 3, r: 4 };
  rememberTravelDestination(destination);
  expect(takeTravelResume()).toBeNull();
  resumeTravelAfterVictory(); expect(takeTravelResume()).toBeNull();
  expect(takeTravelResume()).toBeNull();
  rememberTravelDestination(destination); resumeTravelAfterVictory();
  expect(takeTravelResume()).toBeNull();
  rememberTravelDestination(destination); cancelTravelIntent(); resumeTravelAfterVictory();
  expect(takeTravelResume()).toBeNull();
});

it.each([true, false])('release/dev flag matrix denies tooling when development=%s and override=0', development => {
  jest.resetModules();
  Object.assign(globalThis, { __DEV__: development });
  process.env.ENGINE_DEV_TOOLS = '0';
  expect(require('@/utils/devTools').DEV_TOOLS).toBe(false);
  delete process.env.ENGINE_DEV_TOOLS;
  jest.resetModules();
  expect(require('@/utils/devTools').DEV_TOOLS).toBe(development);
});

it.each([true, false])('Save Creator follows the developer tools, or ENGINE_SAVE_CREATOR=1 in any build (development=%s)', development => {
  jest.resetModules();
  Object.assign(globalThis, { __DEV__: development });
  process.env.ENGINE_DEV_TOOLS = '0';
  expect(require('@/utils/devTools').SAVE_CREATOR).toBe(false);
  jest.resetModules();
  process.env.ENGINE_SAVE_CREATOR = '1';
  expect(require('@/utils/devTools').SAVE_CREATOR).toBe(true);
  delete process.env.ENGINE_SAVE_CREATOR;
  delete process.env.ENGINE_DEV_TOOLS;
  jest.resetModules();
  expect(require('@/utils/devTools').SAVE_CREATOR).toBe(development);
});
