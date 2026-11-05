import { BALANCE } from '@/data/balanceConstants';
import { itemTemplates } from '@/data/items/itemTemplates';
import { familiesOf } from '@/data/items/itemGen';
import { inWorld } from '@/data/items/worldGear';
import { VILLAGE_THEMES, type VillageTheme } from '@/data/villages';
import { ItemSlot, ItemTemplate, Rarity, ResourceType } from '@/models/types';
import { TRADED_RESOURCES } from '@/systems/economy/market';
import { createRNG } from '@/utils/rng';

/**
 * What a freed village sells each week: a small rack, seeded by week and theme
 * like the city Shop (`shopStock`) so a week's rack is the same wherever and
 * whenever it is opened. Shaped by the theme:
 *
 * - **Smithy**: weapons and armor a tier above the Shop's (rare and epic).
 * - **Shrine**: trinkets (neck and ring pieces) and caster gear, rare and epic.
 * - **Trading post**: a mix of the Shop's own tiers, and material swaps.
 * - **Lookout**: no gear; consumables (`LOOKOUT_STOCK`).
 *
 * Counts, prices and swap rates are `BALANCE.VILLAGE_*`: verify in playtest.
 */
const SMITHY_SLOTS: readonly ItemSlot[] = ['mainHand', 'offHand', 'head', 'chest', 'legs', 'feet'];
const SHRINE_SLOTS: readonly ItemSlot[] = ['neck', 'ring'];

/** Whether a template is gear a caster wants: it adds magic. */
const castsWith = (t: ItemTemplate) => (t.modifiers.magic ?? 0) > 0;

function accepts(theme: VillageTheme, t: ItemTemplate): boolean {
  switch (theme) {
    case 'smithy':
      return [Rarity.Rare, Rarity.Epic].includes(t.rarity) && SMITHY_SLOTS.includes(t.slot);
    case 'shrine':
      return [Rarity.Rare, Rarity.Epic].includes(t.rarity) && (SHRINE_SLOTS.includes(t.slot) || castsWith(t));
    case 'trading_post':
      return [Rarity.Common, Rarity.Rare].includes(t.rarity);
    case 'lookout':
      return false;
  }
}

/** How many pieces a village racks; the Lookout racks none. */
export function villageRackSize(theme: VillageTheme): number {
  return theme === 'lookout' ? 0 : BALANCE.VILLAGE_SHOP_SLOTS[theme];
}

/** This week's gear at a village: seeded sampling without replacement over form and motif families. */
export function villageStock(theme: VillageTheme, week: number): ItemTemplate[] {
  const count = villageRackSize(theme);
  if (count === 0) return [];
  const families = familiesOf(itemTemplates.filter((t) => accepts(theme, t) && inWorld(t, 'empire')));
  const rng = createRNG(week * 9151 + VILLAGE_THEMES.indexOf(theme) * 7919 + 4242);
  const pool = [...families];
  return Array.from({ length: Math.min(pool.length, count) }, () => {
    const [members] = pool.splice(Math.floor(rng.next() * pool.length), 1);
    return members[Math.floor(rng.next() * members.length)];
  });
}

/** The Lookout's consumables, in the order its counter lists them. */
export const LOOKOUT_STOCK = ['ward', 'ration', 'map_scroll'] as const;
export type LookoutGood = (typeof LOOKOUT_STOCK)[number];

/** Gold a Lookout consumable costs: the ward and the ration at the city's own price, the scroll at its own. */
export function lookoutPrice(good: LookoutGood, rationGold: number): number {
  switch (good) {
    case 'ward': return BALANCE.WARD_GOLD;
    case 'ration': return rationGold;
    case 'map_scroll': return BALANCE.VILLAGE_MAP_SCROLL_GOLD;
  }
}

/** One material handed over for another at the Trading post. */
export interface MaterialSwap {
  give: ResourceType;
  giveAmount: number;
  get: ResourceType;
  getAmount: number;
}

/**
 * This week's swaps: `VILLAGE_SWAP.count` pairs, each a different material
 * handed over for another at a rate that loses a little (give 3, get 2), so a
 * swap fixes a shortage and never makes materials.
 */
export function weeklySwaps(week: number): MaterialSwap[] {
  const rng = createRNG(week * 6271 + 88211);
  const pool = [...TRADED_RESOURCES];
  const out: MaterialSwap[] = [];
  for (let i = 0; i < BALANCE.VILLAGE_SWAP.count; i++) {
    const [give] = pool.splice(Math.floor(rng.next() * pool.length), 1);
    const others = TRADED_RESOURCES.filter((r) => r !== give);
    const get = others[Math.floor(rng.next() * others.length)];
    out.push({ give, giveAmount: BALANCE.VILLAGE_SWAP.give, get, getAmount: BALANCE.VILLAGE_SWAP.get });
  }
  return out;
}
