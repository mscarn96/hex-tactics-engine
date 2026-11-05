import { spyDice } from '../support/dice';
import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { getSkillTargets } from '@/systems/combat/targeting';
import { requireUnit } from '@/systems/combat/unitLookup';
import { calculateHealing } from '@/systems/combat/damageCalc';
import { canUseSkill } from '@/systems/combat/cooldowns';
import { executeAIActions } from '@/systems/combat/enemyAI';
import { pulseSanctuaries, sanctuaryId } from '@/systems/combat/sanctuary';
import { growthCharges, sharedBloomRecipient } from '@/systems/combat/passives';
import { skillTargetKind } from '@/systems/combat/targetKind';
import { applyMasteryModifiers } from '@/systems/progression/mastery';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { BALANCE } from '@/data/balanceConstants';
import {
  frostbite, lifebloomSkill, rootedVitality, thornrow, wardingBloom, wildSanctuary,
} from '@/data/skills/masterySkills';
import { canopyGuard, timberCrush } from '@/data/skills/skillData';
import { summonTemplates } from '@/data/templates/summonTemplates';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { findMasteryPath } from '@/data/skills/masteryData';
import {
  AfflictionType, AuraType, CombatUnit, HeroStats, PassiveId, PassiveRank, SkillTargetType,
} from '@/models/types';
import { at, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * The Lifewarden remaster, as rules: Shared Bloom, Second Spring, Cycle of Life,
 * the Thornrow patch and the support preview, Wild Sanctuary, and the Treant's
 * Canopy Guard and cooldown-free Timber Crush. Numbers come from the definitions;
 * what is pinned is the shape.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 200, attack: 10, magic: 30, defense: 0, magicDefense: 0, maxMana: 500,
    critChance: 0, dodgeChance: 0, speed: 10, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const RANKS: PassiveRank[] = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));

const warden = (passives: PassiveId[] = [], level = 2, over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'warden',
    position: at(0, 0),
    stats: stats(),
    skills: [lifebloomSkill, thornrow, wildSanctuary, rootedVitality],
    passives,
    passiveRanks: Object.fromEntries(passives.map((p) => [p, RANKS[level - 1]])),
    ...over,
  });

const ally = (id: string, q: number, r: number, hp: number, over: Partial<CombatUnit> = {}) =>
  makeUnit({ id, position: at(q, r), stats: stats(), currentHp: hp, ...over });

const foe = (id: string, q: number, r: number, over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, position: at(q, r), stats: stats({ maxHp: 2000 }), ...over });

const has = (id: string, type: AuraType | AfflictionType) => unitNow(id).activeEffects.some((e) => e.type === type);
const effect = (id: string, type: AuraType | AfflictionType) => unitNow(id).activeEffects.find((e) => e.type === type);
const cast = (skill = lifebloomSkill, q = 1, r = 0, caster = 'warden') =>
  resolveSkillUse(unitNow(caster), skill, at(q, r), SILENT_SINK);
const ready = (id = 'warden') =>
  useCombatStore.setState({ units: state().units.map((u) => u.id === id ? { ...u, cooldowns: {}, currentMana: 500 } : u) });

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  state().reset();
  spyDice().mockReturnValue(0.5);
});

afterEach(() => jest.restoreAllMocks());

// ─── Shared Bloom ─────────────────────────────────────────────────────────────

describe('Shared Bloom', () => {
  it('sends a rung-scaled share of Lifebloom to the most wounded ally near the target', () => {
    for (const level of [1, 2, 3]) {
      state().reset();
      useCombatStore.setState({
        units: [warden(['sharedBloom'], level), ally('a', 1, 0, 150), ally('b', 2, 0, 60), ally('c', 2, -1, 120)],
      });
      const heal = calculateHealing(unitNow('warden'), lifebloomSkill, unitNow('a'));
      cast();
      const expected = Math.round(heal * BALANCE.SHARED_BLOOM_SHARE * RANKS[level - 1].scale);
      expect(unitNow('b').currentHp).toBe(60 + expected);
      // Only one secondary, and never a chain onto the third
      expect(unitNow('c').currentHp).toBe(120);
    }
  });

  it('gives the second ally a heal only, never the signature regeneration', () => {
    useCombatStore.setState({ units: [warden(['sharedBloom']), ally('a', 1, 0, 150), ally('b', 2, 0, 60)] });
    cast();
    expect(has('a', AuraType.HealOverTime)).toBe(true);
    expect(has('b', AuraType.HealOverTime)).toBe(false);
  });

  it('does nothing without the node', () => {
    useCombatStore.setState({ units: [warden(), ally('a', 1, 0, 150), ally('b', 2, 0, 60)] });
    cast();
    expect(unitNow('b').currentHp).toBe(60);
  });

  it('skips allies beyond two hexes of the target and allies at full health', () => {
    const me = warden(['sharedBloom']);
    const primary = ally('a', 1, 0, 150);
    const far = ally('far', 1, 3, 10);
    const full = ally('full', 2, 0, 200);
    expect(sharedBloomRecipient(me, primary, [me, primary, far, full])).toBeUndefined();
  });

  it('picks the lowest share of health, ties to the nearer, so the preview and the cast agree', () => {
    const me = warden(['sharedBloom'], 2, { currentHp: 150 });
    const primary = ally('a', 0, 1, 150);
    const near = ally('near', 1, 1, 100);
    const further = ally('further', 2, 1, 100);
    expect(sharedBloomRecipient(me, primary, [me, primary, further, near])?.id).toBe('near');
    // The caster is an ally like any other
    const hurt = { ...me, currentHp: 20 };
    expect(sharedBloomRecipient(hurt, primary, [hurt, primary, further, near])?.id).toBe('warden');
  });
});

// ─── Second Spring ────────────────────────────────────────────────────────────

describe('Second Spring', () => {
  it('cuts the damage a badly wounded ally takes, scaled by rung, read before the heal', () => {
    const cuts = [1, 2, 3].map((level) => {
      state().reset();
      // 50 of 200 is 25%: under the threshold before the heal, over it after
      useCombatStore.setState({ units: [warden(['secondSpring'], level), ally('a', 1, 0, 50)] });
      cast();
      expect(unitNow('a').currentHp).toBeGreaterThan(200 * BALANCE.SECOND_SPRING_THRESHOLD);
      return effect('a', AuraType.SecondSpring)?.magnitude;
    });
    expect(cuts[1]).toBe(BALANCE.SECOND_SPRING_REDUCTION);
    expect(cuts[0]).toBeLessThan(cuts[1]!);
    expect(cuts[2]).toBeGreaterThan(cuts[1]!);
  });

  it('ignores an ally above the threshold', () => {
    useCombatStore.setState({ units: [warden(['secondSpring']), ally('a', 1, 0, 100)] });
    cast();
    expect(has('a', AuraType.SecondSpring)).toBe(false);
  });

  it('lasts through the next enemy response', () => {
    useCombatStore.setState({ units: [warden(['secondSpring']), ally('a', 1, 0, 50)] });
    cast();
    expect(effect('a', AuraType.SecondSpring)?.duration).toBe(BALANCE.SECOND_SPRING_DURATION);
  });

  it('reduces what a blow takes by its share', () => {
    useCombatStore.setState({
      units: [
        ally('a', 1, 0, 200, { activeEffects: [{ type: AuraType.SecondSpring, magnitude: 20, duration: 2 }] }),
        foe('f', 2, 0),
      ],
    });
    const result = state().damageUnit('a', 100, 'f', { difficultyApplied: true });
    expect(result.hpLost).toBe(80);
  });
});

// ─── Cycle of Life ────────────────────────────────────────────────────────────

describe('Cycle of Life', () => {
  it('banks one Growth charge per healing cast that restores HP, up to three', () => {
    useCombatStore.setState({ units: [warden(['cycleOfLife']), ally('a', 1, 0, 20)] });
    for (let i = 1; i <= 4; i++) {
      ready();
      cast();
      expect(growthCharges(unitNow('warden'))).toBe(Math.min(i, BALANCE.CYCLE_OF_LIFE_CHARGES));
    }
  });

  it('counts a multi-target heal once', () => {
    useCombatStore.setState({
      units: [warden(['cycleOfLife']), ally('a', 2, 0, 20), ally('b', 2, 1, 20), ally('c', 3, 0, 20)],
    });
    cast(thornrow, 2, 0);
    expect(growthCharges(unitNow('warden'))).toBe(1);
  });

  it('stores nothing for an empty heal or for regeneration', () => {
    useCombatStore.setState({ units: [warden(['cycleOfLife']), ally('a', 1, 0, 200)] });
    cast();
    expect(growthCharges(unitNow('warden'))).toBe(0);
    useCombatStore.setState({
      units: state().units.map((u) => u.id === 'a'
        ? { ...u, currentHp: 50, activeEffects: [{ type: AuraType.HealOverTime, magnitude: 10, duration: 3, sourceUnitId: 'warden' }] }
        : u),
    });
    state().tickEffectsOnUnit('a');
    expect(unitNow('a').currentHp).toBe(60);
    expect(growthCharges(unitNow('warden'))).toBe(0);
  });

  it('spends three charges on the next damaging spell, once per enemy hit, before awarding a new one', () => {
    const full = { type: AuraType.Growth, magnitude: 3, duration: -1, sourceUnitId: 'warden' };
    const run = (charged: boolean) => {
      state().reset();
      useCombatStore.setState({
        units: [
          warden(['cycleOfLife'], 2, { activeEffects: charged ? [full] : [] }),
          foe('f1', 2, 0), foe('f2', 2, 1), ally('a', 3, 0, 20),
        ],
      });
      cast(thornrow, 2, 0);
      return { lost: [2000 - unitNow('f1').currentHp, 2000 - unitNow('f2').currentHp], growth: growthCharges(unitNow('warden')) };
    };
    const plain = run(false);
    const paid = run(true);
    const bonus = Math.round(30 * BALANCE.CYCLE_OF_LIFE_MAGIC);
    expect(paid.lost[0] - plain.lost[0]).toBe(bonus);
    expect(paid.lost[1] - plain.lost[1]).toBe(bonus);
    // Spent, then the heal on the ally banks one fresh charge
    expect(paid.growth).toBe(1);
  });

  it('is not spent by a weapon strike or by a heal', () => {
    const full = { type: AuraType.Growth, magnitude: 3, duration: -1, sourceUnitId: 'warden' };
    const swing = { ...frostbite, id: 'test_swing' as never, scaling: 'attack' as const, appliesEffect: undefined };
    useCombatStore.setState({
      units: [warden(['cycleOfLife'], 2, { activeEffects: [full], skills: [swing, lifebloomSkill] }), foe('f', 1, 0), ally('a', 0, 1, 20)],
    });
    resolveSkillUse(unitNow('warden'), swing, at(1, 0), SILENT_SINK);
    expect(growthCharges(unitNow('warden'))).toBe(3);
    ready();
    cast(lifebloomSkill, 0, 1);
    expect(growthCharges(unitNow('warden'))).toBe(3);
  });
});

// ─── Thornrow and the support preview ────────────────────────────────────────

describe('Thornrow', () => {
  it('is an aimed radius-1 patch within range 4 that Broad Bloom widens', () => {
    expect(thornrow.targetType).toBe(SkillTargetType.Ring);
    expect(thornrow.range).toBe(4);
    expect(getSkillTargets(thornrow, at(0, 0), at(2, 0), [])).toHaveLength(7);
    const broad = applyMasteryModifiers(thornrow, { aoeRadiusBonus: 1 });
    expect(getSkillTargets(broad, at(0, 0), at(1, 0), [])).toHaveLength(19);
  });

  it('damages and Roots the enemies in the patch and heals the allies', () => {
    useCombatStore.setState({ units: [warden(), foe('f', 2, 0), ally('a', 2, 1, 50)] });
    cast(thornrow, 2, 0);
    expect(unitNow('f').currentHp).toBeLessThan(2000);
    expect(has('f', AfflictionType.Root)).toBe(true);
    expect(unitNow('a').currentHp).toBeGreaterThan(50);
    expect(has('a', AuraType.HealOverTime)).toBe(true);
    expect(has('a', AfflictionType.Root)).toBe(false);
  });
});

describe('the support preview', () => {
  it('reads support from the whole skill, not from direct healing alone', () => {
    expect(skillTargetKind(rootedVitality)).toBe('support');
    expect(skillTargetKind(wardingBloom)).toBe('support');
    expect(skillTargetKind(lifebloomSkill)).toBe('support');
  });

  it('marks spells that help and harm as mixed, and strikes as attacks', () => {
    expect(skillTargetKind(thornrow)).toBe('mixed');
    expect(skillTargetKind(wildSanctuary)).toBe('mixed');
    expect(skillTargetKind(frostbite)).toBe('attack');
    // A strike whose aura stays on the caster is still an attack
    expect(skillTargetKind({
      ...frostbite, appliesEffect: { type: AuraType.AttackBuff, magnitude: 3, duration: 2, selfOnly: true },
    })).toBe('attack');
  });

  it('says what Rooted Vitality actually does: no Root on the ally', () => {
    useCombatStore.setState({ units: [warden(), ally('a', 1, 0, 50)] });
    cast(rootedVitality);
    expect(has('a', AuraType.HealOverTime)).toBe(true);
    expect(has('a', AfflictionType.Root)).toBe(false);
  });
});

// ─── Wild Sanctuary ───────────────────────────────────────────────────────────

describe('Wild Sanctuary', () => {
  const ground = () => state().hazards.find((h) => h.id === sanctuaryId('warden'));
  /** One of the warden's regular turn starts, as `beginRegularTurn` runs them. */
  const turn = () => {
    pulseSanctuaries(unitNow('warden'), SILENT_SINK);
    state().tickHazards('warden');
  };

  it('heals allies, damages enemies and Roots them on the cast, and stays as ground', () => {
    useCombatStore.setState({ units: [warden(), foe('f', 2, 0), ally('a', 2, 1, 50)] });
    cast(wildSanctuary, 2, 0);
    expect(unitNow('f').currentHp).toBeLessThan(2000);
    expect(has('f', AfflictionType.Root)).toBe(true);
    expect(unitNow('a').currentHp).toBeGreaterThan(50);
    expect(ground()?.hexes).toHaveLength(19);
    expect(ground()?.turnsLeft).toBe(BALANCE.WILD_SANCTUARY_TURNS);
  });

  it('pulses on each of the next three regular turns, then withers', () => {
    useCombatStore.setState({ units: [warden(), foe('f', 2, 0), ally('a', 2, 1, 20)] });
    cast(wildSanctuary, 2, 0);
    let hp = unitNow('f').currentHp;
    let healed = unitNow('a').currentHp;
    for (let i = 0; i < BALANCE.WILD_SANCTUARY_TURNS; i++) {
      turn();
      expect(unitNow('f').currentHp).toBeLessThan(hp);
      expect(unitNow('a').currentHp).toBeGreaterThan(healed);
      hp = unitNow('f').currentHp;
      healed = unitNow('a').currentHp;
    }
    expect(ground()).toBeUndefined();
    turn();
    expect(unitNow('f').currentHp).toBe(hp);
  });

  it('Roots each enemy once per cast, however often it is caught, and catches newcomers', () => {
    useCombatStore.setState({ units: [warden(), foe('f', 2, 0), foe('late', -2, -2)] });
    cast(wildSanctuary, 2, 0);
    state().removeEffect('f', AfflictionType.Root);
    // The newcomer walks in; the first enemy steps out and back
    state().moveUnit('late', at(2, 1), 'walk', false);
    turn();
    expect(has('f', AfflictionType.Root)).toBe(false);
    expect(has('late', AfflictionType.Root)).toBe(true);
    expect(ground()?.sanctuary?.rooted.sort()).toEqual(['f', 'late']);
  });

  it('still damages a control-immune boss, which refuses only the Root', () => {
    const bossTemplate = enemyTemplates.find((t) => t.tier === 'boss')!;
    useCombatStore.setState({ units: [warden(), foe('boss', 2, 0, { templateId: bossTemplate.id })] });
    cast(wildSanctuary, 2, 0);
    expect(unitNow('boss').currentHp).toBeLessThan(2000);
    expect(has('boss', AfflictionType.Root)).toBe(false);
    const hp = unitNow('boss').currentHp;
    turn();
    expect(unitNow('boss').currentHp).toBeLessThan(hp);
  });

  it('can be grown on empty ground, and a recast replaces the old sanctuary', () => {
    useCombatStore.setState({ units: [warden()] });
    expect(cast(wildSanctuary, 2, 0).ok).toBe(true);
    ready();
    cast(wildSanctuary, -2, 0);
    expect(state().hazards.filter((h) => h.sanctuary)).toHaveLength(1);
    expect(ground()?.hexes.some((h) => h.q === -2 && h.r === 0)).toBe(true);
  });

  it('replaces Evergreen in the tree, and the side trees open from it', () => {
    const path = findMasteryPath('lifewarden')!;
    expect(path.nodes.some((n) => n.grantsSkill === 'evergreen')).toBe(false);
    const capstone = path.nodes.find((n) => n.grantsSkill === 'wild_sanctuary')!;
    expect(capstone.exclusiveGroup).toBe('capstone');
    for (const starter of path.nodes.filter((n) => n.exclusiveGroup === 'side')) {
      expect(starter.requires).toContain(capstone.id);
    }
  });
});

// ─── The Treant ───────────────────────────────────────────────────────────────

describe('the Treant', () => {
  const treant = (over: Partial<CombatUnit> = {}) =>
    makeUnit({ id: 'treant', position: at(0, 0), stats: stats({ maxHp: 85, magic: 6 }), skills: [timberCrush, canopyGuard], ...over });

  it('carries Timber Crush, Rootlash and Canopy Guard', () => {
    const template = summonTemplates.find((t) => t.id === 'treant')!;
    expect(template.skills.map((s) => s.id)).toEqual(['timber_crush', 'rootlash_sweep', 'canopy_guard']);
  });

  it('swings Timber Crush every turn: no cooldown, still one action', () => {
    useCombatStore.setState({ units: [treant(), foe('f', 1, 0)] });
    const result = resolveSkillUse(unitNow('treant'), timberCrush, at(1, 0), SILENT_SINK);
    expect(result.endsTurn).toBe(true);
    expect(canUseSkill(unitNow('treant'), timberCrush)).toBe(true);
  });

  it('gives every ally in reach a Barrier sized from that ally\'s own maximum HP, on both paths', () => {
    const expected = (maxHp: number) => Math.round(maxHp * BALANCE.CANOPY_GUARD_MAX_HP);
    const setup = () => useCombatStore.setState({
      units: [treant(), ally('a', 1, 0, 100, { stats: stats({ maxHp: 300 }) }), ally('far', 3, 0, 100), foe('f', 0, 1)],
    });
    setup();
    resolveSkillUse(unitNow('treant'), canopyGuard, at(0, 0), SILENT_SINK);
    expect(effect('a', AuraType.Barrier)?.magnitude).toBe(expected(300));
    expect(effect('treant', AuraType.Barrier)?.magnitude).toBe(expected(85));
    expect(has('far', AuraType.Barrier)).toBe(false);
    expect(has('f', AuraType.Barrier)).toBe(false);

    state().reset();
    setup();
    executeAIActions(unitNow('treant'), [{ type: 'skill', skill: canopyGuard, skillTarget: at(0, 0) }]);
    expect(effect('a', AuraType.Barrier)?.magnitude).toBe(expected(300));
    expect(effect('treant', AuraType.Barrier)?.magnitude).toBe(expected(85));
  });
});
