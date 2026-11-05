import {
  canUpgrade,
  crystalChance,
  itemDisplayName,
  upgradeSteps,
  upgraded,
} from '@/systems/progression/upgrades';
import { rollChest } from '@/systems/economy/lootGenerator';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import { itemAtLevel, mintItem } from '@/systems/economy/itemFactory';
import { itemLevelScale, maxItemLevel } from '@/data/items/itemLevel';
import { itemTemplates } from '@/data/items/itemTemplates';
import { BALANCE } from '@/data/balanceConstants';
import { Hero, Item, MasteryId, Rarity } from '@/models/types';
import { itemName } from '@/data/items/itemText';

const legendary = itemTemplates.find((t) => t.rarity === Rarity.Legendary && t.masteryLock)!;
const common = itemTemplates.find((t) => t.rarity === Rarity.Common)!;
const never = () => 0;
/** A legendary as it drops, then `plus` Crystals on. */
const dropped = (plus = 0): Item => {
  let item = mintItem(legendary, never);
  for (let i = 0; i < plus; i++) item = upgraded(item);
  return item;
};

/**
 * A legendary's upgrade is its item level: it drops at the cap and each Crystal
 * is one level past it, on the steep segment of the item-level curve that only
 * a legendary climbs. There is no second multiplier beside the level.
 */
describe('legendary upgrades are item levels past the cap', () => {
  it('drops at the cap, labelled +0', () => {
    const item = dropped();
    expect(item.itemLevel).toBe(BALANCE.MAX_LEVEL);
    expect(upgradeSteps(item)).toBe(0);
    expect(itemDisplayName(item)).toBe(itemName(item));
  });

  it('raises one item level per Crystal and re-derives the stats from the template', () => {
    const item = dropped(3);
    expect(item.itemLevel).toBe(BALANCE.MAX_LEVEL + 3);
    expect(upgradeSteps(item)).toBe(3);
    expect(item).toEqual(itemAtLevel(dropped(), BALANCE.MAX_LEVEL + 3));
    expect(itemDisplayName(item)).toBe(`${itemName(item)} +3`);
  });

  /**
   * The ordinary curve is nearly flat past the cap (five levels ≈ ×1.18), so a
   * legendary climbs its own steep segment there. What a Crystal pays is the
   * rule; the step itself is balance data.
   */
  it('pays LEGENDARY_LEVEL_STEP of the dropped stats per Crystal', () => {
    const cap = BALANCE.MAX_LEVEL;
    for (let plus = 0; plus <= BALANCE.MAX_UPGRADE_LEVEL; plus++) {
      expect(itemLevelScale(cap + plus, Rarity.Legendary))
        .toBeCloseTo(1 + BALANCE.LEGENDARY_LEVEL_STEP * plus, 12);
    }
    expect(BALANCE.LEGENDARY_LEVEL_STEP * BALANCE.MAX_UPGRADE_LEVEL)
      .toBeGreaterThan(itemLevelScale(cap + BALANCE.MAX_UPGRADE_LEVEL, Rarity.Epic) - 1);
    const base = dropped(), top = dropped(BALANCE.MAX_UPGRADE_LEVEL);
    const [stat, v] = (Object.entries(base.modifiers) as [keyof Item['modifiers'], number][])
      .sort((a, b) => b[1] - a[1])[0];
    expect(top.modifiers[stat]).toBe(Math.round(v * (1 + BALANCE.LEGENDARY_LEVEL_STEP * BALANCE.MAX_UPGRADE_LEVEL)));
  });

  it('meets the ordinary curve at the anchor and never steps down across it', () => {
    const anchor = BALANCE.ITEM_LEVEL_ANCHOR.legendary;
    expect(itemLevelScale(anchor, Rarity.Legendary)).toBe(1);
    for (let l = 1; l < maxItemLevel(Rarity.Legendary) + 10; l++) {
      expect(itemLevelScale(l + 1, Rarity.Legendary)).toBeGreaterThan(itemLevelScale(l, Rarity.Legendary));
    }
  });

  /**
   * The segment is anchored on the legendary anchor, not the cap in force. Tied
   * to the cap, raising it would slide the segment under a legendary already
   * past the old one, and its next Crystal would re-derive it weaker.
   */
  it('never re-derives an upgraded legendary weaker after the cap rises', () => {
    const balance = BALANCE as { MAX_LEVEL: number };
    const before = balance.MAX_LEVEL;
    const pumped = dropped(BALANCE.MAX_UPGRADE_LEVEL);
    balance.MAX_LEVEL = before + 10;
    try {
      const next = upgraded(pumped);
      expect(next.itemLevel).toBe(pumped.itemLevel + 1);
      for (const [k, v] of Object.entries(pumped.modifiers) as [keyof Item['modifiers'], number][]) {
        expect(next.modifiers[k] ?? 0).toBeGreaterThanOrEqual(v);
      }
    } finally {
      balance.MAX_LEVEL = before;
    }
  });

  it('stops MAX_UPGRADE_LEVEL levels past the cap', () => {
    expect(maxItemLevel(Rarity.Legendary)).toBe(BALANCE.MAX_LEVEL + BALANCE.MAX_UPGRADE_LEVEL);
    const top = dropped(BALANCE.MAX_UPGRADE_LEVEL + 3);
    expect(top.itemLevel).toBe(maxItemLevel(Rarity.Legendary));
    expect(canUpgrade(top)).toBe(false);
    expect(upgraded(top)).toBe(top);
  });

  // The Seal ladder and the upgrade ladder are meant to be climbed together: a
  // +5 legendary is what clears tier 5
  it('caps at the same rung as the Seal ladder', () => {
    expect(BALANCE.MAX_UPGRADE_LEVEL).toBe(BALANCE.MAX_SEAL_TIER);
  });

  it('only ever touches legendaries, and nothing else may pass the cap', () => {
    const plain = { ...mintItem(common, never), id: 'c' };
    expect(canUpgrade(plain)).toBe(false);
    expect(canUpgrade(dropped())).toBe(true);
    expect(itemAtLevel(plain, BALANCE.MAX_LEVEL + 5).itemLevel).toBe(BALANCE.MAX_LEVEL);
    expect(mintItem(common, never, BALANCE.MAX_LEVEL + 5).itemLevel).toBe(BALANCE.MAX_LEVEL);
  });

  /**
   * Applying a Crystal never fails. The randomness already lives in the drop
   * and in the salvage roll; a third roll that destroys your item is a slot
   * machine rather than a decision.
   */
  it('always succeeds when it applies at all, keeping name, affixes, set bonus and id', () => {
    const before = dropped();
    const after = upgraded(before);
    expect(after.itemLevel).toBe(before.itemLevel + 1);
    expect(itemName(after)).toBe(itemName(before));
    expect(after.id).toBe(before.id);
    expect(after.affixes).toEqual(before.affixes);
    expect(after.setBonus).toEqual(before.setBonus);
  });

  it('never loses a stat point as it climbs, and ends stronger than it dropped', () => {
    const offenders: string[] = [];
    const total = (i: Item) => Object.values(i.modifiers).reduce((s: number, v) => s + (v ?? 0), 0);
    for (let plus = 1; plus <= BALANCE.MAX_UPGRADE_LEVEL; plus++) {
      const lo = dropped(plus - 1), hi = dropped(plus);
      for (const [k, v] of Object.entries(lo.modifiers) as [keyof Item['modifiers'], number][]) {
        if ((hi.modifiers[k] ?? 0) < v) offenders.push(`+${plus} ${k}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(total(dropped(BALANCE.MAX_UPGRADE_LEVEL))).toBeGreaterThan(total(dropped()));
  });
});

describe('upgrades reaching the sheet', () => {
  const hero = (): Hero => ({
    id: 'h1',
    templateId: 'warrior',
    name: 'Hero',
    level: 10,
    xp: 0,
    baseStats: { maxHp: 100, attack: 10, defense: 8, magic: 4, speed: 10, moveRange: 3, maxMana: 20 },
    currentHp: 100,
    currentMana: 20,
    skills: [],
    equipment: {},
    masteryPath: null,
    masteryNodes: [],
  }) as unknown as Hero;

  it('makes an upgraded item genuinely stronger on the hero', () => {
    const h = hero();
    const before = getEffectiveStats(h, [dropped()]);
    const after = getEffectiveStats(h, [dropped(BALANCE.MAX_UPGRADE_LEVEL)]);
    const changed = (Object.keys(legendary.modifiers) as (keyof typeof legendary.modifiers)[])
      .some((k) => (after as never)[k] !== (before as never)[k]);
    expect(changed).toBe(true);
  });
});

describe('the crystal loop', () => {
  it('never drops one from a common', () => {
    expect(crystalChance(mintItem(common, never))).toBe(0);
  });

  // Breaking a +3 is worth more than breaking a +0, which is what stops the
  // bottom of the pile becoming pure clutter once the good slots are filled
  it('is worth more the more the item was worth', () => {
    expect(crystalChance(dropped(3))).toBeGreaterThan(crystalChance(dropped()));
  });

  it('stays a chance rather than a certainty at the top', () => {
    expect(crystalChance(dropped(BALANCE.MAX_UPGRADE_LEVEL))).toBeLessThan(1);
  });
});

describe('the chest', () => {
  const PATHS: MasteryId[] = ['wildshape'];

  it('always has something in it', () => {
    const empty: number[] = [];
    for (let i = 0; i < 200; i++) {
      const n = rollChest(PATHS).length;
      if (n < BALANCE.CHEST_ITEMS.min || n > BALANCE.CHEST_ITEMS.max) empty.push(n);
    }
    expect(empty).toEqual([]);
  });

  /**
   * Chest legendaries can be mastery set pieces, which deliberately breaks the
   * craftable-only rule from v0.4 — the forge is how you *finish* a set, the
   * chest is how you get surprised by one.
   */
  it('can hand out a set piece the forge would have gated', () => {
    let seen = false;
    for (let i = 0; i < 400 && !seen; i++) {
      seen = rollChest(PATHS).some((it) => !!it.masteryLock);
    }
    expect(seen).toBe(true);
  });

  it('produces roughly one legendary a run rather than a pile', () => {
    let legendaries = 0;
    const runs = 400;
    for (let i = 0; i < runs; i++) {
      legendaries += rollChest(PATHS).filter((it) => it.rarity === Rarity.Legendary).length;
    }
    const perRun = legendaries / runs;
    expect(perRun).toBeGreaterThan(0.4);
    expect(perRun).toBeLessThan(1.8);
  });

  // Biased, never filtered: off-path legendaries are the best salvage fodder in
  // the game, and the Crystal loop needs a supply
  it('leans toward the paths the party walks without shutting the rest out', () => {
    let onPath = 0;
    let offPath = 0;
    for (let i = 0; i < 600; i++) {
      for (const item of rollChest(PATHS)) {
        if (!item.masteryLock) continue;
        if (item.masteryLock.includes('wildshape')) onPath++;
        else offPath++;
      }
    }
    expect(onPath).toBeGreaterThan(offPath);
    expect(offPath).toBeGreaterThan(0);
  });

  it('falls back to the whole library for a party with no paths yet', () => {
    const items = rollChest([]);
    expect(items.length).toBeGreaterThan(0);
  });
});
