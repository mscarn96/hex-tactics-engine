import { HexCoord, MapTile } from '@/models/types';
import { getHexesInRange, getNeighbors, hexKey } from '@/utils/hexUtils';
import { movementCost } from '@/systems/world/mapGenerator';
import { BALANCE } from '@/data/balanceConstants';
import { findPath } from '@/systems/world/pathfinding';

/**
 * What happens to a party between where it is and where it tapped.
 *
 * Walking used to be a single store write and a token that slid across the gap:
 * `moveParty(destination, steps)` moved the party there, and the *destination*
 * was the only tile the world ever reacted to. Everything the route passed over
 * was scenery — a party could walk the length of a warband's hunting ground and
 * arrive unbothered, because the ground in between was never asked.
 *
 * So this is the rule the map was missing: **a journey is every tile of it.**
 * The route is checked in order, and the first live encounter on it is where the
 * party stops. Pure and in `systems/` rather than in the scene's tap handler for
 * the reason the private project notes gives about `victoryRewards` — a rule that is really a
 * function of (route, map, encounters) is untestable purely because of where it
 * sits, and this one decides how dangerous the whole overworld is.
 */

/**
 * Whether stepping onto this tile starts a fight.
 *
 * One predicate, shared by the planner, the arrival handler and the tests.
 *
 * Neither of the two structural checks is redundant with the set.
 * `activeEncounterTiles` is re-rolled every dawn and already honours both — but
 * it is also *persisted*, so a save whose roads or POIs moved would come back
 * naming tiles that are now a road or a door. Asking here as well means:
 *
 * - **The road is encounter-free by construction**, not by the roll having been
 *   done correctly.
 * - **A destination is not a fight.** Every lair door, ore vein, well and quest
 *   site sits in haunted ground on purpose, and haunted ground is the zone that
 *   carries encounters — so without this a lair door would roll a warband
 *   instead of opening, a large fraction of the times you walked to it, and read
 *   as broken rather than as dangerous.
 */
export function holdsEncounter(
  tile: MapTile | undefined,
  activeEncounterTiles: ReadonlySet<string>,
): boolean {
  if (!tile || tile.zone === 'road' || tile.poi) return false;
  return activeEncounterTiles.has(hexKey(tile.coord));
}

export interface TravelPlan {
  /**
   * The hexes actually walked, in order, **excluding** the one started on.
   * Empty when the party is already standing on its destination.
   */
  steps: HexCoord[];
  /**
   * The tile the party was stopped on, or `null` if it reached its destination
   * unmolested. Non-null means a fight starts here instead of the journey
   * finishing — the party is standing on this tile either way.
   */
  interceptedAt: MapTile | null;
  /**
   * What each step costs, in hours, in step order.
   *
   * A list rather than a total, because the party walks hex by hex and the clock
   * has to advance per step — a day can roll over in the middle of a journey,
   * and that is what heals the party and re-rolls the encounters. Handing the
   * caller a total would make it guess the split.
   *
   * Not all ones any more: a step from road to road costs `ROAD_HOURS`.
   */
  hoursPerStep: number[];
  /** The whole journey, for callers that only want the total. */
  hours: number;
}

/**
 * Cut a route short at the first live encounter on it.
 *
 * `path` is `findPath`'s output and therefore **includes the tile the party is
 * standing on** as its first entry; that one is never checked. The party has
 * already resolved wherever it is standing, and re-asking would restart the
 * fight it just won every time it tried to leave.
 *
 * The destination is checked like any other tile, which is the same behaviour
 * the game had before this function existed. It cannot collide with arriving
 * somewhere: `mapGenerator`'s danger pass skips any tile carrying a `poi`, so a
 * tile that holds an encounter never also holds a door, a well or a person.
 */
export function planTravel(
  path: HexCoord[],
  tiles: Map<string, MapTile>,
  activeEncounterTiles: ReadonlySet<string>,
): TravelPlan {
  const steps: HexCoord[] = [];
  const hoursPerStep: number[] = [];
  const total = () => hoursPerStep.reduce((a, b) => a + b, 0);

  for (let i = 1; i < path.length; i++) {
    const coord = path[i];
    const from = tiles.get(hexKey(path[i - 1]));
    const tile = tiles.get(hexKey(coord));

    steps.push(coord);
    // `movementCost` is the one place traversal is priced, and it already
    // refuses water and an over-steep climb — but the route came out of
    // `findPath` over that same function, so every step here is legal by
    // construction and a `null` can only mean the map changed underneath us.
    // One hour is the honest fallback for that, not a crash.
    hoursPerStep.push((from && tile ? movementCost(from, tile) : null) ?? 1);

    if (holdsEncounter(tile, activeEncounterTiles)) {
      // Stopped *on* the tile, not before it — the party walked into whatever
      // was waiting there, which is what an ambush is.
      return { steps, interceptedAt: tile!, hoursPerStep, hours: total() };
    }
  }

  return { steps, interceptedAt: null, hoursPerStep, hours: total() };
}

/**
 * The ground a won fight leaves quiet, for the rest of the day.
 *
 * Returns the live-encounter set with everything inside
 * `BALANCE.ENCOUNTER_QUIET_RADIUS` of `at` removed — the tile fought on
 * included, so this **replaces** clearing that one tile rather than sitting
 * beside it.
 *
 * The rule it encodes is small and the reason for it is not. The complaint this
 * answers is that **a journey never completes**, which is a different fault from
 * the map being too dense and wants a different fix: at 60% content and a 55%
 * daily roll, a third of deep haunted tiles were live, and `planTravel` stops the
 * party on the first one it crosses — so a thirty-tile march into the far country
 * was ten fights and ten aborted journeys, and the player's word for that was
 * that you cannot move. Thinning the whole world would have answered a question
 * nobody asked and re-created the drought `encounterSupply.test.ts` exists to
 * catch. This targets the consecutive interruption and nothing else: a warband
 * that has just been wiped leaves a gap, and nothing has moved into it by
 * nightfall.
 *
 * Pure, and here rather than in the store, for the reason `planTravel` is: this
 * is a function of (where the fight was, what is live) and a rule that decides
 * how far a party can get in a day has no business being untestable because it
 * lives in a `set()`. The **caller** is `worldMapStore.clearActiveEncounter`,
 * which is the one place an encounter is spent on victory.
 *
 * Returns the identical set when nothing was in reach, so a caller can skip the
 * write on `===` the way `questStore.report` does.
 */
export function quietAfterVictory(
  at: HexCoord,
  activeEncounterTiles: Set<string>,
  radius: number = BALANCE.ENCOUNTER_QUIET_RADIUS,
): Set<string> {
  const spent = getHexesInRange(at, radius)
    .map(hexKey)
    .filter((key) => activeEncounterTiles.has(key));
  if (spent.length === 0) return activeEncounterTiles;

  const next = new Set(activeEncounterTiles);
  for (const key of spent) next.delete(key);
  return next;
}

/**
 * The dangerous ground a route crosses, for the pre-walk preview.
 *
 * Keyed on the **zone** and deliberately not on the day's roll. Which tiles are
 * live is the one thing the player is not meant to know before setting out;
 * colouring the route by it would turn the confirm step into a minesweeper
 * readout and delete the risk the whole feature is about. What the map already
 * shows is which ground is haunted, and this says no more than that.
 *
 * Haunted only. Corridor tiles can ambush you too, at somewhere under a third of
 * the rate — but a warning painted on ground that is safe the great majority of
 * the time trains people to ignore the colour, and then it is not there when it
 * matters.
 */
export function dangerOnRoute(path: HexCoord[], tiles: Map<string, MapTile>): HexCoord[] {
  const out: HexCoord[] = [];
  for (let i = 1; i < path.length; i++) {
    const tile = tiles.get(hexKey(path[i]));
    if (tile?.zone === 'haunted') out.push(tile.coord);
  }
  return out;
}

/**
 * The hex a party stands on when it walks out of the city: a neighbour of the
 * city tile, never the city itself.
 *
 * Standing *on* the city was a trap. The tile the party is standing on is never
 * re-checked, so a party leaving the city — or starting a game there — was on
 * the one hex whose arrival opens the city, and had to step off and back on to
 * go in again. Out on the doorstep, one tap walks back through the gate.
 *
 * Only a hex the party can actually step to from the city counts. Among those:
 * nothing standing on it first (a POI there would open the moment the party
 * stood on it — the same trap one hex over); then road, because the road is
 * the safe way out and the network is built to leave the city by it; then
 * ground with no live encounter today, so walking out of the gate never starts
 * a fight on the spot; then neighbour order, so the answer is stable. `null`
 * only when the city has no walkable neighbour at all.
 */
export function cityExit(
  tiles: Map<string, MapTile>,
  city: HexCoord,
  active: Set<string>,
): HexCoord | null {
  const from = tiles.get(hexKey(city));
  if (!from) return null;
  let best: { coord: HexCoord; score: number } | null = null;
  for (const coord of getNeighbors(city)) {
    const tile = tiles.get(hexKey(coord));
    if (!tile || movementCost(from, tile) === null) continue;
    const score =
      (tile.zone === 'road' ? 4 : 0) +
      (active.has(hexKey(coord)) ? 0 : 2) +
      (tile.poi ? 0 : 8);
    if (!best || score > best.score) best = { coord, score };
  }
  return best?.coord ?? null;
}

/**
 * The route a tap arms: the cheapest legal walk from where the party stands to
 * `to`, over **explored ground only**.
 *
 * The destination already had to be explored; the hexes between did not, so a
 * route between two known patches could run through the mist — and its plates,
 * red where the ground is haunted, drew the hidden ground's shape and danger
 * on top of it. A route now stops at known legal cells, so nothing the route
 * preview draws lies on unknown ground, and the mist's soft edge is never
 * permission to plan through it. Discovery is unchanged: a walk still reveals
 * radius three round every hex it steps on.
 *
 * `movementCost` is the rest of the rule — passability and the climb limit.
 * A road step costs half an hour, so the heuristic is scaled to that or it
 * would overestimate and skip a cheaper road detour.
 */
export function planRoute(
  tiles: ReadonlyMap<string, MapTile>,
  from: HexCoord,
  to: HexCoord,
  /** Ground the route may not enter: Jadeveil's bands the shrine chain still bars. */
  refuse: (tile: MapTile) => boolean = () => false,
): HexCoord[] | null {
  // A* asks about one node's six neighbours in turn, so the `from` tile repeats.
  let lastFromKey = '';
  let lastFrom: MapTile | undefined;
  return findPath(from, to, (a, b) => {
    const fromKey = hexKey(a);
    if (fromKey !== lastFromKey) {
      lastFromKey = fromKey;
      lastFrom = tiles.get(fromKey);
    }
    const next = tiles.get(hexKey(b));
    if (!lastFrom || !next?.explored || refuse(next)) return null;
    return movementCost(lastFrom, next);
  }, undefined, BALANCE.ROAD_HOURS);
}
