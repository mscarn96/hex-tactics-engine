import { HeroClass, MasteryId } from '@/models/types';
import { aggregate, Aggregator } from '@/systems/sim/balance/aggregate';
import { defaultSpec, ENCOUNTER_IDS } from '@/systems/sim/balance/encounters';
import { rollParty } from '@/systems/sim/balance/partyRoll';
import { FightRecord, HeroFact, Outcome, partyRecord } from '@/systems/sim/balance/record';
import { fightSeed, makeRng, partyRng } from '@/systems/sim/balance/rng';
import {
  DEFAULT_WEIGHTS,
  refOf,
  scoreRecord,
  ScoreWeights,
  speedRefs,
  tierOf,
  wilson,
} from '@/systems/sim/balance/scoring';

/**
 * Scoring and aggregation, on hand-made facts: each part of the score, that a
 * weight change rescores without new fights, the interval, the sample minimum,
 * the adjustment for budget and chunked aggregation.
 */

const ZERO: ScoreWeights = { win: 0, speed: 0, dealt: 0, alive: 0, health: 0, stage: 0 };
const only = (part: keyof ScoreWeights, points: number): ScoreWeights => ({ ...ZERO, [part]: points });

const spec = defaultSpec('troll');
const base = rollParty(spec, {}, partyRng(1));

function record(over: Partial<FightRecord> & { heroes?: HeroFact[] } = {}): FightRecord {
  const { heroes, ...rest } = over;
  return {
    seed: 1, enc: 'troll', dg: 1, o: 'victory', t: 40, bt: 10, d: 1,
    h: heroes ?? [{ a: 1, hp: 0.5 }, { a: 1, hp: 1 }],
    party: partyRecord(base),
    ...rest,
  };
}

describe('the score parts', () => {
  it('pays 100 for a win and nothing for a loss', () => {
    expect(scoreRecord(record(), only('win', 100)).total).toBe(100);
    expect(scoreRecord(record({ o: 'defeat' }), only('win', 100)).total).toBe(0);
    expect(scoreRecord(record({ o: 'draw' }), only('win', 100)).total).toBe(0);
  });

  it('pays for boss health dealt, on a loss too', () => {
    expect(scoreRecord(record({ o: 'defeat', d: 0.4 }), only('dealt', 30)).total).toBeCloseTo(12);
  });

  it('pays for heroes alive and for the health left on the living only', () => {
    const r = record({ heroes: [{ a: 1, hp: 0.5 }, { a: 0, hp: 0 }, { a: 1, hp: 1 }, { a: 0, hp: 0 }] });
    expect(scoreRecord(r, only('alive', 20)).total).toBeCloseTo(10);
    expect(scoreRecord(r, only('health', 20)).total).toBeCloseTo(15);
    expect(scoreRecord(record({ heroes: [{ a: 0, hp: 0 }] }), only('health', 20)).total).toBe(0);
  });

  it('pays 10 per castle garrison stage cleared, and not for Aethelred\'s', () => {
    const stage = (n: number, o: Outcome) => ({ n, o, t: 1, bt: 1, d: 1, h: [] });
    const r = record({ enc: 'castle', o: 'defeat', st: [stage(0, 'victory'), stage(1, 'victory'), stage(2, 'defeat')] });
    expect(scoreRecord(r, only('stage', 10)).total).toBe(20);
    const won = record({ enc: 'castle', st: [stage(0, 'victory'), stage(1, 'victory'), stage(2, 'victory'), stage(3, 'victory')] });
    expect(scoreRecord(won, only('stage', 10)).total).toBe(30);
    expect(scoreRecord(record(), only('stage', 10)).total).toBe(0);
  });

  it('pays speed only to a win, from 0 at the median to full at the fastest', () => {
    const ref = refOf([10, 20, 30]); // median 20, fastest 10
    expect(ref).toEqual({ median: 20, fastest: 10 });
    const speed = (bt: number, o: Outcome = 'victory') => scoreRecord(record({ bt, o }), only('speed', 30), ref).total;
    expect(speed(10)).toBe(30);
    expect(speed(15)).toBeCloseTo(15);
    expect(speed(20)).toBe(0);
    expect(speed(35)).toBe(0);
    expect(speed(10, 'defeat')).toBe(0);
    expect(scoreRecord(record(), only('speed', 30)).total).toBe(0); // no reference, no speed
  });

  it('reads the reference off the winning fights of each encounter', () => {
    const refs = speedRefs([record({ bt: 10 }), record({ bt: 30 }), record({ bt: 20 }), record({ bt: 5, o: 'defeat' }), record({ enc: 'dragon', bt: 7 })]);
    expect(refs.troll).toEqual({ median: 20, fastest: 10 });
    expect(refs.dragon).toEqual({ median: 7, fastest: 7 });
  });

  it('sums the parts', () => {
    const parts = scoreRecord(record(), DEFAULT_WEIGHTS, refOf([10, 20]));
    expect(parts.total).toBeCloseTo(parts.win + parts.speed + parts.dealt + parts.alive + parts.health + parts.stage);
  });
});

describe('intervals', () => {
  it('matches the Wilson interval on known values', () => {
    const half = wilson(50, 100);
    expect(half.lo).toBeCloseTo(0.4038, 3);
    expect(half.hi).toBeCloseTo(0.5962, 3);
    const none = wilson(0, 10);
    expect(none.lo).toBe(0);
    expect(none.hi).toBeCloseTo(0.2775, 3);
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
  });
});

describe('tiers', () => {
  it('cuts S to D from the ranking', () => {
    const tiers = Array.from({ length: 20 }, (_, i) => tierOf(i, 20));
    expect(tiers.slice(0, 2)).toEqual(['S', 'S']);
    expect(tiers[19]).toBe('D');
    expect(new Set(tiers)).toEqual(new Set(['S', 'A', 'B', 'C', 'D']));
  });
});

// ─── Aggregation ──────────────────────────────────────────────────────────────

/** Synthetic fights: random parties, outcomes drawn from a rule the test controls. */
function fights(count: number, win: (r: FightRecord, rng: () => number) => boolean, encounter: (typeof ENCOUNTER_IDS)[number] = 'troll'): FightRecord[] {
  const s = defaultSpec(encounter);
  const rng = makeRng(42);
  return Array.from({ length: count }, (_, i) => {
    const seed = fightSeed(7, 0, i);
    const party = rollParty(s, {}, partyRng(seed));
    const r = record({ seed, enc: encounter, party: partyRecord(party) });
    const won = win(r, rng);
    return { ...r, o: won ? 'victory' : 'defeat', bt: 8 + Math.floor(rng() * 12), d: won ? 1 : rng(), h: r.h.map(() => ({ a: won || rng() < 0.4 ? 1 : 0, hp: won ? rng() : 0 })) } as FightRecord;
  });
}

describe('aggregating', () => {
  const data = fights(400, (r, rng) => {
    const warriors = r.party.h.filter((h) => h.c === HeroClass.Warrior).length;
    return rng() < 0.3 + 0.25 * warriors;
  });

  it('gives the same rows aggregating in chunks as all at once', () => {
    const all = aggregate(data);
    const chunked = new Aggregator();
    for (let i = 0; i < data.length; i += 37) chunked.add(data.slice(i, i + 37));
    expect(chunked.results()).toEqual(all);
    expect(chunked.size).toBe(data.length);
  });

  it('rescores with other weights from the same fights', () => {
    const a = new Aggregator();
    a.add(data);
    const standard = a.results();
    const winsOnly = a.results(only('win', 100));
    const warriorA = standard.views.class.find((r) => r.key === HeroClass.Warrior)!;
    const warriorB = winsOnly.views.class.find((r) => r.key === HeroClass.Warrior)!;
    expect(warriorB.n).toBe(warriorA.n);
    expect(warriorB.winRate).toBe(warriorA.winRate);
    expect(warriorB.mean).toBeCloseTo(warriorB.winRate * 100);
    expect(warriorB.mean).not.toBeCloseTo(warriorA.mean);
  });

  it('counts a hero row once per hero and ranks the class that wins more higher', () => {
    const { views } = aggregate(data);
    const byClass = Object.fromEntries(views.class.map((r) => [r.key, r]));
    const total = data.reduce((sum, r) => sum + r.party.h.length, 0);
    expect(Object.values(byClass).reduce((sum, r) => sum + r.n, 0)).toBe(total);
    expect(byClass[HeroClass.Warrior].adj).toBeGreaterThan(byClass[HeroClass.Mage].adj);
    expect(byClass[HeroClass.Warrior].winLo).toBeLessThan(byClass[HeroClass.Warrior].winRate);
    expect(byClass[HeroClass.Warrior].winHi).toBeGreaterThan(byClass[HeroClass.Warrior].winRate);
  });

  it('leaves a row under the sample minimum out of the tier lists', () => {
    const { views, tiers } = aggregate(data, DEFAULT_WEIGHTS, { minSample: 60 });
    const small = views.path.filter((r) => r.lowSample);
    const kept = views.path.filter((r) => !r.lowSample);
    expect(small.length).toBeGreaterThan(0);
    expect(tiers.path.map((t) => t.key).sort()).toEqual(kept.filter((r) => !r.key.startsWith('none')).map((r) => r.key).sort());
    for (const r of small) expect(tiers.path.some((t) => t.key === r.key)).toBe(false);
    // low-sample rows sort last
    expect(views.path.slice(-small.length).every((r) => r.lowSample)).toBe(true);
  });

  it('filters to one encounter', () => {
    const mixed = [...data.slice(0, 50), ...fights(50, () => true, 'dragon')];
    const one = aggregate(mixed, DEFAULT_WEIGHTS, { encounter: 'dragon' });
    expect(one.fights).toBe(50);
    expect(Object.keys(one.perEncounter)).toEqual(['dragon']);
    expect(aggregate(mixed).fights).toBe(100);
  });

  it('compares an item with the same encounter without it', () => {
    const { views } = aggregate(data);
    const row = views.legendary.find((r) => r.n >= 5 && r.without)!;
    expect(row).toBeDefined();
    expect(row.n + row.without!.n).toBe(data.length);
    expect(row.delta).toBeCloseTo(row.adj - row.without!.adj);
  });

  it('splits each encounter by party size, with the facts the tactics dividend compares', () => {
    // The Dragon's parties are two or three heroes; only the trios win, and each size answers its own way
    const mixed = fights(200, (r) => r.party.h.length === 3, 'dragon').map((r) => ({
      ...r,
      an: { furnace_heart: r.party.h.length === 3 ? [0, 0, 0, 0, 1] : [2, 1, 0, 0, 0] },
    }));
    const { bySize, perEncounter, answers } = aggregate(mixed);
    const sizes = bySize.dragon!;
    expect(Object.keys(sizes).sort()).toEqual(['2', '3']);
    expect(sizes[2].n + sizes[3].n).toBe(perEncounter.dragon!.n);
    expect(sizes[2].wins).toBe(0);
    expect(sizes[3].winRate).toBe(1);

    const pairs = mixed.filter((r) => r.party.h.length === 2);
    const mean = (f: (r: FightRecord) => number) => pairs.reduce((sum, r) => sum + f(r), 0) / pairs.length;
    expect(sizes[2].dealt).toBeCloseTo(mean((r) => r.d));
    expect(sizes[2].alive).toBeCloseTo(mean((r) => r.h.filter((h) => h.a === 1).length));
    expect(sizes[2].bossTurns).toBeCloseTo(mean((r) => r.bt));
    expect(sizes[2].answers.furnace_heart).toEqual({ stepped: 2 * pairs.length, took: pairs.length, blocked: 0, unharmed: 0, broken: 0 });
    expect(sizes[3].answers.furnace_heart.broken).toBe(sizes[3].n);
    // The sizes' tallies add up to the encounter's
    expect(sizes[2].answers.furnace_heart.stepped + sizes[3].answers.furnace_heart.stepped).toBe(answers.dragon!.furnace_heart.stepped);
  });

  it('averages the adjusted score to zero over everything', () => {
    const r = aggregate(data);
    const total = r.views.compClass.reduce((sum, row) => sum + row.adj * row.n, 0);
    expect(total / data.length).toBeCloseTo(0, 6);
  });
});

describe('the budget adjustment', () => {
  it('stops a class that only turned up in rich parties from looking strong', () => {
    // Two budget classes of party: rich ones always score high, poor ones low. Mages
    // appear only in rich parties, Rangers only in poor ones, and both do exactly as
    // well as the rest of their bucket.
    const mk = (cls: HeroClass, rich: boolean, i: number, win: boolean): FightRecord => {
      const r = record({ seed: i, o: win ? 'victory' : 'defeat', d: win ? 1 : 0.2, bt: 10 });
      const hero = { ...r.party.h[0], c: cls, p: '' as MasteryId | '', cap: '', n: [], g: {} };
      return { ...r, party: { ls: 20, bud: rich ? [3, 6, 6] : [0, 0, 1], h: [hero] }, h: [{ a: win ? 1 : 0, hp: 0.5 }] };
    };
    const rows: FightRecord[] = [];
    for (let i = 0; i < 100; i++) {
      rows.push(mk(HeroClass.Mage, true, i, i % 10 < 8), mk(HeroClass.Warrior, true, i, i % 10 < 8));
      rows.push(mk(HeroClass.Ranger, false, i, i % 10 < 2), mk(HeroClass.Warrior, false, 1000 + i, i % 10 < 2));
    }
    const { views } = aggregate(rows);
    const get = (c: HeroClass) => views.class.find((r) => r.key === c)!;
    // Raw scores: the Mage looks far better than the Ranger...
    expect(get(HeroClass.Mage).mean - get(HeroClass.Ranger).mean).toBeGreaterThan(50);
    // ...adjusted, both sit at their bucket's mean
    expect(get(HeroClass.Mage).adj).toBeCloseTo(0, 6);
    expect(get(HeroClass.Ranger).adj).toBeCloseTo(0, 6);
    expect(get(HeroClass.Warrior).adj).toBeCloseTo(0, 6);
  });
});
