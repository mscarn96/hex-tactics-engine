import { HexCoord, getHexesInRange, hexKey } from '@/utils/hexUtils';
import { LocationDef, LocationTile } from './types';

/**
 * The approach to the Obsidian castle.
 *
 * Not the gauntlet — that is four fights with no ground between them, and
 * turning it into rooms would break the one thing it is for: a run of attrition
 * where the scene never unmounts and the party never rests. This is what comes
 * *before* it. A courtyard inside the outer wall, the Legion's dead ground, and
 * a gate you have to walk up to.
 *
 * The point of making it a place at all is the walk. The castle has been visible
 * from every corner of the map since the first hour, and until now arriving
 * there was a dialog box. Now there is a moment between deciding and committing,
 * which is what a threshold is supposed to be.
 */

const CENTRE: HexCoord = { q: 0, r: 0 };
const RADIUS = 4;

/** The gate, at the far end from where the party walks in. */
const GATE: HexCoord = { q: 0, r: -4 };
const ENTRY: HexCoord = { q: 0, r: 3 };
const EXIT: HexCoord = { q: 0, r: 4 };

/**
 * Braziers flanking the approach, and the Legion's standards.
 *
 * Blocked, so the courtyard funnels: the walk from the entry to the gate is a
 * corridor rather than an open field, and there is exactly one way to look while
 * making it.
 */
const OBSTACLES: HexCoord[] = [
  { q: -2, r: 0 }, { q: 2, r: -2 },
  { q: -2, r: 2 }, { q: 2, r: 0 },
  { q: -3, r: 1 }, { q: 3, r: -1 },
];

function buildTiles(): LocationTile[] {
  const blocked = new Set(OBSTACLES.map(hexKey));

  return getHexesInRange(CENTRE, RADIUS).map((coord): LocationTile => {
    const key = hexKey(coord);

    if (key === hexKey(GATE)) {
      return {
        coord,
        surface: 'stone',
        prop: 'poi_empire_castle',
        label: 'place',
        trigger: { kind: 'castleGate' },
      };
    }
    if (key === hexKey(EXIT)) {
      return { coord, surface: 'dirt', trigger: { kind: 'exit' }, label: 'withdraw' };
    }

    // Outer wall, minus the two hexes the road runs through
    if (Math.max(Math.abs(coord.q), Math.abs(coord.r), Math.abs(-coord.q - coord.r)) === RADIUS) {
      return { coord, surface: 'stone', height: 1, blocked: true };
    }

    // The courtyard's obstacles are statues of the Emperor the gate opens on
    if (blocked.has(key)) {
      return { coord, surface: 'stone', blocked: true, prop: 'effigy_castle' };
    }

    return { coord, surface: coord.r <= 0 ? 'stone' : 'dirt' };
  });
}

export const CASTLE: LocationDef = {
  id: 'castle',
  // The courtyard in front of the gate is technically open to the sky, and is
  // lit as an interior anyway: what the approach is *for* is the wall it stands
  // under, and daylight out here would make walking through the gate into the
  // gauntlet a lighting change rather than an arrival.
  environment: 'interior',
  entry: ENTRY,
  tiles: buildTiles(),
  ambient: { fog: '#160c10', ground: '#241418' },
};
