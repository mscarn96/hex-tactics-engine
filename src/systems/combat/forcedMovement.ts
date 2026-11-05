


import * as Crypto from '@/platform/uuid';


import { CombatUnit, HeroSkill, HexCoord, ArenaHazard } from '@/models/types';

import { hexDistance, getNeighbors, hexDot, hexKey } from '@/utils/hexUtils';

import { isRooted } from '@/systems/combat/statusEffects';

import { isImmuneToPush } from '@/systems/combat/passives';











import { inDuelCircle } from '@/systems/combat/duelRules';

import { inArena, solidKeys } from '@/systems/combat/arenaGeometry';



/**
 * The same six directions as `HEX_DIRS`, in a different order — and the order is
 * the whole reason this is a second list rather than a reuse.
 *
 * `HEX_DIRS` is *rotational*: index ±1 is a 60° neighbour, which is what lets an
 * arc fan out from its axis. This one is paired (+q/−q, +r/−r, then the
 * diagonals), and a push resolves by taking the highest dot product with ties
 * breaking to the lower index — so the order is load-bearing for exactly the
 * shoves that land between two directions. Switching this to rotational order
 * changes where seven pinned pushes end up.
 *
 * The ties are real and stay decided here: a target at 30°, 90° or 150° off the
 * caster is genuinely equidistant from two directions, and something has to
 * pick. What is *not* decided by the order is everything else — see `hexDot`.
 */
const PUSH_DIRS: HexCoord[] = [
  { q: 1, r: 0 }, { q: -1, r: 0 },
  { q: 0, r: 1 }, { q: 0, r: -1 },
  { q: 1, r: -1 }, { q: -1, r: 1 },
];


/** What stopped a forced move short. */
export type ForcedMoveBlock = 'boundary' | 'unit' | 'objective' | 'hazard';


/**
 * One body's forced move, traced hex by hex.
 *
 * The single answer to "where does this shove land": the player's skills, the
 * AI's, a warned preparation's preview and its resolution all read it, so a
 * landing hex drawn before a push and the position after it cannot disagree.
 */
export interface ForcedMove {
  unitId: string;
  from: HexCoord;
  /** Where it ends. Equal to `from` when nothing moved. */
  to: HexCoord;
  moved: boolean;
  /** Every hex entered, in order, ending at `to`. */
  path: HexCoord[];
  /** What stopped it before `distance` was spent, if anything did. */
  blockedBy?: { kind: ForcedMoveBlock; at: HexCoord; unitId?: string };
  /** Ids of the non-solid hazards on the path, in the order crossed — the last may be the landing. */
  hazardIds: string[];
}


/** The push axis that best matches `from` → `to`, or `null` when they coincide. */
export function pushDirection(origin: HexCoord, position: HexCoord): HexCoord | null {
  const away = { q: position.q - origin.q, r: position.r - origin.r };
  // A self-centred blast has no direction to push along
  if (away.q === 0 && away.r === 0) return null;

  // **`hexDot`, not `dq*Dq + dr*Dr`** — the same fault the arc's aim snap
  // carried, one system over, and it survived the same way: two thirds of
  // shoves were right. Axial coordinates are a skewed basis, so the naive form
  // drops the cross term and systematically over-weights the diagonals. A
  // target at 169° off the caster was shoved along 120° — 49° wrong against a
  // 60° wedge, which is a knockback that travels almost sideways rather than
  // away. 24 of the 120 vectors within five hexes resolved to the wrong
  // direction, and the ones that did were the wide-angle shoves where a player
  // is most likely to be counting on where the body lands.
  return PUSH_DIRS.reduce((best, d) => (hexDot(away, d) > hexDot(away, best) ? d : best));
}


const sameHex = (a: HexCoord, b: HexCoord) => a.q === b.q && a.r === b.r;


/**
 * Walks `target` away from `origin` for up to `distance` hexes.
 *
 * Stops *before* the first hex that is off the board, holds a living unit or an
 * objective, or sits in a solid hazard — that is the deterministic fallback for
 * a blocked destination: the last free hex on the line, or the starting hex if
 * the very first step is blocked. Nothing here can put a body on another or
 * outside the arena. Non-solid hazards are crossed and reported.
 *
 * `units` is the occupancy to respect; `previewForcedMoves` feeds it the
 * positions earlier shoves in the same blast have already taken.
 */
export function traceForcedMove(
  origin: HexCoord,
  target: CombatUnit,
  distance: number,
  units: CombatUnit[],
  hazards: ArenaHazard[] = [],
): ForcedMove {
  const stay: ForcedMove = {
    unitId: target.id, from: target.position, to: target.position,
    moved: false, path: [], hazardIds: [],
  };
  if (distance <= 0) return stay;
  // Immovable refuses knockback outright, which also covers a retreat the unit
  // would have made of its own accord — nothing shifts it either way
  if (isImmuneToPush(target)) return stay;

  const dir = pushDirection(origin, target.position);
  if (!dir) return stay;

  const occupant = (h: HexCoord) =>
    units.find((u) => u.id !== target.id && u.currentHp > 0 && sameHex(u.position, h));
  const hazardsAt = (h: HexCoord) =>
    hazards.filter((z) => z.hexes.some((zh) => sameHex(zh, h)));

  let pos = target.position;
  const path: HexCoord[] = [];
  const crossed: string[] = [];
  let blockedBy: ForcedMove['blockedBy'];

  for (let i = 0; i < distance; i++) {
    const next = { q: pos.q + dir.q, r: pos.r + dir.r };
    if (!inArena(next)) { blockedBy = { kind: 'boundary', at: next }; break; }
    // The rune circle is a wall to the two it holds, whatever shoves them
    if (!inDuelCircle(target, next)) { blockedBy = { kind: 'boundary', at: next }; break; }
    const other = occupant(next);
    if (other) {
      blockedBy = { kind: other.objective ? 'objective' : 'unit', at: next, unitId: other.id };
      break;
    }
    const here = hazardsAt(next);
    if (here.some((z) => z.solid)) { blockedBy = { kind: 'hazard', at: next }; break; }
    for (const z of here) if (!crossed.includes(z.id)) crossed.push(z.id);
    pos = next;
    path.push(next);
  }

  return {
    unitId: target.id, from: target.position, to: pos,
    moved: path.length > 0, path, blockedBy, hazardIds: crossed,
  };
}


/**
 * Where a knockback lands, or `null` if the target cannot be moved at all.
 *
 * Pushes along whichever of the six hex directions best matches the
 * caster→target vector — see `traceForcedMove` for what stops it — so a target
 * shoved into a wall or into another unit simply stays put.
 *
 * Lives here rather than in the scene because both the player path and
 * `executeAIActions` need it, and a knockback that behaves differently
 * depending on who threw the punch is a bug waiting to happen.
 */
export function resolvePush(
  casterPos: HexCoord,
  target: CombatUnit,
  distance: number,
  allUnits: CombatUnit[],
  hazards: ArenaHazard[] = [],
): HexCoord | null {
  const move = traceForcedMove(casterPos, target, distance, allUnits, hazards);
  return move.moved ? move.to : null;
}


/**
 * Every shove of one blast, in the order they will resolve, each seeing the
 * positions the ones before it left behind.
 *
 * The order is the caller's: the resolver passes its own strike order, a warned
 * preparation passes `forcedMoveOrder`'s. Sequential on purpose — two bodies
 * pushed down one line cannot both land on the same hex, and the one in front
 * must have moved before the one behind it is asked.
 */
export function previewForcedMoves(
  origin: HexCoord,
  targets: CombatUnit[],
  distance: number,
  units: CombatUnit[],
  hazards: ArenaHazard[] = [],
): ForcedMove[] {
  let occupancy = units;
  const moves: ForcedMove[] = [];
  for (const target of targets) {
    const move = traceForcedMove(origin, target, distance, occupancy, hazards);
    moves.push(move);
    if (move.moved) {
      occupancy = occupancy.map((u) => (u.id === target.id ? { ...u, position: move.to } : u));
    }
  }
  return moves;
}


/**
 * The deterministic resolution order for a blast with several bodies: furthest
 * from the origin first, so the front of a line clears the way for the ones
 * behind it; ties break by hex (q, then r). A preparation's preview and its resolution
 * both order by this, which is what lets the preview be trusted.
 */
export function forcedMoveOrder(origin: HexCoord, targets: CombatUnit[]): CombatUnit[] {
  return [...targets].sort(
    (a, b) =>
      hexDistance(origin, b.position) - hexDistance(origin, a.position) ||
      a.position.q - b.position.q ||
      a.position.r - b.position.r,
  );
}


/**
 * A gap-closer aimed at something already within reach.
 *
 * `resolveSelfMove` answers "where does the caster end up", and `null` is two
 * opposite answers to that: every hex beside the target is taken, and the
 * caster is already standing in one of them. The first is a refusal, the second
 * is an ordinary melee attack — a charge used against an adjacent enemy simply
 * skips the charging. Told apart here rather than at each call site so the
 * resolver and the highlight pass cannot disagree about whether the skill is
 * usable, which is exactly how the board came to offer a hex that then refused.
 */
export function dashGapClosed(
  caster: CombatUnit,
  skill: HeroSkill,
  targetCoord: HexCoord,
): boolean {
  return skill.selfMove?.kind === 'dash' && hexDistance(caster.position, targetCoord) <= 1;
}


/**
 * Where a `selfMove` skill puts its caster, or `null` to leave it standing.
 *
 * Pure, and shared by both execution paths for the same reason `resolvePush` is:
 * knockback silently did nothing on the enemy side for a while because only one
 * path implemented it, and a dash that works for the player but not the AI would
 * be the same bug wearing a different hat.
 *
 * `dash` and `blink` resolve *before* the strike, so the skill's targets are
 * computed from where the caster ends up; `retreat` resolves after.
 */
export function resolveSelfMove(
  caster: CombatUnit,
  skill: HeroSkill,
  targetCoord: HexCoord,
  allUnits: CombatUnit[],
  /**
   * The arena's hazards. Solid rubble is never a landing: a dash picks another
   * hex beside its target, a blink or a named hex onto it is refused, and a
   * withdrawal stops short of it as a shove does. Omitted, nothing is solid.
   */
  hazards: ArenaHazard[] = [],
): HexCoord | null {
  const spec = skill.selfMove;
  if (!spec || spec.range <= 0) return null;

  // Root pins the unit in place however the skill dresses the movement up — a
  // dash, a blink, a named hex or a withdrawal are all the caster leaving the
  // hex it is standing on. The check lives *here*, in the one shared resolver,
  // rather than at the call sites: `getMovementRange` already refuses the Move
  // button, and the player path, `executeAIActions` and the highlight pass all
  // come through this function, so all three inherit it. Knockback spent a
  // version implemented on only one path; a Root that only bound the player
  // would be the same bug wearing a different hat.
  if (isRooted(caster)) return null;

  const occupied = (h: HexCoord) =>
    allUnits.some(
      (u) => u.id !== caster.id && u.currentHp > 0 && u.position.q === h.q && u.position.r === h.r
    );
  const solid = solidKeys(hazards);
  const usable = (h: HexCoord) => inArena(h) && !occupied(h) && !solid.has(hexKey(h)) && inDuelCircle(caster, h);

  if (spec.kind === 'retreat' && spec.landAt !== undefined) {
    return perchNear(caster, targetCoord, spec.landAt, allUnits, usable);
  }

  if (spec.kind === 'retreat') {
    // Withdrawing from a target is a push applied to yourself, away from it
    return resolvePush(targetCoord, caster, spec.range, allUnits, hazards);
  }

  if (spec.kind === 'free' && skill.allyShare && occupied(targetCoord)) {
    // Aimed at a body, a `free` move that allows allies closes on it like a dash:
    // beside the ally, nearest hex first. Anything but an ally is refused.
    const body = allUnits.find(
      (u) => u.id !== caster.id && u.currentHp > 0 &&
        u.position.q === targetCoord.q && u.position.r === targetCoord.r,
    );
    if (!body || body.isPlayer !== caster.isPlayer) return null;
    return nearestLanding(caster, targetCoord, spec.range, usable);
  }

  if (spec.kind === 'free') {
    // Named destination, no target to anchor to. Unlike a blink this is the
    // whole skill rather than the approach to a strike, so it refuses rather
    // than landing the player somewhere they did not choose.
    if (!usable(targetCoord)) return null;
    if (hexDistance(caster.position, targetCoord) > spec.range) return null;
    return targetCoord;
  }

  if (spec.kind === 'blink') {
    // The destination hex itself — so a blink onto an occupied hex fails rather
    // than silently landing somewhere the player did not pick
    if (!usable(targetCoord)) return null;
    if (hexDistance(caster.position, targetCoord) > spec.range) return null;
    return targetCoord;
  }

  // dash: the closest free hex adjacent to the target, ties broken deterministically
  const landing = nearestLanding(caster, targetCoord, spec.range, usable);
  if (!landing) return null;
  return landing.q === caster.position.q && landing.r === caster.position.r ? null : landing;
}


/** The free hex beside `targetCoord` that is closest to the caster and within `range`. */
/**
 * Where a `landAt` withdrawal settles: a free hex exactly `distance` from the
 * target, the nearest to the caster, then the farthest from any other enemy,
 * then a fixed order so the preview and the landing agree. Null when the caster
 * already stands at that distance or nothing at it is free.
 */
function perchNear(
  caster: CombatUnit,
  target: HexCoord,
  distance: number,
  allUnits: CombatUnit[],
  usable: (h: HexCoord) => boolean,
): HexCoord | null {
  if (hexDistance(caster.position, target) === distance) return null;
  const foes = allUnits.filter((u) => u.currentHp > 0 && u.isPlayer !== caster.isPlayer
    && !(u.position.q === target.q && u.position.r === target.r));
  const ring: HexCoord[] = [];
  for (let q = -distance; q <= distance; q++) {
    for (let r = Math.max(-distance, -q - distance); r <= Math.min(distance, -q + distance); r++) {
      const h = { q: target.q + q, r: target.r + r };
      if (hexDistance(h, target) === distance && usable(h)) ring.push(h);
    }
  }
  const clearance = (h: HexCoord) => foes.reduce((m, f) => Math.min(m, hexDistance(h, f.position)), Infinity);
  ring.sort((a, b) =>
    hexDistance(caster.position, a) - hexDistance(caster.position, b)
    || clearance(b) - clearance(a)
    || a.q - b.q || a.r - b.r);
  return ring[0] ?? null;
}

function nearestLanding(
  caster: CombatUnit,
  targetCoord: HexCoord,
  range: number,
  usable: (h: HexCoord) => boolean,
): HexCoord | null {
  return getNeighbors(targetCoord)
    .filter(usable)
    .filter((h) => hexDistance(caster.position, h) <= range)
    .sort((a, b) => {
      const byDistance =
        hexDistance(caster.position, a) - hexDistance(caster.position, b);
      // Ties must not depend on neighbour enumeration order, or the same board
      // would dash somewhere different after an unrelated refactor
      return byDistance !== 0 ? byDistance : a.q - b.q || a.r - b.r;
    })[0] ?? null;
}


/**
 * Whether a `selfMove` skill aimed at this hex is one the resolver would refuse.
 *
 * `resolveSelfMove` returning `null` is two opposite answers — see
 * `dashGapClosed` — so this is the question every call site actually wants:
 * "would the approach happen, or is there no approach left to make". Written
 * once because four places have to agree about it, and they did not: the board
 * offered a charge at a target hemmed in on all six sides and the resolver then
 * said "No way in", while `enemyAI` scored the same cast and landed its melee
 * damage from three hexes away without moving at all.
 *
 * `retreat` is never blocked. It is always a rider on a strike — Ghost Touch,
 * Dive, Hit and Run, Disengage's cousin — so a caster who cannot withdraw still
 * hits; only the withdrawal is dropped, which `resolveSelfMove` already does by
 * returning `null`.
 */
export function selfMoveBlocked(
  caster: CombatUnit,
  skill: HeroSkill,
  targetCoord: HexCoord,
  allUnits: CombatUnit[],
  hazards: ArenaHazard[] = [],
): boolean {
  const kind = skill.selfMove?.kind;
  if (!kind || kind === 'retreat') return false;
  if (resolveSelfMove(caster, skill, targetCoord, allUnits, hazards)) return false;
  // A gap-closer aimed at somebody already adjacent covers no ground, so there
  // is nothing for a Root — or a full ring of bodies — to prevent. It lands as
  // the melee attack it ends in.
  return !dashGapClosed(caster, skill, targetCoord);
}


/**
 * A skill whose `selfMove` *is* the skill, so a caster who cannot move cannot
 * cast it at all.
 *
 * `free` and `blink` both name an exact destination and compute their whole
 * payload from it: Disengage heals the hex it lands on (which is the caster),
 * Thunderstep's ring is centred on the landing hex, Shadowstep's Stealth is
 * placed on whoever is standing there once the blink has resolved. Cast from a
 * standstill they are a different skill, not a weaker one.
 *
 * `dash` is deliberately absent — a charge at an adjacent enemy is an ordinary
 * swing — and so is `retreat`, which only ever rides on a strike. Both are
 * decided per hex by `selfMoveBlocked` instead.
 */
export function selfMoveIsThePoint(skill: HeroSkill): boolean {
  // Slip the Net takes the Root off before it moves, so a Root never stops it
  if (skill.slipsBonds) return false;
  const kind = skill.selfMove?.kind;
  return kind === 'free' || kind === 'blink';
}
