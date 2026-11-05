import { CombatUnit } from '@/models/types';
import { AETHELRED_PHASES, BossPhase } from '@/data/templates/aethelred';
import { TROLL_PHASES } from '@/data/templates/trollChieftain';
import { HEART_PHASES } from '@/data/templates/heartOfWinter';
// Jadeveil: Silent Hall / Fallen Order
import { LESSON_PHASES } from '@/data/templates/lastLesson';
// Jadeveil: Silk Hollow / Yokai
import { JOROGUMO_PHASES } from '@/data/templates/jorogumoWeaver';
// Jadeveil: Kairen
import { KAIREN_PHASES } from '@/data/templates/kairen';

/**
 * Health-triggered boss phases, kept pure so the store has nothing to decide.
 *
 * The transition check belongs in `combatStore.damageUnit`, immediately after
 * the HP write — the one funnel every damage source already passes through
 * (skills, damage-over-time ticks, Thorns reflection, Doom). That is the same
 * reasoning that put Barrier and Undying there, and it is why a boss cannot be
 * burned past a threshold without noticing.
 */

const PHASES_BY_TEMPLATE: Record<string, BossPhase[]> = {
  aethelred: AETHELRED_PHASES,
  troll_chieftain: TROLL_PHASES,
  heart_of_winter: HEART_PHASES,
  // Jadeveil: Silent Hall / Fallen Order
  last_lesson: LESSON_PHASES,
  // Jadeveil: Silk Hollow / Yokai
  jorogumo: JOROGUMO_PHASES,
  // Jadeveil: Kairen
  kairen: KAIREN_PHASES,
};

export function phasesFor(templateId?: string): BossPhase[] | undefined {
  return templateId ? PHASES_BY_TEMPLATE[templateId] : undefined;
}

/** Whether this unit's fight is staged at all. */
export function isPhasedBoss(unit: CombatUnit): boolean {
  return phasesFor(unit.templateId) !== undefined;
}

/**
 * The phase this unit should enter *now*, or null if it should stay where it is.
 *
 * **One step at a time, and every phase is lived in.** A blow that crosses two
 * thresholds takes the boss into the *next* phase only, with its health left
 * exactly where the blow put it; the one after follows once he has begun a turn
 * in this one. Two rules fall out of that and both are the point:
 *
 * 1. **No phase is skipped.** The old rule landed on the deepest phase the HP
 *    qualified for, which let a burst turn erase a designed phase silently —
 *    the fight's second act could simply never happen.
 * 2. **No earned damage is erased.** The health is never raised or capped on
 *    entry beyond the new ceiling, so overflow past a threshold just means the
 *    next transition is already waiting. A phase may therefore be short; it is
 *    never absent.
 *
 * Combined with the index only ever increasing, the bar is still a ratchet: a
 * lifesteal heal cannot walk him backwards and a threshold cannot fire twice,
 * including from a Thorns tick re-entering mid-resolution. A unit with no
 * script (a fixture) has no turn requirement, so this stays a pure threshold
 * check for anything that is not the scripted fight.
 */
export function pendingPhase(unit: CombatUnit): { index: number; phase: BossPhase } | null {
  const phases = phasesFor(unit.templateId);
  if (!phases) return null;

  const current = unit.bossPhase ?? 0;
  const next = phases[current + 1];
  if (!next || !phaseAtTier(unit, next)) return null;

  const fraction = unit.stats.maxHp > 0 ? unit.currentHp / unit.stats.maxHp : 0;
  if (fraction > next.threshold) return null;
  // The rule above: he must have begun a turn in the phase he is leaving
  if (unit.bossScript && unit.bossScript.phaseTurns < 1) return null;

  return { index: current + 1, phase: next };
}

/** Whether a boss fought at its `challengeTier` lives this phase at all (`BossPhase.fromTier`). */
export const phaseAtTier = (unit: Pick<CombatUnit, 'challengeTier'>, phase: BossPhase): boolean =>
  (unit.challengeTier ?? 1) >= (phase.fromTier ?? 1);

/** The HP cap a phase imposes once entered. */
export function phaseHpCeiling(unit: CombatUnit, phase: BossPhase): number {
  return Math.max(1, Math.round(unit.stats.maxHp * phase.threshold));
}
