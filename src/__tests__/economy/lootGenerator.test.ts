import { rollChestGuardItem, rollRandomItem, rollLoot, SLOT_DROP_WEIGHT } from '@/systems/economy/lootGenerator';
import { EQUIP_SLOTS, ItemSlot, Rarity } from '@/models/types';

// Mock item templates with one item per rarity (use actual Rarity enum string values).
// **Every entry carries a `slot`**: the drop roll picks a slot before it picks a
// template, so a template with no slot is not a stub, it is a template that
// cannot be rolled.
jest.mock('@/data/items/itemTemplates', () => ({
  itemTemplates: [
    {
      id: 'common_sword',
      name: 'Rusty Sword',
      rarity: 'common',
      slot: 'mainHand',
      modifiers: { attack: 2 },
      description: 'A rusty sword',
      sellPrice: 10,
    },
    {
      id: 'rare_staff',
      name: 'Magic Staff',
      rarity: 'rare',
      slot: 'mainHand',
      modifiers: { magic: 5 },
      description: 'A magic staff',
      sellPrice: 50,
    },
    {
      id: 'epic_shield',
      name: 'Epic Shield',
      rarity: 'epic',
      slot: 'offHand',
      modifiers: { defense: 8 },
      description: 'An epic shield',
      sellPrice: 120,
    },
    {
      id: 'legendary_ring',
      name: 'Legendary Ring',
      rarity: 'legendary',
      slot: 'ring',
      modifiers: { maxHp: 50 },
      description: 'A legendary ring',
      sellPrice: 500,
    },
  ],
}));

describe('rollRandomItem', () => {
  it('returns an item with a unique id', () => {
    const item = rollRandomItem();
    expect(item).not.toBeNull();
    expect(item!.id).toMatch(/^loot_/);
  });

  it('returned item has a valid rarity', () => {
    const item = rollRandomItem();
    expect(Object.values(Rarity)).toContain(item!.rarity);
  });

  it('templateId matches one of the template ids', () => {
    const validIds = ['common_sword', 'rare_staff', 'epic_shield', 'legendary_ring'];
    // Roll 20 times to check variety
    for (let i = 0; i < 20; i++) {
      const item = rollRandomItem();
      expect(validIds).toContain(item!.templateId);
    }
  });

  it('produces common items most often (statistical)', () => {
    const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (let i = 0; i < 1000; i++) {
      const item = rollRandomItem();
      if (item) counts[item.rarity] = (counts[item.rarity] ?? 0) + 1;
    }
    // Common should be the most frequent
    expect(counts['common']).toBeGreaterThan(counts['rare']);
    expect(counts['rare']).toBeGreaterThan(counts['epic']);
    expect(counts['epic']).toBeGreaterThan(counts['legendary']);
  });

  it('always returns common when roll is above 40%', () => {
    // legendary < 3, epic < 15, rare < 40, common = rest
    // A roll of 0.5 (50 out of 100) should be common
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const item = rollRandomItem();
    expect(item!.rarity).toBe(Rarity.Common);
    jest.restoreAllMocks();
  });

  it('returns epic when roll is below epic threshold', () => {
    // legendary weight is 0 (boss/crafting only); epic threshold is < 3
    jest.spyOn(Math, 'random').mockReturnValue(0.01); // 1 out of 100 -> epic < 3
    const item = rollRandomItem();
    expect(item!.rarity).toBe(Rarity.Epic);
    jest.restoreAllMocks();
  });
});

/**
 * An Epic should mean you beat something.
 *
 * Rarity was rolled from flat weights with nothing about the fight in scope, so
 * the feeblest chaff in the home ring dropped Epics at the same rate as a
 * warchief. Beyond cheapening the item, it undercut the threat gradient: the
 * promise that distant ground pays better is worth nothing next to a lottery
 * ticket one hex from the city gate.
 */
describe('rarity ceilings', () => {
  const epicRoll = () => jest.spyOn(Math, 'random').mockReturnValue(0.01);

  it('steps a lucky roll down to what the body could be carrying', () => {
    epicRoll();
    expect(rollRandomItem(Rarity.Rare)!.rarity).toBe(Rarity.Rare);
    jest.restoreAllMocks();
  });

  it('leaves a roll at or below the ceiling alone', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5); // common
    expect(rollRandomItem(Rarity.Epic)!.rarity).toBe(Rarity.Common);
    jest.restoreAllMocks();
  });

  // A cap, never a floor — capping must not turn "no drop" into a drop, nor
  // stop chaff paying out at all
  it('still drops something, just a lesser something', () => {
    epicRoll();
    expect(rollRandomItem(Rarity.Common)).not.toBeNull();
    jest.restoreAllMocks();
  });

  it('caps an ordinary body at Rare and an elite at Epic', () => {
    epicRoll();
    const drop = (tier: 'normal' | 'elite') =>
      rollLoot([{ tier, xpReward: 1, goldReward: 1 } as any])[0]?.rarity;
    expect(drop('normal')).toBe(Rarity.Rare);
    expect(drop('elite')).toBe(Rarity.Epic);
    jest.restoreAllMocks();
  });
});

/**
 * A slot's share of drops is its share of the body.
 *
 * The roll used to be uniform over every template of a rarity, which makes the
 * *library's composition* the drop rate — and form × motif fields more weapons
 * than armour, so 47.7% of Epic drops were main-hand weapons against 25.0% for
 * all four armour slots put together. A party wears four chest pieces and
 * carries four weapons, so the table was paying out backwards.
 *
 * Asserted **analytically off the derived table** rather than by sampling. A
 * Monte Carlo of a nine-way split needs a great many rolls to separate 1/9 from
 * 1/9 ± noise, and a suite that is occasionally red gets re-run rather than
 * investigated — the argument `homeRing.test.ts` records. Whether the walk
 * actually obeys the table is settled by `lootPool.test.ts`, which measures the
 * shipped library.
 */
describe('the drop table is shaped like a hero', () => {
  const ARMOUR: ItemSlot[] = ['head', 'chest', 'legs', 'feet'];
  /**
   * Normalised over the **weight total**, not over `EQUIP_SLOTS.length`.
   *
   * Those were the same number while every slot counted once, and they stopped
   * being the same the moment the ring entry was capped — leaving this dividing
   * by 9 while the walk divides by 8, i.e. a helper that quietly disagreed with
   * the thing it measures. The roll normalises over the table, so this does too.
   */
  const totalWeight = Object.values(SLOT_DROP_WEIGHT).reduce((a, b) => a + b, 0);
  const share = (slots: ItemSlot[]) =>
    slots.reduce((n, s) => n + SLOT_DROP_WEIGHT[s], 0) / totalWeight;

  // Derived, never authored — adding an equip slot has to move the drop table
  // with it, or the hero grows a slot the loot table has never heard of.
  /**
   * Every *item* slot once — which is one fewer than the equip slots, because
   * the two ring fingers share an entry and that entry is capped at 1.
   *
   * Derived rather than pinned to the literal 8, so adding an armour or hand
   * slot moves this with the table instead of failing.
   */
  it('counts every item slot exactly once', () => {
    const total = Object.values(SLOT_DROP_WEIGHT).reduce((a, b) => a + b, 0);
    const itemSlots = new Set(
      EQUIP_SLOTS.map((s) => (s === 'ring1' || s === 'ring2' ? 'ring' : s)),
    );
    expect(total).toBe(itemSlots.size);
  });

  /**
   * The one departure from the count, and the measurement behind it.
   *
   * Weighting both ring fingers is the pure reading, and it put a third of all
   * loot on the neck and rings — which between them are served by two forms.
   * Ten templates at Rare carried 33% of drops against seventy weapon templates
   * at 11%, so the commonest drop in the game was a band the player already had.
   * A second ring finger is not a second want.
   */
  it('caps the ring entry at one, unlike the finger count', () => {
    expect(SLOT_DROP_WEIGHT.ring).toBe(1);
    expect(SLOT_DROP_WEIGHT.mainHand).toBe(1);
    expect(SLOT_DROP_WEIGHT.neck).toBe(1);
  });

  it('puts armour at half of all drops and the main hand at an eighth', () => {
    expect(share(ARMOUR)).toBeCloseTo(4 / 8, 10);
    expect(share(['mainHand'])).toBeCloseTo(1 / 8, 10);
    expect(share(['ring'])).toBeCloseTo(1 / 8, 10);
    // The whole point of the change, stated as the inequality rather than as
    // four numbers: a party wears four armour pieces per hero and one weapon.
    expect(share(ARMOUR)).toBeGreaterThan(share(['mainHand']) * 3);
  });

  // A rarity with nothing in some slot must still pay out. Renormalising over
  // the slots that have candidates is what makes that true; rolling a slot and
  // retrying would lose the drop whenever the retry budget ran out, and
  // returning null would lose it outright.
  it('still drops something when most of the body has nothing to offer', () => {
    // The mocked library has exactly one epic, and it is an off-hand — so eight
    // of the nine slots are empty at that rarity.
    jest.spyOn(Math, 'random').mockReturnValue(0.01);
    const item = rollRandomItem();
    expect(item).not.toBeNull();
    expect(item!.slot).toBe('offHand');
    jest.restoreAllMocks();
  });
});

// Playtest 2026-10-08: a guarded chest should sometimes pay Rare, Epic or even
// Legendary, likelier on stronger ground. Playtest 2026-10-14: Legendary only from
// the strongest (band-4) chests, at 20%, and meal luck never makes one elsewhere.
describe('rollChestGuardItem', () => {
  const tally = (band: number) => {
    const counts: Record<string, number> = {};
    const steps = 1000;
    for (let i = 0; i < steps; i++) {
      const rarity = rollChestGuardItem(band, { rng: () => (i + 0.5) / steps })?.rarity ?? 'none';
      counts[rarity] = (counts[rarity] ?? 0) + 1;
    }
    return counts;
  };

  it('can pay every tier, Legendary only at band 4 and one chest in five', () => {
    const counts = tally(4);
    for (const rarity of [Rarity.Common, Rarity.Rare, Rarity.Epic, Rarity.Legendary]) {
      expect(counts[rarity]).toBeGreaterThan(0);
    }
    expect(counts[Rarity.Legendary]).toBe(200);
    for (let band = 0; band < 4; band++) expect(tally(band)[Rarity.Legendary]).toBeUndefined();
  });

  it('lets meal luck lift a lower chest to Epic but never to Legendary', () => {
    for (let band = 0; band < 4; band++) {
      for (let i = 0; i < 100; i++) {
        const piece = rollChestGuardItem(band, { rng: () => i / 100, rarityLuck: 0.1 });
        expect(piece?.rarity).not.toBe(Rarity.Legendary);
      }
    }
  });

  it('pays better tiers on stronger ground', () => {
    const better = (band: number) => {
      const c = tally(band);
      return (c[Rarity.Epic] ?? 0) + (c[Rarity.Legendary] ?? 0);
    };
    for (let band = 0; band < 4; band++) expect(better(band + 1)).toBeGreaterThan(better(band));
  });
});

describe('rollLoot', () => {
  it('returns empty array for no enemies', () => {
    const loot = rollLoot([]);
    expect(loot).toEqual([]);
  });

  it('returns at most one random item per enemy (50% chance)', () => {
    // Force Math.random to always return 0.4 (< 0.5) so loot always drops
    jest.spyOn(Math, 'random').mockReturnValue(0.4);
    const fakeEnemies = [
      { id: 'goblin', name: 'Goblin', lootTable: undefined } as any,
      { id: 'goblin', name: 'Goblin', lootTable: undefined } as any,
    ];
    const loot = rollLoot(fakeEnemies);
    expect(loot.length).toBeLessThanOrEqual(2);
    jest.restoreAllMocks();
  });

  it('drops no loot when random is above 0.5', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.9);
    const fakeEnemies = [{ id: 'goblin', name: 'Goblin', lootTable: undefined } as any];
    const loot = rollLoot(fakeEnemies);
    expect(loot).toHaveLength(0);
    jest.restoreAllMocks();
  });

  it('rolls boss loot table when present', () => {
    // Always drop loot (< 0.5) for the boss table roll AND random roll
    jest.spyOn(Math, 'random').mockReturnValue(0.4);
    const boss = {
      id: 'dragon',
      name: 'Dragon',
      lootTable: [{ templateId: 'legendary_ring', weight: 1 }],
    } as any;
    const loot = rollLoot([boss]);
    // The boss loot entry used templateId 'legendary_ring', and it should appear
    const bossItem = loot.find((i) => i.templateId === 'legendary_ring');
    expect(bossItem).toBeDefined();
    jest.restoreAllMocks();
  });
});
