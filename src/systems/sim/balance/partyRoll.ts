import { EQUIP_SLOTS, EquipSlot, Hero, HeroClass, HeroTemplateId, Item, MasteryId, MasteryNode, MasteryPath, Rarity } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { itemTemplates } from '@/data/items/itemTemplates';
import { clampItemLevel } from '@/data/items/itemLevel';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { findMasteryPath, masteriesForClass } from '@/data/skills/masteryData';
import { canEquip, EquippedItems, slotAccepts } from '@/systems/progression/equipRules';
import {
  canUnlockNode,
  mainTreeNodes,
  pointsEarnedByLevel,
  prerequisitesFor,
  requiredPrerequisiteCount,
} from '@/systems/progression/mastery';
import { itemFromTemplate } from '@/systems/economy/itemFactory';
import { quickFill } from '@/systems/sim/scenarioItems';
import { SimHeroConfig } from '@/systems/sim/simHarness';
import { BALANCE_LEVEL_CAP, budgetAt, EncounterSpec, heroLevelCap, legendaryClamp, PartyBudget, Range } from './encounters';
import { pick, randInt, Rng, shuffled } from './rng';

/**
 * Rolling a random party inside an encounter's budget
 * (the private project notes, "Rolling a party").
 *
 * Everything funnels through the same rules the game uses: the mastery tree is
 * walked with `canUnlockNode`, gear is judged by `canEquip`, item levels by
 * `itemAtLevel`/`clampItemLevel` (via `SimHeroConfig.itemLevels`). A rolled hero
 * is a `SimHeroConfig`, so `buildSimHero` builds it unchanged.
 */

export interface RolledHero extends SimHeroConfig {
  heroClass: HeroClass;
  /** The tier-3 node the hero ended up with, or null (too low for one, or none bought). */
  capstone: string | null;
}

export interface RolledParty {
  heroes: RolledHero[];
  /** The rarity counts rolled for the whole party, before any slot fell back a rarity. */
  budget: { legendary: number; epic: number; rare: number };
  levelSum: number;
}

export interface PartyConstraints {
  mustClass?: HeroClass;
  mustPath?: MasteryId;
  /** A capstone (tier-3 node id) every party must contain; implies its path. */
  mustCapstone?: string;
  excludeClasses?: readonly HeroClass[];
  excludePaths?: readonly MasteryId[];
  /** Whether two heroes may share a class. Defaults to true. */
  allowDuplicates?: boolean;
}

export interface ConstraintProblem {
  code: 'unknown' | 'excluded' | 'conflict' | 'too-few-heroes' | 'too-few-classes' | 'level' | 'unreachable';
  message: string;
}

const CAP = BALANCE_LEVEL_CAP;
/** `MasteryNode.masteryRow` of the level-26 nodes. */
const LEVEL_26_ROW = 2;
const MASTERY_UNLOCK = BALANCE.MASTERY_UNLOCK_LEVEL;

const templateOfClass = (heroClass: HeroClass): HeroTemplateId =>
  heroTemplates.find((t) => t.heroClass === heroClass)!.id as HeroTemplateId;

const ALL_CLASSES: readonly HeroClass[] = heroTemplates.map((t) => t.heroClass);

// ─── The mastery tree ─────────────────────────────────────────────────────────

/** Tier-3 nodes of the pyramid: the capstones a hero can take. */
export function capstonesOf(path: MasteryPath): MasteryNode[] {
  return mainTreeNodes(path).filter((n) => n.tier === 3);
}

/** A hero-shaped probe: `canUnlockNode` reads only these four fields. */
function probeHero(level: number, path: MasteryId, points: number): Hero {
  return { level, masteryPath: path, masteryNodes: {}, masteryPoints: points } as unknown as Hero;
}

function buy(probe: Hero, path: MasteryPath, nodeId: string, bought: string[]): boolean {
  if (!canUnlockNode(probe, nodeId).ok) return false;
  const node = path.nodes.find((n) => n.id === nodeId)!;
  probe.masteryNodes[nodeId] = (probe.masteryNodes[nodeId] ?? 0) + 1;
  probe.masteryPoints -= node.cost;
  bought.push(nodeId);
  return true;
}

/**
 * The nodes to buy, prerequisites first, to reach `nodeId`. A node asking "any N
 * of these" gets a random N of them.
 */
function chainTo(path: MasteryPath, nodeId: string, rng: Rng, into: string[] = []): string[] {
  if (into.includes(nodeId)) return into;
  const node = path.nodes.find((n) => n.id === nodeId)!;
  const parents = prerequisitesFor(path, node);
  const need = requiredPrerequisiteCount(path, node);
  const chosen = need >= parents.length ? parents : shuffled(rng, parents).slice(0, need);
  for (const parent of chosen) chainTo(path, parent.id, rng, into);
  into.push(nodeId);
  return into;
}

export interface MasterySpend {
  nodes: string[];
  capstone: string | null;
}

/**
 * Spends every point a hero of this level has, through the real tree.
 *
 * A random capstone the budget can reach (or `target`) is walked to first, then
 * what is left goes to uniformly random legal purchases. Walking to a goal
 * first is deliberate: a purely random spend would almost never reach a
 * capstone, and the capstone is one of the things the simulator ranks. A
 * `target` that cannot be reached returns whatever capstone the spend did land.
 */
export function rollMasterySpend(path: MasteryPath, level: number, rng: Rng, target?: string): MasterySpend {
  const probe = probeHero(level, path.id as MasteryId, pointsEarnedByLevel(level, path.id as MasteryId));
  const bought: string[] = [];

  let goal = target;
  if (!goal) {
    const reachable = capstonesOf(path).filter((c) => {
      const chain = chainTo(path, c.id, () => 0.5);
      return chain.reduce((sum, id) => sum + path.nodes.find((n) => n.id === id)!.cost, 0) <= probe.masteryPoints;
    });
    goal = reachable.length ? pick(rng, reachable).id : undefined;
  }
  if (goal) {
    for (const id of chainTo(path, goal, rng)) if (!buy(probe, path, id, bought)) break;
  }

  // A hero that has reached a level-26 row fields its node, for the reason it walks to a capstone: a random
  // spend leaves more than half of them without it. No effect below that row's level
  for (const node of path.nodes.filter((n) => (n.masteryRow ?? 0) >= LEVEL_26_ROW)) {
    while (buy(probe, path, node.id, bought));
  }

  for (;;) {
    const legal = path.nodes.filter((n) => canUnlockNode(probe, n.id).ok);
    if (legal.length === 0) break;
    buy(probe, path, pick(rng, legal).id, bought);
  }

  const caps = new Set(capstonesOf(path).map((c) => c.id));
  const capstone = goal && bought.includes(goal) ? goal : (bought.find((id) => caps.has(id)) ?? null);
  return { nodes: bought, capstone };
}

const minLevelCache = new Map<string, number | null>();

/**
 * The lowest level at which a hero can hold `capstoneId`, or null when none up to the cap can.
 * Found by walking the real tree, so a capstone behind an impossible pair is told apart.
 */
export function capstoneMinLevel(pathId: MasteryId, capstoneId: string): number | null {
  const key = `${pathId}/${capstoneId}`;
  if (minLevelCache.has(key)) return minLevelCache.get(key)!;
  const path = findMasteryPath(pathId);
  let found: number | null = null;
  if (path && capstonesOf(path).some((c) => c.id === capstoneId)) {
    for (let level = MASTERY_UNLOCK; level <= CAP && found === null; level++) {
      // "Any N of" nodes are drawn at random, so try a few draws
      for (let attempt = 0; attempt < 6 && found === null; attempt++) {
        let state = (attempt + 1) * 7919;
        const rng: Rng = () => (state = (state * 16807) % 2147483647) / 2147483647;
        const probe = probeHero(level, pathId, pointsEarnedByLevel(level, pathId));
        const bought: string[] = [];
        if (chainTo(path, capstoneId, rng).every((id) => buy(probe, path, id, bought))) found = level;
      }
    }
  }
  minLevelCache.set(key, found);
  return found;
}

// ─── Constraints ──────────────────────────────────────────────────────────────

function capstoneOwner(id: string): MasteryPath | undefined {
  for (const cls of ALL_CLASSES) {
    for (const path of masteriesForClass(cls)) if (capstonesOf(path).some((c) => c.id === id)) return path;
  }
  return undefined;
}

/** The path a constraint set demands, if any. */
function demandedPath(c: PartyConstraints): MasteryPath | undefined {
  if (c.mustCapstone) return capstoneOwner(c.mustCapstone);
  return c.mustPath ? findMasteryPath(c.mustPath) : undefined;
}

/**
 * Constraints that can never be met, found before a run starts rather than
 * discovered as thousands of failed rolls.
 */
export function checkConstraints(spec: EncounterSpec, c: PartyConstraints): ConstraintProblem[] {
  const out: ConstraintProblem[] = [];
  const problem = (code: ConstraintProblem['code'], message: string) => out.push({ code, message });
  const excludedClasses = new Set(c.excludeClasses ?? []);
  const excludedPaths = new Set(c.excludePaths ?? []);

  if (c.mustClass && !ALL_CLASSES.includes(c.mustClass)) problem('unknown', `Unknown class ${c.mustClass}.`);
  if (c.mustPath && !findMasteryPath(c.mustPath)) problem('unknown', `Unknown mastery path ${c.mustPath}.`);
  if (c.mustCapstone && !capstoneOwner(c.mustCapstone)) problem('unknown', `Unknown capstone ${c.mustCapstone}.`);
  if (out.length) return out;

  if (c.mustClass && excludedClasses.has(c.mustClass)) problem('excluded', `${c.mustClass} is both required and excluded.`);

  const path = demandedPath(c);
  if (c.mustPath && c.mustCapstone && path && path.id !== c.mustPath) {
    problem('conflict', `Capstone ${c.mustCapstone} belongs to ${path.id}, not ${c.mustPath}.`);
  }
  if (path) {
    if (excludedPaths.has(path.id as MasteryId)) problem('excluded', `${path.id} is both required and excluded.`);
    if (excludedClasses.has(path.heroClass)) problem('excluded', `${path.id} needs ${path.heroClass}, which is excluded.`);
    if (c.mustClass && c.mustClass !== path.heroClass && spec.heroes.max < 2) {
      problem('too-few-heroes', `${c.mustClass} and ${path.id} need two different heroes; this encounter fields one.`);
    }
  }

  const allowed = ALL_CLASSES.filter((cls) => !excludedClasses.has(cls));
  if (c.allowDuplicates === false && spec.heroes.min > allowed.length) {
    problem('too-few-classes', `${spec.heroes.min} heroes without duplicate classes need ${spec.heroes.min} classes; ${allowed.length} allowed.`);
  }

  if (path) {
    // The highest one hero of the party can be, at whichever party size gives the most (a scaled budget grows with it)
    let most = 0;
    for (let count = Math.max(1, spec.heroes.min); count <= Math.max(1, spec.heroes.max); count++) {
      most = Math.max(most, budgetAt(spec, count).levelSum.max - (count - 1));
    }
    const best = Math.min(heroLevelCap(spec), most);
    if (c.mustCapstone) {
      const need = capstoneMinLevel(path.id as MasteryId, c.mustCapstone);
      if (need === null) problem('unreachable', `${c.mustCapstone} cannot be reached by any level up to ${CAP}.`);
      else if (best < need) problem('level', `${c.mustCapstone} needs level ${need}; this encounter's budget tops out at ${best}.`);
    } else if (best < MASTERY_UNLOCK) {
      problem('level', `${path.id} needs level ${MASTERY_UNLOCK}; this encounter's budget tops out at ${best}.`);
    }
  }
  return out;
}

// ─── Rolling ──────────────────────────────────────────────────────────────────

const inRange = (rng: Rng, r: Range) => randInt(rng, r.min, r.max);

/**
 * Splits `sum` evenly over `count` heroes: everyone starts at the mean, then a few random one-level
 * trades keep every hero within one level of it either side. A party is a team of comparable heroes,
 * so 70 over four lands at 16–19 (19 17 18 16), never 20 20 18 12, whose low seat would be carried
 * and whose row would then be credited with the carry.
 */
export function splitLevels(rng: Rng, sum: number, count: number, cap: number = BALANCE.MAX_LEVEL): number[] {
  const mean = sum / count;
  const lo = Math.max(1, Math.floor(mean) - 1);
  const hi = Math.min(cap, Math.ceil(mean) + 1);
  const levels = Array.from({ length: count }, () => Math.min(cap, Math.floor(mean)));
  let left = sum - levels.reduce((a, b) => a + b, 0);
  for (const i of shuffled(rng, Array.from({ length: count }, (_, k) => k))) {
    if (left <= 0) break;
    if (levels[i] < cap) { levels[i]++; left--; }
  }
  for (let k = 0; k < count * 2; k++) {
    const from = randInt(rng, 0, count - 1);
    const to = randInt(rng, 0, count - 1);
    if (from !== to && levels[from] - 1 >= lo && levels[to] + 1 <= hi) { levels[from]--; levels[to]++; }
  }
  return levels;
}

/** Hands first, so an off hand is judged against the main hand it goes beside. */
const DRESS_ORDER: EquipSlot[] = ['mainHand', 'offHand', ...EQUIP_SLOTS.filter((s) => s !== 'mainHand' && s !== 'offHand')];

const baseItems = new Map<string, Item>();
const baseItem = (templateId: string): Item => {
  let item = baseItems.get(templateId);
  if (!item) {
    item = itemFromTemplate(itemTemplates.find((t) => t.id === templateId)!);
    baseItems.set(templateId, item);
  }
  return item;
};

const candidateCache = new Map<string, string[]>();
function candidates(rarity: Rarity, slot: EquipSlot): string[] {
  const key = `${rarity}/${slot}`;
  let list = candidateCache.get(key);
  if (!list) {
    list = itemTemplates.filter((t) => t.rarity === rarity && slotAccepts(slot, t.slot)).map((t) => t.id);
    candidateCache.set(key, list);
  }
  return list;
}

const commonCache = new Map<string, Partial<Record<EquipSlot, string>>>();
function commonLoadout(templateId: HeroTemplateId, path: MasteryId | null): Partial<Record<EquipSlot, string>> {
  const key = `${templateId}/${path ?? ''}`;
  let loadout = commonCache.get(key);
  if (!loadout) {
    loadout = quickFill({ templateId, level: 1, masteryPath: path, masteryNodes: [], equipment: {} }, Rarity.Common).equipment;
    commonCache.set(key, loadout);
  }
  return loadout;
}

/** "Drops one rarity" when nothing of the rolled rarity fits a slot. */
const RARITY_FALLBACK: Record<Rarity, Rarity | null> = {
  [Rarity.Legendary]: Rarity.Epic,
  [Rarity.Mythic]: Rarity.Legendary,
  [Rarity.Epic]: Rarity.Rare,
  [Rarity.Rare]: Rarity.Common,
  [Rarity.Common]: null,
};

function rollItemLevel(rng: Rng, spec: EncounterSpec, rarity: Rarity): number {
  const { avg, spread } = spec.itemLevels[rarity];
  const level = Math.round(avg) + randInt(rng, -Math.round(spread), Math.round(spread));
  if (rarity === Rarity.Legendary) {
    const { min, max } = legendaryClamp(spec.band ?? 0);
    return Math.min(max, Math.max(min, level));
  }
  // The Empire's budgets read the cap in force; a band states its own
  return spec.levelCap || spec.band ? Math.max(1, Math.min(heroLevelCap(spec), level)) : clampItemLevel(level, rarity);
}

/** A legendary's level is Crystal levels past the cap; everything else carries an item level. */
function setLevel(hero: RolledHero, slot: EquipSlot, rarity: Rarity, level: number): void {
  if (rarity === Rarity.Legendary) {
    hero.upgrades = { ...hero.upgrades, [slot]: level - BALANCE.MAX_LEVEL };
    if (hero.itemLevels) delete hero.itemLevels[slot];
  } else {
    hero.itemLevels = { ...hero.itemLevels, [slot]: level };
    if (hero.upgrades) delete hero.upgrades[slot];
  }
}

/** Dresses one hero: common everywhere, then the rolled rarities in their cells. */
function dress(hero: RolledHero, cells: Map<EquipSlot, Rarity>, spec: EncounterSpec, rng: Rng): void {
  const equipment = { ...commonLoadout(hero.templateId, hero.masteryPath) };
  const worn: EquippedItems = {};
  for (const slot of EQUIP_SLOTS) {
    const id = equipment[slot];
    if (!id) continue;
    worn[slot] = baseItem(id);
    setLevel(hero, slot, Rarity.Common, rollItemLevel(rng, spec, Rarity.Common));
  }
  hero.equipment = equipment;

  for (const slot of DRESS_ORDER) {
    let rarity: Rarity | null = cells.get(slot) ?? null;
    while (rarity && rarity !== Rarity.Common) {
      const rest: EquippedItems = { ...worn };
      delete rest[slot];
      const choice = shuffled(rng, candidates(rarity, slot)).find((id) => {
        const check = canEquip(hero, baseItem(id), slot, rest);
        return check.ok && check.displaces.length === 0;
      });
      if (choice) {
        equipment[slot] = choice;
        worn[slot] = baseItem(choice);
        setLevel(hero, slot, rarity, rollItemLevel(rng, spec, rarity));
        break;
      }
      rarity = RARITY_FALLBACK[rarity];
    }
  }
}

/** Raises hero `index` to at least `need`, taking levels from the highest heroes that can spare them. */
function raiseTo(levels: number[], index: number, need: number): void {
  while (levels[index] < need) {
    // A donor stays on a path (unlock level) while any can; only then does one drop below it
    let donor = -1;
    for (const keep of [MASTERY_UNLOCK, 1]) {
      for (let i = 0; i < levels.length; i++) {
        if (i !== index && levels[i] > keep && (donor < 0 || levels[i] > levels[donor])) donor = i;
      }
      if (donor >= 0) break;
    }
    if (donor < 0) throw new Error('constraints cannot be met within the level budget');
    levels[donor]--;
    levels[index]++;
  }
}

export function rollParty(spec: EncounterSpec, constraints: PartyConstraints, rng: Rng): RolledParty {
  const count = inRange(rng, spec.heroes);
  const ranges = budgetAt(spec, count);
  const cap = heroLevelCap(spec);
  const sum = Math.max(count, Math.min(count * cap, inRange(rng, ranges.levelSum)));

  const excludedClasses = new Set(constraints.excludeClasses ?? []);
  const excludedPaths = new Set(constraints.excludePaths ?? []);
  const demanded = demandedPath(constraints);
  const allowed = ALL_CLASSES.filter((c) => !excludedClasses.has(c));

  // Classes: the required ones go to random places, the rest are drawn
  const classes: (HeroClass | null)[] = Array.from({ length: count }, () => null);
  const places = shuffled(rng, Array.from({ length: count }, (_, i) => i));
  const mustClass = constraints.mustClass ?? demanded?.heroClass;
  let demandedIndex = -1;
  if (mustClass) classes[places[0]] = mustClass;
  if (demanded) {
    if (mustClass === demanded.heroClass) {
      demandedIndex = places[0];
    } else {
      demandedIndex = places[1] ?? places[0];
      classes[demandedIndex] = demanded.heroClass;
    }
  }
  for (let i = 0; i < count; i++) {
    if (classes[i]) continue;
    const pool = constraints.allowDuplicates === false ? allowed.filter((c) => !classes.includes(c)) : allowed;
    if (pool.length === 0) throw new Error('not enough classes for a party without duplicates');
    classes[i] = pick(rng, pool);
  }

  // Levels: an even split, then a capstone may pull its hero up to the level its chain costs
  const levels = splitLevels(rng, sum, count, cap);
  if (demandedIndex >= 0) {
    const need = constraints.mustCapstone
      ? capstoneMinLevel(demanded!.id as MasteryId, constraints.mustCapstone)
      : MASTERY_UNLOCK;
    if (need === null) throw new Error(`${constraints.mustCapstone} is unreachable`);
    raiseTo(levels, demandedIndex, need);
  }

  // Paths and the tree
  const heroes: RolledHero[] = classes.map((heroClass, i) => {
    const level = levels[i];
    let path: MasteryPath | undefined;
    if (level >= MASTERY_UNLOCK) {
      if (i === demandedIndex) {
        path = demanded;
      } else {
        const open = masteriesForClass(heroClass!).filter((p) => !excludedPaths.has(p.id as MasteryId));
        if (open.length === 0) throw new Error(`every path of ${heroClass} is excluded`);
        path = pick(rng, open);
      }
    }
    const spend = path ? rollMasterySpend(path, level, rng, i === demandedIndex ? constraints.mustCapstone : undefined) : null;
    if (i === demandedIndex && constraints.mustCapstone && spend?.capstone !== constraints.mustCapstone) {
      throw new Error(`could not take ${constraints.mustCapstone}`);
    }
    return {
      templateId: templateOfClass(heroClass!),
      heroClass: heroClass!,
      level,
      masteryPath: (path?.id as MasteryId | undefined) ?? null,
      masteryNodes: spend?.nodes ?? [],
      capstone: spend?.capstone ?? null,
      equipment: {},
    };
  });

  const budget = dressParty(heroes, spec, ranges, rng);
  return { heroes, budget, levelSum: levels.reduce((a, b) => a + b, 0) };
}

/** Scatters a rolled rarity budget over the party's slots, then fills each cell; returns the budget. */
function dressParty(heroes: RolledHero[], spec: EncounterSpec, ranges: PartyBudget, rng: Rng): RolledParty['budget'] {
  const budget = {
    legendary: inRange(rng, ranges.legendary),
    epic: inRange(rng, ranges.epic),
    rare: inRange(rng, ranges.rare),
  };
  const cells = shuffled(rng, heroes.flatMap((_, h) => EQUIP_SLOTS.map((slot) => ({ h, slot }))));
  const perHero: Map<EquipSlot, Rarity>[] = heroes.map(() => new Map());
  let next = 0;
  const wanted: [Rarity, number][] = [
    [Rarity.Legendary, budget.legendary],
    [Rarity.Epic, budget.epic],
    [Rarity.Rare, budget.rare],
  ];
  for (const [rarity, n] of wanted) {
    for (let k = 0; k < n && next < cells.length; k++, next++) perHero[cells[next].h].set(cells[next].slot, rarity);
  }
  heroes.forEach((hero, i) => dress(hero, perHero[i], spec, rng));
  return budget;
}

/** A seat chosen by hand: the class, and the path (taken only at the unlock level or above). */
export interface PartyPick {
  heroClass: HeroClass;
  masteryPath: MasteryId | null;
}

/**
 * A party of chosen classes and paths, levelled and dressed inside the encounter's budget exactly as
 * `rollParty` would, with every mastery point left unspent: Save Creator leaves the tree to the
 * player. The hero count is the picks', not the spec's.
 */
export function rollPickedParty(spec: EncounterSpec, picks: readonly PartyPick[], rng: Rng): RolledParty {
  const count = picks.length;
  const ranges = budgetAt(spec, count);
  const cap = heroLevelCap(spec);
  const sum = Math.max(count, Math.min(count * cap, inRange(rng, ranges.levelSum)));
  const levels = splitLevels(rng, sum, count, cap);
  const heroes: RolledHero[] = picks.map((pick, i) => {
    const path = pick.masteryPath ? findMasteryPath(pick.masteryPath) : undefined;
    if (pick.masteryPath && path?.heroClass !== pick.heroClass) throw new Error(`${pick.masteryPath} is not a path of ${pick.heroClass}`);
    return {
      templateId: templateOfClass(pick.heroClass),
      heroClass: pick.heroClass,
      level: levels[i],
      masteryPath: path && levels[i] >= MASTERY_UNLOCK ? (path.id as MasteryId) : null,
      masteryNodes: [],
      capstone: null,
      equipment: {},
    };
  });
  return { heroes, budget: dressParty(heroes, spec, ranges, rng), levelSum: sum };
}
