import { CombatUnit, HeroSkill } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { castHeartMove } from '@/systems/combat/heartActions';
import { anchorsOf } from '@/systems/combat/heartScript';
import { threatensUnit } from '@/systems/combat/preparedAttacks';
import { decideTactically } from '@/systems/combat/tacticalAI';
import { hexKey } from '@/utils/hexUtils';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * What the tactical AI weighs besides health: a foe's objective is worth breaking, and a warning that
 * names an ally is worth stepping out of (the private project notes). Both are read on the
 * Heart of Winter, whose anchors take 99% of every blow off it while they stand.
 */

const fx = { log: () => {}, float: () => {} };

const hero = (id: string, position = at(0, 3)) =>
  makeUnit({
    id,
    heroId: id,
    name: id,
    position,
    stats: makeStats({ maxHp: 5000, attack: 60, speed: 5, critChance: 0, dodgeChance: 0, moveRange: 3 }),
    skills: [makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 6 })],
  });

const units = () => useCombatStore.getState().units;
const heart = (): CombatUnit => units().find((u) => u.templateId === 'heart_of_winter')!;

function start(heroes: CombatUnit[]) {
  const store = useCombatStore.getState();
  store.reset();
  const [boss] = createEnemyUnits(['heart_of_winter'], [at(0, -4)], 1, 1);
  store.initCombat(heroes, [boss]);
  store.patchBossScript(heart().id, { phaseTurns: 1 });
}

// Fixed dice: no slips and no forgotten danger, and no clock to cut a decision short
const decide = (unit: CombatUnit) => decideTactically(unit, 'easy', { rng: () => 0.99, maxMs: Infinity }).actions;

describe('a foe\'s objective', () => {
  it('is struck before the boss it shields', () => {
    start([hero('h1', at(0, 0))]);
    const me = units().find((u) => u.id === 'h1')!;
    const anchors = anchorsOf(heart(), units()).map((a) => hexKey(a.position));
    const turn = decide(me);
    const cast = turn.find((a) => a.type === 'skill');
    expect(cast).toBeDefined();
    expect(anchors).toContain(hexKey(cast!.skillTarget!));
  });
});

describe('a warning that names an ally', () => {
  it('is stepped out of', () => {
    start([hero('h1', at(0, 1)), hero('h2', at(1, 1))]);
    expect(castHeartMove(heart(), heart().skills.find((s) => s.id === 'creeping_winter')!, fx).ok).toBe(true);
    // The warning is stretched over the hero's hex, as a chain or a blast over a hero would be
    const [warning] = useCombatStore.getState().preparedAttacks;
    const target = units().find((u) => u.id === 'h1')!;
    useCombatStore.getState().updatePreparedAttack(warning.id, { hexes: [target.position] });
    const named = [target];
    expect(threatensUnit(useCombatStore.getState().preparedAttacks[0], target, units())).toBe(true);

    const me = named[0];
    const turn = decide(me);
    const walk = turn.find((a) => a.type === 'move');
    expect(walk).toBeDefined();
    const after = units().map((u) => (u.id === me.id ? { ...u, position: walk!.targetPos! } : u));
    const moved = after.find((u) => u.id === me.id)!;
    expect(useCombatStore.getState().preparedAttacks.some((p) => threatensUnit(p, moved, after))).toBe(false);
  });
});
