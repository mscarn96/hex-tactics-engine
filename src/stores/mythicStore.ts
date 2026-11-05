import { createStore as create } from 'zustand/vanilla';

/**
 * The bad-luck counter behind boss mythics (`systems/economy/mythicDrops.ts` has the rules):
 * the eligible boss kills since the last mythic. It belongs to the campaign, so it crosses
 * worlds with the party and a defeat does not touch it. Imports nothing but Zustand.
 */
interface MythicState {
  kills: number;
  setKills: (kills: number) => void;
  reset: () => void;
}

export const useMythicStore = create<MythicState>((set) => ({
  kills: 0,
  setKills: (kills) => set({ kills }),
  reset: () => set({ kills: 0 }),
}));
