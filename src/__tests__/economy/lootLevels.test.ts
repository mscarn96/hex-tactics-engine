import { setLevelCapInputs } from '@/data/levelCap';
import { lairsOf } from '@/locations/lairs';
import { HeroClass, Item, ItemTemplate, MasteryId, Rarity } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { itemTemplates } from '@/data/items/itemTemplates';
import { createRNG } from '@/utils/rng';
import {
  castleItemLevel, dropItemLevel, groundItemLevel, locationGround, partyItemLevel,
} from '@/systems/economy/itemLevelSources';
import {
  LootWearer, rollChest, rollLoot, rollRandomItem, wearableByParty,
} from '@/systems/economy/lootGenerator';
import { acquisitionLevel, issuedItem, mintItem, previewItem } from '@/systems/economy/itemFactory';
import { forgeCost } from '@/systems/economy/forge';
import { shopPrice } from '@/systems/economy/cityServices';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { usePartyStore } from '@/stores/partyStore';
import { useInventoryStore, selectGear } from '@/stores/inventoryStore';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { LAIR_SPECS } from '@/locations/lairs';
import { itemName } from '@/data/items/itemText';

/**
 * Where loot gets its level, and whose loot it is.
 *
 * Two families of rule. The *level* rules: ground pays in its own band's gear,
 * further out pays better, a legendary ignores all of it and takes the cap in
 * force, and whatever a shop or forge row shows is what the purchase mints. The
 * *party* rule: an ordinary random roll narrows to wearable gear on
 * `PARTY_LOOT_BIAS` of rolls, inside the rarity and slot it has already rolled,
 * so neither of those can move.
 */

const rngOf = (seed: number) => {
  const r = createRNG(seed);
  return () => r.next();
};

describe('the ground decides what level a drop is', () => {
  it('climbs with the band and with depth inside it, and never steps back', () => {
    const offenders: string[] = [];
    let last = 0;
    for (let band = 0; band < BALANCE.BAND_ITEM_LEVEL.length; band++) {
      for (const depth of [0, 0.25, 0.5, 0.75, 1]) {
        const level = groundItemLevel({ band, depth });
        if (level < last) offenders.push(`band ${band} depth ${depth}: ${level} < ${last}`);
        last = level;
      }
    }
    expect(offenders).toEqual([]);
  });

  it('meets the castle where the overworld ends, and the castle ends on the cap', () => {
    const lastBand = BALANCE.BAND_ITEM_LEVEL.length - 1;
    expect(groundItemLevel({ band: lastBand, depth: 1 })).toBe(castleItemLevel(1));
    expect(castleItemLevel(BALANCE.MAX_SEAL_TIER)).toBe(BALANCE.MAX_LEVEL);
    for (let t = 2; t <= BALANCE.MAX_SEAL_TIER; t++) {
      expect(castleItemLevel(t)).toBe(castleItemLevel(t - 1) + 1);
    }
  });

  it('rolls within the spread of its ground and inside 1..cap', () => {
    const rng = rngOf(7);
    const offenders: string[] = [];
    for (let band = 0; band < BALANCE.BAND_ITEM_LEVEL.length; band++) {
      const centre = Math.round(groundItemLevel({ band }));
      for (let i = 0; i < 200; i++) {
        const level = dropItemLevel({ band }, rng);
        const off = Math.abs(level - centre) > BALANCE.DROP_ITEM_LEVEL_SPREAD;
        if (off || level < 1 || level > BALANCE.MAX_LEVEL || !Number.isInteger(level)) {
          offenders.push(`band ${band}: ${level}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('pays later encounters in higher-level gear', () => {
    const chaff = enemyTemplates.filter((t) => t.tier === 'normal' && !t.lootTable);
    const meanLevel = (band: number): number => {
      const rng = rngOf(100 + band);
      const levels: number[] = [];
      for (let i = 0; i < 300; i++) {
        for (const item of rollLoot(chaff.slice(0, 3), { ground: { band }, rng })) {
          levels.push(item.itemLevel);
        }
      }
      return levels.reduce((a, b) => a + b, 0) / levels.length;
    };
    const means = [0, 1, 2, 3, 4].map(meanLevel);
    for (let b = 1; b < means.length; b++) expect(means[b]).toBeGreaterThan(means[b - 1]);
  });
});

describe('a lair chest pays in its own band’s gear', () => {
  it('reads the lair’s band, never the door, and gives anywhere else no ground', () => {
    const offenders: string[] = [];
    for (const spec of LAIR_SPECS) {
      const ground = locationGround(spec.id);
      if (!ground || ground.band !== spec.band) offenders.push(spec.id);
    }
    expect(offenders).toEqual([]);
    expect(locationGround('city')).toBeUndefined();
  });

  it('pays the deeper lairs in higher-level gear, and Jadeveil’s above all the Empire’s', () => {
    // Jadeveil is reached by an owner past the Emperor: the cap in force is 25
    setLevelCapInputs({ owned: ['jadeveil'], emperorDefeated: true });
    for (const world of ['empire', 'jadeveil'] as const) {
      const levels = lairsOf(world)
        .sort((a, b) => a.band - b.band)
        .map((s) => groundItemLevel(locationGround(s.id)!));
      for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
    }
    const empireTop = Math.max(...lairsOf('empire').map((s) => groundItemLevel(locationGround(s.id)!)));
    for (const s of lairsOf('jadeveil')) {
      expect(groundItemLevel(locationGround(s.id)!)).toBeGreaterThanOrEqual(empireTop);
    }
    setLevelCapInputs({ owned: [], emperorDefeated: false });
  });
});

describe('a chest legendary takes the cap in force, not the ground', () => {
  const cap = BALANCE.MAX_LEVEL;
  afterEach(() => {
    (BALANCE as { MAX_LEVEL: number }).MAX_LEVEL = cap;
  });

  const chestLegendaries = (seed: number): Item[] => {
    const rng = rngOf(seed);
    const out: Item[] = [];
    for (let i = 0; i < 40; i++) {
      out.push(...rollChest([], { ground: { band: 0, castleTier: 1 }, rng })
        .filter((item) => item.rarity === Rarity.Legendary));
    }
    return out;
  };

  it('ignores a low castle tier', () => {
    const found = chestLegendaries(3);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((i) => i.itemLevel === cap)).toBe(true);
  });

  it('follows a raised cap, and leaves one already found where it was', () => {
    const before = chestLegendaries(4)[0];
    (BALANCE as { MAX_LEVEL: number }).MAX_LEVEL = cap + 5;
    const after = chestLegendaries(4);
    expect(after.every((i) => i.itemLevel === cap + 5)).toBe(true);
    expect(before.itemLevel).toBe(cap);
  });

  it('mints the chest’s ordinary pieces at the run’s tier', () => {
    const rng = rngOf(11);
    const ordinary: Item[] = [];
    for (let i = 0; i < 40; i++) {
      ordinary.push(...rollChest([], { ground: { band: 0, castleTier: 3 }, rng })
        .filter((item) => item.rarity !== Rarity.Legendary));
    }
    const centre = castleItemLevel(3);
    expect(ordinary.every((i) => Math.abs(i.itemLevel - centre) <= BALANCE.DROP_ITEM_LEVEL_SPREAD))
      .toBe(true);
  });
});

describe('town gear is made to the party’s measure', () => {
  it('is the mean hero level, rounded, never under 1', () => {
    expect(partyItemLevel([])).toBe(1);
    expect(partyItemLevel([{ level: 3 }, { level: 10 }])).toBe(7);
    expect(partyItemLevel([{ level: 20 }, { level: 20 }])).toBe(BALANCE.MAX_LEVEL);
  });

  /**
   * The forge's and the shop's whole promise: the row is the thing. Level,
   * base stats and price agree with the minted instance for every template the
   * library ships, at a spread of levels. Affixes are the one thing a row
   * leaves to the purchase, so a common — which never rolls one — must match
   * the minted piece exactly.
   */
  it('previews the level, stats and price the purchase mints', () => {
    const offenders: string[] = [];
    const rng = rngOf(21);
    for (const template of itemTemplates) {
      for (const level of [1, 5, 12, BALANCE.MAX_LEVEL]) {
        const preview = previewItem(template, level);
        const minted = mintItem(template, rng, level);
        if (preview.itemLevel !== minted.itemLevel) offenders.push(`${template.id}@${level}: level`);
        if (preview.sellPrice !== minted.sellPrice) offenders.push(`${template.id}@${level}: price`);
        if (shopPrice(preview) !== shopPrice(minted)) {
          offenders.push(`${template.id}@${level}: rack price`);
        }
        if (template.rarity === Rarity.Common
          && JSON.stringify(preview.modifiers) !== JSON.stringify(minted.modifiers)) {
          offenders.push(`${template.id}@${level}: stats`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the shop’s markup over what the piece sells for at every level', () => {
    const offenders: string[] = [];
    for (const template of itemTemplates) {
      for (const level of [1, 8, BALANCE.MAX_LEVEL]) {
        const preview = previewItem(template, level);
        if (shopPrice(preview) <= preview.sellPrice) offenders.push(`${template.id}@${level}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('prices a craft by the level it lands on', () => {
    const template = itemTemplates.find((t) => t.rarity === Rarity.Rare && !t.masteryLock)!;
    const anchor = acquisitionLevel(template.rarity);
    expect(forgeCost(template.form, template.motif, anchor))
      .toEqual(forgeCost(template.form, template.motif));
    const gold = (level: number) => forgeCost(template.form, template.motif, level).gold ?? 0;
    expect(gold(1)).toBeLessThan(gold(anchor));
    expect(gold(BALANCE.MAX_LEVEL)).toBeGreaterThan(gold(anchor));
  });
});

describe('handed-over kit arrives at the hero’s level', () => {
  beforeEach(() => {
    useInventoryStore.getState().reset();
    usePartyStore.getState().reset();
  });

  it('issues a catalogue piece, unrolled, at the level asked', () => {
    const template = itemTemplates.find((t) => t.rarity === Rarity.Common)!;
    const issued = issuedItem(template.id, 9)!;
    expect(issued.itemLevel).toBe(9);
    expect(issued.affixes ?? []).toEqual([]);
  });

  it('dresses every recruit in kit of their own arrival level', () => {
    const offenders: string[] = [];
    for (const template of heroTemplates.slice(0, 2)) {
      usePartyStore.getState().addHero(template.id);
    }
    const items = selectGear(useInventoryStore.getState());
    for (const hero of usePartyStore.getState().heroes) {
      for (const id of Object.values(hero.equipment)) {
        const item = items.find((i) => i.id === id);
        if (item && item.itemLevel !== hero.level) {
          offenders.push(`${hero.name}: ${itemName(item)} at ${item.itemLevel} for level ${hero.level}`);
        }
      }
    }
    expect(usePartyStore.getState().heroes.length).toBeGreaterThan(1);
    expect(offenders).toEqual([]);
  });
});

/**
 * The 70/30 rule. Each roll gets its **own** seeded stream, so roll *i* draws
 * the identical rarity and slot whether or not a party is passed — which is
 * what lets the suite state "the bias never moves rarity or slot" as an
 * equality rather than as two distributions that look alike.
 */
describe('random equipment leans toward the party', () => {
  const ROLLS = 20000;
  const arcanist: LootWearer[] = [{ heroClass: HeroClass.Mage, masteryPath: null }];

  const roll = (i: number, party?: LootWearer[]) =>
    rollRandomItem(Rarity.Epic, { party, rng: rngOf(i + 1) })!;

  const templateOf = (item: Item): ItemTemplate =>
    itemTemplates.find((t) => t.id === item.templateId)!;

  it('never moves the rarity or the slot a roll lands on', () => {
    const offenders: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const plain = roll(i);
      const biased = roll(i, arcanist);
      if (plain.rarity !== biased.rarity || plain.slot !== biased.slot) offenders.push(i);
    }
    expect(offenders).toEqual([]);
  });

  it('draws wearable gear on 70% of rolls plus its share of the other 30%', () => {
    let plainWearable = 0;
    let biasedWearable = 0;
    for (let i = 0; i < ROLLS; i++) {
      if (wearableByParty(templateOf(roll(i)), arcanist)) plainWearable++;
      if (wearableByParty(templateOf(roll(i, arcanist)), arcanist)) biasedWearable++;
    }
    const p = plainWearable / ROLLS;
    const expected = BALANCE.PARTY_LOOT_BIAS + (1 - BALANCE.PARTY_LOOT_BIAS) * p;
    // Something in the pool is off-class, or the bias has nothing to do
    expect(p).toBeLessThan(0.95);
    expect(biasedWearable).toBeGreaterThan(plainWearable);
    expect(Math.abs(biasedWearable / ROLLS - expected)).toBeLessThan(0.015);
  });

  /**
   * The lean is shared hero by hero. Narrowing to what *anybody* can wear gave
   * each hero a share proportional to their class's forms in the slot — a
   * Champion beside a Druid took 62% of the class-specific drops, which a
   * playtest reported as loot being rolled for the first hero only.
   */
  it('splits the class-specific drops evenly between two heroes', () => {
    const champion: LootWearer = { heroClass: HeroClass.Warrior, masteryPath: null };
    const druid: LootWearer = { heroClass: HeroClass.Healer, masteryPath: null };
    let theirs = 0;
    let ours = 0;
    for (let i = 0; i < 6000; i++) {
      const t = templateOf(roll(i, [champion, druid]));
      const a = wearableByParty(t, [champion]);
      const b = wearableByParty(t, [druid]);
      if (a && !b) theirs++;
      if (b && !a) ours++;
    }
    expect(Math.min(theirs, ours) / Math.max(theirs, ours)).toBeGreaterThan(0.85);
  });

  it('leans chest legendaries toward a hero who has not chosen a path yet too', () => {
    // A pathless Warrior can wear the standalone Legendaries (Excalibur, Aegis); a boss's own item is no pool's
    const champion: LootWearer = { heroClass: HeroClass.Mage, masteryPath: 'pyromancer' };
    const arcanist: LootWearer = { heroClass: HeroClass.Warrior, masteryPath: null };
    const rng = rngOf(99);
    let forArcanist = 0;
    for (let i = 0; i < 400; i++) {
      for (const item of rollChest(['pyromancer'], { party: [champion, arcanist], rng })) {
        if (item.rarity !== Rarity.Legendary) continue;
        if (wearableByParty(templateOf(item), [arcanist])) forArcanist++;
      }
    }
    // 28 before the lean read heroes rather than chosen paths, 131 after
    expect(forArcanist).toBeGreaterThan(80);
  });

  /**
   * A Champion body on an Arcanist path is a state the game cannot produce, and
   * that is what makes it useful here: the class lock refuses every staff and
   * the path lock every sword, so no main-hand weapon at any rarity is wearable.
   * The bias draw is still consumed, so a roll landing there must pick the
   * *identical* piece the unbiased roll did — the fallback is the whole pool,
   * not a different pool.
   */
  it('falls back to the whole pool when nobody can wear anything in it', () => {
    const nobody: LootWearer[] = [{ heroClass: HeroClass.Warrior, masteryPath: 'pyromancer' as MasteryId }];
    const weapons = itemTemplates.filter((t) => t.slot === 'mainHand' && !t.masteryLock);
    expect(weapons.some((t) => wearableByParty(t, nobody))).toBe(false);

    let landed = 0;
    const offenders: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const plain = roll(i);
      if (plain.slot !== 'mainHand') continue;
      landed++;
      if (roll(i, nobody).templateId !== plain.templateId) offenders.push(i);
    }
    expect(landed).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});
