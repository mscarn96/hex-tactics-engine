/**
 * The balance simulator's dice.
 *
 * Every fight is replayable from one integer: the party is rolled from a
 * generator seeded with it, and the fight itself runs with `Math.random` swapped
 * for a second generator seeded from the same integer. Two streams, so a change
 * to how a party is rolled never shifts the dice the fight rolls (and the other
 * way round).
 */

export type Rng = () => number;

/** mulberry32: small, fast, and good enough for dice. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A well-mixed 32-bit hash of any number of integers, for deriving seeds. */
export function mixSeed(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** The seed of fight `index` in a run: stable, and spread so neighbours are unrelated. */
export function fightSeed(baseSeed: number, encounterIndex: number, index: number): number {
  return mixSeed(baseSeed, encounterIndex, index);
}

/** The stream the party is rolled from, and the one the fight rolls its dice from. */
export const partyRng = (seed: number): Rng => makeRng(mixSeed(seed, 1));
export const fightRng = (seed: number): Rng => makeRng(mixSeed(seed, 2));

/** Runs `fn` with `Math.random` replaced by `rng`, restoring it even on a throw. */
export function withSeededRandom<T>(rng: Rng, fn: () => T): T {
  const original = Math.random;
  Math.random = rng;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

export const randInt = (rng: Rng, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

/** A shuffled copy (Fisher–Yates). */
export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
