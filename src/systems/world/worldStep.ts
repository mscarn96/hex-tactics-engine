import type { ArenaSite, EncounterContext, HexCoord, MapTile } from '@/models/types';
import { hexKey } from '@/utils/hexUtils';
import { useGameStore } from '@/stores/gameStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import type { WorldId } from '@/data/worlds';
import { WARBAND_ENCOUNTER_ID } from '@/systems/world/encounterGenerator';
import { canFlee, fleeChance, fleeSucceeds } from '@/systems/world/escape';
import { merchantsNow, type Merchant, type MerchantWorld } from '@/systems/world/merchants';
import { holdsEncounter } from '@/systems/world/travel';
import { inJadeveil, weatherNow } from '@/systems/world/ascent';
import type { ThreatBand } from '@/systems/world/threat';
import type { VillageBuffId } from '@/systems/economy/villageBuffs';
import { fleesWarbands } from '@/systems/economy/villageBuffEffects';

/**
 * What a step of a walk meets, and what a warband that stops it comes to.
 *
 * The world map steps the party one hex at a time (`WorldMapScene.beginTravel`)
 * and used to answer these itself, between its timers and dialogs: whether the
 * hex holds a warband, whether a merchant stands on it, whether the Lookout's
 * Escape offers a flight and what a flight leaves behind. Those are rules, and a
 * rule that sits in a scene's callback is one a test cannot reach: swapping the
 * flight's `removeActiveEncounter` for `clearActiveEncounter`, or dropping the
 * failed flight's `enemiesFirst`, passed every suite. So the rules live here and
 * the scene keeps the walk's timing, the token's animation and the dialogs.
 *
 * Lairs, quest sites, wells and the other places a walk ends on are still the
 * scene's `handleTileArrival`: each opens a screen of its own.
 */

/** What the step needs of the world: where the party stands, today's warbands and the week's merchants. */
export interface StepWorld extends MerchantWorld {
  partyPosition: HexCoord;
  activeEncounterTiles: ReadonlySet<string>;
}

/** What the hex a step reached holds: a warband stops the walk first, then a merchant. */
export type StepMeeting =
  | { kind: 'warband'; tile: MapTile }
  | { kind: 'merchant'; merchant: Merchant }
  | null;

/** The merchant on `hex` at `hour`, whoever walked onto whom. */
export function merchantMet(world: MerchantWorld, hex: HexCoord, hour: number): Merchant | null {
  const key = hexKey(hex);
  return merchantsNow(world, hour).find((p) => hexKey(p.at) === key)?.merchant ?? null;
}

/**
 * What the party meets on the hex it stands on after a step, at the clock's
 * `hour` (read after the step, so a merchant who walked onto the party this hour
 * is met). A warband wins over a merchant on the same hex, as an ambush would.
 */
export function stepMeeting(world: StepWorld, hour: number): StepMeeting {
  const tile = world.tiles.get(hexKey(world.partyPosition));
  if (holdsEncounter(tile, world.activeEncounterTiles)) return { kind: 'warband', tile: tile! };
  const merchant = merchantMet(world, world.partyPosition, hour);
  return merchant ? { kind: 'merchant', merchant } : null;
}

/** A warband that stopped the walk, and the hex the party stood on before the step that met it. */
export interface Flight {
  tile: MapTile;
  from: HexCoord;
}

/**
 * Whether a warband that stopped the walk is offered as Fight or Flee: only
 * under the Lookout's Escape, only for a step that came from somewhere (a
 * successful flight goes back there), and only on open ground, the one place a
 * wandering warband stands. Lairs, bosses, quest fights, guarded chests and
 * village garrisons all start elsewhere and never reach here.
 */
export function offersFlight(tile: MapTile, from: HexCoord | null, buff: VillageBuffId | null): from is HexCoord {
  return !!from && !tile.poi && canFlee(WARBAND_ENCOUNTER_ID) && fleesWarbands(buff);
}

/** The chance a flight from the warband on `tile` gets away, for the party's summed level. */
export const flightChance = (tile: MapTile, partySummedLevel: number, world: WorldId = 'empire'): number =>
  fleeChance(partySummedLevel, (tile.threat ?? 0) as ThreatBand, world);

/**
 * What the arena needs to know about the tile a fight started on.
 *
 * Passed at the call site rather than re-derived inside `CombatScene`, which is
 * what let a lair fight be coloured by the terrain under the lair's *door*.
 */
export const worldContext = (tile: MapTile, site?: ArenaSite, enemiesFirst?: boolean): EncounterContext => ({
  kind: 'world',
  terrain: tile.type,
  danger: tile.zone === 'haunted',
  threat: tile.threat ?? 0,
  // Jadeveil's sky goes into the fight with the party
  ...(inJadeveil() && { weather: weatherNow() }),
  // And its ground, so the fight is fought in that ground's own arena
  ...(tile.jade && { jade: tile.jade }),
  // The archipelago's beach, jungle or rock likewise
  ...(tile.isle && { isle: tile.isle }),
  // A hex with an arena of its own (Kairen's summit)
  ...(site && { site }),
  // A held village's garrison is fought in the village's own arena
  ...(tile.village && { village: tile.village }),
  // A failed flight (Escape): the warband acts first
  ...(enemiesFirst && { enemiesFirst }),
});

/**
 * Fight the warband on `tile`.
 *
 * The ground is spent before the fight rather than after it, which is the
 * behaviour this inherited and is worth keeping deliberately: losing to a
 * wandering warband still clears the ground, so a defeat is not a tile that
 * ambushes the party again the moment they limp back over it. `enemiesFirst`
 * is a failed flight's: the warband opens the turn order.
 */
export function fightWarband(tile: MapTile, enemiesFirst?: boolean): void {
  useWorldMapStore.getState().clearActiveEncounter(tile.coord);
  useGameStore.getState().startEncounter(WARBAND_ENCOUNTER_ID, worldContext(tile, undefined, enemiesFirst));
}

/**
 * Roll a flight at `chance` (the one the dialog showed) and carry it out;
 * whether the party got away.
 *
 * Away: the party is back on the hex it came from, the warband is gone from its
 * own and only its own (`removeActiveEncounter`, which spares the neighbours a
 * win would quiet), and no fight means no XP. The hour the step cost is spent.
 * Caught: the fight starts with the warband acting first.
 */
export function resolveFlight(flight: Flight, chance: number, roll: number = Math.random()): boolean {
  if (!fleeSucceeds(chance, roll)) {
    fightWarband(flight.tile, true);
    return false;
  }
  const world = useWorldMapStore.getState();
  world.removeActiveEncounter(flight.tile.coord);
  world.moveParty(flight.from, 0);
  return true;
}
