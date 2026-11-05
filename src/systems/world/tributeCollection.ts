import { ResourceType } from '@/models/types';
import { useCalendarStore } from '@/stores/calendarStore';
import { useEmpireStore } from '@/stores/empireStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { useGameStore } from '@/stores/gameStore';
import { useLocationStore } from '@/stores/locationStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { isTributeOwed, settleTribute, siegeContext, siegeEncounterId, TributeSettlement } from './tribute';

export interface TributeAssessment {
  week: number;
  gold: number;
  settlement: TributeSettlement;
}
/** Read the pending weekly decision without deducting or settling anything. */
export function collectCurrentTribute(): TributeAssessment | null {
  const empire = useEmpireStore.getState();
  const week = useCalendarStore.getState().weekNumber;
  // The first week is the opening, not a rollover: nothing to decide until it ends.
  // Once the Emperor is dead there is nothing to decide at all, so no week stops
  // to say so (playtest 2026-10-24).
  if (week <= 1 || empire.emperorDefeated || empire.castleTier !== null || useLocationStore.getState().current === 'castle'
    || !isTributeOwed(week, empire.lastSettledWeek)) return null;
  const gold = useInventoryStore.getState().resources[ResourceType.Gold] ?? 0;
  const settlement = settleTribute(week, gold, empire.emperorDefeated);
  return { week, gold, settlement };
}

/**
 * The weekly decision to put in front of the player now, or null while it waits.
 *
 * The assessment itself (`collectCurrentTribute`) does not care where the party
 * stands; showing it does. Inside a city building the decision waits until the
 * party leaves it, so a tavern night that ends the week asks for the tribute on
 * the street rather than over the bed it just paid for (PT-04, playtest
 * 2026-10-17).
 */
export function weeklyDecisionDue(): TributeAssessment | null {
  if (useLocationStore.getState().building !== null) return null;
  return collectCurrentTribute();
}

/**
 * Whether a journey on the map must stop for the weekly decision: exactly when there is one
 * to make. Not `isTributeOwed` alone, which is true for all of week one and once the castle
 * is open — the walk halted after every hex then, though no decision ever came.
 */
export const tributeStopsTravel = (): boolean => collectCurrentTribute() !== null;

/** Commit only an explicitly chosen payment/acknowledgement. Refusal is `refuseCurrentTribute`. */
export function payCurrentTribute(week: number): boolean {
  const assessment = collectCurrentTribute();
  if (!assessment || assessment.week !== week || assessment.settlement.outcome === 'siege') return false;
  const paid = assessment.settlement.goldSpent;
  if (paid) useInventoryStore.getState().addResource(ResourceType.Gold, -paid);
  useEmpireStore.getState().settleWeek(week, paid);
  return true;
}

/**
 * Refuse this week's bill: keep the gold, recall the party home and start the siege in the city.
 * Refusal is open even when the purse could cover the bill. Returns whether a siege started.
 */
export function refuseCurrentTribute(week: number): boolean {
  const assessment = collectCurrentTribute();
  if (!assessment || assessment.week !== week || assessment.settlement.demand <= 0) return false;
  const empire = useEmpireStore.getState();
  empire.settleWeek(week, 0); empire.recordSiege();
  useLocationStore.getState().leave();
  const map = useWorldMapStore.getState(), home = map.getCityCoord();
  if (home) map.moveParty(home, 0);
  useGameStore.getState().startEncounter(siegeEncounterId(week), siegeContext());
  return true;
}
