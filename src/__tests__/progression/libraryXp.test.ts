import { BuildingType, Hero, HeroClass } from '@/models/types';
import { usePartyStore } from '@/stores/partyStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { useCityStore } from '@/stores/cityStore';
import {
  calculateStatsForLevel, libraryXpMultiplier, xpWithLibrary,
} from '@/systems/progression/leveling';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { BALANCE } from '@/data/balanceConstants';
import { templateName } from '@/data/templates/unitText';

/**
 * The Library's passive XP bonus.
 *
 * Its description has read "Provides passive XP bonus to all heroes" for as long
 * as the building has existed, and it was never true — the Library was a Study
 * button charging gold and crystals for a flat lump of XP on one hero.
 * `BALANCE.LIBRARY_XP_BONUS_PER_LEVEL` sat in the constants unread the whole
 * time. These pin the rule that made the sentence honest, and pin it at the one
 * place XP is granted rather than at any of the places that grant it.
 */

const TEMPLATE = heroTemplates[0];

/**
 * Level 10, deliberately: `xpToNextLevel(10)` is 350, so the grants below stay
 * well inside one level and `hero().xp` is the grant itself rather than
 * whatever was left over after a level-up ate most of it.
 */
function plainHero(): Hero {
  const baseStats = calculateStatsForLevel(TEMPLATE, 10);
  return {
    id: 'h1',
    templateId: TEMPLATE.id,
    name: templateName(TEMPLATE.id),
    heroClass: TEMPLATE.heroClass as HeroClass,
    level: 10,
    xp: 0,
    baseStats,
    currentHp: baseStats.maxHp,
    currentMana: baseStats.maxMana,
    skills: [],
    equipment: {},
    masteryPath: null,
    masteryPoints: 0,
    masteryNodes: {},
  };
}

const hero = () => usePartyStore.getState().heroes[0];

function setLibrary(level: number) {
  useCityStore.setState({
    buildings: useCityStore.getState().buildings.map((b) =>
      b.type === BuildingType.Library ? { ...b, level } : b),
  });
}

beforeEach(() => {
  useInventoryStore.getState().reset();
  usePartyStore.getState().reset();
  useCityStore.getState().reset();
  usePartyStore.setState({ heroes: [plainHero()] });
});

describe('the library as a rule', () => {
  it('is nothing at all until the building is built', () => {
    expect(libraryXpMultiplier(0)).toBe(1);
    expect(xpWithLibrary(100, 0)).toBe(100);
  });

  it('pays a percentage per level, not a flat lump', () => {
    // A percentage is the only shape that stays meaningful across the whole
    // game — a flat +20 is a level in the home ring and nothing at the castle
    expect(libraryXpMultiplier(3)).toBeCloseTo(1 + BALANCE.LIBRARY_XP_BONUS_PER_LEVEL * 3);
    expect(xpWithLibrary(200, 3)).toBeGreaterThan(xpWithLibrary(100, 3) * 2 - 1);
  });

  it('grows with every level', () => {
    const byLevel = [0, 1, 2, 3].map((l) => xpWithLibrary(100, l));
    expect(byLevel).toEqual([...byLevel].sort((a, b) => a - b));
    expect(new Set(byLevel).size).toBe(byLevel.length);
  });
});

describe('the bonus where XP is actually granted', () => {
  /**
   * `gainXp` is the single funnel every source of XP already goes through — a
   * won fight, a claimed quest. Applying it there is what makes the bonus
   * genuinely passive rather than something each reward site has to remember.
   */
  it('lands on a grant without the caller knowing', () => {
    setLibrary(2);
    usePartyStore.getState().gainXp('h1', 100);
    expect(hero().level).toBe(10);
    expect(hero().xp).toBe(xpWithLibrary(100, 2));
    expect(hero().xp).toBeGreaterThan(100);
  });

  it('leaves a grant alone at level 0', () => {
    usePartyStore.getState().gainXp('h1', 100);
    expect(hero().xp).toBe(100);
  });

  /** Applied once per grant. Twice would be a bonus that compounds on itself. */
  it('does not stack with itself across grants', () => {
    setLibrary(1);
    usePartyStore.getState().gainXp('h1', 50);
    usePartyStore.getState().gainXp('h1', 50);
    expect(hero().xp).toBe(xpWithLibrary(50, 1) * 2);
  });
});
