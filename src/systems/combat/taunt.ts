import { AfflictionType, CombatUnit } from '@/models/types';

/**
 * Who a taunted unit is compelled to attack, or `null` if it is free to choose.
 *
 * Taunt was previously read with an open-coded `activeEffects.find(Taunt)` in
 * two places — the AI's turn planner and the player's targeting guard. `find`
 * returns whichever taunt happens to sit first in the array, so with two
 * taunters the two paths could disagree about who the enemy is locked onto.
 * One helper, one answer.
 *
 * `magnitude` is threat: the loudest taunt wins. Ties break to the most
 * recently applied, so a fresh taunt always takes over from a stale one of
 * equal strength — a second tank stepping in should work, and "nothing happens"
 * is the worst possible outcome for a button whose entire job is redirection.
 *
 * A dead taunter compels nobody; callers may then clear the effect.
 */
export function activeTaunt(unit: CombatUnit, allUnits: CombatUnit[]): CombatUnit | null {
  let best: { taunter: CombatUnit; magnitude: number; appliedAt: number } | null = null;

  for (const effect of unit.activeEffects) {
    if (effect.type !== AfflictionType.Taunt || !effect.sourceUnitId) continue;

    const taunter = allUnits.find((u) => u.id === effect.sourceUnitId && u.currentHp > 0);
    if (!taunter) continue;

    const appliedAt = effect.appliedAt ?? 0;
    if (
      !best ||
      effect.magnitude > best.magnitude ||
      (effect.magnitude === best.magnitude && appliedAt >= best.appliedAt)
    ) {
      best = { taunter, magnitude: effect.magnitude, appliedAt };
    }
  }

  return best?.taunter ?? null;
}

/**
 * True when the unit carries a taunt whose source is gone.
 *
 * Kept next to `activeTaunt` because the two answers differ in exactly one
 * case — taunted by a corpse — and that is the case the cleanup paths care
 * about.
 */
export function hasStaleTaunt(unit: CombatUnit, allUnits: CombatUnit[]): boolean {
  return (
    unit.activeEffects.some((e) => e.type === AfflictionType.Taunt) &&
    activeTaunt(unit, allUnits) === null
  );
}
