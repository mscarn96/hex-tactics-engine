import { createStore as create } from 'zustand/vanilla';
import type { MotifId } from '@/models/types';
import { useCalendarStore } from '@/stores/calendarStore';
import { useWorldBandStore } from '@/stores/worldBandStore';
import { BALANCE } from '@/data/balanceConstants';
import type { BlessingId } from '@/data/monastery';
import {
  awardWrath, NO_WRATH, wrathAwardNews, wrathNewsText, type WrathAward, type WrathNews, type WrathSource, type WrathState,
} from '@/systems/world/wrath';
import { NO_VOWS, takeVow, type Vows } from '@/systems/world/monastery';
import { SHRINE_COUNT } from '@/systems/world/shrines';
import { shrineClaimedNotice } from '@/systems/world/rangeSites';
import {
  canEnterSummit, clampStormTier, NO_SUMMIT, stormSealRewardFor, summitSpendsSeal, type SummitState,
} from '@/systems/world/summit';
import { motifWorld } from '@/data/items/worldGear';
import { t, type MessageKey, type MessageParams } from '@/i18n';
import { npcName } from '@/quests/npcText';

/** What banking a Kairen kill did: whether it was the first (the story's), and the Seal it paid. */
export interface SummitClear {
  firstKill: boolean;
  sealTier: number;
}

/**
 * What the map has to say about a gain: what a wrath award changed for good,
 * or the shrine just claimed — kept as values and worded when shown, by
 * `ascentNewsText`.
 */
export type AscentNews = WrathNews | { shrineClaimed: number } | { kairenSlain: true } | { key: MessageKey; params?: MessageParams };

/** The news as the map's toast says it, in the current language. */
export function ascentNewsText(news: AscentNews): string {
  if ('key' in news) return t(news.key, news.params);
  if ('shrineClaimed' in news) return shrineClaimedNotice(news.shrineClaimed);
  if ('kairenSlain' in news) return t('worldEvents.news.kairenSlain', { toma: npcName('exile_monk'), ivane: npcName('archivist') });
  return wrathNewsText(news);
}

/**
 * Jadeveil's own progression, campaign-wide: the wrath stamp, the
 * monastery's vows and the shrines claimed (`shrines.ts`).
 *
 * Global rather than per world, like the party and the clock: there is one
 * range and one monastery, and wrath decays with the shared clock wherever the
 * party is — a trip to the city is a lull. Imports only the calendar and pure
 * rules, so any store can read it without closing a cycle.
 */
interface AscentState {
  wrath: WrathState;
  vows: Vows;
  /** Shrines claimed, in order up the chain: 0–4. Permanent; wrath never touches it. */
  shrines: number;
  /**
   * What the last gain changed for good — a floor, the summit opening — waiting
   * for the world map to say it. Not saved: it is news, and the map reads it on
   * its next mount when the gain came from inside a fight or a lair.
   */
  news: AscentNews | null;
  clearNews: () => void;
  /** Add a Jadeveil source's gain at the current hour; returns what it did. */
  gainWrath: (source: WrathSource) => WrathAward;
  /** Take or change a vow: true when it was legal (`takeVow`). The caller pays any hours. */
  vow: (ring: number, blessing: BlessingId) => boolean;
  /** Claim shrine `index`: true only for the next in the chain. Sets the news of what it opened. */
  claimShrine: (index: number) => boolean;
  summit: SummitState;
  /**
   * Walk up to Kairen at `tier`: true when the door is open (`canEnterSummit`), and the
   * Storm Seal of a tier above the first is spent here, on the way in, win or lose.
   */
  enterSummit: (tier: number, windowOpen: boolean) => boolean;
  /**
   * Bank a Kairen kill at `tier`: the first ever is the story's (`firstKill`); every kill
   * pays the Seal one tier up, capped, and raises the highest tier cleared.
   */
  clearSummit: (tier: number) => SummitClear;
  /**
   * Spirit Ink: the range's crafting material (`systems/economy/jadeveilRewards.ts`),
   * paid by Jadeveil's fights, shrines, lairs and summit and spent at the forge on
   * Jadeveil's motifs and collections. Kept here rather than in the inventory's
   * resources, for the reason Obsidian Crystals are kept on `empireStore`: a siege
   * loss clears the treasury, and the range's chase should not ride on the city's.
   */
  ink: number;
  addInk: (amount: number) => void;
  /** Spends `amount` Ink, or changes nothing and returns false. */
  spendInk: (amount: number) => boolean;
  /**
   * The Jadeveil motifs and collections the forge has learned (`learnPattern`) —
   * one the party has held a piece of. A recipe for a world motif waits for its
   * pattern (`forge.canForge`), so a level-3 forge cannot craft the range's
   * catalogue the day the party arrives.
   */
  patterns: MotifId[];
  /** Learns a motif's pattern; a motif already known, or one that is not a world's, changes nothing. */
  learnPattern: (motif: MotifId) => void;
  reset: () => void;
}

export const useAscentStore = create<AscentState>((set, get) => ({
  wrath: NO_WRATH,
  vows: NO_VOWS,
  shrines: 0,
  news: null,
  clearNews: () => set({ news: null }),

  gainWrath: (source) => {
    const award = awardWrath(get().wrath, useCalendarStore.getState().totalHours, BALANCE.WRATH_GAIN[source]);
    set({ wrath: award.state, news: wrathAwardNews(award) ?? get().news });
    return award;
  },

  vow: (ring, blessing) => {
    const next = takeVow(get().vows, ring, blessing, get().wrath.floor);
    if (!next) return false;
    set({ vows: next });
    return true;
  },

  claimShrine: (index) => {
    if (index !== get().shrines + 1 || index > SHRINE_COUNT) return false;
    set({ shrines: index, news: { shrineClaimed: index } });
    return true;
  },

  summit: NO_SUMMIT(),

  enterSummit: (tier, windowOpen) => {
    const t = clampStormTier(tier);
    const { summit } = get();
    if (!canEnterSummit(t, summit.seals, summit.slain, windowOpen)) return false;
    if (summitSpendsSeal(t)) set({ summit: { ...summit, seals: summit.seals.map((n, i) => (i === t - 1 ? n - 1 : n)) } });
    return true;
  },

  clearSummit: (tier) => {
    const t = clampStormTier(tier);
    const { summit } = get();
    const sealTier = stormSealRewardFor(t);
    set({
      summit: {
        slain: true,
        seals: summit.seals.map((n, i) => (i === sealTier - 1 ? n + 1 : n)),
        highestTier: Math.max(summit.highestTier, t),
      },
    });
    // Kairen's first kill finishes Jadeveil, and that opens the next road and raises the cap
    if (!summit.slain) useWorldBandStore.getState().finish('jadeveil');
    return { firstKill: !summit.slain, sealTier };
  },

  ink: 0,
  addInk: (amount) => {
    if (amount > 0) set({ ink: get().ink + amount });
  },
  spendInk: (amount) => {
    if (amount < 0 || get().ink < amount) return false;
    set({ ink: get().ink - amount });
    return true;
  },

  patterns: [],
  learnPattern: (motif) => {
    if (!motifWorld(motif) || get().patterns.includes(motif)) return;
    set({ patterns: [...get().patterns, motif] });
  },

  reset: () => set({ wrath: NO_WRATH, vows: NO_VOWS, shrines: 0, news: null, summit: NO_SUMMIT(), ink: 0, patterns: [] }),
}));
