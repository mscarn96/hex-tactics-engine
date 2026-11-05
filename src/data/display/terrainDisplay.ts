import { EncounterContext, HexCoord, IsleGround, JadeGround, MapTile, POIType, TileType } from '@/models/types';
// Type-only: erased at compile time, so this cannot close a runtime cycle back
// through `locations/`. `LocationSurface` is the location vocabulary's answer to
// `TileType`, and both name the same thing — what the ground under you is.
import type { LocationId, LocationSurface } from '@/locations/types';
// One function, over pure data. `npcData` has no React Native, no `three` and
// no `honeycomb-grid` in its import graph, so this keeps every promise the file
// header makes below.
import { npcPropKey } from '@/quests/npcData';
import { isQuestSiteId } from '@/quests/sites';
// Also pure — raw pixel arithmetic with no `three` in sight. `GRAIN` below is
// data about how ground looks, which is this file's whole subject.
import type { GroundTextureSpec } from '@/data/display/groundTextureSpec';

/**
 * How ground looks, in one place.
 *
 * This used to be three tables in three component files — `terrainMaterials` in
 * `WorldMapScene`, `ARENA_TERRAIN` in `CombatScene` and `SURFACE_MATERIALS` in
 * `LocationScene` — which is why the arena had no entry for Water and no way to
 * be coloured by the lair it was fought in. Same pattern as `statusDisplay` and
 * `itemDisplay`: the table lives in `data/display/`, the scenes read it.
 *
 * Pure, and deliberately free of `three` and of `utils/hexUtils` — the first so
 * a node test can measure the colours, the second so `voxel/models/props.ts` can
 * import `TERRAIN_VARIANTS` without dragging `honeycomb-grid` into every voxel
 * suite. `HexCoord` comes from `models/hex.ts`, which is the interface, not the
 * grid library.
 */
export interface SurfaceDisplay {
  /** Albedo of the hex prism itself. */
  tile: string;
  /** Fill under and around it — the arena's disc, a location's ground plane. */
  ground: string;
  roughness: number;
  metalness: number;
  /**
   * Amplitude of per-tile elevation noise, in `MapTile.height` units.
   *
   * **Positive-only.** `HexGridMesh` only stretches the prism down to y = 0 when
   * elevation is above zero; a negative value lifts the disc off the ground and
   * opens a gap to its neighbours, which on the world map is a hole through to
   * the fog colour.
   */
  relief: number;
  /**
   * Prop family a fight on this ground is decorated with, as a
   * `WORLD_PROP_DEFS` key prefix, when its arena has no kit of its own. `null`
   * means the ground carries no scenery. The world map no longer reads it: its
   * hexes are composed from the strategic kit (`worldScenery.ts`).
   */
  propFamily: string | null;
  /**
   * The arena's dim for this surface, where `ARENA_DIM` would leave the board
   * too pale for the board's own highlights. Only snow needs it: at 0.88 a
   * Tundra board sat 21.6 ΔE from the active unit's white ring, under the 30
   * `combatHud.test.ts` holds every highlight to on every ground.
   */
  arenaDim?: number;
}

/**
 * Eight variants per terrain family: `terrain_forest_0` … `_7`.
 *
 * These are an arena's fallback scatter now — the ground a fight is dressed
 * with when its surface has no kit — and no longer the world map's decoration,
 * which is composed per hex from the strategic kit (`worldScenery.ts`). A
 * variant is built once at module load, so the count costs nothing at runtime.
 */
export const TERRAIN_VARIANTS = 8;

/**
 * Fraction of road tiles carrying wreckage — every few tiles rather than every
 * one, because a continuous line of debris reads as a fence rather than as the
 * aftermath of an army.
 */
export const ROAD_MARKER_RATE = 0.34;

/**
 * The six terrains, separated on purpose.
 *
 * Measured with the repo's own WCAG arithmetic, the palette this replaced put
 * Plains at L 0.311 against Desert at L 0.325 — a contrast of **1.04**, which is
 * to say identical in value and told apart by hue alone — and Forest at 0.063
 * against Swamp at 0.096, two dark greens close in *both*. Overall span was
 * 3.32. That is "you have to focus to see what is what", as a number.
 *
 * The rule these are tuned to, and the one `terrainDisplay.test.ts` enforces:
 * **no pair may be close in both value and hue.** Value alone cannot separate
 * six terrains — forcing it pushes the darkest to black — so Water/Forest and
 * Plains/Highlands lean on hue while the rest lean on value.
 *
 * **A hex's ground is its arena's, 1:1** (the designer: PT-01 of 2026-10-13, and
 * again on 2026-10-29). Every top here is solved so that, under the overworld's
 * light, a known hex renders the colour the floor of the arena it is fought in
 * renders (`groundPatches.ts`, under the arena's own light): both sides are
 * measured from the screen by `npm run world:ground-colours`, and every surface
 * whose ground can be sampled stands within about 2 ΔE of its board. The
 * surfaces a massif stands on (mountains, and Jadeveil's ridge and crown) and
 * the swamp, whose centres are pools, are set from the map's light instead,
 * the albedo the board's colour divided by it. The board look's saturated
 * palette (bright grass, gold sand, maroon blight), which the designer liked and
 * which broke this, lasted a day. Where two arenas' floors render alike, so do
 * their hexes, and what stands on a hex tells them apart (`terrainDisplay.test.ts`
 * lists the pairs). The snowfield is its arena's mid-grey board, no longer pale.
 * Each `ground` moved with its tile, by the same linear ratio, so an arena that
 * ever falls back to this table keeps its board-to-surround share.
 *
 * `ground` is the fill under the board when a fight happens here; it is never
 * drawn on the world map, which has no ground plane.
 */
export const TERRAIN_DISPLAY: Record<TileType, SurfaceDisplay> = {
  // Open by design, and the most common terrain by a wide margin — so this rate
  // is both what makes grassland read as grassland and what keeps the map's prop
  // count affordable.
  [TileType.Plains]:   { tile: '#589621', ground: '#27470a', roughness: 0.90, metalness: 0.00, relief: 0.14, propFamily: 'terrain_plains' },
  // Forest is the darkest, but not so dark that `ARENA_DIM` takes it under the
  // visibility floor — a forest fight whose board reads as a hole is worse than
  // a forest one step lighter on the map.
  [TileType.Forest]:   { tile: '#2f7615', ground: '#163f07', roughness: 0.95, metalness: 0.00, relief: 0.35, propFamily: 'terrain_forest' },
  [TileType.Desert]:   { tile: '#cf9e52', ground: '#75582b', roughness: 0.85, metalness: 0.00, relief: 0.30, propFamily: 'terrain_desert' },
  [TileType.Swamp]:    { tile: '#536431', ground: '#283015', roughness: 0.98, metalness: 0.00, relief: 0.20, propFamily: 'terrain_swamp' },
  // The shoulder of a range, and the only way onto one: the highland arena's
  // olive-ochre. Adjacent to Mountain everywhere on the map, so the two are held
  // apart by value (Mountain a stop darker) as well as by the massif standing on
  // the range (`worldLandforms.ts`); hue alone would not do it, both are warm.
  [TileType.Highlands]: { tile: '#7b7c37', ground: '#3a3916', roughness: 0.75, metalness: 0.05, relief: 0.85, propFamily: 'terrain_highlands' },
  // Mountains carry the real relief — the massif's summits and snow
  // (`worldLandforms.ts`). The ground between them is the arena's warm stone in
  // shadow, a stop under Highlands and Swamp so the separation rule holds.
  [TileType.Mountain]: { tile: '#756b50', ground: '#373224', roughness: 0.55, metalness: 0.20, relief: 1.40, propFamily: 'terrain_mountain' },
  [TileType.Water]:    { tile: '#154a9e', ground: '#0b2650', roughness: 0.05, metalness: 0.30, relief: 0.06, propFamily: 'terrain_water' },
  // Snow, and the lightest ground in the game. Cold where Desert is warm, and a
  // stop of value above it as well as half a turn of hue away: the two are the
  // only pale terrains, and hue alone is a weak signal on a colour this close
  // to white, so the suite holds this pair to *both* axes rather than either.
  // Bluer than a neutral white on purpose: the arena's daylight is warm, and a
  // grey-white board under it rendered as beige stone.
  [TileType.Tundra]:   { tile: '#8792a0', ground: '#3a414a', roughness: 0.90, metalness: 0.00, relief: 0.22, propFamily: 'terrain_tundra', arenaDim: 0.74 },
};

/**
 * Danger ground is scorched, not merely darker — it is the one thing on the map
 * that must read as "a fight happens here" from across the screen.
 *
 * Mountain and Water have no entry because both are impassable, so no encounter
 * can be rolled on them.
 */
/**
 * Scorched ground, and it has to be *seen* to be scorched.
 *
 * These used to be the darkest surfaces in the game — danger forest measured
 * L 0.019 and danger swamp L 0.017, both well under the 0.04 at which a surface
 * stops reading as a colour and starts reading as a hole punched in the map.
 * That is backwards: a danger tile is the one thing on the world map the player
 * most needs to notice, because it is the only place a fight can happen.
 *
 * So they are blighted rather than merely dark — the shift off the base terrain
 * is carried by hue (green to ash grey) as much as by value, and everything
 * clears the visibility floor. The values are the haunted arena floors as the
 * world map lights them (see `TERRAIN_DISPLAY`): ash and dead olive, the
 * haunted desert a rust, the dead rock a cool slate. The haunted forest and
 * swamp stand a little light of their boards: their walls cannot go under the
 * 0.022 floor with a 1.35 step, which puts the tops at L 0.049 or more.
 *
 * They are deliberately *not* well separated from one another. "Something bad
 * happens here" is the whole message; which terrain it used to be is told by
 * what stands on it — a dead wood where the wood was, thorn and bone where the
 * field was — which the world map composes per hex (`worldScenery.ts`).
 *
 * **`propFamily` here is where this table first disagrees with the living one**,
 * which is what it was kept separate for. Haunted ground used to draw from the
 * living families — wildflowers on a scorched plain, green conifers in a dead
 * wood — so a blighted region was the living one repainted, and the frontier
 * between them said nothing about what grows. Open ground now draws
 * `terrain_blight` (ash, straw, bone, bramble) and woods and bogs
 * `terrain_deadwood` (dead trees, stumps, fallen trunks). Rock and water keep
 * their own: a crag is a crag either side of the line, and the fouled water
 * carries its colour.
 */
export const DANGER_DISPLAY: Partial<Record<TileType, SurfaceDisplay>> = {
  [TileType.Plains]: { tile: '#3e4239', ground: '#2b2f28', roughness: 0.95, metalness: 0.00, relief: 0.14, propFamily: 'terrain_blight' },
  [TileType.Forest]: { tile: '#3d403c', ground: '#1e211e', roughness: 0.98, metalness: 0.00, relief: 0.35, propFamily: 'terrain_deadwood' },
  [TileType.Desert]: { tile: '#77582f', ground: '#4c371c', roughness: 0.90, metalness: 0.00, relief: 0.30, propFamily: 'terrain_blight' },
  [TileType.Swamp]:  { tile: '#334337', ground: '#1a241c', roughness: 0.98, metalness: 0.00, relief: 0.20, propFamily: 'terrain_deadwood' },
  // Both of these exist because the ground became walkable. The comment above
  // used to say Mountain and Water had no entry "because both are impassable,
  // so no encounter can be rolled on them" — that stopped being true the moment
  // `isPassable` dropped to water only, and `terrainDisplay.test.ts` catches it:
  // it requires a danger variant for **every passable terrain**, which is
  // exactly the coupling that stops high ground becoming walkable without also
  // becoming legible.
  //
  // Burnt scree — the ochre goes grey and loses its warmth, which is the shift
  // that reads at map distance against a base that is warm and light.
  [TileType.Highlands]: { tile: '#4c5453', ground: '#282f30', roughness: 0.85, metalness: 0.02, relief: 0.85, propFamily: 'terrain_blight' },
  // Dead rock: the haunted mountain arena's cool slate, where the living range
  // is warm stone.
  [TileType.Mountain]:  { tile: '#435557', ground: '#243031', roughness: 0.70, metalness: 0.08, relief: 1.40, propFamily: 'terrain_mountain' },
  /**
   * Fouled water, and it exists because haunted stopped being a *roll* and
   * became a *region*.
   *
   * The old danger pass only ever marked Plains, Forest, Desert and Swamp, so
   * three terrains never needed a scorched variant. Zones are geometric — a lake
   * inside haunted country is haunted, whatever the party can or cannot walk on
   * — so `tileSurfaceKey` now asks for `danger_water`, and a missing entry there
   * is not a subtle palette fault: `HexGridMesh` falls through to its default
   * grey material and the lake renders as an untextured hole in the map.
   *
   * Still and oily rather than merely dark: the roughness comes right down and
   * the blue goes green, so it reads as water that has gone wrong rather than as
   * water at night.
   *
   * It took two goes and the suite caught both, which is the entire argument for
   * measuring these rather than eyeballing them. `#1d3a3a` measured L 0.036,
   * under the 0.04 floor. `#244a4a` cleared the floor and then failed the *other*
   * rule — 37° of hue and ×1.16 of contrast off clean water, so a fouled lake
   * and an ordinary one were the same tile. This is olive rather than teal: 65°
   * of hue away, which is what carries it, because the luminance window between
   * the floor and clean water's L 0.075 is too narrow for value to do the job.
   */
  [TileType.Water]:     { tile: '#2a4438', ground: '#14211b', roughness: 0.10, metalness: 0.25, relief: 0.06, propFamily: 'terrain_water' },
  // Snow the blight has had: its arena's cold blue-grey board, a step under the
  // living snowfield's grey and cold rather than burnt (a rust-brown snowfield
  // reads as desert). It had been kept pale (L 0.48) so the north read as snow;
  // since the map's ground became its arena's (2026-10-29) it is the arena's,
  // and the dead trees and the massif's snow say north. Roads barely reach the
  // north, so on a typical seed nineteen frozen tiles in twenty are haunted.
  [TileType.Tundra]:    { tile: '#5b7ba1', ground: '#2a3c55', roughness: 0.92, metalness: 0.02, relief: 0.22, propFamily: 'terrain_rimeblight' },
};

/**
 * High ground inside the frozen north: the same rock, under snow.
 *
 * Keyed by terrain like the two tables above and drawn for a tile `mapGenerator`
 * marks `frost`. Highlands and Mountain stay what they are — the climb rules in
 * `TERRAIN_HEIGHT` are about *rock*, and turning a peak into Tundra would make
 * it level ground.
 *
 * **The same colours as the unfrozen rock** (2026-10-29): a fight on a frozen
 * shoulder or peak is fought in the highland or mountain arena, and the map's
 * ground is its arena's, 1:1 (see `TERRAIN_DISPLAY`). The north shows on the
 * massif standing on these hexes, whose snow comes far lower down
 * (`worldLandforms`). They were a cool pale stone of their own. The table is
 * kept, keyed apart, so the north can take its own surface again without
 * touching every caller.
 */
export const FROST_DISPLAY: Partial<Record<TileType, SurfaceDisplay>> = {
  [TileType.Highlands]: { tile: '#7b7c37', ground: '#3a3916', roughness: 0.80, metalness: 0.04, relief: 0.85, propFamily: 'terrain_highlands' },
  [TileType.Mountain]:  { tile: '#756b50', ground: '#373224', roughness: 0.60, metalness: 0.15, relief: 1.40, propFamily: 'terrain_mountain' },
};

/** `FROST_DISPLAY` under the blight: dark rock, and the snow still on it. */
export const DANGER_FROST_DISPLAY: Partial<Record<TileType, SurfaceDisplay>> = {
  [TileType.Highlands]: { tile: '#4c5453', ground: '#282f30', roughness: 0.85, metalness: 0.02, relief: 0.85, propFamily: 'terrain_blight' },
  [TileType.Mountain]:  { tile: '#435557', ground: '#243031', roughness: 0.70, metalness: 0.08, relief: 1.40, propFamily: 'terrain_mountain' },
};

/**
 * Jadeveil Range's grounds, keyed by `MapTile.jade` and drawn as
 * `jade_<ground>` (`danger_jade_<ground>` when haunted).
 *
 * Each stands on an ordinary terrain with that terrain's height — bamboo on
 * forest, terraces on highlands, ridge and crown on mountain — so the climb
 * rules are the Empire's and only the surface is Jadeveil's own. Green, gold
 * and stone: grey-green moss on the valley floors, jade bamboo, gold terraced
 * shoulders, blue-grey mist ridges, a violet storm-worn crown in the summit's
 * band, and pale worked stone round a shrine.
 *
 * They answer to the separation rule among themselves and against water,
 * which is everything they meet — the Empire's grounds never share a map with
 * them (`terrainDisplay.test.ts`), except the pairs whose arena floors render
 * alike. Every haunted twin is ash with its hue kept, except the crown's,
 * which is too dark to step down by value and goes a cold teal-grey instead.
 * Like the Empire's, every one is its arena's floor as the map lights it, 1:1
 * (see `TERRAIN_DISPLAY`); the arenas draw their own authored floors
 * (`groundPatches.ts`), not these rows.
 *
 * A fight on one is fought in that ground's own arena (`jade_bamboo`, …,
 * `encounterContext.surfaceKeyFor`), whose authored floor wins over these rows
 * (`groundPatches.GROUND_COMPOSITION`); these are the fallback `surfaceFor`
 * returns, and the map's tops.
 */
export const JADE_DISPLAY: Record<JadeGround, SurfaceDisplay> = {
  moss:    { tile: '#557729', ground: '#263910', roughness: 0.92, metalness: 0.00, relief: 0.14, propFamily: 'terrain_plains' },
  bamboo:  { tile: '#576924', ground: '#2f310d', roughness: 0.95, metalness: 0.00, relief: 0.30, propFamily: 'terrain_forest' },
  terrace: { tile: '#9b853d', ground: '#473d1b', roughness: 0.85, metalness: 0.00, relief: 0.85, propFamily: 'terrain_highlands' },
  ridge:   { tile: '#657162', ground: '#2f352d', roughness: 0.70, metalness: 0.05, relief: 1.40, propFamily: 'terrain_mountain' },
  crown:   { tile: '#575256', ground: '#292627', roughness: 0.70, metalness: 0.05, relief: 1.40, propFamily: 'terrain_mountain' },
  shrine:  { tile: '#cfc5aa', ground: '#615c4f', roughness: 0.80, metalness: 0.00, relief: 0.06, propFamily: null },
};

/** `JADE_DISPLAY` under the blight. */
export const DANGER_JADE_DISPLAY: Record<JadeGround, SurfaceDisplay> = {
  moss:    { tile: '#304d53', ground: '#142526', roughness: 0.95, metalness: 0.00, relief: 0.14, propFamily: 'terrain_blight' },
  bamboo:  { tile: '#344948', ground: '#152420', roughness: 0.98, metalness: 0.00, relief: 0.30, propFamily: 'terrain_deadwood' },
  terrace: { tile: '#3b4b49', ground: '#1a2323', roughness: 0.88, metalness: 0.00, relief: 0.85, propFamily: 'terrain_blight' },
  ridge:   { tile: '#334c55', ground: '#142225', roughness: 0.75, metalness: 0.05, relief: 1.40, propFamily: 'terrain_mountain' },
  crown:   { tile: '#3d4644', ground: '#1d2120', roughness: 0.75, metalness: 0.05, relief: 1.40, propFamily: 'terrain_mountain' },
  shrine:  { tile: '#6e6276', ground: '#36303a', roughness: 0.85, metalness: 0.00, relief: 0.06, propFamily: 'terrain_blight' },
};

/**
 * The archipelago's arena surfaces (the private project notes): its three grounds,
 * and the floors of its places — a ship's deck, clear and storm-wet, the gun battery's flagstones,
 * a pirate fort's packed dirt, the Sunken Hull's wet sand and the Flooded Grotto's wet rock.
 */
export type IsleSurface = IsleGround | 'deck' | 'deck_storm' | 'flagstone' | 'dirt' | 'wet_sand' | 'wet_rock';

/**
 * The archipelago's surfaces, each the floor its arena is composed on (`GROUND_COMPOSITION`), the
 * arenas' fallback. The beach, jungle and rock rows are also the map's tops (`ISLE_MAP_GROUNDS`),
 * solved like `TERRAIN_DISPLAY`'s so that a hex renders its arena's board under the map's light
 * (2026-11-02: 0.5 and 0.9 ΔE; the rock 2026-11-03); their arenas draw their authored floors, so
 * those did not move. No prop family: every one of them is dressed by its own kit. The deck is level
 * planking, so it has no relief at all; the rock keeps the highlands' relief, the terrain it stands on.
 */
export const ISLE_DISPLAY: Record<IsleSurface, SurfaceDisplay> = {
  beach:      { tile: '#c2a269', ground: '#8d7446', roughness: 0.92, metalness: 0.00, relief: 0.12, propFamily: null },
  jungle:     { tile: '#798a31', ground: '#535e20', roughness: 0.95, metalness: 0.00, relief: 0.30, propFamily: null },
  rock:       { tile: '#6a757f', ground: '#474f56', roughness: 0.85, metalness: 0.02, relief: 0.85, propFamily: null },
  deck:       { tile: '#9c7a52', ground: '#2e8ea0', roughness: 0.85, metalness: 0.00, relief: 0.00, propFamily: null },
  deck_storm: { tile: '#7e6446', ground: '#244e5c', roughness: 0.60, metalness: 0.00, relief: 0.00, propFamily: null },
  flagstone:  { tile: '#8f8a7e', ground: '#5e5a52', roughness: 0.85, metalness: 0.00, relief: 0.04, propFamily: null },
  dirt:       { tile: '#8a6a46', ground: '#5e4830', roughness: 0.95, metalness: 0.00, relief: 0.10, propFamily: null },
  wet_sand:   { tile: '#a8946a', ground: '#6e6044', roughness: 0.70, metalness: 0.00, relief: 0.10, propFamily: null },
  wet_rock:   { tile: '#5a6260', ground: '#3a4240', roughness: 0.60, metalness: 0.02, relief: 0.50, propFamily: null },
};

/**
 * The archipelago's grounds the world map draws (`MapTile.isle`), keyed
 * `isle_<ground>` as their arenas are. Their rows in `ISLE_DISPLAY` are the map's
 * tops; the beach, jungle and rock arenas draw their own authored floors
 * (`groundPatches.ts`), which win over these, so solving these to the arena
 * floors as the map lights them moves only the map. The archipelago has no
 * haunted ground, so they have no `danger_` twins.
 */
export const ISLE_MAP_GROUNDS: readonly IsleGround[] = ['beach', 'jungle', 'rock'];

/**
 * A packed track, pale against everything it crosses.
 *
 * This was `#2e2630` — scorched violet-black, the darkest surface in the game —
 * and that was the right colour for what a road used to *be*: one line, the scar
 * the Legion's army left marching on the city, whose job was to point at where
 * the danger came from.
 *
 * It is wrong for what a road is now. The network is **infrastructure** — the
 * skeleton the player navigates by, the safe route, and the fast one — and a
 * near-black line reads as a chasm rather than as somewhere to walk. On screen
 * it was the single darkest thing on the map, so the one surface that means
 * *safety* looked like the one that meant the opposite. A branch running out to
 * a trapper's camp has nothing to do with the Legion either, so a uniform ash
 * across the whole network says something untrue about most of it.
 *
 * Pale warm grey: light against forest, plains and swamp, greyer than highlands
 * and desert, and the only surface on the map with no colour in it at all.
 */
export const ROAD_DISPLAY: SurfaceDisplay =
  { tile: '#8d8478', ground: '#42403b', roughness: 0.92, metalness: 0.02, relief: 0, propFamily: null };

export const SURFACE_DISPLAY: Record<LocationSurface, SurfaceDisplay> = {
  grass: { tile: '#3f7a2e', ground: '#1e3a16', roughness: 0.92, metalness: 0.00, relief: 0, propFamily: null },
  path:  { tile: '#6d6152', ground: '#332e28', roughness: 0.88, metalness: 0.00, relief: 0, propFamily: null },
  stone: { tile: '#7b7870', ground: '#3a3934', roughness: 0.72, metalness: 0.05, relief: 0, propFamily: null },
  water: { tile: '#1848b0', ground: '#0c2050', roughness: 0.08, metalness: 0.30, relief: 0, propFamily: null },
  wood:  { tile: '#5a4028', ground: '#2c2014', roughness: 0.90, metalness: 0.00, relief: 0, propFamily: null },
  dirt:  { tile: '#5c4a34', ground: '#2c2318', roughness: 0.95, metalness: 0.00, relief: 0, propFamily: null },
  // The town's streets: warm setts, where `stone` is cold flagging. A grey
  // street network reads as a board of tiles, and the city's reference paves
  // every route in the same tan cobble its buildings stand on.
  cobble: { tile: '#a48c6a', ground: '#4a3e2e', roughness: 0.9, metalness: 0.02, relief: 0, propFamily: null },

  // ── The lairs ──────────────────────────────────────────────────────────────
  //
  // Each lair is floored in two materials and walled in a third, and the three
  // lairs share none of them. A room and
  // the passage into it used to be one surface under a per-tile roll of a
  // second, which is salt and pepper — the pattern this file's grain notes call
  // a rendering fault — and left nothing to say where a chamber began.
  // `lairSurfaces.test.ts` measures every pair a lair puts side by side.

  // The Warren: packed earth in its chambers, lighter than the trodden dirt of
  // its runs, under walls of dark root-bound earth.
  earth:     { tile: '#7e6142', ground: '#3a2c1e', roughness: 0.95, metalness: 0.00, relief: 0, propFamily: null },
  burrow:    { tile: '#35281b', ground: '#241a11', roughness: 0.97, metalness: 0.00, relief: 0, propFamily: null },
  // The Wyrm's Hollow: dark rock in its caverns, pale ash where the fire has
  // run through the throats, and rough cave rock round all of it.
  basalt:    { tile: '#6a5549', ground: '#2e241f', roughness: 0.90, metalness: 0.02, relief: 0, propFamily: null },
  ash:       { tile: '#8c867f', ground: '#3d3a37', roughness: 0.96, metalness: 0.00, relief: 0, propFamily: null },
  cavern:    { tile: '#312723', ground: '#221b18', roughness: 0.92, metalness: 0.02, relief: 0, propFamily: null },
  // The ice lair: packed snow in its chambers, a step paler than the Tundra's
  // own so the glacier's floor is not the open snow outside it; matte blue ice
  // worn into its passages; and the glacier itself, blue-black on top and read
  // by its cracked blue faces. Matte on purpose — a mirror floor under a follow
  // camera is a floor that changes colour as the party walks.
  snowpack:  { tile: '#a9c2de', ground: '#46566a', roughness: 0.94, metalness: 0.00, relief: 0, propFamily: null },
  blueice:   { tile: '#6e93bf', ground: '#32465e', roughness: 0.70, metalness: 0.04, relief: 0, propFamily: null },
  glacier:   { tile: '#223040', ground: '#1a2430', roughness: 0.78, metalness: 0.04, relief: 0, propFamily: null },
  // Jadeveil: Silent Hall / Fallen Order. Worn honey temple boards in its halls,
  // cold blue-grey slate flagging its stairs and cloisters, and the mountain's
  // dark granite round both, read by its pale grey cut faces.
  temple_boards:    { tile: '#9a7650', ground: '#46362a', roughness: 0.88, metalness: 0.00, relief: 0, propFamily: null },
  hall_slate:       { tile: '#5f6b78', ground: '#2c323a', roughness: 0.80, metalness: 0.03, relief: 0, propFamily: null },
  mountain_granite: { tile: '#292e36', ground: '#1c2026', roughness: 0.90, metalness: 0.02, relief: 0, propFamily: null },
  // Jadeveil: Silk Hollow / Yokai — pale moss under a skin of silk in its chambers,
  // olive bamboo litter in its runs, and a wall of dark bamboo root, read by its
  // mossy green faces.
  silkmoss:  { tile: '#a8b39a', ground: '#4a5240', roughness: 0.95, metalness: 0.00, relief: 0, propFamily: null },
  bamboo:    { tile: '#7d8a3c', ground: '#3a401c', roughness: 0.93, metalness: 0.00, relief: 0, propFamily: null },
  rootwall:  { tile: '#24301c', ground: '#161e12', roughness: 0.97, metalness: 0.00, relief: 0, propFamily: null },
};

/**
 * The places a fight is fought under the sky, and the country each stands in.
 *
 * Every location used to be a roof — a lair chamber or the castle hall — so
 * "location" and "indoors" were one test written five times. The city broke
 * that: the siege is fought in its streets, and a street lit as a cellar and
 * ringed with dungeon pillars is the wrong place however good its layout is.
 * A table rather than a flag on `LocationDef`: the light, the dressing and the
 * air all ask, and each of them sits below the location data it would read.
 */
const OPEN_COUNTRY: Partial<Record<LocationId, TileType>> = {
  // The walled town stands in green farmland (`CITY.ambient.ground`).
  city: TileType.Plains,
};

/** The country a fight is fought in the open air of, or `null` under a roof. */
export function openCountry(context: EncounterContext): TileType | null {
  if (context.kind === 'world') return context.terrain;
  return OPEN_COUNTRY[context.location] ?? null;
}

/**
 * The arena is the same ground, lit for a fight.
 *
 * Its board used to carry its own copy of the terrain table at consistently
 * ~0.8× the world map's channel values — a blurred photo sits behind the
 * transparent canvas and a bright board washes out against it. Expressing that
 * as one factor rather than six more hex strings means a colour retune touches
 * one place, and it is what fixes Water: the arena's private table had no entry,
 * so a fight on a coast silently drew a grass board.
 *
 * Raised from 0.80 to 0.88 alongside lifting the backdrop dimmer. The two are
 * one setting wearing two hats: the board was dimmed *because* the photo behind
 * it was bright, and the photo was then dimmed as well, so both ended up dark
 * and the fight read as happening at night on every terrain in the game. The
 * dimmer came down, so the board no longer has to hide from it.
 */
export const ARENA_DIM = 0.88;

/**
 * The cosmetic ground immediately around the board, as a share of the board's
 * own albedo.
 *
 * The start of a **ramp**, where there used to be one flat 0.6 held all the way
 * out to the rim — so the surround read as a second plate rather than as the
 * same country going on, and the whole arena as a disc sitting on a darker disc.
 *
 * Deliberately close to the board, because the boundary between them is told
 * apart by *structure* now: the board is drawn with seams and the surround
 * without one, which is `HexGridMesh`'s `tileRadius`. The value step no longer
 * has to carry that job alone and is free to be gentle.
 */
export const ARENA_SURROUND_NEAR = 0.74;

/**
 * The mean of a hex colour's three channels, **linearised**.
 *
 * A multiplier over an albedo is applied in the renderer's linear working space,
 * so the ratio between two authored colours has to be measured there too. Taken
 * off the sRGB bytes instead — which is what a naive `ground / tile` does — it
 * comes out around 0.54 where the true one is 0.27, i.e. twice as bright as the
 * thing it is supposed to match.
 */
const srgbToLinear = (c: number): number =>
  (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const linearMean = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => srgbToLinear(((n >> shift) & 0xff) / 255);
  return (channel(16) + channel(8) + channel(0)) / 3;
};

/**
 * Where the field has to *end*: the brightness of the plane it gives out onto,
 * as a share of the board's.
 *
 * The hex field cannot reach the horizon — at the arena's pitch that is sixty
 * world units of ground and several thousand instances, which is why one large
 * `circleGeometry` takes the distance instead. So the field has a rim, and the
 * rim is visible as a stepped edge unless the last ring of hexes is already the
 * colour of the plane. Measured: at a flat surround the plane sat 27% under the
 * outermost hexes, and the join read as the board's plate being cropped.
 *
 * Derived from the two colours the scene already holds rather than written down,
 * because `ArenaScenery.ground` is whatever the *location* says inside a lair
 * and only tracks `SurfaceDisplay.ground` out in the world. A constant would be
 * right on grass and wrong in the Wyrm's Hollow.
 *
 * Clamped, so a pathological pair cannot invert the ramp or blow the surround
 * brighter than the board it surrounds.
 */
export function groundShare(tile: string, ground: string): number {
  const share = linearMean(ground) / Math.max(1e-6, linearMean(tile));
  // Across `TERRAIN_DISPLAY` this lands between 0.27 and 0.38; the clamp is for
  // a location that authors its own ground colour and has no such relation to
  // the surface under the board.
  return Math.min(0.85, Math.max(0.15, share));
}

/**
 * The surround's value at `depth` hexes past the board: `ARENA_SURROUND_NEAR` at
 * the board's edge, `rim` at `reach`.
 */
export function surroundFade(depth: number, reach: number, rim: number): number {
  const t = Math.min(1, Math.max(0, (depth - 1) / Math.max(1, reach - 1)));
  return ARENA_SURROUND_NEAR + (rim - ARENA_SURROUND_NEAR) * t;
}

const dimHex = (hex: string, k: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) =>
    Math.round(Math.min(255, ((n >> shift) & 0xff) * k))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
};

/** Tile and ground albedo for an arena fought on this surface. */
export function arenaSurface(d: SurfaceDisplay): SurfaceDisplay {
  return { ...d, tile: dimHex(d.tile, d.arenaDim ?? ARENA_DIM) };
}

/**
 * The grain on each kind of ground.
 *
 * Keyed by exactly the string `tileSurfaceKey` returns and `LocationSurface`
 * names itself with, which is the same key `terrainMaterial` caches on — so the
 * material and its texture cannot end up describing two different surfaces.
 * That is the whole reason this is a lookup rather than a field on
 * `SurfaceDisplay`: a field would need one entry per row across four tables and
 * the arena's derived copies, and the copies are where the last three tables
 * drifted.
 *
 * Pure data. The pixels are generated in `voxel/groundTexture.ts` and turned
 * into a `THREE.DataTexture` in `utils/terrainMaterials.ts`, so this file keeps
 * its promise to know nothing about `three`.
 *
 * **Amplitude is the only number here with a rule attached.** It is how far the
 * grain may darken its own terrain, and `groundTexture` clamps it at
 * `MAX_AMPLITUDE` — because the six terrains above are separated by a measured
 * WCAG margin, and a texture swinging a third of the albedo would put two of
 * them back inside each other at the dark end of the grain. Everything else is
 * taste: what the ground is made of, essentially.
 *
 * **`grain` runs low, and that is a fact about the camera rather than about
 * ground.** The first tuning pass ran 9–15 cells across the texture, which is
 * roughly a four-pixel feature at the world map's default framing — and a
 * four-pixel feature is exactly what mipmapping exists to average away, so it
 * rendered as the flat colour it replaced and only showed up under a 3×
 * magnified crop. Detail has to be *large* to survive minification; what
 * supplies the fineness up close is `octaves` and `fleck`, which cost nothing at
 * distance because they are meant to disappear there.
 */
const GRAIN: Record<string, GroundTextureSpec> = {
  // Patchy rather than busy. Grass at map distance is a *texture* and not a
  // pattern — anything with visible shapes in it turns a field into foliage,
  // which is the same trap `plainsVariant` documents about prop height — but
  // see the note below about why the patches still have to be large.
  turf:   { seed: 11,  grain: 6,  amplitude: 0.18, octaves: 3, fleck: 0.05, fleckDepth: 0.18 },
  // Leaf litter: fewer, larger patches and harder debris. Forest is the darkest
  // terrain, so its grain is the one most at risk of reading as mud — the flecks
  // are what keep it legible as ground rather than as shadow.
  litter: { seed: 23,  grain: 5,  amplitude: 0.20, octaves: 3, fleck: 0.07, fleckDepth: 0.22 },
  // Dunes. The stretch is the whole read: sand without a direction is just a
  // pale version of scree, and the ripples are what say "nothing grows here".
  sand:   { seed: 37,  grain: 5,  amplitude: 0.13, octaves: 2, stretch: 3.5, fleck: 0.03, fleckDepth: 0.12 },
  // Standing scum in big soft blotches, at the widest amplitude any ground gets.
  // A bog is meant to look like it has depth to it.
  bog:    { seed: 41,  grain: 4,  amplitude: 0.22, octaves: 2, fleck: 0.04, fleckDepth: 0.20 },
  // Loose stone. The heaviest fleck rate in the table, because scree seen from
  // above is almost entirely edges.
  scree:  { seed: 53,  grain: 6,  amplitude: 0.19, octaves: 3, fleck: 0.10, fleckDepth: 0.24 },
  // Bedding planes. Directional like sand and much harder, which is what keeps
  // a peak from reading as a grey dune.
  strata: { seed: 67,  grain: 5,  amplitude: 0.22, octaves: 3, stretch: 2.2, fleck: 0.06, fleckDepth: 0.20 },
  // Barely there. Water is the one surface whose material already carries a
  // look — roughness 0.05, metalness 0.30 — and a strong grain on it reads as
  // ice rather than as a current.
  ripple: { seed: 71,  grain: 4,  amplitude: 0.09, octaves: 2, stretch: 4 },
  // Every scorched surface shares one grain, deliberately. `DANGER_DISPLAY`
  // above says the danger colours are *not* separated from one another because
  // "something bad happens here" is the entire message; six grains would spend
  // effort saying the thing the table has decided not to say.
  ash:    { seed: 83,  grain: 6,  amplitude: 0.18, octaves: 2, fleck: 0.08, fleckDepth: 0.25 },
  // Cut stone: broad, flat, one octave. Slabs, not mottling.
  flag:   { seed: 97,  grain: 3,  amplitude: 0.13, octaves: 1, fleck: 0.03, fleckDepth: 0.15 },
  // Planking, along the grain.
  plank:  { seed: 103, grain: 4,  amplitude: 0.16, octaves: 2, stretch: 5 },
  // Bare earth — turf's grain without anything growing in it.
  earth:  { seed: 109, grain: 6,  amplitude: 0.16, octaves: 2, fleck: 0.06, fleckDepth: 0.20 },
  // Setts: small hard cells and a lot of edge, which is what a cobbled street
  // is at the distance a town is looked at from.
  sett:   { seed: 113, grain: 7,  amplitude: 0.18, octaves: 2, fleck: 0.12, fleckDepth: 0.22 },
  // Wind-packed snow: soft drifts laid one way, shallower than sand's dunes and
  // with the odd stone through the crust. The lowest amplitude any open ground
  // gets, because the darkest of it is what sits nearest the Desert's value.
  snow:   { seed: 127, grain: 5,  amplitude: 0.12, octaves: 2, stretch: 1.8, fleck: 0.04, fleckDepth: 0.18 },
  // Jadeveil. Moss over stone: turf's patches with scree's hard flecks, the
  // stone showing through.
  moss:   { seed: 131, grain: 5,  amplitude: 0.17, octaves: 3, fleck: 0.09, fleckDepth: 0.20 },
  // Fallen culms and leaf: litter laid one way, which is what tells a bamboo
  // stand from the Empire's broadleaf at ground level.
  culm:   { seed: 137, grain: 5,  amplitude: 0.18, octaves: 2, stretch: 2.6, fleck: 0.05, fleckDepth: 0.18 },
  // Terraces: the strongest stretch in the table, so a shoulder reads as
  // contour lines of cut steps rather than as loose stone.
  terrace: { seed: 139, grain: 4, amplitude: 0.20, octaves: 2, stretch: 5.5, fleck: 0.03, fleckDepth: 0.14 },
  // Jadeveil's rock and paving, and its haunted ground, are laid in blocks
  // (`cells`): the voxel language its land and road are built in, where every
  // Empire ground is smooth. None of them is an Empire grain under a jade name.
  // Mist-ridge limestone: blocks smeared down the slope, the rain streaks.
  karst:  { seed: 149, grain: 5, amplitude: 0.21, octaves: 2, stretch: 0.45, fleck: 0.07, fleckDepth: 0.2, cells: 16 },
  // The crown: wind-scoured bands across the rock.
  crag:   { seed: 151, grain: 4, amplitude: 0.22, octaves: 2, stretch: 3.2, fleck: 0.05, fleckDepth: 0.18, cells: 16 },
  // Shrine paving: square flags with moss in the joints.
  paving: { seed: 157, grain: 3, amplitude: 0.15, octaves: 1, fleck: 0.1, fleckDepth: 0.14, cells: 8 },
  // Haunted: ghost moss over ink — pale crowns on dark cushions, in blocks.
  ghostmoss: { seed: 163, grain: 6, amplitude: 0.2, octaves: 2, fleck: 0.08, fleckDepth: 0.22, cells: 16 },
  // Dead terraces: the contour stretch kept, the grass gone to stubble.
  deadterrace: { seed: 167, grain: 4, amplitude: 0.2, octaves: 2, stretch: 4.5, fleck: 0.06, fleckDepth: 0.2, cells: 16 },
  // Cold weathered rock on the haunted ridges and crown.
  coldrock: { seed: 173, grain: 5, amplitude: 0.22, octaves: 2, stretch: 0.6, fleck: 0.09, fleckDepth: 0.22, cells: 16 },
  // The archipelago's own: shell-flecked sand, jungle litter, the headland's basalt, two decks of
  // planking, the battery's flags, a fort's trodden dirt, wet sand and wet rock.
  shore: { seed: 211, grain: 5, amplitude: 0.12, octaves: 2, stretch: 3.0, fleck: 0.05, fleckDepth: 0.14, cells: 16 },
  junglefloor: { seed: 223, grain: 5, amplitude: 0.20, octaves: 3, fleck: 0.08, fleckDepth: 0.24, cells: 16 },
  // The headland's basalt: broad blocks of the rock, its joints flecked dark, coarser than the wet rock's.
  headland: { seed: 257, grain: 4, amplitude: 0.19, octaves: 2, fleck: 0.09, fleckDepth: 0.22, cells: 8 },
  deck: { seed: 227, grain: 4, amplitude: 0.18, octaves: 2, stretch: 6.0, cells: 16 },
  stormdeck: { seed: 229, grain: 4, amplitude: 0.12, octaves: 2, stretch: 6.0, fleck: 0.04, fleckDepth: 0.16, cells: 16 },
  battery: { seed: 233, grain: 3, amplitude: 0.14, octaves: 1, fleck: 0.06, fleckDepth: 0.18, cells: 8 },
  fortdirt: { seed: 239, grain: 6, amplitude: 0.17, octaves: 2, fleck: 0.07, fleckDepth: 0.20, cells: 16 },
  wetsand: { seed: 241, grain: 5, amplitude: 0.10, octaves: 2, stretch: 2.5, fleck: 0.04, fleckDepth: 0.16, cells: 16 },
  wetrock: { seed: 251, grain: 3, amplitude: 0.18, octaves: 2, fleck: 0.05, fleckDepth: 0.20, cells: 16 },
};

/** Jadeveil's grounds and their haunted twins, each its own grain. */
const JADE_GRAIN: Record<string, GroundTextureSpec> = {
  jade_moss: GRAIN.moss,
  jade_bamboo: GRAIN.culm,
  jade_terrace: GRAIN.terrace,
  jade_ridge: GRAIN.karst,
  jade_crown: GRAIN.crag,
  jade_shrine: GRAIN.paving,
  danger_jade_moss: GRAIN.ghostmoss,
  danger_jade_bamboo: GRAIN.ghostmoss,
  danger_jade_terrace: GRAIN.deadterrace,
  danger_jade_ridge: GRAIN.coldrock,
  danger_jade_crown: GRAIN.coldrock,
  danger_jade_shrine: GRAIN.paving,
};

/** The grains only Jadeveil's ground draws: no Empire surface may share one. */
export const JADE_GRAINS: readonly GroundTextureSpec[] = [...new Set(Object.values(JADE_GRAIN))];

/** The archipelago's surfaces, each its own grain, under their surface keys (`isle_<surface>`). */
const ISLE_GRAIN: Record<`isle_${IsleSurface}`, GroundTextureSpec> = {
  isle_beach: GRAIN.shore,
  isle_jungle: GRAIN.junglefloor,
  isle_rock: GRAIN.headland,
  isle_deck: GRAIN.deck,
  isle_deck_storm: GRAIN.stormdeck,
  isle_flagstone: GRAIN.battery,
  isle_dirt: GRAIN.fortdirt,
  isle_wet_sand: GRAIN.wetsand,
  isle_wet_rock: GRAIN.wetrock,
};

/** The grains only the archipelago's ground draws: no other world's surface may share one. */
export const ISLE_GRAINS: readonly GroundTextureSpec[] = [...new Set(Object.values(ISLE_GRAIN))];

/**
 * The grain for a surface key, or `undefined` for ground that stays flat.
 *
 * Both key spaces land here: `tileSurfaceKey`'s (`plains`, `danger_forest`,
 * `road`) and `LocationSurface`'s (`grass`, `flag`, `wood`). They overlap on
 * `water` only, and both want the same thing of it.
 */
export function grainFor(key: string): GroundTextureSpec | undefined {
  if (key in JADE_GRAIN) return JADE_GRAIN[key];
  if (key in ISLE_GRAIN) return ISLE_GRAIN[key as keyof typeof ISLE_GRAIN];
  if (key === 'road') return GRAIN.ash;
  if (key.startsWith('danger_')) return GRAIN.ash;

  const byKey: Record<string, GroundTextureSpec> = {
    [TileType.Plains]: GRAIN.turf,
    [TileType.Forest]: GRAIN.litter,
    [TileType.Desert]: GRAIN.sand,
    [TileType.Swamp]: GRAIN.bog,
    [TileType.Highlands]: GRAIN.scree,
    [TileType.Mountain]: GRAIN.strata,
    [TileType.Water]: GRAIN.ripple,
    [TileType.Tundra]: GRAIN.snow,
    // The frozen north's rock keeps the grain of the rock it is.
    [`frost_${TileType.Highlands}`]: GRAIN.scree,
    [`frost_${TileType.Mountain}`]: GRAIN.strata,
    grass: GRAIN.turf,
    path: GRAIN.earth,
    stone: GRAIN.flag,
    wood: GRAIN.plank,
    dirt: GRAIN.earth,
    cobble: GRAIN.sett,
    // The lairs reuse the grains the overworld already carries: a chamber's
    // floor is earth, rock or snow, worn ice is still water's barely-there
    // ripple, and a wall is rock seen from above.
    earth: GRAIN.earth,
    burrow: GRAIN.litter,
    basalt: GRAIN.scree,
    ash: GRAIN.ash,
    cavern: GRAIN.strata,
    snowpack: GRAIN.snow,
    blueice: GRAIN.ripple,
    glacier: GRAIN.strata,
    // Jadeveil: Silent Hall / Fallen Order
    temple_boards: GRAIN.plank,
    hall_slate: GRAIN.flag,
    mountain_granite: GRAIN.strata,
    // Jadeveil: Silk Hollow / Yokai
    silkmoss: GRAIN.moss,
    bamboo: GRAIN.culm,
    rootwall: GRAIN.litter,
  };
  return byKey[key];
}

/**
 * The side of a world-map hex, which is what a raised strategic tile is read by.
 *
 * The overworld used to draw every prism in its top colour all the way down, so
 * a tile's side was the same grass as its top under a slightly different light —
 * and at the world map's framing that is no side at all. A board of hexes with no
 * sides reads as a flat sheet with lines ruled on it, which is the opposite of
 * the raised terrain the map reference is built from. So a tile is a block: the
 * top is the ground, the sides are what the ground stands on, and the seam
 * between two neighbours is the side of the one behind showing through the gap.
 *
 * **A lookup keyed exactly like `grainFor`, not a field on `SurfaceDisplay`**, for
 * `GRAIN`'s reason: the arena's board and a location's paving are the same
 * surfaces and have no sides a camera ever sees, so a field would be authored on
 * every row of four tables and read by one scene. Only the overworld's keys have
 * an entry; `undefined` means "draw the prism the old way".
 *
 * **Every wall is darker than its top, by a measured margin.** That is the one
 * rule, and `terrainDisplay.test.ts` holds it with the repo's own WCAG helper:
 * a side as light as the top is a seam nobody can see, and a side lighter than
 * the top turns the block inside out. Floored too, because the sides are most of
 * what shows between tiles and a near-black wall is a map ruled in black ink.
 *
 * Earth under living ground, the rock itself under rock, and char under blight —
 * the haunted walls are the same earths burnt, so a frontier reads as one land
 * that went wrong rather than as two tilesets.
 */
const WALL: Record<string, string> = {
  [TileType.Plains]: '#433214',
  [TileType.Forest]: '#4b340c',
  [TileType.Desert]: '#855146',
  [TileType.Swamp]: '#2b3122',
  [TileType.Highlands]: '#3b3e17',
  [TileType.Mountain]: '#4c4532',
  [TileType.Water]: '#2c3b46',
  // Packed snow and the ice under it — blue where every other side is earth.
  [TileType.Tundra]: '#5c6977',
  [`frost_${TileType.Highlands}`]: '#3b3e17',
  [`frost_${TileType.Mountain}`]: '#4c4532',
  road: '#5f4b36',
  [`danger_${TileType.Plains}`]: '#282b25',
  [`danger_${TileType.Forest}`]: '#282a27',
  [`danger_${TileType.Desert}`]: '#543f20',
  [`danger_${TileType.Swamp}`]: '#212c24',
  [`danger_${TileType.Highlands}`]: '#303535',
  [`danger_${TileType.Mountain}`]: '#2d3a3b',
  [`danger_${TileType.Water}`]: '#212c25',
  [`danger_${TileType.Tundra}`]: '#314762',
  [`danger_frost_${TileType.Highlands}`]: '#303535',
  [`danger_frost_${TileType.Mountain}`]: '#2d3a3b',
  // Jadeveil: dark loam under moss and bamboo, the gold terraces' earth
  // banks, the rock itself under ridge and crown, and the shrine's cut stone.
  jade_moss: '#35471a',
  jade_bamboo: '#3d3912',
  jade_terrace: '#5c4c24',
  jade_ridge: '#40473e',
  jade_crown: '#383537',
  jade_shrine: '#7d735e',
  danger_jade_moss: '#1d3135',
  danger_jade_bamboo: '#223230',
  danger_jade_terrace: '#283332',
  danger_jade_ridge: '#1d2f34',
  danger_jade_crown: '#2a2832',
  danger_jade_shrine: '#504756',
  // The archipelago: the beach's damp sand under its dry top, the jungle's dark
  // loam, and the rock's own basalt, dark where it is cut.
  isle_beach: '#7d623c',
  isle_jungle: '#584716',
  isle_rock: '#4a4f5d',
};

/** The side colour for a world-map surface key, or `undefined` for a flat prism. */
export function wallFor(key: string): string | undefined {
  return WALL[key];
}

/**
 * The cut face of the rock a lair is carved into, for each surface a lair is
 * walled in — the overworld's side, one kind of place over.
 *
 * A lair's floor is cut into three rings of rock (`locations/lairShell.ts`),
 * and rock drawn as a hex field reads as more hexes: each prism turned its
 * grain by a sixth of a turn, which is the variety a board wants and exactly
 * what a single mass must not have, so the rock's joins showed as a mosaic of
 * darker floor. A surface named here is drawn as one mass instead — no grain,
 * broad patches in world space across its tops, and this colour down every
 * face with the overworld's strata and occlusion ramp — so the rock reads as
 * something the rooms were dug out of. Darker than the rock's own top, as every
 * world wall is: a face is in the shade the top is not.
 */
const ROCK_FACE: Record<string, string> = {
  burrow: '#6a4c32',
  cavern: '#5c4a41',
  glacier: '#4f6f8c',
  // Jadeveil: Silent Hall / Fallen Order
  mountain_granite: '#5c6470',
  // Jadeveil: Silk Hollow / Yokai
  rootwall: '#4e5e34',
};

/** The cut face of a lair's rock surface, or `undefined` for ground that is not rock. */
export function rockFaceFor(key: string): string | undefined {
  return ROCK_FACE[key];
}

/**
 * How far down every overworld prism reaches, in world units.
 *
 * A tile on its own elevation used to be a 0.2-thick plate, stretched to `y = 0`
 * only when it stood above zero — so a lake was a sheet floating a quarter of a
 * unit below the shore with nothing under it, and the gap between two plains
 * tiles showed straight through to the page behind the canvas. Every block now
 * stands on one floor, well under the lowest water, so a seam is always the side
 * of the tile behind it and a shore is always a bank.
 *
 * It has no gameplay meaning and nothing stands on it: `tileTopY` is unchanged,
 * so a prop, the token and every route marker land exactly where they did.
 */
export const WORLD_FLOOR_Y = -0.9;

/**
 * The overworld's air: the distance fog's colour and the sky behind the map.
 *
 * It was the interface's own ground, a near-black violet, which made distance
 * *darker* — the opposite of what air does, and the same value as concealed
 * ground, so a far valley and a valley nobody had seen were indistinguishable.
 * A pale cool haze makes distance recede the way it does in the reference and
 * leaves dark for nothing but the seams and the walls.
 */
export const WORLD_HAZE = '#b7c2cb';

/**
 * All world surfaces meet at the logical cell boundary. There is no trench
 * between two neighbours; a difference in elevation still exposes a bank.
 * Precise boundaries are an optional local annotation (`MovementGrid`), not
 * a permanent outline carved into every tile. The shared default radius stays
 * unchanged for combat and locations, which have their own tactical grids.
 */
export const WORLD_TILE_RADIUS: Readonly<Record<string, number>> = Object.fromEntries([
  ...Object.keys(TERRAIN_DISPLAY),
  ...Object.keys(DANGER_DISPLAY).map((key) => `danger_${key}`),
  ...Object.keys(FROST_DISPLAY).map((key) => `frost_${key}`),
  ...Object.keys(DANGER_FROST_DISPLAY).map((key) => `danger_frost_${key}`),
  ...Object.keys(JADE_DISPLAY).map((key) => `jade_${key}`),
  ...Object.keys(DANGER_JADE_DISPLAY).map((key) => `danger_jade_${key}`),
  ...ISLE_MAP_GROUNDS.map((ground) => `isle_${ground}`),
].map((key) => [key, 1]));

/**
 * The world map's voxel grid: the square cells the road is laid in
 * (`worldTracks.TRACK.cell`) and the ground's tops are shaded in, on one
 * world-aligned grid so the two read as one material (playtest 2026-10-23,
 * PT-01: the voxel road stood out from smooth ground). `amplitude` is the
 * peak-to-peak value step between neighbouring ground cells, centred so the
 * mean colour stays the one the separation suite measured.
 */
export const WORLD_VOXEL = { cell: 0.14, amplitude: 0.45 } as const;

/**
 * The world's caps as tiles (board look, 2026-10-29): each hex its own colour
 * to its rim (no neighbour blend), a lit bevel inside the edge and a dark line
 * on it, faint broad patches and a light voxel shading on the road's grid. It
 * replaced continuous ground — a lattice blend with a wandering edge, no rim
 * and a strong voxel checker — which at phone size smeared every change of
 * terrain into a bruise while the hex net still showed through; the designer's
 * reference (`MAP.webp`) is a board of crisp hex tiles.
 */
export const WORLD_BOARD_GROUND = { bevel: 1, blend: 0, broad: 0.06, voxel: 0.2, voxelCell: WORLD_VOXEL.cell } as const;

/**
 * How a world surface answers the light: matte, whatever the table says.
 *
 * The table's roughness and metalness are the arena's and the towns', where a
 * surface is seen at a grazing angle and a little sheen tells stone from earth.
 * The world camera looks *down* at every top with the key light above and
 * behind it, so a mountain at 0.55 roughness and 0.2 metal took a broad grey
 * highlight across every summit, and metal's lost diffuse took a fifth of its
 * colour — rock read as a pale glare and the ranges flattened into the haze.
 * Matte, every face is its colour times its light: cube faces read by value,
 * which is the remaster's material reference. Water keeps its own finish; the
 * shore layer draws its surface (`ShoreDressing`) and the prism under it is
 * barely seen.
 */
export function worldFinish(key: string, d: { roughness: number; metalness: number }): { roughness: number; metalness: number } {
  return key === TileType.Water || key.endsWith(`_${TileType.Water}`) ? d : { roughness: 1, metalness: 0 };
}

/**
 * Deterministic per-tile randomness.
 *
 * A hash of the coordinate rather than a stored field: variant choice, rotation
 * and colour jitter are presentation, so they must not cost a byte of save file
 * or a `SAVE_VERSION` bump — and hashing gives the same answer on every load
 * without any of that. `salt` separates the uses so a tile's variant and its
 * rotation are not the same number wearing two hats.
 *
 * Salts in use: 4 colour jitter, 5 road marker, 6 elevation relief, 7 tile
 * texture turn, 11/12 arena tile height and shade, 13–18 the overworld's cloud
 * bank (offset x, height, offset z, size, turn, present?).
 *
 * 1–3 and 8–10 were the world map's decoration rolls — decorate?, variant and
 * turn for living ground, and marker?, decorate? and variant for haunted — and
 * are retired with them: a hex's scenery is composed by `worldScenery.ts` from
 * a generator seeded on the hex, which asks as many questions as a recipe
 * needs without a salt apiece. Retired rather than reused, so nothing that
 * reads an old salt silently starts correlating with something new.
 */
export function tileHash(coord: HexCoord, salt: number): number {
  const h = Math.sin(coord.q * 127.1 + coord.r * 311.7 + salt * 74.7) * 43758.5453;
  return ((h % 1) + 1) % 1;
}

/** Deterministic hash of a string, for seeding a layout on an id. */
export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * What `tileType` key a tile's material is looked up under.
 *
 * The tile's **zone** decides, not two independent booleans. `road` and
 * `isDanger` used to be separate fields that could in principle both be true,
 * and the answer then depended on which was checked first — a contradiction the
 * type system could not see. A tile is exactly one zone.
 */
export function tileSurfaceKey(tile: MapTile): string {
  if (tile.zone === 'road') return 'road';
  const ground = groundKey(tile);
  return tile.zone === 'haunted' ? `danger_${ground}` : ground;
}

/**
 * The living surface a tile stands on, zone aside. Frozen rock is its own
 * surface, and frozen anything else is already Tundra or water and draws as
 * itself; a Jadeveil tile draws as its ground.
 */
function groundKey(tile: MapTile): string {
  if (tile.jade) return `jade_${tile.jade}`;
  if (tile.isle) return `isle_${tile.isle}`;
  return tile.frost && FROST_DISPLAY[tile.type] ? `frost_${tile.type}` : tile.type;
}

/**
 * The world map's ground key: a road cell draws the ground it crosses.
 *
 * The road is narrow worn track drawn over it (`worldmap/worldTracks.ts`), so a
 * road cell's top is its own plains, wood, sand or snow rather than a hexagon
 * of paving. Only the overworld's prisms read this; the zone and every rule
 * that reads it are untouched, and `tileSurfaceKey` still names `road`.
 */
export function worldSurfaceKey(tile: MapTile): string {
  if (tile.zone !== 'road') return tileSurfaceKey(tile);
  return groundKey(tile);
}

/**
 * The colour of the ground a road cell crosses, as its prism draws it: what the
 * road's verge and tufts blend into (`worldTracks.roadColours`).
 */
export function worldGroundTile(tile: MapTile): string {
  if (tile.jade) return JADE_DISPLAY[tile.jade].tile;
  if (tile.isle) return ISLE_DISPLAY[tile.isle].tile;
  return (tile.frost ? FROST_DISPLAY[tile.type] : undefined)?.tile ?? TERRAIN_DISPLAY[tile.type].tile;
}

/** The `SurfaceDisplay` behind that key. */
export function surfaceForTile(tile: MapTile): SurfaceDisplay {
  if (tile.zone === 'road') return ROAD_DISPLAY;
  if (tile.jade) return tile.zone === 'haunted' ? DANGER_JADE_DISPLAY[tile.jade] : JADE_DISPLAY[tile.jade];
  if (tile.isle) return ISLE_DISPLAY[tile.isle];
  const frozen = tile.frost ? FROST_DISPLAY[tile.type] : undefined;
  if (tile.zone === 'haunted') {
    return (frozen && DANGER_FROST_DISPLAY[tile.type]) ?? DANGER_DISPLAY[tile.type] ?? TERRAIN_DISPLAY[tile.type];
  }
  return frozen ?? TERRAIN_DISPLAY[tile.type];
}

/**
 * Rendered elevation of a tile, in `MapTile.height` units.
 *
 * Both consumers must go through this — the tile itself *and* `PropMarker`'s
 * `tileTop`. A prop reading the raw `height` while the ground under it is
 * jittered floats or sinks by the whole relief amplitude.
 */
export function tileElevation(tile: MapTile): number {
  if (seaStanding(tile)) return worldLift(WATER_HEIGHT);
  const relief = ROCK_RELIEF.has(tile.type) ? surfaceForTile(tile).relief
    : tile.zone === 'road' || tile.type === TileType.Water ? 0 : LEVEL_RELIEF;
  return worldLift((tile.height ?? 0) + tileHash(tile.coord, 6) * relief);
}

/**
 * Every hex of level ground stands a little above or below its neighbours, in
 * `MapTile.height` units (board look, 2026-10-29): under 0.03 of a unit on its
 * top, so each hex is a counter with a hairline of wall where it stands over
 * the next, the way the designer's reference (`MAP.webp`) lays its board; the rim
 * line does most of that work. Under the smallest gap between two kinds of
 * level ground (snowfield 0.3 to sand 0.4), so the jitter never stands one
 * kind over the next. Roads stay level, so a track never steps between its
 * cells, and open water is the shore layer's.
 */
export const LEVEL_RELIEF = 0.09;

/**
 * The terrains whose hexes keep their surface's own relief on the world map:
 * rock, where the steps are the landform and the massif (`worldLandforms.ts`)
 * stands on them. Level ground takes the smaller `LEVEL_RELIEF`.
 */
export const ROCK_RELIEF: ReadonlySet<TileType> = new Set([TileType.Highlands, TileType.Mountain]);

/**
 * How much deeper open water is drawn than it is generated: half as deep again,
 * so a lake sits down in its banks. `WORLD_LIFT_SEA` is where that starts.
 */
export const WORLD_LIFT = 1.5;

/**
 * Where level ground ends below sea level, in `MapTile.height` units — under
 * the bog (−0.2), above open water (−0.8). A bog lies level with the meadow
 * beside it like the rest of level ground (its mud rim and pools are the
 * shore layer's), and the water below this line is drawn exactly as deep as it
 * was, so a lake keeps its banks.
 */
export const WORLD_LIFT_SEA = -0.25;
const WATER_HEIGHT = -0.8;

/**
 * Level ground — plains, snowfield, desert, forest, all between sea level and
 * the knee — is drawn at its generated rise.
 *
 * The generated heights are traversal rules (`MAX_CLIMB` sits in a window
 * between them), so every terrain stands at its own height and every change of
 * terrain is a step at a hex edge. The remaster drew level ground at a quarter
 * of its rise, a crease rather than a wall, for continuous ground; the board
 * look (2026-10-29) wants the wall: plains to forest is 0.18 of a unit and
 * plains to sand 0.12, a short earth side under the higher tile's rim, which
 * is how the designer's reference (`MAP.webp`) says where one ground ends. Rock
 * keeps its height (`WORLD_LIFT_ROCK`).
 */
export const WORLD_LIFT_LOW = 1;

/**
 * Where level ground ends, in `MapTile.height` units — above forest, below the
 * highlands.
 */
export const WORLD_LIFT_KNEE = 0.8;

/**
 * Where rock begins (the highlands' generated height), and the height it is
 * drawn at there: exactly where it was drawn before level ground was laid flat
 * (0.8 × 1.5 + 0.6 × 0.3), so the ridges, crowns and the cliffs round a range
 * stand as tall as F4 composed them and only the low steps between level
 * grounds shrank. Between the knee and here no tile stands (heights are per
 * terrain), so the steep ramp only keeps the curve continuous.
 */
export const WORLD_LIFT_ROCK = 1.4;
export const WORLD_LIFT_ROCK_Y = 1.38;

/**
 * Past the rock line the scale is `WORLD_LIFT_HIGH`, and that is a readability
 * rule rather than taste. Tall full-hex foundations make mountains read as
 * isolated counters and hide legal destinations at the travel pitch. Compress
 * the foundations above ordinary terrain: connected stepped outcrops carry the
 * range's silhouette, while these tops remain the shared navigable surface.
 */
export const WORLD_LIFT_HIGH = 0.3;

/**
 * Generated height (plus relief) to drawn height, both in `MapTile.height` units.
 *
 * Monotonic and continuous, so an order of heights on the map is the order on
 * screen and two tiles of one height stand level. Render-only: nothing that
 * decides a step — `movementCost`, `MAX_CLIMB` — ever reads it.
 */
export function worldLift(height: number): number {
  if (height <= WORLD_LIFT_SEA) {
    const sea = WORLD_LIFT_SEA * WORLD_LIFT_LOW;
    return sea + ((height - WORLD_LIFT_SEA) * (WATER_HEIGHT * WORLD_LIFT - sea)) / (WATER_HEIGHT - WORLD_LIFT_SEA);
  }
  if (height <= 0) return height * WORLD_LIFT_LOW;
  if (height <= WORLD_LIFT_KNEE) return height * WORLD_LIFT_LOW;
  const knee = WORLD_LIFT_KNEE * WORLD_LIFT_LOW;
  if (height <= WORLD_LIFT_ROCK) {
    return knee + ((height - WORLD_LIFT_KNEE) * (WORLD_LIFT_ROCK_Y - knee)) / (WORLD_LIFT_ROCK - WORLD_LIFT_KNEE);
  }
  return WORLD_LIFT_ROCK_Y + (height - WORLD_LIFT_ROCK) * WORLD_LIFT_HIGH;
}

/**
 * World-space height of the walking surface, from an elevation.
 *
 * The `0.3` and the `0.1` were written out at each call site — the world map's
 * prop marker and the location scene's — and a third consumer arrived the moment
 * mountains became walkable, because the party token has to stand on the ground
 * too. Anything that sits *on* a tile goes through this; anything that computes
 * it again is the next thing to sink into a hillside.
 *
 * Takes the elevation rather than the tile because locations have no `MapTile`
 * and no relief — they pass their raw height and get the same arithmetic.
 */
export function tileTopY(elevation: number): number {
  return elevation * 0.3 + 0.1;
}

/**
 * The archipelago's lair doors, whose models are named for the place rather than
 * for the lair (`archipelagoProps.ts`): the Sunken Hull and the Flooded Grotto.
 * Their lairs are still to come, so `poi_<lairId>` would find nothing.
 */
const ISLE_DOOR_PROPS: Readonly<Record<string, string>> = {
  lair_hull: 'poi_sunken_hull',
  lair_grotto: 'poi_flooded_grotto',
};

/**
 * The places whose model brings its own land up out of the sea: Varr's fortress
 * on its cliff and the Flooded Grotto's rock, each standing in its own water
 * (`archipelagoProps.ts`).
 */
const SEA_STANDING: ReadonlySet<string> = new Set(['poi_varr_stronghold', 'poi_flooded_grotto']);

/**
 * Whether a tile's place stands in the sea rather than on the hex: the hex is
 * drawn at the sea's level, under the shore layer's water (`worldShores.ts`),
 * so the model's water is the sea's and its cliff is the coast. Render-only —
 * the hex keeps its terrain and its generated height, so every step and climb
 * rule reads what it always did.
 */
export function seaStanding(tile: MapTile): boolean {
  return !!tile.poi && propKeysFor(tile).some((key) => SEA_STANDING.has(key));
}

/**
 * Which props stand at a tile's centre: a destination, a person, the road's
 * wreckage — and nothing else.
 *
 * Terrain used to be decorated here too, by rolling one pre-merged variant per
 * hex, and haunted ground by rolling a `danger_*` marker on a third of its
 * hexes. Both were one prop per hex decided without looking next door, which is
 * why a wood's middle looked like its edge and a blighted region was the same
 * dark silhouette repeated. The ground's scenery is composed from the hex and
 * its neighbours in `components/worldmap/worldScenery.ts` now, several strategic
 * pieces to a hex, and this answers only for the things that stand *on the
 * centre* — which is also why no scenery piece may stand there.
 *
 * A list rather than a single key so a destination can carry more than one
 * prop without a second function.
 */
export function propKeysFor(tile: MapTile): string[] {
  // The archipelago's sea: the party's ship at its berth by the camp, the storm over its channel.
  if (tile.berth) return ['board_ship'];
  if (tile.storm) return ['board_storm'];
  if (tile.poi === POIType.City)         return ['poi_city'];
  // A named quest site is its own model, `poi_<questId>`, by the doors'
  // convention below; an unnamed `quest_N` waypoint keeps the shared arch.
  // `questSiteModels.test.ts` pins that every named site has one.
  if (tile.poi === POIType.QuestSite)
    return [isQuestSiteId(tile.questId) ? `poi_${tile.questId}` : tile.jade ? 'poi_torii' : 'poi_quest'];
  // Each lair's door is its own model — a burrow, a cave, a glacier — named by
  // the lair it opens: `poi_lair_warren` for `lair_warren`. By convention
  // rather than by table, because this module may not reach the model registry
  // (`modelMap` imports it); `worldLandmarks.test.ts` pins that every lair the
  // game places has a door registered under the name this builds.
  if (tile.poi === POIType.BossTile) {
    const isle = tile.encounterId ? ISLE_DOOR_PROPS[tile.encounterId] : undefined;
    if (isle) return [isle];
    return [tile.encounterId?.startsWith('lair_') ? `poi_${tile.encounterId}` : 'poi_boss'];
  }
  // Jadeveil's own wayside places stand where the Empire's shared ones would:
  // a spirit spring, a tea house, a torii (`landmarks.ts`).
  if (tile.poi === POIType.MagicWell)    return [tile.jade ? 'poi_spirit_spring' : 'poi_magic_well'];
  if (tile.poi === POIType.EmpireCastle) return ['poi_empire_castle'];
  // The road between worlds has an arch at each end: the Empire's frontier
  // and the far world's arrival camp.
  // Jadeveil's end of it is the foothill camp, gate and tents in one model.
  if (tile.poi === POIType.WorldGate)    return [tile.jade ? 'poi_foothill_camp' : 'poi_world_gate'];
  if (tile.poi === POIType.Shrine)       return ['poi_shrine'];
  if (tile.poi === POIType.Summit)       return ['poi_summit'];
  // A village stands occupied; `propPlacement` swaps in the `_free` twin once it is freed.
  if (tile.poi === POIType.Village)      return tile.village ? [`poi_village_${tile.village}`] : [];
  // The archipelago's places (`voxel/models/archipelagoProps.ts`); a fort stands held
  // until freeing it is built, when `propPlacement` can swap in `poi_pirate_fort_freed`.
  if (tile.poi === POIType.IsleCamp)     return ['poi_home_camp'];
  if (tile.poi === POIType.Stronghold)   return ['poi_varr_stronghold'];
  if (tile.poi === POIType.PirateFort)   return ['poi_pirate_fort'];
  if (tile.poi === POIType.IslePort)     return ['poi_island_port'];
  // A wayside is a person, so what stands on it is that person's own figure —
  // resolved through `npcPropKey` rather than a table here, because a second
  // id-to-prop mapping is a second thing that can disagree with `npcData`.
  // Their camp stands with them: it is what reads as somebody's at travel zoom.
  if (tile.poi === POIType.Wayside) {
    const figure = npcPropKey(tile.npcId);
    return figure ? [figure, tile.jade ? 'poi_tea_house' : 'poi_wayside_camp'] : [];
  }
  // Wreckage every few tiles along the road, not on every one — a continuous
  // line of debris reads as a fence rather than as the aftermath of an army
  // The Legion never marched the pilgrim road, so Jadeveil's carries no
  // wreckage — only prayer flags where it climbs into a harder band.
  if (tile.pass && !tile.poi) return ['poi_pass_flags'];
  if (tile.zone === 'road' && !tile.poi && !tile.jade)
    return tileHash(tile.coord, 5) < ROAD_MARKER_RATE ? ['road_marker'] : [];
  return [];
}
