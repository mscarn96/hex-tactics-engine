import { roadState, setLevelCapInputs, type RoadState } from '@/data/levelCap';
import type { WorldId } from '@/data/worlds';
import type { EncounterSpec } from './encounters';

/**
 * The campaign a banded fight is played in.
 *
 * Item levels are clamped to the cap in force (`itemAtLevel`) and a Jadeveil fight reads its level and its
 * power from the ledger (`contentLevel`), so a fight at band 3 has to be fought in a campaign at band 3.
 * These are the game's own inputs: Jadeveil holds `worldBand`, stand-in worlds hold the bands before and
 * after it, and all but the newest are finished, so the cap is the top of `band`. Band 0 is the Empire and
 * touches nothing: a fight there keeps the inputs it found, which is what keeps an Empire run the same.
 */
export function bandRoad(band: number, worldBand: number = band): RoadState {
  const worlds = Array.from({ length: band }, (_, i) => (i === worldBand - 1 ? 'jadeveil' : `band_${i + 1}`) as WorldId);
  return { owned: worlds, emperorDefeated: true, banded: worlds, finished: worlds.slice(0, band - 1) };
}

/** Runs `play` in the campaign `bandRoad` states, and puts the inputs back. */
export function atBandRoad<T>(band: number, worldBand: number, play: () => T): T {
  const before = roadState();
  setLevelCapInputs(bandRoad(band, worldBand));
  try {
    return play();
  } finally {
    setLevelCapInputs(before);
  }
}

/** `atBandRoad` for an encounter spec; the Empire plays as it stands. */
export function atSpecRoad<T>(spec: Pick<EncounterSpec, 'band' | 'worldBand'>, play: () => T): T {
  return spec.band ? atBandRoad(spec.band, spec.worldBand ?? spec.band, play) : play();
}
