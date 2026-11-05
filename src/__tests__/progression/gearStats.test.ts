import {
  AfflictionType,
  AuraType,
  Hero,
  HeroClass,
  HeroStats,
  Item,
  ItemModifiers,
  Rarity,
  SkillTargetType,
} from '@/models/types';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import { calculateHealing, calculateLifesteal, resolveAttack, resolveEffectMagnitude } from '@/systems/combat/damageCalc';
import { useCombatStore } from '@/stores/combatStore';
import { modifierLines } from '@/data/display/itemDisplay';
import { skillEffectLines } from '@/data/display/skillDisplay';
import { makeSkill, makeStats, makeUnit } from '@/__tests__/support/fixtures';
import { BALANCE } from '@/data/balanceConstants';
import { itemTemplates } from '@/data/items/itemTemplates';
import { applyAffixes } from '@/data/items/itemAffixes';
import { itemFromTemplate } from '@/systems/economy/itemFactory';
import { upgraded } from '@/systems/progression/upgrades';

/**
 * The seven stats a piece of loot uses to say what kind of hero it is for.
 *
 * The rule this file pins is the one that keeps them from being tooltip
 * decoration: **every one of them is spent somewhere, by exactly one system, and
 * the number the player reads is the number that system uses.** A stat nothing
 * consumes is a line on an item card, and the item card is not the game.
 *
 * `critChance` and `critDamage` already had consumers and only needed a way onto
 * gear; the other five are new on both ends, so each gets a case measuring the
 * behaviour rather than the field.
 */

const hero = (modifiers: ItemModifiers): { hero: Hero; items: Item[] } => {
  const item: Item = {
    id: 'i1', templateId: 't1', itemLevel: 1,
    rarity: Rarity.Rare, slot: 'ring', form: 'band', motif: 'iron',
    modifiers, sellPrice: 1,
  };
  return {
    hero: {
      id: 'h1', templateId: 'warrior', name: 'H', heroClass: HeroClass.Warrior,
      level: 1, xp: 0, baseStats: makeStats(), currentHp: 100, currentMana: 50,
      skills: [], equipment: { ring1: 'i1' }, masteryPath: null,
      masteryPoints: 0, masteryNodes: {},
    },
    items: [item],
  };
};

describe('gear carries the stat onto the sheet', () => {
  it('adds each defence bonus only to its named resistance', () => {
    const { hero: h, items } = hero({ defense: 7 });
    const naked = getEffectiveStats(h, []);
    const physical = getEffectiveStats(h, items);
    expect(physical.defense - naked.defense).toBe(7);
    expect(physical.magicDefense).toBe(naked.magicDefense);
    const magic = getEffectiveStats(h, [{ ...items[0], modifiers: { magicDefense: 9 } }]);
    expect(magic.defense).toBe(naked.defense);
    expect(magic.magicDefense! - naked.magicDefense!).toBe(9);
  });
  /**
   * `statCalc` is the one place a modifier becomes a stat, which is the same
   * deal `upgradeLevel` gets — every consumer downstream reads a finished sheet
   * and never learns the mechanic exists.
   */
  it('adds every specialist modifier to the effective sheet', () => {
    const missing: string[] = [];
    const keys: (keyof ItemModifiers & keyof HeroStats)[] = [
      'lifesteal', 'manaRegen', 'healPower', 'shieldPower', 'poisonPower',
    ];
    for (const key of keys) {
      const { hero: h, items } = hero({ [key]: 7 });
      if (getEffectiveStats(h, items)[key] !== 7 + (key === 'manaRegen' ? 1 : 0)) missing.push(key);
    }
    expect(missing).toEqual([]);
  });

  /**
   * Absent means zero, not "some baseline" — unlike crit, which folds
   * `BALANCE.BASE_CRIT_CHANCE` in first. Healing for none of the damage dealt is
   * the correct behaviour for a hero wearing no lifesteal, so there is nothing
   * to fold.
   */
  it('leaves them absent when nothing grants one', () => {
    const { hero: h, items } = hero({ attack: 3 });
    const stats = getEffectiveStats(h, items);
    expect(stats.lifesteal).toBeUndefined();
    expect(stats.poisonPower).toBeUndefined();
  });

  /** A Crystal is an item level, so a rolled specialist stat rides the same curve as the rest. */
  it('scales with a legendary’s upgrade level like every other modifier', () => {
    const { hero: h } = hero({});
    const t = itemTemplates.find((x) => x.rarity === Rarity.Legendary)!;
    const dropped = { ...applyAffixes(itemFromTemplate(t), ['vampiric']), id: 'i1' };
    let pumped: Item = dropped;
    for (let i = 0; i < BALANCE.MAX_UPGRADE_LEVEL; i++) pumped = upgraded(pumped);
    expect(getEffectiveStats(h, [pumped]).lifesteal!)
      .toBeGreaterThanOrEqual(getEffectiveStats(h, [dropped]).lifesteal!);
    const total = (i: Item) => Object.values(i.modifiers).reduce((n: number, v) => n + (v ?? 0), 0);
    expect(total(pumped)).toBeGreaterThan(total(dropped));
    expect(pumped.itemLevel).toBe(dropped.itemLevel + BALANCE.MAX_UPGRADE_LEVEL);
  });
});

describe('lifesteal', () => {
  const skill = makeSkill({ damage: 1 });

  it('drains on a skill that has no drain of its own', () => {
    const attacker = makeUnit({ stats: makeStats({ lifesteal: 25 }) });
    expect(calculateLifesteal(skill, 40, attacker)).toBe(10);
  });

  it('adds to a drain the skill already carries', () => {
    const plain = makeUnit({ stats: makeStats() });
    const geared = makeUnit({ stats: makeStats({ lifesteal: 25 }) });
    const drainSkill = makeSkill({ damage: 1, lifesteal: 0.25 });
    expect(calculateLifesteal(drainSkill, 40, plain)).toBe(10);
    expect(calculateLifesteal(drainSkill, 40, geared)).toBe(20);
  });

  /** No damage is no drain: a fully absorbed or dodged hit returns nothing. */
  it('returns nothing when nothing landed', () => {
    const attacker = makeUnit({ stats: makeStats({ lifesteal: 50 }) });
    expect(calculateLifesteal(skill, 0, attacker)).toBe(0);
  });

  /** The whole point: it arrives through `resolveAttack`, on every swing. */
  it('rides out of a resolved attack', () => {
    const attacker = makeUnit({ stats: makeStats({ lifesteal: 20, critChance: 0 }) });
    const target = makeUnit({ isPlayer: false, stats: makeStats({ defense: 0 }) });
    const result = resolveAttack(attacker, target, skill, { rng: () => 0.99 });
    expect(result.lifesteal).toBeGreaterThan(0);
  });
});

describe('heal power', () => {
  const heal = makeSkill({ healing: 2, targetType: SkillTargetType.Self });

  it('amplifies healing done, and nothing else', () => {
    const plain = makeUnit({ stats: makeStats({ magic: 20 }) });
    const geared = makeUnit({ stats: makeStats({ magic: 20, healPower: 50 }) });
    expect(calculateHealing(plain, heal)).toBe(40);
    expect(calculateHealing(geared, heal)).toBe(60);
  });

  /**
   * A Druid's loot has to read differently from an Arcanist's, which is the
   * whole reason these are three stats and not one "power". Heal power must not
   * touch a barrier, and shield power must not touch a heal.
   */
  it('does not reach a barrier', () => {
    const healer = makeUnit({ stats: makeStats({ magic: 20, healPower: 50 }) });
    expect(resolveEffectMagnitude(AuraType.Barrier, 40, healer)).toBe(40);
  });
});

describe('shield power', () => {
  it('amplifies a barrier this unit grants', () => {
    const plain = makeUnit({ stats: makeStats() });
    const geared = makeUnit({ stats: makeStats({ shieldPower: 50 }) });
    expect(resolveEffectMagnitude(AuraType.Barrier, 40, plain)).toBe(40);
    expect(resolveEffectMagnitude(AuraType.Barrier, 40, geared)).toBe(60);
  });

  /** A node and a piece of gear compose, rather than one scaling the other. */
  it('adds to a mastery node granting the same thing', () => {
    const both = makeUnit({
      stats: makeStats({ shieldPower: 50 }),
      masteryModifiers: { shieldPowerBonus: 0.5 },
    });
    expect(resolveEffectMagnitude(AuraType.Barrier, 40, both)).toBe(80);
  });

  it('does not reach a heal', () => {
    const warder = makeUnit({ stats: makeStats({ magic: 20, shieldPower: 50 }) });
    expect(calculateHealing(warder, makeSkill({ healing: 2 }))).toBe(40);
  });
});

describe('poison power', () => {
  /**
   * A dose is worth the applier's attack, so the amplifier lands on the resolved
   * magnitude — a poison authored as a fraction and one authored as a literal
   * both scale, which is what stops the stat working on some sources and not
   * others.
   */
  /**
   * `BALANCE.POISON_POWER` — the global dial every dose passes through — is
   * applied *before* the gear amplifies, and these expectations are written in
   * that order deliberately. The other order would make the discount worth more
   * the more a player had invested in poison, which is a nerf aimed at exactly
   * the build that chose the stat.
   */
  const dose = (raw: number) => Math.round(raw * BALANCE.POISON_POWER);

  it('amplifies a dose authored as a fraction of attack', () => {
    const plain = makeUnit({ stats: makeStats({ attack: 20 }) });
    const geared = makeUnit({ stats: makeStats({ attack: 20, poisonPower: 50 }) });
    expect(resolveEffectMagnitude(AfflictionType.Poison, 0.4, plain)).toBe(dose(0.4 * 20));
    expect(resolveEffectMagnitude(AfflictionType.Poison, 0.4, geared)).toBe(
      Math.round(dose(0.4 * 20) * 1.5),
    );
  });

  it('amplifies a dose authored as a literal too', () => {
    const geared = makeUnit({ stats: makeStats({ poisonPower: 50 }) });
    expect(resolveEffectMagnitude(AfflictionType.Poison, 10, geared)).toBe(
      Math.round(dose(10) * 1.5),
    );
  });

  it('leaves every other affliction alone', () => {
    const geared = makeUnit({ stats: makeStats({ attack: 20, poisonPower: 50 }) });
    expect(resolveEffectMagnitude(AfflictionType.Bleed, 0.4, geared)).toBe(8);
  });
});

describe('mana regeneration', () => {
  const arm = (manaRegen: number, currentMana: number) => {
    const unit = makeUnit({
      stats: makeStats({ maxMana: 50, manaRegen }),
      currentMana,
    });
    useCombatStore.setState({ units: [unit], fightStats: {} });
    return unit;
  };

  /**
   * In `tickEffectsOnUnit` rather than in `beginTurn`, because that is the
   * function whose contract is "one unit's changes from one snapshot, written
   * once" — a second writer is a second chance to drop one of the two updates.
   */
  it('restores mana at the start of the unit’s turn', () => {
    const unit = arm(6, 20);
    useCombatStore.getState().tickEffectsOnUnit(unit.id);
    expect(useCombatStore.getState().units[0].currentMana).toBe(26);
  });

  it('never overfills the pool', () => {
    const unit = arm(20, 45);
    useCombatStore.getState().tickEffectsOnUnit(unit.id);
    expect(useCombatStore.getState().units[0].currentMana).toBe(50);
  });

  it('does nothing for a unit wearing none', () => {
    const unit = arm(0, 20);
    useCombatStore.getState().tickEffectsOnUnit(unit.id);
    expect(useCombatStore.getState().units[0].currentMana).toBe(20);
  });
});

describe('the player can read them', () => {
  /**
   * `+8 Lifesteal` beside `+8 Attack` reads as the same size of thing, and one
   * is eight points of damage while the other is eight percent of every hit for
   * the rest of the campaign.
   */
  it('marks the percentages as percentages, and the flat one as flat', () => {
    const [lifesteal] = modifierLines({ lifesteal: 8 });
    expect(lifesteal.text).toBe('+8%');

    const [regen] = modifierLines({ manaRegen: 3 });
    expect(regen.text).toBe('+3');
    expect(regen.label).toBe('MP / turn');

    const [attack] = modifierLines({ attack: 8 });
    expect(attack.text).toBe('+8');
  });

  it('names them without a table of its own', () => {
    expect(modifierLines({ healPower: 5 })[0].label).toBe('Heal Power');
    expect(modifierLines({ poisonPower: 5 })[0].label).toBe('Poison Power');
  });

  /** A stat only on the hero sheet is one the player has to do arithmetic to believe in. */
  it('says on the skill what the gear is adding to it', () => {
    const healer = makeUnit({ stats: makeStats({ healPower: 30 }) });
    const lines = skillEffectLines(makeSkill({ healing: 2 }), healer);
    expect(lines.some((l) => /30% healing from your gear/.test(l))).toBe(true);
  });

  it('reports a drain on a skill that carries none of its own', () => {
    const thief = makeUnit({ stats: makeStats({ lifesteal: 15 }) });
    const lines = skillEffectLines(makeSkill({ damage: 1 }), thief);
    expect(lines.some((l) => /Heals for 15% of damage dealt/.test(l))).toBe(true);
  });

  /** With no caster in scope — the mastery tree — the tooltip reads as it always did. */
  it('adds nothing when there is no caster to read gear from', () => {
    const lines = skillEffectLines(makeSkill({ damage: 1 }));
    expect(lines.some((l) => /from your gear/.test(l))).toBe(false);
    expect(lines.some((l) => /Heals for/.test(l))).toBe(false);
  });
});
