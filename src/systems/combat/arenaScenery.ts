import {
  HexCoord, getHexesInRange, getNeighbors, hexDistance, hexKey, hexToPixel, pixelToHex,
} from '@/utils/hexUtils';
import { ARENA_R_MAX, arenaHexes, inArena } from '@/systems/combat/arenaGeometry';
import { strHash, tileHash } from '@/data/display/terrainDisplay';
import { BALANCE } from '@/data/balanceConstants';
import { patchNoise } from '@/data/display/groundPatches';
import {
  BoundaryArc, EdgeFill, FocalAnchor, FocalGroup, HillSpec, MIN_WATER_HEXES, OpenGround, PropSource, QUIET_DENSITY, SceneryKit,
  SceneryTier, ScenicPlacement, ShelfSpec, TIER_ORDER, TIER_SIZE, TierSpec, WALL_SIZE, WallRing,
  WaterRegion,
} from '@/data/display/sceneryKits';
import {
  ShelfProfile, shelfHeight, shelfMasses, shelfProfile,
} from '@/systems/combat/arenaShelf';
import {
  HILL_CELL, HillBacked, HillField, HillKeep, buildHillField, hillFloor,
} from '@/systems/combat/arenaHills';
import { ArenaScenery } from './encounterContext';

/**
 * Scenery around the board, as a pure function.
 *
 * A fight in a forest should have trees around it, and until now every fight in
 * the game happened on sixty-one bare hexes with a blurred photograph behind
 * them. The *layout* is a rule, so it lives here where a node test can reach it;
 * the scene only turns each entry into an instance matrix.
 *
 * Cosmetic by construction — every hex it returns fails `inArena`, so nothing it
 * places can be stood on, targeted, pathed through or reasoned about by the AI.
 * That is deliberate: cover and line of sight are a combat-rules change, and
 * this is a presentation one.
 */
/**
 * Which rule placed a prop, re-exported from where the rules are declared.
 *
 * **The vocabulary moved down to `sceneryKits.ts` and this is the pointer**, so
 * no caller had to learn it — `encounterShapes.ts`'s arrangement one system
 * over, and for the same kind of reason. The names are one per placing field of
 * a `SceneryKit`, and the second reader is the layout format, which records the
 * origin of a *baked* placement and may not import a system. The composer is
 * still the only thing that writes one: nothing in this module reads a tag
 * back, so tagging a prop cannot move it.
 */
export type { PropSource } from '@/data/display/sceneryKits';

export interface ScenicProp {
  coord: HexCoord;
  propKey: string;
  /** Which rule placed it. Descriptive only — see {@link PropSource}. */
  from: PropSource;
  rotationY: number;
  /** Multiplies the prop def's own scale. */
  scale: number;
  /** World-space nudge off the hex centre, x and z. */
  offsetX: number;
  offsetZ: number;
  /**
   * The ground under this prop's own feet, when it is not zero.
   *
   * Every prop in the arena stood on one flat plane until a kit could declare a
   * `shelf`, so this was a field nothing needed. It is `placementAt`'s existing
   * `tileTop` — the same argument the world map uses to keep a hut out of a
   * hillside — and it is read by `groupPlacements` without any call site having
   * to learn the word "shelf".
   */
  tileTop?: number;
}

/**
 * How far past the board scenery may stand, in hexes.
 *
 * Widened from 3, and now from 5, because the board kept reading as a lit disc
 * floating in a void: one thin ring of props against black says "the world stops
 * here", and a ring five deep still ended abruptly enough to be seen ending.
 *
 * The reach is only half of what makes it read as distance. Filled at one rate
 * it would read as a wall of trees seven deep; `depthDensity` thins it toward
 * the rim, which is what a treeline actually does.
 */
export const RING_REACH = 7;

/**
 * What a composed ring may cost, and where each ceiling comes from.
 *
 * **Stated here rather than inside the suite that spends them**, because there
 * are two readers now. `arenaScenery.test.ts` has enforced every one of these
 * since the ring was written, and the Arena Forge reports against them live —
 * so a designer sees the ceiling they are walking toward instead of finding out
 * from a red suite once the composition is committed. Two hand-written copies
 * of a limit is one of them going stale, and here that would read as the editor
 * blessing a scene the gate then refuses.
 *
 * Every number is a **measurement of the shipped roster with headroom**, not a
 * figure picked to look safe. A band tight enough to fail on any retune is a
 * band that gets widened along with the constant it exists to watch.
 */
export const RING_BUDGET = {
  /**
   * Authored boxes in the whole composition, ground cover included.
   *
   * The densest shipped kit sits around 23,000, so this carries about a third
   * of headroom — it is the real ceiling on the low cover, which is why the
   * cover band below is deliberately generous.
   */
  boxes: 36000,
  /**
   * Triangles after the face cull, which is what is actually rastered.
   *
   * **Not implied by the box ceiling.** Burial runs 6.2 to 11.8 triangles per
   * authored box across the shipped kits — an interior of hand-placed slabs
   * buries most of itself, an open meadow of separate tufts buries almost
   * nothing — so two compositions of equal box count differ nearly twofold
   * here. Measured over every kit at every one of `REFERENCE_VIEWPORTS` the
   * dearest ring is 315,000, so this carries about the same quarter of headroom
   * the box ceiling carries over its own densest frame.
   *
   * **Measured across the frames rather than at `DEFAULT_REACH`**, because the
   * ring's size is a function of the viewport being composed for — the game
   * itself composes a wider ring on a desktop than on a phone — so a ceiling
   * stated at one reach is a ceiling that does not hold where the game is
   * played. The meadow is 267,000 at the default reach and 315,000 at a
   * 1920×1080 frame, which is most of the difference between the two numbers.
   *
   * It is the figure a regression shows up in: the mountain shelf's detail pass
   * moved that kit by more than three times, and nothing short of a capture
   * could see it.
   */
  triangles: 400000,
  /**
   * The ring without its ground cover — the enclosure, the landmarks, the
   * groups and the rolled tiers.
   *
   * The band that catches a ring silently emptying or flooding. It sits at
   * 102–247 across the eighteen kits, so both ends have room; the two levers on
   * it (`RING_REACH` and `ARENA_PROP_DENSITY`) multiply, which is why it is a
   * band rather than a ceiling.
   *
   * **Stated at `DEFAULT_REACH`, which is what makes it a fact about the kit's
   * rules rather than about a frame.** A prop count rises with the reach — the
   * dearest kit is 247 at the default and 300 at a 1920×1080 one — so the Arena
   * Forge, which composes at whichever viewport is selected, *reports* these
   * two beside their bands and leaves the verdict to the suite. The two
   * geometry ceilings above are the ones it fails on, and they are measured
   * across the frames for exactly this reason.
   */
  structural: { min: 60, max: 260 },
  /**
   * The low cover alone — what the `cover` rule put down.
   *
   * A floor as well as a ceiling, and the floor is the half worth having: a kit
   * declaring a cover list and composing almost none of it is bare ground that
   * nothing else in the repository would report.
   *
   * `structural`'s note about the reach applies here and is worth more: the
   * meadow composes 1,230 at the default reach and **1,374** at a 1920×1080
   * frame, which is twenty-six pieces short of this ceiling in a frame the game
   * is genuinely played at. Left alone rather than widened, because moving a
   * composition bound is the gate's decision and not a readout's.
   */
  cover: { min: 100, max: 1400 },
} as const;

/**
 * How far the ring may be pushed out to meet the frame, in hexes past the board.
 *
 * A ceiling rather than a target. `reachForFrame` derives what a viewport
 * actually needs, and on the two phone shapes that comes back enormous — the
 * landscape one sees ground 30 units in front of the board — because at those
 * framings the HUD has taken so much of the screen that the camera is clamped
 * far too close. Filling that is not a scenery problem and no amount of trees
 * answers it: the board is 2% of the landscape phone's frame, and the fix named
 * in Step 2 and deferred to Step 9 is to move a control. The cap is what keeps
 * the honest answer for the reference aspects from being paid for at the two
 * shapes where it would be spent on a frame with almost no fight in it.
 *
 * 20 is the reference portrait aspect's own answer, rounded up: at 720×1080 the
 * visible ground runs to z = −36.8 against a board rim at −7.5, which is 19.5
 * rows of 1.5.
 */
export const MAX_REACH = 20;

/**
 * The same ceiling in front of the board, and it is far lower.
 *
 * **Because only the excluded viewports ask for more.** At the reference
 * portrait aspect the visible ground reaches z = 19.6 against a board rim at
 * 8.5, which is eight rows — one past the authored ring. The two phone shapes
 * want fifteen, and that is the HUD clamp talking rather than the composition:
 * the board is 8% of one frame and 2% of the other.
 *
 * It also costs more per row than the rear does. The rear band takes the canopy
 * tier alone, one instance a hex; the front strip is the one place the envelope
 * allows nothing *but* ground cover, which places up to six pieces per hex. At
 * fifteen rows that took the forest composition from 24,000 authored boxes to
 * 43,000, through the 36,000 the suite caps a scene at — so the cap is the guard
 * speaking, not a preference.
 */
export const MAX_FRONT_REACH = 9;

/**
 * How far the ring runs past the board, in hexes, in front of it and behind it.
 *
 * **Two numbers because the visible ground is a trapezium and not a disc.** The
 * ring has always been a hex radius — the same reach in every direction — and
 * the camera has never seen anything like that: it is narrow at the near edge,
 * wide at the far one, and how far it reaches fore and aft is a function of the
 * viewport's *aspect*, because the fitted zoom is. Measured at the six baseline
 * viewports, the share of visible ground with no ring hex under it runs from
 * 5.7% on a 1024×768 desktop to 21.4% at the reference portrait aspect, and the
 * split between front and rear inverts on the way: desktop is 0% front and all
 * rear, the phones are two thirds front.
 */
export interface SceneryReach {
  front: number;
  rear: number;
}

/** What every caller got before the reach was a question. */
export const DEFAULT_REACH: SceneryReach = { front: RING_REACH, rear: RING_REACH };

/**
 * The ground the camera can see, as this module needs it.
 *
 * Structurally identical to `cameraRig`'s `GroundView` and deliberately **not**
 * imported from it: `systems/` may not reach into `components/`, which is the
 * same rule that makes the camera's pitch an argument rather than an import.
 * The scene hands `visibleGround(...)` straight in — the shapes match — so there
 * is one measurement and two names for it rather than two measurements.
 */
export interface ArenaFrame {
  /**
   * World x the frame is centred on — zero unless the scene has nudged the
   * camera sideways to seat the board in the HUD-safe rectangle. The arena
   * does, so a trapezium sampled about the origin misses one flank by that
   * much.
   */
  centreX: number;
  nearZ: number;
  farZ: number;
  nearHalfWidth: number;
  farHalfWidth: number;
}

/**
 * The reach that covers a frame, from the ground the camera can actually see.
 *
 * `visibleGround` in `cameraRig.ts` is where those numbers come from, and they
 * arrive as world coordinates rather than as a viewport so this module keeps
 * knowing nothing about canvases — the arrangement `tanPitch` already uses, and
 * for the same reason: `systems/` may not import `components/`.
 *
 * **Growing the reach only ever adds distant props; it never reshuffles one.**
 * Every placement is a seeded roll on the hex's own coordinate, so a hex's
 * answer does not depend on how many other hexes are in range — which is what
 * makes a frame-derived reach safe to change on a resize. A composition that
 * re-rolled itself when the window moved would be the worse bug.
 */
export function reachForFrame(view: ArenaFrame): SceneryReach {
  let front = RING_REACH;
  let rear = RING_REACH;

  // **Sampled along the frame's boundary, not taken from its depth.** The first
  // draft asked how many 1.5-unit rows separated the board's rim from the far
  // edge, and that answer is right only down the middle of the screen. The
  // trapezium is widest exactly where it is deepest, so its worst point is a
  // *corner*: on a 1440×900 desktop the far edge sits at z = −16.9, six rows
  // out and comfortably inside the authored ring, while the far corner beside
  // it sits 26.7 units off the axis and eleven hexes from the nearest board
  // hex. Measured, that corner is the whole of the desktop's bare 6–9%, and a
  // depth-only reach reported the desktop as needing nothing at all.
  const consider = (x: number, z: number) => {
    const depth = boardDepth(pixelToHex(x, z));
    if (z > BOARD_NEAR_Z) front = Math.max(front, Math.min(MAX_FRONT_REACH, depth));
    // Level with the board is the flank, which keeps the authored reach — see
    // `buildRing`. Letting a flank sample raise the rear would run the band out
    // behind the board to cover ground beside it.
    else if (z < -BOARD_NEAR_Z) rear = Math.max(rear, Math.min(MAX_REACH, depth));
  };

  // A far edge above the horizon is a real state (`visibleGround`), and the
  // honest answer for it is the cap: there is no finite ground to measure to.
  const farZ = Number.isFinite(view.farZ) ? view.farZ : -Infinity;
  if (!Number.isFinite(farZ)) rear = MAX_REACH;

  const STEPS = 16;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    // Both ends of each side, plus the near and far edges themselves. The board
    // is convex and so is the frame, so the deepest point of one from the other
    // is on the boundary — there is nothing in the interior to sample.
    consider(view.centreX + view.nearHalfWidth * (2 * t - 1), view.nearZ);
    if (!Number.isFinite(farZ)) continue;
    consider(view.centreX + view.farHalfWidth * (2 * t - 1), farZ);
    const z = view.nearZ + (farZ - view.nearZ) * t;
    const halfWidth = view.nearHalfWidth + (view.farHalfWidth - view.nearHalfWidth) * t;
    consider(view.centreX - halfWidth, z);
    consider(view.centreX + halfWidth, z);
  }
  return { front, rear };
}

/**
 * Depth past the board, in hexes, for each ring hex.
 *
 * Computed once with the ring itself: 61 arena hexes against ~400 candidates,
 * each needing its distance to the nearest board hex, is a scan nobody wants on
 * every fight — and the arena's shape never changes. Storing the depth rather
 * than recomputing it is what makes the falloff free.
 */
interface RingHex {
  coord: HexCoord;
  depth: number;
  /** World-space centre. The envelope below is geometry, not hex arithmetic. */
  x: number;
  z: number;
}

/**
 * How many hexes a coordinate sits past the playable board; 0 on it.
 *
 * Exported because the *scene* needs the same measurement: the cosmetic ground
 * around the board fades outward with it, and a second way of asking "how far
 * out is this" would be a second answer for the props and the ground under them
 * to disagree about. Cached, because the board's shape never changes and the
 * scene asks for every hex in the field on every fight.
 */
const DEPTHS = new Map<string, number>();

export function boardDepth(h: HexCoord): number {
  const key = hexKey(h);
  const cached = DEPTHS.get(key);
  if (cached !== undefined) return cached;
  const depth = inArena(h) ? 0 : Math.min(...arenaHexes().map((b) => hexDistance(h, b)));
  DEPTHS.set(key, depth);
  return depth;
}

function buildRing(reach: SceneryReach): RingHex[] {
  const boardKeys = new Set(arenaHexes().map(hexKey));
  const span = Math.max(reach.front, reach.rear);
  return getHexesInRange({ q: 0, r: 0 }, ARENA_R_MAX + span)
    .filter((h) => !boardKeys.has(hexKey(h)))
    .map((h) => {
      const p = hexToPixel(h);
      return { coord: h, depth: boardDepth(h), x: p.x, z: p.y };
    })
    // The reach is a trapezium, so which limit a hex answers to depends on
    // which side of the board it is on. **The flanks keep the authored reach**,
    // and that is measured rather than conceded: the share of visible ground
    // with no ring hex under it that lies level with the board is 0.1% at the
    // reference portrait aspect and at most 2.6% on a desktop. Letting the band
    // out there follow the rear would run the field to ±40 world units on a
    // frame half as wide, which is most of the extra hexes for none of the gap.
    .filter((h) => h.depth <= (h.z > BOARD_NEAR_Z ? reach.front
      : h.z < -BOARD_NEAR_Z ? reach.rear
      : RING_REACH));
}

/**
 * One ring per reach, built once.
 *
 * A handful of distinct reaches exist in a session — one per viewport shape the
 * window is dragged through — and each costs a `boardDepth` scan over up to two
 * thousand hexes. Rebuilding on every fight would put that on the scene's entry
 * cost, which is the one number Step 3 is already watching.
 */
const RINGS = new Map<string, RingHex[]>();

function ringFor(reach: SceneryReach): RingHex[] {
  const key = `${reach.front}|${reach.rear}`;
  const cached = RINGS.get(key);
  if (cached) return cached;
  const built = buildRing(reach);
  RINGS.set(key, built);
  return built;
}


// ─── The projection-safe scenery envelope ───────────────────────────────────

/**
 * A pointy-top hex at `HEX_SIZE = 1`: √3 across the flats, 2 between vertices.
 * Half of each, because every measurement below is from a centre outward.
 */
const HEX_HALF_X = Math.sqrt(3) / 2;
const HEX_HALF_Z = 1;
/** The circle that contains a whole hex, for the plan-overlap test. */
const HEX_CIRCUM = 1;

/** The board's hex centres in world space, built once — its shape never moves. */
const BOARD_POINTS: { x: number; z: number }[] = arenaHexes().map((h) => {
  const p = hexToPixel(h);
  return { x: p.x, z: p.y };
});

/**
 * World z of the board's rim on the camera's side. Anything past it is in front.
 *
 * `hexToPixel` maps +r to +z and the camera looks down -z, so larger z is nearer
 * the viewer — this is the near edge of the near-most playable hex, not a hex
 * centre, because a prop standing level with a centre is still standing on the
 * half of that hex a unit occupies.
 */
export const BOARD_NEAR_Z = Math.max(...BOARD_POINTS.map((b) => b.z)) + HEX_HALF_Z;

/** The board's extent in world x, least and greatest hex centre. See `HillBoard.spanX`. */
const BOARD_SPAN_X: [number, number] = [
  Math.min(...BOARD_POINTS.map((b) => b.x)), Math.max(...BOARD_POINTS.map((b) => b.x)),
];

/**
 * The authored ring — what every composition placed before the reach was a
 * question, and still what the wall course and the focal anchors are chosen
 * from. Built here rather than beside `ringFor` because it is an eager call and
 * `buildRing` reads `BOARD_NEAR_Z`, which is the line above.
 */
const RING: RingHex[] = ringFor(DEFAULT_REACH);

/**
 * The ground the camera reaches at the landscape phones, which is what an
 * `EdgeFill` covers.
 *
 * **Measured with `arenaReach`, not chosen**: every pose the gesture allows at
 * 932×430 and 844×390 — each rim hex's turn focus pulled out to the whole-board
 * fit and panned the full distance — sees ground to z = −25.5 behind the board
 * (22 hexes) and z = 16.5 in front of it (9 hexes), no wider than about
 * 27 − 0.75·z either side behind the near rim and narrowing toward the camera in
 * front of it. Each bound carries a hex of margin. They are the phones' rather
 * than a desktop's, because the phones are the product (the project notes); a desktop
 * frame sees past them and is not judged. `from` is `arenaReach`'s own
 * `NEAR_DEPTH` plus one: the two rings next to the board are the fight's margin.
 * In front of the board the low growth starts at the board's own edge
 * (`frontFrom`), because those rings are the ground behind the starting line the
 * opening view looks over, and nothing there can stand taller than the ankle
 * anyway — the envelope sizes what fits.
 */
export const FILL_REACH = { far: -27, near: 17.5, from: 3, frontFrom: 1 } as const;

/**
 * Whether the camera can reach a ground point at the phones; see `FILL_REACH`.
 * `deeper` carries the far bound further out, for ground that lies below the
 * board's level and is therefore seen further off (`EdgeFill.deeper`).
 */
export function inFillReach(x: number, z: number, deeper = 0, wider = 0): boolean {
  if (z > BOARD_NEAR_Z) return z <= FILL_REACH.near && Math.abs(x) <= 22 + wider - (z - BOARD_NEAR_Z);
  return z >= FILL_REACH.far - deeper && Math.abs(x) <= Math.min(37 + deeper, 29 + wider - 0.75 * z);
}

/**
 * The hexes an `EdgeFill` may take, nearest first.
 *
 * One list for every kit, built once: like the ring, the board's shape never
 * changes. Independent of the frame's reach on purpose, so a resize can never move
 * a fill piece.
 */
const FILL_HEXES = new Map<string, RingHex[]>();

function fillHexes(deeper = 0, wider = 0): RingHex[] {
  const held = FILL_HEXES.get(`${deeper}/${wider}`);
  if (held) return held;
  const hexes = getHexesInRange({ q: 0, r: 0 }, ARENA_R_MAX + 24 + Math.ceil(Math.max(deeper, wider) / 1.5))
    .map((h) => {
      const p = hexToPixel(h);
      return { coord: h, depth: boardDepth(h), x: p.x, z: p.y };
    })
    .filter((h) => h.depth >= (h.z > BOARD_NEAR_Z ? FILL_REACH.frontFrom : FILL_REACH.from)
      && inFillReach(h.x, h.z, deeper, wider))
    .sort((a, b) => a.depth - b.depth || a.z - b.z || a.x - b.x);
  FILL_HEXES.set(`${deeper}/${wider}`, hexes);
  return hexes;
}

/** Whether a hex is the fill's outright: past the authored ring, where the horizon band would otherwise roll. */
function fillOwns(kit: SceneryKit, hex: RingHex): boolean {
  return kit.fill !== undefined && hex.depth > RING_REACH && inFillReach(hex.x, hex.z, kit.fill.deeper ?? 0, kit.fill.wider ?? 0);
}

/** Salt of the open-ground field, apart from every other field the composer reads. */
const OPEN_SALT = 181;
/**
 * The envelope a dune is placed against: as wide as a wall segment, because it lies
 * flat across most of a hex, and no taller than the ground tier, because it is ground.
 */
const DUNE_SIZE: TierSpec = { maxHeight: TIER_SIZE.ground.maxHeight, spread: WALL_SIZE.spread };
/** How far a dune may turn off square across the wind, radians either way. */
const DUNE_TURN = 0.28;

/**
 * Which hexes this kit leaves open on purpose. See `OpenGround`.
 *
 * A pure function of the kit, the seed, the hex and where the composed groups stand,
 * so the composer and the camera-reach check read one decision: the check counts
 * exactly these hexes as dressed and nothing else.
 */
function openGroundTest(kit: SceneryKit, enclosure: Enclosure, seed: number): (hex: RingHex) => boolean {
  const open = kit.openGround;
  if (!open) return () => false;
  const groupPieces = enclosure.props.filter((p) => p.from === 'group').map((p) => {
    const c = hexToPixel(p.coord);
    return { x: c.x + p.offsetX, z: c.y + p.offsetZ };
  });
  const clearing = open.clearing ?? 0;
  return ({ x, z }) => (open.front === true && z > BOARD_NEAR_Z)
    || patchNoise(x * open.scale, z * open.scale, seed + OPEN_SALT) < open.threshold
    || groupPieces.some((p) => Math.hypot(p.x - x, p.z - z) <= clearing);
}

/** The hexes an open-ground kit may treat: the ring up to `RING_REACH` and the fill's reach past it. */
function openCandidates(ring: RingHex[]): RingHex[] {
  const near = ring.filter((h) => h.depth <= RING_REACH);
  const seen = new Set(near.map((h) => hexKey(h.coord)));
  return [...near, ...fillHexes().filter((h) => h.depth > RING_REACH && !seen.has(hexKey(h.coord)))];
}

/**
 * The open ground's own treatment: a flat dune with wind ripples on a share of the
 * open hexes beside and behind the board, every one lying across the same wind.
 * Never in front of the board, which the review asked to be clear.
 */
function dunePieces(
  open: OpenGround,
  hexes: RingHex[],
  roll: (h: HexCoord, salt: number) => number,
  tanPitch: number,
): ScenicProp[] {
  const out: ScenicProp[] = [];
  if (open.dunes.length === 0) return out;
  for (const { coord, x, z } of hexes) {
    if (z > BOARD_NEAR_Z || roll(coord, 190) >= open.dune) continue;
    const offsetX = (roll(coord, 191) - 0.5) * 2 * FILL_JITTER;
    const offsetZ = (roll(coord, 192) - 0.5) * 2 * FILL_JITTER;
    const scale = 0.85 + roll(coord, 193) * 0.3;
    if (!tierFits(x + offsetX, z + offsetZ, DUNE_SIZE, tanPitch, scale)) continue;
    out.push({
      coord,
      from: 'open',
      propKey: open.dunes[Math.min(open.dunes.length - 1, Math.floor(roll(coord, 194) * open.dunes.length))],
      rotationY: -(open.wind + Math.PI / 2) + (roll(coord, 195) - 0.5) * 2 * DUNE_TURN,
      scale,
      offsetX,
      offsetZ,
    });
  }
  return out;
}

/**
 * How far off its hex centre a fill piece may stand, as a share of the hex.
 *
 * Under the ring's `JITTER`, because the fill's job is that no ground is left
 * bare: one piece a hex covers its hex only while it stays near the middle of it.
 */
const FILL_JITTER = 0.32;

/**
 * The glades in the fill's stands: a coherent field a little over two hexes to a
 * cell, under whose `CLEARING_SHARE` no fill tree stands — so the gaps between
 * stands are small clearings of irregular shape rather than a lattice of single
 * missing trees.
 */
const CLEARING_FIELD = 0.16;
const CLEARING_SHARE = 0.3;

/** How far from a front clump's first piece the others stand, in world units. See `EdgeFill.clump`. */
const FRONT_CLUMP_REACH = 0.52;

/**
 * How tall a prop may stand at a world position without covering playable ground.
 *
 * **This replaces `heightScale`, which was `1 - r / 4`.** That ramp answered one
 * question — "is this between the camera and the fight?" — with the only
 * variable it had, the row index, and rows run across the whole field. So it
 * suppressed the *flanks* as hard as the front: at the framing the arena now
 * opens at, the left and right thirds of the frame are visible ground several
 * hexes deep, and every one of those hexes was refused anything over two fifths
 * height. That is most of what "the board is a lit disc in a void" was.
 *
 * The honest question is projective. The camera has no yaw — `RigCamera` sets
 * the rotation from the pitch alone and never calls `lookAt` — so a prop shares
 * a screen column with ground at its own x and hides only what is *behind* it in
 * that column. Under the view direction `(0, -sin θ, -cos θ)`, a top at height
 * `h` lies on the same ray as ground `h / tan θ` further away, so clearing every
 * board hex behind it needs `h ≤ Δz · tan θ`.
 *
 * **Zoom cannot change any of it.** Zoom is a dolly along the fixed view axis
 * and a pan is a translation of the focus, so neither moves the pitch: the
 * envelope is exact at every legal zoom and pan rather than tuned for one.
 * `rowOcclusion` in `cameraRig.ts` is the same arithmetic one scene-layer up,
 * which is why the pitch arrives as an argument — `systems/` may not import
 * `components/`, and a second copy of the rig's angle is a second answer.
 *
 * `Infinity` when no board hex shares the column, which is the ordinary case on
 * the flanks and the whole reason they can hold trees.
 */
export function headroom(x: number, z: number, spread: number, tanPitch: number): number {
  let nearest = Infinity;
  for (const b of BOARD_POINTS) {
    // A different screen column: nothing to occlude.
    if (Math.abs(b.x - x) > spread + HEX_HALF_X) continue;
    // Measured to the hex's near edge, not its centre. A prop clearing the
    // centre still buries the half of the hex a unit's feet stand on.
    const gap = z - (b.z + HEX_HALF_Z);
    if (gap <= 0) continue;
    if (gap < nearest) nearest = gap;
  }
  return nearest === Infinity ? Infinity : Math.max(0, nearest * tanPitch - HEADROOM_MARGIN);
}

/**
 * World units held back from every headroom.
 *
 * The ray arithmetic is exact for a parallel projection and the arena's camera
 * is perspective, so the true angle to a point below the view axis is a little
 * steeper than the nominal pitch. The margin is what keeps the rule conservative
 * in the direction that matters — a prop grazing a unit's feet is the failure,
 * and a prop a hand shorter than it could be is not.
 */
const HEADROOM_MARGIN = 0.15;

/**
 * How far a prop's footprint sits clear of the board in plan, in world units.
 *
 * The headroom test is about hiding ground *behind* something; this is about
 * hanging over it. A canopy three units wide on the hex next to the board
 * reaches out above playable hexes, where an overhead-ish camera sees it
 * covering them however short its trunk is. Negative means the footprint already
 * overlaps the board.
 *
 * Hexes are approximated by their circumscribed circle, which is the
 * conservative direction: it treats a hex as slightly larger than it is.
 */
export function planClearance(x: number, z: number): number {
  let nearest = Infinity;
  for (const b of BOARD_POINTS) {
    const d = Math.hypot(b.x - x, b.z - z);
    if (d < nearest) nearest = d;
  }
  return nearest - HEX_CIRCUM;
}

/**
 * Whether a prop of this size may stand at this world position.
 *
 * Three rules, and they answer three different questions, which is why none of
 * them subsumes the others:
 *
 * - It may not overhang the board (`planClearance`).
 * - It may not hide playable ground behind it (`headroom`).
 * - It may not stand in front of the board's near rim unless it is genuinely
 *   low. That last one is composition rather than safety: the supplied
 *   references keep the near side open and read the fight over low growth, and
 *   the visible strip in front of the rim is about one hex deep at the framing
 *   Step 2 settled on. `FRONT_MAX_HEIGHT` is what "genuinely low" means.
 */
export function tierFits(
  x: number, z: number, tier: TierSpec, tanPitch: number, scale = 1,
  /**
   * The ground the prop stands on, when it is not the board's own.
   *
   * Zero everywhere but a `shelf` kit's drop, where a mass on the lower country
   * is a full `drop` below the fight. Both of the height rules are about how far
   * a prop's *top* rises above the board's plane, so a base below it subtracts —
   * a four-unit crag standing six units down tops out below the board and can
   * hide nothing, however close to the camera it is. Without it the front cap
   * refused every mass on the near half of the drop, which is the half the
   * portrait frame can actually see.
   */
  baseY = 0,
): boolean {
  const tall = Math.max(0, baseY + tier.maxHeight * scale);
  const wide = tier.spread * scale;
  if (planClearance(x, z) < wide) return false;
  if (z > BOARD_NEAR_Z && tall > FRONT_MAX_HEIGHT) return false;
  return headroom(x, z, wide, tanPitch) >= tall;
}

/** Tallest thing allowed in front of the board's near rim. Ankle height. */
export const FRONT_MAX_HEIGHT = 0.45;

/**
 * The terrain-decoration families, as a tier.
 *
 * The world map's props are authored against a hex of radius 1 and stand about
 * a world unit tall — half a hero — which is exactly why Section 3A calls for an
 * arena-scale kit rather than more of these. Until a surface has one, its ring
 * is dressed from the map's own family, and the envelope needs to know how big
 * that is.
 */
export const LEGACY_TIER: TierSpec = { maxHeight: 1.1, spread: 0.7 };

/**
 * Below this a prop is not worth a draw call, and a shrunken tree reads as a
 * bush loitering in front of the fight rather than as distance.
 */
const MIN_SCALE = 0.45;

/**
 * The share of `ARENA_PROP_DENSITY` a hex this far out actually gets.
 *
 * Flat across the first three hexes: that band is the frame around the board and
 * wants to be solid. Past it the rate falls away to a third by the rim, because
 * what says "the world continues" is scenery that *thins*, and a uniform seven
 * hexes of it says the opposite — a hedge at a fixed radius, which is the shape
 * of a wall. It is also where the draw calls are: the rim bands hold far more
 * hexes than the near ones, so a flat rate would spend most of the budget on the
 * part of the frame furthest from the fight.
 */
const NEAR_BAND = 3;

export function depthDensity(depth: number): number {
  if (depth <= NEAR_BAND) return 1;
  if (depth <= RING_REACH) return Math.max(0.34, 1 - (depth - NEAR_BAND) * 0.22);
  // Past the authored ring the job changes: this is a horizon rather than more
  // wood, and what a horizon has to do is **stop without a line where it
  // stopped**. The authored ring's floor is 0.34 all the way to its rim, which
  // is right while the rim is off-screen and is exactly a hedge at a fixed
  // radius once it is not. So the band fades the rest of the way to nothing.
  return 0.34 * Math.max(0, 1 - (depth - RING_REACH) / HORIZON_FADE);
}

/**
 * Hexes over which the horizon band thins from the ring's own floor to nothing.
 *
 * Matched to `MAX_REACH - RING_REACH`, so the fade lands on zero exactly at the
 * furthest reach anything is ever placed at rather than being cut off partway
 * down — a band that ends at a third of its density has a line in it, which is
 * the one thing the fade exists to prevent.
 */
const HORIZON_FADE = MAX_REACH - RING_REACH;


/**
 * How far off its hex centre a prop may be nudged, as a share of the hex.
 *
 * One prop per hex centre is a lattice, and a lattice is what a player reads as
 * "the same decoration copied per tile" — the complaint Step 5 makes about the
 * world map, one scene over. The nudge is bounded by the tier's own clearance
 * below, so jitter can never push a trunk over the board.
 */
const JITTER = 0.55;

/**
 * How far out the enclosure is placed unconditionally.
 *
 * **This is the structural half, and it is split from the dressing on purpose.**
 * A composition rolled end to end is a composition a seed can delete: the fight
 * whose hash happened to miss twenty times running gets a clearing with no wall
 * around it and looks like the feature was never built. So the innermost band
 * that can hold a tree at all always does, and only *which* tree, where in its
 * hex it stands and how big it is are seeded. Past this the rate falls away,
 * because what says "the wood continues" is a treeline that thins.
 *
 * Two, not one: depth 1 is the ring of hexes touching the board, where a canopy
 * cannot fit anyway — barely half a unit of plan clearance — and that band is
 * the low edge detail the references keep between the fight and the trees. Not
 * three either: measured, an unconditional third band took the wood to 130
 * trees a fight, which is a wall two deep everywhere and most of a doubling of
 * the scene's triangles for rows the camera only sees the tops of.
 */
const STRUCTURAL_DEPTH = 2;

/**
 * The two passes the cascade runs, in order.
 *
 * Split so the second can see what the first planted — see `roots` in
 * `composeKit`. Derived from `TIER_ORDER` rather than written out, because the
 * salt a tier rolls on is its index in that list and two statements of the
 * order is one of them going stale.
 */
const CANOPY_TIER: SceneryTier[] = ['canopy'];
const UNDER_TIERS: SceneryTier[] = TIER_ORDER.filter((tier) => tier !== 'canopy');

/**
 * How often a hex the enclosure does not claim gets something smaller.
 *
 * **The thicket went 0.55 → 0.7, which is the composer's half of "thicker
 * understorey".** The models are the other half and were the larger one — a
 * bush had been sitting at half its tier's ceiling — but a rate is what decides
 * whether the band between the trunks and the floor is a layer or a scatter,
 * and at 0.55 nearly half of the ground under the treeline was bare. It is the
 * cheapest thing in the kit to raise: a bush is 21 authored boxes against a
 * pine's 117.
 */
export const DRESSING_RATE: Record<SceneryTier, number> = {
  canopy: BALANCE.ARENA_PROP_DENSITY,
  thicket: 0.7,
  ground: 0.5,
};

/**
 * Bounds on the per-prop size jitter. A wood of identical trees is an orchard.
 *
 * **Narrowed, because the jitter gained a partner rather than a rival.** An
 * independent roll per hex is the only kind of variation a per-hex hash can
 * produce, and what it produces is salt and pepper: every size sits next to
 * every other size, so the ring has one average size everywhere and no *large*
 * shapes in it at all. That is the scale gap the composition review names —
 * chunky models and tiny ground pieces with too few broad intermediate forms.
 * `SIZE_FIELD` supplies the missing half, a coherent band a few hexes across
 * that a whole stand of scenery shares, and the two multiply; the per-hex roll
 * is narrowed so the product keeps roughly the old span instead of widening it
 * into the envelope.
 */
export const SCALE_JITTER = { min: 0.86, max: 1.06 };

/**
 * A coherent size band, in cells per world unit and total span.
 *
 * `patchNoise`'s lattice is one unit in its input space, so 0.22 puts a cell at
 * 4.5 world units — a little under three hexes, which is the size of a *stand*.
 * Much finer and it is the per-hex roll again with extra steps; much coarser and
 * one half of the ring is large and the other small, which reads as a mistake.
 */
const SIZE_FIELD = 0.22;
const SIZE_FIELD_SPAN = 0.26;

/** How far out low cover is worth an instance, on the flanks and behind. */
const COVER_DEPTH = 5;

/**
 * How the low cover is distributed: fewer clumps, each of them solid.
 *
 * The first pass spread six pieces over most of a hex on seven tenths of the
 * hexes, which is an even sprinkle however many pieces it is — and an even
 * sprinkle of small objects over flat ground is the confetti the refinement
 * review already rejected once, in the bones and fungus. The fix is not more
 * pieces; it is the same budget arranged so that some ground is covered and
 * some is bare.
 */
const COVER_THRESHOLD = 0.38;
const COVER_COUNT_NEAR = 8;
const COVER_COUNT_FAR = 4;
const COVER_RADIUS = { min: 0.12, max: 0.62 };


// --- The feature field: what the loose scenery belongs to -------------------

/**
 * A placed piece, as the *rolled* scenery needs to know about it.
 *
 * **The rolled tiers had no idea anything else was in the scene.** Every hex
 * asked the same question — a rate, thinned by depth and by the quiet sectors —
 * so a bush beside the camp and a bush alone in the sand were placed by the
 * identical roll, at the identical rate, turned by the identical hash. That is
 * the composition review's complaint stated as code: "individual boulders,
 * outcrops, fences, trees and small ground clumps receive similar spacing and
 * attention", and it is why the landmarks the last step built are still
 * competing with the scatter around them rather than reading over it.
 *
 * What the references do instead is gather: plants belong to a bank, rubble
 * belongs to a ruin, supplies belong to a camp. So every *placed* piece — a
 * boundary segment, a colonnade shaft, a group's furniture, a focal anchor, a
 * bank piece, and for the ground cover a rolled trunk as well — publishes a
 * point, and the rolled layers read the field those points make.
 *
 * Deliberately **not** a hex mask. A site is a world position with a radius, so
 * the field is continuous: a bias derived from "is this hex within N of a
 * landmark" is a hexagon drawn round the landmark, which is the lattice the
 * jitter already exists to hide.
 */
export interface FeatureSite {
  x: number;
  z: number;
  /** World units over which it gathers rolled scenery toward itself. */
  pull: number;
  /** World units inside which nothing may be rolled at all; 0 for most. */
  exclude: number;
}

/**
 * How far each kind of placed piece reaches, in world units.
 *
 * A hex is 1.73 across, so `LANDMARK` is a little under two hexes — the skirt of
 * scenery a built thing stands in — and the shorter two are the edge cases they
 * are named for: a waterline is a *line* and a bias two hexes deep either side
 * of it is a band rather than a bank, and a trunk gathers its own undergrowth
 * and not the next tree's.
 */
const LANDMARK_PULL = 3.2;
const BANK_PULL = 2.0;
export const ROOT_PULL = 2.2;

/**
 * Clear ground a composition keeps around its own footprint, in world units.
 *
 * **A group already claims the hexes it covers, and that is not the same thing.**
 * A hex is claimed when its *centre* falls within a piece's spread plus a hex
 * half-width, and a rolled prop stands at its centre plus up to `JITTER` — so
 * the first unclaimed ring of hexes can put a bush 0.3 units inside the dais it
 * is standing next to. The margin is the composition's own breathing space said
 * out loud: the review asks for "exclusion space around focal groups" for the
 * same reason it asks for quiet sectors, which is that a landmark is legible
 * because of what is *not* standing next to it.
 *
 * **Exported, because it is also the largest gap allowed *inside* a group.** A
 * composition with a hole in it as wide as the skirt it keeps clear around
 * itself is indistinguishable from two compositions, which is exactly the
 * "isolated medium props" reading `desertGroups.test.ts` measures — so the
 * bound is this number rather than a second one picked to pass.
 */
export const GROUP_MARGIN = 0.55;

/**
 * What the rolled rate is multiplied by at a feature and out in the open.
 *
 * **A redistribution rather than a reduction, and the two numbers are measured
 * against each other.** Most of the ring is far from everything, so lifting the
 * near rate without dropping the far one is simply more props; dropping the far
 * one without lifting the near one is the "more empty version of the same
 * layout" the review rejects by name. Tuned so the composed kits keep the prop
 * counts the budget suite already pins, with the same props standing in
 * different places.
 */
const FEATURE_BIAS = { near: 2.3, away: 0.38 };

/**
 * How far the cover's threshold is tilted by the field, either way.
 *
 * The cover is a patch field read down to a threshold rather than a rate, so the
 * way to gather it is to read *further* down the field where a feature is and
 * less far where there is none — the arrangement a quiet sector already uses one
 * field over. Symmetric about half pull, so the average ground covered is
 * roughly what it was and only where it lies has moved.
 */
const COVER_TILT = 0.16;

/**
 * The pull at which a rolled prop stops being turned by the hash and starts
 * addressing the thing it belongs to, and how far off dead-on it may sit.
 *
 * A threshold on a *continuous* field, which is what keeps it from drawing a
 * line on the ground: the props are discrete and sparse, so what the eye sees is
 * a few pieces near the ruin lying square with it and the ones further out lying
 * every which way. The jitter is what stops the square ones reading as a parade.
 */
export const ORIENT_PULL = 0.45;
export const ORIENT_JITTER = 0.55;

/** Nothing at a feature; 1 standing on it. The strongest site wins. */
export interface FeaturePull {
  weight: number;
  /** The site that won, so a prop can be turned to address it. */
  x: number;
  z: number;
  excluded: boolean;
}

export function featureAt(sites: FeatureSite[], x: number, z: number): FeaturePull {
  let weight = 0;
  let nx = 0;
  let nz = 0;
  let excluded = false;
  for (const site of sites) {
    const d = Math.hypot(site.x - x, site.z - z);
    if (d < site.exclude) excluded = true;
    if (d >= site.pull) continue;
    // Linear rather than smoothed: what the field feeds is a rate and a
    // threshold, both of which are already a soft edge, and a second easing on
    // top only moves where the same gradient sits.
    const w = 1 - d / site.pull;
    if (w > weight) {
      weight = w;
      nx = site.x;
      nz = site.z;
    }
  }
  return { weight, x: nx, z: nz, excluded };
}

/** The world position a placed prop actually stands at, offsets included. */
function propSite(prop: ScenicProp, pull: number, exclude = 0): FeatureSite {
  const centre = hexToPixel(prop.coord);
  return { x: centre.x + prop.offsetX, z: centre.y + prop.offsetZ, pull, exclude };
}

/**
 * The composed path: a kit, placed by what each hex can hold.
 *
 * There is no role enum, and that is deliberate — the roles *fall out of the
 * geometry*. A hex touching the board has clearance for ankle-high growth and
 * nothing else; one two hexes out on a flank shares no screen column with a
 * playable hex and can hold a four-unit tree; one in front of the near rim is
 * capped at ankle height by composition. Writing `front` / `flank` / `rear` down
 * as data would be a second statement of all of that, and the two would drift
 * the first time the board's shape or the camera's pitch moved.
 */
/**
 * Where one focal anchor stands: the hex nearest a bearing that can hold it.
 *
 * Bearing rather than coordinate, because what an anchor marks is a *direction*
 * from the clearing, and a named hex would have to be re-chosen the day the
 * board's shape or the ring's reach moved. The candidates are scored on how far
 * off the bearing they sit and how far their depth is from the one asked for, so
 * a blocked direction degrades into the next hex round rather than into nothing.
 */
function focalHex(
  anchor: FocalAnchor,
  bearing: number,
  tanPitch: number,
  taken: Set<string>,
  onShelf: OnShelf,
): RingHex | null {
  let best: RingHex | null = null;
  let bestCost = Infinity;
  for (const hex of RING) {
    if (taken.has(hexKey(hex.coord))) continue;
    // **A landmark stands on the ground the fight is on.** A kit with a `shelf`
    // can have its lip inside the anchor band — the pass's is a little over two
    // hexes out at its narrowest — and `focalHex` already degrades a blocked
    // direction into the next hex round rather than into nothing, so the answer
    // is to refuse the candidate rather than to move the lip. A brazier hanging
    // off a cliff is the fault; a brazier a hex nearer the board is not.
    if (!onShelf(hex.x, hex.z)) continue;
    if (!tierFits(hex.x, hex.z, TIER_SIZE[anchor.tier], tanPitch)) continue;
    // `hexToPixel` maps +r to +z and the camera looks down -z, so this is the
    // bearing as the *player* sees it rather than as the axial grid stores it.
    const angle = Math.atan2(hex.z, hex.x);
    let off = Math.abs(angle - bearing) % (Math.PI * 2);
    if (off > Math.PI) off = Math.PI * 2 - off;
    const cost = off * 2 + Math.abs(hex.depth - anchor.depth) * 0.35;
    if (cost < bestCost) {
      bestCost = cost;
      best = hex;
    }
  }
  return best;
}

// --- Bearings: the boundary's masses, and the ground kept quiet -------------

/**
 * A ring hex's direction from the board, as the *player* sees it.
 *
 * `hexToPixel` maps +r to +z and the camera looks down -z, so this is the
 * bearing an author writes down rather than the one the axial grid stores — the
 * same convention `focalHex` scores against and the wall's own facing is derived
 * from.
 */
function hexBearing(hex: RingHex): number {
  return Math.atan2(hex.z, hex.x);
}

/** Whether a bearing lies inside a sector of the given total width. */
function withinSector(bearing: number, centre: number, sweep: number): boolean {
  if (sweep >= Math.PI * 2) return true;
  if (sweep <= 0) return false;
  let off = Math.abs(bearing - centre) % (Math.PI * 2);
  if (off > Math.PI) off = Math.PI * 2 - off;
  return off <= sweep / 2;
}

/**
 * The whole circle at the course's own depth, which is what a wall with no arcs
 * is. Stated as an arc rather than branched around, so the closed ring and the
 * separated masses go down one code path and an interior kit cannot quietly
 * acquire a second behaviour.
 */
const CLOSED_COURSE: BoundaryArc[] = [{ bearing: 0, sweep: Math.PI * 2 }];

/**
 * Which mass of the boundary a hex belongs to, if any.
 *
 * First match wins, so overlapping arcs resolve in author order instead of
 * stacking two segments on one hex. `null` is an open sector — the thing an
 * outdoor kit is authored for, and the thing a closed ring can never return.
 */
function boundaryArcAt(wall: WallRing, hex: RingHex): BoundaryArc | null {
  for (const arc of wall.arcs?.length ? wall.arcs : CLOSED_COURSE) {
    if (hex.depth !== (arc.depth ?? wall.depth)) continue;
    if (!withinSector(hexBearing(hex), arc.bearing, arc.sweep)) continue;
    return arc;
  }
  return null;
}

/**
 * How much of the ordinary rate the rolled scenery keeps at a world position.
 *
 * 1 everywhere a kit declares no quiet sector, which is every kit that shipped
 * before this existed. The strongest sector covering a point wins rather than
 * the sectors multiplying: two overlapping quiet areas are one quiet area, and
 * compounding them would make "how open is this" depend on how the author chose
 * to spell the same ground.
 */
function quietFactor(kit: SceneryKit, x: number, z: number): number {
  const sectors = kit.quiet;
  if (!sectors?.length) return 1;
  const bearing = Math.atan2(z, x);
  let factor = 1;
  for (const sector of sectors) {
    if (!withinSector(bearing, sector.bearing, sector.sweep)) continue;
    factor = Math.min(factor, sector.density ?? QUIET_DENSITY);
  }
  return factor;
}


// --- The enclosure, and the water it is laid around -------------------------

/**
 * The wall course and the focal anchors: everything a composition places before
 * it knows what the ground is made of.
 *
 * **Split out of `composeKit` because the water region needs the same answer.**
 * A region is laid over hexes the enclosure has not already claimed - the
 * highland fall keeps its bearing, and no stream runs through a wall - and the
 * *scene* needs the region too, to draw its surface. Three callers, and the one
 * thing they may not do is disagree about which hexes are spoken for, so there
 * is one derivation and they all read it.
 *
 * Placed on `RING` rather than on the reach's own ring, which is the behaviour
 * this was lifted from unchanged: a wall stands at a fixed depth and an anchor
 * aims at one, and neither has anything to say about how far the horizon band
 * runs.
 */
interface Enclosure {
  props: ScenicProp[];
  taken: Set<string>;
  /**
   * What the rolled layers gather toward, and stand clear of.
   *
   * Built here rather than derived from `props` afterwards because only the
   * placer knows what each piece *is*: a group's furniture keeps clear ground
   * around it and a boundary segment wants rubble at its foot, and by the time
   * they are both a `ScenicProp` they are indistinguishable.
   */
  sites: FeatureSite[];
}

/**
 * One hand-placed piece, at the world position it was put at.
 *
 * **The whole of it is that nothing here is a function of the seed.** A group
 * chooses an origin hex, an anchor is spread by a seeded turn, a wall segment
 * picks its key by a roll — every placed layer in this file still has one foot
 * in the dice, which is right for a rule and wrong for a landmark somebody
 * dragged into place. This reads `key`, `x`, `z`, `scale` and `turn` and nothing
 * else, so the same layout puts the same piece in the same place in every fight
 * on that ground.
 *
 * The envelope still applies, and it is seed-free too: `tierFits` is a question
 * about screen columns and plan overlap at a fixed pitch. What it refuses is a
 * piece that would stand in front of the fight, which is a rule no amount of
 * authoring gets to overrule — the editor's job is to say so before the file is
 * saved rather than to be obeyed afterwards.
 *
 * It claims its footprint and publishes a site, the two things `groupProps`
 * already does and for its reasons: nothing may be rolled on top of a placed
 * landmark, and loose scenery gathers at its foot.
 */
function placementProps(
  placements: ScenicPlacement[],
  tanPitch: number,
): { props: ScenicProp[]; claimed: string[]; sites: FeatureSite[] } {
  const props: ScenicProp[] = [];
  const placed: { x: number; z: number; spread: number }[] = [];
  for (const piece of placements) {
    const scale = piece.scale ?? 1;
    const lift = piece.lift ?? 0;
    if (!tierFits(piece.x, piece.z, TIER_SIZE[piece.tier], tanPitch, scale, lift)) continue;
    // The hex it stands over, so `coord` keeps meaning what it means everywhere
    // else in this module and the instancing layer needs to learn nothing: the
    // offsets are from that hex's centre, and they carry the whole position.
    const coord = pixelToHex(piece.x, piece.z);
    // **Stated rather than inferred, because this is the one input a person
    // types.** Everything else out here lands outside the board because it was
    // chosen from `RING`, and a placement lands outside it because `tierFits`
    // refuses a footprint that overhangs — which is true, and is two
    // inequalities deep. The module's whole contract is that nothing it returns
    // can be stood on, targeted or pathed through, so the contract is checked
    // where it could be broken instead of being argued for.
    if (inArena(coord)) continue;
    const centre = hexToPixel(coord);
    props.push({
      coord,
      propKey: piece.key,
      from: 'placement',
      rotationY: piece.turn ?? 0,
      scale,
      ...(lift === 0 ? {} : { tileTop: lift }),
      offsetX: piece.x - centre.x,
      offsetZ: piece.z - centre.y,
    });
    placed.push({ x: piece.x, z: piece.z, spread: TIER_SIZE[piece.tier].spread * scale });
  }
  const claimed = RING.filter((hex) => placed.some(
    (piece) => Math.hypot(hex.x - piece.x, hex.z - piece.z) < piece.spread + HEX_HALF_X,
  )).map((hex) => hexKey(hex.coord));
  const sites = placed.map((piece) => ({
    x: piece.x, z: piece.z, pull: LANDMARK_PULL, exclude: piece.spread + GROUP_MARGIN,
  }));
  return { props, claimed, sites };
}

/**
 * A composition placed about one bearing, and the ground it claims.
 *
 * The group's own frame is `across` × `along` in world units: `along` runs
 * outward from the board on the group's bearing and `across` is that turned a
 * quarter. Both are world units rather than hexes because what a composition is,
 * is a set of fixed distances *between its own pieces* — see `FocalGroup`.
 *
 * Every piece is checked against the envelope at its own position, and a piece
 * that fails is dropped rather than moving the group: a throne shifted a hex to
 * make room for a statue is no longer at the head of the hall, and the hall is
 * what the group is for.
 */
function groupProps(
  group: FocalGroup,
  tanPitch: number,
  taken: Set<string>,
  onShelf: OnShelf,
): { props: ScenicProp[]; claimed: string[]; sites: FeatureSite[] } {
  // The origin is chosen the way a pinned anchor's hex is, and by the same
  // function: nearest the bearing at the depth asked for, degrading outward
  // rather than to nothing.
  const origin = focalHex(
    { key: '', tier: 'canopy', count: 1, depth: group.depth, bearing: group.bearing },
    group.bearing, tanPitch, taken, onShelf,
  );
  if (!origin) return { props: [], claimed: [], sites: [] };

  const out = Math.cos(group.bearing);
  const outZ = Math.sin(group.bearing);
  /**
   * **The group stands on its own axis, not on the hex it was chosen from.**
   *
   * `focalHex` returns a *hex*, and a hex centre is wherever the lattice put it
   * — for the hall that came out 0.87 world units off the line the carpet is
   * drawn down. Two consequences, and both showed: the throne sat beside its own
   * runner rather than at the head of it, and the flight either side of it was
   * measured against a board it was no longer symmetric about, so one dais block
   * of each pair passed the envelope and its mirror did not.
   *
   * So the hex decides how far *along* the bearing the group stands and the
   * bearing decides the rest: project the chosen centre onto the axis and build
   * from there. The pieces keep their `coord` for instancing — offsets are from
   * the hex centre — and only the geometry moves.
   */
  const along0 = origin.x * out + origin.z * outZ;
  const ox = along0 * out;
  const oz = along0 * outZ;
  const props: ScenicProp[] = [];
  const placed: { x: number; z: number; spread: number }[] = [];

  for (const piece of group.pieces) {
    const scale = piece.scale ?? 1;
    // `across` is the bearing turned a quarter, so the two axes are the group's
    // own right and its own outward.
    const x = ox + piece.along * out - piece.across * outZ;
    const z = oz + piece.along * outZ + piece.across * out;
    // Per piece as well as at the origin: a composition reaches nearly four
    // units across, so a group placed safely on the shelf can still have an arm
    // hanging over the lip — and a piece dropped is the behaviour this loop
    // already has for a piece the envelope refuses.
    if (!onShelf(x, z)) continue;
    // A lifted piece is that much taller in the frame, which is `tierFits`'s
    // own `baseY` with the sign the other way round — the parameter exists
    // because a mass standing below the board is shorter than it, and a deck
    // built on a landing is taller. Without it the envelope would wave through
    // a platform whose rail ends up hiding the ground behind it.
    const lift = piece.lift ?? 0;
    if (!tierFits(x, z, TIER_SIZE[piece.tier], tanPitch, scale, lift)) continue;
    const centre = hexToPixel(origin.coord);
    props.push({
      coord: origin.coord,
      propKey: piece.key,
      from: 'group',
      // Facing the board, the same formula a pinned anchor uses, plus whatever
      // the piece asks for on top.
      rotationY: -(group.bearing + Math.PI / 2) + (piece.turn ?? 0),
      scale,
      ...(lift === 0 ? {} : { tileTop: lift }),
      // Offsets are from the *hex centre*, which is what `ScenicProp` means by
      // them — the instancing layer adds them to `hexToPixel(coord)`.
      offsetX: x - centre.x,
      offsetZ: z - centre.y,
    });
    placed.push({ x, z, spread: TIER_SIZE[piece.tier].spread * scale });
  }
  if (props.length === 0) return { props: [], claimed: [], sites: [] };

  // The footprint, not the hexes the pieces happen to land in. A dais is wider
  // than the hex under it, and a bush rolled onto the hex beside it is a bush
  // growing out of the steps. A group afloat claims none: the water runs under it.
  const claimed = group.afloat ? [] : RING.filter((hex) => placed.some(
    (piece) => Math.hypot(hex.x - piece.x, hex.z - piece.z) < piece.spread + HEX_HALF_X,
  )).map((hex) => hexKey(hex.coord));
  // Each piece both gathers and excludes: the skirt of loose scenery belongs to
  // the composition, and the composition's own ground stays clear. See
  // `GROUP_MARGIN`.
  const sites = placed.map((piece) => ({
    x: piece.x, z: piece.z, pull: LANDMARK_PULL, exclude: piece.spread + GROUP_MARGIN,
  }));
  return { props, claimed, sites };
}

/**
 * A rhythm of pillars one course inside the wall.
 *
 * Placed the way the wall course is — every hex at a depth, in order, not rolled
 * — with a beat on top. The order is *by bearing* rather than whatever
 * `getHexesInRange` happens to return, because a beat is only a beat if the
 * hexes it counts are the ones that stand next to each other.
 */
function colonnadeProps(
  kit: SceneryKit,
  roll: (h: HexCoord, salt: number) => number,
  tanPitch: number,
  taken: Set<string>,
): ScenicProp[] {
  const spec = kit.colonnade;
  if (!spec || spec.keys.length === 0) return [];
  const course = RING
    .filter((hex) => hex.depth === spec.depth && !taken.has(hexKey(hex.coord)))
    .sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
  const out: ScenicProp[] = [];
  course.forEach((hex, i) => {
    if (i % Math.max(1, spec.beat) !== 0) return;
    if (!tierFits(hex.x, hex.z, TIER_SIZE.canopy, tanPitch)) return;
    taken.add(hexKey(hex.coord));
    const pick = Math.floor(roll(hex.coord, 49) * spec.keys.length);
    out.push({
      coord: hex.coord,
      propKey: spec.keys[Math.min(spec.keys.length - 1, pick)],
      from: 'colonnade',
      // Turned tangentially like the wall, so a shaft's flutes face the room
      // rather than a direction the hash picked.
      rotationY: -(Math.atan2(hex.z, hex.x) + Math.PI / 2),
      scale: 1,
      offsetX: 0,
      offsetZ: 0,
    });
  });
  return out;
}

/**
 * Whether a composition may be placed at a world position.
 *
 * `() => true` for the sixteen kits that stand on flat ground, which is what
 * makes the whole landform invisible to them.
 */
type OnShelf = (x: number, z: number) => boolean;

function buildEnclosure(
  kit: SceneryKit,
  roll: (h: HexCoord, salt: number) => number,
  tanPitch: number,
  seed: number,
  onShelf: OnShelf,
): Enclosure {
  const props: ScenicProp[] = [];
  const taken = new Set<string>();
  const sites: FeatureSite[] = [];

  // Hand placements before every rule, including the enclosure: a layout's
  // authored pieces are the one thing in a composition that was decided rather
  // than derived, and a rule that could overwrite one would make the editor
  // advisory. See `ScenicPlacement`.
  if (kit.placements?.length) {
    const { props: pieces, claimed, sites: theirs } = placementProps(kit.placements, tanPitch);
    props.push(...pieces);
    for (const key of claimed) taken.add(key);
    sites.push(...theirs);
  }

  // The enclosure next: everything else in a hall is arranged *against* the
  // walls, so the walls cannot be what is left over after the dressing.
  const wall = kit.wall;
  if (wall && wall.keys.length > 0) {
    for (const hex of RING) {
      // Which mass this hex belongs to, which for a kit that names no arcs is
      // the closed ring at the course's own depth — the interior behaviour,
      // unchanged, down the same path. See `BoundaryArc`.
      const arc = boundaryArcAt(wall, hex);
      if (!arc) continue;
      const scale = arc.scale ?? 1;
      if (!tierFits(hex.x, hex.z, WALL_SIZE, tanPitch, scale)) continue;
      taken.add(hexKey(hex.coord));
      const keys = arc.keys?.length ? arc.keys : wall.keys;
      const pick = Math.floor(roll(hex.coord, 48) * keys.length);
      const segment: ScenicProp = {
        coord: hex.coord,
        propKey: keys[Math.min(keys.length - 1, pick)],
        from: 'boundary',
        // Turned so the segment's length runs tangentially and its face looks
        // inward. `Ry` maps +X to `(cos, -sin)` in the ground plane, so a hex at
        // bearing phi wants `-(phi + pi/2)` - stated here rather than authored
        // per segment, because the ring is a circle and the models are not. A
        // mass standing on an arc of that circle keeps it for the same reason:
        // what a segment faces is the fight, whether or not the course closes.
        rotationY: -(hexBearing(hex) + Math.PI / 2),
        scale,
        offsetX: 0,
        offsetZ: 0,
      };
      props.push(segment);
      // **A boundary segment gathers and never excludes.** Rubble at the foot of
      // a cliff is what the review asks for by name — "embedded rubble at rock
      // bases" — so the one place the loose scenery is most wanted is exactly
      // where a margin would refuse it.
      sites.push(propSite(segment, LANDMARK_PULL));
    }
  }

  // The colonnade is the wall's rule one course in, so it goes with the wall.
  for (const prop of colonnadeProps(kit, roll, tanPitch, taken)) {
    props.push(prop);
    sites.push(propSite(prop, LANDMARK_PULL));
  }

  // Groups before single anchors. A composition is the thing the room is
  // arranged around, and an anchor rolled into the middle of one would be a
  // brazier standing on the dais.
  for (const group of kit.groups ?? []) {
    const { props: pieces, claimed, sites: theirs } = groupProps(group, tanPitch, taken, onShelf);
    props.push(...pieces);
    for (const key of claimed) taken.add(key);
    sites.push(...theirs);
  }

  // Anchors next, and they claim their hex: a tier rolled over the top of one
  // would put a tree through a lantern.
  for (const anchor of kit.focal ?? []) {
    // One seeded rotation for the whole ring rather than a jitter per anchor, so
    // the even spread survives - which is the only reason they are spread by
    // bearing at all.
    const turn = tileHash({ q: 0, r: 0 }, seed) * Math.PI * 2;
    for (let i = 0; i < anchor.count; i++) {
      const bearing = anchor.bearing
        ?? turn + ((i + 0.5) / anchor.count) * Math.PI * 2 - Math.PI;
      const hex = focalHex(anchor, bearing, tanPitch, taken, onShelf);
      if (!hex) continue;
      taken.add(hexKey(hex.coord));
      const mark: ScenicProp = {
        coord: hex.coord,
        propKey: anchor.key,
        from: 'anchor',
        // A pinned anchor faces the board; a spread one is free to be turned any
        // way, because what it is doing is marking a direction rather than
        // addressing the room.
        rotationY: anchor.bearing === undefined
          ? roll(hex.coord, 47) * Math.PI * 2
          : -(Math.atan2(hex.z, hex.x) + Math.PI / 2),
        scale: 1,
        offsetX: 0,
        offsetZ: 0,
      };
      props.push(mark);
      // An anchor gathers without excluding, for the boundary's reason: a
      // lantern wants growth at its foot and a pond wants reeds at its rim.
      sites.push(propSite(mark, LANDMARK_PULL));
    }
  }
  return { props, taken, sites };
}

/**
 * A bounded area of water and the dry ground along its edge.
 *
 * The composer claims the surface so nothing grows in it and places the kit's
 * bank pieces along `bank`; the *scene* draws the surface as ground, which is
 * the whole difference between this and `arena_pond_0`. See `WaterRegion`.
 */
export interface WaterField {
  /** Hexes drawn as water. Outside `inArena` by construction. */
  surface: HexCoord[];
  /**
   * Dry ring hexes touching the surface, each with the unit direction from the
   * hex's own centre toward the water it borders.
   *
   * The direction is what puts a bank piece *on* the waterline rather than in
   * the middle of the last dry hex - which is also what breaks up the region's
   * hexagonal outline, the one thing a surface made of prisms cannot do for
   * itself.
   */
  bank: { coord: HexCoord; toWaterX: number; toWaterZ: number }[];
}

const EMPTY_WATER: WaterField = { surface: [], bank: [] };

/**
 * How fast the pool field turns over, in world units per lattice cell.
 *
 * **Measured off the perimeter, not chosen.** The first draft ran at the ground
 * cover's own 0.42, which sounds harmless and is not: `patchNoise`'s lattice is
 * one unit in its input space, so 0.42 puts a cell at 2.4 world units against a
 * hex spacing of 1.73 — under a hex and a half. What that produces is speckle
 * with the right average, and the way it showed was the boundary: 65 wet hexes
 * came back with **96** hexes of bank, where one compact body of 65 has about
 * thirty. A region whose perimeter is longer than its area is a scatter of
 * puddles, which is the fault the whole item exists to fix, one size up.
 *
 * 0.15 puts a cell at 6.7 units, about four hexes, so a blob has an inside.
 */
const WATER_FIELD_SCALE = 0.15;

/** How much of its band a `pools` region covers when the kit does not say. */
const DEFAULT_COVERAGE = 0.25;

/** Which ring hexes a region's own shape admits, before contiguity is checked. */
/**
 * Whether a hex lies on a course's arc. A course is an arc rather than a blob: it
 * runs from its head's bearing round the board, so what decides membership is *how
 * far round* a hex sits and not a noise sample. `hexToPixel` maps +r to +z and the
 * camera looks down -z, so this is the bearing the player sees.
 */
function onCourse(spec: WaterRegion, hex: { x: number; z: number }): boolean {
  const sweep = spec.sweep ?? Math.PI / 2;
  let along = Math.atan2(hex.z, hex.x) - (spec.bearing ?? -Math.PI / 2);
  along = ((along % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return sweep >= 0 ? along <= sweep : along >= Math.PI * 2 + sweep;
}

function waterCandidates(
  spec: WaterRegion, taken: Set<string>, source: Set<string>, seed: number,
): RingHex[] {
  // Clamped to the authored ring rather than trusted from the table. Water is
  // read as *ground*, and the horizon band past `RING_REACH` is where a prop is
  // read as a silhouette - a lake out there would be a blue shape on the plane
  // with no edge the eye can place. It also makes the region independent of the
  // frame's reach, which is what lets one answer serve the composer and the
  // scene without either being handed a viewport.
  const far = Math.min(spec.far, RING_REACH);
  const band = RING.filter((hex) => hex.depth >= spec.near && hex.depth <= far
    // The enclosure has first claim on every hex but one: a course may run under
    // the anchor it flows out of. See `WaterRegion.source`.
    && (!taken.has(hexKey(hex.coord)) || source.has(hexKey(hex.coord))));

  if (spec.shape === 'course') return band.filter((hex) => onCourse(spec, hex));

  // The field *ranks* the band and the coverage says how far down to read. See
  // `WaterRegion.coverage` for why this is not a threshold.
  const wanted = Math.round(band.length * (spec.coverage ?? DEFAULT_COVERAGE));
  return band
    .map((hex) => ({
      hex,
      // Ties broken by the hex's own key, so a flat patch of field cannot make
      // the answer depend on the order `RING` happens to have been built in.
      rank: patchNoise(hex.x * WATER_FIELD_SCALE, hex.z * WATER_FIELD_SCALE, seed + 91),
    }))
    .sort((a, b) => b.rank - a.rank
      || hexKey(a.hex.coord).localeCompare(hexKey(b.hex.coord)))
    .slice(0, wanted)
    .map((entry) => entry.hex);
}

/**
 * The edge fill's standing water: a share of its hexes past the ring, ranked by
 * the region's own pool field so the far water continues the near water's blobs
 * rather than starting a second pattern. See `EdgeFill.water`.
 *
 * Past `RING_REACH` only, so the authored region keeps exactly the hexes it had.
 */
function fillWater(spec: WaterRegion, fill: EdgeFill | undefined, taken: Set<string>, seed: number): RingHex[] {
  if (!fill?.water) return [];
  // A course runs on round its own arc, in front of the board too; a pool field's far
  // water stays beside and behind it. See `EdgeFill.water`.
  const band = fillHexes().filter((hex) => hex.depth > RING_REACH && !taken.has(hexKey(hex.coord))
    && (spec.shape === 'course' ? onCourse(spec, hex) : hex.z <= BOARD_NEAR_Z));
  const wanted = Math.round(band.length * fill.water);
  return band
    .map((hex) => ({ hex, rank: patchNoise(hex.x * WATER_FIELD_SCALE, hex.z * WATER_FIELD_SCALE, seed + 91) }))
    .sort((a, b) => b.rank - a.rank || hexKey(a.hex.coord).localeCompare(hexKey(b.hex.coord)))
    .slice(0, wanted)
    .map((entry) => entry.hex);
}

/**
 * Drop anything too small to be a body of water.
 *
 * A noise field hands back singletons at the margin of every blob it draws, and
 * a one-hex pond is the puddle-in-a-saucer the pond prop already was - the fault
 * the region exists to fix, reproduced one layer up. Applied to a course too,
 * even though an arc is contiguous by construction: a wall or an anchor standing
 * in the middle of one cuts it, and a stream with a gap in it is worse than a
 * shorter stream.
 */
function largeComponents(hexes: RingHex[]): RingHex[] {
  const byKey = new Map(hexes.map((h) => [hexKey(h.coord), h]));
  const seen = new Set<string>();
  const out: RingHex[] = [];
  for (const start of hexes) {
    if (seen.has(hexKey(start.coord))) continue;
    const component: RingHex[] = [];
    const queue = [start];
    seen.add(hexKey(start.coord));
    while (queue.length) {
      const hex = queue.pop()!;
      component.push(hex);
      for (const n of getNeighbors(hex.coord)) {
        const key = hexKey(n);
        if (seen.has(key)) continue;
        const found = byKey.get(key);
        if (!found) continue;
        seen.add(key);
        queue.push(found);
      }
    }
    if (component.length >= MIN_WATER_HEXES) out.push(...component);
  }
  return out;
}

function buildWater(spec: WaterRegion, enclosure: Enclosure, seed: number, fill?: EdgeFill): WaterField {
  const { taken } = enclosure;
  const source = new Set(spec.source
    ? enclosure.props.filter((prop) => prop.propKey === spec.source).map((p) => hexKey(p.coord))
    : []);
  const surface = largeComponents([
    ...waterCandidates(spec, taken, source, seed),
    ...fillWater(spec, fill, taken, seed),
  ]);
  if (surface.length === 0) return EMPTY_WATER;
  const wet = new Set(surface.map((h) => hexKey(h.coord)));
  // The ring's own water apart: a bank faces it when it touches any, so the fill's water
  // past the ring adds banks without turning one the ring already had (fill, don't thin).
  const ringWet = new Set(surface.filter((h) => h.depth <= RING_REACH).map((h) => hexKey(h.coord)));
  const bank: WaterField['bank'] = [];
  // The fill's own hexes past the ring border its water too, so a far pool has a
  // bank like a near one.
  const shore = fill?.water ? [...RING, ...fillHexes().filter((h) => h.depth > RING_REACH)] : RING;
  for (const hex of shore) {
    const key = hexKey(hex.coord);
    if (wet.has(key) || taken.has(key)) continue;
    const toward = (water: Set<string>): [number, number] => {
      let x = 0;
      let z = 0;
      for (const n of getNeighbors(hex.coord)) {
        if (!water.has(hexKey(n))) continue;
        const p = hexToPixel(n);
        x += p.x - hex.x;
        z += p.y - hex.z;
      }
      return [x, z];
    };
    let [dx, dz] = toward(ringWet);
    if (dx === 0 && dz === 0) [dx, dz] = toward(wet);
    if (dx === 0 && dz === 0) continue;
    const len = Math.hypot(dx, dz);
    bank.push({ coord: hex.coord, toWaterX: dx / len, toWaterZ: dz / len });
  }
  return { surface: surface.map((h) => h.coord), bank };
}

/**
 * One enclosure and one water field per fight, remembered for the second caller.
 *
 * A single slot rather than a `Map`, because the two callers are the composer
 * and the scene asking about *the same fight* in the same frame, and a map keyed
 * on the encounter would keep an entry for every battle of a session for the
 * sake of two lookups.
 *
 * **Keyed on the kit's own identity, not on a name for it**, and that is a fault
 * found by rendering rather than an abundance of caution. The first spelling
 * used `encounterId | surfaceKey | tanPitch`, which sounds like it identifies a
 * composition and does not: `sceneryFor` looks a kit up under the *location*
 * indoors precisely because three places were floored in `stone` — so the castle,
 * the old Barrow and the Wyrm's Hollow shared a surface key, and the hall came back
 * holding the tomb's cold lamps. On screen that is a throne room lit in
 * graveyard cyan, and nothing about it looks like a cache.
 *
 * Kits are module-level singletons in `sceneryKits.ts`, so `===` is the exact
 * question: is this the same composition. The pitch rides along because the
 * enclosure is placed through `tierFits`, which is projective.
 */
let lastKit: SceneryKit | null = null;
let lastId: string | null = null;
let lastPitch = NaN;
let lastValue: Composition | null = null;

/**
 * Everything a fight's composition is, before a single thing is rolled.
 *
 * **The bank joined this rather than staying in `composeKit`, because the field
 * is a third consumer of the same answer.** The props go to the instanced layer,
 * the surface goes to the hex grid, and now `sites` goes to the rolled layers —
 * and the one thing the three may not do is disagree about where the
 * composition stands. One derivation behind one memo, which is the arrangement
 * `arenaWater` already reads.
 */
interface Composition {
  enclosure: Enclosure;
  water: WaterField;
  /** What stands along the waterline; placed, like the enclosure. */
  bank: ScenicProp[];
  /** What the rolled layers gather toward and stand clear of. */
  sites: FeatureSite[];
  /** The ground rising into hills, when the kit declares them. See `HillSpec`. */
  hills: HillField | null;
}

function composed(
  kit: SceneryKit,
  encounterId: string,
  roll: (h: HexCoord, salt: number) => number,
  tanPitch: number,
  seed: number,
): Composition {
  if (lastKit === kit && lastId === encounterId && lastPitch === tanPitch && lastValue) {
    return lastValue;
  }
  // One predicate, built here and handed down, so the enclosure and the props
  // read the same land. `() => true` is the flat-ground case, which is every kit
  // that has not authored a shelf.
  const shelf = kit.shelf;
  const onShelf: OnShelf = shelf
    ? (x, z) => shelfHeight(shelf, seed, x, z) === 0
    : () => true;
  const enclosure = buildEnclosure(kit, roll, tanPitch, seed, onShelf);
  const backed = kit.hills ? backedPieces(kit.hills, enclosure) : [];
  // Water does not run where a spur of hill stands behind its landmark.
  const wateredOver = backed.length
    ? { ...enclosure, taken: new Set([...enclosure.taken, ...spurHexes(backed)]) }
    : enclosure;
  const water = kit.water ? buildWater(kit.water, wateredOver, seed, kit.fill) : EMPTY_WATER;
  const bank = bankPieces(kit, water, roll, tanPitch, sourcePieces(kit, enclosure));
  const hills = kit.hills ? hillField(kit, enclosure, backed, water, tanPitch, seed) : null;
  lastKit = kit;
  lastId = encounterId;
  lastPitch = tanPitch;
  lastValue = {
    enclosure,
    water,
    bank,
    // A waterline is the review's second named target for the field — "plants
    // gather around a bank" — and it is the one part of the composition the
    // enclosure does not hold, because it is placed from the kit's own bank
    // keys after the region is known.
    sites: [
      ...enclosure.sites, ...bank.map((prop) => propSite(prop, BANK_PULL)),
      // Nothing rolled stands between a fall and the stream it runs into.
      ...sourcePieces(kit, enclosure).map(({ x, z }) => ({ x, z, pull: 0, exclude: SOURCE_CLEAR })),
    ],
    hills,
  };
  return lastValue;
}

/** Level ground kept round a landmark piece, world units, and the slope it blends back over. */
const HILL_KEEP_LANDMARK = { r: 1.1, blend: 1.8 };
/** Level ground kept round each water hex — a hex's circumradius and a little — and its blend. */
const HILL_KEEP_WATER = { r: 0.95, blend: 1.1, firm: true };
/** Half a facet, the footprint `headroom` measures the ground at. */
const HILL_SPREAD = HILL_CELL * 0.5;

/**
 * The kit's hills over this fight. See `HillSpec`.
 *
 * Built after the enclosure and the water, because those keep their own level
 * ground: a waterfall's pool, a stream, a camp or a gate stand where they were
 * composed and the land rises from round them. Everything else — the rolled
 * tiers, the fill, the cover — is placed in plan exactly as on flat ground and
 * then stood on the hill (`standOnHills`), the shelf's own arrangement.
 */
/** Every enclosure piece a kit's `HillBack` names, with the way straight out behind it. */
function backedPieces(spec: HillSpec, enclosure: Enclosure): HillBacked[] {
  const out: HillBacked[] = [];
  for (const prop of enclosure.props) {
    const back = spec.backs?.find((b) => b.key === prop.propKey);
    if (!back) continue;
    const { x, z } = hillAnchor(prop);
    const r = Math.hypot(x, z) || 1;
    out.push({ x, z, dx: x / r, dz: z / r, height: back.height, reach: back.reach, width: back.width });
  }
  return out;
}

/**
 * Where the hills take a placed piece to stand: the centre of the hex it stands in.
 *
 * Not its exact position, because the editor's bake rounds that to a hundredth and
 * the hills would move by as much on a steep spur; the hex it stands in is the
 * same before and after.
 */
function hillAnchor(prop: ScenicProp): { x: number; z: number } {
  const c = hexToPixel(prop.coord);
  const p = hexToPixel(pixelToHex(c.x + prop.offsetX, c.y + prop.offsetZ));
  return { x: p.x, z: p.y };
}

/** The ring hexes a backed spur stands on: kept dry, so a stream never runs into the hill. */
function spurHexes(backed: HillBacked[]): string[] {
  return RING.filter(({ x, z }) => backed.some((b) => {
    const along = (x - b.x) * b.dx + (z - b.z) * b.dz;
    const across = Math.abs((x - b.x) * b.dz - (z - b.z) * b.dx);
    return along > 0.5 && along <= b.reach + 1 && across < b.width * 0.85;
  })).map((h) => hexKey(h.coord));
}

/**
 * The water the hills keep level ground for.
 *
 * **A course by its shape rather than by what was laid**: every ring hex its band and
 * sweep admit, whatever stands there. What is laid is that less the hexes the
 * enclosure claimed — and the editor's bake turns every prop into a placement that
 * claims its footprint, so the laid course is not the same twice while its shape is.
 * Keeping the shape keeps a baked arena's hills the hills it was baked on. Pools are
 * a field ranked over the free hexes and have no shape apart from what was laid; no
 * kit with hills has them yet.
 */
function waterGround(
  kit: SceneryKit, water: WaterField, backed: HillBacked[], seed: number,
): HexCoord[] {
  if (kit.water?.shape !== 'course') return water.surface;
  // The far water it runs on into is its arc's too, and nothing past the ring claims a hex
  const far = fillWater(kit.water, kit.fill, new Set(), seed);
  return [...waterCandidates(kit.water, new Set(spurHexes(backed)), new Set(), seed), ...far].map((h) => h.coord);
}

function hillField(
  kit: SceneryKit, enclosure: Enclosure, backed: HillBacked[], water: WaterField,
  tanPitch: number, seed: number,
): HillField {
  const spec = kit.hills!;
  const keep: HillKeep[] = [];
  const level = new Set(spec.level ?? []);
  for (const prop of enclosure.props) {
    if (!level.has(prop.propKey)) continue;
    keep.push({ ...hillAnchor(prop), ...HILL_KEEP_LANDMARK });
  }
  // A watercourse's source hex is its fall's own, and the fall is the one thing the
  // land is meant to climb behind: the pool keeps its level from the fall's own keep.
  const source = new Set(backed.map((b) => hexKey(pixelToHex(b.x, b.z))));
  for (const hex of waterGround(kit, water, backed, seed)) {
    if (source.has(hexKey(hex))) continue;
    const c = hexToPixel(hex);
    keep.push({ x: c.x, z: c.y, ...HILL_KEEP_WATER });
  }
  const shelf = kit.shelf;
  return buildHillField(spec, seed, {
    clearance: planClearance,
    headroom: (x, z) => headroom(x, z, HILL_SPREAD, tanPitch),
    nearZ: BOARD_NEAR_Z,
    spanX: BOARD_SPAN_X,
    // The camera's reach and a little more: nothing past it is ever in shot.
    seen: (x, z) => inFillReach(x, z) || inFillReach(x - 2.5, z) || inFillReach(x + 2.5, z)
      || inFillReach(x, z - 2.5) || inFillReach(x, z + 2.5),
    // Never over a drop: the hills are the high ground and the shelf the low.
    level: shelf ? (x, z) => shelfHeight(shelf, seed, x, z, 1.5) === 0 : undefined,
  }, keep, backed);
}


/**
 * How far `standOnHills` raised a prop standing at this point: the one number the
 * editor's bake takes back off a piece's height, so a baked piece's `lift` is its
 * own and recomposing it does not stand it on the hill twice.
 */
export function hillLift(field: HillField, x: number, z: number): number {
  return hillFloor(field, x, z);
}

/**
 * Every prop stood on the hill under it, in one pass at the end — `standOnShelf`'s
 * arrangement and for its reason: the composition is decided in plan on ground
 * that has not moved, and only the height changes. **Added**, so a group piece's
 * own lift rides up with the ground. Nothing here moves a prop toward the board's
 * columns: a column is never taller than `headroom` allows, and a prop stands
 * where the composition already let it.
 */
function standOnHills(props: ScenicProp[], field: HillField): ScenicProp[] {
  return props.map((prop) => {
    const c = hexToPixel(prop.coord);
    const y = hillLift(field, c.x + prop.offsetX, c.y + prop.offsetZ);
    return y === 0 ? prop : { ...prop, tileTop: (prop.tileTop ?? 0) + y };
  });
}

/** How far a terrace row stands from any other piece's centre, world units: never in a tree. */
const ROW_CLEAR = 1.1;

/**
 * What a terraced slope is planted with along its tread edges (`TerraceSpec.rows`).
 *
 * **Placed off the land, after it is built**, because a tread edge is a fact about the field and
 * not about any hex: a row stands on the tread just inside the edge of the riser below it, turned
 * along the contour, which is how a tended slope is planted. Every edge block is rolled against
 * `share` on its own seeded hash; a row stands `every` units from the last, so the rows along an
 * edge are spaced rather than end to end, clear of every composed piece, and checked against the
 * envelope with its tread's height as its base, so nothing hides the board.
 */
function terraceRows(field: HillField, others: ScenicProp[], tanPitch: number, seed: number): ScenicProp[] {
  const rows = field.spec.terrace?.rows;
  if (!rows || rows.keys.length === 0) return [];
  const step = field.spec.terrace!.step;
  const taken = others.map((p) => {
    const c = hexToPixel(p.coord);
    return { x: c.x + p.offsetX, z: c.y + p.offsetZ };
  });
  const out: ScenicProp[] = [];
  const at = (i: number, k: number) => (i < 0 || k < 0 || i >= field.nx || k >= field.nz ? 0 : field.heights[k * field.nx + i]);
  const placed: { x: number; z: number }[] = [];
  for (let k = 1; k < field.nz - 1; k++) {
    for (let i = 1; i < field.nx - 1; i++) {
      const y = at(i, k);
      if (y <= 0) continue;
      // The edge of a tread: a neighbour a whole tread lower, the way down the slope
      const dx = at(i - 1, k) - at(i + 1, k);
      const dz = at(i, k - 1) - at(i, k + 1);
      const lower = Math.min(at(i - 1, k), at(i + 1, k), at(i, k - 1), at(i, k + 1));
      if (y - lower < step - 1e-6) continue;
      const x = field.x0 + (i + 0.5) * HILL_CELL;
      const z = field.z0 + (k + 0.5) * HILL_CELL;
      if (Math.hypot(x, z) > rows.reach) continue;
      // Only where the camera reaches, where the edge fill owns the ground and no horizon band rolls
      if (!inFillReach(x, z)) continue;
      const roll = tileHash({ q: i, r: k }, seed + 401);
      if (roll >= rows.share) continue;
      // Back from the edge onto the tread, half a row's depth
      const g = Math.hypot(dx, dz) || 1;
      const px = x - (dx / g) * HILL_CELL;
      const pz = z - (dz / g) * HILL_CELL;
      if (Math.abs(hillFloor(field, px, pz) - y) > 1e-6) continue;
      // Spaced along the edges, `every` apart, and clear of everything else composed
      if (placed.some((t) => Math.hypot(t.x - px, t.z - pz) < rows.every)) continue;
      if (taken.some((t) => Math.hypot(t.x - px, t.z - pz) < ROW_CLEAR)) continue;
      const scale = 0.9 + tileHash({ q: i, r: k }, seed + 403) * 0.2;
      if (!tierFits(px, pz, TIER_SIZE.thicket, tanPitch, scale, y)) continue;
      // The row's length (its model's x) runs along the contour, across the slope's fall
      const rotationY = Math.atan2(dx / g, dz / g) + (tileHash({ q: i, r: k }, seed + 405) - 0.5) * 0.2;
      const coord = pixelToHex(px, pz);
      const c = hexToPixel(coord);
      out.push({
        coord,
        from: 'row',
        propKey: rows.keys[Math.floor(tileHash({ q: i, r: k }, seed + 407) * rows.keys.length) % rows.keys.length],
        rotationY,
        scale,
        offsetX: px - c.x,
        offsetZ: pz - c.y,
        tileTop: y,
      });
      placed.push({ x: px, z: pz });
    }
  }
  return out;
}

/**
 * The terrace rows among the rest: placed clear of everything but the edge fill, and a row then
 * takes its hex's fill piece's place. Ordered that way so the rows are the same with the fill or
 * without it — the fill only ever adds (`arenaEdgeFill.test.ts`) — and every hex of the reach still
 * has one piece standing on it, now the row.
 */
function plantRows(stood: ScenicProp[], field: HillField, tanPitch: number, seed: number): ScenicProp[] {
  const rows = terraceRows(field, stood.filter((p) => p.from !== 'fill' && p.from !== 'horizon'), tanPitch, seed);
  const planted = new Set(rows.map((r) => hexKey(r.coord)));
  const kept = stood.filter((p) => (p.from !== 'fill' && p.from !== 'horizon') || !planted.has(hexKey(p.coord)));
  return [...kept, ...rows];
}

/**
 * A cave's floor only: every prop whose ground is the cave's wall is dropped
 * (`CaveSpec.wall`). Composed in plan like everything else, a rolled piece on a
 * hex the rock has risen over would stand inside it or perch on a ledge of it.
 */
function offTheRock(props: ScenicProp[], field: HillField): ScenicProp[] {
  const cave = field.spec.cave;
  if (!cave) return props;
  return props.filter((prop) => {
    const c = hexToPixel(prop.coord);
    return hillLift(field, c.x + prop.offsetX, c.y + prop.offsetZ) < cave.wall;
  });
}

/**
 * What stands along a waterline.
 *
 * On the *dry* hex and pushed out to its rim, which is the whole point: a reed
 * bed at a hex centre is a reed bed in a field, and the region's own outline is
 * a row of hexagon edges that nothing else in the scene would break up. Placed
 * without claiming the hex, the way ground cover is - a tree at the water's edge
 * is correct, and it stands at the centre with the reeds in front of it.
 *
 * **One piece per boundary hex, and every one of them.** Rolled at a rate it
 * would be a dotted line, which is the one thing a shoreline may not be - the
 * edge is what the whole region exists to have, and a fringe with gaps in it
 * leaves the hexagon showing through. Two pieces per hex was the first draft and
 * it cost about a hundred props on the meadow for a bank nobody would call
 * denser; what varies instead is where along the edge each one sits.
 *
 * **In front of the board a bank piece shrinks rather than being refused**, the
 * rule `scatterFamily` already follows one path over. The envelope caps
 * everything between the camera and the near rim at `FRONT_MAX_HEIGHT`, so a
 * thicket-sized reed bed cannot stand there - and the first renders showed what
 * refusing it costs: the meadow's near pond and the wetland's open water ran
 * into the foreground with **no bank at all**, a raw staircase of hexagon edges
 * across the third of the frame nearest the eye.
 *
 * The kit's own pieces, shrunk, rather than a fall-back to its ground cover:
 * borrowing the cover was the first attempt and it is invisible by construction,
 * because the cover is *already* scattered over those same hexes and a waterline
 * marked in the same grass as the field around it marks nothing. What separates
 * a shore is that it is made of different things.
 *
 * `BANK_MIN_SCALE` is below `MIN_SCALE` deliberately, and it is the one place in
 * the composer that goes under it. `MIN_SCALE` is the size at which a scattered
 * prop stops being worth an instance; a shoreline is not scattered, and the
 * alternative to a small reed bed here is not a larger one, it is the hexagon.
 * What the near strip honestly cannot have is a *tall* bank - see the notes.
 */
const BANK_OUT = 0.62;
const BANK_ALONG = 0.34;
const BANK_MIN_SCALE = 0.24;

/** Where along its own edge one bank piece stands, and how big it is. */
function bankPlacement(
  coord: HexCoord, toWaterX: number, toWaterZ: number,
  roll: (h: HexCoord, salt: number) => number, salt: number,
): { offsetX: number; offsetZ: number; scale: number } {
  // Along the shore is the water direction turned a quarter: a bank runs
  // *parallel* to the edge it is on, so this is the one axis a piece may wander
  // down without leaving the waterline it is standing on.
  const spread = BANK_ALONG * (roll(coord, salt) * 2 - 1);
  return {
    offsetX: toWaterX * BANK_OUT - toWaterZ * spread,
    offsetZ: toWaterZ * BANK_OUT + toWaterX * spread,
    scale: 0.72 + roll(coord, salt + 2) * 0.34,
  };
}

/**
 * How far round a watercourse's source the bank stands back, world units: the
 * fall's plunge pool runs into the stream there, and a bush on that strip stood
 * between the falling water and the water it falls into.
 */
const SOURCE_CLEAR = 1.9;

/** Where a watercourse's source pieces stand, for the bank to stand back from. */
function sourcePieces(kit: SceneryKit, enclosure: Enclosure): { x: number; z: number }[] {
  const source = kit.water?.source;
  if (!source) return [];
  return enclosure.props.filter((p) => p.propKey === source).map((p) => {
    const c = hexToPixel(p.coord);
    return { x: c.x + p.offsetX, z: c.y + p.offsetZ };
  });
}

function bankPieces(
  kit: SceneryKit,
  water: WaterField,
  roll: (h: HexCoord, salt: number) => number,
  tanPitch: number,
  sources: { x: number; z: number }[] = [],
): ScenicProp[] {
  const keys = kit.water?.bank;
  if (!keys?.length) return [];
  const out: ScenicProp[] = [];
  for (const { coord, toWaterX, toWaterZ } of water.bank) {
    const centre = hexToPixel(coord);
    const at = bankPlacement(coord, toWaterX, toWaterZ, roll, 110);
    const px = centre.x + at.offsetX;
    const pz = centre.y + at.offsetZ;
    if (sources.some((s) => Math.hypot(s.x - px, s.z - pz) < SOURCE_CLEAR)) continue;
    // Both constraints are spent the same way a scattered prop spends them: the
    // smaller a piece is, the less of either it needs.
    const room = Math.min(
      headroom(px, pz, TIER_SIZE.thicket.spread, tanPitch),
      pz > BOARD_NEAR_Z ? FRONT_MAX_HEIGHT : Infinity,
    );
    const scale = Math.min(
      at.scale,
      room / TIER_SIZE.thicket.maxHeight,
      planClearance(px, pz) / TIER_SIZE.thicket.spread,
    );
    if (scale < BANK_MIN_SCALE) continue;
    out.push({
      coord,
      from: 'bank',
      propKey: keys[Math.min(keys.length - 1, Math.floor(roll(coord, 114) * keys.length))],
      // Turned to face the water, so anything with a front to it addresses the
      // edge rather than the board.
      rotationY: -Math.atan2(toWaterZ, toWaterX),
      offsetX: at.offsetX,
      offsetZ: at.offsetZ,
      scale,
    });
  }
  return out;
}

function composeKit(
  kit: SceneryKit,
  encounterId: string,
  roll: (h: HexCoord, salt: number) => number,
  tanPitch: number,
  seed: number,
  reach: SceneryReach,
): ScenicProp[] {
  const ring = ringFor(reach);
  const { enclosure, water, bank, sites } = composed(kit, encounterId, roll, tanPitch, seed);
  const out: ScenicProp[] = [...enclosure.props];
  const taken = new Set(enclosure.taken);
  const isOpen = openGroundTest(kit, enclosure, seed);
  // **The water is claimed separately from the enclosure, because one kit wants
  // half of it back.** Nothing knee-high may stand in open water and nothing at
  // all may be scattered across it — a fern in a pond is a fern floating on a
  // pond — but a bog's trees grow *out* of it, and a region that claims its
  // hexes outright takes the wetland's own identity away with them. See
  // `WaterRegion.treed`.
  const wet = new Set(water.surface.map(hexKey));
  const treed = kit.water?.treed ?? false;
  out.push(...bank);
  /**
   * The trunks, as features in their own right.
   *
   * **Which is why the cascade is two passes and not one.** "Continuous soil
   * around roots" is the review's fourth priority and the understorey is what
   * draws it — but a hex's answer may not depend on which hexes the loop has
   * already reached, or the composition stops being a function of the hex and
   * starts being a function of the iteration order. So the canopy is placed
   * over the whole ring first, and everything under it is placed second,
   * reading a field that now includes every trunk in the scene.
   *
   * The split is behaviour-preserving by construction: a hex that took a tree
   * never tried a bush anyway (the cascade broke), and every roll is salted per
   * hex and per tier, so the same hex asks the same questions in the same order
   * it did when the two passes were one.
   */
  const roots: FeatureSite[] = [];
  /** Hexes the canopy pass spoke for, which the pass under it skips. */
  const filled = new Set<string>();
  /** Hexes holding a tree, which the edge fill keeps its own trees off the neighbours of. */
  const trunks = new Set<string>();
  // `undefined` falls back to the canopy; `null` is the decision that nothing
  // stands past this kit's enclosure.
  const horizonKeys = kit.horizon === undefined ? kit.canopy : kit.horizon ?? [];

  /**
   * One hex's turn at a list of tiers, largest first.
   *
   * Largest first: a hex that can hold a tree gets a tree, and only what is left
   * over is dressed. The other order fills the flanks with ferns and leaves the
   * wall to whatever the roll has not already spent.
   */
  const placeTiers = (
    { coord, depth, x, z }: RingHex, tiers: SceneryTier[], field: FeatureSite[],
  ) => {
    const key = hexKey(coord);
    if (taken.has(key) || filled.has(key)) return;
    // Past the authored ring the edge fill owns its hexes, so what stands there
    // does not depend on how far the frame's reach happened to run.
    if (fillOwns(kit, { coord, depth, x, z })) return;
    // Open sand by design stays open; its treatment is `dunePieces`'s.
    if (isOpen({ coord, depth, x, z })) return;
    const flooded = wet.has(key);
    if (flooded && !treed) return;
    const offsetX = (roll(coord, 44) - 0.5) * 2 * JITTER;
    const offsetZ = (roll(coord, 45) - 0.5) * 2 * JITTER;
    const px = x + offsetX;
    const pz = z + offsetZ;
    // What this ground belongs to, measured where the prop will actually stand
    // rather than at the hex centre: the jitter is over half a hex, which is
    // most of a landmark's margin.
    const pull = featureAt(field, px, pz);
    // The one hard edge in the field. A composition's own ground stays clear
    // whatever the rate says, which is the half of "props belong to a feature"
    // that a bias alone cannot state — see `GROUP_MARGIN`.
    if (pull.excluded) return;
    const band = 1 - SIZE_FIELD_SPAN / 2
      + patchNoise(x * SIZE_FIELD, z * SIZE_FIELD, seed + 71) * SIZE_FIELD_SPAN;
    // The kit's own size range where it states one, the composer's otherwise —
    // see `DressingSpec`. Read here rather than at the top of the pass because
    // the whole of what an override does is replace these two numbers.
    const span = kit.dressing?.scale ?? SCALE_JITTER;
    const scale = (span.min + roll(coord, 46) * (span.max - span.min)) * band;

    for (const tier of tiers) {
      // **The horizon band takes one list and one tier slot.** Past the authored
      // ring a prop is being read as distance, and only a silhouette survives
      // that: at the reference portrait aspect a 4.4-unit tree at z = −30 is
      // still 39 screen pixels tall, a 1.4-unit bush is 12 and a 0.42-unit tuft
      // is under 4. The small tiers cost the same roll, the same instance and
      // the same matrix as the tree for something nobody can see.
      //
      // The slot is the canopy's because that is where the size cascade puts the
      // large things; *what goes in it* is `kit.horizon`, which for a walled kit
      // is a different landform or nothing at all — see `SceneryKit.horizon`.
      const horizon = depth > RING_REACH;
      if (horizon && tier !== 'canopy') continue;
      // A flooded hex has reached here only because the kit says its trees stand
      // in the water, so the cascade stops at the one tier that may.
      if (flooded && tier !== 'canopy') continue;
      // One emptiness check, after the substitution rather than before it: a kit
      // whose canopy list is empty must still be able to name a horizon, and a
      // kit that names `null` must place nothing there however full its canopy.
      const keysHere = horizon ? horizonKeys : kit[tier];
      if (keysHere.length === 0) continue;
      // Checked against the wall spec out there rather than the canopy's: the
      // band can carry a cliff segment, and it is only ever placed behind the
      // board, where `headroom` is `Infinity` and the check is a formality the
      // largest spec passes anyway. In front the cap still refuses it — which is
      // why the front reach never grows a horizon, and does not have to say so.
      if (!tierFits(px, pz, horizon ? WALL_SIZE : TIER_SIZE[tier], tanPitch, scale)) continue;

      // **A kit whose canopy is planting waives both of the canopy's
      // exemptions**, and it has to be both: the structural band is
      // unconditional so a seed cannot delete the *enclosure*, and a kit that
      // has said its canopy is not the enclosure has nothing there to protect.
      // Gathering the far cacti while still planting the two rings nearest the
      // board at a flat rate would apply the rule to the half it is cheapest
      // on, and those are the conspicuous ones. See `SceneryKit.canopyGathers`.
      const planted = tier === 'canopy' && (kit.canopyGathers ?? false);
      const structural = tier === 'canopy' && !planted && depth <= STRUCTURAL_DEPTH;
      // `enclosure` scales the canopy **everywhere**, not only its structural
      // band. Applied to the band alone it thinned the two rings nearest the
      // board and left the rest at the forest's own rate, so a meadow opened on
      // a clearing with a wood two hexes further out — which is a forest with a
      // gap in it rather than open country.
      const canopyShare = tier === 'canopy' ? kit.enclosure ?? 1 : 1;
      // **The quiet sector reaches the structural band too, and it has to.**
      // That band is unconditional so a seed can never delete the enclosure —
      // which is right where the enclosure is the picture, and is exactly what
      // closes a view the boundary was authored to open: a gap between two
      // sandstone masses fills with cacti at depth 1 and 2 whatever the arcs
      // say. A sector is authored rather than rolled, so it is the same kind of
      // statement the structural band is, and the two settle here.
      const hush = quietFactor(kit, x, z);
      // **The bias is the middle tiers' and not the canopy's**, and that is the
      // whole shape of the rule. The canopy is what a scene's enclosure is made
      // of — thinning it away from the landmarks would strip the flanks and put
      // the wood back against the wall — while the middle and low tiers are the
      // "individual boulders, fences and small ground clumps" the review says
      // are competing with the landmarks. They are also what a landmark needs
      // around it: rubble at a rock base, growth at a bank, stores by a tent.
      const gather = tier === 'canopy' && !planted
        ? 1
        : FEATURE_BIAS.away + (FEATURE_BIAS.near - FEATURE_BIAS.away) * pull.weight;
      // A kit may thin or thicken a rolled tier without touching the others —
      // and never the structural band, which `enclosure` alone answers for.
      const tierRate = kit.dressing?.rate?.[tier] ?? DRESSING_RATE[tier];
      const rate = (structural
        ? canopyShare
        : tierRate * depthDensity(depth) * canopyShare * gather) * hush;
      // **A salt of its own per tier, and none of them the one the key is
      // picked with.** The first draft gated the thicket on salt 42 and then
      // indexed its list with salt 42, so "does this hex get a prop" and "which
      // prop" were the *same number*: passing the gate meant a roll under 0.55,
      // which meant an index in the first half of the list, and the last three
      // of the eight thicket pieces — the lantern, both boulders and the log —
      // were unreachable by construction. Measured: 0 of 205. It is the
      // correlation `propKeysFor` records one scene over, and it goes quiet the
      // same way: the ring still fills, so nothing looks broken.
      if (roll(coord, 60 + TIER_ORDER.indexOf(tier)) >= rate) continue;

      // **Coherent orientation, and only where there is something to cohere
      // with.** A piece deep in a landmark's skirt lies square with it, the way
      // a bank piece already faces its water; out in the open the hash still
      // decides, because a prop with nothing to address that faces one anyway is
      // pointing at nothing. See `ORIENT_PULL`.
      // Still the hash's, planted or not: `planted` says where a piece stands,
      // not which way it points, and a cactus is a round thing — the facing
      // rule exists for the square ones lying along a ruin's wall line.
      const facing = pull.weight >= (kit.dressing?.turn?.pull ?? ORIENT_PULL)
        && tier !== 'canopy';
      out.push({
        coord,
        // The one push site that answers two ways: past `RING_REACH` the canopy
        // slot is carrying distance rather than wood, and that is the whole
        // difference between a treeline and a horizon.
        from: horizon ? 'horizon' : 'scatter',
        propKey: keysHere[
          Math.min(keysHere.length - 1, Math.floor(roll(coord, 42) * keysHere.length))
        ],
        rotationY: facing
          ? -Math.atan2(pull.z - pz, pull.x - px)
            + (roll(coord, 43) - 0.5) * (kit.dressing?.turn?.jitter ?? ORIENT_JITTER)
          : roll(coord, 43) * Math.PI * 2,
        scale,
        offsetX,
        offsetZ,
      });
      // **Only the authored ring's trunks, and that is the invariant rather than
      // a nicety.** Growing the reach may only *add* distant props, never
      // reshuffle a near one — a composition that re-rolled itself when the
      // window moved would be the worse bug, and it is what makes a
      // frame-derived reach safe at all (`reachForFrame`). A root out in the
      // horizon band is reach-dependent by construction, and its pull is wide
      // enough to reach back into the ring, so the field would move with the
      // viewport. Nothing is lost: the band is canopy-only, so there is no
      // understorey out there for a trunk to gather.
      if (tier === 'canopy' && depth <= RING_REACH) {
        roots.push({ x: px, z: pz, pull: ROOT_PULL, exclude: 0 });
      }
      // The authored ring's only: a horizon tree is the frame's, and the fill may
      // not move with the frame (see `fillOwns`).
      if (tier === 'canopy' && depth <= RING_REACH) trunks.add(key);
      filled.add(key);
      break;
    }
  };

  for (const entry of ring) placeTiers(entry, CANOPY_TIER, sites);
  /**
   * The composition plus everything the canopy pass just planted.
   *
   * Built once rather than per hex: the under-tiers and the ground cover read
   * the same field, and it is the one the trunks are in.
   */
  const floorSites = [...sites, ...roots];
  for (const entry of ring) placeTiers(entry, UNDER_TIERS, floorSites);
  if (kit.fill) {
    out.push(...fillPieces(kit, kit.fill, taken, filled, trunks, wet, treed, floorSites, roll, tanPitch, seed, isOpen));
  }
  if (kit.openGround) {
    const open = openCandidates(ring).filter((h) => !taken.has(hexKey(h.coord)) && isOpen(h));
    out.push(...dunePieces(kit.openGround, open, roll, tanPitch));
  }
  // A canopy claiming a hex must not remove the undergrowth underneath it.
  // Small groups fill the spaces between trunks, with clear pockets between
  // groups. Keep focal/wall footprints free (ponds must not sprout grass).
  const coverKeys = kit.groundCover;
  if (coverKeys?.length) {
    for (const { coord, depth, x, z } of ring) {
      // **In front of the board the cover runs as far as the frame does.** That
      // strip is the one place the envelope allows nothing but ankle height, so
      // ground cover is the only layer that can reach it at all — and it is the
      // ground nearest the camera, which at the phone aspects is a third of the
      // whole frame. Everywhere else five hexes is already past the point where
      // a tuft is worth an instance.
      const limit = z > BOARD_NEAR_Z ? reach.front : COVER_DEPTH;
      if (depth > limit || taken.has(hexKey(coord)) || wet.has(hexKey(coord))) continue;
      const cover = patchNoise(x * 0.42, z * 0.42, seed + 83);
      // The clumping is a default rather than a law: a wood's floor reads as a
      // mass because of the gaps between masses, and a meadow's does not — see
      // `SceneryKit.cover`.
      //
      // **A quiet sector lifts the threshold rather than thinning the clump.**
      // The cover is a field and not a rate, so the way to take some of it away
      // without turning a mass back into a sprinkle is to read less far down the
      // field: at a `hush` of 0 the threshold reaches 1 and the ground is bare,
      // and the clumps that survive on the way there are whole ones.
      const hush = quietFactor(kit, x, z);
      const floor = kit.cover?.threshold ?? COVER_THRESHOLD;
      const pull = featureAt(floorSites, x, z);
      if (pull.excluded) continue;
      // The same tilt in both directions about half pull, so what moves is where
      // the floor is and not how much of it there is. See `COVER_TILT`.
      const gathered = floor + (1 - hush) * (1 - floor)
        - COVER_TILT * (2 * pull.weight - 1);
      if (cover < gathered) continue;
      const near = kit.cover?.near ?? COVER_COUNT_NEAR;
      const count = depth <= 3 ? near : COVER_COUNT_FAR;
      for (let i = 0; i < count; i++) {
        const angle = roll(coord, 100 + i * 4) * Math.PI * 2;
        // **Tight, so a clump is a clump.** Spread over most of a hex the same
        // pieces read as sprinkles on bare ground rather than as undergrowth,
        // which is precisely what the reference's forest floor is not: its
        // clearing is ringed by a continuous leafy mass with clear ground
        // between masses. What makes that read is the *gap*, and a gap only
        // exists if what is not a gap is solid.
        const radius = COVER_RADIUS.min
          + roll(coord, 101 + i * 4) * (COVER_RADIUS.max - COVER_RADIUS.min);
        const offsetX = Math.cos(angle) * radius;
        const offsetZ = Math.sin(angle) * radius;
        const scale = 0.7 + roll(coord, 102 + i * 4) * 0.3;
        // Offset cover must also stay outside the gate and camp footprints.
        if (featureAt(floorSites, x + offsetX, z + offsetZ).excluded) continue;
        if (!tierFits(x + offsetX, z + offsetZ, TIER_SIZE.ground, tanPitch, scale)) continue;
        out.push({
          coord, offsetX, offsetZ, scale, rotationY: angle, from: 'cover',
          propKey: coverKeys[Math.min(coverKeys.length - 1,
            Math.floor(roll(coord, 103 + i * 4) * coverKeys.length))],
        });
      }
    }
  }
  return out;
}

/**
 * One piece on every hex of the camera's reach that the composition left empty.
 * See `EdgeFill`.
 *
 * Read after both tier passes, so it only ever takes what they left — the ring
 * composes exactly what it composed before a kit had a fill — and before the
 * cover, which dresses the floor under whatever stands here. A piece that does
 * not fit its own envelope tries the next size down rather than leaving the hex
 * bare: a tree refused on the flank's near edge is still a bush there.
 */
function fillPieces(
  kit: SceneryKit,
  fill: EdgeFill,
  taken: ReadonlySet<string>,
  filled: ReadonlySet<string>,
  ringTrunks: ReadonlySet<string>,
  wet: ReadonlySet<string>,
  treed: boolean,
  sites: FeatureSite[],
  roll: (h: HexCoord, salt: number) => number,
  tanPitch: number,
  seed: number,
  isOpen: (hex: RingHex) => boolean = () => false,
): ScenicProp[] {
  const out: ScenicProp[] = [];
  const trunks = new Set(ringTrunks);
  for (const { coord, depth, x, z } of fillHexes(fill.deeper ?? 0, fill.wider ?? 0)) {
    const key = hexKey(coord);
    // Open ground is ground: water is never opened, so what a sea has standing in it still stands
    if (!wet.has(key) && isOpen({ coord, depth, x, z })) continue;
    const front = z > BOARD_NEAR_Z;
    // In front of the board the only thing the ring can have put on a hex is one
    // ankle-high piece — a pebble, a bone, a tuft — which leaves the hex as bare as
    // it was to the eye, so the clump goes down beside it. Everywhere else a hex the
    // ring dressed is left as it is.
    if (taken.has(key) || (!front && filled.has(key))) continue;
    // A quiet sector is authored open, and the fill reads it the way the tiers do —
    // inside the ring, on the board's own level. Down a shelf's drop, or past the
    // ring, the ground is the view the sector keeps open, and left thinned it was
    // bare country in that view.
    const below = kit.shelf !== undefined && shelfHeight(kit.shelf, seed, x, z) < 0;
    if (!below && depth <= RING_REACH && roll(coord, 130) >= quietFactor(kit, x, z)) continue;
    // **Loose, not packed.** A tree goes where the roll allows it, the clearing
    // field does not open a glade, and no tree already stands on a neighbouring
    // hex — the ring's or the fill's own. The first pass rolled `share` alone and
    // the designer's review of it was "tree on tree": at a hex's spacing the canopy
    // tier's crowns overlap. What stands in a gap is the `under` list, so the
    // ground stays covered while the stands open up.
    const flooded = wet.has(key);
    // What a sea has standing in it, at its own share (`EdgeFill.afloat`)
    const afloat = flooded && fill.afloat !== undefined;
    const tall = !front && depth >= fill.from && roll(coord, 131) < (afloat ? fill.afloat!.share : fill.share)
      && patchNoise(x * CLEARING_FIELD, z * CLEARING_FIELD, seed + 151) >= CLEARING_SHARE
      && !getNeighbors(coord).some((n) => trunks.has(hexKey(n)));
    // Open water is already not bare ground; only a bog's trees and a sea's stacks stand in it.
    if (flooded && !(tall && (treed || afloat))) continue;
    const offsetX = (roll(coord, 132) - 0.5) * 2 * FILL_JITTER;
    const offsetZ = (roll(coord, 133) - 0.5) * 2 * FILL_JITTER;
    const px = x + offsetX;
    const pz = z + offsetZ;
    if (featureAt(sites, px, pz).excluded) continue;
    const band = 1 - SIZE_FIELD_SPAN / 2
      + patchNoise(x * SIZE_FIELD, z * SIZE_FIELD, seed + 71) * SIZE_FIELD_SPAN;
    // Past the authored ring a tree is distance, and the kit may say what it is built as there.
    const tallKeys = afloat ? fill.afloat!.keys : depth > RING_REACH && fill.distant?.length ? fill.distant : fill.far;
    // Low pieces keep their size wherever they stand: shrunk by the size field, a
    // low piece is a chip on the ground.
    // Down a shelf's drop the country may be another ground altogether (`EdgeFill.below`): the
    // summit's cloud sea takes cloud banks where its rock takes boulders.
    // Read where the piece itself stands, not at its hex's centre: the lip wanders through hexes.
    const sunk = (ax: number, az: number) => kit.shelf !== undefined && shelfHeight(kit.shelf, seed, ax, az) < 0;
    const down = fill.below !== undefined && sunk(px, pz);
    // A lower country that is mostly open takes its pieces on a share of its hexes (`EdgeFill.below`)
    if (down && fill.below!.share !== undefined && roll(coord, 138) >= fill.below!.share) continue;
    const under = down ? fill.below!.under : fill.under;
    const lowKeys = down ? fill.below!.low : fill.low;
    const sizes: [string[], TierSpec, number][] = front
      ? []
      : [
        ...(tall ? [[tallKeys, WALL_SIZE, (0.86 + roll(coord, 134) * 0.24) * band] as [string[], TierSpec, number]] : []),
        [under, TIER_SIZE.thicket, (0.86 + roll(coord, 135) * 0.2) * band],
        [lowKeys, TIER_SIZE.ground, 0.94 + roll(coord, 134) * 0.12],
      ];
    if (front) {
      // A clump of the low list, each piece checked where it stands. See `EdgeFill.clump`.
      for (let i = 0; i < (fill.clump ?? 1) && lowKeys.length > 0; i++) {
        const angle = roll(coord, 140 + i * 3) * Math.PI * 2;
        const ox = offsetX + (i === 0 ? 0 : Math.cos(angle) * FRONT_CLUMP_REACH);
        const oz = offsetZ + (i === 0 ? 0 : Math.sin(angle) * FRONT_CLUMP_REACH);
        const scale = 0.94 + roll(coord, 141 + i * 3) * 0.12;
        if (featureAt(sites, x + ox, z + oz).excluded) continue;
        // A cloud lies on the cloud sea, never on the rock above its lip
        if (fill.below !== undefined && sunk(x + ox, z + oz) !== down) continue;
        if (!tierFits(x + ox, z + oz, TIER_SIZE.ground, tanPitch, scale)) continue;
        out.push({
          coord,
          from: 'fill',
          propKey: lowKeys[(Math.floor(roll(coord, 136) * lowKeys.length) + i) % lowKeys.length],
          rotationY: roll(coord, 142 + i * 3) * Math.PI * 2,
          scale,
          offsetX: ox,
          offsetZ: oz,
        });
      }
      continue;
    }
    for (const [keys, spec, scale] of sizes) {
      if (keys.length === 0 || (flooded && keys !== tallKeys)) continue;
      if (!tierFits(px, pz, spec, tanPitch, scale)) continue;
      if (keys === tallKeys && spec === WALL_SIZE) trunks.add(key);
      out.push({
        coord,
        from: 'fill',
        propKey: keys[Math.min(keys.length - 1, Math.floor(roll(coord, 136) * keys.length))],
        rotationY: roll(coord, 137) * Math.PI * 2,
        scale,
        offsetX,
        offsetZ,
      });
      break;
    }
  }
  return out;
}

/**
 * The fallback path: the world map's own decoration family, shrunk to fit.
 *
 * Every surface without an authored kit still gets dressed, exactly as it was
 * before kits existed, so the thirteen reference contexts can be built one at a
 * time rather than all at once behind a flag.
 */
function scatterFamily(
  keys: string[],
  roll: (h: HexCoord, salt: number) => number,
  tanPitch: number,
  reach: SceneryReach,
): ScenicProp[] {
  const out: ScenicProp[] = [];
  for (const { coord, depth, x, z } of ringFor(reach)) {
    if (roll(coord, 41) >= BALANCE.ARENA_PROP_DENSITY * depthDensity(depth)) continue;

    const offsetX = (roll(coord, 44) - 0.5) * 2 * JITTER;
    const offsetZ = (roll(coord, 45) - 0.5) * 2 * JITTER;
    const px = x + offsetX;
    const pz = z + offsetZ;

    // A map prop **shrinks to fit** rather than being refused outright, and that
    // is what dresses the board's own rim: these are already small, the hexes
    // touching the board have barely half a unit of plan clearance, and a rule
    // that only ever says no would leave a bare ring exactly where the eye reads
    // the boundary. Both constraints are spent the same way — the smaller a prop
    // is, the less of either it needs.
    const room = Math.min(
      headroom(px, pz, LEGACY_TIER.spread, tanPitch),
      pz > BOARD_NEAR_Z ? FRONT_MAX_HEIGHT : Infinity,
    );
    const scale = Math.min(
      1,
      room / LEGACY_TIER.maxHeight,
      planClearance(px, pz) / LEGACY_TIER.spread,
    );
    if (scale < MIN_SCALE) continue;

    out.push({
      coord,
      from: 'scatter',
      propKey: keys[Math.min(keys.length - 1, Math.floor(roll(coord, 42) * keys.length))],
      rotationY: roll(coord, 43) * Math.PI * 2,
      scale,
      offsetX,
      offsetZ,
    });
  }
  return out;
}

/**
 * Everything a kit's shelf does to the props, in one pass at the end.
 *
 * Two halves, and they are one pass because they are one statement: a prop past
 * the lip stands on whatever terrace is under it, and the distant masses stand
 * on the lower country. Applied *after* the composition rather than inside it,
 * so the whole cascade — the boundary, the groups, the anchors, the three
 * tiers, the cover — keeps being decided in plan by ground that has not moved.
 * The envelope is about screen columns and plan overlap, and both of those are
 * arguments about x and z; dropping a prop only ever moves it further *below*
 * the board's own ground, which is the safe direction for every rule in this
 * file and is why none of them has to learn about elevation.
 *
 * The masses go through `tierFits` at the wall course's size, with their own
 * base handed in — a mass six units down is six units shorter as far as every
 * rule in the envelope is concerned, and that is the whole reason the parameter
 * exists. What it still refuses is refused for the ordinary reason.
 */
function standOnShelf(
  props: ScenicProp[], spec: ShelfSpec, seed: number, tanPitch: number,
): ScenicProp[] {
  const out = props.map((prop) => {
    const centre = hexToPixel(prop.coord);
    const y = shelfHeight(spec, seed, centre.x + prop.offsetX, centre.y + prop.offsetZ);
    // **Added, not assigned.** A group piece's `lift` is already in here, and a
    // gate standing on ground that has since fallen away has to fall with it —
    // overwriting would put the landing back on the board's own plane and hang
    // it in the air over the terrace below.
    return y === 0 ? prop : { ...prop, tileTop: (prop.tileTop ?? 0) + y };
  });
  for (const mass of shelfMasses(spec, seed)) {
    if (!tierFits(mass.x, mass.z, WALL_SIZE, tanPitch, mass.scale, mass.y)) continue;
    // The hex it stands over, so `coord` keeps meaning what it means everywhere
    // else in this module — the whole offset would otherwise have to ride on a
    // coordinate the mass is nowhere near, and `inArena` is asserted over it.
    const coord = pixelToHex(mass.x, mass.z);
    const centre = hexToPixel(coord);
    out.push({
      coord,
      propKey: mass.key,
      from: 'shelf',
      rotationY: mass.rotationY,
      scale: mass.scale,
      offsetX: mass.x - centre.x,
      offsetZ: mass.z - centre.y,
      tileTop: mass.y,
    });
  }
  return out;
}

export function arenaScenery(
  encounterId: string,
  scenery: ArenaScenery,
  tanPitch: number,
  reach: SceneryReach = DEFAULT_REACH,
): ScenicProp[] {
  // Seeded on the encounter, so one fight looks the same every frame and two
  // fights on the same ground do not look like the same clearing.
  const seed = strHash(encounterId) % 997;
  const roll = (h: HexCoord, salt: number) => tileHash(h, salt + seed);

  if (scenery.kit) {
    const composedProps = composeKit(scenery.kit, encounterId, roll, tanPitch, seed, reach);
    const hills = composed(scenery.kit, encounterId, roll, tanPitch, seed).hills;
    const stood = hills ? offTheRock(standOnHills(composedProps, hills), hills) : composedProps;
    const props = hills?.spec.terrace?.rows ? plantRows(stood, hills, tanPitch, seed) : stood;
    const shelf = scenery.kit.shelf;
    return shelf ? standOnShelf(props, shelf, seed, tanPitch) : props;
  }
  if (scenery.propKeys.length === 0) return [];
  return scatterFamily(scenery.propKeys, roll, tanPitch, reach);
}

/**
 * The land this fight is standing on, for the scene that has to draw it.
 *
 * A fourth entry point beside `arenaWater` and `arenaFeatures`, and the same
 * argument: the ground goes to a different layer from the props, and the two may
 * not disagree about where the lip is. They cannot — both read `shelfRadius`,
 * which is a pure function of the spec, the seed and a bearing.
 *
 * `null` for every kit without one, which is the sixteen that keep the flat disc
 * they have always had.
 */
export function arenaShelfProfile(
  encounterId: string, scenery: ArenaScenery,
): { spec: ShelfSpec; seed: number; profile: ShelfProfile } | null {
  const spec = scenery.kit?.shelf;
  if (!spec) return null;
  const seed = strHash(encounterId) % 997;
  return { spec, seed, profile: shelfProfile(spec, seed) };
}

/**
 * The hills this fight stands among, for the scene that draws them and the reach
 * check that samples them. `null` for every kit without `hills`.
 *
 * A fifth read of the one memo, the arrangement `arenaWater` already makes: the
 * props are stood on exactly this grid, so the ground drawn under a tree is the
 * ground it was told it stands on.
 */
export function arenaHills(
  encounterId: string, scenery: ArenaScenery, tanPitch: number,
): HillField | null {
  if (!scenery.kit?.hills) return null;
  const seed = strHash(encounterId) % 997;
  const roll = (h: HexCoord, salt: number) => tileHash(h, salt + seed);
  return composed(scenery.kit, encounterId, roll, tanPitch, seed).hills;
}

/**
 * The water this fight is fought beside, as ground rather than as objects.
 *
 * A second entry point rather than a second return value on `arenaScenery`,
 * because the two answers have two consumers: the props go to the instanced
 * layer and the surface goes to the hex grid. They cannot disagree - both read
 * `composed`, which is one derivation behind a single-slot memo, so the second
 * of the two calls in a frame is a pointer comparison.
 */
export function arenaWater(
  encounterId: string,
  scenery: ArenaScenery,
  tanPitch: number,
): WaterField {
  if (!scenery.kit?.water) return EMPTY_WATER;
  const seed = strHash(encounterId) % 997;
  const roll = (h: HexCoord, salt: number) => tileHash(h, salt + seed);
  return composed(scenery.kit, encounterId, roll, tanPitch, seed).water;
}

/**
 * The ground this fight leaves open on purpose (`OpenGround`), as hexes.
 *
 * Read by the camera-reach check, which counts these as dressed: the same predicate
 * the composer skipped them with, over the same hexes it could have dressed — the
 * ring at this reach and the fill's reach past it — less anything a group, the wall
 * or the water already holds. Empty for every kit that declares none.
 */
export function arenaOpenGround(
  encounterId: string,
  scenery: ArenaScenery,
  tanPitch: number,
  reach: SceneryReach = DEFAULT_REACH,
): HexCoord[] {
  const kit = scenery.kit;
  if (!kit?.openGround) return [];
  const seed = strHash(encounterId) % 997;
  const roll = (h: HexCoord, salt: number) => tileHash(h, salt + seed);
  const { enclosure } = composed(kit, encounterId, roll, tanPitch, seed);
  const isOpen = openGroundTest(kit, enclosure, seed);
  return openCandidates(ringFor(reach))
    .filter((h) => !enclosure.taken.has(hexKey(h.coord)) && isOpen(h))
    .map((h) => h.coord);
}

/**
 * What this fight's loose scenery belongs to.
 *
 * A third read of the same memo, and it exists so the rule can be *measured*
 * against the field the composer actually used rather than against a copy of it
 * — the arrangement `masteryLab` records one system over: a copy nothing
 * compares is a copy that drifts. Nothing in the app calls it; the gather, the
 * facing and the exclusion margin are all stated over what comes back here.
 */
export function arenaFeatures(
  encounterId: string,
  scenery: ArenaScenery,
  tanPitch: number,
): FeatureSite[] {
  if (!scenery.kit) return [];
  const seed = strHash(encounterId) % 997;
  const roll = (h: HexCoord, salt: number) => tileHash(h, salt + seed);
  return composed(scenery.kit, encounterId, roll, tanPitch, seed).sites;
}
