import { HexCoord, MapFind, MapTile } from '@/models/types';
import { hexKey } from '@/utils/hexUtils';
import { generateMap } from '@/systems/world/mapGenerator';
import { worldDef, type WorldId } from '@/data/worlds';
import { dealMerchants, validMerchant, type Merchant } from '@/systems/world/merchants';
import { rollWeeklyFinds } from '@/systems/world/finds';
import { encounterTimidity } from '@/systems/world/encounterTimidity';
import { ThreatBand } from '@/systems/world/threat';
import { BALANCE } from '@/data/balanceConstants';

/**
 * One world's state, as it is saved and as it waits while the party is away.
 *
 * **Tiles are not stored.** `generateMap` is deterministic and almost nothing
 * on a `MapTile` is the player's: only `explored` and `defeated` move. So a
 * world is its seed plus those two key sets, and loading regenerates the map
 * and lays them back on — derived, never stored, the rule lairs and the market
 * already follow. The cost is that a save is coupled to generator stability: a
 * generator change is a `SAVE_VERSION` bump.
 *
 * The rest is what the world map's store holds per world: where the party
 * stood, today's live encounters, this week's spent wells and unclaimed finds.
 * `day` and `week` say which day and week those were current for, so a world
 * left behind catches up with the one shared clock on return
 * (`catchUpWorld`). The party, inventory, city, quests, spent lair triggers
 * and the clock itself are global and never live here.
 */
export interface WorldSnapshot {
  seed: number;
  /** Every explored hex, generation's own reveals included. */
  explored: string[];
  /** Every hex whose quest site has been beaten. */
  defeated: string[];
  partyPosition: HexCoord;
  activeEncounterTiles: string[];
  usedMagicWells: string[];
  finds: MapFind[];
  /** The week's travelling merchants as dealt (`merchants.ts`); their walks are derived from the clock. */
  merchants: Merchant[];
  day: number;
  week: number;
}

/** The player's marks on a map: the only tile fields generation does not decide. */
export function tileMutations(tiles: Iterable<MapTile>): { explored: string[]; defeated: string[] } {
  const explored: string[] = [];
  const defeated: string[] = [];
  for (const tile of tiles) {
    const key = hexKey(tile.coord);
    if (tile.explored) explored.push(key);
    if (tile.defeated) defeated.push(key);
  }
  return { explored, defeated };
}

/** Regenerate a world's map from its seed and lay the player's marks back on. */
export function restoreTiles(
  id: WorldId,
  seed: number,
  explored: Iterable<string>,
  defeated: Iterable<string>,
): MapTile[] {
  const tiles = generateMap(seed, worldDef(id));
  const seen = new Set(explored);
  const beaten = new Set(defeated);
  for (const tile of tiles) {
    const key = hexKey(tile.coord);
    tile.explored = seen.has(key);
    if (beaten.has(key)) tile.defeated = true;
  }
  return tiles;
}

/** Which day and week a world's state was current for, or the shared clock's now. */
export interface WorldClock {
  day: number;
  week: number;
}

/** The part of the current world that the clock re-rolls, as the world map's store holds it. */
export interface LiveWorld {
  /** Which world this is; the Empire's rules when absent. */
  worldId?: WorldId;
  tiles: ReadonlyMap<string, MapTile>;
  mapSeed: number;
  /** The world's home anchor; the city's hex when absent (the Empire). */
  homeCoord?: HexCoord | null;
  finds: ReadonlyMap<string, MapFind>;
  activeEncounterTiles: ReadonlySet<string>;
  usedMagicWells: ReadonlySet<string>;
  merchants: Merchant[];
}

/** What the clock re-rolled: only the fields that changed, so the rest keep their identity. */
export type WorldCatchUp = Partial<{
  finds: Map<string, MapFind>;
  activeEncounterTiles: Set<string>;
  usedMagicWells: Set<string>;
  merchants: Merchant[];
}>;

/** What the encounter roll needs from outside the world: who is walking, and what a ward leaves of it. */
export interface EncounterRollContext {
  /** The party's summed level, 0 when there is no party yet (`encounterTimidity` leaves the roll alone). */
  partySummedLevel: number;
  /** The world being rolled, whose ground the party is measured against. The Empire when absent. */
  world?: WorldId;
  /** What a burning ward leaves of the roll (`BALANCE.WARD_ENCOUNTER_MULT`), else 1. */
  chanceMult: number;
  /** Defaults to `Math.random`; the encounter roll is the one world roll not dealt from the map seed. */
  rng?: () => number;
}

/**
 * Roll which danger tiles have an active encounter for the coming day.
 *
 * **Daily, not weekly.** A week is 168 tiles of walking, which meant a danger
 * tile the party had beaten stayed empty for most of a campaign week and the
 * live ones stayed live for just as long — so the map's fights were a fixed
 * layout the player learned once and then routed around. A day is 24 tiles: long
 * enough that clearing ground still means something for the rest of the
 * afternoon, short enough that the same road is not the same road forever.
 */
export function rollDailyEncounters(
  tiles: ReadonlyMap<string, MapTile>,
  finds: ReadonlyMap<string, MapFind>,
  { partySummedLevel, world = 'empire', chanceMult, rng = Math.random }: EncounterRollContext,
): Set<string> {
  const set = new Set<string>();
  for (const [key, tile] of tiles) {
    /**
     * Two numbers, and they answer different questions.
     *
     * `ZONE_ENCOUNTER_RATE` is *how much content this ground holds* — 60% of
     * haunted tiles, 10% of corridor, none of the road. It is a property of the
     * map and it never changes. `DAILY_ENCOUNTER_CHANCE` is *how much of it is
     * up today*, and it re-rolls every dawn.
     *
     * Rolled together here rather than baked into the tile at generation,
     * because which tiles hold content is meant to be stable and which are live
     * is meant to move — and a tile that was permanently marked would let a
     * player learn the map once and route around it forever.
     */
    /**
     * A destination is not a fight, and this line is load-bearing now.
     *
     * The old danger pass skipped POI tiles, so the two could never collide. But
     * every lair door, ore vein, well and quest site is deliberately placed in
     * **haunted** ground now — that is the whole trade the zones exist to make —
     * and haunted ground is 60% encounters. Without this, walking up to a lair
     * would roll a wandering warband instead of opening the door, six times in
     * ten, and the door would look broken.
     */
    if (tile.poi) continue;
    // Nor is a find. A fight on a chest's hex would be cleared with the party
    // standing on a prize it could only claim by stepping off and back on.
    if (finds.has(key)) continue;

    /**
     * And a third, which asks who is walking here.
     *
     * The two above are properties of the map and of the dawn; neither can
     * notice that the party has outgrown the ground. `encounterTimidity` is the
     * rule — see `systems/world/encounterTimidity.ts` — and it is exactly `1`
     * for a party at or under what its band expects, so the opening hours are
     * numerically unchanged by it. Beyond the Empire the ground expects its own fixed level.
     */
    const rate = BALANCE.ZONE_ENCOUNTER_RATE[tile.zone];
    if (rate <= 0) continue;

    const timidity = encounterTimidity((tile.threat ?? 0) as ThreatBand, partySummedLevel, world);
    if (rng() < rate * BALANCE.DAILY_ENCOUNTER_CHANCE * timidity * chanceMult) {
      set.add(key);
    }
  }
  return set;
}

/**
 * Catch a world up on the clock: what a new day and a new week re-roll, from the
 * day and week its state was current for (`seen`) to `now`. A `null` `seen` is a
 * world with no state yet, and everything is due.
 *
 * **Two clocks, deliberately.** Encounters re-roll **daily**: they are the game's
 * content, and content that refreshes once a week is a map the player memorises.
 * Wells, finds and merchants stay **weekly**: those are the economy, and a magic
 * well that recharges every 24 tiles walked is a free full heal on demand, which
 * removes the attrition that makes a long expedition a decision.
 *
 * The one rule for every way the clock reaches a world: a step, a new map, a
 * return after time away. Pass the tiles *after* the party's reveal, so that
 * merchants are dealt onto the roads seen by now. What is not a world's (the
 * dawn heal, the clock itself) stays with the caller.
 */
export function catchUpWorld(
  world: LiveWorld,
  seen: WorldClock | null,
  now: WorldClock,
  roll: EncounterRollContext,
): WorldCatchUp {
  const weekDue = !seen || seen.week !== now.week;
  const dayDue = !seen || seen.day !== now.day;
  const out: WorldCatchUp = {};
  if (weekDue) {
    out.finds = rollWeeklyFinds(world.tiles.values(), world.mapSeed, now.week, world.homeCoord ?? undefined);
    out.usedMagicWells = new Set();
    out.merchants = dealMerchants(world.mapSeed, now.week, world.tiles);
  }
  // Finds first: the encounter roll keeps clear of them. A world with no
  // factions yet (`WorldDef.content.encounters`) has nothing to roll.
  const fights = !world.worldId || worldDef(world.worldId).content.encounters;
  if (dayDue) out.activeEncounterTiles = fights ? rollDailyEncounters(world.tiles, out.finds ?? world.finds, roll) : new Set();
  return out;
}

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');

const isCoord = (value: unknown): value is HexCoord =>
  !!value && Number.isInteger((value as HexCoord).q) && Number.isInteger((value as HexCoord).r);

/** Whether a parsed value is a world snapshot this build can restore. */
export function isWorldSnapshot(value: unknown): value is WorldSnapshot {
  const w = value as WorldSnapshot | undefined;
  return !!w
    && Number.isInteger(w.seed)
    && isStringList(w.explored)
    && isStringList(w.defeated)
    && isCoord(w.partyPosition)
    && isStringList(w.activeEncounterTiles)
    && isStringList(w.usedMagicWells)
    && Array.isArray(w.finds) && w.finds.every((f) => isCoord(f?.coord))
    && Array.isArray(w.merchants) && w.merchants.every(validMerchant)
    && Number.isInteger(w.day) && w.day >= 0
    && Number.isInteger(w.week) && w.week >= 0;
}
