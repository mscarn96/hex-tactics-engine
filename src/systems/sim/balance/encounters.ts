import { Rarity } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { highestLevelCap } from '@/data/levelCap';
import type { TacticalLevel } from '@/systems/combat/tacticalAI';
import { bandFloor, bandTop } from '@/systems/world/worldBands';

/**
 * The encounters the simulator plays and the budget a random party is rolled
 * within for each. Every number is a starting point the setup screen edits, not
 * a balance claim (the private project notes, "Encounters and budgets").
 */

export type EncounterId = 'troll' | 'dragon' | 'heart' | 'castle' | 'pvp' | 'jorogumo' | 'last_lesson' | 'kairen';

/** Every encounter. New ones go at the end: a fight's seed is its encounter's place in the run's list. */
export const ENCOUNTER_IDS: readonly EncounterId[] = ['troll', 'dragon', 'heart', 'castle', 'pvp', 'jorogumo', 'last_lesson', 'kairen'];

/** What a run plays when its config names no encounters: the Empire and PvP. Jadeveil's bosses are named. */
export const STANDARD_RUN_IDS: readonly EncounterId[] = ['troll', 'dragon', 'heart', 'castle', 'pvp'];

/** The encounters that stand in an expansion world, and so always at a level band. */
export const BANDED_ENCOUNTER_IDS: readonly EncounterId[] = ['jorogumo', 'last_lesson', 'kairen'];

/** Who plays both PvP parties: the ordinary brain, or the tactical AI at a level. */
export type PvpAi = 'brain' | TacticalLevel;
export const PVP_AIS: readonly PvpAi[] = ['brain', 'easy', 'normal', 'hard'];

/** An inclusive whole-number range. */
export interface Range {
  min: number;
  max: number;
}

/** The average item level of a rarity and how far a single piece may stray from it. */
export interface ItemLevelSpec {
  avg: number;
  spread: number;
}

export type RolledRarity = Rarity.Legendary | Rarity.Epic | Rarity.Rare;

export interface EncounterSpec {
  id: EncounterId;
  /**
   * The level band the fight stands at: 0 for the Empire, 1–4 beyond it. It sets the budget's defaults
   * (`bandSpec`), the highest hero level and the legendary clamp, and the campaign state the fight is played in
   * (`bandRoad`), with the cap at this band's top. Absent reads as 0.
   */
  band?: number;
  /**
   * Kairen's Storm Seal tiers only: the band of the world he stands in, when it is older than the cap. A band-1
   * world at cap 30 is `band: 2, worldBand: 1`. Absent, the world took `band`.
   */
  worldBand?: number;
  /** Heroes in the party. */
  heroes: Range;
  /** The levels of all heroes added together; split at random across them. */
  levelSum: Range;
  /** The highest hero level this budget may roll; `BALANCE_LEVEL_CAP` when absent. Save Creator's later world orders set it. */
  levelCap?: number;
  /** How many pieces of each rarity the whole party wears; every other slot is common. */
  legendary: Range;
  epic: Range;
  rare: Range;
  itemLevels: Record<Rarity, ItemLevelSpec>;
  /**
   * The party size the level sum and the rarity counts are written for. Absent, they are the whole
   * party's whatever its size. Set, a party of another size has them scaled by its hero count over this
   * one (`budgetAt`), so a pair and a party of four are levelled and dressed alike hero for hero: what
   * fielding one boss at several party sizes needs (the tactics dividend, a private tool).
   */
  budgetHeroes?: number;
  /** The castle, the Heart and Kairen: the Seal tier the chain, the Heart's refight or the summit is fought at. */
  tier?: number;
  /**
   * Castle only: the stage the chain opens at (0, the Gate, when absent). 3 fields Aethelred alone, with the
   * heroes fresh, which is how his fight is measured at a band whose garrison stops nearly every party before
   * him (the boss feel pass, a private tool).
   */
  castleFrom?: number;
  /**
   * Castle only: the phase (0-based) Aethelred opens in, at that phase's health ceiling (`runEmperor`'s
   * `startPhase`), so a move of his last phase is measured on more than the few parties that reach it.
   */
  emperorPhase?: number;
  /**
   * PvP only: who plays both parties. The second party is rolled in the same budget as the first, from
   * the fight's own seed (`pvpRival`), and the fight is recorded from each (`runPvpPair`).
   */
  pvpAi?: PvpAi;
  /**
   * Boss and castle fights: who plays the party's heroes. Left out, the scripted `partyPolicy` does; `brain`
   * is the same policy, and a level names the tactical AI.
   */
  partyAi?: PvpAi;
}

const levels = (common: number, rare: number, epic: number, legendary: number, spread = 1): Record<Rarity, ItemLevelSpec> => ({
  [Rarity.Common]: { avg: common, spread },
  [Rarity.Rare]: { avg: rare, spread },
  [Rarity.Epic]: { avg: epic, spread },
  [Rarity.Legendary]: { avg: legendary, spread },
  [Rarity.Mythic]: { avg: legendary, spread },
});

export const BAND_IDS: readonly number[] = Array.from({ length: BALANCE.MAX_WORLD_CROSSINGS }, (_, i) => i + 1);

/** The budget a band's entry says, `data/balanceLabDefaults.json`'s `bands` or the built-in `bandBudget`. */
export type BandBudget = Pick<EncounterSpec, 'heroes' | 'levelSum' | 'legendary' | 'epic' | 'rare' | 'itemLevels' | 'budgetHeroes'>;

/** A band's entry as a file says it: any of a budget's fields, and the rarities it rolls (a party rolls no mythic). */
export type SavedBandBudget = Partial<Omit<BandBudget, 'itemLevels'>> & { itemLevels?: Partial<Record<Rarity, ItemLevelSpec>> };

/** Pieces of a party of four at a band's start: a quarter legendary (`BAND_GEAR_LEGENDARY_SHARE`), epics the most of the rest. */
const BAND_PIECES = { legendary: { min: 8, max: 10 }, epic: { min: 12, max: 16 }, rare: { min: 6, max: 10 } };
/** A legendary a party carries into a band: the previous band's top, plus the Crystals it has taken. */
const BAND_LEGENDARY_CRYSTALS = 2;

/**
 * The party that starts a band: four heroes who have just reached it, from the previous cap to its floor; commons to
 * epics found near the band's floor; and legendaries from the previous band's top, with some Crystals on them.
 * Starting values, as every budget here is (`data/balanceLabDefaults.json` saves the ones in use).
 */
export function bandBudget(band: number): BandBudget {
  const floor = bandFloor(band);
  return {
    heroes: { min: BALANCE.MAX_PARTY_SIZE, max: BALANCE.MAX_PARTY_SIZE },
    levelSum: { min: BALANCE.MAX_PARTY_SIZE * (floor - 1), max: BALANCE.MAX_PARTY_SIZE * floor },
    legendary: { ...BAND_PIECES.legendary },
    epic: { ...BAND_PIECES.epic },
    rare: { ...BAND_PIECES.rare },
    itemLevels: levels(floor - 3, floor - 2, floor - 1, bandTop(band - 1) + BAND_LEGENDARY_CRYSTALS, 2),
    budgetHeroes: BALANCE.MAX_PARTY_SIZE,
  };
}

/** Kairen's first tier is the story fight; Jadeveil's lairs have no tier. */
const bandedSpec = (id: EncounterId, band: number, tier?: number): EncounterSpec => ({
  id, band, ...bandBudget(band), ...(tier !== undefined && { tier }),
});

export const DEFAULT_ENCOUNTERS: Record<EncounterId, EncounterSpec> = {
  jorogumo: bandedSpec('jorogumo', 1),
  last_lesson: bandedSpec('last_lesson', 1),
  kairen: bandedSpec('kairen', 1, 1),
  troll: {
    id: 'troll',
    heroes: { min: 2, max: 2 },
    levelSum: { min: 18, max: 24 },
    legendary: { min: 1, max: 1 },
    epic: { min: 2, max: 3 },
    rare: { min: 4, max: 5 },
    itemLevels: levels(6, 9, 12, BALANCE.MAX_LEVEL),
  },
  dragon: {
    id: 'dragon',
    heroes: { min: 2, max: 3 },
    levelSum: { min: 26, max: 36 },
    legendary: { min: 1, max: 2 },
    epic: { min: 3, max: 4 },
    rare: { min: 4, max: 6 },
    itemLevels: levels(9, 12, 15, BALANCE.MAX_LEVEL),
  },
  heart: {
    id: 'heart',
    heroes: { min: 3, max: 4 },
    levelSum: { min: 40, max: 52 },
    legendary: { min: 2, max: 2 },
    epic: { min: 4, max: 6 },
    rare: { min: 5, max: 7 },
    itemLevels: levels(12, 15, 17, BALANCE.MAX_LEVEL + 1),
    // Tier 1 is the lair's own fight; above it the Winter Seal refight, priced and twisted as the game does
    tier: 1,
  },
  castle: {
    id: 'castle',
    heroes: { min: 4, max: 4 },
    levelSum: { min: 64, max: 80 },
    legendary: { min: 3, max: 4 },
    epic: { min: 8, max: 12 },
    rare: { min: 8, max: 12 },
    itemLevels: levels(15, 18, 20, BALANCE.MAX_LEVEL + 2),
    tier: 1,
  },
  // The Dragon's budget, both parties on the tactical AI's normal level
  pvp: {
    id: 'pvp',
    heroes: { min: 3, max: 3 },
    levelSum: { min: 26, max: 36 },
    legendary: { min: 1, max: 2 },
    epic: { min: 3, max: 4 },
    rare: { min: 4, max: 6 },
    itemLevels: levels(9, 12, 15, BALANCE.MAX_LEVEL),
    pvpAi: 'normal',
  },
};

/** A copy of the defaults, safe to edit. */
export function defaultSpec(id: EncounterId): EncounterSpec {
  const base = DEFAULT_ENCOUNTERS[id];
  return {
    ...base,
    heroes: { ...base.heroes },
    levelSum: { ...base.levelSum },
    legendary: { ...base.legendary },
    epic: { ...base.epic },
    rare: { ...base.rare },
    itemLevels: Object.fromEntries(
      Object.entries(base.itemLevels).map(([k, v]) => [k, { ...v }]),
    ) as Record<Rarity, ItemLevelSpec>,
  };
}

/** The budget a party of one size is rolled within: its level sum and rarity counts. */
export type PartyBudget = Pick<EncounterSpec, 'levelSum' | 'legendary' | 'epic' | 'rare'>;

/**
 * The level sum and rarity counts for a party of `count` heroes: the spec's own, or, when it names the
 * party size they are written for (`budgetHeroes`), each end of each range scaled by `count` over that
 * size and rounded.
 */
export function budgetAt(spec: EncounterSpec, count: number): PartyBudget {
  const base = spec.budgetHeroes;
  if (!base || base === count) return { levelSum: spec.levelSum, legendary: spec.legendary, epic: spec.epic, rare: spec.rare };
  const scaled = (r: Range): Range => ({ min: Math.round((r.min * count) / base), max: Math.round((r.max * count) / base) });
  return { levelSum: scaled(spec.levelSum), legendary: scaled(spec.legendary), epic: scaled(spec.epic), rare: scaled(spec.rare) };
}

/**
 * An encounter's defaults at a band: the encounter's own at band 0, else the band's budget (`saved`, from a
 * config's `bands`, over the built-in one), keeping what the encounter is rather than what it wears.
 */
export function bandSpec(id: EncounterId, band: number, saved?: SavedBandBudget): EncounterSpec {
  const base = defaultSpec(id);
  if (band === 0) return { ...base, band: 0 };
  const built = bandBudget(band);
  const budget = { ...built, ...saved, itemLevels: { ...built.itemLevels, ...saved?.itemLevels } };
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  return { ...base, ...copy(budget), band };
}

/** The highest level a rolled hero can be anywhere: the highest cap any campaign can reach (40). */
export const BALANCE_LEVEL_CAP = highestLevelCap();

/** The highest level a hero of this budget rolls: its own `levelCap`, else its band's top, else the Empire's cap. */
export const heroLevelCap = (spec: Pick<EncounterSpec, 'band' | 'levelCap'>): number =>
  spec.levelCap ?? (spec.band ? bandTop(spec.band) : BALANCE.MAX_LEVEL);

/**
 * A legendary's level at a band: from the previous band's top, where the party's own were minted (a legendary
 * mints at its source's ceiling), to this band's top plus every Crystal, which is what the cap in force lets one reach. At
 * band 0 that is 20–25, the Empire's.
 */
export function legendaryClamp(band: number): Range {
  const top = bandTop(band);
  return { min: band > 0 ? bandTop(band - 1) : BALANCE.MAX_LEVEL, max: top + BALANCE.MAX_UPGRADE_LEVEL };
}
