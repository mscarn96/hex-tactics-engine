import { generateMap, isPassable, movementCost } from '@/systems/world/mapGenerator';
import { BALANCE } from '@/data/balanceConstants';
import { getNeighbors, hexDistance, hexKey } from '@/utils/hexUtils';
import { MapTile, POIType, TileZone } from '@/models/types';

/**
 * The shape of the world.
 *
 * The overworld used to be a noise field with a difficulty gradient over it —
 * texture, but no structure. Nothing on it was a route, a frontier or a place
 * you decided to leave. These pin the structure that replaced it, and every one
 * of them guards a rule that is **invisible at runtime**: a map with no roads,
 * or with every lair door sitting on the safe route, renders perfectly and plays
 * as a different game.
 *
 * Several seeds, because generation is seeded and a rule that holds on one map
 * is a rule that has been observed once.
 */

const SEEDS = [1, 7, 42, 99, 1234];

interface World {
  tiles: MapTile[];
  byKey: Map<string, MapTile>;
  city: MapTile;
  castle: MapTile;
}

const worlds: { seed: number; world: World }[] = SEEDS.map((seed) => {
  const tiles = generateMap(seed);
  const byKey = new Map(tiles.map((t) => [hexKey(t.coord), t]));
  return {
    seed,
    world: {
      tiles,
      byKey,
      city: tiles.find((t) => t.poi === POIType.City)!,
      castle: tiles.find((t) => t.poi === POIType.EmpireCastle)!,
    },
  };
});

const each = (fn: (world: World, seed: number) => string[]) => {
  const offenders: string[] = [];
  for (const { seed, world } of worlds) offenders.push(...fn(world, seed));
  expect(offenders).toEqual([]);
};

const share = (tiles: MapTile[], zone: TileZone) =>
  tiles.filter((t) => t.zone === zone).length / Math.max(1, tiles.length);

describe('every tile is exactly one zone', () => {
  it('assigns one of the three, always', () => {
    each((world, seed) =>
      world.tiles
        .filter((t) => t.zone !== 'road' && t.zone !== 'corridor' && t.zone !== 'haunted')
        .slice(0, 3)
        .map((t) => `${seed}: ${hexKey(t.coord)} is ${String(t.zone)}`),
    );
  });
});

describe('the road network', () => {
  it('joins the city to the castle without leaving the road', () => {
    /**
     * The load-bearing one. "Walk the road from home to the Emperor" is the
     * navigational promise the whole network exists to make, and a branch that
     * happens to look connected on screen while leaving a one-hex gap breaks it
     * silently — the player simply cannot find a safe route and has no way to
     * know one was intended.
     *
     * Flood-filled over road tiles only, from the city.
     */
    each((world, seed) => {
      const seen = new Set([hexKey(world.city.coord)]);
      const queue = [world.city.coord];
      for (let head = 0; head < queue.length; head++) {
        for (const next of getNeighbors(queue[head])) {
          const key = hexKey(next);
          const tile = world.byKey.get(key);
          if (!tile || seen.has(key) || tile.zone !== 'road') continue;
          seen.add(key);
          queue.push(next);
        }
      }
      return seen.has(hexKey(world.castle.coord)) ? [] : [`${seed}: castle unreachable by road`];
    });
  });

  it('runs unbroken — no road tile stands alone', () => {
    each((world, seed) =>
      world.tiles
        .filter((t) => t.zone === 'road')
        .filter((t) => !getNeighbors(t.coord).some((n) => world.byKey.get(hexKey(n))?.zone === 'road'))
        .slice(0, 3)
        .map((t) => `${seed}: orphan road at ${hexKey(t.coord)}`),
    );
  });

  it('never stops in open ground', () => {
    /**
     * A road is a made thing: somebody built it, to get somewhere. Branches used
     * to fork off the artery, wander for eight to twenty-two hexes and simply
     * stop, on the argument that the frontier is where the safe ground runs
     * out — and a playtest read every one of those as **unfinished generation**
     * rather than as a frontier, with the far half of the map carrying no
     * infrastructure at all. The frontier lives in the ground *between* the
     * roads now.
     *
     * So: a road tile with one road neighbour is a terminus, and a terminus has
     * to be somewhere. The four legal ones are the map edge, the city, the
     * castle and a POI — everything else is a leg that gave up. Stated as the
     * rule rather than as a count, because a generator that dead-ends *once*
     * fails for exactly the same reason as one that dead-ends fifty times, and a
     * count is a number somebody raises to make a run go green.
     *
     * The edge test is "is a neighbour missing" rather than a coordinate
     * comparison: the map is a parallelogram in axial space with a staircase
     * along two of its sides, so there is no arithmetic for "on the boundary"
     * that the tile map does not already answer.
     */
    each((world, seed) => {
      const onEdge = (t: MapTile) =>
        getNeighbors(t.coord).some((n) => !world.byKey.has(hexKey(n)));

      return world.tiles
        .filter((t) => t.zone === 'road')
        .filter((t) => !t.poi && !onEdge(t))
        .filter(
          (t) =>
            getNeighbors(t.coord).filter((n) => world.byKey.get(hexKey(n))?.zone === 'road')
              .length <= 1,
        )
        .slice(0, 5)
        .map((t) => `${seed}: road dead-ends in open ground at ${hexKey(t.coord)}`);
    });
  });

  it('is walkable end to end', () => {
    // Every road tile is forced level by `pave`. A road that dead-ends in a lake
    // is a generated map quietly cancelling the route it drew.
    each((world, seed) =>
      world.tiles
        .filter((t) => t.zone === 'road' && !isPassable(t.type))
        .slice(0, 3)
        .map((t) => `${seed}: impassable road at ${hexKey(t.coord)}`),
    );
  });

  it('is faster to follow than to leave', () => {
    each((world, seed) => {
      const road = world.tiles.find(
        (t) => t.zone === 'road' &&
          getNeighbors(t.coord).some((n) => world.byKey.get(hexKey(n))?.zone === 'road'),
      );
      if (!road) return [`${seed}: no road at all`];

      const along = world.byKey.get(
        hexKey(getNeighbors(road.coord).find((n) => world.byKey.get(hexKey(n))?.zone === 'road')!),
      )!;
      // Both ends road: the discount applies to *using* the road, not to having
      // been near one, so a route clipping a road tile gets no rebate.
      if (movementCost(road, along) !== BALANCE.ROAD_HOURS) {
        return [`${seed}: road-to-road cost ${movementCost(road, along)}`];
      }
      return [];
    });
  });
});

describe('the corridor', () => {
  /** Breadth-first hop count from the nearest road, capped where it stops mattering. */
  const roadDistance = (world: World): Map<string, number> => {
    const distance = new Map<string, number>();
    const queue: typeof world.city.coord[] = [];
    for (const tile of world.tiles) {
      if (tile.zone === 'road') {
        distance.set(hexKey(tile.coord), 0);
        queue.push(tile.coord);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const d = distance.get(hexKey(queue[head]))!;
      if (d > BALANCE.CORRIDOR_MAX) continue;
      for (const next of getNeighbors(queue[head])) {
        const key = hexKey(next);
        if (!world.byKey.has(key) || distance.has(key)) continue;
        distance.set(key, d + 1);
        queue.push(next);
      }
    }
    return distance;
  };

  it('never strays further from a road than its widest setting', () => {
    // Exact, not a neighbour check: the width is sampled from value noise per
    // tile, so the only way to know a corridor tile is legal is to count the
    // hops. A fuzzy version would pass a generator that had quietly stopped
    // bounding the width at all.
    each((world, seed) => {
      const distance = roadDistance(world);
      return world.tiles
        .filter((t) => t.zone === 'corridor')
        // The apron is forced corridor regardless of where the roads went — see
        // `assignZones` — so it is the one legitimate exception.
        .filter((t) => hexDistance(t.coord, world.city.coord) >= BALANCE.HOME_HAUNTED_INNER)
        .filter((t) => (distance.get(hexKey(t.coord)) ?? Infinity) > BALANCE.CORRIDOR_MAX)
        .slice(0, 3)
        .map((t) => `${seed}: corridor at ${hexKey(t.coord)} is ${distance.get(hexKey(t.coord))} from a road`);
    });
  });

  it('never leaves ground beside a road haunted, away from home', () => {
    /**
     * The other half, and the one that would catch a noise field that had come
     * unmoored: anything within `CORRIDOR_MIN` of a road is corridor whatever
     * the width roll said, because `CORRIDOR_MIN` is the floor of the window.
     *
     * The home ring is exempt, and deliberately. `ensureHomeHaunted` guarantees
     * a party something to fight in its first ten minutes, and on a seed that
     * drops the city into a dense junction there is no ground in the ring
     * *except* the road's margin — so the floor takes it. That is the right way
     * round: a margin is aesthetic, and a new save with nothing in reach is not.
     */
    each((world, seed) => {
      const distance = roadDistance(world);
      return world.tiles
        .filter((t) => t.zone === 'haunted')
        .filter((t) => hexDistance(t.coord, world.city.coord) > BALANCE.HOME_HAUNTED_RADIUS)
        // So is the castle's ring, which is haunted on purpose (playtest 2026-10-23)
        .filter((t) => hexDistance(t.coord, world.castle.coord) > BALANCE.CASTLE_HAUNTED_RADIUS)
        .filter((t) => (distance.get(hexKey(t.coord)) ?? Infinity) <= BALANCE.CORRIDOR_MIN)
        .slice(0, 3)
        .map((t) => `${seed}: haunted at ${hexKey(t.coord)}, ${distance.get(hexKey(t.coord))} from a road`);
    });
  });

  it('haunts every off-road tile around the Obsidian castle', () => {
    each((world, seed) => world.tiles
      .filter((t) => hexDistance(t.coord, world.castle.coord) <= BALANCE.CASTLE_HAUNTED_RADIUS)
      .filter((t) => t.zone !== 'road' && !t.poi && t.zone !== 'haunted')
      .slice(0, 3)
      .map((t) => `${seed}: ${t.zone} at ${hexKey(t.coord)} beside the castle`));
  });

  it('leaves haunted ground the clear majority of the map', () => {
    // What "2-3 hexes, haunted is most of the map" comes out as. A network
    // dense enough to make the corridor the majority would be a map with no
    // frontier; one sparse enough to be invisible was the first attempt, at 88%.
    each((world, seed) => {
      const haunted = share(world.tiles, 'haunted');
      if (haunted < 0.6 || haunted > 0.85) return [`${seed}: haunted ${haunted.toFixed(2)}`];
      return [];
    });
  });
});

describe('the city apron', () => {
  it('is never haunted', () => {
    // Stepping out of your own gate should never be an ambush, and the walk out
    // is where a new player reads the threat labels for the first time. The
    // roads alone do not guarantee this: the artery runs through the gate in one
    // direction, so a tile three hexes out perpendicular to it can fall outside
    // the corridor and come back haunted.
    each((world, seed) =>
      world.tiles
        .filter(
          (t) =>
            hexDistance(t.coord, world.city.coord) < BALANCE.HOME_HAUNTED_INNER &&
            t.zone === 'haunted',
        )
        .slice(0, 3)
        .map((t) => `${seed}: haunted apron at ${hexKey(t.coord)}`),
    );
  });
});

describe('where content is allowed to sit', () => {
  const DESTINATIONS = [
    POIType.BossTile,
    POIType.MagicWell,
    POIType.QuestSite,
  ];

  it('puts every destination in haunted ground', () => {
    /**
     * The deal the whole structure is built on: the road is safe and pays
     * nothing. A find beside a road would be free money for staying on
     * the safe route, which is precisely the decision the zones exist to make
     * expensive.
     */
    each((world, seed) =>
      world.tiles
        .filter((t) => t.poi && DESTINATIONS.includes(t.poi))
        .filter((t) => t.zone !== 'haunted')
        .slice(0, 3)
        .map((t) => `${seed}: ${t.poi} in ${t.zone}`),
    );
  });

  it('keeps people on the safe side', () => {
    // Waysides are the inverse case, and they are *preferred* onto roads. A
    // hermit living in the worst ground on the map, with the map's highest
    // encounter rate on his doorstep, is not a quest giver anyone can reliably
    // reach.
    each((world, seed) =>
      world.tiles
        .filter((t) => t.poi === POIType.Wayside && t.zone === 'haunted')
        .map((t) => `${seed}: ${t.npcId} in haunted ground`),
    );
  });
});
