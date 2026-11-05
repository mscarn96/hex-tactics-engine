import { spyDice } from '../support/dice';
import { at, makeFoe, makeHero, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';
import { BALANCE } from '@/data/balanceConstants';
import { findMasteryPath } from '@/data/skills/masteryData';
import {
  fireflySwarm, glowmote, lanternBeacon, lanternGlide, lanternSweep, lightbond, purifyingLight,
} from '@/data/skills/masterySkills';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { nodeSimpleText, skillSimpleText } from '@/data/display/simpleText';
import { describeSkill, skillEffectLines } from '@/data/display/skillDisplay';
import { usePartyStore } from '@/stores/partyStore';
import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { requireUnit } from '@/systems/combat/unitLookup';
import { playerUnitFor } from '@/systems/combat/unitFactory';
import { calculateHealing, shapeDamageScale } from '@/systems/combat/damageCalc';
import { FAR_LIGHT_SKILLS, moteRecipients, withFarLight } from '@/systems/combat/fireflyRules';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { nodeModifierAt, nodeSkillAt, nodeStatBonusAt } from '@/systems/progression/mastery';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import {
  AuraType, CombatUnit, HeroClass, HeroSkill, HeroStats, HexCoord, PassiveId, PassiveRank,
} from '@/models/types';

/**
 * The Firefly's last tree task (the private project notes, "### Firefly"): the
 * two side trees — Far Light over Kindled Light and Steady Flame, Twin Motes over
 * Bright Bolt and Second Light — and the Simple and Detailed copy for the whole
 * tree. Pinned as rules, the numbers read from `BALANCE.FIREFLY` and the nodes.
 */

const F = BALANCE.FIREFLY;
const RANK2: PassiveRank = { level: 2, scale: 1 };

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 200, attack: 10, magic: 20, defense: 0, magicDefense: 0, maxMana: 60,
    critChance: 0, dodgeChance: 0, speed: 10, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const hpOf = (id: string) => unitNow(id).currentHp;
const lostBy = (id: string) => unitNow(id).stats.maxHp - hpOf(id);

const firefly = (over: Partial<CombatUnit> = {}, passives: PassiveId[] = []) =>
  makeUnit({
    id: 'ff', position: at(0, 0), stats: stats(), currentMana: 60, resource: 'chi',
    skills: [glowmote, lanternSweep, lightbond, purifyingLight, lanternGlide],
    passives, passiveRanks: Object.fromEntries(passives.map((p) => [p, RANK2])),
    ...over,
  });
const ally = (id: string, position: HexCoord, hp = 200) =>
  makeUnit({ id, position, stats: stats(), currentHp: hp });
const foe = (id: string, position: HexCoord) =>
  makeFoe({ id, position, stats: stats({ maxHp: 2000 }) });

const cast = (skill: HeroSkill, target: HexCoord, casterId = 'ff') =>
  resolveSkillUse(unitNow(casterId), skill, target, SILENT_SINK);
/** Ready to cast again: cooldowns are not what these tests are about. */
const offCooldown = () => useCombatStore.setState((s) => ({ units: s.units.map((u) => ({ ...u, cooldowns: {} })) }));

beforeEach(() => {
  resetFixtureIds();
  state().reset();
  spyDice().mockReturnValue(0.5);
});

const path = findMasteryPath('firefly')!;
const nodeById = (id: string) => path.nodes.find((n) => n.id === id)!;

// ─── The shape ────────────────────────────────────────────────────────────────

describe('the Firefly side trees', () => {
  it('hang Kindled Light and Steady Flame off Far Light, and Bright Bolt and Second Light off Twin Motes', () => {
    const childrenOf = (id: string) =>
      path.nodes.filter((n) => (n.requires ?? []).includes(id)).map((n) => n.id).sort();
    expect(childrenOf('firefly_far_light')).toEqual(['firefly_kindled_light', 'firefly_steady_flame']);
    expect(childrenOf('firefly_twin_motes')).toEqual(['firefly_bright_bolt', 'firefly_second_light']);
    expect(nodeById('firefly_far_light').grantsPassive).toBe('farLight');
    expect(nodeById('firefly_twin_motes').grantsPassive).toBe('twinMotes');
  });

  /** A Firefly who buys one whole line: the main tree to a capstone, then a side tree. */
  function buyLine(starter: string) {
    const template = heroTemplates.find((t) => t.id === 'monk')!;
    const hero = makeHero({
      id: 'h-ff', templateId: 'monk', heroClass: HeroClass.Monk, level: 20,
      baseStats: calculateStatsForLevel(template, 20), skills: [...template.skills],
    });
    usePartyStore.setState({ heroes: [hero] });
    const party = () => usePartyStore.getState();
    expect(party().chooseMastery(hero.id, 'firefly')).toBe(true);
    const main = path.nodes.filter((n) => !n.sideTree && (n.tier < 3 || (n.tier === 3 && n.column === 0)))
      .sort((a, b) => a.tier - b.tier || a.column - b.column);
    const side = path.nodes.filter((n) => n.id === starter || (n.requires ?? []).includes(starter));
    for (const node of [...main, ...side]) expect(party().unlockMasteryNode(hero.id, node.id)).toBe(true);
    return party().heroes[0];
  }

  it('takes one side tree, never both', () => {
    const hero = buyLine('firefly_far_light');
    expect(usePartyStore.getState().unlockMasteryNode(hero.id, 'firefly_twin_motes')).toBe(false);
  });

  it('fields Far Light, Steady Flame and the healing power of Kindled Light', () => {
    const hero = buyLine('firefly_far_light');
    const unit = playerUnitFor(hero, {}, { id: 'ff', position: at(0, 0) });
    expect(unit.passives).toEqual(expect.arrayContaining(['farLight', 'steadyFlame']));
    const { firefly_kindled_light: _kindled, ...without } = hero.masteryNodes;
    const bare = playerUnitFor({ ...hero, masteryNodes: without }, {}, { id: 'x', position: at(0, 0) });
    const node = nodeById('firefly_kindled_light');
    expect((unit.stats.healPower ?? 0) - (bare.stats.healPower ?? 0))
      .toBe(nodeStatBonusAt(node, hero.masteryNodes[node.id]).healPower);
  });

  it('fields Twin Motes, Second Light and the single-target bonus of Bright Bolt', () => {
    const hero = buyLine('firefly_twin_motes');
    const unit = playerUnitFor(hero, {}, { id: 'ff', position: at(0, 0) });
    expect(unit.passives).toEqual(expect.arrayContaining(['twinMotes', 'secondLight']));
    const node = nodeById('firefly_bright_bolt');
    expect(unit.masteryModifiers?.singleTargetDamageBonus)
      .toBeCloseTo(nodeModifierAt(node, hero.masteryNodes[node.id]).singleTargetDamageBonus!);
  });
});

// ─── Far Light ────────────────────────────────────────────────────────────────

describe('Far Light', () => {
  const ranks = { farLight: { level: 1, scale: 1 } };

  it('reaches one hex further with Glowmote, Lightbond and Purifying Light', () => {
    for (const skill of [glowmote, lightbond, purifyingLight]) {
      expect(FAR_LIGHT_SKILLS).toContain(skill.id);
      expect(withFarLight(skill, ranks).range).toBe(skill.range + F.FAR_LIGHT_RANGE);
    }
  });

  it('leaves the blink, the Swarm, the Beacon and the sweep where they were', () => {
    for (const skill of [lanternGlide, fireflySwarm, lanternBeacon, lanternSweep]) {
      expect(withFarLight(skill, ranks)).toBe(skill);
    }
  });

  it('does nothing without the node', () => {
    expect(withFarLight(glowmote, {})).toBe(glowmote);
  });
});

// ─── Twin Motes ───────────────────────────────────────────────────────────────

describe('Twin Motes', () => {
  it('heals the two most hurt allies in reach, each for the whole mote', () => {
    useCombatStore.setState({
      units: [
        firefly({}, ['twinMotes']),
        ally('worst', at(1, 0), 50), ally('next', at(0, 1), 100), ally('third', at(-1, 1), 150),
        foe('x', at(3, 0)),
      ],
    });
    cast(glowmote, at(3, 0));
    const mote = Math.round(lostBy('x') * F.MOTE_SHARE);
    expect(hpOf('worst')).toBe(50 + mote);
    expect(hpOf('next')).toBe(100 + mote);
    expect(hpOf('third')).toBe(150);
  });

  it('heals one without the node', () => {
    useCombatStore.setState({
      units: [firefly(), ally('worst', at(1, 0), 50), ally('next', at(0, 1), 100), foe('x', at(3, 0))],
    });
    cast(glowmote, at(3, 0));
    expect(hpOf('next')).toBe(100);
  });

  it('lets a hurt Firefly fill the second place only when one other is hurt', () => {
    const lone = [firefly({ currentHp: 120 }, ['twinMotes']), ally('hurt', at(1, 0), 50)];
    expect(moteRecipients(lone[0], lone, F.MOTE_REACH, F.TWIN_MOTES).map((u) => u.id)).toEqual(['hurt', 'ff']);
    const two = [...lone, ally('also', at(0, 1), 190)];
    expect(moteRecipients(two[0], two, F.MOTE_REACH, F.TWIN_MOTES).map((u) => u.id)).toEqual(['hurt', 'also']);
  });
});

// ─── Bright Bolt and Kindled Light ────────────────────────────────────────────

describe('Bright Bolt', () => {
  it('raises Glowmote and the Basic Attack bolt, and nothing that covers an area', () => {
    const bonus = nodeById('firefly_bright_bolt').modifier!.singleTargetDamageBonus!;
    const unit = firefly({ masteryModifiers: { singleTargetDamageBonus: bonus } });
    expect(shapeDamageScale(unit, glowmote)).toBeCloseTo(1 + bonus);
    expect(shapeDamageScale(unit, { ...glowmote, id: BASIC_ATTACK_ID })).toBeCloseTo(1 + bonus);
    expect(shapeDamageScale(unit, lanternSweep)).toBe(1);
    expect(shapeDamageScale(unit, fireflySwarm)).toBe(1);
  });
});

describe('Kindled Light', () => {
  it('makes the heals the Firefly casts stronger by its healing power', () => {
    const power = nodeById('firefly_kindled_light').statBonus!.healPower!;
    const plain = calculateHealing(firefly(), purifyingLight);
    const kindled = calculateHealing(firefly({ stats: stats({ healPower: power }) }), purifyingLight);
    expect(kindled).toBe(Math.round(plain * (1 + power / 100)));
  });
});

// ─── Steady Flame ─────────────────────────────────────────────────────────────

describe('Steady Flame', () => {
  const chi = () => unitNow('ff').currentMana;

  it('hands back chi once for a cast that heals allies, however many it heals', () => {
    useCombatStore.setState({
      units: [firefly({}, ['steadyFlame']), ally('a', at(1, 0), 50), ally('b', at(0, 1), 50), foe('x', at(-1, 0))],
    });
    cast(lanternSweep, at(0, 0));
    expect(hpOf('a')).toBeGreaterThan(50);
    expect(hpOf('b')).toBeGreaterThan(50);
    // Paid after the cast, so a Firefly casting from a full pool keeps the refund
    expect(chi()).toBe(60 - lanternSweep.manaCost + F.STEADY_FLAME_CHI);
  });

  it('counts the mote and every cast, not once a turn', () => {
    useCombatStore.setState({ units: [firefly({}, ['steadyFlame']), ally('a', at(1, 0), 50), foe('x', at(3, 0))] });
    cast(glowmote, at(3, 0));
    expect(chi()).toBe(60 - glowmote.manaCost + F.STEADY_FLAME_CHI);
    offCooldown();
    cast(purifyingLight, at(1, 0));
    expect(chi()).toBe(60 - glowmote.manaCost - purifyingLight.manaCost + 2 * F.STEADY_FLAME_CHI);
  });

  it('pays nothing for healing only the Firefly itself', () => {
    useCombatStore.setState({ units: [firefly({ currentHp: 50 }, ['steadyFlame']), ally('fine', at(1, 0))] });
    cast(purifyingLight, at(0, 0));
    expect(chi()).toBe(60 - purifyingLight.manaCost);
  });

  it('climbs a point a rung', () => {
    const node = nodeById('firefly_steady_flame');
    expect([1, 2, 3].map((l) => nodeSimpleText(node, l)!.match(/regain (\d+) chi/)![1]))
      .toEqual([F.STEADY_FLAME_CHI - 1, F.STEADY_FLAME_CHI, F.STEADY_FLAME_CHI + 1].map(String));
  });
});

// ─── Second Light ─────────────────────────────────────────────────────────────

describe('Second Light', () => {
  const barrierOn = (id: string) => unitNow(id).activeEffects.find((e) => e.type === AuraType.Barrier);
  const heal = () => calculateHealing(firefly(), purifyingLight);

  it('shields an ally a heal lifts from below half health to above it', () => {
    const below = 100 - Math.ceil(heal() / 2);
    useCombatStore.setState({ units: [firefly({}, ['secondLight']), ally('a', at(1, 0), below)] });
    cast(purifyingLight, at(1, 0));
    expect(hpOf('a')).toBeGreaterThan(100);
    expect(barrierOn('a')).toMatchObject({
      magnitude: Math.round(20 * F.SECOND_LIGHT_BARRIER), duration: F.SECOND_LIGHT_DURATION, sourceUnitId: 'ff',
    });
  });

  it('does nothing for a heal that stays below half, or starts above it', () => {
    useCombatStore.setState({
      units: [firefly({}, ['secondLight']), ally('low', at(1, 0), 100 - heal() - 5), ally('high', at(0, 1), 120)],
    });
    cast(purifyingLight, at(1, 0));
    offCooldown();
    cast(purifyingLight, at(0, 1));
    expect(barrierOn('low')).toBeUndefined();
    expect(barrierOn('high')).toBeUndefined();
  });

  it('does nothing without the node', () => {
    useCombatStore.setState({ units: [firefly(), ally('a', at(1, 0), 100 - Math.ceil(heal() / 2))] });
    cast(purifyingLight, at(1, 0));
    expect(barrierOn('a')).toBeUndefined();
  });
});

// ─── Copy ─────────────────────────────────────────────────────────────────────

describe('the Firefly copy', () => {
  const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z])/).length;
  const skills = [glowmote, ...path.nodes.filter((n) => n.grantsSkill).map((n) => nodeSkillAt(n, 2)!)];

  it('gives every Firefly node a Simple line of one or two sentences at every rung', () => {
    for (const n of path.nodes) {
      for (const level of [1, 2, 3].slice(0, n.maxLevel ?? 3)) {
        const text = nodeSimpleText(n, level);
        expect({ id: n.id, text }).toEqual({ id: n.id, text: expect.any(String) });
        expect(sentences(text!)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('gives every Firefly skill a Simple line of one or two sentences', () => {
    for (const s of skills) {
      const text = skillSimpleText(s);
      expect({ id: s.id, text }).toEqual({ id: s.id, text: expect.any(String) });
      expect(sentences(text!)).toBeLessThanOrEqual(2);
    }
  });

  it('says what Glowmote\'s mote does, and that Twin Motes sends it to two', () => {
    expect(skillSimpleText(glowmote, firefly())).toMatch(/the most hurt ally/);
    expect(skillSimpleText(glowmote, firefly({}, ['twinMotes']))).toMatch(/two most hurt allies/);
    expect(describeSkill(glowmote, firefly())).toMatch(/mote/);
    expect(skillEffectLines(glowmote, firefly({}, ['brighterMotes'])).join(' '))
      .toMatch(new RegExp(`${Math.round(F.BRIGHTER_MOTE_SHARE * 100)}% of the damage`));
  });

  it('describes Lantern Glide as a blink, not a step through shadow', () => {
    expect(describeSkill(lanternGlide)).not.toMatch(/shadow/);
    expect(describeSkill(lanternGlide)).toMatch(/^Blink/);
  });

  it('gives every Firefly skill a Detailed line of its own rules', () => {
    for (const s of skills) {
      expect({ id: s.id, lines: skillEffectLines(s).length > 0 }).toEqual({ id: s.id, lines: true });
    }
  });
});
