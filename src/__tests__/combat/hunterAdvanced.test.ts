import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { createPlayerUnits } from '@/systems/combat/unitFactory';
import { requireUnit } from '@/systems/combat/unitLookup';
import { calculateDamage, critChanceAgainst, markMultiplier, masteryTargetMultiplier, statusAmplifier } from '@/systems/combat/damageCalc';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { getMovementRange } from '@/systems/combat/movement';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { eagleEyeCrit, intoTheDarkTurns, nextQuarryReach, openSeamsCrit, unseenBladeCrit } from '@/systems/combat/passiveFormulas';
import { resolveDeathMarks } from '@/systems/combat/assassination';
import { bladesCapOf, ownBlades } from '@/systems/combat/blades';
import { hasPassive, PASSIVE_DEFS } from '@/systems/combat/passives';
import { canUnlockNode, deriveHeroSkills, isSideNode, levelScale, maxLevelOf, pointsEarnedByLevel, prerequisitesFor } from '@/systems/progression/mastery';
import { BALANCE } from '@/data/balanceConstants';
import { usePartyStore } from '@/stores/partyStore';
import { setLocale } from '@/i18n';
import { skillEffectLines } from '@/data/display/skillDisplay';
import { nodeSimpleText, skillSimpleText } from '@/data/display/simpleText';
import { findMasteryNode, findMasteryPath } from '@/data/skills/masteryData';
import { AfflictionType, AuraType, CombatUnit, Hero, HeroClass, MasteryId, MasteryNode, MasteryPath, PassiveRank } from '@/models/types';
import { at, makeEffect, makeFoe, makeHero, makeStats, resetFixtureIds } from '../support/fixtures';

/**
 * The Hunter's level-21–25 advanced nodes, as rules, through the real code path:
 * a level-21 hero with a capstone and the node, fielded by `createPlayerUnits`,
 * acting through `resolveSkillUse` and rolled through `critChanceAgainst`.
 *
 * Opening Volley (Marksman) is more damage against an enemy above half health;
 * Eagle Eye is critical chance against the Marksman's own Mark. Light Step
 * (Skirmisher) is a hex of movement; Open Seams is critical chance against an
 * enemy carrying the Skirmisher's own blades. Coup de Grace (Shadowblade) is
 * more damage inside the execute window; Unseen Blade is critical chance while
 * Stealthed. None of them changes a skill, so the skills a hero fields — and
 * every preview read off them — are the same with or without the node.
 */

const RANKS: PassiveRank[] = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));
const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);

const CAPSTONE: Record<string, string> = {
  marksman: 'marks_rapid_fire', skirmisher: 'skirm_flurry', shadowblade: 'shadow_creeping_death',
};

function hero(path: MasteryId, nodes: Record<string, number> = {}): Hero {
  const h = makeHero({
    heroClass: HeroClass.Ranger,
    templateId: 'ranger',
    level: 21,
    masteryPath: path,
    masteryNodes: { [CAPSTONE[path]]: 1, ...nodes },
    baseStats: makeStats({
      maxHp: 200, attack: 30, defense: 5, magic: 10, maxMana: 100,
      critChance: 0, critDamage: 150, dodgeChance: 0, moveRange: 3,
    }),
  });
  h.skills = deriveHeroSkills(h, []);
  return h;
}

const field = (h: Hero, id = 'hunter', q = 0, r = 0): CombatUnit => ({
  ...createPlayerUnits([h], [at(q, r)], [])[0],
  id,
});

const skillOf = (unit: CombatUnit, id: string) => {
  const s = unit.skills.find((x) => x.id === id);
  if (!s) throw new Error(`${unit.id} has no ${id}`);
  return s;
};

const foe = (over: Partial<CombatUnit> = {}) =>
  makeFoe({
    id: 'foe',
    position: at(2, 0),
    stats: makeStats({ maxHp: 1000, attack: 10, defense: 10, critChance: 0, dodgeChance: 0 }),
    ...over,
  });

beforeEach(() => {
  resetFixtureIds();
  state().reset();
});

/** The node changes no skill: same ids, same numbers, same detailed lines. */
function expectSameKit(path: MasteryId, nodeId: string) {
  const plain = field(hero(path));
  const withNode = field(hero(path, { [nodeId]: 3 }));
  expect(withNode.skills.map((s) => s.id)).toEqual(plain.skills.map((s) => s.id));
  for (const s of withNode.skills) {
    const before = skillOf(plain, s.id);
    expect(s).toEqual(before);
    expect(skillEffectLines(s, withNode)).toEqual(skillEffectLines(before, plain));
  }
}

describe('Opening Volley', () => {
  const marks = (level: number | 0) => field(hero('marksman', level ? { marks_opening_volley: level } : {}));

  it('adds 11 / 15 / 19% damage against an enemy above half health, and none at or below it', () => {
    const whole = foe();
    const hurt = foe({ currentHp: 500 });
    expect([1, 2, 3].map((l) => masteryTargetMultiplier(marks(l), whole))).toEqual([1.1125, 1.15, 1.1875].map((v) =>
      expect.closeTo(v, 5)));
    expect(masteryTargetMultiplier(marks(2), hurt)).toBe(1);
  });

  it('reaches the blow the hero actually lands', () => {
    const basic = (u: CombatUnit) => skillOf(u, BASIC_ATTACK_ID);
    const plain = calculateDamage(marks(0), foe(), basic(marks(0)));
    const volley = calculateDamage(marks(2), foe(), basic(marks(2)));
    expect(volley / plain).toBeCloseTo(1.15, 1);
    expect(calculateDamage(marks(2), foe({ currentHp: 400 }), basic(marks(2))))
      .toBe(calculateDamage(marks(0), foe({ currentHp: 400 }), basic(marks(0))));
  });

  it('changes no skill', () => expectSameKit('marksman', 'marks_opening_volley'));
});

describe('Eagle Eye', () => {
  const marks = (level: number | 0) => field(hero('marksman', level ? { marks_eagle_eye: level } : {}));

  it('adds critical chance against an enemy the Marksman Marked with Mark Target', () => {
    const me = marks(2);
    useCombatStore.setState({ units: [me, foe()] });
    resolveSkillUse(me, skillOf(me, 'mark_target'), at(2, 0), SILENT_SINK);
    const marked = unitNow('foe');
    expect(marked.activeEffects.some((e) => e.type === AfflictionType.Mark && e.sourceUnitId === me.id)).toBe(true);
    expect(critChanceAgainst(me, marked) - critChanceAgainst(marks(0), marked)).toBe(eagleEyeCrit(RANKS[1]));
    expect(critChanceAgainst(me, foe())).toBe(critChanceAgainst(marks(0), foe()));
  });

  it('ignores another hunter\'s Mark', () => {
    const theirs = foe({ activeEffects: [makeEffect(AfflictionType.Mark, { magnitude: 0.4, duration: 3, sourceUnitId: 'other' })] });
    expect(critChanceAgainst(marks(2), theirs)).toBe(critChanceAgainst(marks(0), theirs));
  });

  it('is 11 / 15 / 19 points by rank, never a sheet stat', () => {
    const mine = foe({ activeEffects: [makeEffect(AfflictionType.Mark, { magnitude: 0.4, duration: 3, sourceUnitId: 'hunter' })] });
    expect([1, 2, 3].map((l) => critChanceAgainst(marks(l), mine) - critChanceAgainst(marks(0), mine))).toEqual([11, 15, 19]);
    expect(getCombatEffectiveStats(marks(3)).critChance).toBe(getCombatEffectiveStats(marks(0)).critChance);
  });

  it('changes no skill', () => expectSameKit('marksman', 'marks_eagle_eye'));
});

describe('Light Step', () => {
  it('is one rank and one more hex of movement, on the board as well as the sheet', () => {
    expect(findMasteryNode('skirm_light_step')!.node.maxLevel).toBe(1);
    const plain = field(hero('skirmisher'));
    const light = field(hero('skirmisher', { skirm_light_step: 1 }));
    expect(getCombatEffectiveStats(light).moveRange).toBe(getCombatEffectiveStats(plain).moveRange + 1);
    const reach = (u: CombatUnit) => {
      useCombatStore.setState({ units: [u] });
      return getMovementRange(u, [u], []).length;
    };
    expect(reach(light)).toBeGreaterThan(reach(plain));
  });

  it('changes no skill', () => expectSameKit('skirmisher', 'skirm_light_step'));
});

describe('Open Seams', () => {
  const skirm = (level: number | 0) => field(hero('skirmisher', level ? { skirm_open_seams: level } : {}));
  const blades = (owner: string, n = 1) =>
    foe({ activeEffects: [makeEffect(AfflictionType.Blades, { magnitude: n, duration: -1, sourceUnitId: owner })] });

  it('adds critical chance against an enemy with one of the Skirmisher\'s blades in it', () => {
    expect(critChanceAgainst(skirm(2), blades('hunter')) - critChanceAgainst(skirm(0), blades('hunter')))
      .toBe(openSeamsCrit(RANKS[1]));
    // Not more for more blades: it is a gap found, not a stack
    expect(critChanceAgainst(skirm(2), blades('hunter', 3))).toBe(critChanceAgainst(skirm(2), blades('hunter')));
  });

  it('ignores a clean enemy and another Skirmisher\'s blades', () => {
    expect(critChanceAgainst(skirm(2), foe())).toBe(critChanceAgainst(skirm(0), foe()));
    expect(critChanceAgainst(skirm(2), blades('other'))).toBe(critChanceAgainst(skirm(0), blades('other')));
  });

  it('reads the blades a real throw left', () => {
    const me = field(hero('skirmisher', { skirm_barbed: 1, skirm_open_seams: 2 }));
    useCombatStore.setState({ units: [me, foe()] });
    resolveSkillUse(me, skillOf(me, 'barbed_blades'), at(2, 0), SILENT_SINK);
    const struck = unitNow('foe');
    expect(struck.activeEffects.some((e) => e.type === AfflictionType.Blades && e.sourceUnitId === me.id)).toBe(true);
    expect(critChanceAgainst(me, struck) - critChanceAgainst(skirm(0), struck)).toBe(openSeamsCrit(RANKS[1]));
  });

  it('is 9 / 12 / 15 points by rank', () => {
    const b = blades('hunter');
    expect([1, 2, 3].map((l) => critChanceAgainst(skirm(l), b) - critChanceAgainst(skirm(0), b))).toEqual([9, 12, 15]);
  });

  it('changes no skill', () => expectSameKit('skirmisher', 'skirm_open_seams'));
});

describe('Coup de Grace', () => {
  const shade = (level: number | 0) => field(hero('shadowblade', level ? { shadow_coup_de_grace: level } : {}));

  it('adds 15 / 20 / 25% damage inside the execute window, and none above it', () => {
    const dying = foe({ currentHp: 50 });
    expect([1, 2, 3].map((l) => masteryTargetMultiplier(shade(l), dying))).toEqual([1.15, 1.2, 1.25].map((v) =>
      expect.closeTo(v, 5)));
    expect(masteryTargetMultiplier(shade(2), foe({ currentHp: 600 }))).toBe(1);
  });

  it('changes no skill', () => expectSameKit('shadowblade', 'shadow_coup_de_grace'));
});

describe('Unseen Blade', () => {
  const shade = (level: number | 0) => field(hero('shadowblade', level ? { shadow_unseen_blade: level } : {}));

  it('adds critical chance while Stealthed after Shadowstep, and drops it when the strike breaks Stealth', () => {
    const me = shade(2);
    useCombatStore.setState({ units: [me, foe({ position: at(3, 0) })] });
    resolveSkillUse(me, skillOf(me, 'shadowstep'), at(2, 0), SILENT_SINK);
    const hidden = unitNow('hunter');
    expect(hidden.activeEffects.some((e) => e.type === AuraType.Stealth)).toBe(true);
    const bare = { ...shade(0), activeEffects: hidden.activeEffects };
    expect(critChanceAgainst(hidden, unitNow('foe')) - critChanceAgainst(bare, unitNow('foe'))).toBe(unseenBladeCrit(RANKS[1]));
    // The sheet shows it while it holds: a stat, like Wrath
    expect(getCombatEffectiveStats(hidden).critChance).toBe((getCombatEffectiveStats(bare).critChance ?? 0) + 25);

    resolveSkillUse(hidden, skillOf(hidden, BASIC_ATTACK_ID), at(3, 0), SILENT_SINK);
    const seen = unitNow('hunter');
    expect(seen.activeEffects.some((e) => e.type === AuraType.Stealth)).toBe(false);
    expect(critChanceAgainst(seen, unitNow('foe'))).toBe(critChanceAgainst(shade(0), unitNow('foe')));
  });

  it('is 19 / 25 / 31 points by rank, and nothing in the open', () => {
    const stealth = [makeEffect(AuraType.Stealth, { duration: 2, magnitude: 1 })];
    const hidden = (l: number | 0) => ({ ...shade(l), activeEffects: stealth });
    expect([1, 2, 3].map((l) => critChanceAgainst(hidden(l), foe()) - critChanceAgainst(hidden(0), foe()))).toEqual([19, 25, 31]);
    expect(critChanceAgainst(shade(3), foe())).toBe(critChanceAgainst(shade(0), foe()));
  });

  it('reads its rank-two number in its Simple line', () => {
    expect(nodeSimpleText(findMasteryNode('shadow_unseen_blade')!.node, 2)).toContain('+25%');
  });

  it('changes no skill', () => expectSameKit('shadowblade', 'shadow_unseen_blade'));
});

// No advanced Hunter node grants a weapon, a skill or a Basic Attack: the hand still decides reach
describe('weapons', () => {
  it('leaves every path\'s Basic Attack the one its weapon makes', () => {
    for (const [path, nodes] of [
      ['marksman', { marks_opening_volley: 3, marks_eagle_eye: 2 }],
      ['skirmisher', { skirm_light_step: 1, skirm_open_seams: 3 }],
      ['shadowblade', { shadow_coup_de_grace: 3, shadow_unseen_blade: 2 }],
    ] as const) {
      expect(skillOf(field(hero(path, nodes)), BASIC_ATTACK_ID)).toEqual(skillOf(field(hero(path)), BASIC_ATTACK_ID));
    }
  });
});

/**
 * The level-26 row: Next Quarry, Buried Steel and Into the Dark, in a scripted
 * fight, on a hero who bought them through `canUnlockNode`. The figures come from
 * the formulas, so a retune moves these with it; what is pinned is the rule.
 */
const LEVEL_26_NODE: Record<string, string> = {
  marksman: 'marks_next_quarry', skirmisher: 'skirm_buried_steel', shadowblade: 'shadow_into_the_dark',
};

const pathOf = (id: MasteryId): MasteryPath => findMasteryPath(id)!;
const capstonesOf = (path: MasteryPath) => path.nodes.filter((n) => n.tier === 3 && !isSideNode(n));

function ancestry(path: MasteryPath, node: MasteryNode, seen = new Set<string>()): Set<string> {
  for (const parent of prerequisitesFor(path, node)) {
    if (seen.has(parent.id)) continue;
    seen.add(parent.id);
    ancestry(path, parent, seen);
  }
  return seen;
}

/**
 * Buy toward a capstone and its level-26 node through `canUnlockNode` alone: the
 * closure first, then `ranks` of the node, and with `spendAll` every point left.
 */
function bought(id: MasteryId, level: number, ranks: number, capstoneId = CAPSTONE[id], spendAll = false): Hero {
  const path = pathOf(id);
  const capstone = path.nodes.find((n) => n.id === capstoneId)!;
  const line = ancestry(path, capstone);
  const target = LEVEL_26_NODE[id];
  const h = makeHero({
    heroClass: HeroClass.Ranger,
    templateId: 'ranger',
    level,
    masteryPath: id,
    masteryPoints: pointsEarnedByLevel(level, id),
    masteryNodes: {},
    baseStats: makeStats({
      maxHp: 200, attack: 30, defense: 5, magic: 10, maxMana: 100,
      critChance: 0, critDamage: 150, dodgeChance: 0, moveRange: 3,
    }),
  });
  for (;;) {
    const open = path.nodes.filter((n) => canUnlockNode(h, n.id).ok);
    const needed = open.find((n) => (n.id === capstone.id || line.has(n.id)) && !h.masteryNodes[n.id]);
    const node = open.find((n) => n.id === target && (h.masteryNodes[target] ?? 0) < ranks);
    const pick = needed ?? node ?? (spendAll ? open[0] : undefined);
    if (!pick) break;
    h.masteryNodes = { ...h.masteryNodes, [pick.id]: (h.masteryNodes[pick.id] ?? 0) + 1 };
    h.masteryPoints -= pick.cost;
  }
  h.skills = deriveHeroSkills(h, []);
  return h;
}

const fieldAt26 = (id: MasteryId, ranks: number, unitId = 'hunter', q = 0, r = 0) =>
  field(bought(id, 26, ranks), unitId, q, r);

describe.each(['marksman', 'skirmisher', 'shadowblade'] as const)('the %s level-26 node', (id) => {
  const path = pathOf(id);
  const nodeId = LEVEL_26_NODE[id];
  afterEach(() => usePartyStore.getState().reset());

  it('stands in row 2, in the tree, behind any capstone', () => {
    const node = path.nodes.find((n) => n.id === nodeId)!;
    expect(node.masteryRow).toBe(2);
    expect(prerequisitesFor(path, node).map((n) => n.id).sort()).toEqual(capstonesOf(path).map((n) => n.id).sort());
    expect(maxLevelOf(node)).toBe(3);
  });

  it('is refused at 25 and sold at 26, through the store', () => {
    const closure = (level: number) => ({ ...bought(id, level, 0), masteryPoints: 5 });
    expect(canUnlockNode(closure(25), nodeId)).toEqual({ ok: false, reason: 'level-too-low', level: 26 });
    usePartyStore.setState({ heroes: [{ ...closure(25), id: 'h1' }] });
    expect(usePartyStore.getState().unlockMasteryNode('h1', nodeId)).toBe(false);
    usePartyStore.setState({ heroes: [{ ...closure(26), id: 'h1' }] });
    expect(usePartyStore.getState().unlockMasteryNode('h1', nodeId)).toBe(true);
  });

  it.each(capstonesOf(path).map((c) => c.id))('buys a legal 25-point build behind %s, every point spent', (capstoneId) => {
    const h = bought(id, 30, 3, capstoneId, true);
    expect(pointsEarnedByLevel(30, id)).toBe(25);
    expect(h.masteryPoints).toBe(0);
    expect(h.masteryNodes[nodeId]).toBe(3);
    const heldCapstones = capstonesOf(path).filter((c) => (h.masteryNodes[c.id] ?? 0) > 0).map((c) => c.id);
    expect(heldCapstones).toEqual([capstoneId]);
    const unit = field(h);
    const works = id === 'skirmisher' ? bladesCapOf(unit) > BALANCE.BLADES_CAP : hasPassive(unit, id === 'marksman' ? 'nextQuarry' : 'intoTheDark');
    expect(works).toBe(true);
  });

  it('reads whole at every rank in both languages', () => {
    const node = path.nodes.find((n) => n.id === nodeId)!;
    try {
      for (const locale of ['en'] as const) {
        setLocale(locale);
        for (const rank of [1, 2, 3]) {
          const text = nodeSimpleText(node, rank) ?? '';
          expect(text.length).toBeGreaterThan(0);
          expect(text).not.toMatch(/\{\w+\}|undefined|NaN|\.\w+\./);
          if (node.grantsPassive) {
            const figures = PASSIVE_DEFS[node.grantsPassive].figures!({ level: rank, scale: levelScale(node, rank) });
            for (const line of figures) expect(line).not.toMatch(/\{\w+\}|undefined|NaN/);
          }
        }
      }
    } finally {
      setLocale('en');
    }
  });
});

describe('Next Quarry', () => {
  const marked = (id: string, q: number, over: Partial<CombatUnit> = {}, owner = 'hunter', turns = 3) => foe({
    id, position: at(q, 0), currentHp: 1,
    activeEffects: [makeEffect(AfflictionType.Mark, { magnitude: 0.4, duration: turns, sourceUnitId: owner })],
    ...over,
  });
  const whole = (id: string, q: number, r = 0, over: Partial<CombatUnit> = {}) => foe({ id, position: at(q, r), ...over });
  const markOn = (id: string) => unitNow(id).activeEffects.find((e) => e.type === AfflictionType.Mark);
  const shoot = (me: CombatUnit, q: number) => resolveSkillUse(me, skillOf(me, 'mark_target'), at(q, 0), SILENT_SINK);

  it('passes a dead enemy\'s Mark to the nearest enemy, as a Mark its owner can spend', () => {
    const me = fieldAt26('marksman', 2);
    useCombatStore.setState({ units: [me, marked('dead', 3), whole('near', 4), whole('far', 5)] });
    shoot(me, 3);
    expect(unitNow('dead').currentHp).toBe(0);
    expect(markOn('near')).toMatchObject({ sourceUnitId: 'hunter', magnitude: 0.4 });
    expect(markOn('far')).toBeUndefined();
    expect(markMultiplier(me, unitNow('near'))).toBeCloseTo(1.4);
  });

  it.each([1, 2, 3])('reaches as far as rank %i says and no further', (rank) => {
    const reach = nextQuarryReach(RANKS[rank - 1]);
    const me = fieldAt26('marksman', rank);
    useCombatStore.setState({ units: [me, marked('dead', 2), whole('inside', 2 + reach)] });
    shoot(me, 2);
    expect(markOn('inside')).toBeDefined();

    resetFixtureIds();
    const beyond = fieldAt26('marksman', rank);
    useCombatStore.setState({ units: [beyond, marked('dead', 2), whole('outside', 2 + reach + 1)] });
    shoot(beyond, 2);
    expect(markOn('outside')).toBeUndefined();
  });

  it('keeps the turns it had left, with a floor', () => {
    const floor = BALANCE.ADVANCED_HUNTER.NEXT_QUARRY_MIN_TURNS;
    const me = fieldAt26('marksman', 2);
    useCombatStore.setState({ units: [me, marked('dead', 2, {}, 'hunter', floor + 1), whole('near', 3)] });
    shoot(me, 2);
    expect(markOn('near')?.duration).toBe(floor + 1);

    useCombatStore.setState({ units: [me, marked('dead', 2, {}, 'hunter', 1), whole('near', 3)] });
    shoot(me, 2);
    expect(markOn('near')?.duration).toBe(floor);
  });

  it('passes nothing when a Basic Attack cashed the Mark to make the kill', () => {
    const me = fieldAt26('marksman', 2);
    useCombatStore.setState({ units: [me, marked('dead', 1), whole('near', 2)] });
    resolveSkillUse(me, skillOf(me, BASIC_ATTACK_ID), at(1, 0), SILENT_SINK);
    expect(unitNow('dead').currentHp).toBe(0);
    expect(markOn('near')).toBeUndefined();
  });

  it('passes on a poison tick too, even when that tick was the Mark\'s last', () => {
    const me = fieldAt26('marksman', 2);
    const sick = marked('dead', 2, {}, 'hunter', 1);
    sick.activeEffects = [...sick.activeEffects, makeEffect(AfflictionType.Poison, { magnitude: 50, duration: 2, sourceUnitId: 'hunter' })];
    useCombatStore.setState({ units: [me, sick, whole('near', 3)] });
    state().tickEffectsOnUnit('dead');
    expect(unitNow('dead').currentHp).toBe(0);
    expect(markOn('near')?.duration).toBe(BALANCE.ADVANCED_HUNTER.NEXT_QUARRY_MIN_TURNS);
  });

  it('is spent by its first pass, so a second call down another path finds nothing', () => {
    const me = fieldAt26('marksman', 2);
    useCombatStore.setState({ units: [me, marked('dead', 2, { currentHp: 0 }), whole('near', 3)] });
    state().spreadMark('dead');
    expect(markOn('dead')).toBeUndefined();
    state().removeEffect('near', AfflictionType.Mark);
    state().spreadMark('dead');
    expect(markOn('near')).toBeUndefined();
  });

  it('skips an objective and anyone who cannot wear it', () => {
    const me = fieldAt26('marksman', 2);
    useCombatStore.setState({
      units: [
        me, marked('dead', 2, { currentHp: 0 }),
        whole('warded', 3, 0, { activeEffects: [makeEffect(AuraType.DebuffImmunity, { magnitude: 1, duration: 2 })] }),
        whole('standard', 2, 1, { objective: { kind: 'standard' } as CombatUnit['objective'] }),
        whole('open', 4),
      ],
    });
    state().spreadMark('dead');
    expect(markOn('warded')).toBeUndefined();
    expect(markOn('standard')).toBeUndefined();
    expect(markOn('open')).toBeDefined();
  });

  it('skips an enemy already wearing the owner\'s Mark, for the nearest without one', () => {
    const me = fieldAt26('marksman', 3);
    const wearing = () => marked('wearing', 3, { currentHp: 900 }, 'hunter', 1);
    useCombatStore.setState({ units: [me, marked('dead', 2, { currentHp: 0 }, 'hunter', 3), wearing(), whole('bare', 4)] });
    state().spreadMark('dead');
    expect(markOn('bare')).toMatchObject({ sourceUnitId: 'hunter', duration: 3 });
    // Its own Mark is left as it was, not refreshed by the pass
    expect(markOn('wearing')?.duration).toBe(1);
  });

  it('passes nothing when everyone in reach already wears it, and the Mark is still spent', () => {
    const me = fieldAt26('marksman', 1);
    const reach = nextQuarryReach(RANKS[0]);
    useCombatStore.setState({
      units: [me, marked('dead', 2, { currentHp: 0 }, 'hunter', 3), marked('wearing', 3, { currentHp: 900 }, 'hunter', 1), whole('beyond', 2 + reach + 1)],
    });
    state().spreadMark('dead');
    expect(markOn('wearing')?.duration).toBe(1);
    expect(markOn('beyond')).toBeUndefined();
    expect(markOn('dead')).toBeUndefined();
  });

  it('does not skip an enemy wearing another hunter\'s Mark', () => {
    const me = fieldAt26('marksman', 2);
    useCombatStore.setState({ units: [me, marked('dead', 2, { currentHp: 0 }), marked('theirs', 3, { currentHp: 900 }, 'other'), whole('further', 4)] });
    state().spreadMark('dead');
    expect(markOn('theirs')?.sourceUnitId).toBe('hunter');
    expect(markOn('further')).toBeUndefined();
  });

  it('is the owner\'s alone: no node, another hunter\'s Mark, or a dead owner passes nothing', () => {
    const me = fieldAt26('marksman', 0);
    useCombatStore.setState({ units: [me, marked('dead', 2, { currentHp: 0 }), whole('near', 3)] });
    state().spreadMark('dead');
    expect(markOn('near')).toBeUndefined();
    // Nothing without the node is even spent off the corpse
    expect(markOn('dead')).toBeDefined();

    const holder = fieldAt26('marksman', 2);
    useCombatStore.setState({ units: [holder, marked('dead', 2, { currentHp: 0 }, 'other'), whole('near', 3)] });
    state().spreadMark('dead');
    expect(markOn('near')).toBeUndefined();

    useCombatStore.setState({ units: [{ ...holder, currentHp: 0 }, marked('dead', 2, { currentHp: 0 }), whole('near', 3)] });
    state().spreadMark('dead');
    expect(markOn('near')).toBeUndefined();
  });
});

describe('Buried Steel', () => {
  const skirm = (rank: number, unitId = 'hunter', q = 0) => fieldAt26('skirmisher', rank, unitId, q);
  const held = (ownerId = 'hunter') => ownBlades(unitNow('foe'), ownerId);

  it.each([0, 1, 2, 3])('holds a pile at the rank %i cap, however many go in', (rank) => {
    const me = skirm(rank);
    useCombatStore.setState({ units: [me, foe()] });
    expect(state().embedBlades('foe', 'hunter', 20)).toBe(bladesCapOf(me));
    expect(held()).toBe(BALANCE.BLADES_CAP + rank * (bladesCapOf(skirm(1)) - BALANCE.BLADES_CAP));
  });

  it('adds a blade a rank, and leaves the plain cap to everyone else', () => {
    const caps = [0, 1, 2, 3].map((r) => bladesCapOf(skirm(r)));
    expect(caps[0]).toBe(BALANCE.BLADES_CAP);
    expect(caps.slice(1).map((c, i) => c - caps[i])).toEqual([1, 1, 1]);

    const me = skirm(3);
    const plain = skirm(0, 'other', 1);
    useCombatStore.setState({ units: [me, plain, foe()] });
    state().embedBlades('foe', 'hunter', 20);
    state().embedBlades('foe', 'other', 20);
    expect(held('hunter')).toBe(caps[3]);
    expect(held('other')).toBe(caps[0]);
  });

  it('lets a real throw lodge the blade the old cap refused', () => {
    const toss = (ranks: number) => {
      const me = field(hero('skirmisher', { skirm_barbed: 1, ...(ranks > 0 && { skirm_buried_steel: ranks }) }));
      useCombatStore.setState({ units: [me, foe()] });
      state().embedBlades('foe', 'hunter', BALANCE.BLADES_CAP);
      resolveSkillUse(me, skillOf(me, 'barbed_blades'), at(2, 0), SILENT_SINK);
      return held();
    };
    expect(toss(0)).toBe(BALANCE.BLADES_CAP);
    expect(toss(1)).toBe(BALANCE.BLADES_CAP + 1);
  });

  it('pays Blade Recall for every blade in the deeper pile', () => {
    // No critical on either pull: one would stand in for the blades this compares
    const dice = jest.spyOn(Math, 'random').mockReturnValue(0.99);
    const pull = (rank: number) => {
      const me = skirm(rank);
      useCombatStore.setState({ units: [me, foe()] });
      state().embedBlades('foe', 'hunter', 20);
      const before = unitNow('foe').currentHp;
      resolveSkillUse(me, skillOf(me, 'blade_recall'), at(2, 0), SILENT_SINK);
      expect(held()).toBe(0);
      return before - unitNow('foe').currentHp;
    };
    const plain = pull(0);
    const full = pull(3);
    expect(full).toBeGreaterThan(plain);
    dice.mockRestore();
    expect(full / plain).toBeCloseTo(bladesCapOf(skirm(3)) / BALANCE.BLADES_CAP, 0);
  });

  it('gives Barbed Blades nothing past its own ceiling', () => {
    const me = skirm(3);
    const barbed = findMasteryNode('skirm_barbed')!.node.grantsSkill!;
    const skill = { ...skillOf({ ...field(hero('skirmisher', { skirm_barbed: 1 })), id: 'hunter' }, barbed) };
    const pile = (n: number) => foe({ activeEffects: [makeEffect(AfflictionType.Blades, { magnitude: n, duration: -1, sourceUnitId: 'hunter' })] });
    expect(statusAmplifier(me, pile(bladesCapOf(me)), skill)).toBe(statusAmplifier(me, pile(BALANCE.BLADES_CAP), skill));
  });

  it('says the unit\'s own cap wherever a unit reads it, and the plain one for a unit without it', () => {
    const me = skirm(3);
    const plain = skirm(0);
    const recall = skillOf(me, 'blade_recall');
    const cap = bladesCapOf(me);
    expect(skillSimpleText(recall, me)).toContain(`${cap}`);
    expect(skillSimpleText(recall, plain)).not.toContain(`${cap}`);
    expect(skillEffectLines(recall, me).join(' ')).toContain(`${cap}`);
    expect(skillEffectLines(recall, plain).join(' ')).not.toContain(`${cap} of yours`);
  });

  it('states the rung\'s cap on the node', () => {
    const node = findMasteryNode('skirm_buried_steel')!.node;
    [1, 2, 3].forEach((rank) => {
      expect(nodeSimpleText(node, rank)).toContain(`${BALANCE.BLADES_CAP + rank}`);
    });
  });

  it('changes no skill', () => {
    const plain = skirm(0);
    const deep = skirm(3);
    for (const s of plain.skills) expect(skillOf(deep, s.id)).toEqual(s);
  });
});

describe('Into the Dark', () => {
  const shade = (rank: number, cooldowns: Record<string, number> = {}) => ({ ...fieldAt26('shadowblade', rank), cooldowns });
  const victim = (q = 1, over: Partial<CombatUnit> = {}) => foe({ position: at(q, 0), currentHp: 1, ...over });
  const cooldowns = () => unitNow('hunter').cooldowns ?? {};
  const SHADOWSTEP_COOLDOWN = 3;

  it.each([1, 2, 3])('brings only Shadowstep forward on a kill, by its rank %i rung', (rank) => {
    const me = shade(rank, { shadowstep: SHADOWSTEP_COOLDOWN, vanish: SHADOWSTEP_COOLDOWN });
    useCombatStore.setState({ units: [me, victim()] });
    resolveSkillUse(me, skillOf(me, BASIC_ATTACK_ID), at(1, 0), SILENT_SINK);
    expect(unitNow('foe').currentHp).toBe(0);
    expect(cooldowns().shadowstep ?? 0).toBe(Math.max(0, SHADOWSTEP_COOLDOWN - intoTheDarkTurns(RANKS[rank - 1])));
    expect(cooldowns().vanish).toBe(SHADOWSTEP_COOLDOWN);
  });

  it('is a full reset at rank three', () => {
    expect(intoTheDarkTurns(RANKS[2])).toBeGreaterThanOrEqual(skillOf(shade(3), 'shadowstep').cooldown!);
  });

  it('pays nothing for a blow that does not kill, nor without the node', () => {
    const me = shade(3, { shadowstep: SHADOWSTEP_COOLDOWN });
    useCombatStore.setState({ units: [me, victim(1, { currentHp: 900 })] });
    resolveSkillUse(me, skillOf(me, BASIC_ATTACK_ID), at(1, 0), SILENT_SINK);
    expect(cooldowns().shadowstep).toBe(SHADOWSTEP_COOLDOWN);

    const bare = shade(0, { shadowstep: SHADOWSTEP_COOLDOWN });
    useCombatStore.setState({ units: [bare, victim()] });
    resolveSkillUse(bare, skillOf(bare, BASIC_ATTACK_ID), at(1, 0), SILENT_SINK);
    expect(unitNow('foe').currentHp).toBe(0);
    expect(cooldowns().shadowstep).toBe(SHADOWSTEP_COOLDOWN);
  });

  it('does not count a poison tick', () => {
    const me = shade(3, { shadowstep: SHADOWSTEP_COOLDOWN });
    useCombatStore.setState({
      units: [me, victim(1, { activeEffects: [makeEffect(AfflictionType.Poison, { magnitude: 50, duration: 2, sourceUnitId: 'hunter' })] })],
    });
    state().tickEffectsOnUnit('foe');
    expect(unitNow('foe').currentHp).toBe(0);
    expect(cooldowns().shadowstep).toBe(SHADOWSTEP_COOLDOWN);
  });

  it('does not count the Assassinate execution', () => {
    const me = shade(3, { shadowstep: SHADOWSTEP_COOLDOWN });
    useCombatStore.setState({
      units: [me, victim(1, {
        activeEffects: [makeEffect(AfflictionType.DeathMark, { magnitude: BALANCE.DEATH_MARK_BONUS, duration: 3, sourceUnitId: 'hunter' })],
      })],
    });
    resolveDeathMarks('hunter', SILENT_SINK);
    expect(unitNow('foe').currentHp).toBe(0);
    expect(cooldowns().shadowstep).toBe(SHADOWSTEP_COOLDOWN);
  });

  it('counts Shadowstep\'s own killing blow, against the cooldown that step started', () => {
    const stepKill = (rank: number) => {
      const me = shade(rank);
      useCombatStore.setState({ units: [me, victim()] });
      resolveSkillUse(me, skillOf(me, 'shadowstep'), at(1, 0), SILENT_SINK);
      expect(unitNow('foe').currentHp).toBe(0);
      return cooldowns().shadowstep ?? 0;
    };
    const plain = stepKill(0);
    expect(plain).toBeGreaterThan(0);
    [1, 2, 3].forEach((rank) => {
      expect(stepKill(rank)).toBe(Math.max(0, plain - intoTheDarkTurns(RANKS[rank - 1])));
    });
  });

  it('still costs the step its action and its mana', () => {
    const me = shade(3);
    useCombatStore.setState({ units: [me, victim()] });
    const manaBefore = unitNow('hunter').currentMana;
    const result = resolveSkillUse(me, skillOf(me, 'shadowstep'), at(1, 0), SILENT_SINK);
    expect(result).toMatchObject({ ok: true, endsTurn: true });
    expect(unitNow('hunter').currentMana).toBe(manaBefore - skillOf(me, 'shadowstep').manaCost);
  });
});
