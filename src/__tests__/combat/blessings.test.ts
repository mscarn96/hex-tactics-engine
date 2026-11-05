import { useCombatStore } from '@/stores/combatStore';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { skillEffects, STACKING_MAGNITUDE } from '@/systems/combat/statusEffects';
import { blessedWeaponBonus } from '@/systems/combat/damageCalc';
import { getSkillRangeHexes } from '@/systems/combat/targeting';
import { martyr, righteousFury, rootedVitality, wildSanctuary } from '@/data/skills/masterySkills';
import { slash } from '@/data/skills/skillData';
import { BALANCE } from '@/data/balanceConstants';
import {
  ActiveEffect,
  AuraType,
  CombatUnit,
  HeroSkill,
  HeroStats,
  SkillTargetType,
} from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';
import { requireUnit } from '@/systems/combat/unitLookup';

/**
 * The Templar's two capstones, and the two engine gaps they needed.
 *
 * Both are "pay now, collect later" in opposite directions — one banks damage
 * onto a weapon a stack at a time, the other banks it into an ally and spends
 * it all at once — and each needed something the skill vocabulary could not
 * express: a status that adds instead of refreshing, and one whose payload
 * lands on units other than the one carrying it.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ magic: 20, ...over });

const unit = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ stats: stats(), ...over });

const holyAttack = { ...slash, id: 'basic_attack' as const };

const blessing = (magnitude: number): ActiveEffect => ({
  type: AuraType.BlessedWeapon, magnitude, duration: -1,
});

describe('blessed weapon', () => {
  it('adds flat damage to a single-target strike', () => {
    const plain = unit();
    const blessed = unit({ activeEffects: [blessing(10)] });
    const foe = unit({ isPlayer: false });

    expect(calculateDamage(blessed, foe, holyAttack)).toBe(
      calculateDamage(plain, foe, holyAttack) + 10,
    );
  });

  /**
   * The restriction is on the *shape*, not on how many enemies happened to be
   * standing there. A blessing rides one blow, so a sweep must not collect it
   * once per body — and a cone that catches a single target is still a sweep.
   */
  it('does not ride an area skill, however few it catches', () => {
    const blessed = unit({ activeEffects: [blessing(10)] });
    const sweep: HeroSkill = {
      ...slash, targetType: SkillTargetType.Ring, aoeRadius: 2,
    };
    expect(blessedWeaponBonus(blessed, sweep)).toBe(0);
    expect(blessedWeaponBonus(blessed, holyAttack)).toBe(10);
  });

  it('is subject to armour, unlike every multiplier below it', () => {
    // Added to the raw hit rather than multiplied in afterwards, so defence
    // still gets to answer it — otherwise the blessing would be the one damage
    // source in the game that ignores armour entirely.
    const blessed = unit({ activeEffects: [blessing(10)] });
    const soft = unit({ isPlayer: false, stats: stats({ defense: 0 }) });
    const armoured = unit({ isPlayer: false, stats: stats({ defense: 10 }) });
    expect(calculateDamage(blessed, armoured, holyAttack)).toBeLessThan(
      calculateDamage(blessed, soft, holyAttack),
    );
  });
});

describe('stacking statuses', () => {
  const target = () => {
    const u = unit();
    useCombatStore.setState({ units: [u] });
    return u;
  };
  const effects = (id: string) =>
    useCombatStore.getState().units.find((x) => x.id === id)!.activeEffects;

  it('adds magnitude instead of taking the larger', () => {
    const u = target();
    const store = useCombatStore.getState();
    store.applyEffect(u.id, blessing(10));
    store.applyEffect(u.id, blessing(10));
    expect(effects(u.id).find((e) => e.type === AuraType.BlessedWeapon)?.magnitude).toBe(20);
  });

  it('converges rather than growing without bound', () => {
    const u = target();
    const store = useCombatStore.getState();
    for (let i = 0; i < 20; i++) store.applyEffect(u.id, blessing(10));
    expect(effects(u.id).find((e) => e.type === AuraType.BlessedWeapon)?.magnitude).toBe(
      10 * BALANCE.FURY_MAX_STACKS,
    );
  });

  it('leaves every other aura refreshing rather than stacking', () => {
    const u = target();
    const store = useCombatStore.getState();
    const buff = (m: number): ActiveEffect => ({
      type: AuraType.AttackBuff, magnitude: m, duration: 3,
    });
    store.applyEffect(u.id, buff(5));
    store.applyEffect(u.id, buff(3));
    // A weaker second source must not make the hero stronger than the stronger
    // source alone did
    expect(effects(u.id).find((e) => e.type === AuraType.AttackBuff)?.magnitude).toBe(5);
  });

  /**
   * Opt-in, and the list is short on purpose: everything else takes the larger
   * of the two doses, so adding a status here changes what every existing
   * source of it means.
   *
   * Poison also stacks and is deliberately *not* in this table. Its ceiling is
   * counted in doses rather than in points — a dose is worth the applier's
   * attack, so a points cap hands a strong hero fewer of them — and reaching
   * that ceiling detonates rather than doing nothing. Neither is expressible as
   * a number in a `Partial<Record<StatusEffectType, number>>`, so it has its own
   * rule in `statusEffects.mergePoison`. See `shadowblade.test.ts`.
   */
  it('names every stacking status deliberately', () => {
    expect(Object.keys(STACKING_MAGNITUDE).sort()).toEqual(['blessed_weapon', 'burn', 'jade_taint', 'wound']);
  });
});

describe('martyr', () => {
  it('blesses with immunity and a seal in one cast', () => {
    const applied = skillEffects(martyr).map((e) => e.type).sort();
    expect(applied).toEqual([
      AuraType.DebuffImmunity, AuraType.Invulnerability, AuraType.MartyrSeal,
    ].sort());
  });

  it('runs the immunity exactly as long as the fuse', () => {
    // Mismatched durations would mean either a window where the carrier can be
    // killed before it goes off, or immunity that outlives what paid for it.
    const durations = new Set(skillEffects(martyr).map((e) => e.duration));
    expect([...durations]).toEqual([2]);
  });

  it('detonates on enemies around the carrier, sparing its own side', () => {
    const carrier = unit({ position: { q: 0, r: 0 } });
    const nearFoe = unit({ isPlayer: false, position: { q: 1, r: 0 } });
    const farFoe = unit({ isPlayer: false, position: { q: 0, r: 5 } });
    const ally = unit({ position: { q: 0, r: 1 } });
    useCombatStore.setState({ units: [carrier, nearFoe, farFoe, ally] });

    useCombatStore.getState().detonateMartyrSeal(carrier.id, {
      type: AuraType.MartyrSeal, magnitude: 30, duration: 1,
    });

    const hp = (id: string) => requireUnit(useCombatStore.getState().units, id).currentHp;
    expect(hp(nearFoe.id)).toBeLessThan(nearFoe.stats.maxHp);
    expect(hp(farFoe.id)).toBe(farFoe.stats.maxHp);
    expect(hp(ally.id)).toBe(ally.stats.maxHp);
    expect(hp(carrier.id)).toBe(carrier.stats.maxHp);
  });

  it('fires once, on the tick that removes the seal', () => {
    const carrier = unit({ position: { q: 0, r: 0 } });
    const foe = unit({ isPlayer: false, position: { q: 1, r: 0 } });
    useCombatStore.setState({ units: [carrier, foe] });
    useCombatStore.getState().applyEffect(carrier.id, {
      type: AuraType.MartyrSeal, magnitude: 20, duration: 2,
    });

    const hp = () => requireUnit(useCombatStore.getState().units, foe.id).currentHp;

    useCombatStore.getState().tickEffectsOnUnit(carrier.id);
    expect(hp()).toBe(foe.stats.maxHp); // still armed

    useCombatStore.getState().tickEffectsOnUnit(carrier.id);
    const afterBlast = hp();
    expect(afterBlast).toBeLessThan(foe.stats.maxHp);

    // Seal is gone, so further ticks cost nothing
    useCombatStore.getState().tickEffectsOnUnit(carrier.id);
    expect(hp()).toBe(afterBlast);
  });

  /**
   * The detonation's effect has to come back with the numbers.
   *
   * It is the one payload in the game with no resolver in its call stack —
   * nobody cast anything on the turn it goes off — so if the store does not hand
   * a spec back, there is no other moment at which anything could play it, and
   * the blast is invisible. The store still never touches the scene: it returns
   * data, and the driver decides.
   */
  it('hands back an effect to play, since no resolver is there to fire one', () => {
    const carrier = unit({ position: { q: 0, r: 0 } });
    const foe = unit({ isPlayer: false, position: { q: 1, r: 0 } });
    useCombatStore.setState({ units: [carrier, foe] });

    const events = useCombatStore.getState().detonateMartyrSeal(carrier.id, {
      type: AuraType.MartyrSeal, magnitude: 20, duration: 1,
    });

    const specs = events.map((e) => e.vfx).filter(Boolean);
    // Exactly one, at the carrier: four overlapping novas on one hex is one nova
    expect(specs).toHaveLength(1);
    expect(specs[0]!.casterPos).toEqual(carrier.position);
    expect(specs[0]!.hitUnitIds).toEqual([foe.id]);
  });

  it('hands back nothing when the blast catches nobody', () => {
    const carrier = unit({ position: { q: 0, r: 0 } });
    const farFoe = unit({ isPlayer: false, position: { q: 0, r: 5 } });
    useCombatStore.setState({ units: [carrier, farFoe] });

    const events = useCombatStore.getState().detonateMartyrSeal(carrier.id, {
      type: AuraType.MartyrSeal, magnitude: 20, duration: 1,
    });
    expect(events).toEqual([]);
  });
});

describe('self-targetable blessings', () => {
  /**
   * A skill whose only payload is a buff has no `healing` to give it away, so
   * "bless an ally" used to mean "bless anyone but yourself" — and the game
   * hands you a single hero to start with.
   */
  it('offers the caster their own hex', () => {
    const caster = unit({ position: { q: 0, r: 0 } });
    const onSelf = (skill: HeroSkill) =>
      getSkillRangeHexes(skill, caster).some((h) => h.q === 0 && h.r === 0);

    expect(onSelf(martyr)).toBe(true);
    expect(onSelf(rootedVitality)).toBe(true);
    // Righteous Fury is Self-targeted outright, so it never had the problem
    expect(righteousFury.targetType).toBe(SkillTargetType.Self);
    // And a pure attack still refuses to be aimed inward
    expect(onSelf(slash)).toBe(false);
  });
});

describe('wild sanctuary', () => {
  it('carries both halves on one skill', () => {
    // Heals land on allies, damage on enemies — the resolver has always split by side
    expect(wildSanctuary.healing).toBeGreaterThan(0);
    expect(wildSanctuary.damage).toBeGreaterThan(0);
  });
});
