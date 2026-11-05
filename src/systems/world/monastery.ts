import { BALANCE } from '@/data/balanceConstants';
import type { CombatUnit } from '@/models/types';
import { BLESSINGS, MONASTERY_RINGS, isBlessingId, type Blessing, type BlessingId } from '@/data/monastery';
import { wrathPowerScale } from '@/systems/world/wrath';
import { magicDefenseOf } from '@/systems/combat/damageType';

/**
 * The monastery's party-wide vows: one blessing chosen from two at each of
 * four rings (`data/monastery.ts`).
 *
 * **One selection per ring, held by the party, not by a hero.** A recruit who
 * joins in the second week fights under the same vows as the founder, because
 * nothing about a vow is written on a hero: it is applied to the party's units
 * when a Jadeveil fight is built, and to the dawn while the party is there. So
 * the effects are gone the moment the party crosses home and back the moment
 * it returns, with nothing to add or strip.
 *
 * The first ring opens on arrival; each other opens at the wrath floor it
 * names. A vow can be changed at the monastery for a day of prayer on the clock
 * (`BALANCE.MONASTERY_REVOW_HOURS`), the same at every ring. Pure.
 */

/** A ring's chosen blessing, or `null` before it is chosen. Always one entry per ring. */
export type Vows = readonly (BlessingId | null)[];

export const NO_VOWS: Vows = MONASTERY_RINGS.map(() => null);

/** Whether ring `ring` is open at a wrath floor. */
export function ringOpen(ring: number, floor: number): boolean {
  const def = MONASTERY_RINGS[ring];
  return !!def && floor >= def.opensAt;
}

/** The rings open at `floor` with no vow taken yet, lowest first. */
export function ringsAwaitingVow(vows: Vows, floor: number): number[] {
  return MONASTERY_RINGS.flatMap((_, i) => (ringOpen(i, floor) && !vows[i] ? [i] : []));
}

/** Take `blessing` at `ring`: the new vows, or `null` when the ring is shut or the blessing not one of its two. */
export function takeVow(vows: Vows, ring: number, blessing: BlessingId, floor: number): Vows | null {
  const def = MONASTERY_RINGS[ring];
  if (!def || !ringOpen(ring, floor) || !def.choices.includes(blessing)) return null;
  return vows.map((v, i) => (i === ring ? blessing : v));
}

/** Changing a vow already taken costs time; a first vow is free. */
export function vowHours(vows: Vows, ring: number, blessing: BlessingId): number {
  const current = vows[ring];
  if (!current || current === blessing) return 0;
  return BALANCE.MONASTERY_REVOW_HOURS;
}

/** The blessings in force under `vows`. */
export function blessingsOf(vows: Vows): Blessing[] {
  return vows.flatMap((v) => (v ? [BLESSINGS[v]] : []));
}

/** The share of wrath's extra strength that reaches the party: the least any vow allows. */
export function wrathShare(vows: Vows): number {
  return blessingsOf(vows).reduce((share, b) => Math.min(share, b.effect.wrathShare ?? 1), 1);
}

/** Wrath's multiplier on a Jadeveil fight's enemies, under the party's vows. */
export function blessedWrathPower(wrath: number, vows: Vows): number {
  return wrathPowerScale(wrath, wrathShare(vows));
}

/** The extra share of HP each dawn mends in Jadeveil. */
export function dawnHealBonus(vows: Vows): number {
  return blessingsOf(vows).reduce((sum, b) => sum + (b.effect.dawnHeal ?? 0), 0);
}

const pct = (value: number, percent: number) => Math.round(value * (1 + percent / 100));

/**
 * A player unit as it fights under the vows. Max HP rises with its current HP,
 * so a hero who walked in whole starts whole; the fight's end writes HP back
 * through `setHp`, which holds it to the hero's own maximum.
 */
export function blessUnit(unit: CombatUnit, vows: Vows): CombatUnit {
  if (!unit.isPlayer) return unit;
  const blessings = blessingsOf(vows);
  if (blessings.length === 0) return unit;
  const sum = (key: 'defensePct' | 'maxHpPct' | 'speedPct' | 'moveRange' | 'critChance' | 'dodgeChance') =>
    blessings.reduce((total, b) => total + (b.effect[key] ?? 0), 0);
  const s = unit.stats;
  const maxHp = pct(s.maxHp, sum('maxHpPct'));
  const crit = sum('critChance');
  const dodge = sum('dodgeChance');
  return {
    ...unit,
    stats: {
      ...s,
      maxHp,
      defense: pct(s.defense, sum('defensePct')),
      ...(sum('defensePct') > 0 && { magicDefense: pct(magicDefenseOf(s), sum('defensePct')) }),
      speed: pct(s.speed, sum('speedPct')),
      moveRange: s.moveRange + sum('moveRange'),
      ...(crit > 0 && { critChance: (s.critChance ?? BALANCE.BASE_CRIT_CHANCE) + crit }),
      ...(dodge > 0 && { dodgeChance: (s.dodgeChance ?? BALANCE.BASE_DODGE) + dodge }),
    },
    currentHp: unit.currentHp > 0 ? unit.currentHp + (maxHp - s.maxHp) : unit.currentHp,
  };
}

/** Whether a parsed value is a set of vows this build can restore. */
export function isVows(value: unknown): value is Vows {
  return Array.isArray(value)
    && value.length === MONASTERY_RINGS.length
    && value.every((v, i) => v === null || (isBlessingId(v) && MONASTERY_RINGS[i].choices.includes(v)));
}
