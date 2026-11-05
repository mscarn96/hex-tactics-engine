import { getLocation, walkedHome } from '@/locations';
import { triggerKey, LocationId } from '@/locations/types';
import { useGameStore } from '@/stores/gameStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { useLocationStore } from '@/stores/locationStore';
import { GamePhase, HexCoord } from '@/models/types';
import { getNeighbors, hexKey } from '@/utils/hexUtils';

/** Cleared boss locations retain their return portal, including after reload. */
export function townPortalTile(location: LocationId, spent: ReadonlySet<string>, castleCleared: boolean) {
  const def = getLocation(location);
  const boss = def.lair?.bossAt;
  if (boss && spent.has(triggerKey(location, boss))) return def.tiles.find(t => t.coord.q === boss.q && t.coord.r === boss.r);
  if (location === 'castle' && castleCleared) {
    // Beside the gate, never on it: the gate is a door of its own (playtest 2026-10-23)
    const gate = def.tiles.find(t => t.trigger?.kind === 'castleGate');
    if (!gate) return undefined;
    const byKey = new Map(def.tiles.map(t => [hexKey(t.coord), t]));
    return getNeighbors(gate.coord)
      .map(c => byKey.get(hexKey(c)))
      .find(t => t && !t.blocked && !t.trigger && !t.prop);
  }
  return undefined;
}
/**
 * Where a portal opens in the world the party stands in: that world's home, on
 * its map hex and walked into — the city in the Empire, the foothill camp in
 * Jadeveil (playtest 2026-10-21-b: Jadeveil has no city, so both portals did
 * nothing there). `null` where the home is not a walked place yet (the
 * archipelago's camp), and every portal there refuses. Never another world's
 * home: the way between worlds is the gate.
 */
export function townPortalHome(): { coord: HexCoord; location: LocationId } | null {
  const map = useWorldMapStore.getState();
  const location = walkedHome(map.worldId);
  return location && map.homeCoord ? { coord: map.homeCoord, location } : null;
}

/** Through a portal to the world's home. Returns whether it opened. */
export function returnThroughTownPortal(): boolean {
  const home = townPortalHome();
  if (!home) return false;
  useWorldMapStore.getState().moveParty(home.coord, 0);
  useGameStore.getState().enterLocation(home.location);
  return true;
}

/**
 * A carried portal cannot escape a fight or be wasted while already home, and
 * opens only where the world has a home to open onto (`townPortalHome`).
 */
export function canUseCarriedTownPortal(): boolean {
  const game = useGameStore.getState();
  const location = useLocationStore.getState().current;
  if (!townPortalHome()) return false;
  return game.phase === GamePhase.WorldMap || !!(game.phase === GamePhase.Location && location && getLocation(location).lair);
}

export function consumeCarriedTownPortal(): boolean {
  if (!canUseCarriedTownPortal()) return false;
  if (!useInventoryStore.getState().spendTownPortal()) return false;
  return returnThroughTownPortal();
}
