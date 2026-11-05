import { formatDecimal, formatNumber, formatPercent, setLocale, DEFAULT_LOCALE } from '@/i18n';
import { formatDate } from '@/i18n/dates';
import { agree, composeName } from '@/i18n/grammar';
import { ACHIEVEMENTS, achievementCondition, achievementName } from '@/data/achievements';
import { catalogGaps } from '../support/catalogEntries';

/**
 * The foundations every extraction builds on: numbers written per language,
 * Polish adjective agreement for generated names, and data text read by id.
 * See the private project notes.
 */

afterEach(() => setLocale(DEFAULT_LOCALE));

describe('data text by id (achievements, the worked example)', () => {
  it('has every field of every entry in every language, and nothing else', () => {
    expect(catalogGaps('achievements', ACHIEVEMENTS.map((a) => a.id), ['name', 'flavour', 'condition'])).toEqual([]);
  });
});
