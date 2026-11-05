/**
 * Pure health and barrier fill geometry shared by arena and HUD bars.
 * Divider utilities remain independent of the continuous combat presentation.
 */

import { AuraType, type ActiveEffect } from '@/models/types';

/**
 * The effects that are a pool of absorption drawn as shield: a Barrier, and the
 * Bulwark's Reckoning, which is a Barrier that also remembers what it soaks. Its
 * `magnitude` is what it has left to absorb, exactly as a Barrier's is, so the
 * bubble and the bar segment show the same thing for both.
 */
export const isShieldPool = (type: ActiveEffect['type']): boolean =>
  type === AuraType.Barrier || type === AuraType.Reckoning;

/** Every shield on a unit, summed: a second shield extends the segment rather than hiding behind the first. */
export const barrierTotal = (effects: readonly Pick<ActiveEffect, 'type' | 'magnitude'>[]): number =>
  effects.reduce((sum, e) => (isShieldPool(e.type) ? sum + e.magnitude : sum), 0);

/** A continuous fill, extending its denominator when HP plus barrier exceeds max HP. */
export function healthBarFill(hp: number, maxHp: number, barrier: number) {
  const cur = Math.max(0, hp);
  const shield = Math.max(0, barrier);
  const total = Math.max(1, maxHp, cur + shield);
  const fill = Math.min(1, cur / total);
  return { total, fill, shieldFrom: fill, shieldTo: Math.min(1, (cur + shield) / total) };
}

/** HP in one block. A 40 HP goblin is one block, a 240 HP elite six, a 360 HP hero nine. */
export const HP_BLOCK = 40;
/** Every this-many blocks, a divider is a major tick. */
export const HP_MAJOR_EVERY = 5;
/** The most dividers a small bar (over-head, unit card) draws before it falls back to coarser ticks. */
export const HP_MAX_DIVIDERS_SMALL = 8;
/** The same for the wide boss bar across the top of the screen. */
export const HP_MAX_DIVIDERS_WIDE = 16;

/** One readable scale for every unit in a battle, including reinforcements. */
export function battleHpStep(largestPool: number): number {
  for (let decade = 10; ; decade *= 10) {
    for (const multiple of [5, 10, 20]) {
      const step = decade * multiple;
      if (Math.ceil(largestPool / step) - 1 <= HP_MAX_DIVIDERS_SMALL) return step;
    }
  }
}

export interface HpDivider {
  /** Position along the bar, 0..1, measured against the bar's whole denominator. */
  at: number;
  /** A major tick: every `HP_MAJOR_EVERY` blocks. */
  major: boolean;
}

export interface HpBarLayout {
  /** What the bar's full width stands for: max HP, or HP plus barrier when that is larger. */
  total: number;
  /** Whole and partial blocks in `total`; the last is partial when `total` is not a multiple of a block. */
  blocks: number;
  /** HP between dividers as drawn. A block normally, coarser when the bar is too dense. */
  step: number;
  dividers: HpDivider[];
  /** HP fill as a share of the bar. */
  fill: number;
  /** Barrier segment, from the fill's end. Zero length when there is none. */
  shieldFrom: number;
  shieldTo: number;
}

/**
 * Dividers at multiples of `step` that fall strictly inside `total`. Because they
 * count from the left, whatever does not fill a block is the last block — a
 * partial one showing the remainder.
 */
function dividersAt(total: number, step: number, block = HP_BLOCK): HpDivider[] {
  const out: HpDivider[] = [];
  const majorStep = block * HP_MAJOR_EVERY;
  for (let hp = step; hp < total - 1e-9; hp += step) {
    out.push({ at: hp / total, major: Math.round(hp) % majorStep === 0 });
  }
  return out;
}

/**
 * The divider step for a bar that may draw at most `maxDividers`: one block if
 * that fits, else a major tick, else the major tick doubled until it does.
 */
export function hpDividerStep(total: number, maxDividers: number): number {
  let step = HP_BLOCK;
  const count = (s: number) => Math.max(0, Math.ceil(total / s) - 1);
  if (count(step) <= maxDividers) return step;
  step = HP_BLOCK * HP_MAJOR_EVERY;
  while (count(step) > maxDividers) step *= 2;
  return step;
}

/**
 * Everything a surface needs to draw one unit's health: the fill, the barrier
 * segment after it and the dividers over both.
 *
 * At full health a barrier extends past the bar, so fill and barrier share a
 * denominator that grows to fit; the dividers use that same denominator, which
 * keeps a block the same HP before and after a shield lands.
 */
export function hpBarLayout(
  hp: number,
  maxHp: number,
  barrier: number,
  maxDividers: number = HP_MAX_DIVIDERS_SMALL,
  sharedStep?: number,
): HpBarLayout {
  const layout = healthBarFill(hp, maxHp, barrier);
  const total = layout.total;
  const step = sharedStep ?? hpDividerStep(total, maxDividers);
  return {
    ...layout,
    blocks: Math.ceil(total / (sharedStep ?? HP_BLOCK)),
    step,
    dividers: dividersAt(total, step, sharedStep),
  };
}
