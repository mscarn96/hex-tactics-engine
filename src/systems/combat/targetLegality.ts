import type { CombatUnit, HeroSkill } from '@/models/types';
import { duelBars } from '@/systems/combat/duelRules';
import { isHiddenFrom, meetsTargetRequirement } from '@/systems/combat/statusEffects';

/**
 * Who may be struck, in one place.
 *
 * "May this blow touch that unit" was rebuilt at more than ten sites — the highlight
 * pass, seven in the resolver, the AI's scorer, the elites' own scoring — each from a
 * slightly different subset of alive, opposite side, the rune circle, a gated skill's
 * requirement and stealth, and four modules kept a private `alive`. A rule one site had
 * and another lacked is a hex the board offers and the resolver refuses, or a target
 * the AI scores and then wastes its turn on. These are the answers they all read.
 */

/** A unit still on its feet. Objectives count: they are bodies that can be struck. */
export const isAlive = (unit: CombatUnit): boolean => unit.currentHp > 0;

/** The living units on the other side of the board from `unit`. */
export const foesOf = (unit: CombatUnit, units: readonly CombatUnit[]): CombatUnit[] =>
  units.filter((u) => isAlive(u) && u.isPlayer !== unit.isPlayer);

/** The living units on `unit`'s own side, itself included unless `except` says otherwise. */
export const alliesOf = (unit: CombatUnit, units: readonly CombatUnit[], except = false): CombatUnit[] =>
  units.filter((u) => isAlive(u) && u.isPlayer === unit.isPlayer && !(except && u.id === unit.id));

/** Living heroes only — what a script that marks "a hero" chooses among: no summon, no objective. */
export const heroesOf = (units: readonly CombatUnit[]): CombatUnit[] =>
  units.filter((u) => u.isPlayer && isAlive(u) && !u.objective && !u.summonedBy);

/**
 * Whether `caster`'s `skill` may land a blow on `target`: it is alive, it is on the
 * other side, the Jarl's rune circle lets the two reach each other, and a gated
 * skill's requirement (an execute's wounded-enough, a finisher's mark) is met.
 *
 * What the resolver refuses with, so what the highlights offer and the AI scores
 * must be exactly this.
 */
export function canStrike(caster: CombatUnit, target: CombatUnit, skill: HeroSkill): boolean {
  return (
    isAlive(target)
    && target.isPlayer !== caster.isPlayer
    && !duelBars(caster, target)
    && meetsTargetRequirement(caster, target, skill)
  );
}

/**
 * Whether the skill may be *aimed* at `target`: it may strike it, and stealth does not
 * hide it from a single-target pick. Area skills ignore stealth and can sweep a hidden
 * unit out, which is why the resolver asks `canStrike` and a selection asks this.
 */
export function canAim(caster: CombatUnit, target: CombatUnit, skill: HeroSkill): boolean {
  return canStrike(caster, target, skill) && !isHiddenFrom(target, skill);
}
