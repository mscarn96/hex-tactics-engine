import { BALANCE } from '@/data/balanceConstants';
import { contentBand } from '@/data/levelCap';
import type { WorldId } from '@/data/worlds';
import { NPCS } from '@/quests/npcData';
import type { Quest } from '@/quests/types';
import { bandFloor, bandTop } from '@/systems/world/worldBands';

/**
 * What a quest pays at the band of the world it belongs to: the world of its giver's camp, where
 * it is handed in. A contract given in the Empire keeps the Empire's rules. Read by the claim and by
 * the log, which show the same numbers wherever the party stands.
 */
export const questWorld = (quest: Pick<Quest, 'giver'>): WorldId => NPCS[quest.giver]?.camp ?? 'empire';

/** A band's multiplier on fight and quest XP and gold; 1 for no band. */
export function bandRewardScale(band: number | null): number {
  if (band === null) return 1;
  const table = BALANCE.BAND_REWARD_SCALE;
  return table[Math.min(table.length, Math.max(1, band)) - 1];
}

export function questXpGold(quest: Pick<Quest, 'giver' | 'rewards'>): { xp: number; gold: number } {
  const scale = bandRewardScale(contentBand(questWorld(quest)));
  return { xp: Math.round((quest.rewards.xp ?? 0) * scale), gold: Math.round((quest.rewards.gold ?? 0) * scale) };
}

/**
 * The level quest gear is handed over at: the party's own, clamped to the band in an expansion
 * world, and the band's top as the ceiling a legendary mints at. `level` is `partyItemLevel`'s answer.
 */
export function questGearLevel(quest: Pick<Quest, 'giver'>, level: number): { level: number; ceiling?: number } {
  const band = contentBand(questWorld(quest));
  if (band === null) return { level };
  return { level: Math.min(bandTop(band), Math.max(bandFloor(band), level)), ceiling: bandTop(band) };
}

