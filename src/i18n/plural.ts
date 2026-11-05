import type { Locale, PluralCategories } from './catalog';

/**
 * Which plural form a count takes. Written out rather than read from
 * `Intl.PluralRules`, which Hermes does not ship on every platform; counts in
 * the game are whole numbers, so only the integer rules are needed.
 */
export const PLURAL_RULES: { [L in Locale]: (n: number) => PluralCategories[L] } = {
  en: (n) => (n === 1 ? 'one' : 'other'),
};
