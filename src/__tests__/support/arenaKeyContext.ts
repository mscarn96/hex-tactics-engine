import { ARENA_VILLAGES, type ArenaVillage } from '@/data/display/arenaLayout';
/**
 * A fight that is dressed under an arena key: the inverse of `compositionKeyFor`, for the suites
 * that walk every kit by its key.
 *
 * One copy, because five suites each carried their own and every new kind of key (a site, a
 * Jadeveil ground) had to be taught to all five; a copy that has not been taught sends the key
 * down the terrain branch and composes the plains in its place, which is a test passing on the
 * wrong arena.
 */
import { LOCATIONS, locationContext } from '@/locations';
import type { LocationId } from '@/locations/types';
import { EncounterContext, IsleGround, JadeGround, TileType } from '@/models/types';
import { isArenaSite, shrineContext, villageContext, siteContext } from '@/systems/combat/encounterContext';

/** The terrain each Jadeveil ground stands on. */
const JADE_TERRAIN: Record<Exclude<JadeGround, 'shrine'>, TileType> = {
  moss: TileType.Plains,
  bamboo: TileType.Forest,
  terrace: TileType.Highlands,
  ridge: TileType.Mountain,
  crown: TileType.Mountain,
};

/** The terrain each archipelago ground stands on, as the forge and the preview set it. */
const ISLE_TERRAIN: Record<IsleGround, TileType> = {
  beach: TileType.Desert,
  jungle: TileType.Forest,
  rock: TileType.Highlands,
};

export function arenaKeyContext(key: string, threat = { living: 0, haunted: 2 }): EncounterContext {
  if (LOCATIONS[key as LocationId] as unknown) return locationContext(key as LocationId);
  // A world site's own arena (Jadeveil: the summit, a shrine's courtyard)
  if (isArenaSite(key)) return siteContext(key);
  // A shrine's courtyard, dressed for its band
  const shrine = /^shrine_(\d)$/.exec(key);
  if (shrine) return shrineContext(Number(shrine[1]));
  // A held village's own arena, where its garrison is fought
  const village = /^village_(\w+)$/.exec(key)?.[1] as ArenaVillage | undefined;
  if (village && ARENA_VILLAGES.includes(village)) return villageContext(village);
  // An archipelago ground (the private project notes), dressed before its world exists
  const isle = /^isle_(\w+)$/.exec(key)?.[1] as IsleGround | undefined;
  if (isle && ISLE_TERRAIN[isle]) return { kind: 'world', terrain: ISLE_TERRAIN[isle], danger: false, threat: threat.living, isle };
  const danger = key.startsWith('danger_');
  const ground = danger ? key.slice('danger_'.length) : key;
  const jade = /^jade_(\w+)$/.exec(ground)?.[1] as Exclude<JadeGround, 'shrine'> | undefined;
  if (jade && JADE_TERRAIN[jade]) {
    return { kind: 'world', terrain: JADE_TERRAIN[jade], danger, threat: danger ? threat.haunted : threat.living, jade };
  }
  return { kind: 'world', terrain: ground as TileType, danger, threat: danger ? threat.haunted : threat.living };
}
