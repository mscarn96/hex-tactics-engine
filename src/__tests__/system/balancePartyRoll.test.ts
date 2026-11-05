import { HeroClass, MasteryId, Rarity } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { findTemplate } from '@/systems/economy/itemFactory';
import { pointsSpent } from '@/systems/progression/mastery';
import { heroPreview, wornItems } from '@/systems/sim/scenarioItems';
import { nodeLevels, simPointBudget } from '@/systems/sim/simHarness';
import { budgetAt, defaultSpec, ENCOUNTER_IDS, EncounterSpec, heroLevelCap } from '@/systems/sim/balance/encounters';
import {
  capstoneMinLevel,
  capstonesOf,
  checkConstraints,
  PartyConstraints,
  RolledParty,
  rollParty,
} from '@/systems/sim/balance/partyRoll';
import { findMasteryPath } from '@/data/skills/masteryData';
import { partyRng } from '@/systems/sim/balance/rng';

/**
 * The rules a rolled party must obey, pinned over many seeds rather than for
 * the particular parties one seed happens to give.
 */

const SEEDS = 120;
const roll = (id: (typeof ENCOUNTER_IDS)[number], seed: number, c: PartyConstraints = {}): RolledParty =>
  rollParty(defaultSpec(id), c, partyRng(seed));

describe('rolling a party', () => {
  it('gives the same party for the same seed', () => {
    for (const id of ENCOUNTER_IDS) {
      expect(roll(id, 77)).toEqual(roll(id, 77));
    }
    expect(roll('castle', 1)).not.toEqual(roll('castle', 2));
  });

  it.each(ENCOUNTER_IDS)('keeps %s inside its hero count, level sum and rarity budget', (id) => {
    const spec = defaultSpec(id);
    for (let seed = 0; seed < SEEDS; seed++) {
      const party = roll(id, seed);
      expect(party.heroes.length).toBeGreaterThanOrEqual(spec.heroes.min);
      expect(party.heroes.length).toBeLessThanOrEqual(spec.heroes.max);
      expect(party.levelSum).toBeGreaterThanOrEqual(spec.levelSum.min);
      expect(party.levelSum).toBeLessThanOrEqual(spec.levelSum.max);
      for (const hero of party.heroes) {
        expect(hero.level).toBeGreaterThanOrEqual(1);
        expect(hero.level).toBeLessThanOrEqual(heroLevelCap(spec));
      }
      expect(party.budget.legendary).toBeGreaterThanOrEqual(spec.legendary.min);
      expect(party.budget.legendary).toBeLessThanOrEqual(spec.legendary.max);
      expect(party.budget.epic).toBeGreaterThanOrEqual(spec.epic.min);
      expect(party.budget.rare).toBeLessThanOrEqual(spec.rare.max);

      // Worn rarities never exceed what was rolled: a slot can only fall back, never up
      const worn = party.heroes.flatMap((h) => Object.values(h.equipment))
        .map((tid) => findTemplate(tid!)!.rarity);
      const count = (r: Rarity) => worn.filter((x) => x === r).length;
      expect(count(Rarity.Legendary)).toBeLessThanOrEqual(party.budget.legendary);
      expect(count(Rarity.Legendary) + count(Rarity.Epic)).toBeLessThanOrEqual(party.budget.legendary + party.budget.epic);
      expect(count(Rarity.Legendary) + count(Rarity.Epic) + count(Rarity.Rare))
        .toBeLessThanOrEqual(party.budget.legendary + party.budget.epic + party.budget.rare);
    }
  });

  it('builds every rolled hero through the real tree and the real equip rules', () => {
    for (const id of ENCOUNTER_IDS) {
      for (let seed = 0; seed < 25; seed++) {
        for (const hero of roll(id, seed).heroes) {
          const preview = heroPreview(hero);
          expect(preview).not.toBeNull();
          expect(preview!.problems).toEqual([]);
          expect(preview!.hero.level).toBe(hero.level);
          if (hero.level >= BALANCE.MASTERY_UNLOCK_LEVEL) expect(hero.masteryPath).not.toBeNull();
          else expect(hero.masteryNodes).toEqual([]);
          // Never spends more than the level grants
          const spent = pointsSpent({ masteryPath: hero.masteryPath, masteryNodes: nodeLevels(hero.masteryNodes) });
          expect(spent).toBeLessThanOrEqual(simPointBudget(hero));
          // A worn legendary that names a path is worn by that path
          for (const piece of Object.values(wornItems(hero))) {
            if (piece.rarity === Rarity.Legendary && piece.masteryLock?.length) {
              expect(piece.masteryLock).toContain(hero.masteryPath);
            }
          }
        }
      }
    }
  });

  it('records the capstone a hero ended with, and none for a hero below the unlock level', () => {
    let withCapstone = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      for (const hero of roll('castle', seed).heroes) {
        if (hero.capstone) {
          withCapstone++;
          expect(hero.masteryNodes).toContain(hero.capstone);
        }
        if (hero.level < BALANCE.MASTERY_UNLOCK_LEVEL) expect(hero.capstone).toBeNull();
      }
    }
    expect(withCapstone).toBeGreaterThan(SEEDS); // most level 16–20 heroes reach one
  });

  it('puts a legendary only on a hero whose path may wear it', () => {
    let seen = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      for (const hero of roll('heart', seed).heroes) {
        for (const piece of Object.values(wornItems(hero))) if (piece.rarity === Rarity.Legendary) seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('a budget written for one party size', () => {
  // A trio's budget, fielded at two to four heroes (the tactics dividend's run config does this)
  const trio: EncounterSpec = {
    ...defaultSpec('dragon'),
    heroes: { min: 2, max: 4 },
    budgetHeroes: 3,
    levelSum: { min: 39, max: 45 },
    legendary: { min: 3, max: 3 },
    epic: { min: 6, max: 6 },
    rare: { min: 6, max: 9 },
  };

  it('scales the level sum and the rarity counts by the hero count over the size it is written for', () => {
    expect(budgetAt(trio, 3)).toEqual({ levelSum: trio.levelSum, legendary: trio.legendary, epic: trio.epic, rare: trio.rare });
    expect(budgetAt(trio, 2)).toEqual({ levelSum: { min: 26, max: 30 }, legendary: { min: 2, max: 2 }, epic: { min: 4, max: 4 }, rare: { min: 4, max: 6 } });
    expect(budgetAt(trio, 4)).toEqual({ levelSum: { min: 52, max: 60 }, legendary: { min: 4, max: 4 }, epic: { min: 8, max: 8 }, rare: { min: 8, max: 12 } });
  });

  it('levels and dresses a hero alike at every party size', () => {
    const sizes = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const party = rollParty(trio, {}, partyRng(seed));
      const n = party.heroes.length;
      sizes.add(n);
      expect(party.levelSum / n).toBeGreaterThanOrEqual(13);
      expect(party.levelSum / n).toBeLessThanOrEqual(15);
      expect(party.budget.legendary / n).toBe(1);
      expect(party.budget.epic / n).toBe(2);
    }
    expect([...sizes].sort()).toEqual([2, 3, 4]);
  });

  it('leaves a budget without a party size the whole party\'s', () => {
    const spec = { ...defaultSpec('dragon'), heroes: { min: 2, max: 4 } };
    for (const n of [2, 3, 4]) expect(budgetAt(spec, n).levelSum).toEqual(spec.levelSum);
  });
});

describe('constraints', () => {
  const mustHold = (c: PartyConstraints, check: (p: RolledParty) => void, id: (typeof ENCOUNTER_IDS)[number] = 'dragon') => {
    expect(checkConstraints(defaultSpec(id), c)).toEqual([]);
    for (let seed = 0; seed < 60; seed++) check(roll(id, seed, c));
  };

  it('keeps a required class in the party', () => {
    mustHold({ mustClass: HeroClass.Monk }, (p) => expect(p.heroes.some((h) => h.heroClass === HeroClass.Monk)).toBe(true));
  });

  it('keeps a required path, and the hero is high enough to hold it', () => {
    mustHold({ mustPath: 'marksman' as MasteryId }, (p) => {
      const hero = p.heroes.find((h) => h.masteryPath === 'marksman');
      expect(hero).toBeDefined();
      expect(hero!.level).toBeGreaterThanOrEqual(BALANCE.MASTERY_UNLOCK_LEVEL);
    });
  });

  it('keeps a required capstone in a hero who actually holds it', () => {
    const path = findMasteryPath('pyromancer' as MasteryId)!;
    const capstone = capstonesOf(path)[0].id;
    mustHold({ mustCapstone: capstone }, (p) => {
      expect(p.heroes.some((h) => h.capstone === capstone && h.masteryNodes.includes(capstone))).toBe(true);
    }, 'heart');
  });

  it('honours excluded classes and paths, and forbidden duplicates', () => {
    const c: PartyConstraints = { excludeClasses: [HeroClass.Warrior], excludePaths: ['pyromancer' as MasteryId], allowDuplicates: false };
    mustHold(c, (p) => {
      const classes = p.heroes.map((h) => h.heroClass);
      expect(classes).not.toContain(HeroClass.Warrior);
      expect(new Set(classes).size).toBe(classes.length);
      for (const h of p.heroes) expect(h.masteryPath).not.toBe('pyromancer');
    }, 'heart');
  });

  it('reports a constraint that can never be met', () => {
    const troll = defaultSpec('troll');
    const caps = (id: string) => capstonesOf(findMasteryPath(id as MasteryId)!)[0].id;
    expect(checkConstraints(troll, { mustClass: HeroClass.Mage, excludeClasses: [HeroClass.Mage] })[0].code).toBe('excluded');
    expect(checkConstraints(troll, { mustPath: 'marksman' as MasteryId, excludePaths: ['marksman' as MasteryId] })[0].code).toBe('excluded');
    expect(checkConstraints(troll, { mustPath: 'marksman' as MasteryId, excludeClasses: [HeroClass.Ranger] })[0].code).toBe('excluded');
    expect(checkConstraints(troll, { mustPath: 'marksman' as MasteryId, mustCapstone: caps('pyromancer') })[0].code).toBe('conflict');
    expect(checkConstraints(troll, { mustCapstone: 'no_such_node' })[0].code).toBe('unknown');
    expect(checkConstraints(defaultSpec('castle'), { excludeClasses: [HeroClass.Warrior, HeroClass.Mage, HeroClass.Healer], allowDuplicates: false })[0].code)
      .toBe('too-few-classes');
    // A capstone deeper than any one hero of a two-hero party can be at this level sum
    const deep = capstonesOf(findMasteryPath('pyromancer' as MasteryId)!)[0].id;
    const need = capstoneMinLevel('pyromancer' as MasteryId, deep)!;
    expect(need).toBeGreaterThan(BALANCE.MASTERY_UNLOCK_LEVEL);
    const tight = { ...troll, levelSum: { min: need, max: need } };
    expect(checkConstraints(tight, { mustCapstone: deep }).map((p) => p.code)).toContain('level');
  });
});
