import { Rarity } from '@/models/types';
import { ConstraintProblem, checkConstraints, PartyConstraints, rollParty } from './partyRoll';
import { BANDED_ENCOUNTER_IDS, BAND_IDS, bandSpec, DEFAULT_ENCOUNTERS, EncounterId, EncounterSpec, ENCOUNTER_IDS, ItemLevelSpec, Range, PvpAi, PVP_AIS, SavedBandBudget, STANDARD_RUN_IDS } from './encounters';
import { pvpRival, runBalanceFight, runPvpPair } from './fight';
import { FightRecord, partyFromRecord, PartyRecord } from './record';
import { fightSeed, partyRng } from './rng';
import { DEFAULT_WEIGHTS, ScoreWeights } from './scoring';
import { CASTLE_STAGES } from '@/systems/world/castle';
import { AETHELRED_PHASES } from '@/data/templates/aethelred';

/**
 * A run, as data: what to play, in which order, and how to play one fight.
 *
 * Pure (no `worker_threads`, no files), so the pool, the command line and the
 * web app all share one definition and Jest can pin it. The Node side lives in
 * `scripts/balance/`.
 */

export interface RunEncounter {
  spec: EncounterSpec;
  /** Fights to play. */
  runs: number;
}

export interface RunConfig {
  baseSeed: number;
  encounters: RunEncounter[];
  /** The dodging party (default) or the plain AI party. */
  responds: boolean;
  constraints: PartyConstraints;
  weights: ScoreWeights;
  /** Worker count; absent, one per core but one. */
  workers?: number;
  /** Fights per chunk handed to a worker. */
  chunk: number;
}

export const DEFAULT_CHUNK = 50;
export const DEFAULT_RUNS = 1000;

/** What a config file may say: encounters by id, or with budget overrides. */
export interface RawEncounter {
  id: EncounterId;
  runs?: number;
  /** The level band: 0 for the Empire, 1–4 beyond it. Sets the defaults every field below overrides. */
  band?: number;
  /** Kairen's Storm Seal tiers: the band of the world he stands in, when it is older than the cap. */
  worldBand?: number;
  heroes?: Partial<Range>;
  levelSum?: Partial<Range>;
  legendary?: Partial<Range>;
  epic?: Partial<Range>;
  rare?: Partial<Range>;
  itemLevels?: Partial<Record<Rarity, Partial<ItemLevelSpec>>>;
  /** The party size the level sum and rarity counts are written for; other sizes scale them (`budgetAt`). */
  budgetHeroes?: number;
  tier?: number;
  castleFrom?: number;
  emperorPhase?: number;
  pvpAi?: PvpAi;
  partyAi?: PvpAi;
}

export interface RawRunConfig {
  baseSeed?: number;
  encounters?: (EncounterId | RawEncounter)[];
  /** Each band's saved budget, the defaults a banded encounter takes (`data/balanceLabDefaults.json`). */
  bands?: Record<string, SavedBandBudget>;
  runs?: number;
  responds?: boolean;
  constraints?: PartyConstraints;
  weights?: Partial<ScoreWeights>;
  workers?: number;
  chunk?: number;
}

const range = (base: Range, over?: Partial<Range>): Range => ({ min: over?.min ?? base.min, max: over?.max ?? base.max });

/** Fills a config file out with the defaults, and refuses what cannot be played. */
export function normalizeConfig(raw: RawRunConfig = {}): RunConfig {
  const entries = (raw.encounters?.length ? raw.encounters : [...STANDARD_RUN_IDS]).map((e) => (typeof e === 'string' ? { id: e } as RawEncounter : e));
  const encounters = entries.map((entry): RunEncounter => {
    if (!ENCOUNTER_IDS.includes(entry.id)) throw new Error(`unknown encounter "${entry.id}"`);
    const band = entry.band ?? DEFAULT_ENCOUNTERS[entry.id].band ?? 0;
    const banded = BANDED_ENCOUNTER_IDS.includes(entry.id);
    // PvP can field any band's parties; an Empire boss has no band, and a boss of a world always has one
    const standsThere = banded ? BAND_IDS.includes(band) : band === 0 || (entry.id === 'pvp' && BAND_IDS.includes(band));
    if (!standsThere) {
      throw new Error(`${entry.id}: it cannot stand at band ${band}`);
    }
    if (entry.worldBand !== undefined && (entry.id !== 'kairen' || !BAND_IDS.includes(entry.worldBand) || entry.worldBand > band)) {
      throw new Error(`${entry.id}: worldBand is Kairen's, and a world no newer than the band of the cap`);
    }
    const base = bandSpec(entry.id, band, raw.bands?.[String(band)]);
    const spec: EncounterSpec = {
      ...base,
      ...(entry.worldBand !== undefined && { worldBand: entry.worldBand }),
      heroes: range(base.heroes, entry.heroes),
      levelSum: range(base.levelSum, entry.levelSum),
      legendary: range(base.legendary, entry.legendary),
      epic: range(base.epic, entry.epic),
      rare: range(base.rare, entry.rare),
      itemLevels: Object.fromEntries(
        (Object.keys(base.itemLevels) as Rarity[]).map((r) => [r, { ...base.itemLevels[r], ...entry.itemLevels?.[r] }]),
      ) as EncounterSpec['itemLevels'],
      ...(entry.budgetHeroes !== undefined && { budgetHeroes: entry.budgetHeroes }),
      ...(base.tier !== undefined && { tier: entry.tier ?? base.tier }),
      ...(entry.id === 'castle' && entry.castleFrom !== undefined && { castleFrom: entry.castleFrom }),
      ...(entry.id === 'castle' && entry.emperorPhase !== undefined && { emperorPhase: entry.emperorPhase }),
      ...(base.pvpAi !== undefined && { pvpAi: entry.pvpAi ?? base.pvpAi }),
      ...(entry.partyAi !== undefined && { partyAi: entry.partyAi }),
    };
    if (entry.id === 'kairen' && (!Number.isInteger(spec.tier) || spec.tier! < 1 || spec.tier! > 5)) throw new Error(`${entry.id}: tier must be 1 to 5`);
    if (spec.pvpAi !== undefined && !PVP_AIS.includes(spec.pvpAi)) throw new Error(`${entry.id}: unknown PvP AI "${spec.pvpAi}"`);
    if (spec.partyAi !== undefined && !PVP_AIS.includes(spec.partyAi)) throw new Error(`${entry.id}: unknown party AI "${spec.partyAi}"`);
    for (const r of [spec.heroes, spec.levelSum, spec.legendary, spec.epic, spec.rare]) {
      if (r.min < 0 || r.max < r.min) throw new Error(`${entry.id}: a range runs from ${r.min} to ${r.max}`);
    }
    if (spec.castleFrom !== undefined && (!Number.isInteger(spec.castleFrom) || spec.castleFrom < 0 || spec.castleFrom >= CASTLE_STAGES.length)) {
      throw new Error(`${entry.id}: castleFrom must name a castle stage, 0 to ${CASTLE_STAGES.length - 1}`);
    }
    if (spec.emperorPhase !== undefined && (!Number.isInteger(spec.emperorPhase) || spec.emperorPhase < 0 || spec.emperorPhase >= AETHELRED_PHASES.length)) {
      throw new Error(`${entry.id}: emperorPhase must name one of his phases, 0 to ${AETHELRED_PHASES.length - 1}`);
    }
    if (spec.budgetHeroes !== undefined && (!Number.isInteger(spec.budgetHeroes) || spec.budgetHeroes < 1)) {
      throw new Error(`${entry.id}: budgetHeroes must be a whole number of at least 1`);
    }
    const runs = entry.runs ?? raw.runs ?? DEFAULT_RUNS;
    if (!Number.isInteger(runs) || runs < 1) throw new Error(`${entry.id}: runs must be a whole number of at least 1`);
    return { spec, runs };
  });
  if (new Set(encounters.map((e) => e.spec.id)).size !== encounters.length) throw new Error('an encounter is listed twice');

  return {
    baseSeed: raw.baseSeed ?? 1,
    encounters,
    responds: raw.responds ?? true,
    constraints: raw.constraints ?? {},
    weights: { ...DEFAULT_WEIGHTS, ...raw.weights },
    ...(raw.workers !== undefined && { workers: raw.workers }),
    chunk: raw.chunk ?? DEFAULT_CHUNK,
  };
}

/** Constraints no party can meet, per encounter — reported before a run starts. */
export function checkRun(config: RunConfig): { encounter: EncounterId; problems: ConstraintProblem[] }[] {
  return config.encounters
    .map((e) => ({ encounter: e.spec.id, problems: checkConstraints(e.spec, config.constraints) }))
    .filter((e) => e.problems.length > 0);
}

export const totalFights = (config: RunConfig): number => config.encounters.reduce((sum, e) => sum + e.runs, 0);

export interface Chunk {
  /** Position in the run: the order chunks are written to disk in. */
  id: number;
  /** Index into `config.encounters`. */
  enc: number;
  /** Fight indexes `from` to `to`, exclusive. */
  from: number;
  to: number;
}

/**
 * The run cut into chunks, interleaved across encounters (chunk 0 of each, then
 * chunk 1 of each…) so progress moves on every encounter at once. The order is
 * the order of `fights.ndjson`, whichever worker finishes first.
 */
export function planChunks(config: RunConfig): Chunk[] {
  const sizes = config.encounters.map((e) => sizeOfChunk(config, e));
  const out: Chunk[] = [];
  const rounds = Math.max(...config.encounters.map((e, enc) => Math.ceil(e.runs / sizes[enc])));
  for (let round = 0; round < rounds; round++) {
    config.encounters.forEach((e, enc) => {
      const from = round * sizes[enc];
      if (from < e.runs) out.push({ id: out.length, enc, from, to: Math.min(e.runs, from + sizes[enc]) });
    });
  }
  return out;
}

/**
 * PvP fights are slow (the tactical AI thinks for both parties), so they go out a few at a time: a
 * run of a few hundred then reaches every worker instead of sitting in one chunk.
 */
export const PVP_CHUNK = 4;

function sizeOfChunk(config: RunConfig, e: RunEncounter): number {
  return Math.max(1, e.spec.id === 'pvp' ? Math.min(config.chunk, PVP_CHUNK) : config.chunk);
}

export const seedOf = (config: RunConfig, enc: number, index: number): number => fightSeed(config.baseSeed, enc, index);

export interface FightError {
  enc: EncounterId;
  index: number;
  seed: number;
  message: string;
}

/**
 * Rolls and plays fight `index` of encounter `enc`: one record, or two for PvP, where both parties
 * stand equal and each has its own (`runPvpPair`).
 */
export function playFight(config: RunConfig, enc: number, index: number): FightRecord[] {
  const { spec } = config.encounters[enc];
  const seed = seedOf(config, enc, index);
  const party = rollParty(spec, config.constraints, partyRng(seed));
  if (spec.id === 'pvp') return runPvpPair(spec, party, pvpRival(spec, seed), seed, { responds: config.responds });
  return [runBalanceFight(spec, party, seed, { responds: config.responds })];
}

/** A chunk of fights; one that throws is reported and skipped rather than ending the run. */
export function playChunk(config: RunConfig, chunk: Chunk): { records: FightRecord[]; errors: FightError[] } {
  const records: FightRecord[] = [];
  const errors: FightError[] = [];
  for (let index = chunk.from; index < chunk.to; index++) {
    try {
      records.push(...playFight(config, chunk.enc, index));
    } catch (error) {
      errors.push({ enc: config.encounters[chunk.enc].spec.id, index, seed: seedOf(config, chunk.enc, index), message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { records, errors };
}

/** Plays a stored fight again from its record and seed, with the turn-by-turn transcript. */
export function replayRecord(config: RunConfig, record: FightRecord): { record: FightRecord; transcript: string[] } {
  const spec = config.encounters.find((e) => e.spec.id === record.enc)?.spec;
  if (!spec) throw new Error(`the run has no ${record.enc} encounter`);
  const transcript: string[] = [];
  const rebuilt = (party: PartyRecord) => ({
    heroes: partyFromRecord(party),
    budget: { legendary: party.bud[0], epic: party.bud[1], rare: party.bud[2] },
    levelSum: party.ls,
  });
  if (record.enc === 'pvp') {
    if (!record.vs) throw new Error('a PvP record without the other party cannot be replayed');
    // The first party is the one the fight was rolled for; this record may be the second's
    const [first, second] = record.sd ? [record.vs, record.party] : [record.party, record.vs];
    const pair = runPvpPair(spec, rebuilt(first), rebuilt(second), record.seed, { responds: record.dg === 1, transcript });
    return { record: pair[record.sd ? 1 : 0], transcript };
  }
  const heroes = partyFromRecord(record.party);
  const replayed = runBalanceFight(
    spec,
    { heroes, budget: { legendary: record.party.bud[0], epic: record.party.bud[1], rare: record.party.bud[2] }, levelSum: record.party.ls },
    record.seed,
    { responds: record.dg === 1, transcript },
  );
  return { record: replayed, transcript };
}
