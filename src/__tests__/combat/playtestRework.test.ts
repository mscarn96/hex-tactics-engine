import { AfflictionType, AuraType, SkillTargetType } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { smite, righteousFury, sanction } from '@/data/skills/mastery/champion';
import { upheaval, tremor, stoneskin } from '@/data/skills/mastery/druid';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { requireUnit } from '@/systems/combat/unitLookup';
import { applyOnHeal, applyOnCleanse } from '@/systems/combat/combatEvents';
import { beginTurn } from '@/systems/combat/turnStart';
import { rampartBlocksShot, rampartPair } from '@/systems/combat/ramparts';
import { castObjectives } from '@/systems/combat/objectiveBoard';
import { calculateDamage, skillDamagePreview } from '@/systems/combat/damageCalc';
import { canUseSkill } from '@/systems/combat/cooldowns';
import { at, makeEffect, makeFoe, makeSkill, makeStats, makeUnit } from '../support/fixtures';

const state = () => useCombatStore.getState();
const current = (id: string) => requireUnit(state().units, id);
const stats = makeStats({ maxHp: 1000, maxMana: 1000, magic: 40, attack: 40, defense: 0, magicDefense: 0, critChance: 0, dodgeChance: 0 });
const basic = makeSkill({ id: 'basic_attack', damage: 1 });
beforeEach(() => state().reset());

it('caps Fury at three stacks, extends only Basic Attack and Smite once, and restores range when removed', () => {
  const hero = makeUnit({ id: 'hero', stats, skills: [basic, smite, sanction] });
  state().initCombat([hero], [makeFoe({ position: at(1, 0) })]);
  for (let i = 0; i < 20; i++) state().applyEffect('hero', makeEffect(AuraType.BlessedWeapon, { magnitude: 20, duration: -1 }));
  expect(current('hero').activeEffects[0]).toMatchObject({ stacks: 3, magnitude: 60 });
  expect(current('hero').skills.map(s => s.range)).toEqual([2, 2, sanction.range]);
  expect(canUseSkill(current('hero'), righteousFury)).toBe(false);
  state().removeEffect('hero', AuraType.BlessedWeapon);
  expect(current('hero').skills.map(s => s.range)).toEqual([1, 1, sanction.range]);
});

it('Fury damage uses magic defense and preview includes the same rider', () => {
  const hero = makeUnit({ stats, activeEffects: [makeEffect(AuraType.BlessedWeapon, { magnitude: 20 })] });
  const soft = makeFoe({ stats });
  const warded = makeFoe({ stats: { ...stats, magicDefense: 10 } });
  // Magic Defence answers the holy rider and nothing else here: a warded foe takes less
  expect(calculateDamage(hero, warded, basic)).toBeLessThan(calculateDamage(hero, soft, basic));
  expect(skillDamagePreview(hero, basic)).toBe(calculateDamage(hero, soft, basic));
  expect(calculateDamage(hero, soft, sanction)).toBe(calculateDamage({ ...hero, activeEffects: [] }, soft, sanction));
});

it('Rhythm needs restored HP, ignores cleansing, uses effective Magic and spends one charge on a landed holy attack', () => {
  const hero = makeUnit({ id: 'hero', stats, skills: [basic], passives: ['sacredRhythm'], activeEffects: [makeEffect(AuraType.MagicBuff, { magnitude: 10 })] });
  const foe = makeFoe({ id: 'foe', stats, position: at(1, 0) });
  state().initCombat([hero], [foe]);
  applyOnHeal(hero, hero, 20, SILENT_SINK, 0);
  applyOnCleanse(hero, hero, 1, SILENT_SINK);
  expect(current('hero').activeEffects.some(e => e.type === AuraType.SacredRhythm)).toBe(false);
  applyOnHeal(hero, hero, 20, SILENT_SINK, 20);
  expect(current('hero').activeEffects.find(e => e.type === AuraType.SacredRhythm)?.magnitude).toBe(20);
  expect(resolveSkillUse(current('hero'), basic, foe.position, SILENT_SINK).ok).toBe(true);
  expect(current('hero').activeEffects.some(e => e.type === AuraType.SacredRhythm)).toBe(false);
});

it('Sacred Seal heals the allied attacker once and remains distinct from Mark', () => {
  const hero = makeUnit({ id: 'hero', stats, skills: [basic], currentHp: 500 });
  const seal = makeEffect(AfflictionType.SacredSeal, { magnitude: 12, healMagnitude: 8, sourceSide: true, sourceUnitId: 'templar' });
  const foe = makeFoe({ id: 'foe', stats, position: at(1, 0), activeEffects: [seal, makeEffect(AfflictionType.Mark)] });
  state().initCombat([hero], [foe]);
  resolveSkillUse(hero, basic, foe.position, SILENT_SINK);
  expect(current('hero').currentHp).toBe(508);
  expect(current('foe').activeEffects.map(e => e.type)).toEqual([AfflictionType.Mark]);
});

it('repeated cone casts cannot disable a teammate in the cone', () => {
  const hero = makeUnit({ id: 'hero', stats, skills: [tremor, sanction] });
  const ally = makeUnit({ id: 'ally', stats, position: at(1, 0) });
  const foe = makeFoe({ id: 'foe', stats: { ...stats, maxHp: 100000 }, position: at(2, 0) });
  state().initCombat([hero, ally], [foe]);
  for (let i = 0; i < 12; i++) {
    state().tickCooldowns('hero'); state().tickCooldowns('hero');
    resolveSkillUse(current('hero'), i % 2 ? sanction : tremor, foe.position, SILENT_SINK);
    expect(beginTurn('ally', SILENT_SINK).kind).toBe('act');
    expect(current('ally').currentHp).toBe(stats.maxHp);
  }
});

it('rampart placement is atomic, rocks block both sides and can be attacked or expire', () => {
  const hero = makeUnit({ id: 'hero', stats, skills: [upheaval] });
  const foe = makeFoe({ id: 'foe', stats, position: at(3, 0) });
  state().initCombat([hero], [foe]);
  expect(rampartPair(hero, upheaval, at(1, 0), state().units, () => true, foe.position)).toEqual([]);
  expect(resolveSkillUse(hero, upheaval, at(1, 0), SILENT_SINK, { rampartNeighbor: foe.position }).ok).toBe(false);
  expect(current('hero').currentMana).toBe(stats.maxMana);
  const rocks = castObjectives(hero, upheaval, at(1, 0), state().units, () => {}, undefined, at(1, 1));
  expect(rocks).toHaveLength(2);
  expect(state().turnOrder.some(id => rocks.some(r => r.id === id))).toBe(false);
  const arrow = makeSkill({ range: 6, damage: 1 });
  expect(rampartBlocksShot(arrow, hero.position, foe.position, state().units)).toBe(true);
  expect(rampartBlocksShot(arrow, foe.position, hero.position, state().units)).toBe(true);
  expect(rampartBlocksShot(arrow, hero.position, rocks[0].position, state().units)).toBe(false);
  expect(rampartBlocksShot({ ...arrow, targetType: SkillTargetType.Ring }, hero.position, foe.position, state().units)).toBe(false);
  state().damageUnit(rocks[0].id, 10000, foe.id);
  expect(rampartBlocksShot(arrow, hero.position, foe.position, state().units)).toBe(false);
  state().tickObjectives(hero.id); state().tickObjectives(hero.id);
  expect(state().units.filter(u => u.objective?.kind === 'rampart' && u.currentHp > 0)).toEqual([]);
});

it('Grounded Focus starts only after a stationary turn and combines flat Magic buffs independent of order', () => {
  const hero = makeUnit({ id: 'hero', stats, passives: ['groundedFocus'], skills: [stoneskin] });
  state().initCombat([hero], [makeFoe({ position: at(4, 0) })]);
  beginTurn('hero', SILENT_SINK);
  expect(getCombatEffectiveStats(current('hero')).magic).toBe(40);
  useCombatStore.setState({ units: state().units.map(u => u.id === 'hero' ? { ...u, previousTurnStationary: true } : u) });
  beginTurn('hero', SILENT_SINK);
  expect(getCombatEffectiveStats(current('hero')).magic).toBeGreaterThan(40);
  const focus = makeEffect(AuraType.GroundedFocus, { magnitude: 0.2 });
  const magic = makeEffect(AuraType.MagicBuff, { magnitude: 10 });
  expect(getCombatEffectiveStats({ ...hero, activeEffects: [focus, magic] }).magic).toBe(60);
  expect(getCombatEffectiveStats({ ...hero, activeEffects: [magic, focus] }).magic).toBe(60);
  state().moveUnit('hero', at(1, 0), undefined, false);
  expect(current('hero').voluntaryMoved).not.toBe(true);
  state().moveUnit('hero', at(2, 0), undefined, true);
  expect(current('hero').voluntaryMoved).toBe(true);
});


it('a landed seal belongs to its applying side; invulnerability preserves seal and Rhythm', () => {
  const hero = makeUnit({ id: 'hero', stats, skills: [basic], currentHp: 500,
    activeEffects: [makeEffect(AuraType.SacredRhythm, { magnitude: 10 })] });
  const foe = makeFoe({ id: 'foe', stats, position: at(1, 0), activeEffects: [
    makeEffect(AfflictionType.SacredSeal, { magnitude: 12, healMagnitude: 8, sourceSide: true }),
    makeEffect(AuraType.Invulnerability),
  ] });
  state().initCombat([hero], [foe]);
  resolveSkillUse(hero, basic, foe.position, SILENT_SINK);
  expect(current('hero').currentHp).toBe(500);
  expect(current('hero').activeEffects.some(e => e.type === AuraType.SacredRhythm)).toBe(true);
  expect(current('foe').activeEffects.some(e => e.type === AfflictionType.SacredSeal)).toBe(true);
});

it('a voluntary move during a bonus turn still prevents next regular turn Focus', () => {
  const hero = makeUnit({ id: 'hero', stats, passives: ['groundedFocus'] });
  state().initCombat([hero], [makeFoe({ id: 'foe', stats, position: at(4, 0) })]);
  useCombatStore.setState({ currentUnitId: 'hero', bonusTurn: { pending: 'hero', active: false } });
  state().moveUnit('hero', at(1, 0), undefined, true);
  state().nextTurn();
  expect(state().bonusTurn.active).toBe(true);
  expect(current('hero').voluntaryMoved).toBe(true);
  state().nextTurn();
  expect(current('hero').previousTurnStationary).toBe(false);
  beginTurn('hero', SILENT_SINK);
  expect(current('hero').activeEffects.some(e => e.type === AuraType.GroundedFocus)).toBe(false);
});
