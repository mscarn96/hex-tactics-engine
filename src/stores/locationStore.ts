import { createStore as create } from 'zustand/vanilla';
import { reportAchievement } from '@/utils/achievementBus';
import { clearedLairs } from '@/systems/world/lairs';
import { HexCoord } from '@/utils/hexUtils';
import { BuildingType } from '@/models/types';
import { LocationId, triggerKey } from '@/locations/types';
import { getLocation } from '@/locations';

/**
 * Where the party is inside an authored place, and what it has already used up
 * there.
 *
 * Split deliberately down the middle:
 *
 * - **`current` and `position` are transient.** A save always resumes on the
 *   world map — the same call the castle run already makes — so there is no such
 *   thing as reloading into the middle of a lair with a party that has no memory
 *   of how it got there.
 * - **`spentTriggers` is persisted.** Chests opened and set-piece encounters
 *   cleared, keyed by location and hex. **Chests never respawn**: a lair is a
 *   place you loot once, not a farm, and that is the only reason this store
 *   touches the save file at all.
 */
interface LocationState {
  current: LocationId | null;
  position: HexCoord;
  /** `triggerKey()` values for one-shot triggers already used, forever. */
  spentTriggers: Set<string>;
  /**
   * The city building the party is inside, or null. Transient like `current`.
   * The weekly decision waits while it is set (`weeklyDecisionDue`): a night in
   * the tavern that ends the week asks for the tribute once the party walks out,
   * not over the tavern (PT-04, playtest 2026-10-17).
   */
  building: BuildingType | null;
  setBuilding: (building: BuildingType | null) => void;

  enter: (id: LocationId) => void;
  leave: () => void;
  moveTo: (coord: HexCoord) => void;

  isSpent: (coord: HexCoord) => boolean;
  spend: (coord: HexCoord) => void;

  /**
   * The trigger whose fight is happening right now, held until it resolves.
   *
   * A location encounter is spent on **victory**, not on entry. Spending on the
   * way in would mean a lair boss you were carried out of counts as beaten — and
   * the boss is what pays for a party slot. Losing drops the hold instead: a
   * defeat already takes the party out of the lair entirely, so the run is over
   * either way and the room is still there when they come back.
   */
  pending: HexCoord | null;
  hold: (coord: HexCoord) => void;
  /** Won: spend it. */
  resolvePending: () => void;
  /** Lost, or left: let it go unspent. */
  dropPending: () => void;

  /** Wipes the spent set too — new game only. */
  reset: () => void;
}

export const useLocationStore = create<LocationState>((set, get) => ({
  current: null,
  position: { q: 0, r: 0 },
  spentTriggers: new Set(),
  pending: null,
  building: null,

  enter: (id) => set({ current: id, position: getLocation(id).entry, pending: null, building: null }),

  leave: () => set({ current: null, pending: null, building: null }),

  setBuilding: (building) => set({ building }),

  moveTo: (coord) => set({ position: coord }),

  // Both of these read `current` rather than taking a location: a caller holding
  // the wrong id would silently spend a chest in another place, and the only
  // location the party can interact with is the one it is standing in.
  isSpent: (coord) => {
    const { current, spentTriggers } = get();
    return current !== null && spentTriggers.has(triggerKey(current, coord));
  },

  spend: (coord) => {
    const { current, spentTriggers } = get();
    if (current === null) return;
    const key = triggerKey(current, coord);
    if (spentTriggers.has(key)) return;
    set({ spentTriggers: new Set(spentTriggers).add(key) });
  },

  hold: (coord) => set({ pending: coord }),

  resolvePending: () => {
    const { pending, spentTriggers } = get();
    if (!pending) return;
    get().spend(pending);
    set({ pending: null });
    const before = clearedLairs(spentTriggers).length;
    const cleared = clearedLairs(get().spentTriggers).length;
    if (cleared > before) reportAchievement({ kind: 'lairs', cleared });
  },

  dropPending: () => set({ pending: null }),

  reset: () =>
    set({ current: null, position: { q: 0, r: 0 }, spentTriggers: new Set(), pending: null, building: null }),
}));
