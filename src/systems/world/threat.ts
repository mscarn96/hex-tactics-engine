import { HexCoord } from '@/models/types';
import { hexDistance } from '@/utils/hexUtils';
import { BALANCE } from '@/data/balanceConstants';
import { EMPIRE_WORLD, threatBandName, type ThreatRadii, type WorldDef } from '@/data/worlds';

/**
 * How dangerous a piece of the world is.
 *
 * Two anchors pull in opposite directions: home (the city) makes ground safe,
 * the far pole (the Obsidian castle) makes it deadly. Each world owns its
 * radii (`WorldDef.threat`). **In the Empire the castle's radii never bind** —
 * every `home[i] + far[3 - i]` falls short of the 47 hexes between the two —
 * so its gradient is a bullseye around the city and the far corner is band 4
 * by distance alone. Later worlds use binding radii, which tilts the bands
 * toward their far pole (the private project notes).
 *
 * That gradient is the reason to travel. Loot and XP both scale with it, so
 * pushing out is how you grow, and a player who farms the safe ring forever will
 * not make rent.
 *
 * **A band is a window, not a step.** A tile one hex inside Borderland and a tile
 * ten hexes deeper used to be the same fight — every number here was a function
 * of the band index alone, so all five bands were flat plateaus joined by four
 * cliffs. The worst of those was 1→2, where the first elite, the third body and
 * a jump in the stat multiplier all landed on the same hex. `threatDepth`
 * reports *where inside its band* a tile sits, and the scaling rides that as
 * well as the index, so the gradient is a slope with the same total rise.
 *
 * **And the gradient is two-dimensional.** Distance is one axis; the ground
 * itself is the other. Haunted ground is harder than the corridor beside it *at
 * the same distance from home*, so "where do I go" stops being a single question
 * with a single answer. Without it the only difficulty lever in the game is
 * still "walk further", and roads, corridors and haunted ground are three words
 * for one map.
 *
 * The three levers are deliberately ordered by what they are worth — **band
 * (×1.53–2.64) > depth (×1.40–1.67) > zone (×1.25)** — which is what makes them
 * *compose* rather than one of them swamping the rest. That ordering is the
 * invariant `threatDepth.test.ts` measures; the numbers are what get retuned.
 */

/** 0 is home ground, 4 is the Legion's doorstep. */
export type ThreatBand = 0 | 1 | 2 | 3 | 4;

export const THREAT_BANDS: ThreatBand[] = [0, 1, 2, 3, 4];

/**
 * A tile's place on the gradient: which band, and how far through it.
 *
 * One value rather than two calls, because the band and the depth are read from
 * the *same* window — `threatAt` is `threatDepth(...).band` and nothing else, so
 * there is no arrangement of the radii under which the two can disagree about
 * which band a tile is in.
 */
export interface ThreatReading {
  band: ThreatBand;
  /** 0 where the band begins, 1 at its outer edge. Always within [0, 1]. */
  depth: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Where `d` sits between `inner` and `outer`, as a fraction. */
function within(d: number, inner: number, outer: number): number {
  return outer > inner ? clamp01((d - inner) / (outer - inner)) : 0;
}

/**
 * The reading distance from the city alone gives.
 *
 * The band search is the one that has always been here — the largest radius the
 * tile is outside of. The depth is that same test kept rather than thrown away:
 * the radii the loop just compared against *are* the window's edges.
 */
function cityReading(fromCity: number, radii: readonly number[]): ThreatReading {
  for (let i = radii.length - 1; i >= 0; i--) {
    if (fromCity > radii[i]) {
      // The last band has no outer radius — the map simply runs out. Its width
      // is assumed to match the band before it rather than being a constant of
      // its own, so the far corner is the deep end of the gradient and stays
      // there however the radii are retuned.
      const outer = i + 1 < radii.length ? radii[i + 1] : radii[i] + (radii[i] - radii[i - 1]);
      return { band: (i + 1) as ThreatBand, depth: within(fromCity, radii[i], outer) };
    }
  }
  return { band: 0, depth: within(fromCity, 0, radii[0]) };
}

/**
 * The reading the castle forces, or `null` outside its reach.
 *
 * The castle's windows run the other way: its own hex is the *deep* end of band
 * 4, and each ring outward is shallower. That is the same statement the band
 * search makes — closer is worse — carried through to the fraction, so walking
 * at the castle is a continuous approach rather than four more plateaus.
 */
function castleReading(fromCastle: number, radii: readonly number[]): ThreatReading | null {
  for (let i = 0; i < radii.length; i++) {
    if (fromCastle <= radii[i]) {
      const inner = i === 0 ? 0 : radii[i - 1];
      return {
        band: (4 - i) as ThreatBand,
        depth: within(radii[i] - fromCastle, 0, radii[i] - inner),
      };
    }
  }
  return null;
}

/**
 * Band and depth for a tile.
 *
 * Distance from home sets the floor; proximity to the far pole overrides it
 * upward where that world's radii let it bind (see the header).
 *
 * "Upward" is now lexicographic — band first, then depth. Taking the worse band
 * but the city's depth would let a tile *inside* the castle's rings read as the
 * shallow end of band 4, which is the one place on the map that must not be
 * discounted.
 */
export function threatDepth(
  coord: HexCoord,
  city: HexCoord,
  castle: HexCoord | null,
  radii: ThreatRadii = EMPIRE_WORLD.threat,
): ThreatReading {
  const home = cityReading(hexDistance(coord, city), radii.home);
  if (!castle) return home;

  const forced = castleReading(hexDistance(coord, castle), radii.far);
  if (!forced) return home;
  if (forced.band !== home.band) return forced.band > home.band ? forced : home;
  return forced.depth > home.depth ? forced : home;
}

/** The band for a tile. See `threatDepth` — this is its `band`, by construction. */
export function threatAt(
  coord: HexCoord,
  city: HexCoord,
  castle: HexCoord | null,
  radii: ThreatRadii = EMPIRE_WORLD.threat,
): ThreatBand {
  return threatDepth(coord, city, castle, radii).band;
}

/** What the player is told they are standing in — each world names its own bands. */
export function threatLabel(band: ThreatBand, world: Pick<WorldDef, 'id'> = EMPIRE_WORLD): string {
  return threatBandName(world.id, band);
}

/** Colour for the band, used by the region readout. */
export function threatColor(band: ThreatBand): string {
  return BALANCE.THREAT_COLORS[band];
}

/**
 * The band-0 hardening, shared by power and pay so the two cannot drift apart.
 */
function earlyFloor(band: ThreatBand): number {
  return band === 0 ? BALANCE.THREAT_EARLY_FLOOR : 0;
}

/**
 * What depth multiplies a band's flat value by. Shared by power and pay.
 *
 * Two shapes, and which one a band gets is **derived from whether it fields an
 * elite** rather than written down as a list of band indices:
 *
 * - **No elite** (bands 0–1): the flat value is a floor and depth only adds,
 *   `×1.00` → `×1.40`. Those bands are too weak everywhere, so nothing about
 *   them wants discounting; what they want is a deep end that reaches toward the
 *   band beyond.
 * - **An elite** (bands 2–4): the flat value is the midpoint, `×0.75` → `×1.25`.
 *   The elite and the extra body arrive as an integer step that no multiplier
 *   can smooth over, so the entrance to such a band has to be discounted to pay
 *   for it — and the far edge has to charge the discount back, or the band's
 *   average slides and the whole curve with it.
 *
 * Deriving the split means the discount follows the elite if the elite ever
 * moves, which is the only reason the discount exists. A written list would be a
 * second answer to "where does the first elite arrive", and this file already
 * has one that failed the first time it was wired up.
 */
export function depthScale(band: ThreatBand, depth: number): number {
  const d = clamp01(depth);
  if (threatEliteCount(band) === 0) return 1 + BALANCE.THREAT_DEPTH_LIFT * d;
  return 1 - BALANCE.THREAT_DEPTH_SWING + 2 * BALANCE.THREAT_DEPTH_SWING * d;
}

/**
 * The depth at which a band scales by exactly one — its flat value.
 *
 * The default for every caller with no ground under it, which is what makes a
 * curated fight unchanged by this whole mechanism: a lair chamber, a quest site
 * and the castle gauntlet compose at a *named* band and have no depth, because
 * a curated fight ignores the ground it stands on or it is not curated. The
 * lair's door happening to sit two thirds of the way through Contested is
 * exactly the kind of fact `encounterContext` exists to stop leaking indoors.
 */
export function neutralDepth(band: ThreatBand): number {
  return threatEliteCount(band) === 0 ? 0 : 0.5;
}

/**
 * What the ground itself multiplies a band by. Shared by power and pay.
 *
 * The second axis, and it is a **flat factor rather than a shape** on purpose. A
 * uniform multiplier commutes with every ratio the band-and-depth curve is
 * pinned on, so haunted ground has the identical seams, the identical ramps and
 * the identical discounts that corridor ground does — the new axis lays over the
 * old one without touching it, and every invariant the depth work established
 * holds twice rather than needing to be re-derived. Anything band- or
 * depth-dependent here would break that, and would need its own copy of the
 * whole seam argument to justify.
 *
 * It is also the reason the two axes can be reasoned about separately at all:
 * the only new comparison the second axis creates is *across* zones, and a zone
 * is the one thing on this map a player can see from several hexes away. A band
 * seam is invisible and a depth is an internal with no readout at all; blighted
 * terrain is drawn. So a difficulty change at a zone boundary is signposted,
 * where a change at a band seam is a surprise — which is why the surprise budget
 * `threatDepth.test.ts` polices belongs to the seams and not to this.
 *
 * Deliberately a `boolean` rather than a zone enum: road and corridor scale
 * identically (a road carries no encounters at all, so its multiplier is a
 * number nothing will ever read), and taking the enum would put a second answer
 * to "which zones are dangerous" in the one file that must not have an opinion
 * about map generation.
 */
export function hauntedScale(haunted: boolean): number {
  return haunted ? BALANCE.THREAT_HAUNTED_PREMIUM : 1;
}

/**
 * Stat multiplier for enemies in this band, at this depth into it.
 *
 * Layered on top of the usual party-level scaling rather than replacing it: the
 * level scaling keeps an enemy relevant as you grow, and this says "and out here
 * they are worse". A band-3 goblin is a real goblin rather than free XP.
 *
 * `haunted` defaults to `false` for the same reason `depth` defaults to
 * `neutralDepth`: a caller with no ground under it — a lair chamber, a quest
 * site, the castle gauntlet — is asking about a curated fight, and a curated
 * fight ignores the ground it stands on or it is not curated. The default is
 * therefore the *safe* one in both senses: it is the number this function
 * returned before either axis existed.
 */
export function threatPowerScale(
  band: ThreatBand,
  depth: number = neutralDepth(band),
  haunted: boolean = false,
): number {
  // The home ring is a floor, not a slope. At band 0 the per-band term is zero,
  // so the first fights ran at exactly template strength — and templates are
  // tuned for a party rather than for the one hero the game starts you with, so
  // "gentle" came out as "no resistance". `THREAT_EARLY_FLOOR` is what makes the
  // opening a fight; the slope does all the work from band 1 outward.
  //
  // Band 0 *only*. Adding it at band 1 as well stacks floor and slope, which
  // caps how large the floor may ever be at whatever band 2 costs — and the
  // whole reason to have a floor is that band 0 is the one band with no slope
  // to raise. Band 1 steps up through its composition instead.
  //
  // `THREAT_BAND_BASE_SCALE` is the per-band retune knob, on the flat term so
  // it commutes with the depth and zone factors — a softened band keeps its
  // exact ramps and discounts, only lower. Power alone: the pay deliberately
  // does not follow it down, so softened ground still pays what it always did
  // and "pays at least what it costs" holds with more room, not less.
  const flat =
    (1 + earlyFloor(band) + BALANCE.THREAT_POWER_PER_BAND * band) *
    BALANCE.THREAT_BAND_BASE_SCALE[band];
  return flat * depthScale(band, depth) * hauntedScale(haunted);
}

/** How many bodies a random encounter fields out here. */
export function threatEncounterSize(band: ThreatBand): number {
  return Math.min(
    BALANCE.THREAT_MAX_ENEMIES,
    BALANCE.THREAT_BASE_ENEMIES + Math.floor(band / 2)
      + (band >= BALANCE.THREAT_LATE_FROM_BAND ? BALANCE.THREAT_LATE_EXTRA_ENEMIES : 0),
  );
}

/**
 * The late campaign's premium on a fight that is not a boss's own: 1 below
 * `THREAT_LATE_FROM_BAND`, then `THREAT_LATE_POWER` (playtest 2026-10-14).
 * `encounterPowerScale` applies it; a lair's boss fights at its ground alone.
 */
export function lateGroundPremium(band: ThreatBand): number {
  return BALANCE.THREAT_LATE_POWER[band] ?? 1;
}

/**
 * How many of those bodies are elites. The shape table answers to this.
 *
 * **The first elite waits until band 2**, not band 1. Home ground has to stay
 * somewhere a level-1 party can learn the game, and one ring out is still too
 * early — meeting a Cave Bear at 140 HP there was a cliff rather than a ramp.
 *
 * This returned 1 at band 1 for as long as it existed, and nothing noticed
 * because nothing called it: the encounter composer carried its own hand-written
 * table, which correctly fielded no elite until band 2. Two answers to one
 * question, and the unused one was the wrong one — so wiring it up as the shape
 * table's invariant would have quietly put an elite in the second ring. That is
 * the whole argument for a derived table over a written one, and it failed on
 * the first run.
 *
 * **Neither this nor `threatEncounterSize` takes a depth, and that is a
 * decision rather than an omission.** Both are integer counts, and an integer
 * cannot ramp — it steps. Moving them with depth would put a fifth cliff in the
 * middle of a band and make the threat label the map shows wrong twice instead
 * of once. They are also what `shapeViolations` derives the shape table's two
 * invariants from, so a count that varies within a band means a shape table per
 * depth bucket; and at bands 3–4 a wider fight cannot even be delivered, because
 * the Coven and the Legion field no chaff. Band 0 is the hardest constraint of
 * the lot: two chaff is its *only* legal arrangement by arithmetic, and a third
 * body takes a level-1 Arcanist from 6.7 rounds to 4.4 against a bar of 6.
 * Depth moves the stat multiplier and the pay. Nothing else.
 */
export function threatEliteCount(band: ThreatBand): number {
  if (band <= 1) return 0;
  return Math.min(threatEncounterSize(band) - 1, Math.floor((band + 1) / 2));
}

/**
 * Reward multiplier for clearing a fight out here.
 *
 * Deliberately steeper than `threatPowerScale`. Travelling costs hours, and
 * hours are what the tribute charges for — so distant ground has to pay better
 * than it costs, or the optimal play is to farm the ring around the city and the
 * whole gradient is decoration.
 */
export function threatRewardScale(
  band: ThreatBand,
  depth: number = neutralDepth(band),
  haunted: boolean = false,
): number {
  // The early floor is applied to pay as well as to power, on the same band and
  // for the same amount. It has to be: the invariant is that ground never costs
  // more than it pays, and hardening the home ring without paying for it would
  // break that at band 0 — the exact place a new player can least afford a bad
  // deal.
  //
  // Depth rides on pay through the *same* `depthScale`, for the same reason one
  // step down. The two flat terms already satisfy "pay ≥ cost" band by band, so
  // multiplying both by one identical factor keeps it at every depth — where two
  // separate ramps would have to be checked, and would eventually be retuned
  // apart.
  //
  // Haunted ground rides `hauntedScale` on pay for the third time the same
  // argument is made, and it is the one place it would have been most tempting
  // to skip: haunted ground is where all the content is, so paying a premium
  // there as well as charging one looks like paying twice. It is not — the
  // premium here is on the *rate*, and what "all the content is there" buys is
  // the number of fights, which this multiplier knows nothing about. Charging
  // for the ground without paying for it would put the worst deal in the game on
  // exactly the ground the map is built to push the player onto.
  const flat = 1 + earlyFloor(band) + BALANCE.THREAT_REWARD_PER_BAND * band;
  return flat * depthScale(band, depth) * hauntedScale(haunted);
}
