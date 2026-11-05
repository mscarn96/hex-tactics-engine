import type { Entitlements } from '@/systems/expansion/entitlement';

/** What outlives a campaign. The engine keeps it in memory, for the life of the process. */
export interface Preferences {
  entitlements: Entitlements | null;
}

let stored: Preferences = { entitlements: null };

export async function loadPreferences(): Promise<Preferences> {
  return stored;
}

export function savePreferences(patch: Partial<Preferences>): Promise<void> {
  stored = { ...stored, ...patch };
  return Promise.resolve();
}
