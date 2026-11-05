import { t, type MessageKey, type MessageParams } from './index';
import type { en } from './locales/en';

/**
 * Display text for an entry in a data table.
 *
 * Data tables keep ids, not text: an achievement, skill or item template has an
 * `id`, and the words for it live in that table's namespace under
 * `<id>.<field>` — `achievements['still-standing.name']`. Each table wraps this
 * in a named helper (`achievementName(id)`, `skillName(id)`, …) so callers never
 * build keys themselves.
 *
 * The lookup happens when the text is shown, in the current language, so a
 * language change is followed. Never store the result on a data object or in a
 * module-level constant. A component that shows such text must re-render on a
 * language change: it calls `useT()` or `useLocale()` (`src/hooks/useT.ts`).
 *
 * An id with no entry comes back as its key (`achievements.x.name`), which a
 * table's own test catches; see `missingEntries` in the test support.
 */
export type TableNamespace = keyof typeof en;

export function entryKey(ns: TableNamespace, id: string, field: string): MessageKey {
  return `${ns}.${id}.${field}` as MessageKey;
}

export function entryText(ns: TableNamespace, id: string, field: string, params?: MessageParams): string {
  return t(entryKey(ns, id, field), params);
}
