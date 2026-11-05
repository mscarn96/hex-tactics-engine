import { BALANCE } from '@/data/balanceConstants';
import type { VillageTheme } from '@/data/villages';
import { ResourceType } from '@/models/types';

/**
 * Village buffs: two per village, one on offer each week, one held at a time.
 *
 * Pure rules for the offer and the holding; what a held buff does is
 * `villageBuffEffects.ts`, and the held buff lives in `stores/villageStore.ts`,
 * which also reads it against the clock. A village offers its two buffs
 * strictly alternating by week number, each village starting on its own week
 * of the cycle (`VILLAGE_CYCLE_OFFSET`) so neighbours rarely line up. A bought buff runs 168 hours from purchase, stored as an end hour on the
 * campaign clock like the ward's, and stacks with the expedition meal and the
 * ward. Design: the private project notes, section 2.4. Every
 * number is in `BALANCE.VILLAGE_BUFF_*`: verify in playtest.
 */
export const VILLAGE_BUFF_IDS = [
  'smithy_armor', 'smithy_power',
  'shrine_barrier', 'shrine_crit',
  'lookout_escape', 'lookout_sight',
  'trading_discount', 'trading_gold',
] as const;
export type VillageBuffId = (typeof VILLAGE_BUFF_IDS)[number];

/** Each village's two buffs: its A, then its B. */
export const VILLAGE_BUFF_PAIRS: Record<VillageTheme, readonly [VillageBuffId, VillageBuffId]> = {
  smithy: ['smithy_armor', 'smithy_power'],
  shrine: ['shrine_barrier', 'shrine_crit'],
  lookout: ['lookout_escape', 'lookout_sight'],
  trading_post: ['trading_discount', 'trading_gold'],
};

/** Which half of its cycle a village is on in week 1: 0 offers its A first, 1 its B. */
export const VILLAGE_CYCLE_OFFSET: Record<VillageTheme, 0 | 1> = {
  lookout: 0,
  trading_post: 1,
  smithy: 1,
  shrine: 0,
};

/** The buff a village offers in `week` (weeks count from 1). */
export function weeklyBuff(theme: VillageTheme, week: number): VillageBuffId {
  return VILLAGE_BUFF_PAIRS[theme][(Math.max(1, week) + VILLAGE_CYCLE_OFFSET[theme]) % 2];
}

/** What the village will offer next week, for the panel's "Next week: …". */
export const nextWeekBuff = (theme: VillageTheme, week: number): VillageBuffId => weeklyBuff(theme, week + 1);

/** The village a buff belongs to. */
export function buffVillage(buff: VillageBuffId): VillageTheme {
  return (Object.keys(VILLAGE_BUFF_PAIRS) as VillageTheme[]).find((theme) => VILLAGE_BUFF_PAIRS[theme].includes(buff))!;
}

/** The held buff: which village sold it, which it is, and the campaign hour it ends. */
export interface VillageBuff {
  village: VillageTheme;
  buff: VillageBuffId;
  untilHour: number;
}

/** The held buff while it still runs at `totalHours`; it ends exactly at its end hour. */
export function activeBuff(held: VillageBuff | null, totalHours: number): VillageBuff | null {
  return held && totalHours < held.untilHour ? held : null;
}

/** Hours of a held buff left, 0 when none runs. */
export const buffHoursLeft = (held: VillageBuff | null, totalHours: number): number =>
  held ? Math.max(0, held.untilHour - totalHours) : 0;

/** A buff taken on at `totalHours`: seven full days from now, replacing whatever was held. */
export function takeBuff(theme: VillageTheme, buff: VillageBuffId, totalHours: number): VillageBuff {
  return { village: theme, buff, untilHour: totalHours + BALANCE.VILLAGE_BUFF_HOURS };
}

/** What a buff costs, in materials. */
export function buffPrice(buff: VillageBuffId): Partial<Record<ResourceType, number>> {
  return { ...BALANCE.VILLAGE_BUFF_PRICE[buff] };
}

/** Whether a stored value is a well-formed held buff (for the save). */
export function validVillageBuff(value: unknown): value is VillageBuff | null {
  if (value === null) return true;
  const v = value as VillageBuff | undefined;
  return !!v && typeof v === 'object'
    && (v.village in VILLAGE_BUFF_PAIRS)
    && VILLAGE_BUFF_PAIRS[v.village].includes(v.buff)
    && Number.isFinite(v.untilHour) && v.untilHour >= 0;
}
