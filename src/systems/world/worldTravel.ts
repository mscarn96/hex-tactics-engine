import { HexCoord, MapTile, POIType } from '@/models/types';
import { getNeighbors, hexKey } from '@/utils/hexUtils';
import { BALANCE } from '@/data/balanceConstants';
import { worldDef, worldSeed, type WorldId } from '@/data/worlds';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { roadState } from '@/data/levelCap';
import { useGameStore } from '@/stores/gameStore';
import { useWorldBandStore } from '@/stores/worldBandStore';
import { movementCost } from '@/systems/world/mapGenerator';
import { gateOffer, type GateState } from '@/systems/world/worldGates';

/**
 * The crossing between worlds, and the walk through it.
 *
 * A distinct gate POI at each end (`POIType.WorldGate`) — never the castle, whose
 * gauntlet keeps its own door. Which roads a gate offers and whether each is open
 * is `worldGates.ts`; this walks the party through. The walk is
 * `WORLD_CROSSING_HOURS` on the one clock, spent before arrival, so the world left
 * and the world reached both see the hours pass. A world's first crossing gives it
 * its level band (`worldBandStore`).
 */

/** Every road the gate in `from` offers the running campaign, each with its state. */
export function currentGateOffer(from: WorldId): GateState[] {
  return gateOffer(from, roadState());
}

/** Whether a tile is the door out of its world: a gate, or a camp that has no gate of its own yet. */
function isDoor(tile: MapTile | undefined): boolean {
  return tile?.poi === POIType.WorldGate || tile?.poi === POIType.IsleCamp;
}

/** Where this world's way out stands, read off the POI index; `null` for a world without one. */
export function worldGateCoord(
  tiles: ReadonlyMap<string, MapTile>,
  poiCoords: readonly HexCoord[],
): HexCoord | null {
  return poiCoords.find((c) => isDoor(tiles.get(hexKey(c)))) ?? null;
}

/**
 * Where a party coming through stands: beside that world's gate, so one tap
 * walks back through. Of the free hexes it can step to, the one in the
 * gentlest band, then road before rough ground — a party just off a journey is
 * not set down on the far side of a band seam. The gate itself if it has no
 * free neighbour, and the world's home if it has no gate.
 */
export function gateArrival(tiles: Map<string, MapTile>, id: WorldId): HexCoord {
  let gate: MapTile | null = null;
  for (const tile of tiles.values()) {
    if (isDoor(tile)) { gate = tile; break; }
  }
  if (!gate) return worldDef(id).home;
  const from = gate;
  const steps = getNeighbors(from.coord)
    .map((coord) => tiles.get(hexKey(coord)))
    .filter((t): t is MapTile => !!t && !t.poi && movementCost(t, from) !== null && movementCost(from, t) !== null);
  steps.sort((a, b) => (a.threat ?? 0) - (b.threat ?? 0)
    || Number(b.zone === 'road') - Number(a.zone === 'road'));
  return steps[0]?.coord ?? from.coord;
}

/**
 * Walk the party through the gate it stands on, along the road to `to`: the first
 * open road when none is named. Returns whether it crossed: not when it is not on a
 * gate, or the road is shut. A crossing leaves the world map its arrival to announce
 * (`arrivalNotice`), whichever scene it was made from: the map's gate, or the foothill
 * camp's, whose scene unmounts.
 */
export function crossWorldGate(to?: WorldId): boolean {
  const map = useWorldMapStore.getState();
  if (!isDoor(map.tiles.get(hexKey(map.partyPosition)))) return false;
  const offer = currentGateOffer(map.worldId);
  const gate = to ? offer.find((road) => road.to === to) : offer.find((road) => road.open);
  if (!gate?.open) return false;

  // The journey happens on the clock first: a dawn on the road heals the party
  // as any other dawn does, and the world reached catches up on what it missed.
  map.moveParty(map.partyPosition, BALANCE.WORLD_CROSSING_HOURS);
  if (gate.first) useWorldBandStore.getState().cross(gate.to);
  const seed = worldSeed(useGameStore.getState().mapSeed, gate.to);
  useWorldMapStore.getState().switchWorld(gate.to, seed, (tiles) => gateArrival(tiles, gate.to));
  useWorldMapStore.getState().noteArrival(gate.to);
  return true;
}
