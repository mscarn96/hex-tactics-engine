// Mock effectiveStats to avoid the uuid module ESM issue
jest.mock('@/systems/combat/effectiveStats', () => ({
  getCombatEffectiveStats: (unit: any) => ({ ...unit.stats }),
}));

import { calculateDamage, calculateHealing } from '@/systems/combat/damageCalc';
import { BALANCE } from '@/data/balanceConstants';
import { makeSkill, makeStats, makeUnit as baseUnit } from '../support/fixtures';

const makeUnit = (attack: number, defense: number, magic = 0) =>
  baseUnit({
    id: 'u1', name: 'Test', templateId: 'warrior',
    stats: makeStats({ attack, defense, magic, speed: 5 }),
  });

const makeAttackSkill = (damage: number) => makeSkill({ id: 'slash', name: 'Attack', damage });
const makeHealSkill = (healing: number) => makeSkill({ id: 'heal', name: 'Heal', healing });

describe('calculateDamage', () => {
  it('takes a share of the hit off: defence / (defence + K × the attacker\'s power)', () => {
    const attacker = makeUnit(10, 0);
    const target = makeUnit(0, 4);
    const skill = makeAttackSkill(2);
    // 20 × (1 − 4 / (4 + 3 × 10)) = 17.6 → 18
    expect(BALANCE.DEFENSE_ATTACKER_K).toBe(3);
    expect(calculateDamage(attacker, target, skill)).toBe(18);
  });

  // Playtest 2026-10-14: flat subtraction made a stacked tank immune to small hits and
  // barely dented big ones. Defence is a percentage of the whole hit now.
  it('takes the same share off a big hit as off a small one from the same attacker', () => {
    const attacker = makeUnit(100, 0);
    const wall = makeUnit(0, 140);
    const small = calculateDamage(attacker, wall, makeAttackSkill(0.6));
    const big = calculateDamage(attacker, wall, makeAttackSkill(3));
    expect(small / 60).toBeCloseTo(big / 300, 1);
    expect(big).toBeLessThan(300 - 0.4 * 140);
  });

  // Playtest 2026-10-17: K 1.5 → 3, defence having made a level-12 Monk all but untouchable to the first boss.
  it('takes 25% off at 100 defence against 100 power, with diminishing returns past it', () => {
    const attacker = makeUnit(100, 0);
    const hit = makeAttackSkill(1);
    expect(calculateDamage(attacker, makeUnit(0, 100), hit)).toBe(75);
    const at = (def: number) => 100 - calculateDamage(attacker, makeUnit(0, def), hit);
    expect(at(100) - at(50)).toBeGreaterThan(at(150) - at(100));
    // Even three times the attacker's power in defence leaves well over the floor
    expect(calculateDamage(attacker, makeUnit(0, 300), hit)).toBeGreaterThan(100 * BALANCE.MIN_DAMAGE_FRACTION);
  });

  it('applies the flank and backstab multipliers after defence', () => {
    const attacker = makeUnit(10, 0);
    const target = makeUnit(0, 0);
    const skill = makeAttackSkill(2);
    const normal = calculateDamage(attacker, target, skill, 'front');
    expect(calculateDamage(attacker, target, skill, 'side')).toBe(Math.round(normal * BALANCE.FLANK_MULTIPLIER));
    expect(calculateDamage(attacker, target, skill, 'back')).toBe(Math.round(normal * BALANCE.BACKSTAB_MULTIPLIER));
  });

  it('never returns less than MIN_DAMAGE', () => {
    const weakAttacker = makeUnit(1, 0);
    const tankTarget = makeUnit(0, 100);
    const skill = makeAttackSkill(0.1);
    const damage = calculateDamage(weakAttacker, tankTarget, skill);
    expect(damage).toBeGreaterThanOrEqual(BALANCE.MIN_DAMAGE);
  });

  it('returns 0 damage for a zero-damage skill', () => {
    const attacker = makeUnit(10, 0);
    const target = makeUnit(0, 0);
    const skill = makeAttackSkill(0);
    // 10 * 0 - 0 * 0.5 = 0, but min is MIN_DAMAGE=1
    expect(calculateDamage(attacker, target, skill)).toBe(BALANCE.MIN_DAMAGE);
  });

  it('rounds damage to nearest integer', () => {
    const attacker = makeUnit(7, 0);
    const target = makeUnit(0, 2);
    const skill = makeAttackSkill(1);
    // 7 × (1 − 2 / (2 + 21)) = 6.39 → 6
    expect(calculateDamage(attacker, target, skill)).toBe(6);
  });
});

describe('calculateHealing', () => {
  it('calculates healing: magic * multiplier', () => {
    const caster = makeUnit(0, 0, 10);
    const skill = makeHealSkill(1.5);
    expect(calculateHealing(caster, skill)).toBe(15);
  });

  it('returns 0 for zero magic or zero healing multiplier', () => {
    const caster = makeUnit(0, 0, 0);
    const skill = makeHealSkill(2);
    expect(calculateHealing(caster, skill)).toBe(0);

    const caster2 = makeUnit(0, 0, 10);
    const zeroSkill = makeHealSkill(0);
    expect(calculateHealing(caster2, zeroSkill)).toBe(0);
  });

  it('rounds healing to nearest integer', () => {
    const caster = makeUnit(0, 0, 7);
    const skill = makeHealSkill(1.5);
    // 7 * 1.5 = 10.5 -> rounds to 11
    expect(calculateHealing(caster, skill)).toBe(11);
  });
});
