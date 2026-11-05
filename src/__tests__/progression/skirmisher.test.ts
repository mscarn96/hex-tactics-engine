import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { strikeScales } from '@/systems/combat/statusEffects';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { bladestorm, flurry, bolas, bladeRecall } from '@/data/skills/masterySkills';
import { rainOfArrows } from '@/data/skills/skillData';
import { findMasteryPath } from '@/data/skills/masteryData';
import { BALANCE } from '@/data/balanceConstants';
import {
  ActiveEffect, AfflictionType, AuraType, CombatUnit, HeroSkill, HeroStats, SkillTargetType,
} from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';
import { requireUnit } from '@/systems/combat/unitLookup';

/**
 * The Skirmisher: a path about covering ground in blades.
 *
 * Its two capstones used to be a movement bonus and a death save borrowed from
 * other trees. What these tests mostly pin is that the replacements are *area*
 * cards — a follow-up that only fired on single targets, or a ring that only
 * bit one enemy, would each be a capstone the path is built not to use.
 */

const noVariance = { critChance: 0, dodgeChance: 0 };

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ maxHp: 200, maxMana: 80, ...over });

const unit = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ stats: stats(), ...over });

const storm = (magnitude = 8): ActiveEffect => ({
  type: AuraType.BladeStorm, magnitude, duration: 3,
});
const dance: ActiveEffect = { type: AuraType.Flurry, magnitude: 1, duration: 3 };

// ─── Bolas ────────────────────────────────────────────────────────────────────

describe('bolas', () => {
  /**
   * It was the one skill on an area path that asked the player to pick a single
   * target — and it was the crowd-control skill, so it was answering a charge
   * one member at a time.
   */
  it('tangles a group rather than a target', () => {
    expect(bolas.targetType).not.toBe(SkillTargetType.Single);
    expect(bolas.aoeRadius).toBeGreaterThan(0);
  });

  it('still roots what it catches', () => {
    const applied = Array.isArray(bolas.appliesEffect) ? bolas.appliesEffect : [bolas.appliesEffect!];
    expect(applied.map((e) => e.type)).toContain(AfflictionType.Root);
  });
});

// ─── Bladestorm ───────────────────────────────────────────────────────────────

describe('bladestorm', () => {
  it('opens the whole board up to the skirmisher', () => {
    const base = getCombatEffectiveStats(unit()).moveRange;
    const stormed = getCombatEffectiveStats(unit({ activeEffects: [storm()] })).moveRange;
    expect(stormed - base).toBe(BALANCE.BLADESTORM_MOVE);
    // "Unlimited" only has to mean "further than the arena is wide" — `inArena`
    // bounds play at |q| ≤ 3 and |r| ≤ 5.
    expect(stormed).toBeGreaterThan(12);
  });

  it('cuts everything adjacent when the carrier’s turn comes round', () => {
    const skirmisher = unit({ position: { q: 0, r: 0 }, activeEffects: [storm(8)] });
    const near = unit({ isPlayer: false, position: { q: 1, r: 0 } });
    const alsoNear = unit({ isPlayer: false, position: { q: 0, r: 1 } });
    const far = unit({ isPlayer: false, position: { q: 3, r: 0 } });
    useCombatStore.setState({ units: [skirmisher, near, alsoNear, far] });

    useCombatStore.getState().tickEffectsOnUnit(skirmisher.id);
    const hp = (id: string) => requireUnit(useCombatStore.getState().units, id);

    expect(hp(near.id).currentHp).toBe(200 - 8);
    expect(hp(alsoNear.id).currentHp).toBe(200 - 8);
    expect(hp(far.id).currentHp).toBe(200);
  });

  it('leaves one of the carrier’s blades in what it cuts, not a bleed', () => {
    const skirmisher = unit({ position: { q: 0, r: 0 }, activeEffects: [storm(8)] });
    const near = unit({ isPlayer: false, position: { q: 1, r: 0 } });
    useCombatStore.setState({ units: [skirmisher, near] });

    useCombatStore.getState().tickEffectsOnUnit(skirmisher.id);
    const victim = requireUnit(useCombatStore.getState().units, near.id);
    expect(victim.activeEffects.some((e) => e.type === AfflictionType.Bleed)).toBe(false);
    const blades = victim.activeEffects.find((e) => e.type === AfflictionType.Blades);
    expect(blades).toEqual(expect.objectContaining({ magnitude: 1, sourceUnitId: skirmisher.id }));
  });

  /** No skill in this game has ever hurt its own side, and a ring is no exception. */
  it('never bites the carrier or its allies', () => {
    const skirmisher = unit({ position: { q: 0, r: 0 }, activeEffects: [storm(8)] });
    const ally = unit({ position: { q: 1, r: 0 } });
    useCombatStore.setState({ units: [skirmisher, ally] });

    useCombatStore.getState().tickEffectsOnUnit(skirmisher.id);
    const after = useCombatStore.getState().units;
    expect(requireUnit(after, ally.id).currentHp).toBe(200);
    expect(requireUnit(after, skirmisher.id).currentHp).toBe(200);
  });

  /**
   * Bites on every tick it is up for, unlike the Martyr seal it shares a code
   * path with — the blades are a thing that is happening, not a thing that goes
   * off when it ends.
   */
  it('bites again on the next turn, not once', () => {
    const skirmisher = unit({ position: { q: 0, r: 0 }, activeEffects: [storm(8)] });
    const near = unit({ isPlayer: false, position: { q: 1, r: 0 } });
    useCombatStore.setState({ units: [skirmisher, near] });

    useCombatStore.getState().tickEffectsOnUnit(skirmisher.id);
    useCombatStore.getState().tickEffectsOnUnit(skirmisher.id);
    const victim = requireUnit(useCombatStore.getState().units, near.id);
    // Two bites, and a blade for each
    expect(victim.currentHp).toBe(200 - 8 * 2);
    expect(victim.activeEffects.find((e) => e.type === AfflictionType.Blades)?.magnitude).toBe(2);
  });

  it('is a window, not a stance', () => {
    const applied = Array.isArray(bladestorm.appliesEffect)
      ? bladestorm.appliesEffect[0]
      : bladestorm.appliesEffect!;
    expect(bladestorm.cooldown!).toBeGreaterThan(applied.duration);
  });
});

// ─── Flurry ───────────────────────────────────────────────────────────────────

describe('flurry', () => {
  it('hangs one light blade off a full area strike', () => {
    const scales = strikeScales(unit({ activeEffects: [dance] }), rainOfArrows);
    expect(scales.length).toBe(1 + BALANCE.FLURRY_FOLLOWUPS_AREA);
    expect(scales[0]).toBe(1);
    for (const scale of scales.slice(1)) expect(scale).toBe(BALANCE.FLURRY_SCALE);
  });

  /**
   * The point of the whole rework. A capstone on an area path that only fired
   * on single targets would be worth least on the skills the path is built
   * around.
   */
  it('fires on area skills too', () => {
    const skirmisher = unit({ activeEffects: [dance] });
    for (const skill of [rainOfArrows, bolas]) {
      expect(strikeScales(skirmisher, skill).length).toBe(1 + BALANCE.FLURRY_FOLLOWUPS_AREA);
    }
    // Blade Recall's throw belongs to Fan of Blades: without it only the knives fly
    expect(strikeScales(skirmisher, bladeRecall)).toEqual(Array(BALANCE.FLURRY_FOLLOWUPS_AREA).fill(BALANCE.FLURRY_SCALE));
  });

  // Playtest 2026-10-21, PT-40: a single-target strike keeps two, an area strike one
  it('hangs two light blades off a single-target strike', () => {
    const shot = { ...rainOfArrows, targetType: SkillTargetType.Single, aoeRadius: 0 } satisfies HeroSkill;
    expect(strikeScales(unit({ activeEffects: [dance] }), shot)).toEqual([1, ...Array(BALANCE.FLURRY_FOLLOWUPS_SINGLE).fill(BALANCE.FLURRY_SCALE)]);
  });

  it('does nothing without the aura', () => {
    expect(strikeScales(unit(), rainOfArrows)).toEqual([1]);
  });

  it('actually lands the follow-ups, on every target in the area', () => {
    const target = (q: number) =>
      unit({ isPlayer: false, position: { q, r: 0 }, stats: stats({ maxHp: 900, ...noVariance }) });

    const measure = (effects: ActiveEffect[]) => {
      const skirmisher = unit({
        position: { q: 0, r: 0 }, skills: [rainOfArrows],
        activeEffects: effects, stats: stats(noVariance),
      });
      const a = target(2);
      const b = target(3);
      useCombatStore.setState({ units: [skirmisher, a, b] });
      resolveSkillUse(skirmisher, rainOfArrows, { q: 2, r: 0 }, SILENT_SINK);
      const after = useCombatStore.getState().units;
      return [a, b].map((t) => 900 - requireUnit(after, t.id).currentHp);
    };

    const plain = measure([]);
    const flurried = measure([dance]);
    for (let i = 0; i < plain.length; i++) {
      expect(plain[i]).toBeGreaterThan(0);
      expect(flurried[i]).toBeGreaterThan(plain[i]);
    }
  });

  it('is a window, not a stance', () => {
    const applied = Array.isArray(flurry.appliesEffect)
      ? flurry.appliesEffect[0]
      : flurry.appliesEffect!;
    expect(flurry.cooldown!).toBeGreaterThan(applied.duration);
  });
});

// ─── The tree ─────────────────────────────────────────────────────────────────

describe('the skirmisher tree', () => {
  const path = findMasteryPath('skirmisher')!;

  /**
   * The capstones, specifically — not every node.
   *
   * The complaint this was written for is that the path's *endings* were a
   * shrug: `momentum` (a small bonus for having moved) and `undying` (a death
   * save borrowed from the Templar) sat where Volley, Bladestorm and Flurry are
   * now. `momentum` at tier 1 is a different thing entirely — it is shared
   * vocabulary, carried by the Marksman, the Shadowblade and the Pyromancer
   * too, and "ground covered is force behind the throw" is this path's fantasy
   * rather than a borrowed one.
   */
  it('no longer borrows its capstones from other paths', () => {
    const capstones = path.nodes.filter((n) => n.exclusiveGroup === 'capstone');
    expect(capstones).toHaveLength(3);
    const passives = capstones.map((node) => node.grantsPassive).filter(Boolean);
    expect(passives).not.toContain('momentum');
    expect(passives).not.toContain('undying');
  });

  it('spends both capstones on the area identity', () => {
    const capstones = path.nodes.filter((node) => node.tier === 3).map((node) => node.grantsSkill);
    expect(capstones).toContain('bladestorm');
    expect(capstones).toContain('flurry');
  });

  /** Every damaging skill the path grants is an area skill bar the retreat. */
  it('leaves almost nothing single-target to throw', () => {
    const single = [bladeRecall, bolas].filter(
      (skill) => skill.targetType === SkillTargetType.Single,
    );
    expect(single).toEqual([]);
  });
});
