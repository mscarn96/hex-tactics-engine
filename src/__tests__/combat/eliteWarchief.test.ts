import { AfflictionType, CombatUnit, HeroSkill } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { warbandOrder } from '@/data/skills/eliteSkills';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { useCombatStore } from '@/stores/combatStore';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { inArena } from '@/systems/combat/arenaGeometry';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { callBackup } from '@/systems/combat/eliteWarnings';
import { warbandOf, warbandTargetFor } from '@/systems/combat/eliteKits';
import { hasEffect } from '@/systems/combat/statusEffects';
import { getHexesInRange, hexDistance } from '@/utils/hexUtils';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * The Orc Warchief's Warband Order: the Orcs of his warband converge on the hero he
 * names, a Grunt answers if none are left (never more than one), and the order dies
 * with a silenced or fallen Warchief.
 */

const swing = makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 6 });

const hero = (id: string, position = at(0, 2), hp = 4000) =>
  makeUnit({
    id, heroId: id, name: id, position,
    stats: makeStats({ maxHp: hp, attack: 30, defense: 0, speed: 5, critChance: 0, dodgeChance: 0 }),
    skills: [swing],
  });

const units = () => useCombatStore.getState().units;
const find = (id: string) => units().find((u) => u.id === id)!;
const chief = (): CombatUnit => units().find((u) => u.templateId === 'orc_warchief')!;
const grunts = () => units().filter((u) => u.templateId === 'orc_grunt' && u.currentHp > 0);

function start(heroes: CombatUnit[], allies: { template: string; position: ReturnType<typeof at> }[] = []) {
  const store = useCombatStore.getState();
  store.reset();
  const bodies = createEnemyUnits(
    ['orc_warchief', ...allies.map((a) => a.template)],
    [at(0, -4), ...allies.map((a) => a.position)],
    1,
    1,
  );
  store.initCombat(heroes, bodies);
}

function chiefTurn(only?: string) {
  const unit = chief();
  useCombatStore.getState().beginTurnFlags(unit.id);
  const view = only ? { ...unit, skills: unit.skills.filter((s) => s.id === only) } : unit;
  const actions = decideEnemyAction(view, units());
  executeAIActions(unit, actions);
  return actions;
}

const readyChief = () =>
  useCombatStore.setState((s) => ({
    units: s.units.map((u) => (u.templateId === 'orc_warchief' ? { ...u, cooldowns: {} } : u)),
  }));

describe('Warband Order', () => {
  it('replaces the Intimidating passive that his kit could never trigger', () => {
    const template = enemyTemplates.find((t) => t.id === 'orc_warchief')!;
    expect(template.passives ?? []).not.toContain('intimidating');
    expect(template.skills.map((s) => s.id)).toContain('warband_order');
  });

  it('names one hero, with a visible mark', () => {
    start([hero('a', at(0, 0)), hero('b', at(2, 0))], [{ template: 'orc_grunt', position: at(-2, -3) }]);
    chiefTurn('warband_order');
    const marked = units().filter((u) => hasEffect(u, AfflictionType.Warband));
    expect(marked).toHaveLength(1);
    expect(marked[0].activeEffects.find((e) => e.type === AfflictionType.Warband)?.sourceUnitId).toBe(chief().id);
  });

  it('sends the warband at the named hero on its next action, whoever else is nearer or weaker', () => {
    // 'weak' stands beside the Grunt and is far the easiest kill; 'named' is across the board
    start(
      [hero('weak', at(-2, -2), 50), hero('named', at(3, 2))],
      [{ template: 'orc_grunt', position: at(-2, -3) }],
    );
    const gruntId = grunts()[0].id;
    // Unordered, it attacks the weak one beside it
    const calm = decideEnemyAction(find(gruntId), units());
    expect(calm.find((a) => a.type === 'skill')?.skillTarget).toEqual(at(-2, -2));

    useCombatStore.getState().applyEffect('named', {
      type: AfflictionType.Warband, magnitude: 1, duration: 2, sourceUnitId: chief().id,
    });
    const ordered = decideEnemyAction(find(gruntId), units());
    expect(ordered.find((a) => a.type === 'skill')).toBeUndefined();
    const step = ordered.find((a) => a.type === 'move')!.targetPos!;
    expect(hexDistance(step, find('named').position)).toBeLessThan(hexDistance(find(gruntId).position, find('named').position));
  });

  it('is silenced with the Warchief: an interrupted horn goes unanswered', () => {
    start([hero('weak', at(-2, -2), 50), hero('named', at(3, 2))], [{ template: 'orc_grunt', position: at(-2, -3) }]);
    useCombatStore.getState().applyEffect('named', {
      type: AfflictionType.Warband, magnitude: 1, duration: 2, sourceUnitId: chief().id,
    });
    const gruntId = grunts()[0].id;
    expect(warbandTargetFor(find(gruntId), units())?.id).toBe('named');
    for (const type of [AfflictionType.Silence, AfflictionType.Stun, AfflictionType.Freeze]) {
      useCombatStore.getState().applyEffect(chief().id, { type, magnitude: 1, duration: 2, sourceUnitId: 'a' });
      expect(warbandTargetFor(find(gruntId), units())).toBeNull();
      useCombatStore.getState().removeAllAfflictions(chief().id);
    }
  });

  it('dies with the Warchief', () => {
    start([hero('a', at(0, 0)), hero('named', at(3, 2))], [{ template: 'orc_grunt', position: at(-2, -3) }]);
    useCombatStore.getState().applyEffect('named', {
      type: AfflictionType.Warband, magnitude: 1, duration: 2, sourceUnitId: chief().id,
    });
    useCombatStore.getState().damageUnit(chief().id, 99999, 'a');
    expect(warbandTargetFor(grunts()[0], units())).toBeNull();
  });

  it('is only answered by Orcs: a goblin ignores the horn', () => {
    start([hero('a', at(0, 0)), hero('named', at(3, 2))], [{ template: 'goblin', position: at(-2, -3) }]);
    useCombatStore.getState().applyEffect('named', {
      type: AfflictionType.Warband, magnitude: 1, duration: 2, sourceUnitId: chief().id,
    });
    const goblin = units().find((u) => u.templateId === 'goblin')!;
    expect(warbandTargetFor(goblin, units())).toBeNull();
    expect(warbandOf(chief(), units())).toHaveLength(0);
  });

  it('calls one Grunt when he is alone, so the order still has someone to act on it', () => {
    start([hero('a', at(0, 0)), hero('b', at(2, 0))]);
    expect(grunts()).toHaveLength(0);
    chiefTurn('warband_order');
    expect(grunts()).toHaveLength(1);
    expect(grunts()[0].summonedBy).toBe(chief().id);
    expect(hexDistance(grunts()[0].position, chief().position)).toBeLessThanOrEqual(3);
    expect(units().filter((u) => hasEffect(u, AfflictionType.Warband))).toHaveLength(1);
  });

  it('never calls a second while the first stands, however often he orders', () => {
    start([hero('a', at(0, 0)), hero('b', at(2, 0))]);
    for (let i = 0; i < 4; i++) {
      readyChief();
      useCombatStore.getState().removeAllAfflictions('a');
      useCombatStore.getState().removeAllAfflictions('b');
      chiefTurn('warband_order');
      expect(grunts().length).toBeLessThanOrEqual(1);
    }
    expect(grunts()).toHaveLength(1);
  });

  it('calls another once the first has fallen, and is a different order from the one before', () => {
    start([hero('a', at(0, 0))]);
    chiefTurn('warband_order');
    useCombatStore.getState().damageUnit(grunts()[0].id, 99999, 'a');
    expect(grunts()).toHaveLength(0);
    readyChief();
    useCombatStore.getState().removeAllAfflictions('a');
    chiefTurn('warband_order');
    expect(grunts()).toHaveLength(1);
  });

  it('has only so many Grunts to call over a whole fight, however many fall', () => {
    start([hero('a', at(0, 0))]);
    for (let i = 0; i < BALANCE.WARBAND_BACKUP_TOTAL + 2; i++) {
      readyChief();
      useCombatStore.getState().removeAllAfflictions('a');
      chiefTurn('warband_order');
      for (const g of grunts()) useCombatStore.getState().damageUnit(g.id, 99999, 'a');
    }
    const called = units().filter((u) => u.summonedBy === chief().id && u.templateId === 'orc_grunt');
    expect(called).toHaveLength(BALANCE.WARBAND_BACKUP_TOTAL);
  });

  it('falls back to an ordinary attack with no Grunt and no room to call one', () => {
    start([hero('a', at(0, -3))]);
    // Fill every hex the Grunt could appear on, with bodies that are not Orcs
    const c = chief();
    const blockers = getHexesInRange(c.position, 3)
      .filter((h) => inArena(h) && (h.q !== c.position.q || h.r !== c.position.r) && !(h.q === 0 && h.r === -3))
      .map((h, i) => makeUnit({ id: `rock${i}`, isPlayer: true, heroId: `rock${i}`, position: h, stats: makeStats({ maxHp: 4000 }) }));
    useCombatStore.getState().addUnits(blockers);
    const actions = chiefTurn();
    expect(actions.some((a) => a.skill?.id === 'warband_order')).toBe(false);
    callBackup(chief(), { log: () => {} });
    expect(grunts()).toHaveLength(0);
  });

  it('rests for longer than the order stands', () => {
    expect(warbandOrder.cooldown!).toBeGreaterThan(BALANCE.WARBAND_TURNS);
  });
});
