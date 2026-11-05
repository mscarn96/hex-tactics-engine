import { BALANCE } from '@/data/balanceConstants';
import { MERCHANT_KINDS, type MerchantKind } from '@/data/merchants';
import { POIType, type HexCoord, type MapTile } from '@/models/types';
import { strHash } from '@/data/display/terrainDisplay';
import { getNeighbors, hexDistance, hexKey } from '@/utils/hexUtils';
import { createRNG } from '@/utils/rng';

/**
 * Travelling merchants: dealt at each new week onto roads the party has seen,
 * then walking the roads and leaving after four days. Design:
 * the private project notes, section 3.
 *
 * **A merchant is stored as where it began and when, and everywhere else it is
 * worked out.** Its position at any hour is a replay of its walk from the
 * start, each step's choice drawn from a stream of its own (`merchantSeed`),
 * so it is deterministic from the world seed and week, costs no write per hour
 * and needs no catch-up when a world has been left for a while. Numbers are in
 * `BALANCE.MERCHANT`: verify in playtest.
 */
export interface Merchant {
  /** Stable within a world: `<week>:<index>`. */
  id: string;
  kind: MerchantKind;
  /** Where it was dealt, on a road the party had seen. */
  start: HexCoord;
  /** The campaign hour it arrived: the week's first. */
  dealtHour: number;
  week: number;
}

/** The hour a week begins. */
export const weekStartHour = (week: number): number =>
  (Math.max(1, week) - 1) * BALANCE.HOURS_PER_DAY * BALANCE.DAYS_PER_WEEK;

const isRoad = (t: MapTile | undefined): t is MapTile =>
  !!t && t.zone === 'road' && !t.poi;

/** The stream a merchant's choices come from: the world's seed, its week and its place in the deal. */
const merchantSeed = (seed: number, week: number, index: number, step: number): number =>
  strHash(`merchant:${seed}:${week}:${index}:${step}`);

/**
 * Deal this week's merchants: one or two, each of a different kind where kinds
 * allow, each on a road tile the party has already revealed. Never on a
 * village (off the road by placement) or the home tile (a POI): road tiles
 * carrying a POI are not dealt onto. None when no road has been seen.
 */
export function dealMerchants(seed: number, week: number, tiles: ReadonlyMap<string, MapTile>): Merchant[] {
  const roads = [...tiles.values()]
    .filter((t) => t.explored && isRoad(t))
    .sort((a, b) => a.coord.r - b.coord.r || a.coord.q - b.coord.q);
  if (roads.length === 0) return [];
  const rng = createRNG(merchantSeed(seed, week, 0, -1));
  const count = rng.nextInt(BALANCE.MERCHANT.countMin, BALANCE.MERCHANT.countMax);
  const kinds = [...MERCHANT_KINDS];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  const dealtHour = weekStartHour(week);
  const out: Merchant[] = [];
  for (let i = 0; i < count; i++) {
    const at = roads[rng.nextInt(0, roads.length - 1)].coord;
    out.push({ id: `${week}:${i}`, kind: kinds[i % kinds.length], start: at, dealtHour, week });
  }
  return out;
}

/**
 * Villages and home, which a merchant leans toward at forks. Read off the
 * store's POI index (`poiCoords`) rather than the whole map, because the world
 * map asks for it on every step.
 */
export function merchantTargets(
  tiles: ReadonlyMap<string, MapTile>,
  poiCoords: readonly HexCoord[],
  home: HexCoord | null,
): HexCoord[] {
  const out: HexCoord[] = home ? [home] : [];
  for (const coord of poiCoords) if (tiles.get(hexKey(coord))?.poi === POIType.Village) out.push(coord);
  return out;
}

const nearest = (from: HexCoord, targets: readonly HexCoord[]): number =>
  targets.reduce((best, t) => Math.min(best, hexDistance(from, t)), Infinity);

/** Whether a merchant is still on the map at `hour`. */
export const merchantPresent = (m: Merchant, hour: number): boolean =>
  hour >= m.dealtHour && hour < m.dealtHour + BALANCE.MERCHANT.stayHours;

/** How many steps it has taken by `hour`. */
export const merchantSteps = (m: Merchant, hour: number): number =>
  Math.max(0, Math.floor((hour - m.dealtHour) / BALANCE.MERCHANT.hoursPerStep));

/**
 * Where a merchant stands at `hour`, or null when it has left (or not arrived).
 *
 * Each step goes to a neighbouring road tile other than the one it just left;
 * with several to choose from a tile nearer a village or home weighs
 * `1 + leanWeight` against 1, and the choice is a seeded draw. With nowhere new
 * to go (a dead end) it turns back the way it came. `seed` is the world's.
 */
export function merchantAt(
  m: Merchant,
  hour: number,
  tiles: ReadonlyMap<string, MapTile>,
  targets: readonly HexCoord[],
  seed: number,
): HexCoord | null {
  if (!merchantPresent(m, hour)) return null;
  const index = Number(m.id.split(':')[1] ?? 0);
  let at = m.start;
  let prev: HexCoord | null = null;
  const steps = merchantSteps(m, hour);
  for (let s = 0; s < steps; s++) {
    const options = getNeighbors(at).filter((n) => isRoad(tiles.get(hexKey(n))));
    const forward = options.filter((n) => !prev || hexKey(n) !== hexKey(prev));
    const pool = forward.length > 0 ? forward : options;
    if (pool.length === 0) break; // an island of road: it stays put
    const here = nearest(at, targets);
    const weights = pool.map((n) => 1 + (targets.length > 0 && nearest(n, targets) < here ? BALANCE.MERCHANT.leanWeight : 0));
    let roll = createRNG(merchantSeed(seed, m.week, index, s)).next() * weights.reduce((a, b) => a + b, 0);
    let pick = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll < 0) { pick = pool[i]; break; }
    }
    prev = at;
    at = pick;
  }
  return at;
}

/** A merchant and where it is now. */
export interface PlacedMerchant {
  merchant: Merchant;
  at: HexCoord;
}

/** Every merchant on the map at `hour`, with its hex. */
export function merchantsAt(
  merchants: readonly Merchant[],
  hour: number,
  tiles: ReadonlyMap<string, MapTile>,
  targets: readonly HexCoord[],
  seed: number,
): PlacedMerchant[] {
  if (merchants.length === 0) return [];
  const out: PlacedMerchant[] = [];
  for (const merchant of merchants) {
    const at = merchantAt(merchant, hour, tiles, targets, seed);
    if (at) out.push({ merchant, at });
  }
  return out;
}

/** What a world holds of its merchants, as the world map's store holds it: the deal and the map they walk. */
export interface MerchantWorld {
  merchants: readonly Merchant[];
  tiles: ReadonlyMap<string, MapTile>;
  /** The store's POI index, which `merchantTargets` reads the villages off. */
  poiCoords: readonly HexCoord[];
  homeCoord: HexCoord | null;
  mapSeed: number;
}

/** Where a world's merchants stand at `hour`: `merchantsAt` with the targets read off the world itself. */
export const merchantsNow = (world: MerchantWorld, hour: number): PlacedMerchant[] =>
  merchantsAt(world.merchants, hour, world.tiles, merchantTargets(world.tiles, world.poiCoords, world.homeCoord), world.mapSeed);

/** The merchant standing on `hex` at `hour`: a meeting, whoever walked onto whom. */
export function merchantOn(
  hex: HexCoord,
  merchants: readonly Merchant[],
  hour: number,
  tiles: ReadonlyMap<string, MapTile>,
  targets: readonly HexCoord[],
  seed: number,
): PlacedMerchant | null {
  return merchantsAt(merchants, hour, tiles, targets, seed).find((p) => hexKey(p.at) === hexKey(hex)) ?? null;
}

/** The merchants the party can see: only those on revealed ground are drawn. */
export const visibleMerchants = (placed: readonly PlacedMerchant[], tiles: ReadonlyMap<string, MapTile>): PlacedMerchant[] =>
  placed.filter((p) => tiles.get(hexKey(p.at))?.explored);

/** Whether a stored value is a well-formed merchant (for the save). */
export function validMerchant(value: unknown): value is Merchant {
  const m = value as Merchant | undefined;
  return !!m && typeof m === 'object' && typeof m.id === 'string' && (MERCHANT_KINDS as readonly string[]).includes(m.kind)
    && Number.isInteger(m.start?.q) && Number.isInteger(m.start?.r)
    && Number.isFinite(m.dealtHour) && Number.isInteger(m.week) && m.week >= 1;
}

/** How a route met a merchant: the party stepped onto one standing there, or one walked onto the party. */
export interface Meeting {
  /** Index into the route's steps of the hex reached: the walk stops here. */
  index: number;
  merchant: Merchant;
  how: 'stepped' | 'walked';
}

/**
 * Where a walk along `steps` first meets a merchant, if it does. The clock
 * advances by `hoursPerStep[i]` on each step, as `moveParty` does, and after
 * each one the merchants are read at the new hour: a merchant on the party's
 * hex is a meeting, at the hex reached. `stepped` when it was already standing
 * there an hour earlier, `walked` when it arrived during this step. The world
 * map checks the same rule one live step at a time.
 */
export function meetAlongRoute(
  steps: readonly HexCoord[],
  hoursPerStep: readonly number[],
  startHour: number,
  merchants: readonly Merchant[],
  tiles: ReadonlyMap<string, MapTile>,
  targets: readonly HexCoord[],
  seed: number,
): Meeting | null {
  let hour = startHour;
  for (let i = 0; i < steps.length; i++) {
    const before = hour;
    hour += hoursPerStep[i];
    const here = merchantOn(steps[i], merchants, hour, tiles, targets, seed);
    if (!here) continue;
    const earlier = merchantOn(steps[i], [here.merchant], before, tiles, targets, seed);
    return { index: i, merchant: here.merchant, how: earlier ? 'stepped' : 'walked' };
  }
  return null;
}
