import type { EquipSlot, Hero, Item } from '@/models/types';
import { setFormsOf } from '@/data/items/itemForms';
import { isLegendaryGrade, setPieceWeight } from '@/data/items/rarity';
import { isMasteryMotif } from '@/data/items/motifs';
import { canEquip } from '@/systems/progression/equipRules';

/** The legal set pieces worn, one per template, as motif -> template -> how many it counts as. */
function wornSetPieces(hero: Hero, items: readonly Item[]): Map<string, Map<string, number>> {
  const byMotif = new Map<string, Map<string, number>>();
  if (!hero.masteryPath) return byMotif;
  const seen = new Set<string>();
  for (const [slot, id] of Object.entries(hero.equipment)) {
    if (!id || seen.has(id) || slot.startsWith('ring')) continue;
    const item = items.find(i => i.id === id);
    if (!item || !isLegendaryGrade(item.rarity) || !isMasteryMotif(item.motif)
      || !item.masteryLock?.includes(hero.masteryPath)
      || !setFormsOf(hero.masteryPath).includes(item.form)) continue;
    if (!canEquip(hero, item, slot as EquipSlot, {}).ok) continue;
    seen.add(id);
    const pieces = byMotif.get(item.motif) ?? new Map<string, number>();
    pieces.set(item.templateId, Math.max(pieces.get(item.templateId) ?? 0, setPieceWeight(item)));
    byMotif.set(item.motif, pieces);
  }
  return byMotif;
}

/**
 * How far a hero stands toward their set's 3- and 5-piece bonuses: distinct legal
 * pieces, excluding duplicate references and recipes, with a worn mythic counting
 * as two. A template counts once however many copies are worn.
 */
export function matchingSetPieces(hero: Hero, items: readonly Item[]): number {
  const totals = [...wornSetPieces(hero, items).values()]
    .map((pieces) => [...pieces.values()].reduce((sum, weight) => sum + weight, 0));
  return Math.max(0, ...totals);
}

/**
 * How many distinct set pieces a hero really wears. The equipment achievements
 * read this: "dressed for legend" asks for seven pieces on the body, and the
 * mythic's double count is a power toward the bonuses, not a seventh piece.
 */
export function distinctSetPieces(hero: Hero, items: readonly Item[]): number {
  return Math.max(0, ...[...wornSetPieces(hero, items).values()].map((pieces) => pieces.size));
}
