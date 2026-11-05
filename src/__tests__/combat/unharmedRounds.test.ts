import { TROLL_PHASES } from '@/data/templates/trollChieftain';
import { CombatUnit } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { SILENT_SINK } from '@/systems/combat/skillResolution';
import { unharmedRoundsOf, wholeRoundUnharmed } from '@/systems/combat/unharmed';
import { beginTurn } from '@/systems/combat/turnStart';
import { requireUnit } from '@/systems/combat/unitLookup';
import { at, makeStats, makeUnit } from '../support/fixtures';

/**
 * The unharmed-round counter on the boss script.
 *
 * It is 0 after any hero damage, rises by one as each regular boss turn begins, and a bonus or
 * Fury turn (which `beginTurn` starts by the short road) neither counts nor resets it. Pinned for the
 * Troll's and the Dragon's turn starts; Aethelred's goes through the same helper.
 */

const store = () => useCombatStore.getState();
const boss = () => requireUnit(store().units, 'boss');

const bossOf = (templateId: string, over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'boss', name: 'Boss', isPlayer: false, templateId: templateId as never,
    stats: makeStats({ maxHp: 1000, attack: 30, defense: 0, speed: 5, moveRange: 2, maxMana: 0 }),
    position: at(0, -1), skills: templateId === 'troll_chieftain' ? TROLL_PHASES[0].skills : [], ...over,
  });
const hero = makeUnit({ id: 'a', name: 'a', heroId: 'a', position: at(0, 3), stats: makeStats({ maxHp: 300, speed: 8 }) });

function fight(templateId: string) {
  store().reset();
  store().initCombat([hero], [bossOf(templateId)]);
}

/** A regular turn of his begins. */
const regularTurn = () => {
  useCombatStore.setState({ currentUnitId: 'boss', bonusTurn: { pending: null, active: false }, furyExtra: { active: false } });
  return beginTurn('boss', SILENT_SINK);
};

describe.each(['troll_chieftain', 'dragon', 'aethelred'])('%s', (templateId) => {
  it('starts at 0 and rises by one per regular turn begun', () => {
    fight(templateId);
    expect(unharmedRoundsOf(boss())).toBe(0);
    regularTurn();
    expect(unharmedRoundsOf(boss())).toBe(1);
    regularTurn();
    expect(unharmedRoundsOf(boss())).toBe(2);
    expect(wholeRoundUnharmed(boss())).toBe(true);
  });

  it('is 0 after any hero damage, however small, and counts again from there', () => {
    fight(templateId);
    regularTurn();
    regularTurn();
    store().damageUnit('boss', 1, 'a');
    expect(unharmedRoundsOf(boss())).toBe(0);
    expect(wholeRoundUnharmed(boss())).toBe(false);
    regularTurn();
    expect(unharmedRoundsOf(boss())).toBe(1);
  });

  it('is not reset by damage with no hero behind it, or by one that missed', () => {
    fight(templateId);
    regularTurn();
    store().damageUnit('boss', 5); // no author: a tick, a reflection
    store().damageUnit('boss', 5, 'boss'); // his own
    expect(unharmedRoundsOf(boss())).toBe(1);
  });

  it('ignores a speed bonus turn and a Fury action: they neither count nor reset it', () => {
    fight(templateId);
    regularTurn();
    expect(unharmedRoundsOf(boss())).toBe(1);

    useCombatStore.setState({ currentUnitId: 'boss', bonusTurn: { pending: null, active: true } });
    beginTurn('boss', SILENT_SINK);
    expect(unharmedRoundsOf(boss())).toBe(1);

    useCombatStore.setState({ currentUnitId: 'boss', bonusTurn: { pending: null, active: false }, furyExtra: { active: true } });
    beginTurn('boss', SILENT_SINK);
    expect(unharmedRoundsOf(boss())).toBe(1);

    // and a bonus turn he takes after a hero hurt him does not start the count either
    store().damageUnit('boss', 1, 'a');
    useCombatStore.setState({ currentUnitId: 'boss', bonusTurn: { pending: null, active: true }, furyExtra: { active: false } });
    beginTurn('boss', SILENT_SINK);
    expect(unharmedRoundsOf(boss())).toBe(0);
  });
});

it('a barrier that eats the blow still counts as damage', () => {
  fight('troll_chieftain');
  regularTurn();
  store().applyEffect('boss', { type: 'barrier' as never, magnitude: 500, duration: 3 });
  store().damageUnit('boss', 50, 'a');
  expect(unharmedRoundsOf(boss())).toBe(0);
});

it('leaves a script-less unit alone', () => {
  store().reset();
  store().initCombat([hero], [makeUnit({ id: 'boss', isPlayer: false, position: at(0, -1) })]);
  store().damageUnit('boss', 5, 'a');
  expect(boss().bossScript).toBeUndefined();
  expect(unharmedRoundsOf(boss())).toBe(0);
});
