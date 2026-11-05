import { hasMessage, t, type MessageKey } from '@/i18n';
import { entryText } from '@/i18n/dataText';
import type { CombatUnit, WildFormId } from '@/models/types';

/**
 * Display names for everything that stands on a battlefield, read from the `units`
 * namespace when shown (the private project notes, "Data tables keep ids").
 *
 * Hero classes, enemies, bosses and summons share one key space, `<templateId>.name`:
 * their template ids never collide. Wildshape forms live under `form.<id>` (a form
 * and an enemy may both be a "wolf"), arena objectives under `objective.<kind>`.
 */

/**
 * A hero class, enemy, boss or summon template's name: "Champion", "Goblin Whelp".
 * An id with no entry comes back as `fallback`, or as the id itself.
 */
export function templateName(templateId: string, fallback?: string): string {
  const key = `units.${templateId}.name`;
  return hasMessage(key) ? t(key as MessageKey) : fallback ?? templateId;
}

/** An arena objective's name by kind ("Imperial Standard"), or `fallback` when it has none. */
export function objectiveName(kind: string, fallback?: string): string {
  const key = `units.objective.${kind}.name`;
  return hasMessage(key) ? t(key as MessageKey) : fallback ?? kind;
}

type NamedUnit = Pick<CombatUnit, 'name' | 'isPlayer'>
  & Partial<Pick<CombatUnit, 'templateId' | 'summonedBy' | 'objective' | 'nameIndex'>>;

/**
 * What a combat unit is called on screen. A hero is their own, player-chosen name;
 * an enemy, boss or summon is its template's catalog name in the current language
 * (numbered when it was fielded with others of its kind); an objective is its
 * kind's name, numbered the same way. Anything the catalogs do not know keeps the name it spawned with.
 */
export function unitName(unit: NamedUnit): string {
  if (unit.isPlayer && !unit.summonedBy && !unit.objective) return unit.name;
  const base = unit.objective
    ? objectiveName(unit.objective.kind, unit.name)
    : unit.templateId ? templateName(unit.templateId, unit.name) : unit.name;
  return unit.nameIndex ? t('units.numbered', { name: base, number: unit.nameIndex }) : base;
}

/** A Wildshape form's name: "Bear" / "Niedźwiedź". */
export const wildFormName = (id: WildFormId) => entryText('units', `form.${id}`, 'name');
/** A Wildshape form's description, shown in the unit dialog while worn. */
export const wildFormDescription = (id: WildFormId) => entryText('units', `form.${id}`, 'description');
/** What the shape a Druid started in is called, on the shift-back button. */
export const humanFormName = () => entryText('units', 'form.human', 'name');

/** A bestiary role label: a faction role (`chaff`, `front`, …), `lairBoss`, `emperor` or `summoned`. */
export const roleName = (role: string) => entryText('units', `role.${role}`, 'name');
/** A bestiary tier label: `normal`, `elite`, `boss` or `summon`. */
export const tierName = (tier: string) => entryText('units', `tier.${tier}`, 'name');
