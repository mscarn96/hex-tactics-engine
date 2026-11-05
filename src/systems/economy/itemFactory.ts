import { isLegendaryGrade } from '@/data/items/rarity';
import { AffixId, Item, ItemTemplate, Rarity } from '@/models/types';
import { itemTemplates } from '@/data/items/itemTemplates';
import { applyAffixes, rollAffixes } from '@/data/items/itemAffixes';
import { BonusWearer, canBeMythic, rollSetBonus } from '@/data/items/setBonus';
import {
  anchorItemLevel, clampItemLevel, levelledModifiers, levelledSellPrice,
} from '@/data/items/itemLevel';
import { rollSocketCapacity } from '@/data/items/gems';
import { strHash } from '@/data/display/terrainDisplay';
import { createRNG } from '@/utils/rng';
import { levelCap } from '@/data/levelCap';

/**
 * Turns a template into a concrete item instance.
 *
 * Every caller used to spread this by hand (`{ ...template, templateId: t.id,
 * id: ... }`), which is how items ended up carrying a `templateId` in some paths
 * and not others. The `id` here is provisional — inventoryStore.addItem assigns
 * the real one — but it keeps the value usable before it's stored.
 *
 * The instance sits at its rarity's **anchor level**, which is the level a
 * template's own `modifiers` describe — so the catalogue answer carries a level
 * like every other instance, and that level changes none of its numbers.
 */
export function itemFromTemplate(template: ItemTemplate): Item {
  const { id, ...rest } = template;
  return { ...rest, templateId: id, id: `pending_${id}`, itemLevel: anchorItemLevel(template.rarity), sockets: [] };
}

/**
 * The level an acquisition mints at when its source names none.
 *
 * A legendary takes the cap in force **right now** — read at the call, never
 * copied into a table, so a campaign whose `levelCap()` rises mints stronger
 * legendaries and leaves the ones already found exactly as they were. Anything
 * else takes its rarity's anchor, which is the catalogue's own numbers: a
 * source that has not yet been taught what level its loot is changes nothing.
 */
export function defaultMintLevel(rarity: Rarity, ceiling?: number): number {
  return isLegendaryGrade(rarity) ? legendaryLevel(ceiling) : anchorItemLevel(rarity);
}

/**
 * A legendary mints at its source's ceiling: band top for an expansion world's story content
 * (`systems/world/contentLevel.ts`), and the cap for repeatable content and everywhere in the
 * Empire. A ceiling is never above the cap in force.
 */
const legendaryLevel = (ceiling?: number): number => (ceiling === undefined ? levelCap() : Math.min(levelCap(), ceiling));

/**
 * The level an acquisition of this rarity actually lands on, given the level
 * its source asked for.
 *
 * The one rule `mintItem` and every preview share: a legendary takes its source's
 * ceiling (the cap in force, unless the source names one) whatever it was asked,
 * anything else is clamped to its rarity's range.
 * A shop row priced and described at one level and minted at another is the
 * disagreement the preview exists to rule out.
 */
export function acquisitionLevel(rarity: Rarity, itemLevel?: number, ceiling?: number): number {
  return isLegendaryGrade(rarity)
    ? legendaryLevel(ceiling)
    : clampItemLevel(itemLevel ?? defaultMintLevel(rarity), rarity);
}

/**
 * An instance's modifiers at `level`, derived from its template and its affixes.
 *
 * The one derivation, shared by minting and by anything that later moves an
 * item along the curve — so a piece re-levelled at the forge and one minted at
 * that level are the same piece. Affixes are applied at the anchor and the sum
 * is scaled, which is what makes a Keen sword's crit grow with the sword.
 */
function modifiersAt(template: ItemTemplate, affixes: AffixId[], level: number): Item['modifiers'] {
  return affixedModifiersAt(template, affixes, level);
}

/**
 * The template's modifiers at `level` with `affixes` on them, levelled so that
 * **an affix never rounds away**.
 *
 * Levelling the anchored sum alone let an affix that lands on a stat the piece
 * already carries vanish in the rounding: a base 5 and an affix +1 are 6, and 6
 * and 5 both round to 2 at 41% scale, so the item was named for a stat it did
 * not have more of and the forge sold a reroll that changed nothing. The sum is
 * levelled as before; where an affix put points on a stat and the result is no
 * higher than the bare piece's, that stat takes one more — the rule the base's
 * stats already keep ("a stat the item carries never rounds away"), extended to
 * the part the player chose. Only a vanished affix is bumped, so every number
 * that already differed from the bare piece is exactly what it was. At the anchor
 * the scale is 1 and nothing can vanish.
 */
function affixedModifiersAt(
  template: ItemTemplate,
  affixes: AffixId[],
  level: number,
): Item['modifiers'] {
  const baseItem = itemFromTemplate(template);
  const out = {
    ...levelledModifiers(applyAffixes(baseItem, affixes).modifiers, level, template.rarity),
  };
  if (affixes.length === 0) return out;
  const bare = levelledModifiers(baseItem.modifiers, level, template.rarity);
  const anchored = applyAffixes(baseItem, affixes).modifiers;
  for (const [key, total] of Object.entries(anchored) as [keyof typeof anchored, number][]) {
    if (total - (baseItem.modifiers[key] ?? 0) <= 0) continue;
    if ((out[key] ?? 0) <= (bare[key] ?? 0)) out[key] = (bare[key] ?? 0) + 1;
  }
  return out;
}

/**
 * A template turned into an item the player **acquires**, affixes and all.
 *
 * Deliberately a second function rather than a flag on the first, because the
 * two are asked in different situations and the difference is what makes the
 * rolls honest:
 *
 * - `itemFromTemplate` is the *catalogue* answer — what this template is, with
 *   no dice. The forge's preview, the shop's rack, the equipment picker's
 *   legality check and the sim harness all want it, and every one of them would
 *   be lying if the item shown re-rolled its own stats each render.
 * - `mintItem` is the *acquisition* answer, and rolls once. A drop, a chest, a
 *   craft, a purchase.
 *
 * Rolling inside `itemFromTemplate` would have quietly made the forge preview
 * disagree with what the forge produced, which is the one comparison the whole
 * building exists to support.
 *
 * `itemLevel` is the source's progression; omitted, it is `defaultMintLevel`.
 * **A legendary ignores it** and takes `ceiling`, or the current cap when the source
 * names none, because "legendaries are minted at the ceiling" is a rule about
 * legendaries rather than a default a caller could forget to pass.
 *
 * `wearers` is who the piece is for, where the source knows: a world
 * collection's skill roll leans toward one of them who can wear its weight
 * (`setBonus.rollSetBonus`). Nothing else reads it.
 */
export function mintItem(
  template: ItemTemplate,
  rng: () => number = Math.random,
  itemLevel?: number,
  wearers: BonusWearer[] = [],
  ceiling?: number,
): Item {
  const level = acquisitionLevel(template.rarity, itemLevel, ceiling);
  const affixed = applyAffixes(itemFromTemplate(template), rollAffixes(template, rng));
  const setBonus = rollSetBonus(template, rng, wearers);
  const levelled: Item = {
    ...affixed,
    itemLevel: level,
    modifiers: affixedModifiersAt(template, affixed.affixes ?? [], level),
    sellPrice: levelledSellPrice(template.sellPrice, level, template.rarity),
    sockets: Array(rollSocketCapacity(template.rarity, rng)).fill(null),
  };
  // Undefined for everything that is not a legendary set piece, and assigning
  // `undefined` would put the key on the object — which a save then carries
  // around on all 426 templates' worth of loot for nothing.
  return setBonus ? { ...levelled, setBonus } : levelled;
}

/**
 * A set template minted as a mythic, or null for a template that may not be one.
 *
 * `mintItem` throws the same dice in the same order and only the rarity differs,
 * so from one seed the mythic and the legendary are the same piece in every number.
 * `ceiling` is the level it mints at, as for a legendary. The boss drop is the one
 * acquisition that calls this (`lootGenerator.rollBossLoot`).
 */
export function mintMythic(
  template: ItemTemplate,
  rng: () => number = Math.random,
  wearers: BonusWearer[] = [],
  ceiling?: number,
): Item | null {
  if (!canBeMythic(template)) return null;
  return { ...mintItem(template, rng, undefined, wearers, ceiling), rarity: Rarity.Mythic };
}

/**
 * The same instance at another level — name, affixes, set bonus and id
 * untouched, modifiers re-derived.
 *
 * The seam both upgrade tracks spend: the forge's level upgrade on ordinary gear,
 * and a legendary's Obsidian Crystal, which is one level past the cap apiece. Derived from the template
 * rather than by rescaling the current numbers, because rescaling a rounded
 * value compounds the rounding every step and two routes to one level would
 * then disagree. An item whose template no longer exists is returned as it is:
 * there is nothing honest to derive it from.
 */
export function itemAtLevel(item: Item, level: number): Item {
  const template = findTemplate(item.templateId);
  if (!template) return item;
  // A climb never lands below where the piece already is: a cap that has fallen
  // back (an owner's entitlement unreadable) clamps the new ceiling, not the piece.
  const next = level >= item.itemLevel
    ? Math.max(item.itemLevel, clampItemLevel(level, item.rarity))
    : clampItemLevel(level, item.rarity);
  if (next === item.itemLevel) return item;
  return {
    ...item,
    itemLevel: next,
    modifiers: modifiersAt(template, item.affixes ?? [], next),
    sellPrice: levelledSellPrice(template.sellPrice, next, template.rarity),
  };
}

/**
 * The same instance wearing another set of affixes — level, sockets, set bonus,
 * id and sell price untouched; modifiers and the affix list re-derived (the
 * name follows the affixes, `itemName`).
 *
 * The seam the forge's affix reroll spends, and derived from the template for
 * `itemAtLevel`'s reason: stripping the old affix out of rounded numbers and
 * adding the new one would compound the rounding, so a rerolled Keen sword and
 * one minted Keen at the same level would come out different swords. Socketed
 * gems ride in `sockets` and are added by `effectiveModifiers` afterwards, so
 * nothing here can fold one into the baked numbers.
 */
export function itemWithAffixes(item: Item, affixes: AffixId[]): Item {
  const template = findTemplate(item.templateId);
  if (!template) return item;
  const affixed = applyAffixes(itemFromTemplate(template), affixes);
  return {
    ...item,
    affixes: affixed.affixes,
    modifiers: affixedModifiersAt(template, affixed.affixes ?? [], item.itemLevel),
  };
}

/**
 * What acquiring `template` from a source at `itemLevel` would hand over,
 * without rolling anything — the shop's, the market's and the forge's row.
 *
 * The catalogue item moved to `acquisitionLevel`, which is exactly the level and
 * the base stats `mintItem` produces from the same arguments; only the affixes
 * are left to the purchase, and a row says so rather than guessing them.
 */
export function previewItem(template: ItemTemplate, itemLevel?: number): Item {
  return itemAtLevel(itemFromTemplate(template), acquisitionLevel(template.rarity, itemLevel));
}

/**
 * The exact piece a counter is offering — affixes, sockets and all — rolled
 * from `key` rather than from the clock.
 *
 * A row used to show `previewItem`'s base stats and the purchase then rolled
 * affixes and sockets on the press, so what was paid for was never what was on
 * the price tag. Seeding the roll on the offer makes the row and the purchase
 * one object: the shop, the market and the forge render this and the button
 * adds this. The key is the counter's business — the market keys on the week,
 * the shop and the forge on how many of the piece the party already owns, so a
 * second purchase is offered a fresh roll rather than a copy of the first.
 * Deterministic, so reopening a counter cannot reroll it for free — the forge's
 * paid affix reroll would be pointless if closing a door did it at no cost.
 */
export function offeredItem(
  template: ItemTemplate,
  itemLevel: number | undefined,
  key: string,
  /** Who the counter serves — a collection piece's skill roll leans to them, as a drop's does. */
  wearers: BonusWearer[] = [],
): Item {
  const rng = createRNG(strHash(`${template.id}|${key}`));
  return { ...mintItem(template, () => rng.next(), itemLevel, wearers), id: `offer_${template.id}_${key}` };
}

export function findTemplate(templateId: string): ItemTemplate | undefined {
  return itemTemplates.find((t) => t.id === templateId);
}

/** Convenience for the common "id in hand, item wanted" case. */
export function itemFromTemplateId(templateId: string): Item | null {
  const template = findTemplate(templateId);
  return template ? itemFromTemplate(template) : null;
}

/**
 * A handed-over piece, id in hand: the catalogue item at the level it is given
 * at, with only socket capacity rolled. Starter kit and a path's first weapons
 * are issued rather than found, so they carry no affixes, but a recruit joining at
 * ten is issued ten's kit rather than the one the first hero set out in.
 */
export function issuedItem(templateId: string, itemLevel: number): Item | null {
  const template = findTemplate(templateId);
  if (!template) return null;
  return {
    ...previewItem(template, itemLevel),
    sockets: Array(rollSocketCapacity(template.rarity, Math.random)).fill(null),
  };
}
