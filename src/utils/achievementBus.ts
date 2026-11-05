import type { AchievementEvent } from '@/models/achievements';

const listeners = new Set<(event: AchievementEvent) => void>();

/** Facts emitted only after successful actions, never on save hydration. */
export function reportAchievement(event: AchievementEvent): void {
  for (const listener of listeners) listener(event);
}

export function onAchievementEvent(listener: (event: AchievementEvent) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
