import { findMovePath, getMovementRange } from '@/systems/combat/movement';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { resolveSelfMove } from '@/systems/combat/forcedMovement';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { useCombatStore } from '@/stores/combatStore';
import { charge } from '@/data/skills/skillData';
import { shadowstep } from '@/data/skills/masterySkills';
import { ArenaHazard, CombatUnit, HexCoord } from '@/models/types';
import { getHexLine, getNeighbors, hexDistance, hexKey } from '@/utils/hexUtils';
import { at, makeFoe, makeStats, makeUnit } from '../support/fixtures';

/**
 * Playtest 2026-10-09: a move walked straight through whoever stood on the
 * line (PT-03), and a dash landed on the Bonebound Warlord's rubble that a walk
 * could not enter (PT-09). A walk is now pathfound around every other body and
 * every solid hex, and no self-move lands on rubble.
 */

const hero = (position: HexCoord, moveRange = 3, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ position, stats: makeStats({ moveRange }), ...over });

const foe = (position: HexCoord, moveRange = 3, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeFoe({ position, stats: makeStats({ moveRange }), ...over });

const rubble = (...hexes: HexCoord[]): ArenaHazard => ({ id: 'rubble', hexes, solid: true, label: 'Rubble' });

const keys = (hexes: HexCoord[]) => new Set(hexes.map(hexKey));

/** Every step is to a neighbour, and none is onto a hex in `blocked`. */
function expectWalkable(path: HexCoord[], blocked: HexCoord[]) {
  const wall = keys(blocked);
  for (let i = 1; i < path.length; i++) {
    expect(hexDistance(path[i - 1], path[i])).toBe(1);
    expect(wall.has(hexKey(path[i]))).toBe(false);
  }
}

describe('walking is pathfound (PT-03)', () => {
  it('a unit walled in by bodies on every side cannot move at all', () => {
    const mover = hero(at(0, 0), 3);
    // Allies and enemies alike: any living body other than the mover blocks
    const ring = getNeighbors(at(0, 0)).map((h, i) => (i % 2 ? hero(h) : foe(h)));
    expect(getMovementRange(mover, [mover, ...ring])).toEqual([]);
    expect(findMovePath(mover, at(2, 0), [mover, ...ring])).toBeNull();
  });

  it('a hex just behind a body is reachable only by going around it, within the budget', () => {
    const blocker = foe(at(1, 0));
    const short = hero(at(0, 0), 2);
    // Two hexes away in a straight line, but the only two-step route crosses the body
    expect(keys(getMovementRange(short, [short, blocker])).has(hexKey(at(2, 0)))).toBe(false);
    expect(findMovePath(short, at(2, 0), [short, blocker])).toBeNull();

    const long = hero(at(0, 0), 3);
    expect(keys(getMovementRange(long, [long, blocker])).has(hexKey(at(2, 0)))).toBe(true);
    const path = findMovePath(long, at(2, 0), [long, blocker])!;
    expect(path).toHaveLength(4);
    expect(path[0]).toEqual(at(0, 0));
    expect(path[path.length - 1]).toEqual(at(2, 0));
    expectWalkable(path, [blocker.position]);
  });

  it('rubble blocks the route as well as the landing', () => {
    const mover = hero(at(0, 0), 2);
    const hazards = [rubble(at(1, 0))];
    expect(keys(getMovementRange(mover, [mover], hazards)).has(hexKey(at(2, 0)))).toBe(false);
    expect(keys(getMovementRange(mover, [mover], hazards)).has(hexKey(at(1, 0)))).toBe(false);
  });

  it('walks the straight line when nothing stands on it', () => {
    const mover = hero(at(0, 0), 3);
    expect(findMovePath(mover, at(3, -1), [mover])).toEqual(getHexLine(at(0, 0), at(3, -1)));
  });

  it('draws and burns along the route the walk took', () => {
    const mover = hero(at(0, 0), 3);
    const blocker = foe(at(1, 0));
    useCombatStore.setState({ units: [mover, blocker], hazards: [], currentUnitId: mover.id });
    const path = findMovePath(mover, at(2, 0), [mover, blocker])!;
    useCombatStore.getState().moveUnit(mover.id, at(2, 0), 'walk', undefined, undefined, path);
    const moved = useCombatStore.getState().units.find((u) => u.id === mover.id)!;
    expect(moved.position).toEqual(at(2, 0));
    expect(moved.movement?.path).toEqual(path);
  });
});

describe('the enemy AI walks by the same rule', () => {
  it('cannot move through a line of bodies', () => {
    // Boxed in by its own side: nothing to strike, nowhere to go
    const brute = foe(at(0, 0), 3, { skills: [] });
    const box = getNeighbors(at(0, 0)).map((h) => foe(h, 3, { skills: [] }));
    const prey = hero(at(0, -4));
    const units = [brute, ...box, prey];
    useCombatStore.setState({ units, hazards: [], currentUnitId: brute.id });
    expect(getMovementRange(brute, units)).toEqual([]);
    expect(decideEnemyAction(brute, units).some((a) => a.type === 'move')).toBe(false);
  });

  it('goes around a body in its way, and the walk is drawn along that route', () => {
    const brute = foe(at(0, 0), 3, { skills: [] });
    const blocker = foe(at(1, 0), 3, { skills: [] });
    const prey = hero(at(4, -2));
    const units = [brute, blocker, prey];
    useCombatStore.setState({ units, hazards: [], currentUnitId: brute.id });
    executeAIActions(brute, [{ type: 'move', targetPos: at(2, 0) }]);
    const moved = useCombatStore.getState().units.find((u) => u.id === brute.id)!;
    expect(moved.position).toEqual(at(2, 0));
    const path = moved.movement?.path;
    expect(path).toBeDefined();
    expect(path![0]).toEqual(at(0, 0));
    expect(path![path!.length - 1]).toEqual(at(2, 0));
    expectWalkable(path!, [blocker.position, prey.position]);
  });
});

describe('no self-move lands on rubble (PT-09)', () => {
  it('a dash whose nearest landing is rubble lands on another free hex beside its target', () => {
    const warrior = hero(at(0, 0));
    const target = foe(at(0, 3));
    const units = [warrior, target];
    const plain = resolveSelfMove(warrior, charge, target.position, units);
    expect(plain).not.toBeNull();
    const landing = resolveSelfMove(warrior, charge, target.position, units, [rubble(plain!)]);
    expect(landing).not.toBeNull();
    expect(landing).not.toEqual(plain);
    expect(hexDistance(landing!, target.position)).toBe(1);
  });

  it('a blink can neither be aimed at rubble nor land on it', () => {
    const caster = hero(at(0, 0), 3, { skills: [shadowstep] });
    const hazards = [rubble(at(2, 0))];
    expect(resolveSelfMove(caster, shadowstep, at(2, 0), [caster])).toEqual(at(2, 0));
    expect(resolveSelfMove(caster, shadowstep, at(2, 0), [caster], hazards)).toBeNull();
    const offered = keys(getValidSkillTargetHexes(shadowstep, caster, [caster], hazards));
    expect(offered.has(hexKey(at(2, 0)))).toBe(false);
    expect(offered.has(hexKey(at(2, -1)))).toBe(true);
  });
});
