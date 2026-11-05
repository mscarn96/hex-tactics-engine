import { AfflictionType, AuraType, CombatUnit } from '@/models/types';
import { FunnelData, takeDamage } from '@/systems/combat/damageFunnel';
import { lethalSaveOutcomes } from '@/systems/combat/passives';
import { combatMaxHp } from '@/systems/combat/forms';
import { shatterBurst } from '@/systems/combat/statusEffects';
import { useCombatStore } from '@/stores/combatStore';
import { requireUnit } from '@/systems/combat/unitLookup';
import { at, makeEffect, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * The damage funnel's arithmetic, as state in and state out.
 *
 * `takeDamage` is pure, so every ordering rule that decides how much a unit
 * loses is asserted on plain data with no store: the shatter before the Barrier,
 * the Reckoning before the Barrier, the lethal save before the HP write. The one
 * order that spans operations rather than arithmetic — Second Skin strips the
 * shape before the heal — is asserted last, through the store that hosts them.
 */

const stateOf = (units: CombatUnit[]): FunnelData => ({
  units,
  fightStats: {},
  reactions: [],
  reactionEvents: [],
  answeringReaction: false,
});

const target = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'target', isPlayer: true, stats: makeStats({ maxHp: 100, defense: 0 }), ...over });
const striker = makeFoe({ id: 'striker', position: at(1, 0) });

const hit = (unit: CombatUnit, amount: number, options = {}) => {
  const state = stateOf([unit, striker]);
  const { patch, report } = takeDamage(state, 'target', amount, 'striker', { difficultyApplied: true, ...options });
  const after = (patch.units ?? state.units).find((u) => u.id === 'target')!;
  return { after, report, patch, state };
};

beforeEach(() => resetFixtureIds());

describe('takeDamage is pure', () => {
  it('leaves the state it was given alone and returns what changed', () => {
    const unit = target({ activeEffects: [makeEffect(AuraType.Barrier, { magnitude: 30, duration: 3 })] });
    const state = stateOf([unit, striker]);
    const before = JSON.stringify(state);
    const { patch, report } = takeDamage(state, 'target', 50, 'striker', { difficultyApplied: true });
    expect(JSON.stringify(state)).toBe(before);
    expect(report.absorbed).toBe(30);
    expect(report.hpLost).toBe(20);
    expect(patch.units!.find((u) => u.id === 'target')!.currentHp).toBe(80);
    // The attacker is credited the whole blow, the target is charged what it lost
    expect(patch.fightStats!.striker.damageDealt).toBe(50);
    expect(patch.fightStats!.target.damageTaken).toBe(20);
  });

  it('takes nothing from a unit held from harm', () => {
    const unit = target({ activeEffects: [makeEffect(AuraType.Invulnerability, { duration: 2 })] });
    const { after, report } = hit(unit, 500);
    expect(after.currentHp).toBe(100);
    expect(report).toMatchObject({ hpLost: 0, absorbed: 0, shatter: 0 });
  });
});

describe('the order of the arithmetic', () => {
  it('shatters the ice before the Barrier, so the Barrier eats the burst too', () => {
    const frozen = target({
      activeEffects: [
        makeEffect(AfflictionType.Freeze, { duration: 2 }),
        makeEffect(AuraType.Barrier, { magnitude: 60, duration: 3 }),
      ],
    });
    const burst = shatterBurst(frozen);
    expect(burst).toBeGreaterThan(0);

    const { after, report } = hit(frozen, 10);

    expect(report.shatter).toBe(burst);
    // Had the burst been added after the shield, the Barrier would have eaten 10
    expect(report.absorbed).toBe(Math.min(60, 10 + burst));
    expect(after.activeEffects.some((e) => e.type === AfflictionType.Freeze)).toBe(false);
  });

  it('lets a Reckoning soak ahead of the Barrier, so only its own share is stored', () => {
    const unit = target({
      activeEffects: [
        makeEffect(AuraType.Reckoning, { magnitude: 20, duration: 3, stored: 0 }),
        makeEffect(AuraType.Barrier, { magnitude: 50, duration: 3 }),
      ],
    });

    const { after, report } = hit(unit, 30);

    // The Reckoning took its 20 first and was spent; the Barrier saw the remaining 10
    expect(report.follow.reckoningBroken).toMatchObject({ stored: 20 });
    expect(after.activeEffects.find((e) => e.type === AuraType.Barrier)!.magnitude).toBe(40);
    expect(report.absorbed).toBe(30);
    expect(report.hpLost).toBe(0);
  });

  it('holds a unit at 1 before the HP is written, rather than reversing a death', () => {
    const unit = target({ currentHp: 10, passives: ['undyingFury'] });

    const { after, report } = hit(unit, 500);

    expect(after.currentHp).toBe(1);
    expect(report.hpLost).toBe(9);
    expect(report.follow.saved).toBe(true);
    expect(report.follow.saveOutcomes.length).toBeGreaterThan(0);
    expect(after.activeEffects.some((e) => e.type === AuraType.UndyingSpent)).toBe(true);
    // And it is spent: the next lethal blow lands
    const again = takeDamage(stateOf([after, striker]), 'target', 500, 'striker', { difficultyApplied: true });
    expect(again.patch.units!.find((u) => u.id === 'target')!.currentHp).toBe(0);
    expect(again.report.follow.saved).toBe(false);
  });

  it('does not charge the ice, objectives or Second Spring to a tick\'s dose', () => {
    const frozen = target({
      activeEffects: [
        makeEffect(AfflictionType.Freeze, { duration: 2 }),
        makeEffect(AuraType.SecondSpring, { magnitude: 50, duration: 3 }),
      ],
    });
    const { after, report } = hit(frozen, 20, { fromTick: true, sourceUnitId: 'striker', creditTo: '__dot_enemy' });
    expect(report.shatter).toBe(0);
    expect(report.hpLost).toBe(20);
    expect(after.activeEffects.some((e) => e.type === AfflictionType.Freeze)).toBe(true);
  });
});

describe('a poison dose through a Barrier gives the strike\'s numbers', () => {
  it('absorbs and spends exactly what a blow of the same size does', () => {
    const shielded = () => target({ activeEffects: [makeEffect(AuraType.Barrier, { magnitude: 25, duration: 3 })] });
    const strike = hit(shielded(), 40);
    const dose = hit(shielded(), 40, { fromTick: true });
    expect(dose.report.absorbed).toBe(strike.report.absorbed);
    expect(dose.report.hpLost).toBe(strike.report.hpLost);
    expect(dose.after.activeEffects).toEqual(strike.after.activeEffects);
  });
});

describe('Second Skin strips the shape before the heal', () => {
  it('heals against the upright pool, not the beast\'s', () => {
    useCombatStore.getState().reset();
    const druid = makeUnit({
      id: 'druid', isPlayer: true, position: at(0, 0), stats: makeStats({ maxHp: 100 }),
      passives: ['secondSkin'], wildForm: 'bear', formVigor: 1.5, currentHp: 5,
    });
    useCombatStore.setState({ units: [druid, makeFoe({ id: 'foe', position: at(1, 0) })] });
    const beast = requireUnit(useCombatStore.getState().units, 'druid');
    expect(combatMaxHp(beast)).toBeGreaterThan(100);
    const heal = lethalSaveOutcomes(beast)[0];
    if (heal.kind !== 'heal') throw new Error('Second Skin should save with a heal');

    useCombatStore.getState().damageUnit('druid', 500, 'foe', { difficultyApplied: true });

    const saved = requireUnit(useCombatStore.getState().units, 'druid');
    expect(saved.wildForm).toBeNull();
    // Shape dropped first: 1 HP kept in the upright pool, then the heal lands on top of it.
    // Healed first, the heal would have been rescaled by the shape change that followed.
    expect(saved.currentHp).toBe(Math.min(100, 1 + heal.amount));
  });
});

describe('the tick pays its doses through the funnel', () => {
  const store = () => useCombatStore.getState();
  const burning = (barrier: number) => {
    store().reset();
    const hero = makeUnit({
      id: 'burner', isPlayer: true, position: at(0, 0), stats: makeStats({ maxHp: 200 }),
      activeEffects: [
        makeEffect(AfflictionType.Burn, { magnitude: 30, duration: 3, sourceUnitId: 'foe' }),
        ...(barrier > 0 ? [makeEffect(AuraType.Barrier, { magnitude: barrier, duration: 5 })] : []),
      ],
    });
    useCombatStore.setState({ units: [hero, makeFoe({ id: 'foe', position: at(3, 0) })] });
  };
  const snapshot = () => {
    const u = requireUnit(store().units, 'burner');
    return { hp: u.currentHp, barrier: u.activeEffects.find((e) => e.type === AuraType.Barrier)?.magnitude };
  };

  it('a Burn tick through a Barrier takes the numbers a strike of that size does', () => {
    burning(20);
    store().tickEffectsOnUnit('burner');
    const ticked = snapshot();

    burning(20);
    store().damageUnit('burner', 30, undefined, { difficultyApplied: true });
    const struck = snapshot();

    expect(ticked).toEqual(struck);
    expect(ticked).toEqual({ hp: 190, barrier: undefined });
  });

  it('holds the floor of a window opened by the first dose against the second', () => {
    store().reset();
    const bers = makeUnit({
      id: 'bers', isPlayer: true, position: at(0, 0), currentHp: 10, passives: ['undyingFury'],
      stats: makeStats({ maxHp: 200 }),
      activeEffects: [
        makeEffect(AfflictionType.Bleed, { magnitude: 50, duration: 3, sourceUnitId: 'foe' }),
        makeEffect(AfflictionType.Burn, { magnitude: 50, duration: 3, sourceUnitId: 'foe' }),
      ],
    });
    useCombatStore.setState({ units: [bers, makeFoe({ id: 'foe', position: at(3, 0) })] });
    store().tickEffectsOnUnit('bers');
    expect(requireUnit(store().units, 'bers').currentHp).toBe(1);
  });
});

describe('the shield and save rules live in one place', () => {
  // Read as source, as `importCycles.test.ts` does: a second copy of these rules is
  // a failure nothing at runtime observes until the two disagree.
  it('keeps Last Stand, the Reckoning, the Barrier and the lethal save out of every other module', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const { SRC_DIR } = require('../support/paths') as { SRC_DIR: string };
    const owners = new Set(['systems/combat/damageFunnel.ts', 'systems/combat/passives.ts', 'systems/combat/statusEffects.ts']);
    const rules = /\b(absorbWithBarrier|absorbWithReckoning|reduceIncoming|survivesLethal|flooredHp)\b/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(full); continue; }
        const rel = path.relative(SRC_DIR, full).split(path.sep).join('/');
        if (!/\.tsx?$/.test(entry.name) || owners.has(rel)) continue;
        if (rules.test(fs.readFileSync(full, 'utf8'))) offenders.push(rel);
      }
    };
    walk(SRC_DIR);
    expect(offenders).toEqual([]);
  });
});
