import { BALANCE } from '@/data/balanceConstants';
import type { WrathWeather } from '@/models/world';
import { formatPercent, t } from '@/i18n';

/**
 * Jadeveil's wrath: how provoked the range is, as a live difficulty dial.
 *
 * **Stored as a stamp, read off the clock.** The state holds the bar's value at
 * an hour, the permanent floor and the end of any summit window; what the bar
 * reads *now* is derived from the shared clock (`liveWrath`). Nothing ticks it,
 * so a reload, a crossing or a rest cannot make it drift: the same hour gives
 * the same reading, wherever the party is and whatever happened to the scene.
 *
 * - **Gains** come from deliberate Jadeveil work — a quest done, a lair cleared
 *   (`BALANCE.WRATH_GAIN`) — never from wandering fights, so a lull is a choice.
 * - **Decay** is `WRATH_DECAY_PER_HOUR` on the shared clock, down to the floor.
 * - **Floors** ratchet at 25/50/75%: once reached, the bar never falls below.
 * - **A full bar** opens the summit for `WRATH_WINDOW_HOURS`, holding at full
 *   (the calm before the dragon) and only then falling back towards its floor.
 *   Reaching full again opens it again: the route is repeatable.
 *
 * Pure, so the routes harness and the tests can run it in Node.
 */
export type WrathSource = keyof typeof BALANCE.WRATH_GAIN;

export const WRATH_MAX = 100;

export interface WrathState {
  /** The bar at `at`. */
  value: number;
  /** The hour `value` was true at, and from which it decays. In a window, the window's end. */
  at: number;
  /** The permanent floor reached: 0, 25, 50 or 75. */
  floor: number;
  /** The hour the summit window closes; 0 when none has opened. */
  windowUntil: number;
}

export const NO_WRATH: WrathState = { value: 0, at: 0, floor: 0, windowUntil: 0 };

/** The bar at `now`: held until `at`, then falling by the hour, never below the floor. */
export function liveWrath(state: WrathState, now: number): number {
  if (now <= state.at) return state.value;
  return Math.max(state.floor, state.value - BALANCE.WRATH_DECAY_PER_HOUR * (now - state.at));
}

/** Hours the summit stays open from `now`; 0 when it is shut. */
export function summitWindowHours(state: WrathState, now: number): number {
  return Math.max(0, state.windowUntil - now);
}

/** The highest permanent floor at or under `value`. */
export function floorFor(value: number): number {
  let floor = 0;
  for (const f of BALANCE.WRATH_FLOORS) if (value >= f) floor = f;
  return floor;
}

export interface WrathAward {
  state: WrathState;
  /** What the bar actually rose by — less than asked at the top, nothing in an open window. */
  gained: number;
  /** Floors newly reached by this award, lowest first. */
  floorsReached: number[];
  /** This award filled the bar and opened the summit. */
  opened: boolean;
}

/**
 * Add `amount` to the bar at `now`. A gain while the summit is open is not
 * banked — the bar is already full and the window does not stretch.
 */
export function awardWrath(state: WrathState, now: number, amount: number): WrathAward {
  if (summitWindowHours(state, now) > 0) return { state, gained: 0, floorsReached: [], opened: false };
  const before = liveWrath(state, now);
  const value = Math.min(WRATH_MAX, before + Math.max(0, amount));
  const floor = Math.max(state.floor, floorFor(value));
  const floorsReached = BALANCE.WRATH_FLOORS.filter((f) => f > state.floor && f <= floor);
  const opened = value >= WRATH_MAX;
  const windowUntil = opened ? now + BALANCE.WRATH_WINDOW_HOURS : state.windowUntil;
  return {
    state: { value, at: opened ? windowUntil : now, floor, windowUntil },
    gained: value - before,
    floorsReached,
    opened,
  };
}

export type { WrathWeather };

/**
 * What an award changed for good, kept as values so the map words it when it
 * shows it (`wrathNewsText`): the summit opening, or the highest floor it
 * ratcheted to.
 */
export type WrathNews = { summitOpened: true } | { wrathFloor: number };

/** The news in an award, or `null` for an ordinary rise. */
export function wrathAwardNews(award: WrathAward): WrathNews | null {
  if (award.gained <= 0) return null;
  if (award.opened) return { summitOpened: true };
  const floor = award.floorsReached[award.floorsReached.length - 1];
  return floor !== undefined ? { wrathFloor: floor } : null;
}

/** Wrath news in the current language. */
export function wrathNewsText(news: WrathNews): string {
  return 'summitOpened' in news
    ? t('worldEvents.wrath.summitOpen')
    : t('worldEvents.wrath.floor', { percent: formatPercent(news.wrathFloor / 100) });
}

/** What an award says, in the current language, or `null` when it says nothing. */
export function wrathAwardNotice(award: WrathAward): string | null {
  const news = wrathAwardNews(award);
  return news && wrathNewsText(news);
}

/**
 * Clouds from the first floor, rain from the second, storm from the third, and
 * the stillness of a full bar while the summit is open. Cut at the floors, so
 * the sky says which floor the bar stands over.
 */
export function wrathWeather(wrath: number, windowOpen: boolean): WrathWeather {
  if (windowOpen) return 'calm';
  const [clouds, rain, storm] = BALANCE.WRATH_FLOORS;
  if (wrath >= storm) return 'storm';
  if (wrath >= rain) return 'rain';
  if (wrath >= clouds) return 'clouds';
  return 'clear';
}

/** The weather in force at `now`. */
export function weatherAt(state: WrathState, now: number): WrathWeather {
  return wrathWeather(liveWrath(state, now), summitWindowHours(state, now) > 0);
}

/**
 * The multiplier wrath lays on a Jadeveil fight's enemies: 1 at an empty bar,
 * `1 + WRATH_POWER_AT_FULL` at a full one, linear between. `share` is how much
 * of it reaches the party (a blessing can halve it).
 */
export function wrathPowerScale(wrath: number, share = 1): number {
  return 1 + BALANCE.WRATH_POWER_AT_FULL * (Math.min(WRATH_MAX, Math.max(0, wrath)) / WRATH_MAX) * share;
}

/** Whether a parsed value is a wrath state this build can restore. */
export function isWrathState(value: unknown): value is WrathState {
  const w = value as WrathState | undefined;
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  return !!w
    && finite(w.value) && w.value >= 0 && w.value <= WRATH_MAX
    && finite(w.at) && w.at >= 0
    && (w.floor === 0 || (BALANCE.WRATH_FLOORS as readonly number[]).includes(w.floor))
    && w.value >= w.floor
    && finite(w.windowUntil) && w.windowUntil >= 0;
}
