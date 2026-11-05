import { useGameStore } from '@/stores/gameStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { GamePhase } from '@/models/types';
import { saveGame } from '@/systems/save/persistence';

/**
 * Saves taken while the game is played, not only as it is left.
 *
 * Until this existed the only writes were the app going behind and the player
 * choosing Save & quit — a crash fires neither, and a playtest lost an hour to
 * one. These are the moments worth a checkpoint: every scene change (into a
 * fight, out of it, into a location, back onto the map), a fight's checkpoint
 * being taken or its win being banked, each new day of travel, and a slow
 * safety net for long stays in one place (an afternoon in the city's shops).
 *
 * Every request is coalesced into one trailing write. A win sets `resolved`
 * before its XP and loot are paid out, and a phase change and a new checkpoint
 * arrive a frame apart, so saving on the spot would write the half-finished
 * picture and then write again. `saveGame`'s own guards still decide whether
 * anything is written at all — the menu, hero select, the harness and a lost
 * Hardcore run are refused there, so this never has to know about them.
 */

/** Long enough for a win to finish paying out; short enough that a crash right after loses nothing. */
export const AUTOSAVE_DELAY_MS = 1500;
/**
 * The safety net. Each save serialises the whole world map, so this is slow on
 * purpose, and it skips fights: a save mid-fight only ever restores its start,
 * which the checkpoint save already wrote.
 */
export const AUTOSAVE_INTERVAL_MS = 120_000;

let pending: ReturnType<typeof setTimeout> | null = null;

/** Ask for a save soon. Repeated requests inside the delay become one write. */
export function requestAutosave(): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    // A failed write (a full web quota, say) must not surface as an unhandled
    // rejection in the middle of play; the next checkpoint tries again
    saveGame().catch(() => {});
  }, AUTOSAVE_DELAY_MS);
}

/** Installs the triggers; returns the uninstaller. `App` calls it once. */
export function installAutosave(): () => void {
  const stopGame = useGameStore.subscribe((now, before) => {
    if (now.phase !== before.phase) {
      requestAutosave();
      return;
    }
    const entry = now.encounterEntry;
    const was = before.encounterEntry;
    // The checkpoint taken as a fight opens, and the moment its win is banked
    if (entry && (!was || entry.resolved !== was.resolved)) requestAutosave();
  });
  const stopCalendar = useCalendarStore.subscribe((now, before) => {
    if (now.dayNumber !== before.dayNumber) requestAutosave();
  });
  const net = setInterval(() => {
    if (useGameStore.getState().phase !== GamePhase.Combat) requestAutosave();
  }, AUTOSAVE_INTERVAL_MS);
  return () => {
    stopGame();
    stopCalendar();
    clearInterval(net);
    if (pending) clearTimeout(pending);
    pending = null;
  };
}
