import type { CombatUnit } from '@/models/types';

/**
 * The boss's unharmed-round counter (`BossScriptState.unharmedRounds`).
 *
 * The count of his regular turns begun since a hero last damaged him. `damageFunnel` sets it to 0 on
 * any hero damage; each boss's regular turn start adds one, after its script's own turn start has read
 * it (`bossRegistry.turnBegun`, run by `scriptRegistry`). A Fury action or a speed bonus turn takes the
 * short road in `beginTurn`, which never reaches those starts, so neither counts nor resets it. Pure:
 * the store writes it.
 */

/** The counter as it reads now; 0 for a unit with no script. */
export const unharmedRoundsOf = (unit: CombatUnit | undefined): number => unit?.bossScript?.unharmedRounds ?? 0;

/** What the counter becomes as a regular turn of his begins. */
export const afterRegularTurnBegun = (unit: CombatUnit | undefined): number => unharmedRoundsOf(unit) + 1;

/**
 * Whether a whole round passed without a hero damaging him, read as his turn begins: the turn before
 * this one began after the last damage (1) and this one did too (2). The first turn of a fight, or
 * the first after a blow, is therefore never "a round unharmed".
 */
export const wholeRoundUnharmed = (unit: CombatUnit | undefined): boolean => unharmedRoundsOf(unit) >= 2;
