import { GamePhase, POIType } from '@/models/types';
import { generateMap } from '@/systems/world/mapGenerator';
import type { HexCoord } from '@/utils/hexUtils';

/**
 * PT-21: "I lost a fight in the lair just before the dragon, came back and did
 * not have to fight it again — the encounter disappeared."
 *
 * A lost lair fight must leave its guard standing, however the party gets back
 * to the lair: straight back after the defeat, after the save the defeat writes
 * is loaded cold, and after a save taken in the middle of the fight is loaded and
 * that fight is lost again. The app is started cold over one disk, as in
 * `backgroundSave.test.ts`.
 */

const mockDisk = new Map<string, string>();
jest.mock('@/platform/keyValueStore', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    removeItem: async (key: string) => { mockDisk.delete(key); },
    setItem: async (key: string, value: string) => { mockDisk.set(key, value); },
  },
}));

const LAIR = 'lair_wyrm';
const GUARD = 'lair_wyrm_2';
const SEED = 20261021;

interface App {
  save: typeof import('@/systems/save/persistence');
  game: typeof import('@/stores/gameStore').useGameStore;
  party: typeof import('@/stores/partyStore').usePartyStore;
  world: typeof import('@/stores/worldMapStore').useWorldMapStore;
  location: typeof import('@/stores/locationStore').useLocationStore;
  combat: typeof import('@/stores/combatStore').useCombatStore;
  resolution: typeof import('@/systems/combat/encounterResolution');
  places: typeof import('@/locations');
  paths: typeof import('@/systems/world/pathfinding');
}

function launch(): App {
  jest.resetModules();
  return {
    save: require('@/systems/save/persistence'),
    game: require('@/stores/gameStore').useGameStore,
    party: require('@/stores/partyStore').usePartyStore,
    world: require('@/stores/worldMapStore').useWorldMapStore,
    location: require('@/stores/locationStore').useLocationStore,
    combat: require('@/stores/combatStore').useCombatStore,
    resolution: require('@/systems/combat/encounterResolution'),
    places: require('@/locations'),
    paths: require('@/systems/world/pathfinding'),
  };
}

/** A campaign whose party stands on the Wyrm's Hollow's door. */
function campaignAtTheLair(): App {
  const app = launch();
  const tiles = generateMap(SEED);
  app.world.getState().setTiles(tiles);
  app.world.getState().moveParty(tiles.find((t) => t.poi === POIType.City)!.coord);
  app.game.getState().startHeroSelect(SEED);
  app.party.getState().addHero('warrior');
  app.game.getState().confirmHeroSelect('warrior');
  const door = tiles.find((t) => t.poi === POIType.BossTile && t.encounterId === LAIR);
  if (door) app.world.getState().moveParty(door.coord);
  // The first chamber's guard is already beaten: the one that matters is the
  // guard at the dragon's door
  app.game.getState().enterLocation(LAIR);
  app.location.getState().hold(guardOf(app, 'lair_wyrm_1'));
  app.location.getState().resolvePending();
  return app;
}

const guardOf = (app: App, encounterId: string): HexCoord =>
  app.places.getLocation(LAIR).tiles.find((t) => t.trigger?.kind === 'encounter' && t.trigger.encounterId === encounterId)!.coord;
const guardAt = (app: App): HexCoord => guardOf(app, GUARD);

/** The party walks into the lair and taps the dragon: where does the walk stop? */
function walkToTheDragon(app: App): HexCoord {
  app.game.getState().enterLocation(LAIR);
  const { position } = app.location.getState();
  const boss = app.places.getLocation(LAIR).lair!.bossAt;
  const path = app.paths.findPath(position, boss, (_f, to) => (app.places.isWalkable(LAIR, to) ? 1 : null))!;
  return app.places.walkEnd(LAIR, path, app.location.getState().isSpent);
}

/** `LocationScene.fireTrigger` for the guard: held, not spent, and the fight starts. */
function meetTheGuard(app: App) {
  const at = walkToTheDragon(app);
  expect(at).toEqual(guardAt(app));
  app.location.getState().moveTo(at);
  app.location.getState().hold(at);
  app.game.getState().startEncounter(GUARD, app.places.locationContext(LAIR, at));
}

/** `CombatScene.handleDefeat`, past the dialog. */
function loseTheFight(app: App) {
  app.resolution.applyDefeat(null, { castleRun: null, isSiege: false });
  app.combat.getState().reset();
  app.game.getState().endEncounterIn('city');
}

beforeEach(() => mockDisk.clear());

describe('a lost lair fight leaves its guard standing (PT-21)', () => {
  it('straight back to the lair after the defeat', () => {
    const app = campaignAtTheLair();
    meetTheGuard(app);
    loseTheFight(app);

    expect(app.game.getState().phase).toBe(GamePhase.Location);
    expect(app.location.getState().current).toBe('city');
    expect(app.location.getState().pending).toBeNull();
    // The fight is over: nothing of it is left to be restored or saved
    expect(app.game.getState().currentEncounterId).toBeNull();
    expect(app.game.getState().encounterEntry).toBeNull();

    expect(walkToTheDragon(app)).toEqual(guardAt(app));
  });

  it('after the save the defeat writes is loaded cold', async () => {
    const app = campaignAtTheLair();
    meetTheGuard(app);
    await app.save.saveGame();
    loseTheFight(app);
    await app.save.saveGame();

    const next = launch();
    expect(await next.save.loadGame()).toBe(true);
    expect(next.game.getState().phase).not.toBe(GamePhase.Combat);
    expect(next.location.getState().isSpent(guardAt(next))).toBe(false);
    expect(walkToTheDragon(next)).toEqual(guardAt(next));
  });

  it('after a mid-fight save is loaded and the fight is lost again', async () => {
    const app = campaignAtTheLair();
    meetTheGuard(app);
    await app.save.saveGame();

    const resumed = launch();
    expect(await resumed.save.loadGame()).toBe(true);
    expect(resumed.game.getState().phase).toBe(GamePhase.Combat);
    expect(resumed.location.getState().pending).toEqual(guardAt(resumed));
    loseTheFight(resumed);
    await resumed.save.saveGame();

    const later = launch();
    expect(await later.save.loadGame()).toBe(true);
    expect(walkToTheDragon(later)).toEqual(guardAt(later));
  });

  it('the guard is only spent by winning', () => {
    const app = campaignAtTheLair();
    meetTheGuard(app);
    app.resolution.applyVictory(
      { kind: 'combat', xpPerHero: 0, gold: 0, items: [], gems: [], resources: [] },
      { units: [], encounterId: GUARD, castleRun: null, guardsChest: false },
    );
    app.game.getState().endEncounter();
    expect(app.location.getState().isSpent(guardAt(app))).toBe(true);
  });
});
