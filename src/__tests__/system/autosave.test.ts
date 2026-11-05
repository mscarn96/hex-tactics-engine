import { GamePhase, POIType } from '@/models/types';
import { generateMap } from '@/systems/world/mapGenerator';

/**
 * The saves taken while the game is played (`systems/save/autosave`).
 *
 * A playtest lost an hour to a crash: the only writes were the app going behind
 * and Save & quit, and a crash is neither. Each `launch()` is a cold start over
 * the same disk, as in `backgroundSave.test.ts`.
 */

const mockDisk = new Map<string, string>();
const mockWrites: string[] = [];

jest.mock('@/platform/keyValueStore', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    removeItem: async (key: string) => { mockDisk.delete(key); },
    setItem: async (key: string, value: string) => {
      mockWrites.push(key);
      mockDisk.set(key, value);
    },
  },
}));

interface App {
  autosave: typeof import('@/systems/save/autosave');
  game: typeof import('@/stores/gameStore').useGameStore;
  party: typeof import('@/stores/partyStore').usePartyStore;
  world: typeof import('@/stores/worldMapStore').useWorldMapStore;
  clock: typeof import('@/stores/calendarStore').useCalendarStore;
}

function launch(): App {
  jest.resetModules();
  return {
    autosave: require('@/systems/save/autosave'),
    game: require('@/stores/gameStore').useGameStore,
    party: require('@/stores/partyStore').usePartyStore,
    world: require('@/stores/worldMapStore').useWorldMapStore,
    clock: require('@/stores/calendarStore').useCalendarStore,
  };
}

const SEED = 20261013;
const saved = () => JSON.parse(mockDisk.get('engine_save')!);

function campaign(app: App) {
  const tiles = generateMap(SEED);
  app.world.getState().setTiles(tiles);
  app.world.getState().moveParty(tiles.find((t) => t.poi === POIType.City)!.coord);
  app.game.getState().startHeroSelect(SEED);
  app.party.getState().addHero('warrior');
  app.game.getState().confirmHeroSelect('warrior');
}

/** Past the coalescing delay, with the write's promises settled. */
async function settle(app: App) {
  await jest.advanceTimersByTimeAsync(app.autosave.AUTOSAVE_DELAY_MS + 10);
}

let uninstall: (() => void) | undefined;

beforeEach(() => {
  jest.useFakeTimers();
  mockDisk.clear();
  mockWrites.length = 0;
});

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  jest.useRealTimers();
});

it('saves the campaign once it opens, without a background or a quit', async () => {
  const app = launch();
  uninstall = app.autosave.installAutosave();
  campaign(app);
  await settle(app);
  expect(saved().game.phase).toBe(GamePhase.Location);
  expect(saved().party.heroes).toHaveLength(1);
});

it('coalesces a burst of changes into one write', async () => {
  const app = launch();
  uninstall = app.autosave.installAutosave();
  campaign(app);
  app.game.getState().setPhase(GamePhase.WorldMap);
  app.game.getState().setPhase(GamePhase.Location);
  await settle(app);
  expect(mockWrites).toHaveLength(1);
});

it('saves on a new day of travel', async () => {
  const app = launch();
  uninstall = app.autosave.installAutosave();
  campaign(app);
  await settle(app);
  mockWrites.length = 0;

  app.clock.getState().advance(1);
  await settle(app);
  // An hour inside the same day is not a checkpoint
  if (app.clock.getState().dayNumber === 1) expect(mockWrites).toEqual([]);
  app.clock.getState().advance(24);
  await settle(app);
  expect(mockWrites).toHaveLength(1);
  expect(saved().worldMap.totalHours).toBe(app.clock.getState().totalHours);
});

it('writes nothing from the menu or hero select', async () => {
  const app = launch();
  uninstall = app.autosave.installAutosave();
  app.game.getState().startHeroSelect(SEED);
  await settle(app);
  await jest.advanceTimersByTimeAsync(app.autosave.AUTOSAVE_INTERVAL_MS + 10);
  expect(mockWrites).toEqual([]);
});

it('keeps a safety net outside fights, and skips it inside one', async () => {
  const app = launch();
  uninstall = app.autosave.installAutosave();
  campaign(app);
  await settle(app);
  mockWrites.length = 0;

  await jest.advanceTimersByTimeAsync(app.autosave.AUTOSAVE_INTERVAL_MS + app.autosave.AUTOSAVE_DELAY_MS + 10);
  expect(mockWrites).toHaveLength(1);

  app.game.getState().startEncounter('autosave_test');
  await settle(app);
  mockWrites.length = 0;
  await jest.advanceTimersByTimeAsync(app.autosave.AUTOSAVE_INTERVAL_MS + app.autosave.AUTOSAVE_DELAY_MS + 10);
  expect(mockWrites).toEqual([]);
});

it('stops when uninstalled', async () => {
  const app = launch();
  app.autosave.installAutosave()();
  campaign(app);
  await settle(app);
  expect(mockWrites).toEqual([]);
});
