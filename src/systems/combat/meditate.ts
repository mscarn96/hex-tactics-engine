import { ActiveEffect, AuraType, CombatUnit } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { combatMaxHp } from '@/systems/combat/forms';

/**
 * Meditate, the Monk's level-3 identity skill (the private project notes, "The
 * base class").
 *
 * Two halves, a turn apart. **Now**, the skill itself: both defences raised until
 * the Monk's next turn begins (two auras of duration 1, authored on the skill) and
 * the chi refill (`refillChi(…, 'meditate')`, paid by `resolveSkillUse`). **At the
 * start of the next turn**, the Meditation aura that the skill laid expires and
 * pays out: a share of maximum HP healed, and Attack and Magic for that turn.
 *
 * The payout rides the expiring aura — the Martyr seal's and Doom's shape — so
 * nothing has to remember a promise across the round: `effectTick` notices the
 * aura on the tick that retires it and calls the store's `payMeditation`, which
 * applies what `meditationPayout` says.
 */

export const MEDITATE_ID = 'meditate';

export interface MeditationPayout {
  /** HP to heal, before the store's ceilings. */
  heal: number;
  /** The auras laid for the turn that is starting. */
  effects: ActiveEffect[];
}

/**
 * What an expiring Meditation pays this unit. The buffs carry duration 1: laid
 * after the tick that retired the aura, they stand for this turn and the next
 * tick removes them, so they are "for that turn" by the same clock as every
 * other status.
 */
export function meditationPayout(unit: CombatUnit): MeditationPayout {
  const M = BALANCE.MEDITATE;
  const effects: ActiveEffect[] = [
    { type: AuraType.AttackBuff, magnitude: M.ATTACK, duration: 1, sourceUnitId: unit.id },
    { type: AuraType.MagicBuff, magnitude: M.MAGIC, duration: 1, sourceUnitId: unit.id },
  ];
  // The Mantis's Predator's Breath: critical chance for the same turn. Read off the
  // unit's own passive list, since `passives` sits above this module.
  if (unit.passives?.includes('predatorsBreath')) {
    const scale = unit.passiveRanks?.predatorsBreath?.scale ?? 1;
    effects.push({
      type: AuraType.CritBuff,
      magnitude: Math.round(BALANCE.MANTIS.PREDATORS_BREATH_CRIT * scale),
      duration: 1,
      sourceUnitId: unit.id,
    });
  }
  return {
    heal: Math.max(1, Math.round(combatMaxHp(unit) * M.HEAL_SHARE)),
    effects,
  };
}
