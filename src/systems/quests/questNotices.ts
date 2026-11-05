import { QuestId } from '@/quests/types';
import { QuestRecord, isFinished, questById } from '@/systems/quests/quests';
import { NPCS } from '@/quests/npcData';
import { npcName, npcWhere } from '@/quests/npcText';
import { objectiveLabel } from '@/systems/quests/objectiveLabel';
import { questStageSummary, questTitle } from '@/quests/questText';
import { t } from '@/i18n';

/**
 * The quest log, saying something out loud.
 *
 * The log is a tracker and nothing else — that rule is deliberate and stays.
 * What it left open is that **taking a quest on and finishing one both happen
 * somewhere the log is not**: a quest is accepted mid-conversation and a counter
 * is finished mid-fight, and in both cases the only record of it is a screen the
 * player has to think to open. A playtest reads that as nothing having happened.
 *
 * So this is one narrow channel: the log reports what changed, in the player's
 * own words, and whichever scene is on screen says it.
 *
 * **A module-level bus, the `shakeCamera` idiom.** The two ends are a pure
 * system and a React widget, and the alternative — a store, or props threaded
 * through three scenes — is state that has to be persisted, reset and kept out
 * of the save for something that lives for two seconds.
 *
 * **Notices survive the scene that produced them, and that is the design.** A
 * kill that finishes a stage happens in combat, and the designer's call is that a
 * counter ticking must not interrupt a fight. Nothing drains the queue until a
 * scene that shows notices mounts — so the fight stays quiet and the news is
 * waiting on the world map, which is where the player is standing when they next
 * have a decision to make.
 */

export type QuestNoticeKind = 'accepted' | 'progress' | 'stage' | 'ready';

/**
 * What changed, kept as ids rather than words: a notice can wait in the queue
 * across a fight and a language change, so its sentence is made when it is
 * shown, by `questNoticeText`.
 */
export type QuestNotice =
  | { kind: 'accepted' | 'ready'; quest: QuestId }
  | { kind: 'stage'; quest: QuestId; stage: number }
  /** Counter `objective` of stage `stage` moved to `have` of `need`. */
  | { kind: 'progress'; quest: QuestId; stage: number; objective: number; have: number; need: number };

/**
 * A long fight against a quest target can finish a counter, a stage and the
 * quest itself, several times over. Past a handful the player is reading a wall
 * rather than a notice, so the queue keeps the **oldest** — the first thing that
 * happened is the one that explains the rest.
 */
const MAX_QUEUED = 5;

let queue: QuestNotice[] = [];
const listeners = new Set<() => void>();

export function pushQuestNotice(notice: QuestNotice): void {
  if (queue.length >= MAX_QUEUED) return;
  queue.push(notice);
  for (const fn of listeners) fn();
}

/** Takes everything waiting and empties the queue. */
export function drainQuestNotices(): QuestNotice[] {
  if (queue.length === 0) return [];
  const out = queue;
  queue = [];
  return out;
}

/** Returns an unsubscribe, so a widget can clean up on unmount. */
export function subscribeQuestNotices(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Drops anything queued. For a new game or a load — news about a quest log that
 * no longer exists is worse than silence.
 */
export function resetQuestNotices(): void {
  queue = [];
}

// ─── Working out what changed ────────────────────────────────────────────────

/** Everything the diff needs, and nothing that would tie it to the store. */
export interface QuestLogSnapshot {
  active: Readonly<Partial<Record<QuestId, QuestRecord>>>;
  completed: readonly QuestId[];
}

export function questLogSnapshot(state: QuestLogSnapshot): QuestLogSnapshot {
  return { active: state.active, completed: state.completed };
}

/**
 * A notice in the current language. A finished quest names where to take it
 * back to, in the words the log already uses; a counter is the short form of
 * its objective's own label, plus the count.
 */
export function questNoticeText(notice: QuestNotice): string {
  const quest = questTitle(notice.quest);
  switch (notice.kind) {
    case 'accepted':
      return t('campaign.notice.accepted', { quest });
    case 'ready': {
      const giver = questById(notice.quest).giver;
      return NPCS[giver]
        ? t('campaign.notice.ready', { quest, name: npcName(giver), where: npcWhere(giver) })
        : t('campaign.notice.readyUnknown', { quest });
    }
    case 'stage':
      return questById(notice.quest).stages[notice.stage]
        ? t('campaign.notice.stage', { quest, summary: questStageSummary(notice.quest, notice.stage) })
        : t('campaign.notice.nextStage', { quest });
    case 'progress': {
      const objective = questById(notice.quest).stages[notice.stage]?.objectives[notice.objective];
      const label = objective ? objectiveLabel(objective) : quest;
      return t('campaign.notice.progress', { label, have: Math.min(notice.have, notice.need), need: notice.need });
    }
  }
}

/**
 * What is worth saying about the difference between two states of the log.
 *
 * Pure, and takes both snapshots rather than reading the store, so the whole
 * vocabulary is exercisable in a node test — the same split every other rule in
 * `systems/quests/` follows.
 *
 * Deliberately quiet in three places:
 *  - a quest that finished is announced **once**, as `ready`, and its last stage
 *    is not also announced — "stage complete" and "the quest is done" are the
 *    same event said twice.
 *  - progress is reported only on the counter that actually moved, and never on
 *    the report that completes a stage: the stage line supersedes it.
 *  - a claim (a quest leaving `active` for `completed`) says nothing at all. The
 *    player is standing in front of the person who just paid them.
 */
export function noticesForChange(
  before: QuestLogSnapshot,
  after: QuestLogSnapshot,
): QuestNotice[] {
  const out: QuestNotice[] = [];

  for (const [key, record] of Object.entries(after.active) as [QuestId, QuestRecord][]) {
    if (!record) continue;
    const quest = questById(key);
    const was = before.active[key];

    if (!was) {
      out.push({ kind: 'accepted', quest: key });
      continue;
    }
    if (was === record) continue;

    const done = isFinished(quest, record);
    if (done && !isFinished(quest, was)) {
      out.push({ kind: 'ready', quest: key });
      continue;
    }
    if (done) continue;

    if (record.stage !== was.stage) {
      out.push({ kind: 'stage', quest: key, stage: record.stage });
      continue;
    }

    // Same stage, so the counters line up one for one with its objectives.
    const stage = quest.stages[record.stage];
    if (!stage) continue;
    stage.objectives.forEach((objective, i) => {
      const now = record.progress[i] ?? 0;
      const then = was.progress[i] ?? 0;
      if (now <= then) return;
      // A `collect` counter is a stock read off the bag rather than a flow, so
      // it moves both ways as items are spent — only the count matters, and
      // only when it goes up.
      const need = 'count' in objective ? objective.count : 1;
      out.push({ kind: 'progress', quest: key, stage: record.stage, objective: i, have: now, need });
    });
  }

  return out;
}
