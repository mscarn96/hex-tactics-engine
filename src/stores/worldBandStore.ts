import { createStore as create } from 'zustand/vanilla';
import { setLevelCapInputs } from '@/data/levelCap';
import type { WorldId } from '@/data/worlds';
import { bandedWorlds, crossInto, markFinished, NO_WORLD_BANDS, type WorldBands } from '@/systems/world/worldBands';

/**
 * The campaign's world band ledger (`systems/world/worldBands.ts` has the rules).
 * Imports only pure rules, so any store can write to it without closing a cycle:
 * `ascentStore` marks Jadeveil finished on Kairen's first kill. Pushes its part of
 * the level cap into `data/levelCap.ts`, as `entitlementStore` and `empireStore` do.
 */
interface WorldBandState {
  ledger: WorldBands;
  /** Record a crossing into `world`: its first takes the next band, and the band is kept for good. */
  cross: (world: WorldId) => void;
  /** Record that `world`'s orb boss has fallen. Safe to repeat. */
  finish: (world: WorldId) => void;
  reset: () => void;
}

export const useWorldBandStore = create<WorldBandState>((set, get) => ({
  ledger: NO_WORLD_BANDS,
  cross: (world) => set({ ledger: crossInto(get().ledger, world) }),
  finish: (world) => set({ ledger: markFinished(get().ledger, world) }),
  reset: () => set({ ledger: NO_WORLD_BANDS }),
}));

const pushCap = (ledger: WorldBands) => setLevelCapInputs({
  banded: bandedWorlds(ledger) as WorldId[],
  finished: ledger.finished as WorldId[],
});
pushCap(useWorldBandStore.getState().ledger);
useWorldBandStore.subscribe((s) => pushCap(s.ledger));
