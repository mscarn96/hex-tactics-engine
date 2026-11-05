import type { RoadState } from '@/data/levelCap';
import type { WorldId } from '@/data/worlds';

/**
 * A campaign with Jadeveil holding `band`, at the cap `cap`. There are not yet four worlds to
 * fill the ledger with, so the bands below it and the crossings above them go to stub worlds:
 * the ledger only ever asks for the order and the count.
 */
export function jadeveilAt(band: number, cap = 20 + 5 * band): RoadState {
  const stub = (i: number) => `stub_${i}` as WorldId;
  const crossings = (cap - 20) / 5;
  return {
    owned: ['jadeveil', stub(1), stub(2), stub(3)],
    emperorDefeated: true,
    banded: [...Array.from({ length: band - 1 }, (_, i) => stub(i + 1)), 'jadeveil'],
    finished: Array.from({ length: crossings - 1 }, (_, i) => stub(i + 1)),
  };
}
