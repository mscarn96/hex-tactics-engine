import { DEFAULT_LOCALE, LOCALES, setLocale, type Locale } from '@/i18n';
import { skillDescription, skillName } from '@/data/gameText';
import * as skillData from '@/data/skills/skillData';
import * as eliteSkills from '@/data/skills/eliteSkills';
import * as factionEliteSkills from '@/data/skills/factionEliteSkills';
import * as fallenOrderSkills from '@/data/skills/fallenOrderSkills';
import * as yokaiSkills from '@/data/skills/yokaiSkills';
import * as draconicHostSkills from '@/data/skills/draconicHostSkills';
import { ALL_SKILLS } from '@/data/skills/skillData';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { BALANCE } from '@/data/balanceConstants';
import { nodeSimpleText, SIMPLE_PASSIVE_IDS, SIMPLE_SKILL_IDS, skillSimpleText } from '@/data/display/simpleText';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { describeSkill, skillEffectLines, skillStatLine } from '@/data/display/skillDisplay';
import { HeroSkill } from '@/models/types';
import { catalogGaps } from '../support/catalogEntries';
import { makeUnit } from '../support/fixtures';

/**
 * The skill text catalogs: every hero, shared and enemy skill in this area has
 * its name and description in both languages, every Simple line is written,
 * and the sentences built from the skills come out whole in Polish — no
 * missing key, no unfilled placeholder.
 */

afterEach(() => setLocale(DEFAULT_LOCALE));

/** Every skill object a module defines, nested ones (a reaction's answer, a prepared release) included. */
function skillsIn(mod: Record<string, unknown>): HeroSkill[] {
  const found = new Map<string, HeroSkill>();
  const seen = new Set<unknown>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const v = value as Record<string, unknown>;
    if (typeof v.id === 'string' && 'targetType' in v) found.set(v.id, v as unknown as HeroSkill);
    Object.values(v).forEach(walk);
  };
  Object.values(mod).forEach(walk);
  return [...found.values()];
}

const ids = (skills: HeroSkill[]) => [...new Set(skills.map((s) => s.id))];
const HERO_SKILLS = skillsIn(skillData);
const ENEMY_SKILLS = [eliteSkills, factionEliteSkills, fallenOrderSkills, yokaiSkills, draconicHostSkills]
  .flatMap((mod) => skillsIn(mod as Record<string, unknown>));

describe('skill names and descriptions', () => {
  it('cover every hero and shared skill, with no orphans', () => {
    // The Basic Attack is built per weapon (`basicAttackWith`): its name is a catalog entry, its description is not
    expect(catalogGaps('skills', ids(HERO_SKILLS), ['name', 'description'], ['basic_attack.name'])).toEqual([]);
  });

  it('cover every elite and faction skill, with no orphans', () => {
    expect(catalogGaps('enemySkills', ids(ENEMY_SKILLS), ['name', 'description'])).toEqual([]);
  });

  // The numbers in these sentences are tuning constants written into the
  // catalog; a retune must rewrite the sentence in every language
  it('keep the numbers written into a description in step with the tuning', () => {
    const O = BALANCE.FALLEN_ORDER;
    const meditate = skillDescription(skillData.meditate);
    expect(meditate).toContain(`+${BALANCE.MEDITATE.PHYSICAL_DEFENSE} Physical and +${BALANCE.MEDITATE.MAGIC_DEFENSE} Magic Defense`);
    expect(meditate).toContain(`${BALANCE.CHI.MEDITATE_REFILL} chi now`);
    expect(meditate).toContain(`heal ${Math.round(BALANCE.MEDITATE.HEAL_SHARE * 100)}%`);
    expect(meditate).toContain(`+${BALANCE.MEDITATE.ATTACK} Attack and +${BALANCE.MEDITATE.MAGIC} Magic`);
    expect(skillDescription(fallenOrderSkills.wardenBastion)).toContain(`for ${O.BASTION_TURNS} turns`);
    expect(skillDescription(fallenOrderSkills.lanternHymn)).toContain(`within ${O.HYMN_RADIUS} hexes`);
    expect(skillDescription(fallenOrderSkills.lanternHymn)).toContain(`for ${O.HYMN_TURNS} turns`);
    expect(skillDescription(fallenOrderSkills.abbotVow)).toContain(`For ${O.VOW_TURNS} turns`);
    expect(skillDescription(fallenOrderSkills.abbotVow)).toContain(`within ${O.VOW_REACH} hexes`);
    expect(skillDescription(fallenOrderSkills.abbotVow)).toContain(`Up to ${O.VOW_ANSWERS} a round`);
    expect(skillDescription(fallenOrderSkills.tollOfPassing)).toContain(`In ${O.TOLL_TURNS - 1} turns`);
    expect(skillDescription(fallenOrderSkills.greatRing)).toContain(`within ${O.RING_RADIUS} hexes`);
  });
});

describe('skill sentences', () => {
  const catalog = (l: Locale) => LOCALES[l].catalog.skillText as Record<string, unknown>;

  it('write a Simple line for every skill and passive the tables name, and nothing else', () => {
    const known = [...SIMPLE_SKILL_IDS, ...SIMPLE_PASSIVE_IDS];
    const keys = Object.keys(catalog('en')).filter((k) => k.startsWith('simple.'));
    const shared = new Set(['simple.gives', 'simple.sentence', 'simple.bladesCap']);
    const orphans = keys.filter((k) => !shared.has(k) && !known.includes(k.split('.')[1]));
    const unwritten = known.filter((id) => !keys.some((k) => k === `simple.${id}` || k.startsWith(`simple.${id}.`)));
    expect({ orphans, unwritten }).toEqual({ orphans: [], unwritten: [] });
  });

  it('come out whole in every language for every skill, with and without a caster', () => {
    const every = [...ALL_SKILLS, ...MASTERY_SKILLS, ...ENEMY_SKILLS];
    const caster = makeUnit({});
    for (const locale of Object.keys(LOCALES) as Locale[]) {
      setLocale(locale);
      const broken: string[] = [];
      for (const skill of every) {
        const texts = [
          describeSkill(skill), describeSkill(skill, caster), skillStatLine(skill),
          ...skillEffectLines(skill), ...skillEffectLines(skill, caster),
          skillSimpleText(skill) ?? '', skillSimpleText(skill, caster) ?? '',
        ];
        for (const text of texts) {
          if (/skillText\.|\{\w+\}|undefined|NaN/.test(text)) broken.push(`${locale}:${skill.id}: ${text}`);
        }
      }
      expect(broken).toEqual([]);
    }
  });

  it('come out whole in every language for every mastery node at every rank', () => {
    for (const locale of Object.keys(LOCALES) as Locale[]) {
      setLocale(locale);
      const broken = MASTERY_PATHS.flatMap((path) => path.nodes).flatMap((node) => [1, 2, 3]
        .map((level) => nodeSimpleText(node, level) ?? '')
        .filter((text) => /skillText\.|\{\w+\}|undefined|NaN/.test(text))
        .map((text) => `${locale}:${node.id}: ${text}`));
      expect(broken).toEqual([]);
    }
  });
});
