import { ActiveEffect, AfflictionType, AuraType, CombatUnit } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { isHeldFromHarm, isSealed } from '@/systems/combat/statusEffects';

/**
 * The Skirmisher's Embedded Blades (2026-10 remaster), as pure rules.
 *
 * A victim carries one `AfflictionType.Blades` entry per Skirmisher whose blades
 * are in it (`sourceUnitId`), with the count in `magnitude` and `stacks`. The
 * entry is written here rather than through `applyEffect`, which keeps one effect
 * per type and would let a second Skirmisher overwrite the first one's pile.
 *
 * Blades never tick and never hurt by themselves: the Signature (Blade Recall)
 * pulls its owner's out for the damage, a cleanse removes them like any other
 * affliction, and a body that dies takes them with it.
 */

/** How many of `ownerId`'s blades are in `unit`. */
export function ownBlades(unit: Pick<CombatUnit, 'activeEffects'>, ownerId: string): number {
  return unit.activeEffects
    .filter((e) => e.type === AfflictionType.Blades && e.sourceUnitId === ownerId)
    .reduce((total, e) => total + e.magnitude, 0);
}

/**
 * Whether a blade can go into this unit at all: a living body that is not held
 * out of harm (Invulnerable, a sealed tomb) or warded against afflictions. A boss
 * takes them like anyone: they are no disable.
 */
export function takesBlades(unit: CombatUnit): boolean {
  if (unit.currentHp <= 0 || unit.objective) return false;
  if (isHeldFromHarm(unit.activeEffects) || isSealed(unit)) return false;
  return !unit.activeEffects.some((e) => e.type === AuraType.DebuffImmunity);
}

/** The most of `owner`'s blades one enemy can hold: `BLADES_CAP`, and Buried Steel's rise. */
export function bladesCapOf(owner?: Pick<CombatUnit, 'masteryModifiers'>): number {
  return BALANCE.BLADES_CAP + Math.round(owner?.masteryModifiers?.bladesCapBonus ?? 0);
}

/**
 * The effect list with `count` more of `ownerId`'s blades in it, capped at `cap`
 * (`bladesCapOf` the owner). Other Skirmishers' entries are untouched.
 */
export function withBlades(
  effects: ActiveEffect[], ownerId: string, count: number, appliedAt?: number, cap: number = BALANCE.BLADES_CAP,
): ActiveEffect[] {
  const held = effects.find((e) => e.type === AfflictionType.Blades && e.sourceUnitId === ownerId);
  const next = Math.min(cap, (held?.magnitude ?? 0) + count);
  const entry: ActiveEffect = {
    type: AfflictionType.Blades, magnitude: next, stacks: next, duration: -1, sourceUnitId: ownerId,
    ...(appliedAt !== undefined && { appliedAt }),
  };
  return held ? effects.map((e) => (e === held ? entry : e)) : [...effects, entry];
}

/** The effect list with every one of `ownerId`'s blades pulled out. */
export function withoutBlades(effects: ActiveEffect[], ownerId: string): ActiveEffect[] {
  return effects.filter((e) => !(e.type === AfflictionType.Blades && e.sourceUnitId === ownerId));
}
