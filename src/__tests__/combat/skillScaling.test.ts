import { calculateDamage } from '@/systems/combat/damageCalc';
import * as skills from '@/data/skills/skillData';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { CombatUnit, HeroSkill, HeroStats } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { makeStats, makeUnit } from '../support/fixtures';
import { starterBasicAttack } from '@/systems/combat/basicAttack';

const allSkills: HeroSkill[] = Object.values(skills).filter(
  (s): s is HeroSkill => typeof s === 'object' && s !== null && 'id' in s && 'targetType' in s
);

const unit = (stats: Partial<HeroStats>, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({
    id: 'u', isPlayer: false,
    stats: makeStats({ attack: 10, moveRange: 2, maxMana: 0, ...stats }),
    ...over,
  });

const dummy = unit({ defense: 0 });

describe('damage scaling', () => {
  const brawn = unit({ attack: 30, magic: 0 });
  const brains = unit({ attack: 0, magic: 30 });

  it('scales a weapon skill off attack and ignores magic', () => {
    expect(calculateDamage(brawn, dummy, skills.slash)).toBeGreaterThan(
      calculateDamage(brains, dummy, skills.slash)
    );
  });

  it('scales a spell off magic and ignores attack', () => {
    expect(calculateDamage(brains, dummy, skills.arcaneBolt)).toBeGreaterThan(
      calculateDamage(brawn, dummy, skills.arcaneBolt)
    );
  });

  // The whole point of the change: magic gear has to reach a caster's damage
  it('makes +magic increase spell damage', () => {
    const before = calculateDamage(unit({ magic: 16 }), dummy, skills.arcaneBolt);
    const after = calculateDamage(unit({ magic: 26 }), dummy, skills.arcaneBolt);
    expect(after).toBeGreaterThan(before);
  });

  it('leaves physical skills untouched by +magic', () => {
    const before = calculateDamage(unit({ attack: 14, magic: 4 }), dummy, skills.slash);
    const after = calculateDamage(unit({ attack: 14, magic: 40 }), dummy, skills.slash);
    expect(after).toBe(before);
  });

  it('defaults to attack when scaling is unspecified', () => {
    const noField: HeroSkill = { ...skills.slash, scaling: undefined };
    expect(calculateDamage(brawn, dummy, noField)).toBe(calculateDamage(brawn, dummy, skills.slash));
  });

  it('still subtracts defense on both paths', () => {
    const armoured = unit({ defense: 10 });
    for (const skill of [skills.slash, skills.arcaneBolt]) {
      expect(calculateDamage(unit({ attack: 30, magic: 30 }), armoured, skill))
        .toBeLessThan(calculateDamage(unit({ attack: 30, magic: 30 }), dummy, skill));
    }
  });
});

describe('every caster uses the stat it was built around', () => {
  // A template with high magic and low attack whose spells scaled off attack was
  // the original bug — a lair boss with attack 8 and magic 25
  const casters = [...heroTemplates, ...enemyTemplates].filter(
    (t) => t.baseStats.magic > t.baseStats.attack
  );

  it('finds the casters, so this suite is not vacuous', () => {
    expect(casters.length).toBeGreaterThan(0);
  });

  it('gives each caster at least one damage skill that scales off magic', () => {
    const broken = casters
      .filter((t) => t.skills.some((s) => s.damage))
      .filter((t) => !t.skills.some((s) => s.damage && s.scaling === 'magic'))
      .map((t) => t.id);
    expect(broken).toEqual([]);
  });

  it('never puts a magic-scaling skill on a template with no magic', () => {
    const brutes = [...heroTemplates, ...enemyTemplates].filter((t) => t.baseStats.magic <= 4);
    const wrong = brutes
      .filter((t) => t.skills.some((s) => s.scaling === 'magic'))
      .map((t) => t.id);
    expect(wrong).toEqual([]);
  });
});

describe('no skill carries a debug value', () => {
  // Several skills once shipped with `//op for testing` multipliers — slash at
  // 5.0 one-shot every enemy in the game
  it('keeps every damage multiplier inside the tuning band', () => {
    const outliers = allSkills
      .filter((s) => s.damage !== undefined && (s.damage <= 0 || s.damage > 2.0))
      .map((s) => `${s.id}=${s.damage}`);
    expect(outliers).toEqual([]);
  });

  it('keeps every healing multiplier inside the tuning band', () => {
    const outliers = allSkills
      .filter((s) => s.healing !== undefined && (s.healing <= 0 || s.healing > 2.0))
      .map((s) => `${s.id}=${s.healing}`);
    expect(outliers).toEqual([]);
  });

  it('leaves no hero able to one-shot a mid-tier enemy with a basic attack', () => {
    const goblin = enemyTemplates.find((t) => t.id === 'goblin')!;
    const target = unit(goblin.baseStats, { currentHp: goblin.baseStats.maxHp });
    for (const hero of heroTemplates) {
      const caster = unit(hero.baseStats);
      // The free attack is the starting weapon's now, not the template's
      const kit = [starterBasicAttack(hero.heroClass), ...hero.skills];
      for (const skill of kit.filter((s) => s.damage && s.manaCost === 0)) {
        expect({ hero: hero.id, skill: skill.id, oneShot: false }).toEqual({
          hero: hero.id,
          skill: skill.id,
          oneShot: calculateDamage(caster, target, skill) >= target.currentHp,
        });
      }
    }
  });

  it('lets every hero hurt a goblin by more than the minimum', () => {
    const goblin = enemyTemplates.find((t) => t.id === 'goblin')!;
    const target = unit(goblin.baseStats);
    for (const hero of heroTemplates) {
      const caster = unit(hero.baseStats);
      const best = Math.max(
        ...[starterBasicAttack(hero.heroClass), ...hero.skills]
          .filter((s) => s.damage)
          .map((s) => calculateDamage(caster, target, s))
      );
      expect({ hero: hero.id, usable: true }).toEqual({
        hero: hero.id,
        usable: best > BALANCE.MIN_DAMAGE,
      });
    }
  });
});
