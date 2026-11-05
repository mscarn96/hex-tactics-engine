import { Item, Rarity } from '@/models/types';

/**
 * The one answer to "is this legendary-grade?".
 *
 * A mythic is a legendary set piece minted with `Rarity.Mythic`: its template,
 * stats, level, affixes, sockets, skill roll, Crystal track, salvage and price
 * are all its legendary's. So every rule a legendary has asks this rather than
 * naming the rarity, and a mythic cannot fall out of one rule by being forgotten
 * in it. The template is always legendary: nothing in the catalogue is mythic, so
 * what filters templates by `Rarity.Legendary` still means the catalogue, and no
 * shop, market, recipe or quest can name one.
 */
export function isLegendaryGrade(rarity: Rarity): boolean {
  return rarity === Rarity.Legendary || rarity === Rarity.Mythic;
}

export function isMythic(item: Partial<Pick<Item, 'rarity'>>): boolean {
  return item.rarity === Rarity.Mythic;
}

/** How many pieces a worn piece counts as toward its set: a mythic's one power. */
export function setPieceWeight(item: Pick<Item, 'rarity'>): number {
  return isMythic(item) ? 2 : 1;
}
