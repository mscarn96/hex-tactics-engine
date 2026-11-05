import { AfflictionType, AuraType, CombatUnit, HeroSkill } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { hasEffect, isHiddenFrom } from '@/systems/combat/statusEffects';
import { beginTurn } from '@/systems/combat/turnStart';
import { scriptsAfterCast } from '@/systems/combat/scriptRegistry';
import { hexesBehind } from '@/systems/combat/facing';
import { nueBlackThunder } from '@/data/skills/yokaiSkills';
import { getNeighbors, hexKey } from '@/utils/hexUtils';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * The Nue, the Yokai's roaming elite (`systems/combat/yokaiKits`), pinned as rules:
 *
 * - at its turn start its thundercloud Shocks every hero beside it, and nobody further;
 * - at its turn start its snake tail strikes the hero directly behind it, and only that hex;
 * - Black Thunder closes the cloud over it: Stealth, out of reach of a single target.
 */

const swing = makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 8 });

const hero = (id: string, position = at(0, 2)) =>
  makeUnit({
    id, heroId: id, name: id, position,
    stats: makeStats({ maxHp: 4000, attack: 30, defense: 0, speed: 5, critChance: 0, dodgeChance: 0 }),
    skills: [swing],
  });

const units = () => useCombatStore.getState().units;
const find = (id: string) => units().find((u) => u.id === id)!;
const nue = () => units().find((u) => u.templateId === 'nue')!;

/** The Nue at the middle, facing (0,1), with heroes where the test puts them. */
function start(place: (front: CombatUnit) => CombatUnit[]) {
  const store = useCombatStore.getState();
  store.reset();
  const [unit] = createEnemyUnits(['nue'], [at(0, 0)], 1, 1);
  store.initCombat(place(unit), [unit]);
  useCombatStore.getState().setFacing(nue().id, at(0, 1));
}

describe('Thundercloud', () => {
  it('Shocks every hero beside it at its turn start, and nobody further away', () => {
    start(() => [hero('near', at(1, 0)), hero('far', at(3, 0))]);
    beginTurn(nue().id, SILENT_SINK);
    expect(hasEffect(find('near'), AfflictionType.Shock)).toBe(true);
    expect(hasEffect(find('far'), AfflictionType.Shock)).toBe(false);
  });
});

describe('Serpent Tail', () => {
  it('strikes the hero standing directly behind it, and not one in front', () => {
    start(() => [hero('front', at(0, 1)), hero('behind', at(0, -1))]);
    const back = hexesBehind(nue())[0];
    expect(hexKey(back)).toBe(hexKey(at(0, -1)));
    beginTurn(nue().id, SILENT_SINK);
    expect(find('behind').currentHp).toBeLessThan(4000);
    expect(hasEffect(find('behind'), AfflictionType.Poison)).toBe(true);
    expect(find('front').currentHp).toBe(4000);
  });

  it('leaves its two rear-side hexes alone: only the hex straight back is struck', () => {
    start(() => {
      const sides = getNeighbors(at(0, 0)).filter(
        (h) => hexKey(h) !== hexKey(at(0, 1)) && hexKey(h) !== hexKey(at(0, -1)),
      );
      return [hero('side', sides[0])];
    });
    beginTurn(nue().id, SILENT_SINK);
    expect(find('side').currentHp).toBe(4000);
  });
});

describe('Black Thunder', () => {
  it('strikes everyone beside it, then hides it in its cloud from single-target blows', () => {
    start(() => [hero('a', at(1, 0)), hero('b', at(-1, 0))]);
    resolveSkillUse(nue(), nueBlackThunder, nue().position, SILENT_SINK);
    scriptsAfterCast(nue(), nueBlackThunder, 'strike', SILENT_SINK);
    expect(find('a').currentHp).toBeLessThan(4000);
    expect(find('b').currentHp).toBeLessThan(4000);
    expect(hasEffect(nue(), AuraType.Stealth)).toBe(true);
    expect(isHiddenFrom(nue(), swing)).toBe(true);
  });
});
