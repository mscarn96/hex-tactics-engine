import { BALANCE } from '@/data/balanceConstants';
import { levelCap } from '@/data/levelCap';
import { Item, Rarity } from '@/models/types';
import type { ContentLevel } from '@/systems/world/contentLevel';
import { summitTierFromId } from '@/systems/world/summit';
import { levelBand } from '@/systems/world/worldBands';

/**
 * The odds of a boss mythic (`docs/quests-progression-items.md`, *Mythic items*).
 * Only a boss beyond the Empire rolls one, so `mythicRollFor` answers `null` for anything with
 * no content level: the Empire and a siege. Aethelred is the one exception, by the designer's decision
 * of 2026-11-04 (`aethelredMythicRoll`). `rollBossLoot` throws the die and draws the piece.
 *
 * Pure: the caller reads the counter and what the party holds, and banks what the roll leaves.
 */

/** What one fight's boss rolls need. The roll's own: `rollBossLoot` writes `kills` and `held`. */
export interface MythicRoll {
  /** The chance per kill (`mythicChance`). */
  chance: number;
  /** Eligible kills since the last mythic. Read back after the fight, to be banked. */
  kills: number;
  /** Templates the party holds as a mythic (`heldMythics`), and any this fight has paid. */
  held: Set<string>;
}

/**
 * The chance per kill. `band` is the loot's, not the world's: a Storm Seal tier mints at the
 * cap, so a finished world's top tier reads the newest band. `tier` is 1 for a lair boss.
 */
export function mythicChance(band: number, tier: number): number {
  const { BASE_CHANCE, PER_BAND, PER_TIER } = BALANCE.MYTHIC;
  return BASE_CHANCE + PER_BAND * (band - 1) + PER_TIER * (tier - 1);
}

/** The templates the party holds as a mythic, wherever the piece is. */
export function heldMythics(gear: readonly Pick<Item, 'templateId' | 'rarity'>[]): Set<string> {
  return new Set(gear.filter((item) => item.rarity === Rarity.Mythic).map((item) => item.templateId));
}

/** A fight's roll, or `null` where no boss may drop a mythic. */
export function mythicRollFor(
  encounterId: string | null | undefined,
  content: ContentLevel | null,
  kills: number,
  held: Iterable<string>,
): MythicRoll | null {
  if (!content) return null;
  const chance = mythicChance(levelBand(content.ceiling), summitTierFromId(encounterId) ?? 1);
  return { chance, kills, held: new Set(held) };
}

/**
 * Aethelred's roll, the Empire's only one. His loot has no world band, so tier 1 reads band 1 and a
 * higher Seal tier reads the cap's band, as repeatable loot does elsewhere. Before any crossing the
 * cap of 20 reads band 1. The pool is the Empire's, so the piece comes from a mastery set.
 */
export function aethelredMythicRoll(castleTier: number, kills: number, held: Iterable<string>): MythicRoll {
  const band = castleTier > 1 ? levelBand(levelCap()) : 1;
  return { chance: mythicChance(band, castleTier), kills, held: new Set(held) };
}

/**
 * Whether the kill that brought the counter to `kills` pays a mythic: always at the cap, and
 * otherwise on the die, which is thrown only when it can decide.
 */
export function mythicDue(kills: number, chance: number, rng: () => number): boolean {
  return kills >= BALANCE.MYTHIC.COUNTER_CAP || rng() < chance;
}
