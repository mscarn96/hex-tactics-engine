import { nodeDescription } from '@/__tests__/support/masteryNodeText';
import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { beginTurn } from '@/systems/combat/turnStart';
import {
  graspingEarth, stoneWard, tremor, upheaval,
} from '@/data/skills/mastery/druid';
import { describeSkill, skillEffectLines } from '@/data/display/skillDisplay';
import { findMasteryNode } from '@/data/skills/masteryData';
import { PASSIVE_DEFS } from '@/systems/combat/passives';
import { seismicSenseMove, unyieldingDefense } from '@/systems/combat/passiveFormulas';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { requireUnit } from '@/systems/combat/unitLookup';
import { magicDefenseOf } from '@/systems/combat/damageType';
import {
  AfflictionType, AuraType, CombatUnit, HeroSkill, HeroStats, PassiveId, SkillTargetType,
} from '@/models/types';
import { at, makeEffect, makeFoe, makeSkill, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';
import { masteryNodeDescription } from '@/data/display/masteryText';

/**
 * The Stoneshaper's cleanse and its ground-response nodes (Crumble, which
 * replaced Stonecutter, is pinned in `stoneshaperRemaster.test.ts`).
 *
 * Pinned as rules: the cleanse's tradeoff, that Unyielding follows the
 * Barrier in both directions, that Seismic Sense reads a warning from the other
 * side that names this hex, and that every rung of each node differs.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 300, defense: 10, magic: 20, attack: 20, maxMana: 100, moveRange: 2,
    critChance: 0, dodgeChance: 0, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const effective = (id: string) => getCombatEffectiveStats(unitNow(id));

const RANKS = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));

const shaper = (passive?: PassiveId, level = 2, over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'shaper',
    position: at(0, 0),
    stats: stats(),
    skills: [stoneWard, tremor, upheaval, graspingEarth],
    passives: passive ? [passive] : [],
    passiveRanks: passive ? { [passive]: RANKS[level - 1] } : {},
    ...over,
  });

const rootedFoe = (over: Partial<CombatUnit> = {}) =>
  makeFoe({
    id: 'foe',
    position: at(1, 0),
    stats: stats({ maxHp: 1000, defense: 10 }),
    activeEffects: [makeEffect(AfflictionType.Root, { duration: 3 })],
    ...over,
  });

beforeEach(() => {
  resetFixtureIds();
  state().reset();
});

// ─── The cleanse ──────────────────────────────────────────────────────────────

describe('Stone Ward carries the Stoneshaper cleanse', () => {
  const ally = (over: Partial<CombatUnit> = {}) =>
    makeUnit({
      id: 'ally',
      position: at(1, 0),
      stats: stats(),
      activeEffects: [makeEffect(AfflictionType.Poison, { magnitude: 5 }), makeEffect(AfflictionType.Root)],
      ...over,
    });

  it('shields and cleanses the ally it is aimed at, and nobody else', () => {
    const me = shaper();
    const target = ally();
    const bystander = ally({ id: 'bystander', position: at(0, 1) });
    useCombatStore.setState({ units: [me, target, bystander] });

    expect(resolveSkillUse(me, stoneWard, target.position, SILENT_SINK).ok).toBe(true);

    const after = unitNow('ally').activeEffects;
    expect(after.some((e) => e.type === AfflictionType.Poison || e.type === AfflictionType.Root)).toBe(false);
    expect(after.some((e) => e.type === AuraType.Barrier)).toBe(true);
    expect(unitNow('bystander').activeEffects.length).toBe(2);
  });

  it('can cleanse the Stoneshaper itself', () => {
    const me = shaper(undefined, 2, { activeEffects: [makeEffect(AfflictionType.Burn, { magnitude: 3 })] });
    useCombatStore.setState({ units: [me] });
    resolveSkillUse(me, stoneWard, me.position, SILENT_SINK);
    expect(unitNow('shaper').activeEffects.some((e) => e.type === AfflictionType.Burn)).toBe(false);
  });

  /**
   * The tradeoff, pinned as a class: against the cleanse-less ward it replaced
   * (0.9 of Magic, 12 mana, a cooldown of 2) it must cost more mana, wait longer
   * and shield for less, and refund nothing.
   */
  it('is paid for in shield size, mana and cooldown, and refunds nothing', () => {
    expect(stoneWard.cleanse).toBe(true);
    expect((stoneWard.appliesEffect as { magnitude: number }).magnitude).toBeLessThan(0.9);
    expect(stoneWard.manaCost).toBeGreaterThan(12);
    expect(stoneWard.cooldown).toBeGreaterThan(2);
    expect(stoneWard.healing).toBeUndefined();
    expect(stoneWard.lifesteal).toBeUndefined();
  });

  it('puts the cooldown and the mana cost on the board after a cast', () => {
    const me = shaper();
    useCombatStore.setState({ units: [me] });
    resolveSkillUse(me, stoneWard, me.position, SILENT_SINK);
    expect(unitNow('shaper').cooldowns?.stone_ward).toBeGreaterThanOrEqual(stoneWard.cooldown!);
    expect(unitNow('shaper').currentMana).toBe(100 - stoneWard.manaCost);
  });

  it('shows the shield that lands, and says it cleanses', () => {
    const me = shaper();
    useCombatStore.setState({ units: [me] });
    const lines = skillEffectLines(stoneWard, me).join('\n');
    resolveSkillUse(me, stoneWard, me.position, SILENT_SINK);
    const barrier = unitNow('shaper').activeEffects.find((e) => e.type === AuraType.Barrier)!;
    expect(lines).toContain(`${barrier.magnitude}`);
    expect(lines).toMatch(/Removes all afflictions/);
    expect(describeSkill(stoneWard)).toMatch(/cleanse/i);
    expect(masteryNodeDescription(findMasteryNode('stone_ward')!.node)).toMatch(/affliction/);
  });
});

// ─── Unyielding ───────────────────────────────────────────────────────────────

describe('Unyielding hardens both defences while a Barrier stands', () => {
  const barrier = (magnitude = 40) => makeEffect(AuraType.Barrier, { magnitude, duration: 3 });

  it('adds Physical and Magic Defense with a Barrier, and nothing without one', () => {
    const me = shaper('unyielding');
    useCombatStore.setState({ units: [me] });
    const bare = effective('shaper');

    useCombatStore.setState({ units: [shaper('unyielding', 2, { activeEffects: [barrier()] })] });
    const warded = effective('shaper');

    expect(warded.defense - bare.defense).toBe(unyieldingDefense(RANKS[1]));
    expect(magicDefenseOf(warded) - magicDefenseOf(bare)).toBe(unyieldingDefense(RANKS[1]));
  });

  it('counts a Barrier somebody else put on the Stoneshaper', () => {
    const friend = makeUnit({ id: 'friend', position: at(1, 0), stats: stats(), skills: [stoneWard] });
    const me = shaper('unyielding');
    useCombatStore.setState({ units: [me, friend] });
    const bare = effective('shaper').defense;
    resolveSkillUse(friend, stoneWard, me.position, SILENT_SINK);
    expect(effective('shaper').defense).toBeGreaterThan(bare);
  });

  it('is gone once the Barrier is spent', () => {
    const me = shaper('unyielding', 2, { activeEffects: [barrier(10)] });
    const foe = makeFoe({ id: 'foe', position: at(1, 0), stats: stats({ attack: 200 }) });
    useCombatStore.setState({ units: [me, foe] });
    const warded = effective('shaper').defense;

    // A blow bigger than the Barrier: it is used up
    state().damageUnit('shaper', 60, 'foe');
    expect(unitNow('shaper').activeEffects.some((e) => e.type === AuraType.Barrier)).toBe(false);
    expect(effective('shaper').defense).toBeLessThan(warded);
    expect(effective('shaper').defense).toBe(10);
  });

  it('grants a bigger figure at every rung, and never to someone without the node', () => {
    const grants = RANKS.map((r) => unyieldingDefense(r));
    expect(grants[1]).toBeGreaterThan(grants[0]);
    expect(grants[2]).toBeGreaterThan(grants[1]);

    const plain = makeUnit({ id: 'plain', stats: stats(), activeEffects: [barrier()] });
    expect(getCombatEffectiveStats(plain).defense).toBe(10);
  });

  it('reduces damage from a spell as well as from a blade', () => {
    const hit = (type: 'physical' | 'magic', withBarrier: boolean) => {
      const me = shaper('unyielding', 2, { activeEffects: withBarrier ? [barrier(0.0001)] : [] });
      return getCombatEffectiveStats(me)[type === 'physical' ? 'defense' : 'magicDefense']!;
    };
    expect(hit('physical', true)).toBeGreaterThan(hit('physical', false));
    expect(hit('magic', true)).toBeGreaterThan(hit('magic', false));
  });
});

// ─── Seismic Sense ────────────────────────────────────────────────────────────

describe('Seismic Sense extends the next move under a warned ground attack', () => {
  const smash = (over: Partial<HeroSkill> = {}): HeroSkill =>
    makeSkill({
      id: 'test_smash' as HeroSkill['id'],
      name: 'Test Smash',
      targetType: SkillTargetType.Ring,
      range: 0,
      aoeRadius: 1,
      damage: 2,
      manaCost: 0,
      cooldown: 3,
      prepares: {},
      ...over,
    });

  const boss = (position = at(0, 0)) =>
    makeFoe({
      id: 'boss', name: 'Boss', position,
      stats: makeStats({ maxHp: 400, attack: 30, speed: 20, critChance: 0, dodgeChance: 0 }),
      skills: [smash()],
    });

  /** A boss warns a ring around `bossAt`; the Stoneshaper stands at (1, 0). */
  function warn(passive: PassiveId | undefined, level = 2, bossAt = at(0, 0)) {
    state().reset();
    const me = shaper(passive, level, { position: at(1, 0) });
    state().initCombat([me], [boss(bossAt)]);
    useCombatStore.setState({ currentUnitId: 'boss' });
    expect(resolveSkillUse(unitNow('boss'), smash(), bossAt, SILENT_SINK).ok).toBe(true);
    expect(state().preparedAttacks).toHaveLength(1);
  }

  const reach = () => effective('shaper').moveRange;

  it('lends movement on a turn that starts inside the warning', () => {
    warn('seismicSense');
    const before = reach();
    beginTurn('shaper', SILENT_SINK);
    expect(reach()).toBe(before + seismicSenseMove(RANKS[1]));
  });

  it('lends nothing without the node', () => {
    warn(undefined);
    const before = reach();
    beginTurn('shaper', SILENT_SINK);
    expect(reach()).toBe(before);
  });

  it('lends nothing when the warning does not cover this hex', () => {
    // Ring of radius 1 around a boss four hexes away does not reach (1, 0)
    warn('seismicSense', 2, at(-3, 0));
    expect(state().preparedAttacks[0].hexes.some((h) => h.q === 1 && h.r === 0)).toBe(false);
    const before = reach();
    beginTurn('shaper', SILENT_SINK);
    expect(reach()).toBe(before);
  });

  it('lends nothing against a warning from its own side', () => {
    state().reset();
    const me = shaper('seismicSense', 2, { position: at(1, 0) });
    const friendlyCaster = makeUnit({
      id: 'friend', position: at(0, 0), stats: stats(), skills: [smash()],
    });
    state().initCombat([me, friendlyCaster], [makeFoe({ id: 'far', position: at(3, 3), stats: stats() })]);
    useCombatStore.setState({ currentUnitId: 'friend' });
    resolveSkillUse(unitNow('friend'), smash(), at(0, 0), SILENT_SINK);
    const before = reach();
    beginTurn('shaper', SILENT_SINK);
    expect(reach()).toBe(before);
  });

  it('is one turn only', () => {
    warn('seismicSense');
    const before = reach();
    beginTurn('shaper', SILENT_SINK);
    expect(reach()).toBeGreaterThan(before);
    // The next regular turn's tick strips it, and the warning no longer applies
    useCombatStore.setState({ preparedAttacks: [] });
    beginTurn('shaper', SILENT_SINK);
    expect(reach()).toBe(before);
  });

  it('gives every rung a longer step', () => {
    const steps = RANKS.map((r) => seismicSenseMove(r));
    expect(steps[1]).toBeGreaterThan(steps[0]);
    expect(steps[2]).toBeGreaterThan(steps[1]);
    for (const level of [1, 2, 3]) {
      warn('seismicSense', level);
      const before = reach();
      beginTurn('shaper', SILENT_SINK);
      expect(reach() - before).toBe(steps[level - 1]);
    }
  });
});

describe('the nodes read as what they do', () => {
  it('states each effect in the node text and the passive figures', () => {
    expect(masteryNodeDescription(findMasteryNode('stone_unyielding')!.node)).toMatch(/Barrier/);
    expect(masteryNodeDescription(findMasteryNode('stone_seismic_sense')!.node)).toMatch(/marked ground attack/);
    for (const id of ['unyielding', 'seismicSense'] as const) {
      const def = PASSIVE_DEFS[id];
      expect(def.figures!(RANKS[0]).join(' ')).not.toBe(def.figures!(RANKS[2]).join(' '));
    }
  });

  it('replaces Ballast with Grounded Focus', () => {
    expect(findMasteryNode('stone_ballast')!.node.grantsPassive).toBe('groundedFocus');
  });
});
