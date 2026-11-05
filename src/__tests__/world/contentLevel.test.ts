import { BALANCE } from '@/data/balanceConstants';
import { JADEVEIL_WORLD } from '@/data/worlds';
import { lairsOf } from '@/locations/lairs';
import { xpToNextLevel } from '@/systems/progression/leveling';
import { areaLevel, contentKind, contentLevel, contentOffset } from '@/systems/world/contentLevel';
import { CHEST_GUARD_ID } from '@/systems/world/finds';
import { WARBAND_ENCOUNTER_ID } from '@/systems/world/encounterGenerator';
import { shrineEncounterId, SHRINE_COUNT } from '@/systems/world/shrines';
import { STORM_TIERS, summitEncounterId } from '@/systems/world/summit';
import { THREAT_BANDS } from '@/systems/world/threat';
import { bandFloor, bandTop } from '@/systems/world/worldBands';
import type { RoadState } from '@/data/levelCap';
import { jadeveilAt } from '../support/bandRoad';

/**
 * Where content stands beyond the Empire: one rule for every fight and reward source, and the
 * party's level is not one of its inputs (the private project notes).
 */

const jadeveilIds = () => [
  ...lairsOf('jadeveil').flatMap((lair) => lair.encounters),
  ...Array.from({ length: SHRINE_COUNT }, (_, i) => shrineEncounterId(i + 1)),
  summitEncounterId(1),
];

describe('content levels', () => {
  it('resolves every Jadeveil encounter id and threat band to an offset from 0 to 4', () => {
    for (const id of jadeveilIds()) {
      const offset = contentOffset({ world: 'jadeveil', encounterId: id });
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(4);
      expect(Number.isInteger(offset)).toBe(true);
    }
    for (const id of [WARBAND_ENCOUNTER_ID, CHEST_GUARD_ID, null]) {
      expect(THREAT_BANDS.map((threatBand) => contentOffset({ world: 'jadeveil', encounterId: id, threatBand })))
        .toEqual([0, 1, 2, 3, 4]);
    }
    expect(JADEVEIL_WORLD.levelOffsets).toHaveLength(THREAT_BANDS.length);
  });

  it('authors the sites over their areas', () => {
    const offset = (encounterId: string) => contentOffset({ world: 'jadeveil', encounterId });
    for (const id of ['lair_silk_1', 'lair_silk_2', 'lair_silk_boss', 'lair_silk_chest']) expect(offset(id)).toBe(1);
    for (const id of ['lair_hall_1', 'lair_hall_2', 'lair_hall_boss', 'lair_hall_chest']) expect(offset(id)).toBe(3);
    expect([1, 2, 3, 4].map((i) => offset(shrineEncounterId(i)))).toEqual([1, 2, 3, 4]);
    expect(offset(summitEncounterId(1))).toBe(BALANCE.KAIREN.STORY_LEVEL_OFFSET);
    expect(contentOffset({ world: 'jadeveil', locationId: 'lair_silk' })).toBe(1);
  });

  it('marks the summit tiers above the story as repeatable, and everything else as story', () => {
    expect(STORM_TIERS.map((t) => contentKind(summitEncounterId(t))))
      .toEqual(['story', 'repeatable', 'repeatable', 'repeatable', 'repeatable']);
    for (const id of [...jadeveilIds().filter((i) => i !== summitEncounterId(1)), WARBAND_ENCOUNTER_ID, null]) {
      expect(contentKind(id)).toBe('story');
    }
  });

  it('puts story content at band floor + offset with loot under band top, at every band', () => {
    for (const band of [1, 2, 3, 4]) {
      const road = jadeveilAt(band);
      for (const threatBand of THREAT_BANDS) {
        const content = contentLevel({ world: 'jadeveil', encounterId: WARBAND_ENCOUNTER_ID, threatBand }, road)!;
        expect(content).toMatchObject({ band, kind: 'story', level: bandFloor(band) + threatBand, ceiling: bandTop(band) });
        expect(areaLevel('jadeveil', threatBand, road)).toBe(content.level);
      }
      expect(contentLevel({ world: 'jadeveil', encounterId: 'lair_hall_boss' }, road)!.level).toBe(bandFloor(band) + 3);
      expect(contentLevel({ world: 'jadeveil', encounterId: summitEncounterId(1) }, road)!.level).toBe(bandTop(band));
    }
  });

  it('keeps a band-1 world\'s story where it was left as the cap rises, and sets repeatables at the cap', () => {
    for (const cap of [25, 30, 35, 40]) {
      const road = jadeveilAt(1, cap);
      expect(contentLevel({ world: 'jadeveil', threatBand: 2 }, road)).toMatchObject({ level: 23, ceiling: 25 });
      for (const tier of [2, 3, 4, 5]) {
        expect(contentLevel({ world: 'jadeveil', encounterId: summitEncounterId(tier) }, road))
          .toMatchObject({ band: 1, kind: 'repeatable', level: cap, ceiling: cap });
      }
    }
  });

  it('answers no band in the Empire, whatever the encounter', () => {
    for (const id of [WARBAND_ENCOUNTER_ID, 'lair_warren_boss', summitEncounterId(3), null]) {
      expect(contentLevel({ world: 'empire', encounterId: id, threatBand: 2 }, jadeveilAt(1))).toBeNull();
    }
    expect(areaLevel('empire', 2, jadeveilAt(1))).toBeNull();
  });

  it('leaves a siege the Empire\'s, wherever the party is standing when it comes', () => {
    expect(contentLevel({ world: 'jadeveil', encounterId: 'empire_siege_3' }, jadeveilAt(1))).toBeNull();
  });

  it('reads a world not yet crossed to at the band it will take', () => {
    const road: RoadState = { owned: ['jadeveil', 'archipelago'], emperorDefeated: true, banded: ['archipelago'], finished: ['archipelago'] };
    expect(contentLevel({ world: 'jadeveil', threatBand: 0 }, road)!.band).toBe(2);
  });

  it('pays each band what its five levels cost to climb', () => {
    const climb = (band: number) => {
      let xp = 0;
      for (let level = bandFloor(band); level <= bandTop(band); level++) xp += xpToNextLevel(level);
      return xp;
    };
    BALANCE.BAND_REWARD_SCALE.forEach((scale, i) => expect(scale).toBeCloseTo(climb(i + 1) / climb(1), 1));
  });
});
