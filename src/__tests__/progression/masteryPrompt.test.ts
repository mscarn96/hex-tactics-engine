import { Hero, MasteryId } from '@/models/types';
import { masteryPrompt } from '@/systems/progression/mastery';
import { BALANCE } from '@/data/balanceConstants';

/**
 * "Does this hero owe the player a decision" — the one predicate the party
 * portrait and the hero sheet both read.
 *
 * It exists because the two used to answer separately and the sheet's answer
 * was `masteryPoints > 0`, which is one of the two states: a hero who has hit
 * the unlock level and never picked a path is the *louder* one, and had no mark
 * anywhere in the game.
 *
 * The fixture is the predicate's own `Pick` rather than a whole `Hero`.
 * `support/fixtures.ts` defines the combat shapes and has never carried a hero,
 * and building one here would state a dozen fields this rule cannot see — which
 * is the copy that drifts.
 */

type PromptHero = Pick<Hero, 'level' | 'masteryPath' | 'masteryPoints'>;

const hero = (over: Partial<PromptHero> = {}): PromptHero => ({
  level: 1,
  masteryPath: null,
  masteryPoints: 0,
  ...over,
});

const UNLOCK = BALANCE.MASTERY_UNLOCK_LEVEL;
const PATH = 'bulwark' as MasteryId;

describe('an unchosen path', () => {
  it('is silent below the unlock level', () => {
    const offenders: string[] = [];
    for (let level = 1; level < UNLOCK; level++) {
      const p = masteryPrompt(hero({ level }));
      if (p !== null) offenders.push(`level ${level}: ${p.kind}`);
    }
    expect(offenders).toEqual([]);
  });

  it('prompts from the unlock level up', () => {
    const offenders: string[] = [];
    for (let level = UNLOCK; level <= BALANCE.MAX_LEVEL; level++) {
      const p = masteryPrompt(hero({ level }));
      if (p?.kind !== 'path') offenders.push(`level ${level}: ${p?.kind ?? 'null'}`);
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The two states cannot both be shown on one portrait, so the order is a
   * decision rather than an accident: a hero levelling past the unlock with no
   * path is earning points into a tree they have not opened, and telling them
   * about the points first points them at a screen that will only ask this
   * question again.
   */
  it('outranks unspent points', () => {
    expect(masteryPrompt(hero({ level: UNLOCK + 4, masteryPoints: 4 }))).toEqual({ kind: 'path' });
  });

  /**
   * Points earned before a path exists are not a decision — there is nothing to
   * spend them on, and `chooseMastery` recomputes the total from the level
   * anyway, so staying quiet loses nothing.
   */
  it('says nothing about points a pathless hero cannot spend', () => {
    expect(masteryPrompt(hero({ level: UNLOCK - 1, masteryPoints: 3 }))).toBeNull();
  });
});

describe('unspent points', () => {
  it('reports the count, so the pip can show it', () => {
    expect(masteryPrompt(hero({ level: 9, masteryPath: PATH, masteryPoints: 3 }))).toEqual({
      kind: 'points',
      count: 3,
    });
  });

  it('is silent once they are all spent', () => {
    expect(masteryPrompt(hero({ level: 9, masteryPath: PATH, masteryPoints: 0 }))).toBeNull();
  });

  /**
   * A hero with a path is never asked to choose one again — the path is
   * permanent, and `retrainMastery` deliberately keeps it while clearing the
   * nodes, which is exactly the state that would otherwise look unchosen.
   */
  it('never asks a hero with a path to choose one', () => {
    const offenders: string[] = [];
    for (let level = UNLOCK; level <= BALANCE.MAX_LEVEL; level++) {
      const p = masteryPrompt(hero({ level, masteryPath: PATH, masteryPoints: 2 }));
      if (p?.kind !== 'points') offenders.push(`level ${level}: ${p?.kind ?? 'null'}`);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The whole reason this is one function: a caller can tell the two apart, and
 * therefore draw them differently. A bare boolean would have made the party
 * portrait show a count it did not have.
 */
describe('the result is discriminated', () => {
  it('carries a count only on the points branch', () => {
    const points = masteryPrompt(hero({ level: 9, masteryPath: PATH, masteryPoints: 5 }));
    const path = masteryPrompt(hero({ level: 9 }));
    expect(points && points.kind === 'points' && points.count).toBe(5);
    expect(path && Object.keys(path)).toEqual(['kind']);
  });
});
