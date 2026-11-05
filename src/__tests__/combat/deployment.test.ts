import { arenaHexes } from '@/systems/combat/arenaGeometry';
import { generatePlayerPositions, generateEnemyPositions } from '@/systems/combat/unitFactory';
import { createDeployment, deploymentTargets, placeDeployment } from '@/systems/combat/deployment';
import { useCombatStore } from '@/stores/combatStore';
import { makeUnit } from '../support/fixtures';
import { hexKey } from '@/utils/hexUtils';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import { usePartyStore } from '@/stores/partyStore';
import { useCityStore } from '@/stores/cityStore';
import { BuildingType } from '@/models/types';

const players = () => generatePlayerPositions(3).map((position, i) => makeUnit({ id: `p${i}`, isPlayer: true, position }));
const enemies = () => generateEnemyPositions(2).map((position, i) => makeUnit({ id: `e${i}`, isPlayer: false, position }));
const setup = (level: number) => {
  const p = players(), e = enemies();
  return { plan: createDeployment(level, p, e, arenaHexes()), units: [...p, ...e] };
};

describe('standing Barracks deployment privileges', () => {
  it('keeps level zero default and permits only swaps at level one', () => {
    const zero = setup(0);
    expect(placeDeployment(zero.plan, zero.units, 'p0', zero.units[1].position)).toBeNull();
    const { plan, units } = setup(1);
    const swapped = placeDeployment(plan, units, 'p0', units[1].position)!;
    expect(swapped[0].position).toEqual(units[1].position);
    expect(swapped[1].position).toEqual(units[0].position);
    const starts = new Set(Object.values(plan.starts).map(hexKey));
    const free = plan.area.find(h => !starts.has(hexKey(h)))!;
    expect(placeDeployment(plan, units, 'p0', free)).toBeNull();
    expect(placeDeployment(plan, units.map(u => u.id === 'p1' ? { ...u, currentHp:0 } : u), 'p0', units[1].position)).toBeNull();
    expect(deploymentTargets(plan, units, 'p0').every(h => starts.has(hexKey(h)))).toBe(true);
  });
  it('allows only one hero off the starting hexes at level two, freely at level three', () => {
    for (const level of [2, 3]) {
      const { plan, units } = setup(level);
      const starts = new Set(Object.values(plan.starts).map(hexKey));
      const free = plan.area.filter(h => !starts.has(hexKey(h)));
      expect(free.length).toBeGreaterThan(1);
      const moved = placeDeployment(plan, units, 'p0', free[0])!;
      expect(moved).not.toBeNull();
      const second = placeDeployment(plan, moved, 'p1', free[1]);
      if (level === 2) expect(second).toBeNull(); else expect(second).not.toBeNull();
      expect(placeDeployment(plan, moved, 'p1', units[2].position)).not.toBeNull();
    }
  });
  it('a fallen hero does not consume the level-two reposition privilege', () => {
    const p = players(); p[1].currentHp = 0;
    const e = enemies(), units = [...p, ...e];
    const plan = createDeployment(2, p, e, arenaHexes());
    const starts = new Set(Object.values(plan.starts).map(hexKey));
    const free = plan.area.find(h => !starts.has(hexKey(h)))!;
    expect(placeDeployment(plan, units, 'p0', free)).not.toBeNull();
    expect(placeDeployment(plan, units, 'p1', free)).toBeNull();
  });
  it('refuses missing, enemy, blocked, disconnected and out-of-bounds positions', () => {
    const { plan, units } = setup(3);
    expect(placeDeployment(plan, units, 'e0', plan.area[0])).toBeNull();
    expect(placeDeployment(plan, units, 'missing', plan.area[0])).toBeNull();
    expect(placeDeployment(plan, units, 'p0', units[3].position)).toBeNull();
    expect(placeDeployment(plan, units, 'p0', { q: 99, r: 99 })).toBeNull();
    const starts = new Set(players().map(u => hexKey(u.position)));
    const blocked = plan.area.find(h => !starts.has(hexKey(h)))!;
    const constrained = createDeployment(3, players(), enemies(), arenaHexes().filter(h => hexKey(h) !== hexKey(blocked)));
    expect(placeDeployment(constrained, units, 'p0', blocked)).toBeNull();
    expect(constrained.area.every(h => arenaHexes().some(a => hexKey(a) === hexKey(h)))).toBe(true);
    expect(createDeployment(3, players(), enemies(), [{ q: 99, r: 99 }]).area).toEqual([]);
  });
  it('waits for confirmation without spending a turn', () => {
    const store = useCombatStore;
    store.getState().initCombat(players(), enemies(), 3);
    const order = store.getState().turnOrder, current = store.getState().currentUnitId;
    store.getState().selectDeploymentHero('p0');
    const target = store.getState().highlightedHexes[0];
    expect(store.getState().placeDeploymentHero(target)).toBe(true);
    store.getState().nextTurn();
    expect(store.getState().currentUnitId).toBe(current);
    store.getState().resetDeployment();
    expect(store.getState().units.slice(0,3).map(u => u.position)).toEqual(players().map(u => u.position));
    store.getState().confirmDeployment();
    expect(store.getState().deployment).toBeNull();
    expect(store.getState().highlightedHexes).toEqual([]);
    expect(store.getState().turnOrder).toEqual(order);
    expect(store.getState().currentUnitId).toBe(current);
    expect(store.getState().units.every(u => !u.hasMoved && !u.hasActed)).toBe(true);
    store.getState().initCombat(players(), enemies(), 0);
    expect(store.getState().deployment).toBeNull();
  });
  it('Barracks upgrades add no hero stat bonus', () => {
    useCityStore.getState().reset(); usePartyStore.getState().reset();
    usePartyStore.getState().addHero('warrior');
    const hero = usePartyStore.getState().heroes[0];
    const before = getEffectiveStats(hero, []);
    useCityStore.setState(s => ({ buildings: s.buildings.map(b => b.type === BuildingType.Barracks ? { ...b, level: 3 } : b) }));
    expect(getEffectiveStats(hero, [])).toEqual(before);
  });
});
