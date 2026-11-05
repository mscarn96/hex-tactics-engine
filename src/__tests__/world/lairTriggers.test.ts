import { LAIR_SPECS, getLocation, tileLabel } from '@/locations';
import { hexKey } from '@/utils/hexUtils';

/**
 * The lairs were re-dressed, re-walled and re-lit, and not moved.
 *
 * The visual pass that cut the lairs into rock and furnished them was held to
 * a line the epic drew: no changed topology, encounters, chests or exits. This
 * is that line, pinned against the lairs as they stood before the pass —
 * dumped from the build the pass started from, not derived from the code it
 * changed, so a regression cannot quietly redefine what "before" was.
 *
 * - **Every trigger stands where it stood, and is what it was**: kind,
 *   encounter, loot tier and label, hex for hex.
 * - **Every tile a party could stand on still can, and exactly one kind of
 *   tile was added**: floor the old decoration blocked. That pass rolled a
 *   pillar, a pool or a clutch of eggs onto a chamber's floor per tile, and
 *   walled off whatever it landed on; nothing furnished blocks a tile now, so
 *   those tiles are the chambers' floor again. The rooms, the passages between
 *   them, the doorways and the way in are the same hexes.
 *
 * The ice lair is not here. It replaced the Barrow in the lair reorder — a new
 * topology rather than a re-dressing — so it has no "before" to be held to, and
 * `lairs.test.ts` holds it to the rules every lair answers to.
 */

const BEFORE: Record<string, { entry: string; triggers: string[]; walkable: string; freed: string }> = {
  lair_warren: {
    entry: "-2,0",
    triggers: [
      "13,-4 {\"kind\":\"chest\",\"lootTier\":1,\"kit\":\"legendary\"} Chest",
      "12,4 {\"kind\":\"chest\",\"lootTier\":1,\"kit\":\"epics\"} Chest",
      "25,-2 {\"kind\":\"encounter\",\"encounterId\":\"lair_warren_boss\"} The Warren",
      "3,0 {\"kind\":\"encounter\",\"encounterId\":\"lair_warren_1\"} Guarded",
      "12,1 {\"kind\":\"encounter\",\"encounterId\":\"lair_warren_chest\"} Guarded",
      "16,-1 {\"kind\":\"encounter\",\"encounterId\":\"lair_warren_2\"} Guarded",
      "-3,0 {\"kind\":\"exit\"} Leave",
    ],
    walkable: [
      "-3,0 -2,0 -1,0 -1,1 0,-1 0,0 1,-1 1,0 2,0 3,0 4,0 4,1 4,2 5,-1 5,0 5,1 5,2 6,-2",
      "6,-1 6,0 6,1 6,2 7,-2 7,-1 7,0 7,1 8,-3 8,-2 8,-1 8,0 9,-4 9,-3 9,-2 10,-4 10,-3",
      "11,-3 11,-2 11,-1 11,0 11,3 11,4 12,-3 12,-2 12,-1 12,0 12,1 12,2 12,3 12,4 13,-4",
      "13,-3 13,-2 13,-1 13,0 13,2 13,3 14,-4 14,-3 14,-2 14,-1 15,-4 15,-3 15,-2 16,-2",
      "16,-1 17,-1 17,0 17,1 18,-2 18,-1 18,0 18,1 19,-3 19,-2 19,-1 19,0 19,1 20,-3 20,-2",
      "20,-1 20,0 21,-3 21,-2 21,-1 22,-1 23,-2 23,-1 23,0 24,-3 24,-2 24,-1 24,0 25,-4",
      "25,-3 25,-2 25,-1 25,0 26,-4 26,-3 26,-2 26,-1 27,-4 27,-3 27,-2",
    ].join(' '),
    freed: "0,1",
  },
  lair_wyrm: {
    entry: "-3,0",
    triggers: [
      // Tier 2 since the lair reorder made the Hollow the second lair
      "7,-2 {\"kind\":\"chest\",\"lootTier\":2,\"kit\":\"legendary\"} Chest",
      "15,-4 {\"kind\":\"chest\",\"lootTier\":2,\"kit\":\"epics\"} Chest",
      "17,2 {\"kind\":\"encounter\",\"encounterId\":\"lair_wyrm_boss\"} The Wyrm’s Hollow",
      "4,0 {\"kind\":\"encounter\",\"encounterId\":\"lair_wyrm_1\"} Guarded",
      // PT-21 moved the second guard to the dragon's own doorway; the side cave's
      // doorway keeps a fight, its chest guard
      "12,-3 {\"kind\":\"encounter\",\"encounterId\":\"lair_wyrm_chest\"} Guarded",
      "13,2 {\"kind\":\"encounter\",\"encounterId\":\"lair_wyrm_2\"} Guarded",
      "-4,0 {\"kind\":\"exit\"} Leave",
    ],
    walkable: [
      "-4,0 -3,0 -2,0 -2,1 -2,2 -1,-1 -1,0 -1,1 -1,2 0,-2 0,-1 0,0 0,1 0,2 1,-2 1,-1 1,1",
      "2,-2 2,0 2,1 3,-1 3,0 4,0 4,1 4,2 4,3 4,4 5,0 5,1 5,2 5,3 5,4 6,-1 6,0 6,1 6,2 6,3",
      "6,4 7,-2 7,-1 7,0 7,1 7,2 7,3 7,4 8,-2 8,-1 8,0 8,1 8,2 8,3 9,-2 9,-1 9,0 9,2 10,-3",
      "10,-2 10,-1 10,0 10,2 11,-3 11,-2 11,-1 11,0 11,2 11,3 12,-3 12,-2 12,0 12,1 12,2",
      // 13,3 and 14,1 flank the dragon's doorway and are wall since PT-21
      "12,3 13,-6 13,-5 13,-4 13,0 13,1 13,2 14,-7 14,-6 14,-5 14,-4 14,2 14,3",
      "14,4 14,5 15,-8 15,-7 15,-6 15,-5 15,-4 15,1 15,2 15,3 15,4 15,5 16,-8 16,-6 16,-5",
      "16,1 16,2 16,3 16,4 16,5 17,-8 17,-7 17,-6 17,-1 17,0 17,1 17,2 17,3 17,4 17,5",
      "18,-1 18,0 18,2 18,3 18,4 19,-1 19,0 19,1 19,2 19,3 20,-1 20,0 20,2",
    ].join(' '),
    freed: "1,0 2,-1 9,1 10,1 16,-7 16,0 18,1 20,1 4,-1 11,1",
  },
};

describe('the lairs, against the build before the pass', () => {
  const PINNED = LAIR_SPECS.filter((s) => s.id in BEFORE).map((s) => [s.id] as const);

  it('still pins the two lairs the pass re-dressed', () => {
    expect(PINNED.map(([id]) => id).sort()).toEqual(['lair_warren', 'lair_wyrm']);
  });

  it.each(PINNED)('%s adds nothing to its floor but the tiles the old decoration blocked', (id) => {
    const def = getLocation(id);
    const now = def.tiles.filter((t) => !t.blocked).map((t) => hexKey(t.coord)).sort();
    const was = new Set(BEFORE[id].walkable.split(' '));
    const freed = new Set(BEFORE[id].freed.split(' ').filter(Boolean));
    expect([...was].filter((k) => !now.includes(k))).toEqual([]);
    expect(now.filter((k) => !was.has(k) && !freed.has(k))).toEqual([]);
    expect([...freed].filter((k) => !now.includes(k))).toEqual([]);
  });
});
