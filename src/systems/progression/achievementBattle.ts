import type { CombatUnit } from '@/models/types';
import { reportAchievement } from '@/utils/achievementBus';

/** Called by the actual victory handler, before XP or units are reset. */
export function reportCampaignVictory(units: readonly CombatUnit[], encounterId: string): void {
  const heroes = units.filter(u => u.isPlayer && u.heroId && !u.summonedBy);
  if (!heroes.some(u => u.currentHp > 0)) return;
  reportAchievement({
    kind: 'victory', key: units.map(u => u.id).sort().join('|'), encounterId,
    clean: heroes.every(u => u.currentHp > 0),
  });
}
