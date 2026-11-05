import { createStore as create } from 'zustand/vanilla';
import type { RunOptions, RunSummary } from '@/models/run';

interface RunState extends RunOptions {
  /** Unique won fights, capped at the catalogue's ten-win milestone. */
  achievementVictories: string[];
  summary: RunSummary | null;
  lossPersistence: 'pending' | 'done' | 'failed';
  /** Called only when creating or loading a campaign. No in-run setter. */
  begin: (options?: RunOptions) => void;
}

/** Independent so combat and saving can read the run without importing scene stores. */
export const useRunSettingsStore = create<RunState>((set) => ({
  achievementVictories: [],
  difficulty: 'medium',
  hardcore: false,
  summary: null,
  lossPersistence: 'done',
  begin: (options) => set({
    achievementVictories: [],
    difficulty: options?.difficulty ?? 'medium',
    hardcore: options?.difficulty === 'hard' && options.hardcore,
    summary: null,
    lossPersistence: 'done',
  }),
}));
