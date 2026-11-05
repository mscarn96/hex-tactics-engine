import { isLegendaryGrade } from '@/data/items/rarity';
import { Item } from '@/models/types';
import { itemName, type NamedItem } from '@/data/items/itemText';
import { BALANCE } from '@/data/balanceConstants';
import { maxItemLevel } from '@/data/items/itemLevel';
import { itemAtLevel } from '@/systems/economy/itemFactory';
import { levelCap } from '@/data/levelCap';

/**
 * Legendary upgrades, and the Crystal loop that feeds them.
 *
 * `Bloodrage Warhammer +3` is the same item three item levels past the cap —
 * same form, same motif, same silhouette, on the same curve every other item
 * climbs. A legendary always *drops* at the cap in force (`levelCap()`); each Obsidian
 * Crystal raises it one level, up to `BALANCE.MAX_UPGRADE_LEVEL` past the cap.
 * There is no second multiplier beside the level: one number says how strong a
 * piece is, so the sheet, the comparison and the forge cannot disagree about it.
 *
 * The loop closes on itself. Dungeons produce legendaries, unwanted legendaries
 * become Crystals, Crystals pump the legendaries you kept, and stronger gear
 * opens the next Seal tier — which produces more legendaries.
 */

/**
 * How many levels a legendary stands past the cap in force — its "+N".
 *
 * Measured against the cap *now*, so a map that raises the cap reads an old +3
 * as the ordinary legendary it has become rather than as a +3 below the new drop
 * level. Zero for anything that is not a legendary.
 */
export function upgradeSteps(item: Pick<Item, 'rarity' | 'itemLevel'>): number {
  if (!isLegendaryGrade(item.rarity)) return 0;
  return Math.max(0, item.itemLevel - levelCap());
}

/** Only legendaries take a Crystal, and only up to their ceiling. */
export function canUpgrade(item: Pick<Item, 'rarity' | 'itemLevel'>): boolean {
  return isLegendaryGrade(item.rarity) && item.itemLevel < maxItemLevel(item.rarity);
}

/**
 * Applies a Crystal: one item level, stats re-derived by the same function every
 * other level change goes through.
 *
 * **Never fails.** The randomness already lives in the drop and in the salvage
 * roll; a third roll that destroys your item is a slot machine rather than a
 * decision.
 */
export function upgraded(item: Item): Item {
  if (!canUpgrade(item)) return item;
  return itemAtLevel(item, item.itemLevel + 1);
}

/**
 * Chance that breaking this item down yields an Obsidian Crystal.
 *
 * Scales with how far past the cap it has been pushed, so late-game duplicates
 * stay interesting: breaking a +3 is worth more than breaking a +0.
 */
export function crystalChance(item: Pick<Item, 'rarity' | 'itemLevel'>): number {
  if (!isLegendaryGrade(item.rarity)) return 0;
  return BALANCE.CRYSTAL_SALVAGE_CHANCE + BALANCE.CRYSTAL_CHANCE_PER_UPGRADE * upgradeSteps(item);
}

export function rollCrystal(item: Pick<Item, 'rarity' | 'itemLevel'>): boolean {
  return Math.random() < crystalChance(item);
}

/** `"Bloodrage Warhammer +3"`. An unlabelled upgrade is invisible value. */
export function itemDisplayName(item: NamedItem & Pick<Item, 'rarity' | 'itemLevel'>): string {
  const steps = upgradeSteps(item);
  const name = itemName(item);
  return steps > 0 ? `${name} +${steps}` : name;
}
