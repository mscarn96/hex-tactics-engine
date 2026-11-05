import { createStore as create } from 'zustand/vanilla';
import { reportAchievement } from '@/utils/achievementBus';
import { BALANCE } from '@/data/balanceConstants';
import { setLevelCapInputs } from '@/data/levelCap';
import { canEnterCastle, castleSpendsSeal, clampTier, CASTLE_STAGE_COUNT } from '@/systems/world/castle';
import {
  canEnterHeart, clampHeartTier, heartSpendsSeal, NO_HEART_LADDER, winterSealRewardFor,
} from '@/systems/world/heartRefight';

/**
 * The Obsidian Empire's hold over the game.
 *
 * A seventh store rather than fields bolted onto `gameStore`: the tribute
 * ledger, the siege and (later) the castle gauntlet are one concern with one
 * persisted shape, and none of it belongs to the phase machine.
 *
 * Deliberately holds no gold and no army. It records what the Empire has
 * *decided* — what has been settled, what is pending, whether Aethelred still
 * draws breath — and leaves the money to `inventoryStore` and the fighting to
 * `combatStore`.
 */
interface EmpireState {
  /**
   * Last week whose rent was resolved, paid or not.
   *
   * The guard against double-charging. Settlement is driven by walking the map,
   * and a single journey can cross a week boundary — or a save can be reloaded
   * mid-week — so "have I already dealt with week 4" has to be a stored fact
   * rather than something inferred from the calendar.
   */
  lastSettledWeek: number;
  /** Weeks of rent actually paid, for the ledger. */
  tributePaid: number;
  /** Total gold handed to the Empire. */
  goldPaid: number;
  /** Sieges fought, won or lost. */
  siegesFought: number;
  /** Set when Aethelred falls. Stops the tribute permanently. */
  emperorDefeated: boolean;

  // ── The castle gauntlet ────────────────────────────────────────────────────
  /**
   * Tier of the run in progress, or null when no run is under way.
   *
   * The presence of this is what makes the gauntlet a gauntlet: `applyVictory`
   * reads it to decide whether to advance a stage or hand back the world map.
   */
  castleTier: number | null;
  /** Stage of the run in progress, 0-indexed. Meaningless without `castleTier`. */
  castleStage: number;
  /**
   * Obsidian Seals held, indexed by tier − 1.
   *
   * A Seal is **spent on entry**, not on victory. A tier you can grind until the
   * dice cooperate is a tier you are not actually strong enough for; the
   * craftable bottom rung is what stops that being a dead end.
   */
  seals: number[];
  /** Whether tier 1 has ever been cleared. Gates the one free entry. */
  castleCleared: boolean;
  /** Deepest tier ever cleared, for the ledger. */
  deepestTier: number;
  /**
   * Obsidian Crystals held.
   *
   * Kept here rather than in `inventoryStore.resources` on purpose: a siege loss
   * calls `clearResources`, and wiping the currency that upgrades legendaries
   * would make one bad week cost far more than the design says it does.
   */
  crystals: number;

  // ── The Heart of Winter's refight ──────────────────────────────────────────
  /**
   * Winter Seals held, indexed by tier − 1 (`heartRefight.ts`). The Heart's own ladder:
   * Obsidian Seals do not open it and these open nothing else.
   */
  winterSeals: number[];
  /** The highest Heart tier cleared; the lair's own kill counts as tier 1. 0 before it. */
  heartTier: number;

  /** Records a settled week. `gold` is zero when the rent went unpaid. */
  settleWeek: (week: number, gold: number) => void;
  recordSiege: () => void;
  setEmperorDefeated: (defeated: boolean) => void;

  /** Spends the Seal and starts the run. Tier 1 is free until first cleared. */
  beginCastleRun: (tier: number) => void;
  advanceCastleStage: () => void;
  /** Ends the run either way — cleared or thrown out. */
  endCastleRun: (cleared: boolean) => void;
  addSeal: (tier: number, count?: number) => void;
  addCrystals: (count: number) => void;
  spendCrystal: () => boolean;
  /**
   * Spends the Winter Seal for a refight at `tier` (none at tier 1) as the party walks in.
   * False, and nothing spent, when the tier cannot be entered now.
   */
  enterHeart: (tier: number, barrowCleared: boolean) => boolean;
  /** A Heart kill at `tier` (the lair's own is tier 1): pays the next Winter Seal and records the tier. */
  clearHeart: (tier: number) => { sealTier: number };
  reset: () => void;
}

const initial = {
  lastSettledWeek: 0,
  tributePaid: 0,
  goldPaid: 0,
  siegesFought: 0,
  emperorDefeated: false,
  castleTier: null as number | null,
  castleStage: 0,
  seals: Array.from({ length: BALANCE.MAX_SEAL_TIER }, () => 0),
  castleCleared: false,
  deepestTier: 0,
  crystals: 0,
  winterSeals: NO_HEART_LADDER().seals,
  heartTier: 0,
};

export const useEmpireStore = create<EmpireState>((set, get) => ({
  ...initial,

  settleWeek: (week, gold) => {
    const fresh = week > get().lastSettledWeek;
    set((s) => ({
      // Never walks backwards: a stale settlement arriving late must not reopen
      // a week that has already been dealt with
      lastSettledWeek: Math.max(s.lastSettledWeek, week),
      tributePaid: gold > 0 ? s.tributePaid + 1 : s.tributePaid,
      goldPaid: s.goldPaid + gold,
    }));
    if (fresh && gold > 0) reportAchievement({ kind: 'tribute' });
  },

  recordSiege: () => set((s) => ({ siegesFought: s.siegesFought + 1 })),

  setEmperorDefeated: (defeated) => set({ emperorDefeated: defeated }),

  beginCastleRun: (tier) => {
    const t = clampTier(tier);
    const { seals, castleCleared } = get();
    if (!canEnterCastle(t, seals, castleCleared)) return;

    // The free first entry costs nothing; everything after it costs the Seal,
    // and the Seal is gone whether or not the run is cleared
    set({
      castleTier: t,
      castleStage: 0,
      seals: castleSpendsSeal(t, castleCleared) ? seals.map((n, i) => (i === t - 1 ? n - 1 : n)) : seals,
    });
  },

  advanceCastleStage: () => set((s) => ({ castleStage: s.castleStage + 1 })),

  endCastleRun: (cleared) => {
    const { castleTier, castleStage, emperorDefeated } = get();
    set((s) => ({
      castleTier: null,
      castleStage: 0,
      castleCleared: s.castleCleared || cleared,
      deepestTier: cleared ? Math.max(s.deepestTier, s.castleTier ?? 0) : s.deepestTier,
    }));
    if (cleared && castleTier !== null && castleStage === CASTLE_STAGE_COUNT - 1 && emperorDefeated) reportAchievement({ kind: 'castle' });
  },

  addSeal: (tier, count = 1) =>
    set((s) => ({
      seals: s.seals.map((n, i) => (i === clampTier(tier) - 1 ? n + count : n)),
    })),

  addCrystals: (count) => set((s) => ({ crystals: Math.max(0, s.crystals + count) })),

  spendCrystal: () => {
    if (get().crystals <= 0) return false;
    set((s) => ({ crystals: s.crystals - 1 }));
    return true;
  },

  enterHeart: (tier, barrowCleared) => {
    const t = clampHeartTier(tier);
    const { winterSeals } = get();
    if (!canEnterHeart(t, winterSeals, barrowCleared)) return false;
    // Spent on the way in, win or lose, as every ladder's Seal is
    if (heartSpendsSeal(t)) set({ winterSeals: winterSeals.map((n, i) => (i === t - 1 ? n - 1 : n)) });
    return true;
  },

  clearHeart: (tier) => {
    const t = clampHeartTier(tier);
    const sealTier = winterSealRewardFor(t);
    set((s) => ({
      winterSeals: s.winterSeals.map((n, i) => (i === sealTier - 1 ? n + 1 : n)),
      heartTier: Math.max(s.heartTier, t),
    }));
    return { sealTier };
  },

  reset: () => set({ ...initial, seals: [...initial.seals], winterSeals: [...initial.winterSeals] }),
}));

// The Emperor's part of the effective level cap (`data/levelCap.ts`); ownership and the world ledger push theirs.
useEmpireStore.subscribe((s) => setLevelCapInputs({ emperorDefeated: s.emperorDefeated }));
