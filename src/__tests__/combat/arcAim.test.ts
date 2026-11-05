import { ARENA_Q_MAX, ARENA_R_MAX, arcAimHex, arcDirectionIndex, arcHexes, HEX_DIRS, inArena } from '@/systems/combat/arenaGeometry';
import { getSkillTargets } from '@/systems/combat/targeting';
import { HexCoord, SkillTargetType } from '@/models/types';
import { hexDistance, hexDot, hexKey } from '@/utils/hexUtils';
import { makeSkill } from '../support/fixtures';

/**
 * An arc does not go where you point.
 *
 * It snaps to the nearest of the six hex axes, because a widening wedge has to
 * be built out of whole hexes. That is fine — what was not fine is that the snap
 * lived inside `getSkillTargets` and nowhere else, so the wedge drawn on screen
 * and the caster's own facing were both free to use the raw aim, and did.
 *
 * These pin two things: everything that draws or turns asks the same function
 * the damage asks, and that function answers correctly.
 */

const at = (q: number, r: number): HexCoord => ({ q, r });
const arc = (depth: number) =>
  makeSkill({
    id: 'wing_thrust',
    targetType: SkillTargetType.Arc,
    range: 4,
    aoeRadius: depth,
    damage: 1,
  });

const everyArenaHex = (): HexCoord[] => {
  const out: HexCoord[] = [];
  for (let q = -ARENA_Q_MAX; q <= ARENA_Q_MAX; q++) {
    for (let r = -ARENA_R_MAX; r <= ARENA_R_MAX; r++) {
      if (inArena(at(q, r))) out.push(at(q, r));
    }
  }
  return out;
};

describe('arc direction', () => {
  /**
   * The regression for the bug this shape inherited and carried for its whole
   * life.
   *
   * `arcDirectionIndex` picked its axis with `dq*Dq + dr*Dr`, which is not a dot
   * product: axial coordinates are a skewed basis, so that form drops the cross
   * term and reports `(0,1)·(0,1)` and `(0,1)·(-1,1)` as an equal 1. The tie
   * broke to the lower index and the wedge fired 60° off. Two of the six
   * directions were wrong, everywhere on the board, on every cone skill.
   *
   * Aiming *directly* at a neighbour is the case a player cannot misread, so it
   * is the case worth pinning: point at that hex, fire at that hex.
   */
  it('fires at the neighbour it is aimed at, on all six axes', () => {
    const offenders: string[] = [];
    for (const caster of everyArenaHex()) {
      for (const d of HEX_DIRS) {
        const target = at(caster.q + d.q, caster.r + d.r);
        if (!inArena(target)) continue;
        const fired = HEX_DIRS[arcDirectionIndex(caster, target)];
        if (fired.q !== d.q || fired.r !== d.r) {
          offenders.push(`${hexKey(caster)} aimed ${d.q},${d.r} fired ${fired.q},${fired.r}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('snaps to a real hex axis, never to the hex that was tapped', () => {
    // Deliberately between two axes: +q and +q−r are both one step away from
    // this direction, which is exactly the case the raw angle got wrong.
    const aim = arcAimHex(at(0, 0), at(3, -1));
    expect(HEX_DIRS.some((d) => d.q === aim.q && d.r === aim.r)).toBe(true);
  });

  it('gives the same answer to everyone who asks', () => {
    const caster = at(1, 1);
    const target = at(4, -1);
    const d = HEX_DIRS[arcDirectionIndex(caster, target)];
    expect(arcAimHex(caster, target)).toEqual({ q: caster.q + d.q, r: caster.r + d.r });
  });

  /**
   * The assertion that ties the picture to the damage: the hex the wedge points
   * at has to be one the arc burns. If those two ever disagree again this fails,
   * rather than a player noticing.
   */
  it('always points at a hex the arc actually covers', () => {
    const caster = at(0, 0);
    const offenders: string[] = [];
    for (let q = -4; q <= 4; q++) {
      for (let r = -4; r <= 4; r++) {
        if (q === 0 && r === 0) continue;
        if (!inArena(at(q, r))) continue;
        const covered = new Set(getSkillTargets(arc(3), caster, at(q, r), []).map(hexKey));
        const aim = arcAimHex(caster, at(q, r));
        if (!covered.has(hexKey(aim))) offenders.push(`${q},${r}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * `HEX_DIRS` is rotational — index ±1 is a 60° neighbour. Nothing builds the
   * wedge by stepping to those neighbours any more, but the facing arithmetic
   * and `resolvePush` still read the table, and a reordering would be silent.
   */
  it('keeps the direction table in rotational order', () => {
    const offenders: string[] = [];
    for (let i = 0; i < HEX_DIRS.length; i++) {
      const a = HEX_DIRS[i];
      const b = HEX_DIRS[(i + 1) % 6];
      // Two unit directions are 60° apart exactly when their difference is
      // itself a unit step.
      const diff = { q: a.q - b.q, r: a.r - b.r };
      if (!HEX_DIRS.some((d) => d.q === diff.q && d.r === diff.r)) {
        offenders.push(`${i}->${(i + 1) % 6}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The arithmetic underneath all of the above, stated on its own.
   *
   * Every one of the six directions is a single hex step, so all six must
   * measure the same length — which the naive axial form does not give: it
   * reports `(1,0)` and `(0,1)` as 1 while `(1,-1)` comes out 2.
   */
  it('measures all six directions as the same length', () => {
    const lengths = HEX_DIRS.map((d) => hexDot(d, d));
    expect(lengths.every((l) => Math.abs(l - lengths[0]) < 1e-9)).toBe(true);
  });
});

describe('arc footprint', () => {
  /**
   * The sizes the whole retune was priced against. A depth that quietly changed
   * what it covers would move nine skills at once with nothing failing.
   *
   * Fired along +q from the west rim — the arena is 11 rows deep in `r` against
   * 7 columns in `q`, so this is the axis with room for even a depth-4 wedge to
   * open without the board taking a bite out of it.
   */
  it.each([[1, 3], [2, 8], [3, 15], [4, 24]])(
    'covers depth %i as %i hexes in open ground',
    (depth, expected) => {
      expect(arcHexes({ aoeRadius: depth }, at(-3, 0), at(-2, 0))).toHaveLength(expected);
    },
  );

  /**
   * **How often a wedge opens fully depends on the axis, and depth 3 is the last
   * one that usually does.** A depth-`d` arc is `2d + 1` hexes across at its far
   * edge, and the arena is not square: `ARENA_Q_MAX` is 3 against `ARENA_R_MAX`
   * 5. Fired across the short axis, a deep wedge runs out of board.
   *
   * The generous retune tops out at depth 3 for exactly this reason. Nothing
   * ships at 4, and anything that did would deliver its full footprint from only
   * a minority of the positions a unit can stand in — a shortfall a playtest
   * reads as "that skill feels inconsistent" rather than as a bug.
   */
  it('opens a depth-3 wedge far more reliably than a depth-4 one', () => {
    const openings = (depth: number, full: number) =>
      everyArenaHex().flatMap((caster) =>
        HEX_DIRS.filter(
          (d) => arcHexes({ aoeRadius: depth }, caster, at(caster.q + d.q, caster.r + d.r)).length === full,
        ),
      ).length;
    expect(openings(3, 15)).toBeGreaterThan(openings(4, 24) * 2);
  });

  it('never includes the caster', () => {
    const offenders: string[] = [];
    for (const caster of everyArenaHex()) {
      for (const d of HEX_DIRS) {
        const hexes = arcHexes({ aoeRadius: 3 }, caster, at(caster.q + d.q, caster.r + d.r));
        if (hexes.some((h) => h.q === caster.q && h.r === caster.r)) offenders.push(hexKey(caster));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('stays inside the arena and inside its own depth', () => {
    const offenders: string[] = [];
    for (const caster of everyArenaHex()) {
      for (const d of HEX_DIRS) {
        for (const h of arcHexes({ aoeRadius: 3 }, caster, at(caster.q + d.q, caster.r + d.r))) {
          if (!inArena(h)) offenders.push(`${hexKey(caster)} -> ${hexKey(h)} off board`);
          if (hexDistance(caster, h) > 3) offenders.push(`${hexKey(caster)} -> ${hexKey(h)} too deep`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The playtest report that started this: standing against the rim, a cone
   * could not be used at all. Clipping against the board is legitimate — the
   * wedge simply covers fewer hexes — but it must never clip to *nothing* while
   * an enemy is standing right there in front of the caster.
   */
  it('reaches an adjacent enemy from anywhere, including the rim', () => {
    const offenders: string[] = [];
    for (const caster of everyArenaHex()) {
      for (const d of HEX_DIRS) {
        const enemy = at(caster.q + d.q, caster.r + d.r);
        if (!inArena(enemy)) continue;
        const covered = arcHexes({ aoeRadius: 2 }, caster, enemy);
        if (!covered.some((h) => h.q === enemy.q && h.r === enemy.r)) {
          offenders.push(`${hexKey(caster)} -> ${hexKey(enemy)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Symmetry about the axis is what makes the snap survivable: an aim landing on
   * the wrong side of a 30° boundary moves the wedge, but never by more than the
   * wedge's own half-width. The lattice shape this replaced had no such
   * guarantee, which is why a snap slid it clean off its target.
   */
  it('is symmetric about the axis it fires along', () => {
    // Centred, so the arena's own hexagonal clipping is symmetric too
    const covered = arcHexes({ aoeRadius: 3 }, at(0, 0), at(1, 0));
    // Reflecting across the +q axis on a pointy-top grid swaps the two off-axis
    // components: (q, r) -> (q + r, -r)
    const mirrored = covered.map((h) => hexKey({ q: h.q + h.r, r: -h.r }));
    expect(covered.map(hexKey).sort()).toEqual(mirrored.sort());
  });
});
