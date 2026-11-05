import fs from 'fs';
import { POIType, ResourceType, TileType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { generateMap } from '@/systems/world/mapGenerator';
import { generateForBand, planForEncounter } from '@/systems/world/encounterGenerator';
import { CHEST_GUARD_ID, chestGuardBand, findCounts, rollWeeklyFinds } from '@/systems/world/finds';
import { neutralDepth, threatRewardScale, ThreatBand } from '@/systems/world/threat';
import { tributeDemand } from '@/systems/world/tribute';
import { createRNG } from '@/utils/rng';
import { hexDistance, hexKey } from '@/utils/hexUtils';

/**
 * Discovery cadence and reward value, measured across fixed map seeds.
 *
 * Every figure is measured here and written to
 * private captures; the recorded review is in
 * `docs/world.md`, under *Exploration finds*. The bounds are the
 * rules - finds are occasional and useful, never the economy and never
 * clutter - and the report is where the numbers live.
 */

const SEEDS = [1, 7, 42, 99, 1234, 4242, 90210, 777, 31337, 20261003, 1471934286, 55];
const WEEKS = [1, 2, 3, 4, 5, 6];
const BANDS: ThreatBand[] = [0, 1, 2, 3, 4];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** What the old nodes paid, per type: the amounts the map had before finds. */
const OLD_NODE_AMOUNTS = [
  { min: 5, max: 15 }, { min: 5, max: 12 }, { min: 3, max: 8 }, { min: 1, max: 3 },
];
const OLD_NODE_MEAN = mean(OLD_NODE_AMOUNTS.map((a) => (a.min + a.max) / 2));
/** The old generator placed the target and up to three more: 1.5 more on average. */
const OLD_NODE_SURPLUS = 1.5;

const goldMean = (amount: { min: number; max: number }, band: ThreatBand) =>
  ((amount.min + amount.max) / 2) * threatRewardScale(band, neutralDepth(band), true);
const purseMean = (band: ThreatBand) => goldMean(BALANCE.EXPLORATION_FINDS.GOLD_AMOUNT, band);
const chestMean = (band: ThreatBand) => goldMean(BALANCE.EXPLORATION_FINDS.CHEST_GOLD_AMOUNT, band);

/** The mean gold one fight pays at a band, from the composer and templates the game fights with. */
function meanFightGold(band: ThreatBand, next: () => number): number {
  const scale = threatRewardScale(band, neutralDepth(band), true);
  const golds: number[] = [];
  for (let i = 0; i < 200; i++) {
    const ids = generateForBand(band, TileType.Plains, Infinity, [], next);
    golds.push(ids.reduce((sum, id) => {
      const template = enemyTemplates.find((e) => e.id === id)!;
      return sum + Math.round(template.goldReward * scale * BALANCE.ENEMY_GOLD_SCALE);
    }, 0));
  }
  return mean(golds);
}

/**
 * The gold every body of a chest's guards pays, first rank and reinforcements
 * together, at the band they are paid at: what winning the whole fight is worth
 * before the chest's own contents.
 */
function meanGuardFightGold(groundBand: ThreatBand, next: () => number): number {
  const band = chestGuardBand(groundBand);
  const scale = threatRewardScale(band, neutralDepth(band), true);
  const spy = jest.spyOn(Math, 'random').mockImplementation(next);
  try {
    const golds: number[] = [];
    for (let i = 0; i < 200; i++) {
      const plan = planForEncounter(CHEST_GUARD_ID, band, TileType.Plains, Infinity);
      const bodies = [...plan.enemies, ...(plan.waves ?? []).flatMap((w) => w.templateIds)];
      golds.push(bodies.reduce((sum, id) => {
        const template = enemyTemplates.find((e) => e.id === id)!;
        return sum + Math.round(template.goldReward * scale * BALANCE.ENEMY_GOLD_SCALE);
      }, 0));
    }
    return mean(golds);
  } finally {
    spy.mockRestore();
  }
}

const rows = SEEDS.map((seed) => {
  const tiles = generateMap(seed);
  const city = tiles.find((t) => t.poi === POIType.City)!.coord;
  const weeks = WEEKS.map((week) => {
    const finds = [...rollWeeklyFinds(tiles, seed, week).values()];
    const caches = finds.filter((f) => f.kind === 'cache');
    const ore = caches.filter((f) => f.payout[0].type !== ResourceType.Gold);
    const purses = caches.filter((f) => f.payout[0].type === ResourceType.Gold);
    const within = (n: number) => caches.filter((f) => hexDistance(f.coord, city) <= n).length;
    return {
      total: finds.length,
      oreUnits: ore.reduce((s, f) => s + f.payout[0].amount, 0),
      purseGold: purses.reduce((s, f) => s + f.payout[0].amount, 0),
      chests: finds.filter((f) => f.kind === 'chest').length,
      within8: within(8),
      within14: within(14),
      within24: within(24),
      nearest: Math.min(...caches.map((f) => hexDistance(f.coord, city))),
    };
  });
  const nodes = Math.round((tiles.length / 1000) * BALANCE.POI_PER_1000_TILES.resource) + OLD_NODE_SURPLUS;
  return { seed, tiles: tiles.length, weeks, oldUnits: nodes * OLD_NODE_MEAN };
});

describe('discovery cadence', () => {
  it('shows a new player something close to home, on every seed and week, without wallpapering it', () => {
    for (const row of rows) {
      row.weeks.forEach((w, i) => {
        const at = { seed: row.seed, week: i + 1 };
        expect({ ...at, near: w.within14 >= 1 }).toEqual({ ...at, near: true });
        expect({ ...at, crowded: w.within8 > 8 }).toEqual({ ...at, crowded: false });
      });
    }
  });

  it('leaves almost all the ground empty: finds are occasional, not clutter', () => {
    for (const row of rows) {
      for (const w of row.weeks) expect(w.total / row.tiles).toBeLessThan(0.06);
    }
  });
});

describe('reward value', () => {
  const rng = createRNG(20261004);
  const fight = Object.fromEntries(BANDS.map((b) => [b, meanFightGold(b, () => rng.next())])) as Record<number, number>;

  it('keeps a week of ore near what the nodes paid: not trivialising it, not starving it', () => {
    for (const row of rows) {
      const supply = mean(row.weeks.map((w) => w.oreUnits));
      expect({ seed: row.seed, low: supply < row.oldUnits * 0.6, high: supply > row.oldUnits * 1.6 })
        .toEqual({ seed: row.seed, low: false, high: false });
    }
  });

  it('pays a purse well under a fight on the same ground, so fights and shops still matter', () => {
    for (const band of BANDS) {
      expect({ band, ok: purseMean(band) < fight[band] * 0.7 }).toEqual({ band, ok: true });
    }
  });

  it('never lets a whole week of purses cover three tribute bills', () => {
    for (const row of rows) {
      const gold = mean(row.weeks.map((w) => w.purseGold));
      expect({ seed: row.seed, covers: gold > tributeDemand(3) * 3 }).toEqual({ seed: row.seed, covers: false });
    }
  });

  it('pays something worth stooping for at the home ring, where gold is scarce', () => {
    expect(purseMean(0)).toBeGreaterThan(fight[0] * 0.25);
  });

  it('pays a chest a real share of its guards fight, never a windfall beside it', () => {
    for (const band of BANDS) {
      const guards = fight[chestGuardBand(band)];
      // The fight's own pay still comes on top, so a chest need not match it at depth.
      expect({ band, worthIt: chestMean(band) >= guards * 0.3, notAWindfall: chestMean(band) <= guards * 6 })
        .toEqual({ band, worthIt: true, notAWindfall: true });
    }
  });

  it('pays the whole guard fight what its band pays plus the reinforcements, no more', () => {
    // Paid by threat power: an ordinary fight at the guards' own band, with the
    // bodies of two extra waves on top and nothing else.
    const roll = createRNG(20261005);
    for (const band of BANDS) {
      const ratio = meanGuardFightGold(band, () => roll.next()) / fight[chestGuardBand(band)];
      expect({ band, ok: ratio >= 1 && ratio <= 3.5 }).toEqual({ band, ok: true });
    }
  });

  it('records the multi-seed review', () => {
    const recorder = createRNG(20261006);
    const report = {
      seeds: SEEDS,
      weeks: WEEKS,
      perSeed: rows.map((r) => ({
        seed: r.seed,
        tiles: r.tiles,
        oldNodeOreUnitsPerWeek: round(r.oldUnits),
        findOreUnitsPerWeek: round(mean(r.weeks.map((w) => w.oreUnits))),
        purseGoldPerWeek: round(mean(r.weeks.map((w) => w.purseGold))),
        findsPerWeek: round(mean(r.weeks.map((w) => w.total))),
        chestsPerWeek: round(mean(r.weeks.map((w) => w.chests))),
        cachesWithin8: round(mean(r.weeks.map((w) => w.within8))),
        cachesWithin14: round(mean(r.weeks.map((w) => w.within14))),
        cachesWithin24: round(mean(r.weeks.map((w) => w.within24))),
        nearestCacheHexes: Math.min(...r.weeks.map((w) => w.nearest)),
        shareOfTilesHoldingAFind: round(mean(r.weeks.map((w) => w.total / r.tiles)), 4),
      })),
      meanFightGoldByBand: Object.fromEntries(BANDS.map((b) => [b, round(fight[b])])),
      meanPurseByBand: Object.fromEntries(BANDS.map((b) => [b, round(purseMean(b))])),
      guardFightGoldByGroundBand: Object.fromEntries(BANDS.map((b) => [b, round(meanGuardFightGold(b, () => recorder.next()))])),
      meanChestGoldByBand: Object.fromEntries(BANDS.map((b) => [b, round(chestMean(b))])),
      counts: findCounts(4900),
      tributeWeek3: tributeDemand(3),
    };
    fs.mkdirSync('coverage/captures/finds-tuning', { recursive: true });
    fs.writeFileSync('coverage/captures/finds-tuning/report.json', JSON.stringify(report, null, 2) + '\n');
    expect(report.perSeed).toHaveLength(SEEDS.length);
  });
});
