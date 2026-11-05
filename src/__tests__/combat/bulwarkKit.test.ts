import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { requireUnit } from '@/systems/combat/unitLookup';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { hexDistance } from '@/utils/hexUtils';
import { challenge, intercept, reposition } from '@/data/skills/masterySkills';
import { findMasteryNode } from '@/data/skills/masteryData';
import { skillEffectLines } from '@/data/display/skillDisplay';
import { nodeModifierAt, nodeStatBonusAt } from '@/systems/progression/mastery';
import { AfflictionType, AuraType, CombatUnit, HeroStats } from '@/models/types';
import { at, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';
import { masteryNodeDescription } from '@/data/display/masteryText';

/**
 * The Bulwark's protection kit, as one contract.
 *
 * What is pinned is the rules the board and the tooltip both rely on: Challenge
 * taunts *and* blunts, Intercept keeps its dash / area Taunt / Barrier for the
 * Bulwark and the allies beside it, Anchored raises what the Bulwark *grants*
 * (Intercept included) and the tooltip says the same number the cast delivers,
 * (Set Stance left the tree in the 2026-10 remaster; see bulwarkRemaster.test.ts).
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ maxHp: 300, defense: 0, magic: 0, maxMana: 90, critChance: 0, dodgeChance: 0, ...over });

const state = () => useCombatStore.getState();
const effectsOn = (id: string) => requireUnit(state().units, id).activeEffects;
const effect = (id: string, type: AuraType | AfflictionType) => effectsOn(id).find((e) => e.type === type);

const tank = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'tank', position: at(0, 0), stats: stats(), skills: [challenge, intercept, reposition], ...over });

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  state().reset();
});

describe('Reposition', () => {
  it('dashes to any open hex across the board and keeps the whole shield', () => {
    const bulwark = tank();
    useCombatStore.setState({ units: [bulwark] });

    const result = resolveSkillUse(bulwark, reposition, at(3, 2), SILENT_SINK);

    expect(result.ok).toBe(true);
    expect(result.endsTurn).toBe(false);
    expect(requireUnit(state().units, 'tank').position).toEqual(at(3, 2));
    expect(effect('tank', AuraType.Barrier)!.magnitude).toBe(18);
  });

  it('dashes beside an ally and splits the shield, half each', () => {
    const bulwark = tank();
    const friend = makeUnit({ id: 'friend', position: at(3, 0), stats: stats() });
    useCombatStore.setState({ units: [bulwark, friend] });

    expect(resolveSkillUse(bulwark, reposition, friend.position, SILENT_SINK).ok).toBe(true);

    const landed = requireUnit(state().units, 'tank').position;
    expect(hexDistance(landed, friend.position)).toBe(1);
    expect(effect('tank', AuraType.Barrier)!.magnitude).toBe(9);
    expect(effect('friend', AuraType.Barrier)!.magnitude).toBe(9);
  });

  it('refuses an enemy as the aim', () => {
    const bulwark = tank();
    const foe = makeFoe({ id: 'foe', position: at(3, 0) });
    useCombatStore.setState({ units: [bulwark, foe] });

    expect(resolveSkillUse(bulwark, reposition, foe.position, SILENT_SINK).ok).toBe(false);
    expect(requireUnit(state().units, 'tank').position).toEqual(at(0, 0));
  });

  it('offers open ground and allies, not enemies', () => {
    const bulwark = tank();
    const friend = makeUnit({ id: 'friend', position: at(3, 0), stats: stats() });
    const foe = makeFoe({ id: 'foe', position: at(2, 1) });
    const hexes = getValidSkillTargetHexes(reposition, bulwark, [bulwark, friend, foe]);
    const has = (h: { q: number; r: number }) => hexes.some((x) => x.q === h.q && x.r === h.r);

    expect(has(friend.position)).toBe(true);
    expect(has(foe.position)).toBe(false);
    expect(has(at(3, 2))).toBe(true);
  });
});

describe('Challenge', () => {
  it('taunts the enemy and still blunts its swing', () => {
    const bulwark = tank();
    const foe = makeFoe({ id: 'foe', position: at(3, 0) });
    useCombatStore.setState({ units: [bulwark, foe] });

    expect(resolveSkillUse(bulwark, challenge, foe.position, SILENT_SINK).ok).toBe(true);

    expect(effect('foe', AfflictionType.Taunt)).toBeDefined();
    expect(effect('foe', AfflictionType.Taunt)!.sourceUnitId).toBe('tank');
    expect(effect('foe', AfflictionType.AttackDown)).toBeDefined();
  });

  it('says both on the tooltip', () => {
    const lines = skillEffectLines(challenge, tank()).join('\n');
    expect(lines).toContain('Taunt');
    expect(lines).toContain('Weakened');
  });
});

describe('Intercept', () => {
  const setup = () => {
    const bulwark = tank({ stats: stats({ attack: 40 }) });
    const friend = makeUnit({ id: 'friend', position: at(3, 0), stats: stats() });
    const neighbour = makeUnit({ id: 'neighbour', position: at(4, 0), stats: stats() });
    const distant = makeUnit({ id: 'distant', position: at(-3, 3), stats: stats() });
    const adjacentFoe = makeFoe({ id: 'adjacentFoe', position: at(3, 1), stats: stats() });
    const distantFoe = makeFoe({ id: 'distantFoe', position: at(-3, 4), stats: stats() });
    useCombatStore.setState({ units: [bulwark, friend, neighbour, distant, adjacentFoe, distantFoe] });
    return bulwark;
  };

  it('dashes in, taunts the area around the ally, and shields everyone beside it', () => {
    const bulwark = setup();
    const result = resolveSkillUse(bulwark, intercept, at(3, 0), SILENT_SINK);

    expect(result.ok).toBe(true);
    // The dash ended beside the ally
    expect(requireUnit(state().units, 'tank').position).not.toEqual(at(0, 0));

    expect(effect('adjacentFoe', AfflictionType.Taunt)).toBeDefined();
    expect(effect('distantFoe', AfflictionType.Taunt)).toBeUndefined();

    for (const id of ['tank', 'friend', 'neighbour']) {
      expect(effect(id, AuraType.Barrier)!.magnitude).toBeGreaterThan(0);
    }
    expect(effect('distant', AuraType.Barrier)).toBeUndefined();
  });

  it('keeps its Barrier through the Bulwark\'s own next turn', () => {
    const bulwark = setup();
    resolveSkillUse(bulwark, intercept, at(3, 0), SILENT_SINK);
    const granted = effect('tank', AuraType.Barrier)!.magnitude;

    // The start of the Bulwark's next turn ticks every effect once
    state().tickEffectsOnUnit('tank');

    // Duration 2: one tick has been taken, and the shield is still the shield it was
    const kept = effect('tank', AuraType.Barrier);
    expect(kept).toBeDefined();
    expect(kept!.magnitude).toBe(granted);
  });
});

describe('Anchored raises the shields the Bulwark grants', () => {
  const node = findMasteryNode('bulwark_anchored')!.node;

  it('is a Defense and outgoing-shield node, worth more at every rank', () => {
    const at1 = nodeStatBonusAt(node, 1);
    const at2 = nodeStatBonusAt(node, 2);
    const at3 = nodeStatBonusAt(node, 3);
    for (const key of ['defense', 'shieldPower'] as const) {
      expect(at1[key]!).toBeLessThan(at2[key]!);
      expect(at2[key]!).toBeLessThan(at3[key]!);
    }
  });

  it('describes the outgoing effect, not shields received', () => {
    expect(masteryNodeDescription(node)).not.toMatch(/put over you|received|wear/i);
    expect(masteryNodeDescription(node)).toMatch(/Intercept/);
    expect(masteryNodeDescription(node)).toMatch(/shield you raise/);
  });

  const barrierFrom = (shieldPower: number, skill = intercept) => {
    const bulwark = tank({ stats: stats({ attack: 40, shieldPower }) });
    const friend = makeUnit({ id: 'friend', position: at(3, 0), stats: stats() });
    useCombatStore.setState({ units: [bulwark, friend] });
    resolveSkillUse(bulwark, skill, friend.position, SILENT_SINK);
    return { friend: effect('friend', AuraType.Barrier)!.magnitude, tank: effect('tank', AuraType.Barrier)!.magnitude };
  };

  it('raises the Intercept Barrier on the ally and on the Bulwark alike', () => {
    const plain = barrierFrom(0);
    const anchored = barrierFrom(nodeStatBonusAt(node, 3).shieldPower!);
    expect(anchored.friend).toBeGreaterThan(plain.friend);
    expect(anchored.tank).toBeGreaterThan(plain.tank);
  });

  it('does not raise a shield somebody else puts on the Bulwark', () => {
    const received = (shieldPower: number) => {
      const wall = tank({ stats: stats({ shieldPower }), position: at(3, 0) });
      const priest = makeUnit({
        id: 'priest', position: at(0, 0), stats: stats({ attack: 40 }), skills: [intercept],
      });
      useCombatStore.setState({ units: [wall, priest] });
      resolveSkillUse(priest, intercept, wall.position, SILENT_SINK);
      return effect('tank', AuraType.Barrier)!.magnitude;
    };
    // The Bulwark's own bonus is the Bulwark knowing its craft; it does not
    // make the shields it *wears* from someone else any bigger
    expect(received(50)).toBe(received(0));
  });

  it('shows the tooltip number the cast delivers, flat Barrier included', () => {
    const shieldPower = nodeStatBonusAt(node, 2).shieldPower!;
    const caster = tank({ stats: stats({ shieldPower }) });
    const preview = skillEffectLines(reposition, caster).find((l) => l.includes('Barrier'))!;

    // Aimed at open ground the whole shield comes up on the Bulwark
    useCombatStore.setState({ units: [caster] });
    resolveSkillUse(caster, reposition, at(2, 0), SILENT_SINK);
    const landed = effect('tank', AuraType.Barrier)!.magnitude;

    expect(preview).toContain(`Barrier ${Math.round(landed)}`);
    // And it is not the authored 18 a plain Bulwark shows
    expect(landed).toBeGreaterThan(18);
  });

  it('shows the Intercept number the cast delivers', () => {
    const caster = tank({ stats: stats({ attack: 40, shieldPower: 8 }) });
    const preview = skillEffectLines(intercept, caster).find((l) => l.includes('Barrier'))!;
    const friend = makeUnit({ id: 'friend', position: at(3, 0), stats: stats() });
    useCombatStore.setState({ units: [caster, friend] });
    resolveSkillUse(caster, intercept, friend.position, SILENT_SINK);
    expect(preview).toContain(`Barrier ${Math.round(effect('friend', AuraType.Barrier)!.magnitude)}`);
  });
});

describe('Deep Plates', () => {
  it('stays a simple HP node, a percentage with a benefit at every rank', () => {
    const node = findMasteryNode('bulwark_deep_plates')!.node;
    expect(node.grantsPassive).toBeUndefined();
    expect(node.grantsSkill).toBeUndefined();
    expect(node.statBonus).toBeUndefined();
    expect(nodeStatBonusAt(node, 2)).toEqual({});
    const pct = [1, 2, 3].map((l) => nodeModifierAt(node, l).maxHpPercentBonus!);
    expect(Object.keys(nodeModifierAt(node, 1))).toEqual(['maxHpPercentBonus']);
    expect(pct[0]).toBeLessThan(pct[1]);
    expect(pct[1]).toBeLessThan(pct[2]);
  });
});
