import type { Locale } from './catalog';
import { getLocale } from './locale';

/**
 * Numbers in text, written the way each language writes them. English groups
 * thousands with a comma and uses a decimal point (`12,500`, `1.5`); Polish
 * groups with a non-breaking space from five digits up and uses a decimal comma
 * (`1500`, `12 500`, `1,5`), after CLDR. Written out rather than read from
 * `Intl.NumberFormat`, which Hermes does not ship with every locale.
 *
 * Use these instead of `toFixed` or string concatenation wherever a number is
 * shown inside text. Callers normally leave `locale` out and get the current
 * language; tests pass it.
 */

interface NumberStyle {
  group: string;
  decimal: string;
  /** The fewest integer digits that get grouped at all (CLDR `minimumGroupingDigits` + 3). */
  groupFrom: number;
}

const STYLES: Record<Locale, NumberStyle> = {
  en: { group: ',', decimal: '.', groupFrom: 4 },
};

function group(digits: string, style: NumberStyle): string {
  if (digits.length < style.groupFrom) return digits;
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, style.group);
}

function write(n: number, fractionDigits: number, trim: boolean, locale: Locale): string {
  const style = STYLES[locale];
  const fixed = Math.abs(n).toFixed(fractionDigits);
  const [whole, rawFraction = ''] = fixed.split('.');
  const fraction = trim ? rawFraction.replace(/0+$/, '') : rawFraction;
  const sign = n < 0 && Number(fixed) !== 0 ? '-' : '';
  return sign + group(whole, style) + (fraction ? style.decimal + fraction : '');
}

/** A whole number, rounded, with the language's thousands grouping: `12,500` / `12 500`. */
export function formatNumber(n: number, locale: Locale = getLocale()): string {
  return write(Math.round(n), 0, false, locale);
}

/**
 * A number with up to `maxDigits` decimals and no trailing zeros: `1.5`, `2`,
 * `0.25` — `1,5`, `2`, `0,25` in Polish. `fixed` keeps the zeros (`1.50`).
 */
export function formatDecimal(
  n: number,
  maxDigits = 1,
  options: { fixed?: boolean; locale?: Locale } = {},
): string {
  return write(n, maxDigits, !options.fixed, options.locale ?? getLocale());
}

/**
 * A fraction as a whole percentage: `0.25` → `25%`. Polish print style puts a
 * space before the sign; the game keeps it tight in both languages, as HUD text.
 */
export function formatPercent(fraction: number, locale: Locale = getLocale()): string {
  return `${formatNumber(fraction * 100, locale)}%`;
}
