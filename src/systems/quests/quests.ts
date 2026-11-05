import { isQuestCombatSite } from '@/quests/sites';
import { Objective, Quest, QuestEvent, QuestId, QuestPredicate, QuestStage } from '@/quests/types';
import { huntHint } from '@/systems/quests/questHints';
import { objectiveLabel } from '@/systems/quests/objectiveLabel';
import { QUESTS, QUEST_IDS } from '@/quests/questData';
import { POIType, ResourceType } from '@/models/types';
import { contentBand } from '@/data/levelCap';
import { bandGateBase } from '@/systems/world/worldBands';

/**
 * The rules of a quest, with nothing around them.
 *
 * Every function here is pure — state in, state out — so the whole progression
 * can be driven from a test without a store, a screen or a fight. `questStore`
 * is a thin shell that calls these and keeps the answer.
 */

export interface QuestRecord {
  /** Index into `quest.stages`. */
  stage: number;
  /** One counter per objective of the current stage, in order. */
  progress: number[];
}

export interface QuestContext {
  /** Summed level of the whole party — see the note on `QuestPredicate`. */
  partyLevel: number;
  completed: readonly QuestId[];
  /** Quests in flight, by id. */
  active: Readonly<Partial<Record<QuestId, QuestRecord>>>;
  /** Boss lairs beaten — see `systems/lairs.ts`. */
  lairsCleared: number;
  /**
   * What is in the bag right now. See `objectiveHave` — `collect` is the one
   * objective measured as a stock rather than a flow.
   */
  held: Readonly<Partial<Record<ResourceType, number>>>;
  /** Jadeveil shrines claimed (`ascentStore.shrines`): what a `shrine` objective reads. */
  shrines: number;
}

export function questById(id: QuestId): Quest {
  return QUESTS[id];
}

export function startRecord(quest: Quest): QuestRecord {
  return { stage: 0, progress: quest.stages[0].objectives.map(() => 0) };
}

/** The summed level a `partyLevel` gate asks for now: over its world's band when it names one. */
export function partyLevelGate(gate: Extract<QuestPredicate, { kind: 'partyLevel' }>): number {
  const band = gate.over ? contentBand(gate.over) : null;
  return band !== null ? bandGateBase(band) + gate.total : gate.total;
}

export function satisfies(predicate: QuestPredicate, ctx: QuestContext): boolean {
  switch (predicate.kind) {
    case 'partyLevel':     return ctx.partyLevel >= partyLevelGate(predicate);
    case 'questDone':      return ctx.completed.includes(predicate.quest);
    case 'questActive':    return !!ctx.active[predicate.quest];
    case 'questAvailable': return isAvailable(predicate.quest, ctx);
    case 'lairsCleared':   return ctx.lairsCleared >= predicate.count;
    case 'not':            return !satisfies(predicate.of, ctx);
    case 'all':            return predicate.of.every((p) => satisfies(p, ctx));

    case 'questStage': {
      const record = ctx.active[predicate.quest];
      return !!record && record.stage === predicate.stage;
    }
    case 'questReady': {
      const record = ctx.active[predicate.quest];
      return !!record && isFinished(QUESTS[predicate.quest], record);
    }
  }
}

/** Offerable now: gate passed, not already running, not already done. */
export function isAvailable(id: QuestId, ctx: QuestContext): boolean {
  if (ctx.active[id] || ctx.completed.includes(id)) return false;
  const quest = QUESTS[id];
  return !quest.unlockedBy || satisfies(quest.unlockedBy, ctx);
}

export function availableQuests(ctx: QuestContext): Quest[] {
  return QUEST_IDS.filter((id) => isAvailable(id, ctx)).map(questById);
}

/** The context, read off the stores. Kept here so no caller assembles it by hand. */
export function questContext(
  partyLevel: number,
  store: { completed: QuestId[]; active: Partial<Record<QuestId, QuestRecord>> },
  lairsCleared = 0,
  held: Readonly<Partial<Record<ResourceType, number>>> = {},
  shrines = 0,
): QuestContext {
  return { partyLevel, completed: store.completed, active: store.active, lairsCleared, held, shrines };
}

/**
 * Quests that let themselves in.
 *
 * Returned rather than accepted here, because this file writes to nothing —
 * `questEvents.ensureAutoQuests` is what acts on it.
 */
export function autoAcceptable(ctx: QuestContext): QuestId[] {
  return QUEST_IDS.filter((id) => QUESTS[id].autoAccept && isAvailable(id, ctx));
}

/** How many of an objective are needed. `reach` and `talk` are one-and-done. */
export function objectiveTarget(objective: Objective): number {
  return objective.kind === 'reach' || objective.kind === 'talk' || objective.kind === 'investigate'
    || objective.kind === 'shrine' ? 1 : objective.count;
}

/**
 * How much a single report is worth against a single objective.
 *
 * Zero means "this event has nothing to do with this objective", which is the
 * common case — every kill in the game is offered to every active objective, and
 * the shape comparison is what filters it.
 */
export function eventValue(objective: Objective, event: QuestEvent): number {
  if (objective.kind !== event.kind) return 0;
  switch (objective.kind) {
    case 'kill':
      return objective.templates.includes((event as { template: any }).template)
        ? (event as { count?: number }).count ?? 1
        : 0;
    case 'collect':
      // Deliberately worth nothing. A `collect` objective reads the bag (see
      // `objectiveHave`), so counting the report as well would be counting the
      // same crystals twice — once as they arrive and once as they sit there.
      // `reportCollected` still matters: it is what prompts the re-evaluation.
      return 0;
    case 'shrine':
      // A stock, like `collect`: read off the chain in `objectiveHave`
      return 0;
    case 'clearPoi':
      return event.kind === 'clearPoi' && objective.poi === event.poi
        && (!objective.site || objective.site === event.site)
        && (objective.site || event.poi !== POIType.QuestSite || isQuestCombatSite(event.site)) ? 1 : 0;
    case 'investigate':
      return event.kind === 'investigate' && objective.site === event.site ? 1 : 0;
    case 'reach':
      return objective.location === (event as { location: any }).location ? 1 : 0;
    case 'talk':
      return objective.npc === (event as { npc: any }).npc ? 1 : 0;
  }
}

/**
 * What an objective counts right now.
 *
 * `collect` is the one objective measured as a **stock** rather than a flow.
 * "Bring me eight crystals" is a question about what is in the bag when you
 * walk up to the archivist, not about how many passed through it while the
 * quest happened to be open — and counting the flow meant a player holding
 * eight of them could not hand them over, because they had mined them before
 * taking the job. Crystals from a chest, a fight or the market never counted at
 * all, and spending some after collecting them still did.
 *
 * Everything else stays a flow, because everything else is an event that
 * happened and cannot be un-happened: a wolf you killed stays killed.
 */
export function objectiveHave(
  objective: Objective,
  stored: number,
  ctx: QuestContext,
): number {
  if (objective.kind === 'collect') return ctx.held[objective.resource] ?? 0;
  if (objective.kind === 'shrine') return ctx.shrines >= objective.index ? 1 : 0;
  return stored;
}

export function stageComplete(
  stage: QuestStage,
  progress: readonly number[],
  ctx: QuestContext,
): boolean {
  return stage.objectives.every(
    (o, i) => objectiveHave(o, progress[i] ?? 0, ctx) >= objectiveTarget(o),
  );
}

/** A record whose stage index has run off the end of the quest. */
export function isFinished(quest: Quest, record: QuestRecord): boolean {
  return record.stage >= quest.stages.length;
}

/**
 * Fold one report into one quest.
 *
 * Returns the same object when nothing moved, so a caller can skip a write —
 * every kill in the game passes through here for every active quest, and a new
 * record per irrelevant event would churn the store on every swing.
 *
 * Advancing a stage is part of applying the event rather than a separate call:
 * the kill that finishes a stage and the stage ending are one thing that
 * happened, and splitting them leaves a window where the log shows a stage with
 * every box ticked and no way forward.
 */
export function applyEvent(
  quest: Quest,
  record: QuestRecord,
  event: QuestEvent,
  ctx: QuestContext,
): QuestRecord {
  if (isFinished(quest, record)) return record;

  const stage = quest.stages[record.stage];
  let moved = false;
  const progress = stage.objectives.map((objective, i) => {
    const current = record.progress[i] ?? 0;
    const target = objectiveTarget(objective);
    if (current >= target) return current;
    const gain = eventValue(objective, event);
    if (gain <= 0) return current;
    moved = true;
    return Math.min(target, current + gain);
  });

  // `advanceStages` returns its argument untouched when nothing completed, so
  // an irrelevant event still comes back as the identical record
  return advanceStages(quest, moved ? { stage: record.stage, progress } : record, ctx);
}

/**
 * Move past every stage whose objectives are now satisfied.
 *
 * Split out of `applyEvent` because a stock objective completes without
 * anything happening: nobody *does* holding eight crystals, so there is no
 * event to fold and no moment the fold would have run. Swept instead — see
 * `questEvents.syncQuests`.
 *
 * Loops rather than stepping once: a stage gated on something already in the
 * bag is complete the instant the stage before it is, and stopping halfway
 * would leave the log showing a finished stage with no way forward — the same
 * failure `applyEvent` folds advancement in to avoid.
 */
export function advanceStages(
  quest: Quest,
  record: QuestRecord,
  ctx: QuestContext,
): QuestRecord {
  let out = record;
  while (!isFinished(quest, out) && stageComplete(quest.stages[out.stage], out.progress, ctx)) {
    const next = out.stage + 1;
    out =
      next >= quest.stages.length
        ? { stage: next, progress: out.progress }
        : { stage: next, progress: quest.stages[next].objectives.map(() => 0) };
  }
  return out;
}

export interface ObjectiveLine {
  label: string;
  have: number;
  need: number;
  done: boolean;
  hint: string | null;
  /** Set on a `collect` line, so a screen can draw the resource's icon beside the label. */
  resource?: ResourceType;
}

/** Objective lines for the log, and for the tracked-quest strip on the HUD. */
export function objectiveLines(
  quest: Quest,
  record: QuestRecord,
  ctx: QuestContext,
): ObjectiveLine[] {
  if (isFinished(quest, record)) return [];
  return quest.stages[record.stage].objectives.map((objective, i) => {
    const need = objectiveTarget(objective);
    const have = Math.min(need, objectiveHave(objective, record.progress[i] ?? 0, ctx));
    return {
      label: objectiveLabel(objective),
      have,
      need,
      done: have >= need,
      // Where to go and look, derived from the roster rather than authored — see
      // `questHints`. Carried on the line rather than fetched by the screen so
      // the log and any future tracker cannot disagree about it, and dropped
      // once the counter is full: a hint on a finished objective is noise.
      hint: have >= need ? null : huntHint(objective),
      ...(objective.kind === 'collect' ? { resource: objective.resource } : {}),
    };
  });
}
