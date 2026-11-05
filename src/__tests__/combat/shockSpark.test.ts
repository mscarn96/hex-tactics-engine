import { SILENT_SINK } from '@/systems/combat/combatSink';
import { spyDice } from '../support/dice';
import { resolveSkillUse, CombatSink } from '@/systems/combat/skillResolution';
import { executeAIActions } from '@/systems/combat/enemyAI';
import { useCombatStore } from '@/stores/combatStore';
import { slash, thunderbeat } from '@/data/skills/skillData';
import { AfflictionType, CombatUnit, HexCoord, VfxSpec } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { requireUnit } from '@/systems/combat/unitLookup';
import { SHOCK_COLOR } from '@/systems/combat/combatEvents';
import { at, makeEffect, makeStats, makeUnit } from '../support/fixtures';

/**
 * A Shock spark is sized from the whole blow, overkill included, so a killing
 * blow on a nearly dead shocked unit still jumps with the weight of the hit. It
 * is drawn as a bolt from the struck unit to the one it hurts, with its number.
 * Only a spell that itself applies Shock sets it off (the Stormcaller remaster,
 * 2026-10) — a Basic Attack on a Shocked unit does not.
 */

const unit = (id: string, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ id, isPlayer: false, stats: makeStats({ maxHp: 400, attack: 60, magic: 60, defense: 0, magicDefense: 0, critChance: 0, dodgeChance: 0 }), ...over });

const hpOf = (id: string) => requireUnit(useCombatStore.getState().units, id).currentHp;

function recorder() {
  const floats: { at: HexCoord; text: string; color: string }[] = [];
  const impact: VfxSpec[] = [];
  const sink: CombatSink = {
    log: () => {},
    float: (a, text, color) => floats.push({ at: a, text, color }),
    vfx: () => {},
    status: () => {},
    impactVfx: (spec) => impact.push(spec),
  };
  return { sink, floats, impact };
}

let random: jest.SpyInstance;
beforeEach(() => { random = spyDice().mockReturnValue(0.99); });
afterEach(() => random.mockRestore());

describe('Shock spark', () => {
  it('is sized from the full blow when the blow kills, and is drawn and numbered', () => {
    useCombatStore.getState().reset();
    const hero = unit('hero', { isPlayer: true, position: at(0, 0), skills: [thunderbeat] });
    // Nearly dead and shocked, with an ally beside it
    const foe = unit('foe', { position: at(0, 1), currentHp: 3, activeEffects: [makeEffect(AfflictionType.Shock, { duration: 3 })] });
    const ally = unit('ally', { position: at(1, 1) });
    useCombatStore.getState().initCombat([hero], [foe, ally]);

    const blow = calculateDamage(hero, foe, thunderbeat);
    expect(blow).toBeGreaterThan(3 * 4);
    const rec = recorder();
    resolveSkillUse(requireUnit(useCombatStore.getState().units, 'hero'), thunderbeat, foe.position, rec.sink);

    expect(hpOf('foe')).toBe(0);
    const spark = Math.round(blow * BALANCE.SHOCK_CHAIN_FRACTION);
    expect(hpOf('ally')).toBe(400 - spark);
    expect(rec.impact).toEqual([
      expect.objectContaining({ kind: 'lightning', casterPos: foe.position, targetCoord: ally.position, color: SHOCK_COLOR }),
    ]);
    expect(rec.floats).toContainEqual({ at: ally.position, text: `-${spark}`, color: SHOCK_COLOR });
  });

  it('spreads to the heroes when an enemy strikes a shocked hero, on the AI path', () => {
    useCombatStore.getState().reset();
    const hero = unit('hero', {
      isPlayer: true, position: at(0, 0), currentHp: 2,
      activeEffects: [makeEffect(AfflictionType.Shock, { duration: 3 })],
    });
    const friend = unit('friend', { isPlayer: true, position: at(1, 0) });
    const foe = unit('foe', { position: at(0, 1), skills: [thunderbeat] });
    useCombatStore.getState().initCombat([hero, friend], [foe]);

    const blow = calculateDamage(foe, hero, thunderbeat);
    const impact: VfxSpec[] = [];
    executeAIActions(
      requireUnit(useCombatStore.getState().units, 'foe'),
      [{ type: 'skill', skill: thunderbeat, skillTarget: hero.position }],
      { ...SILENT_SINK, impactVfx: (spec) => impact.push(spec) },
    );

    expect(hpOf('hero')).toBe(0);
    expect(hpOf('friend')).toBe(400 - Math.round(blow * BALANCE.SHOCK_CHAIN_FRACTION));
    expect(impact.map((s) => s.kind)).toContain('lightning');
  });

  it('is not set off by a Basic Attack, on either path', () => {
    useCombatStore.getState().reset();
    const hero = unit('hero', { isPlayer: true, position: at(0, 0), skills: [slash] });
    const foe = unit('foe', { position: at(0, 1), activeEffects: [makeEffect(AfflictionType.Shock, { duration: 3 })] });
    const ally = unit('ally', { position: at(1, 1) });
    useCombatStore.getState().initCombat([hero], [foe, ally]);
    const rec = recorder();
    resolveSkillUse(requireUnit(useCombatStore.getState().units, 'hero'), slash, foe.position, rec.sink);
    expect(hpOf('foe')).toBeLessThan(400);
    expect(hpOf('ally')).toBe(400);
    expect(rec.impact).toEqual([]);

    useCombatStore.getState().reset();
    const shocked = unit('hero', { isPlayer: true, position: at(0, 0), activeEffects: [makeEffect(AfflictionType.Shock, { duration: 3 })] });
    const friend = unit('friend', { isPlayer: true, position: at(1, 0) });
    const brute = unit('foe', { position: at(0, 1), skills: [slash] });
    useCombatStore.getState().initCombat([shocked, friend], [brute]);
    executeAIActions(
      requireUnit(useCombatStore.getState().units, 'foe'),
      [{ type: 'skill', skill: slash, skillTarget: shocked.position }],
    );
    expect(hpOf('hero')).toBeLessThan(400);
    expect(hpOf('friend')).toBe(400);
  });
});
