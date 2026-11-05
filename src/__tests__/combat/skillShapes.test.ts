import { detonationConsumes, detonationTurns, skillEffects } from '@/systems/combat/statusEffects';
import { conditionalMultiplier, detonationMultiplier, meetsCondition } from '@/systems/combat/damageCalc';
import { resolveSelfMove } from '@/systems/combat/forcedMovement';
import { inArena } from '@/systems/combat/arenaGeometry';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { decideEnemyAction } from '@/systems/combat/enemyAI';
import {
  charge,
  ghostTouch,
  slash,
} from '@/data/skills/skillData';
import { blizzard, frostbite } from '@/data/skills/masterySkills';

import {
  ActiveEffect,
  AfflictionType,
  AuraType,
  CombatUnit,
  DamageCondition,
  HeroSkill,
  HexCoord,
  SkillTargetType,
} from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { makeStats, makeUnit } from '../support/fixtures';
import { ALL_SKILLS } from '@/data/skills/skillData';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';

/**
 * A single-target claw that tears into the wounded, stated here. These tests are
 * about `bonusVs` and the scoring that must not roll for it; they borrowed the
 * Dragon's claw until it became a wide arc with no conditional bonus.
 */
const dragonClaw: HeroSkill = {
  id: 'dragon_claw',
  name: 'Tearing Claw',
  description: 'Slash with massive claws, tearing into wounded prey.',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 2.0,
  bonusVs: { condition: 'lowHp', multiplier: 1.5 },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#ff4444',
  delivery: 'natural',
};

/**
 * A Freeze detonator, stated here rather than borrowed from the roster.
 *
 * These tests are about `detonationMultiplier`'s arithmetic, and pinning them to
 * whichever shipped skill happens to detonate Freeze made them fail when that
 * skill was retired — a data change breaking a maths test. The Hydromancer's
 * real detonator is asserted separately, below.
 */
const freezeDetonator: HeroSkill = {
  id: 'arcane_bolt',
  name: 'Test Detonator',
  description: '',
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 1,
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  detonates: { status: AfflictionType.Freeze, multiplier: 0.6, consume: true },
};

const at = (q: number, r: number): HexCoord => ({ q, r });
const eff = (type: ActiveEffect['type'], over: Partial<ActiveEffect> = {}): ActiveEffect => ({
  type,
  magnitude: 1,
  duration: 3,
  ...over,
});

const unit = (id: string, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ id, isPlayer: false, stats: makeStats({ magic: 20, moveRange: 2, maxMana: 40 }), ...over });

// ─── Conditions ───────────────────────────────────────────────────────────────

describe('bonusVs conditions', () => {
  const attacker = unit('a');
  const check = (c: DamageCondition, target: CombatUnit, roster: CombatUnit[] = []) =>
    meetsCondition(c, attacker, target, roster);

  it('reads each status-backed condition off the target', () => {
    const pairs: Array<[DamageCondition, AfflictionType]> = [
      ['burning', AfflictionType.Burn],
      ['chilled', AfflictionType.Chill],
      ['frozen', AfflictionType.Freeze],
      ['shocked', AfflictionType.Shock],
      ['poisoned', AfflictionType.Poison],
      ['bleeding', AfflictionType.Bleed],
      ['stunned', AfflictionType.Stun],
      ['rooted', AfflictionType.Root],
    ];
    for (const [condition, status] of pairs) {
      expect(check(condition, unit('t', { activeEffects: [eff(status)] }))).toBe(true);
      expect(check(condition, unit('t'))).toBe(false);
    }
  });

  it('treats marked as marker-exclusive, matching the Mark bonus itself', () => {
    const mine = unit('t', {
      activeEffects: [eff(AfflictionType.Mark, { sourceUnitId: 'a' })],
    });
    const theirs = unit('t', {
      activeEffects: [eff(AfflictionType.Mark, { sourceUnitId: 'someone_else' })],
    });
    expect(check('marked', mine)).toBe(true);
    expect(check('marked', theirs)).toBe(false);
  });

  it('reads lowHp and fullHp off the HP bar', () => {
    const threshold = BALANCE.LOW_HP_THRESHOLD;
    expect(check('lowHp', unit('t', { currentHp: 100 * threshold }))).toBe(true);
    expect(check('lowHp', unit('t', { currentHp: 100 }))).toBe(false);
    expect(check('fullHp', unit('t', { currentHp: 100 }))).toBe(true);
    expect(check('fullHp', unit('t', { currentHp: 99 }))).toBe(false);
  });

  describe('isolated', () => {
    const lone = unit('t', { isPlayer: true, position: at(0, 0) });
    const ally = unit('ally', { isPlayer: true, position: at(1, 0) });
    const distantAlly = unit('far', { isPlayer: true, position: at(3, 0) });
    const adjacentFoe = unit('foe', { isPlayer: false, position: at(0, 1) });

    it('holds when no ally stands adjacent', () => {
      expect(check('isolated', lone, [lone, distantAlly, adjacentFoe])).toBe(true);
    });

    it('fails when an ally is adjacent', () => {
      expect(check('isolated', lone, [lone, ally])).toBe(false);
    });

    it('ignores dead allies — a corpse is not company', () => {
      expect(check('isolated', lone, [lone, { ...ally, currentHp: 0 }])).toBe(true);
    });

    // Absent a roster the honest answer is "unknown", and false loses a bonus
    // rather than silently granting one on every single target
    it('reads false rather than true without a roster', () => {
      expect(check('isolated', lone, [])).toBe(false);
    });
  });
});

describe('conditionalMultiplier', () => {
  const attacker = unit('a');
  const wounded = unit('t', { currentHp: 10 });

  it('is 1 for a skill with no bonusVs', () => {
    expect(conditionalMultiplier(attacker, wounded, slash, [])).toBe(1);
  });

  it('applies the multiplier only when the condition holds', () => {
    expect(conditionalMultiplier(attacker, wounded, dragonClaw, [])).toBe(1.5);
    expect(conditionalMultiplier(attacker, unit('t'), dragonClaw, [])).toBe(1);
  });

  it('feeds through the real damage formula', () => {
    const healthy = unit('t');
    const plain = calculateDamage(attacker, healthy, dragonClaw);
    const finisher = calculateDamage(attacker, wounded, dragonClaw);
    expect(finisher).toBe(Math.round(plain * 1.5));
  });
});

// ─── Detonation ───────────────────────────────────────────────────────────────

describe('detonation', () => {
  const attacker = unit('a');
  const frozen = (duration: number) =>
    unit('t', { activeEffects: [eff(AfflictionType.Freeze, { duration })] });

  it('counts remaining turns, capped', () => {
    expect(detonationTurns(2)).toBe(2);
    expect(detonationTurns(99)).toBe(1);
    expect(detonationTurns(-1)).toBe(1);
    expect(detonationTurns(50)).toBe(BALANCE.MAX_DETONATE_TURNS);
  });

  it('scales the strike by what was left of the affliction', () => {
    // Freeze is authored at duration 99, which counts as one turn
    expect(detonationMultiplier(frozen(99), freezeDetonator)).toBeCloseTo(1.6);
    expect(detonationMultiplier(frozen(3), freezeDetonator)).toBeCloseTo(2.8);
  });

  it('does nothing to an unafflicted target or an ordinary skill', () => {
    expect(detonationMultiplier(unit('t'), freezeDetonator)).toBe(1);
    expect(detonationMultiplier(frozen(3), slash)).toBe(1);
  });

  it('ignores an affliction the skill does not detonate', () => {
    const burning = unit('t', { activeEffects: [eff(AfflictionType.Burn)] });
    expect(detonationMultiplier(burning, freezeDetonator)).toBe(1);
  });

  it('reports what it will strip, and only when present', () => {
    expect(detonationConsumes(frozen(99), freezeDetonator)).toBe(AfflictionType.Freeze);
    expect(detonationConsumes(unit('t'), freezeDetonator)).toBeNull();
    expect(detonationConsumes(frozen(99), slash)).toBeNull();
  });

  it('raises real damage through the formula', () => {
    const plain = calculateDamage(attacker, unit('t'), freezeDetonator);
    const shattered = calculateDamage(attacker, frozen(99), freezeDetonator);
    expect(shattered).toBeGreaterThan(plain);
  });

  // A stalled affliction that detonates for an unbounded multiple turns the
  // combo into "stall, then delete something"
  it('cannot be farmed by stacking duration', () => {
    const capped = detonationMultiplier(frozen(BALANCE.MAX_DETONATE_TURNS), freezeDetonator);
    expect(detonationMultiplier(frozen(999), freezeDetonator)).toBe(capped);
  });
});

// ─── Self movement ────────────────────────────────────────────────────────────

describe('selfMove', () => {
  const dashSkill = (range: number): HeroSkill => ({
    ...slash,
    range,
    selfMove: { kind: 'dash', range },
  });
  const blinkSkill: HeroSkill = { ...slash, range: 3, selfMove: { kind: 'blink', range: 3 } };

  describe('dash', () => {
    it('lands adjacent to the target, not on it', () => {
      const caster = unit('c', { position: at(0, 3) });
      const target = unit('t', { isPlayer: true, position: at(0, 0) });
      const dest = resolveSelfMove(caster, dashSkill(3), target.position, [caster, target]);
      expect(dest).not.toEqual(target.position);
      expect(dest).not.toBeNull();
      expect(Math.max(Math.abs(dest!.q), Math.abs(dest!.r), Math.abs(dest!.q + dest!.r))).toBe(1);
    });

    it('picks the closest free landing hex', () => {
      const caster = unit('c', { position: at(0, 3) });
      const target = unit('t', { isPlayer: true, position: at(0, 0) });
      const dest = resolveSelfMove(caster, dashSkill(3), target.position, [caster, target]);
      expect(dest).toEqual(at(0, 1));
    });

    it('refuses to land on an occupied hex', () => {
      const caster = unit('c', { position: at(0, 3) });
      const target = unit('t', { isPlayer: true, position: at(0, 0) });
      const blocker = unit('b', { isPlayer: true, position: at(0, 1) });
      const dest = resolveSelfMove(caster, dashSkill(3), target.position, [caster, target, blocker]);
      expect(dest).not.toEqual(at(0, 1));
      expect(dest).not.toBeNull();
    });

    it('gives up when every landing hex is out of reach', () => {
      const caster = unit('c', { position: at(0, 5) });
      const target = unit('t', { isPlayer: true, position: at(0, 0) });
      expect(resolveSelfMove(caster, dashSkill(1), target.position, [caster, target])).toBeNull();
    });

    it('stays put when already adjacent', () => {
      const caster = unit('c', { position: at(0, 1) });
      const target = unit('t', { isPlayer: true, position: at(0, 0) });
      expect(resolveSelfMove(caster, dashSkill(3), target.position, [caster, target])).toBeNull();
    });

    // Otherwise the same board dashes somewhere different after an unrelated
    // change to neighbour enumeration order
    it('is deterministic across repeated calls', () => {
      const caster = unit('c', { position: at(0, 3) });
      const target = unit('t', { isPlayer: true, position: at(0, 0) });
      const runs = Array.from({ length: 12 }, () =>
        resolveSelfMove(caster, dashSkill(3), target.position, [caster, target])
      );
      expect(new Set(runs.map((r) => `${r!.q},${r!.r}`)).size).toBe(1);
    });

    it('never lands outside the arena', () => {
      const caster = unit('c', { position: at(0, 3) });
      const target = unit('t', { isPlayer: true, position: at(0, 5) });
      const dest = resolveSelfMove(caster, dashSkill(3), target.position, [caster, target]);
      if (dest) expect(inArena(dest)).toBe(true);
    });
  });

  describe('blink', () => {
    it('lands exactly on the named hex', () => {
      const caster = unit('c', { position: at(0, 3) });
      expect(resolveSelfMove(caster, blinkSkill, at(0, 1), [caster])).toEqual(at(0, 1));
    });

    // Landing somewhere else is not the move the player picked
    it('fails rather than approximating when the hex is taken', () => {
      const caster = unit('c', { position: at(0, 3) });
      const sitting = unit('s', { position: at(0, 1) });
      expect(resolveSelfMove(caster, blinkSkill, at(0, 1), [caster, sitting])).toBeNull();
    });

    it('fails beyond its range and outside the arena', () => {
      const caster = unit('c', { position: at(0, 5) });
      expect(resolveSelfMove(caster, blinkSkill, at(0, 0), [caster])).toBeNull();
      expect(resolveSelfMove(caster, blinkSkill, at(0, 9), [caster])).toBeNull();
    });
  });

  describe('retreat', () => {
    const retreatSkill: HeroSkill = { ...slash, selfMove: { kind: 'retreat', range: 2 } };

    it('withdraws directly away from the target', () => {
      const caster = unit('c', { position: at(0, 1) });
      const dest = resolveSelfMove(caster, retreatSkill, at(0, 0), [caster]);
      expect(dest).toEqual(at(0, 3));
    });

    it('stops short at a blocker instead of passing through', () => {
      const caster = unit('c', { position: at(0, 1) });
      const blocker = unit('b', { position: at(0, 3) });
      expect(resolveSelfMove(caster, retreatSkill, at(0, 0), [caster, blocker])).toEqual(at(0, 2));
    });

    it('stays put when boxed in', () => {
      const caster = unit('c', { position: at(0, 4) });
      const wall = unit('w', { position: at(0, 5) });
      expect(resolveSelfMove(caster, retreatSkill, at(0, 3), [caster, wall])).toBeNull();
    });
  });

  it('is a no-op for a skill that does not move its caster', () => {
    const caster = unit('c', { position: at(0, 3) });
    expect(resolveSelfMove(caster, slash, at(0, 0), [caster])).toBeNull();
  });
});

// ─── Live content ─────────────────────────────────────────────────────────────

describe('the skills that now use these shapes', () => {
  it('gives Charge a reach that matches its dash', () => {
    expect(charge.selfMove).toEqual({ kind: 'dash', range: 3 });
    // A dash that cannot be aimed further than a normal swing is not a dash
    expect(charge.range).toBeGreaterThan(1);
    expect(charge.range).toBe(charge.selfMove!.range);
  });

  /**
   * The combo has to be reachable inside one path, or it is a mechanic nobody
   * can set up.
   *
   * No skill applies Freeze directly — a second Chill on an already-chilled
   * target upgrades to it (`combatStore`). So the path's Freeze supply is its
   * Chills: the signature chills one target, and the capstone chills a whole
   * area, which is what turns worked-over ground into a field of frozen units.
   */
  it('feeds Freeze from chills the same path can apply', () => {
    expect(skillEffects(frostbite)[0].type).toBe(AfflictionType.Chill);
    expect(skillEffects(blizzard)[0].type).toBe(AfflictionType.Chill);
    expect(blizzard.aoeRadius ?? 0).toBeGreaterThan(1);
  });

  it('lets the Ghost drift back out of reach', () => {
    expect(ghostTouch.selfMove?.kind).toBe('retreat');
  });

  it('keeps shared skills free of exclusive tuning', () => {
    for (const shared of [slash]) {
      expect(shared.selfMove).toBeUndefined();
      expect(shared.bonusVs).toBeUndefined();
      expect(shared.detonates).toBeUndefined();
    }
  });
});

describe('the AI uses the new shapes', () => {
  const hero = unit('hero', { isPlayer: true, position: at(0, 2) });

  it('picks a dash skill against a target it could not otherwise reach', () => {
    const foe = unit('foe', { skills: [charge], position: at(0, -1) });
    const action = decideEnemyAction(foe, [foe, hero]).find((a) => a.type === 'skill');
    expect(action?.skill?.id).toBe('charge');
  });

  // Scoring must stay free of dice, or the move chosen and the move taken
  // disagree
  it('scores a conditional bonus without rolling for it', () => {
    const wounded = { ...hero, currentHp: 5 };
    const dragon = unit('dragon', { skills: [dragonClaw], position: at(0, 1) });
    const plans = Array.from({ length: 20 }, () =>
      JSON.stringify(decideEnemyAction(dragon, [dragon, wounded]))
    );
    expect(new Set(plans).size).toBe(1);
  });

  it('values a detonatable target above an untouched one', () => {
    const frozenHero = {
      ...hero,
      id: 'frozen',
      position: at(1, 1),
      activeEffects: [eff(AfflictionType.Freeze, { duration: 99 })],
    };
    const plainHero = { ...hero, id: 'plain', position: at(-1, 1) };
    const mage = unit('mage', { skills: [freezeDetonator], position: at(0, 0), currentMana: 40 });
    const action = decideEnemyAction(mage, [mage, frozenHero, plainHero]).find(
      (a) => a.type === 'skill'
    );
    expect(action?.skillTarget).toEqual(frozenHero.position);
  });

  it('will not aim a bonus at an invulnerable target it cannot hurt', () => {
    const warded = {
      ...hero,
      activeEffects: [eff(AuraType.Invulnerability, { duration: 2 })],
    };
    const dragon = unit('dragon', { skills: [dragonClaw], position: at(0, 1) });
    expect(decideEnemyAction(dragon, [dragon, warded]).some((a) => a.type === 'skill')).toBe(false);
  });
});

/**
 * The data side of repositioning skills, pinned as a class.
 *
 * `Self` short-circuits target selection to the caster's own hex, so a skill
 * that blinks to a *chosen* hex could only ever choose the one it was already
 * standing on — it spends the turn doing nothing.
 */
describe('skills that move the caster', () => {
  const EVERY_SKILL: HeroSkill[] = [...ALL_SKILLS, ...MASTERY_SKILLS];

  it('never aims a named destination at the caster', () => {
    const broken = EVERY_SKILL
      .filter((s) => (s.selfMove?.kind === 'blink' || s.selfMove?.kind === 'free'))
      .filter((s) => s.targetType === SkillTargetType.Self)
      .map((s) => s.id);
    expect(broken).toEqual([]);
  });

  it('gives every repositioning skill somewhere to go', () => {
    const stuck = EVERY_SKILL
      .filter((s) => s.selfMove)
      .filter((s) => (s.selfMove!.range ?? 0) <= 0)
      .map((s) => s.id);
    expect(stuck).toEqual([]);
  });

  /**
   * A pure reposition strikes nobody, so the resolver counts the move itself as
   * the skill landing. Anything that neither damages, heals, applies an effect
   * nor summons had better move the caster, or it does nothing at all.
   */
  it('leaves no skill that does literally nothing', () => {
    const inert = EVERY_SKILL
      .filter(
        (s) =>
          !s.damage && !s.healing && !s.appliesEffect && !s.summons &&
          !s.cleanse && !s.selfMove && !s.shiftsTo && !s.pushDistance && !s.reaction && !s.places && !s.deathMark && !s.bastion &&
          // Firefly Motes lays ground that heals and arms whoever arrives on it
          !s.motes &&
          // A charged skill's first use deals nothing; its release does
          !s.charge?.release.damage &&
          // Marked Prey's mark deals nothing; its release is a rule of its own
          !s.mantisCapstone,
      )
      .map((s) => s.id);
    expect(inert).toEqual([]);
  });
});
