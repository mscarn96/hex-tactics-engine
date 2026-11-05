import { CombatUnit, HeroSkill, HeroStats, WildFormId } from '@/models/types';
import { WILD_FORMS } from '@/data/templates/wildForms';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { findSkill } from '@/systems/progression/mastery';
import { combatMaxHp } from '@/systems/combat/forms';
import { expectedDamage } from '@/systems/combat/damageCalc';
import { slash } from '@/data/skills/skillData';
import { makeFoe, makeStats, makeUnit } from '../support/fixtures';

/**
 * Is a shape worth wearing?
 *
 * Measured, not eyeballed — and analytically, for the reason `homeRing.test.ts`
 * records: a sampled balance assertion with a narrow margin turns the suite
 * *intermittent* rather than red, and an intermittent red gets re-run instead of
 * investigated. `expectedDamage` already folds crit and dodge in as
 * expectations, so the whole measurement below has zero variance.
 *
 * The Hawk is why this exists. It shipped at `attack ×1.1` against the Wolf's
 * ×1.4, with the lowest defence in the table by a distance and no `vigor` at
 * all — behind on offence *and* the squishiest thing on the board, compensated
 * only with move range that a 61-hex arena gives nobody a use for. A tier-1
 * node that is worse than its two siblings at everything is not a choice, it is
 * a trap, and the tier costs a point the Druid cannot get back.
 */

/** A mid-campaign Druid. The exact numbers cancel; only the ratios are read. */
const DRUID: HeroStats = {
  maxHp: 100, attack: 20, defense: 10, magic: 16, speed: 12, moveRange: 3, maxMana: 40,
};

/** The three exclusive tier-1 shapes. Apex is a capstone, not an alternative. */
const SHAPES: WildFormId[] = ['bear', 'wolf', 'hawk'];

/**
 * The shape as it stands on the board.
 *
 * `formStats` is what `getCombatEffectiveStats` reads and `formVigor` what
 * `combatMaxHp` reads — `wildForm` is only a model key. Setting one without the
 * other is a unit state the game cannot produce, so the fixture writes all
 * three the way `setWildForm` does.
 */
function shaped(form: WildFormId | null): CombatUnit {
  const def = form ? WILD_FORMS[form] : null;
  return makeUnit({
    id: form ?? 'druid',
    stats: { ...DRUID },
    ...(def ? { wildForm: form, formStats: def.stats, formVigor: def.vigor ?? 1 } : {}),
  });
}

/**
 * Everything the shape can field once its branch is bought.
 *
 * The innate pair plus every `formSkill` the tree grants it — the question is
 * whether the *branch* is worth its points, and judging a Hawk on Talons and
 * Dive alone would ignore two of the four nodes the player spends them on.
 */
function kitFor(form: WildFormId): HeroSkill[] {
  const innate = WILD_FORMS[form].skills
    .map((id) => findSkill(id))
    .filter((s): s is HeroSkill => !!s);
  const innateIds = new Set(innate.map((s) => s.id));
  const learned = MASTERY_SKILLS.filter((s) => s.formSkill === form && !innateIds.has(s.id));
  return [...innate, ...learned];
}

/**
 * Sustained damage per turn, over a rotation long enough for the cooldowns to
 * settle.
 *
 * One action per turn, so throughput is a greedy rotation and not a sum: each
 * turn the shape uses the hardest-hitting skill currently off cooldown, which
 * is what a player does and what `enemyAI` scores for. Twelve turns is the
 * least common multiple's worth of the cooldowns in play (2, 3, 4) so no shape
 * is measured mid-cycle and flattered by an opener it cannot repeat.
 *
 * Deterministic throughout — no rolls, no ordering ambiguity beyond "highest
 * expected damage first".
 */
const ROTATION = 12;

function damagePerTurn(form: WildFormId, dummy: CombatUnit): number {
  const attacker = shaped(form);
  const kit = kitFor(form)
    .filter((s) => s.damage)
    .map((s) => ({ skill: s, hit: expectedDamage(attacker, dummy, s), ready: 0 }));

  let total = 0;
  for (let turn = 0; turn < ROTATION; turn++) {
    const available = kit.filter((k) => k.ready <= turn);
    if (available.length === 0) continue;
    const best = available.reduce((a, b) => (b.hit > a.hit ? b : a));
    total += best.hit;
    best.ready = turn + (best.skill.cooldown ?? 0) + 1;
  }
  return total / ROTATION;
}

/**
 * How many rounds the shape lasts under fire.
 *
 * This is the half the Hawk was being charged for and never credited with: it
 * is the *only* form that trades defence away outright, so any comparison of
 * offence alone says it is fine when it is not. Health is `combatMaxHp` — the
 * pool actually being fought out of, vigor included — over what one swing of a
 * generic attacker takes off it, through the real subtractive-armour pipeline.
 */
function roundsSurvived(form: WildFormId, attacker: CombatUnit): number {
  const victim = shaped(form);
  const incoming = expectedDamage(attacker, victim, slash);
  return combatMaxHp(victim) / Math.max(1, incoming);
}

/**
 * The one number: total damage the shape deals before it dies.
 *
 * Offence × longevity, which is the only way to compare a tank against a glass
 * cannon without deciding in advance which of the two matters. A shape may be
 * bought entirely with either — the Bear pays in rounds, the Hawk in damage per
 * round — and the product is what says whether the *trade* was fair.
 */
function shapeWorth(form: WildFormId, dummy: CombatUnit, attacker: CombatUnit): number {
  return damagePerTurn(form, dummy) * roundsSurvived(form, attacker);
}

describe('the three shapes are genuinely alternatives', () => {
  // A neutral body on the other side, so nothing in the measurement is tuned to
  // one shape's damage type or one shape's armour.
  const dummy = makeFoe({ id: 'dummy', stats: makeStats({ maxHp: 400, defense: 8, attack: 18 }) });
  const attacker = makeFoe({ id: 'attacker', stats: makeStats({ attack: 18, defense: 8 }) });

  /**
   * Offence, which is the half with no excuse.
   *
   * A shape may be bought with survivability instead of damage — that is what
   * the Bear is — but it still has to be able to end a fight, and damage per
   * turn is directly comparable across all three because they all get one
   * action. Held tight (×1.45) precisely because the alternative reading, "the
   * Hawk is squishy *and* hits softest", is the exact shape of the complaint.
   *
   * Bear 30.4 · Wolf 32.8 · Hawk 43.8 — a spread of ×1.44. It was ×1.35 until the
   * playtest of 2026-10-24 asked for harder Hawk ratios (Talons 1.25, Dive 1.85)
   * rather than more defence; the Hawk leading is the shape's job, and the Bear
   * pays for its place at the back in rounds survived. Before the retune
   * the Hawk was at **22.0**, last of the three at ×1.49 behind the Wolf while
   * also being the flimsiest thing on the board.
   */
  it('leaves no shape behind on damage per turn', () => {
    const dpt = SHAPES.map((f) => ({ form: f, value: damagePerTurn(f, dummy) }));
    const best = Math.max(...dpt.map((d) => d.value));

    const soft = dpt
      .filter((d) => best / d.value > 1.45)
      .map((d) => `${d.form}: ${d.value.toFixed(1)} against a best of ${best.toFixed(1)}`);
    expect(soft).toEqual([]);
  });

  /**
   * Offence and longevity together — and a deliberately loose bound, for a
   * reason worth writing down.
   *
   * The product over-credits a pure tank. It prices a shape as though every
   * fight ran until the shape itself died, and fights do not: they end when the
   * *enemy* does, so survivability past "long enough to win" is worth much less
   * on the board than it is in this arithmetic. That is why the Bear leads here
   * at 335 against the Wolf's 195 without the Bear being overtuned — ×1.72 of
   * it is the metric's bias, not the Bear's.
   *
   * So the bound is set where it catches a genuine trap rather than where it
   * would flatten the three into one shape. The Hawk before the retune was
   * **124** — ×2.70 behind the Bear, and behind on *both* factors at once,
   * which is the combination no amount of metric bias explains away. Today:
   * Bear 290 · Wolf 184 · Hawk 231 (2026-10-24).
   */
  it('lets no shape be worth less than half of another', () => {
    const worth = SHAPES.map((f) => ({ form: f, value: shapeWorth(f, dummy, attacker) }));
    const best = Math.max(...worth.map((w) => w.value));

    const trap = worth
      .filter((w) => best / w.value > 2.0)
      .map((w) => `${w.form}: ${w.value.toFixed(0)} against a best of ${best.toFixed(0)}`);
    expect(trap).toEqual([]);
  });

  /**
   * Each shape still has to *lead* at the thing it is for, or they are one
   * shape wearing three models. This is the counterweight to the test above:
   * closing the gap by making them all the same would satisfy the spread and
   * lose the path.
   */
  it('leaves each shape best at its own job', () => {
    const dpt = Object.fromEntries(SHAPES.map((f) => [f, damagePerTurn(f, dummy)]));
    const rounds = Object.fromEntries(SHAPES.map((f) => [f, roundsSurvived(f, attacker)]));

    // The Bear is the wall — most rounds under fire, by construction of vigor
    expect(rounds.bear).toBeGreaterThan(rounds.wolf);
    expect(rounds.bear).toBeGreaterThan(rounds.hawk);
    // The Hawk is the strike — hardest hitting, and the flimsiest
    expect(dpt.hawk).toBeGreaterThan(dpt.wolf);
    expect(dpt.hawk).toBeGreaterThan(dpt.bear);
    expect(rounds.hawk).toBeLessThan(rounds.wolf);
  });

  /**
   * The capstone has to beat all three, or a Druid who spent a tier-4 point is
   * worse off for it. Not part of the spread above: Apex is not an alternative
   * to the shapes, it is what any of them grows into.
   */
  it('keeps Apex ahead of every shape it is reached from', () => {
    const apex = shapeWorth('apex', dummy, attacker);
    const behind = SHAPES.filter((f) => shapeWorth(f, dummy, attacker) >= apex);
    expect(behind).toEqual([]);
  });
});

/**
 * The profile rules, restated where the numbers are.
 *
 * `wildshape.test.ts` already pins these across `WILD_FORM_IDS`; they are here
 * as well because this is the file a retune of the multipliers is edited
 * alongside, and both forbidden fields are exactly the sort of thing a balance
 * pass reaches for first.
 */
describe('what a form profile may not carry', () => {
  it('scales no maxHp, because boss phases share the field', () => {
    const offenders = Object.values(WILD_FORMS)
      .filter((f) => f.stats.maxHp !== undefined)
      .map((f) => f.id);
    expect(offenders).toEqual([]);
  });

  it('scales no speed, because turn order is sorted once and never again', () => {
    const offenders = Object.values(WILD_FORMS)
      .filter((f) => f.stats.speed !== undefined)
      .map((f) => f.id);
    expect(offenders).toEqual([]);
  });
});
