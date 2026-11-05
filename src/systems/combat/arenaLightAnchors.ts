import { hexToPixel } from '@/utils/hexUtils';
import { ARENA_R_MAX } from '@/systems/combat/arenaGeometry';
import type { AuthoredLight, SceneryKit } from '@/data/display/sceneryKits';
import { ScenicProp, planClearance } from './arenaScenery';

export interface ArenaLightAnchor {
  position: [number, number, number];
  color: string;
  intensity: number;
  distance: number;
  /**
   * Which rule put it here: a fixture the composition placed, or a light the
   * kit states outright.
   *
   * `ScenicProp.from`'s argument one layer over, and for its reason. By the
   * time anything downstream sees a light it is a colour, a position and two
   * numbers, so a brazier's flame and a hand-authored fill are indistinguishable
   * — which is fine for the scene, whose job is to draw them, and is the whole
   * question for an editor, whose job is to say what a designer is looking at.
   * Purely descriptive: nothing here reads it back.
   */
  from: 'fixture' | 'authored';
  /** The prop the flame belongs to, where one does. */
  propKey?: string;
}

/**
 * What a composition may spend on local lights, and why each bound is where it
 * is.
 *
 * **Here rather than in `lighting.ts`, because two of the three are measured
 * off the board.** The rig is display data and may not reach a system; the
 * board's own radius lives in `combatEngine`. So the numbers that are *about
 * the arena* live with the function that spends them, and `lighting.ts` keeps
 * the ones that are about the rig.
 *
 * The cap was a literal `4` inside the loop below for as long as it existed,
 * which is right until something outside has to report against it: an editor
 * drawing four lights out of nine candidates has to be able to say so, or a
 * designer adds a fifth fixture and nothing anywhere tells them it will never
 * be lit.
 */
export const LIGHT_BUDGET = {
  /**
   * Non-shadowing point lights one fight may carry — fixtures and authored
   * lights together.
   *
   * Together rather than one cap each: the cost is per light on screen, and two
   * budgets that each looked affordable would add up to eight.
   */
  local: 4,
  /**
   * The brightest an authored light may be, as a multiple of the brightest
   * fixture in the game.
   *
   * Derived rather than picked, and the reason is what a fixture is *for*: a
   * lantern, a brazier, a wall torch and a cold lamp are the things in the
   * scene that visibly emit, so a light out-shining all of them by a wide
   * margin is a light with nothing on screen to explain it. Half again is
   * enough for a landmark carrying no flame of its own and not enough to make
   * the flames look unlit.
   */
  intensityFactor: 1.5,
  /**
   * How far an authored light may reach, in world units.
   *
   * The board's own circumradius plus a hex, derived from `ARENA_R_MAX` rather
   * than chosen, because a light reaching further than the ground the fight is
   * on does not light *a place on the board* — it lights the board. That is the
   * evenly lit ring this feature's acceptance names, stated as a number.
   */
  reach: hexToPixel({ q: ARENA_R_MAX + 1, r: 0 }).x,
};

/**
 * What a flame-bearing model carries, and where.
 *
 * `at` is the flame's centre in the authored model's own space, before placement
 * rotation — `sceneryProp` builds at `voxelSize: 0.1` and `modelMap` registers
 * every arena piece at scale 1, so a voxel figure divided by ten is a world one.
 * The convention is the flame's *base plus half its height*, which is where the
 * light in a fire actually is; a light at the base sits inside whatever the fire
 * is standing in and lights the floor and nothing else.
 *
 * **The colour belongs to the fixture, and that is the fix rather than a
 * detail.** Every anchor used to be the constant `#ffb65d`, which is true of the
 * two entries the table had and of nothing else: the old Barrow was lit *entirely*
 * by the cold lamp, so the tomb had glowing geometry and no glow on its stone —
 * precisely the fault the fixture lights were added to fix, in the one context
 * with nothing warm to mask it. A cold lamp lit through a warm constant would
 * have been worse than the dark: a blue flame throwing orange light.
 *
 * Every flame-bearing model is here. The two that were missing —
 * `arena_wall_torch_0` and `arena_cold_lamp_0` — both build a `flame()` and lit
 * nothing. `arena_embers_0` is the one that burns on the ground rather than
 * raised, and is listed for the same reason.
 *
 * **Completing it costs no lights.** The cap is on the *chosen* list, not on the
 * candidates: what a wider table changes is which four fixtures are picked,
 * never how many. That matters because the plan is explicit that a fifth light
 * is a decision with evidence behind it rather than a fill-in, and this item
 * deliberately does not take one.
 */
export interface Fixture {
  at: [number, number, number];
  /** The flame's own colour, from the model that draws it. */
  color: string;
  /** Relative to the warm default; a small flame lights a smaller room. */
  intensity: number;
  distance: number;
}

const FIXTURES: Record<string, Fixture> = {
  arena_lantern_0: { at: [0.38, 1.75, 0], color: '#ffb65d', intensity: 16, distance: 7 },
  arena_brazier_0: { at: [0, 1.35, 0], color: '#ffb65d', intensity: 16, distance: 7 },
  // A bracket on the inward face of a wall segment: `wallSegment` puts the flame
  // at `h * 0.52 + 3.4` up and `d / 2 + 1.3` proud of the face, which on the 52
  // -tall torch-bearing course is (0, 32.64, 4.8) in voxels.
  arena_wall_torch_0: { at: [0, 3.26, 0.48], color: '#ffb65d', intensity: 13, distance: 8 },
  // The cold wisp. Dimmer and shorter-reaching than a fire on purpose — a cold
  // light that fills a room the way a brazier fills a hall would read as
  // daylight, and what the references ask of these places is that they be
  // barely lit.
  arena_cold_lamp_0: { at: [0, 2.19, 0], color: '#7ce8d8', intensity: 11, distance: 6 },
  // A fire gone down to embers on the ground: `embers` builds its flame at 0.9
  // voxels up and 3.6 tall. The dimmest and shortest-reaching fixture in the
  // roster on purpose — it is the haunted desert's *second* fire, and a second
  // light the weight of the camp's brazier would make the two groups a pair of
  // lamps rather than a camp and the ruin beside it.
  arena_embers_0: { at: [0, 0.27, 0], color: '#ffb65d', intensity: 9, distance: 5 },
  // The sacked city's fires (`sackedCity.ts`). The gate's broken tower burns
  // at 19.8 voxels up and 8.6 tall; a burning house's roof fire at its eaves
  // (12.6 and 11.6) and 9 tall; the overturned cart at 2.4 and 7.6, lit near
  // its tip where its flame stands clear of the cart. Redder than the brazier's
  // gold, as their flames are. The houses reach furthest, because they are what
  // lights a street's two sides.
  arena_breached_gatehouse_0: { at: [0.74, 2.41, 0], color: '#ff7036', intensity: 16, distance: 8 },
  arena_burning_house_0: { at: [0.36, 1.71, 0], color: '#ff7036', intensity: 16, distance: 8 },
  arena_burning_house_1: { at: [0.36, 1.61, 0], color: '#ff7036', intensity: 16, distance: 8 },
  arena_street_fire_0: { at: [0.06, 0.82, 0], color: '#ff7036', intensity: 13, distance: 6 },
  // The outer streets' burning houses (`farBurningHouse`): the fire stands out of
  // the shell from 12.4 voxels up on the plaster house, and 11.4 at the ashlar
  // house's taller gable fire.
  arena_far_burning_house_0: { at: [0.12, 1.6, 0], color: '#ff7036', intensity: 16, distance: 8 },
  arena_far_burning_house_1: { at: [-0.32, 1.6, 0.08], color: '#ff7036', intensity: 16, distance: 8 },
  // The Warren's cook fire (`lairArena.ts`): its flame stands on the sticks at 0.9
  // voxels and is 4.6 tall, low and short-reaching, a camp's fire in a burrow.
  arena_burrow_fire_0: { at: [0, 0.3, 0], color: '#ff8a2e', intensity: 12, distance: 6 },
  // The lairs' own fires, off the dungeon set: a torch's basket is built at
  // 7.1–8.6 voxels up and a brazier's coals at 4.1–5.3, both on a footprint the
  // flame is centred over. A flame is a flame wherever it stands, which is why
  // the walkable lairs light from this table rather than a second one.
  dungeon_torch: { at: [0, 0.82, 0], color: '#ffb65d', intensity: 13, distance: 6 },
  dungeon_brazier: { at: [0, 0.5, 0], color: '#ffb65d', intensity: 16, distance: 7 },
  // Each lair's own (`voxel/models/lairProps.ts`). The Hollow's vents burn at
  // the floor, lighting the rock round them from below and nothing far off.
  // The ice lair's crystal glows cold from inside its tallest shard, about four
  // voxels up, dim and short because the glacier is meant to be barely lit; the
  // Empire's braziers burn red six voxels up over their bowls and are the only
  // warm light in it; and the drain's vessel holds the Heart's own cyan at the
  // back of the boss's hall.
  lair_ember_vent: { at: [0, 0.12, 0], color: '#ff7a30', intensity: 10, distance: 5 },
  lair_ice_crystal: { at: [0, 0.42, -0.05], color: '#5ae0ff', intensity: 9, distance: 5 },
  lair_blood_brazier: { at: [0, 0.62, 0], color: '#ff4a2a', intensity: 12, distance: 6 },
  lair_drain_engine: { at: [0, 0.46, -0.04], color: '#5ae0ff', intensity: 11, distance: 6 },
  // Jadeveil: Silent Hall / Fallen Order — the stone lantern's paper window, five
  // voxels up, warm and dim: the hall is meant to be quiet; and the red candles
  // either side of the master's seat
  lair_hall_lamp: { at: [0, 0.5, 0], color: '#ffcf7a', intensity: 10, distance: 5 },
  lair_hall_seat: { at: [0, 0.42, 0.06], color: '#ff4a3a', intensity: 9, distance: 5 },
  // Jadeveil: Silk Hollow / Yokai — foxfire in a paper lantern, the Hollow's only light: cold, pale, short
  lair_foxfire_lantern: { at: [0.18, 0.5, 0.1], color: '#9fe6ff', intensity: 10, distance: 6 },
  // Jadeveil's arena kit (`jadeArena.ts`): the stone lantern's firebox, 7.7–10.2 voxels up, lit
  // the pale gold of its paper window; and the yokai's foxfire, the haunted arenas' only light,
  // the white-cyan of the flame's core — the wisp's largest flame at 13.4–17 voxels, the cold
  // lantern's wisp hanging 4 voxels off its firebox at 8.2–10.8.
  arena_jade_lantern_0: { at: [0, 0.9, 0], color: '#fff4dc', intensity: 12, distance: 6 },
  arena_jade_wisp_0: { at: [0, 1.52, 0], color: '#c4f3ff', intensity: 9, distance: 6 },
  arena_jade_cold_lantern_0: { at: [0.4, 0.95, 0.16], color: '#c4f3ff', intensity: 8, distance: 5 },
  // The archipelago's kit (`isleArena.ts`): the port's and the fort's lamps and the fort's cook
  // fire, orange — yellow light is Varr's alone — and the Flooded Grotto's lanterns, the sirens'
  // green. The lamp's flame is 11.2–13 voxels up, the fire's 1.4–5, the lantern's glass 7.2–9.6
  // and 2.4 out on its arm.
  arena_isle_lamp_0: { at: [0, 1.21, 0], color: '#ff6a24', intensity: 10, distance: 5 },
  arena_isle_fire_0: { at: [0, 0.28, 0], color: '#ff8a2a', intensity: 12, distance: 6 },
  arena_isle_lantern_0: { at: [0.24, 0.84, 0], color: '#8ff0c8', intensity: 10, distance: 6 },
};

/**
 * How far off the board a fixture may stand and still light the fight, world
 * units of plan clearance (`planClearance`): about three hexes.
 *
 * **A light is for the ground the fight is on.** The spread rule picks the
 * candidate furthest from those already chosen, which is right among a ring of
 * lanterns and wrong once a composition burns out to the camera's reach: the
 * siege's outer streets and the Legion's camp fires are ten to thirty units off,
 * and the spread spent all four lights there and left the street the party fights
 * in unlit. Every lantern, lamp and brazier the open-air arenas and the Empire's
 * lairs chose stood within 4.6. Further fixtures keep their glowing flames; they
 * throw no light.
 */
export const FIXTURE_REACH = 5;

/** The light a keyed prop's flame gives, or `null` for anything that does not burn. */
export const fixtureLight = (key: string): Readonly<Fixture> | null => FIXTURES[key] ?? null;

/**
 * The brightest thing in the scene that visibly emits, which is what an
 * authored light is measured against.
 *
 * Derived from the table rather than written beside it, so a fixture retuned
 * brighter carries the ceiling with it — the anti-drift rule this repository
 * keeps everywhere a bound is stated in terms of something else.
 */
export const brightestFixture = (): number =>
  Math.max(...Object.values(FIXTURES).map((fixture) => fixture.intensity));

/** Which keys carry a flame at all — what an editor may offer as a light source. */
export const fixtureKeys = (): string[] => Object.keys(FIXTURES);

/**
 * Where a fixture's flame stands once its prop has been placed.
 *
 * Split out of the walk below so the editor can ask the same question of one
 * prop: what a designer needs to know about a light is *which fixture* it came
 * off, and re-deriving that in a second place is how the flame and the light it
 * casts come to disagree about where the fire is.
 */
function fixtureAnchor(prop: ScenicProp): ArenaLightAnchor | null {
  const fixture = FIXTURES[prop.propKey];
  if (!fixture) return null;
  const local = fixture.at;
  const centre = hexToPixel(prop.coord);
  const c = Math.cos(prop.rotationY);
  const s = Math.sin(prop.rotationY);
  return {
    position: [
      centre.x + prop.offsetX + (local[0] * c + local[2] * s) * prop.scale,
      // **The ground the fixture stands on, plus its own height.** This read
      // `local[1] * scale` alone, which is the board's plane — true of every
      // arena until a kit could declare a `shelf`, and false the moment one
      // could: a brazier that has followed the land down a six-unit drop threw
      // its light from six units above itself. `GroupPiece.lift` makes it wrong
      // in the other direction too, at the one fixture the pass's gate is read
      // by. `tileTop` is the same field the prop is drawn at, so the flame and
      // the light it casts cannot disagree about where the fire is.
      (prop.tileTop ?? 0) + local[1] * prop.scale,
      centre.y + prop.offsetZ + (local[2] * c - local[0] * s) * prop.scale,
    ],
    color: fixture.color,
    intensity: fixture.intensity,
    distance: fixture.distance,
    from: 'fixture',
    propKey: prop.propKey,
  };
}

/**
 * Every light this composition could carry, before the budget is applied.
 *
 * **Exposed because "four of nine" is the only honest thing an editor can say.**
 * The cap is on the chosen list, so a designer adding a fifth brazier sees no
 * change at all on screen and has nothing telling them why — which is exactly
 * the "excessive lights" this feature is asked to flag. The scene never needs
 * this; it wants the four.
 *
 * Authored lights come **first**, and that is a decision rather than an
 * ordering accident: a kit that states a light has said something specific
 * about this ground, where a fixture is wherever the composition happened to
 * put one. See {@link arenaLightAnchors}.
 */
export function arenaLightCandidates(
  props: readonly ScenicProp[], kit?: SceneryKit | null,
): ArenaLightAnchor[] {
  const authored = (kit?.lights ?? []).map((light) => ({
    position: [light.at[0], light.at[1], light.at[2]] as [number, number, number],
    color: light.color,
    intensity: light.intensity,
    distance: light.distance,
    from: 'authored' as const,
  }));
  const fixtures = props.flatMap((prop) => {
    const anchor = fixtureAnchor(prop);
    return anchor && planClearance(anchor.position[0], anchor.position[2]) <= FIXTURE_REACH ? [anchor] : [];
  }).sort((a, b) => a.position[2] - b.position[2]);
  return [...authored, ...fixtures];
}

/**
 * The lights a fight actually draws: at most {@link LIGHT_BUDGET}`.local`,
 * spread over the candidates.
 *
 * Glowing geometry alone cannot put warm light on neighbouring ground or stone,
 * and a point light is a per-fragment cost on every surface inside its reach —
 * so the answer is a few, placed as far apart as the candidates allow. Farther
 * fixtures keep their unlit flames.
 *
 * **An authored light is never passed over for a fixture.** The spread rule
 * picks whichever candidate is furthest from what is already chosen, which is
 * the right way to choose between fixtures — they are wherever the composition
 * put them — and the wrong way to weigh one against a light a kit stated
 * outright: a designer who places a light has said *this ground wants a light
 * here*, and a brazier rolled onto the far flank out-spreading it would silently
 * delete that. So the authored ones are taken first, in order, and the spread
 * runs over what is left of the budget.
 */
export function arenaLightAnchors(
  props: readonly ScenicProp[], kit?: SceneryKit | null,
): ArenaLightAnchor[] {
  return pickLights(arenaLightCandidates(props, kit));
}

/**
 * The budget applied to a list of candidates, as its own step.
 *
 * **Split out so a caller can hold both halves of one answer.** An editor
 * reporting "four of nine" needs the candidates *and* the chosen, and asking
 * for each separately returns two independently built lists — so "which of
 * these nine did not make it" cannot be answered by comparison, and a filter
 * written that way silently reports every candidate as spare. Found by the
 * suite rather than by reading: the picked lights are members of the list
 * handed in, which is only true while there is one list.
 */
export function pickLights(candidates: readonly ArenaLightAnchor[]): ArenaLightAnchor[] {
  const rest = candidates.filter((light) => light.from === 'fixture');
  const chosen: ArenaLightAnchor[] = [];
  // Authored first and in the order the kit states them, so a kit that names
  // more than the budget loses its last rather than an arbitrary one.
  for (const light of candidates) {
    if (light.from !== 'authored' || chosen.length >= LIGHT_BUDGET.local) continue;
    chosen.push(light);
  }
  while (rest.length && chosen.length < LIGHT_BUDGET.local) {
    let index = 0;
    let furthest = -1;
    rest.forEach((light, i) => {
      const separation = Math.min(...chosen.map((other) =>
        Math.hypot(light.position[0] - other.position[0], light.position[2] - other.position[2])));
      if (separation > furthest) { index = i; furthest = separation; }
    });
    chosen.push(rest.splice(index, 1)[0]);
  }
  return chosen;
}
