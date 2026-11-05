import { AuraType, HeroSkill, SkillTargetType } from '@/models/types';
import { ALL_SKILLS } from '@/data/skills/skillData';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { DRAGON_FOLLOW_UPS } from '@/data/templates/emeraldDragon';
import { HEART_FOLLOW_UPS, HEART_UNBOUND_SKILLS } from '@/data/templates/heartOfWinter';
import { ELITE_SKILLS } from '@/data/skills/eliteSkills';
import { AETHELRED_SKILLS } from '@/data/templates/aethelred';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { summonTemplates } from '@/data/templates/summonTemplates';
import { SKILL_DAMAGE_TYPES } from '@/data/skills/damageTypes';
import { WEAPON_ATTACKS } from '@/data/items/weaponAttacks';
import { BALANCE } from '@/data/balanceConstants';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { damageTypeOf, magicDefenseOf } from '@/systems/combat/damageType';
import { scaleEnemyStats } from '@/systems/combat/unitFactory';
import { applyStatMultipliers } from '@/systems/combat/forms';
import { phasesFor } from '@/systems/combat/bossPhases';
import { skillStatLine } from '@/data/display/skillDisplay';
import { at, makeFoe, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * Physical and magic are hit types, each answered by its own defence, and the
 * type is a decision rather than a consequence of the stat the hit scales with.
 */

const attacker = (over = {}) =>
  makeUnit({ stats: makeStats({ attack: 40, magic: 40, critChance: 0, dodgeChance: 0, ...over }) });

const target = (over = {}) =>
  makeFoe({ position: at(1, 0), stats: makeStats({ maxHp: 500, ...over }) });

const strike = (over: Partial<HeroSkill> = {}) =>
  makeSkill({ damage: 1, range: 1, targetType: SkillTargetType.Single, ...over });

describe('boss defence playtest tuning', () => {
  // The single defence each boss is authored with (`bossDefences(n)`), which the split scales
  // up for physical hits and down for magic. Dragon 12 → 10 and the Heart 14 → 13 in their
  // 2026-10-19 nerfs (eaddf0a0, e983b99d), and Aethelred 20 → 16 in the playtest of 2026-10-28.
  const previousDefence: Record<string, number> = {
    dragon: 10, troll_chieftain: 9, heart_of_winter: 13, aethelred: 16,
    // Jadeveil: Silent Hall / Fallen Order
    last_lesson: 16,
    // Jadeveil: Silk Hollow / Yokai — authored through `bossDefences(15)` from the start
    jorogumo: 15,
    // Jadeveil: Kairen — authored through `bossDefences(20)` from the start, as Aethelred's
    kairen: 20,
  };
  it('makes physical hits slightly weaker and magic hits slightly stronger through encounter scaling and phases', () => {
    const bosses = enemyTemplates.filter(t => t.tier === 'boss');
    expect(bosses.map(t => t.id).sort()).toEqual(Object.keys(previousDefence).sort());
    for (const boss of bosses) {
      const old = previousDefence[boss.id];
      expect(boss.baseStats.defense).toBeGreaterThan(old);
      expect(magicDefenseOf(boss.baseStats)).toBeLessThan(old);
      // A representative level-10 lair party; phase profiles must preserve both channels.
      const before = scaleEnemyStats({ ...boss.baseStats, defense: old, magicDefense: old }, 10, 1.25);
      const after = scaleEnemyStats(boss.baseStats, 10, 1.25);
      const phases = phasesFor(boss.id) ?? [{ stats: undefined }];
      for (const phase of phases) {
        const beforeTarget = target(applyStatMultipliers(before, phase.stats));
        const afterTarget = target(applyStatMultipliers(after, phase.stats));
        const source = attacker({ attack: 200, magic: 200 });
        const physical = strike({ damageType: 'physical', scaling: 'attack' });
        const magic = strike({ damageType: 'magic', scaling: 'magic' });
        expect(calculateDamage(source, afterTarget, physical)).toBeLessThan(calculateDamage(source, beforeTarget, physical));
        expect(calculateDamage(source, afterTarget, magic)).toBeGreaterThan(calculateDamage(source, beforeTarget, magic));
      }
    }
  });
});

describe('which defence answers a hit', () => {
  it('mitigates a physical hit by Physical Defense only', () => {
    const skill = strike({ damageType: 'physical' });
    const bare = calculateDamage(attacker(), target({ defense: 0, magicDefense: 0 }), skill);
    const armoured = calculateDamage(attacker(), target({ defense: 30, magicDefense: 0 }), skill);
    const warded = calculateDamage(attacker(), target({ defense: 0, magicDefense: 30 }), skill);

    expect(armoured).toBeLessThan(bare);
    expect(warded).toBe(bare);
  });

  it('mitigates a magic hit by Magic Defense only', () => {
    const skill = strike({ damageType: 'magic' });
    const bare = calculateDamage(attacker(), target({ defense: 0, magicDefense: 0 }), skill);
    const armoured = calculateDamage(attacker(), target({ defense: 30, magicDefense: 0 }), skill);
    const warded = calculateDamage(attacker(), target({ defense: 0, magicDefense: 30 }), skill);

    expect(armoured).toBe(bare);
    expect(warded).toBeLessThan(bare);
  });

  it('does not let hybrid scaling decide the hit type', () => {
    const wall = target({ defense: 30, magicDefense: 0 });
    const bare = target({ defense: 0, magicDefense: 0 });
    const hybridPhysical = strike({ scaling: 'hybrid', damageType: 'physical' });
    const hybridMagic = strike({ scaling: 'hybrid', damageType: 'magic' });

    expect(calculateDamage(attacker(), wall, hybridPhysical)).toBeLessThan(
      calculateDamage(attacker(), bare, hybridPhysical),
    );
    expect(calculateDamage(attacker(), wall, hybridMagic)).toBe(
      calculateDamage(attacker(), bare, hybridMagic),
    );
  });

  it('lets a magic-scaled hit be physical and an attack-scaled one be magic', () => {
    const wall = target({ defense: 30, magicDefense: 0 });
    const bare = target({ defense: 0, magicDefense: 0 });
    const earth = strike({ scaling: 'magic', damageType: 'physical' });
    const spellblade = strike({ scaling: 'attack', damageType: 'magic' });

    expect(calculateDamage(attacker(), wall, earth)).toBeLessThan(
      calculateDamage(attacker(), bare, earth),
    );
    expect(calculateDamage(attacker(), wall, spellblade)).toBe(
      calculateDamage(attacker(), bare, spellblade),
    );
  });

  it('keeps a nonzero floor against either defence', () => {
    const huge = target({ defense: 9999, magicDefense: 9999 });
    const floor = Math.round(40 * BALANCE.MIN_DAMAGE_FRACTION);
    expect(calculateDamage(attacker(), huge, strike({ damageType: 'physical' }))).toBe(floor);
    expect(calculateDamage(attacker(), huge, strike({ damageType: 'magic' }))).toBe(floor);
  });

  it('resolves an unassigned skill to physical', () => {
    expect(damageTypeOf({ id: 'not_a_real_skill' as HeroSkill['id'] })).toBe('physical');
  });
});

describe('Magic Defense on the sheet', () => {
  it('tracks Physical Defense when a unit states none', () => {
    const plain = makeFoe({ stats: makeStats({ defense: 12 }) });
    expect(magicDefenseOf(plain.stats)).toBe(Math.round(12 * BALANCE.MAGIC_DEFENSE_RATIO));
    expect(getCombatEffectiveStats(plain).magicDefense).toBe(magicDefenseOf(plain.stats));
  });

  it('is independent once stated', () => {
    const unit = makeFoe({ stats: makeStats({ defense: 12, magicDefense: 3 }) });
    const effective = getCombatEffectiveStats(unit);
    expect(effective.defense).toBe(12);
    expect(effective.magicDefense).toBe(3);
  });

  it('keeps Physical Defence buffs independent of Magic Defence', () => {
    const unit = makeFoe({
      stats: makeStats({ defense: 10, magicDefense: 4 }),
      activeEffects: [{ type: AuraType.DefenseBuff, duration: 2, magnitude: 5 }],
    });
    const effective = getCombatEffectiveStats(unit);
    expect(effective.defense).toBe(15);
    expect(effective.magicDefense).toBe(4);
  });
});

describe('every attack has a deliberate type', () => {
  const everySkill = (): HeroSkill[] => {
    const seen = new Map<string, HeroSkill>();
    const add = (s: HeroSkill) => seen.set(s.id, s);
    ALL_SKILLS.forEach(add);
    MASTERY_SKILLS.forEach(add);
    AETHELRED_SKILLS.forEach(add);
    DRAGON_FOLLOW_UPS.forEach(add);
    HEART_FOLLOW_UPS.forEach(add);
    HEART_UNBOUND_SKILLS.forEach(add);
    ELITE_SKILLS.forEach(add);
    for (const t of enemyTemplates) t.skills.forEach(add);
    for (const t of summonTemplates) t.skills.forEach(add);
    return [...seen.values()];
  };

  it('lists every damaging skill the game fields', () => {
    const missing = everySkill()
      .filter((s) => s.damage && !s.damageType && SKILL_DAMAGE_TYPES[s.id] === undefined)
      .map((s) => s.id);
    expect(missing).toEqual([]);
  });

  it('names no skill that does not exist', () => {
    const ids = new Set<string>(everySkill().map((s) => s.id));
    const stale = Object.keys(SKILL_DAMAGE_TYPES).filter((id) => !ids.has(id));
    expect(stale).toEqual([]);
  });

  it('gives every weapon profile a type, magic for the missiles', () => {
    for (const profile of Object.values(WEAPON_ATTACKS)) {
      expect(profile.damageType).toBe(profile.style === 'missile' ? 'magic' : 'physical');
    }
  });
});

describe('what the player reads', () => {
  it('states the hit type on the power chip', () => {
    expect(skillStatLine(strike({ scaling: 'magic', damageType: 'magic' }))).toContain('MAG magic');
    expect(skillStatLine(strike({ scaling: 'magic', damageType: 'physical' }))).toContain('MAG physical');
  });
});
