import {
  Hero, Item, Rarity, EnemyTemplate, EQUIP_SLOTS, EquipSlot, ItemSlot, ItemTemplate, MasteryId,
  ResourceType,
} from '@/models/types';
import { itemTemplates } from '@/data/items/itemTemplates';
import { BALANCE } from '@/data/balanceConstants';
import { itemFromTemplate, mintItem, mintMythic } from '@/systems/economy/itemFactory';
import { dropItemLevel, LootGround } from '@/systems/economy/itemLevelSources';
import { canEquip, slotsFor } from '@/systems/progression/equipRules';
import { levelCap } from '@/data/levelCap';
import { GearWorld, inWorld } from '@/data/items/worldGear';
import { isCollectionMotif } from '@/data/items/collections';
import { canBeMythic } from '@/data/items/setBonus';
import { mythicDue, type MythicRoll } from '@/systems/economy/mythicDrops';

/** Who a roll is for. Only the fields `canEquip` asks. */
export type LootWearer = Pick<Hero, 'heroClass' | 'masteryPath'>;

/**
 * What a roll knows about the fight it pays for. Every field is optional, and
 * leaving one out is the answer that existed before it did: no party is an
 * unrestricted roll, no ground mints at the rarity's anchor, no rng is
 * `Math.random`.
 */
export interface LootOptions {
  /** The party the loot is for — see `BALANCE.PARTY_LOOT_BIAS`. */
  party?: LootWearer[];
  /** Where the fight was, which is what level its loot is. */
  ground?: LootGround;
  rng?: () => number;
  /** Positive shift of the rarity die; authored rewards bypass it. */
  rarityLuck?: number;
  /**
   * Which world the fight is in. A world's own gear (`ItemTemplate.world`) is in
   * the pool only there; omitted is the Empire, whose pools are exactly the
   * catalogue they always were (`worldGear.ts`).
   */
  world?: GearWorld | 'empire';
  /**
   * Template ids the party already owns, equipped or carried (`ownedTemplateIds`).
   * A Legendary roll draws what is not in it, and only once the pool it would
   * draw from is all owned does it repeat. Read, never changed: a roll that pays
   * several pieces tracks its own copy so they do not repeat each other.
   */
  owned?: ReadonlySet<string>;
  /**
   * A boss beyond the Empire's mythic roll (`mythicRollFor`), carried for the whole fight
   * and written by it. Absent is no mythic, and the dice everywhere else are untouched.
   */
  mythic?: MythicRoll | null;
}

/** The templates of the gear a party owns, for `LootOptions.owned`. */
export function ownedTemplateIds(gear: readonly Pick<Item, 'templateId'>[]): Set<string> {
  return new Set(gear.map((item) => item.templateId));
}

/** `options` with a set of its own for one roll to add what it pays to. */
function tracking(options: LootOptions): LootOptions {
  return { ...options, owned: new Set(options.owned) };
}

/** Marks a paid piece as owned for the rest of a tracked roll. */
function remember(options: LootOptions, item: Item | null): Item | null {
  if (item) (options.owned as Set<string> | undefined)?.add(item.templateId);
  return item;
}

/** What a Legendary roll should draw from: the pieces not yet owned, or all of them once none are left. */
function unownedFirst(pool: ItemTemplate[], options: LootOptions): ItemTemplate[] {
  const fresh = pool.filter((t) => !options.owned?.has(t.id));
  return fresh.length > 0 ? fresh : pool;
}

/**
 * The templates a roll in this world may draw from. A boss's own item
 * (`ItemTemplate.bossOnly`) is in no pool: only that boss's roll pays it.
 */
function worldPool(options: LootOptions): ItemTemplate[] {
  return itemTemplates.filter((t) => !t.bossOnly && inWorld(t, options.world));
}

/**
 * In a world with legendaries of its own, how a legendary roll is narrowed to
 * them: with `BALANCE.WORLD_LEGENDARY_SHARE`, to the world's own pieces (that
 * `prefer` keeps, when any survive it). The die is thrown only in such a world,
 * so a roll in the Empire draws exactly the dice it always did.
 */
function worldLean(pool: ItemTemplate[], options: LootOptions, prefer: (t: ItemTemplate) => boolean = () => true): ItemTemplate[] {
  if (!options.world || options.world === 'empire') return pool;
  const rng = options.rng ?? Math.random;
  const own = pool.filter((t) => t.world === options.world);
  if (rng() >= BALANCE.WORLD_LEGENDARY_SHARE || own.length === 0) return pool;
  const preferred = own.filter(prefer);
  return preferred.length > 0 ? preferred : own;
}

/**
 * One drop, minted.
 *
 * Four call sites here used to spread the template by hand, which is how loot
 * became the one route into the bag that did not go through `itemFactory` — and
 * therefore the one route affixes would silently have skipped. It is also the
 * route that matters most: a boss's drop and a chest's are the pieces a player
 * remembers.
 */
function drop(template: ItemTemplate, options: LootOptions = {}): Item {
  const rng = options.rng ?? Math.random;
  const level = options.ground ? dropItemLevel(options.ground, rng) : undefined;
  return { ...mintItem(template, rng, level, options.party, options.ground?.content?.ceiling), id: `loot_${Date.now()}_${Math.random()}` };
}

/**
 * Whether anybody in the party could put this on, in any slot it fits.
 *
 * Asked of an empty body, because the question is about the piece and not
 * about what is being worn today: a sword is wearable by a Champion holding a
 * better sword. `canEquip` rather than a restated class check, for
 * `questGear`'s reason — the mastery weapon lock is the clause a restatement
 * forgets, and it would hand a Skirmisher a bow.
 */
export function wearableByParty(template: ItemTemplate, party: LootWearer[]): boolean {
  const item = itemFromTemplate(template);
  return party.some((hero) =>
    slotsFor(template.slot).some((slot) => canEquip(hero, item, slot, {}).ok));
}

const RARITY_RANK: Record<Rarity, number> = {
  [Rarity.Common]: 0,
  [Rarity.Rare]: 1,
  [Rarity.Epic]: 2,
  [Rarity.Legendary]: 3,
  [Rarity.Mythic]: 4,
};

/**
 * The best a body of this tier can be carrying.
 *
 * Flat weights with nothing about the fight in scope let home-ring chaff drop
 * Epics at a warchief's rate, which costs an Epic its meaning and undercuts the
 * threat gradient's whole promise that distant ground pays better.
 *
 * A **ceiling**, not a floor, applied by stepping *down* rather than refusing
 * to drop — loot volume is unchanged, only the top end moves, so clearing chaff
 * still pays. Bosses read their own table.
 */
const RARITY_CEILING: Record<EnemyTemplate['tier'], Rarity> = {
  normal: Rarity.Rare,
  elite: Rarity.Epic,
  boss: Rarity.Legendary,
};

export function rollLoot(enemies: EnemyTemplate[], options: LootOptions = {}): Item[] {
  const loot: Item[] = [];
  const rng = options.rng ?? Math.random;

  for (const enemy of enemies) {
    if (enemy.tier === 'boss') {
      loot.push(...rollBossLoot(enemy, options));
      continue;
    }

    // Check elite-specific loot table (50% chance per entry). Authored, so it
    // takes the fight's level but never the party bias — it is not random.
    if (enemy.lootTable) {
      for (const entry of enemy.lootTable) {
        if (rng() < 0.5) {
          const template = itemTemplates.find((t) => t.id === entry.templateId);
          if (template) loot.push(drop(template, options));
        }
      }
    }

    // Random loot roll (50% chance per enemy)
    if (rng() < 0.5) {
      const item = rollRandomItem(RARITY_CEILING[enemy.tier], options);
      if (item) loot.push(item);
    }
  }

  return loot;
}

/**
 * What one boss kill pays, the same on the first kill and the hundredth: one
 * Legendary, `BOSS_LOOT.SECOND_LEGENDARY_CHANCE` of a second and never a third,
 * then `BOSS_LOOT.OTHER_ITEMS` Epics and Rares aimed at the party like any drop.
 *
 * The boss's own item (its `lootTable`, `ItemTemplate.bossOnly`) is rolled at
 * `BOSS_LOOT.ONLY_ITEM_CHANCE` and takes the place of a random Legendary, so it
 * can never push the count past two. A piece the party already owns is not
 * rolled for, like any Legendary. A mythic (`rollBossMythic`) is rolled first,
 * inside the same count, so it takes a Legendary's place too.
 */
export function rollBossLoot(boss: EnemyTemplate, options: LootOptions = {}): Item[] {
  const rng = options.rng ?? Math.random;
  const tracked = tracking(options);
  const cfg = BALANCE.BOSS_LOOT;
  const masteries = (options.party ?? [])
    .map((hero) => hero.masteryPath).filter((path): path is MasteryId => !!path);

  const legendaries = 1 + (rng() < cfg.SECOND_LEGENDARY_CHANCE ? 1 : 0);
  const items: Item[] = [];
  const mythic = remember(tracked, rollBossMythic(tracked));
  if (mythic) items.push(mythic);
  for (const entry of boss.lootTable ?? []) {
    if (items.length >= legendaries || tracked.owned?.has(entry.templateId)) continue;
    const template = itemTemplates.find((t) => t.id === entry.templateId);
    if (template && rng() < cfg.ONLY_ITEM_CHANCE) items.push(remember(tracked, drop(template, tracked))!);
  }
  while (items.length < legendaries) {
    const piece = remember(tracked, rollLegendary(masteries, tracked));
    if (!piece) break;
    items.push(piece);
  }

  const { min, max } = cfg.OTHER_ITEMS;
  const others = min + Math.floor(rng() * (max - min + 1));
  for (let i = 0; i < others; i++) {
    const rarity = rng() < cfg.EPIC_SHARE ? Rarity.Epic : Rarity.Rare;
    const piece = rollItemOfRarity(rarity, tracked, BALANCE.PARTY_LOOT_BIAS);
    if (piece) items.push(piece);
  }
  return items;
}

/**
 * One kill's mythic, or null. A hero of the party is chosen fairly among those with a set piece
 * they can wear that the party does not hold as a mythic, and the piece is one of theirs. A kill
 * with no such piece left is not an eligible one: it throws no die and leaves the counter alone.
 */
function rollBossMythic(options: LootOptions): Item | null {
  const roll = options.mythic;
  if (!roll) return null;
  const rng = options.rng ?? Math.random;
  const pieces = worldPool(options).filter((t) => canBeMythic(t) && !roll.held.has(t.id));
  const choices = (options.party ?? [])
    .map((hero) => ({ hero, pool: pieces.filter((t) => wearableByParty(t, [hero])) }))
    .filter(({ pool }) => pool.length > 0);
  if (choices.length === 0) return null;

  roll.kills += 1;
  if (!mythicDue(roll.kills, roll.chance, rng)) return null;
  roll.kills = 0;
  const { hero, pool } = choices[Math.floor(rng() * choices.length)];
  const template = pool[Math.floor(rng() * pool.length)];
  roll.held.add(template.id);
  const item = mintMythic(template, rng, [hero], options.ground?.content?.ceiling);
  return item && { ...item, id: `loot_${Date.now()}_${Math.random()}` };
}

/**
 * The chest at the end of a dungeon run.
 *
 * Replaces the usual per-enemy reward roll entirely — 3–5 items, each
 * independently rolling a 20% chance to be Legendary. Roughly one legendary a
 * run, sometimes three, occasionally none.
 *
 * Chest legendaries **can be mastery set pieces**, which deliberately breaks the
 * craftable-only rule from v0.4. The sets stay craftable, because a 20% roll on
 * the piece you actually want is not a plan: the forge is how you *finish* a
 * set, the chest is how you get surprised by one.
 *
 * @param availableMasteries paths the party actually walks. Set pieces are
 *   biased toward them — a Nightveil dagger for a party with no Shadowblade is
 *   a dead item. Only biased, never filtered: off-path legendaries are the best
 *   salvage fodder in the game, and the Crystal loop needs a supply.
 * @param options the ordinary pieces are ordinary random rolls, so they take
 *   the party bias and the run's level like any drop. The legendary branch
 *   keeps its own on-path weighting and nothing is layered over it.
 */
export function rollChest(availableMasteries: MasteryId[] = [], options: LootOptions = {}): Item[] {
  const rng = options.rng ?? Math.random;
  const tracked = tracking(options);
  const { min, max } = BALANCE.CHEST_ITEMS;
  const count = min + Math.floor(rng() * (max - min + 1));

  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    const item = rng() < BALANCE.CHEST_LEGENDARY_CHANCE
      ? remember(tracked, rollLegendary(availableMasteries, tracked))
      : rollRandomItem(Rarity.Legendary, tracked);
    if (item) items.push(item);
  }
  return items;
}

/** What a lair's chest is guaranteed to hold, besides ordinary pieces. */
export type LairChestKit = 'legendary' | 'epics';

/** The guaranteed pieces of each lair chest: one legendary, or two epics. */
const LAIR_CHEST_GUARANTEE: Record<LairChestKit, { rarity: Rarity; count: number }> = {
  legendary: { rarity: Rarity.Legendary, count: 1 },
  epics: { rarity: Rarity.Epic, count: 2 },
};

/**
 * A chest in a dungeon: guaranteed pieces **made for the party**, then ordinary
 * rolls up to `BALANCE.CHEST_ITEMS`.
 *
 * The first chest holds one Legendary and the second two Epics, and each
 * guaranteed piece is rolled for one named hero — taken in turn from a shuffled
 * party, so two Epics go to two different heroes when there are two. This
 * replaced `rollChest` for lairs after a playtest opened a chest holding two
 * Legendaries for the one class nobody in the party was playing: a 20%-per-item
 * Legendary roll over the whole library is a lottery that can pay nothing a
 * hero can wear.
 */
export function rollLairChest(
  kit: LairChestKit,
  availableMasteries: MasteryId[] = [],
  options: LootOptions = {},
): Item[] {
  const rng = options.rng ?? Math.random;
  const tracked = tracking(options);
  const { rarity, count } = LAIR_CHEST_GUARANTEE[kit];
  const party = options.party ?? [];

  // Shuffled once, then dealt round-robin: every hero is equally likely to be
  // first, and nobody gets a second piece before everybody has had one.
  const order = [...party];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    const hero = order.length > 0 ? order[i % order.length] : undefined;
    const piece = rarity === Rarity.Legendary
      ? remember(tracked, rollTailoredLegendary(order, availableMasteries, tracked))
      : rollItemOfRarity(rarity, hero ? { ...tracked, party: [hero] } : tracked, 1);
    if (piece) items.push(piece);
  }

  const { min, max } = BALANCE.CHEST_ITEMS;
  const total = min + Math.floor(rng() * (max - min + 1));
  while (items.length < total) {
    const extra = rollRandomItem(Rarity.Legendary, tracked);
    if (!extra) break;
    items.push(extra);
  }
  return items;
}

/**
 * A legendary one of the party can wear, taken from the first hero in `order`
 * who has any — a hero with no path chosen yet may have none at all, and the
 * piece should still be for somebody. Falls back to any legendary only when
 * nobody in the party can wear one.
 */
function rollTailoredLegendary(
  order: LootWearer[],
  availableMasteries: MasteryId[],
  options: LootOptions,
): Item | null {
  const rng = options.rng ?? Math.random;
  const all = worldPool(options).filter((t) => t.rarity === Rarity.Legendary);
  if (all.length === 0) return null;
  // Pieces not owned yet come first; a hero with none left to wear passes the
  // roll to the next, and the whole library repeats only once nothing is new
  const legendaries = unownedFirst(all, options);
  for (const hero of order) {
    const wearable = legendaries.filter((t) => wearableByParty(t, [hero]));
    if (wearable.length > 0) {
      const pool = worldLean(wearable, options);
      return drop(pool[Math.floor(rng() * pool.length)], options);
    }
  }
  const pool = order.length > 0
    ? legendaries
    : legendaries.filter(
      (t) => !t.masteryLock || t.masteryLock.some((m) => availableMasteries.some((a) => a === m)),
    );
  const from = pool.length > 0 ? pool : legendaries;
  return drop(from[Math.floor(rng() * from.length)], options);
}

function rollLegendary(availableMasteries: MasteryId[], options: LootOptions): Item | null {
  const rng = options.rng ?? Math.random;
  const all = worldPool(options).filter((t) => t.rarity === Rarity.Legendary);
  if (all.length === 0) return null;
  // What the party does not own yet; every narrowing below is inside it, so a
  // hero whose wearable pieces are all owned falls back to the rest of it
  const legendaries = unownedFirst(all, options);

  // With a party in hand the lean is toward one hero's wearable legendaries,
  // chosen fairly — reading only the chosen paths aimed every chest at whoever
  // had picked one, and a recruit still short of their path got none of it.
  const party = options.party ?? [];
  const who = party[Math.floor(rng() * party.length)];
  const onPath = who
    ? legendaries.filter((t) => wearableByParty(t, [who]))
    : legendaries.filter(
      (t) => !t.masteryLock || t.masteryLock.some((m) => availableMasteries.some((a) => a === m)),
    );
  // The bias only applies when there is something to bias toward — a party that
  // has not chosen a path yet gets the whole library rather than nothing
  const biased = onPath.length > 0 && rng() < BALANCE.CHEST_ON_PATH_BIAS
    ? onPath
    : legendaries;
  // In a world of its own legendaries, most are the world's — and, where the
  // roll leans to a hero, ones that hero can wear
  const pool = worldLean(biased, options, (t) => !who || wearableByParty(t, [who]));

  return drop(pool[Math.floor(rng() * pool.length)], options);
}

/**
 * One piece of a world's collections, for one hero of the party who can wear it
 * — taken from a shuffled party, the first hero with a wearable piece. A
 * guaranteed reward (`jadeveilRewards.ts`), so it is always for somebody; only
 * a party that can wear none of them is handed any piece.
 */
export function rollCollectionPiece(world: GearWorld, options: LootOptions = {}): Item | null {
  const rng = options.rng ?? Math.random;
  const pieces = itemTemplates.filter((t) => t.world === world && t.rarity === Rarity.Legendary && isCollectionMotif(t.motif));
  if (pieces.length === 0) return null;
  const order = [...(options.party ?? [])];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const hero of order) {
    const wearable = pieces.filter((t) => wearableByParty(t, [hero]));
    if (wearable.length > 0) return drop(wearable[Math.floor(rng() * wearable.length)], { ...options, party: [hero] });
  }
  return drop(pieces[Math.floor(rng() * pieces.length)], options);
}

/** An authored piece by id, minted at the fight's ground — a guaranteed reward. */
export function authoredDrop(templateId: string, options: LootOptions = {}): Item | null {
  const template = itemTemplates.find((t) => t.id === templateId);
  return template ? drop(template, options) : null;
}

/**
 * A slot's share of drops is its share of the body.
 *
 * Derived by counting `EQUIP_SLOTS`, never authored, so adding an equip slot
 * moves the drop table with it rather than leaving a hand-written list one entry
 * short of the hero it dresses.
 *
 * This exists because the roll used to be uniform over every template of a
 * rarity, which makes the *library's composition* the drop rate — and the
 * library is form × motif, so the fourteen weapon forms and six off-hands
 * outnumbered the sixteen armour forms once each weight's themed subset was
 * accounted for. Measured on the shipped pool before this: 47.7% of Epic drops
 * were main-hand weapons against 25.0% for all four armour slots put together,
 * and 6.8% for both rings and the neck combined. A party of four wears four
 * chest pieces and one weapon each; the table was paying out the other way
 * round, and the effect of adding an armour motif would have been to make
 * weapons *rarer* rather than to make armour commoner.
 *
 * **`ItemSlot` collapses `ring1`/`ring2` into one `ring`, and that entry is
 * capped at 1 — the one deliberate departure from the count.** Weighting the two
 * ring fingers separately is the arithmetically pure reading and it was measured
 * and rejected: it put a *third* of all loot on the neck and the two rings,
 * which between them are served by exactly **two forms**. Ten distinct templates
 * at Rare were carrying 33% of drops while seventy weapon templates carried 11%,
 * so the commonest thing in the game became a band the player already had, and
 * the deepest part of the library became unreachable.
 *
 * The rule survives with its meaning intact — a slot's share is its share of the
 * body — because a second ring finger is not a second *want*: nobody hunts a
 * matched pair the way they hunt a chest piece. Armour is 50% of drops, weapons
 * 12.5%, and the ring pool no longer outpaces its own variety.
 *
 * Capped here rather than by writing the table out, so the derivation still
 * carries: a new armour or hand slot moves the weights on its own, and only the
 * duplicated finger is special-cased.
 */
const MAX_WEIGHT_PER_ITEM_SLOT = 1;

export const SLOT_DROP_WEIGHT: Record<ItemSlot, number> = (() => {
  const out = {} as Record<ItemSlot, number>;
  for (const slot of EQUIP_SLOTS) {
    const item = itemSlotOf(slot);
    out[item] = Math.min(MAX_WEIGHT_PER_ITEM_SLOT, (out[item] ?? 0) + 1);
  }
  return out;
})();

/** Which `ItemSlot` an equip slot draws from. Both ring fingers take a `ring`. */
function itemSlotOf(slot: EquipSlot): ItemSlot {
  return slot === 'ring1' || slot === 'ring2' ? 'ring' : slot;
}

/**
 * One ordinary random piece of equipment.
 *
 * Four draws, each inside the one before, and the order is the rule: **rarity**,
 * then **slot**, then **whose**, then **which**. Every later draw is made inside
 * what the earlier ones settled, so nothing downstream can move an earlier
 * probability — the party bias picks among pieces of the rarity and slot already
 * rolled, and never makes a rare commoner or a helm likelier.
 *
 * - *Whose*: with a party given, `BALANCE.PARTY_LOOT_BIAS` of rolls narrow the
 *   slot's pool to what one hero, picked uniformly, can wear — so every hero
 *   gets an equal share of the lean. A narrowed pool that comes out
 *   empty falls back to the party's, and when nobody in the party can use
 *   anything of that slot at that rarity it **falls back to the whole pool**, because a drop that vanishes for being
 *   unwearable is a worse outcome than one that is unwearable.
 * - *Which*: a form first, uniformly, then a template of it. So a form's share
 *   of drops is not its share of the catalogue, and adding motifs or named
 *   variants to one silhouette does not make it the commonest thing on the
 *   ground — the slot weights' argument, one level down.
 *
 * @param ceiling the best this drop may be. A roll above it steps down rather
 *   than being thrown away — see `RARITY_CEILING`. Defaults to no cap, which is
 *   what the forge preview and the tests want.
 */
export function rollRandomItem(
  ceiling: Rarity = Rarity.Legendary,
  options: LootOptions = {},
): Item | null {
  const rng = options.rng ?? Math.random;
  const rarity = capRarity(rollRarity(() => Math.max(0, rng() - (options.rarityLuck ?? 0))), ceiling);
  return rollItemOfRarity(rarity, options, BALANCE.PARTY_LOOT_BIAS);
}

/**
 * The piece a guarded map chest holds on top of its guards' drops. Its tier is
 * rolled on `CHEST_RARITY_ODDS` for the guards' band, so stronger ground pays in
 * rarer pieces — Legendary at band 4 only, which the flat drop weights never give.
 */
export function rollChestGuardItem(band: number, options: LootOptions = {}): Item | null {
  const rng = options.rng ?? Math.random;
  const table = BALANCE.EXPLORATION_FINDS.CHEST_RARITY_ODDS;
  const odds = table[Math.max(0, Math.min(table.length - 1, Math.floor(band)))];
  const roll = Math.max(0, rng() - (options.rarityLuck ?? 0)) * 100;
  const rarity = roll < odds.legendary ? Rarity.Legendary
    : roll < odds.legendary + odds.epic ? Rarity.Epic
      : roll < odds.legendary + odds.epic + odds.rare ? Rarity.Rare : Rarity.Common;
  return rollItemOfRarity(rarity, options, BALANCE.PARTY_LOOT_BIAS);
}

/**
 * What a won siege leaves in the streets besides its dead (playtest 2026-10-14:
 * a siege victory paid nothing of its own). `SIEGE_SPOILS_ITEMS` pieces, each
 * Epic at `SIEGE_SPOILS_EPIC_CHANCE` and Rare otherwise, aimed at the party the
 * way a chest's are. Meal luck does not reach them: they are spoils, not a roll.
 */
export function rollSiegeSpoils(options: LootOptions = {}): Item[] {
  const rng = options.rng ?? Math.random;
  const items: Item[] = [];
  for (let i = 0; i < BALANCE.SIEGE_SPOILS_ITEMS; i++) {
    const rarity = rng() < BALANCE.SIEGE_SPOILS_EPIC_CHANCE ? Rarity.Epic : Rarity.Rare;
    const piece = rollItemOfRarity(rarity, options, BALANCE.PARTY_LOOT_BIAS);
    if (piece) items.push(piece);
  }
  return items;
}

/**
 * The slot, whose and which draws of `rollRandomItem`, for a rarity already
 * settled. `partyBias` is the chance the roll is narrowed to what one hero can
 * wear — 1 makes the piece certain to be for somebody, which is what a chest's
 * guaranteed pieces want.
 */
function rollItemOfRarity(rarity: Rarity, options: LootOptions, partyBias: number): Item | null {
  const rng = options.rng ?? Math.random;
  // Set pieces are forge-only. Belt and braces: `RARITY_WEIGHTS.legendary` is 0
  // today, but a future boss table with a legendary weight would otherwise start
  // dropping mastery sets to parties that never chose the path.
  let candidates = worldPool(options).filter(
    (t) => t.rarity === rarity && !t.masteryLock,
  );
  // A piece that is certain to be for somebody has to be settled before the
  // slot is: otherwise the slot die can land on one the hero has nothing in
  // (a ring they cannot wear at Epic) and the pool falls back to unwearable.
  const forWho = partyBias >= 1 ? options.party?.[0] : undefined;
  if (forWho) {
    const mine = candidates.filter((t) => wearableByParty(t, [forWho]));
    if (mine.length > 0) candidates = mine;
  }
  if (candidates.length === 0) return null;

  // Slot first, then a template within it. The weights are renormalised over the
  // slots that actually have something at this rarity rather than rolled and
  // retried, so an empty slot cannot swallow a drop — a rarity with no rings in
  // it must still pay out, not silently vanish 22% of the time. A slot missing
  // entirely is a hole worth failing a test over (see `lootGenerator.test.ts`),
  // not worth losing an item over at runtime.
  const bySlot = groupBy(candidates, (t) => t.slot);

  const slots = [...bySlot.keys()];
  const total = slots.reduce((n, s) => n + SLOT_DROP_WEIGHT[s], 0);
  let roll = rng() * total;
  let chosen = slots[slots.length - 1];
  for (const slot of slots) {
    roll -= SLOT_DROP_WEIGHT[slot];
    if (roll < 0) { chosen = slot; break; }
  }

  const slotPool = bySlot.get(chosen)!;
  const party = options.party ?? [];
  // Drawn whether or not there is a party, so the dice after it land the same
  // way either way and a seeded roll does not shift under a caller that starts
  // passing one.
  const biased = rng() < partyBias && party.length > 0;
  // *Whose* is one hero, not the party. Narrowing to what anybody at all can
  // wear hands each hero a share proportional to how many forms their class
  // has in the slot, and a playtest read that as the loot being for the first
  // hero only. Drawn unconditionally, for the bias die's reason.
  const who = party[Math.floor(rng() * party.length)];
  const pool = biased ? wearablePool(slotPool, who, party) : slotPool;

  const forms = [...groupBy(pool, (t) => t.form).values()];
  const form = forms[Math.floor(rng() * forms.length)];
  return drop(form[Math.floor(rng() * form.length)], options);
}

/**
 * What one hero can wear out of a slot's pool, falling back to what anybody in
 * the party can, and then to the whole pool — a drop that vanishes for being
 * unwearable is worse than one that is unwearable.
 */
function wearablePool(slotPool: ItemTemplate[], who: LootWearer, party: LootWearer[]): ItemTemplate[] {
  const theirs = slotPool.filter((t) => wearableByParty(t, [who]));
  if (theirs.length > 0) return theirs;
  const anyone = slotPool.filter((t) => wearableByParty(t, party));
  return anyone.length > 0 ? anyone : slotPool;
}

function groupBy<K>(templates: ItemTemplate[], key: (t: ItemTemplate) => K): Map<K, ItemTemplate[]> {
  const out = new Map<K, ItemTemplate[]>();
  for (const t of templates) {
    const k = key(t);
    const list = out.get(k);
    if (list) list.push(t);
    else out.set(k, [t]);
  }
  return out;
}

/** Steps a roll down to the ceiling, leaving anything at or below it alone. */
export function capRarity(rarity: Rarity, ceiling: Rarity): Rarity {
  return RARITY_RANK[rarity] <= RARITY_RANK[ceiling] ? rarity : ceiling;
}

// Non-gold resource types eligible for combat bonus drops
const BONUS_RESOURCE_TYPES = [
  ResourceType.Wood,
  ResourceType.Stone,
  ResourceType.Iron,
  ResourceType.Crystal,
] as const;

type BonusResourceType = (typeof BONUS_RESOURCE_TYPES)[number];

/**
 * Roll bonus resources awarded after a combat victory.
 * @param totalPartyLevel  Sum of all party hero levels.
 * @param partySize        Number of heroes in the party.
 */
export function rollBonusResources(
  totalPartyLevel: number,
  partySize: number,
): { type: ResourceType; amount: number }[] {
  const avgLevel = partySize > 0 ? totalPartyLevel / partySize : 1;
  // Scaled against the cap in force so raising the cap stretches the ramp rather than
  // overshooting it — a flat per-level rate hits certainty well before cap.
  const levelProgress = Math.min(1, avgLevel / levelCap());
  const dropChance =
    BALANCE.COMBAT_BONUS_RESOURCE.BASE_CHANCE +
    levelProgress * BALANCE.COMBAT_BONUS_RESOURCE.CHANCE_AT_MAX_LEVEL;

  if (Math.random() > dropChance) return [];

  // Shuffle the eligible types and pick 1 or 2 (stronger parties more likely to get 2)
  const shuffled = [...BONUS_RESOURCE_TYPES].sort(() => Math.random() - 0.5);
  const count = Math.random() < levelProgress ? 2 : 1;

  const amounts = BALANCE.COMBAT_BONUS_RESOURCE.AMOUNTS;
  return shuffled.slice(0, count).map((type) => {
    const range = amounts[type as BonusResourceType];
    const amount = range.min + Math.floor(Math.random() * (range.max - range.min + 1));
    return { type, amount };
  });
}

function rollRarity(rng: () => number): Rarity {
  const roll = rng() * 100;
  const weights = BALANCE.RARITY_WEIGHTS;

  if (roll < weights.legendary) return Rarity.Legendary;
  if (roll < weights.legendary + weights.epic) return Rarity.Epic;
  if (roll < weights.legendary + weights.epic + weights.rare) return Rarity.Rare;
  return Rarity.Common;
}
