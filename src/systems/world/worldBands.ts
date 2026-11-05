import { BALANCE } from '@/data/balanceConstants';
import { EXPANSION_WORLD_IDS } from '@/data/worlds';

/**
 * The world band ledger: which expansion world took which level band, and which
 * worlds are finished (the private project notes).
 *
 * A world's first crossing gives it the next band, one more than the number of
 * worlds already banded, and the band never changes. Band 1 is levels 21–25, band 2
 * 26–30, band 3 31–35 and band 4 36–40. A world is finished when its orb boss first
 * falls. Not the same thing as a world's five threat bands (`threat.ts`), near the
 * camp to the far anchor, which stay as they are.
 *
 * Pure, and generic over the world's id, so the suite can run stub worlds in every
 * order. `stores/worldBandStore.ts` holds the campaign's copy.
 */
export interface WorldBands {
  /** Each banded world's level band, from 1. */
  bands: Readonly<Record<string, number>>;
  /** The worlds whose orb boss has fallen once. Each of them has a band. */
  finished: readonly string[];
}

export const NO_WORLD_BANDS: WorldBands = { bands: {}, finished: [] };

/** The lowest hero level of band `n`. */
export function bandFloor(band: number): number {
  return BALANCE.MAX_LEVEL + 1 + BALANCE.EXPANSION_LEVELS * (band - 1);
}

/** The highest hero level of band `n`. */
export function bandTop(band: number): number {
  return BALANCE.MAX_LEVEL + BALANCE.EXPANSION_LEVELS * band;
}

/** The band a hero level falls in. Levels outside the bands read as the nearest. */
export function levelBand(level: number): number {
  const band = Math.ceil((level - BALANCE.MAX_LEVEL) / BALANCE.EXPANSION_LEVELS);
  return Math.min(BALANCE.MAX_WORLD_CROSSINGS, Math.max(1, band));
}

/**
 * What a band's summed-level gates are stated over: a full party at the previous
 * cap, `4 × (band floor − 1)`. A gate of `+ 4` over it means the same thing in any band.
 */
export function bandGateBase(band: number): number {
  return BALANCE.MAX_PARTY_SIZE * (bandFloor(band) - 1);
}

export function bandOf(ledger: WorldBands, world: string): number | null {
  return ledger.bands[world] ?? null;
}

/** The band the next world to be crossed to will take. */
export function nextBand(ledger: WorldBands): number {
  return Object.keys(ledger.bands).length + 1;
}

/** The ledger after a crossing into `world`: a first crossing takes the next band, any other changes nothing. */
export function crossInto(ledger: WorldBands, world: string): WorldBands {
  if (bandOf(ledger, world) !== null) return ledger;
  return { ...ledger, bands: { ...ledger.bands, [world]: nextBand(ledger) } };
}

/** The ledger with `world` finished. A world finished without a crossing on record takes its band first. */
export function markFinished(ledger: WorldBands, world: string): WorldBands {
  if (ledger.finished.includes(world)) return ledger;
  const banded = crossInto(ledger, world);
  return { ...banded, finished: [...banded.finished, world] };
}

/** The banded worlds, in the order they took their bands. */
export function bandedWorlds(ledger: WorldBands): string[] {
  return Object.keys(ledger.bands).sort((a, b) => ledger.bands[a] - ledger.bands[b]);
}

/** Whether a parsed save's ledger can be this campaign's: bands 1…n, each finished world among them. */
export function isWorldBands(value: unknown): value is WorldBands {
  const ledger = value as WorldBands | undefined;
  if (!ledger || typeof ledger.bands !== 'object' || ledger.bands === null || !Array.isArray(ledger.finished)) return false;
  const worlds = Object.keys(ledger.bands);
  if (!worlds.every((id) => EXPANSION_WORLD_IDS.some((world) => world === id))) return false;
  const bands = worlds.map((id) => ledger.bands[id]).sort((a, b) => a - b);
  return bands.every((band, i) => band === i + 1)
    && new Set(ledger.finished).size === ledger.finished.length
    && ledger.finished.every((id) => worlds.includes(id));
}
