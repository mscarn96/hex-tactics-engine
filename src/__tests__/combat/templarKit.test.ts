import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { divineLight } from '@/data/skills/skillData';
import { describeSkill, skillEffectLines } from '@/data/display/skillDisplay';
import { findMasteryNode } from '@/data/skills/masteryData';
import { requireUnit } from '@/systems/combat/unitLookup';
import { AfflictionType, CombatUnit, HeroStats } from '@/models/types';
import { at, makeEffect, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';
import { masteryNodeDescription } from '@/data/display/masteryText';

/**
 * The Templar's kit: the ally cleanse, Oath, and the Mercy / Wrath choice.
 *
 * What is pinned is the rules — who a cleanse reaches and what it costs, what
 * counts as a heal that "did something", how an area heal hands out Oath's
 * ward, and that the numbers the Mercy / Wrath choice shows are the numbers the
 * cast delivers — rather than the tuning values the cases happen to use.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ maxHp: 200, defense: 0, magic: 20, attack: 20, maxMana: 100, critChance: 0, dodgeChance: 0, ...over });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);

const templar = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'templar', position: at(0, 0), stats: stats(), skills: [divineLight], ...over });

beforeEach(() => {
  resetFixtureIds();
  state().reset();
});

describe('the ally cleanse is on Divine Light', () => {
  const poisoned = (id: string, position = at(1, 0)) =>
    makeUnit({
      id,
      position,
      currentHp: 100,
      stats: stats(),
      activeEffects: [makeEffect(AfflictionType.Poison, { magnitude: 5 }), makeEffect(AfflictionType.Root)],
    });

  it('removes every affliction from the allies in reach, the caster included', () => {
    const me = templar({
      currentHp: 100,
      activeEffects: [makeEffect(AfflictionType.Burn, { magnitude: 3 })],
    });
    const near = poisoned('near');
    const far = poisoned('far', at(0, 6));
    const foe = makeFoe({
      id: 'foe',
      position: at(2, 0),
      activeEffects: [makeEffect(AfflictionType.Poison, { magnitude: 5 })],
    });
    useCombatStore.setState({ units: [me, near, far, foe] });

    expect(resolveSkillUse(me, divineLight, me.position, SILENT_SINK).ok).toBe(true);

    expect(unitNow('templar').activeEffects).toEqual([]);
    expect(unitNow('near').activeEffects).toEqual([]);
    // Out of the radius, and on the other side: untouched
    expect(unitNow('far').activeEffects.length).toBe(2);
    expect(unitNow('foe').activeEffects.length).toBe(1);
  });

  it('still heals', () => {
    const me = templar({ currentHp: 100 });
    useCombatStore.setState({ units: [me] });
    resolveSkillUse(me, divineLight, me.position, SILENT_SINK);
    expect(unitNow('templar').currentHp).toBeGreaterThan(100);
  });

  /**
   * The cost is the point of the tradeoff, so it is pinned as a class: it must
   * be dearer in mana, gated by a cooldown and lighter in healing than the
   * cleanse-less skill it replaced (1.3 healing, 18 mana, no cooldown), and it
   * must not refund anything.
   */
  it('is paid for in mana, healing and a cooldown, and refunds nothing', () => {
    expect(divineLight.cleanse).toBe(true);
    expect(divineLight.manaCost).toBeGreaterThan(18);
    expect(divineLight.healing!).toBeLessThan(1.3);
    expect(divineLight.cooldown).toBeGreaterThanOrEqual(3);
    expect(divineLight.appliesEffect).toBeUndefined();
    expect(divineLight.lifesteal).toBeUndefined();
  });

  it('puts the cooldown on the board after a cast', () => {
    const me = templar({ currentHp: 100 });
    useCombatStore.setState({ units: [me] });
    resolveSkillUse(me, divineLight, me.position, SILENT_SINK);
    expect(unitNow('templar').cooldowns?.divine_light).toBeGreaterThanOrEqual(divineLight.cooldown!);
    expect(unitNow('templar').currentMana).toBe(100 - divineLight.manaCost);
  });

  it('is described on the tooltip and on the node', () => {
    expect(describeSkill(divineLight)).toMatch(/afflictions/);
    expect(skillEffectLines(divineLight).join('\n')).toMatch(/Removes all afflictions/);
    expect(masteryNodeDescription(findMasteryNode('templar_divine_light')!.node)).toMatch(/afflictions/);
  });
});
