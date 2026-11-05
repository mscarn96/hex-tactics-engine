import { Hero } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { LAIR_SPECS } from '@/locations/lairs';
import { neutralDepth } from '@/systems/world/threat';
import { contentLevel, type ContentLevel } from '@/systems/world/contentLevel';
import { levelCap } from '@/data/levelCap';
import { CASTLE_LADDER, ladderItemLevel } from '@/systems/world/sealLadder';

/**
 * What level each acquisition path mints at.
 *
 * Two answers, and which one a source gets is a fact about the source rather
 * than about the item:
 *
 * - **Ground** — combat drops, lair chests and the castle's chest. The level
 *   comes from where the fight was, the same band and depth its enemies were
 *   scaled by and its gold is paid by, so walking further out is how better loot
 *   is found. A party farming the home ring finds home-ring gear however strong
 *   it has become, which is the threat gradient's whole promise restated for
 *   items. Beyond the Empire the source's `content` says what that is: the area's
 *   or the site's level inside the world's band, and never past the band's top
 *   (`systems/world/contentLevel.ts`), or the cap for repeatable content.
 * - **The party** — starter kit, quest rewards, the shop, the market and the
 *   forge. Nobody is fighting for these; they are made or handed over to the
 *   measure of whoever is standing there, so the level is theirs.
 *
 * Pure, with the dice injected, so the bands are a table a test can walk. A
 * legendary ignores every answer here and takes its source's ceiling: the band's
 * top for story content beyond the Empire, and the cap for repeatable content and
 * in the Empire. That is `mintItem`'s rule, stated once, and not something each
 * source could forget.
 */

/** Where a fight took place, for the purpose of what it pays in gear. */
export interface LootGround {
  band: number;
  /** 0 at the band's inner edge, 1 at its outer. See `threatDepth`. */
  depth?: number;
  /** A castle run's Seal tier, which outranks the ground it has none of. */
  castleTier?: number | null;
  /**
   * A fight with no ground of its own that names its level outright: a siege,
   * fought in the city's streets at the party's level (playtest 2026-10-14 —
   * its drops were minted at the home ring's band 0 whatever the week). Beyond the
   * Empire, a source's own loot level where it differs from its fight's (the summit's chest).
   */
  level?: number;
  /** The source beyond the Empire: its band, kind, level and ceiling. Absent in the Empire. */
  content?: ContentLevel;
}

/**
 * The castle's tier `t` mints at `levelCap() - MAX_SEAL_TIER + t`, so the top
 * tier's chest is at the cap and every tier below steps down one: the Seal
 * ladders' one item-level rule (`sealLadder.ladderItemLevel`).
 */
export function castleItemLevel(tier: number): number {
  return ladderItemLevel(CASTLE_LADDER, tier);
}

/**
 * The ground's own level, before any spread: the band's entry, ramped by depth
 * toward the next band's. Band 4 ramps toward the castle's first tier, so the
 * deepest overworld ground and the gauntlet's opening meet rather than step.
 *
 * Beyond the Empire the ground is the source's content level, ramped by depth toward the next
 * area's and never past its ceiling. The Empire's `BAND_ITEM_LEVEL` ladder is no part of it.
 */
export function groundItemLevel(ground: LootGround): number {
  if (ground.castleTier) return castleItemLevel(ground.castleTier);
  if (ground.content) {
    const { level, rampTo, ceiling } = ground.content;
    if (ground.level !== undefined) return Math.min(ceiling, Math.max(1, ground.level));
    const depth = Math.min(1, Math.max(0, ground.depth ?? 0));
    return Math.min(ceiling, level + (rampTo - level) * depth);
  }
  if (ground.level !== undefined) return Math.min(levelCap(), Math.max(1, ground.level));
  const table = BALANCE.BAND_ITEM_LEVEL;
  const band = Math.min(table.length - 1, Math.max(0, Math.round(ground.band)));
  const from = table[band];
  const to = band + 1 < table.length ? table[band + 1] : castleItemLevel(1);
  const depth = Math.min(1, Math.max(0, ground.depth ?? 0));
  return from + (to - from) * depth;
}

/**
 * One drop's level: the ground's, rounded, plus or minus
 * `DROP_ITEM_LEVEL_SPREAD`, never under 1 or past the source's ceiling (the cap,
 * in the Empire). The caller mints with it, and `mintItem` clamps again per
 * rarity — a legendary ignores it.
 */
export function dropItemLevel(ground: LootGround, rng: () => number = Math.random): number {
  const spread = BALANCE.DROP_ITEM_LEVEL_SPREAD;
  const offset = Math.floor(rng() * (2 * spread + 1)) - spread;
  const level = Math.round(groundItemLevel(ground)) + offset;
  return Math.min(ground.content?.ceiling ?? levelCap(), Math.max(1, level));
}

/**
 * The ground a location's chest pays from, if it has one.
 *
 * A lair is a curated fight at its own `LairSpec.band` — never the ground under
 * its door, which is `curatedBand`'s whole argument — so its chests pay in that
 * band's gear at the depth its fights are scaled by. Beyond the Empire a lair's
 * chest pays at the lair's own level (`LairSpec.levelOffset`). Anywhere else has
 * no ground, and a chest there mints at the anchor as it always did.
 */
export function locationGround(locationId: string): LootGround | undefined {
  const lair = LAIR_SPECS.find((s) => s.id === locationId);
  if (!lair) return undefined;
  const content = lair.world ? contentLevel({ world: lair.world, locationId: lair.id }) : null;
  if (content) return { band: lair.band, content };
  return { band: lair.band, depth: neutralDepth(lair.band) };
}

/**
 * The level town-made and handed-over gear is minted at: the party's mean hero
 * level, rounded. A mean rather than the best, because the shop is stocking for
 * everybody; the forge's own level *upgrade* is what reaches for the highest.
 * An empty party mints at 1.
 */
export function partyItemLevel(heroes: Pick<Hero, 'level'>[]): number {
  if (heroes.length === 0) return 1;
  const mean = heroes.reduce((n, h) => n + h.level, 0) / heroes.length;
  return Math.min(levelCap(), Math.max(1, Math.round(mean)));
}
