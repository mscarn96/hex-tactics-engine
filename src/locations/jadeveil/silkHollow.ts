import { TileType } from '@/models/types';
import type { LairSpec } from '../lairs';

/**
 * The Silk Hollow: the Yokai lair in Jadeveil's bamboo, where the Jorōgumo
 * weaves over the chamber she waits in (the private project notes).
 *
 * Its own file so the lair's shape, dressing and boss stay in one place; it
 * imports only types from `lairs.ts`, which lists it.
 */
export const SILK_HOLLOW: LairSpec = {
  id: 'lair_silk',
  world: 'jadeveil',
  unlockLevel: 84,
  unlockOverBand: 4,
  levelOffset: 1,
  encounters: ['lair_silk_1', 'lair_silk_2', 'lair_silk_boss', 'lair_silk_chest'],
  // Pale moss under a skin of silk in her chambers, bamboo litter in the runs between,
  // and the dark root of the bamboo the hollow is grown out of (`terrainDisplay`)
  surface: 'silkmoss',
  ambient: { fog: '#1a2418', ground: '#26301e' },
  chestTier: 3,
  faction: 'yokai',
  band: 2,
  boss: 'jorogumo',
  site: { terrain: [TileType.Forest, TileType.Plains] },
  // A hollow in the bamboo, not a dug burrow or a cave: a narrow way in past one small
  // guarded den, then the great web hall — wider than her own nest, with its chest in
  // the middle of it — a cocoon cave straight off its north side,
  // and a second den on the way out of the hall to her nest. Spaced by The Warren's throat
  // rule (every linked pair further apart than their radii plus one).
  topology: {
    rooms: [
      { centre: { q: 0, r: 0 }, radius: 1 },
      { centre: { q: 5, r: 2 }, radius: 1 },
      { centre: { q: 11, r: 0 }, radius: 3 },
      { centre: { q: 11, r: -8 }, radius: 1 },
      { centre: { q: 19, r: 1 }, radius: 2 },
      { centre: { q: 25, r: -3 }, radius: 2 },
    ],
    links: [[0, 1], [1, 2], [2, 3], [2, 4], [4, 5]],
    corridorSurface: 'bamboo',
    corridorWidth: 0,
    guardRooms: [1, 4],
    chestRooms: [2, 3],
    bossRoom: 5,
    entryDir: { q: -1, r: 0 },
  },
  wall: 'rootwall',
  // Old bamboo grown into the walls with her silk strung between, cocoons of what she
  // caught along the edges, moss and fern where the floor meets the root, and foxfire
  // in the Yokai's paper lanterns: the one light, cold.
  dressing: {
    back: {
      rate: 0.45,
      keys: [
        { key: 'lair_bamboo_culms', weight: 3 },
        { key: 'lair_silk_sheet', weight: 2 },
      ],
    },
    side: {
      rate: 0.3,
      keys: [
        { key: 'lair_cocoon', weight: 2 },
        { key: 'arena_ferns_0', weight: 1 },
      ],
    },
    edge: {
      rate: 0.16,
      keys: [
        { key: 'lair_moss_fern', weight: 2 },
        { key: 'dungeon_web', weight: 1 },
        { key: 'dungeon_bones_1', weight: 1, scale: 0.8 },
      ],
    },
    crown: { rate: 0, keys: [] },
    light: { key: 'lair_foxfire_lantern', spacing: 8 },
    guard: { key: 'lair_guard_post', low: 'lair_guard_cairn', spent: 'lair_guard_post_down' },
    // Her nest against the back of her chamber, cocoons either side
    boss: [
      { key: 'lair_weaver_nest', x: 0, z: -0.2, scale: 0.85 },
      { key: 'lair_cocoon', x: -1.73, z: -0.1 },
      { key: 'lair_cocoon', x: 1.73, z: -0.1, turn: 0.5 },
    ],
    groups: [
      // The web strung across the hollow's walls, and what hangs in it
      {
        at: 'back',
        count: 4,
        pieces: [
          { key: 'lair_silk_sheet', x: 0, z: -0.15 },
          { key: 'lair_cocoon', x: 1.73, z: -0.05, scale: 0.8 },
        ],
      },
      // Bamboo along the runs
      { at: 'back', in: 'passage', count: 4, pieces: [{ key: 'lair_bamboo_culms', x: 0, z: -0.15 }] },
      // Cocoons and fern down the sides
      {
        at: 'side',
        in: 'any',
        count: 4,
        pieces: [
          { key: 'lair_cocoon', x: -0.2, z: -0.05, scale: 0.9 },
          { key: 'lair_moss_fern', x: 0.35, z: -0.1, scale: 0.8 },
        ],
      },
    ],
  },
};
