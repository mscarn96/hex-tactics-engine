import { createStore as create } from 'zustand/vanilla';
import type { ExpansionId } from '@/data/expansions';
import { setLevelCapInputs } from '@/data/levelCap';
import {
  applyPurchase,
  applyRestore,
  defaultEntitlements,
  ownedWorlds,
  owns,
  setTestOwnership,
  testEntitlementProvider,
  unavailableEntitlementProvider,
  type EntitlementProvider,
  type Entitlements,
  type PurchaseOutcome,
} from '@/systems/expansion/entitlement';
import { loadPreferences, savePreferences } from '@/systems/save/preferences';
import { DEV_TOOLS } from '@/utils/devTools';

/**
 * Which expansions this player owns, live — the one place hero select, the
 * Tavern, the world gate and the level cap read it from
 * (`systems/expansion/entitlement.ts` has the rules).
 *
 * **Not a campaign store**, for `audioSettingsStore`'s reasons: ownership
 * belongs to the device and the store account, is written to the preferences
 * record the moment it changes, read back once at start-up (`App.tsx`), and is
 * never reset by a new campaign. Until the stored record arrives it holds the
 * build's default (`defaultEntitlements`), and a change made before then wins.
 *
 * Pushes the worlds owned into the level cap's inputs (`data/levelCap.ts`).
 */
interface EntitlementState {
  entitlements: Entitlements;
  hydrated: boolean;
  provider: EntitlementProvider;
  hydrate: () => Promise<void>;
  purchase: (id: ExpansionId) => Promise<PurchaseOutcome>;
  /** Whether the store could be asked at all; what it returned is already applied. */
  restore: () => Promise<boolean>;
  /** The test provider's switch. Ignored by any other provider. */
  setTestOwned: (id: ExpansionId, owned: boolean) => void;
}

let hydrating: Promise<void> | null = null;
let touched = false;

function initialProvider(): EntitlementProvider {
  return DEV_TOOLS ? testEntitlementProvider() : unavailableEntitlementProvider;
}

export const useEntitlementStore = create<EntitlementState>((set, get) => {
  const commit = (entitlements: Entitlements) => {
    if (entitlements === get().entitlements) return;
    touched = true;
    set({ entitlements });
    void savePreferences({ entitlements });
  };

  return {
    entitlements: defaultEntitlements(DEV_TOOLS, new Date()),
    hydrated: false,
    provider: initialProvider(),

    hydrate: () => {
      if (!hydrating) {
        hydrating = loadPreferences().then(({ entitlements }) => {
          set(touched || entitlements === null ? { hydrated: true } : { entitlements, hydrated: true });
        });
      }
      return hydrating;
    },

    purchase: async (id) => {
      const outcome = await get().provider.purchase(id);
      commit(applyPurchase(get().entitlements, id, outcome, new Date()));
      return outcome;
    },

    restore: async () => {
      const restored = await get().provider.restore();
      commit(applyRestore(get().entitlements, restored, new Date()));
      return restored !== null;
    },

    setTestOwned: (id, owned) => {
      if (get().provider.kind !== 'test') return;
      commit(setTestOwnership(get().entitlements, id, owned, new Date()));
    },
  };
});

/** The question every reader asks, outside React. */
export function ownsExpansion(id: ExpansionId): boolean {
  return owns(useEntitlementStore.getState().entitlements, id);
}

const pushCap = (entitlements: Entitlements) =>
  setLevelCapInputs({ owned: ownedWorlds(entitlements, DEV_TOOLS) });
pushCap(useEntitlementStore.getState().entitlements);
useEntitlementStore.subscribe((s) => pushCap(s.entitlements));

/**
 * The suite's: a fresh, hydrated-or-not store with this ownership and the test
 * provider, so a case states the ownership it is about rather than inheriting
 * the build's.
 */
export function resetEntitlementsForTest(owned: readonly ExpansionId[] = [], provider?: EntitlementProvider): void {
  hydrating = null;
  touched = false;
  const now = new Date();
  let entitlements: Entitlements = {};
  for (const id of owned) entitlements = setTestOwnership(entitlements, id, true, now);
  useEntitlementStore.setState({
    entitlements,
    hydrated: false,
    provider: provider ?? testEntitlementProvider(),
  });
}
