import { Hero, Item, ItemModifiers, MasteryId } from '@/models/types';
import { GearReward } from '@/quests/types';
import { GearWorld, inWorld } from '@/data/items/worldGear';
import { itemTemplates } from '@/data/items/itemTemplates';
import { itemFromTemplate } from '@/systems/economy/itemFactory';
import { EquippedItems, canEquip, slotsFor } from '@/systems/progression/equipRules';
import { MASTERY_PATHS } from '@/data/skills/masteryData';

/**
 * Which piece of gear a quest hands over, worked out from the party it is
 * handed to.
 *
 * `QuestRewards.items` names a template outright, and for four quests it did —
 * one rare chest piece each, spread one per class so that *across the campaign*
 * every party got something. That is the best a fixed id can do and it is not
 * very good: non-common gear is class-locked, so three quarters of the time the
 * piece was for somebody the player had not recruited, and being told to go and
 * sell your reward is a strange thing for a contract to say.
 *
 * The fix is to decide at claim time. A quest states a **shape** — a slot and a
 * rarity — and this picks the piece, for the hero it actually suits.
 *
 * ## The affinity is derived, never authored
 *
 * "What does a Bulwark want" is already written down, in the only place that
 * cannot drift from it: the **stat bonuses its own tree grants**. Summing
 * `statBonus` across a path's nodes gives Bulwark
 * `{maxHp: 60, defense: 8, shieldPower: 8}` and Berserker
 * `{critDamage: 35, armourPen: 20, critChance: 18, attack: 6, defense: −4}`, and
 * those are exactly the two shopping lists a player would write. A hand-kept
 * table beside them would be a second statement of the same fact, wrong the
 * first time a node is retuned — the argument `questHints` makes about hunting
 * ground, one system over.
 *
 * **Negative entries are kept and count against a piece.** The Berserker's tree
 * takes defence away; an item handing it back is working against the build, and
 * scoring it as merely neutral would let a defensive cuirass win on its other
 * stats.
 *
 * ## Legality is asked of `canEquip`, not re-derived
 *
 * Every candidate is built into a real `Item` and put through the same function
 * the equipment screen uses. That matters most for weapons, where the mastery
 * *weapon lock* lives — a Skirmisher may not hold a bow, and this is the one
 * rule that would have been easiest to forget and hardest to notice, because
 * the reward would simply arrive unequippable.
 *
 * Deliberately deterministic: no rng anywhere. The same party claiming the same
 * quest gets the same piece, so a reward is a thing a player can be told about
 * rather than a roll they might reload for. The *affixes* are rolled when it is
 * minted, which is the acquisition step and belongs to the caller.
 */

export interface GearPick {
  templateId: string;
  /** Who it was chosen for. The caller names them when it reports the reward. */
  heroId: string;
}

/**
 * How many of a path's stats count as "what it is for".
 *
 * Three. One is a caricature — every Champion path would be judged on health
 * alone — and the whole list is no preference at all, because a tree touches
 * most stats a little on the way to the two it is about.
 */
const PRIORITY_STATS = 3;

/**
 * A path's stat priorities, strongest first, as summed tree bonuses.
 *
 * Ranked on the **raw** sums rather than on anything normalised across stats,
 * and that is a decision rather than an oversight. The magnitudes are not
 * comparable in the abstract — `critDamage: 65` and `attack: 4` are different
 * units — but they are comparable *as authored*, because a tree spends its
 * budget in the units each stat is priced in. A path that wanted attack would
 * have put attack on more nodes. Normalising would replace a number somebody
 * chose with one derived from how the other eleven paths happen to be shaped.
 */
/** The sheet a percentage health node is read against, for priorities only. */
const PRIORITY_REFERENCE_HP = 250;
/** The same for a percentage Magic node: 2% a former flat point, so the ranking keeps its weight. */
const PRIORITY_REFERENCE_MAGIC = 50;

export function pathPriorities(path: MasteryId): { stat: string; weight: number }[] {
  const spec = MASTERY_PATHS.find((p) => p.id === path);
  if (!spec) return [];

  const summed: Record<string, number> = {};
  for (const node of spec.nodes) {
    for (const [stat, value] of Object.entries(node.statBonus ?? {})) {
      if (typeof value === 'number') summed[stat] = (summed[stat] ?? 0) + value;
    }
    // A percentage of health is still a health node (Deep Plates): counted at
    // what it grants on a geared tank, where the flat 30 it replaced sat
    const hpShare = node.modifier?.maxHpPercentBonus;
    if (hpShare) summed.maxHp = (summed.maxHp ?? 0) + hpShare * PRIORITY_REFERENCE_HP;
    // Likewise a percentage of Magic, which replaced the flat points 2026-10-23 at 2% a point
    const magicShare = node.modifier?.magicPercentBonus;
    if (magicShare) summed.magic = (summed.magic ?? 0) + magicShare * PRIORITY_REFERENCE_MAGIC;
  }

  return Object.entries(summed)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, PRIORITY_STATS)
    // Rank rather than magnitude: the top stat is worth three, the third one
    // is worth one. The gap between 65 and 15 says which matters more, not by
    // how much — the tree's budget is not a weighting anybody designed.
    .map(([stat], i) => ({ stat, weight: PRIORITY_STATS - i }))
    .concat(
      Object.entries(summed)
        .filter(([, value]) => value < 0)
        // A stat the tree actively spends *away* is one the build does not want
        // back. Weighted at one, so it breaks ties against a piece carrying it
        // without ever outvoting the three it is looking for.
        .map(([stat]) => ({ stat, weight: -1 })),
    );
}

/** What share of an item's own budget it spends on each stat. */
function shares(modifiers: ItemModifiers): Record<string, number> {
  const entries = Object.entries(modifiers) as [string, number | undefined][];
  const total = entries.reduce((sum, [, v]) => sum + Math.abs(v ?? 0), 0);
  if (total === 0) return {};
  return Object.fromEntries(entries.map(([k, v]) => [k, (v ?? 0) / total]));
}

/**
 * How well a piece suits a set of priorities.
 *
 * Scored on **shares of the item's own budget** rather than on raw modifiers, so
 * two candidates for one slot at one rarity are compared on what they chose to
 * spend their identical budget on. Raw values would just rank the pieces by how
 * many stats they happen to spread across.
 */
function fit(modifiers: ItemModifiers, priorities: { stat: string; weight: number }[]): number {
  const share = shares(modifiers);
  return priorities.reduce((sum, { stat, weight }) => sum + weight * (share[stat] ?? 0), 0);
}

/**
 * How well a piece suits a named path. The scoring, as a public question.
 *
 * Exported for the suite, and the suite is asking something worth asking: that
 * the piece chosen for a path suits that path at least as well as the piece
 * chosen for any other. That is the property the whole function exists to have,
 * and it is not observable from the outside without the scorer.
 */
export function gearFitFor(modifiers: ItemModifiers, path: MasteryId | null): number {
  return path ? fit(modifiers, pathPriorities(path)) : 0;
}

/**
 * Every template that is a legal answer to the shape asked for.
 *
 * Set pieces are excluded by construction rather than by rarity: `masteryLock`
 * marks the twelve legendary sets, and those have exactly two routes — the forge
 * and the dungeon chest. A third that costs only a conversation would flatten
 * both, which is the rule `itemGen` already states about the shop.
 *
 * A world's own motifs answer only a quest handed in there (`worldGear.ts`), so
 * a Jadeveil contract may pay Spiritsealed and the Empire's never does.
 */
function candidates(spec: GearReward, world: GearWorld | 'empire' | undefined) {
  return itemTemplates.filter(
    (t) =>
      t.slot === spec.slot &&
      t.rarity === spec.rarity &&
      !(t.masteryLock && t.masteryLock.length > 0) &&
      inWorld(t, world),
  );
}

/** Whether this hero could actually put that item on, in any slot it fits. */
function wearable(hero: Hero, item: Item, equipped: EquippedItems): boolean {
  return slotsFor(item.slot).some((slot) => canEquip(hero, item, slot, equipped).ok);
}

/**
 * The piece this quest should hand over, or `null` when nobody can use one.
 *
 * `null` is a real answer and the caller skips the reward, exactly as it already
 * does for a template id it cannot resolve. Inventing a common item nobody asked
 * for would be worse than paying nothing: the log would name a reward, the
 * player would go and look at it, and it would be a Plain Jerkin.
 */
export function resolveGearReward(
  spec: GearReward,
  heroes: Hero[],
  /** What each hero is currently wearing — `canEquip` needs it for two-handers. */
  equippedOf: (hero: Hero) => EquippedItems,
  /** Where the quest is handed in; omitted is the Empire. */
  world?: GearWorld | 'empire',
): GearPick | null {
  const pool = candidates(spec, world);
  if (pool.length === 0 || heroes.length === 0) return null;

  let best: { pick: GearPick; score: number; hasPath: boolean } | null = null;

  for (const hero of heroes) {
    const equipped = equippedOf(hero);
    // A hero who has not chosen yet has no priorities to read, and is the wrong
    // recipient anyway while somebody else in the party has committed to a
    // discipline this could serve. They stay eligible so a pre-level-5 party is
    // not paid nothing — see the ordering in the comparison below.
    const priorities = hero.masteryPath ? pathPriorities(hero.masteryPath) : [];

    for (const template of pool) {
      const item = itemFromTemplate(template);
      if (!wearable(hero, item, equipped)) continue;

      const score = fit(template.modifiers, priorities);
      const hasPath = hero.masteryPath !== null;

      // A hero with a path always beats one without, whatever the scores say:
      // the whole point is that the reward answers a *discipline*, and an
      // unchosen hero's score is zero because there is nothing to answer.
      const better =
        !best
        || (hasPath && !best.hasPath)
        || (hasPath === best.hasPath && score > best.score);

      if (better) best = { pick: { templateId: template.id, heroId: hero.id }, score, hasPath };
    }
  }

  return best?.pick ?? null;
}
