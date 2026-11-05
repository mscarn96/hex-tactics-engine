import { t } from '@/i18n';

/**
 * How a floating number says it was a critical hit.
 *
 * Every crit in the rules is floated as `-N!` — the player's resolver, the AI's,
 * a poison pop, a corpse's burst — so the `!` is the one mark both paths and the
 * store's own events already agree on. The arena turns it into a bigger number
 * with a small **CRITICAL** above it (`FloatingTextItem`); this is where the mark
 * is read, so the picture never has to know which rule floated it.
 */

const CRIT_FLOAT = /^([+-]?\d+)!$/;

/** The label drawn over a critical number, in the current language. */
export const critLabel = (): string => t('combatLog.float.critical');

/** A float's text as drawn, and whether it was a crit: `-12!` is `{ text: '-12', crit: true }`. */
export function readFloat(text: string, crit?: boolean): { text: string; crit: boolean } {
  const m = CRIT_FLOAT.exec(text);
  if (m) return { text: m[1], crit: true };
  return { text, crit: !!crit };
}

/** The text a crit is floated as, from either side of the fight. */
export const critText = (damage: number, crit: boolean | undefined): string => (crit ? `-${damage}!` : `-${damage}`);
