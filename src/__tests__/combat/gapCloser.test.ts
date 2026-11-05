import { dashGapClosed, resolveSelfMove } from '@/systems/combat/forcedMovement';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { useCombatStore } from '@/stores/combatStore';
import { charge } from '@/data/skills/skillData';
import { CombatUnit, HexCoord } from '@/models/types';
import { at, makeFoe, makeStats, makeUnit } from '../support/fixtures';

/**
 * A charge aimed at somebody already within reach.
 *
 * `resolveSelfMove` returns `null` both when every hex beside the target is
 * taken and when the caster is already standing in one of them. Those are
 * opposite answers — the first is a refusal, the second is an ordinary melee
 * swing — and reading them as one made every gap-closer unusable at exactly
 * the range it deals its damage from. The board offered the adjacent enemy and
 * the resolver then said "No way in".
 */

const hexKey = (h: HexCoord) => `${h.q},${h.r}`;

const charger = (position: HexCoord): CombatUnit =>
  makeUnit({ position, skills: [charge], stats: makeStats({ defense: 0 }) });

const victim = (position: HexCoord): CombatUnit =>
  makeFoe({ position, stats: makeStats({ defense: 0 }) });

describe('dashGapClosed', () => {
  it('is true for a dash aimed at an adjacent hex', () => {
    expect(dashGapClosed(charger(at(0, 0)), charge, at(1, 0))).toBe(true);
  });

  it('is false when there is still ground to cover', () => {
    expect(dashGapClosed(charger(at(0, 0)), charge, at(3, 0))).toBe(false);
  });

  it('is false for a skill that does not dash', () => {
    const noMove = { ...charge, selfMove: undefined };
    expect(dashGapClosed(charger(at(0, 0)), noMove, at(1, 0))).toBe(false);
  });

  /** The reason the helper exists, stated as the behaviour it disambiguates. */
  it('names the case resolveSelfMove reports as no destination', () => {
    const hero = charger(at(0, 0));
    const foe = victim(at(1, 0));
    expect(resolveSelfMove(hero, charge, foe.position, [hero, foe])).toBeNull();
    expect(dashGapClosed(hero, charge, foe.position)).toBe(true);
  });
});

describe('charging an adjacent enemy', () => {
  it('strikes without moving instead of refusing', () => {
    const hero = charger(at(0, 0));
    const foe = victim(at(1, 0));
    useCombatStore.setState({ units: [hero, foe] });

    const result = resolveSkillUse(hero, charge, foe.position, SILENT_SINK);

    expect(result.ok).toBe(true);
    const after = useCombatStore.getState().units;
    expect(after.find((u) => u.id === hero.id)!.position).toEqual(at(0, 0));
    expect(after.find((u) => u.id === foe.id)!.currentHp).toBeLessThan(foe.stats.maxHp);
  });

  it('still closes the gap when there is one', () => {
    const hero = charger(at(0, 0));
    const foe = victim(at(3, 0));
    useCombatStore.setState({ units: [hero, foe] });

    const result = resolveSkillUse(hero, charge, foe.position, SILENT_SINK);

    expect(result.ok).toBe(true);
    const moved = useCombatStore.getState().units.find((u) => u.id === hero.id)!.position;
    expect(moved).not.toEqual(at(0, 0));
    expect(Math.max(Math.abs(moved.q - 3), Math.abs(moved.r))).toBeLessThanOrEqual(1);
  });

  /** The board and the rules have to agree about which hexes are legal. */
  it('is offered by the highlight pass at melee range', () => {
    const hero = charger(at(0, 0));
    const foe = victim(at(1, 0));
    const offered = getValidSkillTargetHexes(charge, hero, [hero, foe]).map(hexKey);
    expect(offered).toContain(hexKey(foe.position));
  });
});
