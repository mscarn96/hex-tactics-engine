import { ResourceType } from '@/models/types';
import { formatNumber } from '@/i18n';

/**
 * A resource's mark inside a sentence.
 *
 * Notices, panel lines and confirmations are strings — and many of them are
 * written by systems, which cannot draw — so a resource in one is a token the
 * presentation layer swaps for the resource's mark (`ResourceText`), the same
 * mark `RESOURCE_ICONS` gives the purse and every price. "Short by 3 iron" and
 * "120 gold" were words beside a bar that drew the same things as marks.
 *
 * The token carries the `ResourceType`, never an icon id, so the mark is read
 * off `RESOURCE_ICONS` in one place and cannot drift per call site.
 */
const TOKEN = /\{\{res:([a-z]+)\}\}/g;

const RESOURCE_VALUES = new Set<string>(Object.values(ResourceType));

/** The mark alone: "No {{res:iron}} to sell". */
export const resMark = (type: ResourceType): string => `{{res:${type}}}`;

/** An amount, drawn as the mark then the number — the order `ResourceAmount` draws. */
export const resAmount = (type: ResourceType, amount: number | string): string =>
  `${resMark(type)}${typeof amount === 'number' ? formatNumber(amount) : amount}`;

/** A whole cost, in `ResourceType` order, as `CostList` lists it. */
export const resCost = (cost: Partial<Record<ResourceType, number>>): string =>
  (Object.values(ResourceType) as ResourceType[])
    .filter((t) => (cost[t] ?? 0) > 0)
    .map((t) => resAmount(t, cost[t]!))
    .join(' ');

export type ResourceTextPart = { text: string } | { resource: ResourceType };

/** A string's runs of words and marks, in order. An unknown token stays words. */
export function parseResourceText(text: string): ResourceTextPart[] {
  const parts: ResourceTextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (!RESOURCE_VALUES.has(m[1])) continue;
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ resource: m[1] as ResourceType });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Whether a string carries a mark at all; most do not, and draw as plain text. */
export const hasResourceMarks = (text: string): boolean => parseResourceText(text).some((p) => 'resource' in p);

/**
 * The string with each mark said as its word — for a screen reader, a log, a
 * test. "{{res:iron}}3" reads "3 iron", the order a sentence says it in.
 */
export function plainResourceText(text: string): string {
  return text
    .replace(/\{\{res:([a-z]+)\}\}([\d.,]+)/g, (_, type: string, n: string) => `${n} ${type}`)
    .replace(TOKEN, (_, type: string) => type);
}
