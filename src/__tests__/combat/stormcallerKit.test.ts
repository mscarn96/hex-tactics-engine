import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { requireUnit } from '@/systems/combat/unitLookup';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { LIGHTNING_BOLT_IDS, isLightningBolt } from '@/data/skills/lightningSkills';
import {
  arc, chainLightning, skyfall, staticBurst, tempest, thunderbolt, thunderstep,
} from '@/data/skills/masterySkills';
import { findMasteryNode } from '@/data/skills/masteryData';
import { skillEffectLines } from '@/data/display/skillDisplay';
import { PASSIVE_DEFS } from '@/systems/combat/passives';
import { overloadBonus } from '@/systems/combat/passiveFormulas';
import { BALANCE } from '@/data/balanceConstants';
import {
  AfflictionType, AuraType, CombatUnit, HeroSkill, HeroStats, PassiveRank, SkillTargetType,
} from '@/models/types';
import { at, makeEffect, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';
import { masteryNodeDescription } from '@/data/display/masteryText';

/**
 * The Stormcaller's Overload, as rules.
 *
 * A cast that strikes two or more enemies that were already Shocked primes the next
 * single-target lightning bolt, once. Which skills are bolts is a list in data;
 * what is pinned here is that the charge is made by the cast and not by the Shock
 * it lays, is spent by a bolt and by nothing else, is spent once, and grows with
 * every rung.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 300, attack: 10, magic: 30, defense: 0, magicDefense: 0, maxMana: 400,
    critChance: 0, dodgeChance: 0, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const RANKS: PassiveRank[] = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));

const storm = (owns = true, level = 2, over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'storm',
    position: at(0, 0),
    stats: stats(),
    skills: [arc, thunderbolt, chainLightning, tempest, staticBurst],
    passives: owns ? ['overload'] : [],
    passiveRanks: owns ? { overload: RANKS[level - 1] } : {},
    ...over,
  });

const shock = () => makeEffect(AfflictionType.Shock, { magnitude: 1, duration: 3 });
const foe = (id: string, q: number, r: number, shocked = true, over: Partial<CombatUnit> = {}) =>
  makeFoe({
    id, position: at(q, r), stats: stats({ maxHp: 2000 }),
    activeEffects: shocked ? [shock()] : [],
    ...over,
  });

const charge = (id = 'storm') =>
  unitNow(id).activeEffects.find((e) => e.type === AuraType.Overloaded);

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  state().reset();
});

describe('which skills are single-target lightning bolts', () => {
  it('is Arc and Thunderbolt, listed in data, and both are single-target', () => {
    expect([...LIGHTNING_BOLT_IDS].sort()).toEqual(['arc', 'thunderbolt']);
    expect(isLightningBolt(arc)).toBe(true);
    expect(isLightningBolt(thunderbolt)).toBe(true);
    expect(arc.targetType).toBe(SkillTargetType.Single);
    expect(thunderbolt.targetType).toBe(SkillTargetType.Single);
  });

  it('leaves out every other lightning skill: they charge Overload, they do not spend it', () => {
    for (const skill of [chainLightning, tempest, staticBurst, thunderstep, skyfall]) {
      expect(isLightningBolt(skill)).toBe(false);
    }
  });

  it('does not count a bolt-named skill that is no longer single-target', () => {
    expect(isLightningBolt({ id: 'arc', targetType: SkillTargetType.Ring } as HeroSkill)).toBe(false);
  });
});

describe('charging', () => {
  const cast = (skill: HeroSkill, target = at(1, 0)) =>
    resolveSkillUse(unitNow('storm'), skill, target, SILENT_SINK);

  it('a cast that strikes two already-Shocked enemies primes the Stormcaller', () => {
    useCombatStore.setState({ units: [storm(), foe('a', 1, 0), foe('b', 2, 0)] });
    expect(cast(tempest, at(0, 0)).ok).toBe(true);
    const held = charge()!;
    expect(held.magnitude).toBeCloseTo(overloadBonus(RANKS[1]));
    expect(held.duration).toBe(BALANCE.OVERLOAD_DURATION);
  });

  it('works from Chain Lightning, whose bolt leaps onto the second Shocked enemy', () => {
    useCombatStore.setState({ units: [storm(), foe('a', 1, 0), foe('b', 2, 0)] });
    cast(chainLightning, at(1, 0));
    expect(charge()).toBeDefined();
  });

  it('one Shocked enemy is not enough', () => {
    useCombatStore.setState({ units: [storm(), foe('a', 1, 0), foe('b', 2, 0, false)] });
    cast(tempest, at(0, 0));
    expect(charge()).toBeUndefined();
  });

  it('the Shock a cast lays does not count: it takes a second cast to cash it in', () => {
    useCombatStore.setState({ units: [storm(), foe('a', 1, 0, false), foe('b', 2, 0, false)] });
    cast(tempest, at(0, 0));
    expect(unitNow('a').activeEffects.some((e) => e.type === AfflictionType.Shock)).toBe(true);
    expect(charge()).toBeUndefined();
  });

  it('Shocked allies are not enemies struck', () => {
    useCombatStore.setState({
      units: [
        storm(), foe('a', 1, 0),
        makeUnit({ id: 'friend', position: at(2, 0), stats: stats(), activeEffects: [shock()] }),
      ],
    });
    cast(tempest, at(0, 0));
    expect(charge()).toBeUndefined();
  });

  it('a Stormcaller without the node never charges', () => {
    useCombatStore.setState({ units: [storm(false), foe('a', 1, 0), foe('b', 2, 0)] });
    cast(tempest, at(0, 0));
    expect(charge()).toBeUndefined();
  });

  it('a single-target bolt cannot charge it, however Shocked its target is', () => {
    useCombatStore.setState({ units: [storm(), foe('a', 1, 0)] });
    cast(arc);
    expect(charge()).toBeUndefined();
  });
});

describe('spending', () => {
  const primed = (level = 2) => {
    const me = storm(true, level, {
      activeEffects: [
        makeEffect(AuraType.Overloaded, {
          magnitude: overloadBonus(RANKS[level - 1]), duration: BALANCE.OVERLOAD_DURATION,
        }),
      ],
    });
    // Shocked, so Arc's own bonus against the Shocked is the same on both casts
    useCombatStore.setState({ units: [me, foe('a', 1, 0), foe('b', 2, 0)] });
    return me;
  };
  const hpOf = (id: string) => unitNow(id).currentHp;

  it('the next Arc hits harder by the stated amount, and is the last that does', () => {
    const me = primed();
    const plain = storm();
    const target = unitNow('a');
    const bonus = calculateDamage(me, target, arc) / calculateDamage(plain, target, arc);
    expect(bonus).toBeCloseTo(1 + overloadBonus(RANKS[1]), 1);

    const before = hpOf('a');
    resolveSkillUse(me, arc, at(1, 0), SILENT_SINK);
    const boosted = before - hpOf('a');
    expect(charge()).toBeUndefined();

    const second = hpOf('a');
    resolveSkillUse(unitNow('storm'), arc, at(1, 0), SILENT_SINK);
    expect(second - hpOf('a')).toBeLessThan(boosted);
  });

  it('Thunderbolt spends it too, once', () => {
    const me = primed();
    resolveSkillUse(me, thunderbolt, at(1, 0), SILENT_SINK);
    expect(charge()).toBeUndefined();
  });

  it('an area cast does not spend it, and does not get it', () => {
    const me = primed();
    const target = unitNow('a');
    expect(calculateDamage(me, target, tempest)).toBe(calculateDamage(storm(), target, tempest));
    resolveSkillUse(me, tempest, at(0, 0), SILENT_SINK);
    expect(charge()).toBeDefined();
  });

  it('a bolt that misses still spends it: the cast is what is spent', () => {
    const me = primed();
    useCombatStore.setState({
      units: [me, foe('a', 1, 0, false, { stats: stats({ maxHp: 2000, dodgeChance: 100 }) })],
    });
    resolveSkillUse(unitNow('storm'), arc, at(1, 0), { ...SILENT_SINK });
    expect(charge()).toBeUndefined();
  });

  it('is worth more at every rung', () => {
    const target = foe('a', 1, 0, false);
    const dmg = [1, 2, 3].map((level) => {
      const me = storm(true, level, {
        activeEffects: [makeEffect(AuraType.Overloaded, { magnitude: overloadBonus(RANKS[level - 1]) })],
      });
      return calculateDamage(me, target, thunderbolt);
    });
    expect(dmg[1]).toBeGreaterThan(dmg[0]);
    expect(dmg[2]).toBeGreaterThan(dmg[1]);
  });
});

describe('what the player is told', () => {
  it('the node names its rule and carries no flat stat', () => {
    const node = findMasteryNode('storm_overload')!.node;
    expect(node.grantsPassive).toBe('overload');
    expect(node.statBonus).toBeUndefined();
    expect(masteryNodeDescription(node)).toMatch(/Shocked/);
    expect(masteryNodeDescription(node)).toMatch(/Arc or Thunderbolt/);
  });

  it('states different figures at each rung', () => {
    const lines = RANKS.map((r) => PASSIVE_DEFS.overload.figures!(r).join('|'));
    expect(new Set(lines).size).toBe(3);
  });

  it('bolts preview the charge, and the live number while one is held', () => {
    const owner = storm();
    expect(skillEffectLines(arc, owner).join('\n')).toContain(
      `+${Math.round(overloadBonus(RANKS[1]) * 100)}%`,
    );
    expect(skillEffectLines(tempest, owner).join('\n')).not.toMatch(/Overload/);
    expect(skillEffectLines(arc, storm(false)).join('\n')).not.toMatch(/Overload/);
    const held = storm(true, 2, { activeEffects: [makeEffect(AuraType.Overloaded, { magnitude: 0.5 })] });
    expect(skillEffectLines(thunderbolt, held).join('\n')).toMatch(/Overloaded: \+50%/);
  });

  it('Stormcaller gains no hard interrupt: nothing on the path stuns, silences, freezes or roots', () => {
    const kit = [arc, thunderbolt, chainLightning, tempest, staticBurst, thunderstep, skyfall];
    const applied = kit.flatMap((s) => [s.appliesEffect].flat().filter(Boolean)) as { type: string }[];
    for (const e of applied) {
      expect([
        AfflictionType.Stun, AfflictionType.Silence, AfflictionType.Freeze, AfflictionType.Root,
      ]).not.toContain(e.type);
    }
  });
});
