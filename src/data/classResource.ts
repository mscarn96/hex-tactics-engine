import { entryText } from '@/i18n/dataText';

/**
 * What a class casts from: mana for everyone, chi for the Monk.
 *
 * Chi is not a second pool. It *is* `maxMana` and `currentMana`, so every reader
 * of mana — the cost checks, the AI, rank discounts — keeps working; what changes
 * is the rule that fills it (`BALANCE.CHI`, `systems/combat/chi.ts`) and the word
 * the sheet, the HUD bar, the inspector and the float text print.
 *
 * Keyed by the class id as a string rather than by `HeroClass`, so the rule can
 * land before the class does: the Monk task adds `HeroClass.Monk = 'monk'` and
 * that class reads chi from then on. Design: the private project notes.
 * The words are in the `world` namespace, `resource.<mana|chi>.<field>`.
 */
export type ClassResource = 'mana' | 'chi';

const CHI_CLASSES: ReadonlySet<string> = new Set(['monk']);

/** The resource a hero class fills its pool with. */
export function classResource(heroClass: string | undefined): ClassResource {
  return heroClass !== undefined && CHI_CLASSES.has(heroClass) ? 'chi' : 'mana';
}

/** True when the class's pool is chi. */
export function usesChi(heroClass: string | undefined): boolean {
  return classResource(heroClass) === 'chi';
}

/** The class resources, for the catalog's parity test. */
export const CLASS_RESOURCES: readonly ClassResource[] = ['mana', 'chi'];

const resourceText = (resource: ClassResource | undefined, field: string): string =>
  entryText('world', `resource.${resource ?? 'mana'}`, field);

/** The short word beside a number: `40 MP`, `40 Chi` (`40 PM` in Polish). */
export function resourceShort(resource: ClassResource | undefined): string {
  return resourceText(resource, 'short');
}

/** The pool's regeneration as a stat label: `mana / turn`, `chi / turn`. */
export function resourcePerTurn(resource: ClassResource | undefined): string {
  return resourceText(resource, 'perTurn');
}

/** Why a cast is refused for want of the pool: `Not enough mana`. */
export function resourceLacking(resource: ClassResource | undefined): string {
  return resourceText(resource, 'lacking');
}
