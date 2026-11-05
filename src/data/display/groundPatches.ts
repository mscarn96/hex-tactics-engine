import { HexCoord, hexToPixel } from '@/utils/hexUtils';

/**
 * What the ground under a fight is made of, beyond one colour and a grain.
 *
 * Sibling to `terrainDisplay`'s `GRAIN`, and the other half of the same
 * problem. The grain is *fine* — a few cells across a tile, which is what stops
 * a surface reading as painted paper — and it is identical on every hex by
 * construction, because a texture belongs to a material and a material is
 * shared by the whole board. So a board with a grain on it is still one colour
 * over sixty-one hexes, which at the framing Step 2 settled on is a large flat
 * expanse in the middle of the frame. Section 3A calls that out directly: a
 * greyscale grain over one base colour cannot produce moss against stone,
 * flowers in grass or trodden earth beside them.
 *
 * This is the **broad** half: low-frequency patches, a couple of hexes across,
 * riding the per-instance colour every tile already carries. Nothing new
 * reaches the GPU — `HexGridMesh` has always written a per-tile multiplier into
 * `instanceColor` and has always used it for a grey jitter, so a patch is that
 * same number with a hue on it.
 *
 * Pure, free of `three` and of anything that reaches React Native, so the
 * composition can be measured in the node suites rather than eyeballed on a
 * phone — the rule every other table in `data/display` follows.
 */

/**
 * **A salt is measured, not picked.** `patchNoise` is value noise on a lattice
 * a couple of hexes wide, and a board is only seven hexes across — so whether a
 * given field rises past a threshold *anywhere on the board* is luck, and a few
 * salts simply never do. Three of the first draft's fourteen compositions had a
 * patch that could not cover a quarter of any board at any seed; the suite names
 * them, and the fix is to take a salt already known to produce regions rather
 * than to lower the rule until the unlucky ones pass. Two surfaces sharing a
 * salt share a *shape* and nothing else, and no two surfaces are ever drawn in
 * the same fight.
 */

/** A per-channel multiplier over the surface's own colour. */
export type Tint = readonly [number, number, number];

export const NO_TINT: Tint = [1, 1, 1];

/**
 * A band down one bearing, for the patch that is not noise.
 *
 * **`groundPatches` was three noise fields, and an axis is not noise.** A hall
 * has a carpet running from its door to its throne, and the plan's rule for
 * anything that would otherwise stand on playable ground is that it is a *floor
 * mark* rather than geometry — so the carpet has to be a patch, and a patch had
 * no way to be a line. Everything downstream is untouched: the field returns a
 * number in 0..1 like `patchNoise` does and the same `threshold` and `ramp` turn
 * it into a strength, so a band gets an edge and a middle for the same reason a
 * blob does.
 *
 * Measured in **world units off the axis**, not in hexes. The axial basis is
 * skewed, so a band of constant `|q|` is a band that widens as it runs; and the
 * bearing this is authored in is the one the focal anchor at the head of the
 * hall is authored in, which is the player's bearing rather than the grid's.
 */
export interface AxisBand {
  /**
   * The direction the band runs, in radians, as `hexToPixel` sees it: `-π/2` is
   * straight away from the camera, which is the bearing `FocalAnchor` pins a
   * throne at. The band is symmetric, so a bearing and its opposite are one
   * line — what it names is an axis, not a direction of travel.
   */
  bearing: number;
  /** Half-width of the band in world units, at which the field reaches zero. */
  halfWidth: number;
}

export interface GroundPatch {
  /**
   * The multiplier at full strength.
   *
   * **Never above 1 in any channel.** A tile's colour travels to the renderer
   * as a hex string, which clamps, so a patch that tries to brighten is a patch
   * that silently does nothing on exactly the tiles where it is strongest. The
   * board's average brightness is held by compensating the *material* instead —
   * the arrangement `terrainMaterial` already uses for the grain's own mean.
   */
  tint: Tint;
  /** Field value above which this patch appears at all. */
  threshold: number;
  /**
   * How much further the field has to rise for the patch to reach full strength.
   *
   * Stated rather than derived from `1 - threshold`, which is what the first
   * draft did: a threshold of 0.54 then took until 1.0 to saturate, so a field
   * that rarely exceeds 0.8 produced a patch that never had an interior. What
   * came out was a soft gradient across the whole board rather than *patches* —
   * measurably a fifth of a stop of variation, and invisible. A patch needs a
   * middle where it is simply that material, and the ramp is what gives it one.
   */
  ramp: number;
  /** Hexes across one blob, roughly. Ignored by a band, which has a width. */
  scale: number;
  /** Field salt, so two patches on one surface are independent. Ignored by a band. */
  salt: number;
  /** Replaces the noise field with a band down one bearing. */
  band?: AxisBand;
}

export interface GroundComposition {
  /**
   * The floor's own albedo, for ground where standing on it is not the same as
   * flying over it.
   *
   * **The world map's `forest` is a canopy seen from above and the arena's is
   * the litter underneath it**, and the arena had been borrowing the first for
   * the second since it had a board at all. `#1c5623` is the darkest entry in
   * the map's palette *on purpose* — it has to separate from five other
   * surfaces at strategic zoom — which left a forest fight standing on a
   * near-black plate at linear luminance 0.05, where a multiplicative patch can
   * vary by a quarter and still be invisible. The floor is the ground a player
   * is looking at for the whole fight, so it gets its own colour rather than a
   * factor on somebody else's.
   *
   * Authored for the arena, so it is **not** dimmed by `ARENA_DIM` again; that
   * factor exists to keep a board from washing out against the backdrop photo,
   * and a colour written here has already answered that question.
   */
  /**
   * The board's own albedo, and the plane's.
   *
   * **`ground` was raised on the four living surfaces, and it is a reversal.**
   * It was authored at 0.4–0.5 of `tile` per channel — a value step that told
   * the board apart from everything around it — when what lay beyond the seven
   * hexes of cosmetic surround was a thin rim nobody looked at. It is not that
   * any more: the backdrop photo is gone, the plane *is* the distance, and the
   * scenic ring now runs out to the frame. Measured from the rig, the ground
   * outside the hex field is a tenth of a desktop frame and better than a third
   * of a portrait one, so a step designed as a boundary cue had become the
   * dominant tone of the picture — and the reference forest has no dark ring
   * around its clearing at all, only shadow under its trees.
   *
   * Raised by half, to about 0.65–0.75 of the board. What still tells the board
   * apart is its **seams**, which is Step 2's own argument for making the value
   * step gentle in the first place (`HexGridMesh`'s `tileRadius` draws the
   * surround without them), and `arenaScenery.test.ts` still pins that the
   * surround never out-brightens the board.
   *
   * A blighted surface and an interior are *meant* to fall off into gloom —
   * that is the haunted preset's whole job — and water's plane is the deep
   * rather than more of the ground the fight is on. Every other living outdoor
   * surface is in the band, and `arenaScenery.test.ts` measures it rather than
   * leaving it here as prose.
   *
   * **The desert used to be exempted here by name, and the exemption was the
   * fault.** Its stated reason — "the desert's plane was already at 0.57
   * because sand is bright" — reads the board's *absolute* brightness, where
   * what decides whether a board looks like a lit tray set into shadow is the
   * ratio; the canyon's blue channel sat at 0.40, the widest step of any living
   * arena. That is the finding the 2026-09-22 gate review made `partial` on
   * three of six criteria, and the editor-native desert raised the plane into
   * the band with the rest. `CANYON` below is the composition it replaced,
   * kept as what the runtime falls back to, so it still carries the old step.
   */
  floor?: { tile: string; ground: string };
  patches: GroundPatch[];
}

/**
 * The forest clearing.
 *
 * Three fields at three sizes, because one field at one size is a pattern and
 * two is a plaid. They are chosen for what they *are* rather than for value
 * alone: bare trodden earth where feet have been, moss where light has not, and
 * a wide soft shadow from the canopy standing over the whole clearing. The last
 * one is the largest and weakest, which is what keeps the first two reading as
 * ground rather than as stains.
 *
 * All three darken, and the earth patch is the only one that shifts hue far —
 * it is the one a player is meant to notice.
 */
const FOREST: GroundComposition = {
  // Grass and leaf litter in a clearing, not the roof of a wood. A touch darker
  // and greener than the city's lawn, which is the same material mown.
  floor: { tile: '#3a6e2b', ground: '#2b5320' },
  patches: [
    { tint: [1.0, 0.70, 0.44], threshold: 0.55, ramp: 0.14, scale: 2.6, salt: 11 },
    { tint: [0.68, 0.97, 0.60], threshold: 0.58, ramp: 0.13, scale: 1.9, salt: 29 },
    { tint: [0.80, 0.84, 0.78], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
    /**
     * Dry grass, and a fourth field on the one surface that asks for it.
     *
     * The proof forest's own carry-forward: the reference's clearing floor
     * varies moss / bare earth / **dry grass** patch to patch, and three fields
     * gave it moss, earth and a canopy shadow. Warm and desaturated rather than
     * another green — what a patch of dried grass is, is grass with the green
     * taken out of it, so the blue channel moves least and the whole thing sits
     * a step down in value.
     *
     * Its own salt and a scale between the other two, so it neither lines up
     * with the moss nor turns over so fast that it reads as noise on top of
     * them. Nothing else in the file gains one: the rule is that a composition
     * has as many materials as its ground actually has, not that more is better.
     */
    { tint: [0.94, 0.86, 0.58], threshold: 0.57, ramp: 0.15, scale: 2.2, salt: 59 },
  ],
};

/**
 * The blighted clearing.
 *
 * The same three sizes doing the same three jobs, so the ground under a haunted
 * fight is recognisably the ground under a living one — but the materials are
 * the blight's: bare scorched earth where the grass has gone, a cold ashen
 * bloom, and the canopy shadow kept because dead branches still stand over the
 * clearing. The floor is a dead leaf litter rather than the map's scorched
 * brown, for the same reason the living one is not a canopy.
 */
const BLIGHTED_FOREST: GroundComposition = {
  floor: { tile: '#655847', ground: '#33291f' },
  patches: [
    { tint: [0.92, 0.74, 0.52], threshold: 0.55, ramp: 0.14, scale: 2.6, salt: 11 },
    { tint: [0.72, 0.78, 0.86], threshold: 0.58, ramp: 0.13, scale: 1.9, salt: 29 },
    { tint: [0.74, 0.74, 0.76], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/**
 * Open meadow.
 *
 * The map's plains is already a bright grass and needs the least lifting of any
 * surface here; what it needs is *patches*, because an open field read from six
 * feet away is mostly one colour and the eye goes looking for the exception.
 * Bare earth where it has been walked, a darker richer green in the hollows, and
 * the same wide shadow.
 */
const MEADOW: GroundComposition = {
  floor: { tile: '#6fa63c', ground: '#426f24' },
  patches: [
    { tint: [1.0, 0.76, 0.50], threshold: 0.55, ramp: 0.14, scale: 2.8, salt: 17 },
    { tint: [0.70, 0.92, 0.60], threshold: 0.58, ramp: 0.13, scale: 2.0, salt: 37 },
    { tint: [0.82, 0.86, 0.80], threshold: 0.44, ramp: 0.30, scale: 4.4, salt: 47 },
  ],
};

/** The same field under the blight: bare earth, ash and a cold bloom. */
const BLIGHTED_MEADOW: GroundComposition = {
  floor: { tile: '#6e6047', ground: '#3c2818' },
  patches: [
    { tint: [0.94, 0.76, 0.54], threshold: 0.55, ramp: 0.14, scale: 2.8, salt: 17 },
    { tint: [0.72, 0.78, 0.88], threshold: 0.58, ramp: 0.13, scale: 2.0, salt: 37 },
    { tint: [0.76, 0.76, 0.78], threshold: 0.44, ramp: 0.30, scale: 4.4, salt: 47 },
  ],
};

/**
 * A highland basin's floor: ochre earth, turf and exposed stone.
 *
 * Three materials rather than two, because that is what the reference shows and
 * because it is the one floor in the set where the *stone* is a patch rather
 * than the base — high ground is soil that has worn through in places.
 */
const HIGHLAND_BASIN: GroundComposition = {
  floor: { tile: '#a08c56', ground: '#72603c' },
  patches: [
    { tint: [0.62, 0.86, 0.52], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 19 },
    { tint: [0.86, 0.88, 0.92], threshold: 0.58, ramp: 0.13, scale: 1.9, salt: 41 },
    { tint: [0.80, 0.82, 0.80], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
    // The broad half of the earth-to-turf transition: a turf field at the
    // desert's broad-patch scale, so the floor changes material over several
    // hexes instead of only in the small blotches above.
    { tint: [0.74, 0.90, 0.62], threshold: 0.5, ramp: 0.22, scale: 6.2, salt: 59 },
  ],
};

/** The same basin blighted: the stone stays, the turf does not. */
const BLIGHTED_HIGHLANDS: GroundComposition = {
  floor: { tile: '#7d6f58', ground: '#332b20' },
  patches: [
    { tint: [0.92, 0.76, 0.56], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 19 },
    { tint: [0.70, 0.80, 0.94], threshold: 0.58, ramp: 0.13, scale: 1.9, salt: 41 },
    { tint: [0.76, 0.76, 0.78], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/**
 * A wetland floor: wet mud, moss and standing water.
 *
 * The only floor in the set whose *base* is a dark material, because that is
 * what a bog is — so the patches go the other way round from every other one
 * here and are what lightens it. It still clears the luminance floor: a board
 * that reads as a hole is a hole whatever the ground is called.
 */
const WETLAND: GroundComposition = {
  floor: { tile: '#6b7042', ground: '#4c4b24' },
  patches: [
    { tint: [0.74, 0.74, 0.62], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 23 },
    { tint: [0.62, 0.82, 0.88], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 43 },
    { tint: [0.80, 0.84, 0.78], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/** Black water and rot. */
const BLIGHTED_WETLAND: GroundComposition = {
  floor: { tile: '#5f5c3c', ground: '#2c2410' },
  patches: [
    { tint: [0.88, 0.78, 0.58], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 23 },
    { tint: [0.62, 0.72, 0.90], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 43 },
    { tint: [0.72, 0.74, 0.76], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/**
 * Sand.
 *
 * The widest hue swing of any floor here, and it has to be: sand is one value
 * over a very large area, so what tells a player where they are standing is
 * whether the ground under them is warm sand, pale scoured rock or the cooler
 * shadow of the canyon wall.
 *
 * **A fourth field, and it is the broad half of "broad sand variation".** The
 * desert's floor detail used to be carried by the props — ten ripple plates and
 * a scatter of bone a fight — which is the wrong layer for it: an object on the
 * floor competes with the units standing on the same floor, where a patch is
 * the floor. The three standard fields turn over at 2.0–4.4 hexes, which on a
 * seven-hex board is texture rather than *ground*; this one runs at **6.2**, so
 * a whole quarter of the board is one deposit and the next is another. That is
 * what the eye reads as open country, and it costs nothing on screen — a patch
 * is a number already riding in `instanceColor`.
 *
 * Warm and barely darker, because it is sand on sand: the swing is in hue and
 * the value step is small enough that nothing about where a unit is standing
 * gets harder to see. Its own salt, and a scale that lines up with none of the
 * other three — two fields on one lattice is a plaid.
 */
const CANYON: GroundComposition = {
  floor: { tile: '#e0b060', ground: '#7f6126' },
  patches: [
    { tint: [1.0, 0.82, 0.52], threshold: 0.55, ramp: 0.14, scale: 2.8, salt: 27 },
    { tint: [0.82, 0.86, 0.94], threshold: 0.58, ramp: 0.13, scale: 2.0, salt: 53 },
    { tint: [0.78, 0.80, 0.84], threshold: 0.44, ramp: 0.30, scale: 4.4, salt: 47 },
    { tint: [0.97, 0.90, 0.74], threshold: 0.42, ramp: 0.26, scale: 6.2, salt: 61 },
  ],
};

/**
 * The same open sand at dusk, darkened by wear without losing the far country.
 *
 * **Every patch is sand or terracotta, and none of them is grey.** It inherited
 * the open desert's first three fields as they stood before that floor was
 * reworked, and two of them were a blue-grey and a neutral grey: over a warm
 * board a tint weighted toward blue desaturates what it lands on, and under the
 * haunted rig's cold fill that reads as grey mud in patches — the "gray generic
 * ground" the target names. They are a terracotta and an umber now, each
 * weighted so red survives it best, and the broad field the open desert gained
 * is here too at its own scale and salt: the broad half of the variation is
 * what says open country, and it is a number already in `instanceColor`.
 */
const BLIGHTED_CANYON: GroundComposition = {
  floor: { tile: '#a8703a', ground: '#79502a' },
  patches: [
    { tint: [1.0, 0.78, 0.50], threshold: 0.55, ramp: 0.14, scale: 2.8, salt: 27 },
    // Terracotta: red kept, green and blue taken down.
    { tint: [0.94, 0.72, 0.58], threshold: 0.58, ramp: 0.13, scale: 2.0, salt: 53 },
    // Umber: darker, and still warm.
    { tint: [0.80, 0.70, 0.58], threshold: 0.44, ramp: 0.30, scale: 4.4, salt: 47 },
    { tint: [0.97, 0.90, 0.74], threshold: 0.42, ramp: 0.26, scale: 6.2, salt: 61 },
  ],
};

/** A pass: grey rock, gravel and old snow. */
const MOUNTAIN_PASS: GroundComposition = {
  floor: { tile: '#928773', ground: '#55544b' },
  patches: [
    { tint: [1.0, 0.88, 0.70], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 29 },
    { tint: [0.70, 0.80, 0.96], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 59 },
    { tint: [0.80, 0.82, 0.86], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/**
 * Jadeveil: Kairen's summit — storm-scoured granite with jade lichen in its hollows,
 * colder and paler than the pass below it: a peak top the wind keeps bare.
 */
const CLOUD_CROWN: GroundComposition = {
  floor: { tile: '#8e918d', ground: '#5c605f' },
  patches: [
    { tint: [0.78, 0.96, 0.86], threshold: 0.57, ramp: 0.14, scale: 2.2, salt: 31 },
    { tint: [1.0, 0.86, 0.72], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 59 },
    { tint: [0.86, 0.87, 0.88], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/** The pass abandoned: the same rock, colder and stained. */
const BLIGHTED_PASS: GroundComposition = {
  floor: { tile: '#6e6a66', ground: '#2a2420' },
  patches: [
    { tint: [0.94, 0.84, 0.68], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 29 },
    { tint: [0.70, 0.78, 0.94], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 59 },
    { tint: [0.76, 0.78, 0.80], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/**
 * A shore's shallows: wet sand under an inch of water.
 *
 * **Derived, not matched** — no reference image exists for water. The board is
 * the sandbar rather than the sea, because a board a player cannot see their own
 * units against is not a board; the water is what surrounds it.
 */
const SHORE: GroundComposition = {
  floor: { tile: '#7e9ec0', ground: '#0b2650' },
  patches: [
    { tint: [1.0, 0.92, 0.72], threshold: 0.55, ramp: 0.14, scale: 2.6, salt: 17 },
    { tint: [0.66, 0.82, 1.0], threshold: 0.58, ramp: 0.13, scale: 1.9, salt: 67 },
    { tint: [0.82, 0.84, 0.86], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/** The same shallows gone black. */
const BLIGHTED_SHORE: GroundComposition = {
  floor: { tile: '#5c7268', ground: '#14211b' },
  patches: [
    { tint: [0.98, 0.86, 0.62], threshold: 0.55, ramp: 0.14, scale: 2.6, salt: 17 },
    { tint: [0.64, 0.78, 0.96], threshold: 0.58, ramp: 0.13, scale: 1.9, salt: 67 },
    { tint: [0.76, 0.78, 0.80], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/** The Warren's floor: trodden earth, spoil and fungus. */
const WARREN_BURROW: GroundComposition = {
  floor: { tile: '#8a6c48', ground: '#2a241a' },
  patches: [
    { tint: [1.0, 0.84, 0.58], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 71 },
    { tint: [0.72, 0.84, 0.76], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 43 },
    { tint: [0.78, 0.78, 0.76], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/**
 * The ice lair's floor: packed snow over blue ice, lit cold. A working floor
 * until the arena-visuals epic authors the glacier, held at the old tomb's
 * value so everything measured against a lair's board still holds.
 */
const GLACIER_DEEP: GroundComposition = {
  floor: { tile: '#8b98a8', ground: '#1a2633' },
  patches: [
    { tint: [0.92, 0.97, 1.0], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 79 },
    { tint: [0.66, 0.80, 1.0], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 83 },
    { tint: [0.80, 0.84, 0.88], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/** The Wyrm's Hollow: bare rock, scorched through, with shale underfoot. */
const WYRM_HOLLOW: GroundComposition = {
  floor: { tile: '#8a7266', ground: '#301c1c' },
  patches: [
    { tint: [1.0, 0.80, 0.56], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 89 },
    { tint: [0.70, 0.76, 0.88], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 97 },
    { tint: [0.74, 0.74, 0.76], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/**
 * The castle's hall floor.
 *
 * Paving rather than ground, so the materials are what happens *to* stone: soot
 * blown off the braziers, damp where the walls meet the flags, and the same wide
 * shadow the other two carry. The base is a little lighter than the location's
 * own `stone` because a hall is lit by fires standing in it rather than by the
 * sky — the floor is what carries that light back, and a dark floor under a few
 * warm points reads as a cave.
 */
const CASTLE_HALL: GroundComposition = {
  // Cool grey, against warm fires. The reference's instruction is "strong local
  // warm light over a cooler readable floor", and the two halves are one
  // decision: a warm floor under warm braziers leaves the fires with nothing to
  // be warm *against*, and the hall reads as evenly orange rather than as lit.
  floor: { tile: '#74747c', ground: '#241418' },
  patches: [
    { tint: [0.88, 0.74, 0.60], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 13 },
    { tint: [0.70, 0.78, 0.94], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 31 },
    { tint: [0.84, 0.84, 0.82], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
    /**
     * The carpet, and the reason `AxisBand` exists.
     *
     * The review's complaint about the hall is that its throne/stair/carpet axis
     * is undersized; the throne and the stair are geometry and the carpet cannot
     * be, because it lies on ground a unit has to be able to stand on. So it is
     * the one patch in the file that is a line.
     *
     * **`-π/2` is the same bearing the throne is pinned at**, not a number that
     * happens to match one. A carpet running to somewhere other than the head of
     * the hall would be worse than none: the axis is the thing being asserted.
     *
     * Two hexes of half-width, so the runner is about three hexes across the
     * board's seven — wide enough to be a route and narrow enough that the hall
     * is still mostly floor. The threshold bites at 0.42 and the ramp saturates
     * quickly: a carpet has an *edge*, which is the one way it differs from
     * every blob in this file, and a slow ramp would draw a bruise.
     *
     * Deep imperial red at a fifth of the green channel, and it darkens like
     * everything else here — see `GroundPatch.tint` for why a patch may never
     * brighten. `tintCompensation` gives the room back what the band takes.
     */
    {
      tint: [0.86, 0.34, 0.38],
      threshold: 0.42,
      ramp: 0.22,
      scale: 1,
      salt: 0,
      band: { bearing: -Math.PI / 2, halfWidth: 2 * Math.sqrt(3) },
    },
  ],
};

/**
 * Keyed by `sceneryFor`'s composition key: a world fight's `surfaceKey`, an
 * indoor fight's location id — the same key `SCENERY_KITS` answers to.
 */
// ─── Jadeveil ────────────────────────────────────────────────────────────────
//
// The range's floors, from its look bible (the private project notes, *Grounds*): its
// own colours rather than the Empire's meadow, wood, basin and pass, each living plane at about
// 0.65–0.75 of its board. Haunted twins go cold and pale, never burnt.

/** Moss on the valley floors: dark wet moss, pale lichen flecks, bare black earth. */
const JADE_MOSS: GroundComposition = {
  floor: { tile: '#6e8247', ground: '#4b5a31' },
  patches: [
    { tint: [0.70, 0.86, 0.66], threshold: 0.55, ramp: 0.14, scale: 2.6, salt: 13 },
    { tint: [0.96, 0.96, 0.90], threshold: 0.6, ramp: 0.12, scale: 1.6, salt: 31 },
    { tint: [0.74, 0.70, 0.62], threshold: 0.5, ramp: 0.2, scale: 3.6, salt: 53 },
  ],
};

const HAUNTED_JADE_MOSS: GroundComposition = {
  floor: { tile: '#5f665c', ground: '#2c312c' },
  patches: [
    { tint: [0.80, 0.94, 0.90], threshold: 0.55, ramp: 0.14, scale: 2.6, salt: 13 },
    { tint: [0.96, 0.86, 0.72], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 31 },
    { tint: [0.80, 0.82, 0.82], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/** The grove's floor: gold leaf litter laid one way, a dark root mat, moss. */
const JADE_BAMBOO: GroundComposition = {
  floor: { tile: '#6f7a3c', ground: '#4a5428' },
  patches: [
    { tint: [1.0, 0.90, 0.62], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 19 },
    { tint: [0.62, 0.66, 0.54], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 41 },
    { tint: [0.80, 0.92, 0.74], threshold: 0.46, ramp: 0.26, scale: 4.0, salt: 47 },
  ],
};

const HAUNTED_JADE_BAMBOO: GroundComposition = {
  floor: { tile: '#5e5d4c', ground: '#2e2d25' },
  patches: [
    { tint: [1.0, 0.88, 0.70], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 19 },
    { tint: [0.72, 0.88, 0.84], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 41 },
    { tint: [0.80, 0.80, 0.80], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/** The terraces' gold grass: trodden earth, the green shadow of tea rows, dry stone. */
const JADE_TERRACE: GroundComposition = {
  floor: { tile: '#b09a4c', ground: '#7a6a34' },
  patches: [
    { tint: [0.92, 0.78, 0.58], threshold: 0.55, ramp: 0.14, scale: 2.6, salt: 23 },
    { tint: [0.66, 0.80, 0.56], threshold: 0.58, ramp: 0.13, scale: 1.9, salt: 37 },
    { tint: [0.86, 0.84, 0.80], threshold: 0.46, ramp: 0.26, scale: 4.0, salt: 47 },
  ],
};

const HAUNTED_JADE_TERRACE: GroundComposition = {
  floor: { tile: '#6a6450', ground: '#302d24' },
  patches: [
    { tint: [0.96, 0.82, 0.66], threshold: 0.55, ramp: 0.14, scale: 2.6, salt: 23 },
    { tint: [0.74, 0.88, 0.84], threshold: 0.58, ramp: 0.13, scale: 1.9, salt: 37 },
    { tint: [0.80, 0.80, 0.80], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/** The mist ridge's blue-grey stone: lichen, scree, mist-wet dark rock. */
const JADE_RIDGE: GroundComposition = {
  floor: { tile: '#7c878a', ground: '#535d60' },
  patches: [
    { tint: [0.80, 0.96, 0.72], threshold: 0.55, ramp: 0.14, scale: 2.2, salt: 29 },
    { tint: [1.0, 0.88, 0.76], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 59 },
    { tint: [0.74, 0.78, 0.80], threshold: 0.46, ramp: 0.26, scale: 4.0, salt: 47 },
  ],
};

const HAUNTED_JADE_RIDGE: GroundComposition = {
  floor: { tile: '#535c60', ground: '#24292b' },
  patches: [
    { tint: [0.80, 0.94, 0.90], threshold: 0.55, ramp: 0.14, scale: 2.2, salt: 29 },
    { tint: [0.98, 0.86, 0.74], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 59 },
    { tint: [0.80, 0.82, 0.82], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/** The crown's violet storm-worn rock: pale scoured streaks, dark cracks. */
const JADE_CROWN: GroundComposition = {
  floor: { tile: '#6a6276', ground: '#47414f' },
  patches: [
    { tint: [1.0, 0.84, 0.80], threshold: 0.55, ramp: 0.14, scale: 2.0, salt: 31 },
    { tint: [0.80, 0.94, 0.80], threshold: 0.58, ramp: 0.13, scale: 1.7, salt: 61 },
    { tint: [0.84, 0.82, 0.88], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

const HAUNTED_JADE_CROWN: GroundComposition = {
  floor: { tile: '#4f5a58', ground: '#232928' },
  patches: [
    { tint: [0.80, 0.96, 0.92], threshold: 0.55, ramp: 0.14, scale: 2.0, salt: 31 },
    { tint: [0.98, 0.86, 0.80], threshold: 0.58, ramp: 0.13, scale: 1.7, salt: 61 },
    { tint: [0.80, 0.82, 0.82], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/** A shrine's courtyard: pale laid flags, moss in the joints, worn warm where feet have been. */
const SHRINE_COURT: GroundComposition = {
  floor: { tile: '#c9bfa4', ground: '#8a826c' },
  patches: [
    { tint: [0.72, 0.90, 0.62], threshold: 0.56, ramp: 0.14, scale: 1.8, salt: 43 },
    { tint: [1.0, 0.90, 0.76], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 17 },
    { tint: [0.84, 0.82, 0.78], threshold: 0.44, ramp: 0.30, scale: 4.0, salt: 47 },
  ],
};

/** The Silk Hollow's floor: pale moss under a skin of silk, dark root mat where it wears through. */
const SILK_HOLLOW: GroundComposition = {
  floor: { tile: '#97a28a', ground: '#26301e' },
  patches: [
    { tint: [0.66, 0.82, 0.58], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 17 },
    { tint: [1.0, 0.92, 0.80], threshold: 0.57, ramp: 0.13, scale: 1.8, salt: 43 },
    { tint: [0.80, 0.84, 0.78], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

/** The Silent Hall's floor: worn honey temple boards, cold slate where the cloisters run. */
const SILENT_HALL: GroundComposition = {
  floor: { tile: '#8a6c4a', ground: '#262a32' },
  patches: [
    { tint: [1.0, 0.86, 0.68], threshold: 0.52, ramp: 0.14, scale: 2.2, salt: 17 },
    { tint: [0.78, 0.86, 0.92], threshold: 0.57, ramp: 0.13, scale: 1.8, salt: 43 },
    { tint: [0.84, 0.82, 0.80], threshold: 0.44, ramp: 0.30, scale: 4.2, salt: 47 },
  ],
};

// ── The archipelago (the private project notes) ────────────────────

/** The beach and the port's sand: wet dark sand, pale dry ripples, a pink drift of crushed shell and coral. */
const ISLE_SAND: GroundComposition = {
  floor: { tile: '#d6bf88', ground: '#9c8a5c' },
  patches: [
    { tint: [0.80, 0.80, 0.78], threshold: 0.5, ramp: 0.14, scale: 2.6, salt: 61 },
    { tint: [0.98, 0.97, 0.90], threshold: 0.58, ramp: 0.13, scale: 1.7, salt: 67 },
    { tint: [1.0, 0.80, 0.76], threshold: 0.48, ramp: 0.22, scale: 3.8, salt: 71 },
  ],
};

/** The jungle floor: red-brown laterite where it is bare, leaf litter, the dark of the root mat. */
const ISLE_JUNGLE: GroundComposition = {
  floor: { tile: '#56743a', ground: '#3a4f27' },
  patches: [
    { tint: [1.0, 0.66, 0.46], threshold: 0.52, ramp: 0.14, scale: 2.4, salt: 73 },
    { tint: [0.92, 0.86, 0.60], threshold: 0.57, ramp: 0.14, scale: 1.9, salt: 79 },
    { tint: [0.70, 0.76, 0.66], threshold: 0.46, ramp: 0.28, scale: 4.0, salt: 83 },
  ],
};

/**
 * The islands' rock: grey basalt, dark and wet in its hollows where the spray lies, ochre with the
 * sea lichen on its dry tops, and green with the growth in its cracks. Bluer than the grey it renders,
 * as the snowfield's board is: the arena's daylight is warm.
 */
const ISLE_ROCK: GroundComposition = {
  floor: { tile: '#7e8798', ground: '#565d69' },
  patches: [
    { tint: [0.62, 0.66, 0.74], threshold: 0.55, ramp: 0.13, scale: 2.2, salt: 181 },
    { tint: [1.0, 0.88, 0.74], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 191 },
    { tint: [0.84, 0.94, 0.84], threshold: 0.47, ramp: 0.24, scale: 3.8, salt: 193 },
  ],
};

/** A ship's deck: tar in the seams, boards worn pale, boards weathered grey-green by the spray. */
const ISLE_DECK: GroundComposition = {
  floor: { tile: '#9c7a52', ground: '#6e5638' },
  patches: [
    { tint: [0.64, 0.62, 0.60], threshold: 0.58, ramp: 0.12, scale: 2.2, salt: 89 },
    { tint: [0.98, 0.96, 0.90], threshold: 0.57, ramp: 0.13, scale: 1.8, salt: 97 },
    { tint: [0.74, 0.94, 0.86], threshold: 0.47, ramp: 0.24, scale: 3.6, salt: 101 },
  ],
};

/** The deck in a storm: black wet boards, water standing in their low places. */
const ISLE_STORM_DECK: GroundComposition = {
  floor: { tile: '#7e6446', ground: '#584530' },
  patches: [
    { tint: [0.62, 0.62, 0.64], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 103 },
    { tint: [0.64, 0.86, 0.96], threshold: 0.58, ramp: 0.13, scale: 1.9, salt: 107 },
    { tint: [0.84, 0.84, 0.86], threshold: 0.46, ramp: 0.26, scale: 3.8, salt: 109 },
  ],
};

/** The gun battery's flagstones: soot round the guns, dark joints and scattered shot, lichen. */
const ISLE_BATTERY: GroundComposition = {
  floor: { tile: '#8f8a7e', ground: '#5e5a52' },
  patches: [
    { tint: [0.66, 0.64, 0.62], threshold: 0.56, ramp: 0.13, scale: 2.4, salt: 113 },
    { tint: [0.82, 0.80, 0.78], threshold: 0.58, ramp: 0.12, scale: 1.6, salt: 127 },
    { tint: [0.76, 1.0, 0.68], threshold: 0.48, ramp: 0.24, scale: 3.8, salt: 131 },
  ],
};

/** A pirate fort's yard: trodden mud, straw, and the grass the walks have not worn away. */
const ISLE_FORT: GroundComposition = {
  floor: { tile: '#8a6a46', ground: '#5e4830' },
  patches: [
    { tint: [0.74, 0.70, 0.66], threshold: 0.55, ramp: 0.14, scale: 2.4, salt: 137 },
    { tint: [1.0, 0.94, 0.72], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 139 },
    { tint: [0.80, 1.0, 0.62], threshold: 0.47, ramp: 0.24, scale: 3.8, salt: 149 },
  ],
};

/** The Sunken Hull's wet sand: weed, the lagoon's teal sheen, the wet dark where the tide lay. */
const ISLE_HULL: GroundComposition = {
  floor: { tile: '#a8946a', ground: '#3e3626' },
  patches: [
    { tint: [0.66, 0.80, 0.60], threshold: 0.56, ramp: 0.13, scale: 2.2, salt: 151 },
    { tint: [0.82, 0.96, 0.96], threshold: 0.58, ramp: 0.13, scale: 1.8, salt: 157 },
    { tint: [0.76, 0.76, 0.74], threshold: 0.46, ramp: 0.26, scale: 4.0, salt: 163 },
  ],
};

/** The Flooded Grotto's wet rock: dark cracks, pale salt rime, the green of the sea's light in pools. */
const ISLE_GROTTO: GroundComposition = {
  floor: { tile: '#5a6260', ground: '#262c2a' },
  patches: [
    { tint: [0.62, 0.64, 0.64], threshold: 0.56, ramp: 0.13, scale: 2.2, salt: 167 },
    { tint: [0.96, 0.98, 0.96], threshold: 0.59, ramp: 0.12, scale: 1.6, salt: 173 },
    { tint: [0.72, 0.90, 0.92], threshold: 0.47, ramp: 0.24, scale: 3.8, salt: 179 },
  ],
};

export const GROUND_COMPOSITION: Partial<Record<string, GroundComposition>> = {
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
  castle: CASTLE_HALL,
  lair_warren: WARREN_BURROW,
  lair_barrow: GLACIER_DEEP,
  lair_wyrm: WYRM_HOLLOW,
  // Jadeveil: Kairen's summit
  summit: CLOUD_CROWN,
  // Jadeveil's grounds, its shrines' courtyards and its two lairs
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
  shrine_1: SHRINE_COURT,
  shrine_2: SHRINE_COURT,
  shrine_3: SHRINE_COURT,
  shrine_4: SHRINE_COURT,
  lair_silk: SILK_HOLLOW,
  lair_hall: SILENT_HALL,
  // The archipelago's grounds and places, built ahead of its world
  isle_beach: ISLE_SAND,
  isle_jungle: ISLE_JUNGLE,
  isle_rock: ISLE_ROCK,
  deck: ISLE_DECK,
  deck_storm: ISLE_STORM_DECK,
  port: ISLE_SAND,
  battery: ISLE_BATTERY,
  pirate_fort: ISLE_FORT,
  lair_hull: ISLE_HULL,
  lair_grotto: ISLE_GROTTO,
};

// ─── The field ───────────────────────────────────────────────────────────────

/** Deterministic 0..1 at a lattice point. Same hash form as `tileHash`. */
function lattice(ix: number, iy: number, salt: number): number {
  const h = Math.sin(ix * 127.1 + iy * 311.7 + salt * 74.7) * 43758.5453;
  return ((h % 1) + 1) % 1;
}

/** Hermite ease, so the field has no visible lattice lines. */
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Value noise, bilinear over the axial lattice.
 *
 * Axial rather than world-space on purpose: the patches are read *per hex*, so
 * a field sampled in world units would be evaluated at points that the hex grid
 * then quantises anyway, and the axial basis is skewed in exactly the way the
 * hexes are — which makes a blob come out hexagonally rounded rather than as an
 * axis-aligned rectangle rotated into place.
 */
export function patchNoise(x: number, y: number, salt: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = lattice(x0, y0, salt);
  const b = lattice(x0 + 1, y0, salt);
  const c = lattice(x0, y0 + 1, salt);
  const d = lattice(x0 + 1, y0 + 1, salt);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/**
 * What one hex's ground is tinted by, all patches compounded.
 *
 * Multiplied rather than picked, so two patches meeting produce the third thing
 * they would produce in life — moss on bare earth — instead of one of them
 * winning by whichever was written first.
 */
/**
 * How strongly each patch claims one hex, 0 to 1.
 *
 * Separate from `groundTint` because it is the thing the *ramp* controls and
 * therefore the thing a test has to be able to see. A composition can vary a
 * board's brightness convincingly while no patch anywhere reaches full
 * strength — which is a vignette, not moss on earth — and the tint alone cannot
 * tell those two apart, because a weak patch over a dark floor and a strong one
 * over a bright floor arrive at the same number.
 *
 * Ramped from the threshold rather than switched at it: a hard edge between two
 * tinted hexes is a shape the eye reads as a mistake.
 */
export function patchStrengths(
  coord: HexCoord,
  seed: number,
  composition: GroundComposition,
): number[] {
  return composition.patches.map((p) => {
    // A band is the one field that is **not** seeded: a carpet is a fact about
    // the room and not about the fight, and a hall whose axis moved from battle
    // to battle would be a different hall each time.
    const n = p.band ? bandField(coord, p.band)
      : patchNoise(coord.q / p.scale, coord.r / p.scale, p.salt + seed);
    if (n <= p.threshold) return 0;
    return Math.min(1, (n - p.threshold) / Math.max(0.01, p.ramp));
  });
}

/**
 * 1 on the axis, 0 at `halfWidth` off it, and the same shape everywhere along.
 *
 * A perpendicular distance rather than a distance from a point: the band has no
 * end, which is right for a floor mark on a board seven hexes across — a carpet
 * that faded out before the far rim would read as a stain rather than as
 * something laid down the length of the room.
 */
function bandField(coord: HexCoord, band: AxisBand): number {
  const { x, y: z } = hexToPixel(coord);
  // Distance to the line through the origin at `bearing`: the component of the
  // position along the axis's own normal.
  const off = Math.abs(-x * Math.sin(band.bearing) + z * Math.cos(band.bearing));
  return Math.max(0, 1 - off / band.halfWidth);
}

/**
 * The band patches of a composition alone, as a tint.
 *
 * **For the ground the board does not cover.** A carpet is a made thing laid
 * down the length of a room, so it has no business stopping at the last hex a
 * unit may stand on — and the hall's near third is the cosmetic surround, which
 * is exactly where the review's shared framing complaint lives. Rendered, the
 * runner ended in mid-air at the board's rim and the foreground was the bare
 * floor it has always been.
 *
 * Bands only, and that is the whole of the rule. The noise patches are the
 * *board's* own material variation and the surround is deliberately drawn as one
 * ground fading outward — that ramp is what carries the eye to the plane, and
 * layering three blob fields over it would fight it for no gain a player could
 * name. A band is one deliberate mark and reads as one at any brightness.
 *
 * Returns `NO_TINT` for every composition that has no band, which is all of them
 * but the hall's, so nothing else in the game changes by a channel.
 */
export function bandTint(
  coord: HexCoord,
  composition: GroundComposition | null,
): Tint {
  if (!composition) return NO_TINT;
  let r = 1;
  let g = 1;
  let b = 1;
  let touched = false;
  for (const p of composition.patches) {
    if (!p.band) continue;
    const n = bandField(coord, p.band);
    if (n <= p.threshold) continue;
    const k = Math.min(1, (n - p.threshold) / Math.max(0.01, p.ramp));
    r *= 1 + (p.tint[0] - 1) * k;
    g *= 1 + (p.tint[1] - 1) * k;
    b *= 1 + (p.tint[2] - 1) * k;
    touched = true;
  }
  // **`NO_TINT` itself, not a fresh `[1, 1, 1]`.** This is called once per hex of
  // the cosmetic surround and returns nothing to do for every surface in the
  // game but one, so the caller can skip three multiplies on a `===` — the same
  // contract `questStore.report` and `applyEvent` already hold one layer over,
  // and the thing that makes "every other kit is untouched by a channel"
  // checkable rather than merely true.
  return touched ? [r, g, b] : NO_TINT;
}

export function groundTint(
  coord: HexCoord,
  seed: number,
  composition: GroundComposition | null,
): Tint {
  if (!composition) return NO_TINT;
  const strengths = patchStrengths(coord, seed, composition);
  let r = 1;
  let g = 1;
  let b = 1;
  composition.patches.forEach((p, i) => {
    const k = strengths[i];
    if (k === 0) return;
    r *= 1 + (p.tint[0] - 1) * k;
    g *= 1 + (p.tint[1] - 1) * k;
    b *= 1 + (p.tint[2] - 1) * k;
  });
  return [r, g, b];
}

/** Rec. 709, the same weighting `hexUpload` measures a tile's level with. */
export const tintLuma = (t: Tint) => t[0] * 0.2126 + t[1] * 0.7152 + t[2] * 0.0722;

/**
 * How much to brighten the material so the patches cost the board nothing.
 *
 * Every patch darkens — they have to, see `GroundPatch.tint` — so a composition
 * applied straight would take the whole board down by its own mean and move a
 * surface that `terrainDisplay.test.ts` exists to keep separated from its
 * neighbours. This is the same compensation `terrainMaterial` already applies
 * for a grain's mean, one layer out: measure what the field actually did over
 * the hexes it was applied to, and divide it back out.
 *
 * **Quantised**, because `terrainMaterial` caches on its `dim` and an unrounded
 * per-fight value would mint a material per encounter for the lifetime of the
 * process. Two decimals is under half a percent of brightness and leaves a key
 * space of a few dozen.
 */
export function tintCompensation(tints: readonly Tint[]): number {
  if (tints.length === 0) return 1;
  const mean = tints.reduce((n, t) => n + tintLuma(t), 0) / tints.length;
  return Math.round((1 / Math.max(0.2, mean)) * 100) / 100;
}
