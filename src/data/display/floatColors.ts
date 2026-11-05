import type { DamageType } from '@/models/skills';

/**
 * The colour a floating combat number is drawn in, by what it is.
 *
 * Chosen by the 2026-10-13 playtest: a number says what kind of harm or help it
 * was, and a critical hit says so with its size and the word CRITICAL rather
 * than a colour of its own — so a crit keeps its type's colour. Every float is
 * drawn with an outline (`floatOutline`), which is what lets dark grey read on
 * the arena's dark ground at all.
 *
 * The rest of the floats keep their own colours on purpose, each the colour of
 * its source: burn orange, Doom crimson, shock pale blue, thorns, hazards,
 * aftershocks, Death Mark violet and the bosses' set pieces.
 */
export const FLOAT_COLOR = {
  physical: '#505050',
  magic: '#3d7bff',
  bleed: '#e02424',
  poison: '#a6f075',
  heal: '#1f8a32',
  barrier: '#ffffff',
} as const;

/** A direct hit's number, coloured by the defence that answered it. */
export const hitFloatColor = (type: DamageType): string => FLOAT_COLOR[type];

/**
 * The outline drawn round a float: light round a dark number, dark round
 * everything else. Read from the fill's brightest channel rather than a table,
 * so a colour added later gets the right one — and so a saturated red, dim by
 * luminance, still gets the dark edge it reads best against.
 */
export function floatOutline(fill: string): string {
  const hex = fill.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#141414';
  const brightest = Math.max(...[0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
  return brightest < 0.45 ? '#e6e6e6' : '#141414';
}
