import { DEFAULT_LOCALE, setLocale } from '@/i18n';
import { POIType } from '@/models/types';
import { QUESTS, QUEST_IDS } from '@/quests/questData';
import { QUEST_SITES } from '@/quests/sites';
import {
  objectiveGroupName, objectiveVerbLabel, questStageSummary, questSummary, questTitle, siteClue, siteName,
} from '@/quests/questText';
import { objectiveLabel } from '@/systems/quests/objectiveLabel';
import { catalogGaps } from '../support/catalogEntries';

/**
 * Quests and quest sites keep ids; their words are the `quests` namespace
 * (`src/quests/questText.ts`, the private project notes).
 */

afterEach(() => setLocale(DEFAULT_LOCALE));

const objectives = QUEST_IDS.flatMap((id) => QUESTS[id].stages.flatMap((s) => s.objectives));
/** The verbs each objective kind falls back to, plus every one a quest names. */
const verbs = [...new Set(['speakWith', 'reach', 'search', 'clear', 'claim',
  ...objectives.flatMap((o) => ('verb' in o && o.verb ? [o.verb] : []))])];
const groups = [...new Set(objectives.flatMap((o) => (o.kind === 'kill' && o.group ? [o.group] : [])))];

describe('quest text', () => {
  it('has every quest, stage, site, group and verb in every language, and nothing else', () => {
    const checks = [
      catalogGaps('quests', QUEST_IDS, ['title', 'summary']),
      catalogGaps('quests', QUEST_IDS.flatMap((id) => QUESTS[id].stages.map((_, i) => `${id}.stage.${i}`)), ['summary']),
      catalogGaps('quests', Object.keys(QUEST_SITES).map((id) => `site.${id}`), ['name', 'discovery']),
      catalogGaps('quests', groups.map((g) => `group.${g}`), ['name']),
      catalogGaps('quests', verbs.map((v) => `verb.${v}`), ['label']),
      catalogGaps('quests', ['label'], ['searchSite', 'clearWaypoints', 'clearPlaces', 'siteClue']),
    ];
    const missing = checks.flat().filter((gap) => gap.endsWith(' missing'));
    // An entry is an orphan only when no table wants it, so every check reports it.
    const orphans = checks[0].filter((gap) => gap.endsWith('has no data entry') && checks.every((c) => c.includes(gap)));
    expect([...missing, ...orphans]).toEqual([]);
  });
});
