import { useCombatStore } from '@/stores/combatStore';
import { AfflictionType, CombatUnit } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { defenceReduction, dotDefenceFactor } from '@/systems/combat/damageCalc';
import { makeStats, makeUnit } from '../support/fixtures';

/**
 * PT-36 (playtest 2026-10-21): Poison, Bleed and Burn ticks ignored defence. A tick
 * now takes `DOT_DEF_SHARE` of the ordinary percentage reduction — a Bleed through
 * Physical Defense, a Burn and a Poison through Magic Defense — measured against
 * the stronger of its source's Attack and Magic. Doom is left as it was.
 */

const hero = () => makeUnit({ id: 'hero', stats: makeStats({ maxHp: 100, attack: 20, magic: 5, defense: 0 }) });
const foe = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'foe', isPlayer: false, stats: makeStats({ maxHp: 200, defense: 30, magicDefense: 10 }), ...over });

const setup = (enemy: CombatUnit) => {
  useCombatStore.getState().reset();
  useCombatStore.getState().initCombat([hero()], [enemy]);
};
const hpLost = () => 200 - useCombatStore.getState().units.find((u) => u.id === 'foe')!.currentHp;

describe('damage over time against defence', () => {
  it('takes half the normal reduction: a Bleed through Physical Defense', () => {
    setup(foe({ activeEffects: [{ type: AfflictionType.Bleed, magnitude: 20, duration: 3, sourceUnitId: 'hero' }] }));
    useCombatStore.getState().tickEffectsOnUnit('foe');
    const kept = 1 - BALANCE.DOT_DEF_SHARE * defenceReduction(30, 20);
    expect(hpLost()).toBe(Math.round(20 * kept));
    expect(hpLost()).toBeLessThan(20);
  });

  it('meets Magic Defense with a Burn and a Poison', () => {
    const burnFactor = dotDefenceFactor(foe(), hero(), AfflictionType.Burn);
    expect(burnFactor).toBeCloseTo(1 - BALANCE.DOT_DEF_SHARE * defenceReduction(10, 20));
    expect(dotDefenceFactor(foe(), hero(), AfflictionType.Poison)).toBeCloseTo(burnFactor);
    setup(foe({ activeEffects: [{ type: AfflictionType.Burn, magnitude: 20, duration: 3, sourceUnitId: 'hero' }] }));
    useCombatStore.getState().tickEffectsOnUnit('foe');
    expect(hpLost()).toBe(Math.round(20 * burnFactor));
  });

  it('measures a sourceless tick as an even match, and leaves an undefended target alone', () => {
    expect(dotDefenceFactor(foe(), undefined, AfflictionType.Bleed))
      .toBeCloseTo(1 - BALANCE.DOT_DEF_SHARE * defenceReduction(30, 30));
    const bare = foe({ stats: makeStats({ maxHp: 200, defense: 0, magicDefense: 0 }) });
    expect(dotDefenceFactor(bare, hero(), AfflictionType.Bleed)).toBe(1);
  });

  it('never takes a tick below 1', () => {
    setup(foe({ activeEffects: [{ type: AfflictionType.Bleed, magnitude: 1, duration: 3, sourceUnitId: 'hero' }] }));
    useCombatStore.getState().tickEffectsOnUnit('foe');
    expect(hpLost()).toBe(1);
  });

  it('leaves Doom ignoring defence', () => {
    setup(foe({ activeEffects: [{ type: AfflictionType.Doom, magnitude: 20, duration: 1, sourceUnitId: 'hero' }] }));
    useCombatStore.getState().tickEffectsOnUnit('foe');
    expect(hpLost()).toBe(20);
  });
});
