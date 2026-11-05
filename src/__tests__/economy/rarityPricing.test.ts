import { ItemSlot, Rarity } from '@/models/types';
import { shopPrice, shopStock } from '@/systems/economy/cityServices';
import { offeredItem } from '@/systems/economy/itemFactory';

const RANK: Rarity[] = [Rarity.Common, Rarity.Rare, Rarity.Epic, Rarity.Legendary];
const LEVELS = [1, 3, 5, 8, 10, 14, 18, 20, 25, 30];

/**
 * A higher rarity must never cost less than a lower one in the same slot. Each
 * rarity's price is scaled to its own anchor level, which on its own let an
 * epic one-hander undercut a common two-hander — the shop's markup alone cannot
 * keep the order, so the asking price is floored over the dearer lower tier.
 */
function expectRisingWithRarity(
  rack: { slot: ItemSlot; rarity: Rarity; price: number }[],
  where: string,
) {
  const bySlot = new Map<ItemSlot, typeof rack>();
  for (const row of rack) bySlot.set(row.slot, [...(bySlot.get(row.slot) ?? []), row]);
  for (const [slot, rows] of bySlot) {
    for (const low of rows) {
      for (const high of rows) {
        if (RANK.indexOf(high.rarity) <= RANK.indexOf(low.rarity)) continue;
        if (high.price <= low.price) {
          throw new Error(`${where} ${slot}: ${high.rarity} ${high.price} <= ${low.rarity} ${low.price}`);
        }
      }
    }
  }
}

describe('rack prices respect rarity', () => {
  it.each([0, 1, 2, 3])('shop level %i, at every party level', (shopLevel) => {
    for (const level of LEVELS) {
      const rack = shopStock(shopLevel, level).map((t) => {
        const offer = offeredItem(t, level, 'k');
        return { slot: t.slot, rarity: t.rarity, price: shopPrice(offer), offer };
      });
      expectRisingWithRarity(rack, `shop ${shopLevel} @L${level}`);
      for (const { offer, price } of rack) expect(price).toBeGreaterThan(offer.sellPrice);
    }
  });

});
