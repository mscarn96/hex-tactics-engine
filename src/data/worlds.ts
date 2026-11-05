import { HexCoord, POIType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { entryText } from '@/i18n/dataText';

/**
 * The surface worlds a campaign can stand in, as data.
 *
 * `mapGenerator` used to read its dimensions, its two anchors, its threat radii
 * and its zone rules straight from `BALANCE`, which welded every rule to the
 * Empire's 70×70 map. Each world now owns them. The Empire's numbers are the
 * shipped ones, unchanged and still tuned in `balanceConstants.ts`; its map,
 * routes and threat bands are identical seed for seed (`worlds.test.ts`).
 *
 * See the private project notes for why the world split runs where
 * it does — the party, inventory, city, quests and clock stay global.
 */
export type WorldId = 'empire' | 'jadeveil' | 'archipelago';

/** Appended, never inserted: `worldSeed` mixes in a world's place here, so a new id moves no map. */
export const WORLD_IDS: readonly WorldId[] = ['empire', 'jadeveil', 'archipelago'];

/** The worlds beyond the Empire: each takes a level band on its first crossing (`systems/world/worldBands.ts`). */
export const EXPANSION_WORLD_IDS: readonly WorldId[] = WORLD_IDS.filter((id) => id !== 'empire');

/**
 * The radii `threatDepth` measures from a world's two anchors.
 *
 * `home` is the upper bound of each band from the home anchor; `far` forces a
 * minimum band within each distance of the far anchor, worst first. The far
 * pole *binds* only where `home[i] + far[3 - i]` exceeds the anchors'
 * separation — the Empire's never does (the measurement in the plan), and a new
 * world's should, so its gradient has a direction rather than only a radius.
 */
export interface ThreatRadii {
  home: readonly number[];
  far: readonly number[];
}

/** The rules that turn roads into corridor and haunted ground. */
export interface ZoneRules {
  corridorMin: number;
  corridorMax: number;
  roadBranches: number;
  homeHauntedInner: number;
  homeHauntedRadius: number;
  homeHauntedMin: number;
  /** Off-road ground within this many hexes of the far pole is always haunted; 0 for none. */
  farHauntedRadius: number;
}

/**
 * How a world's ground is generated. `temperate` is the Empire's one noise
 * value cut into bands; `range` is an altitude rising from the home anchor to
 * the far one (`systems/world/rangeTerrain.ts`), and its roads climb rather
 * than level the rock they cross; `isles` is a chain of islands in a sea, from
 * the home anchor's island to the far one's (`systems/world/isleTerrain.ts`),
 * its bands one to an island rather than radii.
 */
export type WorldTerrain = 'temperate' | 'range' | 'isles';

export interface WorldDef {
  id: WorldId;
  terrain: WorldTerrain;
  /**
   * Whether the home anchor is a camp: its gate opens the camp's services
   * (selling, salvage, a rest) as well as the road to the other world.
   */
  camp: boolean;
  /** The world this world's own gate names: the first road out of it. */
  gateTo: WorldId;
  /**
   * Whether a release of this build can cross to this world. A world without it counts for nothing:
   * not toward crossings opened, not at any gate. Jadeveil has it; the archipelago gets it when
   * Archipelago 1 builds the harbour.
   */
  enterable: boolean;
  /** Whether a `DEV_TOOLS` build offers this world at the Empire's gate before it is `enterable`. */
  devCrossing?: boolean;
  width: number;
  height: number;
  /** The safe anchor: the city in the Empire, the arrival camp elsewhere. */
  home: HexCoord;
  homePoi: POIType;
  /** The deep anchor the artery runs to: the castle in the Empire. */
  far: HexCoord;
  /** What stands on the far anchor, if anything does yet. */
  farPoi: POIType | null;
  threat: ThreatRadii;
  /**
   * Beyond the Empire: each threat band's level inside the world's level band, as an offset from the
   * band floor (0–4). Wandering fights, quest sites and kill objectives take the offset of the ground
   * they are on (`systems/world/contentLevel.ts`). The Empire has none: it scales with the party.
   */
  levelOffsets?: readonly number[];
  zones: ZoneRules;
  /**
   * Which of the Empire's authored content the generator places here. A
   * world's own lairs, people and destinations are its own content; another
   * world's are never dealt onto it, which is also what keeps a location id —
   * and so every spent-trigger key — inside the one world that owns it.
   */
  content: {
    frost: boolean;
    lairs: boolean;
    questSites: boolean;
    waysides: boolean;
    /** Places the four villages (`POIType.Village`, `data/villages.ts`). */
    villages: boolean;
    /** Places the distinct door to the next world (`POIType.WorldGate`). */
    gate: boolean;
    /** How many shrines climb the pilgrim road from home to the far anchor. */
    shrines: number;
    /** Places the magic wells (`POIType.MagicWell`). */
    wells: boolean;
    /**
     * Whether warbands roll on the map each dawn (`worldState.rollDailyEncounters`).
     * A world whose factions are still to come has nothing to roll, and nothing
     * of its gear to find a pattern in (`forge.patternsToFind`).
     */
    encounters: boolean;
  };
}

/**
 * Where the Obsidian castle stands, for a map of this size: the far corner from
 * the city, inset so the map edge does not clip it. Rows are offset by r/2 in
 * axial space, so the inset is computed against row `r`'s own right edge.
 */
export function empireCastleCoord(width: number, height: number): HexCoord {
  const r = height - 4;
  const rowOffset = Math.floor(r / 2);
  return { q: width - rowOffset - 4, r };
}

const EMPIRE_WIDTH = BALANCE.MAP_WIDTH;
const EMPIRE_HEIGHT = BALANCE.MAP_HEIGHT;

export const EMPIRE_WORLD: WorldDef = {
  id: 'empire',
  terrain: 'temperate',
  camp: false,
  gateTo: 'jadeveil',
  enterable: true,
  width: EMPIRE_WIDTH,
  height: EMPIRE_HEIGHT,
  home: { q: Math.floor(EMPIRE_WIDTH / 4), r: Math.floor(EMPIRE_HEIGHT / 2) },
  homePoi: POIType.City,
  far: empireCastleCoord(EMPIRE_WIDTH, EMPIRE_HEIGHT),
  farPoi: POIType.EmpireCastle,
  threat: { home: BALANCE.THREAT_CITY_RADII, far: BALANCE.THREAT_CASTLE_RADII },
  zones: {
    corridorMin: BALANCE.CORRIDOR_MIN,
    corridorMax: BALANCE.CORRIDOR_MAX,
    roadBranches: BALANCE.ROAD_BRANCHES,
    homeHauntedInner: BALANCE.HOME_HAUNTED_INNER,
    homeHauntedRadius: BALANCE.HOME_HAUNTED_RADIUS,
    homeHauntedMin: BALANCE.HOME_HAUNTED_MIN,
    farHauntedRadius: BALANCE.CASTLE_HAUNTED_RADIUS,
  },
  content: { frost: true, lairs: true, questSites: true, waysides: true, villages: true, gate: true, shrines: 0, wells: true, encounters: true },
};

const JADEVEIL_WIDTH = BALANCE.JADEVEIL_MAP_WIDTH;
const JADEVEIL_HEIGHT = BALANCE.JADEVEIL_MAP_HEIGHT;

/**
 * The second world: a range climbing from the foothill camp in the south-west
 * to the summit in the north-east, so the map is afraid of one direction. Its
 * ground is an altitude rather than the Empire's noise bands, four shrines
 * stand on the pilgrim road up, and its bands are spread more evenly than the
 * Empire's (`docs/world.md`). Its factions, lairs and people are
 * still to come; nothing of the Empire's is dealt onto it.
 */
export const JADEVEIL_WORLD: WorldDef = {
  id: 'jadeveil',
  terrain: 'range',
  camp: true,
  gateTo: 'empire',
  enterable: true,
  width: JADEVEIL_WIDTH,
  height: JADEVEIL_HEIGHT,
  // The south-west corner: the climb starts at the map's edge, nothing behind it
  home: { q: -Math.floor((JADEVEIL_HEIGHT - 1) / 2), r: JADEVEIL_HEIGHT - 1 },
  homePoi: POIType.WorldGate,
  far: { q: JADEVEIL_WIDTH - 7 - 2, r: 5 },
  farPoi: POIType.Summit,
  threat: { home: BALANCE.JADEVEIL_HOME_RADII, far: BALANCE.JADEVEIL_FAR_RADII },
  // Foothills, Bamboo Terraces, High Passes, Storm Ridges, Cloud Crown
  levelOffsets: [0, 1, 2, 3, 4],
  zones: {
    corridorMin: BALANCE.CORRIDOR_MIN,
    corridorMax: BALANCE.CORRIDOR_MAX,
    roadBranches: BALANCE.JADEVEIL_ROAD_BRANCHES,
    homeHauntedInner: BALANCE.HOME_HAUNTED_INNER,
    homeHauntedRadius: BALANCE.HOME_HAUNTED_RADIUS,
    homeHauntedMin: BALANCE.JADEVEIL_HOME_HAUNTED_MIN,
    farHauntedRadius: 0,
  },
  content: { frost: false, lairs: true, questSites: false, waysides: false, villages: false, gate: false, shrines: BALANCE.JADEVEIL_SHRINES, wells: true, encounters: true },
};

const ARCHIPELAGO_WIDTH = BALANCE.ARCHIPELAGO_MAP_WIDTH;
const ARCHIPELAGO_HEIGHT = BALANCE.ARCHIPELAGO_MAP_HEIGHT;

/**
 * The offset coordinate (`column`, `row`) as an axial hex: rows are offset by
 * r/2 in axial space, as the generator lays them.
 */
const atColumn = (column: number, row: number): HexCoord => ({ q: column - Math.floor(row / 2), r: row });

/**
 * The third world: the shattered archipelago, six islands in a sea (the private project notes,
 * *The shattered archipelago*). The party's camp stands on a beach of the island at the west edge,
 * its ship at a berth beside it; Captain Varr's stronghold on the island at the east edge. Generated
 * and drawn only for now: no factions roll on it, the sea is not sailed and only a development build crosses to it.
 * Its bands are the islands' own (`BALANCE.ISLE_BANDS`), so its threat radii, Jadeveil's, are read by
 * nothing on its map; they stand until its fights have an anchor to measure their depth from.
 */
export const ARCHIPELAGO_WORLD: WorldDef = {
  id: 'archipelago',
  terrain: 'isles',
  camp: true,
  gateTo: 'empire',
  enterable: false,
  devCrossing: true,
  width: ARCHIPELAGO_WIDTH,
  height: ARCHIPELAGO_HEIGHT,
  // On the west coast of the first island, two columns of sea behind it
  home: atColumn(2, ARCHIPELAGO_HEIGHT - 6),
  homePoi: POIType.IsleCamp,
  // On the east coast of the last, under the map's top edge
  far: atColumn(ARCHIPELAGO_WIDTH - 4, 9),
  farPoi: POIType.Stronghold,
  threat: { home: BALANCE.JADEVEIL_HOME_RADII, far: BALANCE.JADEVEIL_FAR_RADII },
  // One per threat band, which here are its islands' (`BALANCE.ISLE_BANDS`): reauthored with its fights
  levelOffsets: [0, 1, 2, 3, 4],
  zones: {
    corridorMin: BALANCE.CORRIDOR_MIN,
    corridorMax: BALANCE.CORRIDOR_MAX,
    roadBranches: 0,
    homeHauntedInner: BALANCE.HOME_HAUNTED_INNER,
    homeHauntedRadius: BALANCE.HOME_HAUNTED_RADIUS,
    homeHauntedMin: 0,
    farHauntedRadius: 0,
  },
  content: { frost: false, lairs: false, questSites: false, waysides: false, villages: false, gate: false, shrines: 0, wells: false, encounters: false },
};

export const WORLDS: Record<WorldId, WorldDef> = {
  empire: EMPIRE_WORLD,
  jadeveil: JADEVEIL_WORLD,
  archipelago: ARCHIPELAGO_WORLD,
};

export function worldDef(id: WorldId): WorldDef {
  return WORLDS[id];
}

/** How many threat bands every world names, gentlest first. */
export const THREAT_BAND_COUNT = 5;

/** A world's name ("The Empire" / "Cesarstwo"), from the `world` namespace. */
export const worldName = (id: WorldId): string => entryText('world', id, 'name');

/** Who holds a world's orb ("Kairen"): the boss whose first kill finishes the world and opens the next road. */
export const orbBossName = (id: WorldId): string => entryText('world', id, 'orbBoss');

/**
 * What the region readout calls a threat band in a world, gentlest first:
 * `world.<id>.threat.<band>`. A band outside the five is clamped into them.
 */
export function threatBandName(id: WorldId, band: number): string {
  const b = Math.max(0, Math.min(THREAT_BAND_COUNT - 1, Math.round(band)));
  return entryText('world', id, `threat.${b}`);
}

export function isWorldId(value: unknown): value is WorldId {
  return typeof value === 'string' && (WORLD_IDS as readonly string[]).includes(value);
}

/**
 * The seed a world's map is generated from, given the campaign's seed. The
 * Empire uses the campaign seed itself, so its map is the one every save
 * already had; every other world mixes in its index, so two worlds of one
 * campaign never share a noise field.
 */
export function worldSeed(campaignSeed: number, id: WorldId): number {
  const index = WORLD_IDS.indexOf(id);
  if (index <= 0) return campaignSeed;
  return (Math.imul(campaignSeed ^ (0x9e3779b9 * index), 2246822519) >>> 0) % 2147483647;
}
