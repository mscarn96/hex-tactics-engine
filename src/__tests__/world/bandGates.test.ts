import { BALANCE } from '@/data/balanceConstants';
import { setLevelCapInputs } from '@/data/levelCap';
import { JADEVEIL_WORLD, worldSeed } from '@/data/worlds';
import { getLocation } from '@/locations';
import { LAIR_SPECS } from '@/locations/lairs';
import { QUESTS } from '@/quests/questData';
import type { QuestId, QuestPredicate } from '@/quests/types';
import { victoryRewards } from '@/systems/combat/combatRewards';
import { xpToNextLevel } from '@/systems/progression/leveling';
import { questXpGold } from '@/systems/quests/questRewards';
import { partyLevelGate, questContext, satisfies } from '@/systems/quests/quests';
import { contentLevel } from '@/systems/world/contentLevel';
import { encounterTimidity, expectedSummedLevel } from '@/systems/world/encounterTimidity';
import { fleeChance } from '@/systems/world/escape';
import { lairGate, lairUnlockLevel } from '@/systems/world/lairs';
import { generateMap } from '@/systems/world/mapGenerator';
import { summitEncounterId } from '@/systems/world/summit';
import { THREAT_BANDS, type ThreatBand } from '@/systems/world/threat';
import { bandFloor, bandGateBase, bandTop } from '@/systems/world/worldBands';
import { rollDailyEncounters } from '@/systems/world/worldState';
import { createRNG } from '@/utils/rng';
import { hexKey } from '@/utils/hexUtils';
import { makeHero, makeUnit } from '../support/fixtures';
import { jadeveilAt } from '../support/bandRoad';

/** XP, gold and level gates beyond the Empire: a band is the same game five levels up. */

afterEach(() => setLevelCapInputs({ owned: [], emperorDefeated: false, banded: [], finished: [] }));

/** The Jadeveil quests' gates, with what each read before bands as a summed level. */
const GATES: [QuestId, number][] = [
  ['the_mossgate', 60], ['lanterns_in_the_bamboo', 62], ['the_silk_hollow', 80],
  ['the_teaching_turned', 70], ['the_silent_hall', 88], ['the_hosts_road', 84],
];

const levelFloor = (gate: QuestPredicate | undefined): number => {
  if (!gate) return 0;
  if (gate.kind === 'all') return Math.max(0, ...gate.of.map(levelFloor));
  return gate.kind === 'partyLevel' ? partyLevelGate(gate) : 0;
};

describe('summed-level gates', () => {
  it('at band 1, stand where they stood', () => {
    setLevelCapInputs(jadeveilAt(1));
    for (const [id, was] of GATES) expect(levelFloor(QUESTS[id].unlockedBy)).toBe(was);
    expect(lairUnlockLevel('lair_silk')).toBe(84);
    expect(lairUnlockLevel('lair_hall')).toBe(92);
    for (const spec of LAIR_SPECS) {
      if (spec.world) expect(bandGateBase(1) + spec.unlockOverBand!).toBe(spec.unlockLevel);
    }
  });

  it('at band 2, stand five levels higher per hero', () => {
    setLevelCapInputs(jadeveilAt(2));
    const perBand = BALANCE.MAX_PARTY_SIZE * BALANCE.EXPANSION_LEVELS;
    expect(perBand).toBe(20);
    for (const [id, was] of GATES) expect(levelFloor(QUESTS[id].unlockedBy)).toBe(was + perBand);
    expect(lairUnlockLevel('lair_silk')).toBe(84 + perBand);
    expect(lairUnlockLevel('lair_hall')).toBe(92 + perBand);
    expect(lairGate('lair_silk', 103, new Set())).toMatchObject({ open: false, needed: 104, have: 103 });
    expect(lairGate('lair_silk', 104, new Set()).open).toBe(true);
  });

  it('are really what quests read', () => {
    setLevelCapInputs(jadeveilAt(2));
    const gate = QUESTS.the_silent_hall.unlockedBy!;
    const store = { completed: ['the_teaching_turned' as QuestId], active: {} };
    expect(satisfies(gate, questContext(107, store))).toBe(false);
    expect(satisfies(gate, questContext(108, store))).toBe(true);
  });

  it('leave the Empire\'s gates and lairs at their own numbers', () => {
    setLevelCapInputs(jadeveilAt(3));
    expect(levelFloor(QUESTS.the_warren_under_the_fields.unlockedBy)).toBe(7);
    expect(lairUnlockLevel('lair_warren')).toBe(getLocation('lair_warren').lair!.unlockLevel);
  });
});

describe('what a band pays', () => {
  const units = (ids: string[]) => [
    makeUnit({ isPlayer: true, currentHp: 10 }),
    ...ids.map((id) => makeUnit({ isPlayer: false, templateId: id as never, currentHp: 0 })),
  ];
  const fight = (threatBand: ThreatBand, world: 'jadeveil' | 'empire' = 'jadeveil') => victoryRewards({
    units: units(['kappa', 'tanuki', 'kodama', 'kitsune']), heroes: [makeHero({ level: 25 })], encounterId: 'random_danger',
    threatBand, threatDepth: 0.5, castleRun: null, isLastStage: false, world, owned: new Set(),
  });

  it('multiplies fights and quests by the band\'s scale, and leaves the Empire alone', () => {
    setLevelCapInputs(jadeveilAt(1));
    const one = fight(2);
    const empire = fight(2, 'empire');
    const quest = questXpGold(QUESTS.the_silk_hollow);
    expect(quest).toEqual({ xp: QUESTS.the_silk_hollow.rewards.xp, gold: QUESTS.the_silk_hollow.rewards.gold });
    expect(one.xpPerHero).toBe(empire.xpPerHero);
    [2, 3, 4].forEach((band) => {
      setLevelCapInputs(jadeveilAt(band));
      const scale = BALANCE.BAND_REWARD_SCALE[band - 1];
      expect(fight(2).xpPerHero).toBe(Math.round(one.xpPerHero * scale));
      expect(fight(2, 'empire').xpPerHero).toBe(empire.xpPerHero);
      expect(questXpGold(QUESTS.the_silk_hollow)).toEqual({
        xp: Math.round(QUESTS.the_silk_hollow.rewards.xp! * scale),
        gold: Math.round(QUESTS.the_silk_hollow.rewards.gold! * scale),
      });
      expect(questXpGold(QUESTS.the_warren_under_the_fields)).toEqual({
        xp: QUESTS.the_warren_under_the_fields.rewards.xp, gold: QUESTS.the_warren_under_the_fields.rewards.gold,
      });
    });
  });

  it('pays gold at the same scale', () => {
    setLevelCapInputs(jadeveilAt(1));
    const one = fight(2).gold;
    setLevelCapInputs(jadeveilAt(4));
    const four = fight(2).gold;
    expect(Math.abs(four - one * BALANCE.BAND_REWARD_SCALE[3])).toBeLessThanOrEqual(1);
  });

  it('pays repeatable content at the band of the cap it stands at', () => {
    const kairen = (tier: number) => victoryRewards({
      units: units(['kairen']), heroes: [makeHero({ level: 40 })], encounterId: summitEncounterId(tier), threatBand: 4,
      castleRun: null, isLastStage: false, world: 'jadeveil', kairenSlain: true, owned: new Set(),
    }).xpPerHero;
    setLevelCapInputs(jadeveilAt(1, 25));
    const atFirstCap = kairen(3);
    const storyFirst = kairen(1);
    setLevelCapInputs(jadeveilAt(1, 40));
    expect(kairen(3)).toBe(Math.round(atFirstCap * BALANCE.BAND_REWARD_SCALE[3]));
    expect(kairen(1)).toBe(storyFirst);
  });

  it('takes bands 2–4 within ±10% of band 1\'s fight count to climb a band, on a seeded walk', () => {
    /** A party of four walking the band's areas in order, a seeded fight on each step, until all pass its top. */
    const climb = (band: number): number => {
      setLevelCapInputs(jadeveilAt(band));
      const dice = createRNG(4711);
      const rng = () => dice.next();
      const rosters = [['kodama', 'tanuki', 'kappa', 'kitsune'], ['kappa', 'kappa', 'tanuki', 'onibi'], ['kitsune', 'tanuki', 'onibi', 'kodama', 'kappa']];
      let level = bandFloor(band);
      let xp = 0;
      let fights = 0;
      while (level <= bandTop(band)) {
        const threatBand = Math.min(4, level - bandFloor(band)) as ThreatBand;
        const roster = rosters[Math.floor(rng() * rosters.length)];
        const reward = victoryRewards({
          units: [...Array.from({ length: 4 }, () => makeUnit({ isPlayer: true, currentHp: 10 })),
            ...roster.map((id) => makeUnit({ isPlayer: false, templateId: id as never, currentHp: 0 }))],
          heroes: Array.from({ length: 4 }, () => makeHero({ level })),
          encounterId: 'random_danger', threatBand, threatDepth: rng(), haunted: rng() < 0.5, castleRun: null, isLastStage: false,
          world: 'jadeveil', owned: new Set(),
        });
        xp += reward.xpPerHero;
        fights++;
        while (level <= bandTop(band) && xp >= xpToNextLevel(level)) xp -= xpToNextLevel(level++);
      }
      return fights;
    };
    const base = climb(1);
    expect(base).toBeGreaterThan(20);
    for (const band of [2, 3, 4]) {
      const count = climb(band);
      expect(Math.abs(count - base) / base).toBeLessThanOrEqual(0.1);
    }
  });
});

describe('encounter timidity and flight beyond the Empire', () => {
  const areas = THREAT_BANDS;

  it('measures a party against the area\'s fixed level: full supply at it', () => {
    setLevelCapInputs(jadeveilAt(1));
    for (const band of areas) {
      expect(expectedSummedLevel(band, 'jadeveil')).toBe(4 * (21 + band));
      expect(encounterTimidity(band, 4 * (21 + band), 'jadeveil')).toBe(1);
    }
  });

  it('thins encounters for a level-40 party in a band-1 world, as the Empire does', () => {
    setLevelCapInputs(jadeveilAt(1, 40));
    const party = 4 * 40;
    for (const band of areas) {
      expect(encounterTimidity(band, party, 'jadeveil')).toBeCloseTo((4 * (21 + band)) / party, 10);
      expect(encounterTimidity(band, party, 'jadeveil')).toBeLessThan(0.65);
    }
    // The same shape as the Empire: twice what the ground expects is half the supply
    expect(encounterTimidity(0, 2 * BALANCE.BAND_EXPECTED_LEVEL[0])).toBeCloseTo(0.5, 10);
    expect(encounterTimidity(0, 2 * expectedSummedLevel(0, 'jadeveil'), 'jadeveil')).toBeCloseTo(0.5, 10);
  });

  it('follows the band: the same party is not over-levelled in a later world', () => {
    setLevelCapInputs(jadeveilAt(4));
    expect(encounterTimidity(0, 4 * 36, 'jadeveil')).toBe(1);
    expect(expectedSummedLevel(4, 'jadeveil')).toBe(4 * 40);
  });

  it('flees by the same measure', () => {
    setLevelCapInputs(jadeveilAt(1));
    const { base, max, min } = BALANCE.VILLAGE_ESCAPE;
    expect(fleeChance(4 * 23, 2, 'jadeveil')).toBe(Math.min(max, Math.max(min, base)));
    expect(fleeChance(8 * 23, 2, 'jadeveil')).toBe(Math.min(max, 2 * base));
    expect(fleeChance(30, 2)).toBe(Math.min(max, Math.max(min, base * 30 / BALANCE.BAND_EXPECTED_LEVEL[2])));
  });

  it('rolls a day of Jadeveil at the full supply for a party at its levels, where the Empire\'s table held it down', () => {
    setLevelCapInputs(jadeveilAt(1));
    const tiles = new Map(generateMap(worldSeed(42, 'jadeveil'), JADEVEIL_WORLD).map((t) => [hexKey(t.coord), t]));
    const count = (partySummedLevel: number, world: 'jadeveil' | 'empire') => {
      const dice = createRNG(9);
      return rollDailyEncounters(tiles, new Map(), { partySummedLevel, world, chanceMult: 1, rng: () => dice.next() }).size;
    };
    const atLevel = count(4 * 21, 'jadeveil');
    expect(atLevel).toBeGreaterThan(count(4 * 21, 'empire') * 1.5);
    expect(count(4 * 40, 'jadeveil')).toBeLessThan(atLevel);
    expect(contentLevel({ world: 'jadeveil', threatBand: 0 })!.level).toBe(21);
  });
});
