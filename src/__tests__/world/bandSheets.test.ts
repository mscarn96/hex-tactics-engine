import { BALANCE } from '@/data/balanceConstants';
import { setLevelCapInputs } from '@/data/levelCap';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { itemLevelScale } from '@/data/items/itemLevel';
import { Rarity, TileType } from '@/models/types';
import { buildEncounter, type EncounterTerms } from '@/systems/combat/encounterSetup';
import { createEnemyUnits, scaleEnemyStats } from '@/systems/combat/unitFactory';
import { bandGroundPower, bandPowerStep } from '@/systems/world/bandPower';
import { WARBAND_ENCOUNTER_ID } from '@/systems/world/encounterGenerator';
import { shrineBand, shrineEncounterId } from '@/systems/world/shrines';
import { summitEncounterId, summitTierScale } from '@/systems/world/summit';
import {
  lateGroundPremium, neutralDepth, threatEncounterSize, threatPowerScale, type ThreatBand,
} from '@/systems/world/threat';
import { CHEST_GUARD_POWER_MULT, CHEST_GUARD_ID, chestGuardBand } from '@/systems/world/finds';
import { bandFloor } from '@/systems/world/worldBands';
import { jadeveilAt } from '../support/bandRoad';
import { makeHero } from '../support/fixtures';
import { FACTIONS } from '@/data/templates/factions';

/**
 * Enemies beyond the Empire stand at the content's level, whoever turns up.
 *
 * The pins are against what Jadeveil fielded before bands existed: the party's mean level in the
 * level term, the world's ground multiplier and the threat gradient on top. A party at an area's
 * level must meet exactly that, and only a party off pace may meet anything different.
 */

const heroesAt = (level: number) => Array.from({ length: 4 }, () => makeHero({ level }));

const none = { active: false, powerScale: 1 };

function termsFor(id: string | null, band: ThreatBand, depth = neutralDepth(band), haunted = false): EncounterTerms {
  return {
    tileType: TileType.Plains, frost: false, curated: id === WARBAND_ENCOUNTER_ID ? null : band,
    guardsChest: false, threatBand: band, groundBand: band, haunted, fromCastle: Infinity, groundDepth: depth, world: 'jadeveil',
  };
}

function build(id: string, terms: EncounterTerms, partyLevel: number) {
  return buildEncounter({ encounterId: id, terms, heroes: heroesAt(partyLevel), castleRun: null, sim: none, entry: null });
}

/** What the fight's bodies were before bands: the party's level, and this power scale. */
function expectSheets(built: ReturnType<typeof buildEncounter>, level: number, power: number) {
  for (const unit of built.enemies) {
    const template = enemyTemplates.find((t) => t.id === unit.templateId)!;
    expect(unit.stats).toEqual(scaleEnemyStats(template.baseStats, level, power, built.spared));
  }
}

/** Today's wandering fight's multiplier, written out: the rule it was before this feature. */
const wanderingPower = (band: ThreatBand, depth: number, haunted: boolean) => threatPowerScale(band, depth, haunted)
  * lateGroundPremium(band) * BALANCE.BAND_GROUND_POWER
  * (threatEncounterSize(band) / BALANCE.JADEVEIL_ENCOUNTER_SIZE[band]);

describe('Jadeveil at band 1, for a party at each area\'s level', () => {
  beforeAll(() => setLevelCapInputs(jadeveilAt(1)));
  afterAll(() => setLevelCapInputs({ owned: [], emperorDefeated: false, banded: [], finished: [] }));

  it('fields today\'s wandering fights', () => {
    for (const band of [0, 1, 2, 3, 4] as ThreatBand[]) {
      for (const [depth, haunted] of [[0.2, false], [0.8, true]] as const) {
        const built = build(WARBAND_ENCOUNTER_ID, termsFor(WARBAND_ENCOUNTER_ID, band, depth, haunted), 21 + band);
        expect(built.partyLevel).toBe(21 + band);
        expect(built.powerScale).toBeCloseTo(wanderingPower(band, depth, haunted), 10);
        expectSheets(built, 21 + band, wanderingPower(band, depth, haunted));
      }
    }
  });

  it('fields today\'s chest guards, at the level of the ground they stand on', () => {
    for (const ground of [0, 1, 2, 3, 4] as ThreatBand[]) {
      const band = chestGuardBand(ground);
      const terms = { ...termsFor(CHEST_GUARD_ID, band), guardsChest: true, curated: null, groundBand: ground };
      const built = build(CHEST_GUARD_ID, terms, 21 + ground);
      const power = threatPowerScale(band, neutralDepth(band), false) * CHEST_GUARD_POWER_MULT * lateGroundPremium(band) * BALANCE.BAND_GROUND_POWER;
      expect(built.partyLevel).toBe(21 + ground);
      expect(built.powerScale).toBeCloseTo(power, 10);
    }
  });

  it('fields today\'s lairs and shrines', () => {
    const lairs: [string, ThreatBand, number, boolean][] = [
      ['lair_silk_1', 2, 22, false], ['lair_silk_2', 3, 22, false], ['lair_silk_boss', 2, 22, true],
      ['lair_hall_1', 3, 24, false], ['lair_hall_2', 4, 24, false], ['lair_hall_boss', 3, 24, true],
    ];
    for (const [id, band, level, boss] of lairs) {
      const built = build(id, termsFor(id, band), level);
      const power = threatPowerScale(band, neutralDepth(band), false)
        * (boss ? 1 : lateGroundPremium(band) * BALANCE.BAND_GROUND_POWER);
      expect(built.partyLevel).toBe(level);
      expect(built.powerScale).toBeCloseTo(power, 10);
      expectSheets(built, level, power);
    }
    for (const shrine of [1, 2, 3, 4]) {
      const id = shrineEncounterId(shrine);
      const band = shrineBand(shrine);
      const built = build(id, termsFor(id, band), 21 + band);
      const power = threatPowerScale(band, neutralDepth(band), false) * lateGroundPremium(band)
        * BALANCE.BAND_GROUND_POWER * BALANCE.SHRINE_KEEPER_POWER;
      expect(built.powerScale).toBeCloseTo(power, 10);
      expectSheets(built, 21 + band, power);
    }
  });

  it('fields today\'s Kairen, story and Storm Seal tiers alike, for a party at level 25', () => {
    for (const tier of [1, 2, 3, 4, 5]) {
      const id = summitEncounterId(tier);
      const built = build(id, termsFor(id, 4), 25);
      expect(built.partyLevel).toBe(25);
      expect(built.powerScale).toBeCloseTo(summitTierScale(tier), 10);
      expectSheets(built, 25, summitTierScale(tier));
    }
  });
});

describe('an off-pace party', () => {
  afterAll(() => setLevelCapInputs({ owned: [], emperorDefeated: false, banded: [], finished: [] }));

  it('meets the same sheets at any level', () => {
    setLevelCapInputs(jadeveilAt(1));
    for (const partyLevel of [10, 19, 22, 25, 40]) {
      const built = build('lair_silk_boss', termsFor('lair_silk_boss', 2), partyLevel);
      expect(built.partyLevel).toBe(22);
      expectSheets(built, 22, threatPowerScale(2, neutralDepth(2), false));
    }
  });

  it('at level 40 meets a band-1 world\'s story at its area\'s level, and Kairen\'s tier 3 at the cap', () => {
    setLevelCapInputs(jadeveilAt(1, 40));
    const band = 2 as ThreatBand;
    const ground = build(WARBAND_ENCOUNTER_ID, termsFor(WARBAND_ENCOUNTER_ID, band, 0.5), 40);
    expect(ground.partyLevel).toBe(23);
    expect(ground.powerScale).toBeCloseTo(wanderingPower(band, 0.5, false), 10);

    const story = build(summitEncounterId(1), termsFor(summitEncounterId(1), 4), 40);
    expect(story.partyLevel).toBe(25);
    expect(story.powerScale).toBeCloseTo(summitTierScale(1), 10);

    const seal = build(summitEncounterId(3), termsFor(summitEncounterId(3), 4), 40);
    expect(seal.partyLevel).toBe(40);
    // Fought at the cap, with the cap's band's step and his tier's scale on top
    expect(seal.powerScale).toBeCloseTo(summitTierScale(3) * bandPowerStep(4), 10);
    expectSheets(seal, 40, summitTierScale(3) * bandPowerStep(4));
  });

  it('keeps the level a resumed fight was built at', () => {
    setLevelCapInputs(jadeveilAt(1));
    const first = build('lair_hall_boss', termsFor('lair_hall_boss', 3), 24);
    const entry = JSON.parse(JSON.stringify(first.snapshot));
    setLevelCapInputs(jadeveilAt(1, 30));
    const resumed = buildEncounter({ encounterId: 'lair_hall_boss', terms: termsFor('lair_hall_boss', 3), heroes: heroesAt(30), castleRun: null, sim: none, entry });
    expect(resumed.restored).toBe(true);
    expect(resumed.partyLevel).toBe(24);
    expect(resumed.enemies.map((u) => u.stats)).toEqual(first.enemies.map((u) => u.stats));
    expect(resumed.enemies.map((u) => u.level)).toEqual(first.enemies.map((u) => u.level));
  });

  it('leaves the Empire scaling with the party', () => {
    setLevelCapInputs(jadeveilAt(1));
    const terms = { ...termsFor(WARBAND_ENCOUNTER_ID, 2, 0.5), world: 'empire' as const };
    expect(build(WARBAND_ENCOUNTER_ID, terms, 13).partyLevel).toBe(13);
    expect(build(WARBAND_ENCOUNTER_ID, terms, 18).partyLevel).toBe(18);
  });

  it('leaves the harness stating its own level and multiplier', () => {
    setLevelCapInputs(jadeveilAt(1));
    const built = buildEncounter({ encounterId: WARBAND_ENCOUNTER_ID, terms: termsFor(WARBAND_ENCOUNTER_ID, 2), heroes: heroesAt(30), castleRun: null, sim: { active: true, powerScale: 2 }, entry: null });
    expect(built.partyLevel).toBe(30);
    expect(built.powerScale).toBe(2);
  });
});

describe('the band power table', () => {
  afterAll(() => setLevelCapInputs({ owned: [], emperorDefeated: false, banded: [], finished: [] }));

  it('is band 1 at today\'s ×3, and derives the later steps from the gear held at each band\'s start, with the tuned trim on top', () => {
    expect(BALANCE.BAND_POWER_TRIM[0]).toBe(1);
    expect(bandPowerStep(1)).toBe(1);
    expect(bandGroundPower(1)).toBe(BALANCE.BAND_GROUND_POWER);
    const share = BALANCE.BAND_GEAR_LEGENDARY_SHARE;
    const held = (band: number) => (1 - share) * itemLevelScale(bandFloor(band), Rarity.Epic)
      + share * itemLevelScale(bandFloor(band) - 1, Rarity.Legendary);
    const term = (band: number) => 1 + BALANCE.ENEMY_LEVEL_SCALE * (bandFloor(band) - 1);
    for (const band of [2, 3, 4]) {
      expect(bandPowerStep(band)).toBeCloseTo((held(band) / held(1)) / (term(band) / term(1)) * BALANCE.BAND_POWER_TRIM[band - 1], 10);
      // A later band is not easier: the gear outgrows the level term, and the step takes up the rest
      expect(bandPowerStep(band)).toBeGreaterThan(bandPowerStep(band - 1));
    }
  });

  it('does not read the cap: the step is a function of the band', () => {
    setLevelCapInputs(jadeveilAt(1, 25));
    const at25 = [1, 2, 3, 4].map(bandPowerStep);
    setLevelCapInputs(jadeveilAt(1, 40));
    expect([1, 2, 3, 4].map(bandPowerStep)).toEqual(at25);
  });

  it('moves band-2 sheets along the curve from band 1\'s', () => {
    const band = 2 as ThreatBand;
    setLevelCapInputs(jadeveilAt(1));
    const one = build(WARBAND_ENCOUNTER_ID, termsFor(WARBAND_ENCOUNTER_ID, band, 0.5), 23);
    setLevelCapInputs(jadeveilAt(2));
    const two = build(WARBAND_ENCOUNTER_ID, termsFor(WARBAND_ENCOUNTER_ID, band, 0.5), 28);
    expect(two.partyLevel).toBe(one.partyLevel + BALANCE.EXPANSION_LEVELS);
    expect(two.powerScale).toBeCloseTo(one.powerScale * bandPowerStep(2), 10);
    expectSheets(two, 28, one.powerScale * bandPowerStep(2));
    // And the bosses, who take the step alone
    const boss = build('lair_silk_boss', termsFor('lair_silk_boss', 2), 27);
    expect(boss.partyLevel).toBe(27);
    expect(boss.powerScale).toBeCloseTo(threatPowerScale(2, neutralDepth(2), false) * bandPowerStep(2), 10);
    const kairen = build(summitEncounterId(1), termsFor(summitEncounterId(1), 4), 30);
    expect(kairen.partyLevel).toBe(30);
    expect(kairen.powerScale).toBeCloseTo(bandPowerStep(2), 10);
  });
});

describe('the enemy level readout beyond the Empire', () => {
  afterAll(() => setLevelCapInputs({ owned: [], emperorDefeated: false, banded: [], finished: [] }));

  it('reads the content level, nudged by the template, inside 21–40', () => {
    setLevelCapInputs(jadeveilAt(1));
    const reach = BALANCE.ENEMY_CONTENT_LEVEL_NUDGE_MAX;
    for (const band of [0, 2, 4] as ThreatBand[]) {
      const built = build(WARBAND_ENCOUNTER_ID, termsFor(WARBAND_ENCOUNTER_ID, band, 0.5), 40);
      for (const unit of built.enemies) {
        expect(unit.level).toBeGreaterThanOrEqual(21);
        expect(Math.abs(unit.level! - (21 + band))).toBeLessThanOrEqual(reach);
      }
    }
    const [kairen] = build(summitEncounterId(5), termsFor(summitEncounterId(5), 4), 25).enemies;
    expect(kairen.level).toBeGreaterThanOrEqual(25);
  });

  it('is stood at the band\'s levels whatever calls it up, and it never moves a stat', () => {
    const [plain] = createEnemyUnits(['kappa'], [{ q: 0, r: 0 }], 25, 2);
    const [read] = createEnemyUnits(['kappa'], [{ q: 0, r: 0 }], 25, 2, false, 25);
    expect(read.stats).toEqual(plain.stats);
    expect(read.level).toBe(25);
    expect(read.contentLevel).toBe(25);
    expect(plain.contentLevel).toBeUndefined();
    // A summon scaled off its owner keeps the content level it is told
    const [summon] = createEnemyUnits(['kappa'], [{ q: 0, r: 0 }], 1, read.enemyStatScale!, false, read.contentLevel);
    expect(summon.level).toBe(25);
    expect(summon.stats.maxHp).toBe(read.stats.maxHp);
  });

  it('holds no Jadeveil enemy that summons through the skill route, which reads a unit\'s readout level', () => {
    const summoners = enemyTemplates.filter((t) => t.skills.some((s) => s.summons)).map((t) => t.id);
    const walkers = FACTIONS.filter((f) => f.worlds?.includes('jadeveil')).map((f) => JSON.stringify(f));
    expect(summoners.filter((id) => walkers.some((roster) => roster.includes(`"${id}"`)))).toEqual([]);
  });
});
