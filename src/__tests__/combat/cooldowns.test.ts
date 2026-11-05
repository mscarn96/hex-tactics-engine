import {
  cooldownLeft,
  isSkillReady,
  canUseSkill,
  withCooldownStarted,
  tickedCooldowns,
  silenceBars,
} from '@/systems/combat/cooldowns';
import { BASIC_ATTACK_ID, basicAttackWith } from '@/systems/combat/basicAttack';
import { useCombatStore } from '@/stores/combatStore';
import { decideEnemyAction } from '@/systems/combat/enemyAI';
import { slash, raiseDead, darkBolt } from '@/data/skills/skillData';
import { AfflictionType, CombatUnit, HeroSkill } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';

const unit = (id: string, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ id, isPlayer: false, stats: makeStats({ maxHp: 60, attack: 12, defense: 2, magic: 12, moveRange: 2, maxMana: 20 }), ...over });

const cooled: HeroSkill = { ...slash, id: 'slash', cooldown: 2 };
const atWill: HeroSkill = { ...slash, cooldown: undefined };

describe('cooldown arithmetic', () => {
  it('reports an unused skill as ready', () => {
    expect(cooldownLeft(unit('u'), cooled)).toBe(0);
    expect(isSkillReady(unit('u'), cooled)).toBe(true);
  });

  // Stored as cooldown+1 because the counter ticks at the start of the caster's
  // *next* turn, which would otherwise refund the first turn of the wait
  it('stores one more turn than the declared cooldown', () => {
    expect(withCooldownStarted(undefined, cooled)).toEqual({ slash: 3 });
  });

  it('leaves an at-will skill alone', () => {
    expect(withCooldownStarted(undefined, atWill)).toBeUndefined();
    expect(withCooldownStarted({ other: 2 }, atWill)).toEqual({ other: 2 });
  });

  it('counts down and drops finished entries', () => {
    expect(tickedCooldowns({ a: 3 })).toEqual({ a: 2 });
    expect(tickedCooldowns({ a: 1 })).toEqual({});
  });

  it('ticks every running skill at once', () => {
    expect(tickedCooldowns({ a: 3, b: 1 })).toEqual({ a: 2 });
  });

  it('returns the same object when nothing is running, so no store write happens', () => {
    const empty = {};
    expect(tickedCooldowns(empty)).toBe(empty);
    expect(tickedCooldowns(undefined)).toBeUndefined();
  });

  it('gates on mana as well as cooldown', () => {
    const costly: HeroSkill = { ...slash, manaCost: 30 };
    expect(canUseSkill(unit('u'), costly)).toBe(false);
    expect(canUseSkill(unit('u'), atWill)).toBe(true);
    expect(canUseSkill(unit('u', { cooldowns: { slash: 2 } }), atWill)).toBe(false);
  });
});

describe('combatStore cooldowns', () => {
  const hero = unit('hero', { isPlayer: true, heroId: 'h1', skills: [cooled] });
  const foe = unit('foe', { stats: { ...unit('x').stats, speed: 1 } });

  beforeEach(() => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([hero], [foe]);
  });

  const heroNow = () => useCombatStore.getState().units.find((u) => u.id === 'hero')!;

  it('blocks the skill for the declared number of the unit\'s own turns', () => {
    const store = useCombatStore.getState();
    store.startCooldown('hero', cooled);
    expect(isSkillReady(heroNow(), cooled)).toBe(false);

    store.tickCooldowns('hero');           // start of next hero turn
    expect(cooldownLeft(heroNow(), cooled)).toBe(2);
    store.tickCooldowns('hero');
    expect(cooldownLeft(heroNow(), cooled)).toBe(1);
    store.tickCooldowns('hero');
    expect(isSkillReady(heroNow(), cooled)).toBe(true);
  });

  it('does not tick a unit whose turn it is not', () => {
    const store = useCombatStore.getState();
    store.startCooldown('hero', cooled);
    for (let i = 0; i < 5; i++) store.tickCooldowns('foe');
    expect(cooldownLeft(heroNow(), cooled)).toBe(3);
  });

  it('ignores an at-will skill', () => {
    useCombatStore.getState().startCooldown('hero', atWill);
    expect(heroNow().cooldowns).toEqual({});
  });

  // Per-fight state: a stale map surviving into the next battle would leave a
  // hero unable to use its signature skill for no visible reason
  it('clears cooldowns when a new combat starts', () => {
    useCombatStore.getState().startCooldown('hero', cooled);
    expect(cooldownLeft(heroNow(), cooled)).toBeGreaterThan(0);
    useCombatStore.getState().initCombat([heroNow()], [foe]);
    expect(cooldownLeft(heroNow(), cooled)).toBe(0);
  });

  it('tolerates ticking a unit that has none', () => {
    expect(() => useCombatStore.getState().tickCooldowns('foe')).not.toThrow();
    expect(() => useCombatStore.getState().tickCooldowns('nobody')).not.toThrow();
  });
});

describe('the AI respects cooldowns', () => {
  const hero = () => unit('hero', { isPlayer: true, heroId: 'h1', position: { q: 0, r: 2 } });

  it('will not choose a skill that is still cooling', () => {
    const caster = unit('mage', {
      skills: [raiseDead],
      cooldowns: { raise_dead: 2 },
      position: { q: 0, r: 0 },
    });
    const actions = decideEnemyAction(caster, [caster, hero()]);
    expect(actions.filter((a) => a.type === 'skill')).toEqual([]);
  });

  it('falls back to another skill rather than wasting the turn', () => {
    const caster = unit('mage', {
      skills: [raiseDead, darkBolt],
      cooldowns: { raise_dead: 2 },
      position: { q: 0, r: 0 },
    });
    const ids = decideEnemyAction(caster, [caster, hero()])
      .filter((a) => a.type === 'skill')
      .map((a) => a.skill?.id);
    expect(ids).toEqual(['dark_bolt']);
  });

  it('uses the skill again once it has come back', () => {
    const caster = unit('mage', { skills: [raiseDead], position: { q: 0, r: 0 } });
    const ids = decideEnemyAction(caster, [caster, hero()])
      .filter((a) => a.type === 'skill')
      .map((a) => a.skill?.id);
    expect(ids).toEqual(['raise_dead']);
  });
});

describe('unbounded skills are gated', () => {
  // raise_dead costs no mana, so before cooldowns nothing limited it at all
  it('gives every zero-cost summon a cooldown', () => {
    const ungated = [raiseDead]
      .filter((s) => s.manaCost === 0 && !s.cooldown)
      .map((s) => s.id);
    expect(ungated).toEqual([]);
  });
});

// Playtest 2026-10-21, PT-19: Silence takes the skills, not the weapon in the hand
describe('Silence spares the Basic Attack', () => {
  const silence = { type: AfflictionType.Silence, magnitude: 1, duration: 2 };
  const basic = basicAttackWith(undefined);

  it('refuses every skill but the Basic Attack', () => {
    const silenced = unit('u', { activeEffects: [silence], currentMana: 20 });
    expect(canUseSkill(silenced, basic)).toBe(true);
    expect(canUseSkill(silenced, atWill)).toBe(false);
    expect(silenceBars(silenced, basic)).toBe(false);
    expect(silenceBars(silenced, atWill)).toBe(true);
  });

  it('lets an AI-driven silenced unit carrying one still strike with it', () => {
    const target = unit('t', { isPlayer: true, heroId: 'h1', position: { q: 1, r: 0 } });
    const caster = unit('c', { skills: [atWill, basic], activeEffects: [silence], currentMana: 20, position: { q: 0, r: 0 } });
    const ids = decideEnemyAction(caster, [caster, target]).filter((a) => a.type === 'skill').map((a) => a.skill?.id);
    expect(ids).toEqual([BASIC_ATTACK_ID]);
  });

  // Playtest 2026-10-23: an enemy carrying none falls back on one read off its kit
  it('strikes with the fallback Basic Attack when the unit carries none', () => {
    const target = unit('t', { isPlayer: true, heroId: 'h1', position: { q: 1, r: 0 } });
    const caster = unit('c', { skills: [atWill], activeEffects: [silence], position: { q: 0, r: 0 } });
    const ids = decideEnemyAction(caster, [caster, target]).filter((a) => a.type === 'skill').map((a) => a.skill?.id);
    expect(ids).toEqual([BASIC_ATTACK_ID]);
  });
});
