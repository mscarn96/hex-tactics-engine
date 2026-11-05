/**
 * Parchment and iron: the Voxel UI rebuild's theme, in a light and a dark mode.
 *
 * The design is the private project notes (decided with the designer, 2026-10-18); this is the
 * one place its colours, frame steps and type roles live. It is **two palettes over one shape**:
 * `makeUiTheme(scale, 'light' | 'dark')` returns the same keys either way, so a screen never
 * branches on the mode. If a screen finds it needs to, a token is missing.
 *
 * **It sits beside `uiTheme.ts` rather than replacing it, for now.** The old `UI` (translucent navy
 * glass) is still read by every screen that has not been rebuilt, and 80 files and a dozen suites
 * measure against it. Each screen feature of the epic moves its files from `UI` to this theme, and
 * the epic's last feature deletes `UI` and gives this module the old name (the private project notes,
 * delivery order 7). Pure and free of the UI layer like its sibling, so `voxelTheme.test.ts` measures
 * every palette in the Node suites; fonts are named here and resolved in `components/shared/voxel`.
 *
 * What the rules are, in short:
 * - Content is **parchment** (light) or a **charcoal slab** (dark), framed in **iron** that is the
 *   same in both modes, with a one-step bevel lit from above (`hi` top-left, `lo` bottom-right).
 * - **Red wax is the primary action and nothing else**: one per screen.
 * - **The selected tab is polished iron**, never red and never gold.
 * - Wells (slots, inputs, the portrait stage) are dark iron insets, so type on one is `onIron`.
 * - Rarity inks are a step darker on parchment and the brighter set on the slab.
 */
import { initialViewportWidth, uiScaleFor } from '@/data/display/viewport';
import { INK_CONTRAST_FLOOR, contrastRatio } from '@/data/display/uiTheme';

export type UiMode = 'light' | 'dark';

/** The colours a mode changes. Everything not here is the same in both modes. */
export interface ModePalette {
  /** Content grounds: the panel, a card on it, and a shallow inset in it. Ascending in light. */
  surface: { panel: string; raised: string; sunken: string };
  /** The full-screen scene's backdrop behind panels, where one is wanted. */
  backdrop: string;
  /** Type on a surface. */
  ink: { ink: string; dim: string; faint: string; meta: string };
  /** Meaning colours as bars and numbers on a surface. */
  state: {
    hp: string; mana: string; chi: string; xp: string; warn: string; good: string;
    /** A danger fill (a badge) with `onDanger` type on it. */
    danger: string;
    /** Danger as type on a surface. */
    dangerText: string;
  };
  /** A skill sentence's numbers, as type on a surface. */
  payload: { physical: string; magic: string; heal: string; shield: string };
  /** A path's party role, as the mark beside its name. */
  role: { damage: string; tank: string; support: string };
  /** An item's rarity, as type or a pip on a surface. */
  rarity: { common: string; rare: string; epic: string; legendary: string; mythic: string };
  /** The tiled grain's tone over the surface (alpha applied by the texture). */
  grain: string;
  /** Behind a dialog. */
  scrim: string;
}

/** The iron: identical in both modes ("frames, buttons, tabs and the red action stay the same"). */
const IRON = {
  /** The dark outline of every frame. */
  edge: '#14110f',
  /** The body of a frame and of a plate button. */
  face: '#3b3631',
  /** Lit step, top and left. */
  hi: '#625b50',
  /** Shaded step, bottom and right. */
  lo: '#211d1a',
  /** A pressed plate. */
  pressed: '#2c2824',
  /** A dark well's fill: slots, inputs, the portrait stage. */
  well: '#26221e',
  /** Type on iron or in a well. */
  ink: '#f0e7d3',
  dim: '#c2b79f',
  faint: '#b3a891',
  /** A disabled plate's face. */
  disabled: '#2b2723',
} as const;

/** The selected tab: lighter, polished, with a bright edge. */
const IRON_SELECTED = {
  face: '#c9c3b5',
  hi: '#efe9db',
  lo: '#8f897c',
  edge: '#f6f1e4',
  /** Type on the selected tab. */
  ink: '#1d1915',
} as const;

/** The raised red-wax block of the screen's one main action. */
const WAX = {
  base: '#a3261f',
  hi: '#c63c30',
  lo: '#6a1812',
  pressed: '#8a1f19',
  ink: '#fff1dc',
  /** A disabled primary: wax gone dull. */
  disabled: '#5b3532',
} as const;

/**
 * The pulse round a control a first-use tip names (`AttentionRing`): a bright yellow, the same in
 * both modes and brighter than the selected tab's white edge (playtest 2026-10-29).
 */
const ATTENTION = '#ffd21f';

/** Type on a danger fill. */
const ON_DANGER = '#ffffff';
/** Danger as type on iron: what a danger button's label is set in. */
const DANGER_ON_IRON = '#f48a82';
/** A gain as type on iron or in a well: the bright green, whichever mode the panel around it is in. */
const GOOD_ON_IRON = '#5fe07a';

/**
 * The board's own colours: what a highlighted hex means. The same in both modes (the board is not
 * chrome), and the same values as the old theme's, since the board is out of scope.
 */
const HIGHLIGHT = {
  move: '#4aa3ff',
  attack: '#ff5a4a',
  support: '#4fdc7a',
  warning: '#b050ff',
  active: '#ffffff',
  flank: '#dcf53a',
  reach: '#ffffff',
} as const;

const LIGHT: ModePalette = {
  surface: { panel: '#e7d8ae', raised: '#f1e5c3', sunken: '#dfd0a4' },
  backdrop: '#cdbb8a',
  ink: { ink: '#2a1f14', dim: '#4d3f2d', faint: '#58492f', meta: '#2f4b73' },
  state: {
    hp: '#1f7a35', mana: '#2559b3', chi: '#7a6d00', xp: '#6537b8', warn: '#a8480c', good: '#17702d',
    danger: '#d43a3a', dangerText: '#8f2418',
  },
  payload: { physical: '#8c3a06', magic: '#5f24a6', heal: '#126024', shield: '#214c82' },
  role: { damage: '#9a2616', tank: '#194f96', support: '#126024' },
  rarity: { common: '#554f46', rare: '#184f94', epic: '#62289e', legendary: '#7f4a00', mythic: '#0a615e' },
  grain: '#b79f6a',
  scrim: 'rgba(20,14,8,0.78)',
};

const DARK: ModePalette = {
  surface: { panel: '#2d2823', raised: '#39332d', sunken: '#201c18' },
  backdrop: '#1a1612',
  ink: { ink: '#f2e8cc', dim: '#cbbd9c', faint: '#b3a78b', meta: '#a9bde6' },
  state: {
    hp: '#4cd264', mana: '#4b9bff', chi: '#ecec48', xp: '#b08cff', warn: '#f07c3a', good: '#5fe07a',
    danger: '#d43a3a', dangerText: '#f48a82',
  },
  payload: { physical: '#ff9a4a', magic: '#c88cff', heal: '#5fe07a', shield: '#cfe3ff' },
  role: { damage: '#ff7b63', tank: '#6db4ff', support: '#5fe08a' },
  rarity: { common: '#aaaaaa', rare: '#5aa0e8', epic: '#b88ff2', legendary: '#e0c87f', mythic: '#3cd6cc' },
  grain: '#4a4037',
  scrim: 'rgba(4,3,2,0.84)',
};

const PALETTES: Record<UiMode, ModePalette> = { light: LIGHT, dark: DARK };

/** The palette of a mode, for the suite to walk. */
export const paletteFor = (mode: UiMode): ModePalette => PALETTES[mode];

/** The modes, in the order the lab and the suites show them. */
export const UI_MODES: readonly UiMode[] = ['light', 'dark'];

/** The unchanging colours, by name, for the suite. */
export const IRON_COLORS = IRON;
export const IRON_SELECTED_COLORS = IRON_SELECTED;
export const WAX_COLORS = WAX;
export const BOARD_HIGHLIGHTS = HIGHLIGHT;
export const DANGER_INK_ON_IRON = DANGER_ON_IRON;
export const GOOD_INK_ON_IRON = GOOD_ON_IRON;
export const INK_ON_DANGER = ON_DANGER;

/**
 * Every colour pair the theme asks a reader to read, with the ground it is drawn on, for
 * `voxelTheme.test.ts`: type on parchment or slab, type on iron, on the selected tab, on the red
 * block, and the rarity inks on their own panel.
 */
export interface TextPair { name: string; ink: string; ground: string }

export function textPairs(mode: UiMode): TextPair[] {
  const p = PALETTES[mode];
  const pairs: TextPair[] = [];
  for (const [gname, ground] of Object.entries(p.surface)) {
    for (const [name, ink] of Object.entries(p.ink)) pairs.push({ name: `ink.${name} on ${gname}`, ink, ground });
    pairs.push({ name: `state.dangerText on ${gname}`, ink: p.state.dangerText, ground }); // i18n-exempt: colour-pair label for the contrast suite
    for (const [name, ink] of Object.entries(p.payload)) pairs.push({ name: `payload.${name} on ${gname}`, ink, ground });
    for (const [name, ink] of Object.entries(p.role)) pairs.push({ name: `role.${name} on ${gname}`, ink, ground });
    for (const [name, ink] of Object.entries(p.rarity)) pairs.push({ name: `rarity.${name} on ${gname}`, ink, ground });
  }
  for (const [gname, ground] of [['iron.face', IRON.face], ['iron.well', IRON.well], ['iron.pressed', IRON.pressed]] as const) {
    for (const name of ['ink', 'dim', 'faint'] as const) pairs.push({ name: `iron.${name} on ${gname}`, ink: IRON[name], ground });
    pairs.push({ name: `dangerOnIron on ${gname}`, ink: DANGER_ON_IRON, ground }); // i18n-exempt: colour-pair label for the contrast suite
    pairs.push({ name: `goodOnIron on ${gname}`, ink: GOOD_ON_IRON, ground }); // i18n-exempt: colour-pair label for the contrast suite
  }
  pairs.push({ name: 'iron.faint on iron.disabled', ink: IRON.faint, ground: IRON.disabled }); // i18n-exempt: colour-pair label for the contrast suite
  pairs.push({ name: 'selected.ink on selected.face', ink: IRON_SELECTED.ink, ground: IRON_SELECTED.face }); // i18n-exempt: colour-pair label for the contrast suite
  pairs.push({ name: 'wax.ink on wax.base', ink: WAX.ink, ground: WAX.base }); // i18n-exempt: colour-pair label for the contrast suite
  pairs.push({ name: 'wax.ink on wax.pressed', ink: WAX.ink, ground: WAX.pressed }); // i18n-exempt: colour-pair label for the contrast suite
  pairs.push({ name: 'onDanger on state.danger', ink: ON_DANGER, ground: p.state.danger }); // i18n-exempt: colour-pair label for the contrast suite
  return pairs;
}

/** The interface scale in force, chosen once from the window this session opened at. */
export const VOXEL_SCALE = uiScaleFor(initialViewportWidth());

/**
 * The theme at a scale and in a mode. Colours, weights and families do not scale; measurements do.
 * A factory so the node suites can measure a scaled theme without a window.
 */
export function makeUiTheme(scale: number, mode: UiMode) {
  const s = (n: number) => Math.round(n * scale);
  /** Type is rounded to a half point, as in the old theme. */
  const t = (n: number) => Math.round(n * scale * 2) / 2;
  const p = PALETTES[mode];

  return {
    mode,
    /** The scale in force, for a fixed width a layout states in points (a dialog card). */
    scale,
    color: {
      surface: p.surface,
      backdrop: p.backdrop,
      ink: p.ink,
      state: p.state,
      payload: p.payload,
      role: p.role,
      rarity: p.rarity,
      grain: p.grain,
      scrim: p.scrim,
      iron: IRON,
      selected: IRON_SELECTED,
      wax: WAX,
      attention: ATTENTION,
      onDanger: ON_DANGER,
      dangerOnIron: DANGER_ON_IRON,
      goodOnIron: GOOD_ON_IRON,
      /** The meaning colours as bars and marks on iron or in a well: the bright set, in both modes. */
      stateOnIron: DARK.state,
      /** Rarity as an edge or type on iron or in a well: the bright set, in both modes. */
      rarityOnIron: DARK.rarity,
      highlight: HIGHLIGHT,
    },

    /** The same 4pt scale as the old theme, so converted layouts keep their rhythm. */
    space: { xs: s(4), sm: s(8), md: s(12), lg: s(16), xl: s(24), xxl: s(32) },

    /**
     * **No rounded corners in the chrome.** A frame's corners are cut squares (`frame.step`), so the
     * only radius left is `round`, for things that are genuinely circular: a portrait ring, a pip.
     */
    radius: { none: 0, round: 999 },

    /**
     * How a frame is drawn in React Native (not as 9-slice art): a dark outline, a one-step bevel
     * of two inset borders, and a square cut out of each corner `step` wide. Crisp at any scale and
     * no image assets. Whole pixels at every step, so the cut stays square.
     */
    frame: {
      /** The dark outline's width. */
      edge: s(2),
      /** The bevel's width, per side. */
      bevel: s(2),
      /** The cut at each corner. */
      step: s(4),
      /** A small frame (a chip, a bar's end) uses a smaller cut. */
      stepSm: s(2),
    },

    /** The hairline an inset groove or a rule is drawn with; does not scale. */
    border: { hair: 1 } as const,

    type: {
      display: { family: 'pixel', size: t(34), weight: '400', letterSpacing: t(1), caps: true },
      title: { family: 'pixel', size: t(26), weight: '400', letterSpacing: t(1), caps: true },
      heading: { family: 'pixel', size: t(20), weight: '400', letterSpacing: t(0.6), caps: true },
      /** Section markers stay small Inter capitals: a pixel face is not legible at 10pt. */
      label: { family: 'sans', size: t(10), weight: '600', letterSpacing: t(1.4), caps: true },
      body: { family: 'sans', size: t(12.5), weight: '400', letterSpacing: 0, caps: false },
      bodySm: { family: 'sans', size: t(10.5), weight: '400', letterSpacing: 0, caps: false },
      numeral: { family: 'pixel', size: t(18), weight: '400', letterSpacing: 0, caps: false },
      button: { family: 'pixel', size: t(20), weight: '400', letterSpacing: t(0.8), caps: true },
    },
  } as const;
}

export type VoxelTheme = ReturnType<typeof makeUiTheme>;

/** Both themes at the session's scale, built once. */
export const VOXEL_THEMES: Record<UiMode, VoxelTheme> = {
  light: makeUiTheme(VOXEL_SCALE, 'light'),
  dark: makeUiTheme(VOXEL_SCALE, 'dark'),
};

const byte = (n: number): string => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

/**
 * An identity colour (a status, a path) made legible as type on `ground`, whichever way the ground
 * lies. The old `readableOn` only lifts toward white, which is right on navy and wrong on
 * parchment: here a colour that fails is blended toward black on a light ground and toward white on
 * a dark one, keeping its hue, until it clears the floor. A colour that already reads is returned
 * untouched.
 */
export function inkOn(hex: string, ground: string, floor: number = INK_CONTRAST_FLOOR): string {
  if (contrastRatio(hex, ground) >= floor) return hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lightGround = contrastRatio('#000000', ground) < contrastRatio('#ffffff', ground) ? false : true;
  const to = lightGround ? 0 : 255;
  for (let t = 0.04; t <= 1; t += 0.04) {
    const mixed = `#${byte(r + (to - r) * t)}${byte(g + (to - g) * t)}${byte(b + (to - b) * t)}`;
    if (contrastRatio(mixed, ground) >= floor) return mixed;
  }
  return lightGround ? '#000000' : '#ffffff';
}

/** The spacing scale at the session's scale, for layout constants outside a `themed()` sheet. */
export const SPACE = VOXEL_THEMES.light.space;

/** The meaning colours as marks and bars on iron and over the board: the bright set, in both modes. */
export const STATE_ON_IRON = DARK.state;
/** The party-role colours at their bright set, for identity use (made legible with `inkOn` on a panel). */
export const ROLE_COLORS = DARK.role;
