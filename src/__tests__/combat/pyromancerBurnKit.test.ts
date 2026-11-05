import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { beginTurn } from '@/systems/combat/turnStart';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { requireUnit } from '@/systems/combat/unitLookup';
import { manaCostFor, manaCostNotes } from '@/systems/combat/manaCost';
import { detonationRounds, firemindDiscount, firemindPerStack, sparkRange } from '@/systems/combat/passiveFormulas';
import { burnStacks } from '@/systems/combat/statusEffects';
import { cinderBurst, ignite, immolation } from '@/data/skills/masterySkills';
import { findMasteryNode } from '@/data/skills/masteryData';
import { BALANCE } from '@/data/balanceConstants';
import {
  AfflictionType, CombatUnit, HeroStats, PassiveId, PassiveRank,
} from '@/models/types';
import { at, makeEffect, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';
import { masteryNodeDescription } from '@/data/display/masteryText';

/**
 * The Pyromancer's Burn decisions, as rules.
 *
 * Firemind (a cheaper Cinder Burst for a deep pile, never a refund), Spark (one
 * stack jumps when its carrier dies) and Detonation (burning ground where a Burn
 * was spent). What is pinned is the shape: the discount is capped and exactly
 * what is paid, the transfer takes one stack and only to an eligible enemy, and
 * the ground is observable, short-lived and owned. Numbers come from the
 * definitions.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 300, attack: 10, magic: 20, defense: 0, magicDefense: 0, maxMana: 100,
    critChance: 0, dodgeChance: 0, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const RANKS: PassiveRank[] = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));

const pyro = (passive?: PassiveId, level = 2, over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'pyro',
    position: at(0, 0),
    stats: stats(),
    skills: [ignite, cinderBurst, immolation],
    passives: passive ? [passive] : [],
    passiveRanks: passive ? { [passive]: RANKS[level - 1] } : {},
    ...over,
  });

const burn = (stacks = 3, over = {}) =>
  makeEffect(AfflictionType.Burn, { magnitude: 2 * stacks, duration: 3, stacks, sourceUnitId: 'pyro', ...over });

const foe = (over: Partial<CombatUnit> = {}) =>
  makeFoe({
    id: 'foe',
    position: at(2, 0),
    stats: stats({ maxHp: 1000 }),
    activeEffects: [burn()],
    ...over,
  });

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  state().reset();
});

// ─── Burn stacks ──────────────────────────────────────────────────────────────

describe('Burn stacks', () => {
  it('counts each application, and a single one is one stack', () => {
    useCombatStore.setState({ units: [pyro(), foe({ activeEffects: [] })] });
    const apply = () =>
      state().applyEffect('foe', {
        type: AfflictionType.Burn, magnitude: 2, duration: 3, sourceUnitId: 'pyro',
      });
    apply();
    expect(burnStacks(unitNow('foe').activeEffects[0])).toBe(1);
    apply();
    apply();
    const merged = unitNow('foe').activeEffects.find((e) => e.type === AfflictionType.Burn)!;
    expect(burnStacks(merged)).toBe(3);
    expect(merged.magnitude).toBe(6);
  });
});

// ─── Firemind ─────────────────────────────────────────────────────────────────

describe('Firemind', () => {
  const caster = (level = 2) => pyro('firemind', level);

  it('charges the listed price for one stack, an unburned target and any other skill', () => {
    expect(manaCostFor(caster(), cinderBurst, foe({ activeEffects: [burn(1)] }))).toBe(cinderBurst.manaCost);
    expect(manaCostFor(caster(), cinderBurst, foe({ activeEffects: [] }))).toBe(cinderBurst.manaCost);
    expect(manaCostFor(caster(), cinderBurst)).toBe(cinderBurst.manaCost);
    expect(manaCostFor(caster(), immolation, foe())).toBe(immolation.manaCost);
    expect(manaCostFor(pyro(), cinderBurst, foe())).toBe(cinderBurst.manaCost);
  });

  it('is cheaper for a deeper pile, and never free', () => {
    const cost = (stacks: number) =>
      manaCostFor(caster(), cinderBurst, foe({ activeEffects: [burn(stacks)] }));
    expect(cost(2)).toBeLessThan(cost(1));
    expect(cost(3)).toBeLessThanOrEqual(cost(2));
    expect(cost(20)).toBeGreaterThan(0);
    expect(cinderBurst.manaCost - cost(20)).toBeLessThanOrEqual(
      Math.floor(cinderBurst.manaCost * BALANCE.FIREMIND_MAX_DISCOUNT_SHARE),
    );
  });

  it('is worth more at each rung', () => {
    const cost = (level: number) =>
      manaCostFor(caster(level), cinderBurst, foe({ activeEffects: [burn(2)] }));
    expect(cost(1)).toBeGreaterThan(cost(2));
    expect(cost(2)).toBeGreaterThan(cost(3));
  });

  /** The preview is the payment: the same function, read before and after a real cast. */
  it('spends exactly what it previews, and returns nothing', () => {
    const me = caster();
    const target = foe({ activeEffects: [burn(3)] });
    useCombatStore.setState({ units: [me, target] });
    const previewed = manaCostFor(me, cinderBurst, target);
    expect(previewed).toBeLessThan(cinderBurst.manaCost);

    const before = unitNow('pyro').currentMana;
    expect(resolveSkillUse(me, cinderBurst, target.position, SILENT_SINK).ok).toBe(true);
    expect(before - unitNow('pyro').currentMana).toBe(previewed);
    // And the stacks really were spent by the strike
    expect(unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Burn)).toBe(false);
  });

  it('without the node, the same cast costs the full price', () => {
    const me = pyro();
    const target = foe({ activeEffects: [burn(3)] });
    useCombatStore.setState({ units: [me, target] });
    resolveSkillUse(me, cinderBurst, target.position, SILENT_SINK);
    expect(100 - unitNow('pyro').currentMana).toBe(cinderBurst.manaCost);
  });

  it('puts the same number on the inspector, per burning enemy', () => {
    const me = caster();
    const deep = foe({ id: 'deep', name: 'Deep', activeEffects: [burn(3)] });
    const lone = foe({ id: 'lone', name: 'Lone', position: at(0, 2), activeEffects: [burn(1)] });
    const notes = manaCostNotes(me, cinderBurst, [me, deep, lone]);
    expect(notes.join('\n')).toContain(`${manaCostFor(me, cinderBurst, deep)} MP`);
    expect(notes.join('\n')).toContain('Deep');
    expect(notes.join('\n')).not.toContain('Lone');
    expect(manaCostNotes(pyro(), cinderBurst, [pyro(), deep])).toEqual([]);
  });

  it('is only a price: the discount function is bounded by the cost', () => {
    const rank = RANKS[2];
    expect(firemindDiscount(rank, 1, cinderBurst.manaCost)).toBe(0);
    expect(firemindDiscount(rank, 2, cinderBurst.manaCost)).toBe(firemindPerStack(rank));
    expect(firemindDiscount(rank, 99, cinderBurst.manaCost)).toBeLessThan(cinderBurst.manaCost);
  });
});

// ─── Spark ────────────────────────────────────────────────────────────────────

describe('Spark', () => {
  /** A doomed Burning enemy beside others; killed through the one damage funnel. */
  const board = (units: CombatUnit[], level = 2) => {
    useCombatStore.setState({ units: [pyro('spark', level), ...units] });
  };
  const dying = (over: Partial<CombatUnit> = {}) =>
    foe({ id: 'dying', position: at(2, 0), currentHp: 1, stats: stats({ maxHp: 50 }), ...over });
  const neighbour = (over: Partial<CombatUnit> = {}) =>
    foe({ id: 'near', position: at(3, 0), activeEffects: [], ...over });
  const burnOn = (id: string) =>
    unitNow(id).activeEffects.find((e) => e.type === AfflictionType.Burn);

  it('passes one stack to a nearby unburned enemy when a Burning enemy dies', () => {
    board([dying(), neighbour()]);
    state().damageUnit('dying', 10, 'pyro');
    expect(unitNow('dying').currentHp).toBe(0);
    const passed = burnOn('near')!;
    expect(passed).toBeDefined();
    expect(burnStacks(passed)).toBe(1);
    expect(passed.sourceUnitId).toBe('pyro');
    // One stack's share, not the whole pile
    expect(passed.magnitude).toBeLessThan(burn(3).magnitude);
    // Spent: the corpse no longer carries it
    expect(burnOn('dying')).toBeUndefined();
  });

  it('does nothing when the dead enemy was not Burning', () => {
    board([dying({ activeEffects: [] }), neighbour()]);
    state().damageUnit('dying', 10, 'pyro');
    expect(burnOn('near')).toBeUndefined();
  });

  it('skips an enemy that is already burning, and goes to the next one', () => {
    const lit = neighbour({ id: 'lit', position: at(3, 0), activeEffects: [burn(1)] });
    const cool = neighbour({ id: 'cool', position: at(2, 1), activeEffects: [] });
    board([dying(), lit, cool]);
    state().damageUnit('dying', 10, 'pyro');
    expect(burnStacks(burnOn('lit')!)).toBe(1);
    expect(burnOn('lit')!.magnitude).toBe(burn(1).magnitude);
    expect(burnOn('cool')).toBeDefined();
  });

  it('only reaches as far as the rung allows', () => {
    const far = neighbour({ id: 'far', position: at(2 + sparkRange(RANKS[1]), 0) });
    board([dying(), far], 1);
    state().damageUnit('dying', 10, 'pyro');
    expect(sparkRange(RANKS[1])).toBeGreaterThan(sparkRange(RANKS[0]));
    expect(burnOn('far')).toBeUndefined();

    state().reset();
    board([dying(), far], 2);
    state().damageUnit('dying', 10, 'pyro');
    expect(burnOn('far')).toBeDefined();
  });

  it('never lights an objective, or anyone on the Pyromancer\'s own side', () => {
    const standard = neighbour({
      id: 'standard', position: at(3, 0),
      objective: { kind: 'standard', ownerId: 'dying' },
    });
    const friend = makeUnit({ id: 'friend', position: at(2, 1), stats: stats(), activeEffects: [] });
    board([dying(), standard, friend]);
    state().damageUnit('dying', 10, 'pyro');
    expect(burnOn('standard')).toBeUndefined();
    expect(burnOn('friend')).toBeUndefined();
  });

  it('does nothing for a Pyromancer without the node, or one who has fallen', () => {
    useCombatStore.setState({ units: [pyro(), dying(), neighbour()] });
    state().damageUnit('dying', 10, 'pyro');
    expect(burnOn('near')).toBeUndefined();

    state().reset();
    useCombatStore.setState({
      units: [pyro('spark', 2, { currentHp: 0 }), dying(), neighbour()],
    });
    state().damageUnit('dying', 10, 'pyro');
    expect(burnOn('near')).toBeUndefined();
  });

  it('also fires when the Burning enemy dies to its own fire', () => {
    board([dying({ activeEffects: [burn(2, { magnitude: 20 })] }), neighbour()]);
    state().tickEffectsOnUnit('dying');
    expect(unitNow('dying').currentHp).toBe(0);
    expect(burnOn('near')).toBeDefined();
  });

  it('carries more at each rung', () => {
    const carried = (level: number) => {
      state().reset();
      board([dying(), neighbour()], level);
      state().damageUnit('dying', 10, 'pyro');
      return burnOn('near')!.magnitude;
    };
    expect(carried(3)).toBeGreaterThan(carried(1));
  });
});

// ─── Detonation ───────────────────────────────────────────────────────────────

describe('Detonation', () => {
  const groundOf = () => state().hazards.filter((h) => h.ignites);
  const cast = (level = 2, target: Partial<CombatUnit> = {}) => {
    const me = pyro('detonation', level);
    const victim = foe(target);
    useCombatStore.setState({ units: [me, victim] });
    resolveSkillUse(me, cinderBurst, victim.position, SILENT_SINK);
    return victim;
  };

  it('leaves marked, owned, non-solid burning ground where the Burn was spent', () => {
    const victim = cast();
    const [ground] = groundOf();
    expect(groundOf()).toHaveLength(1);
    expect(ground.hexes).toEqual([victim.position]);
    expect(ground.passiveId).toBe('detonation');
    expect(ground.ownerId).toBe('pyro');
    expect(ground.solid).toBe(false);
    expect(ground.turnsLeft).toBeGreaterThan(0);
    expect(ground.ignites!.magnitude).toBeGreaterThan(0);
  });

  it('leaves nothing when there was no Burn to spend, or without the node', () => {
    cast(2, { activeEffects: [] });
    expect(groundOf()).toHaveLength(0);

    state().reset();
    const me = pyro();
    const victim = foe();
    useCombatStore.setState({ units: [me, victim] });
    resolveSkillUse(me, cinderBurst, victim.position, SILENT_SINK);
    expect(groundOf()).toHaveLength(0);
  });

  it('lights each hex a ring detonation spends a Burn on, and no other', () => {
    const me = pyro('detonation');
    const a = foe({ id: 'a', position: at(2, 0) });
    const b = foe({ id: 'b', position: at(2, 1) });
    const clean = foe({ id: 'clean', position: at(1, 2), activeEffects: [] });
    useCombatStore.setState({ units: [me, a, b, clean] });
    resolveSkillUse(me, immolation, a.position, SILENT_SINK);
    const hexes = groundOf().flatMap((g) => g.hexes).map((h) => `${h.q},${h.r}`).sort();
    expect(hexes).toEqual(['2,0', '2,1']);
  });

  it('refreshes rather than doubling when the same hex is detonated again', () => {
    cast();
    const first = groundOf()[0].turnsLeft;
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === 'foe' ? { ...u, activeEffects: [burn(2)] } : u)),
    }));
    resolveSkillUse(unitNow('pyro'), cinderBurst, at(2, 0), SILENT_SINK);
    expect(groundOf()).toHaveLength(1);
    expect(groundOf()[0].turnsLeft).toBe(first);
  });

  it('ignites an enemy that begins its turn there, and nobody else', () => {
    cast(2, { stats: stats({ maxHp: 1000 }) });
    const ally = makeUnit({ id: 'ally', position: at(2, 0), stats: stats() });
    const bystander = foe({ id: 'bystander', position: at(-2, 0), activeEffects: [] });
    useCombatStore.setState((s) => ({ units: [...s.units, ally, bystander] }));

    expect(unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Burn)).toBe(false);
    const events = state().tickHazards('foe');
    const lit = unitNow('foe').activeEffects.find((e) => e.type === AfflictionType.Burn)!;
    expect(lit).toBeDefined();
    expect(burnStacks(lit)).toBe(1);
    expect(lit.sourceUnitId).toBe('pyro');
    expect(events.map((e) => e.unitId)).toEqual(['foe']);

    // The Pyromancer's own side is never burned by its own ground
    state().tickHazards('ally');
    expect(unitNow('ally').activeEffects).toHaveLength(0);
    // Off the hex, nothing
    state().tickHazards('bystander');
    expect(unitNow('bystander').activeEffects).toHaveLength(0);
  });

  it('lights an enemy through the real turn start', () => {
    cast();
    useCombatStore.setState({ currentUnitId: 'foe', turnOrder: ['pyro', 'foe'] });
    beginTurn('foe', SILENT_SINK);
    expect(unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Burn)).toBe(true);
  });

  it('never lights an objective standing on it', () => {
    cast();
    const standard = foe({
      id: 'standard', position: at(2, 0), activeEffects: [],
      objective: { kind: 'standard', ownerId: 'foe' },
    });
    useCombatStore.setState((s) => ({ units: [...s.units.filter((u) => u.id !== 'foe'), standard] }));
    state().tickHazards('standard');
    expect(unitNow('standard').activeEffects).toHaveLength(0);
  });

  it('burns out after its rounds, counted on the owner\'s turns', () => {
    cast();
    const rounds = detonationRounds(RANKS[1]);
    for (let i = 0; i < rounds - 1; i++) {
      state().tickHazards('pyro');
      expect(groundOf()).toHaveLength(1);
    }
    state().tickHazards('pyro');
    expect(groundOf()).toHaveLength(0);
  });

  it('lasts longer at each rung', () => {
    expect(detonationRounds(RANKS[1])).toBeGreaterThan(detonationRounds(RANKS[0]));
    expect(detonationRounds(RANKS[2])).toBeGreaterThan(detonationRounds(RANKS[1]));
    cast(3);
    expect(groundOf()[0].turnsLeft).toBe(detonationRounds(RANKS[2]));
  });

  it('goes out with its owner', () => {
    cast();
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === 'pyro' ? { ...u, currentHp: 0 } : u)),
    }));
    state().tickHazards('foe');
    expect(groundOf()).toHaveLength(0);
  });
});

// ─── The nodes ────────────────────────────────────────────────────────────────

describe('the nodes say what they do', () => {
  it('replaces the flat stats with the rule, keeping Inner Flame and Deep Furnace', () => {
    for (const [id, passive] of [
      ['pyro_firemind', 'firemind'], ['pyro_spark', 'spark'], ['pyro_detonation', 'detonation'],
    ] as const) {
      const { node } = findMasteryNode(id)!;
      expect(node.grantsPassive).toBe(passive);
      expect(node.statBonus).toBeUndefined();
    }
    expect(findMasteryNode('pyro_inner_flame')!.node.statBonus).toBeDefined();
    expect(findMasteryNode('pyro_deep_furnace')!.node.statBonus?.maxMana).toBeGreaterThan(0);
    expect(masteryNodeDescription(findMasteryNode('pyro_firemind')!.node)).toMatch(/Cinder Burst.*mana/);
    expect(masteryNodeDescription(findMasteryNode('pyro_spark')!.node)).toMatch(/jumps/);
    expect(masteryNodeDescription(findMasteryNode('pyro_detonation')!.node)).toMatch(/keeps burning/);
  });
});
