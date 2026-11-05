import { createStore as create } from 'zustand/vanilla';
import { usePartyStore } from '@/stores/partyStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { useEmpireStore } from '@/stores/empireStore';
import { useRunSettingsStore } from '@/stores/runSettingsStore';
import type { Hero } from '@/models/types';
import type { TacticalLevel } from '@/systems/combat/tacticalAI';

/**
 * The tuning harness's own state, and the guard rail that makes it safe.
 *
 * A simulated fight runs through the *real* `CombatScene`, which means it does
 * everything a real fight does: awards XP, rolls loot, spends resources and
 * calls `saveGame`. None of that may reach the player's actual game.
 *
 * Two defences, deliberately belt and braces:
 *
 * 1. `active` makes `saveGame` a no-op, so nothing reaches disk.
 * 2. Entering snapshots the campaign stores a fight can write, and leaving puts
 *    them back — so nothing reaches the in-memory game either.
 *
 * Only defence 1 would leave a corrupted session that the next real save would
 * happily persist. Only defence 2 would still write a sim result to disk if the
 * app were closed mid-harness.
 */

interface Snapshot {
  party: unknown;
  inventory: unknown;
  empire: unknown;
  run: unknown;
}

interface SimState {
  /** True while the harness owns the session. Read by `saveGame`. */
  active: boolean;
  /** Enemy template ids for the next harness fight. */
  enemies: string[];
  /** Power multiplier applied on top of level scaling, as encounters do. */
  powerScale: number;
  snapshot: Snapshot | null;
  /**
   * PvP proof of concept: the heroes the AI fields against the party, or empty for a monster fight.
   * Set, the harness fight is fought against these heroes (`buildEncounter`'s `foes`) and ends back
   * on the PvP setup screen. Their gear is minted into the inventory like the party's.
   */
  pvpFoes: Hero[];
  /** Who plays the PvP rival: the tactical AI at a difficulty, or null for the ordinary brain. */
  pvpTactical: TacticalLevel | null;
  /**
   * Skip a fight's opening look at the enemy. Set by the visual-baseline
   * harness, whose captures are stills of a board at a fixed moment and would
   * otherwise photograph the intro card over it. Never persisted, never read by
   * the game's own rules.
   */
  skipCombatIntro: boolean;

  /**
   * The fight as text, for pasting to someone who wants to read it: a header (the setup), one line per
   * thing the log said, a `#n Name (party|enemy)` line at each unit's turn and the result. It is not
   * cleared by `exit`, so the setup screen can still hand over the fight that has just ended, and it
   * is only written while the harness owns the session.
   */
  battleLog: string[];
  battleTurns: number;
  /** Starts a new log under `header`. */
  startBattleLog: (header: string[]) => void;
  logBattleLine: (text: string) => void;
  /** A unit's turn begins: the marker the lab's replays carry, so the two logs line up. */
  logBattleTurn: (name: string, isPlayer: boolean) => void;
  /**
   * A castle stage begins: the `=== Stage ===` line the lab's chain transcript carries, and the turn
   * count starts again, as the lab's does for each stage.
   */
  logBattleStage: (name: string) => void;

  enter: () => void;
  exit: () => void;
  setEnemies: (ids: string[]) => void;
  setPowerScale: (scale: number) => void;
  setPvpFoes: (heroes: Hero[]) => void;
  setPvpTactical: (level: TacticalLevel | null) => void;
}

export const useSimStore = create<SimState>((set, get) => ({
  active: false,
  enemies: [],
  powerScale: 1,
  snapshot: null,
  pvpFoes: [],
  pvpTactical: 'normal',
  skipCombatIntro: false,
  battleLog: [],
  battleTurns: 0,

  startBattleLog: (header) => set({ battleLog: [...header], battleTurns: 0 }),
  logBattleLine: (text) => {
    if (!get().active) return;
    // The scene's lines carry a leading two-space indent in the lab's transcripts; keep that shape
    set((s) => ({ battleLog: [...s.battleLog, `  ${text.trim()}`] }));
  },
  logBattleTurn: (name, isPlayer) => {
    if (!get().active) return;
    set((s) => ({ battleLog: [...s.battleLog, `#${s.battleTurns + 1} ${name} (${isPlayer ? 'party' : 'enemy'})`], battleTurns: s.battleTurns + 1 }));
  },
  logBattleStage: (name) => {
    if (!get().active) return;
    set((s) => ({ battleLog: [...s.battleLog, `=== ${name} ===`], battleTurns: 0 }));
  },

  enter: () => {
    // Re-entering without leaving would overwrite the real snapshot with a
    // simulated one, which is the one way this could still eat a save.
    if (get().active) return;
    set({
      active: true,
      snapshot: {
        party: { ...usePartyStore.getState() },
        inventory: { ...useInventoryStore.getState() },
        empire: { ...useEmpireStore.getState() },
        run: { ...useRunSettingsStore.getState() },
      },
    });
    // Measurements always start from the permanent base balance.
    useRunSettingsStore.getState().begin();
  },

  exit: () => {
    const snap = get().snapshot;
    if (snap) {
      // `replace: true` puts the whole state object back, actions included —
      // they are stable references, so restoring them is a no-op that keeps the
      // restore honest rather than a merge that might leave a stray field.
      usePartyStore.setState(snap.party as never, true);
      useInventoryStore.setState(snap.inventory as never, true);
      useEmpireStore.setState(snap.empire as never, true);
      useRunSettingsStore.setState(snap.run as never, true);
    }
    set({ active: false, snapshot: null, enemies: [], powerScale: 1, pvpFoes: [] });
  },

  setEnemies: (ids) => set({ enemies: ids }),
  setPowerScale: (scale) => set({ powerScale: scale }),
  setPvpFoes: (heroes) => set({ pvpFoes: heroes }),
  setPvpTactical: (level) => set({ pvpTactical: level }),
}));

/** The encounter id the harness uses. Decoded in `encounterGenerator`. */
export const SIM_ENCOUNTER_ID = 'sim_harness';

/**
 * The same fight on a different roll of the scenery.
 *
 * Every ring, water region and shelf in the arena is seeded on the encounter id
 * — that is what stops two fights on the same ground looking like the same
 * clearing — so varying the id is how a composition is looked at on more than
 * the one arrangement the gate photographs. `encounterGenerator` decodes the
 * whole `sim_harness:*` family back to the harness's named opposition, so the
 * *fight* is unchanged and only the dressing moves.
 *
 * **The empty seed is the gate's own id, exactly**, rather than `sim_harness:0`:
 * the default arrangement has to be the one every reference capture was taken
 * of, or an editor opens on a scene no evidence exists for. And a non-default
 * seed is spelled the way `visualBaselineHarness` already spells it, because
 * that is what makes a gap found by eye reproducible — the seed that exposed it
 * goes back into a real capture as `scenerySeed`.
 */
export function sceneryEncounterId(seed = ''): string {
  return seed === '' ? SIM_ENCOUNTER_ID : `${SIM_ENCOUNTER_ID}:${seed}`;
}
