import { Rarity } from '@/models/types';
import { findTemplate } from '@/systems/economy/itemFactory';
import { EncounterId } from './encounters';
import { FightRecord } from './record';
import { ANSWER_KINDS, emptyAnswers, MoveAnswers } from '@/systems/combat/answerTally';
import {
  DEFAULT_WEIGHTS,
  factsOf,
  refOf,
  ScoreFacts,
  scoreFacts,
  ScoreWeights,
  SpeedRef,
  standardError,
  Tier,
  tierOf,
  wilson,
} from './scoring';

/**
 * Rolling fights up into rows and tier lists (the private project notes,
 * "Scoring" and "Results").
 *
 * The aggregator keeps a compact copy of each fight's facts and, per row, the
 * list of fights it covers. Chunks of records can be added at any time (the live
 * run screen does exactly that); `results` then scores everything from the facts
 * and the weights it is given. Nothing is cached across weight sets, so a
 * different weight set is a different answer from the same fights.
 *
 * **The adjusted score.** A random budget means a strong class could simply have
 * been rolled into strong parties. A fight's adjusted score is its score minus
 * the mean score of every fight in the same *bucket* — its encounter, its level
 * sum (width {@link LEVEL_BUCKET}) and its item budget in points
 * ({@link BUDGET_POINTS}, width {@link BUDGET_BUCKET}).
 */

export type ViewKind = 'class' | 'path' | 'capstone' | 'legendary' | 'epic' | 'compClass' | 'compPath';

/** Level sums and item budgets are grouped into buckets this wide before the expected score is taken. */
export const LEVEL_BUCKET = 4;
export const BUDGET_BUCKET = 3;
/** The item budget as one number: a legendary counts three, an epic two, a rare one. */
export const BUDGET_POINTS = { legendary: 3, epic: 2, rare: 1 } as const;

/** The rows with fewer fights than this are greyed out and left out of tier lists. */
export const DEFAULT_MIN_SAMPLE = 30;

export interface ResultFilter {
  encounter?: EncounterId;
  /** Only fights of the dodging party (true) or the plain AI party (false). */
  dodging?: boolean;
}

export interface ResultOptions extends ResultFilter {
  minSample?: number;
}

export interface Row {
  view: ViewKind;
  /** Class id, path id, capstone node id, item template id, or a '+'-joined multiset; 'none' where a hero has no path or capstone. */
  key: string;
  /** Set on the rows that are per encounter: items and comps. */
  enc?: EncounterId;
  /** Fights the row covers (a hero view counts once per hero in the party). */
  n: number;
  wins: number;
  winRate: number;
  winLo: number;
  winHi: number;
  /** Mean raw score and its standard error. */
  mean: number;
  meanSe: number;
  /** Mean adjusted score and its standard error: what rankings use. */
  adj: number;
  adjSe: number;
  /** Fewer fights than the minimum. */
  lowSample: boolean;
  /** Item rows: the same encounter's fights without the piece, and the difference. */
  without?: { n: number; winRate: number; adj: number };
  delta?: number;
}

export interface EncounterSummary {
  n: number;
  wins: number;
  winRate: number;
  winLo: number;
  winHi: number;
  mean: number;
  meanSe: number;
  /** The speed reference the encounter's winning fights were scored against. */
  speedRef?: SpeedRef;
}

/**
 * One encounter's fights at one party size: what the tactics dividend compares between the party that
 * plays the answers and the plain one (the private project notes, "The tactics dividend").
 */
export interface SizeSummary {
  n: number;
  wins: number;
  winRate: number;
  /** Mean share of the boss's health dealt (the castle: Aethelred's, 0 when he was never reached). */
  dealt: number;
  /** Mean heroes standing at the end. */
  alive: number;
  /** Mean boss turns (the castle: enemy turns over every stage fought). */
  bossTurns: number;
  /** The castle: mean garrison stages cleared, 3 for a party that reached Aethelred (0 elsewhere). */
  stages: number;
  /** How each warned move was answered in these fights, as `Results.answers`. */
  answers: Record<string, MoveAnswers>;
}

export interface TierEntry {
  key: string;
  enc?: EncounterId;
  tier: Tier;
  adj: number;
  n: number;
}

export interface Results {
  fights: number;
  weights: ScoreWeights;
  perEncounter: Partial<Record<EncounterId, EncounterSummary>>;
  /**
   * How each warned move was answered, per encounter and move, summed over the fights the filter
   * keeps (`answerTally`). The lab shows each column's share of what was owed; "one column above
   * about seventy per cent" marks a move that is still a one-choice move.
   */
  answers: Partial<Record<EncounterId, Record<string, MoveAnswers>>>;
  /** The same fights by party size: per encounter, per hero count (the rolled party's, in every record). */
  bySize: Partial<Record<EncounterId, Record<number, SizeSummary>>>;
  views: Record<ViewKind, Row[]>;
  tiers: { path: TierEntry[]; capstone: TierEntry[]; compClass: TierEntry[]; compPath: TierEntry[] };
}

interface Slim {
  enc: EncounterId;
  /** Heroes in the rolled party. */
  size: number;
  dodging: boolean;
  facts: ScoreFacts;
  bucket: string;
  answers?: Record<string, number[]>;
}

const VIEWS: readonly ViewKind[] = ['class', 'path', 'capstone', 'legendary', 'epic', 'compClass', 'compPath'];
/** Views whose rows stay separate per encounter. */
const PER_ENCOUNTER = new Set<ViewKind>(['legendary', 'epic', 'compClass', 'compPath']);

const rarityOf = new Map<string, Rarity | null>();
function templateRarity(id: string): Rarity | null {
  let r = rarityOf.get(id);
  if (r === undefined) {
    r = findTemplate(id)?.rarity ?? null;
    rarityOf.set(id, r);
  }
  return r;
}

const NONE = 'none';

/**
 * The rows a fight belongs to. A hero view lists a fight once per hero (so a party
 * of two warriors counts twice for the class), a comp or item view once.
 */
export function rowKeysOf(r: FightRecord): { view: ViewKind; key: string }[] {
  const out: { view: ViewKind; key: string }[] = [];
  const classes: string[] = [];
  const paths: string[] = [];
  for (const h of r.party.h) {
    classes.push(h.c);
    paths.push(h.p || NONE);
    out.push({ view: 'class', key: h.c }, { view: 'path', key: h.p || `${NONE}:${h.c}` }, { view: 'capstone', key: h.cap || NONE });
  }
  out.push({ view: 'compClass', key: [...classes].sort().join('+') }, { view: 'compPath', key: [...paths].sort().join('+') });
  const worn = new Set<string>();
  for (const h of r.party.h) for (const piece of Object.values(h.g)) worn.add(piece![0]);
  for (const id of worn) {
    const rarity = templateRarity(id);
    if (rarity === Rarity.Legendary) out.push({ view: 'legendary', key: id });
    else if (rarity === Rarity.Epic) out.push({ view: 'epic', key: id });
  }
  return out;
}

/** Whether a fight is one of a row's (`enc` for the per-encounter views). */
export function inRow(r: FightRecord, view: ViewKind, key: string, enc?: EncounterId): boolean {
  if (PER_ENCOUNTER.has(view) && enc !== undefined && r.enc !== enc) return false;
  return rowKeysOf(r).some((k) => k.view === view && k.key === key);
}

export class Aggregator {
  private fights: Slim[] = [];
  /** `${view}\u0001${key}` → fight indexes, one entry per appearance. */
  private index = new Map<string, number[]>();

  get size(): number {
    return this.fights.length;
  }

  add(records: Iterable<FightRecord>): void {
    for (const r of records) {
      const i = this.fights.length;
      const budgetPoints = r.party.bud[0] * BUDGET_POINTS.legendary + r.party.bud[1] * BUDGET_POINTS.epic + r.party.bud[2] * BUDGET_POINTS.rare;
      this.fights.push({
        enc: r.enc,
        size: r.party.h.length,
        dodging: r.dg === 1,
        facts: factsOf(r),
        bucket: `${r.enc}|${Math.floor(r.party.ls / LEVEL_BUCKET)}|${Math.floor(budgetPoints / BUDGET_BUCKET)}`,
        ...(r.an && { answers: r.an }),
      });

      for (const { view, key } of rowKeysOf(r)) {
        const k = `${view}\u0001${PER_ENCOUNTER.has(view) ? `${r.enc}|` : ''}${key}`;
        const list = this.index.get(k);
        if (list) list.push(i);
        else this.index.set(k, [i]);
      }
    }
  }

  results(weights: ScoreWeights = DEFAULT_WEIGHTS, options: ResultOptions = {}): Results {
    const minSample = options.minSample ?? DEFAULT_MIN_SAMPLE;
    const active = (i: number) => {
      const f = this.fights[i];
      return (options.encounter === undefined || f.enc === options.encounter)
        && (options.dodging === undefined || f.dodging === options.dodging);
    };

    // The speed reference: median and fastest winning length, per encounter
    const wins = new Map<EncounterId, number[]>();
    this.fights.forEach((f, i) => {
      if (!active(i) || !f.facts.win) return;
      const list = wins.get(f.enc) ?? [];
      list.push(f.facts.turns);
      wins.set(f.enc, list);
    });
    const refs = new Map<EncounterId, SpeedRef>([...wins].map(([enc, list]) => [enc, refOf(list)]));

    // Scores, then each bucket's mean
    const score = new Float64Array(this.fights.length);
    const bucketSum = new Map<string, { n: number; sum: number }>();
    this.fights.forEach((f, i) => {
      if (!active(i)) return;
      score[i] = scoreFacts(f.facts, weights, refs.get(f.enc)).total;
      const b = bucketSum.get(f.bucket) ?? { n: 0, sum: 0 };
      b.n++;
      b.sum += score[i];
      bucketSum.set(f.bucket, b);
    });
    const adj = new Float64Array(this.fights.length);
    this.fights.forEach((f, i) => {
      if (!active(i)) return;
      const b = bucketSum.get(f.bucket)!;
      adj[i] = score[i] - b.sum / b.n;
    });

    const stats = (indexes: number[]) => {
      let n = 0, w = 0, s = 0, s2 = 0, a = 0, a2 = 0;
      for (const i of indexes) {
        if (!active(i)) continue;
        n++;
        if (this.fights[i].facts.win) w++;
        s += score[i]; s2 += score[i] * score[i];
        a += adj[i]; a2 += adj[i] * adj[i];
      }
      const ci = wilson(w, n);
      return {
        n, wins: w, winRate: n ? w / n : 0, winLo: ci.lo, winHi: ci.hi,
        mean: n ? s / n : 0, meanSe: standardError(n, s, s2),
        adj: n ? a / n : 0, adjSe: standardError(n, a, a2),
        adjSum: a,
      };
    };

    // Per-encounter totals: the summary, and the baseline an item row is compared with
    const encIndexes = new Map<EncounterId, number[]>();
    this.fights.forEach((f, i) => {
      if (!active(i)) return;
      const list = encIndexes.get(f.enc) ?? [];
      list.push(i);
      encIndexes.set(f.enc, list);
    });
    const perEncounter: Results['perEncounter'] = {};
    const encTotals = new Map<EncounterId, ReturnType<typeof stats>>();
    for (const [enc, list] of encIndexes) {
      const st = stats(list);
      encTotals.set(enc, st);
      perEncounter[enc] = { n: st.n, wins: st.wins, winRate: st.winRate, winLo: st.winLo, winHi: st.winHi, mean: st.mean, meanSe: st.meanSe, speedRef: refs.get(enc) };
    }

    // How the warnings were answered, over the fights kept
    const answers: Results['answers'] = {};
    this.fights.forEach((f, i) => {
      if (!active(i) || !f.answers) return;
      const byMove = (answers[f.enc] ??= {});
      for (const [move, counts] of Object.entries(f.answers)) {
        const row = (byMove[move] ??= emptyAnswers());
        ANSWER_KINDS.forEach((kind, k) => { row[kind] += counts[k] ?? 0; });
      }
    });

    // The same, by party size, with the facts the dividend compares
    const bySize: Results['bySize'] = {};
    this.fights.forEach((f, i) => {
      if (!active(i)) return;
      const sizes = (bySize[f.enc] ??= {});
      const row = (sizes[f.size] ??= { n: 0, wins: 0, winRate: 0, dealt: 0, alive: 0, bossTurns: 0, stages: 0, answers: {} });
      row.n++;
      if (f.facts.win) row.wins++;
      // Sums for now, means below
      row.dealt += f.facts.dealt;
      row.alive += f.facts.alive;
      row.bossTurns += f.facts.turns;
      row.stages += f.facts.stagesCleared;
      for (const [move, counts] of Object.entries(f.answers ?? {})) {
        const tally = (row.answers[move] ??= emptyAnswers());
        ANSWER_KINDS.forEach((kind, k) => { tally[kind] += counts[k] ?? 0; });
      }
    });
    for (const sizes of Object.values(bySize)) {
      for (const row of Object.values(sizes!)) {
        row.winRate = row.wins / row.n;
        row.dealt /= row.n;
        row.alive /= row.n;
        row.bossTurns /= row.n;
        row.stages /= row.n;
      }
    }

    const views = Object.fromEntries(VIEWS.map((v) => [v, [] as Row[]])) as Record<ViewKind, Row[]>;
    for (const [k, indexes] of this.index) {
      const [view, rest] = k.split('\u0001') as [ViewKind, string];
      const st = stats(indexes);
      if (st.n === 0) continue;
      let key = rest;
      let enc: EncounterId | undefined;
      if (PER_ENCOUNTER.has(view)) {
        const cut = rest.indexOf('|');
        enc = rest.slice(0, cut) as EncounterId;
        key = rest.slice(cut + 1);
      }
      const row: Row = {
        view, key, ...(enc && { enc }),
        n: st.n, wins: st.wins, winRate: st.winRate, winLo: st.winLo, winHi: st.winHi,
        mean: st.mean, meanSe: st.meanSe, adj: st.adj, adjSe: st.adjSe,
        lowSample: st.n < minSample,
      };
      if ((view === 'legendary' || view === 'epic') && enc) {
        const total = encTotals.get(enc)!;
        const nOut = total.n - st.n;
        if (nOut > 0) {
          const winsOut = total.wins - st.wins;
          const adjOut = (total.adjSum - st.adjSum) / nOut;
          row.without = { n: nOut, winRate: winsOut / nOut, adj: adjOut };
          row.delta = st.adj - adjOut;
        }
      }
      views[view].push(row);
    }
    for (const v of VIEWS) {
      views[v].sort((a, b) => Number(a.lowSample) - Number(b.lowSample) || b.adj - a.adj || a.key.localeCompare(b.key));
    }

    const tier = (view: ViewKind): TierEntry[] => {
      const ranked = views[view].filter((r) => !r.lowSample && !isNone(r.key));
      return ranked.map((r, rank) => ({ key: r.key, ...(r.enc && { enc: r.enc }), tier: tierOf(rank, ranked.length), adj: r.adj, n: r.n }));
    };

    return {
      fights: [...encIndexes.values()].reduce((sum, l) => sum + l.length, 0),
      weights,
      perEncounter,
      answers,
      bySize,
      views,
      tiers: { path: tier('path'), capstone: tier('capstone'), compClass: tier('compClass'), compPath: tier('compPath') },
    };
  }
}

/** A row for heroes with no path or capstone, which a tier list does not rank. */
const isNone = (key: string) => key === NONE || key.startsWith(`${NONE}:`);

/** All at once: `new Aggregator()`, one `add`, one `results`. */
export function aggregate(records: Iterable<FightRecord>, weights: ScoreWeights = DEFAULT_WEIGHTS, options: ResultOptions = {}): Results {
  const aggregator = new Aggregator();
  aggregator.add(records);
  return aggregator.results(weights, options);
}
