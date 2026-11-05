import { resolvePush } from '@/systems/combat/forcedMovement';
import { inArena } from '@/systems/combat/arenaGeometry';
import { CombatUnit, HexCoord } from '@/models/types';
import { hexKey, hexDistance } from '@/utils/hexUtils';
import { makeStats, makeUnit } from '../support/fixtures';

const unit = (id: string, position: HexCoord, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({
    id, isPlayer: false, position,
    stats: makeStats({ maxHp: 40, attack: 8, defense: 3, magic: 0, moveRange: 2, maxMana: 0 }),
    ...over,
  });

const origin: HexCoord = { q: 0, r: 0 };

describe('resolvePush', () => {
  it('shoves the target directly away from the caster', () => {
    const target = unit('t', { q: 1, r: 0 });
    expect(resolvePush(origin, target, 1, [target])).toEqual({ q: 2, r: 0 });
  });

  it('travels the full distance when nothing is in the way', () => {
    const target = unit('t', { q: 0, r: 1 });
    expect(resolvePush(origin, target, 3, [target])).toEqual({ q: 0, r: 4 });
  });

  it('stops at the arena edge rather than shoving into the void', () => {
    const target = unit('t', { q: 2, r: 0 });
    const landed = resolvePush(origin, target, 5, [target])!;
    expect(inArena(landed)).toBe(true);
    expect(landed).toEqual({ q: 3, r: 0 });
  });

  it('stops short when another unit blocks the path', () => {
    const target = unit('t', { q: 0, r: 1 });
    const blocker = unit('b', { q: 0, r: 3 });
    expect(resolvePush(origin, target, 4, [target, blocker])).toEqual({ q: 0, r: 2 });
  });

  it('passes through a corpse, which no longer occupies its hex', () => {
    const target = unit('t', { q: 0, r: 1 });
    const dead = unit('d', { q: 0, r: 2 }, { currentHp: 0 });
    expect(resolvePush(origin, target, 2, [target, dead])).toEqual({ q: 0, r: 3 });
  });

  it('returns null when the target cannot move at all', () => {
    const target = unit('t', { q: 0, r: 1 });
    const blocker = unit('b', { q: 0, r: 2 });
    expect(resolvePush(origin, target, 2, [target, blocker])).toBeNull();
  });

  it('returns null for a self-centred blast, which has no push direction', () => {
    const target = unit('t', origin);
    expect(resolvePush(origin, target, 2, [target])).toBeNull();
  });

  it('returns null for zero or negative distance', () => {
    const target = unit('t', { q: 1, r: 0 });
    expect(resolvePush(origin, target, 0, [target])).toBeNull();
    expect(resolvePush(origin, target, -1, [target])).toBeNull();
  });

  it('always increases the distance from the caster', () => {
    // Sweep every hex around the arena: a push must never pull
    for (let q = -3; q <= 3; q++) {
      for (let r = -5; r <= 5; r++) {
        const at = { q, r };
        if (!inArena(at) || (q === 0 && r === 0)) continue;
        const target = unit('t', at);
        const landed = resolvePush(origin, target, 2, [target]);
        if (!landed) continue;
        expect({
          from: hexKey(at),
          farther: hexDistance(origin, landed) > hexDistance(origin, at),
        }).toEqual({ from: hexKey(at), farther: true });
      }
    }
  });

  /**
   * **A shove goes the way the blow was thrown, to within half a wedge.**
   *
   * Every case above puts the target on an exact axis, where the arithmetic was
   * already right — so the suite was fully green while `resolvePush` picked its
   * direction with `dq*Dq + dr*Dr`, which is not a dot product on a skewed
   * basis. It drops the cross term and over-weights the diagonals: a target at
   * 169° off the caster was shoved along 120°, **49° wrong against a 60° wedge**,
   * which lands a body almost sideways rather than away. 24 of the 120 vectors
   * within five hexes resolved to the wrong direction and nothing failed,
   * because "the push increased the distance" is true of a wrong direction too.
   *
   * The six directions are 60° apart, so the nearest to any bearing is always
   * within 30° of it. That is the whole property, it holds for every hex on the
   * board, and it is what a table of pinned landings cannot say.
   */
  it('picks the closest of the six directions to the true bearing', () => {
    const bearing = (h: HexCoord) =>
      Math.atan2(1.5 * h.r, Math.sqrt(3) * (h.q + h.r / 2));
    /** Smallest angle between two bearings, in degrees. */
    const apart = (a: number, b: number) => {
      const raw = Math.abs(a - b) * (180 / Math.PI);
      return raw > 180 ? 360 - raw : raw;
    };

    const offenders: string[] = [];
    let measured = 0;

    for (let q = -3; q <= 3; q++) {
      for (let r = -5; r <= 5; r++) {
        const at = { q, r };
        if (!inArena(at) || (q === 0 && r === 0)) continue;
        const target = unit('t', at);
        // One step, so the landing hex *is* the direction that was chosen
        const landed = resolvePush(origin, target, 1, [target]);
        if (!landed) continue; // shoved into the rim; nothing to measure

        measured += 1;
        const chosen = { q: landed.q - at.q, r: landed.r - at.r };
        const error = apart(bearing(chosen), bearing(at));
        // Half a wedge, plus float slack for the exact 30° ties
        if (error > 30.0001) {
          offenders.push(`${hexKey(at)}: pushed ${error.toFixed(0)}° off the bearing`);
        }
      }
    }

    expect(offenders).toEqual([]);
    // 38 of the arena's 60 non-origin hexes; the rest are shoved into the rim
    // and return null. Guarded so a change that quietly stopped measuring most
    // of the board could not pass this vacuously.
    expect(measured).toBeGreaterThanOrEqual(35);
  });
});
