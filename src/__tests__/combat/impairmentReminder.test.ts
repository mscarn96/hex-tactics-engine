import { AfflictionType, CombatUnit, HexCoord } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { beginTurn } from '@/systems/combat/turnStart';
import { CombatSink, SILENT_SINK } from '@/systems/combat/skillResolution';
import { statusName } from '@/data/gameText';
import { at, makeFoe, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * PT-02b: a turn the unit can still play, but narrower — Taunted, Rooted, Silenced —
 * says so as it begins, over the unit and in the log, every turn the status stands.
 */

const state = () => useCombatStore.getState();

const recorder = () => {
  const statuses: string[] = [];
  const logs: string[] = [];
  const sink: CombatSink = {
    ...SILENT_SINK,
    status: (_at: HexCoord, label: string) => { statuses.push(label); },
    log: (text: string) => { logs.push(text); },
  };
  return { sink, statuses, logs };
};

const effect = (type: AfflictionType, sourceUnitId?: string) => ({ type, magnitude: 1, duration: 3, sourceUnitId });

const fight = (effects: CombatUnit['activeEffects'], taunterHp = 100) => {
  state().initCombat(
    [makeUnit({ id: 'hero', position: at(0, 0), activeEffects: effects })],
    [makeFoe({ id: 'foe', position: at(3, 0), currentHp: taunterHp })],
  );
  useCombatStore.setState({ currentUnitId: 'hero', bonusTurn: { pending: null, active: false } });
};

beforeEach(() => {
  resetFixtureIds();
  state().reset();
});

describe('the impairment reminder at turn start', () => {
  it('names Taunt with its taunter, and Root and Silence, overhead and in the log', () => {
    fight([effect(AfflictionType.Taunt, 'foe'), effect(AfflictionType.Root), effect(AfflictionType.Silence)]);
    const { sink, statuses, logs } = recorder();
    expect(beginTurn('hero', sink).kind).toBe('act');
    expect(statuses).toEqual(expect.arrayContaining([
      statusName(AfflictionType.Taunt), statusName(AfflictionType.Root), statusName(AfflictionType.Silence),
    ]));
    expect(logs.some((l) => /taunted/i.test(l) && l.includes(state().units.find((u) => u.id === 'foe')!.name))).toBe(true);
    expect(logs.some((l) => l.includes(statusName(AfflictionType.Root)))).toBe(true);
    expect(logs.some((l) => l.includes(statusName(AfflictionType.Silence)))).toBe(true);
  });

  it('says nothing of a taunt whose taunter has fallen, nor of a free unit', () => {
    fight([effect(AfflictionType.Taunt, 'foe')], 0);
    const dead = recorder();
    beginTurn('hero', dead.sink);
    expect(dead.statuses).not.toContain(statusName(AfflictionType.Taunt));

    fight([]);
    const free = recorder();
    beginTurn('hero', free.sink);
    expect(free.statuses).toEqual([]);
  });
});
