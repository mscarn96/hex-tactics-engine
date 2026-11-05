import { EnvironmentPreset } from '@/data/display/lighting';
import { BuildingType } from '@/models/types';
import { NpcId } from '@/quests/types';
import { HexCoord, hexKey } from '@/utils/hexUtils';

/**
 * The third kind of map.
 *
 * The world map is procedural and the arena is bounded and turn-based; a
 * location is neither. It is a small hand-authored hex map walked around outside
 * combat — the city, a boss lair, the Obsidian castle. One abstraction rather
 * than three special-cased scenes, which is the only reason the castle can be a
 * place at all without being a fourth scene component.
 *
 * Pure TypeScript with no React Native imports, the same rule `src/voxel/`
 * follows, so a location can be rendered by the Vite harness without booting
 * Metro — and so the layout is testable in the node-environment Jest setup.
 */

export type LocationId =
  | 'city'
  | 'lair_warren'
  | 'lair_barrow'
  | 'lair_wyrm'
  // Jadeveil's two (`locations/jadeveil/`)
  | 'lair_silk'
  | 'lair_hall'
  // Jadeveil's home: the foothill camp (`locations/jadeveil/foothillCamp.ts`)
  | 'camp_jadeveil'
  | 'castle';

/**
 * Ground under a tile. Deliberately its own vocabulary rather than the world
 * map's `TileType`: a paved square and a plains hex are not the same thing, and
 * borrowing the enum would make every future location speak in biomes.
 */
export type LocationSurface =
  | 'grass' | 'path' | 'stone' | 'water' | 'wood' | 'dirt' | 'cobble'
  // A lair's chambers and walls, three to a lair — see `SURFACE_DISPLAY`
  | 'earth' | 'burrow' | 'basalt' | 'ash' | 'cavern' | 'snowpack' | 'blueice' | 'glacier'
  // Jadeveil: Silent Hall / Fallen Order
  | 'temple_boards' | 'hall_slate' | 'mountain_granite'
  // Jadeveil: Silk Hollow / Yokai
  | 'silkmoss' | 'bamboo' | 'rootwall';

export type Trigger =
  /** Opens the building's existing modal, unchanged. */
  | { kind: 'door'; building: BuildingType }
  /** Back to wherever the party came from. */
  | { kind: 'exit' }
  | { kind: 'npc'; npc: NpcId }
  /**
   * The strongroom. The one place items can be put beyond a defeat's reach —
   * and, since the bag became preview-and-equip only, the one place they can be
   * taken back out of. A door of its own rather than a tab on the bag, because
   * what makes the shelf worth the walk is that it is somewhere.
   */
  | { kind: 'stash' }
  /**
   * The Obsidian gate. Opens the tier-and-Seal dialog rather than a fight — the
   * gauntlet behind it is four encounters with no ground between them, and is
   * deliberately not a location.
   */
  | { kind: 'castleGate' }
  | { kind: 'encounter'; encounterId: string }
  /**
   * `kit` is what the chest is guaranteed to hold, made for the party: one
   * Legendary (`legendary`) or two Epics (`epics`) — see `rollLairChest`.
   */
  | { kind: 'chest'; lootTier: number; kit: 'legendary' | 'epics' }
  | { kind: 'sign'; text: string }
  /**
   * One of the foothill camp's stations: the fire (a rest), the monastery,
   * the pack-trader (selling) and the whetstone (salvage) each open their own
   * counter (`CampCounter`); the lacquered gate is the road to the other world
   * and asks for the crossing.
   */
  | { kind: 'camp'; station: CampStation };

/** The foothill camp's stations — see the `camp` trigger. */
export type CampStation = 'fire' | 'monastery' | 'trader' | 'whetstone' | 'road';

export interface LocationTile {
  coord: HexCoord;
  surface: LocationSurface;
  height?: number;
  /** Scenery only — the party walks around it. */
  blocked?: boolean;
  /** Key into `WORLD_PROP_DEFS`. */
  prop?: string;
  propRotation?: number;
  /**
   * What the tile shows once its one-shot trigger is spent: an opened chest, a
   * cleared chamber. `null` shows nothing; absent keeps `prop`. A chest that
   * still looks shut after it was looted is a destination the player walks back
   * to for nothing, and nothing but the picture can tell them otherwise.
   */
  spentProp?: string | null;
  /**
   * A shade over the ground's own colour, as a hex multiplier. Absent, a tile is
   * drawn plain and a blocked one a step darker — the rule every place had. A
   * lair states its own: the floor darkening toward its walls, and the rock
   * past the walls darker than the walls.
   */
  tint?: string;
  trigger?: Trigger;
  /**
   * Floating caption, so a door announces itself before you walk into it. An
   * id, not text: `tileLabel` (`locations/text.ts`) reads the words.
   */
  label?: TileLabel;
}

/**
 * What a tile's caption names. Most are `places.label.<id>.text`; `place` is
 * the location's own name (a lair's boss chamber, the castle's gate). A
 * person's tile carries none: it is named by its `npc` trigger.
 */
export type TileLabel =
  | 'barracks' | 'library' | 'forge' | 'tavern' | 'market' | 'shop' | 'stash'
  | 'leave' | 'withdraw' | 'guarded' | 'chest'
  // The foothill camp's stations, and its way out onto the range
  | 'campfire' | 'monastery' | 'trader' | 'whetstone' | 'road' | 'range'
  | 'place';

/**
 * One piece of cosmetic scenery: a wall run, a tower, a cottage, a lamp, a tree.
 *
 * **A separate layer from `tiles`, and the separation is the point.** A tile is
 * navigation — whether the party can stand there, what happens when it does,
 * what a tap on it means — and a tile's prop is drawn *on* it, one per hex. A
 * walled town is made of things that are none of that: a curtain wall runs
 * along the boundary between hexes, a gatehouse straddles two, a row of houses
 * backs onto a street without standing on it, and the countryside outside the
 * wall stands where there are no tiles at all. Forcing those into `prop` would
 * mean inventing a tile for each one, which is inventing a hex the party can
 * tap on or walk into.
 *
 * So a piece names the hex it is measured from and a world-unit offset off its
 * centre, and nothing else in the game reads it: pathfinding, triggers, the save
 * and the tap raycast all go through `tiles`, and the layer is drawn by
 * `InstancedProps`, which is never raycast. Anchoring on a hex rather than on
 * raw world coordinates is for the author: "the tower on the north-east corner"
 * is a hex, and moving the ring moves the tower with it.
 */
export interface ScenicPiece {
  /** Key into `WORLD_PROP_DEFS`. */
  key: string;
  /** The hex the offset is measured from; need not be a tile. */
  at: HexCoord;
  /** World-unit offset off the hex centre. */
  dx?: number;
  dz?: number;
  /** Y-axis turn in radians. */
  turn?: number;
  /** Multiplies the prop's registered scale. */
  scale?: number;
  /** World units above the ground it stands on. */
  lift?: number;
  /**
   * The destination this piece *is*: a building's door, the gate under the
   * gatehouse. A tap anywhere on the piece is taken as a tap on that hex, so a
   * building several hexes long is its own target rather than a roof a tap
   * falls through onto whatever street runs behind it.
   */
  opens?: HexCoord;
  /**
   * The one-shot trigger this piece belongs to, and what it becomes once that
   * trigger is spent — a guard post knocked down, a boss's brazier gone out.
   * `key: null` removes it. Read by `locationPropItems` against the save's own
   * spent set, so the picture is derived from the one record there is.
   */
  whenSpent?: { at: HexCoord; key: string | null };
  /**
   * The service this piece is the building of. Its look follows the town's
   * state (`TownLook`): `<key>_l<level>` for the service's level, or
   * `<key>_sacked` while the town is sacked, falling back to `key` where no
   * such model is registered.
   */
  building?: BuildingType;
}

/**
 * What a town's buildings are drawn from: each service's level, and whether a
 * lost siege has left the town sacked. Passed in by the scene from `cityStore`,
 * so `locations/` stays free of stores.
 */
export interface TownLook {
  levels: Partial<Record<BuildingType, number>>;
  sacked?: boolean;
}

/** A walked place. Its name is `places.<id>.name`, read through `placeName`. */
export interface LocationDef {
  id: LocationId;
  /** Where the party stands on arrival. */
  entry: HexCoord;
  tiles: LocationTile[];
  ambient: { fog: string; ground: string };
  /**
   * Which light preset this place is lit under.
   *
   * Authored rather than derived from the id or the surface mix: the city is a
   * walled town under the sky and the castle is a hall under a roof, and both
   * are mostly paved. Nothing about `LocationSurface` can tell them apart, and a
   * table of ids beside the definitions would be a second place to state a fact
   * the definition already has room for.
   */
  environment: EnvironmentPreset;
  /**
   * Set on the three boss lairs.
   *
   * `bossAt` is the identity of the run: the lair counts as beaten when that one
   * hex's trigger has been spent, so completion is *derived* from the trigger set
   * rather than being a second flag that can disagree with it.
   *
   * `unlockLevel` is **summed** party level. A lair is one fight the party has to
   * be worth as a whole, which is the same measure the quest gates use.
   */
  lair?: { bossAt: HexCoord; unlockLevel: number };
  /** Cosmetic scenery that is not a tile — see `ScenicPiece`. */
  scenery?: ScenicPiece[];
  /**
   * How far past its southern tiles a place framed whole is framed, in world
   * units: the approach outside the gate, which is what arriving looks at. The
   * city's river and bridge are there, and a frame that stopped at the wall
   * would never show them — the camera follows the party only as far as the
   * frame reaches (`locationFraming.ts`). It widens the pinch-out limit and the
   * follow's reach, and the opening does not see it: that is a hex size.
   */
  frameSouth?: number;
}

/**
 * Whether a trigger fires once per save rather than every visit.
 *
 * Chests and set-piece encounters are consumed; doors and signs are furniture.
 * **Chests never respawn** — a lair is a place you loot once, not a farm, and
 * that is the whole reason the spent-trigger set is persisted.
 */
export function isOneShot(trigger: Trigger): boolean {
  return trigger.kind === 'chest' || trigger.kind === 'encounter';
}

/**
 * Identity of a one-shot trigger, for the persisted spent set.
 *
 * Keyed by position rather than by a hand-authored id: in an authored map the
 * hex *is* the stable identity, and requiring an id would be one more thing to
 * get wrong per chest for no information gained.
 */
export function triggerKey(location: LocationId, coord: HexCoord): string {
  return `${location}:${hexKey(coord)}`;
}
