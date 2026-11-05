import { MapTile, POIType, TileType, GamePhase } from '@/models/types';
import { WARBAND_ENCOUNTER_ID } from '@/systems/world/encounterGenerator';
import { fleeChance } from '@/systems/world/escape';
import type { Merchant } from '@/systems/world/merchants';
import {
  fightWarband, flightChance, merchantMet, offersFlight, resolveFlight, stepMeeting, type StepWorld,
} from '@/systems/world/worldStep';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { useGameStore } from '@/stores/gameStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { hexKey, type HexCoord } from '@/utils/hexUtils';
import { at } from '../support/fixtures';

/**
 * What a step of a walk meets and what a flight from a warband leaves, through
 * the interface the world map calls. The world map only times these and shows
 * their dialogs; the store writes are pinned here.
 */
const tile = (q: number, r: number, over: Partial<MapTile> = {}): MapTile =>
  ({ coord: at(q, r), type: TileType.Plains, zone: 'haunted', explored: true, threat: 1, ...over });
const road = (q: number, r: number) => tile(q, r, { zone: 'road' });
const mapOf = (tiles: MapTile[]) => new Map(tiles.map((t) => [hexKey(t.coord), t]));
const keys = (...coords: HexCoord[]) => new Set(coords.map(hexKey));
const cart = (start: HexCoord): Merchant => ({ id: '1:0', kind: 'armourer', start, dealtHour: 0, week: 1 });

const TILES = mapOf([
  tile(0, 0), tile(1, 0), tile(2, 0), tile(3, 0), road(0, 1), road(1, 1),
  tile(2, 1, { poi: POIType.MagicWell }),
]);
const world = (over: Partial<StepWorld> = {}): StepWorld => ({
  tiles: TILES, partyPosition: at(0, 0), activeEncounterTiles: new Set(), merchants: [],
  poiCoords: [], homeCoord: null, mapSeed: 7, ...over,
});

describe('what a step meets', () => {
  it('a live warband on the hex reached', () => {
    const meeting = stepMeeting(world({ partyPosition: at(1, 0), activeEncounterTiles: keys(at(1, 0)) }), 0);
    expect(meeting).toEqual({ kind: 'warband', tile: TILES.get(hexKey(at(1, 0))) });
  });

  it('nothing on a hex whose warband is not live today, or on a road or a place the roll names', () => {
    expect(stepMeeting(world({ partyPosition: at(1, 0), activeEncounterTiles: keys(at(2, 0)) }), 0)).toBeNull();
    expect(stepMeeting(world({ partyPosition: at(0, 1), activeEncounterTiles: keys(at(0, 1)) }), 0)).toBeNull();
    expect(stepMeeting(world({ partyPosition: at(2, 1), activeEncounterTiles: keys(at(2, 1)) }), 0)).toBeNull();
  });

  it('a merchant standing on the hex at the hour after the step', () => {
    const merchant = cart(at(0, 1));
    expect(stepMeeting(world({ partyPosition: at(0, 1), merchants: [merchant] }), 0))
      .toEqual({ kind: 'merchant', merchant });
    // Four days on it has left the map
    expect(stepMeeting(world({ partyPosition: at(0, 1), merchants: [merchant] }), 10_000)).toBeNull();
  });

  it('the warband first when both are on the hex', () => {
    const merchant = cart(at(1, 0));
    const both = world({ partyPosition: at(1, 0), activeEncounterTiles: keys(at(1, 0)), merchants: [merchant] });
    // The cart is on haunted ground only here, to put the two together
    expect(merchantMet(both, at(1, 0), 0)).toBe(merchant);
    expect(stepMeeting(both, 0)?.kind).toBe('warband');
  });

  it('meets a merchant at an arrival on its hex, and none on another', () => {
    const merchant = cart(at(0, 1));
    expect(merchantMet(world({ merchants: [merchant] }), at(0, 1), 0)).toBe(merchant);
    expect(merchantMet(world({ merchants: [merchant] }), at(1, 1), 0)).toBeNull();
  });
});

describe('Escape: when a warband offers a flight', () => {
  const ground = TILES.get(hexKey(at(1, 0)))!;

  it('under the Lookout\'s Escape, for a step that came from somewhere, on open ground', () => {
    expect(offersFlight(ground, at(0, 0), 'lookout_escape')).toBe(true);
  });

  it('never without the buff, without a hex to go back to, or on a place', () => {
    for (const buff of [null, 'lookout_sight', 'trading_gold'] as const) expect(offersFlight(ground, at(0, 0), buff)).toBe(false);
    expect(offersFlight(ground, null, 'lookout_escape')).toBe(false);
    expect(offersFlight({ ...ground, poi: POIType.Village }, at(0, 0), 'lookout_escape')).toBe(false);
  });

  it('at the chance the warband\'s band gives the party', () => {
    expect(flightChance(ground, 30)).toBe(fleeChance(30, 1));
    expect(flightChance({ ...ground, threat: undefined }, 30)).toBe(fleeChance(30, 0));
  });
});

describe('Escape: what a flight leaves', () => {
  const here = at(1, 0);
  const near = at(2, 0);
  const from = at(0, 0);
  const flight = { tile: TILES.get(hexKey(here))!, from };

  beforeEach(() => {
    useCalendarStore.getState().reset();
    useWorldMapStore.getState().reset();
    useGameStore.setState({ phase: GamePhase.WorldMap, currentEncounterId: null, currentEncounterContext: null });
    useWorldMapStore.setState({ tiles: TILES, partyPosition: here, activeEncounterTiles: keys(here, near) });
  });

  it('away: the party is back where it came from, that warband alone is gone, the clock stands, no fight', () => {
    const hours = useCalendarStore.getState().totalHours;
    expect(resolveFlight(flight, 0.5, 0.49)).toBe(true);
    const map = useWorldMapStore.getState();
    expect(map.partyPosition).toEqual(from);
    expect(map.activeEncounterTiles).toEqual(keys(near));
    expect(useCalendarStore.getState().totalHours).toBe(hours);
    expect(useGameStore.getState().phase).toBe(GamePhase.WorldMap);
    expect(useGameStore.getState().currentEncounterId).toBeNull();
  });

  it('caught: the warband\'s ground is spent as a fight spends it, and the fight opens with the enemies', () => {
    expect(resolveFlight(flight, 0.5, 0.5)).toBe(false);
    const map = useWorldMapStore.getState();
    expect(map.partyPosition).toEqual(here);
    // A fight quiets the neighbours too, which a flight does not
    expect(map.activeEncounterTiles.size).toBe(0);
    const game = useGameStore.getState();
    expect(game.phase).toBe(GamePhase.Combat);
    expect(game.currentEncounterId).toBe(WARBAND_ENCOUNTER_ID);
    expect(game.currentEncounterContext).toMatchObject({ kind: 'world', threat: 1, danger: true, enemiesFirst: true });
  });

  it('choosing to fight is the fight without the buff: ground spent, the party acts in speed order', () => {
    fightWarband(flight.tile);
    expect(useWorldMapStore.getState().activeEncounterTiles.size).toBe(0);
    const game = useGameStore.getState();
    expect(game.currentEncounterId).toBe(WARBAND_ENCOUNTER_ID);
    expect(game.currentEncounterContext).not.toHaveProperty('enemiesFirst');
  });
});
