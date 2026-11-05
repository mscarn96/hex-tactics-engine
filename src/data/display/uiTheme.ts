/**
 * Interface scale and colour-legibility helpers.
 *
 * The palettes, the frame steps and the type roles live in `voxelTheme.ts` (the Voxel UI:
 * parchment and iron, light and dark — the private project notes). What is left here is what
 * is not a palette: the scale in force and the arithmetic that makes an identity colour readable.
 *
 * Pure, and free of the UI layer, so the node suites can measure it.
 */
import { initialViewportWidth, uiScaleFor } from '@/data/display/viewport';

/**
 * The interface scale in force, chosen once from the window this session opened
 * at. 1 on every phone — see `viewport.ts`.
 */
export const UI_SCALE = uiScaleFor(initialViewportWidth());

/** A raw pixel measurement, scaled. Whole numbers, so nothing lands on a half. */
export const px = (n: number) => Math.round(n * UI_SCALE);

/** The dark slab's panel, the ground `readableOn` lifts a colour to read on by default. */
const DARK_PANEL = '#26221e';

// ─── Making an identity colour legible ────────────────────────────────────────

/**
 * The contrast a colour must reach before it may be used as type or as a border.
 *
 * The same 4.5 `TEXT_ON` is measured against, named once so a caller lifting a
 * colour to clear the bar and a test checking it cleared cannot disagree about
 * where the bar is.
 */
export const INK_CONTRAST_FLOOR = 4.5;

const channels = (hex: string): number[] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

const linearise = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/** WCAG relative luminance. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linearise);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, larger first. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const byte = (n: number): string =>
  Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

/** Blends toward white by `t`, in sRGB. */
function toneUp(hex: string, t: number): string {
  const [r, g, b] = channels(hex).map((c) => c * 255);
  return `#${byte(r + (255 - r) * t)}${byte(g + (255 - g) * t)}${byte(b + (255 - b) * t)}`;
}

/**
 * The same colour, lifted until it can be read on `ground`.
 *
 * **An identity colour and an ink are two different jobs**, and conflating them
 * is what this exists to stop. A path's colour is what the thing *is* — it
 * belongs to the art, the model tint, a large fill — and it is chosen for
 * character. Type and hairline borders have a second requirement the identity
 * knows nothing about: on a dark panel a genuinely dark colour measures about 2:1
 * and is an undrawn panel, which is the rule this palette states about its
 * hairlines and the voxel roster learned the hard way as "a surface within
 * about 10% of the one behind it is not subtle, it is absent".
 *
 * Derived rather than authored as a second table, for the reason
 * `terrainMaterial` divides out its grain mean instead of shipping a second set
 * of hex values: one authored colour and one derivation cannot drift, where two
 * tables always eventually do.
 *
 * Toward white rather than toward the ground's complement, because white is the
 * only direction that is correct for *every* hue — and it preserves the hue,
 * which is the half of the identity that has to survive. A colour that already
 * clears the floor is returned untouched, so this is a no-op for the majority.
 *
 * **It compresses the dark end**, and anything measuring separation has to
 * measure the *lifted* colours rather than the authored ones: two dark colours
 * of different hues both get pulled a long way up and land closer together than
 * they started.
 */
export function readableOn(hex: string, ground: string = DARK_PANEL): string {
  if (contrastRatio(hex, ground) >= INK_CONTRAST_FLOOR) return hex;
  for (let t = 0.02; t <= 1; t += 0.02) {
    const lifted = toneUp(hex, t);
    if (contrastRatio(lifted, ground) >= INK_CONTRAST_FLOOR) return lifted;
  }
  return '#ffffff';
}
