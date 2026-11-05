import { BALANCE } from '@/data/balanceConstants';
import { ResourceType, type CombatUnit, type MapFind } from '@/models/types';
import { AuraType } from '@/models/status';
import { VILLAGE_BUFF_IDS } from '@/systems/economy/villageBuffs';
import {
  discounted, effectPercent, fleesWarbands, goldMultiplier, seesDanger, villageBuffUnit,
} from '@/systems/economy/villageBuffEffects';
import { tradeRates } from '@/systems/economy/market';
import { victoryRewards } from '@/systems/combat/combatRewards';
import { findPayout } from '@/systems/world/finds';
import { at, makeStats, makeUnit } from '../support/fixtures';

/**
 * What a held village buff changes, through the one module that answers it:
 * each takes the id of the buff running now and nothing else. Every number is a
 * first guess recorded as "verify in playtest"; these pin the rules.
 */

describe('the Smithy and the Shrine in a fight', () => {
  const hero = (over: Partial<CombatUnit['stats']> = {}) => makeUnit({
    isPlayer: true, position: at(0, 0), stats: makeStats({ maxHp: 200, attack: 40, magic: 10, defense: 20, magicDefense: 20, ...over }),
  });
  const E = BALANCE.VILLAGE_BUFF_EFFECT;

  it('adds armor to every hero', () => {
    const u = villageBuffUnit(hero(), 'smithy_armor');
    expect(u.stats.defense).toBe(Math.round(20 * (1 + E.armorPct / 100)));
    expect(u.stats.magicDefense).toBe(Math.round(20 * (1 + E.armorPct / 100)));
    expect(u.stats.attack).toBe(40);
  });

  it('chooses attack or magic per hero, whichever is higher, as the fight starts', () => {
    const warrior = villageBuffUnit(hero({ attack: 40, magic: 10 }), 'smithy_power');
    expect(warrior.stats.attack).toBe(Math.round(40 * (1 + E.powerPct / 100)));
    expect(warrior.stats.magic).toBe(10);
    const mage = villageBuffUnit(hero({ attack: 12, magic: 60 }), 'smithy_power');
    expect(mage.stats.magic).toBe(Math.round(60 * (1 + E.powerPct / 100)));
    expect(mage.stats.attack).toBe(12);
  });

  it('starts every hero behind a Barrier of a tenth of their health', () => {
    const u = villageBuffUnit(hero(), 'shrine_barrier');
    const barrier = u.activeEffects.find((e) => e.type === AuraType.Barrier)!;
    expect(barrier.magnitude).toBe(Math.round(200 * E.barrierShare));
    expect(barrier.duration).toBe(-1);
  });

  it('adds crit chance on top of the base', () => {
    const base = BALANCE.BASE_CRIT_CHANCE;
    expect(villageBuffUnit(hero(), 'shrine_crit').stats.critChance).toBe(base + E.critPoints);
    expect(villageBuffUnit(hero({ critChance: 20 }), 'shrine_crit').stats.critChance).toBe(20 + E.critPoints);
  });

  it('leaves enemies, other buffs and no buff alone', () => {
    const foe = makeUnit({ isPlayer: false });
    for (const buff of VILLAGE_BUFF_IDS) expect(villageBuffUnit(foe, buff)).toBe(foe);
    const u = hero();
    for (const buff of ['lookout_escape', 'lookout_sight', 'trading_discount', 'trading_gold', null] as const) {
      expect(villageBuffUnit(u, buff)).toBe(u);
    }
  });
});

describe('the Trading post', () => {
  it('takes a quarter off item purchases and only those: 100 gold becomes 75', () => {
    expect(discounted(100, 'trading_discount')).toBe(75);
    expect(discounted(100, null)).toBe(100);
    expect(discounted(100, 'smithy_armor')).toBe(100);
    expect(discounted(1, 'trading_discount')).toBe(1);
  });

  it('adds a quarter to gold from fights and finds, and nothing to other buffs', () => {
    expect(goldMultiplier('trading_gold')).toBe(1.25);
    expect(goldMultiplier('trading_discount')).toBe(1);
    expect(goldMultiplier(null)).toBe(1);
  });

  const fight = (goldMultiplier?: number) => {
    const hero = makeUnit({ isPlayer: true, heroId: 'h1' });
    const foe = makeUnit({ isPlayer: false, currentHp: 0, templateId: 'goblin_whelp' });
    return victoryRewards({
      units: [hero, foe], heroes: [], encounterId: 'random_danger', threatBand: 1, castleRun: null, isLastStage: false, ...(goldMultiplier && { goldMultiplier }),
    });
  };

  it('pays the boosted gold from a fight, and the same fight without the buff pays less', () => {
    const plain = fight().gold;
    const boosted = fight(1.25).gold;
    expect(plain).toBeGreaterThan(0);
    expect(boosted).toBe(Math.round(plain * 1.25));
  });

  it('boosts gold finds and leaves materials at their amount', () => {
    const find = { coord: at(0, 0), kind: 'cache', payout: [
      { type: ResourceType.Gold, amount: 80 }, { type: ResourceType.Iron, amount: 4 },
    ] } as unknown as MapFind;
    expect(findPayout(find, 0)).toEqual([{ type: ResourceType.Gold, amount: 80 }, { type: ResourceType.Iron, amount: 4 }]);
    expect(findPayout(find, 0, 1.25)).toEqual([{ type: ResourceType.Gold, amount: 100 }, { type: ResourceType.Iron, amount: 4 }]);
  });

  it('never takes a Market buy price under its sell price, so buying and selling is no loop', () => {
    for (let week = 1; week <= 20; week++) {
      for (const level of [0, 1, 2, 3]) {
        for (const rate of tradeRates(week, level)) {
          const buy = Math.max(rate.sell + 1, discounted(rate.buy, 'trading_discount'));
          expect(buy).toBeGreaterThan(rate.sell);
          expect(buy).toBeLessThanOrEqual(rate.buy);
        }
      }
    }
  });
});

describe('the Lookout on the world map', () => {
  it('lets a warband be fled under Escape alone', () => {
    for (const buff of VILLAGE_BUFF_IDS) expect(fleesWarbands(buff)).toBe(buff === 'lookout_escape');
    expect(fleesWarbands(null)).toBe(false);
  });

  it('shows the day\'s warbands under Danger sight alone', () => {
    for (const buff of VILLAGE_BUFF_IDS) expect(seesDanger(buff)).toBe(buff === 'lookout_sight');
    expect(seesDanger(null)).toBe(false);
  });
});

describe('the number a buff\'s sentence quotes', () => {
  const E = BALANCE.VILLAGE_BUFF_EFFECT;

  it('is the share each buff changes, as a percentage', () => {
    expect(effectPercent('smithy_armor')).toBe(E.armorPct);
    expect(effectPercent('smithy_power')).toBe(E.powerPct);
    expect(effectPercent('shrine_barrier')).toBe(E.barrierShare * 100);
    expect(effectPercent('trading_discount')).toBe(E.discount * 100);
    expect(effectPercent('trading_gold')).toBe(E.goldBonus * 100);
  });
});
