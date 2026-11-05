import { BALANCE } from '@/data/balanceConstants';
import type { ThreatBand } from '@/systems/world/threat';
import { WARBAND_ENCOUNTER_ID } from '@/systems/world/encounterGenerator';
import { expectedSummedLevel } from '@/systems/world/encounterTimidity';
import type { WorldId } from '@/data/worlds';

/**
 * Escape, the Lookout's first buff: a warband that stops the walk can be fought
 * or fled.
 *
 * The chance is the party's summed level over what the warband's band expects
 * of a party (`expectedSummedLevel`, the same measure `encounterTimidity`
 * reads), scaled by `VILLAGE_ESCAPE.base` and kept between its `min` and `max`:
 * a party at the band's expected level flees 60% of the time, one a third as
 * strong 20%, one at one and a half times 90%. Numbers are first guesses;
 * verify in playtest.
 *
 * Only wandering warbands can be fled. The rule is the call site's: a lair, a
 * boss, a quest fight, a guarded chest and a village garrison never reach it.
 */
export function fleeChance(partySummedLevel: number, band: ThreatBand, world: WorldId = 'empire'): number {
  const { base, min, max } = BALANCE.VILLAGE_ESCAPE;
  const expected = expectedSummedLevel(band, world);
  // A party of no level (before the first hero exists) gets the floor, as the roll never asks it
  const raw = partySummedLevel > 0 ? (base * partySummedLevel) / expected : 0;
  return Math.min(max, Math.max(min, raw));
}

/**
 * Whether a fight can be fled: only the wandering warband the walk runs into.
 * Not a lair's chambers or boss, a quest site, a guarded chest's guards, a
 * shrine's keepers, the castle, the siege or a village's garrison.
 */
export const canFlee = (encounterId: string | null | undefined): boolean => encounterId === WARBAND_ENCOUNTER_ID;

/** Whether the roll gets the party away: it does when the roll falls under the chance. */
export const fleeSucceeds = (chance: number, roll: number = Math.random()): boolean => roll < chance;
