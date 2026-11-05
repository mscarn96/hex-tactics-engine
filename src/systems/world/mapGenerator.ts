import { MapTile, TileType, POIType, HexCoord } from '@/models/types';
import { hexKey, hexDistance, getHexesInRange, getHexLine, getNeighbors } from '@/utils/hexUtils';
import { createRNG, valueNoise2D } from '@/utils/rng';
import { threatAt } from '@/systems/world/threat';
import { BALANCE } from '@/data/balanceConstants';
import { lairsOf, LairSite } from '@/locations/lairs';
import { QUEST_SITES, QuestSiteId } from '@/quests/sites';
import type { NpcId } from '@/quests/types';
import { EMPIRE_WORLD, type WorldDef, type ZoneRules } from '@/data/worlds';
import { ascent, jadeGround, rangeTerrain } from '@/systems/world/rangeTerrain';
import { generateIsles } from '@/systems/world/isleTerrain';
import { atHome, findFaction } from '@/data/templates/factions';
import { SHRINE_KEEPERS } from '@/systems/world/shrines';
import { VILLAGES, villageRouteShare } from '@/data/villages';

export { empireCastleCoord } from '@/data/worlds';

/**
 * How high each terrain stands. Load-bearing, not decorative — `movementCost`
 * reads these, so the gaps between them are the game's traversal rules.
 *
 * Mountain came down from 3.0 to make room for a legal step off the highlands.
 * See `MAX_CLIMB` for the arithmetic that pins every one of these numbers.
 */
const TERRAIN_HEIGHT: Record<TileType, number> = {
  [TileType.Water]:     -0.8,
  [TileType.Swamp]:     -0.2,
  [TileType.Plains]:     0.0,
  // Between the plains and the desert it is made from, and well inside the
  // window `MAX_CLIMB` leaves level ground: the highlands are a legal step up
  // from it and a peak is not.
  [TileType.Tundra]:     0.3,
  [TileType.Desert]:     0.4,
  [TileType.Forest]:     0.6,
  [TileType.Highlands]:  1.4,
  [TileType.Mountain]:   2.6,
};

/**
 * The tallest step a party can take, in `TERRAIN_HEIGHT` units.
 *
 * Sits in a window with a floor and a ceiling, and both matter:
 *
 * - It must be **at least 1.6**, the swamp-to-highlands gap, or a bog against a
 *   range walls that shoulder off from the rest of the map.
 * - It must be **under 2.0**, the forest-to-mountain gap, or a peak can be
 *   walked onto directly and the highlands stop being the way up.
 *
 * 1.8 is the middle of that window. A mountain is therefore reachable from
 * highlands (1.2) and from nowhere else; the highlands are reachable from
 * everything.
 *
 * **Symmetric on purpose.** An ascent-only limit lets a party walk down into a
 * bowl it cannot climb out of, which is a soft-locked save. Comparing the
 * absolute difference keeps the movement graph undirected, so that state cannot
 * be constructed.
 */
export const MAX_CLIMB = 1.8;

/** Ordinary walkable ground — not water, and nothing that has to be climbed. */
function isLevelGround(type: TileType): boolean {
  return type !== TileType.Water
    && type !== TileType.Mountain
    && type !== TileType.Highlands;
}

/**
 * Turns a tile into plains, **height included**.
 *
 * The height is the point. Three places used to reassign `type` and leave
 * `height` behind, which cost nothing while elevation was decoration — now that
 * `movementCost` reads it, a flattened peak that kept its 2.6 would be a patch
 * of grass nobody could step onto.
 */
function flatten(tile: MapTile): void {
  // Level ground in the north is snow: a road or a clearing cut through the
  // frozen north must not leave a strip of green behind it.
  const level = tile.frost ? TileType.Tundra : TileType.Plains;
  tile.type = level;
  tile.height = TERRAIN_HEIGHT[level];
}

/**
 * The terrains the frozen north turns to `Tundra`: all its level ground.
 *
 * Swamp too, which the plan's list left out. Left alone it stands in the snow
 * as green bog with reeds round it — about one frozen tile in fourteen — and a
 * bog in a snowfield is frozen ground. Water stays water, and rock stays rock
 * under `MapTile.frost`.
 */
const THAWED: ReadonlySet<TileType> = new Set([TileType.Plains, TileType.Forest, TileType.Desert, TileType.Swamp]);

/**
 * Whether a tile lies in the frozen north: above a row threshold that is zero
 * at `FROST_WEST` of the map's width and deepens eastward to `FROST_DEPTH` of
 * its height at the east edge.
 *
 * **The wobble is a function of the column alone**, so each column's frozen
 * tiles are one run down from the top row. That is what makes the region one
 * region on every seed — every column's run touches row 0, and row 0 is
 * connected — where a two-dimensional wobble would drop frozen islands south
 * of the line. The edge still wanders, because neighbouring columns stop at
 * different rows.
 *
 * The phase comes from the seed directly rather than from the generator's
 * stream. `valueNoise2D` draws nothing from the stream either, and taking a
 * number from it here would move every road, door and well on every map.
 */
export function inFrozenNorth(coord: HexCoord, seed: number, width: number, height: number): boolean {
  const column = coord.q + Math.floor(coord.r / 2);
  const x = column / Math.max(1, width - 1);
  const y = coord.r / Math.max(1, height - 1);
  const t = Math.min(1, Math.max(0, (x - BALANCE.FROST_WEST) / (1 - BALANCE.FROST_WEST)));
  if (t <= 0) return false;
  const phase = (Math.imul(seed, 2654435761) >>> 0) % 997;
  // Smoothstep, so the wedge opens gently from its western tip rather than at a
  // kink, and is close to its full depth across the eastern third.
  const depth = BALANCE.FROST_DEPTH * t * t * (3 - 2 * t);
  if (depth <= 0) return false;
  // The wobble eases in with the square root of the depth rather than the depth
  // itself: in proportion, the shallow western tip came out a ruled row for ten
  // columns. Never past half the depth inward, so row 0 is frozen in every
  // column that has any north, which is what the one-region rule stands on.
  const wobble = (valueNoise2D(column + phase, phase, createRNG(0), 4) - 0.5) * 2 * BALANCE.FROST_WOBBLE;
  const edge = Math.max(depth * 0.5, depth + wobble * Math.sqrt(depth / BALANCE.FROST_DEPTH));
  return y < edge;
}

/**
 * Generate one world's map. Everything that differs between worlds — the
 * dimensions, both anchors, the threat radii, the zone rules and which authored
 * content is placed — comes from `world`; the Empire's output is the one every
 * save has always had (`worlds.test.ts` pins it).
 *
 * Inside this function `cityCoord` is the world's **home** anchor and
 * `castleCoord` its **far** one; in the Empire they are the city and the
 * Obsidian castle.
 */
export function generateMap(seed: number, world: WorldDef = EMPIRE_WORLD): MapTile[] {
  // Islands in a sea are laid out, not cut from one field, and none of the
  // passes below — roads, zones, the shuffled pool, wells — fits them: their
  // own generator from the first tile, sharing only the heights (`isleTerrain.ts`).
  if (world.terrain === 'isles') return generateIsles(seed, world, (type) => TERRAIN_HEIGHT[type]);
  const rng = createRNG(seed);
  const { width, height } = world;
  const tiles: MapTile[] = [];
  const tileMap = new Map<string, MapTile>();
  // In the Empire the city stands at mid-width on the middle row and the
  // Obsidian castle in the far corner. Both are fixed by the world, and the
  // frozen north reads the threat gradient between them before any tile exists.
  const cityCoord: HexCoord = world.home;
  const castleCoord = world.far;

  // Generate hex coords for a rectangular map
  for (let r = 0; r < height; r++) {
    const offset = Math.floor(r / 2);
    for (let q = -offset; q < width - offset; q++) {
      const coord: HexCoord = { q, r };
      const noise = valueNoise2D(q + 50, r + 50, rng, 6);

      let type: TileType;
      if (world.terrain === 'range') {
        type = rangeTerrain(coord, seed, world);
      } else if (noise < 0.2) {
        type = TileType.Water;
      } else if (noise < 0.3) {
        type = TileType.Swamp;
      } else if (noise < 0.55) {
        type = TileType.Plains;
      } else if (noise < 0.75) {
        type = TileType.Forest;
      } else if (noise < 0.88) {
        type = TileType.Desert;
      } else if (noise < 0.94) {
        // Carved out of what used to be the bottom half of the mountain band.
        // The noise is continuous, so the contour just under a peak already
        // wraps around it — the foothills come out geometrically correct for
        // free, and the pass below only has to catch where the gradient is too
        // steep for the band to have any width.
        type = TileType.Highlands;
      } else {
        type = TileType.Mountain;
      }

      // The frozen north: its warm level ground is snow, and everything in it —
      // water and rock included — is marked, so the peaks there carry snow too.
      // Never below `FROST_MIN_BAND`: the north is late ground, and the wedge's
      // south-western edge runs close enough to the city's rings that a shore
      // would otherwise put the odd snow tile in band 1. Bands fall toward the
      // city down every column, so this trims the foot of a column's frozen run
      // and never splits it.
      const frost = world.content.frost
        && inFrozenNorth(coord, seed, width, height)
        && threatAt(coord, cityCoord, castleCoord, world.threat) >= BALANCE.FROST_MIN_BAND;
      if (frost && THAWED.has(type)) type = TileType.Tundra;

      const tile: MapTile = {
        coord,
        type,
        height: TERRAIN_HEIGHT[type],
        explored: false,
        // Haunted until a road reaches it. That is the honest starting state:
        // the roads are what carve safety out of the world, not the other way
        // round, and `assignZones` below rewrites every tile either way.
        zone: 'haunted',
        ...(frost ? { frost: true } : {}),
      };

      tiles.push(tile);
      tileMap.set(hexKey(coord), tile);
    }
  }

  // Place city at center
  const cityKey = hexKey(cityCoord);
  const cityTile = tileMap.get(cityKey);
  if (cityTile) {
    cityTile.poi = world.homePoi;
    // Ensure the city sits on walkable, level terrain
    if (!isLevelGround(cityTile.type)) flatten(cityTile);
    // Clear water and high ground from the city's doorstep. Highlands count as
    // high ground here: the gate has to open onto somewhere a level-1 party can
    // walk in every direction, and a shoulder of rock across the road is a
    // climb rather than a road.
    for (const hex of getHexesInRange(cityCoord, 2)) {
      const t = tileMap.get(hexKey(hex));
      if (t && !isLevelGround(t.type)) flatten(t);
    }
  }

  // Threat bands. Computed for every tile including water and mountain: a tile
  // the party cannot enter still has neighbours that read from it, and leaving
  // holes would make the gradient depend on terrain noise.
  for (const tile of tiles) {
    tile.threat = threatAt(tile.coord, cityCoord, castleCoord, world.threat);
  }

  // The castle itself, and the road it marched down.
  //
  // Both are placed *before* the POI shuffle so neither can be overwritten by a
  // quest site, and both force their terrain walkable: a castle behind a
  // mountain range or a road that dead-ends in a lake would be a generated map
  // quietly cancelling the endgame.
  const castleTile = world.farPoi ? tileMap.get(hexKey(castleCoord)) : undefined;
  if (castleTile && world.farPoi) {
    castleTile.poi = world.farPoi;
    castleTile.threat = 4;
    // Level ground, not merely passable: `isPassable` stopped excluding
    // mountains when they became walkable, so this check alone would happily
    // leave the castle on a peak — reachable only across a highland shoulder
    // that may not exist, and the endgame behind it. A range's summit is cut
    // to a shoulder instead: it is the top of the climb, and still reachable.
    if (world.terrain === 'range') {
      // The summit stands on a shoulder of its own, so the crown's peaks ring
      // it rather than standing over it.
      for (const hex of getHexesInRange(castleCoord, 1)) {
        const t = tileMap.get(hexKey(hex));
        if (t) cutStep(t);
      }
    } else if (!isLevelGround(castleTile.type)) flatten(castleTile);
    // The castle is visible from the first turn — it is a threat, not a secret
    castleTile.explored = true;
    for (const hex of getHexesInRange(castleCoord, 1)) {
      const t = tileMap.get(hexKey(hex));
      if (t) t.explored = true;
    }
  }

  // The shrines are stops on the pilgrim road, so they stand before it is cut.
  const shrines = world.content.shrines > 0
    ? placeShrines(tiles, tileMap, cityCoord, castleCoord, rng, world)
    : [];

  carveRoadNetwork(tileMap, cityCoord, castleCoord, rng, world, shrines);

  // After every pass that rewrites terrain, and before anything reads it: the
  // city clearing, the castle and the road all flatten tiles, and any of them
  // can strand a peak that had an approach a moment earlier.
  openMountainApproaches(tiles, tileMap);

  // The shape of the world, and everything downstream depends on it: which
  // ground is quiet, which is hunted, and — through `ensureHomeHaunted` —
  // whether a new party can find a fight in its first ten minutes. After the
  // approaches pass, so no later demotion can move a tile between zones.
  const roadDistance = assignZones(tiles, tileMap, cityCoord, rng, world.zones);
  ensureHomeHaunted(tiles, cityCoord, roadDistance, rng, world.zones);
  // The Emperor's doorstep is never quiet ground: everything off the road around
  // the castle is haunted, though its road stays the one safe way in
  const farHaunted = world.zones.farHauntedRadius;
  if (farHaunted > 0) {
    for (const hex of getHexesInRange(castleCoord, farHaunted)) {
      const t = tileMap.get(hexKey(hex));
      if (t && t.zone !== 'road' && !t.poi) t.zone = 'haunted';
    }
  }

  // People, before anything else claims ground. A wayside is the only POI on
  // the map that is not a fight, a resource or a door, and it has to be placed
  // against terrain that has stopped moving — hence after the approaches pass,
  // and before the shuffled pool that every other POI is dealt from (which
  // skips tiles already carrying a `poi`, so no later pass can land on one).
  if (world.content.waysides) placeWaysides(tiles, tileMap, cityCoord, rng);

  // Place POIs on **haunted** tiles away from the city.
  //
  // This is the deal the whole structure is built on: the road is safe and
  // pays nothing, and every lair door, ore vein, magic well and quest site is
  // out past the corridor's edge. A find beside a road would be free
  // money for staying on the safe route, which is precisely the decision the
  // zones exist to make expensive.
  //
  // Highlands are eligible now that they are walkable; **peaks still are not**.
  // A quest site or a lair door on a mountain is reachable only across a
  // highland shoulder, and the lair gate is load-bearing — `lairs.test.ts` pins
  // that every boss can be walked to. Ore is the deliberate exception below.
  const passable = tiles.filter(
    (t) =>
      isPassable(t.type) &&
      t.type !== TileType.Mountain &&
      !t.poi &&
      t.zone === 'haunted' &&
      hexDistance(t.coord, cityCoord) > 4 &&
      // The castle's haunted ring is its own guard, not ground for a lair door or a find
      hexDistance(t.coord, castleCoord) > farHaunted
  );

  // Shuffle passable tiles
  for (let i = passable.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    [passable[i], passable[j]] = [passable[j], passable[i]];
  }

  let poiIndex = 0;

  // Quest sites — exactly 3 places to fight. They pay ordinary combat rewards and
  // no opening: openings come only from quest `unlocksHero`, which is the
  // recruitment curve (see quests-progression-items.md).
  const questCount = world.content.questSites ? 3 : 0;
  for (let i = 0; i < questCount && poiIndex < passable.length; i++) {
    const tile = passable[poiIndex++];
    tile.poi = POIType.QuestSite;
    tile.questId = `quest_${i}`;
  }

  // No resource nodes: ore, wood and gold lie on the map as weekly finds dealt by
  // `systems/world/finds.ts`, not as places fixed at generation.

  // Boss tiles — exactly one per lair, no more.
  //
  // This used to be a density figure, which put six tiles on a 70x70 map for
  // three bosses and placed each of them twice. A lair is a *place*, so the
  // count is the number of places there are.
  //
  // Doors follow progression: prefer their band's nearest fitting terrain,
  // reachable without crossing a harder band. The Hollow stands on red rock and
  // the ice lair in the frozen north, and a lair with a site never falls back
  // to other ground: no fitting tile throws, like a quest site, and the seed
  // sweep in `lairs.test.ts` is what keeps that from happening.
  // A lair with no site takes its band's nearest door; it never sends the first
  // lair to the map's end.
  const farFree = (t: MapTile) => !t.poi && hexDistance(t.coord, cityCoord) >= BALANCE.LAIR_DOOR_MIN_DISTANCE;
  for (const spec of world.content.lairs ? lairsOf(world.id) : []) {
    // Every step to a door must be within that lair's difficulty, not just the
    // door itself. Pick the earliest reachable fitting ground in its band.
    const reachable = reachableFromCity(cityCoord, tileMap, spec.band);
    const candidates = passable.filter((t) => farFree(t) && reachable.has(hexKey(t.coord)));
    candidates.sort((a, b) =>
      Math.abs((a.threat ?? 0) - spec.band) - Math.abs((b.threat ?? 0) - spec.band)
      || hexDistance(a.coord, cityCoord) - hexDistance(b.coord, cityCoord));
    const tile = spec.site ? candidates.find((t) => onSite(t, spec.site)) : candidates[0];
    if (!tile) {
      if (spec.site) throw new Error(`No reachable ground for the door of ${spec.id}`);
      continue;
    }
    tile.poi = POIType.BossTile;
    // The id names the lair rather than an encounter: walking onto the tile
    // opens a dungeon now, and the fights inside carry their own ids
    tile.encounterId = spec.id;
  }

  // Magic wells — nine on a 70×70 map, spread across it, kept away from the city.
  //
  // This loop *skips* a candidate that is too close to a well already placed
  // rather than looking harder for one that is not, so the count it delivers is
  // a floor-and-hope rather than the target: `MAGIC_WELL_MIN_SPREAD` is a silent
  // second cap on it, and the only honest way to know what a density change
  // produces is to generate maps and count. Nine of nine on twelve seeds today.
  const wellTarget = Math.round((tiles.length / 1000) * BALANCE.POI_PER_1000_TILES.magicWell);
  const wellCount = Math.max(BALANCE.MAGIC_WELL_COUNT_MIN, wellTarget);
  const wellCoords: HexCoord[] = [];
  // Work through remaining passable candidates rather than continuing the shared index
  // so boss placement gaps don't accidentally skip good well spots
  const wellCandidates = passable.slice().filter(
    (t) => !t.poi && hexDistance(t.coord, cityCoord) > 5
  );
  for (const candidate of wellCandidates) {
    if (wellCoords.length >= wellCount) break;
    const tooClose = wellCoords.some(
      (wc) => hexDistance(wc, candidate.coord) < BALANCE.MAGIC_WELL_MIN_SPREAD
    );
    if (tooClose) continue;
    candidate.poi = POIType.MagicWell;
    wellCoords.push(candidate.coord);
  }

  // Reveal around city start
  for (const hex of getHexesInRange(cityCoord, BALANCE.FOG_REVEAL_RADIUS)) {
    const t = tileMap.get(hexKey(hex));
    if (t) t.explored = true;
  }

  if (world.content.questSites) placeQuestSites(tiles, tileMap, cityCoord);
  // Last, and drawing nothing from the stream: the gate only sets one tile's
  // `poi`, so every road, door, well and reveal above is what it always was.
  if (world.content.gate) placeWorldGate(tiles, tileMap, cityCoord, castleCoord);
  // Also last and also drawing nothing: a village only sets its own tile's
  // `poi` and `village`, so no other POI, find or tile moves for a seed.
  if (world.content.villages) placeVillages(seed, tiles, tileMap, cityCoord, castleCoord);
  // Last of all, once no pass can move terrain: the ground a range tile wears,
  // and the passes — the first road hex of each harder band the road climbs into.
  if (world.terrain === 'range') {
    for (const tile of tiles) {
      const ground = jadeGround(tile);
      if (ground) tile.jade = ground;
      else delete tile.jade;
    }
    for (const tile of tiles) {
      if (tile.zone !== 'road' || tile.poi) continue;
      const below = getNeighbors(tile.coord).some((n) => {
        const t = tileMap.get(hexKey(n));
        return !!t && t.zone === 'road' && (t.threat ?? 0) < (tile.threat ?? 0);
      });
      if (below) tile.pass = true;
    }
  }
  return tiles;
}

/**
 * Cut a road or the summit into a range without levelling it: a peak becomes
 * a shoulder and a tarn a causeway, and a shoulder stays one. Every step along
 * such a road is at most plains to highlands — inside `MAX_CLIMB` — so the
 * road climbs the range rather than paving a flat strip through it.
 */
function cutStep(tile: MapTile): void {
  if (tile.type === TileType.Mountain) {
    tile.type = TileType.Highlands;
    tile.height = TERRAIN_HEIGHT[TileType.Highlands];
  } else if (tile.type === TileType.Water) {
    flatten(tile);
  }
}

/** Signed distance of a hex from the line between two anchors, in columns and rows. */
function lateralOffset(coord: HexCoord, home: HexCoord, far: HexCoord): number {
  const hx = home.q + Math.floor(home.r / 2), hy = home.r;
  const fx = far.q + Math.floor(far.r / 2), fy = far.r;
  const dx = fx - hx, dy = fy - hy;
  const x = coord.q + Math.floor(coord.r / 2) - hx, y = coord.r - hy;
  return (x * dy - y * dx) / Math.hypot(dx, dy);
}

/**
 * The shrines of a range: one in each band above the foothills, climbing.
 *
 * Shrine `i` stands in band `i`, on ground the camp can walk to without
 * crossing a harder band — the lair doors' rule — and at least
 * `SHRINE_MIN_SPREAD` from every shrine below it. Of those, the hex nearest the
 * middle of its band's ascent, pushed to alternate sides of the camp-to-summit
 * line so the road up switches back rather than running straight. Each is
 * level ground with shrine ground on the level hexes round it, and lit from the
 * start: the chain is the way up, and a destination in the mist is not one.
 *
 * A shrine whose keepers are locked to a ground (`Faction.homeLocked`) stands on
 * it, as the Fallen Order's terraces do, and keeps that terrain rather than being
 * flattened to plains. Where none fits the generator throws instead of putting
 * the keepers on foreign ground.
 */
function placeShrines(
  tiles: MapTile[],
  tileMap: Map<string, MapTile>,
  home: HexCoord,
  far: HexCoord,
  rng: ReturnType<typeof createRNG>,
  world: WorldDef,
): HexCoord[] {
  const placed: HexCoord[] = [];
  for (let i = 1; i <= world.content.shrines; i++) {
    const keepers = findFaction(SHRINE_KEEPERS[i]);
    const bound = keepers?.homeLocked ? keepers : undefined;
    const candidates = (band: number, wade = false) => {
      const reachable = reachableFromCity(home, tileMap, band, wade);
      return tiles.filter((t) => t.threat === band && !t.poi && reachable.has(hexKey(t.coord))
        && t.type !== TileType.Water && t.type !== TileType.Mountain
        && (!bound || atHome(bound, t.type, !!t.frost))
        && hexDistance(t.coord, far) >= BALANCE.SHRINE_MIN_SPREAD && hexDistance(t.coord, home) > 4
        && placed.every((p) => hexDistance(p, t.coord) >= BALANCE.SHRINE_MIN_SPREAD));
    };
    const band = Math.min(4, i);
    let inBand = candidates(band);
    // Keepers bound to a ground may be reached across a tarn before the map gives
    // up: the road up cuts a causeway through it (`cutStep`). With the camp in the
    // corner (playtest 2026-10-23) a seed can ring the terraces' band with water
    if (inBand.length === 0 && bound) inBand = candidates(band, true);
    if (inBand.length === 0) {
      if (bound) throw new Error(`No reachable ${bound.terrain.join('/')} ground for shrine ${i}`);
      continue;
    }
    const rise = inBand.map((t) => ascent(t.coord, world)).sort((a, b) => a - b);
    const middle = rise[Math.floor(rise.length / 2)];
    const side = (i % 2 === 1 ? 1 : -1) * BALANCE.SHRINE_SWITCHBACK;
    const score = new Map(inBand.map((t) => [
      t,
      Math.abs(ascent(t.coord, world) - middle) * 20 + Math.abs(lateralOffset(t.coord, home, far) - side) + rng.next() * 0.5,
    ] as const));
    inBand.sort((a, b) => score.get(a)! - score.get(b)!);
    const tile = inBand[0];
    if (bound) tile.height = TERRAIN_HEIGHT[tile.type];
    else flatten(tile);
    tile.poi = POIType.Shrine;
    tile.shrine = i;
    for (const hex of getHexesInRange(tile.coord, 1)) {
      const t = tileMap.get(hexKey(hex));
      if (!t) continue;
      t.explored = true;
      if (isLevelGround(t.type) || t === tile) t.jade = 'shrine';
    }
    placed.push(tile.coord);
  }
  return placed;
}

/**
 * The Empire's door to the next world: a road hex on the eastern frontier.
 *
 * **Not the castle.** The gauntlet is a four-fight run in a scene that never
 * unmounts, and hanging world travel off its door would tangle two mechanics
 * that fail in different ways. So the gate is its own POI, kept
 * `WORLD_GATE_MIN_CASTLE_DISTANCE` from the castle, on level road the city can
 * walk to, with a free hex beside it to step out onto on the way back. Of
 * those, the easternmost in bands 2–3 — the far side of the map from home that
 * is not the Legion's ground — and failing that the reachable road hex
 * furthest from the city. Deterministic, with no draw from the generator.
 */
function placeWorldGate(
  tiles: MapTile[],
  tileMap: Map<string, MapTile>,
  city: HexCoord,
  castle: HexCoord,
): void {
  const reachable = reachableFromCity(city, tileMap);
  const steppable = (t: MapTile) => getNeighbors(t.coord).some((n) => {
    const next = tileMap.get(hexKey(n));
    return !!next && !next.poi && movementCost(t, next) !== null;
  });
  const fits = tiles.filter((t) =>
    !t.poi && t.zone === 'road' && isLevelGround(t.type)
    && reachable.has(hexKey(t.coord))
    && hexDistance(t.coord, castle) >= BALANCE.WORLD_GATE_MIN_CASTLE_DISTANCE
    && steppable(t));
  const column = (t: MapTile) => t.coord.q + t.coord.r / 2;
  const frontier = fits.filter((t) => (t.threat ?? 0) >= 2 && (t.threat ?? 0) <= 3);
  const pick = frontier.length > 0
    ? frontier.reduce((best, t) => (column(t) > column(best) || (column(t) === column(best) && t.coord.r < best.coord.r) ? t : best))
    : fits.reduce<MapTile | undefined>((best, t) =>
      !best || hexDistance(t.coord, city) > hexDistance(best.coord, city) ? t : best, undefined);
  if (pick) pick.poi = POIType.WorldGate;
}

/**
 * The four villages, one per theme, off the road and in the city's movement
 * component (`data/villages.ts`).
 *
 * Drawn from no random stream, like the gate: each theme takes the free tile
 * whose share of the way from home to the castle is nearest its ring's band,
 * ties broken by position. A village stands 1–2 hexes off a road, so a visit is
 * a short detour, and keeps clear of the other villages. A tile that is already
 * a POI is never taken, so nothing placed earlier moves.
 */
function placeVillages(
  seed: number,
  tiles: MapTile[],
  tileMap: Map<string, MapTile>,
  city: HexCoord,
  castle: HexCoord,
): void {
  const reachable = reachableFromCity(city, tileMap);
  const total = hexDistance(city, castle);
  const { min, max } = BALANCE.VILLAGE_ROAD_OFFSET;
  const offRoad = (t: MapTile) => {
    if (t.zone === 'road') return false;
    for (let d = min; d <= max; d++) {
      if (getHexesInRange(t.coord, d).some((h) => hexDistance(h, t.coord) === d && tileMap.get(hexKey(h))?.zone === 'road')) {
        return true;
      }
    }
    return false;
  };
  const stands: HexCoord[] = [];
  for (const spec of VILLAGES) {
    const [low, high] = villageRouteShare(spec);
    const share = (t: MapTile) => hexDistance(t.coord, city) / total;
    const miss = (t: MapTile) => Math.max(low - share(t), share(t) - high, 0);
    const lean = (t: MapTile) => spec.ring === 'far'
      ? Math.floor(hexDistance(t.coord, castle) / BALANCE.VILLAGE_LEAN_STEP)
      : Math.floor(Math.abs(share(t) - (low + high) / 2) * total / BALANCE.VILLAGE_LEAN_STEP);
    // A hash of the seed and the tile, not a draw: the generator's stream is untouched
    const spread = (t: MapTile) => Math.imul(seed ^ Math.imul(t.coord.q + 1013, 73856093) ^ Math.imul(t.coord.r + 2027, 19349663), 2654435761) >>> 0;
    const candidates = tiles.filter((t) =>
      !t.poi && isLevelGround(t.type) && reachable.has(hexKey(t.coord)) && offRoad(t)
      && stands.every((s) => hexDistance(s, t.coord) >= BALANCE.VILLAGE_MIN_SPACING));
    candidates.sort((a, b) =>
      miss(a) - miss(b)
      // Within the band the far ring leans toward the castle's side of the map and the
      // near ring sits mid-band, each in coarse steps; the seed's hash picks inside a step
      || lean(a) - lean(b)
      || spread(a) - spread(b)
      || a.coord.r - b.coord.r || a.coord.q - b.coord.q);
    const tile = candidates[0];
    if (!tile) throw new Error(`No reachable ground for the ${spec.theme} village`);
    tile.poi = POIType.Village;
    tile.village = spec.theme;
    stands.push(tile.coord);
  }
}

/** Place authored destinations only in the city's actual movement component. */
function placeQuestSites(tiles: MapTile[], tileMap: Map<string, MapTile>, city: HexCoord): void {
  const reachable = reachableFromCity(city, tileMap);
  for (const id of Object.keys(QUEST_SITES) as QuestSiteId[]) {
    const site = QUEST_SITES[id];
    // A north disabled by the map tuning harness has no northern destinations.
    if (site.terrain === TileType.Tundra && BALANCE.FROST_DEPTH <= 0) continue;
    const anchor = tiles.find(t => t.npcId === site.near)?.coord ?? city;
    const candidates = tiles.filter(t => !t.poi && t.zone === 'haunted' && t.type === site.terrain
      && reachable.has(hexKey(t.coord)) && hexDistance(t.coord, city) > 4);
    candidates.sort((a, b) => hexDistance(a.coord, anchor) - hexDistance(b.coord, anchor));
    const tile = candidates[0];
    if (!tile) throw new Error(`No reachable ground for ${id}`);
    tile.poi = POIType.QuestSite;
    tile.questId = id;
  }
}

/** Whether a tile is ground a lair's door may stand on — see `LairSite`. */
export function onSite(tile: MapTile, site: LairSite | undefined): boolean {
  if (!site) return true;
  if (site.terrain && !site.terrain.includes(tile.type)) return false;
  if (site.frozen !== undefined && !!tile.frost !== site.frozen) return false;
  return true;
}

/**
 * Where each person who lives outside the walls belongs.
 *
 * Terrain first, because that is the whole reason they read as somebody rather
 * than as a marker: a trapper is at a treeline, a hermit is in the reeds, a
 * prospector is on a shoulder of rock. Then a band window, so the walk to them
 * is the right size of dangerous for the level their quests open at. Then a
 * distance window from the city, which is what actually paces the trip.
 *
 * The prospector is deliberately on `Highlands` and never on `Mountain`. A peak
 * is reachable only across a shoulder that may not exist on a given seed, and a
 * quest-giver you cannot walk to is two quests that do not exist — the same
 * argument that keeps lair doors off summits.
 */
interface WaysideSpec {
  npc: NpcId;
  terrain: TileType[];
  /** Inclusive threat-band window. */
  band: [number, number];
  /** Inclusive distance-from-city window, in hexes. */
  distance: [number, number];
}

/**
 * The windows are tight, and the order they are written in is the order their
 * quests open: the trapper carries summed level 3–4 and sits inside the home
 * band, the hermit carries 6–9 and sits at the edge of it, the prospector
 * carries 10–14 and is a genuine expedition. A camp at 26 hexes is half a day
 * out and half a day back for a hero whose quest opened at summed level 6.
 */
const WAYSIDE_SPECS: WaysideSpec[] = [
  { npc: 'huntsman',   terrain: [TileType.Forest],     band: [0, 1], distance: [5, 11] },
  { npc: 'fen_hermit', terrain: [TileType.Swamp],      band: [1, 2], distance: [8, 20] },
  { npc: 'prospector', terrain: [TileType.Highlands],  band: [1, 2], distance: [8, 24] },
];

/** How far apart two camps must sit, so the map does not read as one hamlet. */
const WAYSIDE_SPREAD = 6;

/**
 * Every tile the party could actually walk to, over the real cost function.
 *
 * Not a nicety. `movementCost` refuses water outright and refuses a step of
 * more than `MAX_CLIMB`, so a swamp on the far side of a lake and a shoulder
 * with no approach are both places a camp can be generated and never visited.
 * A find in one of those is a missed pickup; a quest-giver in one is a
 * branch of the quest tree that silently does not exist.
 */
export function reachableFromCity(city: HexCoord, tileMap: Map<string, MapTile>, maxThreat = 4, wade = false): Set<string> {
  const seen = new Set<string>();
  const start = tileMap.get(hexKey(city));
  if (!start) return seen;

  seen.add(hexKey(city));
  const queue: MapTile[] = [start];
  // Index rather than `shift()`: this walks most of a 4,900-tile map, and
  // shifting an array that long is quadratic for no reason.
  for (let head = 0; head < queue.length; head++) {
    const from = queue[head];
    for (const n of getNeighbors(from.coord)) {
      const key = hexKey(n);
      if (seen.has(key)) continue;
      const to = tileMap.get(key);
      if (!to || (to.threat ?? 0) > maxThreat) continue;
      // Wading counts a tarn as ground a road will causeway, and nothing else
      const tarn = wade && (to.type === TileType.Water || from.type === TileType.Water) && to.type !== TileType.Mountain;
      if (!tarn && movementCost(from, to) === null) continue;
      seen.add(key);
      queue.push(to);
    }
  }
  return seen;
}

/**
 * Puts the three map-dwelling NPCs somewhere they belong, and failing that,
 * somewhere at all.
 *
 * The tiers below relax one condition at a time — terrain, then band, then the
 * distance window — because every relaxation is a worse camp and *not placing
 * one* is not a worse camp, it is a person who does not exist and two quests
 * that can never be taken. Terrain goes first because it is the cosmetic half;
 * reachability is never relaxed, for the same reason.
 *
 * The chosen tile is revealed along with its neighbours. Somebody standing by
 * the road with a lamp is not hiding, and a quest that says "go and find Rell"
 * pointing into unexplored fog is the four-in-game-weeks-looking-for-wolves
 * failure wearing a different hat. The *figure* still only draws inside
 * `PROP_RENDER_RADIUS`, so what the player gets from across the map is a lit
 * tile, not a spoiled one.
 */
function placeWaysides(
  tiles: MapTile[],
  tileMap: Map<string, MapTile>,
  city: HexCoord,
  rng: ReturnType<typeof createRNG>,
): void {
  const open = reachableFromCity(city, tileMap);
  const placed: HexCoord[] = [];

  // Roads are no longer excluded — they are *preferred*, in the tier chain
  // below. A trapper, a hermit and a prospector are the only people on the map
  // outside the city, and people live where the traffic is.
  const free = (t: MapTile) =>
    !t.poi && open.has(hexKey(t.coord)) &&
    placed.every((p) => hexDistance(p, t.coord) >= WAYSIDE_SPREAD);

  for (const spec of WAYSIDE_SPECS) {
    const band = (t: MapTile) => {
      const b = t.threat ?? 0;
      return b >= spec.band[0] && b <= spec.band[1];
    };
    const near = (t: MapTile) => {
      const d = hexDistance(t.coord, city);
      return d >= spec.distance[0] && d <= spec.distance[1];
    };

    /**
     * Road first, then terrain, then band, then distance — and reachability is
     * never relaxed at all.
     *
     * The road tiers are new and sit on top, because a camp on the road is what
     * makes these three read as *people* rather than as markers: somebody set up
     * where travellers pass. But they are a preference and not a requirement —
     * the branches are short and a spec asking for a treeline in band 2 may
     * simply have no road answering that description, and **not placing a
     * wayside is a person who does not exist and two quests that can never be
     * taken.** A worse camp is only a worse camp.
     */
    const onRoad = (t: MapTile) => t.zone === 'road';
    const tiers: ((t: MapTile) => boolean)[] = [
      (t) => onRoad(t) && spec.terrain.includes(t.type) && band(t) && near(t),
      (t) => onRoad(t) && band(t) && near(t),
      (t) => onRoad(t) && near(t),
      (t) => spec.terrain.includes(t.type) && band(t) && near(t),
      (t) => spec.terrain.includes(t.type) && near(t),
      (t) => isLevelGround(t.type) && band(t) && near(t),
      (t) => isLevelGround(t.type) && near(t),
      (t) => isPassable(t.type) && t.type !== TileType.Mountain,
    ];

    let chosen: MapTile | undefined;
    for (const accepts of tiers) {
      const candidates = tiles.filter((t) => free(t) && accepts(t));
      if (candidates.length === 0) continue;
      chosen = candidates[rng.nextInt(0, candidates.length - 1)];
      break;
    }
    if (!chosen) continue;

    chosen.poi = POIType.Wayside;
    chosen.npcId = spec.npc;
    placed.push(chosen.coord);

    for (const hex of getHexesInRange(chosen.coord, 1)) {
      const t = tileMap.get(hexKey(hex));
      if (t) t.explored = true;
    }
  }
}


/**
 * Scorches a path from the castle toward the city.
 *
 * Signposting without a UI element: a player who has never opened a menu can see
 * which way the Legion came from, and the road gets darker and busier the closer
 * it runs to the corner. It stops short of the city because the castle's army
 * never reached it — that is the whole premise.
 *
 * Every road tile is forced walkable. The road is also a genuine shortcut into
 * dangerous ground, which is the trade it offers: fast travel toward the worst
 * part of the map.
 */
/** Lay one tile of road, forcing it walkable. */
function pave(tileMap: Map<string, MapTile>, coord: HexCoord, climbs = false): void {
  const tile = tileMap.get(hexKey(coord));
  if (!tile) return;

  tile.zone = 'road';
  // A range's road climbs: it cuts peaks to shoulders and keeps the shoulders.
  if (climbs) {
    if (!tile.poi) cutStep(tile);
    return;
  }
  // A road is a road: the Legion did not march its siege train over a col.
  // Level ground rather than merely passable, so the route stays walkable end to
  // end whatever the noise put under it. A POI has already been placed and
  // flattened by whoever placed it — reflattening would move the city.
  if (!tile.poi && !isLevelGround(tile.type)) flatten(tile);
}

/**
 * A route between two points that does not look drawn with a ruler.
 *
 * The road this replaces was a lerp in axial space, which is a straight line
 * across a noise field and reads as the single most artificial thing on the map.
 * This walks the same span as a chain of waypoints pushed sideways by up to
 * `ROAD_WANDER`, joined with `getHexLine` — so the track bends around nothing in
 * particular, the way a real one does.
 *
 * A jittered waypoint that lands off the map falls back to its un-jittered
 * position rather than being skipped. Skipping would leave the segment either
 * side of it joined by a line that leaves the map and comes back, which is a
 * **gap in the road** — and the whole point of the network is that it is
 * continuous.
 */
function wanderingRoute(
  tileMap: Map<string, MapTile>,
  from: HexCoord,
  to: HexCoord,
  rng: ReturnType<typeof createRNG>,
): HexCoord[] {
  const span = hexDistance(from, to);
  if (span === 0) return [from];

  const segments = Math.max(1, Math.round(span / BALANCE.ROAD_SEGMENT));
  const waypoints: HexCoord[] = [from];

  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const straight: HexCoord = {
      q: Math.round(from.q + (to.q - from.q) * t),
      r: Math.round(from.r + (to.r - from.r) * t),
    };

    // Perpendicular-ish to the run, in axial space. Exactness does not matter —
    // what matters is that the push is across the route rather than along it,
    // or the road would concertina instead of bending.
    const dq = to.q - from.q;
    const dr = to.r - from.r;
    const swing = (rng.next() * 2 - 1) * BALANCE.ROAD_WANDER;
    const norm = Math.max(1, Math.hypot(dq, dr));
    const jittered: HexCoord = {
      q: Math.round(straight.q + (-dr / norm) * swing),
      r: Math.round(straight.r + (dq / norm) * swing),
    };

    waypoints.push(tileMap.has(hexKey(jittered)) ? jittered : straight);
  }
  waypoints.push(to);

  const route: HexCoord[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const leg = getHexLine(waypoints[i], waypoints[i + 1]);
    // Drop each leg's first hex except the very first: it is the previous leg's
    // last, and paving it twice is harmless but counting it twice is not.
    route.push(...(i === 0 ? leg : leg.slice(1)));
  }
  return route;
}

/**
 * The road network: one artery, and branches that go somewhere.
 *
 * The artery runs city ↔ Obsidian castle **the whole way** now. It used to stop
 * at `ROAD_REACH` (0.72) on the premise that the Legion outran its supply lines
 * and never reached the city — but a road is infrastructure before it is a
 * scar, and the network's job is to be the thing you navigate by. What keeps
 * the Obsidian Road's identity is its look: `ROAD_DISPLAY` is ash, and the
 * stretch nearest the castle still reads as the route an army came down.
 *
 * **Branches used to dead-end, on purpose, and that was wrong.** The argument
 * for it is still written down and still sounds right: a network where every
 * road leads somewhere is a map with no frontier, and a branch stopping in the
 * middle of nowhere is the safe ground stopping with it. What that argument
 * misses is that a road is a made thing — somebody built it, to get somewhere —
 * so a track that simply stops in open grass does not read as a frontier, it
 * reads as **unfinished generation**, which is exactly what a playtest reported.
 * The second half of the report is the harder one: with every leg rolled at
 * eight to twenty-two hexes and then petering out, the far half of the map had
 * no infrastructure of any kind, so deep haunted country was a forty-hex walk at
 * full price in both directions and nobody went.
 *
 * So a branch now **terminates on something real**: the first road it meets past
 * `ROAD_BRANCH_MIN` — the artery, or a branch carved before it — or, failing
 * that, the edge of the world. Nothing else is available at this point in
 * generation. A wayside camp would be the obvious third terminus and is
 * deliberately *not* one: `placeWaysides` runs several passes after this, since
 * it has to wait for terrain to stop moving and it *prefers* roads, so there is
 * not one placed yet to aim at. Aiming at a POI would mean reordering two passes
 * that both depend on this one having run.
 *
 * The frontier survives, in the honest place: it is the **ground between the
 * roads** rather than the point at which one gives up. That is the trade, and it
 * is a real cost — the map reads less like a wilderness with one scar through it
 * and more like a country with country in between. `zones.test.ts` pins both
 * halves: haunted ground stays the clear majority, and no road tile is a dead
 * end anywhere but the map edge, the city, the castle or a POI.
 */
function carveRoadNetwork(
  tileMap: Map<string, MapTile>,
  city: HexCoord,
  castle: HexCoord,
  rng: ReturnType<typeof createRNG>,
  world: WorldDef,
  stops: HexCoord[] = [],
): void {
  const climbs = world.terrain === 'range';
  // The artery runs through every stop in order — a range's shrines — so the
  // pilgrim road is the way up. With no stops it is the one route it was.
  const legs = [city, ...stops, castle];
  const artery: HexCoord[] = [];
  for (let i = 0; i < legs.length - 1; i++) {
    const leg = wanderingRoute(tileMap, legs[i], legs[i + 1], rng);
    artery.push(...(i === 0 ? leg : leg.slice(1)));
  }
  for (const coord of artery) pave(tileMap, coord, climbs);

  /**
   * Cast outward from `root` on a fixed bearing and report what the leg should
   * end on.
   *
   * Straight, deliberately — this only picks the *terminus*, and `wanderingRoute`
   * still walks the leg there as a chain of jittered waypoints, so the road that
   * comes out bends the way it always did. Choosing the endpoint on a bend
   * instead would mean re-deciding it every waypoint, which is a pathfinder, and
   * a road that finds its own way to the nearest other road is a road that hugs
   * it.
   *
   * Two outcomes, in the order they are checked:
   *
   * - **A road at or past `ROAD_BRANCH_MIN`.** Nearer than that and the fork
   *   rejoins its own parent two hexes along, which is a lay-by rather than a
   *   branch — and the first few hexes off any root are the parent road.
   *   Deliberately **unbounded above**: the old roll had a maximum, and capping
   *   the search at it would mean refusing a road at hex 23 and then running the
   *   leg past it to the edge anyway. The bearing decides how long a branch is,
   *   which is what makes the ones pointing away from the network — into the
   *   country with nothing in it — the long ones.
   * - **The map edge** — and the target handed back is the first hex *past* it,
   *   off the map, with the truncation below deciding where the pavement
   *   actually stops. Returning the last on-map hex of the cast instead is the
   *   obvious spelling and it is wrong: the cast advances by `round(cos·d)` in
   *   two axes at once, so it can step diagonally over the boundary from a hex
   *   two rows inside it, and a leg ending there is an interior dead end with
   *   nothing to show it was meant to be an edge. Aiming past the boundary makes
   *   the hex line walk out to it. A road running off the edge of the world is a
   *   road to somewhere the game does not model, which is a perfectly good
   *   reason for it to be there. This is where the long roads into deep country
   *   come from, and it is the half of the change the player actually asked for.
   *
   * The cast is bounded by the map's own span rather than by a length, because
   * at least one of `cos`/`sin` always exceeds 0.7 — every step moves, so a cast
   * that long has left a 70×70 map whatever bearing it took. The loop cannot run
   * out without an answer.
   */
  const aimBranch = (root: HexCoord, angle: number): HexCoord => {
    const reach = world.width + world.height;
    let step: HexCoord = root;
    for (let d = 1; d <= reach; d++) {
      step = {
        q: Math.round(root.q + Math.cos(angle) * d),
        r: Math.round(root.r + Math.sin(angle) * d),
      };
      const tile = tileMap.get(hexKey(step));
      if (!tile) return step;
      if (d >= BALANCE.ROAD_BRANCH_MIN && tile.zone === 'road') {
        return step;
      }
    }
    return step;
  };

  /**
   * Fork a road off `from`, pave it, and hand back what it covered.
   *
   * `at` is where along the parent to fork, as a fraction. The artery's branches
   * are **spread evenly** along it rather than rooted at random: uniform roots
   * clump, and a clump is a stretch of artery with no side roads — which showed
   * up as the home ring swinging between 16% and 71% haunted from seed to seed,
   * depending on whether the dice happened to put a branch near the city. The
   * early game should not be that different between two saves.
   */
  const branchFrom = (from: HexCoord[], at = rng.next()): HexCoord[] => {
    const span = Math.max(1, from.length - 2);
    // Jittered inside its own slice, so "evenly spread" does not read as regular
    const index = Math.min(span, Math.max(1, Math.round(at * span)));
    const root = from[index];
    const angle = rng.next() * Math.PI * 2;
    const end = aimBranch(root, angle);

    /**
     * Truncated at the first hex that is not on the map, and that is what makes
     * "ends on the edge" true rather than approximately true.
     *
     * `wanderingRoute` pushes its waypoints sideways by up to `ROAD_WANDER`, and
     * the map is a parallelogram in axial space with a staircase along two of
     * its sides — so a leg aimed at a tile one hex inside the boundary can still
     * bulge over it and come back. `pave` skips a hex it cannot find, so the
     * untruncated route would leave a **gap** and the road either side of it
     * would be two dead ends rather than one edge.
     */
    const full = wanderingRoute(tileMap, root, end, rng);
    const off = full.findIndex((coord) => !tileMap.has(hexKey(coord)));
    const route = off === -1 ? full : full.slice(0, off);
    for (const coord of route) pave(tileMap, coord, climbs);
    return route;
  };

  /**
   * One generation of branches, where there used to be two.
   *
   * The second existed because one was a spine with bristles rather than a
   * network: every leg hung off the artery, forked nothing and stopped, so the
   * only junction on the map was where a branch met its own parent. That is no
   * longer how a leg ends. A branch terminates on the **first road it meets**,
   * and the roads it can meet include the eleven others rooted along the artery
   * — so a T-junction is now what *finishing* looks like, and the network forks
   * and forks again without a pass whose whole job was to make it.
   *
   * `ROAD_SUBBRANCHES` went with the loop rather than to zero. A constant that
   * disables a code path is a code path nobody can tell is dead, and the next
   * person to raise it from 0 would be re-adding second-generation legs on top
   * of a rule that already produces the forks they were for.
   */
  for (let i = 0; i < world.zones.roadBranches; i++) {
    // Slice i of N, jittered inside its own slice: spread without regularity.
    branchFrom(artery, (i + rng.next()) / world.zones.roadBranches);
  }

  // Both ends of the artery are safe ground by definition — you cannot be
  // ambushed inside your own city or on the Emperor's doorstep.
  pave(tileMap, city, climbs);
  pave(tileMap, castle, climbs);
}

/**
 * Everything the roads do not reach.
 *
 * Corridor within a few hexes of a road, haunted beyond it. The width is not a
 * constant — it is sampled from **value noise over the coordinate**, so the
 * boundary pinches and widens along a route instead of tracing a fixed offset.
 * A fixed radius would read as a buffer drawn around a line, because that is
 * exactly what it would be; the sketch this is built from has an irregular edge
 * and the irregularity is most of what makes it read as country rather than as
 * a diagram.
 *
 * Noise rather than a per-tile roll for the same reason: an independent roll per
 * tile gives a dithered, salt-and-pepper frontier, which reads as a rendering
 * fault. Coherent noise gives a wandering line.
 *
 * Returns each tile's distance to the nearest road, because the home-ring pass
 * below needs it and recomputing a breadth-first search over 4,900 tiles to
 * answer a question this one already answered is the kind of thing that is
 * cheap once and a habit forever.
 */
function assignZones(
  tiles: MapTile[],
  tileMap: Map<string, MapTile>,
  city: HexCoord,
  rng: ReturnType<typeof createRNG>,
  zones: ZoneRules,
): Map<string, number> {
  const distance = new Map<string, number>();
  const queue: HexCoord[] = [];

  for (const tile of tiles) {
    if (tile.zone === 'road') {
      distance.set(hexKey(tile.coord), 0);
      queue.push(tile.coord);
    }
  }

  // Breadth-first, stopped at the widest the corridor may ever be. Anything the
  // search does not reach is haunted by definition, so there is nothing to gain
  // by walking the rest of the map.
  for (let head = 0; head < queue.length; head++) {
    const coord = queue[head];
    const d = distance.get(hexKey(coord))!;
    if (d >= zones.corridorMax) continue;

    for (const next of getNeighbors(coord)) {
      const key = hexKey(next);
      if (!tileMap.has(key) || distance.has(key)) continue;
      distance.set(key, d + 1);
      queue.push(next);
    }
  }

  const span = zones.corridorMax - zones.corridorMin;
  for (const tile of tiles) {
    if (tile.zone === 'road') continue;
    const d = distance.get(hexKey(tile.coord));
    const width =
      zones.corridorMin + Math.round(valueNoise2D(tile.coord.q, tile.coord.r, rng, 6) * span);
    tile.zone = d !== undefined && d <= width ? 'corridor' : 'haunted';
  }

  /**
   * The city's apron is corridor, whatever the roads did.
   *
   * Distance to a road is not distance to the city: the artery runs through the
   * gate in one direction, so a tile three hexes out *perpendicular* to it can
   * be beyond the corridor's width and come back haunted. Stepping out of your
   * own gate should never be an ambush, and the walk out is where a new player
   * reads the threat labels for the first time.
   *
   * `ensureHomeHaunted` starts at exactly this radius, so the two do not fight:
   * one clears the doorstep, the other puts trouble at the end of the street.
   */
  for (const hex of getHexesInRange(city, zones.homeHauntedInner - 1)) {
    const tile = tileMap.get(hexKey(hex));
    if (tile && tile.zone === 'haunted') tile.zone = 'corridor';
  }

  return distance;
}

/**
 * Haunted ground within sight of the gate.
 *
 * The city is a road hub, so everything around it is corridor by construction —
 * and corridor is quiet. Left alone, the opening hour of a new save is a walk
 * down a safe road looking for the game, which is the exact failure the old
 * `ensureHomeEncounters` floor existed to prevent, in a new shape.
 *
 * What this teaches, in the first ten minutes, is the structure of the entire
 * map: **the road is safe, the trees are not.**
 *
 * Converted from the *outermost* corridor tiles first — the ones furthest from
 * a road — so the road keeps its own margin and the haunted patch forms at the
 * corridor's edge rather than against the tarmac. A floor rather than a roll,
 * because a bad seed leaving a new party nothing to fight is not acceptable
 * variance.
 */
function ensureHomeHaunted(
  tiles: MapTile[],
  city: HexCoord,
  distance: Map<string, number>,
  rng: ReturnType<typeof createRNG>,
  zones: ZoneRules,
): void {
  const eligible = tiles.filter((t) => {
    const d = hexDistance(t.coord, city);
    return (
      d >= zones.homeHauntedInner &&
      d <= zones.homeHauntedRadius &&
      t.zone !== 'road' &&
      !t.poi &&
      isPassable(t.type)
    );
  });

  let needed = zones.homeHauntedMin - eligible.filter((t) => t.zone === 'haunted').length;
  if (needed <= 0) return;

  const candidates = eligible.filter((t) => t.zone === 'corridor');
  // Shuffled first so the choice is as deterministic as the rest of the map,
  // then sorted outward — the shuffle is what breaks ties between tiles sitting
  // at the same distance from a road.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  /**
   * Furthest from a road first, and that ordering is a **fallback chain rather
   * than a preference**.
   *
   * Ground within `CORRIDOR_MIN` of a road is corridor by definition, so this
   * pass should not be punching haunted holes in the road's own margin — and
   * sorting outward means it does not have to, wherever the ring has enough
   * ground further out.
   *
   * Where it does not, the floor wins and the margin gives. On a seed that drops
   * the city into a dense junction of the network almost every tile in the ring
   * is within two hexes of tarmac, and honouring the margin there left **four**
   * haunted tiles against a floor of 22 — a new party with nothing to do, which
   * is the exact failure this function exists to prevent. Same shape as
   * `placeWaysides`: one thing is never relaxed and everything else is, and it
   * is worth being explicit about which is which.
   */
  candidates.sort(
    (a, b) => (distance.get(hexKey(b.coord)) ?? 0) - (distance.get(hexKey(a.coord)) ?? 0),
  );

  for (const tile of candidates) {
    if (needed <= 0) break;
    tile.zone = 'haunted';
    needed--;
  }
}

/**
 * Whether a tile can be stood on at all.
 *
 * **Water only.** Mountains used to be here too, which made a sixth of the map
 * scenery: they already had a height, a relief amplitude, a prop family and a
 * combat backdrop, and none of it could ever be reached. What stops a party
 * strolling onto a peak now is the climb rule, not a blanket refusal — so a
 * mountain is somewhere you ascend to rather than a wall with a texture.
 */
export function isPassable(type: TileType): boolean {
  return type !== TileType.Water;
}

/**
 * The cost of stepping between two adjacent tiles, or `null` if you cannot.
 *
 * The one place traversal is decided. `findPath` and `getReachableHexes` both
 * take a cost function, so this plugs straight into the A* that was already
 * there — the world map used to hand them a flat `1` and a passability check on
 * the destination alone, which is exactly why height could not matter.
 */
export function movementCost(from: MapTile, to: MapTile): number | null {
  if (!isPassable(to.type)) return null;
  const climb = Math.abs((to.height ?? 0) - (from.height ?? 0));
  if (climb > MAX_CLIMB) return null;

  /**
   * Following the road is faster; joining or leaving it is not.
   *
   * Both ends have to be road, or the discount would apply to the single step
   * that crosses one — and a route that clips a road tile diagonally would get
   * a rebate for having been near infrastructure rather than for having used
   * it. Along the road, half time; everywhere else, the hour it has always been.
   *
   * Safety alone was not a trade. A road that is merely encounter-free is a
   * road anybody hunting XP ignores completely, which makes the whole network
   * scenery with a rule attached. Half time is what turns it into a decision:
   * fast, safe and unprofitable against slow, dangerous and where everything is.
   */
  return from.zone === 'road' && to.zone === 'road' ? BALANCE.ROAD_HOURS : 1;
}

/**
 * Demotes any peak the climb rule would otherwise strand.
 *
 * The highland band rings a range wherever the noise has room to produce one,
 * which is almost everywhere — but a steep enough gradient can drop a mountain
 * tile straight onto desert, and `MAX_CLIMB` then walls it off permanently. A
 * mountain nobody can reach is not difficulty, it is a hole in the map that
 * still draws.
 *
 * Demoting rather than promoting the neighbour is deliberate: promoting grows a
 * range outward and can cascade, while demoting only ever shrinks the thing that
 * was unreachable anyway.
 */
function openMountainApproaches(tiles: MapTile[], tileMap: Map<string, MapTile>): void {
  for (const tile of tiles) {
    if (tile.type !== TileType.Mountain) continue;
    const reachable = getNeighbors(tile.coord).some((n) => {
      const other = tileMap.get(hexKey(n));
      return other !== undefined && movementCost(other, tile) !== null;
    });
    if (!reachable) {
      tile.type = TileType.Highlands;
      tile.height = TERRAIN_HEIGHT[TileType.Highlands];
    }
  }
}
