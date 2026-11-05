import { SILENT_SINK } from '@/systems/combat/combatSink';
import { spyDice } from '../support/dice';
import { useCombatStore } from '@/stores/combatStore';
import { executeAIActions } from '@/systems/combat/enemyAI';
import { CombatSink, resolveSkillUse } from '@/systems/combat/skillResolution';
import { requireUnit } from '@/systems/combat/unitLookup';
import { slash } from '@/data/skills/skillData';
import { FLOAT_COLOR, floatOutline } from '@/data/display/floatColors';
import { outlinedTextBitmap } from '@/data/display/combatGlyphs';
import type { HeroSkill } from '@/models/types';
import { critLabel, critText, readFloat } from '@/utils/floatText';
import { at, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * A critical hit's number says so in words: the arena draws CRITICAL beside a
 * larger number in the hit's own colour (playtest 2026-10-13; it was gold). Both paths float a crit as `-N!`; the AI's number reaches
 * the scene as an amount, so it has to carry the crit beside it.
 */

describe('how a float reads as a crit', () => {
  it('reads `-N!` as a crit and draws the number without the mark', () => {
    expect(readFloat('-12!')).toEqual({ text: '-12', crit: true });
    expect(readFloat('-12')).toEqual({ text: '-12', crit: false });
    expect(readFloat('-12', true)).toEqual({ text: '-12', crit: true });
  });

  it('leaves words alone, exclamation or not', () => {
    expect(readFloat('SHATTER -9')).toEqual({ text: 'SHATTER -9', crit: false });
    expect(readFloat('DODGED')).toEqual({ text: 'DODGED', crit: false });
    expect(readFloat('Bleed!')).toEqual({ text: 'Bleed!', crit: false });
  });

  it('floats a crit from either side as the same text', () => {
    expect(critText(12, true)).toBe('-12!');
    expect(critText(12, false)).toBe('-12');
    expect(critLabel()).toBe('CRITICAL');
  });
});

describe('both sides of the fight float a crit as one', () => {
  let random: jest.SpyInstance;
  beforeEach(() => {
    resetFixtureIds();
    random = spyDice().mockReturnValue(0.99);
  });
  afterEach(() => random.mockRestore());

  const fight = (casterIsPlayer: boolean) => {
    useCombatStore.getState().reset();
    const caster = makeUnit({
      id: 'caster', isPlayer: casterIsPlayer, position: at(0, 0), skills: [slash],
      stats: makeStats({ attack: 20, critChance: 100 }),
    });
    const target = makeUnit({ id: 'target', isPlayer: !casterIsPlayer, position: at(0, 1), stats: makeStats({ maxHp: 200 }) });
    useCombatStore.getState().initCombat(casterIsPlayer ? [caster] : [target], casterIsPlayer ? [target] : [caster]);
    return requireUnit(useCombatStore.getState().units, 'caster');
  };

  it('hands the AI\'s crit to the scene with its number, as the player\'s resolver floats it', () => {
    const floats: string[] = [];
    const sink: CombatSink = { log: () => {}, float: (_at, text) => floats.push(text), vfx: () => {}, status: () => {} };
    resolveSkillUse(fight(true), slash, at(0, 1), sink);

    const enemyFloats: string[] = [];
    executeAIActions(
      fight(false), [{ type: 'skill', skill: slash, skillTarget: at(0, 1) }],
      { ...SILENT_SINK, float: (_at, text) => enemyFloats.push(text) },
    );

    expect(floats.some((t) => readFloat(t).crit)).toBe(true);
    expect(enemyFloats.length).toBeGreaterThan(0);
    expect(enemyFloats.every((t) => readFloat(t).crit)).toBe(true);
    expect(enemyFloats).toEqual(floats);
  });
});

describe('what colour a number is', () => {
  let random: jest.SpyInstance;
  beforeEach(() => {
    resetFixtureIds();
    useCombatStore.getState().reset();
  });
  afterEach(() => random.mockRestore());

  const colourOf = (skill: HeroSkill, crit: boolean) => {
    random = spyDice().mockReturnValue(crit ? 0 : 0.99);
    const caster = makeUnit({
      id: 'caster', position: at(0, 0), skills: [skill],
      stats: makeStats({ attack: 20, magic: 20, critChance: crit ? 100 : 0 }),
    });
    const target = makeUnit({ id: 'target', isPlayer: false, position: at(0, 1), stats: makeStats({ maxHp: 500 }) });
    useCombatStore.getState().initCombat([caster], [target]);
    const floats: { text: string; color: string }[] = [];
    resolveSkillUse(requireUnit(useCombatStore.getState().units, 'caster'), skill, at(0, 1),
      { ...SILENT_SINK, float: (_at, text, color) => floats.push({ text, color }) });
    random.mockRestore();
    return floats.find((f) => /^-\d+!?$/.test(f.text))!;
  };

  it('colours a hit by its damage type, and keeps that colour on a crit', () => {
    const plain = colourOf(slash, false);
    const crit = colourOf(slash, true);
    expect(plain.color).toBe(FLOAT_COLOR.physical);
    expect(readFloat(crit.text).crit).toBe(true);
    expect(crit.color).toBe(FLOAT_COLOR.physical);
    const spell: HeroSkill = { ...slash, damageType: 'magic' };
    expect(colourOf(spell, false).color).toBe(FLOAT_COLOR.magic);
  });

  it('outlines dark numbers in light and everything else in dark', () => {
    expect(floatOutline(FLOAT_COLOR.physical)).toBe('#e6e6e6');
    for (const c of [FLOAT_COLOR.magic, FLOAT_COLOR.bleed, FLOAT_COLOR.poison, FLOAT_COLOR.heal, FLOAT_COLOR.barrier]) {
      expect(floatOutline(c)).toBe('#141414');
    }
    // One pixel of padding round the 3x5 face, the outline closing every side
    const bitmap = outlinedTextBitmap('1', '#ffffff', '#000000');
    expect([bitmap.width, bitmap.height]).toEqual([5, 7]);
    const alpha = (x: number, y: number) => bitmap.pixels[(y * bitmap.width + x) * 4 + 3];
    expect(alpha(0, 0)).toBe(255);
  });
});
