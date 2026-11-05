import {
  HP_BLOCK, HP_MAX_DIVIDERS_SMALL, HP_MAX_DIVIDERS_WIDE, barrierTotal, battleHpStep, hpBarLayout, hpDividerStep,
} from '@/data/display/hpBlocks';
import { AuraType } from '@/models/types';

describe('the shield a unit shows', () => {
  // Playtest 2026-10-08: a Reckoning soaked blows with no bubble and no bar segment
  it('counts what a Reckoning has left to absorb, beside any Barrier', () => {
    const effects = [
      { type: AuraType.Reckoning, magnitude: 40 },
      { type: AuraType.Barrier, magnitude: 15 },
      { type: AuraType.AttackBuff, magnitude: 99 },
    ];
    expect(barrierTotal(effects)).toBe(55);
    expect(barrierTotal([{ type: AuraType.Reckoning, magnitude: 40 }])).toBe(40);
  });
});

describe('hp blocks', () => {
  it('uses one battle scale so 439 HP never shows fewer segments than 203 HP', () => {
    for (const largest of [439, 3000, 12000]) {
      const step = battleHpStep(largest);
      const high = hpBarLayout(439, 439, 0, undefined, step);
      const low = hpBarLayout(203, 203, 0, undefined, step);
      expect(high.step).toBe(low.step);
      expect(439 / high.step).toBeGreaterThan(203 / low.step);
      expect(hpBarLayout(largest, largest, 0, undefined, step).dividers.length).toBeLessThanOrEqual(8);
    }
  });
  it('counts blocks in proportion to maximum HP, so size can be ranked by eye', () => {
    const archer = hpBarLayout(HP_BLOCK * 3, HP_BLOCK * 3, 0);
    const brute = hpBarLayout(HP_BLOCK * 9, HP_BLOCK * 9, 0);
    expect(brute.blocks).toBe(archer.blocks * 3);
    // Off a block boundary the larger unit still never shows fewer blocks
    expect(hpBarLayout(300, 300, 0).blocks).toBeGreaterThan(hpBarLayout(100, 100, 0).blocks * 2);
    expect(brute.dividers.length + 1).toBe(brute.blocks);
    expect(hpBarLayout(HP_BLOCK * 5, HP_BLOCK * 5, 0).blocks).toBeGreaterThan(archer.blocks);
  });

  it('draws every block as the same HP while dividers are affordable', () => {
    const l = hpBarLayout(150, 150, 0);
    expect(l.step).toBe(HP_BLOCK);
    const gaps = l.dividers.map((d, i) => (d.at - (l.dividers[i - 1]?.at ?? 0)) * l.total);
    for (const g of gaps) expect(g).toBeCloseTo(HP_BLOCK);
  });

  it('shows the remainder as a smaller last block', () => {
    const l = hpBarLayout(HP_BLOCK * 2 + HP_BLOCK / 5, HP_BLOCK * 2 + HP_BLOCK / 5, 0);
    expect(l.blocks).toBe(3);
    const last = (1 - l.dividers[l.dividers.length - 1].at) * l.total;
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThan(HP_BLOCK);
  });

  it('never exceeds the divider budget and falls back to coarser ticks', () => {
    for (const max of [30, 240, 900, 1660, 3000, 12000]) {
      for (const cap of [HP_MAX_DIVIDERS_SMALL, HP_MAX_DIVIDERS_WIDE]) {
        const l = hpBarLayout(max, max, 0, cap);
        expect(l.dividers.length).toBeLessThanOrEqual(cap);
        expect(l.step % HP_BLOCK).toBe(0);
      }
    }
    expect(hpDividerStep(3000, HP_MAX_DIVIDERS_WIDE)).toBeGreaterThan(HP_BLOCK);
    expect(hpDividerStep(60, HP_MAX_DIVIDERS_SMALL)).toBe(HP_BLOCK);
  });

  it('keeps a boss legible: coarse ticks mark whole multiples, not slivers', () => {
    const l = hpBarLayout(3000, 3000, 0, HP_MAX_DIVIDERS_SMALL);
    expect(l.dividers.length).toBeLessThan(HP_MAX_DIVIDERS_SMALL + 1);
    expect(l.dividers.every((d) => d.major)).toBe(true);
  });

  it('keeps the barrier visible after the fill, sharing the divider scale', () => {
    const hurt = hpBarLayout(60, 100, 20);
    expect(hurt.total).toBe(100);
    expect(hurt.shieldFrom).toBeCloseTo(0.6);
    expect(hurt.shieldTo).toBeCloseTo(0.8);
    const full = hpBarLayout(100, 100, 50);
    expect(full.total).toBe(150);
    expect(full.shieldTo).toBeCloseTo(1);
    expect(full.fill).toBeCloseTo(100 / 150);
    expect(hpBarLayout(100, 100, 0).shieldTo).toBe(hpBarLayout(100, 100, 0).fill);
  });

  it('is safe at zero or negative HP', () => {
    const l = hpBarLayout(-5, 100, 0);
    expect(l.fill).toBe(0);
    expect(hpBarLayout(0, 0, 0).total).toBeGreaterThan(0);
  });
});
