import { HexCoord, IsleGround, MapTile, POIType, TileType } from '@/models/types';
import { createRNG, valueNoise2D } from '@/utils/rng';
import { BALANCE } from '@/data/balanceConstants';
import { getHexLine, getHexesInRange, getNeighbors, hexDistance, hexKey, hexToPixel, pixelToHex } from '@/utils/hexUtils';
import type { WorldDef } from '@/data/worlds';

/**
 * The map of an `isles` world: the archipelago, six islands in a sea.
 *
 * The Empire's ground is one noise value cut into bands and Jadeveil's is an
 * altitude, and both are one country you can walk across. The archipelago is
 * not: it is a chain of islands from the camp's, at the west edge, to Varr's,
 * at the east, with sea between them that nothing crosses yet. So its map is
 * laid out rather than cut: six island centres along the line between the two
 * anchors — the middle four alternating to either side of it, so each channel
 * runs across the chain — and each island a disc whose coast a noise field
 * pushes in and out. Land of two islands is never within `ISLE_CHANNEL` hexes
 * of each other, and each island is one piece of land.
 *
 * Every tile is still an ordinary `TileType` at that type's height, so the
 * climb rules are the Empire's: the beach is desert, the jungle forest, the
 * few rock hexes highlands, and the sea is water, the one wall. What is the
 * archipelago's own is the ground each land tile wears (`MapTile.isle`), which
 * island it is (`MapTile.island`), how deep the sea runs (`MapTile.sea`), the
 * ship's berth by the camp (`MapTile.berth`) and the channel the storm hangs
 * over (`MapTile.storm`).
 *
 * **Its bands are the islands' own**, one to an island (`ISLE_BANDS`): the
 * plan's "threat bands follow island distance from the camp, not the city
 * radii". A sea hex takes the band of the island it lies nearest. Every hex is
 * corridor — there is no haunted island ground, and no road.
 *
 * Generated and drawn only: no factions roll on it (`WorldDef.content.encounters`),
 * the sea is not sailed and the ship does not move. Draws nothing from any
 * stream: the fields are offset by phases taken from the seed and every choice
 * is a hash of it, so a seed is its archipelago and nothing else moves.
 */

const STILL = createRNG(0);
const SQRT3 = Math.sqrt(3);

/** A hex's centre in hex units: neighbours' centres are one apart. */
function unitsOf(coord: HexCoord): { u: number; v: number } {
  const p = hexToPixel(coord);
  return { u: p.x / SQRT3, v: p.y / SQRT3 };
}

/** The hex whose centre is nearest a point in hex units. */
function hexAt(u: number, v: number): HexCoord {
  return pixelToHex(u * SQRT3, v * SQRT3);
}

/** A number in [0, 1) from the seed and a salt: a choice that draws from no stream. */
function choice(seed: number, salt: number): number {
  let h = Math.imul(seed ^ Math.imul(salt + 0x51ed27, 0x9e3779b1), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The seed's offset into the noise fields, so each seed is its own chain. */
function phase(seed: number): [number, number] {
  const h = Math.imul(seed ^ 0x2c1b3c6d, 2654435761) >>> 0;
  return [h % 983, (h >>> 10) % 977];
}

/** One island of the chain. */
export interface Isle {
  /** 0 the camp's, at the west edge, to 5 Varr's, at the east. */
  index: number;
  /** Its centre, in hex units. */
  u: number;
  v: number;
  /** Its radius in hexes, before the coast's noise. */
  radius: number;
  /** Its threat band. */
  band: number;
}

/** How many islands the chain has: fixed by the design (the private project notes). */
export const ISLE_COUNT = 6;

/**
 * Where the six islands lie on a seed. The camp's island stands up and to the
 * right of the home anchor and Varr's up and to the left of the far one, so
 * each anchor is on its island's south coast with open sea in front of it, as
 * the camera looks north; the middle four stand at `ISLE_STATIONS` along the
 * line between them, alternating `ISLE_ZIGZAG` to either side.
 */
export function isleLayout(seed: number, world: WorldDef): Isle[] {
  const home = unitsOf(world.home);
  const far = unitsOf(world.far);
  const du = far.u - home.u;
  const dv = far.v - home.v;
  const len = Math.hypot(du, dv);
  const along = { u: du / len, v: dv / len };
  // Across the chain, toward the bottom of the map (+v)
  const across = { u: -along.v, v: along.u };
  const { home: r0, middle: [rMin, rMax], far: r5 } = BALANCE.ISLE_RADIUS;
  const inset = (r: number) => r - BALANCE.ISLE_ANCHOR_INSET;
  // The camp's island lies inland of the camp — along the chain and up the map — and Varr's the same way back.
  const first = {
    u: home.u + (along.u - across.u) * Math.SQRT1_2 * inset(r0),
    v: home.v + (along.v - across.v) * Math.SQRT1_2 * inset(r0),
  };
  const last = {
    u: far.u + (-along.u - across.u) * Math.SQRT1_2 * inset(r5),
    v: far.v + (-along.v - across.v) * Math.SQRT1_2 * inset(r5),
  };
  const span = { u: last.u - first.u, v: last.v - first.v };
  // Which side of the line the first middle island takes; the others alternate
  const flip = choice(seed, 1) < 0.5 ? 1 : -1;
  const isles: Isle[] = [{ index: 0, ...first, radius: r0, band: BALANCE.ISLE_BANDS[0] }];
  BALANCE.ISLE_STATIONS.forEach((t, i) => {
    const sway = (i % 2 === 0 ? 1 : -1) * flip * BALANCE.ISLE_ZIGZAG;
    // A little give along the chain and across it, so no two seeds lay the same zigzag
    const slide = (choice(seed, 10 + i) - 0.5) * 1.6;
    const drift = (choice(seed, 20 + i) - 0.5) * 1.2;
    isles.push({
      index: i + 1,
      u: first.u + span.u * t + along.u * slide + across.u * (sway + drift),
      v: first.v + span.v * t + along.v * slide + across.v * (sway + drift),
      radius: rMin + (rMax - rMin) * choice(seed, 30 + i),
      band: BALANCE.ISLE_BANDS[i + 1],
    });
  });
  isles.push({ index: 5, ...last, radius: r5, band: BALANCE.ISLE_BANDS[5] });
  return isles;
}

/**
 * How far a hex lies inside each island, as a share of that island's noisy
 * radius: under 1 is its land. The coast's noise is one field for the whole
 * sea, two octaves, so neighbouring coasts are ragged the same way.
 */
function reach(coord: HexCoord, isles: readonly Isle[], seed: number): number[] {
  const { u, v } = unitsOf(coord);
  const [ox, oy] = phase(seed);
  const coast = 0.65 * valueNoise2D(u + ox, v + oy, STILL, 2.6) + 0.35 * valueNoise2D(u + ox + 211, v + oy + 97, STILL, 1.3);
  const swell = 1 + BALANCE.ISLE_COAST * (2 * coast - 1);
  return isles.map((isle) => Math.hypot(u - isle.u, v - isle.v) / (isle.radius * swell));
}

/** The rock field and the jungle-to-the-water field at a hex, both about 0 to 1. */
function groundFields(coord: HexCoord, seed: number): { rock: number; shore: number } {
  const { u, v } = unitsOf(coord);
  const [ox, oy] = phase(seed);
  return {
    rock: valueNoise2D(u + ox + 433, v + oy + 151, STILL, 2.2),
    shore: valueNoise2D(u + ox + 577, v + oy + 389, STILL, 2.4),
  };
}

/** The ground an archipelago land tile wears: beach on desert, jungle on forest, its own basalt on rock. */
export function isleGround(type: TileType): IsleGround | undefined {
  if (type === TileType.Desert) return 'beach';
  if (type === TileType.Forest) return 'jungle';
  if (type === TileType.Highlands) return 'rock';
  return undefined;
}

/** The two neighbours on the side the camera looks from (+r): south-west and south-east. */
function southOf(coord: HexCoord): HexCoord[] {
  return [{ q: coord.q - 1, r: coord.r + 1 }, { q: coord.q, r: coord.r + 1 }];
}

/** The lair doors the archipelago's islands carry: their lairs are still to come. */
export const ISLE_DOORS = { hull: 'lair_hull', grotto: 'lair_grotto' } as const;

/**
 * Generate an `isles` world. `heightOf` is the generator's own height table
 * (`mapGenerator.TERRAIN_HEIGHT`), handed in so the climb rules stay one table.
 */
export function generateIsles(seed: number, world: WorldDef, heightOf: (type: TileType) => number): MapTile[] {
  const { width, height } = world;
  const isles = isleLayout(seed, world);
  const coords: HexCoord[] = [];
  for (let r = 0; r < height; r++) {
    const offset = Math.floor(r / 2);
    for (let q = -offset; q < width - offset; q++) coords.push({ q, r });
  }
  const onMap = new Set(coords.map(hexKey));

  // ── Land: each hex the island it lies furthest inside, land when inside its coast ──
  const nearest = new Map<string, { isle: number; share: number }>();
  const land = new Map<string, number>();
  for (const coord of coords) {
    const shares = reach(coord, isles, seed);
    let best = 0;
    for (let i = 1; i < shares.length; i++) if (shares[i] < shares[best]) best = i;
    nearest.set(hexKey(coord), { isle: best, share: shares[best] });
    if (shares[best] < 1) land.set(hexKey(coord), best);
  }

  // The anchors stand on their islands' land, joined to the middle of it, and
  // the camp has open sea in front of it for the ship's berth.
  const forced = new Set<string>();
  const ground = (coord: HexCoord, isle: number) => {
    if (!onMap.has(hexKey(coord))) return;
    land.set(hexKey(coord), isle);
    forced.add(hexKey(coord));
  };
  const centreOf = (isle: Isle) => hexAt(isle.u, isle.v);
  for (const [anchor, isle] of [[world.home, isles[0]], [world.far, isles[ISLE_COUNT - 1]]] as const) {
    for (const coord of getHexLine(anchor, centreOf(isle))) ground(coord, isle.index);
  }
  for (const isle of isles) ground(centreOf(isle), isle.index);
  const berth = southOf(world.home)[0];
  land.delete(hexKey(berth));

  // ── Channels: no land of two islands within `ISLE_CHANNEL` hexes of each other ──
  const drowned: string[] = [];
  for (const [key, isle] of land) {
    if (forced.has(key)) continue;
    const [q, r] = key.split(',').map(Number);
    const near = getHexesInRange({ q, r }, BALANCE.ISLE_CHANNEL);
    if (near.some((c) => { const other = land.get(hexKey(c)); return other !== undefined && other !== isle; })) drowned.push(key);
  }
  for (const key of drowned) land.delete(key);

  // ── One piece of land each: whatever the coast cut off from the middle is sea ──
  for (const isle of isles) {
    const start = isle.index === 0 ? world.home : isle.index === ISLE_COUNT - 1 ? world.far : centreOf(isle);
    const seen = new Set<string>([hexKey(start)]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      for (const n of getNeighbors(queue[head])) {
        const key = hexKey(n);
        if (seen.has(key) || land.get(key) !== isle.index) continue;
        seen.add(key);
        queue.push(n);
      }
    }
    for (const [key, owner] of [...land]) if (owner === isle.index && !seen.has(key)) land.delete(key);
  }

  // ── Ground: beach on the coast, jungle inland, rock where the rock field peaks ──
  const isSea = (coord: HexCoord) => !land.has(hexKey(coord));
  const coastal = (coord: HexCoord) => getNeighbors(coord).some(isSea);
  const typeOf = new Map<string, TileType>();
  for (const [key, isle] of land) {
    const [q, r] = key.split(',').map(Number);
    const coord = { q, r };
    const { rock, shore } = groundFields(coord, seed);
    const home = isle === 0 && hexDistance(coord, world.home) <= 1;
    let type: TileType;
    if (coastal(coord)) type = shore >= BALANCE.ISLE_JUNGLE_SHORE && !home ? TileType.Forest : TileType.Desert;
    else if (rock >= BALANCE.ISLE_ROCK && !home && !getHexesInRange(coord, 2).some(isSea)) type = TileType.Highlands;
    else type = TileType.Forest;
    typeOf.set(key, type);
  }
  // The camp stands on the beach; Varr's fortress on rock over the sea.
  typeOf.set(hexKey(world.home), TileType.Desert);
  typeOf.set(hexKey(world.far), TileType.Highlands);

  // ── Tiles ──
  const tiles: MapTile[] = coords.map((coord): MapTile => {
    const key = hexKey(coord);
    const isle = land.get(key);
    const band = isles[isle ?? nearest.get(key)!.isle].band;
    if (isle === undefined) {
      const sea = getNeighbors(coord).some((n) => land.has(hexKey(n))) ? 'shallows' as const : 'deep' as const;
      return { coord, type: TileType.Water, height: heightOf(TileType.Water), threat: band, zone: 'corridor', explored: false, sea };
    }
    const type = typeOf.get(key)!;
    const surface = isleGround(type);
    return {
      coord, type, height: heightOf(type), threat: band, zone: 'corridor', explored: false, island: isle,
      ...(surface ? { isle: surface } : {}),
    };
  });
  const tileMap = new Map(tiles.map((t) => [hexKey(t.coord), t] as const));
  const tileAt = (coord: HexCoord) => tileMap.get(hexKey(coord));

  // ── Places ──
  const placed: HexCoord[] = [];
  const put = (tile: MapTile, poi: POIType, extra: Partial<MapTile> = {}) => {
    Object.assign(tile, { poi }, extra);
    placed.push(tile.coord);
  };
  put(tileAt(world.home)!, POIType.IsleCamp);
  put(tileAt(world.far)!, POIType.Stronghold);

  const landOf = (index: number) => tiles.filter((t) => t.island === index && !t.poi);
  const openSouth = (t: MapTile) => southOf(t.coord).every((c) => tileAt(c)?.type === TileType.Water);
  const clear = (t: MapTile) => placed.every((p) => hexDistance(p, t.coord) >= 3);
  /**
   * A coast hex of an island for a place: clear of every other place, with the
   * sea on the camera's side of it where the island has one, so a jetty or a
   * cave mouth opens onto water; then the one facing the way the party comes
   * from (nearest the island before it), the seed breaking ties.
   */
  const coastFor = (index: number, accept: (t: MapTile) => boolean, salt: number): MapTile | undefined => {
    const before = isles[Math.max(0, index - 1)];
    const rank = (t: MapTile) => {
      const { u, v } = unitsOf(t.coord);
      return Math.hypot(u - before.u, v - before.v) + choice(seed, salt + t.coord.q * 131 + t.coord.r * 17) * 0.5;
    };
    const candidates = landOf(index).filter((t) => coastal(t.coord) && accept(t) && clear(t));
    const south = candidates.filter(openSouth);
    const pool = south.length > 0 ? south : candidates;
    return pool.map((t) => [t, rank(t)] as const).sort((x, y) => x[1] - y[1])[0]?.[0];
  };

  // Two of the middle islands hold a pirate fort; the other two a port
  const forts = choice(seed, 2) < 0.5 ? [1, 3] : [2, 4];
  for (const index of [1, 2, 3, 4]) {
    const fort = forts.includes(index);
    const tile = coastFor(index, (t) => t.type === TileType.Desert, 100 + index);
    if (tile) put(tile, fort ? POIType.PirateFort : POIType.IslePort);
  }
  // The Sunken Hull on a beach of a band-2 island, the Flooded Grotto on rock by the sea of the band-3 one
  const bandIsles = (band: number) => isles.filter((i) => i.band === band && i.index > 0 && i.index < ISLE_COUNT - 1);
  const hullIsles = bandIsles(2);
  const hullIsle = hullIsles[Math.floor(choice(seed, 3) * hullIsles.length)] ?? isles[2];
  const hull = coastFor(hullIsle.index, (t) => t.type === TileType.Desert, 200);
  if (hull) put(hull, POIType.BossTile, { encounterId: ISLE_DOORS.hull });
  const grottoIsle = bandIsles(3)[0] ?? isles[4];
  const grotto = coastFor(grottoIsle.index, () => true, 300);
  if (grotto) {
    // The cave's rock: the door's hex and its rock reach the water.
    for (const t of [grotto, ...getNeighbors(grotto.coord).map(tileAt)]) {
      if (!t || t.type === TileType.Water || t.poi) continue;
      if (t !== grotto && !coastal(t.coord)) continue;
      t.type = TileType.Highlands;
      t.height = heightOf(TileType.Highlands);
      t.isle = 'rock';
      if (t !== grotto) break;
    }
    put(grotto, POIType.BossTile, { encounterId: ISLE_DOORS.grotto });
  }

  // ── The sea's two marks: the ship's berth by the camp, the storm over a channel ──
  const berthTile = tileAt(berth);
  if (berthTile) berthTile.berth = true;
  // One of the three middle channels; over open sea, two hexes off the coast of the island south
  // of it — under the cloud, the channel's water, and seen across it from that island's shore —
  // as near the channel's middle as that allows.
  const channel = 1 + Math.floor(choice(seed, 4) * 3);
  const [a, b] = [isles[channel], isles[channel + 1]];
  const south = a.v > b.v ? a : b;
  const mid = { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 };
  const southShore = tiles.filter((t) => t.island === south.index);
  const offShore = (t: MapTile) => Math.min(...southShore.map((l) => hexDistance(l.coord, t.coord)));
  const open = tiles.filter((t) => t.sea === 'deep' && !t.berth
    && getNeighbors(t.coord).every((c) => tileAt(c)?.type === TileType.Water));
  const centreDistance = (t: MapTile) => { const { u, v } = unitsOf(t.coord); return Math.hypot(u - mid.u, v - mid.v); };
  const ranked = open.map((t) => [t, Math.abs(offShore(t) - 2) * 100 + centreDistance(t)] as const)
    .sort((x, y) => x[1] - y[1]);
  if (ranked[0]) ranked[0][0].storm = true;

  // ── What is seen from the first turn: round the camp, and Varr's fortress, a threat and no secret ──
  for (const coord of getHexesInRange(world.home, BALANCE.FOG_REVEAL_RADIUS)) {
    const t = tileAt(coord);
    if (t) t.explored = true;
  }
  for (const coord of getHexesInRange(world.far, 1)) {
    const t = tileAt(coord);
    if (t) t.explored = true;
  }
  return tiles;
}
