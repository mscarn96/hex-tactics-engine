import { TileType } from '@/models/types';
import type { LairSpec } from '../lairs';

/**
 * The Silent Hall: the Fallen Order lair, a mountain monastery where the
 * Last Lesson still teaches (the private project notes).
 *
 * Its own file so the lair's shape, dressing and boss stay in one place; it
 * imports only types from `lairs.ts`, which lists it.
 */
export const SILENT_HALL: LairSpec = {
  id: 'lair_hall',
  world: 'jadeveil',
  unlockLevel: 92,
  unlockOverBand: 12,
  levelOffset: 3,
  encounters: ['lair_hall_1', 'lair_hall_2', 'lair_hall_boss', 'lair_hall_chest'],
  // Worn temple boards in its halls, slate up its stairs, the mountain round both
  surface: 'temple_boards',
  // Cold and still: blue-grey air over the mountain's stone, nothing moving in it
  ambient: { fog: '#161a22', ground: '#262a32' },
  chestTier: 3,
  faction: 'fallen_order',
  band: 3,
  boss: 'last_lesson',
  site: { terrain: [TileType.Highlands, TileType.Mountain] },
  // A monastery climbing the mountain: a small gate court, a passage east to
  // the first hall, then long narrow stairs north-east to each hall in turn,
  // every hall higher up the slope than the last — the cloister where the novices drilled, the bell court, and the
  // master's hall at the top, the widest room in the lair. The two side halls
  // (a scriptorium off the cloister, a shrine off the bell court) hold the chests.
  // Spaced by the Warren's throat rule, so each guard holds a doorway.
  topology: {
    rooms: [
      { centre: { q: 0, r: 0 }, radius: 1 },
      { centre: { q: 6, r: 0 }, radius: 2 },
      { centre: { q: 5, r: 6 }, radius: 1 },
      { centre: { q: 12, r: -5 }, radius: 2 },
      { centre: { q: 12, r: 2 }, radius: 1 },
      { centre: { q: 20, r: -9 }, radius: 3 },
    ],
    links: [[0, 1], [1, 2], [1, 3], [3, 4], [3, 5]],
    corridorSurface: 'hall_slate',
    corridorWidth: 0,
    guardRooms: [1, 3],
    chestRooms: [2, 4],
    bossRoom: 5,
    entryDir: { q: -1, r: 0 },
  },
  wall: 'mountain_granite',
  // The Order's own monastery, kept after it fell: paper screens and a silent
  // bell on the walls the camera faces, the masters in stone along the sides
  // with their heads knocked off, prayer mats laid out for a lesson at the edges,
  // stone lanterns burning low, and snowed crags on the mountain above. At the
  // top, the master's seat: a red hanging and two red candles behind the boss.
  dressing: {
    back: {
      rate: 0.4,
      keys: [
        { key: 'lair_hall_screen', weight: 3 },
        { key: 'lair_hall_bell', weight: 1 },
      ],
    },
    side: {
      rate: 0.3,
      keys: [
        { key: 'lair_hall_statue', weight: 2 },
        { key: 'dungeon_rubble_0', weight: 1 },
      ],
    },
    edge: {
      rate: 0.14,
      keys: [
        { key: 'lair_hall_mats', weight: 2 },
        { key: 'dungeon_rubble_1', weight: 1 },
      ],
    },
    crown: { rate: 0.14, keys: [{ key: 'lair_hall_crag', weight: 1 }] },
    light: { key: 'lair_hall_lamp', spacing: 9 },
    guard: { key: 'lair_guard_post', low: 'lair_guard_cairn', spent: 'lair_guard_post_down' },
    boss: [
      { key: 'lair_hall_seat', x: 0, z: -0.1 },
      { key: 'lair_hall_lamp', x: -1.73, z: -0.1 },
      { key: 'lair_hall_lamp', x: 1.73, z: -0.1 },
    ],
    groups: [
      // The bell, a lantern beside it: one or two to the lair
      {
        at: 'back',
        count: 2,
        pieces: [
          { key: 'lair_hall_bell', x: 0, z: -0.1 },
          { key: 'lair_hall_lamp', x: 1.73, z: -0.05, scale: 0.9 },
        ],
      },
      // The masters lining the stairs, defaced
      {
        at: 'side',
        in: 'passage',
        count: 4,
        pieces: [
          { key: 'lair_hall_statue', x: -0.2, z: -0.05, scale: 0.8 },
          { key: 'dungeon_rubble_0', x: 0.4, z: -0.05, scale: 0.6 },
        ],
      },
      // A lesson laid out against a screen
      {
        at: 'back',
        count: 3,
        pieces: [
          { key: 'lair_hall_screen', x: 0, z: -0.2 },
          { key: 'lair_hall_mats', x: 1.73, z: 0, scale: 0.8 },
        ],
      },
    ],
  },
};
