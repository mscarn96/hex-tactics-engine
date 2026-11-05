import { MapTile, POIType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import type { FactionId } from '@/data/templates/factions';
import { t } from '@/i18n';
import { entryText } from '@/i18n/dataText';

/**
 * The Empire's four villages: friendly stops on the main map, each held by an
 * occupier until the party frees it. Design: the private project notes.
 *
 * This table is the placement and identity of the four; the garrison fights,
 * the counter panel and the buffs are other features' and read the same ids.
 * Names and lines live in the `villages` catalog, keyed by theme.
 */
export const VILLAGE_THEMES = ['lookout', 'trading_post', 'smithy', 'shrine'] as const;
export type VillageTheme = (typeof VILLAGE_THEMES)[number];

/** Who holds a village until it is freed: a faction id from `data/factions`. */
export type VillageOccupier = Extract<FactionId, 'brigands' | 'obsidian_legion'>;

export interface VillageSpec {
  theme: VillageTheme;
  occupier: VillageOccupier;
  /** `near` villages stand close to home, `far` ones out toward the castle. */
  ring: 'near' | 'far';
}

/** In placement order: the near pair first, so the far pair keeps clear of them. */
export const VILLAGES: readonly VillageSpec[] = [
  { theme: 'lookout', occupier: 'brigands', ring: 'near' },
  { theme: 'trading_post', occupier: 'brigands', ring: 'near' },
  { theme: 'smithy', occupier: 'obsidian_legion', ring: 'far' },
  { theme: 'shrine', occupier: 'obsidian_legion', ring: 'far' },
];

export function villageSpec(theme: VillageTheme): VillageSpec {
  return VILLAGES.find((v) => v.theme === theme)!;
}

/** The share of the home-to-castle distance a village of this ring may stand at. */
export function villageRouteShare(spec: VillageSpec): readonly [number, number] {
  return BALANCE.VILLAGE_ROUTE_SHARE[spec.ring];
}

/**
 * Whether a village is free. The freed state is the tile's `defeated` mark,
 * which a world snapshot already saves and restores, so it survives saves and
 * travel between worlds with no field of its own; occupied is the default.
 */
export type VillageState = 'occupied' | 'free';

export function villageState(tile: Pick<MapTile, 'defeated'>): VillageState {
  return tile.defeated ? 'free' : 'occupied';
}

/** Each village's state on a map, by theme. */
export function villageStates(tiles: Iterable<MapTile>): Partial<Record<VillageTheme, VillageState>> {
  const out: Partial<Record<VillageTheme, VillageState>> = {};
  for (const tile of tiles) if (tile.poi === POIType.Village && tile.village) out[tile.village] = villageState(tile);
  return out;
}

/** Display text, looked up when shown (`i18n/dataText.ts`). */
export const villageName = (theme: VillageTheme): string => entryText('villages', theme, 'name');
export const villageKind = (theme: VillageTheme): string => entryText('villages', theme, 'kind');
export const occupierName = (occupier: VillageOccupier): string => t(`villages.occupier.${occupier}`);

/** What the map says when the party stands on a village whose panel or fight is not built yet. */
export function villageArrival(theme: VillageTheme, state: VillageState): string {
  const spec = villageSpec(theme);
  return t(state === 'occupied' ? 'villages.arrival.occupied' : 'villages.arrival.free', {
    name: villageName(theme),
    occupier: occupierName(spec.occupier),
  });
}
