import { POIType } from '@/models/types';
import { QuestEvent, QuestId } from '@/quests/types';
import {
  QuestContext,
  QuestRecord,
  applyEvent,
  eventValue,
  isFinished,
  objectiveTarget,
  questById,
} from '@/systems/quests/quests';
import { objectiveLabel } from '@/systems/quests/objectiveLabel';
import { questTitle } from '@/quests/questText';

/**
 * What a fight means to the quest log, said before and after it.
 *
 * A playtest could not tell whether the fight in front of it counted for
 * anything: the intro named the enemy and the victory card named the loot, and
 * the quest counter moved somewhere off screen. These are the two pure answers
 * the combat screen prints — "these are the ones you were sent for" on the way
 * in, "this is what it got you" on the way out.
 *
 * Pure: the active records come in as an argument. `previewVictory` folds the
 * very events `questEvents.reportVictory` / `reportPoiCleared` report, through
 * the same `applyEvent`, so what the victory card promises is what the log is
 * then written with (`battleQuests.test.ts` pins the two together).
 */

type ActiveRecords = Readonly<Partial<Record<QuestId, QuestRecord>>>;

/** The slice of a combat unit the tally reads. */
export interface FallenUnit {
  isPlayer: boolean;
  currentHp: number;
  templateId?: string;
}

/**
 * Every enemy that fell, by template, in first-seen order. A dead summon of the
 * party's own is a player unit and never counts toward a kill objective.
 */
export function killTally(units: readonly FallenUnit[]): [string, number][] {
  const tally = new Map<string, number>();
  for (const unit of units) {
    if (unit.isPlayer || unit.currentHp > 0 || !unit.templateId) continue;
    tally.set(unit.templateId, (tally.get(unit.templateId) ?? 0) + 1);
  }
  return [...tally];
}

/** The kill events a won fight reports, one per template. */
export function killEvents(units: readonly FallenUnit[]): QuestEvent[] {
  return killTally(units).map(([template, count]) => ({ kind: 'kill', template: template as any, count }));
}

/**
 * The map tile a fight was fought on, when it is one a win clears. Mirrors the
 * condition `applyVictory` reports `reportPoiCleared` under.
 */
export interface BattleSite {
  poi?: POIType;
  questId?: string;
}

export function siteEvent(site: BattleSite | null | undefined): QuestEvent | null {
  if (!site || (site.poi !== POIType.BossTile && site.poi !== POIType.QuestSite)) return null;
  return { kind: 'clearPoi', poi: site.poi, site: site.questId };
}

// ─── On the way in ──────────────────────────────────────────────────────────

export interface QuestTargetLine {
  quest: QuestId;
  questName: string;
  label: string;
  have: number;
  need: number;
  /** How many of the bodies in this fight (reinforcements included) count. */
  here: number;
}

/**
 * Unfinished kill objectives of active quests that this fight's enemies count
 * toward — the same reading `questEvents.huntedTemplates` makes of the log, with
 * a count of how many are standing in front of the party.
 */
export function questTargetsInBattle(
  active: ActiveRecords,
  templateIds: readonly string[],
): QuestTargetLine[] {
  const out: QuestTargetLine[] = [];
  for (const [id, record] of Object.entries(active) as [QuestId, QuestRecord | undefined][]) {
    if (!record) continue;
    const quest = questById(id);
    if (isFinished(quest, record)) continue;
    const stage = quest.stages[record.stage];
    stage.objectives.forEach((objective, i) => {
      if (objective.kind !== 'kill') return;
      const have = record.progress[i] ?? 0;
      if (have >= objective.count) return;
      const here = templateIds.filter((t) => (objective.templates as string[]).includes(t)).length;
      if (here === 0) return;
      out.push({ quest: id, questName: questTitle(id), label: objectiveLabel(objective), have, need: objective.count, here });
    });
  }
  return out;
}

/** "Orc Grunts 0/2 — 2 here", the intro's line for one target. */
export function questTargetText(line: QuestTargetLine): string {
  return `${line.label} ${line.have}/${line.need} — ${line.here} here`;
}

// ─── On the way out ─────────────────────────────────────────────────────────

export interface QuestProgressLine {
  quest: QuestId;
  questName: string;
  label: string;
  have: number;
  need: number;
  /** What this fight added to the counter. */
  gained: number;
  done: boolean;
}

export interface QuestProgressQuest {
  quest: QuestId;
  questName: string;
  lines: QuestProgressLine[];
  /** A stage this fight finished, the quest still running. */
  stageDone: boolean;
  /** The fight finished the last stage: the reward is waiting with the giver. */
  questDone: boolean;
}

export interface VictoryPreview {
  /** The records once every event is folded, exactly as the store will hold them. */
  active: Partial<Record<QuestId, QuestRecord>>;
  quests: QuestProgressQuest[];
}

/**
 * Folds a fight's events into the log without writing it, and says what moved.
 *
 * Events are folded in order and one at a time, the way `questStore.report`
 * receives them — so six goblins finishing a stage lets the two orcs after them
 * count toward the next one, here as in the store.
 */
export function previewVictory(
  active: ActiveRecords,
  events: readonly QuestEvent[],
  ctx: QuestContext,
): VictoryPreview {
  const next: Partial<Record<QuestId, QuestRecord>> = { ...active };
  const quests: QuestProgressQuest[] = [];

  for (const [id, start] of Object.entries(active) as [QuestId, QuestRecord | undefined][]) {
    if (!start) continue;
    const quest = questById(id);
    const lines = new Map<string, QuestProgressLine>();
    let record = start;

    for (const event of events) {
      if (isFinished(quest, record)) break;
      const stage = quest.stages[record.stage];
      stage.objectives.forEach((objective, i) => {
        const current = record.progress[i] ?? 0;
        const need = objectiveTarget(objective);
        const value = eventValue(objective, event);
        if (current >= need || value <= 0) return;
        const have = Math.min(need, current + value);
        const key = `${record.stage}:${i}`;
        const prior = lines.get(key);
        lines.set(key, {
          quest: id,
          questName: questTitle(id),
          label: objectiveLabel(objective),
          have,
          need,
          gained: (prior?.gained ?? 0) + (have - current),
          done: have >= need,
        });
      });
      record = applyEvent(quest, record, event, ctx);
    }

    next[id] = record;
    if (lines.size === 0) continue;
    const questDone = isFinished(quest, record) && !isFinished(quest, start);
    quests.push({
      quest: id,
      questName: questTitle(id),
      lines: [...lines.values()],
      stageDone: !questDone && record.stage > start.stage,
      questDone,
    });
  }

  return { active: next, quests };
}

/** "Orc Grunts 2/2 ✔" or "Wolves 3/5 (+2)", the victory card's line for one counter. */
export function questProgressText(line: QuestProgressLine): string {
  return line.done
    ? `${line.label} ${line.have}/${line.need} ✔`
    : `${line.label} ${line.have}/${line.need} (+${line.gained})`;
}
