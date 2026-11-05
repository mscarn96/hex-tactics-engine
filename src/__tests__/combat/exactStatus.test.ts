import { AfflictionType, CombatUnit, HeroSkill, SkillEffect } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { at, makeEffect, makeFoe, makeUnit } from '../support/fixtures';

/**
 * `SkillEffect.exact` — the one opt-out from the Chill→Freeze escalation.
 *
 * `combatStore.applyEffect` upgrades a Chill landing on an already-chilled unit
 * into a Freeze, and every source of Chill in the game gets that for free. That
 * is deliberate and it is the entire payoff of the Hydromancer's Blizzard. The
 * Rime Tornado, the capstone that once carried the flag, was replaced by Glacial
 * Barrage in the 2026-10 remaster; the rule stays general, and what must not come
 * back is a Blizzard that stopped freezing.
 */

const chilled = () => makeEffect(AfflictionType.Chill, { duration: 3 });

const hero = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'hero', heroId: 'h1', position: at(0, 2), ...over });
const foe = (over: Partial<CombatUnit> = {}) =>
  makeFoe({ id: 'foe', position: at(0, -2), ...over });

const setup = (foeOver: Partial<CombatUnit> = {}) => {
  useCombatStore.getState().reset();
  useCombatStore.getState().initCombat([hero()], [foe(foeOver)]);
};

const effectsOn = (id: string) =>
  useCombatStore.getState().units.find((u) => u.id === id)!.activeEffects;
const has = (id: string, type: AfflictionType) =>
  effectsOn(id).some((e) => e.type === type);

const applyChill = (exact?: boolean) =>
  useCombatStore.getState().applyEffect('foe', {
    type: AfflictionType.Chill,
    magnitude: 4,
    duration: 3,
    ...(exact === undefined ? {} : { exact }),
  });

describe('a plain Chill still escalates', () => {
  it('freezes a target that is already chilled', () => {
    setup({ activeEffects: [chilled()] });
    applyChill();

    expect(has('foe', AfflictionType.Freeze)).toBe(true);
    // The Chill it was is spent becoming the Freeze it is now
    expect(has('foe', AfflictionType.Chill)).toBe(false);
  });

  it('lands as a Chill on a target that is not chilled', () => {
    setup();
    applyChill();

    expect(has('foe', AfflictionType.Chill)).toBe(true);
    expect(has('foe', AfflictionType.Freeze)).toBe(false);
  });
});

describe('an exact Chill refuses the upgrade', () => {
  it('leaves an already-chilled target chilled, never frozen', () => {
    setup({ activeEffects: [chilled()] });
    applyChill(true);

    expect(has('foe', AfflictionType.Freeze)).toBe(false);
    expect(has('foe', AfflictionType.Chill)).toBe(true);
  });

  it('refreshes rather than stacking a second Chill', () => {
    // The escalation is skipped, not the application — a target already chilled
    // is still worth chilling again for the clock, which is what stops `exact`
    // reading as "this skill does nothing to chilled targets".
    setup({ activeEffects: [makeEffect(AfflictionType.Chill, { duration: 1 })] });
    applyChill(true);

    const chills = effectsOn('foe').filter((e) => e.type === AfflictionType.Chill);
    expect(chills).toHaveLength(1);
    expect(chills[0].duration).toBe(3);
  });

  it('lands normally on an unchilled target', () => {
    setup();
    applyChill(true);

    expect(has('foe', AfflictionType.Chill)).toBe(true);
    expect(has('foe', AfflictionType.Freeze)).toBe(false);
  });

  it('is opt-in — nothing authored before it changes behaviour', () => {
    // `exact: false` and an absent flag must be the same thing, or every effect
    // in the game would have to start declaring one.
    setup({ activeEffects: [chilled()] });
    applyChill(false);
    expect(has('foe', AfflictionType.Freeze)).toBe(true);
  });
});

describe('the Hydromancer holds three capstones, not one three ways', () => {
  const skill = (id: string) => MASTERY_SKILLS.find((s) => s.id === id)!;
  const chillOf = (s: HeroSkill): SkillEffect | undefined => {
    const applied = Array.isArray(s.appliesEffect) ? s.appliesEffect : [s.appliesEffect];
    return applied.find((e): e is SkillEffect => e?.type === AfflictionType.Chill);
  };

  it('freezes ground with Blizzard, and only Blizzard chills', () => {
    expect(chillOf(skill('blizzard'))?.exact).toBeUndefined();
    expect(chillOf(skill('glacial_barrage'))).toBeUndefined();
    expect(chillOf(skill('absolute_zero'))).toBeUndefined();
  });

  it('answers three different questions: an area, one enemy, and a charged line', () => {
    expect(skill('blizzard').aoeRadius).toBeGreaterThan(1);
    expect(skill('glacial_barrage').barrage).toBeGreaterThan(1);
    expect(skill('absolute_zero').charge?.release.beam).toBe(true);
  });
});

describe('exact is a general rule, not a Hydromancer special case', () => {
  it('is honoured for whoever cast it', () => {
    // Statuses are symmetric in this game — a spider doses a hero by the same
    // table a hero doses a spider by — and both execution paths rebuild the
    // effect field by field, so the flag has to be forwarded twice. An enemy
    // Hydromancer's tornado must not freeze what the player's cannot.
    setup({ activeEffects: [chilled()] });
    useCombatStore.getState().applyEffect('foe', {
      type: AfflictionType.Chill,
      magnitude: 4,
      duration: 3,
      exact: true,
      sourceUnitId: 'foe',
    });
    expect(has('foe', AfflictionType.Freeze)).toBe(false);
  });
});
