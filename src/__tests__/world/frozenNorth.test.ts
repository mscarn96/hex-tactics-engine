import { MapTile, POIType, TileType } from '@/models/types';
import { generateMap, movementCost } from '@/systems/world/mapGenerator';
import { BALANCE } from '@/data/balanceConstants';
import { getNeighbors, hexDistance, hexKey } from '@/utils/hexUtils';

/**
 * The frozen north: a latitude rule in `generateMap` that turns the level
 * ground of the north-east into `TileType.Tundra` and marks every tile there
 * `frost`, so its peaks are drawn snow-capped.
 *
 * Measured on every seed the zones, highlands, waysides and scenery suites
 * use, because the region is generated against the same invariants they pin
 * and has to keep all of them on all of their maps.
 */

const SEEDS = [1, 7, 42, 99, 1234, 4242, 90210, 777, 31337, 1471934286];

const MAPS = SEEDS.map((seed) => {
  const tiles = generateMap(seed);
  const byKey = new Map(tiles.map((t) => [hexKey(t.coord), t] as const));
  const city = tiles.find((t) => t.poi === POIType.City)!.coord;
  const castle = tiles.find((t) => t.poi === POIType.EmpireCastle)!.coord;
  return { seed, tiles, byKey, city, castle, frost: tiles.filter((t) => t.frost) };
});

/** The map column of a tile: rows are offset by r/2 in axial space. */
const column = (t: MapTile) => t.coord.q + Math.floor(t.coord.r / 2);

describe('the region', () => {
  it('is one connected region on every seed', () => {
    const split: string[] = [];
    for (const { seed, frost, byKey } of MAPS) {
      const seen = new Set<string>([hexKey(frost[0].coord)]);
      const queue = [frost[0]];
      for (let head = 0; head < queue.length; head++) {
        for (const n of getNeighbors(queue[head].coord)) {
          const t = byKey.get(hexKey(n));
          if (!t?.frost || seen.has(hexKey(n))) continue;
          seen.add(hexKey(n));
          queue.push(t);
        }
      }
      if (seen.size !== frost.length) split.push(`${seed}: ${seen.size} of ${frost.length}`);
    }
    expect(split).toEqual([]);
  });

  /**
   * North-east of the city and nowhere near the castle's corner: the far end of
   * the map from the city that is not the Legion's. Asked of every tile rather
   * than of a centroid, because a centroid in the right place is satisfied by
   * a region that also spills south past the city.
   */
  it('lies wholly north of the city, and leans east', () => {
    for (const { frost, city, byKey } of MAPS) {
      const cityTile = byKey.get(hexKey(city))!;
      expect(frost.filter((t) => t.coord.r >= city.r)).toEqual([]);
      const east = frost.filter((t) => column(t) > column(cityTile)).length;
      expect(east / frost.length).toBeGreaterThan(0.75);
    }
  });

  it('is a real region and not the whole north', () => {
    for (const { tiles, frost } of MAPS) {
      expect(frost.length / tiles.length).toBeGreaterThan(0.08);
      expect(frost.length / tiles.length).toBeLessThan(0.22);
    }
  });

  /**
   * Late ground. The threat bands are unchanged — distance from the city does
   * this on its own — and the region must never reach the ring a new party
   * learns the game in.
   */
  it('never reaches the home bands or the city clearing', () => {
    for (const { frost, city } of MAPS) {
      expect(frost.filter((t) => (t.threat ?? 0) < 2)).toEqual([]);
      expect(Math.min(...frost.map((t) => hexDistance(t.coord, city)))).toBeGreaterThan(BALANCE.HOME_HAUNTED_RADIUS);
    }
  });

  it('leaves the castle outside it', () => {
    for (const { castle, byKey } of MAPS) expect(byKey.get(hexKey(castle))!.frost).toBeFalsy();
  });
});

describe('what the cold does to the ground', () => {
  /** Level ground freezes; water stays water and rock stays rock under `frost`. */
  it('turns all level ground in the region to Tundra and grows Tundra nowhere else', () => {
    const wrong: string[] = [];
    for (const { seed, tiles } of MAPS) {
      for (const t of tiles) {
        const level = t.type !== TileType.Water && t.type !== TileType.Highlands && t.type !== TileType.Mountain;
        if (t.frost && level && t.type !== TileType.Tundra) wrong.push(`${seed}: frozen ${t.type}`);
        if (!t.frost && t.type === TileType.Tundra) wrong.push(`${seed}: thawed tundra`);
      }
    }
    expect([...new Set(wrong)]).toEqual([]);
  });

  it('keeps snow-capped peaks in the region on most seeds', () => {
    const withPeaks = MAPS.filter(({ frost }) => frost.some((t) => t.type === TileType.Mountain));
    expect(withPeaks.length).toBeGreaterThanOrEqual(MAPS.length * 0.8);
  });

  /**
   * Tundra is level ground: the highlands are a legal step up from it and a
   * peak is not — the window `MAX_CLIMB` holds every other level terrain to.
   */
  it('sits in the climb window: highlands reachable, peaks not', () => {
    const steps: string[] = [];
    for (const { tiles, byKey } of MAPS) {
      for (const t of tiles) {
        if (t.type !== TileType.Tundra) continue;
        for (const n of getNeighbors(t.coord)) {
          const o = byKey.get(hexKey(n));
          if (!o) continue;
          const legal = movementCost(t, o) !== null;
          if (o.type === TileType.Highlands && !legal) steps.push('tundra→highlands refused');
          if (o.type === TileType.Mountain && legal) steps.push('tundra→mountain allowed');
        }
      }
    }
    expect([...new Set(steps)]).toEqual([]);
  });

  it('leaves nothing green behind a road or a clearing cut through it', () => {
    for (const { seed, tiles } of MAPS) {
      const thawed = tiles.filter((t) => t.frost && t.type === TileType.Plains);
      expect({ seed, thawed: thawed.length }).toEqual({ seed, thawed: 0 });
    }
  });
});
