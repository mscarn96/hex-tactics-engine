import { useCombatStore } from '@/stores/combatStore';
import { CombatSink } from '@/systems/combat/combatSink';
import { executeAIActions } from '@/systems/combat/enemyAI';
import { requireUnit } from '@/systems/combat/unitLookup';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { slash, arcaneBolt } from '@/data/skills/skillData';
import { arc, tempest, thunderbolt } from '@/data/skills/masterySkills';
import { overloadBonus } from '@/systems/combat/passiveFormulas';
import { AfflictionType, AuraType, CombatUnit, HeroSkill, HexCoord, PassiveRank } from '@/models/types';
import { at, makeEffect, makeSkill, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * A hero's cast and an enemy's cast are one pipeline.
 *
 * `executeAIActions` used to carry its own strike loop, a few dozen lines behind
 * the hero's resolver and drifting further with every mechanic: no Overload for
 * an AI caster, no crit for the passives that read one, no backstab, no
 * strike scale. Now an AI `skill` action calls `resolveSkillUse`, so what is
 * pinned here is that a fixed `rng` gives the same fight whichever side swings,
 * and that the rules the copy used to miss now reach the enemy.
 */

const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const RANK: PassiveRank = { level: 2, scale: 1 };

const stats = (over = {}) =>
  makeStats({ maxHp: 400, attack: 25, magic: 30, defense: 2, maxMana: 200, critChance: 0, dodgeChance: 0, ...over });

/** The same sequence for each side, so both see the same dice. */
const dice = () => {
  const rolls = [0.3, 0.9, 0.05, 0.7, 0.5, 0.2];
  let i = 0;
  return () => rolls[i++ % rolls.length];
};

/** The same arrangement for either side: `casterIsPlayer` flips who swings. */
function arena(casterIsPlayer: boolean, casterOver: Partial<CombatUnit> = {}, foes: Partial<CombatUnit>[] = [{}]) {
  resetFixtureIds();
  state().reset();
  const caster = makeUnit({
    id: 'caster', isPlayer: casterIsPlayer, position: at(0, 0), stats: stats(),
    skills: [slash, arcaneBolt, arc, thunderbolt, tempest], ...casterOver,
  });
  const targets = foes.map((over, i) => makeUnit({
    id: `foe${i}`, isPlayer: !casterIsPlayer, position: at(1, i), stats: stats({ maxHp: 2000 }), ...over,
  }));
  useCombatStore.setState({ units: [caster, ...targets] });
  return { caster: unitNow('caster'), targets: targets.map((t) => t.id) };
}

function recorder() {
  const floats: string[] = [];
  const logs: string[] = [];
  const sink: CombatSink = {
    log: (text) => logs.push(text),
    float: (_at, text) => floats.push(text),
    vfx: () => {},
    status: () => {},
  };
  return { sink, floats, logs };
}

/** Casts `skill` at `target` from the given side and reports what the board and the sink saw. */
function cast(casterIsPlayer: boolean, skill: HeroSkill, target: HexCoord, casterOver = {}, foes?: Partial<CombatUnit>[]) {
  const { caster, targets } = arena(casterIsPlayer, casterOver, foes);
  const rec = recorder();
  if (casterIsPlayer) resolveSkillUse(caster, skill, target, rec.sink, { rng: dice() });
  else executeAIActions(caster, [{ type: 'skill', skill, skillTarget: target }], rec.sink, { rng: dice() });
  const after = unitNow('caster');
  return {
    floats: rec.floats,
    logs: rec.logs,
    targetHp: targets.map((id) => unitNow(id).currentHp),
    mana: after.currentMana,
    cooldowns: after.cooldowns,
    effects: targets.map((id) => unitNow(id).activeEffects.map((e) => `${e.type}:${e.magnitude}:${e.duration}`)),
  };
}

describe('one pipeline, two sides', () => {
  it.each([
    ['a melee strike', slash, at(1, 0)],
    ['a bolt', arcaneBolt, at(1, 0)],
    ['an area cast', tempest, at(0, 0)],
  ] as const)('%s resolves identically for a fixed rng', (_name, skill, target) => {
    const foes = [{}, {}];
    const hero = cast(true, skill, target, {}, foes);
    const enemy = cast(false, skill, target, {}, foes);
    expect(enemy).toEqual(hero);
    expect(hero.targetHp.some((hp) => hp < 2000)).toBe(true);
  });

  it('leaves the same cooldown and mana behind', () => {
    const cooled = makeSkill({ id: 'wallop' as HeroSkill['id'], name: 'Wallop', damage: 20, range: 1, manaCost: 15, cooldown: 3 });
    const hero = cast(true, cooled, at(1, 0), { skills: [cooled] });
    const enemy = cast(false, cooled, at(1, 0), { skills: [cooled] });
    expect(enemy.mana).toBe(hero.mana);
    expect(enemy.cooldowns).toEqual(hero.cooldowns);
    expect(enemy.mana).toBe(200 - 15);
  });
});

describe('rules the enemy copy used to miss', () => {
  const shocked = () => ({ activeEffects: [makeEffect(AfflictionType.Shock, { magnitude: 1, duration: 3 })] });

  it('an AI caster charges Overload with an area cast over two Shocked heroes', () => {
    const { caster } = arena(false, { passives: ['overload'], passiveRanks: { overload: RANK } }, [shocked(), shocked()]);
    executeAIActions(caster, [{ type: 'skill', skill: tempest, skillTarget: at(0, 0) }]);
    const charge = unitNow('caster').activeEffects.find((e) => e.type === AuraType.Overloaded);
    expect(charge?.magnitude).toBeCloseTo(overloadBonus(RANK), 5);
  });

  it('a critical hit reaches the passives that read one (Savage Edge)', () => {
    const run = (passive: boolean) => {
      const { caster } = arena(false, {
        stats: stats({ critChance: 100 }),
        ...(passive && { passives: ['savageEdge'], passiveRanks: { savageEdge: RANK } }),
      }, [{ activeEffects: [makeEffect(AfflictionType.Bleed, { magnitude: 10, duration: 3 })] }]);
      executeAIActions(caster, [{ type: 'skill', skill: slash, skillTarget: at(1, 0) }], SILENT_SINK, { rng: () => 0.5 });
      return 2000 - unitNow('foe0').currentHp;
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });

  it('an enemy behind its target backstabs, as a hero behind one does', () => {
    // The caster stands west of the foe: facing east (0) puts it on the foe's back hex
    const flank = (casterIsPlayer: boolean, fromBehind: boolean) => {
      arena(casterIsPlayer, {}, [{ position: at(1, 0), facing: fromBehind ? 0 : 3 }]);
      const live = unitNow('caster');
      if (casterIsPlayer) resolveSkillUse(live, slash, at(1, 0), SILENT_SINK, { rng: () => 0.5 });
      else executeAIActions(live, [{ type: 'skill', skill: slash, skillTarget: at(1, 0) }], SILENT_SINK, { rng: () => 0.5 });
      return 2000 - unitNow('foe0').currentHp;
    };
    expect(flank(false, true)).toBeGreaterThan(flank(false, false));
    expect(flank(false, true)).toBe(flank(true, true));
  });

  it('an enemy caster heals an ally, which the old executor could not', () => {
    const mend = makeSkill({ id: 'mend' as HeroSkill['id'], name: 'Mend', healing: 40, range: 2, targetSide: 'ally', manaCost: 5 });
    arena(false, { skills: [mend] }, [{}]);
    const friend = makeUnit({ id: 'friend', isPlayer: false, position: at(0, 1), stats: stats(), currentHp: 100 });
    useCombatStore.setState((s) => ({ units: [...s.units, friend] }));
    executeAIActions(unitNow('caster'), [{ type: 'skill', skill: mend, skillTarget: at(0, 1) }], SILENT_SINK, { rng: () => 0.5 });
    expect(unitNow('friend').currentHp).toBeGreaterThan(100);
  });
});
