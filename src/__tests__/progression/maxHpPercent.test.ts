import { Hero, HeroClass, Item, MasteryModifier, Rarity } from '@/models/types';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { useInventoryStore } from '@/stores/inventoryStore';
import { getEffectiveStats, heroMaxHp } from '@/systems/progression/statCalc';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import * as mastery from '@/systems/progression/mastery';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { templateName } from '@/data/templates/unitText';

/**
 * The one percentage in a hero's sheet, and the only thing about it that
 * matters is *when* it lands.
 *
 * D3 orders the sheet `baseStats → mastery nodes → equipment`, and
 * `statCalc` explains the order the way round it was written for: flat mastery
 * bonuses come before items so a percentage *item* modifier would scale the
 * investment. `maxHpPercentBonus` is that rule from the other side — a
 * percentage *mastery* modifier has to land after every flat source, or the
 * node is worth less the better the hero's gear, which is the opposite of what
 * a tank node says on the tin.
 *
 * The bonus is driven through a stub rather than through a tree, because which
 * node grants it is a data question that will move; where in the pipeline it is
 * read is not.
 */

const TEMPLATE = heroTemplates[0];
const GEAR_HP = 40;

const AMULET: Item = {
  id: 'amulet-of-vigour',
  slot: 'neck',
  rarity: Rarity.Rare,
  modifiers: { maxHp: GEAR_HP },
  sellPrice: 10,
} as Item;

function gearedHero(): Hero {
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
  };
}

const withModifiers = (mods: MasteryModifier) =>
  jest.spyOn(mastery, 'masteryModifiers').mockReturnValue(mods);

beforeEach(() => {
  useInventoryStore.getState().reset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a percentage on max HP', () => {
  it('scales the gear as well as the body', () => {
    const hero = gearedHero();
    const flat = hero.baseStats.maxHp + GEAR_HP;

    withModifiers({ maxHpPercentBonus: 0.2 });
    expect(getEffectiveStats(hero).maxHp).toBe(Math.round(flat * 1.2));
  });

  /**
   * The failure the ordering exists to prevent, stated as a comparison rather
   * than as a number: applied before the amulet, the node would be worth
   * `baseStats × 0.2` and the two figures would differ by the gear's share.
   */
  it('is worth more to a geared hero than the body alone would pay', () => {
    const hero = gearedHero();

    withModifiers({ maxHpPercentBonus: 0.2 });
    const gain = getEffectiveStats(hero).maxHp - (hero.baseStats.maxHp + GEAR_HP);

    expect(gain).toBeGreaterThan(Math.round(hero.baseStats.maxHp * 0.2));
  });

  /**
   * One ceiling, still. `heroMaxHp` is the documented single source of truth
   * for a health bar and `combatMaxHp` scales whatever it reports — so the
   * percentage has to be inside `getEffectiveStats` and nowhere else, or the
   * dawn heal, the write-back and the bar would each cap somewhere different.
   */
  it('is the same number `heroMaxHp` reports', () => {
    const hero = gearedHero();
    withModifiers({ maxHpPercentBonus: 0.2 });
    expect(heroMaxHp(hero)).toBe(getEffectiveStats(hero).maxHp);
  });

  it('leaves every other stat alone', () => {
    const hero = gearedHero();
    const before = getEffectiveStats(hero);

    withModifiers({ maxHpPercentBonus: 0.2 });
    const after = getEffectiveStats(hero);

    expect({ ...after, maxHp: before.maxHp }).toEqual(before);
  });

  it('changes nothing for a hero with no such node', () => {
    const hero = gearedHero();
    const before = getEffectiveStats(hero);
    withModifiers({});
    expect(getEffectiveStats(hero)).toEqual(before);
  });
});

/**
 * Playtest 2026-10-23: a flat few points of Magic from a node was nothing late
 * on, so the trees grant a share of Magic instead, landing after the gear as the
 * health share does.
 */
describe('a percentage on Magic', () => {
  const PENDANT: Item = { ...AMULET, id: 'pendant-of-sparks', modifiers: { maxHp: GEAR_HP, magic: 30 } } as Item;

  it('scales the gear as well as the body, and nothing else', () => {
    const hero = gearedHero();
    hero.equipment = { neck: useInventoryStore.getState().addItem({ ...PENDANT }) };
    const before = getEffectiveStats(hero);

    withModifiers({ magicPercentBonus: 0.1 });
    const after = getEffectiveStats(hero);

    expect(after.magic).toBe(Math.round(before.magic * 1.1));
    expect({ ...after, magic: before.magic }).toEqual(before);
  });

  it('is what the converted nodes grant, at 2% a former flat point', () => {
    const live = MASTERY_PATHS.flatMap((p) => p.nodes).find((n) => n.id === 'storm_live_wire')!;
    expect(live.statBonus?.magic).toBeUndefined();
    expect(live.modifier?.magicPercentBonus).toBeCloseTo(0.1);
  });
});
