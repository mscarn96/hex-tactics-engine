import { generateMap } from '@/systems/world/mapGenerator';
import { BALANCE } from '@/data/balanceConstants';
import { hexDistance } from '@/utils/hexUtils';
import { MapTile, POIType } from '@/models/types';
import { encounterTimidity } from '@/systems/world/encounterTimidity';
import { ThreatBand } from '@/systems/world/threat';

/**
 * How much there is to fight, and how often walking to a fight finds one.
 *
 * Three numbers between them decide whether the overworld has any content in it:
 * how much haunted ground the generator lays down, what fraction of a zone's
 * tiles hold an encounter at all (`ZONE_ENCOUNTER_RATE`), and what fraction of
 * those are live today (`DAILY_ENCOUNTER_CHANCE`). None of the three is
 * observable from a screenshot and none has a failure mode that looks like a
 * bug — the map renders perfectly, the player simply walks around not finding
 * anything.
 *
 * That is not hypothetical. `DAILY_ENCOUNTER_CHANCE` was cut from 0.55 to 0.30
 * when the roll went from weekly to daily, sized against the map-wide danger
 * density of ~16% — but the ground around the city was 6.5%, and a player *aims*
 * at scorched ground rather than crossing it by accident. The opening hours lost
 * nearly half their content and a playtest reported exactly that, as "I could
 * not find wolves for a very long time".
 *
 * So this measures the supply the first hour of a save actually sees. Analytic
 * over the real generator on several seeds, not sampled — the reason
 * `homeRing.test.ts` gives applies here too.
 */

const SEEDS = [1, 7, 42, 99, 1234];

const homeRing = (tiles: MapTile[], city: { q: number; r: number }) =>
  tiles.filter((t) => hexDistance(t.coord, city) <= BALANCE.HOME_HAUNTED_RADIUS);

function mapFor(seed: number) {
  const tiles = generateMap(seed);
  const city = tiles.find((t) => t.poi === POIType.City)!.coord;
  return { tiles, city };
}

/** Live fights a tile is worth on an average day: content rate × today's roll. */
const liveWorth = (tile: MapTile) =>
  tile.poi ? 0 : BALANCE.ZONE_ENCOUNTER_RATE[tile.zone] * BALANCE.DAILY_ENCOUNTER_CHANCE;

/**
 * The same, for a party of a given summed level — i.e. what `rollDailyEncounters`
 * actually rolls, third factor included.
 */
const liveWorthFor = (tile: MapTile, summedLevel: number) =>
  liveWorth(tile) * encounterTimidity((tile.threat ?? 0) as ThreatBand, summedLevel);

describe('the opening hours have something to fight', () => {
  it('lays down the guaranteed floor of haunted ground near the city', () => {
    const offenders: string[] = [];
    for (const seed of SEEDS) {
      const { tiles, city } = mapFor(seed);
      const haunted = homeRing(tiles, city).filter((t) => t.zone === 'haunted').length;
      // A floor rather than a roll, because the city is the road network's hub —
      // its surroundings are corridor by construction, and corridor is quiet.
      if (haunted < BALANCE.HOME_HAUNTED_MIN) offenders.push(`seed ${seed}: ${haunted}`);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps a full day of live encounters within reach of the city', () => {
    const offenders: string[] = [];
    for (const seed of SEEDS) {
      const { tiles, city } = mapFor(seed);
      const live = homeRing(tiles, city).reduce((sum, t) => sum + liveWorth(t), 0);

      /**
       * Six is the floor because a day is 24 tiles of walking and the home ring
       * is a radius-8 disc: a party can comfortably cross all of it before the
       * set re-rolls. Fewer live than that and the back half of every day is
       * spent walking to ground with nothing on it — the failure this suite is
       * named after, which at `DAILY_ENCOUNTER_CHANCE` 0.30 measured 4.2.
       *
       * Counted across **both** zones now, and net of POIs. A haunted tile is
       * worth 0.33 of a fight and a corridor tile 0.055, so the corridor is not
       * nothing — it is a real slice of the ring's supply, which is exactly the
       * "quiet, not silent" the zone rates were chosen for.
       */
      if (live < 6) offenders.push(`seed ${seed}: ${live.toFixed(1)} live`);
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The daily roll gained a third factor — `encounterTimidity`, which thins the
   * supply once a party has outgrown the ground it is standing on. That is a
   * cut to encounter density, which is exactly the change this suite exists
   * because of: the last one starved a new save and a playtest could not find
   * five wolves.
   *
   * So the guarantee is stated as an identity rather than as a bound. A starting
   * party is **one hero at level 1** — summed level 1, against a band-0
   * expectation of `BAND_EXPECTED_LEVEL[0]` — and every tile in the home ring
   * must be worth precisely what it was worth before the factor existed. Not
   * "close to", not "at least the floor": the same number, per tile.
   */
  it('gives a starting party exactly the supply it had before timidity existed', () => {
    const offenders: string[] = [];
    for (const seed of SEEDS) {
      const { tiles, city } = mapFor(seed);
      for (const tile of homeRing(tiles, city)) {
        const before = liveWorth(tile);
        const after = liveWorthFor(tile, 1);
        if (after !== before) {
          offenders.push(`seed ${seed} ${tile.coord.q},${tile.coord.r}: ${after} != ${before}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * And the whole map, not just the home ring — a starting hero can walk
   * anywhere, and a taper that fired out in Borderland would be the same
   * drought one band over.
   */
  it('leaves the whole map at full supply for a level-1 hero', () => {
    const offenders: string[] = [];
    for (const seed of SEEDS) {
      const { tiles } = mapFor(seed);
      const before = tiles.reduce((sum, t) => sum + liveWorth(t), 0);
      const after = tiles.reduce((sum, t) => sum + liveWorthFor(t, 1), 0);
      if (after !== before) offenders.push(`seed ${seed}: ${after.toFixed(2)} != ${before.toFixed(2)}`);
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The other half of the change, and it has to be measured or the knob is
   * decoration. A party at four times what the ground expects meets the home
   * ring at the floor — a quarter of the supply — while ground scaled for them
   * is untouched.
   */
  it('thins old ground for an overlevelled party and leaves current ground alone', () => {
    // A party the deepest band is written for: summed 55, i.e. four heroes
    // around level 14 — the roster the castle run assumes.
    const party = BALANCE.BAND_EXPECTED_LEVEL[4];
    const { tiles, city } = mapFor(SEEDS[0]);
    const ring = homeRing(tiles, city);
    const fresh = ring.reduce((sum, t) => sum + liveWorthFor(t, 1), 0);
    const veteran = ring.reduce((sum, t) => sum + liveWorthFor(t, party), 0);

    expect(veteran).toBeCloseTo(fresh * BALANCE.ENCOUNTER_TIMIDITY_FLOOR, 6);
    // Never nothing: old ground stays alive, it just stops being a tax.
    expect(veteran).toBeGreaterThan(0);

    // The Emperor's Shadow expects exactly that party, so it is as busy as ever.
    const deep = tiles.filter((t) => (t.threat ?? 0) >= 4);
    expect(deep.length).toBeGreaterThan(0);
    expect(deep.reduce((sum, t) => sum + liveWorthFor(t, party), 0)).toBeCloseTo(
      deep.reduce((sum, t) => sum + liveWorth(t), 0),
      6,
    );
  });

  it('finds a fight more often than not on ground that holds one', () => {
    // The number the player feels. They cannot tell a live tile from a spent
    // one — both are scorched — so this is the odds on every trip out.
    expect(BALANCE.DAILY_ENCOUNTER_CHANCE).toBeGreaterThanOrEqual(0.5);
  });

  it('keeps the road silent and the corridor quiet but not empty', () => {
    // The structural promise, as three numbers. A corridor rate of zero would
    // make the safe route perfectly safe and delete the decision the zones
    // exist to pose; a rate near haunted's would delete the *reason* to leave.
    const rate = BALANCE.ZONE_ENCOUNTER_RATE;
    expect(rate.road).toBe(0);
    expect(rate.corridor).toBeGreaterThan(0);
    expect(rate.corridor).toBeLessThan(rate.haunted / 3);
  });

  it('keeps the home ring thinner than the ground beyond it', () => {
    const offenders: string[] = [];
    for (const seed of SEEDS) {
      const { tiles, city } = mapFor(seed);
      const ring = homeRing(tiles, city);
      const homeRate = ring.filter((t) => t.zone === 'haunted').length / ring.length;
      const outer = tiles.filter((t) => (t.threat ?? 0) >= 2);
      const outerRate = outer.filter((t) => t.zone === 'haunted').length / outer.length;

      // The gradient the whole map is built on. Raising the home floor to fix a
      // drought must not invert it — a safe-looking band 2 would be worse than
      // the drought.
      if (homeRate >= outerRate) {
        offenders.push(`seed ${seed}: home ${homeRate.toFixed(3)} >= outer ${outerRate.toFixed(3)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
