import { isQuestCombatSite } from '@/quests/sites';
import { LAIR_SPECS } from '@/locations/lairs';
import { LocationId } from '@/locations/types';
import { Quest } from '@/quests/types';
import { POIType } from '@/models/types';
import { QuestContext, QuestRecord, advanceStages, applyEvent, isFinished } from './quests';

/**
 * Lairs are one-shot destinations. A contract taken after its boss victory must
 * not ask for a second kill the player can never make. Credit only the current
 * stage naming both this exact lair and its boss; ordinary hunts remain flows.
 */
export function creditClearedLairs(
  quest: Quest, record: QuestRecord, cleared: readonly LocationId[], ctx: QuestContext,
): QuestRecord {
  if (isFinished(quest, record)) return record;
  let out = record;
  for (const spec of LAIR_SPECS) {
    if (!cleared.includes(spec.id) || isFinished(quest, out)) continue;
    const stage = quest.stages[out.stage];
    if (!stage.objectives.some(o => o.kind === 'reach' && o.location === spec.id)
      || !stage.objectives.some(o => o.kind === 'kill' && o.templates.includes(spec.boss))) continue;
    const index = out.stage;
    out = applyEvent(quest, out, { kind: 'reach', location: spec.id }, ctx);
    if (out.stage === index) out = applyEvent(quest, out, { kind: 'kill', template: spec.boss }, ctx);
  }
  return out;
}

/** Exact named proof or any combat waypoint for a generic objective; never count peaceful clues as fights. */
export function creditClearedQuestSites(
  quest: Quest, record: QuestRecord, cleared: readonly string[], ctx: QuestContext,
): QuestRecord {
  if (!cleared.length || isFinished(quest, record)) return record;
  let moved = false;
  const progress = quest.stages[record.stage].objectives.map((objective, i) => {
    const stored = record.progress[i] ?? 0;
    const count = objective.kind === 'investigate'
      ? Number(cleared.includes(objective.site))
      : objective.kind === 'clearPoi' && objective.poi === POIType.QuestSite
        ? Math.min(objective.count, objective.site ? Number(cleared.includes(objective.site)) : cleared.filter(isQuestCombatSite).length)
        : 0;
    const have = Math.max(stored, count);
    if (have !== stored) moved = true;
    return have;
  });
  return moved ? advanceStages(quest, { stage: record.stage, progress }, ctx) : record;
}
