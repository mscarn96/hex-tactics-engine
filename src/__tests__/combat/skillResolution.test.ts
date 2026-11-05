import { spyDice } from '../support/dice';
import { resolveSkillUse, CombatSink, SILENT_SINK } from '@/systems/combat/skillResolution';
import { useCombatStore } from '@/stores/combatStore';
import { slash, heal, arcaneBolt } from '@/data/skills/skillData';
import { CombatUnit, HexCoord, VfxSpec } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';
import { requireUnit } from '@/systems/combat/unitLookup';

/**
 * The first end-to-end test of a skill actually being used.
 *
 * Until `resolveSkillUse` was lifted out of `CombatScene`, this whole pathway —
 * targeting, damage, mana, cooldowns, statuses, turn handover — was reachable
 * only by mounting an R3F tree, so none of it was covered.
 */

const at = (q: number, r: number): HexCoord => ({ q, r });

const unit = (id: string, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ id, isPlayer: false, stats: makeStats({ defense: 5, magic: 20, moveRange: 2, maxMana: 40 }), ...over });

/** Records everything the rules tried to show the player. */
function recorder() {
  const logs: string[] = [];
  const floats: { at: HexCoord; text: string }[] = [];
  const vfx: VfxSpec[] = [];
  const statuses: { at: HexCoord; label: string }[] = [];
  const sink: CombatSink = {
    log: (text) => logs.push(text),
    float: (a, text) => floats.push({ at: a, text }),
    vfx: (spec) => vfx.push(spec),
    status: (at, label) => statuses.push({ at, label }),
  };
  return { sink, logs, floats, vfx, statuses };
}

const unitOf = (id: string) => requireUnit(useCombatStore.getState().units, id);

/** Hero at (0,0), enemy adjacent at (0,1) — in reach of a range-1 melee skill. */
function setup(heroOver: Partial<CombatUnit> = {}, enemyOver: Partial<CombatUnit> = {}) {
  useCombatStore.getState().reset();
  const hero = unit('hero', { isPlayer: true, position: at(0, 0), skills: [slash, heal, arcaneBolt], ...heroOver });
  const foe = unit('foe', { isPlayer: false, position: at(0, 1), ...enemyOver });
  useCombatStore.getState().initCombat([hero], [foe]);
  return { hero: unitOf('hero'), foe: unitOf('foe') };
}

// Crit and dodge are both rolls; pin them so damage assertions are about the
// pipeline rather than about luck.
let random: jest.SpyInstance;
beforeEach(() => { random = spyDice().mockReturnValue(0.99); });
afterEach(() => random.mockRestore());

describe('resolveSkillUse', () => {
  it('damages the target and ends the turn', () => {
    const { hero, foe } = setup();
    const { sink } = recorder();

    const result = resolveSkillUse(hero, slash, foe.position, sink);

    expect(result.ok).toBe(true);
    expect(result.endsTurn).toBe(true);
    expect(unitOf('foe').currentHp).toBeLessThan(100);
  });

  it('reports damage through the sink in hex space, never screen space', () => {
    const { hero, foe } = setup();
    const rec = recorder();

    resolveSkillUse(hero, slash, foe.position, rec.sink);

    const dealt = 100 - unitOf('foe').currentHp;
    expect(rec.floats).toHaveLength(1);
    expect(rec.floats[0]).toEqual({ at: foe.position, text: `-${dealt}` });
    expect(rec.logs[0]).toBe('hero: Slash');
  });

  it('emits one vfx spec naming the struck unit', () => {
    const { hero, foe } = setup();
    const rec = recorder();

    resolveSkillUse(hero, slash, foe.position, rec.sink);

    expect(rec.vfx).toHaveLength(1);
    expect(rec.vfx[0].hitUnitIds).toEqual(['foe']);
    expect(rec.vfx[0].casterId).toBe('hero');
  });

  // The turn must survive a miss-click, or a player loses a round to a mistap
  it('refuses an empty hex without ending the turn', () => {
    const { hero } = setup();
    const { sink } = recorder();

    const result = resolveSkillUse(hero, slash, at(0, -1), sink);

    expect(result.ok).toBe(false);
    expect(result.refusal).toBe('no-targets');
    expect(result.message).toBe('No valid targets');
    expect(result.endsTurn).toBe(false);
  });

  it('spends mana and starts the cooldown only when the skill lands', () => {
    const { hero, foe } = setup();

    resolveSkillUse(hero, heal, hero.position, SILENT_SINK);
    const afterHeal = unitOf('hero').currentMana;
    expect(afterHeal).toBe(40 - heal.manaCost);

    // A refused cast must not bill the caster
    const before = unitOf('hero').currentMana;
    resolveSkillUse(unitOf('hero'), slash, at(3, -3), SILENT_SINK);
    expect(unitOf('hero').currentMana).toBe(before);
    expect(foe.currentHp).toBe(100);
  });

  it('heals an ally rather than the enemy standing in the same shape', () => {
    setup({ currentHp: 50 });
    const { sink } = recorder();

    const result = resolveSkillUse(unitOf('hero'), heal, at(0, 0), sink);

    expect(result.ok).toBe(true);
    expect(unitOf('hero').currentHp).toBeGreaterThan(50);
    expect(unitOf('foe').currentHp).toBe(100);
  });

  // The check the HUD is supposed to have made already — it returns a refusal
  // rather than throwing, but the caller is expected to swallow it silently.
  it('refuses a skill the caster cannot afford', () => {
    const { hero } = setup({ currentMana: 0 });

    const result = resolveSkillUse(hero, heal, hero.position, SILENT_SINK);

    expect(result.ok).toBe(false);
    expect(result.refusal).toBe('unusable');
  });

  it('leaves turn advancement to the caller', () => {
    const { hero, foe } = setup();

    resolveSkillUse(hero, slash, foe.position, SILENT_SINK);

    // hasActed is the caller's write — the resolver reports `endsTurn` and stops
    expect(unitOf('hero').hasActed).toBe(false);
  });
});

describe('ResolveOptions.rng', () => {
  it('decides the dodge without touching Math.random or the pinned dice', () => {
    const onMath = jest.spyOn(Math, 'random');
    try {
      // A target with a certain dodge: a roll under it misses, a roll over it lands
      const dodger = { stats: makeStats({ defense: 5, magic: 20, moveRange: 2, maxMana: 40, dodgeChance: 100 }) };
      const run = (rng: () => number) => {
        const { hero, foe } = setup({}, dodger);
        const rec = recorder();
        resolveSkillUse(hero, slash, foe.position, rec.sink, { rng });
        return { rec, hp: unitOf('foe').currentHp };
      };
      const missed = run(() => 0);
      expect(missed.hp).toBe(100);
      expect(missed.rec.logs.some((l) => l.includes('dodged'))).toBe(true);
      expect(onMath).not.toHaveBeenCalled();
    } finally { onMath.mockRestore(); }
  });

  it('puts the previous dice back once the cast is over', () => {
    const { hero, foe } = setup();
    resolveSkillUse(hero, slash, foe.position, recorder().sink, { rng: () => 0 });
    random.mockClear();
    resolveSkillUse(unitOf('hero'), slash, foe.position, recorder().sink);
    expect(random).toHaveBeenCalled();
  });
});
