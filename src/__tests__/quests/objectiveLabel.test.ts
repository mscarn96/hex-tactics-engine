import { shrineName } from '@/systems/world/rangeSites';
import { QUESTS, QUEST_IDS } from '@/quests/questData';
import { NPCS } from '@/quests/npcData';
import { npcName } from '@/quests/npcText';
import { questSite } from '@/quests/sites';
import { objectiveGroupName, siteName } from '@/quests/questText';
import { LOCATIONS, placeName } from '@/locations';
import { FACTIONS, factionName } from '@/data/templates/factions';
import { Objective } from '@/quests/types';
import { enemyName, killPluralKey, objectiveLabel, pluralName } from '@/systems/quests/objectiveLabel';
import { ResourceType } from '@/models/types';
import { DEFAULT_LOCALE, hasMessage, setLocale } from '@/i18n';
import { campaign } from '@/i18n/locales/en/campaign';

/**
 * English plural of the last word of a name: "Dire Wolf" → "Dire Wolves". Only
 * for the authoring check below, which asks whether an English group name is a
 * word every member shares; the game's plurals are catalog entries.
 */
function englishPlural(name: string): string {
  const words = name.split(' ');
  const last = words[words.length - 1];
  let plural: string;
  if (/[^aeiou]y$/i.test(last)) plural = `${last.slice(0, -1)}ies`;
  else if (/(s|x|z|ch|sh)$/i.test(last)) plural = `${last}es`;
  else if (/[^f]f$/i.test(last)) plural = `${last.slice(0, -1)}ves`;
  else plural = `${last}s`;
  return [...words.slice(0, -1), plural].join(' ');
}

const ALL = QUEST_IDS.flatMap((id) =>
  QUESTS[id].stages.flatMap((stage) => stage.objectives.map((objective) => ({ id, objective }))),
);

/** The name an objective's label must contain, read from the same source the game shows. */
function nounFor(objective: Objective): string[] {
  const lower = (s: string) => s.replace(/^The /, 'the ');
  switch (objective.kind) {
    case 'kill':
      return objective.group ? [objectiveGroupName(objective.group)] : objective.templates.map(enemyName);
    case 'collect':
      return [objective.resource.charAt(0).toUpperCase() + objective.resource.slice(1)];
    case 'talk':
      return [npcName(objective.npc)];
    case 'reach':
      return [lower(placeName(objective.location))];
    case 'investigate':
      return [lower(siteName(objective.site))];
    case 'clearPoi':
      return objective.site ? [lower(siteName(objective.site))] : ['waypoint'];
    case 'shrine':
      return [shrineName(objective.index)];
  }
}

describe('objective labels', () => {

  it('keeps no plural that no counter uses', () => {
    const used = new Set<string>(ALL.flatMap(({ objective }) => (objective.kind === 'kill' ? objective.templates : [])));
    const orphans = Object.keys(campaign)
      .filter((key) => key.startsWith('killPlural.'))
      .map((key) => key.slice('killPlural.'.length))
      .filter((tpl) => !used.has(tpl));
    expect(orphans).toEqual([]);
  });

  it('never prints undefined or a doubled space', () => {
    for (const { objective } of ALL) {
      expect(objectiveLabel(objective).trim()).toBe(objectiveLabel(objective));
      expect(objectiveLabel(objective)).not.toMatch(/undefined|\s{2}/);
    }
  });
});
