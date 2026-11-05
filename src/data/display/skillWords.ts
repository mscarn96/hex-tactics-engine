import { formatNumber, hasMessage, t, type MessageKey, type MessageParams } from '@/i18n';
import { statusName } from '@/data/gameText';
import { PASSIVE_DEFS } from '@/systems/combat/passives';
import { statusDisplay } from '@/data/display/statusDisplay';

/**
 * The shared pieces of the sentences built about skills (`simpleText`,
 * `skillDisplay`, `preparedDisplay`): a `skillText` entry by key, counted nouns
 * in the case the sentence needs, small numbers as words, and the names of
 * statuses and passives that sentences carry as placeholders.
 */

/** A `skillText` entry in the current language. */
export const skillText = (key: string, params?: MessageParams): string =>
  t(`skillText.${key}` as MessageKey, params);

/** "3 hexes" where Polish takes the accusative ("o 3 pola"). */
export const hexes = (n: number) => skillText('unit.hex', { count: n });
/** "3 hexes" where Polish takes the genitive ("do 3 pól", "w promieniu 3 pól"). */
export const hexesGen = (n: number) => skillText('unit.hexGen', { count: n });
/** "3 turns" (accusative in Polish: "przez 3 tury"). */
export const turnsText = (n: number) => skillText('unit.turn', { count: n });
/** "3 turns" standing alone on a plate (nominative in Polish: "1 tura"). */
export const turnsPlate = (n: number) => skillText('unit.turnPlate', { count: n });
/** "two": a small count as a word in English, a numeral in Polish. */
export const countWord = (n: number) => (n >= 0 && n <= 5 ? skillText(`word.${n}`) : formatNumber(n));

/** "A, B and C", in the current language. */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return skillText('list.and', {
    rest: items.slice(0, -1).join(skillText('list.separator')),
    last: items[items.length - 1],
  });
}

/** A status's name inside a sentence ("Burn" / "Podpalenie"). */
export function statusLabel(type: string): string {
  const legacy = (statusDisplay(type as never) as { label?: string } | undefined)?.label;
  return statusName(type, legacy);
}

/** A passive's name inside a sentence, from the `passives` catalog once it holds it. */
export function passiveLabel(id: string): string {
  const key = `passives.${id}.name`;
  if (hasMessage(key)) return t(key as MessageKey);
  return (PASSIVE_DEFS as unknown as Record<string, { name?: string } | undefined>)[id]?.name ?? id;
}
