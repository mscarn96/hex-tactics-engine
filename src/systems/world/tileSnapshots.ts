import type { MapTile } from '@/models/types';

type Tiles = ReadonlyMap<string, MapTile>;

/**
 * Where a tiles snapshot came from: the snapshot it was copied from and the
 * tiles it replaced in the copy.
 *
 * The store never edits a tiles Map; every change is `new Map(previous)` with a
 * few `set`s, and everything that draws the map caches per snapshot. A reveal
 * replaced every one of those caches wholesale, so a step that explored seven
 * hexes recomputed the terrain round 2,000 (PT-28). Knowing which tiles changed
 * lets a cache carry its old answers forward and drop only the ones near them
 * (`worldLandforms.terrainColumns`, `fieldTargets.ts`).
 *
 * A snapshot with no record — a new map, a load — is simply not a successor:
 * the caller builds afresh, as before.
 */
const ORIGINS = new WeakMap<Tiles, { from: Tiles; changed: readonly MapTile[] }>();

/** Record that `next` is `from` with `changed` (the new tile objects) replaced. */
export function recordSnapshot(from: Tiles, next: Tiles, changed: readonly MapTile[]): void {
  ORIGINS.set(next, { from, changed });
}

/** How many recorded steps back a cache looks for an ancestor before building afresh. */
const MAX_HOPS = 16;

/**
 * The nearest recorded ancestor of `tiles` that `has` accepts, and every tile
 * changed on the way from it (the coordinates are what matter; a tile may
 * repeat). `null` when there is none within `MAX_HOPS`.
 */
export function nearestAncestor(tiles: Tiles, has: (ancestor: Tiles) => boolean): { ancestor: Tiles; changed: MapTile[] } | null {
  const changed: MapTile[] = [];
  let at = tiles;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const origin = ORIGINS.get(at);
    if (!origin) return null;
    changed.push(...origin.changed);
    if (has(origin.from)) return { ancestor: origin.from, changed };
    at = origin.from;
  }
  return null;
}

/**
 * A per-snapshot cache, carried forward: the nearest recorded ancestor's
 * entries, copied, less whatever `drop` removes for each tile changed since.
 * With no recorded ancestor holding a cache, an empty one.
 */
export function carriedCache<V>(
  caches: WeakMap<Tiles, Map<string, V>>,
  tiles: Tiles,
  drop: (cache: Map<string, V>, changed: MapTile) => void,
): Map<string, V> {
  let cache = caches.get(tiles);
  if (cache) return cache;
  const origin = nearestAncestor(tiles, (t) => caches.has(t));
  cache = new Map(origin ? caches.get(origin.ancestor) : undefined);
  if (origin) for (const changed of origin.changed) drop(cache, changed);
  caches.set(tiles, cache);
  return cache;
}
