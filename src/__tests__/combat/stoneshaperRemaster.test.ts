import { spyDice } from '../support/dice';
import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { beginTurn } from '@/systems/combat/turnStart';
import { arenaHexes, inArena } from '@/systems/combat/arenaGeometry';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { getSkillRangeHexes, getSkillTargets, getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { requireUnit } from '@/systems/combat/unitLookup';
import { skillBlockedReason } from '@/systems/combat/skillAvailability';
import { aftershockId } from '@/systems/combat/aftershock';
import { PASSIVE_DEFS } from '@/systems/combat/passives';
import { aftershockMultiplier, crumbleShred, rubbleRecoveryMultiplier } from '@/systems/combat/passiveFormulas';
import { applyMasteryModifiers } from '@/systems/progression/mastery';
import {
  bedrockStand, graspingEarth, livingStone, stoneHeart, stoneskin, tremor,
} from '@/data/skills/mastery/druid';
import { findMasteryNode, MASTERY_PATHS } from '@/data/skills/masteryData';
import { describeSkill } from '@/data/display/skillDisplay';
import { BALANCE } from '@/data/balanceConstants';
import { hexDistance } from '@/utils/hexUtils';
import {
  AfflictionType, AuraType, CombatUnit, HeroSkill, HeroStats, HexCoord, PassiveId, PassiveRank,
} from '@/models/types';
import { at, makeEffect, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * The Stoneshaper remaster, as rules: the reworked first row, Crumble's
 * control-bound shred, Aftershock's repeat eruption, Rubble Recovery's heal on a
 * broken Barrier, the doubled Stoneskin Barrier, Stone Heart's paid
 * cooldown-free stages and living-elemental lock, arena-wide Bedrock Stand and
 * Living Stone's impact-timed shove. Numbers come from the definitions.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 300, attack: 10, magic: 40, defense: 10, magicDefense: 10, maxMana: 300,
    critChance: 0, dodgeChance: 0, speed: 10, moveRange: 2, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const RANKS: PassiveRank[] = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));
const key = (h: HexCoord) => `${h.q},${h.r}`;

const shaper = (passives: PassiveId[] = [], level = 2, over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'shaper',
    heroId: 'h1',
    position: at(0, 0),
    stats: stats(),
    skills: [tremor, graspingEarth, stoneskin, stoneHeart, livingStone, bedrockStand],
    passives,
    passiveRanks: Object.fromEntries(passives.map((p) => [p, RANKS[level - 1]])),
    ...over,
  });

const foe = (over: Partial<CombatUnit> = {}) =>
  makeFoe({ id: 'foe', position: at(1, 0), stats: stats({ maxHp: 2000, defense: 20, magicDefense: 20 }), ...over });

const has = (id: string, type: AfflictionType | AuraType) => unitNow(id).activeEffects.some((e) => e.type === type);

const withRandom = <T,>(value: number, run: () => T): T => {
  const spy = spyDice().mockReturnValue(value);
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
};

beforeEach(() => {
  resetFixtureIds();
  state().reset();
});

// ─── The tree ─────────────────────────────────────────────────────────────────

describe('the Stoneshaper first row', () => {
  const path = MASTERY_PATHS.find((p) => p.id === 'stoneshaper')!;
  const row = path.nodes.filter((n) => n.tier === 1 && n.column <= 4).sort((a, b) => a.column - b.column);

  it('keeps five nodes: Aegis, Deep Roots, Aftershock in the centre, Rubble Recovery, Crumble', () => {
    expect(row.map((n) => n.id)).toEqual([
      'stone_aegis', 'stone_deep_roots', 'stone_aftershock', 'stone_rubble_recovery', 'stone_crumble',
    ]);
  });

  it('drops Patient Earth, Living Rock and Stonecutter', () => {
    for (const id of ['stone_patient_earth', 'stone_living_rock', 'stone_stonecutter']) {
      expect(findMasteryNode(id)).toBeUndefined();
    }
  });

  it('keeps Aegis as the outgoing-Barrier modifier', () => {
    expect(findMasteryNode('stone_aegis')!.node.modifier).toEqual({ shieldPowerBonus: 0.2 });
  });

  it('grants the three new passives, each stronger at every rung', () => {
    expect(findMasteryNode('stone_aftershock')!.node.grantsPassive).toBe('aftershock');
    expect(findMasteryNode('stone_rubble_recovery')!.node.grantsPassive).toBe('rubbleRecovery');
    expect(findMasteryNode('stone_crumble')!.node.grantsPassive).toBe('crumble');
    for (const ladder of [crumbleShred, aftershockMultiplier, rubbleRecoveryMultiplier]) {
      const v = RANKS.map((r) => ladder(r));
      expect(v[1]).toBeGreaterThan(v[0]);
      expect(v[2]).toBeGreaterThan(v[1]);
    }
    expect(RANKS.map(crumbleShred)).toEqual([5, 6, 7]);
  });
});

// ─── Crumble ─────────────────────────────────────────────────────────────────

describe('Crumble strips both defences while the Stoneshaper\'s control stands', () => {
  const rootFoe = (me: CombatUnit) => {
    useCombatStore.setState({ units: [me, foe()] });
    expect(resolveSkillUse(me, graspingEarth, at(1, 0), SILENT_SINK).ok).toBe(true);
    expect(has('foe', AfflictionType.Root)).toBe(true);
  };
  const defences = () => {
    const s = getCombatEffectiveStats(unitNow('foe'));
    return { defense: s.defense, magicDefense: s.magicDefense! };
  };

  it.each([1, 2, 3])('takes the rung\'s amount off Physical and Magic Defense at level %i', (level) => {
    rootFoe(shaper(['crumble'], level));
    const shred = crumbleShred(RANKS[level - 1]);
    expect(defences()).toEqual({ defense: 20 - shred, magicDefense: 20 - shred });
  });

  it('does nothing without the node', () => {
    rootFoe(shaper());
    expect(defences()).toEqual({ defense: 20, magicDefense: 20 });
  });

  it('ends the moment the control is removed, cleansed or runs out', () => {
    rootFoe(shaper(['crumble']));
    state().removeEffect('foe', AfflictionType.Root);
    expect(defences().defense).toBe(20);

    state().reset();
    rootFoe(shaper(['crumble']));
    state().removeAllAfflictions('foe');
    expect(defences().defense).toBe(20);

    state().reset();
    rootFoe(shaper(['crumble']));
    for (let i = 0; i < 4 && has('foe', AfflictionType.Root); i++) {
      expect(defences().defense).toBeLessThan(20);
      state().tickEffectsOnUnit('foe');
    }
    expect(has('foe', AfflictionType.Root)).toBe(false);
    expect(defences().defense).toBe(20);
  });

  it('strips once when the Stoneshaper\'s Stun and Root overlap', () => {
    rootFoe(shaper(['crumble']));
    state().applyEffect('foe', { type: AfflictionType.Stun, magnitude: 1, duration: 1, sourceUnitId: 'shaper' });
    expect(has('foe', AfflictionType.Stun)).toBe(true);
    expect(defences().defense).toBe(20 - crumbleShred(RANKS[1]));
  });

  it('lands no shred when the control is refused', () => {
    const me = shaper(['crumble']);
    useCombatStore.setState({
      units: [me, foe({ activeEffects: [makeEffect(AuraType.DebuffImmunity, { duration: 3 })] })],
    });
    resolveSkillUse(me, graspingEarth, at(1, 0), SILENT_SINK);
    expect(has('foe', AfflictionType.Root)).toBe(false);
    expect(defences().defense).toBe(20);
  });

  it('reads only the Stoneshaper\'s own control, not an ally\'s', () => {
    const me = shaper(['crumble']);
    const friend = makeUnit({ id: 'friend', position: at(-1, 0), stats: stats() });
    useCombatStore.setState({ units: [me, friend, foe()] });
    state().applyEffect('foe', { type: AfflictionType.Root, magnitude: 1, duration: 2, sourceUnitId: 'friend' });
    expect(defences().defense).toBe(20);
  });

  it('needs no earth hit: a Stun from Tremor alone carries it', () => {
    const me = shaper(['crumble']);
    useCombatStore.setState({ units: [me, foe()] });
    withRandom(0, () => resolveSkillUse(me, tremor, at(1, 0), SILENT_SINK));
    expect(has('foe', AfflictionType.Stun)).toBe(true);
    expect(defences().defense).toBe(20 - crumbleShred(RANKS[1]));
  });
});

// ─── Aftershock ───────────────────────────────────────────────────────────────

describe('Aftershock erupts Tremor\'s ground again at the start of the next turn', () => {
  const setup = (passives: PassiveId[] = ['aftershock'], level = 2) => {
    state().initCombat([shaper(passives, level)], [foe()]);
    // No Stun from the cast, so the eruption's own (lack of) Stun is what is read
    return withRandom(0.99, () => resolveSkillUse(unitNow('shaper'), tremor, at(1, 0), SILENT_SINK));
  };
  const mark = () => state().hazards.find((h) => h.id === aftershockId('shaper'));

  it('marks exactly Tremor\'s footprint, inside the arena', () => {
    expect(setup().ok).toBe(true);
    const footprint = getSkillTargets(tremor, at(0, 0), at(1, 0), state().units).filter(inArena).map(key).sort();
    expect(mark()!.hexes.map(key).sort()).toEqual(footprint);
  });

  it('marks nothing without the node', () => {
    setup([]);
    expect(mark()).toBeUndefined();
  });

  it('hits an enemy still standing there for the rung\'s share of Magic, and never Stuns', () => {
    setup();
    const hp = unitNow('foe').currentHp;
    withRandom(0, () => beginTurn('shaper', SILENT_SINK));
    expect(unitNow('foe').currentHp).toBeLessThan(hp);
    expect(has('foe', AfflictionType.Stun)).toBe(false);
    // Spent: there is no second eruption
    expect(mark()).toBeUndefined();
    const after = unitNow('foe').currentHp;
    beginTurn('shaper', SILENT_SINK);
    expect(unitNow('foe').currentHp).toBe(after);
  });

  it('scales with the rung', () => {
    const lost = (level: number) => {
      state().reset();
      setup(['aftershock'], level);
      const hp = unitNow('foe').currentHp;
      beginTurn('shaper', SILENT_SINK);
      return hp - unitNow('foe').currentHp;
    };
    const [a, b, c] = [1, 2, 3].map(lost);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('spares an enemy that walked off the marked ground', () => {
    setup();
    const away = arenaHexes().find((h) => !mark()!.hexes.some((m) => key(m) === key(h)) && hexDistance(h, at(0, 0)) > 3)!;
    state().moveUnit('foe', away);
    const hp = unitNow('foe').currentHp;
    beginTurn('shaper', SILENT_SINK);
    expect(unitNow('foe').currentHp).toBe(hp);
  });

  it('goes with the Stoneshaper if it dies first', () => {
    setup();
    state().damageUnit('shaper', 99999);
    state().tickHazards('foe');
    expect(mark()).toBeUndefined();
  });
});

// ─── Rubble Recovery ──────────────────────────────────────────────────────────

describe('Rubble Recovery heals an ally whose Stoneshaper Barrier an enemy breaks', () => {
  const setup = (passives: PassiveId[] = ['rubbleRecovery']) => {
    const ally = makeUnit({ id: 'ally', position: at(-1, 0), stats: stats(), currentHp: 100 });
    state().initCombat([shaper(passives), ally], [foe()]);
    expect(resolveSkillUse(unitNow('shaper'), stoneskin, at(-1, 0), SILENT_SINK).ok).toBe(true);
    return unitNow('ally').activeEffects.find((e) => e.type === AuraType.Barrier)!.magnitude;
  };
  const heal = () => Math.round(getCombatEffectiveStats(unitNow('shaper')).magic * rubbleRecoveryMultiplier(RANKS[1]));

  it('heals the recipient when an enemy blow empties the Barrier', () => {
    const shield = setup();
    state().damageUnit('ally', shield + 10, 'foe');
    expect(unitNow('ally').currentHp).toBe(100 - 10 + heal());
  });

  it('does nothing for a Barrier that holds, or without the node', () => {
    const shield = setup();
    state().damageUnit('ally', shield - 1, 'foe');
    expect(unitNow('ally').currentHp).toBe(100);

    state().reset();
    const plain = setup([]);
    state().damageUnit('ally', plain + 10, 'foe');
    expect(unitNow('ally').currentHp).toBe(90);
  });

  it('needs an enemy: damage with no hostile author does not count', () => {
    const shield = setup();
    state().damageUnit('ally', shield + 10);
    expect(unitNow('ally').currentHp).toBe(90);
  });

  it('heals each ally once per Stoneshaper turn', () => {
    const shield = setup();
    state().damageUnit('ally', shield + 10, 'foe');
    const once = unitNow('ally').currentHp;
    state().applyEffect('ally', { type: AuraType.Barrier, magnitude: shield, duration: 3, sourceUnitId: 'shaper' });
    state().damageUnit('ally', shield + 10, 'foe');
    expect(unitNow('ally').currentHp).toBe(once - 10);

    beginTurn('shaper', SILENT_SINK);
    state().applyEffect('ally', { type: AuraType.Barrier, magnitude: shield, duration: 3, sourceUnitId: 'shaper' });
    state().damageUnit('ally', shield + 10, 'foe');
    expect(unitNow('ally').currentHp).toBe(once - 20 + heal());
  });

  it('ignores a Barrier somebody else gave', () => {
    setup();
    state().removeEffect('ally', AuraType.Barrier);
    state().applyEffect('ally', { type: AuraType.Barrier, magnitude: 20, duration: 3, sourceUnitId: 'ally' });
    state().damageUnit('ally', 30, 'foe');
    expect(unitNow('ally').currentHp).toBe(90);
  });
});

// ─── Stoneskin ────────────────────────────────────────────────────────────────

describe('Stoneskin doubles only its Barrier', () => {
  it('lays twice the old Barrier and the same Defense buff and durations', () => {
    expect(BALANCE.STONESKIN_BARRIER).toBeCloseTo(0.7);
    const effects = stoneskin.appliesEffect as { type: AuraType; magnitude: number; duration: number }[];
    expect(effects.find((e) => e.type === AuraType.DefenseBuff)).toMatchObject({ magnitude: 8, duration: 4 });
    expect(effects.find((e) => e.type === AuraType.Barrier)!.duration).toBe(3);

    const barrierFrom = (skill: HeroSkill) => {
      state().reset();
      const me = shaper();
      useCombatStore.setState({ units: [me] });
      resolveSkillUse(me, skill, me.position, SILENT_SINK);
      return unitNow('shaper').activeEffects.find((e) => e.type === AuraType.Barrier)!.magnitude;
    };
    const old: HeroSkill = {
      ...stoneskin,
      appliesEffect: effects.map((e) => (e.type === AuraType.Barrier ? { ...e, magnitude: 0.35 } : e)),
    };
    expect(barrierFrom(stoneskin)).toBe(2 * barrierFrom(old));
  });
});

// ─── Stone Heart ──────────────────────────────────────────────────────────────

describe('Stone Heart builds over three paid casts and locks while its elemental lives', () => {
  const setup = () => state().initCombat([shaper([], 2, { position: at(0, 2) })], [foe({ position: at(0, -3) })]);
  const cast = (target: HexCoord) => resolveSkillUse(unitNow('shaper'), stoneHeart, target, SILENT_SINK);
  const elemental = () => state().units.find((u) => u.summonedBy === 'shaper' && u.currentHp > 0);

  it('has no cooldown between stages, and every stage is paid', () => {
    setup();
    expect(stoneHeart.cooldown ?? 0).toBe(0);
    const mana = unitNow('shaper').currentMana;
    for (let i = 0; i < 3; i++) expect(cast(at(0, 1)).ok).toBe(true);
    expect(elemental()!.templateId).toBe('stone_elemental');
    expect(unitNow('shaper').currentMana).toBe(mana - 3 * stoneHeart.manaCost);
  });

  it('is blocked while the Stone Elemental stands and free once it falls', () => {
    setup();
    for (let i = 0; i < 3; i++) cast(at(0, 1));
    const me = unitNow('shaper');
    expect(getValidSkillTargetHexes(stoneHeart, me, state().units)).toEqual([]);
    expect(skillBlockedReason(stoneHeart, me, state().units)).toMatch(/still stands/);
    expect(cast(at(1, 1)).ok).toBe(false);

    state().damageUnit(elemental()!.id, 99999);
    expect(skillBlockedReason(stoneHeart, unitNow('shaper'), state().units)).toBeNull();
    expect(getValidSkillTargetHexes(stoneHeart, unitNow('shaper'), state().units).length).toBeGreaterThan(0);
    expect(cast(at(1, 1)).ok).toBe(true);
  });

  it('starts a fresh stone when a half-built one is broken', () => {
    setup();
    cast(at(0, 1));
    cast(at(0, 1));
    state().damageUnit(elemental()!.id, 99999);
    expect(cast(at(1, 1)).ok).toBe(true);
    expect(elemental()!.templateId).toBe('stone_heart_rock');
  });
});

// ─── Bedrock Stand ────────────────────────────────────────────────────────────

describe('Bedrock Stand reaches the whole arena', () => {
  const corner = (from: HexCoord) =>
    [...arenaHexes()].sort((a, b) => hexDistance(b, from) - hexDistance(a, from))[0];

  it.each([
    ['the centre', at(0, 0)],
    ['an edge', [...arenaHexes()].sort((a, b) => a.r - b.r || a.q - b.q)[0]],
  ])('damages and breaks every enemy, and shields every ally and itself, from %s', (_where, from) => {
    const me = shaper([], 2, { position: from });
    const ally = makeUnit({ id: 'ally', position: arenaHexes().find((h) => hexDistance(h, from) >= 3 && key(h) !== key(corner(from)))!, stats: stats() });
    const far = foe({ id: 'far', position: corner(from) });
    const near = foe({ id: 'near', position: arenaHexes().find((h) => hexDistance(h, from) === 1)! });
    useCombatStore.setState({ units: [me, ally, far, near] });

    expect(resolveSkillUse(me, bedrockStand, from, SILENT_SINK).ok).toBe(true);
    for (const id of ['far', 'near']) {
      expect(unitNow(id).currentHp).toBeLessThan(2000);
      expect(has(id, AfflictionType.DefenseDown)).toBe(true);
      expect(has(id, AuraType.Barrier)).toBe(false);
    }
    for (const id of ['shaper', 'ally']) {
      expect(has(id, AuraType.Barrier)).toBe(true);
      expect(unitNow(id).currentHp).toBe(300);
    }
  });

  it('frames bodies only, inside the arena, and previews the playable arena', () => {
    const me = shaper();
    const units = [me, makeUnit({ id: 'ally', position: at(-1, 2), stats: stats() }), foe({ position: at(2, -3) })];
    const footprint = getSkillTargets(bedrockStand, me.position, me.position, units).map(key).sort();
    expect(footprint).toEqual(units.map((u) => key(u.position)).sort());
    for (const h of getSkillRangeHexes(bedrockStand, me)) expect(inArena(h)).toBe(true);
    expect(getValidSkillTargetHexes(bedrockStand, me, units)).toEqual([me.position]);
    expect(getValidSkillTargetHexes(bedrockStand, me, [me])).toEqual([]);
  });

  it('is not widened or narrowed by range and radius modifiers', () => {
    const modded = applyMasteryModifiers(bedrockStand, { skillRangeBonus: 1, aoeRadiusBonus: 1 });
    expect(modded.arenaWide).toBe(true);
    expect(bedrockStand.aoeRadius).toBeUndefined();
    expect(describeSkill(bedrockStand, shaper())).toMatch(/every enemy in the arena/);
  });
});

// ─── Living Stone ─────────────────────────────────────────────────────────────

describe('Living Stone', () => {
  it('keeps its damage, area and push, and is drawn as the upheaval', () => {
    expect(livingStone).toMatchObject({ damage: 1.4, aoeRadius: 2, pushDistance: 2, scaling: 'magic', vfxKind: 'upheaval' });
  });

  it('throws the pushed bodies on its impact beat', () => {
    const me = shaper();
    useCombatStore.setState({ units: [me, foe({ position: at(0, -2) })] });
    expect(resolveSkillUse(me, livingStone, at(0, -2), SILENT_SINK).ok).toBe(true);
    const pushed = unitNow('foe');
    expect(hexDistance(pushed.position, at(0, 0))).toBeGreaterThan(2);
    expect(pushed.movement?.shoveDelayMs).toBeGreaterThan(0);
  });
});

describe('the passive panel', () => {
  it('states different figures at every rung', () => {
    for (const id of ['crumble', 'aftershock', 'rubbleRecovery'] as const) {
      const def = PASSIVE_DEFS[id];
      expect(def.figures!(RANKS[0]).join(' ')).not.toBe(def.figures!(RANKS[2]).join(' '));
    }
  });
});
