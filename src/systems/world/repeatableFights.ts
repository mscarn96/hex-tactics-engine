import { castleRunFromId } from '@/systems/world/castle';
import { summitTierFromId } from '@/systems/world/summit';
import { heartTierFromId } from '@/systems/world/heartRefight';
import { CASTLE_LADDER, HEART_LADDER, SUMMIT_LADDER, clampLadderTier, type SealLadder } from '@/systems/world/sealLadder';

/**
 * The fights made to be fought again and again: every Seal ladder's tiers, named by
 * encounter id (the private project notes, *Archipelago 0*).
 *
 * Archipelago 0 scales repeatable content to the current cap and reads a boss's tier for
 * its mythic chance (the private project notes); this is the one place that
 * says which fights those are. Each ladder's ids are decoded by its own module, which
 * imports the ladder rules, so this lives apart from `sealLadder.ts` rather than in it.
 */

export type LadderId = 'castle' | 'summit' | 'heart';

/** Each ladder, and the tier one of its encounter ids names (null for any other fight). */
const LADDERS: readonly { id: LadderId; ladder: SealLadder; tierOf: (encounterId: string) => number | null }[] = [
  { id: 'castle', ladder: CASTLE_LADDER, tierOf: (id) => castleRunFromId(id)?.tier ?? null },
  { id: 'summit', ladder: SUMMIT_LADDER, tierOf: summitTierFromId },
  { id: 'heart', ladder: HEART_LADDER, tierOf: heartTierFromId },
];

export interface RepeatableFight {
  ladder: LadderId;
  tier: number;
}

/**
 * The ladder and tier of a repeatable fight, or null for any other.
 *
 * Every tier of a ladder repeats but a story bottom rung: the summit's tier 1 is
 * Kairen's story fight, fought at the story's level, while the castle's runs — its free
 * first entry included, which shares the tier-1 ids with every forged Seal's run — and
 * every Heart refight, its free tier 1 included, are all named. The Heart's story fight is
 * the lair's own boss encounter, which is no ladder's.
 */
export function repeatableFightOf(encounterId: string | null | undefined): RepeatableFight | null {
  if (!encounterId) return null;
  for (const { id, ladder, tierOf } of LADDERS) {
    const raw = tierOf(encounterId);
    if (raw === null) continue;
    const tier = clampLadderTier(ladder, raw);
    if (ladder.bottom === 'story' && tier === 1) return null;
    return { ladder: id, tier };
  }
  return null;
}

/** Whether an encounter is repeatable content: a Seal ladder's tier. */
export const isRepeatableEncounter = (encounterId: string | null | undefined): boolean =>
  repeatableFightOf(encounterId) !== null;
