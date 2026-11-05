import { AfflictionType, AuraType, CombatUnit, PreparedAttack } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { requireUnit } from '@/systems/combat/unitLookup';
import { SILENT_SINK } from '@/systems/combat/combatSink';
import { beginTurn } from '@/systems/combat/turnStart';
import { at, makeEffect, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * Every way to die runs the same consequences.
 *
 * A unit can die to a blow, a damage-over-time dose, ground it crossed, a price
 * it paid and a summon's clock running out. Each of those used to carry its own
 * subset of what dying means — the tick had no duels and no objectives, expiry
 * fired the parting blast and nothing else. `damageFunnel.resolveDeath` is the
 * one list; this table is the proof that no path reaches a body's end without it.
 */

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);

/** A fire elemental that owns a warning, is bound in a duel and stands beside a hero. */
function board() {
  resetFixtureIds();
  state().reset();
  const dying = makeFoe({
    id: 'dying', position: at(0, 0), templateId: 'fire_elemental', summonedBy: 'owner', currentHp: 5,
    stats: makeStats({ maxHp: 45, attack: 20, magic: 14 }),
    duel: { partnerId: 'hero', centre: at(0, 0), radius: 2, turns: 0 },
  });
  const owner = makeFoe({ id: 'owner', position: at(0, -2), stats: makeStats({ maxHp: 300 }) });
  const hero = makeUnit({
    id: 'hero', isPlayer: true, position: at(0, 1), stats: makeStats({ maxHp: 300 }),
    duel: { partnerId: 'dying', centre: at(0, 0), radius: 2, turns: 0 },
  });
  useCombatStore.setState({
    units: [dying, owner, hero],
    turnOrder: ['hero', 'dying', 'owner'],
    currentUnitId: 'dying',
    preparedAttacks: [{ id: 'warning', casterId: 'dying', hexes: [at(0, 1)], responders: [], responded: [] } as unknown as PreparedAttack],
    hazards: [{ id: 'rift', hexes: [at(1, 0)], solid: false, label: 'Cinder Rift', ownerId: 'hero', crossDamage: 999 }],
  });
}

/** What dying means, read off the board afterwards. */
function consequences() {
  return {
    dead: unitNow('dying').currentHp <= 0,
    // The parting blast hit the hero standing beside it
    blastLanded: unitNow('hero').currentHp < 300,
    // The warning it had open is gone
    warningRetired: !state().preparedAttacks.some((p) => p.casterId === 'dying'),
    // The rune circle fell with it
    duelDissolved: unitNow('hero').duel === undefined,
  };
}

const EXPECTED = { dead: true, blastLanded: true, warningRetired: true, duelDissolved: true };

describe('every way to die runs the same consequences', () => {
  const ways: [string, () => void][] = [
    ['a skill\'s damage', () => { state().damageUnit('dying', 999, 'hero'); }],
    ['a damage-over-time tick', () => {
      useCombatStore.setState((s) => ({
        units: s.units.map((u) => (u.id === 'dying'
          ? { ...u, activeEffects: [makeEffect(AfflictionType.Burn, { magnitude: 99, duration: 3, sourceUnitId: 'hero' })] }
          : u)),
      }));
      state().tickEffectsOnUnit('dying');
    }],
    ['ground it crossed', () => { state().moveUnit('dying', at(1, 0), 'walk', false); }],
    ['a price it paid for itself', () => { state().damageUnit('dying', 999); }],
    ['a summon\'s clock running out', () => {
      useCombatStore.setState((s) => ({
        units: s.units.map((u) => (u.id === 'dying' ? { ...u, summonTurnsLeft: 0 } : u)),
      }));
      beginTurn('dying', SILENT_SINK);
    }],
  ];

  it.each(ways)('%s', (_name, die) => {
    board();
    die();
    expect(consequences()).toEqual(EXPECTED);
  });
});

describe('an objective that dies, however it dies, reaches its owner', () => {
  /** A standard whose fall leaves its owner Exposed. */
  function standardBoard() {
    resetFixtureIds();
    state().reset();
    const boss = makeFoe({ id: 'boss', position: at(0, -2), stats: makeStats({ maxHp: 400 }) });
    const standard = makeFoe({
      id: 'standard', position: at(0, 0), currentHp: 5,
      objective: {
        kind: 'standard', ownerId: 'boss',
        onDestroy: [{ type: AuraType.Exposed, magnitude: 20, duration: 2 }],
      } as CombatUnit['objective'],
    });
    const hero = makeUnit({ id: 'hero', isPlayer: true, position: at(0, 2) });
    useCombatStore.setState({ units: [boss, standard, hero] });
  }
  const exposed = () => unitNow('boss').activeEffects.some((e) => e.type === AuraType.Exposed);

  it('when struck', () => {
    standardBoard();
    state().damageUnit('standard', 999, 'hero');
    expect(exposed()).toBe(true);
  });

  it('when a damage-over-time tick burns it down', () => {
    standardBoard();
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === 'standard'
        ? { ...u, activeEffects: [makeEffect(AfflictionType.Burn, { magnitude: 99, duration: 3, sourceUnitId: 'hero' })] }
        : u)),
    }));
    state().tickEffectsOnUnit('standard');
    expect(unitNow('standard').currentHp).toBe(0);
    expect(exposed()).toBe(true);
  });
});
