import { AfflictionType, AuraType, CombatUnit, HeroSkill, SkillTargetType } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import {
  ANSWER_KINDS, addAnswers, mergeTallies, owedOf, packTally, sharesOf, unpackTally, type AnswerKind,
} from '@/systems/combat/answerTally';
import { isPreparedDue } from '@/systems/combat/preparedAttacks';
import { applySkillStatus } from '@/systems/combat/combatEvents';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { beginTurn } from '@/systems/combat/turnStart';
import { requireUnit } from '@/systems/combat/unitLookup';
import { at, makeFoe, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * The answer tally: how each warned move was answered.
 *
 * Each case below is one way of answering and pins which column it lands in; the columns of a move
 * always sum to the heroes it threatened that were still standing to be counted.
 */

const store = () => useCombatStore.getState();
const unitOf = (id: string) => requireUnit(store().units, id);

const warned = (prepares: HeroSkill['prepares'] = {}, over: Partial<HeroSkill> = {}): HeroSkill =>
  makeSkill({
    id: 'tally_smash' as HeroSkill['id'], name: 'Tally Smash', targetType: SkillTargetType.Ring,
    range: 0, aoeRadius: 1, damage: 2, cooldown: 3, prepares, ...over,
  });

const boss = (over: Partial<CombatUnit> = {}) =>
  makeFoe({ id: 'boss', name: 'Boss', position: at(0, 0), stats: makeStats({ maxHp: 400, attack: 30, speed: 20, critChance: 0, dodgeChance: 0 }), skills: [warned()], ...over });
const hero = (id: string, position: ReturnType<typeof at>, speed = 5) =>
  makeUnit({ id, name: id, heroId: id, position, stats: makeStats({ maxHp: 300, defense: 0, speed, critChance: 0, dodgeChance: 0, moveRange: 2 }) });

function start(heroes = [hero('a', at(1, 0), 10), hero('b', at(-1, 0), 5)], bossOver: Partial<CombatUnit> = {}) {
  store().reset();
  store().initCombat(heroes, [boss(bossOver)]);
  useCombatStore.setState({ currentUnitId: 'boss' });
}
const cast = (skill: HeroSkill = warned()) => resolveSkillUse(unitOf('boss'), skill, at(0, 0), SILENT_SINK);
const land = () => {
  // Turns pass until every hero owed a response has had it, then the boss's own begins
  for (let i = 0; i < 30 && store().preparedAttacks.some((p) => !isPreparedDue(p, store().units)); i++) store().nextTurn();
  return beginTurn('boss', SILENT_SINK);
};
const move = (id: string, to: ReturnType<typeof at>) =>
  useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === id ? { ...u, position: to } : u)) }));
const tally = () => store().answerTally.tally_smash;
const columns = (): Record<AnswerKind, number> => ({ ...tally() });

describe('where each answer lands', () => {
  it('stepped: left the footprint before the landing', () => {
    start();
    cast();
    move('a', at(3, 0));
    land();
    expect(columns()).toEqual({ stepped: 1, took: 1, blocked: 0, unharmed: 0, broken: 0 });
  });

  it('took: stood in it and was struck', () => {
    start();
    cast();
    land();
    expect(columns()).toEqual({ stepped: 0, took: 2, blocked: 0, unharmed: 0, broken: 0 });
  });

  it('blocked: the hero who held the line is the one counted, the rest of the footprint is unharmed', () => {
    start();
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'a' ? { ...u, passives: ['immovable' as never] } : u)) }));
    cast(warned({ blockedBy: { share: 0.5 } }));
    land();
    expect(columns()).toEqual({ stepped: 0, took: 0, blocked: 1, unharmed: 1, broken: 0 });
  });

  it('blocked: a hero braced against rubble took the blow and was not thrown; the one thrown took it', () => {
    start();
    store().addHazard({ id: 'heap', hexes: [at(2, 0)], solid: true, label: 'Rubble' });
    cast(warned({}, { pushDistance: 2 }));
    land();
    expect(unitOf('a').position).toEqual(at(1, 0));
    expect(unitOf('b').position).not.toEqual(at(-1, 0));
    expect(columns()).toEqual({ stepped: 0, took: 1, blocked: 1, unharmed: 0, broken: 0 });
  });

  it('unharmed: stood in it and was sheltered from it', () => {
    start();
    store().addHazard({ id: 'trench', hexes: [at(1, 0)], solid: false, label: 'trench' });
    cast(warned({ shelter: { onHazard: 'trench' } }));
    land();
    expect(columns()).toEqual({ stepped: 0, took: 1, blocked: 0, unharmed: 1, broken: 0 });
  });

  it('broken: the caster was interrupted, and everyone threatened saw it broken', () => {
    start();
    cast(warned({ interruptedBy: ['stun'] }));
    applySkillStatus(unitOf('a'), 'boss', { type: AfflictionType.Stun, magnitude: 1, duration: 2 }, undefined);
    expect(store().preparedAttacks).toHaveLength(0);
    expect(columns()).toEqual({ stepped: 0, took: 0, blocked: 0, unharmed: 0, broken: 2 });
  });

  it('broken: the objective the warning was bound to was destroyed', () => {
    start();
    cast();
    const [attack] = store().preparedAttacks;
    useCombatStore.setState((s) => ({
      units: [...s.units, makeFoe({
        id: 'crystal', name: 'Crystal', position: at(2, 2), stats: makeStats({ maxHp: 5 }),
        objective: { kind: 'crystal', ownerId: 'boss', linkedPreparedId: attack.id },
      })],
    }));
    store().damageUnit('crystal', 99, 'a');
    expect(store().preparedAttacks).toHaveLength(0);
    expect(columns().broken).toBe(2);
    expect(owedOf(tally())).toBe(2);
  });
});

describe('what is counted', () => {
  it('counts a landing once, and its columns sum to the heroes it threatened', () => {
    start([hero('a', at(1, 0), 10), hero('b', at(-1, 0), 5), hero('c', at(0, 1), 3), hero('far', at(3, 0), 2)]);
    cast();
    move('c', at(-3, 0));
    land();
    // Three were threatened; the one who never stood in it is owed nothing
    expect(owedOf(tally())).toBe(3);
    expect(columns()).toMatchObject({ stepped: 1, took: 2 });
  });

  it('does not count a hero who died before the landing', () => {
    start();
    cast();
    store().damageUnit('b', 9999);
    land();
    expect(owedOf(tally())).toBe(1);
  });

  it('counts a warning the whole party answers only for the heroes in its blast', () => {
    start([hero('a', at(1, 0), 10), hero('far', at(3, 3), 5)]);
    cast(warned({ everyone: true }));
    const [attack] = store().preparedAttacks;
    expect(attack.responders).toContain('far');
    expect(attack.threatened).toEqual(['a']);
    land();
    expect(owedOf(tally())).toBe(1);
    expect(columns().took).toBe(1);
  });

  it('starts every fight empty', () => {
    start();
    cast();
    land();
    expect(Object.keys(store().answerTally)).toHaveLength(1);
    start();
    expect(store().answerTally).toEqual({});
  });
});

describe('the tally as data', () => {
  it('adds, merges and shares by column', () => {
    const one = addAnswers({}, 'm', [{ kind: 'took' }, { kind: 'took' }, { kind: 'stepped' }, { kind: 'broken' }]);
    expect(one.m).toEqual({ stepped: 1, took: 2, blocked: 0, unharmed: 0, broken: 1 });
    const both = mergeTallies(one, addAnswers({}, 'm', [{ kind: 'blocked' }]));
    expect(owedOf(both.m)).toBe(5);
    const shares = sharesOf(both.m);
    expect(ANSWER_KINDS.reduce((sum, k) => sum + shares[k], 0)).toBeCloseTo(1);
    expect(shares.took).toBeCloseTo(0.4);
    expect(sharesOf({ stepped: 0, took: 0, blocked: 0, unharmed: 0, broken: 0 }).took).toBe(0);
  });

  it('survives the compact form a fight record stores', () => {
    const tallies = addAnswers(addAnswers({}, 'x', [{ kind: 'took' }, { kind: 'unharmed' }]), 'y', [{ kind: 'broken' }]);
    expect(unpackTally(JSON.parse(JSON.stringify(packTally(tallies))))).toEqual(tallies);
  });
});

it('keeps Barrier-holders out of it unless the warning can be blocked', () => {
  start();
  useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'a' ? { ...u, activeEffects: [{ type: AuraType.Barrier, magnitude: 1, duration: 3 }] } : u)) }));
  cast();
  land();
  expect(columns()).toEqual({ stepped: 0, took: 2, blocked: 0, unharmed: 0, broken: 0 });
});
