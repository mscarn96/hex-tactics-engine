import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { beginTurn } from '@/systems/combat/turnStart';
import { ambushCharges, isActionLocked, isWindingUp, poisonStacks, skillVariantFor } from '@/systems/combat/statusEffects';
import { statusAmplifier } from '@/systems/combat/damageCalc';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { hexKey } from '@/utils/hexUtils';
import {
  assassinate, creepingDeath, garrote, hemlock, shadowstep, vanish, venomedBlades,
} from '@/data/skills/masterySkills';
import { findMasteryPath } from '@/data/skills/masteryData';
import { BALANCE } from '@/data/balanceConstants';
import {
  ActiveEffect, AfflictionType, AuraType, CombatUnit, HeroStats,
} from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';
import { requireUnit } from '@/systems/combat/unitLookup';
import { nodeSkillAt } from '@/systems/progression/mastery';
import { skillSimpleText } from '@/data/display/simpleText';

/**
 * The Shadowblade: poison laid down over several turns, then spent all at once.
 *
 * Three of the four cards here needed the engine to learn something — a skill
 * that is two skills depending on where it points, a gate with two conditions,
 * and damage that scales with what the target is already carrying. What these
 * tests mostly pin is that each of those stayed *general* rather than becoming
 * a special case named after one skill.
 */

const noVariance = { critChance: 0, dodgeChance: 0 };

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ maxHp: 200, maxMana: 90, ...over });

const unit = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ stats: stats(), ...over });

const poison = (magnitude: number): ActiveEffect => ({
  type: AfflictionType.Poison, magnitude, duration: 3,
});

// ─── Shadowstep ───────────────────────────────────────────────────────────────

describe('shadowstep', () => {
  it('is an escape aimed at open ground', () => {
    const escape = skillVariantFor(shadowstep, false);
    expect(escape.damage).toBeUndefined();
    expect(escape.selfMove?.kind).toBe('blink');
  });

  it('is an opening aimed at a body', () => {
    const strike = skillVariantFor(shadowstep, true);
    expect(strike.damage).toBeGreaterThan(0);
    // `dash`, not `blink`: a blink names its exact hex and would simply refuse
    // an occupied one, which is the entire case the variant exists for
    expect(strike.selfMove?.kind).toBe('dash');
  });

  it('keeps its identity across the swap', () => {
    const strike = skillVariantFor(shadowstep, true);
    expect(strike.id).toBe(shadowstep.id);
    expect(strike.manaCost).toBe(shadowstep.manaCost);
    expect(strike.cooldown).toBe(shadowstep.cooldown);
  });

  it('hides the caster when it lands on empty ground', () => {
    const blade = unit({ position: { q: 0, r: 0 }, skills: [shadowstep] });
    useCombatStore.setState({ units: [blade] });
    resolveSkillUse(blade, shadowstep, { q: 2, r: 0 }, SILENT_SINK);

    const after = requireUnit(useCombatStore.getState().units, blade.id);
    expect(after.position).toEqual({ q: 2, r: 0 });
    expect(after.activeEffects.some((e) => e.type === AuraType.Stealth)).toBe(true);
  });

  it('closes, cuts and poisons when it lands on an enemy', () => {
    const blade = unit({ position: { q: 0, r: 0 }, skills: [shadowstep], stats: stats(noVariance) });
    const foe = unit({
      isPlayer: false, position: { q: 3, r: 0 }, stats: stats(noVariance),
    });
    useCombatStore.setState({ units: [blade, foe] });
    resolveSkillUse(blade, shadowstep, foe.position, SILENT_SINK);

    const after = useCombatStore.getState().units;
    const moved = requireUnit(after, blade.id);
    const hurt = requireUnit(after, foe.id);

    expect(moved.position).not.toEqual({ q: 0, r: 0 });
    expect(hurt.currentHp).toBeLessThan(200);
    expect(hurt.activeEffects.some((e) => e.type === AfflictionType.Poison)).toBe(true);
    // The escape half must not fire on the strike half — a free stealth on
    // every opener is a different and much stronger card
    expect(moved.activeEffects.some((e) => e.type === AuraType.Stealth)).toBe(false);
  });

  /**
   * The strike half was unreachable for a whole version.
   *
   * `getValidSkillTargetHexes` filtered every occupied hex out of any skill
   * carrying a `blink`, on the reasoning that a blink names its own destination
   * — true of the escape half and exactly wrong for the other one. So the
   * signature of the poison path was an escape and nothing else, and tier 3's
   * Assassinate sat behind a `poisoned` gate the path could not open.
   */
  describe('choosing a hex', () => {
    const targets = (blade: CombatUnit, units: CombatUnit[]) =>
      getValidSkillTargetHexes(shadowstep, blade, units).map(hexKey);

    it('offers a body, not just open ground', () => {
      const blade = unit({ position: { q: 0, r: 0 } });
      const foe = unit({ isPlayer: false, position: { q: 2, r: 0 } });
      expect(targets(blade, [blade, foe])).toContain(hexKey(foe.position));
    });

    it('does not offer an ally to stab', () => {
      const blade = unit({ position: { q: 0, r: 0 } });
      const friend = unit({ position: { q: 2, r: 0 } });
      expect(targets(blade, [blade, friend])).not.toContain(hexKey(friend.position));
    });

    /**
     * The playtest report: in melee, the strike half could not be clicked.
     *
     * `resolveSelfMove` returns `null` for two opposite reasons — no landing hex
     * to be found, and none needed — and this filter asked it directly, so it
     * read "already beside them" as "no way in". A caster standing next to its
     * target is its own nearest free neighbour, so the dash resolves to the hex
     * it is on and returns `null`; the board then withheld the one hex the
     * variant exists for. The resolver had always allowed it via
     * `dashGapClosed`, which is exactly the board-vs-rules split
     * `selfMoveBlocked` was written to end — it just was not asked here.
     *
     * Swept over all six neighbours rather than one, because the bug was
     * unconditional and a single-direction check could pass on luck.
     */
    it('offers an adjacent enemy, from every side', () => {
      const offenders: string[] = [];
      for (const step of [
        { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
        { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
      ]) {
        const blade = unit({ position: { q: 0, r: 0 } });
        const foe = unit({ isPlayer: false, position: step });
        if (!targets(blade, [blade, foe]).includes(hexKey(foe.position))) {
          offenders.push(hexKey(step));
        }
      }
      expect(offenders).toEqual([]);
    });

    /** Surrounded by its own escort, there is no hex to arrive on. */
    it('does not offer an enemy with nowhere to land beside it', () => {
      const blade = unit({ position: { q: 3, r: 0 } });
      const foe = unit({ isPlayer: false, position: { q: 0, r: 0 } });
      const escort = [
        { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
        { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
      ].map((position) => unit({ isPlayer: false, position }));

      expect(targets(blade, [blade, foe, ...escort])).not.toContain(hexKey(foe.position));
    });

    /**
     * And the rules agree with the board. Before, the dash quietly found no
     * landing hex, the caster stayed put, and the strike landed anyway — a
     * melee opener delivered from four hexes away.
     */
    it('refuses rather than striking from where it stands', () => {
      const blade = unit({
        position: { q: 3, r: 0 }, skills: [shadowstep], stats: stats(noVariance),
      });
      const foe = unit({
        isPlayer: false, position: { q: 0, r: 0 }, stats: stats(noVariance),
      });
      const escort = [
        { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
        { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
      ].map((position) => unit({ isPlayer: false, position }));
      useCombatStore.setState({ units: [blade, foe, ...escort] });

      const result = resolveSkillUse(blade, shadowstep, foe.position, SILENT_SINK);

      expect(result.ok).toBe(false);
      expect(result.refusal).toBe('no-landing');
      expect(result.endsTurn).toBe(false);
      const after = useCombatStore.getState().units;
      expect(requireUnit(after, blade.id).position).toEqual({ q: 3, r: 0 });
      expect(requireUnit(after, foe.id).currentHp).toBe(200);
    });
  });
});

// ─── Poison stacking ──────────────────────────────────────────────────────────

/**
 * Poison is a pile of doses, and the pile is the Shadowblade's resource.
 *
 * Three rules, all of them symmetric — a spider poisons a hero by exactly this
 * table. Doses add and reset the clock; the cap is counted in doses rather than
 * in points, because a dose is worth the applier's attack and a points ceiling
 * would hand a strong hero fewer of them; and a dose landing on a full pile is
 * a detonation rather than the no-op it used to be, which is what stopped the
 * poison path's own success from making its strikes stop counting.
 */
describe('poison', () => {
  const carriedBy = (id: string) =>
    useCombatStore.getState().units
      .find((u) => u.id === id)!
      .activeEffects.find((e) => e.type === AfflictionType.Poison);

  it('accumulates rather than taking the larger dose', () => {
    const foe = unit({ isPlayer: false });
    useCombatStore.setState({ units: [foe] });
    useCombatStore.getState().applyEffect(foe.id, poison(5));
    useCombatStore.getState().applyEffect(foe.id, poison(4));

    expect(carriedBy(foe.id)!.magnitude).toBe(9);
    expect(poisonStacks(carriedBy(foe.id)!)).toBe(2);
  });

  it('counts a dose from a source that never heard of doses as one', () => {
    const foe = unit({ isPlayer: false });
    useCombatStore.setState({ units: [foe] });
    // Every existing poison in the game — enemy bites, venom riders — is
    // authored without a `stacks` field and must still be a legal single dose
    useCombatStore.getState().applyEffect(foe.id, poison(6));
    expect(poisonStacks(carriedBy(foe.id)!)).toBe(1);
  });

  it('puts the clock back to full on every dose', () => {
    const foe = unit({ isPlayer: false });
    useCombatStore.setState({ units: [foe] });
    useCombatStore.getState().applyEffect(foe.id, { ...poison(5), duration: 1 });
    expect(carriedBy(foe.id)!.duration).toBe(BALANCE.POISON_TICKS);
  });

  /**
   * The payout curve: full on the first tick of a dose, half on each of the two
   * after it. Same total as biting evenly, and it is what makes poisoning
   * something matter on the turn you spent doing it.
   */
  it('bites hardest first, then twice for half, then stops', () => {
    const foe = unit({ isPlayer: false, stats: stats({ maxHp: 500 }) });
    useCombatStore.setState({ units: [foe] });
    useCombatStore.getState().applyEffect(foe.id, poison(16));

    const taken: number[] = [];
    for (let turn = 0; turn < 4; turn++) {
      const before = requireUnit(useCombatStore.getState().units, foe.id).currentHp;
      useCombatStore.getState().tickEffectsOnUnit(foe.id);
      const after = requireUnit(useCombatStore.getState().units, foe.id).currentHp;
      taken.push(before - after);
    }

    expect(taken).toEqual([16, 8, 8, 0]);
    expect(carriedBy(foe.id)).toBeUndefined();
  });

  /** Symmetric — enemies poison too, and a swamp of spiders must stay answerable. */
  it('stops stacking at the cap', () => {
    const blade = unit();
    const foe = unit({ isPlayer: false, stats: stats({ maxHp: 9999 }) });
    useCombatStore.setState({ units: [blade, foe] });
    // Every fourth dose bursts and spends the pile, so the pile never passes the cap
    for (let i = 0; i < 20; i++) {
      useCombatStore.getState().applyEffect(foe.id, { ...poison(9), sourceUnitId: blade.id });
      const carried = carriedBy(foe.id);
      if (carried) expect(poisonStacks(carried)).toBeLessThanOrEqual(BALANCE.MAX_POISON_STACKS);
    }
    for (let i = 0; i < BALANCE.MAX_POISON_STACKS; i++) {
      useCombatStore.getState().applyEffect(foe.id, { ...poison(9), sourceUnitId: blade.id });
    }

    expect(poisonStacks(carriedBy(foe.id)!)).toBe(BALANCE.MAX_POISON_STACKS);
    expect(carriedBy(foe.id)!.magnitude).toBe(9 * BALANCE.MAX_POISON_STACKS);
  });

  it('bursts instead, when the pile is already full', () => {
    const blade = unit({ stats: stats(noVariance) });
    const foe = unit({ isPlayer: false, stats: stats({ ...noVariance, maxHp: 9999 }) });
    useCombatStore.setState({ units: [blade, foe] });

    const dose = { ...poison(9), sourceUnitId: blade.id };
    for (let i = 0; i < BALANCE.MAX_POISON_STACKS; i++) {
      expect(useCombatStore.getState().applyEffect(foe.id, dose)).toBeUndefined();
    }

    const before = requireUnit(useCombatStore.getState().units, foe.id).currentHp;
    const outcome = useCombatStore.getState().applyEffect(foe.id, dose);
    const after = requireUnit(useCombatStore.getState().units, foe.id).currentHp;

    expect(outcome!.burst).toBeGreaterThan(0);
    expect(before - after).toBe(outcome!.burst);
    // The burst spends the pile: the next burst has to be built again from one dose
    expect(carriedBy(foe.id)).toBeUndefined();
    expect(useCombatStore.getState().applyEffect(foe.id, dose)).toBeUndefined();
    expect(poisonStacks(carriedBy(foe.id)!)).toBe(1);
  });

  it('scales the burst off the attacker, not off the pile', () => {
    const weak = unit({ stats: stats({ ...noVariance, attack: 20 }) });
    const strong = unit({ stats: stats({ ...noVariance, attack: 60 }) });
    const burstFrom = (attacker: CombatUnit) => {
      const foe = unit({ isPlayer: false, stats: stats({ ...noVariance, maxHp: 9999 }) });
      useCombatStore.setState({ units: [attacker, foe] });
      const dose = { ...poison(9), sourceUnitId: attacker.id };
      for (let i = 0; i < BALANCE.MAX_POISON_STACKS; i++) {
        useCombatStore.getState().applyEffect(foe.id, dose);
      }
      return useCombatStore.getState().applyEffect(foe.id, dose)!.burst;
    };

    expect(burstFrom(strong)).toBeGreaterThan(burstFrom(weak));
  });

  /** Nobody to credit the blow to — a lingering pool, a dead applier. */
  it('does nothing dramatic when the dose has no source', () => {
    const foe = unit({ isPlayer: false });
    useCombatStore.setState({ units: [foe] });
    for (let i = 0; i < BALANCE.MAX_POISON_STACKS + 2; i++) {
      expect(useCombatStore.getState().applyEffect(foe.id, poison(9))).toBeUndefined();
    }
    expect(poisonStacks(carriedBy(foe.id)!)).toBe(BALANCE.MAX_POISON_STACKS);
  });
});

// ─── Creeping Death ───────────────────────────────────────────────────────────

describe('creeping death', () => {
  it('hits harder the more poison the target carries', () => {
    const blade = unit();
    const clean = unit({ isPlayer: false });
    const dosed = unit({ isPlayer: false, activeEffects: [poison(10)] });

    expect(statusAmplifier(blade, clean, creepingDeath)).toBe(1);
    expect(statusAmplifier(blade, dosed, creepingDeath)).toBeGreaterThan(1);
    expect(calculateDamage(blade, dosed, creepingDeath)).toBeGreaterThan(
      calculateDamage(blade, clean, creepingDeath),
    );
  });

  /**
   * Measured against the attacker's own attack, not in raw magnitude. Poison is
   * applied as a fraction of attack, so a flat per-point bonus would have grown
   * with attack *and* multiplied a hit that already grew with attack — the
   * bonus would compound with the square of the campaign's stat inflation.
   */
  it('is worth the same at every point in the campaign', () => {
    const early = unit({ stats: stats({ attack: 20 }) });
    const late = unit({ stats: stats({ attack: 60 }) });
    // Poison scales with the caster's attack, so a level-20 dose is three times
    // a level-5 one — and should read as the same amount of poison
    const earlyPrey = unit({ isPlayer: false, activeEffects: [poison(7)] });
    const latePrey = unit({ isPlayer: false, activeEffects: [poison(21)] });

    expect(statusAmplifier(early, earlyPrey, creepingDeath)).toBeCloseTo(
      statusAmplifier(late, latePrey, creepingDeath),
    );
  });

  it('never runs away with itself', () => {
    const blade = unit();
    const drowning = unit({ isPlayer: false, activeEffects: [poison(999)] });
    expect(statusAmplifier(blade, drowning, creepingDeath)).toBe(
      1 + creepingDeath.amplifiedBy!.max,
    );
  });

  it('leaves the poison on the target', () => {
    // Unlike a detonation, which spends it. Stacking is the plan, and a
    // capstone that wiped the stacks would end the plan every time it fired.
    expect(creepingDeath.detonates).toBeUndefined();
  });
});

// ─── Assassinate ──────────────────────────────────────────────────────────────

describe('assassinate', () => {
  it('reaches across the whole board', () => {
    // The arena is bounded at |q| ≤ 3 and |r| ≤ 5, so anything past that is
    // "anywhere": the 2026-10 remaster removed every limit on whom it can mark
    expect(assassinate.range).toBeGreaterThan(10);
  });

  it('marks rather than strikes: the cast deals nothing and needs no gate', () => {
    const hunter = unit({ position: { q: 0, r: 0 }, skills: [assassinate], stats: stats(noVariance) });
    const victim = unit({
      isPlayer: false, position: { q: 2, r: 0 }, stats: stats({ maxHp: 100, ...noVariance }), currentHp: 1,
    });
    useCombatStore.setState({ units: [hunter, victim] });
    expect(resolveSkillUse(hunter, assassinate, victim.position, SILENT_SINK).ok).toBe(true);
    const after = requireUnit(useCombatStore.getState().units, victim.id);
    expect(after.currentHp).toBe(1);
    expect(after.activeEffects.some((e) => e.type === AfflictionType.DeathMark)).toBe(true);
  });

  it('carries a cooldown, now that no gate limits the mark', () => {
    expect(assassinate.cooldown ?? 0).toBeGreaterThan(0);
  });

  it('hides the killer when the mark executes at the start of its turn', () => {
    const hunter = unit({ position: { q: 0, r: 0 }, skills: [assassinate], stats: stats(noVariance) });
    const victim = unit({
      isPlayer: false, position: { q: 2, r: 0 }, stats: stats({ maxHp: 100, ...noVariance }), currentHp: 1,
    });
    useCombatStore.setState({ units: [hunter, victim] });
    resolveSkillUse(hunter, assassinate, victim.position, SILENT_SINK);
    beginTurn(hunter.id, SILENT_SINK);
    const after = useCombatStore.getState().units;
    expect(requireUnit(after, victim.id).currentHp).toBe(0);
    expect(requireUnit(after, hunter.id).activeEffects.some((e) => e.type === AuraType.Stealth)).toBe(true);
  });
});

// ─── Vanish ───────────────────────────────────────────────────────────────────

describe('vanish', () => {
  const cast = () => {
    const blade = unit({ position: { q: 0, r: 0 }, skills: [vanish] });
    useCombatStore.setState({ units: [blade] });
    resolveSkillUse(blade, vanish, blade.position, SILENT_SINK);
    return blade.id;
  };
  const read = (id: string) => requireUnit(useCombatStore.getState().units, id);

  it('locks the shadowblade down while it winds up', () => {
    const id = cast();
    useCombatStore.getState().tickEffectsOnUnit(id);
    const winding = read(id);

    expect(isWindingUp(winding)).toBe(true);
    expect(isActionLocked(winding)).toBe(true);
    expect(ambushCharges(winding)).toBe(0);
  });

  it('pays out every banked action on the turn it lifts', () => {
    const id = cast();
    for (let turn = 0; turn < BALANCE.VANISH_WINDUP; turn++) {
      useCombatStore.getState().tickEffectsOnUnit(id);
    }
    const ready = read(id);

    expect(isWindingUp(ready)).toBe(false);
    expect(isActionLocked(ready)).toBe(false);
    expect(ambushCharges(ready)).toBe(BALANCE.VANISH_CHARGES);
  });

  it('spends one charge per action and then ends the turn', () => {
    const id = cast();
    for (let turn = 0; turn < BALANCE.VANISH_WINDUP; turn++) {
      useCombatStore.getState().tickEffectsOnUnit(id);
    }

    const spend = () => useCombatStore.getState().spendAmbushCharge(id);
    for (let i = 0; i < BALANCE.VANISH_CHARGES; i++) expect(spend()).toBe(true);
    expect(spend()).toBe(false);
    // The aura goes with the last charge rather than lingering as a pip that
    // says nothing and a lock that would fire again
    expect(read(id).activeEffects.some((e) => e.type === AuraType.Ambush)).toBe(false);
  });

  it('actually refunds the turn when a charge is spent', () => {
    const id = cast();
    for (let turn = 0; turn < BALANCE.VANISH_WINDUP; turn++) {
      useCombatStore.getState().tickEffectsOnUnit(id);
    }
    useCombatStore.setState({
      units: useCombatStore.getState().units.map((u) =>
        u.id === id ? { ...u, skills: [venomedBlades], position: { q: 0, r: 0 } } : u,
      ),
    });
    const foe = unit({ isPlayer: false, position: { q: 1, r: 0 }, stats: stats({ maxHp: 900 }) });
    useCombatStore.setState({ units: [...useCombatStore.getState().units, foe] });

    const result = resolveSkillUse(read(id), venomedBlades, foe.position, SILENT_SINK);
    expect(result.ok && result.endsTurn).toBe(false);
    expect(ambushCharges(read(id))).toBe(BALANCE.VANISH_CHARGES - 1);
  });

  // PT-03: the simple text reads the rank's actions and the real wind-up
  it('says the actions its rank buys, and hides through the whole wind-up', () => {
    const node = findMasteryPath('shadowblade')!.nodes.find((n) => n.grantsSkill === 'vanish')!;
    const actions = (level: number) => {
      const skill = nodeSkillAt(node, level)!;
      const applied = Array.isArray(skill.appliesEffect) ? skill.appliesEffect : [];
      return { text: skillSimpleText(skill)!, count: Math.round(applied.find((e) => e.type === AuraType.Ambush)!.magnitude) };
    };
    expect(actions(1).count).toBe(2);
    expect(actions(3).count).toBe(4);
    for (const level of [1, 2, 3]) expect(actions(level).text).toContain(`${actions(level).count} action`);
    const applied = Array.isArray(vanish.appliesEffect) ? vanish.appliesEffect : [];
    expect(applied.find((e) => e.type === AuraType.Stealth)!.duration).toBe(BALANCE.VANISH_STEALTH);
  });

  it('is a window, not a stance', () => {
    const applied = Array.isArray(vanish.appliesEffect) ? vanish.appliesEffect : [];
    const ambush = applied.find((e) => e.type === AuraType.Ambush)!;
    expect(vanish.cooldown!).toBeGreaterThan(ambush.duration);
  });
});

// ─── The tree ─────────────────────────────────────────────────────────────────

describe('the shadowblade tree', () => {
  const path = findMasteryPath('shadowblade')!;

  it('no longer borrows a berserker’s kill chain or a templar’s death save', () => {
    const passives = path.nodes.map((node) => node.grantsPassive).filter(Boolean);
    expect(passives).not.toContain('frenzy');
    expect(passives).not.toContain('undying');
  });

  it('spends all three capstones on the poison plan', () => {
    const capstones = path.nodes.filter((node) => node.tier === 3).map((node) => node.grantsSkill);
    expect(capstones.sort()).toEqual(['assassinate', 'creeping_death', 'vanish']);
  });

  /**
   * The gate on Assassinate is only a gate if the path can actually open it.
   * A finisher requiring poison, on a tree with no reliable way to apply it,
   * would be a capstone that reads as broken.
   */
  it('gives the path several ways to poison something', () => {
    const poisoners = [shadowstep, venomedBlades, creepingDeath].filter((skill) => {
      const variants = [skill, skillVariantFor(skill, true)];
      return variants.some((v) => {
        const applied = Array.isArray(v.appliesEffect)
          ? v.appliesEffect
          : v.appliesEffect
            ? [v.appliesEffect]
            : [];
        return applied.some((e) => e.type === AfflictionType.Poison);
      });
    });
    expect(poisoners.length).toBe(3);
  });

  /**
   * And one of them has to be reachable on the way *to* the capstone. Tier 2 is
   * where a build passes through; a route that arrives at Assassinate holding no
   * poison source has a finisher it cannot fire.
   */
  it('puts a poison source in tier 2', () => {
    const tier2 = path.nodes.filter((node) => node.tier === 2).map((node) => node.grantsSkill);
    expect(tier2).toContain('venomed_blades');
    expect(tier2).toContain('hemlock');
  });

  it('no longer hands out a berserker’s heal-on-kill', () => {
    expect(path.nodes.some((node) => node.grantsPassive === 'bloodscent')).toBe(false);
  });

  /**
   * A poison striking skill has to cost something.
   *
   * Venomed Blades shipped at 0 mana with no cooldown, alongside 1.0× damage,
   * 20% drain and a dose — which is the class's plain attack beaten on every
   * single axis. A skill that dominates the at-will is not a choice, it is a
   * replacement, and it collapses the path's own plan: coat, strike, strike,
   * strike, burst stops being a sequence when one free button is all of it.
   *
   * Pinned as a rule over both striking poison sources rather than as two
   * literals, because the *numbers* are a tuning question and "the poison
   * strike is not free" is not. Hemlock is excluded deliberately — it is the
   * one that spends the whole turn and applies nothing directly.
   */
  it('charges for every poison strike', () => {
    const free = [venomedBlades, creepingDeath].filter(
      (skill) => skill.manaCost === 0 && !skill.cooldown,
    );
    expect(free.map((s) => s.id)).toEqual([]);
  });
});

// ─── Hemlock ──────────────────────────────────────────────────────────────────

describe('hemlock', () => {
  const carriedBy = (id: string) =>
    useCombatStore.getState().units
      .find((u) => u.id === id)!
      .activeEffects.find((e) => e.type === AfflictionType.Poison);

  it('spends the turn and coats the blades', () => {
    expect(hemlock.damage).toBeUndefined();
    expect(hemlock.selfMove).toBeUndefined();

    const blade = unit({ skills: [hemlock] });
    useCombatStore.setState({ units: [blade] });
    resolveSkillUse(blade, hemlock, blade.position, SILENT_SINK);

    const after = requireUnit(useCombatStore.getState().units, blade.id);
    const coating = after.activeEffects.find((e) => e.type === AuraType.Envenomed)!;
    expect(coating.duration).toBe(BALANCE.HEMLOCK_DURATION);
  });

  /**
   * The whole point: it poisons through skills that know nothing about poison.
   * A rider on the Shadowblade's own poison skills would have been a fourth
   * poison button rather than a window.
   */
  it('doses the target through a skill that carries no poison', () => {
    const blade = unit({
      stats: stats(noVariance), skills: [garrote],
      activeEffects: [{ type: AuraType.Envenomed, magnitude: 0.3, duration: 3 }],
    });
    const foe = unit({ isPlayer: false, position: { q: 1, r: 0 }, stats: stats(noVariance) });
    useCombatStore.setState({ units: [blade, foe] });

    expect(garrote.appliesEffect).not.toBeUndefined();
    resolveSkillUse(blade, garrote, foe.position, SILENT_SINK);

    expect(poisonStacks(carriedBy(foe.id)!)).toBe(1);
  });

  it('does not dose through a blow that never landed', () => {
    const blade = unit({
      stats: stats(noVariance), skills: [garrote],
      activeEffects: [{ type: AuraType.Envenomed, magnitude: 0.3, duration: 3 }],
    });
    // Invulnerable: the strike resolves, nothing reaches them
    const foe = unit({
      isPlayer: false, position: { q: 1, r: 0 }, stats: stats(noVariance),
      activeEffects: [{ type: AuraType.Invulnerability, magnitude: 1, duration: 2 }],
    });
    useCombatStore.setState({ units: [blade, foe] });
    resolveSkillUse(blade, garrote, foe.position, SILENT_SINK);

    expect(carriedBy(foe.id)).toBeUndefined();
  });

  /**
   * Three coated strikes fill the target and the fourth detonates — which is
   * the plan the window exists to make possible, and the reason its duration and
   * the stack cap are the same number.
   */
  it('fills a target across the window, and the next one bursts', () => {
    const blade = unit({
      stats: stats(noVariance), skills: [garrote],
      activeEffects: [{ type: AuraType.Envenomed, magnitude: 0.3, duration: 9 }],
    });
    const foe = unit({
      isPlayer: false, position: { q: 1, r: 0 },
      stats: stats({ ...noVariance, maxHp: 9999 }),
    });
    useCombatStore.setState({ units: [blade, foe] });

    for (let i = 0; i < BALANCE.MAX_POISON_STACKS; i++) {
      resolveSkillUse(blade, garrote, foe.position, SILENT_SINK);
      // Garrote is on a cooldown; the window is what is being measured here,
      // not how often the Shadowblade can press one particular button
      useCombatStore.setState((s) => ({
        units: s.units.map((u) => (u.id === blade.id ? { ...u, cooldowns: {} } : u)),
      }));
    }
    expect(poisonStacks(carriedBy(foe.id)!)).toBe(BALANCE.MAX_POISON_STACKS);

    const before = requireUnit(useCombatStore.getState().units, foe.id).currentHp;
    resolveSkillUse(blade, garrote, foe.position, SILENT_SINK);
    const after = requireUnit(useCombatStore.getState().units, foe.id).currentHp;

    // The blow *and* the overdose, so strictly more than the strike alone
    const strike = calculateDamage(blade, foe, garrote);
    expect(before - after).toBeGreaterThan(strike);
    // Garrote's blow lands first, then its dose bursts and spends the pile
    expect(carriedBy(foe.id)).toBeUndefined();
  });

  it('closes, and is not a passive', () => {
    // A window held open forever is the node this replaced, with extra steps
    expect(hemlock.cooldown!).toBeGreaterThan(BALANCE.HEMLOCK_DURATION);
  });
});
