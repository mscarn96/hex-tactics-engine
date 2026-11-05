import { BALANCE } from '@/data/balanceConstants';
import { EMPIRE_WORLD } from '@/data/worlds';
import { MapTile } from '@/models/types';
import { generateMap } from '@/systems/world/mapGenerator';
import { rollWeeklyFinds } from '@/systems/world/finds';
import { dealMerchants } from '@/systems/world/merchants';
import { catchUpWorld, rollDailyEncounters, type LiveWorld } from '@/systems/world/worldState';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { usePartyStore } from '@/stores/partyStore';
import { createRNG } from '@/utils/rng';
import { hexKey } from '@/utils/hexUtils';

/**
 * The world catch-up: what a new day and a new week re-roll on a world, from the
 * clock its state was current for to now. The one rule behind a step, a new map
 * and a return to a world left behind.
 */
const SEED = 4242;
const tiles = new Map(generateMap(SEED).map((t) => [hexKey(t.coord), t]));
const seeded = (seed = 7) => {
  const rng = createRNG(seed);
  return () => rng.next();
};
const roll = (rng = seeded()) => ({ partySummedLevel: 0, chanceMult: 1, rng });

const world = (): LiveWorld => ({
  tiles,
  mapSeed: SEED,
  homeCoord: EMPIRE_WORLD.home,
  finds: new Map(),
  activeEncounterTiles: new Set(['held']),
  usedMagicWells: new Set(['drunk']),
  merchants: [],
});

describe('catching a world up on the clock', () => {
  it('re-rolls nothing within the same day', () => {
    expect(catchUpWorld(world(), { day: 3, week: 1 }, { day: 3, week: 1 }, roll())).toEqual({});
  });

  it('re-rolls only the encounters at a new day', () => {
    const out = catchUpWorld(world(), { day: 3, week: 1 }, { day: 4, week: 1 }, roll());
    expect(Object.keys(out)).toEqual(['activeEncounterTiles']);
    expect(out.activeEncounterTiles?.has('held')).toBe(false);
  });

  it('deals finds and merchants, recharges the wells and rolls the encounters at a new week', () => {
    const out = catchUpWorld(world(), { day: 7, week: 1 }, { day: 8, week: 2 }, roll());
    expect(out.finds).toEqual(rollWeeklyFinds(tiles.values(), SEED, 2, EMPIRE_WORLD.home));
    expect(out.merchants).toEqual(dealMerchants(SEED, 2, tiles));
    expect(out.usedMagicWells?.size).toBe(0);
    expect(out.activeEncounterTiles).toBeDefined();
  });

  it('owes a world with no state everything', () => {
    const out = catchUpWorld(world(), null, { day: 1, week: 1 }, roll());
    expect(Object.keys(out).sort()).toEqual(['activeEncounterTiles', 'finds', 'merchants', 'usedMagicWells']);
  });

  it('keeps this week\'s encounters off this week\'s finds', () => {
    const out = catchUpWorld(world(), null, { day: 1, week: 1 }, { ...roll(), rng: () => 0 });
    expect(out.finds!.size).toBeGreaterThan(0);
    for (const key of out.finds!.keys()) expect(out.activeEncounterTiles!.has(key)).toBe(false);
  });

  it('deals merchants only onto the roads the tiles it is given have seen', () => {
    const unseen = new Map([...tiles].map(([k, t]): [string, MapTile] => [k, { ...t, explored: false }]));
    const out = catchUpWorld({ ...world(), tiles: unseen }, null, { day: 1, week: 1 }, roll());
    expect(out.merchants).toEqual([]);
  });
});

describe('the daily encounter roll', () => {
  it('is the same roll from the same seed', () => {
    expect(rollDailyEncounters(tiles, new Map(), roll(seeded(3))))
      .toEqual(rollDailyEncounters(tiles, new Map(), roll(seeded(3))));
  });

  it('never lights a destination or ground with no content', () => {
    const live = rollDailyEncounters(tiles, new Map(), { ...roll(), rng: () => 0 });
    for (const key of live) {
      const tile = tiles.get(key)!;
      expect(tile.poi).toBeUndefined();
      expect(BALANCE.ZONE_ENCOUNTER_RATE[tile.zone]).toBeGreaterThan(0);
    }
  });

  it('lights fewer tiles under a ward', () => {
    const open = rollDailyEncounters(tiles, new Map(), roll(seeded(5)));
    const warded = rollDailyEncounters(tiles, new Map(), { ...roll(seeded(5)), chanceMult: BALANCE.WARD_ENCOUNTER_MULT });
    expect(warded.size).toBeLessThan(open.size);
  });
});

describe('every way the clock reaches a world takes the same rule', () => {
  beforeEach(() => {
    useWorldMapStore.getState().reset();
    usePartyStore.setState({ heroes: [] });
  });

  it('a new map, a step into a new week and a return across one all deal what the catch-up deals', () => {
    const store = useWorldMapStore.getState();
    store.setTiles(generateMap(SEED), SEED);
    const fresh = useWorldMapStore.getState();
    expect(fresh.finds).toEqual(rollWeeklyFinds(fresh.tiles.values(), SEED, 1, EMPIRE_WORLD.home));
    expect(fresh.merchants).toEqual(dealMerchants(SEED, 1, fresh.tiles));

    // A step that crosses into week 2
    const hours = BALANCE.HOURS_PER_DAY * BALANCE.DAYS_PER_WEEK;
    store.moveParty(fresh.partyPosition, hours);
    const stepped = useWorldMapStore.getState();
    expect(useCalendarStore.getState().weekNumber).toBe(2);
    expect(stepped.finds).toEqual(rollWeeklyFinds(stepped.tiles.values(), SEED, 2, EMPIRE_WORLD.home));
    expect(stepped.merchants).toEqual(dealMerchants(SEED, 2, stepped.tiles));
    expect(stepped.usedMagicWells.size).toBe(0);

    // Away to Jadeveil, a week passes there, and back: the Empire is dealt week 3 on return
    store.switchWorld('jadeveil', 99, (t) => t.values().next().value!.coord);
    useCalendarStore.getState().advance(hours);
    store.switchWorld('empire', SEED, () => stepped.partyPosition);
    const back = useWorldMapStore.getState();
    expect(useCalendarStore.getState().weekNumber).toBe(3);
    expect(back.finds).toEqual(rollWeeklyFinds(back.tiles.values(), SEED, 3, EMPIRE_WORLD.home));
    expect(back.merchants).toEqual(dealMerchants(SEED, 3, back.tiles));
  });
});
