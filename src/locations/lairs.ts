import { HexCoord, getHexLine, getHexesInRange, getNeighbors, hexKey } from '@/utils/hexUtils';
import { SHELL_RINGS, lairShell } from './lairShell';
import { LocationDef, LocationId, LocationSurface, LocationTile } from './types';
// Type-only, so this cannot close a runtime cycle: `encounterGenerator` imports
// `LAIR_SPECS` from here, and both of these are erased at compile time.
import type { EnemyTemplateId } from '@/models/types';
import type { FactionId } from '@/data/templates/factions';
import type { ThreatBand } from '@/systems/world/threat';
import type { WorldId } from '@/data/worlds';
import { SILK_HOLLOW } from './jadeveil/silkHollow';
import { SILENT_HALL } from './jadeveil/silentHall';
// An enum, so a value import — and still no cycle: `models/` imports nothing
// from `locations/` but types.
import { TileType } from '@/models/types';

/**
 * The three boss lairs.
 *
 * A lair is a short dungeon, not a fight with a door: an entry hall, guarded
 * chambers with something worth taking in them, and the boss at the end. That
 * shape is the whole design — the boss is the *last* resource problem rather
 * than the only one, so walking in at full strength and walking out is not the
 * same run as arriving with two encounters already spent.
 *
 * Built from one generator, but the **topology is now per-lair data**. It used
 * to be a single shared line of four rooms, on the argument that a player who
 * has learned to read one lair should not have to relearn the other two. That
 * argument is real, and what it bought in practice was that the second and
 * third lairs were byte-identical apart from a fog colour — the same corridor
 * walked three times. Legibility is preserved by keeping the *grammar* the same
 * (an entry, guarded rooms, chests off the axis, a boss at the end); what varies
 * is the shape, which is what makes a place somewhere rather than a length.
 */

/**
 * Where on the world map a lair's door may stand.
 *
 * A lair is somewhere, and the door says so before the walk does: the Hollow is
 * a cave in red rock, and the ice lair is a glacier in the frozen north. The
 * door used to be dealt from the shuffled pool with nothing but its distance
 * from the city deciding it, which put a glacier in a meadow as readily as
 * anywhere. `mapGenerator` takes the first free tile of the pool that fits and
 * falls back to the first that does not, because a door on the wrong ground is
 * a worse door and no door is a lair, a party slot and the castle gone.
 */
export interface LairSite {
  /** World terrains the door may stand on. Absent means any it could before. */
  terrain?: TileType[];
  /** Inside the frozen north (`true`), outside it (`false`), or either (absent). */
  frozen?: boolean;
}

/** A chamber. `radius: 0` is a single hex — an alcove. */
export interface LairRoom {
  centre: HexCoord;
  radius: number;
  /** Overrides the spec's default floor for this room. */
  surface?: LocationSurface;
}

export interface LairTopology {
  /** Room 0 is the entry hall; the way in and the way out stub off it. */
  rooms: LairRoom[];
  /** Index pairs. The graph must be connected, and a test says so. */
  links: [number, number][];
  corridorSurface: LocationSurface;
  /** 0 = one hex wide, 1 = three hexes wide. */
  corridorWidth: number;
  guardRooms: [number, number];
  chestRooms: [number, number];
  bossRoom: number;
  /** Which way the entrance stub runs from room 0. */
  entryDir: HexCoord;
}

/** One kind of thing a lair sets down, and how often against the others. */
export interface DressKey {
  key: string;
  weight: number;
  /** Multiplies the prop's own registered scale. */
  scale?: number;
}

/** A weighted list and the share of its slots that take something from it. */
export interface DressSlot {
  keys: DressKey[];
  rate: number;
  /**
   * A rhythm rather than a roll: take every `stride`-th wall along the lair,
   * west to east, and ignore `rate`. Ordered stonework is read by its beat —
   * a pillar every other bay — and a rate has no beat in it, which is the
   * arena's colonnade argument one kind of place over.
   */
  stride?: number;
}

/** One piece of a group, in the group's own frame: `x` along the wall, `z` out from it into the room. */
export interface DressPiece {
  key: string;
  x: number;
  z: number;
  /** Added to the group's own facing, which looks out from the wall. */
  turn?: number;
  scale?: number;
}

/**
 * Several pieces set down as one — a nest with its bones beside it, a row of
 * steles, an outcrop with the ash banked at its foot — against a chamber's
 * wall and facing into it.
 *
 * **Refused whole.** A group is placed only where every piece of it fits, or
 * not at all: half a nest is not a nest, and a row of steles missing its
 * middle stone reads as damage rather than as a row. Groups spread over a
 * lair's chambers — each goes to the chamber holding fewest so far — and keep
 * `GROUP_SPACING` apart, so two never merge into one pile.
 */
export interface DressGroup {
  /** The walls it stands against: the one the camera looks at, or a room's sides. */
  at: 'back' | 'side';
  /**
   * The chambers' walls (the default), the passages', or either. A tunnel is
   * shored along its length and a catacomb's passages are lined with the
   * dead, so some groups belong between the rooms rather than in them.
   */
  in?: 'room' | 'passage' | 'any';
  pieces: DressPiece[];
  /** At most this many in the lair. */
  count: number;
}

/**
 * What a lair is furnished with, by where a thing stands — placed by
 * `components/location/lairDressing.ts`, which is the half that knows how big
 * each model is.
 *
 * **By where it stands, and never on the floor's own ground.** The furnishing
 * this replaced was a per-tile roll over every undecided floor tile: a pillar
 * or a pool anywhere in a room, walling off whatever it landed on until
 * `isCutVertex` was written to stop it stranding a chest, and small things
 * spread evenly across every chamber — the "confetti" the arena's composition
 * review names. Here a lair's things stand against its walls, along the edges
 * of its floor and on the rock above, and not one of them blocks a tile: the
 * floor a party walks is exactly the rooms and the passages between them.
 */
export interface LairDressing {
  /** Against a wall the camera looks at, the floor lying to its south. */
  back: DressSlot;
  /** Against a wall to the east or west of the floor. */
  side: DressSlot;
  /** Low along the floor's edge, clear of every tile's middle. */
  edge: DressSlot;
  /** On the rock past the walls: what the mass the lair is cut from is made of. */
  crown: DressSlot;
  /**
   * The lair's light: one key with a flame the fixture table knows, stood
   * against the walls of its chambers at a spacing.
   */
  light: { key: string; spacing: number };
  /**
   * The pair of posts at each guarded doorway, and what they are once won.
   * `low` stands where `key` would hide floor — see `lair_guard_cairn`.
   */
  guard: { key: string; low: string; spent: string | null };
  /**
   * Set against the back wall of the boss's chamber, straight behind the boss:
   * the `DressPiece` frame of that wall, facing into the chamber.
   */
  boss: DressPiece[];
  /** What the chambers are furnished with as compositions rather than one at a time. */
  groups: DressGroup[];
}

/** A boss lair. Its name is `places.<id>.name`, read through `placeName`. */
export interface LairSpec {
  id: LocationId;
  /**
   * The world whose map carries its door; absent, the Empire. A world's lairs
   * are its own: only the Empire's open party slots and the Obsidian castle.
   */
  world?: WorldId;
  unlockLevel: number;
  /**
   * In an expansion world: the summed-level gate over `bandGateBase`, so a lair opens at the same
   * point of its band whichever band its world took. `unlockLevel` is then that gate at band 1,
   * which is what the tuning harness reads (`lairs.lairUnlockLevel`).
   */
  unlockOverBand?: number;
  /**
   * In an expansion world: the lair's level over the band floor, for its enemies and its chests,
   * in place of the offset of the area its door stands in (`systems/world/contentLevel.ts`).
   */
  levelOffset?: number;
  /**
   * Encounter ids: the two guard chambers, the boss, then the chest guard.
   *
   * The fourth is what stands between the party and any chest sitting **off**
   * the route to the boss. Those used to be free — walk in, open it, walk out —
   * which made a detour a pure gain and the decision to take it no decision at
   * all. A lair is an attrition problem, so its optional reward has to cost the
   * same currency as everything else in it.
   *
   * Appended rather than inserted so the three existing ids keep their meaning:
   * `_1` and `_2` are still the chambers on the way in and `_boss` is still the
   * boss, in the save, in `curatedBand` and in every test that names one.
   */
  encounters: [string, string, string, string];
  /**
   * What its chambers are floored with. Its passages are floored with
   * `topology.corridorSurface`, and the two differ in every lair — a room is
   * told from the way into it by what it is laid with.
   */
  surface: LocationSurface;
  ambient: { fog: string; ground: string };
  /** Loot tier for the two chests. */
  chestTier: number;
  /**
   * Who holds it. The guard chambers are composed from this roster alone, so a
   * lair obeys the one-faction-per-fight rule the rest of the game does.
   *
   * The chambers used to be filled by indexing the global tier lists in file
   * order, which meant `normals[0..2]` — the three *chaff* templates. Every
   * guard room in the game was an elite plus a pile of Goblin Whelps, drawn from
   * whichever factions those indices happened to land on, so a tomb was
   * guarded by a Ghost and three Footpads.
   *
   * The faction is also what the topology is *for*: a burrow, a cavern and a
   * glacier only read as three places if three different things live in them.
   */
  faction: FactionId;
  /** Band the guard chambers are composed at. The second chamber is one harder. */
  band: ThreatBand;
  /**
   * The thing at the end, named rather than derived.
   *
   * This was `bosses[lairIndex]` over the tier list in file order, which put the
   * **dragon** in The Warren — the first lair, gated at summed party level 8 —
   * and a troll chieftain in The Wyrm's Hollow at level 39. The names and the
   * difficulty ordering were both inverted, and neither could be fixed without
   * either reordering a data file for its side effects or naming the boss here.
   */
  boss: EnemyTemplateId;
  /**
   * Where its door may stand on the world map; absent, anywhere it could. A
   * lair with a site never falls back to other ground: map generation throws
   * when none fits, as it does for a quest site.
   */
  site?: LairSite;
  topology: LairTopology;
  /** What its walls, and the rock past them, are made of. */
  wall: LocationSurface;
  dressing: LairDressing;
}

/**
 * Corridors, in any direction.
 *
 * `getHexLine` already exists and handles the general case; the old builder
 * walked `q` at a fixed `r`, which is why every room had to sit on one axis.
 * Endpoints belong to the rooms they join, so they are trimmed.
 */
function corridor(a: HexCoord, b: HexCoord, width: number): HexCoord[] {
  const line = getHexLine(a, b).slice(1, -1);
  return width === 0 ? line : line.flatMap((h) => getHexesInRange(h, width));
}

/**
 * The rooms on the way to the boss, in order.
 *
 * Breadth-first over `links`, which the topology already guarantees is
 * connected — `lairs.test.ts` checks the graph directly rather than only
 * flood-filling the tiles, because an orphaned room otherwise shows up two
 * layers late as "the boss is stranded".
 */
function routeToBoss(topo: LairTopology): number[] {
  const previous = new Map<number, number>([[0, -1]]);
  const queue = [0];
  while (queue.length) {
    const here = queue.shift()!;
    if (here === topo.bossRoom) break;
    for (const [a, b] of topo.links) {
      for (const [from, to] of [[a, b], [b, a]] as const) {
        if (from !== here || previous.has(to)) continue;
        previous.set(to, here);
        queue.push(to);
      }
    }
  }

  const route: number[] = [];
  for (let at = topo.bossRoom; at !== undefined && at !== -1; at = previous.get(at)!) {
    route.unshift(at);
    if (!previous.has(at)) return route;
  }
  return route;
}

/**
 * Chest rooms the party is not already obliged to walk through.
 *
 * A room that is both on the boss route and holds a chest needs nothing: the
 * chamber guards are already between it and the entrance. A room that is also a
 * guard room needs nothing either, for the same reason — which is the whole of
 * The Wyrm's Hollow, whose chests sit in its two guarded caverns.
 */
function offPathChestRooms(topo: LairTopology): number[] {
  const onRoute = new Set(routeToBoss(topo));
  return topo.chestRooms.filter(
    (idx) => !onRoute.has(idx) && !topo.guardRooms.includes(idx),
  );
}

/**
 * The hex a room is entered through, and the corridor hexes either side of it.
 *
 * **A guard has to stand in a doorway, not in a room.** They used to be put on
 * the room's own centre, under a comment asserting that this made the fight
 * unavoidable — "a lair you can sneak past is a lair with one encounter in it".
 * A trigger fires when the party *stops* on it and does not block a path, and
 * every guarded chamber is two or three hexes of radius, so the party could
 * simply walk around the guard. Measured: the boss of **all three lairs** was
 * reachable from the entrance without triggering a single fight. The attrition
 * a lair is built around — arrive at the boss with resources already spent — has
 * never once happened, which is exactly what a playtest reported as "I didn't
 * see any encounters in there".
 *
 * A corridor is one hex wide by construction, so the centre line is the doorway.
 * `flanks` is the rest of the cross-section for the lairs whose corridors are
 * wider (`corridorWidth` 1 is three across): those get walled so the gap the
 * guard is standing in is genuinely the only way through. Nothing is placed
 * inside the room itself, or the wall would eat the chamber.
 */
function doorwayInto(
  topo: LairTopology,
  roomIdx: number,
  fromIdx: number,
): { at: HexCoord; flanks: HexCoord[] } | null {
  const room = topo.rooms[roomIdx];
  const from = topo.rooms[fromIdx];
  const inRoom = new Set(getHexesInRange(room.centre, room.radius).map(hexKey));
  const inFrom = new Set(getHexesInRange(from.centre, from.radius).map(hexKey));

  // **The frontier: every corridor hex touching the chamber.** That is the
  // doorway's real cross-section, and it is what has to be reduced to one hex.
  //
  // Taking the last hex of the centre line instead lands *inside* the room,
  // where the party walks round it; taking the line hex plus its immediate
  // neighbours is right for a one-wide corridor and wrong for a three-wide one,
  // where the halo of the hex *behind* the guard reaches past it and rejoins the
  // room. Asking which hexes actually touch the chamber is the version that does
  // not depend on how wide the corridor happens to be.
  const wide = corridor(from.centre, room.centre, topo.corridorWidth);
  const frontier = wide.filter(
    (h) =>
      !inRoom.has(hexKey(h)) &&
      !inFrom.has(hexKey(h)) &&
      getNeighbors(h).some((n) => inRoom.has(hexKey(n))),
  );
  if (frontier.length === 0) return null;

  // Hold the centre line where there is one, so the door lines up with the
  // corridor rather than sitting in a corner of it.
  const onLine = new Set(corridor(from.centre, room.centre, 0).map(hexKey));
  const at = frontier.find((h) => onLine.has(hexKey(h))) ?? frontier[0];

  return {
    at,
    flanks: frontier.filter((h) => hexKey(h) !== hexKey(at)),
  };
}

/** Which room a given room is approached from, walking in from the entrance. */
function approachedFrom(topo: LairTopology, roomIdx: number): number | null {
  const route = routeToBoss(topo);
  const at = route.indexOf(roomIdx);
  if (at > 0) return route[at - 1];
  // Off the route: the room it links back to
  const link = topo.links.find(([a, b]) => a === roomIdx || b === roomIdx);
  if (!link) return null;
  return link[0] === roomIdx ? link[1] : link[0];
}

function buildLair(spec: LairSpec): LocationDef {
  const { topology: topo } = spec;
  const tiles = new Map<string, LocationTile>();
  const put = (tile: LocationTile) => tiles.set(hexKey(tile.coord), tile);

  // ── Floor ──────────────────────────────────────────────────────────────────
  //
  // One surface per room and one for the passages, and no roll. A per-tile mix
  // of two surfaces is salt and pepper, which reads as a rendering fault; what
  // it bought was variety, and what a lair needed was for a chamber to be told
  // from the run into it.
  for (const room of topo.rooms) {
    for (const coord of getHexesInRange(room.centre, room.radius)) {
      put({ coord, surface: room.surface ?? spec.surface });
    }
  }
  // A passage runs centre to centre, so its line crosses the rooms at either
  // end — and laid over them it drew a stripe of passage floor to the middle of
  // every chamber. It is laid only where no room already is.
  for (const [a, b] of topo.links) {
    for (const coord of corridor(topo.rooms[a].centre, topo.rooms[b].centre, topo.corridorWidth)) {
      if (!tiles.has(hexKey(coord))) put({ coord, surface: topo.corridorSurface });
    }
  }

  // ── Triggers ───────────────────────────────────────────────────────────────
  //
  // Stamped before decoration, and decoration skips anything already spoken
  // for. The other order puts a pillar on the boss.
  // Guards stand in the doorway of their chamber, which is what actually makes
  // the fight unavoidable — see `doorwayInto` for the version of this that did
  // not, and for how long every lair in the game could be walked straight
  // through to the boss.
  const guardDoorway = (roomIdx: number, encounterId: string) => {
    const from = approachedFrom(topo, roomIdx);
    const door = from === null ? null : doorwayInto(topo, roomIdx, from);
    if (!door) {
      // Nothing links here, so there is no doorway to hold. The centre is the
      // old behaviour and the graph is checked elsewhere; better a guard that
      // can be walked around than a chamber with no fight in it at all.
      put({
        coord: topo.rooms[roomIdx].centre,
        surface: spec.surface,
        label: 'guarded',
        trigger: { kind: 'encounter', encounterId },
      });
      return;
    }
    for (const flank of door.flanks) {
      put({ coord: flank, surface: spec.wall, blocked: true });
    }
    put({
      coord: door.at,
      surface: topo.corridorSurface,
      label: 'guarded',
      trigger: { kind: 'encounter', encounterId },
    });
  };

  topo.guardRooms.forEach((roomIdx, i) => guardDoorway(roomIdx, spec.encounters[i]));

  // Chests sit off the axis, in the corners of their chambers. Reachable without
  // a fight in principle — but you have to walk past the guard to get there.
  topo.chestRooms.forEach((roomIdx, i) => {
    const room = topo.rooms[roomIdx];
    const offset = Math.max(1, room.radius);
    const coord = { q: room.centre.q, r: room.centre.r + (i === 0 ? -offset : offset) };
    put({
      coord,
      surface: spec.surface,
      label: 'chest',
      prop: 'lair_chest',
      spentProp: 'lair_chest_open',
      // The first chest pays a Legendary, the second two Epics
      trigger: { kind: 'chest', lootTier: spec.chestTier, kit: i === 0 ? 'legendary' : 'epics' },
    });
  });

  // ── Chest guards ───────────────────────────────────────────────────────────
  //
  // Only for the chests that sit **off** the route to the boss. A chest in a
  // room the party has to cross anyway is already behind a chamber guard, and
  // putting a second fight on the main line would turn one lair's worth of
  // attrition into two — which matters most in The Warren, the first boss in the
  // game, fought by a party of two.
  //
  // The trigger goes on the corridor hex immediately outside the room rather
  // than inside it: a chamber is several hexes wide, so anything standing in one
  // can be walked around, and a guard you can stroll past is scenery. A corridor
  // is one hex wide by construction, so this is the doorway.
  for (const roomIdx of offPathChestRooms(topo)) {
    guardDoorway(roomIdx, spec.encounters[3]);
  }

  // The boss room is marked by the boss itself, small on a plinth: its effigy,
  // `effigy_<lairId>` by convention (`voxel/models/effigies.ts`), because this
  // module may not reach the model registry. `bossEffigies.test.ts` pins that
  // every lair has one.
  const bossAt = topo.rooms[topo.bossRoom].centre;
  put({
    coord: bossAt,
    surface: spec.surface,
    label: 'place',
    prop: `effigy_${spec.id}`,
    trigger: { kind: 'encounter', encounterId: spec.encounters[2] },
  });

  // The way out is the way in. A lair has no back door: leaving is a decision
  // made at the entrance, which is what makes going deeper a commitment.
  const hall = topo.rooms[0].centre;
  const entry = {
    q: hall.q + topo.entryDir.q * (topo.rooms[0].radius + 1),
    r: hall.r + topo.entryDir.r * (topo.rooms[0].radius + 1),
  };
  const exit = {
    q: hall.q + topo.entryDir.q * (topo.rooms[0].radius + 2),
    r: hall.r + topo.entryDir.r * (topo.rooms[0].radius + 2),
  };
  put({ coord: entry, surface: topo.corridorSurface });
  put({ coord: exit, surface: topo.corridorSurface, label: 'leave', trigger: { kind: 'exit' } });

  // ── Walls ──────────────────────────────────────────────────────────────────
  //
  // Nothing is scattered on the floor any more — see `LairDressing` — so what
  // is laid here is exactly the rooms, the passages, the doorway flanks and the
  // way in and out. The shell cuts that into rock, and leaves the rock open
  // past the exit for as deep as it goes: the passage out carries on into the
  // dark rather than stopping at a wall, which is what says it leads somewhere.
  const mouth = Array.from({ length: SHELL_RINGS }, (_, i) => ({
    q: exit.q + topo.entryDir.q * (i + 1),
    r: exit.r + topo.entryDir.r * (i + 1),
  }));
  const walled = lairShell([...tiles.values()], spec.wall, mouth);

  return {
    id: spec.id,
    entry,
    tiles: walled,
    ambient: spec.ambient,
    // All three are underground. Stated here rather than on `LairSpec` because
    // it is not a thing a lair author gets to vary: a burrow, a cavern and a
    // glacier's depths are indoors, and a lair that was not would need a different
    // generator, not a different field.
    environment: 'interior',
    lair: { bossAt, unlockLevel: spec.unlockLevel },
  };
}

/** All three run east, so all three are entered from the west. */
const WEST: HexCoord = { q: -1, r: 0 };

/**
 * The three, in the order the campaign opens them: the Warren, the Wyrm's
 * Hollow, then the ice lair, and the castle after all three.
 *
 * Gates are summed party level and are first guesses — the numbers assume the
 * party grows by one hero per lair, which is what the lairs themselves pay for.
 * `lairBosses.test.ts` holds the gates and the bosses ascending together.
 */
export const LAIR_SPECS: LairSpec[] = [
  {
    id: 'lair_warren',
    unlockLevel: 8,
    encounters: ['lair_warren_1', 'lair_warren_2', 'lair_warren_boss', 'lair_warren_chest'],
    surface: 'earth',
    ambient: { fog: '#1e1a14', ground: '#2a241a' },
    chestTier: 1,
    faction: 'greenskins',
    band: 2,
    boss: 'troll_chieftain',
    // A burrow: small chambers on a spine that turns twice, narrow corridors,
    // and one dead end. Reads as *tunnels* — nothing here was built.
    //
    // **The spacing is load-bearing, not layout taste.** A guard holds the
    // throat of its chamber, and a throat only exists when the two rooms are
    // further apart than their radii plus one — otherwise the chambers touch,
    // there is no corridor to hold, and the party walks around the guard through
    // the open room. Every room here used to sit exactly that close: the boss
    // was reachable from the entrance without triggering a single fight, in all
    // three lairs. `lairs.test.ts` pins the throats now, so pulling a room back
    // in fails rather than silently deleting the lair's attrition.
    topology: {
      rooms: [
        { centre: { q: 0, r: 0 }, radius: 1 },
        { centre: { q: 6, r: 0 }, radius: 2 },
        { centre: { q: 9, r: -3 }, radius: 1 },
        { centre: { q: 13, r: -2 }, radius: 2 },
        { centre: { q: 12, r: 3 }, radius: 1 },
        { centre: { q: 19, r: -1 }, radius: 2 },
        { centre: { q: 25, r: -2 }, radius: 2 },
      ],
      links: [[0, 1], [1, 2], [2, 3], [3, 4], [3, 5], [5, 6]],
      corridorSurface: 'dirt',
      corridorWidth: 0,
      guardRooms: [1, 5],
      chestRooms: [3, 4],
      bossRoom: 6,
      entryDir: WEST,
    },
    wall: 'burrow',
    // A burrow the greenskins dug: earth held up with timber where it has to
    // be, roots through the roof where it has not been, bedding where they
    // sleep and what they took piled where they keep it.
    dressing: {
      back: {
        rate: 0.45,
        keys: [
          { key: 'lair_roots', weight: 3 },
          { key: 'arena_roots_0', weight: 1, scale: 0.8 },
          { key: 'dungeon_mushrooms_1', weight: 2 },
        ],
      },
      side: {
        rate: 0.35,
        keys: [
          { key: 'dungeon_mushrooms_0', weight: 2 },
          { key: 'dungeon_rubble_0', weight: 1 },
        ],
      },
      edge: {
        rate: 0.16,
        keys: [
          { key: 'dungeon_bones_1', weight: 1 },
          { key: 'arena_fungus_0', weight: 2 },
        ],
      },
      // Nothing on the rock: small things on a dark mass read as litter on a
      // void, and what says the rock is earth is the roots coming through it
      crown: { rate: 0, keys: [] },
      light: { key: 'arena_lantern_0', spacing: 9 },
      guard: { key: 'lair_guard_post', low: 'lair_guard_cairn', spent: 'lair_guard_post_down' },
      // The troll's seat against the chamber's back wall, with what it ate and
      // what it kept either side
      boss: [
        { key: 'lair_bone_throne', x: 0, z: -0.1 },
        { key: 'dungeon_bones_0', x: -1.73, z: -0.05, turn: 0.4 },
        { key: 'arena_stores_0', x: 1.73, z: -0.1 },
      ],
      groups: [
        // Where the burrow is held up: along its tunnels, and in its chambers
        { at: 'back', in: 'passage', count: 5, pieces: [{ key: 'lair_shoring', x: 0, z: -0.15 }] },
        // Where they sleep: straw, a gnawed bone, what grows in the dark
        {
          at: 'back',
          count: 4,
          pieces: [
            { key: 'lair_nest', x: 0, z: -0.05 },
            { key: 'dungeon_bones_1', x: 1.73, z: -0.1, scale: 0.7 },
            { key: 'dungeon_mushrooms_1', x: -1.73, z: -0.1, scale: 0.8 },
          ],
        },
        // What they took, stacked against the wall
        {
          at: 'back',
          count: 3,
          pieces: [
            { key: 'lair_sacks', x: -0.15, z: -0.05 },
            { key: 'dungeon_barrels', x: 1.73, z: -0.1, scale: 0.8 },
          ],
        },
        { at: 'back', count: 2, pieces: [{ key: 'lair_shoring', x: 0, z: -0.15 }] },
        // What grows along the sides in the dark
        {
          at: 'side',
          count: 4,
          pieces: [
            { key: 'dungeon_mushrooms_0', x: -0.25, z: -0.05, scale: 0.8 },
            { key: 'arena_fungus_0', x: 0.3, z: -0.1 },
          ],
        },
      ],
    },
  },
  {
    id: 'lair_wyrm',
    // The middle of the campaign now, where the Barrow used to stand: the ice
    // lair took the last place before the castle
    // (the private project notes).
    unlockLevel: 22,
    encounters: ['lair_wyrm_1', 'lair_wyrm_2', 'lair_wyrm_boss', 'lair_wyrm_chest'],
    surface: 'basalt',
    ambient: { fog: '#241416', ground: '#301c1c' },
    chestTier: 2,
    // Red rock is the desert's, and the desert's own faction keeps the door —
    // the Coven held it while the Hollow was the last lair and band 4. The
    // Sandscourge are locked to the desert (`Faction.homeLocked`), so the door
    // stands on nothing else.
    faction: 'sandscourge',
    band: 3,
    boss: 'dragon',
    site: { terrain: [TileType.Desert], frozen: false },
    // A cavern: two big chambers joined by a wide throat, plus a side cave. Few
    // corridors and none of them narrow. Reads as *natural* — nothing dug this.
    topology: {
      // Room 2 pushed out to open a throat off the big cavern — see the spacing
      // note on The Warren. Its corridors are three wide, so the guard holds the
      // centre line and the flanks are walled either side of it.
      rooms: [
        { centre: { q: 0, r: 0 }, radius: 2 },
        { centre: { q: 7, r: 1 }, radius: 3 },
        { centre: { q: 15, r: -6 }, radius: 2 },
        { centre: { q: 17, r: 2 }, radius: 3 },
      ],
      links: [[0, 1], [1, 2], [1, 3]],
      corridorSurface: 'ash',
      corridorWidth: 1,
      // The second guard holds the dragon's own cavern, as every lair's second
      // guard holds the way on (PT-21). It held the side cave, off the route —
      // so the dragon was one fight from the entrance, and a party that lost to
      // that guard came back to find the way to the boss open, the guard
      // apparently gone. The side cave's chest has its chest guard instead.
      guardRooms: [1, 3],
      chestRooms: [1, 2],
      bossRoom: 3,
      entryDir: WEST,
    },
    wall: 'cavern',
    // A cave a dragon moved into: rock laid down in bands and broken, ash
    // where it burnt, the nest it built out of what it killed, and fire still
    // coming up through the floor — its warm light low and local.
    dressing: {
      back: {
        rate: 0.4,
        keys: [
          { key: 'arena_stalagmite_0', weight: 2, scale: 0.6 },
          { key: 'arena_stalagmite_1', weight: 2, scale: 0.7 },
          { key: 'dungeon_stalagmite_0', weight: 2 },
        ],
      },
      side: {
        rate: 0.3,
        keys: [
          { key: 'dungeon_stalagmite_1', weight: 2 },
          { key: 'dungeon_rubble_1', weight: 1 },
        ],
      },
      edge: {
        rate: 0.2,
        keys: [
          { key: 'dungeon_scorch', weight: 2 },
          { key: 'lair_ash_drift', weight: 2, scale: 0.8 },
          { key: 'dungeon_bones_0', weight: 1 },
        ],
      },
      // Spires broken off the roof, standing on the rock: a cavern's rock is
      // read by its shapes, and the Hollow's is the one mass that has any
      crown: {
        rate: 0.16,
        keys: [
          { key: 'lair_spire', weight: 2 },
          { key: 'dungeon_stalagmite_1', weight: 1 },
        ],
      },
      // Lit from below, by the fire coming up through its floor: nothing here
      // was built, so nothing here is a brazier
      light: { key: 'lair_ember_vent', spacing: 8 },
      guard: { key: 'lair_guard_post', low: 'lair_guard_cairn', spent: 'lair_guard_post_down' },
      // The dragon's nest, heaped against the back of its cavern, with its
      // clutch beside it
      boss: [
        { key: 'lair_wyrm_nest', x: 0, z: -0.25, scale: 0.8 },
        { key: 'dungeon_eggs', x: -1.73, z: -0.1 },
        { key: 'arena_clutch_0', x: 1.73, z: -0.2, scale: 0.8 },
      ],
      groups: [
        // The rock in bands, and the ash banked at its foot
        {
          at: 'back',
          count: 5,
          pieces: [
            { key: 'lair_strata', x: 0, z: -0.2 },
            { key: 'lair_ash_drift', x: 1.73, z: -0.05, scale: 0.7 },
          ],
        },
        // What it ate, dragged in along the throats and left
        {
          at: 'side',
          in: 'any',
          count: 4,
          pieces: [
            { key: 'dungeon_bones_0', x: -0.2, z: -0.1, scale: 0.8 },
            { key: 'lair_ash_drift', x: 0.35, z: -0.1, scale: 0.7 },
          ],
        },
      ],
    },
  },
  {
    // The ice lair keeps the old Barrow's slot — its id, its encounter ids and
    // its triggers' keys in the save — and nothing else of it: the tomb and
    // its boss left the game (the private project notes).
    id: 'lair_barrow',
    unlockLevel: 39,
    encounters: ['lair_barrow_1', 'lair_barrow_2', 'lair_barrow_boss', 'lair_barrow_chest'],
    surface: 'snowpack',
    ambient: { fog: '#0e1822', ground: '#1a2633' },
    chestTier: 3,
    // The Heart of Winter's own ice, met here and nowhere else
    // (`Faction.lairOnly`).
    faction: 'hoarfrost',
    band: 4,
    boss: 'heart_of_winter',
    site: { frozen: true },
    // A glacier the Empire cut its way into: the largest of the three, six
    // chambers joined by narrow passages, two of them side caves holding the
    // chests, and the Heart's hall as wide as any room in any lair. Reads as
    // *worked ice* — nothing here was built, but the Legion has been through
    // all of it.
    topology: {
      // Spaced by The Warren's throat rule: every linked pair further apart
      // than their radii plus one, so each guard holds a doorway.
      rooms: [
        { centre: { q: 0, r: 0 }, radius: 2 },
        { centre: { q: 7, r: 0 }, radius: 2 },
        { centre: { q: 9, r: -6 }, radius: 2 },
        { centre: { q: 14, r: 1 }, radius: 3 },
        { centre: { q: 13, r: 8 }, radius: 2 },
        { centre: { q: 22, r: 0 }, radius: 3 },
      ],
      links: [[0, 1], [1, 2], [1, 3], [3, 4], [3, 5]],
      corridorSurface: 'blueice',
      corridorWidth: 0,
      guardRooms: [1, 3],
      chestRooms: [2, 4],
      bossRoom: 5,
      entryDir: WEST,
    },
    wall: 'glacier',
    // Cracked blue-black glacier with its light inside it: cyan crystal in the
    // walls, frozen falls and pillars where the ice came down, seracs at the
    // edges and the bones of something old under the frost. The only warm
    // things in it are the Empire's — red braziers, chains and stakes run along
    // the passages to the drain at the back of the Heart's hall.
    dressing: {
      back: {
        rate: 0.4,
        keys: [
          { key: 'lair_icefall', weight: 2 },
          { key: 'lair_ice_pillar', weight: 2 },
          { key: 'lair_serac', weight: 1 },
        ],
      },
      side: {
        rate: 0.3,
        keys: [
          { key: 'lair_serac', weight: 2 },
          { key: 'lair_frost_bones', weight: 1 },
        ],
      },
      edge: {
        rate: 0.14,
        keys: [
          { key: 'lair_frost_bones', weight: 1 },
          { key: 'lair_snow_drift', weight: 2 },
        ],
      },
      // Shards of the glacier standing on its own mass: the rock is ice, and
      // the crown is what says so from above
      crown: {
        rate: 0.14,
        keys: [{ key: 'lair_ice_spire', weight: 1 }],
      },
      // Lit from inside the ice, cold: nothing here burns but the Empire's
      light: { key: 'lair_ice_crystal', spacing: 9 },
      guard: { key: 'lair_guard_post', low: 'lair_guard_cairn', spent: 'lair_guard_post_down' },
      // The drain the Empire built behind the Heart, its braziers either side
      boss: [
        { key: 'lair_drain_engine', x: 0, z: -0.1 },
        { key: 'lair_blood_brazier', x: -1.73, z: -0.1 },
        { key: 'lair_blood_brazier', x: 1.73, z: -0.1 },
      ],
      groups: [
        // The chains the Legion ran in, staked along its passages
        {
          at: 'side',
          in: 'passage',
          count: 6,
          pieces: [
            { key: 'lair_chain_stake', x: -0.3, z: -0.05 },
            { key: 'lair_chain_stake', x: 0.35, z: -0.05, turn: Math.PI },
          ],
        },
        // A sledge the Empire left in the snow, its brazier still lit: the
        // warm points, two or three to the lair
        {
          at: 'back',
          count: 2,
          pieces: [
            { key: 'lair_imperial_sledge', x: -0.2, z: -0.05 },
            { key: 'lair_blood_brazier', x: 1.73, z: -0.1, scale: 0.9 },
          ],
        },
        // A frozen fall with the ice heaped at its foot
        {
          at: 'back',
          count: 3,
          pieces: [
            { key: 'lair_icefall', x: 0, z: -0.2 },
            { key: 'lair_snow_drift', x: 1.73, z: -0.05, scale: 0.8 },
          ],
        },
        // What the ice keeps along its sides
        {
          at: 'side',
          count: 4,
          pieces: [
            { key: 'lair_frost_bones', x: -0.2, z: -0.1, scale: 0.8 },
            { key: 'lair_serac', x: 0.35, z: -0.15, scale: 0.7 },
          ],
        },
      ],
    },
  },
  // Jadeveil's (`locations/jadeveil/`)
  SILK_HOLLOW,
  SILENT_HALL,
];

/** The lairs whose doors stand on `world`'s map, in progression order. */
export function lairsOf(world: WorldId): LairSpec[] {
  return LAIR_SPECS.filter((s) => (s.world ?? 'empire') === world);
}

/** The Empire's three: the party's slots and the castle's gate are theirs. */
export const EMPIRE_LAIRS: readonly LairSpec[] = lairsOf('empire');

export const LAIRS: LocationDef[] = LAIR_SPECS.map(buildLair);

export const LAIR_IDS = LAIR_SPECS.map((s) => s.id);
