import { BALANCE } from '@/data/balanceConstants';
import { levelCap } from '@/data/levelCap';

/**
 * The Seal ladder: the rules every repeatable boss shares
 * (the private project notes, *The shared Seal ladder*).
 *
 * A ladder is a tier you hold a Seal for, spent on the way in, win or lose; a clear
 * pays the Seal one rung up, capped, so the top stays repeatable. The castle's
 * Obsidian Seals and the summit's Storm Seals differ only in the data below — the
 * top tier, the power step and what opens tier 1 — so the rules are written once and
 * each ladder's module (`castle.ts`, `summit.ts`, `heartRefight.ts`) reads them through its own names.
 *
 * Pure, and it imports no ladder: `repeatableFights.ts` pairs each ladder with the
 * encounter ids it owns, since those modules import this one.
 */

/**
 * What opens tier 1.
 *
 * - `freeOnce` — free until the ladder's first clear, then a tier-1 Seal (the castle:
 *   the gate is simply there, and the Forge sells the Seal after).
 * - `story` — the story fight, open while its door is (the summit's wrath window); the
 *   Seal tiers above it open only once the story fight has been won.
 * - `free` — a free refight, open whenever its door is (the Heart: the cleared Barrow). The
 *   story fight is a separate encounter (the lair), and its first kill is the ladder's first
 *   clear. The free rung pays the next Seal but no chest, so a party that has spent every
 *   Seal is never locked out and the bottom is not a chest farm.
 */
export type BottomRung = 'freeOnce' | 'story' | 'free';

export interface SealLadder {
  /** Tiers run 1 … `topTier`. */
  topTier: number;
  /** Health and damage step per tier above the first: × (1 + step × (tier − 1)). */
  powerStep: number;
  bottom: BottomRung;
}

/** The castle's Obsidian Seals (`castle.ts`). */
export const CASTLE_LADDER: SealLadder = {
  topTier: BALANCE.MAX_SEAL_TIER,
  powerStep: BALANCE.CASTLE_TIER_POWER,
  bottom: 'freeOnce',
};

/** The summit's Storm Seals (`summit.ts`). */
export const SUMMIT_LADDER: SealLadder = {
  topTier: BALANCE.KAIREN.MAX_TIER,
  powerStep: BALANCE.KAIREN.TIER_POWER,
  bottom: 'story',
};

/** The Heart of Winter's Winter Seals (`heartRefight.ts`). */
export const HEART_LADDER: SealLadder = {
  topTier: BALANCE.HEART_SEAL.MAX_TIER,
  powerStep: BALANCE.HEART_SEAL.TIER_POWER,
  bottom: 'free',
};

/** Where a party stands with one ladder. */
export interface LadderStanding {
  /** Seals held, by tier (index tier − 1). */
  seals: readonly number[];
  /** The ladder's first clear has happened: the castle cleared, Kairen slain. */
  cleared: boolean;
  /** A `story` or `free` ladder's door is open now (the summit's wrath window, the cleared Barrow). */
  doorOpen?: boolean;
}

/** Every tier of a ladder, low to high. */
export const ladderTiers = (ladder: SealLadder): number[] =>
  Array.from({ length: ladder.topTier }, (_, i) => i + 1);

export const clampLadderTier = (ladder: SealLadder, tier: number): number =>
  Math.min(ladder.topTier, Math.max(1, Math.round(tier)));

/** Health and damage at a tier: × (1 + step × (tier − 1)). */
export const ladderTierScale = (ladder: SealLadder, tier: number): number =>
  1 + ladder.powerStep * (clampLadderTier(ladder, tier) - 1);

/** Whether a tier can be entered now. */
export function canEnterTier(ladder: SealLadder, tier: number, standing: LadderStanding): boolean {
  const t = clampLadderTier(ladder, tier);
  const held = (standing.seals[t - 1] ?? 0) > 0;
  if (ladder.bottom === 'story') return t === 1 ? !!standing.doorOpen : standing.cleared && held;
  // Every tier of a free ladder is fought at its door: tier 1 for nothing, the rest for a Seal
  if (ladder.bottom === 'free') return !!standing.doorOpen && (t === 1 || held);
  return (t === 1 && !standing.cleared) || held;
}

/** The tiers that can be entered now. */
export const openTiers = (ladder: SealLadder, standing: LadderStanding): number[] =>
  ladderTiers(ladder).filter((t) => canEnterTier(ladder, t, standing));

/** Whether entering a tier spends a Seal: every tier but a free bottom rung. */
export function ladderSpendsSeal(ladder: SealLadder, tier: number, cleared: boolean): boolean {
  const t = clampLadderTier(ladder, tier);
  if (t > 1) return true;
  // A `story` or `free` bottom rung never spends one
  return ladder.bottom === 'freeOnce' && cleared;
}

/**
 * The Seal a tier-n clear pays: tier n + 1, capped at the top. A top-tier clear pays
 * another top-tier Seal rather than nothing — the top of the ladder has to stay
 * repeatable, or the best content locks itself the moment it is finished.
 */
export const ladderSealReward = (ladder: SealLadder, tier: number): number =>
  Math.min(ladder.topTier, clampLadderTier(ladder, tier) + 1);

/**
 * The item level a tier's chest mints at: the level cap − top tier + tier, so the top
 * tier is at the cap and each tier below steps down one. Read at the call, so a rising
 * cap lifts every ladder's chest.
 *
 * The one item-level rule for every ladder. Archipelago 0 owns any change to it —
 * whether "loot minted at the cap" should put every tier at the cap
 * (the private project notes, *Archipelago 0*).
 */
export const ladderItemLevel = (ladder: SealLadder, tier: number): number =>
  Math.max(1, levelCap() - ladder.topTier + clampLadderTier(ladder, tier));

/** The tiers whose twists are in force at a tier: 2 up to it, so each keeps the ones below. */
export const twistTiersAt = (ladder: SealLadder, tier: number): number[] =>
  ladderTiers(ladder).filter((n) => n >= 2 && n <= clampLadderTier(ladder, tier));
