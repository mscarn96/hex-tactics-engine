import type { CombatUnit, PreparedAttack, PreparedSpec, WarnedAnswer } from '@/models/types';

/**
 * How a warned move can be answered, asked of the move.
 *
 * A warning's spec carries the rules its landing runs by (`split`, `blockedBy`, `shelter`, `sealed`, an
 * interrupt) and the answers it names past those (`PreparedSpec.answers`). `answersOf` reads both as one
 * list, so the plate (`preparedDisplay`) and the simulator's party (`partyPolicy`, `trollAnswers`) ask
 * which answers a warning has instead of which boss's move it is. A new warned move answered in a new
 * way is a new answer here and in the readers that act on it, not another id in each of them.
 *
 * Pure: the spec and the board in, nothing stored.
 */

/** Every answer the warning has: the ones its rules imply, then the ones it names. */
export function answersOf(spec: PreparedSpec): WarnedAnswer[] {
  const implied: WarnedAnswer[] = [];
  if ((spec.interruptedBy?.length ?? 0) > 0 || spec.tauntCancels) implied.push({ kind: 'break' });
  if (spec.blockedBy || spec.heldBy) implied.push({ kind: 'block' });
  if (spec.split) implied.push({ kind: 'share' });
  if (spec.sealed) implied.push({ kind: 'toll' });
  if (spec.shelter) implied.push({ kind: 'shelter', ...spec.shelter });
  return [...implied, ...(spec.answers ?? [])];
}

/** The warning's answer of `kind`, if it has one (the first, for a kind it could name twice). */
export function answerOf<K extends WarnedAnswer['kind']>(
  attack: Pick<PreparedAttack, 'spec'>,
  kind: K,
  where: (answer: Extract<WarnedAnswer, { kind: K }>) => boolean = () => true,
): Extract<WarnedAnswer, { kind: K }> | undefined {
  return answersOf(attack.spec).find(
    (a): a is Extract<WarnedAnswer, { kind: K }> => a.kind === kind && where(a as Extract<WarnedAnswer, { kind: K }>),
  );
}

/** The objectives standing that cancel `attack` when destroyed: bound to it or riding on it, of the kind its answer names. */
export function cancellingObjectives(attack: PreparedAttack, units: readonly CombatUnit[]): CombatUnit[] {
  const cancel = answerOf(attack, 'cancel', (a) => !!a.objective);
  if (!cancel) return [];
  return units.filter((u) => u.currentHp > 0 && u.objective?.kind === cancel.objective
    && (u.objective?.bindsPrepared === attack.id || u.objective?.linkedPreparedId === attack.id));
}

/**
 * How whole the objective of `kind` bound to warning `attackId` is: its remaining health over its maximum,
 * the share a graded warning lands at (`cancel.graded`). Nothing (0) once it is gone: destroying it
 * cancelled the warning.
 */
export function boundWholeness(attackId: string, kind: string, units: readonly CombatUnit[]): number {
  const bound = units.find((u) => u.currentHp > 0 && u.objective?.kind === kind && u.objective.bindsPrepared === attackId);
  if (!bound || bound.stats.maxHp <= 0) return 0;
  return Math.min(1, Math.max(0, bound.currentHp / bound.stats.maxHp));
}
