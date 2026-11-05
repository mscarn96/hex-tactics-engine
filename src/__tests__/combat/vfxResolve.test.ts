import { resolveVfxKind, resolveVfxColor, resolveVfxScale } from '@/systems/combat/vfxResolve';
import { HeroSkill, SkillTargetType, AfflictionType } from '@/models/types';
import * as skills from '@/data/skills/skillData';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { imperialCleave } from '@/data/templates/aethelred';

/**
 * Every skill the game can actually play an effect for — the neutral list, the
 * twelve trees, and the boss's own.
 *
 * `arcFootprint.test.ts` assembles the same three for the same reason: a rule
 * that only sweeps `MASTERY_SKILLS` stops applying the moment the skill it was
 * written about lives somewhere else, and it fails by going quiet.
 */
function allAreaSkills(): HeroSkill[] {
  return [
    ...Object.values(skills).filter(
      (s): s is HeroSkill => typeof s === 'object' && s !== null && 'targetType' in s,
    ),
    ...MASTERY_SKILLS,
    imperialCleave,
  ];
}

function makeSkill(over: Partial<HeroSkill>): HeroSkill {
  return {
    id: 'slash',
    name: 'Test',
    description: '',
    targetType: SkillTargetType.Single,
    range: 1,
    unlockLevel: 1,
    manaCost: 0,
    ...over,
  } as HeroSkill;
}

describe('resolveVfxKind', () => {
  it('draws damaging melee dashes as landed slashes even with ranged reach or an old missile kind', () => {
    const skill = makeSkill({ damage: 1, range: 4, selfMove: { kind: 'dash', range: 3 }, vfxKind: 'bolt' });
    expect(resolveVfxKind(skill)).toBe('slash');
  });
  it('prefers an explicit vfxKind over the derivation', () => {
    const skill = makeSkill({ vfxKind: 'meteor', targetType: SkillTargetType.Single, range: 1, damage: 1 });
    expect(resolveVfxKind(skill)).toBe('meteor');
  });

  it('derives melee vs ranged from range on single-target damage', () => {
    expect(resolveVfxKind(makeSkill({ range: 1, damage: 1 }))).toBe('slash');
    expect(resolveVfxKind(makeSkill({ range: 3, damage: 1 }))).toBe('bolt');
  });

  it('treats pure healing as a bloom regardless of shape', () => {
    expect(resolveVfxKind(makeSkill({ healing: 1, range: 2 }))).toBe('bloom');
    expect(
      resolveVfxKind(makeSkill({ healing: 1, targetType: SkillTargetType.Self, aoeRadius: 3, range: 0 })),
    ).toBe('bloom');
  });

  it('treats a skill with no damage and no healing as a buff', () => {
    const provokeLike = makeSkill({
      range: 2,
      appliesEffect: { type: AfflictionType.Taunt, magnitude: 0, duration: 2 },
    });
    expect(resolveVfxKind(provokeLike)).toBe('buff');
  });

  it('splits Ring on range: centred on the caster is a nova, ranged is called down', () => {
    expect(resolveVfxKind(makeSkill({ targetType: SkillTargetType.Ring, range: 0, damage: 1 }))).toBe('nova');
    expect(resolveVfxKind(makeSkill({ targetType: SkillTargetType.Ring, range: 3, damage: 1 }))).toBe('meteor');
  });

  it('maps Arc to the arc effect', () => {
    expect(resolveVfxKind(makeSkill({ targetType: SkillTargetType.Arc, range: 2, damage: 1 }))).toBe('arc');
  });

  // Guards the fallback: every shipped skill must resolve without an explicit vfxKind.
  /**
   * The derivation only ever produces the seven original shapes.
   *
   * `snow`, `ignite` and `quake` are deliberately unreachable from it: nothing
   * about a skill's `targetType`, `range` or `damage` says "this is weather" or
   * "this comes from underneath". They are authored per skill, and a derivation
   * that guessed at them would put a blizzard on every ranged area spell in the
   * game.
   */
  it('resolves every skill in skillData to a known kind', () => {
    const known = ['slash', 'bolt', 'arc', 'nova', 'meteor', 'bloom', 'buff'];
    const all = Object.values(skills).filter(
      (s): s is HeroSkill => typeof s === 'object' && s !== null && 'targetType' in s,
    );
    expect(all.length).toBeGreaterThan(20);
    for (const skill of all) {
      // The authored kind is stripped: an explicit `vfxKind` always wins, so
      // asking with one set measures the authoring rather than the derivation
      // this test is about.
      expect(known).toContain(resolveVfxKind({ ...skill, vfxKind: undefined }));
    }
  });

  it('spot-checks the shapes real skills land on', () => {
    expect(resolveVfxKind(skills.slash)).toBe('slash');
    expect(resolveVfxKind(skills.arcaneBolt)).toBe('bolt');
    expect(resolveVfxKind(skills.cleave)).toBe('arc');
    expect(resolveVfxKind(skills.groundSlam)).toBe('nova');
    expect(resolveVfxKind(skills.meteor)).toBe('meteor');
    expect(resolveVfxKind(skills.divineLight)).toBe('bloom');
  });
});

/**
 * The shapes the large area skills wear.
 *
 * Every one of these shipped as `meteor` or `nova`, and both are single-origin:
 * one thing arrives at one place and a ring goes out from it. A skill whose
 * whole selling point is that it reaches the entire arena cannot be drawn that
 * way, however large the ring is — the picture says "here", and the rule says
 * "everywhere".
 */
describe('the arena-wide skills are not drawn as point impacts', () => {
  const byId = new Map(MASTERY_SKILLS.map((s) => [s.id, s]));
  const kindOf = (id: string) => resolveVfxKind(byId.get(id as never)!);

  it('gives the whole-field skills a whole-field shape', () => {
    expect(kindOf('blizzard')).toBe('snow');
    expect(kindOf('burning_out')).toBe('ignite');
    expect(kindOf('immolation')).toBe('ignite');
    expect(kindOf('bedrock_stand')).toBe('quake');
    expect(kindOf('upheaval')).toBe('quake');
  });

  /**
   * Anything covering two hexes or more has to say so — and the sweep is over
   * every skill the game fields, not only the tree's.
   *
   * The failure this guards is silent and permanent: an area skill omits
   * `vfxKind`, the derivation hands it `meteor` because it is a ranged Ring, and
   * a skill that covers nineteen hexes plays a single rock landing on one tile.
   *
   * **Both halves of this were too narrow, and `rain_of_arrows` went through the
   * gap between them for the whole life of the rule.** It is radius 2, so the
   * old threshold of 3 did not see it; and it lives in `skillData` rather than
   * in a tree, so the old corpus of `MASTERY_SKILLS` alone would not have seen
   * it at any threshold. Widening the corpus is the same move — and the same
   * argument — `arcFootprint.test.ts` makes about the cost rules: a rule stated
   * over one file is a rule that stops applying the moment content moves.
   *
   * Radius 2 is the right floor because it is the smallest footprint that is
   * unambiguously an *area*: a hex and its two rings is nineteen tiles, most of
   * a spawn formation. Radius 1 is seven, which a single impact honestly covers.
   */
  it('never leaves an area skill on a point-impact shape', () => {
    // `throw` is on the list for the same reason `meteor` is: one object, one
    // landing place. That it comes off a hand rather than out of the sky changes
    // where it starts, not how much of the arena it says it covers.
    const POINT_SHAPES = ['slash', 'bolt', 'meteor', 'throw'];

    /**
     * Point impacts that are *correct* at radius 2, one reason each.
     *
     * Named individually and never by predicate: the whole value of this rule is
     * that a new area skill has to be looked at, and a rule that exempts a shape
     * or a target type would quietly exempt everything authored after it.
     */
    const EXEMPT: Record<string, string> = {
      // The archetype `meteor` is named for. One rock, out of the sky, onto the
      // middle of them — the picture and the skill agree completely, and the
      // radius is the crater rather than a claim about coverage.
      meteor: 'literally one falling rock; the radius is its blast, not its reach',
      // One axe, off one hand, at one hex. The Cross footprint is what the axe
      // *does* on arrival — it cleaves along the two lines through where it
      // landed — so the single landing point is the skill's own geometry, not a
      // shortcut around it. `throw` is the only shape that says a person threw it.
      cleaving_throw: 'a single thrown axe; the cross is what it does after it lands',
    };

    const offenders = allAreaSkills()
      .filter((s) => (s.aoeRadius ?? 0) >= 2)
      .filter((s) => POINT_SHAPES.includes(resolveVfxKind(s)))
      .filter((s) => !(s.id in EXEMPT))
      .map((s) => `${s.id}: ${resolveVfxKind(s)}`);
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  /**
   * The volley pair, which is what lowering the threshold actually caught.
   *
   * `rain_of_arrows` derived `meteor` from having no kind at all; `volley` — the
   * Marksman capstone that is the same Ring at the same radius — was *authored*
   * `meteor`. So the class's two area attacks both played as a single burning
   * rock, one by omission and one on purpose, which is the clearest possible
   * argument that the shape was missing rather than that the authoring was lazy.
   */
  it('draws the volley as a volley', () => {
    // Volley itself was retired by the Skirmisher remaster (Knife Dance replaced it)
    expect(resolveVfxKind(skills.rainOfArrows)).toBe('arrows');
  });

  it('keeps every exemption honest — a named skill must still exist', () => {
    const ids = new Set(allAreaSkills().map((s) => s.id));
    expect(['meteor', 'cleaving_throw'].filter((id) => !ids.has(id as never))).toEqual([]);
  });
});

/**
 * A thrown weapon comes off a hand.
 *
 * Bolas is a ranged Ring, which the derivation reads as "called down" and hands
 * `meteor` — an object spawned fourteen units above the target, falling. The
 * Skirmisher stood there having visibly done nothing while cords appeared in the
 * sky, and a playtester reported it as exactly that. `throw` is the shape that
 * starts at `casterPos`, and it is authored rather than derived because nothing
 * on a `HeroSkill` distinguishes a lobbed weapon from a called-down one.
 */
describe('thrown weapons are thrown, not called down', () => {
  const byId = new Map(MASTERY_SKILLS.map((s) => [s.id, s]));

  it('lobs the bolas out of the Skirmisher’s hand', () => {
    expect(resolveVfxKind(byId.get('bolas' as never)!)).toBe('throw');
  });

  it('stays authored — the derivation cannot reach it', () => {
    const asDerived = { ...byId.get('bolas' as never)!, vfxKind: undefined } as HeroSkill;
    expect(resolveVfxKind(asDerived)).not.toBe('throw');
  });
});

// No assertion here that the registry covers every kind: `VFX_REGISTRY` is typed
// `Record<VfxKind, …>`, so a missing entry is a compile error rather than a test
// failure — and importing it would drag three and the R3F intrinsics into a
// node-environment suite that is deliberately free of both.

/**
 * How long a skill's effect plays, relative to the stock timing.
 *
 * The failure this guards is a whole-arena capstone playing in the same
 * half-second as a basic attack — the picture is over before the numbers land.
 * The tiers overlap and the largest applicable one wins, so an ultimate priced
 * like one lingers even when its footprint is small.
 */
describe('resolveVfxScale', () => {
  const byId = new Map(MASTERY_SKILLS.map((s) => [s.id, s]));
  const scaleOf = (id: string) => resolveVfxScale(byId.get(id as never)!);

  it('leaves an ordinary single-target skill at stock speed', () => {
    expect(resolveVfxScale(makeSkill({ damage: 1, range: 1 }))).toBe(1.0);
    expect(resolveVfxScale(skills.slash)).toBe(1.0);
    expect(resolveVfxScale(skills.arcaneBolt)).toBe(1.0);
  });

  it('slows a mid-sized area skill', () => {
    expect(resolveVfxScale(makeSkill({ damage: 1, aoeRadius: 2 }))).toBe(1.4);
  });

  it('gives the whole-arena capstones the longest play time', () => {
    expect(scaleOf('bedrock_stand')).toBe(1.7);
    expect(scaleOf('blizzard')).toBe(1.7);
    expect(scaleOf('burning_out')).toBe(1.7);
  });

  it('qualifies an ultimate by cost as well as by footprint', () => {
    expect(resolveVfxScale(makeSkill({ damage: 1, manaCost: 30 }))).toBe(1.7);
    expect(resolveVfxScale(makeSkill({ damage: 1, cooldown: 4 }))).toBe(1.7);
  });

  it('takes the max when several tiers apply', () => {
    expect(resolveVfxScale(makeSkill({ damage: 1, aoeRadius: 2, manaCost: 30 }))).toBe(1.7);
  });
});

describe('resolveVfxColor', () => {
  it('falls back to the default red when a skill defines no colour', () => {
    expect(resolveVfxColor(makeSkill({}))).toBe('#ff4444');
  });

  it('uses the skill colour when present', () => {
    expect(resolveVfxColor(skills.arcaneBolt)).toBe(skills.arcaneBolt.vfxColor);
  });
});
