import { BALANCE } from '@/data/balanceConstants';
import { useCalendarStore } from '@/stores/calendarStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { useWorldMapStore } from '@/stores/worldMapStore';

/**
 * Warding incense (playtest 2026-10-14): lit from the bag, it halves the world
 * map's encounters for seven days from now — today's already-live ones at once,
 * and each dawn's roll after. A lair's fights are its chambers, never a roll, so
 * it does nothing inside one; the week still burns while the party is there.
 */
export function lightWard(): boolean {
  if (!useInventoryStore.getState().spendWard()) return false;
  const now = useCalendarStore.getState().totalHours;
  useWorldMapStore.getState().lightWard(now + BALANCE.WARD_HOURS);
  return true;
}

/** Hours of ward left, 0 when none burns. */
export function wardHoursLeft(): number {
  return Math.max(0, useWorldMapStore.getState().wardUntil - useCalendarStore.getState().totalHours);
}
