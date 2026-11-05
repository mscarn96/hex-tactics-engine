import { findPath, getReachableHexes, CostFunction } from '@/systems/world/pathfinding';

// Mock hexUtils to avoid honeycomb-grid ESM dependency
jest.mock('@/utils/hexUtils', () => {
  const NEIGHBOR_OFFSETS = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
  ];

  return {
    hexDistance: (a: any, b: any) =>
      Math.max(
        Math.abs(a.q - b.q),
        Math.abs(a.r - b.r),
        Math.abs((a.q + a.r) - (b.q + b.r))
      ),
    getNeighbors: (coord: any) =>
      NEIGHBOR_OFFSETS.map((o) => ({ q: coord.q + o.q, r: coord.r + o.r })),
    hexKey: (coord: any) => `${coord.q},${coord.r}`,
  };
});

const openCost: CostFunction = () => 1;

describe('findPath', () => {
  it('returns path of length 1 for start === goal', () => {
    const path = findPath({ q: 0, r: 0 }, { q: 0, r: 0 }, openCost);
    expect(path).toEqual([{ q: 0, r: 0 }]);
  });

  it('finds direct adjacent path', () => {
    const path = findPath({ q: 0, r: 0 }, { q: 1, r: 0 }, openCost);
    expect(path).not.toBeNull();
    expect(path!).toHaveLength(2);
    expect(path![0]).toEqual({ q: 0, r: 0 });
    expect(path![path!.length - 1]).toEqual({ q: 1, r: 0 });
  });

  it('finds path over multiple hexes', () => {
    const path = findPath({ q: 0, r: 0 }, { q: 3, r: 0 }, openCost);
    expect(path).not.toBeNull();
    expect(path!).toHaveLength(4);
    expect(path![0]).toEqual({ q: 0, r: 0 });
    expect(path![path!.length - 1]).toEqual({ q: 3, r: 0 });
  });

  it('returns null when all neighbors are impassable', () => {
    const blockedCost: CostFunction = () => null;
    const path = findPath({ q: 0, r: 0 }, { q: 1, r: 0 }, blockedCost);
    expect(path).toBeNull();
  });

  it('routes around blocked tiles', () => {
    // Block the direct east path (q=1,r=0)
    const blockedSet = new Set(['1,0', '1,-1', '0,-1']);
    const costFn: CostFunction = (_from, to) => {
      if (blockedSet.has(`${to.q},${to.r}`)) return null;
      return 1;
    };
    const path = findPath({ q: 0, r: 0 }, { q: 2, r: 0 }, costFn);
    expect(path).not.toBeNull();
    // Path should not include any blocked tile
    for (const hex of path!) {
      expect(blockedSet.has(`${hex.q},${hex.r}`)).toBe(false);
    }
    expect(path![path!.length - 1]).toEqual({ q: 2, r: 0 });
  });

  it('respects maxDistance', () => {
    const path = findPath({ q: 0, r: 0 }, { q: 5, r: 0 }, openCost, 3);
    expect(path).toBeNull();
  });
});

describe('getReachableHexes', () => {
  it('returns only start hex at cost 0', () => {
    const reachable = getReachableHexes({ q: 0, r: 0 }, 0, openCost);
    expect(reachable.size).toBe(1);
    expect(reachable.has('0,0')).toBe(true);
  });

  it('returns 7 hexes within range 1', () => {
    const reachable = getReachableHexes({ q: 0, r: 0 }, 1, openCost);
    expect(reachable.size).toBe(7);
  });

  it('returns 19 hexes within range 2', () => {
    const reachable = getReachableHexes({ q: 0, r: 0 }, 2, openCost);
    expect(reachable.size).toBe(19);
  });

  it('excludes impassable tiles', () => {
    const blocked = new Set(['1,0', '0,1']);
    const costFn: CostFunction = (_from, to) => {
      if (blocked.has(`${to.q},${to.r}`)) return null;
      return 1;
    };
    const reachable = getReachableHexes({ q: 0, r: 0 }, 1, costFn);
    expect(reachable.has('1,0')).toBe(false);
    expect(reachable.has('0,1')).toBe(false);
  });

  it('records correct cost for each hex', () => {
    const reachable = getReachableHexes({ q: 0, r: 0 }, 2, openCost);
    expect(reachable.get('0,0')).toBe(0);
    expect(reachable.get('1,0')).toBe(1);
    // Any hex at distance 2 should have cost 2
    const twoAway = ['2,0', '2,-2', '0,-2', '-2,0', '-2,2', '0,2', '1,-2', '-1,2'];
    for (const key of twoAway) {
      if (reachable.has(key)) {
        expect(reachable.get(key)).toBe(2);
      }
    }
  });
});
