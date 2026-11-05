import {
  UI_SCALE_STEPS, WIDE_MIN_WIDTH, breakpointFor, initialViewportWidth, uiScaleFor,
} from '@/data/display/viewport';
import { UI_SCALE, px } from '@/data/display/uiTheme';
import { VOXEL_THEMES, makeUiTheme } from '@/data/display/voxelTheme';

const UI = VOXEL_THEMES.light;

/**
 * The interface scales for a desktop window, and does not move on a phone.
 *
 * The game is laid out entirely in flex with no window measurement anywhere, so
 * a browser stretches it instead of breaking it — measured at 1440×900, the
 * menu's primary button spanned the whole window and the world-map HUD was four
 * clusters pinned to four corners. Scale is one of the two answers; the other is
 * the breakpoint, which is what lets a screen take a different *shape*.
 */

describe('the scale steps', () => {
  it('is 1 on anything phone-sized', () => {
    for (const w of [0, 320, 390, 414, 600, 768, 899]) {
      expect(uiScaleFor(w)).toBe(1);
    }
  });

  it('steps up for a laptop and again for a large monitor', () => {
    expect(uiScaleFor(900)).toBe(1.25);
    expect(uiScaleFor(1440)).toBe(1.25);
    expect(uiScaleFor(1600)).toBe(1.5);
    expect(uiScaleFor(2560)).toBe(1.5);
  });

  /** Never smaller as the window grows — a table in the wrong order would do that. */
  it('never shrinks as the window grows', () => {
    let last = 0;
    for (let w = 0; w <= 3000; w += 10) {
      const s = uiScaleFor(w);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });

  it('is stepped rather than continuous, so each step is a design', () => {
    const distinct = new Set(UI_SCALE_STEPS.map((s) => s.scale));
    expect(distinct.size).toBe(UI_SCALE_STEPS.length);
    expect(UI_SCALE_STEPS.length).toBeLessThanOrEqual(4);
  });
});

describe('the breakpoint', () => {
  it('turns wide exactly where the scale first steps up', () => {
    expect(breakpointFor(WIDE_MIN_WIDTH - 1)).toBe('compact');
    expect(breakpointFor(WIDE_MIN_WIDTH)).toBe('wide');
    // The two are not required to agree forever, but they do today and a silent
    // drift between "bigger type" and "different layout" would be confusing to
    // debug from a screenshot.
    expect(uiScaleFor(WIDE_MIN_WIDTH - 1)).toBe(1);
    expect(uiScaleFor(WIDE_MIN_WIDTH)).toBeGreaterThan(1);
  });
});

describe('the phone build', () => {
  /**
   * **The load-bearing assertion in this file.** The phone is the tuned target
   * and every number in the theme was measured there; this whole mechanism is
   * only allowed to exist because it is provably inert below `WIDE_MIN_WIDTH`.
   *
   * It runs in node, where there is no window — the same fall-through a phone
   * takes, since `initialViewportWidth` reads `globalThis.innerWidth` and native
   * has none.
   */
  it('is what the suite and every device actually get', () => {
    expect(initialViewportWidth()).toBe(0);
    expect(UI_SCALE).toBe(1);
  });

  it('leaves every measurement exactly where it was', () => {
    expect(UI.space).toEqual({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 });
    expect(UI.radius).toEqual({ none: 0, round: 999 });
    expect(UI.frame).toEqual({ edge: 2, bevel: 2, step: 4, stepSm: 2 });
    expect(UI.type.body.size).toBe(12.5);
    expect(UI.type.display.size).toBe(34);
    expect(px(30)).toBe(30);
  });

  /** A scale of 1 must be the identity, not merely close to it. */
  it('is the identity, not an approximation of one', () => {
    expect(makeUiTheme(1, 'light')).toEqual(UI);
  });
});

describe('a scaled theme', () => {
  const big = makeUiTheme(1.5, 'light');

  it('grows type and spacing together', () => {
    // 12.5 × 1.5 is 18.75, and type rounds to the half point.
    expect(big.type.body.size).toBe(19);
    expect(big.type.display.size).toBe(51);
    expect(big.space.md).toBe(18);
    expect(big.space.xxl).toBe(48);
  });

  /**
   * **Borders do not scale, and this is the exception worth a test.** A hairline
   * is the thinnest mark a display can draw; scaling it turns every quiet edge
   * in the game into a drawn frame, which is the loudest way this direction
   * could stop looking like itself.
   */
  it('leaves hairlines alone', () => {
    expect(big.border).toEqual(UI.border);
  });

  /** A frame's cut stays square only if its steps are whole pixels at every scale. */
  it('keeps the frame on whole pixels', () => {
    for (const v of Object.values(big.frame)) expect(Number.isInteger(v)).toBe(true);
  });

  /** `round` is "make this a circle", not a measurement. */
  it('leaves the circular radius alone', () => {
    expect(big.radius.round).toBe(UI.radius.round);
  });

  it('changes no colour, family or weight', () => {
    expect(big.color).toEqual(UI.color);
    for (const role of Object.keys(UI.type) as (keyof typeof UI.type)[]) {
      expect(big.type[role].family).toBe(UI.type[role].family);
      expect(big.type[role].weight).toBe(UI.type[role].weight);
    }
  });

  /**
   * The 4pt spacing scale stays a scale of whole numbers. Fractional padding is
   * what a continuous factor produces, and it is why the steps are stepped.
   */
  it('keeps spacing on whole pixels at every step', () => {
    for (const { scale } of UI_SCALE_STEPS) {
      const theme = makeUiTheme(scale, 'light');
      for (const v of Object.values(theme.space)) expect(Number.isInteger(v)).toBe(true);
      for (const v of Object.values(theme.radius)) expect(Number.isInteger(v)).toBe(true);
    }
  });

  /** Ordering has to survive scaling, or the type hierarchy inverts somewhere. */
  it('keeps the type hierarchy in the same order', () => {
    const order = (t: typeof UI) =>
      (Object.keys(t.type) as (keyof typeof UI.type)[])
        .sort((a, b) => t.type[a].size - t.type[b].size || a.localeCompare(b))
        .join(',');
    for (const { scale } of UI_SCALE_STEPS) {
      expect(order(makeUiTheme(scale, 'light'))).toBe(order(UI));
    }
  });
});
