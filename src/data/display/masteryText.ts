import { hasMessage, t, type MessageKey } from '@/i18n';
import { pathDescription, skillDescription } from '@/data/gameText';
import type { HeroSkill, MasteryRole } from '@/models/types';

/**
 * Display text for the mastery trees: a node's name and description, a path's
 * tagline, a node's prerequisite line and a party role's word.
 *
 * The trees keep ids (the private project notes, "Data tables keep ids");
 * the words live in one namespace per class — `masteryChampion`,
 * `masteryArcanist`, `masteryHunter`, `masteryDruid`, `masteryMonk` — under
 * `node.<id>.<field>` and `path.<id>.<field>`, and the shared lines in
 * `masteryCommon`. A node is looked up in every class namespace rather than
 * through its path, so a caller holding only the node needs nothing else.
 *
 * While the classes move one at a time, a node whose words are not in a catalog
 * yet falls back to the field its data object still carries.
 */
const CLASS_NAMESPACES = ['masteryChampion', 'masteryArcanist', 'masteryHunter', 'masteryDruid', 'masteryMonk'] as const;

function classKey(kind: 'node' | 'skill', id: string, field: string): MessageKey | null {
  for (const ns of CLASS_NAMESPACES) {
    const key = `${ns}.${kind}.${id}.${field}`;
    if (hasMessage(key)) return key as MessageKey;
  }
  return null;
}

function nodeText(node: { id: string }, field: string, fallback: string | undefined): string {
  const key = classKey('node', node.id, field);
  return key ? t(key) : fallback ?? '';
}

/** A mastery node's name ("Spite" / "Zawziętość"). */
export function masteryNodeName(node: { id: string; name?: string }): string {
  return nodeText(node, 'name', node.name);
}

/** A mastery node's one-line description. */
export function masteryNodeDescription(node: { id: string; description?: string }): string {
  return nodeText(node, 'description', node.description);
}

/** A path's tagline, shown on the irreversible choice: `path.<id>.description`. */
export function masteryPathTagline(path: { id: string; tagline?: string }): string {
  return pathDescription({ id: path.id, description: path.tagline });
}

/**
 * The prerequisite line a node shows in place of naming its parents.
 * `MasteryNode.requiresLabel` holds an id from `masteryCommon.requires.*`; a
 * tree not yet moved still holds the English line, which is shown as it is.
 * `level` is the level the node itself opens at, which the advanced line names.
 */
export function masteryRequiresLabel(label: string, level: number): string {
  const key = `masteryCommon.requires.${label}`;
  return hasMessage(key) ? t(key as MessageKey, { level }) : label;
}

/** A party role's word ("Tank", "Support"). */
export function masteryRoleLabel(role: MasteryRole): string {
  return t(`masteryCommon.role.${role}` as MessageKey);
}

/**
 * A skill's description at the stage it is in: a charged skill's release
 * (`HeroSkill.releasing`, from `chargeStage`) reads `skill.<id>.release` where a
 * mastery catalog has one, and every other skill reads its own description.
 */
export function skillStageDescription(skill: Pick<HeroSkill, 'id' | 'description' | 'releasing'>): string {
  if (skill.releasing) {
    const key = classKey('skill', skill.id, 'release');
    if (key) return t(key);
  }
  return skillDescription(skill);
}
