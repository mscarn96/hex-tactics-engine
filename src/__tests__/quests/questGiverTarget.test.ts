import { trackedQuestTarget } from '@/systems/quests/questEvents';
import { useQuestStore } from '@/stores/questStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { QUESTS, QUEST_IDS } from '@/quests/questData';
import { NPCS } from '@/quests/npcData';
import { MapTile, POIType, TileType } from '@/models/types';
import { NpcId, QuestId } from '@/quests/types';
import { QuestRecord } from '@/systems/quests/quests';
import { HexCoord, hexKey } from '@/utils/hexUtils';

/**
 * Where the arrow points once there is nothing left to do but get paid.
 *
 * A quest is handed back to its **giver**, and three of the six givers live out
 * on the map. `trackedQuestTarget` answered "the city" for every finished quest
 * — written when the quest log still carried a Claim button and the walk home
 * was a formality — so finishing anything the trapper, the hermit or the
 * prospector gave sent the player the wrong way and put a gold marker on a city
 * with nothing to offer. That is the same failure the `talk` case exists to
 * prevent, one branch above it, which is why both now go through one helper.
 */

/** The people `mapGenerator` puts outside the walls — see `WAYSIDE_SPECS`. */
const WORLD_NPCS: NpcId[] = ['huntsman', 'fen_hermit', 'prospector'];

/** Their camps, at three different distances so "nearest wins" can get it wrong. */
const CAMPS: Record<string, HexCoord> = {
  huntsman:   { q: 7, r: 0 },
  fen_hermit: { q: 0, r: 12 },
  prospector: { q: -18, r: 4 },
};

const CITY: HexCoord = { q: 0, r: 0 };

/** Where a camp's people are found: the camp world's gate (`NpcDef.camp`). */
const GATE: HexCoord = { q: 20, r: -6 };

const tile = (coord: HexCoord, over: Partial<MapTile> = {}): MapTile =>
  ({
    coord,
    type: TileType.Plains,
    zone: 'haunted',
    explored: false,
    height: 0.5,
    ...over,
  }) as MapTile;

function stageMap(camps: NpcId[] = WORLD_NPCS): Map<string, MapTile> {
  const tiles = new Map<string, MapTile>();
  const put = (t: MapTile) => tiles.set(hexKey(t.coord), t);

  put(tile(CITY, { poi: POIType.City, explored: true }));
  put(tile(GATE, { poi: POIType.WorldGate, explored: true }));
  for (const npc of camps) put(tile(CAMPS[npc], { poi: POIType.Wayside, npcId: npc }));
  return tiles;
}

/** A record run off the end of its last stage — every objective met. */
const finished = (id: QuestId): QuestRecord => ({
  stage: QUESTS[id].stages.length,
  progress: [],
});

function track(tiles: Map<string, MapTile>, id: QuestId): HexCoord | null {
  useWorldMapStore.setState({
    partyPosition: CITY,
    poiCoords: [...tiles.values()].map((t) => t.coord),
  });
  useQuestStore.setState({ active: { [id]: finished(id) }, tracked: id });
  return trackedQuestTarget(tiles);
}

const where = (coord: HexCoord | null) => (coord ? hexKey(coord) : 'nowhere');

afterEach(() => {
  useQuestStore.setState({ active: {}, tracked: null });
});

describe('a finished quest points at the person who gave it', () => {
  const tiles = stageMap();

  /**
   * Guards the sweep below against passing for the wrong reason. If nobody out
   * on the map holds a quest, "every giver resolves correctly" is true of a
   * function that always returns the city.
   */
  it('is a question the roster actually asks', () => {
    const outside = QUEST_IDS.filter((id) => WORLD_NPCS.includes(QUESTS[id].giver));
    const inside = QUEST_IDS.filter((id) => !WORLD_NPCS.includes(QUESTS[id].giver));
    expect(outside.length).toBeGreaterThan(0);
    expect(inside.length).toBeGreaterThan(0);
  });

  it('sends the trapper’s quest to the trapper, not home', () => {
    expect(QUESTS.snares_and_stakes.giver).toBe('huntsman');
    const target = track(tiles, 'snares_and_stakes');
    expect(where(target)).toBe(hexKey(CAMPS.huntsman));
    expect(where(target)).not.toBe(hexKey(CITY));
  });

  it('still sends a city-keeper’s quest to the city', () => {
    expect(QUESTS.wolves_at_the_gate.giver).toBe('gate_captain');
    expect(where(track(tiles, 'wolves_at_the_gate'))).toBe(hexKey(CITY));
  });

  it('resolves every quest in the game to its own giver', () => {
    const offenders = QUEST_IDS.flatMap((id) => {
      const giver = QUESTS[id].giver;
      const expected = CAMPS[giver] ?? (NPCS[giver].camp ? GATE : CITY);
      const target = track(tiles, id);
      return where(target) === hexKey(expected)
        ? []
        : [`${id} (${giver}): ${where(target)}, wanted ${hexKey(expected)}`];
    });
    expect(offenders).toEqual([]);
  });

  /**
   * A camp is placed from a shuffled pool against a tight window, and
   * `placeWaysides` relaxes terrain and band before it gives up — but a save
   * whose map predates a person, or a tile the party has genuinely never had
   * indexed, must not take the arrow out altogether. The city is the honest
   * fallback: it is where every other lead in the game starts.
   */
  it('falls back to the city when the camp is not on this map', () => {
    const without = stageMap(['fen_hermit', 'prospector']);
    expect(where(track(without, 'snares_and_stakes'))).toBe(hexKey(CITY));
  });
});
