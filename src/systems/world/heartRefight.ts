import { t, type MessageKey } from '@/i18n';
import {
  HEART_LADDER, canEnterTier, clampLadderTier, ladderItemLevel, ladderSealReward, ladderSpendsSeal, ladderTierScale,
  ladderTiers, openTiers, twistTiersAt,
} from '@/systems/world/sealLadder';

/**
 * The Heart of Winter's Seal refight: its chamber fought again from the cleared Barrow's
 * door, at Winter Seal tiers (the private project notes, *The Heart of Winter's
 * refight*). The shared ladder rules (`sealLadder.ts`) with a free bottom rung: tier 1 is
 * open whenever the Barrow is cleared and pays the next Seal but no chest; tiers 2–5 spend
 * a Winter Seal of that tier on the way in, win or lose, and pay a chest and the Seal one
 * rung up. The lair's own boss fight is the story kill, and its first win pays a tier-2 Seal.
 *
 * Pure. The state — the Winter Seals held and the highest tier cleared — lives in
 * `empireStore`; whether the Barrow is cleared is read from the lair's spent trigger
 * (`lairs.isLairCleared`), as it always was.
 */

/** The lair whose door the refight is fought from, and its own boss encounter. */
export const HEART_LAIR_ID = 'lair_barrow';
export const HEART_LAIR_BOSS_ENCOUNTER = 'lair_barrow_boss';

/** The Winter Seals held by tier (index tier − 1) and the highest tier cleared. Saved with the empire. */
export interface HeartLadderState {
  seals: number[];
  highestTier: number;
}

export const NO_HEART_LADDER = (): HeartLadderState => ({
  seals: Array.from({ length: HEART_LADDER.topTier }, () => 0),
  highestTier: 0,
});

/** Every Winter Seal tier, low to high. */
export const HEART_TIERS: readonly number[] = ladderTiers(HEART_LADDER);

export const clampHeartTier = (tier: number): number => clampLadderTier(HEART_LADDER, tier);

/** Encounter id for the Heart's refight at a tier. Decoded by `heartTierFromId`. */
export const heartSealEncounterId = (tier: number): string => `heart_seal_${clampHeartTier(tier)}`;

/** The tier a refight encounter id names, or null for any other fight (the lair's own boss fight included). */
export function heartTierFromId(encounterId: string | null | undefined): number | null {
  const match = /^heart_seal_(\d+)$/.exec(encounterId ?? '');
  if (!match) return null;
  const tier = Number(match[1]);
  return tier >= 1 && tier <= HEART_LADDER.topTier ? tier : null;
}

/** Health and damage at a tier: ×(1 + 0.2 × (tier − 1)), as Kairen's and the castle's Aethelred. */
export const heartTierScale = (tier: number): number => ladderTierScale(HEART_LADDER, tier);

/** Whether the refight can be entered at a tier now: tier 1 whenever the Barrow is cleared, every other with its Seal. */
export const canEnterHeart = (tier: number, seals: readonly number[], barrowCleared: boolean): boolean =>
  canEnterTier(HEART_LADDER, tier, { seals, cleared: barrowCleared, doorOpen: barrowCleared });

/** Tiers the party can start now. */
export const openHeartTiers = (seals: readonly number[], barrowCleared: boolean): number[] =>
  openTiers(HEART_LADDER, { seals, cleared: barrowCleared, doorOpen: barrowCleared });

/** Whether entering at this tier spends a Winter Seal: every tier but the free first. */
export const heartSpendsSeal = (tier: number): boolean => ladderSpendsSeal(HEART_LADDER, tier, true);

/**
 * The Winter Seal a clear pays: tier n + 1, capped at the top, so a tier-5 clear pays another
 * tier 5. The lair's first kill and a free tier-1 refight both pay a tier 2.
 */
export const winterSealRewardFor = (tier: number): number => ladderSealReward(HEART_LADDER, tier);

/**
 * The chest's item level at a tier — the ladders' one rule, `levelCap() − 5 + tier` — or null at
 * tier 1, which pays no chest: the free rung is the way back onto the ladder, not a chest farm.
 */
export const heartChestLevel = (tier: number): number | null =>
  clampHeartTier(tier) === 1 ? null : ladderItemLevel(HEART_LADDER, tier);

/** One twist per tier from the second, each in one line (`heartScript` reads the tier off the Heart). */
export const HEART_TIER_TWISTS: Readonly<Record<number, MessageKey>> = {
  2: 'worldEvents.heartTwist.2',
  3: 'worldEvents.heartTwist.3',
  4: 'worldEvents.heartTwist.4',
  5: 'worldEvents.heartTwist.5',
};

/** Every twist in force at a tier, in the current language: each tier keeps the ones below, and tier 1 has none. */
export const heartTwistsAt = (tier: number): string[] =>
  twistTiersAt(HEART_LADDER, tier).map((n) => t(HEART_TIER_TWISTS[n]));
