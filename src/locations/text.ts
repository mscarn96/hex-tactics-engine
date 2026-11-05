import { entryText } from '@/i18n/dataText';
import { npcName } from '@/quests/npcText';
import type { LocationId, LocationTile, TileLabel } from './types';

/**
 * The words of the walked places, read when shown from the `places` namespace
 * (see the private project notes, "Data tables keep ids").
 */

/** Every walked place, for the catalog's parity test. */
export const LOCATION_IDS: readonly LocationId[] = [
  'city', 'lair_warren', 'lair_barrow', 'lair_wyrm', 'lair_silk', 'lair_hall', 'camp_jadeveil', 'castle',
];

/** The captions read from `places.label.<id>.text` (every `TileLabel` but `place`). */
export const CAPTION_LABELS: readonly Exclude<TileLabel, 'place'>[] = [
  'barracks', 'library', 'forge', 'tavern', 'market', 'shop', 'stash',
  'leave', 'withdraw', 'guarded', 'chest',
  'campfire', 'monastery', 'trader', 'whetstone', 'road', 'range',
];

/** A place's name ("The Warren" / "Nora"). */
export const placeName = (id: LocationId): string => entryText('places', id, 'name');

/**
 * What a tile's caption says, in `location`, or null when it has none: a
 * person by their `npc` trigger, a place's own name for `place`, and the rest
 * from `places.label.<id>.text`.
 */
export function tileLabel(tile: Pick<LocationTile, 'label' | 'trigger'>, location: LocationId): string | null {
  if (tile.trigger?.kind === 'npc') return npcName(tile.trigger.npc);
  const label = tile.label;
  if (!label) return null;
  if (label === 'place') return placeName(location);
  return entryText('places', `label.${label}`, 'text');
}
