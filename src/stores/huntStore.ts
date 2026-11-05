import { createStore as create } from 'zustand/vanilla';

export interface HuntStreak { key: string; misses: number }
interface HuntState {
  streak: HuntStreak;
  won: (key: string, progressed: boolean) => void;
  reset: () => void;
}
export const useHuntStore = create<HuntState>((set) => ({
  streak: { key: '', misses: 0 },
  won: (key, progressed) => set(s => ({ streak: {
    key, misses: progressed ? 0 : (s.streak.key === key ? s.streak.misses : 0) + 1,
  } })),
  reset: () => set({ streak: { key: '', misses: 0 } }),
}));
