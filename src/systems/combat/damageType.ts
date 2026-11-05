import type { DamageType, HeroSkill } from '@/models/skills';
import type { HeroStats } from '@/models/units';
import { BALANCE } from '@/data/balanceConstants';
import { SKILL_DAMAGE_TYPES } from '@/data/skills/damageTypes';

/**
 * Which defence answers a hit.
 *
 * Kept free of `combatEngine` and `damageCalc` so both can import it: the
 * engine builds the effective sheet this reads, and the calculator spends it.
 */

/**
 * A skill's hit type. An explicit `skill.damageType` wins (a Basic Attack
 * carries its weapon's); otherwise the deliberate table; otherwise physical.
 * **Never read off `scaling`** — see `SKILL_DAMAGE_TYPES`.
 */
export function damageTypeOf(skill: Pick<HeroSkill, 'id' | 'damageType'>): DamageType {
  return skill.damageType ?? SKILL_DAMAGE_TYPES[skill.id] ?? 'physical';
}

/**
 * A sheet's Magic Defense. Stated, it is its own number; unstated, it tracks
 * Physical Defense at `BALANCE.MAGIC_DEFENSE_RATIO`, so every unit authored
 * before the two were separated reads exactly as it did.
 */
export function magicDefenseOf(stats: Pick<HeroStats, 'defense' | 'magicDefense'>): number {
  return stats.magicDefense ?? Math.round(stats.defense * BALANCE.MAGIC_DEFENSE_RATIO);
}

/** The defence value that mitigates a hit of this type. */
export function defenceAgainst(
  stats: Pick<HeroStats, 'defense' | 'magicDefense'>,
  type: DamageType,
): number {
  return type === 'magic' ? magicDefenseOf(stats) : stats.defense;
}


export const DEFENCE_LABEL: Record<DamageType, string> = {
  physical: 'P.DEF',
  magic: 'M.DEF',
};
