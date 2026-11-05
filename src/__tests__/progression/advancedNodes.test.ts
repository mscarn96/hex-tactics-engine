import {
  advancedNodes,
  canUnlockNode,
  isAdvancedNode,
  isSideNode,
  maxLevelOf,
  missingPrerequisites,
  nodeMinLevel,
  pointsEarnedByLevel,
  prerequisitesFor,
  requiredPrerequisiteCount,
} from '@/systems/progression/mastery';
import { MASTERY_PATHS, findMasteryPath } from '@/data/skills/masteryData';
import { BALANCE } from '@/data/balanceConstants';
import { highestLevelCap, setLevelCapInputs } from '@/data/levelCap';
import { ADVANCED_TIER, Hero, HeroClass, MasteryNode, MasteryPath, NODE_MAX_LEVEL } from '@/models/types';
import { usePartyStore } from '@/stores/partyStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { bandFloor, bandTop } from '@/systems/world/worldBands';

/**
 * The advanced nodes (the private project notes, *Progression past
 * 25*): tier 4, open by hero level row by row (`BALANCE.MASTERY_ROW_LEVELS`) behind
 * whichever capstone the hero took, in whichever world the level was earned. The
 * points past 20 stay spendable anywhere in the chosen tree.
 *
 * These are rules about every path, so a tree that adds or moves an advanced
 * node is held to them without an edit here.
 */

function heroOn(path: MasteryPath, level: number, nodes: Record<string, number> = {}): Hero {
  return {
    id: 'h1',
    templateId: 'warrior',
    name: 'Test',
    heroClass: path.heroClass as HeroClass,
    level,
    xp: 0,
    baseStats: { maxHp: 100, attack: 20, defense: 10, magic: 5, speed: 10, moveRange: 3, maxMana: 20 },
    currentHp: 100,
    currentMana: 20,
    skills: [],
    equipment: {},
    masteryPath: path.id,
    masteryPoints: pointsEarnedByLevel(level, path.id),
    masteryNodes: nodes,
  } as Hero;
}

const capstonesOf = (path: MasteryPath) =>
  path.nodes.filter((n) => n.tier === 3 && !isSideNode(n));

/** Every node a node stands on, all the way up. */
function ancestry(path: MasteryPath, node: MasteryNode, seen = new Set<string>()): Set<string> {
  for (const parent of prerequisitesFor(path, node)) {
    if (seen.has(parent.id)) continue;
    seen.add(parent.id);
    ancestry(path, parent, seen);
  }
  return seen;
}

/**
 * Spend every point a hero has, through `canUnlockNode` alone, aiming at one
 * capstone: the advanced rows first, the latest open one first, then that capstone and what it stands on,
 * then anything still open. Whatever comes out is a build the game allowed.
 * `choices` holds the hero to one side tree or shape, the others never bought.
 */
function spendToward(
  path: MasteryPath, capstone: MasteryNode, level: number, choices: readonly MasteryNode[] = [],
): Hero {
  const hero = heroOn(path, level);
  const line = ancestry(path, capstone);
  const rank = (n: MasteryNode) =>
    isAdvancedNode(n) ? 1 - (n.masteryRow ?? 1) : n.id === capstone.id ? 1 : line.has(n.id) ? 2 : 3;
  const refused = (n: MasteryNode) => choices.some((c) =>
    c.id !== n.id && c.exclusiveGroup === n.exclusiveGroup);
  for (;;) {
    const open = path.nodes.filter((n) => !refused(n) && canUnlockNode(hero, n.id).ok);
    if (open.length === 0) return hero;
    open.sort((a, b) => rank(a) - rank(b));
    const pick = open[0];
    hero.masteryNodes = { ...hero.masteryNodes, [pick.id]: (hero.masteryNodes[pick.id] ?? 0) + 1 };
    hero.masteryPoints -= pick.cost;
  }
}

const owned = (hero: Hero, path: MasteryPath) =>
  path.nodes.filter((n) => (hero.masteryNodes[n.id] ?? 0) > 0);

/** The nodes a hero picks one of besides the capstone: one side tree's starter, and a Druid's shape. */
const sideStarters = (path: MasteryPath) => path.nodes.filter((n) => n.exclusiveGroup === 'side');
const shapes = (path: MasteryPath) => path.nodes.filter((n) => n.exclusiveGroup === 'shape');

/** Every combination of those picks, so a rule about a build holds whichever was taken. */
function everyPick(path: MasteryPath): MasteryNode[][] {
  const picks = sideStarters(path).map((side) => [side]);
  return shapes(path).length === 0 ? picks : picks.flatMap((p) => shapes(path).map((shape) => [...p, shape]));
}

/**
 * Every rank a build with one capstone and these picks can ever hold. The
 * prerequisites are walked to their closure with the rival picks out of it, at no
 * budget, so what a hero of level 40 could buy is this or their points, the less.
 */
function legalRoom(path: MasteryPath, capstone: MasteryNode, picks: readonly MasteryNode[]): number {
  const chosen = [capstone, ...picks];
  const rival = (n: MasteryNode) => !!n.exclusiveGroup && !chosen.includes(n);
  const held = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const n of path.nodes) {
      if (held.has(n.id) || rival(n)) continue;
      if (missingPrerequisites(path, n, held).length === 0) {
        held.add(n.id);
        grew = true;
      }
    }
  }
  return path.nodes.filter((n) => held.has(n.id)).reduce((sum, n) => sum + maxLevelOf(n) * n.cost, 0);
}

/** The levels a row opens at and the top of each band, 40 last. */
const LEGAL_BUILD_LEVELS = BALANCE.MASTERY_ROW_LEVELS.flatMap((_, i) => [bandFloor(i + 1), bandTop(i + 1)]);

/** Run a suite with a stub node in a real path, which is how a row with no data yet gets exercised. */
function withStubNode<T>(path: MasteryPath, stub: MasteryNode, run: () => T): T {
  path.nodes.push(stub);
  try {
    return run();
  } finally {
    path.nodes.pop();
  }
}

const stubRowNode = (path: MasteryPath, masteryRow: 2 | 3 | 4): MasteryNode => ({
  id: `${path.id}_stub_row_${masteryRow}`,
  tier: ADVANCED_TIER,
  column: 0,
  cost: 1,
  masteryRow,
  requires: capstonesOf(path).map((c) => c.id),
  requiresCount: 1,
  statBonus: { attack: 1 },
});

/**
 * The paths whose level-26 node is not authored yet: none of the fifteen today. A
 * path with its node may not stay on it, and a new path, the Corsair's among them,
 * either brings its node or goes on it.
 */
const AWAITING_LEVEL_26: string[] = [];

const LEVEL_26_ROW = 2;
const level26Nodes = (path: MasteryPath) =>
  advancedNodes(path).filter((n) => n.masteryRow === LEVEL_26_ROW);

/** Run with the path's level-26 node in the tree: its own, or a stub while it awaits one. */
function withLevel26Node<T>(path: MasteryPath, run: (node: MasteryNode) => T): T {
  const [authored] = level26Nodes(path);
  if (authored) return run(authored);
  const stub = stubRowNode(path, LEVEL_26_ROW);
  return withStubNode(path, stub, () => run(stub));
}

/** Run with the path's level-26 node out of the tree, authored or not. */
function withoutLevel26Node<T>(path: MasteryPath, run: () => T): T {
  const all = path.nodes;
  path.nodes = all.filter((n) => n.masteryRow !== LEVEL_26_ROW);
  try {
    return run();
  } finally {
    path.nodes = all;
  }
}

describe('advanced nodes', () => {
  it('open one row per level band, the first the level after the base cap', () => {
    expect(BALANCE.MASTERY_ROW_LEVELS).toEqual([21, 26, 31, 36]);
    expect(BALANCE.MASTERY_ROW_LEVELS[0]).toBe(BALANCE.MAX_LEVEL + 1);
    BALANCE.MASTERY_ROW_LEVELS.forEach((level, i) => expect(level).toBe(bandFloor(i + 1)));
    expect(BALANCE.MASTERY_ROW_LEVELS[BALANCE.MASTERY_ROW_LEVELS.length - 1]).toBeLessThanOrEqual(highestLevelCap());
  });

  it('read the row a node names, and row 1 when it names none', () => {
    const path = MASTERY_PATHS[0];
    expect(nodeMinLevel(advancedNodes(path)[0])).toBe(21);
    for (const row of [2, 3, 4] as const) {
      expect(nodeMinLevel(stubRowNode(path, row))).toBe(BALANCE.MASTERY_ROW_LEVELS[row - 1]);
    }
    // On any other tier the field means nothing
    expect(nodeMinLevel({ ...path.nodes[0], masteryRow: 4 })).toBe(0);
  });

  it.each([2, 3, 4] as const)('hold a node of row %i shut until its own level, even with row 1 open', (row) => {
    const path = findMasteryPath('bulwark')!;
    const stub = stubRowNode(path, row);
    const opens = BALANCE.MASTERY_ROW_LEVELS[row - 1];
    const capstone = capstonesOf(path)[0];
    const nodes = Object.fromEntries([...ancestry(path, capstone), capstone.id].map((id) => [id, 1]));
    withStubNode(path, stub, () => {
      const below = heroOn(path, opens - 1, nodes);
      below.masteryPoints = 10;
      expect(canUnlockNode(below, stub.id)).toEqual({ ok: false, reason: 'level-too-low', level: opens });
      expect(canUnlockNode(below, advancedNodes(path)[0].id).ok).toBe(true);
      const at = heroOn(path, opens, nodes);
      at.masteryPoints = 10;
      expect(canUnlockNode(at, stub.id).ok).toBe(true);
    });
  });

  /**
   * The hero's level opens a row, not the world. A party that climbed to 21 in
   * Jadeveil and came home buys its row 1 in the Empire, through the same store
   * action as anywhere, and a campaign's road state changes nothing.
   */
  describe('in the Empire', () => {
    const path = findMasteryPath('bulwark')!;
    const capstone = capstonesOf(path)[0];
    const row1 = advancedNodes(path)[0];
    const nodes = Object.fromEntries([...ancestry(path, capstone), capstone.id].map((id) => [id, 1]));
    const unlockAt = (level: number) => {
      usePartyStore.setState({ heroes: [{ ...heroOn(path, level, nodes), masteryPoints: 5 }] });
      return usePartyStore.getState().unlockMasteryNode('h1', row1.id);
    };

    beforeEach(() => {
      useWorldMapStore.setState({ worldId: 'empire' });
      setLevelCapInputs({ owned: [], emperorDefeated: false, banded: [], finished: [] });
    });
    afterEach(() => usePartyStore.getState().reset());

    it('opens row 1 at hero level 21 and not before, with no world entered', () => {
      expect(useWorldMapStore.getState().worldId).toBe('empire');
      expect(unlockAt(20)).toBe(false);
      expect(usePartyStore.getState().heroes[0].masteryNodes[row1.id]).toBeUndefined();
      expect(unlockAt(21)).toBe(true);
      expect(usePartyStore.getState().heroes[0].masteryNodes[row1.id]).toBe(1);
    });

    it('opens it just the same on Jadeveil’s ground, and no earlier', () => {
      useWorldMapStore.setState({ worldId: 'jadeveil' });
      setLevelCapInputs({ owned: ['jadeveil'], emperorDefeated: true, banded: ['jadeveil'] });
      try {
        expect(unlockAt(20)).toBe(false);
        expect(unlockAt(21)).toBe(true);
      } finally {
        useWorldMapStore.setState({ worldId: 'empire' });
        setLevelCapInputs({ owned: [], emperorDefeated: false, banded: [] });
      }
    });
  });

  it('hold every path that has no level-26 node on the awaiting list, and only those', () => {
    const without = MASTERY_PATHS.filter((p) => level26Nodes(p).length === 0).map((p) => p.id);
    expect([...without].sort()).toEqual([...AWAITING_LEVEL_26].sort());
    for (const path of MASTERY_PATHS) {
      expect(level26Nodes(path).length).toBeLessThanOrEqual(1);
      expect(path.nodes.filter((n) => n.id.includes('stub'))).toEqual([]);
    }
  });

  /**
   * The level-26 node of every path, real or stubbed: the one gate the row adds,
   * the builds below it untouched, and the 25 points of the band top still
   * spendable with exactly one capstone.
   */
  describe.each(MASTERY_PATHS.map((p) => [p.id, p] as const))('with the level-26 node of %s', (_id, path) => {
    const capstones = capstonesOf(path);
    const line = (capstone: MasteryNode) =>
      Object.fromEntries([...ancestry(path, capstone), capstone.id].map((id) => [id, 1]));
    /** What a hero of this level ends up with, every capstone by every pick. */
    const builds = (level: number) => capstones.flatMap((capstone) =>
      everyPick(path).map((picks) => spendToward(path, capstone, level, picks).masteryNodes));

    it('stands past any capstone, in row 2, one point a rank', () => {
      withLevel26Node(path, (node) => {
        expect(node.tier).toBe(ADVANCED_TIER);
        expect(node.cost).toBe(1);
        expect(nodeMinLevel(node)).toBe(26);
        expect(requiredPrerequisiteCount(path, node)).toBe(1);
        expect(prerequisitesFor(path, node).map((p) => p.id).sort()).toEqual(capstones.map((c) => c.id).sort());
        expect(maxLevelOf(node)).toBeLessThanOrEqual(NODE_MAX_LEVEL);
      });
    });

    it.each(capstones.map((c) => [c.id, c] as const))('is shut at 25 and open at 26 behind %s', (_c, capstone) => {
      withLevel26Node(path, (node) => {
        const at25 = heroOn(path, 25, line(capstone));
        expect(canUnlockNode(at25, node.id)).toEqual({ ok: false, reason: 'level-too-low', level: 26 });
        expect(canUnlockNode(heroOn(path, 26, line(capstone)), node.id).ok).toBe(true);
        // ...and a level is not a capstone
        expect(canUnlockNode(heroOn(path, 26), node.id)).toMatchObject({ ok: false, reason: 'missing-prerequisite' });
      });
    });

    it.each([20, 25])('changes no level-%i build', (level) => {
      const before = withoutLevel26Node(path, () => builds(level));
      const after = withLevel26Node(path, () => builds(level));
      expect(after).toEqual(before);
    });

    it.each([26, 30])('spends every point at level %i with it and exactly one capstone', (level) => {
      withLevel26Node(path, (node) => {
        for (const capstone of capstones) {
          for (const picks of everyPick(path)) {
            const hero = spendToward(path, capstone, level, picks);
            const got = owned(hero, path);
            expect(hero.masteryPoints).toBe(0);
            expect(got).toContain(node);
            expect(got.filter((n) => capstones.includes(n)).map((n) => n.id)).toEqual([capstone.id]);
            expect(got.filter((n) => n.exclusiveGroup === 'side').length).toBeLessThanOrEqual(1);
            expect(got.filter((n) => n.exclusiveGroup === 'shape').length).toBeLessThanOrEqual(1);
            expect(legalRoom(path, capstone, picks)).toBeGreaterThanOrEqual(pointsEarnedByLevel(level, path.id));
          }
        }
      });
    });
  });

  describe('through the store', () => {
    const path = findMasteryPath('bulwark')!;
    const capstone = capstonesOf(path)[0];
    const nodes = Object.fromEntries([...ancestry(path, capstone), capstone.id].map((id) => [id, 1]));
    afterEach(() => usePartyStore.getState().reset());

    it('a level-25 hero cannot buy the level-26 node, and a level-26 hero can', () => {
      withLevel26Node(path, (node) => {
        const unlockAt = (level: number) => {
          usePartyStore.setState({ heroes: [{ ...heroOn(path, level, nodes), masteryPoints: 5 }] });
          return usePartyStore.getState().unlockMasteryNode('h1', node.id);
        };
        expect(unlockAt(25)).toBe(false);
        expect(usePartyStore.getState().heroes[0].masteryNodes[node.id]).toBeUndefined();
        expect(unlockAt(26)).toBe(true);
        expect(usePartyStore.getState().heroes[0].masteryNodes[node.id]).toBe(1);
      });
    });
  });

  describe.each(MASTERY_PATHS.map((p) => [p.id, p] as const))('%s', (_id, path) => {
    const advanced = advancedNodes(path);
    const capstones = capstonesOf(path);
    const rowOf = (row: number) => advanced.filter((n) => (n.masteryRow ?? 1) === row);

    // Row by row: the level-26 node each path gets is a row of its own
    it('has two or three level-21 nodes, each one point a rank', () => {
      expect(rowOf(1).length).toBeGreaterThanOrEqual(2);
      expect(rowOf(1).length).toBeLessThanOrEqual(3);
      for (const n of advanced) {
        expect(n.tier).toBe(ADVANCED_TIER);
        expect(n.cost).toBe(1);
        expect(n.sideTree).toBeUndefined();
        expect(BALANCE.MASTERY_ROW_LEVELS[(n.masteryRow ?? 1) - 1]).toBeDefined();
      }
      BALANCE.MASTERY_ROW_LEVELS.forEach((_, i) => {
        const row = rowOf(i + 1);
        expect(new Set(row.map((n) => n.column)).size).toBe(row.length);
      });
    });

    it('names a row only on an advanced node', () => {
      expect(path.nodes.filter((n) => !isAdvancedNode(n) && n.masteryRow !== undefined)).toEqual([]);
    });

    // A derived parent pair under a capstone would be two capstones, which no
    // hero can hold; so each names its parents, and they are capstones (or an
    // advanced node that is itself behind one)
    it('stands behind a capstone and nothing else', () => {
      for (const n of advanced) {
        expect(n.requires?.length).toBeGreaterThan(0);
        const parents = prerequisitesFor(path, n);
        expect(parents).toHaveLength(n.requires!.length);
        expect(parents.every((p) => capstones.includes(p) || isAdvancedNode(p))).toBe(true);
        expect([...ancestry(path, n)].some((id) => capstones.some((c) => c.id === id))).toBe(true);
      }
    });

    it('opens no second capstone, side tree or shape', () => {
      for (const n of advanced) {
        expect(['capstone', 'side', 'shape']).not.toContain(n.exclusiveGroup);
      }
      // And nothing that was there at level 20 leans on the new row
      for (const n of path.nodes.filter((x) => !isAdvancedNode(x))) {
        expect(prerequisitesFor(path, n).some(isAdvancedNode)).toBe(false);
      }
    });

    it('is closed below its row’s level, even with a capstone and points to spare', () => {
      const capstone = capstones[0];
      const nodes = Object.fromEntries([...ancestry(path, capstone), capstone.id].map((id) => [id, 1]));
      for (const n of advanced) {
        const below = heroOn(path, nodeMinLevel(n) - 1, nodes);
        below.masteryPoints = 10;
        expect(canUnlockNode(below, n.id)).toMatchObject({
          ok: false, reason: 'level-too-low', level: nodeMinLevel(n),
        });
      }
      const at = heroOn(path, BALANCE.MASTERY_ROW_LEVELS[0], nodes);
      at.masteryPoints = 10;
      expect(advanced.some((n) => canUnlockNode(at, n.id).ok)).toBe(true);
      // ...and closed at 21 without one
      const bare = heroOn(path, highestLevelCap());
      for (const n of advanced) {
        expect(canUnlockNode(bare, n.id)).toMatchObject({ ok: false, reason: 'missing-prerequisite' });
      }
    });

    // A level-20 build is what every campaign without the expansion plays, and
    // the advanced row must not change a point of it
    it.each(capstones.map((c) => [c.id, c] as const))(
      'still spends all 15 points at level 20 toward %s, without the advanced row',
      (_c, capstone) => {
        const hero = spendToward(path, capstone, BALANCE.MAX_LEVEL);
        const got = owned(hero, path);
        expect(hero.masteryPoints).toBe(0);
        expect(got.some(isAdvancedNode)).toBe(false);
        expect(got.filter((n) => capstones.includes(n)).map((n) => n.id)).toEqual([capstone.id]);
      },
    );

    // Every row level and band top, every capstone, and whichever side tree and
    // shape was picked: the table in `quests-progression-items.md` states the room left
    describe.each(LEGAL_BUILD_LEVELS)('at level %i', (level) => {
      it.each(capstones.map((c) => [c.id, c] as const))(
        'spends every point toward %s with exactly one capstone, whatever else was picked',
        (_c, capstone) => {
          for (const picks of everyPick(path)) {
            const hero = spendToward(path, capstone, level, picks);
            const got = owned(hero, path);
            expect(hero.masteryPoints).toBe(0);
            expect(got.filter((n) => capstones.includes(n)).map((n) => n.id)).toEqual([capstone.id]);
            expect(got.filter((n) => n.exclusiveGroup === 'side').length).toBeLessThanOrEqual(1);
            expect(got.filter((n) => n.exclusiveGroup === 'shape').length).toBeLessThanOrEqual(1);
            expect(got.some(isAdvancedNode)).toBe(true);
            expect(got.every((n) => nodeMinLevel(n) <= level)).toBe(true);
          }
        },
      );

      it('leaves room in the legal tree for more points than it earns', () => {
        for (const capstone of capstones) {
          for (const picks of everyPick(path)) {
            const room = legalRoom(path, capstone, picks);
            expect(room).toBeGreaterThanOrEqual(pointsEarnedByLevel(level, path.id));
          }
        }
      });
    });
  });
});
