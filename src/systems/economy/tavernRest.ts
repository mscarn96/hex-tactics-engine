import { BALANCE } from '@/data/balanceConstants';
import { ResourceType } from '@/models/types';
import { useCalendarStore } from '@/stores/calendarStore';
import { useEmpireStore } from '@/stores/empireStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { usePartyStore } from '@/stores/partyStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { restCost } from './cityServices';
import { isTributeOwed, settleTribute } from '@/systems/world/tribute';
import { collectCurrentTribute, TributeAssessment } from '@/systems/world/tributeCollection';

export function hoursToNextDawn(totalHours: number): number {
  return BALANCE.HOURS_PER_DAY - totalHours % BALANCE.HOURS_PER_DAY;
}
export function quoteRest(summed: number, totalHours: number, gold: number, lastSettledWeek: number, emperorDefeated: boolean) {
  const price = restCost(0, summed);
  const hours = hoursToNextDawn(totalHours);
  const wakeDay = Math.floor((totalHours + hours) / BALANCE.HOURS_PER_DAY) + 1;
  const wakeWeek = Math.floor((totalHours + hours) / (BALANCE.HOURS_PER_DAY * BALANCE.DAYS_PER_WEEK)) + 1;
  const goldAfterBed = gold - price;
  const settlement = isTributeOwed(wakeWeek, lastSettledWeek) ? settleTribute(wakeWeek, goldAfterBed, emperorDefeated) : null;
  const shortfall = settlement?.outcome === 'siege' ? Math.max(0, settlement.demand - goldAfterBed) : 0;
  return { price, hours, wakeDay, wakeWeek, demand: settlement?.demand ?? 0, shortfall };
}
export function quoteTavernRest() {
  const clock = useCalendarStore.getState(), empire = useEmpireStore.getState();
  const summed = usePartyStore.getState().heroes.reduce((sum, h) => sum + h.level, 0);
  return quoteRest(summed, clock.totalHours, useInventoryStore.getState().resources[ResourceType.Gold] ?? 0, empire.lastSettledWeek, empire.emperorDefeated);
}
export type RestResult = { ok: false; reason: 'whole' | 'gold' | 'warning' }
  | { ok: true; tribute: TributeAssessment | null };
/** Spend only after the warning is accepted, roll dawn normally, then provide the paid full rest. */
export function restAtTavern(acceptUnpaidTribute = false): RestResult {
  if (!usePartyStore.getState().needsRest()) return { ok: false, reason: 'whole' };
  const quote = quoteTavernRest();
  const cost = { [ResourceType.Gold]: quote.price };
  if (!useInventoryStore.getState().canAfford(cost)) return { ok: false, reason: 'gold' };
  if (quote.shortfall > 0 && !acceptUnpaidTribute) return { ok: false, reason: 'warning' };
  useInventoryStore.getState().spendResources(cost);
  const map = useWorldMapStore.getState();
  map.moveParty(map.partyPosition, quote.hours);
  usePartyStore.getState().restAll();
  return { ok: true, tribute: collectCurrentTribute() };
}
