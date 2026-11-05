import { patchNoise } from '@/data/display/groundPatches';
import { HillSpec } from '@/data/display/sceneryKits';

/**
 * The ground round the board rising into hills, as a pure function.
 *
 * Sibling to `arenaShelf`, and split from `arenaScenery` for that module's reason:
 * one answer to "how high is the ground here" goes to three readers that may not
 * disagree — the scene draws the blocks, every scenic prop stands on the top of the
 * block column under it, and the camera-reach check samples the ground where it is
 * drawn. They cannot disagree because all three read the same grid of columns.
 *
 * **Voxel land, block for block.** The ground is a field of square columns a block
 * wide and a whole number of blocks tall, the blocks cubes — so a slope is many
 * one-block steps, each showing its grass cap and the dirt under it, the way a
 * blocky voxel hillside reads (the designer's reference, 2026-10-22). A faceted surface
 * came first and read as smooth low-poly ground under voxel props.
 *
 * **Cosmetic by construction.** The land rises only `from` hexes clear of the
 * board, never in front of its near rim, and never higher than `headroom` allows
 * at that spot, so no playable hex moves and nothing the camera shows of the board
 * is hidden. The board's own geometry arrives as a {@link HillBoard} rather than
 * being imported, because `arenaScenery` owns that arithmetic and imports this.
 *
 * Free of `three` and of React, so the shape of the land is measurable in the node
 * suites.
 */

/**
 * A block's width and height, world units: a quarter of a hex across, so a slope
 * is many small steps rather than a few tall tiers.
 */
export const HILL_CELL = 0.4;

/**
 * The ground the field covers, world units about the board's centre.
 *
 * The phones' camera reach (`FILL_REACH`) with margin. Past it nothing is drawn and
 * nothing is needed: ground beyond the furthest point the flat plane is seen at
 * lies above the frame's top edge once it is raised, so a hill out there is never
 * in shot.
 */
export const HILL_BOUNDS = { xMin: -52, xMax: 52, zMin: -32, zMax: 20 } as const;

/**
 * World y the flat plane sits at: where the surface lies wherever the land has not
 * risen, under the surround's hexes, so the hill comes up *through* the ground
 * rather than being a sheet laid on it.
 */
export const HILL_BASE = -0.12;

/**
 * The finest octave, world units either way: about a block, so the contour of every
 * step wiggles from block to block instead of running as a smooth ring.
 */
const GRAIN = 0.75;

/** How far the slope's foot wanders either side of `from`, world units. */
const FOOT_WANDER = 1.6;
/** How far behind a backed piece's centre its spur starts to climb: clear of a fall's pool. */
const SPUR_FOOT = 0.8;
/** How far past the board's near rim the hills ease out to nothing, world units. */
const FRONT_FADE = 7;
/** World units per hex row, to turn `from` into a distance. */
const HEX_ROW = 1.6;
/**
 * A cave's walls run down the flanks in front of the board's near rim, but not
 * over the strip the opening view looks across: they start this far outside the
 * board's own width, world units, and come to full height over `FLANK_EASE`.
 */
const FLANK_PAD = 1.2;
const FLANK_EASE = 2.4;
/** Past the top of the climb the land keeps rising, gently, by this share per run. */
const CLIMB_ON = 0.18;
/** And never past this share of its height, however far out. */
const CLIMB_MAX = 1.3;

/** The board's geometry, as `arenaScenery` measures it. */
export interface HillBoard {
  /** Distance from a point to the nearest playable hex's circle, world units. */
  clearance(x: number, z: number): number;
  /** How tall anything may stand at a point without hiding playable ground. */
  headroom(x: number, z: number): number;
  /** World z of the board's near rim. */
  nearZ: number;
  /** The board's extent in world x, least and greatest hex centre; a cave's flanks stand outside it. */
  spanX?: [number, number];
  /** Whether a point is on the board's own level, where a hill may rise; everywhere when absent. */
  level?: (x: number, z: number) => boolean;
  /** Whether the camera can reach a point; ground it cannot is never built. Everywhere when absent. */
  seen?: (x: number, z: number) => boolean;
}

/** A disc that keeps its own level ground: water, a composed group, an anchor. */
export interface HillKeep {
  x: number;
  z: number;
  r: number;
  /** World units it blends back into the slope over. */
  blend: number;
  /**
   * Whether a backed spur is held off it too. Water is: a spur behind a waterfall
   * may not rise over the stream leaving its pool. A landmark is not — the spur
   * behind it is the point.
   */
  firm?: boolean;
}

/** A placed piece the land climbs up behind (`HillBack`), where it stands. */
export interface HillBacked {
  x: number;
  z: number;
  /** Unit vector straight away from the board. */
  dx: number;
  dz: number;
  height: number;
  reach: number;
  width: number;
}

export interface HillField {
  spec: HillSpec;
  seed: number;
  /** World position of column (0, 0)'s corner; column (i, k) spans one `HILL_CELL` from there. */
  x0: number;
  z0: number;
  /** Columns per row and per column. */
  nx: number;
  nz: number;
  /** Each column's top, world units above the board's level, row-major (`k * nx + i`); 0 is flat. */
  heights: Float32Array;
}

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** How far off a sector's centre a bearing is, folded to [0, π]. */
function bearingOffset(bearing: number, centre: number): number {
  let off = Math.abs(bearing - centre) % (Math.PI * 2);
  if (off > Math.PI) off = Math.PI * 2 - off;
  return off;
}

/** How much of a rise's height reaches a bearing: 1 across its core, easing out to 0. */
function sectorWeight(sweep: number, centre: number, bearing: number): number {
  const half = sweep / 2;
  const off = bearingOffset(bearing, centre);
  if (off >= half) return 0;
  const core = half * 0.66;
  return off <= core ? 1 : smooth((half - off) / (half - core));
}

/**
 * Knolls and saddles: three octaves of the ground's own patch noise, 0 to 1.
 *
 * Coarse first, about a dozen units to a hill, so the high ground breaks into
 * separate rounded tops with lower ground between them rather than one even bank.
 */
function knolls(x: number, z: number, seed: number): number {
  return 0.56 * patchNoise(x * 0.075, z * 0.075, seed + 311)
    + 0.3 * patchNoise(x * 0.16, z * 0.16, seed + 313)
    + 0.14 * patchNoise(x * 0.34, z * 0.34, seed + 317);
}

/** The land's height above the plane at a point. */
export function rawHillHeight(
  spec: HillSpec, seed: number, board: HillBoard, keep: readonly HillKeep[], x: number, z: number,
  backed: readonly HillBacked[] = [],
): number {
  if (board.level && !board.level(x, z)) return 0;
  const bearing = Math.atan2(z, x);
  const wander = (patchNoise(x * 0.09, z * 0.09, seed + 307) - 0.5) * 2 * FOOT_WANDER;
  const clear = board.clearance(x, z);
  let h = 0;
  for (const rise of spec.rises) {
    const w = sectorWeight(rise.sweep, rise.bearing, bearing);
    if (w <= 0) continue;
    const t = (clear - (rise.from ?? spec.from) * HEX_ROW - wander) / (rise.run ?? spec.run);
    if (t <= 0) continue;
    const climb = t < 1 ? smooth(t) : Math.min(CLIMB_MAX, 1 + (t - 1) * CLIMB_ON);
    h = Math.max(h, rise.height * w * climb);
  }
  h *= 1 - spec.relief + spec.relief * 2 * knolls(x, z, seed);
  if (h > 0) {
    // Two fine octaves, a few blocks and about a block across, so no contour runs straight.
    // A terrace's contour is a tread edge someone laid, so its wiggle is the coarse octave's
    // alone: the block-scale one would leave single-block notches all along every riser.
    const fine = spec.terrace ? 0 : 1;
    h += ((patchNoise(x * 0.33, z * 0.33, seed + 319) - 0.5) * 2 * GRAIN
      + fine * (patchNoise(x * 0.9, z * 0.9, seed + 323) - 0.5) * GRAIN) * Math.min(1, h);
  }
  const kept = (firm: boolean) => {
    for (const k of keep) {
      if (h <= 0) return;
      if ((k.firm ?? false) !== firm) continue;
      const d = Math.hypot(x - k.x, z - k.z);
      if (d < k.r + k.blend) h *= smooth((d - k.r) / k.blend);
    }
  };
  kept(false);
  for (const b of backed) h = Math.max(h, backing(b, x, z));
  kept(true);
  // Nothing rises in front of the board, spurs included: the ground the opening
  // view looks over. A block short of the rim, so no column corner reaches past it.
  if (z > board.nearZ - 1 - FRONT_FADE) {
    let front = smooth((board.nearZ - 1 - z) / FRONT_FADE);
    // A cave's walls run on down both flanks, outside the board's own width: the
    // floor is enclosed to the frame's lower corners. `headroom` still caps them.
    if (spec.cave && board.spanX) {
      const out = Math.max(board.spanX[0] - x, x - board.spanX[1]);
      front = Math.max(front, smooth((out - FLANK_PAD) / FLANK_EASE));
    }
    h *= front;
  }
  if (h <= 0) return 0;
  return Math.max(0, Math.min(h, board.headroom(x, z)));
}

/**
 * The spur of land behind one backed piece: nothing in front of it, its full height
 * from just behind its back across `width`, held for `reach` and easing out over as
 * much again, so it runs into the slope rather than ending in a step.
 */
function backing(b: HillBacked, x: number, z: number): number {
  const rx = x - b.x;
  const rz = z - b.z;
  const along = rx * b.dx + rz * b.dz;
  if (along < SPUR_FOOT || along > b.reach * 2 + 1) return 0;
  const across = Math.abs(rx * b.dz - rz * b.dx);
  if (across >= b.width) return 0;
  const rise = smooth((along - SPUR_FOOT) / 1.0);
  const fade = along <= b.reach ? 1 : smooth(1 - (along - b.reach) / (b.reach + 1));
  const side = across <= b.width * 0.5 ? 1 : smooth((b.width - across) / (b.width * 0.5));
  return b.height * rise * fade * side;
}

/** The whole field: every column's height, a whole number of blocks. */
export function buildHillField(
  spec: HillSpec, seed: number, board: HillBoard, keep: readonly HillKeep[],
  backed: readonly HillBacked[] = [],
): HillField {
  const nx = Math.round((HILL_BOUNDS.xMax - HILL_BOUNDS.xMin) / HILL_CELL);
  const nz = Math.round((HILL_BOUNDS.zMax - HILL_BOUNDS.zMin) / HILL_CELL);
  const x0 = HILL_BOUNDS.xMin;
  const z0 = HILL_BOUNDS.zMin;
  const heights = new Float32Array(nx * nz);
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * HILL_CELL;
      const z = z0 + (k + 0.5) * HILL_CELL;
      if (board.seen && !board.seen(x, z)) continue;
      // Floored, so a column never stands above the land it samples — and so never
      // above `headroom` either.
      const h = Math.min(rawHillHeight(spec, seed, board, keep, x, z, backed), spec.cave?.ceiling ?? Infinity);
      // A terraced slope is floored to whole treads (`TerraceSpec.step`), so it stands in level shelves.
      const unit = spec.terrace ? Math.max(HILL_CELL, Math.round(spec.terrace.step / HILL_CELL) * HILL_CELL) : HILL_CELL;
      heights[k * nx + i] = Math.round(Math.floor(h / unit) * unit / HILL_CELL) * HILL_CELL;
    }
  }
  return { spec, seed, x0, z0, nx, nz, heights };
}

/** The column a world point stands in, or -1 off the field. */
export function hillColumn(field: HillField, x: number, z: number): number {
  const i = Math.floor((x - field.x0) / HILL_CELL);
  const k = Math.floor((z - field.z0) / HILL_CELL);
  if (i < 0 || k < 0 || i >= field.nx || k >= field.nz) return -1;
  return k * field.nx + i;
}

/** The top of the block column at a world point; 0 on flat ground. */
export function hillHeight(field: HillField, x: number, z: number): number {
  const c = hillColumn(field, x, z);
  return c < 0 ? 0 : field.heights[c];
}

/** The ground a prop stands on: the top of the block column under its centre. */
export function hillFloor(field: HillField, x: number, z: number): number {
  return hillHeight(field, x, z);
}
