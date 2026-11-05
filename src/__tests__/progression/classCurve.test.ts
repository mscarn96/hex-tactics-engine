import { heroTemplates } from '@/data/templates/heroTemplates';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { STARTER_KIT, itemTemplates } from '@/data/items/itemTemplates';
import { BALANCE } from '@/data/balanceConstants';
import { HeroSkill } from '@/models/types';
import { starterBasicAttack } from '@/systems/combat/basicAttack';

/**
 * The shape of a hero before it picks a path.
 *
 * v0.5 handed out kits of one to three skills with no rule behind the number,
 * and listed six more the template could never grant. This pins the replacement:
 * one at-will, one identity skill, nothing that dies when a path is chosen.
 */

/**
 * What a new hero of this class can press at `level`: the Basic Attack its
 * starting weapon makes, then whatever the template grants by then. The free
 * attack is no longer on the template — it is read off the kit, which is what
 * `createPlayerUnits` does at combat setup — so the curve is measured the way
 * the player meets it.
 */
const at = (t: (typeof heroTemplates)[number], level: number): HeroSkill[] => [
  starterBasicAttack(t.heroClass),
  ...t.skills.filter((s) => s.unlockLevel <= level),
];

describe('the pre-mastery curve', () => {
  it('gives every class exactly one skill at level 1', () => {
    const wrong = heroTemplates
      .filter((t) => at(t, 1).length !== 1)
      .map((t) => `${t.id}: ${at(t, 1).map((s) => s.id)}`);
    expect(wrong).toEqual([]);
  });

  it('gives every class exactly two by level 3', () => {
    const wrong = heroTemplates
      .filter((t) => at(t, 3).length !== 2)
      .map((t) => `${t.id}: ${at(t, 3).map((s) => s.id)}`);
    expect(wrong).toEqual([]);
  });

  // Templates cap at level 4; anything listed above that is advertised and
  // never arrives, which is what the hero-select screen used to show
  it('lists nothing a template could never grant', () => {
    const stranded = heroTemplates.flatMap((t) =>
      t.skills.filter((s) => s.unlockLevel >= BALANCE.MASTERY_UNLOCK_LEVEL).map((s) => s.id)
    );
    expect(stranded).toEqual([]);
  });

  it('opens every class with a damaging attack', () => {
    const passive = heroTemplates
      .filter((t) => !at(t, 1).some((s) => s.damage))
      .map((t) => t.id);
    expect(passive).toEqual([]);
  });

  /**
   * The rule the whole table exists to satisfy.
   *
   * A pre-mastery skill is owned before the path is chosen, so it must not be
   * dead weight for any of the three. `provoke` failed this — a Berserker never
   * wants to taunt — and `fireball` failed it because two of three Arcanist
   * paths are not fire.
   */
  it('hands out no skill a mastery path also grants', () => {
    const fromTrees = new Set(
      MASTERY_PATHS.flatMap((p) =>
        [p.signatureSkill, ...p.nodes.map((n) => n.grantsSkill)].filter(Boolean),
      )
    );
    const overlap = heroTemplates.flatMap((t) =>
      t.skills.filter((s) => fromTrees.has(s.id)).map((s) => `${t.id}: ${s.id}`)
    );
    expect(overlap).toEqual([]);
  });

  // The class-fixed at-wills are gone from the templates: a free attack listed
  // there would sit on the bar beside the weapon's own, and one of the two would
  // be ignoring what the hero is holding.
  it('lists no free attack on a template — the weapon makes it', () => {
    const fixed = heroTemplates.flatMap((t) =>
      t.skills.filter((s) => s.damage && s.manaCost === 0 && !s.cooldown).map((s) => `${t.id}: ${s.id}`),
    );
    expect(fixed).toEqual([]);
  });

  it('gives the level-1 attack no mana cost', () => {
    const costly = heroTemplates
      .flatMap((t) => at(t, 1))
      .filter((s) => s.manaCost > 0)
      .map((s) => s.id);
    expect(costly).toEqual([]);
  });
});

describe('starter gear matches the opening kit', () => {
  it('mints every starter item from a template that exists', () => {
    const missing = Object.entries(STARTER_KIT).flatMap(([cls, ids]) =>
      ids.filter((id) => !itemTemplates.some((t) => t.id === id)).map((id) => `${cls}: ${id}`)
    );
    expect(missing).toEqual([]);
  });

  // The Hunter opens with a thrown blade — the short throw it has always started
  // with. A bow would hand a level-1 hero the longest free reach in the game
  it('arms the Hunter with thrown steel rather than a bow', () => {
    const ranger = STARTER_KIT.ranger;
    expect(ranger.some((id) => id.startsWith('throwing_blade'))).toBe(true);
    expect(ranger.some((id) => id.startsWith('bow_'))).toBe(false);
  });

  // The Druid's magic is the class's whole offence, so its first Basic Attack
  // has to be the missile — a cudgel would open on 5 attack
  it('opens the Druid on a magical Basic Attack', () => {
    expect(STARTER_KIT.healer[0]).toMatch(/^branch_/);
    expect(starterBasicAttack(heroTemplates.find((t) => t.id === 'healer')!.heroClass).scaling).toBe('magic');
  });
});

describe('the new pre-mastery skills', () => {
  const byId = new Map(heroTemplates.flatMap((t) => t.skills).map((s) => [s.id, s]));

  it('lets Heal reach the caster', () => {
    const heal = byId.get('heal')!;
    // Self-targeting is a property of `getSkillRangeHexes`, which now keeps the
    // caster's hex for anything that mends — this pins the skill side of it
    expect(heal.healing).toBeGreaterThan(0);
    expect(heal.damage).toBeUndefined();
  });

  it('gives Disengage a cooldown, since it moves, heals and leaves the turn unspent', () => {
    const dis = byId.get('disengage')!;
    expect(dis.selfMove?.kind).toBe('free');
    expect(dis.healing).toBeGreaterThan(0);
    expect(dis.healingBasis).toBe('missingHp');
    expect(dis.grantsUntargetable).toBeFalsy();
    expect(dis.freeAction).toBe(true);
    expect(dis.cooldown).toBeGreaterThanOrEqual(2);
  });

  it('keeps Arcane Burst element-neutral', () => {
    const burst = byId.get('arcane_burst')!;
    expect(burst.scaling).toBe('magic');
    expect(burst.aoeRadius).toBeGreaterThan(0);
  });
});
