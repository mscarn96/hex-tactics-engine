import { QuestId } from '@/quests/types';
import { QuestRecord } from './quests';
import { isLairContract } from './campaignGoal';
import { questLevelFloor } from './questLeads';

/** Boss contracts need an explicit Track press; automatic handoffs favour easier errands. */
export function defaultTrackedQuest(active: Partial<Record<QuestId, QuestRecord>>): QuestId | null {
  return (Object.keys(active) as QuestId[])
    .filter(id => !isLairContract(id) && id !== 'the_obsidian_ledger')
    .sort((a, b) => questLevelFloor(a) - questLevelFloor(b))[0] ?? null;
}
