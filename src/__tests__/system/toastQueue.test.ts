import { TOAST_QUEUE_MAX, ToastEntry, enqueueToast } from '@/utils/toastQueue';

/**
 * Notices arrive in bursts, and only one used to survive.
 *
 * `useToast` held a single slot, so a second `showToast` replaced the first
 * mid-animation. That is not a rare race: one step across a tile boundary can
 * roll the day (the dawn heal), roll the week (wells recharge, ore regrows),
 * bring the tribute due and advance a quest stage — four notices, one shown, and
 * no way to ask what the others said.
 *
 * The rule lives here rather than in `Toast.tsx` because that module imports
 * the UI layer, which the node suite cannot load — the same split
 * `floatQueue`/`CombatScene` and `groundTexture`/`terrainMaterials` use.
 */

const push = (queue: ToastEntry[], message: string, key: number): ToastEntry[] =>
  enqueueToast(queue, message, 'info', key);

describe('the notification queue', () => {
  it('keeps notices in the order they arrived', () => {
    let q: ToastEntry[] = [];
    q = push(q, 'day breaks', 1);
    q = push(q, 'the week turns', 2);
    q = push(q, 'tribute is due', 3);
    expect(q.map((t) => t.message)).toEqual(['day breaks', 'the week turns', 'tribute is due']);
  });

  /**
   * Returned **by identity** when nothing changed, so the hook can skip the
   * state write — the contract `applyEvent` holds for quests, and for the same
   * reason: this is offered a notice on paths that fire often.
   */
  it('refuses a repeat without allocating', () => {
    const first = push([], 'not enough gold', 1);
    const again = push(first, 'not enough gold', 2);
    expect(again).toBe(first);
  });

  /**
   * Coalescing is against the whole queue, the showing notice included, because
   * the common repeat is a player pressing a refused button twice. Re-queueing
   * that would make the second press feel like it did something different.
   */
  it('coalesces against the notice on screen, not just the tail', () => {
    let q = push([], 'nothing happens', 1);
    q = push(q, 'something else', 2);
    const before = q;
    expect(push(q, 'nothing happens', 3)).toBe(before);
  });

  it('treats the same words in a different variant as a different notice', () => {
    const q = push([], 'the party rests', 1);
    expect(enqueueToast(q, 'the party rests', 'error', 2)).toHaveLength(2);
  });

  describe('overflow', () => {
    const flood = (n: number): ToastEntry[] => {
      let q: ToastEntry[] = [];
      for (let i = 0; i < n; i++) q = push(q, `notice ${i}`, i + 1);
      return q;
    };

    it('holds the showing notice plus a bounded tail', () => {
      expect(flood(20)).toHaveLength(TOAST_QUEUE_MAX + 1);
    });

    /**
     * **The head is pinned**, and this is the case that made it a rule.
     *
     * Dropping the oldest is the obvious cut and the head *is* the oldest — but
     * it is also the one on screen. Dropping it loses a notice mid-sentence, and
     * unmounts the `<Toast>` while its animation is still running: that
     * animation's completion callback shifts the queue again a moment later and
     * eats whatever had taken its place. One overflow would cost two notices.
     */
    it('never drops the notice being read', () => {
      const q = flood(20);
      expect(q[0].message).toBe('notice 0');
    });

    /** The cut comes out of the middle: the newest are what describe *now*. */
    it('keeps the newest and discards the stalest waiting ones', () => {
      const q = flood(20);
      expect(q[q.length - 1].message).toBe('notice 19');
      expect(q.map((t) => t.message)).not.toContain('notice 5');
    });
  });
});
