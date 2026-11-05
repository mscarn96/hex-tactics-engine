/**
 * **Counting an effect's flashes from its frames.** Pure, so the VFX lab can run it in the browser
 * on the pixels it renders and Jest can pin the rules on made-up frames.
 *
 * The lab renders one frame before the cast (the baseline) and then one every `sampleMs` of effect
 * time; `frameBrightness` turns each frame into the share of the screen that went near white, and
 * `analyseFlashes` turns that series into peaks and a verdict against `FLASH_LIMITS`.
 */
import { FLASH_LIMITS, FLASH_MEASURE } from '@/data/display/vfxComfort';

type Limits = { peakMaxMs: number; maxAreaFraction: number; maxPerSecond: number };
type Measure = { brightLuminance: number; minRise: number; minAreaFraction: number; sampleMs: number };

const LINEAR = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return t;
})();

/** WCAG relative luminance of an sRGB pixel, 0–1. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * LINEAR[r] + 0.7152 * LINEAR[g] + 0.0722 * LINEAR[b];
}

/** Luminance of every pixel of an RGBA buffer. */
export function luminanceOf(rgba: ArrayLike<number>): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = relativeLuminance(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  }
  return out;
}

export interface FrameBrightness {
  /** Share of the frame's pixels that are near white and were not before the cast. */
  share: number;
  /** Luminance of the brightest pixel the effect lit (risen by `minRise`), near white or not. */
  peakLuminance: number;
}

export function frameBrightness(rgba: ArrayLike<number>, baseline: Float32Array, measure: Measure = FLASH_MEASURE): FrameBrightness {
  let bright = 0;
  let peakLuminance = 0;
  for (let i = 0; i < baseline.length; i++) {
    const l = relativeLuminance(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    if (l - baseline[i] < measure.minRise) continue;
    if (l > peakLuminance) peakLuminance = l;
    if (l >= measure.brightLuminance) bright++;
  }
  return { share: baseline.length ? bright / baseline.length : 0, peakLuminance };
}

export interface Flash {
  /** Effect time of the first flashing frame, ms after the cast. */
  startMs: number;
  durationMs: number;
  /** The largest share of the screen it covered. */
  peakArea: number;
}

export interface FlashReport {
  flashes: Flash[];
  /** The longest peak, ms; 0 when there is none. */
  longestMs: number;
  /** The largest share of the screen any frame went bright over, flash or not. */
  maxArea: number;
  /** Most peaks starting inside any one second. */
  maxPerSecond: number;
  /** Each limit broken, in words; empty when the effect passes. */
  failures: string[];
}

/**
 * Peaks in a series of bright shares sampled every `measure.sampleMs`. A peak is a run of frames
 * at or above `minAreaFraction`; each frame stands for one sample interval, so a single flashing
 * frame lasts `sampleMs`.
 */
export function analyseFlashes(
  shares: readonly number[],
  limits: Limits = FLASH_LIMITS,
  measure: Measure = FLASH_MEASURE,
): FlashReport {
  const dt = measure.sampleMs;
  const flashes: Flash[] = [];
  let open: Flash | undefined;
  shares.forEach((share, i) => {
    if (share >= measure.minAreaFraction) {
      if (!open) {
        open = { startMs: i * dt, durationMs: 0, peakArea: 0 };
        flashes.push(open);
      }
      open.durationMs += dt;
      open.peakArea = Math.max(open.peakArea, share);
    } else {
      open = undefined;
    }
  });

  let maxPerSecond = 0;
  flashes.forEach((f, i) => {
    let n = 0;
    for (let j = i; j < flashes.length && flashes[j].startMs - f.startMs < 1000; j++) n++;
    maxPerSecond = Math.max(maxPerSecond, n);
  });

  const longestMs = flashes.reduce((m, f) => Math.max(m, f.durationMs), 0);
  const maxArea = shares.reduce((m, s) => Math.max(m, s), 0);
  const failures: string[] = [];
  // Half a sample of slack: a 120 ms limit sampled at 60 fps is seven frames, not 7.2
  if (longestMs > limits.peakMaxMs + dt / 2) failures.push(`peak ${Math.round(longestMs)}ms > ${limits.peakMaxMs}ms`);
  if (maxArea > limits.maxAreaFraction) failures.push(`area ${pct(maxArea)} > ${pct(limits.maxAreaFraction)}`);
  if (maxPerSecond > limits.maxPerSecond) failures.push(`${maxPerSecond} peaks/s > ${limits.maxPerSecond}`);
  return { flashes, longestMs, maxArea, maxPerSecond, failures };
}

const pct = (f: number): string => `${(f * 100).toFixed(1)}%`;
