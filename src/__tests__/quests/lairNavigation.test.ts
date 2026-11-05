import { trackedQuestTarget } from '@/systems/quests/questEvents';
import { useQuestStore } from '@/stores/questStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { QUESTS } from '@/quests/questData';
import { LAIR_SPECS } from '@/locations/lairs';
import { startRecord } from '@/systems/quests/quests';
import { MapTile, POIType, TileType } from '@/models/types';
import { QuestId } from '@/quests/types';
import { HexCoord, hexKey } from '@/utils/hexUtils';

/**
 * A lair is somewhere, and the navigator has to be able to say where.
 *
 * Three lair doors are dealt onto a 70×70 map from a shuffled pool, constrained
 * only by "at least 8 hexes from the city" — so where the Warren's mouth is
 * differs in every save, and finding it was a sweep of the map. That is the same
 * failure "kill five wolves" was, and the whole reason `huntGround` exists; the
 * answer for a *door* is better, because unlike a wandering pack a door has an
 * address.
 *
 * The lair quests supply that address to the guide by opening with a `reach` at
 * their lair id, and this suite pins the chain end to end: quest → objective →
 * `trackedQuestTarget` → the hex the door is actually on. Each link is fine in
 * isolation and the failure of any one of them looks identical from inside the
 * game — the arrow simply goes dark, which is also what it correctly does for a
 * quest with nowhere to point.
 */

const lairQuestFor = (lairId: string): QuestId | undefined =>
  (Object.keys(QUESTS) as QuestId[]).find((id) =>
    QUESTS[id].stages.some((stage) =>
      stage.objectives.some((o) => o.kind === 'reach' && o.location === lairId),
    ),
  );

const tile = (coord: HexCoord, over: Partial<MapTile> = {}): MapTile =>
  ({
    coord,
    type: TileType.Plains,
    zone: 'haunted',
    explored: false,
    height: 0.5,
    ...over,
  }) as MapTile;

/**
 * A map holding the city and all three lair doors, and nothing else that could
 * be mistaken for one. Doors sit at different distances so "nearest wins" has
 * something to get wrong.
 */
function stageMap(): Map<string, MapTile> {
  const tiles = new Map<string, MapTile>();
  const put = (t: MapTile) => tiles.set(hexKey(t.coord), t);

  put(tile({ q: 0, r: 0 }, { poi: POIType.City, explored: true }));
  LAIR_SPECS.forEach((spec, i) => {
    put(
      tile(
        { q: 5 + i * 4, r: -2 - i },
        { poi: POIType.BossTile, encounterId: spec.id },
      ),
    );
  });
  return tiles;
}

describe('the guide points at a lair door', () => {
  const tiles = stageMap();

  beforeEach(() => {
    useWorldMapStore.setState({
      partyPosition: { q: 0, r: 0 },
      poiCoords: [...tiles.values()].map((t) => t.coord),
    });
  });

  afterEach(() => {
    useQuestStore.setState({ active: {}, tracked: null });
  });

  it('gives every lair a quest of its own', () => {
    const without = LAIR_SPECS.filter((spec) => !lairQuestFor(spec.id)).map((s) => s.id);
    expect(without).toEqual([]);
  });

  it('resolves each lair quest to that lair’s own door', () => {
    const offenders: string[] = [];

    for (const spec of LAIR_SPECS) {
      const questId = lairQuestFor(spec.id)!;
      useQuestStore.setState({
        active: { [questId]: startRecord(QUESTS[questId]) },
        tracked: questId,
      });

      const target = trackedQuestTarget(tiles);
      const expected = [...tiles.values()].find((t) => t.encounterId === spec.id)!.coord;

      if (!target) offenders.push(`${spec.id}: the arrow went dark`);
      else if (hexKey(target) !== hexKey(expected)) {
        offenders.push(`${spec.id}: pointed at ${hexKey(target)}, door is ${hexKey(expected)}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * The reason the two objectives share one stage.
   *
   * A stage advances only when *every* objective in it is met, and
   * `trackedQuestTarget` reads the current stage alone — so keeping the `reach`
   * alongside the kill is what holds the door on the arrow for the whole run.
   * Split into a stage of its own it would complete the moment the party stepped
   * inside, and the guide would go dark at exactly the point the run begins. A
   * lair is four fights deep, which is a long way to be walked out of with
   * nothing to walk back by.
   *
   * The *order* of the two is legibility rather than mechanism, and worth being
   * exact about: `trackedQuestTarget` returns on the first objective it can
   * resolve a tile for, and a `kill` resolves to none — it falls through to the
   * next objective rather than blocking it. So a `kill` written first would
   * still find the `reach` behind it. (`talk` is the one kind that genuinely
   * short-circuits, returning the city as its own fallback.)
   */
  it('keeps the door on the arrow even after the party has been inside', () => {
    const spec = LAIR_SPECS[0];
    const questId = lairQuestFor(spec.id)!;
    const record = startRecord(QUESTS[questId]);

    /**
     * The `reach` satisfied and the boss still alive — mid-run, which is the
     * state the arrow has to survive. `progress` is one counter per objective of
     * the current stage, in order, so filling the first and leaving the second
     * is exactly "walked in, still fighting".
     */
    const midRun = { ...record, progress: [1, 0] };
    expect(QUESTS[questId].stages[0].objectives[0].kind).toBe('reach');

    useQuestStore.setState({ active: { [questId]: midRun }, tracked: questId });

    expect(trackedQuestTarget(tiles)).not.toBeNull();
  });

  /**
   * Unexplored is not a reason to go quiet.
   *
   * Every other overlay on this map is explored-only and right to be, but a lair
   * door the party has never seen is precisely the case the whole feature is
   * for: the quest has already named the place in words, so the arrow refusing
   * to point at it withholds nothing the player was not already told.
   */
  it('points at a door standing in unexplored country', () => {
    const questId = lairQuestFor(LAIR_SPECS[0].id)!;
    useQuestStore.setState({
      active: { [questId]: startRecord(QUESTS[questId]) },
      tracked: questId,
    });
    const unexplored = [...tiles.values()].every((t) => t.poi !== POIType.BossTile || !t.explored);
    expect(unexplored).toBe(true);
    expect(trackedQuestTarget(tiles)).not.toBeNull();
  });
});
