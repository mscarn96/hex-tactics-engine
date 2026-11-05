import { bagFrom } from '@/data/items/bag';
import { EnemyTemplate, HeroClass, Item, ItemTemplate, MasteryId, MotifId, Rarity } from '@/models/types';
import {
  authoredDrop, rollChest, rollLairChest, rollLoot, rollRandomItem, LootOptions, LootWearer,
} from '@/systems/economy/lootGenerator';
import {
  BELLSTAFF_LAIR, MONASTERY_BELLSTAFF, fightInk, lairChestRewards, salvageInk, summitGuaranteedPieces,
} from '@/systems/economy/jadeveilRewards';
import { COLLECTION_IDS, COLLECTION_WEIGHT, COLLECTION_WORLD, collectionForms, isCollectionMotif } from '@/data/items/collections';
import {
  ARCHIPELAGO_MOTIFS, JADEVEIL_MOTIFS, JADEVEIL_MOTIF_WEAPONS, motifWorld, worldMotifsFor,
} from '@/data/items/worldGear';
import { FORM_IDS, MASTERY_ARMOUR_WEIGHT, MASTERY_WEAPON_FORMS, PATH_CLASS } from '@/data/items/itemForms';
import { itemTemplates } from '@/data/items/itemTemplates';
import { canForge, forgeableMotifs, inkCost, MASTERY_SET_FORGE_LEVEL, patternsToFind } from '@/systems/economy/forge';
import { shopStock } from '@/systems/economy/cityServices';
import { resolveGearReward } from '@/systems/economy/questGear';
import { itemFromTemplate } from '@/systems/economy/itemFactory';
import { salvageOutcome } from '@/systems/economy/salvage';
import { canEquip, slotsFor } from '@/systems/progression/equipRules';
import { weaponAttackId } from '@/systems/combat/basicAttack';
import { isAscentForge } from '@/systems/save/saveFormat';
import { useAscentStore } from '@/stores/ascentStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { makeHero } from '@/__tests__/support/fixtures';
import { MOTIF_RARITY } from '@/data/items/motifs';
import { createRNG } from '@/utils/rng';

const KAIRENS_FANG = 'kairens_fang';

/**
 * Jadeveil's equipment is the range's own: its motifs, collections and weapons
 * drop, stock and forge only there, the forge finishes what the drops start but
 * cannot craft the catalogue on arrival, and Kairen's repeat tiers keep paying.
 */

const seeded = (seed: number) => {
  const rng = createRNG(seed);
  return () => rng.next();
};

const enemy = (tier: EnemyTemplate['tier']) => ({ tier } as EnemyTemplate);

const ALL_PATHS = Object.keys(PATH_CLASS) as MasteryId[];
const isWorldGear = (item: Pick<Item, 'world'>) => item.world === 'jadeveil';

/** A Champion, an Arcanist, and a Druid and a Monk who share vestments. */
const PARTY: LootWearer[] = [
  { heroClass: HeroClass.Warrior, masteryPath: 'templar' },
  { heroClass: HeroClass.Mage, masteryPath: 'pyromancer' },
  { heroClass: HeroClass.Healer, masteryPath: 'lifewarden' },
  { heroClass: HeroClass.Monk, masteryPath: 'firefly' },
];
const MASTERIES = PARTY.map((h) => h.masteryPath!) as MasteryId[];

const wearable = (item: Item, hero: LootWearer) =>
  slotsFor(item.slot).some((slot) => canEquip(hero, item, slot, {}).ok);

describe('the range\'s gear is the range\'s', () => {
  it('tags every Votive, Spiritsealed, Jadeveil collection piece and authored weapon with Jadeveil, a later world\'s collection and motif with its world, and nothing else', () => {
    for (const t of itemTemplates) {
      const jadeveil = JADEVEIL_MOTIFS.includes(t.motif)
        || t.id === KAIRENS_FANG || t.id === MONASTERY_BELLSTAFF
        || t.id === 'widows_needle' || t.id === 'silent_lesson_staff';
      const expected = isCollectionMotif(t.motif) ? COLLECTION_WORLD[t.motif]
        : ARCHIPELAGO_MOTIFS.includes(t.motif) ? 'archipelago' : jadeveil ? 'jadeveil' : undefined;
      expect({ id: t.id, world: t.world }).toEqual({ id: t.id, world: expected });
    }
  });

  it('puts the archipelago\'s two motifs on all four weights\' armour and no weapon, Redflag Rare and Compassbound Epic', () => {
    for (const motif of ARCHIPELAGO_MOTIFS) {
      const forms = itemTemplates.filter((t) => t.motif === motif).map((t) => t.form);
      expect(forms.sort()).toEqual([...new Set(COLLECTION_IDS.flatMap(collectionForms))].sort());
    }
    expect(MOTIF_RARITY.redflag).toBe(Rarity.Rare);
    expect(MOTIF_RARITY.compassbound).toBe(Rarity.Epic);
  });

  it('puts both motifs on all four weights and the selected weapons, never on jewellery or off-hands', () => {
    for (const motif of JADEVEIL_MOTIFS) {
      const forms = new Set(itemTemplates.filter((t) => t.motif === motif).map((t) => t.form));
      expect([...forms].sort()).toEqual(
        [...new Set(COLLECTION_IDS.flatMap(collectionForms)), ...JADEVEIL_MOTIF_WEAPONS].sort(),
      );
    }
    expect(MOTIF_RARITY.votive).toBe(Rarity.Rare);
    expect(MOTIF_RARITY.spiritsealed).toBe(Rarity.Epic);
  });

  it('lets every path find a Rare and an Epic weapon and armour piece it can use', () => {
    for (const path of ALL_PATHS) {
      const hero = { heroClass: PATH_CLASS[path], masteryPath: path };
      for (const motif of JADEVEIL_MOTIFS) {
        const pieces = itemTemplates.filter((t) => t.motif === motif).map(itemFromTemplate);
        expect({ path, motif, armour: pieces.some((i) => i.slot !== 'mainHand' && wearable(i, hero)) })
          .toEqual({ path, motif, armour: true });
        expect({ path, motif, weapon: pieces.some((i) => i.slot === 'mainHand' && wearable(i, hero)) })
          .toEqual({ path, motif, weapon: true });
      }
    }
  });

  it('never rolls, stocks or pays the range\'s gear in the Empire', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const options: LootOptions = { party: PARTY, rng: seeded(seed), ground: { band: 4 } };
      const items = [
        ...rollLoot([enemy('normal'), enemy('elite'), enemy('boss')], options),
        ...rollChest(MASTERIES, options),
        ...rollLairChest('legendary', MASTERIES, options),
        ...rollLairChest('epics', MASTERIES, options),
      ];
      expect(items.filter(isWorldGear)).toEqual([]);
      expect(lairChestRewards('lair_hall', 'empire', 'legendary', MASTERIES, { ...options, rng: seeded(seed) }).ink).toBe(0);
    }
    for (let week = 1; week <= 20; week++) expect(shopStock(3, week).filter(isWorldGear)).toEqual([]);
  });

  it('rolls exactly the dice it always did in the Empire, named or not', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const strip = (items: Item[]) => items.map((i) => [i.templateId, i.itemLevel, i.affixes, i.setBonus, i.sockets]);
      const run = (world?: 'empire') => {
        const options: LootOptions = { party: PARTY, rng: seeded(seed), ground: { band: 3 }, world };
        return strip([...rollLoot([enemy('normal'), enemy('boss')], options), ...rollChest(MASTERIES, options)]);
      };
      expect(run('empire')).toEqual(run());
    }
  });

  it('draws the range\'s gear in the range: its motifs on ordinary rolls, its legendaries on most legendary ones', () => {
    let motifs = 0;
    let legendaries = 0;
    let own = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const options: LootOptions = { party: PARTY, rng: seeded(seed), world: 'jadeveil' };
      const ordinary = rollRandomItem(Rarity.Epic, options);
      if (ordinary && JADEVEIL_MOTIFS.includes(ordinary.motif)) motifs++;
      for (const item of rollLoot([enemy('boss')], { ...options, rng: seeded(seed + 9000) })) {
        if (item.rarity !== Rarity.Legendary) continue;
        legendaries++;
        if (isWorldGear(item)) own++;
      }
    }
    expect(motifs).toBeGreaterThan(0);
    // `WORLD_LEGENDARY_SHARE` narrows half, and the rest still find some by chance
    expect(own / legendaries).toBeGreaterThan(0.4);
    expect(own / legendaries).toBeLessThan(0.8);
  });

  it('pays a Jadeveil quest in the range\'s gear where it fits best, and an Empire quest never', () => {
    const heroes = [makeHero({ id: 'h1', heroClass: HeroClass.Warrior, masteryPath: 'templar', level: 22 })];
    const empire = resolveGearReward({ slot: 'chest', rarity: Rarity.Epic }, heroes, () => ({}), 'empire');
    expect(itemTemplates.find((t) => t.id === empire!.templateId)!.world).toBeUndefined();
    const range = resolveGearReward({ slot: 'chest', rarity: Rarity.Epic }, heroes, () => ({}), 'jadeveil');
    expect(range).not.toBeNull();
  });
});

describe('the forge finishes the range\'s chase, and cannot start it', () => {
  const everyWorldRecipe = (level: number, patterns: MotifId[]) => FORM_IDS.flatMap((form) =>
    forgeableMotifs(form, level, ALL_PATHS, patterns).filter((m) => !!motifWorld(m)).map((m) => `${form}_${m}`));

  it('crafts nothing of the range\'s at a level-3 forge before a pattern is learned', () => {
    expect(everyWorldRecipe(MASTERY_SET_FORGE_LEVEL, [])).toEqual([]);
  });

  it('opens a collection\'s four pieces, and nothing else, once one piece is held, at the set bench\'s level', () => {
    for (const collection of COLLECTION_IDS) {
      const recipes = everyWorldRecipe(MASTERY_SET_FORGE_LEVEL, [collection]);
      expect(recipes.sort()).toEqual(collectionForms(collection).map((f) => `${f}_${collection}`).sort());
      expect(everyWorldRecipe(MASTERY_SET_FORGE_LEVEL - 1, [collection])).toEqual([]);
    }
  });

  it('opens the ordinary motifs at their rarity\'s level', () => {
    expect(canForge('plate_chest', 'votive', 0, [], ['votive'])).toBe(false);
    expect(canForge('plate_chest', 'votive', 1, [], ['votive'])).toBe(true);
    expect(canForge('plate_chest', 'spiritsealed', 1, [], ['spiritsealed'])).toBe(false);
    expect(canForge('plate_chest', 'spiritsealed', 2, [], ['spiritsealed'])).toBe(true);
    // Only on the forms the motif is minted on
    expect(canForge('pendant', 'votive', 3, [], ['votive'])).toBe(false);
  });

  it('counts the patterns left to find in the worlds the game has, not one built ahead of its world', () => {
    expect(patternsToFind('hide_head', []).sort()).toEqual(['canopy_strider', 'spiritsealed', 'votive']);
    expect(patternsToFind('hide_head', ['votive', 'canopy_strider'])).toEqual(['spiritsealed']);
    expect(COLLECTION_WORLD.saltrunner).toBe('archipelago');
  });

  it('charges Ink for the range\'s gear only, a legendary piece most', () => {
    expect(inkCost('plate_chest', 'steel')).toBe(0);
    expect(inkCost('plate_chest', 'jade_bastion')).toBeGreaterThan(inkCost('plate_chest', 'spiritsealed'));
    expect(inkCost('plate_chest', 'spiritsealed')).toBeGreaterThan(inkCost('plate_feet', 'votive'));
    expect(inkCost('plate_feet', 'votive')).toBeGreaterThan(0);
  });

  it('learns a pattern from any Jadeveil piece that enters the bag, and from no Empire one', () => {
    useAscentStore.getState().reset();
    useInventoryStore.setState({ bag: bagFrom({ gear: [] }) });
    const helm = itemTemplates.find((t) => t.id === 'plate_head_jade_bastion')!;
    const steel = itemTemplates.find((t) => t.id === 'plate_head_steel')!;
    useInventoryStore.getState().addItem(itemFromTemplate(steel));
    expect(useAscentStore.getState().patterns).toEqual([]);
    useInventoryStore.getState().addItem(itemFromTemplate(helm));
    useInventoryStore.getState().addItem(itemFromTemplate(helm));
    expect(useAscentStore.getState().patterns).toEqual(['jade_bastion']);
    useAscentStore.getState().reset();
  });

  it('spends Ink only when there is enough', () => {
    useAscentStore.getState().reset();
    useAscentStore.getState().addInk(5);
    expect(useAscentStore.getState().spendInk(6)).toBe(false);
    expect(useAscentStore.getState().spendInk(5)).toBe(true);
    expect(useAscentStore.getState().ink).toBe(0);
  });

  it('gives back Ink for the range\'s gear when it is salvaged, and none for the Empire\'s', () => {
    const helm = itemFromTemplate(itemTemplates.find((t) => t.id === 'plate_head_jade_bastion')!);
    const votive = itemFromTemplate(itemTemplates.find((t) => t.id === 'plate_head_votive')!);
    const steel = itemFromTemplate(itemTemplates.find((t) => t.id === 'plate_head_steel')!);
    expect(salvageInk(helm)).toBeGreaterThan(salvageInk(votive));
    expect(salvageInk(votive)).toBeGreaterThan(0);
    expect(salvageInk(steel)).toBe(0);
    expect(salvageOutcome(helm).ink).toBe(salvageInk(helm));
  });

  it('saves only whole Ink and world patterns, once each', () => {
    expect(isAscentForge({ ink: 3, patterns: ['votive', 'jade_bastion'] })).toBe(true);
    expect(isAscentForge({ ink: 1.5, patterns: [] })).toBe(false);
    expect(isAscentForge({ ink: 0, patterns: ['steel'] })).toBe(false);
    expect(isAscentForge({ ink: 0, patterns: ['votive', 'votive'] })).toBe(false);
    expect(isAscentForge(undefined)).toBe(false);
  });
});

describe('the authored weapons', () => {
  const fang = itemFromTemplate(itemTemplates.find((t) => t.id === KAIRENS_FANG)!);
  const staff = itemFromTemplate(itemTemplates.find((t) => t.id === MONASTERY_BELLSTAFF)!);

  it('are held by exactly the paths whose vocabulary holds their form', () => {
    for (const path of ALL_PATHS) {
      const hero = { heroClass: PATH_CLASS[path], masteryPath: path };
      const holds = (item: Item) =>
        !!itemTemplates.find((t) => t.id === item.templateId)!.classLock!.includes(PATH_CLASS[path])
        && MASTERY_WEAPON_FORMS[path].includes(item.form);
      expect({ path, fang: wearable(fang, hero) }).toEqual({ path, fang: holds(fang) });
      expect({ path, staff: wearable(staff, hero) }).toEqual({ path, staff: holds(staff) });
    }
    expect(ALL_PATHS.filter((p) => wearable(fang, { heroClass: PATH_CLASS[p], masteryPath: p }))).toEqual(['skirmisher']);
    expect(ALL_PATHS.filter((p) => wearable(staff, { heroClass: PATH_CLASS[p], masteryPath: p })))
      .toEqual(['pyromancer', 'hydromancer', 'stormcaller', 'firefly']);
  });

  it('make Basic Attacks of their own', () => {
    expect(weaponAttackId(fang)).toBe('dragon_fang');
    expect(weaponAttackId(staff)).toBe('bell_toll');
    expect(weaponAttackId(itemFromTemplate(itemTemplates.find((t) => t.id === 'spear_iron')!))).toBe('reach');
  });

  it('are found: the Fang from Kairen at a chance, the Bellstaff in the Silent Hall\'s first chest', () => {
    const options: LootOptions = { party: PARTY, rng: seeded(5), world: 'jadeveil' };
    expect(summitGuaranteedPieces(options).map((i) => i.templateId)).not.toContain(KAIRENS_FANG);
    const hall = lairChestRewards(BELLSTAFF_LAIR, 'jadeveil', 'legendary', MASTERIES, { ...options, rng: seeded(6) });
    expect(hall.items.map((i) => i.templateId)).toContain(MONASTERY_BELLSTAFF);
    const silk = lairChestRewards('lair_silk', 'jadeveil', 'legendary', MASTERIES, { ...options, rng: seeded(6) });
    expect(silk.items.map((i) => i.templateId)).not.toContain(MONASTERY_BELLSTAFF);
    expect(authoredDrop('no_such_piece', options)).toBeNull();
  });
});

describe('a seeded acquisition audit of a Jadeveil campaign', () => {
  /**
   * Thirty ordinary fights, four shrines, both lairs (boss and two chests), then
   * Kairen at every tier — for a party of four in three weights, the Druid and
   * the Monk sharing vestments.
   */
  function campaign(seed: number) {
    const rng = seeded(seed);
    const options: LootOptions = { world: 'jadeveil', party: PARTY, rng, ground: { band: 3, level: 22 } };
    const items: Item[] = [];
    let inkToFirstKill = 0;
    const summits: { pieces: Item[]; ink: number }[] = [];
    const fight = (enemies: EnemyTemplate[], id: string) => {
      items.push(...rollLoot(enemies, options));
      inkToFirstKill += fightInk(enemies, id, rng);
    };
    for (let i = 0; i < 30; i++) fight([enemy('normal'), enemy('normal'), enemy('normal'), enemy('elite')], `wild_${i}`);
    for (let i = 1; i <= 4; i++) fight([enemy('normal'), enemy('normal'), enemy('elite'), enemy('elite')], `shrine_${i}`);
    for (const lair of ['lair_silk', 'lair_hall']) {
      fight([enemy('boss'), enemy('elite')], `${lair}_boss`);
      for (const kit of ['legendary', 'epics'] as const) {
        const chest = lairChestRewards(lair, 'jadeveil', kit, MASTERIES, options);
        items.push(...chest.items);
        inkToFirstKill += chest.ink;
      }
    }
    for (let tier = 1; tier <= 5; tier++) {
      const guaranteed = summitGuaranteedPieces(options);
      const won = [...rollLoot([enemy('boss')], options), ...rollChest(MASTERIES, options), ...guaranteed];
      items.push(...won);
      const ink = fightInk([enemy('boss')], `summit_kairen_${tier}`, rng);
      if (tier === 1) inkToFirstKill += ink;
      summits.push({ pieces: won, ink });
    }
    return { items, inkToFirstKill, summits };
  }

  const ALL_COLLECTIONS_INK = COLLECTION_IDS
    .flatMap((c) => collectionForms(c).map((f) => inkCost(f, c)))
    .reduce((a, b) => a + b, 0);

  it.each([1, 2, 3, 4, 5])('gives a meaningful but finite chase (seed %i)', (seed) => {
    const { items, inkToFirstKill } = campaign(seed);
    const pieces = items.filter((i) => isCollectionMotif(i.motif));
    const distinct = new Set(pieces.map((i) => i.templateId));

    // Meaningful: every weight the party wears is paid at least one piece, so
    // each wearer's forge pattern is learned, and the range's motifs turn up
    for (const weight of new Set(PARTY.map((h) => MASTERY_ARMOUR_WEIGHT[h.masteryPath!]))) {
      const collection = COLLECTION_IDS.find((c) => COLLECTION_WEIGHT[c] === weight)!;
      expect({ weight, found: pieces.some((i) => i.motif === collection) }).toEqual({ weight, found: true });
    }
    expect(items.some((i) => JADEVEIL_MOTIFS.includes(i.motif))).toBe(true);
    expect(items.some((i) => i.templateId === MONASTERY_BELLSTAFF)).toBe(true);

    // Finite: the drops do not complete the catalogue, and the Ink earned to
    // the first kill cannot forge the rest outright
    expect(distinct.size).toBeLessThan(16);
    expect(inkToFirstKill).toBeLessThan(ALL_COLLECTIONS_INK);
    // ...but it finishes a collection a piece was found of
    const someCollection = Math.min(...COLLECTION_IDS.map((c) => collectionForms(c)
      .filter((f) => !distinct.has(`${f}_${c}`))
      .reduce((n, f) => n + inkCost(f, c), 0)));
    expect(inkToFirstKill).toBeGreaterThanOrEqual(someCollection);
  });

  it('hands the shared vestments to both the Druid and the Monk', () => {
    const vestments = itemTemplates.filter((t) => t.motif === 'monastery_oath').map(itemFromTemplate);
    for (const piece of vestments) {
      expect(wearable(piece, PARTY[2])).toBe(true);
      expect(wearable(piece, PARTY[3])).toBe(true);
    }
  });

  it('keeps every Kairen tier rewarding: a collection piece for somebody, and more Ink the higher it is', () => {
    for (const seed of [1, 2, 3]) {
      const { summits } = campaign(seed);
      for (const [i, summit] of summits.entries()) {
        const forParty = summit.pieces.filter((p) => isCollectionMotif(p.motif) && PARTY.some((h) => wearable(p, h)));
        expect({ tier: i + 1, piece: forParty.length > 0 }).toEqual({ tier: i + 1, piece: true });
        if (i > 0) expect(summit.ink).toBeGreaterThan(summits[i - 1].ink);
      }
    }
  });

  it('never aims a guaranteed piece at a hero who cannot wear it', () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const hero of PARTY) {
        const [piece] = summitGuaranteedPieces({ party: [hero], rng: seeded(seed), world: 'jadeveil' });
        expect({ seed, hero: hero.masteryPath, ok: wearable(piece, hero) }).toEqual({ seed, hero: hero.masteryPath, ok: true });
      }
    }
  });
});

describe('the generator', () => {
  it('lists every world motif a form is minted in, and only world motifs', () => {
    for (const form of FORM_IDS) {
      for (const motif of worldMotifsFor(form)) {
        expect(motifWorld(motif)).toBeDefined();
        expect(itemTemplates.some((t: ItemTemplate) => t.form === form && t.motif === motif)).toBe(true);
      }
    }
  });
});
