/**
 * **How bright an effect may get, for how long, and how often** — the comfort limits every combat
 * effect is held to (the private project notes, "Flash safety").
 *
 * The reference trailer stays watchable because its peaks are brief and local; these numbers say
 * what brief and local mean on a landscape phone. `npm run vfx:flash` measures every lab entry
 * against them (`src/utils/flashMeasure.ts` does the counting).
 */
export const FLASH_LIMITS = {
  /** A near-white peak lasts at most this long: a frame or two of white, then colour. */
  peakMaxMs: 120,
  /** "Never full-screen": the most of the screen a peak may cover at once. */
  maxAreaFraction: 0.25,
  /** At most this many separate peaks inside any one second. */
  maxPerSecond: 3,
} as const;

/**
 * What the measurement counts as a peak. A pixel is *bright* when it is near white and became so
 * because of the effect — measured against the frame before the cast, so snow ground or a pale
 * unit is never a flash for being pale. A frame is *flashing* when bright pixels cover at least
 * `minAreaFraction` of the screen: a glowing core or a spark is a highlight, not a flash.
 */
export const FLASH_MEASURE = {
  /** WCAG relative luminance (0–1) a pixel must reach to count as near white. */
  brightLuminance: 0.8,
  /** How much brighter than the pre-cast frame the pixel must have become. */
  minRise: 0.2,
  /** Share of the screen bright pixels must cover before a frame counts as flashing. */
  minAreaFraction: 0.02,
  /** Sampling interval of the measurement, in effect time. */
  sampleMs: 1000 / 60,
} as const;

/**
 * What the reduce-effects setting multiplies by: flash brightness, camera shake and particle
 * counts. Low enough to be plainly calmer, not so low that a hit stops reading as a hit.
 */
export const REDUCED_EFFECTS = {
  flash: 0.45,
  shake: 0.3,
  particles: 0.5,
} as const;
