import { HexCoord, MapTile, POIType, TileType } from '@/models/types';
import { getHexesInRange, hexDistance, hexKey } from '@/utils/hexUtils';
import {
  dangerOnRoute,
  holdsEncounter,
  planTravel,
  quietAfterVictory,
} from '@/systems/world/travel';
import { BALANCE } from '@/data/balanceConstants';

/**
 * A journey is every tile of it.
 *
 * The overworld used to react to exactly one hex per journey — the one tapped —
 * so the ground a route crossed was decoration. These pin the rule that replaced
 * that, and the two ways it is allowed to be surprising: the party stops *on*
 * the tile that caught them, and the preview never tells them which of the
 * dangerous ones is loaded.
 */

const at = (q: number, r: number): HexCoord => ({ q, r });

function tile(coord: HexCoord, extra: Partial<MapTile> = {}): MapTile {
  return {
    coord,
    type: TileType.Plains,
    explored: true,
    height: 0,
    threat: 0,
    ...extra,
  } as MapTile;
}

/** A straight west-to-east run of tiles, `danger` naming which q's are haunted. */
function road(length: number, danger: number[] = []): Map<string, MapTile> {
  const map = new Map<string, MapTile>();
  for (let q = 0; q < length; q++) {
    const coord = at(q, 0);
    map.set(hexKey(coord), tile(coord, { zone: danger.includes(q) ? 'haunted' : 'corridor' }));
  }
  return map;
}

const route = (length: number): HexCoord[] =>
  Array.from({ length }, (_, q) => at(q, 0));

const live = (map: Map<string, MapTile>) =>
  new Set([...map.values()].filter((t) => (t.zone === 'haunted')).map((t) => hexKey(t.coord)));

describe('planning a journey', () => {
  it('walks the whole route when nothing is waiting on it', () => {
    const map = road(6);
    const plan = planTravel(route(6), map, new Set());

    expect(plan.steps).toHaveLength(5);
    expect(plan.steps[4]).toEqual(at(5, 0));
    expect(plan.interceptedAt).toBeNull();
    expect(plan.hours).toBe(5);
  });

  it('stops on the tile that caught them, not before it', () => {
    const map = road(6, [3]);
    const plan = planTravel(route(6), map, live(map));

    // Standing *on* q=3 — the party walked into what was there, which is what
    // being ambushed is. Stopping short would put the fight on a hex the party
    // never reached and leave the arena's terrain reading off the wrong tile.
    expect(plan.steps[plan.steps.length - 1]).toEqual(at(3, 0));
    expect(plan.interceptedAt?.coord).toEqual(at(3, 0));
  });

  it('charges only for the hours actually walked', () => {
    const map = road(10, [2]);
    const plan = planTravel(route(10), map, live(map));

    // A ten-tile journey cut short at the second hex costs two hours, not ten.
    // The clock is what rolls the day over, heals at dawn and re-rolls the
    // encounters — paying for a walk that did not happen moves all three.
    expect(plan.hours).toBe(2);
    expect(plan.steps).toHaveLength(2);
  });

  it('never re-triggers the tile the party is standing on', () => {
    const map = road(4, [0]);
    const plan = planTravel(route(4), map, live(map));

    // q=0 is the start. Checking it would restart the fight just won every time
    // the party tried to leave the field it was won on.
    expect(plan.interceptedAt).toBeNull();
    expect(plan.steps).toHaveLength(3);
  });

  it('takes the first of several, and leaves the rest loaded', () => {
    const map = road(8, [2, 5]);
    const plan = planTravel(route(8), map, live(map));

    expect(plan.interceptedAt?.coord).toEqual(at(2, 0));
    // The second one is still there; the party has not walked past it.
    expect(holdsEncounter(map.get(hexKey(at(5, 0))), live(map))).toBe(true);
  });

  it('ignores dangerous ground with nothing rolled onto it', () => {
    const map = road(6, [2, 4]);
    // The day's roll came up empty. Danger ground is where a fight *can* happen,
    // not where one is happening.
    const plan = planTravel(route(6), map, new Set());

    expect(plan.interceptedAt).toBeNull();
    expect(plan.steps).toHaveLength(5);
  });

  it('stands still when the destination is where it already is', () => {
    const plan = planTravel([at(0, 0)], road(1), new Set());

    expect(plan.steps).toEqual([]);
    expect(plan.hours).toBe(0);
    expect(plan.interceptedAt).toBeNull();
  });

  it('fights on the destination itself, exactly as it always did', () => {
    const map = road(4, [3]);
    const plan = planTravel(route(4), map, live(map));

    expect(plan.interceptedAt?.coord).toEqual(at(3, 0));
    expect(plan.hours).toBe(3);
  });
});

describe('what the route preview is allowed to say', () => {
  it('marks dangerous ground whether or not it is loaded', () => {
    const map = road(7, [2, 5]);
    // No live encounters at all, and both still show. The player is told where
    // it is *possible* to be attacked, which the map's scorched tiles already
    // say — and told nothing about the roll, which would be a minesweeper
    // readout and would delete the risk the confirm step exists to weigh.
    expect(dangerOnRoute(route(7), map)).toEqual([at(2, 0), at(5, 0)]);
    expect(dangerOnRoute(route(7), map)).toEqual(dangerOnRoute(route(7), map));
  });

  it('says nothing about the tile the party is standing on', () => {
    const map = road(4, [0, 3]);
    expect(dangerOnRoute(route(4), map)).toEqual([at(3, 0)]);
  });
});

describe('the quiet a won fight leaves behind', () => {
  /**
   * The complaint this answers is that **a journey never completes**, which is
   * not the same fault as the map being too dense and does not want the same
   * fix. At the old rates a third of deep haunted tiles were live and
   * `planTravel` stops on the first one crossed, so a thirty-tile march was
   * roughly ten fights and ten aborted journeys. Thinning the whole world
   * answers a question nobody asked and re-creates the drought
   * `encounterSupply.test.ts` is named after; clearing the ground around a
   * warband that has just been wiped answers this one exactly.
   */
  const spread = (centre: HexCoord, radius: number) =>
    new Set(getHexesInRange(centre, radius).map(hexKey));

  it('spends the tile that was fought on', () => {
    // It **replaces** clearing that one tile rather than sitting beside it, so
    // a caller that forgot the old line would still be correct.
    const here = at(4, 4);
    const next = quietAfterVictory(here, new Set([hexKey(here)]));
    expect(next.has(hexKey(here))).toBe(false);
  });

  it('spends everything inside the radius and nothing outside it', () => {
    const here = at(0, 0);
    // A generous field of live tiles, so the boundary is measured rather than
    // assumed from the few hexes a hand-written fixture happens to name.
    const live = spread(here, BALANCE.ENCOUNTER_QUIET_RADIUS + 3);
    const next = quietAfterVictory(here, live);

    const wrong: string[] = [];
    for (const key of live) {
      const [q, r] = key.split(',').map(Number);
      const inside = hexDistance(here, at(q, r)) <= BALANCE.ENCOUNTER_QUIET_RADIUS;
      if (inside === next.has(key)) wrong.push(`${key} ${inside ? 'survived' : 'was cleared'}`);
    }
    expect(wrong).toEqual([]);
  });

  it('leaves the far side of the map exactly as it found it', () => {
    // The rule is local. A win in the home ring must not thin the ground around
    // a lair door thirty hexes away — that would be a density cut wearing a
    // quiet radius as a hat.
    const far = at(30, -12);
    const live = new Set([hexKey(far)]);
    expect(quietAfterVictory(at(0, 0), live)).toBe(live);
  });

  it('hands back the identical set when nothing was in reach', () => {
    // `toBe`, not `toEqual`: every victory in the game calls this, and the point
    // of returning the same object is that the caller can skip the store write
    // on `===` the way `questStore.report` does.
    const live = new Set<string>();
    expect(quietAfterVictory(at(0, 0), live)).toBe(live);
  });

  it('does not mutate the set it was given', () => {
    // The store holds this set and Zustand compares by identity. Clearing in
    // place would change what is live without any subscriber being told.
    const here = at(2, 2);
    const live = new Set([hexKey(here), hexKey(at(3, 2))]);
    quietAfterVictory(here, live);
    expect(live.size).toBe(2);
  });

  it('clears a gap rather than a hole', () => {
    /**
     * The size is the whole design, so it is pinned as arithmetic rather than
     * left to the constant. At radius 1 the party takes one step and is stopped
     * again, which reads as no rule at all; at 3 a single win clears 37 hexes,
     * which on a corridor route is most of a day's walking and would thin the
     * world by the back door — the thing the radius exists *instead of*.
     */
    expect(getHexesInRange(at(0, 0), BALANCE.ENCOUNTER_QUIET_RADIUS)).toHaveLength(19);
  });
});

describe('holdsEncounter', () => {
  const coord = at(1, 0);
  const key = hexKey(coord);
  const rolled = new Set([key]);

  it('needs the day’s roll as well as the ground', () => {
    expect(holdsEncounter(tile(coord, { zone: 'haunted' }), rolled)).toBe(true);
    // Haunted ground with nothing rolled onto it. The zone says where a fight
    // *can* happen; the set says where one *is* happening.
    expect(holdsEncounter(tile(coord, { zone: 'haunted' }), new Set())).toBe(false);
    expect(holdsEncounter(undefined, rolled)).toBe(false);
  });

  it('lets the corridor ambush you too', () => {
    // Quiet, not silent. The corridor carries a fraction of haunted ground's
    // encounter rate, so a corridor tile that came up in the roll is a fight —
    // and a predicate that refused one would make the safe route perfectly safe,
    // which is a different game from the one the zones describe.
    expect(holdsEncounter(tile(coord, { zone: 'corridor' }), rolled)).toBe(true);
  });

  it('never lets the road', () => {
    // Structural, not probabilistic. `ZONE_ENCOUNTER_RATE.road` is zero so the
    // roll can never name a road tile — but the set is persisted, and a save
    // whose roads moved would come back naming one.
    expect(holdsEncounter(tile(coord, { zone: 'road' }), rolled)).toBe(false);
  });

  it('never lets a destination', () => {
    // Every lair door, ore vein, well and quest site is placed in **haunted**
    // ground on purpose — that is the trade the zones exist to make — and
    // haunted ground is the zone that carries encounters. Without this a lair
    // door would roll a warband instead of opening, on a large fraction of the
    // walks to it, and read as broken.
    const door = tile(coord, { zone: 'haunted', poi: POIType.MagicWell });
    expect(holdsEncounter(door, rolled)).toBe(false);
  });
});
