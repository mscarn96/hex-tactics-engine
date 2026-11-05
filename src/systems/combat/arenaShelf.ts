import { patchNoise } from '@/data/display/groundPatches';
import { ShelfSpec } from '@/data/display/sceneryKits';
import { arenaHexes } from '@/systems/combat/arenaGeometry';
import { hexToPixel } from '@/utils/hexUtils';

/**
 * The ground the board stands on, as a pure function.
 *
 * Sibling to `arenaScenery`, and split from it for the reason that module's own
 * water is split from its props: the answer goes to three layers that may not
 * disagree. The scene extrudes the terraces, the cosmetic hex field stops at the
 * lip, and every scenic prop past it stands on whatever level is under its own
 * feet. One derivation, three readers — a second answer to "how high is the
 * ground here" is a prop floating over a cliff, and it would be a prop nobody
 * notices because it renders perfectly.
 *
 * **Cosmetic by construction, and the construction is arithmetic rather than a
 * convention.** `shelfHeight` returns 0 for every position within `radius` of
 * the centre and the smallest authored radius clears the board's circumradius
 * (8.66) plus a hex, so no playable hex, no movement range, no targeting shape
 * and no unit position moves. `arenaShelf.test.ts` measures that against the
 * real board rather than trusting this sentence.
 *
 * Free of `three` and of React, the `terrainDisplay` rule, so the shape of the
 * land is measurable in the node suites.
 */

/**
 * How far the flat disc in `CombatScene` runs, in world units.
 *
 * Restated rather than imported because `systems/` may not reach into
 * `components/` — the arrangement `tanPitch` and `ArenaFrame` already use — and
 * `arenaShelf.test.ts` pins that the scene's own literal still agrees with it.
 * A shelf that ended short of the plane would put a ring-shaped step in the far
 * distance, which is the "exposed ground disc" this whole landform exists to
 * make impossible.
 */
export const SHELF_PLANE_R = 170;

/**
 * How many bearings the rim is drawn at.
 *
 * The lip is a curve and the renderer wants triangles, so something has to pick
 * a step. 192 puts a vertex every 1.9°, which at the nearest authored radius is
 * a segment about a third of a hex wide — under the wobble's own feature size,
 * so the shape is carried by the noise rather than by the tessellation.
 */
export const SHELF_SEGMENTS = 192;

/**
 * How much the lip wanders, as a share of its authored radius.
 *
 * **A circular lip is a circular room, which is the one verdict this feature is
 * forbidden from earning** — the task's own acceptance criterion says the scene
 * must not resemble a circular stone room, and an arc struck at a constant
 * radius about the board's centre is exactly that with the middle taken out.
 * Value noise rather than a per-bearing roll, for `MapTile.zone`'s reason one
 * scene over: an independent roll per vertex is a dithered edge that reads as a
 * rendering fault, and coherent noise is a coastline.
 */
const WOBBLE = 0.13;

/** How many noise cells the wobble field wraps round the circle. */
const WOBBLE_CELLS = 2.7;

/**
 * The share of a sector's half-width that holds the authored radius before the
 * lip starts running outward.
 *
 * The rest is the taper, and **it is cubic rather than linear or smooth**. The
 * lip has to leave the frame rather than end in it, so what the taper must not
 * do is spend its width near the board: a linear ramp from 11.5 to 170 puts the
 * halfway point at 90 units, which is already past anything visible, but a
 * *smoothstep* is flat at both ends and so lingers beside the board for a fifth
 * of the sector before flaring. `t³` does the opposite — a tenth of the way
 * through the taper the lip has moved a sixth of a unit — so what is drawn
 * inside the frame is a lip at its authored radius curving gently away.
 */
const CORE_SHARE = 0.55;

/**
 * How much clear ground the board keeps inside the lip, in world units.
 *
 * A hex's circumradius — how far a prism's corner reaches past its own centre —
 * because a hex whose *centre* clears the lip still hangs its far corner over
 * the drop, and a hexagon floating in mid-air over a cliff is the seam the
 * acceptance criterion names. `shelfHeight`'s own `margin` parameter is the
 * same number read from the other side.
 */
export const SHELF_CLEARANCE = 1;

let reach: number | null = null;

/**
 * How far the furthest playable hex stands from the board's centre.
 *
 * Derived from `arenaHexes` rather than written down, the rule the whole arena
 * rests on: an editor clamping a lip against a board of its own would place
 * every drop against the wrong outline and look perfectly correct doing it.
 * Memoised because the board's shape never changes and this is asked on every
 * frame of a drag.
 */
export function boardReach(): number {
  if (reach === null) {
    reach = Math.max(...arenaHexes().map((hex) => {
      const p = hexToPixel(hex);
      return Math.hypot(p.x, p.y);
    }));
  }
  return reach;
}

/**
 * The closest a lip may be authored, in world units.
 *
 * **The cosmetic guarantee, stated as a number a tool can refuse rather than
 * as a sentence a reviewer has to check.** `shelfHeight` returns zero inside
 * the lip, so a drop over playable ground would move a unit, a movement range
 * and a targeting shape — which is the one thing in this whole landform that is
 * not a matter of taste. Until an editor existed the rule lived only in
 * `arenaShelf.test.ts`, which is the right place to catch a kit somebody typed
 * and the wrong place to catch a radius somebody is dragging.
 *
 * **Divided by the wobble, because the wobble is a multiplier.** The smallest
 * lip a spec can produce is its authored radius less the wander, so authoring
 * exactly `boardReach() + SHELF_CLEARANCE` would still graze the board on the
 * seeds where the noise runs low.
 */
export const minShelfRadius = (): number =>
  (boardReach() + SHELF_CLEARANCE) / (1 - WOBBLE);

/**
 * The furthest a lip may be authored, in world units.
 *
 * Not a matter of taste either: the taper runs the lip from its authored radius
 * out to `SHELF_PLANE_R`, so a rim past the plane makes that term negative and
 * the sector's flanks curve *inward* — a lip that bulges toward the board at
 * the edges of its own sector, which is a shape nobody could mean. Held below
 * the plane at the top of the wobble for `minShelfRadius`'s reason.
 */
export const maxShelfRadius = (): number => SHELF_PLANE_R / (1 + WOBBLE);

/** How far off a sector's centre a bearing is, folded to [0, π]. */
function bearingOffset(bearing: number, centre: number): number {
  let off = Math.abs(bearing - centre) % (Math.PI * 2);
  if (off > Math.PI) off = Math.PI * 2 - off;
  return off;
}

/**
 * World distance from the board's centre at which the shelf ends on a bearing.
 *
 * `SHELF_PLANE_R` where no edge covers it, which is "the land does not end" said
 * in the same units — so every caller reads one number and none of them has to
 * branch on whether this direction has a cliff in it.
 */
export function shelfRadius(spec: ShelfSpec, seed: number, bearing: number): number {
  let nearest = SHELF_PLANE_R;
  for (const edge of spec.edges) {
    const half = edge.sweep / 2;
    const off = bearingOffset(bearing, edge.bearing);
    if (off >= half) continue;
    // Wobbled first, tapered second. The other order multiplies the wobble into
    // the tapered radius, so a lip already running out to the horizon acquires a
    // twenty-unit waver nobody can see and the part beside the board — the only
    // part anybody can — barely moves.
    const wobble = 1 + WOBBLE * (patchNoise(
      Math.cos(bearing) * WOBBLE_CELLS, Math.sin(bearing) * WOBBLE_CELLS, seed + 57,
    ) - 0.5) * 2;
    const rim = edge.radius * wobble;
    const core = half * CORE_SHARE;
    const t = off <= core ? 0 : (off - core) / (half - core);
    const r = rim + (SHELF_PLANE_R - rim) * t * t * t;
    if (r < nearest) nearest = r;
  }
  return nearest;
}

/**
 * The ground's height at a world position: 0 on the shelf, stepping down past it.
 *
 * `margin` is what the caller is asking *for*. A prop asks at its own feet and
 * passes nothing; the cosmetic hex field passes a hex's circumradius, because a
 * prism whose centre is inside the lip still hangs its far corner out over the
 * drop — and a hexagon floating in mid-air over a cliff is precisely the seam
 * the acceptance criterion names.
 */
export function shelfHeight(
  spec: ShelfSpec, seed: number, x: number, z: number, margin = 0,
): number {
  const r = Math.hypot(x, z) + margin;
  const rim = shelfRadius(spec, seed, Math.atan2(z, x));
  if (r <= rim) return 0;
  const step = Math.min(spec.steps, Math.floor((r - rim) / spec.tread) + 1);
  return -(spec.drop * step) / spec.steps;
}

/**
 * How much lighter each ledge is than the one below it.
 *
 * **Stacked slabs are told apart by value or they are not told apart at all.**
 * The first render of the terraces drew every ledge in one colour, and what
 * reached the screen was a single grey wedge with four hairlines in it — the
 * risers are nearly edge-on at the bottom of a portrait frame, where the view
 * ray is the pitch *plus* half the field of view and so points almost straight
 * down, so the only thing left to separate one ledge from the next is its tone.
 * That is also what the reference's cliffs are made of: courses of rock at
 * slightly different values with a dark line between them.
 *
 * 13% a step, which is a third again over the ~10% at which the roster's own
 * contrast rule says a surface stops being visible against its neighbour.
 */
export const LEDGE_LIFT = 0.13;

/**
 * How much light a ledge gets, as a multiplier on the kit's `lower` colour.
 *
 * Level `steps` is the floor and takes it unchanged, so the authored colour is
 * the one the *bottom* is painted in and the ledges climb out of it. Authored
 * from the bottom because the bottom is the large area — the one thing that must
 * not be allowed to go so dark it reads as a hole.
 */
export function ledgeLight(spec: ShelfSpec, level: number): number {
  return 1 + LEDGE_LIFT * (spec.steps - level);
}

/** One level of the descent: how high it sits and how far out it reaches. */
export interface ShelfRing {
  y: number;
  /** Outer radius at each of `SHELF_SEGMENTS` bearings. */
  radii: number[];
}

/**
 * The whole landform as rings, in the order a renderer walks them.
 *
 * `rings[0]` is the lip itself at `y = 0` — the outer edge of the flat ground
 * the board is on — and each ring after it is one terrace. The last ring's `y`
 * is the full drop, which is where the lower country's own plane sits, so the
 * two meet by construction rather than by two numbers agreeing.
 *
 * Radii are clamped at `SHELF_PLANE_R`: outside the edges' sectors every ring
 * is already there, so the terraces collapse to nothing and the shelf is simply
 * the flat disc it replaced.
 */
export interface ShelfProfile {
  /** Bearings, ascending, one per segment. `angles.length === SHELF_SEGMENTS`. */
  angles: number[];
  rings: ShelfRing[];
}

export function shelfProfile(spec: ShelfSpec, seed: number): ShelfProfile {
  const angles: number[] = [];
  const lip: number[] = [];
  for (let i = 0; i < SHELF_SEGMENTS; i++) {
    const bearing = (i / SHELF_SEGMENTS) * Math.PI * 2 - Math.PI;
    angles.push(bearing);
    lip.push(shelfRadius(spec, seed, bearing));
  }
  const rings: ShelfRing[] = [{ y: 0, radii: lip }];
  for (let k = 1; k <= spec.steps; k++) {
    rings.push({
      y: -(spec.drop * k) / spec.steps,
      radii: lip.map((r) => Math.min(SHELF_PLANE_R, r + spec.tread * k)),
    });
  }
  return { angles, rings };
}

/**
 * The turn that puts a mass's length along the circle and its +Z face toward
 * the board: `Ry` maps +X to `(cos, -sin)`, so a mass at bearing φ wants
 * `-(φ + π/2)` — the boundary segment's rule in `arenaScenery`, for its reason.
 */
export function massTurn(bearing: number): number {
  return -(bearing + Math.PI / 2);
}

/** One mass standing on the lower country, in world space. */
export interface ShelfMass {
  key: string;
  x: number;
  y: number;
  z: number;
  scale: number;
  rotationY: number;
}

/**
 * The distant landscape below the drop.
 *
 * **Spread by bearing across the edges' own sectors and pushed out in a ragged
 * second row**, rather than laid on one arc: a single ring of masses at one
 * radius is a fence at the bottom of the cliff, which says the world ends there
 * just as firmly as the bowl did. Two depths and a per-mass jitter is a range.
 *
 * Every one of them stands a full `drop` below the fight and is turned to face
 * the board, so what the player sees over the lip is rock seen from *above* —
 * which is the whole claim the composition has to make and the one thing a prop
 * standing on the shelf can never say however far away it is put.
 *
 * Deterministic in `seed` for the ring's reason: one fight looks the same every
 * frame, and two fights on the same ground do not look like the same clearing.
 */
export function shelfMasses(spec: ShelfSpec, seed: number): ShelfMass[] {
  const below = spec.below;
  if (!below?.keys.length || below.count <= 0 || !spec.edges.length) return [];
  const out: ShelfMass[] = [];
  const foot = spec.steps * spec.tread;
  for (let i = 0; i < below.count; i++) {
    // Even by bearing across the sectors, taken in author order — the same
    // spread `focalHex` gives an anchor count, and for the same reason.
    const share = (i + 0.5) / below.count;
    const edge = spec.edges[Math.min(spec.edges.length - 1,
      Math.floor(share * spec.edges.length))];
    const within = (share * spec.edges.length) % 1;
    const bearing = edge.bearing + (within - 0.5) * edge.sweep * 0.92;
    const jitter = patchNoise(i * 3.1, seed * 0.017, seed + 91);
    /**
     * Two rows, alternating: one **on the terraces** and one out on the floor.
     *
     * The first draft put both rows past the last tread, and at the reference
     * portrait aspect every single one of them landed outside the frame — the
     * visible ground on that flank runs to about thirteen world units and the
     * nearest mass stood at eighteen. A row on the ledges is what the frame can
     * actually hold, and it is the better picture anyway: rock stepping down the
     * cliff says the drop is made of something, where a row on the floor alone
     * is a fence at the bottom of it.
     */
    const rank = i % 2 === 0 ? 0.6 : 1.35;
    const r = shelfRadius(spec, seed, bearing) + foot * rank + jitter * 3.5;
    const x = Math.cos(bearing) * r;
    const z = Math.sin(bearing) * r;
    // Toward a sector's ends the lip runs out past it, and a mass on the fight's
    // own level is not the range below but a rock in the field.
    if (shelfHeight(spec, seed, x, z) >= 0) continue;
    out.push({
      key: below.keys[i % below.keys.length],
      x,
      // **The ground under its own feet, not the bottom of the drop.** A mass on
      // the second terrace stands on the second terrace; assuming the floor
      // would bury the near row up to its shoulders, which renders perfectly and
      // is exactly the class of fault a `tileTop` exists to end.
      y: shelfHeight(spec, seed, x, z),
      z,
      // Smaller further out, and never at full size: these are read as distance
      // and a mass at the wall course's own scale beside the board would be read
      // as part of the enclosure instead.
      scale: (rank > 1 ? 0.62 : 0.86) - jitter * 0.14,
      // Facing the board, the way a boundary segment does — a face of rock
      // across a valley presents its face, and a wall segment turned edge-on is
      // a slab. **The boundary's own turn, `-(bearing + π/2)`**: this used to
      // reverse the bearing through `atan2`, which lays a model's length along
      // the radius, so every mass stood end-on to the fight and a range of them
      // read as a row of posts. See `massTurn`.
      rotationY: massTurn(bearing),
    });
  }
  const crest = below.crest;
  const authored = Math.max(...spec.edges.map((edge) => edge.radius));
  for (let i = 0; crest && i < crest.count; i++) {
    // Evenly along the sector, the spread above's reason: independent rolls
    // clump, and a gap in a crest is two hills.
    const bearing = crest.bearing + ((i + 0.5) / crest.count - 0.5) * crest.sweep;
    const jitter = patchNoise(i * 2.3, seed * 0.013, seed + 137);
    // And the line wanders in and out in long swells, so it is a range lying
    // across the country rather than a ring drawn round the fight at one radius.
    const swell = patchNoise(i * 0.22, seed * 0.011, seed + 151);
    // Measured from the *authored* lip, not the drawn one: toward the ends of a
    // sector the drawn lip tapers out to the plane, and a line measured from it
    // runs out with it — which opened gaps of twenty units in the first draft.
    const r = authored + foot + crest.distance + (swell - 0.5) * 6;
    const x = Math.cos(bearing) * r;
    const z = Math.sin(bearing) * r;
    if (shelfHeight(spec, seed, x, z) >= 0) continue;
    out.push({
      key: below.keys[Math.abs(Math.floor(i * 7 + seed)) % below.keys.length],
      x,
      y: shelfHeight(spec, seed, x, z),
      z,
      // Larger than life-size: at this distance a ridge at its own scale is a
      // knee-high course of stone, and a line of those reads as a field wall
      // (the first draft did). Mountains are read by mass. Staggering alternate
      // pieces back a row was tried too and split the line into separate humps.
      // Capped at two: `arenaShelf.test.ts` holds every mass to the wall envelope
      // measured from its own base, and a full drop buys a little over double.
      scale: 1.5 + jitter * 0.5,
      rotationY: massTurn(bearing),
    });
  }
  return out;
}
