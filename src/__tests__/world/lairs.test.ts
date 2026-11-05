import { LAIRS, LAIR_SPECS, getLocation, isWalkable, walkEnd } from '@/locations';
import { EMPIRE_LAIRS, lairsOf } from '@/locations/lairs';
import { triggerKey } from '@/locations/types';
import { findPath } from '@/systems/world/pathfinding';
import {
  allLairsCleared, clearedLairs, isLairCleared, lairForIndex, lairGate, partySlots,
} from '@/systems/world/lairs';
import { generateEncounterEnemies } from '@/systems/world/encounterGenerator';
import { generateMap, reachableFromCity } from '@/systems/world/mapGenerator';
import { BALANCE } from '@/data/balanceConstants';
import { POIType } from '@/models/types';
import { getHexesInRange, getNeighbors, hexKey, HexCoord } from '@/utils/hexUtils';

/**
 * Lairs are the game's only source of party slots, so the failure that matters
 * is not "the dungeon looks wrong" — it is a boss that cannot be reached, or one
 * that pays out twice.
 */

const spent = (...keys: string[]) => new Set(keys);
const bossKey = (i: number) =>
  triggerKey(LAIR_SPECS[i].id, getLocation(LAIR_SPECS[i].id).lair!.bossAt);

/**
 * The room graph, checked as data.
 *
 * The flood fill below finds an unreachable boss eventually, but it reports it
 * two layers late — as "the boss is stranded" rather than as "room 4 is joined
 * to nothing". Since the topology is now authored per lair, the connectivity is
 * a property of the spec and worth asserting where the mistake is made.
 */
describe('topology', () => {
  it.each(LAIR_SPECS.map((s) => [s.id, s] as const))(
    '%s joins every room to the entry hall',
    (_id, spec) => {
      const { rooms, links } = spec.topology;
      const seen = new Set<number>([0]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const [a, b] of links) {
          if (seen.has(a) && !seen.has(b)) { seen.add(b); grew = true; }
          if (seen.has(b) && !seen.has(a)) { seen.add(a); grew = true; }
        }
      }
      const orphans = rooms.map((_, i) => i).filter((i) => !seen.has(i));
      expect(orphans).toEqual([]);
    },
  );

  it.each(LAIR_SPECS.map((s) => [s.id, s] as const))(
    '%s points its guards, chests and boss at rooms that exist',
    (_id, spec) => {
      const { rooms, guardRooms, chestRooms, bossRoom } = spec.topology;
      const bad = [...guardRooms, ...chestRooms, bossRoom].filter(
        (i) => i < 0 || i >= rooms.length,
      );
      expect(bad).toEqual([]);
    },
  );

  /**
   * The three lairs used to be one shared line of rooms, which made the second
   * and third byte-identical apart from a fog colour. This is what
   * stops a future refactor quietly collapsing them back together.
   */
  it('gives each lair a genuinely different shape', () => {
    const signatures = LAIRS.map((l) =>
      l.tiles.map((t) => hexKey(t.coord)).sort().join('|'),
    );
    expect(new Set(signatures).size).toBe(LAIRS.length);

    const sizes = LAIRS.map((l) => l.tiles.length);
    expect(new Set(sizes).size).toBe(LAIRS.length);
  });
});

/**
 * A lair's floor is its rooms and the passages between them, and nothing
 * furnished stands on it. The furnishing is `lairDressing.test.ts`'s; what is
 * pinned here is the half that is data — that a room is told from the way into
 * it by what it is laid with, and that no roll decides it.
 */
describe('floors', () => {
  it.each(LAIR_SPECS.map((s) => [s.id, s] as const))(
    'lays %s\'s chambers and its passages in two different materials, and walls it in a third',
    (_id, spec) => {
      const kinds = new Set([spec.surface, spec.topology.corridorSurface, spec.wall]);
      expect(kinds.size).toBe(3);
    },
  );

  /**
   * The per-tile roll this replaced laid a second surface under one tile in five
   * or so, which is salt and pepper — the pattern `terrainDisplay` calls a
   * rendering fault — and meant no chamber had an edge anybody could see.
   */
  it('floors every room in one material', () => {
    const mixed: string[] = [];
    for (const spec of LAIR_SPECS) {
      const def = getLocation(spec.id);
      spec.topology.rooms.forEach((room, i) => {
        const want = room.surface ?? spec.surface;
        const off = getHexesInRange(room.centre, room.radius)
          .map((c) => def.tiles.find((t) => hexKey(t.coord) === hexKey(c))!)
          .filter((t) => !t.blocked && t.surface !== want);
        if (off.length) mixed.push(`${spec.id} room ${i}: ${off.length} tiles off ${want}`);
      });
    }
    expect(mixed).toEqual([]);
  });

  it('blocks no tile of any chamber', () => {
    const blocked: string[] = [];
    for (const spec of LAIR_SPECS) {
      const def = getLocation(spec.id);
      const floor = new Set(spec.topology.rooms.flatMap((r) => getHexesInRange(r.centre, r.radius).map(hexKey)));
      for (const t of def.tiles) {
        // A doorway's flanks are walled across its passage, never across the
        // chamber it opens into, and nothing furnished blocks a tile at all
        if (t.blocked && floor.has(hexKey(t.coord))) blocked.push(`${spec.id} ${hexKey(t.coord)}`);
      }
    }
    expect(blocked).toEqual([]);
  });

  it('uses more than one kind of floor in every lair', () => {
    const flat = LAIRS.filter(
      (l) => new Set(l.tiles.map((t) => t.surface)).size < 2,
    ).map((l) => l.id);
    expect(flat).toEqual([]);
  });
});

describe('lair layout', () => {
  it('builds one location per spec, each marked as a lair', () => {
    expect(LAIRS.length).toBe(LAIR_SPECS.length);
    expect(LAIRS.every((l) => !!l.lair)).toBe(true);
  });

  /**
   * The one that would silently break the game: a boss you cannot walk to is a
   * party slot that can never be earned, and the lair still looks finished.
   */
  it('can reach the boss from the entry, in every lair', () => {
    const stranded = LAIR_SPECS.filter(({ id }) => {
      const def = getLocation(id);
      const seen = new Set([hexKey(def.entry)]);
      const queue: HexCoord[] = [def.entry];
      while (queue.length > 0) {
        for (const n of getNeighbors(queue.shift()!)) {
          if (seen.has(hexKey(n)) || !isWalkable(id, n)) continue;
          seen.add(hexKey(n));
          queue.push(n);
        }
      }
      return !seen.has(hexKey(def.lair!.bossAt));
    });
    expect(stranded).toEqual([]);
  });

  it('puts two guarded rooms and two chests in every lair', () => {
    const wrong = LAIR_SPECS.filter(({ id }) => {
      const tiles = getLocation(id).tiles;
      const fights = tiles.filter((t) => t.trigger?.kind === 'encounter');
      const chests = tiles.filter((t) => t.trigger?.kind === 'chest');
      // Two chamber guards and the boss, plus a doorway guard on each chest room
      // that sits off the route to the boss — never more than one per chest.
      const guarded = tiles.filter((t) => t.trigger?.kind === 'encounter'
        && typeof t.trigger.encounterId === 'string'
        && t.trigger.encounterId.endsWith('_chest')).length;
      return fights.length !== 3 + guarded || chests.length !== 2 || guarded > 2;
    });
    expect(wrong).toEqual([]);
  });

  /**
   * **Nothing worth having in a lair can be reached without a fight.**
   *
   * This is the property the whole design rests on and it had never once held.
   * A trigger fires when the party *stops* on it and does not block a path, and
   * the guards stood at the centres of chambers two and three hexes in radius —
   * so the party could simply walk around them. Measured: the boss of all three
   * lairs was reachable from the entrance without triggering a single encounter,
   * and three of the six chests were free. A playtester reported exactly that
   * ("I didn't see any encounters in there") and then met a boss at full
   * strength, which is the opposite of the attrition a lair is built to be.
   *
   * Guards hold the *throat* of their chamber now, and where a lair's corridors
   * are wider than one hex the rest of that cross-section is walled — so the gap
   * the guard is standing in is the only way through. That in turn depends on the
   * rooms being spaced far enough apart for a throat to exist at all, which is
   * why the topologies moved and why this test is worth more than the spacing.
   *
   * Walking with every encounter treated as a wall is deliberately the whole
   * check: it makes no assumption about which guard covers what, so a topology
   * can be re-authored freely and this still means the same thing.
   */
  it('lets nothing be reached without a fight', () => {
    const offenders: string[] = [];

    for (const { id } of LAIR_SPECS) {
      const def = getLocation(id);
      const fights = new Set(
        def.tiles.filter((t) => t.trigger?.kind === 'encounter').map((t) => hexKey(t.coord)),
      );

      // Flood from the entry, stopping *on* any encounter rather than passing
      // through it — which is what a player who wants to avoid one would do.
      const seen = new Set([hexKey(def.entry)]);
      const queue = [def.entry];
      while (queue.length > 0) {
        const here = queue.shift()!;
        if (fights.has(hexKey(here))) continue;
        for (const n of getNeighbors(here)) {
          if (seen.has(hexKey(n)) || !isWalkable(id, n)) continue;
          seen.add(hexKey(n));
          queue.push(n);
        }
      }

      if (seen.has(hexKey(def.lair!.bossAt))) {
        offenders.push(`${id}: the boss can be walked to unfought`);
      }
      for (const chest of def.tiles.filter((t) => t.trigger?.kind === 'chest')) {
        if (seen.has(hexKey(chest.coord))) {
          offenders.push(`${id}: the chest at ${hexKey(chest.coord)} can be opened unfought`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * The flood fill above proves a guard stands in every way to a chest; this is
   * the half that makes the party stop for it. A tap walks the whole route in
   * one go and a trigger fires only where the party *stops*, so a chest tapped
   * from the entrance used to carry the party straight past its guard.
   */
  it('stops every walk to a chest at the first guard on the way', () => {
    const offenders: string[] = [];
    for (const { id } of LAIR_SPECS) {
      const def = getLocation(id);
      for (const chest of def.tiles.filter((t) => t.trigger?.kind === 'chest')) {
        const path = findPath(def.entry, chest.coord, (_from, to) => (isWalkable(id, to) ? 1 : null));
        if (!path) { offenders.push(`${id}: no way to the chest at ${hexKey(chest.coord)}`); continue; }
        const end = walkEnd(id, path, () => false);
        if (hexKey(end) === hexKey(chest.coord)) offenders.push(`${id}: walked straight to the chest at ${hexKey(chest.coord)}`);
        // Once that guard is beaten the same walk goes on to the chest
        const after = walkEnd(id, path, (c) => hexKey(c) === hexKey(end));
        if (hexKey(after) === hexKey(end)) offenders.push(`${id}: a spent guard still stops the walk`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Both chamber guards stand between the entrance and the boss (PT-21).
   *
   * The Wyrm's Hollow put its second guard on the side cave, off the route, so
   * the dragon was one fight from the door — and a party that lost to that guard
   * and came back for the dragon found nothing in the way. Walked the way a
   * player does it: tap the boss, fight whatever stops the walk, tap again.
   */
  it('makes the walk to every boss stop at both chamber guards first', () => {
    const offenders: string[] = [];
    for (const spec of LAIR_SPECS) {
      const def = getLocation(spec.id);
      const boss = def.lair!.bossAt;
      const beaten = new Set<string>();
      const met: string[] = [];
      let at = def.entry;
      for (let fights = 0; fights < 8 && hexKey(at) !== hexKey(boss); fights++) {
        const path = findPath(at, boss, (_from, to) => (isWalkable(spec.id, to) ? 1 : null));
        if (!path) break;
        at = walkEnd(spec.id, path, (c) => beaten.has(hexKey(c)));
        beaten.add(hexKey(at));
        const trigger = getLocation(spec.id).tiles.find((t) => hexKey(t.coord) === hexKey(at))?.trigger;
        if (trigger?.kind === 'encounter') met.push(trigger.encounterId);
      }
      const want = [spec.encounters[0], spec.encounters[1], spec.encounters[2]];
      if (met.join() !== want.join()) offenders.push(`${spec.id}: met ${met.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('makes the first chest a Legendary and the second two Epics, in every lair', () => {
    for (const { id } of LAIR_SPECS) {
      const kits = getLocation(id).tiles
        .filter((t) => t.trigger?.kind === 'chest')
        .map((t) => (t.trigger as { kit: string }).kit);
      expect(kits).toEqual(['legendary', 'epics']);
    }
  });

  it('gives every lair exactly one way out', () => {
    const wrong = LAIR_SPECS.filter(
      ({ id }) => getLocation(id).tiles.filter((t) => t.trigger?.kind === 'exit').length !== 1,
    );
    expect(wrong).toEqual([]);
  });

  it('staggers the gates, so the three never open together', () => {
    const gates = LAIR_SPECS.map((s) => s.unlockLevel);
    expect([...gates].sort((a, b) => a - b)).toEqual(gates);
    expect(new Set(gates).size).toBe(gates.length);
  });
});

describe('party slots', () => {
  it('starts short-handed', () => {
    expect(partySlots(spent())).toBe(BALANCE.PARTY_SLOTS_BASE);
  });

  it('pays out one slot per lair', () => {
    expect(partySlots(spent(bossKey(0)))).toBe(BALANCE.PARTY_SLOTS_BASE + 1);
    expect(partySlots(spent(bossKey(0), bossKey(1)))).toBe(BALANCE.PARTY_SLOTS_BASE + 2);
  });

  it('reaches exactly the full party when all three are done', () => {
    const all = spent(bossKey(0), bossKey(1), bossKey(2));
    expect(partySlots(all)).toBe(BALANCE.MAX_PARTY_SIZE);
    expect(allLairsCleared(all)).toBe(true);
  });

  /**
   * Completion is *derived* from the spent-trigger set rather than counted into
   * a field of its own. Clearing a chest in a lair must therefore not look like
   * clearing the lair.
   */
  it('is not moved by anything but the boss', () => {
    const chest = getLocation('lair_warren').tiles.find((t) => t.trigger?.kind === 'chest')!;
    const guard = getLocation('lair_warren').tiles.find(
      (t) => t.trigger?.kind === 'encounter' && hexKey(t.coord) !== hexKey(getLocation('lair_warren').lair!.bossAt),
    )!;
    const partial = spent(
      triggerKey('lair_warren', chest.coord),
      triggerKey('lair_warren', guard.coord),
    );
    expect(isLairCleared('lair_warren', partial)).toBe(false);
    expect(partySlots(partial)).toBe(BALANCE.PARTY_SLOTS_BASE);
  });

  it('never counts the same lair twice', () => {
    expect(clearedLairs(spent(bossKey(0), bossKey(0)))).toEqual(['lair_warren']);
  });

  it('never exceeds the party ceiling', () => {
    expect(partySlots(spent(bossKey(0), bossKey(1), bossKey(2)))).toBeLessThanOrEqual(
      BALANCE.MAX_PARTY_SIZE,
    );
  });
});

describe('the gate', () => {
  it('refuses a party that is not worth the run', () => {
    const gate = lairGate('lair_wyrm', 10, spent());
    expect(gate.open).toBe(false);
    expect('needed' in gate && gate.needed).toBe(22);
  });

  it('opens at exactly the stated level', () => {
    expect(lairGate('lair_wyrm', 21, spent()).open).toBe(false);
    expect(lairGate('lair_wyrm', 22, spent()).open).toBe(true);
  });

  it('closes again once the lair is empty', () => {
    const gate = lairGate('lair_warren', 99, spent(bossKey(0)));
    expect(gate.open).toBe(false);
    expect('cleared' in gate).toBe(true);
  });

  it('lets a non-lair location through untouched', () => {
    expect(lairGate('city', 1, spent()).open).toBe(true);
  });
});

describe('boss tiles on the map', () => {
  it('keeps every step to each lair within its difficulty across map seeds', () => {
    for (const seed of [1, 7, 42, 99, 777, 1234, 4242, 90210, 31337, 1471934286]) {
      const tiles = generateMap(seed);
      const map = new Map(tiles.map((tile) => [hexKey(tile.coord), tile]));
      const city = tiles.find((tile) => tile.poi === POIType.City)!;
      for (const spec of EMPIRE_LAIRS) {
        const door = tiles.find((tile) => tile.encounterId === spec.id)!;
        expect(door).toBeDefined();
        expect(reachableFromCity(city.coord, map, spec.band).has(hexKey(door.coord))).toBe(true);
      }
      const first = tiles.find((tile) => tile.encounterId === EMPIRE_LAIRS[0].id)!;
      expect(first.threat).toBe(EMPIRE_LAIRS[0].band);
    }
  });
  /**
   * The bug this replaces: the count was a density figure, so a 70x70 map
   * carried six boss tiles for three bosses and placed each of them twice.
   */
  it('places exactly one tile per lair', () => {
    for (const seed of [1, 7, 12345]) {
      const bosses = generateMap(seed).filter((t) => t.poi === POIType.BossTile);
      expect(bosses.length).toBe(EMPIRE_LAIRS.length);
      expect(new Set(bosses.map((t) => t.encounterId)).size).toBe(EMPIRE_LAIRS.length);
    }
  });

  it('points every boss tile at a lair that exists', () => {
    const ids = new Set(EMPIRE_LAIRS.map((s) => s.id));
    const bad = generateMap(99)
      .filter((t) => t.poi === POIType.BossTile)
      .filter((t) => !ids.has(t.encounterId as any))
      .map((t) => t.encounterId);
    expect(bad).toEqual([]);
  });

  it('maps an index to a lair, and past the end to nothing', () => {
    expect(lairForIndex(0)).toBe('lair_warren');
    expect(lairForIndex(EMPIRE_LAIRS.length)).toBeNull();
  });
});

describe('what waits inside', () => {
  it('fields one creature in every boss room', () => {
    for (const spec of LAIR_SPECS) {
      expect(generateEncounterEnemies(spec.encounters[2]).length).toBe(1);
    }
  });

  it('fields a crowd in every guard room', () => {
    for (const spec of LAIR_SPECS) {
      expect(generateEncounterEnemies(spec.encounters[0]).length).toBeGreaterThan(1);
    }
  });

  it('makes the second room harder than the first', () => {
    for (const spec of LAIR_SPECS) {
      expect(generateEncounterEnemies(spec.encounters[1]).length).toBeGreaterThan(
        generateEncounterEnemies(spec.encounters[0]).length,
      );
    }
  });

  it('gets harder from lair to lair within each world', () => {
    for (const world of ['empire', 'jadeveil'] as const) {
      const sizes = lairsOf(world).map((s) => generateEncounterEnemies(s.encounters[0]).length);
      expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
    }
  });

  // Three lairs, three different bosses — the thing six tiles used to get wrong
  it('puts a different boss in each lair', () => {
    const bosses = LAIR_SPECS.map((s) => generateEncounterEnemies(s.encounters[2])[0]);
    expect(new Set(bosses).size).toBe(LAIR_SPECS.length);
  });
});
