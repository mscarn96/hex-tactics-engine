import { BALANCE } from '@/data/balanceConstants';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { maxLevelOf, nodeStatBonusAt } from '@/systems/progression/mastery';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import { bonusTurnChance } from '@/systems/combat/turnTempo';
import { HeroClass, MasteryNode, MasteryPath } from '@/models/types';
import { makeHero } from '../support/fixtures';
import { masteryNodeDescription } from '@/data/display/masteryText';

/**
 * Speed nodes against the extra-turn curve (`turnTempo.bonusTurnChance`).
 *
 * Speed no longer reorders turns; it earns a chance of a second one that rises from
 * nothing at `TEMPO_MIN_EDGE` over the foes' mean speed to a flat `TEMPO_MAX_CHANCE`
 * at `TEMPO_FULL_EDGE`. That makes two things testable about a flat Speed bonus:
 *
 * - It must not be *dead*: a node that only adds speed to a unit already past the
 *   cap buys nothing, and a Quickened at rank 3 must not be the whole curve by
 *   itself.
 * - It must not be *silly*: no gearless build reaches the cap through the path's
 *   own growth and nodes, so gear is what finishes the climb.
 *
 * Measured the way the fight does: effective hero speed (class growth, path growth,
 * nodes) against the mean base speed of the ordinary enemies scaled by
 * `ENEMY_LEVEL_SCALE` at the same party level.
 */

const SPEED_PATHS = MASTERY_PATHS.filter(
  (p) =>
    (p.heroClass === HeroClass.Mage || p.heroClass === HeroClass.Ranger) &&
    p.nodes.some((n) => n.statBonus?.speed),
);

const foes = enemyTemplates.filter((t) => t.tier === 'normal' && t.baseStats.speed > 0);
const meanFoeBase = foes.reduce((sum, t) => sum + t.baseStats.speed, 0) / foes.length;
const foeSpeed = (level: number) =>
  meanFoeBase * (1 + BALANCE.ENEMY_LEVEL_SCALE * Math.max(0, level - 1));

const LEVELS = Array.from(
  { length: BALANCE.MAX_LEVEL - BALANCE.MASTERY_UNLOCK_LEVEL + 1 },
  (_, i) => BALANCE.MASTERY_UNLOCK_LEVEL + i,
);

const speedNodes = (path: MasteryPath): MasteryNode[] =>
  path.nodes.filter((n) => n.statBonus?.speed);

/** Gearless speed at a level with the given nodes bought at the given rank. */
function speedWith(path: MasteryPath, level: number, nodes: MasteryNode[], rank: 'max' | 'min') {
  const template = heroTemplates.find((t) => t.heroClass === path.heroClass)!;
  const masteryNodes = Object.fromEntries(
    nodes.map((n) => [n.id, rank === 'max' ? maxLevelOf(n) : 1]),
  );
  return getEffectiveStats(
    makeHero({
      level,
      heroClass: path.heroClass,
      baseStats: calculateStatsForLevel(template, level),
      masteryPath: path.id,
      masteryNodes,
    }),
  ).speed;
}

const chanceAt = (speed: number, level: number) => bonusTurnChance(speed / foeSpeed(level) - 1);
const edgeAt = (speed: number, level: number) => speed / foeSpeed(level) - 1;

describe('Speed nodes against the bonus-turn curve', () => {
  it('covers the paths that grant Speed', () => {
    expect(SPEED_PATHS.map((p) => p.id).sort()).toEqual(
      ['marksman', 'shadowblade', 'skirmisher', 'stormcaller'],
    );
  });

  /**
   * A Mage build stays on the ramp outright. A Ranger starts the ramp already (its
   * class is the fast one), so its full build may overshoot the line, but by less
   * than a node's worth: the next test is what keeps each node live beyond it.
   */
  it.each(SPEED_PATHS.map((p) => [p.id, p] as const))(
    '%s: no gearless build overshoots the cap by much, so gear still matters',
    (_id, path) => {
      const slack = path.heroClass === HeroClass.Mage ? 0 : 0.25;
      for (const level of LEVELS) {
        const full = speedWith(path, level, speedNodes(path), 'max');
        expect(edgeAt(full, level)).toBeLessThan(BALANCE.TEMPO_FULL_EDGE + slack);
        expect(chanceAt(full, level)).toBeLessThanOrEqual(BALANCE.TEMPO_MAX_CHANCE);
      }
    },
  );

  it.each(SPEED_PATHS.map((p) => [p.id, p] as const))(
    '%s: every speed node still moves the chance, at every level the path can be played',
    (_id, path) => {
      for (const level of LEVELS) {
        const full = speedWith(path, level, speedNodes(path), 'max');
        for (const node of speedNodes(path)) {
          const without = speedWith(path, level, speedNodes(path).filter((n) => n !== node), 'max');
          // Dropping one node must lower the chance: it is not stacked on a cap
          expect(chanceAt(full, level)).toBeGreaterThan(chanceAt(without, level));
        }
      }
    },
  );

  it.each(SPEED_PATHS.map((p) => [p.id, p] as const))(
    '%s: no single node at its top rank is more than half the curve by itself',
    (_id, path) => {
      for (const node of speedNodes(path)) {
        const bonus = nodeStatBonusAt(node, maxLevelOf(node)).speed ?? 0;
        for (const level of LEVELS) {
          const bare = speedWith(path, level, [], 'min');
          const lift = chanceAt(bare + bonus, level) - chanceAt(bare, level);
          expect(lift).toBeLessThanOrEqual(BALANCE.TEMPO_MAX_CHANCE / 2);
        }
      }
    },
  );

  // The remaster (2026-10) took Quickened out for the Signature node and did not
  // redistribute its Speed; Live Wire, the one Speed node left, went from +3 to +5 so
  // it still moves the chance. The path keeps *a* chance rather than a large one.
  it('the Stormcaller keeps a live chance from Live Wire and still falls short of the cap', () => {
    const storm = MASTERY_PATHS.find((p) => p.id === 'stormcaller')!;
    for (const level of LEVELS) {
      const full = speedWith(storm, level, speedNodes(storm), 'max');
      expect(chanceAt(full, level)).toBeGreaterThan(0);
      expect(chanceAt(full, level)).toBeLessThan(BALANCE.TEMPO_MAX_CHANCE);
    }
  });

  it('every speed node pays something at each rung', () => {
    for (const path of SPEED_PATHS) {
      for (const node of speedNodes(path)) {
        const rungs = [1, 2, 3].map((l) => nodeStatBonusAt(node, l).speed ?? 0);
        expect(rungs[1]).toBeGreaterThan(rungs[0]);
        expect(rungs[2]).toBeGreaterThan(rungs[1]);
      }
    }
  });

  it('no speed node claims to decide who acts first', () => {
    for (const path of SPEED_PATHS) {
      for (const node of speedNodes(path)) {
        expect(masteryNodeDescription(node)).not.toMatch(/\bfirst\b|\balways\b|\binitiative\b/i);
      }
    }
  });
});
