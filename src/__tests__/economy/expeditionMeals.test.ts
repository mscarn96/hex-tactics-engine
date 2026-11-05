import { dawnNotice, validMeal, mealDawnHeal, mealRationFraction, mealTier, mealPrice, mealLootAmount, mealRarityLuck } from '@/systems/economy/expeditionMeals';
import { useCalendarStore } from '@/stores/calendarStore';
import { useCityStore } from '@/stores/cityStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { usePartyStore } from '@/stores/partyStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { BuildingType, ResourceType, Rarity } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { eatRation } from '@/systems/economy/rations';
import { heroMaxHp } from '@/systems/progression/statCalc';
import { rollRandomItem, rollLoot } from '@/systems/economy/lootGenerator';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { createRNG } from '@/utils/rng';

const hours = BALANCE.HOURS_PER_DAY * BALANCE.DAYS_PER_WEEK;
const upgrade = (level: number) => useCityStore.setState(s => ({ buildings: s.buildings.map(b => b.type === BuildingType.Tavern ? { ...b, level } : b) }));
beforeEach(() => {
  useCityStore.getState().reset(); useCalendarStore.getState().reset();
  useInventoryStore.getState().reset(); usePartyStore.getState().reset();
  useInventoryStore.getState().addResource(ResourceType.Gold, 10000);
  usePartyStore.getState().addHero('warrior');
});

describe('expedition meals', () => {
  it('validates the purchased save shape without guessing missing fields', () => {
    expect(validMeal(null)).toBe(true);
    expect(validMeal({tier:2,week:1})).toBe(true);
    for (const value of [undefined, {}, {tier:4,week:1}, {tier:1,week:0}, {tier:1.5,week:1}, {tier:1,week:'1'}]) expect(validMeal(value)).toBe(false);
  });
  it('adds cumulative effects without backdating later building upgrades', () => {
    expect(mealDawnHeal(1)).toBeGreaterThan(mealDawnHeal(0));
    expect(mealDawnHeal(3)).toBe(mealDawnHeal(1));
    expect(mealRationFraction(1)).toBe(BALANCE.RATION_HEAL_FRACTION);
    expect(mealRationFraction(2)).toBe(1); expect(mealRationFraction(3)).toBe(1);
    expect(mealRarityLuck(2)).toBe(0); expect(mealRarityLuck(3)).toBeGreaterThan(0);
    expect(useCityStore.getState().buyMeal(1)).toBe(false);
    upgrade(1); expect(useCityStore.getState().buyMeal(1)).toBe(true);
    upgrade(3); expect(mealTier(useCityStore.getState().meal, 1)).toBe(1);
    const gold = useInventoryStore.getState().resources.gold;
    expect(useCityStore.getState().buyMeal(1)).toBe(true);
    expect(gold - useInventoryStore.getState().resources.gold).toBe(mealPrice(3,1,0));
    const stamp = useCityStore.getState().meal;
    expect(useCityStore.getState().buyMeal(1)).toBe(false);
    expect(useCityStore.getState().meal).toBe(stamp);
    expect(stamp?.week).toBe(1);
  });
  it('prices every remaining hour monotonically with a positive floor and party scaling', () => {
    for (const tier of [1,2,3]) {
      const prices = Array.from({length: hours}, (_, hour) => mealPrice(tier, 12, hour));
      expect(prices.every((p,i) => p > 0 && (i === 0 || p <= prices[i-1]))).toBe(true);
      expect(prices.at(-1)).toBeLessThan(prices[0]);
      expect(mealPrice(tier, 20, 0)).toBeGreaterThan(mealPrice(tier, 2, 0));
    }
  });
  it('heals living heroes at dawn, expires through normal rollover, and never revives', () => {
    const hero = usePartyStore.getState().heroes[0];
    usePartyStore.getState().addHero('mage');
    const other = usePartyStore.getState().heroes[1];
    usePartyStore.getState().setHp(hero.id, 1); usePartyStore.getState().setHp(other.id, 0);
    upgrade(2); useCityStore.getState().buyMeal(2);
    useWorldMapStore.getState().moveParty({q:0,r:0}, BALANCE.HOURS_PER_DAY);
    expect(usePartyStore.getState().heroes[0].currentHp).toBe(Math.ceil(1 + heroMaxHp(hero) * mealDawnHeal(2)));
    expect(usePartyStore.getState().heroes[1].currentHp).toBe(0);
    const hurt = { ...hero, currentHp: 1, currentMana: 0 };
    expect(eatRation(hurt,1).ok && eatRation(hurt,1)).toEqual({ ok:true, healed:heroMaxHp(hero)-1, currentHp:heroMaxHp(hero) });
    expect(eatRation({ ...hurt, currentHp:0 },1).ok).toBe(false);
    useCalendarStore.getState().loadClock(hours - 1);
    useWorldMapStore.getState().moveParty({q:0,r:0},1);
    expect(mealTier(useCityStore.getState().meal, useCalendarStore.getState().weekNumber)).toBe(0);
    expect(eatRation(hurt,1)).toEqual({ok:true, healed:Math.ceil(heroMaxHp(hero)*BALANCE.RATION_HEAL_FRACTION), currentHp:1+Math.ceil(heroMaxHp(hero)*BALANCE.RATION_HEAL_FRACTION)});
  });
  it('raises seeded ordinary loot slightly and preserves authored boss rewards', () => {
    const ranks = [Rarity.Common,Rarity.Rare,Rarity.Epic,Rarity.Legendary];
    const sample = (tier: number) => {
      const rng = createRNG(42); let rank = 0, resources = 0;
      for (let i=0;i<4000;i++) {
        rank += ranks.indexOf(rollRandomItem(Rarity.Epic,{ rng: () => rng.next(), rarityLuck:mealRarityLuck(tier) })!.rarity);
        resources += mealLootAmount(3,tier,ResourceType.Wood,()=>rng.next());
      }
      return { rank, resources };
    };
    const normal = sample(0), improved = sample(3);
    console.info(JSON.stringify({ mealMeasurement: { seed:42, samples:4000, normal, improved, goldAt100:mealLootAmount(100,3,ResourceType.Gold), pricesAtSummed12:[1,2,3].map(t=>({tier:t,full:mealPrice(t,12,0),lastHour:mealPrice(t,12,hours-1)})) } }));
    expect(improved.rank).toBeGreaterThan(normal.rank);
    expect(improved.resources/normal.resources).toBeGreaterThan(1.08);
    expect(improved.resources/normal.resources).toBeLessThan(1.12);
    expect(mealLootAmount(100,3,ResourceType.Gold)).toBe(110);
    const boss = enemyTemplates.find(e=>e.tier === 'boss' && e.lootTable?.length)!;
    const normalBoss = rollLoot([boss],{rng:()=>0.5});
    const improvedBoss = rollLoot([boss],{rng:()=>0.5,rarityLuck:mealRarityLuck(3)});
    expect(improvedBoss.map(i=>i.templateId)).toEqual(normalBoss.map(i=>i.templateId));
  });
});

it('says what dawn changes in plain words, with the heal the meal actually gives (PT-13)', () => {
  const bare = dawnNotice(4, 0);
  expect(bare).toBe(`Day 4: living heroes heal ${Math.round(BALANCE.DAWN_HEAL_FRACTION * 100)}% HP. Enemies roam to new places.`);
  expect(bare).not.toMatch(/roads are new/);
  expect(dawnNotice(4, 1)).toContain(`${Math.round(BALANCE.EXPEDITION_MEAL_DAWN_HEAL * 100)}% HP`);
  // A toast at phone width: one short line.
  expect(bare.length).toBeLessThanOrEqual(70);
});
