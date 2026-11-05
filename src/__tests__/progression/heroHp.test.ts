import { Hero, HeroClass, Item, Rarity } from '@/models/types';
import { usePartyStore } from '@/stores/partyStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { heroMaxHp, heroMaxMana } from '@/systems/progression/statCalc';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { templateName } from '@/data/templates/unitText';

/**
 * The bar a hero fights out of.
 *
 * `baseStats.maxHp` is the body alone — no gear, no mastery nodes — while every
 * fight is run on `getEffectiveStats`. For a long time the two were used
 * interchangeably, so a hero in +HP gear could never reach full: the dawn heal
 * topped them up to the smaller number and the post-fight write-back clipped
 * them to it. This file pins the rule that fixed it — every ceiling is the
 * effective one.
 */

const TEMPLATE = heroTemplates[0];

const AMULET: Item = {
  id: 'amulet-of-vigour',
  slot: 'neck',
  rarity: Rarity.Rare,
  modifiers: { maxHp: 40 },
  sellPrice: 10,
} as Item;

/** A level-5 hero of the first template, wearing one +40 HP amulet. */
function gearedHero(over: Partial<Hero> = {}): Hero {
  const itemId = useInventoryStore.getState().addItem({ ...AMULET });
  const baseStats = calculateStatsForLevel(TEMPLATE, 5);
  return {
    id: 'h1',
    templateId: TEMPLATE.id,
    name: templateName(TEMPLATE.id),
    heroClass: TEMPLATE.heroClass as HeroClass,
    level: 5,
    xp: 0,
    baseStats,
    currentHp: baseStats.maxHp,
    currentMana: baseStats.maxMana,
    skills: [],
    equipment: { neck: itemId },
    masteryPath: null,
    masteryPoints: 0,
    masteryNodes: {},
    ...over,
  };
}

const hero = () => usePartyStore.getState().heroes[0];

beforeEach(() => {
  useInventoryStore.getState().reset();
  usePartyStore.getState().reset();
});

describe('a hero’s real health ceiling', () => {
  it('counts the gear, not just the body', () => {
    const geared = gearedHero();
    expect(heroMaxHp(geared)).toBe(geared.baseStats.maxHp + 40);
  });

  it('lets the dawn heal reach full', () => {
    usePartyStore.setState({ heroes: [gearedHero({ currentHp: 1 })] });
    // Twice over, so the fraction cannot be what falls short
    usePartyStore.getState().healAll(1);
    usePartyStore.getState().healAll(1);
    expect(hero().currentHp).toBe(heroMaxHp(hero()));
  });

  it('does not let the dawn heal revive the fallen', () => {
    usePartyStore.setState({ heroes: [gearedHero({ currentHp: 0 })] });
    usePartyStore.getState().healAll(1);
    expect(hero().currentHp).toBe(0);
  });

  // The ration refusal names the Tavern as a revive; this is what makes that true.
  it('lets a Tavern rest revive the fallen (PT-19)', () => {
    usePartyStore.setState({ heroes: [gearedHero({ currentHp: 0 })] });
    usePartyStore.getState().restAll();
    expect(hero().currentHp).toBe(heroMaxHp(hero()));
  });

  it('does not clip the write-back from a fight', () => {
    usePartyStore.setState({ heroes: [gearedHero({ currentHp: 1 })] });
    const full = heroMaxHp(hero());
    usePartyStore.getState().setHp('h1', full);
    expect(hero().currentHp).toBe(full);
  });

  it('still refuses more than the ceiling, and less than nothing', () => {
    usePartyStore.setState({ heroes: [gearedHero()] });
    const full = heroMaxHp(hero());
    usePartyStore.getState().setHp('h1', full + 500);
    expect(hero().currentHp).toBe(full);
    usePartyStore.getState().setHp('h1', -20);
    expect(hero().currentHp).toBe(0);
  });

  /**
   * A level-up hands over exactly what the ceiling gained. Measured on the
   * effective sheet at both ends: taking the delta from `baseStats` while
   * capping at the effective max would have quietly healed the gear's worth of
   * HP every time a geared hero levelled.
   */
  it('grows the bar by what the level added, no more', () => {
    usePartyStore.setState({ heroes: [gearedHero({ currentHp: 10, xp: 0 })] });
    const before = { hp: hero().currentHp, max: heroMaxHp(hero()) };

    usePartyStore.getState().gainXp('h1', 100000);

    expect(hero().level).toBeGreaterThan(5);
    expect(heroMaxHp(hero())).toBeGreaterThan(before.max);
    expect(hero().currentHp).toBe(before.hp + (heroMaxHp(hero()) - before.max));
  });

  it('starts a recruit at full, gear included', () => {
    usePartyStore.getState().addHero(TEMPLATE.id);
    const recruit = hero();
    expect(recruit.currentHp).toBe(heroMaxHp(recruit));
    expect(recruit.currentMana).toBe(heroMaxMana(recruit));
  });
});
