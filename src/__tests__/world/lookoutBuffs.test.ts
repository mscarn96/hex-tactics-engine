import { BALANCE } from '@/data/balanceConstants';
import { MapTile, POIType, TileType, CombatUnit } from '@/models/types';
import { canFlee, fleeChance, fleeSucceeds } from '@/systems/world/escape';
import { dangerSightKeys, redHexesOnRoute } from '@/systems/world/dangerSight';
import { WARBAND_ENCOUNTER_ID } from '@/systems/world/encounterGenerator';
import { villageEncounterId } from '@/systems/world/villageGarrison';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { useCombatStore } from '@/stores/combatStore';
import { hexKey, hexDistance } from '@/utils/hexUtils';
import { at, makeStats, makeUnit } from '../support/fixtures';
import { CombatPhase } from '@/models/types';

/**
 * The Lookout's two buffs: the rules their effects run. Which buff switches each
 * on is `villageBuffEffects.test.ts`. Numbers (`VILLAGE_ESCAPE`, the sight radius) are first
 * guesses to verify in playtest; these pin the rules.
 */
const { base, min, max } = BALANCE.VILLAGE_ESCAPE;
const BANDS = [0, 1, 2, 3, 4] as const;

describe('Escape: the chance to flee', () => {
  it('is the party\'s level over what the band expects, scaled, so the expected level flees at the base rate', () => {
    for (const band of BANDS) {
      const expected = BALANCE.BAND_EXPECTED_LEVEL[band];
      expect(fleeChance(expected, band)).toBeCloseTo(Math.min(max, Math.max(min, base)), 10);
    }
  });

  it('rises with the party and falls with the band', () => {
    for (const band of BANDS) {
      let prev = -1;
      for (let level = 1; level <= 120; level += 7) {
        const c = fleeChance(level, band);
        expect(c).toBeGreaterThanOrEqual(prev);
        prev = c;
      }
    }
    for (let level = 10; level <= 100; level += 15) {
      for (let band = 1; band < 5; band++) {
        expect(fleeChance(level, band as 1 | 2 | 3 | 4)).toBeLessThanOrEqual(fleeChance(level, (band - 1) as 0 | 1 | 2 | 3));
      }
    }
  });

  it('is clamped to 20-90%', () => {
    expect(min).toBe(0.2);
    expect(max).toBe(0.9);
    for (const band of BANDS) {
      expect(fleeChance(1, band)).toBe(min);
      expect(fleeChance(0, band)).toBe(min);
      expect(fleeChance(10_000, band)).toBe(max);
      for (let level = 0; level <= 200; level += 5) {
        const c = fleeChance(level, band);
        expect(c).toBeGreaterThanOrEqual(min);
        expect(c).toBeLessThanOrEqual(max);
      }
    }
  });

  it('succeeds exactly when the roll falls under it', () => {
    expect(fleeSucceeds(0.5, 0.49)).toBe(true);
    expect(fleeSucceeds(0.5, 0.5)).toBe(false);
    expect(fleeSucceeds(0.2, 0.99)).toBe(false);
    expect(fleeSucceeds(0.9, 0)).toBe(true);
  });

  it('is offered for the wandering warband only', () => {
    expect(canFlee(WARBAND_ENCOUNTER_ID)).toBe(true);
    for (const id of [
      'lair_warren_1', 'lair_wyrm_boss', 'lair_barrow_chest', 'quest_thicket', 'quest_3', 'shrine_2', 'summit_1', 'castle_1_0',
      'siege_3', villageEncounterId('smithy', 3), 'chest_guard_1', null, undefined,
    ]) expect(canFlee(id)).toBe(false);
  });
});

describe('Escape: what a successful flight leaves', () => {
  it('takes exactly that warband off the roll and leaves its neighbours', () => {
    const here = at(5, 5);
    const near = at(6, 5);
    useWorldMapStore.setState({ activeEncounterTiles: new Set([hexKey(here), hexKey(near)]) });
    useWorldMapStore.getState().removeActiveEncounter(here);
    const live = useWorldMapStore.getState().activeEncounterTiles;
    expect(live.has(hexKey(here))).toBe(false);
    expect(live.has(hexKey(near))).toBe(true);
    // Fighting one clears its neighbours too, which a flight does not
    useWorldMapStore.setState({ activeEncounterTiles: new Set([hexKey(here), hexKey(near)]) });
    useWorldMapStore.getState().clearActiveEncounter(here);
    expect(useWorldMapStore.getState().activeEncounterTiles.size).toBe(0);
  });

  it('leaves the set alone for a hex that holds nothing', () => {
    const live = new Set([hexKey(at(1, 1))]);
    useWorldMapStore.setState({ activeEncounterTiles: live });
    useWorldMapStore.getState().removeActiveEncounter(at(9, 9));
    expect(useWorldMapStore.getState().activeEncounterTiles).toBe(live);
  });
});

describe('Escape: a failed flight opens with the enemies', () => {
  const hero = (speed: number, id: string) => makeUnit({ id, isPlayer: true, position: at(0, 0), stats: makeStats({ speed }) });
  const foe = (speed: number, id: string) => makeUnit({ id, isPlayer: false, position: at(0, 5), stats: makeStats({ speed }) });
  const open = (enemiesFirst?: boolean) => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([hero(30, 'h_fast'), hero(8, 'h_slow')], [foe(20, 'e_fast'), foe(5, 'e_slow')], 0, enemiesFirst);
    return useCombatStore.getState();
  };

  it('normally starts on the fastest unit, a hero here', () => {
    const s = open();
    expect(s.currentUnitId).toBe('h_fast');
    expect(s.phase).toBe(CombatPhase.PlayerSelect);
  });

  it('starts on the fastest enemy even when a hero is faster, and keeps the speed order for everyone', () => {
    const s = open(true);
    expect(s.currentUnitId).toBe('e_fast');
    expect(s.phase).toBe(CombatPhase.EnemyTurn);
    expect(s.turnOrder).toEqual(['h_fast', 'e_fast', 'h_slow', 'e_slow']);
    expect((s.units as CombatUnit[]).length).toBe(4);
  });
});

describe('Danger sight', () => {
  const tile = (q: number, r: number, explored = true): MapTile => ({
    coord: at(q, r), type: TileType.Plains, zone: 'haunted', explored,
  });
  const map = (tiles: MapTile[]) => new Map(tiles.map((t) => [hexKey(t.coord), t]));
  const R = BALANCE.VILLAGE_DANGER_SIGHT_RADIUS;

  it('shows live encounters within the radius and no farther', () => {
    const tiles = [tile(0, 0), tile(R, 0), tile(R + 1, 0), tile(-R, 0), tile(0, R + 2)];
    const active = new Set(tiles.map((t) => hexKey(t.coord)));
    const keys = dangerSightKeys(active, map(tiles), at(0, 0));
    expect(R).toBe(4);
    for (const t of tiles) {
      expect(keys.has(hexKey(t.coord))).toBe(hexDistance(t.coord, at(0, 0)) <= R);
    }
  });

  it('shows only encounters that are live today, and only on revealed ground', () => {
    const live = tile(1, 0);
    const hidden = tile(2, 0, false);
    const quiet = tile(3, 0);
    const keys = dangerSightKeys(new Set([hexKey(live.coord), hexKey(hidden.coord)]), map([live, hidden, quiet]), at(0, 0));
    expect([...keys]).toEqual([hexKey(live.coord)]);
  });

  it('moves with the party and refreshes at the dawn re-roll', () => {
    const tiles = map([tile(0, 0), tile(10, 0), tile(1, 0)]);
    const today = new Set([hexKey(at(0, 0)), hexKey(at(10, 0))]);
    expect([...dangerSightKeys(today, tiles, at(0, 0))]).toEqual([hexKey(at(0, 0))]);
    expect([...dangerSightKeys(today, tiles, at(9, 0))]).toEqual([hexKey(at(10, 0))]);
    // Dawn: a new roll replaces the set the selector reads
    const tomorrow = new Set([hexKey(at(1, 0))]);
    expect([...dangerSightKeys(tomorrow, tiles, at(0, 0))]).toEqual([hexKey(at(1, 0))]);
    // A beaten warband leaves it: the roll no longer holds it
    expect(dangerSightKeys(new Set(), tiles, at(0, 0)).size).toBe(0);
  });

  it('warns about the hexes of a route that cross a red one', () => {
    const red = new Set([hexKey(at(2, 0))]);
    const route = [at(1, 0), at(2, 0), at(3, 0)];
    expect(redHexesOnRoute(route, red)).toEqual([at(2, 0)]);
    expect(redHexesOnRoute([at(1, 0), at(3, 0)], red)).toEqual([]);
  });

  it('is never lit on a place: a village or lair tile holds no encounter to show', () => {
    expect(POIType.Village).toBe('village');
    const poi = { ...tile(1, 0), poi: POIType.Village };
    expect(dangerSightKeys(new Set(), map([poi]), at(0, 0)).size).toBe(0);
  });
});
