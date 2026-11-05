import { generateMap, movementCost } from '@/systems/world/mapGenerator';
import { cityExit } from '@/systems/world/travel';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { MapTile, POIType } from '@/models/types';

/**
 * Leaving the city puts the party on its doorstep, never back on the city tile
 * — standing there, the city could only be re-entered by stepping off it first.
 */
describe('cityExit', () => {
  const SEEDS = [1, 7, 42, 99, 1234, 90210];

  it('is a walkable, empty neighbour of the city on every seed', () => {
    const offenders: string[] = [];
    for (const seed of SEEDS) {
      const tiles = new Map<string, MapTile>(generateMap(seed).map((t) => [hexKey(t.coord), t]));
      const city = [...tiles.values()].find((t) => t.poi === POIType.City)!;
      const exit = cityExit(tiles, city.coord, new Set());
      const tile = exit && tiles.get(hexKey(exit));
      if (!exit || !tile) { offenders.push(`${seed}: none`); continue; }
      if (hexDistance(exit, city.coord) !== 1) offenders.push(`${seed}: not adjacent`);
      if (movementCost(city, tile) === null) offenders.push(`${seed}: not walkable`);
      if (tile.poi) offenders.push(`${seed}: stands on ${tile.poi}`);
    }
    expect(offenders).toEqual([]);
  });

  it('takes the road out when there is one, and avoids a live encounter', () => {
    const tiles = new Map<string, MapTile>(generateMap(42).map((t) => [hexKey(t.coord), t]));
    const city = [...tiles.values()].find((t) => t.poi === POIType.City)!;
    const exit = cityExit(tiles, city.coord, new Set())!;
    expect(tiles.get(hexKey(exit))!.zone).toBe('road');
    // Every neighbour live except one off-road hex: the road still wins, since
    // a road never holds an encounter, and a live hex loses to a quiet one
    const offRoad = [...tiles.values()].filter(
      (t) => hexDistance(t.coord, city.coord) === 1 && t.zone !== 'road' && !t.poi
        && movementCost(city, t) !== null,
    );
    if (offRoad.length >= 2) {
      const noRoad = new Map(tiles);
      for (const t of noRoad.values()) {
        if (hexDistance(t.coord, city.coord) === 1 && t.zone === 'road') noRoad.set(hexKey(t.coord), { ...t, zone: 'corridor' });
      }
      const live = new Set([hexKey(offRoad[0].coord)]);
      expect(hexKey(cityExit(noRoad, city.coord, live)!)).not.toBe(hexKey(offRoad[0].coord));
    }
  });
});
