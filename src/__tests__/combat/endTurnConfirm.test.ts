import { endTurnNeedsConfirm } from '@/systems/combat/endTurnConfirm';
import { makeFoe, makeUnit } from '../support/fixtures';

describe('End Turn confirmation (PT-16)', () => {
  it('asks when the hero has neither moved nor acted', () => {
    expect(endTurnNeedsConfirm(makeUnit({ hasActed: false, hasMoved: false }))).toBe(true);
  });

  it('does not ask once the hero has moved or acted (the post-action windows included)', () => {
    expect(endTurnNeedsConfirm(makeUnit({ hasActed: false, hasMoved: true }))).toBe(false);
    expect(endTurnNeedsConfirm(makeUnit({ hasActed: true, hasMoved: false }))).toBe(false);
  });

  it('never asks for an enemy or nobody', () => {
    expect(endTurnNeedsConfirm(makeFoe({ hasActed: false, hasMoved: false }))).toBe(false);
    expect(endTurnNeedsConfirm(undefined)).toBe(false);
  });
});
