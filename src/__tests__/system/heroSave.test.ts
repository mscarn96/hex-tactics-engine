import { readFileSync } from 'fs';
import path from 'path';
import { REPO_ROOT } from '../support/paths';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { Hero } from '@/models/types';
import { deriveHeroSkills } from '@/systems/progression/mastery';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import { loadHero, saveHero } from '@/systems/save/heroSave';
import { buildSimHero, defaultHeroConfig } from '@/systems/sim/simHarness';

/**
 * A hero is saved as their choices, and their kit is worked out again on load.
 *
 * `Hero.skills` is a cache of `deriveHeroSkills`. Saved verbatim it was stale on a
 * loaded save until a level-up re-derived it, unless `SAVE_VERSION` was bumped: a
 * tuning-only edit to a skill, or a node removed from a tree, reached nobody.
 */

const hero = (templateId: 'warrior' | 'mage' = 'warrior', level = 8): Hero =>
  buildSimHero(defaultHeroConfig(templateId, level), (item) => item.id, `h_${templateId}`)!;

describe('saving a hero', () => {
  it('writes the choices and the state, and no derived cache', () => {
    const saved = saveHero(hero());
    expect(Object.keys(saved).sort()).toEqual([
      'currentHp', 'currentMana', 'equipment', 'id', 'level', 'masteryNodes', 'masteryPath', 'masteryPoints',
      'name', 'templateId', 'xp',
    ].sort());
    expect(JSON.stringify(saved)).not.toContain('"skills"');
  });

  it('is plain data: it survives JSON', () => {
    const saved = saveHero(hero('mage', 12));
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
  });
});

describe('loading a hero', () => {
  it('derives the kit, the stats and the class from the saved choices (save, load, derive is the identity)', () => {
    for (const template of heroTemplates) {
      const original = hero(template.id as 'warrior', 9);
      const loaded = loadHero(JSON.parse(JSON.stringify(saveHero(original))))!;
      expect(loaded.skills).toEqual(deriveHeroSkills(original, template.skills));
      expect(loaded.skills.map((s) => s.id)).toEqual(original.skills.map((s) => s.id));
      expect(loaded.baseStats).toEqual(calculateStatsForLevel(template, 9));
      expect(loaded).toEqual({ ...original, skills: loaded.skills });
    }
  });

  it('shows a skill tuned after the save, with no level-up and no version bump', () => {
    const template = heroTemplates.find((t) => t.id === 'warrior')!;
    const original = hero('warrior', 8);
    const saved = JSON.parse(JSON.stringify(saveHero(original)));
    const baseline = template.skills.find((s) => original.skills.some((k) => k.id === s.id && s.damage))!;
    const before = baseline.damage!;
    try {
      baseline.damage = before + 7;
      const loaded = loadHero(saved)!;
      expect(loaded.skills.find((s) => s.id === baseline.id)!.damage).toBe(before + 7);
    } finally {
      baseline.damage = before;
    }
  });

  it('drops a hero whose template this build does not know', () => {
    const saved = { ...saveHero(hero()), templateId: 'a_class_that_was_cut' as never };
    expect(loadHero(saved)).toBeNull();
  });
});

describe('the writer', () => {
  it('stores no HeroSkill: persistence goes through saveHero and loadHero only', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'src/systems/save/persistence.ts'), 'utf8');
    expect(source).toContain('saveHero');
    expect(source).toContain('loadHero');
    expect(source).not.toMatch(/\bskills\b/);
    expect(source).not.toMatch(/heroes: partyState\.heroes[,\n]/);
  });
});
