import { HeroClass, Item, Rarity } from '@/models/types';
import { itemTemplates } from '@/data/items/itemTemplates';
import { BALANCE } from '@/data/balanceConstants';
import { LootWearer, rollLairChest, wearableByParty } from '@/systems/economy/lootGenerator';
import { createRNG } from '@/utils/rng';

/**
 * A lair's two chests: one Legendary, or two Epics, made for the party.
 *
 * Pinned because the previous chest was a 20%-per-item lottery over the whole
 * library, and a playtest opened one holding two Legendaries for the one class
 * nobody in the party played.
 */

const rngOf = (seed: number) => {
  const r = createRNG(seed);
  return () => r.next();
};

const champion: LootWearer = { heroClass: HeroClass.Warrior, masteryPath: 'berserker' };
const ranger: LootWearer = { heroClass: HeroClass.Ranger, masteryPath: null };
const party = [champion, ranger];

const templateOf = (item: Item) => itemTemplates.find((t) => t.id === item.templateId)!;

describe('the first chest', () => {
  it('always holds a Legendary one of the party can wear', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const items = rollLairChest('legendary', ['berserker'], { party, rng: rngOf(seed) });
      const legendaries = items.filter((i) => i.rarity === Rarity.Legendary);
      expect(legendaries).toHaveLength(1);
      expect(wearableByParty(templateOf(legendaries[0]), party)).toBe(true);
    }
  });

  it('pays the usual three to five pieces in all', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const n = rollLairChest('legendary', [], { party, rng: rngOf(seed) }).length;
      expect(n).toBeGreaterThanOrEqual(BALANCE.CHEST_ITEMS.min);
      expect(n).toBeLessThanOrEqual(BALANCE.CHEST_ITEMS.max);
    }
  });

  it('never rolls a second Legendary among the extras', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const items = rollLairChest('legendary', [], { party, rng: rngOf(seed) });
      expect(items.filter((i) => i.rarity === Rarity.Legendary)).toHaveLength(1);
    }
  });
});

describe('the second chest', () => {
  it('always holds two Epics, each wearable by somebody in the party', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const items = rollLairChest('epics', [], { party, rng: rngOf(seed) });
      const epics = items.slice(0, 2);
      expect(epics.every((i) => i.rarity === Rarity.Epic)).toBe(true);
      const wearers = epics.map((i) => party.map((h) => wearableByParty(templateOf(i), [h])));
      // Each one is for somebody
      expect(wearers.every((w) => w.some(Boolean))).toBe(true);
    }
  });

  it('works for a lone hero and for no party at all', () => {
    expect(rollLairChest('epics', [], { party: [champion], rng: rngOf(3) }).slice(0, 2)
      .every((i) => i.rarity === Rarity.Epic)).toBe(true);
    expect(rollLairChest('legendary', [], { rng: rngOf(4) })
      .some((i) => i.rarity === Rarity.Legendary)).toBe(true);
  });
});
