export interface HexCoord {
  q: number;
  r: number;
}

const HEX_SIZE = 1;

const SQRT3 = Math.sqrt(3);

/**
 * Pointy-top axial → pixel at size `HEX_SIZE`. Pure arithmetic in place of a
 * `honeycomb-grid` constructor per call — this is the hot path of every party
 * step — verified bit-exact (max delta 0) against the library's own answer
 * over q,r ∈ [-40, 40]. `pixelToHex` is this basis inverted.
 */
export function hexToPixel(coord: HexCoord): { x: number; y: number } {
  return {
    x: SQRT3 * (coord.q + coord.r / 2) * HEX_SIZE,
    y: 1.5 * coord.r * HEX_SIZE,
  };
}

export function pixelToHex(x: number, y: number): HexCoord {
  // Pointy-top hex pixel-to-axial conversion
  const q = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / HEX_SIZE;
  const r = (2 / 3 * y) / HEX_SIZE;
  return hexRound(q, r);
}

/**
 * The Euclidean dot product of two axial vectors.
 *
 * **Axial coordinates are a skewed basis, so `aq*bq + ar*br` is not a dot
 * product** — and every place that wanted "which of the six directions does this
 * point most nearly along" had written exactly that. On a pointy-top grid the
 * `q` and `r` axes are 60° apart rather than 90°, which makes the naive form
 * wrong by the cross term: it reported `(0,1)·(0,1)` and `(0,1)·(-1,1)` as an
 * equal `1`, so an aim straight down one axis tied with its neighbour and the
 * tie-break sent it 60° the wrong way. Two of the six directions were affected,
 * which is how it survived — a third of aims misfired and the rest were fine.
 *
 * Derived from the basis `hexToPixel` uses and `pixelToHex` inverts:
 * `x = √3(q + r/2)`, `y = 1.5r`, expanded and kept as literals so this costs
 * four multiplies.
 *
 * Scale is irrelevant to every caller — they all compare dot products against
 * each other — but it is the true product for `HEX_SIZE = 1`, not a proportional
 * stand-in, so nothing downstream has to know.
 */
export function hexDot(a: HexCoord, b: HexCoord): number {
  return 3 * (a.q + a.r / 2) * (b.q + b.r / 2) + 2.25 * a.r * b.r;
}

function hexRound(q: number, r: number): HexCoord {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const qDiff = Math.abs(rq - q);
  const rDiff = Math.abs(rr - r);
  const sDiff = Math.abs(rs - s);
  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  }
  return { q: rq, r: rr };
}

/**
 * The six axial direction offsets in `honeycomb-grid`'s [E, NE, NW, W, SW, SE]
 * order — derived from the library's own `neighborOf` and hardcoded (verified
 * identical over every q,r ∈ [-40, 40]; the offsets carry no parity logic on
 * these six directions). Order is load-bearing: callers index into the result.
 */
const NEIGHBOR_OFFSETS: readonly HexCoord[] = [
  { q: 1, r: 0 }, // E
  { q: 1, r: -1 }, // NE
  { q: 0, r: -1 }, // NW
  { q: -1, r: 0 }, // W
  { q: -1, r: 1 }, // SW
  { q: 0, r: 1 }, // SE
];

export function getNeighbors(coord: HexCoord): HexCoord[] {
  return NEIGHBOR_OFFSETS.map((d) => ({ q: coord.q + d.q, r: coord.r + d.r }));
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  return Math.max(
    Math.abs(a.q - b.q),
    Math.abs(a.r - b.r),
    Math.abs((a.q + a.r) - (b.q + b.r))
  );
}

export function getHexesInRange(center: HexCoord, range: number): HexCoord[] {
  const results: HexCoord[] = [];
  for (let q = -range; q <= range; q++) {
    for (let r = Math.max(-range, -q - range); r <= Math.min(range, -q + range); r++) {
      results.push({ q: center.q + q, r: center.r + r });
    }
  }
  return results;
}

export function getHexLine(from: HexCoord, to: HexCoord): HexCoord[] {
  const n = hexDistance(from, to);
  if (n === 0) return [from];

  const results: HexCoord[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const q = from.q + (to.q - from.q) * t;
    const r = from.r + (to.r - from.r) * t;
    results.push(hexRound(q, r));
  }
  return results;
}

export function hexKey(coord: HexCoord): string {
  return `${coord.q},${coord.r}`;
}

export function parseHexKey(key: string): HexCoord {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

export { HEX_SIZE };
