import type { WrathWeather } from '@/models/world';
/**
 * The light rig, in one place — every scene and the harness read it.
 *
 * Pure and React-free (the `auraGlow.ts` rule) because two very different
 * consumers need it: the R3F scenes via `components/shared/SceneLights`, and
 * the plain-Three harness in a private tool. A screenshot taken under a rig the
 * game does not use is a screenshot that lies, and the harness exists to be
 * believed. `lighting.test.ts` source-scans all five for a stray light.
 */

/**
 * Every `<Canvas>` in the game passes `flat`, and this is where that is written
 * down, because it belongs to the same question these numbers answer.
 *
 * `flat` means `NoToneMapping`. R3F's default is `ACESFilmicToneMapping`, which
 * is right for a physically-based pipeline with HDR sources and wrong for this
 * one: the palette is hand-picked flat colour, shaded by one Lambert term and a
 * baked occlusion already measured against WCAG luminance. ACES then rolls the
 * whole thing down on the way to the screen.
 *
 * How far down was never visible, because the two things that could have seen it
 * both look at the authored numbers: `rosterContrast.test.ts` reads hex values,
 * and a private tool builds its own renderer, which takes *three's* default of
 * none. So the game applied a curve that no screenshot and no test measured. A
 * sweep with it forced on put the cost at **14.8% mean luma across the roster
 * and 46% on the Obsidian Legion** — the models this repo already describes as
 * rendering "as an unreadable silhouette", diagnosed as an albedo problem and
 * carrying a second, larger one nobody had looked for.
 *
 * So: no tone mapping, the harness and the game agree again, and every contrast
 * threshold in the test suite now measures what a player is actually shown.
 * `lighting.test.ts` scans for a `<Canvas>` that forgets it — a prop is not
 * something this module can hand out, so the scan is the only enforcement
 * available, exactly as it is for a stray `<ambientLight>`.
 */

/** A directional light: colour, intensity and the direction it comes from. */
export interface DirectionalRig {
  color: string;
  intensity: number;
  position: [number, number, number];
}

export interface LightRig {
  /**
   * Flat fill, reaching every face equally. Sets the floor brightness of the
   * whole game — the darkest a surface facing away from everything can be.
   */
  ambient: { intensity: number };
  /** Sky above, bounce below. Carries most of the model's sense of volume. */
  hemisphere: { sky: string; ground: string; intensity: number };
  /** The sun. The only light that casts. */
  key: DirectionalRig;
  /**
   * Cool counter-light opposite the key. A *fill*, not a rim, and the name
   * matters: rim lighting works by grazing a curved surface, and these models
   * are flat axis-aligned faces with nothing to graze. What this actually buys
   * is the −X/−Z faces, which the key never reaches and which were previously
   * lit by ambient alone.
   */
  fill: DirectionalRig;
}

/**
 * Which place a scene is lit as.
 *
 * Four, and they are named after *conditions* rather than after biomes: a
 * preset per terrain would be eight rigs to keep in step and would make the
 * difference between plains and desert a lighting question when it is a palette
 * one. What actually differs is whether there is a sun overhead, whether the
 * air is wrong, whether the light is coming through a roof, and whether the
 * town is burning.
 */
export type EnvironmentPreset = 'daylight' | 'haunted' | 'interior' | 'siege' | 'overworld';

/**
 * What Jadeveil's weather does to a rig's sun (`systems/world/wrath.ts`): the
 * key light's share and colour under each sky, the flat terms untouched, so a
 * storm darkens the lit faces and cools them while the shaded side keeps its
 * floor and every lantern and glow keeps its own light. Calm is the eye of it,
 * a little brighter and warm. Named, like the presets, so a scene says which
 * weather it is under and never how bright that is.
 */
export const WEATHER_LIGHT: Record<WrathWeather, { key: number; keyColor?: string }> = {
  clear: { key: 1 },
  clouds: { key: 0.72, keyColor: '#e6ecee' },
  rain: { key: 0.55, keyColor: '#cfdbe2' },
  storm: { key: 0.42, keyColor: '#b8c8d6' },
  calm: { key: 1.08, keyColor: '#ffe9bf' },
};

export const LIGHT_PRESETS: Record<EnvironmentPreset, LightRig> = {
  /**
   * Open ground under a sun. The rig every scene shared before presets existed.
   */
  daylight: {
    // Near where it has always been. Dropping it to 0.1 on the theory that flat
    // light washes out the baked occlusion was simply wrong: AO lives in the
    // vertex colours, so it multiplies the albedo and survives any light level.
    // All that did was take the shadow side of every model to near-black.
    //
    // 0.22 → 0.26 as part of the Step 1 shadow-side lift, and deliberately the
    // *smallest* of the three terms that moved. Ambient reaches every face
    // equally, so a point added here is a point added to the lit side too: on
    // its own it is the term with the least claim to be raised.
    ambient: { intensity: 0.26 },

    hemisphere: {
      // Warm, as the game has always been — this rig is a consolidation, not a
      // change of mood, and four scenes agreeing on the wrong colour would be a
      // bigger regression than the drift it replaces.
      sky: '#ffe2b0',
      // Lifted well off the old near-black `#0a0a20`. The Obsidian Legion is
      // black plate by design, and a ground term that dark took every downward
      // face on those models to zero.
      ground: '#4a4050',
      // 0.50 → 0.58. The largest share of the lift goes here because this is the
      // one term that is *normal-dependent without being a light source*: it
      // pays an upward face the sky colour and a downward face the ground
      // colour, so raising it lifts the dark side while keeping up and down
      // apart. That is the difference the baked occlusion is drawn in.
      intensity: 0.58,
    },

    // Unmoved. `probe-key-warmer` in the comparison took the key to #ffe6b4 and
    // every subject got *darker* — a warmer sun has less green and blue in it,
    // and luma is mostly green. The key's job here is the lit side and the
    // shadow it casts, neither of which was the complaint.
    key: { color: '#fff2d8', intensity: 0.9, position: [8, 18, 6] },

    // 0.30 → 0.38. Directional, so it lifts the −X/−Z faces the key never
    // reaches without touching the ones it does. On its own it is nearly
    // invisible — `alt-a-directional-fill` at 0.45 moved the shadow side by
    // 0.07 of 256 — because at this magnitude it is competing with a key at 0.9
    // and a hemisphere at 0.58. It is here as part of the balance, not as the
    // lever.
    fill: { color: '#89a9ff', intensity: 0.38, position: [-9, 7, -11] },
  },

  /**
   * Blighted ground. Cool, dim and *structured* rather than merely darker.
   *
   * The key drops and turns toward the colour of a sun through bad air, the
   * hemisphere goes cold, and the fill — the only light reaching the −X/−Z
   * faces — comes up rather than down, because the thing that must survive the
   * mood is the reading of a silhouette. A haunted preset that simply scaled
   * every intensity by 0.7 would be the tint pass this plan says is not enough,
   * one system over.
   */
  haunted: {
    ambient: { intensity: 0.36 },
    hemisphere: { sky: '#93aecc', ground: '#5e5878', intensity: 0.54 },
    key: { color: '#cad9e6', intensity: 0.8, position: [8, 18, 6] },
    // Cyan, and stronger than daylight's: it is doing more of the work here,
    // and it is what the reference images put in blighted ground.
    fill: { color: '#6fd8d0', intensity: 0.58, position: [-9, 7, -11] },
  },

  /**
   * Under a roof — a lair, the castle. No sky, so the hemisphere is nearly out
   * of it and the key becomes a warm torch-coloured source rather than a sun.
   *
   * The key still casts, and still comes from above: a shadow under a unit is
   * the cheapest cue that it is standing on the floor rather than hovering, and
   * losing it indoors would cost more than the realism gains.
   */
  interior: {
    ambient: { intensity: 0.38 },
    hemisphere: { sky: '#7f6e60', ground: '#6a6076', intensity: 0.5 },
    key: { color: '#ffcf96', intensity: 0.86, position: [6, 16, 7] },
    fill: { color: '#7f93c8', intensity: 0.52, position: [-9, 7, -11] },
  },

  /**
   * Sunlit open country seen from high above: the world map.
   *
   * Daylight's balance is set for figures seen from the side, where most of
   * what shows is a wall and the flat terms carry it. From the world camera
   * nearly every face on screen is a *top*, lit by every term at once, so the
   * flat terms (ambient, hemisphere) put the same light on the lit and the
   * shaded ground and the map read as a pale wash with shadows a third down.
   * Here the key carries more and the flat terms less: a shaded top keeps
   * about half of a lit one — a shadow that grounds a wood and still shows the
   * grass under it — and a wall facing the camera reads a clear step under its
   * top. Warm key and sky against a cool fill is the restrained warm/cool
   * separation the remaster's references draw, without a tone curve.
   *
   * **A low sun from the west** (board look, 2026-10-29): 38° up, from just
   * south of west, over the camera's left shoulder. Daylight's sun stood 61°
   * up from the south-east, so a tree's shadow was 0.7 of its height long and
   * lay under its own crown, and nothing on the map looked as if it stood on
   * the ground. At 38° a shadow is 1.28 of its caster's height and falls to
   * the right, onto ground the camera sees, the way the designer's reference
   * (`MAP.webp`) grounds its trees and spires; faces toward the west take the
   * key and faces away from it the cool fill, which is what makes a voxel read
   * as a block. The key is brighter to keep a lit top where it was. The
   * massif's baked hill-shade reads this same vector (`worldLandforms`), and
   * the world's shadow box follows it (`worldmap/worldShadow.ts`). The
   * shadow-side floor below holds it as it holds every preset.
   */
  overworld: {
    ambient: { intensity: 0.18 },
    hemisphere: { sky: '#ffe8c4', ground: '#706678', intensity: 0.42 },
    key: { color: '#ffefd2', intensity: 2.6, position: [-15.2, 12.3, 4.1] },
    fill: { color: '#86a2ef', intensity: 0.28, position: [12, 7, -6] },
  },

  /**
   * The city being sacked, at dusk: a low sun through smoke, and fire.
   *
   * The key drops toward the horizon and turns ember-orange, which makes every
   * lit face darker as well as warmer (luma is mostly green, and an orange sun
   * has little of it) — so the hemisphere's ground term and the ambient carry
   * more of the model than daylight's do, the way haunted's do. The fill is the
   * cold dusk sky on the faces the fire does not reach: what keeps the Legion's
   * black plate a silhouette against burning streets rather than a hole in them.
   * Still lit from in front of the board, never from behind the gate: a
   * backlit unit is a shape with no face.
   */
  siege: {
    ambient: { intensity: 0.34 },
    hemisphere: { sky: '#d99a6c', ground: '#5c4852', intensity: 0.56 },
    key: { color: '#ffb47a', intensity: 0.8, position: [10, 11, 8] },
    fill: { color: '#8f8be0', intensity: 0.5, position: [-9, 7, -11] },
  },
};

/**
 * Why the daylight numbers are what they are.
 *
 * Step 1 of the visual overhaul asked for a shadow side that reads without
 * flattening the baked occlusion, bleaching terrain or making metal look wet.
 * the removed `light-compare` script rendered six subjects — two heroes, a Dread Knight in
 * black plate, a Bulwark in a full metal set, forest scenery and a stone
 * building — under the shipped rig and seven alternatives, and measures the
 * subject's own pixels: the mean luma of their darkest quarter (the shadow
 * side), the standard deviation across them (whether one face still differs
 * from the next) and the 99th percentile (blow-out).
 *
 * What it found, against the pre-Step-1 rig:
 *
 * - **The fill alone is not the lever.** Taking it from 0.30 to 0.45 moved the
 *   shadow side by 0.07 out of 256 on a hero. It is competing with a key at 0.9.
 * - **Raising ambient does not flatten at this magnitude**, which was the
 *   expectation going in. 0.22 → 0.30 lifted the shadow side 6–18% and the
 *   spread went *up* on five of six subjects — sRGB is steep at the bottom, so a
 *   constant added in linear light opens the dark end faster than the bright.
 * - **A warmer key makes everything darker.** #fff2d8 → #ffe6b4 lost luma on
 *   every subject: warmth is green and blue removed, and luma is mostly green.
 * - **Sheen is already at the right place.** Shininess 14 → 40 changed nothing
 *   anywhere except the full metal set, where it put 4% on the 99th percentile
 *   and took the mean *down* — a narrower lobe on flat faces is the blown blob
 *   `SPECULAR` below is written against, arriving exactly as described.
 *
 * The shipped numbers spread the lift across the hemisphere, ambient and fill
 * rather than putting it all in the flat term. Against the old rig that is a
 * shadow side up 6–16% (16% on the Dread Knight, the model family this repo
 * keeps finding unreadable), spread up on five of six subjects, and a 99th
 * percentile up about 5% with its maximum at 127 of 255 — no blow-out.
 * the private project notes holds the table.
 */

/**
 * The default, and the one the model harness and every contrast test measure in.
 *
 * A named export rather than `LIGHT_PRESETS.daylight` at each call site because
 * "what is a model worth under the rig it is judged in" is a question with one
 * answer, and the whole point of this module is that there is one of it.
 */
export const LIGHT_RIG: LightRig = LIGHT_PRESETS.daylight;

/**
 * The arena's own light: a warm glow at the middle of the fight.
 *
 * **Data rather than a literal in the scene, and that is what makes an editor
 * able to tell the truth.** `SceneLights` deliberately lets a scene add a light
 * *alongside* the rig — the difference is then visible at the call site instead
 * of being a fourth set of intensities nobody knows about — and the arena is
 * the one scene that takes it. That was fine while the arena had exactly one
 * renderer. It stopped being fine when a second one appeared: Arena Forge drew
 * the four-term rig and the composition's own fixture lights and *not this*, so
 * every judgement it supported was made one light short of the fight, and the
 * one it was missing is the one standing where the units are.
 *
 * Nothing about the arrangement changes — the scene still adds it beside the
 * rig, `lighting.test.ts` still scans for a stray ambient or hemisphere — but
 * the numbers are read from here by both, so the two cannot come apart again.
 *
 * The world map and the city have no business having one, which is why it is
 * not in a preset: a preset is *what kind of place this is*, and a glow under
 * the feet of whoever is fighting is a fact about the arena.
 */
export const ARENA_GLOW = {
  position: [0, 3, 0] as [number, number, number],
  color: '#ff9030',
  intensity: 1.2,
  distance: 14,
  decay: 2,
};



/**
 * How a `metal` voxel answers the key light — the only surface property in the
 * game that is not just a colour.
 *
 * Here rather than in `voxel/` because it is a property of the rig as much as of
 * the model: a highlight is the key light seen in a surface, and tuning it
 * without the light in view is how you end up with a blade that blazes under one
 * scene's sun and is invisible under another's.
 *
 * `shininess` is deliberately low, and that is the part that had to be measured
 * rather than reasoned about. A voxel face is flat and axis-aligned, so the
 * specular term is *constant across the whole face* — there is no curvature for
 * a highlight to travel over. At 60 that produces a blown white blob on whichever
 * single face happens to point at the key and nothing anywhere else, which reads
 * as a rendering fault rather than as metal. The lobe has to be wide enough that
 * faces at 90° to each other take visibly **different** amounts of it, because
 * that disagreement between neighbouring faces is the entire effect: it is the
 * one thing a matte surface cannot do, and it is the only thing this can do.
 *
 * So the honest claim is a sheen, not a gleam — about a percent of mean luma on
 * a model carrying plate and a blade, concentrated exactly where the metal is.
 * Stronger stops reading as steel and starts reading as wet, and it adds on top
 * of an albedo already tuned against WCAG luminance, so it would blow the
 * contrast work out at the top end after years of guarding the bottom.
 */
export const SPECULAR = {
  color: '#8c93a3',
  shininess: 14,
};

/**
 * Shadow-map settings for the key light.
 *
 * Contact shadow is what makes a model sit on the ground rather than hover over
 * it — the single cheapest cue that these are objects in a place. Kept as data
 * because it is also the first thing to turn off if a real phone disagrees with
 * the headless renderer this was tuned in: SwiftShader renders shadow maps
 * faithfully and says nothing about what the device renderer costs on a mid-range device.
 */
export const SHADOWS = {
  enabled: true,
  /** Per axis. 1024 is the usual floor for a shadow that is not visibly stepped. */
  mapSize: 1024,
  /**
   * Half-extent of the shadow camera's box, in world units. Must cover the
   * arena: anything outside simply stops casting, with no warning.
   */
  extent: 14,
  near: 1,
  far: 60,
  /** Against shadow acne on the large flat faces voxel models are made of. */
  bias: -0.0012,
  normalBias: 0.02,
};

/**
 * The shadow camera's own axes for a key light at `key` (its offset from what
 * it lights): `d` along the light, from the light toward what it lights, and
 * `r`/`u` the camera's right and up, as `lookAt` builds them — right is d × up
 * and up is right × d, with the world's up as the reference. An orthographic
 * shadow box's left/right run along `r` and its bottom/top along `u`.
 */
export function shadowBasis(key: readonly [number, number, number]): {
  d: [number, number, number]; r: [number, number, number]; u: [number, number, number];
} {
  const len = Math.hypot(key[0], key[1], key[2]);
  const d: [number, number, number] = [-key[0] / len, -key[1] / len, -key[2] / len];
  const rl = Math.hypot(d[2], d[0]);
  const r: [number, number, number] = [-d[2] / rl, 0, d[0] / rl];
  const u: [number, number, number] = [
    r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0],
  ];
  return { d, r, u };
}

/**
 * How far outside the shadow box a caster's bound may stop and still be drawn
 * into the shadow pass, world units — the allowance `shadowCastRegion` adds.
 *
 * What it has to cover is small and known: three's PCF filter reads a texel
 * either side of a lookup (`2 × extent / mapSize`, under 0.03 units for the
 * rig's box) and a receiver's lookup is pushed `normalBias` along its normal.
 * Half a unit is about eighteen texels — room to spare, never so much that
 * the fill past the box goes back to casting. A caster's own height is *not*
 * in here: the region projects each bound along the light, so a tall prop's
 * long shadow is counted from its own size.
 */
export const SHADOW_CASTERS = {
  margin: 0.5,
};

/**
 * Which casters can put anything into the key light's shadow map, for a scene
 * whose shadow box stays round the origin — the arena's (`SceneLights` without
 * `follow`).
 *
 * The map is the box `extent` either side of the light's aim in the shadow
 * camera's right and up axes (`shadowBasis`), so a caster lands on it exactly
 * where its points, slid along the light, cross that square — and a receiver
 * is darkened only through a texel some caster wrote. A bound whose projection
 * along the light misses the square (grown by `margin`) therefore writes no
 * texel and darkens nothing, wherever it stands and however tall it is: its
 * height is in the projection, which is the long-shadow allowance taken from
 * the light's own direction. Drawing it in the shadow pass costs its triangles
 * a second time for nothing, which is what the arena's far fill and hill
 * columns did (the private project notes, "What the surround costs").
 *
 * Read off the box, never a radius of its own, so a later change to
 * `SHADOWS.extent` or to a preset's key moves the rule with it.
 */
export interface ShadowCastRegion {
  /** Whether anything inside this sphere can cast onto the map. */
  sphere(x: number, y: number, z: number, radius: number): boolean;
  /** Whether anything inside this axis-aligned box can. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean;
}

export function shadowCastRegion(
  key: readonly [number, number, number],
  { extent = SHADOWS.extent, margin = SHADOW_CASTERS.margin }: { extent?: number; margin?: number } = {},
): ShadowCastRegion {
  const { r, u } = shadowBasis(key);
  const reach = extent + margin;
  return {
    sphere(x, y, z, radius) {
      // The light's position projects onto the box's centre: it stands on the
      // line through the origin along the light, which is the camera's depth axis.
      const a = x * r[0] + y * r[1] + z * r[2];
      const b = x * u[0] + y * u[1] + z * u[2];
      return Math.abs(a) <= reach + radius && Math.abs(b) <= reach + radius;
    },
    box(x0, y0, z0, x1, y1, z1) {
      // A box's projection on an axis runs between its corners' least and greatest.
      const span = (v: readonly number[]) => {
        const lo = Math.min(x0 * v[0], x1 * v[0]) + Math.min(y0 * v[1], y1 * v[1]) + Math.min(z0 * v[2], z1 * v[2]);
        const hi = Math.max(x0 * v[0], x1 * v[0]) + Math.max(y0 * v[1], y1 * v[1]) + Math.max(z0 * v[2], z1 * v[2]);
        return lo <= reach && hi >= -reach;
      };
      return span(r) && span(u);
    },
  };
}

/**
 * Where the key light's target stands so its shadows fall round `focus`,
 * snapped so the shadow map's texels hold still as the focus moves.
 *
 * The key light aims at the world origin and its shadow camera is a box
 * `SHADOWS.extent` either side of that aim, so everything further out simply
 * stops casting — right for the arena and a town, which are built round the
 * origin, and wrong for a lair, which runs forty units east of it: past its
 * first chamber nothing cast a shadow at all, walls and props alike. A scene
 * whose camera travels (`SceneLights`' `follow`) moves the light with the
 * view instead.
 *
 * **Snapped, or the shadows crawl.** A shadow map re-sampled at a fraction of a
 * texel's offset puts every shadow edge on different texels each frame, which
 * reads as the edges shimmering while the camera eases. The shadow camera looks
 * along the key light with its own right and up axes; moving it only in whole
 * texels along those two keeps every texel on the same patch of ground. The
 * third axis, along the light, moves nothing on the map and is left alone.
 */
export function shadowAnchor(
  focus: { x: number; y: number; z: number },
  key: readonly [number, number, number],
): { x: number; y: number; z: number } {
  const texel = (2 * SHADOWS.extent) / SHADOWS.mapSize;
  return snapToTexels(focus, shadowBasis(key), { r: texel, u: texel });
}

/**
 * `focus` moved onto whole texels of a shadow map along a basis's right and up
 * axes (`r`, `u`), and left where it is along the light (`d`). `shadowAnchor`
 * for the shared rig's box; a scene that sizes and turns its own box — the
 * world map's, `worldmap/worldShadow.ts` — passes its own basis and texel.
 */
export function snapToTexels(
  focus: { x: number; y: number; z: number },
  basis: { d: readonly number[]; r: readonly number[]; u: readonly number[] },
  texel: { r: number; u: number },
): { x: number; y: number; z: number } {
  const { d, r, u } = basis;
  const dot = (v: readonly number[]) => focus.x * v[0] + focus.y * v[1] + focus.z * v[2];
  const a = Math.round(dot(r) / texel.r) * texel.r;
  const b = Math.round(dot(u) / texel.u) * texel.u;
  const c = dot(d);
  return {
    x: r[0] * a + u[0] * b + d[0] * c,
    y: r[1] * a + u[1] * b + d[1] * c,
    z: r[2] * a + u[2] * b + d[2] * c,
  };
}

/**
 * A shadow box a scene sizes for itself, in the shadow camera's own axes about
 * the anchor: its sides, how far back toward the light the light stands, and
 * the depth range from there.
 */
export interface ShadowBox {
  left: number;
  right: number;
  bottom: number;
  top: number;
  distance: number;
  near: number;
  far: number;
}

/**
 * How a key light's shadow follows a scene whose box the rig cannot size: the
 * world map's, which covers the camera's whole frame at every zoom
 * (`worldmap/worldShadow.ts`). Still *where* the light stands and what its
 * shadow covers, never how bright the light is — the `SceneLights` contract.
 */
export interface ShadowFollow {
  /** The box for a canvas this size; the same object until it changes. */
  box: (canvas: { width: number; height: number }) => ShadowBox;
  /** Where the light's target stands for a camera at this position, snapped to the box's texels. */
  anchor: (camera: { x: number; y: number; z: number }, box: ShadowBox) => { x: number; y: number; z: number };
  /** The shadow camera's up, which turns the box about the light (`lookAt`'s reference). */
  up: readonly [number, number, number];
  /** Shadow-map texels per axis. */
  mapSize: { width: number; height: number };
  /** Three's `shadow.intensity`: how much of the key a full shadow removes. Eased to, not set. */
  intensity: number;
}
