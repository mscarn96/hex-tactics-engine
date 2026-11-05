import { LOCALES, type Locale } from '@/i18n';
import type { TableNamespace } from '@/i18n/dataText';

/**
 * Parity between a data table and its catalog namespace, for each table's own
 * test: every id has every field in every language, and the namespace holds no
 * entry for an id the table no longer has.
 */
export function catalogGaps(
  ns: TableNamespace, ids: readonly string[], fields: readonly string[], extraKeys: readonly string[] = [],
): string[] {
  const gaps: string[] = [];
  const wanted = new Set([...ids.flatMap((id) => fields.map((f) => `${id}.${f}`)), ...extraKeys]);
  for (const locale of Object.keys(LOCALES) as Locale[]) {
    const entries = (LOCALES[locale].catalog as Record<string, Record<string, unknown>>)[ns] ?? {};
    for (const key of wanted) if (!(key in entries)) gaps.push(`${locale}:${ns}.${key} missing`);
    for (const key of Object.keys(entries)) if (!wanted.has(key)) gaps.push(`${locale}:${ns}.${key} has no data entry`);
  }
  return gaps;
}
