import { ArenaHazard, CombatUnit, HeroSkill, HexCoord, SkillTargetType } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { arenaHexes, inArena } from '@/systems/combat/arenaGeometry';
import { forcedMoveOrder, previewForcedMoves, resolvePush, traceForcedMove } from '@/systems/combat/forcedMovement';
import { requireUnit } from '@/systems/combat/unitLookup';
import { previewPrepared } from '@/systems/combat/preparedAttacks';
import { createObjective } from '@/systems/combat/objectives';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { beginTurn } from '@/systems/combat/turnStart';
import { hexKey } from '@/utils/hexUtils';
import { at, makeFoe, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * Forced movement has one answer to "where does this body land", shared by the
 * player's skills, the AI's, and a warned attack's preview and resolution. What
 * is pinned is the contract — never off the board, never on a living body, a
 * deterministic stop when blocked, and a preview that is the resolution — not
 * the particular hexes.
 */

const origin = at(0, 0);

const body = (id: string, position: HexCoord, over: Partial<CombatUnit> = {}) =>
  makeUnit({ id, name: id, isPlayer: true, heroId: id, position, ...over });

const rubble = (hexes: HexCoord[], solid = true): ArenaHazard => ({
  id: solid ? 'rubble' : 'fire', hexes, solid, label: solid ? 'Rubble' : 'Fire',
});

describe('where a push stops', () => {
  it('stops at the boundary on the last hex inside it', () => {
    const t = body('t', at(2, 0));
    const move = traceForcedMove(origin, t, 5, [t]);

    expect(move.to).toEqual(at(3, 0));
    expect(inArena(move.to)).toBe(true);
    expect(move.blockedBy?.kind).toBe('boundary');
  });

  it('stops short of a living unit and names it', () => {
    const t = body('t', at(0, 1));
    const wall = makeFoe({ id: 'wall', position: at(0, 3) });
    const move = traceForcedMove(origin, t, 4, [t, wall]);

    expect(move.to).toEqual(at(0, 2));
    expect(move.blockedBy).toMatchObject({ kind: 'unit', unitId: 'wall' });
  });

  it('tells an objective from a unit', () => {
    const t = body('t', at(0, 1));
    const standard = createObjective({
      kind: 's', name: 'Standard', owner: makeFoe({ id: 'o' }), position: at(0, 2), hp: 5,
    });
    const move = traceForcedMove(origin, t, 3, [t, standard]);

    expect(move.moved).toBe(false);
    expect(move.blockedBy?.kind).toBe('objective');
  });

  it('is stopped by solid ground and crosses ground that is not', () => {
    const t = body('t', at(0, 1));
    const solid = traceForcedMove(origin, t, 4, [t], [rubble([at(0, 3)])]);
    expect(solid.to).toEqual(at(0, 2));
    expect(solid.blockedBy).toMatchObject({ kind: 'hazard', at: at(0, 3) });

    const fire = traceForcedMove(origin, t, 3, [t], [rubble([at(0, 2), at(0, 3)], false)]);
    expect(fire.to).toEqual(at(0, 4));
    expect(fire.hazardIds).toEqual(['fire']);
  });

  it('reports landing on a hazard as well as crossing one', () => {
    const t = body('t', at(0, 1));
    const move = traceForcedMove(origin, t, 1, [t], [rubble([at(0, 2)], false)]);
    expect(move.to).toEqual(at(0, 2));
    expect(move.hazardIds).toEqual(['fire']);
  });

  it('leaves a blocked first step where it stands, deterministically', () => {
    const t = body('t', at(0, 1));
    const wall = makeFoe({ id: 'wall', position: at(0, 2) });
    const a = traceForcedMove(origin, t, 3, [t, wall]);
    const b = traceForcedMove(origin, t, 3, [wall, t]);

    expect(a.to).toEqual(t.position);
    expect(a.moved).toBe(false);
    expect(b).toEqual(a);
  });

  it('passes through a corpse, which no longer occupies its hex', () => {
    const t = body('t', at(0, 1));
    const corpse = makeFoe({ id: 'c', position: at(0, 2), currentHp: 0 });
    expect(traceForcedMove(origin, t, 2, [t, corpse]).to).toEqual(at(0, 3));
  });

  it('is what resolvePush returns, null when nothing moved', () => {
    const t = body('t', at(1, 0));
    expect(resolvePush(origin, t, 2, [t])).toEqual(traceForcedMove(origin, t, 2, [t]).to);
    const wall = makeFoe({ id: 'wall', position: at(2, 0) });
    expect(resolvePush(origin, t, 2, [t, wall])).toBeNull();
  });
});

describe('never overlaps and never escapes', () => {
  /** A small deterministic generator, so a failure is the same failure next run. */
  const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  it('over random crowded boards, every landing is free, in the arena and off solid ground', () => {
    const rng = seeded(7);
    const board = arenaHexes();

    for (let round = 0; round < 200; round++) {
      const used = new Set<string>([hexKey(origin)]);
      const take = () => {
        for (;;) {
          const h = board[Math.floor(rng() * board.length)];
          if (!used.has(hexKey(h))) { used.add(hexKey(h)); return h; }
        }
      };
      const targets = Array.from({ length: 2 + Math.floor(rng() * 5) }, (_, i) => body(`t${i}`, take()));
      const bystanders = Array.from({ length: 3 }, (_, i) => makeFoe({ id: `f${i}`, position: take() }));
      const solid = rubble([take(), take()]);
      const everyone = [...targets, ...bystanders];

      const moves = previewForcedMoves(
        origin, forcedMoveOrder(origin, targets), 1 + Math.floor(rng() * 3), everyone, [solid],
      );

      const finals = new Map<string, HexCoord>(everyone.map((u) => [u.id, u.position]));
      for (const m of moves) finals.set(m.unitId, m.to);
      const occupied = [...finals.values()].map(hexKey);

      expect(new Set(occupied).size).toBe(occupied.length);
      for (const m of moves) {
        expect(inArena(m.to)).toBe(true);
        expect(solid.hexes.some((h) => hexKey(h) === hexKey(m.to))).toBe(false);
      }
    }
  });

  it('lets the front of a line clear the way for the one behind it', () => {
    const front = body('front', at(0, 1));
    const back = body('back', at(0, 2));
    // Resolved front-most first: both travel
    const ordered = forcedMoveOrder(origin, [front, back]);
    expect(ordered.map((u) => u.id)).toEqual(['back', 'front']);
    const moves = previewForcedMoves(origin, ordered, 1, [front, back]);

    expect(moves.map((m) => [m.unitId, m.to])).toEqual([
      ['back', at(0, 3)],
      ['front', at(0, 2)],
    ]);
  });

  it('orders the same however the targets arrive', () => {
    const a = body('a', at(1, 0));
    const b = body('b', at(-1, 0));
    const c = body('c', at(0, 2));
    const one = forcedMoveOrder(origin, [a, b, c]).map((u) => u.id);
    const two = forcedMoveOrder(origin, [c, b, a]).map((u) => u.id);
    expect(two).toEqual(one);
  });
});

describe('a warned push is previewed exactly', () => {
  const sweep = (over: Partial<HeroSkill> = {}): HeroSkill =>
    makeSkill({
      id: 'test_sweep' as HeroSkill['id'],
      name: 'Test Sweep',
      targetType: SkillTargetType.Ring,
      range: 0,
      aoeRadius: 2,
      damage: 1,
      pushDistance: 2,
      prepares: {},
      ...over,
    });

  const seeded = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  it('over random layouts, each hero lands where the preview said', () => {
    const rng = seeded(11);
    const ring = arenaHexes().filter((h) => {
      const d = Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r));
      return d >= 1 && d <= 2;
    });

    for (let round = 0; round < 60; round++) {
      const store = useCombatStore.getState();
      store.reset();
      const pool = [...ring];
      const pick = () => pool.splice(Math.floor(rng() * pool.length), 1)[0];
      const heroes = Array.from({ length: 2 + Math.floor(rng() * 4) }, (_, i) =>
        body(`h${i}`, pick(), { stats: makeStats({ maxHp: 9999, speed: 5, dodgeChance: 0 }) }));
      const hazards: ArenaHazard[] = rng() < 0.5 ? [rubble([pick()])] : [];

      store.initCombat(heroes, [makeFoe({
        id: 'boss', position: origin, skills: [sweep()],
        stats: makeStats({ maxHp: 999, speed: 30, attack: 10, critChance: 0 }),
      })]);
      hazards.forEach((h) => store.addHazard(h));
      useCombatStore.setState({ currentUnitId: 'boss' });

      resolveSkillUse(requireUnit(useCombatStore.getState().units, 'boss'), sweep(), origin, SILENT_SINK);
      const [attack] = useCombatStore.getState().preparedAttacks;
      const preview = previewPrepared(attack, useCombatStore.getState().units, useCombatStore.getState().hazards);

      // The boss ends its turn, then every hero ends theirs
      for (let i = 0; i <= heroes.length; i++) useCombatStore.getState().nextTurn();
      expect(beginTurn('boss', SILENT_SINK).kind).toBe('resolved');

      const after = useCombatStore.getState().units;
      for (const move of preview.landings) {
        expect(requireUnit(after, move.unitId).position).toEqual(move.to);
      }
      // Each hero is struck once, however far the push carried it across the footprint
      const struck = after.filter((u) => u.heroId).map((u) => u.currentHp);
      expect(new Set(struck).size).toBe(1);
      expect(struck[0]).toBeLessThan(9999);
      const living = after.filter((u) => u.currentHp > 0).map((u) => hexKey(u.position));
      expect(new Set(living).size).toBe(living.length);
    }
  });

  it('shows the combined landing threat of a hazard in the push path', () => {
    const store = useCombatStore.getState();
    store.reset();
    store.initCombat([body('h', at(1, 0))], [makeFoe({ id: 'boss', position: origin, skills: [sweep()] })]);
    store.addHazard(rubble([at(2, 0), at(3, 0)], false));
    useCombatStore.setState({ currentUnitId: 'boss' });

    resolveSkillUse(requireUnit(useCombatStore.getState().units, 'boss'), sweep(), origin, SILENT_SINK);
    const preview = previewPrepared(
      useCombatStore.getState().preparedAttacks[0],
      useCombatStore.getState().units,
      useCombatStore.getState().hazards,
    );

    expect(preview.landings[0].to).toEqual(at(3, 0));
    expect(preview.hazardIds).toEqual(['fire']);
  });
});

describe('an ordinary push respects the same ground', () => {
  it('is stopped by solid ground the hero would otherwise be thrown into', () => {
    const store = useCombatStore.getState();
    store.reset();
    const shove = makeSkill({
      id: 'test_shove' as HeroSkill['id'], damage: 1, range: 1, pushDistance: 3,
    });
    store.initCombat(
      [body('h', at(0, 0), { skills: [shove] })],
      [makeFoe({ id: 'f', position: at(0, 1), stats: makeStats({ maxHp: 999 }) })],
    );
    store.addHazard(rubble([at(0, 3)]));
    useCombatStore.setState({ currentUnitId: 'h' });

    resolveSkillUse(requireUnit(useCombatStore.getState().units, 'h'), shove, at(0, 1), SILENT_SINK);

    expect(requireUnit(useCombatStore.getState().units, 'f').position).toEqual(at(0, 2));
  });
});
