/**
 * The shape every locale catalog shares. English is the source: each namespace
 * is written in English first (`locales/en/`), and every other language's
 * namespace is typed `Translation<typeof en…, 'xx'>`, so a missing or extra key
 * — or a Polish plural without all its forms — is a typecheck error, not a
 * blank on screen. Placeholder parity is held by `localization.test.ts`.
 */

/** Plural categories each language needs, after CLDR (integer counts only). */
export interface PluralCategories {
  en: 'one' | 'other';
}

export type Locale = keyof PluralCategories;

/** An English plural entry. `t(key, { count })` picks the form. */
export interface Plural {
  one: string;
  other: string;
}

export type PluralFor<L extends Locale> = Record<PluralCategories[L], string>;

/** One namespace of messages: a flat map from key to text or plural forms. */
export type Namespace = Record<string, string | Plural>;

/** The same keys as an English namespace, with that language's plural forms. */
export type Translation<N extends Namespace, L extends Locale> = {
  [K in keyof N]: N[K] extends string ? string : PluralFor<L>;
};

export function isPlural(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && 'other' in value;
}
