import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { requireUnit } from '@/systems/combat/unitLookup';
import { at, makeFoe, makeSkill, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * Playtest 2026-10-08: a unit finished at 0 HP and stayed on the board after a
 * Retaliation. The attacker's drain settles after the whole strike, by which
 * time Retaliation had killed it — and `healUnit` mended the corpse. Nothing in
 * combat revives, so a dead unit takes no healing from any route.
 */

const state = () => useCombatStore.getState();

beforeEach(() => {
  resetFixtureIds();
  state().reset();
});

describe('a unit Retaliation kills', () => {
  it('stays dead when its own lifesteal settles after the blow', () => {
    const drain = makeSkill({ damage: 1, lifesteal: 0.5 });
    const attacker = makeUnit({
      id: 'hero', position: at(0, 0), currentHp: 1, skills: [drain],
      stats: makeStats({ attack: 40, critChance: 0 }),
    });
    const bulwark = makeFoe({
      id: 'bulwark', position: at(1, 0), passives: ['retaliation'],
      stats: makeStats({ maxHp: 500, defense: 0, dodgeChance: 0 }),
    });
    useCombatStore.setState({ units: [attacker, bulwark] });

    resolveSkillUse(attacker, drain, at(1, 0), SILENT_SINK);

    expect(requireUnit(state().units, 'bulwark').currentHp).toBeLessThan(500);
    expect(requireUnit(state().units, 'hero').currentHp).toBe(0);
  });
});

describe('healUnit', () => {
  it('restores nothing to a dead unit', () => {
    useCombatStore.setState({ units: [makeUnit({ id: 'corpse', currentHp: 0 })] });
    expect(state().healUnit('corpse', 50, 'corpse')).toBe(0);
    expect(requireUnit(state().units, 'corpse').currentHp).toBe(0);
  });

  it('still heals a unit standing on 1 HP', () => {
    useCombatStore.setState({ units: [makeUnit({ id: 'barely', currentHp: 1 })] });
    expect(state().healUnit('barely', 10)).toBe(10);
  });
});
