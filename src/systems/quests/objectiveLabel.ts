import { Objective } from '@/quests/types';
import { npcName } from '@/quests/npcText';
import { questSite } from '@/quests/sites';
import { objectiveGroupName, objectiveVerbLabel, siteName } from '@/quests/questText';
import { hasMessage, t, type MessageKey } from '@/i18n';
import { entryText } from '@/i18n/dataText';
import { LOCATIONS, placeName } from '@/locations';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { POIType, ResourceType } from '@/models/types';
import { shrineName } from '@/systems/world/rangeSites';
import { templateName } from '@/data/templates/unitText';

/**
 * What an objective is called, derived from the thing it counts.
 *
 * **Generated, never authored.** A hand-written label beside a quest is a second
 * statement of what the quest wants, and it drifted: "Their overseers 0/2" asked
 * for Orc Grunts without saying so, and "The troll chieftain" named a boss the
 * fight itself calls the Bonebound Warlord. Every label here comes from the
 * enemy roster, the NPC list, the quest sites or the location registry — the
 * same names the player sees on the board, the map and in conversation — so a
 * rename moves the quest line with it.
 *
 * The only authored words left are a `group` name for a kill counter that
 * accepts more than two templates ("Wolves" for pup, wolf and dire wolf) and an
 * optional `verb` on the place and person kinds. Neither can name the wrong
 * thing: the noun is always derived.
 *
 * Pure and free of React so the node suites can read every label in the game.
 */

/** A resource's display name, read here so systems need no UI constants. */
const resourceWord = (type: ResourceType): string => entryText('world', `resource.${type}`, 'name');

/** The display name of an enemy template, or its id when the roster lacks it. */
export function enemyName(templateId: string): string {
  return templateName(templateId);
}

/**
 * The catalog key of an enemy's plural name, for a counter over more than one.
 * Plurals are written out per template (`campaign.killPlural.<id>`) rather than
 * made by a rule, because no rule makes Polish plurals; `objectiveLabel.test.ts`
 * holds that every counter which needs one has one.
 */
export const killPluralKey = (templateId: string): MessageKey => `campaign.killPlural.${templateId}` as MessageKey;

/** An enemy's name for a counter over several of it, falling back to its own name. */
export function pluralName(templateId: string): string {
  const key = killPluralKey(templateId);
  return hasMessage(key) ? t(key) : enemyName(templateId);
}

/** "The Frozen Camp" → "the Frozen Camp", for use mid-sentence. */
function inSentence(name: string): string {
  return name.replace(/^The /, 'the ');
}

/** The noun a kill counter counts: one template's name, or the group's. */
export function killNoun(objective: Extract<Objective, { kind: 'kill' }>): string {
  if (objective.group) return objectiveGroupName(objective.group);
  const [only, ...rest] = objective.templates;
  if (rest.length === 0) return objective.count === 1 ? enemyName(only) : pluralName(only);
  return objective.templates.map(pluralName).join(' / ');
}

export function objectiveLabel(objective: Objective): string {
  switch (objective.kind) {
    case 'kill':
      return killNoun(objective);
    case 'collect':
      return resourceWord(objective.resource);
    case 'shrine':
      return objectiveVerbLabel('claim', shrineName(objective.index));
    case 'talk':
      return objectiveVerbLabel(objective.verb ?? 'speakWith', npcName(objective.npc));
    case 'reach':
      return objectiveVerbLabel(objective.verb ?? 'reach', inSentence(placeName(objective.location)));
    case 'investigate': {
      const site = questSite(objective.site);
      if (!site) return t('quests.label.searchSite');
      return objectiveVerbLabel(objective.verb ?? 'search', inSentence(siteName(objective.site)));
    }
    case 'clearPoi': {
      if (objective.site && questSite(objective.site)) {
        return objectiveVerbLabel(objective.verb ?? 'clear', inSentence(siteName(objective.site)));
      }
      if (objective.poi === POIType.QuestSite) return t('quests.label.clearWaypoints', { count: objective.count });
      return t('quests.label.clearPlaces', { kind: String(objective.poi).replace(/_/g, ' '), count: objective.count });
    }
  }
}
