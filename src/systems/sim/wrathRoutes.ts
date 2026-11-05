import { BALANCE } from '@/data/balanceConstants';
import { EMPIRE_WORLD, JADEVEIL_WORLD, worldSeed } from '@/data/worlds';
import { MapTile, POIType } from '@/models/types';
import { generateMap, movementCost } from '@/systems/world/mapGenerator';
import { getNeighbors, hexKey } from '@/utils/hexUtils';
import { awardWrath, liveWrath, NO_WRATH, WRATH_MAX, type WrathSource, type WrathState } from '@/systems/world/wrath';

/**
 * Wrath on real routes: the measurement `WRATH_GAIN` and `WRATH_DECAY_PER_HOUR`
 * are tuned against (`wrathRoutes.test.ts` pins its rules; the table is in
 * `docs/world.md`).
 *
 * Measured before the shrine campaign placed the range's real work (its two
 * lair doors, the shrine contracts handed in at the camp — see
 * the private project notes, *Jadeveil*), so the places stand in here
 * by the rule they were expected to follow, and the real route is judged in the
 * campaign playtest:
 * haunted ground in each band, a quest at a third, two thirds and the far end
 * of its band's walking hours from the camp, and a lair at the remote end of
 * bands 2–4. Walking hours are the game's own (`movementCost`: half an hour on
 * the road, an hour off it), every hex treated as explored. **Blocked passes**
 * are measured by walking the same map with every pass hex refused, the
 * detour a party takes while the shrines above have not opened them. A **trip
 * to the city** is the crossing both ways, the Empire's road from its gate to
 * the city and back, and a Tavern night.
 *
 * Pure and deterministic per seed, so the numbers are a measurement and not a
 * roll.
 */

export interface Objective {
  source: WrathSource;
  band: number;
  key: string;
  /** Walking hours from the camp, passes open and passes refused. */
  hours: number;
  blockedHours: number;
}

export interface RouteReport {
  seed: number;
  objectives: Objective[];
  /** Hours of a city trip from the camp and back. */
  cityTripHours: number;
  /** The walk from the camp to the summit, passes refused. */
  summitHours: number;
  /** The worst objective: what the most remote lair nets after the walk there and back, passes refused. */
  remoteLairNet: number;
  /** Fewest objectives that fill the bar going out and back from the camp each time, nearest first. */
  sortiesToFull: number;
  /** Hours those sorties take. */
  sortieHours: number;
  /** The floor sorties alone have reached once every objective is done. */
  sortieFloor: number;
  /** Fewest objectives that fill it walking straight from one to the next. */
  pushToFull: number;
  pushHours: number;
  /** What a city trip takes off a bar standing just under the third floor's ceiling. */
  cityLull: number;
}

/** A Tavern night and the turnaround in the city. */
const CITY_STAY_HOURS = 10;
/** The camp's rest between two sorties. */
const SORTIE_REST = BALANCE.CAMP_REST_HOURS;

/** Walking hours from `from` to every reachable tile, by key. */
export function walkingHours(
  tiles: ReadonlyMap<string, MapTile>,
  from: MapTile,
  refuse: (tile: MapTile) => boolean = () => false,
): Map<string, number> {
  const dist = new Map<string, number>([[hexKey(from.coord), 0]]);
  // Two step costs only (0.5 and 1), so a bucketed queue is exact
  const queue: MapTile[][] = [[from]];
  for (let b = 0; b < queue.length; b++) {
    const bucket = queue[b];
    if (!bucket) continue;
    for (const tile of bucket) {
      const here = dist.get(hexKey(tile.coord))!;
      if (here * 2 !== b) continue;
      for (const coord of getNeighbors(tile.coord)) {
        const next = tiles.get(hexKey(coord));
        if (!next || refuse(next)) continue;
        const cost = movementCost(tile, next);
        if (cost === null) continue;
        const total = here + cost;
        const key = hexKey(next.coord);
        if (total >= (dist.get(key) ?? Infinity)) continue;
        dist.set(key, total);
        (queue[total * 2] ??= []).push(next);
      }
    }
  }
  return dist;
}

const quantile = <T>(sorted: T[], q: number): T | undefined => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];

/** Where the range's quests and lairs stand in, by the rule they will be placed by. */
export function standInObjectives(tiles: MapTile[]): Objective[] {
  const map = new Map(tiles.map((t) => [hexKey(t.coord), t] as const));
  const camp = map.get(hexKey(JADEVEIL_WORLD.home))!;
  const open = walkingHours(map, camp);
  const blocked = walkingHours(map, camp, (t) => !!t.pass);
  const out: Objective[] = [];
  for (let band = 1; band <= 4; band++) {
    const ground = tiles
      .filter((t) => t.threat === band && t.zone === 'haunted' && !t.poi && open.has(hexKey(t.coord)))
      .sort((a, b) => open.get(hexKey(a.coord))! - open.get(hexKey(b.coord))!);
    const at = (q: number, source: WrathSource) => {
      const tile = quantile(ground, q);
      if (!tile) return;
      const key = hexKey(tile.coord);
      out.push({ source, band, key, hours: open.get(key)!, blockedHours: blocked.get(key) ?? open.get(key)! * 2 });
    };
    if (band <= 3) for (const q of [1 / 3, 2 / 3, 1]) at(q, 'quest');
    if (band >= 2) at(0.95, 'lair');
  }
  return out;
}

/** The Empire's road from its world gate to the city, in hours. */
export function empireGateToCity(campaignSeed: number): number {
  const tiles = generateMap(campaignSeed, EMPIRE_WORLD);
  const map = new Map(tiles.map((t) => [hexKey(t.coord), t] as const));
  const gate = tiles.find((t) => t.poi === POIType.WorldGate);
  const city = tiles.find((t) => t.poi === POIType.City);
  if (!gate || !city) return Infinity;
  return walkingHours(map, gate).get(hexKey(city.coord)) ?? Infinity;
}

/** Run the bar through `steps` of [hours walked, gain at the end], from `start`; returns the state and hours. */
function run(start: WrathState, steps: readonly [number, number][]): { state: WrathState; hours: number; full: number } {
  let state = start;
  let hours = 0;
  let full = -1;
  steps.forEach(([walk, gain], i) => {
    hours += walk;
    state = awardWrath(state, hours, gain).state;
    if (full < 0 && state.windowUntil > 0) full = i + 1;
  });
  return { state, hours, full };
}

export function measureRoutes(campaignSeed: number): RouteReport {
  const tiles = generateMap(worldSeed(campaignSeed, 'jadeveil'), JADEVEIL_WORLD);
  const map = new Map(tiles.map((t) => [hexKey(t.coord), t] as const));
  const objectives = standInObjectives(tiles);
  const gain = (o: Objective) => BALANCE.WRATH_GAIN[o.source];
  const cityTripHours = 2 * (BALANCE.WORLD_CROSSING_HOURS + empireGateToCity(campaignSeed)) + CITY_STAY_HOURS;

  const lairs = objectives.filter((o) => o.source === 'lair');
  const remote = lairs.reduce((a, b) => (b.blockedHours > a.blockedHours ? b : a), lairs[0]);
  const remoteLairNet = gain(remote) - BALANCE.WRATH_DECAY_PER_HOUR * 2 * remote.blockedHours;

  // Sorties: out to the nearest undone objective, back to the camp, a rest, again
  const byTrip = [...objectives].sort((a, b) => a.blockedHours - b.blockedHours);
  const sortie = run(NO_WRATH, byTrip.map((o, i) => [
    (i === 0 ? 0 : byTrip[i - 1].blockedHours + SORTIE_REST) + o.blockedHours, gain(o),
  ] as [number, number]));

  // A push: from each objective straight on to the nearest undone one, passes refused
  const done = new Set<string>();
  let at = map.get(hexKey(JADEVEIL_WORLD.home))!;
  const pushSteps: [number, number][] = [];
  while (done.size < objectives.length) {
    const from = walkingHours(map, at, (t) => !!t.pass);
    const next = objectives
      .filter((o) => !done.has(o.key))
      .reduce<Objective | null>((best, o) => (!best || (from.get(o.key) ?? Infinity) < (from.get(best.key) ?? Infinity) ? o : best), null)!;
    done.add(next.key);
    pushSteps.push([from.get(next.key) ?? next.blockedHours * 2, gain(next)]);
    at = map.get(next.key)!;
  }
  const push = run(NO_WRATH, pushSteps);

  // A city trip from a bar just under the storm's floor
  const before: WrathState = { value: BALANCE.WRATH_FLOORS[2] - 1, at: 0, floor: BALANCE.WRATH_FLOORS[1], windowUntil: 0 };
  const cityLull = before.value - liveWrath(before, cityTripHours);

  const summit = tiles.find((t) => t.poi === POIType.Summit)!;
  const summitHours = walkingHours(map, map.get(hexKey(JADEVEIL_WORLD.home))!, (t) => !!t.pass).get(hexKey(summit.coord))
    ?? walkingHours(map, map.get(hexKey(JADEVEIL_WORLD.home))!).get(hexKey(summit.coord))!;

  return {
    seed: campaignSeed,
    objectives,
    cityTripHours,
    summitHours,
    remoteLairNet,
    sortiesToFull: sortie.full < 0 ? Infinity : sortie.full,
    sortieHours: sortie.full < 0 ? Infinity : timeToFull(byTrip.map((o, i) => [
      (i === 0 ? 0 : byTrip[i - 1].blockedHours + SORTIE_REST) + o.blockedHours, gain(o),
    ] as [number, number])),
    sortieFloor: sortie.state.floor,
    pushToFull: push.full < 0 ? Infinity : push.full,
    pushHours: push.full < 0 ? Infinity : timeToFull(pushSteps),
    cityLull,
  };
}

function timeToFull(steps: readonly [number, number][]): number {
  let state = NO_WRATH;
  let hours = 0;
  for (const [walk, gain] of steps) {
    hours += walk;
    state = awardWrath(state, hours, gain).state;
    if (liveWrath(state, hours) >= WRATH_MAX) return hours;
  }
  return Infinity;
}
