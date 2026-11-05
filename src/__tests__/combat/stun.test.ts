import { useCombatStore } from '@/stores/combatStore';
import { beginTurn } from '@/systems/combat/turnStart';
import { SILENT_SINK } from '@/systems/combat/skillResolution';
import { AfflictionType, CombatUnit } from '@/models/types';
import { at, makeEffect, makeFoe, makeUnit } from '../support/fixtures';

/**
 * Stun is fixed-turns CC: a Stun of duration N costs its target exactly N
 * turns, retired by the ordinary effect decrement rather than by a special
 * removal at turn start. The old rule removed the effect on the first stunned
 * turn, which made the authored duration decoration — a Stun 2 and a Stun 1
 * were the same skill.
 */

const hero = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'hero', heroId: 'h1', position: at(0, 2), ...over });
const foe = (over: Partial<CombatUnit> = {}) =>
  makeFoe({ id: 'foe', position: at(0, -2), ...over });

const setup = (heroOver: Partial<CombatUnit> = {}, foeOver: Partial<CombatUnit> = {}) => {
  useCombatStore.getState().reset();
  useCombatStore.getState().initCombat([hero(heroOver)], [foe(foeOver)]);
};

const foeNow = () => useCombatStore.getState().units.find((u) => u.id === 'foe')!;
const stunOn = (u: CombatUnit) => u.activeEffects.find((e) => e.type === AfflictionType.Stun);

describe('stun costs its duration in turns', () => {
  it('costs exactly one turn at duration 1', () => {
    setup({}, { activeEffects: [makeEffect(AfflictionType.Stun, { duration: 1 })] });

    expect(beginTurn('foe', SILENT_SINK).kind).toBe('stunned');
    // The tick retired it — nothing at turn start removes it by hand
    expect(stunOn(foeNow())).toBeUndefined();
    expect(beginTurn('foe', SILENT_SINK).kind).toBe('act');
  });

  it('costs exactly two turns at duration 2', () => {
    setup({}, { activeEffects: [makeEffect(AfflictionType.Stun, { duration: 2 })] });

    expect(beginTurn('foe', SILENT_SINK).kind).toBe('stunned');
    expect(stunOn(foeNow())?.duration).toBe(1);
    expect(beginTurn('foe', SILENT_SINK).kind).toBe('stunned');
    expect(stunOn(foeNow())).toBeUndefined();
    expect(beginTurn('foe', SILENT_SINK).kind).toBe('act');
  });

  it('reads the stun pre-tick, so the final stunned turn is still lost', () => {
    // At duration 1 the effect is already gone by the time the post-tick
    // snapshot is read; a post-tick check would hand that turn back.
    setup({}, { activeEffects: [makeEffect(AfflictionType.Stun, { duration: 1 })] });
    const verdict = beginTurn('foe', SILENT_SINK);
    expect(verdict.kind).toBe('stunned');
  });

  it('lets damage-over-time bite while the target is stunned', () => {
    setup({}, {
      activeEffects: [
        makeEffect(AfflictionType.Stun, { duration: 1 }),
        // >= 5 so `resolveEffectMagnitude` would treat it as flat anyway; here
        // it is applied directly and ticks for its literal magnitude
        makeEffect(AfflictionType.Burn, { magnitude: 8, duration: 2 }),
      ],
    });
    const hpBefore = foeNow().currentHp;
    expect(beginTurn('foe', SILENT_SINK).kind).toBe('stunned');
    expect(foeNow().currentHp).toBe(hpBefore - 8);
  });

  /**
   * Freeze is now the same shape of rule — see `freeze.test.ts` for the whole
   * of it. Pinned here too because the two are read from one snapshot in
   * `beginTurn`, and a change to one is a change to the other's neighbour.
   */
  it('reports Freeze pre-tick, the same way it reports a Stun', () => {
    setup({}, { activeEffects: [makeEffect(AfflictionType.Freeze, { duration: 1 })] });

    expect(beginTurn('foe', SILENT_SINK).kind).toBe('frozen');
    expect(foeNow().activeEffects.some((e) => e.type === AfflictionType.Freeze)).toBe(false);
    expect(beginTurn('foe', SILENT_SINK).kind).toBe('act');
  });

  it('lets a stun and a freeze coexist, stun answering first', () => {
    setup({}, {
      activeEffects: [
        makeEffect(AfflictionType.Stun, { duration: 2 }),
        makeEffect(AfflictionType.Freeze, { duration: 2 }),
      ],
    });
    expect(beginTurn('foe', SILENT_SINK).kind).toBe('stunned');
  });
});
