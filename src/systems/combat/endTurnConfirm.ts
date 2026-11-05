import { CombatUnit } from '@/models/types';

/**
 * Whether End Turn asks first (PT-16): the hero has neither walked nor acted this
 * turn, so the press would throw the whole turn away. The windows after acting
 * (Shadow Echo's hold, a reposition cap) come with `hasActed` set and never ask.
 */
export function endTurnNeedsConfirm(unit: Pick<CombatUnit, 'isPlayer' | 'hasActed' | 'hasMoved'> | undefined): boolean {
  return !!unit && unit.isPlayer && !unit.hasActed && !unit.hasMoved;
}
