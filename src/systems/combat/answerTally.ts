import type { CombatUnit, PreparedAttack } from '@/models/types';
import { hexKey } from '@/utils/hexUtils';

/**
 * The answer tally: how each warned move was answered.
 *
 * Every hero standing in a warning's footprint when it was cast (`PreparedAttack.threatened`) is
 * owed one answer, and is counted exactly once where the warning resolves, so the columns of a move
 * always sum to the heroes it threatened and still lived to be counted:
 *
 * - `stepped`: left the footprint before the landing.
 * - `took`: stood in it and was struck.
 * - `blocked`: held the line (`PreparedSpec.blockedBy`) and took the blow in the others' place, held their own
 *   hex behind a shield and took the held share of it (`PreparedSpec.heldBy`), or
 *   was braced against a push (rubble or the wall at their back, so the throw did not move them:
 *   `PreparedPreview.braced`) and took the blow without losing the hex.
 * - `unharmed`: stood in it and was not struck: sheltered, spared behind a blocker, in the trench,
 *   on a plugged vent, or the second end of a chain that split nothing onto them.
 * - `broken`: the warning never landed because the party broke it (the bound objective destroyed,
 *   the caster interrupted, the chain cleansed, the claim's soldiers killed).
 *
 * This is the instrument for "in 90% of cases there is one choice": a move whose tally is one column
 * above about seventy per cent across playtests is still a one-choice move. Pure: the combat store
 * holds the counts (`combatStore.answerTally`), the battle report and the balance lab read them.
 */

export const ANSWER_KINDS = ['stepped', 'took', 'blocked', 'unharmed', 'broken'] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

/** The counts for one move, by answer. */
export type MoveAnswers = Record<AnswerKind, number>;

/** Every move that has been answered this fight, by the id of its words (`textId ?? id`). */
export type AnswerTally = Record<string, MoveAnswers>;

export const emptyAnswers = (): MoveAnswers => ({ stepped: 0, took: 0, blocked: 0, unharmed: 0, broken: 0 });

/** The heroes a move was owed to: the sum of its columns. */
export const owedOf = (answers: MoveAnswers): number => ANSWER_KINDS.reduce((sum, k) => sum + answers[k], 0);

/** Each column's share of what was owed (0 for a move owed nobody). */
export function sharesOf(answers: MoveAnswers): MoveAnswers {
  const owed = owedOf(answers);
  return Object.fromEntries(ANSWER_KINDS.map((k) => [k, owed > 0 ? answers[k] / owed : 0])) as MoveAnswers;
}

/** The id a warning's tally is kept under: the id of its words. */
export const moveIdOf = (attack: PreparedAttack): string => attack.skill.textId ?? attack.skill.id;

/** Who was owed an answer and is still on the board to be counted. */
const owedTo = (attack: PreparedAttack, units: readonly CombatUnit[]): CombatUnit[] =>
  (attack.threatened ?? attack.responders)
    .map((id) => units.find((u) => u.id === id))
    .filter((u): u is CombatUnit => !!u && u.currentHp > 0);

/**
 * How each hero owed an answer answered the landing, from who it actually struck: every blow of it,
 * gathered by the landing (`warnedLanding`), so the count and the blows always agree. `units` is the
 * board as the landing began, so a hero the landing killed is still counted, where they stood.
 */
export function classifyLanding(
  attack: PreparedAttack,
  units: readonly CombatUnit[],
  landed: {
    /** Every body a blow of the landing reached. */
    struckIds: readonly string[];
    /** The hero who held the line (`PreparedSpec.blockedBy`), when one did. */
    blockerId?: string;
    /** Struck heroes whom a push did not move because rubble or the wall stood at their back. */
    braced?: readonly string[];
    /** Struck heroes who held their own hex behind a shield (`PreparedSpec.heldBy`: a crown point). */
    holders?: readonly string[];
  },
): { unitId: string; kind: AnswerKind }[] {
  const struck = new Set(landed.struckIds);
  const braced = new Set([...(landed.braced ?? []), ...(landed.holders ?? [])]);
  // Ground spared at the cast counts as inside: a hero who stayed on it stood in the warning and was not struck
  const footprint = new Set([...attack.hexes, ...(attack.sheltered ?? [])].map(hexKey));
  return owedTo(attack, units).map((u) => {
    if (struck.has(u.id)) {
      const held = u.id === landed.blockerId || braced.has(u.id);
      return { unitId: u.id, kind: held ? 'blocked' as const : 'took' as const };
    }
    // Spared: behind a blocker, sheltered, the end of a chain that paid nothing, a spire broken in time
    return { unitId: u.id, kind: footprint.has(hexKey(u.position)) ? 'unharmed' as const : 'stepped' as const };
  });
}

/** A warning the party broke: everyone it was owed to saw it broken. */
export const classifyBroken = (attack: PreparedAttack, units: readonly CombatUnit[]): { unitId: string; kind: AnswerKind }[] =>
  owedTo(attack, units).map((u) => ({ unitId: u.id, kind: 'broken' as const }));

/** The tally with `answers` counted under `moveId`. Immutable, so the store can hand it out. */
export function addAnswers(tally: AnswerTally, moveId: string, answers: readonly { kind: AnswerKind }[]): AnswerTally {
  if (answers.length === 0) return tally;
  const row = { ...(tally[moveId] ?? emptyAnswers()) };
  for (const { kind } of answers) row[kind]++;
  return { ...tally, [moveId]: row };
}

/** Two tallies added column by column. */
export function mergeTallies(a: AnswerTally, b: AnswerTally): AnswerTally {
  const out: AnswerTally = { ...a };
  for (const [id, row] of Object.entries(b)) {
    const base = out[id] ?? emptyAnswers();
    out[id] = Object.fromEntries(ANSWER_KINDS.map((k) => [k, base[k] + row[k]])) as MoveAnswers;
  }
  return out;
}

/** The compact form a fight record stores: per move, the five counts in `ANSWER_KINDS` order. */
export const packTally = (tally: AnswerTally): Record<string, number[]> =>
  Object.fromEntries(Object.entries(tally).map(([id, row]) => [id, ANSWER_KINDS.map((k) => row[k])]));

export const unpackTally = (packed: Record<string, number[]>): AnswerTally =>
  Object.fromEntries(Object.entries(packed).map(([id, counts]) => [
    id, Object.fromEntries(ANSWER_KINDS.map((k, i) => [k, counts[i] ?? 0])) as MoveAnswers,
  ]));
