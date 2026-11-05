import { BALANCE } from '@/data/balanceConstants';
import { occupierName, villageName, villageSpec, villageState, type VillageOccupier, type VillageTheme, VILLAGE_THEMES } from '@/data/villages';
import { t } from '@/i18n';
import { useVillageStore } from '@/stores/villageStore';
import { POIType, type HexCoord, type MapTile } from '@/models/types';
import type { ThreatBand } from '@/systems/world/threat';

/**
 * The garrison that holds an occupied village, and what freeing it does.
 *
 * An authored fight in the pattern of the named quest sites: the faction is the
 * village's occupier, the band is fixed by the village (`garrisonBand`), and
 * the bodies are the same on every visit. It is met by walking onto the village
 * and agreeing to the fight, never by interception, and nothing locks it: the
 * stated strength is the warning (`garrisonStrength`). Numbers are in
 * `BALANCE.VILLAGE_GARRISON`; verify in playtest.
 */

/** Encounter id of a village's garrison: `village_<theme>_<band>`. */
export const villageEncounterId = (theme: VillageTheme, band: ThreatBand): string => `village_${theme}_${band}`;

/** The village and band a garrison fight was for, or null for any other encounter. */
export function villageOfEncounter(encounterId: string | null | undefined): { theme: VillageTheme; band: ThreatBand } | null {
  const match = /^village_([a-z_]+)_([0-4])$/.exec(encounterId ?? '');
  if (!match || !(VILLAGE_THEMES as readonly string[]).includes(match[1])) return null;
  return { theme: match[1] as VillageTheme, band: Number(match[2]) as ThreatBand };
}

/** The band a village's garrison fights at, from the village's own ground. */
export function garrisonBand(occupier: VillageOccupier, tileThreat: number): ThreatBand {
  const { minBand, maxBand, bandBonus } = BALANCE.VILLAGE_GARRISON[occupier];
  return Math.min(maxBand, Math.max(minBand, tileThreat + bandBonus)) as ThreatBand;
}

/** The encounter id for the garrison on a village tile, or null if the tile is no village. */
export function garrisonOf(tile: Pick<MapTile, 'village' | 'threat'>): { id: string; theme: VillageTheme; band: ThreatBand } | null {
  if (!tile.village) return null;
  const band = garrisonBand(villageSpec(tile.village).occupier, tile.threat ?? 0);
  return { id: villageEncounterId(tile.village, band), theme: tile.village, band };
}

/** Bodies beyond the band's own size that a garrison fields. */
export const garrisonExtraBodies = (occupier: VillageOccupier): number => BALANCE.VILLAGE_GARRISON[occupier].extraBodies;

/**
 * The summed party level the garrison is stated at: what its band expects of a
 * party. A guide, not a lock.
 */
export const garrisonStrength = (band: ThreatBand): number => BALANCE.BAND_EXPECTED_LEVEL[band];

/** Gold the village pays for being freed. */
export const liberationGold = (theme: VillageTheme): number => BALANCE.VILLAGE_LIBERATION_GOLD[villageSpec(theme).occupier];

/**
 * Where a freed village's current buff is granted: the village store, by default.
 * A test swaps it to watch the call. `hours` is how long the buff runs from now.
 */
export type VillageBuffGrant = (theme: VillageTheme, hours: number) => void;
let grantBuff: VillageBuffGrant = (theme, hours) => useVillageStore.getState().grantBuff(theme, hours);
export function setVillageBuffGrant(grant: VillageBuffGrant | null): void {
  grantBuff = grant ?? ((theme, hours) => useVillageStore.getState().grantBuff(theme, hours));
}

/** What freeing a village paid, for the dialog that reports it. */
export interface Liberation {
  theme: VillageTheme;
  gold: number;
  buffHours: number;
}

/**
 * Apply a won garrison fight: the gold, and the village's current buff for a
 * week. Freeing the tile itself is `worldMapStore.freeVillage`, which the
 * caller does first; this returns null for a village that was already free, so
 * a second win pays nothing twice.
 */
export function liberate(theme: VillageTheme, freed: boolean, payGold: (amount: number) => void): Liberation | null {
  if (!freed) return null;
  const gold = liberationGold(theme);
  payGold(gold);
  grantBuff(theme, BALANCE.VILLAGE_LIBERATION_BUFF_HOURS);
  return { theme, gold, buffHours: BALANCE.VILLAGE_LIBERATION_BUFF_HOURS };
}

/** What the garrison prompt says before the fight: who holds the village, and the strength that is the warning. */
export function garrisonMessage(theme: VillageTheme, band: ThreatBand): string {
  return t('villages.garrison.message', {
    name: villageName(theme),
    occupier: occupierName(villageSpec(theme).occupier),
    level: garrisonStrength(band),
  });
}

/** The one-line journal note for an occupied village: what to do, and how strong the garrison is. */
export function villageNote(theme: VillageTheme, band: ThreatBand): { title: string; detail: string } {
  return {
    title: t('villages.note.title', { name: villageName(theme), occupier: occupierName(villageSpec(theme).occupier) }),
    detail: t('villages.note.detail', { level: garrisonStrength(band), gold: liberationGold(theme) }),
  };
}

export interface VillageNote {
  theme: VillageTheme;
  freed: boolean;
  title: string;
  /** The garrison's strength and the payout while held; the closing line once freed. */
  detail: string;
}

/**
 * Whether a party of this summed level is up to a garrison of this band: the strength
 * the note and the prompt state (`garrisonStrength`).
 */
export const meetsGarrison = (summedLevel: number, band: ThreatBand): boolean => summedLevel >= garrisonStrength(band);

/**
 * The journal's village notes on a map: one per village, held ones first. A held
 * village's note names its strength; a freed one's is the same note, done.
 *
 * **A held village is listed only once the party meets its strength** (playtest
 * 2026-10-29): the note is a job the party can take on, not a list of every village
 * on the map. `summedLevel` is the party's summed hero level; a freed village is
 * always listed.
 */
export function villageNotes(tiles: Iterable<MapTile>, summedLevel: number): VillageNote[] {
  const notes: VillageNote[] = [];
  for (const tile of tiles) {
    const garrison = garrisonOf(tile);
    if (tile.poi !== POIType.Village || !garrison) continue;
    const freed = villageState(tile) === 'free';
    if (!freed && !meetsGarrison(summedLevel, garrison.band)) continue;
    const note = villageNote(garrison.theme, garrison.band);
    notes.push({ theme: garrison.theme, freed, title: note.title, detail: freed ? t('villages.note.freed') : note.detail });
  }
  return notes.sort((a, b) => Number(a.freed) - Number(b.freed) || VILLAGE_THEMES.indexOf(a.theme) - VILLAGE_THEMES.indexOf(b.theme));
}

/**
 * Where a followed village is (`questStore.trackedVillage`): the tile of that village
 * while it is held, or null once it is free or on a map that has none, so the guide
 * stops pointing at a job that is done.
 */
export function heldVillageCoord(tiles: Iterable<MapTile>, theme: VillageTheme): HexCoord | null {
  for (const tile of tiles) {
    if (tile.poi === POIType.Village && tile.village === theme && villageState(tile) !== 'free') return tile.coord;
  }
  return null;
}

/** The note for a followed village while it is held, for the HUD's tracked strip; null once free. */
export function heldVillageNote(tiles: Iterable<MapTile>, theme: VillageTheme): { title: string; detail: string } | null {
  for (const tile of tiles) {
    const garrison = tile.village === theme && villageState(tile) !== 'free' ? garrisonOf(tile) : null;
    if (tile.poi === POIType.Village && garrison) return villageNote(theme, garrison.band);
  }
  return null;
}
