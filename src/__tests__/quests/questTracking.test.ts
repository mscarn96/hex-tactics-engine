import { useQuestStore } from '@/stores/questStore';
import { lairContract } from '@/systems/quests/campaignGoal';
import { QUEST_IDS, QUESTS } from '@/quests/questData';

beforeEach(() => useQuestStore.getState().reset());

it('does not auto-track a lair, and hands off to an easier side contract', () => {
  const lair = lairContract('lair_warren')!;
  const side = QUEST_IDS.filter(id => id !== lair && !QUESTS[id].autoAccept
    && !QUESTS[id].stages.some(s => s.objectives.some(o => o.kind === 'reach'))).slice(0, 2);
  const store = useQuestStore.getState();
  store.accept(lair);
  expect(useQuestStore.getState().tracked).toBeNull();
  store.accept(side[0]);
  store.accept(side[1]);
  store.claim(side[0]);
  expect(useQuestStore.getState().tracked).toBe(side[1]);
  store.claim(side[1]);
  expect(useQuestStore.getState().tracked).toBeNull();
});

it('preserves a manually tracked lair while accepting or claiming side quests', () => {
  const lair = lairContract('lair_warren')!;
  const side = QUEST_IDS.find(id => id !== lair)!;
  const store = useQuestStore.getState();
  store.accept(lair);
  store.track(lair);
  store.accept(side);
  store.claim(side);
  expect(useQuestStore.getState().tracked).toBe(lair);
});

it('hands off to the lowest strength floor even when a harder side quest was accepted first', () => {
  const store = useQuestStore.getState();
  store.accept('a_word_with_the_trapper');
  store.accept('the_roadwardens');
  store.accept('wolves_at_the_gate');
  store.claim('a_word_with_the_trapper');
  expect(useQuestStore.getState().tracked).toBe('wolves_at_the_gate');
});
