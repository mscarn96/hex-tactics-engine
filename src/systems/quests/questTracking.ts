import { QuestId } from '@/quests/types';
import { useQuestStore } from '@/stores/questStore';
import { useGameStore } from '@/stores/gameStore';
import type { VillageTheme } from '@/data/villages';

/** An explicit tracking press enables both the HUD record and its map guidance in one step. */
export function trackQuestOnMap(id: QuestId): void {
  if (!useQuestStore.getState().active[id]) return;
  useQuestStore.getState().track(id);
  useGameStore.getState().setGuide('quest');
}

/**
 * Follows a held village from its journal note, as Track on map follows a quest (playtest
 * 2026-10-29): the HUD strip names it and the quest guide points at it. Pressed again, it stops.
 */
export function toggleVillageOnMap(theme: VillageTheme): void {
  const quests = useQuestStore.getState();
  if (quests.trackedVillage === theme) {
    quests.trackVillage(null);
    return;
  }
  quests.trackVillage(theme);
  useGameStore.getState().setGuide('quest');
}
