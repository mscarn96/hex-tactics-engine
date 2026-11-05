import { bagFrom } from '@/data/items/bag';
import { useCombatStore } from '@/stores/combatStore';
import { usePartyStore } from '@/stores/partyStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { beginTurn } from '@/systems/combat/turnStart';
import { planOpeningForms, takeOpeningForms } from '@/systems/combat/openingForms';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { createPlayerUnits } from '@/systems/combat/unitFactory';
import { requireUnit, unitById } from '@/systems/combat/unitLookup';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { combatMaxHp } from '@/systems/combat/forms';
import { skillsForForm } from '@/systems/combat/wildshape';
import {
  advancedNodes, canUnlockNode, deriveHeroSkills, isAdvancedNode, masteryFormRanks, pointsEarnedByLevel,
  pointsSpent, prerequisitesFor,
} from '@/systems/progression/mastery';
import { findMasteryPath } from '@/data/skills/masteryData';
import { nodeSimpleText } from '@/data/display/simpleText';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { BALANCE } from '@/data/balanceConstants';
import { graspingEarth, lifebloomSkill, maul, stoneskin, tremor } from '@/data/skills/masterySkills';
import {
  AfflictionType, AuraType, CombatUnit, Hero, HeroClass, HeroSkill, MasteryId, MasteryNode,
} from '@/models/types';
import { at, makeEffect, makeFoe, makeHero, makeStats, resetFixtureIds } from '../support/fixtures';

/**
 * The Druid's level-21–25 advanced nodes, as rules through the real path: a
 * level-25 hero fielded by `createPlayerUnits`, and the Wildshape row held to
 * the one rule it must never bend — one shape, for good.
 */

const CAPSTONE: Record<string, string> = {
  lifewarden: 'life_wellspring', stoneshaper: 'stone_heart', wildshape: 'wild_apex',
};

const hero = (path: MasteryId, nodes: Record<string, number>, skills: HeroSkill[]): Hero =>
  makeHero({
    id: `h-${path}`, name: path, heroClass: HeroClass.Healer, templateId: 'healer', level: 25,
    baseStats: makeStats({
      maxHp: 300, attack: 30, magic: 40, defense: 0, magicDefense: 0, maxMana: 400,
      critChance: 0, dodgeChance: 0, speed: 10,
    }),
    currentHp: 300,
    currentMana: 400,
    skills,
    masteryPath: path,
    masteryNodes: { [CAPSTONE[path]]: 1, ...nodes },
  });

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

// ─── Lifewarden ───────────────────────────────────────────────────────────────

describe('Overflowing Grace', () => {
  const mend = (nodes: Record<string, number>, allyHp: number) => {
    state().reset();
    const ally = { ...fielded('ally', 'lifewarden', {}, [], 1) };
    useCombatStore.setState({
      units: [fielded('life', 'lifewarden', nodes, [lifebloomSkill]), { ...ally, currentHp: allyHp }],
    });
    resolveSkillUse(unitNow('life'), lifebloomSkill, at(1, 0), SILENT_SINK);
    return effect('ally', AuraType.Barrier)?.magnitude ?? 0;
  };

  it('turns a heal on an ally at full health into a Barrier', () => {
    expect(mend({ life_overflowing_grace: 2 }, 300)).toBeGreaterThan(0);
    expect(effect('ally', AuraType.Barrier)?.duration).toBe(BALANCE.OVERHEAL_BARRIER_TURNS);
  });

  it('leaves no Barrier when the whole heal went into health', () => {
    expect(mend({ life_overflowing_grace: 3 }, 20)).toBe(0);
  });

  it('grows with the rung, and is nothing without the node', () => {
    expect(mend({}, 300)).toBe(0);
    expect(mend({ life_overflowing_grace: 3 }, 300)).toBeGreaterThan(mend({ life_overflowing_grace: 1 }, 300));
  });
});

describe('Verdant Hands and Evergreen', () => {
  it('Verdant Hands raises healing power; Evergreen makes the heal-over-time stronger', () => {
    const plain = fielded('life', 'lifewarden', {}, []);
    expect(getCombatEffectiveStats(fielded('life', 'lifewarden', { life_verdant_hands: 2 }, [])).healPower ?? 0)
      .toBeGreaterThan(getCombatEffectiveStats(plain).healPower ?? 0);

    const hot = (nodes: Record<string, number>) => {
      state().reset();
      useCombatStore.setState({ units: [fielded('life', 'lifewarden', nodes, [lifebloomSkill]), fielded('ally', 'lifewarden', {}, [], 1)] });
      resolveSkillUse(unitNow('life'), lifebloomSkill, at(1, 0), SILENT_SINK);
      return effect('ally', AuraType.HealOverTime)!.magnitude;
    };
    expect(hot({ life_evergreen: 2 })).toBeGreaterThan(hot({}));
  });
});

// ─── Stoneshaper ──────────────────────────────────────────────────────────────

describe('Deep Grip', () => {
  const rootFrom = (nodes: Record<string, number>) => {
    state().reset();
    useCombatStore.setState({ units: [fielded('stone', 'stoneshaper', nodes, [graspingEarth]), foe('foe', 2)] });
    resolveSkillUse(unitNow('stone'), graspingEarth, at(2, 0), SILENT_SINK);
    return effect('foe', AfflictionType.Root)?.duration;
  };

  it('makes a Root the Stoneshaper lays hold one turn longer', () => {
    const base = rootFrom({});
    expect(base).toBeDefined();
    expect(rootFrom({ stone_deep_grip: 1 })).toBe(base! + 1);
  });

  it('touches only Roots, and only the holder\'s own', () => {
    useCombatStore.setState({ units: [fielded('stone', 'stoneshaper', { stone_deep_grip: 1 }, []), foe('foe', 2), foe('other', 3)] });
    state().applyEffect('foe', { type: AfflictionType.Chill, magnitude: 1, duration: 2, sourceUnitId: 'stone' });
    state().applyEffect('foe', { type: AfflictionType.Root, magnitude: 1, duration: 2, sourceUnitId: 'other' });
    expect(effect('foe', AfflictionType.Chill)?.duration).toBe(2);
    expect(effect('foe', AfflictionType.Root)?.duration).toBe(2);
  });
});

describe('Crushing Weight', () => {
  it('adds damage against a Rooted or Stunned enemy and nothing against a free one', () => {
    const plain = fielded('stone', 'stoneshaper', {}, [tremor]);
    const heavy = fielded('stone', 'stoneshaper', { stone_crushing_weight: 2 }, [tremor]);
    const free = foe('foe', 1);
    expect(calculateDamage(heavy, free, tremor)).toBe(calculateDamage(plain, free, tremor));
    for (const type of [AfflictionType.Root, AfflictionType.Stun]) {
      const pinned = foe('foe', 1, { activeEffects: [makeEffect(type, { magnitude: 1, duration: 2 })] });
      expect(calculateDamage(heavy, pinned, tremor)).toBeGreaterThan(calculateDamage(plain, pinned, tremor));
    }
  });
});

describe('Granite Mantle', () => {
  it('makes the Barrier Stoneskin closes over an ally hold more', () => {
    const shell = (nodes: Record<string, number>) => {
      state().reset();
      useCombatStore.setState({ units: [fielded('stone', 'stoneshaper', nodes, [stoneskin]), fielded('ally', 'stoneshaper', {}, [], 1)] });
      resolveSkillUse(unitNow('stone'), stoneskin, at(1, 0), SILENT_SINK);
      return effect('ally', AuraType.Barrier)!.magnitude;
    };
    expect(shell({ stone_granite_mantle: 2 })).toBeGreaterThan(shell({}));
  });
});

// ─── Wildshape ────────────────────────────────────────────────────────────────

const BEAR = ['wild_bear', 'wild_bear_slam', 'wild_bear_hibernate', 'wild_bear_leap', 'wild_bear_shrug'];
const WOLF = ['wild_wolf', 'wild_wolf_throat', 'wild_wolf_howl', 'wild_wolf_slip', 'wild_wolf_rending'];
const HAWK = ['wild_hawk', 'wild_hawk_screech', 'wild_hawk_cyclone', 'wild_hawk_shear', 'wild_hawk_mark'];
const wildPath = findMasteryPath('wildshape')!;
const healerSkills = heroTemplates.find((t) => t.id === 'healer')!.skills;

/** A level-25 Bear Druid holding Apex and every rank of the whole advanced row. */
function bearWithEverything(): Hero {
  const nodes: Record<string, number> = Object.fromEntries(BEAR.map((id) => [id, 1]));
  nodes.wild_apex = 1;
  for (const n of advancedNodes(wildPath)) nodes[n.id] = n.maxLevel ?? 3;
  const h = hero('wildshape', nodes, []);
  h.masteryNodes = nodes;
  h.skills = deriveHeroSkills(h, healerSkills);
  h.masteryPoints = Math.max(0, pointsEarnedByLevel(25, 'wildshape') - pointsSpent(h));
  return h;
}

describe('the Wildshape advanced row', () => {
  it('works in whichever shape was taken: Deep Hide deepens the pool of the shape worn', () => {
    for (const [shape, form] of [['wild_bear', 'bear'], ['wild_wolf', 'wolf'], ['wild_hawk', 'hawk']] as const) {
      const wear = (nodes: Record<string, number>) => {
        state().reset();
        const h = hero('wildshape', { [shape]: 2, ...nodes }, []);
        h.skills = deriveHeroSkills(h, healerSkills);
        useCombatStore.setState({ units: [{ ...createPlayerUnits([h], [at(0, 0)])[0], id: 'druid' }] });
        state().setWildForm('druid', form);
        return { vigor: unitNow('druid').formVigor!, max: combatMaxHp(unitNow('druid')) };
      };
      const plain = wear({});
      const deep = wear({ wild_deep_hide: 2 });
      expect(deep.vigor).toBeCloseTo(plain.vigor * 1.12);
      expect(deep.max).toBeGreaterThan(plain.max);
    }
  });

  it('Fang and Talon strengthens the shape\'s own skills and nothing upright', () => {
    const plain = fielded('druid', 'wildshape', { wild_bear: 2 }, [maul, tremor]);
    const fang = fielded('druid', 'wildshape', { wild_bear: 2, wild_fang_and_talon: 2 }, [maul, tremor]);
    const target = foe('foe', 1);
    expect(calculateDamage(fang, target, maul)).toBeGreaterThan(calculateDamage(plain, target, maul));
    expect(calculateDamage(fang, target, tremor)).toBe(calculateDamage(plain, target, tremor));
  });

  it('grants no skill, passive or shape, and carries no exclusivity of its own', () => {
    for (const n of advancedNodes(wildPath)) {
      expect(n.grantsSkill).toBeUndefined();
      expect(n.grantsPassive).toBeUndefined();
      expect(n.exclusiveGroup).toBeUndefined();
    }
  });

  it('cannot open a second shape: a Bear with every advanced rank still cannot buy the Wolf or the Hawk', () => {
    const h = bearWithEverything();
    h.masteryPoints = 10;
    expect(Object.keys(h.masteryNodes).filter((id) => isAdvancedNode(wildPath.nodes.find((n) => n.id === id)!)))
      .toHaveLength(advancedNodes(wildPath).length);
    for (const id of [...WOLF, ...HAWK]) expect(canUnlockNode(h, id).ok).toBe(false);
  });

  it('cannot use a second shape: the fielded Bear knows only its own shift and its own shape\'s skills', () => {
    const h = bearWithEverything();
    const unit = createPlayerUnits([h], [at(0, 0)])[0];
    const kit = unit.humanSkills ?? unit.skills;
    const shifts = new Set(kit.map((s) => s.shiftsTo).filter(Boolean));
    expect(shifts).toEqual(new Set(['bear', 'apex']));
    expect(kit.some((s) => s.formSkill === 'wolf' || s.formSkill === 'hawk')).toBe(false);
    expect(Object.keys(masteryFormRanks(h)).sort()).toEqual(['apex', 'bear']);
    // And what the bear wears is the bear's alone
    const inBear = skillsForForm('bear', kit, unit.masteryModifiers);
    expect(inBear.some((s) => s.shiftsTo === 'wolf' || s.shiftsTo === 'hawk')).toBe(false);
  });
});

// ─── The level-26 row ─────────────────────────────────────────────────────────

/**
 * A hero of this level who bought the node the way a player does: the line to the
 * capstone at one rank each, then the node through `canUnlockNode`, rank by rank.
 * Whatever comes back, the game allowed.
 */
function bought(pathId: MasteryId, nodeId: string, level: number, ranks = 1, base: Record<string, number> = {}) {
  const path = findMasteryPath(pathId)!;
  const capstone = path.nodes.find((n) => n.id === CAPSTONE[pathId])!;
  const line = new Set<string>([capstone.id]);
  const climb = (n: MasteryNode) => {
    for (const p of prerequisitesFor(path, n)) if (!line.has(p.id)) { line.add(p.id); climb(p); }
  };
  climb(capstone);
  const h = hero(pathId, {}, []);
  h.level = level;
  h.masteryNodes = { ...Object.fromEntries([...line].map((id) => [id, 1])), ...base };
  h.masteryPoints = pointsEarnedByLevel(level, pathId) - pointsSpent(h);
  for (let rank = 0; rank < ranks; rank++) {
    const verdict = canUnlockNode(h, nodeId);
    if (!verdict.ok) return { hero: h, verdict };
    h.masteryNodes = { ...h.masteryNodes, [nodeId]: (h.masteryNodes[nodeId] ?? 0) + 1 };
    h.masteryPoints -= 1;
  }
  return { hero: h, verdict: { ok: true } as const };
}

describe.each([
  ['lifewarden', 'life_last_bloom'],
  ['stoneshaper', 'stone_stones_answer'],
  ['wildshape', 'wild_second_nature'],
] as const)('the level-26 node of %s', (pathId, nodeId) => {
  it('is refused at 25 and bought at 26, rank by rank to three', () => {
    expect(bought(pathId, nodeId, 25).verdict).toEqual({ ok: false, reason: 'level-too-low', level: 26 });
    const { hero: h, verdict } = bought(pathId, nodeId, 26, 3);
    expect(verdict.ok).toBe(true);
    expect(h.masteryNodes[nodeId]).toBe(3);
    expect(canUnlockNode(h, nodeId).ok).toBe(false);
  });

  it('says what it does at the rank shown, and differently at each', () => {
    const node = findMasteryPath(pathId)!.nodes.find((n) => n.id === nodeId)!;
    const texts = [1, 2, 3].map((rank) => nodeSimpleText(node, rank));
    for (const text of texts) expect(text).toEqual(expect.any(String));
    expect(new Set(texts).size).toBe(3);
  });
});

describe('Last Bloom', () => {
  /** A real level-26 Lifewarden and a wounded ally, with the ally's turns ticked by hand. */
  const fight = (ranks: number, allyHp = 40) => {
    state().reset();
    const { hero: life } = ranks > 0
      ? bought('lifewarden', 'life_last_bloom', 26, ranks)
      : { hero: hero('lifewarden', {}, []) };
    life.skills = [lifebloomSkill];
    const healer = { ...createPlayerUnits([life], [at(0, 0)])[0], id: 'life' };
    useCombatStore.setState({ units: [healer, { ...fielded('ally', 'lifewarden', {}, [], 1), currentHp: allyHp }] });
    resolveSkillUse(unitNow('life'), lifebloomSkill, at(1, 0), SILENT_SINK);
  };
  const hp = () => unitNow('ally').currentHp;
  /** What each tick restored, until the Regen is gone. */
  const ticksOut = () => {
    const gains: number[] = [];
    while (effect('ally', AuraType.HealOverTime)) {
      const before = hp();
      state().tickEffectsOnUnit('ally');
      gains.push(hp() - before);
    }
    return gains;
  };

  it('blooms once, on the tick that retires the Regen, for its share of the tick', () => {
    fight(2);
    const regen = effect('ally', AuraType.HealOverTime)!;
    const share = unitNow('life').masteryModifiers!.hotBloomShare!;
    const withNode = ticksOut();
    fight(0);
    const without = ticksOut();
    expect(withNode.length).toBe(without.length);
    expect(withNode.slice(0, -1)).toEqual(without.slice(0, -1));
    expect(withNode[withNode.length - 1] - without[without.length - 1]).toBe(Math.round(regen.magnitude * share));
  });

  it('grows with the rank', () => {
    const last = (ranks: number) => { fight(ranks); return ticksOut().pop()!; };
    expect(last(3)).toBeGreaterThan(last(2));
    expect(last(2)).toBeGreaterThan(last(1));
    expect(last(1)).toBeGreaterThan(last(0));
  });

  it('never blooms on a re-cast, which refreshes the clock, and blooms when the fresh clock runs out', () => {
    fight(2);
    const tick = effect('ally', AuraType.HealOverTime)!.magnitude;
    const plain = Math.round(tick);
    // Down to its last turn, then cast again before it can run out
    while (effect('ally', AuraType.HealOverTime)!.duration > 1) state().tickEffectsOnUnit('ally');
    resolveSkillUse({ ...unitNow('life'), cooldowns: {} }, lifebloomSkill, at(1, 0), SILENT_SINK);
    expect(effect('ally', AuraType.HealOverTime)!.duration).toBeGreaterThan(1);
    const gains = ticksOut();
    expect(gains.slice(0, -1).every((g) => g === plain)).toBe(true);
    expect(gains[gains.length - 1]).toBeGreaterThan(plain);
  });

  it('does not bloom a Regen dispelled, or one laid by a hand without the node', () => {
    fight(2);
    const before = hp();
    state().removeEffect('ally', AuraType.HealOverTime);
    state().tickEffectsOnUnit('ally');
    expect(hp()).toBe(before);

    fight(2);
    state().removeEffect('ally', AuraType.HealOverTime);
    state().applyEffect('ally', { type: AuraType.HealOverTime, magnitude: 10, duration: 1, sourceUnitId: 'ally' });
    const held = hp();
    state().tickEffectsOnUnit('ally');
    expect(hp() - held).toBe(10);
  });

  describe('against a Burn on the same tick', () => {
    const undefendedAlly = (hp: number, burn: number, burnFirst: boolean) => {
      fight(2);
      const regen = { type: AuraType.HealOverTime, magnitude: 20, duration: 1, sourceUnitId: 'life' };
      const dot = { type: AfflictionType.Burn, magnitude: burn, duration: 3 };
      useCombatStore.setState((s) => ({
        units: s.units.map((u) => u.id === 'ally' ? {
          ...u, currentHp: hp, stats: { ...u.stats, defense: 0, magicDefense: 0 },
          activeEffects: burnFirst ? [dot, regen] : [regen, dot],
        } : u),
      }));
    };
    const blooms = (events: { text: string }[]) => events.filter((e) => e.text.includes('Bloom')).length;

    it('does not bloom on a unit the Burn already killed', () => {
      undefendedAlly(5, 200, true);
      const events = state().tickEffectsOnUnit('ally');
      expect(hp()).toBe(0);
      expect(blooms(events)).toBe(0);
    });

    it('blooms and then dies when the Regen is listed first and the Burn still kills', () => {
      undefendedAlly(5, 200, false);
      const events = state().tickEffectsOnUnit('ally');
      expect(hp()).toBe(0);
      expect(blooms(events)).toBe(1);
    });

    it('blooms on a unit the Burn wounded but did not kill, in either order', () => {
      const share = () => unitNow('life').masteryModifiers!.hotBloomShare!;
      undefendedAlly(50, 10, true);
      state().tickEffectsOnUnit('ally');
      expect(hp()).toBe(50 - 10 + 20 + Math.round(20 * share()));
      undefendedAlly(50, 10, false);
      state().tickEffectsOnUnit('ally');
      expect(hp()).toBe(50 + 20 + Math.round(20 * share()) - 10);
    });
  });

  it('heals under the phase ceiling and the Seared cut, as every tick does', () => {
    fight(2);
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => u.id === 'ally' ? {
        ...u, currentHp: 50, hpCeiling: 60,
        activeEffects: [{ type: AuraType.HealOverTime, magnitude: 20, duration: 1, sourceUnitId: 'life' }],
      } : u),
    }));
    state().tickEffectsOnUnit('ally');
    expect(hp()).toBe(60);

    const bloomOf = (seared: boolean) => {
      fight(2);
      useCombatStore.setState((s) => ({
        units: s.units.map((u) => u.id === 'ally' ? {
          ...u, currentHp: 10,
          activeEffects: [
            { type: AuraType.HealOverTime, magnitude: 20, duration: 1, sourceUnitId: 'life' },
            ...(seared ? [{ type: AfflictionType.Seared, magnitude: 0.5, duration: 5, sourceUnitId: 'life' }] : []),
          ],
        } : u),
      }));
      state().tickEffectsOnUnit('ally');
      return hp() - 10;
    };
    expect(bloomOf(true)).toBeLessThan(bloomOf(false));
  });

  it('raises no onHeal: Overflowing Grace does not see it, and a full ally takes nothing', () => {
    state().reset();
    const { hero: life } = bought('lifewarden', 'life_last_bloom', 26, 2, { life_overflowing_grace: 3 });
    const healer = { ...createPlayerUnits([life], [at(0, 0)])[0], id: 'life' };
    const ally = fielded('ally', 'lifewarden', {}, [], 1);
    useCombatStore.setState({ units: [healer, ally] });
    state().applyEffect('ally', { type: AuraType.HealOverTime, magnitude: 20, duration: 1, sourceUnitId: 'life' });
    const events = state().tickEffectsOnUnit('ally');
    expect(effect('ally', AuraType.Barrier)).toBeUndefined();
    expect(events).toEqual([]);
  });

  it('leaves the fight report the healing it did', () => {
    fight(2);
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => u.id === 'ally' ? {
        ...u, currentHp: 10, activeEffects: [{ type: AuraType.HealOverTime, magnitude: 20, duration: 1, sourceUnitId: 'life' }],
      } : u),
    }));
    const before = state().fightStats.life?.healingDone ?? 0;
    state().tickEffectsOnUnit('ally');
    expect((state().fightStats.life?.healingDone ?? 0) - before).toBe(hp() - 10);
  });
});

describe('Stone\'s Answer', () => {
  const boss = enemyTemplates.find((t) => t.tier === 'boss')!;
  /** A level-26 Stoneshaper and an ally behind its Barrier, facing `foe`, all as fielded. */
  const fight = (ranks: number, over: Partial<CombatUnit> = {}, base: Record<string, number> = {}) => {
    state().reset();
    const { hero: stone } = bought('stoneshaper', 'stone_stones_answer', 26, ranks, base);
    const shaper = { ...createPlayerUnits([stone], [at(0, 0)])[0], id: 'stone' };
    useCombatStore.setState({
      units: [shaper, fielded('ally', 'stoneshaper', {}, [], 1), fielded('other', 'stoneshaper', {}, [], 2), foe('foe', 3, over)],
    });
    shield('ally');
  };
  const shield = (id: string, magnitude = 10) =>
    state().applyEffect(id, { type: AuraType.Barrier, magnitude, duration: 3, sourceUnitId: 'stone' });
  const foeHp = () => unitNow('foe').currentHp;
  const strike = (target = 'ally', amount = 50) => state().damageUnit(target, amount, 'foe');

  it('strikes and Roots the enemy that breaks the Barrier, wherever it stands', () => {
    fight(2);
    const expected = Math.round(getCombatEffectiveStats(unitNow('stone')).magic * BALANCE.ADVANCED_DRUID.STONES_ANSWER_MAGIC);
    const before = foeHp();
    const { deathEvents } = strike();
    // The foe stands undefended here, so the blow is its share of Magic, a rounding either way
    expect(Math.abs(before - foeHp() - expected)).toBeLessThanOrEqual(1);
    expect(effect('foe', AfflictionType.Root)?.sourceUnitId).toBe('stone');
    expect(deathEvents?.some((e) => e.unitId === 'foe')).toBe(true);
  });

  it('lands through a real blow: resolveSkillUse, the foe\'s own skill, the same answer', () => {
    fight(2, { stats: makeStats({ maxHp: 5000, attack: 200, defense: 0, magicDefense: 0, critChance: 0 }), position: at(2, 0) });
    useCombatStore.setState((s) => ({ units: s.units.filter((u) => u.id !== 'other') }));
    const before = foeHp();
    resolveSkillUse(unitNow('foe'), maul, at(1, 0), SILENT_SINK);
    expect(effect('ally', AuraType.Barrier)).toBeUndefined();
    expect(foeHp()).toBeLessThan(before);
    expect(effect('foe', AfflictionType.Root)).toBeDefined();
  });

  it('holds the enemy for exactly one of its turns', () => {
    fight(2);
    strike();
    expect(effect('foe', AfflictionType.Root)).toBeDefined();
    state().tickEffectsOnUnit('foe');
    expect(effect('foe', AfflictionType.Root)).toBeDefined();
    state().tickEffectsOnUnit('foe');
    expect(effect('foe', AfflictionType.Root)).toBeUndefined();
  });

  it('grows with the rank, and is answered by Physical Defense, not Magic Defense', () => {
    const paid = (ranks: number, stats: Partial<CombatUnit['stats']> = {}) => {
      fight(ranks, { stats: makeStats({ maxHp: 5000, defense: 0, magicDefense: 0, ...stats }) });
      const before = foeHp();
      strike();
      return before - foeHp();
    };
    expect(paid(3)).toBeGreaterThan(paid(2));
    expect(paid(2)).toBeGreaterThan(paid(1));
    expect(paid(2, { defense: 8 })).toBeLessThan(paid(2));
    expect(paid(2, { magicDefense: 8 })).toBe(paid(2));
  });

  it('asks for a break by an enemy: a Barrier that holds, a tick and a dispel answer nothing', () => {
    fight(2);
    const before = foeHp();
    strike('ally', 1);
    expect(effect('ally', AuraType.Barrier)).toBeDefined();
    state().removeEffect('ally', AuraType.Barrier);
    expect(foeHp()).toBe(before);

    fight(2);
    state().applyEffect('ally', { type: AfflictionType.Burn, magnitude: 50, duration: 2, sourceUnitId: 'foe' });
    state().tickEffectsOnUnit('ally');
    expect(effect('ally', AuraType.Barrier)).toBeUndefined();
    expect(foeHp()).toBe(before);
    expect(effect('foe', AfflictionType.Root)).toBeUndefined();
  });

  it('answers only for a Barrier the holder gave, and only while the holder stands', () => {
    fight(2);
    state().removeEffect('ally', AuraType.Barrier);
    state().applyEffect('ally', { type: AuraType.Barrier, magnitude: 10, duration: 3, sourceUnitId: 'other' });
    const before = foeHp();
    strike();
    expect(foeHp()).toBe(before);

    fight(2);
    useCombatStore.setState((s) => ({ units: s.units.map((u) => u.id === 'stone' ? { ...u, currentHp: 0 } : u) }));
    strike();
    expect(foeHp()).toBe(before);
    expect(effect('foe', AfflictionType.Root)).toBeUndefined();
  });

  it('answers once per protected ally per Stoneshaper turn, and the allowance returns with that turn', () => {
    fight(2);
    strike();
    const once = foeHp();
    // The same ally, shielded again: no second answer
    shield('ally');
    strike();
    expect(foeHp()).toBe(once);
    // Another ally is another allowance
    shield('other');
    strike('other');
    const twice = foeHp();
    expect(twice).toBeLessThan(once);
    // And the Stoneshaper's own turn restores them
    beginTurn('stone', SILENT_SINK);
    shield('ally');
    strike();
    expect(foeHp()).toBeLessThan(twice);
  });

  it('counts the Stoneshaper\'s own shell, and fires beside Rubble Recovery on one allowance each', () => {
    fight(2);
    shield('stone');
    const before = foeHp();
    strike('stone');
    expect(foeHp()).toBeLessThan(before);

    fight(2, {}, { stone_rubble_recovery: 1 });
    useCombatStore.setState((s) => ({ units: s.units.map((u) => u.id === 'ally' ? { ...u, currentHp: 100 } : u) }));
    const paid = foeHp();
    strike('ally', 10);
    expect(foeHp()).toBeLessThan(paid);
    expect(unitNow('ally').currentHp).toBeGreaterThan(100);
  });

  it('a boss keeps the damage and refuses the Root', () => {
    fight(2, { templateId: boss.id });
    const before = foeHp();
    strike();
    expect(foeHp()).toBeLessThan(before);
    expect(effect('foe', AfflictionType.Root)).toBeUndefined();
  });

  it('the Root carries what the holder\'s Root always carries: Crumble\'s shred and Deep Grip\'s turn', () => {
    fight(2, {}, { stone_crumble: 2, stone_deep_grip: 1 });
    strike();
    const root = effect('foe', AfflictionType.Root)!;
    expect(root.crumble).toBeGreaterThan(0);
    expect(root.duration).toBe(BALANCE.ADVANCED_DRUID.STONES_ANSWER_ROOT_TURNS + 1);
  });

  it('kills a dying breaker down the ordinary death list, with no Root on the corpse', () => {
    fight(2);
    useCombatStore.setState((s) => ({ units: s.units.map((u) => u.id === 'foe' ? { ...u, currentHp: 1 } : u) }));
    strike();
    expect(unitById(state().units, 'foe')?.currentHp ?? 0).toBeLessThanOrEqual(0);
    expect(unitById(state().units, 'foe')?.activeEffects.some((e) => e.type === AfflictionType.Root) ?? false).toBe(false);
  });

  it('is barred by a duel as any outside hand is, and spends no allowance on it', () => {
    fight(2, { duel: { partnerId: 'ally', centre: at(0, 0), radius: 2, turns: 0 } });
    const before = foeHp();
    strike();
    expect(foeHp()).toBe(before);
    expect(effect('foe', AfflictionType.Root)).toBeUndefined();
    expect(unitNow('stone').stonesAnswered ?? []).toEqual([]);
  });
});

describe('Second Nature', () => {
  const SHAPES = [['wild_bear', 'bear'], ['wild_wolf', 'wolf'], ['wild_hawk', 'hawk']] as const;
  const field = (shape: string, ranks = 2) => {
    state().reset();
    const { hero: h } = bought('wildshape', 'wild_second_nature', 26, ranks, { [shape]: 2 });
    h.skills = deriveHeroSkills(h, healerSkills);
    const unit = createPlayerUnits([h], [at(0, 0)])[0];
    // Round numbers, so that one rung of the share never rounds onto the next
    const stats = { ...unit.stats, attack: 1000, defense: 500, magicDefense: 500 };
    useCombatStore.setState({ units: [{ ...unit, id: 'druid', stats }, foe('foe', 5)] });
  };
  const sheet = () => getCombatEffectiveStats(unitNow('druid'));
  const regularTurn = () => beginTurn('druid', SILENT_SINK);

  it.each(SHAPES)('%s: each regular turn begun in the shape is a step, up to the top', (shape, form) => {
    field(shape);
    state().setWildForm('druid', form);
    const worn = sheet();
    expect(unitNow('druid').shapeTurns).toBe(0);
    const share = unitNow('druid').masteryModifiers!.shapeSettledBonus!;
    const max = BALANCE.SECOND_NATURE_MAX_STEPS;
    for (let step = 1; step <= max; step++) {
      regularTurn();
      const now = sheet();
      expect(unitNow('druid').shapeTurns).toBe(step);
      expect(now.attack).toBe(worn.attack + Math.round(worn.attack * share * step));
      expect(now.defense).toBe(worn.defense + Math.round(worn.defense * share * step));
      expect(now.magicDefense).toBe(worn.magicDefense! + Math.round(worn.magicDefense! * share * step));
      // ...and nothing else moves: the rules against max health and speed stand
      expect(now.maxHp).toBe(worn.maxHp);
      expect(now.speed).toBe(worn.speed);
      expect(now.magic).toBe(worn.magic);
    }
    const top = sheet();
    regularTurn();
    expect(sheet().attack).toBe(top.attack);
    expect(unitNow('druid').shapeTurns).toBe(max);
  });

  it('pays every shape alike, so the choice of shape stays where it was', () => {
    const shares = SHAPES.map(([shape, form]) => {
      field(shape);
      state().setWildForm('druid', form);
      regularTurn();
      return unitNow('druid').masteryModifiers!.shapeSettledBonus! * unitNow('druid').shapeTurns!;
    });
    expect(new Set(shares).size).toBe(1);
  });

  it('grows with the rank', () => {
    const lift = (ranks: number) => {
      field('wild_bear', ranks);
      state().setWildForm('druid', 'bear');
      const worn = sheet().defense;
      regularTurn();
      return sheet().defense - worn;
    };
    expect(lift(3)).toBeGreaterThan(lift(2));
    expect(lift(2)).toBeGreaterThan(lift(1));
  });

  it('a shift resets it: out of the shape and back starts again', () => {
    field('wild_bear');
    state().setWildForm('druid', 'bear');
    const worn = sheet();
    regularTurn();
    regularTurn();
    expect(sheet().attack).toBeGreaterThan(worn.attack);
    state().setWildForm('druid', null);
    expect(unitNow('druid').shapeTurns).toBe(0);
    state().setWildForm('druid', 'bear');
    expect(sheet().attack).toBe(worn.attack);
  });

  it('upright and Apex never count', () => {
    field('wild_bear');
    const upright = sheet();
    regularTurn();
    expect(unitNow('druid').shapeTurns ?? 0).toBe(0);
    expect(sheet().attack).toBe(upright.attack);

    state().setWildForm('druid', 'apex');
    const apex = sheet();
    regularTurn();
    expect(unitNow('druid').shapeTurns ?? 0).toBe(0);
    expect(sheet().attack).toBe(apex.attack);
  });

  it('a bonus turn adds no step', () => {
    field('wild_bear');
    state().setWildForm('druid', 'bear');
    regularTurn();
    useCombatStore.setState({ currentUnitId: 'druid', bonusTurn: { pending: null, active: true } });
    beginTurn('druid', SILENT_SINK);
    expect(unitNow('druid').shapeTurns).toBe(1);
  });

  it('a carried opening shape starts at none, and its first regular turn is its first step', () => {
    state().reset();
    const { hero: h } = bought('wildshape', 'wild_second_nature', 26, 2, { wild_wolf: 2 });
    h.skills = deriveHeroSkills(h, healerSkills);
    h.wildForm = 'wolf';
    const [druid] = createPlayerUnits([h], [at(0, 0)]);
    state().initCombat([druid], [foe('foe', 5)], 0);
    const plan = planOpeningForms([h], state().units);
    expect(plan).toEqual([{ unitId: druid.id, form: 'wolf' }]);
    takeOpeningForms(plan, SILENT_SINK);
    expect(unitNow(druid.id).shapeTurns).toBe(0);
    beginTurn(druid.id, SILENT_SINK);
    expect(unitNow(druid.id).shapeTurns).toBe(1);
  });

  it('is nothing without the node', () => {
    state().reset();
    const h = hero('wildshape', { wild_bear: 2 }, []);
    h.skills = deriveHeroSkills(h, healerSkills);
    useCombatStore.setState({ units: [{ ...createPlayerUnits([h], [at(0, 0)])[0], id: 'druid' }, foe('foe', 5)] });
    state().setWildForm('druid', 'bear');
    const worn = sheet();
    regularTurn();
    expect(sheet().attack).toBe(worn.attack);
  });
});

// ─── Retraining ───────────────────────────────────────────────────────────────

describe('retraining a level-25 Druid with advanced nodes', () => {
  const heroNow = () => usePartyStore.getState().heroes[0];

  it.each(['lifewarden', 'stoneshaper', 'wildshape'] as const)(
    '%s: clears every node, the advanced row included, and restores the level-25 points',
    (pathId) => {
      usePartyStore.setState({ heroes: [] });
      usePartyStore.getState().addHero('healer');
      usePartyStore.setState((s) => ({ heroes: s.heroes.map((h) => ({ ...h, level: 25 })) }));
      expect(usePartyStore.getState().chooseMastery(heroNow().id, pathId)).toBe(true);

      // Spend every point the shop would allow toward the first capstone, the
      // advanced row first once it opens
      const path = findMasteryPath(pathId)!;
      const capstone = path.nodes.find((n) => n.exclusiveGroup === 'capstone')!;
      const line = new Set<string>();
      const climb = (n: MasteryNode) => {
        for (const p of prerequisitesFor(path, n)) if (!line.has(p.id)) { line.add(p.id); climb(p); }
      };
      climb(capstone);
      const rank = (n: MasteryNode) =>
        isAdvancedNode(n) ? 0 : n.id === capstone.id ? 1 : line.has(n.id) ? 2 : 3;
      for (let guard = 0; guard < 100 && heroNow().masteryPoints > 0; guard++) {
        const open = path.nodes.filter((n) => canUnlockNode(heroNow(), n.id).ok).sort((x, y) => rank(x) - rank(y));
        if (open.length === 0) break;
        expect(usePartyStore.getState().unlockMasteryNode(heroNow().id, open[0].id)).toBe(true);
      }
      expect(heroNow().masteryPoints).toBe(0);
      expect(Object.keys(heroNow().masteryNodes).some((id) => isAdvancedNode(path.nodes.find((n) => n.id === id)!)))
        .toBe(true);

      expect(usePartyStore.getState().retrainMastery(heroNow().id)).toBe(true);
      expect(heroNow().masteryNodes).toEqual({});
      expect(heroNow().masteryPath).toBe(pathId);
      expect(heroNow().masteryPoints).toBe(pointsEarnedByLevel(25, pathId));
      if (pathId === 'wildshape') expect(heroNow().masteryPoints).toBe(21);
    },
  );
});
