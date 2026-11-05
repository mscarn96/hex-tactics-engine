import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { intercept } from '@/data/skills/masterySkills';
import { hexKey } from '@/utils/hexUtils';
import { AfflictionType, AuraType, CombatUnit, HeroStats } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';
import { requireUnit } from '@/systems/combat/unitLookup';

/**
 * The Bulwark's Intercept: get between an ally and what is about to hit them.
 *
 * It carries no damage and no healing, which is what the highlight pass reads to
 * decide who a skill is for — so it used to light up every hex in range, and the
 * body-block could be aimed at bare ground or at the enemy. `targetSide` is the
 * rule it should always have had, and the shield is what makes arriving worth
 * the turn: it lands on the allies in the ring, and the dash guarantees the
 * Bulwark is one of them.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ maxHp: 200, defense: 5, magic: 0, maxMana: 90, critChance: 0, dodgeChance: 0, ...over });

const unit = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ stats: stats(), skills: [intercept], ...over });

const effectsOn = (id: string) =>
  requireUnit(useCombatStore.getState().units, id).activeEffects;

describe('intercept', () => {
  it('offers allies, and nothing else', () => {
    const tank = unit({ position: { q: 0, r: 0 } });
    const friend = unit({ position: { q: 2, r: 0 } });
    const foe = unit({ isPlayer: false, position: { q: 0, r: 2 } });
    const units = [tank, friend, foe];

    const offered = getValidSkillTargetHexes(intercept, tank, units).map(hexKey);

    expect(offered).toEqual([hexKey(friend.position)]);
    expect(offered).not.toContain(hexKey(foe.position));
    // Standing in front of yourself is Bellow, and it is a different node
    expect(offered).not.toContain(hexKey(tank.position));
  });

  it('refuses bare ground, rather than taunting it', () => {
    const tank = unit({ position: { q: 0, r: 0 } });
    useCombatStore.setState({ units: [tank] });

    const result = resolveSkillUse(tank, intercept, { q: 2, r: 0 }, SILENT_SINK);

    expect(result.ok).toBe(false);
    expect(result.endsTurn).toBe(false);
    expect(useCombatStore.getState().units[0].position).toEqual({ q: 0, r: 0 });
  });

  it('refuses the enemy it is meant to block', () => {
    const tank = unit({ position: { q: 0, r: 0 } });
    const foe = unit({ isPlayer: false, position: { q: 2, r: 0 } });
    useCombatStore.setState({ units: [tank, foe] });

    expect(resolveSkillUse(tank, intercept, foe.position, SILENT_SINK).ok).toBe(false);
  });

  it('shields the ally and the bulwark, and taunts the enemy', () => {
    const tank = unit({ position: { q: 0, r: 0 } });
    const friend = unit({ position: { q: 3, r: 0 } });
    const foe = unit({ isPlayer: false, position: { q: 4, r: 0 } });
    useCombatStore.setState({ units: [tank, friend, foe] });

    const result = resolveSkillUse(tank, intercept, friend.position, SILENT_SINK);
    expect(result.ok).toBe(true);

    const barrier = (id: string) => effectsOn(id).find((e) => e.type === AuraType.Barrier);
    expect(barrier(friend.id)!.magnitude).toBeGreaterThan(0);
    // The dash lands the Bulwark beside the ally, so it is inside its own ring —
    // which is why the shield needs no "and also the caster" clause
    expect(barrier(tank.id)!.magnitude).toBe(barrier(friend.id)!.magnitude);
    expect(effectsOn(foe.id).some((e) => e.type === AfflictionType.Taunt)).toBe(true);
    expect(effectsOn(foe.id).some((e) => e.type === AuraType.Barrier)).toBe(false);
  });

  /** A shield worth nothing at level 20 is a node nobody takes twice. */
  it('grows the shield with the bulwark', () => {
    const shieldFor = (attack: number) => {
      const tank = unit({ position: { q: 0, r: 0 }, stats: stats({ attack }) });
      const friend = unit({ position: { q: 2, r: 0 } });
      useCombatStore.setState({ units: [tank, friend] });
      resolveSkillUse(tank, intercept, friend.position, SILENT_SINK);
      return effectsOn(friend.id).find((e) => e.type === AuraType.Barrier)!.magnitude;
    };

    expect(shieldFor(60)).toBeGreaterThan(shieldFor(20));
  });

  it('will not offer an ally there is no room beside', () => {
    const tank = unit({ position: { q: 3, r: 0 } });
    const friend = unit({ position: { q: 0, r: 0 } });
    const crowd = [
      { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
      { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
    ].map((position) => unit({ position }));

    const offered = getValidSkillTargetHexes(intercept, tank, [tank, friend, ...crowd]);
    expect(offered.map(hexKey)).not.toContain(hexKey(friend.position));
  });
});
