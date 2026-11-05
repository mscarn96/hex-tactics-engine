import { encounterTimidity } from '@/systems/world/encounterTimidity';
import { THREAT_BANDS, ThreatBand } from '@/systems/world/threat';
import { BALANCE } from '@/data/balanceConstants';

/**
 * Enemies are scared of a strong party.
 *
 * The third factor in the daily encounter roll, and the only one that knows who
 * is walking on the tile. An overlevelled party crossing Home Reach was meeting
 * band-0 chaff at full density — a fight that cannot be lost, cannot teach
 * anything and costs a scene transition. This taper is what removes it *without*
 * touching the difficulty curve: the fights that still happen are the same
 * fights, there are simply fewer of them.
 *
 * Measured rather than eyeballed because none of it is observable from a
 * screenshot. A factor that came out slightly under 1 in the opening hours would
 * thin a new save's content with nothing on screen to say so — which is the
 * exact failure `encounterSupply.test.ts` is named after, arriving by a new
 * route.
 */

const FLOOR = BALANCE.ENCOUNTER_TIMIDITY_FLOOR;

describe('encounter timidity', () => {
  /**
   * The property the opening hours depend on, and the one worth stating as an
   * exact equality rather than a bound: at or under what the ground expects,
   * this mechanism is not merely gentle, it is *absent*.
   */
  it('is exactly 1 at and below the level its band expects', () => {
    const offenders: string[] = [];
    for (const band of THREAT_BANDS) {
      const expected = BALANCE.BAND_EXPECTED_LEVEL[band];
      for (const level of [1, 2, expected - 1, expected]) {
        const got = encounterTimidity(band, level);
        if (got !== 1) offenders.push(`band ${band} @ ${level}: ${got}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /** The starting party — one hero, level 1 — anywhere on the map. */
  it('leaves a starting party untouched in every band', () => {
    expect(THREAT_BANDS.map((b) => encounterTimidity(b, 1))).toEqual(THREAT_BANDS.map(() => 1));
  });

  it('tapers as the reciprocal of how far past the expectation the party is', () => {
    const band = 0 as ThreatBand;
    const expected = BALANCE.BAND_EXPECTED_LEVEL[band];
    // Twice the expected level is half the supply, while that is above the floor.
    expect(encounterTimidity(band, expected * 2)).toBeCloseTo(0.5, 10);
    expect(encounterTimidity(band, expected * 3)).toBeCloseTo(1 / 3, 10);
  });

  /**
   * Never zero. A region of the map with no encounters at all has silently
   * stopped being a game, and the player has nothing on screen telling them why.
   */
  it('clamps to the floor however far past the ground the party is', () => {
    const offenders: string[] = [];
    for (const band of THREAT_BANDS) {
      // The exact level the clamp bites at is `expected / FLOOR`; past it the
      // answer must stop moving entirely.
      const bites = BALANCE.BAND_EXPECTED_LEVEL[band] / FLOOR;
      for (const level of [bites, bites + 1, 1000, 100000]) {
        const got = encounterTimidity(band, level);
        if (got !== FLOOR) offenders.push(`band ${band} @ ${level}: ${got}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(FLOOR).toBeGreaterThan(0);
  });

  it('never returns above 1 or below the floor, anywhere', () => {
    const offenders: string[] = [];
    for (const band of THREAT_BANDS) {
      for (let level = 0; level <= 400; level++) {
        const got = encounterTimidity(band, level);
        if (!(got >= FLOOR && got <= 1)) offenders.push(`band ${band} @ ${level}: ${got}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Monotone, because a level-up must never *increase* how much the map bothers
   * you. A non-monotone taper would be a band of levels where growing made the
   * game noisier, which nobody would ever attribute to this.
   */
  it('is monotonically non-increasing in party level', () => {
    const offenders: string[] = [];
    for (const band of THREAT_BANDS) {
      let previous = encounterTimidity(band, 0);
      for (let level = 1; level <= 400; level++) {
        const got = encounterTimidity(band, level);
        if (got > previous) offenders.push(`band ${band}: ${level - 1}→${level} ${previous}→${got}`);
        previous = got;
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * `setTiles` pre-rolls day one during map generation, before the starting hero
   * has been chosen — so an empty party is a real call and not a hypothetical.
   * A division by zero here would put `NaN` in every comparison and open the
   * save with an empty map.
   */
  it('leaves the roll alone for a party that does not exist yet', () => {
    expect(THREAT_BANDS.map((b) => encounterTimidity(b, 0))).toEqual(THREAT_BANDS.map(() => 1));
  });

  /**
   * Deeper ground expects more, so the same party is more frightening the
   * closer to home it is. Without this the taper would fire first out at the
   * castle, which is precisely backwards.
   */
  it('expects more of the party the further out the band is', () => {
    const levels = BALANCE.BAND_EXPECTED_LEVEL;
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThan(levels[i - 1]);
    }
    const party = 30;
    const factors = THREAT_BANDS.map((b) => encounterTimidity(b, party));
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i]).toBeGreaterThanOrEqual(factors[i - 1]);
    }
  });
});
