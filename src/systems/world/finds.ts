import { HexCoord, MapFind, MapTile, POIType, ResourceType, TileType } from '@/models/types';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { createRNG } from '@/utils/rng';
import { BALANCE } from '@/data/balanceConstants';
import { mealLootAmount } from '@/systems/economy/expeditionMeals';
import { isPassable, reachableFromCity } from '@/systems/world/mapGenerator';
import { ThreatBand, neutralDepth, threatRewardScale } from '@/systems/world/threat';

/**
 * Exploration finds: what lies on the open map this week.
 *
 * These replaced the fixed resource nodes. A node was a place — placed once at
 * generation, harvested, regrown on the same tile every week — so the map's
 * economy was a route to learn. A find is dealt from `(map seed, week)` instead:
 * the same seed and week always deal the same ground, and the next week deals
 * different ground, so whatever the party did not collect simply is not there
 * any more. Nothing about a find is stored on the tile.
 *
 * Pure and Node-safe: the store calls it on a new map and at every week
 * rollover, and the balance tests call it across seeds.
 */

/** The encounter id of a chest's guards. Not curated: it reads the ground it is on. */
export const CHEST_GUARD_ID = 'chest_guard';

export function isChestGuard(encounterId: string | null | undefined): boolean {
  return encounterId === CHEST_GUARD_ID;
}

/**
 * The band a chest's guards are built and paid at.
 *
 * One above the ground the chest lies on, capped at the highest band. That is
 * the "stronger than the average party met here" rule in its first form; the
 * power multiplier and the waves are the other two.
 */
export function chestGuardBand(groundBand: number): ThreatBand {
  return Math.min(4, Math.max(0, groundBand) + BALANCE.EXPLORATION_FINDS.CHEST_GUARD_BAND_BUMP) as ThreatBand;
}

/** The stat multiplier on top of `threatPowerScale` for a chest's guards. */
export const CHEST_GUARD_POWER_MULT = BALANCE.EXPLORATION_FINDS.CHEST_GUARD_POWER_MULT;

const ORE_TYPES = [ResourceType.Wood, ResourceType.Stone, ResourceType.Iron, ResourceType.Crystal] as const;
type OreType = typeof ORE_TYPES[number];

/**
 * What a tile is likely to hold. Ore sits in the rock, crystal in the frozen
 * north and wood where trees are — the same geography the nodes had, as a
 * weighting rather than a quota so a range-free seed still pays out.
 */
function weightsFor(tile: MapTile): Record<OreType, number> {
  if (tile.frost) return { wood: 0, stone: 1, iron: 2, crystal: 4 };
  if (tile.type === TileType.Highlands || tile.type === TileType.Mountain) {
    return { wood: 0, stone: 4, iron: 3, crystal: 1 };
  }
  if (tile.type === TileType.Forest) return { wood: 5, stone: 1, iron: 0, crystal: 0 };
  if (tile.type === TileType.Swamp) return { wood: 3, stone: 1, iron: 1, crystal: 0 };
  return { wood: 3, stone: 2, iron: 1, crystal: 0 };
}

function pickOre(tile: MapTile, rng: ReturnType<typeof createRNG>, not?: OreType): OreType {
  const weights = weightsFor(tile);
  let total = 0;
  for (const type of ORE_TYPES) if (type !== not) total += weights[type];
  let roll = rng.next() * total;
  for (const type of ORE_TYPES) {
    if (type === not) continue;
    roll -= weights[type];
    if (roll < 0 && weights[type] > 0) return type;
  }
  return ORE_TYPES.find((t) => t !== not && weights[t] > 0) ?? ResourceType.Wood as OreType;
}

function oreAmount(type: OreType, rng: ReturnType<typeof createRNG>): number {
  const range = BALANCE.EXPLORATION_FINDS.RESOURCE_AMOUNTS[type];
  return rng.nextInt(range.min, range.max);
}

/** The seed a week's deal is drawn from. Different weeks never share a stream. */
function dealSeed(mapSeed: number, week: number): number {
  return (Math.imul(mapSeed | 0, 0x9e3779b1) ^ Math.imul(week + 1, 0x85ebca6b)) | 0;
}

/** How many caches, purses and chests a map of this size is dealt. */
export function findCounts(tileCount: number): { caches: number; purses: number; chests: number } {
  const f = BALANCE.EXPLORATION_FINDS;
  const nodes = Math.round((tileCount / 1000) * BALANCE.POI_PER_1000_TILES.resource);
  return {
    caches: Math.round(nodes * f.RESOURCE_CACHES_PER_NODE * f.DENSITY_MULT),
    purses: Math.round(nodes * f.GOLD_PURSES_PER_NODE * f.DENSITY_MULT),
    chests: Math.max(1, Math.round((tileCount / 1000) * f.CHESTS_PER_1000_TILES * f.DENSITY_MULT)),
  };
}

/**
 * Deals the finds for `week`.
 *
 * All kinds land on reachable haunted ground that holds no destination,
 * water or bare peak. The road and its safe apron carry no finds.
 */
export function rollWeeklyFinds(
  tiles: Iterable<MapTile>,
  mapSeed: number,
  week: number,
  /** The world's home anchor; the city's hex when omitted (the Empire). */
  home?: HexCoord,
): Map<string, MapFind> {
  const list = [...tiles];
  const finds = new Map<string, MapFind>();
  const city = home
    ? list.find((t) => t.coord.q === home.q && t.coord.r === home.r)
    : list.find((t) => t.poi === POIType.City);
  if (!city) return finds;

  const byKey = new Map(list.map((t) => [hexKey(t.coord), t]));
  const reachable = reachableFromCity(city.coord, byKey);
  const ground = list.filter((t) =>
    !t.poi
    && t.zone === 'haunted'
    && isPassable(t.type)
    && t.type !== TileType.Mountain
    && hexDistance(t.coord, city.coord) > BALANCE.EXPLORATION_FINDS.MIN_CITY_DISTANCE
    && reachable.has(hexKey(t.coord)));

  const rng = createRNG(dealSeed(mapSeed, week));
  for (let i = ground.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    [ground[i], ground[j]] = [ground[j], ground[i]];
  }

  const counts = findCounts(list.length);
  let cursor = 0;
  const next = (accept: (t: MapTile) => boolean): MapTile | undefined => {
    while (cursor < ground.length) {
      const tile = ground[cursor++];
      if (accept(tile)) return tile;
    }
    return undefined;
  };
  const rewardScale = (tile: MapTile) => {
    const band = (tile.threat ?? 0) as ThreatBand;
    return threatRewardScale(band, neutralDepth(band), tile.zone === 'haunted');
  };
  const gold = (tile: MapTile, { min, max }: { min: number; max: number }) =>
    Math.max(1, Math.round(rng.nextInt(min, max) * rewardScale(tile)));

  // Chests first, so the rarest find gets the pick of the haunted ground.
  for (let i = 0; i < counts.chests; i++) {
    const tile = next((t) => t.zone === 'haunted');
    if (!tile) break;
    const first = pickOre(tile, rng);
    const second = pickOre(tile, rng, first);
    const mult = BALANCE.EXPLORATION_FINDS.CHEST_RESOURCE_MULT;
    finds.set(hexKey(tile.coord), {
      kind: 'chest',
      coord: tile.coord,
      band: tile.threat ?? 0,
      payout: [
        { type: ResourceType.Gold, amount: gold(tile, BALANCE.EXPLORATION_FINDS.CHEST_GOLD_AMOUNT) },
        { type: first, amount: oreAmount(first, rng) * mult },
        { type: second, amount: oreAmount(second, rng) * mult },
      ],
    });
  }

  const caches = counts.caches + counts.purses;
  const near = ground.findIndex((tile, i) => i >= cursor && hexDistance(tile.coord, city.coord) <= BALANCE.EXPLORATION_FINDS.STARTER_FIND_RADIUS);
  if (near >= cursor) [ground[cursor], ground[near]] = [ground[near], ground[cursor]];
  for (let i = 0; i < caches; i++) {
    const tile = next(() => true);
    if (!tile) break;
    const isPurse = i >= counts.caches;
    const type = isPurse ? ResourceType.Gold : pickOre(tile, rng);
    finds.set(hexKey(tile.coord), {
      kind: 'cache',
      coord: tile.coord,
      band: tile.threat ?? 0,
      payout: [{
        type,
        amount: isPurse ? gold(tile, BALANCE.EXPLORATION_FINDS.GOLD_AMOUNT) : oreAmount(type as OreType, rng),
      }],
    });
  }
  return finds;
}

/** What claiming `find` pays after the active meal's loot bonus. */
export function findPayout(
  find: MapFind,
  mealTier: number,
  /** The village buff's multiplier on gold (`goldMultiplier`); 1 for none. */
  goldMultiplier: number = 1,
): { type: ResourceType; amount: number }[] {
  return find.payout.map((p) => {
    const amount = mealLootAmount(p.amount, mealTier, p.type);
    return { type: p.type, amount: p.type === ResourceType.Gold ? Math.round(amount * goldMultiplier) : amount };
  });
}

/** The nearest unclaimed find paying `resource`, for a quest arrow. */
export function nearestFindOf(
  finds: ReadonlyMap<string, MapFind>,
  from: { q: number; r: number },
  resource: ResourceType,
  /** Which finds the player may know about — the arrow must not read through the fog. */
  visible: (find: MapFind) => boolean = () => true,
): MapFind | undefined {
  let best: MapFind | undefined;
  let bestDistance = Infinity;
  for (const find of finds.values()) {
    if (!visible(find) || !find.payout.some((p) => p.type === resource)) continue;
    const d = hexDistance(from, find.coord);
    if (d < bestDistance) {
      best = find;
      bestDistance = d;
    }
  }
  return best;
}
