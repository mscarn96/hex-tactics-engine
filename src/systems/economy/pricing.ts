import { Item, ItemSlot, Rarity } from '@/models/types';
import { itemTemplates } from '@/data/items/itemTemplates';
import { clampItemLevel, levelledSellPrice } from '@/data/items/itemLevel';

/**
 * What a counter asks for a piece, which is its sell price at a markup — and
 * never less than the dearest piece of a lower rarity in the same slot.
 *
 * The markup alone let an epic cost less than a common. Each rarity's price is
 * scaled to *its own* anchor level (`itemLevelScale`), so below its anchor an
 * epic is scaled down hard while a common is scaled up, and a slot's budget
 * differs by hand rule: a common two-hander carries more points than a rare
 * one-hander, and in a shared weapon slot it priced above it at every level.
 * Rather than retune the curve — which sets stats as well as prices, and the
 * sell side with them — the asking price is lifted over the dearer lower tier.
 * The floor is read off the same catalogue and the same levelled curve, so it
 * is the number that piece would have cost on the same shelf.
 *
 * Buy stays above sell by construction: the floor only ever raises a price.
 */

const RARITY_ORDER: Rarity[] = [Rarity.Common, Rarity.Rare, Rarity.Epic, Rarity.Legendary];

/** The dearest catalogue base price per slot and rarity. Levelling is monotone in it. */
const DEAREST_BASE = (() => {
  const table = new Map<string, number>();
  for (const t of itemTemplates) {
    const key = `${t.slot}:${t.rarity}`;
    table.set(key, Math.max(table.get(key) ?? 0, t.sellPrice));
  }
  return table;
})();

/** What the dearest piece of a lower rarity would be asked at this level, in this slot. */
function lowerTierCeiling(slot: ItemSlot, rarity: Rarity, level: number, markup: number): number {
  let ceiling = 0;
  // A mythic is priced as its legendary: it stands on that rung, not above it.
  const rung = rarity === Rarity.Mythic ? Rarity.Legendary : rarity;
  for (const lower of RARITY_ORDER.slice(0, RARITY_ORDER.indexOf(rung))) {
    const base = DEAREST_BASE.get(`${slot}:${lower}`);
    if (base === undefined) continue;
    const asked = Math.round(levelledSellPrice(base, clampItemLevel(level, lower), lower) * markup);
    ceiling = Math.max(ceiling, asked);
  }
  return ceiling;
}

export function askingPrice(item: Item, markup: number): number {
  const asked = Math.round(item.sellPrice * markup);
  const ceiling = lowerTierCeiling(item.slot, item.rarity, item.itemLevel, markup);
  return Math.max(asked, ceiling > 0 ? ceiling + 1 : 0);
}
