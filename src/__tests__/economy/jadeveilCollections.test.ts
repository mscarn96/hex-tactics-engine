import { HeroClass, Item, ItemTemplate, MasteryId, Rarity } from '@/models/types';
import {
  COLLECTION_IDS, COLLECTION_WEIGHT, COLLECTION_WORLD, collectionForms, collectionPaths,
} from '@/data/items/collections';
import { MASTERY_ARMOUR_WEIGHT, PATH_CLASS, pathsOfClass } from '@/data/items/itemForms';
import {
  bonusFitsWearer, bonusPathOf, canRerollSetBonus, rerollPaths, rerollSetBonus, rollSetBonus, setBonusPool,
} from '@/data/items/setBonus';
import { itemTemplates } from '@/data/items/itemTemplates';
import { itemFromTemplate, mintItem } from '@/systems/economy/itemFactory';
import { canEquip } from '@/systems/progression/equipRules';
import { setBonusText } from '@/systems/progression/setBonusText';
import { canRerollHere, MASTERY_SET_FORGE_LEVEL } from '@/systems/economy/forge';
import { MASTERY_MOTIFS } from '@/data/items/motifs';
import { createRNG } from '@/utils/rng';

/**
 * Jadeveil's four legendary armour collections: identified by their weight, worn
 * by every path of it, and rolling a skill from any of those paths — the board's
 * "shared weights and expansion skill rolls". The rules, not the numbers: who
 * may wear a piece, which paths a roll may name, that a wrong-path roll is said
 * and can be re-aimed, and that the mastery sets are untouched.
 */

const pieces = (collection: string): ItemTemplate[] =>
  itemTemplates.filter((t) => t.motif === collection);

const ALL_PATHS = Object.keys(PATH_CLASS) as MasteryId[];

const seeded = (seed: number) => {
  const rng = createRNG(seed);
  return () => rng.next();
};

describe('a collection is its weight', () => {
  it('has exactly the four armour pieces of its weight, legendary, of its own world only and locked to no path', () => {
    for (const collection of COLLECTION_IDS) {
      const found = pieces(collection);
      expect(found.map((t) => t.form).sort()).toEqual(collectionForms(collection).slice().sort());
      for (const t of found) {
        expect({ id: t.id, rarity: t.rarity, lock: t.masteryLock, world: t.world })
          .toEqual({ id: t.id, rarity: Rarity.Legendary, lock: undefined, world: COLLECTION_WORLD[collection] });
      }
    }
  });

  it('keeps Jadeveil\'s four in Jadeveil and the archipelago\'s out of every world the campaign has', () => {
    for (const collection of ['jade_bastion', 'canopy_strider', 'cloud_script', 'monastery_oath'] as const) {
      expect(COLLECTION_WORLD[collection]).toBe('jadeveil');
    }
    expect(COLLECTION_WORLD.saltrunner).toBe('archipelago');
  });

  it('is worn by every path of its weight, and refused by every other', () => {
    for (const collection of COLLECTION_IDS) {
      const weight = COLLECTION_WEIGHT[collection];
      for (const template of pieces(collection)) {
        const item = itemFromTemplate(template);
        for (const path of ALL_PATHS) {
          const hero = { heroClass: PATH_CLASS[path], masteryPath: path };
          const ok = canEquip(hero, item, template.slot as never, {}).ok;
          expect({ piece: template.id, path, ok }).toEqual({ piece: template.id, path, ok: MASTERY_ARMOUR_WEIGHT[path] === weight });
        }
      }
    }
  });

  it('is worn before a path by any class with a path of its weight', () => {
    for (const collection of COLLECTION_IDS) {
      const item = itemFromTemplate(pieces(collection)[0]);
      for (const heroClass of Object.values(HeroClass)) {
        const ok = canEquip({ heroClass, masteryPath: null }, item, item.slot as never, {}).ok;
        const expected = pathsOfClass(heroClass).some((p) => collectionPaths(collection).includes(p));
        expect({ collection, heroClass, ok }).toEqual({ collection, heroClass, ok: expected });
      }
    }
  });

  it('names the Beetle with plate, the Mantis with hide and the Firefly with vestments', () => {
    expect(collectionPaths('jade_bastion')).toEqual(['bulwark', 'templar', 'berserker', 'beetle']);
    expect(collectionPaths('canopy_strider')).toEqual(['marksman', 'skirmisher', 'shadowblade', 'mantis']);
    expect(collectionPaths('cloud_script')).toEqual(['pyromancer', 'hydromancer', 'stormcaller']);
    expect(collectionPaths('monastery_oath')).toEqual(['lifewarden', 'stoneshaper', 'wildshape', 'firefly']);
  });
});

describe('a collection piece rolls a skill of one path of its weight', () => {
  it('records the path, from the weight, and a skill of that path\'s whole pool', () => {
    for (const collection of COLLECTION_IDS) {
      const template = pieces(collection)[0];
      const seen = new Set<MasteryId>();
      for (let seed = 1; seed <= 400; seed++) {
        const bonus = rollSetBonus(template, seeded(seed))!;
        expect(bonus.path).toBeDefined();
        expect(collectionPaths(collection)).toContain(bonus.path);
        expect(setBonusPool(bonus.path!)).toContain(bonus.skillId);
        seen.add(bonus.path!);
      }
      // With no party to lean to, every path of the weight comes up
      expect([...seen].sort()).toEqual(collectionPaths(collection).slice().sort());
    }
  });

  it('leans to a party wearer of the weight, and still lands elsewhere sometimes', () => {
    const helm = pieces('jade_bastion')[0];
    const party = [
      { heroClass: HeroClass.Warrior, masteryPath: 'templar' as MasteryId },
      { heroClass: HeroClass.Mage, masteryPath: 'pyromancer' as MasteryId },
    ];
    let templar = 0;
    let other = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const bonus = rollSetBonus(helm, seeded(seed), party)!;
      if (bonus.path === 'templar') templar++;
      else other++;
      // The Arcanist wears no plate, so never draws the roll
      expect(bonus.path).not.toBe('pyromancer');
    }
    expect(templar).toBeGreaterThan(other);
    expect(other).toBeGreaterThan(0);
  });

  it('leans a pathless wearer to a path of their class that wears the weight', () => {
    const hat = pieces('monastery_oath')[0];
    const monk = [{ heroClass: HeroClass.Monk, masteryPath: null }];
    let firefly = 0;
    for (let seed = 1; seed <= 600; seed++) {
      if (rollSetBonus(hat, seeded(seed), monk)!.path === 'firefly') firefly++;
    }
    // A quarter of the weight's paths at random; the lean makes it most of them
    expect(firefly).toBeGreaterThan(300);
  });

  it('mints with the party\'s lean from a drop', () => {
    const helm = pieces('jade_bastion')[0];
    const item = mintItem(helm, seeded(7), undefined, [{ heroClass: HeroClass.Monk, masteryPath: 'beetle' }]);
    expect(item.setBonus).toBeDefined();
    expect(collectionPaths('jade_bastion')).toContain(item.setBonus!.path);
  });
});

describe('a wrong-path roll is shown and repairable', () => {
  const helm = pieces('jade_bastion')[0];
  const wrong: Item = {
    ...mintItem(helm, seeded(3)),
    setBonus: { skillId: setBonusPool('beetle')[0], percent: 12, path: 'beetle' },
  };
  const templar = { masteryPath: 'templar' as MasteryId };

  it('fits only the path it names, and says so to anyone else', () => {
    expect(bonusPathOf(wrong)).toBe('beetle');
    expect(bonusFitsWearer(wrong, { masteryPath: 'beetle' })).toBe(true);
    expect(bonusFitsWearer(wrong, templar)).toBe(false);
    const text = setBonusText(wrong, templar)!;
    expect(text.text).toContain('Beetle');
    expect(text.warning).toMatch(/no effect/);
    expect(setBonusText(wrong, { masteryPath: 'beetle' })!.warning).toBeUndefined();
  });

  it('re-aims at any path of the weight, to a skill of that path and never the one it held', () => {
    expect(rerollPaths(wrong).sort()).toEqual(collectionPaths('jade_bastion').slice().sort());
    expect(canRerollSetBonus(wrong)).toBe(true);
    expect(canRerollHere(wrong, MASTERY_SET_FORGE_LEVEL)).toBe(true);
    expect(canRerollHere(wrong, MASTERY_SET_FORGE_LEVEL - 1)).toBe(false);
    for (let seed = 1; seed <= 60; seed++) {
      const fixed = rerollSetBonus(wrong, seeded(seed), 'templar');
      expect(fixed.setBonus!.path).toBe('templar');
      expect(setBonusPool('templar')).toContain(fixed.setBonus!.skillId);
      expect(bonusFitsWearer(fixed, templar)).toBe(true);
    }
    for (let seed = 1; seed <= 60; seed++) {
      const again = rerollSetBonus(wrong, seeded(seed));
      expect(again.setBonus!.path).toBe('beetle');
      expect(again.setBonus!.skillId).not.toBe(wrong.setBonus!.skillId);
    }
  });

  it('refuses a path outside the weight and changes nothing', () => {
    expect(rerollSetBonus(wrong, seeded(1), 'pyromancer')).toBe(wrong);
  });
});

describe('the mastery sets behave as they did', () => {
  it('lock to one path and roll from it, recording no path', () => {
    for (const mastery of MASTERY_MOTIFS) {
      const set = itemTemplates.filter((t) => t.motif === mastery);
      expect(set.every((t) => t.masteryLock?.length === 1 && t.masteryLock[0] === mastery)).toBe(true);
      const pool = setBonusPool(mastery);
      if (pool.length === 0) continue;
      const bonus = rollSetBonus(set[0], seeded(11), [{ heroClass: HeroClass.Warrior, masteryPath: 'templar' }])!;
      expect(pool).toContain(bonus.skillId);
      expect(bonus.path).toBeUndefined();
      // Only its own path re-aims it, and a wearer of it is never warned
      expect(rerollPaths({ ...itemFromTemplate(set[0]), setBonus: bonus })).toEqual([mastery]);
      expect(setBonusText({ ...itemFromTemplate(set[0]), setBonus: bonus }, { masteryPath: 'templar' })!.warning).toBeUndefined();
    }
  });
});
