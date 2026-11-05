/** The same 3×5 pixel face for overhead HP and floating combat feedback. */
const GLYPHS: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111',
  '3': '111001111001111', '4': '101101111001001', '5': '111100111001111',
  '6': '111100111101111', '7': '111001001001001', '8': '111101111101111',
  '9': '111101111001111', '+': '000010111010000', '-': '000000111000000',
  A: '010101111101101', B: '110101110101110', C: '111100100100111',
  D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '111100101101111', H: '101101111101101', I: '111010010010111',
  J: '001001001101111', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '101111111111101', O: '111101101101111',
  P: '111101111100100', Q: '111101101111001', R: '110101110101101',
  S: '111100111001111', T: '111010010010010', U: '101101101101111',
  V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', ' ': '000000000000000',
  '.': '000000000000010', ',': '000000000010100', ':': '000010000010000',
  '/': '001001010100100', '%': '101001010100101', '!': '010010010000010',
  '?': '111001010000010', "'": '010010000000000',
  '×': '000101010101000', '(': '001010010010001', ')': '100010010010100',
};

/**
 * Letters with a mark over or under the 3×5 body (PT-24, playtest 2026-10-20: Polish floats
 * drew "?" for each of them). A mark above stands a blank row clear of the letter, so an acute
 * over O reads as an accent rather than a taller stem; an ogonek hangs straight off the foot, as
 * it is written. Ł carries its stroke inside the body.
 */
const ACUTE = ['001', '000'];
const DOT = ['010', '000'];
const OGONEK = ['011'];
const MARKED: Record<string, { body: string; above?: readonly string[]; below?: readonly string[] }> = {
  Ą: { body: GLYPHS.A, below: OGONEK },
  Ć: { body: GLYPHS.C, above: ACUTE },
  Ę: { body: GLYPHS.E, below: OGONEK },
  Ł: { body: '100110100100111' },
  Ń: { body: GLYPHS.N, above: ACUTE },
  Ó: { body: GLYPHS.O, above: ACUTE },
  Ś: { body: GLYPHS.S, above: ACUTE },
  Ź: { body: GLYPHS.Z, above: ACUTE },
  Ż: { body: GLYPHS.Z, above: DOT },
};
/** Stand-ins the face draws as another glyph: an en dash is a minus at this size. */
const ALIAS: Record<string, string> = { '–': '-', '—': '-', '‑': '-' };

/** Every character the face draws, the marked letters included — for the suites. */
export const COMBAT_GLYPH_CHARS: readonly string[] = [...Object.keys(GLYPHS), ...Object.keys(MARKED), ...Object.keys(ALIAS)];

const BODY = 5;
const glyphOf = (char: string) => {
  const own = ALIAS[char] ?? char;
  return MARKED[own] ?? { body: GLYPHS[own] ?? GLYPHS['?'] };
};

/** The pixels a character is drawn with, as one comparable key; unknown characters share `?`'s. */
export function glyphFor(char: string): string {
  const g = glyphOf(char);
  return [...(g.above ?? []), g.body, ...(g.below ?? [])].join('|');
}

/**
 * Native GL-ready RGBA pixels; empty pixels stay transparent.
 *
 * Five rows tall, the body of every glyph, plus the rows a marked letter in `text` needs above or
 * below it: a text without one keeps exactly its old bitmap, and one with an accent grows, every
 * glyph's body on the same rows. `PixelText` sizes its plane by rows over five, so the body stays
 * the height it is asked for.
 */
export function combatTextBitmap(text: string): { width: number; height: number; pixels: Uint8Array<ArrayBuffer> } {
  const glyphs = Array.from(text.toUpperCase()).map(glyphOf);
  const top = Math.max(0, ...glyphs.map((g) => g.above?.length ?? 0));
  const bottom = Math.max(0, ...glyphs.map((g) => g.below?.length ?? 0));
  const height = top + BODY + bottom;
  const width = Math.max(1, glyphs.length * 4 - 1);
  const pixels = new Uint8Array(width * height * 4);
  // Rows counted from the top; GL's rows run from the bottom
  const light = (row: number, x: number) => pixels.set([255, 255, 255, 255], ((height - 1 - row) * width + x) * 4);
  glyphs.forEach((glyph, index) => {
    const left = index * 4;
    const rows = [...(glyph.above ?? []), ...Array.from({ length: BODY }, (_, y) => glyph.body.slice(y * 3, y * 3 + 3)), ...(glyph.below ?? [])];
    const first = top - (glyph.above?.length ?? 0);
    rows.forEach((row, r) => {
      for (let x = 0; x < 3; x++) if (row[x] === '1') light(first + r, left + x);
    });
  });
  return { width, height, pixels };
}

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};

/**
 * The same face with its colours baked in and a one-pixel outline round every
 * glyph, so the text reads on any ground — a floating number over dark grass,
 * pale sand or a unit's own body. Padded by a pixel on each side; the outline
 * covers all eight neighbours of a lit pixel, so diagonals close too.
 */
export function outlinedTextBitmap(
  text: string,
  fill: string,
  outline: string,
): { width: number; height: number; pixels: Uint8Array<ArrayBuffer> } {
  const inner = combatTextBitmap(text);
  const width = inner.width + 2;
  const height = inner.height + 2;
  const lit = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < inner.width && y < inner.height && inner.pixels[(y * inner.width + x) * 4 + 3] > 0;
  const pixels = new Uint8Array(width * height * 4);
  const [fr, fg, fb] = rgb(fill);
  const [or, og, ob] = rgb(outline);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const ix = x - 1;
    const iy = y - 1;
    const at = (y * width + x) * 4;
    if (lit(ix, iy)) {
      pixels.set([fr, fg, fb, 255], at);
      continue;
    }
    let edge = false;
    for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (lit(ix + dx, iy + dy)) { edge = true; break; }
    }
    if (edge) pixels.set([or, og, ob, 255], at);
  }
  return { width, height, pixels };
}
