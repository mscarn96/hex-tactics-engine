import { decideEnemyAction } from '@/systems/combat/enemyAI';
import { fallbackBasicAttack } from '@/systems/combat/enemyBasicAttack';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { caveIn, slash } from '@/data/skills/skillData';
import { BALANCE } from '@/data/balanceConstants';
import { AfflictionType, CombatUnit, HexCoord, SkillTargetType } from '@/models/types';
import { makeEffect, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * Playtest 2026-10-23: a taunted elite whose kit was all area skills found nothing
 * it could aim at the taunter alone and passed its turn. Every enemy now falls back
 * on a Basic Attack read off its kit rather than doing nothing.
 */

const brute = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({
    id: 'brute', isPlayer: false, skills: [caveIn], position: { q: 0, r: 0 },
    stats: makeStats({ maxHp: 200, attack: 20, defense: 6, moveRange: 3 }), ...over,
  });
const hero = (id: string, pos: HexCoord): CombatUnit =>
  makeUnit({ id, isPlayer: true, heroId: id, position: pos, stats: makeStats({ maxHp: 400, defense: 6 }) });
const taunted = (by: string) => [makeEffect(AfflictionType.Taunt, { duration: 2, sourceUnitId: by, magnitude: 1 })];

const casts = (actions: ReturnType<typeof decideEnemyAction>) =>
  actions.filter((a) => a.type === 'skill').map((a) => a.skill?.id);

describe('the fallback Basic Attack', () => {
  it('is what a taunted unit of area skills strikes the taunter with', () => {
    const tank = hero('tank', { q: 1, r: 0 });
    const caster = brute({ activeEffects: taunted('tank') });
    expect(casts(decideEnemyAction(caster, [caster, tank, hero('b', { q: -1, r: 0 })]))).toEqual([BASIC_ATTACK_ID]);
  });

  it('is struck when every skill is cooling and a hero stands in reach', () => {
    const caster = brute({ cooldowns: { [caveIn.id]: 2 } });
    expect(casts(decideEnemyAction(caster, [caster, hero('a', { q: 1, r: 0 })]))).toEqual([BASIC_ATTACK_ID]);
  });

  it('never replaces a skill the unit can use', () => {
    const caster = brute({ skills: [slash] });
    expect(casts(decideEnemyAction(caster, [caster, hero('a', { q: 1, r: 0 })]))).toEqual([slash.id]);
  });

  it('is struck by a silenced enemy in reach', () => {
    const caster = brute({ activeEffects: [makeEffect(AfflictionType.Silence, { duration: 1 })] });
    expect(casts(decideEnemyAction(caster, [caster, hero('a', { q: 1, r: 0 })]))).toEqual([BASIC_ATTACK_ID]);
  });

  it('reads its reach and stat off the kit, under every authored blow', () => {
    const bolt = makeSkill({ targetType: SkillTargetType.Single, range: 5, damage: 1, scaling: 'magic' });
    const arrow = makeSkill({ targetType: SkillTargetType.Single, range: 4, damage: 1, scaling: 'attack' });
    const club = makeSkill({ targetType: SkillTargetType.Single, range: 1, damage: 1, scaling: 'attack' });
    expect(fallbackBasicAttack({ skills: [bolt] })).toMatchObject({ scaling: 'magic', range: BALANCE.ENEMY_BASIC_ATTACK_RANGED_REACH });
    expect(fallbackBasicAttack({ skills: [arrow] })).toMatchObject({ scaling: 'attack', range: BALANCE.ENEMY_BASIC_ATTACK_RANGED_REACH });
    expect(fallbackBasicAttack({ skills: [club, arrow] })).toMatchObject({ scaling: 'attack', range: 1 });
    expect(fallbackBasicAttack({ skills: [] }).damage).toBe(BALANCE.ENEMY_BASIC_ATTACK_DAMAGE);
  });
});
