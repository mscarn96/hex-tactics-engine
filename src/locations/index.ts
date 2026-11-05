import { CITY } from './city';
import { LAIRS } from './lairs';
import { CASTLE } from './castle';
import { FOOTHILL_CAMP } from './jadeveil/foothillCamp';
import { LocationDef, LocationId, LocationTile } from './types';
import type { EncounterContext } from '@/models/encounter';
import type { WorldId } from '@/data/worlds';
import { HexCoord, hexKey, hexToPixel } from '@/utils/hexUtils';

export * from './types';

export const LOCATIONS: Record<LocationId, LocationDef> = {
  ...(Object.fromEntries(LAIRS.map((l) => [l.id, l])) as Record<LocationId, LocationDef>),
  city: CITY,
  camp_jadeveil: FOOTHILL_CAMP,
  castle: CASTLE,
};

export * from './lairs';
export * from './text';

/**
 * The places that show the tribute ledger (week, days left, amount due).
 *
 * The city is where gold is spent and the castle is where the Emperor who
 * demands it sits, so both carry it: a player standing in the castle was
 * looking at a courtyard with no clock on it. Lairs are errands outside the
 * tribute's world and stay without. The ledger hides itself once the Emperor
 * falls, so no place has to know that.
 */
export const TRIBUTE_LEDGER_PLACES: readonly LocationId[] = ['city', 'castle'];

export function showsTributeLedger(id: LocationId): boolean {
  return TRIBUTE_LEDGER_PLACES.includes(id);
}

/**
 * Places no fight is ever started in, so no arena is dressed for them: the
 * foothill camp has no guards and no siege. Every other place is also an arena
 * (`arenaLayout.ts`, the composition gate).
 */
export const FIGHTLESS_LOCATIONS: readonly LocationId[] = ['camp_jadeveil'];

/** Every place a fight can be dressed as. */
export function arenaLocationIds(): LocationId[] {
  return (Object.keys(LOCATIONS) as LocationId[]).filter((id) => !FIGHTLESS_LOCATIONS.includes(id));
}

/**
 * The walked place that is a world's home: the city in the Empire, the
 * foothill camp in Jadeveil. Its world-map tile leads into it, a defeat
 * carries the party there and a town portal opens onto it. The archipelago's
 * camp is not a place yet (`null`).
 */
const HOME_LOCATIONS: Record<WorldId, LocationId | null> = { empire: 'city', jadeveil: 'camp_jadeveil', archipelago: null };

/** The world's walked home, or `null` where its home is not a place yet — a town portal there refuses. */
export function walkedHome(world: WorldId): LocationId | null {
  return HOME_LOCATIONS[world];
}

/**
 * Where a defeat in `world` carries the party. Nothing is fought in the
 * archipelago yet, so nothing is carried home from it: until its camp is
 * built, its home is the city's.
 */
export function homeLocation(world: WorldId): LocationId {
  return HOME_LOCATIONS[world] ?? 'city';
}

export function getLocation(id: LocationId): LocationDef {
  return LOCATIONS[id];
}

/**
 * Tiles by hex key.
 *
 * Built once per location and cached: the scene needs a lookup on every tap and
 * on every step of a path, and rebuilding a map of ~60 tiles inside pathfinding
 * would put an allocation in the inner loop for no reason.
 */
const tileIndexes = new Map<LocationId, Map<string, LocationTile>>();

export function tilesOf(id: LocationId): Map<string, LocationTile> {
  let index = tileIndexes.get(id);
  if (!index) {
    index = new Map(getLocation(id).tiles.map((t) => [hexKey(t.coord), t]));
    tileIndexes.set(id, index);
  }
  return index;
}

export function tileAt(id: LocationId, coord: HexCoord): LocationTile | undefined {
  return tilesOf(id).get(hexKey(coord));
}

/** A tile you can end a step on: it exists, and nothing solid is standing there. */
export function isWalkable(id: LocationId, coord: HexCoord): boolean {
  const tile = tileAt(id, coord);
  return !!tile && !tile.blocked;
}

/**
 * Where a walk along `path` actually ends: the first unspent encounter on the
 * way, or the last hex when nothing stands in it.
 *
 * A trigger fires where the party *stops*, and a tap walks the whole route in
 * one go — so a guard standing in a doorway was only ever met if it was the
 * destination, and a chest behind it could be tapped straight past the fight.
 * Every lair is built so that nothing worth having is reachable without
 * crossing a guard (`lairs.test.ts`); this is what makes the party honour it.
 * `path[0]` is where the party already stands and never interrupts.
 */
export function walkEnd(
  id: LocationId,
  path: readonly HexCoord[],
  isSpent: (coord: HexCoord) => boolean,
): HexCoord {
  for (let i = 1; i < path.length - 1; i++) {
    const trigger = tileAt(id, path[i])?.trigger;
    if (trigger?.kind === 'encounter' && !isSpent(path[i])) return path[i];
  }
  return path[path.length - 1];
}

/**
 * How a fight started in this place should be dressed.
 *
 * Lives here rather than at the call sites because there are three of them — the
 * castle gate from the world map, the castle gate from inside the courtyard, and
 * every lair encounter — and a fight themed differently depending on which door
 * you came through is the bug this whole seam exists to remove.
 */
export function locationContext(id: LocationId, coord?: HexCoord): EncounterContext {
  const def = getLocation(id);
  return {
    kind: 'location',
    location: id,
    surface: (coord && tileAt(id, coord)?.surface) ?? 'stone',
    ground: def.ambient.ground,
    fog: def.ambient.fog,
  };
}

/**
 * A layout's ground-space extent, in world units.
 *
 * The scene frames itself from this rather than from a hand-authored zoom on
 * each `LocationDef`: the city is a radius-4 square and a lair is a forty-unit
 * corridor, and a number written next to each would be one more thing to get
 * wrong when a layout changes shape.
 */
export function layoutBounds(def: LocationDef): {
  cx: number; cz: number; w: number; d: number;
} {
  if (def.tiles.length === 0) return { cx: 0, cz: 0, w: 0, d: 0 };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of def.tiles) {
    const p = hexToPixel(t.coord);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minZ) minZ = p.y;
    if (p.y > maxZ) maxZ = p.y;
  }
  // Padded by a hex, since the extremes are tile *centres* and a tile has width.
  const HEX_W = Math.sqrt(3);
  return {
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    w: maxX - minX + HEX_W,
    d: maxZ - minZ + 1.5,
  };
}
