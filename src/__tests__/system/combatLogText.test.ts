import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from '../support/paths';
import { DEFAULT_LOCALE, setLocale } from '@/i18n';
import { combatLog } from '@/i18n/locales/en/combatLog';
import { dodgeText } from '@/data/display/statusDisplay';
import { flankFloat } from '@/data/display/flankDisplay';
import { critLabel } from '@/utils/floatText';
import { extraTurnNotice } from '@/systems/combat/turnTempo';
import { reactionSummary } from '@/systems/combat/reactions';
import { deploymentPerk } from '@/systems/combat/deployment';
import { rootedRefusal } from '@/systems/combat/skillAvailability';
import type { HeroSkill } from '@/models/types';

/**
 * The general combat engine's runtime text (`combatLog`): every entry is read by
 * some call site, and the lines render in Polish once the language is switched.
 * Placeholders matching across languages is `localization.test.ts`'s; lengths
 * are `combatTextLength.test.ts`'s.
 */

afterEach(() => setLocale(DEFAULT_LOCALE));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' || entry === 'locales' ? [] : walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const SOURCE = walk(SRC_DIR).map((f) => readFileSync(f, 'utf8')).join('\n');

describe('combatLog catalog', () => {
  it('has no entry that nothing reads', () => {
    const unread = Object.keys(combatLog).filter((key) => !SOURCE.includes(`'combatLog.${key}'`));
    expect(unread).toEqual([]);
  });

  it('writes the floats in English by default', () => {
    expect(dodgeText()).toBe('DODGED');
    expect(critLabel()).toBe('CRITICAL');
    expect(flankFloat('front')).toBeUndefined();
    expect(flankFloat('back')).toMatch(/^BACK ×\d/);
  });
});
