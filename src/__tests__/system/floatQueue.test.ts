import { FLOAT_STAGGER_MS, createFloatQueue } from '@/utils/floatQueue';

/**
 * Two words on one anchor in one frame is one illegible word.
 *
 * The arena draws every damage number and every status name at a projected
 * screen point for 1.2 seconds, and several of them routinely resolve in the
 * same frame on the same hex:
 *
 *  - `strikeScales` resolves Rapid Fire as five strikes and Flurry as four, each
 *    floating its own damage at one target. The capstone whose entire selling
 *    point is *how many arrows* drew a single smeared number.
 *  - A blow that damages and afflicts reports both. That much was known —
 *    `STATUS_FLOAT_DELAY_MS` exists for it — but a fixed delay separates the
 *    first status from the number and nothing else, so a skill landing three
 *    afflictions fired all three at 250ms, back on top of each other.
 *
 * The arithmetic is here rather than in the scene for the reason `cameraRig` and
 * `groundTexture` are: a timing decision measured in a node test is a timing
 * decision, and one eyeballed on a phone is a guess.
 */
describe('the floating-text queue', () => {
  it('lets the first word through immediately', () => {
    const q = createFloatQueue();
    expect(q.delayFor('0,0', 1000)).toBe(0);
  });

  it('stacks each further word on the same anchor behind the last', () => {
    const q = createFloatQueue();
    // Rapid Fire: five strikes, one target, one frame
    const delays = [0, 0, 0, 0, 0].map(() => q.delayFor('0,0', 1000));
    expect(delays).toEqual([
      0,
      FLOAT_STAGGER_MS,
      FLOAT_STAGGER_MS * 2,
      FLOAT_STAGGER_MS * 3,
      FLOAT_STAGGER_MS * 4,
    ]);
  });

  /**
   * Serialising the whole board would make a four-target area skill take a
   * second and a half to finish reporting, and the last number would land after
   * the turn had visibly moved on. Two words on two hexes are two readable
   * words, so they do not queue against each other.
   */
  it('keeps anchors independent', () => {
    const q = createFloatQueue();
    expect(q.delayFor('0,0', 1000)).toBe(0);
    expect(q.delayFor('1,0', 1000)).toBe(0);
    expect(q.delayFor('2,-1', 1000)).toBe(0);
  });

  /**
   * The base is the caller's own offset — 0 for a damage number, the status
   * delay for a name that has to follow the blow that caused it. Queueing is
   * applied *on top*, so a status can never overtake its own damage however
   * busy the hex is.
   */
  it('never returns less than the caller asked to wait', () => {
    const q = createFloatQueue();
    expect(q.delayFor('0,0', 1000, 250)).toBe(250);

    const fresh = createFloatQueue();
    fresh.delayFor('0,0', 1000);
    // The number went first; the status still waits its full base at minimum
    expect(fresh.delayFor('0,0', 1000, 250)).toBeGreaterThanOrEqual(250);
  });

  /**
   * A number and a name racing for one hex resolve in the order they were
   * reported, with the later one pushed clear — which is the whole point: the
   * damage is the reading that must not be missed, and the status follows it.
   */
  it('orders a number and the status it arrived with', () => {
    const q = createFloatQueue();
    const damage = q.delayFor('0,0', 1000, 0);
    const status = q.delayFor('0,0', 1000, 250);
    expect(damage).toBe(0);
    expect(status).toBeGreaterThanOrEqual(FLOAT_STAGGER_MS);
    expect(status).toBeGreaterThan(damage);
  });

  /**
   * Time passing empties the queue without anything pruning it — a stale
   * timestamp is simply in the past. That is what lets the map hold one entry
   * per hex forever and still impose no delay on a quiet board.
   */
  it('forgets an anchor once its turn has passed', () => {
    const q = createFloatQueue();
    q.delayFor('0,0', 1000);
    expect(q.delayFor('0,0', 1000 + FLOAT_STAGGER_MS * 4)).toBe(0);
  });

  /**
   * The castle gauntlet's scene never unmounts between stages, so "it heals
   * eventually" is not the same as "it is empty for the next fight".
   */
  it('clears on reset', () => {
    const q = createFloatQueue();
    q.delayFor('0,0', 1000);
    q.delayFor('0,0', 1000);
    q.reset();
    expect(q.delayFor('0,0', 1000)).toBe(0);
  });

  /**
   * What a strike's sound asks just before its number is floated: when will the
   * next word here appear? The answer has to be the number's own delay, and
   * asking must not move the number — claiming the slot would push it a stagger
   * later, away from the picture it was timed to.
   */
  it('answers a peek with the next delay, without claiming it', () => {
    const q = createFloatQueue();
    q.delayFor('0,0', 1000, 110);
    const peeked = q.peek('0,0', 1000, 110);
    expect(peeked).toBe(110 + FLOAT_STAGGER_MS);
    expect(q.peek('0,0', 1000, 110)).toBe(peeked);
    expect(q.delayFor('0,0', 1000, 110)).toBe(peeked);
    expect(q.peek('1,1', 1000, 40)).toBe(40);
  });
});
