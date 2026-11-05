import { HexCoord, getNeighbors, hexKey } from '@/utils/hexUtils';
import { LocationTile } from './types';

/**
 * Wall a layout in.
 *
 * Every hex touching a floor tile that is not itself a tile becomes solid
 * ground the party cannot walk on. Without it a place is a raft of hexes over
 * the void — which is most of why a lair read as "a few brown tiles and
 * nothing else" — and it also removes the class of bug where the party walks off
 * the authored map into a hole that only looks like more floor.
 *
 * `city.ts` and `castle.ts` each hand-rolled this as `dist === RADIUS`, which
 * only describes a *circular* layout. A lair is a corridor, so the same idea had
 * to be expressed as "the boundary of whatever shape this is".
 *
 * Costs nothing to draw: `HexGridMesh` groups instances by `tileType`, so a
 * stone wall joins the stone group already on screen.
 *
 * **The city and the castle deliberately do not use this.** Both are radius-4
 * discs whose outermost ring *is* the wall, checked with `dist === RADIUS`.
 * That is a correct description of a circular layout, and switching them to this
 * would add a ring *outside* the existing one — growing the city by a hex all
 * round and widening the frame the scene just finished tightening. This exists
 * for the shapes a radius check cannot describe, which is every lair.
 */
export function encloseTiles(
  tiles: LocationTile[],
  wall: Omit<LocationTile, 'coord'>,
): LocationTile[] {
  const occupied = new Set(tiles.map((t) => hexKey(t.coord)));
  const added = new Map<string, HexCoord>();

  for (const tile of tiles) {
    for (const n of getNeighbors(tile.coord)) {
      const key = hexKey(n);
      if (occupied.has(key) || added.has(key)) continue;
      added.set(key, n);
    }
  }

  return [
    ...tiles,
    ...[...added.values()].map((coord) => ({ ...wall, coord })),
  ];
}
