/**
 * The dice every combat roll is drawn from.
 *
 * A strike's dodge and crit, a status's chance, a passive's proc, a poison
 * overdose and a death burst's crit all roll, and they roll in four different
 * modules, two of them behind the store. Threading an `rng` argument through
 * every one of those signatures would touch most of `systems/combat`, so the
 * rolls share one source instead: `Math.random` unless a caller says otherwise.
 *
 * A caller says otherwise in one of two ways. `withDice` pins the source for the
 * length of one synchronous call, which is what `ResolveOptions.rng` and
 * `executeAIActions`'s `rng` do. `setDice` replaces it outright, for a suite or
 * a harness that wants every roll pinned. Pure, with no imports, so the store,
 * the systems and the Vite tools can all reach it.
 */
export type Dice = () => number;

// Looked up per roll, not captured: a harness that seeds by replacing `Math.random` still reaches it
const native: Dice = () => Math.random();
let source: Dice = native;

/** One roll in [0, 1). The default for every `rng` parameter in `systems/combat`. */
export const roll: Dice = () => source();

/** Replaces the dice. Pass `null` to restore `Math.random`. */
export function setDice(rng: Dice | null): void {
  source = rng ?? native;
}

/** Runs `fn` with `rng` as the dice, then puts the previous source back. */
export function withDice<T>(rng: Dice | undefined, fn: () => T): T {
  if (!rng) return fn();
  const previous = source;
  source = rng;
  try {
    return fn();
  } finally {
    source = previous;
  }
}
