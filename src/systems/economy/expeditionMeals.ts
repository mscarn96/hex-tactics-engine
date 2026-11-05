import { BALANCE } from '@/data/balanceConstants';
import { ResourceType } from '@/models/types';
import { formatNumber, formatPercent, t } from '@/i18n';

export interface ExpeditionMeal { tier: number; week: number }
/** Exact current-save shape; absent or malformed purchased effects cannot be inferred. */
export function validMeal(value: unknown): value is ExpeditionMeal | null {
  if (value === null) return true;
  if (typeof value !== 'object' || !value) return false;
  const meal = value as ExpeditionMeal;
  return Number.isSafeInteger(meal.tier) && meal.tier >= 1 && meal.tier <= 3
    && Number.isSafeInteger(meal.week) && meal.week >= 1;
}
export function mealTier(meal: ExpeditionMeal | null, week: number): number {
  return meal?.week === week ? meal.tier : 0;
}
export function mealDawnHeal(tier: number): number {
  return tier >= 1 ? BALANCE.EXPEDITION_MEAL_DAWN_HEAL : BALANCE.DAWN_HEAL_FRACTION;
}
/**
 * The toast a new day opens with, naming both things dawn actually changes:
 * the living heal (by the meal's fraction, not always the bare one), and the
 * day's encounters re-roll, so the enemies on the wild ground are somewhere
 * else. It used to say "the roads are new", which nobody could decode.
 */
export function dawnNotice(day: number, tier: number, bonus = 0): string {
  return t('economy.dawn.notice', { day: formatNumber(day), percent: formatPercent(mealDawnHeal(tier) + bonus) });
}
export function mealRationFraction(tier: number): number {
  return tier >= 2 ? 1 : BALANCE.RATION_HEAL_FRACTION;
}
export function mealRarityLuck(tier: number): number {
  return tier >= 3 ? BALANCE.EXPEDITION_MEAL_RARITY_LUCK : 0;
}
/** Pay for remaining hours, including this hour; an upgrade replaces at full prorated price. */
export function mealPrice(tier: number, summedLevel: number, totalHours: number): number {
  const hours = BALANCE.HOURS_PER_DAY * BALANCE.DAYS_PER_WEEK;
  const remaining = hours - (totalHours % hours);
  return Math.max(1, Math.ceil(Math.max(1, summedLevel) * tier * BALANCE.EXPEDITION_MEAL_GOLD_PER_LEVEL * remaining / hours));
}
export function mealEffectsText(tier: number): string {
  if (tier <= 0) return t('economy.meal.none');
  const effects = [t('economy.meal.effect.dawn', { percent: formatPercent(mealDawnHeal(tier)) })];
  if (tier >= 2) effects.push(t('economy.meal.effect.rations'));
  if (tier >= 3) {
    effects.push(t('economy.meal.effect.loot', {
      loot: formatPercent(BALANCE.EXPEDITION_MEAL_LOOT_BONUS),
      luck: formatNumber(BALANCE.EXPEDITION_MEAL_RARITY_LUCK * 100),
    }));
  }
  return effects.join(' · ');
}
/** Only ordinary loot enters here; fractional resource bonuses round fairly across many finds. */
export function mealLootAmount(amount: number, tier: number, resource: ResourceType, rng: () => number = Math.random): number {
  if (tier < 3 || ![ResourceType.Gold, ResourceType.Wood, ResourceType.Stone, ResourceType.Iron, ResourceType.Crystal].includes(resource)) return amount;
  const bonus = amount * BALANCE.EXPEDITION_MEAL_LOOT_BONUS;
  const whole = Math.floor(bonus);
  return amount + whole + (bonus > whole && rng() < bonus - whole ? 1 : 0);
}
