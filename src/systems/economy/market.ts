import { ResourceType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { createRNG } from '@/utils/rng';

/** Resource-only exchange. Weekly sell rates are seeded; upgrades narrow the buy spread. */

/** What a unit of each resource is worth before the week moves it. */
const BASE_VALUE: Record<Exclude<ResourceType, ResourceType.Gold>, number> = {
  [ResourceType.Wood]: 4,
  [ResourceType.Stone]: 5,
  [ResourceType.Iron]: 12,
  [ResourceType.Crystal]: 40,
};

export const TRADED_RESOURCES = Object.keys(BASE_VALUE) as Exclude<
  ResourceType,
  ResourceType.Gold
>[];

export interface TradeRate {
  resource: ResourceType;
  /** Gold the player pays for one unit. */
  buy: number;
  /** Gold the player receives for one unit. */
  sell: number;
}

/** A dedicated seed keeps weekly sell prices independent of other rolls and building level. */
const rateRng = (week: number) => createRNG(week * 7919 + 104729);

/**
 * This week's prices.
 *
 * `buy` is always above `sell` by `marketSpread(level)`, which is what stops the
 * market being an infinite gold press: you cannot profit inside a single week,
 * only by holding a resource until its price moves. That is a decision with a
 * cost — the wood you are speculating on is wood you are not building with.
 */
export function tradeRates(week: number, level = 0): TradeRate[] {
  const rng = rateRng(week);
  return TRADED_RESOURCES.map((resource) => {
    const swing = BALANCE.MARKET_SWING;
    const multiplier = 1 - swing + rng.next() * swing * 2;
    const sell = Math.max(1, Math.round(BASE_VALUE[resource] * multiplier));
    return {
      resource,
      sell,
      buy: Math.max(sell + 1, Math.round(sell * marketSpread(level))),
    };
  });
}

/** How far a rate has moved from its base, for the arrow the modal shows. */
export function rateTrend(rate: TradeRate): 'high' | 'low' | 'normal' {
  const base = BASE_VALUE[rate.resource as Exclude<ResourceType, ResourceType.Gold>];
  if (rate.sell >= base * 1.15) return 'high';
  if (rate.sell <= base * 0.85) return 'low';
  return 'normal';
}


export function marketSpread(level: number): number {
  return BALANCE.MARKET_SPREADS[Math.max(0, Math.min(3, Math.floor(level)))];
}
