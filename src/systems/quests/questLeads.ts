import { QUESTS, QUEST_IDS } from '@/quests/questData';
import { QuestId, QuestPredicate } from '@/quests/types';
import { questTitle } from '@/quests/questText';
import { t } from '@/i18n';
import { QuestContext, isAvailable, partyLevelGate, satisfies } from './quests';

/** Inspect compound gates without dropping their level floor from content audits. */
export function questLevelFloor(id: QuestId): number {
  const floor = (gate: QuestPredicate): number => gate.kind === 'partyLevel' ? partyLevelGate(gate)
    : gate.kind === 'all' ? Math.max(0, ...gate.of.map(floor)) : 0;
  const gate = QUESTS[id].unlockedBy;
  return gate ? floor(gate) : 0;
}

/** The unmet parts of a gate, shared by the log and campaign audits. */
export function unmetQuestGates(id: QuestId, ctx: QuestContext): QuestPredicate[] {
  const unmet = (gate: QuestPredicate): QuestPredicate[] => {
    if (satisfies(gate, ctx)) return [];
    return gate.kind === 'all' ? gate.of.flatMap(unmet) : [gate];
  };
  const gate = QUESTS[id].unlockedBy;
  return gate ? unmet(gate) : [];
}

export function questUnlockSteps(id: QuestId, ctx: QuestContext): string[] {
  const describe = (gate: QuestPredicate): string => {
    switch (gate.kind) {
      case 'partyLevel': return t('campaign.lead.partyLevel', { total: partyLevelGate(gate), now: ctx.partyLevel });
      case 'questDone': return t('campaign.lead.questDone', { quest: questTitle(gate.quest) });
      case 'lairsCleared': return t('campaign.lead.lairs', { count: gate.count - ctx.lairsCleared });
      default: return t('campaign.lead.other');
    }
  };
  return unmetQuestGates(id, ctx).map(describe);
}

/** A short preview, ordered by story steps first, then strength still needed. */
export const UPCOMING_SHOWN = 3;

export function upcomingQuests(ctx: QuestContext): QuestId[] {
  const rank = (id: QuestId, seen: readonly QuestId[] = []): { story: number; levels: number } => {
    if (seen.includes(id)) return { story: Infinity, levels: Infinity };
    const gates = unmetQuestGates(id, ctx);
    return {
      story: gates.reduce((n, g) => n + (g.kind === 'questDone'
        ? 1 + (ctx.active[g.quest] ? 0 : rank(g.quest, [...seen, id]).story)
        : g.kind === 'lairsCleared' ? g.count - ctx.lairsCleared : g.kind === 'partyLevel' ? 0 : 1), 0),
      levels: gates.reduce((n, g) => n + (g.kind === 'partyLevel' ? partyLevelGate(g) - ctx.partyLevel : 0), 0),
    };
  };
  return QUEST_IDS
    .filter(id => !QUESTS[id].autoAccept && !ctx.active[id] && !ctx.completed.includes(id) && !isAvailable(id, ctx))
    .sort((a, b) => {
      const ar = rank(a), br = rank(b);
      return ar.story - br.story || ar.levels - br.levels;
    })
    .slice(0, UPCOMING_SHOWN);
}
