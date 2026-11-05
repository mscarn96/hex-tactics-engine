import { isLegendaryGrade } from '@/data/items/rarity';
import {
  AffixId, FormId, Item, ItemModifiers, ItemTemplate, MasteryId, ModelVariantId, MotifId, Rarity,
  ResourceType,
} from '@/models/types';
import { FORMS, masterySetMotifsFor, setFormsOf } from '@/data/items/itemForms';
import { RARITY_SCALE, generatedItemId, itemBudget } from '@/data/items/itemGen';
import { itemTemplates } from '@/data/items/itemTemplates';
import { MOTIFS, MOTIF_RARITY, isMasteryMotif } from '@/data/items/motifs';
import { canRerollSetBonus } from '@/data/items/setBonus';
import { motifWorld, worldMotifsFor } from '@/data/items/worldGear';
import { isCollectionMotif } from '@/data/items/collections';
import { BALANCE } from '@/data/balanceConstants';
import { WORLD_IDS, worldDef } from '@/data/worlds';
import { itemLevelScale, maxItemLevel } from '@/data/items/itemLevel';
import { AffixSpec, affixPool, findAffix } from '@/data/items/itemAffixes';
import {
  acquisitionLevel, findTemplate, itemAtLevel, itemWithAffixes,
} from '@/systems/economy/itemFactory';

/**
 * Crafting rules.
 *
 * The forge is the counterweight to random loot: drops are uniformly random and
 * mostly off-class, but anything you don't want sells, and the gold plus the
 * resources you gather buy exactly the piece you were missing. Fixed recipes
 * couldn't do that job — with 300+ items in the library, a list of eight is
 * noise.
 *
 * Forge level gates the maximum rarity, which is what makes upgrading it worth
 * the stone.
 */

export type ResourceCost = Partial<Record<ResourceType, number>>;

/**
 * Highest rarity this forge level can produce from an ordinary motif.
 *
 * Legendary is not on this scale at all. The only legendary items are the
 * twelve mastery sets, and they are gated on *having the path* rather than on
 * forge level — see `canForge`. Building a bigger forge should not hand you a
 * Nightveil dagger when nobody in the party is a Shadowblade.
 */
export function maxForgeRarity(forgeLevel: number): Rarity {
  if (forgeLevel >= 2) return Rarity.Epic;
  if (forgeLevel >= 1) return Rarity.Rare;
  return Rarity.Common;
}

/**
 * Forge level a mastery set piece needs, and the level that can reroll its
 * skill bonus — the top of the scale, and now the only thing on it.
 *
 * The gate above used to read `>= 3 → Epic`, `>= 2 → Rare`, which meant levels
 * **0 and 1 crafted the identical tier**: the forge's first upgrade cost 60
 * gold, 10 wood, 20 stone and 10 iron and changed nothing a player could do.
 * `cityServices.test.ts` had it pinned as an explicit exception, because moving
 * the gate is a balance decision about when Epics become craftable rather than
 * a wording one.
 *
 * Moving it down one rung is the fix and it leaves level 3 with nothing to say,
 * which is why the reroll lands here rather than anywhere else: the top rung has
 * to buy something, and "the set piece you crafted at this bench can be re-aimed
 * at this bench" is the thing the level was always implicitly for.
 */
export const MASTERY_SET_FORGE_LEVEL = 3;

const RARITY_RANK: Record<Rarity, number> = {
  [Rarity.Common]: 0,
  [Rarity.Rare]: 1,
  [Rarity.Epic]: 2,
  [Rarity.Legendary]: 3,
  [Rarity.Mythic]: 4,
};

/**
 * Whether this form × motif can be crafted right now.
 *
 * `availableMasteries` is the paths the party has actually committed to. Set
 * pieces are refused without it, which is what makes a legendary feel earned
 * rather than unlocked by a building.
 */
export function canForge(
  form: FormId,
  motif: MotifId,
  forgeLevel: number,
  availableMasteries: MasteryId[] = [],
  /** The world patterns learned (`ascentStore.patterns`); the Empire's motifs need none. */
  patterns: readonly MotifId[] = [],
): boolean {
  // A world's motifs and collections wait for their pattern — a piece the party
  // has held — so a forge cannot craft a world's catalogue on arrival; past
  // that, a collection is a legendary and asks the set bench's level, an
  // ordinary motif its rarity's (`worldGear.ts`, `jadeveilRewards.ts`)
  if (motifWorld(motif)) {
    if (!worldMotifsFor(form).includes(motif) || !patterns.includes(motif)) return false;
    if (isCollectionMotif(motif)) return forgeLevel >= MASTERY_SET_FORGE_LEVEL;
    return RARITY_RANK[MOTIF_RARITY[motif]] <= RARITY_RANK[maxForgeRarity(forgeLevel)];
  }

  if (isMasteryMotif(motif)) {
    if (!masterySetMotifsFor(form).includes(motif)) return false;
    if (!availableMasteries.includes(motif)) return false;
    return forgeLevel >= MASTERY_SET_FORGE_LEVEL;
  }

  if (!FORMS[form].motifs.includes(motif)) return false;
  return RARITY_RANK[MOTIF_RARITY[motif]] <= RARITY_RANK[maxForgeRarity(forgeLevel)];
}

/**
 * Which raw material a form is mostly made of.
 *
 * Deliberately coarse — the point is that a bow costs wood and a cuirass costs
 * iron, so the resource you happen to be sitting on suggests what to build.
 */
function primaryMaterial(form: FormId): ResourceType {
  if (form.startsWith('plate_') || form === 'tower_shield') return ResourceType.Stone;
  if (form.startsWith('robe_') || form.startsWith('vestment_')) return ResourceType.Wood;
  if (form.startsWith('hide_')) return ResourceType.Wood;
  if (form === 'bow' || form === 'staff' || form === 'branch' || form === 'wand') return ResourceType.Wood;
  if (form === 'pendant' || form === 'band' || form === 'orb' || form === 'tome' || form === 'lantern') {
    return ResourceType.Crystal;
  }
  return ResourceType.Iron;
}

/** Material per budget point: crystal is scarcer than the three bulk materials. */
function materialRate(material: ResourceType): number {
  return material === ResourceType.Crystal
    ? BALANCE.FORGE_COST.crystalPerPoint
    : BALANCE.FORGE_COST.materialPerPoint;
}

/**
 * Resource cost for one craft.
 *
 * Derived from the same `SLOT_BUDGET × RARITY_SCALE` the item's stats come
 * from, so a stronger item costs proportionally more without a second table to
 * keep in sync. Elemental motifs add a Crystal surcharge on top.
 *
 * `itemLevel` is the level the craft is made at; the legendary rule that it
 * lands on the cap whatever is asked is `acquisitionLevel`'s, shared.
 */
export function forgeCost(form: FormId, motif: MotifId, itemLevel?: number): ResourceCost {
  const spec = FORMS[form];
  const rarity = MOTIF_RARITY[motif];
  // At the level the craft lands on, the same share of the price as of the
  // stats — so a heavier sword costs more iron the way a heavier sword is more
  // sword. Omitted, the anchor: scale 1, the catalogue's own recipe.
  const scale = itemLevel === undefined ? 1 : itemLevelScale(acquisitionLevel(rarity, itemLevel), rarity);
  const points = itemBudget(spec) * RARITY_SCALE[rarity] * scale;
  const material = primaryMaterial(form);

  const rate = BALANCE.FORGE_COST;
  const cost: ResourceCost = {
    [ResourceType.Gold]: Math.max(1, Math.round(points * rate.goldPerPoint)),
    [material]: Math.max(1, Math.round(points * materialRate(material))),
  };

  if (MOTIFS[motif].elemental) {
    cost[ResourceType.Crystal] =
      (cost[ResourceType.Crystal] ?? 0) + Math.max(1, Math.round(points * rate.elementalCrystalPerPoint));
  }

  return cost;
}

/**
 * The template a form × motif craft produces, if that combination exists — in
 * the named silhouette asked for, or the form's base one. The silhouette is the
 * smith's choice and costs nothing: every variant of a form is the same recipe.
 */
export function forgeTemplate(form: FormId, motif: MotifId, variant?: ModelVariantId): ItemTemplate | undefined {
  return itemTemplates.find((t) => t.id === generatedItemId(form, motif, variant));
}

/** Motifs a given forge level can apply to a form, weakest first. */
export function forgeableMotifs(
  form: FormId,
  forgeLevel: number,
  availableMasteries: MasteryId[] = [],
  patterns: readonly MotifId[] = [],
): MotifId[] {
  const candidates = [...FORMS[form].motifs, ...masterySetMotifsFor(form), ...worldMotifsFor(form)];
  return candidates.filter((m) => canForge(form, m, forgeLevel, availableMasteries, patterns));
}

/**
 * The world patterns a form still waits on: its world motifs no piece the party
 * has held taught, in the worlds the game has fights in (`WORLD_IDS`,
 * `WorldDef.content.encounters`). A world's gear built ahead of its fights —
 * the archipelago's collections, on a map with no factions yet — has nothing
 * to find a pattern in, so it is not counted.
 */
export function patternsToFind(form: FormId, patterns: readonly MotifId[]): MotifId[] {
  return worldMotifsFor(form).filter((m) => !patterns.includes(m)
    && WORLD_IDS.some((w) => w === motifWorld(m) && worldDef(w).content.encounters));
}

/**
 * The Spirit Ink a craft costs on top of `forgeCost`: nothing for the Empire's
 * motifs, and for a world's its budget at `SPIRIT_INK.FORGE_PER_POINT` of its
 * rarity — a Jade Bastion cuirass about nine, a Spiritsealed one three, a Votive
 * one one. Not levelled: Ink is the gate, not the price of the stats.
 */
export function inkCost(form: FormId, motif: MotifId): number {
  if (!motifWorld(motif)) return 0;
  const rarity = MOTIF_RARITY[motif];
  const rate = BALANCE.SPIRIT_INK.FORGE_PER_POINT;
  const perPoint = rarity === Rarity.Legendary ? rate.legendary : rarity === Rarity.Epic ? rate.epic : rate.rare;
  return Math.max(1, Math.round(itemBudget(FORMS[form]) * RARITY_SCALE[rarity] * perPoint));
}

/** Every form that has a piece in this path's set, for a "craft my set" view. */
export function masterySetForms(mastery: MasteryId): FormId[] {
  return setFormsOf(mastery);
}

// ─── Rerolling a set piece's skill bonus ─────────────────────────────────────

/** What the bench charges to re-aim one set piece. */
export function setBonusRerollCost(): ResourceCost {
  return {
    [ResourceType.Gold]: BALANCE.SET_BONUS_REROLL_COST.gold,
    [ResourceType.Crystal]: BALANCE.SET_BONUS_REROLL_COST.crystal,
  };
}

/**
 * Whether this bench can reroll this piece right now.
 *
 * Two questions and both have to hold: the forge is the top rung, and the item
 * is a set piece whose pool holds more than the skill it already names — a
 * reroll that can only return what you started with is a price with no product.
 */
export function canRerollHere(
  item: Pick<Item, 'rarity' | 'masteryLock' | 'motif' | 'setBonus'>,
  forgeLevel: number,
): boolean {
  return forgeLevel >= MASTERY_SET_FORGE_LEVEL && canRerollSetBonus(item);
}

// ─── Raising an ordinary piece's item level ─────────────────────────────────

/**
 * The highest level the forge will raise a piece to: the party's highest hero.
 *
 * The strongest hero rather than the mean the craft uses, because an upgrade is
 * asked about one piece for one wearer — a mean would refuse to bring the
 * frontliner's sword up to the frontliner.
 */
export function levelUpgradeCap(heroLevels: number[]): number {
  return heroLevels.length === 0 ? 1 : Math.max(...heroLevels);
}

/** Whether two modifier sets differ in any stat. */
function statsDiffer(a: ItemModifiers, b: ItemModifiers): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ItemModifiers>;
  for (const key of keys) if ((a[key] ?? 0) !== (b[key] ?? 0)) return true;
  return false;
}

/**
 * The next level at which this piece's stats actually move, at or under `cap` —
 * or `null` when there is none.
 *
 * `levelledModifiers` rounds per stat, so the curve is a staircase and a single
 * level is often a plateau. A purchase that lands on one takes the gold and
 * changes nothing on the sheet, which reads as the forge being broken; so the
 * purchase is always to the *next step*, however many levels away it is.
 * Legendaries are refused: their levels are the Obsidian Crystal track, a
 * separate action on a separate currency.
 */
export function nextStatLevel(item: Item, cap: number): number | null {
  if (isLegendaryGrade(item.rarity) || !findTemplate(item.templateId)) return null;
  const ceiling = Math.min(cap, maxItemLevel(item.rarity));
  for (let level = item.itemLevel + 1; level <= ceiling; level++) {
    if (statsDiffer(itemAtLevel(item, level).modifiers, item.modifiers)) return level;
  }
  return null;
}

/**
 * The piece raised to `level`. Everything but the level, the modifiers and the
 * sell price is carried over by `itemAtLevel`: affixes, sockets and the gems in
 * them, the set bonus and the id a hero's equipment points at.
 */
export function levelUpgraded(item: Item, level: number): Item {
  return itemAtLevel(item, level);
}

/**
 * What raising `item` to `level` costs: the budget the climb adds, priced at the
 * craft's own rate times `ITEM_LEVEL_UPGRADE.premium`, in gold and the form's
 * own material.
 */
export function levelUpgradeCost(item: Item, level: number): ResourceCost {
  const spec = BALANCE.ITEM_LEVEL_UPGRADE;
  const gained = itemLevelScale(level, item.rarity) - itemLevelScale(item.itemLevel, item.rarity);
  const points = itemBudget(item) * RARITY_SCALE[item.rarity] * Math.max(0, gained) * spec.premium;
  const material = primaryMaterial(item.form);
  return {
    [ResourceType.Gold]: Math.max(spec.minGold, Math.round(points * BALANCE.FORGE_COST.goldPerPoint)),
    [material]: Math.max(spec.minMaterial, Math.round(points * materialRate(material))),
  };
}

// ─── Rerolling one affix ─────────────────────────────────────────────────────

/**
 * What the affix `affixId` on `item` could become: every affix of the same kind
 * the piece could legally have rolled at mint, less the one it holds.
 *
 * Read off `affixPool`, the pool `rollAffixes` itself draws from — so the class
 * affinity and the rarity floor that keep a mint from rolling a dead affix keep
 * a reroll from rolling one too. A rare's lone suffix stays a suffix: a reroll
 * that could turn it into a prefix would change what the name has room for.
 */
export function affixRerollOptions(item: Item, affixId: AffixId): AffixSpec[] {
  const spec = findAffix(affixId);
  if (!spec || !(item.affixes ?? []).includes(affixId)) return [];
  if (item.rarity !== Rarity.Rare && item.rarity !== Rarity.Epic) return [];
  if (!findTemplate(item.templateId)) return [];
  return affixPool(item, spec.kind).filter((a) => a.id !== affixId);
}

/**
 * What one affix gives *this piece*: the piece's modifiers with it on, minus the
 * piece's modifiers without it.
 *
 * Both sides come from `itemWithAffixes` — the same derivation the reroll itself
 * and the item tooltip run, at the piece's own level and rarity — so the number
 * on the bench is the number the piece carries afterwards. The two affixes on an
 * epic interact through the shared rounding, which is why this is a difference of
 * whole pieces rather than a table lookup of the affix's tilt.
 */
export function affixContribution(item: Item, affixes: AffixId[], affixId: AffixId): ItemModifiers {
  const withIt = itemWithAffixes(item, affixes).modifiers;
  const without = itemWithAffixes(item, affixes.filter((id) => id !== affixId)).modifiers;
  const out: ItemModifiers = {};
  for (const key of new Set([...Object.keys(withIt), ...Object.keys(without)]) as Set<keyof ItemModifiers>) {
    const gain = (withIt[key] ?? 0) - (without[key] ?? 0);
    if (gain) out[key] = gain;
  }
  return out;
}

/** The current affix's gain on this piece, and each candidate's, were it swapped in. */
export function affixRerollPreview(
  item: Item,
  affixId: AffixId,
): { current: ItemModifiers; options: { spec: AffixSpec; gain: ItemModifiers }[] } {
  const affixes = item.affixes ?? [];
  return {
    current: affixContribution(item, affixes, affixId),
    options: affixRerollOptions(item, affixId).map((spec) => ({
      spec,
      gain: affixContribution(
        item,
        affixes.map((id) => (id === affixId ? spec.id : id)),
        spec.id,
      ),
    })),
  };
}

export function canRerollAffix(item: Item, affixId: AffixId): boolean {
  return affixRerollOptions(item, affixId).length > 0;
}

/**
 * The piece with `affixId` replaced by a different one of its kind, rolled from
 * `affixRerollOptions`. Never returns the affix it started with: a price with
 * no product reads as the bench being broken rather than the dice being unkind.
 * Returns the item itself when there is nothing to reroll to.
 */
export function rerolledAffix(item: Item, affixId: AffixId, rng: () => number = Math.random): Item {
  const options = affixRerollOptions(item, affixId);
  if (options.length === 0) return item;
  const pick = options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
  const affixes = (item.affixes ?? []).map((id) => (id === affixId ? pick.id : id));
  return itemWithAffixes(item, affixes);
}

/** Gold to reroll one affix, following the piece along the item-level curve. */
export function affixRerollCost(item: Pick<Item, 'rarity' | 'itemLevel'>): ResourceCost {
  const base = item.rarity === Rarity.Epic ? BALANCE.AFFIX_REROLL_GOLD.epic : BALANCE.AFFIX_REROLL_GOLD.rare;
  return { [ResourceType.Gold]: Math.max(1, Math.round(base * itemLevelScale(item.itemLevel, item.rarity))) };
}

// ─── Previews ────────────────────────────────────────────────────────────────

/**
 * The purse after paying `cost`, for every resource the cost names — the
 * "gold 340 → 290" half of a forge preview. `null` when the purse cannot cover
 * it, which is the one answer a disabled button and its message share.
 */
export function balanceAfter(
  resources: Partial<Record<ResourceType, number>>,
  cost: ResourceCost,
): Partial<Record<ResourceType, number>> | null {
  const after: Partial<Record<ResourceType, number>> = {};
  for (const [type, amount] of Object.entries(cost) as [ResourceType, number][]) {
    const left = (resources[type] ?? 0) - amount;
    if (left < 0) return null;
    after[type] = left;
  }
  return after;
}
