import type { CombatUnit } from '@/models/types';
import { GamePhase } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { useGameStore } from '@/stores/gameStore';
import { useRunSettingsStore } from '@/stores/runSettingsStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { usePartyStore } from '@/stores/partyStore';
import { useSimStore } from '@/stores/simStore';
import { eraseRunSave } from '@/systems/save/persistence';
import { isSandboxed } from '@/systems/combat/sandbox';

/** A summon cannot save a party wipe; one fallen hero does not end a run. */
export function partyWiped(units: CombatUnit[]): boolean {
  const heroes = units.filter(u => u.isPlayer && u.heroId !== undefined);
  return heroes.length > 0 && heroes.every(u => u.currentHp <= 0);
}

export async function persistHardcoreLoss(): Promise<void> {
  if (!useRunSettingsStore.getState().summary) return;
  useRunSettingsStore.setState({ lossPersistence: 'pending' });
  try {
    await eraseRunSave();
    useRunSettingsStore.setState({ lossPersistence: 'done' });
  } catch {
    // Keep the run ended and saving disabled. The screen offers a retry, never
    // a way back into the fight or a silent return with a live save on disk.
    useRunSettingsStore.setState({ lossPersistence: 'failed' });
  }
}

/** Runs synchronously on HP writes, before scene effects or result-dialog timers. */
export function checkHardcoreWipe(): void {
  const run = useRunSettingsStore.getState();
  const game = useGameStore.getState();
  if (run.summary || !run.hardcore || run.difficulty !== 'hard'
    || useSimStore.getState().active || isSandboxed() || game.phase !== GamePhase.Combat
    || !partyWiped(useCombatStore.getState().units)) return;

  const heroes = usePartyStore.getState().heroes;
  useRunSettingsStore.setState({
    summary: {
      encounter: game.currentEncounterId ?? 'battle',
      days: Math.floor(useCalendarStore.getState().totalHours / 24) + 1,
      heroes: heroes.map(h => h.name),
      highestLevel: Math.max(1, ...heroes.map(h => h.level)),
    },
    lossPersistence: 'pending',
  });
  // Disable background saves and unmount combat immediately. The RunOver screen
  // shows only a pending indicator until deletion has completed successfully.
  game.setPhase(GamePhase.RunOver);
  void persistHardcoreLoss();
}

export function installHardcoreGuard(): () => void {
  const dispose = useCombatStore.subscribe(checkHardcoreWipe);
  return dispose;
}
