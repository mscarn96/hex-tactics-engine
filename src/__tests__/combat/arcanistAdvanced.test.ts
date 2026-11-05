import { bagFrom } from '@/data/items/bag';
import { useCombatStore } from '@/stores/combatStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { usePartyStore } from '@/stores/partyStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { applySkillStatus } from '@/systems/combat/combatEvents';
import { calculateDamage, detonationMultiplier } from '@/systems/combat/damageCalc';
import { createPlayerUnits } from '@/systems/combat/unitFactory';
import { requireUnit } from '@/systems/combat/unitLookup';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { PASSIVE_DEFS } from '@/systems/combat/passives';
import { flyingShardsDamage } from '@/systems/combat/passiveFormulas';
import { advancedNodes, canUnlockNode, isAdvancedNode, pointsEarnedByLevel, prerequisitesFor } from '@/systems/progression/mastery';
import { findMasteryPath } from '@/data/skills/masteryData';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { BALANCE } from '@/data/balanceConstants';
import { arc, cinderBurst, frostbite, iceBarrier, ignite } from '@/data/skills/masterySkills';
import {
  AfflictionType, AuraType, CombatUnit, Hero, HeroClass, HeroSkill, MasteryId, MasteryNode, MasteryPath,
} from '@/models/types';
import { at, makeEffect, makeFoe, makeHero, makeStats, resetFixtureIds } from '../support/fixtures';

/**
 * The Arcanist's level-21–25 advanced nodes, as rules through the real path: a
 * level-25 hero is fielded by `createPlayerUnits`, so each modifier reaches
 * combat the way a save's would, and the rule is read where the fight reads it.
 */

const CAPSTONE: Record<string, string> = {
  pyromancer: 'pyro_immolation', hydromancer: 'hydro_blizzard', stormcaller: 'storm_tempest',
};

const hero = (path: MasteryId, nodes: Record<string, number>, skills: HeroSkill[]): Hero =>
  makeHero({
    id: `h-${path}`, name: path, heroClass: HeroClass.Mage, level: 25,
    baseStats: makeStats({
      maxHp: 300, attack: 10, magic: 40, defense: 0, magicDefense: 0, maxMana: 400,
      critChance: 0, dodgeChance: 0, speed: 10,
    }),
    currentMana: 400,
    skills,
    masteryPath: path,
    masteryNodes: { [CAPSTONE[path]]: 1, ...nodes },
  });

/** A level-25 Arcanist as a fight fields it. */
const fielded = (
  id: string, path: MasteryId, nodes: Record<string, number>, skills: HeroSkill[], q = 0,
): CombatUnit => ({ ...createPlayerUnits([hero(path, nodes, skills)], [at(q, 0)])[0], id });

const foe = (id: string, q: number, over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, position: at(q, 0), stats: makeStats({ maxHp: 5000, defense: 0, magicDefense: 0 }), ...over });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const effect = (id: string, type: AfflictionType | AuraType) =>
  unitNow(id).activeEffects.find((e) => e.type === type);

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  useInventoryStore.setState({ bag: bagFrom({ gear: [] }) });
  state().reset();
});

afterEach(() => jest.restoreAllMocks());

describe('every Arcanist path at level 25', () => {
  it.each(['pyromancer', 'hydromancer', 'stormcaller'] as const)(
    '%s offers its advanced row behind any capstone',
    (pathId) => {
      const path = findMasteryPath(pathId)!;
      const advanced = advancedNodes(path).filter((n) => (n.masteryRow ?? 1) === 1);
      expect(advanced).toHaveLength(3);
      for (const capstone of path.nodes.filter((n) => n.exclusiveGroup === 'capstone')) {
        const h = hero(pathId, {}, []);
        h.masteryNodes = { [capstone.id]: 1 };
        h.masteryPoints = pointsEarnedByLevel(25, pathId) - 1;
        for (const n of advanced) expect(canUnlockNode(h, n.id).ok).toBe(true);
      }
    },
  );
});

// ─── Pyromancer ───────────────────────────────────────────────────────────────

describe('White Heat', () => {
  const pile = (stacker: string) =>
    foe('foe', 1, {
      activeEffects: [{ type: AfflictionType.Burn, magnitude: BALANCE.MAX_BURN_MAGNITUDE - 1, duration: 3, stacks: 4, sourceUnitId: stacker }],
    });

  it('lets Ignite stack a Burn pile past the usual ceiling, up to the raised one', () => {
    useCombatStore.setState({ units: [fielded('pyro', 'pyromancer', { pyro_white_heat: 2 }, [ignite]), pile('pyro')] });
    resolveSkillUse(unitNow('pyro'), ignite, at(1, 0), SILENT_SINK);
    const burn = effect('foe', AfflictionType.Burn)!;
    expect(burn.magnitude).toBeGreaterThan(BALANCE.MAX_BURN_MAGNITUDE);
    expect(burn.magnitude).toBeLessThanOrEqual(BALANCE.MAX_BURN_MAGNITUDE * 1.4 + 1e-9);
    expect(burn.stacks).toBe(5);
  });

  it('still stops at a ceiling: casting forever converges', () => {
    useCombatStore.setState({ units: [fielded('pyro', 'pyromancer', { pyro_white_heat: 3 }, [ignite]), pile('pyro')] });
    for (let i = 0; i < 12; i++) {
      state().applyEffect('foe', { type: AfflictionType.Burn, magnitude: 10, duration: 3, sourceUnitId: 'pyro' });
    }
    expect(effect('foe', AfflictionType.Burn)!.magnitude).toBeCloseTo(BALANCE.MAX_BURN_MAGNITUDE * 1.5);
  });

  it('is the stacking hand\'s: without the node the pile stops at MAX_BURN_MAGNITUDE', () => {
    useCombatStore.setState({ units: [fielded('pyro', 'pyromancer', {}, [ignite]), pile('pyro')] });
    resolveSkillUse(unitNow('pyro'), ignite, at(1, 0), SILENT_SINK);
    expect(effect('foe', AfflictionType.Burn)!.magnitude).toBe(BALANCE.MAX_BURN_MAGNITUDE);
  });
});

describe('Cataclysm', () => {
  const burning = () =>
    foe('foe', 1, { activeEffects: [makeEffect(AfflictionType.Burn, { magnitude: 10, duration: 3, stacks: 2 })] });

  it('grows the detonation bonus, not the strike under it', () => {
    const plain = fielded('pyro', 'pyromancer', {}, [cinderBurst]);
    const cata = fielded('pyro', 'pyromancer', { pyro_cataclysm: 2 }, [cinderBurst]);
    const base = detonationMultiplier(burning(), cinderBurst, plain) - 1;
    expect(base).toBeGreaterThan(0);
    expect(detonationMultiplier(burning(), cinderBurst, cata) - 1).toBeCloseTo(base * 1.3);
    // Nothing to detonate, nothing extra
    expect(detonationMultiplier(foe('cold', 1), cinderBurst, cata)).toBe(1);
  });

  it('lands in the damage a Cinder Burst deals', () => {
    const plain = fielded('pyro', 'pyromancer', {}, [cinderBurst]);
    const cata = fielded('pyro', 'pyromancer', { pyro_cataclysm: 3 }, [cinderBurst]);
    expect(calculateDamage(cata, burning(), cinderBurst)).toBeGreaterThan(calculateDamage(plain, burning(), cinderBurst));
    expect(calculateDamage(cata, foe('cold', 1), cinderBurst)).toBe(calculateDamage(plain, foe('cold', 1), cinderBurst));
  });
});

describe('Pyre Heart', () => {
  it('makes every Burn the hero lays bigger, so the pile fills in fewer casts', () => {
    const lay = (nodes: Record<string, number>) => {
      state().reset();
      useCombatStore.setState({ units: [fielded('pyro', 'pyromancer', nodes, [ignite]), foe('foe', 1)] });
      resolveSkillUse(unitNow('pyro'), ignite, at(1, 0), SILENT_SINK);
      return effect('foe', AfflictionType.Burn)!.magnitude;
    };
    expect(lay({ pyro_pyre_heart: 2 })).toBeGreaterThan(lay({}));
  });
});

// ─── Hydromancer ──────────────────────────────────────────────────────────────

describe('Permafrost', () => {
  const chillFrom = (casterId: string) =>
    applySkillStatus(unitNow(casterId), 'foe', {
      type: AfflictionType.Chill, magnitude: 3, duration: 3, sourceUnitId: casterId,
    }, SILENT_SINK);

  it('makes the Freeze a second Chill lays last one turn longer', () => {
    useCombatStore.setState({ units: [fielded('hydro', 'hydromancer', { hydro_permafrost: 1 }, [frostbite]), foe('foe', 1)] });
    chillFrom('hydro');
    chillFrom('hydro');
    expect(effect('foe', AfflictionType.Freeze)?.duration).toBe(BALANCE.FREEZE_DURATION + 1);
  });

  it('leaves the Freeze its usual length without the node', () => {
    useCombatStore.setState({ units: [fielded('hydro', 'hydromancer', {}, [frostbite]), foe('foe', 1)] });
    chillFrom('hydro');
    chillFrom('hydro');
    expect(effect('foe', AfflictionType.Freeze)?.duration).toBe(BALANCE.FREEZE_DURATION);
  });

  it('holds a boss\'s Brittle mark a turn longer too, and still never freezes it', () => {
    const bossTemplate = enemyTemplates.find((t) => t.tier === 'boss')!;
    useCombatStore.setState({
      units: [fielded('hydro', 'hydromancer', { hydro_permafrost: 1 }, [frostbite]), foe('foe', 1, { templateId: bossTemplate.id })],
    });
    chillFrom('hydro');
    chillFrom('hydro');
    expect(effect('foe', AfflictionType.Freeze)).toBeUndefined();
    expect(effect('foe', AfflictionType.Brittle)?.duration).toBe(BALANCE.BRITTLE_DURATION + 1);
  });
});

describe('Bitter Cold', () => {
  it('adds damage against a Chilled, Frozen or Brittle enemy and nothing against a warm one', () => {
    const plain = fielded('hydro', 'hydromancer', {}, [frostbite]);
    const bitter = fielded('hydro', 'hydromancer', { hydro_bitter_cold: 2 }, [frostbite]);
    const warm = foe('foe', 1);
    expect(calculateDamage(bitter, warm, frostbite)).toBe(calculateDamage(plain, warm, frostbite));
    for (const type of [AfflictionType.Chill, AfflictionType.Freeze, AfflictionType.Brittle]) {
      const cold = foe('foe', 1, { activeEffects: [makeEffect(type, { magnitude: 1, duration: 2 })] });
      expect(calculateDamage(bitter, cold, frostbite)).toBeGreaterThan(calculateDamage(plain, cold, frostbite));
    }
  });
});

describe('Glacial Bulwark', () => {
  it('makes the Barrier the Hydromancer grants absorb more', () => {
    const grant = (nodes: Record<string, number>) => {
      state().reset();
      useCombatStore.setState({
        units: [fielded('hydro', 'hydromancer', nodes, [iceBarrier]), { ...fielded('ally', 'hydromancer', {}, [], 1) }],
      });
      resolveSkillUse(unitNow('hydro'), iceBarrier, at(1, 0), SILENT_SINK);
      return effect('ally', AuraType.Barrier)!.magnitude;
    };
    expect(grant({ hydro_glacial_bulwark: 2 })).toBeGreaterThan(grant({}));
  });

  it('adds health to the Hydromancer', () => {
    const plain = fielded('hydro', 'hydromancer', {}, []);
    const bulwark = fielded('hydro', 'hydromancer', { hydro_glacial_bulwark: 2 }, []);
    expect(getCombatEffectiveStats(bulwark).maxHp).toBeGreaterThan(getCombatEffectiveStats(plain).maxHp);
  });
});

// ─── Stormcaller ──────────────────────────────────────────────────────────────

describe('High Voltage', () => {
  const jump = (nodes: Record<string, number>) => {
    state().reset();
    useCombatStore.setState({
      units: [
        fielded('storm', 'stormcaller', nodes, [arc]),
        foe('victim', 1, { activeEffects: [makeEffect(AfflictionType.Shock, { magnitude: 1, duration: 3 })] }),
        foe('beside', 2),
      ],
    });
    resolveSkillUse(unitNow('storm'), arc, at(1, 0), SILENT_SINK);
    return { jumped: 5000 - unitNow('beside').currentHp, struck: 5000 - unitNow('victim').currentHp };
  };

  it('makes the Shock jump carry a bigger share of the blow', () => {
    const plain = jump({});
    const hv = jump({ storm_high_voltage: 2 });
    expect(plain.jumped).toBeGreaterThan(0);
    expect(hv.struck).toBe(plain.struck);
    expect(hv.jumped).toBe(Math.max(1, Math.round(hv.struck * BALANCE.SHOCK_CHAIN_FRACTION * 1.5)));
  });

  it('adds nothing where there is no jump: a target that was not Shocked', () => {
    state().reset();
    useCombatStore.setState({ units: [fielded('storm', 'stormcaller', { storm_high_voltage: 3 }, [arc]), foe('victim', 1), foe('beside', 2)] });
    resolveSkillUse(unitNow('storm'), arc, at(1, 0), SILENT_SINK);
    expect(unitNow('beside').currentHp).toBe(5000);
  });
});

describe('Ionize', () => {
  it('adds damage against a Shocked enemy only', () => {
    const plain = fielded('storm', 'stormcaller', {}, [arc]);
    const ion = fielded('storm', 'stormcaller', { storm_ionize: 2 }, [arc]);
    const bare = foe('foe', 1);
    const shocked = foe('foe', 1, { activeEffects: [makeEffect(AfflictionType.Shock, { magnitude: 1, duration: 3 })] });
    expect(calculateDamage(ion, bare, arc)).toBe(calculateDamage(plain, bare, arc));
    expect(calculateDamage(ion, shocked, arc)).toBeGreaterThan(calculateDamage(plain, shocked, arc));
  });
});

describe('Quickening', () => {
  it('adds speed and Magic', () => {
    const plain = getCombatEffectiveStats(fielded('storm', 'stormcaller', {}, []));
    const quick = getCombatEffectiveStats(fielded('storm', 'stormcaller', { storm_quickening: 2 }, []));
    expect(quick.speed).toBeGreaterThan(plain.speed);
    expect(quick.magic).toBeGreaterThan(plain.magic);
  });
});

// ─── Level 26 ─────────────────────────────────────────────────────────────────

/**
 * The level-26 node of each path, in a fight, bought as a player buys it: the store
 * refuses it at 25 and sells it at 26, and the hero that fight fields is the one the
 * store holds. The figures are read back off the fielded unit, so these pin the rule.
 */
const LEVEL_26 = [
  ['pyromancer', 'pyro_brimming_over'],
  ['hydromancer', 'hydro_flying_shards'],
  ['stormcaller', 'storm_forked_current'],
] as const;

function bought(id: string, path: MasteryId, nodeId: string, rank: number, skills: HeroSkill[], extra: Record<string, number> = {}): CombatUnit {
  const buyer = (level: number): Hero => ({
    ...hero(path, extra, skills), level, masteryPoints: 5,
  });
  usePartyStore.setState({ heroes: [buyer(25)] });
  const heroId = buyer(25).id;
  expect(usePartyStore.getState().unlockMasteryNode(heroId, nodeId)).toBe(false);
  usePartyStore.setState({ heroes: [buyer(26)] });
  for (let i = 0; i < rank; i++) expect(usePartyStore.getState().unlockMasteryNode(heroId, nodeId)).toBe(true);
  const [unit] = createPlayerUnits([usePartyStore.getState().heroes[0]], [at(0, 0)]);
  return { ...unit, id };
}

const hpLost = (id: string) => 5000 - unitNow(id).currentHp;

/** Every node a node stands on, all the way up. */
function closure(path: MasteryPath, node: MasteryNode, seen = new Set<string>()): Set<string> {
  for (const parent of prerequisitesFor(path, node)) {
    if (!seen.has(parent.id)) {
      seen.add(parent.id);
      closure(path, parent, seen);
    }
  }
  return seen;
}

describe('the level-26 nodes', () => {
  afterEach(() => usePartyStore.getState().reset());

  describe.each(LEVEL_26)('%s', (pathId, nodeId) => {
    const path = findMasteryPath(pathId)!;
    const node = path.nodes.find((n) => n.id === nodeId)!;
    const capstones = path.nodes.filter((n) => n.exclusiveGroup === 'capstone');

    it('stands in row 2, behind any capstone, with three ranks', () => {
      expect(isAdvancedNode(node)).toBe(true);
      expect(node.masteryRow).toBe(2);
      expect(node.requiresCount).toBe(1);
      expect([...node.requires!].sort()).toEqual(capstones.map((c) => c.id).sort());
    });

    // The 25 points of level 30, spent through `canUnlockNode` alone
    it.each(capstones.map((c) => [c.id, c] as const))('fits a legal 25-point build toward %s', (_c, capstone) => {
      const line = closure(path, capstone);
      const order = (n: MasteryNode) => (n === node ? 0 : n === capstone ? 2 : line.has(n.id) ? 1 : 3);
      const h: Hero = { ...hero(pathId, {}, []), level: 30, masteryNodes: {}, masteryPoints: pointsEarnedByLevel(30, pathId) };
      expect(h.masteryPoints).toBe(25);
      const picked: MasteryNode[] = [];
      for (;;) {
        const open = path.nodes
          .filter((n) => !picked.some((p) => p.id !== n.id && !!p.exclusiveGroup && p.exclusiveGroup === n.exclusiveGroup))
          .filter((n) => canUnlockNode(h, n.id).ok);
        if (open.length === 0) break;
        const pick = open.sort((a, b) => order(a) - order(b))[0];
        picked.push(pick);
        h.masteryNodes = { ...h.masteryNodes, [pick.id]: (h.masteryNodes[pick.id] ?? 0) + 1 };
        h.masteryPoints -= pick.cost;
      }
      expect(h.masteryPoints).toBe(0);
      expect(h.masteryNodes[nodeId]).toBe(3);
      expect(h.masteryNodes[capstone.id]).toBeGreaterThan(0);
      expect(capstones.filter((c) => h.masteryNodes[c.id])).toEqual([capstone]);
    });
  });
});

describe('Brimming Over', () => {
  const pyro = (rank = 2, extra: Record<string, number> = {}) => bought('pyro', 'pyromancer', 'pyro_brimming_over', rank, [ignite], extra);
  const burnOn = (id: string) => effect(id, AfflictionType.Burn)?.magnitude;
  /** What one Ignite lays from this hero, on nothing. */
  const igniteBurn = (unit: CombatUnit) => {
    state().reset();
    useCombatStore.setState({ units: [unit, foe('dummy', 1)] });
    resolveSkillUse(unitNow(unit.id), ignite, at(1, 0), SILENT_SINK);
    const laid = burnOn('dummy')!;
    state().reset();
    return laid;
  };
  const pile = (id: string, q: number, magnitude: number, over: Partial<CombatUnit> = {}) =>
    foe(id, q, {
      activeEffects: [{ type: AfflictionType.Burn, magnitude, duration: 3, stacks: 3, sourceUnitId: 'pyro' }],
      ...over,
    });

  const CEILING = BALANCE.MAX_BURN_MAGNITUDE;

  it('spills its share of what the ceiling refused onto the nearest enemy, and the target stays at the ceiling', () => {
    for (const rank of [1, 2, 3]) {
      const unit = pyro(rank);
      const share = unit.masteryModifiers!.burnOverflowShare!;
      const laid = igniteBurn(unit);
      useCombatStore.setState({ units: [unit, pile('target', 1, CEILING - 1), foe('near', 2), foe('far', 3)] });
      resolveSkillUse(unitNow('pyro'), ignite, at(1, 0), SILENT_SINK);
      expect(burnOn('target')).toBe(CEILING);
      expect(burnOn('near')).toBeCloseTo((laid - 1) * share);
      expect(burnOn('far')).toBeUndefined();
    }
    expect(pyro(3).masteryModifiers!.burnOverflowShare).toBeGreaterThan(pyro(1).masteryModifiers!.burnOverflowShare!);
  });

  it('spills nothing while the pile has room, nor from a Burn that starts one', () => {
    const unit = pyro();
    useCombatStore.setState({ units: [unit, pile('target', 1, 0.5), foe('near', 2)] });
    resolveSkillUse(unitNow('pyro'), ignite, at(1, 0), SILENT_SINK);
    expect(burnOn('near')).toBeUndefined();
    state().reset();
    useCombatStore.setState({ units: [unit, foe('target', 1), foe('near', 2)] });
    state().applyEffect('target', { type: AfflictionType.Burn, magnitude: CEILING + 5, duration: 3, sourceUnitId: 'pyro' });
    expect(burnOn('near')).toBeUndefined();
  });

  it('counts only what arrived, on a pile already past this hand\'s ceiling', () => {
    const unit = pyro();
    const share = unit.masteryModifiers!.burnOverflowShare!;
    useCombatStore.setState({ units: [unit, pile('target', 1, CEILING + 8), foe('near', 2)] });
    state().applyEffect('target', { type: AfflictionType.Burn, magnitude: 2, duration: 3, sourceUnitId: 'pyro' });
    expect(burnOn('near')).toBeCloseTo(2 * share);
  });

  it('pulls against White Heat: the raised ceiling holds what would have spilled', () => {
    const unit = pyro(2, { pyro_white_heat: 3 });
    useCombatStore.setState({ units: [unit, pile('target', 1, CEILING - 1), foe('near', 2)] });
    state().applyEffect('target', { type: AfflictionType.Burn, magnitude: 3, duration: 3, sourceUnitId: 'pyro' });
    expect(burnOn('target')).toBe(CEILING + 2);
    expect(burnOn('near')).toBeUndefined();
  });

  it('is the holder\'s: another hand\'s Burn past the ceiling is lost as before', () => {
    const plain = fielded('pyro', 'pyromancer', {}, [ignite]);
    useCombatStore.setState({ units: [plain, pile('target', 1, CEILING - 1), foe('near', 2)] });
    resolveSkillUse(unitNow('pyro'), ignite, at(1, 0), SILENT_SINK);
    expect(burnOn('near')).toBeUndefined();
  });

  it('never lands past its reach, on an ally, or on an objective', () => {
    const reach = BALANCE.ARCANIST_ROW_TWO.BURN_OVERFLOW_REACH;
    const unit = pyro();
    const objective = foe('stone', 2, { objective: { id: 'stone' } } as unknown as Partial<CombatUnit>);
    const friend = { ...foe('friend', 2), position: at(1, 1), isPlayer: true };
    useCombatStore.setState({ units: [unit, pile('target', 1, CEILING), objective, friend, foe('beyond', 1 + reach + 1)] });
    state().applyEffect('target', { type: AfflictionType.Burn, magnitude: 4, duration: 3, sourceUnitId: 'pyro' });
    for (const id of ['stone', 'friend', 'beyond']) expect(burnOn(id)).toBeUndefined();
  });

  it('passes over a Burn-immune enemy and one at its own ceiling, for the next one in reach', () => {
    const spark = PASSIVE_DEFS.spark;
    PASSIVE_DEFS.spark = { ...spark, immuneTo: [AfflictionType.Burn] };
    try {
      const unit = pyro();
      const immune = foe('immune', 2, { passives: ['spark'] });
      const taker = foe('taker', 3);
      useCombatStore.setState({ units: [unit, pile('target', 1, CEILING), immune, pile('full', 0, CEILING), taker] });
      state().applyEffect('target', { type: AfflictionType.Burn, magnitude: 4, duration: 3, sourceUnitId: 'pyro' });
      expect(burnOn('immune')).toBeUndefined();
      expect(burnOn('full')).toBe(CEILING);
      expect(burnOn('taker')).toBeGreaterThan(0);
    } finally {
      PASSIVE_DEFS.spark = spark;
    }
  });

  it('never spills twice: a spill that overfills its receiver is lost, and leaves no mark on the Burn', () => {
    const unit = pyro();
    useCombatStore.setState({ units: [unit, pile('target', 1, CEILING), pile('near', 2, CEILING - 0.1), foe('beyond', 3)] });
    state().applyEffect('target', { type: AfflictionType.Burn, magnitude: 8, duration: 3, sourceUnitId: 'pyro' });
    expect(burnOn('near')).toBe(CEILING);
    expect(burnOn('beyond')).toBeUndefined();

    state().reset();
    useCombatStore.setState({ units: [unit, pile('target', 1, CEILING), foe('near', 2)] });
    state().applyEffect('target', { type: AfflictionType.Burn, magnitude: 8, duration: 3, sourceUnitId: 'pyro' });
    expect(effect('near', AfflictionType.Burn)).not.toHaveProperty('spilled');
    expect(effect('near', AfflictionType.Burn)?.sourceUnitId).toBe('pyro');
  });

  it('says where it went, as a skill lands it', () => {
    const unit = pyro();
    useCombatStore.setState({ units: [unit, pile('target', 1, CEILING), foe('near', 2)] });
    const lines: string[] = [];
    resolveSkillUse(unitNow('pyro'), ignite, at(1, 0), { ...SILENT_SINK, log: (text: string) => lines.push(text) });
    expect(lines.some((l) => l.includes(unitNow('near').name))).toBe(true);
  });
});

describe('Flying Shards', () => {
  const hydro = (rank = 2, skills = [frostbite]) => bought('hydro', 'hydromancer', 'hydro_flying_shards', rank, skills);
  const ice = (type: AfflictionType.Freeze | AfflictionType.Brittle = AfflictionType.Freeze) =>
    [makeEffect(type, { magnitude: 1, duration: 2 })];
  const shard = (unit: CombatUnit) =>
    flyingShardsDamage(getCombatEffectiveStats(unit).magic, unit.passiveRanks!.flyingShards!);
  const strike = (q = 1) => resolveSkillUse(unitNow('hydro'), frostbite, at(q, 0), SILENT_SINK);

  it('throws ice at every other enemy beside the break, by rank, and Chills them', () => {
    for (const rank of [1, 2, 3]) {
      state().reset();
      const unit = hydro(rank);
      useCombatStore.setState({ units: [unit, foe('struck', 1, { activeEffects: ice() }), foe('east', 2), foe('south', 1, { position: at(1, 1) }), foe('far', 3)] });
      strike();
      for (const id of ['east', 'south']) {
        expect(hpLost(id)).toBe(shard(unit));
        const chill = effect(id, AfflictionType.Chill)!;
        expect(chill.magnitude).toBe(BALANCE.ARCANIST_ROW_TWO.SHARD_CHILL);
        expect(chill.duration).toBe(BALANCE.ARCANIST_ROW_TWO.SHARD_CHILL_TURNS);
        expect(chill.sourceUnitId).toBe('hydro');
      }
      expect(hpLost('far')).toBe(0);
    }
    expect(shard(hydro(3))).toBeGreaterThan(shard(hydro(1)));
  });

  it('reads Magic as the sheet shows it, not the base number', () => {
    const unit = hydro();
    const buffed: CombatUnit = { ...unit, activeEffects: [makeEffect(AuraType.MagicBuff, { magnitude: 40, duration: 3 })] };
    expect(getCombatEffectiveStats(buffed).magic).toBeGreaterThan(unit.stats.magic);
    useCombatStore.setState({ units: [buffed, foe('struck', 1, { activeEffects: ice() }), foe('east', 2)] });
    strike();
    expect(hpLost('east')).toBe(shard(buffed));
  });

  it('goes off a boss\'s Brittle mark as off a Freeze', () => {
    const bossTemplate = enemyTemplates.find((t) => t.tier === 'boss')!;
    useCombatStore.setState({
      units: [hydro(), foe('struck', 1, { templateId: bossTemplate.id, activeEffects: ice(AfflictionType.Brittle) }), foe('east', 2)],
    });
    strike();
    expect(hpLost('east')).toBeGreaterThan(0);
  });

  it('never makes a Freeze: a Chilled neighbour stays Chilled, a Frozen one gets no Chill', () => {
    useCombatStore.setState({
      units: [
        hydro(),
        foe('struck', 1, { activeEffects: ice() }),
        foe('cold', 2, { activeEffects: [makeEffect(AfflictionType.Chill, { magnitude: 1, duration: 5 })] }),
        foe('frozen', 1, { position: at(1, 1), activeEffects: ice() }),
      ],
    });
    strike();
    expect(effect('cold', AfflictionType.Freeze)).toBeUndefined();
    expect(effect('cold', AfflictionType.Chill)?.duration).toBe(5);
    expect(hpLost('cold')).toBeGreaterThan(0);
    expect(effect('frozen', AfflictionType.Chill)).toBeUndefined();
    expect(hpLost('frozen')).toBeGreaterThan(0);
  });

  it('throws once a turn, and again the next turn', () => {
    const unit = hydro();
    useCombatStore.setState({
      units: [unit, foe('first', 1, { activeEffects: ice() }), foe('second', 3, { activeEffects: ice() }), foe('beside', 2)],
    });
    strike(1);
    const once = hpLost('beside');
    expect(once).toBe(shard(unit));
    useCombatStore.setState({ units: state().units.map((u) => (u.id === 'second' ? { ...u, activeEffects: ice() } : u)) });
    strike(3);
    expect(hpLost('beside')).toBe(once);
    useCombatStore.setState({ turnSerial: state().turnSerial + 1 });
    useCombatStore.setState({ units: state().units.map((u) => (u.id === 'first' ? { ...u, activeEffects: ice() } : u)) });
    strike(1);
    expect(hpLost('beside')).toBeGreaterThan(once);
  });

  it('spends nothing on a break with nobody beside it', () => {
    useCombatStore.setState({ units: [hydro(), foe('alone', 1, { activeEffects: ice() }), foe('later', 4, { activeEffects: ice() }), foe('beside', 5)] });
    strike(1);
    strike(4);
    expect(hpLost('beside')).toBeGreaterThan(0);
  });

  it('needs ice: a plain blow throws nothing, and neither does the node unbought', () => {
    useCombatStore.setState({ units: [hydro(), foe('struck', 1), foe('east', 2)] });
    strike();
    expect(hpLost('east')).toBe(0);
    state().reset();
    useCombatStore.setState({
      units: [fielded('hydro', 'hydromancer', {}, [frostbite]), foe('struck', 1, { activeEffects: ice() }), foe('east', 2)],
    });
    strike();
    expect(hpLost('east')).toBe(0);
  });
});

describe('Forked Current', () => {
  const storm = (rank = 2, extra: Record<string, number> = {}) => bought('storm', 'stormcaller', 'storm_forked_current', rank, [arc], extra);
  const shockedFoe = (id: string, q: number, over: Partial<CombatUnit> = {}) =>
    foe(id, q, { activeEffects: [makeEffect(AfflictionType.Shock, { magnitude: 1, duration: 3 })], ...over });
  const cast = () => resolveSkillUse(unitNow('storm'), arc, at(1, 0), SILENT_SINK);

  it('hops once more off the first victim, for its share of the first jump, by rank', () => {
    for (const rank of [1, 2, 3]) {
      state().reset();
      const unit = storm(rank);
      useCombatStore.setState({ units: [unit, shockedFoe('struck', 1), foe('first', 2), foe('second', 3)] });
      cast();
      expect(hpLost('first')).toBeGreaterThan(0);
      expect(hpLost('second')).toBe(Math.max(1, Math.round(hpLost('first') * unit.masteryModifiers!.shockSecondHop!)));
    }
    expect(storm(3).masteryModifiers!.shockSecondHop).toBeGreaterThan(storm(1).masteryModifiers!.shockSecondHop!);
  });

  it('never hops back to the struck enemy, and never a third time', () => {
    useCombatStore.setState({ units: [storm(), shockedFoe('struck', 1), foe('first', 2), foe('second', 3), foe('third', 4)] });
    cast();
    expect(hpLost('third')).toBe(0);

    state().reset();
    // The first victim has only the struck enemy beside it: the hop has nowhere to go
    useCombatStore.setState({ units: [storm(), shockedFoe('struck', 1), foe('first', 2)] });
    const lost = jest.fn();
    const damageUnit = state().damageUnit;
    useCombatStore.setState({ damageUnit: (...args: Parameters<typeof damageUnit>) => { lost(args[0]); return damageUnit(...args); } });
    cast();
    expect(lost.mock.calls.map(([id]) => id)).toEqual(['struck', 'first']);
  });

  it('picks the lowest-health enemy beside the first victim', () => {
    useCombatStore.setState({
      units: [
        storm(), shockedFoe('struck', 1), foe('first', 2),
        foe('healthy', 3), foe('hurt', 3, { position: at(3, -1), currentHp: 2000 }),
      ],
    });
    cast();
    expect(hpLost('healthy')).toBe(0);
    expect(unitNow('hurt').currentHp).toBeLessThan(2000);
  });

  it('still hops when the first jump kills', () => {
    useCombatStore.setState({ units: [storm(), shockedFoe('struck', 1), foe('first', 2, { currentHp: 1 }), foe('second', 3)] });
    cast();
    expect(unitNow('first').currentHp).toBe(0);
    expect(hpLost('second')).toBeGreaterThan(0);
  });

  it('grows with what raises the first jump', () => {
    const second = (extra: Record<string, number>) => {
      state().reset();
      useCombatStore.setState({ units: [storm(2, extra), shockedFoe('struck', 1), foe('first', 2), foe('second', 3)] });
      cast();
      return hpLost('second');
    };
    expect(second({ storm_high_voltage: 3 })).toBeGreaterThan(second({}));
  });

  it('needs a jump: an unshocked target forks nothing, and neither does the node unbought', () => {
    useCombatStore.setState({ units: [storm(), foe('struck', 1), foe('first', 2), foe('second', 3)] });
    cast();
    expect(hpLost('first') + hpLost('second')).toBe(0);
    state().reset();
    useCombatStore.setState({ units: [fielded('storm', 'stormcaller', {}, [arc]), shockedFoe('struck', 1), foe('first', 2), foe('second', 3)] });
    cast();
    expect(hpLost('first')).toBeGreaterThan(0);
    expect(hpLost('second')).toBe(0);
  });

  it('forks a companion\'s echo on its owner\'s node', () => {
    const elemental = (owner: CombatUnit): CombatUnit => ({
      ...owner, id: 'pet', companion: true, summonedBy: 'storm', masteryModifiers: {}, position: at(0, 1),
    });
    const echoed = (owner: CombatUnit) => {
      state().reset();
      useCombatStore.setState({ units: [owner, elemental(owner), shockedFoe('struck', 1), foe('first', 2), foe('second', 3)] });
      resolveSkillUse(unitNow('pet'), arc, at(1, 0), SILENT_SINK, { echo: true, fixedHexes: [at(1, 0)] });
      return hpLost('second');
    };
    expect(echoed(storm())).toBeGreaterThan(0);
    expect(echoed(fielded('storm', 'stormcaller', {}, [arc]))).toBe(0);
  });
});
