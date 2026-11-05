import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { BALANCE } from '@/data/balanceConstants';
import { isCollectionMotif } from '@/data/items/collections';
import { itemTemplates } from '@/data/items/itemTemplates';
import { canBeMythic, canRerollSetBonus, rerollSetBonus } from '@/data/items/setBonus';
import { rollSocketCapacity, validSockets } from '@/data/items/gems';
import { isItemLevel } from '@/data/items/itemLevel';
import { Rarity } from '@/models/types';
import type { Item, ItemTemplate } from '@/models/types';
import { shopStock } from '@/systems/economy/cityServices';
import { forgeTemplate } from '@/systems/economy/forge';
import { itemAtLevel, mintItem, mintMythic } from '@/systems/economy/itemFactory';
import { salvageInk } from '@/systems/economy/jadeveilRewards';
import { askingPrice } from '@/systems/economy/pricing';
import { canUpgrade, crystalChance, upgradeSteps, upgraded } from '@/systems/progression/upgrades';
import { canEquip } from '@/systems/progression/equipRules';
import { RARITY_MOTIFS } from '@/data/items/motifs';
import { savedItemsWellFormed } from '@/systems/save/saveFormat';
import { createRNG } from '@/utils/rng';
import { makeHero } from '../support/fixtures';

// A cap of 40 is the highest the worlds reach, so levels 20 to 45 are all legal.
jest.mock('@/data/levelCap', () => ({
  ...jest.requireActual('@/data/levelCap'),
  levelCap: () => 40,
  highestLevelCap: () => 40,
}));

const setPieces = itemTemplates.filter(canBeMythic);

/** The same template minted both ways from one seed. */
function pair(template: ItemTemplate, seed = 7): { legendary: Item; mythic: Item } {
  const a = createRNG(seed);
  const b = createRNG(seed);
  return { legendary: mintItem(template, () => a.next()), mythic: mintMythic(template, () => b.next())! };
}

describe('which templates can be mythic', () => {
  it('is every mastery set piece and collection piece, and nothing else', () => {
    expect(setPieces.filter((t) => t.masteryLock?.length).length).toBeGreaterThan(0);
    expect(setPieces.filter((t) => isCollectionMotif(t.motif)).length).toBeGreaterThan(0);
    for (const t of itemTemplates) {
      const isSet = t.rarity === Rarity.Legendary && (!!t.masteryLock?.length || isCollectionMotif(t.motif));
      expect(canBeMythic(t)).toBe(isSet);
    }
  });

  it('refuses standalone legendaries, boss-only items and authored weapons', () => {
    for (const id of ['excalibur', 'heartfrost_staff', 'kairens_fang', 'monastery_bellstaff']) {
      const template = itemTemplates.find((t) => t.id === id)!;
      expect(canBeMythic(template)).toBe(false);
      expect(mintMythic(template)).toBeNull();
    }
  });
});

describe('a mythic equals its legendary in every number', () => {
  it('mints the same piece from the same seed, in every template', () => {
    for (const template of setPieces) {
      const { legendary, mythic } = pair(template);
      expect(mythic.rarity).toBe(Rarity.Mythic);
      expect({ ...mythic, rarity: Rarity.Legendary }).toEqual(legendary);
    }
  });

  it('has equal modifiers, sell price and level at every level from 20 to 45', () => {
    for (const template of setPieces) {
      const { legendary, mythic } = pair(template);
      for (let level = 20; level <= 45; level++) {
        const l = itemAtLevel(legendary, level);
        const m = itemAtLevel(mythic, level);
        expect(m.itemLevel).toBe(level);
        expect(m.itemLevel).toBe(l.itemLevel);
        expect(m.modifiers).toEqual(l.modifiers);
        expect(m.sellPrice).toBe(l.sellPrice);
      }
    }
  });

  it('has equal socket odds', () => {
    expect(BALANCE.GEM_SOCKET_WEIGHTS[Rarity.Mythic]).toEqual(BALANCE.GEM_SOCKET_WEIGHTS[Rarity.Legendary]);
    for (let i = 0; i < 100; i++) {
      expect(rollSocketCapacity(Rarity.Mythic, () => i / 100)).toBe(rollSocketCapacity(Rarity.Legendary, () => i / 100));
    }
  });

  it('takes Crystals as a legendary does', () => {
    const { legendary, mythic } = pair(setPieces[0]);
    let l = legendary;
    let m = mythic;
    while (canUpgrade(l)) {
      expect(canUpgrade(m)).toBe(true);
      expect(crystalChance(m)).toBe(crystalChance(l));
      l = upgraded(l);
      m = upgraded(m);
      expect(upgradeSteps(m)).toBe(upgradeSteps(l));
      expect(m.modifiers).toEqual(l.modifiers);
      expect(m.rarity).toBe(Rarity.Mythic);
    }
    expect(canUpgrade(m)).toBe(false);
    expect(upgradeSteps(m)).toBe(BALANCE.MAX_UPGRADE_LEVEL);
  });

  it('salvages and prices as its legendary', () => {
    for (const template of setPieces) {
      const { legendary, mythic } = pair(template);
      expect(salvageInk(mythic)).toBe(salvageInk(legendary));
      expect(askingPrice(mythic, 2)).toBe(askingPrice(legendary, 2));
    }
  });

  it('takes the forge\'s set-bonus reroll and stays mythic', () => {
    const template = setPieces.find((t) => t.masteryLock?.length)!;
    const { mythic } = pair(template);
    expect(canRerollSetBonus(mythic)).toBe(true);
    const rerolled = rerollSetBonus(mythic, () => 0.5);
    expect(rerolled.rarity).toBe(Rarity.Mythic);
    expect(rerolled.setBonus?.skillId).not.toBe(mythic.setBonus?.skillId);
  });

  it('may be worn once per template, whichever of the two is on', () => {
    // The rule reads only the template, so a dual-wielder's hands ask it plainly.
    const piece = setPieces.find((t) => t.form === 'short_sword')!;
    const { legendary, mythic } = pair(piece);
    const hero = makeHero({ heroClass: piece.classLock?.[0], masteryPath: piece.masteryLock?.[0] ?? null });
    for (const [incoming, worn] of [[mythic, legendary], [legendary, mythic], [mythic, mythic]]) {
      const check = canEquip(hero, incoming, 'offHand', { mainHand: worn });
      expect(check.ok).toBe(false);
      expect(JSON.stringify(check)).toMatch(/progression\.equip\.(mythic|legendary)/);
    }
  });
});

describe('where a mythic can come from', () => {
  it('is in no catalogue, so no shop, market, recipe or quest can name one', () => {
    expect(itemTemplates.filter((t) => t.rarity === Rarity.Mythic)).toEqual([]);
    expect(RARITY_MOTIFS[Rarity.Mythic]).toEqual([]);
    for (let week = 1; week < 6; week++) {
      expect(shopStock(3, week).filter((t) => t.rarity === Rarity.Mythic)).toEqual([]);
    }
    for (const t of setPieces) {
      expect(forgeTemplate(t.form, t.motif)?.rarity).not.toBe(Rarity.Mythic);
    }
  });

  it('has no acquisition calling the mint yet', () => {
    // The boss drop will be the first and only caller: `lootGenerator` is on the list for it.
    const root = path.resolve(__dirname, '../..');
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) {
          if (name !== '__tests__') walk(file);
        } else if (/\.tsx?$/.test(name) && /\bmintMythic\(/.test(readFileSync(file, 'utf8'))) {
          callers.push(path.relative(root, file));
        }
      }
    };
    walk(root);
    // The visual baseline harness is the capture tool: it loads only behind `DEV_TOOLS` on the web.
    expect(callers.filter((f) => !/itemFactory|lootGenerator|visualBaselineHarness/.test(f))).toEqual([]);
  });
});

describe('a save', () => {
  it('accepts a mythic at any level a legendary may stand at, with its sockets', () => {
    const { mythic } = pair(setPieces[0]);
    expect(isItemLevel(45, Rarity.Mythic, 40)).toBe(true);
    expect(isItemLevel(46, Rarity.Mythic, 40)).toBe(false);
    expect(validSockets(mythic.sockets, Rarity.Mythic)).toBe(true);
    expect(validSockets([null, null], Rarity.Mythic)).toBe(true);
    expect(validSockets([null, null, null], Rarity.Mythic)).toBe(false);
    const saved = (item: Item) => savedItemsWellFormed({
      inventory: { bag: [{ kind: 'gear', item }] }, city: { stash: [item] },
    } as unknown as Parameters<typeof savedItemsWellFormed>[0]);
    expect(saved(mythic)).toBe(true);
    expect(saved({ ...mythic, itemLevel: 46 })).toBe(false);
  });
});
