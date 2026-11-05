import { BALANCE } from '@/data/balanceConstants';
import type { MapTile } from '@/models/types';
import { getHexesInRange, hexKey, type HexCoord } from '@/utils/hexUtils';

/**
 * Danger sight, the Lookout's second buff: today's live encounters glow red on
 * the map within a few hexes of the party.
 *
 * The day's encounter hexes are already rolled at dawn and kept in
 * `activeEncounterTiles`; they are only hidden. This reveals the ones near the
 * party: within `radius` hexes (`VILLAGE_DANGER_SIGHT_RADIUS`) and on ground the
 * party has already seen, so the buff never lights fog. The area moves with the
 * party, and each dawn's re-roll replaces the set it reads, so it refreshes on
 * its own. Pure: the world map draws the keys it returns.
 */
export function dangerSightKeys(
  active: ReadonlySet<string>,
  tiles: ReadonlyMap<string, MapTile>,
  party: HexCoord,
  radius: number = BALANCE.VILLAGE_DANGER_SIGHT_RADIUS,
): Set<string> {
  const out = new Set<string>();
  for (const hex of getHexesInRange(party, radius)) {
    const key = hexKey(hex);
    if (active.has(key) && tiles.get(key)?.explored) out.add(key);
  }
  return out;
}

/** The hexes of a planned route that stand on a red one, in route order. */
export function redHexesOnRoute(path: readonly HexCoord[], red: ReadonlySet<string>): HexCoord[] {
  return path.filter((hex) => red.has(hexKey(hex)));
}
