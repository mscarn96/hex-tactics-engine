import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { applySkillStatus } from '@/systems/combat/combatEvents';
import { calculateDamage, resolveEffectMagnitude } from '@/systems/combat/damageCalc';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { requireUnit } from '@/systems/combat/unitLookup';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { frostbite } from '@/data/skills/masterySkills';
import { findMasteryNode } from '@/data/skills/masteryData';
import { skillEffectLines } from '@/data/display/skillDisplay';
import { PASSIVE_DEFS } from '@/systems/combat/passives';
import { deepColdTurns, killingFrostPen, meltwaterBarrier, shatterpointBonus } from '@/systems/combat/passiveFormulas';

import {
  AfflictionType, AuraType, CombatUnit, HeroSkill, HeroStats, PassiveId, PassiveRank, SkillTargetType,
} from '@/models/types';
import { at, makeEffect, makeFoe, makeSkill, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';
import { masteryNodeDescription } from '@/data/display/masteryText';

/**
 * The Hydromancer's control-to-damage decisions, as rules.
 *
 * Shatterpoint cashes a Freeze in for damage (and spends it), Meltwater shields
 * the most wounded ally when a Freeze lands (once a turn), Deep Cold lengthens a
 * Chill laid from beyond one hex, and Killing Frost makes magic against a Chilled
 * enemy ignore part of its Magic Defense. Freeze itself must stay a valid authored
 * interrupt. Numbers come from the definitions; what is pinned is the shape.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 300, attack: 10, magic: 30, defense: 0, magicDefense: 0, maxMana: 100,
    critChance: 0, dodgeChance: 0, speed: 10, ...over,
  });

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const RANKS: PassiveRank[] = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));

const hydro = (passive?: PassiveId, level = 2, over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'hydro',
    position: at(0, 0),
    stats: stats(),
    skills: [frostbite],
    passives: passive ? [passive] : [],
    passiveRanks: passive ? { [passive]: RANKS[level - 1] } : {},
    ...over,
  });

const foe = (over: Partial<CombatUnit> = {}) =>
  makeFoe({ id: 'foe', position: at(1, 0), stats: stats({ maxHp: 1000 }), ...over });

const spell = (over: Partial<HeroSkill> = {}): HeroSkill =>
  makeSkill({
    id: 'test_spell' as HeroSkill['id'], name: 'Test Spell', range: 3, damage: 1,
    scaling: 'magic', damageType: 'magic', ...over,
  });

const chill = (over = {}) => makeEffect(AfflictionType.Chill, { magnitude: 3, duration: 3, ...over });
const freeze = (over = {}) => makeEffect(AfflictionType.Freeze, { duration: 2, ...over });
const land = (type: AfflictionType, duration = 3, target = 'foe') =>
  applySkillStatus(unitNow('hydro'), target, { type, magnitude: 3, duration, sourceUnitId: 'hydro' }, SILENT_SINK);

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  state().reset();
});

// ─── Shatterpoint ─────────────────────────────────────────────────────────────

describe('Shatterpoint', () => {
  const hit = (passive: PassiveId | undefined, level: number, frozen: boolean) => {
    const me = hydro(passive, level);
    const target = foe({ activeEffects: frozen ? [freeze()] : [] });
    useCombatStore.setState({ units: [me, target] });
    const before = unitNow('foe').currentHp;
    resolveSkillUse(me, spell(), target.position, SILENT_SINK);
    return before - unitNow('foe').currentHp;
  };

  it('adds damage to the blow that breaks a Freeze, and spends the Freeze', () => {
    const plain = hit(undefined, 2, true);
    const withNode = hit('shatterpoint', 2, true);
    expect(withNode).toBeGreaterThan(plain);
    expect(unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Freeze)).toBe(false);
  });

  it('adds nothing against an enemy that is not Frozen', () => {
    expect(hit('shatterpoint', 2, false)).toBe(hit(undefined, 2, false));
  });

  it('pays only on the first hit: a second strike finds no Freeze to break', () => {
    const me = hydro('shatterpoint');
    useCombatStore.setState({ units: [me, foe({ activeEffects: [freeze()] })] });
    resolveSkillUse(me, spell(), at(1, 0), SILENT_SINK);
    const afterFirst = unitNow('foe').currentHp;
    useCombatStore.setState({ units: [unitNow('hydro'), unitNow('foe')] });
    resolveSkillUse(unitNow('hydro'), spell(), at(1, 0), SILENT_SINK);
    const second = afterFirst - unitNow('foe').currentHp;
    const first = 1000 - afterFirst;
    expect(first).toBeGreaterThan(second);
  });

  it('is a bigger payoff at every rung', () => {
    const gains = [1, 2, 3].map((level) => hit('shatterpoint', level, true) - hit(undefined, 2, true));
    expect(gains[0]).toBeGreaterThan(0);
    expect(gains[1]).toBeGreaterThan(gains[0]);
    expect(gains[2]).toBeGreaterThan(gains[1]);
  });

  it('sizes the extra from the blow through the one function', () => {
    const plain = hit(undefined, 2, true);
    const withNode = hit('shatterpoint', 2, true);
    // The blow itself is `plain` less the ice's own burst, which both runs share
    const burst = Math.round(1000 * 0.12);
    expect(withNode - plain).toBe(shatterpointBonus(plain - burst, RANKS[1]));
  });
});

// ─── Meltwater ────────────────────────────────────────────────────────────────

describe('Meltwater', () => {
  const ally = (over: Partial<CombatUnit> = {}) =>
    makeUnit({ id: 'ally', position: at(0, 1), stats: stats({ maxHp: 100 }), currentHp: 30, ...over });
  const barrierOn = (id: string) =>
    unitNow(id).activeEffects.find((e) => e.type === AuraType.Barrier)?.magnitude;

  it('shields the most wounded ally when a Chill becomes a Freeze', () => {
    const me = hydro('meltwater');
    const second = ally({ id: 'second', position: at(1, 1), currentHp: 80 });
    useCombatStore.setState({ units: [me, ally(), second, foe()] });
    land(AfflictionType.Chill);
    expect(barrierOn('ally')).toBeUndefined();
    land(AfflictionType.Chill);
    expect(unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Freeze)).toBe(true);
    expect(barrierOn('ally')).toBe(resolveEffectMagnitude(AuraType.Barrier, meltwaterBarrier(RANKS[1]), me, 'magic'));
    expect(barrierOn('second')).toBeUndefined();
    expect(barrierOn('hydro')).toBeUndefined();
  });

  it('can shield the Hydromancer when it is the most wounded', () => {
    const me = hydro('meltwater', 2, { currentHp: 20 });
    useCombatStore.setState({ units: [me, ally(), foe({ activeEffects: [chill()] })] });
    land(AfflictionType.Chill);
    expect(barrierOn('hydro')).toBeDefined();
    expect(barrierOn('ally')).toBeUndefined();
  });

  it('fires once a turn, so an area Freeze is one shield', () => {
    const me = hydro('meltwater');
    useCombatStore.setState({
      units: [
        me, ally(),
        foe({ activeEffects: [chill()] }),
        foe({ id: 'foe2', position: at(1, -1), activeEffects: [chill()] }),
      ],
    });
    land(AfflictionType.Chill);
    const once = barrierOn('ally');
    land(AfflictionType.Chill, 3, 'foe2');
    expect(unitNow('foe2').activeEffects.some((e) => e.type === AfflictionType.Freeze)).toBe(true);
    expect(barrierOn('ally')).toBe(once);
  });

  it('does nothing for a Chill that only chills, or for a Freeze that did not land', () => {
    useCombatStore.setState({ units: [hydro('meltwater'), ally(), foe()] });
    land(AfflictionType.Chill);
    expect(barrierOn('ally')).toBeUndefined();
  });

  it('is a larger Barrier at every rung', () => {
    const sizes = [1, 2, 3].map((level) => {
      state().reset();
      useCombatStore.setState({ units: [hydro('meltwater', level), ally(), foe({ activeEffects: [chill()] })] });
      land(AfflictionType.Chill);
      return barrierOn('ally')!;
    });
    expect(sizes[1]).toBeGreaterThan(sizes[0]);
    expect(sizes[2]).toBeGreaterThan(sizes[1]);
  });

  it('fires when a boss becomes Brittle instead of freezing', () => {
    const bossTemplate = enemyTemplates.find((t) => t.tier === 'boss')!;
    const boss = foe({ id: 'foe', templateId: bossTemplate.id, activeEffects: [chill()] });
    useCombatStore.setState({ units: [hydro('meltwater'), ally(), boss] });
    land(AfflictionType.Chill);
    expect(unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Freeze)).toBe(false);
    expect(unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Brittle)).toBe(true);
    expect(barrierOn('ally')).toBeDefined();
  });
});

// ─── Deep Cold ────────────────────────────────────────────────────────────────

describe('Deep Cold', () => {
  const chillLength = (passive: PassiveId | undefined, level: number, distance: number) => {
    useCombatStore.setState({ units: [hydro(passive, level), foe({ position: at(distance, 0) })] });
    land(AfflictionType.Chill, 3);
    return unitNow('foe').activeEffects.find((e) => e.type === AfflictionType.Chill)!.duration;
  };

  it('lengthens a Chill laid from beyond one hex, and only those', () => {
    expect(chillLength('deepCold', 2, 2)).toBe(3 + deepColdTurns(RANKS[1]));
    state().reset();
    expect(chillLength('deepCold', 2, 1)).toBe(3);
    state().reset();
    expect(chillLength(undefined, 2, 3)).toBe(3);
  });

  it('adds more at every rung', () => {
    const lengths = [1, 2, 3].map((level) => {
      state().reset();
      return chillLength('deepCold', level, 3);
    });
    expect(lengths[1]).toBeGreaterThan(lengths[0]);
    expect(lengths[2]).toBeGreaterThan(lengths[1]);
  });

  it('applies through a real cast of Frostbite, and the preview says the same length', () => {
    const me = hydro('deepCold');
    useCombatStore.setState({ units: [me, foe({ position: at(3, 0) })] });
    resolveSkillUse(me, frostbite, at(3, 0), SILENT_SINK);
    const landed = unitNow('foe').activeEffects.find((e) => e.type === AfflictionType.Chill)!;
    expect(landed.duration).toBe(frostbite.appliesEffect && (frostbite.appliesEffect as { duration: number }).duration + deepColdTurns(RANKS[1]));
    expect(skillEffectLines(frostbite, me).join('\n')).toContain(`Chill lasts ${landed.duration} turns`);
  });
});

// ─── Killing Frost ────────────────────────────────────────────────────────────

describe('Killing Frost', () => {
  const dmg = (passive: PassiveId | undefined, level: number, skill: HeroSkill, chilled: boolean) => {
    const me = hydro(passive, level);
    const target = foe({
      stats: stats({ maxHp: 1000, defense: 80, magicDefense: 80 }),
      activeEffects: chilled ? [chill()] : [],
    });
    return calculateDamage(me, target, skill);
  };

  it('makes magic hit harder against a Chilled enemy only', () => {
    expect(dmg('killingFrost', 2, spell(), true)).toBeGreaterThan(dmg(undefined, 2, spell(), true));
    expect(dmg('killingFrost', 2, spell(), false)).toBe(dmg(undefined, 2, spell(), false));
  });

  it('leaves physical hits alone', () => {
    const physical = spell({ damageType: 'physical', scaling: 'attack' });
    expect(dmg('killingFrost', 2, physical, true)).toBe(dmg(undefined, 2, physical, true));
  });

  it('is not on the hero sheet: the stat stays honest against everything else', () => {
    const me = hydro('killingFrost');
    expect(getCombatEffectiveStats(me).armourPen ?? 0).toBe(0);
  });

  it('ignores more at every rung', () => {
    const hits = [1, 2, 3].map((level) => dmg('killingFrost', level, spell(), true));
    expect(hits[1]).toBeGreaterThan(hits[0]);
    expect(hits[2]).toBeGreaterThan(hits[1]);
  });

  it('does not apply to a Frozen enemy, whose Chill is spent', () => {
    const me = hydro('killingFrost');
    const frozen = foe({ stats: stats({ maxHp: 1000, magicDefense: 30 }), activeEffects: [freeze()] });
    const bare = hydro();
    expect(calculateDamage(me, frozen, spell())).toBe(calculateDamage(bare, frozen, spell()));
  });
});

// ─── Freeze stays an interrupt ────────────────────────────────────────────────

describe('Freeze as an authored interrupt', () => {
  const bossTemplate = enemyTemplates.find((t) => t.tier === 'boss')!;
  const warned = (interruptedBy: ('stun' | 'silence' | 'freeze' | 'root')[]): HeroSkill =>
    makeSkill({
      id: 'warned_slam' as HeroSkill['id'], name: 'Warned Slam',
      targetType: SkillTargetType.Ring, range: 0, aoeRadius: 1, damage: 1,
      prepares: { interruptedBy, tauntCancels: false },
    });
  const start = (interruptedBy: ('stun' | 'silence' | 'freeze' | 'root')[], passive?: PassiveId) => {
    const boss = makeFoe({
      id: 'foe', name: 'Boss', templateId: bossTemplate.id, position: at(1, 0),
      stats: stats({ maxHp: 500, speed: 20 }), skills: [warned(interruptedBy)],
    });
    state().reset();
    state().initCombat([hydro(passive)], [boss]);
    useCombatStore.setState({ currentUnitId: 'foe' });
    resolveSkillUse(unitNow('foe'), warned(interruptedBy), at(1, 0), SILENT_SINK);
    expect(state().preparedAttacks).toHaveLength(1);
  };

  it('a second Chill, which freezes, cancels a preparation that accepts Stun and Freeze', () => {
    start(['stun', 'freeze']);
    land(AfflictionType.Chill);
    expect(state().preparedAttacks).toHaveLength(1);
    land(AfflictionType.Chill);
    expect(state().preparedAttacks).toHaveLength(0);
    // The boss does not keep the ice
    expect(unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Freeze)).toBe(false);
  });

  it('a Freeze applied outright still cancels it, with every node owned', () => {
    start(['stun', 'freeze'], 'meltwater');
    land(AfflictionType.Freeze);
    expect(state().preparedAttacks).toHaveLength(0);
  });

  it('does not cancel a preparation that does not list Freeze', () => {
    start(['stun']);
    land(AfflictionType.Chill);
    land(AfflictionType.Chill);
    expect(state().preparedAttacks).toHaveLength(1);
  });

  it('stays available to Stun-only previews as a distinct, listed key', () => {
    expect(warned(['stun', 'freeze']).prepares?.interruptedBy).toContain('freeze');
  });
});

// ─── The tree text ────────────────────────────────────────────────────────────

describe('the Hydromancer nodes say what they do', () => {
  it('puts Twin Fangs, the Frostbite upgrade, in the centre of the first row', () => {
    const fangs = findMasteryNode('hydro_twin_fangs')!.node;
    expect(fangs.column).toBe(2);
    expect(fangs.grantsPassive).toBe('twinFangs');
    expect(masteryNodeDescription(fangs)).toMatch(/Frostbite/);
  });

  it.each([
    ['hydro_shatterpoint', 'shatterpoint', /Freeze/],
    ['hydro_meltwater', 'meltwater', /Barrier/],
    ['hydro_deep_cold', 'deepCold', /Chill/],
    ['hydro_killing_frost', 'killingFrost', /Magic Defense/],
  ] as const)('%s grants %s, carries no flat stat, and describes the rule', (nodeId, passive, words) => {
    const node = findMasteryNode(nodeId)!.node;
    expect(node.grantsPassive).toBe(passive);
    expect(node.statBonus).toBeUndefined();
    expect(masteryNodeDescription(node)).toMatch(words);
  });

  it.each(['shatterpoint', 'meltwater', 'deepCold', 'killingFrost'] as PassiveId[])(
    '%s states different figures at each rung',
    (id) => {
      const lines = RANKS.map((r) => (PASSIVE_DEFS[id].figures?.(r) ?? []).join('|'));
      expect(new Set(lines).size).toBe(3);
    },
  );

  it('previews each chosen tradeoff on the skills it touches', () => {
    const me = hydro('shatterpoint');
    me.passives = ['shatterpoint', 'meltwater', 'deepCold', 'killingFrost'];
    me.passiveRanks = Object.fromEntries(me.passives.map((p) => [p, RANKS[1]]));
    const text = skillEffectLines(frostbite, me).join('\n');
    expect(text).toMatch(/Deep Cold/);
    expect(text).toMatch(/Meltwater/);
    expect(text).toMatch(/Shatterpoint/);
    expect(text).toContain(`${killingFrostPen(RANKS[1])}%`);
    // A caster with none of them sees none of it
    expect(skillEffectLines(frostbite, hydro()).join('\n')).not.toMatch(/Deep Cold|Meltwater|Shatterpoint|Killing Frost/);
  });
});
