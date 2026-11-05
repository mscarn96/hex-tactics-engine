// Simple seeded PRNG (mulberry32)
export function createRNG(seed: number) {
  let s = seed | 0;
  return {
    next(): number {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    nextInt(min: number, max: number): number {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
    pick<T>(arr: T[]): T {
      return arr[Math.floor(this.next() * arr.length)];
    },
  };
}

// Simple 2D value noise
export function valueNoise2D(
  x: number,
  y: number,
  rng: ReturnType<typeof createRNG>,
  scale: number = 8
): number {
  const sx = x / scale;
  const sy = y / scale;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const fx = sx - ix;
  const fy = sy - iy;

  // Hash-based corner values
  const hash = (a: number, b: number) => {
    let h = ((a * 374761393 + b * 668265263 + 1013904223) & 0x7fffffff);
    h = ((h ^ (h >> 13)) * 1274126177) & 0x7fffffff;
    return (h & 0x7fffffff) / 0x7fffffff;
  };

  const v00 = hash(ix, iy);
  const v10 = hash(ix + 1, iy);
  const v01 = hash(ix, iy + 1);
  const v11 = hash(ix + 1, iy + 1);

  const smooth = (t: number) => t * t * (3 - 2 * t);
  const sfx = smooth(fx);
  const sfy = smooth(fy);

  const top = v00 + (v10 - v00) * sfx;
  const bot = v01 + (v11 - v01) * sfx;
  return top + (bot - top) * sfy;
}
