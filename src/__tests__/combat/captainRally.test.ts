import { CombatUnit, HeroSkill } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { decideEnemyAction, executeAIActions, isLonelyFormationBuff } from '@/systems/combat/enemyAI';
import { hexDistance } from '@/utils/hexUtils';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * PT-08: the Brigand Captain opened fights Rallying himself. His warband walks at the
 * party on its first turns and away from him, so on his turn nobody is inside Rally's
 * radius; the cast covered only himself while the fight was elsewhere. Rally is now his
 * last resort when it would cover nobody else: he walks toward the fight (through his
 * warband) and Rallies on the turn it catches them.
 */

const swing = makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 1 });

const hero = (id: string, position = at(0, 4)) =>
  makeUnit({
    id, heroId: id, name: id, position,
    stats: makeStats({ maxHp: 4000, attack: 30, defense: 6, speed: 8, critChance: 0, dodgeChance: 0 }),
    skills: [swing],
  });

const units = () => useCombatStore.getState().units;
const captain = (): CombatUnit => units().find((u) => u.templateId === 'brigand_captain')!;
const bandits = () => units().filter((u) => u.templateId === 'bandit');

function start(positions: ReturnType<typeof at>[], heroAt = at(0, 4)) {
  const store = useCombatStore.getState();
  store.reset();
  const bodies = createEnemyUnits(['brigand_captain', 'bandit', 'bandit'], positions, 1, 1);
  store.initCombat([hero('h1', heroAt)], bodies);
}

function captainTurn() {
  const unit = captain();
  useCombatStore.getState().beginTurnFlags(unit.id);
  const actions = decideEnemyAction(unit, units());
  executeAIActions(unit, actions);
  return actions;
}

describe('Brigand Captain Rally (PT-08)', () => {
  it('walks toward the fight instead of Rallying himself when his warband has run ahead', () => {
    // The warband has advanced on the hero; the Captain is left on the back rank,
    // four and more hexes behind it, with no hero in reach of a swing
    start([at(0, -5), at(0, 0), at(1, 0)]);
    const rally = captain().skills.find((s) => s.id === 'rally')!;
    expect(isLonelyFormationBuff(captain(), rally, units())).toBe(true);

    const before = captain().position;
    const first = captainTurn();
    expect(first.some((a) => a.type === 'skill')).toBe(false);
    expect(first[0].type).toBe('move');
    // Closer to his warband than he was
    const near = (p: ReturnType<typeof at>) => Math.min(...bandits().map((b) => hexDistance(p, b.position)));
    expect(near(captain().position)).toBeLessThan(near(before));
    // Now the warband is within Rally's radius, and Rally is the turn
    expect(near(captain().position)).toBeLessThanOrEqual(rally.aoeRadius!);
    const second = decideEnemyAction(captain(), units());
    expect(second[0]).toMatchObject({ type: 'skill' });
    expect(second[0].type === 'skill' && second[0].skill?.id).toBe('rally');
  });

  it('Rallies at once when the cast already covers an ally', () => {
    start([at(0, -3), at(0, -2), at(1, -3)]);
    const actions = decideEnemyAction(captain(), units());
    expect(actions[0].type === 'skill' && actions[0].skill?.id).toBe('rally');
  });

  it('still Rallies himself when he has nowhere to go and nothing else to do', () => {
    start([at(0, -5), at(0, 0), at(1, 0)]);
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.templateId === 'brigand_captain'
        ? { ...u, stats: { ...u.stats, moveRange: 0 } }
        : u)),
    }));
    const actions = decideEnemyAction(captain(), units());
    expect(actions[0].type === 'skill' && actions[0].skill?.id).toBe('rally');
  });

  it('strikes an adjacent hero rather than Rallying only himself', () => {
    start([at(0, 3), at(-3, -3), at(-4, -2)], at(0, 4));
    const actions = decideEnemyAction(captain(), units());
    expect(actions[0].type).toBe('skill');
    expect(actions[0].type === 'skill' && actions[0].skill?.id).not.toBe('rally');
  });
});
