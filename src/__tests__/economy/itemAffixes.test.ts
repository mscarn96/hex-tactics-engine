import { pathName } from '@/data/gameText';
import { AffixId, HeroClass, ItemTemplate, Rarity, MotifId } from '@/models/types';
import {
  AFFIXES,
  affinityClasses,
  affixCount,
  affixPool,
  applyAffixes,
  findAffix,
  rollAffixes,
} from '@/data/items/itemAffixes';
import { itemTemplates } from '@/data/items/itemTemplates';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { MOTIFS, isMasteryMotif } from '@/data/items/motifs';
import { itemFromTemplate, mintItem } from '@/systems/economy/itemFactory';
import { formatAffixes } from '@/data/display/itemDisplay';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import { affixName, itemName } from '@/data/items/itemText';
import { t, type MessageKey } from '@/i18n';
import { composeName } from '@/i18n/grammar';

/**
 * The layer that makes two Frostbound Long Swords different swords.
 *
 * Form × motif is a good library and a poor drop table: it produces exactly one
 * Frostbound Long Sword, and every one a player ever finds is a copy of it. The
 * rules pinned here are the four that keep affixes from being noise —
 * **commons stay clean**, **an affix is never a dead roll**, **it has a name**,
 * and **it is rolled at acquisition rather than at every render**.
 */

const byId = (id: string): ItemTemplate => itemTemplates.find((t) => t.id === id)!;

/** A deterministic `rng` cycling the values given, for pinning a roll. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('who rolls what', () => {
  it('leaves commons clean, always', () => {
    expect(affixCount(Rarity.Common)).toBe(0);
    const common = byId('long_sword_plain');
    expect(common.rarity).toBe(Rarity.Common);
    expect(rollAffixes(common, () => 0)).toEqual([]);
    expect(mintItem(common, () => 0).affixes).toBeUndefined();
  });

  it('gives a rare one and an epic two', () => {
    expect(affixCount(Rarity.Rare)).toBe(1);
    expect(affixCount(Rarity.Epic)).toBe(2);
    expect(affixCount(Rarity.Legendary)).toBe(2);
  });

  /**
   * A single roll is the suffix, because a suffix is the half that says what the
   * piece is *for* — "of the Viper" is more informative than "Keen".
   */
  it('spends a single roll on the suffix', () => {
    const rare = itemTemplates.find((t) => t.rarity === Rarity.Rare && t.slot === 'mainHand')!;
    const [id] = rollAffixes(rare, () => 0);
    expect(findAffix(id)!.kind).toBe('suffix');
  });

  it('gives an epic one of each kind, so the name has room for both', () => {
    const epic = itemTemplates.find((t) => t.rarity === Rarity.Epic)!;
    const kinds = rollAffixes(epic, () => 0).map((id) => findAffix(id)!.kind);
    expect([...kinds].sort()).toEqual(['prefix', 'suffix']);
  });
});

describe('an affix is never a dead roll', () => {
  /**
   * Heal power on a greatsword is a rider nothing that holds it will ever use,
   * and a dead roll is *worse* than no affix — it looks like the piece rolled
   * something. Affinity is derived from the item rather than authored per item.
   */
  it('reads classes off the lock, the off-hand kind, then the motif', () => {
    expect(affinityClasses(byId('greatsword_steel'))).toEqual([HeroClass.Warrior]);
    expect(affinityClasses(byId('quiver_steel'))).toEqual([HeroClass.Ranger]);
    // The focus is the Arcanist's and the Firefly's
    expect(affinityClasses(byId('orb_steel'))).toEqual([HeroClass.Mage, HeroClass.Monk]);
    // A pendant has neither a lock nor an off-hand kind, so its motif decides
    expect(affinityClasses(byId('pendant_holy'))).toEqual([HeroClass.Healer, HeroClass.Monk]);
  });

  it('keeps a healer’s affixes off a champion’s weapon', () => {
    const pool = [
      ...affixPool(byId('greatsword_steel'), 'prefix'),
      ...affixPool(byId('greatsword_steel'), 'suffix'),
    ].map((a) => a.id);
    expect(pool).not.toContain('blessed');
    expect(pool).not.toContain('of_the_grove');
    expect(pool).not.toContain('of_the_viper');
  });

  it('offers a Hunter its venom and a Druid its grove', () => {
    expect(affixPool(byId('dagger_steel'), 'suffix').map((a) => a.id)).toContain('of_the_viper');
    expect(affixPool(byId('branch_holy'), 'prefix').map((a) => a.id)).toContain('blessed');
  });

  /**
   * `itemGen` already refuses to allocate armour penetration below Epic, so an
   * affix granting it on a rare would fall through that function's "give it
   * something" fallback and hand out a token point. The gate is named here so
   * the refusal is legible rather than an artefact.
   */
  it('holds armour penetration back to the tier that may carry it', () => {
    const rareBlade = byId('long_sword_steel');
    const epicBlade = { ...rareBlade, rarity: Rarity.Epic };
    expect(rareBlade.rarity).toBe(Rarity.Rare);
    expect(affixPool(rareBlade, 'prefix').map((a) => a.id)).not.toContain('sundering');
    expect(affixPool(epicBlade, 'prefix').map((a) => a.id)).toContain('sundering');
  });

  /**
   * Penetration comes in two halves and each class rolls the half it can spend:
   * a mage's piece offers Magic Pen (Piercing, of Unmaking), a martial piece
   * Armour Pen (Sundering, of Ruin), and neither offers the other's.
   */
  it('rolls the penetration that matches the item’s class', () => {
    const epic = (id: string): ItemTemplate => ({ ...byId(id), rarity: Rarity.Epic });
    const poolOf = (t: ItemTemplate) =>
      [...affixPool(t, 'prefix'), ...affixPool(t, 'suffix')].map((a) => a.id);

    const mage = poolOf(epic('orb_steel'));
    expect(mage).toEqual(expect.arrayContaining(['piercing', 'of_unmaking']));
    expect(mage).not.toContain('sundering');
    expect(mage).not.toContain('of_ruin');

    for (const martial of ['greatsword_steel', 'quiver_steel']) {
      const pool = poolOf(epic(martial));
      expect(pool).toEqual(expect.arrayContaining(['sundering', 'of_ruin']));
      expect(pool).not.toContain('piercing');
      expect(pool).not.toContain('of_unmaking');
    }
  });

  it('gives each penetration affix only its own stat', () => {
    const orb = { ...itemFromTemplate(byId('orb_steel')), rarity: Rarity.Legendary };
    const piercing = applyAffixes(orb, ['piercing', 'of_unmaking']).modifiers;
    expect(piercing.magicPen).toBeGreaterThan(0);
    expect(piercing.armourPen).toBeUndefined();

    const sword = { ...itemFromTemplate(byId('greatsword_steel')), rarity: Rarity.Legendary };
    const sundering = applyAffixes(sword, ['sundering', 'of_ruin']).modifiers;
    expect(sundering.armourPen).toBeGreaterThan(0);
    expect(sundering.magicPen).toBeUndefined();
  });

  it('holds magic penetration back to the tier that may carry it', () => {
    const rareOrb = byId('orb_steel');
    expect(rareOrb.rarity).toBe(Rarity.Rare);
    expect(affixPool(rareOrb, 'prefix').map((a) => a.id)).not.toContain('piercing');
    expect(affixPool(rareOrb, 'suffix').map((a) => a.id)).not.toContain('of_unmaking');
    expect(affixPool({ ...rareOrb, rarity: Rarity.Epic }, 'prefix').map((a) => a.id)).toContain('piercing');
  });

  /**
   * The buff: a legendary pen or lifesteal roll is a number a player can feel.
   * A legendary cowl was +1% lifesteal and +1–2% pen; the helm is the smallest
   * armour budget, so it is the floor of the legendary range.
   */
  it('makes a legendary pen or lifesteal roll worth having', () => {
    const helm = itemTemplates.find((t) => t.rarity === Rarity.Legendary && t.slot === 'head')!;
    const at = (affix: AffixId) => {
      const base = itemFromTemplate(helm);
      const mods = applyAffixes(base, [affix]).modifiers;
      return (key: 'armourPen' | 'magicPen' | 'lifesteal') => (mods[key] ?? 0) - (base.modifiers[key] ?? 0);
    };
    expect(at('sundering')('armourPen')).toBeGreaterThanOrEqual(6);
    expect(at('piercing')('magicPen')).toBeGreaterThanOrEqual(6);
    expect(at('vampiric')('lifesteal')).toBeGreaterThanOrEqual(4);
    // …and a rare one stays modest
    const rareHelm = itemTemplates.find((t) => t.rarity === Rarity.Rare && t.slot === 'head')!;
    const rare = applyAffixes(itemFromTemplate(rareHelm), ['vampiric']).modifiers.lifesteal ?? 0;
    expect(rare).toBeLessThanOrEqual(2);
  });

  /** Every item in the library has to be able to roll *something*, or its tier is a lie. */
  it('leaves no rare-or-better item with an empty pool', () => {
    const barren: string[] = [];
    for (const template of itemTemplates) {
      if (affixCount(template.rarity) === 0) continue;
      if (rollAffixes(template, () => 0).length === 0) barren.push(template.id);
    }
    expect(barren).toEqual([]);
  });

  /** Twenty-two affixes, eleven of each kind, and no id authored twice. */
  it('has a well-formed table', () => {
    const ids = AFFIXES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(AFFIXES.filter((a) => a.kind === 'prefix')).toHaveLength(11);
    expect(AFFIXES.filter((a) => a.kind === 'suffix')).toHaveLength(11);
    const untilted = AFFIXES.filter((a) => Object.keys(a.tilt).length === 0);
    expect(untilted).toEqual([]);
  });
});

describe('what an affix does to the item', () => {
  const rare = byId('long_sword_steel');

  it('adds stats on top of the base rather than carving them out of it', () => {
    const base = itemFromTemplate(rare);
    const affixed = applyAffixes(base, ['of_the_duelist']);
    // Nothing the base had went down — an affix has to be good news, or the
    // player learns to want the clean one
    for (const [key, value] of Object.entries(base.modifiers)) {
      expect(affixed.modifiers[key as 'attack']).toBeGreaterThanOrEqual(value as number);
    }
    expect(affixed.modifiers.critChance).toBeGreaterThan(0);
  });

  it('puts the prefix in front and the suffix behind', () => {
    const affixed = applyAffixes(itemFromTemplate(rare), ['keen', 'of_fury']);
    expect(itemName(affixed)).toBe(`Keen ${itemName(rare)} of Fury`);
  });

  it('records which riders they were, so a screen can name them', () => {
    const affixed = applyAffixes(itemFromTemplate(rare), ['keen', 'of_fury']);
    expect(affixed.affixes).toEqual(['keen', 'of_fury']);
    expect(formatAffixes(affixed)).toBe('Keen · of Fury');
  });

  it('changes nothing at all when nothing rolled', () => {
    const base = itemFromTemplate(rare);
    expect(applyAffixes(base, [])).toBe(base);
  });

  /**
   * The stats are baked into `modifiers`, so every consumer downstream —
   * `statCalc`, `effectiveModifiers`, the equip comparison — gets them without
   * learning the mechanic exists. That is the same deal the item level gets.
   */
  it('reaches the hero sheet with no consumer knowing why', () => {
    const affixed = { ...applyAffixes(itemFromTemplate(rare), ['keen']), id: 'i1' };
    const hero = {
      id: 'h', templateId: 'warrior' as const, name: 'H', heroClass: HeroClass.Warrior,
      level: 1, xp: 0,
      baseStats: { maxHp: 10, attack: 1, defense: 1, magic: 1, speed: 1, moveRange: 3, maxMana: 0 },
      currentHp: 10, currentMana: 0, skills: [], equipment: { mainHand: 'i1' },
      masteryPath: null, masteryPoints: 0, masteryNodes: {},
    };
    expect(getEffectiveStats(hero, [affixed]).critChance).toBeGreaterThan(5);
  });
});

describe('rolled at acquisition, not at every render', () => {
  /**
   * `itemFromTemplate` is the *catalogue* answer and `mintItem` is the
   * *acquisition* answer. Rolling inside the first would make the forge's
   * preview disagree with what the forge produced — the one comparison the
   * building exists to support.
   */
  it('leaves the catalogue answer free of dice', () => {
    const rare = byId('long_sword_steel');
    const a = itemFromTemplate(rare);
    const b = itemFromTemplate(rare);
    expect(itemName(a)).toBe(itemName(rare));
    expect(a).toEqual(b);
    expect(a.affixes).toBeUndefined();
  });

  it('rolls once on the acquisition answer', () => {
    const rare = byId('long_sword_steel');
    const minted = mintItem(rare, seq(0.1));
    expect(minted.affixes).toHaveLength(1);
    expect(itemName(minted)).not.toBe(itemName(rare));
  });

  it('is reproducible from its rng, so a roll can be pinned', () => {
    const rare = byId('long_sword_steel');
    const ids: AffixId[][] = [0, 1].map(() => mintItem(rare, seq(0.4)).affixes!);
    expect(ids[0]).toEqual(ids[1]);
  });

  /** A roll of exactly 1 must not index past the end of the pool. */
  it('survives an rng that returns its own upper bound', () => {
    const epic = itemTemplates.find((t) => t.rarity === Rarity.Epic)!;
    expect(() => mintItem(epic, () => 1)).not.toThrow();
    expect(mintItem(epic, () => 1).affixes).toHaveLength(2);
  });
});

/**
 * An item name must not borrow a mastery path's name unless the piece really is
 * that path's set. "Bronze Circlet of the Bulwark" was a Druid circlet whose
 * suffix read as Bulwark gear, and a Bulwark player looted it and could not wear it.
 */
describe('names do not suggest a mastery path the piece is not locked to', () => {
  /** The ids of the paths a piece of text names, by id or display name. */
  const mentions = (text: string) =>
    MASTERY_PATHS
      .filter((p) => [p.id, pathName(p)].some((n) => text.toLowerCase().includes(n.toLowerCase())))
      .map((p) => String(p.id));

  it("reads every path name from MASTERY_PATHS, the Monk's as they land", () => {
    expect(MASTERY_PATHS.length).toBeGreaterThanOrEqual(12);
    expect(MASTERY_PATHS.map((p) => p.id)).toContain('mantis');
    expect(MASTERY_PATHS.map((p) => p.id)).toContain('beetle');
  });

  it('keeps every affix name free of path names', () => {
    for (const affix of AFFIXES) expect(mentions(affixName(affix.id))).toEqual([]);
  });

  it('keeps every non-mastery motif adjective free of path names', () => {
    for (const id of Object.keys(MOTIFS) as MotifId[]) {
      if (isMasteryMotif(id)) continue;
      expect(mentions(composeName(t(`items.motif.${id}.pattern` as MessageKey), '', 'm'))).toEqual([]);
    }
  });

  it('only a path-locked template carries its path in its name', () => {
    for (const template of itemTemplates) {
      for (const path of mentions(itemName(template))) {
        const locks = (template.masteryLock ?? []).map(String);
        expect(locks).toContain(path);
      }
    }
  });
});
