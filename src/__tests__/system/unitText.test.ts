import { DEFAULT_LOCALE, LOCALES, setLocale } from '@/i18n';
import type { TableNamespace } from '@/i18n/dataText';
import { HeroClass, BuildingType, type CombatUnit } from '@/models/types';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { summonTemplates } from '@/data/templates/summonTemplates';
import { WILD_FORM_IDS } from '@/data/templates/wildForms';
import { FACTIONS, factionName, factionTagline } from '@/data/templates/factions';
import { waveAnnounce, wavesForPlan } from '@/data/templates/encounterWaves';
import { buildingData, buildingName } from '@/data/templates/buildingData';
import { AETHELRED_PASSIVES, AETHELRED_PHASES, AETHELRED_SKILLS, overturn, foreclosure, foreclosureFinal } from '@/data/templates/aethelred';
import { KAIREN_FOLLOW_UPS, KAIREN_PASSIVES, KAIREN_PHASES, KAIREN_TEMPEST_SKILLS, KAIREN_THUNDER_SKILLS, KAIREN_GALE_SKILLS } from '@/data/templates/kairen';
import { TROLL_PASSIVES, TROLL_PHASES, TROLL_SKILLS } from '@/data/templates/trollChieftain';
import { DRAGON_FOLLOW_UPS, DRAGON_PARTY_ACTIONS, DRAGON_SKILLS } from '@/data/templates/emeraldDragon';
import { HEART_CHAINED_SKILLS, HEART_FOLLOW_UPS, HEART_PASSIVES, HEART_PHASES, HEART_UNBOUND_SKILLS } from '@/data/templates/heartOfWinter';
import { JOROGUMO_PASSIVES, JOROGUMO_PHASES } from '@/data/templates/jorogumoWeaver';
import { LESSON_FOLLOW_UPS, LESSON_ORDER, LESSON_PASSIVES, LESSON_PHASES, LESSON_SKILLS } from '@/data/templates/lastLesson';
import { templateName, unitName, wildFormName } from '@/data/templates/unitText';
import { lessonRule, phaseName, TARGET_RULE_IDS } from '@/data/templates/bossText';
import { skillDescription, skillName } from '@/data/gameText';
import { heroClassName } from '@/data/display/heroDisplay';
import { buildBestiary } from '@/systems/bestiary';
import { levelPerk } from '@/systems/economy/cityServices';
import { catalogGaps } from '../support/catalogEntries';

/**
 * The game data of the units area reads from the catalogs: hero classes, enemies,
 * bosses, summons, Wildshape forms and objectives (`units`), the bosses' own kits
 * (`bossSkills`), factions and waves (`factions`) and the city's buildings
 * (`buildings`). See the private project notes, "Data tables keep ids".
 */

afterEach(() => setLocale(DEFAULT_LOCALE));

type Group = readonly [ids: readonly string[], fields: readonly string[]];

/**
 * `catalogGaps` over a namespace whose tables have different fields: every group's
 * entries exist in every language, and the namespace holds nothing beyond the
 * groups and the named free-standing keys.
 */
function gapsOver(ns: TableNamespace, groups: readonly Group[], loose: readonly string[] = []): string[] {
  const wanted = new Set([...groups.flatMap(([ids, fields]) => ids.flatMap((id) => fields.map((f) => `${id}.${f}`))), ...loose]);
  const missing = groups.flatMap(([ids, fields]) => catalogGaps(ns, ids, fields)).filter((gap) => gap.endsWith(' missing'));
  const orphans = catalogGaps(ns, [], []).filter((gap) => !wanted.has(gap.slice(gap.indexOf('.') + 1, -' has no data entry'.length)));
  const looseMissing = Object.keys(LOCALES).flatMap((locale) => loose
    .filter((key) => !(key in ((LOCALES[locale as keyof typeof LOCALES].catalog as Record<string, Record<string, unknown>>)[ns] ?? {})))
    .map((key) => `${locale}:${ns}.${key} missing`));
  return [...missing, ...orphans, ...looseMissing];
}

const BOSS_SKILLS = [
  ...AETHELRED_SKILLS, overturn,
  ...KAIREN_GALE_SKILLS, ...KAIREN_THUNDER_SKILLS, ...KAIREN_TEMPEST_SKILLS, ...KAIREN_FOLLOW_UPS,
  ...TROLL_SKILLS, ...DRAGON_SKILLS, ...DRAGON_FOLLOW_UPS, ...DRAGON_PARTY_ACTIONS,
  ...HEART_CHAINED_SKILLS, ...HEART_UNBOUND_SKILLS, ...HEART_FOLLOW_UPS,
  ...LESSON_SKILLS, ...LESSON_FOLLOW_UPS,
];
const PASSIVES = [AETHELRED_PASSIVES, KAIREN_PASSIVES, TROLL_PASSIVES, HEART_PASSIVES, JOROGUMO_PASSIVES, LESSON_PASSIVES].flat();
const PHASES = [AETHELRED_PHASES, KAIREN_PHASES, TROLL_PHASES, HEART_PHASES, JOROGUMO_PHASES, LESSON_PHASES].flat();
const unique = (ids: readonly string[]) => [...new Set(ids)];

/** Every wave the encounter rules can bring, gathered from the rules themselves. */
const WAVE_IDS = unique([
  ...wavesForPlan('quest_greywater', { enemies: [], factionId: null }),
  ...wavesForPlan('quest_thicket', { enemies: [], factionId: null }),
  ...wavesForPlan('quest_overseers_cut', { enemies: [], factionId: 'delve' }),
  ...wavesForPlan('chest_guard', { enemies: ['brigand_captain'], factionId: 'brigands' }),
  ...wavesForPlan('wander', { enemies: ['brigand_captain'], factionId: 'brigands' }),
  ...wavesForPlan('wander', { enemies: ['giant_spider', 'giant_spider'], factionId: 'beasts' }),
].map((wave) => wave.id));

describe('units', () => {
  it('names every hero class, enemy, boss, summon, form, objective, role and tier in every language', () => {
    expect(gapsOver('units', [
      [unique([...heroTemplates, ...enemyTemplates, ...summonTemplates].map((t) => t.id)), ['name']],
      [WILD_FORM_IDS.map((id) => `form.${id}`), ['name', 'description']],
      [['form.human'], ['name']],
      [['objective.imperial_standard', 'objective.furnace_heart', 'objective.rampart', 'objective.ice_spire', 'objective.jade_shard', 'objective.blood_iron_anchor', 'objective.briarSeed', 'objective.jorogumoThread', 'objective.glacialTomb', 'objective.jorogumoWeb', 'objective.soulFragment'], ['name']],
      [['chaff', 'front', 'ranged', 'caster', 'elite', 'lairBoss', 'emperor', 'summoned'].map((r) => `role.${r}`), ['name']],
      [['normal', 'elite', 'boss', 'summon'].map((r) => `tier.${r}`), ['name']],
    ], ['numbered'])).toEqual([]);
  });

  it('keeps template ids from colliding, so one key space serves them all', () => {
    const ids = [...heroTemplates, ...enemyTemplates, ...summonTemplates].map((t) => t.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe('bossSkills', () => {
  it('has every boss skill, passive, phase and lesson in every language', () => {
    expect(gapsOver('bossSkills', [
      [unique(BOSS_SKILLS.map((s) => s.textId ?? s.id)), ['name', 'description']],
      [unique(PASSIVES.map((p) => `passive.${p.id}`)), ['name', 'description']],
      [unique(PHASES.map((p) => `phase.${p.id}`)), ['name', 'announce', 'rule']],
      [LESSON_ORDER.map((id) => `lesson.${id}`), ['name', 'rule']],
      [[...TARGET_RULE_IDS], ['target']],
    ], ['lesson.repeatRule', 'lesson.teaches', 'parried', 'heart.anchorFeed'])).toEqual([]);
  });

  it('reads the final Foreclosure apart from the first, by its text id', () => {
    expect(foreclosureFinal.id).toBe(foreclosure.id);
    expect(skillName(foreclosureFinal)).toBe(skillName(foreclosure));
    expect(skillDescription(foreclosureFinal)).not.toBe(skillDescription(foreclosure));
    expect(skillDescription(foreclosureFinal)).toMatch(/^The phase-two rule returns/);
  });
});

describe('factions and buildings', () => {
  it('names every faction and announces every wave in every language', () => {
    expect(WAVE_IDS.length).toBeGreaterThan(5);
    expect(gapsOver('factions', [
      [[...FACTIONS.map((f) => f.id), 'other'], ['name', 'tagline']],
      [WAVE_IDS.map((id) => `wave.${id}`), ['announce']],
    ])).toEqual([]);
  });

  it('names and describes every building, and words each level’s perk', () => {
    expect(gapsOver('buildings', [[buildingData.map((b) => b.type), ['name', 'description']]], [
      'perk.barracks', 'perk.shop', 'perk.forge.common', 'perk.forge.rare', 'perk.forge.epic', 'perk.forge.legendary',
      'perk.forge.sets', 'perk.market', 'perk.library', 'perk.tavern.none', 'perk.next',
    ])).toEqual([]);
  });
});

describe('the bestiary', () => {
  it('has every entry’s name in every language', () => {
    const entries = buildBestiary().flatMap((f) => f.entries);
    expect(catalogGaps('units', entries.map((e) => e.id), ['name']).filter((gap) => gap.endsWith(' missing'))).toEqual([]);
  });
});
