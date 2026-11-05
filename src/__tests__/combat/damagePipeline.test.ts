import {
  resolveAttack,
  expectedDamage,
  calculateDamage,
  variance,
} from '@/systems/combat/damageCalc';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import { decideEnemyAction } from '@/systems/combat/enemyAI';
import { slash, arrowShot } from '@/data/skills/skillData';
import { BALANCE } from '@/data/balanceConstants';
import { CombatUnit, HeroStats, Hero, Item, HeroClass, Rarity } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';

const unit = (stats: Partial<HeroStats>, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({
    id: 'u', isPlayer: false,
    stats: makeStats({ moveRange: 2, maxMana: 0, ...stats }),
    ...over,
  });

/** A roll sequence, consumed in order — makes each branch reachable on demand. */
const rolls = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

const attacker = unit({ attack: 20 });
const plain = unit({ defense: 0 });

describe('variance defaults', () => {
  it('fills in the BALANCE baseline when a template declares nothing', () => {
    expect(variance(plain.stats)).toEqual({
      critChance: BALANCE.BASE_CRIT_CHANCE,
      critDamage: BALANCE.BASE_CRIT_DAMAGE,
      dodgeChance: BALANCE.BASE_DODGE,
    });
  });

  it('starts dodge at zero, so combat is deterministic until built for', () => {
    expect(BALANCE.BASE_DODGE).toBe(0);
  });

  it('caps dodge so nothing becomes unhittable', () => {
    expect(variance({ ...plain.stats, dodgeChance: 99 }).dodgeChance).toBe(BALANCE.MAX_DODGE);
  });

  it('clamps nonsense values instead of trusting them', () => {
    expect(variance({ ...plain.stats, critChance: -20 }).critChance).toBe(0);
    expect(variance({ ...plain.stats, critChance: 500 }).critChance).toBe(100);
    // A crit that reduces damage is never intended
    expect(variance({ ...plain.stats, critDamage: 40 }).critDamage).toBe(100);
  });
});

describe('resolveAttack', () => {
  it('deals the deterministic amount when nothing procs', () => {
    const result = resolveAttack(attacker, plain, slash, { rng: rolls(0.99) });
    expect(result).toEqual({
      damage: calculateDamage(attacker, plain, slash),
      crit: false,
      dodged: false,
      lifesteal: 0,
    });
  });

  it('multiplies by critDamage on a crit', () => {
    const sharp = unit({ attack: 20, critChance: 100, critDamage: 200 });
    const base = calculateDamage(sharp, plain, slash);
    const result = resolveAttack(sharp, plain, slash, { rng: rolls(0.99, 0.0) });
    expect(result.crit).toBe(true);
    expect(result.damage).toBe(base * 2);
  });

  it('respects a raised critDamage', () => {
    const brutal = unit({ attack: 20, critChance: 100, critDamage: 300 });
    const base = calculateDamage(brutal, plain, slash);
    expect(resolveAttack(brutal, plain, slash, { rng: rolls(0.99, 0.0) }).damage).toBe(base * 3);
  });

  // Dodge is checked first, so a dodged attack cannot also crit
  it('short-circuits everything when the attack is dodged', () => {
    const slippery = unit({ dodgeChance: 50 });
    const sharp = unit({ attack: 20, critChance: 100 });
    const result = resolveAttack(sharp, slippery, slash, { rng: rolls(0.0, 0.0) });
    expect(result).toEqual({ damage: 0, crit: false, dodged: true, lifesteal: 0 });
  });

  it('never dodges when dodge is zero, however the dice fall', () => {
    for (const r of [0, 0.0001, 0.5, 0.999]) {
      expect(resolveAttack(attacker, plain, slash, { rng: rolls(r) }).dodged).toBe(false);
    }
  });

  it('derives lifesteal from the damage actually dealt, crit included', () => {
    const drain = { ...slash, lifesteal: 0.5 };
    // Crit chance rather than the roll decides the branch here: a zero-dodge
    // target consumes no roll, so the first value always reaches the crit check
    const steady = resolveAttack(unit({ attack: 20, critChance: 0 }), plain, drain, {
      rng: rolls(0.99),
    });
    const critting = resolveAttack(
      unit({ attack: 20, critChance: 100, critDamage: 200 }), plain, drain, { rng: rolls(0.99) }
    );
    expect(steady.crit).toBe(false);
    expect(critting.crit).toBe(true);
    expect(critting.lifesteal).toBe(steady.lifesteal * 2);
  });

  // Skipping the roll when dodge is impossible keeps an injected sequence
  // aligned with the branches that can actually fire
  it('does not consume a roll on the dodge check when dodge is zero', () => {
    let calls = 0;
    resolveAttack(attacker, plain, slash, { rng: () => { calls++; return 0.99; } });
    expect(calls).toBe(1);
  });

  /**
   * Defence reduces; it never nullifies.
   *
   * Mitigation is subtractive, so armour used to take any attack down to
   * `MIN_DAMAGE` — and a floor of 1 reads as immunity rather than as toughness.
   * A Cave Bear below 30% health found it: `lastStand` multiplies an already
   * high defence, and every hit landing for 1 turned an elite's last 40 health
   * into a hundred-turn slog.
   */
  it('lets a fixed share of every hit through the heaviest armour', () => {
    const tank = unit({ defense: 500 });
    const dealt = resolveAttack(attacker, tank, slash, { rng: rolls(0.99) }).damage;
    const raw = attacker.stats.attack * (slash.damage ?? 0);

    expect(dealt).toBeGreaterThan(BALANCE.MIN_DAMAGE);
    expect(dealt).toBe(Math.round(raw * BALANCE.MIN_DAMAGE_FRACTION));
  });

  // The share is of the *swing*, not a flat number: a big hit still beats a
  // wall and a chip attack still does not
  it('scales what gets through with the size of the attack', () => {
    const tank = unit({ defense: 500 });
    const heavy = { ...attacker, stats: { ...attacker.stats, attack: attacker.stats.attack * 4 } };
    const small = resolveAttack(attacker, tank, slash, { rng: rolls(0.99) }).damage;
    const big = resolveAttack(heavy, tank, slash, { rng: rolls(0.99) }).damage;
    expect(big).toBeGreaterThan(small * 3);
  });

  it('still floors at MIN_DAMAGE when the swing itself is tiny', () => {
    const tank = unit({ defense: 500 });
    const feeble = { ...attacker, stats: { ...attacker.stats, attack: 1 } };
    expect(resolveAttack(feeble, tank, slash, { rng: rolls(0.99) }).damage)
      .toBe(BALANCE.MIN_DAMAGE);
  });
});

describe('expected value matches what actually happens', () => {
  // The AI scores with expectedDamage and the game rolls with resolveAttack.
  // If these drift apart the AI is optimising for a game it is not playing.
  function simulate(a: CombatUnit, t: CombatUnit, runs = 20000): number {
    let seed = 12345;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let total = 0;
    for (let i = 0; i < runs; i++) total += resolveAttack(a, t, slash, { rng }).damage;
    return total / runs;
  }

  it('agrees for a plain attacker', () => {
    const predicted = expectedDamage(attacker, plain, slash);
    expect(simulate(attacker, plain)).toBeCloseTo(predicted, 0);
  });

  it('agrees when crit is heavy', () => {
    const sharp = unit({ attack: 20, critChance: 40, critDamage: 250 });
    expect(simulate(sharp, plain)).toBeCloseTo(expectedDamage(sharp, plain, slash), 0);
  });

  it('agrees when the target dodges', () => {
    const slippery = unit({ defense: 0, dodgeChance: 30 });
    expect(simulate(attacker, slippery)).toBeCloseTo(expectedDamage(attacker, slippery, slash), 0);
  });

  it('agrees when both are in play', () => {
    const sharp = unit({ attack: 20, critChance: 25, critDamage: 300 });
    const slippery = unit({ defense: 4, dodgeChance: 20 });
    expect(simulate(sharp, slippery)).toBeCloseTo(expectedDamage(sharp, slippery, slash), 0);
  });
});

describe('the AI scores without rolling', () => {
  const hero = (over: Partial<CombatUnit> = {}) =>
    unit({ defense: 2 }, { isPlayer: true, heroId: 'h1', position: { q: 1, r: 0 }, ...over });

  it('returns the same decision every time for the same board', () => {
    const foe = unit({ attack: 20, critChance: 50 }, { skills: [slash, arrowShot] });
    const board = [foe, hero()];
    const first = JSON.stringify(decideEnemyAction(foe, board));
    for (let i = 0; i < 40; i++) {
      expect(JSON.stringify(decideEnemyAction(foe, board))).toBe(first);
    }
  });

  it('prefers the target it expects to hit over the one that dodges', () => {
    const foe = unit({ attack: 20 }, { skills: [arrowShot], position: { q: 0, r: 0 } });
    const slippery = hero({ id: 'slippery', position: { q: 1, r: 0 } });
    slippery.stats.dodgeChance = 55;
    const solid = hero({ id: 'solid', position: { q: 2, r: 0 } });
    const actions = decideEnemyAction(foe, [foe, slippery, solid]);
    const target = actions.find((a) => a.type === 'skill')?.skillTarget;
    expect(target).toEqual(solid.position);
  });
});

describe('gear reaches the variance stats', () => {
  const item = (mods: Item['modifiers']): Item => ({
    id: 'i1',
    templateId: 'ring_plain',
    itemLevel: 1,
    rarity: Rarity.Common,
    slot: 'ring',
    form: 'band',
    motif: 'plain',
    modifiers: mods,
    sellPrice: 10,
  });

  const hero: Hero = {
    id: 'h',
    templateId: 'warrior',
    name: 'H',
    heroClass: HeroClass.Warrior,
    level: 1,
    xp: 0,
    baseStats: { maxHp: 100, attack: 10, defense: 5, magic: 2, speed: 8, moveRange: 3, maxMana: 10 },
    currentHp: 100,
    currentMana: 10,
    skills: [],
    equipment: {},
    masteryPath: null,
    masteryPoints: 0,
    masteryNodes: {},
  };

  // A +10% crit ring must *add* to the 5% baseline, not replace it
  it('adds gear crit on top of the baseline rather than overwriting it', () => {
    const stats = getEffectiveStats(hero, [item({ critChance: 10 })]);
    expect(variance(stats).critChance).toBe(BALANCE.BASE_CRIT_CHANCE + 10);
  });

  it('adds gear crit damage on top of the baseline', () => {
    const stats = getEffectiveStats(hero, [item({ critDamage: 50 })]);
    expect(variance(stats).critDamage).toBe(BALANCE.BASE_CRIT_DAMAGE + 50);
  });

  it('grants dodge from zero', () => {
    const stats = getEffectiveStats(hero, [item({ dodgeChance: 12 })]);
    expect(variance(stats).dodgeChance).toBe(12);
  });

  it('stacks across several pieces', () => {
    const stats = getEffectiveStats(hero, [item({ critChance: 5 }), item({ critChance: 7 })]);
    expect(variance(stats).critChance).toBe(BALANCE.BASE_CRIT_CHANCE + 12);
  });

  it('leaves the baseline alone when nothing grants any', () => {
    expect(variance(getEffectiveStats(hero, [item({ attack: 3 })])).critChance)
      .toBe(BALANCE.BASE_CRIT_CHANCE);
  });
});
