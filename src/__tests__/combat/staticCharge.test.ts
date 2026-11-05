import { useCombatStore } from '@/stores/combatStore';
import { applyOnHitStatuses } from '@/systems/combat/combatEvents';
import { AfflictionType, AuraType, CombatUnit, HeroStats } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';
import { requireUnit } from '@/systems/combat/unitLookup';

/**
 * A Static Charge's stored answer.
 *
 * Thorns already reflects a fraction of every hit forever and applies nothing.
 * A charge is the opposite shape: one answer, held until it is needed, and it
 * lands a status — which is why it has to be spent exactly once. Afterimage,
 * which handed one to every ally, left the tree in the Stormcaller remaster
 * (2026-10); the aura and its rule stay in the vocabulary.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ maxHp: 200, critChance: 0, dodgeChance: 0, ...over });

const unit = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ stats: stats(), ...over });

const charged = (magnitude = 20) => ({
  type: AuraType.StaticCharge, magnitude, duration: 4,
});

const live = (id: string) => requireUnit(useCombatStore.getState().units, id);

describe('spending a charge', () => {
  const board = () => {
    const ally = unit({ activeEffects: [charged(20)], position: { q: 0, r: 0 } });
    const attacker = unit({ isPlayer: false, position: { q: 1, r: 0 } });
    useCombatStore.setState({ units: [ally, attacker] });
    return { ally, attacker };
  };

  it('strikes the attacker and shocks them', () => {
    const { ally, attacker } = board();
    applyOnHitStatuses(attacker, ally, 30, undefined, ally.currentHp);

    expect(live(attacker.id).currentHp).toBe(attacker.stats.maxHp - 20);
    expect(live(attacker.id).activeEffects.some((e) => e.type === AfflictionType.Shock)).toBe(true);
  });

  it('is consumed, so the second blow goes unanswered', () => {
    const { ally, attacker } = board();
    applyOnHitStatuses(attacker, ally, 30, undefined, ally.currentHp);
    expect(live(ally.id).activeEffects.some((e) => e.type === AuraType.StaticCharge)).toBe(false);

    const afterFirst = live(attacker.id).currentHp;
    applyOnHitStatuses(attacker, live(ally.id), 30, undefined, live(ally.id).currentHp);
    expect(live(attacker.id).currentHp).toBe(afterFirst);
  });

  it('does nothing to an uncharged ally', () => {
    const ally = unit({ position: { q: 0, r: 0 } });
    const attacker = unit({ isPlayer: false, position: { q: 1, r: 0 } });
    useCombatStore.setState({ units: [ally, attacker] });

    applyOnHitStatuses(attacker, ally, 30, undefined, ally.currentHp);
    expect(live(attacker.id).currentHp).toBe(attacker.stats.maxHp);
  });

  it('stays silent when the blow dealt nothing', () => {
    // A fully-absorbed hit is not a blow taken, and spending the one stored
    // answer on it would be the worst possible moment to lose it
    const { ally, attacker } = board();
    applyOnHitStatuses(attacker, ally, 0, undefined, ally.currentHp);
    expect(live(ally.id).activeEffects.some((e) => e.type === AuraType.StaticCharge)).toBe(true);
    expect(live(attacker.id).currentHp).toBe(attacker.stats.maxHp);
  });

  it('answers even when the answer kills', () => {
    const ally = unit({ activeEffects: [charged(500)], position: { q: 0, r: 0 } });
    const attacker = unit({ isPlayer: false, position: { q: 1, r: 0 } });
    useCombatStore.setState({ units: [ally, attacker] });

    applyOnHitStatuses(attacker, ally, 30, undefined, ally.currentHp);
    expect(live(attacker.id).currentHp).toBe(0);
  });
});
