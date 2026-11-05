import { isLegendaryGrade } from '@/data/items/rarity';
import { ItemModifiers, Rarity } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { levelCap } from '@/data/levelCap';

/**
 * Item level: the axis that lets one named sword get better.
 *
 * Form × motif decides *what* an item is and affixes decide *which* one it is;
 * both were fixed at mint, so a Keen Iron Long Sword found at level 3 and one
 * found at level 18 were the same sword. The level is saved on the instance and
 * moves its **equipment stats** and nothing else — it never gates who may equip
 * the piece. It is also the whole of a legendary's Obsidian Crystal track: a
 * legendary drops at the cap and each Crystal raises it one level past it.
 *
 * One rule for every item, generated or unique, base stats and affixes alike:
 * the anchored modifiers — the template's own numbers, plus the affixes rolled
 * onto it — are scaled by `itemLevelScale` and rounded per stat. A second rule
 * for uniques (whose numbers are hand-set rather than budgeted) would be a
 * second answer to "what does level 12 mean", and the two would drift.
 */

/** The level a rarity's catalogue numbers describe. See `BALANCE.ITEM_LEVEL_ANCHOR`. */
export function anchorItemLevel(rarity: Rarity): number {
  return BALANCE.ITEM_LEVEL_ANCHOR[rarity];
}

/**
 * The highest level an item of this rarity may reach.
 *
 * The cap, for everything but a legendary. A legendary *drops* at the cap and is
 * then raised past it one Obsidian Crystal at a time, up to
 * `BALANCE.MAX_UPGRADE_LEVEL` levels beyond — so its "+3" is simply three levels
 * over the cap, on the same curve every other item climbs, rather than a second
 * multiplier kept beside the level. Read off the cap in force, so a map that
 * raises it lifts the ceiling with it.
 */
export function maxItemLevel(rarity: Rarity, cap: number = levelCap()): number {
  return isLegendaryGrade(rarity) ? cap + BALANCE.MAX_UPGRADE_LEVEL : cap;
}

/** A whole level between 1 and this rarity's ceiling. Anything else is not a level. */
export function clampItemLevel(level: number, rarity: Rarity): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(maxItemLevel(rarity), Math.max(1, Math.round(level)));
}

/**
 * Whether a value is a level an instance of this rarity may carry, under `cap`.
 * The save loader passes `highestLevelCap()`: it runs before any store holds the
 * campaign, and a level an owner's campaign reached is real even on a device
 * that cannot read the entitlement right now.
 */
export function isItemLevel(level: unknown, rarity: Rarity, cap: number = levelCap()): level is number {
  return (
    typeof level === 'number' &&
    Number.isInteger(level) &&
    level >= 1 &&
    level <= maxItemLevel(rarity, cap)
  );
}

/**
 * The share of its anchored stats an item carries at `level`.
 *
 * Exactly 1 at the rarity's anchor, which is what makes an anchored instance
 * identical to the catalogue preview. Deliberately *not* clamped to the cap: a
 * legendary raised past the cap, or minted at a raised one, sits above its
 * anchor and the curve continues.
 *
 * **Above its anchor a legendary climbs the steep segment**,
 * `1 + LEGENDARY_LEVEL_STEP` per level, because that is where its Crystal
 * levels live and the ordinary curve is nearly flat there. The segment starts
 * at the legendary *anchor* rather than at the cap in force, and that is a
 * correctness rule: the scale must be a function of the level alone, or raising
 * the cap would move the segment under a legendary already past the old one and
 * its next Crystal would re-derive it *weaker* than its baked numbers. The two
 * coincide while the cap is 20. Continuous at the anchor, so the curve never
 * steps.
 */
export function itemLevelScale(level: number, rarity: Rarity): number {
  const anchor = anchorItemLevel(rarity);
  if (isLegendaryGrade(rarity) && level > anchor) {
    return 1 + BALANCE.LEGENDARY_LEVEL_STEP * (level - anchor);
  }
  const k = BALANCE.ITEM_LEVEL_OFFSET;
  return (k + level) / (k + anchor);
}

/**
 * Anchored modifiers restated at `level`.
 *
 * Rounded per stat, so the result is an integer staircase: a level that moves
 * no stat past a half is a plateau, which is expected and is what the forge's
 * "next real gain" rule is for. **A stat the item carries never rounds away** —
 * a Keen ring at level 1 is still keen — which is the no-dead-roll rule stated
 * as a floor rather than hoped for from the numbers. Rounding a monotone input
 * and flooring it at 1 are both monotone, so a higher level never loses a point
 * (for a negative entry, never loses a point of *size*).
 *
 * Returns the input object itself at scale 1, so an anchored instance does not
 * even get a copy — the identity the catalogue preview relies on.
 */
export function levelledModifiers(
  anchored: ItemModifiers,
  level: number,
  rarity: Rarity,
): ItemModifiers {
  const scale = itemLevelScale(level, rarity);
  if (scale === 1) return anchored;
  const out: ItemModifiers = {};
  for (const [key, value] of Object.entries(anchored) as [keyof ItemModifiers, number | undefined][]) {
    if (!value) continue;
    // A trade-off (none ships today) grows with the item, and never vanishes
    // either — a drawback that rounds away at low level is a free item.
    out[key] = value > 0
      ? Math.max(1, Math.round(value * scale))
      : Math.min(-1, Math.round(value * scale));
  }
  return out;
}

/**
 * What an instance at `level` sells for: its template's price, scaled by the
 * same share its stats are.
 *
 * On the curve rather than beside it so buying and selling cannot come apart.
 * The shop and the market ask a markup *over this*, so a level-2 rare costs
 * what a level-2 rare is worth, and the spread that stops the market being a
 * gold press holds at every level rather than only at the anchor. Never under 1:
 * a piece with a price is a piece somebody will take off you.
 */
export function levelledSellPrice(base: number, level: number, rarity: Rarity): number {
  const scale = itemLevelScale(level, rarity);
  if (scale === 1) return base;
  return Math.max(1, Math.round(base * scale));
}
