import {
  ActiveEffect,
  CombatUnit,
  Hero,
  HeroClass,
  HeroSkill,
  HeroStats,
  HexCoord,
  SkillTargetType,
  StatusEffectType,
} from '@/models/types';

/**
 * One definition of the shapes the combat suites build.
 *
 * Thirty-one suites used to carry their own copy, so a new required field on
 * `CombatUnit` was thirty-one edits and the copies had already drifted (`maxHp`
 * 60 against 100, `maxMana` 0 against 50). The numbers are still each suite's
 * own business — pass them; only the *shape* lives here.
 *
 * Lives under `support/` because Jest claims every `.ts` under `__tests__` as a
 * suite, and `jest.config.js` ignores that directory for exactly this.
 */

export const at = (q: number, r: number): HexCoord => ({ q, r });

/** The modal defaults across the suites that had their own copy. */
export const makeStats = (over: Partial<HeroStats> = {}): HeroStats => ({
  maxHp: 100,
  attack: 20,
  defense: 0,
  magic: 10,
  speed: 10,
  moveRange: 3,
  maxMana: 50,
  ...over,
});

let nextId = 0;

/** Resets the id counter so a suite's ids are stable run to run. */
export const resetFixtureIds = () => {
  nextId = 0;
};

/**
 * Health and mana default to *full* rather than to a literal.
 *
 * That is the invariant the hand-rolled copies kept getting wrong: overriding
 * `stats.maxHp` without also overriding `currentHp` left a unit born wounded,
 * which quietly changes what every percentage-of-health rule does to it.
 *
 * A hand-built hostile unit is a rule's measuring stick, so it stands at the
 * base balance: spared `BALANCE.ENEMY_STRENGTH` (`sparedStrength`), the world's
 * tuning dial, which `runDifficulty.test.ts` measures on its own. Pass
 * `sparedStrength: false` for a foe the dial should reach.
 */
export function makeUnit(over: Partial<CombatUnit> = {}): CombatUnit {
  const stats = over.stats ?? makeStats();
  const id = over.id ?? `u${nextId++}`;
  return {
    isPlayer: true,
    position: at(0, 0),
    skills: [],
    hasMoved: false,
    hasActed: false,
    facingAngle: 0,
    activeEffects: [],
    ...(over.isPlayer === false && { sparedStrength: true }),
    ...over,
    id,
    name: over.name ?? id,
    stats,
    currentHp: over.currentHp ?? stats.maxHp,
    currentMana: over.currentMana ?? stats.maxMana,
  };
}

/** `makeUnit` on the other side of the board. */
export const makeFoe = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ isPlayer: false, ...over });

export function makeSkill(over: Partial<HeroSkill> = {}): HeroSkill {
  return {
    id: 'slash',
    name: 'Test Skill',
    description: '',
    targetType: SkillTargetType.Single,
    range: 1,
    unlockLevel: 1,
    manaCost: 0,
    ...over,
  } as HeroSkill;
}

export const makeEffect = (
  type: StatusEffectType,
  over: Partial<ActiveEffect> = {},
): ActiveEffect => ({ type, magnitude: 1, duration: 3, ...over });

/**
 * A hero, as the progression and economy suites want one.
 *
 * `makeUnit` above is a `CombatUnit` — what a hero *becomes* for the length of a
 * fight — and the two are not interchangeable: a `Hero` carries the equipment
 * map, the mastery path and the node levels, none of which survive into combat,
 * and `CombatUnit` carries a position and active effects, none of which exist
 * outside one.
 *
 * Defaults to a Champion with nothing chosen and nothing worn, because that is
 * the state every rule about paths and gear has to handle first. Health and mana
 * default to *full*, the invariant `makeUnit` documents and for its reason.
 */
export function makeHero(over: Partial<Hero> = {}): Hero {
  const baseStats = over.baseStats ?? makeStats();
  return {
    id: over.id ?? `hero-${nextId++}`,
    templateId: 'warrior',
    name: 'Test Hero',
    heroClass: HeroClass.Warrior,
    level: 5,
    xp: 0,
    currentHp: baseStats.maxHp,
    currentMana: baseStats.maxMana,
    skills: [],
    equipment: {},
    masteryPath: null,
    masteryPoints: 0,
    masteryNodes: {},
    ...over,
    baseStats,
  };
}
