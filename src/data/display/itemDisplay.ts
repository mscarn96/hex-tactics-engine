import { pathName as masteryPathName } from '@/data/gameText';
import { HeroClass, Item, ItemModifiers, ItemTemplate, MasteryId, OffHandKind } from '@/models/types';
import { effectiveModifiers } from '@/systems/progression/itemStats';
import { gemBonus, gemName } from '@/data/items/gems';
import { affixName, formNoun, modifierLabel, rarityName as rarityText, type NamedItem } from '@/data/items/itemText';
import {
  MASTERY_ARMOUR_WEIGHT, MASTERY_WEAPON_FORMS, OFFHAND_CLASS, armourWeightOf, pathsOfClass, wearableWeights,
  type ArmourWeight,
} from '@/data/items/itemForms';
import { couldWear, mainHandLocked, offHandKindsFor, type Wearer } from '@/systems/progression/equipRules';
import { heroClassName } from '@/data/display/heroDisplay';
import { itemDisplayName } from '@/systems/progression/upgrades';
import { findMasteryPath } from '@/data/skills/masteryData';
import { pathName as pathText } from '@/data/gameText';
import { t } from '@/i18n';

export { rarityName } from '@/data/items/itemText';

/**
 * The one place that decides how an item's modifiers read.
 *
 * Three byte-identical copies of the joined form lived in the bag, the hero
 * sheet and the building modals, and they had drifted where it counts: the
 * equip picker and the shop's sell list passed raw `item.modifiers` and raw
 * `item.name`, so a `+3` legendary showed neither its upgrade nor its upgraded
 * stats in the two screens where you choose what to wear and what to sell.
 *
 * The entry points take the **item**, not its modifiers, so the upgrade cannot
 * be forgotten again. Templates have no upgrade level and get their own, rather
 * than a defaulted argument nobody remembers to pass.
 */

/** What a stat line calls a modifier (`items.modifier.<stat>`). */
const label = (key: keyof ItemModifiers): string => modifierLabel(key);

/**
 * The modifiers that are percentages, and therefore have to say so.
 *
 * `+8 Lifesteal` next to `+8 Attack` reads as the same size of thing, and one
 * of them is eight points of damage while the other is eight percent of every
 * hit for the rest of the campaign. The suffix is the only thing separating
 * them, so it lives here rather than at whichever screen remembers.
 *
 * `manaRegen` is deliberately absent — it is flat mana, which is why its label
 * carries the unit instead.
 */
const PERCENT_KEYS = new Set<keyof ItemModifiers>([
  'maxHpPercent', 'critChance', 'critDamage', 'dodgeChance', 'armourPen', 'magicPen',
  'lifesteal', 'healPower', 'shieldPower', 'poisonPower',
]);

/** Signed, so a penalty reads `-3` rather than the old `+-3`. */
const signed = (key: keyof ItemModifiers, value: number): string =>
  `${value > 0 ? '+' : ''}${value}${PERCENT_KEYS.has(key) ? '%' : ''}`;

export interface ModifierLine {
  key: keyof ItemModifiers;
  label: string;
  value: number;
  /** Pre-signed, for anywhere that lays the label and number out itself. */
  text: string;
}

/**
 * Which modifiers are worth showing, and how each number reads.
 *
 * Layout stays with the caller — the reward dialog gives each stat its own
 * line, the bag joins them — but the rule about zeroes, signs and names is one
 * thing and lives here.
 */
export function modifierLines(mods: ItemModifiers): ModifierLine[] {
  return (Object.entries(mods) as [keyof ItemModifiers, number | undefined][])
    .filter((entry): entry is [keyof ItemModifiers, number] => !!entry[1])
    .map(([key, value]) => ({ key, label: label(key), value, text: signed(key, value) }));
}

/** Modifier lines for a carried item, with whatever upgrade it holds applied. */
export const itemModifierLines = (item: Pick<Item, 'modifiers' | 'sockets'>): ModifierLine[] =>
  modifierLines(effectiveModifiers(item));

const join = (lines: ModifierLine[]): string =>
  lines.map((l) => t('items.line.stat', { value: l.text, stat: l.label })).join('  ');

/** A carried item as one line: whatever upgrade it holds is already priced in. */
export const formatItemModifiers = (item: Pick<Item, 'modifiers' | 'sockets'>): string =>
  join(itemModifierLines(item));

/** Every capacity position, including empty sockets and duplicate gems. */
export function socketLines(item: Pick<Item, 'sockets'>): string[] {
  return (item.sockets ?? []).map((gem, index) => {
    if (!gem) return t('items.line.socketEmpty', { socket: index + 1 });
    const { stat, value } = gemBonus(gem);
    const bonus = t('items.line.stat', { value: signed(stat, value), stat: label(stat) });
    return t('items.line.socketFilled', { socket: index + 1, gem: gemName(gem), bonus });
  });
}

/**
 * A socket row at a glance: `◆` a filled socket, `◇` an empty one, in order.
 * Empty for an item with no capacity, so a caller can append it unconditionally.
 */
export function socketPips(item: Pick<Item, 'sockets'>): string {
  return (item.sockets ?? []).map((gem) => (gem ? '◆' : '◇')).join('');
}

/**
 * The one way an item is headed in a list: its name (with any legendary +N),
 * its level, and its sockets.
 *
 * Every screen that lists gear used to assemble this itself, and they had come
 * apart — the bag, the stash, the sell list, the equip comparison and the
 * reward dialog named an item with no level at all, the forge put the level on
 * the stat line, and only two of them showed a socket. So the same piece read
 * as three different things depending on which door it was seen through.
 */
export function itemTitle(item: NamedItem & Pick<Item, 'rarity' | 'itemLevel' | 'sockets'>): string {
  const pips = socketPips(item);
  return `${itemDisplayName(item)} · ${itemLevelTag(item)}${pips ? `  ${pips}` : ''}`;
}

/**
 * An item's level on its own, for the tag in the corner of a slot or a bag
 * tile, where there is no room for the name. The same spelling `itemTitle`
 * uses, because it *is* that spelling — a tile saying "L9" beside a title
 * saying "Lv 9" would be two ways of writing one fact.
 */
export const itemLevelTag = (item: Pick<Item, 'itemLevel'>): string => t('items.line.level', { level: item.itemLevel });

/** A catalogue entry — nothing has been forged yet, so there is no upgrade. */
export const formatTemplateModifiers = (template: Pick<ItemTemplate, 'modifiers'>): string =>
  join(modifierLines(template.modifiers));

/**
 * What this instance's named riders are, in words.
 *
 * The affix stats are merged into `modifiers` at mint, and `itemName` says
 * the words in the name — but neither can say *which* rider granted what. `item.affixes` is
 * the machine-readable record of that, and this is what reads it: "Keen ·
 * Sundering" under the name, so a player comparing two rares is comparing two
 * named things rather than two piles of numbers.
 *
 * Empty for a common, which never rolls one, and for anything minted before the
 * layer existed.
 */
export function affixNames(item: Pick<Item, 'affixes'>): string[] {
  return (item.affixes ?? []).map(affixName);
}

/** The same, joined — the form a one-line caption wants. */
export const formatAffixes = (item: Pick<Item, 'affixes'>): string =>
  affixNames(item).join(' · ');

// ─── Swaps ────────────────────────────────────────────────────────────────────

export interface DeltaLine {
  key: keyof ItemModifiers;
  label: string;
  /** Signed number: positive is a gain for the candidate. */
  delta: number;
  /** Pre-signed, for anywhere that lays the label and number out itself. */
  text: string;
  /**
   * Which way it went. Callers colour from this rather than re-testing the sign,
   * so green-is-up lives in one place instead of at every render site.
   */
  direction: 'up' | 'down';
}

/**
 * How a swap reads, stat by stat.
 *
 * Takes the output of `equipRules.modifierDelta` rather than the two items,
 * which is the same trick the entry points above play with `effectiveModifiers`:
 * there is no way to reach this with raw modifiers, because the only thing that
 * produces its argument already resolves both sides' upgrade levels.
 *
 * It exists because the labels were being invented at the call site — the equip
 * picker rendered `key === 'maxHp' ? 'HP' : key`, which is a third copy of
 * `label()` that had already drifted: it showed `critChance` where the item's
 * own line above it said `Crit Chance`.
 */
export const deltaLines = (
  delta: { key: keyof ItemModifiers; delta: number }[],
): DeltaLine[] =>
  delta.map(({ key, delta: value }) => ({
    key,
    label: label(key),
    delta: value,
    text: signed(key, value),
    direction: value > 0 ? 'up' : 'down',
  }));

/**
 * What a stat-neutral swap says, out loud.
 *
 * A blank space where the comparison should be reads as a bug rather than as an
 * answer, and two screens saying it differently reads as two different answers.
 */
export const noStatChange = (): string => t('items.line.noStatChange');

// ─── Who can wear it ──────────────────────────────────────────────────────────

/**
 * Who an item is *for*, said before it is bought.
 *
 * The locks always existed — `classLock`, `masteryLock`, the off-hand kinds and
 * the per-path weapon table — but the only place they spoke was `canEquip`'s
 * refusal, which arrives after the gold is spent. The forge and the shop rack
 * read this instead, so "can anyone I have actually hold this" is answered on
 * the price tag.
 *
 * A weapon narrows twice: the class lock, and then `MASTERY_WEAPON_FORMS` once
 * a path is chosen. When only some of a class's paths carry the form, they are
 * named — a Champion buying a greatsword is buying a Berserker's weapon, and
 * finding that out at the anvil is the whole point of the line. Armour, common
 * included, narrows the same way through `MASTERY_ARMOUR_WEIGHT`: plate is the
 * Champion's and the Beetle's, so it reads "Champion or Monk · Beetle".
 */
export function itemWearerLine(
  item: Pick<ItemTemplate, 'classLock' | 'masteryLock' | 'form' | 'slot' | 'offHandKind'>,
): string {
  const lock = item.masteryLock;
  if (lock && lock.length > 0) {
    return t('items.wearer.only', { list: joinList(lock.map(pathName)) });
  }

  if (item.slot === 'offHand' && item.offHandKind) {
    const classes = OFFHAND_CLASS[item.offHandKind];
    return classes ? classesLine(classes) : t('items.wearer.dualWield');
  }

  // Armour is held to its weight at every rarity, so a common piece with no
  // lock still names who wears it, from the same table `canEquip` asks
  const weight = armourWeightOf(item.form);
  if (weight) {
    const wears = (p: MasteryId) => MASTERY_ARMOUR_WEIGHT[p] === weight;
    const classes = item.classLock
      ?? Object.values(HeroClass).filter((c) => pathsOfClass(c).some(wears));
    return classesLine(classes, wears);
  }

  if (!item.classLock) return t('items.wearer.anyone');

  if (item.slot === 'mainHand') {
    return classesLine(item.classLock, (p) => MASTERY_WEAPON_FORMS[p].includes(item.form));
  }

  return classesLine(item.classLock);
}

/** A path's display name, or its id where it has no tree to name it. */
function pathName(path: MasteryId): string {
  const found = findMasteryPath(path);
  return found ? pathText(found) : path;
}

/** "Bulwark, Templar" — a list of names, joined the language's way. */
function joinList(names: string[]): string {
  if (names.length === 0) return '';
  return names.reduce((first, second) => t('items.wearer.listJoin', { first, second }));
}

/**
 * "Champion only", "Champion · Berserker", "Champion or Monk · Beetle".
 *
 * Each class reads alone when every one of its paths carries the item (or when
 * none is named for it yet), and with the carrying paths when only some do.
 * "only" closes the line when no class was narrowed.
 */
function classesLine(classes: readonly HeroClass[], carries?: (path: MasteryId) => boolean): string {
  const parts = classes.map((cls) => {
    const name = heroClassName(cls);
    if (!carries) return { text: name, whole: true };
    const paths = pathsOfClass(cls);
    const carriers = paths.filter(carries);
    if (carriers.length > 0 && carriers.length < paths.length) {
      return { text: t('items.wearer.classPaths', { class: name, paths: joinList(carriers.map(pathName)) }), whole: false };
    }
    return { text: name, whole: true };
  });
  const line = parts.length === 0 ? '' : parts.map((p) => p.text).reduce((first, second) => t('items.wearer.or', { first, second }));
  return parts.every((p) => p.whole) ? t('items.wearer.only', { list: line }) : line;
}

// ─── What kind of piece, and who in the party ────────────────────────────────

const weightKind = (weight: ArmourWeight) => t(`items.kind.armour.${weight}`);
const offHandKind = (kind: OffHandKind) => t(`items.kind.offhand.${kind}`);

/**
 * What kind of piece it is, where its name leaves that to the picture: an
 * armour's weight ("Plate armour") or an off-hand's kind ("Shield"). Undefined
 * for a weapon, whose name already says it, and for jewellery, which anyone wears
 * (playtest 2026-10-30: "we should see explicitly what type of item it is").
 */
export function itemKindLabel(item: Pick<Item, 'form' | 'slot' | 'offHandKind'>): string | undefined {
  const weight = armourWeightOf(item.form);
  if (weight) return weightKind(weight);
  if (item.slot === 'offHand' && item.offHandKind && item.offHandKind !== 'weapon') return offHandKind(item.offHandKind);
  return undefined;
}

/** "Rare · Plate armour": a card's subtitle, the rarity with the kind when it has one. */
export function itemRarityKind(item: Pick<Item, 'rarity' | 'form' | 'slot' | 'offHandKind'>): string {
  const kind = itemKindLabel(item);
  return kind ? t('items.kind.withRarity', { rarity: rarityText(item.rarity), kind }) : rarityText(item.rarity);
}

/**
 * Which of the party's heroes could wear a piece, by name — the counters' answer
 * to "is this for anybody I have" beside `itemWearerLine`'s classes and paths.
 */
export function partyWearerLine(item: Item, heroes: readonly (Wearer & { name: string })[]): string {
  const names = heroes.filter((hero) => couldWear(hero, item)).map((hero) => hero.name);
  return names.length > 0 ? t('items.party.fits', { list: joinList(names) }) : t('items.party.nobody');
}

/**
 * What a hero may wear, for the gear tab: armour weights, weapons and off-hand
 * kinds, from the same tables `canEquip` asks. Before a path every weapon its
 * class's paths carry; a locked hand (the Monk apprentice's wraps) names none.
 */
export function heroWearsLine(hero: Wearer): string {
  const weapons = mainHandLocked(hero)
    ? []
    : [...new Set((hero.masteryPath ? [hero.masteryPath] : pathsOfClass(hero.heroClass))
      .flatMap((path) => MASTERY_WEAPON_FORMS[path]))];
  const parts = [
    ...wearableWeights(hero.heroClass, hero.masteryPath).map(weightKind),
    ...weapons.map(formNoun),
    ...offHandKindsFor(hero).map(offHandKind),
  ];
  return t('items.party.heroWears', { list: parts.join(', ') });
}
