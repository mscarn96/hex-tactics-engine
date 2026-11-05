import { HexCoord, getHexesInRange, getNeighbors, hexKey, hexToPixel } from '@/utils/hexUtils';
import { NpcId } from '@/quests/types';
import { NPCS } from '@/quests/npcData';
import { encloseTiles } from '../enclose';
import { CampStation, LocationDef, LocationTile, ScenicPiece, TileLabel } from '../types';

/**
 * The foothill camp: Jadeveil's home, walked inside as the city is.
 *
 * It was a sheet over the world map (playtest 2026-10-21: "Foothill camp should
 * have its own map, just like city"). Now its gate on the map leads in, and
 * each thing the sheet's tabs held stands somewhere: the fire, where the party
 * rests; the monastery's pavilion at the back; the pack-trader's tent, where
 * the haul is sold; the whetstone's lean-to, where it is broken down; the
 * camp's people round the fire; and the lacquered gate, which is the road to
 * the Empire. A fence of bamboo round it all, with a plain gap on the east
 * side onto the range.
 *
 * Drawn as a map, the city's way (`city.ts`): one string per hex row, north at
 * the top, odd rows half a hex to the right (odd-r offset).
 *
 * - `.` trodden earth, `,` moss, `e` where the party arrives — walkable
 * - `M` the monastery's deck, `T` the trader's tent, `W` the whetstone's
 *   lean-to — blocked footprints; lower case is that station's door
 * - `o` the fire, blocked; `f` the hex in front of it, where the party rests
 * - `h` a sleeping tent and `l` a lamp, blocked
 * - `1` `2` the camp's two people, standing either side of the fire with open
 *   ground in front of them
 *
 * The gate is two rows straight down from the entry, as the city's is and for
 * the city's reason: at the town rig's 50° a gate's posts hide the ground a hex
 * behind them, and a party arriving there would arrive out of sight.
 *
 * **The outline is a hexagon round the fire**, four hexes out, and the fence
 * ring round it a hexagon five out — the city's rule (`city.ts`). The camp was
 * a ragged oval whose ring stepped in and out on every row, and its fence came
 * out as runs at seven angles with gaps at every turn (playtest 2026-10-23: "all
 * over the place"). A hexagonal ring gives each fence hex exactly two fence
 * neighbours, so `fencePieces` can lay one run on the line between each pair.
 */
const CAMP = [
  '    hMMMh',
  '    ,.MM.,',
  '   TT.m.WW',
  '   TTt..wWW',
  '  ,.1.o.2.,',
  '   h..f..,.',
  '   ,.....h',
  '    l.e..l',
  '    ,...,',
];
/** `CAMP[0]` is hex row 1: row 0 is the fence. */
const FIRST_ROW = 1;
/** The fire, so the camp is centred on it. */
const ORIGIN = { col: 6, row: 5 };

function axial(col: number, row: number): HexCoord {
  const q = col - (row - (row & 1)) / 2;
  const oq = ORIGIN.col - (ORIGIN.row - (ORIGIN.row & 1)) / 2;
  return { q: q - oq, r: row - ORIGIN.row };
}

interface Cell { coord: HexCoord; ch: string }

const CELLS: Cell[] = CAMP.flatMap((line, i) =>
  [...line].flatMap((ch, col) => (ch === ' ' ? [] : [{ coord: axial(col, i + FIRST_ROW), ch }])),
);
const find = (ch: string) => CELLS.filter((c) => c.ch === ch).map((c) => c.coord);
const one = (ch: string) => find(ch)[0];

/** Each station with a footprint: what stands on it, and the door it opens from. */
const STATIONS: { station: CampStation; footprint: string; door: string; model: string; label: TileLabel }[] = [
  { station: 'monastery', footprint: 'M', door: 'm', model: 'camp_monastery', label: 'monastery' },
  { station: 'trader', footprint: 'T', door: 't', model: 'camp_trader', label: 'trader' },
  { station: 'whetstone', footprint: 'W', door: 'w', model: 'camp_whetstone', label: 'whetstone' },
];

/** The camp's people (`NpcDef.camp`), each on their own hex. */
const PEOPLE: Record<string, NpcId> = { 1: 'exile_monk', 2: 'lantern_keeper' };

const ENTRY = one('e');
const REST = one('f');
/** The lacquered gate: the road to the other world, two rows south of the entry. */
const GATE: HexCoord = { q: ENTRY.q - 1, r: ENTRY.r + 2 };
/**
 * The way out onto the range: the fence hex east of the row in front of the
 * fire — the range climbs east of the camp, and the east fence is in view. Not
 * the fire's own row, whose east end is a corner of the ring.
 */
const EXIT: HexCoord = (() => {
  const row = CELLS.filter((c) => c.coord.r === REST.r);
  const east = row.reduce((a, b) => (b.coord.q > a.coord.q ? b : a)).coord;
  return { q: east.q + 1, r: east.r };
})();

/** The ground a person stands on: whatever most of their walkable neighbours are. */
function groundAround(coord: HexCoord): LocationTile['surface'] {
  let moss = 0;
  let earth = 0;
  for (const n of getNeighbors(coord)) {
    const ch = CELLS.find((c) => hexKey(c.coord) === hexKey(n))?.ch;
    if (ch === ',') moss++;
    else if (ch === '.' || ch === 'e' || ch === 'f') earth++;
  }
  return moss > earth ? 'grass' : 'dirt';
}

function buildTiles(): LocationTile[] {
  const doors = new Map(STATIONS.map((s) => [s.door, s]));
  const camp = CELLS.map(({ coord, ch }): LocationTile => {
    const door = doors.get(ch);
    if (door) {
      return { coord, surface: 'dirt', label: door.label, trigger: { kind: 'camp', station: door.station } };
    }
    if (ch === 'f') {
      return { coord, surface: 'dirt', label: 'campfire', trigger: { kind: 'camp', station: 'fire' } };
    }
    const npc = PEOPLE[ch];
    if (npc) {
      return { coord, surface: groundAround(coord), prop: NPCS[npc].prop, trigger: { kind: 'npc', npc } };
    }
    if (ch === '.' || ch === 'e') return { coord, surface: 'dirt' };
    if (ch === ',') return { coord, surface: 'grass' };
    // The monastery stands on its own deck of boards
    if (ch === 'M') return { coord, surface: 'wood', blocked: true };
    if (ch === 'o') return { coord, surface: 'dirt', blocked: true };
    if (ch === 'h' || ch === 'l') return { coord, surface: 'grass', blocked: true };
    // The trader's and the whetstone's ground is trodden earth under their tents
    return { coord, surface: 'dirt', blocked: true };
  });
  // The fence is the camp's edge, whatever its shape; the gate and the gap onto
  // the range are the two hexes of it the party can stand on
  return encloseTiles(camp, { surface: 'grass', blocked: true }).map((t) => {
    if (hexKey(t.coord) === hexKey(GATE)) {
      return { coord: t.coord, surface: 'dirt', label: 'road', trigger: { kind: 'camp', station: 'road' } };
    }
    if (hexKey(t.coord) === hexKey(EXIT)) {
      return { coord: t.coord, surface: 'dirt', label: 'range', trigger: { kind: 'exit' } };
    }
    return t;
  });
}

// ─── Scenery ─────────────────────────────────────────────────────────────────

/** A small deterministic hash, so the camp is the same every time it loads. */
function hash(coord: HexCoord, salt: number): number {
  let h = (coord.q * 374761393 + coord.r * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const centroid = (coords: HexCoord[]) => {
  const ps = coords.map(hexToPixel);
  return {
    x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
    z: ps.reduce((s, p) => s + p.y, 0) / ps.length,
  };
};

/** A piece standing at a world point, measured from the fire. */
function at(key: string, x: number, z: number, extra: Partial<ScenicPiece> = {}): ScenicPiece {
  return { key, at: { q: 0, r: 0 }, dx: x, dz: z, ...extra };
}

/** Each station on its footprint, square to the camera, tagged with its door. */
function stationPieces(): ScenicPiece[] {
  const out: ScenicPiece[] = STATIONS.map((s) => {
    const c = centroid(find(s.footprint));
    return at(s.model, c.x, c.z, { opens: one(s.door) });
  });
  const fire = hexToPixel(one('o'));
  out.push(at('camp_fire', fire.x, fire.y, { opens: REST }));
  find('h').forEach((coord, i) => {
    const p = hexToPixel(coord);
    out.push(at(i % 2 ? 'camp_tent_1' : 'camp_tent_0', p.x, p.y));
  });
  for (const coord of find('l')) {
    const p = hexToPixel(coord);
    out.push(at('camp_lamp', p.x, p.y));
  }
  return out;
}

/**
 * The fence: one run on the line between each two neighbouring hexes of the
 * ring, its stakes facing the fire, so the runs meet end to end at every hex
 * centre and a corner is two runs meeting rather than a gap. A run that ends at
 * one of the two doors is a half run on the fence's side of it, ending at the
 * door's posts; the gate and the wicket stand over their own hexes.
 */
function fencePieces(tiles: LocationTile[]): ScenicPiece[] {
  const inside = new Set(CELLS.map((c) => hexKey(c.coord)));
  const ring = tiles.filter((t) => !inside.has(hexKey(t.coord))).map((t) => t.coord);
  const onRing = new Set(ring.map(hexKey));
  const doors = new Set([hexKey(GATE), hexKey(EXIT)]);
  // A piece lying along the line p→q, its face turned to the fire at the origin
  const along = (p: { x: number; y: number }, q: { x: number; y: number }) => {
    let nx = -(q.y - p.y);
    let nz = q.x - p.x;
    if (nx * -(p.x + q.x) + nz * -(p.y + q.y) < 0) { nx = -nx; nz = -nz; }
    return Math.atan2(nx, nz);
  };
  const out: ScenicPiece[] = [];
  for (const a of ring) {
    const ka = hexKey(a);
    for (const b of getNeighbors(a)) {
      const kb = hexKey(b);
      if (!onRing.has(kb) || kb <= ka) continue;
      if (doors.has(ka) && doors.has(kb)) continue;
      const toDoor = doors.has(ka) || doors.has(kb);
      const p = hexToPixel(doors.has(ka) ? b : a);
      const q = hexToPixel(doors.has(ka) ? a : b);
      const turn = along(p, q);
      if (toDoor) out.push(at('camp_fence_half', p.x + (q.x - p.x) / 4, p.y + (q.y - p.y) / 4, { turn }));
      else out.push(at('camp_fence', (p.x + q.x) / 2, (p.y + q.y) / 2, { turn }));
    }
  }
  const gate = hexToPixel(GATE);
  out.push(at('camp_gate', gate.x, gate.y, { opens: GATE }));
  // The wicket lies along the ring as the runs do, between its two fence neighbours
  const [n1, n2] = getNeighbors(EXIT).filter((n) => onRing.has(hexKey(n))).map(hexToPixel);
  const exit = hexToPixel(EXIT);
  out.push(at('camp_wicket', exit.x, exit.y, { turn: along(n1, n2), opens: EXIT }));
  return out;
}

/**
 * The range round the camp: jade pines and bamboo on the flanks and behind it,
 * mossy rocks, and nothing tall south of the fence — that is the side the
 * camera looks from, and a pine there would stand in front of the gate.
 */
function countryPieces(tiles: LocationTile[]): ScenicPiece[] {
  const held = new Set(tiles.map((t) => hexKey(t.coord)));
  const gate = hexToPixel(GATE);
  const out: ScenicPiece[] = [];
  for (const coord of getHexesInRange({ q: 0, r: 0 }, 13)) {
    if (held.has(hexKey(coord))) continue;
    if (getNeighbors(coord).some((n) => held.has(hexKey(n)))) continue;
    const p = hexToPixel(coord);
    const south = p.y > gate.y - 1;
    // The trail down from the gate
    if (south && Math.abs(p.x - gate.x) < 2.6) continue;
    const roll = hash(coord, 3);
    if (south) {
      if (roll < 0.25) out.push(at('world_moss_rock_0', p.x, p.y, { scale: 1.6, turn: hash(coord, 4) * 6.28 }));
      continue;
    }
    if (roll < 0.42) {
      out.push(at(hash(coord, 5) < 0.5 ? 'world_jade_pine_0' : 'world_jade_pine_1', p.x, p.y, {
        scale: 2.2 + hash(coord, 6) * 0.6, turn: hash(coord, 7) * 6.28,
      }));
    } else if (roll < 0.64) {
      out.push(at(hash(coord, 8) < 0.5 ? 'world_bamboo_0' : 'world_bamboo_1', p.x, p.y, {
        scale: 2.0, turn: hash(coord, 9) * 6.28,
      }));
    } else if (roll < 0.74) {
      out.push(at('world_moss_rock_1', p.x, p.y, { scale: 1.8, turn: hash(coord, 10) * 6.28 }));
    }
  }
  return out;
}

const TILES = buildTiles();

export const FOOTHILL_CAMP: LocationDef = {
  id: 'camp_jadeveil',
  // Under the range's sky, as the city is under the Empire's
  environment: 'daylight',
  entry: ENTRY,
  tiles: TILES,
  // The range's moss under the fence and the trees outside it
  ambient: { fog: '#1a2418', ground: '#3e4c30' },
  // Down the trail from the gate a little, so arriving shows the gate
  frameSouth: 3,
  scenery: [...stationPieces(), ...fencePieces(TILES), ...countryPieces(TILES)],
};

/** The camp's location id, for the world map's gate and a defeat in Jadeveil. */
export const CAMP_LOCATION = FOOTHILL_CAMP.id;
