import { generatePlayerPositions, generateEnemyPositions } from '@/systems/combat/unitFactory';
import { inArena } from '@/systems/combat/arenaGeometry';
import { hexKey } from '@/utils/hexUtils';
import { HexCoord } from '@/models/types';

const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8];

const sides: { name: string; gen: (n: number) => HexCoord[]; backRow: number }[] = [
  { name: 'player', gen: generatePlayerPositions, backRow: 4 },
  { name: 'enemy', gen: generateEnemyPositions, backRow: -4 },
];

describe('spawn position generation', () => {
  it('returns exactly `count` positions', () => {
    const offenders: string[] = [];
    for (const side of sides) {
      for (const n of COUNTS) {
        const got = side.gen(n).length;
        if (got !== n) offenders.push(`${side.name} ${n} -> ${got}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('places every unit inside the arena for 1..8 per side', () => {
    const offenders: string[] = [];
    for (const side of sides) {
      for (const n of COUNTS) {
        for (const h of side.gen(n)) {
          if (!inArena(h)) offenders.push(`${side.name} n=${n} ${hexKey(h)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never places two units of the same side on one hex', () => {
    const offenders: string[] = [];
    for (const side of sides) {
      for (const n of COUNTS) {
        const keys = side.gen(n).map(hexKey);
        if (new Set(keys).size !== keys.length) offenders.push(`${side.name} n=${n}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never collides with the opposing side', () => {
    const offenders: string[] = [];
    for (const p of COUNTS) {
      for (const e of COUNTS) {
        const enemyKeys = new Set(generateEnemyPositions(e).map(hexKey));
        for (const h of generatePlayerPositions(p)) {
          if (enemyKeys.has(hexKey(h))) offenders.push(`p=${p} e=${e} ${hexKey(h)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('fills the back row before spilling into the front row', () => {
    const offenders: string[] = [];
    for (const side of sides) {
      // The back row holds five; anything beyond that overflows one row inward.
      for (const n of COUNTS) {
        const back = side.gen(n).filter((h) => h.r === side.backRow).length;
        const expected = Math.min(n, 5);
        if (back !== expected) offenders.push(`${side.name} n=${n} back=${back} want=${expected}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('centres each row', () => {
    // Four heroes on the five-wide back row leave the gap on the far side, not
    // at the end of the line.
    expect(generatePlayerPositions(4).map(hexKey)).toEqual([
      '-3,4', '-2,4', '-1,4', '0,4',
    ]);
    expect(generateEnemyPositions(3).map(hexKey)).toEqual(['0,-4', '1,-4', '2,-4']);
  });

  it('throws rather than placing a unit outside the arena', () => {
    // Two rows per side hold eleven; the twelfth has nowhere legal to stand.
    expect(() => generatePlayerPositions(12)).toThrow();
    expect(() => generateEnemyPositions(12)).toThrow();
    expect(() => generateEnemyPositions(-1)).toThrow();
  });
});
