/** Campaign difficulty, distinct from an encounter's DifficultyTier. */
export type RunDifficulty = 'easy' | 'medium' | 'hard';

export interface RunOptions {
  difficulty: RunDifficulty;
  hardcore: boolean;
}

export interface RunSummary {
  encounter: string;
  days: number;
  heroes: string[];
  highestLevel: number;
}
