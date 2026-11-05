/**
 * What stands around a fight, per surface, in three sizes.
 *
 * Sibling to `terrainDisplay` and pure for the same reason — a layout is a rule
 * and has to be measurable in the node suites, so nothing here imports `three`,
 * React Native or the model roster. These are ids; `voxel/models/scenery.ts`
 * builds them and `assets/models/modelMap` registers them.
 *
 * **A kit is opt-in per surface.** A surface with no entry keeps being dressed
 * from the world map's own `propFamily` — the behaviour every arena had before
 * this existed — which is what lets the thirteen reference contexts be built one
 * at a time instead of all at once behind a flag.
 *
 * The three tiers are a contract with the scenery envelope in
 * `systems/combat/arenaScenery.ts`, not a label. Each states **one** height and
 * **one** half-footprint for its whole family, and `arenaScenery.test.ts`
 * measures every model against the tier it was filed under. Asking each model
 * its own size instead would make where a prop may stand a function of which
 * variant a hash happened to pick, which is a placement rule nobody can reason
 * about and no test can state.
 */

export type SceneryTier = 'canopy' | 'thicket' | 'ground';

/** How big anything in a tier may be, in world units. */
export interface TierSpec {
  /** Tallest model in the family. */
  maxHeight: number;
  /** Widest half-footprint in the family. */
  spread: number;
}

/**
 * The three sizes, and what each is for.
 *
 * - **canopy** — trees and the like, 2.5–4.4 units against a hero's 1.6. This is
 *   the tier the whole envelope exists for: it can only stand where nothing
 *   playable is behind it in the same screen column, which is the flanks and the
 *   rear, and it is what turns a lit disc into a clearing.
 * - **thicket** — knee to waist: saplings, bushes, boulders, deadfall. Fills the
 *   gap under the treeline, which is otherwise a row of trunks over bare ground.
 * - **ground** — ankle-high. The only tier allowed between the camera and the
 *   board, so its ceiling is `FRONT_MAX_HEIGHT` less a margin.
 */
export const TIER_SIZE: Record<SceneryTier, TierSpec> = {
  canopy: { maxHeight: 4.4, spread: 1.15 },
  thicket: { maxHeight: 1.4, spread: 0.65 },
  ground: { maxHeight: 0.42, spread: 0.32 },
};

/** Largest first, which is the order the composer tries them in. */
export const TIER_ORDER: SceneryTier[] = ['canopy', 'thicket', 'ground'];

/**
 * One piece the composition is guaranteed to place, rather than rolls for.
 *
 * The tiers are a *texture* — a rate per hex, thinning outward — and a texture
 * has no landmarks in it. The references do: a haunted wood is read by the two
 * or three warm lantern pockets around its clearing, and at a rate of one in
 * eight thicket hexes a lantern turns up somewhere behind the camera as often
 * as not. Section 3A calls these focal anchors and they are the half of the
 * composition a density cannot produce.
 *
 * Spread evenly by *bearing* around the board, because what they are for is
 * marking the rim of the clearing in several directions — four rolled
 * independently would clump, which is the same argument `placeBranches` makes
 * about road roots one scene over.
 */
export interface FocalAnchor {
  key: string;
  /** Which tier's size the envelope should check it against. */
  tier: SceneryTier;
  /** How many, spread evenly around the board. */
  count: number;
  /** Hexes past the board to aim for; the nearest legal hex outward wins. */
  depth: number;
  /**
   * A fixed direction from the board, in radians, instead of an even spread.
   *
   * A throne is not a rhythm: a hall has one head, and it is the far end.
   * `-π/2` is straight away from the camera, because `hexToPixel` maps +r to +z
   * and the camera looks down -z — so the bearing here is the one the *player*
   * sees rather than the one the axial grid stores.
   */
  bearing?: number;
}

/**
 * One piece of a focal group, placed in the group's own frame.
 *
 * Both offsets are **world units**, not hexes: the pieces of a composition stand
 * where they stand relative to each other, and quantising them to the lattice
 * would make a dais's two halves a hex and three quarters apart.
 */
export interface GroupPiece {
  key: string;
  /** Which tier's size the envelope checks it against. */
  tier: SceneryTier;
  /** Across the axis. Positive is to the right as the board looks at the group. */
  across: number;
  /** Along the axis. Positive is further from the board. */
  along: number;
  /** Multiplies the model's own scale. */
  scale?: number;
  /** Added to the group's own facing, in radians. */
  turn?: number;
  /**
   * How far above the group's own ground the piece stands, in world units.
   *
   * **The axis a composition could not say anything on, and the one a *built*
   * thing is read by.** Every offset above is in plan, so a group could only
   * ever lay its pieces out flat — which is right for a hall, whose floor is a
   * floor, and is exactly why the pass's gate came out as an arch, a row of
   * steps and two timber decks standing separately on one grey disc. A gate is
   * a structure: the flight climbs *to* the landing, the landing carries the
   * arch, and the decks are built onto the landing rather than beside it. None
   * of those three sentences is expressible without a height.
   *
   * It is the prop's `tileTop` — the same field a `shelf` kit's drop already
   * writes, and it **adds** to it, so a lifted piece on a terrace stands on the
   * terrace. And it is handed to the envelope as the piece's own base, which is
   * `tierFits`'s existing `baseY` read the other way: a mass on the lower
   * country is shorter than the board, and a deck on a landing is taller.
   *
   * Cosmetic for the reason everything out here is: a group stands outside
   * `inArena` by construction, so nothing a unit may occupy has a height.
   */
  lift?: number;
}

/**
 * Several pieces at fixed offsets about one bearing — a *composition*, where a
 * `FocalAnchor` is one object.
 *
 * **The castle is where the absence of this was loudest, and the review says so
 * in one line: the throne/stair/carpet axis is undersized.** An anchor puts a
 * single key on a single hex, so the head of the hall was one throne about two
 * units tall standing among fifteen pillars — and what the reference actually
 * has at the head of a hall is a dais, a stair, the throne, flanking statues,
 * standards and fire at the foot of the steps. None of those is a rate and none
 * of them is placed anywhere except *with respect to the others*.
 *
 * Deliberately general. The desert camp's "dense ruined-camp hierarchy" and the
 * pass's "arches, stairs, timber platforms" are the same mechanism with
 * different furniture, which is why the offsets are numbers rather than a hall's
 * vocabulary.
 *
 * The group claims the ground its pieces cover, so nothing is rolled on top of
 * a dais — the rule a single anchor already follows, over a footprint instead of
 * a hex.
 */
export interface FocalGroup {
  /**
   * Which way from the board, in radians, as the *player* sees it. `-π/2` is
   * straight away from the camera — the far end, which is where a hall's head
   * is and the bearing `GROUND_COMPOSITION`'s carpet band is authored at.
   */
  bearing: number;
  /** Hexes past the board the group's origin sits at. */
  depth: number;
  pieces: GroupPiece[];
  /**
   * The group stands in the water rather than on the ground: a ship moored off a quay, the jetty
   * it is moored to, the ship alongside a deck. It claims no hexes, so the kit's water region runs
   * under it; a claimed hex is dry ground drawn round the pieces, which in a harbour reads as a
   * sandbank. Its pieces still pass the envelope, and still gather and exclude loose scenery.
   */
  afloat?: boolean;
}

/**
 * One piece somebody put somewhere, as opposed to one a rule placed.
 *
 * **The composer's other half, and the one it did not have.** Every placement in
 * this file is *derived* — a bearing and a depth, an arc at a radius, a rate per
 * hex — because a rule is what a composer can be given, and a rule is what
 * survives a new seed. What an editor does is the opposite and cannot be said
 * any other way: *this* crag, *there*. A `FocalGroup` is the closest the kit
 * came, and it is still polar and still chooses its own origin hex, so a piece
 * dragged half a unit would come back somewhere else.
 *
 * In **world units about the board's centre**, the frame `GroupPiece` already
 * measures its offsets in: `+x` is to the right of the frame and `+z` is toward
 * the camera, matching `hexToPixel`. Not quantised to the lattice, because
 * snapping a dropped object to the nearest hex moves it by up to half a hex the
 * moment it is saved, which is an editor that argues with the person using it.
 *
 * **Seed-invariant in plan, and that is the contract rather than a consequence.**
 * Nothing here is rolled and nothing here is refused by the land: a placement is
 * checked against the envelope, which is a function of the frame, and then
 * `standOnShelf` sets it down on whatever ground it is standing over. A group is
 * refused off the shelf because a composition split by a lip is no longer the
 * composition; a single hand-placed piece on the terrace below is a thing a
 * designer may well have meant.
 */
export interface ScenicPlacement {
  key: string;
  /** Which tier's size the envelope checks it against. */
  tier: SceneryTier;
  /** World units right of the board's centre. */
  x: number;
  /** World units toward the camera from the board's centre. */
  z: number;
  /** How far above the ground under it the piece stands. `GroupPiece.lift`. */
  lift?: number;
  /** Multiplies the model's own scale. */
  scale?: number;
  /** Facing, in radians. */
  turn?: number;
}

/**
 * A second course inside the wall, on a beat.
 *
 * **Pillars dominate the hall because a rate has no rhythm in it.** They were a
 * `canopy` list, so the structural band placed one on every hex it fitted at
 * depth 0–2 — fifteen columns at fifteen distances, which reads as a stand of
 * trees made of stone. A colonnade is the wall ring's own placement rule applied
 * one course in: every hex at a fixed depth, in bearing order, one in every
 * `beat`.
 *
 * `beat` rather than a count, because the number of hexes at a depth is a
 * function of the board's shape and a count would have to be re-derived the day
 * that moved. What is being authored is the *spacing*.
 */
export interface Colonnade {
  keys: string[];
  /** Hexes past the board. */
  depth: number;
  /** One pillar every `beat` hexes round the course. */
  beat: number;
}

/**
 * One mass of the boundary: a stretch of course about a bearing.
 *
 * **A room has a wall and a landscape has landforms, and until this existed the
 * composer could only build the first.** `WallRing` places a segment on every
 * hex at one depth, which is exactly right for a hall and is what the
 * composition review calls the bowl: the canyon and the pass both take the
 * interior grammar, so both come out as a continuous, uniform-height retaining
 * wall at a fixed radius with the camera-side quarter cut away. That reads as
 * the bottom of something whatever is carved into the segments.
 *
 * An arc is the same course restricted to a sector, and the two things it buys
 * are the two the review asks for by name. **Separated masses**: each arc
 * carries its own `depth`, `keys` and `scale`, so a near shoulder on one flank
 * and a lower range further back are one boundary rather than one radius. And
 * **open sectors**: bearings no arc covers hold no boundary at all, which is
 * how a desert gets a view out into sand.
 *
 * Arcs are tried in author order and the first one covering a hex wins, so two
 * that overlap resolve rather than stacking two segments on one hex.
 */
export interface BoundaryArc {
  /**
   * The middle of the mass, in radians, as the *player* sees it — `-π/2` is
   * straight away from the camera, the same convention `FocalAnchor.bearing`
   * and `FocalGroup.bearing` are authored in.
   */
  bearing: number;
  /** How wide the mass is, in radians, total — half of it either side. */
  sweep: number;
  /** This mass's own segments; the course's `keys` when omitted. */
  keys?: string[];
  /** Hexes past the board, when this mass does not stand at the course's own. */
  depth?: number;
  /** Multiplies the segment's model scale, so masses need not be one height. */
  scale?: number;
}

/**
 * A continuous enclosure at a fixed depth — the thing a rate per hex cannot be.
 *
 * A wood is a texture and is honestly a density; a hall is a **room**, and a wall
 * with gaps rolled into it is a ruin. So this is placed on every hex at its depth
 * that the envelope allows, in order, rather than rolled.
 *
 * **The gap at the near side is the cutaway, and it is free.** The envelope
 * refuses anything over ankle height in front of the board's rim, so a wall ring
 * comes out closed around the rear and both flanks and open toward the camera,
 * which is exactly the front-wall cutaway Section 3A asks for. Nothing has to
 * know which side the camera is on.
 *
 * **`arcs` is how an outdoor kit stops being a room.** Omitted, the course is
 * the closed ring above and every interior kit keeps exactly the behaviour it
 * shipped with; given, the course is only laid where an arc covers it. See
 * `BoundaryArc`.
 */
export interface WallRing {
  /** Segment keys; one is chosen per hex, so a course can vary. */
  keys: string[];
  /** Hexes past the board. */
  depth: number;
  /** Separated masses instead of one closed course. */
  arcs?: BoundaryArc[];
}

/**
 * A direction the loose scenery stands back from.
 *
 * **The opposite field to an arc, and it has to be a second one.** An arc says
 * where the *boundary* is, and leaving a sector out of the arc list opens the
 * horizon there — but the three tiers are rolled per hex over the whole ring,
 * and the innermost band of the canopy is placed unconditionally, so a gap in
 * the wall fills with trees, cacti and outcrops and the view the gap was cut for
 * is closed again by the dressing. A quiet sector is the composer's half of the
 * same decision: inside it the rolled tiers and the ground cover thin to
 * `density`, so what is authored as open stays open.
 *
 * It is also the "quiet areas between groups" of the review's third priority,
 * which is the same mechanism read the other way round: a landmark is legible
 * because of what is *not* standing next to it.
 *
 * Placed pieces are untouched — a focal anchor, a group and the boundary itself
 * are the composition, and a sector that could delete one would be a way of
 * authoring a landmark and then hiding it. What thins is only what is rolled.
 */
export interface QuietSector {
  /** The middle of the quiet ground, in radians, as the player sees it. */
  bearing: number;
  /** How wide it is, in radians, total. */
  sweep: number;
  /**
   * The share of the ordinary rate kept inside it, 0 to 1.
   *
   * Defaults to `QUIET_DENSITY`. Zero is legal and is bare ground; it is not the
   * default because ground with nothing at all on it next to ground at full rate
   * has a line between them, which is the fault `depthDensity`'s fade already
   * exists to avoid one axis over.
   */
  density?: number;
}

/** What a quiet sector keeps when it does not say. */
export const QUIET_DENSITY = 0.25;

/**
 * The ground past the ring that the camera still reaches, and what covers it.
 *
 * **The arena review's commonest complaint, answered as a layer rather than as a
 * denser ring.** The ring is sized for the whole-board fit, and the player can
 * anchor the camera on a rim hex and pull it out to the same zoom, which sees half
 * a frame further: at the landscape phones that is ground to 22 hexes behind the
 * board, 14 beside it and 9 in front of it, and the ring stops at 7 on the flanks
 * and thins to nothing behind. `arenaReach` measured it as bare ground in every
 * open-air arena (the private project notes/`).
 *
 * The fill takes **every hex the rest of the composition left empty**, out to
 * that reach, and puts one piece on it — so it only ever adds, and what the ring
 * already composed stands exactly where it stood. Three lists, by where the hex is:
 *
 * - `low` in front of the board, where nothing over ankle height may stand
 *   (`FRONT_MAX_HEIGHT`), and that is low growth the camera reads the fight over;
 * - `under` beside and behind it nearer than `from`, waist-high, so a meadow stays
 *   a meadow with its trees standing in it rather than becoming a wood;
 * - from `from` out, `far` on a share of the hexes and `under` on the rest: the
 *   tree line, rocks or landforms that close the distance, with growth between them.
 *
 * **One instance a hex, of the kit's own keys**, so it costs matrices and the
 * kinds the kit already draws rather than new draw calls; and placed on the hex's
 * own seeded roll, independent of the frame's reach, so a resize never reshuffles
 * it. Past `RING_REACH` the fill owns its hexes outright and the horizon band only
 * runs beyond it.
 */
/**
 * Ground a kit leaves open on purpose: free land, not a gap.
 *
 * **The edge fill's opposite, and the camera-reach check has to tell the two apart.**
 * The 2026-10-21 review asked every open-air arena to be dressed out to the edge of
 * the reach, and the fill does that; the desert's review of the filled result was
 * "too much props — there should be some free land on desert". Open sand is what a
 * desert *is*, so the kit says where it is rather than thinning everything evenly:
 *
 * - a coherent field (`threshold` on `patchNoise` at `scale`) opens irregular patches
 *   and lanes between the stands, so what is dressed reads as clusters of cactus,
 *   rock and bone with sand between them rather than an even carpet;
 * - `clearing` keeps the ground round each composed group open, so a camp or a gate
 *   stands in sand rather than inside the scatter;
 * - `front` leaves the whole strip in front of the board open — the review's
 *   "drop the clutter in front of the board";
 * - and the open ground is *treated* rather than left blank: a share (`dune`) of its
 *   hexes behind and beside the board carries a flat dune with wind ripples from
 *   `dunes`, all lying along one wind (`wind`), under the reach check's floor.
 *
 * Neither the rolled tiers nor the fill put anything on an open hex. The reach check
 * reads the same decision (`arenaOpenGround`) and counts those hexes as dressed, so
 * it still reports ground left bare by accident — a hex the rule did not open, ground
 * past the reach, the back of a wall — and accepts only the sand that was designed.
 */
export interface OpenGround {
  /** Field value under which a hex is open sand, 0 to 1. Higher is more open land. */
  threshold: number;
  /** Field cells per world unit; a patch is about `1 / scale` units across. */
  scale: number;
  /** World units round every composed group piece that stay open. */
  clearing?: number;
  /** Whether every hex in front of the board is open. */
  front?: boolean;
  /** Flat ground pieces — dunes, ripples — laid on open hexes. Under the reach floor. */
  dunes: string[];
  /** Share of the open hexes beside and behind the board that carry one. */
  dune: number;
  /** The bearing the wind blows along, radians; every dune lies across it. */
  wind: number;
}

export interface EdgeFill {
  /**
   * Tall pieces: trees, crags, the distance. Placed at the wall course's size
   * (`WALL_SIZE`), the horizon band's own envelope — they stand beside and behind
   * the board, where `headroom` is infinite.
   */
  far: string[];
  /**
   * What stands in `far`'s place past `RING_REACH`: the same trees built for the
   * distance (`distant` in `voxel/models/scenery.ts`), ungranulated and a third to
   * half the triangles, because out there a granulation cell is two screen pixels.
   * `far` itself when absent.
   */
  distant?: string[];
  /** Waist-high pieces, at the thicket's size. */
  under: string[];
  /** Ankle-high pieces in front of the board, at the ground tier's size. */
  low: string[];
  /**
   * How many `low` pieces stand together on one hex in front of the board; one when
   * absent.
   *
   * **A clump, because one ankle-high piece on a hex is a speck.** The first
   * captures of the haunted plains put a single thorn in the middle of each hex
   * 1.7 units across, and on dark ground it read as a mark rather than as growth —
   * the opposite of what the review asked for behind the starting line. Three,
   * close enough to touch, read as one patch the size of the hex. Only the kits with
   * no ground cover need it: a living kit's cover already runs to the frame's edge
   * in front, and a clump there would be paid for twice in the box guard.
   */
  clump?: number;
  /** Hexes past the board where `far` starts. Nearer than this the fill is `under` only. */
  from: number;
  /** Share of the hexes from `from` out that take a `far` piece. */
  share: number;
  /**
   * World units the fill reaches past `FILL_REACH` behind the board, for a kit
   * whose far ground lies below the board's level: a shelf's lower country is
   * seen further off than flat ground, and the pass's showed bare there.
   */
  deeper?: number;
  /**
   * World units the fill reaches past `FILL_REACH` to either side, for the same reason as
   * `deeper`: a summit's lower country falls away on every bearing and is seen further off to the
   * flanks than flat ground is.
   */
  wider?: number;
  /**
   * What the fill stands down a shelf's drop instead of `under` and `low`, when the lower country is
   * another ground: Kairen's summit stands boulders on its rock and banks of cloud on the cloud sea
   * below it. `under` and `low` everywhere when absent. `share` dresses only that share of the hexes
   * down there, for a lower country that is mostly open (`ShelfSpec.sea`); every hex when absent.
   */
  below?: { under: string[]; low: string[]; share?: number };
  /**
   * Share of the fill's hexes past `RING_REACH` that are standing water, chosen by
   * the kit's own pool field — a bog's far country is mostly water. Only with a
   * `water` region, whose colour and bank it borrows. A `course` carries on round its
   * own arc, in front of the board as well: the sea off a beach or round a ship's deck
   * has no far bank. Pools stay beside and behind the board.
   */
  water?: number;
  /**
   * What stands out in that water, at the wall's size: the sea stacks off a beach, a
   * ship on the horizon. On flooded hexes from `from` out, at a share of its own — a
   * sea is mostly open water where a wood is mostly trees. Nothing but a bog's trees
   * (`WaterRegion.treed`) stands in the water when absent.
   */
  afloat?: { keys: string[]; share: number };
}

/**
 * One sector the land falls away in, and how far out the edge of it runs.
 *
 * Authored in world units rather than in hexes, unlike everything else that
 * measures itself off the board. The rim is a *landform*: it is drawn as a
 * continuous curve at a hundred and ninety-two bearings and read back by the
 * props and the surround hexes at their own positions, so a hex depth would
 * have to be converted to a radius at every one of those and the three answers
 * would have to agree. There is one number instead.
 */
export interface ShelfEdge {
  /** Middle of the sector, in radians, player-facing — `-π/2` is away. */
  bearing: number;
  /** How wide the sector is, in radians, total. */
  sweep: number;
  /** World distance from the board's centre the lip runs at, before wobble. */
  radius: number;
}

/**
 * The land the board stands *on*, and where it ends.
 *
 * **The review's fifth priority in one field, and it is geometry rather than
 * dressing**: "a cosmetic ledge needs bounded surrounding geometry and lower
 * scenery; adding fog over the current continuous ground plane cannot create a
 * drop". Everything the arena has drawn until now stands on one flat disc of
 * radius 170, so a mountain pass and a meadow are the same altitude and the
 * only thing separating them is what is scattered on top. That is the authored
 * reason mountain reads as the bottom of a bowl: the crags rise from the same
 * surface the fight is on, and nothing anywhere says the fight is above
 * anything.
 *
 * A kit with a shelf gives that disc a **boundary** inside its own sectors: the
 * ground stops at the lip, descends in terraces, and the country past it is a
 * second plane a full drop lower, with its own distant masses standing on it.
 *
 * **Opt-in per kit, and the seventeen without one are byte-identical** — the
 * rule every field in this file follows, and the reason the thirteen reference
 * contexts can be built one at a time.
 *
 * It is cosmetic by exactly the construction the scenery ring already uses:
 * `shelfHeight` is zero over every playable hex by arithmetic (the smallest
 * legal `radius` clears the board's own circumradius plus a hex), so nothing a
 * unit stands on, walks over or targets moves by a millimetre.
 */
export interface ShelfSpec {
  /** Where the land falls away. Bearings no edge covers keep the flat disc. */
  edges: ShelfEdge[];
  /** How far it falls, in world units, from the lip to the lower country. */
  drop: number;
  /**
   * How many terraces the descent is cut into.
   *
   * **Terraces rather than one face, because the reference is terraced.** A
   * single 5-unit wall at a 52° pitch is a slab with one lit surface, which
   * reads as the *side of a box* — the board on a plinth. `mountains.jpg`'s
   * foreground cliffs are stacked ledges, and so is every rock model this kit
   * already owns (`cliffSegment` is eight beds of unequal thickness); stepping
   * the ground the same way is what makes the drop the same material as the
   * things standing on it.
   */
  steps: number;
  /** How far out each terrace stands past the one above it, in world units. */
  tread: number;
  /** The riser's albedo — exposed rock, not the ground's own surface. */
  face: string;
  /** The country at the bottom. */
  lower: string;
  /**
   * The country at the bottom is open sea, not land: the archipelago's gun battery looks down from
   * its cliff on it. Drawn smooth in `lower`, without the arena's grain, and counted by the
   * camera-reach check as it counts a water region; the edge fill dresses only a share of it
   * (`EdgeFill.below.share`), its whitecaps and skerries.
   */
  sea?: boolean;
  /**
   * What stands down there.
   *
   * **Placed, never rolled**, the argument `FocalAnchor` already makes: the
   * whole point of a drop is that there is something *beyond* it, and a rate
   * over ground this far out delivers nothing in most seeds. They are spread
   * evenly by bearing across the edges' own sectors for `FocalAnchor`'s reason
   * — independent rolls clump, and a clump on one side of a gap is a gap with
   * nothing in it on the other.
   */
  below?: {
    keys: string[];
    /** How many, spread across the sectors. */
    count: number;
    /**
     * A continuous range further out, where the frame actually shows the country.
     *
     * The spread above stands its two rows on the terraces and just past the
     * foot, which toward the far end is under the lip from where the camera is —
     * so what the frame showed out there was a plane with nothing on it, which a
     * review read as open water. A crest is `count` masses evenly along one
     * sector at `distance` past the foot of the descent, near full size and close
     * enough together that neighbours overlap into one skyline: a ridge whose
     * crest is below the fight's feet, which is what says *we are higher*.
     */
    crest?: ShelfCrest;
  };
}

/** A line of masses along one sector of the lower country. See `ShelfSpec.below`. */
export interface ShelfCrest {
  /** The middle of the line, in the edges' own convention. */
  bearing: number;
  /** How wide, in radians, total. */
  sweep: number;
  /**
   * World units past the foot of the descent, measured from the sector's
   * authored radius rather than from the wandering lip. Keep the line inside a
   * sector's core: toward its ends the lip tapers out, and the ground there is
   * the fight's own.
   */
  distance: number;
  /** How many masses along it. */
  count: number;
}

/**
 * One sector of high ground round the board. See {@link HillSpec}.
 *
 * In the shelf's own convention: a bearing is player-facing, `-π/2` away from the
 * camera and `0` to the right, so a kit that rises behind and to the left says
 * `-π/2` and `π`.
 */
export interface HillRise {
  /** Middle of the sector, radians. */
  bearing: number;
  /** How wide, radians, total. The outer third of each side eases out to nothing. */
  sweep: number;
  /** World units the land climbs to by the top of its slope, before the knolls. */
  height: number;
  /** This sector's own `HillSpec.from`: a slope whose foot is nearer or further out. */
  from?: number;
  /** This sector's own `HillSpec.run`: shorter is steeper. */
  run?: number;
}

/**
 * Land climbing up behind a placed landmark, so the landmark is set *into* a hill.
 *
 * A waterfall standing in front of a slope that is lower than its own lip is a
 * pillar with water down it; a crag whose back the camera can pan round is a wall.
 * Both are a piece of rock that wants ground behind it at its own height, so this
 * raises a spur of the hill straight out behind every placed piece with this key —
 * away from the board, never toward it — and lets it run back into the hillside.
 */
export interface HillBack {
  /** Every enclosure piece with this key is backed: an anchor, a group piece, a wall segment. */
  key: string;
  /** How high the land stands behind it, world units — about the piece's own top. */
  height: number;
  /** How far back the spur holds that height before it eases into the slope, world units. */
  reach: number;
  /** How wide the spur is either side of the piece, world units. */
  width: number;
}

/**
 * The land round the board rising into hills: natural landform, not stacked rock.
 *
 * **The review's answer for the highlands and the mountain's flanks.** Both were
 * built out of wall segments and terrace blocks, and the 2026-10-21 review read
 * them as "stadium seats and Lego blocks": a mass is a model with a front and a
 * back, so a ring of them reads as a ring of objects however they are arranged,
 * and panning shows the back of one. Ground is the thing that has no back. So the
 * surround itself rises — a height field over the ground past the board, drawn as
 * one merged mesh of voxel block columns (`arenaHills`, `HillGround`), with the
 * kit's trees, bushes and rocks standing on the top of the column under them.
 *
 * - **Irregular in outline and in height.** The foot of the slope wanders, and the
 *   land is knolls and saddles over the climb (`relief`) rather than one ramp, so
 *   the high ground is several hills at several heights.
 * - **Blocky slopes, never tiers.** Cube blocks a quarter of a hex across, so a
 *   slope is many one-block steps whose contours wiggle, each step a grass cap
 *   with a lip of grass over dirt on its riser and stone below; steep ground is
 *   stone through. That is the blocky voxel hillside the designer asked for
 *   (2026-10-22). Two things were tried first: whole risers painted one colour,
 *   which read as green and brown stripes, and a faceted surface, which read as
 *   smooth low-poly ground under voxel props.
 * - **Cosmetic by construction**, the guarantee every other layer out here gives:
 *   nothing rises within `from` hexes of the board, nothing rises in front of its
 *   near rim, and no ground is higher than `headroom` lets anything stand there, so
 *   no playable hex, unit, path or line of sight moves or is hidden.
 * - **Flat where the composition stands**: water and every composed group or anchor
 *   keep their own level ground, and the hill rises from round them.
 *
 * Opt-in per kit; a kit without one keeps the flat disc it has always had.
 */
export interface HillSpec {
  /** Where the land rises, and how high. Bearings no rise covers stay flat. */
  rises: HillRise[];
  /** Hexes past the board where the slope's foot runs, before it wanders. */
  from: number;
  /** World units of slope from the foot to the top of the climb. */
  run: number;
  /** How much of the height is knolls and saddles rather than the even climb, 0 to 1. */
  relief: number;
  /** Landmarks the land climbs up behind. See {@link HillBack}. */
  backs?: HillBack[];
  /**
   * Keys of the placed pieces that keep level ground round them — a camp, a gate,
   * a fall's pool — so the hill rises from round them rather than under them.
   *
   * **By key rather than by which rule placed them**, so a baked arena, where
   * every piece is a placement, keeps exactly the same ground: the editor's bake
   * has to recompose to the picture it was baked from.
   */
  level?: string[];
  /** The grass the block tops are painted in; the ground's patch field picks between them. */
  turf: string[];
  /** The dirt under every grass cap, on the risers. */
  earth: string;
  /** Stone: under the dirt, and the whole of every steep column. */
  rock: string;
  /**
   * Snow on the highest tops: every column whose top stands above `above` (world
   * units, give or take a wandering snowline) is capped white over stone.
   */
  snow?: { above: number; color: string };
  /** The high ground is a cave's rock rather than land. See {@link CaveSpec}. */
  cave?: CaveSpec;
  /** The slope cut into level treads with dry-stone risers. See {@link TerraceSpec}. */
  terrace?: TerraceSpec;
}

/**
 * The hills cut into terraces: Jadeveil's worked slopes (the private project notes,
 * *Landforms*).
 *
 * **The same field quantised coarser, which is what a terrace is.** The land's height is floored
 * to whole treads of `step` rather than to single blocks, so the slope becomes level shelves whose
 * edges follow the field's own wandering contours round the hill, each tread standing on a riser
 * of laid dry stone under a lip of turf. Nothing else about the hills changes — where they rise,
 * how high, what keeps level ground, what they may not hide — so a terraced kit is as cosmetic as
 * any other and its props stand on the tread under them.
 *
 * - **Dry stone, not earth.** Every riser is laid stone below its turf lip, block by block in the
 *   `stone` tones with a share of dark `joint` blocks, rather than the hillside's grass, dirt and
 *   rock bands: a terrace is built.
 * - **Paddies on the lowest tread** where `paddy` is given: a coherent field floods part of the
 *   first tread, each flooded block ringed by a bund of the earth where it meets dry ground.
 * - **Rows along the tread edges** where `rows` is given: tea, placed on the outer edge of each
 *   tread and turned along its contour, as a tended slope is planted.
 */
export interface TerraceSpec {
  /** World units each tread stands above the one below it; a whole number of blocks. */
  step: number;
  /** The risers' laid stone, one tone per block. */
  stone: string[];
  /** The dark joints between the stones; a share of riser blocks. */
  joint: string;
  /** The flooded paddies' water on the lowest tread, when it has them. */
  paddy?: string;
  /** What is planted along the tread edges, and how thickly. */
  rows?: {
    keys: string[];
    /** World units between one row and the next along an edge, about. */
    every: number;
    /** Share of the candidate spots that take a row, 0 to 1. */
    share: number;
    /** World units from the board's centre the rows run out to. */
    reach: number;
  };
}

/**
 * The hills turned inside out: a cave's rock rising all round the floor.
 *
 * **The enclosed arenas' answer to "walls thick enough that zooming out never shows
 * their other side"** (review, 2026-10-21). A wall is a model with a back, and a ring
 * of them is seen over from the opposite rim; rock that keeps climbing outward has no
 * back to see — its top leaves the frame before the camera could look over it. So the
 * lairs and the castle hall stand inside the same block-column field the highlands
 * stand among, steep and tall, painted as rock rather than as turf.
 *
 * - **Down both flanks.** The land elsewhere eases out before the board's near rim;
 *   a cave's walls run on toward the camera wherever they hide no board, so the floor
 *   is enclosed to the frame's lower corners. In front of the board nothing rises.
 * - **Rock, block by block.** Every column at least `wall` tall is painted from
 *   `stone` per block — a coherent field picks the tone and a hash breaks it, so a
 *   face reads as stone with seams and inclusions rather than as courses — with a
 *   share of `veins` (root, ore, ice) through it.
 * - **Nothing stands on it.** A prop whose ground is the wall would be inside the
 *   rock, so it is not placed; and the camera-reach check counts the rock as dressed,
 *   the way it counts a shelf's descent.
 */
export interface CaveSpec {
  /** World units above the floor at which a column is the cave's wall. */
  wall: number;
  /**
   * World units the rock is cut off at, flat. Above the highest a phone's camera
   * stands (about nine units at the whole-board fit), so no phone frame reaches the
   * cut — and a flat top is one quad where a field of block tops is thousands.
   */
  ceiling: number;
  /** The rock's block colours; a coherent field picks between them per block. */
  stone: string[];
  /** Rare blocks through the rock: roots, ore, ice. `share` of blocks, 0 to 1. */
  veins?: { colors: string[]; share: number };
}

/**
 * How big a wall segment may be.
 *
 * Its own spec rather than a fourth tier, because a wall is a **role** and not a
 * step in the size cascade: the composer never falls back to it, and adding it to
 * `SceneryTier` would oblige every kit to declare a `wall` list it does not have.
 * Taller than `canopy` on purpose — a wall only does its job if the ground behind
 * it is out of sight, and at the arena's 52° a wall hides `height / tan(52°)` of
 * floor behind it, so six units buys about three hexes.
 */
export const WALL_SIZE: TierSpec = { maxHeight: 6.2, spread: 1.35 };

/**
 * A bounded area of water, as an area rather than as an object.
 *
 * **This is the one thing a prop could not be.** `arena_pond_0` is a canopy-tier
 * focal wide enough to overhang its own hex, which is as close to a region as
 * one prop per hex can come — and the refinement review's four water gaps (the
 * meadow's banks, both bogs' open water, the highland watercourse) are all the
 * same complaint downstream of it: what is missing is a *boundary*, and an
 * object's boundary is its own outline rather than the shape of the ground.
 *
 * So a region is a set of ring hexes drawn as one surface, with the kit's bank
 * pieces standing on the hexes that touch it. Cosmetic by construction like
 * everything else out here: every hex in it fails `inArena`, so a waterline can
 * never imply a movement or a height rule, which is the thing Section 3A is
 * explicit about.
 */
export interface WaterRegion {
  /**
   * How the area is shaped, and the two are genuinely different pictures.
   *
   * - **`pools`** — blobs from the patch field, which is what standing water is:
   *   the meadow's ponds at the edges of the clearing, a bog's open channels
   *   between the trunks. Several of them, because "ponds" is a plural and a
   *   noise field hands back one component per blob for free.
   * - **`course`** — a band at a fixed depth running round from a bearing. A
   *   watercourse has a direction and a source, and neither is noise. It is what
   *   connects the highland fall's plunge pool to the rim of the frame.
   */
  shape: 'pools' | 'course';
  /** The surface's own colour, before the scroll sheet multiplies over it. */
  color: string;
  /**
   * What stands along the waterline, at the thicket's size.
   *
   * Placed on the *dry* hexes that touch the water and pushed out to the hex's
   * own rim rather than its centre, so a bank piece sits at the edge and a tree
   * rolled onto the same hex still stands on the bank behind it. That is also
   * what hides the region's hexagonal outline, which is the one thing a surface
   * made of prisms cannot do for itself.
   */
  bank?: string[];
  /** Nearest hexes past the board the water may reach, and the furthest. */
  near: number;
  far: number;
  /**
   * Whether the canopy tier may stand *in* the water.
   *
   * **A bog's trees grow out of it and a pond's stand beside it**, and the
   * difference is the whole identity of the wetland: its reference is buttressed
   * trunks rising out of standing water, not a wood with pools cut into it. With
   * the region claiming every hex it covers, the wetland lost a third of its
   * canopy to its own water and read as a lake with a treeline round the outside
   * — the enclosure the kit asks for at 0.8, deleted by a layer underneath it.
   *
   * Only the canopy, ever. The thicket and the ground tier are knee-high and
   * below, so a bush or a tuft of fern in open water is a thing floating on it;
   * and the cover pass is the layer that dresses a *floor*, which is the one
   * thing a pool does not have.
   */
  treed?: boolean;
  /**
   * `pools`: how much of the band between `near` and `far` is water, 0 to 1.
   *
   * **A share rather than a threshold on the field, and the difference is
   * variance.** A threshold is the obvious spelling and it hands the *seed*
   * control of how much water there is: the region sits in a ring about three
   * and a half noise cells across, so a handful of lattice values decide the
   * answer, and one threshold produced a meadow at 4% of its band on one fight
   * and 55% on another — a field with a puddle, and a flood plain, from the same
   * authored number. How much water a piece of country has is a property of the
   * country; *where* it is is a property of the fight. So the field still picks
   * the hexes, in the order it ranks them, and this says how many to take.
   */
  coverage?: number;
  /** `course`: the bearing its head sits on, and how far round it runs. */
  bearing?: number;
  sweep?: number;
  /**
   * `course`: the focal anchor the water flows *out of*, by prop key.
   *
   * The one hex a region is allowed to share with something standing on it, and
   * it is the difference between a stream and a stream that starts near a
   * waterfall. The fall claims its hex before the region is laid, so without
   * this the course begins on the next hex round the arc — structurally adjacent
   * and, rendered, half a hex of dry rock with a bank boulder sitting on it
   * between the plunge pool and the water. A fall stands *in* its own pool.
   *
   * Only ever a focal: anchors are placed by bearing at a stated depth, so a
   * kit naming one knows exactly where it put it. A tier prop's hex is a roll.
   */
  source?: string;
}

/**
 * The smallest number of hexes that is a body of water rather than a puddle.
 *
 * A one-hex component is the saucer the pond prop already was, one layer up:
 * three hexes is the first size that has an inside and an outline, and the
 * noise field hands back singletons at the margin of every blob it draws.
 */
export const MIN_WATER_HEXES = 3;

/**
 * A light a kit states outright, rather than one a flame-bearing prop carries.
 *
 * **Bounded, and that is the whole of why the field is shaped this way.** The
 * composition already lights itself from its fixtures — a lantern, a brazier, a
 * wall torch, a cold lamp — and those are bounded by construction: a light
 * exists exactly where something on screen is visibly burning. An authored
 * light has no such anchor, so the field it would most naturally be is a free
 * `PointLight`, and a free point light is how a ring ends up evenly lit.
 *
 * So it is four numbers with a ceiling on two of them (`LIGHT_BUDGET`), it
 * competes for the same budget the fixtures do, and it is JSON — a layout can
 * hold one, a validator can refuse a bad one, and an editor can say what is
 * wrong with it. What it deliberately cannot say is *shadow*: the key light is
 * the only caster in the game and a second shadow from a local light reads as a
 * rendering fault, which is the same reason the rig's own fill never casts.
 */
export interface AuthoredLight {
  /** Where it stands, in world units about the board's centre. */
  at: [number, number, number];
  color: string;
  /** Capped at the brightest fixture times `LIGHT_BUDGET.intensityFactor`. */
  intensity: number;
  /** Where it falls to nothing. Capped at `LIGHT_BUDGET.reach`. */
  distance: number;
}

/**
 * Distance haze: the sky lying on the land.
 *
 * **On the kit rather than inside `shelf`, which is where it started and is not
 * what it is.** A drop was the first thing that needed one, so it was authored
 * beside the drop — and the layout format has hoisted it to the top level since
 * the day it existed, with `ShelfSpec.haze`'s own comment saying why. A room, a
 * cavern and a meadow can all want air in front of the horizon without any of
 * them having a cliff, and until this moved they could not have it: the one
 * place the runtime read haze from was a landform twelve of the eighteen kits
 * do not have.
 *
 * Nothing was lost in the move. Exactly one kit in the game authors a shelf and
 * exactly one authors haze, and they are the same kit — `PASS_SHELF` carried a
 * second haze that `MOUNTAIN_PASS` overrode on every read, so one of the two
 * values had never reached a screen.
 */
export interface HazeSpec {
  color: string;
  /** Plane distances at zoom 1; `ZoomFog` scales both with the dolly. */
  near: number;
  far: number;
}

/**
 * How the rolled tiers behave on *this* ground: how often, how big, how turned.
 *
 * **Every number here already existed as a constant in `arenaScenery`**, and
 * that is deliberately the whole of what this adds — a per-kit override of a
 * global default, which is the arrangement {@link SceneryKit.cover} and
 * {@link SceneryKit.enclosure} already use for the two levers a kit had. What
 * the tiers could not say was the other three: how thick the understorey is on
 * this surface, what range of sizes a stand covers, and whether loose pieces
 * lie square with the thing they belong to.
 *
 * **Absent means the composer's own answer, and no shipped kit declares one.**
 * That is the guard rather than a coincidence: the constants were each argued
 * for at length where they are defined — a wood of identical trees is an
 * orchard, a bush is the cheapest thing in the kit to raise, a prop addressing
 * a landmark three hexes away is pointing at nothing — so the default is the
 * decision and this is the exception, and `arenaScenery.test.ts` pins that the
 * roster composes prop for prop with the field in place.
 *
 * Nothing here is a *place*: a rate, a size range and a facing are quantities
 * that hold everywhere in the ring. Where the rolled scenery stands *back* is
 * {@link QuietSector}, which is a place and is authored as one.
 */
export interface DressingSpec {
  /**
   * How often a hex the enclosure does not claim gets something of this tier.
   *
   * Per tier and partial, because the three answer different questions — the
   * canopy's rate is the wood's density, the thicket's is whether the band
   * between the trunks and the floor is a layer or a scatter, and the ground's
   * is the floor itself. A kit that wants a thicker understorey and the same
   * trees says exactly that.
   *
   * It does **not** reach the structural canopy band, which is unconditional by
   * construction so a seed can never delete the enclosure — thinning the wood
   * is `enclosure`'s job, and a second lever on the same band would be two
   * numbers that have to be read together to know what either means.
   */
  rate?: Partial<Record<SceneryTier, number>>;
  /**
   * The bounds of the per-prop size jitter, multiplied by the coherent band.
   *
   * A *range* rather than a scale, because the two ends are the decision: a
   * narrow one is an orchard and a wide one runs the largest pieces into the
   * envelope, which refuses them and quietly thins the ring instead.
   */
  scale?: { min: number; max: number };
  /**
   * When a rolled piece stops being turned by the hash and addresses what it
   * belongs to, and how far off dead-on it may then sit.
   *
   * `pull` is a threshold on the feature field, so raising it means only the
   * pieces standing on a landmark lie square with it; `jitter` is what stops
   * the square ones reading as a parade. A kit of round things — boulders,
   * tufts, drifts — gains nothing from either and can turn the whole rule off
   * by asking for a pull above 1.
   */
  turn?: { pull?: number; jitter?: number };
}

export interface SceneryKit extends Record<SceneryTier, string[]> {
  /** Extra depth used for the initial fit of tall authored landmarks. */
  framingDepth?: number;
  /**
   * Low clustered growth beneath the larger tiers, independent of their
   * occupancy — and the only layer that reaches the strip in front of the board.
   *
   * **Optional, and two kits decline it on purpose.** The envelope caps
   * everything in front of the board's near rim at `FRONT_MAX_HEIGHT`, so
   * ground cover is the one thing that can dress the frame's near third at all;
   * and that third is measurably bare, running from nothing on a desktop to a
   * fifth of the reference portrait frame. Every outdoor kit therefore has one,
   * and so do the two *rough* interiors — a dug burrow and a cavern have loose
   * floor underfoot.
   *
   * **It is vegetation, and the six kits without one are the six with no soil.**
   * That was found by rendering rather than reasoned: the first pass gave the
   * canyon sand and grit, the pass snow and scree, the burrow and the hollow
   * dust and rubble — and every one of them came out as *litter*. A tuft on
   * grass is grass; a pale pebble on sand, a white drift on rock or a chip of
   * stone on a cave floor is a small bright object lying on a hard surface,
   * which is the confetti the refinement review already rejected once in the
   * bones and the fungus. The mountain pass was the clearest: a foreground of
   * scattered snow read as torn paper.
   *
   * So a hard floor's foreground is answered by the *floor* — the ground plane's
   * own detail sheet, sampled in world space and now carried right out to the
   * frame's edge — and not by scattering objects across it. That covers the
   * canyon, both passes, the burrow, the hollow, the glacier and the castle hall
   * alike, and the hall's reference says the same thing in words: "a room, not a
   * rubble-strewn outdoor disc".
   *
   * **And a cover piece may not out-contrast the ground it lies on**, which is
   * the same fault one axis over and is why the four blighted kits have none
   * either. They were given three parts pale dead grass to one of ash and came
   * out as scattered paper over the darkest floors in the game; ash-led was
   * better and still speckled, because `ash` itself carries a bone-pale chip and
   * **one pale piece dominates a dark ground at any weight**. Every ankle-high
   * piece the blighted set owns — dead grass, bones, fungus, ash — has one.
   *
   * The roster has carried the mirror of this rule since the detailing pass: a
   * piece within ~10% of the surface behind it is *absent*. This is its other
   * end — a piece far enough from the ground under it stops being cover and
   * becomes debris on a floor. Giving the blighted kits a genuinely dark low
   * piece is model work and belongs with the rest of the blighted authoring.
   */
  groundCover?: string[];
  /**
   * How much of the ground the cover claims, and how thickly, per kit.
   *
   * **Because a meadow and a forest floor want opposite things.** R1 clumped the
   * cover deliberately — an even sprinkle of small objects over flat ground is
   * confetti, and what makes the reference forest's floor read as a mass is the
   * *gaps* between masses. That argument is right for a wood and wrong for open
   * country: the review's word for the meadow is "lush continuous", and a field
   * of grass with clear ground between the clumps is a field that has been mown
   * in patches.
   *
   * So the clumping is a default rather than a law. `threshold` is the patch
   * value the cover appears above — lower is more ground covered — and `near` is
   * how many pieces go on a hex inside three of the board.
   */
  cover?: { threshold?: number; near?: number };
  /**
   * What stands in the horizon band, past the authored ring.
   *
   * Undefined means the `canopy` list, which is the right answer for a wood or
   * a meadow: what lies beyond a treeline is more trees, thinning out.
   *
   * It is emphatically **not** the right answer for a kit with a `wall`, and the
   * first renders said so without ambiguity. The castle's band scattered loose
   * pillars across the dark plane *above its own hall wall* — a colonnade
   * standing in a void, which is the single most broken thing the arena has
   * drawn — and the canyon put cacti and a watchtower on the plateau over its
   * rim. A wall is the enclosure. What is past it is either a larger landform
   * (the canyon's own cliffs again, read as distant mesas) or, for an interior,
   * **nothing**: past the hall's wall there is no hall.
   *
   * `null` is that nothing, stated rather than left to an empty array, so a kit
   * that simply has not been art-directed yet is distinguishable from one where
   * emptiness is the decision.
   */
  horizon?: string[] | null;
  /**
   * A bounded area of water, claimed before the tiers.
   *
   * Optional, and most kits decline it: water is a feature of particular ground
   * rather than a layer every surface has. The four that take one are the two
   * the review names (the meadow's edges, the wetland) and the two the highland
   * fall asks for, since a fall with nothing under it is a tap.
   */
  water?: WaterRegion;
  /**
   * Pieces placed by hand, in world units, before every rule in the kit.
   *
   * First because it is the most explicit statement a composition can make: a
   * wall segment rolled onto the hex somebody dropped a crag on should lose the
   * argument, not win it. See {@link ScenicPlacement}.
   */
  placements?: ScenicPlacement[];
  /** Guaranteed pieces, placed before the tiers and claiming their hex. */
  focal?: FocalAnchor[];
  /** Compositions, placed before the anchors and claiming the ground they cover. */
  groups?: FocalGroup[];
  /** A rhythm of pillars one course inside the wall. */
  colonnade?: Colonnade;
  /** A continuous enclosure, or separated masses, placed before everything else. */
  wall?: WallRing;
  /** Directions the rolled tiers and the ground cover stand back from. */
  quiet?: QuietSector[];
  /** The land the board stands on, where it ends, and what is below it. */
  shelf?: ShelfSpec;
  /** The ground past the board rising into hills. See {@link HillSpec}. */
  hills?: HillSpec;
  /**
   * How solid the structural canopy band is, 0 to 1. Defaults to 1.
   *
   * **A meadow is the opposite problem to a wood.** The structural band exists
   * so a seed can never delete the forest wall, and at 1 it *is* a wall — which
   * is right for a clearing in a wood and wrong for open country, where what has
   * to be built is a distance rather than an enclosure. Thinning it is how a
   * kit says "the horizon is part of the picture"; the band is still structural,
   * so what varies from fight to fight is where the trees are and not whether
   * there are any.
   */
  enclosure?: number;
  /**
   * Whether this kit's canopy is planting rather than enclosure.
   *
   * **The canopy is exempt from the feature field, and the reason is that the
   * canopy is what a scene's enclosure is made of** — biasing it toward the
   * landmarks would thin the flanks and put the wood back against the wall. It
   * is also unconditional in the structural band, so a seed can never delete
   * that wall. Both clauses are about an enclosure, and the desert canopies are
   * not one: both variants use `wall` for their sandstone masses, while their
   * canopy lists are vegetation and ruins standing in open sand at a rate,
   * which is exactly the "individual props receive similar spacing and
   * attention" the bias exists to end.
   *
   * So this is the kit saying *my canopy is not my enclosure*, and it has both
   * consequences rather than one: the tier reads the feature field like the
   * middle and low tiers, and it loses the structural band's exemption. A flag
   * that gathered the far cacti while still planting the near ring
   * unconditionally would be the rule applied to the half it is cheapest on.
   *
   * Absent everywhere else, and `arenaScenery.test.ts` keeps the canopy's role
   * as the control the gather statistic is measured against by excluding the
   * kits that opt in — a control that includes a population which deliberately
   * moves is not a control.
   */
  canopyGathers?: boolean;
  /**
   * How the rolled tiers behave here: how often, how big, how turned.
   *
   * Absent is the composer's own answer for all three, and every kit in the
   * game leaves it absent — see {@link DressingSpec}.
   */
  dressing?: DressingSpec;
  /**
   * Point lights this ground states outright, over and above what its fixtures
   * carry. See {@link AuthoredLight}; they share the fixtures' budget.
   */
  lights?: AuthoredLight[];
  /** Air in front of the horizon. See {@link HazeSpec}. */
  haze?: HazeSpec;
  /** The ground past the ring the camera reaches. See {@link EdgeFill}. */
  fill?: EdgeFill;
  /** Ground left open on purpose, and what lies on it. See {@link OpenGround}. */
  openGround?: OpenGround;
}

/**
 * Which of the kit's rules put a prop where it is, as a vocabulary.
 *
 * **One name per placing rule above, and the composer is the only thing that
 * knows which one ran.** A finished prop is a key, a hex and a matrix, so a
 * crag placed by hand, one rolled out of the canopy list and one standing on a
 * boundary arc are indistinguishable by the time anything else sees them —
 * which is fine for the scene, whose job is to draw them, and is the whole
 * question for an editor, whose job is to say what a designer is looking at.
 *
 * **It lives here rather than with the composer because two readers need it and
 * only one of them may import a system.** `arenaScenery` tags every prop it
 * emits and re-exports the type, so nothing had to learn it moved; the layout
 * format records it on a *baked* placement, and that module imports display
 * data and `models/` and nothing else. A second spelling of the ten names would
 * be a copy nothing compares — the fault the private project notes names wherever a rule is
 * written twice — and it would go quiet in the worst direction: an unknown
 * origin in a file, refused by a validator that had not been told about a rule
 * the composer has run for months.
 *
 * A list rather than a bare union because the format validates one by value:
 * `oneOf(PROP_SOURCES)` is the union asked at runtime, and the two cannot come
 * apart when the second is derived from the first.
 */
export const PROP_SOURCES = [
  /** A {@link ScenicPlacement} — the one input to the composer a person types. */
  'placement',
  /** A piece of a {@link FocalGroup} composition. */
  'group',
  /** A {@link FocalAnchor}, spread by bearing or pinned. */
  'anchor',
  /** A shaft of the {@link Colonnade}, one course inside the wall. */
  'colonnade',
  /** A segment of the {@link WallRing}, or of one of its arcs. */
  'boundary',
  /** A {@link WaterRegion}'s bank piece, turned to face the water. */
  'bank',
  /** Rolled out of a kit's own tier lists, or of the fallback prop family. */
  'scatter',
  /** A clump of ground cover, offset inside its hex. */
  'cover',
  /** The canopy slot past the authored ring, which is distance rather than wood. */
  'horizon',
  /** A `ShelfSpec.below` mass, standing on the lower country. */
  'shelf',
  /** A piece of the {@link EdgeFill}: the ground past the ring the camera still reaches. */
  'fill',
  /** A flat dune laid on {@link OpenGround}: the treatment of sand left open on purpose. */
  'open',
  /** A row planted along a terrace's tread edge (`TerraceSpec.rows`). */
  'row',
] as const;

export type PropSource = typeof PROP_SOURCES[number];

// --- Shared compositions ---------------------------------------------------
//
// **R4 built the group primitive for one hall; these are the propagation.** The
// review asks four of the remaining targets for the same thing in different
// furniture — the desert's "larger, composed groups" and "dense ruined-camp
// hierarchy", the pass's "legible built pass: arches, stairs, timber platforms",
// the highlands' "cliffs are isolated stacks rather than terraces" — and every
// one of those is a set of fixed distances rather than a rate or a better prop.
//
// Two things the hall learned that these are authored against. A group stands on
// its own **axis**, so `across` is symmetric about something real; and how far
// forward a piece may reach is `planClearance`'s answer on the *worse* flank,
// because the board is not symmetric in world x. That is why every one of these
// sits at depth 3 and reaches no further than 1.5 units toward the board.

/**
 * A camp: a tent with its fire, its stores and a windbreak round it.
 *
 * Off the far axis on purpose — a camp is somewhere people put their things, not
 * the head of a room, so pinning it where a throne goes would make the desert
 * read as a hall with sand in it. The tent came out of the anchor list to be the
 * origin: it is the thing the rest is arranged around.
 *
 * **Then it had to actually touch itself.** The first version was the right
 * seven objects at the wrong distances — stores two units off the tent's flank
 * and one fence panel at each extreme of a seven-unit span, which is not a
 * windbreak but two posts, and at this framing reads as a tent with loose
 * objects near it rather than as a camp. A composition is *a set of fixed
 * distances between its own pieces*, and the distance that makes several props
 * one thing is close to nothing: every piece here stands within a third of a
 * unit of a neighbour's footprint, so single-linkage over the group returns one
 * mass rather than five.
 *
 * The windbreak is the clearest case. `arena_fence_0` is 1.26 wide, so three
 * panels 1.2 apart overlap a hair and run continuously — the gate landing's own
 * rule, one scale down — and a fourth turned a quarter returns the screen down
 * the flank the stores are stacked against. A `turn` of `Math.PI / 2` runs a
 * piece along the group's *outward* axis instead of across it, which is the
 * whole difference between a return and a second parallel fence.
 */
const CAMP: FocalGroup = {
  // **-2.2 rather than -2.3, and the stores sit on the board-ward flank.** A
  // supporting group's bearing is measured against the *frame*, not against the
  // ring — the pass's camp learned it at -2.95 — and this one had drifted into
  // the same fault by a smaller margin: projected at the reference fits the
  // composition ran from screen x 29 to 102 of 720, and on a 390-wide phone its
  // outer corner landed at **0**, so the windbreak was cut off by the edge of
  // the picture. Both levers are worth one step: the bearing brings the whole
  // group in, and putting its bulk on the flank nearer the board leans it into
  // shot rather than out of it. 61..140 of 720 and 14..52 of 390 now, with all
  // nine pieces placed. Since the walls came down it stands in a clearing of open
  // sand (`OpenGround.clearing`) rather than against the left-hand shoulder.
  bearing: -2.2,
  depth: 3,
  pieces: [
    { key: 'arena_tent_0', tier: 'canopy', across: 0, along: 0 },
    // The windbreak: a continuous run behind the tent, with one return panel
    // closing the flank the stores lean against.
    { key: 'arena_fence_0', tier: 'thicket', across: -1.2, along: 0.95 },
    { key: 'arena_fence_0', tier: 'thicket', across: 0, along: 0.95 },
    { key: 'arena_fence_0', tier: 'thicket', across: 1.2, along: 0.95 },
    { key: 'arena_fence_0', tier: 'thicket', across: 1.83, along: 0.3, turn: Math.PI / 2 },
    // Stacked against the tent's flank, inside the return.
    { key: 'arena_stores_0', tier: 'thicket', across: 1.16, along: -0.05 },
    { key: 'arena_stores_0', tier: 'thicket', across: 1.16, along: 0.55 },
    // The rack stood on end against the other flank, so the camp is not
    // symmetric about its own tent.
    { key: 'arena_rack_0', tier: 'thicket', across: -0.9, along: 0.2, turn: Math.PI / 2 },
    // And the fire in front of the doorway, where the camp meets the fight.
    { key: 'arena_brazier_0', tier: 'canopy', across: -0.3, along: -1.25 },
  ],
};


/**
 * The haunted desert's gate: the ruined arch on its own threshold, with the dead
 * where they fell and a fire gone down to embers at the foot of the flight.
 *
 * **The arch is all that is left standing, by the review's word.** "Remove the
 * walls; the gate can stay": the masonry stubs that continued its wall line, the
 * fallen blocks and the graves against them went with the sandstone shoulders, and
 * the camp went with them — the desert is cactus, bone and rock, and this. The
 * flight still meets the footing, because a threshold is what turns an arch into a
 * gateway rather than a frame standing in sand; the bones lie at the threshold and
 * the embers between them, the arena's one light, dim on purpose.
 *
 * `steps()` climbs along its own +Z and a group piece's +Z points at the board, so
 * the flight placed in front of the arch climbs *toward* it.
 */
const BLIGHTED_GATE: FocalGroup = {
  bearing: -0.9,
  depth: 3,
  pieces: [
    { key: 'arena_arch_1', tier: 'canopy', across: 0, along: 0 },
    { key: 'arena_steps_1', tier: 'thicket', across: -0.6, along: -0.9 },
    { key: 'arena_steps_1', tier: 'thicket', across: 0.6, along: -0.9 },
    { key: 'arena_dusk_bones_0', tier: 'ground', across: 0.9, along: -1.35 },
    { key: 'arena_dusk_ribs_0', tier: 'ground', across: -1.0, along: -1.45, turn: -0.3 },
    { key: 'arena_embers_0', tier: 'thicket', across: 0, along: -1.6 },
  ],
};

/**
 * How high a gate's landing stands, in world units.
 *
 * **One number, three models and a composition**, and it has to be one: the
 * flight climbs to it, the landing block's own top *is* it, and the arch and
 * the two decks are lifted onto it by exactly this much below. Four copies is
 * four ways for a stair to end short of its own landing, which is the fault the
 * whole item exists to end, one scale smaller. `voxel/models/scenery.ts` reads
 * it from here for the reason `props.ts` reads `TERRAIN_VARIANTS` from
 * `terrainDisplay` — the composition is where the agreement is visible.
 *
 * Measured against the thicket tier rather than picked. The landing block and
 * the flight are both filed there, because both have to come close enough to
 * the board for the route to start on the floor the fight is on, and the tier
 * allows 1.4 — so this is what is left once the block's capping course has its
 * share. It is also a little over half a hero's crown, which is the reading
 * that matters: the gate stands *above* the fight without standing on a cliff.
 */
export const GATE_RISE = 0.9;

/**
 * The landing itself, as the blocks it is assembled from.
 *
 * A function rather than a written-out list of fourteen near-identical pieces,
 * because what is being authored is a *rectangle* — nine blocks across and two
 * courses deep — and eighteen literals is eighteen chances to leave a hole in
 * the middle of a terrace that the arch is standing on. The spacing is the
 * block's own width less a hair, so the run is continuous: a gap between two
 * blocks of a floor is a crack the fog shows through.
 *
 * **Nine rather than seven, and the width is derived rather than liked.** The
 * terrace has to carry the arch, a fire either side of it and a deck on each
 * end without any of them standing over its edge, and at seven blocks those do
 * not fit: the deck's own reach at its `scale` plus the fire's leaves the pair
 * overlapping by about half a unit on each flank. It is the landing that grows,
 * because bringing the decks inward is what makes them crowd the gate they are
 * there to flank.
 */
function gateLanding(): GroupPiece[] {
  const out: GroupPiece[] = [];
  for (const along of [0, 1.2]) {
    for (let i = -4; i <= 4; i++) {
      out.push({ key: 'arena_landing_0', tier: 'thicket', across: i * 1.2, along });
    }
  }
  return out;
}

/**
 * The pass's gate: a landing carrying an arch, the flight up to it, and a deck
 * built onto each end of it.
 *
 * **Set into the rock on the left flank, and it used to be pinned at the far
 * end.** A route wants to be read at the end of it and that argument still
 * holds — what overrode it is that the camera never turns, so the far end is
 * the *only* direction the frame has any distance in, and the whole point of
 * this arena is that the ground stops there. A gate standing on the far axis is
 * a gate standing exactly where the view out has to be. It keeps its own
 * bearing inside `PASS_MASSES`'s rock, at `-2.25`, which is the top-left of the
 * frame: a way *through the mountain* rather than a way off the end of it, which
 * is the truer thing for a gate on a shelf to be anyway.
 *
 * Everything the review names by word is here — arch, stairs, timber platforms —
 * and the snow cap on the arch is the fourth.
 *
 * **What the first version had was the parts and not the construction**, and
 * every one of the gaps is the same missing sentence. A group had only plan
 * offsets, so the arch stood on the floor, the four step pieces made one wide
 * tread 1.4 units in front of it that climbed 0.45 and then stopped at nothing,
 * and the two decks stood on their own posts out on the open floor with the
 * ground running under them. Rendered, that is an arch, a low kerb and two
 * tables. `GroupPiece.lift` is the sentence: the flight arrives *at* the
 * landing, the landing carries the gate, and the decks are built onto its ends.
 *
 * Read outward from the middle. The landing is two courses of blocks deep and
 * nine wide, so the arch's footing, both fires and both decks stand on stone
 * rather than over its edge; the flight is two pieces, a little wider than the
 * opening it climbs to, because a stair narrower than its gate reads as a path
 * worn to it; the decks sit on the terrace's own ends and are turned to address
 * the arch, since a deck square to the frame at this size is a table; and the
 * fires are up on the landing beside the gate rather than at the foot of the
 * steps, which is where the reference puts them and what keeps the floor the
 * fight opens on clear.
 */
const PASS_GATE: FocalGroup = {
  bearing: -2.25,
  depth: 1,
  pieces: [
    ...gateLanding(),
    { key: 'arena_gateway_0', tier: 'canopy', across: 0, along: 0.5, lift: GATE_RISE },
    { key: 'arena_stair_0', tier: 'thicket', across: -0.62, along: -1.15 },
    { key: 'arena_stair_0', tier: 'thicket', across: 0.62, along: -1.15 },
    { key: 'arena_platform_1', tier: 'canopy', across: 3.7, along: 0.75, lift: GATE_RISE, scale: 0.8, turn: -0.3 },
    { key: 'arena_brazier_0', tier: 'canopy', across: -1.85, along: -0.1, lift: GATE_RISE },
    { key: 'arena_brazier_0', tier: 'canopy', across: 1.85, along: -0.1, lift: GATE_RISE },
  ],
};

/**
 * The garrison, in one place.
 *
 * **Consolidation is the other half of "the gate is the primary landmark", and
 * it is a subtraction before it is an addition.** The kit used to spread its
 * occupation over the whole ring: two watchtowers and a tent as focal anchors,
 * evenly by bearing, plus stores and fencing in the rolled thicket list. At the
 * pass's own framing a watchtower is a waist-high timber frame with a canvas
 * top, so two of them at two bearings read as two tables — the same weight as
 * the gate, in three places, which is a hierarchy with nothing at the top of
 * it. A fence rolled per hex is worse: it is a *boundary* model, so what it
 * says at a rate is that somebody fenced three unconnected hexes.
 *
 * So there is one camp, and everything that belongs to a garrison is in it: the
 * tent it sleeps in, the tower it watches from, the stores and the rack, and
 * the fence as an actual run of two rather than as fragments.
 *
 * **The bearing is measured against the frame rather than against the ring.** An
 * early draft put the camp at `-2.95`, nearly due left, and a portrait frame has
 * almost no width out there: rendered, the whole composition stood off the left
 * edge and the consolidation read as the furniture having simply been deleted.
 *
 * Both this and the gate live in `PASS_MASSES`'s rock now, because the far end
 * belongs to the drop — the camp below the gate on the same flank, `2.70`
 * against the gate's `-2.79`, which is about 67 degrees apart and clears both
 * their spans at these depths.
 */
const PASS_CAMP: FocalGroup = {
  bearing: 2.85,
  depth: 2,
  pieces: [
    { key: 'arena_watchtower_0', tier: 'canopy', across: 1.6, along: 0.7 },
    { key: 'arena_tent_0', tier: 'canopy', across: -1.0, along: 0.3 },
    { key: 'arena_brazier_0', tier: 'canopy', across: 0.5, along: -0.9 },
    { key: 'arena_stores_0', tier: 'thicket', across: -2.3, along: -0.5 },
    { key: 'arena_stores_0', tier: 'thicket', across: 2.9, along: -0.4 },
    { key: 'arena_rack_0', tier: 'thicket', across: 3.2, along: 0.7 },
    { key: 'arena_fence_0', tier: 'thicket', across: -3.0, along: 0.4, turn: 0.3 },
    { key: 'arena_fence_0', tier: 'thicket', across: 4.1, along: -0.3, turn: -0.28 },
  ],
};

/** The abandoned route: a surviving left terrace and deck, with the right landing fallen. */
const ABANDONED_GATE: FocalGroup = {
  // Just left of the far axis, so the wide ruin stays in portrait framing
  // while the right-hand opening still shows the drop. The pieces share one
  // raised threshold.
  bearing: -1.9,
  depth: 2,
  pieces: [
    // Two connected courses carry the arch and the sole surviving deck. The
    // right end is absent, so the rubble below has a visible source.
    ...[0, 1.2].flatMap((along) => [-3, -2, -1, 0, 1].map((i) => ({
      key: 'arena_landing_0', tier: 'thicket' as const, across: i * 1.2, along,
    }))),
    { key: 'arena_arch_0', tier: 'canopy', across: 0, along: 0.5, lift: GATE_RISE },
    { key: 'arena_ruined_stair_0', tier: 'thicket', across: -0.62, along: -1.15 },
    { key: 'arena_ruined_stair_0', tier: 'thicket', across: 0.62, along: -1.15 },
    { key: 'arena_platform_0', tier: 'canopy', across: -2.5, along: 0.55, lift: GATE_RISE, turn: 0.35 },
    { key: 'arena_fallen_landing_0', tier: 'thicket', across: 2.2, along: 0.6, turn: 0.12 },
    { key: 'arena_cage_0', tier: 'canopy', across: 3.35, along: 0.75 },
    { key: 'arena_pass_rubble_0', tier: 'ground', across: 2.2, along: -0.35 },
    { key: 'arena_pass_rubble_0', tier: 'ground', across: 3.0, along: 0.6, turn: 0.6 },
    { key: 'arena_ribs_0', tier: 'thicket', across: 2.3, along: -1.15, turn: 0.4 },
    { key: 'arena_bones_0', tier: 'ground', across: 1.45, along: -1.55 },
    // **The pass's only fires, and they are here because the ruin is.** The kit
    // used to spread three braziers round the ring by bearing, which is the
    // review's "evenly spaced lamps" exactly: a light at every third of the
    // circle lights the circle, and nothing in particular. One burns on the
    // surviving terrace beside the arch and one in the wreckage of the fallen
    // end, so the warm light in the frame is the route and what became of it.
    { key: 'arena_brazier_0', tier: 'canopy', across: -1.6, along: -0.3, lift: GATE_RISE },
    { key: 'arena_brazier_0', tier: 'canopy', across: 3.0, along: -0.3 },
    // **Snow where something shelters it.** On the terrace in the lee of the
    // right pier, banked against the foot of the courses, and behind the block
    // that fell — rather than rolled into open ground, where a drift at this
    // framing is a white chip with nothing to explain it.
    { key: 'arena_snow_0', tier: 'ground', across: 1.4, along: 1.25, lift: GATE_RISE, turn: 0.5 },
    { key: 'arena_snow_0', tier: 'ground', across: -2.9, along: -0.85, turn: -0.2 },
    { key: 'arena_snow_0', tier: 'ground', across: 2.1, along: 1.35, turn: 1.1 },
  ],
};

// --- Boundaries: where the land closes, and where it does not --------------
//
// **The outdoor kit that takes a wall is the one the review calls a bowl**, and
// the reason was one line of authoring: `MOUNTAIN_PASS` borrowed the hall's
// closed course, so it came out as a uniform-height retaining wall at one radius
// with the camera-side quarter cut away by the envelope. A horseshoe is what that
// is, whatever the segments are carved as. The desert used to take one too — two
// sandstone shoulders — and the 2026-10-21 review removed them: it is open sand.
//
// **This is the shape, not the composition.** What a mountain shelf with a drop
// off one side is made of is the biome feature's own work; what is settled here
// is that the vocabulary can say it at all.

/**
 * Rock on one flank, and a range of lower peaks across the far end.
 *
 * **The camera never turns, so the far end is the only direction that can carry
 * distance** — and the first version of this spent it on a wall. The near mass
 * ran `-3.70` to `-1.20`, which is a hundred and forty-three degrees of
 * full-height crag at the board's own level wrapping the left flank, the far end
 * and part of the right; the drop answered it on the one flank the camera looks
 * *across*. Played, that is a horseshoe with a shadow down one side, which is
 * the verdict the feature exists to avoid and the one it earned.
 *
 * So the rock keeps the left and nothing else. What closes the far end instead
 * is the second arc, and it closes it from **below**: standing at six hexes it
 * comes out past the lip, so `standOnShelf` drops it a full descent and a
 * six-unit mass tops out under the ground the fight is on. A ridge whose crest
 * is below your feet is the one thing in the vocabulary that says *we are higher
 * than that*, and it costs no new field — it is the same arc, on ground that
 * now falls away underneath it.
 */
const PASS_MASSES: BoundaryArc[] = [
  // The mountain we are standing against: left flank and the far-left corner,
  // 110 degrees to 235, which is where the gate and the camp are set into it.
  { bearing: 3.01, sweep: 2.18 },
  // The range below, across the far end only: the right is a mountainside now
  // (`MOUNTAIN_HILLS`), and masses dropped onto its terraces read as a wall.
  { bearing: -1.15, sweep: 1.2, depth: 6, scale: 0.80 },
];

/**
 * The open ground the view goes out over, kept clear so it can.
 *
 * A quiet sector thins what is *rolled*, and its job here is to stop pines and
 * outcrops closing the one direction the frame has any distance in. Narrower
 * than the shelf's own sweep rather than equal to it, which reverses the note
 * this replaced: that argument was written when the descent was eight units of
 * run and half of it stood behind a treeline, and the descent is four now — a
 * prop past the lip stands *on* a terrace rather than in front of one, and
 * thinning the whole hundred and eighty degrees would leave the board sitting on
 * a bare plate.
 */
/**
 * The mountains below as ridges rather than crags. See `alpineRidge`.
 */
const PASS_RIDGES = ['arena_alpine_ridge_0', 'arena_alpine_ridge_1', 'arena_alpine_ridge_2'];

const PASS_OPENING: QuietSector[] = [{ bearing: -1.15, sweep: 1.2, density: 0.3 }];

/**
 * And the land actually falling away, across the far end and the right.
 *
 * Read with `PASS_MASSES`: rock closing the left flank is the mountain, the
 * ground ending straight ahead is the height, and the two together are a shelf.
 * Either alone is a bowl.
 *
 * Three things the first version got wrong, and every one of them was
 * measurable without a render:
 *
 * - **It was pointed at the flank.** A drop at `0.15` is due right, which the
 *   camera looks across rather than along, and a portrait frame reaches about
 *   twelve units either side of the board — so with the lip at 11.6 and the
 *   descent completing at 20, the terraces, the lower plane and every mass
 *   standing on it were off-screen at the framing the game is actually played
 *   at. It was verified zoomed out and hard-panned, which is exactly where it
 *   was visible and is not where anybody stands. The sector is centred at
 *   `-0.52` now: a hundred and eighty degrees from the far-left round through
 *   straight-ahead to the near-right, so the ground ends in the middle of the
 *   frame.
 * - **The descent was a ramp.** Four treads of 2.1 is eight units of run for
 *   six of fall, which is a thirty-seven degree slope — and a slope that shallow
 *   is a hillside, not a cliff, whatever it is painted. One unit of tread
 *   against seven of drop is sixty degrees and it fits inside the frame, which
 *   is the constraint that decides it rather than taste.
 * - **It was painted as shadow.** See `face` and `lower`.
 *
 * `radius` 11.6 is unchanged and is measured against two things. The board's own
 * circumradius is 8.66 and `planClearance` gives the outermost playable hex
 * another hex of margin, so anything under about 10 would put the lip where a
 * selected tile has to stay legible; and it has to be inside the frame, which is
 * what the rest of the descent now is too.
 */
const PASS_SHELF: ShelfSpec = {
  // Straight ahead only, since the 2026-10-22 hills: the right climbs instead.
  // Clear of the gate (-2.25) and the haunted ruin (-1.9): both stand on the fight's level.
  edges: [{ bearing: -1.15, sweep: 1.4, radius: 11.6 }],
  drop: 7.0,
  steps: 4,
  tread: 1.0,
  /**
   * **Exposed rock, and it is what the ledges are cut from too.**
   *
   * This was `#25272c` against a `lower` of `#282a2f` — a contrast of **1.041**,
   * which is the roster's oldest rule broken on the one surface the whole
   * landform rests on: a face within about ten percent of what is behind it is
   * absent rather than subtle. Both also sat at half the 0.045 below which a
   * surface reads as a hole, so what reached the screen was a dark band at the
   * edge of the lit ground and nothing that could be taken for a cliff.
   *
   * `ledgeLight` climbs out of *this* now rather than out of `lower`, because a
   * terrace is a ledge of the same rock as the riser under it and the country at
   * the bottom is a different thing entirely — see `lower`.
   */
  face: '#464b54',
  /**
   * The country at the bottom, and it is **paler than the shelf**, not darker.
   *
   * It used to be the darkest value in the scene *and* the largest area in it:
   * the lower plane runs from the last terrace all the way to the disc's own
   * 170, and it was painted at `ledgeLight(spec, steps)`, which is the bottom of
   * the flight and therefore unlightened. A near-black surface covering that
   * much of the frame is not distance, it is an absence — and it is the thing
   * the eye was being asked to read the height against.
   *
   * Air is what makes distance: land seen across several kilometres is lighter
   * and bluer than the rock at your feet, which is the same reason `haze` is
   * pale. This sits between the ground the fight is on and the haze that
   * eventually takes it, so the country fades out rather than fighting its way
   * through.
   */
  lower: '#5e6673',
  // Fourteen rather than nine, over a wider sector: these are the horizon now
  // rather than something beyond one flank, and a gap in a range reads as a gap.
  below: { keys: ['arena_crag_0', 'arena_crag_1', 'arena_crag_2'], count: 24 },
};

/**
 * Open meadow.
 *
 * Boulders, tall grass and two ponds at opposing corners, under a thin scatter
 * of lone trees rather than a treeline: the reference is a bright open field
 * with water at its edges, and the thing that would ruin it is the forest's own
 * enclosure applied to it. The ponds are focal for the castle's reason — water
 * at the corners is a composition, and a rate would put it in one corner or
 * none.
 */
const MEADOW: SceneryKit = {
  groundCover: ['arena_grass_0', 'arena_grass_0', 'arena_ferns_0', 'arena_flowers_0'],
  canopy: ['arena_oak_0', 'arena_oak_1', 'arena_birch_0', 'arena_outcrop_1'],
  thicket: [
    'arena_meadow_0', 'arena_meadow_1', 'arena_bush_0', 'arena_bush_1',
    'arena_boulder_0', 'arena_boulder_1', 'arena_boulder_2', 'arena_log_0',
    'arena_reeds_0',
  ],
  ground: ['arena_grass_0', 'arena_flowers_0', 'arena_ferns_0', 'arena_stones_0'],
  // Three rather than the reference's two. Two opposite anchors on a frame this
  // wide put both of them off-screen as often as not; three guarantees one in
  // view at every rotation of the seeded spread, and "water at the edges" is
  // what the composition is, not "exactly two ponds".
  focal: [{ key: 'arena_pond_0', tier: 'canopy', count: 3, depth: 2 }],
  // Lush and continuous, which is what the review asks of this one target and
  // of no other: at the shared 0.38 the meadow's grass came back in small
  // clusters with bare earth between them, which is a mown field. See
  // `SceneryKit.cover`.
  cover: { threshold: 0.16, near: 10 },
  // **The ponds keep their prop and gain their ground.** The focal is what
  // guarantees water in a named direction; the region is what gives it an edge
  // the eye can follow past the outline of one object. Threshold high, because
  // a meadow is a field with water at its margins rather than a flood plain.
  water: {
    shape: 'pools',
    // The pond prop's own `WATER`, so the region and the object it grew out of
    // are one body of water rather than two blues meeting.
    color: '#3f7fb4',
    bank: ['arena_reeds_0', 'arena_boulder_1', 'arena_meadow_0'],
    near: 2, far: 5, coverage: 0.2,
  },
  enclosure: 0.3,
  fill: {
    far: ['arena_oak_0', 'arena_oak_1', 'arena_birch_0'],
    distant: ['arena_far_oak_0', 'arena_far_oak_0', 'arena_far_pine_0'],
    under: ['arena_bush_0', 'arena_bush_1', 'arena_meadow_0', 'arena_meadow_1', 'arena_boulder_0'],
    low: ['arena_ferns_0'],
    from: 6,
    share: 0.5,
  },
};

/** The same field, gone over. Dead growth, bones, grave stones and lanterns. */
const BLIGHTED_MEADOW: SceneryKit = {
  canopy: ['arena_dead_tree_0', 'arena_dead_tree_1', 'arena_outcrop_1'],
  thicket: [
    'arena_dead_bush_0', 'arena_dead_bush_1', 'arena_ribs_0', 'arena_grave_0',
    'arena_boulder_0', 'arena_boulder_1', 'arena_log_0',
  ],
  // Growth before litter: the ash went and the bones are one piece in five, so what
  // lies between the fill's clumps near the board is dark growth rather than pale
  // chips — the confetti `groundCover` already warns about, seen again in the
  // arena review's captures.
  ground: ['arena_dead_grass_0', 'arena_dead_shrub_0', 'arena_fungus_0', 'arena_bramble_0', 'arena_bones_0'],
  focal: [
    { key: 'arena_lantern_0', tier: 'canopy', count: 3, depth: 2 },
    // **The cyan accents the review asks for, and they are lights rather than a
    // tint.** `plains_haunted` is the one target whose gap names a colour
    // directly — "missing strong cyan accents" — and what the kit had was
    // ankle-high glowing fungus, which is a chip on the floor. A cold lamp is
    // the lairs' cold fixture and it is in the anchor table with its own
    // colour since R3, so a wisp here lights the ground around it instead of
    // merely being cyan.
    { key: 'arena_cold_lamp_0', tier: 'canopy', count: 2, depth: 3 },
  ],
  // The other half of that gap is "substantial water corners" — the living
  // meadow's ponds gone over rather than absent, which is what the pair rule
  // says: a blighted arena is a dressing, and the *land* is the same land.
  water: {
    shape: 'pools',
    color: '#35424e',
    bank: ['arena_ribs_0', 'arena_grave_0', 'arena_dead_bush_1', 'arena_log_0'],
    near: 2, far: 5, coverage: 0.2,
  },
  enclosure: 0.35,
  fill: {
    far: ['arena_dead_tree_0', 'arena_dead_tree_1'],
    distant: ['arena_far_dead_tree_0'],
    under: ['arena_dead_bush_0', 'arena_dead_bush_1', 'arena_grave_0', 'arena_boulder_0'],
    low: ['arena_bramble_0', 'arena_dead_shrub_0', 'arena_bramble_0', 'arena_fallen_stone_0'],
    clump: 3,
    from: 6,
    share: 0.5,
  },
};

/**
 * The highland basin's land: hills on three sides, highest behind the fall.
 *
 * **Ground rather than rock masses**, which is the 2026-10-21 review's whole
 * complaint about the shelves and terrace blocks that stood here: "stadium seats
 * and Lego blocks, not hills". The surround itself climbs — knolls and saddles
 * at several heights, a slope that starts two hexes out and runs on past the
 * camera's reach — and the pines, bushes and boulders stand on it. Highest behind
 * the fall, so the water comes off high ground; lower on the flanks, so the
 * opening view sees the slopes rise on both sides of the board.
 */
const HIGHLAND_HILLS: HillSpec = {
  rises: [
    // Behind the fall, steep and near: the water comes off the hill's own face.
    { bearing: -Math.PI / 2, sweep: 2.4, height: 6.5, from: 1.6, run: 7 },
    { bearing: Math.PI, sweep: 2.4, height: 4.4 },
    { bearing: 0.05, sweep: 2.2, height: 3.8 },
  ],
  // Close on the flanks, so the opening view sees the ground start to climb.
  from: 1.9,
  run: 9,
  relief: 0.62,
  // The fall comes off the hill: the ground behind it stands at its lip.
  backs: [{ key: 'arena_waterfall_0', height: 3.9, reach: 3, width: 3.2 }],
  // And its pool keeps level ground in front of it.
  level: ['arena_waterfall_0'],
  // Turf in the props' own greens, with one drier olive for the broad patches.
  turf: ['#80c248', '#74b442', '#69a83e', '#7aba46', '#93a64e'],
  earth: '#6e5034',
  rock: '#858073',
};

/**
 * A highland basin: a stream and its fall in a bowl of wooded hills.
 *
 * The third shape after the wood and the field. Enclosed by land rather than by
 * a treeline or a wall: the hills (`HIGHLAND_HILLS`) close the frame on three
 * sides and the pines stand loose over them.
 */
const HIGHLAND_BASIN: SceneryKit = {
  // **Grass and fern only.** Flowers and pebbles were the specks the review
  // names: bright points spread evenly over the foreground, one per clump, so
  // the nearest third of a portrait frame read as confetti on a brown floor.
  // Growth alone reads as turf, and the cover already gathers at the rock and
  // the water through the feature field.
  groundCover: ['arena_grass_0', 'arena_grass_0', 'arena_ferns_0'],
  // Fewer, larger clumps: the default threshold spread the cover over most of
  // the foreground in even sprinkles, which is the busy battlefield the task
  // asks to calm. Higher reads less far down the patch field, so what is left
  // is whole masses near the rock with open ground between.
  cover: { threshold: 0.52 },
  canopy: ['arena_pine_1', 'arena_pine_0'],
  // **Growth only, and no loose rock.** Boulders rolled at the thicket's rate
  // stood in open grass on the basin floor as often as anywhere, which read as
  // litter; the rock is on the hills, in the fill.
  thicket: ['arena_bush_1', 'arena_bush_0', 'arena_bush_1', 'arena_log_0'],
  // Earth and grass masses rather than flowers and pebbles: the broad
  // earth-to-turf transition is the floor's patches, and a prop here is a
  // clump of the same two materials, not a speck on top of them.
  ground: ['arena_ochre_0', 'arena_grass_0', 'arena_ferns_0'],
  focal: [
    // Depth 2, not 3. The canvas is the window less its top safe-area inset and
    // the frame is shifted up to clear the HUD, so the far rim of the visible
    // ground is nearer than the ring's own reach: at depth 3 the fall's head was
    // cut off by the top of the canvas, which on the one piece the basin is read
    // by is the whole feature missing. The hill rises straight behind it.
    { key: 'arena_waterfall_0', tier: 'canopy', count: 1, depth: 2, bearing: -Math.PI / 2 },
  ],
  // **The fall's own watercourse, and the whole reason the `course` shape
  // exists.** The review calls the highland fall a tap: it pours a bright
  // vertical onto dry rock and nothing leaves the plunge pool. A stream is a
  // shape with a direction and a source in it, which is precisely what a noise
  // field is not — so this is an arc at a fixed depth starting on the fall's own
  // bearing and running round the right flank toward the frame's edge. The fall
  // has already claimed its hex by the time the region is laid, so the course
  // begins at its foot rather than under it.
  water: {
    shape: 'course',
    color: '#3f7fb4',
    // Rock and growth both, because a bank that is only boulders is a stream
    // laid on the ground rather than running through the country: the bush
    // and the reeds are what tie the water to the pines either side of it.
    bank: [
      'arena_boulder_0', 'arena_reeds_0', 'arena_bush_1', 'arena_stones_0',
      'arena_boulder_1', 'arena_reeds_0',
    ],
    near: 2, far: 3, bearing: -Math.PI / 2, sweep: 1.9,
    source: 'arena_waterfall_0',
  },
  hills: HIGHLAND_HILLS,
  // Thin: the basin is enclosed by its land now, and a solid ring of pines in
  // front of the slopes hid the very hills they stand on.
  enclosure: 0.35,
  // The fall's head and the slope behind it, which a frame fitted to the board
  // alone cut off at the top of the canvas.
  framingDepth: 4,
  // Pines over the hills out to the camera's reach, loose, with bushes and rock
  // between them; small bushes in front, where nothing tall may stand.
  fill: {
    far: ['arena_pine_1', 'arena_pine_0', 'arena_pine_1'],
    distant: ['arena_far_pine_0'],
    under: [
      'arena_bush_0', 'arena_bush_1', 'arena_boulder_2', 'arena_sapling_0', 'arena_bush_0',
      'arena_boulder_0',
    ],
    low: ['arena_ferns_0'],
    from: 4,
    share: 0.6,
  },
  horizon: ['arena_pine_1'],
};

/**
 * The same basin blighted: the same hills, gone over.
 *
 * **The land is the living basin's** — the pair rule: a blighted arena is a
 * dressing, and the land is the same land — so the hills are `HIGHLAND_HILLS`
 * in the blight's own colours: dead grass gone grey-olive on the tops, dark
 * peat under it, cold slate below. The 2026-10-21 review asked for the rock
 * stack and the green terrace blocks to go ("they read as nothing") and for the
 * same depth as the living highlands, with props on the elevations.
 */
const BLIGHTED_HIGHLAND_HILLS: HillSpec = {
  ...HIGHLAND_HILLS,
  backs: [{ key: 'arena_waterfall_1', height: 3.9, reach: 3, width: 3.2 }],
  level: ['arena_waterfall_1'],
  turf: ['#666a4c', '#5c6146', '#545a40', '#6a6450', '#5f5a4a'],
  earth: '#4a3a2c',
  rock: '#5d6068',
};

/** The same basin, blighted: the hills stay, everything growing on them is dead. */
const BLIGHTED_HIGHLANDS: SceneryKit = {
  // Dead wood standing, and no rock rolled: the review's "rock stack" was the
  // outcrop column this list carried.
  canopy: ['arena_dead_tree_0', 'arena_dead_tree_1', 'arena_blight_oak_0'],
  // Dead brush, graves and old bones, without the green terrace blocks.
  thicket: ['arena_dead_bush_0', 'arena_dead_bush_1', 'arena_grave_0', 'arena_ribs_0'],
  // Growth before litter, the blighted meadow's lesson: the bones are one in five.
  ground: ['arena_dead_grass_0', 'arena_dead_shrub_0', 'arena_fungus_0', 'arena_bramble_0', 'arena_bones_0'],
  focal: [
    // **The same fall in cyan, which is the one gap the review names as
    // substantive.** The blighted basin shipped with the rock and none of the
    // water, so the feature the living basin is read by simply was not there.
    { key: 'arena_waterfall_1', tier: 'canopy', count: 1, depth: 2, bearing: -Math.PI / 2 },
    // Four lamps, pinned clear of the stream: spread by the seeded turn, one stood
    // on the hex the fall pours into and the water started a hex further on.
    { key: 'arena_lantern_0', tier: 'canopy', count: 1, depth: 2, bearing: -2.35 },
    { key: 'arena_lantern_0', tier: 'canopy', count: 1, depth: 2, bearing: 2.85 },
    { key: 'arena_lantern_0', tier: 'canopy', count: 1, depth: 2, bearing: 1.95 },
    { key: 'arena_lantern_0', tier: 'canopy', count: 1, depth: 2, bearing: 0.95 },
  ],
  water: {
    shape: 'course',
    // The cold lamp's wisp, a long way down. Cyan is the blight's one cool
    // colour and the tomb already owns it, so a blighted watercourse lit the
    // same way says the same thing the flame does.
    color: '#2f6f74',
    bank: ['arena_boulder_0', 'arena_grave_0', 'arena_ribs_0', 'arena_stones_0'],
    near: 2, far: 3, bearing: -Math.PI / 2, sweep: 1.9,
    source: 'arena_waterfall_1',
  },
  hills: BLIGHTED_HIGHLAND_HILLS,
  enclosure: 0.35,
  framingDepth: 4,
  // Dead trees standing loose over the hills out to the camera's reach, brush,
  // graves and rock between them; dark thorn in front, in clumps, because the
  // blighted ground has no cover of its own.
  fill: {
    far: ['arena_dead_tree_0', 'arena_blight_oak_0', 'arena_dead_tree_1', 'arena_blight_oak_1'],
    distant: ['arena_far_dead_tree_0', 'arena_far_blight_oak_0'],
    under: [
      'arena_dead_bush_0', 'arena_dead_bush_1', 'arena_cold_boulder_0', 'arena_grave_0',
      'arena_dead_bush_0', 'arena_cold_boulder_1',
    ],
    low: ['arena_bramble_0', 'arena_dead_shrub_0', 'arena_bramble_0', 'arena_fallen_stone_0'],
    clump: 3,
    from: 4,
    share: 0.6,
  },
  horizon: ['arena_dead_tree_1'],
};

/**
 * A wetland.
 *
 * Mossy buttressed trunks, board walks, old masonry sinking into it, reeds and
 * standing water — and lanterns, which the reference puts here as well as in the
 * blighted wood. The enclosure is most of the way solid: a bog closes in.
 */
const WETLAND: SceneryKit = {
  groundCover: ['arena_ferns_0', 'arena_ferns_0', 'arena_grass_0'],
  canopy: ['arena_bog_tree_0', 'arena_bog_tree_1', 'arena_dead_tree_1'],
  thicket: [
    'arena_boards_0', 'arena_bog_ruin_0', 'arena_reeds_0', 'arena_log_0',
    'arena_boulder_1', 'arena_bush_1', 'arena_stump_0',
  ],
  ground: ['arena_shallows_0', 'arena_ferns_0', 'arena_bones_0', 'arena_stones_0'],
  focal: [
    { key: 'arena_pond_0', tier: 'canopy', count: 4, depth: 2 },
    { key: 'arena_lantern_0', tier: 'canopy', count: 3, depth: 3 },
  ],
  // **A bog is mostly water, so this one starts at the board's own rim.** The
  // wetland is the kit the region changes most: what a bog *is* is standing
  // water with ground between the channels, and every previous attempt at it
  // was ponds and shallows scattered as objects over continuous soil.
  water: {
    shape: 'pools',
    // Green-black rather than blue: a bog reflects the canopy over it and the
    // peat under it, and blue water here read as a swimming pool.
    color: '#38564a',
    bank: ['arena_reeds_0', 'arena_boards_0', 'arena_log_0', 'arena_stump_0'],
    near: 1, far: 5, coverage: 0.38,
    treed: true,
  },
  enclosure: 0.8,
  fill: {
    far: ['arena_bog_tree_0', 'arena_bog_tree_1', 'arena_dead_tree_1'],
    distant: ['arena_far_bog_tree_0', 'arena_far_bog_tree_0', 'arena_far_dead_tree_0'],
    under: ['arena_reeds_0', 'arena_bush_1', 'arena_stump_0', 'arena_boulder_1'],
    low: ['arena_ferns_0'],
    from: 3,
    share: 0.55,
    water: 0.35,
  },
};

/** The same bog, blighted. Black water, bones, and more of it dead. */
const BLIGHTED_WETLAND: SceneryKit = {
  canopy: ['arena_dead_tree_0', 'arena_dead_tree_1', 'arena_bog_tree_1'],
  thicket: [
    'arena_boards_0', 'arena_bog_ruin_0', 'arena_ribs_0', 'arena_grave_0',
    'arena_dead_bush_1', 'arena_log_0',
  ],
  ground: ['arena_shallows_0', 'arena_dead_shrub_0', 'arena_fungus_0', 'arena_bramble_0', 'arena_bones_0'],
  focal: [{ key: 'arena_lantern_0', tier: 'canopy', count: 5, depth: 2 }],
  water: {
    shape: 'pools',
    // Black water, and it sits **just** clear of the roster's 0.045 visibility
    // floor at 0.052 — which is the bind the blighted palette is always in and
    // the reason this is a measured hex rather than a darker one. Below the
    // floor a surface is not sombre, it is a hole in the scene.
    color: '#35424e',
    bank: ['arena_ribs_0', 'arena_boards_0', 'arena_dead_bush_1', 'arena_log_0'],
    near: 1, far: 5, coverage: 0.38,
    treed: true,
  },
  enclosure: 0.75,
  fill: {
    far: ['arena_dead_tree_0', 'arena_dead_tree_1', 'arena_bog_tree_1'],
    distant: ['arena_far_dead_tree_0', 'arena_far_dead_tree_0', 'arena_far_bog_tree_0'],
    under: ['arena_dead_bush_0', 'arena_dead_bush_1', 'arena_grave_0', 'arena_bog_ruin_0'],
    low: ['arena_bramble_0', 'arena_dead_shrub_0', 'arena_bramble_0', 'arena_fallen_stone_0'],
    clump: 3,
    from: 3,
    share: 0.55,
    water: 0.35,
  },
};

/**
 * Where both deserts leave the sand open, and what lies on it. See `OpenGround`.
 *
 * A field cell about six units across, so the open land comes in patches and lanes
 * a few hexes wide between the stands rather than as single empty hexes, and about
 * two thirds of the ground beside and behind the board is open on every fight measured
 * (0.66–0.78 over five; half, 0.51–0.59, before the 2026-10-29 review's "too many props on
 * desert, lower the density for this map only") — a larger cell left one fight nearly bare
 * and the next a carpet; a clearing
 * of three units round every piece of a composed group, so the camp and the gate
 * stand in sand; the whole strip in front of the board open; and a flat dune on three
 * open hexes in ten beside and behind it, every one lying across a wind out of the
 * west-south-west.
 */
const DESERT_OPEN: OpenGround = {
  threshold: 0.66,
  scale: 0.16,
  clearing: 3.0,
  front: true,
  dunes: ['arena_dune_0', 'arena_dune_1'],
  // 0.4 while half the ground was open; at two thirds, 0.3 keeps about as many dunes a fight
  dune: 0.3,
  wind: 0.35,
};

/**
 * Open sand with stands of cactus, rock and bone, and the nomad camp standing in it.
 *
 * **Two reviews, and the second corrected the first.** The 2026-10-21 review said
 * "remove the walls; just cactuses, bones and some rocks", and the first pass did,
 * dressing every hex the camera reaches the way the open-air Empire arenas are
 * dressed. The review of that was "too much props — there should be some free land
 * on desert, bring back the desert camp, thin the cactus stand, drop the clutter in
 * front of the board". So the sandstone shoulders and the ruin stay gone, the camp
 * (`CAMP`) is back as the arena's landmark, and the ground is open sand by design
 * (`OpenGround`): irregular patches and lanes of it between stands of cactus with
 * rock and bone, a clearing round the camp, and nothing at all in front of the board.
 * The sand that is left open carries flat dunes with wind ripples, all lying across
 * one wind, so it reads as desert floor rather than as a gap.
 *
 * Three families of loose piece, each in several sizes and shapes: tall many-armed
 * saguaro, organ pipe, a young column, prickly pear and barrel clusters; a horned
 * skull, a whole carcass, ribs half buried and scattered bone; boulders, weathered
 * rock piles and loose stones. Where the ground is not open the edge fill dresses it,
 * with tall cacti loose (never on a neighbouring hex) and a thinner stand than the
 * first pass, thinned again on 2026-10-29 (`share` 0.22 → 0.16). Past the ring the tall cacti
 * are stand-ins (`arena_far_cactus_0`).
 *
 * **The material rules still hold.** Everything that is not a cactus is a saturated
 * warm colour, and nothing on the floor is paler than the board: the bone is
 * sun-bleached ivory toward ochre, `DESERT_BONE` on the floor and the paler
 * `SUN_BONE` only on the pieces that stand. `desertMaterials.test.ts`.
 */
const CANYON: SceneryKit = {
  canopy: ['arena_cactus_0', 'arena_cactus_1', 'arena_cactus_2', 'arena_cactus_7'],
  // Rock, bone and the smaller cacti. The drift stays in both lists: what banks
  // against a rock in open desert is sand, and it is the floor's own material.
  thicket: [
    'arena_dry_boulder_0', 'arena_dry_boulder_1', 'arena_dry_rock_1', 'arena_cactus_3',
    'arena_cactus_4', 'arena_cactus_6', 'arena_skull_0', 'arena_carcass_0', 'arena_sand_drift_0',
  ],
  ground: [
    'arena_sand_drift_0', 'arena_dry_stones_0', 'arena_desert_bones_0', 'arena_desert_ribs_0', 'arena_cactus_5',
  ],
  horizon: null,
  groups: [CAMP],
  enclosure: 0.2,
  fill: {
    far: ['arena_cactus_2', 'arena_cactus_0', 'arena_cactus_7', 'arena_dry_rock_0'],
    distant: ['arena_far_cactus_0', 'arena_far_cactus_0', 'arena_cactus_7', 'arena_dry_rock_0'],
    under: [
      'arena_cactus_3', 'arena_dry_boulder_0', 'arena_skull_0', 'arena_cactus_4', 'arena_dry_rock_1',
      'arena_carcass_0', 'arena_cactus_6', 'arena_dry_boulder_1',
    ],
    // Nothing: the strip in front of the board is open sand. See `openGround.front`.
    low: [],
    from: 4,
    share: 0.16,
  },
  openGround: DESERT_OPEN,
};

/**
 * The open desert at dusk: open sand, stands of dead cactus with rock and bone, and
 * the ruined gate.
 *
 * **The same reviews, with the one exception the first named: "the gate (the ruined
 * arch) can stay".** The sandstone shoulders, the ruined camp, the gibbets and the
 * masonry walls round the arch are gone; `BLIGHTED_GATE` is the arch on its own
 * threshold, the dead at its foot and a fire gone down to embers — the arena's one
 * light — standing in a clearing of open sand. The ground is open by the same rule
 * as the living desert's, with dunes in dusk sand.
 *
 * **The dead cacti are skeletons.** A dead saguaro is a cage of woody ribs round an
 * empty core with tatters of skin, and some have come down; the first pass's dried
 * living shape read as grey-beige posts under the haunted rig. `SAGUARO_RIB`.
 *
 * Everything rolled is the open desert's families cut at dusk: `DRIED_CACTUS`,
 * `SAGUARO_RIB`, `DUSK_BONE`, `DUSK_ROCK`, all darker than the blighted board and
 * saturated enough that the haunted rig's cyan fill does not grey them.
 * `desertHauntedMaterials.test.ts`.
 */
const BLIGHTED_CANYON: SceneryKit = {
  canopy: ['arena_dead_cactus_0', 'arena_dead_cactus_1'],
  thicket: [
    'arena_dusk_boulder_0', 'arena_dusk_boulder_1', 'arena_dusk_rock_1', 'arena_dead_cactus_2',
    'arena_dead_cactus_4', 'arena_dusk_skull_0', 'arena_dusk_carcass_0', 'arena_dusk_drift_0',
  ],
  ground: [
    'arena_dusk_drift_0', 'arena_dusk_stones_0', 'arena_dusk_bones_0', 'arena_dusk_ribs_0', 'arena_dead_cactus_3',
  ],
  horizon: null,
  haze: { color: '#80634d', near: 46, far: 58 },
  groups: [BLIGHTED_GATE],
  enclosure: 0.2,
  fill: {
    far: ['arena_dead_cactus_1', 'arena_dead_cactus_0', 'arena_dead_cactus_1', 'arena_dusk_rock_0'],
    distant: ['arena_far_dead_cactus_0', 'arena_far_dead_cactus_0', 'arena_dusk_rock_0'],
    under: [
      'arena_dead_cactus_2', 'arena_dusk_boulder_0', 'arena_dead_cactus_4', 'arena_dusk_skull_0',
      'arena_dusk_rock_1', 'arena_dusk_carcass_0', 'arena_dusk_boulder_1',
    ],
    low: [],
    from: 4,
    share: 0.16,
  },
  openGround: { ...DESERT_OPEN, dunes: ['arena_dusk_dune_0', 'arena_dusk_dune_1'] },
};

/**
 * A fortified pass.
 *
 * Snow-capped rock faces for walls, a watchtower and a tent on the floor of it,
 * fences and braziers — built ground in a place that has none, which is what
 * separates this from the highland basin next door. The basin is green and
 * natural; the pass is grey, defended and cold.
 */
/**
 * The mountain the pass is cut through, as land: blocky hillside climbing behind
 * the crags on the left, and a mountainside rising on the right to snow.
 *
 * **The 2026-10-21 review, both halves.** The left was "almost perfect, but
 * panning left shows it is a wall, not a hill": a course of crags is models with
 * backs, so the hill now climbs straight up behind every crag (`backs`) and runs on
 * past them. The right "reads as a rock wall; it should be a natural mountainside
 * with elevation, rocks, plants and trees, all irregular": the drop no longer
 * covers it and the range below no longer stands on its terraces; the ground
 * itself climbs, knolled and stepped, grass low down, stone on the steeps and
 * snow on the highest tops, with the fill's pines, boulders and saplings on it.
 * The drop keeps the far end, which is where the pass looks out over the valley.
 */
const MOUNTAIN_HILLS: HillSpec = {
  rises: [
    // Behind the crag course, which stands four hexes out.
    { bearing: Math.PI, sweep: 2.7, height: 7, from: 3.4, run: 6 },
    // The mountainside: near, long and high.
    { bearing: 0.0, sweep: 2.1, height: 10.5, from: 2.2, run: 12 },
  ],
  from: 3,
  run: 9,
  relief: 0.6,
  backs: [
    { key: 'arena_alpine_crag_0', height: 4.4, reach: 2.4, width: 1.9 },
    { key: 'arena_alpine_crag_1', height: 4.2, reach: 2.4, width: 1.9 },
    { key: 'arena_alpine_crag_2', height: 4.2, reach: 2.4, width: 1.9 },
  ],
  level: [
    'arena_gateway_0', 'arena_stair_0', 'arena_landing_0', 'arena_platform_1', 'arena_brazier_0',
    'arena_watchtower_0', 'arena_tent_0', 'arena_stores_0', 'arena_rack_0', 'arena_fence_0',
  ],
  // Alpine grass, from the scrub's own olive to a greener sward.
  turf: ['#6f8a4a', '#647f44', '#7a8a52', '#5c7442', '#83905a'],
  earth: '#5e4a36',
  rock: '#7d8087',
  snow: { above: 7, color: '#e6ecf2' },
};

const MOUNTAIN_PASS: SceneryKit = {
  framingDepth: 6,
  // **Every built thing the pass owns is placed, and none of it is rolled.** The
  // watchtower was a focal anchor spread twice by bearing and the tent a third
  // anchor, with the stores and the fencing left in the rolled thicket list —
  // which is four independent answers to "where is the garrison" and, rendered,
  // four separate small timber objects round a ring whose landmark is a gate.
  // They are all in `PASS_CAMP` now. What is left here is *rock and pine*, which
  // is what the ground actually grows.
  canopy: ['arena_alpine_pine_0', 'arena_alpine_pine_1'],
  thicket: [
    'arena_alpine_rubble_0', 'arena_alpine_boulder_0', 'arena_alpine_sapling_0',
  ],
  ground: ['arena_alpine_scrub_0'],
  groundCover: ['arena_alpine_scrub_0'],
  cover: { threshold: 0.42, near: 6 },
  wall: {
    keys: ['arena_alpine_crag_0', 'arena_alpine_crag_1', 'arena_alpine_crag_2'],
    depth: 4,
    arcs: PASS_MASSES,
  },
  quiet: [{ bearing: -1.15, sweep: 1.4, density: 0.45 }],
  // Cold and pale rather than the ground's own colour: haze is the sky lying on
  // the land, and tinting it with the rock would make the distance read as more
  // rock at lower contrast, which is the flat-plane look this exists to break.
  //
  // `near` is measured rather than picked: at the reference portrait aspect the
  // camera sits about 25 units off the board's centre, so the rear crag wall is
  // roughly 33 away and the gate a little nearer. A first pass at 34 fogged both
  // — the pass's own landmark washing out is the exact failure `HazeSpec`'s
  // comment warns about — and 46 leaves them alone while still catching the
  // lower country.
  haze: { color: '#818d9c', near: 46, far: 85 },
  shelf: {
    ...PASS_SHELF,
    // **Land, not air.** This was the haze's own `#818d9c`, so the country was
    // painted exactly the atmosphere it recedes into and could never separate
    // from it: the review measured a smooth ramp from the lip to the far edge and
    // read it as open water. A desaturated version of the ground the fight is on
    // — scrub and scree seen from a long way up — lets the haze take it *toward*
    // pale blue with distance, which is what a valley does and a sea does not.
    lower: '#6c705f',
    // The reference shows the cliff beneath the near edge as well as the
    // valley beyond. End the bare foreground at a real descending rock face.
    edges: [...PASS_SHELF.edges, { bearing: 1.6, sweep: 1.7, radius: 11.6 }],
    below: {
      keys: PASS_RIDGES,
      // Thirty rather than fifty-four: the crest carries the distance now, and
      // the ring's structural budget is spent on the one line the frame can see
      // rather than on masses under the lip it cannot.
      count: 30,
      // Across the far end, where the frame looks out over the drop; about a
      // ridge-width apart, so the line reads as one crest.
      crest: { bearing: -1.15, sweep: 1.1, distance: 20, count: 24 },
    },
  },
  // Snow-capped rock again: what is beyond a pass is the rest of the range.
  // Ridges and forest rather than crags: past the lip a crag stands alone in
  // the haze, and a crag alone in a plane is a sea stack. See `alpineRidge`.
  horizon: ['arena_alpine_ridge_1', 'arena_alpine_pine_0', 'arena_alpine_ridge_2'],
  // **Two loose fires, not three**, and they are the one thing still spread by
  // bearing: a fire's job out here is to light the ground between the gate and
  // the camp, and both of those carry their own now. Three more would light the
  // whole ring evenly, which is the fault `CASTLE_HALL`'s own count records —
  // a fire needs somewhere darker to be brighter than.
  focal: [{ key: 'arena_brazier_0', tier: 'canopy', count: 2, depth: 2 }],
  groups: [PASS_GATE, PASS_CAMP],
  enclosure: 0.95,
  hills: MOUNTAIN_HILLS,
  // Pines over the mountainside and the hill behind the crags, out to the
  // camera's reach, with rock and young growth between them. **Cheap pieces
  // between the trees, on purpose**: the alpine boulder and sapling are a
  // hundred boxes each, and a fill of them put the pass at three times the
  // box guard; the far trees are the distance model past the ring.
  fill: {
    far: ['arena_alpine_pine_0', 'arena_alpine_pine_1'],
    distant: ['arena_far_pine_0'],
    under: [
      'arena_sapling_0', 'arena_snow_boulder_0', 'arena_sapling_0', 'arena_cold_boulder_0',
      'arena_sapling_0',
    ],
    // Snowy tussock and fern in front, under the envelope's ankle height.
    low: ['arena_snow_tuft_0', 'arena_ferns_0'],
    from: 5,
    share: 0.45,
    deeper: 14,
  },
};

/** The same elevated pass, abandoned and cold beneath the ledges. */
const BLIGHTED_PASS: SceneryKit = {
  framingDepth: MOUNTAIN_PASS.framingDepth,
  // **Dead wood at the rock, and the rock is the crag's own.** The canopy here
  // is planting, not enclosure — the pass is walled by `PASS_MASSES` — so it
  // gathers at the crag faces and the ruin rather than being planted in the two
  // rings nearest the board. See `canopyGathers`.
  //
  // **Two stacks of rock to one tree, and that ratio is the restraint.** The
  // crag wall publishes forty feature sites, so a canopy that gathers plants
  // *more* than one that does not: with two dead trees in the list the pass
  // went from eleven a fight to twenty, stood in a row along the wall like a
  // fence. A third of the slots is what "sparse" comes to here.
  canopy: ['arena_slate_outcrop_0', 'arena_slate_outcrop_1', 'arena_frost_dead_tree_0'],
  canopyGathers: true,
  // **Cold stone and nothing else.** The fences, graves and dead brush this
  // used to roll were three more answers to "what happened here" spread evenly
  // round the ring, and the ruin answers it; the boulders were the forest's,
  // moss and all. What is left is dark slate rubble, which banks against the
  // crags because that is where the thicket gathers.
  thicket: ['arena_cold_boulder_0', 'arena_cold_boulder_1'],
  ground: ['arena_scree_0'],
  wall: {
    keys: ['arena_crag_0', 'arena_crag_1', 'arena_crag_2'],
    depth: 4,
    arcs: PASS_MASSES,
  },
  quiet: PASS_OPENING,
  // Keep the normal pass's lip and descending country. The lower rock is
  // lighter than the face but distinct from the colder air beyond it.
  shelf: {
    ...MOUNTAIN_PASS.shelf!,
    face: '#3d4652',
    lower: '#67717f',
    below: {
      keys: ['arena_crag_0', 'arena_crag_1', 'arena_crag_2'],
      count: 24,
      crest: MOUNTAIN_PASS.shelf!.below!.crest,
    },
  },
  haze: { ...MOUNTAIN_PASS.haze!, color: '#8995a5' },
  horizon: ['arena_crag_0', 'arena_crag_2'],
  groups: [ABANDONED_GATE],
  enclosure: 0.55,
  // The living pass's land, abandoned: dead turf, cold slate, old grey snow.
  hills: {
    ...MOUNTAIN_HILLS,
    backs: [
      { key: 'arena_crag_0', height: 4.8, reach: 2.4, width: 1.8 },
      { key: 'arena_crag_1', height: 4.6, reach: 2.4, width: 1.8 },
      { key: 'arena_crag_2', height: 4.6, reach: 2.4, width: 1.8 },
    ],
    level: [
      'arena_arch_0', 'arena_ruined_stair_0', 'arena_landing_0', 'arena_fallen_landing_0',
      'arena_platform_0', 'arena_cage_0', 'arena_pass_rubble_0', 'arena_brazier_0',
    ],
    turf: ['#5e6458', '#565d52', '#646a5f', '#4f564c', '#5d5c54'],
    earth: '#40382f',
    rock: '#5a6069',
    snow: { above: 7, color: '#c5ccd5' },
  },
  // Dead wood standing loose on the hillsides, slate rubble between.
  fill: {
    far: ['arena_frost_dead_tree_0'],
    distant: ['arena_far_dead_tree_0'],
    under: ['arena_cold_boulder_0', 'arena_cold_boulder_1', 'arena_cold_boulder_0'],
    low: ['arena_fallen_stone_0'],
    clump: 3,
    from: 4,
    share: 0.45,
    deeper: 14,
  },
};

/**
 * A shore.
 *
 * **Derived, not matched** — Section 3A records that no reference image exists
 * for water or for the three lairs, so this is built from the kits that do have
 * one and should be judged against the bar rather than against a target. A
 * fight on water happens in the shallows: a sandbar with surf across it, rocks
 * and driftwood at the margins, reeds where the land starts, and open water
 * beyond. The enclosure is the thinnest in the set, because the whole identity
 * of a coast is that one side of it is empty.
 */
const SHORE: SceneryKit = {
  canopy: ['arena_bog_tree_1', 'arena_outcrop_1', 'arena_dead_tree_1'],
  thicket: [
    'arena_shore_rock_0', 'arena_shore_rock_1', 'arena_driftwood_0',
    'arena_reeds_0', 'arena_boards_0', 'arena_log_0',
  ],
  ground: ['arena_surf_0', 'arena_stones_0', 'arena_shallows_0', 'arena_bones_0'],
  focal: [{ key: 'arena_pond_0', tier: 'canopy', count: 4, depth: 2 }],
  enclosure: 0.22,
};

/** The same shore under the blight: black water, bones and a cold light. */
const BLIGHTED_SHORE: SceneryKit = {
  canopy: ['arena_dead_tree_0', 'arena_dead_tree_1', 'arena_outcrop_1'],
  thicket: [
    'arena_shore_rock_0', 'arena_driftwood_0', 'arena_ribs_0',
    'arena_boards_0', 'arena_grave_0',
  ],
  ground: ['arena_surf_0', 'arena_bones_0', 'arena_fungus_0', 'arena_ash_0'],
  focal: [{ key: 'arena_lantern_0', tier: 'canopy', count: 4, depth: 2 }],
  enclosure: 0.25,
};

/**
 * A cave's floor in front of the board, left open: the opening view looks across
 * it, and anything strewn there is clutter between the camera and the fight (the
 * user's rule from the open-air reviews). Nothing else is opened — the field's
 * threshold is never met — so beside and behind the board the floor is still
 * dressed and still judged.
 */
const CAVE_FRONT: OpenGround = {
  threshold: 0,
  scale: 0.17,
  front: true,
  dunes: [],
  dune: 0,
  wind: 0,
};

/** The five sectors a cave's rock rises on: everywhere but in front of the board. */
function caveRises(height: number): HillRise[] {
  return [
    { bearing: -Math.PI / 2, sweep: 2.6, height },
    { bearing: Math.PI, sweep: 2.6, height },
    { bearing: 0, sweep: 2.6, height },
    { bearing: 2.35, sweep: 1.8, height: height - 1 },
    { bearing: 0.8, sweep: 1.8, height: height - 1 },
  ];
}

/**
 * The Wyrm's Hollow's rock: scorched sandstone in red-brown beds, with obsidian
 * where the fire glassed it, ember-red seams and sand run in through the cracks.
 */
const CAVE_WYRM: HillSpec = {
  rises: caveRises(15),
  from: 2.8,
  run: 2.2,
  relief: 0.4,
  level: ['arena_clutch_0'],
  turf: ['#7a5a48', '#6e5040', '#86664f'],
  earth: '#4a3028',
  rock: '#5a3a2e',
  cave: {
    wall: 1.2,
    ceiling: 11,
    stone: ['#4a3028', '#5a3a2e', '#6e4a3a', '#7d5844', '#8a6a50'],
    veins: { colors: ['#26202a', '#b8482a', '#c2a274'], share: 0.08 },
  },
};

/**
 * The Glacier Deep's walls: glacier ice in blue beds, darker toward the deep ice,
 * with snow packed in its seams and stone frozen into it.
 */
const CAVE_GLACIER: HillSpec = {
  rises: caveRises(15),
  from: 2.8,
  run: 2.4,
  relief: 0.35,
  turf: ['#a8b4c2', '#9aa8b8', '#b4c0cc'],
  earth: '#7d8fa4',
  rock: '#4f6f96',
  cave: {
    wall: 1.2,
    ceiling: 11,
    stone: ['#44607f', '#4f6f96', '#5d7fa8', '#6f93b8', '#7fa3c4'],
    veins: { colors: ['#dfe7ef', '#2c3a4c', '#b6d2e6'], share: 0.1 },
  },
};

/**
 * The Obsidian Gate's hall walls, thick: the coursed wall ring stays the inner face,
 * and dressed stone rises behind every segment of it (`backs`) and on all round to
 * the cut, so no zoom sees the back of a wall or the floor past it.
 */
const CASTLE_MASONRY: HillSpec = {
  rises: caveRises(14),
  from: 5,
  run: 1.6,
  relief: 0.2,
  backs: ['arena_wall_0', 'arena_wall_1', 'arena_wall_torch_0'].map((key) => ({ key, height: 6.4, reach: 3, width: 1.4 })),
  turf: ['#5e5f66', '#66676e', '#585960'],
  earth: '#4e5057',
  rock: '#6a6c74',
  cave: {
    wall: 1.2,
    ceiling: 11,
    stone: ['#5e6068', '#686068', '#6a6c74', '#74767e', '#7f8189'],
    veins: { colors: ['#4e5057', '#3a3244', '#8d8f97'], share: 0.1 },
  },
};

/**
 * The Warren's rock: earth and stone rising sheer all round the burrow's floor.
 *
 * Steep (a run of 2.4 units to eighteen), so its top leaves the frame before the
 * camera could look over it; its foot wanders two to four hexes off the board and
 * notches back where a burrow mouth opens into it (`level`). Packed earth in beds of
 * brown, with stone, root and pale grit through it.
 */
const CAVE_WARREN: HillSpec = {
  rises: caveRises(15),
  from: 2.6,
  run: 2.4,
  relief: 0.35,
  level: ['arena_burrow_mouth_0'],
  turf: ['#6e5638', '#664f33', '#77603f'],
  earth: '#4e3a27',
  rock: '#5c4a3a',
  cave: {
    wall: 1.2,
    ceiling: 11,
    stone: ['#4a3828', '#57422f', '#634c35', '#70573d', '#5a4b3e'],
    veins: { colors: ['#2e2216', '#8a8276', '#9a7248'], share: 0.07 },
  },
};

/**
 * The Warren: a dug burrow.
 *
 * Derived like the shore, and deliberately **not** the castle's grammar with
 * different stone — the plan names turning the lairs into throne rooms as the
 * mistake to avoid. Earth walls with roots and stone through them
 * (`CAVE_WARREN`), root falls out of the roof, gnawed timber and fungus. Nothing
 * in it is built; everything in it was dug or dragged.
 */
const WARREN_BURROW: SceneryKit = {
  // What grew, was dug or was set up here — no more rock: the stone cones are
  // gone (review, 2026-10-21) and the rock is the cave's own wall now.
  canopy: ['arena_burrow_shroom_0', 'arena_roots_0', 'arena_burrow_totem_0', 'arena_burrow_shroom_1', 'arena_roots_0'],
  thicket: [
    'arena_spoil_heap_0', 'lair_nest', 'lair_sacks', 'arena_bone_heap_0', 'arena_burrow_stakes_0',
    'arena_burrow_shrooms_0', 'arena_stores_0', 'arena_log_0', 'arena_boulder_1',
  ],
  ground: ['arena_fungus_0', 'arena_bones_0', 'arena_stones_0', 'arena_ash_0'],
  horizon: null,
  hills: CAVE_WARREN,
  focal: [
    { key: 'arena_burrow_mouth_0', tier: 'canopy', count: 1, depth: 3, bearing: -2.3 },
    { key: 'arena_burrow_mouth_0', tier: 'canopy', count: 1, depth: 3, bearing: -0.75 },
    { key: 'arena_burrow_mouth_0', tier: 'canopy', count: 1, depth: 3, bearing: 0.35 },
    { key: 'arena_burrow_fire_0', tier: 'thicket', count: 2, depth: 2 },
    { key: 'arena_lantern_0', tier: 'canopy', count: 2, depth: 2 },
  ],
  enclosure: 0.35,
  // What floor the rock leaves past the ring: the burrow's own pieces, loose.
  fill: {
    far: ['arena_burrow_shroom_1', 'arena_burrow_totem_0', 'arena_roots_0'],
    under: ['arena_spoil_heap_0', 'arena_bone_heap_0', 'arena_burrow_shrooms_0', 'lair_sacks', 'arena_boulder_1'],
    low: ['arena_burrow_tuft_0', 'arena_burrow_clods_0', 'arena_burrow_bones_0'],
    from: 3,
    share: 0.35,
  },
  openGround: CAVE_FRONT,
};

/**
 * The ice lair: a glacier's depths.
 *
 * Inside the glacier round the Heart's hall: walls of glacier ice too thick to
 * see past (`CAVE_GLACIER`), and on the floor what the Empire left when its
 * column fell back, frozen where it stopped. Lit cold by wisps and crystals, with
 * two braziers for the Empire that has been through it.
 */
const GLACIER_DEEP: SceneryKit = {
  // The Empire's dead and their gear, frozen where they stopped, and the glacier's
  // own broken ice — square-cut, not spires: the cones are gone (review, 2026-10-21).
  canopy: ['arena_frozen_soldier_0', 'lair_icefall', 'arena_frozen_standard_0', 'lair_imperial_sledge'],
  thicket: [
    'arena_ice_blocks_0', 'arena_frozen_cache_0', 'lair_serac', 'lair_frost_bones', 'lair_chain_stake',
    'arena_ribs_0', 'arena_ice_boulder_0', 'lair_snow_drift',
  ],
  ground: ['arena_bones_0', 'arena_rubble_0'],
  horizon: null,
  hills: CAVE_GLACIER,
  focal: [
    { key: 'arena_cold_lamp_0', tier: 'canopy', count: 3, depth: 2 },
    { key: 'arena_brazier_0', tier: 'canopy', count: 2, depth: 2 },
    { key: 'lair_ice_crystal', tier: 'thicket', count: 2, depth: 3 },
  ],
  enclosure: 0.4,
  fill: {
    far: ['arena_frozen_soldier_0', 'lair_icefall'],
    under: ['arena_ice_blocks_0', 'lair_serac', 'lair_frost_bones', 'arena_ice_boulder_0', 'arena_frozen_cache_0'],
    low: [],
    from: 3,
    share: 0.35,
  },
  openGround: CAVE_FRONT,
};

/**
 * The Wyrm's Hollow: a cavern with something living in it.
 *
 * Scorched sandstone walls (`CAVE_WYRM`), a clutch of eggs at the head of it,
 * the wyrm's hoard and fire for light. The clutch is pinned at the far end for
 * the throne's reason: it is what the room is *about*, and a room has one head.
 */
const WYRM_HOLLOW: SceneryKit = {
  // What the wyrm hoards, sheds and has eaten, and what its fire has made of the
  // sand: no more rock standing loose. The cones are gone (review, 2026-10-21) and
  // the Hollow's rock is its wall.
  canopy: ['arena_wyrm_skull_0', 'lair_strata', 'arena_shed_skin_0', 'lair_wyrm_nest'],
  thicket: [
    'arena_fallen_knight_0', 'arena_scorch_glass_0', 'arena_ribs_0', 'arena_dry_boulder_0', 'lair_ember_vent',
    'lair_ash_drift',
  ],
  ground: ['arena_rubble_0', 'arena_bones_0', 'arena_ash_0', 'arena_stones_0'],
  horizon: null,
  hills: CAVE_WYRM,
  focal: [
    { key: 'arena_clutch_0', tier: 'canopy', count: 1, depth: 2, bearing: -Math.PI / 2 },
    { key: 'arena_wyrm_hoard_0', tier: 'thicket', count: 1, depth: 2, bearing: -2.2 },
    { key: 'arena_wyrm_hoard_0', tier: 'thicket', count: 1, depth: 2, bearing: -0.9 },
    { key: 'arena_brazier_0', tier: 'canopy', count: 4, depth: 2 },
  ],
  enclosure: 0.5,
  fill: {
    far: ['arena_wyrm_skull_0', 'lair_strata'],
    under: ['arena_ribs_0', 'arena_scorch_glass_0', 'arena_fallen_knight_0', 'arena_dry_boulder_0', 'lair_ash_drift'],
    low: [],
    from: 3,
    share: 0.35,
  },
  openGround: CAVE_FRONT,
};

/**
 * The Obsidian castle's hall.
 *
 * The reference is blunt about what this is not: "a room, not a rubble-strewn
 * outdoor disc". What the shipped arena had was the dungeon set's small floor
 * furniture scattered over an infinite plane — no walls, no ceiling line, no
 * axis, and a hundred pebbles where the references have coursed stone.
 *
 * So the hall is built from its enclosure inward: a wall ring, a rhythm of
 * pillars and braziers around it, a throne at the head, and only then the floor
 * detail. Keyed on the **location** rather than on its surface, because three
 * places are floored in `stone` and the castle target is explicitly not a reason
 * to turn both stone lairs into throne rooms.
 */
const CASTLE_HALL: SceneryKit = {
  /**
   * **Empty, and it is the only kit in the game that declares that.**
   *
   * The pillars used to live here, and the structural band fills depth 0-2 at
   * this tier's own rate — which is what put fifteen columns at fifteen
   * distances round the hall and is exactly the review's "repeated pillars
   * dominate". They are a `colonnade` now. The first attempt at what to put here
   * instead was the statue, thinned to a quarter rate, and it produced
   * **twenty-five** robed guardians standing round the room: the same fault with
   * different furniture, which is the clearest evidence that what the hall was
   * missing is not a better large prop but the absence of a *rate* at that size.
   *
   * A hall's large things are its walls, its colonnade and the composition at
   * its head. All three are placed rather than rolled, so there is nothing left
   * for this tier to do and saying so is the honest spelling.
   */
  canopy: [],
  // A war hall's furniture rather than more rubble: the war table, tribute, racks,
  // stores and a column the siege brought down.
  thicket: ['arena_war_table_0', 'arena_tribute_0', 'arena_rack_0', 'arena_stores_0', 'arena_fallen_column_0', 'arena_boulder_1'],
  ground: ['arena_flagstone_0', 'arena_rubble_0', 'arena_stones_0'],
  wall: { keys: ['arena_wall_0', 'arena_wall_1', 'arena_wall_torch_0'], depth: 4 },
  hills: CASTLE_MASONRY,
  openGround: CAVE_FRONT,
  fill: {
    far: [],
    under: ['arena_rack_0', 'arena_stores_0', 'arena_tribute_0', 'arena_fallen_column_0'],
    low: [],
    from: 3,
    share: 0,
  },
  // Every third hex of the course at depth 3. Two is a palisade and four leaves
  // the bays wider than the pillars are tall, which reads as a ruin with some
  // columns left rather than as a colonnade.
  colonnade: { keys: ['arena_pillar_0', 'arena_pillar_1'], depth: 3, beat: 3 },
  horizon: null,
  /**
   * The head of the hall, as a composition rather than as a throne.
   *
   * Read outward from the middle: the throne on the axis, its own stair widened
   * either side by two dais blocks, a guardian and a standard on each flank, and
   * fire at the foot of the steps. The braziers are part of the group rather
   * than left to the anchor spread for the reason the whole group exists — what
   * lights a throne is the fire *at* the throne, and a rate puts it somewhere
   * else four times in five.
   *
   * `-π/2` is the far end, and it is the same bearing the carpet band in
   * `groundPatches` is authored at. Those two numbers agreeing is the axis; if
   * they ever disagree the hall has a runner leading to a wall.
   */
  groups: [{
    bearing: -Math.PI / 2,
    depth: 2,
    pieces: [
      { key: 'arena_throne_0', tier: 'canopy', across: 0, along: 0 },
      // The flight **broadens** as it comes down: a narrow tread at the throne's
      // own feet, a wider one in front of it. A stair of constant width is a
      // corridor, and what says "this is the head of the room" is that the floor
      // widens to meet the fight.
      //
      // How far forward it may reach is the envelope's answer, not a taste:
      // `planClearance` two hexes off the board's far rim runs 1.26-1.45 at
      // `along -0.8` and 0.68-0.92 at `-1.4`, and the board is **not** symmetric
      // in world x, so a tread that only just clears on one side loses its
      // mirror on the other. These two distances clear the thicket's 0.65 on
      // both flanks with room to spare.
      { key: 'arena_dais_1', tier: 'thicket', across: -0.65, along: -0.7 },
      { key: 'arena_dais_1', tier: 'thicket', across: 0.65, along: -0.7 },
      { key: 'arena_dais_0', tier: 'thicket', across: -1.95, along: -0.7 },
      { key: 'arena_dais_0', tier: 'thicket', across: 1.95, along: -0.7 },
      { key: 'arena_dais_1', tier: 'thicket', across: -0.65, along: -1.35 },
      { key: 'arena_dais_1', tier: 'thicket', across: 0.65, along: -1.35 },
      { key: 'arena_dais_0', tier: 'thicket', across: -1.95, along: -1.35 },
      { key: 'arena_dais_0', tier: 'thicket', across: 1.95, along: -1.35 },
      { key: 'arena_dais_0', tier: 'thicket', across: -3.25, along: -1.35 },
      { key: 'arena_dais_0', tier: 'thicket', across: 3.25, along: -1.35 },
      { key: 'arena_statue_0', tier: 'canopy', across: -3.4, along: 0.4 },
      { key: 'arena_statue_0', tier: 'canopy', across: 3.4, along: 0.4 },
      { key: 'arena_banner_0', tier: 'canopy', across: -5.1, along: 0.6 },
      { key: 'arena_banner_0', tier: 'canopy', across: 5.1, along: 0.6 },
      // The fires stay level with the throne rather than at the foot of the
      // steps: a brazier is checked against the canopy's 1.15 of clearance —
      // the tier contract states one size for a whole family, and this family
      // holds trees — so anywhere further forward is refused on the flank the
      // board leans toward.
      { key: 'arena_brazier_0', tier: 'canopy', across: -5.2, along: -0.6 },
      { key: 'arena_brazier_0', tier: 'canopy', across: 5.2, along: -0.6 },
    ],
  }],
  // Four, not six. Two of the hall's fires are in the group at the throne now,
  // and six more round the ring left the room evenly lit — which is the thing
  // the reference's own note warns about, one system over: a fire needs
  // somewhere darker to be brighter than.
  focal: [
    { key: 'arena_brazier_0', tier: 'canopy', count: 4, depth: 2 },
    // The Legion's harness on its stands, placed rather than rolled for the
    // statue's reason above: a rate of them is a crowd. On the four diagonals,
    // where the flanks' colonnade and the throne leave room.
    ...[-2.5, -0.65, 2.75, 0.4].map((bearing) => (
      { key: 'arena_armor_stand_0', tier: 'canopy' as const, count: 1, depth: 2, bearing })),
  ],
  // **The throne's two fires are the hall's first two lights, stated.** They were
  // fixtures among twenty, and the spread rule lit whatever stood furthest apart —
  // a brazier behind the throne and three wall torches, never the fires at it. The
  // group stands at the same place in every Seal, so the light can be written where
  // its braziers' flames are (`FIXTURES.arena_brazier_0`, 1.35 up), and the other
  // two go to the fixtures furthest from them.
  lights: [
    { at: [-5.2, 1.35, -9.9], color: '#ffb65d', intensity: 16, distance: 7 },
    { at: [5.2, 1.35, -9.9], color: '#ffb65d', intensity: 16, distance: 7 },
  ],
  // The colonnade and the group are the structure now, so the loose tier is
  // dressing and is thinned to match.
  enclosure: 0.25,
};

/**
 * The forest, and the first authored composition in the game.
 *
 * Five canopy pieces rather than two, because a treeline is mostly repetition
 * and the eye finds a repeat of one shape long before it notices a repeat of
 * five. They differ in **silhouette** first — a fir is a pointed stack, an oak a
 * crooked dome, a birch a pale bare stem under a high crown — because from a
 * camera at 52° the outline is most of what survives.
 */
const FOREST: SceneryKit = {
  groundCover: ['arena_ferns_0', 'arena_grass_0', 'arena_grass_0', 'arena_flowers_0'],
  canopy: [
    'arena_pine_0', 'arena_pine_1',
    'arena_oak_0', 'arena_oak_1',
    'arena_birch_0',
  ],
  thicket: [
    'arena_sapling_0', 'arena_sapling_1',
    'arena_bush_0', 'arena_bush_1',
    'arena_boulder_0', 'arena_boulder_1', 'arena_boulder_2',
    'arena_log_0', 'arena_stump_0',
  ],
  ground: ['arena_ferns_0', 'arena_grass_0', 'arena_flowers_0', 'arena_stones_0'],
  fill: {
    far: ['arena_pine_0', 'arena_pine_1', 'arena_oak_0', 'arena_oak_1', 'arena_birch_0'],
    distant: ['arena_far_pine_0', 'arena_far_pine_0', 'arena_far_oak_0'],
    under: ['arena_sapling_0', 'arena_sapling_1', 'arena_bush_0', 'arena_bush_1', 'arena_boulder_0', 'arena_boulder_2'],
    low: ['arena_ferns_0'],
    from: 5,
    share: 0.7,
  },
};

/**
 * The same wood, gone over.
 *
 * **A haunted arena is a dressing and a light preset, not a tint**, which is the
 * finding the reference pairs make most clearly: the current captures change the
 * ground's colour and little else, while the targets change what is *standing
 * there* — gnarled dead trunks, burgundy foliage, bones and warm lantern
 * pockets. So this shares the envelope, the tiers and the composer with the
 * living kit and almost none of its models.
 *
 * The two boulders and the log carry over because a rock is a rock; the blighted
 * broadleaf is deliberately the living one's geometry in burgundy on a grey
 * trunk, so a blighted stand reads as the same species having died rather than
 * as somewhere else entirely. Everything that was alive is replaced rather than
 * recoloured.
 */
const BLIGHTED_FOREST: SceneryKit = {
  canopy: [
    'arena_dead_tree_0', 'arena_dead_tree_1',
    'arena_blight_oak_0', 'arena_blight_oak_1',
  ],
  thicket: [
    'arena_dead_bush_0', 'arena_dead_bush_1',
    'arena_ribs_0', 'arena_grave_0',
    'arena_boulder_0', 'arena_boulder_1', 'arena_log_0',
  ],
  // Growth before litter: the ash went and the bones are one piece in five, so what
  // lies between the fill's clumps near the board is dark growth rather than pale
  // chips — the confetti `groundCover` already warns about, seen again in the
  // arena review's captures.
  ground: ['arena_dead_grass_0', 'arena_dead_shrub_0', 'arena_fungus_0', 'arena_bramble_0', 'arena_bones_0'],
  // The one thing in a blighted wood that is warm, and therefore the one thing
  // that cannot be left to a rate: measured at the thicket's own rate, a fight
  // got between zero and one lantern and half of those stood behind the camera.
  // Filed under `canopy` rather than `thicket`, and it is not in any tier list:
  // it is a landmark, not a texture. A lantern that reads across a clearing has
  // to be a post rather than a lamp on the floor — at the thicket's ceiling it
  // came out 32 screen pixels tall with a six-pixel flame, which is a warm dot
  // rather than a pocket of light.
  focal: [{ key: 'arena_lantern_0', tier: 'canopy', count: 5, depth: 2 }],
  fill: {
    far: ['arena_dead_tree_0', 'arena_dead_tree_1', 'arena_blight_oak_0', 'arena_blight_oak_1'],
    distant: ['arena_far_dead_tree_0', 'arena_far_blight_oak_0'],
    under: ['arena_dead_bush_0', 'arena_dead_bush_1', 'arena_boulder_0', 'arena_boulder_1', 'arena_grave_0'],
    low: ['arena_bramble_0', 'arena_dead_shrub_0', 'arena_bramble_0', 'arena_fallen_stone_0'],
    clump: 3,
    from: 3,
    share: 0.7,
  },
};

/**
 * Keyed by `ArenaScenery.surfaceKey` — `forest`, `danger_swamp`, `stone`.
 *
 * The same key space `grainFor` and `tileSurfaceKey` answer to, so a surface
 * that has a grain, a palette and a kit is one name in three tables rather than
 * three names that have to be kept in step.
 */
/**
 * Keyed by `sceneryFor`'s composition key: a world fight's `surfaceKey`, an
 * indoor fight's **location id**.
 *
 * Two key spaces in one table because they never collide — `LocationId` is
 * `castle` / `lair_warren` / … and a surface key is a `TileType` or a
 * `danger_`-prefixed one — and because the alternative is a second table that
 * has to be kept in step with this one. Indoors the surface is the wrong grain
 * of answer: three places are floored in `stone`, and they are a throne room and
 * two very different lairs.
 */

/**
 * A frozen lake: overlapping sheets of ice with a pond's rim and dead reeds at two
 * points of its shore and withered growth at two more.
 *
 * **A composition rather than an anchor**, and that is what makes it read. The
 * first pass put single frozen ponds down as anchors, a hex across each, and the
 * spruce rolled on the hexes round them closed over them — the captures could not
 * find the water at all. A group claims the ground its pieces cover and keeps the
 * rolled scenery and the fill out of its margin, so the ice is an open body several
 * units across with the trees standing back from its shore.
 */
function frozenLake(bearing: number, depth: number, sheet: string, pond: string, shore: [string, string]): FocalGroup {
  return {
    bearing,
    depth,
    pieces: [
      { key: sheet, tier: 'canopy', across: 0, along: 0 },
      { key: sheet, tier: 'canopy', across: 1.8, along: 0.5, turn: 0.4 },
      { key: sheet, tier: 'canopy', across: -1.7, along: 0.7, turn: -0.3 },
      { key: sheet, tier: 'canopy', across: 0.2, along: 1.8, turn: 1.2 },
      { key: pond, tier: 'canopy', across: 2.3, along: 2.0, turn: 0.8 },
      { key: pond, tier: 'canopy', across: -2.5, along: -0.5, turn: 2.2 },
      { key: shore[0], tier: 'thicket', across: 3.3, along: 0.4 },
      { key: shore[1], tier: 'thicket', across: -0.9, along: 2.9 },
    ],
  };
}

/**
 * The tundra: a snowfield under huge snow-laden spruce, with brown withered
 * growth, snow-capped rock and frozen pools between them.
 *
 * **Its first kit**; until now it was dressed from the world map's own
 * `terrain_tundra` family, map-sized pines and stones scattered at the ring's rate,
 * which the review called almost great with trees too small. So the openness is
 * kept — `enclosure` well under a wood's — and what changes is the size of things:
 * spruce as tall as the forest's tallest fir and nearly as wide as the canopy tier
 * allows, so a stand of three reads as a landmark against a unit, and in the fill
 * a third size again (`arena_snow_pine_2`, 5.7 units) for the distance.
 *
 * Four families, as the review lists them: the pines, the rocks, the brown bushes
 * and the frozen water. The pools are anchors for the meadow's reason — water at
 * the edges is a composition, and a rate would put it in one corner or none — and
 * props rather than a region because ice that scrolls is water. No ground cover:
 * snow is a hard floor for `SceneryKit.groundCover`'s purposes, and the pass found
 * that scattered snow reads as torn paper.
 */
const TAIGA: SceneryKit = {
  canopy: ['arena_snow_pine_0', 'arena_snow_pine_0', 'arena_snow_pine_1'],
  thicket: [
    'arena_withered_bush_0', 'arena_withered_bush_1', 'arena_withered_bush_0',
    'arena_snow_boulder_0', 'arena_snow_boulder_1',
  ],
  ground: ['arena_snow_mound_0', 'arena_snow_tuft_0', 'arena_snow_0'],
  // Two frozen lakes, one each side, kept clear of the spruce by their own footprint.
  groups: [
    frozenLake(-2.35, 4, 'arena_ice_sheet_0', 'arena_frozen_pond_0', ['arena_withered_bush_0', 'arena_snow_boulder_1']),
    frozenLake(-0.45, 4, 'arena_ice_sheet_0', 'arena_frozen_pond_0', ['arena_snow_boulder_0', 'arena_withered_bush_1']),
  ],
  // Looser than the first pass's 0.55: the spruce are as wide as the canopy tier
  // allows, and at that share neighbours stood crown into crown.
  enclosure: 0.4,
  fill: {
    far: ['arena_snow_pine_0', 'arena_snow_pine_1'],
    distant: ['arena_snow_pine_2', 'arena_snow_pine_2', 'arena_far_pine_0'],
    under: [
      'arena_withered_bush_0', 'arena_withered_bush_1', 'arena_snow_boulder_0', 'arena_snow_boulder_1',
      'arena_frozen_pond_1', 'arena_snow_mound_0',
    ],
    low: ['arena_snow_mound_0', 'arena_snow_mound_0', 'arena_snow_tuft_0'],
    clump: 2,
    from: 5,
    share: 0.7,
  },
};

/**
 * The same snowfield in the rimeblight: the spruce killed standing and furred with
 * rime, the brush gone grey, black ice where the pools were, bones, and two cold
 * lamps.
 *
 * The haunted tundra's own palette rather than the blighted forest's — the world
 * map's rimeblight is dead trees, dark slate under old snow, bones and brush, cold
 * rather than burnt — on the living kit's land, which is the pair rule: a haunted
 * arena changes what stands there and not where.
 */
const RIMEBLIGHT: SceneryKit = {
  canopy: ['arena_rime_pine_0', 'arena_rime_pine_0', 'arena_rime_pine_1', 'arena_frost_dead_tree_0'],
  thicket: [
    'arena_rime_brush_0', 'arena_rime_brush_0', 'arena_rime_boulder_0', 'arena_rime_boulder_1',
    'arena_ribs_0',
  ],
  ground: ['arena_rime_mound_0', 'arena_rime_tuft_0', 'arena_bones_0'],
  groups: [
    frozenLake(-2.35, 4, 'arena_black_ice_sheet_0', 'arena_black_ice_0', ['arena_rime_brush_0', 'arena_rime_boulder_1']),
    frozenLake(-0.45, 4, 'arena_black_ice_sheet_0', 'arena_black_ice_0', ['arena_rime_boulder_0', 'arena_ribs_0']),
  ],
  // The cold accent every haunted Empire arena carries, as the haunted plains' wisps.
  focal: [{ key: 'arena_cold_lamp_0', tier: 'canopy', count: 2, depth: 3 }],
  enclosure: 0.4,
  fill: {
    far: ['arena_rime_pine_0', 'arena_rime_pine_1'],
    distant: ['arena_rime_pine_2', 'arena_rime_pine_2', 'arena_far_dead_tree_0'],
    under: [
      'arena_rime_brush_0', 'arena_rime_boulder_0', 'arena_rime_boulder_1', 'arena_black_ice_1',
      'arena_rime_mound_0',
    ],
    low: ['arena_rime_mound_0', 'arena_rime_mound_0', 'arena_rime_tuft_0', 'arena_fallen_stone_0'],
    clump: 2,
    from: 5,
    share: 0.7,
  },
};

// ── Jadeveil: the range's own arenas ─────────────────────────────────────────
//
// **Provisional kits, dressed only from Jadeveil's own prop kit** (`voxel/models/jadeArena.ts`,
// from the private project notes). Every Jadeveil fight used to be fought in the
// Empire's plains, forest, highlands and mountain arenas; it is routed to these now
// (`encounterContext.compositionKeyFor` reads `MapTile.jade`), and `jadeveilArenas.test.ts` pins
// that no Jadeveil fight reaches an Empire kit or prop. These are a first, shippable
// composition each — the ground's own growth, its landmark and the edge fill out to the camera's
// reach — and the Jadeveil arenas feature composes each one properly. Each haunted twin keeps its
// living ground's land and swaps the dressing for the bible's yokai-touched pieces.

/** Jadeveil's mist: the distance fades into it, which is how the veil in the name is drawn. */
const jadeHaze = (color: string): HazeSpec => ({ color, near: 38, far: 64 });

/** The haunted twins' cold blue-green, closing in nearer. */
const GHOST_HAZE: HazeSpec = { color: '#5e7470', near: 32, far: 58 };

/** The range's hills: high behind the board and on its flanks, as the highland basin's. */
function jadeHills(heights: [number, number, number], palette: Pick<HillSpec, 'turf' | 'earth' | 'rock' | 'snow'>, level: string[]): HillSpec {
  return {
    rises: [
      { bearing: -Math.PI / 2, sweep: 2.4, height: heights[0], from: 2.2, run: 8 },
      { bearing: Math.PI, sweep: 2.4, height: heights[1] },
      { bearing: 0.05, sweep: 2.2, height: heights[2] },
    ],
    from: 2,
    run: 9,
    relief: 0.6,
    level,
    ...palette,
  };
}

/**
 * The moss valley's landmark: the torii across the far axis on a lane of laid flags, a lantern
 * either side of it, and a karst tower rising behind — the range's gate into its own country.
 */
function toriiApproach(haunted: boolean): FocalGroup {
  const lantern = haunted ? 'arena_jade_cold_lantern_0' : 'arena_jade_lantern_0';
  return {
    bearing: -Math.PI / 2,
    depth: 3,
    pieces: [
      { key: haunted ? 'arena_jade_torn_torii_0' : 'arena_jade_torii_0', tier: 'canopy', across: 0, along: 0 },
      { key: lantern, tier: 'thicket', across: -1.9, along: -0.7 },
      { key: lantern, tier: 'thicket', across: 1.9, along: -0.5 },
      { key: 'arena_jade_paving_0', tier: 'ground', across: 0.1, along: -1.3 },
      { key: 'arena_jade_paving_0', tier: 'ground', across: -0.2, along: -0.2, turn: 0.4 },
      { key: 'arena_jade_paving_0', tier: 'ground', across: 0.2, along: 0.9, turn: 0.9 },
      { key: haunted ? 'arena_jade_dead_karst_0' : 'arena_jade_karst_0', tier: 'canopy', across: 2.6, along: 3.0 },
      haunted
        ? { key: 'arena_jade_charm_post_0', tier: 'thicket', across: -1.6, along: 1.4, turn: 0.3 }
        : { key: 'arena_jade_fern_0', tier: 'thicket', across: -1.6, along: 1.4 },
    ],
  };
}

/**
 * The moss valley: a wet floor of moss among wind-shaped pines, open in the middle, pools at its
 * margins and on out into the far country, paddies by the water, karst towers standing up out of
 * the distance, and the torii across the far axis. Flat and open where the grove is close: the
 * valley's identity is its water and its long view, the grove's its walls of culms.
 */
const JADE_MOSS: SceneryKit = {
  groundCover: ['arena_jade_moss_0'],
  cover: { threshold: 0.3 },
  canopy: ['arena_jade_pine_0', 'arena_jade_pine_1', 'arena_jade_pine_0', 'arena_jade_pine_1'],
  thicket: [
    'arena_jade_boulder_0', 'arena_jade_boulder_1', 'arena_jade_fern_0', 'arena_jade_fern_0',
    'arena_jade_paddy_0', 'arena_jade_paddy_0',
  ],
  ground: ['arena_jade_moss_0', 'arena_jade_scree_0'],
  groups: [toriiApproach(false)],
  focal: [
    { key: 'arena_jade_lantern_0', tier: 'thicket', count: 2, depth: 2 },
    // Towers on the far flanks, the valley's walls: the karst the veil fades into
    { key: 'arena_jade_karst_0', tier: 'canopy', count: 1, depth: 4, bearing: -2.55 },
    { key: 'arena_jade_karst_0', tier: 'canopy', count: 1, depth: 5, bearing: -0.35 },
  ],
  water: {
    shape: 'pools',
    color: '#3f8f86',
    bank: ['arena_jade_boulder_1', 'arena_jade_fern_0', 'arena_jade_paddy_0', 'arena_jade_shoots_0'],
    near: 2, far: 5, coverage: 0.24,
  },
  enclosure: 0.3,
  framingDepth: 4,
  haze: jadeHaze('#b9c4b0'),
  fill: {
    far: ['arena_jade_pine_0', 'arena_jade_pine_1', 'arena_jade_karst_0', 'arena_jade_pine_0'],
    distant: ['arena_jade_far_pine_0', 'arena_jade_far_karst_0', 'arena_jade_far_karst_0', 'arena_jade_far_pine_0'],
    under: ['arena_jade_boulder_0', 'arena_jade_fern_0', 'arena_jade_paddy_0', 'arena_jade_boulder_1', 'arena_jade_fern_0'],
    low: ['arena_jade_moss_0'],
    from: 6,
    share: 0.45,
    // The valley's far country is wet: its pools run on past the ring
    water: 0.14,
  },
};

/**
 * The moss valley gone over: the same land, its pools black and still, the torii torn and leaning,
 * withered bamboo where the pines stood and only a few ghost pines among it, snapped culms and dead
 * fern between, the karst weathered dark. The foxfire wisps and the cold lanterns are its only light.
 */
const HAUNTED_JADE_MOSS: SceneryKit = {
  // Ghost pines where the living valley's pines stood, a withered stand among them: the grove's
  // black culms are the haunted bamboo's identity, and the valley keeps its own
  canopy: ['arena_jade_ghost_pine_0', 'arena_jade_withered_bamboo_1', 'arena_jade_ghost_pine_0'],
  thicket: [
    'arena_jade_snapped_culms_0', 'arena_jade_dead_fern_0', 'arena_jade_pale_boulder_0',
    'arena_jade_still_paddy_0', 'arena_jade_dead_fern_0', 'arena_jade_charm_post_0',
  ],
  ground: ['arena_jade_ghost_moss_0', 'arena_jade_scree_0'],
  groups: [toriiApproach(true)],
  focal: [
    { key: 'arena_jade_cold_lantern_0', tier: 'thicket', count: 2, depth: 2 },
    { key: 'arena_jade_wisp_0', tier: 'canopy', count: 2, depth: 3 },
    { key: 'arena_jade_dead_karst_0', tier: 'canopy', count: 1, depth: 4, bearing: -2.55 },
    { key: 'arena_jade_dead_karst_0', tier: 'canopy', count: 1, depth: 5, bearing: -0.35 },
  ],
  water: {
    shape: 'pools',
    color: '#26302e',
    bank: ['arena_jade_dead_fern_0', 'arena_jade_still_paddy_0', 'arena_jade_pale_boulder_0', 'arena_jade_snapped_culms_0'],
    near: 2, far: 5, coverage: 0.24,
  },
  enclosure: 0.35,
  framingDepth: 4,
  haze: GHOST_HAZE,
  fill: {
    far: ['arena_jade_ghost_pine_0', 'arena_jade_withered_bamboo_1', 'arena_jade_dead_karst_0', 'arena_jade_ghost_pine_0'],
    distant: [
      'arena_jade_far_ghost_pine_0', 'arena_jade_far_dead_karst_0', 'arena_jade_far_withered_bamboo_0',
      'arena_jade_far_ghost_pine_0',
    ],
    under: ['arena_jade_dead_fern_0', 'arena_jade_snapped_culms_0', 'arena_jade_pale_boulder_0', 'arena_jade_dead_fern_0'],
    low: ['arena_jade_ghost_moss_0'],
    clump: 3,
    from: 6,
    share: 0.45,
    water: 0.14,
  },
};

/** The grove's flanks: low moss hills the culms climb, so the grove has a floor and two banks. */
const GROVE_HILLS: HillSpec = {
  rises: [
    { bearing: Math.PI, sweep: 2.2, height: 3.4, from: 2.4, run: 6 },
    { bearing: 0, sweep: 2.2, height: 3.0, from: 2.4, run: 6 },
    { bearing: -Math.PI / 2, sweep: 1.6, height: 2.2 },
  ],
  from: 3,
  run: 8,
  relief: 0.7,
  level: ['arena_jade_lantern_0', 'arena_jade_shrine_0', 'arena_jade_cold_lantern_0', 'arena_jade_wisp_0'],
  turf: ['#5f8c3c', '#557f36', '#6a9444', '#4f7a34'],
  earth: '#3e3424',
  rock: '#9a9c92',
};

/**
 * The grove's landmark: a path of laid flags running back into the culms between pairs of stone
 * lanterns, to a roadside shrine at its end. Haunted, the lanterns stand cold, charm posts take the
 * shrine's place and a wisp hangs where its lamp was.
 */
function grovePath(haunted: boolean): FocalGroup {
  const lantern = haunted ? 'arena_jade_cold_lantern_0' : 'arena_jade_lantern_0';
  return {
    bearing: -0.95,
    depth: 2,
    pieces: [
      { key: lantern, tier: 'thicket', across: -1.2, along: 0 },
      { key: lantern, tier: 'thicket', across: 1.2, along: 0.2 },
      { key: 'arena_jade_paving_0', tier: 'ground', across: 0, along: -0.3, turn: 0.2 },
      { key: 'arena_jade_paving_0', tier: 'ground', across: 0.1, along: 0.8, turn: 0.7 },
      { key: 'arena_jade_paving_0', tier: 'ground', across: -0.1, along: 1.9, turn: 0.1 },
      { key: lantern, tier: 'thicket', across: -1.2, along: 2.4 },
      { key: lantern, tier: 'thicket', across: 1.3, along: 2.6 },
      ...(haunted
        ? [
          { key: 'arena_jade_wisp_0', tier: 'canopy' as const, across: 0, along: 3.8 },
          { key: 'arena_jade_charm_post_0', tier: 'thicket' as const, across: -0.9, along: 3.6, turn: 0.4 },
          { key: 'arena_jade_charm_post_0', tier: 'thicket' as const, across: 0.9, along: 3.7, turn: -0.3 },
        ]
        : [{ key: 'arena_jade_shrine_0', tier: 'canopy' as const, across: 0, along: 3.8 }]),
    ],
  };
}

/**
 * The bamboo grove: culms close on every side and climbing the moss banks of its flanks, shoots and
 * ferns under them, and a lantern-lined path of flags running back into the grove to a roadside
 * shrine. Enclosed where the moss valley is open, with no water.
 */
const JADE_BAMBOO: SceneryKit = {
  groundCover: ['arena_jade_moss_0'],
  canopy: ['arena_jade_bamboo_0', 'arena_jade_bamboo_0', 'arena_jade_bamboo_1', 'arena_jade_bamboo_0'],
  thicket: [
    'arena_jade_shoots_0', 'arena_jade_fern_0', 'arena_jade_shoots_0', 'arena_jade_boulder_0', 'arena_jade_boulder_1',
  ],
  ground: ['arena_jade_moss_0'],
  groups: [grovePath(false)],
  focal: [{ key: 'arena_jade_lantern_0', tier: 'thicket', count: 2, depth: 2 }],
  hills: GROVE_HILLS,
  enclosure: 0.8,
  framingDepth: 3,
  haze: jadeHaze('#8fa086'),
  fill: {
    far: ['arena_jade_bamboo_0', 'arena_jade_bamboo_1', 'arena_jade_bamboo_0'],
    distant: ['arena_jade_far_bamboo_0', 'arena_jade_far_bamboo_0', 'arena_jade_far_pine_0'],
    under: ['arena_jade_shoots_0', 'arena_jade_fern_0', 'arena_jade_boulder_1', 'arena_jade_shoots_0'],
    low: ['arena_jade_moss_0'],
    from: 4,
    share: 0.65,
  },
};

/** The grove the yokai have: black split culms on dead banks, charms, cold lanterns and wisps on its path. */
const HAUNTED_JADE_BAMBOO: SceneryKit = {
  canopy: [
    'arena_jade_withered_bamboo_0', 'arena_jade_withered_bamboo_0', 'arena_jade_withered_bamboo_1',
    'arena_jade_withered_bamboo_0', 'arena_jade_ghost_pine_0',
  ],
  thicket: [
    'arena_jade_snapped_culms_0', 'arena_jade_dead_fern_0', 'arena_jade_snapped_culms_0',
    'arena_jade_pale_boulder_0', 'arena_jade_charm_post_0',
  ],
  ground: ['arena_jade_ghost_moss_0'],
  groups: [grovePath(true)],
  focal: [
    { key: 'arena_jade_wisp_0', tier: 'canopy', count: 2, depth: 2 },
    { key: 'arena_jade_cold_lantern_0', tier: 'thicket', count: 1, depth: 3, bearing: -2.3 },
  ],
  hills: {
    ...GROVE_HILLS,
    turf: ['#4a5046', '#444a40', '#50564a'],
    earth: '#2a2a22',
    rock: '#5a5d58',
  },
  enclosure: 0.8,
  framingDepth: 3,
  haze: GHOST_HAZE,
  fill: {
    far: ['arena_jade_withered_bamboo_0', 'arena_jade_withered_bamboo_1', 'arena_jade_withered_bamboo_0'],
    distant: ['arena_jade_far_withered_bamboo_0', 'arena_jade_far_withered_bamboo_0', 'arena_jade_far_ghost_pine_0'],
    under: ['arena_jade_snapped_culms_0', 'arena_jade_dead_fern_0', 'arena_jade_pale_boulder_0', 'arena_jade_dead_fern_0'],
    low: ['arena_jade_ghost_moss_0'],
    clump: 3,
    from: 4,
    share: 0.65,
  },
};

const TERRACE_LEVEL = ['arena_jade_shrine_0', 'arena_jade_flags_0', 'arena_jade_torn_torii_0', 'arena_jade_cold_lantern_0'];

/**
 * The terraced slope's land: the range's hills cut into treads (`TerraceSpec`) climbing behind and
 * beside the board — level shelves of gold turf on risers of dry stone two blocks high, their edges
 * following the contours round the hill, tea planted along every tread's outer edge and the lowest
 * tread flooded into paddies.
 */
const JADE_TERRACE_HILLS: HillSpec = {
  rises: [
    { bearing: -Math.PI / 2, sweep: 2.5, height: 6.8, from: 2.2, run: 11 },
    { bearing: Math.PI, sweep: 2.4, height: 5.2, run: 11 },
    { bearing: 0.05, sweep: 2.2, height: 4.4, run: 11 },
  ],
  from: 2,
  run: 11,
  relief: 0.45,
  level: TERRACE_LEVEL,
  turf: ['#a89a48', '#95903f', '#b8a652', '#9a9a44'],
  earth: '#6e5530',
  rock: '#8c8064',
  terrace: {
    step: 0.8,
    stone: ['#a8997a', '#b4a684', '#9c8e70', '#bcae8c'],
    joint: '#5e5440',
    paddy: '#7fa8a0',
    rows: { keys: ['arena_jade_tea_0'], every: 1.6, share: 0.6, reach: 30 },
  },
};

/**
 * The terraced slope: gold treads climbing three sides of the board, tea in rows along their edges
 * and paddies on the lowest, wind pines standing loose on the shelves, the roadside shrine at the
 * head of the slope and prayer flags on it. The one Jadeveil arena that is *worked* land.
 */
const JADE_TERRACE: SceneryKit = {
  groundCover: ['arena_jade_grass_0', 'arena_jade_grass_0', 'arena_jade_moss_0'],
  cover: { threshold: 0.4 },
  canopy: ['arena_jade_pine_0', 'arena_jade_pine_1', 'arena_jade_pine_1'],
  thicket: ['arena_jade_tea_0', 'arena_jade_paddy_0', 'arena_jade_boulder_1', 'arena_jade_tea_0'],
  ground: ['arena_jade_grass_0', 'arena_jade_moss_0'],
  focal: [
    { key: 'arena_jade_shrine_0', tier: 'canopy', count: 1, depth: 2, bearing: -Math.PI / 2 },
    { key: 'arena_jade_flags_0', tier: 'canopy', count: 2, depth: 3 },
    { key: 'arena_jade_lantern_0', tier: 'thicket', count: 2, depth: 2 },
  ],
  hills: JADE_TERRACE_HILLS,
  enclosure: 0.3,
  framingDepth: 4,
  haze: jadeHaze('#c9c09a'),
  fill: {
    far: ['arena_jade_pine_0', 'arena_jade_pine_1', 'arena_jade_karst_0'],
    distant: ['arena_jade_far_pine_0', 'arena_jade_far_karst_0', 'arena_jade_far_pine_0'],
    under: ['arena_jade_grass_0', 'arena_jade_boulder_1', 'arena_jade_grass_0', 'arena_jade_fern_0'],
    low: ['arena_jade_grass_0'],
    from: 4,
    share: 0.16,
  },
  horizon: ['arena_jade_pine_0'],
};

/**
 * The terraces gone over: the same treads in dead grey-gold on darker stone, the tea bare in its
 * rows, the paddies black and still, the torn torii at the head of the slope, withered bamboo and
 * ghost pines on the shelves, cold lanterns and wisps.
 */
const HAUNTED_JADE_TERRACE: SceneryKit = {
  canopy: ['arena_jade_ghost_pine_0', 'arena_jade_withered_bamboo_1', 'arena_jade_ghost_pine_0'],
  thicket: [
    'arena_jade_dead_tea_0', 'arena_jade_still_paddy_0', 'arena_jade_dead_fern_0', 'arena_jade_pale_boulder_0',
  ],
  ground: ['arena_jade_ghost_moss_0'],
  focal: [
    { key: 'arena_jade_torn_torii_0', tier: 'canopy', count: 1, depth: 2, bearing: -Math.PI / 2 },
    { key: 'arena_jade_wisp_0', tier: 'canopy', count: 2, depth: 3 },
    { key: 'arena_jade_cold_lantern_0', tier: 'thicket', count: 2, depth: 2 },
  ],
  hills: {
    ...JADE_TERRACE_HILLS,
    turf: ['#6f6a52', '#615d48', '#6a6450', '#5c5a4a'],
    earth: '#3c3426',
    rock: '#6a6458',
    terrace: {
      ...JADE_TERRACE_HILLS.terrace!,
      stone: ['#6e6858', '#787262', '#625d4c', '#7e7866'],
      joint: '#2e2a22',
      paddy: '#2e3c3c',
      rows: { keys: ['arena_jade_dead_tea_0'], every: 1.6, share: 0.45, reach: 30 },
    },
  },
  enclosure: 0.3,
  framingDepth: 4,
  haze: GHOST_HAZE,
  fill: {
    far: ['arena_jade_ghost_pine_0', 'arena_jade_withered_bamboo_1', 'arena_jade_dead_karst_0'],
    distant: ['arena_jade_far_ghost_pine_0', 'arena_jade_far_dead_karst_0', 'arena_jade_far_withered_bamboo_0'],
    under: ['arena_jade_dead_fern_0', 'arena_jade_snapped_culms_0', 'arena_jade_pale_boulder_0', 'arena_jade_dead_fern_0'],
    low: ['arena_jade_ghost_moss_0'],
    clump: 3,
    from: 4,
    share: 0.16,
  },
  horizon: ['arena_jade_far_dead_karst_0'],
};

const RIDGE_LEVEL = [
  'arena_jade_flags_0', 'arena_jade_lantern_0', 'arena_jade_cold_lantern_0', 'arena_jade_charm_post_0', 'arena_jade_wisp_0',
];

/** The karst a ridge's land climbs up behind, so a tower stands out of the slope rather than in front of it. */
const KARST_BACKS: HillBack[] = [
  { key: 'arena_jade_karst_0', height: 3.6, reach: 2.2, width: 1.7 },
  { key: 'arena_jade_dead_karst_0', height: 3.6, reach: 2.2, width: 1.7 },
];

/**
 * The mist ridge's land: steep, high blocky hills on all three sides in the ridge's lichen greens
 * over blue-grey rock, knolls and saddles at several heights, the karst towers set into the slope.
 */
const JADE_RIDGE_HILLS: HillSpec = {
  rises: [
    { bearing: -Math.PI / 2, sweep: 2.6, height: 9.5, from: 2.4, run: 7 },
    { bearing: Math.PI, sweep: 2.4, height: 7.6, run: 6 },
    { bearing: 0.05, sweep: 2.4, height: 8.2, run: 6 },
  ],
  from: 2.2,
  run: 7,
  relief: 0.7,
  backs: KARST_BACKS,
  level: RIDGE_LEVEL,
  turf: ['#6b7d5a', '#5f7052', '#73805e', '#66745a'],
  earth: '#4c4a3c',
  rock: '#8f979a',
};

/**
 * The pass on the ridge: prayer flags slung over a saddle, a cairn of the range's stone at their foot
 * and a lantern for the road. Haunted, charms hang where the flags were and the lantern stands cold.
 */
function ridgePass(haunted: boolean): FocalGroup {
  return {
    bearing: -1.25,
    depth: 3,
    pieces: haunted
      ? [
        { key: 'arena_jade_charm_post_0', tier: 'thicket', across: -1.0, along: 0 },
        { key: 'arena_jade_charm_post_0', tier: 'thicket', across: 1.2, along: 0.3, turn: 0.6 },
        { key: 'arena_jade_cold_lantern_0', tier: 'thicket', across: 0.1, along: -0.9 },
        { key: 'arena_jade_pale_boulder_0', tier: 'thicket', across: -2.1, along: 0.9 },
        { key: 'arena_jade_scree_0', tier: 'ground', across: 1.9, along: -0.5 },
      ]
      : [
        { key: 'arena_jade_flags_0', tier: 'canopy', across: 0, along: 0.2 },
        { key: 'arena_jade_boulder_0', tier: 'thicket', across: -1.4, along: -0.4 },
        { key: 'arena_jade_boulder_1', tier: 'thicket', across: -0.6, along: -0.9 },
        { key: 'arena_jade_lantern_0', tier: 'thicket', across: 1.4, along: -0.7 },
        { key: 'arena_jade_scree_0', tier: 'ground', across: 0.4, along: -1.3 },
      ],
  };
}

/**
 * The mist ridge: steep rock hills climbing on three sides with karst towers standing out of them,
 * wind pines loose on the slopes, a pass with prayer flags behind the board, and the pale blue mist
 * close in. High ground under sky, where the moss valley is low ground under it.
 */
const JADE_RIDGE: SceneryKit = {
  canopy: ['arena_jade_pine_0', 'arena_jade_pine_1', 'arena_jade_pine_1'],
  thicket: ['arena_jade_boulder_0', 'arena_jade_boulder_1', 'arena_jade_fern_0'],
  ground: ['arena_jade_scree_0', 'arena_jade_moss_0'],
  groups: [ridgePass(false)],
  focal: [
    { key: 'arena_jade_karst_0', tier: 'canopy', count: 1, depth: 3, bearing: -2.45 },
    { key: 'arena_jade_karst_0', tier: 'canopy', count: 1, depth: 4, bearing: -0.2 },
    { key: 'arena_jade_karst_0', tier: 'canopy', count: 1, depth: 3, bearing: 2.75 },
  ],
  hills: JADE_RIDGE_HILLS,
  enclosure: 0.35,
  framingDepth: 4,
  haze: { color: '#b8c4cc', near: 32, far: 56 },
  fill: {
    far: ['arena_jade_pine_0', 'arena_jade_karst_0', 'arena_jade_pine_1', 'arena_jade_karst_1'],
    distant: ['arena_jade_far_karst_0', 'arena_jade_far_pine_0', 'arena_jade_far_karst_0'],
    under: ['arena_jade_boulder_0', 'arena_jade_boulder_1', 'arena_jade_fern_0', 'arena_jade_scree_0'],
    low: ['arena_jade_scree_0', 'arena_jade_moss_0'],
    clump: 2,
    from: 4,
    share: 0.45,
  },
  horizon: ['arena_jade_karst_1'],
};

/** The ridge gone over: the same steep land in cold greys, dark karst, ghost pines and withered stands, wisps. */
const HAUNTED_JADE_RIDGE: SceneryKit = {
  canopy: ['arena_jade_ghost_pine_0', 'arena_jade_withered_bamboo_1', 'arena_jade_ghost_pine_0'],
  thicket: ['arena_jade_pale_boulder_0', 'arena_jade_dead_fern_0', 'arena_jade_snapped_culms_0'],
  ground: ['arena_jade_scree_0', 'arena_jade_ghost_moss_0'],
  groups: [ridgePass(true)],
  focal: [
    { key: 'arena_jade_dead_karst_0', tier: 'canopy', count: 1, depth: 3, bearing: -2.45 },
    { key: 'arena_jade_dead_karst_0', tier: 'canopy', count: 1, depth: 4, bearing: -0.2 },
    { key: 'arena_jade_dead_karst_0', tier: 'canopy', count: 1, depth: 3, bearing: 2.75 },
    { key: 'arena_jade_wisp_0', tier: 'canopy', count: 2, depth: 2 },
  ],
  hills: {
    ...JADE_RIDGE_HILLS,
    turf: ['#4e5852', '#47504c', '#535c56'],
    earth: '#33312a',
    rock: '#5f676a',
  },
  enclosure: 0.35,
  framingDepth: 4,
  haze: GHOST_HAZE,
  fill: {
    far: ['arena_jade_dead_karst_0', 'arena_jade_ghost_pine_0', 'arena_jade_withered_bamboo_1', 'arena_jade_ghost_pine_0'],
    distant: ['arena_jade_far_dead_karst_0', 'arena_jade_far_ghost_pine_0', 'arena_jade_far_dead_karst_0'],
    under: ['arena_jade_pale_boulder_0', 'arena_jade_dead_fern_0', 'arena_jade_scree_0', 'arena_jade_dead_fern_0'],
    low: ['arena_jade_scree_0', 'arena_jade_ghost_moss_0'],
    clump: 3,
    from: 4,
    share: 0.45,
  },
  horizon: ['arena_jade_far_dead_karst_0'],
};

/**
 * The crown's land: violet rock climbing on both flanks, snow and cloud on the tops above seven
 * units, the crags set into it; behind the board the land falls away to the cloud sea (the `shelf`
 * below), so the crown reads as the top of the range rather than another ridge.
 */
const JADE_CROWN_HILLS: HillSpec = {
  rises: [
    { bearing: Math.PI - 0.15, sweep: 2.4, height: 9.6, from: 2.2, run: 5 },
    { bearing: 0.15, sweep: 2.4, height: 8.6, from: 2.2, run: 5 },
  ],
  from: 2.4,
  run: 6,
  relief: 0.6,
  backs: [
    { key: 'arena_jade_crag_0', height: 3.8, reach: 2.2, width: 1.8 },
    { key: 'arena_jade_dead_crag_0', height: 3.8, reach: 2.2, width: 1.8 },
  ],
  level: RIDGE_LEVEL,
  turf: ['#5e5a66', '#6a6574', '#57535f'],
  earth: '#46404e',
  rock: '#6d6878',
  snow: { above: 7, color: '#e3e7ec' },
};

/**
 * The crown's drop: past the far end of the board the land falls away into cloud, crags and towers
 * standing out of it and a line of them further off, their crowns below the fight's feet.
 */
function crownShelf(lower: string, face: string, keys: string[]): ShelfSpec {
  return {
    edges: [{ bearing: -Math.PI / 2, sweep: 2.0, radius: 11.6 }],
    drop: 9,
    steps: 4,
    tread: 1,
    face,
    lower,
    below: { keys, count: 20, crest: { bearing: -Math.PI / 2, sweep: 1.1, distance: 16, count: 14 } },
  };
}

/** The storm-worn crags at the head of the crown, flags torn by wind between them. */
function crownCrest(haunted: boolean): FocalGroup {
  const crag = haunted ? 'arena_jade_dead_crag_0' : 'arena_jade_crag_0';
  return {
    bearing: -2.5,
    depth: 3,
    pieces: [
      { key: crag, tier: 'canopy', across: -1.8, along: 0.6, turn: 0.4 },
      { key: crag, tier: 'canopy', across: 1.9, along: 0.9, turn: -0.5, scale: 0.86 },
      haunted
        ? { key: 'arena_jade_wisp_0', tier: 'canopy', across: 0, along: 0 }
        : { key: 'arena_jade_flags_0', tier: 'canopy', across: 0, along: 0.1 },
      { key: haunted ? 'arena_jade_pale_boulder_0' : 'arena_jade_boulder_0', tier: 'thicket', across: 0.6, along: -0.9 },
      { key: 'arena_jade_scree_0', tier: 'ground', across: -0.6, along: -1.1 },
    ],
  };
}

/**
 * away past the far end of the board into the cloud sea with crags standing out of it, a pine or two
 * away in front and to the right into the cloud sea with crags standing out of it, a pine or two
 * clinging on, flags at the head of the crown. The top of the range.
 */
const JADE_CROWN: SceneryKit = {
  canopy: ['arena_jade_crag_0', 'arena_jade_crag_0', 'arena_jade_pine_1'],
  thicket: ['arena_jade_boulder_1', 'arena_jade_boulder_0'],
  ground: ['arena_jade_scree_0'],
  groups: [crownCrest(false)],
  focal: [{ key: 'arena_jade_crag_0', tier: 'canopy', count: 1, depth: 3, bearing: 2.7 }],
  hills: JADE_CROWN_HILLS,
  shelf: crownShelf('#dfe4ea', '#4f4a58', ['arena_jade_far_crag_0', 'arena_jade_far_karst_0']),
  enclosure: 0.4,
  framingDepth: 5,
  haze: { color: '#a9a3b6', near: 36, far: 66 },
  fill: {
    far: ['arena_jade_crag_0', 'arena_jade_pine_1', 'arena_jade_crag_1'],
    distant: ['arena_jade_far_crag_0', 'arena_jade_far_crag_0', 'arena_jade_far_pine_0'],
    under: ['arena_jade_boulder_1', 'arena_jade_boulder_0', 'arena_jade_scree_0'],
    low: ['arena_jade_scree_0'],
    // The cloud sea below the drop takes cloud banks where the rock takes boulders
    below: { under: ['arena_jade_cloud_0', 'arena_jade_cloud_0', 'arena_jade_cloud_1'], low: ['arena_jade_cloud_1'] },
    from: 4,
    share: 0.45,
    deeper: 12,
  },
  horizon: ['arena_jade_crag_1'],
  // Bare rock in front of the board: scree strewn there read as pale litter between camera and fight
  openGround: CAVE_FRONT,
};

/** The crown gone over: the rock cold teal-grey, the cloud below it dark, wisps on the crest and among the crags. */
const HAUNTED_JADE_CROWN: SceneryKit = {
  canopy: ['arena_jade_dead_crag_0', 'arena_jade_ghost_pine_0', 'arena_jade_dead_crag_0'],
  thicket: ['arena_jade_pale_boulder_0', 'arena_jade_dead_fern_0'],
  ground: ['arena_jade_scree_0'],
  groups: [crownCrest(true)],
  focal: [
    { key: 'arena_jade_dead_crag_0', tier: 'canopy', count: 1, depth: 3, bearing: 2.7 },
    { key: 'arena_jade_wisp_0', tier: 'canopy', count: 2, depth: 2 },
    { key: 'arena_jade_cold_lantern_0', tier: 'thicket', count: 1, depth: 2, bearing: -0.6 },
  ],
  hills: {
    ...JADE_CROWN_HILLS,
    turf: ['#4e5856', '#465050'],
    earth: '#2f3533',
    rock: '#59625f',
    snow: { above: 7, color: '#9aa6a4' },
  },
  shelf: crownShelf('#7c8886', '#3a403f', ['arena_jade_far_dead_crag_0', 'arena_jade_far_dead_karst_0']),
  enclosure: 0.4,
  framingDepth: 5,
  haze: GHOST_HAZE,
  fill: {
    far: ['arena_jade_dead_crag_0', 'arena_jade_ghost_pine_0', 'arena_jade_dead_crag_0'],
    distant: ['arena_jade_far_dead_crag_0', 'arena_jade_far_dead_crag_0', 'arena_jade_far_ghost_pine_0'],
    under: ['arena_jade_pale_boulder_0', 'arena_jade_dead_fern_0', 'arena_jade_scree_0'],
    low: ['arena_jade_scree_0'],
    below: { under: ['arena_jade_cloud_0', 'arena_jade_cloud_1'], low: ['arena_jade_cloud_1'] },
    from: 4,
    share: 0.45,
    deeper: 12,
  },
  horizon: ['arena_jade_far_dead_crag_0'],
  openGround: CAVE_FRONT,
};

/**
 * A shrine's courtyard, where its keepers are fought: the shrine at the far end behind its
 * torii, stone lanterns in pairs and a censer before it, a bell frame to one side, laid flags
 * under it all. The same precinct in every band; the country round it is the band's.
 */
const SHRINE_PRECINCT: FocalGroup = {
  bearing: -Math.PI / 2,
  depth: 3,
  pieces: [
    { key: 'arena_jade_shrine_0', tier: 'canopy', across: 0, along: 2.0 },
    { key: 'arena_jade_torii_0', tier: 'canopy', across: 0, along: -0.4 },
    { key: 'arena_jade_lantern_0', tier: 'thicket', across: -2.1, along: 0.4 },
    { key: 'arena_jade_lantern_0', tier: 'thicket', across: 2.1, along: 0.4 },
    { key: 'arena_jade_censer_0', tier: 'thicket', across: 0, along: 0.9 },
    { key: 'arena_jade_bell_0', tier: 'canopy', across: 4.2, along: 1.4, turn: -0.4 },
    { key: 'arena_jade_paving_0', tier: 'ground', across: -0.8, along: 0.6 },
    { key: 'arena_jade_paving_0', tier: 'ground', across: 0.8, along: 1.4, turn: 0.5 },
    { key: 'arena_jade_paving_0', tier: 'ground', across: 0.1, along: -1.4, turn: 0.2 },
    { key: 'arena_jade_paving_0', tier: 'ground', across: -0.2, along: -2.4, turn: 0.8 },
  ],
};

/** Every piece of the precinct, and the band's own landmarks: the land keeps them level. */
const PRECINCT_LEVEL = [
  'arena_jade_shrine_0', 'arena_jade_torii_0', 'arena_jade_lantern_0', 'arena_jade_censer_0',
  'arena_jade_bell_0', 'arena_jade_flags_0',
];

/** What every courtyard shares: the precinct, the paving underfoot, the lanterns in pairs at the rim. */
const COURT_BASE = {
  groups: [SHRINE_PRECINCT],
  focal: [
    { key: 'arena_jade_lantern_0', tier: 'thicket' as const, count: 2, depth: 2, bearing: -2.6 },
    { key: 'arena_jade_lantern_0', tier: 'thicket' as const, count: 2, depth: 2, bearing: -0.55 },
  ],
  framingDepth: 4,
};

/**
 * Band 1, the Yokai's shrine low in the forest: moss and fern round the paving, bamboo and pines
 * close about it on low moss banks, the grove's culms past them.
 */
const SHRINE_FOREST: SceneryKit = {
  ...COURT_BASE,
  groundCover: ['arena_jade_moss_0'],
  cover: { threshold: 0.45 },
  canopy: ['arena_jade_bamboo_0', 'arena_jade_pine_1', 'arena_jade_bamboo_1', 'arena_jade_bamboo_0'],
  thicket: ['arena_jade_fern_0', 'arena_jade_shoots_0', 'arena_jade_boulder_1', 'arena_jade_fern_0'],
  ground: ['arena_jade_paving_0', 'arena_jade_moss_0', 'arena_jade_moss_0'],
  hills: { ...GROVE_HILLS, level: PRECINCT_LEVEL },
  enclosure: 0.6,
  haze: jadeHaze('#9fae96'),
  fill: {
    far: ['arena_jade_bamboo_0', 'arena_jade_bamboo_1', 'arena_jade_pine_1'],
    distant: ['arena_jade_far_bamboo_0', 'arena_jade_far_bamboo_0', 'arena_jade_far_pine_0'],
    under: ['arena_jade_fern_0', 'arena_jade_shoots_0', 'arena_jade_boulder_1'],
    low: ['arena_jade_moss_0'],
    from: 4,
    share: 0.55,
  },
};

/**
 * Band 2, the Fallen Order's shrine on the terraces: the courtyard at the foot of the treads, tea in
 * rows on them, gold grass round the paving, a few pines on the shelves.
 */
const SHRINE_TERRACE: SceneryKit = {
  ...COURT_BASE,
  groundCover: ['arena_jade_grass_0', 'arena_jade_grass_0', 'arena_jade_moss_0'],
  cover: { threshold: 0.45 },
  canopy: ['arena_jade_pine_0', 'arena_jade_pine_1'],
  thicket: ['arena_jade_tea_0', 'arena_jade_tea_0', 'arena_jade_paddy_0', 'arena_jade_boulder_1'],
  ground: ['arena_jade_paving_0', 'arena_jade_grass_0'],
  hills: { ...JADE_TERRACE_HILLS, level: PRECINCT_LEVEL },
  enclosure: 0.3,
  haze: jadeHaze('#c9c09a'),
  fill: {
    far: ['arena_jade_pine_0', 'arena_jade_pine_1', 'arena_jade_karst_0'],
    distant: ['arena_jade_far_pine_0', 'arena_jade_far_karst_0'],
    under: ['arena_jade_grass_0', 'arena_jade_terrace_wall_0', 'arena_jade_boulder_1'],
    low: ['arena_jade_grass_0'],
    from: 4,
    share: 0.16,
  },
};

/**
 * Band 3, the Host's lower shrine on the mist ridge: the courtyard among steep rock hills with karst
 * set into them, prayer flags strung over the precinct and on the slopes, scree and lichen round the
 * paving.
 */
const SHRINE_RIDGE: SceneryKit = {
  ...COURT_BASE,
  focal: [
    ...COURT_BASE.focal,
    { key: 'arena_jade_flags_0', tier: 'canopy', count: 3, depth: 3 },
    { key: 'arena_jade_karst_0', tier: 'canopy', count: 1, depth: 4, bearing: -2.3 },
    { key: 'arena_jade_karst_0', tier: 'canopy', count: 1, depth: 4, bearing: -0.4 },
  ],
  canopy: ['arena_jade_pine_0', 'arena_jade_pine_1', 'arena_jade_flags_0'],
  thicket: ['arena_jade_boulder_0', 'arena_jade_boulder_1', 'arena_jade_fern_0'],
  ground: ['arena_jade_paving_0', 'arena_jade_scree_0', 'arena_jade_moss_0'],
  hills: { ...JADE_RIDGE_HILLS, level: PRECINCT_LEVEL },
  enclosure: 0.35,
  haze: { color: '#b8c4cc', near: 32, far: 56 },
  fill: {
    far: ['arena_jade_pine_0', 'arena_jade_karst_0', 'arena_jade_flags_0', 'arena_jade_pine_1'],
    distant: ['arena_jade_far_karst_0', 'arena_jade_far_pine_0'],
    under: ['arena_jade_boulder_0', 'arena_jade_boulder_1', 'arena_jade_scree_0'],
    low: ['arena_jade_scree_0', 'arena_jade_moss_0'],
    clump: 2,
    from: 4,
    share: 0.4,
  },
};

/**
 * Band 4, the Host's high shrine on the storm crown, the last before the summit: violet crags round
 * the courtyard with snow on their tops, bell frames hung against the storm on the crown's shoulders,
 * a pine clinging on, nothing soft.
 */
const SHRINE_CROWN: SceneryKit = {
  ...COURT_BASE,
  focal: [
    ...COURT_BASE.focal,
    { key: 'arena_jade_bell_0', tier: 'canopy', count: 1, depth: 3, bearing: -2.55 },
    { key: 'arena_jade_bell_0', tier: 'canopy', count: 1, depth: 4, bearing: 2.9 },
    { key: 'arena_jade_crag_0', tier: 'canopy', count: 1, depth: 4, bearing: -0.3 },
    { key: 'arena_jade_crag_0', tier: 'canopy', count: 1, depth: 4, bearing: -2.95 },
  ],
  canopy: ['arena_jade_crag_0', 'arena_jade_crag_0', 'arena_jade_pine_1'],
  thicket: ['arena_jade_boulder_1', 'arena_jade_boulder_0'],
  ground: ['arena_jade_paving_0', 'arena_jade_scree_0'],
  hills: {
    ...JADE_CROWN_HILLS,
    rises: [...JADE_CROWN_HILLS.rises],
    level: PRECINCT_LEVEL,
  },
  enclosure: 0.4,
  haze: { color: '#a9a3b6', near: 36, far: 66 },
  fill: {
    far: ['arena_jade_crag_0', 'arena_jade_pine_1', 'arena_jade_crag_1'],
    distant: ['arena_jade_far_crag_0', 'arena_jade_far_crag_0', 'arena_jade_far_pine_0'],
    under: ['arena_jade_boulder_1', 'arena_jade_boulder_0', 'arena_jade_scree_0'],
    low: ['arena_jade_scree_0'],
    clump: 2,
    from: 4,
    share: 0.4,
  },
  horizon: ['arena_jade_crag_1'],
};

/** The Silk Hollow's walls: dark bamboo root and earth, moss on its faces, silk caught in it. */
const CAVE_SILK: HillSpec = {
  rises: caveRises(15),
  from: 2.6,
  run: 2.4,
  relief: 0.35,
  // Her nest and the webs at the head of the Hollow keep the floor they stand on
  level: ['arena_jade_silk_nest_0', 'arena_jade_web_0', 'lair_foxfire_lantern'],
  turf: ['#3a4a2a', '#344428', '#40502e'],
  earth: '#2e2416',
  rock: '#24301c',
  cave: {
    wall: 1.2,
    ceiling: 11,
    stone: ['#1e2818', '#24301c', '#2e3a22', '#3a2c1c', '#34402a'],
    // Root, pale silk caught in the rock, and earth
    veins: { colors: ['#4e6a34', '#c4bfae', '#5e4a30'], share: 0.1 },
  },
};

/**
 * The head of the Hollow: her nest, a web strung either side of it, cocoons at its foot, and foxfire
 * lanterns the Yokai hung — the Hollow's one light, cold and pale.
 */
const WEAVER_NEST: FocalGroup = {
  bearing: -Math.PI / 2,
  depth: 3,
  pieces: [
    { key: 'arena_jade_silk_nest_0', tier: 'canopy', across: 0, along: 0.8 },
    { key: 'arena_jade_web_0', tier: 'canopy', across: -2.6, along: 0.3, turn: 0.35 },
    { key: 'arena_jade_web_0', tier: 'canopy', across: 2.7, along: 0.5, turn: -0.4 },
    { key: 'arena_jade_cocoons_0', tier: 'thicket', across: -1.2, along: -0.9 },
    { key: 'lair_cocoon', tier: 'thicket', across: 1.4, along: -1.0, turn: 0.8 },
    { key: 'lair_foxfire_lantern', tier: 'thicket', across: -3.8, along: -0.8 },
    { key: 'lair_foxfire_lantern', tier: 'thicket', across: 3.9, along: -0.6, turn: Math.PI },
    { key: 'arena_jade_silk_drape_0', tier: 'ground', across: 0.2, along: -1.8 },
  ],
};

/**
 * The Silk Hollow: a hollow in the bamboo walled in dark root, where the Jorogumo weaves. Living and
 * withered culms with webs strung between them, cocoons of what she caught standing and hung, her nest
 * at the head, silk laid over ghost moss, and foxfire for light. No generic dungeon scatter.
 */
const SILK_HOLLOW: SceneryKit = {
  canopy: [
    'arena_jade_bamboo_1', 'arena_jade_web_0', 'arena_jade_withered_bamboo_0', 'arena_jade_cocoon_stake_0',
    'arena_jade_withered_bamboo_1', 'arena_jade_bamboo_1',
  ],
  thicket: [
    'arena_jade_cocoons_0', 'lair_cocoon', 'lair_moss_fern', 'arena_jade_fern_0', 'arena_jade_snapped_culms_0',
    'arena_jade_shoots_0', 'arena_jade_charm_post_0', 'lair_cocoon',
  ],
  ground: ['arena_jade_silk_drape_0', 'arena_jade_ghost_moss_0', 'arena_jade_moss_0'],
  horizon: null,
  hills: CAVE_SILK,
  groups: [WEAVER_NEST],
  focal: [
    { key: 'lair_foxfire_lantern', tier: 'thicket', count: 2, depth: 2 },
    { key: 'arena_jade_wisp_0', tier: 'canopy', count: 2, depth: 2 },
    { key: 'arena_jade_web_0', tier: 'canopy', count: 2, depth: 2, bearing: Math.PI },
    { key: 'arena_jade_web_0', tier: 'canopy', count: 1, depth: 2, bearing: 0.1 },
    { key: 'arena_jade_cocoon_stake_0', tier: 'canopy', count: 2, depth: 1 },
    // The floor beside the board: what she caught, and moss and fern heaped at the rock's foot
    { key: 'arena_jade_cocoons_0', tier: 'thicket', count: 3, depth: 1 },
    { key: 'lair_moss_fern', tier: 'thicket', count: 3, depth: 1 },
  ],
  enclosure: 0.8,
  fill: {
    far: ['arena_jade_web_0', 'arena_jade_withered_bamboo_1', 'arena_jade_bamboo_1', 'arena_jade_cocoon_stake_0'],
    under: ['arena_jade_cocoons_0', 'lair_moss_fern', 'arena_jade_fern_0', 'lair_cocoon', 'arena_jade_snapped_culms_0'],
    low: ['arena_jade_silk_drape_0', 'arena_jade_ghost_moss_0'],
    from: 3,
    share: 0.4,
  },
  openGround: CAVE_FRONT,
};

/**
 * The Silent Hall's walls: the mountain's dark granite in beds, its cut faces pale grey, climbing
 * behind the hall's paper screens so the screens are the face of masonry that leaves the frame.
 */
const CAVE_HALL: HillSpec = {
  rises: caveRises(14),
  from: 3.6,
  run: 2.0,
  relief: 0.25,
  backs: ['arena_jade_hall_screen_0', 'lair_hall_seat'].map((key) => ({ key, height: 4.2, reach: 2.6, width: 1.5 })),
  level: [
    'arena_jade_hall_screen_0', 'lair_hall_seat', 'arena_jade_bell_0', 'arena_jade_shrine_0', 'arena_jade_hall_pillar_0',
  ],
  turf: ['#3a404a', '#343a44', '#40464f'],
  earth: '#292e36',
  rock: '#5c6470',
  cave: {
    wall: 1.2,
    ceiling: 11,
    stone: ['#292e36', '#323842', '#3c424c', '#4a505a', '#5c6470'],
    veins: { colors: ['#8a94a2', '#1c2026', '#5f6b78'], share: 0.08 },
  },
};

/**
 * The hall's head: the master's seat with its red hanging, the bell frame and the shrine either
 * side, censers and lanterns before them, his defaced statues flanking the dais.
 */
const HALL_ALTAR: FocalGroup = {
  bearing: -Math.PI / 2,
  depth: 3,
  pieces: [
    { key: 'lair_hall_seat', tier: 'canopy', across: 0, along: 0.9 },
    { key: 'arena_jade_bell_0', tier: 'canopy', across: 3.4, along: 0.9, turn: -0.3 },
    { key: 'arena_jade_shrine_0', tier: 'canopy', across: -3.3, along: 0.8, turn: 0.3 },
    { key: 'arena_jade_censer_0', tier: 'thicket', across: -0.9, along: -0.6 },
    { key: 'arena_jade_censer_0', tier: 'thicket', across: 0.9, along: -0.6 },
    { key: 'lair_hall_statue', tier: 'thicket', across: -1.9, along: 0.1, turn: 0.2 },
    { key: 'lair_hall_statue', tier: 'thicket', across: 1.9, along: 0.1, turn: -0.2 },
    { key: 'lair_hall_mats', tier: 'canopy', across: 0, along: -1.6 },
  ],
};

/**
 * The Silent Hall: a temple hall cut into the mountain. Lacquered pillars down its sides on a beat,
 * paper screens between the granite and the floor, the master's seat at the head with the bell and
 * the shrine either side of it, stone lanterns, censers, prayer mats and the defaced masters standing
 * about the boards. No generic dungeon scatter.
 */
const SILENT_HALL: SceneryKit = {
  canopy: ['lair_hall_bell', 'arena_jade_shrine_0'],
  thicket: [
    'lair_hall_statue', 'lair_hall_mats', 'arena_jade_censer_0', 'lair_hall_lamp', 'lair_hall_screen',
    'arena_jade_lantern_0', 'lair_hall_mats',
  ],
  ground: ['arena_jade_paving_0', 'arena_jade_paving_0'],
  horizon: null,
  hills: CAVE_HALL,
  groups: [HALL_ALTAR],
  // The screens are the hall's walls on its flanks and back corners; the head is the altar's
  wall: {
    keys: ['arena_jade_hall_screen_0'],
    depth: 3,
    arcs: [
      { bearing: Math.PI, sweep: 1.4 },
      { bearing: 0, sweep: 1.4 },
      { bearing: -2.45, sweep: 0.7 },
      { bearing: -0.7, sweep: 0.7 },
    ],
  },
  colonnade: { keys: ['arena_jade_hall_pillar_0'], depth: 2, beat: 3 },
  focal: [{ key: 'lair_hall_lamp', tier: 'thicket', count: 4, depth: 1 }],
  enclosure: 0.2,
  fill: {
    far: ['lair_hall_bell', 'arena_jade_shrine_0'],
    under: ['lair_hall_statue', 'lair_hall_mats', 'arena_jade_censer_0', 'lair_hall_lamp'],
    low: [],
    from: 3,
    share: 0.25,
  },
  openGround: CAVE_FRONT,
};

// ── Jadeveil: Kairen's summit ────────────────────────────────────────────────

/**
 * The Cloud Crown: a karst summit above the cloud sea, Kairen's arena
 * (the private project notes, *Board presence and arena*).
 *
 * **The whole board is a peak top.** The land falls away on every bearing — four
 * sectors meeting all round, the lip just outside the playable hexes — so the fight
 * stands on the one flat of a summit and the cliff is the arena's edge, which is also
 * where a push stops. Below it is not a valley but the **cloud sea**: the lower country
 * is the pale grey-white of cloud seen from above, the haze the same cold pale, and the
 * only things standing in it are karst towers — the range's own crags, spread round
 * every sector, their crowns below the fight's feet. No river, no forest floor: a few
 * wind-bent pines and boulders on the rock, and the storm-worn spires at the back.
 */
/** The crown's storm-worn spires on the rim; Jadeveil's own (`jadeArena.ts`), as everything here is. */
const SUMMIT_SPIRES = ['arena_jade_crag_1', 'arena_jade_crag_0', 'arena_jade_crag_1'];
/** Karst towers standing out of the cloud sea below the summit. */
const SUMMIT_TOWERS = ['arena_jade_karst_1', 'arena_jade_far_karst_0'];

const CLOUD_CROWN: SceneryKit = {
  framingDepth: 5,
  // A few wind-bent pines and the summit's own broken rock, and nothing that grows
  canopy: ['arena_jade_pine_1', 'arena_jade_pine_0'],
  thicket: ['arena_jade_boulder_0', 'arena_jade_boulder_1', 'arena_jade_fern_0'],
  ground: ['arena_jade_scree_0'],
  // Flags at the head of the summit, torn by its wind
  focal: [{ key: 'arena_jade_flags_0', tier: 'canopy', count: 1, depth: 3, bearing: -0.95 }],
  // Out to the camera's reach, which falls away on every bearing and so is seen further off than
  // flat ground: towers and crags standing out of the cloud sea, banks of cloud lying on it, and
  // the peak top's own boulders where the rock still is
  fill: {
    far: ['arena_jade_karst_1', 'arena_jade_crag_1', 'arena_jade_karst_1'],
    distant: ['arena_jade_far_karst_0', 'arena_jade_far_karst_0', 'arena_jade_far_crag_0'],
    under: ['arena_jade_boulder_1', 'arena_jade_boulder_0', 'arena_jade_scree_0'],
    low: ['arena_jade_scree_0'],
    below: { under: ['arena_jade_cloud_0', 'arena_jade_cloud_0', 'arena_jade_cloud_1'], low: ['arena_jade_cloud_1'] },
    from: 4,
    share: 0.3,
    deeper: 16,
    wider: 8,
  },
  // A hard floor's foreground is the floor's own (see `groundCover`): no scatter on bare rock.
  // Past the lip there is only cloud, and the far peaks standing out of it.
  horizon: ['arena_jade_far_karst_0', 'arena_jade_karst_1'],
  enclosure: 0.25,
  // The storm-worn spires of the crown, standing on the rim at the back left — the one
  // bearing the land does not fall away on, so the summit reads as a peak's top with
  // its last crags behind it rather than a plate floating in cloud
  wall: { keys: SUMMIT_SPIRES, depth: 2, arcs: [{ bearing: -2.25, sweep: 1.1 }] },
  quiet: [{ bearing: -0.6, sweep: 2.4, density: 0.35 }],
  // Pale and cold: the cloud the summit stands in, closing over the far towers
  haze: { color: '#d3dae0', near: 32, far: 62 },
  shelf: {
    // Every bearing falls away, the lip a hex of clear ground outside the board; the
    // spires stand inside it at the back left
    edges: [0, 1, 2, 3, 4, 5].map((i) => ({ bearing: -Math.PI / 2 + (i * Math.PI) / 3, sweep: 1.7, radius: 11.6 })),
    drop: 11,
    steps: 5,
    tread: 0.9,
    // Storm-worn granite, well clear of the cloud below it
    face: '#4a4f57',
    // The cloud sea from above
    lower: '#eef2f5',
    // Karst towers standing out of the cloud, their crowns below the fight's feet
    below: { keys: SUMMIT_TOWERS, count: 16 },
  },
};

// ── A held village (playtest 2026-10-28) ────────────────────────────────────

/**
 * The village's two streets, along the board's flanks: cottages fronting the fight with a
 * fence between them and a well on one side. The landscape frame shows the flanks far more
 * than the ground behind the board, so the village stands there, as the siege's terraces do.
 */
const VILLAGE_STREETS: FocalGroup[] = [
  {
    bearing: -0.35,
    depth: 2,
    pieces: [
      { key: 'arena_cottage_0', tier: 'canopy', across: -2.3, along: 0.6 },
      { key: 'arena_cottage_1', tier: 'canopy', across: 0.2, along: 0.9 },
      { key: 'arena_cottage_0', tier: 'canopy', across: 2.7, along: 0.6, turn: 0.2 },
      { key: 'arena_fence_0', tier: 'thicket', across: -1.0, along: -0.2 },
      { key: 'arena_well_0', tier: 'thicket', across: 1.5, along: -0.3 },
    ],
  },
  {
    bearing: Math.PI + 0.35,
    depth: 2,
    pieces: [
      { key: 'arena_cottage_1', tier: 'canopy', across: -2.5, along: 0.6, turn: -0.2 },
      { key: 'arena_cottage_0', tier: 'canopy', across: 0, along: 0.9 },
      { key: 'arena_cottage_1', tier: 'canopy', across: 2.4, along: 0.6 },
      { key: 'arena_fence_0', tier: 'thicket', across: 1.2, along: -0.2 },
      { key: 'arena_crates_0', tier: 'thicket', across: -1.2, along: -0.3 },
    ],
  },
];

/** The occupier's palisade across the back, stakes in short runs with the gaps they left. */
const VILLAGE_PALISADE: FocalGroup = {
  bearing: -Math.PI / 2,
  depth: 3,
  pieces: [-4.8, -3.6, -2.4, 2.4, 3.6, 4.8].map((across) => ({
    key: 'arena_palisade_0', tier: 'thicket' as const, across, along: 0,
  })),
};

/** The landmark on the right flank and the occupier's camp on the left, below the streets, by theme. */
const VILLAGE_LANDMARK: Record<'lookout' | 'trading_post' | 'smithy' | 'shrine', FocalGroup[]> = {
  lookout: [
    { bearing: 0.45, depth: 2, pieces: [
      { key: 'arena_watchtower_0', tier: 'canopy', across: 0, along: 0.6 },
      { key: 'arena_brazier_0', tier: 'canopy', across: -1.5, along: 0.7 },
    ] },
    { bearing: Math.PI - 0.45, depth: 2, pieces: [
      { key: 'arena_tent_0', tier: 'canopy', across: 0, along: 0.4 },
      { key: 'arena_brigand_banner_0', tier: 'canopy', across: 1.5, along: -0.2 },
      { key: 'arena_barricade_0', tier: 'thicket', across: -1.4, along: -0.6, turn: 0.4 },
    ] },
  ],
  trading_post: [
    { bearing: 0.45, depth: 2, pieces: [
      { key: 'arena_market_stall_0', tier: 'canopy', across: -1.0, along: 0.3 },
      { key: 'arena_market_stall_0', tier: 'canopy', across: 1.2, along: 0.5, turn: -0.2 },
      { key: 'arena_crates_0', tier: 'thicket', across: 0, along: -0.8 },
      { key: 'arena_stores_0', tier: 'thicket', across: 2.4, along: -0.4 },
    ] },
    { bearing: Math.PI - 0.45, depth: 2, pieces: [
      { key: 'arena_tent_0', tier: 'canopy', across: 0, along: 0.4 },
      { key: 'arena_brigand_banner_0', tier: 'canopy', across: -1.5, along: -0.2 },
      { key: 'arena_crates_0', tier: 'thicket', across: 1.3, along: -0.5 },
    ] },
  ],
  smithy: [
    { bearing: 0.45, depth: 2, pieces: [
      { key: 'arena_village_forge_0', tier: 'canopy', across: 0, along: 0.4 },
      { key: 'arena_rack_0', tier: 'thicket', across: 1.6, along: -0.2 },
      { key: 'arena_armor_stand_0', tier: 'canopy', across: -1.6, along: -0.3 },
    ] },
    { bearing: Math.PI - 0.45, depth: 2, pieces: [
      { key: 'arena_legion_tent_0', tier: 'canopy', across: 0, along: 0.4 },
      { key: 'arena_banner_0', tier: 'canopy', across: 1.6, along: -0.2 },
    ] },
  ],
  shrine: [
    { bearing: 0.45, depth: 2, pieces: [
      { key: 'arena_village_shrine_0', tier: 'canopy', across: 0, along: 0.5 },
      { key: 'arena_lantern_0', tier: 'canopy', across: -1.2, along: -0.5 },
      { key: 'arena_lantern_0', tier: 'canopy', across: 1.2, along: -0.5 },
    ] },
    { bearing: Math.PI - 0.45, depth: 2, pieces: [
      { key: 'arena_legion_tent_0', tier: 'canopy', across: 0, along: 0.4 },
      { key: 'arena_banner_0', tier: 'canopy', across: -1.6, along: -0.2 },
    ] },
  ],
};

/**
 * A held village's arena, where its garrison is fought (`EncounterContext.site` `village`): the
 * meadow's ground and fill round the village's own lane, its landmark and the occupier's camp.
 */
function villageKit(theme: keyof typeof VILLAGE_LANDMARK): SceneryKit {
  return {
    groundCover: ['arena_grass_0', 'arena_grass_0', 'arena_stones_0', 'arena_flowers_0'],
    canopy: ['arena_oak_0', 'arena_oak_1'],
    thicket: ['arena_bush_0', 'arena_bush_1', 'arena_log_0', 'arena_meadow_0'],
    ground: ['arena_grass_0', 'arena_stones_0', 'arena_flowers_0'],
    cover: { threshold: 0.3, near: 10 },
    groups: [...VILLAGE_STREETS, VILLAGE_PALISADE, ...VILLAGE_LANDMARK[theme]],
    framingDepth: 4,
    enclosure: 0.25,
    fill: {
      far: ['arena_far_house_0', 'arena_far_house_2', 'arena_oak_0', 'arena_oak_1'],
      distant: ['arena_far_oak_0', 'arena_far_house_1', 'arena_far_pine_0'],
      under: ['arena_bush_0', 'arena_bush_1', 'arena_meadow_0'],
      low: ['arena_grass_0'],
      from: 6,
      share: 0.45,
    },
  };
}

// ── The archipelago: its own arenas ─────────────────────────────────────────
//
// From its look bible (the private project notes), dressed only from its own prop kit
// (`voxel/models/isleArena.ts`): three grounds (`isle_beach`, `isle_jungle`, `isle_rock`,
// `EncounterContext.isle`) and seven places, each a site of its own (`deck`, `deck_storm`, `port`,
// `battery`, `pirate_fort`, `lair_hull`, `lair_grotto`). No map sends a fight to them yet; the arena
// preview catalogue lists them, so they are captured and checked now. `archipelagoArenas.test.ts`
// pins that nothing in them is another world's.

/** The islands' sea haze: pale and warm, a long way out. */
const ISLE_HAZE: HazeSpec = { color: '#cfe0dc', near: 40, far: 80 };

/** The sea round the islands, turquoise by the shore; the storm's is dark. */
const ISLE_SEA = '#3fb3c4';
const STORM_SEA = '#2a5a66';

/** The islands' hills: jungle turf over red laterite over basalt. */
const ISLE_HILL_PALETTE: Pick<HillSpec, 'turf' | 'earth' | 'rock'> = {
  turf: ['#4f7a34', '#5a8a3a', '#466e30', '#56743a'],
  earth: '#7a4a2e',
  rock: '#4a4a4e',
};

/** The beach's low dunes on its flanks: sand over darker sand over basalt. */
const BEACH_DUNES: HillSpec = {
  rises: [
    { bearing: Math.PI, sweep: 1.5, height: 1.1, from: 2.6, run: 3.2 },
    { bearing: 0, sweep: 1.5, height: 0.9, from: 2.6, run: 3.2 },
  ],
  from: 2.8,
  run: 3.4,
  relief: 0.5,
  level: ['arena_isle_rowboat_0', 'arena_isle_driftwood_0'],
  turf: ['#dcc690', '#cfb77e', '#d6bf88'],
  earth: '#b39a66',
  rock: '#8c7a58',
};

/** The beach's landmark: a rowboat run aground and half-buried, driftwood heaped by it, a coil of rope. */
const BEACH_LANDING: FocalGroup = {
  bearing: -2.95,
  depth: 2,
  pieces: [
    { key: 'arena_isle_rowboat_0', tier: 'thicket', across: 0, along: 0, turn: 0.5 },
    { key: 'arena_isle_driftwood_0', tier: 'thicket', across: -1.6, along: 0.7 },
    { key: 'arena_isle_driftwood_0', tier: 'thicket', across: 1.4, along: -0.5, turn: 1.4 },
    { key: 'arena_isle_rope_0', tier: 'ground', across: 0.9, along: 0.9 },
    { key: 'arena_isle_rock_1', tier: 'thicket', across: -2.0, along: -0.8 },
    { key: 'arena_isle_shells_0', tier: 'ground', across: 0.3, along: -1.1 },
  ],
};

/**
 * The beach: pale sand open to the sea behind the board and round both back flanks, low dunes on
 * the flanks with palms leaning off them, driftwood, basalt and coral along the waterline, sea
 * stacks out in the water, and a rowboat run aground at the back left.
 */
const ISLE_BEACH: SceneryKit = {
  groundCover: ['arena_isle_shells_0', 'arena_isle_grass_0'],
  cover: { threshold: 0.42 },
  canopy: ['arena_isle_palm_0', 'arena_isle_palm_1', 'arena_isle_palm_0'],
  // Coral and the big basalt keep to the waterline (`water.bank`): on dry sand they read as clutter
  thicket: ['arena_isle_driftwood_0', 'arena_isle_broadleaf_0', 'arena_isle_grass_0', 'arena_isle_rock_1'],
  ground: ['arena_isle_grass_0', 'arena_isle_shells_0'],
  groups: [BEACH_LANDING],
  focal: [
    { key: 'arena_isle_palm_1', tier: 'canopy', count: 1, depth: 2, bearing: 3.0 },
    { key: 'arena_isle_palm_0', tier: 'canopy', count: 1, depth: 2, bearing: 0.15 },
    { key: 'arena_isle_driftwood_0', tier: 'thicket', count: 1, depth: 2, bearing: -0.1 },
  ],
  // The sea behind the board, from the back left round to the back right and out to the haze, its
  // shore two hexes behind the enemy line (the review asked for more of it there, 2026-11-02)
  water: {
    shape: 'course',
    color: ISLE_SEA,
    bank: ['arena_isle_rock_0', 'arena_isle_driftwood_0', 'arena_isle_coral_0', 'arena_isle_rock_1'],
    near: 2, far: 14, bearing: -Math.PI / 2 - 1.3, sweep: 2.6,
  },
  hills: BEACH_DUNES,
  enclosure: 0.25,
  framingDepth: 4,
  haze: ISLE_HAZE,
  fill: {
    far: ['arena_isle_palm_0', 'arena_isle_palm_1', 'arena_isle_rock_0'],
    distant: ['arena_isle_far_palm_0'],
    under: ['arena_isle_grass_0', 'arena_isle_broadleaf_0', 'arena_isle_driftwood_0', 'arena_isle_grass_0'],
    low: ['arena_isle_grass_0'],
    from: 5,
    share: 0.35,
    water: 1,
    afloat: { keys: ['arena_isle_stack_0', 'arena_isle_far_stack_0'], share: 0.06 },
  },
  horizon: ['arena_isle_stack_0'],
};

/** The jungle's hills: high on both flanks and behind, in the islands' palette. */
const JUNGLE_HILLS: HillSpec = {
  rises: [
    { bearing: Math.PI, sweep: 2.2, height: 3.6, from: 2.6, run: 6 },
    { bearing: 0, sweep: 2.2, height: 3.2, from: 2.6, run: 6 },
    { bearing: -Math.PI / 2, sweep: 1.4, height: 2.4 },
  ],
  from: 3,
  run: 7,
  relief: 0.7,
  level: ['arena_isle_idol_0', 'arena_isle_ruin_0', 'arena_isle_ruin_1'],
  ...ISLE_HILL_PALETTE,
};

/** The jungle's landmark: a carved stone head on its plinth, ruin blocks fallen either side, growth round it. */
const JUNGLE_IDOL: FocalGroup = {
  bearing: -Math.PI / 2,
  depth: 3,
  pieces: [
    { key: 'arena_isle_idol_0', tier: 'canopy', across: 0, along: 0 },
    { key: 'arena_isle_ruin_0', tier: 'thicket', across: -2.1, along: -0.5, turn: 0.3 },
    { key: 'arena_isle_ruin_1', tier: 'thicket', across: 1.9, along: -0.3, turn: -0.4 },
    { key: 'arena_isle_bush_0', tier: 'thicket', across: 2.7, along: 0.9 },
    { key: 'arena_isle_broadleaf_0', tier: 'thicket', across: -2.8, along: 0.9 },
    { key: 'arena_isle_litter_0', tier: 'ground', across: 0.3, along: -1.4 },
  ],
};

/**
 * The jungle: closed. Broadleaf trees and palms on every side and climbing the hills of both flanks
 * and behind, elephant-ear and flowering bushes under them, leaf litter on the laterite, and its
 * landmark a carved stone head among fallen ruin blocks at the far end.
 */
const ISLE_JUNGLE: SceneryKit = {
  // Litter is the strewn cover; ferns stand in the ground tier and the fill, where they count once
  groundCover: ['arena_isle_litter_0'],
  cover: { threshold: 0.32 },
  canopy: ['arena_isle_tree_0', 'arena_isle_tree_1', 'arena_isle_palm_0', 'arena_isle_tree_0'],
  thicket: ['arena_isle_broadleaf_0', 'arena_isle_bush_0', 'arena_isle_ruin_1', 'arena_isle_broadleaf_0', 'arena_isle_rock_1'],
  ground: ['arena_isle_litter_0', 'arena_isle_fern_0'],
  groups: [JUNGLE_IDOL],
  focal: [{ key: 'arena_isle_bush_0', tier: 'thicket', count: 2, depth: 2 }],
  hills: JUNGLE_HILLS,
  enclosure: 0.75,
  framingDepth: 4,
  haze: { color: '#9fb89a', near: 34, far: 62 },
  fill: {
    far: ['arena_isle_tree_0', 'arena_isle_tree_1', 'arena_isle_palm_0', 'arena_isle_tree_0'],
    distant: ['arena_isle_far_tree_0', 'arena_isle_far_palm_0', 'arena_isle_far_tree_0'],
    under: ['arena_isle_broadleaf_0', 'arena_isle_bush_0', 'arena_isle_rock_1', 'arena_isle_ruin_1'],
    low: ['arena_isle_fern_0'],
    from: 4,
    share: 0.55,
  },
};

/**
 * The headland's basalt: knolls on both flanks running out to the sea, grey rock through, its growth
 * only in the cracks. Their tops are bluer than the grey they render, as the floor's are.
 */
const HEADLAND_KNOLLS: HillSpec = {
  rises: [
    // The left shoulder, the higher, falling to the sea behind
    { bearing: Math.PI - 0.35, sweep: 1.6, height: 2.6, from: 2.4, run: 3.2 },
    { bearing: 0.35, sweep: 1.6, height: 2.0, from: 2.4, run: 3.2 },
  ],
  from: 2.6,
  run: 3.4,
  relief: 0.7,
  level: ['arena_isle_columns_0', 'arena_isle_columns_1'],
  turf: ['#7e8796', '#747c8a', '#868e9c'],
  earth: '#5e6470',
  rock: '#4c525c',
};

/**
 * The headland's landmark: three stands of basalt columns rising out of the sea at the foot of its
 * left shoulder, a causeway's stumps stepping out to them from the shore. Off the board's left flank,
 * where the landscape frame keeps it clear of the HUD in the opening view and the whole-board one.
 * It stands afloat, so the sea runs round the columns' feet, and the rolled scenery keeps back from
 * it (`ISLE_ROCK.quiet`).
 */
const HEADLAND_COLUMNS: FocalGroup = {
  bearing: 3.1,
  depth: 2,
  afloat: true,
  pieces: [
    { key: 'arena_isle_columns_0', tier: 'canopy', across: 0, along: 0.6 },
    { key: 'arena_isle_columns_0', tier: 'canopy', across: 1.9, along: 1.4, scale: 0.85, turn: -0.4 },
    { key: 'arena_isle_columns_0', tier: 'canopy', across: -1.8, along: 0.2, scale: 0.7, turn: 0.5 },
    { key: 'arena_isle_columns_1', tier: 'thicket', across: -0.6, along: -1.2, turn: 0.3 },
    { key: 'arena_isle_columns_1', tier: 'thicket', across: 1.2, along: -0.9, turn: -0.8 },
    { key: 'arena_isle_columns_1', tier: 'thicket', across: 3.2, along: 0.2, turn: 1.1 },
  ],
};

/**
 * A fight on an island's rock: a grey basalt headland with the sea round its back and both back
 * corners as the beach has it, knolls of the rock on both flanks running out to the water, stands
 * of basalt columns rising out of the sea at the foot of the left one, a causeway's stumps on the
 * right, rock pools, weed and boulders along the waterline, sea stacks and skerries out in the water,
 * and only grass, ferns and a few palms growing in the rock's cracks.
 */
const ISLE_ROCK: SceneryKit = {
  groundCover: ['arena_isle_grass_0', 'arena_isle_grass_0', 'arena_isle_fern_0'],
  cover: { threshold: 0.55 },
  // Nothing tall but a palm here and there: the columns are the landmark, and spires round them read as more
  canopy: ['arena_isle_rock_0', 'arena_isle_rock_0', 'arena_isle_palm_1', 'arena_isle_rock_0'],
  thicket: ['arena_isle_rock_1', 'arena_isle_columns_1', 'arena_isle_rock_0', 'arena_isle_rock_1'],
  ground: ['arena_isle_pool_1', 'arena_isle_grass_0', 'arena_isle_fern_0', 'arena_isle_shells_0'],
  groups: [HEADLAND_COLUMNS],
  quiet: [{ bearing: 3.1, sweep: 0.9, density: 0.15 }],
  focal: [
    { key: 'arena_isle_columns_1', tier: 'thicket', count: 1, depth: 2, bearing: 0.5 },
    { key: 'arena_isle_pool_1', tier: 'ground', count: 2, depth: 1 },
  ],
  // The sea behind the board and round both back corners, its shore two hexes behind the enemy line
  // as the beach's is, and on round the left flank to its middle: the headland narrows to its tip
  water: {
    shape: 'course',
    color: ISLE_SEA,
    bank: ['arena_isle_rock_0', 'arena_isle_pool_1', 'arena_isle_weed_0', 'arena_isle_rock_1'],
    near: 2, far: 14, bearing: 3.0, sweep: 3.21,
  },
  hills: HEADLAND_KNOLLS,
  enclosure: 0.25,
  framingDepth: 4,
  haze: ISLE_HAZE,
  fill: {
    far: ['arena_isle_rock_0', 'arena_isle_columns_1', 'arena_isle_rock_0'],
    distant: ['arena_isle_far_stack_0'],
    under: ['arena_isle_rock_1', 'arena_isle_rock_0', 'arena_isle_columns_1', 'arena_isle_rock_1'],
    low: ['arena_isle_grass_0', 'arena_isle_grass_0', 'arena_isle_fern_0'],
    from: 5,
    share: 0.3,
    water: 1,
    afloat: { keys: ['arena_isle_skerry_0', 'arena_isle_stack_0', 'arena_isle_skerry_0', 'arena_isle_far_stack_0'], share: 0.08 },
  },
  horizon: ['arena_isle_stack_0'],
};

/**
 * The harbour's quay along the shore at the back right: the warehouse, the harbourmaster's house on
 * its stilts and the crane over the water, cargo stacked before them.
 */
const PORT_QUAY: FocalGroup = {
  bearing: -0.8,
  depth: 2,
  pieces: [
    { key: 'arena_isle_warehouse_0', tier: 'canopy', across: -2.6, along: 0.5 },
    { key: 'arena_isle_house_0', tier: 'canopy', across: 0.2, along: 0.8 },
    { key: 'arena_isle_crane_0', tier: 'canopy', across: 2.6, along: 1.0, turn: Math.PI },
    { key: 'arena_isle_crates_0', tier: 'thicket', across: -0.9, along: -0.8 },
    { key: 'arena_isle_barrels_0', tier: 'thicket', across: 1.5, along: -0.7 },
  ],
};

/** The jetty running out from the quay into the harbour, standing in the water, its lamp at the shore end. */
const PORT_JETTY: FocalGroup = {
  bearing: -0.2,
  depth: 3,
  afloat: true,
  pieces: [
    { key: 'arena_isle_jetty_0', tier: 'thicket', across: 0, along: 0, turn: Math.PI / 2 },
    { key: 'arena_isle_jetty_0', tier: 'thicket', across: 0, along: 1.25, turn: Math.PI / 2 },
    { key: 'arena_isle_jetty_0', tier: 'thicket', across: 0, along: 2.5, turn: Math.PI / 2 },
    { key: 'arena_isle_lamp_0', tier: 'thicket', across: 0.8, along: 0.1 },
  ],
};

/** A merchant brig moored in the harbour off the jetty's end, lying along the right flank where the frame sees her. */
const MOORED_BRIG: FocalGroup = {
  bearing: 0.08,
  depth: 4,
  afloat: true,
  pieces: [
    { key: 'arena_isle_ship_aft_0', tier: 'canopy', across: -1.15, along: 0 },
    { key: 'arena_isle_ship_fore_0', tier: 'canopy', across: 1.15, along: 0 },
  ],
};

/** The raiders' two longboats, in the water off the beach at the front right where they came in. */
const RAID_BOATS: FocalGroup = {
  bearing: 0.6,
  depth: 4,
  afloat: true,
  pieces: [
    { key: 'arena_isle_longboat_0', tier: 'canopy', across: -1.0, along: 0.2, turn: 1.2 },
    { key: 'arena_isle_longboat_0', tier: 'canopy', across: 1.4, along: 0.6, turn: 1.9 },
  ],
};

/**
 * A raid on a freed island's port (rebuilt from the review, 2026-11-02: "buildings on the right, and
 * ships on water nearby land"): the beach's sand, the harbour along the right flank, the quay's
 * warehouse, harbourmaster's house and crane along its shore at the back right, a jetty running out
 * into the water, a brig moored off the right flank and the raiders' longboats in the water by the
 * shore at the front right, the island's hut at the back left under palms.
 */
const ISLE_PORT: SceneryKit = {
  groundCover: ['arena_isle_shells_0'],
  cover: { threshold: 0.45 },
  canopy: ['arena_isle_palm_0', 'arena_isle_palm_1'],
  thicket: ['arena_isle_crates_0', 'arena_isle_barrels_0', 'arena_isle_rock_1', 'arena_isle_driftwood_0'],
  ground: ['arena_isle_shells_0', 'arena_isle_rope_0', 'arena_isle_grass_0'],
  groups: [PORT_QUAY, PORT_JETTY, MOORED_BRIG, RAID_BOATS],
  // The quay's side kept clear of rolled palms and cargo, so the harbour reads from the board
  quiet: [{ bearing: -0.3, sweep: 1.9, density: 0 }],
  focal: [
    { key: 'arena_isle_hut_0', tier: 'canopy', count: 1, depth: 3, bearing: -2.35 },
    { key: 'arena_isle_lamp_0', tier: 'thicket', count: 1, depth: 2, bearing: -2.0 },
    { key: 'arena_isle_palm_1', tier: 'canopy', count: 1, depth: 2, bearing: 3.0 },
  ],
  // The harbour: the right flank from its back corner round to the front, four hexes out
  water: {
    shape: 'course',
    color: ISLE_SEA,
    bank: ['arena_isle_rock_1', 'arena_isle_driftwood_0', 'arena_isle_rock_0'],
    near: 4, far: 14, bearing: -1.15, sweep: 2.2,
  },
  hills: BEACH_DUNES,
  enclosure: 0.3,
  framingDepth: 4,
  haze: ISLE_HAZE,
  fill: {
    far: ['arena_isle_palm_0', 'arena_isle_palm_1', 'arena_isle_hut_0', 'arena_isle_palm_0'],
    distant: ['arena_isle_far_palm_0'],
    under: ['arena_isle_crates_0', 'arena_isle_barrels_0', 'arena_isle_broadleaf_0', 'arena_isle_rock_1'],
    low: ['arena_isle_grass_0'],
    from: 5,
    share: 0.35,
    water: 1,
    afloat: { keys: ['arena_isle_far_ship_0', 'arena_isle_far_stack_0'], share: 0.05 },
  },
};

/** The fort's head: the red-sail flag over its cook fire, weapon racks either side, powder by them. */
const FORT_YARD: FocalGroup = {
  bearing: -Math.PI / 2,
  depth: 2,
  pieces: [
    { key: 'arena_isle_flag_0', tier: 'canopy', across: 0, along: 0.3 },
    { key: 'arena_isle_fire_0', tier: 'thicket', across: 0.2, along: -0.9 },
    { key: 'arena_isle_rack_0', tier: 'thicket', across: -2.2, along: 0.2 },
    { key: 'arena_isle_rack_0', tier: 'thicket', across: 2.2, along: 0.2 },
    { key: 'arena_isle_powder_0', tier: 'thicket', across: 3.4, along: -0.2 },
  ],
};

/** The fort's stores along the left palisade: crates stacked, barrels, a coil of rope. */
const FORT_STORES: FocalGroup = {
  bearing: Math.PI - 0.2,
  depth: 2,
  pieces: [
    { key: 'arena_isle_crates_0', tier: 'thicket', across: -1.6, along: 0.3 },
    { key: 'arena_isle_barrels_0', tier: 'thicket', across: 0.2, along: 0.4 },
    { key: 'arena_isle_crates_0', tier: 'thicket', across: 1.9, along: 0.3, turn: 0.4 },
    { key: 'arena_isle_rope_0', tier: 'ground', across: 0.6, along: -0.7 },
  ],
};

/** Its guns on the right, run out over the palisade, powder between them. */
const FORT_GUNS: FocalGroup = {
  bearing: 0.2,
  depth: 2,
  pieces: [
    { key: 'arena_isle_cannon_0', tier: 'thicket', across: -1.6, along: 0.4 },
    { key: 'arena_isle_cannon_0', tier: 'thicket', across: 1.4, along: 0.4 },
    { key: 'arena_isle_powder_0', tier: 'thicket', across: -0.1, along: -0.3 },
  ],
};

/**
 * Inside a pirate fort, laid out by hand (the review, 2026-11-02: "prop placement is weird"): a yard
 * of trodden dirt closed in by a palisade of sharpened logs round the back and both flanks, the
 * red-sail flag over a cook fire at its head between weapon racks, a tent in each back corner, stores
 * along the left palisade, guns on the right run out over it. Nothing is rolled in the yard; past
 * the palisade the island's jungle stands.
 */
const ISLE_PIRATE_FORT: SceneryKit = {
  canopy: [],
  thicket: [],
  // Tufts at the foot of the palisade and round the yard's edges
  ground: ['arena_isle_grass_0'],
  wall: { keys: ['arena_isle_palisade_0'], depth: 3 },
  // Past the palisade, the island's growth, not more yard
  horizon: ['arena_isle_palm_0', 'arena_isle_tree_1'],
  groups: [FORT_YARD, FORT_STORES, FORT_GUNS],
  focal: [
    { key: 'arena_isle_tent_0', tier: 'canopy', count: 1, depth: 2, bearing: -2.55 },
    { key: 'arena_isle_tent_0', tier: 'canopy', count: 1, depth: 2, bearing: -0.6 },
    { key: 'arena_isle_lamp_0', tier: 'thicket', count: 1, depth: 2, bearing: -2.05 },
    { key: 'arena_isle_lamp_0', tier: 'thicket', count: 1, depth: 2, bearing: -1.1 },
  ],
  enclosure: 0.45,
  framingDepth: 4,
  haze: ISLE_HAZE,
  fill: {
    far: ['arena_isle_palm_0', 'arena_isle_palm_1', 'arena_isle_tree_1'],
    distant: ['arena_isle_far_palm_0', 'arena_isle_far_tree_0', 'arena_isle_far_palm_0'],
    under: ['arena_isle_broadleaf_0', 'arena_isle_rock_1', 'arena_isle_bush_0'],
    low: ['arena_isle_grass_0'],
    from: 4,
    share: 0.45,
  },
};

/**
 * The ship alongside, out past the bulwark in the water: five lengths of her hull. No masts over it:
 * the one mast in the frame is the deck's own (the third review, 2026-11-02).
 */
function shipAlongside(): FocalGroup {
  return {
    bearing: -Math.PI / 2,
    depth: 5,
    afloat: true,
    pieces: [-4.4, -2.2, 0, 2.2, 4.4].map((across) => ({ key: 'arena_isle_hull_0', tier: 'canopy' as const, across, along: 0 })),
  };
}

/**
 * The deck's one mast (the third review: "one mast, much bigger, with the step where there is place
 * for a scout"): the lower mast, and its crow's nest and topmast lifted onto it, two pieces so each
 * stays inside the canopy's envelope while the mast stands over five units. On the left of the board,
 * level with its middle: projected through the whole-board camera at the landscape phone, that keeps
 * the crow's nest in the frame and clear of the HUD's title. Further back and the perspective leans
 * the nest out of the frame; further forward and the deck narrows past the bulwark.
 */
const MAIN_MAST: FocalGroup = {
  bearing: Math.PI - 0.105,
  depth: 2,
  pieces: [
    { key: 'arena_isle_mainmast_0', tier: 'canopy', across: 0, along: 0 },
    // The crow's nest and topmast, lifted onto the lower mast's head
    { key: 'arena_isle_masttop_0', tier: 'canopy', across: 0, along: 0, lift: 3.0 },
  ],
};

/** Cargo lashed on the deck: barrels and crates, a coil of rope. */
function deckCargo(bearing: number): FocalGroup {
  return {
    bearing,
    depth: 2,
    pieces: [
      { key: 'arena_isle_barrels_0', tier: 'thicket', across: -0.9, along: 0 },
      { key: 'arena_isle_crates_0', tier: 'thicket', across: 0.9, along: 0.2, turn: 0.3 },
      { key: 'arena_isle_rope_0', tier: 'ground', across: 0, along: -0.9 },
    ],
  };
}

/** A hex's width, which is the step between two hexes along a straight run of the deck's outline. */
const HEX_STEP = Math.sqrt(3);

/**
 * The deck's outermost ring of hexes: the bulwark stands along it and the sea starts on the next.
 * Three hexes, after five read as a field of planks with the sea out of frame (the third review).
 */
const DECK_EDGE = 3;

/**
 * One straight run of the deck's bulwark (the second review, 2026-11-02: "fix the fences, some are
 * weirdly stacked, some are floating in water"). The deck's outermost ring of hexes is six straight
 * runs, and a wall course turns each segment to face the board's centre, so along a run the segments
 * fanned out, overlapping one another and sticking out over the sea. Laid as a group instead: the
 * run's own bearing is its outward normal, so the group's axis is the run itself; a segment on every
 * hex of it (`from`..`to` across, in hex steps), butted end to end, set out three quarters of a hex
 * over the zigzag where deck meets sea, which the segment's hull skirt covers. Afloat, so it claims
 * no hexes and the sea comes right up to it. Guns, if any, stand inboard of it, run out over it.
 */
function bulwarkRun(bearing: number, from: number, to: number, guns: number[] = []): FocalGroup {
  const pieces: GroupPiece[] = [];
  for (let k = from; k <= to; k++) {
    pieces.push({ key: 'arena_isle_rail_0', tier: 'canopy', across: k * HEX_STEP, along: 0.75 });
  }
  for (const k of guns) pieces.push({ key: 'arena_isle_cannon_0', tier: 'thicket', across: k * HEX_STEP, along: -0.6 });
  return { bearing, depth: DECK_EDGE, afloat: true, pieces };
}

/**
 * The bulwark's five runs round the deck's outermost ring of hexes: the back, the two back diagonals
 * and the two front diagonals as far as the camera's cutaway lets them come. The ring is a skewed
 * hexagon, so each run's hexes lie at its own steps across its bearing.
 */
const DECK_BULWARK: FocalGroup[] = [
  bulwarkRun(-Math.PI / 2, -4, 2, [-2, 1]),
  bulwarkRun(-Math.PI / 6, -5, 5, [-2, 2]),
  bulwarkRun((-5 * Math.PI) / 6, -2, 4, [0, 3]),
  bulwarkRun(Math.PI / 6, -2, 4, [-1]),
  bulwarkRun((5 * Math.PI) / 6, -5, 5, [3]),
];

/** The deck is kept clear: its planks are open by design, and what stands on them is placed. */
const DECK_OPEN: OpenGround = { threshold: 1, scale: 0.17, front: true, dunes: [], dune: 0, wind: 0 };

/** A wave breaking over the starboard bulwark in the storm, standing in the sea. */
const BREAKING_WAVE: FocalGroup = {
  bearing: -0.25,
  depth: 4,
  afloat: true,
  pieces: [{ key: 'arena_isle_wave_0', tier: 'canopy', across: 0, along: 0 }],
};

/**
 * A boarding fight on a ship's deck (the reviews of 2026-11-02): a solid bulwark in straight runs
 * three hexes out round the back and both flanks (`DECK_BULWARK`), guns run out over it, the one great
 * mast with its crow's nest on the left, the capstan, cargo, hatches; the planks between kept clear;
 * the ship alongside past the bulwark in the water, and the sea all round out to the haze.
 */
function deckKit(storm: boolean): SceneryKit {
  return {
    canopy: [],
    thicket: [],
    ground: [],
    // Past the bulwark is the sea
    horizon: null,
    groups: [
      ...DECK_BULWARK, MAIN_MAST, shipAlongside(), deckCargo(-0.45), deckCargo(-2.35),
      ...(storm ? [BREAKING_WAVE] : []),
    ],
    focal: [
      { key: 'arena_isle_capstan_0', tier: 'thicket', count: 1, depth: 1, bearing: -1.25 },
      { key: 'arena_isle_hatch_0', tier: 'ground', count: 1, depth: 1, bearing: -1.9 },
      { key: 'arena_isle_hatch_0', tier: 'ground', count: 1, depth: 1, bearing: 0.4 },
    ],
    water: {
      shape: 'course',
      color: storm ? STORM_SEA : ISLE_SEA,
      near: DECK_EDGE + 1, far: 14, bearing: -Math.PI / 2, sweep: Math.PI * 2,
    },
    openGround: DECK_OPEN,
    enclosure: 0.3,
    framingDepth: 4,
    haze: storm ? { color: '#4a5a62', near: 26, far: 52 } : ISLE_HAZE,
    // The sea all round, out to the haze, a ship and stacks standing well out in it (the distant ship
    // is a handful of boxes, built to be seen far off); nothing else is past the bulwark
    fill: {
      far: [],
      under: [],
      low: [],
      from: 11,
      share: 0,
      water: 1,
      afloat: { keys: storm ? ['arena_isle_far_stack_0'] : ['arena_isle_far_ship_0', 'arena_isle_far_stack_0'], share: 0.05 },
    },
  };
}

/**
 * The battery's cliff: past the wall the crag falls away to the sea on every bearing but the front,
 * where the fortress goes on toward the camera. Stacks and a ship stand out in the sea below.
 */
const BATTERY_SHELF: ShelfSpec = {
  // Clear of the wall three hexes out at the lip's narrowest (it wobbles 13% in)
  edges: [
    { bearing: -Math.PI / 2, sweep: 1.4, radius: 14.4 },
    { bearing: -Math.PI / 2 - Math.PI / 3, sweep: 1.4, radius: 14.2 },
    { bearing: -Math.PI / 2 + Math.PI / 3, sweep: 1.4, radius: 14.2 },
    { bearing: Math.PI, sweep: 1.4, radius: 12.8 },
    { bearing: 0, sweep: 1.4, radius: 12.8 },
  ],
  drop: 8,
  steps: 2,
  tread: 1,
  face: '#45464d',
  // The deep sea under the cliff, open water the reach check reads as water
  lower: '#1f6f8c',
  sea: true,
  below: { keys: ['arena_isle_far_stack_0', 'arena_isle_far_ship_0', 'arena_isle_far_stack_0', 'arena_isle_stack_0'], count: 14 },
};

/** The battery's head: Varr's banner on the middle of the far wall, powder and shot stacked under it. */
const BATTERY_HEAD: FocalGroup = {
  bearing: -Math.PI / 2,
  depth: 2,
  pieces: [
    { key: 'arena_isle_banner_0', tier: 'canopy', across: 0, along: 0.4 },
    { key: 'arena_isle_powder_0', tier: 'thicket', across: -1.4, along: -0.2 },
    { key: 'arena_isle_powder_0', tier: 'thicket', across: 1.5, along: -0.1, turn: 1.2 },
  ],
};

/**
 * Varr's gun battery on his fortress wall: flagstones, the dark crenellated wall round the back
 * and both flanks, four great guns inside it pointing out to sea, his red banner between them,
 * powder and shot stacked by the guns, and past the wall the cliff falling to the sea, whitecaps and
 * skerries on it and stacks and a ship standing out in it.
 */
const ISLE_BATTERY: SceneryKit = {
  canopy: ['arena_isle_gun_0'],
  thicket: ['arena_isle_powder_0', 'arena_isle_barrels_0', 'arena_isle_crates_0'],
  ground: ['arena_isle_rope_0'],
  // Three hexes out, so the guns and the banner stand inside it: a tall piece a hex behind the board
  // is one the camera's envelope refuses, and they went outside the wall
  wall: { keys: ['arena_isle_battlement_0'], depth: 3 },
  // Past the wall the cliff falls to the sea, and what stands out there is the sea's
  horizon: ['arena_isle_far_stack_0', 'arena_isle_far_ship_0'],
  groups: [BATTERY_HEAD],
  focal: [
    { key: 'arena_isle_gun_0', tier: 'canopy', count: 1, depth: 2, bearing: -2.35 },
    { key: 'arena_isle_gun_0', tier: 'canopy', count: 1, depth: 2, bearing: -1.95 },
    { key: 'arena_isle_gun_0', tier: 'canopy', count: 1, depth: 2, bearing: -1.2 },
    { key: 'arena_isle_gun_0', tier: 'canopy', count: 1, depth: 2, bearing: -0.8 },
    // A lamp on either flank, inside the wall
    { key: 'arena_isle_lamp_0', tier: 'thicket', count: 1, depth: 2, bearing: Math.PI - 0.35 },
    { key: 'arena_isle_lamp_0', tier: 'thicket', count: 1, depth: 2, bearing: 0.35 },
  ],
  shelf: BATTERY_SHELF,
  enclosure: 0.3,
  framingDepth: 4,
  haze: ISLE_HAZE,
  // The crag's top between the wall and the lip, and the sea below it out to the camera's reach
  fill: {
    far: [],
    under: ['arena_isle_rock_1', 'arena_isle_rock_0'],
    low: [],
    below: { under: ['arena_isle_whitecap_0', 'arena_isle_skerry_0', 'arena_isle_whitecap_1', 'arena_isle_whitecap_0'], low: [], share: 0.14 },
    from: 4,
    share: 0,
    deeper: 16,
    wider: 8,
  },
  openGround: CAVE_FRONT,
};

/** A cave's rock for the archipelago's two lairs, after `caveRises`. */
function isleCave(stone: string[], veins: string[], level: string[]): HillSpec {
  return {
    rises: caveRises(15),
    from: 2.8,
    run: 2.4,
    relief: 0.4,
    level,
    turf: [stone[1], stone[2], stone[0]],
    earth: stone[0],
    rock: stone[1],
    cave: { wall: 1.2, ceiling: 11, stone, veins: { colors: veins, share: 0.1 } },
  };
}

/** The wreck's ribs arching over the head of the Sunken Hull, coral grown on them, a tide pool among them. */
const HULL_RIBS: FocalGroup = {
  bearing: -Math.PI / 2,
  depth: 2,
  pieces: [
    { key: 'arena_isle_rib_0', tier: 'canopy', across: -2.2, along: 0.4 },
    { key: 'arena_isle_rib_0', tier: 'canopy', across: 0, along: 0.8 },
    { key: 'arena_isle_rib_0', tier: 'canopy', across: 2.2, along: 0.4 },
    { key: 'arena_isle_coral_0', tier: 'thicket', across: -1.0, along: -0.6 },
    { key: 'arena_isle_pool_0', tier: 'ground', across: 1.0, along: -0.8 },
  ],
};

/**
 * The Reef Titan's lair: the inside of a wreck on a beach lagoon. Wet sand, the hull's ribs arching
 * over the far end, broken planking and coral on the floor, tide pools, the lagoon glowing teal past
 * the board, and the rock of the cove closing round it.
 */
const ISLE_HULL: SceneryKit = {
  canopy: ['arena_isle_rib_1', 'arena_isle_crag_0'],
  thicket: ['arena_isle_coral_0', 'arena_isle_wreckage_0', 'arena_isle_rock_0', 'arena_isle_rock_1'],
  ground: ['arena_isle_shells_0', 'arena_isle_weed_0', 'arena_isle_pool_0'],
  horizon: null,
  hills: isleCave(['#3a3426', '#4a4232', '#2e2a20', '#46342a', '#3e3a2c'], ['#46342a', '#3f6a3a', '#cfc8b8'], ['arena_isle_rib_0', 'arena_isle_rib_1']),
  groups: [HULL_RIBS],
  focal: [
    { key: 'arena_isle_rib_1', tier: 'canopy', count: 1, depth: 3, bearing: 3.0 },
    { key: 'arena_isle_rib_1', tier: 'canopy', count: 1, depth: 3, bearing: 0.15 },
    { key: 'arena_isle_coral_0', tier: 'thicket', count: 2, depth: 2 },
  ],
  water: {
    shape: 'pools',
    color: '#3fc6c0',
    bank: ['arena_isle_coral_0', 'arena_isle_rock_1', 'arena_isle_wreckage_0'],
    near: 2, far: 4, coverage: 0.3,
  },
  enclosure: 0.4,
  fill: {
    far: ['arena_isle_rib_1', 'arena_isle_crag_0'],
    under: ['arena_isle_wreckage_0', 'arena_isle_coral_0', 'arena_isle_rock_1'],
    low: ['arena_isle_weed_0'],
    from: 3,
    share: 0.35,
  },
  openGround: CAVE_FRONT,
};

/** The grotto's head: the drowned ship's bell on its beam, green lanterns either side, pearls at its foot. */
const GROTTO_BELL: FocalGroup = {
  bearing: -Math.PI / 2,
  depth: 2,
  pieces: [
    { key: 'arena_isle_bell_0', tier: 'canopy', across: 0, along: 0.5 },
    { key: 'arena_isle_lantern_0', tier: 'thicket', across: -1.9, along: -0.2 },
    { key: 'arena_isle_lantern_0', tier: 'thicket', across: 1.9, along: -0.1, turn: Math.PI },
    { key: 'arena_isle_pearls_0', tier: 'ground', across: 0.4, along: -0.9 },
  ],
};

/**
 * The Drowned Queen's lair: a sea cave of wet dark rock, its shallows round the board, the drowned
 * ship's bell hung on a beam at its head between green lanterns, rocks standing in the water,
 * pearls and shells on the stone.
 */
const ISLE_GROTTO: SceneryKit = {
  canopy: ['arena_isle_crag_0'],
  thicket: ['arena_isle_rock_0', 'arena_isle_rock_1', 'arena_isle_lantern_0', 'arena_isle_coral_0'],
  ground: ['arena_isle_pearls_0', 'arena_isle_shells_0', 'arena_isle_weed_0'],
  horizon: null,
  hills: isleCave(['#3a4240', '#4e5654', '#2e3432', '#46504e', '#3e4846'], ['#4fc0c8', '#cfd8d4', '#2e5a52'], ['arena_isle_bell_0', 'arena_isle_lantern_0']),
  groups: [GROTTO_BELL],
  focal: [{ key: 'arena_isle_lantern_0', tier: 'thicket', count: 2, depth: 2 }],
  water: {
    shape: 'pools',
    color: '#4fc0c8',
    bank: ['arena_isle_rock_0', 'arena_isle_rock_1', 'arena_isle_pearls_0'],
    near: 2, far: 4, coverage: 0.45,
  },
  enclosure: 0.4,
  fill: {
    far: ['arena_isle_crag_0', 'arena_isle_rock_0'],
    under: ['arena_isle_rock_1', 'arena_isle_rock_0', 'arena_isle_coral_0'],
    low: ['arena_isle_weed_0'],
    from: 3,
    share: 0.3,
  },
  openGround: CAVE_FRONT,
};

export const SCENERY_KITS: Partial<Record<string, SceneryKit>> = {
  forest: FOREST,
  danger_forest: BLIGHTED_FOREST,
  plains: MEADOW,
  danger_plains: BLIGHTED_MEADOW,
  highlands: HIGHLAND_BASIN,
  danger_highlands: BLIGHTED_HIGHLANDS,
  swamp: WETLAND,
  danger_swamp: BLIGHTED_WETLAND,
  desert: CANYON,
  danger_desert: BLIGHTED_CANYON,
  mountain: MOUNTAIN_PASS,
  danger_mountain: BLIGHTED_PASS,
  water: SHORE,
  danger_water: BLIGHTED_SHORE,
  tundra: TAIGA,
  danger_tundra: RIMEBLIGHT,
  castle: CASTLE_HALL,
  lair_warren: WARREN_BURROW,
  lair_barrow: GLACIER_DEEP,
  lair_wyrm: WYRM_HOLLOW,
  // Jadeveil: Kairen's summit, a world site with an arena of its own (`EncounterContext.site`)
  summit: CLOUD_CROWN,
  // Jadeveil's grounds (`MapTile.jade`), provisional kits from its own prop kit
  jade_moss: JADE_MOSS,
  danger_jade_moss: HAUNTED_JADE_MOSS,
  jade_bamboo: JADE_BAMBOO,
  danger_jade_bamboo: HAUNTED_JADE_BAMBOO,
  jade_terrace: JADE_TERRACE,
  danger_jade_terrace: HAUNTED_JADE_TERRACE,
  jade_ridge: JADE_RIDGE,
  danger_jade_ridge: HAUNTED_JADE_RIDGE,
  jade_crown: JADE_CROWN,
  danger_jade_crown: HAUNTED_JADE_CROWN,
  // A shrine's courtyard, where its keepers are fought (`EncounterContext.site`), dressed per band
  shrine_1: SHRINE_FOREST,
  shrine_2: SHRINE_TERRACE,
  shrine_3: SHRINE_RIDGE,
  shrine_4: SHRINE_CROWN,
  // A held village, where its garrison is fought (`EncounterContext.site`), dressed per theme
  village_lookout: villageKit('lookout'),
  village_trading_post: villageKit('trading_post'),
  village_smithy: villageKit('smithy'),
  village_shrine: villageKit('shrine'),
  // Jadeveil's two lairs
  lair_silk: SILK_HOLLOW,
  lair_hall: SILENT_HALL,
  // The archipelago's grounds and places, built ahead of its world
  isle_beach: ISLE_BEACH,
  isle_jungle: ISLE_JUNGLE,
  isle_rock: ISLE_ROCK,
  deck: deckKit(false),
  deck_storm: deckKit(true),
  port: ISLE_PORT,
  battery: ISLE_BATTERY,
  pirate_fort: ISLE_PIRATE_FORT,
  lair_hull: ISLE_HULL,
  lair_grotto: ISLE_GROTTO,
};
