import { BALANCE } from '@/data/balanceConstants';
import { contentBand } from '@/data/levelCap';
import { t, type MessageKey } from '@/i18n';
import {
  SUMMIT_LADDER, canEnterTier, clampLadderTier, ladderItemLevel, ladderSealReward, ladderSpendsSeal, ladderTierScale,
  ladderTiers, openTiers, twistTiersAt,
} from '@/systems/world/sealLadder';
import { bandFloor } from '@/systems/world/worldBands';

/**
 * Jadeveil: the summit's door — Kairen's first fight and the Storm Seal ladder above it
 * (the private project notes, *Repeat tiers*). The castle's Seal model, on the
 * shared ladder rules (`sealLadder.ts`): a tier is a Seal, spent on the way in, and a clear
 * pays the Seal one rung up, capped. What differs is the bottom rung: tier 1 is the story
 * fight, and its door is the open wrath window rather than a Seal.
 *
 * Pure. The state — Kairen slain, the Seals held, the highest tier cleared — lives in
 * `ascentStore`; the fight in `combatStore`.
 */

const K = BALANCE.KAIREN;

/**
 * Kairen's summit: whether he has been killed (the story, paid once), the Storm Seals
 * held by tier (index tier − 1) and the highest tier ever cleared. Permanent, like the
 * shrines; kept in `ascentStore.summit` and saved with them (`ascent.summit`, save 61).
 */
export interface SummitState {
  slain: boolean;
  seals: number[];
  highestTier: number;
}

export const NO_SUMMIT = (): SummitState => ({
  slain: false,
  seals: Array.from({ length: K.MAX_TIER }, () => 0),
  highestTier: 0,
});

/** Every Storm Seal tier, low to high. */
export const STORM_TIERS: readonly number[] = ladderTiers(SUMMIT_LADDER);

export const clampStormTier = (tier: number): number => clampLadderTier(SUMMIT_LADDER, tier);

/** Encounter id for Kairen at a tier. Decoded by `summitTierFromId`. */
export const summitEncounterId = (tier: number): string => `summit_kairen_${clampStormTier(tier)}`;

/** The tier a summit encounter id names, or null for any other fight. */
export function summitTierFromId(encounterId: string | null | undefined): number | null {
  const match = /^summit_kairen_(\d+)$/.exec(encounterId ?? '');
  if (!match) return null;
  const tier = Number(match[1]);
  return tier >= 1 && tier <= K.MAX_TIER ? tier : null;
}

/** Health and damage at a tier: ×(1 + 0.2 × (tier − 1)), as the castle's Aethelred. */
export const summitTierScale = (tier: number): number => ladderTierScale(SUMMIT_LADDER, tier);

/**
 * Whether the summit can be entered at a tier now.
 *
 * **Tier 1 is the story fight, and the open wrath window is its door** — a loss or a
 * retreat does not close it, so the party may try again while it lasts, and once it
 * closes the wrath must fill again. After the first kill the same door still opens on
 * tier 1 while a window is open, so a party that has spent every Seal is never locked
 * out for good. **Every tier above is a Storm Seal of that tier**, any time, with no
 * window: wrath only grows from one-time deeds, so a ladder tied to it would end.
 */
export function canEnterSummit(tier: number, seals: readonly number[], kairenSlain: boolean, windowOpen: boolean): boolean {
  return canEnterTier(SUMMIT_LADDER, tier, { seals, cleared: kairenSlain, doorOpen: windowOpen });
}

/** Tiers the party can start now. */
export const openSummitTiers = (seals: readonly number[], kairenSlain: boolean, windowOpen: boolean): number[] =>
  openTiers(SUMMIT_LADDER, { seals, cleared: kairenSlain, doorOpen: windowOpen });

/** Whether entering at this tier spends a Seal: every tier but the story one. */
export const summitSpendsSeal = (tier: number): boolean => ladderSpendsSeal(SUMMIT_LADDER, tier, true);

/**
 * The Storm Seal a tier-n clear pays: tier n + 1, capped at the top. A tier-5 clear pays
 * another tier-5 Seal, so the top of the ladder stays repeatable. The first kill (tier 1)
 * pays a tier-2.
 */
export const stormSealRewardFor = (tier: number): number => ladderSealReward(SUMMIT_LADDER, tier);

/**
 * The summit chest's item level. The story tier's is the band floor, where the world's
 * story leaves it. A Storm Seal tier's is the level cap − 5 + tier, so tier 5 mints at the
 * cap — the ladders' one rule (`ladderItemLevel`). The chest's legendaries lean to the
 * range's own, and every clear adds a collection piece (`economy/jadeveilRewards.ts`).
 */
export const summitItemLevel = (tier: number): number =>
  (clampStormTier(tier) === 1 ? bandFloor(contentBand('jadeveil') ?? 1) : ladderItemLevel(SUMMIT_LADDER, tier));

/** One twist per tier, so each plays differently (the swarm also grows by one per tier). */
export const TIER_TWISTS: Readonly<Record<number, MessageKey>> = {
  1: 'worldEvents.twist.1',
  2: 'worldEvents.twist.2',
  3: 'worldEvents.twist.3',
  4: 'worldEvents.twist.4',
  5: 'worldEvents.twist.5',
};

/** Every twist in force at a tier, in the current language: each tier keeps the ones below it. */
export const twistsAt = (tier: number): string[] =>
  twistTiersAt(SUMMIT_LADDER, tier).map((n) => t(TIER_TWISTS[n]));
