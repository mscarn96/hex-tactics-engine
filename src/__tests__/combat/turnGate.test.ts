import { useCombatStore } from '@/stores/combatStore';
import { beginTurn, mayTakeAction } from '@/systems/combat/turnStart';
import { SILENT_SINK } from '@/systems/combat/skillResolution';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { AfflictionType, AuraType } from '@/models/types';
import { at, makeEffect, makeFoe, makeStats, makeUnit } from '../support/fixtures';

/**
 * The scene asks the AI for an action on a timer of its own. It must only do so
 * when the turn start said the unit may act: a sleeping Cave Bear, and anything
 * on the last turn of a stun (whose status is already gone after the tick),
 * used to swing anyway.
 */

const foeNow = (id = 'foe') => useCombatStore.getState().units.find((u) => u.id === id)!;
const serial = () => useCombatStore.getState().turnSerial;

function verdictFor(id: string) {
  const kind = beginTurn(id, SILENT_SINK).kind;
  return { unitId: id, serial: serial(), kind };
}

describe('mayTakeAction', () => {
  it('refuses the last stunned turn, though the stun is already gone', () => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat(
      [makeUnit({ id: 'hero', heroId: 'h1', position: at(0, 2) })],
      [makeFoe({ id: 'foe', position: at(0, -2), activeEffects: [makeEffect(AfflictionType.Stun, { duration: 1 })] })],
    );
    const verdict = verdictFor('foe');
    expect(verdict.kind).toBe('stunned');
    expect(foeNow().activeEffects.some((e) => e.type === AfflictionType.Stun)).toBe(false);
    expect(mayTakeAction(verdict, foeNow(), serial())).toBe(false);
    // The next turn is its own again
    const next = verdictFor('foe');
    expect(mayTakeAction(next, foeNow(), serial())).toBe(true);
  });

  it('refuses every turn of the Cave Bear\'s Winter Sleep', () => {
    const store = useCombatStore.getState();
    store.reset();
    const [bear] = createEnemyUnits(['cave_bear'], [at(0, -3)], 1, 1);
    store.initCombat(
      [makeUnit({ id: 'h1', heroId: 'h1', position: at(0, 3), stats: makeStats({ maxHp: 4000, attack: 80 }) })],
      [bear],
    );
    store.damageUnit(bear.id, foeNow(bear.id).currentHp + 500, 'h1');
    expect(foeNow(bear.id).activeEffects.some((e) => e.type === AuraType.Slumber)).toBe(true);
    // Even before its turn starts, the lock alone refuses it
    expect(mayTakeAction(null, foeNow(bear.id), serial())).toBe(false);
    const verdict = verdictFor(bear.id);
    expect(verdict.kind).toBe('asleep');
    expect(mayTakeAction(verdict, foeNow(bear.id), serial())).toBe(false);
  });

  it('ignores a verdict recorded for another turn and falls back to the lock', () => {
    const unit = makeFoe({ id: 'foe', position: at(0, -2) });
    expect(mayTakeAction({ unitId: 'foe', serial: 3, kind: 'stunned' }, unit, 4)).toBe(true);
    expect(mayTakeAction({ unitId: 'other', serial: 4, kind: 'stunned' }, unit, 4)).toBe(true);
    expect(mayTakeAction({ unitId: 'foe', serial: 4, kind: 'resolved' }, unit, 4)).toBe(false);
    expect(mayTakeAction(null, { ...unit, currentHp: 0 }, 4)).toBe(false);
  });
});
