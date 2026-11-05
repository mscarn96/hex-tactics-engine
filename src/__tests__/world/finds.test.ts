import { MapFind, POIType, ResourceType, TileType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { generateMap, isPassable, reachableFromCity } from '@/systems/world/mapGenerator';
import {
  CHEST_GUARD_ID,
  CHEST_GUARD_POWER_MULT,
  chestGuardBand,
  findCounts,
  findPayout,
  nearestFindOf,
  rollWeeklyFinds,
} from '@/systems/world/finds';
import { chestGuardCandidates, generateForBand, planForEncounter } from '@/systems/world/encounterGenerator';
import { threatPowerScale, ThreatBand } from '@/systems/world/threat';
import { createRNG } from '@/utils/rng';
import { waveViolations } from '@/systems/combat/waves';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { useCalendarStore } from '@/stores/calendarStore';

/**
 * The week's finds on the open map.
 *
 * What is pinned is the rule — a deal is a function of seed and week, lands
 * only on free walkable ground, pays what its ground is worth, and is gone when
 * the week turns or it is taken — and not the amounts the balance happens to use.
 */

const SEEDS = [1, 7, 42, 99, 1234, 4242, 90210, 777];
const HOURS_PER_WEEK = BALANCE.HOURS_PER_DAY * BALANCE.DAYS_PER_WEEK;

const MAPS = SEEDS.map((seed) => ({ seed, tiles: generateMap(seed) }));

describe('dealing a week', () => {
  it('deals the same ground for the same seed and week, and different ground for the next week', () => {
    for (const { seed, tiles } of MAPS.slice(0, 3)) {
      const a = rollWeeklyFinds(tiles, seed, 3);
      const b = rollWeeklyFinds(tiles, seed, 3);
      expect(JSON.stringify([...a])).toEqual(JSON.stringify([...b]));
      const next = rollWeeklyFinds(tiles, seed, 4);
      expect([...next.keys()].filter((k) => a.has(k)).length).toBeLessThan(a.size / 2);
    }
  });

  it('lands only on free, walkable, reachable ground off the road', () => {
    const bad: string[] = [];
    for (const { seed, tiles } of MAPS) {
      const byKey = new Map(tiles.map((t) => [hexKey(t.coord), t]));
      const city = tiles.find((t) => t.poi === POIType.City)!;
      const reachable = reachableFromCity(city.coord, byKey);
      for (const key of rollWeeklyFinds(tiles, seed, 1).keys()) {
        const tile = byKey.get(key)!;
        const why = [
          tile.poi && 'on a destination',
          tile.zone === 'road' && 'on the road',
          !isPassable(tile.type) && 'on impassable ground',
          tile.type === TileType.Mountain && 'on a peak',
          hexDistance(tile.coord, city.coord) <= BALANCE.EXPLORATION_FINDS.MIN_CITY_DISTANCE && 'beside the city',
          !reachable.has(key) && 'unreachable',
          tile.zone !== 'haunted' && 'a find outside haunted ground',
        ].filter(Boolean);
        if (why.length) bad.push(`${seed} ${key}: ${why.join(', ')}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('deals the full count on every seed, never two finds to one hex', () => {
    for (const { seed, tiles } of MAPS) {
      const finds = [...rollWeeklyFinds(tiles, seed, 1).values()];
      const want = findCounts(tiles.length);
      expect({ seed, chests: finds.filter((f) => f.kind === 'chest').length })
        .toEqual({ seed, chests: want.chests });
      expect({ seed, caches: finds.filter((f) => f.kind === 'cache').length })
        .toEqual({ seed, caches: want.caches + want.purses });
      expect(new Set(finds.map((f) => hexKey(f.coord))).size).toBe(finds.length);
    }
  });

  it('reduces the former cache density by a quarter', () => {
    const { tiles } = MAPS[0];
    const nodes = Math.round((tiles.length / 1000) * BALANCE.POI_PER_1000_TILES.resource);
    const caches = [...rollWeeklyFinds(tiles, MAPS[0].seed, 1).values()]
      .filter((f) => f.kind === 'cache' && f.payout[0].type !== ResourceType.Gold);
    expect(caches.length).toBe(Math.round(nodes * 3 * 0.75));
  });

  it('keeps crystal to the frozen north, the way ore keeps to the rock', () => {
    let crystal = 0;
    let north = 0;
    for (const { seed, tiles } of MAPS) {
      const byKey = new Map(tiles.map((t) => [hexKey(t.coord), t]));
      for (let week = 1; week <= 4; week++) {
        for (const find of rollWeeklyFinds(tiles, seed, week).values()) {
          if (find.kind !== 'cache' || find.payout[0].type !== ResourceType.Crystal) continue;
          crystal += 1;
          if (byKey.get(hexKey(find.coord))!.frost) north += 1;
        }
      }
    }
    expect(crystal).toBeGreaterThan(0);
    expect(north / crystal).toBeGreaterThan(0.5);
  });

  it('pays more on harder ground, and a chest far more than a purse', () => {
    const purses: Record<number, number[]> = {};
    const chests: number[] = [];
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    for (const { seed, tiles } of MAPS) {
      for (let week = 1; week <= 6; week++) {
        for (const find of rollWeeklyFinds(tiles, seed, week).values()) {
          const gold = find.payout.find((p) => p.type === ResourceType.Gold);
          if (!gold) continue;
          if (find.kind === 'chest') chests.push(gold.amount);
          else (purses[find.band] ??= []).push(gold.amount);
        }
      }
    }
    const bands = Object.keys(purses).map(Number).sort();
    expect(bands.length).toBeGreaterThan(1);
    expect(mean(purses[bands[bands.length - 1]])).toBeGreaterThan(mean(purses[bands[0]]));
    expect(mean(chests)).toBeGreaterThan(mean(Object.values(purses).flat()) * 2);
  });

  it('puts two different resources and gold in every chest', () => {
    for (const { seed, tiles } of MAPS.slice(0, 4)) {
      for (const find of rollWeeklyFinds(tiles, seed, 1).values()) {
        if (find.kind !== 'chest') continue;
        const types = find.payout.map((p) => p.type);
        expect(types).toContain(ResourceType.Gold);
        expect(new Set(types).size).toBe(3);
        expect(find.payout.every((p) => p.amount > 0)).toBe(true);
      }
    }
  });

  it('answers a quest arrow with the nearest seen find of that resource', () => {
    const { seed, tiles } = MAPS[0];
    const finds = rollWeeklyFinds(tiles, seed, 1);
    const from = tiles.find((t) => t.poi === POIType.City)!.coord;
    const wood = nearestFindOf(finds, from, ResourceType.Wood)!;
    expect(wood.payout.some((p) => p.type === ResourceType.Wood)).toBe(true);
    expect(nearestFindOf(finds, from, ResourceType.Wood, () => false)).toBeUndefined();
  });
});

describe('what a find pays', () => {
  const cache: MapFind = {
    kind: 'cache', coord: { q: 1, r: 1 }, band: 1,
    payout: [{ type: ResourceType.Iron, amount: 4 }],
  };

  it('is the dealt amount without a meal bonus, and at least that with one', () => {
    expect(findPayout(cache, 0)).toEqual(cache.payout);
    expect(findPayout(cache, 3)[0].amount).toBeGreaterThanOrEqual(4);
  });
});

describe('the finds on the world map across weeks', () => {
  const { seed, tiles } = MAPS[0];
  const city = tiles.find((t) => t.poi === POIType.City)!.coord;

  beforeEach(() => {
    useWorldMapStore.getState().reset();
    useWorldMapStore.getState().setTiles(tiles, seed);
  });

  it('holds the first week\'s deal on a new map', () => {
    const { finds } = useWorldMapStore.getState();
    expect(JSON.stringify([...finds])).toEqual(JSON.stringify([...rollWeeklyFinds(tiles, seed, 1)]));
  });

  it('pays a find once: claiming takes it off the map and nothing deals it back this week', () => {
    const store = useWorldMapStore.getState();
    const [key, find] = [...store.finds][0];
    expect(store.claimFind(find.coord)).toEqual(find);
    expect(useWorldMapStore.getState().finds.has(key)).toBe(false);
    expect(store.claimFind(find.coord)).toBeUndefined();
    // Travel inside the week deals nothing back.
    useWorldMapStore.getState().moveParty(city, 5);
    expect(useWorldMapStore.getState().finds.has(key)).toBe(false);
  });

  it('keeps an unclaimed find all week and deals a new week at the rollover', () => {
    const before = useWorldMapStore.getState().finds;
    useWorldMapStore.getState().moveParty(city, HOURS_PER_WEEK - 1);
    expect(useCalendarStore.getState().weekNumber).toBe(1);
    expect(useWorldMapStore.getState().finds).toBe(before);

    useWorldMapStore.getState().moveParty(city, 1);
    expect(useCalendarStore.getState().weekNumber).toBe(2);
    const after = useWorldMapStore.getState().finds;
    expect(JSON.stringify([...after])).toEqual(JSON.stringify([...rollWeeklyFinds(tiles, seed, 2)]));
    expect(after).not.toBe(before);
  });

  it('never rolls a daily fight onto a hex that holds a find', () => {
    const { finds } = useWorldMapStore.getState();
    for (let day = 0; day < 6; day++) {
      useWorldMapStore.getState().moveParty(city, BALANCE.HOURS_PER_DAY - 1);
      useWorldMapStore.getState().moveParty(city, 1);
      const live = useWorldMapStore.getState();
      for (const key of live.finds.keys()) expect(live.activeEncounterTiles.has(key)).toBe(false);
    }
    expect(finds.size).toBeGreaterThan(0);
  });
});

describe('a chest\'s guards', () => {
  it('fight one band above the ground, capped at the highest band', () => {
    expect([0, 1, 2, 3].map(chestGuardBand)).toEqual([1, 2, 3, 4]);
    expect(chestGuardBand(4)).toBe(4);
  });

  /**
   * The multiplier is under 1 since the 2026-10-09 playtest, so "stronger than
   * the ground" is held by the whole fight: the band above's power and shapes,
   * and the two waves. Bodies times power, against the ground's own warband.
   */
  it('field more strength than a wandering fight on the same ground', () => {
    const rng = createRNG(2026);
    const next = () => rng.next();
    const spy = jest.spyOn(Math, 'random').mockImplementation(next);
    try {
      const weak: string[] = [];
      for (const ground of [0, 1, 2, 3, 4] as ThreatBand[]) {
        const band = chestGuardBand(ground);
        let guards = 0;
        let wanderers = 0;
        for (let i = 0; i < 200; i++) {
          const plan = planForEncounter(CHEST_GUARD_ID, band, TileType.Plains, Infinity);
          guards += plan.enemies.length + (plan.waves ?? []).reduce((n, w) => n + w.templateIds.length, 0);
          wanderers += generateForBand(ground, TileType.Plains, Infinity, [], next).length;
        }
        const guardStrength = guards * threatPowerScale(band, undefined, true) * CHEST_GUARD_POWER_MULT;
        const groundStrength = wanderers * threatPowerScale(ground, undefined, true);
        if (guardStrength <= groundStrength * 1.2) weak.push(`band ${ground}: ${guardStrength} vs ${groundStrength}`);
      }
      expect(weak).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * Playtest 2026-10-09: "are they always centaurs?" From band 3 up the Thunder
   * Herd is the only native of the plains and the highlands, where most chests
   * lie, so a pool drawn at the guards' band alone gave it 3 of 5 entries on
   * band-4 plains. The pool is the union of the ground's band and the guards'.
   * Locked factions (`Faction.homeLocked`) leave the pool off their ground, so
   * the natives that remain are not weighted up: one entry each.
   */
  it('are drawn from varied factions, no one of them holding most of a pool', () => {
    const crowded: string[] = [];
    for (const terrain of [TileType.Plains, TileType.Highlands, TileType.Forest, TileType.Desert, TileType.Swamp, TileType.Tundra]) {
      for (const band of [1, 2, 3, 4] as ThreatBand[]) {
        const pool = chestGuardCandidates(band, terrain, Infinity);
        const counts = new Map<string, number>();
        for (const f of pool) counts.set(f.id, (counts.get(f.id) ?? 0) + 1);
        const top = Math.max(...counts.values()) / pool.length;
        // Two is the floor: the late forest and swamp have only the Dead and the Coven
        if (counts.size < 2 || top > 0.5) crowded.push(`${terrain} band ${band}: ${[...counts].join(' ')}`);
      }
    }
    expect(crowded).toEqual([]);
  });

  it('come with reinforcement waves that are legal and drawn from the roster', () => {
    const known = new Set(enemyTemplates.map((t) => t.id as string));
    for (let band = 0; band <= 4; band++) {
      const plan = planForEncounter(CHEST_GUARD_ID, chestGuardBand(band), TileType.Plains, Infinity);
      expect(plan.waves?.length ?? 0).toBeGreaterThan(0);
      expect(waveViolations(plan.waves ?? [], known)).toEqual([]);
      const field = new Set(plan.enemies);
      expect(plan.waves!.flatMap((w) => w.templateIds).every((id) => known.has(id))).toBe(true);
      expect(field.size).toBeGreaterThan(0);
    }
  });

  it('field no elite in the home ring, where the first elite is not due', () => {
    const tier = (id: string) => enemyTemplates.find((t) => t.id === id)?.tier;
    for (let i = 0; i < 40; i++) {
      const plan = planForEncounter(CHEST_GUARD_ID, chestGuardBand(0), TileType.Plains, Infinity);
      const bodies = [...plan.enemies, ...(plan.waves ?? []).flatMap((w) => w.templateIds)];
      expect(bodies.filter((id) => tier(id) === 'elite')).toEqual([]);
    }
  });

  it('are not a random fight: an ordinary encounter on the same ground has no chest waves', () => {
    const plan = planForEncounter('random_danger', 2, TileType.Plains, Infinity);
    expect((plan.waves ?? []).filter((w) => w.id.startsWith('chest_'))).toEqual([]);
  });
});
