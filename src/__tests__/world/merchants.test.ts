import { BALANCE } from '@/data/balanceConstants';
import { MERCHANT_KINDS } from '@/data/merchants';
import { MapTile, POIType, TileType } from '@/models/types';
import { generateMap } from '@/systems/world/mapGenerator';
import { EMPIRE_WORLD } from '@/data/worlds';
import {
  dealMerchants, meetAlongRoute, merchantAt, merchantOn, merchantPresent, merchantSteps, merchantTargets, merchantsAt,
  validMerchant, visibleMerchants, weekStartHour, type Merchant,
} from '@/systems/world/merchants';
import { merchantBuyPrice, merchantStock, PROVISIONER_GOODS, provisionerPrice } from '@/systems/economy/merchantStock';
import { Rarity } from '@/models/types';
import { hexDistance, hexKey, type HexCoord } from '@/utils/hexUtils';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { isWorldSnapshot } from '@/systems/world/worldState';
import { at } from '../support/fixtures';

/**
 * Travelling merchants: the deal, the walk and the stock. Every number is a first
 * guess in `BALANCE.MERCHANT` to verify in playtest; these pin the rules.
 */
const M = BALANCE.MERCHANT;
const SEED = 4242;

const road = (q: number, r: number, over: Partial<MapTile> = {}): MapTile =>
  ({ coord: at(q, r), type: TileType.Plains, zone: 'road', explored: true, ...over });
const mapOf = (tiles: MapTile[]) => new Map(tiles.map((t) => [hexKey(t.coord), t]));
/** A straight road along q: x = 0..n-1. */
const line = (n: number, over: Partial<MapTile> = {}) => mapOf(Array.from({ length: n }, (_, q) => road(q, 0, over)));
const merchant = (start: HexCoord, over: Partial<Merchant> = {}): Merchant =>
  ({ id: '1:0', kind: 'armourer', start, dealtHour: 0, week: 1, ...over });

describe('the weekly deal', () => {
  const tiles = mapOf(generateMap(SEED));
  // Everything seen: the deal needs revealed road
  for (const t of tiles.values()) t.explored = true;

  it('deals one or two merchants a week, of distinct kinds', () => {
    const counts = new Set<number>();
    for (let week = 1; week <= 40; week++) {
      const deal = dealMerchants(SEED, week, tiles);
      expect(deal.length).toBeGreaterThanOrEqual(M.countMin);
      expect(deal.length).toBeLessThanOrEqual(M.countMax);
      expect(new Set(deal.map((d) => d.kind)).size).toBe(deal.length);
      counts.add(deal.length);
    }
    expect([...counts].sort()).toEqual([1, 2]);
  });

  it('puts every merchant on a revealed road that is no village, home or other place', () => {
    for (let week = 1; week <= 30; week++) {
      for (const d of dealMerchants(SEED, week, tiles)) {
        const t = tiles.get(hexKey(d.start))!;
        expect(t.zone).toBe('road');
        expect(t.explored).toBe(true);
        expect(t.poi).toBeUndefined();
        expect(d.dealtHour).toBe(weekStartHour(week));
        expect(MERCHANT_KINDS).toContain(d.kind);
      }
    }
  });

  it('deals only onto road the party has seen, and none when it has seen none', () => {
    const fresh = mapOf(generateMap(SEED));
    for (const t of fresh.values()) t.explored = false;
    expect(dealMerchants(SEED, 1, fresh)).toEqual([]);
    const some = [...fresh.values()].find((t) => t.zone === 'road' && !t.poi)!;
    some.explored = true;
    for (const d of dealMerchants(SEED, 1, fresh)) expect(hexKey(d.start)).toBe(hexKey(some.coord));
  });

  it('is deterministic from the world seed and the week', () => {
    expect(dealMerchants(SEED, 7, tiles)).toEqual(dealMerchants(SEED, 7, tiles));
    expect(dealMerchants(SEED, 7, tiles)).not.toEqual(dealMerchants(SEED + 1, 7, tiles));
    expect(dealMerchants(SEED, 7, tiles)).not.toEqual(dealMerchants(SEED, 8, tiles));
  });

  it('is dealt with the map and again at every new week', () => {
    useCalendarStore.getState().reset();
    useWorldMapStore.getState().reset();
    useWorldMapStore.getState().setTiles(generateMap(SEED), SEED);
    const first = useWorldMapStore.getState().merchants;
    expect(first.every((m) => m.week === 1)).toBe(true);
    const home = useWorldMapStore.getState().homeCoord!;
    const hoursToWeek2 = weekStartHour(2) - useCalendarStore.getState().totalHours;
    useWorldMapStore.getState().moveParty(home, hoursToWeek2);
    const second = useWorldMapStore.getState().merchants;
    expect(second.every((m) => m.week === 2)).toBe(true);
  });
});

describe('the walk', () => {
  const tiles = line(12);
  const targets: HexCoord[] = [];

  it('takes one hex every six hours of the clock, from where it was dealt', () => {
    const m = merchant(at(5, 0));
    expect(M.hoursPerStep).toBe(6);
    expect(merchantAt(m, 0, tiles, targets, SEED)).toEqual(at(5, 0));
    expect(merchantAt(m, 5.9, tiles, targets, SEED)).toEqual(at(5, 0));
    for (let step = 1; step <= 10; step++) {
      const hour = step * M.hoursPerStep;
      const now = merchantAt(m, hour, tiles, targets, SEED)!;
      const before = merchantAt(m, hour - 1, tiles, targets, SEED)!;
      expect(merchantSteps(m, hour)).toBe(step);
      expect(hexDistance(now, before)).toBe(1);
    }
  });

  it('only ever stands on road, never on a place', () => {
    const withPlace = mapOf([road(0, 0), road(1, 0), road(2, 0, { poi: POIType.Village }), road(3, 0), road(4, 0)]);
    for (let seed = 1; seed <= 20; seed++) {
      for (let hour = 0; hour < M.stayHours; hour += 6) {
        const where = merchantAt(merchant(at(1, 0)), hour, withPlace, targets, seed)!;
        const t = withPlace.get(hexKey(where))!;
        expect(t.zone).toBe('road');
        expect(t.poi).toBeUndefined();
      }
    }
  });

  it('turns back at a dead end', () => {
    // A road 0..2 and a merchant at its end heading out: it must come back, not stop
    const short = line(3);
    const m = merchant(at(2, 0));
    const trail = [0, 6, 12, 18, 24].map((h) => merchantAt(m, h, short, targets, SEED)!.q);
    expect(trail).toEqual([2, 1, 0, 1, 2]);
  });

  it('leans toward a village or home at a fork, and not always', () => {
    // A T: a stem from (0,0) to (3,0), then branches (4,0) toward home at the far west... use a Y by hand
    //   home at (-6,0); the merchant at (0,0) with a west branch toward it and an east branch away
    const tiles2 = mapOf([...Array.from({ length: 13 }, (_, i) => road(i - 6, 0))]);
    const home = at(-6, 0);
    let west = 0;
    const N = 400;
    for (let seed = 1; seed <= N; seed++) {
      if (merchantAt(merchant(at(0, 0)), 6, tiles2, [home], seed)!.q < 0) west++;
    }
    // weights 1 + leanWeight against 1: the share toward home is (1 + lean) / (2 + lean)
    const expected = (1 + M.leanWeight) / (2 + M.leanWeight);
    expect(west / N).toBeGreaterThan(expected - 0.1);
    expect(west / N).toBeLessThan(expected + 0.1);
    expect(west).toBeLessThan(N);
  });

  it('never turns around where it can go on', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const a = merchantAt(merchant(at(5, 0)), 6, tiles, targets, seed)!;
      const b = merchantAt(merchant(at(5, 0)), 12, tiles, targets, seed)!;
      expect(hexKey(b)).not.toBe(hexKey(at(5, 0)));
      expect(hexDistance(a, b)).toBe(1);
    }
  });

  it('is the same walk every time it is worked out', () => {
    const m = merchant(at(5, 0));
    for (let hour = 0; hour < M.stayHours; hour += 6) {
      expect(merchantAt(m, hour, tiles, targets, SEED)).toEqual(merchantAt(m, hour, tiles, targets, SEED));
    }
  });

  it('leaves after four days', () => {
    const m = merchant(at(5, 0), { dealtHour: 100 });
    expect(M.stayHours).toBe(96);
    expect(merchantPresent(m, 99)).toBe(false);
    expect(merchantPresent(m, 100)).toBe(true);
    expect(merchantPresent(m, 195.9)).toBe(true);
    expect(merchantPresent(m, 196)).toBe(false);
    expect(merchantAt(m, 196, tiles, targets, SEED)).toBeNull();
    expect(merchantsAt([m], 400, tiles, targets, SEED)).toEqual([]);
  });

  it('is never drawn on ground the party has not seen', () => {
    const unseen = mapOf([road(0, 0, { explored: false }), road(1, 0), road(2, 0)]);
    const placed = merchantsAt([merchant(at(0, 0))], 0, unseen, targets, SEED);
    expect(placed).toHaveLength(1);
    expect(visibleMerchants(placed, unseen)).toEqual([]);
  });

  it('works out each village and home as targets from the POI index', () => {
    const generated = generateMap(SEED);
    const map = mapOf(generated);
    const poi = generated.filter((t) => t.poi).map((t) => t.coord);
    const found = merchantTargets(map, poi, EMPIRE_WORLD.home);
    expect(found).toContainEqual(EMPIRE_WORLD.home);
    expect(found.filter((c) => map.get(hexKey(c))!.poi === POIType.Village)).toHaveLength(4);
  });

  it('on a real map, no merchant ever stands on a village or home through its whole stay', () => {
    const generated = generateMap(SEED);
    const map = mapOf(generated);
    for (const t of map.values()) t.explored = true;
    const targets2 = merchantTargets(map, generated.filter((t) => t.poi).map((t) => t.coord), EMPIRE_WORLD.home);
    for (let week = 1; week <= 6; week++) {
      for (const d of dealMerchants(SEED, week, map)) {
        for (let hour = d.dealtHour; hour < d.dealtHour + M.stayHours; hour += 6) {
          const where = merchantAt(d, hour, map, targets2, SEED)!;
          expect(map.get(hexKey(where))!.poi).toBeUndefined();
        }
      }
    }
  });

  it('validates the saved shape', () => {
    expect(validMerchant(merchant(at(1, 2)))).toBe(true);
    for (const bad of [null, {}, { ...merchant(at(1, 2)), kind: 'knight' }, { ...merchant(at(1, 2)), start: { q: 1.5, r: 0 } },
      { ...merchant(at(1, 2)), week: 0 }]) expect(validMerchant(bad)).toBe(false);
  });
});

describe('meeting on the road', () => {
  // A road 0..5 with a merchant at its dead end (5): it can only walk west, one hex every six hours
  const tiles = line(6);
  const m = merchant(at(5, 0));
  const targets: HexCoord[] = [];

  it('stops the walk when the party steps onto a merchant standing there', () => {
    // Party walks east from 0 at one hour a hex from hour 1: it reaches x=4 at hour 5, 5 at hour 6 (merchant has moved to 4)
    // Start at hour 0: hour 1 -> x=1 ... hour 5 -> x=5? the merchant is still at 5 until hour 6
    const steps = [at(1, 0), at(2, 0), at(3, 0), at(4, 0), at(5, 0)];
    const meet = meetAlongRoute(steps, steps.map(() => 1), 0, [m], tiles, targets, SEED)!;
    expect(meet.index).toBe(4);
    expect(meet.merchant).toBe(m);
    expect(meet.how).toBe('stepped');
    expect(hexKey(steps[meet.index])).toBe(hexKey(at(5, 0)));
  });

  it('stops where a merchant walks onto the party, at the hex reached', () => {
    // The party steps to x=3 at hour 11 (nobody there); the merchant, at 4 since hour 6, reaches 3 at hour 12 as the party stops... 
    const steps = [at(0, 0), at(1, 0), at(2, 0), at(3, 0)];
    const hours = [11, 0.5, 0.5, 0.5]; // hour 11 -> x0; 11.5 -> x1; 12 -> x2; 12.5 -> x3
    // Merchant at hour 12 stands on x=3: the party's step 2 reaches x=2 at hour 12 — not it; step 3 reaches x=3 at 12.5 — it
    const meet = meetAlongRoute(steps, hours, 0, [m], tiles, targets, SEED)!;
    expect(meet.index).toBe(3);
    expect(hexKey(steps[meet.index])).toBe(hexKey(at(3, 0)));
    expect(meet.how).toBe('stepped');
    // A merchant arriving during the very step that reaches its hex walked onto the party
    const arrive = meetAlongRoute([at(0, 0), at(3, 0)], [11.5, 0.5], 0, [m], tiles, targets, SEED)!;
    expect(arrive.index).toBe(1);
    expect(arrive.how).toBe('walked');
  });

  it('does not stop a route that never crosses one', () => {
    const away = [at(0, 0), at(1, 0)];
    expect(meetAlongRoute(away, [1, 1], 0, [m], tiles, targets, SEED)).toBeNull();
    expect(meetAlongRoute(away, [1, 1], 0, [], tiles, targets, SEED)).toBeNull();
    // A merchant that has left is not met
    expect(meetAlongRoute([at(5, 0)], [200], 0, [m], tiles, targets, SEED)).toBeNull();
  });

  it('finds the merchant on a hex at an hour, and no one on an empty hex', () => {
    expect(merchantOn(at(5, 0), [m], 5, tiles, targets, SEED)?.merchant).toBe(m);
    expect(merchantOn(at(4, 0), [m], 5, tiles, targets, SEED)).toBeNull();
    expect(merchantOn(at(4, 0), [m], 6, tiles, targets, SEED)?.merchant).toBe(m);
  });
});

describe('merchants and worlds', () => {
  const reset = () => {
    useCalendarStore.getState().reset();
    useWorldMapStore.getState().reset();
    useWorldMapStore.getState().setTiles(generateMap(SEED), SEED);
  };

  it('survive a snapshot and its validation', () => {
    reset();
    const dealt = useWorldMapStore.getState().merchants;
    const snap = useWorldMapStore.getState().snapshotWorld();
    expect(snap.merchants).toEqual(dealt);
    expect(isWorldSnapshot(JSON.parse(JSON.stringify(snap)))).toBe(true);
    expect(isWorldSnapshot({ ...snap, merchants: [{ nonsense: true }] })).toBe(false);
    expect(isWorldSnapshot({ ...snap, merchants: undefined })).toBe(false);
    useWorldMapStore.getState().reset();
    useWorldMapStore.getState().restoreWorld('empire', JSON.parse(JSON.stringify(snap)), {});
    expect(useWorldMapStore.getState().merchants).toEqual(dealt);
  });

  it('are dealt afresh for a world left behind across a new week, and kept when none has turned', () => {
    reset();
    const dealt = useWorldMapStore.getState().merchants;
    const arrival = () => useWorldMapStore.getState().partyPosition;
    // Away and back within the week: the same merchants
    useWorldMapStore.getState().switchWorld('jadeveil', 99, (t) => [...t.values()][0].coord);
    useWorldMapStore.getState().switchWorld('empire', SEED, arrival);
    expect(useWorldMapStore.getState().merchants).toEqual(dealt);
    // Away across a week: the old deal has long gone and a new one stands
    useWorldMapStore.getState().switchWorld('jadeveil', 99, arrival);
    useCalendarStore.getState().advance(BALANCE.HOURS_PER_DAY * BALANCE.DAYS_PER_WEEK + 1);
    useWorldMapStore.getState().switchWorld('empire', SEED, arrival);
    expect(useWorldMapStore.getState().merchants.every((m) => m.week === 2)).toBe(true);
  });
});

describe('merchant stock and loot', () => {
  const armourer = merchant(at(0, 0), { id: '3:0', kind: 'armourer' });
  const curio = merchant(at(0, 0), { id: '3:1', kind: 'curio' });
  const provisioner = merchant(at(0, 0), { id: '3:2', kind: 'provisioner' });

  it('racks the armourer\'s epic weapons and armor, a tier above the Smithy\'s', () => {
    const stock = merchantStock(armourer, false);
    expect(stock).toHaveLength(M.slots);
    for (const piece of stock) {
      expect(piece.rarity).toBe(Rarity.Epic);
      expect(['mainHand', 'offHand', 'head', 'chest', 'legs', 'feet']).toContain(piece.slot);
    }
  });

  it('racks the curio dealer\'s gear from other worlds, held to the Empire\'s trinkets without the expansion', () => {
    for (const piece of merchantStock(curio, true)) {
      expect(piece.world).toBe('jadeveil');
      expect([Rarity.Rare, Rarity.Epic]).toContain(piece.rarity);
    }
    expect(merchantStock(curio, true).length).toBeGreaterThan(0);
    for (const piece of merchantStock(curio, false)) {
      expect(piece.world).toBeUndefined();
      expect(['neck', 'ring']).toContain(piece.slot);
    }
  });

  it('racks no gear for the provisioner, who sells a cheap ward and ration bundles', () => {
    expect(merchantStock(provisioner, true)).toEqual([]);
    expect(PROVISIONER_GOODS).toEqual(['ward', 'bundle']);
    expect(provisionerPrice('ward', 10)).toBeLessThan(BALANCE.WARD_GOLD);
    expect(provisionerPrice('bundle', 10)).toBeLessThan(10 * M.bundleRations);
    expect(provisionerPrice('bundle', 10)).toBeGreaterThan(0);
  });

  it('racks the same cart every time, and a different one for another merchant', () => {
    expect(merchantStock(armourer, false).map((t) => t.id)).toEqual(merchantStock(armourer, false).map((t) => t.id));
    const other = merchantStock({ ...armourer, id: '4:0' }, false).map((t) => t.id);
    expect(other).not.toEqual(merchantStock(armourer, false).map((t) => t.id));
  });

  it('buys loot at a poor rate: half what the city Shop pays, never nothing', () => {
    expect(M.buyRate).toBeLessThan(1);
    expect(merchantBuyPrice({ sellPrice: 100 })).toBe(Math.floor(100 * M.buyRate));
    expect(merchantBuyPrice({ sellPrice: 100 })).toBeLessThan(100);
    expect(merchantBuyPrice({ sellPrice: 0 })).toBe(1);
    expect(merchantBuyPrice({ sellPrice: 1 })).toBe(1);
  });
});
