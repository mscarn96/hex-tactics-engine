import { BALANCE } from '@/data/balanceConstants';
import { LAIR_SPECS } from '@/locations/lairs';
import { createEnemyUnits, enemyPowerLevel, templateStrength } from '@/systems/combat/unitFactory';
import { castleGarrisonScale, castleTierScale } from '@/systems/world/castle';
import { siegePowerScale } from '@/systems/world/tribute';
import { THREAT_BANDS, lateGroundPremium, neutralDepth, threatPowerScale } from '@/systems/world/threat';
import { CHEST_GUARD_POWER_MULT } from '@/systems/world/finds';

// The top of the span: the strongest ground at the hero cap — since the playtest of
// 2026-10-14, the deepest haunted band 4 with its late premium, or the castle
// garrison at the last Seal tier, whichever is stronger.
const OPENING = threatPowerScale(0, 0, false);
const PEAK_SCALE = Math.max(threatPowerScale(4, 1, true) * lateGroundPremium(4), castleGarrisonScale(BALANCE.MAX_SEAL_TIER));
const PEAK = (1 + BALANCE.ENEMY_LEVEL_SCALE * (BALANCE.MAX_LEVEL - 1)) * PEAK_SCALE;

describe('enemy campaign display levels', () => {
  it('starts near-town enemies at 1, lowers the reported level-8 wolves to 3, and reaches 25 at the strongest ground', () => {
    expect(enemyPowerLevel(1, OPENING)).toBe(1);
    expect(enemyPowerLevel(1, 2.05)).toBe(3);
    expect(enemyPowerLevel(BALANCE.MAX_LEVEL, PEAK_SCALE)).toBe(25);
  });

  // The last-Seal garrison read 23 or more until the castle nerf of 2026-10-20 (29d9cbc1,
  // garrison power 2 -> 1.5) put it under the deepest haunted ground; it still climbs with
  // every Seal tier and stays a late-campaign fight, past the hero cap's ordinary ground.
  it('reads the castle garrison higher at every Seal tier, ending in the upper part of the span', () => {
    const castle = (tier: number) => enemyPowerLevel(BALANCE.MAX_LEVEL, castleGarrisonScale(tier));
    for (let tier = 2; tier <= BALANCE.MAX_SEAL_TIER; tier++) expect(castle(tier)).toBeGreaterThan(castle(tier - 1));
    for (const band of THREAT_BANDS) {
      expect(castle(BALANCE.MAX_SEAL_TIER)).toBeGreaterThan(enemyPowerLevel(BALANCE.MAX_LEVEL, threatPowerScale(band, neutralDepth(band), false)));
    }
    expect(castle(BALANCE.MAX_SEAL_TIER)).toBeGreaterThanOrEqual(18);
    expect(castle(BALANCE.MAX_SEAL_TIER)).toBeLessThanOrEqual(25);
  });

  it('rounds smoothly and never drops as combined power rises', () => {
    // Either side of a midpoint rounds to its nearest label; there is no second
    // rounding of the input.
    const step = (PEAK - OPENING) / 24;
    expect(enemyPowerLevel(1, OPENING + step * 0.49)).toBe(1);
    expect(enemyPowerLevel(1, OPENING + step * 0.51)).toBe(2);
    let previous = 1;
    for (let power = 0; power <= 12; power += 0.05) {
      const level = enemyPowerLevel(1, power);
      expect(Number.isInteger(level)).toBe(true);
      expect(level).toBeGreaterThanOrEqual(previous);
      expect(level).toBeLessThanOrEqual(25);
      previous = level;
    }
    // Party growth and ground difficulty both remain part of the combined power.
    expect(enemyPowerLevel(10, 2.05)).toBeGreaterThan(enemyPowerLevel(1, 2.05));
    expect(enemyPowerLevel(10, 2.05)).toBe(enemyPowerLevel(1, 2.35 * 2.05));
  });

  it('keeps world, chest, every lair, and all castle tiers inside 1–25 throughout the campaign', () => {
    const groundScales = THREAT_BANDS.flatMap(band => [0, 0.5, 1].flatMap(depth =>
      [false, true].flatMap(haunted => {
        const scale = threatPowerScale(band, depth, haunted);
        return [scale, scale * CHEST_GUARD_POWER_MULT];
      })));
    const lairScales = LAIR_SPECS.map(spec => threatPowerScale(spec.band, neutralDepth(spec.band), false));
    const castleScales = Array.from({ length: BALANCE.MAX_SEAL_TIER }, (_, i) => castleTierScale(i + 1));
    for (let partyLevel = 1; partyLevel <= BALANCE.MAX_LEVEL; partyLevel++) {
      for (const scale of [...groundScales, ...lairScales, ...castleScales]) {
        const level = enemyPowerLevel(partyLevel, scale);
        expect(Number.isInteger(level)).toBe(true);
        expect(level).toBeGreaterThanOrEqual(1);
        expect(level).toBeLessThanOrEqual(25);
      }
    }
    expect(enemyPowerLevel(1, 0.5)).toBe(1);
    expect(enemyPowerLevel(1, 100)).toBe(25);
    expect(enemyPowerLevel(BALANCE.MAX_LEVEL, siegePowerScale(1000))).toBe(25);
  });

  it('changes only the wolf readout, preserving its combat sheet and summon strength', () => {
    // The sheet at the base balance: spared `ENEMY_STRENGTH`, which the readout never reads either
    const [wolf] = createEnemyUnits(['wolf'], [{ q: 0, r: 0 }], 1, 2.05, true);
    expect(wolf.level).toBe(3);
    expect(wolf.stats).toEqual({
      maxHp: 92, attack: 18, defense: 6, magicDefense: 6, magic: 2,
      speed: 27, moveRange: 4, maxMana: 0,
    });
    expect(wolf.currentHp).toBe(92);
    expect(wolf.enemyStatScale).toBe(92 / 45);
  });
});

// Playtest 2026-10-14: the level should say what kind of power a creature is, so
// one fight's elite and its chaff no longer read the same.
describe('template strength in the readout', () => {
  it('ranks the templates: chaff under the ordinary, elites and the Legion over it, bosses far over', () => {
    expect(templateStrength('goblin_whelp')).toBeLessThan(0.6);
    expect(templateStrength('wolf')).toBeGreaterThan(0.8);
    expect(templateStrength('wolf')).toBeLessThan(1.2);
    expect(templateStrength('rime_jarl')).toBeGreaterThan(2);
    expect(templateStrength('dread_knight')).toBeGreaterThan(templateStrength('rime_jarl'));
    expect(templateStrength('aethelred')).toBeGreaterThan(templateStrength('heart_of_winter'));
    expect(templateStrength(undefined)).toBe(1);
  });

  it('reads an elite above the chaff it fights beside', () => {
    const [jarl, thrall] = createEnemyUnits(['rime_jarl', 'hold_thrall'], [{ q: 0, r: 0 }, { q: 1, r: 0 }], 12, 1.472);
    expect(jarl.level!).toBeGreaterThanOrEqual(thrall.level! + 4);
  });

  it('changes no stat: only the label weighs the template', () => {
    const [jarl] = createEnemyUnits(['rime_jarl'], [{ q: 0, r: 0 }], 12, 1.472);
    const [plain] = createEnemyUnits(['rime_jarl'], [{ q: 0, r: 0 }], 12, 1.472);
    expect(jarl.stats).toEqual(plain.stats);
    expect(jarl.level).toBe(enemyPowerLevel(12, 1.472, templateStrength('rime_jarl')));
  });
});
