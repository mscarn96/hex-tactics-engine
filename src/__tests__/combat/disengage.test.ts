import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { calculateHealing } from '@/systems/combat/damageCalc';
import { requireUnit } from '@/systems/combat/unitLookup';
import { disengage } from '@/data/skills/skillData';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { resolveSelfMove } from '@/systems/combat/forcedMovement';
import { applyMasteryModifiers } from '@/systems/progression/mastery';
import { hexDistance } from '@/utils/hexUtils';
import { at, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * Disengage after the 2026-10-08 playtest: the escape does not spend the turn
 * (as Reposition does not), and its heal is a share of the wound rather than of
 * the Hunter's Magic.
 */

const hunter = (currentHp: number, magic = 10, healPower = 0) =>
  makeUnit({
    id: 'hunter', position: at(0, 0), skills: [disengage], currentHp,
    stats: makeStats({ maxHp: 200, magic, healPower }),
  });

beforeEach(() => {
  resetFixtureIds();
  useCombatStore.getState().reset();
});

describe('Disengage', () => {
  it('heals 30% of the missing health, whatever the Magic', () => {
    expect(disengage.healing).toBe(0.3);
    expect(calculateHealing(hunter(100, 10), disengage)).toBe(30);
    expect(calculateHealing(hunter(100, 200), disengage)).toBe(30);
    expect(calculateHealing(hunter(20), disengage)).toBe(54);
    expect(calculateHealing(hunter(200), disengage)).toBe(0);
  });

  it('is still amplified by heal power from gear', () => {
    expect(calculateHealing(hunter(100, 10, 50), disengage)).toBe(45);
  });

  it('heals the caster where it lands and leaves the turn unspent', () => {
    const me = hunter(100);
    const foe = makeFoe({ id: 'foe', position: at(1, 0) });
    useCombatStore.setState({ units: [me, foe] });

    const result = resolveSkillUse(me, disengage, at(0, 2), SILENT_SINK);

    expect(result.ok).toBe(true);
    expect(result.endsTurn).toBe(false);
    const after = requireUnit(useCombatStore.getState().units, 'hunter');
    expect(after.position).toEqual(at(0, 2));
    expect(after.currentHp).toBe(130);
    expect(after.untargetable).toBeFalsy();
  });

  // Playtest 2026-10-13: "Disengage sometimes doesn't move to green hexes".
  // Longshot's +1 range grew the green area but not the move's own reach
  it('moves to every hex it lights, with Longshot as without', () => {
    for (const skill of [disengage, applyMasteryModifiers(disengage, { skillRangeBonus: 1 })]) {
      const me = makeUnit({ id: 'hunter', position: at(0, 0), skills: [skill], currentHp: 100 });
      const units = [me, makeFoe({ id: 'foe', position: at(1, 0) })];
      useCombatStore.setState({ units });
      const lit = getValidSkillTargetHexes(skill, me, units);
      expect(Math.max(...lit.map((h) => hexDistance(me.position, h)))).toBe(skill.selfMove!.range);
      for (const h of lit) expect(resolveSelfMove(me, skill, h, units)).not.toBeNull();
    }
  });
});
