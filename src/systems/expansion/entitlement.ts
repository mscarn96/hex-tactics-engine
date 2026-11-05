import { EXPANSIONS, EXPANSION_IDS, type ExpansionId } from "@/data/expansions";
import { EXPANSION_WORLD_IDS, worldDef, type WorldId } from "@/data/worlds";

/**
 * The ownership contract: what the game knows about which expansions the player
 * owns, and how a purchase or a restore changes it.
 *
 * **One authoritative record**, `Entitlements`, held by `entitlementStore` and
 * kept in the preferences record. Hero select, the Tavern, the world gate and
 * the level cap all ask it the same question (`owns`), so nothing can open a
 * door another screen keeps shut.
 *
 * The rules, each pinned by `entitlement.test.ts`:
 *  - **A restore is a purchase.** Both write the same entitlement; only `source`
 *    differs, and nothing grants or withholds by `source`.
 *  - **Only a granted outcome grants.** Pending, cancelled and failed leave the
 *    record exactly as it was — a failure never grants content, and never takes
 *    any away.
 *  - **Offline is the cache.** A restore that cannot reach the store (`null`)
 *    changes nothing, so an owner on a plane still owns what they bought.
 *  - **Durable.** Nothing here revokes. A store-side refund is the native
 *    provider's to report, when there is one.
 *
 * Who answers a purchase is an `EntitlementProvider`. Development builds, the
 * web preview and the simulations use `testEntitlementProvider`, which grants
 * on request; a release build without a store module has
 * `unavailableEntitlementProvider`, which never grants. The native store
 * provider is a separate task (it needs a native build). Ownership is also kept **apart from the story**: owning
 * Jadeveil opens the Monk at once, while its gate and its five levels still wait
 * for Aethelred.
 */

export type EntitlementSource = "purchase" | "restore" | "test";

export interface Entitlement {
  source: EntitlementSource;
  /** ISO time it was granted on this device. Informational. */
  grantedAt: string;
}

export type Entitlements = Partial<Record<ExpansionId, Entitlement>>;

/** What one purchase attempt came to. */
export type PurchaseOutcome =
  | { kind: "granted" }
  /** Waiting on the store (a parental approval, a deferred payment). Grants nothing yet. */
  | { kind: "pending" }
  | { kind: "cancelled" }
  | { kind: "failed"; reason: "offline" | "unavailable" | "store" };

export interface EntitlementProvider {
  readonly kind: "test" | "store" | "unavailable";
  purchase(id: ExpansionId): Promise<PurchaseOutcome>;
  /** Every expansion the store says this account owns, or `null` when it could not be asked. */
  restore(): Promise<ExpansionId[] | null>;
}

export function owns(entitlements: Entitlements, id: ExpansionId): boolean {
  return entitlements[id] !== undefined;
}

/**
 * The worlds this device owns and this build can enter: what the cap and the gates
 * count. A `devCrossing` world has no product yet, so in a development build it goes
 * with the DLC switch, and a build trying a campaign without the expansion sees none.
 * A release (`devTools` false) never counts one.
 */
export function ownedWorlds(entitlements: Entitlements, devTools: boolean): WorldId[] {
  const sold = EXPANSION_IDS.filter((id) => owns(entitlements, id)).map((id) => EXPANSIONS[id].world);
  return EXPANSION_WORLD_IDS.filter((world) => worldDef(world).enterable
    ? sold.includes(world)
    : devTools && worldDef(world).devCrossing === true && sold.length > 0);
}

export function applyPurchase(
  entitlements: Entitlements,
  id: ExpansionId,
  outcome: PurchaseOutcome,
  now: Date,
): Entitlements {
  if (outcome.kind !== "granted" || owns(entitlements, id)) return entitlements;
  return {
    ...entitlements,
    [id]: { source: "purchase", grantedAt: now.toISOString() },
  };
}

export function applyRestore(
  entitlements: Entitlements,
  restored: readonly ExpansionId[] | null,
  now: Date,
): Entitlements {
  if (restored === null) return entitlements;
  let next = entitlements;
  for (const id of restored) {
    if (!EXPANSION_IDS.includes(id) || owns(next, id)) continue;
    next = {
      ...next,
      [id]: { source: "restore", grantedAt: now.toISOString() },
    };
  }
  return next;
}

/** A development grant or revoke, from the test provider's switch. */
export function setTestOwnership(
  entitlements: Entitlements,
  id: ExpansionId,
  owned: boolean,
  now: Date,
): Entitlements {
  if (owned === owns(entitlements, id)) return entitlements;
  if (owned)
    return {
      ...entitlements,
      [id]: { source: "test", grantedAt: now.toISOString() },
    };
  const next = { ...entitlements };
  delete next[id];
  return next;
}

const SOURCES: ReadonlySet<string> = new Set<EntitlementSource>([
  "purchase",
  "restore",
  "test",
]);

/**
 * Whatever the preferences record holds, made well formed; `null` when it holds
 * nothing (an install that never wrote one). Unknown expansions and malformed
 * entries are dropped rather than refusing the record.
 */
export function readEntitlements(raw: unknown): Entitlements | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const out: Entitlements = {};
  for (const id of EXPANSION_IDS) {
    const entry = (raw as Record<string, unknown>)[id];
    if (entry === null || typeof entry !== "object") continue;
    const { source, grantedAt } = entry as Record<string, unknown>;
    if (typeof source !== "string" || !SOURCES.has(source)) continue;
    out[id] = {
      source: source as EntitlementSource,
      grantedAt: typeof grantedAt === "string" ? grantedAt : "",
    };
  }
  return out;
}

/**
 * The provider for development, the web preview and the simulations. It grants
 * every purchase, and a restore returns whatever it has granted — so restoring
 * after a purchase lands on the same access, as the real stores will.
 */
export function testEntitlementProvider(): EntitlementProvider {
  const bought = new Set<ExpansionId>();
  return {
    kind: "test",
    purchase: async (id) => {
      bought.add(id);
      return { kind: "granted" };
    },
    restore: async () => [...bought],
  };
}

/** A release build with no store module: nothing can be bought, and nothing is granted. */
export const unavailableEntitlementProvider: EntitlementProvider = {
  kind: "unavailable",
  purchase: async () => ({ kind: "failed", reason: "unavailable" }),
  restore: async () => null,
};

/**
 * What a device that has never stored a record starts with. A development build
 * owns every expansion through the test provider, so the Monk and the Jadeveil
 * gate are playable in a development build and the web preview with no store; the main
 * menu's developer switch takes it away again to try an unowned campaign.
 */
export function defaultEntitlements(
  development: boolean,
  now: Date,
): Entitlements {
  // Everything is owned until a store is connected.
  const out: Entitlements = {};
  for (const id of EXPANSION_IDS)
    out[id] = { source: "test", grantedAt: now.toISOString() };
  return out;
}
