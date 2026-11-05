import { EQUIP_SLOTS, EquipSlot, HeroClass, Item, ItemModifiers, ItemTemplate, MasteryId, Rarity, ResourceType } from '@/models/types';
import { itemTemplates } from '@/data/items/itemTemplates';
import { setFormsOf } from '@/data/items/itemForms';
import { masteriesForClass, findMasteryPath } from '@/data/skills/masteryData';
import { pathName } from '@/data/gameText';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { itemWearerLine, modifierLines } from '@/data/display/itemDisplay';
import { canEquip, EquippedItems, equipRefusalText, equippedItemsFor, illegalSlots, slotAccepts } from '@/systems/progression/equipRules';
import { getEffectiveStats, heroMaxHp, heroMaxMana } from '@/systems/progression/statCalc';
import { canUnlockNode } from '@/systems/progression/mastery';
import { weaponAttackFor } from '@/systems/combat/basicAttack';
import { itemFromTemplate } from '@/systems/economy/itemFactory';
import { BALANCE } from '@/data/balanceConstants';
import { highestLevelCap } from '@/data/levelCap';
import { QuestId } from '@/quests/types';
import { buildSimHero, MYTHIC_SLOT, SimHeroConfig, simMasteryHero, simSlotItem } from './simHarness';
import { canBeMythic } from '@/data/items/setBonus';
import { isLegendaryGrade } from '@/data/items/rarity';
import type { ScenarioRecipe } from './scenarioCreator';
import { itemDescription, itemName } from '@/data/items/itemText';
import { templateName } from '@/data/templates/unitText';

/**
 * Save Creator's gear and hero helpers, kept out of the screen so the search
 * the picker runs and the quick-fill it offers are the same answers a test can
 * pin.
 *
 * Templates, not instances: a slot in a recipe names a template id and the
 * builder mints it (`simSlotItem`), so the picker filters the catalogue and
 * shows each piece as it will be minted.
 */

export const RARITY_ORDER: readonly Rarity[] = [Rarity.Common, Rarity.Rare, Rarity.Epic, Rarity.Legendary, Rarity.Mythic];

/** Who a piece is being picked for; `canEquip` reads only these. */
export interface Wearer {
  heroClass: HeroClass;
  masteryPath: MasteryId | null;
}

export interface ItemQuery {
  /** A hero slot, or `null` for any piece (a bag or stash entry). */
  slot: EquipSlot | null;
  rarities: readonly Rarity[];
  /** Matched against the name, the description and the stat labels. */
  text?: string;
  /** Only pieces with this stat; also sorts them by it, highest first. */
  stat?: keyof ItemModifiers | null;
  /** Only pieces this hero may wear in `slot`, against what they already wear. */
  wearer?: Wearer | null;
  worn?: EquippedItems;
}

/** Every catalogue entry matching the query, as an instance for the tile and card. */
export function findItems(q: ItemQuery): Item[] {
  const text = q.text?.trim().toLowerCase() ?? '';
  const out: Item[] = [];
  for (const template of itemTemplates) {
    if (q.slot && !slotAccepts(q.slot, template.slot)) continue;
    if (q.stat && !template.modifiers[q.stat]) continue;
    if (text && !searchText(template).includes(text)) continue;
    const base = itemFromTemplate(template);
    // A set piece is listed twice when both are asked for: the catalogue's
    // legendary, and the same piece as a mythic.
    const forms = [
      ...(q.rarities.includes(template.rarity) ? [base] : []),
      ...(q.rarities.includes(Rarity.Mythic) && canBeMythic(template) ? [{ ...base, rarity: Rarity.Mythic }] : []),
    ];
    for (const item of forms) {
      if (q.wearer && q.slot && !canEquip(q.wearer, item, q.slot, q.worn ?? {}).ok) continue;
      out.push(item);
    }
  }
  if (q.stat) {
    const stat = q.stat;
    out.sort((a, b) => (b.modifiers[stat] ?? 0) - (a.modifiers[stat] ?? 0));
  }
  return out;
}

const SEARCH = new Map<string, string>();
function searchText(t: ItemTemplate): string {
  let s = SEARCH.get(t.id);
  if (s === undefined) {
    s = [itemName(t), itemDescription(t), t.form.replace(/_/g, ' '), ...modifierLines(t.modifiers).map((l) => l.label)]
      .join(' ').toLowerCase();
    SEARCH.set(t.id, s);
  }
  return s;
}

/** The stats any piece that could go in `slot` carries, for the stat filter's chips. */
export function statsFor(slot: EquipSlot | null): (keyof ItemModifiers)[] {
  const seen = new Set<keyof ItemModifiers>();
  for (const t of itemTemplates) {
    if (slot && !slotAccepts(slot, t.slot)) continue;
    for (const [key, value] of Object.entries(t.modifiers)) if (value) seen.add(key as keyof ItemModifiers);
  }
  return [...seen];
}

export interface FactLine {
  text: string;
  tone?: 'meta' | 'warn';
}

/**
 * What a piece does beyond its stat rows: what it is, who may wear it, and —
 * for a weapon — the Basic Attack it gives the hand that holds it.
 */
export function itemFacts(item: Item): FactLine[] {
  const lines: FactLine[] = [];
  lines.push({ text: itemDescription(item), tone: 'meta' });
  lines.push({ text: `Worn by: ${itemWearerLine(item)}` });
  if (item.slot === 'mainHand') {
    const attack = weaponAttackFor(item);
    const reach = attack.range > 1 ? `range ${attack.range}` : 'adjacent';
    lines.push({ text: `Basic attack: ${attack.style}, ${reach}, ${Math.round(attack.damage * 100)}% ${attack.scaling}` });
    if (item.handRule === 'twoHanded') lines.push({ text: 'Two-handed: empties the off hand', tone: 'warn' });
  }
  if (isLegendaryGrade(item.rarity) && item.masteryLock?.length) {
    lines.push({ text: `Set piece of ${item.masteryLock.map((m) => pathName(findMasteryPath(m as MasteryId) ?? { id: m, name: m })).join(', ')}` });
  }
  lines.push({ text: `Item level ${item.itemLevel}`, tone: 'meta' });
  return lines;
}

// ─── Heroes ───────────────────────────────────────────────────────────────────

export function wearerOf(config: Pick<SimHeroConfig, 'templateId' | 'masteryPath'>): Wearer {
  const template = heroTemplates.find((t) => t.id === config.templateId)!;
  return { heroClass: template.heroClass, masteryPath: config.masteryPath };
}

export function wornItems(config: SimHeroConfig): EquippedItems {
  const worn: EquippedItems = {};
  for (const slot of EQUIP_SLOTS) {
    const id = config.equipment[slot];
    const item = id ? simSlotItem(id, config.upgrades?.[slot]) : null;
    if (item) worn[slot] = item;
  }
  return worn;
}

/**
 * A new level, keeping as much of the build as that level can still hold.
 *
 * Nodes are replayed in the order they were bought and the first one the new
 * level cannot afford ends the list, so dropping a level gives back the last
 * points spent rather than invalidating the whole recipe.
 */
export function withLevel(config: SimHeroConfig, level: number): SimHeroConfig {
  const next = { ...config, level: Math.max(1, Math.min(highestLevelCap(), level)) };
  if (next.level < BALANCE.MASTERY_UNLOCK_LEVEL) return { ...next, masteryPath: null, masteryNodes: [] };
  const kept: string[] = [];
  for (const node of config.masteryNodes) {
    const probe = simMasteryHero({ ...next, masteryNodes: kept });
    if (!probe || !canUnlockNode(probe, node).ok) break;
    kept.push(node);
  }
  return { ...next, masteryNodes: kept };
}

/** A new path: its nodes go, and so does any gear the new path may not hold. */
export function withPath(config: SimHeroConfig, path: MasteryId | null): SimHeroConfig {
  return dropIllegal({ ...config, masteryPath: path, masteryNodes: [] });
}

/**
 * Removes worn pieces the hero may no longer wear, after a class or path change
 * or a new piece. `keep` is dressed first, so the piece just picked wins: a
 * two-hander takes the off hand off rather than being refused by it.
 */
export function dropIllegal(config: SimHeroConfig, keep?: EquipSlot): SimHeroConfig {
  const wearer = wearerOf(config);
  const equipment: SimHeroConfig['equipment'] = {};
  const worn: EquippedItems = {};
  for (const slot of keep ? [keep, ...DRESS_ORDER.filter((s) => s !== keep)] : DRESS_ORDER) {
    const id = config.equipment[slot];
    const item = id ? simSlotItem(id, config.upgrades?.[slot]) : null;
    if (!id || !item) continue;
    const check = canEquip(wearer, item, slot, worn);
    if (check.ok && check.displaces.length === 0) { equipment[slot] = id; worn[slot] = item; }
  }
  return { ...config, equipment };
}

/** Hands first, so an off hand is judged against the main hand it goes beside. */
const DRESS_ORDER: EquipSlot[] = ['mainHand', 'offHand', ...EQUIP_SLOTS.filter((s) => s !== 'mainHand' && s !== 'offHand')];

/**
 * Dresses every empty slot in one rarity: the path's own set pieces first, then
 * its forms (plate for a Champion, a bow for a Marksman), then whatever the
 * class may wear. A starting point to edit, not a best-in-slot solver.
 */
export function quickFill(config: SimHeroConfig, rarity: Rarity, replace = false): SimHeroConfig {
  const wearer = wearerOf(config);
  const forms = new Set(
    (config.masteryPath ? [config.masteryPath] : masteriesForClass(wearer.heroClass).map((p) => p.id as MasteryId))
      .flatMap((p) => setFormsOf(p)),
  );
  const start = replace ? { ...config, equipment: {} } : config;
  const equipment = { ...start.equipment };
  const worn = wornItems(start);
  for (const slot of DRESS_ORDER) {
    if (equipment[slot]) continue;
    let best: { id: string; item: Item; score: number } | null = null;
    for (const t of itemTemplates) {
      const mythic = rarity === Rarity.Mythic;
      if ((mythic ? !canBeMythic(t) : t.rarity !== rarity) || !slotAccepts(slot, t.slot)) continue;
      const slotId = mythic ? `${MYTHIC_SLOT}${t.id}` : t.id;
      const item = simSlotItem(slotId, start.upgrades?.[slot]);
      if (!item) continue;
      const check = canEquip(wearer, item, slot, worn);
      if (!check.ok || check.displaces.length > 0) continue;
      const score = (config.masteryPath && t.masteryLock?.includes(config.masteryPath) ? 4 : 0)
        + (forms.has(t.form) ? 2 : 0) + (t.classLock?.includes(wearer.heroClass) ? 1 : 0);
      if (!best || score > best.score) best = { id: slotId, item, score };
    }
    if (best) { equipment[slot] = best.id; worn[slot] = best.item; }
  }
  return { ...start, equipment };
}

// ─── Recipes ──────────────────────────────────────────────────────────────────

/** One line that tells two saved setups apart in a list. */
export function recipeSummary(recipe: ScenarioRecipe): string {
  const party = recipe.party.map((h) => {
    const name = templateName(h.templateId);
    const path = h.masteryPath ? pathName(findMasteryPath(h.masteryPath) ?? { id: h.masteryPath }) : undefined;
    return `${path ?? name} ${h.level}`;
  }).join(', ');
  const quests = Object.keys(recipe.quests).length;
  const items = recipe.bag.length + recipe.stash.length;
  return [party, `${recipe.resources[ResourceType.Gold] ?? 0} gold`,
    quests ? `${quests} quest${quests > 1 ? 's' : ''}` : '',
    items ? `${items} item${items > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
}

export type QuestChoice = 'unstarted' | 'active' | 'ready' | 'completed';

export function questChoice(recipe: ScenarioRecipe, id: QuestId, stages: number): QuestChoice {
  const record = recipe.quests[id];
  if (!record) return 'unstarted';
  if (record === 'completed') return 'completed';
  return record.stage >= stages ? 'ready' : 'active';
}

/** The hero a config builds, with the stats its gear gives it, for the wizard's review. */
export function heroPreview(config: SimHeroConfig) {
  const items: Item[] = [];
  const hero = buildSimHero(config, (item) => {
    const id = `preview_item_${items.length}`;
    items.push({ ...item, id });
    return id;
  }, 'preview_hero');
  if (!hero) return null;
  return {
    hero,
    stats: getEffectiveStats(hero, items),
    maxHp: heroMaxHp(hero, items),
    maxMana: heroMaxMana(hero, items),
    problems: illegalSlots(hero, equippedItemsFor(hero, items)).map((p) => equipRefusalText(p.reason)),
  };
}

/**
 * The recipe without one hero. Per-hero settings are keyed by party index, so
 * the heroes after it move down one and take their settings with them.
 */
export function withoutHero(recipe: ScenarioRecipe, index: number): ScenarioRecipe {
  const shift = (i: number) => (i > index ? i - 1 : i);
  const settings = recipe.equipmentSettings && Object.fromEntries(Object.entries(recipe.equipmentSettings)
    .flatMap(([key, value]) => {
      const [i, slot] = key.split('.');
      return Number(i) === index ? [] : [[`${shift(Number(i))}.${slot}`, value]];
    }));
  const state = recipe.heroState && Object.fromEntries(Object.entries(recipe.heroState)
    .flatMap(([i, value]) => (Number(i) === index ? [] : [[shift(Number(i)), value]])));
  return {
    ...recipe,
    party: recipe.party.filter((_, i) => i !== index),
    ...(settings ? { equipmentSettings: settings } : {}),
    ...(state ? { heroState: state } : {}),
  };
}
