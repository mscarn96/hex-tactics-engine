import type { BuildingType, POIType, ResourceType, TileType } from './enums';
import type { HexCoord } from './hex';

// ============ MAP ============

/**
 * What Jadeveil's sky does at a wrath reading (`systems/world/wrath.ts`): clear,
 * then cloud, rain and storm at each permanent floor, and calm while a full bar
 * holds the summit open.
 */
export type WrathWeather = 'clear' | 'clouds' | 'rain' | 'storm' | 'calm';

/**
 * What kind of ground a tile is, structurally.
 *
 * The overworld used to be a noise field with a difficulty gradient over it:
 * terrain varied, threat rose with distance, and `isDanger` was scattered by a
 * per-band probability. That gave the map texture but no **shape** — nothing on
 * it was a route, a frontier or a place you decided to leave. This is the shape.
 *
 * - `road` — the network joining the city to the Obsidian castle, plus branches.
 *   **Never holds an encounter**, and costs less time to walk.
 * - `corridor` — ordinary ground within a few hexes of a road. Quiet, but not
 *   silent.
 * - `haunted` — everything the roads do not reach. Where the fights are, and
 *   where every lair door, ore vein and magic well is placed.
 *
 * It replaces two separate booleans (`isDanger` and `road`) that between them
 * described the same question in two half-answers and could contradict each
 * other. One field, three states, and a tile is exactly one of them.
 *
 * **Haunted is a treatment, not a terrain.** Haunted forest is still forest —
 * `DANGER_DISPLAY` has carried the scorched palette per terrain all along.
 */
export type TileZone = 'road' | 'corridor' | 'haunted';

export interface MapTile {
  coord: HexCoord;
  type: TileType;       // terrain only
  poi?: POIType;        // optional overlay (City, QuestSite, BossTile, MagicWell, …)
  height?: number;      // tile elevation, set by mapGenerator (0 = plains level)
  /**
   * Danger band 0–4, set by mapGenerator from distance to the city and to the
   * Obsidian castle. Drives encounter size, enemy power and rewards.
   *
   * The band is *distance* difficulty; `zone` is *structural* difficulty, and
   * the two compose — haunted ground is a step up within whatever band it sits
   * in. See `systems/world/threat.ts`.
   */
  threat?: number;
  /** Road, corridor or haunted. Always set by `mapGenerator`. */
  zone: TileZone;
  explored: boolean;
  encounterId?: string;
  questId?: string;
  /**
   * Who is standing here, on a `POIType.Wayside` tile.
   *
   * A plain `string` rather than `NpcId` for the same reason `encounterId` and
   * `questId` are: `models/` sits under everything and must not import the
   * quest layer to describe a tile. The one place it is written
   * (`mapGenerator`) types it properly on the way in.
   */
  npcId?: string;
  defeated?: boolean;
  /**
   * Inside the frozen north. Set by `mapGenerator`'s latitude pass on every tile
   * of the region, whatever its terrain: level ground there is already
   * `TileType.Tundra`, and this is what tells a snow-capped peak or a frozen
   * shoulder from the same rock further south.
   */
  frost?: boolean;
  /**
   * Which of Jadeveil Range's grounds this tile wears. Set by `mapGenerator` on
   * every land tile of a `range` world and on nothing else. The terrain under
   * it is an ordinary `TileType` with that type's height, so the climb rules
   * are the Empire's; this names the surface it is drawn as — see
   * `systems/world/rangeTerrain.ts`.
   */
  jade?: JadeGround;
  /**
   * On a `POIType.Village` tile: which of the four villages it is. A plain
   * string union declared here, not imported, for the reason `npcId` is a
   * `string`: `models/` sits under `data/`.
   */
  village?: 'lookout' | 'trading_post' | 'smithy' | 'shrine';
  /** On a `POIType.Shrine` tile: its place in the ascent, 1 lowest. */
  shrine?: number;
  /**
   * A road hex of a range where the road climbs into a harder band — a pass.
   * Set by `mapGenerator`; it carries the prayer flags that mark the step.
   */
  pass?: boolean;
  /**
   * Which of the archipelago's grounds this land tile wears, and so which
   * arena a fight on it is fought in: beach on desert, jungle on forest, rock
   * on highlands (`systems/world/isleTerrain.ts`). Set on the archipelago only.
   */
  isle?: IsleGround;
  /** On the archipelago's land: which island, 0 the camp's at the west edge to 5 Varr's at the east. */
  island?: number;
  /** On the archipelago's water: the shallows along a coast, or the deep sea between. */
  sea?: SeaDepth;
  /** The archipelago's sea hex where the party's ship lies at its berth, beside the camp. */
  berth?: boolean;
  /** The archipelago's sea hex the storm hangs over, in a channel between two islands. */
  storm?: boolean;
}

/**
 * Jadeveil's grounds, each on the terrain whose climb rules it keeps: moss on
 * plains, bamboo on forest, terraces on highlands, ridges and the storm-worn
 * crown on mountain, and the paved shrine ground on level tiles round a shrine.
 */
export type JadeGround = 'moss' | 'bamboo' | 'terrace' | 'ridge' | 'crown' | 'shrine';

/**
 * The archipelago's grounds (the private project notes): an island's beach, its
 * jungle and its basalt rock. Its fights reach their arenas by these (`MapTile.isle`).
 */
export type IsleGround = 'beach' | 'jungle' | 'rock';

/**
 * How deep the archipelago's sea runs at a hex: turquoise shallows beside a
 * coast, deep blue further out (`MapTile.sea`). Drawn only; water is water.
 */
export type SeaDepth = 'shallows' | 'deep';

// ============ EXPLORATION FINDS ============

/**
 * A one-week windfall lying on the open map.
 *
 * Not a `poi`: it is not a place on the generated map but a roll the calendar
 * deals every week — see `systems/world/finds.ts`. It lives in its own record
 * on `worldMapStore` (keyed by hex), so a tile never carries a find and
 * an encounter can never be mistaken for a destination.
 *
 * - `cache` — a few resources or a purse of gold, paid on arrival.
 * - `chest` — guarded treasure: arriving asks whether to fight its guards.
 */
export interface MapFind {
  kind: 'cache' | 'chest';
  coord: HexCoord;
  /** What claiming it pays. One entry for a cache; gold plus ore for a chest. */
  payout: { type: ResourceType; amount: number }[];
  /** The tile's danger band when it was dealt — what its loot and guards scale with. */
  band: number;
}

// ============ BUILDINGS ============

export interface Building {
  type: BuildingType;
  level: number; // 0-3
  /**
   * The level a lost siege knocked this building down from, while it is still
   * below it: steps up to it cost `REBUILD_COST_FRACTION` (`systems/economy/sacking.ts`).
   */
  rebuildTo?: number;
}

export interface BuildingData {
  /** Also the key of its name and description (`buildingName`, `buildingDescription`). */
  type: BuildingType;
  maxLevel: number;
  upgradeCosts: Record<ResourceType, number>[];
}

// ============ ENCOUNTERS ============

export interface EncounterDef {
  id: string;
  enemies: string[]; // enemy template IDs
  isQuest?: boolean;
  isBoss?: boolean;
  rewardItemIds?: string[];
  rewardHeroId?: string;
}
