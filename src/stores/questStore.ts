import { createStore as create } from 'zustand/vanilla';
import { QuestEvent, QuestId } from '@/quests/types';
import { LocationId } from '@/locations/types';
import type { VillageTheme } from '@/data/villages';
import { defaultTrackedQuest } from '@/systems/quests/defaultQuestTracking';
import { creditClearedLairs, creditClearedQuestSites } from '@/systems/quests/questDestinationProgress';
import {
  QuestContext, QuestRecord, advanceStages, applyEvent, isFinished, questById, startRecord,
} from '@/systems/quests/quests';

/**
 * What the player has taken on, and how far along it is.
 *
 * The store keeps answers; `systems/quests.ts` works them out. Everything here
 * is a thin wrapper around a pure function, which is what lets the whole
 * progression be tested without a store at all.
 */
interface QuestState {
  active: Partial<Record<QuestId, QuestRecord>>;
  completed: QuestId[];
  /** The one whose objectives ride along on the world-map HUD. */
  tracked: QuestId | null;
  /**
   * A held village followed in a quest's place (playtest 2026-10-29): the journal's village notes
   * are not quests (`villageGarrison.villageNotes`), so the one being followed is kept beside
   * `tracked`. At most one of the two is set.
   */
  trackedVillage: VillageTheme | null;

  accept: (id: QuestId) => void;
  /**
   * Offer one thing that happened to every quest in flight.
   *
   * Broadcast rather than addressed: a kill does not know which quest wants it,
   * and making the caller work that out would put quest logic in the combat
   * scene. Quests that do not care return the record they were given, so an
   * irrelevant event costs one comparison per objective and no write.
   *
   * The context comes in as an argument rather than being read here: it is
   * assembled in `questEvents`, which already imports this store, and having
   * the store reach back for it would close the cycle.
   */
  report: (event: QuestEvent, ctx: QuestContext) => void;
  /**
   * Re-checks every quest in flight against the world as it is now.
   *
   * `collect` objectives read the bag rather than counting pickups, so they can
   * become satisfied with nothing reported at all — swept for the same reason
   * `ensureAutoQuests` is, and idempotent for the same reason.
   * One-shot destinations also recognise saved victories (exact lair boss, or
   * named site proof, or a cleared combat waypoint for a generic objective).
   */
  sync: (ctx: QuestContext, cleared?: readonly LocationId[], clearedSites?: readonly string[]) => void;
  /** Quests whose last stage is done and whose rewards are waiting. */
  readyToClaim: () => QuestId[];
  /** Moves it to `completed`. Paying out is the caller's job. */
  claim: (id: QuestId) => void;
  /** Follows a quest, dropping a followed village; null follows nothing. */
  track: (id: QuestId | null) => void;
  /** Follows a held village in place of a quest; null stops following it. */
  trackVillage: (theme: VillageTheme | null) => void;
  reset: () => void;
}

export const useQuestStore = create<QuestState>((set, get) => ({
  active: {},
  completed: [],
  tracked: null,
  trackedVillage: null,

  accept: (id) => {
    const { active, completed, tracked, trackedVillage } = get();
    if (active[id] || completed.includes(id)) return;
    const next = { ...active, [id]: startRecord(questById(id)) };
    set({
      active: next,
      // Preserve the player's selection, a followed village included; an empty strip picks an easier side contract.
      tracked: tracked ?? (trackedVillage ? null : defaultTrackedQuest(next)),
    });
  },

  report: (event, ctx) => {
    const { active } = get();
    let changed = false;
    const next: Partial<Record<QuestId, QuestRecord>> = {};
    for (const [id, record] of Object.entries(active) as [QuestId, QuestRecord][]) {
      const updated = applyEvent(questById(id), record, event, ctx);
      if (updated !== record) changed = true;
      next[id] = updated;
    }
    if (changed) set({ active: next });
  },

  sync: (ctx, cleared = [], clearedSites = []) => {
    const { active } = get();
    let changed = false;
    const next: Partial<Record<QuestId, QuestRecord>> = {};
    for (const [id, record] of Object.entries(active) as [QuestId, QuestRecord][]) {
      const quest = questById(id);
      const advanced = advanceStages(quest, record, ctx);
      const sites = creditClearedQuestSites(quest, advanced, clearedSites, ctx);
      const updated = creditClearedLairs(quest, sites, cleared, ctx);
      if (updated !== record) changed = true;
      next[id] = updated;
    }
    if (changed) set({ active: next });
  },

  readyToClaim: () => {
    const { active } = get();
    return (Object.entries(active) as [QuestId, QuestRecord][])
      .filter(([id, record]) => isFinished(questById(id), record))
      .map(([id]) => id);
  },

  claim: (id) => {
    const { active, completed, tracked } = get();
    if (!active[id] || completed.includes(id)) return;
    const rest = { ...active };
    delete rest[id];
    set({
      active: rest,
      completed: [...completed, id],
      // Hand off to an easier side contract; boss destinations need explicit tracking.
      tracked: tracked === id ? defaultTrackedQuest(rest) : tracked,
    });
  },

  track: (id) => set(id ? { tracked: id, trackedVillage: null } : { tracked: null }),

  trackVillage: (theme) => set(theme ? { trackedVillage: theme, tracked: null } : { trackedVillage: null }),

  reset: () => set({ active: {}, completed: [], tracked: null, trackedVillage: null }),
}));
