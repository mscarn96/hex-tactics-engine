import { generateMap } from '@/systems/world/mapGenerator';
import { JADEVEIL_WORLD, worldSeed } from '@/data/worlds';
import { lairsOf } from '@/locations/lairs';
import { findFaction } from '@/data/templates/factions';
import { SHRINE_KEEPERS } from '@/systems/world/shrines';
import { MapTile, POIType, TileType } from '@/models/types';

/**
 * Sites stand on their faction's ground (the private project notes,
 * decision 6): a lair door or a shrine whose keepers are locked to a terrain
 * never falls back to another one. Generation throws when none fits, so a seed
 * that cannot place a site fails here by name instead of silently misplacing it.
 */

/** The ten seeds the frozen-north suites use, and as many again to widen the sweep. */
const SEEDS = [
  1, 7, 42, 99, 1234, 4242, 90210, 777, 31337, 1471934286,
  2, 3, 5, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127,
];

const door = (tiles: MapTile[], id: string) =>
  tiles.find((t) => t.poi === POIType.BossTile && t.encounterId === id);

describe('lair doors on the Empire map', () => {
  it('puts the Wyrm on desert and the ice lair on frozen ground, on every seed', () => {
    const faults: string[] = [];
    for (const seed of SEEDS) {
      const tiles = generateMap(seed);
      const wyrm = door(tiles, 'lair_wyrm');
      const ice = door(tiles, 'lair_barrow');
      if (!wyrm || wyrm.type !== TileType.Desert || wyrm.frost) faults.push(`${seed}: wyrm on ${wyrm?.type ?? 'nothing'}`);
      if (!ice || !ice.frost) faults.push(`${seed}: ice lair on ${ice?.type ?? 'nothing'}`);
    }
    expect(faults).toEqual([]);
  });

  it('keeps each lair in its faction\'s ground', () => {
    const lairs = lairsOf('empire').filter((l) => l.site);
    expect(lairs.map((l) => l.id).sort()).toEqual(['lair_barrow', 'lair_wyrm']);
    const wyrm = lairs.find((l) => l.id === 'lair_wyrm')!;
    const sandscourge = findFaction(wyrm.faction)!;
    expect(sandscourge.homeLocked).toBe(true);
    expect(wyrm.site?.terrain).toEqual(sandscourge.terrain);
  });
});

describe('the Fallen Order\'s shrine in Jadeveil', () => {
  it('stands on highlands, at the height of highlands, on every seed', () => {
    const faults: string[] = [];
    for (const seed of SEEDS) {
      const tiles = generateMap(worldSeed(seed, 'jadeveil'), JADEVEIL_WORLD);
      const shrine = tiles.find((t) => t.poi === POIType.Shrine && t.shrine === 2);
      if (!shrine) faults.push(`${seed}: no shrine 2`);
      else if (shrine.type !== TileType.Highlands) faults.push(`${seed}: shrine 2 on ${shrine.type}`);
      else if (shrine.height !== tiles.find((t) => t.type === TileType.Highlands && !t.poi)!.height) {
        faults.push(`${seed}: shrine 2 at height ${shrine.height}`);
      }
    }
    expect(faults).toEqual([]);
  });

  it('leaves the shrines of roaming keepers flattened as before', () => {
    expect(findFaction(SHRINE_KEEPERS[2])?.homeLocked).toBe(true);
    for (const index of [1, 3, 4]) expect(findFaction(SHRINE_KEEPERS[index])?.homeLocked).toBeFalsy();
    for (const seed of SEEDS.slice(0, 10)) {
      const tiles = generateMap(worldSeed(seed, 'jadeveil'), JADEVEIL_WORLD);
      for (const index of [1, 3, 4]) {
        expect(tiles.find((t) => t.poi === POIType.Shrine && t.shrine === index)?.type).toBe(TileType.Plains);
      }
    }
  });
});
