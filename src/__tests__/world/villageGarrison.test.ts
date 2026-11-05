import { GamePhase, POIType, ResourceType } from '@/models/types';
import { generateMap } from '@/systems/world/mapGenerator';
import { BALANCE } from '@/data/balanceConstants';
import { VILLAGES, VILLAGE_THEMES, villageSpec, villageState } from '@/data/villages';
import { findFaction } from '@/data/templates/factions';
import {
  garrisonBand, garrisonExtraBodies, garrisonOf, garrisonStrength, heldVillageCoord, liberate, liberationGold,
  meetsGarrison, setVillageBuffGrant, villageEncounterId, villageNote, villageNotes, villageOfEncounter,
} from '@/systems/world/villageGarrison';
import { curatedBand, planForEncounter } from '@/systems/world/encounterGenerator';
import { applyDefeat, applyVictory } from '@/systems/combat/encounterResolution';
import { tileIndexFor, useWorldMapStore } from '@/stores/worldMapStore';
import { useQuestStore } from '@/stores/questStore';
import { trackedQuestTarget } from '@/systems/quests/questEvents';
import { toggleVillageOnMap } from '@/systems/quests/questTracking';
import { useInventoryStore } from '@/stores/inventoryStore';
import { useGameStore } from '@/stores/gameStore';
import { usePartyStore } from '@/stores/partyStore';
import { CombatReward } from '@/systems/combat/combatRewards';
import { hexKey } from '@/utils/hexUtils';
import { t } from '@/i18n';

/**
 * The garrison that holds each village and what freeing it does. Every number
 * here is a rule's shape, not a tuned value: the values are first guesses to
 * verify in playtest.
 */
const SEEDS = [1, 4242, 90210, 777, 31337];
const villageTiles = (seed: number) => generateMap(seed).filter((t) => t.poi === POIType.Village);

describe('the garrison', () => {
  it('names its village and band in its encounter id, and reads them back', () => {
    for (const theme of VILLAGE_THEMES) {
      for (const band of [0, 1, 2, 3, 4] as const) {
        expect(villageOfEncounter(villageEncounterId(theme, band))).toEqual({ theme, band });
      }
    }
    expect(villageOfEncounter('shrine_1')).toBeNull();
    expect(villageOfEncounter('village_nowhere_2')).toBeNull();
    expect(villageOfEncounter(null)).toBeNull();
  });

  it.each(SEEDS)('is the occupier\'s faction at the band its tile gives it (seed %i)', (seed) => {
    for (const tile of villageTiles(seed)) {
      const garrison = garrisonOf(tile)!;
      const occupier = villageSpec(tile.village!).occupier;
      const plan = planForEncounter(garrison.id, 0, tile.type, Infinity);
      expect(plan.factionId).toBe(occupier);
      const members = new Set(Object.values(findFaction(occupier)!.roles).flat());
      for (const enemy of plan.enemies) expect(members.has(enemy as never)).toBe(true);
      expect(curatedBand(garrison.id)).toBe(garrison.band);
    }
  });

  it('holds brigands to the low bands and scales the Legion with distance', () => {
    for (const threat of [0, 1, 2, 3, 4]) {
      expect(garrisonBand('brigands', threat)).toBeLessThanOrEqual(2);
      expect(garrisonBand('obsidian_legion', threat)).toBeGreaterThanOrEqual(2);
    }
    expect(garrisonBand('obsidian_legion', 1)).toBeLessThanOrEqual(garrisonBand('obsidian_legion', 3));
    for (const seed of SEEDS) {
      for (const tile of villageTiles(seed).filter((v) => villageSpec(v.village!).occupier === 'brigands')) {
        expect(garrisonOf(tile)!.band).toBeLessThanOrEqual(2);
      }
    }
  });

  it('is the same fight on every visit, a camp wider than the band\'s warband', () => {
    const [tile] = villageTiles(1);
    const { id } = garrisonOf(tile)!;
    const first = planForEncounter(id, 0, tile.type, Infinity).enemies;
    for (let i = 0; i < 5; i++) expect(planForEncounter(id, 4, tile.type, 0).enemies).toEqual(first);
    const band = garrisonOf(tile)!.band;
    const warband = planForEncounter('random_danger', band, tile.type, Infinity).enemies;
    expect(first.length).toBe(warband.length + garrisonExtraBodies(villageSpec(tile.village!).occupier));
  });

  it('states its strength as the band\'s expected summed party level', () => {
    expect(garrisonStrength(2)).toBe(BALANCE.BAND_EXPECTED_LEVEL[2]);
    const [tile] = villageTiles(1);
    const { theme, band } = garrisonOf(tile)!;
    expect(villageNote(theme, band).detail).toContain(String(garrisonStrength(band)));
  });
});

/** A party strong enough for every garrison on the map. */
const STRONG = BALANCE.BAND_EXPECTED_LEVEL[4];

describe('the journal note', () => {
  it('names the village and its occupier, one per village, held first', () => {
    const notes = villageNotes(villageTiles(1), STRONG);
    expect(notes).toHaveLength(4);
    expect(notes.every((n) => !n.freed)).toBe(true);
    expect(notes.find((n) => n.theme === 'lookout')!.title).toBe(t('villages.note.title', {
      name: t('villages.lookout.name'), occupier: t('villages.occupier.brigands'),
    }));
    expect(notes.find((n) => n.theme === 'smithy')!.title).toContain(t('villages.occupier.obsidian_legion'));
  });

  it('is the same note, done, once the village is freed', () => {
    const tiles = villageTiles(1);
    tiles[0] = { ...tiles[0], defeated: true };
    const notes = villageNotes(tiles, STRONG);
    expect(notes[notes.length - 1].freed).toBe(true);
    expect(notes[notes.length - 1].detail).toBe(t('villages.note.freed'));
  });

  // Playtest 2026-10-29: a held village is a job only once the party is up to its garrison
  it('lists a held village only once the party\'s summed level meets its garrison, and a freed one always', () => {
    for (const seed of SEEDS) {
      const tiles = villageTiles(seed);
      const strengths = tiles.map((tile) => garrisonStrength(garrisonOf(tile)!.band));
      for (const level of [1, ...strengths, STRONG]) {
        const listed = villageNotes(tiles, level).map((n) => n.theme).sort();
        const due = tiles.filter((tile) => meetsGarrison(level, garrisonOf(tile)!.band)).map((tile) => tile.village!).sort();
        expect({ seed, level, listed }).toEqual({ seed, level, listed: due });
      }
      expect(villageNotes(tiles, 0)).toEqual([]);
      const freed = tiles.map((tile, i) => (i === 0 ? { ...tile, defeated: true } : tile));
      expect(villageNotes(freed, 0).map((n) => [n.theme, n.freed])).toEqual([[tiles[0].village, true]]);
    }
  });
});

describe('following a village', () => {
  it('points at the village while it is held, and nowhere once it is free', () => {
    const tiles = villageTiles(1);
    const [first] = tiles;
    expect(heldVillageCoord(tiles, first.village!)).toEqual(first.coord);
    expect(heldVillageCoord(tiles.map((tile) => (tile === first ? { ...tile, defeated: true } : tile)), first.village!)).toBeNull();
    expect(heldVillageCoord([], first.village!)).toBeNull();
  });

  it('takes the quest\'s place: the guide points at it, a quest tracked drops it, and a second press stops it', () => {
    const map = new Map(generateMap(1).map((tile) => [hexKey(tile.coord), tile]));
    useWorldMapStore.setState({ tiles: map, ...tileIndexFor(map) });
    useQuestStore.setState({ active: {}, completed: [], tracked: null, trackedVillage: null });
    const village = [...map.values()].find((tile) => tile.poi === POIType.Village)!;

    toggleVillageOnMap(village.village!);
    expect(useQuestStore.getState()).toMatchObject({ trackedVillage: village.village, tracked: null });
    expect(useGameStore.getState().guide).toBe('quest');
    expect(trackedQuestTarget(map)).toEqual(village.coord);

    useQuestStore.getState().track('wolf_cull' as never);
    expect(useQuestStore.getState().trackedVillage).toBeNull();
    useQuestStore.getState().track(null);

    toggleVillageOnMap(village.village!);
    toggleVillageOnMap(village.village!);
    expect(useQuestStore.getState().trackedVillage).toBeNull();
    // Nothing tracked any more: a newly accepted quest is followed as before, not held back
    expect(trackedQuestTarget(map)).toBeNull();
    useQuestStore.getState().reset();
  });
});

describe('liberation', () => {
  it('pays the occupier\'s gold and grants the buff for a week, once', () => {
    const grants: [string, number][] = [];
    setVillageBuffGrant((theme, hours) => grants.push([theme, hours]));
    const paid: number[] = [];
    const first = liberate('smithy', true, (g) => paid.push(g));
    expect(first).toEqual({ theme: 'smithy', gold: liberationGold('smithy'), buffHours: 168 });
    expect(paid).toEqual([BALANCE.VILLAGE_LIBERATION_GOLD.obsidian_legion]);
    expect(grants).toEqual([['smithy', 168]]);
    // A village that was already free pays and grants nothing
    expect(liberate('smithy', false, (g) => paid.push(g))).toBeNull();
    expect(paid).toHaveLength(1);
    expect(grants).toHaveLength(1);
    setVillageBuffGrant(null);
  });

  it('pays the Legion more than the brigands', () => {
    for (const near of VILLAGES.filter((v) => v.ring === 'near'))
      for (const far of VILLAGES.filter((v) => v.ring === 'far'))
        expect(liberationGold(far.theme)).toBeGreaterThan(liberationGold(near.theme));
  });
});

describe('winning and losing the garrison fight', () => {
  const reward: CombatReward = { kind: 'combat', xpPerHero: 0, gold: 0, items: [], gems: [], resources: [] };
  const stand = (theme: (typeof VILLAGE_THEMES)[number]) => {
    useWorldMapStore.getState().reset();
    useInventoryStore.getState().reset();
    usePartyStore.getState().reset();
    useWorldMapStore.getState().setTiles(generateMap(1), 1);
    const tile = [...useWorldMapStore.getState().tiles.values()].find((v) => v.village === theme)!;
    useWorldMapStore.setState({ partyPosition: tile.coord });
    const { id } = garrisonOf(tile)!;
    useGameStore.setState({ phase: GamePhase.Combat, currentEncounterId: id, encounterEntry: null });
    return { tile, id };
  };
  const gold = () => useInventoryStore.getState().resources[ResourceType.Gold] ?? 0;
  const stateOf = (coord: { q: number; r: number }) => villageState(useWorldMapStore.getState().tiles.get(hexKey(coord))!);

  it('frees the village and pays its gold on a win', () => {
    const { tile, id } = stand('lookout');
    const before = gold();
    useQuestStore.getState().trackVillage('lookout');
    const outcome = applyVictory(reward, { units: [], encounterId: id, castleRun: null, guardsChest: false });
    expect(stateOf(tile.coord)).toBe('free');
    expect(gold() - before).toBe(liberationGold('lookout'));
    expect(outcome?.liberated?.theme).toBe('lookout');
    // A followed village is done with once it is free
    expect(useQuestStore.getState().trackedVillage).toBeNull();
  });

  it('leaves it occupied on a loss', () => {
    const { tile } = stand('shrine');
    const before = gold();
    applyDefeat(null, { castleRun: null, isSiege: false });
    expect(stateOf(tile.coord)).toBe('occupied');
    expect(gold()).toBe(before);
  });

  it('frees only the village it was fought at', () => {
    const { id } = stand('lookout');
    const other = [...useWorldMapStore.getState().tiles.values()].find((v) => v.village === 'smithy')!;
    useWorldMapStore.setState({ partyPosition: other.coord });
    applyVictory(reward, { units: [], encounterId: id, castleRun: null, guardsChest: false });
    expect(stateOf(other.coord)).toBe('occupied');
  });
});
