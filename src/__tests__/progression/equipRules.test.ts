import {
  canEquip,
  canDualWield,
  illegalSlots,
  modifierDelta,
  slotsFor,
  slotAccepts,
  EquippedItems,
  equipRefusalText,
} from '@/systems/progression/equipRules';
import { itemTemplates, masteryIssue, MASTERY_STARTER_WEAPONS, STARTER_KIT } from '@/data/items/itemTemplates';
import {
  FORMS, MASTERY_ARMOUR_WEIGHT, MASTERY_WEAPON_FORMS, PATH_CLASS, armourWeightOf, pathsOfClass,
  setFormsOf, wearableWeights,
} from '@/data/items/itemForms';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { itemFromTemplate, mintItem } from '@/systems/economy/itemFactory';
import { upgraded } from '@/systems/progression/upgrades';
import {
  EQUIP_SLOTS, EquipSlot, FormId, Hero, HeroClass, Item, MasteryId, Rarity,
} from '@/models/types';

function item(templateId: string, overrides: Partial<Item> = {}): Item {
  const template = itemTemplates.find((t) => t.id === templateId);
  if (!template) throw new Error(`no such template: ${templateId}`);
  return { ...itemFromTemplate(template), id: `inst_${templateId}`, ...overrides };
}

function hero(heroClass: HeroClass, masteryPath: MasteryId | null = null) {
  return { heroClass, masteryPath } as Pick<Hero, 'heroClass' | 'masteryPath'>;
}

const champion = hero(HeroClass.Warrior);
const arcanist = hero(HeroClass.Mage);
const hunter = hero(HeroClass.Ranger);
const druid = hero(HeroClass.Healer);

describe('slot matching', () => {
  it('routes rings to either finger and everything else to one home', () => {
    expect(slotsFor('ring')).toEqual(['ring1', 'ring2']);
    expect(slotsFor('chest')).toEqual(['chest']);
    expect(slotAccepts('ring2', 'ring')).toBe(true);
    expect(slotAccepts('chest', 'ring')).toBe(false);
  });

  it('rejects an item put in the wrong slot', () => {
    const result = canEquip(champion, item('plate_head_iron'), 'chest', {});
    expect(result.ok).toBe(false);
  });
});

describe('class locks', () => {
  // Common armour carries no class lock but is still held to its weight
  // (`wearableWeights`): only the classes whose paths wear plate wear plain plate
  it('holds common armour to the weights a class’s paths wear', () => {
    expect(canEquip(champion, item('plate_chest_plain'), 'chest', {}).ok).toBe(true);
    expect(canEquip(champion, item('plate_head_iron'), 'head', {}).ok).toBe(true);
    for (const h of [arcanist, hunter, druid]) {
      expect(canEquip(h, item('plate_chest_plain'), 'chest', {}).ok).toBe(false);
      expect(canEquip(h, item('plate_head_iron'), 'head', {}).ok).toBe(false);
    }
    const refused = canEquip(arcanist, item('plate_chest_plain'), 'chest', {});
    if (!refused.ok) expect(equipRefusalText(refused.reason)).toMatch(/Arcanists do not wear plate/);
  });

  // The four original classes start in their paths' one weight, so the rule
  // takes nothing off them before or after the path. The Monk's apprentice
  // vestment is legal until its path, whose issue re-dresses a Beetle or Mantis
  it('lets every class wear its starter armour, the originals down every path', () => {
    const refused: string[] = [];
    for (const heroClass of Object.values(HeroClass)) {
      const paths = heroClass === HeroClass.Monk ? [null] : [null, ...pathsOfClass(heroClass)];
      for (const path of paths) {
        for (const templateId of STARTER_KIT[heroClass]) {
          const piece = item(templateId);
          if (!armourWeightOf(piece.form)) continue;
          if (!canEquip({ heroClass, masteryPath: path }, piece, piece.slot as EquipSlot, {}).ok) {
            refused.push(`${heroClass}/${path}/${templateId}`);
          }
        }
      }
    }
    expect(refused).toEqual([]);
  });

  it('locks common weapons to their class', () => {
    expect(canEquip(champion, item('short_sword_iron'), 'mainHand', {}).ok).toBe(true);
    expect(canEquip(arcanist, item('short_sword_iron'), 'mainHand', {}).ok).toBe(false);
    expect(canEquip(arcanist, item('wand_iron'), 'mainHand', {}).ok).toBe(true);
  });

  it('locks everything above common to its class', () => {
    expect(canEquip(champion, item('plate_chest_steel'), 'chest', {}).ok).toBe(true);
    expect(canEquip(hunter, item('plate_chest_steel'), 'chest', {}).ok).toBe(false);
  });

  it('explains why, so the UI can show a reason', () => {
    const result = canEquip(arcanist, item('short_sword_iron'), 'mainHand', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(equipRefusalText(result.reason)).toMatch(/Champions/);
  });
});

// The off-hand is class-defining: each class carries a different kind of thing
describe('off-hand kinds', () => {
  const cases: Array<[string, ReturnType<typeof hero>]> = [
    ['round_shield_plain', champion],
    ['quiver_plain', hunter],
    ['orb_plain', arcanist],
    ['fetish_plain', druid],
  ];

  it.each(cases)('%s is usable by its own class', (templateId, owner) => {
    expect(canEquip(owner, item(templateId), 'offHand', {}).ok).toBe(true);
  });

  it.each(cases)('%s is refused to every other class', (templateId, owner) => {
    const others = [champion, arcanist, hunter, druid].filter((h) => h !== owner);
    for (const h of others) {
      expect({ templateId, ok: canEquip(h, item(templateId), 'offHand', {}).ok })
        .toEqual({ templateId, ok: false });
    }
  });

  // Shields are gated by class, not by mastery — a level 1 Champion has one
  it('lets a Champion carry a shield before choosing a mastery', () => {
    expect(champion.masteryPath).toBeNull();
    expect(canEquip(champion, item('round_shield_plain'), 'offHand', {}).ok).toBe(true);
  });
});

describe('dual wielding', () => {
  const berserker = hero(HeroClass.Warrior, 'berserker');
  const bulwark = hero(HeroClass.Warrior, 'bulwark');

  it('is granted only by the dual-wield masteries', () => {
    expect(canDualWield(champion)).toBe(false);
    expect(canDualWield(bulwark)).toBe(false);
    expect(canDualWield(berserker)).toBe(true);
    expect(canDualWield(hero(HeroClass.Ranger, 'shadowblade'))).toBe(true);
  });

  it('refuses a second weapon without the mastery', () => {
    // A short sword is on the Berserker's own weapon list — the dual-wield
    // grant and the weapon lock are two separate gates and both have to pass,
    // so this has to be asked with a weapon the path actually carries
    expect(canEquip(champion, item('short_sword_steel'), 'offHand', {}).ok).toBe(false);
    expect(canEquip(berserker, item('short_sword_steel'), 'offHand', {}).ok).toBe(true);
  });

  it('holds the weapon lock in the off-hand too', () => {
    // A dual-wielder with an off-path weapon in the second fist is the same
    // problem wearing a different label — a long sword is the Templar's
    expect(canEquip(berserker, item('long_sword_steel'), 'offHand', {}).ok).toBe(false);
  });

  it('still refuses a shield to a Berserker', () => {
    // Berserker keeps its class lock on shields but gives up the shield itself
    expect(canEquip(berserker, item('tower_shield_steel'), 'offHand', {}).ok).toBe(false);
  });
});

describe('two-handed weapons', () => {
  const greatsword = item('greatsword_iron');
  const shield = item('round_shield_plain');

  it('displaces the off-hand when equipped', () => {
    const worn: EquippedItems = { offHand: shield };
    const result = canEquip(champion, greatsword, 'mainHand', worn);
    expect(result).toEqual({ ok: true, displaces: ['offHand'] });
  });

  it('displaces nothing when the off-hand is already free', () => {
    const result = canEquip(champion, greatsword, 'mainHand', {});
    expect(result).toEqual({ ok: true, displaces: [] });
  });

  it('is displaced in turn by filling the off-hand', () => {
    const worn: EquippedItems = { mainHand: greatsword };
    const result = canEquip(champion, shield, 'offHand', worn);
    expect(result).toEqual({ ok: true, displaces: ['mainHand'] });
  });

  it('cannot itself be held in the off-hand', () => {
    const berserker = hero(HeroClass.Warrior, 'berserker');
    expect(canEquip(berserker, greatsword, 'offHand', {}).ok).toBe(false);
  });
});

describe('duplicates', () => {
  it('allows two of the same non-legendary item', () => {
    const ring = item('band_plain');
    expect(canEquip(champion, ring, 'ring2', { ring1: ring }).ok).toBe(true);
  });

  it('refuses a second copy of a legendary', () => {
    const legendaryRing = item('band_plain', { rarity: Rarity.Legendary });
    const result = canEquip(champion, legendaryRing, 'ring2', { ring1: legendaryRing });
    expect(result.ok).toBe(false);
  });

  it('does not count the item against itself when re-checking its own slot', () => {
    const legendaryRing = item('band_plain', { rarity: Rarity.Legendary });
    expect(canEquip(champion, legendaryRing, 'ring1', { ring1: legendaryRing }).ok).toBe(true);
  });
});

describe('illegalSlots', () => {
  it('finds nothing wrong with a legal loadout', () => {
    const worn: EquippedItems = {
      mainHand: item('short_sword_iron'),
      offHand: item('round_shield_plain'),
      chest: item('plate_chest_plain'),
    };
    expect(illegalSlots(champion, worn)).toEqual([]);
  });

  // Drives the confirm dialog when a mastery is chosen
  it('reports a shield that a Berserker may no longer carry', () => {
    const worn: EquippedItems = {
      mainHand: item('short_sword_iron'),
      offHand: item('tower_shield_steel'),
    };
    const berserker = hero(HeroClass.Warrior, 'berserker');
    const bad = illegalSlots(berserker, worn);

    expect(bad).toHaveLength(1);
    expect(bad[0].slot).toBe('offHand');
    expect(bad[0].item.templateId).toBe('tower_shield_steel');
    expect(bad[0].reason).toBeTruthy();
  });

  it('does not flag a two-hander merely because its own off-hand pairing exists', () => {
    const worn: EquippedItems = { mainHand: item('greatsword_iron') };
    expect(illegalSlots(champion, worn)).toEqual([]);
  });
});

describe('starter kits', () => {
  it('every class can legally wear its own starter loadout', () => {
    const byClass: Array<[HeroClass, ReturnType<typeof hero>]> = [
      [HeroClass.Warrior, champion],
      [HeroClass.Mage, arcanist],
      [HeroClass.Healer, druid],
      [HeroClass.Ranger, hunter],
    ];

    for (const [heroClass, h] of byClass) {
      const { STARTER_KIT } = require('@/data/items/itemTemplates');
      const worn: EquippedItems = {};
      for (const templateId of STARTER_KIT[heroClass]) {
        const it = item(templateId);
        const slot = (it.slot === 'ring' ? 'ring1' : it.slot) as EquipSlot;
        const result = canEquip(h, it, slot, worn);
        expect({ heroClass, templateId, ok: result.ok }).toEqual({ heroClass, templateId, ok: true });
        worn[slot] = it;
      }
    }
  });
});

describe('template data integrity', () => {
  it('gives every template a slot', () => {
    for (const t of itemTemplates) {
      expect({ id: t.id, slot: t.slot }).toEqual({ id: t.id, slot: expect.any(String) });
    }
  });

  it('gives every off-hand item a kind, since that decides who may carry it', () => {
    for (const t of itemTemplates) {
      if (t.slot !== 'offHand') continue;
      expect({ id: t.id, kind: t.offHandKind }).toEqual({ id: t.id, kind: expect.any(String) });
    }
  });

  // Asserted through canEquip rather than through the classLock field: off-hands
  // are restricted by offHandKind instead, and the rule that matters is "only
  // one of the original classes can wear it", not "one particular field is set".
  // The Monk shares (the private project notes, "Equipment rules"): its forms
  // are its own and it borrows the others', so the four never share with each
  // other and nothing above common is wearable by nobody.
  it('restricts every non-common item to one original class, and the Monk', () => {
    const original = [HeroClass.Warrior, HeroClass.Mage, HeroClass.Healer, HeroClass.Ranger];
    const offenders: string[] = [];

    for (const t of itemTemplates) {
      if (t.rarity === Rarity.Common) continue;
      // Set pieces are locked harder than by class — see the test below
      if (t.masteryLock) continue;
      const inst = item(t.id);
      const takes = (c: HeroClass) => slotsFor(t.slot).some((slot) => canEquip(hero(c), inst, slot, {}).ok)
        // The Monk's main hand is locked before a path, so ask its paths too
        || pathsOfClass(c).some((p) => slotsFor(t.slot).some(
          (slot) => canEquip({ heroClass: c, masteryPath: p }, inst, slot, {}).ok));
      const takers = original.filter(takes);
      if (takers.length > 1) offenders.push(`${t.id} (${takers.length} classes)`);
      if (takers.length === 0 && !takes(HeroClass.Monk)) offenders.push(`${t.id} (nobody)`);
    }

    expect(offenders).toEqual([]);
  });

  // A legendary set piece narrows past class to a single path. Checked the same
  // way — through canEquip, not through the field — because "only a Shadowblade
  // can wear this" is the rule, and masteryLock is merely how it is spelled.
  // Every path the item rules know, the Monk's included: their sets are minted
  // ahead of their trees and are held to the same rule.
  it('restricts every set piece to the one path that owns it', () => {
    const allPaths = Object.keys(PATH_CLASS) as MasteryId[];
    const leaky: string[] = [];

    for (const t of itemTemplates) {
      if (!t.masteryLock) continue;
      const inst = item(t.id);
      const takers = allPaths.filter((path) => {
        const wearer = { ...hero(PATH_CLASS[path]), masteryPath: path as MasteryId };
        return slotsFor(t.slot).some((slot) => canEquip(wearer, inst, slot, {}).ok);
      });
      if (takers.length !== 1) leaky.push(`${t.id} (${takers.length} paths)`);
    }

    expect(leaky).toEqual([]);
  });

  it('refuses a set piece to a hero with no path at all', () => {
    const piece = itemTemplates.find((t) => t.masteryLock)!;
    const unspecialised = hero(HeroClass.Warrior);
    const takers = slotsFor(piece.slot).filter(
      (slot) => canEquip(unspecialised, item(piece.id), slot, {}).ok,
    );
    expect(takers).toEqual([]);
  });

  // Common armour's weight is asked of the wearer's path, not written as a lock
  it('leaves common armour unlocked and common weapons locked', () => {
    for (const t of itemTemplates) {
      if (t.rarity !== Rarity.Common) continue;
      if (t.slot === 'mainHand') {
        expect({ id: t.id, locked: !!t.classLock }).toEqual({ id: t.id, locked: true });
      } else {
        expect({ id: t.id, locked: !!t.classLock }).toEqual({ id: t.id, locked: false });
      }
    }
  });
});

// ─── Hero sheet layout ────────────────────────────────────────────────────────

describe('the paper-doll layout', () => {
  // The sheet lays slots out in three hardcoded columns rather than mapping
  // EQUIP_SLOTS, so a slot added to the type would render nowhere and simply be
  // unequippable — with nothing to notice it by
  const DOLL_COLUMNS: EquipSlot[][] = [
    ['mainHand', 'ring1'],
    ['head', 'neck', 'chest', 'legs', 'feet'],
    ['offHand', 'ring2'],
  ];

  it('shows every equipment slot exactly once', () => {
    const laidOut = DOLL_COLUMNS.flat();
    expect(laidOut.slice().sort()).toEqual(EQUIP_SLOTS.slice().sort());
    expect(new Set(laidOut).size).toBe(laidOut.length);
  });

  it('runs the armour down the middle in head-to-foot order', () => {
    expect(DOLL_COLUMNS[1]).toEqual(['head', 'neck', 'chest', 'legs', 'feet']);
  });

  it('puts one hand and one ring on each side', () => {
    expect(DOLL_COLUMNS[0]).toHaveLength(2);
    expect(DOLL_COLUMNS[2]).toHaveLength(2);
  });
});

/**
 * The arithmetic the player was doing in their head.
 *
 * Two lists of modifiers side by side is homework, and skipping it is how a
 * strictly worse item gets equipped — so the screen has to state the answer.
 */
describe('modifierDelta', () => {
  const plain = (mods: Item['modifiers'], over: Partial<Item> = {}): Item =>
    ({ id: 'x', name: 'x', rarity: Rarity.Common, modifiers: mods, ...over } as Item);

  it('reports every stat that moved, and nothing that did not', () => {
    const out = modifierDelta(
      plain({ attack: 8, maxHp: 10 }),
      plain({ attack: 5, maxHp: 10 }),
    );
    expect(out).toEqual([{ key: 'attack', delta: 3 }]);
  });

  it('counts a stat the candidate drops entirely as a loss', () => {
    const out = modifierDelta(plain({ attack: 5 }), plain({ attack: 5, defense: 4 }));
    expect(out).toEqual([{ key: 'defense', delta: -4 }]);
  });

  it('treats an empty slot as a straight gain', () => {
    expect(modifierDelta(plain({ attack: 4 }), undefined)).toEqual([
      { key: 'attack', delta: 4 },
    ]);
  });

  it('says nothing when the swap changes nothing', () => {
    expect(modifierDelta(plain({ attack: 5 }), plain({ attack: 5 }))).toEqual([]);
  });

  // Sorted best-first so the reason to take the item leads
  it('leads with the gains', () => {
    const out = modifierDelta(
      plain({ attack: 10, defense: 1 }),
      plain({ attack: 2, defense: 9 }),
    );
    expect(out.map((d) => d.key)).toEqual(['attack', 'defense']);
  });

  /**
   * An upgraded legendary is worth what it is worn at. Comparing base
   * modifiers against a `+3` would quietly recommend a downgrade — which is the
   * exact mistake the comparison exists to prevent.
   */
  it('resolves upgrade levels on both sides', () => {
    const t = itemTemplates.find((x) => x.rarity === Rarity.Legendary)!;
    const candidate = mintItem(t, () => 0);
    const worn = upgraded(upgraded(upgraded(candidate)));
    const deltas = modifierDelta(candidate, worn);
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.every((d) => d.delta < 0)).toBe(true);
  });
});

describe('what a mastery may carry', () => {
  const pathHero = (heroClass: HeroClass, masteryPath: MasteryId | null) =>
    ({ heroClass, masteryPath }) as Hero;
  const byForm = (form: string) => itemTemplates.find((t) => t.form === form)!;

  it('keeps a bow out of a Shadowblade’s hands', () => {
    const bow = itemFromTemplate(byForm('bow'));
    expect(canEquip(pathHero(HeroClass.Ranger, 'shadowblade'), bow, 'mainHand', {}).ok).toBe(false);
  });

  it('keeps a crossbow out too', () => {
    const crossbow = itemFromTemplate(byForm('crossbow'));
    expect(canEquip(pathHero(HeroClass.Ranger, 'shadowblade'), crossbow, 'mainHand', {}).ok).toBe(false);
  });

  // A dual-wielder holding a bow off-hand is the same problem in a different slot
  it('keeps a bow out of the off-hand as well', () => {
    const bow = itemFromTemplate(byForm('bow'));
    expect(canEquip(pathHero(HeroClass.Ranger, 'shadowblade'), bow, 'offHand', {}).ok).toBe(false);
  });

  it('still lets a Marksman carry one', () => {
    const bow = itemFromTemplate(byForm('bow'));
    expect(canEquip(pathHero(HeroClass.Ranger, 'marksman'), bow, 'mainHand', {}).ok).toBe(true);
  });

  /**
   * Before a path is chosen the class grant stands, the same rule shields
   * follow. A level-3 Hunter must not be locked out of the only weapon its
   * at-will attack describes.
   */
  it('lets a pathless Hunter carry one', () => {
    const bow = itemFromTemplate(byForm('bow'));
    expect(canEquip(pathHero(HeroClass.Ranger, null), bow, 'mainHand', {}).ok).toBe(true);
  });

  it('leaves a Shadowblade something to fight with', () => {
    const dagger = itemFromTemplate(byForm('dagger'));
    expect(canEquip(pathHero(HeroClass.Ranger, 'shadowblade'), dagger, 'mainHand', {}).ok).toBe(true);
  });

  /**
   * The playtest report this whole rule exists to answer: *"why can I wear a bow
   * as a Skirmisher?"* The path throws blades and fights at a spear's length —
   * a bow lets it opt out of every risk its damage is priced against.
   */
  it('keeps a bow out of a Skirmisher’s hands, and leaves it its own steel', () => {
    const skirmisher = pathHero(HeroClass.Ranger, 'skirmisher');
    expect(canEquip(skirmisher, itemFromTemplate(byForm('bow')), 'mainHand', {}).ok).toBe(false);
    expect(canEquip(skirmisher, itemFromTemplate(byForm('crossbow')), 'mainHand', {}).ok).toBe(false);
    expect(canEquip(skirmisher, itemFromTemplate(byForm('throwing_blade')), 'mainHand', {}).ok).toBe(true);
    expect(canEquip(skirmisher, itemFromTemplate(byForm('spear')), 'mainHand', {}).ok).toBe(true);
  });

  it('says which weapon it is refusing, by its noun rather than its id', () => {
    const result = canEquip(
      pathHero(HeroClass.Ranger, 'skirmisher'),
      itemFromTemplate(byForm('bow')),
      'mainHand',
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(equipRefusalText(result.reason)).toMatch(/bow/i);
  });
});

/**
 * The lock narrows the class grant; it never widens it, and it never contradicts
 * the set the path is meant to be collecting.
 *
 * Both are structural — the table is hand-authored, so these are the assertions
 * that stop a typo becoming a path that cannot hold its own legendary weapon or
 * one that reaches into another class's rack.
 */
describe('the weapon vocabulary is well formed', () => {
  const mainHandForms = (Object.entries(FORMS) as [FormId, (typeof FORMS)[FormId]][])
    .filter(([, spec]) => spec.slot === 'mainHand');

  const classOf = (form: FormId) => FORMS[form].classLock;

  it('gives every path something to fight with', () => {
    const empty = MASTERY_PATHS.filter((p) => MASTERY_WEAPON_FORMS[p.id].length === 0);
    expect(empty.map((p) => p.id)).toEqual([]);
  });

  it('never reaches outside the path’s own class', () => {
    const trespass: string[] = [];
    for (const path of MASTERY_PATHS) {
      for (const form of MASTERY_WEAPON_FORMS[path.id]) {
        if (!classOf(form)?.includes(path.heroClass)) trespass.push(`${path.id}: ${form}`);
      }
    }
    expect(trespass).toEqual([]);
  });

  it('lists only weapons', () => {
    const weapons = new Set(mainHandForms.map(([form]) => form));
    const notWeapons: string[] = [];
    for (const path of MASTERY_PATHS) {
      for (const form of MASTERY_WEAPON_FORMS[path.id]) {
        if (!weapons.has(form)) notWeapons.push(`${path.id}: ${form}`);
      }
    }
    expect(notWeapons).toEqual([]);
  });

  /**
   * A set is seven pieces and two of them are weapons. If the lock ever refused
   * one, the forge would sell a path a legendary it cannot hold — and the item
   * would look perfectly correct sitting in the bag.
   */
  it('lets every path hold its own legendary set weapons', () => {
    const unwearable: string[] = [];
    for (const path of MASTERY_PATHS) {
      for (const form of setFormsOf(path.id)) {
        if (FORMS[form].slot !== 'mainHand') continue;
        if (!MASTERY_WEAPON_FORMS[path.id].includes(form)) unwearable.push(`${path.id}: ${form}`);
      }
    }
    expect(unwearable).toEqual([]);
  });

  /** The iron the path hands over at level 5 has to be iron the path may hold. */
  it('lets every path hold the weapons it is handed on choosing', () => {
    const refused: string[] = [];
    for (const path of MASTERY_PATHS) {
      const grant = MASTERY_STARTER_WEAPONS[path.id];
      const h = { heroClass: path.heroClass, masteryPath: path.id } as Hero;
      for (const [slot, templateId] of [
        ['mainHand', grant.mainHand],
        ['offHand', grant.offHand],
      ] as [EquipSlot, string | undefined][]) {
        if (!templateId) continue;
        const template = itemTemplates.find((t) => t.id === templateId)!;
        const result = canEquip(h, itemFromTemplate(template), slot, {});
        if (!result.ok) refused.push(`${path.id} ${slot}: ${equipRefusalText(result.reason)}`);
      }
    }
    expect(refused).toEqual([]);
  });
});

/**
 * Gear is shared between classes, so locks are lists and armour weight is a
 * path vocabulary (the private project notes, "Equipment rules"). The Monk is
 * the class that needs both: one class, three weights.
 */
describe('class locks as lists and armour weight per path', () => {
  const monk = (path: MasteryId | null = null) => ({ heroClass: HeroClass.Monk, masteryPath: path });
  const RARE = { plate: 'plate_chest_steel', hide: 'hide_chest_silver', vestment: 'vestment_chest_nature', robe: 'robe_chest_runed' };
  const wears = (who: ReturnType<typeof monk>, templateId: string) =>
    canEquip(who, item(templateId), 'chest', {}).ok;

  it('names every class with a path that wears a weight on that weight', () => {
    for (const [weight, templateId] of Object.entries(RARE)) {
      const wearers = (Object.keys(MASTERY_ARMOUR_WEIGHT) as MasteryId[])
        .filter((p) => MASTERY_ARMOUR_WEIGHT[p] === weight)
        .map((p) => PATH_CLASS[p]);
      expect(new Set(item(templateId).classLock)).toEqual(new Set(wearers));
    }
  });

  it('agrees with the mastery data on each path’s class', () => {
    for (const path of MASTERY_PATHS) expect(PATH_CLASS[path.id]).toBe(path.heroClass);
    expect(pathsOfClass(HeroClass.Monk)).toEqual(['beetle', 'firefly', 'mantis']);
  });

  // Every existing path wears its class's weight, so the new column changes
  // nothing for the four original classes
  it('gives every path of an original class that class’s one weight', () => {
    for (const heroClass of Object.values(HeroClass).filter((c) => c !== HeroClass.Monk)) {
      expect(new Set(pathsOfClass(heroClass).map((p) => MASTERY_ARMOUR_WEIGHT[p])).size).toBe(1);
    }
  });

  it('dresses a Beetle in plate and neither hide nor vestment', () => {
    expect(wears(monk('beetle'), RARE.plate)).toBe(true);
    expect(wears(monk('beetle'), RARE.hide)).toBe(false);
    expect(wears(monk('beetle'), RARE.vestment)).toBe(false);
    expect(wears(monk('firefly'), RARE.vestment)).toBe(true);
    expect(wears(monk('firefly'), RARE.plate)).toBe(false);
    expect(wears(monk('mantis'), RARE.hide)).toBe(true);
    expect(wears(monk('mantis'), RARE.vestment)).toBe(false);
  });

  it('lets a Monk before its path wear the union of its paths’ weights', () => {
    expect(wearableWeights(HeroClass.Monk, null)).toEqual(['plate', 'vestment', 'hide']);
    for (const templateId of [RARE.plate, RARE.hide, RARE.vestment, 'plate_chest_gold', 'hide_chest_shadow']) {
      expect(wears(monk(), templateId)).toBe(true);
    }
    // Nobody's path wears the robe but the Arcanist's
    expect(wears(monk(), RARE.robe)).toBe(false);
  });

  // The path's weight holds at every rarity, common included
  it('holds common armour to the path’s weight too', () => {
    expect(wears(monk('beetle'), 'plate_chest_plain')).toBe(true);
    expect(wears(monk('beetle'), 'hide_chest_plain')).toBe(false);
    expect(wears(monk('beetle'), 'vestment_chest_plain')).toBe(false);
    expect(wears(monk('firefly'), 'vestment_chest_plain')).toBe(true);
    expect(wears(monk('firefly'), 'plate_chest_plain')).toBe(false);
    expect(wears(monk('mantis'), 'hide_chest_plain')).toBe(true);
    expect(wears(monk('mantis'), 'vestment_chest_plain')).toBe(false);
    // Before a path, every weight its paths wear, common or not
    for (const templateId of ['plate_chest_plain', 'hide_chest_plain', 'vestment_chest_plain']) {
      expect(wears(monk(), templateId)).toBe(true);
    }
    expect(wears(monk(), 'robe_chest_plain')).toBe(false);
    const refused = canEquip(monk('beetle'), item('hide_chest_plain'), 'chest', {});
    if (!refused.ok) expect(equipRefusalText(refused.reason)).toMatch(/Your mastery does not wear hide/);
  });

  it('names every class a list allows when it refuses', () => {
    const result = canEquip(arcanist, item(RARE.plate), 'chest', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(equipRefusalText(result.reason)).toMatch(/Champions and Monks/);
  });

  // A pendant has neither weight nor form, so its classes come from the motif
  it('hands a Monk jewellery at every drop rarity', () => {
    for (const rarity of [Rarity.Common, Rarity.Rare, Rarity.Epic]) {
      const fits = itemTemplates.some((t) => t.rarity === rarity && t.slot === 'neck' && !t.masteryLock
        && canEquip(monk(), item(t.id), 'neck', {}).ok);
      expect(fits).toBe(true);
    }
  });

  it('sweeps the pieces a chosen path does not wear', () => {
    const worn: EquippedItems = {
      head: item('hide_head_silver'),
      chest: item('plate_chest_steel'),
      mainHand: item('hand_wraps_plain'),
    };
    const swept = illegalSlots(monk('beetle'), worn).map((e) => e.slot).sort();
    // The rare hood is hide, and the wraps are the apprentice's
    expect(swept).toEqual(['head', 'mainHand']);
  });

  // The path issue covers chest, legs and feet; the strip catches what it does
  // not issue, a plain hood or a plain jerkin as much as a rare one
  it('sweeps common pieces outside the chosen path’s weight', () => {
    const worn: EquippedItems = {
      head: item('vestment_head_plain'),
      chest: item('hide_chest_plain'),
      legs: item('plate_legs_plain'),
    };
    const swept = illegalSlots(monk('beetle'), worn).map((e) => e.slot).sort();
    expect(swept).toEqual(['chest', 'head']);
  });
});

describe('what the path choice hands out', () => {
  it('names only templates that exist, for every path', () => {
    for (const path of Object.keys(PATH_CLASS) as MasteryId[]) {
      for (const templateId of Object.values(masteryIssue(path))) {
        expect(itemTemplates.some((t) => t.id === templateId)).toBe(true);
      }
    }
  });

  // Weapons only (playtest 2026-10-17, PT-03): no path, the Monk's included, is handed armour
  it('issues the path’s weapons and no armour', () => {
    expect(masteryIssue('templar')).toEqual({ mainHand: 'long_sword_iron', offHand: 'round_shield_iron' });
    expect(masteryIssue('beetle')).toEqual({ mainHand: 'greatstaff_iron' });
    for (const path of Object.keys(PATH_CLASS) as MasteryId[]) {
      expect({ path, slots: Object.keys(masteryIssue(path)).filter((s) => s !== 'mainHand' && s !== 'offHand') })
        .toEqual({ path, slots: [] });
    }
  });

  it('issues gear the path itself may wear', () => {
    const refused: string[] = [];
    for (const path of Object.keys(PATH_CLASS) as MasteryId[]) {
      const wearer = { heroClass: PATH_CLASS[path], masteryPath: path };
      for (const [slot, templateId] of Object.entries(masteryIssue(path)) as [EquipSlot, string][]) {
        if (!canEquip(wearer, item(templateId), slot, {}).ok) refused.push(`${path}/${templateId}`);
      }
    }
    expect(refused).toEqual([]);
  });
});
