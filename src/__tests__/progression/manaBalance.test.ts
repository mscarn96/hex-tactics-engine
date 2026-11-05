import { BALANCE } from '@/data/balanceConstants';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { casterManaCost } from '@/data/skills/casterMana';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import { nodeSkillAt } from '@/systems/progression/mastery';
import { makeHero, makeStats, makeUnit } from '../support/fixtures';
import { useCombatStore } from '@/stores/combatStore';

it('gives Shadowblade a larger pool and restores mana each regular turn', () => {
  const hero = makeHero({ masteryPath: 'shadowblade', baseStats: makeStats({ maxMana: 80 }) });
  const stats = getEffectiveStats(hero, []);
  expect(stats.maxMana).toBe(100);
  const unit = makeUnit({ stats, currentMana: 50 });
  useCombatStore.getState().initCombat([unit], []);
  useCombatStore.getState().tickEffectsOnUnit(unit.id);
  expect(useCombatStore.getState().units[0].currentMana).toBe(50 + BALANCE.MASTERY_MANA.BASE_REGEN + BALANCE.MASTERY_MANA.SHADOWBLADE_REGEN);
});

it('makes all five caster paths spend a smaller pool, with limited regeneration', () => {
  for (const masteryPath of ['pyromancer', 'hydromancer', 'stormcaller', 'lifewarden', 'stoneshaper'] as const) {
    const hero = makeHero({ masteryPath, baseStats: makeStats({ maxMana: 100 }) });
    const stats = getEffectiveStats(hero, []);
    expect(stats.maxMana).toBe(85);
    expect(stats.manaRegen).toBe(3);
    const path = MASTERY_PATHS.find((p) => p.id === masteryPath)!;
    const ultimates = path.nodes.filter((n) => n.tier === 3 && n.grantsSkill);
    for (const node of ultimates) {
      const low = nodeSkillAt(node, 1)!, high = nodeSkillAt(node, 3)!;
      expect(low.manaCost).toBeGreaterThan(high.manaCost);
      expect(high.manaCost).toBeGreaterThan(stats.manaRegen! * 4);
    }
  }
  expect(casterManaCost(20)).toBe(23);
  expect(casterManaCost(20, true)).toBe(30);
});
