import { AfflictionType, AuraType, CombatUnit, HeroSkill } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { useCombatStore } from '@/stores/combatStore';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { rageStacks, feastReady } from '@/systems/combat/eliteKits';
import { resolveDuePrepared } from '@/systems/combat/preparedResolve';
import { statusInterrupts } from '@/systems/combat/preparedAttacks';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { hasEffect } from '@/systems/combat/statusEffects';
import { beginTurn } from '@/systems/combat/turnStart';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * The Orc Berserker's Pain Feast: every separate blow it takes is a stack of Rage, the
 * stacks outlast the round, and a full Rage turns its next Slash into one wide,
 * bleeding, announced swing — never an invisible one.
 */

const hero = (id = 'h1', position = at(0, -2)) =>
  makeUnit({
    id, heroId: id, name: id, position,
    stats: makeStats({ maxHp: 4000, attack: 30, defense: 0, speed: 5, critChance: 0, dodgeChance: 0 }),
    skills: [makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 6 })],
  });

const units = () => useCombatStore.getState().units;
const orc = (): CombatUnit => units().find((u) => u.templateId === 'orc_berserker')!;
const find = (id: string) => units().find((u) => u.id === id)!;

function start(heroes: CombatUnit[] = [hero()]) {
  const store = useCombatStore.getState();
  store.reset();
  const [o] = createEnemyUnits(['orc_berserker'], [at(0, -3)], 1, 1);
  store.initCombat(heroes, [o]);
}

const hit = (n = 1) => {
  for (let i = 0; i < n; i++) useCombatStore.getState().damageUnit(orc().id, 1, 'h1');
};

/** One Berserker turn through the real AI. */
function orcTurn() {
  const unit = orc();
  useCombatStore.getState().beginTurnFlags(unit.id);
  const actions = decideEnemyAction(unit, units());
  executeAIActions(unit, actions);
  return actions;
}

describe('Pain Feast', () => {
  it('builds one Rage for each separate blow, and nothing for a tick', () => {
    start();
    hit(3);
    expect(rageStacks(orc())).toBe(3);
    useCombatStore.getState().applyEffect(orc().id, {
      type: AfflictionType.Bleed, magnitude: 2, duration: 3, sourceUnitId: 'h1',
    });
    useCombatStore.getState().tickEffectsOnUnit(orc().id);
    expect(rageStacks(orc())).toBe(3);
  });

  it('counts every strike of a multi-hit skill, so the same shot is worth the same stacks every time', () => {
    start();
    useCombatStore.getState().applyEffect('h1', { type: AuraType.RapidFire, magnitude: 1, duration: 2 });
    const swing = find('h1').skills[0];
    resolveSkillUse(find('h1'), swing, orc().position, SILENT_SINK);
    const first = rageStacks(orc());
    expect(first).toBe(Math.min(BALANCE.PAIN_FEAST_THRESHOLD, BALANCE.RAPID_FIRE_STRIKES));

    start();
    useCombatStore.getState().applyEffect('h1', { type: AuraType.RapidFire, magnitude: 1, duration: 2 });
    resolveSkillUse(find('h1'), find('h1').skills[0], orc().position, SILENT_SINK);
    expect(rageStacks(orc())).toBe(first);
  });

  it('keeps its stacks across rounds and stops at the threshold', () => {
    start();
    hit(2);
    beginTurn(orc().id, SILENT_SINK);
    useCombatStore.getState().nextTurn();
    expect(rageStacks(orc())).toBe(2);
    hit(BALANCE.PAIN_FEAST_THRESHOLD + 3);
    expect(rageStacks(orc())).toBe(BALANCE.PAIN_FEAST_THRESHOLD);
    expect(feastReady(orc())).toBe(true);
  });

  it('is announced: a full Rage raises a warned Feast Slash rather than an instant swing', () => {
    start([hero('h1', at(0, -2))]);
    hit(BALANCE.PAIN_FEAST_THRESHOLD);
    const before = find('h1').currentHp;
    orcTurn();
    const warnings = useCombatStore.getState().preparedAttacks;
    expect(warnings).toHaveLength(1);
    expect(warnings[0].skill.id).toBe('pain_feast_slash');
    // Nothing landed yet, and the Rage is spent the moment it is announced
    expect(find('h1').currentHp).toBe(before);
    expect(rageStacks(orc())).toBe(0);
    expect(feastReady(orc())).toBe(false);
  });

  it('lands wide, harder than a Slash, and leaves its targets bleeding', () => {
    start([hero('h1', at(0, -2)), hero('h2', at(1, -2))]);
    hit(BALANCE.PAIN_FEAST_THRESHOLD);
    orcTurn();
    const store = useCombatStore.getState();
    for (const p of store.preparedAttacks) store.updatePreparedAttack(p.id, { responded: p.responders });
    const before = find('h1').currentHp;
    resolveDuePrepared(orc().id, SILENT_SINK);
    expect(useCombatStore.getState().preparedAttacks).toHaveLength(0);
    const struck = [find('h1'), find('h2')].filter((u) => u.currentHp < u.stats.maxHp);
    expect(struck.length).toBeGreaterThan(1);
    expect(hasEffect(struck[0], AfflictionType.Bleed)).toBe(true);
    expect(before - find('h1').currentHp).toBeGreaterThan(0);
  });

  it('is an ordinary Slash again once the Rage is spent, and never fires early', () => {
    start([hero('h1', at(0, -2))]);
    hit(BALANCE.PAIN_FEAST_THRESHOLD - 1);
    const actions = orcTurn();
    expect(actions.some((a) => a.skill?.id === 'pain_feast_slash')).toBe(false);
    expect(useCombatStore.getState().preparedAttacks).toHaveLength(0);
  });

  it('can be answered: Stun, Silence or Freeze on the Berserker breaks the announced swing', () => {
    start([hero('h1', at(0, -2))]);
    hit(BALANCE.PAIN_FEAST_THRESHOLD);
    orcTurn();
    const warning = useCombatStore.getState().preparedAttacks[0];
    expect(statusInterrupts(warning, AfflictionType.Stun)).toBe(true);
    expect(statusInterrupts(warning, AfflictionType.Silence)).toBe(true);
    expect(statusInterrupts(warning, AfflictionType.Freeze)).toBe(true);
  });

  it('feeds nobody else: a unit without the passive takes hits and gains no Rage', () => {
    const store = useCombatStore.getState();
    store.reset();
    const [grunt] = createEnemyUnits(['orc_grunt'], [at(0, -3)], 1, 1);
    store.initCombat([hero()], [grunt]);
    store.damageUnit(grunt.id, 1, 'h1');
    expect(rageStacks(units().find((u) => u.id === grunt.id)!)).toBe(0);
  });
});
