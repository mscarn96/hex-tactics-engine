import { nodeDescription } from '@/__tests__/support/masteryNodeText';
import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { resolveAttack, critChanceAgainst, expectedDamage } from '@/systems/combat/damageCalc';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { requireUnit } from '@/systems/combat/unitLookup';
import { PASSIVE_DEFS } from '@/systems/combat/passives';
import { killingEyeCrit, savageEdgeTick } from '@/systems/combat/passiveFormulas';
import { bloodthirst, rend, whirlwind } from '@/data/skills/masterySkills';
import { findMasteryNode } from '@/data/skills/masteryData';
import {
  AfflictionType, AuraType, CombatUnit, HeroSkill, HeroStats, PassiveId, PassiveRank,
} from '@/models/types';
import { at, makeEffect, makeFoe, makeSkill, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';
import { masteryNodeDescription } from '@/data/display/masteryText';

/**
 * The Berserker's Bleed payoffs, as rules.
 *
 * Savage Edge: a critical hit on a Bleeding enemy ticks the Bleed at once, at
 * most once per enemy per turn, and recovers nothing for anyone. Killing Eye:
 * critical chance against Bleeding enemies only, never as a stat. Numbers are
 * read from the passive definitions; what is pinned is the shape.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 300, attack: 20, defense: 0, maxMana: 100, critChance: 100, critDamage: 150,
    dodgeChance: 0, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const RANKS: PassiveRank[] = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));

const bleeding = (magnitude = 8, duration = 3) =>
  makeEffect(AfflictionType.Bleed, { magnitude, duration });

const berserker = (passive?: PassiveId, level = 2, over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'zerk',
    position: at(0, 0),
    stats: stats(),
    skills: [bloodthirst, rend, whirlwind],
    passives: passive ? [passive] : [],
    passiveRanks: passive ? { [passive]: RANKS[level - 1] } : {},
    ...over,
  });

const foe = (over: Partial<CombatUnit> = {}) =>
  makeFoe({
    id: 'foe',
    position: at(1, 0),
    stats: stats({ maxHp: 1000, critChance: 0 }),
    activeEffects: [bleeding()],
    ...over,
  });

/** A plain strike with no drain and no rider, so any recovery seen is the passive's. */
const swing: HeroSkill = makeSkill({ damage: 1 });

beforeEach(() => {
  resetFixtureIds();
  state().reset();
});

/** HP a single cast takes off the foe, with or without the passive. */
function hpLostBy(
  passive: PassiveId | undefined,
  skill: HeroSkill,
  setup: { me?: Partial<CombatUnit>; target?: Partial<CombatUnit> } = {},
): number {
  state().reset();
  const me = berserker(passive, 2, setup.me);
  const target = foe(setup.target);
  useCombatStore.setState({ units: [me, target] });
  resolveSkillUse(me, skill, target.position, SILENT_SINK);
  return target.currentHp - unitNow('foe').currentHp;
}

describe('Savage Edge', () => {
  it('ticks the Bleed at once on a critical hit against a Bleeding enemy', () => {
    const without = hpLostBy(undefined, swing);
    const withEdge = hpLostBy('savageEdge', swing);
    expect(withEdge - without).toBe(savageEdgeTick(bleeding(), RANKS[1]));
    expect(withEdge).toBeGreaterThan(without);
  });

  it('does nothing without a critical hit', () => {
    const noCrit = { me: { stats: stats({ critChance: 0 }) } };
    expect(hpLostBy('savageEdge', swing, noCrit)).toBe(hpLostBy(undefined, swing, noCrit));
  });

  it('does nothing against an enemy that is not Bleeding', () => {
    const clean = { target: { activeEffects: [] } };
    expect(hpLostBy('savageEdge', swing, clean)).toBe(hpLostBy(undefined, swing, clean));
  });

  it('does not count the Bleed the same cast lays (Rend needs a wound already open)', () => {
    const clean = { target: { activeEffects: [] } };
    expect(hpLostBy('savageEdge', rend, clean)).toBe(hpLostBy(undefined, rend, clean));
  });

  it('leaves the Bleed itself running as it was', () => {
    const me = berserker('savageEdge');
    const target = foe();
    useCombatStore.setState({ units: [me, target] });
    resolveSkillUse(me, swing, target.position, SILENT_SINK);
    const bleed = unitNow('foe').activeEffects.find((e) => e.type === AfflictionType.Bleed)!;
    expect(bleed.duration).toBe(3);
    expect(bleed.magnitude).toBe(8);
  });

  /**
   * The once-per-target rule, against a sequence that would break it: Carnage
   * lands Bloodthirst twice and both strikes crit, yet only one tick is added.
   */
  it('ticks once per enemy across a multi-hit critical sequence', () => {
    const carnage = {
      me: { activeEffects: [makeEffect(AuraType.Carnage, { duration: 4 })] },
    };
    const gap = hpLostBy('savageEdge', bloodthirst, carnage) - hpLostBy(undefined, bloodthirst, carnage);
    expect(gap).toBe(savageEdgeTick(bleeding(), RANKS[1]));
  });

  it('ticks each Bleeding enemy of an area strike once', () => {
    const lostBy = (passive?: PassiveId) => {
      state().reset();
      const me = berserker(passive);
      const a = foe({ id: 'a', position: at(1, 0) });
      const b = foe({ id: 'b', position: at(0, 1) });
      useCombatStore.setState({ units: [me, a, b] });
      resolveSkillUse(me, whirlwind, me.position, SILENT_SINK);
      return { a: a.currentHp - unitNow('a').currentHp, b: b.currentHp - unitNow('b').currentHp };
    };
    const tick = savageEdgeTick(bleeding(), RANKS[1]);
    const plain = lostBy();
    const edged = lostBy('savageEdge');
    expect(edged.a - plain.a).toBe(tick);
    expect(edged.b - plain.b).toBe(tick);
  });

  it('may tick the same enemy again on the next turn, but not twice in one', () => {
    const me = berserker('savageEdge');
    const target = foe();
    useCombatStore.setState({ units: [me, target], turnSerial: 1 });
    const hp = () => unitNow('foe').currentHp;
    const tick = savageEdgeTick(bleeding(), RANKS[1]);

    const h0 = hp();
    resolveSkillUse(me, swing, target.position, SILENT_SINK);
    const first = h0 - hp();
    const h1 = hp();
    resolveSkillUse(unitNow('zerk'), swing, target.position, SILENT_SINK);
    const second = h1 - hp();
    // Same strike, so the second swing in the same turn is exactly one tick lighter
    expect(first - second).toBe(tick);

    useCombatStore.setState({ turnSerial: 2 });
    const h2 = hp();
    resolveSkillUse(unitNow('zerk'), swing, target.position, SILENT_SINK);
    expect(h2 - hp()).toBe(first);
  });

  /** No new resource route: the tick restores nothing to the Berserker or to anyone. */
  it('gives the Berserker no HP and no mana', () => {
    const run = (passive?: PassiveId) => {
      state().reset();
      const me = berserker(passive, 2, { currentHp: 100, currentMana: 40 });
      const ally = makeUnit({ id: 'ally', position: at(0, 1), stats: stats(), currentHp: 50 });
      const target = foe();
      useCombatStore.setState({ units: [me, ally, target] });
      resolveSkillUse(me, swing, target.position, SILENT_SINK);
      return {
        hp: unitNow('zerk').currentHp,
        mana: unitNow('zerk').currentMana,
        ally: unitNow('ally').currentHp,
      };
    };
    expect(run('savageEdge')).toEqual(run());
    expect(PASSIVE_DEFS.savageEdge.resolve!({
      self: berserker('savageEdge'), allUnits: [berserker('savageEdge'), foe()], other: foe(), crit: true,
    }, RANKS[1]).every((o) => o.kind === 'damage' || o.kind === 'spend')).toBe(true);
  });

  it('does not tick a corpse', () => {
    const me = berserker('savageEdge');
    const target = foe({ stats: stats({ maxHp: 5, critChance: 0 }), currentHp: 5 });
    useCombatStore.setState({ units: [me, target] });
    resolveSkillUse(me, swing, target.position, SILENT_SINK);
    expect(unitNow('foe').currentHp).toBe(0);
    expect(state().spentThisTurn.keys).toEqual([]);
  });

  it('ticks harder at each rung', () => {
    const tick = (rank: number) => savageEdgeTick(bleeding(), RANKS[rank - 1]);
    expect(tick(2)).toBeGreaterThan(tick(1));
    expect(tick(3)).toBeGreaterThan(tick(2));
    const lost = (level: number) => {
      state().reset();
      const me = berserker('savageEdge', level);
      const target = foe();
      useCombatStore.setState({ units: [me, target] });
      resolveSkillUse(me, swing, target.position, SILENT_SINK);
      return target.currentHp - unitNow('foe').currentHp;
    };
    expect(lost(3)).toBeGreaterThan(lost(1));
  });
});

describe('Killing Eye', () => {
  const eye = (level = 2) => berserker('killingEye', level, { stats: stats({ critChance: 10 }) });

  it('adds critical chance against a Bleeding enemy only', () => {
    const bleedingFoe = foe();
    const cleanFoe = foe({ activeEffects: [] });
    expect(critChanceAgainst(eye(), cleanFoe)).toBe(10);
    expect(critChanceAgainst(eye(), bleedingFoe)).toBe(10 + killingEyeCrit(RANKS[1]));
  });

  it('is not a stat: the hero sheet number does not move', () => {
    expect(getCombatEffectiveStats(eye()).critChance).toBe(getCombatEffectiveStats(berserker(undefined, 2, { stats: stats({ critChance: 10 }) })).critChance);
    expect(PASSIVE_DEFS.killingEye.statMod).toBeUndefined();
  });

  it('is what the rolls use: a roll between the two chances crits only a Bleeding enemy', () => {
    const roll = () => (10 + killingEyeCrit(RANKS[1]) - 1) / 100;
    expect(resolveAttack(eye(), foe(), swing, { rng: roll }).crit).toBe(true);
    expect(resolveAttack(eye(), foe({ activeEffects: [] }), swing, { rng: roll }).crit).toBe(false);
  });

  it('shows up in the expectation the AI scores with', () => {
    const base = berserker(undefined, 2, { stats: stats({ critChance: 10 }) });
    const target = foe();
    expect(expectedDamage(eye(), target, swing)).toBeGreaterThan(expectedDamage(base, target, swing));
    const clean = foe({ activeEffects: [] });
    expect(expectedDamage(eye(), clean, swing)).toBeCloseTo(expectedDamage(base, clean, swing));
  });

  it('grows with the rung', () => {
    expect(critChanceAgainst(eye(3), foe())).toBeGreaterThan(critChanceAgainst(eye(1), foe()));
  });
});

describe('the nodes say what they do', () => {
  it('describes both as conditional, with no flat critical stat left on them', () => {
    for (const id of ['berserker_savage_edge', 'berserker_killing_eye']) {
      const { node } = findMasteryNode(id)!;
      expect(node.statBonus).toBeUndefined();
      expect(node.grantsPassive).toBeDefined();
    }
    const edge = findMasteryNode('berserker_savage_edge')!.node;
    const killing = findMasteryNode('berserker_killing_eye')!.node;
    expect(masteryNodeDescription(edge).toLowerCase()).toContain('bleed');
    expect(masteryNodeDescription(killing).toLowerCase()).toContain('bleeding');
    expect(PASSIVE_DEFS.killingEye.figures!(RANKS[1]).join(' ')).toContain('Bleeding');
  });

  it('keeps Reckless and Offhand Fury as their stat anchors', () => {
    expect(findMasteryNode('berserker_reckless')!.node.statBonus).toBeDefined();
    expect(findMasteryNode('berserker_offhand_fury')!.node.statBonus?.critChance).toBeGreaterThan(0);
  });
});
