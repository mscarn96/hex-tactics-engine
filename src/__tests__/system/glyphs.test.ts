import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, SRC_DIR } from '../support/paths';

/**
 * No emoji in the interface.
 *
 * They were the last thing in the chrome that renders differently on every
 * platform the game runs on — 🪖 is a helmet on one and a peaked cap on another,
 * 🗝 has a colour presentation on some and a mono one on others — and beside
 * voxel art and engraved gold they read as a chat app. `UI_ICONS` and
 * `scripts/icons/uiGlyphs.mjs` replaced them with generated marks.
 *
 * **This is the test that keeps them gone.** The migration itself is easy to
 * repeat; what is hard is noticing a year later that someone typed a 📦 into a
 * new dialog because it was quicker than adding a row. `tsc` cannot see it and
 * neither can any runtime assertion.
 *
 * **What is allowed is a rule, not a list of exceptions.** An image cannot sit
 * inside a `<Text>` run and cannot inherit colour, so geometric marks that are
 * set inline with words, or tinted by state, stay text — and they are safe to
 * leave as text precisely because they are *not* emoji: they have a single
 * mono presentation everywhere and scale with the font.
 */

const ALLOWED = new Set([
  // Chrome that is geometry rather than iconography. All single-codepoint,
  // text-presentation by default, and all currently tinted by `UI.color`.
  '✕', '‹', '›', '▸', '▾', '▶', '◀', '→', '↑', '↓', '↳', '⇄', '⊙', '●', '○', '◧',
  '◆', '▲', '▼', '★', '☆', '✓', '✔', '☰', '♥', '✚', '✦', '◎', '⚔', '❖', '⊕', '⊖',
]);

/** Codepoints that are pictographic by Unicode's own classification. */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F900}-\u{1F9FF}]/u;

/**
 * Files that may still hold one, each for a stated reason. A path rather than a
 * glyph, so an exemption cannot quietly widen to cover a new emoji in the same
 * file.
 */
const EXEMPT = new Set([
  // The app-side fallback table — these ARE the emoji being replaced, kept so a
  // screen renders something before its icon is approved.
  path.join('constants', 'uiIcons.ts'),
  // A stand-in behind `MASTERY_ART`, which is complete for all fifteen paths, so
  // it is already unreachable. `masteryData.test.ts` pins that it exists.
  path.join('constants', 'masteryArt.ts'),
  // This file names them in order to ban them.
  path.join('__tests__', 'system', 'glyphs.test.ts'),
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Strip comments — prose about an emoji is not an emoji in the interface. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('interface glyphs', () => {
  it('no emoji outside the fallback table', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC_DIR)) {
      const rel = path.relative(SRC_DIR, file);
      if ([...EXEMPT].some((e) => rel.endsWith(e))) continue;

      const src = stripComments(readFileSync(file, 'utf8'));
      src.split('\n').forEach((line, i) => {
        for (const ch of [...line]) {
          if (!EMOJI.test(ch) || ALLOWED.has(ch)) continue;
          offenders.push(`${path.relative(REPO_ROOT, file)}:${i + 1} — ${ch}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});

describe('the combat pixel face', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { glyphFor } = require('@/data/display/combatGlyphs') as typeof import('@/data/display/combatGlyphs');

  it('draws every Polish capital as a letter, never the unknown mark', () => {
    for (const char of 'ĄĆĘŁŃÓŚŹŻ') expect(glyphFor(char)).not.toBe(glyphFor('?'));
    expect(glyphFor('Ł')).not.toBe(glyphFor('L'));
    // Accents are drawn (PT-24), so a marked letter is its own glyph, not its base letter
    for (const [marked, base] of [['Ż', 'Z'], ['Ź', 'Z'], ['Ó', 'O'], ['Ą', 'A']]) expect(glyphFor(marked)).not.toBe(glyphFor(base));
  });
});
