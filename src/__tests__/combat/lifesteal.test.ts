import { calculateLifesteal, calculateDamage } from '@/systems/combat/damageCalc';
import { decideEnemyAction } from '@/systems/combat/enemyAI';
import { ghostTouch, trollSmash, slash } from '@/data/skills/skillData';
import { CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';

/**
 * A self-centred drain. No template carries one any more; it stays as a
 * fixture because the rules it exposes — area lifesteal heals the caster, and
 * the AI can aim a ring at its own hex — are the engine's, not one boss's.
 */
const drainRing: HeroSkill = { ...trollSmash, id: 'drain_ring' as never, name: 'Drain', lifesteal: 0.5 };

const unit = (id: string, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ id, isPlayer: false, stats: makeStats({ maxHp: 60, attack: 10, defense: 3, moveRange: 2, maxMana: 0 }), ...over });

const hero = (pos: HexCoord, over: Partial<CombatUnit> = {}) =>
  unit(`hero-${pos.q},${pos.r}`, { isPlayer: true, heroId: `h${pos.q}${pos.r}`, position: pos, ...over });

const skillIdsIn = (actions: ReturnType<typeof decideEnemyAction>) =>
  actions.filter((a) => a.type === 'skill').map((a) => a.skill?.id);

describe('calculateLifesteal', () => {
  it('returns a fraction of the damage actually dealt', () => {
    expect(calculateLifesteal({ ...slash, lifesteal: 0.5 } as HeroSkill, 20)).toBe(10);
  });

  it('returns nothing for a skill without lifesteal', () => {
    expect(calculateLifesteal(slash, 40)).toBe(0);
  });

  // A fully-blocked hit heals nothing — lifesteal is keyed to damage, not to casting
  it('returns nothing when no damage landed', () => {
    expect(calculateLifesteal(drainRing, 0)).toBe(0);
    expect(calculateLifesteal(drainRing, -5)).toBe(0);
  });

  it('never rounds a real hit down to zero', () => {
    expect(calculateLifesteal({ ...slash, lifesteal: 0.05 } as HeroSkill, 1)).toBe(1);
  });

  it('scales with the size of the strike', () => {
    const small = calculateLifesteal(drainRing, 10);
    const large = calculateLifesteal(drainRing, 100);
    expect(large).toBeGreaterThan(small);
  });
});

describe('drain skills actually drain', () => {
  // The bug: drains carried `healing`, which only lands on allies inside the
  // area, so a boss's signature drain once healed it for exactly zero
  it('gives the drain skills lifesteal rather than ally healing', () => {
    for (const skill of [ghostTouch]) {
      expect({ id: skill.id, lifesteal: skill.lifesteal, healing: skill.healing })
        .toEqual({ id: skill.id, lifesteal: expect.any(Number), healing: undefined });
    }
  });
});

describe('enemy AI reaches its self-centred rings', () => {
  // Ring at range 0 is aimed at the caster's own hex, so `dist <= range` was
  // never satisfiable and these skills could never be chosen
  it('casts a self-centred ring when enemies are adjacent', () => {
    const troll = unit('troll', { skills: [trollSmash], position: { q: 0, r: 0 } });
    const actions = decideEnemyAction(troll, [troll, hero({ q: 1, r: 0 })]);
    expect(skillIdsIn(actions)).toContain('troll_smash');
  });

  it('casts a self-centred drain', () => {
    const drainer = unit('drainer', { skills: [drainRing], position: { q: 0, r: 0 } });
    const actions = decideEnemyAction(drainer, [drainer, hero({ q: 1, r: 0 })]);
    expect(skillIdsIn(actions)).toContain('drain_ring');
  });

  it('moves instead when nothing is inside the ring', () => {
    const troll = unit('troll', { skills: [trollSmash], position: { q: 0, r: 0 } });
    const actions = decideEnemyAction(troll, [troll, hero({ q: 0, r: 5 })]);
    expect(skillIdsIn(actions)).toEqual([]);
    expect(actions.some((a) => a.type === 'move')).toBe(true);
  });

  // The check read `!target.isPlayer`, scoring a blast by how hard it hit the
  // caster's own allies — so it would fire into a pile of friends and no enemies
  it('will not fire a ring that only catches its own allies', () => {
    const troll = unit('troll', { skills: [trollSmash], position: { q: 0, r: 0 } });
    const allies = [{ q: 1, r: 0 }, { q: 0, r: 1 }].map((p, i) => unit(`ally${i}`, { position: p }));
    const actions = decideEnemyAction(troll, [troll, ...allies, hero({ q: 0, r: 5 })]);
    expect(skillIdsIn(actions)).toEqual([]);
  });

  it('prefers the drain over a plain hit of equal damage, because it also heals', () => {
    const plain: HeroSkill = { ...ghostTouch, id: 'slash', name: 'Plain', lifesteal: undefined };
    const ghost = unit('ghost', { skills: [plain, ghostTouch], position: { q: 0, r: 0 } });
    const actions = decideEnemyAction(ghost, [ghost, hero({ q: 1, r: 0 })]);
    expect(skillIdsIn(actions)).toContain('ghost_touch');
  });
});

describe('damage is unaffected by the lifesteal change', () => {
  it('still computes drain damage from attack and defense', () => {
    const drainer = unit('drainer', { stats: { ...unit('x').stats, attack: 20 } });
    const target = hero({ q: 1, r: 0 });
    expect(calculateDamage(drainer, target, drainRing)).toBeGreaterThan(0);
  });
});
