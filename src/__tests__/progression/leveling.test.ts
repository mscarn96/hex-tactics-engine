import { xpToNextLevel, totalXpToLevel, isMaxLevel, calculateStatsForLevel } from '@/systems/progression/leveling';
import { BALANCE } from '@/data/balanceConstants';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { HeroTemplate, HeroClass } from '@/models/types';
import { highestLevelCap, setLevelCapInputs } from '@/data/levelCap';
import type { WorldId } from '@/data/worlds';
import { pointsEarnedByLevel } from '@/systems/progression/mastery';
import { bandFloor } from '@/systems/world/worldBands';
import { usePartyStore } from '@/stores/partyStore';

const template: HeroTemplate = {
  id: 'warrior',
  heroClass: HeroClass.Warrior,
  baseStats: { maxHp: 120, attack: 14, defense: 12, magic: 4, speed: 8, moveRange: 3, maxMana: 40 },
  statGrowth: { maxHp: 15, attack: 3, defense: 2, magic: 1, speed: 1, moveRange: 0, maxMana: 5 },
  skills: [],
};

describe('xp curve', () => {
  it('grows super-linearly so late levels stay meaningful', () => {
    const d1 = xpToNextLevel(2) - xpToNextLevel(1);
    const d2 = xpToNextLevel(19) - xpToNextLevel(18);
    expect(d2).toBeGreaterThan(d1);
  });

  it('is strictly increasing across the whole span', () => {
    for (let l = 1; l < BALANCE.MAX_LEVEL; l++) {
      expect(xpToNextLevel(l + 1)).toBeGreaterThan(xpToNextLevel(l));
    }
  });

  it('totalXpToLevel accumulates each step', () => {
    expect(totalXpToLevel(1)).toBe(0);
    expect(totalXpToLevel(2)).toBe(xpToNextLevel(1));
    expect(totalXpToLevel(4)).toBe(xpToNextLevel(1) + xpToNextLevel(2) + xpToNextLevel(3));
  });

  it('reaches cap in a sane total (guards against a runaway curve)', () => {
    const total = totalXpToLevel(BALANCE.MAX_LEVEL);
    expect(total).toBeGreaterThan(5000);
    expect(total).toBeLessThan(12000);
  });
});

describe('level cap', () => {
  it('is 20', () => {
    expect(BALANCE.MAX_LEVEL).toBe(20);
  });

  it('isMaxLevel tracks the constant rather than a literal', () => {
    expect(isMaxLevel(BALANCE.MAX_LEVEL - 1)).toBe(false);
    expect(isMaxLevel(BALANCE.MAX_LEVEL)).toBe(true);
    expect(isMaxLevel(BALANCE.MAX_LEVEL + 1)).toBe(true);
  });
});

describe('calculateStatsForLevel', () => {
  /**
   * The load-bearing one, and the reason `HERO_GROWTH_SCALE` touches growth and
   * not base stats: level 1 is the body every opening-hour measurement in
   * `homeRing.test.ts` was taken against, so a growth boost must be invisible
   * here or the whole early curve moves with it.
   */
  it('returns base stats at level 1, untouched by the growth scale', () => {
    expect(calculateStatsForLevel(template, 1)).toEqual(template.baseStats);
  });

  /**
   * Derived from the constant rather than pinned to a number, so retuning the
   * boost is a one-line change in `balanceConstants` — but *removing* it, or
   * applying it to the base as well, still fails here.
   */
  it('applies scaled growth per level gained, all the way to the cap', () => {
    const at20 = calculateStatsForLevel(template, 20);
    const S = BALANCE.HERO_GROWTH_SCALE;
    expect(at20.maxHp).toBe(Math.round(120 + 15 * 19 * S.maxHp));
    expect(at20.attack).toBe(Math.round(14 + 3 * 19 * S.attack));
    // moveRange has zero growth — it must not drift with the cap or the scale
    expect(at20.moveRange).toBe(3);
  });

  /**
   * The scale's shape, pinned separately from the formula above.
   *
   * Health and defence must outrun offence, because that is the whole reason the
   * knob is per-stat rather than one number: over levels 1→20 offence multiplied
   * ×5.07–5.75 against health's ×3.17–3.38, and a uniform factor preserves that
   * ratio exactly instead of closing it. A future retune that flattens these back
   * to one value would silently undo it.
   */
  it('weights survivability above offence', () => {
    const S = BALANCE.HERO_GROWTH_SCALE;
    expect(S.maxHp).toBeGreaterThan(S.attack);
    expect(S.maxHp).toBeGreaterThan(S.magic);
    expect(S.defense).toBeGreaterThan(S.attack);
    // A hex count is not a number to be multiplied.
    expect(S.moveRange).toBe(1);
  });

  /**
   * Rounding happens on the finished stat, not on the per-level step.
   *
   * A growth of 1 at ×1.1 rounds straight back to 1 per step, so a stepwise
   * round would silently drop the boost from every low-growth stat in the game —
   * which is most of `attack` and all of `defense` outside the Champion.
   */
  it('rounds the total rather than the step, so small growth still moves', () => {
    const mage = heroTemplates.find((t) => t.id === 'mage')!;
    const at20 = calculateStatsForLevel(mage, 20);
    // defense growth is 1/level; 19 levels at ×1.4 is 26.6, not 19.
    expect(at20.defense).toBe(Math.round(5 + 1 * 19 * BALANCE.HERO_GROWTH_SCALE.defense));
    expect(at20.defense).toBeGreaterThan(5 + 19);
  });
});

/**
 * Past the base cap nothing changes shape: the curve and the growth run on to the
 * highest cap, so a level earned in any world is worth what its number says.
 */
describe('levels 21 to 40', () => {
  const LEVELS = Array.from({ length: highestLevelCap() }, (_, i) => i + 1);

  it('keeps the XP curve’s formula and growth all the way up', () => {
    expect(highestLevelCap()).toBe(40);
    for (const level of LEVELS.slice(0, -1)) {
      expect(xpToNextLevel(level)).toBe(BALANCE.XP_LINEAR * level + BALANCE.XP_QUADRATIC * level * level);
      expect(xpToNextLevel(level + 1)).toBeGreaterThan(xpToNextLevel(level));
      expect(totalXpToLevel(level + 1)).toBe(totalXpToLevel(level) + xpToNextLevel(level));
    }
  });

  // The figures the plan derives each band's reward scale from
  it('prices each band’s five levels as the worlds plan says', () => {
    const climb = (band: number) => totalXpToLevel(bandFloor(band) + BALANCE.EXPANSION_LEVELS) - totalXpToLevel(bandFloor(band));
    // Its sums run from each floor for five steps, which at band 4 counts the step past 40 no hero pays
    expect([1, 2, 3, 4].map(climb)).toEqual([7035, 9960, 13385, 17310]);
  });

  it.each(heroTemplates.map((t) => [t.id, t] as const))('grows %s by the same rule at every level', (_id, hero) => {
    const S = BALANCE.HERO_GROWTH_SCALE;
    for (const level of LEVELS) {
      const stats = calculateStatsForLevel(hero, level);
      const gained = level - 1;
      expect(stats.maxHp).toBe(Math.round(hero.baseStats.maxHp + hero.statGrowth.maxHp * gained * S.maxHp));
      expect(stats.attack).toBe(Math.round(hero.baseStats.attack + hero.statGrowth.attack * gained * S.attack));
      expect(stats.defense).toBe(Math.round(hero.baseStats.defense + hero.statGrowth.defense * gained * S.defense));
      expect(stats.magic).toBe(Math.round(hero.baseStats.magic + hero.statGrowth.magic * gained * S.magic));
      expect(stats.speed).toBe(Math.round(hero.baseStats.speed + hero.statGrowth.speed * gained * S.speed));
      expect(stats.moveRange).toBe(hero.baseStats.moveRange + hero.statGrowth.moveRange * gained * S.moveRange);
    }
    expect(calculateStatsForLevel(hero, 40).maxHp).toBeGreaterThan(calculateStatsForLevel(hero, 25).maxHp);
  });

  it('carries a real hero to 40 on XP alone, at the stats and points the curve states', () => {
    const worlds = ['a', 'b', 'c', 'd'] as unknown as WorldId[];
    setLevelCapInputs({ owned: worlds, emperorDefeated: true, finished: worlds });
    try {
      usePartyStore.getState().reset();
      usePartyStore.getState().addHero('warrior');
      const id = usePartyStore.getState().heroes[0].id;
      usePartyStore.getState().gainXp(id, totalXpToLevel(40) - 1, 1);
      expect(usePartyStore.getState().heroes[0].level).toBe(39);
      usePartyStore.getState().gainXp(id, 1, 1);
      const hero = usePartyStore.getState().heroes[0];
      expect(hero.level).toBe(40);
      expect(hero.xp).toBe(0);
      expect(hero.baseStats).toEqual(calculateStatsForLevel(heroTemplates.find((t) => t.id === 'warrior')!, 40));
      expect(hero.masteryPoints).toBe(pointsEarnedByLevel(40));
      expect(pointsEarnedByLevel(40)).toBe(35);
    } finally {
      usePartyStore.getState().reset();
      setLevelCapInputs({ owned: [], emperorDefeated: false, finished: [] });
    }
  });
});
