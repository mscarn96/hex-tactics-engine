import { hasMessage, t, type MessageKey } from '@/i18n';

/**
 * Display text for game data that more than one table holds: skills (hero,
 * enemy, boss and mastery skills live in different files and namespaces),
 * mastery paths and statuses. Each table's own text (items, units, quests, …)
 * has helpers beside that table instead.
 *
 * Every helper looks the words up when shown (see the private project notes,
 * "Data tables keep ids"). While the game-data feature moves text table by table,
 * an entry not yet in a catalog falls back to the field the data object still
 * carries; once every table is moved, the fallbacks and the fields go.
 */

type Source = readonly [namespace: string, prefix: string];

/** Where a skill's words can live, searched in order: `<ns>.<prefix><id>.<field>`. */
const SKILL_SOURCES: readonly Source[] = [
  ['skills', ''],
  ['enemySkills', ''],
  ['bossSkills', ''],
  ['masteryChampion', 'skill.'],
  ['masteryArcanist', 'skill.'],
  ['masteryHunter', 'skill.'],
  ['masteryDruid', 'skill.'],
  ['masteryMonk', 'skill.'],
];

/** Where a mastery path's words live: `<ns>.path.<id>.<field>`. */
const PATH_SOURCES: readonly Source[] = [
  ['masteryChampion', 'path.'],
  ['masteryArcanist', 'path.'],
  ['masteryHunter', 'path.'],
  ['masteryDruid', 'path.'],
  ['masteryMonk', 'path.'],
];

function findKey(sources: readonly Source[], id: string, field: string): MessageKey | null {
  for (const [ns, prefix] of sources) {
    const key = `${ns}.${prefix}${id}.${field}`;
    if (hasMessage(key)) return key as MessageKey;
  }
  return null;
}

function textFor(sources: readonly Source[], id: string, field: string, fallback: string | undefined): string {
  const key = findKey(sources, id, field);
  return key ? t(key) : fallback ?? '';
}

/** A skill's name, whichever table defines it. `textId` names its words when they are not its `id`'s. */
export function skillName(skill: { id: string; textId?: string; name?: string }): string {
  return textFor(SKILL_SOURCES, skill.textId ?? skill.id, 'name', skill.name);
}

/** A skill's one-line description, whichever table defines it. */
export function skillDescription(skill: { id: string; textId?: string; description?: string }): string {
  return textFor(SKILL_SOURCES, skill.textId ?? skill.id, 'description', skill.description);
}

/** Whether a skill's words are in the catalogs yet. */
export function hasSkillText(id: string): boolean {
  return findKey(SKILL_SOURCES, id, 'name') !== null;
}

/** A mastery path's name ("Bulwark" / "Bastion"). */
export function pathName(path: { id: string; name?: string }): string {
  return textFor(PATH_SOURCES, path.id, 'name', path.name);
}

/** A mastery path's description. */
export function pathDescription(path: { id: string; description?: string }): string {
  return textFor(PATH_SOURCES, path.id, 'description', path.description);
}

/** A status effect's name ("Burn" / "Podpalenie"): `statuses.<type>.name`. */
export function statusName(type: string, fallback?: string): string {
  return textFor([['statuses', '']], type, 'name', fallback);
}
