import { GamePhase, POIType } from '@/models/types';
import { generateMap } from '@/systems/world/mapGenerator';

/**
 * What the save keeps of the Heart of Winter's refight (`empire.winterSeals`, `empire.heartTier`,
 * save 83): the Winter Seals held and the highest tier cleared, through a real write and a fresh
 * launch, so the ladder survives a reload.
 */

const mockDisk = new Map<string, string>();

jest.mock('@/platform/keyValueStore', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockDisk.set(key, value); },
  },
}));

const SEED = 20261103;

function launch() {
  jest.resetModules();
  return {
    save: require('@/systems/save/persistence') as typeof import('@/systems/save/persistence'),
    game: require('@/stores/gameStore').useGameStore as typeof import('@/stores/gameStore').useGameStore,
    party: require('@/stores/partyStore').usePartyStore as typeof import('@/stores/partyStore').usePartyStore,
    world: require('@/stores/worldMapStore').useWorldMapStore as typeof import('@/stores/worldMapStore').useWorldMapStore,
    empire: require('@/stores/empireStore').useEmpireStore as typeof import('@/stores/empireStore').useEmpireStore,
  };
}

beforeEach(() => mockDisk.clear());

it('keeps the Winter Seals and the highest Heart tier through a save and a reload', async () => {
  const app = launch();
  const tiles = generateMap(SEED);
  app.world.getState().setTiles(tiles, SEED);
  app.world.getState().moveParty(tiles.find((t) => t.poi === POIType.City)!.coord);
  app.game.getState().startHeroSelect(SEED);
  app.party.getState().addHero('warrior');
  app.game.getState().confirmHeroSelect('warrior');
  app.game.getState().setPhase(GamePhase.WorldMap);

  app.empire.getState().clearHeart(1);
  expect(app.empire.getState().enterHeart(2, true)).toBe(true);
  app.empire.getState().clearHeart(2);
  app.empire.getState().clearHeart(4);
  const held = { winterSeals: app.empire.getState().winterSeals, heartTier: app.empire.getState().heartTier };
  expect(held).toEqual({ winterSeals: [0, 0, 1, 0, 1], heartTier: 4 });
  await app.save.saveGame();

  const restarted = launch();
  expect(restarted.empire.getState().heartTier).toBe(0);
  expect(await restarted.save.loadGame()).toBe(true);
  expect(restarted.empire.getState()).toMatchObject(held);
});
