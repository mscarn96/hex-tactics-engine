import type { HeroClass, Rarity } from './enums';

export type AchievementEvent =
  | { kind: 'victory'; key: string; encounterId: string; clean: boolean }
  | { kind: 'recruit'; heroClass: HeroClass; size: number }
  | { kind: 'mastery'; action: 'path' | 'node' | 'capstone' }
  | { kind: 'item'; rarity: Rarity }
  | { kind: 'equipment'; pieces: number }
  | { kind: 'explore'; tiles: number }
  | { kind: 'well' }
  | { kind: 'quest'; completed: number }
  | { kind: 'tribute' }
  | { kind: 'lairs'; cleared: number }
  | { kind: 'site' }
  | { kind: 'castle' };

/** Text is read by id: `achievementName(id)` and friends in `data/achievements.ts`. */
export interface AchievementDefinition {
  id: string;
  hardcore: boolean;
}

/** Earned profile data; campaign counters belong to the run save. */
export type EarnedAchievements = Record<string, string>;
