import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { getSkillTargets, getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { arc, summonThunderElemental, chainLightning, tempest, thunderstep } from '@/data/skills/masterySkills';
import { hexKey } from '@/utils/hexUtils';
import {
  AfflictionType, CombatUnit, HeroStats, HexCoord, SkillTargetType,
} from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';
import { requireUnit } from '@/systems/combat/unitLookup';

/**
 * The Stormcaller: speed, chains, and a class that finally looks like one.
 *
 * Two of its three shapes were wrong rather than merely dull. Chain Lightning
 * was a `Line`, so the skill whose name promises a crowd hit whatever happened
 * to stand along one of six axes — frequently one thing. Thunderstep was a blink
 * and nothing else, which is a turn spent moving on a class whose problem is
 * rarely where it is standing.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ maxHp: 200, attack: 10, magic: 30, maxMana: 200, critChance: 0, dodgeChance: 0, ...over });

const unit = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ stats: stats(), ...over });

const foeAt = (q: number, r: number, over: Partial<CombatUnit> = {}) =>
  unit({ isPlayer: false, position: { q, r }, ...over });

const struck = (caster: CombatUnit, at: HexCoord, units: CombatUnit[]) =>
  getSkillTargets(chainLightning, caster.position, at, units).map(hexKey);

describe('chain lightning', () => {
  it('is a route through bodies, not a direction', () => {
    expect(chainLightning.targetType).toBe(SkillTargetType.Chain);
    expect(chainLightning.chainJumps).toBeGreaterThan(0);
  });

  it('leaps from the target to the nearest untouched enemy', () => {
    // Inside the arena on every hop: `q` is bounded at 3, and a chain will not
    // leap to a body standing outside the fight
    const caster = unit({ position: { q: -2, r: 0 } });
    const first = foeAt(1, 0);
    const second = foeAt(2, 0);
    const third = foeAt(3, 0);
    const units = [caster, first, second, third];

    expect(struck(caster, first.position, units)).toEqual([
      hexKey(first.position), hexKey(second.position), hexKey(third.position),
    ]);
  });

  it('stops where the crowd stops', () => {
    const caster = unit({ position: { q: 0, r: 0 } });
    const lone = foeAt(2, 0);
    // Well beyond a hop from the first, so the bolt has nowhere to go
    const distant = foeAt(-3, 3);
    const units = [caster, lone, distant];

    expect(struck(caster, lone.position, units)).toEqual([hexKey(lone.position)]);
  });

  it('never doubles back onto something it already hit', () => {
    const caster = unit({ position: { q: 0, r: 0 } });
    const a = foeAt(2, 0);
    const b = foeAt(3, 0);
    const hexes = struck(caster, a.position, [caster, a, b]);
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it('does not leap to the caster’s own side', () => {
    const caster = unit({ position: { q: 0, r: 0 } });
    const foe = foeAt(2, 0);
    const friend = unit({ position: { q: 3, r: 0 } });

    expect(struck(caster, foe.position, [caster, foe, friend]))
      .toEqual([hexKey(foe.position)]);
  });

  /** An enemy Stormcaller's bolt walks the party, by the same function. */
  it('follows the side it started on, not the caster’s', () => {
    const enemy = unit({ isPlayer: false, position: { q: 0, r: 0 } });
    const hero = unit({ position: { q: 2, r: 0 } });
    const otherHero = unit({ position: { q: 3, r: 0 } });

    expect(struck(enemy, hero.position, [enemy, hero, otherHero])).toEqual([
      hexKey(hero.position), hexKey(otherHero.position),
    ]);
  });

  it('takes the same route every time it is asked', () => {
    const caster = unit({ position: { q: 0, r: 0 } });
    const units = [caster, foeAt(2, 0), foeAt(2, 1), foeAt(3, 0)];
    const once = struck(caster, { q: 2, r: 0 }, units);
    const twice = struck(caster, { q: 2, r: 0 }, units);
    expect(once).toEqual(twice);
  });

  it('damages every body it reaches', () => {
    const caster = unit({ position: { q: 0, r: 0 }, skills: [chainLightning] });
    const first = foeAt(2, 0);
    const second = foeAt(3, 0);
    useCombatStore.setState({ units: [caster, first, second] });

    resolveSkillUse(caster, chainLightning, first.position, SILENT_SINK);

    const after = useCombatStore.getState().units;
    expect(requireUnit(after, first.id).currentHp).toBeLessThan(200);
    expect(requireUnit(after, second.id).currentHp).toBeLessThan(200);
  });
});

describe('thunderstep', () => {
  it('arrives with the thunder', () => {
    expect(thunderstep.damage).toBeGreaterThan(0);
    expect(thunderstep.aoeRadius).toBeGreaterThan(0);
    expect(thunderstep.selfMove?.kind).toBe('blink');
  });

  it('only offers ground to land on', () => {
    const caster = unit({ position: { q: 0, r: 0 }, skills: [thunderstep] });
    const foe = foeAt(2, 0);
    const offered = getValidSkillTargetHexes(thunderstep, caster, [caster, foe]).map(hexKey);

    expect(offered).not.toContain(hexKey(foe.position));
    expect(offered).toContain(hexKey({ q: 1, r: 0 }));
  });

  /**
   * The targets are computed from where the caster *ends up* — the resolver
   * lands a blink before the strike, which is what makes this an entrance into
   * a knot of enemies rather than an exit from one.
   */
  it('strikes what is beside the landing hex, not the launch hex', () => {
    const caster = unit({ position: { q: -3, r: 0 }, skills: [thunderstep] });
    const nextToLaunch = foeAt(-3, 1);
    const nextToLanding = foeAt(1, 0);
    useCombatStore.setState({ units: [caster, nextToLaunch, nextToLanding] });

    resolveSkillUse(caster, thunderstep, { q: 0, r: 0 }, SILENT_SINK);

    const after = useCombatStore.getState().units;
    expect(requireUnit(after, caster.id).position).toEqual({ q: 0, r: 0 });
    expect(requireUnit(after, nextToLanding.id).currentHp).toBeLessThan(200);
    expect(requireUnit(after, nextToLaunch.id).currentHp).toBe(200);
    expect(
      requireUnit(after, nextToLanding.id)
        .activeEffects.some((e) => e.type === AfflictionType.Shock),
    ).toBe(true);
  });

  it('does not electrocute the caster it arrives with', () => {
    const caster = unit({ position: { q: -3, r: 0 }, skills: [thunderstep] });
    const foe = foeAt(1, 0);
    useCombatStore.setState({ units: [caster, foe] });
    resolveSkillUse(caster, thunderstep, { q: 0, r: 0 }, SILENT_SINK);

    expect(requireUnit(useCombatStore.getState().units, caster.id).currentHp).toBe(200);
  });
});

describe('the storm’s shape', () => {
  /**
   * Every one of them used to resolve to `bolt` or `nova` — a gliding mote and
   * an expanding ring, which is a fireball and a shockwave. The class read as a
   * re-tinted mage.
   */
  it('draws every stormcaller skill as electricity', () => {
    const offenders = [arc, chainLightning, thunderstep, tempest, summonThunderElemental]
      .filter((s) => s.vfxKind !== 'lightning')
      .map((s) => s.id);
    expect(offenders).toEqual([]);
  });

  it('drops the icon yellow for something that reads as a strike', () => {
    const offenders = [arc, chainLightning, thunderstep, tempest, summonThunderElemental]
      .filter((s) => s.vfxColor === '#ffee66')
      .map((s) => s.id);
    expect(offenders).toEqual([]);
  });
});
