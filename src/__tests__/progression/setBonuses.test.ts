import { itemTemplates } from '@/data/items/itemTemplates';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { COLLECTION_IDS, COLLECTION_WEIGHT } from '@/data/items/collections';
import { BALANCE } from '@/data/balanceConstants';
import { mintItem } from '@/systems/economy/itemFactory';
import { buildSimHero, defaultHeroConfig, setLoadout } from '@/systems/sim/simHarness';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import {
  FIVE_BONUS, THREE_BONUS, fiveValue, setBonusEffects, setProgress, threeValue, tiersOf, wornCollectionPieces,
} from '@/systems/progression/setBonuses';
import { distinctSetPieces, matchingSetPieces } from '@/systems/progression/achievementEquipment';
import { bagFrom } from '@/data/items/bag';
import { useInventoryStore } from '@/stores/inventoryStore';
import { applyMasteryModifiers, findSkill, masteryModifiers } from '@/systems/progression/mastery';
import { carapaceMax } from '@/systems/combat/beetle';
import { DEFAULT_LOCALE, LOCALES, setLocale } from '@/i18n';
import { setCardView } from '@/systems/progression/setBonusText';
import { Rarity } from '@/models/types';
import type { CollectionId, EquipSlot, Hero, Item, MasteryId } from '@/models/types';

/** A hero in the first `count` pieces of their path's set. */
function wearing(path: MasteryId, count: number): { hero: Hero; items: Item[] } {
  const meta = MASTERY_PATHS.find((p) => p.id === path)!;
  const hero = buildSimHero({ ...defaultHeroConfig(meta.heroClass, 20), masteryPath: path }, (item) => item.id)!;
  const items: Item[] = [];
  const slots = setLoadout(path);
  if (path === 'berserker') {
    slots.mainHand = itemTemplates.find((t) => t.masteryLock?.includes(path) && t.form === 'war_axe')!.id;
    slots.offHand = itemTemplates.find((t) => t.masteryLock?.includes(path) && t.form === 'short_sword')!.id;
  }
  for (const [slot, templateId] of Object.entries(slots).slice(0, count)) {
    const item = { ...mintItem(itemTemplates.find((t) => t.id === templateId)!, () => 0, 20), id: slot };
    items.push(item);
    hero.equipment[slot as EquipSlot] = item.id;
  }
  return { hero, items };
}

/** A hero of the weight in `count` pieces of a collection. */
function inCollection(collection: CollectionId, path: MasteryId, count: number): { hero: Hero; items: Item[] } {
  const { hero } = wearing(path, 0);
  const forms = ['head', 'chest', 'legs', 'feet'].map((slot) => `${COLLECTION_WEIGHT[collection]}_${slot}`);
  const items: Item[] = [];
  forms.slice(0, count).forEach((form, i) => {
    const template = itemTemplates.find((t) => t.motif === collection && t.form === form)!;
    const slot = (['head', 'chest', 'legs', 'feet'] as const)[i];
    items.push({ ...mintItem(template, () => 0, 20), id: slot });
    hero.equipment[slot] = slot;
  });
  return { hero, items };
}

const PATHS = MASTERY_PATHS.map((p) => p.id);

describe('three and five piece set bonuses', () => {
  it('gives every path both a three- and a five-piece bonus, and every collection a three-piece one', () => {
    for (const path of PATHS) {
      expect(THREE_BONUS[path]).toBeDefined();
      expect(FIVE_BONUS[path]).toBeDefined();
      expect(tiersOf(path)).toEqual([3, 5]);
    }
    for (const collection of COLLECTION_IDS) {
      expect(THREE_BONUS[collection]).toBeDefined();
      expect(tiersOf(collection)).toEqual([3]);
    }
    for (const bonus of Object.values(THREE_BONUS)) expect(threeValue(bonus)).toBeGreaterThan(0);
    for (const bonus of Object.values(FIVE_BONUS)) expect(fiveValue(bonus)).toBeGreaterThan(0);
    expect(Object.keys(BALANCE.SET_BONUSES.THREE).sort()).toEqual([...new Set(Object.values(THREE_BONUS))].sort());
    expect(Object.keys(BALANCE.SET_BONUSES.FIVE).sort()).toEqual([...new Set(Object.values(FIVE_BONUS))].sort());
  });

  it.each(PATHS)(
    '%s: nothing under three pieces, the three-piece bonus at three, both at five',
    (path) => {
      const empty = { stats: {}, percent: {}, modifier: {} };
      for (const count of [0, 1, 2]) {
        const { hero, items } = wearing(path, count);
        expect(setBonusEffects(hero, items)).toEqual(empty);
      }
      const three = wearing(path, 3);
      expect(setProgress(three.hero, three.items)).toEqual({ set: path, count: 3, active: [3] });
      const five = wearing(path, 5);
      expect(setProgress(five.hero, five.items)?.active).toEqual([3, 5]);
      // the two add up: five pieces hold everything three do, and more
      const a = setBonusEffects(three.hero, three.items);
      const b = setBonusEffects(five.hero, five.items);
      expect(a).not.toEqual(empty);
      expect(b).not.toEqual(a);
      for (const key of Object.keys(a.percent) as (keyof typeof a.percent)[]) expect(b.percent[key]).toBe(a.percent[key]);
      for (const key of Object.keys(a.stats) as (keyof typeof a.stats)[]) expect(b.stats[key]).toBe(a.stats[key]);
      if (a.modifier.maxHpPercentBonus) expect(b.modifier.maxHpPercentBonus).toBe(a.modifier.maxHpPercentBonus);
    },
  );

  it('keeps counting past five: the sixth and seventh piece add no third bonus', () => {
    const five = wearing('templar', 5);
    const seven = wearing('templar', 7);
    expect(setBonusEffects(seven.hero, seven.items)).toEqual(setBonusEffects(five.hero, five.items));
  });

  it('counts only pieces of the hero\'s own set', () => {
    const { hero, items } = wearing('berserker', 5);
    const stripped = items.map((i, n) => (n < 3 ? { ...i, masteryLock: undefined } : i));
    expect(setProgress(hero, stripped)).toEqual({ set: 'berserker', count: 2, active: [] });
    expect(setBonusEffects(hero, stripped)).toEqual({ stats: {}, percent: {}, modifier: {} });
  });

  it('names the five-piece bonus a plain number on the path\'s own signature', () => {
    const modifiers = (path: MasteryId) => setBonusEffects(...Object.values(wearing(path, 5)) as [Hero, Item[]]);
    expect(modifiers('bulwark').modifier.shieldPowerBonus).toBe(BALANCE.SET_BONUSES.FIVE.barrier);
    expect(modifiers('stoneshaper').modifier.shieldPowerBonus).toBe(BALANCE.SET_BONUSES.FIVE.barrier);
    expect(modifiers('stormcaller').modifier.chainJumpBonus).toBe(1);
    expect(modifiers('templar').modifier.skillPowerBonus).toEqual({ smite: BALANCE.SET_BONUSES.FIVE.smite });
    expect(modifiers('berserker').modifier.bleedMagnitudeBonus).toBe(BALANCE.SET_BONUSES.FIVE.bleed);
    expect(modifiers('pyromancer').modifier.burnMagnitudeBonus).toBe(BALANCE.SET_BONUSES.FIVE.burn);
    expect(modifiers('wildshape').modifier.formVigorBonus).toBe(BALANCE.SET_BONUSES.FIVE.form);
    expect(modifiers('marksman').modifier.markedDamageBonus).toBe(BALANCE.SET_BONUSES.FIVE.marked);
    expect(modifiers('shadowblade').stats.poisonPower).toBe(BALANCE.SET_BONUSES.FIVE.poison);
  });

  it.each(COLLECTION_IDS)('%s: a three-piece bonus only, however many more are worn', (collection) => {
    const path = ({
      jade_bastion: 'bulwark', canopy_strider: 'marksman', cloud_script: 'pyromancer', monastery_oath: 'lifewarden',
      ironclad_admiral: 'bulwark', saltrunner: 'skirmisher', stormglass: 'pyromancer', shellwoven: 'lifewarden',
    } as const)[collection];
    const none = { stats: {}, percent: {}, modifier: {} };
    for (const count of [1, 2]) {
      const { hero, items } = inCollection(collection, path, count);
      expect(setBonusEffects(hero, items)).toEqual(none);
    }
    const three = inCollection(collection, path, 3);
    const four = inCollection(collection, path, 4);
    expect(setProgress(three.hero, three.items)).toEqual({ set: collection, count: 3, active: [3] });
    expect(setBonusEffects(three.hero, three.items)).not.toEqual(none);
    expect(setBonusEffects(four.hero, four.items)).toEqual(setBonusEffects(three.hero, three.items));
  });

  it('puts the three-piece stat on the sheet: a Berserker\'s attack, a Marksman\'s crit, a Bulwark\'s Jade armour', () => {
    const attackOf = (count: number) => {
      const { hero, items } = wearing('berserker', 5);
      const worn = items.map((i, n) => (n >= count ? { ...i, masteryLock: undefined } : i));
      return getEffectiveStats(hero, worn).attack;
    };
    const without = attackOf(2);
    const with3 = attackOf(3);
    expect(with3).toBe(Math.round(without * (1 + BALANCE.SET_BONUSES.THREE.damage)));

    const crit = (count: number) => {
      const { hero, items } = wearing('marksman', 5);
      return getEffectiveStats(hero, items.map((i, n) => (n >= count ? { ...i, masteryLock: undefined } : i))).critChance;
    };
    expect((crit(3) ?? 0) - (crit(2) ?? 0)).toBe(BALANCE.SET_BONUSES.THREE.crit);

    const defence = (count: number) => {
      const { hero, items } = inCollection('jade_bastion', 'bulwark', 4);
      return getEffectiveStats(hero, items.map((i, n) => (n >= count ? { ...i, motif: 'iron' as const } : i))).defense;
    };
    expect(defence(3)).toBeGreaterThan(defence(2));
  });

  it('reaches combat through masteryModifiers: the five-piece number lands on the skill and the Carapace', () => {
    const bag = (items: Item[]) => useInventoryStore.setState({ bag: items.map((item) => ({ kind: 'gear' as const, item })) });
    const storm = wearing('stormcaller', 5);
    bag(storm.items);
    const mods = masteryModifiers(storm.hero);
    expect(mods.chainJumpBonus).toBe(1);
    const chain = findSkill('chain_lightning')!;
    expect(applyMasteryModifiers(chain, mods).chainJumps).toBe((chain.chainJumps ?? 0) + 1);

    const beetle = wearing('beetle', 5);
    bag(beetle.items);
    const unit = { masteryModifiers: masteryModifiers(beetle.hero) };
    expect(carapaceMax(unit)).toBe(BALANCE.BEETLE.CARAPACE_MAX + 1);
    expect(carapaceMax({})).toBe(BALANCE.BEETLE.CARAPACE_MAX);

    const templar = wearing('templar', 5);
    bag(templar.items);
    const smite = findSkill('smite')!;
    // beside the pieces' own +12% rolls, which stay as they were
    const rolled = (items: Item[]) => items.reduce((n, i) => n + (i.setBonus?.skillId === 'smite' ? i.setBonus.percent : 0), 0);
    const smiteBonus = (mods: ReturnType<typeof masteryModifiers>) => mods.skillPowerBonus?.smite ?? 0;
    expect(smiteBonus(masteryModifiers(templar.hero)) - rolled(templar.items)).toBe(BALANCE.SET_BONUSES.FIVE.smite);
    expect(applyMasteryModifiers(smite, masteryModifiers(templar.hero)).damage ?? 0).toBeGreaterThan(smite.damage ?? 0);

    const bare = wearing('templar', 4);
    bag(bare.items);
    expect(smiteBonus(masteryModifiers(bare.hero)) - rolled(bare.items)).toBe(0);
    useInventoryStore.setState({ bag: [] });
  });
});

describe('the set card', () => {
  afterEach(() => setLocale(DEFAULT_LOCALE));

  it('says the set, how many pieces, and each tier lit only once reached', () => {
    const { hero, items } = wearing('berserker', 4);
    const chest = items.find((i) => i.id === 'chest') ?? items[1];
    const card = setCardView(chest, hero, items)!;
    expect(card.header).toBe('Bloodrage 4/7');
    expect(card.lines.map((l) => [l.tier, l.active])).toEqual([[3, true], [5, false]]);
    expect(card.lines[0].text).toBe('3 pieces: +8% damage');
    expect(card.lines[1].text).toBe('5 pieces: Bleed damage +25%');
  });

  it('counts a piece not yet worn as if it were, and says so', () => {
    const { hero, items } = wearing('berserker', 2);
    const extra = wearing('berserker', 3).items[2];
    const card = setCardView({ ...extra, id: 'in_bag' }, hero, items)!;
    expect(card.header).toBe('Bloodrage 3/7 if worn');
    expect(card.lines[0].active).toBe(true);
  });

  it('has nothing to say about a piece of another set, or a piece with no set', () => {
    const { hero, items } = wearing('berserker', 3);
    const other = wearing('templar', 3).items[0];
    expect(setCardView(other, hero, items)).toBeNull();
    const plain = { ...items[0], rarity: Rarity.Rare, masteryLock: undefined };
    expect(setCardView(plain, hero, items)).toBeNull();
  });

  it('shows a collection as three pieces of four with its one bonus', () => {
    const { hero, items } = inCollection('jade_bastion', 'bulwark', 3);
    const card = setCardView(items[0], hero, items)!;
    expect(card.header).toBe('Jade Bastion 3/4');
    expect(card.lines).toHaveLength(1);
    expect(card.lines[0]).toEqual({ tier: 3, text: '3 pieces: +10% armour', active: true });
  });
});

describe('a worn mythic counts as two pieces', () => {
  const firstSlot = (hero: Hero) => Object.keys(hero.equipment)[0];
  const mythicAt = (items: Item[], ...indices: number[]) => items.map((item, i) => (
    indices.includes(i) ? { ...item, rarity: Rarity.Mythic } : item
  ));

  it('reaches three with one mythic and one legendary', () => {
    const { hero, items } = wearing('pyromancer', 2);
    expect(setProgress(hero, items)?.active).toEqual([]);
    const progress = setProgress(hero, mythicAt(items, 0));
    expect(progress?.count).toBe(3);
    expect(progress?.active).toEqual([3]);
  });

  it('reaches five with two mythics and one legendary', () => {
    const { hero, items } = wearing('pyromancer', 3);
    const progress = setProgress(hero, mythicAt(items, 0, 1));
    expect(progress?.count).toBe(5);
    expect(progress?.active).toEqual([3, 5]);
  });

  it('reaches a collection\'s three with one mythic and one legendary, and it has no five', () => {
    const { hero, items } = inCollection('jade_bastion', 'bulwark', 2);
    const progress = setProgress({ ...hero, masteryPath: 'bulwark' }, mythicAt(items, 0));
    expect(progress).toMatchObject({ set: 'jade_bastion', count: 3, active: [3] });
    const all = inCollection('jade_bastion', 'bulwark', 4);
    const full = setProgress(all.hero, mythicAt(all.items, 0, 1, 2, 3));
    expect(full?.count).toBe(8);
    expect(full?.active).toEqual([3]);
  });

  it('counts a template once, duplicates included, at its best', () => {
    const { hero, items } = wearing('pyromancer', 1);
    const [first] = items;
    const mythic = { ...first, rarity: Rarity.Mythic };
    const copy = { ...mythic, id: 'copy' };
    expect(matchingSetPieces({ ...hero, equipment: { head: mythic.id, chest: mythic.id } }, [mythic])).toBe(2);
    expect(matchingSetPieces({ ...hero, equipment: { [firstSlot(hero)]: mythic.id, feet: copy.id } }, [mythic, copy])).toBeLessThanOrEqual(2);
  });

  it('counts a collection\'s duplicate template once too', () => {
    const { hero, items } = inCollection('jade_bastion', 'bulwark', 1);
    const copy = { ...items[0], id: 'copy', rarity: Rarity.Mythic };
    const worn = { ...hero, equipment: { head: items[0].id, chest: 'copy' } };
    expect(wornCollectionPieces(worn, [items[0], copy]).jade_bastion).toBe(2);
  });

  it('leaves the real piece count to the achievements', () => {
    const { hero, items } = wearing('pyromancer', 3);
    const doubled = mythicAt(items, 0, 1, 2);
    expect(matchingSetPieces(hero, doubled)).toBe(6);
    expect(distinctSetPieces(hero, doubled)).toBe(3);
  });

  it('leaves the skill roll alone', () => {
    const { hero, items } = wearing('pyromancer', 3);
    const stats = (list: Item[]) => {
      useInventoryStore.setState({ bag: bagFrom({ gear: list }) });
      return masteryModifiers(hero).skillPowerBonus;
    };
    const plain = stats(items);
    expect(stats(mythicAt(items, 0, 1, 2))).toEqual(plain);
  });

  it('counts a mythic in the bag as two if worn, and one swapped for its legendary as one more', () => {
    const { hero, items } = wearing('pyromancer', 3);
    const meta = setLoadout('pyromancer');
    const unworn = Object.values(meta).find((id) => !items.some((i) => i.templateId === id))!;
    const bagged = { ...mintItem(itemTemplates.find((t) => t.id === unworn)!, () => 0, 20), id: 'bagged', rarity: Rarity.Mythic };
    expect(setCardView(bagged, hero, items)!.header).toContain('5/');
    const swap = { ...items[0], id: 'swap', rarity: Rarity.Mythic };
    expect(setCardView(swap, hero, items)!.header).toContain('4/');
    const wornMythic = mythicAt(items, 0).map((i, n) => (n === 0 ? { ...i, id: 'other' } : i));
    const onMythic = { ...hero, equipment: { ...hero.equipment, [Object.keys(hero.equipment)[0]]: 'other' } };
    expect(setCardView(items[0], onMythic, wornMythic)!.header).toContain('3/');
  });

  it('stops the card\'s number at the set\'s size', () => {
    const { hero, items } = wearing('pyromancer', 5);
    const view = setCardView(items[0], hero, mythicAt(items, 0, 1, 2, 3, 4))!;
    const total = view.header.match(/(\d+)\/(\d+)/)!;
    expect(Number(total[1])).toBeLessThanOrEqual(Number(total[2]));
  });
});
