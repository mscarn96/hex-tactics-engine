import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { AfflictionType, AuraType, CombatUnit, HexCoord, KairenScriptState, LegionScriptState } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { BOSSES, bossChains, bossOf, bossReadout, intoNewPhase, stepVoids } from '@/systems/combat/bossRegistry';
import { SILENT_SINK } from '@/systems/combat/combatSink';
import { SCRIPTS, scriptsBeginTurn } from '@/systems/combat/scriptRegistry';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { requireUnit } from '@/systems/combat/unitLookup';
import { at, makeStats, makeUnit } from '../support/fixtures';

/**
 * The boss registry's contract: every boss in the game has one entry, and every entry supplies
 * what the store, the scene and the turn start ask of it — its starting state, its script, a
 * readout made of values, its briefing — and is counted once as its turn begins.
 */

const store = () => useCombatStore.getState();
const hero = (id: string, position: HexCoord): CombatUnit =>
  makeUnit({ id, name: id, heroId: id, position, stats: makeStats({ maxHp: 300, speed: 8 }) });

/** A fresh fight against the real boss from its template, with two heroes. */
function fight(templateId: string): CombatUnit {
  const [boss] = createEnemyUnits([templateId], [at(0, -2)], 20);
  store().reset();
  store().initCombat([hero('a', at(0, 2)), hero('b', at(2, 1))], [boss]);
  return requireUnit(store().units, boss.id);
}

/** Keys whose string values are ids or tags, not words. */
const ID_KEYS = new Set(['kind', 'unitId', 'bossId', 'lesson', 'move']);

/** Every string a readout carries, outside its ids and the skill references it points at. */
function words(value: unknown, key = ''): string[] {
  if (typeof value === 'string') return ID_KEYS.has(key) ? [] : [`${key}: ${value}`];
  if (Array.isArray(value)) return value.flatMap((v) => words(v, key));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => (k === 'skill' ? [] : words(v, k)));
  }
  return [];
}

const bossTemplates = enemyTemplates.filter((t) => t.tier === 'boss').map((t) => t.id);

describe('the boss registry', () => {
  it('has one entry per boss template, and nothing else', () => {
    expect(BOSSES.map((b) => b.templateId).sort()).toEqual([...bossTemplates].sort());
  });

  it('names a registered script for every boss', () => {
    const scripts = new Set(SCRIPTS.map((s) => s.id));
    for (const boss of BOSSES) expect(scripts.has(boss.script)).toBe(true);
  });

  it.each(BOSSES.map((b) => [b.templateId, b] as const))('%s: knows itself and starts from a clean sheet', (templateId, entry) => {
    const unit = fight(templateId);
    expect(bossOf(unit)).toBe(entry);
    expect(entry.initialState()).toMatchObject({ step: 0, phaseTurns: 0, unharmedRounds: 0 });
    expect(unit.bossScript).toMatchObject({ phaseTurns: 0, unharmedRounds: 0 });
    expect(entry.briefing.dangers).toBeGreaterThanOrEqual(1);
    expect(entry.briefing.chances).toBeGreaterThanOrEqual(1);
  });

  it.each(BOSSES.map((b) => [b.templateId, b] as const))('%s: shows values, never words', (templateId, entry) => {
    const unit = fight(templateId);
    const view = { units: store().units, prepared: store().preparedAttacks, hazards: store().hazards };
    const shows = entry.readout(unit, view);
    expect(words(shows)).toEqual([]);
    expect(words(bossReadout(view))).toEqual([]);
    expect(words(bossChains(store().units))).toEqual([]);
  });

  it.each(BOSSES.map((b) => [b.templateId] as const))('%s: counts each regular turn of its own once', (templateId) => {
    const unit = fight(templateId);
    scriptsBeginTurn(unit, SILENT_SINK);
    expect(requireUnit(store().units, unit.id).bossScript).toMatchObject({ phaseTurns: 1, unharmedRounds: 1 });
    scriptsBeginTurn(requireUnit(store().units, unit.id), SILENT_SINK);
    expect(requireUnit(store().units, unit.id).bossScript).toMatchObject({ phaseTurns: 2, unharmedRounds: 2 });
    // A hero's turn counts nothing on the boss
    scriptsBeginTurn(requireUnit(store().units, 'a'), SILENT_SINK);
    expect(requireUnit(store().units, unit.id).bossScript).toMatchObject({ phaseTurns: 2 });
  });

  it.each(BOSSES.map((b) => [b.templateId] as const))('%s: starts a new phase with its counters cleared', (templateId) => {
    const unit = fight(templateId);
    store().patchBossScript(unit.id, { step: 2, phaseTurns: 4, unharmedRounds: 3 });
    expect(intoNewPhase(requireUnit(store().units, unit.id)).bossScript).toMatchObject({ step: 0, phaseTurns: 0, unharmedRounds: 0 });
  });

  it('carries across a phase only what a boss keeps, and sheds what its old phase held', () => {
    const emperor = fight('aethelred');
    store().patchBossScript(emperor.id, { legionResponded: true, titheSpent: true });
    store().applyEffect(emperor.id, { type: AuraType.OrbCharge, magnitude: 2, duration: -1, sourceUnitId: emperor.id });
    const turned = intoNewPhase(requireUnit(store().units, emperor.id));
    expect(turned.bossScript).toMatchObject({ legionResponded: true, titheSpent: false });
    expect(turned.activeEffects.some((e) => e.type === AuraType.OrbCharge)).toBe(false);

    const kairen = fight('kairen');
    const memory = (requireUnit(store().units, kairen.id).bossScript as KairenScriptState).kairen;
    store().applyEffect(kairen.id, { type: AuraType.Aloft, magnitude: 1, duration: -1, sourceUnitId: kairen.id });
    const landed = intoNewPhase(requireUnit(store().units, kairen.id));
    expect((landed.bossScript as KairenScriptState).kairen).toEqual(memory);
    expect(landed.activeEffects.some((e) => e.type === AuraType.Aloft)).toBe(false);
    expect((landed.bossScript as LegionScriptState).legionResponded).toBeUndefined();
  });

  it('voids the Writ on whoever steps, and nothing else', () => {
    fight('aethelred');
    expect(stepVoids(requireUnit(store().units, 'a'))).toEqual([AfflictionType.Writ]);
  });

  it('marks the extra action owed for the queue only while it is not already being taken', () => {
    const troll = fight('troll_chieftain');
    const view = { units: store().units, prepared: [], hazards: [], currentUnitId: troll.id };
    expect(bossReadout(view).extraActionId).toBeNull();
    store().applyEffect(troll.id, { type: AuraType.Fury, magnitude: 1, duration: -1, sourceUnitId: troll.id });
    const furious = { ...view, units: store().units };
    expect(bossReadout(furious).extraActionId).toBe(troll.id);
    expect(bossReadout({ ...furious, extraActive: true }).extraActionId).toBeNull();
  });
});
