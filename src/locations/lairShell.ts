import { HexCoord, getNeighbors, hexKey, hexToPixel } from '@/utils/hexUtils';
import { LocationSurface, LocationTile } from './types';

/**
 * What a lair is cut out of: the walls round its floor, the rock beyond them,
 * and how tall each of those may stand.
 *
 * A lair used to be walled by one ring of hexes a third of a unit high, in the
 * floor's own surface tinted darker — a kerb round a board, with the dark of
 * the canvas beyond it and, at the pinch-out limit, the rim of the ground disc
 * showing as a circle round the whole place. What makes a burrow, a tomb or a
 * cavern read as one is that the floor is *carved*: the walls stand up, they
 * are made of something, and there is more of that something behind them. So
 * the floor is ringed twice more, and the rock stands as tall as it may.
 *
 * **As tall as it may is measured, and it is the rule this module exists for.**
 * The follow camera looks down from the south, so anything standing south of a
 * floor tile leans over it: a wall on the near side of a corridor is a wall
 * between the camera and the corridor. `sightField` states that once — for any
 * point of the lair, the highest anything standing there may reach before it
 * hides the middle of some floor tile along the shallowest line of sight the
 * frame has. The walls take their heights from it, and so does every piece of
 * dressing (`components/location/lairDressing.ts`): one answer to "may this
 * stand here", which is how a wall and a guard post cannot disagree about a
 * doorway.
 *
 * Pure, the `locations/` rule, and run once per lair at import.
 */

/**
 * The shallowest line of sight a followed frame has, in degrees above the
 * ground: the location rig's pitch less half its vertical field of view. The
 * top edge of the frame looks along it; everywhere else looks down more
 * steeply, so a point clear along this line is clear anywhere in the frame.
 *
 * Restated rather than imported, because `locations/` is data and the rig is a
 * component module; `lairShell.test.ts` pins the two together.
 */
export const SIGHT_ELEVATION_DEG = 63.435 - 50 / 2;

/**
 * The bearings off due south a sight line is followed along, in degrees.
 *
 * The camera has no yaw, so every line of sight runs south from what it sees —
 * but not *due* south. Toward the top corners of a phone held sideways it
 * swings past fifty degrees, and it flattens as it does: along the frame's top
 * edge the rise is one number and the run grows with the swing, so the rise
 * per unit of ground falls with the bearing's cosine.
 *
 * **The middle of the frame, not its corners, and that is forced.** No wall a
 * room's side could hold and no lantern it could stand against keeps clear of a
 * line swung fifty degrees at the top edge's elevation — the first version
 * followed forty, and cut every south-east and south-west wall down to a kerb
 * and refused most of the lairs' fixtures outright. What a player is looking at
 * is the middle: the camera follows the party, so a tile in a top corner is a
 * tile the party is far from, and walking toward it brings it in, where the
 * lines are steeper. Twenty-four degrees either way is the middle third of a
 * phone's far edge at the opening zoom, and every nearer row, whose own lines
 * climb far more steeply than the top edge's.
 */
export const SIGHT_BEARINGS = [-24, -12, 0, 12, 24];

/**
 * How much of a floor tile must always be seen: a disc round its middle, where
 * the party stands, a chest sits and a finger lands.
 */
export const FLOOR_CORE = 0.3;

/**
 * How tall the shell stands, in world units above the floor — and there are
 * only the two.
 *
 * Every hex of rock is either the full height or a kerb, never something in
 * between. The first version let each hex stand as tall as its sight line
 * allowed, which is the most rock the camera can take, and it drew every
 * room's near side as a flight of hex columns stepping up and away — a mesa
 * made of hexes rather than rock with a room cut into it. Two heights is the
 * cut-away every overhead dungeon is drawn as: the far walls stand, the near
 * ones are sliced off at a kerb so the room can be seen into, and the rock
 * between them is one level mass.
 */
export const SHELL = {
  /**
   * The kerb: rock between the camera and the floor, sliced low so the camera
   * looks over it — the height every lair's walls had before this.
   */
  front: 0.3,
  /** Everything else: the far walls and the mass they belong to. */
  wall: 1.5,
} as const;

/** How many rings of wall and rock a lair's floor is cut into. */
export const SHELL_RINGS = 3;

/**
 * The rock's shade over its surface's own colour: none. The rock is one mass
 * (`terrainDisplay.rockFaceFor`), and a shade that stepped ring by ring drew
 * the rings — a hex-edged band round every room, which is the board the mass
 * exists not to be. Stated so the scene's default darkening for blocked ground,
 * which is right for a town's walls, does not reach it.
 */
export const ROCK_TINT = '#ffffff';


/**
 * The shade over a floor tile by how many walls it touches: the floor goes
 * darker toward the walls it meets, which is most of what says where a room's
 * edge is before anything has been stood against it.
 */
export const EDGE_TINT = ['#ffffff', '#ececec', '#e0e0e0', '#d6d6d6'] as const;

/** The height a floor tile's top stands at: `tileTopY(0)`. */
export const FLOOR_TOP = 0.1;

/**
 * How far the sight lines are followed, in world units: past it a line has
 * risen higher than anything a lair stands — its walls, or its tallest fixture.
 */
const REACH = 4.5;

/** A convex outline on the ground, as world `[x, z]` corners in order round it. */
export type Outline = readonly (readonly [number, number])[];

/**
 * For anything standing in a lair, how high above the floor it may reach
 * without hiding the core of a floor tile from the camera.
 */
export interface SightField {
  /**
   * The lowest any sight line passes over a convex outline — so the tallest a
   * thing standing on exactly that ground may be. `Infinity` where no line
   * crosses it.
   */
  clearance(outline: Outline): number;
}

/**
 * The field, from the floor the party can stand on.
 *
 * **Exact, not rasterised.** From the middle of every floor tile and four
 * points round its core, along every bearing, a line rises by
 * `tan(SIGHT_ELEVATION_DEG) · cos(bearing)` per unit of ground, and a thing
 * whose outline it enters may not be taller than the line is where it enters —
 * every line rises the whole way, so where it enters is where it is lowest. The
 * first version rasterised the lines onto a grid a fifth of a unit fine, and a
 * grid is wrong in both directions at once: a line stepping a tenth of a unit
 * clipped a cell's corner without marking it, which stood walls in sight
 * lines, and marking each sample's neighbours to close that smeared every core's
 * zero out to two thirds of a hex, which refused a vent a tenth of a unit tall
 * against a wall. Clipping a line against an outline has neither fault, and is
 * cheaper than the grid was to fill.
 */
export function sightField(open: HexCoord[]): SightField {
  const rise = Math.tan(SIGHT_ELEVATION_DEG * (Math.PI / 180));
  const core: [number, number][] = [
    [0, 0], [FLOOR_CORE, 0], [-FLOOR_CORE, 0], [0, FLOOR_CORE], [0, -FLOOR_CORE],
  ];
  const rays = SIGHT_BEARINGS.map((deg) => {
    const b = deg * (Math.PI / 180);
    return { dx: Math.sin(b), dz: Math.cos(b), slope: rise * Math.cos(b) };
  });
  // The cores, bucketed two units square, so an outline asks only the ones
  // whose lines could reach it
  const BUCKET = 2;
  const buckets = new Map<number, [number, number][]>();
  const bucketOf = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
  for (const c of open.map(hexToPixel)) {
    for (const [ox, oz] of core) {
      const x = c.x + ox;
      const z = c.y + oz;
      const k = bucketOf(Math.floor(x / BUCKET), Math.floor(z / BUCKET));
      const list = buckets.get(k);
      if (list) list.push([x, z]);
      else buckets.set(k, [[x, z]]);
    }
  }
  const sideways = REACH * Math.sin((Math.max(...SIGHT_BEARINGS.map(Math.abs)) * Math.PI) / 180);

  return {
    clearance(outline) {
      const xs = outline.map((p) => p[0]);
      const zs = outline.map((p) => p[1]);
      const x0 = Math.min(...xs) - sideways;
      const x1 = Math.max(...xs) + sideways;
      // Lines run south, so only cores north of the outline's far edge, and
      // within a reach of it, can cross it
      const z0 = Math.min(...zs) - REACH;
      const z1 = Math.max(...zs);
      // Outward normals, whichever way round the outline is wound
      let area = 0;
      for (let i = 0; i < outline.length; i++) {
        const [ax, az] = outline[i];
        const [bx, bz] = outline[(i + 1) % outline.length];
        area += ax * bz - bx * az;
      }
      const sign = area >= 0 ? 1 : -1;
      const edges = outline.map(([ax, az], i) => {
        const [bx, bz] = outline[(i + 1) % outline.length];
        return { ax, az, nx: sign * (bz - az), nz: -sign * (bx - ax) };
      });
      let best = Infinity;
      for (let i = Math.floor(x0 / BUCKET); i <= Math.floor(x1 / BUCKET); i++) {
        for (let j = Math.floor(z0 / BUCKET); j <= Math.floor(z1 / BUCKET); j++) {
          const list = buckets.get(bucketOf(i, j));
          if (!list) continue;
          for (const [cx, cz] of list) {
            if (cz > z1 || cz < z0) continue;
            for (const { dx, dz, slope } of rays) {
              // Cyrus–Beck: the stretch of the line inside every edge's half-plane
              let enter = 0;
              let leave = REACH;
              for (const e of edges) {
                const num = e.nx * (e.ax - cx) + e.nz * (e.az - cz);
                const den = e.nx * dx + e.nz * dz;
                if (Math.abs(den) < 1e-12) {
                  if (num < 0) { enter = Infinity; break; }
                  continue;
                }
                const t = num / den;
                if (den < 0) { if (t > enter) enter = t; } else if (t < leave) leave = t;
                if (enter > leave) break;
              }
              if (enter <= leave && enter * slope < best) best = enter * slope;
            }
          }
        }
      }
      return best;
    },
  };
}

/** A hex's top as an outline: the six corners of a pointy-top hex of radius 1. */
export function hexOutline(coord: HexCoord): Outline {
  const c = hexToPixel(coord);
  return Array.from({ length: 6 }, (_, k) =>
    [c.x + Math.sin((Math.PI / 3) * k), c.y + Math.cos((Math.PI / 3) * k)] as const);
}

/** The least the field allows anywhere over a hex's own top. */
export function hexAllowance(field: SightField, coord: HexCoord): number {
  return field.clearance(hexOutline(coord));
}

/** The `LocationTile.height` that stands a tile's top `top` world units above the floor. */
export const heightFor = (top: number) => top / 0.3;

/**
 * A lair's floor, cut into its rock.
 *
 * `laid` is everything the builder has put down — the floor, and the walls it
 * has already placed across a doorway's flanks. Those flanks are walls like any
 * other and take the same heights; everything else blocked is new, ring by
 * ring: the wall touching the floor, then rock. `mouth` is ground the rock
 * leaves open — the passage past a lair's exit — and gets no tile at all.
 * Returns the whole place.
 */
export function lairShell(
  laid: LocationTile[], surface: LocationSurface, mouth: HexCoord[] = [],
): LocationTile[] {
  const open = laid.filter((t) => !t.blocked).map((t) => t.coord);
  const openKeys = new Set(open.map(hexKey));
  const field = sightField(open);

  /**
   * How tall a hex of the shell stands: the full height wherever the camera
   * allows it, and a kerb wherever it would stand between the camera and the
   * floor — including every wall with floor due north of it, whatever the
   * sight lines say, because a wall there is one the camera looks *over*.
   */
  const topOf = (coord: HexCoord): number => {
    const p = hexToPixel(coord);
    const facesFloor = getNeighbors(coord)
      .some((n) => openKeys.has(hexKey(n)) && hexToPixel(n).y < p.y - 0.1);
    if (facesFloor) return SHELL.front;
    return hexAllowance(field, coord) >= SHELL.wall ? SHELL.wall : SHELL.front;
  };

  const out = laid.map((t) => {
    if (!t.blocked) return t;
    return { ...t, height: heightFor(topOf(t.coord)), tint: ROCK_TINT };
  });

  const taken = new Set([...laid.map((t) => hexKey(t.coord)), ...mouth.map(hexKey)]);
  let edge = laid.map((t) => t.coord);
  for (let ring = 0; ring < SHELL_RINGS; ring++) {
    const next = new Map<string, HexCoord>();
    for (const c of edge) {
      for (const n of getNeighbors(c)) {
        const key = hexKey(n);
        if (taken.has(key) || next.has(key)) continue;
        next.set(key, n);
      }
    }
    for (const [key, coord] of next) {
      taken.add(key);
      out.push({ coord, surface, height: heightFor(topOf(coord)), blocked: true, tint: ROCK_TINT });
    }
    edge = [...next.values()];
  }

  // The floor darkens toward the walls it touches
  const solid = new Set(out.filter((t) => t.blocked).map((t) => hexKey(t.coord)));
  return out.map((t) => {
    if (t.blocked) return t;
    const walls = getNeighbors(t.coord).filter((n) => solid.has(hexKey(n))).length;
    return walls === 0 ? t : { ...t, tint: EDGE_TINT[Math.min(walls, EDGE_TINT.length - 1)] };
  });
}
