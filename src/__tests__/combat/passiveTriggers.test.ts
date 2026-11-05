import * as passives from '@/systems/combat/passives';
import * as formulas from '@/systems/combat/passiveFormulas';
import { resolvePassives } from '@/systems/combat/passives';
import { BALANCE } from '@/data/balanceConstants';
import { AfflictionType, AuraType, PassiveId } from '@/models/types';
import { at, makeEffect, makeFoe, makeSkill, makeUnit } from '../support/fixtures';

/** The passives that reach combat through the triggers added by the passive seam. */
const wearing = (id: PassiveId, over = {}) => makeUnit({ id: 'me', passives: [id], ...over });

describe('onTurnStartAura', () => {
  it('lays Settle In\'s charge after a turn spent still, and nothing after a move', () => {
    const still = resolvePassives('onTurnStartAura', { self: wearing('settleIn', { previousTurnStationary: true }), allUnits: [] });
    expect(still).toHaveLength(1);
    expect(still[0]).toMatchObject({ kind: 'effect', unitId: 'me', effect: { type: AuraType.SettledAim, duration: -1 } });
    expect(resolvePassives('onTurnStartAura', { self: wearing('settleIn', { previousTurnStationary: false }), allUnits: [] })).toEqual([]);
  });

  it('lays Grounded Focus for one turn at the rung\'s strength', () => {
    const out = resolvePassives('onTurnStartAura', { self: wearing('groundedFocus', { previousTurnStationary: true }), allUnits: [] });
    expect(out[0]).toMatchObject({ kind: 'effect', effect: { type: AuraType.GroundedFocus, duration: 1 } });
    expect(resolvePassives('onTurnStartAura', { self: wearing('groundedFocus'), allUnits: [] })).toEqual([]);
  });
});

describe('onDeath: Venom Transfer', () => {
  const pile = makeEffect(AfflictionType.Poison, { magnitude: 8, stacks: 2, sourceUnitId: 'me' });
  const corpse = makeFoe({ id: 'dead', currentHp: 0, position: at(3, 3) });

  it('passes one dose to the nearest unpoisoned neighbour and spends the allowance', () => {
    const near = makeFoe({ id: 'near', position: at(3, 4) });
    const far = makeFoe({ id: 'far', position: at(3, 6) });
    const out = resolvePassives('onDeath', { self: wearing('venomTransfer'), allUnits: [corpse, near, far], other: corpse, poison: pile });
    expect(out).toEqual([
      expect.objectContaining({ kind: 'effect', unitId: 'near', effect: expect.objectContaining({ type: AfflictionType.Poison, magnitude: 4, stacks: 1 }) }),
      { kind: 'spendAllowance', unitId: 'me', allowance: 'venomTransfer' },
    ]);
  });

  it('skips a poisoned neighbour, a distant one, and a spent allowance', () => {
    const sick = makeFoe({ id: 'sick', position: at(3, 4), activeEffects: [makeEffect(AfflictionType.Poison)] });
    const distant = makeFoe({ id: 'distant', position: at(3, 3 + BALANCE.VENOM_TRANSFER_RANGE + 1) });
    expect(resolvePassives('onDeath', { self: wearing('venomTransfer'), allUnits: [corpse, sick, distant], other: corpse, poison: pile })).toEqual([]);
    const near = makeFoe({ id: 'near', position: at(3, 4) });
    expect(resolvePassives('onDeath', { self: wearing('venomTransfer', { venomTransferSpent: true }), allUnits: [corpse, near], other: corpse, poison: pile })).toEqual([]);
  });
});

describe('onSkillResolved', () => {
  const cast = (self: ReturnType<typeof wearing>, over = {}) =>
    resolvePassives('onSkillResolved', { self, allUnits: [self], skill: makeSkill(), spendsAction: true, ...over });

  it('Cycle of Life banks a Growth charge for a healing cast, up to the full set', () => {
    expect(cast(wearing('cycleOfLife'))).toEqual([]);
    const first = cast(wearing('cycleOfLife'), { restoredByCast: true });
    expect(first[0]).toMatchObject({ kind: 'effect', replace: true, effect: { type: AuraType.Growth, magnitude: 1 } });
    const full = wearing('cycleOfLife', { activeEffects: [makeEffect(AuraType.Growth, { magnitude: BALANCE.CYCLE_OF_LIFE_CHARGES })] });
    expect(cast(full, { restoredByCast: true })[0]).toMatchObject({ effect: { magnitude: BALANCE.CYCLE_OF_LIFE_CHARGES } });
  });

  it('Slipstream grants a step after a damaging action, only where a hex is free', () => {
    const base = { damagedEnemy: true, canStep: () => true };
    expect(cast(wearing('slipstream'), base)[0]).toMatchObject({ kind: 'reposition', unitId: 'me' });
    expect(cast(wearing('slipstream'), { ...base, canStep: () => false })).toEqual([]);
    expect(cast(wearing('slipstream'), { ...base, damagedEnemy: false })).toEqual([]);
    expect(cast(wearing('slipstream'), { ...base, spendsAction: false })).toEqual([]);
    expect(cast(wearing('slipstream'), { ...base, skill: makeSkill({ freeAction: true }) })).toEqual([]);
  });
});

describe('the passive engine surface', () => {
  it('keeps rank formulas in passiveFormulas, not in the engine', () => {
    // The engine exports what the rules call; the numbers a rung is worth live in the formulas module
    expect(Object.keys(passives).length).toBeLessThanOrEqual(30);
    expect(typeof formulas.settleInPen).toBe('function');
    expect(Object.keys(passives)).not.toContain('settleInPen');
  });
});
