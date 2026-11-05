import type { CombatUnit, HeroStats } from '@/models/types';
import type { RunDifficulty } from '@/models/run';
import { BALANCE } from '@/data/balanceConstants';
import { useRunSettingsStore } from '@/stores/runSettingsStore';

const BASE_STRENGTH = { hp: 1, damage: 1 };

/**
 * A hostile unit's HP and damage factors: the campaign's difficulty times
 * `ENEMY_STRENGTH`, which a home-ring foe is spared (`CombatUnit.sparedStrength`).
 */
export function difficultyMultipliers(difficulty = useRunSettingsStore.getState().difficulty, spared = false) {
  const scale = BALANCE.RUN_DIFFICULTY[difficulty];
  const strength = spared ? BASE_STRENGTH : BALANCE.ENEMY_STRENGTH;
  return { hp: scale.hp * strength.hp, damage: scale.damage * strength.damage };
}

/** Whether a fight on this ground is the home ring's, spared `ENEMY_STRENGTH`: band 0, not the castle or the siege. */
export function sparesStrength(threatBand: number, castleOrSiege: boolean): boolean {
  return threatBand === 0 && !castleOrSiege;
}

/** HP changes after level/encounter scaling. All other stats keep the base balance. */
export function difficultyHp(stats: HeroStats, difficulty?: RunDifficulty, spared = false): HeroStats {
  return { ...stats, maxHp: Math.max(1, Math.round(stats.maxHp * difficultyMultipliers(difficulty, spared).hp)) };
}

/** Finished hostile damage, after defence; also used by ticks and reflection. */
export function difficultyDamage(amount: number, source?: Pick<CombatUnit, 'isPlayer' | 'sparedStrength'>): number {
  if (!source || source.isPlayer || amount <= 0) return amount;
  return Math.max(1, Math.round(amount * difficultyMultipliers(undefined, !!source.sparedStrength).damage));
}
