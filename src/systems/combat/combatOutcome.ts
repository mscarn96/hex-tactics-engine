import { isAlive } from '@/systems/combat/targetLegality';
import { CombatUnit } from '@/models/types';
import { isInert } from '@/systems/combat/unitLookup';

/**
 * Whether the fight is over, and who won.
 *
 * Deliberately just the verdict. Everything a victory *causes* — XP, loot, the
 * chest, Seals, the castle's next stage, the save — stays in `CombatScene`,
 * because none of it is a combat rule and none of it is wanted by a harness
 * that only needs to know who was left standing.
 */

export type CombatOutcome = 'ongoing' | 'victory' | 'defeat';


export function combatOutcome(
  units: CombatUnit[],
  /**
   * Announced waves still to arrive (`waves.pendingWaveCount`). While any
   * remain, an empty enemy side is a gap between waves, not a victory — and the
   * fight cannot be won until the last of them has been beaten.
   */
  pendingWaves: number = 0,
): CombatOutcome {
  // An objective is not a combatant: a Furnace Heart left standing does not
  // keep a won fight going, and one the party never touches does not decide it.
  const aliveEnemies = units.filter((u) => !u.isPlayer && isAlive(u) && !u.objective);

  // Heroes, not "player units": a surviving summon must not keep a wiped party
  // standing. Victory needs no equivalent guard — an enemy summon correctly
  // counts as a living enemy you still have to deal with.
  const aliveHeroes = units.filter((u) => u.isPlayer && isAlive(u) && u.heroId !== undefined);

  if (aliveEnemies.length === 0 && pendingWaves === 0) return 'victory';
  if (aliveHeroes.length === 0) return 'defeat';
  return 'ongoing';
}

/**
 * Every living unit is inert, so nobody can ever act again.
 *
 * A Stoneshaper's rock has no skills and no movement — it is *alive*, and it
 * genuinely never acts, so a board holding nothing else spins the turn order
 * forever. Treated as a loss rather than a draw: the alternative is a loop with
 * no way out of it.
 *
 * **Crowd control is deliberately not counted, and this used to include Freeze
 * and Stun.** The reasoning then was that Freeze held until something struck it
 * and striking requires somebody to act, so a fully locked board had no way
 * back out. Freeze runs on `FREEZE_DURATION` now and Stun always did: both
 * unstick themselves after a fixed number of turns, so counting them would hand
 * the player a defeat for a well-landed Blizzard — the exact play the ice path
 * is built around.
 */
export function isDeadlocked(units: CombatUnit[]): boolean {
  const living = units.filter(isAlive);
  if (living.length === 0) return false;
  return living.every(isInert);
}
