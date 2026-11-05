import {
  DOT_ENEMY_STATS_ID,
  DOT_PLAYER_STATS_ID,
  useCombatStore,
} from '@/stores/combatStore';
import { AfflictionType, AuraType, CombatUnit } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';

/**
 * The battle report's arithmetic. Everything here drives the store directly:
 * the three write sites are the whole mechanism, and a report that counts a
 * fight wrong is worse than no report at all.
 */

const stats = () => useCombatStore.getState().fightStats;
const row = (id: string) =>
  stats()[id] ?? { damageDealt: 0, damageTaken: 0, healingDone: 0 };

const hero = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'hero', stats: makeStats({ maxHp: 100, defense: 0 }), ...over });
const foe = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'foe', isPlayer: false, stats: makeStats({ maxHp: 100, defense: 0 }), ...over });

const setup = (players: CombatUnit[], enemies: CombatUnit[]) => {
  useCombatStore.getState().reset();
  useCombatStore.getState().initCombat(players, enemies);
};

describe('fight stats', () => {
  it('credits self regeneration only for HP actually restored, including the final tick', () => {
    setup([hero({ currentHp: 88, activeEffects: [
      { type: AuraType.HealOverTime, magnitude: 10, duration: 2, sourceUnitId: 'hero' },
    ] })], [foe()]);
    const store = useCombatStore.getState();
    store.tickEffectsOnUnit('hero');
    store.tickEffectsOnUnit('hero');
    store.tickEffectsOnUnit('hero');
    expect(row('hero').healingDone).toBe(12);
  });

  it('attributes allied regeneration to its healer and unattributed regeneration to the recipient', () => {
    setup([hero({ currentHp: 60, activeEffects: [
      { type: AuraType.HealOverTime, magnitude: 9, duration: 1, sourceUnitId: 'medic' },
      { type: AuraType.HealOverTime, magnitude: 5, duration: 1 },
    ] }), makeUnit({ id: 'medic' })], [foe()]);
    useCombatStore.getState().tickEffectsOnUnit('hero');
    expect(row('medic').healingDone).toBe(9);
    expect(row('hero').healingDone).toBe(5);
  });
  it('credits the attacker and the target of a blow', () => {
    setup([hero()], [foe()]);
    useCombatStore.getState().damageUnit('foe', 30, 'hero');

    expect(row('hero').damageDealt).toBe(30);
    expect(row('foe').damageTaken).toBe(30);
  });

  it('leaves damage with no author uncredited', () => {
    setup([hero()], [foe()]);
    useCombatStore.getState().damageUnit('foe', 30);

    expect(row('foe').damageTaken).toBe(30);
    expect(Object.keys(stats())).toEqual(['foe']);
  });

  // A shield on the target is not the attacker's problem: the blow was worth
  // what it was worth, and the target only lost what got through
  it('counts what a barrier ate as damage dealt but not as damage taken', () => {
    setup(
      [hero()],
      [foe({ activeEffects: [{ type: AuraType.Barrier, magnitude: 20, duration: 3 }] })],
    );
    useCombatStore.getState().damageUnit('foe', 30, 'hero');

    expect(row('hero').damageDealt).toBe(30);
    expect(row('foe').damageTaken).toBe(10);
  });

  it('credits a healer with the HP actually restored', () => {
    setup([hero({ currentHp: 60 }), makeUnit({ id: 'medic' })], []);
    useCombatStore.getState().healUnit('hero', 25, 'medic');

    expect(row('medic').healingDone).toBe(25);
  });

  // Healing a unit at full health is a wasted turn, and the report says so
  it('credits nothing for healing past the ceiling', () => {
    setup([hero(), makeUnit({ id: 'medic' })], []);
    useCombatStore.getState().healUnit('hero', 25, 'medic');

    expect(row('medic').healingDone).toBe(0);
  });

  // PT-33: the report used to pool every tick, so a Bleed build's damage sat in a
  // nameless "damage over time" row instead of on the hero who laid it
  it('credits a damage-over-time tick to the unit that laid it', () => {
    setup(
      [hero()],
      [foe({ activeEffects: [
        { type: AfflictionType.Bleed, magnitude: 5, duration: 3, sourceUnitId: 'hero' },
        { type: AfflictionType.Burn, magnitude: 4, duration: 3, sourceUnitId: 'hero' },
      ] })],
    );
    useCombatStore.getState().tickEffectsOnUnit('foe');

    expect(row('hero').damageDealt).toBe(9);
    expect(stats().hero.dotDealt).toBe(9);
    expect(stats()[DOT_PLAYER_STATS_ID]).toBeUndefined();
    expect(row('foe').damageTaken).toBe(9);
  });

  it('keeps crediting a dead author that already has a row, and pools one that left no trace', () => {
    setup(
      [hero()],
      [foe({ activeEffects: [
        { type: AfflictionType.Bleed, magnitude: 5, duration: 3, sourceUnitId: 'ghost' },
      ] })],
    );
    useCombatStore.setState((s) => ({ fightStats: { ...s.fightStats, ghost: { damageDealt: 10, damageTaken: 0, healingDone: 0 } } }));
    useCombatStore.getState().tickEffectsOnUnit('foe');
    expect(row('ghost').damageDealt).toBe(15);

    setup(
      [hero()],
      [foe({ activeEffects: [{ type: AfflictionType.Bleed, magnitude: 5, duration: 3, sourceUnitId: 'ghost' }] })],
    );
    useCombatStore.getState().tickEffectsOnUnit('foe');
    expect(row(DOT_PLAYER_STATS_ID).damageDealt).toBe(5);
    expect(stats().ghost).toBeUndefined();
  });

  it('keeps the author when a sourceless Bleed refreshes one', () => {
    setup([hero()], [foe({ activeEffects: [{ type: AfflictionType.Bleed, magnitude: 5, duration: 2, sourceUnitId: 'hero' }] })]);
    useCombatStore.getState().applyEffect('foe', { type: AfflictionType.Bleed, magnitude: 6, duration: 3 });
    const bleed = useCombatStore.getState().units.find((u) => u.id === 'foe')!.activeEffects
      .find((e) => e.type === AfflictionType.Bleed);
    expect(bleed?.sourceUnitId).toBe('hero');
  });

  it('pools a sourceless damage-over-time tick under the attacking side', () => {
    setup(
      [hero({ activeEffects: [{ type: AfflictionType.Burn, magnitude: 8, duration: 3 }] })],
      [foe({ activeEffects: [{ type: AfflictionType.Bleed, magnitude: 5, duration: 3 }] })],
    );
    useCombatStore.getState().tickEffectsOnUnit('hero');
    useCombatStore.getState().tickEffectsOnUnit('foe');

    expect(row(DOT_ENEMY_STATS_ID).damageDealt).toBe(8);
    expect(row(DOT_PLAYER_STATS_ID).damageDealt).toBe(5);
    expect(row('hero').damageTaken).toBe(8);
    expect(row('foe').damageTaken).toBe(5);
  });

  it('starts each fight with an empty ledger', () => {
    setup([hero()], [foe()]);
    useCombatStore.getState().damageUnit('foe', 30, 'hero');
    setup([hero()], [foe()]);

    expect(stats()).toEqual({});
  });

  it('clears the ledger on reset', () => {
    setup([hero()], [foe()]);
    useCombatStore.getState().damageUnit('foe', 30, 'hero');
    useCombatStore.getState().reset();

    expect(stats()).toEqual({});
  });
});
