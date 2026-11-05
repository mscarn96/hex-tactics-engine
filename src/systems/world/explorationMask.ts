import type { HexCoord } from '@/utils/hexUtils';
import { getNeighbors, HEX_SIZE, hexKey, hexToPixel, pixelToHex } from '@/utils/hexUtils';

/** Only discovery and coordinates enter concealment; hidden gameplay data cannot enter the mask. */
export interface ExplorationCell { coord: HexCoord; explored: boolean }
export interface WorldPoint { x: number; z: number }
export interface ExplorationEdge {
  knownKey: string;
  outsideKey: string;
  /** A finite-map edge is not an exploration frontier. */
  kind: 'frontier' | 'world-edge';
  a: WorldPoint;
  b: WorldPoint;
}
export interface ExplorationSample {
  onMap: boolean;
  known: boolean;
  /** Distance to the union outline in world units: negative inside, positive outside. */
  signedDistance: number;
}
export interface ExplorationMarker {
  kind: 'castle' | 'quest';
  coord: HexCoord;
  /** Marker visibility never changes ground membership or its frontier distances. */
  groundKnown: boolean;
}
/** Cloud clearance needs three exact rings. Four means four or more, never an exact far distance. */
export const EXPLORATION_DISTANCE_LIMIT = 4;

export interface ExplorationMask {
  /** Numeric axial order, independent of map insertion order, camera, party and hidden tile fields. */
  knownKeys: readonly string[];
  /** Only exposed edges of the union: internal shared edges are absent, holes/islands are retained. */
  boundary: readonly ExplorationEdge[];
  isKnown(coord: HexCoord): boolean;
  /** 0 for known, 1..3 for the fringe, 4 for deep unknown; null outside the finite map. */
  distanceInHexes(coord: HexCoord): number | null;
  /** Exact CPU query against the union outline, for mask preparation/review, not a per-frame loop. */
  sample(x: number, z: number): ExplorationSample;
  /** The caller must supply an already-authorised castle/quest address, never a hidden POI scan. */
  marker(kind: ExplorationMarker['kind'], coord: HexCoord): ExplorationMarker | null;
}

function segmentDistanceSquared(p: WorldPoint, a: WorldPoint, b: WorldPoint): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return (p.x - a.x - t * dx) ** 2 + (p.z - a.z - t * dz) ** 2;
}

/**
 * Snapshot of the full permanent discovered union. No view/window arguments exist.
 *
 * Outline edges are perpendicular bisectors between known and non-known hexes,
 * in the same pointy-top world basis as ground/picking, in fixed neighbour order.
 * Distances propagate through axial space, including
 * gaps in the finite map: missing cells must not turn into discovery barriers.
 * Construction is bounded by the map plus three exact fringe rings, and never reads or
 * writes encounter, site, resource, terrain, route or save data.
 */
export function buildExplorationMask(cells: ReadonlyMap<string, ExplorationCell>): ExplorationMask {
  const domain = new Set<string>();
  const knownCoords: HexCoord[] = [];
  for (const cell of cells.values()) {
    domain.add(hexKey(cell.coord));
    if (cell.explored) knownCoords.push({ q: cell.coord.q, r: cell.coord.r });
  }
  knownCoords.sort((a, b) => a.q - b.q || a.r - b.r);
  const knownKeys = Object.freeze(knownCoords.map(hexKey));
  const known = new Set(knownKeys);
  const boundary: ExplorationEdge[] = [];
  for (const coord of knownCoords) {
    const here = hexToPixel(coord);
    for (const neighbor of getNeighbors(coord)) {
      const outsideKey = hexKey(neighbor);
      if (known.has(outsideKey)) continue;
      const there = hexToPixel(neighbor);
      const mx = (here.x + there.x) / 2, mz = (here.y + there.y) / 2;
      const dx = there.x - here.x, dz = there.y - here.y;
      const scale = HEX_SIZE / (2 * Math.hypot(dx, dz));
      boundary.push(Object.freeze({
        knownKey: hexKey(coord), outsideKey,
        kind: domain.has(outsideKey) ? 'frontier' : 'world-edge',
        a: Object.freeze({ x: mx - dz * scale, z: mz + dx * scale }),
        b: Object.freeze({ x: mx + dz * scale, z: mz - dx * scale }),
      }));
    }
  }
  Object.freeze(boundary);

  const distances = new Map(knownKeys.map((key) => [key, 0]));
  let wave = knownCoords;
  // Four-or-more is the default, so only the three exact fringe rings are stored.
  for (let distance = 1; distance < EXPLORATION_DISTANCE_LIMIT; distance++) {
    const next: HexCoord[] = [];
    for (const coord of wave) for (const neighbor of getNeighbors(coord)) {
      const key = hexKey(neighbor);
      if (distances.has(key)) continue;
      distances.set(key, distance);
      next.push(neighbor);
    }
    wave = next;
  }

  const isKnown = (coord: HexCoord) => known.has(hexKey(coord));
  return Object.freeze({
    knownKeys, boundary, isKnown,
    distanceInHexes(coord: HexCoord) {
      const key = hexKey(coord);
      return domain.has(key) ? distances.get(key) ?? EXPLORATION_DISTANCE_LIMIT : null;
    },
    sample(x: number, z: number) {
      const coord = pixelToHex(x, z);
      const point = { x, z };
      let squared = Infinity;
      for (const edge of boundary) squared = Math.min(squared, segmentDistanceSquared(point, edge.a, edge.b));
      const distance = Math.sqrt(squared);
      const known = isKnown(coord);
      // A zero distance belongs to the outline whichever side cube rounding picks.
      return {
        onMap: domain.has(hexKey(coord)), known,
        signedDistance: distance === 0 ? 0 : known ? -distance : distance,
      };
    },
    marker(kind: ExplorationMarker['kind'], coord: HexCoord) {
      return domain.has(hexKey(coord)) ? { kind, coord: { q: coord.q, r: coord.r }, groundKnown: isKnown(coord) } : null;
    },
  });
}

/**
 * The same mask, built only when something asks for the union as a whole.
 *
 * A revealing step makes a new snapshot, and the scenery asks it only
 * `isKnown` and `marker` — per hex, through the cell the snapshot keys at that
 * hex — while the outline and the rings are for the review tooling. Building
 * them for every step was a full pass with a sort and a flood over the known
 * union, per step (PT-28). A cell stored under another hex's key falls back to
 * the full build, so the answers are always the built mask's.
 */
function lazyExplorationMask(cells: ReadonlyMap<string, ExplorationCell>): ExplorationMask {
  let built: ExplorationMask | null = null;
  const full = () => (built ??= buildExplorationMask(cells));
  /** The cell at a hex when the snapshot keys it there, which the store always does. */
  const cellAt = (coord: HexCoord) => {
    const cell = cells.get(hexKey(coord));
    return cell && cell.coord.q === coord.q && cell.coord.r === coord.r ? cell : undefined;
  };
  return Object.freeze({
    get knownKeys() { return full().knownKeys; },
    get boundary() { return full().boundary; },
    isKnown(coord: HexCoord) {
      const cell = cellAt(coord);
      return cell ? cell.explored : full().isKnown(coord);
    },
    distanceInHexes: (coord: HexCoord) => full().distanceInHexes(coord),
    sample: (x: number, z: number) => full().sample(x, z),
    marker(kind: ExplorationMarker['kind'], coord: HexCoord) {
      const cell = cellAt(coord);
      return cell ? { kind, coord: { q: coord.q, r: coord.r }, groundKnown: cell.explored } : full().marker(kind, coord);
    },
  });
}

// Store tile Maps are immutable snapshots. All rendering consumers share one
// construction per snapshot; a camera/window change does no discovery work.
const MASKS = new WeakMap<ReadonlyMap<string, ExplorationCell>, ExplorationMask>();
export function explorationMaskFor(cells: ReadonlyMap<string, ExplorationCell>): ExplorationMask {
  let mask = MASKS.get(cells);
  if (!mask) { mask = lazyExplorationMask(cells); MASKS.set(cells, mask); }
  return mask;
}
