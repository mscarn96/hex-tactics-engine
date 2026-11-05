import { readFileSync } from 'fs';
import path from 'path';
import { REPO_ROOT } from '../support/paths';
import { CombatUnit, PreparedAttack } from '@/models/types';
import { EncounterScript, Landing } from '@/systems/combat/encounterScript';
import { createScriptRegistry, SCRIPTS } from '@/systems/combat/scriptRegistry';
import { SILENT_SINK } from '@/systems/combat/combatSink';
import { arrangeOpening, scriptStateFor } from '@/systems/combat/bossRegistry';
import { at, makeFoe, makeSkill } from '../support/fixtures';

/**
 * The seam every boss and elite plugs into: one walk per hook point, in the order the
 * hand-written ladders ran, and nothing outside the scripts that names a boss.
 */

const attack = { id: 'a', casterId: 'boss', skill: makeSkill(), aim: at(0, 0), origin: at(0, 0), hexes: [] } as unknown as PreparedAttack;
/** A landing whose blows go nowhere: the walk is what is pinned here, not the strike. */
const landing: Landing = { attack, strike: () => {}, blow: () => {}, hit: () => {}, broken: () => {} };
const boss = makeFoe({ id: 'boss' });
const mark = (unit: CombatUnit, tag: string): CombatUnit => ({ ...unit, name: unit.name + tag });

describe('the registry', () => {
  it('walks the scripts in registration order, which is the order the ladders ran in', () => {
    expect(SCRIPTS.map((s) => s.id)).toEqual(['aethelred', 'troll', 'dragon', 'heart', 'elites', 'factionElites', 'fallenOrder', 'yokai', 'lastLesson', 'kairen']);
  });

  it('runs a warned attack through land, then before, then after, and skips the strike a script landed', () => {
    const calls: string[] = [];
    const script = (id: string, over: Partial<EncounterScript> = {}): EncounterScript => ({
      id,
      land: () => { calls.push(`${id}.land`); return false; },
      beforeLanding: (_a, striker) => { calls.push(`${id}.before`); return mark(striker, `+${id}`); },
      afterLanding: () => { calls.push(`${id}.after`); },
      ...over,
    });
    const registry = createScriptRegistry([script('a'), script('b'), script('c')]);

    // Nobody lands it: the ordinary strike would run, from where every script moved the striker
    expect(registry.land(landing, boss, SILENT_SINK)).toBe(false);
    expect(registry.striker(attack, boss, SILENT_SINK).name).toBe(`${boss.name}+a+b+c`);
    registry.afterLanding(attack, boss, SILENT_SINK);
    expect(calls).toEqual(['a.land', 'b.land', 'c.land', 'a.before', 'b.before', 'c.before', 'a.after', 'b.after', 'c.after']);

    // A script that lands it whole takes it, and the ones after it are not asked
    calls.length = 0;
    const taken = createScriptRegistry([script('a'), script('b', { land: () => { calls.push('b.land'); return true; } }), script('c')]);
    expect(taken.land(landing, boss, SILENT_SINK)).toBe(true);
    expect(calls).toEqual(['a.land', 'b.land']);
  });

  it('gives a skill to the first script that casts it, and to the resolver when none does', () => {
    const calls: string[] = [];
    const casting = (id: string, takes: boolean): EncounterScript => ({ id, cast: () => { calls.push(id); return takes; } });
    const args = [boss, makeSkill(), at(0, 0), undefined, SILENT_SINK] as const;
    expect(createScriptRegistry([casting('a', false), casting('b', true), casting('c', true)]).cast(...args)).toBe(true);
    expect(calls).toEqual(['a', 'b']);
    expect(createScriptRegistry([casting('a', false)]).cast(...args)).toBe(false);
  });

  it('leaves a unit no script owns to the ordinary brain', () => {
    const ctx = { enemy: makeFoe({ id: 'grunt' }), foes: [], allUnits: [], trace: () => {}, aim: () => null, approach: () => null };
    expect(createScriptRegistry(SCRIPTS).decide(ctx)).toBeNull();
  });
});

describe('the pure half', () => {
  it('starts only the scripted bosses with a script state, each with its own counters', () => {
    expect(scriptStateFor(makeFoe({ templateId: 'goblin' as never }))).toBeUndefined();
    expect(scriptStateFor(makeFoe({ templateId: 'aethelred' as never }))).toMatchObject({ step: 0, legionResponded: false });
    expect(scriptStateFor(makeFoe({ templateId: 'troll_chieftain' as never }))).toEqual({ step: 0, phaseTurns: 0, unharmedRounds: 0 });
  });

  it('chains the Heart of Winter to its anchors and moves nobody else', () => {
    const heart = makeFoe({ id: 'heart', templateId: 'heart_of_winter' as never, position: at(0, 0) });
    const wolf = makeFoe({ id: 'wolf', position: at(3, 3) });
    const { enemies, extra } = arrangeOpening([heart, wolf]);
    expect(enemies.find((u) => u.id === 'wolf')!.position).toEqual(wolf.position);
    expect(enemies.find((u) => u.id === 'heart')!.position).not.toEqual(heart.position);
    expect(extra.length).toBe(3);
    expect(arrangeOpening([wolf]).extra).toEqual([]);
  });
});
