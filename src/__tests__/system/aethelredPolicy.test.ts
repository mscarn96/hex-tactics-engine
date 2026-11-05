import { AETHELRED_PHASES, chainsOfTribute, crownfall, imperialCleave } from '@/data/templates/aethelred';
import { AuraType, CombatUnit, HexCoord, SkillTargetType } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { castScriptedMove } from '@/systems/combat/bossActions';
import { foreclosure } from '@/data/templates/aethelred';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { partyPolicy } from '@/systems/sim/balance/partyPolicy';
import { createObjective } from '@/systems/combat/objectives';
import { STANDARD_KIND } from '@/systems/combat/bossScript';
import { requireUnit } from '@/systems/combat/unitLookup';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * The simulator's party plays Aethelred's new answers (`partyPolicy.aethelredAnswers`): the block, the
 * toll and the held ground. What is pinned is the choice each board calls for, not a fight's numbers.
 */

const store = () => useCombatStore.getState();
const unitOf = (id: string) => requireUnit(store().units, id);

const ward = makeSkill({
  id: 'shield_wall', targetType: SkillTargetType.Single, range: 5, manaCost: 0,
  appliesEffect: { type: AuraType.Barrier, magnitude: 40, duration: 3 },
});
const staffBlow = makeSkill({ id: BASIC_ATTACK_ID, targetType: SkillTargetType.Single, range: 6, damage: 1 });
const bigSpell = makeSkill({ id: 'arcane_burst', targetType: SkillTargetType.Single, range: 6, damage: 4, scaling: 'magic', manaCost: 0 });

const hero = (id: string, position: HexCoord, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({
    id, name: id, heroId: id, position, skills: [staffBlow],
    stats: makeStats({ maxHp: 300, attack: 20, magic: 20, speed: 8, maxMana: 40 }), ...over,
  });

function arena(heroes: CombatUnit[], phase = 0) {
  store().reset();
  store().initCombat(heroes, [
    makeUnit({
      id: 'boss', name: 'Aethelred', isPlayer: false, templateId: 'aethelred', position: at(0, -1),
      stats: makeStats({ maxHp: 1000, attack: 30, magic: 30, defense: 10, speed: 5, maxMana: 0 }),
      skills: AETHELRED_PHASES[phase].skills, bossPhase: phase,
    }),
  ]);
  if (phase > 0) store().patchBossScript('boss', { phaseTurns: 1 });
}

const why = () => {
  const branches: string[] = [];
  return { branches, note: (b: string) => branches.push(b) };
};

describe('the block', () => {
  const raiseCleave = () =>
    executeAIActions(unitOf('boss'), [{ type: 'skill', skill: imperialCleave, skillTarget: at(0, 2) }]);

  it('puts a Barrier on a hero in the wedge before the landing', () => {
    arena([hero('a', at(0, 1)), hero('b', at(0, 2)), hero('priest', at(-3, 4), { skills: [ward, staffBlow] })]);
    raiseCleave();
    const seen = why();
    const actions = partyPolicy(unitOf('priest'), store().units, seen.note);
    expect(actions?.[0]).toMatchObject({ type: 'skill', skill: { id: 'shield_wall' } });
    expect(seen.branches.join()).toContain('blocks the blade');
    // aimed at a hero standing in the wedge, not at the priest or an empty hex
    const aim = (actions![0] as { skillTarget: HexCoord }).skillTarget;
    expect([unitOf('a').position, unitOf('b').position]).toContainEqual(aim);
  });

  it('lets the rest of the wedge strike instead of stepping out once one body holds it', () => {
    arena([hero('a', at(0, 1)), hero('b', at(0, 2))]);
    raiseCleave();
    store().applyEffect('a', { type: AuraType.Barrier, magnitude: 40, duration: 3, sourceUnitId: 'a' });
    const seen = why();
    const actions = partyPolicy(unitOf('b'), store().units, seen.note);
    expect(actions?.some((x) => x.type === 'skill')).toBe(true);
    expect(actions?.some((x) => x.type === 'move')).toBe(false);
    expect(seen.branches.join()).toContain('blocks the blade');
  });

  it('steps out as before when nobody can give the Barrier', () => {
    arena([hero('a', at(0, 1)), hero('b', at(0, 2))]);
    raiseCleave();
    const actions = partyPolicy(unitOf('b'), store().units);
    expect(actions?.[0].type).toBe('move');
  });
});

describe('the toll', () => {
  const sealed = (heroes: CombatUnit[]) => {
    arena(heroes, 1);
    castScriptedMove(unitOf('boss'), foreclosure, { log: () => {} });
  };

  it('strikes him from the seal with a basic attack, which pays it', () => {
    sealed([hero('a', at(0, 2)), hero('b', at(2, 1))]);
    const seen = why();
    const actions = partyPolicy(unitOf('a'), store().units, seen.note);
    expect(actions?.[0]).toMatchObject({ type: 'skill', skill: { id: BASIC_ATTACK_ID }, skillTarget: unitOf('boss').position });
    expect(seen.branches.join()).toContain('pays the seal');
  });

  it('casts a far stronger skill from the seal while healthy, and strikes when it is not worth the blood', () => {
    sealed([hero('a', at(0, 2), { skills: [staffBlow, bigSpell] }), hero('b', at(2, 1))]);
    const strong = partyPolicy(unitOf('a'), store().units);
    expect(strong?.[0]).toMatchObject({ type: 'skill', skill: { id: 'arcane_burst' } });

    sealed([hero('a', at(0, 2), { skills: [staffBlow, bigSpell], currentHp: 100 }), hero('b', at(2, 1))]);
    const worn = partyPolicy(unitOf('a'), store().units);
    expect(worn?.[0]).toMatchObject({ type: 'skill', skill: { id: BASIC_ATTACK_ID } });
  });

  it('steps off a seal it cannot answer, and the plain step is the old answer', () => {
    sealed([hero('a', at(0, 2), { skills: [] }), hero('b', at(2, 1))]);
    const actions = partyPolicy(unitOf('a'), store().units);
    expect(actions?.[0].type).toBe('move');
  });

  it('does not pay a seal twice', () => {
    sealed([hero('a', at(0, 2)), hero('b', at(2, 1))]);
    const attack = store().preparedAttacks[0];
    store().updatePreparedAttack(attack.id, { tolls: [{ unitId: 'a', how: 'strike' }] });
    const seen = why();
    partyPolicy(unitOf('a'), store().units, seen.note);
    expect(seen.branches.join()).not.toContain('pays the seal');
  });
});

describe('the feel pass: the chain after the throw, the crown point and the warning a throw lands in', () => {
  const purge = makeSkill({ id: 'divine_light', targetType: SkillTargetType.Single, range: 9, manaCost: 0, cleanse: true });
  const land = (id: string) => partyPolicy(unitOf(id), store().units);

  it('cleanses a chain when one end is in reach, and regroups when nobody can', () => {
    arena([hero('a', at(0, 5)), hero('b', at(-3, 0)), hero('priest', at(1, 1), { skills: [purge, staffBlow] })], 1);
    castScriptedMove(unitOf('boss'), chainsOfTribute, { log: () => {} });
    const seen = why();
    const actions = partyPolicy(unitOf('priest'), store().units, seen.note);
    expect(actions?.[0]).toMatchObject({ type: 'skill', skill: { id: 'divine_light' } });
    expect(seen.branches.join()).toContain('cleanses the chain');
    const walk = land('a');
    expect(walk?.[0].type).toBe('move');
  });

  it('puts a Barrier on the hero who will hold a crown point, who stays for it', () => {
    const tough = { stats: makeStats({ maxHp: 3000, attack: 20, magic: 20, speed: 8, maxMana: 40 }) };
    arena([hero('a', at(2, 2), tough), hero('b', at(-2, 3)), hero('priest', at(0, 1), { skills: [ward, staffBlow] })], 2);
    castScriptedMove(unitOf('boss'), crownfall, { log: () => {} });
    const seen = why();
    const actions = partyPolicy(unitOf('priest'), store().units, seen.note);
    expect(actions?.[0]).toMatchObject({ type: 'skill', skill: { id: 'shield_wall' }, skillTarget: at(2, 2) });
    expect(seen.branches.join()).toContain('shields the crown point');
    executeAIActions(unitOf('priest'), actions!);
    const stay = why();
    partyPolicy(unitOf('a'), store().units, stay.note);
    expect(stay.branches.join()).toContain('holds the outer ground');
  });

  it('steps out of a warning a throw has landed it in', () => {
    arena([hero('a', at(0, 1), { currentHp: 100 }), hero('b', at(2, 1))], 2);
    castScriptedMove(unitOf('boss'), crownfall, { log: () => {} });
    store().moveUnit('a', at(0, 5), 'jump', false);
    const seen = why();
    partyPolicy(unitOf('a'), store().units, seen.note);
    expect(seen.branches.join()).toContain('steps out of a warning');
  });
});

describe('the castle tiers', () => {
  const blow = makeSkill({ id: BASIC_ATTACK_ID, targetType: SkillTargetType.Single, range: 6, damage: 1 });
  /** Two Standards in reach, the second a sliver weaker, and nothing else in reach but them. */
  const banners = (tier: number) => {
    store().reset();
    const owner = makeUnit({
      id: 'boss', name: 'Aethelred', isPlayer: false, templateId: 'aethelred', position: at(0, -6), challengeTier: tier,
      stats: makeStats({ maxHp: 1000, attack: 30, magic: 30, defense: 10, speed: 5, maxMana: 0 }),
      skills: AETHELRED_PHASES[0].skills, bossPhase: 0,
    });
    const banner = (position: HexCoord, currentHp: number) => ({ ...createObjective({ kind: STANDARD_KIND, owner, position, hp: 100 }), currentHp });
    store().initCombat([hero('a', at(0, 2), { skills: [blow] })], [owner]);
    store().addUnits([banner(at(0, 1), 100), banner(at(1, 1), 99)]);
  };
  const struck = () => partyPolicy(unitOf('a'), store().units)?.find((a) => a.type === 'skill')?.skillTarget;

  it('puts its blows on the weakest Standard once a fall would mend the rest', () => {
    banners(2);
    expect(struck()).toEqual(at(1, 1));
  });

  it('plays the plain brain\'s choice below that tier', () => {
    banners(1);
    const plain = decideEnemyAction(unitOf('a'), store().units).find((a) => a.type === 'skill')?.skillTarget;
    expect(struck()).toEqual(plain);
    expect(plain).toEqual(at(0, 1));
  });
});

describe('the plain footprint answer is still there', () => {
  it('a hero off every warning plays on as before', () => {
    arena([hero('a', at(0, 2))]);
    const seen = why();
    partyPolicy(unitOf('a'), store().units, seen.note);
    expect(seen.branches.join()).not.toMatch(/blocks the blade|pays the seal|holds the outer ground/);
  });
});
