import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { allyHealRecipient, applyAllyHealOnHit } from '@/systems/combat/combatEvents';
import { describeSkill } from '@/data/display/skillDisplay';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { scalingPower } from '@/systems/combat/statusEffects';
import { smite } from '@/data/skills/mastery/champion';
import { at, makeFoe, makeSkill, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * `HeroSkill.allyHeal` — the Templar's light spilling off a damaging blow —
 * and the `hybrid` scaling the path's kit runs on.
 *
 * The rider lives in `combatEvents.applyAllyHealOnHit` so both execution paths
 * obey it; these cases pin the target choice (lowest health *fraction* among
 * wounded allies, the caster included, ties to the nearer) and the two ways it
 * must do nothing (nobody wounded, no damage dealt), because "heals a
 * full-health ally" and "heals off a whiffed cast" are the versions a playtest
 * would report as broken.
 */

const findUnit = (id: string) =>
  useCombatStore.getState().units.find((u) => u.id === id)!;

beforeEach(() => {
  resetFixtureIds();
  useCombatStore.setState({ units: [] });
});

describe('hybrid scaling', () => {
  it('averages attack and magic', () => {
    expect(scalingPower({ attack: 30, magic: 10 }, 'hybrid')).toBe(20);
    expect(scalingPower({ attack: 30, magic: 10 }, 'attack')).toBe(30);
    expect(scalingPower({ attack: 30, magic: 10 }, 'magic')).toBe(10);
  });

  it('runs Smite off the average, through the real pipeline', () => {
    const templar = makeUnit({ stats: makeStats({ attack: 30, magic: 10 }) });
    const foe = makeFoe({ position: at(1, 0), stats: makeStats({ defense: 0 }) });
    // (30 + 10) / 2 × 1.21 = 24.2
    expect(calculateDamage(templar, foe, smite)).toBe(24);
  });

  it('is on every offensive press of the Templar kit', () => {
    // The path's contract: gear on either stat feeds every attack. Judgement,
    // Consecrate and the Martyr seal are pinned alongside Smite so a retune
    // cannot quietly hand one of them back to a single stat.
    const champion = require('@/data/skills/mastery/champion');
    for (const skill of [champion.smite, champion.judgement, champion.consecrate, champion.martyr]) {
      expect(skill.scaling).toBe('hybrid');
    }
  });
});

describe('the ally-heal rider', () => {
  const strike = () => {
    const templar = makeUnit({
      id: 'templar',
      position: at(0, 0),
      skills: [smite],
      stats: makeStats({ attack: 30, magic: 20 }),
    });
    const near = makeUnit({ id: 'near', position: at(0, 1), currentHp: 50 });
    const far = makeUnit({ id: 'far', position: at(0, 3), currentHp: 10 });
    const foe = makeFoe({ id: 'foe', position: at(1, 0), stats: makeStats({ maxHp: 500 }) });
    useCombatStore.setState({ units: [templar, near, far, foe] });
    return resolveSkillUse(templar, smite, foe.position, SILENT_SINK);
  };

  it('mends the most wounded ally when the blow lands, wherever they stand', () => {
    // Crit can inflate the number but never to zero; dodge is 0 by default
    const result = strike();
    expect(result.ok).toBe(true);
    // 0.35 × magic 20 = 7 — to the 10% ally three hexes off, not the 50% one beside
    expect(findUnit('far').currentHp).toBeGreaterThanOrEqual(17);
    expect(findUnit('near').currentHp).toBe(50);
  });

  it('skips allies at full health', () => {
    const templar = makeUnit({ id: 'templar', position: at(0, 0) });
    const whole = makeUnit({ id: 'whole', position: at(0, 1) });
    const hurt = makeUnit({ id: 'hurt', position: at(0, 3), currentHp: 40 });
    useCombatStore.setState({ units: [templar, whole, hurt] });

    const outcome = applyAllyHealOnHit(templar, makeSkill({ allyHeal: 0.5 }), 25);
    expect(outcome[0]?.unitId).toBe('hurt');
    expect(findUnit('whole').currentHp).toBe(100);
  });

  it('does nothing when no damage was dealt, or nobody is wounded', () => {
    const templar = makeUnit({ id: 'templar', position: at(0, 0) });
    const whole = makeUnit({ id: 'whole', position: at(0, 1) });
    useCombatStore.setState({ units: [templar, whole] });

    expect(applyAllyHealOnHit(templar, makeSkill({ allyHeal: 0.5 }), 0)).toEqual([]);
    expect(applyAllyHealOnHit(templar, makeSkill({ allyHeal: 0.5 }), 25)).toEqual([]);
    expect(applyAllyHealOnHit(templar, makeSkill({}), 25)).toEqual([]);
  });

  it('never mends the enemy side', () => {
    const templar = makeUnit({ id: 'templar', position: at(0, 0) });
    const woundedFoe = makeFoe({ id: 'woundedFoe', position: at(0, 1), currentHp: 5 });
    useCombatStore.setState({ units: [templar, woundedFoe] });

    expect(applyAllyHealOnHit(templar, makeSkill({ allyHeal: 0.5 }), 25)).toEqual([]);
    expect(findUnit('woundedFoe').currentHp).toBe(5);
  });
});

describe('the Templar mending itself', () => {
  const templar = (over = {}) =>
    makeUnit({ id: 'templar', position: at(0, 0), stats: makeStats({ maxHp: 100, magic: 20 }), ...over });

  it('can choose the caster when it is the most wounded', () => {
    const me = templar({ currentHp: 20 });
    const friend = makeUnit({ id: 'friend', position: at(0, 1), currentHp: 60 });
    useCombatStore.setState({ units: [me, friend] });

    const outcome = applyAllyHealOnHit(me, makeSkill({ allyHeal: 0.5 }), 25);

    expect(outcome[0]?.unitId).toBe('templar');
    // 0.5 × magic 20 = 10
    expect(findUnit('templar').currentHp).toBe(30);
    expect(findUnit('friend').currentHp).toBe(60);
  });

  it('does not win just by standing at distance zero', () => {
    const me = templar({ currentHp: 80 });
    const friend = makeUnit({ id: 'friend', position: at(0, 3), currentHp: 30 });
    useCombatStore.setState({ units: [me, friend] });

    expect(allyHealRecipient(me, useCombatStore.getState().units)?.id).toBe('friend');
  });

  it('measures wounds as a fraction, so a small pool nearly dead outranks a big pool scratched', () => {
    const me = templar({ currentHp: 400, stats: makeStats({ maxHp: 500, magic: 20 }) });
    const squishy = makeUnit({ id: 'squishy', position: at(0, 4), currentHp: 10, stats: makeStats({ maxHp: 40 }) });
    useCombatStore.setState({ units: [me, squishy] });

    expect(allyHealRecipient(me, useCombatStore.getState().units)?.id).toBe('squishy');
  });

  it('breaks an exact tie by distance, then by id, so a board always picks the same unit', () => {
    const me = templar({ currentHp: 50 });
    const near = makeUnit({ id: 'b-near', position: at(0, 1), currentHp: 50 });
    const far = makeUnit({ id: 'a-far', position: at(0, 3), currentHp: 50 });
    const units = [me, near, far];
    // Caster is at distance zero, so it wins an exact tie on distance
    expect(allyHealRecipient(me, units)?.id).toBe('templar');

    const healthy = templar();
    expect(allyHealRecipient(healthy, [healthy, near, far])?.id).toBe('b-near');
    const twin = makeUnit({ id: 'a-twin', position: at(0, 1), currentHp: 50 });
    expect(allyHealRecipient(healthy, [healthy, near, twin])?.id).toBe('a-twin');
  });

  it('is skipped entirely when the caster is at full health and nobody else is hurt', () => {
    const me = templar();
    useCombatStore.setState({ units: [me] });
    expect(applyAllyHealOnHit(me, makeSkill({ allyHeal: 0.5 }), 25)).toEqual([]);
  });

  it('heals the caster through a real Smite', () => {
    const me = templar({ currentHp: 30, skills: [smite], stats: makeStats({ attack: 30, magic: 20 }) });
    const foe = makeFoe({ id: 'foe', position: at(1, 0), stats: makeStats({ maxHp: 500 }) });
    useCombatStore.setState({ units: [me, foe] });

    expect(resolveSkillUse(me, smite, foe.position, SILENT_SINK).ok).toBe(true);
    expect(findUnit('templar').currentHp).toBeGreaterThanOrEqual(37);
  });

  it('flags the heal as exempt from the Aethelred Tithe, which does not exist yet', () => {
    const me = templar({ currentHp: 20 });
    useCombatStore.setState({ units: [me] });
    expect(applyAllyHealOnHit(me, makeSkill({ allyHeal: 0.5 }), 25)[0]?.exemptFromTithe).toBe(true);
  });
});

describe('the rule is on the skill description', () => {
  it('says lowest health percentage, caster included', () => {
    const text = describeSkill(smite);
    expect(text).toMatch(/most wounded ally/);
    expect(text).toMatch(/lowest health percentage/);
    expect(text).toMatch(/you included/);
  });
});
