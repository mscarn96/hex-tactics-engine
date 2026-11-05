import { BALANCE } from '@/data/balanceConstants';
import { setLevelCapInputs } from '@/data/levelCap';
import { itemTemplates } from '@/data/items/itemTemplates';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { Rarity } from '@/models/types';
import { victoryRewards } from '@/systems/combat/combatRewards';
import { dropItemLevel, groundItemLevel, locationGround } from '@/systems/economy/itemLevelSources';
import { acquisitionLevel, defaultMintLevel, mintItem } from '@/systems/economy/itemFactory';
import { questGearLevel } from '@/systems/quests/questRewards';
import { QUESTS } from '@/quests/questData';
import { contentLevel } from '@/systems/world/contentLevel';
import { summitEncounterId, summitItemLevel } from '@/systems/world/summit';
import { makeHero, makeUnit } from '../support/fixtures';
import { createRNG } from '@/utils/rng';
import { jadeveilAt } from '../support/bandRoad';
import type { ThreatBand } from '@/systems/world/threat';

/**
 * Loot beyond the Empire comes from where it was fought for: story under its band's top
 * however high the cap has gone, repeatable content at the cap.
 */

const rngOf = (seed: number) => {
  const r = createRNG(seed);
  return () => r.next();
};
const mid = () => 0.5;

const wandering = (band: number, depth: number) => ({
  band, depth, content: contentLevel({ world: 'jadeveil', encounterId: 'random_danger', threatBand: band })!,
});

afterEach(() => setLevelCapInputs({ owned: [], emperorDefeated: false, banded: [], finished: [] }));

const legendary = itemTemplates.find((t) => t.rarity === Rarity.Legendary)!;
const epic = itemTemplates.find((t) => t.rarity === Rarity.Epic)!;

describe('Jadeveil at band 1 and a cap of 25', () => {
  beforeEach(() => setLevelCapInputs(jadeveilAt(1)));

  it('mints each area\'s wandering drops at the area\'s level, ramped to the next and never past the band', () => {
    for (const band of [0, 1, 2, 3, 4]) {
      expect(groundItemLevel(wandering(band, 0))).toBe(21 + band);
      expect(groundItemLevel(wandering(band, 1))).toBe(Math.min(25, 22 + band));
      expect(groundItemLevel(wandering(band, 0.5))).toBe(Math.min(25, 21.5 + band));
    }
    for (let seed = 0; seed < 200; seed++) {
      const level = dropItemLevel(wandering(4, 1), rngOf(seed));
      expect(level).toBeLessThanOrEqual(25);
      expect(level).toBeGreaterThanOrEqual(25 - BALANCE.DROP_ITEM_LEVEL_SPREAD);
    }
  });

  it('pays the lair chests today\'s 22 and 24, and the summit chest today\'s cap − 5 + tier', () => {
    expect(groundItemLevel(locationGround('lair_silk')!)).toBe(22);
    expect(groundItemLevel(locationGround('lair_hall')!)).toBe(24);
    expect([1, 2, 3, 4, 5].map(summitItemLevel)).toEqual([21, 22, 23, 24, 25]);
  });

  it('mints a legendary from every source at 25', () => {
    expect(defaultMintLevel(Rarity.Legendary, 25)).toBe(25);
    expect(acquisitionLevel(Rarity.Legendary, 3, contentLevel({ world: 'jadeveil', threatBand: 0 })!.ceiling)).toBe(25);
    expect(acquisitionLevel(Rarity.Legendary, 3)).toBe(25);
  });

  it('leaves an Empire ground on its own ladder', () => {
    expect(groundItemLevel({ band: 2, depth: 0 })).toBe(BALANCE.BAND_ITEM_LEVEL[2]);
    expect(groundItemLevel({ band: 2 })).toBe(BALANCE.BAND_ITEM_LEVEL[2]);
    expect(locationGround('lair_warren')).toEqual({ band: expect.any(Number), depth: expect.any(Number) });
  });
});

describe('Jadeveil at band 1 and a cap of 35', () => {
  beforeEach(() => setLevelCapInputs(jadeveilAt(1, 35)));

  it('mints story sources at 25 at most, and their legendaries at 25', () => {
    for (const ground of [wandering(4, 1), locationGround('lair_hall')!, locationGround('lair_silk')!]) {
      for (let seed = 0; seed < 100; seed++) expect(dropItemLevel(ground, rngOf(seed))).toBeLessThanOrEqual(25);
      const item = mintItem(legendary, mid, dropItemLevel(ground, mid), [], ground.content!.ceiling);
      expect(item.itemLevel).toBe(25);
    }
    expect(summitItemLevel(1)).toBe(21);
  });

  it('mints Storm Seal tiers 2–5 at 32–35, with legendaries at 35', () => {
    expect([2, 3, 4, 5].map(summitItemLevel)).toEqual([32, 33, 34, 35]);
    for (const tier of [2, 3, 4, 5]) {
      const content = contentLevel({ world: 'jadeveil', encounterId: summitEncounterId(tier) })!;
      const ground = { band: 4, level: summitItemLevel(tier), content };
      expect(groundItemLevel(ground)).toBe(30 + tier);
      expect(mintItem(legendary, mid, dropItemLevel(ground, mid), [], content.ceiling).itemLevel).toBe(35);
      expect(mintItem(epic, mid, dropItemLevel(ground, mid), [], content.ceiling).itemLevel).toBe(30 + tier);
    }
  });

  it('pays a won fight that way, end to end', () => {
    const kairen = enemyTemplates.find((t) => t.id === 'kairen')!;
    const units = [
      makeUnit({ isPlayer: true, currentHp: 10 }),
      makeUnit({ isPlayer: false, templateId: kairen.id, currentHp: 0 }),
    ];
    const base = { units, heroes: [makeHero({ level: 35 })], threatBand: 4 as ThreatBand, castleRun: null, isLastStage: false, world: 'jadeveil' as const };
    const story = victoryRewards({ ...base, encounterId: summitEncounterId(1), kairenSlain: true });
    expect(story.items.length).toBeGreaterThan(0);
    for (const item of story.items) expect(item.itemLevel).toBeLessThanOrEqual(25);
    const seal = victoryRewards({ ...base, encounterId: summitEncounterId(5), kairenSlain: true });
    for (const item of seal.items) {
      if (item.rarity === Rarity.Legendary) expect(item.itemLevel).toBe(35);
      else expect(item.itemLevel).toBeGreaterThanOrEqual(35 - BALANCE.DROP_ITEM_LEVEL_SPREAD);
    }
    expect(seal.summit?.itemLevel).toBe(35);
    expect(story.summit?.itemLevel).toBe(21);
  });
});

describe('Jadeveil as a later world', () => {
  it('moves every source up with its band', () => {
    setLevelCapInputs(jadeveilAt(2));
    expect(groundItemLevel(wandering(0, 0))).toBe(26);
    expect(groundItemLevel(wandering(4, 1))).toBe(30);
    expect(groundItemLevel(locationGround('lair_silk')!)).toBe(27);
    expect(groundItemLevel(locationGround('lair_hall')!)).toBe(29);
    expect(summitItemLevel(1)).toBe(26);
    expect(summitItemLevel(5)).toBe(30);
  });
});

describe('quest gear', () => {
  it('is clamped to its world\'s band, in a Jadeveil contract, and left alone in an Empire one', () => {
    setLevelCapInputs(jadeveilAt(1, 35));
    const jade = QUESTS.the_silk_hollow;
    expect(questGearLevel(jade, 23)).toEqual({ level: 23, ceiling: 25 });
    expect(questGearLevel(jade, 33)).toEqual({ level: 25, ceiling: 25 });
    expect(questGearLevel(jade, 18)).toEqual({ level: 21, ceiling: 25 });
    expect(questGearLevel(QUESTS.the_warren_under_the_fields, 33)).toEqual({ level: 33 });
  });
});

describe('affixes and sockets past level 35', () => {
  it('follow the item level unchanged, for a piece minted at 36–40', () => {
    setLevelCapInputs(jadeveilAt(4, 40));
    const template = itemTemplates.find((t) => t.rarity === Rarity.Epic && !t.world)!;
    // A seed whose roll carries an affix and a socket, so both are really being looked at
    const seed = Array.from({ length: 500 }, (_, i) => i)
      .find((i) => { const item = mintItem(template, rngOf(i), 20); return item.affixes?.length && item.sockets?.length; })!;
    const at20 = mintItem(template, rngOf(seed), 20);
    const size = (item: { modifiers: object }) => Object.values(item.modifiers).reduce<number>((n, v) => n + Math.abs(v as number), 0);
    let last = size(at20);
    for (const level of [36, 37, 38, 39, 40]) {
      const item = mintItem(template, rngOf(seed), level);
      expect(item.itemLevel).toBe(level);
      expect(item.affixes).toEqual(at20.affixes);
      expect(item.sockets).toHaveLength(at20.sockets!.length);
      // The whole budget, affixes included, is restated by the level
      expect(size(item)).toBeGreaterThanOrEqual(last);
      last = size(item);
    }
    expect(last).toBeGreaterThan(size(at20));
  });
});
