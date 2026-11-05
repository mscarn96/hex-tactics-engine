import { spyDice } from '../support/dice';
import { at, makeFoe, makeHero, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';
import { BALANCE } from '@/data/balanceConstants';
import { findMasteryPath } from '@/data/skills/masteryData';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { MASTERY_STARTER_WEAPONS } from '@/data/items/itemTemplates';
import { nodeSimpleText } from '@/data/display/simpleText';
import { useCombatStore } from '@/stores/combatStore';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { applyOnMove, applyOnTurnStart } from '@/systems/combat/combatEvents';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { traceForcedMove } from '@/systems/combat/forcedMovement';
import { getMovementRange } from '@/systems/combat/movement';
import { isImmuneTo, isImmuneToPush, PASSIVE_DEFS } from '@/systems/combat/passives';
import { reapersBreathChi, reapingStrideStep, searingLightShred, shellWardBarrier, spilledLightShare } from '@/systems/combat/passiveFormulas';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { carapaceMax, returnedBlow } from '@/systems/combat/beetle';
import { moteHeal, moteSpec } from '@/systems/combat/fireflyRules';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { playerUnitFor } from '@/systems/combat/unitFactory';
import { requireUnit } from '@/systems/combat/unitLookup';
import { itemFromTemplateId } from '@/systems/economy/itemFactory';
import { hexDistance } from '@/utils/hexUtils';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import {
  advancedNodes, canUnlockNode, deriveHeroSkills, isAdvancedNode, pointsEarnedByLevel, prerequisitesFor,
} from '@/systems/progression/mastery';
import {
  AfflictionType, AuraType, CombatUnit, HeroSkill, Hero, HeroClass, HexCoord, MasteryId, MasteryNode, SkillId, SkillTargetType,
} from '@/models/types';

/**
 * The Monk's level-21–25 advanced nodes (`docs/quests-progression-items.md`,
 * "Advanced nodes", Monk): Beetle protection, Firefly hybrid utility, Mantis bounded
 * combo movement. Each path is bought as a legal 20-point build toward every one of
 * its capstones through `canUnlockNode`, fielded through `playerUnitFor`, and each
 * new rule is pinned through the code that runs it in a fight. Numbers come from
 * `BALANCE.MONK_ADVANCED` and the formulas, never literals.
 */

const template = heroTemplates.find((t) => t.id === 'monk')!;
const LEVEL = 25;
const state = () => useCombatStore.getState();
const unit = (id: string) => requireUnit(state().units, id);

function ancestry(pathId: MasteryId, node: MasteryNode, seen = new Map<string, MasteryNode>()): MasteryNode[] {
  const path = findMasteryPath(pathId)!;
  for (const parent of prerequisitesFor(path, node)) {
    if (seen.has(parent.id)) continue;
    seen.set(parent.id, parent);
    ancestry(pathId, parent, seen);
  }
  return [...seen.values()].sort((a, b) => a.tier - b.tier || a.column - b.column);
}

/**
 * A level-25 Monk who buys, one point at a time and each one allowed by
 * `canUnlockNode`: the cheapest line to `capstoneId`, the capstone, `advanced`
 * at the ranks given, and then whatever is still open below the advanced row
 * until every point is spent.
 */
function legalBuild(
  pathId: MasteryId, capstoneId: string, advanced: Record<string, number>,
  { level = LEVEL, fill = true }: { level?: number; fill?: boolean } = {},
): Hero {
  const path = findMasteryPath(pathId)!;
  let hero = makeHero({
    id: `h-${pathId}`, templateId: 'monk', heroClass: HeroClass.Monk, level, masteryPath: pathId,
    masteryNodes: {}, masteryPoints: pointsEarnedByLevel(level, pathId),
    baseStats: calculateStatsForLevel(template, level),
  });
  const buy = (id: string) => {
    expect({ id, check: canUnlockNode(hero, id) }).toEqual({ id, check: { ok: true } });
    hero = {
      ...hero,
      masteryPoints: hero.masteryPoints - 1,
      masteryNodes: { ...hero.masteryNodes, [id]: (hero.masteryNodes[id] ?? 0) + 1 },
    };
  };
  const capstone = path.nodes.find((n) => n.id === capstoneId)!;
  for (const n of ancestry(pathId, capstone)) buy(n.id);
  buy(capstoneId);
  for (const [id, ranks] of Object.entries(advanced)) for (let i = 0; i < ranks; i++) buy(id);
  for (; fill;) {
    const open = path.nodes.filter((n) => !isAdvancedNode(n) && canUnlockNode(hero, n.id).ok);
    if (open.length === 0) break;
    buy(open[0].id);
  }
  return { ...hero, skills: deriveHeroSkills(hero, template.skills) };
}

const item = (templateId: string) => {
  const made = itemFromTemplateId(templateId);
  if (!made) throw new Error(`no template ${templateId}`);
  return made;
};

function fielded(hero: Hero, id: string, position: HexCoord): CombatUnit {
  const w = MASTERY_STARTER_WEAPONS[hero.masteryPath as MasteryId];
  return playerUnitFor(hero, { mainHand: item(w.mainHand), ...(w.offHand && { offHand: item(w.offHand) }) }, { id, position });
}

const dummy = (id: string, q: number, r: number, over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, position: at(q, r), stats: makeStats({ maxHp: 5000, defense: 10, magicDefense: 10, dodgeChance: 0 }), facing: 3, ...over });
const friend = (id: string, q: number, r: number, over: Partial<CombatUnit> = {}) =>
  makeUnit({ id, position: at(q, r), stats: makeStats({ maxHp: 300, maxMana: 60, dodgeChance: 0 }), ...over });

const cast = (casterId: string, skillId: string, target: HexCoord) =>
  resolveSkillUse(unit(casterId), unit(casterId).skills.find((s) => s.id === skillId)!, target, SILENT_SINK);
/** The same caster, able to act again in the same turn: no cooldowns, a full pool, the action back. */
const actAgain = (id: string) => useCombatStore.setState((s) => ({
  units: s.units.map((u) => (u.id === id
    ? { ...u, cooldowns: {}, currentMana: u.stats.maxMana, hasActed: false, repositionCap: undefined }
    : u)),
}));

const BEETLE = { beetle_shell_ward: 2, beetle_ironbound_shell: 2, beetle_rooted_stance: 1 };
const FIREFLY = { firefly_searing_light: 2, firefly_shared_glow: 2, firefly_radiant_core: 1 };
const MANTIS = { mantis_reaping_stride: 2, mantis_stalking_rush: 2, mantis_honed_edges: 1 };
const BUILDS: [MasteryId, Record<string, number>][] = [['beetle', BEETLE], ['firefly', FIREFLY], ['mantis', MANTIS]];
/** The nodes of the level-21 row: the level-26 node has a section of its own below. */
const level21Row = (path: NonNullable<ReturnType<typeof findMasteryPath>>) =>
  advancedNodes(path).filter((n) => n.masteryRow === undefined);

beforeEach(() => {
  resetFixtureIds();
  state().reset();
  // 0.5 is never a dodge against these dummies and never a natural crit
  spyDice().mockReturnValue(0.5);
});
afterEach(() => jest.restoreAllMocks());

// ─── The builds ──────────────────────────────────────────────────────────────

describe.each(BUILDS)('a level-25 %s', (pathId, advanced) => {
  const path = findMasteryPath(pathId)!;
  const capstones = path.nodes.filter((n) => n.exclusiveGroup === 'capstone');

  it('has three advanced nodes behind any one capstone, one of each kind of choice', () => {
    expect(level21Row(path).map((n) => n.id).sort()).toEqual(Object.keys(advanced).sort());
    for (const n of level21Row(path)) {
      expect(n.requires).toEqual(capstones.map((c) => c.id));
      expect(n.requiresCount).toBe(1);
    }
  });

  it.each(capstones.map((c) => [c.id]))('spends all 20 points toward %s with one capstone and the whole row fielded', (capstoneId) => {
    const hero = legalBuild(pathId, capstoneId, advanced);
    expect(hero.masteryPoints).toBe(0);
    expect(capstones.filter((c) => (hero.masteryNodes[c.id] ?? 0) > 0).map((c) => c.id)).toEqual([capstoneId]);
    const u = fielded(hero, 'm', at(0, 0));
    for (const n of level21Row(path)) {
      expect(hero.masteryNodes[n.id]).toBe(advanced[n.id]);
      if (n.grantsPassive) expect(u.passives).toContain(n.grantsPassive);
    }
  });

  it('describes every advanced node in a Simple line at each rank', () => {
    for (const n of advancedNodes(path)) {
      for (const level of [1, 2, 3]) expect({ id: n.id, text: nodeSimpleText(n, level) }).toEqual({ id: n.id, text: expect.any(String) });
    }
  });
});

/** The stat a node adds, read off two fielded heroes that differ by that node alone. */
function statLift(pathId: MasteryId, capstoneId: string, advanced: Record<string, number>, nodeId: string) {
  const hero = legalBuild(pathId, capstoneId, advanced);
  const without = { ...hero, masteryNodes: { ...hero.masteryNodes, [nodeId]: 0 } };
  return { with: fielded(hero, 'a', at(0, 0)).stats, without: fielded(without, 'b', at(0, 0)).stats };
}

// ─── Beetle: protection ─────────────────────────────────────────────────────

describe('the Beetle row', () => {
  const field = (others: CombatUnit[]) => {
    const beetle = fielded(legalBuild('beetle', 'beetle_carapace_bastion', BEETLE), 'beetle', at(0, 0));
    state().initCombat([beetle, ...others.filter((u) => u.isPlayer)], others.filter((u) => !u.isPlayer));
  };
  const barrier = (id: string) => unit(id).activeEffects.find((e) => e.type === AuraType.Barrier);

  it('Shell Ward shields every ally beside the Beetle at its turn start, from both defences', () => {
    field([friend('near', 1, 0), friend('far', 3, 0), dummy('foe', 0, 1)]);
    applyOnTurnStart(unit('beetle'));
    const s = unit('beetle').stats;
    const expected = Math.max(1, Math.round((s.defense + (s.magicDefense ?? 0)) * shellWardBarrier({ level: 2, scale: 1 })));
    expect(barrier('near')).toMatchObject({ magnitude: expected, duration: BALANCE.MONK_ADVANCED.SHELL_WARD_TURNS, sourceUnitId: 'beetle' });
    // Only allies, only adjacent, never the Beetle itself
    expect(barrier('far')).toBeUndefined();
    expect(barrier('foe')).toBeUndefined();
    expect(barrier('beetle')).toBeUndefined();
  });

  it('Shell Ward tops up a worn Barrier and never shrinks a stronger one', () => {
    field([friend('near', 1, 0, { activeEffects: [{ type: AuraType.Barrier, magnitude: 999, duration: 3 }] })]);
    applyOnTurnStart(unit('beetle'));
    expect(barrier('near')!.magnitude).toBe(999);
  });

  it('Ironbound Shell raises both defences, by rank', () => {
    const lift = statLift('beetle', 'beetle_shell_swap', BEETLE, 'beetle_ironbound_shell');
    expect(lift.with.defense - lift.without.defense).toBe(4);
    expect((lift.with.magicDefense ?? 0) - (lift.without.magicDefense ?? 0)).toBe(4);
  });

  it('Rooted Stance refuses Root and every shove', () => {
    field([dummy('foe', 1, 0)]);
    const beetle = unit('beetle');
    expect(isImmuneTo(beetle, AfflictionType.Root)).toBe(true);
    expect(isImmuneToPush(beetle)).toBe(true);
    state().applyEffect('beetle', { type: AfflictionType.Root, magnitude: 1, duration: 2, sourceUnitId: 'foe' });
    expect(unit('beetle').activeEffects.some((e) => e.type === AfflictionType.Root)).toBe(false);
    expect(traceForcedMove(at(1, 0), beetle, 2, state().units).moved).toBe(false);
  });
});

// ─── Firefly: hybrid utility ────────────────────────────────────────────────

describe('the Firefly row', () => {
  const field = (others: CombatUnit[]) => {
    const ff = fielded(legalBuild('firefly', 'firefly_swarm', FIREFLY), 'ff', at(0, 0));
    state().initCombat([ff, ...others.filter((u) => u.isPlayer)], others.filter((u) => !u.isPlayer));
  };
  const shred = (id: string) => unit(id).activeEffects.find((e) => e.type === AfflictionType.DefenseDown);

  it("Searing Light: Glowmote's bolt lays Defense Down on both defences, and nothing else does", () => {
    field([dummy('foe', 2, 0), dummy('other', -2, 0)]);
    const before = getCombatEffectiveStats(unit('foe'));
    cast('ff', 'glowmote', at(2, 0));
    const amount = searingLightShred({ level: 2, scale: 1 });
    expect(shred('foe')).toMatchObject({ magnitude: amount, duration: BALANCE.MONK_ADVANCED.SEARING_LIGHT_TURNS });
    const after = getCombatEffectiveStats(unit('foe'));
    expect(before.defense - after.defense).toBe(amount);
    expect((before.magicDefense ?? 0) - (after.magicDefense ?? 0)).toBe(amount);
    // The staff's Basic Attack is not the bolt
    actAgain('ff');
    cast('ff', BASIC_ATTACK_ID, at(-2, 0));
    expect(shred('other')).toBeUndefined();
  });

  it("Shared Glow: the ally the mote heals regains mana, and the Firefly's own pool is never the one filled", () => {
    field([dummy('foe', 2, 0), friend('hurt', 1, 0, { currentHp: 100, currentMana: 10 })]);
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'ff' ? { ...u, currentMana: 40 } : u)) }));
    const ffBefore = unit('ff').currentMana;
    cast('ff', 'glowmote', at(2, 0));
    expect(unit('hurt').currentHp).toBeGreaterThan(100);
    expect(unit('hurt').currentMana).toBe(10 + 4);
    // The cast's cost came off, and nothing came back to the caster
    expect(unit('ff').currentMana).toBeLessThan(ffBefore);
  });

  it('Radiant Core raises Magic and heal power', () => {
    const lift = statLift('firefly', 'firefly_motes', FIREFLY, 'firefly_radiant_core');
    // A share of Magic since the playtest of 2026-10-23, not a flat 3
    expect(lift.with.magic).toBeGreaterThan(lift.without.magic);
    expect((lift.with.healPower ?? 0) - (lift.without.healPower ?? 0)).toBe(6);
  });
});

// ─── Mantis: bounded combo movement ─────────────────────────────────────────

describe('the Mantis row', () => {
  const field = (foes: CombatUnit[]) => {
    const m = fielded(legalBuild('mantis', 'mantis_execution', MANTIS), 'mantis', at(0, 0));
    state().initCombat([m], foes);
  };
  const step = reapingStrideStep({ level: 2, scale: 1 });
  const reachable = () => getMovementRange(unit('mantis'), state().units, state().hazards);

  it('Reaping Stride: a Twin Reap that hits leaves a free step, never longer than the rung allows', () => {
    field([dummy('foe', 1, 0)]);
    const result = cast('mantis', 'twin_reap', at(1, 0));
    expect(result).toMatchObject({ ok: true, endsTurn: false });
    expect(unit('mantis').repositionCap).toBe(step);
    const range = reachable();
    expect(range.length).toBeGreaterThan(0);
    expect(Math.max(...range.map((h) => hexDistance(at(0, 0), h)))).toBe(step);
    // and the hard ceiling: no rung steps further than the last entry
    expect(reapingStrideStep({ level: 3, scale: 1.25 })).toBe(BALANCE.MONK_ADVANCED.REAPING_STRIDE_STEP[2]);
    expect(reapingStrideStep({ level: 9, scale: 9 })).toBe(BALANCE.MONK_ADVANCED.REAPING_STRIDE_STEP[2]);
  });

  it('Reaping Stride comes once a turn: a second Twin Reap in the same turn ends it, a new turn steps again', () => {
    field([dummy('foe', 1, 0)]);
    expect(cast('mantis', 'twin_reap', at(1, 0)).endsTurn).toBe(false);
    actAgain('mantis');
    expect(cast('mantis', 'twin_reap', at(1, 0))).toMatchObject({ ok: true, endsTurn: true });
    expect(unit('mantis').repositionCap).toBeUndefined();
    // The next turn (a bonus turn is one too) has its own step
    useCombatStore.setState((s) => ({ turnSerial: s.turnSerial + 1 }));
    actAgain('mantis');
    expect(cast('mantis', 'twin_reap', at(1, 0)).endsTurn).toBe(false);
  });

  it('Reaping Stride asks for Twin Reap, and for a hit', () => {
    field([dummy('foe', 1, 0)]);
    expect(cast('mantis', BASIC_ATTACK_ID, at(1, 0)).endsTurn).toBe(true);
    actAgain('mantis');
    // A dodged reap struck nothing
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'foe' ? { ...u, stats: { ...u.stats, dodgeChance: 100 } } : u)) }));
    expect(cast('mantis', 'twin_reap' as SkillId, at(1, 0)).endsTurn).toBe(true);
  });

  it('Reaping Stride grants nothing to a Rooted Mantis', () => {
    field([dummy('foe', 1, 0)]);
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'mantis'
      ? { ...u, activeEffects: [...u.activeEffects, { type: AfflictionType.Root, magnitude: 1, duration: 2 }] }
      : u)) }));
    expect(cast('mantis', 'twin_reap', at(1, 0)).endsTurn).toBe(true);
  });

  it('Stalking Rush: a move sharpens the Mantis with critical chance through its next turn', () => {
    field([dummy('foe', 3, 0)]);
    applyOnMove(unit('mantis'));
    const buff = unit('mantis').activeEffects.find((e) => e.type === AuraType.CritBuff);
    expect(buff).toBeDefined();
    expect(buff!.duration).toBe(2);
    expect(PASSIVE_DEFS.momentum.trigger).toBe('onMove');
  });

  it('Honed Edges adds Attack and critical damage', () => {
    const lift = statLift('mantis', 'mantis_marked_prey', MANTIS, 'mantis_honed_edges');
    expect((lift.with.critDamage ?? 0) - (lift.without.critDamage ?? 0)).toBeGreaterThan(0);
    expect(lift.with.attack - lift.without.attack).toBeGreaterThan(0);
  });
});

// ─── Level 26 ───────────────────────────────────────────────────────────────

const LEVEL_26_NODES: [MasteryId, string, string][] = [
  ['beetle', 'beetle_returned_blow', 'returnedBlow'],
  ['firefly', 'firefly_spilled_light', 'spilledLight'],
  ['mantis', 'mantis_reapers_breath', 'reapersBreath'],
];

describe.each(LEVEL_26_NODES)('the %s level-26 node', (pathId, nodeId, passive) => {
  const path = findMasteryPath(pathId)!;
  const capstones = path.nodes.filter((n) => n.exclusiveGroup === 'capstone');

  it.each(capstones.map((c) => [c.id]))('is refused at 25 and bought at 26 behind %s', (capstoneId) => {
    const at25 = legalBuild(pathId, capstoneId, {}, { fill: false });
    expect(canUnlockNode(at25, nodeId)).toEqual({ ok: false, reason: 'level-too-low', level: 26 });
    const at26 = legalBuild(pathId, capstoneId, { [nodeId]: 1 }, { level: 26, fill: false });
    expect(fielded(at26, 'm', at(0, 0)).passives).toContain(passive);
  });

  it.each(capstones.map((c) => [c.id]))('buys a legal 25-point build toward %s with the node at its top rank', (capstoneId) => {
    expect(pointsEarnedByLevel(30, pathId)).toBe(25);
    const hero = legalBuild(pathId, capstoneId, { [nodeId]: 3 }, { level: 30 });
    expect(hero.masteryPoints).toBe(0);
    expect(hero.masteryNodes[nodeId]).toBe(3);
    expect(capstones.filter((c) => (hero.masteryNodes[c.id] ?? 0) > 0).map((c) => c.id)).toEqual([capstoneId]);
    expect(fielded(hero, 'm', at(0, 0)).passives).toContain(passive);
  });

  it('reads at every rank, in a Simple line and a passive figure', () => {
    const node = path.nodes.find((n) => n.id === nodeId)!;
    const lines = [1, 2, 3].map((level) => nodeSimpleText(node, level));
    expect(lines).toEqual([expect.any(String), expect.any(String), expect.any(String)]);
    expect(new Set(lines).size).toBe(3);
    for (const level of [1, 2, 3]) {
      expect(PASSIVE_DEFS[passive as keyof typeof PASSIVE_DEFS].figures!({ level, scale: 1 }).length).toBeGreaterThan(0);
    }
  });
});

const RANKS = [{ level: 1, scale: 0.75 }, { level: 2, scale: 1 }, { level: 3, scale: 1.25 }];
const setUnit = (id: string, over: Partial<CombatUnit>) => useCombatStore.setState((s) => ({
  units: s.units.map((u) => (u.id === id ? { ...u, ...over } : u)),
}));

describe('Returned Blow', () => {
  const NODE = 'beetle_returned_blow';
  const claw = (range = 1): HeroSkill => ({
    id: 'test_claw' as SkillId, targetType: SkillTargetType.Single, range, damage: 1, unlockLevel: 1, manaCost: 0,
  });
  /** A level-26 Beetle, its set full unless told otherwise, and one enemy. */
  const field = (rank: number, foe: CombatUnit, charges?: number) => {
    const hero = legalBuild('beetle', 'beetle_carapace_bastion', rank > 0 ? { [NODE]: rank } : {}, { level: 26, fill: false });
    const beetle = fielded(hero, 'beetle', at(0, 0));
    state().initCombat([{
      ...beetle,
      activeEffects: [{ type: AuraType.Carapace, magnitude: charges ?? carapaceMax(beetle), duration: -1, sourceUnitId: 'beetle' }],
    }], [foe]);
  };
  const lost = (id: string) => unit(id).stats.maxHp - unit(id).currentHp;
  const strike = (range = 1) => resolveSkillUse(unit('foe'), claw(range), unit('beetle').position, SILENT_SINK);

  it('answers the attacker of a soaked blow, wherever it stands, and the set is spent', () => {
    field(2, dummy('foe', 5, 0));
    const hp = unit('beetle').currentHp;
    const expected = calculateDamage(unit('beetle'), unit('foe'), returnedBlow(unit('beetle'))!, 'front', state().units);
    expect(strike(5).ok).toBe(true);
    expect(unit('beetle').currentHp).toBe(hp);
    expect(unit('beetle').activeEffects.some((e) => e.type === AuraType.Carapace)).toBe(false);
    expect(expected).toBeGreaterThan(0);
    expect(lost('foe')).toBe(expected);
  });

  it('is a certain blow: a dodging attacker takes it all the same', () => {
    field(2, dummy('foe', 1, 0, { stats: makeStats({ maxHp: 5000, defense: 10, magicDefense: 10, dodgeChance: 100 }) }));
    strike();
    expect(lost('foe')).toBeGreaterThan(0);
  });

  it('is answered by Physical Defense and not by Magic Defense', () => {
    const answer = (defense: number, magicDefense: number) => {
      state().reset();
      field(2, dummy('foe', 1, 0, { stats: makeStats({ maxHp: 5000, defense, magicDefense, dodgeChance: 0 }) }));
      strike();
      return lost('foe');
    };
    expect(answer(10, 10)).toBeGreaterThan(answer(30, 10));
    expect(answer(10, 10)).toBe(answer(10, 60));
  });

  it('answers once a set: the next blow meets no full Carapace and goes unanswered', () => {
    field(2, dummy('foe', 1, 0));
    const hp = unit('beetle').currentHp;
    strike();
    const first = lost('foe');
    strike();
    expect(unit('beetle').currentHp).toBeLessThan(hp);
    expect(lost('foe')).toBe(first);
  });

  it('asks for a full set, and for the node', () => {
    field(2, dummy('foe', 1, 0), 1);
    strike();
    expect(lost('foe')).toBe(0);
    state().reset();
    field(0, dummy('foe', 1, 0));
    strike();
    expect(unit('beetle').activeEffects.some((e) => e.type === AuraType.Carapace)).toBe(false);
    expect(lost('foe')).toBe(0);
  });

  it('answers an attacker, not a source: damage that only names one spends the set and strikes nobody', () => {
    field(2, dummy('foe', 1, 0));
    state().damageUnit('beetle', 10, undefined, { sourceUnitId: 'foe' });
    expect(unit('beetle').activeEffects.some((e) => e.type === AuraType.Carapace)).toBe(false);
    expect(lost('foe')).toBe(0);
  });

  it('can kill the attacker, and the attacking cast still ends cleanly', () => {
    field(2, dummy('foe', 1, 0, { currentHp: 1 }));
    expect(strike().ok).toBe(true);
    expect(unit('foe').currentHp).toBe(0);
  });

  it('hits harder by rank', () => {
    const answers = RANKS.map((r) => {
      state().reset();
      field(r.level, dummy('foe', 1, 0, { stats: makeStats({ maxHp: 5000, defense: 0, magicDefense: 0, dodgeChance: 0 }) }));
      strike();
      return lost('foe');
    });
    expect(answers[0]).toBeLessThan(answers[1]);
    expect(answers[1]).toBeLessThan(answers[2]);
  });
});

describe('Spilled Light', () => {
  const NODE = 'firefly_spilled_light';
  /** The Firefly's bolt at a dummy on a set board, with the node at `rank`; what each body ended at. */
  const bolt = (
    rank: number, allies: CombatUnit[],
    { extra = {}, foe = {}, selfMissing = 0 }: { extra?: Record<string, number>; foe?: Partial<CombatUnit>; selfMissing?: number } = {},
  ) => {
    state().reset();
    const hero = legalBuild('firefly', 'firefly_swarm', { ...extra, ...(rank > 0 && { [NODE]: rank }) }, { level: 26, fill: false });
    const ff = fielded(hero, 'ff', at(0, 0));
    state().initCombat([{ ...ff, currentHp: ff.stats.maxHp - selfMissing }, ...allies], [dummy('foe', 2, 0, foe)]);
    const spec = moteSpec(unit('ff'), unit('ff').skills.find((s) => s.id === 'glowmote')!)!;
    cast('ff', 'glowmote', at(2, 0));
    return { lost: 5000 - unit('foe').currentHp, share: spec.share };
  };
  /** What the node added, against the same bolt without it, and what it should be for that gap. */
  const added = (rank: number, allies: () => CombatUnit[], options: Parameters<typeof bolt>[2] = {}) => {
    const plain = bolt(0, allies(), options);
    const lit = bolt(rank, allies(), options);
    return { added: lit.lost - plain.lost, mote: moteHeal(plain.share, plain.lost) };
  };
  const share = (rank: number) => spilledLightShare(RANKS[rank - 1]);

  it.each([1, 2, 3])('with nobody hurt the whole mote counts, at rank %i, and defences do not touch it', (rank) => {
    const plain = added(rank, () => []);
    expect(plain.mote).toBeGreaterThan(0);
    expect(plain.added).toBe(Math.round(plain.mote * share(rank)));
    const armoured = added(rank, () => [], { foe: { stats: makeStats({ maxHp: 5000, defense: 10, magicDefense: 40, dodgeChance: 0 }) } });
    expect(armoured.added).toBe(Math.round(armoured.mote * share(rank)));
  });

  it('spills nothing when the mote lands whole', () => {
    expect(added(2, () => [friend('hurt', 1, 0, { currentHp: 10 })]).added).toBe(0);
  });

  it('spills only what the heal could not use', () => {
    const { added: got, mote } = added(2, () => [friend('hurt', 1, 0, { currentHp: 295 })]);
    expect(mote).toBeGreaterThan(5);
    expect(got).toBe(Math.round((mote - 5) * share(2)));
    expect(unit('hurt').currentHp).toBe(300);
  });

  it('reads the Firefly itself as the recipient when nobody else is hurt', () => {
    const { added: got, mote } = added(2, () => [], { selfMissing: 3 });
    expect(unit('ff').currentHp).toBe(unit('ff').stats.maxHp);
    expect(got).toBe(Math.round((mote - 3) * share(2)));
  });

  describe('with Twin Motes', () => {
    const twinBuild = () => {
      const path = findMasteryPath('firefly')!;
      const twin = path.nodes.find((n) => n.grantsPassive === 'twinMotes')!;
      const parents = prerequisitesFor(path, twin).filter((p) => p.exclusiveGroup !== 'capstone');
      return { ...Object.fromEntries(parents.map((p) => [p.id, 1])), [twin.id]: 1 };
    };

    it('counts the larger gap of the two, never their sum', () => {
      const { added: got, mote } = added(2, () => [
        friend('a', 1, 0, { currentHp: 295 }), friend('b', 0, 1, { currentHp: 280 }),
      ], { extra: twinBuild() });
      expect(mote).toBeGreaterThan(20);
      expect(got).toBe(Math.round((mote - 5) * share(2)));
    });

    it('does not count an empty second mote: one hurt ally pays by its own heal', () => {
      const { added: got, mote } = added(2, () => [friend('a', 1, 0, { currentHp: 295 })], { extra: twinBuild() });
      expect(got).toBe(Math.round((mote - 5) * share(2)));
    });
  });

  it('a dodged bolt sends no mote and spills nothing', () => {
    const dodger = { stats: makeStats({ maxHp: 5000, defense: 10, magicDefense: 10, dodgeChance: 100 }) };
    expect(bolt(2, [], { foe: dodger }).lost).toBe(0);
  });

  it('is no blow of the cast: the bond heals off the bolt alone', () => {
    const bonded = () => [friend('bond', -1, 0, {
      currentHp: 10,
      activeEffects: [{ type: AuraType.Lightbond, magnitude: 20, duration: 3, sourceUnitId: 'ff' }],
    })];
    // Far out of the mote's reach, so the mote finds nobody and spills whole
    const place = () => bonded().map((u) => ({ ...u, position: at(-8, 0) }));
    bolt(0, place());
    const plain = unit('bond').currentHp;
    expect(plain).toBeGreaterThan(10);
    bolt(2, place());
    expect(unit('bond').currentHp).toBe(plain);
  });

  it('can finish the enemy, and leaves a corpse alone when the bolt already did', () => {
    const plain = bolt(0, []);
    const left = plain.lost + 1;
    bolt(2, [], { foe: { currentHp: left } });
    expect(unit('foe').currentHp).toBe(0);
    bolt(2, [], { foe: { currentHp: 1 } });
    expect(unit('foe').currentHp).toBe(0);
  });
});

describe("Reaper's Breath", () => {
  const NODE = 'mantis_reapers_breath';
  const bleed = { type: AfflictionType.Bleed, magnitude: 4, duration: 3, sourceUnitId: 'mantis' };
  const field = (rank: number, foe: Partial<CombatUnit> = {}, mana?: number) => {
    state().reset();
    const hero = legalBuild('mantis', 'mantis_execution', rank > 0 ? { [NODE]: rank } : {}, { level: 26, fill: false });
    state().initCombat([fielded(hero, 'mantis', at(0, 0))], [dummy('foe', 1, 0, foe)]);
    setUnit('mantis', { currentMana: mana ?? unit('mantis').stats.maxMana });
  };
  const reapCost = () => unit('mantis').skills.find((s) => s.id === 'twin_reap')!.manaCost;
  const reap = () => cast('mantis', 'twin_reap', at(1, 0));

  it.each([1, 2, 3])('a reap returns its rung of chi at rank %i, and from a full pool too', (rank) => {
    field(rank, { activeEffects: [bleed] });
    const full = unit('mantis').stats.maxMana;
    reap();
    expect(unit('foe').activeEffects.some((e) => e.type === AfflictionType.Bleed)).toBe(false);
    expect(unit('mantis').currentMana).toBe(full - reapCost() + reapersBreathChi(RANKS[rank - 1]));
  });

  it('returns nothing without a Bleed to reap', () => {
    field(2);
    const full = unit('mantis').stats.maxMana;
    reap();
    expect(unit('mantis').currentMana).toBe(full - reapCost());
  });

  it('returns nothing on a dodge, and the Bleed stays for the next one', () => {
    field(2, { activeEffects: [bleed], stats: makeStats({ maxHp: 5000, defense: 10, magicDefense: 10, dodgeChance: 100 }) });
    const full = unit('mantis').stats.maxMana;
    reap();
    expect(unit('foe').activeEffects.some((e) => e.type === AfflictionType.Bleed)).toBe(true);
    expect(unit('mantis').currentMana).toBe(full - reapCost());
  });

  it('a reap that kills still returns it', () => {
    field(0, { activeEffects: [bleed] });
    reap();
    const twoCuts = 5000 - unit('foe').currentHp;
    field(2, { activeEffects: [bleed], currentHp: twoCuts });
    const full = unit('mantis').stats.maxMana;
    reap();
    expect(unit('foe').currentHp).toBe(0);
    expect(unit('mantis').currentMana).toBe(full - reapCost() + reapersBreathChi(RANKS[1]));
  });

  it('asks for the node, and only a Twin Reap reaps', () => {
    field(0, { activeEffects: [bleed] });
    const full = unit('mantis').stats.maxMana;
    reap();
    expect(unit('mantis').currentMana).toBe(full - reapCost());
    field(2, { activeEffects: [bleed] }, 10);
    cast('mantis', BASIC_ATTACK_ID, at(1, 0));
    expect(unit('foe').activeEffects.some((e) => e.type === AfflictionType.Bleed)).toBe(true);
  });
});
