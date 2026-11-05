import { BuildingType } from '@/models/types';
import {
  HexCoord, getHexesInRange, getNeighbors, hexKey, hexToPixel,
} from '@/utils/hexUtils';
import { NpcId } from '@/quests/types';
import { NPCS } from '@/quests/npcData';
import { encloseTiles } from './enclose';
import { LocationDef, LocationTile, ScenicPiece, TileLabel } from './types';

/**
 * The city: a walled town of streets, with the services as buildings on them.
 *
 * **Drawn as a map, because a town is not a formula.** The square used to be a
 * radius-4 disc of spokes derived from six directions, which is exactly what
 * it looked like — a ring of tokens around a fountain. A town has blocks and
 * the streets between them, buildings several hexes long, and a gate at the
 * end of an avenue, and none of that falls out of a direction and a distance.
 * So the layout is `TOWN`, one string per hex row, read in the order it reads
 * on screen: north at the top, the gate at the bottom.
 *
 * **Two layers, and only the first is the game.** `tiles` is where the party
 * can stand and what happens when it does. `scenery` is the town drawn over
 * it: each building stands on its blocked footprint behind its door, and
 * carries `opens` so a tap on the building walks the party to that door.
 */

/**
 * The town, row by row. Odd rows sit half a hex to the right (pointy-top,
 * "odd-r" offset), so the columns zig-zag and the rows are straight streets.
 *
 * - `.` street, `p` the plaza's flagging round the fountain, `e` where the party
 *   arrives, a row back from the gate, `o` the fountain, `a` an alley — walkable,
 *   paved in `path` rather than setts, so it reads narrower than a street
 * - `g` garden, `h` a house plot, `k` a house's kitchen garden — ground between
 *   streets, blocked
 * - `y` the forge's yard and `t` the inn's, blocked: the working ground between
 *   a service and the next one along, drawn by `town_forge_yard` and
 *   `town_tavern_yard`
 * - upper case is a building's footprint, blocked: `B` barracks, `L` library,
 *   `K` the keep, `F` forge, `V` tavern, `M` market, `X` the stash's
 *   strongroom, `S` shop
 * - lower case is that building's door, a street tile with the trigger on it
 * - `1` `2` `3` are the three quest-givers, standing on the lane north of the
 *   plaza, the plaza's south edge and the west street, with open ground in front
 *   of them: at the town rig's angle anything built directly south of a person
 *   stands between them and the camera
 *
 * **Every street is two hexes wide, and the streets are a hierarchy rather than
 * a grid.** The north street under the keep, the south street, one down each
 * flank and the avenue up from the gate; the plaza framed by its gardens, with
 * the market's and the strongroom's doors opening onto it; a lane down to it
 * from the north street; and alleys in at its northern corners and through the
 * south-east terrace. The first map's streets were one hex wide, and a single
 * row of street between two rows of houses reads as a corridor across a board —
 * and at the opening framing on a phone, as a target half a thumb across. Every
 * door opens onto a street. The wall is not drawn here: it is every hex
 * touching the town that the town does not hold.
 *
 * **The outline is a hexagon, and that is what keeps the wall straight.** Each
 * row's edge steps half a hex per row down the flanks, which is a 60° line on
 * this grid — the one diagonal a hex wall runs along without zig-zagging. The
 * first draft's rows were whatever width their contents wanted, and the ring
 * generated round it stepped in and out on every row, with a tower on every
 * step.
 *
 * **The row between two flank services is a yard, not a row of houses.** Three
 * house plots each side of the plaza sat between the forge and the market, and
 * between the inn and the strongroom, with no street frontage at all — and the
 * services either side of them reached over them, so the houses were drawn
 * through two buildings at once. That ground belongs to the service it lies
 * behind now: the forge's working yard on the west, the inn's on the east. The
 * south-east block is one row of houses facing the camera over their kitchen
 * gardens, where it was two rows turned against each other.
 */
const TOWN = [
  '     hBBBgLLLgKKg',
  '     hBBBggLLgKKKh',
  '    ...b...l......',
  '    ...............',
  '   FFf..hh.1hh..vVV',
  '   FFF..ggpppgg..VVV',
  '  yyy..appppppa..ttt',
  '  hh..MMMmpopxXXX..hh',
  '  hh3.MMgppppgXX..hh',
  '   hg..ggpp2ppgg..hh',
  '   .........hhh..hh',
  '    ...............',
  '    SSSshh........',
  '     SSggh.e.hhahg',
  '     hhhhh..kkakk',
];
/** `TOWN[0]` is hex row 1: row 0 is the north wall. */
const FIRST_ROW = 1;

/** Where the fountain is in the map, so the town is centred on it. */
const ORIGIN = { col: 11, row: 8 };

/** Offset (column, row) to axial, centred on the fountain. */
function axial(col: number, row: number): HexCoord {
  const q = col - (row - (row & 1)) / 2;
  const oq = ORIGIN.col - (ORIGIN.row - (ORIGIN.row & 1)) / 2;
  return { q: q - oq, r: row - ORIGIN.row };
}

interface Cell { coord: HexCoord; ch: string }

const CELLS: Cell[] = TOWN.flatMap((line, i) =>
  [...line].flatMap((ch, col) => (ch === ' ' ? [] : [{ coord: axial(col, i + FIRST_ROW), ch }])),
);
const find = (ch: string) => CELLS.filter((c) => c.ch === ch).map((c) => c.coord);
const one = (ch: string) => find(ch)[0];

const BUILDINGS: {
  building: BuildingType; footprint: string; door: string; model: string; label: TileLabel;
}[] = [
  { building: BuildingType.Barracks, footprint: 'B', door: 'b', model: 'town_barracks', label: 'barracks' },
  { building: BuildingType.Library,  footprint: 'L', door: 'l', model: 'town_library',  label: 'library' },
  { building: BuildingType.Forge,    footprint: 'F', door: 'f', model: 'town_forge',    label: 'forge' },
  { building: BuildingType.Tavern,   footprint: 'V', door: 'v', model: 'town_tavern',   label: 'tavern' },
  { building: BuildingType.Market,   footprint: 'M', door: 'm', model: 'town_market',   label: 'market' },
  { building: BuildingType.Shop,     footprint: 'S', door: 's', model: 'town_shop',     label: 'shop' },
];

const PEOPLE: Record<string, NpcId> = { 1: 'gate_captain', 2: 'caravan_master', 3: 'archivist' };

/** The paving a walkable map character is laid in. */
const WALK_SURFACE: Record<string, LocationTile['surface']> = { '.': 'cobble', e: 'cobble', a: 'path', p: 'stone' };

/**
 * The ground a person stands on: the paving most of the hexes around them are
 * laid in, so they stand on the square or the street they are in rather than on
 * a hex of their own (playtest 2026-10-17: Wren stood on a hex of setts in the
 * middle of the square's flags).
 */
function groundAround(coord: HexCoord): LocationTile['surface'] {
  const counts = new Map<LocationTile['surface'], number>();
  for (const n of getNeighbors(coord)) {
    const ch = CELLS.find((c) => hexKey(c.coord) === hexKey(n))?.ch;
    const surface = ch ? WALK_SURFACE[ch] : undefined;
    if (surface) counts.set(surface, (counts.get(surface) ?? 0) + 1);
  }
  let best: LocationTile['surface'] = 'cobble';
  for (const [surface, count] of counts) if (count > (counts.get(best) ?? 0)) best = surface;
  return best;
}

const ENTRY = one('e');
const STASH_DOOR = one('x');

/**
 * The gate: the wall hex straight down the avenue from the entry, two rows
 * south — a step south-east and a step south-west, which is the one way a
 * pointy-top grid walks due south.
 *
 * **The entry stands a row back from the gate rather than in it.** At the town
 * rig's 50° the gatehouse's towers hide the ground a hex behind them, so a
 * party arriving on the hex inside the gate arrived out of sight — under a
 * camera that opens by looking at the party. Two rows is three world units,
 * clear of the towers' shadow on the screen.
 */
const GATE: HexCoord = { q: ENTRY.q - 1, r: ENTRY.r + 2 };

function buildTiles(): LocationTile[] {
  const doors = new Map(BUILDINGS.map((b) => [b.door, b]));
  const town = CELLS.map(({ coord, ch }): LocationTile => {
    const door = doors.get(ch);
    if (door) {
      return {
        coord, surface: 'cobble', label: door.label,
        trigger: { kind: 'door', building: door.building },
      };
    }
    if (ch === 'x') {
      return { coord, surface: 'cobble', label: 'stash', trigger: { kind: 'stash' } };
    }
    const npc = PEOPLE[ch];
    if (npc) {
      // Walkable: you step onto the tile a person is standing on and the talk
      // opens, exactly as a door does. No `label`: the caption names them
      // through `npcName` when shown, in the current language.
      return {
        coord, surface: groundAround(coord), prop: NPCS[npc].prop,
        trigger: { kind: 'npc', npc },
      };
    }
    if (ch === '.' || ch === 'e') return { coord, surface: 'cobble' };
    // An alley is paved a shade darker than a street, so the town's hierarchy
    // reads from the camera: the setts are the ways through, a lane of worn
    // flags is a short cut between them
    if (ch === 'a') return { coord, surface: 'path' };
    // The square: pale flags against the streets' warm setts, so the plaza
    // reads as a place and the streets as the ways out of it.
    if (ch === 'p') return { coord, surface: 'stone' };
    if (ch === 'o') return { coord, surface: 'stone', blocked: true };
    if (ch === 'g' || ch === 'h' || ch === 'k' || ch === 't') {
      return { coord, surface: 'grass', blocked: true };
    }
    // The forge's yard is trodden earth: it is where the coal is.
    if (ch === 'y') return { coord, surface: 'dirt', blocked: true };
    // A building's footprint: paved and blocked, the building stands on it
    return { coord, surface: 'stone', blocked: true };
  });
  // The wall is the town's boundary, whatever its shape; the gate is the one
  // hex of it the party can stand on.
  return encloseTiles(town, { surface: 'stone', height: 1, blocked: true }).map((t) =>
    (hexKey(t.coord) === hexKey(GATE)
      ? { coord: t.coord, surface: 'cobble', trigger: { kind: 'exit' }, label: 'leave' }
      : t));
}

// ─── Scenery ─────────────────────────────────────────────────────────────────

/** A small deterministic hash, so the town is the same every time it loads. */
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

/**
 * The turn that faces a piece's local +Z along (dx, dz).
 *
 * `composeInstanceMatrix` spins by `Ry(turn)`, which carries local +Z to
 * `(sin t, cos t)` in world x/z.
 */
const facing = (dx: number, dz: number) => Math.atan2(dx, dz);

/** A piece standing at a world point, measured from the hex under it. */
function at(key: string, x: number, z: number, extra: Partial<ScenicPiece> = {}): ScenicPiece {
  // The anchor is the fountain; the offset carries the whole position. Any hex
  // would do — the scene grounds a piece on the tile under where it stands.
  return { key, at: { q: 0, r: 0 }, dx: x, dz: z, ...extra };
}

/**
 * Each service on its lot, tagged with its door so a tap on the building walks
 * there.
 *
 * **Square to the camera, at no turn.** A building used to be turned toward its
 * door, clamped to 30° either side of the camera — and a rectangle turned 30°
 * does not fit a lot made of hex rows. The four on the flanks reached a unit
 * into the plots beside them and were drawn straight through the houses there.
 * Every service model is now authored in the frame of its own lot's centroid
 * (`voxel/models/town.ts`), with its entrance on the face its door tile is on,
 * so standing it at the centroid unturned is the whole placement.
 */
function buildingPieces(): ScenicPiece[] {
  const out: ScenicPiece[] = [];
  for (const b of BUILDINGS) {
    const c = centroid(find(b.footprint));
    out.push(at(b.model, c.x, c.z, { opens: one(b.door), building: b.building }));
  }
  const stash = centroid(find('X'));
  out.push(at('town_stash', stash.x, stash.z, { opens: STASH_DOOR }));
  // The keep has no door the party uses. It faces the town.
  const keep = centroid(find('K'));
  out.push(at('town_keep', keep.x, keep.z));
  const fountain = hexToPixel(one('o'));
  out.push(at('town_fountain', fountain.x, fountain.y));
  // The two service yards, each one model laid across its row of plots
  const forgeYard = centroid(find('y'));
  out.push(at('town_forge_yard', forgeYard.x, forgeYard.z));
  const innYard = centroid(find('t'));
  out.push(at('town_tavern_yard', innYard.x, innYard.z));
  return out;
}

const HOUSES = ['town_house_0', 'town_house_1', 'town_house_2', 'town_house_3'];

/**
 * How wide a house is drawn: a hex across, so a row of them is a terrace whose
 * eaves meet rather than one whose roofs pass through each other. The house
 * model is 1.58 wide at its own scale and hex centres are √3 apart.
 */
const HOUSE_SCALE = 1.08;

/**
 * The plots directly south of a destination — the two hexes of the next row
 * down, which is the side the camera looks from.
 *
 * At the town rig's 50° a two-storey house hides about two units of ground
 * behind it, and the next row up is a unit and a half away, so a house or a
 * tree on either of these hexes stands in front of the door or the person
 * behind it. The street behind a row of houses may be hidden — that is what a
 * town seen from this angle is — but a destination may not.
 */
function infrontOfDestinations(): Set<string> {
  const out = new Set<string>();
  const marked = CELLS.filter((c) => STREET.has(c.ch) && !['.', 'p', 'e', 'a'].includes(c.ch));
  for (const { coord } of marked) {
    for (const n of getNeighbors(coord)) if (n.r === coord.r + 1) out.add(hexKey(n));
  }
  return out;
}
const STREET = new Set(['.', 'p', 'e', 'a', 'b', 'l', 'f', 'v', 'm', 'x', 's', '1', '2', '3']);

/**
 * A house on every house plot and a kitchen garden on every plot in front of
 * one: the south-east block is a single terrace facing the camera over its
 * gardens, square to the street it backs onto. No house plot is in front of a
 * destination — a house there would hide it, and `cityLayout.test.ts`'s
 * occlusion rule fails one that does.
 */
function housePieces(): ScenicPiece[] {
  const out: ScenicPiece[] = [];
  for (const { coord, ch } of CELLS) {
    const p = hexToPixel(coord);
    if (ch === 'h') {
      // Cycled along the row rather than hashed, so neighbours never share a roof
      const kind = HOUSES[((coord.q % HOUSES.length) + HOUSES.length) % HOUSES.length];
      out.push(at(kind, p.x, p.y, { scale: HOUSE_SCALE }));
    } else if (ch === 'k') {
      out.push(at('town_kitchen_garden', p.x, p.y));
    }
  }
  return out;
}

/**
 * Where a hedge stands between a garden hex's centre and its neighbour's: a
 * little short of the edge, so the kerb it stands on is inside the garden and
 * the street beside it stays clear to its own edge.
 */
const HEDGE_AT = 0.43;

/** The neighbours of a hex, in a fixed order, as world points. */
const around = (c: HexCoord) => getNeighbors(c).map((n) => ({ n, p: hexToPixel(n) }));

/** Connected groups of cells carrying `ch`. */
function groupsOf(ch: string): HexCoord[][] {
  const cells = find(ch);
  const keys = new Set(cells.map(hexKey));
  const seen = new Set<string>();
  const out: HexCoord[][] = [];
  for (const start of cells) {
    if (seen.has(hexKey(start))) continue;
    const group: HexCoord[] = [];
    const queue = [start];
    seen.add(hexKey(start));
    while (queue.length) {
      const c = queue.shift()!;
      group.push(c);
      for (const n of getNeighbors(c)) {
        if (keys.has(hexKey(n)) && !seen.has(hexKey(n))) {
          seen.add(hexKey(n));
          queue.push(n);
        }
      }
    }
    out.push(group);
  }
  return out;
}

/**
 * The gardens, composed a plot at a time rather than a hex at a time.
 *
 * Every garden hex used to carry the same bed, the same tree and the same lamp
 * on the same corner — twenty-seven beds, twenty trees and twenty-five lamps,
 * which from the camera is confetti: identical planters with street showing
 * between them. A garden here is a *connected group* of garden hexes, and it is
 * dressed as one place:
 *
 * - a hedge along each edge it shares with a street, and none along an edge it
 *   shares with another garden hex or with a building, so neighbouring hexes
 *   join into one hedged plot — and none toward the plaza, which the four
 *   gardens round the fountain open onto;
 * - one tree, on the hex furthest from the fountain, so the middle of the town
 *   is green without a tree between the camera and the square — none at all on
 *   a plot in front of a destination, or beside the gate, which the approach
 *   keeps clear;
 * - a bed of flowers on every other hex;
 * - and where a garden meets the plaza, the square's furniture: a bench facing
 *   the fountain, a lamp and the town's banner.
 */
function gardenPieces(tiles: LocationTile[]): ScenicPiece[] {
  const out: ScenicPiece[] = [];
  const walkable = new Set(tiles.filter((t) => !t.blocked).map((t) => hexKey(t.coord)));
  // The square, and the two doors that open onto it: a hedge between a garden
  // and the market's own door would fence the square off from its market
  const plaza = new Set([...find('p'), one('m'), one('x')].map(hexKey));
  // The gate approach: the two street tiles just inside the gate
  const inside = new Set(CELLS.map((c) => hexKey(c.coord)));
  const entry = new Set(getNeighbors(GATE).map(hexKey).filter((k) => inside.has(k)));
  const low = infrontOfDestinations();
  const fountain = hexToPixel(one('o'));
  const far = (c: HexCoord) => {
    const p = hexToPixel(c);
    return Math.hypot(p.x - fountain.x, p.y - fountain.y);
  };

  for (const group of groupsOf('g')) {
    const byEntry = group.some((c) => getNeighbors(c).some((n) => entry.has(hexKey(n))));
    const onPlaza = group.filter((c) => getNeighbors(c).some((n) => plaza.has(hexKey(n))));
    const treeAt = byEntry ? undefined : group
      .filter((c) => !low.has(hexKey(c)))
      .sort((a, b) => far(b) - far(a))[0];
    // The plaza's furniture goes on the garden hex nearest the fountain
    const corner = onPlaza.sort((a, b) => far(a) - far(b))[0];

    for (const c of group) {
      const p = hexToPixel(c);
      // Hedges along the edges onto a street
      for (const { n, p: q } of around(c)) {
        if (!walkable.has(hexKey(n)) || plaza.has(hexKey(n))) continue;
        out.push(at('town_hedge', p.x + (q.x - p.x) * HEDGE_AT, p.y + (q.y - p.y) * HEDGE_AT, {
          turn: facing(q.x - p.x, q.y - p.y),
        }));
      }
      if (treeAt && hexKey(c) === hexKey(treeAt)) {
        const oak = hash(c, 3) < 0.6;
        out.push(at(oak ? 'arena_oak_1' : 'arena_pine_1',
          p.x + (hash(c, 4) - 0.5) * 0.2, p.y + (hash(c, 5) - 0.5) * 0.2, {
            scale: 0.52 + hash(c, 6) * 0.08,
          }));
      } else if (!corner || hexKey(c) !== hexKey(corner)) {
        out.push(at('town_flowerbed', p.x, p.y, { turn: hash(c, 2) < 0.5 ? 0 : Math.PI / 3 }));
      }
    }
    if (corner) out.push(...plazaCorner(corner));
  }
  return out;
}

/**
 * A garden's corner onto the square: a lamp on the point of the hex that faces
 * the fountain, a bench behind it facing the fountain across the flagging, and
 * the town's banner at the back of the plot. Four of these frame the square,
 * which is the whole of its lighting — the town used to put a lamp on every
 * garden corner that touched a street, twenty-five of them, and a light on
 * every corner lights nothing in particular.
 */
function plazaCorner(c: HexCoord): ScenicPiece[] {
  const p = hexToPixel(c);
  const f = hexToPixel(one('o'));
  // The vertex nearest the fountain: pointy-top, so at 30° + 60°k from centre
  const vertex = Array.from({ length: 6 }, (_, k) => {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    return { x: p.x + Math.cos(a), z: p.y + Math.sin(a) };
  }).sort((a, b) => Math.hypot(a.x - f.x, a.z - f.y) - Math.hypot(b.x - f.x, b.z - f.y))[0];
  const ux = p.x - vertex.x;
  const uz = p.y - vertex.z;
  const along = (d: number) => ({ x: vertex.x + ux * d, z: vertex.z + uz * d });
  const lamp = along(0.25);
  const bench = along(0.62);
  const flag = along(1.45);
  return [
    at('town_lamp', lamp.x, lamp.z),
    at('town_bench', bench.x, bench.z, { turn: facing(f.x - bench.x, f.y - bench.z) }),
    at('town_banner_pole', flag.x, flag.z),
  ];
}

/**
 * The wall on its ring: a curtain run on each wall hex along the line of its
 * wall neighbours, a tower where the line turns, the gatehouse over the gate
 * and its two flanks, and the town's banners along the runs.
 */
function wallPieces(tiles: LocationTile[]): ScenicPiece[] {
  const wall = tiles.filter((t) => t.height === 1 || hexKey(t.coord) === hexKey(GATE));
  const isWall = new Set(wall.map((t) => hexKey(t.coord)));
  const centre = centroid(CELLS.map((c) => c.coord));
  const flanks = new Set(getNeighbors(GATE).filter((n) => isWall.has(hexKey(n))).map(hexKey));
  const out: ScenicPiece[] = [];
  const runs: { p: { x: number; y: number }; turn: number }[] = [];
  const top = Math.min(...wall.map((t) => hexToPixel(t.coord).y));
  const northMid = wall
    .filter((t) => hexToPixel(t.coord).y === top)
    .sort((a, b) => Math.abs(hexToPixel(a.coord).x - centre.x) - Math.abs(hexToPixel(b.coord).x - centre.x))[0]
    .coord;

  // The gatehouse spans the gate and its flanks, along the line between them
  {
    const [a, b] = [...flanks].map((k) => hexToPixel(parse(k)));
    const g = hexToPixel(GATE);
    const t = Math.atan2(-(b.y - a.y), b.x - a.x);
    const inward = Math.sin(t) * (centre.x - g.x) + Math.cos(t) * (centre.z - g.y);
    out.push(at('town_gatehouse', g.x, g.y, { turn: inward >= 0 ? t : t + Math.PI, opens: GATE }));
  }

  for (const t of wall) {
    const key = hexKey(t.coord);
    if (key === hexKey(GATE) || flanks.has(key)) continue;
    const p = hexToPixel(t.coord);
    const ns = getNeighbors(t.coord).filter((n) => isWall.has(hexKey(n))).map(hexToPixel);
    // The two wall neighbours furthest apart are the line the wall runs along
    let best: [typeof p, typeof p] | null = null;
    let far = -1;
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const dd = Math.hypot(ns[i].x - ns[j].x, ns[i].y - ns[j].y);
        if (dd > far) { far = dd; best = [ns[i], ns[j]]; }
      }
    }
    // A straight run's neighbours are two steps apart; anything shorter is a
    // corner, and a corner takes a tower. So does the middle of the north wall,
    // the longest run and the one the whole frame looks at.
    if (!best || far < 3.2 || key === hexKey(northMid)) {
      out.push(at('town_tower', p.x, p.y, { turn: facing(centre.x - p.x, centre.z - p.y) }));
      continue;
    }
    const [a, b] = best;
    const tt = Math.atan2(-(b.y - a.y), b.x - a.x);
    const inward = Math.sin(tt) * (centre.x - p.x) + Math.cos(tt) * (centre.z - p.y);
    runs.push({ p, turn: inward >= 0 ? tt : tt + Math.PI });
  }
  // The town's banner on every other run, in order round the ring — except
  // along the south wall, whose inner face looks away from the camera and would
  // hang a banner nobody can see.
  const bearing = (u: { p: { x: number; y: number } }) => Math.atan2(u.p.y - centre.z, u.p.x - centre.x);
  runs.sort((u, v) => bearing(u) - bearing(v));
  runs.forEach(({ p, turn }, i) => {
    const facesCamera = Math.cos(turn) > -0.9;
    out.push(at(i % 2 === 0 && facesCamera ? 'town_wall_banner' : 'town_wall', p.x, p.y, { turn }));
  });
  return out;
}

function parse(key: string): HexCoord {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

/**
 * The river south of the town: its centre line's z at a world x. Close under
 * the wall — the approach the frame reaches over (`frameSouth`) — and
 * meandering, because a river ruled along a line reads as a moat.
 */
const RIVER_Z = hexToPixel(GATE).y + 4.4;
const riverZ = (x: number) => RIVER_Z + 0.9 * Math.sin(0.17 * x);
const riverSlope = (x: number) => 0.9 * 0.17 * Math.cos(0.17 * x);
/** Half the river's width with its banks, in world units: what nothing else may stand in. */
const RIVER_HALF = 1.7;
/** The bridge's reach along the road either side of the river's line. */
const BRIDGE_HALF = 2.15;
/** How far apart the road's lengths are laid: a little under the 1.74 of the model. */
const ROAD_LENGTH = 1.6;
/** Where the weir crosses the river, upstream of the bridge. */
const WEIR_X = -10;

/**
 * The country outside: the road out of the gate, over the river on a bridge,
 * the river itself with a weir upstream, fields and a windmill on the flanks,
 * farmhouses, and woods behind the town.
 */
function countryPieces(tiles: LocationTile[]): ScenicPiece[] {
  const out: ScenicPiece[] = [];
  const held = new Set(tiles.map((t) => hexKey(t.coord)));
  const g = hexToPixel(GATE);
  // The road, in lengths from the gate to the bridge's near abutment and on
  // from its far one: each length a little under its model, so they overlap
  // into one road and run up under the bridge's ends rather than short of them
  const bridge = riverZ(g.x);
  for (let z = g.y + ROAD_LENGTH; z < bridge - BRIDGE_HALF; z += ROAD_LENGTH) out.push(at('town_road', g.x, z));
  for (let k = 0; k < 4; k++) {
    out.push(at('town_road', g.x, bridge + BRIDGE_HALF + ROAD_LENGTH / 2 - 0.1 + ROAD_LENGTH * k));
  }
  out.push(at('town_bridge', g.x, bridge));
  // The river in overlapping lengths, each turned along its course, and the
  // weir where it falls a step
  for (let x = -44; x <= 44; x += 2) {
    out.push(at('town_river', x, riverZ(x), { turn: -Math.atan(riverSlope(x)) }));
  }
  out.push(at('town_weir', WEIR_X, riverZ(WEIR_X), { turn: -Math.atan(riverSlope(WEIR_X)) }));
  const mill = { x: g.x - 21, z: g.y - 6 };
  out.push(at('town_windmill', mill.x, mill.z, { turn: 0.4 }));

  const near = (c: HexCoord) => getHexesInRange(c, 1).some((n) => held.has(hexKey(n)));
  const kind = new Map<string, 'field' | 'tree' | 'house'>();
  for (const coord of getHexesInRange({ q: 0, r: 0 }, 20)) {
    if (held.has(hexKey(coord)) || near(coord)) continue;
    const p = hexToPixel(coord);
    if (Math.abs(p.x - g.x) < 2.2 && p.y > g.y) continue; // the road
    if (Math.abs(p.y - riverZ(p.x)) < RIVER_HALF + 0.9) continue; // the river
    if (Math.hypot(p.x - mill.x, p.y - mill.z) < 2.5) continue; // the mill
    if (Math.abs(p.x) > 36 || Math.abs(p.y) > 26) continue;
    const roll = hash(coord, 11);
    const flank = Math.abs(p.x) > 18 && p.y > -4;
    if (flank && roll < 0.4) kind.set(hexKey(coord), 'field');
    else if (roll < 0.5) kind.set(hexKey(coord), 'tree');
    else if (roll < 0.54) kind.set(hexKey(coord), 'house');
  }
  for (const coord of getHexesInRange({ q: 0, r: 0 }, 20)) {
    const k = kind.get(hexKey(coord));
    if (!k) continue;
    const p = hexToPixel(coord);
    // A farmhouse turned any which way reaches past its own hex, so one beside
    // a field is a tree instead of a house standing in the wheat
    const crowded = k === 'house' && getNeighbors(coord).some((n) => kind.get(hexKey(n)) === 'field');
    if (k === 'field') {
      // Square to the rows, like every field: turned 60° a field is wider than
      // its hex and runs into the one beside it
      out.push(at('town_field', p.x, p.y));
    } else if (k === 'tree' || crowded) {
      out.push(at(hash(coord, 13) < 0.55 ? 'arena_oak_0' : 'arena_pine_0', p.x, p.y, {
        scale: 0.45 + hash(coord, 14) * 0.15,
      }));
    } else {
      out.push(at(HOUSES[Math.floor(hash(coord, 15) * HOUSES.length)], p.x, p.y, {
        turn: hash(coord, 16) * Math.PI * 2,
      }));
    }
  }
  return out;
}

const TILES = buildTiles();

export const CITY: LocationDef = {
  id: 'city',
  // A walled town is still outdoors. The square, the gardens and the road into
  // it are under the same sun.
  environment: 'daylight',
  entry: ENTRY,
  tiles: TILES,
  // Farmland rather than the void: the plane under the town is the country the
  // wall stands in, and the fields and trees outside it stand on this.
  ambient: { fog: '#1a1a2e', ground: '#3a5a28' },
  // Over the river to its far bank: arriving at the gate shows the bridge the
  // road came in over
  frameSouth: 6,
  scenery: [
    ...wallPieces(TILES), ...buildingPieces(), ...housePieces(), ...gardenPieces(TILES),
    ...countryPieces(TILES),
  ],
};
