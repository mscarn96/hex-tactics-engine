import { BALANCE } from '@/data/balanceConstants';
import type { WorldId } from '@/data/worlds';

/**
 * The effective hero and item level cap.
 *
 * `MAX_LEVEL`, plus `EXPANSION_LEVELS` for each crossing opened, up to four
 * (the private project notes, *Bands, crossings and the cap*). One
 * reader for everything level-linked — the XP loop, mastery points, recruits,
 * minted and castle item levels, the Crystal ceiling and the `+N` — so hero and
 * item progression can never disagree about where the top is.
 *
 * One road at a time: Aethelred's fall opens one crossing, and each world's orb
 * boss, on its first kill, opens one more, as long as there is an owned world
 * left to take it to. The cap therefore always equals the top of the newest
 * band, and a new world is never above the cap on arrival.
 *
 * Its inputs live in three stores that must not import each other
 * (`entitlementStore` for the worlds owned, `empireStore` for the Emperor,
 * `worldBandStore` for the ledger), so each pushes its part here as it changes.
 * This module imports nothing but `BALANCE` (and a type) and holds no other state,
 * so the data layer (`items/itemLevel.ts`) can read it without reaching up into a
 * store, and it cannot sit in an import cycle.
 *
 * `BALANCE.MAX_LEVEL` is read at the call, so a suite that moves the base cap
 * still moves this one.
 *
 * The ledger's part also says which band a world took (`worldBand`), so the data
 * layer can read it too: `items/gems.ts` grades a world's gem tier by it.
 */

/** What the cap and the gates read off a campaign. Pure data: the tests state it outright. */
export interface RoadState {
  /** The worlds this device owns and this build can enter. */
  owned: readonly WorldId[];
  emperorDefeated: boolean;
  /** The worlds that have taken a band, in the order they took them. */
  banded: readonly WorldId[];
  /** The worlds whose orb boss has fallen once. */
  finished: readonly WorldId[];
}

/** Crossings opened: none before Aethelred falls, then one plus one per finished world, while worlds remain. */
export function crossingsOpened(state: Pick<RoadState, 'owned' | 'emperorDefeated' | 'finished'>): number {
  if (!state.emperorDefeated) return 0;
  return Math.min(BALANCE.MAX_WORLD_CROSSINGS, state.owned.length, 1 + state.finished.length);
}

/** The cap for a campaign in this state. Pure — what the save loader and the tests use. */
export function effectiveLevelCap(state: Pick<RoadState, 'owned' | 'emperorDefeated' | 'finished'>): number {
  return BALANCE.MAX_LEVEL + BALANCE.EXPANSION_LEVELS * crossingsOpened(state);
}

/**
 * The highest cap any campaign can reach (40). A level above the current cap but
 * within this one is a real level from a campaign that once had more (an owner
 * whose entitlement cannot be read right now): kept, never refused.
 */
export function highestLevelCap(): number {
  return BALANCE.MAX_LEVEL + BALANCE.EXPANSION_LEVELS * BALANCE.MAX_WORLD_CROSSINGS;
}

/** Whether a crossing stands open with no world taken through it yet. */
export function crossingFree(state: RoadState): boolean {
  return state.banded.length < crossingsOpened(state);
}

const inputs: RoadState = { owned: [], emperorDefeated: false, banded: [], finished: [] };

/** Each store pushes its own part. */
export function setLevelCapInputs(patch: Partial<RoadState>): void {
  Object.assign(inputs, patch);
}

/** The running campaign's state, for the gates. A snapshot, so a caller cannot write through it. */
export function roadState(): RoadState {
  return { ...inputs };
}

/**
 * The level band a world holds in this state, or the one it would take on its first
 * crossing, so a world's numbers read the same before and after that crossing. Null
 * for the Empire, which has no band.
 */
export function worldBandFor(world: WorldId, state: Pick<RoadState, 'banded'>): number | null {
  if (world === 'empire') return null;
  const held = state.banded.indexOf(world);
  return held >= 0 ? held + 1 : Math.min(BALANCE.MAX_WORLD_CROSSINGS, state.banded.length + 1);
}

/** `worldBandFor` for the running campaign. `worldBand` is the band actually taken, null before the crossing. */
export function contentBand(world: WorldId): number | null {
  return worldBandFor(world, inputs);
}

/** The cap the running campaign is at. */
export function levelCap(): number {
  return effectiveLevelCap(inputs);
}

/** The band `world` took in the running campaign, from 1; `null` before its first crossing. */
export function worldBand(world: WorldId): number | null {
  const taken = inputs.banded.indexOf(world);
  return taken < 0 ? null : taken + 1;
}
