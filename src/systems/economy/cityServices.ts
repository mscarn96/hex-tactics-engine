import { BuildingType, Item, ItemTemplate, Rarity } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { buildingData } from '@/data/templates/buildingData';
import { inWorld } from '@/data/items/worldGear';
import { itemTemplates } from '@/data/items/itemTemplates';
import { familiesOf } from '@/data/items/itemGen';
import { askingPrice } from '@/systems/economy/pricing';
import { MASTERY_SET_FORGE_LEVEL, maxForgeRarity } from '@/systems/economy/forge';
import { marketSpread } from '@/systems/economy/market';
import { createRNG } from '@/utils/rng';
import { deploymentPerk } from '@/systems/combat/deployment';
import { mealEffectsText } from '@/systems/economy/expeditionMeals';
import { libraryXpMultiplier } from '@/systems/progression/leveling';
import { formatDecimal, formatPercent, t, type MessageKey } from '@/i18n';

/** Service prices are independent of Tavern level; upgrades unlock meal capabilities. */
export function restCost(_tavernLevel: number, summedPartyLevel: number): number {
  const base = BALANCE.TAVERN_REST_GOLD_PER_LEVEL * summedPartyLevel;
  return Math.max(1, Math.ceil(base));
}

/** Portable healing costs a fraction of the calculated full-party bed. */
export function rationCost(tavernLevel: number, summedPartyLevel: number): number {
  return Math.max(1, Math.ceil(restCost(tavernLevel, summedPartyLevel) * BALANCE.RATION_REST_PRICE_FRACTION));
}

/** A recruit costs the same at every Tavern level. */
export function recruitCost(_tavernLevel: number): number {
  return BALANCE.TAVERN_RECRUIT_BASE_GOLD;
}

/** The barracks' discount at `level`, applied to retraining. */
export function barracksDiscount(level: number): number {
  return BALANCE.BARRACKS_RETRAIN_DISCOUNT_PER_LEVEL * level;
}

/**
 * Gold to un-spend a hero's mastery nodes.
 *
 * Priced per point actually spent, so the cost tracks the size of the mistake
 * being undone rather than the fact of undoing one.
 *
 * **This buys back the picks inside a path, never the path.** Choosing a
 * discipline is still the one permanent decision a hero makes — it is what the
 * "this cannot be undone" dialog is about, and it now locks their weapons too.
 * What it does not have to mean is that a player who spent a point wrongly at
 * level six is stuck with it at level twenty. Those are different mistakes and
 * only one of them is interesting to live with.
 *
 * Zero when there is nothing spent, so the caller can price a no-op honestly
 * rather than charging for a button that would do nothing.
 */
export function retrainCost(barracksLevel: number, pointsSpent: number): number {
  if (pointsSpent <= 0) return 0;
  const base = BALANCE.BARRACKS_RETRAIN_GOLD_PER_POINT * pointsSpent;
  return Math.max(1, Math.ceil(base * (1 - barracksDiscount(barracksLevel))));
}

// ─── The shop: what is on the rack ───────────────────────────────────────────

/** The tiers a shop of this level carries, commonest first. */
export function shopRarities(_level: number): Rarity[] {
  return [Rarity.Common, Rarity.Rare];
}

/** How many pieces a shop of this level racks. */
export function shopStockCount(level: number): number {
  return BALANCE.SHOP_STOCK_BASE + level * 2;
}

/** Weekly seeded sampling without replacement over form × motif families, then silhouettes. */
export function shopStock(level: number, week = 1): ItemTemplate[] {
  // The city's shop is the Empire's: a world's own motifs are found and forged
  // in that world (`worldGear.ts`), never bought here
  const families = familiesOf(itemTemplates.filter((t) => shopRarities(level).includes(t.rarity) && inWorld(t, 'empire')));
  const rng = createRNG(week * 6151 + level * 7919 + 31337);
  const pool = [...families];
  return Array.from({ length: Math.min(pool.length, shopStockCount(level)) }, () => {
    const [members] = pool.splice(Math.floor(rng.next() * pool.length), 1);
    return members[Math.floor(rng.next() * members.length)];
  });
}

/** Gold the shop asks for a piece of stock. */
export function shopPrice(offer: Item): number {
  return askingPrice(offer, BALANCE.SHOP_ITEM_MARKUP);
}

// ─── Saying it out loud ──────────────────────────────────────────────────────

const FORGE_UP_TO: Record<Rarity, MessageKey> = {
  [Rarity.Common]: 'buildings.perk.forge.common',
  [Rarity.Rare]: 'buildings.perk.forge.rare',
  [Rarity.Epic]: 'buildings.perk.forge.epic',
  [Rarity.Legendary]: 'buildings.perk.forge.legendary',
  // Never reached: the forge makes no mythic, so `maxForgeRarity` never names one.
  [Rarity.Mythic]: 'buildings.perk.forge.legendary',
};

/**
 * What a building at `level` does, in one concrete phrase.
 *
 * Concrete is the requirement: "improves the shop" tells a player nothing they
 * can weigh against the price. Every clause here is a number read back out of
 * the function that produces it. The words are the `buildings` namespace's `perk.*`.
 */
export function levelPerk(type: BuildingType, level: number): string {
  switch (type) {
    case BuildingType.Barracks:
      return t('buildings.perk.barracks', { deploy: deploymentPerk(level), percent: formatPercent(barracksDiscount(level)) });
    case BuildingType.Shop:
      return t('buildings.perk.shop', { count: shopStockCount(level) });
    case BuildingType.Forge:
      // The top rung is not a rarity: `maxForgeRarity` tops out at Epic one
      // level below it, and for a long time that meant levels 0 and 1 said the
      // same thing. The gate moved down a rung and the last level buys the
      // mastery sets and the bench that re-aims their skill bonus.
      return level >= MASTERY_SET_FORGE_LEVEL
        ? t('buildings.perk.forge.sets')
        : t(FORGE_UP_TO[maxForgeRarity(level)]);
    case BuildingType.Market:
      return t('buildings.perk.market', { spread: formatDecimal(marketSpread(level), 2, { fixed: true }) });
    case BuildingType.Library:
      return t('buildings.perk.library', { percent: formatPercent(libraryXpMultiplier(level) - 1) });
    case BuildingType.Tavern:
      return level === 0 ? t('buildings.perk.tavern.none') : mealEffectsText(level);
  }
}

/** The highest level this building goes to. */
export function buildingMaxLevel(type: BuildingType): number {
  return buildingData.find((b) => b.type === type)?.maxLevel ?? 0;
}

/**
 * What the *next* level brings, or `null` when there is no next level.
 *
 * `null` rather than a "fully upgraded" string, so the caller decides how to
 * render an ending — a sentence and an absence are different things to lay out.
 */
export function nextLevelHint(type: BuildingType, level: number): string | null {
  if (level >= buildingMaxLevel(type)) return null;
  return t('buildings.perk.next', { level: level + 1, perk: levelPerk(type, level + 1) });
}
