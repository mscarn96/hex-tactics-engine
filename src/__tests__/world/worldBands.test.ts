import { BALANCE } from '@/data/balanceConstants';
import {
  bandFloor, bandOf, bandTop, crossInto, isWorldBands, markFinished, nextBand, NO_WORLD_BANDS, type WorldBands,
} from '@/systems/world/worldBands';

/** The ledger's rules, pure, over stub worlds in every order (`systems/world/worldBands.ts`). */

const permutations = <T,>(list: readonly T[]): T[][] => list.length <= 1 ? [[...list]]
  : list.flatMap((head, i) => permutations(list.filter((_, k) => k !== i)).map((rest) => [head, ...rest]));

describe('a level band', () => {
  it('runs 21–25, 26–30, 31–35 and 36–40', () => {
    expect([1, 2, 3, 4].map((n) => [bandFloor(n), bandTop(n)])).toEqual([[21, 25], [26, 30], [31, 35], [36, 40]]);
    expect(bandTop(1) - bandFloor(1) + 1).toBe(BALANCE.EXPANSION_LEVELS);
  });
});

describe('the ledger', () => {
  it.each(permutations(['stub_a', 'stub_b', 'stub_c']))('gives the next band to each first crossing: %s, %s, %s', (...order) => {
    let ledger: WorldBands = NO_WORLD_BANDS;
    order.forEach((world, i) => {
      expect(bandOf(ledger, world)).toBeNull();
      expect(nextBand(ledger)).toBe(i + 1);
      ledger = crossInto(ledger, world);
      expect(bandOf(ledger, world)).toBe(i + 1);
    });
    expect(order.map((world) => bandOf(ledger, world))).toEqual([1, 2, 3]);
  });

  it('keeps a band on re-entry', () => {
    const once = crossInto(crossInto(NO_WORLD_BANDS, 'stub_a'), 'stub_b');
    expect(crossInto(once, 'stub_a')).toBe(once);
    expect(crossInto(once, 'stub_b')).toBe(once);
  });

  it('marks a world finished once, and a world with no crossing on record takes its band first', () => {
    const entered = crossInto(NO_WORLD_BANDS, 'stub_a');
    const finished = markFinished(entered, 'stub_a');
    expect(finished.finished).toEqual(['stub_a']);
    expect(markFinished(finished, 'stub_a')).toBe(finished);
    expect(bandOf(markFinished(finished, 'stub_b'), 'stub_b')).toBe(2);
  });

  it('never changes the ledger it is given', () => {
    const entered = Object.freeze(crossInto(NO_WORLD_BANDS, 'stub_a'));
    markFinished(entered, 'stub_a');
    expect(NO_WORLD_BANDS).toEqual({ bands: {}, finished: [] });
    expect(entered.finished).toEqual([]);
  });

  it('accepts only a ledger a campaign could have written', () => {
    expect(isWorldBands(NO_WORLD_BANDS)).toBe(true);
    expect(isWorldBands({ bands: { jadeveil: 1, archipelago: 2 }, finished: ['jadeveil'] })).toBe(true);
    for (const bad of [
      undefined,
      {},
      { bands: { jadeveil: 2 }, finished: [] },
      { bands: { jadeveil: 1, archipelago: 1 }, finished: [] },
      { bands: { empire: 1 }, finished: [] },
      { bands: { jadeveil: 1 }, finished: ['archipelago'] },
      { bands: { jadeveil: 1 }, finished: ['jadeveil', 'jadeveil'] },
    ]) expect(isWorldBands(bad)).toBe(false);
  });
});
