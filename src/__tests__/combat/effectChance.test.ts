import { skillDescription } from '@/data/gameText';
import { spyDice } from '../support/dice';
import { effectLands, skillEffects } from '@/systems/combat/statusEffects';
import { venomBite } from '@/data/skills/skillData';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { useCombatStore } from '@/stores/combatStore';
import { tremor } from '@/data/skills/mastery/druid';
import { skillEffectLines } from '@/data/display/skillDisplay';
import {
  AfflictionType,
  CombatUnit,
  HexCoord,
  SkillEffect,
  SkillTargetType,
} from '@/models/types';
import { at, makeFoe, makeStats, makeUnit } from '../support/fixtures';

/**
 * `SkillEffect.chance` — the odds an entry lands, rolled per target.
 *
 * A chance is what lets a cheap, low-cooldown cone carry a status as hard as
 * Stun. Rolled per target rather than per cast so a wide skill is a spread of
 * outcomes and not one roll deciding the fight.
 */

const stun = (chance?: number): SkillEffect => ({
  type: AfflictionType.Stun,
  magnitude: 1,
  duration: 1,
  ...(chance === undefined ? {} : { chance }),
});

describe('effectLands', () => {
  it('is certain when no chance is stated', () => {
    // Would fail every roll if the chance were being read as zero
    expect(effectLands(stun(), () => 0.99)).toBe(true);
  });

  it('lands on a roll under the chance', () => {
    expect(effectLands(stun(0.25), () => 0.24)).toBe(true);
  });

  it('misses on a roll at or above the chance', () => {
    expect(effectLands(stun(0.25), () => 0.25)).toBe(false);
    expect(effectLands(stun(0.25), () => 0.9)).toBe(false);
  });
});

describe('Tremor', () => {
  it('is an arc that stuns a quarter of the time', () => {
    expect(tremor.targetType).toBe(SkillTargetType.Arc);
    // An arc's depth is its `aoeRadius`. This asserted the exact opposite while
    // the shape was a `Cone`, which sized itself off `range` and ignored the
    // field entirely — so leaving it unset was the rule and setting it was the
    // trap. Both inverted with the shape.
    expect(tremor.aoeRadius).toBe(2);
    expect(tremor.appliesEffect).toEqual({
      type: AfflictionType.Stun,
      magnitude: 1,
      duration: 1,
      chance: 0.25,
    });
  });

  it('is cheap enough to press often', () => {
    expect(tremor.manaCost).toBeLessThanOrEqual(10);
    expect(tremor.cooldown).toBeLessThanOrEqual(2);
  });

  it('says the odds out loud', () => {
    const lines = skillEffectLines(tremor);
    expect(lines.some((l) => l.includes('25% chance') && l.includes('Stun'))).toBe(true);
  });
});

/**
 * The roll is per target, so a cast is not all-or-nothing.
 *
 * Driven through the real resolver with pinned combat dice, because the
 * rule that matters is the one the execution path applies — a predicate that
 * is right on its own and never consulted is the bug this pins against.
 */
describe('a chanced status across a cone', () => {
  const line = (position: HexCoord): CombatUnit =>
    makeFoe({ position, stats: makeStats({ defense: 0, maxHp: 500 }) });

  const cast = (rolls: number[]) => {
    const caster = makeUnit({
      position: at(0, 0), skills: [tremor], stats: makeStats({ magic: 10, defense: 0 }),
    });
    const foes = [line(at(1, 0)), line(at(2, 0))];
    useCombatStore.setState({ units: [caster, ...foes] });

    const queue = [...rolls];
    const spy = spyDice().mockImplementation(() => queue.shift() ?? 0.99);
    try {
      resolveSkillUse(caster, tremor, at(2, 0), SILENT_SINK);
    } finally {
      spy.mockRestore();
    }

    const after = useCombatStore.getState().units;
    return foes.map(
      (f) =>
        after
          .find((u) => u.id === f.id)!
          .activeEffects.some((e) => e.type === AfflictionType.Stun),
    );
  };

  it('stuns nobody when every roll misses', () => {
    expect(cast([0.9, 0.9, 0.9, 0.9])).toEqual([false, false]);
  });

  it('stuns everyone when every roll lands', () => {
    expect(cast([0.01, 0.01, 0.01, 0.01])).toEqual([true, true]);
  });
});

/**
 * The Giant Spider's bite is a *risk*, not a certainty.
 *
 * It is a free at-will with no cooldown that used to apply its dose every single
 * time — the trap `thorn_lash` records one file over, where a rider that always
 * lands stops being a rider and becomes the skill. Two spiders could walk a hero
 * to the dose cap in two turns without either of them choosing to, and what
 * waits at the cap is a burst priced as a capstone.
 *
 * Pinned on `venom_bite` by name rather than as a sweep over every free poison
 * source, and that is deliberate: `poisoned_shot` and `serrated_daggers` have the
 * same shape and were *not* changed, because poison is what those two enemies
 * are for. A sweep would either fail on them or need an exemption list, and an
 * exemption list that records the status quo is where the next real offender
 * goes to hide.
 */
describe('the spider bite is a chance', () => {
  it('rolls for its dose rather than applying one every time', () => {
    const [dose] = skillEffects(venomBite);
    expect(dose.type).toBe(AfflictionType.Poison);
    expect(dose.chance).toBeGreaterThan(0);
    expect(dose.chance).toBeLessThan(1);
  });

  it('says so in the description, so the badge not appearing reads as the dice', () => {
    expect(skillDescription(venomBite).toLowerCase()).toContain('sometimes');
  });
});
