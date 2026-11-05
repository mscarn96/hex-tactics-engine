
/**
 * Grammar for names built from parts — an item's motif and form, "Tempered" +
 * "Short Sword". English simply joins them. Polish adjectives agree with the
 * noun's grammatical gender (`Hartowany miecz`, `Hartowana włócznia`,
 * `Hartowane ostrze`, `Hartowane rękawice`), so each Polish noun carries a
 * gender and each Polish name pattern marks the words that must agree.
 *
 * A pattern is catalog text with `{noun}` where the noun goes and `[…]` around
 * each word that agrees with it:
 *
 *  - `[Hartowany] {noun}` — the masculine nominative singular, inflected by the
 *    regular rule in `agree`;
 *  - `[Mały|Mała|Małe|Małe] {noun}` — all four forms written out (m|f|n|pl),
 *    for an adjective the rule gets wrong;
 *  - `{noun} Bastionu` — no agreement at all: a genitive after the noun, the
 *    natural Polish for a name like "Bulwark Cuirass".
 *
 * English patterns are written the same way (`Tempered {noun}`) and contain no
 * brackets. See the private project notes, "Generated names".
 */

/**
 * Polish grammatical gender of a noun as the name agrees with it: masculine,
 * feminine, neuter, or plural-only (`rękawice`, `buty`, `nagolenniki` — the
 * non-masculine-personal plural, which every item plural is).
 */
export type Gender = 'm' | 'f' | 'n' | 'pl';

const FORM_INDEX: Record<Gender, number> = { m: 0, f: 1, n: 2, pl: 3 };

/**
 * A Polish adjective in the gender asked for, from its masculine nominative
 * singular. Hard stems end in `-y` (`stalowy` → `stalowa`, `stalowe`); soft
 * and velar stems end in `-i` (`ostatni` → `ostatnia`, `ostatnie`;
 * `krótki` → `krótka`, `krótkie`). A word ending otherwise does not inflect.
 */
export function agree(masculine: string, gender: Gender): string {
  if (gender === 'm') return masculine;
  const last = masculine.slice(-1);
  const stem = masculine.slice(0, -1);
  if (last === 'y') return stem + (gender === 'f' ? 'a' : 'e');
  if (last === 'i') {
    const velar = /[kg]$/.test(stem);
    if (gender === 'f') return stem + (velar ? 'a' : 'ia');
    return stem + 'ie';
  }
  return masculine;
}

/** Each `[…]` in a pattern, inflected for `gender`. Every word inside agrees. */
function agreeMarked(pattern: string, gender: Gender): string {
  return pattern.replace(/\[([^\]]+)\]/g, (_whole, inner: string) => {
    const forms = inner.split('|');
    if (forms.length === 4) return forms[FORM_INDEX[gender]];
    return inner.split(' ').map((word) => agree(word, gender)).join(' ');
  });
}


/**
 * A name built from a pattern and a noun. In Polish, the words marked `[…]`
 * agree with `gender`, the name is written in sentence case (only its first
 * word capitalised — the noun drops its capital when it is not first), as
 * Polish writes names of things. English keeps the pattern's own capitals.
 */
export function composeName(
  pattern: string,
  noun: string,
  _gender: Gender,
): string {
  return pattern.replace('{noun}', noun);
}
