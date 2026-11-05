import { BALANCE } from '@/data/balanceConstants';
import { BLESSINGS, MONASTERY_RINGS, blessingLine, type BlessingId } from '@/data/monastery';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import {
  blessedWrathPower, blessingsOf, blessUnit, dawnHealBonus, isVows, NO_VOWS, ringOpen, ringsAwaitingVow, takeVow,
  vowHours, wrathShare, type Vows,
} from '@/systems/world/monastery';
import { wrathPowerScale } from '@/systems/world/wrath';
import { useAscentStore } from '@/stores/ascentStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { usePartyStore } from '@/stores/partyStore';
import { inJadeveil, jadeveilFightTerms, provokeJadeveil } from '@/systems/world/ascent';
import { buildEncounter, encounterPowerScale, type EncounterTerms } from '@/systems/combat/encounterSetup';
import { magicDefenseOf } from '@/systems/combat/damageType';
import { TileType, type CombatUnit } from '@/models/types';

/**
 * The monastery's party-wide vows (`systems/world/monastery.ts`): four rings of
 * two, opening on arrival and at wrath's floors, held by the party rather than
 * by a hero, and in force only in Jadeveil.
 */
const ALL_FIRST: Vows = MONASTERY_RINGS.map((r) => r.choices[0]);
const ALL_SECOND: Vows = MONASTERY_RINGS.map((r) => r.choices[1]);

describe('the rings', () => {
  it('has four rings of two distinct blessings — eight in all — the first open on arrival', () => {
    expect(MONASTERY_RINGS).toHaveLength(4);
    const ids = MONASTERY_RINGS.flatMap((r) => r.choices);
    expect(new Set(ids).size).toBe(8);
    expect(Object.keys(BLESSINGS).sort()).toEqual([...ids].sort());
    expect(MONASTERY_RINGS.map((r) => r.opensAt)).toEqual([0, ...BALANCE.WRATH_FLOORS]);
    // Defensive, mobility and storm-survival choices are all on offer
    const kinds = new Set(ids.map((id) => BLESSINGS[id].kind));
    for (const kind of ['defence', 'mobility', 'storm'] as const) expect(kinds.has(kind)).toBe(true);
  });

  it('opens each ring at its floor, and lists the rings still waiting for a vow', () => {
    expect(ringsAwaitingVow(NO_VOWS, 0)).toEqual([0]);
    expect(ringsAwaitingVow(NO_VOWS, 50)).toEqual([0, 1, 2]);
    expect(ringsAwaitingVow(NO_VOWS, 75)).toEqual([0, 1, 2, 3]);
    expect(ringOpen(3, 50)).toBe(false);
    const vowed = takeVow(NO_VOWS, 0, 'stone_bell', 0)!;
    expect(ringsAwaitingVow(vowed, 25)).toEqual([1]);
  });

  it("refuses a vow at a shut ring or from another ring's pair", () => {
    expect(takeVow(NO_VOWS, 1, 'rain_walker', 0)).toBeNull();
    expect(takeVow(NO_VOWS, 0, 'rain_walker', 75)).toBeNull();
    expect(takeVow(NO_VOWS, 1, 'rain_walker', 25)).toEqual([null, 'rain_walker', null, null]);
  });

  it('makes a first vow free and every change the same day of prayer', () => {
    expect(vowHours(NO_VOWS, 2, 'wind_step')).toBe(0);
    for (let ring = 0; ring < MONASTERY_RINGS.length; ring++) {
      const [a, b] = MONASTERY_RINGS[ring].choices;
      const taken = NO_VOWS.map((v, i) => (i === ring ? a : v));
      expect(vowHours(taken, ring, a)).toBe(0);
      expect(vowHours(taken, ring, b)).toBe(BALANCE.MONASTERY_REVOW_HOURS);
    }
  });

  it('restores only vows a ring could hold', () => {
    expect(isVows(NO_VOWS)).toBe(true);
    expect(isVows(ALL_FIRST)).toBe(true);
    expect(isVows(['rain_walker', null, null, null])).toBe(false);
    expect(isVows([null, null, null])).toBe(false);
  });
});

const unit = (over: Partial<CombatUnit> = {}): CombatUnit => ({
  id: 'u', name: 'u', isPlayer: true, position: { q: 0, r: 0 }, currentHp: 80, currentMana: 0,
  stats: { maxHp: 100, attack: 10, defense: 20, magic: 5, speed: 10, moveRange: 3, maxMana: 10 },
  skills: [], hasMoved: false, hasActed: false, activeEffects: [], ...over,
} as CombatUnit);

describe('what the vows do', () => {
  it('blesses the party and never the enemy', () => {
    const blessed = blessUnit(unit(), ['stone_bell', 'cedar_heart', 'wind_step', 'storm_eye']);
    expect(blessed.stats.defense).toBe(22);
    expect(magicDefenseOf(blessed.stats)).toBe(22);
    expect(blessed.stats.maxHp).toBe(110);
    // The hero walked in 20 short of full, and still is
    expect(blessed.currentHp).toBe(90);
    expect(blessed.stats.speed).toBe(11);
    expect(blessed.stats.critChance).toBe(BALANCE.BASE_CRIT_CHANCE + 6);
    const enemy = unit({ isPlayer: false });
    expect(blessUnit(enemy, ALL_FIRST)).toBe(enemy);
    expect(blessUnit(unit(), ['mountain_stride', null, null, null]).stats.moveRange).toBe(4);
    expect(blessUnit(unit(), NO_VOWS).stats).toEqual(unit().stats);
  });

  it("lets Rain-Walker halve wrath's strength, and Lantern Vigil add to the dawn", () => {
    expect(wrathShare(NO_VOWS)).toBe(1);
    expect(wrathShare(ALL_FIRST)).toBe(0.5);
    expect(blessedWrathPower(100, ALL_FIRST)).toBeCloseTo(wrathPowerScale(100, 0.5));
    expect(dawnHealBonus(NO_VOWS)).toBe(0);
    expect(dawnHealBonus(ALL_SECOND)).toBeCloseTo(0.15);
  });

  it('stays well under what five hero levels add, for every class', () => {
    // The best a full set of vows does to each stat, taking each ring's stronger pick for it
    const most = (key: 'defensePct' | 'maxHpPct' | 'speedPct') =>
      MONASTERY_RINGS.reduce((sum, r) => sum + Math.max(...r.choices.map((id) => BLESSINGS[id].effect[key] ?? 0)), 0);
    for (const template of heroTemplates) {
      const before = calculateStatsForLevel(template, BALANCE.MAX_LEVEL - 5);
      const after = calculateStatsForLevel(template, BALANCE.MAX_LEVEL);
      const grew = (k: 'maxHp' | 'defense' | 'speed') => after[k] / before[k] - 1;
      expect(most('maxHpPct') / 100).toBeLessThan(grew('maxHp'));
      expect(most('defensePct') / 100).toBeLessThan(grew('defense'));
    }
    // Flat lines are small: one hex of movement, single-figure crit and dodge
    const flat = (key: 'moveRange' | 'critChance' | 'dodgeChance') =>
      Object.values(BLESSINGS).reduce((m, b) => Math.max(m, b.effect[key] ?? 0), 0);
    expect(flat('moveRange')).toBeLessThanOrEqual(1);
    expect(flat('critChance')).toBeLessThan(10);
    expect(flat('dodgeChance')).toBeLessThan(10);
    expect(most('speedPct')).toBeLessThanOrEqual(10);
  });
});

describe('only in Jadeveil, for the whole party', () => {
  beforeEach(() => {
    useWorldMapStore.getState().reset();
    useAscentStore.getState().reset();
    usePartyStore.getState().reset();
    useCalendarStore.getState().loadClock(100);
  });

  it('puts wrath and the vows on a fight in Jadeveil, and nothing on one in the Empire', () => {
    useAscentStore.setState({ vows: ALL_FIRST, wrath: { value: 80, at: 100, floor: 75, windowUntil: 0 } });
    expect(inJadeveil()).toBe(false);
    expect(jadeveilFightTerms()).toEqual({});
    useWorldMapStore.setState({ worldId: 'jadeveil' });
    const terms = jadeveilFightTerms();
    expect(terms.vows).toEqual(ALL_FIRST);
    expect(terms.wrathPower).toBeCloseTo(blessedWrathPower(80, ALL_FIRST));
    // Crossing home and back: off in the Empire, on again on return, with nothing stored on a hero
    useWorldMapStore.setState({ worldId: 'empire' });
    expect(jadeveilFightTerms()).toEqual({});
    useWorldMapStore.setState({ worldId: 'jadeveil' });
    expect(jadeveilFightTerms().vows).toEqual(ALL_FIRST);
  });

  it('blesses a recruit who joined after the vows exactly as it blesses the founder', () => {
    usePartyStore.getState().addHero('warrior');
    const vows: Vows = ['stone_bell', 'cedar_heart', null, null];
    usePartyStore.getState().addHero('mage');
    const groundTerms: EncounterTerms = {
      tileType: TileType.Plains,
      frost: false, curated: null, guardsChest: false, threatBand: 1, groundBand: 1, haunted: false,
      fromCastle: Infinity, groundDepth: 1, world: 'jadeveil',
    };
    const ctx = { encounterId: null, terms: groundTerms, castleRun: null, sim: { active: false, powerScale: 1 }, entry: null };
    const heroes = usePartyStore.getState().heroes;
    const plain = buildEncounter({ ...ctx, heroes });
    const blessed = buildEncounter({ ...ctx, heroes, vows, wrathPower: 1.2 });
    for (let i = 0; i < heroes.length; i++) {
      expect(blessed.players[i].stats.maxHp).toBe(Math.round(plain.players[i].stats.maxHp * 1.1));
    }
    // Wrath scales a ground fight's bodies, and never the harness's or the castle's
    expect(blessed.powerScale).toBeCloseTo(plain.powerScale * 1.2);
    expect(encounterPowerScale({ ...ctx, sim: { active: true, powerScale: 1.3 }, wrathPower: 2 })).toBe(1.3);
  });

  it('is provoked only by deeds done in Jadeveil', () => {
    expect(provokeJadeveil('lair')).toBeNull();
    expect(useAscentStore.getState().wrath.value).toBe(0);
    useWorldMapStore.setState({ worldId: 'jadeveil' });
    const award = provokeJadeveil('lair')!;
    expect(award.gained).toBe(BALANCE.WRATH_GAIN.lair);
    expect(provokeJadeveil('quest')!.gained).toBe(BALANCE.WRATH_GAIN.quest);
  });

  it('adds Lantern Vigil to the dawn in Jadeveil only', () => {
    usePartyStore.getState().addHero('warrior');
    const hero = () => usePartyStore.getState().heroes[0];
    useAscentStore.setState({ vows: [null, null, 'lantern_vigil', null] });
    const dawnFrom = (world: 'empire' | 'jadeveil') => {
      useWorldMapStore.setState({ worldId: world });
      usePartyStore.getState().setHp(hero().id, 1);
      useCalendarStore.getState().loadClock(BALANCE.HOURS_PER_DAY - 1);
      useWorldMapStore.getState().moveParty({ q: 0, r: 0 });
      return hero().currentHp;
    };
    expect(dawnFrom('jadeveil')).toBeGreaterThan(dawnFrom('empire'));
  });
});

describe('the blessings as data', () => {
  it('names and describes every one', () => {
    for (const id of Object.keys(BLESSINGS) as BlessingId[]) {
      expect(BLESSINGS[id].id).toBe(id);
      expect(blessingLine(id).length).toBeGreaterThan(5);
    }
    expect(blessingsOf(ALL_SECOND).map((b) => b.id)).toEqual(ALL_SECOND);
  });
});
