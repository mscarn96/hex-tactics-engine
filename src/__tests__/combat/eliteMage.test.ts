import { AfflictionType, CombatPhase, CombatUnit, HeroSkill } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { mindControl } from '@/data/skills/eliteSkills';
import { useCombatStore } from '@/stores/combatStore';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { statusInterrupts } from '@/systems/combat/preparedAttacks';
import { resolveDuePrepared } from '@/systems/combat/preparedResolve';
import { combatOutcome } from '@/systems/combat/combatOutcome';
import { hasEffect } from '@/systems/combat/statusEffects';
import { beginTurn } from '@/systems/combat/turnStart';
import { SILENT_SINK } from '@/systems/combat/skillResolution';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * The Dark Mage's Mind Control: a marked hero acts for the Mage for two of their own
 * turns with their own skills, then returns. It cannot take the last hero, it ends
 * when the Mage falls or a cleanse lands, and it never corrupts who the hero is.
 */

const swing = makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 6 });

const hero = (id: string, position = at(0, 2), attack = 30, speed = 10) =>
  makeUnit({
    id, heroId: id, name: id, position,
    stats: makeStats({ maxHp: 4000, attack, defense: 0, speed, critChance: 0, dodgeChance: 0 }),
    skills: [swing],
  });

const units = () => useCombatStore.getState().units;
const find = (id: string) => units().find((u) => u.id === id)!;
const mage = (): CombatUnit => units().find((u) => u.templateId === 'dark_mage')!;

function start(heroes: CombatUnit[] = [hero('h1', at(0, 2), 60), hero('h2', at(2, 2), 20)]) {
  const store = useCombatStore.getState();
  store.reset();
  const [m] = createEnemyUnits(['dark_mage'], [at(0, -2)], 1, 1);
  store.initCombat(heroes, [m]);
}

/** The Mage's turn through the real AI. */
function mageTurn() {
  const unit = mage();
  useCombatStore.getState().beginTurnFlags(unit.id);
  const actions = decideEnemyAction(unit, units());
  executeAIActions(unit, actions);
  return actions;
}

/** Everyone in the footprint has had their turn: it lands. */
function land() {
  const store = useCombatStore.getState();
  for (const p of store.preparedAttacks) store.updatePreparedAttack(p.id, { responded: p.responders });
  resolveDuePrepared(mage().id, SILENT_SINK);
}

/** Hands the turn over to `id` the way the order does: from whoever stands before them. */
function turnOf(id: string): CombatUnit {
  const order = useCombatStore.getState().turnOrder;
  useCombatStore.setState({ currentUnitId: order[(order.indexOf(id) - 1 + order.length) % order.length] });
  useCombatStore.getState().nextTurn();
  return useCombatStore.getState().getCurrentUnit()!;
}

/** Ends the turn in progress. */
function endTurn(): void {
  useCombatStore.getState().nextTurn();
}

describe('Mind Control', () => {
  it('rests for longer than it holds, so the Mage cannot chain it', () => {
    expect(mindControl.cooldown!).toBeGreaterThan(BALANCE.MIND_CONTROL_TURNS + 1);
  });

  it('marks the hardest-hitting hero as a warning the hero can answer, and strikes nobody yet', () => {
    start();
    mageTurn();
    const warnings = useCombatStore.getState().preparedAttacks;
    expect(warnings).toHaveLength(1);
    expect(warnings[0].skill.id).toBe('mind_control');
    expect(warnings[0].responders).toEqual(['h1']);
    expect(hasEffect(find('h1'), AfflictionType.MindControl)).toBe(false);
  });

  it('can be interrupted: Stun, Silence or Freeze on the Mage breaks the spell', () => {
    start();
    mageTurn();
    const warning = useCombatStore.getState().preparedAttacks[0];
    for (const type of [AfflictionType.Stun, AfflictionType.Silence, AfflictionType.Freeze]) {
      expect(statusInterrupts(warning, type)).toBe(true);
    }
  });

  it('takes nobody who has stepped off the mark', () => {
    start();
    mageTurn();
    useCombatStore.getState().moveUnit('h1', at(-2, 3));
    land();
    expect(hasEffect(find('h1'), AfflictionType.MindControl)).toBe(false);
  });

  it('lands on a hero who stays, and turns them for the Mage for exactly two of their turns', () => {
    start();
    mageTurn();
    land();
    expect(hasEffect(find('h1'), AfflictionType.MindControl)).toBe(true);

    // Their next turn is the Mage's — on the other side, with the same identity
    const current = turnOf('h1');
    expect(current.id).toBe('h1');
    expect(current.isPlayer).toBe(false);
    expect(current.seized).toBe(true);
    expect(current.heroId).toBe('h1');
    expect(useCombatStore.getState().phase).toBe(CombatPhase.EnemyTurn);
    beginTurn('h1', SILENT_SINK);

    // The turn ends and they come home
    endTurn();
    expect(find('h1').isPlayer).toBe(true);
    expect(find('h1').seized).toBe(false);

    // A second turn is still the Mage's
    turnOf('h1');
    expect(find('h1').isPlayer).toBe(false);
    beginTurn('h1', SILENT_SINK);
    endTurn();
    expect(find('h1').isPlayer).toBe(true);
    expect(hasEffect(find('h1'), AfflictionType.MindControl)).toBe(false);

    // And the third is theirs again
    turnOf('h1');
    expect(find('h1').isPlayer).toBe(true);
    expect(useCombatStore.getState().phase).toBe(CombatPhase.PlayerSelect);
  });

  it('has the held hero use their own skills against their own party', () => {
    start();
    mageTurn();
    land();
    turnOf('h1');
    const held = find('h1');
    const actions = decideEnemyAction(held, units());
    const strike = actions.find((a) => a.type === 'skill');
    expect(strike?.skill?.id).toBe('swing');
    expect(strike?.skillTarget).toEqual(find('h2').position);
    const before = find('h2').currentHp;
    executeAIActions(held, actions);
    expect(find('h2').currentHp).toBeLessThan(before);
  });

  it('is lifted by a cleanse before the hero turn', () => {
    start();
    mageTurn();
    land();
    useCombatStore.getState().removeAllAfflictions('h1');
    turnOf('h1');
    expect(find('h1').isPlayer).toBe(true);
    expect(useCombatStore.getState().phase).toBe(CombatPhase.PlayerSelect);
  });

  it('is lifted by the Mage falling', () => {
    start();
    mageTurn();
    land();
    useCombatStore.getState().damageUnit(mage().id, 99999, 'h2');
    turnOf('h1');
    expect(find('h1').isPlayer).toBe(true);
    expect(hasEffect(find('h1'), AfflictionType.MindControl)).toBe(false);
  });

  it('never takes the last hero: the Mage does not cast it, and a landing is refused', () => {
    start([hero('h1', at(0, 2), 60)]);
    const actions = mageTurn();
    expect(useCombatStore.getState().preparedAttacks).toHaveLength(0);
    expect(actions.some((a) => a.skill?.id === 'mind_control')).toBe(false);
    useCombatStore.getState().applyEffect('h1', {
      type: AfflictionType.MindControl, magnitude: 1, duration: 2, sourceUnitId: mage().id,
    });
    expect(hasEffect(find('h1'), AfflictionType.MindControl)).toBe(false);
  });

  it('frees a held hero whose last ally has fallen, rather than turning them on nobody', () => {
    start();
    mageTurn();
    land();
    useCombatStore.getState().damageUnit('h2', 99999, mage().id);
    turnOf('h1');
    expect(find('h1').isPlayer).toBe(true);
    expect(hasEffect(find('h1'), AfflictionType.MindControl)).toBe(false);
  });

  it('sends the hero home when the fight ends mid-turn, so nothing downstream reads them as an enemy', () => {
    start();
    mageTurn();
    land();
    turnOf('h1');
    expect(find('h1').seized).toBe(true);
    useCombatStore.getState().setPhase(CombatPhase.Victory);
    expect(find('h1').isPlayer).toBe(true);
    expect(find('h1').seized).toBe(false);
    expect(combatOutcome(units())).toBe('ongoing');
  });
});
