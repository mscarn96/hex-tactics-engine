import { Hero, HeroStats, MasteryId } from '@/models/types';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { MASTERY_GROWTH } from '@/data/skills/masteryGrowth';
import { masteryPathGrowth } from '@/systems/progression/mastery';
import { BALANCE } from '@/data/balanceConstants';
import { highestLevelCap } from '@/data/levelCap';

/**
 * A class's three paths must not level identically.
 *
 * Growth was a property of the hero *template* alone, so a Bulwark, a Templar
 * and a Berserker each gained the same +15 HP / +3 attack / +2 defence per level
 * and were, as bodies, the same hero in three colours — the only separation was
 * which nodes had been bought. The same held for the three Arcanists, the three
 * Druids and the three Hunters.
 *
 * The rules here matter more than the figures, which are a tuning pass: every
 * path has a tilt, no two paths of a class share one, and the term is zero at
 * the level a path is chosen so nobody's sheet rewrites itself.
 */

const hero = (over: Partial<Hero> = {}): Hero =>
  ({ level: 20, masteryPath: null, ...over }) as Hero;

describe('per-path growth', () => {
  it('covers every path the game fields', () => {
    const missing = MASTERY_PATHS.filter((p) => !MASTERY_GROWTH[p.id]).map((p) => p.id);
    expect(missing).toEqual([]);
  });

  it('names no path that does not exist', () => {
    const known = new Set(MASTERY_PATHS.map((p) => p.id));
    expect(Object.keys(MASTERY_GROWTH).filter((id) => !known.has(id as MasteryId))).toEqual([]);
  });

  it('gives every path something', () => {
    const empty = Object.entries(MASTERY_GROWTH)
      .filter(([, g]) => Object.values(g).every((v) => !v))
      .map(([id]) => id);
    expect(empty).toEqual([]);
  });

  /**
   * The whole point: within one class, no two paths may have the same tilt. Two
   * that did would be the state this feature exists to end, just one layer down.
   */
  it('gives each class three distinguishable paths', () => {
    const clashes: string[] = [];
    const byClass = new Map<string, MasteryId[]>();
    for (const p of MASTERY_PATHS) {
      byClass.set(p.heroClass, [...(byClass.get(p.heroClass) ?? []), p.id]);
    }

    for (const [heroClass, ids] of byClass) {
      const seen = new Map<string, MasteryId>();
      for (const id of ids) {
        const key = JSON.stringify(
          Object.entries(MASTERY_GROWTH[id]).filter(([, v]) => v).sort(),
        );
        const twin = seen.get(key);
        if (twin) clashes.push(`${heroClass}: ${twin} and ${id} level identically`);
        seen.set(key, id);
      }
    }
    expect(clashes).toEqual([]);
  });

  /**
   * Small on purpose. The class table is still the bulk of a hero's body — a
   * Champion gains 15 HP a level against a Bulwark's 5 — and a tilt that
   * outgrew it would make the class meaningless rather than the path meaningful.
   */
  it('keeps the tilt smaller than the class growth it sits on', () => {
    const tooBig: string[] = [];
    for (const [id, growth] of Object.entries(MASTERY_GROWTH)) {
      for (const [key, value] of Object.entries(growth) as [keyof HeroStats, number][]) {
        if (value > 5) tooBig.push(`${id}.${key} = ${value}`);
      }
    }
    expect(tooBig).toEqual([]);
  });
});

describe('when path growth applies', () => {
  /**
   * Zero at the level a path is chosen, which is what stops a hero's sheet
   * visibly rewriting itself the moment they commit — the failure mode that
   * ruled out applying it retroactively over every level.
   */
  it('is nothing at the level the path opens', () => {
    const h = hero({ level: BALANCE.MASTERY_UNLOCK_LEVEL, masteryPath: 'bulwark' });
    expect(masteryPathGrowth(h)).toEqual({});
  });

  it('is nothing below that level, path or no path', () => {
    expect(masteryPathGrowth(hero({ level: 3, masteryPath: 'bulwark' }))).toEqual({});
    expect(masteryPathGrowth(hero({ level: 3 }))).toEqual({});
  });

  it('is nothing at all for a hero who has not chosen', () => {
    expect(masteryPathGrowth(hero({ level: 20 }))).toEqual({});
  });

  it('accrues one step per level past the unlock level', () => {
    const at = (level: number) =>
      masteryPathGrowth(hero({ level, masteryPath: 'bulwark' })).maxHp ?? 0;
    const step = MASTERY_GROWTH.bulwark.maxHp!;

    expect(at(BALANCE.MASTERY_UNLOCK_LEVEL + 1)).toBe(step);
    expect(at(BALANCE.MASTERY_UNLOCK_LEVEL + 5)).toBe(step * 5);
    expect(at(BALANCE.MAX_LEVEL)).toBe(
      step * (BALANCE.MAX_LEVEL - BALANCE.MASTERY_UNLOCK_LEVEL),
    );
  });

  /** A level past the highest cap cannot buy growth no campaign hands out. */
  it('stops at the highest level cap', () => {
    const capped = masteryPathGrowth(hero({ level: highestLevelCap(), masteryPath: 'bulwark' }));
    const beyond = masteryPathGrowth(hero({ level: highestLevelCap() + 9, masteryPath: 'bulwark' }));
    expect(beyond).toEqual(capped);
  });

  /**
   * The measurement the feature is for: at the cap, two paths of one class are
   * meaningfully different bodies.
   */
  it('separates a Bulwark from a Berserker by the level cap', () => {
    const at20 = (path: MasteryId) => masteryPathGrowth(hero({ level: 20, masteryPath: path }));
    const wall = at20('bulwark');
    const blades = at20('berserker');

    expect(wall.maxHp).toBeGreaterThan(blades.maxHp ?? 0);
    expect(blades.attack ?? 0).toBeGreaterThan(wall.attack ?? 0);
    expect(wall.defense ?? 0).toBeGreaterThan(blades.defense ?? 0);
  });
});

/**
 * The Bulwark is the protector: with the class growth shared by all three
 * Champion paths, its sheet matched the Templar's attack on top of a warhammer.
 * It levels at an attack deficit now, so the gap to both siblings is present at
 * every measured level and grows with it.
 */
describe('the Bulwark hits softer than the other Champions', () => {
  const attackGrowth = (path: MasteryId, level: number) =>
    masteryPathGrowth(hero({ level, masteryPath: path })).attack ?? 0;

  it.each([10, 20, 30])('is clearly behind Templar and Berserker at level %i', (level) => {
    const bulwark = attackGrowth('bulwark', level);
    expect(attackGrowth('templar', level) - bulwark).toBeGreaterThanOrEqual(5);
    expect(attackGrowth('berserker', level) - bulwark).toBeGreaterThanOrEqual(5);
  });

  it('still carries its health and defence tilt', () => {
    expect(MASTERY_GROWTH.bulwark.maxHp).toBeGreaterThan(MASTERY_GROWTH.templar.maxHp!);
    expect(MASTERY_GROWTH.bulwark.defense).toBeGreaterThanOrEqual(MASTERY_GROWTH.templar.defense!);
  });
});
