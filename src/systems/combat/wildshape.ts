import {
  CarriedWildFormId,
  CombatUnit,
  Hero,
  HeroSkill,
  HeroStats,
  LEVEL_SCALE,
  WildFormId,
} from '@/models/types';
import { WILD_FORMS, magicConversion } from '@/data/templates/wildForms';
import { applyMasteryModifiers, findSkill } from '@/systems/progression/mastery';
import { StatMultipliers, applyStatMultipliers } from '@/systems/combat/forms';

/**
 * Wildshape rules, kept pure so the store has nothing to decide.
 *
 * A shift is a whole-unit swap: silhouette, stats and kit change together. The
 * one piece of it that outlives the fight is *which animal* (PT-16): the shape a
 * living Druid ends a fight in is written to `Hero.wildForm` (`formToCarry`) and
 * taken again at the start of the next (`openingForm`, `openingForms`). Stats,
 * kit and health are rebuilt from the hero exactly as a cast would build them.
 */

/** The shapes that outlive a fight. Apex does not: see `CarriedWildFormId`. */
export const CARRIED_WILD_FORMS: readonly CarriedWildFormId[] = ['bear', 'wolf', 'hawk'];

function isCarried(form: unknown): form is CarriedWildFormId {
  return CARRIED_WILD_FORMS.includes(form as CarriedWildFormId);
}

/**
 * The shape a hero takes home from a fight that has just ended: the animal they
 * are wearing, if they are standing and it is one of the three.
 *
 * **Apex is not carried, and a fight ended in it is carried as the Druid's own
 * shape.** Apex is a three-turn burst whose clock and spent spells belong to the
 * fight, and whose long cooldown starts when it is left; carrying it would hand
 * the next fight a free burst with no clock on it. Reverting to the animal the
 * Druid entered Apex from would be a guess the game does not keep, and leaving
 * Apex in a fight already returns the Druid to Druid form — so the next fight
 * starts the way that reversion would have ended. A fallen Druid also wakes in
 * their own shape: the fight ended for them before it did for the party.
 */
export function formToCarry(unit: CombatUnit): CarriedWildFormId | null {
  if (unit.currentHp <= 0) return null;
  return isCarried(unit.wildForm) ? unit.wildForm : null;
}

/**
 * The shape a hero begins a fight in: the carried animal, while they still know
 * the shift skill into it. A respec or a path change that took the shape away
 * leaves a stale `wildForm` behind, and it is read as their own shape rather than
 * as a beast they could never have become.
 */
export function openingForm(hero: Hero): CarriedWildFormId | null {
  const form = hero.wildForm;
  if (!isCarried(form)) return null;
  return hero.skills.some((s) => s.shiftsTo === form) ? form : null;
}

/** The beast this unit is wearing, or null if it is in its own shape. */
export function currentForm(unit: CombatUnit): WildFormId | null {
  return unit.wildForm ?? null;
}

export function isShifted(unit: CombatUnit): boolean {
  return currentForm(unit) !== null;
}

/**
 * What casting `skill` should do.
 *
 * A shift skill cast while already wearing its own shape reverts instead, which
 * is what lets one button cover both directions.
 */
export function resolveShift(unit: CombatUnit, skill: HeroSkill): WildFormId | null | undefined {
  if (!skill.shiftsTo) return undefined;
  return currentForm(unit) === skill.shiftsTo ? null : skill.shiftsTo;
}

/**
 * Whether a shift costs the turn it is cast on.
 *
 * Asymmetric on purpose, and the asymmetry is the whole fix. Charging a turn in
 * both directions made Wildshape strictly worse than not using it: a Druid who
 * shifted paid a turn to arrive, fought at bear stats, then paid another turn to
 * get their heals back — so standing still in the upright shape and healing
 * yourself out-tanked the tank. Going *in* is now free, which is what makes the
 * first turn of a fight a shift rather than a loss.
 *
 * Coming back still costs, and so does beast-to-beast: the point is to be the
 * animal, not to flicker between Bear and Wolf picking whichever cooldown is up.
 *
 * **Entering Apex is free from any shape** (remaster, 2026-10). It lasts three
 * turns and holds three spells; charging the entry from Wolf would spend one of
 * the three on the shift. Leaving Apex is still a revert like any other.
 */
export function shiftEndsTurn(unit: CombatUnit, into: WildFormId | null): boolean {
  if (into === 'apex') return false;
  return !(currentForm(unit) === null && into !== null);
}

/** Whether the Apex shape is over: its clock shows its last turn, or all three spells are used. */
export function apexSpentAll(unit: CombatUnit): boolean {
  return WILD_FORMS.apex.skills.every((id) => unit.apexSpent?.includes(id));
}

/** Whether this Apex spell was already used in the current Apex shape. */
export function apexSpellSpent(unit: CombatUnit, skill: HeroSkill): boolean {
  return skill.formSkill === 'apex' && !!unit.apexSpent?.includes(skill.id);
}

/** The shift skills a unit knows — the ones that survive a shift. */
export function shiftSkills(skills: HeroSkill[]): HeroSkill[] {
  return skills.filter((s) => s.shiftsTo !== undefined);
}

/**
 * The kit for a shape.
 *
 * Three things in order: the shape's innate pair (a free basic attack and a
 * signature, which arrive with the shape and are never bought), then whatever
 * the tree has taught *that* shape, then every shift skill the hero knows — so
 * moving bear → wolf is one action rather than a revert plus a shift.
 *
 * Mastery modifiers are applied here too, but **only to the innate pair** — they
 * are the one thing this function looks up for itself, from `findSkill`, so they
 * arrive raw. Everything drawn out of `humanSkills` is already tuned:
 * `createPlayerUnits` bakes the hero's modifiers into that list once, which is
 * what the HUD, the targeting highlights and the damage resolution all read.
 * Tuning it again here would add a range bonus twice and multiply a set piece's
 * power bonus by itself. A Druid who bought extra taunt duration still gets it on
 * Roar, a skill they have never held as a person, which is what the argument is
 * actually for.
 *
 * Standing upright, the learned form skills are filtered *out*. They live on
 * `hero.skills` like everything else the tree grants — one list, one derivation
 * — and this is the single place that decides which paws they need.
 */
export function skillsForForm(
  form: WildFormId | null,
  humanSkills: HeroSkill[],
  modifiers: CombatUnit['masteryModifiers'],
): HeroSkill[] {
  const tune = (s: HeroSkill) => (modifiers ? applyMasteryModifiers(s, modifiers) : s);

  if (form === null) {
    const upright = humanSkills.filter((s) => !s.formSkill);
    // Identity-preserving for the overwhelmingly common case of a hero who owns
    // no form skills at all — every non-Druid, and every Druid on another path
    return upright.length === humanSkills.length ? humanSkills : upright;
  }

  const innate: HeroSkill[] = [];
  for (const id of WILD_FORMS[form].skills) {
    const skill = findSkill(id);
    if (skill) innate.push(tune(skill));
  }
  const innateIds = new Set(innate.map((s) => s.id));
  const learned = humanSkills.filter((s) => s.formSkill === form && !innateIds.has(s.id));
  // Primal Surge and Ancestral Hunt (remaster, 2026-10): the form-usable capstones
  // ride along into every shape, and only they — the rest of the upright kit stays
  // behind. The tree's exclusive capstone group means an Apex Druid owns neither.
  const anyForm = humanSkills.filter((s) => s.anyForm);

  return [...innate, ...learned, ...anyForm, ...shiftSkills(humanSkills)];
}

/**
 * How far up its node the shape a unit is putting on was bought.
 *
 * Defaults to the **middle** rung, which is the same convention `passiveRank`
 * documents: every authored number in `WILD_FORMS` is the level-2 value, so a
 * unit with no tree behind it — a test fixture, the sim harness, anything built
 * before `formRanks` existed — wears exactly the shape the table describes.
 */
function shapeScale(unit: CombatUnit, form: WildFormId): number {
  return formScale(unit.formRanks?.[form] ?? 2);
}

/** What a shape node held at `level` is worth: `LEVEL_SCALE`, clamped to its rungs. */
export function formScale(level: number): number {
  return LEVEL_SCALE[Math.min(Math.max(level, 1), LEVEL_SCALE.length) - 1];
}

/** A shape as one particular Druid wears it: the numbers, not the silhouette. */
export interface WornForm {
  /** Multipliers for `formStats`, already scaled by the node's level. */
  stats: StatMultipliers;
  /** `formVigor`, likewise — and carrying the Bear's converted magic. */
  vigor: number;
  /** Flat stats the shape adds, for `formBonus`. Never `maxHp` — see below. */
  bonus?: Partial<HeroStats>;
}

/**
 * What this unit actually becomes on putting `form` on.
 *
 * Two things the raw `WILD_FORMS` entry does not know about:
 *
 * **The node's level scales the *distance from 1.0*, never the multiplier.** A
 * shape node holds three levels like everything else in the tree, and until this
 * existed a level-3 Bear Form was byte-identical to a level-1 one — `levelScale`
 * reaches a granted skill's damage and healing, and a shift skill has neither.
 * Scaling `1.25` directly would be the obvious version and it is wrong in a way
 * that inverts the ladder: the Hawk's `defense ×0.7` would become `×0.525` at
 * rank 1, i.e. *better*-value-for-a-cheaper-node in one direction and worse in
 * the other, and a `×1.0` on Apex's magic would drift off 1 for no reason. The
 * delta is what a shape *is*, so the delta is what a point buys: the Bear's
 * `×1.25` attack runs ×1.19 / ×1.25 / ×1.31, and `vigor` rides the same scale so
 * the pool grows with it.
 *
 * **The Druid's magic comes with them.** See `magicConversion` — the claws take
 * it as attack through `bonus`, the Bear takes it as health through `vigor`.
 *
 * Health has to arrive as vigor rather than as a flat `bonus.maxHp`, and that is
 * not a preference: `formVigor` is the single number relating the beast's pool to
 * the hero's own, and `CombatScene`'s victory write-back divides current HP by it
 * to put health back on the Hero. Anything that grows the pool and is not in that
 * number is health laundered out of a fight that ended mid-shift — and
 * `combatMaxHp`, which is what the bar, the heal cap and every percentage passive
 * read, would not see it either.
 */
export function wornForm(unit: CombatUnit, form: WildFormId): WornForm {
  const worn = wornFormAt(form, shapeScale(unit, form), unit.stats);
  // Deep Hide (advanced): more pool in whichever shape is worn. On vigor, never
  // a flat `maxHp`, for the write-back reason above
  const deeper = unit.masteryModifiers?.formVigorBonus ?? 0;
  return deeper > 0 ? { ...worn, vigor: worn.vigor * (1 + deeper) } : worn;
}

/**
 * `wornForm` for a shape at a given scale and a given hero's numbers — the
 * arithmetic itself, so the mastery tree can preview a rung the unit does not
 * hold yet from the same code the fight runs. `base` is only read for the magic
 * the shape converts, so a preview with no hero in hand passes zeroes and gets
 * the multipliers and vigor alone.
 */
export function wornFormAt(
  form: WildFormId,
  scale: number,
  base: Pick<HeroStats, 'magic' | 'maxHp'>,
): WornForm {
  const def = WILD_FORMS[form];
  const ramp = (mult: number) => 1 + (mult - 1) * scale;

  const stats: StatMultipliers = {};
  for (const [key, mult] of Object.entries(def.stats) as [keyof HeroStats, number][]) {
    stats[key] = ramp(mult);
  }

  let vigor = ramp(def.vigor ?? 1);
  const gained = magicConversion(base.magic, form, scale);
  if (gained.maxHp && base.maxHp > 0) vigor += gained.maxHp / base.maxHp;

  const bonus = gained.attack ? { attack: gained.attack } : undefined;
  return { stats, vigor, ...(bonus ? { bonus } : {}) };
}

/**
 * Layers a form's multipliers over a stat block.
 *
 * Multiplicative so a level-20 Druid gets a level-20 bear. `maxHp` is never in a
 * profile — see the note in `data/wildForms.ts` — so current HP carries straight
 * through a shift and nothing has to be rescaled in either direction.
 */
export function applyFormStats(stats: HeroStats, form: WildFormId | null): HeroStats {
  if (form === null) return stats;
  // The arithmetic lives in `systems/forms.ts`, shared with boss phases — see
  // the note there on why `maxHp` and `speed` may never appear in a profile
  return applyStatMultipliers(stats, WILD_FORMS[form].stats);
}
