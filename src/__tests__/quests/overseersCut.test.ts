import { DEFAULT_LOCALE, setLocale } from '@/i18n';
import { MapTile, POIType, TileType } from '@/models/types';
import { QUESTS } from '@/quests/questData';
import { QUEST_SITES } from '@/quests/sites';
import { questTitle, siteName } from '@/quests/questText';
import { dialogueLine } from '@/quests/npcText';
import { generateMap, movementCost } from '@/systems/world/mapGenerator';
import { curatedBand, planEncounter } from '@/systems/world/encounterGenerator';
import { wavesForPlan } from '@/data/templates/encounterWaves';
import { objectiveLabel } from '@/systems/quests/objectiveLabel';
import { getNeighbors, hexKey } from '@/utils/hexUtils';

/**
 * The Overseer's Cut (PT-08): the prospector chain's Delve fight, on a named
 * Highlands site near Ferrow. `placeQuestSites` throws when no reachable tile
 * matches, so the site is checked on fifty more seeds than the shared suite's
 * thirty (0–29). It was run once on seeds 1000–1099, all placed; fifty keeps
 * the suite under a minute.
 */

afterEach(() => setLocale(DEFAULT_LOCALE));

function reachable(tiles: MapTile[]): Set<string> {
  const map = new Map(tiles.map(t => [hexKey(t.coord), t]));
  const city = tiles.find(t => t.poi === POIType.City)!;
  const queue: MapTile[] = [city];
  const seen = new Set([hexKey(city.coord)]);
  for (let head = 0; head < queue.length; head++) {
    for (const coord of getNeighbors(queue[head].coord)) {
      const key = hexKey(coord), tile = map.get(key);
      if (!tile || seen.has(key) || movementCost(queue[head], tile) === null) continue;
      seen.add(key); queue.push(tile);
    }
  }
  return seen;
}

it('stands once, on reachable Highlands, on fifty further seeds', () => {
  const failures: string[] = [];
  for (let seed = 1000; seed < 1050; seed++) {
    let tiles: MapTile[];
    try {
      tiles = generateMap(seed);
    } catch (error) {
      failures.push(`${seed}: ${(error as Error).message}`);
      continue;
    }
    const seen = reachable(tiles);
    const matches = tiles.filter(t => t.questId === 'quest_overseers_cut');
    if (matches.length !== 1) { failures.push(`${seed}: ${matches.length} sites`); continue; }
    const [site] = matches;
    if (site.type !== TileType.Highlands || !seen.has(hexKey(site.coord)) || site.poi !== POIType.QuestSite) {
      failures.push(`${seed}: misplaced`);
    }
  }
  expect(failures).toEqual([]);
}, 120_000);

it('is a real Delve fight led by an overseer, with a lighter shift behind it', () => {
  const site = QUEST_SITES.quest_overseers_cut;
  expect(curatedBand('quest_overseers_cut')).toBe(2);
  const plan = planEncounter('quest_overseers_cut');
  expect(plan.factionId).toBe('delve');
  expect(plan.enemies).toEqual(site.enemies);
  expect(plan.enemies).toContain('delve_overseer');
  expect(plan.enemies.every(id => id.startsWith('delve_'))).toBe(true);
  const waves = wavesForPlan('quest_overseers_cut', plan);
  expect(waves.map(w => w.id)).toEqual(['overseers_cut_shift']);
  expect(waves[0].templateIds.length).toBeLessThan(plan.enemies.length);
  expect(waves[0].templateIds).not.toContain('delve_overseer');
  // The Frozen Camp keeps its own faction through the same table.
  expect(planEncounter('quest_frozen_camp').factionId).toBe('rime_jarls');
});
