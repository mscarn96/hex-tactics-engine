import { HexCoord, JadeGround, MapTile, TileType } from '@/models/types';
import { createRNG, valueNoise2D } from '@/utils/rng';
import { BALANCE } from '@/data/balanceConstants';
import { hexDistance } from '@/utils/hexUtils';
import type { WorldDef } from '@/data/worlds';

/**
 * The terrain of a `range` world: Jadeveil, a mountain range that rises from
 * the camp toward the summit.
 *
 * The Empire's terrain is one noise value cut into bands, so it is the same
 * country in every direction. A range is not: its ground is an **altitude** —
 * a slope from the home anchor up to the far one, plus ridged noise that
 * raises spurs and leaves valleys between them — so the climb toward the
 * summit is what the map looks like, not only what the threat bands say.
 *
 * Every tile is still an ordinary `TileType` at that type's height, so the
 * climb rules are the Empire's: highlands are the way up, a peak is entered
 * only from them, and water is the one wall. What is Jadeveil's own is the
 * ground each type is drawn as (`MapTile.jade`, `jadeGround` below).
 *
 * Draws nothing from the generator's stream. `valueNoise2D` ignores the `rng`
 * it is handed, so the field is offset by a phase taken from the seed — the
 * frozen north's trick — which is what makes two seeds two ranges.
 */

const STILL = createRNG(0);

/** The seed's offset into the noise field, so each seed is its own range. */
function phase(seed: number): [number, number] {
  const h = Math.imul(seed ^ 0x5bd1e995, 2654435761) >>> 0;
  return [h % 997, (h >>> 10) % 991];
}

/** Map-space position: the column a hex sits in, and its row. */
function column(coord: HexCoord): number {
  return coord.q + Math.floor(coord.r / 2);
}

/**
 * How far up the range a hex lies: 0 at the home anchor, 1 at the far one,
 * measured along the line between them and clamped.
 */
export function ascent(coord: HexCoord, world: WorldDef): number {
  const hx = column(world.home), hy = world.home.r;
  const fx = column(world.far), fy = world.far.r;
  const dx = fx - hx, dy = fy - hy;
  const t = ((column(coord) - hx) * dx + (coord.r - hy) * dy) / (dx * dx + dy * dy);
  return Math.min(1, Math.max(0, t));
}

/**
 * The altitude of a hex, about 0 to 1, and the moisture that decides wood
 * from moss on the lower ground.
 */
export function rangeField(coord: HexCoord, seed: number, world: WorldDef): { altitude: number; moisture: number; ridge: number } {
  const [ox, oy] = phase(seed);
  const x = column(coord) + ox;
  const y = coord.r + oy;
  // Ridged noise: 1 along the crest of a spur, 0 in the valley floor between.
  const ridge = 1 - Math.abs(2 * valueNoise2D(x, y, STILL, BALANCE.RANGE_RIDGE_SCALE) - 1);
  const detail = valueNoise2D(x + 311, y + 173, STILL, 3);
  const moisture = valueNoise2D(x + 733, y + 59, STILL, 5);
  const t = ascent(coord, world);
  const altitude = BALANCE.RANGE_SLOPE * t + BALANCE.RANGE_RIDGE * ridge + BALANCE.RANGE_DETAIL * detail;
  return { altitude, moisture, ridge };
}

/**
 * The terrain a range hex is generated as. Tarns lie only in the valley floors
 * of the lower range, where the ground is wettest; above them moss and bamboo,
 * then the terraced shoulders, then rock.
 */
export function rangeTerrain(coord: HexCoord, seed: number, world: WorldDef): TileType {
  const { altitude, moisture, ridge } = rangeField(coord, seed, world);
  const [tarn, wood, shoulder, peak] = BALANCE.RANGE_ALTITUDES;
  if (altitude < tarn && ridge < 0.45 && moisture > 0.5
    && hexDistance(coord, world.home) > BALANCE.RANGE_CAMP_DRY_RADIUS) return TileType.Water;
  if (altitude >= peak) return TileType.Mountain;
  if (altitude >= shoulder) return TileType.Highlands;
  // Bamboo climbs the damp slopes under the shoulders; the open valley floors
  // are moss unless they are wettest.
  return moisture > (altitude >= wood ? 0.42 : 0.55) ? TileType.Forest : TileType.Plains;
}

/**
 * The ground a finished range tile is drawn as. Shrine ground is written by
 * the shrine pass and survives this; the crown is rock in the summit's band.
 */
export function jadeGround(tile: MapTile): JadeGround | undefined {
  if (tile.jade === 'shrine') return 'shrine';
  switch (tile.type) {
    case TileType.Plains: return 'moss';
    case TileType.Forest: return 'bamboo';
    case TileType.Highlands: return 'terrace';
    case TileType.Mountain: return (tile.threat ?? 0) >= 4 ? 'crown' : 'ridge';
    default: return undefined;
  }
}
