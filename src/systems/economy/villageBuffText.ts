import { BALANCE } from '@/data/balanceConstants';
import { formatNumber, t } from '@/i18n';
import { entryText } from '@/i18n/dataText';
import type { VillageBuffId } from '@/systems/economy/villageBuffs';
import { effectPercent } from '@/systems/economy/villageBuffEffects';

/** Display text for the eight village buffs, read when shown (`villages` catalog, `buff.<id>.*`). */
export const buffName = (buff: VillageBuffId): string => entryText('villages', `buff.${buff}`, 'name');

/** What a buff does, as a sentence with its number (`effectPercent`, `BALANCE.VILLAGE_BUFF_EFFECT`). */
export function buffEffect(buff: VillageBuffId): string {
  const params = {
    percent: formatNumber(effectPercent(buff)),
    points: formatNumber(BALANCE.VILLAGE_BUFF_EFFECT.critPoints),
  };
  return entryText('villages', `buff.${buff}`, 'effect', params);
}

/** "18h" under a day, "2d 6h" over, as the map's clocks say it. */
export function leftText(hours: number): string {
  const h = Math.ceil(hours);
  if (h < BALANCE.HOURS_PER_DAY) return t('worldmap.hours.hours', { hours: h });
  const d = Math.floor(h / BALANCE.HOURS_PER_DAY);
  const rest = h % BALANCE.HOURS_PER_DAY;
  return rest ? t('worldmap.hours.daysHours', { days: d, hours: rest }) : t('worldmap.hours.days', { days: d });
}
