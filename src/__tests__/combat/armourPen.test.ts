import { armourPenetration, calculateDamage, calculateLifesteal, magicPenetration, penetration } from '@/systems/combat/damageCalc';
import { budgetToModifiers } from '@/data/items/itemGen';
import { generateItemTemplates } from '@/data/items/itemGen';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { BALANCE } from '@/data/balanceConstants';
import { slash } from '@/data/skills/skillData';
import { CombatUnit, HeroSkill, HeroStats, MasteryId, Rarity } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';

/**
 * Armour penetration.
 *
 * The inverse of attack: worth least against paper and most against a wall,
 * which is why it belongs to the four paths whose problem is a target that will
 * not die. It reduces what defence is *worth* rather than adding to the hit,
 * and that distinction is the whole stat.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ attack: 30, critChance: 0, dodgeChance: 0, ...over });

const unit = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ stats: stats(), ...over });

describe('the stat', () => {
  it('does more against armour than against paper', () => {
    const plain = unit();
    const piercing = unit({ stats: stats({ armourPen: 50 }) });
    const soft = unit({ isPlayer: false, stats: stats({ defense: 0 }) });
    const armoured = unit({ isPlayer: false, stats: stats({ defense: 20 }) });

    const gainVsSoft =
      calculateDamage(piercing, soft, slash) - calculateDamage(plain, soft, slash);
    const gainVsArmour =
      calculateDamage(piercing, armoured, slash) - calculateDamage(plain, armoured, slash);

    expect(gainVsSoft).toBe(0);
    expect(gainVsArmour).toBeGreaterThan(0);
  });

  it('never turns mitigation into a bonus', () => {
    // A negative or absurd value must not make defence *help* the attacker
    expect(armourPenetration(stats({ armourPen: -80 }))).toBe(0);
    const wild = unit({ stats: stats({ armourPen: 5000 }) });
    const target = unit({ isPlayer: false, stats: stats({ defense: 20 }) });
    const naked = unit({ isPlayer: false, stats: stats({ defense: 0 }) });
    expect(calculateDamage(wild, target, slash)).toBeLessThanOrEqual(
      calculateDamage(wild, naked, slash),
    );
  });

  /**
   * Capped short of total. At full penetration the defence stat stops existing
   * for whoever stacked this — and defence is what a tank path, half the item
   * pool and several buffs are built around.
   */
  it('leaves armour meaning something at the ceiling', () => {
    expect(armourPenetration(stats({ armourPen: 100 }))).toBe(BALANCE.MAX_ARMOUR_PEN / 100);
    expect(BALANCE.MAX_ARMOUR_PEN).toBeLessThan(100);

    const maxed = unit({ stats: stats({ armourPen: 100 }) });
    const soft = unit({ isPlayer: false, stats: stats({ defense: 0 }) });
    const armoured = unit({ isPlayer: false, stats: stats({ defense: 30 }) });
    expect(calculateDamage(maxed, armoured, slash)).toBeLessThan(
      calculateDamage(maxed, soft, slash),
    );
  });

  it('is absent by default, so nothing else changes', () => {
    expect(armourPenetration(stats())).toBe(0);
  });
});

/**
 * Two penetrations, one per defence. Armour Pen pierces Physical Defense on a
 * physical hit, Magic Pen pierces Magic Defense on a magic hit, and neither ever
 * reaches the other's defence — so a caster's gear can carry pen worth something
 * to a caster, and a Sundering axe does nothing for a spell.
 */
describe('armour pen and magic pen', () => {
  const spell: HeroSkill = { ...slash, damageType: 'magic', scaling: 'magic' };
  // Both defences high and stated, so every hit here is answered and nothing sits on the floor
  const wall = () =>
    unit({ isPlayer: false, stats: stats({ defense: 30, magicDefense: 30 }) });
  const caster = (over: Partial<HeroStats> = {}) =>
    unit({ stats: stats({ magic: 60, attack: 60, ...over }) });

  it('pierces only the defence that matches the hit', () => {
    const plain = caster();
    const armourPiercer = caster({ armourPen: 50 });
    const magicPiercer = caster({ magicPen: 50 });

    // Physical hits: Armour Pen helps, Magic Pen does nothing
    expect(calculateDamage(armourPiercer, wall(), slash)).toBeGreaterThan(calculateDamage(plain, wall(), slash));
    expect(calculateDamage(magicPiercer, wall(), slash)).toBe(calculateDamage(plain, wall(), slash));

    // Magic hits: Magic Pen helps, Armour Pen does nothing
    expect(calculateDamage(magicPiercer, wall(), spell)).toBeGreaterThan(calculateDamage(plain, wall(), spell));
    expect(calculateDamage(armourPiercer, wall(), spell)).toBe(calculateDamage(plain, wall(), spell));
  });

  it('reads each stat for its own hit type, under its own cap', () => {
    const s = stats({ armourPen: 20, magicPen: 35 });
    expect(penetration(s, 'physical')).toBe(0.2);
    expect(penetration(s, 'magic')).toBe(0.35);
    expect(armourPenetration(s)).toBe(0.2);
    expect(magicPenetration(s)).toBe(0.35);
    expect(magicPenetration(stats({ magicPen: 500 }))).toBe(BALANCE.MAX_MAGIC_PEN / 100);
    expect(BALANCE.MAX_MAGIC_PEN).toBeLessThan(100);
    expect(magicPenetration(stats({ magicPen: -40 }))).toBe(0);
    expect(magicPenetration(stats())).toBe(0);
  });

  it('never lands magic pen on common or rare gear either', () => {
    const tilt = { magic: 3, magicPen: 3 };
    for (const rarity of [Rarity.Common, Rarity.Rare]) {
      expect(budgetToModifiers(10, tilt, rarity).magicPen).toBeUndefined();
    }
    expect(budgetToModifiers(10, tilt, Rarity.Legendary).magicPen).toBeGreaterThan(0);
    const leaked = generateItemTemplates()
      .filter((t) => t.modifiers.magicPen)
      .filter((t) => t.rarity !== Rarity.Epic && t.rarity !== Rarity.Legendary);
    expect(leaked).toEqual([]);
  });

  /** The Pyromancer and the Stormcaller mirror the martial killers; the Hydromancer's pen is Killing Frost. */
  it('rides the two caster sets whose job is the kill', () => {
    const carriers = new Set(
      generateItemTemplates().filter((t) => t.modifiers.magicPen).map((t) => t.motif),
    );
    expect([...carriers].sort()).toEqual(['pyromancer', 'stormcaller']);
  });
});

/**
 * Gear lifesteal is a property of the hero, not of the hit's type: a spell
 * drains exactly as a sword does. The sheet stat is capped at MAX_LIFESTEAL.
 */
describe('gear lifesteal', () => {
  const spell: HeroSkill = { ...slash, damageType: 'magic', scaling: 'magic' };

  it('heals from spell damage as it does from a weapon', () => {
    const vampire = unit({ stats: stats({ lifesteal: 10 }) });
    expect(calculateLifesteal(spell, 100, vampire)).toBe(10);
    expect(calculateLifesteal(slash, 100, vampire)).toBe(10);
  });

  it('stops at the cap', () => {
    const glutton = unit({ stats: stats({ lifesteal: 200 }) });
    expect(calculateLifesteal(slash, 100, glutton)).toBe(BALANCE.MAX_LIFESTEAL);
  });
});

describe('where it comes from', () => {
  it('never lands on common or rare gear', () => {
    const tilt = { attack: 3, armourPen: 3 };
    for (const rarity of [Rarity.Common, Rarity.Rare]) {
      expect(budgetToModifiers(10, tilt, rarity).armourPen).toBeUndefined();
    }
    for (const rarity of [Rarity.Epic, Rarity.Legendary]) {
      expect(budgetToModifiers(10, tilt, rarity).armourPen).toBeGreaterThan(0);
    }
  });

  it('holds that line across the whole generated library', () => {
    const leaked = generateItemTemplates()
      .filter((t) => t.modifiers.armourPen)
      .filter((t) => t.rarity !== Rarity.Epic && t.rarity !== Rarity.Legendary)
      .map((t) => `${t.id} (${t.rarity})`);
    expect(leaked).toEqual([]);
  });

  /**
   * The Berserker and all three Hunter paths, and nobody else. A tank path
   * carrying it would be building the answer to the thing it is supposed to be.
   */
  it('sits on exactly the four paths that need it', () => {
    const carries = (id: MasteryId) =>
      MASTERY_PATHS.find((p) => p.id === id)!.nodes.some((n) => n.statBonus?.armourPen);

    const expected: MasteryId[] = ['berserker', 'marksman', 'skirmisher', 'shadowblade'];
    const actual = MASTERY_PATHS.filter((p) => carries(p.id)).map((p) => p.id);
    expect(actual.sort()).toEqual([...expected].sort());
  });

  it('is reachable early on each of them, in tier one', () => {
    // It is an identity stat, not a reward for finishing the tree
    const late = MASTERY_PATHS.filter((p) =>
      p.nodes.some((n) => n.statBonus?.armourPen) &&
      !p.nodes.some((n) => n.statBonus?.armourPen && n.tier === 1),
    ).map((p) => p.id);
    expect(late).toEqual([]);
  });
});
