import type { CombatUnit } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';

/**
 * The chi loop's refills (the private project notes, "The chi loop").
 *
 * Chi is `currentMana` on a unit whose `resource` is `'chi'`. The per-turn regen
 * needs nothing here — it is the unit's `manaRegen`, set by `statCalc` and paid by
 * the start-of-turn tick like everyone's. What is chi's own is the refill: once
 * per Basic Attack **action**, dodged or not, so a dual-wield swing is one refill
 * rather than two; and Meditate's.
 */
export type ChiRefillSource = 'basicAttack' | 'meditate';

const REFILL: Record<ChiRefillSource, number> = {
  basicAttack: BALANCE.CHI.BASIC_ATTACK_REFILL,
  meditate: BALANCE.CHI.MEDITATE_REFILL,
};

/** True when this unit's pool is chi. */
export function isChiUnit(unit: Pick<CombatUnit, 'resource'> | undefined): boolean {
  return unit?.resource === 'chi';
}

/**
 * The chi this unit gains from `source`, capped at what its pool has room for.
 * Zero for a unit that does not use chi — every other class is untouched.
 */
export function chiRefill(
  unit: Pick<CombatUnit, 'resource' | 'currentMana' | 'stats'>,
  source: ChiRefillSource,
  /** Chi a node adds to this refill (Shell Breath on Meditate). */
  extra = 0,
): number {
  if (!isChiUnit(unit)) return 0;
  return Math.max(0, Math.min(REFILL[source] + extra, unit.stats.maxMana - unit.currentMana));
}
