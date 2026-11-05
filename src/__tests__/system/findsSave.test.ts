import { GamePhase, POIType } from '@/models/types';
import { generateMap } from '@/systems/world/mapGenerator';
import { rollWeeklyFinds } from '@/systems/world/finds';
import { hexKey } from '@/utils/hexUtils';

/**
 * What the save keeps of the week's finds: exactly what is still on the map.
 * A claimed find is one the deal no longer holds, so the save carries the
 * record rather than re-dealing from the seed on load.
 */

const mockDisk = new Map<string, string>();

jest.mock('@/platform/keyValueStore', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockDisk.set(key, value); },
  },
}));

const SEED = 20261003;

function launch() {
  jest.resetModules();
  return {
    save: require('@/systems/save/persistence') as typeof import('@/systems/save/persistence'),
    game: require('@/stores/gameStore').useGameStore as typeof import('@/stores/gameStore').useGameStore,
    party: require('@/stores/partyStore').usePartyStore as typeof import('@/stores/partyStore').usePartyStore,
    world: require('@/stores/worldMapStore').useWorldMapStore as typeof import('@/stores/worldMapStore').useWorldMapStore,
  };
}

beforeEach(() => mockDisk.clear());

it('restores the unclaimed finds, and a claimed one stays claimed', async () => {
  const app = launch();
  const tiles = generateMap(SEED);
  app.world.getState().setTiles(tiles, SEED);
  app.world.getState().moveParty(tiles.find((t) => t.poi === POIType.City)!.coord);
  app.game.getState().startHeroSelect(SEED);
  app.party.getState().addHero('warrior');
  app.game.getState().confirmHeroSelect('warrior');
  app.game.getState().setPhase(GamePhase.WorldMap);

  const taken = [...app.world.getState().finds.values()][0];
  app.world.getState().claimFind(taken.coord);
  const remaining = [...app.world.getState().finds.keys()];
  await app.save.saveGame();

  const restarted = launch();
  expect(await restarted.save.loadGame()).toBe(true);
  const loaded = restarted.world.getState();
  expect([...loaded.finds.keys()]).toEqual(remaining);
  expect(loaded.finds.has(hexKey(taken.coord))).toBe(false);
  expect(loaded.mapSeed).toBe(SEED);
  // The deal for the week is still the seed's, so the next week deals from it.
  expect(rollWeeklyFinds(loaded.tiles.values(), loaded.mapSeed, 1).size).toBeGreaterThan(remaining.length);
});

it('refuses a save with no record of the finds', async () => {
  const app = launch();
  const tiles = generateMap(SEED);
  app.world.getState().setTiles(tiles, SEED);
  app.game.getState().startHeroSelect(SEED);
  app.party.getState().addHero('warrior');
  app.game.getState().confirmHeroSelect('warrior');
  await app.save.saveGame();
  const save = JSON.parse(mockDisk.get('engine_save')!);
  delete save.worldMap.worlds.empire.finds;
  mockDisk.set('engine_save', JSON.stringify(save));
  expect(await launch().save.loadGame()).toBe(false);
});
