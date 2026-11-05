import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { BALANCE } from '@/data/balanceConstants';
import { MasteryNode, MasteryPath, NODE_MAX_LEVEL } from '@/models/types';
import {
  isSideNode,
  mainTreeNodes,
  maxLevelOf,
  missingPrerequisites,
  pointsEarnedByLevel,
  prerequisitesFor,
} from '@/systems/progression/mastery';

/**
 * The v3 economy: what a point buys and when each gate opens.
 *
 * Every number here was a design decision stated up front — tier 3 at level 11,
 * the side tree at 12 — and each is a *consequence* of the tree's shape rather
 * than a constant anybody set. That is exactly the kind of number that drifts
 * silently: re-column one node and a capstone quietly costs seven points, with
 * nothing failing and no way to notice short of counting by hand.
 *
 * Measured analytically over the real trees rather than sampled, the argument
 * `homeRing.test.ts` makes: a cheapest-closure walk is exact and cheap, and a
 * Monte Carlo over builds would be neither.
 */

/**
 * The fewest points that can put one level in `node`, including everything it
 * needs underneath.
 *
 * A closure, not a sum of a chain: `requiresCount` nodes take their N cheapest
 * feeders, and two feeders sharing a grandparent must pay for it once — which is
 * the whole reason the old "sum each chain separately" arithmetic reported 13
 * where the real answer was 12.
 */
function cheapestClosure(path: MasteryPath, node: MasteryNode): Set<string> {
  const walk = (n: MasteryNode, seen: Set<string>): Set<string> => {
    if (seen.has(n.id)) return new Set();
    const here = new Set([...seen, n.id]);
    const owned = new Set([n.id]);
    const parents = prerequisitesFor(path, n);
    const need = Math.min(parents.length, n.requiresCount ?? parents.length);
    const options = parents
      .map((p) => walk(p, here))
      .sort((a, b) => a.size - b.size)
      .slice(0, need);
    for (const option of options) for (const id of option) owned.add(id);
    return owned;
  };
  return walk(node, new Set());
}

/** The level a hero first holds this many points at. */
const levelForPoints = (points: number, path: MasteryPath): number => {
  for (let level = BALANCE.MASTERY_UNLOCK_LEVEL; level <= BALANCE.MAX_LEVEL; level++) {
    if (pointsEarnedByLevel(level, path.id) >= points) return level;
  }
  return Infinity;
};

const capstonesOf = (path: MasteryPath) =>
  path.nodes.filter((n) => n.exclusiveGroup === 'capstone');
const startersOf = (path: MasteryPath) => path.nodes.filter((n) => n.exclusiveGroup === 'side');

describe('reaching a capstone', () => {
  it('costs six points in every one of the twelve trees', () => {
    const costs = MASTERY_PATHS.map((path) => {
      const cheapest = Math.min(...capstonesOf(path).map((c) => cheapestClosure(path, c).size));
      return `${path.id}: ${cheapest}`;
    });
    expect(costs).toEqual(MASTERY_PATHS.map((p) => `${p.id}: 6`));
  });

  /**
   * Level 11 for everyone except Wildshape, which arrives a level early — its
   * `bonusPoints` stands in for the signature skill every other path is handed
   * free, and unlike a signature the shape it buys is *inside* the closure. The
   * trade is deliberate: the Druid is one point of breadth behind for good.
   */
  it('opens at level 11, and at 10 for the path that pays in a point', () => {
    const opens = Object.fromEntries(
      MASTERY_PATHS.map((path) => {
        const cheapest = Math.min(...capstonesOf(path).map((c) => cheapestClosure(path, c).size));
        return [path.id, levelForPoints(cheapest, path)];
      }),
    );
    for (const path of MASTERY_PATHS) {
      expect(opens[path.id]).toBe(path.id === 'wildshape' ? 10 : 11);
    }
  });

  it('gives every path exactly three, and lets a hero own one', () => {
    for (const path of MASTERY_PATHS) {
      const capstones = capstonesOf(path);
      expect(capstones).toHaveLength(3);
      // Cost cannot enforce this any more — every node is one point — so the
      // exclusive tag is the whole rule, and a missing one is a hero with three
      // capstones and no test to say so.
      for (const c of capstones) expect(c.exclusiveGroup).toBe('capstone');
    }
  });
});

describe('the two side trees', () => {
  it('gives every path exactly two, each a starter and two children', () => {
    for (const path of MASTERY_PATHS) {
      const starters = startersOf(path);
      expect(starters).toHaveLength(2);
      for (const starter of starters) {
        const children = path.nodes.filter((n) => (n.requires ?? []).includes(starter.id));
        expect(children).toHaveLength(2);
        for (const child of children) expect(isSideNode(child)).toBe(true);
      }
    }
  });

  /**
   * The starter is normally the only kind of node in the game that cannot be
   * levelled, and that is a rule rather than an accident of authoring: what it
   * holds is a unique passive or a whole-hex step, neither of which has a
   * fraction of itself to be.
   *
   * The Bulwark remaster (2026-10) is the stated exception. Last Stand and
   * Vengeance moved down from the ultimate row with their three ranks (20/30/40%
   * damage reduction, 25/50/75% odds), and Loud moved under Last Stand keeping its
   * single rank, because a whole turn of Taunt cannot be fractioned. Listed by
   * name so nothing else can drift into the same shape unnoticed.
   */
  const RANKED_STARTERS = new Set(['bulwark_last_stand', 'bulwark_vengeance']);
  const FLAT_CHILDREN = new Set(['bulwark_loud']);
  it('makes every starter flat and everything under it upgradeable, but for the named exceptions', () => {
    const wrong: string[] = [];
    for (const path of MASTERY_PATHS) {
      for (const starter of startersOf(path)) {
        const levels = RANKED_STARTERS.has(starter.id) ? NODE_MAX_LEVEL : 1;
        if (maxLevelOf(starter) !== levels) wrong.push(`${path.id}/${starter.id}: ${maxLevelOf(starter)} levels`);
        for (const child of path.nodes.filter((n) => (n.requires ?? []).includes(starter.id))) {
          const childLevels = FLAT_CHILDREN.has(child.id) ? 1 : NODE_MAX_LEVEL;
          if (maxLevelOf(child) !== childLevels) wrong.push(`${path.id}/${child.id}: ${maxLevelOf(child)} levels`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('opens on the first capstone point, one level later', () => {
    for (const path of MASTERY_PATHS) {
      const starter = startersOf(path)[0];
      const closure = cheapestClosure(path, starter);
      const capstone = Math.min(...capstonesOf(path).map((c) => cheapestClosure(path, c).size));
      // The starter is the very next point after a capstone, and no more
      expect(closure.size).toBe(capstone + 1);
      expect(levelForPoints(closure.size, path)).toBe(path.id === 'wildshape' ? 11 : 12);
    }
  });

  it('lets a hero take one side tree, never both', () => {
    for (const path of MASTERY_PATHS) {
      const tags = new Set(startersOf(path).map((n) => n.exclusiveGroup));
      expect(tags).toEqual(new Set(['side']));
    }
  });

  /** A side tree that no capstone opens is content nobody can ever reach. */
  it('is reachable from any capstone, not from one in particular', () => {
    for (const path of MASTERY_PATHS) {
      const capstones = capstonesOf(path).map((c) => c.id).sort();
      for (const starter of startersOf(path)) {
        expect(starter.requiresCount).toBe(1);
        expect([...(starter.requires ?? [])].sort()).toEqual(capstones);
      }
    }
  });
});

describe('the fifteen points a hero ends with', () => {
  /**
   * Going all the way down one line spends the whole budget and nothing else:
   * six to a capstone, one to a starter, two to finish the capstone, six to
   * finish both children. That the shape lands exactly on the budget is what
   * makes "deep" and "wide" a real choice rather than a false one.
   */
  it('pays for exactly one full line, with nothing spare', () => {
    const path = MASTERY_PATHS.find((p) => p.id === 'bulwark')!;
    const capstone = capstonesOf(path)[0];
    const starter = startersOf(path)[0];
    const children = path.nodes.filter((n) => (n.requires ?? []).includes(starter.id));

    const toCapstone = cheapestClosure(path, capstone).size;
    const raiseCapstone = maxLevelOf(capstone) - 1;
    // Every level of the starter too: the Bulwark's Last Stand side tree is a ranked
    // starter over one flat child, which costs exactly what a flat starter over two
    // ranked children does
    const wholeSideTree = starter.cost * maxLevelOf(starter)
      + children.reduce((s, c) => s + c.cost * maxLevelOf(c), 0);

    expect(toCapstone + raiseCapstone + wholeSideTree).toBe(BALANCE.MASTERY_POINTS_AT_CAP);
  });

  /**
   * The Firefly, a whole Monk tree, measured line by line: six
   * points to any of its capstones, and that capstone raised plus either side
   * tree spends exactly the fifteen.
   */
  it('measures the Firefly at six to a capstone and fifteen for every full line', () => {
    const path = MASTERY_PATHS.find((p) => p.id === 'firefly')!;
    const lines: string[] = [];
    for (const capstone of capstonesOf(path)) {
      const toCapstone = cheapestClosure(path, capstone).size;
      expect(toCapstone).toBe(6);
      for (const starter of startersOf(path)) {
        const children = path.nodes.filter((n) => (n.requires ?? []).includes(starter.id));
        const total = toCapstone + maxLevelOf(capstone) - 1 + starter.cost * maxLevelOf(starter)
          + children.reduce((s, c) => s + c.cost * maxLevelOf(c), 0);
        lines.push(`${capstone.id} + ${starter.id}: ${total}`);
      }
    }
    expect(lines).toHaveLength(6);
    for (const line of lines) expect(line).toMatch(new RegExp(`: ${BALANCE.MASTERY_POINTS_AT_CAP}$`));
  });

  it('never lets the budget finish a main tree', () => {
    for (const path of MASTERY_PATHS) {
      const full = mainTreeNodes(path).reduce((sum, n) => sum + n.cost * maxLevelOf(n), 0);
      expect(BALANCE.MASTERY_POINTS_AT_CAP).toBeLessThan(full);
    }
  });
});

describe('tier 2 is where the actives live', () => {
  /**
   * Four active skills per path, in the main tree's second tier.
   *
   * Wildshape is the exception and states why: its tier 2 is twelve form
   * skills, four per shape, and a Druid can only ever press one shape's worth.
   */
  it('grants a skill from every main-tree tier-2 node', () => {
    const passive: string[] = [];
    for (const path of MASTERY_PATHS) {
      const tier2 = mainTreeNodes(path).filter((n) => n.tier === 2);
      expect(tier2).toHaveLength(path.id === 'wildshape' ? 12 : 4);
      for (const node of tier2) {
        if (!node.grantsSkill) passive.push(`${path.id}/${node.id}`);
      }
    }
    expect(passive).toEqual([]);
  });
});

describe('a hero can actually walk to everything', () => {
  /**
   * Every node is reachable from nothing, given enough points — the tripwire the
   * previous design needed and did not have, when gates of [0,3,8,12] against
   * costs 1/2/2/3 left all thirty-six capstones unbuyable for a whole version.
   */
  it('leaves no node stranded behind a prerequisite nothing satisfies', () => {
    const stranded: string[] = [];
    for (const path of MASTERY_PATHS) {
      for (const node of path.nodes) {
        const closure = cheapestClosure(path, node);
        // Walking the closure has to actually satisfy the node's own gate
        const owned = new Set([...closure].filter((id) => id !== node.id));
        if (missingPrerequisites(path, node, owned).length > 0) {
          stranded.push(`${path.id}/${node.id}`);
        }
      }
    }
    expect(stranded).toEqual([]);
  });
});
