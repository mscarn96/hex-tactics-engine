import { controlWasted, decideEnemyAction } from '@/systems/combat/enemyAI';
import { caveIn, slash } from '@/data/skills/skillData';
import { AfflictionType, CombatUnit, HexCoord } from '@/models/types';
import { makeEffect, makeStats, makeUnit } from '../support/fixtures';

/**
 * Playtest 2026-10-14: Delve Breakers fight in pairs and both cast Cave-In on the
 * same hero in the same round, the second Stun merging into the first. A control
 * cooldown is not spent on bodies that are already held.
 */

const breaker = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({
    id: 'breaker', isPlayer: false, skills: [slash, caveIn], position: { q: 0, r: 0 },
    // Rooted to the spot, so Cave-In (range 3) is its only reach to a hero two hexes away
    stats: makeStats({ maxHp: 60, attack: 12, defense: 6, moveRange: 0 }), ...over,
  });
const hero = (id: string, pos: HexCoord, stunned = false): CombatUnit =>
  makeUnit({
    id, isPlayer: true, heroId: id, position: pos, stats: makeStats({ maxHp: 400, defense: 6 }),
    activeEffects: stunned ? [makeEffect(AfflictionType.Stun, { duration: 1 })] : [],
  });

const castIds = (actions: ReturnType<typeof decideEnemyAction>) =>
  actions.filter((a) => a.type === 'skill').map((a) => a.skill?.id);

describe('control the AI already has', () => {
  it('casts Cave-In on a hero who is free to act', () => {
    const caster = breaker();
    expect(castIds(decideEnemyAction(caster, [caster, hero('a', { q: 2, r: 0 })]))).toContain('cave_in');
  });

  it('holds Cave-In when the only hero it reaches is already stunned', () => {
    const caster = breaker();
    expect(castIds(decideEnemyAction(caster, [caster, hero('a', { q: 2, r: 0 }, true)]))).not.toContain('cave_in');
  });

  it('still casts when the blast stuns at least one hero who is free', () => {
    const caster = breaker();
    const units = [caster, hero('a', { q: 2, r: 0 }, true), hero('b', { q: 2, r: -1 })];
    expect(castIds(decideEnemyAction(caster, units))).toContain('cave_in');
  });

  it('never calls a killing blow wasted, nor a skill with no cooldown', () => {
    const held = hero('a', { q: 2, r: 0 }, true);
    expect(controlWasted(caveIn, [held], true)).toBe(false);
    expect(controlWasted({ ...caveIn, cooldown: 0 }, [held], false)).toBe(false);
    expect(controlWasted(caveIn, [held], false)).toBe(true);
  });
});
