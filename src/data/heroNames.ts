import type { HeroTemplateId } from '@/models/ids';

/**
 * Heroes are people with names (playtest 2026-10-14): a hero's identity is its
 * name and its class, and once a path is chosen its name and its path. These are
 * the names offered when one is chosen at the start or recruited at the tavern —
 * a random proposal the player can reroll or type over.
 *
 * Sixteen a class, every one at most `HERO_NAME_MAX_LENGTH` letters so the
 * active-unit card can set it beside the class on one line at a readable size.
 */
export const HERO_NAMES: Record<HeroTemplateId, readonly string[]> = {
  warrior: [
    'Aldric', 'Brenna', 'Corvin', 'Dagny', 'Edric', 'Freya', 'Gareth', 'Hilda',
    'Ivor', 'Kael', 'Maren', 'Osric', 'Rowena', 'Sigrun', 'Torvald', 'Wulfric',
  ],
  mage: [
    'Alaric', 'Belisane', 'Cassius', 'Delphine', 'Elowen', 'Fenwick', 'Isolde', 'Lysander',
    'Merrin', 'Nerys', 'Orrin', 'Seraphine', 'Thaddeus', 'Vesna', 'Zephyr', 'Ysolde',
  ],
  healer: [
    'Ailith', 'Bramble', 'Cerys', 'Darrow', 'Eira', 'Fern', 'Gwyn', 'Hazel',
    'Linnea', 'Moss', 'Oriel', 'Rowan', 'Sorrel', 'Thorne', 'Willow', 'Yarrow',
  ],
  ranger: [
    'Arden', 'Bryn', 'Corra', 'Dusk', 'Finn', 'Garrick', 'Hawke', 'Jessa',
    'Kestrel', 'Lark', 'Mira', 'Quinn', 'Reyna', 'Sable', 'Tamsin', 'Wren',
  ],
  monk: [
    'Akio', 'Bai', 'Daiyu', 'Hoshi', 'Jin', 'Kaito', 'Lian', 'Mei',
    'Ren', 'Shan', 'Suki', 'Tao', 'Yara', 'Yun', 'Zhen', 'Kenji',
  ],
};

/** The longest name the field takes. */
export const HERO_NAME_MAX_LENGTH = 12;

/**
 * A name from the class's list, never one already in the party and never the
 * one being rerolled away from. Falls back to the whole list when the party has
 * somehow taken every name.
 */
export function randomHeroName(
  templateId: HeroTemplateId,
  taken: readonly string[] = [],
  avoid?: string,
  rng: () => number = Math.random,
): string {
  const list = HERO_NAMES[templateId];
  const used = new Set(taken.map((n) => n.toLowerCase()));
  const free = list.filter((n) => !used.has(n.toLowerCase()) && n !== avoid);
  const pool = free.length > 0 ? free : list.filter((n) => n !== avoid);
  return pool[Math.floor(rng() * pool.length) % pool.length] ?? list[0];
}

/**
 * What a typed name is stored as: trimmed, inner whitespace collapsed, cut to
 * `HERO_NAME_MAX_LENGTH`. An empty result means "no name given", which the
 * caller answers with the proposal it was showing.
 */
export function cleanHeroName(typed: string): string {
  return typed.replace(/\s+/g, ' ').trim().slice(0, HERO_NAME_MAX_LENGTH).trim();
}
