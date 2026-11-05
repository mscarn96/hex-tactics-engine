import { BALANCE } from '@/data/balanceConstants';
import { ArenaHazard, CombatUnit, HeroSkill, HexCoord, HexDirection } from '@/models/types';
import { arcDirectionIndex, HEX_DIRS, inArena } from '@/systems/combat/arenaGeometry';
import { getNeighbors, hexDistance, hexToPixel } from '@/utils/hexUtils';

/**
 * Facing and flanks: every unit looks along one of the six hex directions, and an
 * adjacent attacker standing on one of its two rear-side hexes deals the flank
 * bonus, on its back hex the backstab. Pure: the store writes `facing`, the
 * resolver asks `flankOf`, and nothing here reads the store.
 *
 * Relative to a unit facing direction `f`, the hex in direction `f` is straight
 * ahead, `f ± 1` are the front sides, `f ± 2` the rear sides and `f + 3` the back.
 */

/** Where an adjacent attacker stands relative to the target's facing. */
export type Flank = 'front' | 'side' | 'back';

/**
 * The hex direction from `from` toward `to`: the nearest of the six, ties to the
 * lower index (the arc's own snap, so a cone and a turn agree). Null on one hex.
 */
export function directionToward(from: HexCoord, to: HexCoord): HexDirection | null {
  if (from.q === to.q && from.r === to.r) return null;
  return arcDirectionIndex(from, to) as HexDirection;
}

/**
 * The drawn turn of a model looking along `direction`: the Y rotation that points
 * its +Z at the neighbour that way, the convention `facingAngle` uses. The store
 * writes this whenever it writes `facing`, so the model, the chevron at its feet
 * and the rule all look the same way — a model turned to the exact aim while the
 * rule snapped to the nearest hex direction showed a back that was not the back.
 */
export function directionAngle(direction: HexDirection): number {
  const p = hexToPixel(HEX_DIRS[direction]);
  return Math.atan2(p.x, p.y);
}

/** The direction a move ends looking along: its last step, or the whole move without a route. */
export function moveFacing(from: HexCoord, to: HexCoord, path?: readonly HexCoord[]): HexDirection | null {
  if (path && path.length >= 2) {
    const last = path[path.length - 1];
    if (last.q === to.q && last.r === to.r) {
      const step = directionToward(path[path.length - 2], last);
      if (step !== null) return step;
    }
  }
  return directionToward(from, to);
}

/**
 * Toward the enemy side, the way a unit faces at deployment: the direction of the
 * centre of the living units against it. With none on the board, players look up
 * the board (−r) and enemies down it, the sides their spawn rows face.
 */
export function facingTowardFoes(unit: CombatUnit, units: readonly CombatUnit[]): HexDirection {
  const foes = units.filter((u) => u.isPlayer !== unit.isPlayer && u.currentHp > 0 && !u.objective);
  const toward = foes.length > 0
    ? {
        q: foes.reduce((n, u) => n + u.position.q, 0) / foes.length,
        r: foes.reduce((n, u) => n + u.position.r, 0) / foes.length,
      }
    : { q: unit.position.q + (unit.isPlayer ? 0.5 : -0.5), r: unit.position.r + (unit.isPlayer ? -1 : 1) };
  return directionToward(unit.position, toward) ?? (unit.isPlayer ? 1 : 4);
}

/** Whether a unit has a front at all: an objective does not, and is never flanked or turned. */
export function hasFacing(unit: CombatUnit): boolean {
  return !unit.objective;
}

/**
 * Which approach `attacker` strikes `target` from. Only an adjacent attacker can
 * flank; a unit with no facing is struck from the front whatever the hex.
 */
export function flankOf(attacker: CombatUnit, target: CombatUnit): Flank {
  if (target.facing === undefined || !hasFacing(target)) return 'front';
  if (hexDistance(attacker.position, target.position) !== 1) return 'front';
  const from = directionToward(target.position, attacker.position);
  if (from === null) return 'front';
  const turn = (from - target.facing + 6) % 6;
  if (turn === 3) return 'back';
  if (turn === 2 || turn === 4) return 'side';
  return 'front';
}

/** The damage multiplier of an approach. */
export function flankMultiplier(flank: Flank): number {
  if (flank === 'back') return BALANCE.BACKSTAB_MULTIPLIER;
  if (flank === 'side') return BALANCE.FLANK_MULTIPLIER;
  return 1;
}

/**
 * A melee skill, for the copy that names the flank: a weapon blow that lands on an
 * enemy beside the caster — a reach of one, or a dash or blink that closes first.
 * A spell is not one even when it strikes a neighbour, though the rule still pays
 * it: the copy names the rule where a player plans around it.
 */
export function strikesInMelee(skill: Pick<HeroSkill, 'damage' | 'scaling' | 'range' | 'selfMove'>): boolean {
  if (!skill.damage || skill.damage <= 0) return false;
  if (skill.scaling === 'magic') return false;
  return skill.range <= 1 || skill.selfMove?.kind === 'dash' || skill.selfMove?.kind === 'blink';
}

/** The hex behind a facing unit, then its two rear-side hexes. Empty for a unit with no facing. */
export function hexesBehind(target: CombatUnit): HexCoord[] {
  if (target.facing === undefined || !hasFacing(target)) return [];
  const around = getNeighbors(target.position);
  const f = target.facing;
  return [around[(f + 3) % 6], around[(f + 2) % 6], around[(f + 4) % 6]];
}

/**
 * Where a blink behind `target` lands (Flicker Cut, Mantis Execution, Marked
 * Prey): its back hex when free, else the free rear-side hex nearest `from`,
 * else nowhere. `free` is the caller's question, since only it knows who is
 * moving and what else bars a hex.
 */
export function landingBehind(
  target: CombatUnit,
  from: HexCoord,
  free: (hex: HexCoord) => boolean,
): HexCoord | undefined {
  const [back, ...sides] = hexesBehind(target);
  if (!back) return undefined;
  if (free(back)) return back;
  return sides
    .filter(free)
    .sort((a, b) => hexDistance(from, a) - hexDistance(from, b) || a.q - b.q || a.r - b.r)[0];
}

/**
 * The plain "can a body land here" question for `landingBehind`: in the arena,
 * no other living unit on it and no solid hazard over it.
 */
export function standableFor(
  moverId: string,
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[],
): (hex: HexCoord) => boolean {
  return (h) => inArena(h)
    && !units.some((u) => u.id !== moverId && u.currentHp > 0 && u.position.q === h.q && u.position.r === h.r)
    && !hazards.some((z) => z.solid && z.hexes.some((x) => x.q === h.q && x.r === h.r));
}
