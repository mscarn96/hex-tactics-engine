import { BALANCE } from '@/data/balanceConstants';

/** Authored rank-two spell costs; capstones draw substantially more mana. */
export function casterManaCost(base: number, ultimate = false): number {
  return Math.round(base * (ultimate ? BALANCE.MASTERY_MANA.ULTIMATE_COST_MULT : BALANCE.MASTERY_MANA.SPELL_COST_MULT));
}
