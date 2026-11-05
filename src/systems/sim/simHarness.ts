import {
  EQUIP_SLOTS,
  EquipSlot,
  Hero,
  HeroTemplateId,
  Item,
  MasteryId,
  Rarity,
} from '@/models/types';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import { canUnlockNode, deriveHeroSkills, pointsEarnedByLevel, pointsSpent } from '@/systems/progression/mastery';
import { findMasteryPath } from '@/data/skills/masteryData';
import { itemTemplates } from '@/data/items/itemTemplates';
import { findTemplate, itemAtLevel, itemFromTemplateId } from '@/systems/economy/itemFactory';
import { canBeMythic } from '@/data/items/setBonus';
import { isLegendaryGrade } from '@/data/items/rarity';
import { heroMaxHp, heroMaxMana } from '@/systems/progression/statCalc';
import { BALANCE } from '@/data/balanceConstants';
import { highestLevelCap } from '@/data/levelCap';
import { EncounterContext } from '@/models/encounter';
import { getLocation, locationContext } from '@/locations';
import { LAIR_SPECS } from '@/locations/lairs';
import { siteContext } from '@/systems/combat/encounterContext';
import { KAIREN_TEMPLATE_ID } from '@/systems/combat/kairenRules';
import { templateName } from '@/data/templates/unitText';

/**
 * Building an arbitrary hero for the tuning harness.
 *
 * The app only ever grows a hero forwards — recruit at level 1, earn XP, spend
 * points. Tuning needs the opposite: *state* a hero at level 14 with a chosen
 * path, four specific nodes and a `+3` weapon, and fight with it immediately.
 *
 * Everything here funnels through the same derivations the game uses
 * (`calculateStatsForLevel`, `deriveHeroSkills`, `itemFromTemplateId`), so a
 * hero built by the harness is indistinguishable from one that was played into
 * existence. That is the whole reason the numbers measured here mean anything.
 */

/**
 * Re-exported, never redeclared.
 *
 * This was a second array of the same name and the same nine entries, and
 * `SimSetupScreen` imports the symbol *from here* — so the app dressed a hero
 * from `models/items.ts` while the harness dressed one from this file, and the
 * two agreed only by coincidence. That was merely untidy while both copies did
 * nothing but iterate; it stopped being untidy when `lootGenerator` began
 * deriving `SLOT_DROP_WEIGHT` from the canonical list, which made that list the
 * denominator of every drop share in the game.
 *
 * A slot added there and not here would have left the harness measuring a hero
 * missing a piece of gear the real game hands out — which is precisely the
 * comparison this whole module exists to keep trustworthy — and neither
 * TypeScript nor any test could have seen it.
 */
export { EQUIP_SLOTS };

export interface SimHeroConfig {
  templateId: HeroTemplateId;
  level: number;
  masteryPath: MasteryId | null;
  /**
   * Node ids, bought through the *real* mastery tree at the *real* point budget
   * for this level — see `simMasteryHero`. The harness used to hand out nodes
   * from a chip list with no prerequisites and no cost, which measured builds no
   * hero can hold; a fight is only worth timing if the build could turn up in one.
   *
   * A **list**, not the hero's id-to-level map: an id repeated is a second level
   * of that node, so the editor's undo is `slice(0, -1)` — the last point back —
   * and the order points were spent in is information the map does not keep.
   * `nodeLevels` is the one place it is folded into what a `Hero` holds.
   */
  masteryNodes: string[];
  /** Item **template** ids by slot; the harness mints a fresh item per slot. */
  equipment: Partial<Record<EquipSlot, string>>;
  /**
   * Crystal upgrades per slot, for legendaries: item levels past the cap.
   * Clamped to the legendary ceiling on the way in; ignored on anything else.
   */
  upgrades?: Partial<Record<EquipSlot, number>>;
  /**
   * Item level per slot for anything that is not a legendary, restated with
   * `itemAtLevel`. Absent, a piece sits at its rarity's anchor like a catalogue
   * entry. The balance simulator rolls these around a per-rarity average.
   */
  itemLevels?: Partial<Record<EquipSlot, number>>;
}

export function defaultHeroConfig(
  templateId: HeroTemplateId,
  level = 1
): SimHeroConfig {
  return { templateId, level, masteryPath: null, masteryNodes: [], equipment: {} };
}

/**
 * Mints the configured gear and returns a fully-formed `Hero`.
 *
 * `mint` is injected rather than reaching for `inventoryStore` directly so the
 * builder stays testable — and so a caller that wants the hero without touching
 * the player's bag can say so.
 */
/**
 * A recipe slot's id for a set piece worn as a mythic: the catalogue holds no
 * mythic template, so the slot says it. The Save Creator's way to dress a test
 * hero in one, behind `SAVE_CREATOR`; it reaches no release build.
 */
export const MYTHIC_SLOT = 'mythic:';

/** The id a recipe stores for this piece. */
export const simSlotId = (item: Pick<Item, 'templateId' | 'rarity'>): string =>
  (item.rarity === Rarity.Mythic ? `${MYTHIC_SLOT}${item.templateId}` : item.templateId);

/**
 * The piece a configured slot holds, as `buildSimHero` mints it — so a picker
 * can show the numbers the hero will actually wear.
 *
 * A legendary's "+N" is N item levels past the cap it drops at, so the harness
 * builds it exactly the way a Crystal would. Anything else has no Crystal track
 * and ignores the dial.
 */
export function simSlotItem(slotId: string, upgrade?: number, level?: number): Item | null {
  const mythic = slotId.startsWith(MYTHIC_SLOT);
  const templateId = mythic ? slotId.slice(MYTHIC_SLOT.length) : slotId;
  const template = findTemplate(templateId);
  const found = itemFromTemplateId(templateId);
  if (!template || !found || (mythic && !canBeMythic(template))) return null;
  const base = mythic ? { ...found, rarity: Rarity.Mythic } : found;
  if (isLegendaryGrade(base.rarity)) {
    return itemAtLevel(base, BALANCE.MAX_LEVEL + Math.max(0, upgrade ?? 0));
  }
  return level === undefined ? base : itemAtLevel(base, level);
}

export function buildSimHero(
  config: SimHeroConfig,
  mint: (item: Item) => string,
  id = `sim_${config.templateId}_${Math.random().toString(36).slice(2, 8)}`
): Hero | null {
  const template = heroTemplates.find((t) => t.id === config.templateId);
  if (!template) return null;

  const level = Math.max(1, Math.min(config.level, highestLevelCap()));
  const baseStats = calculateStatsForLevel(template, level);

  const equipment: Partial<Record<EquipSlot, string>> = {};
  const minted: Item[] = [];
  for (const slot of EQUIP_SLOTS) {
    const templateId = config.equipment[slot];
    if (!templateId) continue;
    const item = simSlotItem(templateId, config.upgrades?.[slot], config.itemLevels?.[slot]);
    if (!item) continue;
    const itemId = mint(item);
    minted.push({ ...item, id: itemId });
    equipment[slot] = itemId;
  }

  const hero: Hero = {
    id,
    templateId: config.templateId,
    name: templateName(template.id),
    heroClass: template.heroClass,
    level,
    // XP into the current level, which is what `Hero.xp` means — `gainXp`
    // subtracts each level's cost as it is crossed. A hero built at a level has
    // just arrived there. This was the *total* to reach it, so every sheet the
    // harness opened read "1245 / 350", which the hero-sheet mockup then copied.
    xp: 0,
    baseStats,
    // Placeholders. The real ceiling includes the loadout and the tree, neither
    // of which is attached yet — see the fill-in below.
    currentHp: baseStats.maxHp,
    currentMana: baseStats.maxMana,
    skills: [],
    equipment,
    masteryPath: level >= BALANCE.MASTERY_UNLOCK_LEVEL ? config.masteryPath : null,
    // Points already spent are gone; what is left is what the level grants minus
    // the cost of the nodes handed to us. Never negative, because the harness
    // deliberately allows builds a played hero could not afford.
    masteryPoints: 0,
    masteryNodes: {},
  };

  // Skills are derived last: they depend on the path and the nodes, which are
  // only valid once the hero object exists to be read.
  hero.masteryNodes = hero.masteryPath ? nodeLevels(config.masteryNodes) : {};
  hero.skills = deriveHeroSkills(hero, template.skills);

  // Last, for the same reason skills are: a hero minted with nine pieces of gear
  // and a spent tree has a ceiling `baseStats` knows nothing about, and a sim
  // party that walked into the arena already wounded was this line reading it.
  hero.currentHp = heroMaxHp(hero, minted);
  hero.currentMana = heroMaxMana(hero, minted);

  return hero;
}

// ─── Driving the real mastery tree from a config ───────────────────────────────

/**
 * Points this configured hero has to spend — exactly what its level grants.
 *
 * The whole reason the tree moved into the harness: a build tested with every
 * node lit is not a build. Level is the dial; the budget follows from it, so
 * dragging a hero from L10 to L20 shows what those ten levels actually buy.
 */
export function simPointBudget(config: Pick<SimHeroConfig, 'level' | 'masteryPath'>): number {
  return pointsEarnedByLevel(
    Math.max(1, Math.min(config.level, highestLevelCap())),
    config.masteryPath,
  );
}

/** Points the configured nodes cost. */
export function simPointsSpent(config: Pick<SimHeroConfig, 'masteryPath' | 'masteryNodes'>): number {
  return pointsSpent({ masteryPath: config.masteryPath, masteryNodes: nodeLevels(config.masteryNodes) });
}

/** The editor's spend list as the id-to-level map a `Hero` carries. */
export function nodeLevels(ids: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = (out[id] ?? 0) + 1;
  return out;
}

/**
 * A throwaway `Hero` for rendering the *real* `MasteryView` against a config.
 *
 * Equipment is deliberately left off: the tree never reads it, and minting nine
 * items on every keystroke of the build editor is pure waste.
 */
export function simMasteryHero(config: SimHeroConfig): Hero | null {
  const hero = buildSimHero({ ...config, equipment: {}, upgrades: {} }, () => '', 'sim_build');
  if (!hero) return null;
  hero.masteryPoints = Math.max(0, simPointBudget(config) - simPointsSpent(config));
  return hero;
}

/**
 * Spends the whole budget on the cheapest legal nodes, tier by tier.
 *
 * A starting point rather than an opinion — it fills a tree in a tap so the
 * editing is done by *unpicking*, which is faster than clicking twelve nodes to
 * find out the last one was unaffordable.
 */
export function simAutoSpend(config: SimHeroConfig): string[] {
  const path = config.masteryPath ? findMasteryPath(config.masteryPath) : undefined;
  if (!path) return [];

  const order = [...path.nodes].sort((a, b) => a.tier - b.tier || a.cost - b.cost);
  let owned = [...config.masteryNodes];
  // Repeated passes: a tier-2 node only becomes legal once its parents are in,
  // and one sorted sweep does not guarantee that for the wider trees.
  for (let pass = 0; pass < path.nodes.length; pass++) {
    const before = owned.length;
    for (const node of order) {
      // No `includes` guard any more: a node already held is a candidate for
      // its *next* level, and `canUnlockNode` is what knows when it is full.
      const probe = simMasteryHero({ ...config, masteryNodes: owned });
      if (probe && canUnlockNode(probe, node.id).ok) owned = [...owned, node.id];
    }
    if (owned.length === before) break;
  }
  return owned;
}

/**
 * The harness's two ways to choose opposition.
 *
 * A skirmish is any mix of ordinary foes; a boss test is exactly one boss. They
 * are separate because a boss is not a bigger enemy: its fight is a scripted
 * kit, so it is never one entry among chaff, and an ordinary skirmish can never
 * be started with one by accident.
 */
export type SimFightMode = 'skirmish' | 'boss';

/** Whether `templateId` names a boss, the only kind the boss test may field. */
export function isBossTemplate(templateId: string): boolean {
  return enemyTemplates.some((t) => t.id === templateId && t.tier === 'boss');
}

/** Boss templates in data order, for the boss test's picker. */
export function simBossTemplates() {
  return enemyTemplates.filter((t) => t.tier === 'boss');
}

/**
 * The arena a boss test is fought in: the one the real fight has.
 *
 * A lair boss is fought on the hex its door trigger names, inside the lair's own
 * context; Aethelred's is the castle. Anything else (a boss with no home) stays
 * on the harness's default ground. The setup screen passes this to
 * `startEncounter`, so the tuning fight is dressed exactly like the one the
 * player will meet.
 */
export function simBossContext(bossId: string | null): EncounterContext | undefined {
  if (!bossId) return undefined;
  if (bossId === 'aethelred') return locationContext('castle');
  // Kairen is fought at his summit, the site's own arena
  if (bossId === KAIREN_TEMPLATE_ID) return siteContext('summit');
  const lair = LAIR_SPECS.find((l) => l.boss === bossId);
  if (!lair) return undefined;
  const tile = getLocation(lair.id).tiles.find(
    (t) => t.trigger?.kind === 'encounter' && t.trigger.encounterId.endsWith('_boss'),
  );
  return locationContext(lair.id, tile?.coord);
}

/** Ordinary templates for a skirmish: every tier but boss. */
export function simSkirmishTemplates() {
  return enemyTemplates.filter((t) => t.tier !== 'boss');
}

/**
 * The enemy ids a setup fights.
 *
 * Skirmish counts never include a boss even if a stale preset names one; a boss
 * test is the one chosen boss alone, or nothing until one is picked.
 */
export function simFoeList(
  mode: SimFightMode,
  foes: Record<string, number>,
  boss: string | null,
): string[] {
  if (mode === 'boss') return boss && isBossTemplate(boss) ? [boss] : [];
  return Object.entries(foes).flatMap(
    ([id, n]) => (isBossTemplate(id) ? [] : (Array(n).fill(id) as string[])),
  );
}

/**
 * Splits a saved preset's `foes` back into a mode and its parts. A preset
 * holding a boss is a boss test, and anything else it names stays a skirmish
 * that a later switch back to skirmish can still use.
 */
export function simModeOfFoes(foes: Record<string, number>): {
  mode: SimFightMode;
  boss: string | null;
  foes: Record<string, number>;
} {
  const boss = Object.keys(foes).find(isBossTemplate) ?? null;
  const rest = Object.fromEntries(Object.entries(foes).filter(([id]) => !isBossTemplate(id)));
  return { mode: boss ? 'boss' : 'skirmish', boss, foes: rest };
}

/**

 * Every legendary piece of a path's set, by the slot it is worn in.

 *

 * Read off the item library — a set piece is a legendary carrying the path's

 * `masteryLock`, the pair `setBonusPath` keys on — so a set that gains a piece

 * gains it here as well. Shared by the perf fights and the encounter review, which dresses its
 * endgame party in it.

 */

export function setLoadout(path: MasteryId): Partial<Record<EquipSlot, string>> {

  const out: Partial<Record<EquipSlot, string>> = {};

  for (const template of itemTemplates) {

    if (template.rarity !== Rarity.Legendary || template.masteryLock?.[0] !== path) continue;

    const slot: EquipSlot = template.slot === 'ring' ? 'ring1' : template.slot;

    if (!out[slot]) out[slot] = template.id;

  }

  return out;

}
