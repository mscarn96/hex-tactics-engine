import { nodeDescription } from '@/__tests__/support/masteryNodeText';
import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { emergencyBloom, wardingBloom } from '@/data/skills/mastery/druid';
import { describeSkill, skillEffectLines, skillStatLine } from '@/data/display/skillDisplay';
import { findMasteryNode, findMasteryPath } from '@/data/skills/masteryData';
import { calculateHealing, healingRange } from '@/systems/combat/damageCalc';
import { requireUnit } from '@/systems/combat/unitLookup';
import { AfflictionType, AuraType, CombatUnit, HeroStats } from '@/models/types';
import { at, makeEffect, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';
import { masteryNodeDescription } from '@/data/display/masteryText';

/**
 * The Lifewarden's emergency kit: Warding Bloom's early cleanse and a Second
 * Wind that scales with how wounded the target is.
 *
 * Pinned as rules (who the cleanse reaches, that it comes before the capstone,
 * that healing rises with missing HP, and that the tooltip states what the cast
 * resolves) rather than as the tuning numbers.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ maxHp: 200, defense: 0, magic: 20, attack: 20, maxMana: 100, critChance: 0, dodgeChance: 0, ...over });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);

const druid = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'druid', position: at(0, 0), stats: stats(), skills: [wardingBloom, emergencyBloom], ...over });

const ally = (hp: number, over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'ally', position: at(1, 0), currentHp: hp, stats: stats(), ...over });

beforeEach(() => {
  resetFixtureIds();
  state().reset();
});

describe('Warding Bloom is a thinner shield with an ally cleanse', () => {
  it('cleanses the ally it is aimed at and shields them, and leaves everyone else alone', () => {
    const me = druid();
    const target = ally(150, {
      activeEffects: [makeEffect(AfflictionType.Poison, { magnitude: 5 }), makeEffect(AfflictionType.Root)],
    });
    const bystander = ally(150, {
      id: 'bystander',
      position: at(0, 1),
      activeEffects: [makeEffect(AfflictionType.Root)],
    });
    useCombatStore.setState({ units: [me, target, bystander] });

    expect(resolveSkillUse(me, wardingBloom, target.position, SILENT_SINK).ok).toBe(true);

    const after = unitNow('ally').activeEffects;
    expect(after.some((e) => e.type === AfflictionType.Poison || e.type === AfflictionType.Root)).toBe(false);
    expect(after.find((e) => e.type === AuraType.Barrier)).toBeDefined();
    expect(unitNow('bystander').activeEffects.length).toBe(1);
  });

  it('does not cleanse or shield an enemy', () => {
    const me = druid();
    const foe = makeFoe({
      id: 'foe',
      position: at(1, 0),
      activeEffects: [makeEffect(AfflictionType.Poison, { magnitude: 5 })],
    });
    useCombatStore.setState({ units: [me, foe] });
    resolveSkillUse(me, wardingBloom, foe.position, SILENT_SINK);
    expect(unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Poison)).toBe(true);
    expect(unitNow('foe').activeEffects.some((e) => e.type === AuraType.Barrier)).toBe(false);
  });

  it('can cleanse the Lifewarden itself', () => {
    const me = druid({ activeEffects: [makeEffect(AfflictionType.Burn, { magnitude: 3 })] });
    useCombatStore.setState({ units: [me] });
    resolveSkillUse(me, wardingBloom, me.position, SILENT_SINK);
    expect(unitNow('druid').activeEffects.some((e) => e.type === AfflictionType.Burn)).toBe(false);
  });

  it('shields for less than the cleanse-less bark did (30)', () => {
    expect(wardingBloom.cleanse).toBe(true);
    const barrier = (wardingBloom.appliesEffect as { magnitude: number }).magnitude;
    expect(barrier).toBeLessThan(30);
  });

  it('shows the shield that lands, and says it cleanses', () => {
    const me = druid();
    const target = ally(150);
    useCombatStore.setState({ units: [me, target] });
    const lines = skillEffectLines(wardingBloom, me).join('\n');
    resolveSkillUse(me, wardingBloom, target.position, SILENT_SINK);
    const barrier = unitNow('ally').activeEffects.find((e) => e.type === AuraType.Barrier)!;
    expect(lines).toContain(`${barrier.magnitude}`);
    expect(lines).toMatch(/Removes all afflictions/);
    expect(describeSkill(wardingBloom)).toMatch(/cleanse/i);
    expect(masteryNodeDescription(findMasteryNode('life_warding_bloom')!.node)).toMatch(/cleanse/i);
  });

  it('is the path ally cleanse, before the capstones', () => {
    const path = findMasteryPath('lifewarden')!;
    const tierOf = (skillId: string) => path.nodes.find((n) => n.grantsSkill === skillId)!.tier;
    expect(tierOf('warding_bloom')).toBeLessThan(tierOf('wild_sanctuary'));
    expect(wardingBloom.aoeRadius ?? 0).toBe(0);
  });
});

describe("Second Wind scales with the target's missing HP", () => {
  const healedBy = (hp: number): number => {
    state().reset();
    const me = druid();
    const target = ally(hp);
    useCombatStore.setState({ units: [me, target] });
    expect(resolveSkillUse(me, emergencyBloom, target.position, SILENT_SINK).ok).toBe(true);
    return unitNow('ally').currentHp - hp;
  };

  it('heals more the more wounded the target is, monotonically', () => {
    // maxHp is large enough that no sample tops out against the ceiling
    const samples = [190, 160, 140, 120, 100, 80, 60, 40, 20, 5].map((hp) => healedBy(hp));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
  });

  it('is weak at 70% health and strong near death', () => {
    const at70 = healedBy(140);
    const nearDeath = healedBy(10);
    // The staple heal at the same Magic, for scale: Second Wind is a worse
    // button than Lifebloom on an ally who is barely hurt, and far better late
    const staple = Math.round(20 * 0.8);
    expect(at70).toBeLessThan(staple);
    expect(nearDeath).toBeGreaterThan(staple * 2);
    expect(nearDeath).toBeGreaterThan(at70 * 3);
  });

  it("measures the wound against the target's own maximum", () => {
    const me = druid();
    const tank = ally(700, { stats: stats({ maxHp: 1000 }) });
    // 70% of a big bar and 70% of a small one are the same share
    const small = ally(140, { id: 'small', position: at(0, 1) });
    useCombatStore.setState({ units: [me, tank, small] });
    expect(calculateHealing(me, emergencyBloom, tank)).toBe(calculateHealing(me, emergencyBloom, small));
  });

  it('resolves at its top end for a caller with no target, so the AI never underrates it', () => {
    const me = druid();
    expect(calculateHealing(me, emergencyBloom)).toBe(healingRange(me, emergencyBloom).max);
  });

  it('states both ends on the tooltip, from the same arithmetic as the cast', () => {
    const me = druid();
    const { min, max } = healingRange(me, emergencyBloom);
    expect(min).toBeLessThan(max);
    const lines = skillEffectLines(emergencyBloom, me).join('\n');
    expect(lines).toContain(`${min}`);
    expect(lines).toContain(`${max}`);
    // A nearly-dead ally is healed inside that stated range, close to its top
    const dying = ally(1);
    expect(calculateHealing(me, emergencyBloom, dying)).toBeLessThanOrEqual(max);
    expect(calculateHealing(me, emergencyBloom, dying)).toBeGreaterThan(max * 0.9);
    expect(skillStatLine(emergencyBloom)).toMatch(/–/);
    expect(describeSkill(emergencyBloom)).toMatch(/wounded/);
  });

  it('keeps the curve through a node rung (the floor is a share of the scaled heal)', () => {
    const me = druid();
    const rank3 = { ...emergencyBloom, healing: emergencyBloom.healing! * 1.25 };
    const dying = ally(1);
    const healthy = ally(199);
    expect(calculateHealing(me, rank3, dying)).toBeGreaterThan(calculateHealing(me, emergencyBloom, dying));
    expect(calculateHealing(me, rank3, healthy)).toBeLessThan(calculateHealing(me, rank3, dying) / 5);
  });
});
