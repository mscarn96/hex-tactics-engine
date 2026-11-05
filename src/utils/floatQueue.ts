/**
 * When a floating word is allowed to appear, so two never land on one anchor.
 *
 * The arena anchors every number and status name to its affected hex and
 * draws it there for 1.2s. Several of those routinely resolve in the *same
 * frame*, on the *same hex*, and they overprint into something illegible:
 *
 *  - Rapid Fire is five strikes and Flurry is four, each reporting its own
 *    damage against one target. The capstone whose whole selling point is the
 *    number of arrows showed one smeared number.
 *  - A blow that damages and afflicts reports both at once. That case was
 *    already known — `STATUS_FLOAT_DELAY_MS` exists for it — but a fixed delay
 *    only separates the *first* status from the number. A skill landing Chill,
 *    Slow and a poison dose fired all three at 250ms, back on top of each other.
 *
 * Pure arithmetic over a clock, so the scene keeps the timers and the rule stays
 * node-testable — the split `terrainDisplay`/`groundTexture` and
 * `cameraRig`/`RigCamera` already use.
 *
 * **Keyed per anchor, deliberately.** Two words on two different hexes are two
 * readable words; serialising the whole board would make a four-target AoE take
 * a second and a half to finish reporting, and the last number would arrive
 * after the turn had visibly moved on.
 */

/** Milliseconds between two words queued onto the same anchor. */
export const FLOAT_STAGGER_MS = 260;

export interface FloatQueue {
  /**
   * How long to wait before drawing at `key`, given the base delay this
   * particular word wants.
   *
   * `base` is the caller's own offset — a damage number wants 0, a status name
   * wants `STATUS_FLOAT_DELAY_MS` so it follows the number that caused it.
   * Queueing is applied *on top* of that: the returned delay is never smaller
   * than the base, so a status can still never overtake its own damage.
   */
  delayFor(key: string, now: number, base?: number): number;
  /**
   * The delay `delayFor` would answer, **without claiming the slot**.
   *
   * For whatever has to happen *with* a word rather than as one: a strike's
   * sound is reported just before its number, so asking here then is asking
   * when that number will appear — and claiming the slot instead would push the
   * number itself a stagger later, away from the picture it was timed to.
   */
  peek(key: string, now: number, base?: number): number;
  /** Forget every anchor. Called when combat tears down. */
  reset(): void;
}

/**
 * A queue over a wall clock.
 *
 * Holds one timestamp per anchor — the earliest a word may appear there — and
 * pushes it forward by `stagger` on every claim. Nothing is ever pruned and
 * nothing needs to be: a stale entry is a timestamp in the past, which imposes
 * no delay at all, so the map self-heals between fights and costs one number per
 * hex that has ever been written on.
 */
export function createFloatQueue(stagger: number = FLOAT_STAGGER_MS): FloatQueue {
  const freeAt = new Map<string, number>();

  return {
    delayFor(key, now, base = 0) {
      const earliest = Math.max(now + base, freeAt.get(key) ?? 0);
      freeAt.set(key, earliest + stagger);
      return earliest - now;
    },
    peek(key, now, base = 0) {
      return Math.max(now + base, freeAt.get(key) ?? 0) - now;
    },
    reset() {
      freeAt.clear();
    },
  };
}
