import { BALANCE } from '@/data/balanceConstants';
import { VILLAGE_THEMES, type VillageTheme } from '@/data/villages';
import { ResourceType, Rarity, POIType } from '@/models/types';
import { useCalendarStore } from '@/stores/calendarStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { useVillageStore, villageBuffIdNow, villageBuffNow } from '@/stores/villageStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { useCityStore } from '@/stores/cityStore';
import {
  VILLAGE_BUFF_IDS, VILLAGE_BUFF_PAIRS, VILLAGE_CYCLE_OFFSET, activeBuff, buffHoursLeft,
  buffPrice, buffVillage, nextWeekBuff, takeBuff, validVillageBuff, weeklyBuff,
} from '@/systems/economy/villageBuffs';
import { buffEffect, buffName, leftText } from '@/systems/economy/villageBuffText';
import { LOOKOUT_STOCK, lookoutPrice, villageRackSize, villageStock, weeklySwaps } from '@/systems/economy/villageShop';
import { liberate, setVillageBuffGrant } from '@/systems/world/villageGarrison';
import { t } from '@/i18n';

/**
 * Village buffs: the rotation, the one held at a time and the weekly racks; what
 * each buff does is `villageBuffEffects.test.ts`. Every number is a first guess recorded as "verify in playtest";
 * these pin the rules.
 */
const HOURS = BALANCE.VILLAGE_BUFF_HOURS;

beforeEach(() => {
  useCalendarStore.getState().reset();
  useInventoryStore.getState().reset();
  useVillageStore.getState().reset();
  useCityStore.getState().reset();
  useWorldMapStore.getState().reset();
});

describe('the weekly rotation', () => {
  it.each(VILLAGE_THEMES)('%s offers its two buffs strictly alternating', (theme) => {
    const [a, b] = VILLAGE_BUFF_PAIRS[theme];
    let prev = weeklyBuff(theme, 1);
    for (let week = 2; week <= 12; week++) {
      const now = weeklyBuff(theme, week);
      expect([a, b]).toContain(now);
      expect(now).not.toBe(prev);
      prev = now;
    }
  });

  it('starts each village on its own offset, so neighbours rarely line up', () => {
    const starts = VILLAGE_THEMES.map((theme) => weeklyBuff(theme, 1) === VILLAGE_BUFF_PAIRS[theme][0]);
    expect(new Set(starts).size).toBe(2);
    for (const theme of VILLAGE_THEMES) {
      expect(weeklyBuff(theme, 1)).toBe(VILLAGE_BUFF_PAIRS[theme][(1 + VILLAGE_CYCLE_OFFSET[theme]) % 2]);
    }
  });

  it('knows next week\'s buff from the same rule', () => {
    for (const theme of VILLAGE_THEMES) {
      for (let week = 1; week <= 6; week++) expect(nextWeekBuff(theme, week)).toBe(weeklyBuff(theme, week + 1));
    }
  });

  it('gives each buff to exactly one village, and every buff a name and a sentence in both languages', () => {
    expect(new Set(VILLAGE_THEMES.flatMap((th) => VILLAGE_BUFF_PAIRS[th]))).toEqual(new Set(VILLAGE_BUFF_IDS));
    for (const buff of VILLAGE_BUFF_IDS) {
      expect(VILLAGE_BUFF_PAIRS[buffVillage(buff)]).toContain(buff);
      expect(buffName(buff)).not.toMatch(/^villages\./);
      expect(buffEffect(buff)).not.toMatch(/^villages\.|\{/);
    }
  });

  it('prices every buff in materials, the strongest in crystal, and never in gold', () => {
    for (const buff of VILLAGE_BUFF_IDS) {
      const price = buffPrice(buff);
      expect(Object.keys(price).length).toBeGreaterThan(0);
      expect(price[ResourceType.Gold]).toBeUndefined();
    }
    expect(buffPrice('smithy_power')[ResourceType.Crystal]).toBeGreaterThan(0);
  });
});

describe('the held buff', () => {
  it('runs 168 full hours from purchase and ends exactly at the end hour', () => {
    const held = takeBuff('smithy', 'smithy_armor', 100);
    expect(held.untilHour).toBe(100 + HOURS);
    expect(HOURS).toBe(7 * 24);
    expect(activeBuff(held, 100)).toBe(held);
    expect(activeBuff(held, 100 + HOURS - 1)).toBe(held);
    expect(activeBuff(held, 100 + HOURS)).toBeNull();
    expect(buffHoursLeft(held, 100 + 24)).toBe(HOURS - 24);
    expect(buffHoursLeft(held, 100 + HOURS + 5)).toBe(0);
    expect(leftText(30)).toBeTruthy();
  });

  it('is bought with materials and held one at a time, a new purchase replacing it', () => {
    const inv = useInventoryStore.getState();
    inv.addResource(ResourceType.Iron, 50);
    inv.addResource(ResourceType.Stone, 50);
    inv.addResource(ResourceType.Crystal, 5);
    const clock = useCalendarStore.getState();
    const first = weeklyBuff('smithy', clock.weekNumber);
    const before = { ...useInventoryStore.getState().resources };
    expect(useVillageStore.getState().buyBuff('smithy')).toBe(true);
    const price = buffPrice(first);
    for (const [type, amount] of Object.entries(price) as [ResourceType, number][]) {
      expect(before[type] - useInventoryStore.getState().resources[type]).toBe(amount);
    }
    expect(villageBuffIdNow()).toBe(first);
    expect(useVillageStore.getState().buff?.untilHour).toBe(clock.totalHours + HOURS);

    // A second village's buff replaces it: one at a time
    expect(useVillageStore.getState().buyBuff('shrine')).toBe(true);
    expect(useVillageStore.getState().buff?.village).toBe('shrine');
    expect(villageBuffIdNow()).toBe(weeklyBuff('shrine', clock.weekNumber));
  });

  it('refuses a purchase the party cannot pay, and spends nothing', () => {
    const inv = useInventoryStore.getState();
    inv.addResource(ResourceType.Iron, 1);
    const before = { ...useInventoryStore.getState().resources };
    expect(useVillageStore.getState().buyBuff('smithy')).toBe(false);
    expect(useInventoryStore.getState().resources).toEqual(before);
    expect(useVillageStore.getState().buff).toBeNull();
  });

  it('is read off the clock: gone the hour it ends, with no tick', () => {
    useVillageStore.getState().grantBuff('trading_post', HOURS);
    expect(villageBuffNow()).not.toBeNull();
    useCalendarStore.getState().advance(HOURS - 1);
    expect(villageBuffNow()).not.toBeNull();
    useCalendarStore.getState().advance(1);
    expect(villageBuffNow()).toBeNull();
  });

  it('is what freeing a village grants: its current buff, free, for a week', () => {
    setVillageBuffGrant(null);
    const clock = useCalendarStore.getState();
    const paid: number[] = [];
    liberate('lookout', true, (g) => paid.push(g));
    const held = useVillageStore.getState().buff!;
    expect(held.village).toBe('lookout');
    expect(held.buff).toBe(weeklyBuff('lookout', clock.weekNumber));
    expect(held.untilHour).toBe(clock.totalHours + BALANCE.VILLAGE_LIBERATION_BUFF_HOURS);
  });

  it('stacks with the expedition meal and the ward: neither clears nor is cleared by it', () => {
    useVillageStore.getState().grantBuff('smithy', HOURS);
    const held = useVillageStore.getState().buff;
    useWorldMapStore.getState().lightWard(500);
    useCityStore.setState({ meal: { tier: 1, week: useCalendarStore.getState().weekNumber } });
    expect(useVillageStore.getState().buff).toBe(held);
    expect(useWorldMapStore.getState().wardUntil).toBe(500);
    expect(villageBuffIdNow()).toBe(held!.buff);
    // And buying a buff leaves the meal and the ward as they were
    useInventoryStore.getState().addResource(ResourceType.Stone, 50);
    useInventoryStore.getState().addResource(ResourceType.Crystal, 5);
    useVillageStore.getState().buyBuff('shrine');
    expect(useWorldMapStore.getState().wardUntil).toBe(500);
    expect(useCityStore.getState().meal?.tier).toBe(1);
  });

  it('validates the saved shape', () => {
    expect(validVillageBuff(null)).toBe(true);
    expect(validVillageBuff(takeBuff('shrine', 'shrine_crit', 10))).toBe(true);
    for (const bad of [undefined, {}, { village: 'shrine', buff: 'smithy_armor', untilHour: 5 }, { village: 'nope', buff: 'x', untilHour: 1 },
      { village: 'shrine', buff: 'shrine_crit', untilHour: -1 }, { village: 'shrine', buff: 'shrine_crit', untilHour: 'x' }]) {
      expect(validVillageBuff(bad)).toBe(false);
    }
  });
});

describe('village shops', () => {
  const WEEKS = [1, 2, 3, 4, 5, 6, 7, 8];

  it('rack the right count, the same every time for a week, and rotate between weeks', () => {
    for (const theme of ['smithy', 'shrine', 'trading_post'] as const) {
      for (const week of WEEKS) {
        const stock = villageStock(theme, week);
        expect(stock).toHaveLength(villageRackSize(theme));
        expect(stock.map((s) => s.id)).toEqual(villageStock(theme, week).map((s) => s.id));
      }
      const racks = new Set(WEEKS.map((w) => villageStock(theme, w).map((s) => s.id).join()));
      expect(racks.size).toBeGreaterThan(1);
    }
    expect(villageStock('lookout', 1)).toEqual([]);
    expect(villageRackSize('lookout')).toBe(0);
  });

  it('shapes the Smithy\'s rack: weapons and armor a tier above the Shop', () => {
    const slots = ['mainHand', 'offHand', 'head', 'chest', 'legs', 'feet'];
    for (const week of WEEKS) {
      for (const piece of villageStock('smithy', week)) {
        expect(slots).toContain(piece.slot);
        expect([Rarity.Rare, Rarity.Epic]).toContain(piece.rarity);
      }
    }
  });

  it('shapes the Shrine\'s rack: trinkets and caster gear', () => {
    for (const week of WEEKS) {
      for (const piece of villageStock('shrine', week)) {
        expect(['neck', 'ring'].includes(piece.slot) || (piece.modifiers.magic ?? 0) > 0).toBe(true);
        expect([Rarity.Rare, Rarity.Epic]).toContain(piece.rarity);
      }
    }
  });

  it('mixes the Trading post\'s from the Shop\'s own tiers and swaps materials at a loss', () => {
    for (const week of WEEKS) {
      for (const piece of villageStock('trading_post', week)) expect([Rarity.Common, Rarity.Rare]).toContain(piece.rarity);
      const swaps = weeklySwaps(week);
      expect(swaps).toHaveLength(BALANCE.VILLAGE_SWAP.count);
      expect(new Set(swaps.map((s) => s.give)).size).toBe(swaps.length);
      for (const swap of swaps) {
        expect(swap.give).not.toBe(swap.get);
        expect(swap.getAmount).toBeLessThan(swap.giveAmount);
      }
      expect(weeklySwaps(week)).toEqual(swaps);
    }
  });

  it('prices the Lookout\'s goods, the scroll at its own price', () => {
    expect(LOOKOUT_STOCK).toEqual(['ward', 'ration', 'map_scroll']);
    expect(lookoutPrice('ward', 7)).toBe(BALANCE.WARD_GOLD);
    expect(lookoutPrice('ration', 7)).toBe(7);
    expect(lookoutPrice('map_scroll', 7)).toBe(BALANCE.VILLAGE_MAP_SCROLL_GOLD);
  });
});

it('has text for every village buff in the catalogs', () => {
  for (const theme of VILLAGE_THEMES as readonly VillageTheme[]) {
    for (const buff of VILLAGE_BUFF_PAIRS[theme]) expect(t(`villages.buff.${buff}.name`)).not.toBe(`villages.buff.${buff}.name`);
  }
  expect(POIType.Village).toBe('village');
});
