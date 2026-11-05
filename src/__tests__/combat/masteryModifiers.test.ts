import {
  AfflictionType,
  AuraType,
  CombatUnit,
  SkillTargetType,
} from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { calculateDamage, defenceReduction, poisonBurstDamage, resolveEffectMagnitude } from '@/systems/combat/damageCalc';
import { applyOnHeal } from '@/systems/combat/combatEvents';
import { useCombatStore } from '@/stores/combatStore';
import { at, makeEffect, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * The eleven mastery modifiers that are not a stat and not a skill.
 *
 * Every one of them was declared, merged and read by nothing, which is the
 * failure `MODIFIER_MERGE`'s own comment records happening to
 * `burnMagnitudeBonus` for a whole version. What this suite pins is not the
 * numbers — those get retuned — but *where in the pipeline* each one lands,
 * because that is the part no playtest can see and no tuning pass can restore.
 *
 * A bonus folded into the skill's multiplier is mitigated like the skill; a
 * bonus on the finished number is a ratio on whatever survived defence. Since
 * defence became a share of the hit (playtest 2026-10-14) the two are worth the
 * same proportion against armour as against paper — what this suite still pins
 * is which shapes, states and payloads each key reaches, by measuring.
 */

const ATTACK = 20;
const DEFENSE = 10;
/** What survives a defence of `DEFENSE` against an attacker of `ATTACK`: 1 − 10 / (10 + 30). */
const SHARE = 1 - defenceReduction(DEFENSE, ATTACK);
/** `attack × damage` = 40, three quarters of it through. */
const BASE = Math.round(ATTACK * 2 * SHARE);

const hero = (over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'hero',
    position: at(0, 0),
    stats: makeStats({ attack: ATTACK, critChance: 0, dodgeChance: 0 }),
    ...over,
  });

const foe = (over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'foe',
    isPlayer: false,
    position: at(0, -1),
    stats: makeStats({ defense: DEFENSE, critChance: 0, dodgeChance: 0 }),
    ...over,
  });

const single = makeSkill({ damage: 2, targetType: SkillTargetType.Single });
const area = makeSkill({ damage: 2, targetType: SkillTargetType.Ring, aoeRadius: 1 });
const line = makeSkill({ damage: 2, targetType: SkillTargetType.Line, range: 3 });

describe('shape bonuses scale the skill, so armour still answers them', () => {
  it('pays an area skill and leaves a single-target one alone', () => {
    const caster = hero({ masteryModifiers: { aoeDamageBonus: 0.5 } });
    expect(calculateDamage(caster, foe(), area)).toBe(Math.round(ATTACK * 2 * 1.5 * SHARE));
    expect(calculateDamage(caster, foe(), single)).toBe(BASE);
  });

  it('pays a single-target skill and leaves an area one alone', () => {
    const caster = hero({ masteryModifiers: { singleTargetDamageBonus: 0.5 } });
    expect(calculateDamage(caster, foe(), single)).toBe(Math.round(ATTACK * 2 * 1.5 * SHARE));
    expect(calculateDamage(caster, foe(), area)).toBe(BASE);
  });

  /**
   * Folded into the multiplier, the bonus is mitigated with the hit, so it is
   * worth the same *share* however armoured the target is — never more against
   * a wall than against paper, which would be armour penetration's job.
   */
  it('is worth the same share against a wall as against paper', () => {
    const caster = hero({ masteryModifiers: { singleTargetDamageBonus: 0.5 } });
    const plain = hero({ id: 'plain', stats: caster.stats });

    const ratio = (defense: number) =>
      calculateDamage(caster, foe({ stats: makeStats({ defense }) }), single) /
      calculateDamage(plain, foe({ stats: makeStats({ defense }) }), single);

    expect(ratio(DEFENSE)).toBeCloseTo(ratio(0), 1);
  });

  /**
   * A Line covers several hexes and names no radius, so it is honestly neither
   * shape. Paying it either bonus would make it the cheapest way to collect
   * one.
   */
  it('pays a line skill nothing at all', () => {
    const caster = hero({
      masteryModifiers: { aoeDamageBonus: 0.5, singleTargetDamageBonus: 0.5 },
    });
    expect(calculateDamage(caster, foe(), line)).toBe(BASE);
  });
});

describe('target-state bonuses ride on the finished number', () => {
  /** `EXECUTE_THRESHOLD_BASE + attack × PER_ATTACK`, of a 100-point bar. */
  const WINDOW = Math.floor(
    100 * (BALANCE.EXECUTE_THRESHOLD_BASE + ATTACK * BALANCE.EXECUTE_THRESHOLD_PER_ATTACK),
  );

  it('opens exactly at the execute window the board already draws', () => {
    const caster = hero({ masteryModifiers: { lowHpDamageBonus: 0.5 } });
    expect(calculateDamage(caster, foe({ currentHp: WINDOW }), single)).toBe(BASE * 1.5);
    expect(calculateDamage(caster, foe({ currentHp: WINDOW + 1 }), single)).toBe(BASE);
  });

  it('opens exactly above half health, measured on the pool being fought from', () => {
    const caster = hero({ masteryModifiers: { highHpDamageBonus: 0.5 } });
    const half = 100 * BALANCE.HIGH_HP_THRESHOLD;
    expect(calculateDamage(caster, foe({ currentHp: half + 1 }), single)).toBe(BASE * 1.5);
    expect(calculateDamage(caster, foe({ currentHp: half }), single)).toBe(BASE);
  });

  /**
   * The two windows are kept apart by arithmetic rather than by a guard —
   * `EXECUTE_THRESHOLD_MAX` is below `HIGH_HP_THRESHOLD` — so this is the test
   * that fails if either constant is retuned toward the other. Swept rather
   * than sampled: the seam is one hit point wide.
   */
  it('never pays an opener bonus and a finisher bonus on the same swing', () => {
    const caster = hero({
      masteryModifiers: { lowHpDamageBonus: 0.5, highHpDamageBonus: 0.5 },
    });
    const offenders: number[] = [];
    for (let hp = 1; hp <= 100; hp++) {
      if (calculateDamage(caster, foe({ currentHp: hp }), single) > BASE * 1.5) {
        offenders.push(hp);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Marker-exclusive, the same way `markMultiplier` and `bonusVs: 'marked'`
   * are: a hunter's quarry, not a debuff the whole party piles onto. Measured
   * against a control carrying the identical Mark, so what is being pinned is
   * the mastery's contribution and not the Mark's own.
   */
  it('pays for the attacker’s own Mark and nobody else’s', () => {
    const caster = hero({ masteryModifiers: { markedDamageBonus: 0.5 } });
    // Same id as `caster`, because the Mark is keyed to who placed it — a
    // control under a different name would simply not be the hunter.
    const plain = hero();
    const marked = (by: string) =>
      foe({ activeEffects: [makeEffect(AfflictionType.Mark, { magnitude: 0.5, sourceUnitId: by })] });

    expect(calculateDamage(plain, marked('hero'), single)).toBe(BASE * 1.5);
    expect(calculateDamage(caster, marked('hero'), single)).toBe(Math.round(ATTACK * 2 * SHARE * 1.5 * 1.5));
    // Somebody else's quarry: `markMultiplier` is marker-exclusive, so neither
    // the Mark nor the node keyed to it pays this attacker anything.
    expect(calculateDamage(caster, marked('someone_else'), single)).toBe(BASE);
  });
});

describe('the poison overdose', () => {
  /** `rng` at 1 never crits, so the burst is the deterministic core alone. */
  const burst = (mods?: CombatUnit['masteryModifiers']) =>
    poisonBurstDamage(hero({ masteryModifiers: mods }), foe(), () => 1).damage;

  it('scales `POISON_BURST` itself, so armour still answers it', () => {
    // Rounded, because the damage pipeline deals whole points. It went unwritten
    // while `POISON_BURST` was 2.4 and the arithmetic happened to land on an
    // integer; cutting it to 2.16 exposed that this suite was pinning the
    // *unrounded* number, which is a coincidence rather than a rule.
    const plain = Math.round(ATTACK * BALANCE.POISON_BURST * SHARE);
    expect(burst()).toBe(plain);
    expect(burst({ poisonBurstBonus: 0.5 })).toBe(
      Math.round(ATTACK * (BALANCE.POISON_BURST * 1.5) * SHARE),
    );
  });
});

describe('magnitude bonuses are read off the hand that applied them', () => {
  const applier = (mods: CombatUnit['masteryModifiers']) =>
    hero({ masteryModifiers: mods });

  it('amplifies a bleed authored as a fraction of attack', () => {
    const plain = resolveEffectMagnitude(AfflictionType.Bleed, 0.5, hero());
    expect(plain).toBe(10);
    expect(
      resolveEffectMagnitude(AfflictionType.Bleed, 0.5, applier({ bleedMagnitudeBonus: 0.5 })),
    ).toBe(15);
  });

  /**
   * The reason these two sit on the *resolved* value rather than beside
   * `burnMagnitudeBonus` inside the fraction branch: that placement reaches
   * only magnitudes authored below 5, and a flat-authored bleed would silently
   * gain nothing. The resolved placement is a strict superset.
   */
  it('amplifies a bleed authored as a flat number too', () => {
    expect(
      resolveEffectMagnitude(AfflictionType.Bleed, 10, applier({ bleedMagnitudeBonus: 0.5 })),
    ).toBe(15);
  });

  it('amplifies a heal-over-time, which is never authored as a fraction', () => {
    expect(resolveEffectMagnitude(AuraType.HealOverTime, 20, hero())).toBe(20);
    expect(
      resolveEffectMagnitude(AuraType.HealOverTime, 20, applier({ regenMagnitudeBonus: 0.25 })),
    ).toBe(25);
  });

  it('leaves every other status alone', () => {
    const both = applier({ bleedMagnitudeBonus: 0.5, regenMagnitudeBonus: 0.5 });
    expect(resolveEffectMagnitude(AuraType.AttackBuff, 8, both)).toBe(8);
    // Poison is untouched *by these bonuses*, which is what this case is for —
    // but it is not unscaled, because it alone carries the global
    // `POISON_POWER` dial. Written through the constant rather than as 12 so the
    // two rules stay legibly separate: a bleed bonus must not reach poison, and
    // the poison dial must.
    expect(resolveEffectMagnitude(AfflictionType.Poison, 12, both)).toBe(
      Math.round(12 * BALANCE.POISON_POWER),
    );
  });
});

describe('support is amplified by whoever receives it', () => {
  const store = () => useCombatStore.getState();
  const unitNow = (id: string) => store().units.find((u) => u.id === id)!;

  const ward = (over: Partial<CombatUnit> = {}) =>
    makeUnit({ id: 'ward', position: at(0, 1), currentHp: 10, ...over });

  const setup = (units: CombatUnit[]) => {
    store().reset();
    store().initCombat(units, [foe()]);
  };

  it('grows a heal, and reports what actually landed', () => {
    setup([hero(), ward({ masteryModifiers: { incomingSupportBonus: 0.5 } })]);
    expect(store().healUnit('ward', 20, 'hero')).toBe(30);
    expect(unitNow('ward').currentHp).toBe(40);
  });

  /**
   * Read off the target rather than the caster, which is what makes this the
   * one amplifier in the game on that side of the line: the same heal from the
   * same healer is worth more to the hero who bought the node.
   */
  it('does nothing for an ally who did not buy it', () => {
    setup([hero(), ward()]);
    expect(store().healUnit('ward', 20, 'hero')).toBe(20);
  });

  it('grows a barrier and a regen, and leaves other auras alone', () => {
    setup([hero(), ward({ masteryModifiers: { incomingSupportBonus: 0.5 } })]);
    store().applyEffect('ward', makeEffect(AuraType.Barrier, { magnitude: 40 }));
    store().applyEffect('ward', makeEffect(AuraType.HealOverTime, { magnitude: 20 }));
    store().applyEffect('ward', makeEffect(AuraType.AttackBuff, { magnitude: 8 }));

    const magnitudeOf = (type: AuraType) =>
      unitNow('ward').activeEffects.find((e) => e.type === type)?.magnitude;

    expect(magnitudeOf(AuraType.Barrier)).toBe(60);
    expect(magnitudeOf(AuraType.HealOverTime)).toBe(30);
    expect(magnitudeOf(AuraType.AttackBuff)).toBe(8);
  });

  /**
   * Every route in, not just the one a skill takes. `healUnit` is the funnel a
   * drain, a passive's mend and a lethal save all pass through, which is the
   * same argument that puts the poison cap in `applyEffect`.
   */
  it('reaches a heal with no healer attached at all', () => {
    setup([hero(), ward({ masteryModifiers: { incomingSupportBonus: 0.5 } })]);
    expect(store().healUnit('ward', 20)).toBe(30);
  });
});

describe('what rides on landing a heal', () => {
  const store = () => useCombatStore.getState();
  const unitNow = (id: string) => store().units.find((u) => u.id === id)!;

  const ally = () => makeUnit({ id: 'ally', position: at(0, 1), currentMana: 0 });

  const setup = (healer: CombatUnit) => {
    store().reset();
    store().initCombat([healer, ally()], [foe()]);
  };

  it('restores mana to the ally who was mended', () => {
    const healer = hero({ masteryModifiers: { healRestoresMana: 6 } });
    setup(healer);
    applyOnHeal(healer, unitNow('ally'), 12);
    expect(unitNow('ally').currentMana).toBe(6);
  });

  /**
   * Never to the caster. A heal that returns more mana than it cost is an
   * infinite pool with a button on it, and the cheap at-will mends are exactly
   * the ones that would be pressed for it — so the loop is closed by
   * construction rather than by a tuning constraint nobody would remember.
   */
  it('never refunds the healer their own mana', () => {
    const healer = hero({ masteryModifiers: { healRestoresMana: 6 }, currentMana: 0 });
    setup(healer);
    applyOnHeal(healer, unitNow('hero'), 12);
    expect(unitNow('hero').currentMana).toBe(0);
  });

  /**
   * `2`, not `1`: effects tick at the *start* of the wearer's turn and the tick
   * decrements before they act, so a duration of 1 is stripped on the way in
   * and the buff never once applies.
   */
  it('grants a turn of guard that survives to be used', () => {
    const healer = hero({ masteryModifiers: { healGrantsDefense: 4 } });
    setup(healer);
    applyOnHeal(healer, unitNow('ally'), 12);

    const buff = unitNow('ally').activeEffects.find((e) => e.type === AuraType.DefenseBuff);
    expect(buff?.magnitude).toBe(4);
    expect(buff!.duration).toBeGreaterThan(1);
  });

  // A cast worth nothing carries no riders — the guard is on the heal, not on
  // the modifier, so a skill with no `healing` cannot hand out free guard.
  it('does nothing when the heal itself was worth nothing', () => {
    const healer = hero({ masteryModifiers: { healRestoresMana: 6, healGrantsDefense: 4 } });
    setup(healer);
    applyOnHeal(healer, unitNow('ally'), 0);
    expect(unitNow('ally').currentMana).toBe(0);
    expect(unitNow('ally').activeEffects).toEqual([]);
  });
});
