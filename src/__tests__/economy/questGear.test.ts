import { Hero, HeroClass, MasteryId, Rarity } from '@/models/types';
import { GearReward } from '@/quests/types';
import { gearFitFor, pathPriorities, resolveGearReward } from '@/systems/economy/questGear';
import { findTemplate } from '@/systems/economy/itemFactory';
import { MASTERY_PATHS, findMasteryPath } from '@/data/skills/masteryData';
import { MASTERY_ARMOUR_WEIGHT, MASTERY_WEAPON_FORMS, armourWeightOf } from '@/data/items/itemForms';
import { makeHero } from '@/__tests__/support/fixtures';

/**
 * A quest reward that answers the party rather than the catalogue.
 *
 * The version this replaces named four templates — one rare chest piece per
 * class, so that *across the campaign* every party got something. That is the
 * best a fixed id can do, and it is still wrong most of the time: non-common
 * gear is class-locked, so three quarters of the time the piece was for somebody
 * the player had not recruited.
 *
 * What is measured here is that the answer is a function of the **masteries**,
 * that it is legal for the hero it was chosen for, and that it degrades sensibly
 * when the party has nothing to read.
 */

const CHEST: GearReward = { slot: 'chest', rarity: Rarity.Rare };
const WEAPON: GearReward = { slot: 'mainHand', rarity: Rarity.Rare };

/** Nothing worn — the common case for these tests, and the permissive one. */
const bare = () => ({});

/**
 * A hero of the class that path belongs to.
 *
 * The class is read off `MASTERY_PATHS` rather than passed in, because a
 * Marksman on a Warrior body is a hero the game cannot produce — and every
 * class-lock assertion below would pass or fail for the wrong reason.
 */
const withPath = (path: MasteryId, over: Partial<Hero> = {}): Hero =>
  makeHero({ masteryPath: path, heroClass: findMasteryPath(path)!.heroClass, ...over });

describe('what a path wants', () => {
  /**
   * Derived from the tree, which is the whole point: "a Bulwark wants health and
   * defence" is already written down as the stat bonuses its own nodes grant, and
   * a table restating it would be wrong the first time a node is retuned.
   */
  it('reads a path\'s priorities off its own nodes', () => {
    const bulwark = pathPriorities('bulwark').map((p) => p.stat);
    expect(bulwark).toContain('maxHp');
    expect(bulwark).toContain('defense');

    const berserker = pathPriorities('berserker').map((p) => p.stat);
    // Crit chance (Offhand Fury) and armour penetration (Reckless) are the Berserker's
    // flat anchors; Savage Edge's old crit damage is a Bleed rule now, not a stat
    expect(berserker).toContain('critChance');
    // The Champion's two ends of the same class want opposite things, which is
    // the property that makes this worth doing at all
    expect(berserker).not.toContain('maxHp');
  });

  it('has something to say about every path the game ships', () => {
    const silent = MASTERY_PATHS
      .filter((p) => pathPriorities(p.id).filter((s) => s.weight > 0).length === 0)
      .map((p) => p.id);
    expect(silent).toEqual([]);
  });

  /**
   * A stat the tree spends *away* counts against a piece that hands it back.
   * The Berserker's nodes carry `defense: -4`; a defensive cuirass is working
   * against that build, and scoring it as merely neutral would let it win on its
   * other stats.
   */
  it('counts a stat the tree gives up as a negative', () => {
    const berserker = pathPriorities('berserker');
    const defense = berserker.find((p) => p.stat === 'defense');
    expect(defense).toBeDefined();
    expect(defense!.weight).toBeLessThan(0);
  });
});

describe('resolving a gear reward', () => {
  it('gives nothing to an empty party rather than inventing a recipient', () => {
    expect(resolveGearReward(CHEST, [], bare)).toBeNull();
  });

  /**
   * The headline: two Champions, opposite disciplines, different answers from the
   * same shape. Compared against each other rather than against a named template,
   * so retuning the item library moves both and the *rule* still holds.
   */
  it('hands two paths of one class different weapons', () => {
    const bulwark = resolveGearReward(WEAPON, [withPath('bulwark')], bare);
    const berserker = resolveGearReward(WEAPON, [withPath('berserker')], bare);

    expect(bulwark).not.toBeNull();
    expect(berserker).not.toBeNull();
    expect(bulwark!.templateId).not.toBe(berserker!.templateId);
  });

  /**
   * And it is not merely *class*-shaped: within every class, the three paths do
   * not all come away with the same thing.
   *
   * Stated per class rather than as "all twelve differ", because two pairs
   * honestly land on the same piece — a Pyromancer and a Stormcaller both carry
   * a staff, and the rare staff library is not deep enough to separate them.
   * Demanding twelve distinct answers would be a test about the size of the item
   * library rather than about this function.
   */
  it('separates paths within a class, not just classes', () => {
    const flat: string[] = [];
    // The classes with all three paths: a class with one tree so far has nothing to separate
    for (const heroClass of Object.values(HeroClass)) {
      const picks = MASTERY_PATHS
        .filter((p) => p.heroClass === heroClass)
        .map((p) => resolveGearReward(WEAPON, [withPath(p.id)], bare)?.templateId ?? 'none');
      // A class with one path landed so far (the Monk's Mantis) has nothing to separate
      if (picks.length > 1 && new Set(picks).size < 2) flat.push(`${heroClass}: ${picks.join(', ')}`);
    }
    expect(flat).toEqual([]);
  });

  /**
   * And the choice is *optimal*, not merely different.
   *
   * Swept over every ordered pair of paths: the piece chosen for a path must
   * suit that path at least as well as the piece chosen for any other one does.
   * Measured through the scorer rather than against a named template, so
   * retuning the item library or a mastery tree moves the answers and the rule
   * still holds — which is the whole reason the affinity is derived from the
   * trees instead of written beside them.
   */
  it('gives each path the piece that suits it best', () => {
    const worse: string[] = [];
    for (const spec of [CHEST, WEAPON]) {
      const picked = new Map(
        MASTERY_PATHS.map((p) => [p.id, resolveGearReward(spec, [withPath(p.id)], bare)]),
      );
      for (const mine of MASTERY_PATHS) {
        const own = picked.get(mine.id);
        if (!own) continue;
        const ownFit = gearFitFor(findTemplate(own.templateId)!.modifiers, mine.id);
        for (const other of MASTERY_PATHS) {
          const theirs = picked.get(other.id);
          // Only comparable where the other path's piece is one this hero could
          // legally have been given — a Bulwark scoring a Hydromancer's wand is
          // a comparison the resolver never had the option to make, and nor is a
          // Mantis scoring the Beetle's greatstaff or its plate: the Monk's paths
          // share a class and hold different weapons and weights.
          if (!theirs || other.heroClass !== mine.heroClass) continue;
          const template = findTemplate(theirs.templateId)!;
          const weight = armourWeightOf(template.form);
          if (spec.slot === 'mainHand' && !MASTERY_WEAPON_FORMS[mine.id].includes(template.form)) continue;
          if (weight && weight !== MASTERY_ARMOUR_WEIGHT[mine.id]) continue;
          const theirFit = gearFitFor(template.modifiers, mine.id);
          if (theirFit > ownFit + 1e-9) {
            worse.push(`${spec.slot} ${mine.id}: ${other.id}'s piece fits better`);
          }
        }
      }
    }
    expect(worse).toEqual([]);
  });

  /** Whatever it picks has to be legal for the hero it picked it for. */
  it('only ever offers something the chosen hero can wear', () => {
    const illegal: string[] = [];
    for (const path of MASTERY_PATHS) {
      for (const spec of [CHEST, WEAPON]) {
        const hero = withPath(path.id);
        const pick = resolveGearReward(spec, [hero], bare);
        if (!pick) continue;
        const template = findTemplate(pick.templateId)!;
        if (template.classLock && !template.classLock.includes(hero.heroClass)) {
          illegal.push(`${path.id}: ${pick.templateId} is ${template.classLock}`);
        }
      }
    }
    expect(illegal).toEqual([]);
  });

  /**
   * The rule most easily forgotten, and the reason legality goes through
   * `canEquip` rather than a re-derived class check: a path names the weapons it
   * carries. A Skirmisher may not hold a bow, and a reward that handed one over
   * would not throw — it would simply arrive unequippable.
   */
  it('respects the mastery weapon lock', () => {
    const wrong: string[] = [];
    for (const path of MASTERY_PATHS) {
      const pick = resolveGearReward(WEAPON, [withPath(path.id)], bare);
      if (!pick) continue;
      const form = findTemplate(pick.templateId)!.form;
      // Asked of the shipped table rather than of `canEquip` again, so this is a
      // second opinion rather than the same call restated.
      const allowed = MASTERY_WEAPON_FORMS[path.id];
      if (allowed && !allowed.includes(form)) wrong.push(`${path.id}: ${form}`);
    }
    expect(wrong).toEqual([]);
  });

  /**
   * A hero who has committed to a discipline always wins over one who has not,
   * whatever the scores say — an unchosen hero has no priorities, so their score
   * is zero and the comparison would otherwise be decided by item ordering.
   */
  it('prefers a hero who has chosen a path', () => {
    const undecided = makeHero({ id: 'undecided', masteryPath: null });
    const decided = withPath('bulwark', { id: 'decided' });

    expect(resolveGearReward(CHEST, [undecided, decided], bare)!.heroId).toBe('decided');
    // Order must not decide it
    expect(resolveGearReward(CHEST, [decided, undecided], bare)!.heroId).toBe('decided');
  });

  /**
   * And a party with no paths at all is still paid. Falling silent before level 5
   * would be the fixed-template failure inverted — a reward the log promises and
   * nothing delivers.
   */
  it('still pays a party that has chosen nothing', () => {
    const pick = resolveGearReward(CHEST, [makeHero({ masteryPath: null })], bare);
    expect(pick).not.toBeNull();
  });

  /**
   * Deterministic, so a contract's payment is a thing a player can be told about
   * rather than a roll they might reload for. The affixes are rolled at mint
   * time, which is the acquisition step and belongs to the caller.
   */
  it('gives the same answer twice for the same party', () => {
    const party = [withPath('marksman'), withPath('lifewarden')];
    const first = resolveGearReward(WEAPON, party, bare);
    const second = resolveGearReward(WEAPON, party, bare);
    expect(first).toEqual(second);
  });

  /**
   * Legendary set pieces are excluded by construction rather than by rarity —
   * the forge and the dungeon chest are their only two routes, and a third that
   * costs a conversation would flatten both.
   */
  it('never reaches for a mastery set piece', () => {
    const leaked: string[] = [];
    for (const path of MASTERY_PATHS) {
      for (const spec of [CHEST, WEAPON]) {
        const pick = resolveGearReward(spec, [withPath(path.id)], bare);
        if (!pick) continue;
        const template = findTemplate(pick.templateId)!;
        if (template.masteryLock?.length) leaked.push(pick.templateId);
      }
    }
    expect(leaked).toEqual([]);
  });
});
