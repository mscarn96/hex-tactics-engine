import type { CollectionId, Hero, HeroStats, Item, ItemModifiers, MasteryId, MasteryModifier, SkillId } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { COLLECTION_IDS, isCollectionMotif } from '@/data/items/collections';
import { isLegendaryGrade, setPieceWeight } from '@/data/items/rarity';
import { matchingSetPieces } from '@/systems/progression/achievementEquipment';

/**
 * What wearing several pieces of one legendary set is worth.
 *
 * Three pieces of a mastery set give a plain stat bonus, five add a plain number
 * on that path's signature; the two add up. A world collection gives its three-
 * piece bonus only. All of it rides on what already exists — a stat, a mastery
 * modifier, a skill's power — so no combat rule learns a new mechanic, and the
 * +12%-per-piece skill roll (`data/items/setBonus.ts`) is untouched beside it.
 *
 * Pure: the caller hands the hero and the pieces worn. `statCalc` reads the stat
 * half (`effects.stats`, `effects.percent`) and `masteryModifiers` the modifier
 * half, each through the funnel every consumer already uses. Values are
 * `BALANCE.SET_BONUSES`, first estimates to verify in playtest.
 */

/** A three-piece bonus: a plain stat. */
export type ThreeBonus = 'hp' | 'damage' | 'spell' | 'heal' | 'crit' | 'armour';

/** A five-piece bonus: a plain number on the path's signature. */
export type FiveBonus =
  | 'barrier' | 'smite' | 'bleed' | 'burn' | 'brittle' | 'chain' | 'lifebloom' | 'form'
  | 'marked' | 'bladeRecall' | 'poison' | 'carapace' | 'glowmote' | 'reap';

export type SetTier = 3 | 5;

/** The set a hero can complete: a path's own, or a collection of the weight they wear. */
export type SetId = MasteryId | CollectionId;

export const THREE_BONUS: Record<SetId, ThreeBonus> = {
  bulwark: 'hp', templar: 'hp', berserker: 'damage',
  pyromancer: 'spell', hydromancer: 'spell', stormcaller: 'spell',
  lifewarden: 'heal', stoneshaper: 'hp', wildshape: 'hp',
  marksman: 'crit', skirmisher: 'crit', shadowblade: 'crit',
  beetle: 'hp', firefly: 'heal', mantis: 'crit',
  jade_bastion: 'armour', canopy_strider: 'crit', cloud_script: 'spell', monastery_oath: 'heal',
  ironclad_admiral: 'hp', saltrunner: 'crit', stormglass: 'spell', shellwoven: 'heal',
};

export const FIVE_BONUS: Record<MasteryId, FiveBonus> = {
  bulwark: 'barrier', templar: 'smite', berserker: 'bleed',
  pyromancer: 'burn', hydromancer: 'brittle', stormcaller: 'chain',
  lifewarden: 'lifebloom', stoneshaper: 'barrier', wildshape: 'form',
  marksman: 'marked', skirmisher: 'bladeRecall', shadowblade: 'poison',
  beetle: 'carapace', firefly: 'glowmote', mantis: 'reap',
};

/** The number each bonus carries, from `BALANCE.SET_BONUSES`. */
export function threeValue(bonus: ThreeBonus): number {
  return BALANCE.SET_BONUSES.THREE[bonus];
}
export function fiveValue(bonus: FiveBonus): number {
  return BALANCE.SET_BONUSES.FIVE[bonus];
}

/** The skills a five-piece bonus names, where it is a skill's own power. */
const FIVE_SKILL: Partial<Record<FiveBonus, SkillId>> = {
  smite: 'smite', bladeRecall: 'blade_recall', glowmote: 'glowmote',
};

/** What a set of bonuses does to a hero, in the three places it can land. */
export interface SetBonusEffects {
  /** Flat stat additions, folded in like a worn item's modifiers. */
  stats: ItemModifiers;
  /** Fractions of attack, magic and defence, applied after gear. */
  percent: Partial<Record<'attack' | 'magic' | 'defense', number>>;
  /** Mastery modifiers, merged beside the nodes' (`masteryModifiers`). */
  modifier: MasteryModifier;
}

const empty = (): SetBonusEffects => ({ stats: {}, percent: {}, modifier: {} });

function addThree(into: SetBonusEffects, bonus: ThreeBonus): void {
  const value = threeValue(bonus);
  switch (bonus) {
    case 'hp': into.modifier.maxHpPercentBonus = (into.modifier.maxHpPercentBonus ?? 0) + value; break;
    case 'damage': into.percent.attack = (into.percent.attack ?? 0) + value; break;
    case 'spell': into.percent.magic = (into.percent.magic ?? 0) + value; break;
    case 'armour': into.percent.defense = (into.percent.defense ?? 0) + value; break;
    case 'heal': into.stats.healPower = (into.stats.healPower ?? 0) + value; break;
    case 'crit': into.stats.critChance = (into.stats.critChance ?? 0) + value; break;
  }
}

function addFive(into: SetBonusEffects, bonus: FiveBonus): void {
  const value = fiveValue(bonus);
  const m = into.modifier;
  const skill = FIVE_SKILL[bonus];
  if (skill) {
    m.skillPowerBonus = { ...m.skillPowerBonus, [skill]: (m.skillPowerBonus?.[skill] ?? 0) + value };
    return;
  }
  switch (bonus) {
    case 'barrier': m.shieldPowerBonus = (m.shieldPowerBonus ?? 0) + value; break;
    case 'bleed': m.bleedMagnitudeBonus = (m.bleedMagnitudeBonus ?? 0) + value; break;
    case 'burn': m.burnMagnitudeBonus = (m.burnMagnitudeBonus ?? 0) + value; break;
    case 'brittle': m.chilledDamageBonus = (m.chilledDamageBonus ?? 0) + value; break;
    case 'chain': m.chainJumpBonus = (m.chainJumpBonus ?? 0) + value; break;
    case 'lifebloom': m.regenMagnitudeBonus = (m.regenMagnitudeBonus ?? 0) + value; break;
    case 'form': m.formVigorBonus = (m.formVigorBonus ?? 0) + value; break;
    case 'marked': m.markedDamageBonus = (m.markedDamageBonus ?? 0) + value; break;
    case 'carapace': m.carapaceChargeBonus = (m.carapaceChargeBonus ?? 0) + value; break;
    case 'reap': m.bleedingDamageBonus = (m.bleedingDamageBonus ?? 0) + value; break;
    case 'poison': into.stats.poisonPower = (into.stats.poisonPower ?? 0) + value; break;
  }
}

/**
 * How far the hero stands in each world collection: distinct pieces, a worn
 * mythic counting as two (`setPieceWeight`). A template counts once.
 */
export function wornCollectionPieces(hero: Pick<Hero, 'equipment'>, items: readonly Item[]): Partial<Record<CollectionId, number>> {
  const templates = new Map<CollectionId, Map<string, number>>();
  for (const id of Object.values(hero.equipment)) {
    const item = id ? items.find((i) => i.id === id) : undefined;
    if (!item || !isLegendaryGrade(item.rarity) || !isCollectionMotif(item.motif)) continue;
    const set = templates.get(item.motif) ?? new Map<string, number>();
    set.set(item.templateId, Math.max(set.get(item.templateId) ?? 0, setPieceWeight(item)));
    templates.set(item.motif, set);
  }
  const out: Partial<Record<CollectionId, number>> = {};
  for (const collection of COLLECTION_IDS) {
    const pieces = templates.get(collection);
    if (pieces) out[collection] = [...pieces.values()].reduce((sum, weight) => sum + weight, 0);
  }
  return out;
}

/** One set's progress for a hero: how many pieces, and which tiers they have reached. */
export interface SetProgress {
  set: SetId;
  count: number;
  active: SetTier[];
}

/** The tiers a set of this kind has: a collection only the three-piece one. */
export const tiersOf = (set: SetId): SetTier[] => (set in FIVE_BONUS ? [3, 5] : [3]);

/**
 * The set a hero is building and how far along, or null when they wear none: the
 * hero's own path first (its pieces are `masteryLock`ed to it), else the
 * collection they wear most of. Only legal pieces count (`matchingSetPieces`), and
 * `count` is the bonus count, so a worn mythic is two of it.
 */
export function setProgress(hero: Hero, items: readonly Item[]): SetProgress | null {
  const own = hero.masteryPath ? matchingSetPieces(hero, items) : 0;
  const collections = Object.entries(wornCollectionPieces(hero, items)) as [CollectionId, number][];
  const [bestCollection, bestCount] = collections.sort((a, b) => b[1] - a[1])[0] ?? [undefined, 0];
  if (own > 0 && own >= bestCount && hero.masteryPath) {
    return { set: hero.masteryPath, count: own, active: tiersOf(hero.masteryPath).filter((t) => own >= t) };
  }
  if (bestCollection && bestCount > 0) {
    return { set: bestCollection, count: bestCount, active: tiersOf(bestCollection).filter((t) => bestCount >= t) };
  }
  return null;
}

/** The effects of every bonus a hero's worn pieces have reached; empty when none. */
export function setBonusEffects(hero: Hero, items: readonly Item[]): SetBonusEffects {
  const effects = empty();
  const progress = setProgress(hero, items);
  if (!progress) return effects;
  if (progress.active.includes(3)) addThree(effects, THREE_BONUS[progress.set]);
  if (progress.active.includes(5) && progress.set in FIVE_BONUS) addFive(effects, FIVE_BONUS[progress.set as MasteryId]);
  return effects;
}

/** Applies the percentage half to a sheet already carrying its gear. */
export function applySetPercent(base: HeroStats, percent: SetBonusEffects['percent']): void {
  for (const key of ['attack', 'magic', 'defense'] as const) {
    const fraction = percent[key];
    if (fraction) base[key] = Math.round(base[key] * (1 + fraction));
  }
}
