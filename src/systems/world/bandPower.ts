import { BALANCE } from '@/data/balanceConstants';
import { itemLevelScale } from '@/data/items/itemLevel';
import { Rarity } from '@/models/types';
import { bandFloor } from '@/systems/world/worldBands';

/**
 * How much harder a level band's ground is priced than band 1's
 * (the private project notes, *Enemy power per band*).
 *
 * Above level 20 gear grows faster than the enemies' level term, so without a step each band
 * would be easier for the party that belongs in it than the one before. The step is what the gear
 * a party holds at the band's start has gained on band 1's, over what the level term has gained
 * by itself. That gear is epics at the band floor and a share of legendaries from the previous
 * band's top, on the legendary's steep segment. Never below 1: a later band is not easier.
 *
 * Tuned in the simulator (the private project notes, *What the numbers mean*): the share to
 * even boss health dealt with the scripted party, then a trim per band to bring the tactical party's
 * win rates within five points of band 1's. Verify in playtest. Pure, and a function of the band alone
 * rather than of the cap in force.
 */
const heldGearScale = (band: number): number => {
  const share = BALANCE.BAND_GEAR_LEGENDARY_SHARE;
  const floor = bandFloor(band);
  return (1 - share) * itemLevelScale(floor, Rarity.Epic) + share * itemLevelScale(floor - 1, Rarity.Legendary);
};

const levelTerm = (level: number): number => 1 + BALANCE.ENEMY_LEVEL_SCALE * (level - 1);

/** The step over band 1: exactly 1 at band 1. On every fight in the band, bosses included. */
export function bandPowerStep(band: number): number {
  const gear = heldGearScale(band) / heldGearScale(1);
  const level = levelTerm(bandFloor(band)) / levelTerm(bandFloor(1));
  const trim = BALANCE.BAND_POWER_TRIM[Math.min(BALANCE.BAND_POWER_TRIM.length, Math.max(1, band)) - 1];
  return Math.max(1, (gear / level) * trim);
}

/** The ground power table: a band's multiplier on its fights, on top of their ground. Band 1 is `BAND_GROUND_POWER`. */
export function bandGroundPower(band: number): number {
  return BALANCE.BAND_GROUND_POWER * bandPowerStep(band);
}
