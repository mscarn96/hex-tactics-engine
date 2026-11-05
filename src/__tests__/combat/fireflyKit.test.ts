import { spyDice } from '../support/dice';
import { at, makeFoe, makeHero, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';
import { BALANCE } from '@/data/balanceConstants';
import { findMasteryPath } from '@/data/skills/masteryData';
import { glowmote, lanternGlide, lanternSweep, lightbond, purifyingLight } from '@/data/skills/masterySkills';
import { meditate } from '@/data/skills/skillData';
import { MASTERY_GROWTH } from '@/data/skills/masteryGrowth';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { usePartyStore } from '@/stores/partyStore';
import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { getSkillTargets, getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { requireUnit } from '@/systems/combat/unitLookup';
import { playerUnitFor } from '@/systems/combat/unitFactory';
import { moteRecipient } from '@/systems/combat/fireflyRules';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import {
  AfflictionType, AuraType, CombatUnit, HeroClass, HeroSkill, HeroStats, HexCoord, PassiveId, PassiveRank,
} from '@/models/types';

/**
 * The Firefly's first tree task (the private project notes, "### Firefly"):
 * Glowmote, the five feeders and the four actives. Pinned as rules — who the mote
 * reaches, that the bond heals once per blow, what the sweep covers — with the
 * numbers read from `BALANCE.FIREFLY` and the skills, not restated.
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
const ally = (id: string, position: HexCoord, hp = 200, over: Partial<CombatUnit> = {}) =>
  makeUnit({ id, position, stats: stats(), currentHp: hp, ...over });
const foe = (id: string, position: HexCoord) =>
  makeFoe({ id, position, stats: stats({ maxHp: 2000 }) });

const cast = (skill: HeroSkill, target: HexCoord, casterId = 'ff') =>
  resolveSkillUse(unitNow(casterId), skill, target, SILENT_SINK);

beforeEach(() => {
  resetFixtureIds();
  state().reset();
  // Mid-roll: no critical, no dodge, every chance-free rule exactly as written
  spyDice().mockReturnValue(0.5);
});

// ─── The tree ─────────────────────────────────────────────────────────────────

describe('the Firefly tree', () => {
  const path = findMasteryPath('firefly')!;
  const nodesIn = (tier: number) => path.nodes.filter((n) => n.tier === tier && !n.sideTree);

  it('is a Monk path whose signature is Glowmote', () => {
    expect(path.heroClass).toBe(HeroClass.Monk);
    expect(path.signatureSkill).toBe('glowmote');
  });

  it('has five feeders, the signature node in the middle, and four actives', () => {
    expect(nodesIn(1).map((n) => n.column).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(nodesIn(1).find((n) => n.column === 2)!.grantsPassive).toBe('brighterMotes');
    expect(nodesIn(2).map((n) => n.grantsSkill).sort())
      .toEqual(['lantern_glide', 'lantern_sweep', 'lightbond', 'purifying_light']);
  });

  /**
   * The chi loop turns only if every Monk signature costs chi, and one swing has
   * to buy the next: a free signature would always beat the Basic Attack.
   */
  it('prices Glowmote in chi that a single Basic Attack pays back', () => {
    expect(glowmote.manaCost).toBeGreaterThan(0);
    expect(glowmote.manaCost).toBeLessThanOrEqual(BALANCE.CHI.BASIC_ATTACK_REFILL);
    for (const skill of [lanternSweep, lightbond, purifyingLight, lanternGlide]) {
      expect(skill.manaCost).toBeGreaterThan(glowmote.manaCost);
      expect(skill.cooldown).toBeGreaterThan(0);
    }
  });

  it('grows Magic alone, never flat health', () => {
    expect(MASTERY_GROWTH.firefly.magic).toBeGreaterThan(0);
    expect(MASTERY_GROWTH.firefly.maxHp).toBeUndefined();
  });
});

// ─── Buying the whole tree and fighting with it ───────────────────────────────

describe('a Firefly who buys every node', () => {
  const template = heroTemplates.find((t) => t.id === 'monk')!;

  function buyEverything() {
    const hero = makeHero({
      id: 'h-ff', templateId: 'monk', heroClass: HeroClass.Monk, level: 20,
      baseStats: calculateStatsForLevel(template, 20), skills: [...template.skills],
    });
    usePartyStore.setState({ heroes: [hero] });
    const party = usePartyStore.getState();
    expect(party.chooseMastery(hero.id, 'firefly')).toBe(true);
    const path = findMasteryPath('firefly')!;
    // Every feeder and active, and one capstone: the three exclude each other
    const order = [...path.nodes].filter((n) => !n.sideTree && (n.tier < 3 || (n.tier === 3 && n.column === 0)))
      .sort((a, b) => a.tier - b.tier || a.column - b.column);
    for (const node of order) expect(usePartyStore.getState().unlockMasteryNode(hero.id, node.id)).toBe(true);
    return usePartyStore.getState().heroes[0];
  }

  it('can buy the nine below the capstones and one capstone, and fields the signature, the four actives and the three passives', () => {
    const hero = buyEverything();
    expect(Object.keys(hero.masteryNodes)).toHaveLength(10);
    const unit = playerUnitFor(hero, {}, { id: 'ff', position: at(0, 0) });
    const ids = unit.skills.map((s) => s.id);
    for (const id of ['glowmote', 'lantern_sweep', 'lightbond', 'purifying_light', 'lantern_glide']) {
      expect(ids).toContain(id);
    }
    expect(unit.passives).toEqual(expect.arrayContaining(['brighterMotes', 'lanternBreath', 'afterglow']));
  });

  it('takes its Magic, Magic Defense, Speed and chi from Glowing Wraps and Wingbeat', () => {
    const hero = buyEverything();
    const bare = getEffectiveStats({ ...hero, masteryNodes: {} });
    const bought = getEffectiveStats(hero);
    const path = findMasteryPath('firefly')!;
    const wraps = path.nodes.find((n) => n.id === 'firefly_glowing_wraps')!.statBonus!;
    const wing = path.nodes.find((n) => n.id === 'firefly_wingbeat')!.statBonus!;
    // Bought at the first rung: the scaled share of each bonus
    expect(bought.magic).toBeGreaterThan(bare.magic);
    expect(bought.magicDefense! - bare.magicDefense!).toBe(Math.round(wraps.magicDefense! * 0.75));
    expect(bought.speed - bare.speed).toBe(Math.round(wing.speed! * 0.75));
    expect(bought.maxMana - bare.maxMana).toBe(Math.round(wing.maxMana! * 0.75));
  });

  it('casts every one of its skills in a fight', () => {
    const hero = buyEverything();
    const fielded = playerUnitFor(hero, {}, { id: 'ff', position: at(0, 0) });
    const skill = (id: string) => fielded.skills.find((s) => s.id === id)!;
    useCombatStore.setState({
      units: [
        { ...fielded, currentHp: 50 },
        ally('a', at(0, 1), 60),
        ally('b', at(2, 0), 60, { activeEffects: [{ type: AfflictionType.Poison, magnitude: 5, duration: 3 }] }),
        foe('x', at(1, -1)),
      ],
    });
    // Five spells in a row is more than one pool: that is the chi loop working,
    // so the pool is topped up between casts as the Basic Attacks would
    const spend = (id: string, target: HexCoord) => {
      state().restoreMana('ff', 999);
      const full = unitNow('ff').currentMana;
      expect(cast(skill(id), target).ok).toBe(true);
      expect(unitNow('ff').currentMana).toBe(full - skill(id).manaCost);
    };
    spend('glowmote', at(1, -1));
    spend('lightbond', at(0, 1));
    spend('purifying_light', at(2, 0));
    spend('lantern_sweep', at(0, 0));
    spend('lantern_glide', at(-2, 0));

    expect(lostBy('x')).toBeGreaterThan(0);
    expect(unitNow('a').activeEffects.some((e) => e.type === AuraType.Lightbond)).toBe(true);
    expect(unitNow('b').activeEffects.some((e) => e.type === AfflictionType.Poison)).toBe(false);
    expect(unitNow('ff').position).toEqual(at(-2, 0));
  });
});

// ─── Glowmote's mote ──────────────────────────────────────────────────────────

describe("Glowmote's mote", () => {
  it('heals the most hurt ally within reach of the Firefly for its share of the damage', () => {
    useCombatStore.setState({
      units: [
        firefly(),
        ally('scratched', at(1, 0), 150),
        ally('worst', at(0, 2), 80),
        // More hurt, but beyond the mote's reach
        ally('far', at(0, -3), 20),
        foe('x', at(3, 0)),
      ],
    });
    expect(F.MOTE_REACH).toBeLessThan(3);
    expect(cast(glowmote, at(3, 0)).ok).toBe(true);
    const dealt = lostBy('x');
    expect(dealt).toBeGreaterThan(0);
    expect(hpOf('worst')).toBe(80 + Math.round(dealt * F.MOTE_SHARE));
    expect(hpOf('scratched')).toBe(150);
    expect(hpOf('far')).toBe(20);
  });

  it('returns to the Firefly when nobody else in reach is hurt', () => {
    useCombatStore.setState({
      units: [firefly({ currentHp: 100 }), ally('fine', at(1, 0)), foe('x', at(3, 0))],
    });
    cast(glowmote, at(3, 0));
    expect(hpOf('ff')).toBe(100 + Math.round(lostBy('x') * F.MOTE_SHARE));
    expect(hpOf('fine')).toBe(200);
  });

  it('prefers any hurt ally to a Firefly that is hurt worse', () => {
    const units = [firefly({ currentHp: 10 }), ally('grazed', at(1, 0), 199)];
    expect(moteRecipient(units[0], units, F.MOTE_REACH)!.id).toBe('grazed');
  });

  it('flies further and heals more with Brighter Motes', () => {
    useCombatStore.setState({
      units: [firefly({}, ['brighterMotes']), ally('far', at(0, -3), 20), foe('x', at(3, 0))],
    });
    cast(glowmote, at(3, 0));
    expect(F.BRIGHTER_MOTE_REACH).toBe(3);
    expect(hpOf('far')).toBe(20 + Math.round(lostBy('x') * F.BRIGHTER_MOTE_SHARE));
  });

  it('sends nothing when the bolt is dodged', () => {
    useCombatStore.setState({
      units: [
        firefly(), ally('hurt', at(1, 0), 50),
        makeFoe({ id: 'x', position: at(3, 0), stats: stats({ maxHp: 2000, dodgeChance: 100 }) }),
      ],
    });
    cast(glowmote, at(3, 0));
    expect(hpOf('hurt')).toBe(50);
  });
});

// ─── Lightbond ────────────────────────────────────────────────────────────────

describe('Lightbond', () => {
  const bondOn = (id: string) =>
    unitNow(id).activeEffects.find((e) => e.type === AuraType.Lightbond && e.sourceUnitId === 'ff');

  it('bonds one ally at a time: a new bond lifts the old', () => {
    useCombatStore.setState({ units: [firefly(), ally('a', at(1, 0)), ally('b', at(0, 1))] });
    expect(cast(lightbond, at(1, 0)).ok).toBe(true);
    expect(bondOn('a')).toMatchObject({ magnitude: F.LIGHTBOND_SHARE, duration: F.LIGHTBOND_DURATION });
    // A second cast is another turn's: its cooldown is not what is being tested
    useCombatStore.setState({ units: state().units.map((u) => ({ ...u, cooldowns: {} })) });
    expect(cast(lightbond, at(0, 1)).ok).toBe(true);
    expect(bondOn('a')).toBeUndefined();
    expect(bondOn('b')).toBeDefined();
  });

  it('refuses to bond an enemy or the Firefly itself', () => {
    useCombatStore.setState({ units: [firefly(), foe('x', at(1, 0))] });
    expect(cast(lightbond, at(1, 0)).ok).toBe(false);
    expect(cast(lightbond, at(0, 0)).ok).toBe(false);
  });

  /** One heal per damaging event: a sweep through two enemies is two blows, two heals. */
  it('heals the bonded ally once for each blow, half of each', () => {
    const bond = { type: AuraType.Lightbond, magnitude: F.LIGHTBOND_SHARE, duration: 3, sourceUnitId: 'ff' };
    useCombatStore.setState({
      units: [
        firefly(),
        // Outside the sweep, so only the bond can reach it
        ally('bonded', at(0, -3), 20, { activeEffects: [bond] }),
        foe('x', at(1, 0)),
        foe('y', at(-2, 0)),
      ],
    });
    const heals: number[] = [];
    const heal = state().healUnit;
    useCombatStore.setState({
      healUnit: (id, amount, source) => {
        if (id === 'bonded') heals.push(amount);
        return heal(id, amount, source);
      },
    });
    expect(cast(lanternSweep, at(0, 0)).ok).toBe(true);
    const blows = [lostBy('x'), lostBy('y')];
    expect(heals).toEqual(blows.map((d) => Math.round((d * F.LIGHTBOND_SHARE) / 100)));
    expect(hpOf('bonded')).toBe(20 + heals.reduce((a, b) => a + b, 0));
  });

  it('heals nothing from a blow somebody else landed', () => {
    const bond = { type: AuraType.Lightbond, magnitude: F.LIGHTBOND_SHARE, duration: 3, sourceUnitId: 'ff' };
    useCombatStore.setState({
      units: [
        firefly(), ally('bonded', at(0, -3), 20, { activeEffects: [bond] }),
        ally('other', at(2, 0), 200, { skills: [glowmote] }), foe('x', at(3, 0)),
      ],
    });
    cast(glowmote, at(3, 0), 'other');
    expect(hpOf('bonded')).toBe(20);
  });
});

// ─── Lantern Sweep ────────────────────────────────────────────────────────────

describe('Lantern Sweep', () => {
  it('covers exactly the ring of two round the Firefly', () => {
    const footprint = getSkillTargets(lanternSweep, at(0, 0), at(0, 0), []);
    expect(new Set(footprint.map(hexKey)).size).toBe(19);
    expect(footprint.every((h) => hexDistance(h, at(0, 0)) <= 2)).toBe(true);
  });

  it('hurts the enemies inside, heals the allies inside, and leaves the rest and the Firefly alone', () => {
    useCombatStore.setState({
      units: [
        firefly({ currentHp: 100 }),
        foe('near', at(1, 0)), foe('edge', at(0, 2)), foe('out', at(3, 0)),
        ally('a1', at(-1, 0), 100), ally('a2', at(0, -2), 100), ally('a3', at(-3, 0), 100),
      ],
    });
    expect(cast(lanternSweep, at(0, 0)).ok).toBe(true);
    expect(lostBy('near')).toBeGreaterThan(0);
    expect(lostBy('edge')).toBeGreaterThan(0);
    expect(lostBy('out')).toBe(0);
    expect(hpOf('a1')).toBeGreaterThan(100);
    expect(hpOf('a2')).toBeGreaterThan(100);
    expect(hpOf('a3')).toBe(100);
    expect(hpOf('ff')).toBe(100);
  });

  it('is offered only with an enemy inside the ring', () => {
    const me = firefly();
    expect(getValidSkillTargetHexes(lanternSweep, me, [me, foe('out', at(3, 0))])).toEqual([]);
    expect(getValidSkillTargetHexes(lanternSweep, me, [me, foe('in', at(2, 0))])).toEqual([at(0, 0)]);
  });
});

// ─── Purifying Light, Lantern Glide ───────────────────────────────────────────

describe('Purifying Light', () => {
  it('strips every affliction from an ally and heals them', () => {
    useCombatStore.setState({
      units: [
        firefly(),
        ally('a', at(0, 3), 100, {
          activeEffects: [
            { type: AfflictionType.Poison, magnitude: 5, duration: 3 },
            { type: AfflictionType.Burn, magnitude: 5, duration: 3 },
            { type: AuraType.DefenseBuff, magnitude: 3, duration: 2 },
          ],
        }),
      ],
    });
    expect(cast(purifyingLight, at(0, 3)).ok).toBe(true);
    const types = unitNow('a').activeEffects.map((e) => e.type);
    expect(types).not.toContain(AfflictionType.Poison);
    expect(types).not.toContain(AfflictionType.Burn);
    expect(types).toContain(AuraType.DefenseBuff);
    expect(hpOf('a')).toBeGreaterThan(100);
  });
});

describe('Lantern Glide', () => {
  it('blinks to a free hex, heals the allies beside the landing, and leaves the turn', () => {
    useCombatStore.setState({
      units: [
        firefly({ currentHp: 100 }),
        ally('beside', at(-3, 1), 100), ally('apart', at(-1, 0), 100),
        // Something in the way, which a blink ignores
        foe('x', at(-1, 1)),
      ],
    });
    const result = cast(lanternGlide, at(-3, 0));
    expect(result).toMatchObject({ ok: true, endsTurn: false });
    expect(unitNow('ff').position).toEqual(at(-3, 0));
    expect(hpOf('beside')).toBeGreaterThan(100);
    expect(hpOf('apart')).toBe(100);
    expect(hpOf('ff')).toBe(100);
    expect(lostBy('x')).toBe(0);
  });

  it('cannot land on an occupied hex or beyond its reach', () => {
    useCombatStore.setState({ units: [firefly(), ally('a', at(2, 0))] });
    expect(cast(lanternGlide, at(2, 0)).ok).toBe(false);
    expect(cast(lanternGlide, at(4, 0)).ok).toBe(false);
  });
});

// ─── The feeders ──────────────────────────────────────────────────────────────

describe('Lantern Breath', () => {
  it("spreads Meditate's next-turn heal to the allies beside the Firefly", () => {
    useCombatStore.setState({
      units: [
        firefly({ currentHp: 100, skills: [meditate] }, ['lanternBreath']),
        ally('beside', at(1, 0), 100), ally('apart', at(2, 0), 100),
      ],
    });
    const heal = Math.round(200 * BALANCE.MEDITATE.HEAL_SHARE);
    state().payMeditation('ff');
    expect(hpOf('ff')).toBe(100 + heal);
    expect(hpOf('beside')).toBe(100 + Math.round(heal * F.LANTERN_BREATH_SHARE));
    expect(hpOf('apart')).toBe(100);
  });

  it('is nothing without the node', () => {
    useCombatStore.setState({ units: [firefly({ currentHp: 100 }), ally('beside', at(1, 0), 100)] });
    state().payMeditation('ff');
    expect(hpOf('beside')).toBe(100);
  });
});

describe('Afterglow', () => {
  const buffed = (id: string) =>
    unitNow(id).activeEffects.filter((e) => e.type === AuraType.AttackBuff || e.type === AuraType.MagicBuff);

  it('lends Attack and Magic for a turn to an ally the Firefly heals', () => {
    useCombatStore.setState({ units: [firefly({}, ['afterglow']), ally('a', at(1, 0), 100)] });
    cast(purifyingLight, at(1, 0));
    expect(buffed('a').map((e) => [e.type, e.magnitude, e.duration])).toEqual(expect.arrayContaining([
      [AuraType.AttackBuff, F.AFTERGLOW_ATTACK, F.AFTERGLOW_DURATION],
      [AuraType.MagicBuff, F.AFTERGLOW_MAGIC, F.AFTERGLOW_DURATION],
    ]));
  });

  it('is not the Firefly healing itself, nor a heal that restored nothing', () => {
    useCombatStore.setState({
      units: [firefly({ currentHp: 100 }, ['afterglow']), ally('full', at(1, 0)), foe('x', at(3, 0))],
    });
    cast(glowmote, at(3, 0));
    expect(hpOf('ff')).toBeGreaterThan(100);
    expect(buffed('ff')).toEqual([]);
    useCombatStore.setState({ units: state().units.map((u) => ({ ...u, cooldowns: {} })) });
    cast(purifyingLight, at(1, 0));
    expect(buffed('full')).toEqual([]);
  });

  it('rides Lantern Breath too', () => {
    useCombatStore.setState({
      units: [firefly({ currentHp: 100 }, ['lanternBreath', 'afterglow']), ally('beside', at(1, 0), 100)],
    });
    state().payMeditation('ff');
    expect(buffed('beside')).toHaveLength(2);
  });
});
