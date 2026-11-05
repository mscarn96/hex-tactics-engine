import { createStore as create } from 'zustand/vanilla';
import { BALANCE } from '@/data/balanceConstants';

const HOURS_PER_WEEK = BALANCE.HOURS_PER_DAY * BALANCE.DAYS_PER_WEEK;

/**
 * What a walk did to the clock. Both flags are "a boundary was crossed", not
 * "exactly one boundary was crossed" — a long journey can roll several days at
 * once and each consumer still fires its once-per-rollover work a single time.
 */
export interface CalendarRollover {
  dayChanged: boolean;
  weekChanged: boolean;
}

/**
 * The campaign clock, on its own.
 *
 * This lived on `worldMapStore` and was the whole reason for two require cycles:
 * `statCalc` needed the week number (the removed barracks drill compared its
 * stamp against the calendar), so `partyStore → statCalc → worldMapStore →
 * partyStore` closed, and `statCalc → worldMapStore → statCalc` closed with it.
 * Metro allows cycles and warns, but a cycle is a module that can be reached
 * before it has finished evaluating — the failure is an `undefined` at import
 * time, which is invisible until it is not.
 *
 * The fix is that this module imports **nothing but `BALANCE`**, so it cannot be
 * in a cycle however the layers above it grow. Everything that used to read
 * `useWorldMapStore(s => s.weekNumber)` reads it here instead.
 *
 * **`advance` is the only writer, and it derives the day and the week from
 * `totalHours` rather than counting them.** There is exactly one clock; a day
 * number incremented separately is a second one, and two clocks are a thing that
 * can disagree. `loadClock` exists only because a save has to restore the hour.
 */
interface CalendarState {
  /** Total in-game hours elapsed — one per tile walked. The only stored fact. */
  totalHours: number;
  /** Absolute day count, starts at 1. Derived from `totalHours`. */
  dayNumber: number;
  /** Absolute week count, starts at 1. Derived from `totalHours`. */
  weekNumber: number;

  /** Walk `hours` forward and report which boundaries that crossed. */
  advance: (hours: number) => CalendarRollover;
  /** Restore the clock from a save. The day and week follow from the hour. */
  loadClock: (totalHours: number) => void;
  reset: () => void;
}

/** The day a given hour falls in. Days and weeks both count from 1. */
export const dayAt = (totalHours: number) =>
  Math.floor(totalHours / BALANCE.HOURS_PER_DAY) + 1;

/**
 * Days until the week turns over and the weekly things recharge — a magic well, a
 * resource node. On the week's last day that is 1: the recharge lands at its
 * dawn, not at its dusk.
 */
export const daysUntilNewWeek = (dayNumber: number) =>
  BALANCE.DAYS_PER_WEEK - ((dayNumber - 1) % BALANCE.DAYS_PER_WEEK);

export const weekAt = (totalHours: number) =>
  Math.floor(totalHours / HOURS_PER_WEEK) + 1;

export const useCalendarStore = create<CalendarState>((set, get) => ({
  totalHours: 0,
  dayNumber: 1,
  weekNumber: 1,

  advance: (hours) => {
    const state = get();
    const totalHours = state.totalHours + hours;
    const dayNumber = dayAt(totalHours);
    const weekNumber = weekAt(totalHours);

    const rollover: CalendarRollover = {
      dayChanged: dayNumber !== state.dayNumber,
      weekChanged: weekNumber !== state.weekNumber,
    };

    set({ totalHours, dayNumber, weekNumber });
    return rollover;
  },

  loadClock: (totalHours) =>
    set({ totalHours, dayNumber: dayAt(totalHours), weekNumber: weekAt(totalHours) }),

  reset: () => set({ totalHours: 0, dayNumber: 1, weekNumber: 1 }),
}));
