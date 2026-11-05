import { CombatUnit } from '@/models/types';
import { hexToPixel } from '@/utils/hexUtils';

/**
 * A very large unit standing in front of a smaller one hides it.
 *
 * The camera looks down −z and larger `r` is nearer the viewer, so a unit is
 * *behind* a big one when it stands a little farther back on the board and
 * roughly in line with it. The big unit then fades — slightly all the time, more
 * when it is the hidden unit's own turn, because that is when the player most
 * needs to see where it stands. Pure, so the rule is testable and any later
 * oversized unit gets it by being large, not by being named.
 */

/** Opacity of a big unit with something of the party's behind it. */
export const COVERING_OPACITY = 0.6;
/** The same, when the covered unit is the one whose turn it is. */
export const COVERING_ACTIVE_OPACITY = 0.3;
/** Model scale (including phase presence) from which a unit counts as big. */
export const BIG_UNIT_SCALE = 1.15;

/** How far behind (world z) and how far to the side a unit is still hidden by the one in front. */
// A tall body covers the ground beside and just in front of its feet as well as
// what stands behind it, so the window starts a little *before* its own row
const BEHIND_MIN = -1;
const BEHIND_MAX = 4.5;
const SIDE_MAX = 1.9;

export function isHiddenBehind(big: CombatUnit, other: CombatUnit): boolean {
  const b = hexToPixel(big.position);
  const o = hexToPixel(other.position);
  const behind = b.y - o.y;
  return behind >= BEHIND_MIN && behind <= BEHIND_MAX && Math.abs(b.x - o.x) <= SIDE_MAX;
}

/** The big unit's opacity: 1 with nobody behind it, else the covering values. */
export function bigUnitOpacity(
  big: CombatUnit,
  units: readonly CombatUnit[],
  currentUnitId: string | null,
): number {
  const covered = units.filter(
    (u) => u.isPlayer && u.currentHp > 0 && !u.objective && u.id !== big.id && isHiddenBehind(big, u),
  );
  if (covered.length === 0) return 1;
  return covered.some((u) => u.id === currentUnitId) ? COVERING_ACTIVE_OPACITY : COVERING_OPACITY;
}
