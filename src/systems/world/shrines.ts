import { MapTile, POIType } from '@/models/types';
import type { FactionId } from '@/data/templates/factions';
import type { ThreatBand } from '@/systems/world/threat';
import { hexKey } from '@/utils/hexUtils';

/**
 * The shrine chain that gates Jadeveil's ascent.
 *
 * Shrine `i` stands in band `i` (`placeShrines`). Claiming it — beating its
 * keepers on the shrine hex — opens the band above: bands 0 and 1 are open
 * from the start, band `b` once shrine `b − 1` is held, and the fourth shrine,
 * at the summit approach, opens the summit hex itself. Claims are made in
 * order, so the whole record is one count (`ascentStore.shrines`), permanent
 * and global like the vows: wrath decays, a claim never does, and no world
 * snapshot can lose one.
 *
 * Solvable by construction: a shrine is placed on ground the camp reaches
 * without entering a band above its own, so each claim is reachable with what
 * the claims below it opened. Pure, so the rule is tested in Node.
 */

export const SHRINE_COUNT = 4;

/** Encounter id of a shrine's keepers: `shrine_<i>`. */
export const shrineEncounterId = (index: number): string => `shrine_${index}`;

/** The shrine a keepers' fight was for, or null for any other encounter. */
export function shrineOfEncounter(encounterId: string | null | undefined): number | null {
  const match = /^shrine_(\d)$/.exec(encounterId ?? '');
  if (!match) return null;
  const index = Number(match[1]);
  return index >= 1 && index <= SHRINE_COUNT ? index : null;
}

/**
 * Who keeps each shrine: the Yokai the lowest, the Fallen Order the terraces'
 * hall, and the Draconic Host the two high on the road to their god — the
 * Host holds the way to Kairen and keeps no lair of its own.
 */
export const SHRINE_KEEPERS: Record<number, FactionId> = {
  1: 'yokai',
  2: 'fallen_order',
  3: 'draconic_host',
  4: 'draconic_host',
};

/** A shrine's keepers fight at their shrine's band. */
export const shrineBand = (index: number): ThreatBand => Math.min(4, Math.max(0, index)) as ThreatBand;

/** The highest band a party holding `claimed` shrines may enter. */
export const openBand = (claimed: number): number => Math.min(4, claimed + 1);

/** The summit hex opens with the fourth shrine. */
export const summitOpen = (claimed: number): boolean => claimed >= SHRINE_COUNT;

/**
 * The shrine whose claim opens `tile`, or null when it is open: the shrine
 * below its band, or the fourth for the summit.
 */
export function shrineToOpen(tile: MapTile, claimed: number): number | null {
  if (tile.poi === POIType.Summit) return summitOpen(claimed) ? null : SHRINE_COUNT;
  const band = tile.threat ?? 0;
  return band > openBand(claimed) ? band - 1 : null;
}

/** True when the chain still bars `tile`. */
export const tileLocked = (tile: MapTile, claimed: number): boolean => shrineToOpen(tile, claimed) !== null;

/**
 * What arriving at shrine `index` does with `claimed` held: its keepers fight
 * when it is the next in the chain, it is quiet once held, and a shrine above
 * the next is out of reach by the band rule — kept here so the answer is total.
 */
export function shrineState(index: number, claimed: number): 'claimed' | 'next' | 'beyond' {
  if (index <= claimed) return 'claimed';
  return index === claimed + 1 ? 'next' : 'beyond';
}

/** Pass hexes (`MapTile.pass`) on ground the chain still bars: drawn barred. */
export function barredPasses(tiles: Iterable<MapTile>, claimed: number): Set<string> {
  const out = new Set<string>();
  for (const tile of tiles) if (tile.pass && tileLocked(tile, claimed)) out.add(hexKey(tile.coord));
  return out;
}
