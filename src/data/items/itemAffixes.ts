import { AffixId, HeroClass, Item, ItemModifiers, ItemTemplate, Rarity } from '@/models/types';
import { MOTIF_CLASS, OFFHAND_CLASS, StatTilt } from '@/data/items/itemForms';
import { RARITY_SCALE, budgetToModifiers, itemBudget } from '@/data/items/itemGen';

/**
 * The layer that makes two Frostbound Long Swords different swords.
 *
 * Form × motif is a good library and a poor *drop table*: the form decides the
 * silhouette and the tilt, the motif decides the palette and half a tilt, and
 * between them they produce exactly one Frostbound Long Sword that every
 * Frostbound Long Sword in the save is a copy of. A player who has seen the
 * item once has seen it, and the only thing a second one can be is a duplicate
 * to sell. That is the "not enough diversity, especially early on" report.
 *
 * An affix is rolled **at acquisition**, not authored, and it is what a piece
 * says about itself past its silhouette. Two rules keep it from being noise:
 *
 * - **Commons stay clean.** They are the baseline a player learns the stat
 *   budget from, and a common that sometimes carries a rider is a baseline that
 *   cannot be read. The first affix a player ever sees is therefore also the
 *   first time a rare is visibly *different in kind* from a common rather than
 *   larger — which is the moment rarity starts meaning something.
 * - **It has a name.** An unnamed `+6% crit` is a number; "Keen" is a thing a
 *   player asks for, compares, and remembers not finding. The instance keeps
 *   the affix ids, and `itemText.itemName` says them in the name wherever it
 *   is shown (`items.affix.<id>.pattern`).
 *
 * Each affix spends a share of the item's own budget through the same
 * `budgetToModifiers` the base item does, so an affix on a ring is smaller than
 * the same affix on a cuirass without a second table saying so.
 */

export interface AffixSpec {
  id: AffixId;
  /** Goes in front of the item's name, or after it. */
  kind: 'prefix' | 'suffix';
  /** How this affix spends its share. Same shape and same units as a form's tilt. */
  tilt: StatTilt;
  /**
   * Classes this affix is worth rolling for. Omitted means all four.
   *
   * A greatsword "of the Grove" is a dead roll — heal power on a weapon nothing
   * that holds it will ever heal with — and a dead roll is worse than no affix,
   * because it looks like the piece rolled *something*. Affinity is read off the
   * item rather than authored per item: an item's class comes from its lock, its
   * off-hand kind, or its motif, in that order.
   */
  classes?: HeroClass[];
  /**
   * The lowest rarity this affix may appear at.
   *
   * Penetration is the answer to a wall and the back half of the campaign is
   * made of walls — `itemGen.RARITY_GATED_STATS` already refuses to allocate
   * either kind below Epic, so an affix that granted it on a rare would fall through to
   * that function's "give it something" fallback and hand out a token point
   * instead. Naming the gate here is what makes the refusal legible rather than
   * an artefact.
   */
  minRarity?: Rarity;
}

const W = HeroClass.Warrior;
const R = HeroClass.Ranger;
const M = HeroClass.Mage;
const H = HeroClass.Healer;

/**
 * Twenty-two affixes, eleven of each kind.
 *
 * Penetration comes in two halves and so do its riders: Sundering and of Ruin
 * carry Armour Pen for the martial classes, Piercing and of Unmaking carry Magic
 * Pen for the Arcanist. One stat that pierced whichever defence answered made
 * every pen roll a martial roll, and a mage who found one had found nothing.
 *
 * A prefix and a suffix rather than two of one sort, because a name has room for
 * exactly one of each and "Keen Brutal Long Sword" reads as a bug. It also gives
 * the two halves different jobs: a prefix is one stat said loudly, a suffix is a
 * pair that says what the piece is *for*.
 */
export const AFFIXES: AffixSpec[] = [
  // ── Prefixes: one stat, said loudly ───────────────────────────────────────
  { id: 'keen',      kind: 'prefix', tilt: { critChance: 1 } },
  { id: 'brutal',    kind: 'prefix', tilt: { critDamage: 1 } },
  { id: 'sundering', kind: 'prefix', tilt: { armourPen: 1 },
    minRarity: Rarity.Epic, classes: [W, R] },
  { id: 'piercing',  kind: 'prefix', tilt: { magicPen: 1 },
    minRarity: Rarity.Epic, classes: [M] },
  { id: 'vampiric',  kind: 'prefix', tilt: { lifesteal: 1 }, classes: [W, R, M] },
  { id: 'attuned',   kind: 'prefix', tilt: { manaRegen: 1 } },
  { id: 'blessed',   kind: 'prefix', tilt: { healPower: 1 }, classes: [H] },
  { id: 'warded',    kind: 'prefix', tilt: { shieldPower: 1, magicDefense: 1 }, classes: [H, M] },
  { id: 'venomous',  kind: 'prefix', tilt: { poisonPower: 1 }, classes: [R] },
  { id: 'swift',     kind: 'prefix', tilt: { speed: 2, dodgeChance: 1 } },
  { id: 'stalwart',  kind: 'prefix', tilt: { maxHp: 2, defense: 1 } },

  // ── Suffixes: a pair that says what the piece is for ──────────────────────
  { id: 'of_the_viper',      kind: 'suffix',
    tilt: { poisonPower: 2, attack: 1 }, classes: [R] },
  // Lifesteal at weight 1, not 2: at its 1%-a-point price (`STAT_PER_POINT`) a
  // weight of 2 made a legendary two-hander "of the Leech" +23%. It is Vampiric's
  // lifesteal plus the attack now, which is still more of both than it ever was.
  { id: 'of_the_leech',      kind: 'suffix',
    tilt: { lifesteal: 1, attack: 1 }, classes: [W, R] },
  { id: 'of_the_duelist',    kind: 'suffix',
    tilt: { critChance: 2, speed: 1 } },
  // Ruin was any class, so it handed Armour Pen to an Arcanist's cowl — the half of
  // the roll a caster can never spend. It is the martial half now (the Druid's
  // claws and stone are physical too), and Unmaking is the caster's.
  { id: 'of_ruin',           kind: 'suffix',
    tilt: { critDamage: 2, armourPen: 1 }, minRarity: Rarity.Epic, classes: [W, R, H] },
  { id: 'of_unmaking',       kind: 'suffix',
    tilt: { critDamage: 2, magicPen: 1 }, minRarity: Rarity.Epic, classes: [M] },
  { id: 'of_the_wellspring', kind: 'suffix',
    tilt: { manaRegen: 2, magic: 1 }, classes: [M, H] },
  { id: 'of_the_grove',      kind: 'suffix',
    tilt: { healPower: 2, magic: 1 }, classes: [H] },
  { id: 'of_the_aegis',    kind: 'suffix',
    tilt: { shieldPower: 2, defense: 1 }, classes: [H, W] },
  { id: 'of_the_wind',       kind: 'suffix',
    tilt: { dodgeChance: 2, speed: 1 } },
  { id: 'of_the_ox',         kind: 'suffix',
    tilt: { maxHp: 2, defense: 1 } },
  { id: 'of_fury',           kind: 'suffix',
    tilt: { attack: 2, critDamage: 1 }, classes: [W, R] },
];

const AFFIX_BY_ID = new Map<AffixId, AffixSpec>(AFFIXES.map((a) => [a.id, a]));

export const findAffix = (id: AffixId): AffixSpec | undefined => AFFIX_BY_ID.get(id);

/**
 * Share of an item's own stat budget one affix is worth, on top of the base.
 *
 * Additive rather than carved out of the base, because an affix has to be good
 * news: a rare that traded a third of its attack for crit chance would be a
 * *worse* sword that happened to be more interesting, and the player would learn
 * to want the clean one. Two affixes on an epic therefore add ~44%, which is
 * roughly the step from a rare to an epic again — that is the intent, and it is
 * why they arrive at the tier they do.
 */
const AFFIX_SHARE = 0.22;

/** How many affixes a piece of this rarity rolls. Commons roll none, ever. */
export function affixCount(rarity: Rarity): number {
  switch (rarity) {
    case Rarity.Common: return 0;
    case Rarity.Rare: return 1;
    default: return 2;
  }
}

/**
 * The classes an affix pool should be filtered against.
 *
 * In order: what the item is locked to, what its off-hand kind implies, what its
 * motif says. Undefined for a common — which never rolls anyway — and for the
 * handful of unlocked pieces, where the whole pool is the honest answer. A list,
 * because gear is shared: an affix suits the item when it suits any class that
 * may wear it.
 */
export function affinityClasses(
  item: Pick<ItemTemplate, 'classLock' | 'offHandKind' | 'motif'>,
): HeroClass[] | undefined {
  if (item.classLock) return item.classLock;
  if (item.offHandKind) return OFFHAND_CLASS[item.offHandKind] ?? undefined;
  return MOTIF_CLASS[item.motif];
}

/** Every affix of `kind` this item could legally roll. */
export function affixPool(
  item: Pick<ItemTemplate, 'classLock' | 'offHandKind' | 'motif' | 'rarity'>,
  kind: AffixSpec['kind'],
): AffixSpec[] {
  const affinity = affinityClasses(item);
  const rank = RARITY_RANK[item.rarity];
  return AFFIXES.filter(
    (a) =>
      a.kind === kind &&
      (!a.minRarity || rank >= RARITY_RANK[a.minRarity]) &&
      (!a.classes || !affinity || affinity.some((c) => a.classes?.includes(c))),
  );
}

const RARITY_RANK: Record<Rarity, number> = {
  [Rarity.Common]: 0,
  [Rarity.Rare]: 1,
  [Rarity.Epic]: 2,
  [Rarity.Legendary]: 3,
  [Rarity.Mythic]: 4,
};

/**
 * Rolls this item's affixes.
 *
 * One of each kind at most, and the prefix is dropped first when only one is
 * owed — a suffix is the half that says what the piece is *for*, and a single
 * roll should be the more informative one. `rng` is injectable for the reason
 * every roll in this codebase is: a proc nobody can pin is a proc nobody can
 * balance.
 */
export function rollAffixes(
  template: Pick<ItemTemplate, 'classLock' | 'offHandKind' | 'motif' | 'rarity'>,
  rng: () => number = Math.random,
): AffixId[] {
  const count = affixCount(template.rarity);
  if (count === 0) return [];

  const pick = (kind: AffixSpec['kind']): AffixId | null => {
    const pool = affixPool(template, kind);
    if (pool.length === 0) return null;
    return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))].id;
  };

  const rolled = [count >= 2 ? pick('prefix') : null, pick('suffix')];
  return rolled.filter((id): id is AffixId => id !== null);
}

/**
 * What an affixed item is worth, and which affixes it carries.
 *
 * The stats and the ids at once, because they are one decision and separating
 * them is how a "Keen" sword ends up with no crit on it. Applied at mint and baked into the
 * instance, so `statCalc` and `effectiveModifiers` need to know nothing about
 * affixes — the upgrade multiplier reaches an affix's stats for free, exactly
 * as it reaches the base ones.
 */
export function applyAffixes<T extends Pick<Item, 'modifiers' | 'rarity' | 'slot' | 'handRule'>>(
  item: T,
  affixes: AffixId[],
): T & { affixes?: AffixId[] } {
  if (affixes.length === 0) return item;

  const specs = affixes.map(findAffix).filter((s): s is AffixSpec => !!s);
  if (specs.length === 0) return item;

  const points = itemBudget(item) * RARITY_SCALE[item.rarity] * AFFIX_SHARE;
  const modifiers: ItemModifiers = { ...item.modifiers };
  for (const spec of specs) {
    for (const [key, value] of Object.entries(
      budgetToModifiers(points, spec.tilt, item.rarity),
    ) as [keyof ItemModifiers, number][]) {
      modifiers[key] = (modifiers[key] ?? 0) + value;
    }
  }
  return { ...item, modifiers, affixes: specs.map((s) => s.id) };
}
