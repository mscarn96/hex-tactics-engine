import { t } from '@/i18n';
import { entryText } from '@/i18n/dataText';
import type { QuestSiteId } from './sites';
import type { ObjectiveGroup, ObjectiveVerb, QuestId } from './types';

/**
 * A quest's and a quest site's words, read from the `quests` namespace when
 * shown (see the private project notes, "Data tables keep ids"). The
 * tables in `questData.ts` and `sites.ts` keep ids only. A component that calls
 * one of these calls `useT()` or `useLocale()`, so it follows a language change.
 */

/** "Wolves at the Gate" / "Wilki u bram". */
export function questTitle(id: QuestId): string {
  return entryText('quests', id, 'title');
}

/** The one line shown before a quest is accepted. */
export function questSummary(id: QuestId): string {
  return entryText('quests', id, 'summary');
}

/** What the log says while `stage` is the current one. */
export function questStageSummary(id: QuestId, stage: number): string {
  return entryText('quests', `${id}.stage.${stage}`, 'summary');
}

/** A named quest site's name, as the map and objectives call it. */
export function siteName(id: QuestSiteId): string {
  return entryText('quests', `site.${id}`, 'name');
}

/** What a peaceful site tells the party when they search it. */
export function siteDiscovery(id: QuestSiteId): string {
  return entryText('quests', `site.${id}`, 'discovery');
}

/** The line a searched site shows: its name, then what was found. */
export function siteClue(id: QuestSiteId): string {
  return t('quests.label.siteClue', { name: siteName(id), discovery: siteDiscovery(id) });
}

/** The noun a kill counter over several templates counts ("Wolves"). */
export function objectiveGroupName(group: ObjectiveGroup): string {
  return entryText('quests', `group.${group}`, 'name');
}

/** An objective's whole line: the verb's pattern with `name` (nominative) filled in. */
export function objectiveVerbLabel(verb: ObjectiveVerb, name: string): string {
  return entryText('quests', `verb.${verb}`, 'label', { name });
}
