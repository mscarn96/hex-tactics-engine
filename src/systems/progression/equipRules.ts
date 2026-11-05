import { isLegendaryGrade } from '@/data/items/rarity';
import {
  EquipSlot,
  FormId,
  Hero,
  HeroClass,
  Item,
  ItemModifiers,
  ItemSlot,
  OffHandKind,
  MasteryId,
  Rarity,
} from '@/models/types';
import { effectiveModifiers } from '@/systems/progression/itemStats';
import {
  OFFHAND_CLASS, armourWeightOf, masteryAllowsWeapon, pathsOfClass, wearableWeights, type ArmourWeight,
} from '@/data/items/itemForms';
import { formNoun, itemName } from '@/data/items/itemText';
import { t, type MessageKey } from '@/i18n';

/**
 * The single authority on what a hero may wear.
 *
 * Shared by the store, the equipment screen and loot auto-equip, so a rule can
 * never be enforced in one place and forgotten in another. Pure: callers pass
 * the currently equipped items in, nothing is read from a store.
 */

/**
 * Why a piece cannot go on (or come off): a catalog key and the things it
 * names, as ids and items rather than words, worded when shown by
 * `equipRefusalText` — so a refusal held in a screen's state follows a
 * language change.
 */
export interface EquipRefusal {
  key: MessageKey;
  item?: Item;
  classes?: readonly HeroClass[];
  weight?: ArmourWeight;
  offhand?: OffHandKind;
  form?: FormId;
}

/** A refusal in the current language. */
export function equipRefusalText(reason: EquipRefusal): string {
  return t(reason.key, {
    item: reason.item ? itemName(reason.item) : '',
    classes: reason.classes ? classesLabel(reason.classes) : '',
    weight: reason.weight ? t(`progression.weight.${reason.weight}`) : '',
    offhand: reason.offhand ? t(OFFHAND_LABEL[reason.offhand]) : '',
    noun: reason.form ? formNoun(reason.form).toLowerCase() : '',
  });
}

export type EquipResult =
  | { ok: true; displaces: EquipSlot[] }
  | { ok: false; reason: EquipRefusal };

/** Items currently worn, resolved. Missing keys are empty slots. */
export type EquippedItems = Partial<Record<EquipSlot, Item>>;

/** Who is asking: a class and a path, so the rules can be asked without a whole `Hero`. */
export interface Wearer {
  heroClass: HeroClass;
  masteryPath: MasteryId | null;
}

/**
 * What a hero is actually wearing, resolved out of the bag.
 *
 * `Hero.equipment` holds item *ids*, so every caller that needs the items
 * themselves has to join against `inventoryStore.items` — and two of them were
 * doing it inline with their own loop. Pure, so `canEquip`'s callers outside
 * React can build the same map: `questGear` needs one to ask whether a reward
 * would fit, and a resolver that had to reach into a store for it would stop
 * being testable.
 */
export function equippedItemsFor(
  hero: Pick<Hero, 'equipment'>,
  items: readonly Item[],
): EquippedItems {
  const worn: EquippedItems = {};
  for (const [slot, id] of Object.entries(hero.equipment)) {
    const item = items.find((i) => i.id === id);
    if (item) worn[slot as EquipSlot] = item;
  }
  return worn;
}

export const RING_SLOTS: EquipSlot[] = ['ring1', 'ring2'];

/**
 * Which class each off-hand kind belongs to — item metadata, so it is authored
 * beside the forms. Re-exported here because this is the module that enforces
 * it, and every existing reader asks the rule rather than the table.
 */
export { OFFHAND_CLASS };

/**
 * Only these paths may put a second weapon in the off-hand. The Mantis holds a
 * handblade in each hand (the private project notes, "New forms").
 */
export const DUAL_WIELD_MASTERIES: MasteryId[] = ['berserker', 'shadowblade', 'mantis'];

/**
 * Paths that keep access to an off-hand kind, for kinds a mastery can take away.
 *
 * Absent from this table means "any path of the right class". A Champion
 * carries a shield from level 1, but choosing Berserker trades it for a second
 * weapon. Class alone can't express that, since a Berserker is still a
 * Champion. The focus is the same shape across two classes: every Arcanist path
 * keeps it, and of the Monk's paths only the Firefly takes it up — the Beetle's
 * greatstaff fills both hands and the Mantis holds a second blade.
 */
const OFFHAND_MASTERIES: Partial<Record<OffHandKind, MasteryId[]>> = {
  shield: ['bulwark', 'templar'],
  focus: [...pathsOfClass(HeroClass.Mage), 'firefly'],
};

/**
 * Off-hand kinds a class may not take up until it has a path that keeps them.
 *
 * Before a path the class grant normally stands — a level-1 Champion carries a
 * shield although a Berserker will give it up. The Monk is the exception for
 * the focus: two of its three paths never hold one, and the apprentice trains
 * empty-handed, so the focus waits for the Firefly (the private project notes,
 * "Equipment rules").
 */
const OFFHAND_NEEDS_PATH: Partial<Record<HeroClass, OffHandKind[]>> = {
  [HeroClass.Monk]: ['focus'],
};

const OFFHAND_LABEL: Record<OffHandKind, MessageKey> = {
  shield: 'progression.offhand.shield',
  quiver: 'progression.offhand.quiver',
  focus: 'progression.offhand.focus',
  totem: 'progression.offhand.totem',
  weapon: 'progression.offhand.weapon',
};

/** A class in the plural, as the refusals name it. */
const CLASS_LABEL: Record<HeroClass, MessageKey> = {
  [HeroClass.Warrior]: 'progression.class.warrior',
  [HeroClass.Mage]: 'progression.class.mage',
  [HeroClass.Healer]: 'progression.class.healer',
  [HeroClass.Ranger]: 'progression.class.ranger',
  [HeroClass.Monk]: 'progression.class.monk',
};

/**
 * Classes whose main hand is locked until a path is chosen, and the one form
 * that hand holds meanwhile.
 *
 * The Monk apprentice trains bare-handed (the private project notes, "The base
 * class"): its starter wraps can be neither removed nor replaced while
 * `masteryPath` is null, and nothing else goes in. At the path choice the path
 * issues its iron and the wraps are swept to the bag like any other piece the
 * path does not carry (`illegalSlots`).
 */
const LOCKED_MAIN_HAND: Partial<Record<HeroClass, FormId>> = {
  [HeroClass.Monk]: 'hand_wraps',
};

const LOCKED_REASON: EquipRefusal = { key: 'progression.equip.locked' };

/** "Champions", "Champions and Monks", "Champions, Hunters and Monks". */
function classesLabel(classes: readonly HeroClass[]): string {
  const names = classes.map((c) => t(CLASS_LABEL[c]));
  return names.length <= 1
    ? names.join('')
    : t('progression.list.and', { list: names.slice(0, -1).join(', '), last: names[names.length - 1] });
}

const refuse = (key: MessageKey, names: Omit<EquipRefusal, 'key'> = {}): EquipResult => ({ ok: false, reason: { key, ...names } });

/** Whether this hero's main hand is locked, as it is for a Monk before its path. */
export function mainHandLocked(hero: Wearer): boolean {
  return hero.masteryPath === null && LOCKED_MAIN_HAND[hero.heroClass] !== undefined;
}

/**
 * Can `hero` take off what is in `slot`? Every slot can be emptied except a
 * locked main hand. The screens ask this before they clear a slot.
 */
export function canUnequip(
  hero: Wearer,
  slot: EquipSlot,
): EquipResult {
  if (slot === 'mainHand' && mainHandLocked(hero)) return { ok: false, reason: LOCKED_REASON };
  return { ok: true, displaces: [] };
}

/**
 * What swapping one item for another actually changes, stat by stat.
 *
 * The question the equipment screen exists to answer and could not: two lists
 * of `+4 attack, +2 maxHp` side by side is arithmetic homework, and the player
 * doing it in their head is the reason a strictly worse item gets equipped.
 *
 * Upgrade levels are resolved on both sides — a `+3` legendary is worth what it
 * is worn at, not what its template says — so a base-modifier comparison
 * against an upgraded piece cannot quietly recommend a downgrade.
 *
 * Returns only stats that moved, worst last, so a caller can render the whole
 * thing without deciding what is interesting. An empty result means the swap is
 * stat-neutral, which is a real answer and worth saying out loud.
 */
export function modifierDelta(
  candidate: Item,
  current: Item | undefined,
): { key: keyof ItemModifiers; delta: number }[] {
  const after = effectiveModifiers(candidate);
  const before = current ? effectiveModifiers(current) : ({} as ItemModifiers);

  const keys = new Set([...Object.keys(after), ...Object.keys(before)]) as Set<
    keyof ItemModifiers
  >;

  return [...keys]
    .map((key) => ({ key, delta: (after[key] ?? 0) - (before[key] ?? 0) }))
    .filter(({ delta }) => delta !== 0)
    .sort((a, b) => b.delta - a.delta);
}

export function canDualWield(hero: Pick<Wearer, 'masteryPath'>): boolean {
  return hero.masteryPath !== null && DUAL_WIELD_MASTERIES.includes(hero.masteryPath);
}

/**
 * Every slot an item could *structurally* target, before hero restrictions.
 *
 * Two entries are multi-slot: a ring fits either finger, and a one-handed
 * weapon fits either hand — dual-wielding is a main-hand weapon placed in the
 * off-hand, and `canEquip` is what gates that on a mastery. An off-hand item
 * (shield, quiver…) is single-slot; it never migrates to the main hand.
 */
export function slotsFor(itemSlot: ItemSlot): EquipSlot[] {
  if (itemSlot === 'ring') return [...RING_SLOTS];
  if (itemSlot === 'mainHand') return ['mainHand', 'offHand'];
  return [itemSlot as EquipSlot];
}

/** Whether an item declaring `itemSlot` can go in `slot`. */
export function slotAccepts(slot: EquipSlot, itemSlot: ItemSlot): boolean {
  return slotsFor(itemSlot).includes(slot);
}

export function isTwoHanded(item: Item): boolean {
  return item.handRule === 'twoHanded';
}

/**
 * Can `hero` put `item` in `slot`?
 *
 * On success, `displaces` lists slots that must be emptied first — equipping a
 * two-hander clears the off-hand, and equipping an off-hand clears a two-hander.
 * The target slot itself is never listed; swapping into an occupied slot is
 * ordinary and handled by the caller.
 */
export function canEquip(
  hero: Wearer,
  item: Item,
  slot: EquipSlot,
  equipped: EquippedItems,
): EquipResult {
  if (!slotAccepts(slot, item.slot)) {
    return refuse('progression.equip.slot', { item });
  }

  if (item.classLock && !item.classLock.includes(hero.heroClass)) {
    return refuse('progression.equip.classLock', { classes: item.classLock, item });
  }

  // Armour weight is a path vocabulary (`MASTERY_ARMOUR_WEIGHT`): a Beetle wears
  // plate and a Mantis hide although both are Monks, and before its path a hero
  // wears every weight its paths do. Asked at every rarity: a common piece
  // carries no class lock, but a Beetle in a plain hide jerkin is still in hide
  // (the private project notes, "Equipment rules").
  const weight = armourWeightOf(item.form);
  if (weight && !wearableWeights(hero.heroClass, hero.masteryPath).includes(weight)) {
    return hero.masteryPath
      ? refuse('progression.equip.weight.mastery', { weight })
      : refuse('progression.equip.weight.class', { classes: [hero.heroClass], weight });
  }

  if (item.masteryLock && item.masteryLock.length > 0) {
    if (!hero.masteryPath || !(item.masteryLock as readonly MasteryId[]).includes(hero.masteryPath)) {
      return refuse('progression.equip.masteryLock', { item });
    }
  }

  // Two of the same legendary is the obvious degenerate loadout; anything below
  // legendary may be doubled up freely.
  if (isLegendaryGrade(item.rarity)) {
    const duplicate = (Object.entries(equipped) as [EquipSlot, Item][]).some(
      ([s, worn]) => s !== slot && worn?.templateId === item.templateId,
    );
    if (duplicate) {
      return refuse(item.rarity === Rarity.Mythic ? 'progression.equip.mythic' : 'progression.equip.legendary', { item });
    }
  }

  // A path names the weapons it carries, and holds them in both hands: a
  // dual-wielder with a bow in the off-hand is the same problem wearing a
  // different label, so the question is asked of the *item* rather than of the
  // slot it is going into. A weapon is anything that declares the main hand;
  // shields, quivers and focuses declare `offHand` and answer to `offHandKind`
  // below instead.
  if (item.slot === 'mainHand' && !masteryAllowsWeapon(hero.masteryPath, item.form)) {
    return refuse('progression.equip.weapon', { form: item.form });
  }

  // A locked main hand takes nothing new. The one exception is its own form
  // going back into an *empty* hand, so a worn pair re-checks as legal
  // (`illegalSlots` asks with the slot cleared) and a hand somehow left bare can
  // be bound again; a pair already on cannot be swapped for another.
  if (slot === 'mainHand' && mainHandLocked(hero)
    && (equipped.mainHand || item.form !== LOCKED_MAIN_HAND[hero.heroClass])) {
    return { ok: false, reason: LOCKED_REASON };
  }

  const displaces: EquipSlot[] = [];

  if (slot === 'mainHand') {
    // A two-hander leaves no room for anything in the off-hand
    if (isTwoHanded(item) && equipped.offHand) displaces.push('offHand');
  }

  if (slot === 'offHand') {
    // A main-hand item landing here is a second weapon by definition
    const kind: OffHandKind = item.slot === 'mainHand' ? 'weapon' : item.offHandKind ?? 'weapon';

    if (kind === 'weapon') {
      if (!canDualWield(hero)) {
        return refuse('progression.equip.dualWield', { item });
      }
      if (isTwoHanded(item)) {
        return refuse('progression.equip.twoHandedOff', { item });
      }
    } else {
      const refused = offHandRefusal(hero, kind);
      if (refused) return refused;
    }

    // Filling the off-hand forces a two-hander out of the main hand — unless
    // that hand is locked, when the off-hand piece is what has to wait
    const main = equipped.mainHand;
    if (main && isTwoHanded(main)) {
      if (mainHandLocked(hero)) return { ok: false, reason: LOCKED_REASON };
      displaces.push('mainHand');
    }
  }

  return { ok: true, displaces };
}

/** Why this hero may not take up an off-hand kind other than a second weapon, or null when it may. */
function offHandRefusal(hero: Wearer, kind: Exclude<OffHandKind, 'weapon'>): EquipResult | null {
  const required = OFFHAND_CLASS[kind];
  if (required && !required.includes(hero.heroClass)) {
    return refuse('progression.equip.offhand.class', { classes: required, offhand: kind });
  }

  // Some paths give up their class's off-hand. Before a path is chosen the
  // class grant stands, so low-level heroes aren't locked out of the slot —
  // unless the class waits for its path (`OFFHAND_NEEDS_PATH`).
  const allowedPaths = OFFHAND_MASTERIES[kind];
  if (allowedPaths && hero.masteryPath && !allowedPaths.includes(hero.masteryPath)) {
    return refuse('progression.equip.offhand.mastery', { offhand: kind });
  }
  if (!hero.masteryPath && OFFHAND_NEEDS_PATH[hero.heroClass]?.includes(kind)) {
    return refuse('progression.equip.offhand.path', { classes: [hero.heroClass], offhand: kind });
  }
  return null;
}

/** The off-hand kinds this hero may hold now, a second weapon included, from the rules `canEquip` asks. */
export function offHandKindsFor(hero: Wearer): OffHandKind[] {
  return (Object.keys(OFFHAND_CLASS) as OffHandKind[]).filter((kind) =>
    (kind === 'weapon' ? canDualWield(hero) : offHandRefusal(hero, kind) === null));
}

/**
 * Whether this hero could put the piece on at all — in any slot it fits, with
 * nothing else worn. The counters ask it of the party: who a piece is for, by name.
 */
export function couldWear(hero: Wearer, item: Item): boolean {
  return slotsFor(item.slot).some((slot) => canEquip(hero, item, slot, {}).ok);
}

/**
 * Re-checks everything currently worn — used after a change that can invalidate
 * gear retroactively, chiefly picking a mastery path.
 *
 * Returns the slots that are no longer legal, so the caller can warn before
 * moving them to the bag.
 */
export function illegalSlots(
  hero: Wearer,
  equipped: EquippedItems,
): Array<{ slot: EquipSlot; item: Item; reason: EquipRefusal }> {
  const out: Array<{ slot: EquipSlot; item: Item; reason: EquipRefusal }> = [];

  for (const [slot, item] of Object.entries(equipped) as [EquipSlot, Item][]) {
    if (!item) continue;
    // Check against the rest of the loadout, so an item never invalidates itself
    const others: EquippedItems = { ...equipped };
    delete others[slot];

    const result = canEquip(hero, item, slot, others);
    if (!result.ok) out.push({ slot, item, reason: result.reason });
  }

  return out;
}
