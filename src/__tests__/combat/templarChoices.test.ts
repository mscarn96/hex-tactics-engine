import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { divineLight } from '@/data/skills/skillData';
import { layOnHands, smite } from '@/data/skills/masterySkills';
import { describeSkill, skillEffectLines } from '@/data/display/skillDisplay';
import { findMasteryNode } from '@/data/skills/masteryData';
import { BALANCE } from '@/data/balanceConstants';
import { calculateDamage, calculateHealing } from '@/systems/combat/damageCalc';
import { applySkillMode, modeQuestionFor, skillModesFor } from '@/systems/combat/skillModes';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { requireUnit } from '@/systems/combat/unitLookup';
import { applyAllyHealOnHit } from '@/systems/combat/combatEvents';
import { AfflictionType, AuraType, CombatUnit, HeroStats, LEVEL_SCALE, SkillModeId } from '@/models/types';
import { at, makeEffect, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * Oath and Zeal: the two Templar nodes that stopped being flat stats.
 *
 * What is pinned is the rules — what counts as a heal that "did something", how
 * an area heal hands out the ward, that a repeat refreshes rather than stacks,
 * and that the numbers Mercy and Wrath show are the numbers the cast delivers —
 * rather than the tuning values the cases happen to use.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ maxHp: 200, defense: 0, magic: 20, attack: 20, maxMana: 100, critChance: 0, dodgeChance: 0, ...over });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const effect = (id: string, type: AuraType | AfflictionType) =>
  unitNow(id).activeEffects.find((e) => e.type === type);
const ward = (id: string) => effect(id, AuraType.MagicDefenseBuff);
const wards = (id: string) => unitNow(id).activeEffects.filter((e) => e.type === AuraType.MagicDefenseBuff);

const rank = (level: number) => ({ level, scale: LEVEL_SCALE[level - 1] });

/** A Templar who owns Oath and Zeal, at the given rungs. */
const templar = (over: Partial<CombatUnit> = {}, oathLevel = 2, zealLevel = 2) =>
  makeUnit({
    id: 'templar',
    position: at(0, 0),
    stats: stats(),
    passives: ['oath', 'zeal'],
    passiveRanks: { oath: rank(oathLevel), zeal: rank(zealLevel) },
    skills: [divineLight, layOnHands, smite],
    ...over,
  });

beforeEach(() => {
  resetFixtureIds();
  state().reset();
});

// ─── Oath ─────────────────────────────────────────────────────────────────────

describe('Oath', () => {
  it('replaces the flat stats with a trigger', () => {
    const node = findMasteryNode('templar_oath')!.node;
    expect(node.grantsPassive).toBe('oath');
    expect(node.statBonus).toBeUndefined();
  });

  it('wards the Templar and the ally after a heal that restored HP', () => {
    const me = templar({ currentHp: 150 });
    const friend = makeUnit({ id: 'friend', position: at(1, 0), currentHp: 100, stats: stats({ defense: 20 }) });
    useCombatStore.setState({ units: [me, friend] });

    resolveSkillUse(me, divineLight, me.position, SILENT_SINK);

    expect(ward('friend')).toBeDefined();
    expect(ward('templar')).toBeDefined();
    expect(ward('friend')!.duration).toBe(BALANCE.OATH_WARD_DURATION);
  });

  it('is a Magic Defense ward only, sized by the ally\'s own defence', () => {
    const me = templar({ currentHp: 150 });
    const friend = makeUnit({ id: 'friend', position: at(1, 0), currentHp: 100, stats: stats({ defense: 30 }) });
    useCombatStore.setState({ units: [me, friend] });
    const before = getCombatEffectiveStats(friend);

    resolveSkillUse(me, divineLight, me.position, SILENT_SINK);

    const after = getCombatEffectiveStats(unitNow('friend'));
    expect(after.magicDefense! - before.magicDefense!).toBe(ward('friend')!.magnitude);
    expect(after.magicDefense!).toBeGreaterThan(before.magicDefense!);
    expect(after.defense).toBe(before.defense);
    // Sized off the ally: the armoured friend gets more than the unarmoured Templar
    expect(ward('friend')!.magnitude).toBeGreaterThan(ward('templar')!.magnitude);
  });

  it('does nothing for a heal that restored nothing', () => {
    const me = templar();
    const friend = makeUnit({ id: 'friend', position: at(1, 0) });
    useCombatStore.setState({ units: [me, friend] });

    resolveSkillUse(me, divineLight, me.position, SILENT_SINK);

    expect(ward('friend')).toBeUndefined();
    expect(ward('templar')).toBeUndefined();
  });

  it('counts a cleanse that removed something', () => {
    const cleanseOnly = { ...divineLight, healing: undefined };
    const me = templar();
    const sick = makeUnit({
      id: 'sick', position: at(1, 0), activeEffects: [makeEffect(AfflictionType.Poison, { magnitude: 4 })],
    });
    const clean = makeUnit({ id: 'clean', position: at(-1, 0) });
    useCombatStore.setState({ units: [me, sick, clean] });

    resolveSkillUse(me, cleanseOnly, me.position, SILENT_SINK);

    expect(effect('sick', AfflictionType.Poison)).toBeUndefined();
    expect(ward('sick')).toBeDefined();
    expect(ward('templar')).toBeDefined();
    // The clean ally had nothing removed, so nothing was granted to them
    expect(ward('clean')).toBeUndefined();
  });

  it('is not triggered by a cleanse with nothing to remove', () => {
    const cleanseOnly = { ...divineLight, healing: undefined };
    const me = templar();
    const clean = makeUnit({ id: 'clean', position: at(1, 0) });
    useCombatStore.setState({ units: [me, clean] });

    resolveSkillUse(me, cleanseOnly, me.position, SILENT_SINK);

    expect(ward('clean')).toBeUndefined();
    expect(ward('templar')).toBeUndefined();
  });

  it('refreshes on a repeat trigger instead of stacking', () => {
    const me = templar({ currentHp: 100 });
    useCombatStore.setState({ units: [me] });

    resolveSkillUse(me, layOnHands, me.position, SILENT_SINK);
    const once = ward('templar')!;

    // Let the clock run down, then trigger again
    state().tickEffectsOnUnit('templar');
    expect(ward('templar')!.duration).toBe(BALANCE.OATH_WARD_DURATION - 1);
    useCombatStore.setState((st) => ({
      units: st.units.map((u) => (u.id === 'templar' ? { ...u, currentHp: 100, cooldowns: {} } : u)),
    }));
    resolveSkillUse(unitNow('templar'), layOnHands, me.position, SILENT_SINK);

    const twice = ward('templar')!;
    expect(twice.magnitude).toBe(once.magnitude);
    expect(twice.duration).toBe(BALANCE.OATH_WARD_DURATION);
    expect(wards('templar')).toHaveLength(1);
  });

  it('hands an area heal\'s ward to each ally who was healed, and the Templar one', () => {
    const me = templar({ currentHp: 100 });
    const a = makeUnit({ id: 'a', position: at(1, 0), currentHp: 50, stats: stats({ defense: 20 }) });
    const b = makeUnit({ id: 'b', position: at(-1, 0), currentHp: 50, stats: stats({ defense: 20 }) });
    const whole = makeUnit({ id: 'whole', position: at(0, 1), stats: stats({ defense: 20 }) });
    const far = makeUnit({ id: 'far', position: at(0, 6), currentHp: 10, stats: stats({ defense: 20 }) });
    useCombatStore.setState({ units: [me, a, b, whole, far] });

    resolveSkillUse(me, divineLight, me.position, SILENT_SINK);

    expect(ward('a')).toBeDefined();
    expect(ward('b')).toBeDefined();
    // At full health, so the heal restored nothing to them; and out of reach
    expect(ward('whole')).toBeUndefined();
    expect(ward('far')).toBeUndefined();
    expect(wards('templar')).toHaveLength(1);
  });

  it('is not triggered by passive healing ticks', () => {
    const me = templar({
      currentHp: 100,
      activeEffects: [makeEffect(AuraType.HealOverTime, { magnitude: 10, duration: 3 })],
    });
    useCombatStore.setState({ units: [me] });

    state().tickEffectsOnUnit('templar');

    expect(unitNow('templar').currentHp).toBe(110);
    expect(ward('templar')).toBeUndefined();
  });

  it('is triggered by Smite\'s incidental heal', () => {
    const me = templar();
    const friend = makeUnit({ id: 'friend', position: at(0, 2), currentHp: 80, stats: stats({ defense: 20 }) });
    const foe = makeFoe({ id: 'foe', position: at(1, 0), stats: stats({ maxHp: 500 }) });
    useCombatStore.setState({ units: [me, friend, foe] });

    resolveSkillUse(me, smite, foe.position, SILENT_SINK);

    expect(unitNow('friend').currentHp).toBeGreaterThan(80);
    expect(ward('friend')).toBeDefined();
    expect(ward('templar')).toBeDefined();
  });

  it('wards once when the Templar mends itself', () => {
    const me = templar({ currentHp: 40 });
    const foe = makeFoe({ id: 'foe', position: at(1, 0), stats: stats({ maxHp: 500 }) });
    useCombatStore.setState({ units: [me, foe] });

    resolveSkillUse(me, smite, foe.position, SILENT_SINK);

    expect(unitNow('templar').currentHp).toBeGreaterThan(40);
    expect(wards('templar')).toHaveLength(1);
  });

  it('is worth more at every rung', () => {
    const wardAt = (level: number) => {
      state().reset();
      const me = templar({ currentHp: 100 }, level);
      const friend = makeUnit({ id: 'friend', position: at(1, 0), currentHp: 50, stats: stats({ defense: 20 }) });
      useCombatStore.setState({ units: [me, friend] });
      resolveSkillUse(me, divineLight, me.position, SILENT_SINK);
      return ward('friend')!.magnitude;
    };
    expect(wardAt(1)).toBeLessThan(wardAt(2));
    expect(wardAt(2)).toBeLessThan(wardAt(3));
  });
});

// ─── Zeal: Mercy and Wrath ────────────────────────────────────────────────────

describe('Zeal', () => {
  it('replaces the flat Speed / Attack with a choice on Smite', () => {
    const node = findMasteryNode('templar_zeal')!.node;
    expect(node.grantsPassive).toBe('zeal');
    expect(node.statBonus).toBeUndefined();
    expect(smite.modeChoice).toBe('zeal');
  });

  it('offers a choice only to a Templar who owns Zeal', () => {
    const plain = templar({ passives: [] });
    expect(skillModesFor(plain, smite)).toEqual([]);
    expect(modeQuestionFor(plain, smite)).toBeNull();

    const zealous = templar();
    expect(skillModesFor(zealous, smite).map((m) => m.id)).toEqual(['mercy', 'wrath']);
    expect(modeQuestionFor(zealous, smite)).toHaveLength(2);
    // Once answered, the press goes straight on to aiming
    expect(modeQuestionFor(zealous, smite, 'mercy')).toBeNull();
    // And a skill with no choice never asks
    expect(modeQuestionFor(zealous, layOnHands)).toBeNull();
  });

  it('keeps one skill: same id, range, cost and cooldown in either mode', () => {
    const zealous = templar();
    for (const mode of ['mercy', 'wrath'] as SkillModeId[]) {
      const derived = applySkillMode(zealous, smite, mode);
      expect(derived.id).toBe(smite.id);
      expect(derived.range).toBe(smite.range);
      expect(derived.manaCost).toBe(smite.manaCost);
      expect(derived.cooldown).toBe(smite.cooldown);
      expect(derived.targetType).toBe(smite.targetType);
      expect(derived.mode).toBe(mode);
    }
    // And the authored skill is left alone
    expect(smite.mode).toBeUndefined();
  });

  it('trades Mercy\'s strike for a stronger heal, and puts Wrath all in the blow', () => {
    const zealous = templar();
    const mercy = applySkillMode(zealous, smite, 'mercy');
    const wrath = applySkillMode(zealous, smite, 'wrath');

    expect(mercy.damage!).toBeLessThan(smite.damage!);
    expect(mercy.allyHeal!).toBeGreaterThan(smite.allyHeal!);
    expect(wrath.damage!).toBeGreaterThan(smite.damage!);
    expect(wrath.allyHeal).toBeUndefined();
  });

  it('improves each mode with every rung, so an upgraded mode is never worse', () => {
    const at = (level: number) => {
      const zealous = templar({}, 2, level);
      return {
        mercy: applySkillMode(zealous, smite, 'mercy'),
        wrath: applySkillMode(zealous, smite, 'wrath'),
      };
    };
    const [r1, r2, r3] = [at(1), at(2), at(3)];
    for (const [lo, hi] of [[r1, r2], [r2, r3]]) {
      expect(hi.mercy.damage!).toBeGreaterThan(lo.mercy.damage!);
      expect(hi.mercy.allyHeal!).toBeGreaterThan(lo.mercy.allyHeal!);
      expect(hi.wrath.damage!).toBeGreaterThan(lo.wrath.damage!);
    }
  });

  describe('the cast delivers what the mode shows', () => {
    const FOE_HP = 5000;
    const cast = (mode: SkillModeId, caster: CombatUnit) => {
      const friend = makeUnit({ id: 'friend', position: at(0, 2), currentHp: 100, stats: stats() });
      const foe = makeFoe({ id: 'foe', position: at(1, 0), stats: stats({ maxHp: FOE_HP, defense: 4 }) });
      useCombatStore.setState({ units: [caster, friend, foe] });
      const preview = applySkillMode(caster, smite, mode);
      const result = resolveSkillUse(caster, smite, foe.position, SILENT_SINK, { mode });
      return { preview, result, foe };
    };

    it.each(['mercy', 'wrath'] as SkillModeId[])('%s: strike and heal equal the preview', (mode) => {
      const me = templar();
      const { preview, result, foe } = cast(mode, me);
      expect(result.ok).toBe(true);

      expect(FOE_HP - unitNow('foe').currentHp).toBe(calculateDamage(me, foe, preview));

      const healed = unitNow('friend').currentHp - 100;
      expect(healed).toBe(
        mode === 'wrath' ? 0 : calculateHealing(me, { ...preview, healing: preview.allyHeal }),
      );
    });

    it('a cast with no mode is the authored Smite', () => {
      const me = templar();
      const friend = makeUnit({ id: 'friend', position: at(0, 2), currentHp: 50 });
      const foe = makeFoe({ id: 'foe', position: at(1, 0), stats: stats({ maxHp: FOE_HP, defense: 4 }) });
      useCombatStore.setState({ units: [me, friend, foe] });
      resolveSkillUse(me, smite, foe.position, SILENT_SINK);
      expect(FOE_HP - unitNow('foe').currentHp).toBe(calculateDamage(me, foe, smite));
    });

    it('Wrath hits harder than Mercy against the same foe', () => {
      const dealt = (mode: SkillModeId) => {
        state().reset();
        cast(mode, templar());
        return FOE_HP - unitNow('foe').currentHp;
      };
      expect(dealt('wrath')).toBeGreaterThan(dealt('mercy'));
    });

    it('Mercy heals more than a plain Smite', () => {
      const healedBy = (mode?: SkillModeId) => {
        state().reset();
        const me = templar();
        const friend = makeUnit({ id: 'friend', position: at(0, 2), currentHp: 50 });
        const foe = makeFoe({ id: 'foe', position: at(1, 0), stats: stats({ maxHp: FOE_HP }) });
        useCombatStore.setState({ units: [me, friend, foe] });
        resolveSkillUse(me, smite, foe.position, SILENT_SINK, { mode });
        return unitNow('friend').currentHp - 50;
      };
      expect(healedBy('mercy')).toBeGreaterThan(healedBy());
    });
  });

  it('refuses a mode the caster was not offered, and spends nothing', () => {
    const plain = templar({ passives: [], skills: [smite] });
    const foe = makeFoe({ id: 'foe', position: at(1, 0), stats: stats({ maxHp: 500 }) });
    useCombatStore.setState({ units: [plain, foe] });

    const result = resolveSkillUse(plain, smite, foe.position, SILENT_SINK, { mode: 'wrath' });

    expect(result.ok).toBe(false);
    expect(result.endsTurn).toBe(false);
    expect(unitNow('foe').currentHp).toBe(500);
    expect(unitNow('templar').currentMana).toBe(plain.currentMana);
  });

  it('does not carry a mode from one press into the next, and cancelling selects nothing', () => {
    state().selectSkill(smite, 'wrath');
    expect(state().selectedMode).toBe('wrath');
    state().selectSkill(smite);
    expect(state().selectedMode).toBeNull();
    state().selectSkill(smite, 'mercy');
    state().selectSkill(null);
    expect(state().selectedSkill).toBeNull();
    expect(state().selectedMode).toBeNull();
  });

  it('asking the question spends no action: nothing is selected until a mode comes back', () => {
    const zealous = templar();
    useCombatStore.setState({ units: [zealous] });

    // The HUD asks, and a cancelled question never selects or resolves anything
    expect(modeQuestionFor(zealous, smite)).not.toBeNull();
    expect(state().selectedSkill).toBeNull();
    expect(unitNow('templar').hasActed).toBe(false);
    expect(unitNow('templar').currentMana).toBe(zealous.currentMana);
  });

  it('Mercy heals the Templar itself when it is the most wounded, and wards it once', () => {
    const me = templar({ currentHp: 30 });
    const foe = makeFoe({ id: 'foe', position: at(1, 0), stats: stats({ maxHp: 5000 }) });
    useCombatStore.setState({ units: [me, foe] });

    resolveSkillUse(me, smite, foe.position, SILENT_SINK, { mode: 'mercy' });

    expect(unitNow('templar').currentHp).toBeGreaterThan(30);
    expect(wards('templar')).toHaveLength(1);
  });

  it('Wrath heals nobody, so it grants no Oath', () => {
    const me = templar({ currentHp: 30 });
    const foe = makeFoe({ id: 'foe', position: at(1, 0), stats: stats({ maxHp: 5000 }) });
    useCombatStore.setState({ units: [me, foe] });

    resolveSkillUse(me, smite, foe.position, SILENT_SINK, { mode: 'wrath' });

    expect(unitNow('templar').currentHp).toBe(30);
    expect(ward('templar')).toBeUndefined();
  });

  it('Mercy with nobody wounded is an ineffective heal and grants no Oath', () => {
    const me = templar();
    const friend = makeUnit({ id: 'friend', position: at(0, 2) });
    const foe = makeFoe({ id: 'foe', position: at(1, 0), stats: stats({ maxHp: 5000 }) });
    useCombatStore.setState({ units: [me, friend, foe] });

    resolveSkillUse(me, smite, foe.position, SILENT_SINK, { mode: 'mercy' });

    expect(ward('templar')).toBeUndefined();
    expect(ward('friend')).toBeUndefined();
  });

  it('still flags Mercy\'s heal as exempt from the Aethelred Tithe', () => {
    const me = templar({ currentHp: 30 });
    useCombatStore.setState({ units: [me] });
    const mercy = applySkillMode(me, smite, 'mercy');
    expect(applyAllyHealOnHit(me, mercy, 25)[0]?.exemptFromTithe).toBe(true);
  });

  it('says what each mode does on the tooltip', () => {
    const me = templar();
    const plain = skillEffectLines(smite, me).join('\n');
    expect(plain).toMatch(/Choose before aiming/);
    expect(plain).toMatch(/Mercy/);
    expect(plain).toMatch(/Wrath/);
    expect(skillEffectLines(applySkillMode(me, smite, 'mercy'), me).join('\n')).toMatch(/Mercy: /);
    // Wrath's description no longer promises a heal it does not give
    expect(describeSkill(applySkillMode(me, smite, 'wrath'))).not.toMatch(/mends/);
    expect(describeSkill(applySkillMode(me, smite, 'mercy'))).toMatch(/mends/);
  });
});
