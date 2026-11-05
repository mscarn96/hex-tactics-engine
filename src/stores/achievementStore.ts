import { createStore as create } from 'zustand/vanilla';
import type { MessageKey } from '@/i18n';
import type { EarnedAchievements } from '@/models/achievements';
import { unlockAchievements } from '@/systems/progression/achievements';
import { loadAchievementProfile, saveAchievementProfile } from '@/systems/save/achievementProfile';

interface AchievementState {
  earned: EarnedAchievements;
  hydrated: boolean;
  /** Catalog key of the message to show, not the text: the screen translates it when shown. */
  error: MessageKey | null;
  notices: string[];
  hydrate: () => Promise<void>;
  unlock: (ids: readonly string[], date?: string) => void;
  dismissNotice: () => void;
  retrySave: () => Promise<void>;
}

let hydration: Promise<void> | null = null;
let revision = 0;

export const useAchievementStore = create<AchievementState>((set, get) => {
  const persist = async () => {
    const current = ++revision;
    try {
      await saveAchievementProfile(get().earned);
      if (current === revision) set({ error: null });
    } catch {
      if (current === revision) set({ error: 'achievementsScreen.error.save' });
    }
  };
  return {
    earned: {}, hydrated: false, error: null, notices: [],
    hydrate: () => {
      if (!hydration) {
        hydration = loadAchievementProfile().then(earned => {
          set({ earned, hydrated: true, error: null });
        }).catch(() => {
          set({ error: 'achievementsScreen.error.load' });
          hydration = null;
        });
      }
      return hydration;
    },
    unlock: (ids, date = new Date().toISOString()) => {
      if (!get().hydrated) return;
      const before = get().earned;
      const earned = unlockAchievements(before, ids, date);
      if (earned === before) return;
      set(s => ({ earned, notices: [...s.notices, ...Object.keys(earned).filter(id => before[id] === undefined)] }));
      void persist();
    },
    dismissNotice: () => set(s => ({ notices: s.notices.slice(1) })),
    retrySave: persist,
  };
});
