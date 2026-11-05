import { dashGapClosed, resolveSelfMove, selfMoveBlocked, selfMoveIsThePoint } from '@/systems/combat/forcedMovement';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { useCombatStore } from '@/stores/combatStore';
import { charge, disengage, ghostTouch } from '@/data/skills/skillData';
import { shadowstep } from '@/data/skills/masterySkills';
import { AfflictionType, CombatUnit, HexCoord } from '@/models/types';
import { hexKey } from '@/utils/hexUtils';
import { at, makeEffect, makeFoe, makeStats, makeUnit } from '../support/fixtures';

/**
 * Root pins a unit in place; Silence stops it acting. That is the whole point
 * of the pair, and `getMovementRange` has always honoured it for the Move
 * button — but `resolveSelfMove` never asked, so a rooted unit could still
 * dash, blink, reposition or withdraw. Root bound the one kind of movement the
 * game does not consider interesting.
 *
 * The fix is a single check inside the shared resolver, which is why these
 * tests reach for the three consumers rather than for the four `SelfMoveSpec`
 * kinds: the player's resolver, `enemyAI`'s execution path and the targeting
 * highlights all come through `resolveSelfMove`, and a rule enforced in only
 * some of them is exactly how knockback came to be silently missing on the
 * enemy side.
 */

const rooted = () => [makeEffect(AfflictionType.Root, { duration: 2 })];

const hero = (position: HexCoord, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ position, stats: makeStats({ defense: 0 }), ...over });

const foe = (position: HexCoord, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeFoe({ position, stats: makeStats({ defense: 0 }), ...over });

/** A `free` reposition, a `blink`, a `dash` and a `retreat`, by real skill. */
const KINDS = [
  { kind: 'free', skill: disengage },
  { kind: 'blink', skill: shadowstep },
  { kind: 'dash', skill: charge },
  { kind: 'retreat', skill: ghostTouch },
] as const;

describe('resolveSelfMove under Root', () => {
  /**
   * All four kinds in one table. The bug was that only `getMovementRange`
   * checked, so naming the kinds individually would let a fifth arrive
   * unchecked — every one of them is the caster leaving its hex.
   */
  it.each(KINDS)('refuses a $kind', ({ kind, skill }) => {
    const caster = hero(at(0, 0), { activeEffects: rooted() });
    const victim = foe(at(0, 2));
    const aim = kind === 'free' || kind === 'blink' ? at(1, 1) : victim.position;
    expect(resolveSelfMove(caster, skill, aim, [caster, victim])).toBeNull();
  });

  /**
   * The control. A `free` and a `blink` name an exact hex and refuse an
   * occupied one whatever the caster's state, so those two are aimed at bare
   * ground — otherwise this would pass for the wrong reason and go on passing
   * with the Root check removed.
   */
  it.each(KINDS)('still resolves a $kind when the caster is free', ({ kind, skill }) => {
    const caster = hero(at(0, 0));
    const victim = foe(at(0, 2));
    const aim = kind === 'free' || kind === 'blink' ? at(1, 1) : victim.position;
    expect(resolveSelfMove(caster, skill, aim, [caster, victim])).not.toBeNull();
  });

  /**
   * The exception, and the reason `selfMoveBlocked` exists rather than a bare
   * "is the caster rooted". A charge aimed at somebody already adjacent covers
   * no ground, so there is nothing for a Root to prevent and the swing lands.
   */
  it('does not block a gap-closer aimed at an adjacent enemy', () => {
    const caster = hero(at(0, 0), { activeEffects: rooted() });
    const victim = foe(at(1, 0));
    expect(dashGapClosed(caster, charge, victim.position)).toBe(true);
    expect(selfMoveBlocked(caster, charge, victim.position, [caster, victim])).toBe(false);
  });

  it('blocks the same charge once there is ground to cover', () => {
    const caster = hero(at(0, 0), { activeEffects: rooted() });
    const victim = foe(at(0, 3));
    expect(selfMoveBlocked(caster, charge, victim.position, [caster, victim])).toBe(true);
  });

  /** Only the two kinds that name an exact destination *are* their own skill. */
  it('names free and blink as skills a rooted caster cannot cast at all', () => {
    expect(KINDS.filter((k) => selfMoveIsThePoint(k.skill)).map((k) => k.kind)).toEqual([
      'free',
      'blink',
    ]);
  });
});

describe('the board while rooted', () => {
  it('offers nothing for a skill whose whole payload is the arrival', () => {
    const caster = hero(at(0, 0), { activeEffects: rooted() });
    const victim = foe(at(0, 2));
    expect(getValidSkillTargetHexes(shadowstep, caster, [caster, victim])).toEqual([]);
    expect(getValidSkillTargetHexes(disengage, caster, [caster, victim])).toEqual([]);
  });

  /**
   * A gap-closer keeps exactly the hexes it can still be used on, so the board
   * answers "who can I still hit" rather than the player pressing the button
   * and reading a toast.
   */
  it('offers a gap-closer only where no ground has to be covered', () => {
    const caster = hero(at(0, 0), { activeEffects: rooted() });
    const near = foe(at(1, 0));
    const far = foe(at(0, 3));
    const offered = getValidSkillTargetHexes(charge, caster, [caster, near, far]).map(hexKey);
    expect(offered).toContain(hexKey(near.position));
    expect(offered).not.toContain(hexKey(far.position));
  });

  it('offers both once the Root is gone', () => {
    const caster = hero(at(0, 0));
    const near = foe(at(1, 0));
    const far = foe(at(0, 3));
    const offered = getValidSkillTargetHexes(charge, caster, [caster, near, far]).map(hexKey);
    expect(offered).toEqual(expect.arrayContaining([hexKey(near.position), hexKey(far.position)]));
  });

  /**
   * The same filter catches the case Root generalises: a target hemmed in on
   * all six sides has no hex to arrive on either, and the resolver has always
   * refused it as `no-landing` while the board went on offering it.
   */
  it('offers no charge at a target surrounded on all six sides', () => {
    const caster = hero(at(0, 0));
    const victim = foe(at(0, 3));
    const escort = [
      at(1, 3), at(-1, 3), at(0, 2), at(0, 4), at(1, 2), at(-1, 4),
    ].map((p, i) => foe(p, { id: `escort${i}` }));
    const offered = getValidSkillTargetHexes(charge, caster, [caster, victim, ...escort]).map(hexKey);
    expect(offered).not.toContain(hexKey(victim.position));
  });
});

describe('the player resolver while rooted', () => {
  const cast = (caster: CombatUnit, skill: typeof charge, target: HexCoord, units: CombatUnit[]) => {
    useCombatStore.setState({ units });
    return resolveSkillUse(caster, skill, target, SILENT_SINK);
  };

  it.each([
    { kind: 'free', skill: disengage, target: at(0, 2) },
    { kind: 'blink', skill: shadowstep, target: at(0, 2) },
    { kind: 'dash', skill: charge, target: at(0, 3) },
  ])('refuses a $kind with a reason naming the Root', ({ skill, target }) => {
    const caster = hero(at(0, 0), { activeEffects: rooted() });
    const victim = foe(at(0, 3));
    const result = cast(caster, skill, target, [caster, victim]);

    expect(result.ok).toBe(false);
    expect(result.refusal).toBe('rooted');
    // A dead button is the failure this replaces: the toast has to say Root
    // rather than "Cannot blink there" about a hex that is perfectly fine.
    expect(result.message).toMatch(/rooted/i);
    expect(result.endsTurn).toBe(false);
  });

  it('lets a rooted charge land on an adjacent enemy without moving', () => {
    const caster = hero(at(0, 0), { activeEffects: rooted() });
    const victim = foe(at(1, 0));
    const result = cast(caster, charge, victim.position, [caster, victim]);

    expect(result.ok).toBe(true);
    const after = useCombatStore.getState().units;
    expect(after.find((u) => u.id === caster.id)!.position).toEqual(at(0, 0));
    expect(after.find((u) => u.id === victim.id)!.currentHp).toBeLessThan(victim.stats.maxHp);
  });

  /**
   * Retreat is the one kind that never refuses: it is always a rider on a
   * strike, so the strike lands and only the withdrawal is dropped.
   */
  it('lands a hit-and-run strike but leaves the rooted caster where it stood', () => {
    const caster = hero(at(0, 0), { activeEffects: rooted() });
    const victim = foe(at(1, 0));
    const result = cast(caster, ghostTouch, victim.position, [caster, victim]);

    expect(result.ok).toBe(true);
    const after = useCombatStore.getState().units;
    expect(after.find((u) => u.id === caster.id)!.position).toEqual(at(0, 0));
    expect(after.find((u) => u.id === victim.id)!.currentHp).toBeLessThan(victim.stats.maxHp);
  });

  it('does withdraw when the same caster is free', () => {
    const caster = hero(at(0, 0));
    const victim = foe(at(1, 0));
    cast(caster, ghostTouch, victim.position, [caster, victim]);
    expect(useCombatStore.getState().units.find((u) => u.id === caster.id)!.position)
      .not.toEqual(at(0, 0));
  });
});

describe('the AI while rooted', () => {
  /**
   * The other half of the shared-resolver argument. `enemyAI` scores its own
   * targets and never asks the highlight pass anything, so a rule that lived in
   * `getValidSkillTargetHexes` would bind the player and nobody else.
   */
  it('does not pick a charge it cannot make', () => {
    const brute = foe(at(0, -3), { skills: [charge], activeEffects: rooted() });
    const prey = hero(at(0, 0));
    const chosen = decideEnemyAction(brute, [brute, prey])
      .filter((a) => a.type === 'skill')
      .map((a) => a.skill?.id);
    expect(chosen).toEqual([]);
  });

  it('picks it as soon as the Root expires', () => {
    const brute = foe(at(0, -3), { skills: [charge] });
    const prey = hero(at(0, 0));
    const chosen = decideEnemyAction(brute, [brute, prey])
      .filter((a) => a.type === 'skill')
      .map((a) => a.skill?.id);
    expect(chosen).toEqual(['charge']);
  });

  /**
   * The execution path refuses too, rather than trusting the decision. Landing
   * a melee blow from three hexes away because the approach silently did
   * nothing is the exact shape of the knockback bug this module already carries
   * a comment about.
   */
  it('lands no damage when the approach it was told to make cannot happen', () => {
    const brute = foe(at(0, -3), { skills: [charge], activeEffects: rooted() });
    const prey = hero(at(0, 0));
    useCombatStore.setState({ units: [brute, prey] });

    executeAIActions(brute, [
      { type: 'skill', skill: charge, skillTarget: prey.position },
    ]);

    const after = useCombatStore.getState().units;
    expect(after.find((u) => u.id === prey.id)!.currentHp).toBe(prey.stats.maxHp);
    expect(after.find((u) => u.id === brute.id)!.position).toEqual(at(0, -3));
  });
});
