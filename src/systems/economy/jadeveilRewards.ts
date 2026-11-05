import { EnemyTemplate, Item, MasteryId, Rarity } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { motifWorld } from '@/data/items/worldGear';
import type { WorldId } from '@/data/worlds';
import { shrineOfEncounter } from '@/systems/world/shrines';
import { summitTierFromId } from '@/systems/world/summit';
import { authoredDrop, LairChestKit, LootOptions, rollCollectionPiece, rollLairChest } from '@/systems/economy/lootGenerator';

/**
 * What Jadeveil pays that the Empire does not: Spirit Ink, and the pieces the
 * range guarantees (`docs/quests-progression-items.md`, *Jadeveil
 * equipment*).
 *
 * **The chase is the range's own, and it is finite.** Every legendary roll in the
 * range leans to its four collections and two weapons (`WORLD_LEGENDARY_SHARE`),
 * its ordinary rolls draw Votive and Spiritsealed beside the Empire's motifs, and
 * two things are certain:
 *
 * - **Every summit clear**, the story's and each Storm Seal tier's, adds **one
 *   collection piece** made for a hero of the party, so a repeated tier always
 *   pays toward somebody's collection on top of its chest, and pays more Ink the
 *   higher it is.
 * - **The Silent Hall's first chest** holds the **Monastery Bellstaff**, the
 *   staff that called the hall to prayer.
 *
 * **Kairen's Fang**, the dragon's own tooth, is not certain: it is his boss-only
 * item, a chance on every kill (`rollBossLoot`).
 *
 * Spirit Ink is the forge's half: paid by the range's fights, shrines, chests and
 * summit, and by salvaging its gear, and spent only on its gear
 * (`forge.inkCost`) — so the forge finishes a collection the party has found a
 * piece of (`ascentStore.patterns`), but cannot craft the catalogue outright.
 *
 * Pure: the caller pays what this returns.
 */

const INK = BALANCE.SPIRIT_INK;

/** The authored weapons, by where they are found. */
export const MONASTERY_BELLSTAFF = 'monastery_bellstaff';
/** The lair whose first chest holds the Bellstaff. */
export const BELLSTAFF_LAIR = 'lair_hall';

/**
 * The Ink a won Jadeveil fight pays: each ordinary enemy a chance of one, each
 * elite one and each boss three; a shrine adds its own, and Kairen his tier's.
 * `rng` is thrown once per ordinary enemy, in order.
 */
export function fightInk(
  templates: Pick<EnemyTemplate, 'tier'>[],
  encounterId: string | null,
  rng: () => number = Math.random,
): number {
  let ink = 0;
  for (const t of templates) {
    if (t.tier === 'boss') ink += INK.BOSS;
    else if (t.tier === 'elite') ink += INK.ELITE;
    else if (rng() < INK.NORMAL_CHANCE) ink += 1;
  }
  if (shrineOfEncounter(encounterId ?? '') !== null) ink += INK.SHRINE;
  const tier = summitTierFromId(encounterId);
  if (tier !== null) ink += INK.SUMMIT_BASE + INK.SUMMIT_PER_TIER * tier;
  return ink;
}

/** The Ink a Jadeveil lair chest holds besides its pieces. */
export function lairChestInk(kit: LairChestKit): number {
  return INK.LAIR_CHEST[kit];
}

/**
 * The piece a summit clear guarantees, beside the boss's drop and the chest: one
 * collection piece for a hero of the party. `options` carries the party, the
 * summit's ground and `world: 'jadeveil'`.
 */
export function summitGuaranteedPieces(options: LootOptions): Item[] {
  const piece = rollCollectionPiece('jadeveil', options);
  return piece ? [piece] : [];
}

/** What a Jadeveil lair's chest guarantees beside its kit: the Bellstaff, in the Silent Hall's first. */
export function lairGuaranteedPieces(lairId: string, kit: LairChestKit, options: LootOptions): Item[] {
  if (lairId !== BELLSTAFF_LAIR || kit !== 'legendary') return [];
  const staff = authoredDrop(MONASTERY_BELLSTAFF, options);
  return staff ? [staff] : [];
}

/**
 * What a lair chest holds: its kit (`rollLairChest`), and in Jadeveil the
 * range's own lean, Ink and the Silent Hall's Bellstaff. `world` is the lair's
 * (`LairSpec.world`); an Empire lair's chest is exactly what it always was.
 */
export function lairChestRewards(
  lairId: string,
  world: WorldId,
  kit: LairChestKit,
  masteries: MasteryId[],
  options: LootOptions,
): { items: Item[]; ink: number } {
  const loot = { ...options, world };
  const items = rollLairChest(kit, masteries, loot);
  if (world !== 'jadeveil') return { items, ink: 0 };
  return { items: [...lairGuaranteedPieces(lairId, kit, loot), ...items], ink: lairChestInk(kit) };
}

/**
 * The Ink salvaging a piece hands back: only the range's own gear (an Empire
 * piece salvages to the Empire's materials alone), by its rarity.
 */
export function salvageInk(item: Pick<Item, 'motif' | 'rarity' | 'world'>): number {
  if (!item.world && !motifWorld(item.motif)) return 0;
  switch (item.rarity) {
    case Rarity.Rare: return INK.SALVAGE.rare;
    case Rarity.Epic: return INK.SALVAGE.epic;
    case Rarity.Legendary:
    case Rarity.Mythic: return INK.SALVAGE.legendary;
    default: return 0;
  }
}
