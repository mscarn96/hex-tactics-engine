import { FLASH_LIMITS, FLASH_MEASURE } from '@/data/display/vfxComfort';
import { analyseFlashes, frameBrightness, luminanceOf, relativeLuminance } from '@/utils/flashMeasure';

const dt = FLASH_MEASURE.sampleMs;
const frames = (ms: number) => Math.round(ms / dt);
/** A series of `total` ms with full-area peaks of `peakMs` starting at each of `starts`. */
function series(totalMs: number, starts: number[], peakMs: number, area = 0.1): number[] {
  const s = new Array(frames(totalMs)).fill(0);
  for (const at of starts) for (let i = 0; i < frames(peakMs); i++) s[frames(at) + i] = area;
  return s;
}

describe('flash limits', () => {
  it('are the agreed comfort rules: brief, local and rare', () => {
    expect(FLASH_LIMITS.peakMaxMs).toBeLessThanOrEqual(120);
    expect(FLASH_LIMITS.maxAreaFraction).toBeLessThan(1);
    expect(FLASH_LIMITS.maxPerSecond).toBeLessThanOrEqual(3);
  });
});

describe('frameBrightness', () => {
  it('counts only pixels the effect turned near white, so pale ground is never a flash', () => {
    const rgba = (vals: number[]) => Uint8Array.from(vals.flatMap((v) => [v, v, v, 255]));
    const baseline = luminanceOf(rgba([30, 240, 30, 30]));
    // pixel 0 went white, pixel 1 was already white, pixel 2 brightened to mid grey
    const f = frameBrightness(rgba([255, 255, 128, 30]), baseline);
    expect(f.share).toBeCloseTo(0.25);
    expect(f.peakLuminance).toBeCloseTo(1);
  });

  it('reports the brightest lit pixel even when nothing reaches near white', () => {
    const rgba = (vals: number[]) => Uint8Array.from(vals.flatMap((v) => [v, v, v, 255]));
    const f = frameBrightness(rgba([200, 30]), luminanceOf(rgba([30, 30])));
    expect(f.share).toBe(0);
    expect(f.peakLuminance).toBeCloseTo(relativeLuminance(200, 200, 200));
  });

  it('uses WCAG relative luminance', () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1);
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(relativeLuminance(0, 255, 0)).toBeGreaterThan(relativeLuminance(255, 0, 0));
  });
});

describe('analyseFlashes', () => {
  it('passes a single brief local peak', () => {
    const r = analyseFlashes(series(1000, [200], 100));
    expect(r.flashes).toHaveLength(1);
    expect(r.failures).toEqual([]);
  });

  it('fails a peak that outlasts the limit', () => {
    const r = analyseFlashes(series(1000, [200], FLASH_LIMITS.peakMaxMs + 3 * dt));
    expect(r.failures.some((f) => f.startsWith('peak'))).toBe(true);
  });

  it('fails a frame that covers too much of the screen, even below the peak length', () => {
    const r = analyseFlashes(series(1000, [200], dt, FLASH_LIMITS.maxAreaFraction + 0.05));
    expect(r.failures.some((f) => f.startsWith('area'))).toBe(true);
  });

  it('fails more peaks in one second than the limit, and passes them spread out', () => {
    const n = FLASH_LIMITS.maxPerSecond + 1;
    const tight = analyseFlashes(series(3000, Array.from({ length: n }, (_, i) => i * 200), 50));
    expect(tight.maxPerSecond).toBe(n);
    expect(tight.failures.some((f) => f.includes('peaks/s'))).toBe(true);
    const spread = analyseFlashes(series(5000, Array.from({ length: n }, (_, i) => i * 1100), 50));
    expect(spread.failures).toEqual([]);
  });

  it('ignores highlights below the flash area', () => {
    const r = analyseFlashes(series(1000, [0], 1000, FLASH_MEASURE.minAreaFraction / 2));
    expect(r.flashes).toEqual([]);
    expect(r.failures).toEqual([]);
  });
});
