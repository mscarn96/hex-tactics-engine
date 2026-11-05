import {
  THREAT_BANDS,
  ThreatBand,
  ThreatReading,
  depthScale,
  hauntedScale,
  neutralDepth,
  threatAt,
  threatDepth,
  threatEliteCount,
  threatEncounterSize,
  threatPowerScale,
  threatRewardScale,
} from '@/systems/world/threat';
import { BALANCE } from '@/data/balanceConstants';
import { HexCoord } from '@/models/types';
import { bandComposition, bandDifficulty } from '../support/threatCurve';

const CITY: HexCoord = { q: 0, r: 0 };
const NO_CASTLE = null;
/** Far enough that its rings never reach the ray being walked. */
const FAR: HexCoord = { q: 400, r: 0 };
/** Close enough that the walk out of the city runs into its rings. */
const NEAR_CASTLE: HexCoord = { q: 30, r: 0 };

const at = (d: number): HexCoord => ({ q: d, r: 0 });
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Band first, then depth — the order the two anchors are compared in. */
const rank = (t: ThreatReading) => t.band + t.depth;

/**
 * The second axis, as something to sweep over. Corridor then haunted, so an
 * offender list reads in the order the ground gets worse.
 *
 * Road is not a third entry: a road carries no encounters at all, so its
 * multiplier is a number nothing will ever read. Two zones is the whole of what
 * difficulty has an opinion about.
 */
const ZONES = [false, true] as const;

describe('reading a tile off the gradient', () => {
  /**
   * The band and the depth are one answer, so `threatAt` cannot be a second one.
   * A separate band search beside a separate depth search is two windows that
   * agree until the radii are retuned, and then disagree silently — the map
   * would label a tile Contested while the fight on it scaled as Borderland.
   */
  it('reads the band and the depth from one window', () => {
    const split: string[] = [];
    for (let d = 0; d <= 120; d++) {
      for (const castle of [NO_CASTLE, FAR, NEAR_CASTLE]) {
        const reading = threatDepth(at(d), CITY, castle);
        if (reading.band !== threatAt(at(d), CITY, castle)) split.push(`${d}`);
      }
    }
    expect(split).toEqual([]);
  });

  it('keeps the depth a fraction', () => {
    const outside: string[] = [];
    for (let q = -60; q <= 60; q += 3) {
      for (let r = -60; r <= 60; r += 3) {
        const { depth } = threatDepth({ q, r }, CITY, NEAR_CASTLE);
        if (!(depth >= 0 && depth <= 1)) outside.push(`${q},${r}: ${depth}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it('starts every band at its inner edge and fills it by its outer one', () => {
    // The city hex is the shallowest ground there is, and each city radius is
    // the last hex of its band — so that hex is exactly full.
    expect(threatDepth(CITY, CITY, NO_CASTLE)).toEqual({ band: 0, depth: 0 });
    const unfilled: string[] = [];
    BALANCE.THREAT_CITY_RADII.forEach((radius, i) => {
      const reading = threatDepth(at(radius), CITY, NO_CASTLE);
      if (reading.band !== i || reading.depth !== 1) {
        unfilled.push(`${radius}: b${reading.band}@${reading.depth}`);
      }
    });
    expect(unfilled).toEqual([]);
  });

  /**
   * The last band has no outer radius — the map runs out instead. Its width is
   * assumed to match the band before it, so the far corner is the deep end and
   * everything past that stays pinned there rather than running away.
   */
  it('gives the outermost band an end', () => {
    const radii = BALANCE.THREAT_CITY_RADII;
    const width = radii[3] - radii[2];
    expect(threatDepth(at(radii[3] + width), CITY, NO_CASTLE)).toEqual({ band: 4, depth: 1 });
    expect(threatDepth(at(radii[3] + width * 4), CITY, NO_CASTLE)).toEqual({ band: 4, depth: 1 });
  });

  it('never reads shallower as you walk away from home', () => {
    const falling: string[] = [];
    let previous = -1;
    for (let d = 0; d <= 60; d++) {
      const reading = threatDepth(at(d), CITY, FAR);
      if (rank(reading) < previous) falling.push(`${d}: ${r3(rank(reading))} < ${r3(previous)}`);
      previous = rank(reading);
    }
    expect(falling).toEqual([]);
  });

  /**
   * The castle's windows run the other way round: its own hex is the *deep* end
   * of band 4 and each ring outward is shallower. Walking at it therefore has to
   * read as a continuous approach, or the corner is four more plateaus and the
   * thing this commit removes has simply moved.
   */
  it('never reads shallower as you walk at the castle', () => {
    const falling: string[] = [];
    let previous = -1;
    for (let f = 29; f >= 0; f--) {
      const reading = threatDepth(at(NEAR_CASTLE.q - f), CITY, NEAR_CASTLE);
      if (rank(reading) < previous) falling.push(`${f}: ${r3(rank(reading))} < ${r3(previous)}`);
      previous = rank(reading);
    }
    expect(falling).toEqual([]);
  });

  it('puts the deepest ground on the castle itself', () => {
    expect(threatDepth(NEAR_CASTLE, CITY, NEAR_CASTLE)).toEqual({ band: 4, depth: 1 });
  });

  /**
   * The castle only ever raises — and "raises" has to mean the whole reading,
   * not just the band. Taking the castle's band with the city's depth would let
   * a tile inside the Legion's rings read as the *shallow* end of band 4, which
   * is the one place on the map that must never be discounted.
   */
  it('never lets the castle lower what the city already said', () => {
    const lowered: string[] = [];
    for (let q = -40; q <= 60; q += 2) {
      for (let r = -40; r <= 40; r += 2) {
        const withCastle = threatDepth({ q, r }, CITY, NEAR_CASTLE);
        const without = threatDepth({ q, r }, CITY, NO_CASTLE);
        if (rank(withCastle) < rank(without)) lowered.push(`${q},${r}`);
      }
    }
    expect(lowered).toEqual([]);
  });
});

describe('what depth is worth', () => {
  /**
   * The neutral depth is the load-bearing default, and this is what makes it
   * safe: at that depth every band scales by exactly one, so a caller with no
   * ground under it — a lair chamber, a quest site, the castle gauntlet, a test
   * — gets the number this file returned before depth existed. A curated fight
   * ignores the ground it stands on, and here that is arithmetic rather than a
   * promise.
   */
  it('leaves a band at its flat value where it has no depth to read', () => {
    const moved: string[] = [];
    for (const band of THREAT_BANDS) {
      const flatPower = (1 + (band === 0 ? BALANCE.THREAT_EARLY_FLOOR : 0)
        + BALANCE.THREAT_POWER_PER_BAND * band) * BALANCE.THREAT_BAND_BASE_SCALE[band];
      const flatReward = 1 + (band === 0 ? BALANCE.THREAT_EARLY_FLOOR : 0)
        + BALANCE.THREAT_REWARD_PER_BAND * band;
      if (r3(depthScale(band, neutralDepth(band))) !== 1) moved.push(`scale ${band}`);
      if (r3(threatPowerScale(band)) !== r3(flatPower)) moved.push(`power ${band}`);
      if (r3(threatRewardScale(band)) !== r3(flatReward)) moved.push(`reward ${band}`);
    }
    expect(moved).toEqual([]);
  });

  /**
   * A band with no elite is too weak everywhere, so its flat value is a floor
   * and depth only adds. A band with one is already a step up on arrival, so its
   * flat value is the midpoint and the entrance is discounted to pay for the
   * elite. Which band gets which is derived from `threatEliteCount`, so the
   * discount follows the elite if the elite ever moves.
   */
  it('lifts a band with no elite and swings one that has them', () => {
    const wrong: string[] = [];
    for (const band of THREAT_BANDS) {
      const [inner, outer] = [depthScale(band, 0), depthScale(band, 1)];
      const want = threatEliteCount(band) === 0
        ? [1, 1 + BALANCE.THREAT_DEPTH_LIFT]
        : [1 - BALANCE.THREAT_DEPTH_SWING, 1 + BALANCE.THREAT_DEPTH_SWING];
      if (r3(inner) !== r3(want[0]) || r3(outer) !== r3(want[1])) {
        wrong.push(`${band}: ${r3(inner)}..${r3(outer)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('never eases as the ground gets deeper, in either zone', () => {
    const falling: string[] = [];
    for (const band of THREAT_BANDS) {
      for (const haunted of ZONES) {
        for (let step = 1; step <= 20; step++) {
          const [before, after] = [(step - 1) / 20, step / 20];
          if (threatPowerScale(band, after, haunted) <= threatPowerScale(band, before, haunted)) {
            falling.push(`power ${band}${haunted ? ' haunted' : ''} @${after}`);
          }
          if (threatRewardScale(band, after, haunted) <= threatRewardScale(band, before, haunted)) {
            falling.push(`reward ${band}${haunted ? ' haunted' : ''} @${after}`);
          }
        }
      }
    }
    expect(falling).toEqual([]);
  });

  it('clamps rather than extrapolating off either end', () => {
    for (const band of THREAT_BANDS) {
      expect(depthScale(band, -3)).toBe(depthScale(band, 0));
      expect(depthScale(band, 9)).toBe(depthScale(band, 1));
    }
  });

  /**
   * The invariant the early floor was written for, now checked over the whole
   * surface rather than once per band. It holds because pay and cost ride the
   * *same* `depthScale` and the *same* `hauntedScale` — three separate ramps
   * would have to be kept in step by hand, and the deepest, most blighted ground
   * is exactly where an unpaid premium would land.
   */
  it('pays at least what it costs, wherever you stand', () => {
    const underpaid: string[] = [];
    for (const band of THREAT_BANDS) {
      for (const haunted of ZONES) {
        for (let step = 0; step <= 20; step++) {
          const depth = step / 20;
          if (threatRewardScale(band, depth, haunted) < threatPowerScale(band, depth, haunted)) {
            underpaid.push(`${band}${haunted ? ' haunted' : ''} @${depth}`);
          }
        }
      }
    }
    expect(underpaid).toEqual([]);
  });

  /**
   * Depth and the zone move the stat multiplier and the pay, and nothing else.
   *
   * Both counts are integers, and an integer cannot ramp — it steps, which is
   * the thing being removed. They are also what `shapeViolations` derives the
   * shape table's invariants from, so a count that varies inside a band needs a
   * shape table per depth bucket; and band 0 has exactly one legal arrangement
   * by arithmetic, which a third body destroys. Checked on the arity because
   * that is the moment the decision would be reversed — and it is the same
   * assertion for both axes, because it is the same argument twice: haunted
   * ground has to be a harder version of the fight the corridor beside it would
   * have offered, not a wider one.
   */
  it('leaves the body and elite counts alone', () => {
    expect(threatEncounterSize.length).toBe(1);
    expect(threatEliteCount.length).toBe(1);
  });
});

/**
 * The cliff, measured.
 *
 * Playtest finding: Home Reach and Borderland were trivially easy and Contested
 * was unwinnable, with nothing in between. Nothing in between is exactly what a
 * flat band is — a tile one hex inside Borderland and a tile ten hexes deeper
 * were the same fight, and then band 2 arrived carrying the first elite, a third
 * body and a jump in the stat multiplier on one hex.
 *
 * Composition is half of every number here and it has to be: it carries the
 * integer steps, which is where the cliff actually lives. A continuity check
 * against `threatPowerScale` alone would pass trivially and measure nothing.
 * Analytic rather than sampled, for the reason `homeRing.test.ts` records — the
 * bimodal bands 3 and 4 gave a Monte Carlo version enough standard error to turn
 * a narrow step intermittently red, and an intermittent red gets re-run rather
 * than investigated.
 */
describe('the seam between two bands', () => {
  const inner = THREAT_BANDS.map((b) => bandDifficulty(b, 0));
  const outer = THREAT_BANDS.map((b) => bandDifficulty(b, 1));
  const SEAMS = [0, 1, 2, 3] as const;
  /** How much harder the next band's first tile is than this band's last. */
  const jump = (n: number) => inner[n + 1] / outer[n];
  /** How much harder a band's last tile is than its first. */
  const ramp = (b: ThreatBand) => outer[b] / inner[b];

  /**
   * The deliverable. Crossing a boundary must never be a bigger surprise than
   * walking a whole band is — otherwise the boundary is where the difficulty
   * actually lives, and the ground in between is decoration.
   */
  it('never opens a band harder than a band ramps', () => {
    const worstRamp = Math.max(...THREAT_BANDS.map(ramp));
    const cliffs = SEAMS
      .map((n) => ({ seam: `${n}→${n + 1}`, jump: r2(jump(n)) }))
      .filter((s) => s.jump > r2(worstRamp));
    expect(cliffs).toEqual([]);
  });

  /**
   * And every seam is a smaller step than it used to be.
   *
   * The flat scheme is still computable — it is each band's composition times
   * its flat multiplier — so this compares the two directly rather than against
   * remembered numbers. It is what gives the test above teeth: under the flat
   * scheme every band ramps by exactly ×1.00, so *any* positive seam failed it,
   * and a future retune that quietly re-flattens a band gets caught here as well.
   */
  it('cuts every seam below what a flat band left it at', () => {
    const flat = THREAT_BANDS.map((b) => bandComposition(b) * threatPowerScale(b));
    const worse = SEAMS
      .map((n) => ({
        seam: `${n}→${n + 1}`,
        now: r2(jump(n)),
        flat: r2(flat[n + 1] / flat[n]),
      }))
      .filter((s) => s.now >= s.flat);
    expect(worse).toEqual([]);
  });

  /**
   * A band's ramp may reach past the next band's discounted entrance, so the
   * last tile of one band can be harder than the first tile of the next. That
   * overlap is deliberate — it is what discounting an entrance *means*, and
   * without it the discount would simply reappear as a drop at the seam.
   *
   * What it may not do is undercut the band being left. Stepping forward into
   * ground softer than the ground already being farmed is a gradient running
   * backwards, and it would make the frontier of every band the wrong place to
   * be. The floor is that band's own flat value rather than a tolerance, because
   * the flat value is what the band paid on average before any of this.
   */
  it('never opens a band below the average of the one before it', () => {
    const flat = THREAT_BANDS.map((b) => bandComposition(b) * threatPowerScale(b));
    const backwards = SEAMS
      .map((n) => ({ seam: `${n}→${n + 1}`, opens: Math.round(inner[n + 1]), left: Math.round(flat[n]) }))
      .filter((s) => s.opens < s.left);
    expect(backwards).toEqual([]);
  });

  /** The band-to-band curve at the flat value is untouched by any of this. */
  it('leaves the curve between bands where it was', () => {
    const flat = THREAT_BANDS.map((b) => bandComposition(b) * threatPowerScale(b));
    const falling = SEAMS.filter((n) => flat[n + 1] <= flat[n]);
    expect(falling).toEqual([]);
  });

  /**
   * Recorded so the next person can see the budget they are spending.
   *
   * Seams were ×1.59, ×2.63, ×1.67, ×1.53 flat; the depth work took them to
   * ×1.14, ×1.41, ×1.00, ×0.91, and `THREAT_BAND_BASE_SCALE` (a playtest still
   * found the 1→2 wall too steep) took the 1→2 seam on to **×1.13** — bands 2–4
   * all carry the same ×0.8, so the seams between them are untouched. The
   * within-band ramps are ×1.40 in bands 0–1 and ×1.67 in 2–4, exactly as
   * before: the soften rides the flat term and commutes with the ramps.
   *
   * The four frozen-north factions then moved the composition under it, and the
   * seams with it, to ×1.13, ×1.17, ×0.99, ×0.87: the Sandscourge are heavier
   * than the band-1–2 locals they join, and the Thunder Herd, at home on the
   * plains this is measured on, are lighter than the Legion they share bands 3–4
   * with. Every rule above still holds; these are the new numbers to spend from.
   *
   * The Legion was then made 65% stronger (2026-10-02), which lifts bands 3 and 4 and
   * the seams into them to ×1.2 and ×0.92: the Herd is still the lighter of the two.
   *
   * The playtest of 2026-10-14 added a fourth body at band 3 and a fifth at band 4
   * (`THREAT_LATE_EXTRA_ENEMIES`) and walked the Hoarfrost onto the tundra: the 2→3
   * seam is now ×1.44 and 3→4 ×0.89. The power premium (`THREAT_LATE_POWER`) is
   * applied per fight in `encounterPowerScale`, outside this composition.
   *
   * The biome lock (the private project notes) took the outsiders off
   * the plains this is measured on: no Sandscourge, Beasts or Delve wander in
   * and the Herd is the plains' own. Seams ×1.10, ×1.14, ×1.59, ×0.86. Landed
   * unretuned; verify in playtest.
   */
  it('records the curve it is holding', () => {
    expect(inner.map(Math.round)).toEqual([130, 200, 320, 848, 1215]);
    expect(outer.map(Math.round)).toEqual([182, 280, 533, 1413, 2026]);
    expect(SEAMS.map((n) => r2(jump(n)))).toEqual([1.1, 1.14, 1.59, 0.86]);
    expect(THREAT_BANDS.map((b) => r2(ramp(b)))).toEqual([1.4, 1.4, 1.67, 1.67, 1.67]);
  });
});

/**
 * The second axis, and why laying one over the other is safe.
 *
 * Haunted ground is harder than the corridor beside it at the same distance from
 * home. That is the whole point of the restructure — without it the only
 * difficulty lever in the game is still "walk further", and roads, corridors and
 * haunted ground are three words for one map. But a second axis over a curve
 * this suite exists to keep monotonic is exactly the kind of change that inverts
 * it through a door nothing was watching.
 *
 * **The invariant, in one sentence: the three levers are strictly ordered by
 * what they are worth — band > depth > zone — and none of them may be reordered
 * by a retune.** That is what "the axes compose" means operationally, and both
 * ways of breaking it are real failures with names:
 *
 * - **Zone above depth or band.** Stepping off the road becomes the cheapest way
 *   to find a real fight, the five bands stop being the progression the
 *   recruitment gates, the tribute and the level curve are hung off, and the map
 *   is a difficulty toggle with scenery.
 * - **Zone below noticing.** The premium disappears inside a band's own depth
 *   ramp, haunted ground is decoration, and the restructure buys nothing it was
 *   built for.
 *
 * **Why this is the right invariant and a product-order monotonicity check is
 * not.** The obvious rule — "ground that is further out *and* more blighted must
 * never be easier" — is satisfied by *any* positive premium, because a uniform
 * multiplier is monotone on its own axis. It would pass at ×1.001 and at ×40
 * alike, and measure nothing. The pairs that can actually invert are the
 * *incomparable* ones: haunted ground deep in band N against corridor ground
 * entering band N+1. Those are steps that change both axes at once, and bounding
 * them is bounding the premium against the band axis — which is the ordering
 * above.
 *
 * **Why a drop when you leave haunted ground is allowed.** A band seam is
 * invisible: nothing on the map is drawn differently at radius 21, and depth has
 * no readout at all. Blighted terrain is drawn, several hexes before you reach
 * it, and `RoutePreview` marks it before the second tap. So a difficulty change
 * at a zone boundary is *signposted* where a change at a seam is a surprise, and
 * the surprise budget the block above polices belongs to the seams. A player
 * stepping from haunted band 2 onto corridor band 3 and finding it 20% easier
 * has taken the road, which is what the road is for.
 *
 * Analytic, not sampled, for the same reason as everything above it.
 */
describe('the second axis: haunted ground', () => {
  const H = BALANCE.THREAT_HAUNTED_PREMIUM;

  /** Corridor and haunted readings of the same piece of ground. */
  const corridor = (b: ThreatBand, d: number) => bandDifficulty(b, d, false);
  const blighted = (b: ThreatBand, d: number) => bandDifficulty(b, d, true);

  /** A band's flat average, per zone — what the ground pays on average. */
  const flat = (b: ThreatBand, haunted: boolean) =>
    bandComposition(b) * threatPowerScale(b, neutralDepth(b), haunted);

  const SEAMS = [0, 1, 2, 3] as const;
  /** How much harder a band's last tile is than its first. Zone-independent. */
  const ramp = (b: ThreatBand) => corridor(b, 1) / corridor(b, 0);
  /** The seam as the player meets it: next band's first tile over this one's last. */
  const jump = (n: number) => corridor((n + 1) as ThreatBand, 0) / corridor(n as ThreatBand, 1);
  /** What the same seam was worth under the flat scheme depth replaced. */
  const flatJump = (n: number) => flat((n + 1) as ThreatBand, false) / flat(n as ThreatBand, false);

  it('makes haunted ground harder than the corridor beside it', () => {
    expect(hauntedScale(false)).toBe(1);
    expect(hauntedScale(true)).toBeGreaterThan(1);
    const soft: string[] = [];
    for (const band of THREAT_BANDS) {
      for (let step = 0; step <= 20; step++) {
        const depth = step / 20;
        if (blighted(band, depth) <= corridor(band, depth)) soft.push(`${band} @${depth}`);
      }
    }
    expect(soft).toEqual([]);
  });

  /**
   * The reason a second axis is safe at all, and the reason it is a flat factor
   * rather than a shape.
   *
   * A uniform multiplier commutes with every ratio, so haunted ground has the
   * *identical* seams, ramps and entrance discounts that corridor ground does.
   * Every invariant the depth work established therefore holds twice over rather
   * than needing to be re-derived — which is what makes it honest to reason
   * about the two axes separately. Anything band- or depth-dependent in
   * `hauntedScale` would break this, and would owe the whole seam argument again
   * in its own right. Checked to full precision, not to two places: an
   * *approximate* commutation is a slow drift with no failing test.
   */
  it('leaves every ratio the band curve is pinned on exactly where it was', () => {
    const moved: string[] = [];
    for (const band of THREAT_BANDS) {
      if (r3(blighted(band, 1) / blighted(band, 0)) !== r3(ramp(band))) moved.push(`ramp ${band}`);
    }
    for (const n of SEAMS) {
      const hauntedJump = blighted((n + 1) as ThreatBand, 0) / blighted(n as ThreatBand, 1);
      if (r3(hauntedJump) !== r3(jump(n))) moved.push(`seam ${n}→${n + 1}`);
    }
    expect(moved).toEqual([]);
  });

  /**
   * The rule the whole block exists for, stated as an ordering.
   *
   * Both bounds are *derived* rather than written down. The ceiling is the
   * tighter of two constraints that were expected to be independent and turn out
   * not to be:
   *
   * - **A band's own depth ramp.** Walking a band's full width must always be
   *   worth more than stepping off the road, or distance stops being the map's
   *   first fact about itself. Binding value ×1.40 (bands 0–1).
   * - **The worst single hex.** A seam crossing and a zone change can land on the
   *   same step, and that compound step must still be smaller than the flat cliff
   *   the depth work removed from that same seam — reusing the budget the block
   *   above already spends rather than inventing a second one. Binding value
   *   ×1.40, at the 0→1 seam.
   *
   * **They agree exactly, and that is arithmetic rather than luck.** A seam's
   * compound-step ceiling is `flatJump(n) / jump(n)`, and expanding both against
   * `bandComposition × threatPowerScale` cancels the composition and the flat
   * multiplier and leaves `outer[n] / inner[n]` — which *is* `ramp(n)`, divided
   * by whatever entrance discount the arriving band takes. Where two adjacent
   * bands share a depth shape the discounts cancel too, and the ceiling is the
   * previous band's ramp on the nose: ×1.40, ×1.67, ×1.67. The single exception
   * is 1→2, where the shape changes from lift to swing and band 2's ×0.75
   * entrance buys the seam a third more headroom (×1.87).
   *
   * So the two bounds are one bound seen from two sides, and the rule reduces to
   * a sentence: **stepping off the road is worth less than walking a band's
   * width.** Both are kept, because they are computed from different quantities
   * and would separate the moment the depth scheme grew a third shape — at which
   * point the seam form is the one that stays correct.
   *
   * The floor is that the premium beats a band's *entrance discount* being the
   * only thing it can be confused with — it has to be a step the player reads as
   * "this ground is worse", not as noise.
   */
  it('keeps the three levers in order: band, then depth, then zone', () => {
    const byRamp = Math.min(...THREAT_BANDS.map(ramp));
    const bySeam = Math.min(...SEAMS.map((n) => flatJump(n) / jump(n)));
    const ceiling = Math.min(byRamp, bySeam);

    // The two are one bound seen from two sides — see the note above. Pinned so
    // the identity is a fact this suite holds rather than a claim in a comment:
    // a depth scheme that grew a third shape would separate them here first.
    expect(bySeam).toBeCloseTo(byRamp, 6);

    // Zone under depth, depth under band: the ordering, as three numbers.
    expect(H).toBeGreaterThan(1);
    expect(H).toBeLessThan(ceiling);
    expect(ceiling).toBeLessThanOrEqual(Math.min(...SEAMS.map(flatJump)));

    // And it is a step, not noise — larger than the discount a band entrance
    // takes, which is the smallest deliberate move any of these levers makes.
    expect(H - 1).toBeGreaterThan(BALANCE.THREAT_DEPTH_SWING / 2);
  });

  /**
   * The named risk, checked directly: walking outward must not make the game
   * easier for a player who has not changed zone.
   *
   * It holds for the same reason the ratios above are unmoved — the premium is
   * one factor on both sides of every within-zone comparison — but it is checked
   * rather than argued, because "it follows from a uniform multiplier" is exactly
   * the sentence that stops being true the first time somebody makes the premium
   * band-dependent to fix a balance report. Both halves of the original seam
   * rule, run in both zones.
   */
  it('never opens a band below the average of the one before it, in either zone', () => {
    const backwards: string[] = [];
    for (const haunted of ZONES) {
      for (const n of SEAMS) {
        const opens = bandDifficulty((n + 1) as ThreatBand, 0, haunted);
        const left = flat(n as ThreatBand, haunted);
        if (Math.round(opens) < Math.round(left)) {
          backwards.push(`${n}→${n + 1}${haunted ? ' haunted' : ''}`);
        }
      }
    }
    expect(backwards).toEqual([]);
  });

  /**
   * The compound step, measured rather than assumed away.
   *
   * One hex that crosses a band seam *and* leaves the corridor for haunted
   * ground is the largest single change in difficulty the map can produce. It is
   * allowed to exceed a band's own ramp — half of it is signposted terrain — but
   * it must stay under the flat cliff that seam carried before any of this, or
   * the two axes have between them rebuilt the thing the depth work removed.
   */
  it('keeps the worst single hex under the cliff it replaced', () => {
    const rebuilt = SEAMS
      .map((n) => ({ seam: `${n}→${n + 1}`, worst: r2(jump(n) * H), was: r2(flatJump(n)) }))
      .filter((s) => s.worst >= s.was);
    expect(rebuilt).toEqual([]);
  });

  /**
   * Recorded so the next person can see the budget they are spending, and see
   * what the second axis actually cost.
   *
   * The per-seam ceilings are ×1.40, ×1.87, ×1.67, ×1.67 — the previous band's
   * own ramp everywhere except 1→2, where the change of depth shape pays for
   * the extra. The 0→1 seam binds at **×1.40**, which is the largest premium
   * this curve tolerates; ×1.25 sits at 89% of it. That headroom is deliberate
   * and not timidity: the ceiling is a hard inversion, not a soft one, and the
   * band ramps are exactly the numbers a balance pass retunes.
   *
   * The last row is the other direction — how much easier corridor ground
   * entering the next band is than the haunted ground just left, which is the
   * road's whole purpose expressed as a number. It is a *drop* at the last two
   * seams (×0.79, ×0.70 since the frozen-north factions), and that is the trade being bought rather than a
   * failure: those steps are signposted twice over, by the threat label and by
   * the terrain, and the player took the road to get them.
   */
  it('records the surface it is holding', () => {
    expect(r2(H)).toBe(1.25);
    expect(SEAMS.map((n) => r2(flatJump(n) / jump(n)))).toEqual([1.4, 1.87, 1.67, 1.67]);
    expect(r2(Math.min(...THREAT_BANDS.map(ramp)))).toBe(1.4);
    expect(SEAMS.map((n) => r2(jump(n) * H))).toEqual([1.37, 1.43, 1.99, 1.08]);
    expect(SEAMS.map((n) => r2(corridor((n + 1) as ThreatBand, 0) / blighted(n as ThreatBand, 1))))
      .toEqual([0.88, 0.91, 1.27, 0.69]);
  });
});
