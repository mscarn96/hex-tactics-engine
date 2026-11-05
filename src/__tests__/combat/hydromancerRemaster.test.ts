import { spyDice } from '../support/dice';
import { useCombatStore } from '@/stores/combatStore';
import { CombatSink, resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { arenaHexes, beamHexes } from '@/systems/combat/arenaGeometry';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { requireUnit } from '@/systems/combat/unitLookup';
import { isActionLocked, strikeScales } from '@/systems/combat/statusEffects';
import { applySkillStatus } from '@/systems/combat/combatEvents';
import { chargeStage } from '@/systems/combat/chargedCast';
import { canUseSkill } from '@/systems/combat/cooldowns';
import { nodeSkillAt } from '@/systems/progression/mastery';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { BALANCE } from '@/data/balanceConstants';
import { absoluteZero, frostbite, glacialBarrage } from '@/data/skills/masterySkills';
import { findMasteryNode } from '@/data/skills/masteryData';

import {
  AfflictionType, AuraType, CombatUnit, HeroStats, PassiveId, PassiveRank,
} from '@/models/types';
import { at, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * The Hydromancer remaster, as rules: Twin Fangs, Brittle, Glacial Barrage and
 * Absolute Zero. Numbers come from the definitions; what is pinned is the shape.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 300, attack: 10, magic: 30, defense: 0, magicDefense: 0, maxMana: 200,
    critChance: 0, dodgeChance: 0, speed: 10, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const RANKS: PassiveRank[] = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));

const hydro = (passives: PassiveId[] = [], level = 2, over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'hydro',
    position: at(0, 0),
    stats: stats(),
    currentMana: 200,
    skills: [frostbite],
    passives,
    passiveRanks: Object.fromEntries(passives.map((p) => [p, RANKS[level - 1]])),
    ...over,
  });

const foe = (over: Partial<CombatUnit> = {}) =>
  makeFoe({ id: 'foe', position: at(1, 0), stats: stats({ maxHp: 1000 }), ...over });

/** A sink that records every floating number, so separate hits can be counted. */
const recording = () => {
  const floats: string[] = [];
  const sink: CombatSink = { ...SILENT_SINK, float: (_at, text) => { floats.push(text); } };
  return { sink, floats };
};
const damageFloats = (floats: string[]) => floats.filter((f) => /^-\d+!?$/.test(f));

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  state().reset();
});

afterEach(() => jest.restoreAllMocks());

// ─── Twin Fangs ───────────────────────────────────────────────────────────────

describe('Twin Fangs', () => {
  it('makes Frostbite two strikes, the second scaled by rung', () => {
    expect(strikeScales(hydro(), frostbite)).toEqual([1]);
    const seconds = [1, 2, 3].map((level) => strikeScales(hydro(['twinFangs'], level), frostbite));
    seconds.forEach((s) => expect(s).toHaveLength(2));
    expect(seconds[1][1]).toBeCloseTo(BALANCE.TWIN_FANGS_SECOND_HIT);
    expect(seconds[0][1]).toBeLessThan(seconds[1][1]);
    expect(seconds[2][1]).toBeGreaterThan(seconds[1][1]);
  });

  it('touches no other skill', () => {
    const other = { ...frostbite, id: 'ignite' as const };
    expect(strikeScales(hydro(['twinFangs']), other)).toEqual([1]);
  });

  it('lands two separate hits and applies Chill once, after both', () => {
    const me = hydro(['twinFangs']);
    useCombatStore.setState({ units: [me, foe()] });
    const { sink, floats } = recording();
    resolveSkillUse(me, frostbite, at(1, 0), sink);
    expect(damageFloats(floats)).toHaveLength(2);
    const chills = unitNow('foe').activeEffects.filter((e) => e.type === AfflictionType.Chill);
    expect(chills).toHaveLength(1);
    // One Chill, not a Freeze: an unprepared target is not frozen by one cast
    expect(unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Freeze)).toBe(false);
  });

  it('rolls a critical hit for each fang on its own', () => {
    const me = hydro(['twinFangs'], 2, { stats: stats({ critChance: 50 }) });
    useCombatStore.setState({ units: [me, foe()] });
    // First fang's crit roll succeeds, the second's fails
    const rolls = [0.1, 0.9];
    spyDice().mockImplementation(() => rolls.shift() ?? 0.9);
    const { sink, floats } = recording();
    resolveSkillUse(me, frostbite, at(1, 0), sink);
    const hits = damageFloats(floats);
    expect(hits).toHaveLength(2);
    expect(hits[0].endsWith('!')).toBe(true);
    expect(hits[1].endsWith('!')).toBe(false);
  });

  it('spends an existing Freeze on the first fang only', () => {
    const me = hydro(['twinFangs', 'shatterstep']);
    const frozen = foe({ activeEffects: [{ type: AfflictionType.Freeze, magnitude: 1, duration: 2 }] });
    useCombatStore.setState({ units: [me, frozen] });
    // Every Shatterstep roll would succeed: one shatter must still be one extra action
    spyDice().mockReturnValue(0);
    const result = resolveSkillUse(me, frostbite, at(1, 0), SILENT_SINK);
    expect(result.ok && !result.endsTurn).toBe(true);
    expect(unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Freeze)).toBe(false);
  });
});

// ─── Brittle ──────────────────────────────────────────────────────────────────

describe('Brittle', () => {
  const bossTemplate = enemyTemplates.find((t) => t.tier === 'boss')!;
  const boss = (over: Partial<CombatUnit> = {}) => foe({ templateId: bossTemplate.id, ...over });
  const has = (id: string, type: AfflictionType) => unitNow(id).activeEffects.some((e) => e.type === type);
  const chillFrom = (casterId: string, target = 'foe') =>
    applySkillStatus(unitNow(casterId), target, {
      type: AfflictionType.Chill, magnitude: 3, duration: 3, sourceUnitId: casterId,
    }, SILENT_SINK);
  const plainHit = { ...frostbite, id: 'test_hit' as never, appliesEffect: undefined };

  it('turns the second Chill on a boss into one Brittle mark, spending the Chill', () => {
    useCombatStore.setState({ units: [hydro(), boss()] });
    chillFrom('hydro');
    expect(has('foe', AfflictionType.Chill)).toBe(true);
    const outcome = chillFrom('hydro');
    expect(outcome?.landed ?? AfflictionType.Brittle).toBe(AfflictionType.Brittle);
    expect(has('foe', AfflictionType.Brittle)).toBe(true);
    expect(has('foe', AfflictionType.Chill)).toBe(false);
    expect(has('foe', AfflictionType.Freeze)).toBe(false);
  });

  it('disables nothing: the boss can still act', () => {
    useCombatStore.setState({ units: [hydro(), boss()] });
    chillFrom('hydro');
    chillFrom('hydro');
    expect(isActionLocked(unitNow('foe'))).toBe(false);
  });

  it("sizes its burst from the creator's Magic, and the next hit consumes it once", () => {
    useCombatStore.setState({ units: [hydro(), boss()] });
    chillFrom('hydro');
    chillFrom('hydro');
    const mark = unitNow('foe').activeEffects.find((e) => e.type === AfflictionType.Brittle)!;
    expect(mark.magnitude).toBe(Math.round(getCombatEffectiveStats(unitNow('hydro')).magic * BALANCE.BRITTLE_BURST_MAGIC));

    const before = unitNow('foe').currentHp;
    resolveSkillUse(unitNow('hydro'), plainHit, at(1, 0), SILENT_SINK);
    const cracked = before - unitNow('foe').currentHp;
    expect(has('foe', AfflictionType.Brittle)).toBe(false);

    const again = unitNow('foe').currentHp;
    resolveSkillUse(unitNow('hydro'), plainHit, at(1, 0), SILENT_SINK);
    expect(cracked - (again - unitNow('foe').currentHp)).toBe(mark.magnitude);
  });

  it('refreshes rather than stacks, and grants Meltwater only on first creation', () => {
    const ally = makeUnit({ id: 'ally', position: at(0, 1), stats: stats({ maxHp: 100 }), currentHp: 30 });
    useCombatStore.setState({ units: [hydro(['meltwater']), ally, boss()] });
    chillFrom('hydro');
    chillFrom('hydro');
    const barrier = () => unitNow('ally').activeEffects.find((e) => e.type === AuraType.Barrier);
    expect(barrier()).toBeDefined();
    // Clear the shield and the once-a-turn key, then rebuild onto the standing mark
    useCombatStore.setState({
      units: state().units.map((u) => u.id === 'ally' ? { ...u, activeEffects: [] } : u),
      spentThisTurn: { serial: 0, keys: [] },
    });
    chillFrom('hydro');
    chillFrom('hydro');
    expect(unitNow('foe').activeEffects.filter((e) => e.type === AfflictionType.Brittle)).toHaveLength(1);
    expect(barrier()).toBeUndefined();
  });

  it('counts as a shatter for Shatterpoint', () => {
    const run = (passives: PassiveId[]) => {
      state().reset();
      useCombatStore.setState({ units: [hydro(passives), boss()] });
      chillFrom('hydro');
      chillFrom('hydro');
      const before = unitNow('foe').currentHp;
      resolveSkillUse(unitNow('hydro'), plainHit, at(1, 0), SILENT_SINK);
      return before - unitNow('foe').currentHp;
    };
    expect(run(['shatterpoint'])).toBeGreaterThan(run([]));
  });

  it('leaves ordinary enemies freezing as before', () => {
    useCombatStore.setState({ units: [hydro(), foe()] });
    chillFrom('hydro');
    chillFrom('hydro');
    expect(has('foe', AfflictionType.Freeze)).toBe(true);
    expect(has('foe', AfflictionType.Brittle)).toBe(false);
  });

  it('is not made by a Chill from the enemy side', () => {
    const other = makeFoe({ id: 'other', position: at(-1, 0), stats: stats() });
    useCombatStore.setState({ units: [other, boss()] });
    chillFrom('other');
    chillFrom('other');
    expect(has('foe', AfflictionType.Brittle)).toBe(false);
  });
});

// ─── Glacial Barrage ──────────────────────────────────────────────────────────

describe('Glacial Barrage', () => {
  const node = () => findMasteryNode('hydro_glacial_barrage')!.node;

  it('fires 5 / 6 / 7 shards by rung without also scaling the damage per shard', () => {
    const ranks = [1, 2, 3].map((level) => nodeSkillAt(node(), level)!);
    expect(ranks.map((s) => s.barrage)).toEqual([5, 6, 7]);
    expect(new Set(ranks.map((s) => s.damage)).size).toBe(1);
  });

  it('lands every shard on one enemy as separate hits with separate crit rolls', () => {
    const me = hydro([], 2, { stats: stats({ critChance: 50 }), skills: [glacialBarrage] });
    useCombatStore.setState({ units: [me, foe({ stats: stats({ maxHp: 5000 }) })] });
    const rolls = [0.1, 0.9, 0.1, 0.9, 0.1, 0.9];
    spyDice().mockImplementation(() => rolls.shift() ?? 0.9);
    const { sink, floats } = recording();
    resolveSkillUse(me, glacialBarrage, at(1, 0), sink);
    const hits = damageFloats(floats);
    expect(hits).toHaveLength(glacialBarrage.barrage!);
    expect(hits.filter((h) => h.endsWith('!'))).toHaveLength(3);
  });

  it('sends the rest to the nearest enemy in range when the target dies', () => {
    const me = hydro([], 2, { skills: [glacialBarrage] });
    const weak = foe({ id: 'weak', position: at(1, 0), currentHp: 1, stats: stats({ maxHp: 1 }) });
    const near = foe({ id: 'near', position: at(2, 0), currentHp: 1, stats: stats({ maxHp: 1 }) });
    const far = foe({ id: 'far', position: at(3, -3), stats: stats({ maxHp: 5000 }) });
    const away = foe({ id: 'away', position: at(-3, 5), stats: stats({ maxHp: 5000 }) });
    useCombatStore.setState({ units: [me, weak, near, far, away] });
    const { sink, floats } = recording();
    resolveSkillUse(me, glacialBarrage, at(1, 0), sink);
    expect(unitNow('weak').currentHp).toBe(0);
    expect(unitNow('near').currentHp).toBe(0);
    expect(unitNow('far').currentHp).toBeLessThan(5000);
    // Out of range: never touched, and the supply is not grown for it
    expect(unitNow('away').currentHp).toBe(5000);
    expect(damageFloats(floats)).toHaveLength(6);
  });

  it('stops when nothing is left in range', () => {
    const me = hydro([], 2, { skills: [glacialBarrage] });
    useCombatStore.setState({ units: [me, foe({ currentHp: 1, stats: stats({ maxHp: 1 }) })] });
    const { sink, floats } = recording();
    expect(resolveSkillUse(me, glacialBarrage, at(1, 0), sink).ok).toBe(true);
    expect(damageFloats(floats)).toHaveLength(1);
  });

  it("breaks a boss's Brittle mark on the first shard only", () => {
    const bossTemplate = enemyTemplates.find((t) => t.tier === 'boss')!;
    const me = hydro([], 2, { skills: [glacialBarrage] });
    const boss = foe({
      templateId: bossTemplate.id, stats: stats({ maxHp: 5000 }),
      activeEffects: [{ type: AfflictionType.Brittle, magnitude: 50, duration: 3 }],
    });
    useCombatStore.setState({ units: [me, boss] });
    const { sink, floats } = recording();
    resolveSkillUse(me, glacialBarrage, at(1, 0), sink);
    expect(unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Brittle)).toBe(false);
    const dealt = damageFloats(floats).reduce((sum, h) => sum + Number(h.replace(/[-!]/g, '')), 0);
    expect(5000 - unitNow('foe').currentHp - dealt).toBe(50);
  });
});

// ─── Absolute Zero ────────────────────────────────────────────────────────────

describe('Absolute Zero', () => {
  const charging = () => unitNow('hydro').activeEffects.find((e) => e.type === AuraType.Charging);
  /** The start of the Hydromancer's next regular turn, as far as the charge is concerned. */
  const nextTurn = () => state().tickEffectsOnUnit('hydro');
  const setup = (extra: CombatUnit[] = []) =>
    useCombatStore.setState({ units: [hydro([], 2, { skills: [absoluteZero] }), ...extra] });
  const charge = () => resolveSkillUse(unitNow('hydro'), absoluteZero, at(0, 0), SILENT_SINK);

  it('charges on the first use, paying the mana once and starting no cooldown', () => {
    setup([foe({ position: at(2, 0) })]);
    const before = unitNow('hydro').currentMana;
    expect(charge().ok).toBe(true);
    expect(charging()).toBeDefined();
    expect(unitNow('hydro').currentMana).toBe(before - absoluteZero.manaCost);
    expect(unitNow('hydro').cooldowns?.absolute_zero ?? 0).toBe(0);
  });

  it('cannot fire on the turn it was charged, a bonus turn included', () => {
    setup([foe({ position: at(2, 0) })]);
    charge();
    const stage = chargeStage(unitNow('hydro'), absoluteZero);
    expect(stage.releasing).toBe(true);
    expect(stage.chargePending).toBe(true);
    expect(canUseSkill(unitNow('hydro'), stage)).toBe(false);
    expect(resolveSkillUse(unitNow('hydro'), absoluteZero, at(2, 0), SILENT_SINK).ok).toBe(false);
  });

  it('fires next turn: three hits on every enemy in a three-wide band, free, then cools down', () => {
    const inBeam = [
      foe({ id: 'a', position: at(2, 0) }),
      foe({ id: 'b', position: at(3, -1) }),
      foe({ id: 'c', position: at(3, 0) }),
    ];
    setup([...inBeam, foe({ id: 'aside', position: at(0, 3) })]);
    charge();
    nextTurn();
    const mana = unitNow('hydro').currentMana;
    const { sink, floats } = recording();
    expect(resolveSkillUse(unitNow('hydro'), absoluteZero, at(3, 0), sink).ok).toBe(true);
    expect(damageFloats(floats)).toHaveLength(9);
    for (const f of inBeam) expect(unitNow(f.id).currentHp).toBeLessThan(1000);
    expect(unitNow('aside').currentHp).toBe(1000);
    expect(unitNow('hydro').currentMana).toBe(mana);
    expect(charging()).toBeUndefined();
    expect(unitNow('hydro').cooldowns?.absolute_zero).toBeGreaterThan(0);
  });

  it('fizzles if it is not fired on the next turn', () => {
    setup();
    charge();
    nextTurn();
    expect(charging()).toBeDefined();
    nextTurn();
    expect(charging()).toBeUndefined();
  });

  it.each([AfflictionType.Stun, AfflictionType.Silence, AfflictionType.Taunt])(
    'is broken by %s on the Hydromancer', (type) => {
      setup([makeFoe({ id: 'enemy', position: at(2, 0), stats: stats() })]);
      charge();
      applySkillStatus(unitNow('enemy'), 'hydro', { type, magnitude: 1, duration: 2, sourceUnitId: 'enemy' }, SILENT_SINK);
      expect(charging()).toBeUndefined();
    },
  );

  it('is not broken by Root or Chill', () => {
    setup([makeFoe({ id: 'enemy', position: at(2, 0), stats: stats() })]);
    charge();
    for (const type of [AfflictionType.Root, AfflictionType.Chill]) {
      applySkillStatus(unitNow('enemy'), 'hydro', { type, magnitude: 1, duration: 2, sourceUnitId: 'enemy' }, SILENT_SINK);
    }
    expect(charging()).toBeDefined();
  });

  it('draws its band three hexes wide, from beside the caster to the arena edge', () => {
    const keys = new Set(beamHexes(at(0, 0), at(3, 0)).map((h) => `${h.q},${h.r}`));
    expect(keys.has('0,0')).toBe(false);
    for (let q = 1; q <= 3; q++) expect(keys.has(`${q},0`)).toBe(true);
    for (const k of keys) expect(Math.abs(Number(k.split(',')[1]))).toBeLessThanOrEqual(1);
    const arena = new Set(arenaHexes().map((h) => `${h.q},${h.r}`));
    for (const k of keys) expect(arena.has(k)).toBe(true);
  });

  // Playtest 2026-10-14: from a corner the six-axis snap left only wall-hugging or
  // 30°-off beams, so Absolute Zero could not be pointed at what the player wanted.
  it('goes where it is aimed, from a corner as from the middle', () => {
    const missed: string[] = [];
    for (const caster of [at(0, 5), at(-3, 5), at(3, -5), at(0, 0)]) {
      for (const aim of arenaHexes()) {
        if (aim.q === caster.q && aim.r === caster.r) continue;
        if (!beamHexes(caster, aim).some((h) => h.q === aim.q && h.r === aim.r)) missed.push(`${caster.q},${caster.r}→${aim.q},${aim.r}`);
      }
    }
    expect(missed).toEqual([]);
  });

  it('offers many more than six distinct beams from a corner', () => {
    const corner = at(0, 5);
    const footprints = new Set(arenaHexes()
      .filter((h) => !(h.q === corner.q && h.r === corner.r))
      .map((aim) => beamHexes(corner, aim).map((h) => `${h.q},${h.r}`).sort().join('|')));
    expect(footprints.size).toBeGreaterThan(12);
  });
});
