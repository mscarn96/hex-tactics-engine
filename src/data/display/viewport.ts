/**
 * How big the window is, and what that means for the interface.
 *
 * The game was laid out for a phone held at arm's length and there is no
 * `Dimensions.get` anywhere in `src/` — the whole interface is flex, which is
 * why a desktop browser *stretches* it rather than breaking it. Stretching is
 * its own problem: measured at 1440×900, the menu's primary button spanned the
 * full window, the hero preview was a small model adrift in a very wide box, and
 * the world-map HUD was four clusters pinned to four far corners with nothing
 * between them.
 *
 * So there are two answers, and they are different in kind:
 *
 * - **Scale** — everything is sized for a screen an arm further away. One
 *   number, applied to the theme, which is why it reaches all ~470 themed style
 *   references without a single call site changing.
 * - **Breakpoint** — a name for what a screen may *rearrange* into. A grid
 *   beside a detail pane is not a bigger list; it is a different layout, and no
 *   scale factor produces one.
 *
 * Pure, and free of the UI layer, for `uiTheme`'s reason: the node suite
 * measures all of this, and a module reaching for `Dimensions` could not be
 * measured there at all.
 */

/** What a screen may rearrange into. */
export type Breakpoint = 'compact' | 'wide';

/**
 * Where a phone layout stops being the right shape.
 *
 * 900 rather than a tablet's 768: at 768 the game is a portrait-ish window and
 * the phone arrangement is still the honest one. What changes at 900 is that a
 * list and a detail pane fit side by side with neither cramped, which is the
 * decision every wide layout in the game turns on.
 */
export const WIDE_MIN_WIDTH = 900;

export function breakpointFor(width: number): Breakpoint {
  return width >= WIDE_MIN_WIDTH ? 'wide' : 'compact';
}

/**
 * The interface scale for a viewport width.
 *
 * **Stepped rather than continuous, and that is deliberate.** A continuous
 * factor makes every window width its own design — type lands on fractional
 * pixels, the 4pt spacing scale stops being a 4pt scale, and two screenshots
 * taken at slightly different sizes are never comparable. Three steps are three
 * designs, each of which can be looked at.
 *
 * The steps are sized against viewing distance rather than against pixel count:
 * a phone is held at arm's length, a laptop sits further back, and a large
 * monitor further again. 13pt body becomes 16 and then 19.
 *
 * **1 below `WIDE_MIN_WIDTH` is load-bearing**: it is what makes this change
 * literally nothing on a phone, which is the tuned target. `uiScale.test.ts`
 * pins that.
 */
export const UI_SCALE_STEPS: readonly { minWidth: number; scale: number }[] = [
  { minWidth: 1600, scale: 1.5 },
  { minWidth: WIDE_MIN_WIDTH, scale: 1.25 },
  { minWidth: 0, scale: 1 },
];

export function uiScaleFor(width: number): number {
  for (const step of UI_SCALE_STEPS) if (width >= step.minWidth) return step.scale;
  return 1;
}

/**
 * The window's width at module-load time, or 0 where there is no window.
 *
 * **Read off `globalThis` rather than through `Dimensions`**, which is what lets
 * this module — and `uiTheme`, which imports it — stay free of the UI layer
 * and measurable in the node suite. That is not a trick: web is the only
 * platform this scale exists for, and on web `innerWidth` *is* the answer.
 * Native and node both report nothing and fall through to scale 1, which is
 * exactly the behaviour those platforms want.
 *
 * At module load, because the theme is a frozen object that `StyleSheet.create`
 * reads at import time — a theme that changed later would be a theme half the
 * app had already copied. A player who resizes their browser across a step gets
 * the new scale on reload; what responds live is the *breakpoint*, through
 * `useViewport`, which is the half that matters for layout.
 */
export function initialViewportWidth(): number {
  const g = globalThis as { innerWidth?: unknown };
  return typeof g.innerWidth === 'number' ? g.innerWidth : 0;
}
