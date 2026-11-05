/**
 * Ground, as something other than one flat colour.
 *
 * Every hex in the game — world map, city, lair, arena — was a single albedo
 * multiplied by a per-tile brightness jitter, so a field of grass was a field of
 * *one green*. `TILE_COLOR_JITTER` varies tiles against each other and does
 * nothing at all within one, which is what makes a close camera read the map as
 * coloured paper: there is no detail to find at any zoom.
 *
 * So this generates the missing detail. Pure TypeScript producing raw pixels —
 * no `three`, no React Native — for the same reason the rest of `src/voxel/` is:
 * the arithmetic is then measurable in the node test environment, and what has
 * to be measured here is not how it looks but what it is allowed to *do* to the
 * palette. `terrainDisplay.ts` separates six terrains on a WCAG rule that took a
 * suite to get right; a texture that darkened one of them by a third would undo
 * that silently, and the ground would still look fine in a screenshot.
 *
 * **The texture only ever darkens, and that is a fact about texture maps rather
 * than a choice**: a `map` multiplies, and its texels top out at 1.0. Which is
 * why `mean` is reported back — the material divides the authored colour by it,
 * so the *average* rendered hex is exactly the colour `terrainDisplay` says it
 * is, and the texture spends its range either side of that. Without that
 * compensation every terrain in the game would sit a flat 10% darker than the
 * palette it was measured in.
 */

/** How ground of one kind is grained. Authored per terrain in `terrainDisplay`. */
export interface GroundTextureSpec {
  /**
   * Distinguishes one terrain's field from another's. Two terrains sharing a
   * seed get literally the same pattern in two colours, which reads as a repeat
   * rather than as two materials.
   */
  seed: number;
  /**
   * Noise cells across the texture. Higher is finer — grass wants a small,
   * busy grain and rock wants large slabs.
   */
  grain: number;
  /**
   * Peak-to-peak darkening, as a fraction of the base colour. `0.14` means the
   * darkest texel renders at 86% of the authored albedo.
   *
   * This is the number the contrast rule cares about. It is bounded by
   * `MAX_AMPLITUDE` and pinned by a test, because the range in which a surface
   * stops being told apart from its neighbour is exactly the range a generous
   * texture would wander into.
   */
  amplitude: number;
  /**
   * Layers of noise, each half the scale and half the strength of the last.
   * Two is enough for most ground; one is a soft wash, three is busy.
   */
  octaves?: number;
  /**
   * Stretch along one axis. Above 1 the grain smears sideways, which is what
   * separates strata, dunes and a current from generic mottling.
   */
  stretch?: number;
  /**
   * Fraction of texels taking a hard dark fleck — grit, pebbles, chaff. These
   * are what survive being seen small, where smooth noise turns back into a
   * flat colour.
   */
  fleck?: number;
  /** How dark a fleck goes, as a fraction. Additional to `amplitude`. */
  fleckDepth?: number;
  /**
   * Blocks across the texture: when given, the field and the flecks are read
   * once per block, so the grain is laid in square cells — Jadeveil's ground,
   * the voxel language its land and road are built in. Absent, the grain is
   * smooth, as every Empire ground's is.
   */
  cells?: number;
}
