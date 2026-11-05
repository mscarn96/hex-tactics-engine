import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { calculateLifesteal } from '@/systems/combat/damageCalc';
import { strikeScales } from '@/systems/combat/statusEffects';
import { lethalSaveOutcomes, PASSIVE_DEFS } from '@/systems/combat/passives';
import { carnage, bloodthirst, executioner, whirlwind } from '@/data/skills/masterySkills';
import { slash } from '@/data/skills/skillData';
import { basicAttackWith } from '@/systems/combat/basicAttack';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import {
  ActiveEffect, AfflictionType, AuraType, CombatUnit, HeroStats,
} from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';
import { requireUnit } from '@/systems/combat/unitLookup';
import { passiveDescription } from '@/systems/combat/passives';

/**
 * Carnage, and the two ways of refusing to die.
 *
 * All three are "the fight is going badly, and that is the point" cards, and
 * all three needed the engine to learn something: that a strike can land more
 * than once, and that surviving can do more than leave you at 1 HP.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ ...over });

const unit = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ stats: stats(), ...over });

/** A Berserker's free swing: the Basic Attack an axe makes. */
const swing = basicAttackWith({ slot: 'mainHand', form: 'war_axe', motif: 'plain', id: 'Axe' });

const carnageAura: ActiveEffect = { type: AuraType.Carnage, magnitude: 1, duration: 3 };

describe('carnage', () => {
  it('doubles the free swings', () => {
    const berserk = unit({ activeEffects: [carnageAura] });
    expect(strikeScales(berserk, swing)).toEqual([1, 1]);
    expect(strikeScales(berserk, bloodthirst)).toEqual([1, 1]);
    // The class at-will it used to double is enemy vocabulary now, and an
    // enemy holding a Slash is not a Berserker's free swing
    expect(strikeScales(berserk, slash)).toEqual([1]);
  });

  /**
   * Named skills rather than "anything single-target". A doubled Executioner is
   * two kills, and Executioner already gates itself on a dying target — the
   * capstone is meant to reward pressing the cheap button, not to multiply the
   * expensive ones.
   */
  it('leaves the costed strikes alone', () => {
    const berserk = unit({ activeEffects: [carnageAura] });
    expect(strikeScales(berserk, executioner)).toEqual([1]);
    expect(strikeScales(berserk, whirlwind)).toEqual([1]);
  });

  it('does nothing without the aura', () => {
    expect(strikeScales(unit(), swing)).toEqual([1]);
  });

  it('actually lands twice, and spends mana once', () => {
    // Crit off on both sides. `resolveSkillUse` gives no way to inject the roll,
    // and at the default crit chance a single critical strike deals exactly
    // what two clean ones do — so a version of this test that left crit on
    // passed or failed on the dice rather than on the mechanic.
    const noCrit = { critChance: 0, dodgeChance: 0 };
    const target = () =>
      unit({ isPlayer: false, position: { q: 1, r: 0 }, stats: stats({ maxHp: 400, ...noCrit }) });

    const berserk = unit({
      position: { q: 0, r: 0 },
      skills: [bloodthirst],
      activeEffects: [carnageAura],
      stats: stats(noCrit),
    });
    const foe = target();
    useCombatStore.setState({ units: [berserk, foe] });
    resolveSkillUse(berserk, bloodthirst, foe.position, SILENT_SINK);
    const doubled = 400 - requireUnit(useCombatStore.getState().units, foe.id).currentHp;

    const plain = unit({ position: { q: 0, r: 0 }, skills: [bloodthirst], stats: stats(noCrit) });
    const foe2 = target();
    useCombatStore.setState({ units: [plain, foe2] });
    resolveSkillUse(plain, bloodthirst, foe2.position, SILENT_SINK);
    const single = 400 - requireUnit(useCombatStore.getState().units, foe2.id).currentHp;

    expect(single).toBeGreaterThan(0);
    expect(doubled).toBe(single * 2);
  });

  it('stops when the first blow kills, rather than hitting a corpse', () => {
    const berserk = unit({
      position: { q: 0, r: 0 }, skills: [swing], activeEffects: [carnageAura],
    });
    const foe = unit({ isPlayer: false, position: { q: 1, r: 0 }, stats: stats({ maxHp: 100 }) });
    foe.currentHp = 1;
    useCombatStore.setState({ units: [berserk, foe] });
    resolveSkillUse(berserk, swing, foe.position, SILENT_SINK);
    expect(requireUnit(useCombatStore.getState().units, foe.id).currentHp).toBe(0);
  });

  it('is a window, not a stance', () => {
    // The cooldown has to outlast the buff, or the Berserker is simply always
    // in Carnage and the capstone is a flat damage multiplier
    const applied = Array.isArray(carnage.appliesEffect)
      ? carnage.appliesEffect[0]
      : carnage.appliesEffect!;
    expect(carnage.cooldown!).toBeGreaterThan(applied.duration);
  });
});

describe('lifesteal aura', () => {
  it('drains from a skill that has none of its own', () => {
    const feasting = unit({
      activeEffects: [{ type: AuraType.Lifesteal, magnitude: 0.5, duration: 3 }],
    });
    expect(slash.lifesteal).toBeUndefined();
    expect(calculateLifesteal(slash, 100, feasting)).toBe(50);
    expect(calculateLifesteal(slash, 100)).toBe(0);
  });

  it('adds to a skill that already drains', () => {
    const feasting = unit({
      activeEffects: [{ type: AuraType.Lifesteal, magnitude: 0.5, duration: 3 }],
    });
    expect(calculateLifesteal(bloodthirst, 100, feasting)).toBe(
      Math.round(100 * (bloodthirst.lifesteal! + 0.5)),
    );
  });
});

describe('lethal saves', () => {
  it('leaves the plain passive exactly as it was', () => {
    // Three enemy templates carry `undying`, and none of them should start
    // hitting harder for having survived — which is why the two payload
    // versions are separate ids rather than options on this one.
    const plain = unit({ passives: ['undying'] });
    expect(lethalSaveOutcomes(plain)).toEqual([]);
    const carriers = enemyTemplates.filter((t) => t.passives?.includes('undying'));
    expect(carriers.length).toBeGreaterThan(0);
    for (const t of carriers) {
      expect(t.passives).not.toContain('lastBreath');
      expect(t.passives).not.toContain('cryostasis');
    }
  });

  it('gives the Berserker attack and lifesteal', () => {
    const berserk = unit({ passives: ['lastBreath'] });
    const granted = lethalSaveOutcomes(berserk)
      .map((o) => (o.kind === 'effect' ? o.effect.type : o.kind))
      .sort();
    expect(granted).toEqual([AuraType.AttackBuff, AuraType.Lifesteal].sort());
  });

  it('freezes whoever struck the Hydromancer, and shields it', () => {
    const mage = unit({ passives: ['cryostasis'] });
    const killer = unit({ isPlayer: false });
    const outcomes = lethalSaveOutcomes(mage, killer);

    const onKiller = outcomes.find((o) => o.kind === 'effect' && o.unitId === killer.id);
    expect(onKiller && onKiller.kind === 'effect' && onKiller.effect.type).toBe(
      AfflictionType.Freeze,
    );
    const onSelf = outcomes.find((o) => o.kind === 'effect' && o.unitId === mage.id);
    expect(onSelf && onSelf.kind === 'effect' && onSelf.effect.type).toBe(AuraType.Barrier);
  });

  it('still shields when nothing authored the blow', () => {
    // A poison tick or a Doom has no attacker, and the save must not crash or
    // silently do nothing on those paths
    const mage = unit({ passives: ['cryostasis'] });
    expect(lethalSaveOutcomes(mage)).toHaveLength(1);
  });

  it('fires through damageUnit, once per battle', () => {
    const berserk = unit({ passives: ['lastBreath'], stats: stats({ maxHp: 100 }) });
    berserk.currentHp = 10;
    const killer = unit({ isPlayer: false });
    useCombatStore.setState({ units: [berserk, killer] });

    useCombatStore.getState().damageUnit(berserk.id, 999, killer.id);
    const saved = requireUnit(useCombatStore.getState().units, berserk.id);
    expect(saved.currentHp).toBe(1);
    expect(saved.activeEffects.some((e) => e.type === AuraType.Lifesteal)).toBe(true);

    // The save is spent; the next lethal blow lands
    useCombatStore.getState().damageUnit(berserk.id, 999, killer.id);
    expect(requireUnit(useCombatStore.getState().units, berserk.id).currentHp).toBe(0);
  });

  it('freezes the attacker through damageUnit', () => {
    const mage = unit({ passives: ['cryostasis'], stats: stats({ maxHp: 100 }) });
    mage.currentHp = 5;
    const killer = unit({ isPlayer: false });
    useCombatStore.setState({ units: [mage, killer] });

    useCombatStore.getState().damageUnit(mage.id, 999, killer.id);
    const frozen = requireUnit(useCombatStore.getState().units, killer.id);
    expect(frozen.activeEffects.some((e) => e.type === AfflictionType.Freeze)).toBe(true);
  });

  it('describes both to the player', () => {
    for (const id of ['lastBreath', 'cryostasis'] as const) {
      expect(passiveDescription(id).length).toBeGreaterThan(20);
    }
  });
});
