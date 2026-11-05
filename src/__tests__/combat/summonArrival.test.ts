import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { applySummonArrival } from '@/systems/combat/combatEvents';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { summonElemental } from '@/data/skills/mastery/arcanist';
import { summonTreant } from '@/data/skills/mastery/druid';
import { CombatUnit, SummonArrivalSpec } from '@/models/types';
import { hexKey } from '@/utils/hexUtils';
import { at, makeStats, makeUnit } from '../support/fixtures';

/**
 * What arriving does to the ground it lands on.
 *
 * The whole point of aiming a summon is that where it lands matters on the turn
 * it lands, rather than only from its next one — a pet that has to walk before
 * it does anything is a spell cast a turn late. The rule lives in
 * `combatEvents` because both execution paths summon.
 */

const caster = (skills: CombatUnit['skills'], over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'caster',
    heroId: 'h1',
    position: at(0, 3),
    stats: makeStats({ magic: 20, maxMana: 100 }),
    skills,
    ...over,
  });

const ally = (id: string, pos: CombatUnit['position'], over: Partial<CombatUnit> = {}) =>
  makeUnit({ id, heroId: `h_${id}`, position: pos, ...over });

const foe = (id: string, pos: CombatUnit['position']) =>
  makeUnit({
    id,
    isPlayer: false,
    position: pos,
    stats: makeStats({ maxHp: 400, defense: 0, maxMana: 0 }),
  });

const units = () => useCombatStore.getState().units;
const byId = (id: string) => units().find((u) => u.id === id)!;
const summonNow = () => units().find((u) => u.summonedBy === 'caster')!;

const setup = (players: CombatUnit[], enemies: CombatUnit[]) => {
  useCombatStore.getState().reset();
  useCombatStore.getState().initCombat(players, enemies);
};

describe('the fire elemental scorches what it lands on', () => {
  it('damages enemies within the arrival radius', () => {
    setup([caster([summonElemental])], [foe('near', at(0, 1)), foe('far', at(0, -3))]);
    const nearBefore = byId('near').currentHp;
    const farBefore = byId('far').currentHp;

    const result = resolveSkillUse(byId('caster')!, summonElemental, at(0, 0), SILENT_SINK);
    expect(result.ok).toBe(true);
    expect(hexKey(summonNow().position)).toBe(hexKey(at(0, 0)));
    expect(byId('near').currentHp).toBeLessThan(nearBefore);
    expect(byId('far').currentHp).toBe(farBefore);
  });

  it('leaves its own side alone', () => {
    setup([caster([summonElemental]), ally('friend', at(0, 1))], [foe('foe', at(0, -3))]);
    const before = byId('friend').currentHp;
    resolveSkillUse(byId('caster')!, summonElemental, at(0, 0), SILENT_SINK);
    expect(byId('friend').currentHp).toBe(before);
  });

  // No duration at all: the decay is the clock, and a duration would be a second
  // one running against it
  it('arrives permanent, and burns down instead', () => {
    setup([caster([summonElemental])], [foe('foe', at(0, -3))]);
    resolveSkillUse(byId('caster')!, summonElemental, at(0, 0), SILENT_SINK);
    expect(summonNow().summonTurnsLeft).toBeUndefined();
  });

  it('is aimed at free ground, not dropped beside the caster', () => {
    setup([caster([summonElemental])], [foe('foe', at(0, 0))]);
    const hexes = getValidSkillTargetHexes(summonElemental, byId('caster')!, units());
    expect(hexes.map(hexKey)).not.toContain(hexKey(at(0, 0)));

    const refused = resolveSkillUse(byId('caster')!, summonElemental, at(0, 0), SILENT_SINK);
    expect(refused.ok).toBe(false);
    expect(refused.refusal).toBe('no-summon-room');
  });
});

describe('the treant mends what it comes up under', () => {
  it('heals allies within the arrival radius', () => {
    setup(
      [caster([summonTreant]), ally('hurt', at(0, 1), { currentHp: 40 })],
      [foe('foe', at(0, -3))],
    );

    const result = resolveSkillUse(byId('caster')!, summonTreant, at(0, 0), SILENT_SINK);
    expect(result.ok).toBe(true);
    expect(byId('hurt').currentHp).toBeGreaterThan(40);
  });

  it('never heals the enemy', () => {
    setup([caster([summonTreant])], [foe('foe', at(0, 1))]);
    const before = byId('foe').currentHp;
    useCombatStore.getState().damageUnit('foe', 100);
    const wounded = byId('foe').currentHp;
    expect(wounded).toBeLessThan(before);

    resolveSkillUse(byId('caster')!, summonTreant, at(0, 0), SILENT_SINK);
    expect(byId('foe').currentHp).toBe(wounded);
  });

  it('still expires on its own clock', () => {
    setup([caster([summonTreant])], [foe('foe', at(0, -3))]);
    resolveSkillUse(byId('caster')!, summonTreant, at(0, 0), SILENT_SINK);
    expect(summonNow().summonTurnsLeft).toBe(summonTreant.summons!.duration);
  });
});

describe('the rule itself, driven directly', () => {
  /**
   * Scaled off the *summon's* attack rather than the caster's.
   *
   * The number belongs to the creature: a Druid casts off magic and has an
   * attack of 5, so reading the caster would make the treant's arrival heal
   * scale off a stat that has nothing to do with the tree.
   */
  it('measures the payload in the summon’s own attack', () => {
    setup(
      [caster([]), ally('hurt', at(0, 1), { currentHp: 10 })],
      [foe('foe', at(0, -3))],
    );
    const arrival = makeUnit({
      id: 'arrival',
      summonedBy: 'caster',
      position: at(0, 0),
      stats: makeStats({ attack: 30, maxMana: 0 }),
    });
    useCombatStore.getState().addUnits([arrival]);

    const spec: SummonArrivalSpec = { kind: 'heal', radius: 1, amount: 1.0 };
    applySummonArrival(spec, [arrival], undefined);
    expect(byId('hurt').currentHp).toBe(40);
  });

  it('never touches the arriving creature itself', () => {
    setup([caster([])], [foe('foe', at(0, 1))]);
    const arrival = makeUnit({
      id: 'arrival',
      summonedBy: 'caster',
      position: at(0, 0),
      currentHp: 30,
      stats: makeStats({ maxHp: 45, attack: 20, maxMana: 0 }),
    });
    useCombatStore.getState().addUnits([arrival]);

    applySummonArrival({ kind: 'heal', radius: 2, amount: 1.0 }, [arrival], undefined);
    expect(byId('arrival').currentHp).toBe(30);
  });
});
