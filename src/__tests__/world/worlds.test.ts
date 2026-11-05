import { lairsOf } from '@/locations/lairs';
import { createHash } from 'crypto';
import { generateMap, reachableFromCity } from '@/systems/world/mapGenerator';
import { threatAt } from '@/systems/world/threat';
import { EMPIRE_WORLD, JADEVEIL_WORLD, WORLDS, WORLD_IDS, worldSeed } from '@/data/worlds';
import { BALANCE } from '@/data/balanceConstants';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { MapTile, POIType } from '@/models/types';

/**
 * The Empire's map, hashed on the build before world rules became data
 * (master ac4c03a4). The world gate, the Overseer's Cut (PT-08) and Hoofprints
 * in the Mud's two sites (2026-10-23, PT-07) are the later, deliberate
 * additions: each only sets `poi` (and a site its `questId`) on one tile, so
 * they are stripped before hashing. So are the four villages (`placeVillages`), which set
 * `poi` and `village` on their own tiles.
 *
 * Seeds 42 and 4242 were re-baselined by the biome lock: the Wyrm's door is
 * desert only (`LairSite`), and on those two seeds it had stood on highlands.
 * The other three are the build before world rules became data, unchanged.
 */
// Re-recorded on 2026-10-23, when the castle's ring became haunted ground (playtest
// 2026-10-23); the rule this pins — the Empire's def generates what the default does — holds
const EMPIRE_BEFORE_WORLD_DEFS: Record<number, string> = {
  42: '2d768e88dea25976',
  99: '4c83fba3fe10e3fa',
  4242: '25a1f801a9f27156',
  20261005: '9a8bc943a402540b',
  1471934286: '54f4e3db76057153',
};

/** Named quest sites added after the baseline, each on one tile it alone marks. */
const LATER_SITES = new Set(['quest_overseers_cut', 'quest_trampled_hamlet', 'quest_raider_camp']);

function fingerprint(tiles: MapTile[]): string {
  const stripped = tiles.map((tile) => {
    if (tile.questId && LATER_SITES.has(tile.questId)) {
      const { poi: _site, questId: _cut, ...rest } = tile;
      return rest;
    }
    if (tile.poi === POIType.Village) {
      const { poi: _village, village: _theme, ...rest } = tile;
      return rest;
    }
    if (tile.poi !== POIType.WorldGate) return tile;
    const { poi: _gate, ...rest } = tile;
    return rest;
  });
  return createHash('sha256').update(JSON.stringify(stripped)).digest('hex').slice(0, 16);
}

describe('world rules as data', () => {
  it('generates the Empire exactly as it was before WorldDef', () => {
    for (const [seed, hash] of Object.entries(EMPIRE_BEFORE_WORLD_DEFS)) {
      expect(fingerprint(generateMap(Number(seed)))).toBe(hash);
      expect(fingerprint(generateMap(Number(seed), EMPIRE_WORLD))).toBe(hash);
    }
  });

  it('keeps the Empire on the balance numbers it was tuned with', () => {
    expect(EMPIRE_WORLD.width).toBe(BALANCE.MAP_WIDTH);
    expect(EMPIRE_WORLD.height).toBe(BALANCE.MAP_HEIGHT);
    expect(EMPIRE_WORLD.threat.home).toEqual(BALANCE.THREAT_CITY_RADII);
    expect(EMPIRE_WORLD.threat.far).toEqual(BALANCE.THREAT_CASTLE_RADII);
  });

  it('gives each world a seed of its own, the Empire keeping the campaign seed', () => {
    expect(worldSeed(1234, 'empire')).toBe(1234);
    expect(worldSeed(1234, 'jadeveil')).not.toBe(1234);
    expect(worldSeed(1234, 'jadeveil')).toBe(worldSeed(1234, 'jadeveil'));
    expect(Object.keys(WORLDS).sort()).toEqual([...WORLD_IDS].sort());
  });
});

describe('a second world', () => {
  const world = JADEVEIL_WORLD;
  const tiles = generateMap(worldSeed(42, world.id), world);
  const tileMap = new Map(tiles.map((t) => [hexKey(t.coord), t] as const));

  it('uses its own dimensions', () => {
    expect(world.width * world.height).toBeLessThan(EMPIRE_WORLD.width * EMPIRE_WORLD.height);
    expect(tiles).toHaveLength(world.width * world.height);
  });

  it('has a far pole whose radii bind', () => {
    const separation = hexDistance(world.home, world.far);
    for (let i = 0; i < 4; i++) {
      expect(world.threat.home[i] + world.threat.far[3 - i]).toBeGreaterThan(separation);
    }
    // And they actually move bands: the same tile reads harder with the pole.
    const lifted = tiles.filter((t) =>
      threatAt(t.coord, world.home, world.far, world.threat) > threatAt(t.coord, world.home, null, world.threat));
    expect(lifted.length).toBeGreaterThan(tiles.length * 0.1);
  });

  it('is a camp with a road home, and carries none of the Empire’s content', () => {
    const home = tileMap.get(hexKey(world.home))!;
    expect(home.poi).toBe(POIType.WorldGate);
    expect(home.zone).toBe('road');
    const pois = tiles.filter((t) => t.poi).map((t) => t.poi);
    for (const foreign of [POIType.City, POIType.EmpireCastle, POIType.QuestSite, POIType.Wayside]) {
      expect(pois).not.toContain(foreign);
    }
    // Its lair doors are its own, never the Empire's
    const doors = tiles.filter((t) => t.poi === POIType.BossTile).map((t) => t.encounterId);
    expect(doors.sort()).toEqual(lairsOf(world.id).map((s) => s.id).sort());
    expect(tiles.some((t) => t.frost)).toBe(false);
  });

  it('can walk from the camp to every well and to the far pole', () => {
    const reachable = reachableFromCity(world.home, tileMap);
    expect(reachable.has(hexKey(world.far))).toBe(true);
    for (const well of tiles.filter((t) => t.poi === POIType.MagicWell)) {
      expect(reachable.has(hexKey(well.coord))).toBe(true);
    }
  });
});
