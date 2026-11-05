import { createStore as create } from 'zustand/vanilla';
import type { VillageTheme } from '@/data/villages';
import { useCalendarStore } from '@/stores/calendarStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import {
  activeBuff, buffPrice, takeBuff, weeklyBuff, type VillageBuff, type VillageBuffId,
} from '@/systems/economy/villageBuffs';

/**
 * The village buff the party holds, if any: one at a time, an end hour on the
 * campaign clock. The rules are `systems/economy/villageBuffs.ts`; this is the
 * held value and the two ways to get one (buy it with materials, or be given
 * the village's current buff by freeing it). It ends by the clock, never by an
 * event, so nothing here ticks: readers ask through the adapter at the foot of
 * this file, which reads it against the clock.
 */
interface VillageState {
  buff: VillageBuff | null;
  /**
   * Buy this village's buff for the week, paying its materials. Replaces any
   * held buff, this village's or another's. False when the party cannot pay.
   */
  buyBuff: (theme: VillageTheme) => boolean;
  /** The village's current buff, free, for `hours` from now (the liberation reward). */
  grantBuff: (theme: VillageTheme, hours: number) => void;
  /** Restore from a save. */
  restore: (buff: VillageBuff | null) => void;
  reset: () => void;
}

export const useVillageStore = create<VillageState>((set) => ({
  buff: null,

  buyBuff: (theme) => {
    const clock = useCalendarStore.getState();
    const buff = weeklyBuff(theme, clock.weekNumber);
    if (!useInventoryStore.getState().spendResources(buffPrice(buff))) return false;
    set({ buff: takeBuff(theme, buff, clock.totalHours) });
    return true;
  },

  grantBuff: (theme, hours) => {
    const clock = useCalendarStore.getState();
    set({ buff: { ...takeBuff(theme, weeklyBuff(theme, clock.weekNumber), clock.totalHours), untilHour: clock.totalHours + hours } });
  },

  restore: (buff) => set({ buff }),
  reset: () => set({ buff: null }),
}));

// ─── The held buff on the clock now ──────────────────────────────────────────

/**
 * The one place the held buff is read against the clock. Everything a buff does
 * (`systems/economy/villageBuffEffects.ts`) takes the id this hands it, so the
 * rules stay pure and a buff goes back to nothing the hour it ends, with no
 * tick. The two `use…` forms re-render on the buff or the clock moving, so a
 * price drawn from them goes back to full that hour; the plain ones are for an
 * event's moment (a fight being built, a find being paid).
 */
export function villageBuffNow(): VillageBuff | null {
  return activeBuff(useVillageStore.getState().buff, useCalendarStore.getState().totalHours);
}

/** The id of the buff running now, or null. */
export const villageBuffIdNow = (): VillageBuffId | null => villageBuffNow()?.buff ?? null;


