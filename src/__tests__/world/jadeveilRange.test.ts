import { generateMap, movementCost, reachableFromCity } from '@/systems/world/mapGenerator';
import { ascent } from '@/systems/world/rangeTerrain';
import { EMPIRE_WORLD, JADEVEIL_WORLD, worldSeed } from '@/data/worlds';
import { getNeighbors, hexKey } from '@/utils/hexUtils';
import { MapTile, POIType, TileType } from '@/models/types';

/**
 * Jadeveil Range is a generated mountain world: smaller than the Empire, a
 * climb from the camp to the summit through four shrines, with five bands
 * spread evenly and leaning toward the summit. These pin the rules, not the
 * tuning — the shares and windows are wide enough to retune inside.
 */
const world = JADEVEIL_WORLD;
const SEEDS = [1, 7, 42, 99, 1234, 4242, 90210, 1471934286];

function build(seed: number) {
  const tiles = generateMap(worldSeed(seed, world.id), world);
  const map = new Map(tiles.map((t) => [hexKey(t.coord), t] as const));
  return { tiles, map };
}

const maps = SEEDS.map((seed) => ({ seed, ...build(seed) }));

describe('Jadeveil Range', () => {
  // 35–40 since the playtest of 2026-10-23 cut the strip behind the camp, which
  // now stands in the south-west corner with no ground behind it
  it('is measured smaller than the Empire, 35–40 hexes a side', () => {
    for (const side of [world.width, world.height]) {
      expect(side).toBeGreaterThanOrEqual(35);
      expect(side).toBeLessThanOrEqual(40);
    }
    expect(world.width * world.height).toBeLessThan(0.45 * EMPIRE_WORLD.width * EMPIRE_WORLD.height);
  });

  it('puts the camp in the south-west corner, with no ground behind it', () => {
    for (const { tiles } of maps) {
      const home = tiles.find((t) => t.poi === POIType.WorldGate)!;
      const col = (t: { coord: { q: number; r: number } }) => t.coord.q + Math.floor(t.coord.r / 2);
      expect(col(home)).toBe(Math.min(...tiles.map(col)));
      expect(home.coord.r).toBe(Math.max(...tiles.map((t) => t.coord.r)));
    }
  });

  it('generates the same range from the same seed, and another from another', () => {
    expect(JSON.stringify(build(42).tiles)).toBe(JSON.stringify(maps.find((m) => m.seed === 42)!.tiles));
    expect(JSON.stringify(build(43).tiles)).not.toBe(JSON.stringify(build(42).tiles));
  });

  it('walks from the camp to every shrine, well and the summit, on every seed', () => {
    for (const { tiles, map } of maps) {
      const reach = reachableFromCity(world.home, map);
      const land = tiles.filter((t) => t.type !== TileType.Water);
      expect(land.every((t) => reach.has(hexKey(t.coord)))).toBe(true);

      expect(map.get(hexKey(world.home))!.poi).toBe(POIType.WorldGate);
      const summit = map.get(hexKey(world.far))!;
      expect(summit.poi).toBe(POIType.Summit);
      expect(summit.threat).toBe(4);
      expect(summit.explored).toBe(true);

      for (const well of tiles.filter((t) => t.poi === POIType.MagicWell)) {
        expect(reach.has(hexKey(well.coord))).toBe(true);
      }
    }
  });

  it('climbs through one shrine per band, each reachable without a harder band', () => {
    for (const { tiles, map } of maps) {
      const shrines = tiles.filter((t) => t.poi === POIType.Shrine).sort((a, b) => a.shrine! - b.shrine!);
      expect(shrines.map((s) => s.shrine)).toEqual([1, 2, 3, 4]);
      for (const shrine of shrines) {
        expect(shrine.threat).toBe(shrine.shrine);
        expect(shrine.explored).toBe(true);
        expect(shrine.jade).toBe('shrine');
        expect(reachableFromCity(world.home, map, shrine.threat).has(hexKey(shrine.coord))).toBe(true);
      }
      // Each stands further up the range than the last.
      const rise = shrines.map((s) => ascent(s.coord, world));
      for (let i = 1; i < rise.length; i++) expect(rise[i]).toBeGreaterThan(rise[i - 1]);
    }
  });

  it('spreads its five bands evenly and leans them toward the summit', () => {
    const counts = [0, 0, 0, 0, 0];
    let low = 0, lowN = 0, high = 0, highN = 0;
    for (const { tiles } of maps) {
      for (const t of tiles) {
        counts[t.threat!]++;
        const up = ascent(t.coord, world);
        if (up < 0.3) { low += t.threat!; lowN++; }
        if (up > 0.7) { high += t.threat!; highN++; }
      }
    }
    const total = counts.reduce((a, b) => a + b, 0);
    for (const c of counts) {
      expect(c / total).toBeGreaterThan(0.12);
      expect(c / total).toBeLessThan(0.3);
    }
    expect(high / highN - low / lowN).toBeGreaterThan(2);
  });

  it('is a range: its own ground, peaks below the summit band, and no Empire lowland', () => {
    for (const { tiles } of maps) {
      for (const t of tiles) {
        expect([TileType.Desert, TileType.Swamp, TileType.Tundra]).not.toContain(t.type);
        if (t.type === TileType.Water) expect(t.jade).toBeUndefined();
        else expect(t.jade).toBeDefined();
      }
      const peaks = tiles.filter((t) => t.type === TileType.Mountain);
      expect(peaks.length / tiles.length).toBeGreaterThan(0.06);
      expect(peaks.some((t) => (t.threat ?? 0) <= 3)).toBe(true);
      // The crown is the summit band's rock and only that.
      for (const t of tiles.filter((x) => x.jade === 'crown' || x.jade === 'ridge')) {
        expect(t.type).toBe(TileType.Mountain);
        expect(t.jade === 'crown').toBe(t.threat === 4);
      }
    }
  });

  it('cuts a road that climbs rather than levels, and every step of it is legal', () => {
    for (const { tiles, map } of maps) {
      const road = tiles.filter((t) => t.zone === 'road');
      expect(road.some((t) => t.type === TileType.Highlands)).toBe(true);
      for (const t of road) {
        expect(t.type).not.toBe(TileType.Mountain);
        expect(t.type).not.toBe(TileType.Water);
      }
      // The pilgrim road joins the camp to the summit through every shrine.
      const onRoad = (t: MapTile | undefined) => !!t && t.zone === 'road';
      const seen = new Set([hexKey(world.home)]);
      const queue = [map.get(hexKey(world.home))!];
      for (let i = 0; i < queue.length; i++) {
        for (const n of getNeighbors(queue[i].coord)) {
          const next = map.get(hexKey(n));
          if (!onRoad(next) || seen.has(hexKey(n)) || movementCost(queue[i], next!) === null) continue;
          seen.add(hexKey(n));
          queue.push(next!);
        }
      }
      expect(seen.has(hexKey(world.far))).toBe(true);
      for (const shrine of tiles.filter((t) => t.poi === POIType.Shrine)) {
        expect(seen.has(hexKey(shrine.coord))).toBe(true);
      }
    }
  });
});
