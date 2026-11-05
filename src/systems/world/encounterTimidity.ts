import { BALANCE } from '@/data/balanceConstants';
import { ThreatBand } from '@/systems/world/threat';
import { areaLevel } from '@/systems/world/contentLevel';
import type { WorldId } from '@/data/worlds';

/**
 * How much of a tile's usual encounter supply is up, given who is walking on it.
 *
 * The third factor in the daily roll, beside `ZONE_ENCOUNTER_RATE` ("how much
 * content this ground holds") and `DAILY_ENCOUNTER_CHANCE` ("how much of it is
 * up today"). This one asks a question neither of those can: **who is out
 * there.** The other two are properties of the map and of the dawn; this is a
 * property of the party.
 *
 * The failure it exists to fix is Home Reach at hour forty. A band-0 tile fields
 * two chaff at `THREAT_EARLY_FLOOR` for the whole campaign, so a party that has
 * been to Contested and back meets them at full density on the walk home — a
 * fight that cannot be lost, cannot be interesting and costs a turn order, a
 * loading transition and a minute. Encounter *density* is the only lever that
 * removes it without touching the difficulty curve: the fights that do happen
 * are exactly the fights that always happened, there are simply fewer of them.
 *
 * The fiction is the honest version of the same thing — a warband that would
 * have taken its chances against one level-3 hero does not step out in front of
 * four level-fifteens. Hence the name.
 *
 * **A rule, not a line in the store.** `rollDailyEncounters` is a `worldMapStore`
 * private and everything inside it is untestable purely because of where it
 * sits; this is a function of (band, party) and nothing else, so it lives with
 * the other functions of the ground in `systems/world/`.
 */

/**
 * The summed level a threat band expects of a party. The Empire's table, sized to who is
 * plausibly walking its ground; beyond the Empire, a full party at the area's fixed level
 * (`contentLevel.ts`), so a party that belongs on the ground sees all of it, and one coming
 * back to an old world over-levelled sees it thin out as the Empire's does. `escape.fleeChance`
 * reads the same number.
 */
export function expectedSummedLevel(band: ThreatBand, world: WorldId = 'empire'): number {
  const level = areaLevel(world, band);
  if (level !== null) return BALANCE.MAX_PARTY_SIZE * level;
  return BALANCE.BAND_EXPECTED_LEVEL[band] ?? BALANCE.BAND_EXPECTED_LEVEL[0];
}

/**
 * The factor the daily roll is multiplied by. Always within
 * `[ENCOUNTER_TIMIDITY_FLOOR, 1]`.
 *
 * At or below the level its band expects, exactly `1` — the opening hours of a
 * save are numerically untouched by this whole mechanism, which is the property
 * `encounterSupply.test.ts` exists to defend. Above it the roll tapers as the
 * reciprocal of how far past the expectation the party is: twice the expected
 * summed level is half the supply, four times is a quarter, and the floor stops
 * it there.
 *
 * A reciprocal rather than a subtraction because the bands are not evenly
 * spaced — Home Reach expects 6 and Legion Ground expects 55 — so "ten levels
 * over" means something completely different at each end, while "twice what this
 * ground is for" means the same thing everywhere.
 *
 * A party of zero summed level gets `1`. That is not a hypothetical: `setTiles`
 * pre-rolls day one during map generation, before the starting hero exists, and
 * a division by zero there would poison the first day's encounters with `NaN`.
 */
export function encounterTimidity(band: ThreatBand, partySummedLevel: number, world: WorldId = 'empire'): number {
  const expected = expectedSummedLevel(band, world);
  if (!(partySummedLevel > 0)) return 1;
  const raw = expected / partySummedLevel;
  return Math.min(1, Math.max(BALANCE.ENCOUNTER_TIMIDITY_FLOOR, raw));
}
