import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { MODIFIER_LABEL, STAT_LABELS, grantPair } from '@/data/display/masteryDisplay';
import { INTEGER_MODIFIERS } from '@/systems/progression/mastery';
import { PASSIVE_DEFS } from '@/systems/combat/passives';
import { LEVEL_SCALE, PassiveId, PassiveRank } from '@/models/types';
import { passiveDescription } from '@/systems/combat/passives';

/**
 * Every number a tree grants has to reach the player as words.
 *
 * The failure this exists for is silent and shipped: `MODIFIER_LABEL` covered
 * seven keys, the trees granted eighteen, and the fallback printed the raw field
 * name — so a Stoneshaper's node offered "aoeDamageBonus 0.15" and a
 * Lifewarden's "healRestoresMana 6". That is source code rendered to a player as
 * a feature description, and nothing at runtime can observe it: the panel draws,
 * the node works, only the words are wrong.
 *
 * Measured against the **shipped trees** rather than against `MasteryModifier`'s
 * full key list, because an unused key needs no label — the rule is that
 * anything a player can actually buy must be legible, and a table of labels for
 * modifiers nothing grants is a table nobody maintains.
 */

/** Every modifier key any node in any path actually grants. */
const GRANTED_MODIFIERS = new Set<string>(
  MASTERY_PATHS.flatMap((p) => p.nodes).flatMap((n) => (n.modifier ? Object.keys(n.modifier) : [])),
);

/** Every stat key any node grants. */
const GRANTED_STATS = new Set<string>(
  MASTERY_PATHS.flatMap((p) => p.nodes).flatMap((n) =>
    n.statBonus ? Object.keys(n.statBonus) : [],
  ),
);

describe('what a node grants, in words', () => {
  it('has a label for every modifier the trees grant', () => {
    const unlabelled = [...GRANTED_MODIFIERS].filter((k) => !MODIFIER_LABEL[k]);
    expect(unlabelled).toEqual([]);
  });

  it('has a label for every stat the trees grant', () => {
    const unlabelled = [...GRANTED_STATS].filter((k) => !STAT_LABELS[k]);
    expect(unlabelled).toEqual([]);
  });

  /**
   * A label is prose, not a field name.
   *
   * The fallback that shipped produced exactly the key back, so a label that
   * merely *exists* is not enough — one written as `(v) => \`aoeDamageBonus ${v}\``
   * would pass the check above and read identically to the bug.
   */
  it('never renders a raw field name at the player', () => {
    const leaking: string[] = [];
    for (const key of GRANTED_MODIFIERS) {
      const text = MODIFIER_LABEL[key]?.(0.15) ?? '';
      if (text.includes(key)) leaking.push(`${key}: "${text}"`);
    }
    expect(leaking).toEqual([]);
  });

  /**
   * Ranks land on figures like 0.1125, and a panel of decimals reads as a bug.
   *
   * Swept across the three rungs of a typical fractional modifier rather than
   * one value, because rounding that is clean at the authored middle is exactly
   * what is not clean at 0.75 of it.
   */
  it('rounds every fractional modifier to something readable', () => {
    const ugly: string[] = [];
    for (const key of GRANTED_MODIFIERS) {
      // Integer keys are excluded because they never *see* a fraction:
      // `nodeModifierAt` refuses to scale them, so feeding one 0.1125 here
      // would be measuring an input the game cannot produce. Read off the real
      // set rather than a list restated here, which is the copy that drifts.
      if (INTEGER_MODIFIERS.has(key as never)) continue;
      for (const v of [0.15 * 0.75, 0.15, 0.15 * 1.25, 0.2 * 0.75]) {
        const text = MODIFIER_LABEL[key]?.(v) ?? '';
        // Three or more decimal places is the tell: 11.25% is arguable, 11.249%
        // is a float that escaped.
        if (/\d\.\d{3,}/.test(text)) ugly.push(`${key}: "${text}"`);
      }
    }
    expect(ugly).toEqual([]);
  });

});

/**
 * The current-versus-next line, which is requirement three of the three this
 * work exists to satisfy: a player raising a node should be told what the point
 * buys *before* spending it.
 */
describe('the next-level preview', () => {
  it('shows both rungs when a node has one left to buy', () => {
    expect(grantPair('+23 HP', '+30 HP')).toBe('+23 HP → +30 HP');
  });

  it('shows one rung on an unowned node, which has no current value', () => {
    expect(grantPair(null, '+23 HP')).toBe('+23 HP');
  });

  it('shows one rung at max level, which has no next', () => {
    expect(grantPair('+38 HP', null)).toBe('+38 HP');
  });

  /**
   * An integer modifier is the same at every rank — `skillRangeBonus` is hexes
   * and `nodeModifierAt` deliberately refuses to scale it — so the two halves
   * are equal and "+1 range → +1 range" would read as a broken arrow rather
   * than as a node that does not grow.
   */
  it('collapses when the rank does not move the number', () => {
    expect(grantPair('+1 range', '+1 range')).toBe('+1 range');
  });
});

/**
 * A passive is a node too, and for a long time it was the one kind that could
 * not state what it granted.
 *
 * The tree printed a passive's flavour line and, if the node had a rung left,
 * the sentence "Stronger at each level." Under a comment explaining why: a
 * passive keeps its magnitude in its resolver rather than on the node, so there
 * was no figure to preview.
 *
 * Both halves were a defect a player found before this suite did.
 *
 *  - **Spite** grants `intimidating` and offered "What you drag onto you swings
 *    weaker" — no number, at any rung, for a point priced exactly like the
 *    `+30 HP` node beside it, which prints its 30.
 *  - **Follow-Through** was worse than silent. Its node grants a skill *and* a
 *    passive, and the passive's resolver takes no `rank` at all — so the panel
 *    stated a scaling that does not exist, on the one node arrangement where a
 *    player cannot check by playing, because the skill half really does scale.
 *
 * `PassiveDef.figures(rank)` closes both, and these three rules are what stop it
 * reopening. A passive nothing in a tree grants is exempt from all of them: an
 * enemy's passive is never rendered in a panel, and a table of figures nobody
 * reads is a table nobody maintains — the same argument `GRANTED_MODIFIERS`
 * makes one rule up.
 */
describe('what a passive grants, in numbers', () => {
  /** Every passive any node in any shipped tree hands to a hero. */
  const GRANTED_PASSIVES = [
    ...new Set(
      MASTERY_PATHS.flatMap((p) => p.nodes)
        .map((n) => n.grantsPassive)
        .filter((id): id is PassiveId => !!id),
    ),
  ];

  /** The three rungs, through the engine's own conversion. */
  const RUNGS: PassiveRank[] = LEVEL_SCALE.map((scale, i) => ({ level: i + 1, scale }));

  it('grants at least one passive, or the rules below prove nothing', () => {
    expect(GRANTED_PASSIVES.length).toBeGreaterThan(0);
  });

  it('states its own numbers on every passive a tree can grant', () => {
    const silent = GRANTED_PASSIVES.filter((id) => !PASSIVE_DEFS[id].figures);
    expect(silent).toEqual([]);
  });

  /**
   * And states them **once**.
   *
   * A magnitude baked into the description is the level-2 value written down a
   * second time, which makes it wrong at two of the three rungs — the identical
   * failure `nodeStatBonusAt` was introduced to fix on the stat lines, where a
   * node held at 1 of 3 advertised numbers a quarter larger than it granted.
   * Bloodscent's "restores 15% of your maximum health" is 11.25% at rank 1.
   *
   * Digits rather than a cleverer match: any figure worth reading has one, and a
   * rule that can be argued with is a rule that gets argued with.
   */
  it('keeps the figure out of the prose, so it cannot be stale', () => {
    const doubled = GRANTED_PASSIVES.filter((id) => /\d/.test(passiveDescription(id)));
    expect(doubled).toEqual([]);
  });

  /**
   * The panel pairs rung against rung *positionally* to draw "now → next", so a
   * figure that vanishes at one rank would silently slide every entry after it
   * one place and print one number against another number's label.
   *
   * A figure that switches off is a phrase saying so, never a missing entry.
   */
  it('reports the same figures at every rung, so the arrow pairs correctly', () => {
    // Only the ones that define figures at all — a missing table is the rule
    // above's failure, and reporting it twice buries the one that is new.
    const ragged = GRANTED_PASSIVES.filter((id) => {
      const figures = PASSIVE_DEFS[id].figures;
      if (!figures) return false;
      const counts = RUNGS.map((rank) => figures(rank).length);
      return new Set(counts).size !== 1;
    });
    expect(ragged).toEqual([]);
  });

  /**
   * **A rung must never buy nothing**, and this is the rule Braced broke.
   *
   * `PassiveRank.scale` is 0.75 / 1 / 1.25, and a small integer cannot survive
   * that: Braced granted `round(BRACED_STEP × scale)` defence per hit, which is
   * `round(1.5)` = 2 at rank 1 and 2 at rank 2. A player spending their second
   * point on it got **the same passive back**, and nothing said so — the panel
   * collapsed the arrow to a single value, which reads as "this figure does not
   * move" rather than "this point was wasted".
   *
   * So a passive's figures must be either *identical at all three rungs* — a
   * genuinely flat passive like Follow-Through, which the panel labels "Does not
   * scale" — or *pairwise distinct*. The state in between is the bug: a ladder
   * with a dead step on it. Stated this way rather than as "every passive must
   * scale", because several honestly do not and forcing them to would be
   * inventing magnitudes to satisfy a test.
   */
  it('never offers a rung that buys nothing', () => {
    const dead = GRANTED_PASSIVES.filter((id) => {
      const figures = PASSIVE_DEFS[id].figures;
      if (!figures) return false;
      const rungs = RUNGS.map((rank) => figures(rank).join(' · '));
      const distinct = new Set(rungs).size;
      // 1 is flat and legal; 3 is a real ladder. 2 means one step is a no-op.
      return distinct !== 1 && distinct !== rungs.length;
    });
    expect(dead).toEqual([]);
  });

  /**
   * The two named cases, pinned by behaviour rather than by string.
   *
   * Spite has to move with the rank — it is a scaled magnitude and the whole
   * complaint was that the tree would not say so. Frenzy must not, and must be
   * *detectably* flat, because that is what lets the panel print "Does not
   * scale" instead of the sentence that was false.
   */
  it('moves Spite with the rank and holds Frenzy still', () => {
    const spite = PASSIVE_DEFS.intimidating.figures!;
    expect(spite(RUNGS[0])).not.toEqual(spite(RUNGS[2]));

    const frenzy = PASSIVE_DEFS.frenzy.figures!;
    expect(frenzy(RUNGS[0])).toEqual(frenzy(RUNGS[2]));
  });
});
