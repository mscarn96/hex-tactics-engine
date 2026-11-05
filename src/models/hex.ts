// ============ COORDINATES ============

export interface HexCoord {
  q: number;
  r: number;
}

/**
 * One of the six hex directions, as an index into `getNeighbors`' (and
 * `HEX_DIRS`') order: E, NE, NW, W, SW, SE. Index `i + 3` is the opposite way.
 */
export type HexDirection = 0 | 1 | 2 | 3 | 4 | 5;
