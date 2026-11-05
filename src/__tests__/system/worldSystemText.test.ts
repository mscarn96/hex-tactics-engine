import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_LOCALE, hasMessage, setLocale } from '@/i18n';
import { campaign } from '@/i18n/locales/en/campaign';
import { economy } from '@/i18n/locales/en/economy';
import { progression } from '@/i18n/locales/en/progression';
import { worldEvents } from '@/i18n/locales/en/worldEvents';
import { THREAT_BANDS } from '@/systems/world/threat';
import { shapesAtBand } from '@/systems/world/encounterShapes';
import { CASTLE_STAGES, castleStageName } from '@/systems/world/castle';
import { MASTERY_ARMOUR_WEIGHT } from '@/data/items/itemForms';
import { campaignGoal } from '@/systems/quests/campaignGoal';
import { EXPANSION_WORLD_IDS } from '@/data/worlds';
import { questContext } from '@/systems/quests/quests';
import { gemStateText, mergeBenchText, socketRuleText } from '@/systems/economy/gemGuide';
import { wrathNewsText } from '@/systems/world/wrath';
import { canEquip, equipRefusalText } from '@/systems/progression/equipRules';
import { itemFromTemplateId } from '@/systems/economy/itemFactory';
import { HeroClass } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { SRC_DIR } from '../support/paths';

/**
 * The runtime sentences of the quest, economy, progression and world systems
 * (`campaign`, `economy`, `progression`, `worldEvents`): every entry is read
 * somewhere, the entries built from an id cover every id, and a few lines come
 * out in Polish after a switch. Placeholders matching across languages is
 * `localization.test.ts`'s.
 */

afterEach(() => setLocale(DEFAULT_LOCALE));

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) { if (name !== '__tests__' && name !== 'i18n') sources(full, out); }
    else if (/\.tsx?$/.test(name)) out.push(readFileSync(full, 'utf8'));
  }
  return out;
}

/** Keys read through a template from an id, checked below against the ids. */
const BUILT_FROM_IDS = ['campaign.killPlural.', 'campaign.goal.orbsRemain.', 'campaign.goal.road.', 'campaign.ivane.road.', 'worldEvents.shape.', 'worldEvents.castle.', 'progression.weight.'];

describe('runtime text of the world systems', () => {
  it('reads every entry somewhere', () => {
    const code = sources(SRC_DIR).join('\n');
    const keys = Object.entries({ campaign, economy, progression, worldEvents })
      .flatMap(([ns, entries]) => Object.keys(entries).map((key) => `${ns}.${key}`));
    const unread = keys.filter((key) => !BUILT_FROM_IDS.some((prefix) => key.startsWith(prefix)) && !code.includes(`'${key}'`));
    expect(unread).toEqual([]);
  });

  it('has Ivane and the goal name a road for every world beyond the Empire', () => {
    for (const world of EXPANSION_WORLD_IDS) expect(campaign).toHaveProperty([`ivane.road.${world}`]);
    for (const world of EXPANSION_WORLD_IDS.filter((id) => id !== 'jadeveil')) expect(campaign).toHaveProperty([`goal.road.${world}.next`]);
    for (const left of [1, 2, 3, 4]) expect(campaign).toHaveProperty([`goal.orbsRemain.${left}`]);
  });

  it('names every encounter shape, castle stage and armour weight', () => {
    const shapes = new Set(THREAT_BANDS.flatMap((band) => shapesAtBand(band).map((s) => s.id)));
    const weights = new Set(Object.values(MASTERY_ARMOUR_WEIGHT));
    const wanted = [
      ...[...shapes].map((id) => `worldEvents.shape.${id}`),
      ...CASTLE_STAGES.flatMap((s) => [`worldEvents.castle.${s.id}.name`, `worldEvents.castle.${s.id}.blurb`]),
      ...[...weights].map((w) => `progression.weight.${w}`),
    ];
    expect(wanted.filter((key) => !hasMessage(key))).toEqual([]);
    const built = [
      ...Object.keys(worldEvents).filter((k) => k.startsWith('shape.') || k.startsWith('castle.')).map((k) => `worldEvents.${k}`),
      ...Object.keys(progression).filter((k) => k.startsWith('weight.')).map((k) => `progression.${k}`),
    ];
    expect(built.filter((key) => !wanted.includes(key))).toEqual([]);
  });
});
