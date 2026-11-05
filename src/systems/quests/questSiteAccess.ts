import { MapTile, POIType } from '@/models/types';
import { HexCoord, hexKey } from '@/utils/hexUtils';
import { QUESTS } from '@/quests/questData';
import { questSite } from '@/quests/sites';
import { QuestId } from '@/quests/types';

/**
 * Whether a quest destination is on the map yet.
 *
 * Every quest site is placed when the map is generated, but a site stands on
 * the map only once a quest that sends the party there has been **accepted**
 * (and stays once that quest is done, so a cleared camp does not vanish from
 * under a finished story). A Snare Thicket the player walked into before the
 * huntsman had mentioned it was a nest with no story attached, and the marker
 * gave the next three contracts away.
 *
 * A named site (`quests/sites.ts`) belongs to the quests whose objectives name
 * it. An unnamed `quest_N` waypoint belongs to the quests with a generic
 * `clearPoi` on quest waypoints — the Roadwardens' "find where the road turns
 * dangerous".
 */
export interface QuestLogView {
  active: Partial<Record<QuestId, unknown>>;
  completed: readonly QuestId[];
}

/** The quests that send the party to a site, derived from the quest data. */
export function questsForSite(siteId: string): QuestId[] {
  const named = questSite(siteId) !== undefined;
  return (Object.keys(QUESTS) as QuestId[]).filter(id => QUESTS[id].stages.some(stage =>
    stage.objectives.some(o => named
      ? (o.kind === 'investigate' || o.kind === 'clearPoi') && o.site === siteId
      : o.kind === 'clearPoi' && o.poi === POIType.QuestSite && !o.site)));
}

const OWNERS = new Map<string, QuestId[]>();
const owners = (siteId: string): QuestId[] => {
  let found = OWNERS.get(siteId);
  if (!found) OWNERS.set(siteId, found = questsForSite(siteId));
  return found;
};

/** True for every tile that is not a quest site, and for a site its quest has opened. */
export function questSiteOpen(tile: Pick<MapTile, 'poi' | 'questId'> | undefined, log: QuestLogView): boolean {
  if (!tile || tile.poi !== POIType.QuestSite) return true;
  return owners(tile.questId ?? '').some(id => log.active[id] !== undefined || log.completed.includes(id));
}

/** Hex keys of the quest sites still waiting for their quest, from the POI index. */
export function dormantQuestSites(
  tiles: ReadonlyMap<string, MapTile>,
  poiCoords: readonly HexCoord[],
  log: QuestLogView,
): ReadonlySet<string> {
  const dormant = new Set<string>();
  for (const coord of poiCoords) {
    const key = hexKey(coord);
    if (!questSiteOpen(tiles.get(key), log)) dormant.add(key);
  }
  return dormant;
}
