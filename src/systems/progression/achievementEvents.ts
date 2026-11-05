import { GamePhase } from '@/models/types';
import { onAchievementEvent } from '@/utils/achievementBus';
import { matchingAchievements, eligibleForAchievements } from '@/systems/progression/achievements';
import { useAchievementStore } from '@/stores/achievementStore';
import { useGameStore } from '@/stores/gameStore';
import { useRunSettingsStore } from '@/stores/runSettingsStore';
import { useSimStore } from '@/stores/simStore';

/** Installed once by App. Store actions emit facts without importing other stores. */
export function installAchievementTracking(): () => void {
  return onAchievementEvent(event => {
    const game = useGameStore.getState();
    const run = useRunSettingsStore.getState();
    const context = {
      difficulty: run.difficulty, hardcore: run.hardcore,
      campaign: !run.summary && [GamePhase.WorldMap, GamePhase.Location, GamePhase.Combat].includes(game.phase),
      harness: useSimStore.getState().active,
    };
    if (!eligibleForAchievements(context) || !useAchievementStore.getState().hydrated) return;
    let victories = run.achievementVictories;
    if (event.kind === 'victory') {
      if (victories.includes(event.key)) return;
      if (victories.length < 10) {
        victories = [...victories, event.key];
        useRunSettingsStore.setState({ achievementVictories: victories });
      }
    }
    useAchievementStore.getState().unlock(matchingAchievements(event, victories.length, context));
  });
}
