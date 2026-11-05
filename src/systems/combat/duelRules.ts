import { CombatUnit, HexCoord } from '@/models/types';
import { hexDistance } from '@/utils/hexUtils';

/**
 * The two questions the Rime Jarl's rune circle asks of everything else.
 *
 * Kept free of `combatEngine` and the kits so the engine itself — movement, a shove, a
 * dash — can ask them without closing a cycle. The rest of the duel (who may be
 * challenged, when it runs out) is `factionEliteKits`.
 */

/** Whether `hex` is inside the circle `unit` is bound to. A unit with no duel is bound to nothing. */
export const inDuelCircle = (unit: CombatUnit, hex: HexCoord): boolean =>
  !unit.duel || hexDistance(unit.duel.centre, hex) <= unit.duel.radius;

/**
 * Whether the circle bars `from` acting on `to`.
 *
 * The one rule the restriction comes down to, asked by every resolver, every highlight
 * and the AI's scoring: while a duel is on, the two duelists can affect each other and
 * themselves and nobody else, and nobody else can affect them: damage, healing,
 * shields, cleanses and new statuses alike. Statuses already on a duelist continue.
 */
export function duelBars(from: CombatUnit, to: CombatUnit): boolean {
  if (from.id === to.id) return false;
  const fromBound = !!from.duel;
  const toBound = !!to.duel;
  if (!fromBound && !toBound) return false;
  if (fromBound && toBound) return from.duel!.partnerId !== to.id;
  return true;
}
