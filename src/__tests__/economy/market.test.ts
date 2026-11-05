import { TRADED_RESOURCES, marketSpread, rateTrend, tradeRates } from '@/systems/economy/market';
import { ResourceType } from '@/models/types';

/**
 * The market is a pure function of the week number, which is the whole design:
 * nothing about it is stored, so it cannot drift out of step with the calendar
 * or cost a byte of save file. These pin that, and pin the one economic rule the
 * whole thing rests on.
 */

const WEEKS = Array.from({ length: 60 }, (_, i) => i + 1);

describe('trade rates', () => {
  it('prices every resource except gold', () => {
    const priced = tradeRates(1).map((r) => r.resource);
    expect(priced).not.toContain(ResourceType.Gold);
    expect(new Set(priced)).toEqual(new Set(TRADED_RESOURCES));
  });

  /**
   * The rule that stops the market being an infinite gold press. Below this,
   * buying and selling in the same breath makes money out of nothing, and every
   * other cost in the game stops meaning anything.
   */
  it('never lets a resource be sold for more than it costs', () => {
    const arbitrage = WEEKS.flatMap((week) =>
      tradeRates(week)
        .filter((r) => r.sell >= r.buy)
        .map((r) => `week ${week}: ${r.resource} buy ${r.buy} sell ${r.sell}`),
    );
    expect(arbitrage).toEqual([]);
  });

  it('gives the same week the same prices, every time', () => {
    expect(tradeRates(7)).toEqual(tradeRates(7));
    expect(tradeRates(7)).not.toEqual(tradeRates(8));
  });

  it('never prices anything at zero', () => {
    const free = WEEKS.flatMap((week) =>
      tradeRates(week).filter((r) => r.sell < 1 || r.buy < 1).map((r) => r.resource),
    );
    expect(free).toEqual([]);
  });

  // A market where the price is always the same number is a vending machine
  it('actually moves the price of every resource across a season', () => {
    const flat = TRADED_RESOURCES.filter((resource) => {
      const seen = new Set(
        WEEKS.map((w) => tradeRates(w).find((r) => r.resource === resource)!.sell),
      );
      return seen.size < 3;
    });
    expect(flat).toEqual([]);
  });

  it('reports demand only when the price has really moved', () => {
    const rates = WEEKS.flatMap((w) => tradeRates(w));
    const trends = new Set(rates.map(rateTrend));
    // All three verdicts must be reachable, or the arrow is decoration
    expect(trends).toEqual(new Set(['high', 'low', 'normal']));
  });
});

describe('resource exchange upgrades', () => {
  it('narrows purchase spreads without changing weekly sell rates', () => {
    for (const week of WEEKS) for (const level of [0, 1, 2, 3]) {
      const rates = tradeRates(week, level);
      expect(rates.map(r => r.sell)).toEqual(tradeRates(week, 0).map(r => r.sell));
      for (const rate of rates) {
        expect(rate.buy).toBe(Math.max(rate.sell + 1, Math.round(rate.sell * marketSpread(level))));
        expect(rate.buy).toBeGreaterThan(rate.sell);
      }
    }
    expect([0,1,2,3].map(marketSpread)).toEqual([1.55,1.40,1.25,1.15]);
  });
});
