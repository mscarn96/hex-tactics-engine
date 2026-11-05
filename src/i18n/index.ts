import { isPlural, type Locale } from './catalog';
import { en } from './locales/en';
import { DEFAULT_LOCALE, getLocale } from './locale';
import { PLURAL_RULES } from './plural';

export { DEFAULT_LOCALE, getLocale, setLocale, subscribeLocale } from './locale';
export { formatDecimal, formatNumber, formatPercent } from './format';

export type { Locale } from './catalog';

/**
 * Player-facing text. Pure — systems may call `t` as freely as components, and
 * the Node suites can import it. Components read it through `useT()`
 * (`src/hooks/useT.ts`) so they re-render when the language changes.
 *
 * Keys are `namespace.key`, e.g. `t('settings.tips.replay')`. Placeholders are
 * `{name}`; a plural entry takes `{ count }` and may use `{count}` in its text.
 * See the private project notes.
 */

type En = typeof en;
export type MessageKey = {
  [N in keyof En]: `${N & string}.${keyof En[N] & string}`;
}[keyof En];

export type MessageParams = Record<string, string | number>;

export const LOCALES: Record<Locale, { name: string; catalog: Record<string, unknown> }> = {
  en: { name: 'English', catalog: en },
};


function lookup(locale: Locale, key: string): unknown {
  const dot = key.indexOf('.');
  const ns = LOCALES[locale].catalog[key.slice(0, dot)] as Record<string, unknown> | undefined;
  return ns?.[key.slice(dot + 1)];
}

/** Whether `key` has text in English, the source catalog (and so in every language). */
export function hasMessage(key: string): boolean {
  return lookup(DEFAULT_LOCALE, key) !== undefined;
}

/** The text for `key` in `locale`, falling back to English. */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  let message = lookup(locale, key);
  let rules: Locale = locale;
  if (message === undefined) {
    message = lookup(DEFAULT_LOCALE, key);
    rules = DEFAULT_LOCALE;
  }
  if (message === undefined) return key;

  let text: string;
  if (isPlural(message)) {
    const count = Number(params?.count ?? 0);
    const form = (PLURAL_RULES[rules] as (n: number) => string)(count);
    text = message[form] ?? message.other;
  } else {
    text = String(message);
  }
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** The text for `key` in the current language. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(getLocale(), key, params);
}
