import { spyDice } from '../support/dice';
import { useCombatStore } from '@/stores/combatStore';
import { skillDescription } from '@/data/gameText';
import { CombatSink, resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { getMovementRange } from '@/systems/combat/movement';
import { requireUnit } from '@/systems/combat/unitLookup';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { basicAttackFor, basicAttackWith } from '@/systems/combat/basicAttack';
import { ownBlades } from '@/systems/combat/blades';
import { knifeDanceStep } from '@/systems/combat/knifeDance';
import { withDice } from '@/systems/combat/dice';
import { sharpenedSteelFor } from '@/systems/combat/passives';
import { sharpenedSteelPen, slipstreamStep } from '@/systems/combat/passiveFormulas';
import { isBoss } from '@/systems/combat/bossControl';
import { skillEffects } from '@/systems/combat/statusEffects';
import { nodeSkillAt } from '@/systems/progression/mastery';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { BALANCE } from '@/data/balanceConstants';
import {
  barbedBlades, bladeRecall, bladestorm, bolas, flurry, hitAndRun, knifeDance, smokeBomb,
} from '@/data/skills/masterySkills';
import { findMasteryNode, findMasteryPath } from '@/data/skills/masteryData';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { AfflictionType, AuraType, CombatUnit, HeroStats, PassiveId, PassiveRank } from '@/models/types';
import type { EquippedItems } from '@/systems/progression/equipRules';
import { hexDistance } from '@/utils/hexUtils';
import { at, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * The Skirmisher remaster, as rules: Embedded Blades and the cone extraction
 * Signature (Blade Recall) with its Fan of Blades throw, blades on Basic Attack,
 * Barbed Blades, Bladestorm and Flurry, Knife Dance, Slipstream, Sharpened Steel
 * and the persistent Smoke Bomb. What is pinned is the shape, not the numbers.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 400, attack: 30, magic: 10, defense: 0, magicDefense: 0, maxMana: 200,
    critChance: 0, dodgeChance: 0, speed: 10, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const nodeOf = (id: string) => findMasteryNode(id)?.node;
const RANKS: PassiveRank[] = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));

const skirmisher = (passives: PassiveId[] = [], over: Partial<CombatUnit> = {}, level = 2) =>
  makeUnit({
    id: 'skirm',
    position: at(0, 0),
    stats: stats(),
    currentMana: 200,
    skills: [bladeRecall],
    passives,
    passiveRanks: Object.fromEntries(passives.map((p) => [p, RANKS[level - 1]])),
    ...over,
  });

const foe = (id: string, q: number, r: number, over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, position: at(q, r), stats: stats({ maxHp: 2000 }), ...over });

const blades = (id: string, owner = 'skirm') => ownBlades(unitNow(id), owner);
const seed = (id: string, count: number, owner = 'skirm') => state().embedBlades(id, owner, count);
const hpLost = (id: string) => unitNow(id).stats.maxHp - unitNow(id).currentHp;

const recording = () => {
  const logs: string[] = [];
  const sink: CombatSink = { ...SILENT_SINK, log: (text) => { logs.push(text); } };
  return { sink, logs };
};

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  state().reset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── Embedded Blades ──────────────────────────────────────────────────────────

describe('Embedded Blades', () => {
  it('keeps each Skirmisher’s blades apart, so a pull never steals', () => {
    useCombatStore.setState({ units: [skirmisher(), skirmisher([], { id: 'other', position: at(-1, 0) }), foe('a', 2, 0)] });
    seed('a', 2);
    seed('a', 3, 'other');
    expect(blades('a')).toBe(2);
    expect(blades('a', 'other')).toBe(3);

    resolveSkillUse(unitNow('skirm'), bladeRecall, at(2, 0), SILENT_SINK);
    expect(blades('a')).toBe(0);
    expect(blades('a', 'other')).toBe(3);
  });

  it('caps one Skirmisher’s pile in one enemy', () => {
    useCombatStore.setState({ units: [skirmisher(), foe('a', 2, 0)] });
    seed('a', 4);
    seed('a', 4);
    expect(blades('a')).toBe(BALANCE.BLADES_CAP);
  });

  it('is an affliction a cleanse removes, and has no clock and no damage of its own', () => {
    useCombatStore.setState({ units: [skirmisher(), foe('a', 2, 0)] });
    seed('a', 3);
    const entry = unitNow('a').activeEffects.find((e) => e.type === AfflictionType.Blades)!;
    expect(entry.duration).toBe(-1);
    state().tickEffectsOnUnit('a');
    expect(hpLost('a')).toBe(0);
    expect(blades('a')).toBe(3);
    state().removeAllAfflictions('a');
    expect(blades('a')).toBe(0);
  });

  it('goes into a boss like anyone, since it disables nothing', () => {
    const bossId = enemyTemplates.find((t) => t.tier === 'boss')!.id;
    useCombatStore.setState({ units: [skirmisher(), foe('boss', 2, 0, { templateId: bossId })] });
    expect(isBoss(unitNow('boss'))).toBe(true);
    seed('boss', 2);
    expect(blades('boss')).toBe(2);
  });

  it('is not left by a dodged blow', () => {
    spyDice().mockReturnValue(0);
    useCombatStore.setState({ units: [skirmisher([], { skills: [barbedBlades] }), foe('a', 2, 0, { stats: stats({ maxHp: 2000, dodgeChance: 50 }) })] });
    resolveSkillUse(unitNow('skirm'), barbedBlades, at(2, 0), SILENT_SINK);
    expect(blades('a')).toBe(0);
  });

  it('is laid by every damaging Skirmisher skill instead of Bleed', () => {
    const path = findMasteryPath('skirmisher')!;
    const granted = path.nodes.filter((n) => n.grantsSkill).map((n) => nodeSkillAt(n, 2)!);
    for (const skill of [bladeRecall, ...granted]) {
      expect({ id: skill.id, bleeds: skillEffects(skill).some((e) => e.type === AfflictionType.Bleed) })
        .toEqual({ id: skill.id, bleeds: false });
    }
    for (const skill of [barbedBlades, bolas, hitAndRun, knifeDance, bladeRecall]) {
      expect({ id: skill.id, embeds: skill.embedsBlades }).toEqual({ id: skill.id, embeds: 1 });
    }
  });
});

// ─── Basic Attack ─────────────────────────────────────────────────────────────

describe('Basic Attack', () => {
  const held = (form: string) => ({ slot: 'mainHand', form, name: form }) as unknown as EquippedItems['mainHand'];

  it('leaves one blade with any of the Skirmisher’s four weapons', () => {
    for (const form of ['throwing_blade', 'throwing_axe', 'spear', 'dagger']) {
      expect({ form, embeds: basicAttackFor({ masteryPath: 'skirmisher' }, { mainHand: held(form) }).embedsBlades })
        .toEqual({ form, embeds: 1 });
    }
  });

  it('leaves none unarmed, or for another path holding the same weapon', () => {
    expect(basicAttackFor({ masteryPath: 'skirmisher' }, {}).embedsBlades).toBeUndefined();
    expect(basicAttackFor({ masteryPath: 'shadowblade' }, { mainHand: held('dagger') }).embedsBlades).toBeUndefined();
  });

  it('lands the blade it promises', () => {
    const attack = { ...basicAttackWith(held('dagger')), embedsBlades: 1, range: 2 };
    useCombatStore.setState({ units: [skirmisher([], { skills: [attack] }), foe('a', 1, 0)] });
    resolveSkillUse(unitNow('skirm'), attack, at(1, 0), SILENT_SINK);
    expect(blades('a')).toBe(1);
  });
});

// ─── Blade Recall ─────────────────────────────────────────────────────────────

describe('Blade Recall (the Signature)', () => {
  it('is the Skirmisher’s Signature skill', () => {
    expect(findMasteryPath('skirmisher')!.signatureSkill).toBe('blade_recall');
  });

  it('pulls from every enemy in the cone, one hit each worth its blades, and from nobody outside it', () => {
    useCombatStore.setState({ units: [skirmisher(), foe('a', 1, 0), foe('b', 2, 0), foe('out', -2, 0), foe('bare', 2, -1)] });
    seed('a', 2);
    seed('b', 5);
    seed('out', 3);
    const expectA = calculateDamage(unitNow('skirm'), unitNow('a'), { ...bladeRecall, damage: BALANCE.BLADE_EXTRACT_PER_BLADE * 2 });
    const expectB = calculateDamage(unitNow('skirm'), unitNow('b'), { ...bladeRecall, damage: BALANCE.BLADE_EXTRACT_PER_BLADE * 5 });

    const result = resolveSkillUse(unitNow('skirm'), bladeRecall, at(2, 0), SILENT_SINK);
    expect(result.ok).toBe(true);
    expect(hpLost('a')).toBe(expectA);
    expect(hpLost('b')).toBe(expectB);
    expect(hpLost('b')).toBeGreaterThan(hpLost('a'));
    expect([blades('a'), blades('b')]).toEqual([0, 0]);
    // Outside the cone: untouched; no blades of yours: no damage
    expect(blades('out')).toBe(3);
    expect(hpLost('out')).toBe(0);
    expect(hpLost('bare')).toBe(0);
  });

  it('cannot be dodged', () => {
    spyDice().mockReturnValue(0);
    useCombatStore.setState({ units: [skirmisher(), foe('a', 2, 0, { stats: stats({ maxHp: 2000, dodgeChance: 60 }) })] });
    seed('a', 3);
    resolveSkillUse(unitNow('skirm'), bladeRecall, at(2, 0), SILENT_SINK);
    expect(hpLost('a')).toBeGreaterThan(0);
  });

  it('is refused, and spends nothing, with nothing to pull or throw', () => {
    useCombatStore.setState({ units: [skirmisher(), foe('a', 2, 0)] });
    const result = resolveSkillUse(unitNow('skirm'), bladeRecall, at(2, 0), SILENT_SINK);
    expect(result).toEqual(expect.objectContaining({ ok: false, refusal: 'no-targets' }));
    expect(unitNow('skirm').cooldowns?.blade_recall ?? 0).toBe(0);
  });

  it('with Fan of Blades throws first, embeds, then pulls from the same cone in one cast', () => {
    useCombatStore.setState({ units: [skirmisher(['fanOfBlades']), foe('a', 2, 0)] });
    const { sink, logs } = recording();
    const result = resolveSkillUse(unitNow('skirm'), bladeRecall, at(2, 0), sink);
    expect(result.ok).toBe(true);
    // A target with no blades took the throw, received one, and had it pulled
    expect(logs.some((l) => /a: 1 blade pulled/.test(l))).toBe(true);
    expect(blades('a')).toBe(0);
    const throwOnly = calculateDamage(unitNow('skirm'), { ...unitNow('a'), currentHp: 2000 }, bladeRecall);
    expect(hpLost('a')).toBeGreaterThan(throwOnly);
    expect(unitNow('skirm').cooldowns?.blade_recall).toBeGreaterThan(0);
  });

  it('with Flurry and Fan of Blades: the throw and the area knife all embed before the single pull', () => {
    const dancing = { activeEffects: [{ type: AuraType.Flurry, magnitude: 1, duration: 3 }] };
    useCombatStore.setState({ units: [skirmisher(['fanOfBlades'], dancing), foe('a', 2, 0)] });
    const { sink, logs } = recording();
    resolveSkillUse(unitNow('skirm'), bladeRecall, at(2, 0), sink);
    const pulls = logs.filter((l) => /blades? pulled/.test(l));
    expect(pulls).toEqual([expect.stringContaining(`${1 + BALANCE.FLURRY_FOLLOWUPS_AREA} blades pulled`)]);
    expect(blades('a')).toBe(0);
  });

  it('with Flurry alone: the area knife embeds, then one pull, and no full throw is invented', () => {
    const dancing = { activeEffects: [{ type: AuraType.Flurry, magnitude: 1, duration: 3 }] };
    useCombatStore.setState({ units: [skirmisher([], dancing), foe('a', 2, 0)] });
    seed('a', 1);
    const { sink, logs } = recording();
    resolveSkillUse(unitNow('skirm'), bladeRecall, at(2, 0), sink);
    expect(logs.filter((l) => /blades? pulled/.test(l))).toEqual([expect.stringContaining(`${1 + BALANCE.FLURRY_FOLLOWUPS_AREA} blades pulled`)]);
  });

  it('scales its Fan of Blades throw with the node rank', () => {
    const throwAt = (level: number) => {
      state().reset();
      useCombatStore.setState({ units: [skirmisher(['fanOfBlades'], {}, level), foe('a', 2, 0)] });
      resolveSkillUse(unitNow('skirm'), bladeRecall, at(2, 0), SILENT_SINK);
      return hpLost('a');
    };
    expect(throwAt(1)).toBeLessThan(throwAt(2));
    expect(throwAt(2)).toBeLessThan(throwAt(3));
  });
});

// ─── Barbed Blades ────────────────────────────────────────────────────────────

describe('Barbed Blades', () => {
  const throwAt = (own: number, theirs = 0) => {
    state().reset();
    useCombatStore.setState({ units: [skirmisher([], { skills: [barbedBlades] }), foe('a', 2, 0)] });
    if (own) seed('a', own);
    if (theirs) seed('a', theirs, 'other');
    resolveSkillUse(unitNow('skirm'), barbedBlades, at(2, 0), SILENT_SINK);
    return hpLost('a');
  };

  it('hits harder for each of your blades already in, and only yours', () => {
    expect(throwAt(3)).toBeGreaterThan(throwAt(0));
    expect(throwAt(0, 4)).toBe(throwAt(0));
  });

  it('adds a blade and pulls none', () => {
    throwAt(2);
    expect(blades('a')).toBe(3);
  });
});

// ─── Knife Dance ──────────────────────────────────────────────────────────────

describe('Knife Dance', () => {
  it('replaces Volley as a capstone', () => {
    expect(nodeOf('skirm_knife_dance')).toEqual(expect.objectContaining({ tier: 3, grantsSkill: 'knife_dance', exclusiveGroup: 'capstone' }));
    expect(nodeOf('skirm_volley')).toBeUndefined();
  });

  it('makes three ground dashes and throws a blade after each', () => {
    useCombatStore.setState({
      units: [skirmisher([], { skills: [knifeDance] }), foe('a', 3, 0), foe('b', 3, 2), foe('c', 1, 3), foe('d', -3, 0)],
    });
    const result = resolveSkillUse(unitNow('skirm'), knifeDance, at(3, 0), SILENT_SINK);
    expect(result.ok).toBe(true);
    const struck = ['a', 'b', 'c', 'd'].filter((id) => hpLost(id) > 0);
    expect(struck.length).toBeLessThanOrEqual(BALANCE.KNIFE_DANCE_STRIKES);
    expect(struck).toEqual(expect.arrayContaining(['a']));
    expect(struck).not.toContain('d');
    expect(struck.reduce((sum, id) => sum + blades(id), 0)).toBe(3);
    expect(unitNow('skirm').movement?.mode).toBe('dash');
    expect(unitNow('skirm').movement?.dance?.stops).toHaveLength(4);
  });

  it('throws all three blades at a lone living enemy, then stops once it falls', () => {
    useCombatStore.setState({ units: [skirmisher([], { skills: [knifeDance] }), foe('a', 3, 0)] });
    const specs: Parameters<CombatSink['vfx']>[0][] = [];
    resolveSkillUse(unitNow('skirm'), knifeDance, at(3, 0), { ...SILENT_SINK, vfx: spec => { specs.push(spec); } });
    expect(blades('a')).toBe(3);
    expect(specs.find(spec => spec.kind === 'knifedance')?.danceSteps).toHaveLength(3);
    useCombatStore.setState({ units: [skirmisher([], { skills: [knifeDance] }), foe('a', 3, 0, { currentHp: 1 })] });
    resolveSkillUse(unitNow('skirm'), knifeDance, at(3, 0), SILENT_SINK);
    expect(unitNow('skirm').movement?.dance?.stops).toHaveLength(2);
  });

  it('Flurry adds knives without repeating the three model dashes', () => {
    const specs: Parameters<CombatSink['vfx']>[0][] = [];
    useCombatStore.setState({ units: [skirmisher([], { skills: [knifeDance],
      activeEffects: [{ type: AuraType.Flurry, magnitude: 1, duration: 3 }] }), foe('a', 3, 0)] });
    resolveSkillUse(unitNow('skirm'), knifeDance, at(3, 0), { ...SILENT_SINK, vfx: spec => { specs.push(spec); } });
    expect(unitNow('skirm').movement?.dance?.stops).toHaveLength(4);
    expect(blades('a')).toBe(BALANCE.BLADES_CAP);
    expect(specs.filter(spec => spec.danceSteps?.length === 3)).toHaveLength(1);
    const extra = specs.filter(spec => spec.danceSteps?.length === 1);
    // Each of the three throws is a single-target strike
    expect(extra).toHaveLength(3 * BALANCE.FLURRY_FOLLOWUPS_SINGLE);
    expect(extra.every(spec => spec.danceSteps![0].from === spec.danceSteps![0].to)).toBe(true);
  });

  it('is refused under Root', () => {
    useCombatStore.setState({
      units: [skirmisher([], { skills: [knifeDance], activeEffects: [{ type: AfflictionType.Root, magnitude: 1, duration: 2 }] }), foe('a', 3, 0)],
    });
    expect(resolveSkillUse(unitNow('skirm'), knifeDance, at(3, 0), SILENT_SINK).refusal).toBe('rooted');
    expect(hpLost('a')).toBe(0);
  });

  it('randomises only equally nearest victims and respects solid landing restrictions', () => {
    const caster = skirmisher();
    const units = [caster, foe('a', 3, 0), foe('b', 2, 1), foe('far', -3, 0)];
    expect(withDice(() => 0, () => knifeDanceStep(caster, knifeDance, units, [], at(3, 0), true))?.target.id).toBe('a');
    expect(withDice(() => 0.99, () => knifeDanceStep(caster, knifeDance, units, [], at(3, 0), true))?.target.id).toBe('b');
    const walls = [{ id: 'wall', label: 'Wall', solid: true, hexes: [at(2, 0), at(3, -1), at(2, 1), at(3, 1), at(4, 0), at(4, -1)] }];
    expect(knifeDanceStep(caster, knifeDance, units, walls, at(3, 0), true)).toBeNull();
  });
});

// ─── Bladestorm and Flurry ────────────────────────────────────────────────────

describe('Bladestorm and Flurry', () => {
  it('Bladestorm lays one blade per enemy per bite', () => {
    const storm = { type: AuraType.BladeStorm, magnitude: 8, duration: 3 };
    useCombatStore.setState({ units: [skirmisher([], { activeEffects: [storm] }), foe('a', 1, 0), foe('b', 0, 2)] });
    state().tickEffectsOnUnit('skirm');
    expect([blades('a'), blades('b')]).toEqual([1, 1]);
    expect(skillDescription(bladestorm)).toMatch(/blade/);
  });

  it('Flurry’s knives each leave a blade on a blade-leaving skill', () => {
    const dancing = { activeEffects: [{ type: AuraType.Flurry, magnitude: 1, duration: 3 }] };
    useCombatStore.setState({ units: [skirmisher([], { ...dancing, skills: [barbedBlades] }), foe('a', 2, 0)] });
    resolveSkillUse(unitNow('skirm'), barbedBlades, at(2, 0), SILENT_SINK);
    expect(blades('a')).toBe(1 + BALANCE.FLURRY_FOLLOWUPS_SINGLE);
    expect(skillDescription(flurry)).toMatch(/blade/);
  });

  // Playtest 2026-10-21, PT-40: three knives behind every strike was too strong
  it('Flurry sends two knives after a single-target strike and one after an area strike, blades with them', () => {
    expect([BALANCE.FLURRY_FOLLOWUPS_SINGLE, BALANCE.FLURRY_FOLLOWUPS_AREA]).toEqual([2, 1]);
    const dancing = { activeEffects: [{ type: AuraType.Flurry, magnitude: 1, duration: 3 }] };
    useCombatStore.setState({ units: [skirmisher([], { ...dancing, skills: [bolas] }), foe('a', 2, 0), foe('b', 3, 0)] });
    resolveSkillUse(unitNow('skirm'), bolas, at(2, 0), SILENT_SINK);
    expect([blades('a'), blades('b')]).toEqual([1 + BALANCE.FLURRY_FOLLOWUPS_AREA, 1 + BALANCE.FLURRY_FOLLOWUPS_AREA]);
  });
});

// ─── Slipstream ───────────────────────────────────────────────────────────────

describe('Slipstream', () => {
  it('replaces Light Foot in the first row', () => {
    expect(nodeOf('skirm_slipstream')).toEqual(expect.objectContaining({ tier: 1, column: 0, grantsPassive: 'slipstream' }));
    expect(nodeOf('skirm_light_foot')).toBeUndefined();
  });

  it('leaves a free one-hex step after a damaging cast, after the whole cast', () => {
    useCombatStore.setState({ units: [skirmisher(['slipstream', 'fanOfBlades']), foe('a', 2, 0)] });
    const result = resolveSkillUse(unitNow('skirm'), bladeRecall, at(2, 0), SILENT_SINK);
    expect(result).toEqual(expect.objectContaining({ ok: true, endsTurn: false }));
    const after = unitNow('skirm');
    expect(after.hasActed).toBe(true);
    expect(after.repositionCap).toBe(slipstreamStep(RANKS[1]));
    for (const hex of getMovementRange(after, state().units)) {
      expect(hexDistance(after.position, hex)).toBeLessThanOrEqual(slipstreamStep(RANKS[1]));
    }
  });

  it('steps one hex more with each rank', () => {
    expect(RANKS.map(slipstreamStep)).toEqual([1, 2, 3]);
  });

  it('grants nothing under Root, on a miss, or without the node', () => {
    const root = [{ type: AfflictionType.Root, magnitude: 1, duration: 2 }];
    useCombatStore.setState({ units: [skirmisher(['slipstream'], { skills: [barbedBlades], activeEffects: root }), foe('a', 2, 0)] });
    expect(resolveSkillUse(unitNow('skirm'), barbedBlades, at(2, 0), SILENT_SINK).endsTurn).toBe(true);

    state().reset();
    spyDice().mockReturnValue(0);
    useCombatStore.setState({ units: [skirmisher(['slipstream'], { skills: [barbedBlades] }), foe('a', 2, 0, { stats: stats({ maxHp: 2000, dodgeChance: 50 }) })] });
    expect(resolveSkillUse(unitNow('skirm'), barbedBlades, at(2, 0), SILENT_SINK).endsTurn).toBe(true);
    jest.restoreAllMocks();

    state().reset();
    useCombatStore.setState({ units: [skirmisher([], { skills: [barbedBlades] }), foe('a', 2, 0)] });
    expect(resolveSkillUse(unitNow('skirm'), barbedBlades, at(2, 0), SILENT_SINK).endsTurn).toBe(true);
  });
});

// ─── Sharpened Steel ──────────────────────────────────────────────────────────

describe('Sharpened Steel', () => {
  const armoured = (over: Partial<CombatUnit> = {}) => foe('a', 2, 0, { stats: stats({ maxHp: 2000, defense: 30 }), ...over });
  const hitWith = (passives: PassiveId[], over: Partial<CombatUnit> = {}) => {
    state().reset();
    useCombatStore.setState({ units: [skirmisher(passives, { skills: [barbedBlades] }), armoured(over)] });
    resolveSkillUse(unitNow('skirm'), barbedBlades, at(2, 0), SILENT_SINK);
    return unitNow('a');
  };

  it('replaces Bandolier in the first row', () => {
    expect(nodeOf('skirm_sharpened_steel')).toEqual(expect.objectContaining({ tier: 1, column: 1, grantsPassive: 'sharpenedSteel' }));
    expect(nodeOf('skirm_bandolier')).toBeUndefined();
  });

  it('ignores part of Physical Defense on the first hit at a full-health enemy', () => {
    const plain = hitWith([]);
    const sharp = hitWith(['sharpenedSteel']);
    expect(plain.stats.maxHp - plain.currentHp).toBeLessThan(sharp.stats.maxHp - sharp.currentHp);
  });

  it('does nothing against a wounded enemy', () => {
    const plain = hitWith([], { currentHp: 1500 });
    const sharp = hitWith(['sharpenedSteel'], { currentHp: 1500 });
    expect(1500 - sharp.currentHp).toBe(1500 - plain.currentHp);
  });

  it('opens each enemy once per cast, and grows with the rank', () => {
    const holder = skirmisher(['sharpenedSteel']);
    const target = armoured();
    const knife = { id: 'slash' as const, damageType: 'physical' as const };
    expect(sharpenedSteelFor(holder, target, true, new Set(), knife)).toBe(sharpenedSteelPen(RANKS[1]));
    expect(sharpenedSteelFor(holder, target, true, new Set([target.id]), knife)).toBe(0);
    expect(sharpenedSteelFor(holder, target, false, new Set(), knife)).toBe(0);
    expect(sharpenedSteelPen(RANKS[0])).toBeLessThan(sharpenedSteelPen(RANKS[2]));
  });

  it('pierces armour only: a magic hit is not sharpened', () => {
    const holder = skirmisher(['sharpenedSteel']);
    const target = armoured();
    expect(sharpenedSteelFor(holder, target, true, new Set(), { id: 'arcane_burst', damageType: 'magic' })).toBe(0);
  });
});

// ─── Fan of Blades node ───────────────────────────────────────────────────────

describe('the Signature node', () => {
  it('replaces Evasion in the centre of the first row', () => {
    expect(nodeOf('skirm_fan_of_blades')).toEqual(expect.objectContaining({ tier: 1, column: 2, grantsPassive: 'fanOfBlades' }));
    expect(nodeOf('skirm_evasion')).toBeUndefined();
  });
});

// ─── Smoke Bomb ───────────────────────────────────────────────────────────────

describe('Smoke Bomb', () => {
  it('drops a cloud that stays put, with a Dodge floor only while you stand in it, and no retreat', () => {
    useCombatStore.setState({ units: [skirmisher([], { skills: [smokeBomb] }), foe('a', 1, 0)] });
    const result = resolveSkillUse(unitNow('skirm'), smokeBomb, at(0, 0), SILENT_SINK);
    expect(result.ok).toBe(true);
    const caster = unitNow('skirm');
    expect(caster.position).toEqual(at(0, 0));
    const cover = caster.activeEffects.find((e) => e.type === AuraType.SmokeCover)!;
    expect(cover.zone).toHaveLength(7);
    expect(getCombatEffectiveStats(caster).dodgeChance).toBe(BALANCE.SMOKE_DODGE);
    // Out of the cloud, the cover is gone
    expect(getCombatEffectiveStats({ ...caster, position: at(-3, 0) }).dodgeChance ?? 0).toBeLessThan(BALANCE.SMOKE_DODGE);
    // The enemies caught in the drop hit softer
    expect(unitNow('a').activeEffects.some((e) => e.type === AfflictionType.AttackDown)).toBe(true);
  });

  it('is a floor, not an addition', () => {
    const cover = { type: AuraType.SmokeCover, magnitude: 1, duration: 3, zone: [at(0, 0)] };
    const nimble = skirmisher([], { stats: stats({ dodgeChance: 55 }), activeEffects: [cover] });
    expect(getCombatEffectiveStats(nimble).dodgeChance).toBe(55);
  });

  it('lasts 2 / 3 / 4 turns by rank', () => {
    const node = nodeOf('skirm_smoke')!;
    const turns = [1, 2, 3].map((level) =>
      skillEffects(nodeSkillAt(node, level)!).find((e) => e.type === AuraType.SmokeCover)!.duration);
    expect(turns).toEqual([2, 3, 4]);
  });
});
