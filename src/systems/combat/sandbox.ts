import { useCombatStore } from '@/stores/combatStore';

/**
 * Plays "what if" on the live fight and puts it back exactly as it was.
 *
 * The rules read and write `useCombatStore`, so a lookahead has to play its candidate turns there.
 * The store is updated immutably — every write replaces the objects it changes — so the state object
 * taken before is untouched by whatever is played, and restoring it by reference (`replace`) leaves
 * every selector holding the value it held: nothing re-renders. `sandbox.test.ts` freezes the state
 * and plays random turns to keep that promise honest.
 *
 * Subscribers that act on a change (the health timeline, the hardcore wipe guard) skip while
 * `isSandboxed()`, so a hero killed in a rehearsal is neither drawn falling nor ends a run.
 */

let depth = 0;

export const isSandboxed = (): boolean => depth > 0;

export function inSandbox<T>(fn: () => T): T {
  const before = useCombatStore.getState();
  depth++;
  try {
    return fn();
  } finally {
    // Still sandboxed while the restore is observed, so subscribers skip it as well
    useCombatStore.setState(before, true);
    depth--;
  }
}
