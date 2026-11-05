/**
 * What happens when two notices arrive at once.
 *
 * `useToast` held exactly one, so a second `showToast` replaced the first
 * mid-animation and the first was simply never read. That is not a rare
 * collision — arriving somewhere fires several at a time. A day rolls over (the
 * dawn heal), a week rolls over (wells recharge, resource nodes regrow), the
 * tribute falls due, and a quest stage advances, all on one step; the player saw
 * whichever fired last and had no idea the others had happened.
 *
 * Pure, and free of the UI layer, so the rule is measurable in the node suite
 * — `Toast.tsx` cannot be imported there at all. The same split
 * `floatQueue`/`CombatScene` and `groundTexture`/`terrainMaterials` use.
 */

/** `bonus`: a unit took a speed bonus turn — the one notice drawn in the accent's gold. */
export type ToastVariant = 'info' | 'success' | 'error' | 'warning' | 'bonus';

export interface ToastEntry {
  message: string;
  variant: ToastVariant;
  /**
   * Increments per accepted notice, so React remounts `<Toast>` and restarts the
   * animation even when two consecutive messages read the same.
   */
  key: number;
}

/**
 * How many notices may wait behind the one showing.
 *
 * A queue drains at roughly three seconds an entry, so an unbounded one turns a
 * busy arrival into half a minute of notices describing a moment that has
 * passed — and the player cannot skip them. Four is about as far back as a
 * notice is still about *now*; past that the oldest is dropped rather than the
 * newest, because the newest is the one describing what just happened.
 */
export const TOAST_QUEUE_MAX = 4;

/**
 * Accepts a notice onto the queue, or refuses it as a repeat.
 *
 * Returns the input array **by identity** when nothing changed, so a caller can
 * skip the state write — the same contract `applyEvent` holds for quests, and
 * for the same reason: this is offered a notice on paths that fire often.
 *
 * Coalescing is against the notice *showing* as well as the tail, because the
 * common repeat is a player pressing a refused button twice. Re-queueing that
 * would make the second press feel like it did something different.
 */
export function enqueueToast(
  queue: readonly ToastEntry[],
  message: string,
  variant: ToastVariant,
  nextKey: number,
): ToastEntry[] {
  const duplicate = queue.some((t) => t.message === message && t.variant === variant);
  if (duplicate) return queue as ToastEntry[];

  const next = [...queue, { message, variant, key: nextKey }];
  if (next.length <= TOAST_QUEUE_MAX + 1) return next;

  /**
   * Overflow drops the oldest *waiting* notice, and **never the head**.
   *
   * The head is the one on screen. Dropping it looks like the obvious choice —
   * it is the oldest — and it is wrong twice over: the player loses a notice
   * mid-sentence, and the `<Toast>` rendering it unmounts while its animation is
   * still running. That animation's completion callback is `clearToast`, which
   * fires anyway a moment later and shifts the queue *again*, eating the notice
   * that had just taken its place. One overflow would silently cost two.
   *
   * So index 0 is pinned and the cut is taken from the front of the tail.
   */
  return [next[0], ...next.slice(next.length - TOAST_QUEUE_MAX)];
}
