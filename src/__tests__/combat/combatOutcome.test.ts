import { combatOutcome, isDeadlocked } from '@/systems/combat/combatOutcome';
import { AfflictionType, AuraType, CombatUnit } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';

const unit = (id: string, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ id, isPlayer: false, stats: makeStats({ maxHp: 60, attack: 10, defense: 4, moveRange: 2, maxMana: 20 }), ...over });

const hero = (over: Partial<CombatUnit> = {}) =>
  unit('hero', { isPlayer: true, heroId: 'h1', ...over });
const foe = (over: Partial<CombatUnit> = {}) => unit('foe', { isPlayer: false, ...over });
/** A summon: player-side, but with no `heroId`. */
const pet = (over: Partial<CombatUnit> = {}) => unit('pet', { isPlayer: true, ...over });

const cc = (type: AfflictionType) => ({ type, magnitude: 1, duration: 2 });

describe('combatOutcome', () => {
  it('is ongoing while both sides have someone standing', () => {
    expect(combatOutcome([hero(), foe()])).toBe('ongoing');
  });

  it('is victory when every enemy is down', () => {
    expect(combatOutcome([hero(), foe({ currentHp: 0 })])).toBe('victory');
  });

  it('is defeat when every hero is down', () => {
    expect(combatOutcome([hero({ currentHp: 0 }), foe()])).toBe('defeat');
  });

  // The bug this guard exists for: a summon outliving the party is not a party
  it('does not let a surviving summon keep a wiped party standing', () => {
    expect(combatOutcome([hero({ currentHp: 0 }), pet(), foe()])).toBe('defeat');
  });

  // ...and the mirror case is deliberately *not* symmetric
  it('counts an enemy summon as a living enemy', () => {
    const enemyPet = unit('enemyPet', { isPlayer: false });
    expect(combatOutcome([hero(), foe({ currentHp: 0 }), enemyPet])).toBe('ongoing');
  });

  // Victory is checked first: a mutual wipe is a win, not a loss
  it('resolves a mutual wipe as victory', () => {
    expect(combatOutcome([hero({ currentHp: 0 }), foe({ currentHp: 0 })])).toBe('victory');
  });
});

/**
 * A deadlock is a board of rocks, and nothing else.
 *
 * It used to count Freeze and Stun as locks, on the reasoning that Freeze held
 * until something struck it. Freeze runs on `FREEZE_DURATION` now, so both
 * unstick themselves — and counting them would end a fight in defeat the moment
 * a Blizzard landed well, which is the play the ice path is built around.
 */
describe('isDeadlocked', () => {
  const rock = (over: Partial<CombatUnit> = {}) =>
    pet({
      skills: [],
      stats: makeStats({ maxHp: 90, attack: 0, defense: 25, moveRange: 0, maxMana: 0 }),
      ...over,
    });

  it('is false while anyone can still act', () => {
    expect(isDeadlocked([hero(), foe({ activeEffects: [cc(AfflictionType.Freeze)] })])).toBe(false);
  });

  it('does not count crowd control, which retires itself', () => {
    expect(
      isDeadlocked([
        hero({ activeEffects: [cc(AfflictionType.Freeze)] }),
        foe({ activeEffects: [cc(AfflictionType.Stun)] }),
      ])
    ).toBe(false);
  });

  it('is true when every living unit is inert', () => {
    expect(isDeadlocked([rock({ id: 'r1' }), rock({ id: 'r2', isPlayer: false })])).toBe(true);
  });

  // The dead are not part of the stalemate
  it('ignores the fallen when judging a stalemate', () => {
    expect(isDeadlocked([rock(), foe({ currentHp: 0 })])).toBe(true);
  });

  it('is false on an empty board rather than trivially true', () => {
    expect(isDeadlocked([])).toBe(false);
    expect(isDeadlocked([hero({ currentHp: 0 })])).toBe(false);
  });

  it('does not treat a unit that can still move as inert', () => {
    const walker = pet({ skills: [] });
    expect(isDeadlocked([walker, rock({ id: 'r2', isPlayer: false })])).toBe(false);
  });

  // A frozen unit is not a rock: the ice expires and it fights again
  it('does not treat a non-CC effect as a lock either', () => {
    expect(
      isDeadlocked([
        hero({ activeEffects: [{ type: AuraType.Thorns, magnitude: 1, duration: 2 }] }),
        rock({ id: 'r2', isPlayer: false }),
      ])
    ).toBe(false);
  });
});
