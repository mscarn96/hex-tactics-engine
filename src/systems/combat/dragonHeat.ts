import type { CombatUnit } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';

/**
 * The Emerald Dragon's heat: the gauge Rising Fire reads (`BossScriptState.heat`).
 *
 * It replaces the plain turn count the passive used to read. The gauge is in steps and shares the
 * old count's scale: reading 1 is his first turn (`DRAGON_RISE_START` of his attack and magic),
 * `DRAGON_RISE_FULL_TURN` is full strength, and it climbs without limit after it. Three things
 * move it: each regular turn of his begins one step up (`beginDragonTurn`), a warning of his that
 * strikes nobody adds one more (`dragonScript.whiff`, via `PreparedSpec.onWhiff`), so does his Furnace Heart
 * bursting (`dragonLanding.landHeart`), and a quench
 * (a broken Furnace Heart, an interrupted Skyfire, a sprawled landing) knocks it down
 * `DRAGON_QUENCH_STEPS`, never below a floor that rises with his turns (`heatFloorOf`): an answer
 * cools him, but a long fight still runs hotter than a short one.
 *
 * Pure, and free of the store, so the passive, the panel and the Node suites read the same numbers.
 */

/** The reading on his first turn, and the lowest the gauge shows. */
export const HEAT_FIRST = 1;
/** The id of the whiff hook that stokes the gauge (`PreparedSpec.onWhiff`). */
export const HEAT_WHIFF = 'dragonHeat';

/** The gauge as it reads now, never below the first reading (before his first turn, and after a quench). */
export const heatOf = (unit: CombatUnit | undefined): number =>
  Math.max(HEAT_FIRST, unit?.bossScript?.heat ?? HEAT_FIRST);

/** What the gauge becomes as a regular turn of his begins: the first reading, then one step each turn. */
export const heatAfterTurnBegun = (unit: CombatUnit | undefined): number =>
  (unit?.bossScript?.heat ?? 0) + 1;

/** What the gauge becomes when a warning of his strikes nobody: one step. */
export const heatAfterWhiff = (unit: CombatUnit | undefined): number =>
  (unit?.bossScript?.heat ?? 0) + 1;

/** What the gauge becomes when his Furnace Heart bursts, on time or on a fallen carrier: one step. */
export const heatAfterBurst = heatAfterWhiff;

/** The lowest a quench can take the gauge: the first reading, plus `DRAGON_QUENCH_FLOOR` of a step per regular turn of his. */
export const heatFloorOf = (unit: CombatUnit | undefined): number =>
  HEAT_FIRST + Math.floor((unit?.bossScript?.phaseTurns ?? 0) * BALANCE.DRAGON_QUENCH_FLOOR);

/** What the gauge becomes when he is quenched: `DRAGON_QUENCH_STEPS` down, but not below his floor. */
export const heatAfterQuench = (unit: CombatUnit | undefined): number =>
  Math.min(heatOf(unit), Math.max(heatFloorOf(unit), heatOf(unit) - BALANCE.DRAGON_QUENCH_STEPS));

/** His attack and magic at a reading, as a share of what he has (1 is full strength). */
export const heatStrength = (heat: number): number =>
  1 + (heat - BALANCE.DRAGON_RISE_FULL_TURN) * BALANCE.DRAGON_RISE_STEP;

/** The reading his next regular turn will begin at. */
export const nextHeatOf = (unit: CombatUnit | undefined): number => heatAfterTurnBegun(unit);
