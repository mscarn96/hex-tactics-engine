import { AuraType } from '@/models/status';
import type { CombatUnit } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { magicDefenseOf } from '@/systems/combat/damageType';
import type { VillageBuffId } from '@/systems/economy/villageBuffs';

/**
 * What a held village buff changes, all eight in one place.
 *
 * `villageBuffs.ts` is the offer and the holding: which village sells which buff
 * in which week, what it costs and when it ends. This is the other half, the
 * effect, and every answer takes the id of the buff running now (or null) and
 * nothing else: the clock and the store are read once, by the adapter in
 * `stores/villageStore.ts` (`villageBuffIdNow`, `useVillageBuffId`). So a new
 * buff is one case here, not a hunt through the shops, the fight's setup and
 * the world map. Numbers: `BALANCE.VILLAGE_BUFF_EFFECT`; verify in playtest.
 *
 * - **Smithy and Shrine**: a hero as the fight starts (`villageBuffUnit`).
 * - **Trading post**: item and Market purchase prices (`discounted`), gold from
 *   fights and finds (`goldMultiplier`).
 * - **Lookout**: a warband that stops the walk can be fled (`fleesWarbands`,
 *   offered by `systems/world/worldStep.ts`), and the day's warbands near the
 *   party show red (`seesDanger`, drawn by the world map's Danger sight).
 */

// ─── Smithy and Shrine: in a fight ───────────────────────────────────────────

const pct = (value: number, percent: number) => Math.round(value * (1 + percent / 100));

/**
 * A player unit as it starts a fight under the village buff held: the Smithy's
 * armor or attack-or-magic, the Shrine's Barrier or crit chance. Applied once
 * when the fight is built, like the monastery's vows (`blessUnit`); a resumed
 * fight's units already carry it. The Lookout's buffs and the Trading post's
 * are not fought with and leave the unit alone, as does anyone who is not on
 * the party's side.
 */
export function villageBuffUnit(unit: CombatUnit, buff: VillageBuffId | null): CombatUnit {
  if (!unit.isPlayer || !buff) return unit;
  const effect = BALANCE.VILLAGE_BUFF_EFFECT;
  const s = unit.stats;
  switch (buff) {
    case 'smithy_armor':
      return { ...unit, stats: { ...s, defense: pct(s.defense, effect.armorPct), magicDefense: pct(magicDefenseOf(s), effect.armorPct) } };
    case 'smithy_power':
      // Whichever of attack and magic is higher for this hero, chosen as the fight starts
      return s.magic > s.attack
        ? { ...unit, stats: { ...s, magic: pct(s.magic, effect.powerPct) } }
        : { ...unit, stats: { ...s, attack: pct(s.attack, effect.powerPct) } };
    case 'shrine_barrier': {
      const pool = Math.round(s.maxHp * effect.barrierShare);
      if (pool <= 0) return unit;
      return {
        ...unit,
        activeEffects: [...unit.activeEffects, { type: AuraType.Barrier, magnitude: pool, duration: -1, sourceUnitId: unit.id }],
      };
    }
    case 'shrine_crit':
      return { ...unit, stats: { ...s, critChance: (s.critChance ?? BALANCE.BASE_CRIT_CHANCE) + effect.critPoints } };
    default:
      return unit;
  }
}

// ─── Trading post: prices and gold ───────────────────────────────────────────

/** The price multiplier on item purchases and Market buying: the Trading post's discount, else 1. */
export const discountMultiplier = (buff: VillageBuffId | null): number =>
  buff === 'trading_discount' ? 1 - BALANCE.VILLAGE_BUFF_EFFECT.discount : 1;

/** A purchase price under the held buff, never below 1. */
export const discounted = (price: number, buff: VillageBuffId | null): number =>
  price <= 0 ? price : Math.max(1, Math.round(price * discountMultiplier(buff)));

/** The multiplier on gold from fights and finds: the Trading post's bonus, else 1. */
export const goldMultiplier = (buff: VillageBuffId | null): number =>
  buff === 'trading_gold' ? 1 + BALANCE.VILLAGE_BUFF_EFFECT.goldBonus : 1;

// ─── Lookout: on the world map ───────────────────────────────────────────────

/** Whether a wandering warband that stops the walk can be fled (Escape); the chance is `escape.ts`'s. */
export const fleesWarbands = (buff: VillageBuffId | null): boolean => buff === 'lookout_escape';

/** Whether the day's live warbands near the party show red (Danger sight; which ones is `dangerSight.ts`'s). */
export const seesDanger = (buff: VillageBuffId | null): boolean => buff === 'lookout_sight';

// ─── The number in a buff's sentence ─────────────────────────────────────────

/**
 * The percentage a buff's sentence quotes (`buffEffect`'s `{percent}`): the
 * armor, attack-or-magic, Barrier, discount or gold share. The Lookout's
 * sentences quote no number and take the gold share as a harmless default.
 */
export function effectPercent(buff: VillageBuffId): number {
  const e = BALANCE.VILLAGE_BUFF_EFFECT;
  switch (buff) {
    case 'smithy_armor': return e.armorPct;
    case 'smithy_power': return e.powerPct;
    case 'shrine_barrier': return e.barrierShare * 100;
    case 'trading_discount': return e.discount * 100;
    default: return e.goldBonus * 100;
  }
}
