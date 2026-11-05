import { AuraType, CombatUnit, HeroSkill, HeroStats, WildFormId } from '@/models/types';

/**
 * Becoming something else, mid-fight.
 *
 * Two features want the same operation: a Druid shifting into a bear, and a boss
 * crossing a health threshold into its next phase. Both swap a unit's stats and
 * its entire skill list in one write, and the alternative — a parallel
 * `bossPhase` path duplicating what `setWildForm` already does — is cheaper
 * today and two things to keep in sync forever.
 *
 * So the shared part lives here, and Wildshape and boss phases are its two
 * callers. Wildshape keeps `wildForm` on the unit because the *model key* is
 * genuinely Wildshape-specific; everything else about a shift is this.
 */

/** Per-stat multipliers. Absent keys are left alone. */
export type StatMultipliers = Partial<Record<keyof HeroStats, number>>;

/**
 * What a unit becomes: a stat profile and a kit, both replacing what it had.
 *
 * Skills are carried as resolved objects rather than ids on purpose. The id
 * resolver lives in `systems/mastery.ts`, and a boss's phase data importing it
 * would close a cycle back through this file — holding the skills directly
 * sidesteps the lookup entirely and costs nothing.
 */
export interface UnitForm {
  stats?: StatMultipliers;
  skills: HeroSkill[];
}

/**
 * Layers a form's multipliers over a stat block.
 *
 * Multiplicative, so a level-20 Druid gets a level-20 bear and a tier-5
 * Aethelred gets tier-5 phases. Two stats must never appear in a profile, and
 * for reasons that outlive whoever wrote the profile:
 *
 * - **`maxHp`** — for a boss this is worse than awkward: the phase *triggers*
 *   are HP thresholds, so changing max HP on entry re-triggers the thing that
 *   caused it. Wildshape has no thresholds and does want a health pool, so it
 *   scales max HP through `CombatUnit.formVigor` instead — a separate field
 *   precisely so a boss profile cannot reach it. See `combatMaxHp` below.
 * - **`speed`** — `turnOrder` is sorted once at init and never re-sorted, so a
 *   mid-fight speed change does precisely nothing.
 *
 * Both are pinned by tests rather than left to a comment.
 */
export function applyStatMultipliers(stats: HeroStats, mults?: StatMultipliers | null): HeroStats {
  if (!mults) return stats;

  const out = { ...stats };
  // A form's Defense multiplier is a body, and bodies resist both kinds of hit.
  // Only a *stated* Magic Defense needs it spelled out: an unstated one tracks
  // the multiplied `defense` already.
  const effective: Partial<Record<keyof HeroStats, number>> = { ...mults };
  if (effective.magicDefense === undefined && effective.defense !== undefined) {
    effective.magicDefense = effective.defense;
  }
  for (const [key, mul] of Object.entries(effective) as [keyof HeroStats, number][]) {
    const value = out[key];
    if (value === undefined) continue;
    // Move range is walked in whole hexes; rounding down would make a ×1.0
    // multiplier on an odd value quietly cost a hex
    out[key] = key === 'moveRange'
      ? Math.max(1, Math.round(value * mul))
      : Math.round(value * mul);
  }
  return out;
}

/**
 * Max HP as it stands in this fight, as opposed to the hero's own.
 *
 * The split the Bear needed. `unit.stats.maxHp` is what the hero walks around
 * with between fights and what a victory writes back; this is the pool they are
 * fighting out of right now. Everything asking "how hurt is this unit" has to
 * ask here — a bear at 120/150 read against a base of 100 looks over-healed,
 * and every percentage passive then answers nonsense.
 *
 * `bossPhases` deliberately does **not** use it: a threshold is a fraction of
 * the boss's own maximum. Bosses never carry `formVigor` so the two agree
 * numerically; keeping them apart is what stops that staying true by accident.
 */
export function combatMaxHp(unit: CombatUnit): number {
  // The Brigand Captain's word raises the pool the unit fights out of, like a shape does
  const word = unit.activeEffects?.find((e) => e.type === AuraType.Authority)?.magnitude ?? 0;
  return Math.max(1, Math.round(unit.stats.maxHp * (unit.formVigor ?? 1) * (1 + word)));
}

/**
 * Second Nature: whether a regular turn this unit begins now is a step. Bear, Wolf
 * and Hawk count, for a hero holding the node; standing upright and Apex never do.
 */
export function settlesShape(unit: CombatUnit): boolean {
  return !!unit.masteryModifiers?.shapeSettledBonus && !!unit.wildForm && unit.wildForm !== 'apex';
}

/** Second Nature: the share of the worn shape's Attack and defences its steps add now. */
export function secondNatureShare(unit: CombatUnit): number {
  return settlesShape(unit) ? (unit.masteryModifiers?.shapeSettledBonus ?? 0) * (unit.shapeTurns ?? 0) : 0;
}

/** Whether this unit is currently wearing a form of any kind. */
export function hasForm(unit: CombatUnit): boolean {
  return unit.formStats !== undefined || unit.wildForm != null;
}

/**
 * The shape this Druid *chose*, whether or not they are currently wearing it.
 *
 * Derived from the shift skill they hold rather than stored, which is the same
 * argument `lairs` makes about completion: the tier-1 exclusive group already
 * guarantees at most one, so a second record of it is a second thing that can
 * disagree. `wildshape.currentForm` is a different question — it answers "what
 * are you right now", and Primal Bond is cast standing upright with the answer
 * null.
 *
 * **It lives here rather than beside `currentForm` because of what imports it.**
 * `passives.ts` needs it, and `wildshape.ts` reaches
 * `systems/progression/mastery` for `skillsForForm` — which reaches
 * `inventoryStore`, and so `@/platform/uuid`, and so React Native. That edge put
 * every pure mastery consumer downstream of a store: a private tool imports
 * `PASSIVE_DEFS`, and the icon pipeline loads the same modules through Vite, so
 * both died in dependency optimisation on React Native's Flow syntax with
 * nothing about a passive in the stack. This module imports nothing but types,
 * which is the property that has to be defended — `chosenForm` is a one-line
 * read of a unit's own skills and never needed anything more.
 */
export function chosenForm(unit: CombatUnit): WildFormId | null {
  return unit.skills.find((s) => s.shiftsTo)?.shiftsTo ?? null;
}
