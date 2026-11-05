import { generateMap } from '@/systems/world/mapGenerator';
import { TileType } from '@/models/types';
import { FACTIONS } from '@/data/templates/factions';

/**
 * Where the game is allowed to have fights.
 *
 * Random encounters fire **only** on `isDanger` tiles, so the terrain list in
 * `mapGenerator`'s danger pass is not decoration — it decides which factions can
 * ever be met on their own ground. Swamp was missing from it, which quietly
 * deleted the Fenfolk: their whole territory could not host an encounter, so the
 * terrain weighting that favours them there had nothing to act on and the only
 * way to meet them was the hunt weighting from an active kill quest.
 *
 * Sampled across seeds because placement is noise-driven; the assertion is about
 * whether the ground *can* carry a fight, not how many.
 */
const SEEDS = [1, 7, 42, 99, 2026];

describe('danger terrain', () => {
  const maps = SEEDS.map((s) => generateMap(s));

  it('lets every faction home terrain host an encounter', () => {
    // Terrain a faction is weighted toward, taken from the roster rather than
    // written out — a new faction on new ground fails here rather than shipping
    // as an enemy nobody meets.
    const homes = new Set<TileType>(FACTIONS.flatMap((f) => f.terrain ?? []));

    const barren: string[] = [];
    for (const terrain of homes) {
      const anywhere = maps.some((tiles) =>
        tiles.some((t) => t.type === terrain && (t.zone === 'haunted')),
      );
      if (!anywhere) barren.push(terrain);
    }

    expect(barren).toEqual([]);
  });

  it('puts real fights on swamp, not a token one', () => {
    const counts = maps.map(
      (tiles) => tiles.filter((t) => t.type === TileType.Swamp && (t.zone === 'haunted')).length,
    );
    // Every sampled map, not just one — an intermittent green here would get
    // re-run rather than investigated.
    expect(counts.filter((n) => n < 3)).toEqual([]);
  });
});
