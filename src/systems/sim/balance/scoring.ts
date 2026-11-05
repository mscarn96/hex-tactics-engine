import { EncounterId } from './encounters';
import { FightRecord } from './record';

/**
 * Turning a fight's facts into points (the private project notes,
 * "Scoring"). Computed when results are shown, from the stored facts and a
 * weight set, so other weights never need another fight.
 */

export interface ScoreWeights {
  /** The boss is beaten. */
  win: number;
  /** Up to this many points for a win that took fewer turns than the encounter's median win. */
  speed: number;
  /** Up to this many for boss health dealt (counts on a loss too). */
  dealt: number;
  /** Up to this many for the share of heroes alive at the end. */
  alive: number;
  /** Up to this many for the health left on the living. */
  health: number;
  /** Per castle garrison stage cleared. */
  stage: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = { win: 100, speed: 30, dealt: 30, alive: 20, health: 20, stage: 10 };

/** The turn counts a win's speed is measured against, per encounter. */
export interface SpeedRef {
  /** Median length of the winning fights. */
  median: number;
  /** Length of the fastest winning fight. */
  fastest: number;
}

export interface ScoreParts {
  win: number;
  speed: number;
  dealt: number;
  alive: number;
  health: number;
  stage: number;
  total: number;
}

/** The facts a score reads, whether from a record or from the aggregator's compact copy. */
export interface ScoreFacts {
  win: boolean;
  /** The turns the speed part measures (the record's `bt`). */
  turns: number;
  dealt: number;
  heroes: number;
  alive: number;
  /** Sum of health shares over the living. */
  livingHealth: number;
  stagesCleared: number;
}

/** Garrison stages (not Aethelred's) the party won. */
const GARRISON_STAGES = 3;

export function factsOf(record: FightRecord): ScoreFacts {
  const alive = record.h.filter((h) => h.a === 1);
  return {
    win: record.o === 'victory',
    turns: record.bt,
    dealt: record.d,
    heroes: record.h.length,
    alive: alive.length,
    livingHealth: alive.reduce((sum, h) => sum + h.hp, 0),
    stagesCleared: record.st ? record.st.filter((s) => s.n < GARRISON_STAGES && s.o === 'victory').length : 0,
  };
}

/** Share of the speed points a win of `turns` earns: 1 at the fastest win, 0 at the median or slower. */
export function speedShare(turns: number, ref: SpeedRef | undefined): number {
  if (!ref || ref.median <= ref.fastest) return 0;
  return Math.min(1, Math.max(0, (ref.median - turns) / (ref.median - ref.fastest)));
}

export function scoreFacts(f: ScoreFacts, weights: ScoreWeights, ref?: SpeedRef): ScoreParts {
  const win = f.win ? weights.win : 0;
  const speed = f.win ? weights.speed * speedShare(f.turns, ref) : 0;
  const dealt = weights.dealt * Math.min(1, Math.max(0, f.dealt));
  const alive = f.heroes > 0 ? weights.alive * (f.alive / f.heroes) : 0;
  const health = f.alive > 0 ? weights.health * (f.livingHealth / f.alive) : 0;
  const stage = weights.stage * f.stagesCleared;
  return { win, speed, dealt, alive, health, stage, total: win + speed + dealt + alive + health + stage };
}

export const scoreRecord = (record: FightRecord, weights: ScoreWeights = DEFAULT_WEIGHTS, ref?: SpeedRef): ScoreParts =>
  scoreFacts(factsOf(record), weights, ref);

/** Median and fastest winning length per encounter, from the fights that won. */
export function speedRefs(records: Iterable<FightRecord>): Partial<Record<EncounterId, SpeedRef>> {
  const wins = new Map<EncounterId, number[]>();
  for (const r of records) {
    if (r.o !== 'victory') continue;
    const list = wins.get(r.enc) ?? [];
    list.push(r.bt);
    wins.set(r.enc, list);
  }
  const out: Partial<Record<EncounterId, SpeedRef>> = {};
  for (const [enc, list] of wins) out[enc] = refOf(list);
  return out;
}

/** Median and fastest of a list of winning lengths. */
export function refOf(winTurns: number[]): SpeedRef {
  const sorted = [...winTurns].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { median, fastest: sorted[0] };
}

// ─── Intervals ────────────────────────────────────────────────────────────────

/** The 95% Wilson score interval for `wins` of `n`. */
export function wilson(wins: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** Standard error of a mean from its count, sum and sum of squares. */
export function standardError(n: number, sum: number, sumSq: number): number {
  if (n < 2) return 0;
  const variance = Math.max(0, (sumSq - (sum * sum) / n) / (n - 1));
  return Math.sqrt(variance / n);
}

// ─── Tier lists ───────────────────────────────────────────────────────────────

export type Tier = 'S' | 'A' | 'B' | 'C' | 'D';

/** Top share of the ranked rows each tier takes: S the best tenth, then 20%, 30%, 25%, and D the last 15%. */
export const TIER_CUTS: readonly [Tier, number][] = [['S', 0.1], ['A', 0.3], ['B', 0.6], ['C', 0.85], ['D', 1]];

export function tierOf(rank: number, count: number): Tier {
  const fraction = count > 0 ? rank / count : 0;
  return TIER_CUTS.find(([, upto]) => fraction < upto)![0];
}
