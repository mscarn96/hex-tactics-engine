import type { Locale } from './catalog';

/**
 * The current language, and who to tell when it changes. Its own module so
 * the formatters and grammar helpers can read it without importing the
 * catalogs. `@/i18n` re-exports all of it.
 */

export const DEFAULT_LOCALE: Locale = 'en';

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  for (const listener of listeners) listener();
}

/** Called after every language change. Returns the unsubscribe. */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
