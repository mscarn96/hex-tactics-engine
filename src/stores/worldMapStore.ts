import { useCityStore } from '@/stores/cityStore';
import { reportAchievement } from '@/utils/achievementBus';
import { mealDawnHeal, mealTier } from '@/systems/economy/expeditionMeals';
import { createStore as create } from 'zustand/vanilla';
import { MapTile, MapFind, HexCoord, POIType } from '@/models/types';
import { hexKey, getHexesInRange } from '@/utils/hexUtils';
import { usePartyStore } from '@/stores/partyStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { useVillageStore } from '@/stores/villageStore';
import { useAscentStore } from '@/stores/ascentStore';
import { dawnHealBonus } from '@/systems/world/monastery';
import { heroMaxHp } from '@/systems/progression/statCalc';
import { cityExit, quietAfterVictory } from '@/systems/world/travel';
import { BALANCE } from '@/data/balanceConstants';
import { type Merchant } from '@/systems/world/merchants';
import {
  catchUpWorld,
  restoreTiles,
  tileMutations,
  type EncounterRollContext,
  type WorldClock,
  type WorldSnapshot,
} from '@/systems/world/worldState';
import { generateMap } from '@/systems/world/mapGenerator';
import { recordSnapshot } from '@/systems/world/tileSnapshots';
import { worldDef, type WorldId } from '@/data/worlds';

/** What a ward burning until `wardUntil` leaves of today's roll: its share while lit, else 1. */
function wardMult(wardUntil: number): number {
  return useCalendarStore.getState().totalHours < wardUntil ? BALANCE.WARD_ENCOUNTER_MULT : 1;
}

/**
 * The party's summed level, or 0 when there is no party yet.
 *
 * `setTiles` pre-rolls day one during map generation, which happens before the
 * starting hero is chosen — so this is genuinely empty on the first call of
 * every new save, and `encounterTimidity` takes 0 to mean "leave the roll
 * alone". Read once per roll and handed in, because a store reading a store
 * per tile is a lookup 4,900 times a day for one number.
 */
function partySummedLevel(): number {
  return usePartyStore.getState().heroes.reduce((sum, h) => sum + h.level, 0);
}

/** The encounter roll's view of the party and the ward, as of now. */
function encounterRoll(wardUntil: number, world: WorldId): EncounterRollContext {
  return { partySummedLevel: partySummedLevel(), world, chanceMult: wardMult(wardUntil) };
}

/** The shared clock's day and week. */
function clockNow(): WorldClock {
  const { dayNumber, weekNumber } = useCalendarStore.getState();
  return { day: dayNumber, week: weekNumber };
}

/**
 * What never moves on a generated map, indexed once.
 *
 * POI positions are fixed at generation: exploring, defeating and recharging
 * all spread the tile (`{ ...tile }`) without touching `coord` or `poi`. The
 * subscribers that used to learn this the hard way scanned all 4,900 tiles per
 * store write — `getCityCoord` on every write, the well/wayside/quest-target
 * memos on every reveal — which is a measurable share of the frame drop while
 * marching. Derived here, in one pass, when the map itself is replaced.
 *
 * Exported for `persistence.loadGame`, which writes `tiles` with `setState`
 * rather than through `setTiles` and must derive the same index.
 */
export function tileIndexFor(tiles: Map<string, MapTile>): {
  cityCoord: HexCoord | null;
  castleCoord: HexCoord | null;
  poiCoords: HexCoord[];
} {
  let cityCoord: HexCoord | null = null;
  let castleCoord: HexCoord | null = null;
  const poiCoords: HexCoord[] = [];
  for (const tile of tiles.values()) {
    if (!tile.poi) continue;
    poiCoords.push(tile.coord);
    if (tile.poi === POIType.City) cityCoord = tile.coord;
    if (tile.poi === POIType.EmpireCastle) castleCoord = tile.coord;
  }
  return { cityCoord, castleCoord, poiCoords };
}

/**
 * The tiles Map with everything within `radius` of `coord` explored, or `null`
 * when nothing new was revealed — so a march across known ground costs no Map
 * clone and no downstream rebuild at all.
 */
function revealedTiles(
  tiles: Map<string, MapTile>,
  coord: HexCoord,
  radius: number,
): Map<string, MapTile> | null {
  let next: Map<string, MapTile> | null = null;
  const revealed: MapTile[] = [];
  for (const hex of getHexesInRange(coord, radius)) {
    const key = hexKey(hex);
    const tile = (next ?? tiles).get(key);
    if (tile && !tile.explored) {
      next ??= new Map(tiles);
      const explored = { ...tile, explored: true };
      next.set(key, explored);
      revealed.push(explored);
    }
  }
  if (next) {
    EXPLORED_COUNTS.set(next, exploredCount(tiles) + revealed.length);
    // The render caches carry forward round the hexes this changed (`tileSnapshots.ts`).
    recordSnapshot(tiles, next, revealed);
  }
  return next;
}

/**
 * How many tiles a snapshot has explored, for the explore achievement. Carried
 * from snapshot to snapshot by `revealedTiles`, so a revealing step adds the
 * hexes it revealed instead of filtering all 4,900 tiles again (PT-28); any
 * other snapshot is counted once.
 */
const EXPLORED_COUNTS = new WeakMap<ReadonlyMap<string, MapTile>, number>();
function exploredCount(tiles: ReadonlyMap<string, MapTile>): number {
  let count = EXPLORED_COUNTS.get(tiles);
  if (count === undefined) {
    count = 0;
    for (const tile of tiles.values()) if (tile.explored) count++;
    EXPLORED_COUNTS.set(tiles, count);
  }
  return count;
}

/** Index a tile list by hex key. */
function tileMapOf(tiles: Iterable<MapTile>): Map<string, MapTile> {
  const map = new Map<string, MapTile>();
  for (const tile of tiles) map.set(hexKey(tile.coord), tile);
  return map;
}

/** A freshly generated world in place, before the clock has dealt it anything (`catchUpWorld` from `null`). */
function placedWorld(map: Map<string, MapTile>, seed: number, worldId: WorldId) {
  return {
    worldId,
    tiles: map,
    mapSeed: seed,
    homeCoord: worldDef(worldId).home,
    finds: new Map<string, MapFind>(),
    activeEncounterTiles: new Set<string>(),
    usedMagicWells: new Set<string>(),
    merchants: [],
    ...tileIndexFor(map),
  };
}

interface WorldMapState {
  /**
   * Which world the party stands in. Everything below is **that world's**;
   * the others wait compactly in `dormant` until the party crosses back.
   */
  worldId: WorldId;
  /**
   * The worlds the party is not in, as they were left (`WorldSnapshot`). A
   * world the party has never entered has no entry and is generated fresh.
   */
  dormant: Partial<Record<WorldId, WorldSnapshot>>;
  tiles: Map<string, MapTile>;
  partyPosition: HexCoord;
  revealRadius: number;

  // ── Derived per map, never per step — see `tileIndexFor` ────────────────────
  /** The city's hex, `null` before a map exists and in every world without one. */
  cityCoord: HexCoord | null;
  /**
   * The current world's home anchor — the city in the Empire, the arrival camp
   * elsewhere — `null` before a map exists. Where a defeat carries the party.
   */
  homeCoord: HexCoord | null;
  /** The Obsidian castle's hex — the one prop the render layer never culls. */
  castleCoord: HexCoord | null;
  /** Every tile carrying a `poi`, in map order. Positions are generation-fixed. */
  poiCoords: HexCoord[];
  /**
   * This week's travelling merchants (`systems/world/merchants.ts`): where each was dealt and when.
   * Their positions are worked out from the clock, so only the deal is stored. Dealt again at every
   * new week, and for a world the party returns to after one has turned.
   */
  merchants: Merchant[];

  // ── Daily encounter pre-roll ─────────────────────────────────────────────────
  /**
   * Set of hex keys whose danger tiles have a live encounter today.
   * Re-rolled every new day; cleared per-tile when the encounter is beaten.
   *
   * The clock that drives it lives on `calendarStore`, which this store no
   * longer owns — see the note there for the require cycles that split them.
   */
  activeEncounterTiles: Set<string>;
  /**
   * The campaign hour a lit warding incense burns until (`calendarStore.totalHours`),
   * 0 when none was lit. While the clock is short of it, each day's roll is
   * multiplied by `BALANCE.WARD_ENCOUNTER_MULT`.
   */
  wardUntil: number;
  /**
   * Light a ward until `until`: today's live encounters are thinned by the same
   * share at once, and every day's roll until then. A later ward replaces an
   * earlier one's end rather than adding to it.
   */
  lightWard: (until: number) => void;

  // ── Exploration finds ─────────────────────────────────────────────────────────
  /** The map seed the finds are dealt from — see `systems/world/finds.ts`. */
  mapSeed: number;
  /**
   * What lies on the map this week, by hex key. Dealt again at every week
   * rollover, so whatever was not collected is gone; claiming one deletes it.
   */
  finds: Map<string, MapFind>;

  // ── Magic wells ───────────────────────────────────────────────────────────────
  /**
   * Hex keys of magic wells already used this week.
   * Cleared at the start of each new week so wells recharge.
   */
  usedMagicWells: Set<string>;

  // ── Arrival ───────────────────────────────────────────────────────────────────
  /**
   * The world a crossing has just reached, until the world map says so once
   * ("You reach the Empire"). A crossing is made from the map's own gate or
   * from inside the foothill camp, whose scene is gone by the time the map
   * mounts, so the word waits here for the map rather than in either scene.
   * Never saved: a reload has nothing to announce.
   */
  arrivalNotice: WorldId | null;
  /** A crossing reached `world`: the map announces it the next time it is on screen. */
  noteArrival: (world: WorldId) => void;
  /** The arrival waiting to be announced, taken so it is announced once; `null` when none waits. */
  takeArrivalNotice: () => WorldId | null;

  // ── Actions ──────────────────────────────────────────────────────────────────
  /**
   * `seed` is the map's own — the finds of every week are dealt from it — and
   * `worldId` the world it was generated for (the Empire by default).
   */
  setTiles: (tiles: MapTile[], seed?: number, worldId?: WorldId) => void;
  /** The current world as it would be saved or left behind. */
  snapshotWorld: () => WorldSnapshot;
  /**
   * Make `id` the current world from its snapshot, exactly as it was saved —
   * no catch-up. `loadGame`'s path; `dormant` is the save's other worlds.
   */
  restoreWorld: (id: WorldId, snapshot: WorldSnapshot, dormant: Partial<Record<WorldId, WorldSnapshot>>) => void;
  /**
   * Leave the current world for `id`: the one left is put by as a snapshot,
   * and `id` comes back from its own (catching up on the days and weeks it
   * missed) or is generated fresh from `seed` on a first visit. The party is
   * placed on that world's `arrival` hex; the clock does not move here.
   */
  switchWorld: (id: WorldId, seed: number, arrival: (tiles: Map<string, MapTile>) => HexCoord) => void;
  getTile: (coord: HexCoord) => MapTile | undefined;
  getCityCoord: () => HexCoord | null;
  /**
   * Move the party to `coord`, advancing time by `steps` hours (default 1).
   * Triggers the dawn heal and re-rolls encounters when a new day begins, and
   * recharges wells and deals a new week's finds when a new week does.
   */
  moveParty: (coord: HexCoord, steps?: number) => void;
  revealAround: (coord: HexCoord) => void;
  /** Reveal everything within `radius` of `coord`: a map scroll read where the party stands. */
  revealWithin: (coord: HexCoord, radius: number) => void;
  /**
   * Put a party standing on the city tile onto its doorstep — see `cityExit`.
   * No clock: walking out of the gate is not a step of travel. A no-op
   * anywhere but on the city.
   */
  stepOutOfCity: () => void;
  markDefeated: (coord: HexCoord) => void;
  /**
   * Free the village at `coord`: it stays free for the rest of the run. Returns
   * whether it changed — `false` for a tile that is no village or is free
   * already. The mark is `defeated`, which every world snapshot carries.
   */
  freeVillage: (coord: HexCoord) => boolean;
  /** Take the find at `coord` off the map and return it, or `undefined` if none lies there. */
  claimFind: (coord: HexCoord) => MapFind | undefined;
  /** Take exactly one hex's warband off today's roll: the party slipped away from it. Nothing else near it goes. */
  removeActiveEncounter: (coord: HexCoord) => void;
  /** Remove a danger tile from today's encounter pool (called after winning). */
  clearActiveEncounter: (coord: HexCoord) => void;
  /**
   * Use the magic well at `coord`. Heals/revives all heroes, marks the well
   * as used for the rest of the week. No-op if already used this week.
   */
  /** Named `drink…`, not `use…`: a `use`-prefixed action reads as a React hook. */
  drinkMagicWell: (coord: HexCoord) => void;
  reset: () => void;
}

export const useWorldMapStore = create<WorldMapState>((set, get) => ({
  worldId: 'empire',
  dormant: {},
  homeCoord: null,
  tiles: new Map(),
  partyPosition: { q: 0, r: 0 },
  revealRadius: 3,
  cityCoord: null,
  castleCoord: null,
  poiCoords: [],
  merchants: [],
  activeEncounterTiles: new Set(),
  wardUntil: 0,
  mapSeed: 0,
  finds: new Map(),
  usedMagicWells: new Set(),
  arrivalNotice: null,

  noteArrival: (world) => set({ arrivalNotice: world }),

  takeArrivalNotice: () => {
    const world = get().arrivalNotice;
    if (world) set({ arrivalNotice: null });
    return world;
  },

  lightWard: (until) => {
    const thinned = new Set([...get().activeEncounterTiles].filter(() => Math.random() < BALANCE.WARD_ENCOUNTER_MULT));
    set({ wardUntil: Math.max(get().wardUntil, until), activeEncounterTiles: thinned });
  },

  setTiles: (tiles, seed = 0, worldId = 'empire') => {
    const placed = placedWorld(tileMapOf(tiles), seed, worldId);
    // A new map is owed everything: this week's finds, wells and merchants, and today's encounters
    set({ ...placed, ...catchUpWorld(placed, null, clockNow(), encounterRoll(get().wardUntil, placed.worldId)) });
  },

  snapshotWorld: () => {
    const state = get();
    const clock = useCalendarStore.getState();
    return {
      seed: state.mapSeed,
      ...tileMutations(state.tiles.values()),
      partyPosition: { ...state.partyPosition },
      activeEncounterTiles: [...state.activeEncounterTiles],
      usedMagicWells: [...state.usedMagicWells],
      finds: [...state.finds.values()],
      merchants: state.merchants,
      day: clock.dayNumber,
      week: clock.weekNumber,
    };
  },

  restoreWorld: (id, snapshot, dormant) => {
    const map = tileMapOf(restoreTiles(id, snapshot.seed, snapshot.explored, snapshot.defeated));
    const others = { ...dormant };
    delete others[id];
    set({
      worldId: id,
      dormant: others,
      tiles: map,
      partyPosition: snapshot.partyPosition,
      activeEncounterTiles: new Set(snapshot.activeEncounterTiles),
      usedMagicWells: new Set(snapshot.usedMagicWells),
      mapSeed: snapshot.seed,
      finds: new Map(snapshot.finds.map((f) => [hexKey(f.coord), f])),
      merchants: snapshot.merchants,
      homeCoord: worldDef(id).home,
      ...tileIndexFor(map),
    });
  },

  switchWorld: (id, seed, arrival) => {
    const state = get();
    if (id === state.worldId) return;
    const waiting = state.dormant[id];
    const dormant = { ...state.dormant, [state.worldId]: state.snapshotWorld() };
    if (waiting) get().restoreWorld(id, waiting, dormant);
    else set({ dormant, ...placedWorld(tileMapOf(generateMap(seed, worldDef(id))), seed, id) });
    const now = get();
    const at = arrival(now.tiles);
    const tiles = revealedTiles(now.tiles, at, now.revealRadius) ?? now.tiles;
    /**
     * One clock: the world catches up on what it missed while the party was
     * away, or on everything when this is its first visit. The arrival's
     * reveal comes first, so a new week's merchants can be dealt onto it.
     */
    const seen = waiting ? { day: waiting.day, week: waiting.week } : null;
    set({
      partyPosition: at,
      tiles,
      ...catchUpWorld({ ...now, tiles }, seen, clockNow(), encounterRoll(now.wardUntil, now.worldId)),
    });
  },

  getTile: (coord) => get().tiles.get(hexKey(coord)),

  // O(1) now — the coordinate is fixed at generation and indexed by `setTiles`.
  // This runs inside a subscribed selector on every store write, so the scan it
  // replaces was 4,900 Map iterations per write for a constant.
  getCityCoord: () => get().cityCoord,

  moveParty: (coord, steps = 1) => {
    const state = get();
    const seen = clockNow();
    const { dayChanged } = useCalendarStore.getState().advance(steps);

    // Dawn heal — once per day transition regardless of how many days passed
    // (and, in Jadeveil, whatever the monastery's vows add to it)
    if (dayChanged) {
      const vigil = state.worldId === 'jadeveil' ? dawnHealBonus(useAscentStore.getState().vows) : 0;
      usePartyStore.getState().healAll(mealDawnHeal(mealTier(useCityStore.getState().meal, useCalendarStore.getState().weekNumber)) + vigil);
    }

    // One write per step, reveal and rollover included. This used to be two `set()` calls —
    // the move and then `revealAround` — which ran every subscribed selector
    // twice per hex walked for one batched render's worth of information.
    // The rollover (`catchUpWorld`) is dealt after the reveal, onto the roads seen by now.
    const tiles = state.tiles;
    const nextTiles = revealedTiles(tiles, coord, state.revealRadius) ?? tiles;
    set({
      partyPosition: coord,
      tiles: nextTiles,
      ...catchUpWorld({ ...state, tiles: nextTiles }, seen, clockNow(), encounterRoll(state.wardUntil, state.worldId)),
    });
    if (get().tiles !== tiles) {
      reportAchievement({ kind: 'explore', tiles: exploredCount(get().tiles) });
    }
  },

  stepOutOfCity: () => {
    const { tiles, homeCoord, partyPosition, activeEncounterTiles, revealRadius } = get();
    if (!homeCoord || hexKey(partyPosition) !== hexKey(homeCoord)) return;
    const exit = cityExit(tiles, homeCoord, activeEncounterTiles);
    if (!exit) return;
    set({ partyPosition: exit, tiles: revealedTiles(tiles, exit, revealRadius) ?? tiles });
  },

  revealAround: (coord) => {
    const { tiles, revealRadius } = get();
    const next = revealedTiles(tiles, coord, revealRadius);
    if (next) {
      set({ tiles: next });
      reportAchievement({ kind: 'explore', tiles: exploredCount(next) });
    }
  },

  revealWithin: (coord, radius) => {
    const { tiles } = get();
    const next = revealedTiles(tiles, coord, radius);
    if (next) {
      set({ tiles: next });
      reportAchievement({ kind: 'explore', tiles: exploredCount(next) });
    }
  },

  markDefeated: (coord) => {
    const { tiles } = get();
    const key = hexKey(coord);
    const tile = tiles.get(key);
    if (tile) {
      const newTiles = new Map(tiles);
      const defeated = { ...tile, defeated: true };
      newTiles.set(key, defeated);
      recordSnapshot(tiles, newTiles, [defeated]);
      set({ tiles: newTiles });
    }
  },

  freeVillage: (coord) => {
    const tile = get().tiles.get(hexKey(coord));
    if (tile?.poi !== POIType.Village || tile.defeated) return false;
    get().markDefeated(coord);
    return true;
  },

  claimFind: (coord) => {
    const { finds } = get();
    const key = hexKey(coord);
    const find = finds.get(key);
    if (!find) return undefined;
    const next = new Map(finds);
    next.delete(key);
    set({ finds: next });
    return find;
  },

  /**
   * Spends the encounter just cleared, **and the ones standing next to it**.
   *
   * It used to delete the one key. That is correct arithmetic and it made deep
   * haunted country impassable: at the old rates a third of haunted tiles were
   * live on any given day, `planTravel` stops the party on the first one it
   * meets, and a thirty-tile march came out as roughly ten consecutive fights
   * with no way to finish the journey. A playtest reported it as simply not
   * being able to move out there.
   *
   * The rate cut is half the answer and this is the other half, because the
   * complaint is about *consecutive* interruptions rather than about the map
   * being too full overall — thinning the world enough to fix it by density
   * alone would have starved the opening hours, which is the failure
   * `encounterSupply.test.ts` exists to prevent. A warband that has just been
   * wiped leaves a gap.
   *
   * The rule is `quietAfterVictory` in `systems/world/travel.ts`, pure and
   * measured there; this is the one call site. It **replaces** the single delete
   * rather than sitting beside it — the radius includes the coordinate itself.
   */
  removeActiveEncounter: (coord) => {
    const { activeEncounterTiles } = get();
    const key = hexKey(coord);
    if (!activeEncounterTiles.has(key)) return;
    const next = new Set(activeEncounterTiles);
    next.delete(key);
    set({ activeEncounterTiles: next });
  },

  clearActiveEncounter: (coord) => {
    const { activeEncounterTiles } = get();
    const next = quietAfterVictory(coord, activeEncounterTiles);
    // Identity when nothing was in reach, so a fight on ground with no live
    // neighbours costs no store write and no re-render of the grid subtree.
    if (next !== activeEncounterTiles) set({ activeEncounterTiles: next });
  },

  drinkMagicWell: (coord) => {
    const { usedMagicWells } = get();
    const key = hexKey(coord);
    if (usedMagicWells.has(key)) return; // already used this week

    // Heal / revive every hero in the party
    const { heroes, setHp } = usePartyStore.getState();
    for (const hero of heroes) {
      // The bar the hero is standing at, gear and tree included — a well that
      // healed half of `baseStats` would mend less the better equipped they are
      const max = heroMaxHp(hero);
      if (hero.currentHp <= 0) {
        setHp(hero.id, Math.ceil(max * BALANCE.MAGIC_WELL_REVIVE_FRACTION));
      } else {
        // Add 50% maxHp; if they already had > 50% this naturally brings them to full
        setHp(hero.id, Math.min(max, hero.currentHp + Math.ceil(max * BALANCE.MAGIC_WELL_HEAL_FRACTION)));
      }
    }

    const next = new Set(usedMagicWells);
    next.add(key);
    set({ usedMagicWells: next });
    reportAchievement({ kind: 'well' });
  },

  reset: () => {
    // The clock is its own store now, so resetting the map has to say so — a
    // new campaign on a stale calendar would open in whatever week the last one
    // ended, with the tribute already overdue.
    useCalendarStore.getState().reset();
    // The held village buff goes with the campaign it was bought in
    useVillageStore.getState().reset();
    set({
      worldId: 'empire',
      dormant: {},
      homeCoord: null,
      tiles: new Map(),
      partyPosition: { q: 0, r: 0 },
      cityCoord: null,
      castleCoord: null,
      poiCoords: [],
      merchants: [],
      activeEncounterTiles: new Set(),
      wardUntil: 0,
      mapSeed: 0,
      finds: new Map(),
      usedMagicWells: new Set(),
      arrivalNotice: null,
    });
  },
}));
