import { generateMap, isPassable, movementCost, MAX_CLIMB } from '@/systems/world/mapGenerator';
import { MapTile, POIType, TileType } from '@/models/types';
import { getNeighbors, hexKey } from '@/utils/hexUtils';

/**
 * Mountains are ground now.
 *
 * A sixth of the map used to be scenery: `isPassable` refused water *and*
 * mountains, while the mountains already carried a height, a relief amplitude,
 * a prop family and a combat backdrop that nothing could ever reach. What
 * replaced the refusal is a climb limit, so a peak is somewhere you ascend to
 * from a highland shoulder — which only works if the shoulders are actually
 * there, and if nothing about the elevation can trap a party.
 */

const SEEDS = [1, 4242, 90210, 777, 31337];

const ORDINARY: TileType[] = [
  TileType.Plains, TileType.Forest, TileType.Desert, TileType.Swamp,
];

/** A bare tile of a given type, at the height the generator gives that type. */
function at(type: TileType, seedTiles: MapTile[]): MapTile {
  const found = seedTiles.find((t) => t.type === type);
  if (!found) throw new Error(`no ${type} on the sample map`);
  return found;
}

describe('the climb rule', () => {
  const tiles = generateMap(4242);
  const sample = (type: TileType) => at(type, tiles);

  it('lets every ordinary ground reach the highlands', () => {
    const blocked = ORDINARY.filter(
      (t) => movementCost(sample(t), sample(TileType.Highlands)) === null,
    );
    expect(blocked).toEqual([]);
  });

  it('lets the highlands reach a peak', () => {
    expect(movementCost(sample(TileType.Highlands), sample(TileType.Mountain))).not.toBeNull();
  });

  /**
   * The rule the whole design rests on. If any of these opened up, the highlands
   * would stop being the way onto a range and become decoration beside one.
   */
  it('refuses a peak from anywhere but the highlands', () => {
    const reached = ORDINARY.filter(
      (t) => movementCost(sample(t), sample(TileType.Mountain)) !== null,
    );
    expect(reached).toEqual([]);
  });

  /**
   * Symmetry is not tidiness, it is the absence of a soft-lock. An ascent-only
   * limit lets a party walk down into a bowl it cannot climb out of, and that is
   * a save with nowhere to go.
   */
  it('is symmetric, so no step can be one-way', () => {
    const asymmetric: string[] = [];
    const kinds = Object.values(TileType).filter((t) => t !== TileType.Water);
    for (const a of kinds) {
      for (const b of kinds) {
        const there = movementCost(sample(a), sample(b)) !== null;
        const back = movementCost(sample(b), sample(a)) !== null;
        if (there !== back) asymmetric.push(`${a}->${b}`);
      }
    }
    expect(asymmetric).toEqual([]);
  });

  it('keeps water the only thing that is simply impassable', () => {
    const refused = Object.values(TileType).filter((t) => !isPassable(t));
    expect(refused).toEqual([TileType.Water]);
  });

  /**
   * The window `MAX_CLIMB` has to sit in, stated as arithmetic rather than as a
   * comment: at or below the swamp-to-highlands gap a bog walls a range off, and
   * at or above the forest-to-mountain gap a peak can be walked onto directly.
   */
  it('sits inside the window its two neighbours leave it', () => {
    const height = (t: TileType) => sample(t).height ?? 0;
    const swampToHighlands = height(TileType.Highlands) - height(TileType.Swamp);
    const forestToMountain = height(TileType.Mountain) - height(TileType.Forest);
    expect(MAX_CLIMB).toBeGreaterThanOrEqual(swampToHighlands);
    expect(MAX_CLIMB).toBeLessThan(forestToMountain);
  });
});

describe('generated ranges', () => {
  /**
   * A peak with no approach is not difficulty, it is a hole in the map that
   * still draws. The generator demotes those to highlands; this is the pin.
   */
  it('leaves no peak that cannot be stepped onto', () => {
    const stranded: string[] = [];
    for (const seed of SEEDS) {
      const tiles = generateMap(seed);
      const byKey = new Map(tiles.map((t) => [hexKey(t.coord), t]));
      for (const tile of tiles) {
        if (tile.type !== TileType.Mountain) continue;
        const open = getNeighbors(tile.coord).some((n) => {
          const other = byKey.get(hexKey(n));
          return other !== undefined && movementCost(other, tile) !== null;
        });
        if (!open) stranded.push(`${seed}:${tile.coord.q},${tile.coord.r}`);
      }
    }
    expect(stranded).toEqual([]);
  });

  it('actually produces both kinds of high ground', () => {
    const thin: string[] = [];
    for (const seed of SEEDS) {
      const tiles = generateMap(seed);
      const high = tiles.filter((t) => t.type === TileType.Highlands).length;
      const peaks = tiles.filter((t) => t.type === TileType.Mountain).length;
      if (high < 20) thin.push(`${seed}: ${high} highlands`);
      if (peaks < 20) thin.push(`${seed}: ${peaks} peaks`);
    }
    expect(thin).toEqual([]);
  });

  /**
   * Walked from the city over the real cost function.
   *
   * Not "every peak", deliberately — a range on an island across open water is
   * legitimately unreachable, and plains have always been able to strand
   * themselves the same way. What must not happen is high ground being
   * *systematically* cut off, which is what a bad climb constant looks like.
   */
  it('leaves the great majority of high ground walkable from the city', () => {
    const poor: string[] = [];
    for (const seed of SEEDS) {
      const tiles = generateMap(seed);
      const byKey = new Map(tiles.map((t) => [hexKey(t.coord), t]));
      const city = tiles.find((t) => t.poi === POIType.City)!;

      const seen = new Set<string>([hexKey(city.coord)]);
      const queue: MapTile[] = [city];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const n of getNeighbors(current.coord)) {
          const key = hexKey(n);
          if (seen.has(key)) continue;
          const next = byKey.get(key);
          if (!next || movementCost(current, next) === null) continue;
          seen.add(key);
          queue.push(next);
        }
      }

      const high = tiles.filter(
        (t) => t.type === TileType.Highlands || t.type === TileType.Mountain,
      );
      const reached = high.filter((t) => seen.has(hexKey(t.coord))).length;
      const share = reached / high.length;
      if (share < 0.85) poor.push(`${seed}: ${(share * 100).toFixed(0)}% of high ground`);
    }
    expect(poor).toEqual([]);
  });

  /**
   * The city has to open onto somewhere a level-1 party can walk in every
   * direction. Three passes rewrite terrain — the city clearing, the castle and
   * the road — and each of them used to set `type` without `height`, which cost
   * nothing while elevation was decoration and strands a tile now that it is not.
   */
  it('opens the city onto level ground in every direction', () => {
    const walled: string[] = [];
    for (const seed of SEEDS) {
      const tiles = generateMap(seed);
      const byKey = new Map(tiles.map((t) => [hexKey(t.coord), t]));
      const city = tiles.find((t) => t.poi === POIType.City)!;
      for (const n of getNeighbors(city.coord)) {
        const next = byKey.get(hexKey(n));
        if (next && movementCost(city, next) === null) {
          walled.push(`${seed}: ${next.type} at ${n.q},${n.r}`);
        }
      }
    }
    expect(walled).toEqual([]);
  });

  it('keeps the whole Obsidian road walkable end to end', () => {
    const broken: string[] = [];
    for (const seed of SEEDS) {
      const tiles = generateMap(seed);
      const byKey = new Map(tiles.map((t) => [hexKey(t.coord), t]));
      for (const tile of tiles.filter((t) => t.zone === 'road')) {
        const joined = getNeighbors(tile.coord).some((n) => {
          const other = byKey.get(hexKey(n));
          return other !== undefined && other.zone === 'road' === true && movementCost(other, tile) !== null;
        });
        if (!joined) broken.push(`${seed}: ${tile.coord.q},${tile.coord.r}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
