import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { layOnHands, martyr } from '@/data/skills/masterySkills';
import { findMasteryNode, findMasteryPath } from '@/data/skills/masteryData';
import { nodeSimpleText, skillSimpleText } from '@/data/display/simpleText';
import { wearsMartyrBubble } from '@/data/display/auraGlow';
import { describeSkill } from '@/data/display/skillDisplay';
import { calculateHealing } from '@/systems/combat/damageCalc';
import { getSkillTargets, getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { requireUnit } from '@/systems/combat/unitLookup';
import { nodeSkillAt } from '@/systems/progression/mastery';
import { AuraType, CombatUnit, HeroStats, LEVEL_SCALE } from '@/models/types';
import { at, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * The Templar remaster (2026-10): the swapped tree, Lay on Hands as one cast that
 * heals the Templar and one ally, and the Martyr's bubble. The rules are pinned —
 * who receives a heal, how often, through whose modifiers, and how many caster
 * charges one cast can make — rather than the tuning numbers.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ maxHp: 300, defense: 0, magic: 40, attack: 20, maxMana: 100, critChance: 0, dodgeChance: 0, ...over });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const rank = (level: number) => ({ level, scale: LEVEL_SCALE[level - 1] });
const node = (id: string) => findMasteryNode(id)!.node;

const templar = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'templar', position: at(0, 0), stats: stats(), currentHp: 100, skills: [layOnHands], ...over });

beforeEach(() => {
  resetFixtureIds();
  state().reset();
});

describe('Templar tree layout', () => {
  it('swaps Faith with Zealotry and Lay on Hands with Judgement, keeping Zeal central', () => {
    const col = (id: string) => node(id).column;
    expect(col('templar_zealotry')).toBe(0);
    expect(col('templar_faith')).toBe(3);
    expect(col('templar_zeal')).toBe(2);
    expect(col('templar_judgement')).toBe(1);
    expect(col('templar_lay_on_hands')).toBe(2);
    // Identities, not effects, moved
    expect(node('templar_faith').statBonus).toEqual({ maxMana: 10 });
    expect(node('templar_faith').modifier).toEqual({ magicPercentBonus: 0.08 });
    expect(node('templar_zealotry').statBonus).toEqual({ attack: 3 });
    expect(node('templar_zealotry').modifier).toEqual({ magicPercentBonus: 0.06 });
    expect(node('templar_judgement').grantsSkill).toBe('judgement');
    expect(node('templar_lay_on_hands').grantsSkill).toBe('lay_on_hands');
  });
});

describe('Lay on Hands', () => {
  it('scales its per-recipient heal by rung, 0.75 / 1 / 1.25 of the middle', () => {
    const heal = (level: number) => nodeSkillAt(node('templar_lay_on_hands'), level)!.healing;
    expect(heal(2)).toBe(layOnHands.healing);
    expect(heal(1)! / heal(2)!).toBeCloseTo(0.75);
    expect(heal(3)! / heal(2)!).toBeCloseTo(1.25);
  });

  it('heals the aimed ally and the Templar, each for the whole heal', () => {
    const me = templar();
    const friend = makeUnit({ id: 'friend', position: at(2, 0), stats: stats(), currentHp: 100 });
    useCombatStore.setState({ units: [me, friend] });
    const each = calculateHealing(me, layOnHands, friend);

    const result = resolveSkillUse(me, layOnHands, friend.position, SILENT_SINK);

    expect(result.ok).toBe(true);
    expect(unitNow('friend').currentHp - 100).toBe(each);
    expect(unitNow('templar').currentHp - 100).toBe(calculateHealing(me, layOnHands, me));
    // Not one pool split in two
    expect(each).toBe(calculateHealing(me, layOnHands));
  });

  it('says in its detailed sentence that both the ally and the Templar are healed', () => {
    expect(describeSkill(layOnHands)).toMatch(/an ally up to 3 hexes away and yourself, each,/);
  });

  it('heals the Templar once when aimed at the Templar', () => {
    const me = templar();
    useCombatStore.setState({ units: [me] });
    expect(getSkillTargets(layOnHands, me.position, me.position, [me])).toHaveLength(1);

    resolveSkillUse(me, layOnHands, me.position, SILENT_SINK);

    expect(unitNow('templar').currentHp - 100).toBe(calculateHealing(me, layOnHands, me));
  });

  it('resolves each heal through its own recipient\'s modifiers', () => {
    const me = templar();
    const plated = makeUnit({
      id: 'plated', position: at(1, 0), stats: stats(), currentHp: 100,
      masteryModifiers: { incomingSupportBonus: 0.5 },
    });
    useCombatStore.setState({ units: [me, plated] });

    resolveSkillUse(me, layOnHands, plated.position, SILENT_SINK);

    const toTemplar = unitNow('templar').currentHp - 100;
    const toPlated = unitNow('plated').currentHp - 100;
    expect(toPlated).toBeGreaterThan(toTemplar);
  });

  it('can be aimed at an ally within range or the Templar, never at empty ground or an enemy', () => {
    const me = templar();
    const near = makeUnit({ id: 'near', position: at(3, 0) });
    const far = makeUnit({ id: 'far', position: at(0, 5) });
    const foe = makeFoe({ id: 'foe', position: at(1, 0) });
    const units = [me, near, far, foe];
    useCombatStore.setState({ units });

    const valid = getValidSkillTargetHexes(layOnHands, me, units).map((h) => `${h.q},${h.r}`).sort();
    expect(valid).toEqual(['0,0', '3,0']);

    expect(resolveSkillUse(me, layOnHands, at(-1, 0), SILENT_SINK).ok).toBe(false);
    expect(resolveSkillUse(me, layOnHands, foe.position, SILENT_SINK).ok).toBe(false);
    expect(unitNow('templar').currentHp).toBe(100);
  });

  it('gives Blessed Hands\' regeneration to both recipients', () => {
    const me = templar({ passives: ['lifebloom'], passiveRanks: { lifebloom: rank(2) } });
    const friend = makeUnit({ id: 'friend', position: at(1, 0), stats: stats(), currentHp: 100 });
    useCombatStore.setState({ units: [me, friend] });

    resolveSkillUse(me, layOnHands, friend.position, SILENT_SINK);

    const hot = (id: string) => unitNow(id).activeEffects.filter((e) => e.type === AuraType.HealOverTime);
    expect(hot('friend')).toHaveLength(1);
    expect(hot('templar')).toHaveLength(1);
  });

  it('makes one Sacred Rhythm charge however many recipients it restores', () => {
    const me = templar({ passives: ['sacredRhythm'], passiveRanks: { sacredRhythm: rank(1) } });
    const friend = makeUnit({ id: 'friend', position: at(1, 0), stats: stats(), currentHp: 100 });
    useCombatStore.setState({ units: [me, friend] });

    resolveSkillUse(me, layOnHands, friend.position, SILENT_SINK);

    const charges = unitNow('templar').activeEffects.filter((e) => e.type === AuraType.SacredRhythm);
    expect(charges).toHaveLength(1);
    expect(charges[0].magnitude).toBe(Math.round(40 * 0.4));
  });

  it('gives Oath\'s ward to the ally and one ward to the Templar', () => {
    const me = templar({ passives: ['oath'], passiveRanks: { oath: rank(2) } });
    const friend = makeUnit({ id: 'friend', position: at(1, 0), stats: stats(), currentHp: 100 });
    useCombatStore.setState({ units: [me, friend] });

    resolveSkillUse(me, layOnHands, friend.position, SILENT_SINK);

    const wards = (id: string) => unitNow(id).activeEffects.filter((e) => e.type === AuraType.MagicDefenseBuff);
    expect(wards('friend')).toHaveLength(1);
    expect(wards('templar')).toHaveLength(1);
  });
});

describe('Martyr', () => {
  it('keeps its protection and seal mechanics', () => {
    const types = (Array.isArray(martyr.appliesEffect) ? martyr.appliesEffect : [martyr.appliesEffect!]).map((e) => e.type);
    expect(types).toEqual([AuraType.Invulnerability, AuraType.DebuffImmunity, AuraType.MartyrSeal]);
    expect(martyr.vfxPrelude).toBe('halo');
  });

  it('wears the bubble exactly while the Martyr\'s protection lasts', () => {
    const me = templar();
    const friend = makeUnit({ id: 'friend', position: at(1, 0) });
    const foe = makeFoe({ id: 'foe', position: at(2, 0) });
    useCombatStore.setState({ units: [me, friend, foe] });

    resolveSkillUse(me, martyr, friend.position, SILENT_SINK);
    expect(wearsMartyrBubble(unitNow('friend').activeEffects)).toBe(true);

    state().tickEffectsOnUnit('friend');
    expect(wearsMartyrBubble(unitNow('friend').activeEffects)).toBe(true);

    // The tick that detonates the seal also lifts the protection, and the bubble with it
    const hpBefore = unitNow('foe').currentHp;
    state().tickEffectsOnUnit('friend');
    expect(unitNow('foe').currentHp).toBeLessThan(hpBefore);
    expect(wearsMartyrBubble(unitNow('friend').activeEffects)).toBe(false);
  });

  it('draws no bubble for an Invulnerability that is not the Martyr\'s', () => {
    expect(wearsMartyrBubble([{ type: AuraType.Invulnerability }])).toBe(false);
  });
});

describe('Templar Simple descriptions', () => {
  const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z])/).length;

  it('covers every Templar node in one or two sentences', () => {
    for (const n of findMasteryPath('templar')!.nodes) {
      for (const level of [1, 2, 3]) {
        const text = nodeSimpleText(n, level);
        expect({ id: n.id, text }).toEqual({ id: n.id, text: expect.any(String) });
        expect(sentences(text!)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('resolves Lay on Hands\' coefficient to the rank shown', () => {
    expect(nodeSimpleText(node('templar_lay_on_hands'), 1)).toContain('0.7x');
    expect(nodeSimpleText(node('templar_lay_on_hands'), 2)).toContain('0.9x');
    expect(nodeSimpleText(node('templar_lay_on_hands'), 3)).toContain('1.1x');
    expect(skillSimpleText(martyr)).toBe(
      'Protect one ally or yourself from damage and debuffs for two turns, then damage nearby enemies when the protection ends.',
    );
  });
});
