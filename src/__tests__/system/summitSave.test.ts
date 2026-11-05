import { GamePhase, POIType } from '@/models/types';
import { generateMap } from '@/systems/world/mapGenerator';

/**
 * Jadeveil: what the save keeps of Kairen's summit (`ascent.summit`, save 61) — that he
 * was slain, the Storm Seals held and the highest tier cleared — through a real write
 * and a fresh launch, so a refight's ladder and the one-time story survive a reload.
 */

const mockDisk = new Map<string, string>();

jest.mock('@/platform/keyValueStore', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockDisk.set(key, value); },
  },
}));

const SEED = 20261016;

function launch() {
  jest.resetModules();
  return {
    save: require('@/systems/save/persistence') as typeof import('@/systems/save/persistence'),
    game: require('@/stores/gameStore').useGameStore as typeof import('@/stores/gameStore').useGameStore,
    party: require('@/stores/partyStore').usePartyStore as typeof import('@/stores/partyStore').usePartyStore,
    world: require('@/stores/worldMapStore').useWorldMapStore as typeof import('@/stores/worldMapStore').useWorldMapStore,
    ascent: require('@/stores/ascentStore').useAscentStore as typeof import('@/stores/ascentStore').useAscentStore,
  };
}

beforeEach(() => mockDisk.clear());

it('keeps Kairen slain, the Storm Seals and the highest tier through a save and a reload', async () => {
  const app = launch();
  const tiles = generateMap(SEED);
  app.world.getState().setTiles(tiles, SEED);
  app.world.getState().moveParty(tiles.find((t) => t.poi === POIType.City)!.coord);
  app.game.getState().startHeroSelect(SEED);
  app.party.getState().addHero('warrior');
  app.game.getState().confirmHeroSelect('warrior');
  app.game.getState().setPhase(GamePhase.WorldMap);

  app.ascent.getState().clearSummit(1);
  app.ascent.getState().enterSummit(2, false);
  app.ascent.getState().clearSummit(2);
  app.ascent.getState().clearSummit(4);
  const held = app.ascent.getState().summit;
  expect(held).toEqual({ slain: true, seals: [0, 0, 1, 0, 1], highestTier: 4 });
  await app.save.saveGame();

  const restarted = launch();
  expect(restarted.ascent.getState().summit.slain).toBe(false);
  expect(await restarted.save.loadGame()).toBe(true);
  expect(restarted.ascent.getState().summit).toEqual(held);
  // and the next clear is a refight, not a story
  expect(restarted.ascent.getState().clearSummit(3).firstKill).toBe(false);
});
