import { t, type MessageKey } from './index';

/**
 * A real-world date (an achievement earned, a save written) as `18 Oct 2026` /
 * `18 paź 2026`, with month names from the `ui` catalog. Not
 * `toLocaleDateString`, which follows the device rather than the game's
 * language and is not complete on Hermes. In-game calendar days are named by
 * the calendar's own catalog text, not this.
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return t('ui.date.short', {
    day: d.getDate(),
    month: t(`ui.date.month.${d.getMonth() + 1}` as MessageKey),
    year: d.getFullYear(),
  });
}
