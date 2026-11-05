import { spyDice } from '../support/dice';
import { at, makeFoe, makeHero, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';
import { BALANCE } from '@/data/balanceConstants';
import { findMasteryPath } from '@/data/skills/masteryData';
import {
  fireflyMotes, fireflySwarm, glowmote, lanternBeacon, lanternGlide, lanternSweep, purifyingLight,
} from '@/data/skills/masterySkills';
import { maul } from '@/data/skills/skillData';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { usePartyStore } from '@/stores/partyStore';
import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { beginTurn } from '@/systems/combat/turnStart';
import { decideEnemyAction } from '@/systems/combat/enemyAI';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { moteAt } from '@/systems/combat/fireflyRules';
import { requireUnit } from '@/systems/combat/unitLookup';
import { nodeSkillAt } from '@/systems/progression/mastery';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import {
  AfflictionType, AuraType, CombatUnit, HeroClass, HeroSkill, HeroStats, HexCoord,
} from '@/models/types';

/**
 * The Firefly's capstones (the private project notes, "### Firefly"): Firefly
 * Motes, Firefly Swarm and Lantern Beacon. Pinned as rules — every arrival route
 * fires a mote and the AI never steers by them; a boss refuses the Silence and
 * keeps the rest; the Beacon burns out unhealed, outlives that healed and dies to
 * blows; the three exclude each other — with the numbers read from
 * `BALANCE.FIREFLY` and the skills.
 */

const F = BALANCE.FIREFLY;

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 200, attack: 10, magic: 20, defense: 0, magicDefense: 0, maxMana: 60,
    critChance: 0, dodgeChance: 0, speed: 10, moveRange: 3, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const hpOf = (id: string) => unitNow(id).currentHp;
const has = (id: string, type: string) => unitNow(id).activeEffects.some((e) => e.type === type);

const firefly = (over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'ff', position: at(0, 0), stats: stats(), currentMana: 60, resource: 'chi',
    skills: [glowmote, lanternSweep, purifyingLight, lanternGlide, fireflyMotes, fireflySwarm, lanternBeacon],
    ...over,
  });
const ally = (id: string, position: HexCoord, hp = 200, over: Partial<CombatUnit> = {}) =>
  makeUnit({ id, position, stats: stats(), currentHp: hp, ...over });
const foe = (id: string, position: HexCoord, over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, position, stats: stats({ maxHp: 2000 }), ...over });

const cast = (skill: HeroSkill, target: HexCoord, casterId = 'ff') =>
  resolveSkillUse(unitNow(casterId), skill, target, SILENT_SINK);

/** Lays one mote of the Firefly's straight onto `hex`, as the cast would. */
const moteOn = (hex: HexCoord, heal = 30) =>
  state().addHazard({ id: `mote:ff:${hex.q},${hex.r}`, hexes: [hex], solid: false, label: 'Firefly Motes', ownerId: 'ff', mote: { heal } });

beforeEach(() => {
  resetFixtureIds();
  state().reset();
  spyDice().mockReturnValue(0.5);
});

// ─── The capstones in the tree ────────────────────────────────────────────────

describe('the Firefly capstones', () => {
  const path = findMasteryPath('firefly')!;
  const capstones = path.nodes.filter((n) => n.tier === 3 && !n.sideTree);

  it('are three, in the plan\'s columns, each granting its skill', () => {
    expect(capstones.map((n) => [n.column, n.grantsSkill]).sort())
      .toEqual([[0, 'firefly_motes'], [1, 'firefly_swarm'], [2, 'lantern_beacon']]);
  });

  /** A capstone and one regular spell empty the pool: that is the chi loop. */
  it('cost chi, enough that a capstone and one regular spell leave the Monk dry', () => {
    for (const skill of [fireflyMotes, fireflySwarm, lanternBeacon]) {
      expect(skill.manaCost).toBeGreaterThan(lanternSweep.manaCost);
      expect(skill.manaCost + purifyingLight.manaCost).toBeGreaterThanOrEqual(BALANCE.CHI.POOL - BALANCE.CHI.BASIC_ATTACK_REFILL);
      expect(skill.cooldown).toBeGreaterThan(2);
    }
  });

  it('exclude each other: buying one locks the other two', () => {
    const template = heroTemplates.find((t) => t.id === 'monk')!;
    const hero = makeHero({
      id: 'h-ff', templateId: 'monk', heroClass: HeroClass.Monk, level: 20,
      baseStats: calculateStatsForLevel(template, 20), skills: [...template.skills],
    });
    usePartyStore.setState({ heroes: [hero] });
    const party = () => usePartyStore.getState();
    expect(party().chooseMastery(hero.id, 'firefly')).toBe(true);
    for (const node of path.nodes.filter((n) => n.tier < 3 && !n.sideTree)) expect(party().unlockMasteryNode(hero.id, node.id)).toBe(true);
    const [first, ...rest] = capstones;
    expect(party().unlockMasteryNode(hero.id, first.id)).toBe(true);
    for (const other of rest) expect(party().unlockMasteryNode(hero.id, other.id)).toBe(false);
  });

  it('lays three, four or five motes by rank', () => {
    const node = capstones.find((n) => n.grantsSkill === 'firefly_motes')!;
    expect([1, 2, 3].map((level) => nodeSkillAt(node, level)!.motes!.count)).toEqual([3, 4, 5]);
  });
});

// ─── Firefly Motes ────────────────────────────────────────────────────────────

describe('Firefly Motes', () => {
  it('lays its count of motes on distinct free hexes within reach of the Firefly', () => {
    useCombatStore.setState({ units: [firefly(), ally('a', at(1, 0)), foe('x', at(0, 1))] });
    expect(cast(fireflyMotes, at(0, 0)).ok).toBe(true);
    const motes = state().hazards.filter((h) => h.mote);
    expect(motes).toHaveLength(F.MOTES_COUNT);
    const hexes = motes.map((h) => h.hexes[0]);
    expect(new Set(hexes.map(hexKey)).size).toBe(hexes.length);
    for (const hex of hexes) {
      expect(hexDistance(hex, at(0, 0))).toBeLessThanOrEqual(F.MOTES_RADIUS);
      expect(state().units.some((u) => hexKey(u.position) === hexKey(hex))).toBe(false);
    }
    expect(unitNow('ff').currentMana).toBe(60 - fireflyMotes.manaCost);
  });

  it('fixes each mote\'s heal from the Firefly\'s Magic when it is laid', () => {
    useCombatStore.setState({ units: [firefly()] });
    cast(fireflyMotes, at(0, 0));
    for (const mote of state().hazards.filter((h) => h.mote)) {
      expect(mote.mote!.heal).toBe(Math.round(20 * F.MOTE_HEAL));
    }
  });

  it('refuses the cast when there is no free ground', () => {
    useCombatStore.setState({ units: [firefly()] });
    // Every hex within reach already holds a mote
    for (let i = 0; i < 6; i++) cast(fireflyMotes, at(0, 0));
    state().restoreMana('ff', 999);
    expect(cast(fireflyMotes, at(0, 0)).ok).toBe(false);
  });

  /** The arrival, by each of the routes the plan names, through the one funnel every route takes. */
  const arrivedOn = (route: 'walk' | 'dash' | 'blink' | 'push') => {
    const hex = at(2, 0);
    if (route === 'blink') {
      // The Firefly is its own ally: Lantern Glide onto its own mote
      useCombatStore.setState({ units: [firefly({ currentHp: 100 })] });
      moteOn(hex);
      expect(cast(lanternGlide, hex).ok).toBe(true);
      return 'ff';
    }
    if (route === 'push') {
      // A foe at (0,0) mauls the ally at (1,0) one hex on, onto (2,0)
      useCombatStore.setState({ units: [firefly({ position: at(-2, 0) }), ally('a', at(1, 0), 100), foe('x', at(0, 0), { skills: [maul] })] });
      moteOn(hex);
      expect(resolveSkillUse(unitNow('x'), maul, at(1, 0), SILENT_SINK).ok).toBe(true);
      expect(unitNow('a').position).toEqual(hex);
      return 'a';
    }
    useCombatStore.setState({ units: [firefly({ position: at(-2, 0) }), ally('a', at(0, 0), 100)] });
    moteOn(hex);
    state().moveUnit('a', hex, route, true);
    return 'a';
  };

  it.each(['walk', 'dash', 'blink', 'push'] as const)('fires when an ally arrives on it by %s, and is spent', (route) => {
    const id = arrivedOn(route);
    expect(moteAt(state().hazards, at(2, 0))).toBeUndefined();
    // The shove's blow lands before the mote's heal, so only the other routes' totals are exact
    if (route !== 'push') expect(hpOf(id)).toBe(100 + 30);
    const effects = unitNow(id).activeEffects;
    expect(effects.find((e) => e.type === AuraType.AttackBuff)?.magnitude).toBe(F.MOTE_ATTACK);
    expect(effects.find((e) => e.type === AuraType.CritBuff)?.magnitude).toBe(F.MOTE_CRIT);
  });

  it('is put out by an enemy arriving on it, who gains nothing', () => {
    useCombatStore.setState({ units: [firefly(), foe('x', at(0, 2), { currentHp: 1000 })] });
    moteOn(at(1, 1));
    state().moveUnit('x', at(1, 1), 'walk', true);
    expect(moteAt(state().hazards, at(1, 1))).toBeUndefined();
    expect(hpOf('x')).toBe(1000);
    expect(has('x', AuraType.AttackBuff)).toBe(false);
  });

  it('is stood on, not crossed: a walk through it leaves it waiting', () => {
    useCombatStore.setState({ units: [firefly({ position: at(-3, 0) }), ally('a', at(0, 0), 100)] });
    moteOn(at(1, 0));
    state().moveUnit('a', at(2, 0), 'walk', true, undefined, [at(0, 0), at(1, 0), at(2, 0)]);
    expect(moteAt(state().hazards, at(1, 0))).toBeDefined();
    expect(hpOf('a')).toBe(100);
  });

  it('never steers the AI: an enemy plans the same move with motes on the board as without', () => {
    const board = () => [
      firefly({ position: at(-2, 2) }),
      ally('a', at(-3, 0), 100),
      foe('x', at(3, -2), { skills: [maul], stats: stats({ maxHp: 2000, moveRange: 3 }) }),
    ];
    useCombatStore.setState({ units: board() });
    const bare = decideEnemyAction(unitNow('x'), state().units);
    state().reset();
    useCombatStore.setState({ units: board() });
    for (const hex of [at(0, 0), at(1, -1), at(0, -1), at(-1, 0), at(2, -2), at(1, 0)]) moteOn(hex);
    expect(decideEnemyAction(unitNow('x'), state().units)).toEqual(bare);
  });
});

// ─── Firefly Swarm ────────────────────────────────────────────────────────────

describe('Firefly Swarm', () => {
  const bossTemplate = enemyTemplates.find((t) => t.tier === 'boss')!;

  it('hurts, Silences and weakens every enemy in the area, and spares allies', () => {
    useCombatStore.setState({ units: [firefly(), foe('x', at(2, 0)), foe('y', at(3, 0)), ally('a', at(2, -1))] });
    expect(cast(fireflySwarm, at(2, 0)).ok).toBe(true);
    for (const id of ['x', 'y']) {
      expect(hpOf(id)).toBeLessThan(2000);
      expect(has(id, AfflictionType.Silence)).toBe(true);
      expect(unitNow(id).activeEffects.find((e) => e.type === AfflictionType.AttackDown)?.magnitude).toBe(F.SWARM_ATTACK_DOWN);
    }
    expect(hpOf('a')).toBe(200);
    expect(has('a', AfflictionType.Silence)).toBe(false);
  });

  it('lets a boss refuse the Silence and keeps the damage and the Attack Down on it', () => {
    useCombatStore.setState({ units: [firefly(), foe('boss', at(2, 0), { templateId: bossTemplate.id })] });
    expect(cast(fireflySwarm, at(2, 0)).ok).toBe(true);
    expect(hpOf('boss')).toBeLessThan(2000);
    expect(has('boss', AfflictionType.Silence)).toBe(false);
    expect(has('boss', AfflictionType.AttackDown)).toBe(true);
  });
});

// ─── Lantern Beacon ───────────────────────────────────────────────────────────

describe('Lantern Beacon', () => {
  const beaconOf = () => state().units.find((u) => u.templateId === 'lantern_beacon' && u.currentHp > 0);
  const plant = (at_: HexCoord = at(1, 0)) => {
    expect(cast(lanternBeacon, at_).ok).toBe(true);
    return beaconOf()!;
  };
  const fireflyTurn = () => beginTurn('ff', SILENT_SINK);

  it('stands on a free hex within two with a share of the Firefly\'s health, and no turn of its own', () => {
    useCombatStore.setState({ units: [firefly()], turnOrder: ['ff'] });
    expect(cast(lanternBeacon, at(3, 0)).ok).toBe(false);
    const beacon = plant(at(2, 0));
    expect(beacon.isPlayer).toBe(true);
    expect(beacon.stats.maxHp).toBe(Math.round(200 * F.BEACON_HP_SHARE));
    expect(state().turnOrder).not.toContain(beacon.id);
  });

  it('stays where it was planted when the Firefly moves', () => {
    useCombatStore.setState({ units: [firefly()] });
    const beacon = plant(at(1, 0));
    state().moveUnit('ff', at(-3, 0), 'walk', true);
    expect(unitNow(beacon.id).position).toEqual(at(1, 0));
  });

  it('burns out after three Firefly turns unhealed', () => {
    useCombatStore.setState({ units: [firefly()] });
    const beacon = plant();
    fireflyTurn();
    fireflyTurn();
    expect(hpOf(beacon.id)).toBeGreaterThan(0);
    fireflyTurn();
    expect(hpOf(beacon.id)).toBe(0);
  });

  it('lives longer when the Firefly\'s heals reach it', () => {
    useCombatStore.setState({ units: [firefly({ stats: stats({ magic: 60 }) })] });
    const beacon = plant();
    for (let turn = 0; turn < 3; turn++) {
      fireflyTurn();
      state().restoreMana('ff', 999);
      state().tickCooldowns('ff');
      state().tickCooldowns('ff');
      expect(cast(purifyingLight, unitNow(beacon.id).position).ok).toBe(true);
    }
    expect(hpOf(beacon.id)).toBeGreaterThan(0);
  });

  it('dies to attacks', () => {
    useCombatStore.setState({ units: [firefly(), foe('x', at(2, 0), { stats: stats({ attack: 400, maxHp: 2000 }) })] });
    const beacon = plant(at(1, 0));
    expect(resolveSkillUse(unitNow('x'), { ...maul, pushDistance: undefined }, at(1, 0), SILENT_SINK).ok).toBe(true);
    expect(hpOf(beacon.id)).toBe(0);
  });

  it('heals the allies in its light at the start of each Firefly turn, never itself', () => {
    useCombatStore.setState({ units: [firefly({ currentHp: 100 }), ally('near', at(3, 0), 100), ally('far', at(-3, 0), 100)] });
    const beacon = plant(at(2, 0));
    fireflyTurn();
    const pulse = Math.round(20 * F.BEACON_HEAL);
    expect(hpOf('near')).toBe(100 + pulse);
    expect(hpOf('ff')).toBe(100 + pulse);
    expect(hpOf('far')).toBe(100);
    expect(hpOf(beacon.id)).toBe(beacon.stats.maxHp - Math.ceil(beacon.stats.maxHp * F.BEACON_DECAY));
  });

  it('lends allies in reach critical chance, and takes it back when they step out', () => {
    useCombatStore.setState({ units: [firefly(), ally('a', at(3, 0))] });
    const before = getCombatEffectiveStats(unitNow('a')).critChance ?? 0;
    plant(at(2, 0));
    expect(getCombatEffectiveStats(unitNow('a')).critChance).toBe(before + F.BEACON_CRIT);
    state().moveUnit('a', at(3, -3), 'walk', true);
    expect(has('a', AuraType.BeaconLight)).toBe(false);
  });

  it('opens enemies in reach to every blow and lets nothing hide in its light', () => {
    useCombatStore.setState({
      units: [firefly(), foe('x', at(3, 0), { activeEffects: [{ type: AuraType.Stealth, magnitude: 1, duration: 2 }] })],
    });
    const plain = calculateDamage(unitNow('ff'), unitNow('x'), glowmote);
    plant(at(2, 0));
    expect(has('x', AuraType.BeaconLit)).toBe(true);
    expect(has('x', AuraType.Stealth)).toBe(false);
    expect(calculateDamage(unitNow('ff'), unitNow('x'), glowmote))
      .toBe(Math.round(plain * (1 + F.BEACON_EXPOSED)));
    state().applyEffect('x', { type: AuraType.Stealth, magnitude: 1, duration: 2 });
    expect(has('x', AuraType.Stealth)).toBe(false);
  });

  it('takes its light with it when it goes out', () => {
    useCombatStore.setState({ units: [firefly(), ally('a', at(3, 0)), foe('x', at(2, 1))] });
    const beacon = plant(at(2, 0));
    expect(has('a', AuraType.BeaconLight)).toBe(true);
    state().damageUnit(beacon.id, 9999);
    expect(has('a', AuraType.BeaconLight)).toBe(false);
    expect(has('x', AuraType.BeaconLit)).toBe(false);
  });

  it('stands one at a time: a second Beacon replaces the first', () => {
    useCombatStore.setState({ units: [firefly()] });
    const first = plant(at(1, 0));
    state().restoreMana('ff', 999);
    state().tickCooldowns('ff');
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'ff' ? { ...u, cooldowns: {} } : u)) }));
    const second = plant(at(-1, 0));
    expect(hpOf(first.id)).toBe(0);
    expect(second.id).not.toBe(first.id);
  });
});
