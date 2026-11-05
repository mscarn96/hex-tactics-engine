import { AuraType, CombatUnit } from '@/models/types';
import { t } from '@/i18n';
import { skillName } from '@/data/gameText';
import { BALANCE } from '@/data/balanceConstants';

/**
 * Speed-granted bonus turns, as pure rules over a roster.
 *
 * `turnOrder` is sorted once and speed buffs never reorder it, so speed alone
 * decides nothing after the opening round. This is the one place speed keeps
 * mattering: a unit much faster than the side it faces has a chance, rolled at
 * the start of its regular turn, of acting a second time straight after it.
 * Rolled at the *start* so the queue can show the granted turn before it
 * happens, and so the answer is fixed for the turn rather than a surprise at
 * its end.
 *
 * The rules, all of them pinned by `turnTempo.test.ts`:
 *
 * - **Both sides.** The roll looks at the unit and the units it faces, nothing
 *   about allegiance. A fast hero and a fast wolf are the same case.
 * - **Never recursive.** A bonus turn is not rolled for. One regular turn
 *   yields at most one extra.
 * - **Not a second turn's upkeep.** A bonus turn ticks nothing — no cooldown,
 *   no effect duration, no objective timer, no Reaction expiry — so it is
 *   extra *action* and never extra time. It also never lands a prepared attack
 *   a second time or shortens a warning's response window, which is counted in
 *   the responders' own turns (`preparedAttacks`).
 * - **Stacks with scripted extra actions.** A bonus turn is an ordinary turn
 *   for whatever the unit's kit does with a turn, so a boss that takes two
 *   actions per turn takes two on the bonus turn as well.
 */

/** A unit's speed against the mean speed of the living combatants it faces. */
export function speedEdge(unit: CombatUnit, units: CombatUnit[]): number {
  const foes = units.filter(
    (u) => u.currentHp > 0 && !u.objective && u.isPlayer !== unit.isPlayer && u.stats.speed > 0,
  );
  if (foes.length === 0 || unit.stats.speed <= 0) return 0;
  const mean = foes.reduce((sum, u) => sum + tempoSpeed(u), 0) / foes.length;
  return tempoSpeed(unit) / mean - 1;
}

/**
 * The speed tempo reads: the sheet's, and the Brigand Captain's +50% where it is worn.
 *
 * The one modifier it reads. A timed speed buff or a Chill is a passing state, and this
 * file has never counted one; the Captain's word is a standing stat on every ally of his
 * for as long as he lives, which is worth exactly what it says. `TEMPO_MAX_CHANCE` is what
 * keeps a warband under it from taking a bonus turn in every round.
 */
export const tempoSpeed = (unit: CombatUnit): number =>
  unit.stats.speed * (1 + (unit.activeEffects.find((e) => e.type === AuraType.Authority)?.magnitude ?? 0));

/**
 * The chance of a bonus turn for a given edge: nothing until `TEMPO_MIN_EDGE`,
 * then linear up to `TEMPO_MAX_CHANCE` at `TEMPO_FULL_EDGE`, flat beyond it.
 */
export function bonusTurnChance(edge: number): number {
  const { TEMPO_MIN_EDGE: lo, TEMPO_FULL_EDGE: hi, TEMPO_MAX_CHANCE: max } = BALANCE;
  if (edge <= lo) return 0;
  if (edge >= hi) return max;
  return max * ((edge - lo) / (hi - lo));
}

/** A unit with nothing it could do — see `combatEngine.isInert`, which this must not import. */
const isInertUnit = (unit: CombatUnit) => unit.skills.length === 0 && unit.stats.moveRange === 0;

/** Whether this unit can be granted a bonus turn at all. */
export function canHaveBonusTurn(unit: CombatUnit): boolean {
  return unit.currentHp > 0 && !unit.objective && !unit.summonedBy && !isInertUnit(unit);
}

export type TempoRandom = () => number;
let tempoRandom: TempoRandom = Math.random;

/**
 * Replaces the dice. Tests and the tuning harness pin the roll this way; pass
 * `null` to restore `Math.random`.
 */
export function setTempoRandom(rng: TempoRandom | null): void {
  tempoRandom = rng ?? Math.random;
}

/** Rolls the unit's bonus turn for the regular turn it is about to take. */
export function rollBonusTurn(unit: CombatUnit, units: CombatUnit[]): boolean {
  if (!canHaveBonusTurn(unit)) return false;
  const chance = bonusTurnChance(speedEdge(unit, units));
  return chance > 0 && tempoRandom() < chance;
}

/**
 * The most actions a unit can take in one regular-plus-bonus pair, when its kit
 * scripts `scriptedPerTurn` actions on every turn. The Troll Chieftain's Fury
 * is two, so four — the ceiling balance and presentation must account for.
 */
export const actionCeiling = (scriptedPerTurn: number): number => scriptedPerTurn * 2;

export type ExtraTurnCause = 'fury' | 'speed' | 'bloodHowl' | 'threefoldScythe' | 'mantisExecution';

/**
 * The one rule for "this turn is a second turn": the cause, or null for an ordinary turn.
 * Fury wins when both hold (a Fury action after a speed bonus turn), since it is the
 * explicit effect the player can read on the unit. Read after `beginTurn`, which clears
 * the speed flag when a disable took the turn.
 */
export function extraTurnCause(state: {
  bonusTurn: { active: boolean; howl?: boolean; mantis?: 'scythe' | 'execution' };
  furyExtra: { active: boolean };
}): ExtraTurnCause | null {
  if (state.furyExtra.active) return 'fury';
  // A Blood Howl turn rides the bonus-turn machinery, and says which it is
  if (state.bonusTurn.active && state.bonusTurn.howl) return 'bloodHowl';
  // So do the Mantis capstones' turns
  if (state.bonusTurn.active && state.bonusTurn.mantis) {
    return state.bonusTurn.mantis === 'scythe' ? 'threefoldScythe' : 'mantisExecution';
  }
  return state.bonusTurn.active ? 'speed' : null;
}

/** What each cause is called in the notice: a rule's own word, or the skill that grants the turn. */
const causeName = (cause: ExtraTurnCause): string => {
  switch (cause) {
    case 'fury': return t('combatLog.cause.fury');
    case 'speed': return t('combatLog.cause.speed');
    case 'bloodHowl': return skillName({ id: 'blood_howl' });
    case 'threefoldScythe': return skillName({ id: 'threefold_scythe' });
    case 'mantisExecution': return skillName({ id: 'mantis_execution' });
  }
};

/** The toast text announcing a second turn, e.g. "Wolf acts again — Speed". */
export const extraTurnNotice = (unitName: string, cause: ExtraTurnCause): string =>
  t('combatLog.log.extraTurn', { name: unitName, cause: causeName(cause) });
