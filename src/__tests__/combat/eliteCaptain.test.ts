import { AuraType, CombatUnit, HeroSkill } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { useCombatStore } from '@/stores/combatStore';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { decideEnemyAction } from '@/systems/combat/enemyAI';
import { combatMaxHp } from '@/systems/combat/forms';
import { enemyFormation, wearsAuthority } from '@/systems/combat/eliteKits';
import { speedEdge } from '@/systems/combat/turnTempo';
import { hasEffect } from '@/systems/combat/statusEffects';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * The Brigand Captain's Authority: half again as much of every stat for every other
 * ally while he lives — worn by latecomers, gone the instant he falls, never stacked,
 * never on himself — and a formation that puts a screen in front of him.
 */

const swing = makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 6 });

const hero = (id: string, position = at(0, 2)) =>
  makeUnit({
    id, heroId: id, name: id, position,
    stats: makeStats({ maxHp: 4000, attack: 30, defense: 6, speed: 8, critChance: 0, dodgeChance: 0 }),
    skills: [swing],
  });

const units = () => useCombatStore.getState().units;
const find = (id: string) => units().find((u) => u.id === id)!;
const captain = (): CombatUnit => units().find((u) => u.templateId === 'brigand_captain')!;
const bandits = () => units().filter((u) => u.templateId === 'bandit');

function start(templates: string[], positions = [at(0, -4), at(0, -3), at(1, -3)]) {
  const store = useCombatStore.getState();
  store.reset();
  const bodies = createEnemyUnits(templates, positions, 1, 1);
  store.initCombat([hero('h1')], bodies);
}

describe('Captain\'s Authority', () => {
  it('raises every stat of every other ally by half, and the Captain not at all', () => {
    start(['brigand_captain', 'bandit', 'bandit']);
    const base = createEnemyUnits(['bandit'], [at(0, 0)], 1, 1)[0].stats;
    for (const b of bandits()) {
      expect(hasEffect(b, AuraType.Authority)).toBe(true);
      const s = getCombatEffectiveStats(b);
      expect(s.attack).toBe(Math.round(base.attack * 1.5));
      expect(s.defense).toBe(Math.round(base.defense * 1.5));
      expect(s.magic).toBe(Math.round(base.magic * 1.5));
      expect(s.speed).toBe(Math.round(base.speed * 1.5));
      expect(s.moveRange).toBe(Math.round(base.moveRange * 1.5));
      expect(combatMaxHp(b)).toBe(Math.round(base.maxHp * 1.5));
      expect(s.maxHp).toBe(combatMaxHp(b));
    }
    expect(hasEffect(captain(), AuraType.Authority)).toBe(false);
    expect(combatMaxHp(captain())).toBe(captain().stats.maxHp);
  });

  it('is never worn by the other side, an objective, or a lone Captain', () => {
    start(['brigand_captain', 'bandit']);
    expect(hasEffect(find('h1'), AuraType.Authority)).toBe(false);
    start(['brigand_captain']);
    expect(hasEffect(captain(), AuraType.Authority)).toBe(false);
  });

  it('is worn by units that arrive later, a summoned Grunt or a wave', () => {
    start(['brigand_captain', 'bandit']);
    const [late] = createEnemyUnits(['footpad'], [at(2, -3)], 1, 1);
    useCombatStore.getState().addUnits([late]);
    expect(hasEffect(find(late.id), AuraType.Authority)).toBe(true);
    expect(combatMaxHp(find(late.id))).toBeGreaterThan(late.stats.maxHp);
  });

  it('keeps each ally\'s share of health as the maximum moves, both ways', () => {
    start(['brigand_captain', 'bandit']);
    const b = bandits()[0];
    // Half health under the aura
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === b.id ? { ...u, currentHp: Math.round(combatMaxHp(u) / 2) } : u)),
    }));
    const half = find(b.id).currentHp / combatMaxHp(find(b.id));
    useCombatStore.getState().damageUnit(captain().id, 99999, 'h1');
    const after = find(b.id);
    expect(hasEffect(after, AuraType.Authority)).toBe(false);
    expect(after.currentHp / combatMaxHp(after)).toBeCloseTo(half, 1);
    expect(after.currentHp).toBeGreaterThanOrEqual(1);
  });

  it('is gone the moment he dies, from every ally, with every stat back', () => {
    start(['brigand_captain', 'bandit', 'bandit']);
    useCombatStore.getState().damageUnit(captain().id, 99999, 'h1');
    for (const b of bandits()) {
      expect(hasEffect(b, AuraType.Authority)).toBe(false);
      expect(getCombatEffectiveStats(b).attack).toBe(b.stats.attack);
      expect(combatMaxHp(b)).toBe(b.stats.maxHp);
    }
  });

  it('is gone when he dies to a tick as well as to a blow', () => {
    start(['brigand_captain', 'bandit']);
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.templateId === 'brigand_captain' ? { ...u, currentHp: 1 } : u)),
    }));
    useCombatStore.getState().applyEffect(captain().id, {
      type: 'bleed' as never, magnitude: 5, duration: 3, sourceUnitId: 'h1',
    });
    useCombatStore.getState().tickEffectsOnUnit(captain().id);
    expect(captain().currentHp).toBe(0);
    expect(hasEffect(bandits()[0], AuraType.Authority)).toBe(false);
  });

  it('does not stack with a second Captain, and each is buffed once by the other', () => {
    start(['brigand_captain', 'brigand_captain', 'bandit'], [at(0, -4), at(1, -4), at(0, -3)]);
    const [one, two] = units().filter((u) => u.templateId === 'brigand_captain');
    const base = createEnemyUnits(['bandit'], [at(0, 0)], 1, 1)[0].stats;
    expect(getCombatEffectiveStats(bandits()[0]).attack).toBe(Math.round(base.attack * 1.5));
    expect(hasEffect(one, AuraType.Authority)).toBe(true);
    expect(hasEffect(two, AuraType.Authority)).toBe(true);
    expect(units().filter((u) => u.id === one.id)[0].activeEffects.filter((e) => e.type === AuraType.Authority)).toHaveLength(1);
    // One falls: the bandit keeps the aura of the other, and the survivor loses the one the fallen gave
    useCombatStore.getState().damageUnit(one.id, 99999, 'h1');
    expect(hasEffect(bandits()[0], AuraType.Authority)).toBe(true);
    expect(hasEffect(find(two.id), AuraType.Authority)).toBe(false);
  });

  it('combines with Rally the way the numbers say: the buff first, then the word', () => {
    start(['brigand_captain', 'bandit']);
    const b = bandits()[0];
    useCombatStore.getState().applyEffect(b.id, { type: AuraType.AttackBuff, magnitude: 5, duration: 3 });
    expect(getCombatEffectiveStats(find(b.id)).attack).toBe(Math.round((b.stats.attack + 5) * 1.5));
  });

  it('lifts the speed an ally is read at by the bonus-turn dice, so a warband under him is quicker', () => {
    start(['brigand_captain', 'bandit']);
    const buffed = speedEdge(bandits()[0], units());
    useCombatStore.getState().damageUnit(captain().id, 99999, 'h1');
    expect(buffed).toBeGreaterThan(speedEdge(bandits()[0], units()));
  });

  it('wearsAuthority answers for every shape of roster', () => {
    start(['brigand_captain', 'bandit']);
    expect(wearsAuthority(bandits()[0], units())).toBe(true);
    expect(wearsAuthority(captain(), units())).toBe(false);
    expect(wearsAuthority(find('h1'), units())).toBe(false);
  });
});

describe('the Captain\'s formation', () => {
  it('stands him on the back rank with the rest of the warband in front of him', () => {
    const ids = ['brigand_captain', 'bandit', 'brigand_archer'];
    const spots = enemyFormation(ids)!;
    expect(spots).toHaveLength(3);
    expect(spots[0].r).toBe(-4);
    expect(spots[1].r).toBe(-3);
    expect(spots[2].r).toBe(-3);
    // Both hexes in front of him are held
    const held = new Set(spots.slice(1).map(hexKey));
    expect(held.has(hexKey({ q: spots[0].q - 1, r: -3 })) && held.has(hexKey({ q: spots[0].q, r: -3 }))).toBe(true);
    expect(new Set(spots.map(hexKey)).size).toBe(3);
  });

  it('screens him in a two-body warband too, and leaves every other roster alone', () => {
    const duo = enemyFormation(['brigand_captain', 'bandit'])!;
    expect(duo[0].r).toBe(-4);
    expect(hexDistance(duo[0], duo[1])).toBe(1);
    expect(enemyFormation(['bandit', 'footpad'])).toBeNull();
    expect(enemyFormation(['brigand_captain'])).toBeNull();
  });

  it('lays out four without two on one hex, every one on the board', () => {
    const spots = enemyFormation(['brigand_captain', 'bandit', 'brigand_archer', 'footpad'])!;
    expect(new Set(spots.map(hexKey)).size).toBe(4);
  });

  it('moves and fights while his warband still stands: the aura is his passive, not a leash', () => {
    start(['brigand_captain', 'bandit'], [at(1, -4), at(0, -3)]);
    expect(bandits()).toHaveLength(1);
    const turn = decideEnemyAction(captain(), units());
    expect(turn.some((a) => a.type === 'move' || a.type === 'skill')).toBe(true);
  });
});

describe('Authority numbers', () => {
  it('is half, and is the shipped constant', () => {
    expect(BALANCE.AUTHORITY_BONUS).toBe(0.5);
  });
});
