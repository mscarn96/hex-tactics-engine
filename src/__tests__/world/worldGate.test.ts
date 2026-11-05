import { GamePhase, MapTile, POIType, ResourceType } from '@/models/types';
import { generateMap, movementCost, reachableFromCity } from '@/systems/world/mapGenerator';
import { BALANCE } from '@/data/balanceConstants';
import { JADEVEIL_WORLD, worldDef, worldSeed } from '@/data/worlds';
import { gateArrival } from '@/systems/world/worldTravel';
import { campaignRoads, gateDestination, gateOffer, gateRoads, gateState } from '@/systems/world/worldGates';
import type { RoadState } from '@/data/levelCap';
import type { WorldId } from '@/data/worlds';
import { hexDistance, hexKey } from '@/utils/hexUtils';

/**
 * The crossing (`systems/world/worldGates.ts`, `worldTravel.ts`): a gate of its own
 * in the Empire, opened by the Emperor's fall and then one road at a time, an arrival
 * camp at the far end, and a road back that never touches the castle gauntlet.
 */

const SEEDS = [42, 4242, 1471934286, 20261005, 99, 7];
const gateOf = (tiles: MapTile[]) => tiles.filter((t) => t.poi === POIType.WorldGate);

describe('the Empire’s world gate', () => {
  it.each(SEEDS)('stands alone, on walkable road the city can reach, well clear of the castle (seed %i)', (seed) => {
    const tiles = generateMap(seed);
    const byKey = new Map(tiles.map((t) => [hexKey(t.coord), t] as const));
    const gates = gateOf(tiles);
    expect(gates).toHaveLength(1);
    const [gate] = gates;
    const castle = tiles.find((t) => t.poi === POIType.EmpireCastle)!;
    const city = tiles.find((t) => t.poi === POIType.City)!;
    expect(gate.zone).toBe('road');
    expect(hexDistance(gate.coord, castle.coord)).toBeGreaterThanOrEqual(BALANCE.WORLD_GATE_MIN_CASTLE_DISTANCE);
    expect(reachableFromCity(city.coord, byKey).has(hexKey(gate.coord))).toBe(true);
    const out = gateArrival(byKey, 'empire');
    expect(byKey.get(hexKey(out))?.poi).toBeUndefined();
    expect(movementCost(byKey.get(hexKey(out))!, gate)).not.toBeNull();
    expect(byKey.get(hexKey(out))!.threat ?? 0).toBeLessThanOrEqual(gate.threat ?? 0);
  });

  it('arrives in Jadeveil beside its camp, from where the whole road home is walkable', () => {
    const tiles = generateMap(worldSeed(42, 'jadeveil'), JADEVEIL_WORLD);
    const byKey = new Map(tiles.map((t) => [hexKey(t.coord), t] as const));
    const camp = gateOf(tiles);
    expect(camp.map((t) => hexKey(t.coord))).toEqual([hexKey(JADEVEIL_WORLD.home)]);
    const out = gateArrival(byKey, 'jadeveil');
    expect(hexDistance(out, JADEVEIL_WORLD.home)).toBe(1);
    expect(movementCost(byKey.get(hexKey(out))!, camp[0])).not.toBeNull();
  });
});

describe('which roads a gate offers', () => {
  const state = (patch: Partial<RoadState> = {}): RoadState =>
    ({ owned: ['jadeveil'], emperorDefeated: true, banded: [], finished: [], ...patch });
  const two: WorldId[] = ['jadeveil', 'archipelago'];

  it('is shut until the Emperor falls, and the far camp always leads home', () => {
    expect(gateState('empire', 'jadeveil', state({ emperorDefeated: false }))).toEqual({ open: false, to: 'jadeveil', reason: 'emperor' });
    expect(gateState('empire', 'jadeveil', state())).toEqual({ open: true, to: 'jadeveil', band: 1, first: true });
    expect(gateState('jadeveil', 'empire', state({ emperorDefeated: false }))).toEqual({ open: true, to: 'empire', band: null, first: false });
  });

  // Ownership first: an unowned campaign is never told the Emperor is what bars it
  it('stays shut without the expansion, Emperor or not, and never shuts the way home', () => {
    for (const emperorDefeated of [false, true]) {
      expect(gateState('empire', 'jadeveil', state({ owned: [], emperorDefeated }))).toEqual({ open: false, to: 'jadeveil', reason: 'unowned' });
    }
    expect(gateState('jadeveil', 'empire', state({ owned: [] })).open).toBe(true);
    expect(gateState('archipelago', 'empire', state({ owned: [] })).open).toBe(true);
  });

  it('shuts a second world until the first world’s orb boss falls, and names who holds it', () => {
    const onTheRoad = state({ owned: two, banded: ['archipelago'] });
    expect(gateState('empire', 'jadeveil', onTheRoad)).toEqual({ open: false, to: 'jadeveil', reason: 'orb', world: 'archipelago' });
    // The road already taken stays open, and is not a first crossing
    expect(gateState('empire', 'archipelago', onTheRoad)).toEqual({ open: true, to: 'archipelago', band: 1, first: false });
    expect(gateState('empire', 'jadeveil', { ...onTheRoad, finished: ['archipelago'] }))
      .toEqual({ open: true, to: 'jadeveil', band: 2, first: true });
  });

  it('offers any owned world while a crossing is free, the gate’s own first', () => {
    expect(gateRoads('empire', true)).toEqual(['jadeveil', 'archipelago']);
    expect(gateOffer('empire', state({ owned: two }), true).map((r) => [r.to, r.open])).toEqual([['jadeveil', true], ['archipelago', true]]);
    expect(gateDestination('jadeveil')).toBe('empire');
    expect(gateRoads('jadeveil', true)).toEqual(['empire']);
    expect(gateRoads('archipelago', true)).toEqual(['empire']);
  });

  it('reads the open worlds the party has not entered', () => {
    expect(campaignRoads(state({ owned: two }), true).unentered).toEqual(['jadeveil', 'archipelago']);
    expect(campaignRoads(state({ owned: two, banded: ['jadeveil'] }), true).unentered).toEqual([]);
    expect(campaignRoads(state({ owned: two, banded: ['jadeveil'], finished: ['jadeveil'] }), true).unentered).toEqual(['archipelago']);
    expect(campaignRoads(state({ owned: [] }), true).unentered).toEqual([]);
  });
});

describe('crossing and crossing back', () => {
  const SEED = 20261015;

  function launch(owned = true) {
    jest.resetModules();
    const entitlements = require('@/stores/entitlementStore') as typeof import('@/stores/entitlementStore');
    entitlements.resetEntitlementsForTest(owned ? ['jadeveil'] : []);
    return {
      travel: require('@/systems/world/worldTravel') as typeof import('@/systems/world/worldTravel'),
      game: require('@/stores/gameStore').useGameStore as typeof import('@/stores/gameStore').useGameStore,
      party: require('@/stores/partyStore').usePartyStore as typeof import('@/stores/partyStore').usePartyStore,
      inventory: require('@/stores/inventoryStore').useInventoryStore as typeof import('@/stores/inventoryStore').useInventoryStore,
      world: require('@/stores/worldMapStore').useWorldMapStore as typeof import('@/stores/worldMapStore').useWorldMapStore,
      empire: require('@/stores/empireStore').useEmpireStore as typeof import('@/stores/empireStore').useEmpireStore,
      location: require('@/stores/locationStore').useLocationStore as typeof import('@/stores/locationStore').useLocationStore,
      clock: require('@/stores/calendarStore').useCalendarStore as typeof import('@/stores/calendarStore').useCalendarStore,
      resolution: require('@/systems/combat/encounterResolution') as typeof import('@/systems/combat/encounterResolution'),
      bands: require('@/stores/worldBandStore').useWorldBandStore as typeof import('@/stores/worldBandStore').useWorldBandStore,
      cap: require('@/data/levelCap') as typeof import('@/data/levelCap'),
    };
  }

  const gateHere = (app: ReturnType<typeof launch>) =>
    [...app.world.getState().tiles.values()].find((t) => t.poi === POIType.WorldGate)!.coord;

  it('keeps both maps and the whole party through repeated crossings, and never enters the gauntlet', () => {
    const app = launch();
    app.world.getState().setTiles(generateMap(SEED), SEED);
    app.game.getState().startHeroSelect(SEED);
    app.party.getState().addHero('warrior');
    app.game.getState().confirmHeroSelect('warrior');
    app.game.getState().setPhase(GamePhase.WorldMap);
    app.location.getState().leave();
    app.inventory.getState().addResource(ResourceType.Gold, 77);

    // Shut while the Emperor holds the throne.
    app.world.getState().moveParty(gateHere(app));
    expect(app.travel.crossWorldGate()).toBe(false);
    expect(app.world.getState().worldId).toBe('empire');
    app.empire.getState().setEmperorDefeated(true);

    const heroes = JSON.stringify(app.party.getState().heroes.map((h) => [h.id, h.level, h.xp]));
    const gold = app.inventory.getState().resources.gold;
    const marks = new Map<string, Set<string>>();
    const explored = () => new Set([...app.world.getState().tiles.values()].filter((t) => t.explored).map((t) => hexKey(t.coord)));

    for (let crossing = 0; crossing < 4; crossing++) {
      const from = app.world.getState().worldId;
      const hours = app.clock.getState().totalHours;
      app.world.getState().moveParty(gateHere(app), 0);
      marks.set(from, explored());
      expect(app.travel.crossWorldGate()).toBe(true);

      const state = app.world.getState();
      expect(state.worldId).not.toBe(from);
      expect(app.clock.getState().totalHours).toBe(hours + BALANCE.WORLD_CROSSING_HOURS);
      // Standing beside the gate, on a hex it can step back from.
      expect(hexDistance(state.partyPosition, gateHere(app))).toBe(1);
      expect(state.tiles.get(hexKey(state.partyPosition))?.poi).toBeUndefined();
      // Whatever this world was left with, it still has.
      const before = marks.get(state.worldId);
      if (before) for (const key of before) expect(state.tiles.get(key)?.explored).toBe(true);

      expect(JSON.stringify(app.party.getState().heroes.map((h) => [h.id, h.level, h.xp]))).toBe(heroes);
      expect(app.inventory.getState().resources.gold).toBe(gold);
      expect(app.game.getState().phase).toBe(GamePhase.WorldMap);
      expect(app.location.getState().current).toBeNull();
      expect(app.empire.getState().castleTier).toBeNull();
    }
    expect(app.world.getState().worldId).toBe('empire');
  });

  it('keeps an unowned party in the Empire, and lets an owner who lost the entitlement walk home', () => {
    const app = launch(false);
    const entitlements = require('@/stores/entitlementStore') as typeof import('@/stores/entitlementStore');
    app.world.getState().setTiles(generateMap(SEED), SEED);
    app.game.getState().startHeroSelect(SEED);
    app.empire.getState().setEmperorDefeated(true);
    app.world.getState().moveParty(gateHere(app));
    expect(app.travel.crossWorldGate()).toBe(false);
    expect(app.world.getState().worldId).toBe('empire');

    entitlements.useEntitlementStore.getState().setTestOwned('jadeveil', true);
    expect(app.travel.crossWorldGate()).toBe(true);
    entitlements.useEntitlementStore.getState().setTestOwned('jadeveil', false);
    app.world.getState().moveParty(gateHere(app), 0);
    expect(app.travel.crossWorldGate()).toBe(true);
    expect(app.world.getState().worldId).toBe('empire');
  });

  // Playtest 2026-10-21-b: walking out through the camp's red gate said nothing,
  // because the camp's scene, not the map's, made the crossing and then unmounted.
  it('leaves the map one arrival to announce, crossing from the camp as from the map', () => {
    const app = launch();
    app.world.getState().setTiles(generateMap(SEED), SEED);
    app.game.getState().startHeroSelect(SEED);
    app.world.getState().moveParty(gateHere(app));
    expect(app.travel.crossWorldGate()).toBe(false);
    expect(app.world.getState().arrivalNotice).toBeNull();

    // The Empire's gate, from the map: the map announces Jadeveil.
    app.empire.getState().setEmperorDefeated(true);
    expect(app.travel.crossWorldGate()).toBe(true);
    expect(app.world.getState().takeArrivalNotice()).toBe('jadeveil');

    // Into the camp and out through its red gate, as `LocationScene.crossFromCamp` does.
    app.world.getState().moveParty(gateHere(app), 0);
    app.game.getState().enterLocation('camp_jadeveil');
    expect(app.location.getState().current).toBe('camp_jadeveil');
    expect(app.travel.crossWorldGate()).toBe(true);
    app.location.getState().leave();
    app.game.getState().setPhase(GamePhase.WorldMap);

    // One notice waits for the map, and the map takes it once.
    expect(app.world.getState().worldId).toBe('empire');
    expect(app.world.getState().arrivalNotice).toBe('empire');
    expect(app.world.getState().takeArrivalNotice()).toBe('empire');
    expect(app.world.getState().takeArrivalNotice()).toBeNull();
  });

  it('gives Jadeveil band 1 on a first crossing, and keeps it through every return', () => {
    const app = launch();
    app.world.getState().setTiles(generateMap(SEED), SEED);
    app.game.getState().startHeroSelect(SEED);
    app.empire.getState().setEmperorDefeated(true);
    app.world.getState().moveParty(gateHere(app));
    expect(app.bands.getState().ledger.bands).toEqual({});
    expect(app.travel.crossWorldGate()).toBe(true);
    expect(app.bands.getState().ledger.bands).toEqual({ jadeveil: 1 });
    expect(app.cap.levelCap()).toBe(25);
    app.world.getState().moveParty(gateHere(app), 0);
    expect(app.travel.crossWorldGate()).toBe(true);
    app.world.getState().moveParty(gateHere(app), 0);
    expect(app.travel.crossWorldGate()).toBe(true);
    expect(app.bands.getState().ledger.bands).toEqual({ jadeveil: 1 });
  });

  it('gives Jadeveil band 2 as the second world, and the archipelago’s camp is its way home', () => {
    // The development crossing: a release never offers the archipelago (`worldBandsSave.test.ts`)
    Object.assign(globalThis, { __DEV__: true });
    const app = launch();
    app.world.getState().setTiles(generateMap(SEED), SEED);
    app.game.getState().startHeroSelect(SEED);
    app.empire.getState().setEmperorDefeated(true);
    app.world.getState().moveParty(gateHere(app));
    expect(app.travel.crossWorldGate('archipelago')).toBe(true);
    expect(app.world.getState().worldId).toBe('archipelago');
    expect(app.bands.getState().ledger.bands).toEqual({ archipelago: 1 });
    expect(app.cap.levelCap()).toBe(25);

    // Walk back to the camp and home: Jadeveil's road is shut until the first world is finished.
    app.world.getState().moveParty(worldDef('archipelago').home, 0);
    expect(app.travel.crossWorldGate()).toBe(true);
    expect(app.world.getState().worldId).toBe('empire');
    app.world.getState().moveParty(gateHere(app), 0);
    expect(app.travel.crossWorldGate('jadeveil')).toBe(false);
    expect(app.world.getState().worldId).toBe('empire');

    app.bands.getState().finish('archipelago');
    expect(app.cap.levelCap()).toBe(30);
    expect(app.travel.crossWorldGate('jadeveil')).toBe(true);
    expect(app.bands.getState().ledger.bands).toEqual({ archipelago: 1, jadeveil: 2 });
    expect(app.cap.levelCap()).toBe(30);
    delete (globalThis as { __DEV__?: boolean }).__DEV__;
  });

  it('carries a defeated party to the far world’s camp, not off its map', () => {
    const app = launch();
    app.world.getState().setTiles(generateMap(SEED), SEED);
    app.game.getState().startHeroSelect(SEED);
    app.empire.getState().setEmperorDefeated(true);
    app.world.getState().moveParty(gateHere(app));
    expect(app.travel.crossWorldGate()).toBe(true);
    expect(app.world.getState().cityCoord).toBeNull();
    app.resolution.applyDefeat(null, { castleRun: null, isSiege: false });
    expect(app.world.getState().worldId).toBe('jadeveil');
    expect(app.world.getState().partyPosition).toEqual(JADEVEIL_WORLD.home);
  });
});
