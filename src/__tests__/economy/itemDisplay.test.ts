import {
  deltaLines,
  formatItemModifiers,
  formatTemplateModifiers,
  itemModifierLines,
  itemWearerLine,
  modifierLines,
  noStatChange,
} from '@/data/display/itemDisplay';
import { itemTemplates } from '@/data/items/itemTemplates';
import { armourWeightOf } from '@/data/items/itemForms';
import { heroClassName } from '@/data/display/heroDisplay';
import { modifierDelta } from '@/systems/progression/equipRules';
import { upgraded } from '@/systems/progression/upgrades';
import { mintItem } from '@/systems/economy/itemFactory';
import { BALANCE } from '@/data/balanceConstants';
import { Item, ItemModifiers, Rarity } from '@/models/types';
import { itemName } from '@/data/items/itemText';

/** A real legendary as it drops, then `plus` Crystals on. */
const legendaryAt = (plus: number): Item => {
  const t = itemTemplates.find((x) => x.rarity === Rarity.Legendary)!;
  let out = mintItem(t, () => 0);
  for (let i = 0; i < plus; i++) out = upgraded(out);
  return out;
};

describe('item modifier display', () => {
  /**
   * The reason the entry point takes an item rather than its modifiers.
   *
   * Three copies of this formatter existed, and two call sites — the equip
   * picker and the shop's sell list — passed raw `item.modifiers`, so a `+3`
   * legendary advertised its base numbers in exactly the two screens where the
   * player decides what to wear and what to sell.
   */
  it('prices the upgrade in without being asked', () => {
    const plain = legendaryAt(0);
    const forged = legendaryAt(BALANCE.MAX_UPGRADE_LEVEL);

    const lines = Object.fromEntries(itemModifierLines(forged).map((l) => [l.key, l.value]));
    expect(lines).toEqual(forged.modifiers);
    expect(formatItemModifiers(forged)).not.toBe(formatItemModifiers(plain));
  });

  it('leaves a template alone — nothing has been forged yet', () => {
    expect(formatTemplateModifiers({ modifiers: { attack: 10 } })).toBe('+10 Attack');
  });

  // `+${v}` rendered a penalty as `+-3`
  it('signs a penalty once', () => {
    expect(formatTemplateModifiers({ modifiers: { speed: -3 } })).toBe('-3 Speed');
  });

  it('names maxHp as HP and spaces the rest', () => {
    expect(modifierLines({ maxHp: 5 })[0].label).toBe('HP');
    expect(modifierLines({ critChance: 5 })[0].label).toBe('Crit Chance');
    expect(modifierLines({ armourPen: 5 })[0].label).toBe('Armour Pen');
  });

  it('shows the two penetrations apart, both as percentages', () => {
    expect(modifierLines({ armourPen: 6, magicPen: 8 }).map((l) => `${l.text} ${l.label}`))
      .toEqual(['+6% Armour Pen', '+8% Magic Pen']);
  });

  it('says nothing about a stat an item does not carry', () => {
    expect(modifierLines({ attack: 10, defense: 0 }).map((l) => l.key)).toEqual(['attack']);
    expect(formatTemplateModifiers({ modifiers: {} })).toBe('');
  });

  /**
   * The joined form and the per-line form are two layouts of one rule — the
   * reward dialog stacks them, the bag joins them, and neither gets to disagree
   * about which stats count or how a number reads.
   */
  it('keeps the joined form and the line form in step', () => {
    const forged = { modifiers: { attack: 10, maxHp: 20, speed: -1 } } as Item;
    const lines = itemModifierLines(forged);
    expect(formatItemModifiers(forged)).toBe(lines.map((l) => `${l.text} ${l.label}`).join('  '));
  });
});

/**
 * Who an item is for, said on the price tag.
 *
 * The locks always existed; the only place they spoke was `canEquip`'s refusal,
 * after the gold was spent. The forge, the shop and the market read this line.
 */
describe('itemWearerLine', () => {
  it('has an answer for every template in the library', () => {
    const blank = itemTemplates.filter((t) => !itemWearerLine(t));
    expect(blank).toEqual([]);
  });

  it('never leaks the internal class enum', () => {
    // `warrior` on a price tag is the fifth vocabulary heroNaming.test.ts
    // exists to keep out of the game
    const leaking = itemTemplates
      .map((t) => itemWearerLine(t))
      .filter((line) => /\b(warrior|mage|healer|ranger)\b/.test(line));
    expect(leaking).toEqual([]);
  });

  it('names the set path on a mastery piece', () => {
    const setPiece = itemTemplates.find((t) => t.masteryLock?.length);
    expect(setPiece).toBeDefined();
    expect(itemWearerLine(setPiece!)).toMatch(/only$/);
    expect(itemWearerLine(setPiece!)).not.toMatch(/Anyone/);
  });

  it('narrows a weapon to the paths that carry it', () => {
    // The greatsword is the Berserker's alone among Champion paths, so the tag
    // must say so — a Champion buying one for a Bulwark is the mistake the
    // line exists to prevent.
    const greatsword = itemTemplates.find((t) => t.form === 'greatsword' && !t.masteryLock);
    expect(greatsword).toBeDefined();
    const line = itemWearerLine(greatsword!);
    expect(line).toContain(heroClassName(greatsword!.classLock![0]));
    expect(line).toContain('Berserker');
    expect(line).not.toContain('Bulwark');
  });

  it('calls an unlocked common what it is', () => {
    const open = itemTemplates.find((t) => !t.classLock && !t.masteryLock && !t.offHandKind
      && !armourWeightOf(t.form));
    expect(open).toBeDefined();
    expect(itemWearerLine(open!)).toBe('Anyone');
  });

  // Common armour has no lock but is held to its weight like any other
  it('names the weight’s wearers on common armour', () => {
    const plain = itemTemplates.find((t) => t.id === 'plate_chest_plain')!;
    expect(plain.classLock).toBeUndefined();
    expect(itemWearerLine(plain)).toBe(itemWearerLine(itemTemplates.find((t) => t.id === 'plate_chest_steel')!));
    expect(itemWearerLine(plain)).toMatch(/Monk · Beetle/);
  });
});

/**
 * A material motif names itself differently on an implement.
 *
 * The cross-product produced an "Iron Orb" and an "Iron Staff" — a blacksmith's
 * adjective on a conjurer's tool, which a playtest read as a generator seam.
 * The rule is one word per material (`usesImplementWord`), stats and models
 * untouched, so the pins here are about the *names* the library actually ships.
 */
describe('implement naming', () => {
  const names = new Set(itemTemplates.map(itemName));

  it('never says a smithing word on a conjuring tool', () => {
    const seams = itemTemplates
      .map(itemName)
      .filter((n) => /^(Iron|Steel|Silver) (Orb|Staff|Wand|Tome|Totem|Branch|Cudgel)$/.test(n));
    expect(seams).toEqual([]);
  });

  it('renames rather than deleting — the same items exist under implement words', () => {
    for (const name of ['Leaden Orb', 'Tempered Staff', 'Silvered Branch']) {
      expect(names.has(name)).toBe(true);
    }
  });

  it('leaves arms, armour and jewellery exactly as they were', () => {
    for (const name of ['Iron Long Sword', 'Iron Band', 'Gilded Staff']) {
      expect(names.has(name)).toBe(true);
    }
  });
});

/**
 * The swap comparison, which the equip picker and the confirmation dialog both
 * render and must not word differently.
 */
describe('swap deltas', () => {
  const wearable = (modifiers: ItemModifiers) => ({ id: 'x', modifiers }) as Item;

  /**
   * The reason this is not `key === 'maxHp' ? 'HP' : key` at the call site,
   * which is what the picker rendered: `label()` already existed one function
   * up, and the inline copy showed `critChance` where the item's own modifier
   * line directly above it said `Crit Chance`.
   */
  it('names a stat the way the item itself does', () => {
    const lines = deltaLines(modifierDelta(wearable({ critChance: 8, maxHp: 10 }), undefined));
    expect(lines.map((l) => l.label).sort()).toEqual(['Crit Chance', 'HP']);
    expect(modifierLines({ critChance: 8 })[0].label).toBe('Crit Chance');
  });

  it('signs each way once, and says which way it went', () => {
    const lines = deltaLines(
      modifierDelta(wearable({ attack: 12, speed: 1 }), wearable({ attack: 5, speed: 4 })),
    );
    expect(lines.map((l) => [l.text, l.direction])).toEqual([
      ['+7', 'up'],
      ['-3', 'down'],
    ]);
  });

  // A blank where the comparison should be reads as a bug, not as an answer
  it('has something to say about a stat-neutral swap', () => {
    const same = { attack: 4, maxHp: 6 };
    expect(deltaLines(modifierDelta(wearable(same), wearable(same)))).toEqual([]);
    expect(noStatChange()).not.toBe('');
  });

  /**
   * Both sides are worn at their upgrade level, so a `+3` legendary is not
   * compared against its own template — that is `modifierDelta`'s rule, and the
   * point of taking its output rather than raw modifiers is that a display
   * helper cannot opt out of it.
   */
  it('compares what is actually worn, upgrades included', () => {
    const forged = legendaryAt(BALANCE.MAX_UPGRADE_LEVEL);
    const plain = legendaryAt(0);
    const lines = deltaLines(modifierDelta(forged, plain));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.direction === 'up')).toBe(true);
  });
});
