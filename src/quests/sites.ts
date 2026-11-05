import { EnemyTemplateId, TileType } from '@/models/types';
import type { FactionId } from '@/data/templates/factions';

/**
 * Named addresses reuse MapTile.questId; unnamed quest_N waypoints keep their rules.
 * A site's name and discovery line are `siteName(id)` and `siteDiscovery(id)` (`questText.ts`).
 */
export const QUEST_SITES = {
  quest_thicket: {
    terrain: TileType.Forest, near: 'huntsman',
    band: 0, enemies: ['giant_spider', 'giant_spider'],
  },
  // Band 1 and a pair was too easy (playtest 2026-10-21): band 2, and the fen's
  // quicker hunters wade in with them. The waves are `GREYWATER_CROSSING`.
  quest_greywater: {
    terrain: TileType.Swamp, near: 'fen_hermit',
    band: 2, enemies: ['fen_spawn', 'mire_wader', 'reed_stalker'],
  },
  // Hoofprints in the Mud (PT-07, 2026-10-23): the hamlet the Herd trampled,
  // read in peace, and the raiders' camp on the plains nearest the hermit. The
  // camp is the Herd's war party at the fen's band: its Khan, two lancers, an
  // archer and a drummer.
  quest_trampled_hamlet: {
    terrain: TileType.Swamp, near: 'fen_hermit',
    band: 2, enemies: [],
  },
  quest_raider_camp: {
    terrain: TileType.Plains, near: 'fen_hermit',
    band: 2, faction: 'thunder_herd', enemies: ['herd_khan', 'herd_lancer', 'herd_lancer', 'steppe_archer', 'storm_drummer'],
  },
  quest_claim: {
    terrain: TileType.Highlands, near: 'prospector',
    band: 1, enemies: [],
  },
  quest_bell: {
    terrain: TileType.Highlands, near: 'prospector',
    band: 2, enemies: [],
  },
  // The prospector chain's one fight (PT-08): the Delve crew cutting down toward
  // the Imperial drain under the Old Bell Shaft. Band 2, the bell's own ground;
  // their overseer leads, and a second shift waits behind the face
  // (`encounterWaves.ts`, OVERSEERS_CUT).
  quest_overseers_cut: {
    terrain: TileType.Highlands, near: 'prospector',
    band: 2, faction: 'delve', enemies: ['delve_overseer', 'delve_breaker', 'delve_breaker', 'delve_pickhand', 'delve_slinger'],
  },
  quest_trapline: {
    terrain: TileType.Tundra, near: 'huntsman',
    band: 2, enemies: [],
  },
  // A war camp, not a picket (playtest 2026-10-14: "much harder, a lot of Rime
  // Jarl elites with high power"): three Jarls and their hold at band 3, where
  // it was three ordinary bodies at band 2 and the Jarl it names was absent.
  quest_frozen_camp: {
    terrain: TileType.Tundra, near: 'huntsman',
    band: 3, faction: 'rime_jarls', enemies: ['rime_jarl', 'rime_jarl', 'rime_jarl', 'rime_giantling', 'rime_skald', 'glacier_hurler'],
  },
  // A convoy fight where there was only a clue (playtest 2026-10-14): seven
  // bodies, the Legion's escort and the Hoarfrost's cold riding with it. Band 2
  // played far too easy (playtest 2026-10-21), so it is band 3 and the cold has
  // brought its heavy: a Glacier Colossus walks with the sleds.
  quest_supply_trail: {
    terrain: TileType.Tundra, near: 'archivist',
    band: 3, enemies: ['glacier_colossus', 'frost_mote', 'frost_mote', 'shardcaster', 'shardcaster', 'hoarfrost_wraith', 'obsidian_infantry', 'blood_iron_arcanist'],
  },
} as const;

export type QuestSiteId = keyof typeof QUEST_SITES;

/** Whether an id names a site in the table (rather than an unnamed `quest_N` waypoint). */
export function isQuestSiteId(id: string | undefined): id is QuestSiteId {
  return !!id && Object.hasOwn(QUEST_SITES, id);
}

export function questSite(id: string | undefined) {
  return isQuestSiteId(id) ? QUEST_SITES[id] : undefined;
}

/** The faction a site's fight is announced as, where it has one. */
export function siteFaction(id: string | undefined): FactionId | null {
  const site = questSite(id);
  return site && 'faction' in site ? site.faction : null;
}

export function siteEnemies(id: string): EnemyTemplateId[] | null {
  const site = questSite(id);
  return site ? [...site.enemies] : null;
}

/** Legacy waypoints are combat; named peaceful clues cannot stand in for one. */
export function isQuestCombatSite(id: string | undefined): boolean {
  const site = questSite(id);
  return !site || site.enemies.length > 0;
}
