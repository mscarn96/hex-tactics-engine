import { HexCoord, MapTile, POIType } from '@/models/types';
import { hexKey } from '@/utils/hexUtils';
import { threatBandName } from '@/data/worlds';
import { t } from '@/i18n';
import { entryText } from '@/i18n/dataText';
import { SHRINE_COUNT, shrineState, shrineToOpen, summitOpen } from '@/systems/world/shrines';

/**
 * Jadeveil's places on the way up: the four shrines on the pilgrim road and
 * the summit they climb to, what each says when the party arrives, and where
 * the guide's Ascent mode points.
 *
 * The shrines are claimed in order (`shrines.ts`); what each says depends on
 * whether it is held, the next to claim, or still above the chain. Pure, so
 * the guide's rule can be tested in Node.
 */

/**
 * A shrine's name, 1 lowest on the road: `places.shrine.<index>.name`. An
 * index outside the chain is "a wayside shrine".
 */
export function shrineName(index: number | undefined): string {
  const i = index ?? 1;
  return Number.isInteger(i) && i >= 1 && i <= SHRINE_COUNT
    ? entryText('places', `shrine.${i}`, 'name')
    : t('places.shrine.wayside.name');
}

/** The summit's name ("The Cloud Crown" / "Korona Chmur"). */
export const summitName = (): string => t('places.summit.name');

/** The band a shrine's claim opens, by name — or the summit, for the fourth. */
export function shrineOpens(index: number): string {
  return index >= SHRINE_COUNT ? summitName() : threatBandName('jadeveil', index + 1);
}

/**
 * What the party finds at a held shrine (the next one starts its keepers'
 * fight instead, and says nothing first).
 */
export function shrineArrival(index: number | undefined, claimed: number): string {
  const name = shrineName(index);
  switch (shrineState(index ?? 1, claimed)) {
    case 'claimed':
      return t('places.shrine.claimed.arrival', { name, opens: shrineOpens(index ?? 1) });
    case 'next':
      return t('places.shrine.next.arrival', { name });
    default:
      return t('places.shrine.locked.arrival', { name });
  }
}

/** The map's news when shrine `index` is claimed: what it opened. */
export function shrineClaimedNotice(index: number): string {
  const name = shrineName(index);
  return index >= SHRINE_COUNT
    ? t('places.shrine.claimed.summit', { name, summit: summitName() })
    : t('places.shrine.claimed.band', { name, band: shrineOpens(index) });
}

/** Why a tap on ground the chain still bars refuses it, or null when it is open. */
export function lockedRefusal(tile: MapTile, claimed: number): string | null {
  const shrine = shrineToOpen(tile, claimed);
  if (shrine === null) return null;
  const where = tile.poi === POIType.Summit ? summitName() : threatBandName('jadeveil', tile.threat ?? 0);
  return t('places.shrine.barred.refusal', { where, shrine: shrineName(shrine) });
}

/**
 * What the summit says when its door is shut (`summit.ts`): which shrine is missing, or
 * that only a full bar of wrath stills the storm. With a tier open the door itself
 * opens instead (`SummitGateDialog`) — the story fight while the window lasts, the
 * Storm Seals after the first kill — so the open window's line is the dialog's.
 */
export function summitArrival(windowHours: number, hoursText: (h: number) => string, claimed: number = SHRINE_COUNT): string {
  const summit = summitName();
  if (!summitOpen(claimed)) return t('places.summit.shrine.arrival', { summit, shrine: shrineName(SHRINE_COUNT) });
  if (windowHours > 0) return t('places.summit.open.arrival', { summit, time: hoursText(windowHours) });
  return t('places.summit.walled.arrival', { summit });
}

/**
 * Where the guide's Ascent mode points: the next shrine to claim, and the
 * summit once all four are held. The chain is the order the range is climbed
 * in, so the arrow never points at ground the party cannot yet enter.
 */
export function ascentTarget(
  tiles: ReadonlyMap<string, MapTile>,
  poiCoords: readonly HexCoord[],
  claimed: number,
): HexCoord | null {
  let summit: HexCoord | null = null;
  let next: HexCoord | null = null;
  for (const coord of poiCoords) {
    const tile = tiles.get(hexKey(coord));
    if (tile?.poi === POIType.Summit) summit = coord;
    if (tile?.poi === POIType.Shrine && tile.shrine === claimed + 1) next = coord;
  }
  return next ?? summit;
}
