import { spyDice } from './dice';
import { at, makeStats, makeUnit } from './fixtures';
import { DRAGON_SKILLS } from '@/data/templates/emeraldDragon';
import { CombatUnit, HexCoord, VfxSpec } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { preparedBy } from '@/systems/combat/preparedAttacks';
import { resolveDuePrepared } from '@/systems/combat/preparedResolve';
import { CombatSink } from '@/systems/combat/skillResolution';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { requireUnit } from '@/systems/combat/unitLookup';

/**
 * A board for the Emerald Dragon's rules: a boss on the left, heroes where the test puts them, and the
 * few driving calls every Dragon suite makes (a hero's turn ending, a round of heroes, the landing).
 * Dice are pinned so a damage comparison is not a crit comparison; call `pinDragonDice` in a
 * `beforeEach` and `restoreDragonDice` in an `afterEach`.
 */

export const dragonStore = () => useCombatStore.getState();
export const dragonUnit = (id: string) => requireUnit(dragonStore().units, id);
export const dragonFx = { log: () => {} };

export const dragonBoss = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({
    id: 'boss',
    name: 'Dragon',
    isPlayer: false,
    templateId: 'dragon',
    stats: makeStats({ maxHp: 1000, attack: 30, magic: 30, defense: 20, speed: 5, moveRange: 2, maxMana: 0 }),
    position: at(-4, 0),
    skills: DRAGON_SKILLS,
    ...over,
  });

export const dragonHero = (id: string, position: HexCoord, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({
    id,
    name: id,
    heroId: id,
    position,
    stats: makeStats({ maxHp: 600, attack: 20, defense: 5, magic: 20, speed: 8, maxMana: 40 }),
    ...over,
  });

/** A fresh board: his regular turns begun count from the first. */
export function dragonArena(over: { heroes?: CombatUnit[]; boss?: Partial<CombatUnit> } = {}) {
  dragonStore().reset();
  const heroes = over.heroes ?? [dragonHero('a', at(0, 1)), dragonHero('b', at(1, 0))];
  dragonStore().initCombat(heroes, [dragonBoss(over.boss)]);
}

export const dragonPrepared = () => preparedBy('boss', dragonStore().preparedAttacks);

export const dragonLog: string[] = [];
export const dragonSpecs: VfxSpec[] = [];
export const dragonSink: CombatSink = {
  log: (text) => { dragonLog.push(text); },
  float: () => {},
  vfx: (spec) => { dragonSpecs.push(spec); },
  status: () => {},
};

/** A hero's turn ends: the one funnel every response window is counted through. */
export const heroTurnEnds = (id: string) => {
  useCombatStore.setState({ currentUnitId: id, bonusTurn: { pending: null, active: false } });
  dragonStore().nextTurn();
};

/** Every hero takes one regular turn: one full response round. */
export const heroRound = () => {
  for (const u of dragonStore().units.filter((x) => x.isPlayer && !x.objective && x.currentHp > 0)) heroTurnEnds(u.id);
};

/** His due warnings land. */
export const landDragon = () => resolveDuePrepared('boss', dragonSink);

export const pinDragonDice = () => {
  dragonLog.length = 0;
  dragonSpecs.length = 0;
  spyDice().mockReturnValue(0.99);
  setTempoRandom(() => 1);
};
export const restoreDragonDice = () => {
  jest.restoreAllMocks();
  setTempoRandom(() => 1);
};
