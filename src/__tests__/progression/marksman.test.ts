import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { strikeScales } from '@/systems/combat/statusEffects';
import { concussiveShot, rapidFire, markTarget, hamstringShot } from '@/data/skills/masterySkills';
import { skillEffectLines } from '@/data/display/skillDisplay';
import { findMasteryPath } from '@/data/skills/masteryData';
import { BALANCE } from '@/data/balanceConstants';
import { rainOfArrows, slash } from '@/data/skills/skillData';
import { ActiveEffect, AfflictionType, AuraType, CombatUnit, HeroStats } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';
import { spyDice } from '../support/dice';
import { requireUnit } from '@/systems/combat/unitLookup';

/**
 * The Marksman: a burst, a narrower window, and a reason to stack crit.
 *
 * The path's three tier-3 answers all key off the same idea — that a shot you
 * roll five times is a different object from a shot you roll once — so these
 * tests care mostly about the *shape* of the trade rather than its numbers.
 */

const noVariance = { critChance: 0, dodgeChance: 0 };

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ maxMana: 60, ...over });

const unit = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ stats: stats(), ...over });

const burst: ActiveEffect = { type: AuraType.RapidFire, magnitude: 1, duration: 3 };

// ─── Rapid Fire ───────────────────────────────────────────────────────────────

describe('rapid fire', () => {
  it('splits a shot into five, each worth a fraction of it', () => {
    const archer = unit({ activeEffects: [burst] });
    const scales = strikeScales(archer, hamstringShot);
    expect(scales.length).toBe(BALANCE.RAPID_FIRE_STRIKES);
    expect(scales.reduce((a, b) => a + b, 0)).toBeCloseTo(BALANCE.RAPID_FIRE_TOTAL);
    for (const scale of scales) expect(scale).toBeLessThan(1);
  });

  /**
   * A burst of five arrows is not a Volley. The aura says "your aimed shots
   * arrive as a burst", and applying it to a cone would multiply an area skill
   * by five, which is a different card entirely.
   */
  it('leaves area skills alone', () => {
    const archer = unit({ activeEffects: [burst] });
    expect(strikeScales(archer, rainOfArrows)).toEqual([1]);
  });

  it('does nothing without the aura', () => {
    expect(strikeScales(unit(), hamstringShot)).toEqual([1]);
  });

  it('actually lands five times, for more in total than one shot', () => {
    // Crit and dodge off on both sides: five independent rolls is exactly the
    // thing this skill changes, so leaving them on would make the assertion a
    // statement about the dice.
    const target = () =>
      unit({ isPlayer: false, position: { q: 1, r: 0 }, stats: stats({ maxHp: 900, ...noVariance }) });

    const archer = unit({
      position: { q: 0, r: 0 }, skills: [hamstringShot],
      activeEffects: [burst], stats: stats(noVariance),
    });
    const foe = target();
    useCombatStore.setState({ units: [archer, foe] });
    resolveSkillUse(archer, hamstringShot, foe.position, SILENT_SINK);
    const bursted = 900 - requireUnit(useCombatStore.getState().units, foe.id).currentHp;

    const plain = unit({ position: { q: 0, r: 0 }, skills: [hamstringShot], stats: stats(noVariance) });
    const foe2 = target();
    useCombatStore.setState({ units: [plain, foe2] });
    resolveSkillUse(plain, hamstringShot, foe2.position, SILENT_SINK);
    const single = 900 - requireUnit(useCombatStore.getState().units, foe2.id).currentHp;

    expect(single).toBeGreaterThan(0);
    expect(bursted).toBeGreaterThan(single);
    // Each arrow rounds on its own, so the burst overshoots the nominal total
    // slightly. Banded rather than exact for that reason.
    expect(bursted / single).toBeGreaterThan(BALANCE.RAPID_FIRE_TOTAL * 0.9);
    expect(bursted / single).toBeLessThan(BALANCE.RAPID_FIRE_TOTAL * 1.15);
  });

  /**
   * The scale lands on the *finished* damage, not on the skill's multiplier,
   * and that is a decision rather than an implementation detail.
   *
   * Mitigation is subtractive, so splitting the multiplier would have run every
   * arrow through the subtraction at a fifth of the power — against any real
   * armour each one would floor, and the capstone would read as "your shots do
   * nothing now" against exactly the targets it is meant for. Scaling the
   * result keeps each arrow an honest third of the shot it came from, so the
   * burst is worth the same 1.5× whatever it is aimed at.
   */
  it('holds its value against armour rather than dissolving against it', () => {
    const ratio = (defense: number) => {
      const target = () =>
        unit({
          isPlayer: false, position: { q: 1, r: 0 },
          stats: stats({ maxHp: 900, defense, ...noVariance }),
        });

      const archer = unit({
        position: { q: 0, r: 0 }, skills: [hamstringShot],
        activeEffects: [burst], stats: stats(noVariance),
      });
      const foe = target();
      useCombatStore.setState({ units: [archer, foe] });
      resolveSkillUse(archer, hamstringShot, foe.position, SILENT_SINK);
      const bursted = 900 - requireUnit(useCombatStore.getState().units, foe.id).currentHp;

      const plain = unit({
        position: { q: 0, r: 0 }, skills: [hamstringShot], stats: stats(noVariance),
      });
      const foe2 = target();
      useCombatStore.setState({ units: [plain, foe2] });
      resolveSkillUse(plain, hamstringShot, foe2.position, SILENT_SINK);
      const single = 900 - requireUnit(useCombatStore.getState().units, foe2.id).currentHp;

      return bursted / single;
    };

    expect(ratio(14)).toBeGreaterThan(BALANCE.RAPID_FIRE_TOTAL * 0.9);
  });

  /**
   * Five kill checks rather than one. A burst aimed at something nearly dead
   * stops at the corpse, which is the half of the skill that has nothing to do
   * with its damage number.
   */
  it('stops at the corpse instead of emptying into it', () => {
    const archer = unit({
      position: { q: 0, r: 0 }, skills: [hamstringShot],
      activeEffects: [burst], stats: stats(noVariance),
    });
    const foe = unit({
      isPlayer: false, position: { q: 1, r: 0 }, stats: stats({ maxHp: 900, ...noVariance }),
    });
    foe.currentHp = 1;
    useCombatStore.setState({ units: [archer, foe] });
    resolveSkillUse(archer, hamstringShot, foe.position, SILENT_SINK);
    expect(requireUnit(useCombatStore.getState().units, foe.id).currentHp).toBe(0);
  });

  it('spends its mana once, not once per arrow', () => {
    const archer = unit({
      position: { q: 0, r: 0 }, skills: [hamstringShot],
      activeEffects: [burst], stats: stats(noVariance),
    });
    const foe = unit({
      isPlayer: false, position: { q: 1, r: 0 }, stats: stats({ maxHp: 900, ...noVariance }),
    });
    useCombatStore.setState({ units: [archer, foe] });
    resolveSkillUse(archer, hamstringShot, foe.position, SILENT_SINK);
    const spent =
      archer.stats.maxMana -
      requireUnit(useCombatStore.getState().units, archer.id).currentMana;
    expect(spent).toBe(hamstringShot.manaCost);
  });

  it('is a window, not a stance', () => {
    const applied = Array.isArray(rapidFire.appliesEffect)
      ? rapidFire.appliesEffect[0]
      : rapidFire.appliesEffect!;
    expect(rapidFire.cooldown!).toBeGreaterThan(applied.duration);
  });
});

// ─── Concussive Shot ──────────────────────────────────────────────────────────

/**
 * Execute's replacement (playtest 2026-10-13): two hexes of knockback, and a Stun
 * when the shove is cut short by something solid.
 */
describe('concussive shot', () => {
  beforeEach(() => useCombatStore.getState().reset());

  const stage = (foe: CombatUnit, extra: CombatUnit[] = [], archer = unit({ id: 'archer', position: { q: 0, r: 0 } })) => {
    useCombatStore.setState({ units: [archer, foe, ...extra] });
    resolveSkillUse(requireUnit(useCombatStore.getState().units, 'archer'), concussiveShot, foe.position, SILENT_SINK);
    return requireUnit(useCombatStore.getState().units, foe.id);
  };
  const stunned = (u: CombatUnit) => u.activeEffects.some((e) => e.type === AfflictionType.Stun);

  it('knocks an enemy two hexes away on open ground, with no Stun', () => {
    const foe = stage(unit({ id: 'foe', isPlayer: false, position: { q: 0, r: 2 } }));
    expect(foe.position).toEqual({ q: 0, r: 4 });
    expect(stunned(foe)).toBe(false);
  });

  it('stuns an enemy driven into another body', () => {
    const blocker = unit({ id: 'blocker', isPlayer: false, position: { q: 0, r: 4 } });
    const foe = stage(unit({ id: 'foe', isPlayer: false, position: { q: 0, r: 2 } }), [blocker]);
    expect(foe.position).toEqual({ q: 0, r: 3 });
    expect(stunned(foe)).toBe(true);
    expect(stunned(requireUnit(useCombatStore.getState().units, 'blocker'))).toBe(false);
  });

  it('leaves an Immovable enemy where it stands, unstunned', () => {
    const foe = stage(unit({ id: 'foe', isPlayer: false, position: { q: 0, r: 2 }, passives: ['immovable'] }));
    expect(foe.position).toEqual({ q: 0, r: 2 });
    expect(stunned(foe)).toBe(false);
  });

  it('lands every arrow of a Rapid Fire burst before the shove', () => {
    // No dodges and no crits, so the two totals differ only by the burst
    const dice = spyDice().mockReturnValue(0.99);
    const archer = unit({ id: 'archer', position: { q: 0, r: 0 }, activeEffects: [burst] });
    const foe = stage(unit({ id: 'foe', isPlayer: false, position: { q: 0, r: 2 }, stats: stats({ maxHp: 5000 }) }), [], archer);
    const single = stage(unit({ id: 'foe', isPlayer: false, position: { q: 0, r: 2 }, stats: stats({ maxHp: 5000 }) }));
    expect(foe.position).toEqual({ q: 0, r: 4 });
    expect(5000 - foe.currentHp).toBeGreaterThan(5000 - single.currentHp);
    dice.mockRestore();
  });

  it('says what it does on the tooltip', () => {
    expect(skillEffectLines(concussiveShot).join(' ')).toMatch(/Stun.* if knocked into something/);
  });
});

// ─── The tree ─────────────────────────────────────────────────────────────────

describe('the marksman tree', () => {
  const path = findMasteryPath('marksman')!;

  it('no longer leans on the Berserker’s kill passives', () => {
    const passives = path.nodes.map((node) => node.grantsPassive).filter(Boolean);
    expect(passives).not.toContain('bloodscent');
    expect(passives).not.toContain('frenzy');
  });

  /** Covering Fire replaced Follow-Through whole: no node still grants its free turn. */
  it('retired Follow-Through, skill and free-turn passive both', () => {
    expect(path.nodes.some((node) => node.grantsSkill === ('follow_through' as never))).toBe(false);
    expect(path.nodes.some((node) => (node.grantsPassive as string) === 'followThrough')).toBe(false);
    const capstones = path.nodes.filter((node) => node.tier === 3).map((node) => node.grantsSkill);
    expect(capstones).toEqual(expect.arrayContaining(['aimed_shot', 'rapid_fire', 'covering_fire']));
  });

  /** Mark and the plain shot both benefit — the burst is not a one-skill buff. */
  it('leaves the archer several shots worth bursting', () => {
    const archer = unit({ activeEffects: [burst] });
    for (const skill of [markTarget, hamstringShot, concussiveShot, slash]) {
      expect(strikeScales(archer, skill).length).toBe(BALANCE.RAPID_FIRE_STRIKES);
    }
  });
});
