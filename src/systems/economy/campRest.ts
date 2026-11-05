import { BALANCE } from '@/data/balanceConstants';
import { ResourceType } from '@/models/types';
import { useInventoryStore } from '@/stores/inventoryStore';
import { usePartyStore } from '@/stores/partyStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { restCost } from './cityServices';

/**
 * A night by the foothill camp's fire: Jadeveil's quick recovery.
 *
 * The city's Tavern is a crossing away — twelve hours each way on the shared
 * clock — so a party coming down from the range needs somewhere to mend that
 * is not the whole road home. This is that, and deliberately less than a
 * Tavern: a fixed `CAMP_REST_HOURS` on the clock rather than a sleep to dawn,
 * at `CAMP_REST_PRICE_FRACTION` of the bed's price, and nothing else a city
 * does. It restores what a Tavern rest restores — health and mana, the fallen
 * included — because the camp is this world's home, where a defeat carries the
 * party. The numbers are a first pass, to be judged in playtest.
 */
export function campRestPrice(summedPartyLevel: number): number {
  return Math.max(1, Math.ceil(restCost(0, summedPartyLevel) * BALANCE.CAMP_REST_PRICE_FRACTION));
}

export function quoteCampRest(): { price: number; hours: number } {
  const summed = usePartyStore.getState().heroes.reduce((sum, h) => sum + h.level, 0);
  return { price: campRestPrice(summed), hours: BALANCE.CAMP_REST_HOURS };
}

export type CampRestResult = { ok: false; reason: 'whole' | 'gold' } | { ok: true; hours: number };

/** Spend the gold, pass the hours (a dawn on the way heals as any dawn does), then mend everyone. */
export function restAtCamp(): CampRestResult {
  if (!usePartyStore.getState().needsRest()) return { ok: false, reason: 'whole' };
  const quote = quoteCampRest();
  const cost = { [ResourceType.Gold]: quote.price };
  if (!useInventoryStore.getState().canAfford(cost)) return { ok: false, reason: 'gold' };
  useInventoryStore.getState().spendResources(cost);
  const map = useWorldMapStore.getState();
  map.moveParty(map.partyPosition, quote.hours);
  usePartyStore.getState().restAll();
  return { ok: true, hours: quote.hours };
}
