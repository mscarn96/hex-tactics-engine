import type { Hero } from '@/models/types';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { deriveHeroSkills } from '@/systems/progression/mastery';
import { calculateStatsForLevel } from '@/systems/progression/leveling';

/**
 * A hero as the save file holds them: the choices and the state, never what is
 * worked out from them.
 *
 * `skills` (the kit `deriveHeroSkills` builds from the template, the level and the
 * mastery tree), `baseStats` (the template's growth at this level) and `heroClass`
 * are all functions of `{ templateId, level, masteryPath, masteryNodes }`. Saved
 * verbatim they went stale the moment the data behind them changed: a tuning-only
 * edit to a skill reached a loaded hero only at their next level-up, unless someone
 * remembered to bump `SAVE_VERSION`, and a node removed from a tree lingered in
 * every existing kit. So the file stores the inputs and `loadHero` derives the rest.
 */
export type SavedHero = Omit<Hero, 'skills' | 'baseStats' | 'heroClass'>;

/** The hero's choices and state: everything but what is derived from them. */
export function saveHero(hero: Hero): SavedHero {
  const { skills: _skills, baseStats: _baseStats, heroClass: _heroClass, ...choices } = hero;
  return choices;
}

/**
 * Builds the hero the saved choices describe, from the data as it stands now.
 * `null` for a template this build does not know, which the caller drops.
 */
export function loadHero(saved: SavedHero): Hero | null {
  const template = heroTemplates.find((t) => t.id === saved.templateId);
  if (!template) return null;
  return {
    ...saved,
    heroClass: template.heroClass,
    baseStats: calculateStatsForLevel(template, saved.level),
    skills: deriveHeroSkills(saved, template.skills),
  };
}
