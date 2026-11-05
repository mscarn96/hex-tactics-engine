import { COMBAT_GLYPH_CHARS, combatTextBitmap, outlinedTextBitmap } from '@/data/display/combatGlyphs';
import { LOCALES, translate } from '@/i18n';

/**
 * The combat pixel face (`combatGlyphs.ts`): every letter a language writes is drawn, not "?"
 * (PT-24, playtest 2026-10-20), and marks grow the bitmap rather than squashing the body.
 */

const lit = (bitmap: { width: number; height: number; pixels: Uint8Array }) => {
  const rows: string[] = [];
  for (let y = bitmap.height - 1; y >= 0; y--) {
    let row = '';
    for (let x = 0; x < bitmap.width; x++) row += bitmap.pixels[(y * bitmap.width + x) * 4 + 3] ? '1' : '0';
    rows.push(row);
  }
  return rows;
};

describe('the combat pixel face', () => {
  it('draws every Polish letter, in either case', () => {
    for (const ch of 'aąbcćdeęfghijklłmnńoóprsśtuwyzźż') {
      expect(COMBAT_GLYPH_CHARS).toContain(ch.toUpperCase());
    }
  });

  it('draws the crit label in every language with no unknown glyph', () => {
    for (const locale of Object.keys(LOCALES) as (keyof typeof LOCALES)[]) {
      for (const ch of translate(locale, 'combatLog.float.critical').toUpperCase()) {
        expect(COMBAT_GLYPH_CHARS).toContain(ch);
      }
    }
  });

  it('keeps a text without marks five rows, its pixels unchanged', () => {
    expect(combatTextBitmap('-12').height).toBe(5);
    expect(lit(combatTextBitmap('L'))).toEqual(['100', '100', '100', '100', '111']);
  });

  it('grows rows for a mark, every body on the same rows', () => {
    // An acute and its clear row above, the body below them
    expect(lit(combatTextBitmap('Ó'))).toEqual(['001', '000', '111', '101', '101', '101', '111']);
    // An ogonek hangs off the foot
    expect(lit(combatTextBitmap('ę'))).toEqual(['111', '100', '110', '100', '111', '011']);
    // Mixed: a plain letter beside a marked one sits on the same body rows
    const word = lit(combatTextBitmap('LŻ'));
    expect(word).toHaveLength(7);
    expect(word[0]).toBe('0000010');
    expect(word[6]).toBe('1110111');
  });

  it('tells Ł from L', () => {
    expect(lit(combatTextBitmap('Ł'))).not.toEqual(lit(combatTextBitmap('L')));
  });

  it('outlines a marked word round its marks too', () => {
    const bitmap = outlinedTextBitmap('Ś', '#ffffff', '#000000');
    expect([bitmap.width, bitmap.height]).toEqual([5, 9]);
  });
});
