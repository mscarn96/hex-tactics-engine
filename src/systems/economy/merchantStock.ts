import { BALANCE } from '@/data/balanceConstants';
import { itemTemplates } from '@/data/items/itemTemplates';
import { familiesOf } from '@/data/items/itemGen';
import { inWorld } from '@/data/items/worldGear';
import type { MerchantKind } from '@/data/merchants';
import { strHash } from '@/data/display/terrainDisplay';
import { ItemSlot, ItemTemplate, Rarity, type Item } from '@/models/types';
import type { Merchant } from '@/systems/world/merchants';
import { createRNG } from '@/utils/rng';

/**
 * What a travelling merchant sells and what it pays: one shared pool of gear,
 * each kind taking a narrow slice of it, racked by seed so a merchant's cart is
 * the same wherever and whenever it is opened.
 *
 * - **Armourer**: epic weapons and armor, a tier above the Smithy's.
 * - **Curio dealer**: gear from other worlds (Jadeveil's) when the party holds
 *   that expansion; the rare and epic trinkets of the Empire otherwise.
 * - **Provisioner**: no gear; a cheap ward and a ration bundle (`PROVISIONER_GOODS`).
 *
 * A merchant buys the party's loot at `BALANCE.MERCHANT.buyRate` of its sell
 * price, and pays nothing for free: merchants are pure purchases. Verify in playtest.
 */
const ARMOUR_AND_ARMS: readonly ItemSlot[] = ['mainHand', 'offHand', 'head', 'chest', 'legs', 'feet'];
const TRINKETS: readonly ItemSlot[] = ['neck', 'ring'];

function accepts(kind: MerchantKind, t: ItemTemplate, ownsJadeveil: boolean): boolean {
  switch (kind) {
    case 'armourer':
      return t.rarity === Rarity.Epic && ARMOUR_AND_ARMS.includes(t.slot) && inWorld(t, 'empire');
    case 'curio':
      return ownsJadeveil
        ? t.world === 'jadeveil' && [Rarity.Rare, Rarity.Epic].includes(t.rarity)
        : [Rarity.Rare, Rarity.Epic].includes(t.rarity) && TRINKETS.includes(t.slot) && inWorld(t, 'empire');
    case 'provisioner':
      return false;
  }
}

/** The pieces a merchant racks: `MERCHANT.slots` of its kind's slice, sampled without replacement by family. */
export function merchantStock(merchant: Merchant, ownsJadeveil: boolean): ItemTemplate[] {
  const families = familiesOf(itemTemplates.filter((t) => accepts(merchant.kind, t, ownsJadeveil)));
  const rng = createRNG(strHash(`stock:${merchant.id}:${merchant.kind}:${ownsJadeveil}`));
  const pool = [...families];
  return Array.from({ length: Math.min(pool.length, merchant.kind === 'provisioner' ? 0 : BALANCE.MERCHANT.slots) }, () => {
    const [members] = pool.splice(Math.floor(rng.next() * pool.length), 1);
    return members[Math.floor(rng.next() * members.length)];
  });
}

/** The provisioner's wares, in the order its cart lists them. */
export const PROVISIONER_GOODS = ['ward', 'bundle'] as const;
export type ProvisionerGood = (typeof PROVISIONER_GOODS)[number];

/** Gold for a provisioner's good: the ward and the ration bundle, each a share cheaper than the city's. */
export function provisionerPrice(good: ProvisionerGood, rationGold: number): number {
  const m = BALANCE.MERCHANT;
  return good === 'ward'
    ? Math.max(1, Math.round(BALANCE.WARD_GOLD * m.wardShare))
    : Math.max(1, Math.round(rationGold * m.bundleRations * m.bundleShare));
}

/** What a merchant pays for one of the party's pieces: a poor share of its sell price, never below 1. */
export const merchantBuyPrice = (item: Pick<Item, 'sellPrice'>): number =>
  Math.max(1, Math.floor(item.sellPrice * BALANCE.MERCHANT.buyRate));
