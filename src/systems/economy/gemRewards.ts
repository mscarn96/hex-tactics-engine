import { BALANCE } from '@/data/balanceConstants';
import { GEM_KINDS, worldGemTier } from '@/data/items/gems';
import type { WorldId } from '@/data/worlds';
import { GemId, GemTier } from '@/models/types';

/**
 * A separate roll: equipment slots and rarity never enter this calculation.
 *
 * In the Empire a fight pays Cut and a chest (a dungeon's last stage, a summit)
 * sometimes Brilliant. A world with a tier of its own (`worldGemTier`, Jadeveil's
 * Spirit) rolls that tier first, at `GEM_WORLD_TIER_CHANCE`, and shares out the
 * rest as the Empire does — so the Empire never pays a Spirit gem, and the
 * Empire's rolls are the same draws as before Spirit gems existed.
 */
export function rollRewardGem(chest: boolean, world: WorldId = 'empire', rng: () => number = Math.random): GemId | null {
  if (rng() >= (chest ? BALANCE.GEM_CHEST_REWARD_CHANCE : BALANCE.GEM_REWARD_CHANCE)) return null;
  const kind = GEM_KINDS[Math.floor(rng() * GEM_KINDS.length)];
  return `${kind}_${rewardTier(chest, world, rng)}`;
}

function rewardTier(chest: boolean, world: WorldId, rng: () => number): GemTier {
  const own = worldGemTier(world);
  const chances = (BALANCE.GEM_WORLD_TIER_CHANCE as Partial<Record<WorldId, { fight: number; chest: number }>>)[world];
  if (own && chances) {
    const roll = rng();
    const ownChance = chest ? chances.chest : chances.fight;
    if (roll < ownChance) return own;
    return chest && roll < ownChance + BALANCE.GEM_CHEST_BRILLIANT_CHANCE ? 'brilliant' : 'cut';
  }
  return chest && rng() < BALANCE.GEM_CHEST_BRILLIANT_CHANCE ? 'brilliant' : 'cut';
}
