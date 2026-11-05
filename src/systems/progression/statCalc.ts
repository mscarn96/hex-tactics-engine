import { Hero, HeroStats, Item, ItemModifiers } from '@/models/types';
import { useInventoryStore } from '@/stores/inventoryStore';
import { BALANCE } from '@/data/balanceConstants';
import { usesChi } from '@/data/classResource';
import {
  masteryModifiers,
  masteryPathGrowth,
  masteryStatBonus,
} from '@/systems/progression/mastery';
import { effectiveModifiers } from '@/systems/progression/itemStats';
import { applySetPercent, setBonusEffects } from '@/systems/progression/setBonuses';


/**
 * A hero's sheet: `baseStats → path growth → mastery nodes → equipment`.
 *
 * The order matters and it is the one D3 specifies. Mastery bonuses are flat and
 * land before items so that a percentage-based item modifier, if one is ever
 * added, scales the mastery investment rather than being scaled by it. The
 * path’s per-level growth is levelling, not gear, so it stays inside anything that scales the investment.
 */
export function getEffectiveStats(hero: Hero, items?: Item[]): HeroStats {
  const base = { ...hero.baseStats };
  // Stated Magic Defense is set aside while the sources pile up, so that what
  // accumulates in `base.magicDefense` is only the *extras* — nodes and gear
  // that name it. Class defence supplies the default before either bonus is added.
  const statedMagicDefense = base.magicDefense ?? Math.round(base.defense * BALANCE.MAGIC_DEFENSE_RATIO);
  delete base.magicDefense;

  const flat = { ...masteryStatBonus(hero) } as Partial<Record<keyof HeroStats, number>>;
  /**
   * The path's own per-level growth, in the same tier as the nodes.
   *
   * `baseStats` is what the hero's *class* earns — `calculateStatsForLevel` takes
   * a template and has never known which of three paths its owner walks. This is
   * the rest of the level, and it belongs here for the same reason equipment does: this is the one funnel every consumer already goes
   * through, so `heroMaxHp`, the damage maths and the hero sheet all get it
   * without learning the mechanic exists.
   */
  for (const [key, value] of Object.entries(masteryPathGrowth(hero)) as [
    keyof HeroStats,
    number,
  ][]) {
    flat[key] = (flat[key] ?? 0) + value;
  }

  for (const [key, value] of Object.entries(flat) as [
    keyof HeroStats,
    number,
  ][]) {
    // Variance stats default to a BALANCE baseline when absent, exactly as they
    // do for item modifiers — a +10 crit node must add to the 5% floor, not
    // replace it
    if (key === 'critChance')  base.critChance  = (base.critChance  ?? BALANCE.BASE_CRIT_CHANCE) + value;
    else if (key === 'critDamage')  base.critDamage  = (base.critDamage  ?? BALANCE.BASE_CRIT_DAMAGE) + value;
    else if (key === 'dodgeChance') base.dodgeChance = (base.dodgeChance ?? BALANCE.BASE_DODGE) + value;
    else base[key] = (base[key] ?? 0) + value;
  }

  // A tree that trades defence for attack must not be able to push a stat below
  // zero, where damage maths starts inverting
  base.attack = Math.max(0, base.attack);
  base.defense = Math.max(0, base.defense);
  base.magic = Math.max(0, base.magic);

  const equippedItems = items ?? Object.values(hero.equipment)
    .map((id) => useInventoryStore.getState().getItem(id))
    .filter((item): item is Item => item !== undefined);

  let itemHpPercent = 0;
  for (const item of equippedItems) {
    // `effectiveModifiers` is the one answer to what a worn item adds — item
    // level, a legendary's `+3` and (later) its gems, each applied once — so the
    // sheet, damage maths and the equipment screen cannot disagree about it
    const mods = effectiveModifiers(item);
    applyModifiers(base, mods);
    itemHpPercent += mods.maxHpPercent ?? 0;
  }

  /**
   * The sheet's percentage, and it lands **last** — after the nodes,
   * after the gear.
   *
   * D3's order puts flat mastery bonuses *before* items so that a percentage
   * *item* modifier would scale the mastery investment. This is that same rule
   * read from the other side: a percentage *mastery* modifier has to sit after
   * the flat sources it is meant to scale, or the node would be worth less the
   * better the hero's gear — the opposite of what a tank node says on the tin.
   *
   * On `maxHp` and nothing else, and therefore still inside the one ceiling:
   * `heroMaxHp` and `combatMaxHp` both read this number, so there is no second
   * source of truth for a health bar to disagree with. Floored at 1, because a
   * tree trading health away must not be able to produce a corpse.
   *
   * Gear's percentage (Jade, `maxHpPercent` in points) adds to the mastery's
   * rather than compounding with it, so two sources never multiply each other.
   */
  // Worn set pieces (`setBonuses.ts`): a stat bonus lands with the gear, and a
  // percentage on attack, magic or defence after it, so it scales what is worn
  const set = setBonusEffects(hero, equippedItems);
  applyModifiers(base, set.stats);
  const mastery = masteryModifiers(hero);
  // A mastery's percentage of Magic adds to a set's rather than compounding with
  // it, and lands with it, after the gear, for the reason the health share below does
  applySetPercent(base, { ...set.percent, magic: (set.percent.magic ?? 0) + (mastery.magicPercentBonus ?? 0) });

  const hpPercent = (mastery.maxHpPercentBonus ?? 0) + itemHpPercent / 100;
  if (hpPercent) base.maxHp = Math.max(1, Math.round(base.maxHp * (1 + hpPercent)));

  /**
   * Physical and Magic Defence grow independently. A class without stated
   * Magic Defence starts from its unmodified class defence; only bonuses that
   * name Magic Defence increase that resistance.
   */
  base.magicDefense = Math.max(
    0,
    statedMagicDefense +
      (base.magicDefense ?? 0),
  );

  // Chi replaces the one-point base regen with the Monk's own, and no path
  // bonus applies to it; gear and node regen above add to it one to one.
  if (usesChi(hero.heroClass)) {
    base.manaRegen = (base.manaRegen ?? 0) + BALANCE.CHI.REGEN;
    return base;
  }
  base.manaRegen = (base.manaRegen ?? 0) + BALANCE.MASTERY_MANA.BASE_REGEN;
  const caster = ['pyromancer', 'hydromancer', 'stormcaller', 'lifewarden', 'stoneshaper'].includes(hero.masteryPath ?? '');
  const mana = BALANCE.MASTERY_MANA;
  if (hero.masteryPath === 'shadowblade' || caster) {
    base.maxMana = Math.max(1, Math.round(base.maxMana * (caster ? mana.CASTER_POOL_MULT : mana.SHADOWBLADE_POOL_MULT)));
    base.manaRegen = (base.manaRegen ?? 0) + (caster ? mana.CASTER_REGEN : mana.SHADOWBLADE_REGEN);
  }

  return base;
}

/**
 * The health bar a hero actually fights with.
 *
 * **`baseStats.maxHp` is the body; this is the bar.** Base stats carry no gear
 * and no mastery nodes, but combat runs on `getEffectiveStats` — so a hero in
 * +HP gear has a ceiling `baseStats` has never heard of, and anything clamping
 * or filling health against the smaller one caps them below full by exactly the
 * gear's worth. Everything that heals, revives or writes HP back goes through
 * here; mana follows the same rule. Pinned by `heroHp.test.ts`.
 */
export function heroMaxHp(hero: Hero, items?: Item[]): number {
  return getEffectiveStats(hero, items).maxHp;
}

/** The mana pool a hero actually casts from. See `heroMaxHp`. */
export function heroMaxMana(hero: Hero, items?: Item[]): number {
  return getEffectiveStats(hero, items).maxMana;
}

function applyModifiers(stats: HeroStats, mods: ItemModifiers): void {
  if (mods.maxHp) stats.maxHp += mods.maxHp;
  if (mods.attack) stats.attack += mods.attack;
  if (mods.defense) stats.defense += mods.defense;
  if (mods.magicDefense) stats.magicDefense = (stats.magicDefense ?? 0) + mods.magicDefense;
  if (mods.magic) stats.magic += mods.magic;
  if (mods.speed) stats.speed += mods.speed;
  // Variance stats are usually absent, meaning "use the BALANCE default". The
  // moment gear modifies one it has to become explicit, so fold the default in
  // first — otherwise a +10% crit ring would *set* crit to 10, replacing the
  // 5% baseline instead of adding to it.
  if (mods.critChance) {
    stats.critChance = (stats.critChance ?? BALANCE.BASE_CRIT_CHANCE) + mods.critChance;
  }
  if (mods.critDamage) {
    stats.critDamage = (stats.critDamage ?? BALANCE.BASE_CRIT_DAMAGE) + mods.critDamage;
  }
  if (mods.dodgeChance) {
    stats.dodgeChance = (stats.dodgeChance ?? BALANCE.BASE_DODGE) + mods.dodgeChance;
  }
  // Penetration (armour and magic alike) has no baseline to fold in — absent means zero, and
  // zero is the honest default: ignoring none of the armour is what everything
  // without the stat does.
  if (mods.armourPen) stats.armourPen = (stats.armourPen ?? 0) + mods.armourPen;
  if (mods.magicPen) stats.magicPen = (stats.magicPen ?? 0) + mods.magicPen;
  // The five specialist stats follow armour penetration rather than crit:
  // absent means zero and zero is what they mean. There is no BALANCE baseline
  // to fold in, because "heals for none of the damage" and "adds nothing to a
  // barrier" are the correct behaviour for everything not wearing the stat.
  if (mods.lifesteal)    stats.lifesteal    = (stats.lifesteal    ?? 0) + mods.lifesteal;
  if (mods.manaRegen)    stats.manaRegen    = (stats.manaRegen    ?? 0) + mods.manaRegen;
  if (mods.healPower)    stats.healPower    = (stats.healPower    ?? 0) + mods.healPower;
  if (mods.shieldPower)  stats.shieldPower  = (stats.shieldPower  ?? 0) + mods.shieldPower;
  if (mods.poisonPower)  stats.poisonPower  = (stats.poisonPower  ?? 0) + mods.poisonPower;
  // maxMana passes through from baseStats unchanged (items don't modify mana)
}
