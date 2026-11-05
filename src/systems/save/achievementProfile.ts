import AsyncStorage from '@/platform/keyValueStore';
import type { EarnedAchievements } from '@/models/achievements';
import { readAchievements } from '@/systems/progression/achievements';

export const ACHIEVEMENTS_KEY = 'engine_achievements';
let writes: Promise<void> = Promise.resolve();

export async function loadAchievementProfile(): Promise<EarnedAchievements> {
  const raw = await AsyncStorage.getItem(ACHIEVEMENTS_KEY);
  if (!raw) return {};
  try { return readAchievements(JSON.parse(raw)); } catch { return {}; }
}

/** Snapshots are ordered so a slower older write cannot remove newer unlocks. */
export function saveAchievementProfile(earned: EarnedAchievements): Promise<void> {
  const snapshot = JSON.stringify(earned);
  const next = writes.catch(() => {}).then(() => AsyncStorage.setItem(ACHIEVEMENTS_KEY, snapshot));
  writes = next;
  return next;
}
