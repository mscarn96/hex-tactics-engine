import { useCombatStore } from '@/stores/combatStore';
import { CombatSink, resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { getSkillRangeHexes, getSkillTargets, getValidSkillTargetHexes, pickRandomStrikes } from '@/systems/combat/targeting';
import { aimFootprint } from '@/systems/combat/aimSteps';
import { inArena } from '@/systems/combat/arenaGeometry';
import { requireUnit } from '@/systems/combat/unitLookup';
import { conductiveArcBonus, triggersShock } from '@/systems/combat/statusEffects';
import { beginTurn } from '@/systems/combat/turnStart';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { applyMasteryModifiers, nodeSkillAt } from '@/systems/progression/mastery';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { BALANCE } from '@/data/balanceConstants';
import {
  arc, chainLightning, ignite, skyfall, summonThunderElemental, tempest, thunderbolt, thunderstep,
} from '@/data/skills/masterySkills';
import { slash } from '@/data/skills/skillData';
import { findMasteryNode, findMasteryPath } from '@/data/skills/masteryData';
import { isStormcallerSpell } from '@/data/skills/lightningSkills';
import { getHexesInRange, hexDistance } from '@/utils/hexUtils';
import {
  AfflictionType, CombatUnit, HeroSkill, HeroStats, HexCoord, PassiveId, PassiveRank,
} from '@/models/types';
import { at, makeEffect, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * The Stormcaller remaster, as rules: Conductive Arc at the centre, Skyfall on
 * distinct random enemies, Shock's jump only off Shock-applying spells, Tempest at
 * radius 3, and the Thunder Elemental that echoes every Stormcaller spell. Numbers
 * come from the definitions; what is pinned is the shape.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 300, attack: 10, magic: 40, defense: 0, magicDefense: 0, maxMana: 400,
    critChance: 0, dodgeChance: 0, speed: 10, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const hp = (id: string) => unitNow(id).currentHp;
const RANKS: PassiveRank[] = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));
const key = (h: HexCoord) => `${h.q},${h.r}`;

const storm = (passives: PassiveId[] = [], level = 2, over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'storm',
    heroId: 'h-storm',
    position: at(0, 0),
    stats: stats(),
    currentMana: 400,
    skills: [arc, thunderbolt, chainLightning, tempest, skyfall, thunderstep, summonThunderElemental, slash],
    passives,
    passiveRanks: Object.fromEntries(passives.map((p) => [p, RANKS[level - 1]])),
    ...over,
  });

/** Five enemies inside Skyfall's area round (0, 3), none beside another, so no Shock spark jumps between them. */
const SPREAD: [number, number][] = [[2, 3], [-2, 3], [0, 5], [0, 1], [2, 1]];

const shock = () => makeEffect(AfflictionType.Shock, { magnitude: 1, duration: 3 });
const foe = (id: string, q: number, r: number, over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, position: at(q, r), stats: stats({ maxHp: 2000 }), ...over });

const logger = () => {
  const lines: string[] = [];
  const sink: CombatSink = { ...SILENT_SINK, log: (text) => { lines.push(text); } };
  return { sink, lines };
};

const cast = (skill: HeroSkill, target: HexCoord, sink: CombatSink = SILENT_SINK, id = 'storm') =>
  resolveSkillUse(unitNow(id), skill, target, sink);

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  state().reset();
});

afterEach(() => jest.restoreAllMocks());

// ─── The tree ────────────────────────────────────────────────────────────────

describe('the Stormcaller tree', () => {
  const nodes = findMasteryPath('stormcaller')!.nodes;
  const at1 = (column: number) => nodes.find((n) => n.tier === 1 && n.column === column && !n.sideTree);

  it('puts Conductive Arc in the centre of the first row and Overload where Quickened was', () => {
    expect(at1(2)?.id).toBe('storm_conductive_arc');
    expect(at1(2)?.grantsPassive).toBe('conductiveArc');
    expect(at1(1)?.id).toBe('storm_overload');
    expect(nodes.map((n) => n.id)).not.toContain('storm_quickened');
  });

  it('replaces Afterimage with Summon Thunder Elemental, in both side-tree prerequisites too', () => {
    const ult = findMasteryNode('storm_thunder_elemental')!.node;
    expect(ult.tier).toBe(3);
    expect(ult.grantsSkill).toBe('summon_thunder_elemental');
    expect(nodes.map((n) => n.id)).not.toContain('storm_afterimage');
    for (const starter of nodes.filter((n) => n.exclusiveGroup === 'side')) {
      expect(starter.requires).toContain('storm_thunder_elemental');
      expect(starter.requires).not.toContain('storm_afterimage');
    }
  });
});

// ─── Shock ───────────────────────────────────────────────────────────────────

describe('Shock jumps only off a spell that applies Shock', () => {
  const setup = (victimShocked: boolean, casterPassives: PassiveId[] = [], level = 2) => {
    state().initCombat(
      [storm(casterPassives, level)],
      [foe('victim', 1, 0, { activeEffects: victimShocked ? [shock()] : [] }), foe('beside', 2, 0)],
    );
  };

  it('jumps when an already-Shocked enemy is struck by Arc', () => {
    setup(true);
    cast(arc, at(1, 0));
    expect(hp('beside')).toBeLessThan(2000);
  });

  it('does not jump off the first Shock a spell lays on the same hit', () => {
    setup(false);
    cast(arc, at(1, 0));
    expect(unitNow('victim').activeEffects.some((e) => e.type === AfflictionType.Shock)).toBe(true);
    expect(hp('beside')).toBe(2000);
  });

  it('does not jump off a Basic Attack, nor off a spell that lays no Shock', () => {
    setup(true);
    expect(triggersShock(slash)).toBe(false);
    expect(triggersShock(ignite)).toBe(false);
    state().initCombat(
      [storm([], 2, { position: at(0, 0), skills: [slash, ignite] })],
      [foe('victim', 1, 0, { activeEffects: [shock()] }), foe('beside', 2, 0)],
    );
    cast(slash, at(1, 0));
    cast(ignite, at(1, 0));
    expect(hp('victim')).toBeLessThan(2000);
    expect(hp('beside')).toBe(2000);
  });

  it('every Stormcaller damage spell applies Shock, so each can set the jump off', () => {
    for (const s of [arc, thunderbolt, chainLightning, tempest, skyfall, thunderstep]) {
      expect(triggersShock(s)).toBe(true);
    }
  });

  it('stays a single hop: a Shocked neighbour does not pass it on', () => {
    state().initCombat(
      [storm()],
      [
        foe('victim', 1, 0, { activeEffects: [shock()] }),
        foe('beside', 2, 0, { activeEffects: [shock()], currentHp: 10 }),
        foe('beyond', 3, 0),
      ],
    );
    cast(arc, at(1, 0));
    expect(hp('beside')).toBeLessThan(10);
    expect(hp('beyond')).toBe(2000);
  });
});

// ─── Conductive Arc ──────────────────────────────────────────────────────────

describe('Conductive Arc', () => {
  const jumpWith = (passives: PassiveId[], level = 2, skill: HeroSkill = arc) => {
    state().reset();
    state().initCombat(
      [storm(passives, level)],
      [foe('victim', 1, 0, { activeEffects: [shock()] }), foe('beside', 2, 0)],
    );
    cast(skill, at(1, 0));
    return 2000 - hp('beside');
  };

  it('makes the jump an Arc sets off bigger, by the stated share', () => {
    const plain = jumpWith([]);
    const conductive = jumpWith(['conductiveArc']);
    expect(conductive).toBeGreaterThan(plain);
    // Both jumps round to whole damage, and at the Arc's lower ratio a point moves the quotient by a few hundredths
    expect(conductive / plain).toBeCloseTo(1 + BALANCE.CONDUCTIVE_ARC_BONUS, 0);
  });

  it('grows with every rung', () => {
    const rungs = [1, 2, 3].map((level) => jumpWith(['conductiveArc'], level));
    expect(rungs[1]).toBeGreaterThan(rungs[0]);
    expect(rungs[2]).toBeGreaterThan(rungs[1]);
  });

  it('is Arc only: Thunderbolt\'s jump is unchanged by it', () => {
    const owner = storm(['conductiveArc']);
    expect(conductiveArcBonus(owner, thunderbolt)).toBe(0);
    expect(conductiveArcBonus(owner, arc)).toBeGreaterThan(0);
    expect(jumpWith(['conductiveArc'], 2, thunderbolt)).toBe(jumpWith([], 2, thunderbolt));
  });
});

// ─── Skyfall ─────────────────────────────────────────────────────────────────

describe('Skyfall', () => {
  // Playtest 2026-10-17, PT-18: aimed at a hex in reach, the strikes fall among the
  // enemies within SKYFALL_RADIUS of it, never anywhere on the map
  const R = BALANCE.SKYFALL_RADIUS;

  it('strikes up to three different enemies in the aimed area, never the same one twice', () => {
    state().initCombat([storm()], SPREAD.map(([q, r], i) => foe(`f${i}`, q, r)));
    expect(cast(skyfall, at(0, 3)).ok).toBe(true);
    const struck = [0, 1, 2, 3, 4].filter((i) => hp(`f${i}`) < 2000);
    expect(struck).toHaveLength(BALANCE.SKYFALL_TARGETS);
    // Each struck enemy took exactly one strike's worth
    const one = calculateDamage(unitNow('storm'), foe('probe', 9, 9), skyfall);
    for (const i of struck) expect(2000 - hp(`f${i}`)).toBe(one);
    for (const i of struck) {
      expect(unitNow(`f${i}`).activeEffects.some((e) => e.type === AfflictionType.Shock)).toBe(true);
    }
  });

  it('strikes two when two remain and one when one remains, once each', () => {
    for (const count of [1, 2]) {
      state().reset();
      const foes = Array.from({ length: count }, (_, i) => foe(`f${i}`, i, 3));
      state().initCombat([storm()], foes);
      const picks = pickRandomStrikes(skyfall, at(0, 0), at(0, 3), state().units);
      expect(picks).toHaveLength(count);
      expect(new Set(picks.map(key)).size).toBe(count);
      cast(skyfall, at(0, 3));
      const one = calculateDamage(unitNow('storm'), foes[0], skyfall);
      for (const f of foes) expect(2000 - hp(f.id)).toBe(one);
    }
  });

  it('picks only enemies within its radius of the aimed hex, never an ally', () => {
    state().initCombat(
      [storm(), makeUnit({ id: 'friend', position: at(0, 4), stats: stats() })],
      [foe('near', 0, 3 + R), foe('far', 0, -5)],
    );
    const candidates = getSkillTargets(skyfall, at(0, 0), at(0, 3), state().units).map(key);
    expect(candidates).toEqual([key(at(0, 3 + R))]);
    cast(skyfall, at(0, 3));
    expect(hp('near')).toBeLessThan(2000);
    expect(hp('far')).toBe(2000);
    expect(hp('friend')).toBe(300);
  });

  it('is aimed within its range and offers only hexes with an enemy in the area', () => {
    state().initCombat([storm()], [foe('a', 0, 4)]);
    const valid = getValidSkillTargetHexes(skyfall, unitNow('storm'), state().units);
    expect(valid.length).toBeGreaterThan(0);
    for (const h of valid) {
      expect(hexDistance(at(0, 0), h)).toBeLessThanOrEqual(BALANCE.SKYFALL_RANGE);
      expect(hexDistance(h, at(0, 4))).toBeLessThanOrEqual(R);
    }
    expect(getSkillRangeHexes(skyfall, storm()).every((h) => hexDistance(at(0, 0), h) <= BALANCE.SKYFALL_RANGE)).toBe(true);
  });

  it('previews the whole aimed area', () => {
    state().initCombat([storm()], [foe('a', 0, 4)]);
    const area = aimFootprint(skyfall, unitNow('storm'), at(0, 3), state().units)!;
    expect(area.map(key).sort()).toEqual(getHexesInRange(at(0, 3), R).filter(inArena).map(key).sort());
  });

  it('deals 0.567x Magic per strike at the middle rung, less and more either side', () => {
    const node = findMasteryNode('storm_skyfall')!.node;
    expect(nodeSkillAt(node, 2)!.damage).toBe(0.567);
    expect(nodeSkillAt(node, 1)!.damage).toBeLessThan(0.567);
    expect(nodeSkillAt(node, 3)!.damage).toBeGreaterThan(0.567);
  });
});

// ─── Tempest ─────────────────────────────────────────────────────────────────

describe('Tempest', () => {
  it('reaches three hexes by itself and four with Squall', () => {
    expect(tempest.aoeRadius).toBe(3);
    expect(applyMasteryModifiers(tempest, { aoeRadiusBonus: 1 }).aoeRadius).toBe(4);
  });

  it('strikes and Shocks an enemy three hexes away, and the preview shows that hex', () => {
    state().initCombat([storm()], [foe('ring3', 3, 0), foe('ring4', 4, 0)]);
    expect(getSkillRangeHexes(tempest, unitNow('storm')).map(key)).toContain(key(at(3, 0)));
    cast(tempest, at(0, 0));
    expect(hp('ring3')).toBeLessThan(2000);
    expect(unitNow('ring3').activeEffects.some((e) => e.type === AfflictionType.Shock)).toBe(true);
    expect(hp('ring4')).toBe(2000);
  });
});

// ─── The Thunder Elemental ───────────────────────────────────────────────────

describe('Summon Thunder Elemental', () => {
  const elemental = () => state().units.find((u) => u.companion && u.currentHp > 0);
  const summon = () => {
    expect(cast(summonThunderElemental, at(0, 0)).ok).toBe(true);
    return elemental()!;
  };

  it('has exactly 0.27 / 0.45 / 0.63 of the owner\'s Magic by rung', () => {
    const node = findMasteryNode('storm_thunder_elemental')!.node;
    expect([1, 2, 3].map((l) => nodeSkillAt(node, l)!.summons!.echoMagic)).toEqual([0.27, 0.45, 0.63]);
  });

  it('stands beside its owner, targetable, and takes no turn of its own', () => {
    state().initCombat([storm()], [foe('a', 3, 0)]);
    const pet = summon();
    expect(hexDistance(pet.position, at(0, 0))).toBe(1);
    expect(pet.summonedBy).toBe('storm');
    expect(pet.stats.magic).toBe(Math.round(40 * BALANCE.THUNDER_ELEMENTAL_MAGIC));
    expect(state().turnOrder).not.toContain(pet.id);
  });

  it('echoes a Stormcaller spell once, with its own Magic, at the same target', () => {
    state().initCombat([storm()], [foe('a', 3, 0)]);
    summon();
    const alone = calculateDamage(unitNow('storm'), unitNow('a'), thunderbolt);
    const { sink, lines } = logger();
    cast(thunderbolt, at(3, 0), sink);
    const dealt = 2000 - hp('a');
    expect(dealt).toBeGreaterThan(alone);
    expect(lines.filter((l) => l.startsWith('Thunder Elemental: Thunderbolt'))).toHaveLength(1);
  });

  it('copies no Basic Attack, and never the summon itself', () => {
    state().initCombat([storm()], [foe('a', 1, 0)]);
    summon();
    const { sink, lines } = logger();
    cast(slash, at(1, 0), sink);
    expect(lines.some((l) => l.startsWith('Thunder Elemental:'))).toBe(false);
    expect(isStormcallerSpell(summonThunderElemental)).toBe(false);
    expect(isStormcallerSpell(slash)).toBe(false);
  });

  it('mirrors Skyfall\'s rolled enemies rather than rolling its own', () => {
    state().initCombat([storm()], SPREAD.map(([q, r], i) => foe(`f${i}`, q, r)));
    summon();
    cast(skyfall, at(0, 3));
    const struck = [0, 1, 2, 3, 4].filter((i) => hp(`f${i}`) < 2000);
    expect(struck).toHaveLength(BALANCE.SKYFALL_TARGETS);
  });

  it('follows its owner however far they move, without a turn or a move of its own', () => {
    state().initCombat([storm()], [foe('a', 0, -4)]);
    summon();
    state().moveUnit('storm', at(0, 4));
    expect(hexDistance(elemental()!.position, at(0, 4))).toBe(1);
  });

  it('follows Thunderstep and echoes only its strike: the owner is moved once', () => {
    state().initCombat([storm()], [foe('a', 3, 0)]);
    summon();
    const { sink, lines } = logger();
    expect(cast(thunderstep, at(3, -1), sink).ok).toBe(true);
    expect(unitNow('storm').position).toEqual(at(3, -1));
    expect(hexDistance(elemental()!.position, at(3, -1))).toBe(1);
    expect(lines.filter((l) => l.startsWith('Thunder Elemental: Thunderstep'))).toHaveLength(1);
  });

  it('spends no mana or cooldown of its own and gives the owner no extra action', () => {
    state().initCombat([storm()], [foe('a', 3, 0)]);
    summon();
    const mana = unitNow('storm').currentMana;
    const result = cast(arc, at(3, 0));
    expect(result.endsTurn).toBe(true);
    expect(mana - unitNow('storm').currentMana).toBe(arc.manaCost);
  });

  it('lasts three of its owner\'s regular turns after the summon, then fades', () => {
    state().initCombat([storm()], [foe('a', 5, 0)]);
    const pet = summon();
    for (let turn = 1; turn <= 3; turn++) {
      beginTurn('storm', SILENT_SINK);
      expect(unitNow(pet.id).currentHp).toBeGreaterThan(0);
    }
    beginTurn('storm', SILENT_SINK);
    expect(unitNow(pet.id).currentHp).toBe(0);
  });

  it('can be killed before then, and stops echoing', () => {
    state().initCombat([storm()], [foe('a', 3, 0)]);
    const pet = summon();
    state().damageUnit(pet.id, 9999, 'a');
    const { sink, lines } = logger();
    cast(arc, at(3, 0), sink);
    expect(lines.some((l) => l.startsWith('Thunder Elemental:'))).toBe(false);
  });

  it('a recast replaces the one standing rather than adding a second', () => {
    state().initCombat([storm()], [foe('a', 5, 0)]);
    summon();
    useCombatStore.setState({
      units: state().units.map((u) => (u.id === 'storm' ? { ...u, cooldowns: {} } : u)),
    });
    expect(cast(summonThunderElemental, at(0, 0)).ok).toBe(true);
    expect(state().units.filter((u) => u.companion && u.currentHp > 0)).toHaveLength(1);
  });
});
