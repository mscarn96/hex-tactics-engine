import {
  Hero,
  HeroSkill,
  HeroStats,
  Item,
  MasteryId,
  MasteryModifier,
  MasteryNode,
  MasteryPath,
  PassiveId,
  PassiveRank,
  SkillEffect,
  SkillId,
  SkillTargetType,
  AfflictionType,
  AuraType,
  WildFormId,
  LEVEL_SCALE,
  NODE_MAX_LEVEL,
  ADVANCED_TIER,
} from '@/models/types';
import { MASTERY_PATHS, findMasteryPath } from '@/data/skills/masteryData';
import { MASTERY_GROWTH } from '@/data/skills/masteryGrowth';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { ALL_SKILLS } from '@/data/skills/skillData';
import { BALANCE } from '@/data/balanceConstants';
import { setBonusEffects } from '@/systems/progression/setBonuses';
import { isScaledMagnitude, skillEffects } from '@/systems/combat/statusEffects';
import { useInventoryStore } from '@/stores/inventoryStore';
import { highestLevelCap } from '@/data/levelCap';

/**
 * Turning a hero's chosen path and unlocked nodes into skills, stats, passives
 * and modifiers.
 *
 * All pure and all derived: nothing here is stored. `hero.masteryNodes` is a
 * list of ids and everything else is computed from it, so a tuning change to a
 * node takes effect on an existing save rather than needing a migration.
 */

/**
 * Highest `unlockLevel` a template skill is still handed out at.
 *
 * From level 5 onward every new skill comes from the tree, so this is one below
 * the unlock level. Templates keep their low-level skills so levels 1–4 are not
 * a single-button experience, and the four old level-5 "ultimates" have moved
 * into trees rather than being retired.
 */
const BASELINE_SKILL_CAP = BALANCE.MASTERY_UNLOCK_LEVEL - 1;

const SKILL_BY_ID = new Map<SkillId, HeroSkill>(
  [...ALL_SKILLS, ...MASTERY_SKILLS].map((s) => [s.id, s])
);

export function findSkill(id: SkillId): HeroSkill | undefined {
  return SKILL_BY_ID.get(id);
}

/**
 * Whether this node belongs to one of the path's two side trees.
 *
 * A side tree hangs off the capstones rather than off a column, so it is
 * outside every pyramid rule — the 5/4/3 widths, the derived prerequisites, the
 * column runs. Its `tier` says only which **row** it draws on, which is why
 * every structural sweep has to ask this rather than reading `tier` alone.
 */
export const isSideNode = (node: MasteryNode): boolean => !!node.sideTree;

/**
 * Whether this node is one of the path's advanced nodes: tier 4, open from its
 * row's level behind a capstone, and outside every pyramid rule the way a side
 * tree is.
 */
export const isAdvancedNode = (node: MasteryNode): boolean => node.tier === ADVANCED_TIER;

/** The pyramid: everything except the two side trees and the advanced nodes. */
export const mainTreeNodes = (path: MasteryPath): MasteryNode[] =>
  path.nodes.filter((n) => !isSideNode(n) && !isAdvancedNode(n));

/** The path's advanced nodes, left to right. */
export const advancedNodes = (path: MasteryPath): MasteryNode[] =>
  path.nodes.filter(isAdvancedNode).sort((a, b) => a.column - b.column);

/**
 * The hero level a node opens at. Only the advanced nodes ask for one, by the row
 * they name. The hero's level is all it reads: a world opens no row.
 */
export function nodeMinLevel(node: MasteryNode): number {
  return isAdvancedNode(node) ? BALANCE.MASTERY_ROW_LEVELS[(node.masteryRow ?? 1) - 1] : 0;
}

/** How many levels this node holds at all. */
export function maxLevelOf(node: MasteryNode): number {
  return node.maxLevel ?? NODE_MAX_LEVEL;
}

/**
 * What a node at this level is worth, as a factor on its authored numbers.
 *
 * The authored number is level 2, so this is 0.75 / 1 / 1.25. A node that holds
 * only one level is worth exactly what it says — a binary immunity has no
 * fraction of itself to be, and scaling a `skillRangeBonus: 1` by 0.75 would
 * floor to nothing and read as a node that did not work.
 */
export function levelScale(node: MasteryNode, level: number): number {
  if (level <= 0) return 0;
  if (maxLevelOf(node) === 1) return 1;
  return LEVEL_SCALE[Math.min(level, LEVEL_SCALE.length) - 1];
}

/** Levels of this node the hero has bought. 0 when they own none. */
export function nodeLevel(hero: Pick<Hero, 'masteryNodes'>, nodeId: string): number {
  return hero.masteryNodes[nodeId] ?? 0;
}

export function ownsNode(hero: Pick<Hero, 'masteryNodes'>, nodeId: string): boolean {
  return nodeLevel(hero, nodeId) > 0;
}

/** The ids a hero owns at least one level of — the set the prerequisite rules read. */
export function ownedNodeIds(hero: Pick<Hero, 'masteryNodes'>): Set<string> {
  return new Set(Object.keys(hero.masteryNodes).filter((id) => hero.masteryNodes[id] > 0));
}

/**
 * The nodes a hero has actually bought, with the level they hold, ignoring ids
 * that no longer exist.
 *
 * Returns the level alongside the node because every consumer past this point
 * needs it — a stat bonus, a modifier and a granted skill are all scaled by it,
 * and looking it back up per consumer is three chances to forget.
 */
export function unlockedNodes(
  hero: Pick<Hero, 'masteryPath' | 'masteryNodes'>,
): { node: MasteryNode; level: number }[] {
  const path = hero.masteryPath ? findMasteryPath(hero.masteryPath) : undefined;
  if (!path) return [];
  return path.nodes
    .map((node) => ({ node, level: Math.min(nodeLevel(hero, node.id), maxLevelOf(node)) }))
    .filter((n) => n.level > 0);
}

/** Points sunk into the tree. Every level is its own point. */
export function pointsSpent(hero: Pick<Hero, 'masteryPath' | 'masteryNodes'>): number {
  return unlockedNodes(hero).reduce((sum, n) => sum + n.node.cost * n.level, 0);
}

/**
 * Who the barracks can unlearn: everyone with a path and a point spent in it,
 * with how many.
 *
 * Asked of the points rather than of `masteryNodes`, which is a record of node
 * to rank. The barracks once filtered on its `.length` — which a string index
 * signature types as a number and the runtime answers `undefined` — so the list
 * was always empty and nobody could ever unlearn anything.
 */
export function unlearnable<H extends Pick<Hero, 'masteryPath' | 'masteryNodes'>>(
  heroes: readonly H[],
): { hero: H; spent: number }[] {
  return heroes
    .filter((hero) => hero.masteryPath !== null)
    .map((hero) => ({ hero, spent: pointsSpent(hero) }))
    .filter(({ spent }) => spent > 0);
}

// ─── Unlocking ────────────────────────────────────────────────────────────────

export type UnlockRefusal =
  | 'no-path'
  | 'unknown-node'
  | 'at-max-level'
  | 'level-too-low'
  | 'missing-prerequisite'
  | 'excluded'
  | 'not-enough-points';

export interface UnlockCheck {
  ok: boolean;
  reason?: UnlockRefusal;
  /** Points still needed, when the refusal is about affordability. */
  shortfall?: number;
  /** The hero level the node opens at, when the refusal is about level. */
  level?: number;
  /** Nodes that must be bought first, when the refusal is about prerequisites. */
  missing?: MasteryNode[];
  /** The already-owned node that rules this one out, when the refusal is exclusivity. */
  blockedBy?: MasteryNode;
}

/**
 * The nodes feeding into this one.
 *
 * Derived from position rather than authored: a node at `column` c in tier t is
 * fed by the tier t-1 nodes at columns c and c+1. Eleven paths therefore need
 * no edge table at all — the pyramid *is* the edge table, and a node cannot be
 * given a prerequisite that contradicts its own place in the tree.
 *
 * A node that names `requires` opts out. Wildshape is the one path that has to:
 * it is three exclusive branches rather than a converging grid, and "fed by Bear
 * Form and nothing else" is not a shape any arrangement of columns can describe.
 */
export function prerequisitesFor(path: MasteryPath, node: MasteryNode): MasteryNode[] {
  if (node.requires) {
    return node.requires
      .map((id) => path.nodes.find((n) => n.id === id))
      .filter((n): n is MasteryNode => !!n);
  }
  if (node.tier === 1) return [];
  return path.nodes.filter(
    (n) => n.tier === node.tier - 1 && (n.column === node.column || n.column === node.column + 1)
  );
}

/** How many of a node's prerequisites are enough. All of them, unless it says otherwise. */
export function requiredPrerequisiteCount(path: MasteryPath, node: MasteryNode): number {
  const all = prerequisitesFor(path, node).length;
  return Math.min(all, node.requiresCount ?? all);
}

/**
 * Which of a node's prerequisites this hero has not bought yet.
 *
 * Empty once the hero owns *enough* of them — for an "any 2 of these" node the
 * other ten are not missing, they are simply not the two that were taken.
 */
export function missingPrerequisites(
  path: MasteryPath,
  node: MasteryNode,
  owned: ReadonlySet<string>
): MasteryNode[] {
  const parents = prerequisitesFor(path, node);
  const held = parents.filter((n) => owned.has(n.id)).length;
  if (held >= requiredPrerequisiteCount(path, node)) return [];
  return parents.filter((n) => !owned.has(n.id));
}

/**
 * The owned node, if any, that rules this one out.
 *
 * Exclusivity is a shared tag rather than a list of ids on each side, so a group
 * cannot be half-declared — which is exactly the bug that would let a Druid end
 * up as both a bear and a hawk.
 */
export function exclusionFor(
  path: MasteryPath,
  node: MasteryNode,
  owned: ReadonlySet<string>
): MasteryNode | undefined {
  if (!node.exclusiveGroup) return undefined;
  return path.nodes.find(
    (n) => n.id !== node.id && n.exclusiveGroup === node.exclusiveGroup && owned.has(n.id)
  );
}

/**
 * Whether a hero may buy a node right now.
 *
 * Returns a reason rather than a bare boolean so the tree screen can say *why* a
 * node is dim — "4 more points in this path" reads very differently from "you
 * cannot afford this", and they are the two failures a player hits constantly.
 */
export function canUnlockNode(hero: Hero, nodeId: string): UnlockCheck {
  const path = hero.masteryPath ? findMasteryPath(hero.masteryPath) : undefined;
  if (!path) return { ok: false, reason: 'no-path' };

  const node = path.nodes.find((n) => n.id === nodeId);
  if (!node) return { ok: false, reason: 'unknown-node' };

  // Buying a node the hero already holds is buying its *next level*, so the
  // only ownership refusal left is having all of them.
  const held = nodeLevel(hero, nodeId);
  if (held >= maxLevelOf(node)) return { ok: false, reason: 'at-max-level' };

  // Before the prerequisites: below its row's level an advanced node is closed whatever the
  // hero owns, and "needs a capstone" would promise something buying one cannot
  // deliver.
  const minLevel = nodeMinLevel(node);
  if (hero.level < minLevel) return { ok: false, reason: 'level-too-low', level: minLevel };

  // Both parents, not either. The strict reading is the tradeoff: a path is a
  // route committed to, not a set of nodes shopped from.
  const owned = ownedNodeIds(hero);
  const missing = missingPrerequisites(path, node, owned);
  if (missing.length > 0) return { ok: false, reason: 'missing-prerequisite', missing };

  // After the prerequisite check, because "you are already a bear" is the more
  // useful thing to say than "you need Hawk Form first" to someone who took Bear
  const blockedBy = exclusionFor(path, node, owned);
  if (blockedBy) return { ok: false, reason: 'excluded', blockedBy };

  if (hero.masteryPoints < node.cost) {
    return { ok: false, reason: 'not-enough-points', shortfall: node.cost - hero.masteryPoints };
  }

  return { ok: true };
}

/**
 * Points a hero should have earned in total by this level.
 *
 * `pathId` adds the path's own grant, which stands in for a signature skill —
 * Wildshape hands over a point at level 5 so the player spends it on a shape
 * rather than being handed one. It is a flat term, so the level-to-level delta
 * the store actually uses is unaffected by it.
 */
export function pointsEarnedByLevel(level: number, pathId?: MasteryId | null): number {
  // Bounded by the highest cap rather than the one in force: a hero's level never
  // passes the cap that let it climb, and a point earned at 23 stays earned (and
  // spent) on a device that cannot read the entitlement today.
  const earned = Math.max(0, Math.min(level, highestLevelCap()) - BALANCE.MASTERY_UNLOCK_LEVEL);
  const bonus = pathId ? (findMasteryPath(pathId)?.bonusPoints ?? 0) : 0;
  return earned + bonus;
}

export function canChooseMastery(hero: Pick<Hero, 'level' | 'masteryPath'>): boolean {
  return hero.masteryPath === null && hero.level >= BALANCE.MASTERY_UNLOCK_LEVEL;
}

/**
 * A decision the tree is waiting on, or `null`.
 *
 * `'path'` is the louder of the two and wins when both hold: an unchosen path
 * is permanent, blocks every node behind it, and is the one thing in the game a
 * hero can be *stuck* on — a hero levelling past 5 with no path is earning
 * points into a tree they have not opened.
 *
 * This lives here rather than in a component because two screens ask it. The
 * party portrait is where a player finds out at all, and the hero sheet is
 * where they act on it; those answering separately is the drift this codebase
 * keeps writing down, and the sheet's own `hero.masteryPoints > 0` had already
 * missed the unchosen-path half entirely.
 *
 * Unspent means unspent in the player's own terms — `masteryPoints` is what the
 * store hands out per level and `unlockNode` subtracts `node.cost` from, so a
 * node's *level* being a separate purchase changes what a point buys and not
 * what one is. There is deliberately no "can this be spent on anything"
 * check: `MASTERY_POINTS_AT_CAP` is 15 against a tree that costs far more than
 * that to fill, so a held point always has somewhere to go, and a predicate
 * that walked the tree would need the whole `Hero` and the bag behind it.
 */
export type MasteryPrompt =
  | { kind: 'path' }
  | { kind: 'points'; count: number };

export function masteryPrompt(
  hero: Pick<Hero, 'level' | 'masteryPath' | 'masteryPoints'>,
): MasteryPrompt | null {
  if (hero.masteryPath === null) {
    // Points earned before the path exists are not a decision — there is
    // nothing to spend them on until one is picked, and saying "2 points" to a
    // level-4 hero is a prompt with no screen behind it.
    return canChooseMastery(hero) ? { kind: 'path' } : null;
  }
  return hero.masteryPoints > 0 ? { kind: 'points', count: hero.masteryPoints } : null;
}

/** Paths this hero may pick between — its own class only. */
export function availableMasteries(hero: Pick<Hero, 'heroClass'>): MasteryId[] {
  return MASTERY_PATHS.filter((p) => p.heroClass === hero.heroClass).map((p) => p.id);
}

// ─── Derivation ───────────────────────────────────────────────────────────────

export function masteryPassives(hero: Pick<Hero, 'masteryPath' | 'masteryNodes'>): PassiveId[] {
  return unlockedNodes(hero)
    .map((n) => n.node.grantsPassive)
    .filter((id): id is PassiveId => !!id);
}

/**
 * What rung each granted passive is standing on.
 *
 * Separate from `masteryPassives` rather than folded into it because the two
 * have different consumers: a unit's passive *list* is what `hasPassive` reads,
 * and the rank is only wanted where a magnitude is actually resolved. A passive
 * granted by two nodes takes the stronger — `momentum` is on five nodes across
 * four paths and `lifebloom` on two, so this is a real case rather than a
 * hypothetical, and the stronger is the only answer that is not arbitrary.
 *
 * **Both fields, because two passives cannot use the scale.** `scale` is the
 * 0.75 / 1 / 1.25 factor almost everything wants, and it already answers 1 for a
 * `maxLevel: 1` node, so an immunity handed a fraction of itself is impossible
 * by construction. But Wrath's threshold ladder runs 16 / 12 / 8 — inverse and
 * irregular — and Vengeance's trigger chance runs 50 / 75 / 100, and neither is
 * any multiple of an authored middle value. Those index `level` directly.
 * Deriving the rung back out of the scale would work first time and break the
 * first time a node's `maxLevel` changed.
 */
export function masteryPassiveRanks(
  hero: Pick<Hero, 'masteryPath' | 'masteryNodes'>,
): Partial<Record<PassiveId, PassiveRank>> {
  const out: Partial<Record<PassiveId, PassiveRank>> = {};
  for (const { node, level } of unlockedNodes(hero)) {
    const id = node.grantsPassive;
    if (!id) continue;
    const rank = { level, scale: levelScale(node, level) };
    if ((out[id]?.scale ?? 0) < rank.scale) out[id] = rank;
  }
  return out;
}

/**
 * What rung each Wildshape shape this hero owns is standing on.
 *
 * `masteryPassiveRanks`' sibling, and derived the same way rather than authored:
 * a shape node is one whose granted skill carries `shiftsTo`, so no table has to
 * name which nodes are the animals and a fourth shape would be picked up for
 * free. It is a shape's *level* that the form profile ramps — see
 * `wildshape.wornForm` — and `setWildForm` has only a `CombatUnit` to read, so
 * this is resolved once at `createPlayerUnits` and carried on `formRanks`.
 *
 * The stronger rung wins if two nodes ever granted the same shift, which the
 * tier-1 exclusive group makes impossible today; `masteryPassiveRanks` makes the
 * same choice for the same reason, and it is the only answer that is not
 * arbitrary.
 */
export function masteryFormRanks(
  hero: Pick<Hero, 'masteryPath' | 'masteryNodes'>,
): Partial<Record<WildFormId, number>> {
  const out: Partial<Record<WildFormId, number>> = {};
  for (const { node, level } of unlockedNodes(hero)) {
    if (!node.grantsSkill) continue;
    const form = findSkill(node.grantsSkill)?.shiftsTo;
    if (!form) continue;
    if ((out[form] ?? 0) < level) out[form] = level;
  }
  return out;
}

/**
 * What one node's `statBonus` is worth at a given level.
 *
 * Split out of `masteryStatBonus` so the tree screen can render the number a
 * node is actually about to grant. Two copies of this arithmetic is how a panel
 * ends up advertising +30 HP for a node that grants 23 — which is what it did,
 * by reading `node.statBonus` raw and never hearing about levels at all.
 *
 * Rounded per node rather than at the end: a stat is a whole number, and summing
 * fractions first would let two nodes at level 1 quietly add up to a point
 * neither of them granted.
 */
export function nodeStatBonusAt(node: MasteryNode, level: number): Partial<HeroStats> {
  const out: Partial<HeroStats> = {};
  if (!node.statBonus || level <= 0) return out;
  const scale = levelScale(node, level);
  for (const [key, value] of Object.entries(node.statBonus) as [keyof HeroStats, number][]) {
    out[key] = Math.round(value * scale);
  }
  return out;
}

/**
 * What a hero's *path* has added to their body by this level.
 *
 * The other half of levelling: `calculateStatsForLevel` gives a hero the growth
 * their **class** earns, and this is the tilt their **path** earns on top. Until
 * it existed a Bulwark, a Templar and a Berserker were the same body at every
 * level, and so were the three Arcanists and the three Hunters.
 *
 * **Counted from `MASTERY_UNLOCK_LEVEL`, which is the first level a path can be
 * chosen at.** A hero who picks at 5, as the prompt pushes them to, therefore
 * never sees their sheet rewrite itself — the term is zero at the moment they
 * choose and grows from there. One who *delays* the choice collects the skipped
 * levels in one go; the alternative was persisting the level the path was taken
 * at, which is a `SAVE_VERSION` bump and a discarded save for a case the game
 * already nags players out of.
 *
 * It lives here beside `masteryStatBonus` rather than inside
 * `calculateStatsForLevel` for the reason `statCalc` reads equipment and the
 * upgrade level rather than being handed them: that function takes a *template*
 * and has no hero, so threading a path through it would be a new argument at
 * every call site and an optional one would let a caller silently drop a hero's
 * growth. `getEffectiveStats` already folds mastery contributions in one place.
 */
export function masteryPathGrowth(
  hero: Pick<Hero, 'level' | 'masteryPath'>,
): Partial<HeroStats> {
  if (!hero.masteryPath) return {};
  const per = MASTERY_GROWTH[hero.masteryPath];
  if (!per) return {};

  const levels = Math.max(
    0,
    Math.min(hero.level, highestLevelCap()) - BALANCE.MASTERY_UNLOCK_LEVEL,
  );
  if (levels === 0) return {};

  const out: Partial<HeroStats> = {};
  for (const [key, value] of Object.entries(per) as [keyof HeroStats, number][]) {
    out[key] = value * levels;
  }
  return out;
}

export function masteryStatBonus(hero: Pick<Hero, 'masteryPath' | 'masteryNodes'>): Partial<HeroStats> {
  const total: Partial<HeroStats> = {};
  for (const { node, level } of unlockedNodes(hero)) {
    for (const [key, value] of Object.entries(nodeStatBonusAt(node, level)) as [
      keyof HeroStats,
      number,
    ][]) {
      total[key] = (total[key] ?? 0) + value;
    }
  }
  return total;
}

/**
 * How each modifier key combines when two nodes grant it.
 *
 * Additive for bonuses and multiplicative for multipliers, which is the only
 * combination that behaves sanely if a future tree ever grants two of the same
 * kind. A `Record` over **every** key, so adding a field to `MasteryModifier`
 * without deciding its merge is a type error rather than a dropped modifier —
 * `burnMagnitudeBonus` was authored, displayed and never merged, so the
 * Pyromancer's node did nothing for a whole version.
 */
/**
 * The scalar half of `MasteryModifier` — every key whose value is a number.
 *
 * Derived rather than listed, so `MODIFIER_MERGE` keeps the property it was
 * written for: adding a *numeric* field without deciding its merge is still a
 * type error. `skillPowerBonus` is the one non-scalar entry and is merged
 * explicitly below, because "add or multiply" is not a question a map of skills
 * to fractions has one answer to.
 */
type ScalarModifierKey = {
  [K in keyof MasteryModifier]-?: MasteryModifier[K] extends number | undefined ? K : never;
}[keyof MasteryModifier];

const MODIFIER_MERGE: Record<ScalarModifierKey, 'add' | 'multiply'> = {
  tauntDurationBonus: 'add',
  lifestealBonus: 'add',
  thornsMultiplier: 'multiply',
  skillRangeBonus: 'add',
  aoeRadiusBonus: 'add',
  burnMagnitudeBonus: 'add',
  shieldPowerBonus: 'add',
  aoeDamageBonus: 'add',
  singleTargetDamageBonus: 'add',
  incomingSupportBonus: 'add',
  maxHpPercentBonus: 'add',
  magicPercentBonus: 'add',
  lowHpDamageBonus: 'add',
  highHpDamageBonus: 'add',
  markedDamageBonus: 'add',
  regenMagnitudeBonus: 'add',
  healRestoresMana: 'add',
  healGrantsDefense: 'add',
  poisonBurstBonus: 'add',
  bleedMagnitudeBonus: 'add',
  bleedDurationBonus: 'add',
  bleedingDamageBonus: 'add',
  // Advanced (level 21–25): Arcanist
  burnCapBonus: 'add',
  detonationBonus: 'add',
  freezeDurationBonus: 'add',
  chilledDamageBonus: 'add',
  shockedDamageBonus: 'add',
  shockChainBonus: 'add',
  // Level 26: Arcanist
  burnOverflowShare: 'add',
  shockSecondHop: 'add',
  // Advanced (level 21–25): Druid
  overhealBarrier: 'add',
  rootDurationBonus: 'add',
  pinnedDamageBonus: 'add',
  formVigorBonus: 'add',
  formSkillDamageBonus: 'add',
  // Advanced (level 26): Champion
  tauntedExposure: 'add',
  allyHealSpill: 'add',
  thirstMissingBonus: 'add',
  // Advanced (level 26): Druid
  hotBloomShare: 'add',
  shapeSettledBonus: 'add',
  // Advanced (level 26): Hunter
  bladesCapBonus: 'add',
  // Worn set pieces
  chainJumpBonus: 'add',
  carapaceChargeBonus: 'add',
};

/**
 * Modifiers counted in whole units of something on the board — hexes of range,
 * hexes of radius, turns of Taunt — which therefore cannot be scaled by a
 * node's level.
 */
/**
 * Integer modifiers that still climb with rank, by whole points per rung around the
 * authored (middle) value — `healGrantsDefense` is 2 / 3 / 4 from a 3.
 */
const RANKED_INTEGER_MODIFIERS: Partial<Record<ScalarModifierKey, number>> = {
  healGrantsDefense: 1,
  bladesCapBonus: 1,
};

export const INTEGER_MODIFIERS = new Set<ScalarModifierKey>([
  'skillRangeBonus',
  'aoeRadiusBonus',
  'tauntDurationBonus',
  'healGrantsDefense',
  'bleedDurationBonus',
  // Advanced (level 21–25): Arcanist
  'freezeDurationBonus',
  // Advanced (level 21–25): Druid
  'rootDurationBonus',
  // Advanced (level 26): Hunter
  'bladesCapBonus',
  // Worn set pieces
  'chainJumpBonus',
  'carapaceChargeBonus',
]);

/**
 * Every modifier this hero contributes, merged per `MODIFIER_MERGE`.
 *
 * Nodes are the whole answer for the scalars. `skillPowerBonus` is the one
 * entry that also comes off **gear** — a legendary set piece rolls a bonus to a
 * skill of its own path when it is acquired — and it is folded in here rather
 * than beside `createPlayerUnits` for the reason `statCalc` reads equipment and
 * the upgrade level rather than being handed them: this is the funnel every
 * consumer already goes through, so none of them has to learn the mechanic
 * exists.
 *
 * `equipment` is optional so the many callers holding a partial hero — the sim
 * harness, thirty test fixtures — keep working and simply contribute nothing,
 * which is the correct answer for a hero wearing nothing.
 */
/**
 * What one node's `modifier` is worth at a given level.
 *
 * The tree screen's half of `masteryModifiers`, for `nodeStatBonusAt`'s reason —
 * and the integer rule has to live here rather than at the merge, or a panel
 * would offer a player "+0.75 range" for a rung that grants a whole hex.
 */
export function nodeModifierAt(node: MasteryNode, level: number): MasteryModifier {
  const out: MasteryModifier = {};
  const m = node.modifier;
  if (!m || level <= 0) return out;
  const scale = levelScale(node, level);
  for (const key of Object.keys(MODIFIER_MERGE) as ScalarModifierKey[]) {
    const raw = m[key];
    if (!raw) continue;
    // Integer steps do not scale: `skillRangeBonus` is hexes, and 0.75 of a
    // hex is either nothing or the whole thing depending on where it rounds.
    // Those nodes are all `maxLevel: 1`, so `levelScale` already returns 1 —
    // this is the belt to that braces.
    out[key] = INTEGER_MODIFIERS.has(key)
      ? raw + (RANKED_INTEGER_MODIFIERS[key] ?? 0) * rankStep(node, level)
      : raw * scale;
  }
  return out;
}

export function masteryModifiers(
  hero: Pick<Hero, 'masteryPath' | 'masteryNodes'> & Partial<Pick<Hero, 'equipment'>>,
): MasteryModifier {
  const merged: MasteryModifier = {};
  for (const { node, level } of unlockedNodes(hero)) {
    const scaled = nodeModifierAt(node, level);
    for (const [key, mode] of Object.entries(MODIFIER_MERGE) as [
      ScalarModifierKey,
      'add' | 'multiply',
    ][]) {
      const value = scaled[key];
      if (!value) continue;
      // A node authors a multiplying key as its bonus (Spite Grows' 0.25 is +25%), and
      // the hero carries the product: read as a bare factor it cut Thorns to a quarter
      merged[key] = mode === 'multiply' ? (merged[key] ?? 1) * (1 + value) : (merged[key] ?? 0) + value;
    }
  }

  const gear = gearSkillPowerBonuses(hero);

  // Worn set pieces (`setBonuses.ts`): the modifiers a 3- or 5-piece bonus
  // grants, merged beside the nodes' by the same rule
  const set = wornSetEffects(hero);
  if (set) {
    for (const [key, mode] of Object.entries(MODIFIER_MERGE) as [ScalarModifierKey, 'add' | 'multiply'][]) {
      const value = set.modifier[key];
      if (!value) continue;
      merged[key] = mode === 'multiply' ? (merged[key] ?? 1) * (1 + value) : (merged[key] ?? 0) + value;
    }
    for (const [skill, percent] of Object.entries(set.modifier.skillPowerBonus ?? {}) as [SkillId, number][]) {
      gear[skill] = (gear[skill] ?? 0) + percent;
    }
  }
  if (Object.keys(gear).length > 0) merged.skillPowerBonus = gear;

  return merged;
}

/**
 * What the worn set pieces grant (`setBonuses.ts`), read out of the bag as
 * `gearSkillBonusSources` is — or undefined for a hero holding no equipment.
 */
function wornSetEffects(hero: Pick<Hero, 'masteryPath'> & Partial<Pick<Hero, 'equipment'>>) {
  if (!hero.equipment) return undefined;
  const bag = useInventoryStore.getState();
  const items = Object.values(hero.equipment)
    .map((id) => (id ? bag.getItem(id) : undefined))
    .filter((item): item is Item => item !== undefined);
  return items.length > 0 ? setBonusEffects(hero as Hero, items) : undefined;
}

/**
 * The set-piece skill bonuses this hero is actually wearing, summed per skill.
 *
 * Read out of the bag rather than passed in, exactly as `statCalc` reads
 * equipment. Two pieces naming the same skill add: a full set is seven rolls at
 * one path's skills, and a build that lands two on the same capstone has earned
 * the concentration.
 *
 * The path guard is belt and braces — `canEquip` already refuses a set piece to
 * the wrong path — but a bonus for a skill the hero cannot cast is silent, and
 * silent is the failure mode this whole feature is trying to avoid.
 */
function gearSkillPowerBonuses(
  hero: Pick<Hero, 'masteryPath'> & Partial<Pick<Hero, 'equipment'>>,
): Partial<Record<SkillId, number>> {
  const out: Partial<Record<SkillId, number>> = {};
  for (const { skillId, percent } of gearSkillBonusSources(hero)) {
    out[skillId] = (out[skillId] ?? 0) + percent;
  }
  return out;
}

/** One worn piece's bonus to one skill: the piece, so a screen can name where the bonus comes from. */
export interface GearSkillBonusSource {
  skillId: SkillId;
  percent: number;
  item: Item;
}

/**
 * The worn set pieces that bonus a skill, one entry per piece, in slot order —
 * the same pieces and the same path guard `gearSkillPowerBonuses` sums, so a
 * "+12% from …" line under a skill is exactly what the cast is raised by.
 * With `skillId`, only that skill's.
 */
export function gearSkillBonusSources(
  hero: Pick<Hero, 'masteryPath'> & Partial<Pick<Hero, 'equipment'>>,
  skillId?: SkillId,
): GearSkillBonusSource[] {
  const out: GearSkillBonusSource[] = [];
  if (!hero.masteryPath || !hero.equipment) return out;

  const bag = useInventoryStore.getState();
  for (const id of Object.values(hero.equipment)) {
    const item = id ? bag.getItem(id) : undefined;
    const bonus = item?.setBonus;
    if (!item || !bonus) continue;
    if (item.masteryLock && !item.masteryLock.includes(hero.masteryPath)) continue;
    if (skillId && bonus.skillId !== skillId) continue;
    out.push({ skillId: bonus.skillId, percent: bonus.percent, item });
  }
  return out;
}

/**
 * A skill with the hero's mastery modifiers baked in.
 *
 * Applied once when a combat unit is built rather than at every read, so the
 * HUD, the targeting preview and the damage resolution all see the same numbers
 * — a range bonus that the highlight knew about but the range check did not
 * would let a player click a hex the skill then refused.
 *
 * The range/radius split is deliberate. `skillRangeBonus` extends how far a
 * skill is *delivered*; `aoeRadiusBonus` extends how much it *covers*.
 *
 * There used to be a `Cone` exception here — a cone's extent *was* its `range`
 * and its `aoeRadius` was ignored, so one took the radius bonus onto its range
 * and skipped the range bonus entirely, to avoid double-dipping. `Arc` sizes
 * itself off `aoeRadius` like every other area skill, so the exception is gone
 * and both bonuses mean on an arc exactly what they mean everywhere else: a
 * range node lets a Stoneshaper aim Upheaval further, a radius node makes the
 * wedge deeper. The Cone case is the only one this ever had.
 */
export function applyMasteryModifiers(skill: HeroSkill, mods: MasteryModifier): HeroSkill {
  if (Object.keys(mods).length === 0) return skill;

  const next: HeroSkill = { ...skill };

  if (mods.skillRangeBonus && skill.range > 0) {
    next.range = skill.range + mods.skillRangeBonus;
    // A skill aimed at the hex it moves to has one reach, written twice. Only
    // `range` grew here, so Longshot lit Disengage's fourth ring green and the
    // move (still `selfMove.range` 3) refused every hex on it
    if (skill.selfMove?.kind === 'free' || skill.selfMove?.kind === 'blink') {
      next.selfMove = { ...skill.selfMove, range: skill.selfMove.range + mods.skillRangeBonus };
    }
  }

  if (mods.chainJumpBonus && skill.chainJumps) {
    next.chainJumps = skill.chainJumps + mods.chainJumpBonus;
  }

  if (mods.aoeRadiusBonus && skill.aoeRadius) {
    next.aoeRadius = skill.aoeRadius + mods.aoeRadiusBonus;
  }

  // Only skills that already deal damage can drain — a lifesteal bonus on a
  // buff would silently do nothing and read as a broken node
  if (mods.lifestealBonus && skill.damage) {
    next.lifesteal = (skill.lifesteal ?? 0) + mods.lifestealBonus;
  }

  /**
   * A set piece's roll, applied to *this* skill and nothing else.
   *
   * Both halves, because a skill's payload is whichever of them it has and a
   * bonus that only reached damage would do nothing for a Lifewarden's set. It
   * scales the **multiplier** rather than the finished number, unlike
   * `strikeScales`: this is a better version of the spell, so it should be
   * mitigated like the spell — a post-mitigation bonus would be worth wildly
   * more against armour than against paper, which is armour penetration's job
   * and not this one's.
   */
  const power = mods.skillPowerBonus?.[skill.id];
  if (power) {
    const scale = 1 + power / 100;
    // Rounded for the reason `round2` records: this number is rendered.
    if (next.damage) next.damage = round2(next.damage * scale);
    if (next.healing) next.healing = round2(next.healing * scale);
  }

  // Per entry: a skill that taunts *and* does something else should have the
  // taunt extended without the rest of its payload being touched.
  if (mods.tauntDurationBonus) {
    const applied = skillEffects(skill);
    if (applied.some((e) => e.type === AfflictionType.Taunt)) {
      next.appliesEffect = applied.map((e) =>
        e.type === AfflictionType.Taunt
          ? { ...e, duration: e.duration + mods.tauntDurationBonus! }
          : e,
      );
    }
  }

  return next;
}

/**
 * Every skill a hero can use: its template baseline plus everything the tree
 * has granted.
 *
 * The baseline stays at the template's low-level skills so levels 1–4 are not a
 * one-button experience, and the path takes over from level 5. Derived rather
 * than accumulated, so removing a node from a tree removes it from every
 * existing save instead of leaving an orphan the player keeps forever.
 */
export function deriveHeroSkills(
  hero: Pick<Hero, 'level' | 'masteryPath' | 'masteryNodes'>,
  baselineSkills: HeroSkill[]
): HeroSkill[] {
  const skills = baselineSkills.filter(
    (s) => s.unlockLevel <= Math.min(hero.level, BASELINE_SKILL_CAP)
  );
  const path = hero.masteryPath ? findMasteryPath(hero.masteryPath) : undefined;
  if (!path) return skills;

  // A signature is handed over whole — it is not bought, so it has no level.
  const granted: { id: SkillId; scale: number; step: number }[] = path.signatureSkill
    ? [{ id: path.signatureSkill, scale: 1, step: 0 }]
    : [];
  for (const { node, level } of unlockedNodes(hero)) {
    if (node.grantsSkill) {
      granted.push({ id: node.grantsSkill, scale: levelScale(node, level), step: rankStep(node, level) });
    }
  }

  const seen = new Set(skills.map((s) => s.id));
  for (const { id, scale, step } of granted) {
    if (seen.has(id)) continue;
    const skill = findSkill(id);
    if (!skill) continue;
    seen.add(id);
    skills.push(scaleSkill(skill, scale, step));
  }

  return skills;
}

/**
 * A granted skill at a node's level.
 *
 * The output scales and nothing else: damage, healing and the magnitude of what
 * it applies. Deliberately **not** range, radius, cooldown or mana — those are
 * how a skill is *used*, and a level-1 Meteor that also covered less ground and
 * cost the same would read as a different, worse spell rather than a weaker one.
 * The same argument keeps them off `LEVEL_SCALE`'s siblings in `statBonus`.
 *
 * A magnitude below 1 is a fraction of a stat and scales cleanly; a flat one is
 * rounded, because an 11.25-point barrier is not a number anything displays.
 */
/**
 * The skill a node grants, at the level it is held to — or `undefined` if it
 * grants none.
 *
 * The tree screen's entry point into `scaleSkill`, so the stat line under a node
 * is the skill the hero will actually cast. It read `findSkill(node.grantsSkill)`
 * raw, which is the level-2 version at every rank.
 */
export function nodeSkillAt(node: MasteryNode, level: number): HeroSkill | undefined {
  if (!node.grantsSkill) return undefined;
  const skill = findSkill(node.grantsSkill);
  if (!skill) return undefined;
  const held = Math.max(1, level);
  return scaleSkill(skill, levelScale(node, held), rankStep(node, held));
}

/**
 * A scaled multiplier, at the precision multipliers are authored to.
 *
 * `0.7 × 1.5` is `1.0499999999999998` in binary floating point, and a skill's
 * damage multiplier is *rendered* — `skillStatLine` and the mastery tree both
 * interpolate it straight into a sentence, so the Stoneshaper's Living Stone
 * read "1.0499999999999998× your Magic" on three separate lines of one panel.
 *
 * Rounded here, at the source, rather than only at the formatter: every
 * multiplier in `data/skills/` is authored to two decimals, so the difference
 * between 1.05 and 1.0499999999999998 is one no damage number in the game can
 * express — while a value that carries the noise can leak into any *new* place
 * that renders it. `skillDisplay.mult` is the second half of the same fix, and
 * belt-and-braces on purpose.
 *
 * Fractional effect magnitudes (a poison dose at 0.3× attack) get three places
 * for the same reason and one more: they are a third of the size, so two would
 * be a visible retune rather than a rounding.
 */
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * How many rungs a node is held above or below its middle one: -1, 0 or +1.
 * Zero for a single-rank node, which has no ladder to be on.
 */
export function rankStep(node: MasteryNode, level: number): number {
  return maxLevelOf(node) === 1 ? 0 : Math.min(1, Math.max(-1, level - 2));
}

function scaleSkill(skill: HeroSkill, scale: number, step = 0): HeroSkill {
  // A summon always carries its strength, even at the middle rung, so the tree
  // and the fight can state it at every rank
  if (scale === 1 && step === 0 && !skill.summons) return skill;
  const next: HeroSkill = { ...skill };
  if (skill.summons) next.summons = { ...skill.summons, statScale: scale };
  // A companion's Magic share moves by its own stated step, never by the scale
  if (next.summons?.echoMagic !== undefined) {
    next.summons.echoMagic = round2(next.summons.echoMagic + (skill.perRank?.echoMagic ?? 0) * step);
  }
  if (skill.places?.kind === 'rampart') next.places = { ...skill.places,
    hpFraction: round3(skill.places.hpFraction * scale),
    defense: Math.round((skill.places.defense ?? 0) * scale) };
  if (next.manaCost > 0 && step !== 0) {
    next.manaCost = Math.max(1, Math.round(next.manaCost * (1 - step * BALANCE.MASTERY_MANA.RANK_COST_REDUCTION)));
  }
  if (next.occupiedVariant?.manaCost) {
    next.occupiedVariant = { ...next.occupiedVariant, manaCost: Math.max(1,
      Math.round(next.occupiedVariant.manaCost * (1 - step * BALANCE.MASTERY_MANA.RANK_COST_REDUCTION))) };
  }
  // A rung's reach (playtest 2026-10-28): Carapace Bastion's ground and Vengeful Shell's cover
  if (step !== 0 && skill.perRank?.radius && next.aoeRadius !== undefined) {
    next.aoeRadius = Math.max(0, next.aoeRadius + skill.perRank.radius * step);
  }
  const trigger = next.reaction?.trigger;
  if (step !== 0 && skill.perRank?.reach && next.reaction && trigger?.kind === 'interceptAlly') {
    next.reaction = { ...next.reaction, trigger: { ...trigger, reach: Math.max(1, trigger.reach + skill.perRank.reach * step) } };
  }
  if (step !== 0 && skill.perRank?.cooldown && next.cooldown !== undefined) {
    next.cooldown = Math.max(0, next.cooldown + skill.perRank.cooldown * step);
  }
  // A barrage's rung is its projectile count, so its damage per projectile stays put
  if (skill.barrage) {
    next.barrage = skill.barrage + (skill.perRank?.barrage ?? 0) * step;
  } else if (next.damage) next.damage = round2(next.damage * scale);
  if (next.healing) next.healing = round2(next.healing * scale);
  // Firefly Motes: the rung is the count, and the heal each mote carries scales
  if (skill.motes) {
    next.motes = {
      count: Math.max(1, skill.motes.count + (skill.perRank?.motes ?? 0) * step),
      heal: round2(skill.motes.heal * scale),
    };
  }
  // Aimed Shot's release and Covering Fire's reaction shot rank with the node
  if (skill.perRank?.nested) {
    const release = skill.charge?.release;
    if (skill.charge && release?.damage) {
      next.charge = { ...skill.charge, release: { ...release, damage: round2(release.damage * scale) } };
    }
    // Threefold Scythe's two later stages rank with its launch
    if (skill.stages) next.stages = skill.stages.map((st) => (st.damage ? { ...st, damage: round2(st.damage * scale) } : st));
    const response = skill.reaction?.response;
    if (skill.reaction && response?.damage) {
      next.reaction = { ...(next.reaction ?? skill.reaction), response: { ...response, damage: round2(response.damage * scale) } };
    }
  }
  // Grip and Throw's heavier blow ranks with the throw it replaces
  if (next.immovableVariant?.damage) {
    next.immovableVariant = { ...next.immovableVariant, damage: round2(next.immovableVariant.damage * scale) };
  }
  const applied = skillEffects(skill);
  if (applied.length > 0) next.appliesEffect = scaledEffects(skill, applied, scale, step);
  // A nested Reaction's response ranks its effects too (Carapace Leap's two Barriers)
  const response = next.reaction?.response;
  if (skill.perRank?.nested && next.reaction && response && skillEffects(response).length > 0) {
    next.reaction = {
      ...next.reaction,
      response: { ...response, appliesEffect: scaledEffects(skill, skillEffects(response), scale, step) },
    };
  }
  return next;
}

/** A skill's effect list at a rung: magnitudes scaled, durations moved by `perRank.duration`. */
function scaledEffects(skill: HeroSkill, applied: SkillEffect[], scale: number, step: number): SkillEffect[] {
  // A Barrier skill may climb its own curve (`perRank.barrierScale`); a single-rank
  // node (scale 1, step 0) reads the middle value, which is 1
  const barrierScale = skill.perRank?.barrierScale;
  const scaleOf = (e: SkillEffect): number =>
    barrierScale && e.type === AuraType.Barrier ? barrierScale[step + 1] : scale;
  return applied.map((e) => ({
    ...e,
    // A fraction of a stat keeps its fraction: a Reckoning authored at 2× Attack is
    // 1.5 / 2 / 2.5× by rung, where rounding would have made the bottom two equal
    magnitude: e.magnitude < 1 || isScaledMagnitude(e.type, e.magnitude)
      ? round3(e.magnitude * scaleOf(e))
      : Math.round(e.magnitude * scaleOf(e)),
    duration: skill.perRank?.duration && e.duration > 0 && e.duration < 99
      ? e.duration + skill.perRank.duration * step
      : e.duration,
  }));
}
