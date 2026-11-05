import { BALANCE } from '@/data/balanceConstants';
import { difficultyDamage, difficultyMultipliers, sparesStrength } from '@/systems/combat/runDifficulty';
import { AfflictionType, AuraType } from '@/models/types';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { calculateDamage, resolveAttack } from '@/systems/combat/damageCalc';
import { createSummonUnits, summonStatsFor } from '@/systems/combat/summoning';
import { findSummonTemplate } from '@/data/templates/summonTemplates';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { useRunSettingsStore } from '@/stores/runSettingsStore';
import { useCombatStore } from '@/stores/combatStore';
import { scaleOf } from '@/systems/combat/eliteWarnings';
import { applyOnHitStatuses } from '@/systems/combat/combatEvents';
import { poisonTickDamage, shatterBurst } from '@/systems/combat/statusEffects';
import { makeStats, makeUnit } from '../support/fixtures';

const difficulties = [
  ['easy', 0.75], ['medium', 1], ['hard', 1.25],
] as const;
const target = () => makeUnit({ id: 'hero', heroId: 'h', stats: makeStats({ maxHp: 10000 }), currentHp: 10000 });
const at = [{ q: 0, r: 0 }];
beforeEach(() => { useRunSettingsStore.getState().begin(); useCombatStore.getState().reset(); });
afterEach(() => useRunSettingsStore.getState().begin());

it.each(difficulties)('%s scales every regular enemy, elite and boss HP without changing their other stats', (difficulty, multiplier) => {
  for (const template of enemyTemplates) {
    // Spared `ENEMY_STRENGTH`, so the difficulty is measured on its own (the dial's own test is below)
    const [base] = createEnemyUnits([template.id], at, 8, 1.2, true);
    useRunSettingsStore.getState().begin({ difficulty, hardcore: false });
    const [scaled] = createEnemyUnits([template.id], at, 8, 1.2, true);
    expect(scaled.stats).toEqual({ ...base.stats, maxHp: Math.round(base.stats.maxHp * multiplier) });
    expect(scaled.currentHp).toBe(scaled.stats.maxHp);
    useRunSettingsStore.getState().begin();
  }
});

it.each(difficulties)('%s applies the damage bonus once after defence for a regular, boss and summon', (difficulty, multiplier) => {
  const [regular, boss] = createEnemyUnits(['goblin', 'aethelred'], [at[0], { q: 1, r: 0 }], 1, 1, true);
  const [summon] = createSummonUnits({ templateId: 'legion_infantry', count: 1 }, boss, at, 8);
  for (const attacker of [regular, boss, summon]) {
    for (const defense of [0, 100]) {
      const victim = { ...target(), stats: makeStats({ maxHp: 10000, defense, magicDefense: defense, dodgeChance: 0 }) };
      const skill = attacker.skills.find(s => s.damage)!;
      useRunSettingsStore.getState().begin();
      const base = calculateDamage(attacker, victim, skill);
      useRunSettingsStore.getState().begin({ difficulty, hardcore: false });
      const expected = Math.max(1, Math.round(base * multiplier));
      expect(calculateDamage(attacker, victim, skill)).toBe(expected);
      const strike = resolveAttack(attacker, victim, skill, { rng: () => 0.99 });
      useCombatStore.getState().initCombat([victim], [attacker]);
      expect(useCombatStore.getState().damageUnit(victim.id, strike.damage, attacker.id, { difficultyApplied: true }).hpLost).toBe(expected);
    }
  }
});

it.each(difficulties)('%s scales enemy summons and transformed stages but leaves player summons unchanged', (difficulty, multiplier) => {
  const template = findSummonTemplate('legion_infantry')!;
  const base = summonStatsFor(template, 8);
  useRunSettingsStore.getState().begin({ difficulty, hardcore: false });
  const caster = makeUnit({ isPlayer: false });
  const [enemy] = createSummonUnits({ templateId: 'legion_infantry', count: 1 }, caster, at, 8);
  const [ally] = createSummonUnits({ templateId: 'legion_infantry', count: 1 }, { ...caster, isPlayer: true }, at, 8);
  expect(enemy.stats).toEqual({ ...base, maxHp: Math.round(base.maxHp * multiplier) });
  expect(ally.stats).toEqual(base);
  useCombatStore.getState().initCombat([target()], [enemy]);
  useCombatStore.getState().transformUnit(enemy.id, 'legion_infantry', 8);
  expect(useCombatStore.getState().units.find(u => u.id === enemy.id)!.stats).toEqual(enemy.stats);
});

it.each(difficulties)('%s never uses difficulty HP as an extra summon attack/defence multiplier', (difficulty) => {
  const [base] = createEnemyUnits(['goblin'], at, 8, 1.2);
  const baseScale = scaleOf(base);
  useRunSettingsStore.getState().begin({ difficulty, hardcore: false });
  const [scaled] = createEnemyUnits(['goblin'], at, 8, 1.2);
  expect(scaleOf(scaled)).toBe(baseScale);
});

it.each(difficulties)('%s covers enemy DoT, Doom, fixed damage and reflection; ignores player and authorless damage', (difficulty, multiplier) => {
  useRunSettingsStore.getState().begin({ difficulty, hardcore: false });
  const foe = makeUnit({ id: 'foe', isPlayer: false, stats: makeStats({ maxHp: 10000 }), currentHp: 10000 });
  for (const type of [AfflictionType.Burn, AfflictionType.Bleed, AfflictionType.Doom]) {
    const hero = { ...target(), activeEffects: [{ type, magnitude: 40, duration: 1, sourceUnitId: foe.id }] };
    useCombatStore.getState().initCombat([hero], [foe]);
    useCombatStore.getState().tickEffectsOnUnit(hero.id);
    expect(useCombatStore.getState().units[0].currentHp).toBe(10000 - Math.round(40 * multiplier));
  }
  const hero = target();
  useCombatStore.getState().initCombat([hero], [foe]);
  expect(useCombatStore.getState().damageUnit(hero.id, 40, foe.id).hpLost).toBe(Math.round(40 * multiplier));
  expect(useCombatStore.getState().damageUnit(foe.id, 40, hero.id).hpLost).toBe(40);
  expect(useCombatStore.getState().damageUnit(hero.id, 40).hpLost).toBe(40);
  expect(useCombatStore.getState().damageUnit(foe.id, 40, foe.id).hpLost).toBe(40);
  const thorns = { ...foe, activeEffects: [{ type: AuraType.Thorns, magnitude: 0.5, duration: -1 }] };
  useCombatStore.getState().initCombat([hero], [thorns]);
  applyOnHitStatuses(hero, thorns, 80);
  expect(useCombatStore.getState().units[0].currentHp).toBe(10000 - Math.round(40 * multiplier));
});

it.each(difficulties)('%s scales poison ticks even after their source dies and scales Freeze shattering once', (difficulty, multiplier) => {
  useRunSettingsStore.getState().begin({ difficulty, hardcore: false });
  const foe = makeUnit({ id: 'foe', isPlayer: false, currentHp: 0 });
  const poison = { type: AfflictionType.Poison, magnitude: 40, duration: 3, stacks: 1, sourceUnitId: foe.id };
  const hero = { ...target(), activeEffects: [poison] };
  useCombatStore.getState().initCombat([hero], [foe]);
  useCombatStore.getState().tickEffectsOnUnit(hero.id);
  expect(useCombatStore.getState().units[0].currentHp).toBe(10000 - Math.round(poisonTickDamage(poison) * multiplier));

  const frozen = { ...target(), activeEffects: [{ type: AfflictionType.Freeze, magnitude: 1, duration: 2 }] };
  useCombatStore.getState().initCombat([frozen], [foe]);
  expect(useCombatStore.getState().damageUnit(frozen.id, 40, foe.id).hpLost)
    .toBe(Math.round(40 * multiplier) + Math.round(shatterBurst(frozen) * multiplier));
});

describe('ENEMY_STRENGTH, the whole world\'s dial (playtest 2026-10-30)', () => {
  const strength = BALANCE.ENEMY_STRENGTH;

  it('raises every hostile unit\'s HP and finished damage on top of the difficulty, and spares a home-ring foe', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      useRunSettingsStore.getState().begin({ difficulty, hardcore: false });
      const scale = BALANCE.RUN_DIFFICULTY[difficulty];
      expect(difficultyMultipliers()).toEqual({ hp: scale.hp * strength.hp, damage: scale.damage * strength.damage });
      expect(difficultyMultipliers(undefined, true)).toEqual(scale);
    }
    useRunSettingsStore.getState().begin();
    const [raised] = createEnemyUnits(['goblin'], at, 8, 1.2);
    const [spared] = createEnemyUnits(['goblin'], at, 8, 1.2, true);
    expect(raised.sparedStrength).toBeUndefined();
    expect(spared.sparedStrength).toBe(true);
    expect(raised.stats.maxHp).toBe(Math.round(spared.stats.maxHp * strength.hp));
    expect({ ...raised.stats, maxHp: 0 }).toEqual({ ...spared.stats, maxHp: 0 });
    expect(difficultyDamage(100, raised)).toBe(Math.round(100 * strength.damage));
    expect(difficultyDamage(100, spared)).toBe(100);
    expect(difficultyDamage(100, { isPlayer: true })).toBe(100);
  });

  it('passes a home-ring foe\'s sparing to what it summons', () => {
    const [caster] = createEnemyUnits(['aethelred'], at, 8, 1, true);
    const [summon] = createSummonUnits({ templateId: 'legion_infantry', count: 1 }, caster, at, 8);
    expect(summon.sparedStrength).toBe(true);
    expect(summon.stats.maxHp).toBe(summonStatsFor(findSummonTemplate('legion_infantry')!, 8).maxHp);
  });

  it('spares the home ring alone: band 0, never the castle or the siege', () => {
    expect(sparesStrength(0, false)).toBe(true);
    expect(sparesStrength(0, true)).toBe(false);
    for (const band of [1, 2, 3, 4]) expect(sparesStrength(band, false)).toBe(false);
  });
});
