import { isLegendaryGrade } from '@/data/items/rarity';
import { Hero, Item, ItemTemplate, MasteryId, Rarity, SetSkillBonus, SkillId } from '@/models/types';
import { findMasteryPath } from '@/data/skills/masteryData';
import { BALANCE } from '@/data/balanceConstants';
import { collectionPaths, isCollectionMotif } from '@/data/items/collections';
import { pathsOfClass } from '@/data/items/itemForms';

/**
 * What a legendary mastery set piece says about *your* build.
 *
 * The twelve sets were the one part of the item system with nothing left to
 * discover: a set piece is craftable at a level-3 forge, its stats are a fixed
 * tilt, and the seventh piece is the same decision as the first. Collecting them
 * was a shopping list.
 *
 * A set piece now rolls, once when it is acquired, a bonus to **one skill of its
 * own path**. Three properties, and each of them is load-bearing:
 *
 * - **From its own path**, so it can never be a bonus for a path that cannot
 *   wear the piece. That would be a roll the player can read as a failure of the
 *   game rather than of the dice.
 * - **A miss is build-relative.** The pool is the path's whole skill list —
 *   its signature plus every skill a node grants — and a hero holds at most 15
 *   points against 12 nodes, so there are always nodes they skipped. A bonus to
 *   a skill this Shadowblade did not take is a real miss with a real answer, and
 *   the answer is the forge.
 * - **Rolled at acquisition, never derived.** Deriving it from the hero wearing
 *   it would make the piece reshape itself when it changed hands, and a bonus
 *   that is always correct is a bonus nobody reads.
 *
 * The pool is read off `MASTERY_PATHS` rather than authored, so a node that
 * gains or loses a skill moves the pool with it — the alternative is a second
 * list of a path's skills that can disagree with the tree.
 */

/**
 * Every skill a path can put in a hero's hands.
 *
 * Its signature, plus one per node that grants one. Deduplicated, and in tree
 * order so a roll is reproducible from its `rng` rather than from a `Set`'s
 * iteration happening to be stable.
 */
export function setBonusPool(mastery: MasteryId): SkillId[] {
  // A path with no tree has an empty pool: the piece rolls no bonus rather
  // than one from somebody else's skills.
  const path = findMasteryPath(mastery);
  if (!path) return [];

  const ids: SkillId[] = [];
  const seen = new Set<SkillId>();
  const add = (id: SkillId | undefined) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };

  add(path.signatureSkill ?? undefined);
  for (const node of path.nodes) add(node.grantsSkill);
  return ids;
}

/** What a bonus roll needs to know about a piece. */
type Rollable = Pick<ItemTemplate, 'rarity' | 'masteryLock' | 'motif'>;

/** Who a collection roll may lean toward: only what `canEquip` would ask of a wearer's weight. */
export type BonusWearer = Pick<Hero, 'heroClass' | 'masteryPath'>;

/**
 * The path a mastery set piece's bonus draws from, or undefined if it is not one.
 *
 * A set piece is identified by carrying a `masteryLock` at Legendary — the same
 * pair `itemGen` writes and `canEquip` enforces — rather than by a flag of its
 * own, because a second marker is a second thing that can disagree about whether
 * a piece belongs to a set. The hand-written uniques are legendary and carry no
 * lock, so they are correctly excluded: Excalibur is a sword, not a set. A
 * collection piece has no one path, so it answers undefined here and
 * `bonusPaths` instead.
 */
export function setBonusPath(
  item: Pick<ItemTemplate, 'rarity' | 'masteryLock'>,
): MasteryId | undefined {
  if (!isLegendaryGrade(item.rarity)) return undefined;
  return item.masteryLock?.[0];
}

/**
 * Every path a piece's bonus may name: a set piece's own, or every path of a
 * collection's weight (`collectionPaths`) — empty for anything that rolls none.
 */
export function bonusPaths(item: Rollable): MasteryId[] {
  if (!isLegendaryGrade(item.rarity)) return [];
  const own = setBonusPath(item);
  if (own) return [own];
  return isCollectionMotif(item.motif) ? collectionPaths(item.motif) : [];
}

/**
 * Whether a template may be minted as a mythic: a legendary set piece, from a
 * mastery set or a world collection. Standalone legendaries, boss-only items and
 * authored weapons carry neither a lock nor a collection's motif, so they answer no.
 */
export function canBeMythic(template: Pick<ItemTemplate, 'rarity' | 'masteryLock' | 'motif'>): boolean {
  return template.rarity === Rarity.Legendary && (!!template.masteryLock?.length || isCollectionMotif(template.motif));
}

/** Whether a piece is a world collection's — the pieces whose bonus may name another path. */
export function isCollectionPiece(item: Pick<ItemTemplate, 'rarity' | 'motif'>): boolean {
  return isLegendaryGrade(item.rarity) && isCollectionMotif(item.motif);
}

/**
 * The path a rolled bonus belongs to: the one it recorded, or a set piece's own.
 */
export function bonusPathOf(item: Pick<Item, 'rarity' | 'masteryLock' | 'setBonus'>): MasteryId | undefined {
  return item.setBonus?.path ?? setBonusPath(item);
}

/**
 * Whether a piece's bonus is for the path this hero walks. A hero with no path
 * yet matches nothing; a piece with no bonus is never a mismatch. The bonus is
 * applied to the named skill whoever wears the piece (`skillPowerBonus`), so a
 * mismatch is simply a bonus to a skill this hero does not have.
 */
export function bonusFitsWearer(
  item: Pick<Item, 'rarity' | 'masteryLock' | 'setBonus'>,
  hero: Pick<Hero, 'masteryPath'>,
): boolean {
  if (!item.setBonus) return true;
  return bonusPathOf(item) === hero.masteryPath;
}

/** A uniform pick from a non-empty list, from one die. */
function pick<T>(list: T[], roll: number): T {
  return list[Math.min(list.length - 1, Math.floor(roll * list.length))];
}

/**
 * The path a collection roll lands on.
 *
 * With `BALANCE.COLLECTION_BONUS_PARTY_BIAS` the roll leans toward **one hero
 * who can wear the weight**, drawn uniformly — their own path, or before a path
 * one of their class's that wears it — the loot table's "whose" lean
 * (`PARTY_LOOT_BIAS`) applied to a skill rather than a slot. Otherwise any path
 * of the weight, uniformly, which is where a Templar's plate rolling a Beetle
 * skill comes from. All three dice are thrown whatever the party, so a seeded
 * roll lands the same way with or without one.
 */
function rollCollectionPath(paths: MasteryId[], wearers: BonusWearer[], rng: () => number): MasteryId {
  const lean = rng();
  const whoRoll = rng();
  const pathRoll = rng();
  const eligible = wearers.filter((h) => (h.masteryPath
    ? paths.includes(h.masteryPath)
    : pathsOfClass(h.heroClass).some((p) => paths.includes(p))));
  if (lean < BALANCE.COLLECTION_BONUS_PARTY_BIAS && eligible.length > 0) {
    const who = pick(eligible, whoRoll);
    if (who.masteryPath) return who.masteryPath;
    return pick(pathsOfClass(who.heroClass).filter((p) => paths.includes(p)), pathRoll);
  }
  return pick(paths, pathRoll);
}

/**
 * Rolls a piece's bonus, or returns undefined for anything that rolls none.
 *
 * A set piece draws from its own path. A collection piece first draws a path of
 * its weight (`rollCollectionPath`, leaning toward `wearers`) and then a skill
 * from that path's whole pool — signature and every node, the ones this build
 * skipped included — and records the path, since the piece itself names none.
 *
 * `rng` is injectable for the reason every roll here is: a proc nobody can pin
 * is a proc nobody can balance — and this one is rerollable for resources, so
 * the reroll has to be testable against a known starting point.
 */
export function rollSetBonus(
  item: Rollable,
  rng: () => number = Math.random,
  wearers: BonusWearer[] = [],
): SetSkillBonus | undefined {
  const own = setBonusPath(item);
  if (own) {
    const pool = setBonusPool(own);
    if (pool.length === 0) return undefined;
    return { skillId: pick(pool, rng()), percent: BALANCE.SET_BONUS_PERCENT };
  }

  const paths = bonusPaths(item).filter((p) => setBonusPool(p).length > 0);
  if (paths.length === 0) return undefined;
  const path = rollCollectionPath(paths, wearers, rng);
  return { skillId: pick(setBonusPool(path), rng()), percent: BALANCE.SET_BONUS_PERCENT, path };
}

/**
 * The paths a piece's bonus may be re-aimed at: a set piece's own, or every path
 * of a collection's weight with a skill to land on other than the one it holds.
 */
export function rerollPaths(item: Pick<Item, 'rarity' | 'masteryLock' | 'motif' | 'setBonus'>): MasteryId[] {
  if (!item.setBonus) return [];
  const current = item.setBonus.skillId;
  return bonusPaths(item).filter((p) => setBonusPool(p).some((id) => id !== current));
}

/**
 * Rerolls an existing bonus, and **never returns the one it started with**.
 *
 * A reroll that can land on the skill you were trying to leave is a reroll that
 * costs resources to change nothing, which reads as the forge being broken
 * rather than as the dice being unkind. Excluding the current pick makes the
 * price honest: it always buys a different answer. With a pool of one there is
 * no different answer, so the item comes back untouched — and `canReroll`
 * refuses before it gets that far.
 *
 * A collection piece is re-aimed at `toPath`, which the player picks at the
 * forge from `rerollPaths` — so a wrong-path roll is repaired by choosing the
 * wearer's path — and keeps its recorded path when none is given.
 */
export function rerollSetBonus<T extends Pick<Item, 'rarity' | 'masteryLock' | 'motif' | 'setBonus'>>(
  item: T,
  rng: () => number = Math.random,
  toPath?: MasteryId,
): T {
  const own = setBonusPath(item);
  if (own) {
    const pool = setBonusPool(own).filter((id) => id !== item.setBonus?.skillId);
    if (pool.length === 0) return item;
    return { ...item, setBonus: { skillId: pick(pool, rng()), percent: BALANCE.SET_BONUS_PERCENT } };
  }

  const target = toPath ?? item.setBonus?.path;
  if (!target || !rerollPaths(item).includes(target)) return item;
  const pool = setBonusPool(target).filter((id) => id !== item.setBonus?.skillId);
  return { ...item, setBonus: { skillId: pick(pool, rng()), percent: BALANCE.SET_BONUS_PERCENT, path: target } };
}

/** Whether this item has a bonus there is any point rerolling. */
export function canRerollSetBonus(item: Pick<Item, 'rarity' | 'masteryLock' | 'motif' | 'setBonus'>): boolean {
  return rerollPaths(item).length > 0;
}
