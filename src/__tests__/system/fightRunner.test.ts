import { CombatUnit } from '@/models/types';
import { slash } from '@/data/skills/skillData';
import { useCombatStore } from '@/stores/combatStore';
import { firstOf, runHeadless, TurnWatch } from '@/systems/sim/fightRunner';
import { at, makeStats, makeUnit } from '../support/fixtures';

/**
 * The headless fight runner's own rules, on boards of one or two units: who decides a turn, what ends a
 * fight, and what a watch is told. The boss measurers' numbers are pinned in their own suites.
 */

const fighter = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ stats: makeStats({ maxHp: 80, attack: 15, defense: 4, maxMana: 30 }), skills: [slash], ...over });
const hero = (over: Partial<CombatUnit> = {}) => fighter({ id: 'hero', heroId: 'h1', position: at(0, -2), ...over });
const foe = (over: Partial<CombatUnit> = {}) => fighter({ id: 'foe', isPlayer: false, position: at(0, 2), ...over });
/** Nothing it can do: no skills, no movement. */
const rock = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ skills: [], stats: makeStats({ maxHp: 90, moveRange: 0, maxMana: 0 }), ...over });

const field = (players: CombatUnit[], enemies: CombatUnit[]) => {
  const store = useCombatStore.getState();
  store.reset();
  store.initCombat(players, enemies);
};

const hold = () => [{ type: 'endturn' as const }];

describe('who decides a turn', () => {
  it('asks the policy first and leaves the turns it passes on to the brain', () => {
    field([hero()], [foe()]);
    const chosen: [string, boolean][] = [];
    runHeadless({
      maxTurns: 4,
      policy: (unit) => (unit.isPlayer ? hold() : null),
      watches: [{ chose: (unit, _actions, byPolicy) => { chosen.push([unit.id, byPolicy]); } }],
    });
    expect(chosen).toEqual([['hero', true], ['foe', false], ['hero', true], ['foe', false]]);
  });

  it('traces only the brain, and only the units a watch asks for', () => {
    field([hero()], [foe()]);
    const traced: string[] = [];
    runHeadless({
      maxTurns: 4,
      policy: (unit) => (unit.id === 'hero' ? hold() : null),
      watches: [{ traces: (u) => !u.isPlayer, decided: (u) => { traced.push(u.id); } }],
    });
    expect(traced).toEqual(['foe', 'foe']);
  });

  it('takes the first of several policies with an answer', () => {
    const calls: string[] = [];
    const pass = () => { calls.push('pass'); return null; };
    const answer = () => { calls.push('answer'); return hold(); };
    const never = () => { calls.push('never'); return hold(); };
    expect(firstOf(pass, undefined, answer, never)(hero(), [])).toEqual(hold());
    expect(calls).toEqual(['pass', 'answer']);
    expect(firstOf(pass)(hero(), [])).toBeNull();
  });

  it('decides with the unit as the tick left it, or as its turn came up', () => {
    const seen = (actor: 'ticked' | 'begun') => {
      field([hero()], [foe()]);
      let mana = -1;
      runHeadless({
        maxTurns: 1,
        actor,
        policy: (unit) => { mana = unit.currentMana; return hold(); },
        // Stands in for whatever the tick changes about the unit
        watches: [{ started: (unit) => {
          useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === unit.id ? { ...u, currentMana: 7 } : u)) }));
        } }],
      });
      return mana;
    };
    expect(seen('ticked')).toBe(7);
    expect(seen('begun')).toBe(30);
  });

  it('shows the brain the roster its view allows, and the policy all of it', () => {
    const strikes = (view?: (unit: CombatUnit, units: CombatUnit[]) => CombatUnit[]) => {
      field([hero({ position: at(0, 0) })], [foe({ position: at(0, 1) }), foe({ id: 'far', position: at(4, 4) })]);
      let policySaw = 0;
      let struck = false;
      runHeadless({
        maxTurns: 1,
        policy: (_unit, units) => { policySaw = units.length; return null; },
        brainView: view,
        watches: [{ chose: (_u, actions) => { struck = actions.some((a) => a.type === 'skill'); } }],
      });
      expect(policySaw).toBe(3);
      return struck;
    };
    expect(strikes()).toBe(true);
    // The foe beside it hidden, the one in reach is out of reach
    expect(strikes((_u, units) => units.filter((u) => u.id !== 'foe'))).toBe(false);
  });
});

describe('what ends a fight', () => {
  it('ends on the outcome, counting the turns begun', () => {
    field([hero({ stats: makeStats({ maxHp: 500, attack: 200 }), currentHp: 500, position: at(0, 0) })],
      [foe({ currentHp: 1, position: at(0, 1) })]);
    expect(runHeadless({ maxTurns: 50 })).toEqual({ outcome: 'victory', turns: 1 });
  });

  it('is a draw at the turn cap, the cap counted in unit turns', () => {
    field([hero()], [foe()]);
    expect(runHeadless({ maxTurns: 3, policy: hold })).toEqual({ outcome: 'draw', turns: 3 });
  });

  it('is a draw when nothing left can ever act, the deadlocked turn counted and not finished', () => {
    field([rock({ id: 'a', heroId: 'h1' })], [rock({ id: 'b', isPlayer: false, position: at(0, 2) })]);
    const seen: string[] = [];
    const result = runHeadless({
      maxTurns: 50,
      watches: [{
        started: (u, start) => { seen.push(`${u.id} ${start.kind}`); },
        after: (u) => { seen.push(`${u.id} after`); },
      }],
    });
    expect(result).toEqual({ outcome: 'draw', turns: 1 });
    expect(seen).toEqual(['a inert']);
  });
});

describe('what a watch is told', () => {
  it('hears each turn in order: before, started, chose, after', () => {
    field([hero()], [foe()]);
    const heard: string[] = [];
    const watch: TurnWatch = {
      before: (u, n) => { heard.push(`${n} before ${u.id}`); },
      started: (u, s, n) => { heard.push(`${n} started ${s.kind}`); },
      chose: (_u, a) => { heard.push(`chose ${a.length}`); },
      after: (_u, _s, n) => { heard.push(`${n} after`); },
    };
    runHeadless({ maxTurns: 2, policy: hold, watches: [watch, { before: () => { heard.push('second watch'); } }] });
    expect(heard).toEqual([
      '1 before hero', 'second watch', '1 started act', 'chose 1', '1 after',
      '2 before foe', 'second watch', '2 started act', 'chose 1', '2 after',
    ]);
  });

  it('writes a header per unit turn and indents what the turn logged', () => {
    field([hero({ position: at(0, 0) })], [foe({ position: at(0, 1) })]);
    const lines: string[] = [];
    const logged: string[] = [];
    runHeadless({ maxTurns: 2, transcript: { lines, side: (u) => (u.isPlayer ? 'near' : 'far') }, log: (text) => { logged.push(text); } });
    expect(lines[0]).toBe('#1 hero (near)');
    expect(lines).toContain('#2 foe (far)');
    expect(logged.length).toBeGreaterThan(0);
    expect(lines.filter((l) => l.startsWith('  '))).toEqual(logged.map((t) => `  ${t}`));
  });
});
