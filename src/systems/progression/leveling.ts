import { HeroTemplate, HeroStats } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { usesChi } from '@/data/classResource';
import { levelCap } from '@/data/levelCap';

export function xpToNextLevel(level: number): number {
  return BALANCE.XP_LINEAR * level + BALANCE.XP_QUADRATIC * level * level;
}

/** Total XP to go from level 1 to `level`. Used by progress UI and tuning. */
export function totalXpToLevel(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpToNextLevel(l);
  return sum;
}

export function isMaxLevel(level: number): boolean {
  return level >= levelCap();
}

/**
 * What the Library multiplies every XP grant by.
 *
 * The building's own description has always read "Provides passive XP bonus to
 * all heroes" and it was never true: the Library was a Study button that charged
 * gold and crystals for a flat lump of XP on one hero, which is neither passive
 * nor to all heroes. `BALANCE.LIBRARY_XP_BONUS_PER_LEVEL` had been sitting in
 * the constants unread the whole time.
 *
 * A multiplier rather than a flat grant, because that is what "passive bonus"
 * means and it is the only shape that stays meaningful across the whole game —
 * a flat +20 is a level in the home ring and a rounding error at the castle.
 */
export function libraryXpMultiplier(libraryLevel: number): number {
  return 1 + BALANCE.LIBRARY_XP_BONUS_PER_LEVEL * libraryLevel;
}

/**
 * One XP grant with the Library's share added.
 *
 * Applied in `partyStore.gainXp` and nowhere else — that is the single funnel
 * every source of XP in the game already goes through (a won fight, a claimed
 * quest), so putting it there is what makes the bonus genuinely passive rather
 * than something each reward site has to remember.
 */
export function xpWithLibrary(amount: number, libraryLevel: number): number {
  return Math.round(amount * libraryXpMultiplier(libraryLevel));
}

/**
 * The body a hero's class and level give them, before path or gear.
 *
 * `BALANCE.HERO_GROWTH_SCALE` weights the **growth** term per stat and the sum
 * is rounded here, which is the whole reason the scale can be a fraction at all:
 * the class tables are small integers, so the boost had nowhere else to live,
 * and an unrounded product would hand a hero 471.5 max HP. Rounding the finished
 * stat rather than the per-level step keeps the curve smooth — rounding the step
 * would quantise a ×1.1 on a growth of 1 straight back to 1 and the boost would
 * silently miss every low-growth stat in the game.
 *
 * Base stats are deliberately outside the scale: level 1 is untouched, so the
 * opening hours stay exactly as `homeRing.test.ts` measures them and the boost
 * arrives as the campaign goes on.
 */
export function calculateStatsForLevel(template: HeroTemplate, level: number): HeroStats {
  const levelsGained = level - 1;
  const grow = (key: keyof HeroStats & keyof typeof BALANCE.HERO_GROWTH_SCALE): number =>
    Math.round(
      template.baseStats[key] +
        template.statGrowth[key] * levelsGained * BALANCE.HERO_GROWTH_SCALE[key],
    );

  return {
    maxHp: grow('maxHp'),
    attack: grow('attack'),
    defense: grow('defense'),
    magic: grow('magic'),
    speed: grow('speed'),
    moveRange: grow('moveRange'),
    // Chi is a fixed pool: the same at level 20 as at level 1. Mastery nodes raise
    // it (`statCalc`); the class and its levels never do.
    maxMana: usesChi(template.heroClass) ? BALANCE.CHI.POOL : grow('maxMana'),
  };
}

/** Snapshot the whole party before distributing an XP batch. */
export function averagePartyLevel(heroes: readonly { level: number }[]): number {
  return heroes.length ? heroes.reduce((sum, h) => sum + h.level, 0) / heroes.length : 0;
}
export function catchupXpMultiplier(level: number, average: number): number {
  const gap = average - level;
  return gap >= BALANCE.CATCHUP_LEVEL_GAP ? 1 + BALANCE.CATCHUP_XP_PER_LEVEL * gap : 1;
}
export function awardedXp(amount: number, level: number, average: number, libraryLevel: number): number {
  return Math.floor(xpWithLibrary(amount, libraryLevel) * catchupXpMultiplier(level, average));
}
