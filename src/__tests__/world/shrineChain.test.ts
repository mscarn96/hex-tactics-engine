import { generateMap } from '@/systems/world/mapGenerator';
import { JADEVEIL_WORLD, worldSeed } from '@/data/worlds';
import { hexKey } from '@/utils/hexUtils';
import { MapTile, POIType } from '@/models/types';
import { walkingHours } from '@/systems/sim/wrathRoutes';
import {
  barredPasses, openBand, SHRINE_COUNT, SHRINE_KEEPERS, shrineEncounterId, shrineOfEncounter, shrineState,
  shrineToOpen, tileLocked,
} from '@/systems/world/shrines';
import { lockedRefusal, shrineArrival, shrineClaimedNotice, shrineName, summitArrival } from '@/systems/world/rangeSites';
import { planEncounter, curatedBand } from '@/systems/world/encounterGenerator';
import { planRoute } from '@/systems/world/travel';
import { ascentNewsText, useAscentStore } from '@/stores/ascentStore';
import { awardWrath, NO_WRATH } from '@/systems/world/wrath';
import { factionMembers } from '@/data/templates/factions';
import { lairsOf } from '@/locations/lairs';

/**
 * The shrine chain that gates Jadeveil's ascent (`systems/world/shrines.ts`):
 * each claim opens the band above, the fourth opens the summit, every seed's
 * chain is walkable with only what the claims below opened, and a claim is
 * permanent — nothing the wrath does takes one back.
 */
const SEEDS = [1, 7, 42, 99, 1234, 4242, 90210, 1471934286];
const maps = SEEDS.map((seed) => {
  const tiles = generateMap(worldSeed(seed, 'jadeveil'), JADEVEIL_WORLD);
  return { seed, tiles, map: new Map(tiles.map((t) => [hexKey(t.coord), t] as const)) };
});
const tile = (threat: number, extra: Partial<MapTile> = {}): MapTile =>
  ({ coord: { q: 0, r: 0 }, type: 'plains', threat, explored: true, ...extra } as MapTile);

describe('which ground the chain bars', () => {
  it('opens bands 0–1 from the start and one more band per claim', () => {
    for (let claimed = 0; claimed <= SHRINE_COUNT; claimed++) {
      for (let band = 0; band <= 4; band++) {
        expect(tileLocked(tile(band), claimed)).toBe(band > Math.min(4, claimed + 1));
      }
      expect(openBand(claimed)).toBe(Math.min(4, claimed + 1));
    }
  });

  it('bars the summit hex until the fourth shrine, and names the shrine that opens each place', () => {
    const summit = tile(4, { poi: POIType.Summit });
    for (let claimed = 0; claimed < SHRINE_COUNT; claimed++) expect(shrineToOpen(summit, claimed)).toBe(SHRINE_COUNT);
    expect(shrineToOpen(summit, SHRINE_COUNT)).toBeNull();
    expect(shrineToOpen(tile(3), 0)).toBe(2);
    expect(lockedRefusal(tile(3), 0)).toContain(shrineName(2));
    expect(lockedRefusal(tile(2), 1)).toBeNull();
    expect(summitArrival(0, String, 3)).toContain(shrineName(4));
  });
});

describe('the chain on generated ranges', () => {
  it('reaches each next shrine with only the claims below it, and the summit with all four', () => {
    for (const { seed, tiles, map } of maps) {
      const camp = map.get(hexKey(JADEVEIL_WORLD.home))!;
      for (let claimed = 0; claimed < SHRINE_COUNT; claimed++) {
        const reach = walkingHours(map, camp, (t) => tileLocked(t, claimed));
        const next = tiles.find((t) => t.shrine === claimed + 1)!;
        expect({ seed, claimed, reached: reach.has(hexKey(next.coord)) }).toEqual({ seed, claimed, reached: true });
      }
      const summit = tiles.find((t) => t.poi === POIType.Summit)!;
      expect(walkingHours(map, camp, (t) => tileLocked(t, SHRINE_COUNT)).has(hexKey(summit.coord))).toBe(true);
    }
  });

  it('opens each lair door with the shrines below its band, on every seed', () => {
    for (const { seed, tiles, map } of maps) {
      const camp = map.get(hexKey(JADEVEIL_WORLD.home))!;
      for (const spec of lairsOf('jadeveil')) {
        const door = tiles.find((t) => t.encounterId === spec.id);
        expect({ seed, id: spec.id, placed: !!door }).toEqual({ seed, id: spec.id, placed: true });
        const reach = walkingHours(map, camp, (t) => tileLocked(t, spec.band - 1) || (t.threat ?? 0) > spec.band);
        expect({ seed, id: spec.id, reached: reach.has(hexKey(door!.coord)) }).toEqual({ seed, id: spec.id, reached: true });
      }
    }
  });

  it('refuses a route into barred ground and allows it once claimed', () => {
    const { tiles, map } = maps[0];
    const explored = new Map([...map].map(([k, t]) => [k, { ...t, explored: true }] as const));
    const shrine3 = tiles.find((t) => t.shrine === 3)!;
    expect(planRoute(explored, JADEVEIL_WORLD.home, shrine3.coord, (t) => tileLocked(t, 0))).toBeNull();
    expect(planRoute(explored, JADEVEIL_WORLD.home, shrine3.coord, (t) => tileLocked(t, 2))).not.toBeNull();
  });

  it('draws barred flags only at passes into ground the chain still bars', () => {
    for (const { tiles } of maps) {
      const none = barredPasses(tiles, SHRINE_COUNT);
      expect(none.size).toBe(0);
      const start = barredPasses(tiles, 0);
      for (const t of tiles) {
        if (start.has(hexKey(t.coord))) expect(t.pass && (t.threat ?? 0) >= 2).toBe(true);
      }
      expect(start.size).toBeGreaterThan(0);
    }
  });
});

describe('claiming', () => {
  beforeEach(() => useAscentStore.getState().reset());

  it('claims only the next shrine in order, and says what it opened', () => {
    const store = useAscentStore.getState;
    expect(store().claimShrine(2)).toBe(false);
    expect(store().claimShrine(1)).toBe(true);
    expect(store().shrines).toBe(1);
    expect(ascentNewsText(store().news!)).toContain(shrineName(1));
    expect(store().claimShrine(1)).toBe(false);
    expect(store().shrines).toBe(1);
  });

  it('keeps every claim whatever the wrath does', () => {
    const store = useAscentStore.getState;
    store().claimShrine(1);
    store().claimShrine(2);
    useAscentStore.setState({ wrath: awardWrath(NO_WRATH, 0, 100).state });
    useAscentStore.setState({ wrath: NO_WRATH });
    expect(store().shrines).toBe(2);
  });

  it('sends each shrine\'s keepers from its faction at its band, the Host on the road to Kairen', () => {
    expect(SHRINE_KEEPERS[3]).toBe('draconic_host');
    expect(SHRINE_KEEPERS[4]).toBe('draconic_host');
    for (let i = 1; i <= SHRINE_COUNT; i++) {
      const id = shrineEncounterId(i);
      expect(shrineOfEncounter(id)).toBe(i);
      expect(curatedBand(id)).toBe(i);
      const plan = planEncounter(id, 0, undefined, undefined, [], 'jadeveil');
      expect(plan.factionId).toBe(SHRINE_KEEPERS[i]);
      const members = new Set<string>(factionMembers(SHRINE_KEEPERS[i]));
      for (const enemy of plan.enemies) expect(members.has(enemy)).toBe(true);
    }
    expect(shrineOfEncounter('shrine_9')).toBeNull();
    expect(shrineOfEncounter('lair_warren_boss')).toBeNull();
  });
});
