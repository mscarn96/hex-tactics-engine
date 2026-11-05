import { EnvironmentPreset } from '@/data/display/lighting';
import type { ArenaSite } from '@/models/encounter';
import { ARENA_SITES } from '@/data/display/arenaLayout';
import { SceneryKit } from '@/data/display/sceneryKits';
import { GroundComposition } from '@/data/display/groundPatches';
import { arenaCompositionFor } from '@/data/display/arenaCompile';
import { arenaLayouts } from '@/data/display/arenaLayouts';
import { EncounterContext, JadeGround, MapTile, TileType } from '@/models/types';
import {
  SurfaceDisplay, SURFACE_DISPLAY, TERRAIN_DISPLAY, DANGER_DISPLAY, JADE_DISPLAY, DANGER_JADE_DISPLAY,
  ISLE_DISPLAY, IsleSurface, TERRAIN_VARIANTS, arenaSurface, openCountry,
} from '@/data/display/terrainDisplay';

/**
 * What ground a fight is fought on, resolved once.
 *
 * A pure resolver rather than an `??` at each read site, because there were two
 * read sites and they had already drifted: one picked the board's colour and the
 * other picked the background image, both by reaching into `worldMapStore` for
 * the party's *world map* hex. For a lair fight that hex is the lair's door on
 * the overworld, so the inside of a dungeon was coloured by whatever terrain
 * noise sat under its entrance.
 *
 * **Threat depth deliberately does not ride here, and `threat` stays unconsumed.**
 * Depth is a property of *ground* — how far a tile sits through its band — and a
 * curated fight has no ground: a lair chamber composes at its `LairSpec.band`, a
 * quest site at `QUEST_BAND`, the gauntlet at its tier. Carrying a depth on the
 * context would hand every one of them the depth of the hex their *door* happens
 * to occupy, which is the same bug in a new field: the inside of a dungeon
 * scaled by the noise under its entrance. Curated fights take `neutralDepth`
 * instead — the depth at which a band scales by exactly one — so this whole
 * mechanism leaves them numerically untouched, which is the strongest available
 * form of "a curated fight ignores the ground it stands on".
 *
 * The overworld path has a coordinate in hand at the moment it needs one, so it
 * reads `threatDepth(partyPosition, city, castle)` directly rather than through
 * a field that would have to be kept in step with it forever.
 */

/** Everything the arena needs to dress itself. */
export interface ArenaScenery {
  /** Albedo of the board's hexes, already dimmed for the fight. */
  tile: string;
  /** Fill under and around the board. */
  ground: string;
  roughness: number;
  metalness: number;
  /**
   * Prop ids the border ring draws from. Empty means bare surroundings.
   *
   * A list rather than a family name, because the two sources are shaped
   * differently: terrain decoration is four numbered variants of one family,
   * while a dungeon's furniture is a set of unrelated shapes.
   */
  propKeys: string[];
  /** Backdrop terrain, for the blurred photo behind the canvas. `null` indoors. */
  backdrop: TileType | null;
  /**
   * What this ground is *called* — `forest`, `danger_swamp`, `stone`.
   *
   * The board carried a colour and no name, which was enough while ground was a
   * flat albedo and stopped being enough the moment it grew a grain: the arena
   * would have had to re-derive "which terrain am I standing on" from a hex
   * string to look one up. Same key space `tileSurfaceKey` and `LocationSurface`
   * use, and therefore the same one `grainFor` answers to.
   */
  surfaceKey: string;
  /**
   * The authored composition for this surface, when it has one.
   *
   * `null` is the ordinary case and means "dress me from `propKeys`" — the
   * behaviour every arena had before kits existed. Opt-in per surface rather
   * than a flag over the whole system, because the thirteen reference contexts
   * are built one at a time and a half-converted arena has to keep looking like
   * the game rather than like an unfinished one.
   */
  kit: SceneryKit | null;
  /**
   * The ground composition for this fight, resolved by the same key the kit is.
   *
   * Carried rather than looked up again in the scene: the key is not always the
   * surface — see `compositionKey` below — and a second derivation of it is a
   * second answer, which is the drift this whole module exists to end.
   */
  composition: GroundComposition | null;
}

/**
 * Falls back to the world tile, then to plains.
 *
 * Nothing should regress by omission: a call site that forgets to pass a context
 * lands on exactly the behaviour it had before this existed.
 */
export function resolveEncounterContext(
  explicit: EncounterContext | null | undefined,
  worldTile: MapTile | undefined,
): EncounterContext {
  if (explicit) return explicit;
  return {
    kind: 'world',
    terrain: worldTile?.type ?? TileType.Plains,
    danger: worldTile?.zone === 'haunted',
    threat: worldTile?.threat ?? 0,
    // A Jadeveil tile carries its ground, so its fight is fought in that ground's arena
    ...(worldTile?.jade && { jade: worldTile.jade }),
    // And an archipelago tile its own: its beach, its jungle or its rock
    ...(worldTile?.isle && { isle: worldTile.isle }),
    // A village tile holds no fight but its garrison's, fought in the village's arena
    ...(worldTile?.village && { village: worldTile.village }),
  };
}

/**
 * Which light preset a fight is lit under.
 *
 * Here rather than in `CombatScene` for the reason `sceneryFor` is: this file
 * already owns "what kind of place is this fight happening in", and a scene that
 * branches on biome to pick a light becomes the catalogue of biome-specific
 * settings Section 3A says it must not be.
 *
 * Indoors wins over blight: a lair or the castle is fought under a roof whatever
 * the ground outside its door is doing, which is the same mistake — reading the
 * overworld hex for something that happens inside — that gave this module its
 * reason to exist.
 */
export function environmentFor(context: EncounterContext): EnvironmentPreset {
  if (context.kind === 'location') {
    // The only fight the city ever holds is the Legion sacking it.
    if (context.location === 'city') return 'siege';
    return openCountry(context) ? 'daylight' : 'interior';
  }
  return context.danger ? 'haunted' : 'daylight';
}

/**
 * The Jadeveil ground a world fight stands on, if any: its tile's own (`EncounterContext.jade`),
 * or a shrine courtyard's paving when it is fought as one.
 */
function jadeOf(context: EncounterContext): JadeGround | undefined {
  if (context.kind !== 'world') return undefined;
  return context.site === 'shrine' ? 'shrine' : context.jade;
}

/**
 * The surface each of the archipelago's sites is fought on (the private project notes):
 * a ship's deck, the port's beach, the battery's flagstones, a fort's dirt, the lairs' wet sand
 * and wet rock.
 */
const SITE_ISLE: Partial<Record<ArenaSite, IsleSurface>> = {
  deck: 'deck', deck_storm: 'deck_storm', port: 'beach', battery: 'flagstone', pirate_fort: 'dirt',
  lair_hull: 'wet_sand', lair_grotto: 'wet_rock',
};

/**
 * The archipelago surface a world fight stands on, if any: its site's floor, or its ground's
 * (`EncounterContext.isle`).
 */
function isleOf(context: EncounterContext): IsleSurface | undefined {
  if (context.kind !== 'world') return undefined;
  return (context.site ? SITE_ISLE[context.site] : undefined) ?? context.isle;
}

/** The surface a context is fought on, before arena dimming. */
function surfaceFor(context: EncounterContext): SurfaceDisplay {
  if (context.kind === 'location') {
    return SURFACE_DISPLAY[context.surface] ?? SURFACE_DISPLAY.stone;
  }
  // The archipelago's grounds and places are their own surfaces
  const isle = isleOf(context);
  if (isle) return ISLE_DISPLAY[isle];
  // Jadeveil's grounds are their own surfaces, as on the map
  const jade = jadeOf(context);
  if (jade) return (context.danger ? DANGER_JADE_DISPLAY : JADE_DISPLAY)[jade];
  // Scorched ground stays scorched under the party's feet — a fight on a danger
  // tile is the fight that tile exists for.
  const danger = context.danger ? DANGER_DISPLAY[context.terrain] : undefined;
  return danger ?? TERRAIN_DISPLAY[context.terrain] ?? TERRAIN_DISPLAY[TileType.Plains];
}

/**
 * The name of that surface, derived by the same branches `surfaceFor` takes.
 *
 * Two functions rather than one returning a pair, because the display table is
 * looked up by several callers and the key by one — but they must not disagree
 * about which branch a context falls down, so the branches are written
 * identically and the danger fallback is checked the same way.
 */
function surfaceKeyFor(context: EncounterContext): string {
  if (context.kind === 'location') {
    return SURFACE_DISPLAY[context.surface] ? context.surface : 'stone';
  }
  const isle = isleOf(context);
  if (isle) return `isle_${isle}`;
  const jade = jadeOf(context);
  if (jade) return `${context.danger ? 'danger_' : ''}jade_${jade}`;
  if (context.danger && DANGER_DISPLAY[context.terrain]) return `danger_${context.terrain}`;
  return TERRAIN_DISPLAY[context.terrain] ? context.terrain : TileType.Plains;
}

/**
 * What stands around a fight indoors.
 *
 * The bulky, architectural half of the dungeon set: things that read as the edge
 * of a chamber. The small floor clutter — bones, mushrooms, scorch marks — is
 * for walking past in a lair, not for framing a battle from three hexes away.
 */
const INTERIOR_SCENERY = [
  'dungeon_pillar_0',
  'dungeon_pillar_1',
  'dungeon_broken_wall',
  'dungeon_rubble_0',
  'dungeon_rubble_1',
  'dungeon_stalagmite_0',
  'dungeon_torch',
];

const variantsOf = (family: string | null): string[] =>
  family === null
    ? []
    : Array.from({ length: TERRAIN_VARIANTS }, (_, v) => `${family}_${v}`);

/**
 * What the border ring scatters when nothing is composed for the ground.
 *
 * Indoors, the dungeon's furniture. On the world map, the terrain's own
 * family. A location fought in the open air takes its country's: the city's
 * streets are paved, and paving has no family, so before it is composed the
 * siege stands in the farmland round the walls rather than in a cellar.
 */
function scatterFor(context: EncounterContext, dimmed: SurfaceDisplay): string[] {
  // Jadeveil's grounds borrow the Empire's map families for their *map* decoration; an arena
  // there is dressed by its own kit and never falls back to them.
  if (jadeOf(context) || isleOf(context)) return [];
  if (context.kind === 'world') return variantsOf(dimmed.propFamily);
  const country = openCountry(context);
  if (country === null) return INTERIOR_SCENERY;
  return variantsOf(TERRAIN_DISPLAY[country]?.propFamily ?? null);
}

/**
 * What a fight's *composition* is looked up under, which is not always its
 * surface.
 *
 * On the world map the two are the same: `forest` names a palette, a grain, a
 * kit and a floor, and one name in four tables is the arrangement the whole
 * display layer is built on. In a location the surface is the wrong grain of
 * answer — the castle, the city and a lair fight with no tile to read all come
 * back `stone`, and a kit keyed on that would put the Emperor's throne room
 * inside the lairs, which the plan calls out by name as the thing not to do. A
 * location is looked up by its own name whether it is fought indoors or out.
 */
/**
 * What a site's fight stands on, beneath its own arena: the summit is the range's mountain, in
 * its crown; a shrine stands on level ground paved round it.
 */
const SITE_TERRAIN: Record<ArenaSite, TileType> = {
  summit: TileType.Mountain, shrine: TileType.Plains,
  // The archipelago's: a deck and the grotto out on the sea, the port and the hull on sand, the
  // battery on its crag, a fort in an island's open ground
  deck: TileType.Water, deck_storm: TileType.Water, port: TileType.Desert, battery: TileType.Mountain,
  pirate_fort: TileType.Plains, lair_hull: TileType.Desert, lair_grotto: TileType.Water,
};
const SITE_JADE: Partial<Record<ArenaSite, JadeGround>> = { summit: 'crown', shrine: 'shrine' };

/** Whether an arena key is a world site's (`EncounterContext.site`). */
export const isArenaSite = (key: string): key is ArenaSite => (ARENA_SITES as readonly string[]).includes(key);

/** A site's fight context in general — what an editor or a suite opens its arena with. */
export const siteContext = (site: ArenaSite): EncounterContext => {
  const jade = SITE_JADE[site];
  // A boarding fight begun at a storm's edge is fought in the storm
  const weather = site === 'deck_storm' ? 'storm' as const : undefined;
  return { kind: 'world', terrain: SITE_TERRAIN[site], danger: false, threat: 4, ...(jade && { jade }), ...(weather && { weather }), site };
};

/** The bands a shrine stands in: shrine `i` in band `i` (`systems/world/shrines.ts`). */
export const SHRINE_ARENA_BANDS = [1, 2, 3, 4] as const;

/**
 * The shrine courtyard dressed for a band: `shrine_1` … `shrine_4`.
 *
 * **One courtyard, four dressings.** Every keepers' fight is fought in the same paved precinct —
 * the shrine behind its torii, the lanterns, the censer, the bell — and what changes with the band
 * is the country round it: the low forest's moss and bamboo, the terraces' tea, the ridge's prayer
 * flags, the storm crown's crags and bells. Keyed by band rather than by shrine because the band is
 * what the ground round it is (shrine `i` stands in band `i`), and the paving round a shrine is
 * fought in the same courtyard as its keepers.
 */
export const shrineArenaKey = (threat: number): string =>
  `shrine_${Math.min(4, Math.max(1, Math.round(threat)))}`;

/** A held village's own arena, where its garrison is fought: `village_lookout`, `village_smithy`, … */
export const villageArenaKey = (village: NonNullable<Extract<EncounterContext, { kind: 'world' }>['village']>): string =>
  `village_${village}`;

/** A village garrison's fight — what an editor or a suite opens its arena with. */
export const villageContext = (
  village: NonNullable<Extract<EncounterContext, { kind: 'world' }>['village']>,
): EncounterContext => ({ kind: 'world', terrain: TileType.Plains, danger: false, threat: 2, village });

/** A shrine courtyard's fight in a given band — what an editor or a suite opens it with. */
export const shrineContext = (band: number): EncounterContext =>
  ({ ...siteContext('shrine'), threat: band } as EncounterContext);

/**
 * A Jadeveil world fight's arena key: its ground's own (`jade_moss`, `danger_jade_ridge`, …),
 * and a shrine's courtyard for the paved ground round a shrine — so no fight on the range is
 * dressed as the Empire's terrain under it would be. `jadeveilArenas.test.ts` pins that.
 */
function jadeKeyFor(jade: JadeGround, danger: boolean, threat: number): string {
  if (jade === 'shrine') return shrineArenaKey(threat);
  return `${danger ? 'danger_' : ''}jade_${jade}`;
}

export function compositionKeyFor(context: EncounterContext): string {
  if (context.kind === 'location') return context.location;
  if (context.village) return villageArenaKey(context.village);
  if (context.site === 'shrine') return shrineArenaKey(context.threat);
  if (context.site) return context.site;
  if (context.isle) return `isle_${context.isle}`;
  if (context.jade) return jadeKeyFor(context.jade, context.danger, context.threat);
  return surfaceKeyFor(context);
}

/**
 * A composition and a kit to use in place of the ones the tables hold.
 *
 * **For an editor, and it is a parameter rather than a second function.**
 * `sceneryFor` decides four things off one lookup — the board's albedo, the
 * plane's, the kit and the composition — and which of those a `floor` may
 * answer for depends on whether the fight is indoors. An editor assembling that
 * result by hand would be a second copy of that branch, drifting from this one
 * the day either changes; asking the same function is one answer.
 *
 * The game passes nothing, so every arena resolves exactly as it always has.
 */
export interface SceneryOverride {
  kit?: SceneryKit;
  composition?: GroundComposition;
}

export function sceneryFor(
  context: EncounterContext, override?: SceneryOverride,
): ArenaScenery {
  const dimmed = arenaSurface(surfaceFor(context));
  const key = surfaceKeyFor(context);
  const compositionKey = compositionKeyFor(context);
  /**
   * The composition for this ground, authored files first and the code-authored
   * kits behind them.
   *
   * **One lookup rather than two**, and that is what makes adopting a layout a
   * one-line change to a data file instead of a change here. `sceneryFor` used
   * to index `GROUND_COMPOSITION` and `SCENERY_KITS` itself, which is fine
   * while the tables are the only answer and becomes a second migration seam
   * the moment they are not — one of the two would eventually be asked and the
   * other forgotten, and the symptom is an arena wearing a layout's props on
   * the table's floor.
   *
   * `null` is still the ordinary case and still means "dress me from
   * `propKeys`": neither the file nor the table has anything to say about this
   * ground.
   */
  const authored = arenaCompositionFor(compositionKey, arenaLayouts());
  // A surface with an authored arena floor uses it for the board *and* the
  // cosmetic ring around it: they are the same country, and the boundary
  // between them is told apart by seams rather than by a change of colour.
  const composition = override?.composition ?? authored?.composition ?? null;
  const floor = composition?.floor;
  return {
    tile: floor?.tile ?? dimmed.tile,
    // A location brings its own ground colour, so the disc under a lair's board
    // matches the floor the party walked in over. Not the siege's: nobody walks
    // into a sacked street over the town's lawn, so an open-air place takes its
    // authored floor the way a world fight does.
    ground: context.kind === 'location' && (openCountry(context) === null || !floor)
      ? context.ground
      : floor?.ground ?? dimmed.ground,
    roughness: dimmed.roughness,
    metalness: dimmed.metalness,
    propKeys: scatterFor(context, dimmed),
    // Indoors there is no horizon to photograph. A lair fight showing a blurred
    // meadow behind it is the same bug as a lair fight on grass.
    backdrop: openCountry(context),
    surfaceKey: key,
    // Read off the same key the floor is, and out of the same lookup — a place
    // that has both is one name answered once, rather than two names that have
    // to be kept in step.
    kit: override?.kit ?? authored?.kit ?? null,
    composition,
  };
}
