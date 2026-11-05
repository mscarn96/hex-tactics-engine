import {
  THREAT_BANDS,
  ThreatBand,
  threatAt,
  threatEliteCount,
  threatEncounterSize,
  threatLabel,
  threatPowerScale,
  threatRewardScale,
} from '@/systems/world/threat';
import { generateForBand, generateEncounterEnemies } from '@/systems/world/encounterGenerator';
import { empireCastleCoord, generateMap } from '@/systems/world/mapGenerator';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { FACTIONS } from '@/data/templates/factions';
import { BALANCE } from '@/data/balanceConstants';
import { hexDistance } from '@/utils/hexUtils';
import { HexCoord, POIType } from '@/models/types';
import { bandComposition } from '../support/threatCurve';

const CITY: HexCoord = { q: 0, r: 0 };
const FAR: HexCoord = { q: 100, r: 0 };

describe('the gradient', () => {
  it('keeps the city itself at rest', () => {
    expect(threatAt(CITY, CITY, FAR)).toBe(0);
  });

  it('never falls as you walk away from home', () => {
    const falling: string[] = [];
    let previous = 0;
    for (let d = 0; d <= 40; d++) {
      const band = threatAt({ q: d, r: 0 }, CITY, FAR);
      if (band < previous) falling.push(`${d}: ${band} < ${previous}`);
      previous = band;
    }
    expect(falling).toEqual([]);
  });

  it('gives a fresh party somewhere to stand', () => {
    expect(threatAt({ q: 3, r: 0 }, CITY, FAR)).toBe(0);
  });

  // The castle only ever raises. A tile beside the Legion is band 4 whether or
  // not it happens to sit near the city, which is what makes the corner a threat
  // from week one rather than a surprise in week twenty.
  it('lets the castle override proximity to home', () => {
    const castle: HexCoord = { q: 4, r: 0 };
    expect(threatAt({ q: 4, r: 0 }, CITY, castle)).toBe(4);
    expect(threatAt({ q: 2, r: 0 }, CITY, castle)).toBe(4);
  });

  it('never lowers a band the city already set', () => {
    const castle: HexCoord = { q: 100, r: 0 };
    const lowered: string[] = [];
    for (let d = 0; d <= 40; d++) {
      const withCastle = threatAt({ q: d, r: 0 }, CITY, castle);
      const without = threatAt({ q: d, r: 0 }, CITY, null);
      if (withCastle < without) lowered.push(`${d}`);
    }
    expect(lowered).toEqual([]);
  });

  it('stays inside the scale', () => {
    const outside: string[] = [];
    for (let d = 0; d <= 200; d++) {
      const band = threatAt({ q: d, r: 0 }, CITY, { q: 50, r: 0 });
      if (band < 0 || band > 4) outside.push(`${d}: ${band}`);
    }
    expect(outside).toEqual([]);
  });
});

describe('band scaling', () => {
  /**
   * Power is measured composition-weighted — `bandComposition ×
   * threatPowerScale` — because that is the fight the ground actually fields.
   * `THREAT_BAND_BASE_SCALE` softens the raw multiplier from band 2 out, and at
   * the 1→2 seam the multiplier alone now dips ~2.5% below band 1's; the third
   * body and the first elite arrive on the same hex and more than cover it, so
   * the *difficulty* stays monotone and that is the thing this test holds.
   * Reward took no soften, so it stays monotone on the raw multiplier.
   */
  it('never rewards or punishes less further out', () => {
    const wrong: string[] = [];
    for (let b = 0; b < 4; b++) {
      const band = b as ThreatBand;
      const next = (b + 1) as ThreatBand;
      const difficulty = (x: ThreatBand) => bandComposition(x) * threatPowerScale(x);
      if (difficulty(next) <= difficulty(band)) wrong.push(`power ${b}`);
      if (threatRewardScale(next) <= threatRewardScale(band)) wrong.push(`reward ${b}`);
      if (threatEncounterSize(next) < threatEncounterSize(band)) wrong.push(`size ${b}`);
      if (threatEliteCount(next) < threatEliteCount(band)) wrong.push(`elites ${b}`);
    }
    expect(wrong).toEqual([]);
  });

  /**
   * The home ring is a floor, not a slope.
   *
   * It used to run at exactly template strength, and templates are tuned for a
   * party rather than for the one hero the game hands you — so the opening
   * fights offered no resistance at all. `THREAT_EARLY_FLOOR` lifts both power
   * and pay in **band 0 only**; the slope does everything from band 1 outward.
   *
   * Applying it at band 1 as well is what the test below rules out: floor and
   * slope stack there, so band 1 would have to stay under band 2 and the floor
   * would be capped by a number that has nothing to do with the home ring.
   */
  it('lifts the home ring off template strength, and pays for it', () => {
    expect(threatPowerScale(0)).toBeCloseTo(1 + BALANCE.THREAT_EARLY_FLOOR);
    expect(threatRewardScale(0)).toBeCloseTo(1 + BALANCE.THREAT_EARLY_FLOOR);
  });

  // Gentle is still the point: a lifted home ring must not approach band 2.
  // Composition-weighted for the reason the monotonicity test above is — the
  // softened band-2 multiplier sits beside band 1's, and it is the elite and
  // the third body that keep Contested a clear step up.
  it('keeps the home ring well below the first elite band', () => {
    const difficulty = (x: ThreatBand) => bandComposition(x) * threatPowerScale(x);
    expect(difficulty(0)).toBeLessThan(difficulty(2));
    expect(difficulty(1)).toBeLessThan(difficulty(2));
  });

  /**
   * Travelling costs hours, and hours are what the tribute charges for. If
   * reward did not outpace difficulty, the optimal play would be to farm the
   * ring around the city and the whole gradient would be decoration.
   */
  it('pays better than it costs', () => {
    const underpaid = THREAT_BANDS.filter((b) => threatRewardScale(b) < threatPowerScale(b));
    expect(underpaid).toEqual([]);
  });

  // Home ground must never field something that deletes a hero on turn one
  it('keeps elites out of the home ring', () => {
    expect(threatEliteCount(0)).toBe(0);
  });

  it('never fills more than the spawn row holds', () => {
    const oversized = THREAT_BANDS.filter((b) => threatEncounterSize(b) > BALANCE.THREAT_MAX_ENEMIES);
    expect(oversized).toEqual([]);
  });

  it('never asks for more elites than there are bodies', () => {
    const wrong = THREAT_BANDS.filter((b) => threatEliteCount(b) >= threatEncounterSize(b));
    expect(wrong).toEqual([]);
  });

  it('labels every band', () => {
    const unlabelled = THREAT_BANDS.filter((b) => !threatLabel(b));
    expect(unlabelled).toEqual([]);
  });
});

describe('encounter composition', () => {
  const eliteIds = new Set<string>(enemyTemplates.filter((t) => t.tier === 'elite').map((t) => t.id));

  it('fields the right number for the band', () => {
    const wrong: string[] = [];
    for (const band of THREAT_BANDS) {
      const size = generateForBand(band).length;
      if (size !== threatEncounterSize(band)) wrong.push(`${band}: ${size}`);
    }
    expect(wrong).toEqual([]);
  });

  it('sends only rank and file to the home ring', () => {
    const offenders: string[] = [];
    for (let i = 0; i < 50; i++) {
      for (const id of generateForBand(0)) {
        if (eliteIds.has(id)) offenders.push(id);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('leads with elites out in the badlands', () => {
    const missing: number[] = [];
    for (let i = 0; i < 50; i++) {
      const enemies = generateForBand(4);
      if (!enemies.some((id) => eliteIds.has(id))) missing.push(i);
    }
    expect(missing).toEqual([]);
  });

  /**
   * The tile's band *is* the fight's band.
   *
   * A danger tile used to fight one band above the ground around it — but
   * encounters fire only on danger tiles, so there were no surroundings to be
   * worse than. The bump was a silent +1 on every fight in the game, and it made
   * the threat label the map shows you wrong by exactly one band. The gradient
   * exists to warn the player, and a warning off by one is not one.
   *
   * Checked on composition rather than on size, which is what the old test did:
   * `threatEncounterSize` returns 2 for both band 0 and band 1, so a size
   * assertion passed whether the bump was there or not.
   */
  it('fights the band the tile says it is', () => {
    const eliteIds = new Set<string>(
      enemyTemplates.filter((t) => t.tier === 'elite').map((t) => t.id),
    );
    const chaffIds = new Set<string>(
      FACTIONS.flatMap((f) => f.roles.chaff as string[]),
    );

    const wrong: string[] = [];
    for (let i = 0; i < 200; i++) {
      // Home ground is chaff and nothing else, however burned the tile looks
      for (const id of generateEncounterEnemies('random_danger', 0)) {
        if (!chaffIds.has(id)) wrong.push(`band 0: ${id}`);
      }
      // And band 1 still holds the elites back
      for (const id of generateEncounterEnemies('random_danger', 1)) {
        if (eliteIds.has(id)) wrong.push(`band 1: ${id}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('still sizes the fight by the band', () => {
    const wrong: string[] = [];
    for (const band of THREAT_BANDS) {
      const size = generateEncounterEnemies('random_danger', band).length;
      if (size !== threatEncounterSize(band)) wrong.push(`${band}: ${size}`);
    }
    expect(wrong).toEqual([]);
  });

  // Curated fights are curated — their composition is the point
  it('leaves bosses and quests alone whatever the ground', () => {
    for (const band of THREAT_BANDS) {
      expect(generateEncounterEnemies('boss_0', band)).toHaveLength(1);
      expect(generateEncounterEnemies('quest_0', band)).toHaveLength(3);
    }
  });
});

describe('the generated map', () => {
  const tiles = generateMap(4242);
  const city = tiles.find((t) => t.poi === POIType.City)!.coord;
  const castle = empireCastleCoord(BALANCE.MAP_WIDTH, BALANCE.MAP_HEIGHT);

  it('bands every tile', () => {
    const unbanded = tiles.filter((t) => t.threat === undefined);
    expect(unbanded).toEqual([]);
  });

  it('puts the castle corner on the map', () => {
    const onMap = tiles.some((t) => t.coord.q === castle.q && t.coord.r === castle.r);
    expect(onMap).toBe(true);
  });

  // The gradient is the reason to travel; a castle beside the city would leave
  // nowhere to travel to
  it('puts the castle a long way from home', () => {
    expect(hexDistance(city, castle)).toBeGreaterThan(20);
  });

  it('leaves the city and its surroundings safe', () => {
    const cityTile = tiles.find((t) => t.poi === POIType.City)!;
    expect(cityTile.threat).toBe(0);
  });

  it('uses the whole scale', () => {
    const present = new Set(tiles.map((t) => t.threat));
    for (const band of THREAT_BANDS) expect(present.has(band)).toBe(true);
  });

  // No band should be so rare it never appears, or so common the rest are noise
  it('spreads tiles across the bands', () => {
    const lopsided: string[] = [];
    for (const band of THREAT_BANDS) {
      const share = tiles.filter((t) => t.threat === band).length / tiles.length;
      if (share < 0.05 || share > 0.5) lopsided.push(`${band}: ${(share * 100).toFixed(0)}%`);
    }
    expect(lopsided).toEqual([]);
  });

  /**
   * The home ring is thin, not empty — and the distinction is the whole game
   * for a new party.
   *
   * Random encounters fire **only** on danger tiles. Excluding band 0 did not
   * give a level-1 party a gentle start; it gave them nowhere to fight at all,
   * and the nearest battle in the world was a band out. This test used to assert
   * the opposite, which is how the hole survived.
   */
  it('gives the home ring somewhere to fight', () => {
    const shortOfFights: string[] = [];
    for (const seed of [1, 4242, 90210, 777, 31337]) {
      const map = generateMap(seed);
      const city = map.find((t) => t.poi === POIType.City)!;
      const near = map.filter(
        (t) => (t.zone === 'haunted') && hexDistance(t.coord, city.coord) <= BALANCE.HOME_HAUNTED_RADIUS,
      );
      if (near.length < BALANCE.HOME_HAUNTED_MIN) {
        shortOfFights.push(`${seed}: ${near.length}`);
      }
    }
    expect(shortOfFights).toEqual([]);
  });

  // Stepping out of the gate should never be an ambush, and the walk out is
  // where a new player reads the threat labels for the first time
  it('leaves the city apron clear', () => {
    const tooClose: string[] = [];
    for (const seed of [1, 4242, 90210, 777, 31337]) {
      const map = generateMap(seed);
      const city = map.find((t) => t.poi === POIType.City)!;
      for (const t of map.filter((x) => x.zone === 'haunted')) {
        const d = hexDistance(t.coord, city.coord);
        if (d < BALANCE.HOME_HAUNTED_INNER) tooClose.push(`${seed}: ${d}`);
      }
    }
    expect(tooClose).toEqual([]);
  });

  it('keeps the home ring quieter than the ground beyond it', () => {
    /**
     * An absolute ceiling (this was `< 0.08`) stopped meaning anything when
     * haunted became a *region* rather than a roll. Density is no longer a
     * per-band probability at all — it is "how far is this from a road" — and
     * the city is the network's hub, so band 0 comes out quiet by construction
     * rather than by a number chosen for it.
     *
     * What still has to hold is the relationship: home is safer than away. That
     * is the gradient the whole map is built on, and it is what a denser road
     * network near the city buys.
     */
    const shareIn = (pred: (b: number) => boolean) => {
      const band = tiles.filter((t) => pred(t.threat ?? 0));
      return band.filter((t) => t.zone === 'haunted').length / Math.max(1, band.length);
    };
    expect(shareIn((b) => b === 0)).toBeLessThan(shareIn((b) => b >= 2));
  });

  /**
   * Bad ground should look busy as well as hit harder — and the home ring must
   * not read busier than the ring beyond it, which is what raising the band-0
   * chance far enough to guarantee fights would have done. The floor near the
   * city carries that job instead, so the gradient stays monotonic.
   */
  it('leaves the home bands markedly safer than the far ones', () => {
    /**
     * Strict monotonicity band-to-band was the right rule when haunted ground
     * was a per-band *probability* — the generator literally multiplied by the
     * band, so `share(b+1) > share(b)` was arithmetic. Zones are geometric, and
     * the roads that carve them run wherever the artery and its branches
     * happened to go: bands 2, 3 and 4 all sit far from the network and come out
     * within a few points of each other, in whatever order the dice chose.
     *
     * Demanding an order the generator does not produce would be a test pinning
     * noise. What it *does* produce, on every seed, is a step down near home —
     * the city is the hub, so the ground around it is threaded with roads — and
     * that is the part the player feels and the part worth holding.
     */
    const gaps: string[] = [];
    for (const seed of [1, 4242, 90210, 777, 31337]) {
      const map = generateMap(seed);
      const share = (pred: (b: number) => boolean) => {
        const inBand = map.filter((t) => pred(t.threat ?? 0));
        return inBand.filter((t) => t.zone === 'haunted').length / Math.max(1, inBand.length);
      };
      const home = share((b) => b === 0);
      const far = share((b) => b >= 2);
      /**
       * Band 0 alone, not bands 0-1. Band 1 is the shoulder where the network
       * thins out and it varies a lot between seeds — folding it into "home"
       * averaged the step away and left a 9-point gap on seed 1 that the same
       * map shows as 25 points when the question is asked properly.
       *
       * Band 0 is also the honest question: it is the ground a new party learns
       * the game on, and the one place the difference has to be unmistakable.
       * Measured gaps run 0.25 to 0.70 across these seeds.
       */
      if (far - home < 0.15) gaps.push(`${seed}: home ${home.toFixed(2)} far ${far.toFixed(2)}`);
    }
    expect(gaps).toEqual([]);
  });

  it('puts every destination in haunted ground, and none on a road', () => {
    // The inverse of what this used to assert, and deliberately so. POIs were
    // once excluded from danger tiles; now a lair door, an ore vein, a well and
    // a quest site are placed in haunted ground *on purpose* — the reward for
    // leaving the road is the only reason to leave it. What must never happen is
    // a destination sitting on the safe route, which would be free money for
    // staying on it.
    const DESTINATIONS = [
      POIType.BossTile, POIType.MagicWell, POIType.QuestSite,
    ];
    const misplaced = tiles
      .filter((t) => t.poi && DESTINATIONS.includes(t.poi))
      .filter((t) => t.zone !== 'haunted')
      .map((t) => `${t.poi} at ${t.coord.q},${t.coord.r} in ${t.zone}`);
    expect(misplaced).toEqual([]);
  });

  it('stays deterministic for a seed', () => {
    const again = generateMap(4242);
    expect(again.map((t) => t.threat)).toEqual(tiles.map((t) => t.threat));
  });
});
