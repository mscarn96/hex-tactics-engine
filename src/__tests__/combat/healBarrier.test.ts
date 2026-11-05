import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { heal } from '@/data/skills/skillData';
import { AuraType, CombatUnit } from '@/models/types';
import { at, makeStats, makeUnit } from '../support/fixtures';

/**
 * The base Druid heal is half a mend and half a shield.
 *
 * One cast has to deliver both — the resolver heals inside the strike loop and
 * applies `appliesEffect` afterwards over the same hexes, so the ordering is
 * what makes this a single button rather than two.
 */

const MAGIC = 20;

const druid = (over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'druid',
    heroId: 'h1',
    position: at(0, 0),
    stats: makeStats({ magic: MAGIC, attack: 5, maxMana: 50 }),
    skills: [heal],
    ...over,
  });

const ally = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'ally', heroId: 'h2', position: at(0, 1), ...over });

const foe = () => makeUnit({ id: 'foe', isPlayer: false, position: at(0, -3) });

const unitNow = (id: string) => useCombatStore.getState().units.find((u) => u.id === id)!;
const barrierOn = (id: string) =>
  unitNow(id).activeEffects.find((e) => e.type === AuraType.Barrier);

const setup = (units: CombatUnit[]) => {
  useCombatStore.getState().reset();
  useCombatStore.getState().initCombat(units, [foe()]);
};

describe('heal mends and shields in one cast', () => {
  it('scales both halves off magic', () => {
    setup([druid(), ally({ currentHp: 40 })]);
    const caster = unitNow('druid');

    const result = resolveSkillUse(caster, heal, at(0, 1), SILENT_SINK);
    expect(result.ok).toBe(true);

    expect(unitNow('ally').currentHp).toBe(40 + Math.round(MAGIC * 0.52));
    expect(barrierOn('ally')?.magnitude).toBe(Math.round(MAGIC * 0.4));
    expect(barrierOn('ally')?.duration).toBe(3);
  });

  /**
   * The whole reason `scaling: 'magic'` is on the skill: the fraction would
   * otherwise resolve against attack, which a Druid has a third as much of.
   */
  it('does not scale the shield off the Druid’s attack', () => {
    setup([druid({ stats: makeStats({ magic: MAGIC, attack: 5, maxMana: 50 }) }), ally()]);
    resolveSkillUse(unitNow('druid'), heal, at(0, 1), SILENT_SINK);
    expect(barrierOn('ally')!.magnitude).toBeGreaterThan(Math.round(5 * 0.4));
  });

  it('works cast on yourself, which is the only target a lone Druid has', () => {
    setup([druid({ currentHp: 50 })]);
    const result = resolveSkillUse(unitNow('druid'), heal, at(0, 0), SILENT_SINK);
    expect(result.ok).toBe(true);
    expect(unitNow('druid').currentHp).toBe(50 + Math.round(MAGIC * 0.52));
    expect(barrierOn('druid')?.magnitude).toBe(Math.round(MAGIC * 0.4));
  });

  // A barrier granted to a full-health ally is the whole point of the split:
  // pre-emptive rather than reactive, so the heal being wasted is not
  it('still shields an ally who has taken no damage', () => {
    setup([druid(), ally()]);
    const result = resolveSkillUse(unitNow('druid'), heal, at(0, 1), SILENT_SINK);
    expect(result.ok).toBe(true);
    expect(barrierOn('ally')).toBeDefined();
  });

  it('carries the Stoneshaper’s shield bonus into the barrier', () => {
    setup([druid({ masteryModifiers: { shieldPowerBonus: 0.25 } }), ally()]);
    resolveSkillUse(unitNow('druid'), heal, at(0, 1), SILENT_SINK);
    expect(barrierOn('ally')!.magnitude).toBe(Math.round(Math.round(MAGIC * 0.4) * 1.25));
  });

  it('never lands the shield on an enemy', () => {
    setup([druid()]);
    resolveSkillUse(unitNow('druid'), heal, at(0, -3), SILENT_SINK);
    expect(barrierOn('foe')).toBeUndefined();
  });
});
