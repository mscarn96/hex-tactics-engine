


import * as Crypto from '@/platform/uuid';


import { CombatUnit, HeroSkill, HexCoord, ArenaHazard } from '@/models/types';

import { getHexesInRange, hexDistance, hexDot, hexKey, hexToPixel } from '@/utils/hexUtils';


















// Exported because the scene draws the board and the scenery ring measures off
// it. Both used to hand-roll their own copies of these two numbers and the
// predicate below, which is three places that had to agree about how big the
// arena is with nothing keeping them in step.
export const ARENA_Q_MAX = 3;

export const ARENA_R_MAX = 5;

/** The six unit steps on a pointy-top axial grid, in order. */
export const HEX_DIRS: HexCoord[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];


/**
 * Which of the six directions an arc aimed at `targetPos` actually fires along.
 *
 * An arc does not go where you point: it snaps to the nearest hex axis, because
 * a widening wedge has to be built out of whole hexes. That snap used to live
 * inside `getSkillTargets` and nowhere else, so the effect drawn on screen was
 * free to disagree with it — and it did, by up to thirty degrees, which is half
 * the width of the wedge. The player aimed between two axes, the damage went one
 * way and the blast was drawn the other, and the whole skill read as firing in
 * some direction of its own choosing.
 *
 * Exported so the resolver, the highlight pass and the VFX all ask the same
 * question of the same function. Returns an index into `HEX_DIRS`.
 */
export function arcDirectionIndex(casterPos: HexCoord, targetPos: HexCoord): number {
  const d = { q: targetPos.q - casterPos.q, r: targetPos.r - casterPos.r };

  // Highest dot product against caster→target. Ties break to the lower index,
  // which is arbitrary but fixed — an aim exactly between two axes must not
  // depend on iteration order changing under an unrelated refactor.
  //
  // **`hexDot`, not `dq*Dq + dr*Dr`.** This multiplied the axial components as
  // though they were Cartesian for its whole existence, and they are not — see
  // `hexDot`. The effect was that aiming *directly* at the neighbour along
  // `(0,-1)` fired along `(1,-1)`, and `(0,1)` fired along `(-1,1)`: a full 60°
  // off, on two of the six axes, everywhere on the board. Two thirds of aims
  // were correct, which is why it read as the wedge occasionally going wherever
  // it liked rather than as a reproducible fault. It is also most of why a cone
  // was unusable against a target the caster was already beside.
  let bestIdx = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < HEX_DIRS.length; i++) {
    const dot = hexDot(d, HEX_DIRS[i]);
    if (dot > bestDot) { bestDot = dot; bestIdx = i; }
  }
  return bestIdx;
}


/**
 * The hex an arc is effectively aimed at — one step along the axis it snapped
 * to. What the wedge should point at, rather than the hex the player tapped.
 */
export function arcAimHex(casterPos: HexCoord, targetPos: HexCoord): HexCoord {
  const d = HEX_DIRS[arcDirectionIndex(casterPos, targetPos)];
  return { q: casterPos.q + d.q, r: casterPos.r + d.r };
}


/**
 * How deep an arc reaches, in hexes.
 *
 * `aoeRadius`, not `range` — and that swap is the point of the whole shape.
 * `Cone` sized itself off `range`, so an arc's reach and its footprint were one
 * number and `aoeRadius` was ignored entirely. Two consequences, both of which
 * this ends: authoring `aoeRadius` on one tuned nothing (a trap two skill files
 * carried an explicit warning comment about), and `applyMasteryModifiers` had to
 * *refuse* `skillRangeBonus` on cones, because widening the footprint is not
 * what a range node promises. `range` means range again now, like it does on
 * every other skill in the game.
 */
export function arcDepth(skill: Pick<HeroSkill, 'aoeRadius'>): number {
  return Math.max(1, skill.aoeRadius ?? 1);
}


/**
 * Cosine of the arc's half-angle. 0.5 is 60°, so the wedge is 120° wide.
 *
 * Chosen rather than derived: 60° is exactly one hex step off the axis, so the
 * three hexes adjacent to the caster in front of it are all included and the
 * three behind are all excluded. Anything narrower makes depth 1 a single hex —
 * a wedge that does not widen — and anything wider starts sweeping up the
 * caster's own flanks, which is a ring wearing a direction.
 */
const ARC_COS_HALF_ANGLE = 0.5;

/** Hexes sitting exactly on the 60° edge are inside it; this is float slack. */
const ARC_EPSILON = 1e-9;


/**
 * The wedge: every hex within `arcDepth` steps that lies within 60° of the aim.
 *
 * Distance and angle, rather than the lattice walk this replaced. The old
 * construction stepped `a` hexes forward and `b` hexes sideways and unioned the
 * two flanks, which at depth 2 produced a **four-hex rhombus** lying along a
 * diagonal — a shape that neither widens nor points, and the reason cone skills
 * read as arbitrary and went unpressed. Stated as "close enough, and roughly in
 * front", the footprint is what the word has always promised: 3 hexes at depth
 * 1, 8 at 2, 15 at 3, 24 at 4.
 *
 * The caster's own hex is never included — an arc comes *out* of a body — and
 * `inArena` trims it at the board edge, so firing along a wall is legal and
 * simply covers fewer hexes. That last part is a fix in its own right: the old
 * shape was thin enough that clipping it against the rim routinely left nothing
 * on the target, which is what "cones do not work at the edge" actually was.
 */
export function arcHexes(
  skill: Pick<HeroSkill, 'aoeRadius'>,
  casterPos: HexCoord,
  targetPos: HexCoord,
): HexCoord[] {
  const D = HEX_DIRS[arcDirectionIndex(casterPos, targetPos)];
  // √3 for all six, since every direction is one hex step — but measured rather
  // than written down, so a change to the basis cannot leave this behind.
  const dirLength = Math.sqrt(hexDot(D, D));

  return getHexesInRange(casterPos, arcDepth(skill)).filter((h) => {
    const d = { q: h.q - casterPos.q, r: h.r - casterPos.r };
    if (d.q === 0 && d.r === 0) return false;
    const length = Math.sqrt(hexDot(d, d));
    // cos θ = (d · D) / (|d||D|), and θ ≤ 60° ⟺ cos θ ≥ ½
    return hexDot(d, D) >= ARC_COS_HALF_ANGLE * length * dirLength - ARC_EPSILON
      && inArena(h);
  });
}


export const inArena = (h: HexCoord) =>
  Math.abs(h.q) <= ARENA_Q_MAX &&
  Math.abs(h.r) <= ARENA_R_MAX &&
  Math.abs(h.q + h.r) <= ARENA_R_MAX;


/**
 * Every hex on the board, built once.
 *
 * Derived from `inArena` rather than from the two constants a second time —
 * "which hexes are the arena" is a question with one answer, and a scatter
 * skill rolling over a board that had drifted from the one being drawn would
 * put bolts outside it.
 */
const ARENA_BOARD: HexCoord[] = (() => {
  const out: HexCoord[] = [];
  for (let q = -ARENA_Q_MAX; q <= ARENA_Q_MAX; q++) {
    for (let r = -ARENA_R_MAX; r <= ARENA_R_MAX; r++) {
      if (inArena({ q, r })) out.push({ q, r });
    }
  }
  return out;
})();


export const arenaHexes = (): readonly HexCoord[] => ARENA_BOARD;


/** The hexes a solid hazard (rubble) covers: no body may enter, cross or land on them. */
export const solidKeys = (hazards: readonly ArenaHazard[]): Set<string> => {
  const keys = new Set<string>();
  for (const h of hazards) if (h.solid) for (const hex of h.hexes) keys.add(hexKey(hex));
  return keys;
};


/**
 * The direction a beam fires along: the line from the caster through the aimed
 * hex, in board space, as a unit vector. Not snapped to an axis (playtest
 * 2026-10-14): the snap left six directions, and from a corner only the two or
 * three running along the walls or across at 30° held an enemy, so Absolute
 * Zero "could only pick weird angles".
 */
export function beamAxis(casterPos: HexCoord, targetPos: HexCoord): { x: number; y: number } {
  const a = hexToPixel(casterPos);
  const b = hexToPixel(targetPos);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/**
 * Half a beam's width in board units (`hexToPixel`'s, a hex's circumradius
 * being 1): a hex's centre within this of the beam's line is in it. 1.5 is the distance from an axis line to the rows either side
 * of it, so a beam along an axis is exactly the three rows it always was, and
 * one at any other angle is three hexes wide too.
 */
const BEAM_HALF_WIDTH = 1.5 + 1e-6;

/**
 * A beam three hexes wide, from beside the caster to the arena's edge, along
 * the line to the aimed hex (`beamAxis`): every arena hex ahead of the caster
 * whose centre lies within `BEAM_HALF_WIDTH` of that line. The caster's own hex
 * is never in it.
 */
export function beamHexes(casterPos: HexCoord, targetPos: HexCoord): HexCoord[] {
  const axis = beamAxis(casterPos, targetPos);
  const origin = hexToPixel(casterPos);
  return arenaHexes().filter((h) => {
    if (h.q === casterPos.q && h.r === casterPos.r) return false;
    const p = hexToPixel(h);
    const vx = p.x - origin.x;
    const vy = p.y - origin.y;
    const along = vx * axis.x + vy * axis.y;
    const across = Math.abs(vx * axis.y - vy * axis.x);
    return along > 0 && across <= BEAM_HALF_WIDTH;
  });
}


/**
 * An arena-wide skill's footprint: the hex of every living opponent of whoever
 * stands at `casterPos`, inside the playable arena. Bodies rather than ground,
 * so nothing downstream (the flash, the aftermath, the camera fit) is ever handed
 * an empty or off-board hex — the radius-9 ring this replaced was mostly both.
 * A caster that cannot be found is read as the player's side.
 */
export function arenaWideHexes(casterPos: HexCoord, allUnits: CombatUnit[], withAllies = false): HexCoord[] {
  const caster = allUnits.find(
    (u) => u.currentHp > 0 && u.position.q === casterPos.q && u.position.r === casterPos.r,
  );
  const side = caster?.isPlayer ?? true;
  return allUnits
    .filter((u) => u.currentHp > 0 && inArena(u.position)
      && (u.isPlayer !== side || (withAllies && !u.objective)))
    .map((u) => u.position);
}

/** The hexes within `radius` of `centre` that lie on the board. */
export const discAround = (centre: HexCoord, radius: number): HexCoord[] =>
  arenaHexes()
    .filter((h) => hexDistance(centre, h) <= radius)
    .map((h) => ({ q: h.q, r: h.r }));
