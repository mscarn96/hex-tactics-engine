import { BALANCE } from '@/data/balanceConstants';
import { locationContext } from '@/locations';
import type { EncounterContext } from '@/models/encounter';

/**
 * The Obsidian tribute — rent on the land the castle stands on.
 *
 * Pure: this file decides *what* is owed and *what happens*, and nothing else.
 * Deducting gold, showing the dialog and starting the siege all live at the call
 * site, so the rules stay testable in the node environment.
 *
 * The clock runs on weeks rather than on party strength. Slowness is the thing
 * being punished — a player who wanders gets squeezed, a player who pushes hard
 * is not taxed for succeeding.
 */

export type TributeOutcome = 'grace' | 'free' | 'paid' | 'siege';

export interface TributeSettlement {
  outcome: TributeOutcome;
  /** What was demanded. Zero during grace, or once the emperor is dead. */
  demand: number;
  /** Deducted from the purse. Zero unless `outcome` is 'paid'. */
  goldSpent: number;
}

/**
 * Gold owed at the start of `week`.
 *
 * Geometric, so the demand outruns a fixed income and the player has to keep
 * finding better ground. Rounded to something a player can read at a glance —
 * "1,240 gold" is a number you remember, "1,237" is noise.
 */
export function tributeDemand(week: number): number {
  if (week <= BALANCE.TRIBUTE_GRACE_WEEKS) return 0;
  const chargeable = week - BALANCE.TRIBUTE_GRACE_WEEKS;
  const early = Math.min(chargeable - 1, BALANCE.TRIBUTE_EARLY_BILLS - 1);
  const late = Math.max(0, chargeable - BALANCE.TRIBUTE_EARLY_BILLS);
  const raw = BALANCE.TRIBUTE_BASE * Math.pow(BALANCE.TRIBUTE_GROWTH, early)
    * Math.pow(BALANCE.TRIBUTE_LATE_GROWTH, late);
  return Math.round(raw / 10) * 10;
}

/**
 * What happens when `week` comes due.
 *
 * Takes gold rather than reading the store so the decision can be tested and so
 * the caller keeps ownership of the write. There is nothing to pay early and no
 * balance to run down: rent is settled from whatever is in the purse at the
 * rollover, which is what makes every purchase during the week a bet.
 */
export function settleTribute(
  week: number,
  gold: number,
  emperorDefeated: boolean,
): TributeSettlement {
  // The debt dies with the man collecting it
  if (emperorDefeated) return { outcome: 'free', demand: 0, goldSpent: 0 };

  const demand = tributeDemand(week);
  if (demand <= 0) return { outcome: 'grace', demand: 0, goldSpent: 0 };

  if (gold >= demand) return { outcome: 'paid', demand, goldSpent: demand };
  return { outcome: 'siege', demand, goldSpent: 0 };
}

/**
 * Whether `week` is still owed.
 *
 * Compares against the last week actually settled rather than tracking a due
 * date, so a player who walks through several weeks in one journey — or reloads
 * a save mid-week — settles each one exactly once.
 */
export function isTributeOwed(week: number, lastSettledWeek: number): boolean {
  return week > lastSettledWeek;
}

/**
 * How much stronger the siege army is in a given week.
 *
 * Multiplies the usual party-level scaling rather than replacing it: the Legion
 * grows on the calendar *and* keeps pace with the party, so it never becomes the
 * fight you have already outgrown.
 */
export function siegePowerScale(week: number): number {
  return BALANCE.SIEGE_BASE_POWER + BALANCE.SIEGE_POWER_PER_WEEK * Math.max(0, week - 1);
}

/** How many soldiers arrive. Capped at what the arena's spawn row can hold. */
export function siegeArmySize(week: number): number {
  const extra = Math.floor(Math.max(0, week - 1) / BALANCE.SIEGE_WEEKS_PER_EXTRA_ENEMY);
  return Math.min(BALANCE.SIEGE_MAX_ENEMIES, BALANCE.SIEGE_BASE_ENEMIES + extra);
}

/** Encounter id for the siege in `week`. Decoded by `encounterGenerator`. */
export function siegeEncounterId(week: number): string {
  return `empire_siege_${week}`;
}

/**
 * Where a siege is fought: the city's own streets, not the ground under its hex.
 *
 * It used to be the city tile's world context, so the sacking of the player's
 * town drew whatever field kit that tile's terrain rolled — the same plains a
 * wandering fight is fought on. The city is a location fought in the open air
 * (`openCountry`), so this lights and dresses it outdoors.
 */
export function siegeContext(): EncounterContext {
  return locationContext('city');
}

/** The week encoded in a siege encounter id, or null if it is not one. */
export function siegeWeekFromId(encounterId: string): number | null {
  if (!encounterId.startsWith('empire_siege_')) return null;
  const week = parseInt(encounterId.slice('empire_siege_'.length), 10);
  return Number.isFinite(week) ? week : null;
}
