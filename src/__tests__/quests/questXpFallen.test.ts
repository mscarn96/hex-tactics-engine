import { QUESTS, QUEST_IDS } from '@/quests/questData';
import { makeHero } from '../support/fixtures';
import { claimQuest } from '@/systems/quests/questEvents';
import { useQuestStore } from '@/stores/questStore';
import { usePartyStore } from '@/stores/partyStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { useCityStore } from '@/stores/cityStore';

/**
 * A quest's XP is the whole party's (playtest 2026-10-30): a hero who fell in the
 * last fight still shares it. Only a fight pays its survivors alone
 * (`encounterResolution.applyVictory`).
 */
it('pays quest XP to every hero, a fallen one included', () => {
  const id = QUEST_IDS.find((q) => (QUESTS[q].rewards.xp ?? 0) > 0
    && QUESTS[q].stages.every((s) => s.objectives.every((o) => o.kind !== 'collect')))!;
  const standing = makeHero({ id: 'standing', level: 3, xp: 0 });
  const fallen = makeHero({ id: 'fallen', level: 3, xp: 0, currentHp: 0 });
  usePartyStore.getState().reset();
  usePartyStore.setState({ heroes: [standing, fallen] });
  useInventoryStore.getState().reset();
  useCityStore.getState().reset();
  useQuestStore.getState().reset();
  useQuestStore.setState({ active: { [id]: { stage: QUESTS[id].stages.length, progress: [] } } });

  claimQuest(id);

  const after = usePartyStore.getState().heroes;
  const gained = (heroId: string) => {
    const hero = after.find((h) => h.id === heroId)!;
    return hero.level > 3 || hero.xp > 0;
  };
  expect(gained('standing')).toBe(true);
  expect(gained('fallen')).toBe(true);
  expect(after.find((h) => h.id === 'fallen')!.xp).toBe(after.find((h) => h.id === 'standing')!.xp);
});
