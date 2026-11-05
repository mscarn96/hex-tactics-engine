import { absorbWithBarrier, isAffliction, isHiddenFrom, isRooted, isSilenced, reflectedDamage, shockChain, skillEffects } from '@/systems/combat/statusEffects';
import { markMultiplier } from '@/systems/combat/damageCalc';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { getMovementRange } from '@/systems/combat/movement';
import { calculateDamage, resolveEffectMagnitude } from '@/systems/combat/damageCalc';
import { canUseSkill } from '@/systems/combat/cooldowns';
import { activeTaunt, hasStaleTaunt } from '@/systems/combat/taunt';
import { useCombatStore } from '@/stores/combatStore';
import { slash, groundSlam } from '@/data/skills/skillData';
import { challenge } from '@/data/skills/masterySkills';
import {
  ActiveEffect,
  AfflictionType,
  AuraType,
  CombatUnit,
  HeroSkill,
  HexCoord,
} from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { makeStats, makeUnit } from '../support/fixtures';

const unit = (id: string, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ id, isPlayer: false, stats: makeStats({ maxHp: 60, attack: 12, defense: 5, magic: 12, moveRange: 2, maxMana: 20 }), ...over });

const at = (q: number, r: number): HexCoord => ({ q, r });
const eff = (type: ActiveEffect['type'], over: Partial<ActiveEffect> = {}): ActiveEffect => ({
  type,
  magnitude: 1,
  duration: 3,
  ...over,
});

// ─── Classification ───────────────────────────────────────────────────────────

describe('affliction classification', () => {
  it('sorts every new status onto the right side', () => {
    expect(isAffliction(AfflictionType.Burn)).toBe(true);
    expect(isAffliction(AfflictionType.Root)).toBe(true);
    expect(isAffliction(AfflictionType.Mark)).toBe(true);
    expect(isAffliction(AuraType.Barrier)).toBe(false);
    expect(isAffliction(AuraType.Thorns)).toBe(false);
    expect(isAffliction(AuraType.Stealth)).toBe(false);
  });

  // DebuffImmunity and cleanse both key off this, so a misclassified aura would
  // become strippable and a misclassified affliction unblockable
  it('classifies every declared status exactly once', () => {
    const auras = Object.values(AuraType);
    const afflictions = Object.values(AfflictionType);
    expect(auras.filter(isAffliction)).toEqual([]);
    expect(afflictions.every(isAffliction)).toBe(true);
  });
});

// ─── Magnitude authoring ──────────────────────────────────────────────────────

describe('magnitude resolution', () => {
  const caster = unit('c', { stats: { ...unit('x').stats, attack: 20 } });

  it('reads a small DoT magnitude as a fraction of attack', () => {
    // Poison alone carries `BALANCE.POISON_POWER`, the one dial the whole
    // mechanic is tuned by: 0.4 × 20 attack is 8, × 0.9 is 7.2, rounded to 7.
    // Derived rather than written as a literal, so retuning the dial does not
    // put this suite in the way of it — what is being pinned is that the dial is
    // applied to poison and to nothing else, which is what the Burn line beside
    // it says.
    expect(resolveEffectMagnitude(AfflictionType.Poison, 0.4, caster)).toBe(
      Math.round(0.4 * 20 * BALANCE.POISON_POWER),
    );
    expect(resolveEffectMagnitude(AfflictionType.Burn, 0.5, caster)).toBe(10);
  });

  it('takes a large DoT magnitude literally', () => {
    expect(resolveEffectMagnitude(AfflictionType.Bleed, 7, caster)).toBe(7);
  });

  // The bug this guards: threat 2 read as "×attack" makes taunt priority depend
  // on the taunter's weapon, so which tank wins changes with their gear
  it('never rescales a non-DoT magnitude', () => {
    expect(resolveEffectMagnitude(AfflictionType.Taunt, 2, caster)).toBe(2);
    expect(resolveEffectMagnitude(AfflictionType.AttackDown, 3, caster)).toBe(3);
    expect(resolveEffectMagnitude(AfflictionType.Mark, 0.5, caster)).toBe(0.5);
  });
});

// ─── Root and Silence ─────────────────────────────────────────────────────────

describe('root and silence are exact inverses', () => {
  it('root stops movement but not action', () => {
    const rooted = unit('r', { activeEffects: [eff(AfflictionType.Root)] });
    expect(isRooted(rooted)).toBe(true);
    expect(getMovementRange(rooted, [rooted])).toEqual([]);
    expect(canUseSkill(rooted, slash)).toBe(true);
  });

  it('silence stops action but not movement', () => {
    const silenced = unit('s', { activeEffects: [eff(AfflictionType.Silence)] });
    expect(isSilenced(silenced)).toBe(true);
    expect(canUseSkill(silenced, slash)).toBe(false);
    expect(getMovementRange(silenced, [silenced]).length).toBeGreaterThan(0);
  });

  it('leaves an unafflicted unit alone', () => {
    const free = unit('f');
    expect(getMovementRange(free, [free]).length).toBeGreaterThan(0);
    expect(canUseSkill(free, slash)).toBe(true);
  });
});

// ─── Stealth ──────────────────────────────────────────────────────────────────

describe('stealth', () => {
  const hidden = unit('h', { activeEffects: [eff(AuraType.Stealth)] });

  it('hides from single-target skills', () => {
    expect(isHiddenFrom(hidden, slash)).toBe(true);
  });

  // Otherwise stealth is just timed invulnerability with no way to answer it
  it('does not hide from area skills', () => {
    expect(isHiddenFrom(hidden, groundSlam)).toBe(false);
  });

  it('does not hide a unit without the aura', () => {
    expect(isHiddenFrom(unit('v'), slash)).toBe(false);
  });
});

// ─── Barrier ──────────────────────────────────────────────────────────────────

describe('barrier absorption', () => {
  const withBarrier = (magnitude: number) => [eff(AuraType.Barrier, { magnitude })];

  it('eats the whole hit when the pool covers it', () => {
    const r = absorbWithBarrier(withBarrier(30), 10);
    expect(r).toMatchObject({ hpDamage: 0, absorbed: 10 });
    expect(r.effects[0].magnitude).toBe(20);
  });

  it('spills the remainder through and removes a spent barrier', () => {
    const r = absorbWithBarrier(withBarrier(4), 10);
    expect(r).toMatchObject({ hpDamage: 6, absorbed: 4 });
    expect(r.effects).toEqual([]);
  });

  it('is a no-op without a barrier', () => {
    const effects = [eff(AuraType.Thorns)];
    const r = absorbWithBarrier(effects, 10);
    expect(r).toMatchObject({ hpDamage: 10, absorbed: 0 });
    expect(r.effects).toBe(effects);
  });

  it('does not mutate the effects it was given', () => {
    const effects = withBarrier(30);
    absorbWithBarrier(effects, 10);
    expect(effects[0].magnitude).toBe(30);
  });
});

// ─── Thorns ───────────────────────────────────────────────────────────────────

describe('thorns', () => {
  const thorny = unit('t', { activeEffects: [eff(AuraType.Thorns, { magnitude: 0.3 })] });

  it('reflects a fraction of the damage taken', () => {
    expect(reflectedDamage(thorny, 20)).toBe(6);
  });

  it('always reflects at least a point of a real hit', () => {
    expect(reflectedDamage(thorny, 1)).toBe(1);
  });

  it('reflects nothing off a unit without thorns, or off no damage', () => {
    expect(reflectedDamage(unit('p'), 20)).toBe(0);
    expect(reflectedDamage(thorny, 0)).toBe(0);
  });
});

// ─── Shock ────────────────────────────────────────────────────────────────────

describe('shock chaining', () => {
  const shocked = unit('victim', {
    isPlayer: true,
    position: at(0, 0),
    activeEffects: [eff(AfflictionType.Shock)],
  });
  const neighbour = unit('near', { isPlayer: true, position: at(1, 0), currentHp: 20 });
  const distant  = unit('far',  { isPlayer: true, position: at(3, 0) });
  const foe      = unit('foe',  { isPlayer: false, position: at(0, 1) });

  it('jumps to an adjacent ally at a fraction of the damage', () => {
    const chain = shockChain(shocked, [shocked, neighbour, distant, foe], 20);
    expect(chain?.unit.id).toBe('near');
    expect(chain?.damage).toBe(Math.round(20 * BALANCE.SHOCK_CHAIN_FRACTION));
  });

  it('does not jump to the other side or across the map', () => {
    expect(shockChain(shocked, [shocked, distant, foe], 20)).toBeNull();
  });

  it('does nothing without the affliction', () => {
    const clean = { ...shocked, activeEffects: [] };
    expect(shockChain(clean, [clean, neighbour], 20)).toBeNull();
  });

  // A chain that re-triggers off its own damage is how a status accidentally
  // becomes the strongest thing in the game
  it('does not chain again off the unit it jumped to', () => {
    const alsoShocked = { ...neighbour, activeEffects: [eff(AfflictionType.Shock)] };
    const chain = shockChain(shocked, [shocked, alsoShocked], 20);
    expect(chain?.unit.id).toBe('near');
    // shockChain returns one hop and no more; the caller applies plain damage
    expect(Object.keys(chain ?? {})).toEqual(['unit', 'damage']);
  });
});

// ─── Mark ─────────────────────────────────────────────────────────────────────

describe('mark', () => {
  const hunter = unit('hunter');
  const other  = unit('other');
  const marked = unit('prey', {
    activeEffects: [eff(AfflictionType.Mark, { magnitude: 0.5, sourceUnitId: 'hunter' })],
  });

  it('boosts damage for the marker only', () => {
    expect(markMultiplier(hunter, marked)).toBe(1.5);
    expect(markMultiplier(other, marked)).toBe(1);
  });

  it('feeds through the real damage formula', () => {
    const unmarked = { ...marked, activeEffects: [] };
    const plain  = calculateDamage(hunter, unmarked, slash);
    const bonus  = calculateDamage(hunter, marked, slash);
    expect(bonus).toBeGreaterThan(plain);
    // Each side is rounded on its own, so the ratio holds to within a point
    expect(Math.abs(bonus - plain * 1.5)).toBeLessThanOrEqual(1);
  });
});

// ─── Effective stats ──────────────────────────────────────────────────────────

describe('shred and chill in effective stats', () => {
  it('subtracts stat shred', () => {
    const shredded = unit('s', {
      activeEffects: [
        eff(AfflictionType.AttackDown, { magnitude: 4 }),
        eff(AfflictionType.DefenseDown, { magnitude: 2 }),
        eff(AfflictionType.Chill, { magnitude: 3 }),
      ],
    });
    const s = getCombatEffectiveStats(shredded);
    expect(s.attack).toBe(8);
    expect(s.defense).toBe(3);
    expect(s.speed).toBe(7);
  });

  /**
   * Two rules in one, and the second replaced the first.
   *
   * Flooring at zero is what keeps the *arithmetic* honest: damage subtracts
   * `defense × DEFENSE_MULTIPLIER`, so negative defence would silently turn a
   * debuff into an unbounded damage bonus. It is not enough to keep the *fight*
   * honest — Weakened is authored in flat points against attack values that
   * start at 5, so one application could take an early hero to literally zero
   * attack and every blow they landed for three turns dealt `MIN_DAMAGE`.
   *
   * So the floor is a fraction of the unit's own base rather than zero. Written
   * against `MAX_SHRED_FRACTION` rather than as literals, because the fraction
   * is the deliverable and the number will get retuned.
   */
  it('caps shred at a fraction of the stat rather than flooring it at zero', () => {
    const overshredded = unit('o', {
      activeEffects: [
        eff(AfflictionType.DefenseDown, { magnitude: 99 }),
        eff(AfflictionType.AttackDown, { magnitude: 99 }),
      ],
    });
    const s = getCombatEffectiveStats(overshredded);
    const keeps = 1 - BALANCE.MAX_SHRED_FRACTION;
    expect(s.defense).toBe(Math.round(5 * keeps));
    expect(s.attack).toBe(Math.round(12 * keeps));
    // The rule the numbers are for: shredded is not the same as disarmed.
    expect(s.attack).toBeGreaterThan(0);
  });

  /**
   * A unit authored with none of a stat keeps none of it.
   *
   * Enemies are built with `magic: 0`, and a floor that handed them a point
   * would be a buff wearing a safety rail — every enemy in the game would gain
   * magic damage it was never given.
   */
  it('floors a stat the unit never had at zero', () => {
    const mageless = unit('m', {
      stats: { ...unit('x').stats, magic: 0 },
      activeEffects: [eff(AfflictionType.AttackDown, { magnitude: 99 })],
    });
    expect(getCombatEffectiveStats(mageless).magic).toBe(0);
  });

  it('never chills a unit below acting speed', () => {
    const frozenSolid = unit('f', { activeEffects: [eff(AfflictionType.Chill, { magnitude: 99 })] });
    expect(getCombatEffectiveStats(frozenSolid).speed).toBe(1);
  });

  it('adds CritBuff on top of the baseline rather than replacing it', () => {
    const buffed = unit('b', { activeEffects: [eff(AuraType.CritBuff, { magnitude: 10 })] });
    expect(getCombatEffectiveStats(buffed).critChance).toBe(BALANCE.BASE_CRIT_CHANCE + 10);
  });
});

// ─── Taunt resolution ─────────────────────────────────────────────────────────

describe('taunt resolution', () => {
  const tankA = unit('tankA', { isPlayer: true, position: at(0, 1) });
  const tankB = unit('tankB', { isPlayer: true, position: at(1, 0) });

  const taunted = (...effects: ActiveEffect[]) => unit('foe', { activeEffects: effects });
  const taunt = (source: string, magnitude: number, appliedAt: number) =>
    eff(AfflictionType.Taunt, { magnitude, sourceUnitId: source, appliedAt });

  it('returns null when nothing is taunting', () => {
    expect(activeTaunt(unit('foe'), [tankA])).toBeNull();
  });

  it('picks the loudest taunt', () => {
    const foe = taunted(taunt('tankA', 1, 1), taunt('tankB', 5, 2));
    expect(activeTaunt(foe, [foe, tankA, tankB])?.id).toBe('tankB');
  });

  it('ignores order in the array — magnitude decides, not position', () => {
    const foe = taunted(taunt('tankB', 5, 2), taunt('tankA', 1, 1));
    expect(activeTaunt(foe, [foe, tankA, tankB])?.id).toBe('tankB');
  });

  // A second tank stepping in must actually take over; "nothing happens" is the
  // worst outcome for a button whose whole job is redirection
  it('breaks a tie toward the most recent taunt', () => {
    const foe = taunted(taunt('tankA', 2, 1), taunt('tankB', 2, 9));
    expect(activeTaunt(foe, [foe, tankA, tankB])?.id).toBe('tankB');
  });

  it('ignores a taunt whose source is dead', () => {
    const corpse = { ...tankA, currentHp: 0 };
    const foe = taunted(taunt('tankA', 5, 1), taunt('tankB', 1, 2));
    expect(activeTaunt(foe, [foe, corpse, tankB])?.id).toBe('tankB');
  });

  it('reports a taunt from a corpse as stale so callers can clear it', () => {
    const corpse = { ...tankA, currentHp: 0 };
    const foe = taunted(taunt('tankA', 5, 1));
    expect(activeTaunt(foe, [foe, corpse])).toBeNull();
    expect(hasStaleTaunt(foe, [foe, corpse])).toBe(true);
    expect(hasStaleTaunt(unit('clean'), [tankA])).toBe(false);
  });

  it('ignores a taunt with no recorded source', () => {
    const foe = taunted(eff(AfflictionType.Taunt, { magnitude: 9 }));
    expect(activeTaunt(foe, [foe, tankA])).toBeNull();
  });
});

// ─── Area taunt content ───────────────────────────────────────────────────────

describe('the summon taunt is actually pressable', () => {
  // Summons are built with maxMana: 0 and skill use is gated on mana, so a
  // costed taunt on the Stone Elemental would be a button that never works
  it('costs no mana and is limited by cooldown instead', () => {
    expect(groundSlam.manaCost).toBe(0);
    expect(groundSlam.cooldown).toBeGreaterThan(0);
  });

  it('taunts an area rather than one target', () => {
    expect(groundSlam.aoeRadius).toBeGreaterThan(0);
    expect(skillEffects(groundSlam)[0].type).toBe(AfflictionType.Taunt);
  });

  it('shouts more quietly than a focused single-target taunt', () => {
    expect(skillEffects(groundSlam)[0].magnitude).toBeLessThan(skillEffects(challenge)[0].magnitude);
  });

  it('is castable by a zero-mana summon', () => {
    const elemental = unit('golem', { currentMana: 0, stats: { ...unit('x').stats, maxMana: 0 } });
    expect(canUseSkill(elemental, groundSlam)).toBe(true);
    expect(canUseSkill(elemental, challenge as HeroSkill)).toBe(false);
  });
});

// ─── Store integration ────────────────────────────────────────────────────────

describe('store: barrier, stacking and overrides', () => {
  const hero = unit('hero', { isPlayer: true, heroId: 'h1' });
  const foe  = unit('foe', { position: at(0, -2) });

  beforeEach(() => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([hero], [foe]);
  });

  const heroNow = () => useCombatStore.getState().units.find((u) => u.id === 'hero')!;
  const effectOn = (type: ActiveEffect['type']) =>
    heroNow().activeEffects.find((e) => e.type === type);

  it('spends a barrier before HP and reports what it ate', () => {
    const store = useCombatStore.getState();
    store.applyEffect('hero', eff(AuraType.Barrier, { magnitude: 12, duration: -1 }));

    const first = store.damageUnit('hero', 5);
    expect(first).toEqual({ hpLost: 0, absorbed: 5, shieldedBy: 'magic' });
    expect(heroNow().currentHp).toBe(60);
    expect(effectOn(AuraType.Barrier)?.magnitude).toBe(7);

    const second = store.damageUnit('hero', 10);
    // The blow that empties it is heard as the shield giving way
    expect(second).toEqual({ hpLost: 3, absorbed: 7, shieldedBy: 'magic', shieldBroke: true });
    expect(heroNow().currentHp).toBe(57);
    expect(effectOn(AuraType.Barrier)).toBeUndefined();
  });

  it('reports a plain hit when there is no barrier', () => {
    expect(useCombatStore.getState().damageUnit('hero', 10)).toEqual({ hpLost: 10, absorbed: 0 });
  });

  it('caps hpLost at the HP actually remaining', () => {
    const store = useCombatStore.getState();
    store.damageUnit('hero', 500);
    expect(store.damageUnit('hero', 500)).toEqual({ hpLost: 0, absorbed: 0 });
  });

  // A barrier that stopped skills but not poison is a hole nobody notices until
  // a fight is lost to it
  // Undefended, so the tick's own defence share (`dotDefenceFactor`) stays out of the sums
  const undefended = () => useCombatStore.setState((s) => ({
    units: s.units.map((u) => (u.id === 'hero' ? { ...u, stats: { ...u.stats, defense: 0, magicDefense: 0 } } : u)),
  }));

  it('soaks damage-over-time too', () => {
    undefended();
    const store = useCombatStore.getState();
    store.applyEffect('hero', eff(AuraType.Barrier, { magnitude: 4, duration: -1 }));
    store.applyEffect('hero', eff(AfflictionType.Burn, { magnitude: 10, duration: 3 }));
    store.tickEffectsOnUnit('hero');
    expect(heroNow().currentHp).toBe(54);
    expect(effectOn(AuraType.Barrier)).toBeUndefined();
  });

  it('ticks Burn as damage like poison and bleed', () => {
    undefended();
    const store = useCombatStore.getState();
    store.applyEffect('hero', eff(AfflictionType.Burn, { magnitude: 6, duration: 2 }));
    const events = store.tickEffectsOnUnit('hero');
    expect(heroNow().currentHp).toBe(54);
    expect(events.some((e) => e.text === '-6')).toBe(true);
  });

  describe('a unit a tick killed stays dead', () => {
    const regen = eff(AuraType.HealOverTime, { magnitude: 15, sourceUnitId: 'hero' });
    const burn = eff(AfflictionType.Burn, { magnitude: 40 });
    const sleep = eff(AuraType.Slumber, { duration: 1, sourceUnitId: 'hero' });
    /** Set directly, because the order they are listed in is what is under test. */
    const carrying = (...activeEffects: ActiveEffect[]) => {
      undefended();
      useCombatStore.setState((s) => ({
        units: s.units.map((u) => (u.id === 'hero' ? { ...u, currentHp: 5, activeEffects } : u)),
      }));
    };

    it.each([
      ['the Burn listed first', [burn, regen]],
      ['the Regen listed first', [regen, burn]],
    ])('under a Regen, with %s', (_, effects) => {
      carrying(...effects);
      useCombatStore.getState().tickEffectsOnUnit('hero');
      expect(heroNow().currentHp).toBe(0);
    });

    it('and a Regen on a corpse floats nothing and credits no healing', () => {
      carrying(burn, regen);
      const events = useCombatStore.getState().tickEffectsOnUnit('hero');
      expect(events.some((e) => e.text === '+15')).toBe(false);
      expect(useCombatStore.getState().fightStats.hero?.healingDone ?? 0).toBe(0);
    });

    it('and a Winter Sleep ending does not wake it', () => {
      carrying(burn, sleep);
      useCombatStore.getState().tickEffectsOnUnit('hero');
      expect(heroNow().currentHp).toBe(0);
    });

    it('though a sleeper woken first meets the Burn at full health, and is no corpse', () => {
      carrying(sleep, burn);
      useCombatStore.getState().tickEffectsOnUnit('hero');
      expect(heroNow().currentHp).toBeGreaterThan(0);
    });

    it('while a Regen on a unit the Burn did not kill still lands, in either order', () => {
      const light = eff(AfflictionType.Burn, { magnitude: 2 });
      carrying(light, regen);
      useCombatStore.getState().tickEffectsOnUnit('hero');
      expect(heroNow().currentHp).toBe(18);
      carrying(regen, light);
      useCombatStore.getState().tickEffectsOnUnit('hero');
      expect(heroNow().currentHp).toBe(18);
    });
  });

  it('stacks Burn instead of refreshing it', () => {
    const store = useCombatStore.getState();
    store.applyEffect('hero', eff(AfflictionType.Burn, { magnitude: 5, duration: 3 }));
    store.applyEffect('hero', eff(AfflictionType.Burn, { magnitude: 4, duration: 2 }));
    expect(effectOn(AfflictionType.Burn)).toMatchObject({ magnitude: 9, duration: 3 });
  });

  it('caps stacked Burn', () => {
    const store = useCombatStore.getState();
    for (let i = 0; i < 20; i++) {
      store.applyEffect('hero', eff(AfflictionType.Burn, { magnitude: 5, duration: 3 }));
    }
    expect(effectOn(AfflictionType.Burn)!.magnitude).toBe(BALANCE.MAX_BURN_MAGNITUDE);
  });

  it('turns a second Chill into a Freeze', () => {
    const store = useCombatStore.getState();
    store.applyEffect('hero', eff(AfflictionType.Chill, { magnitude: 3 }));
    expect(effectOn(AfflictionType.Chill)).toBeDefined();

    store.applyEffect('hero', eff(AfflictionType.Chill, { magnitude: 3 }));
    expect(effectOn(AfflictionType.Chill)).toBeUndefined();
    expect(effectOn(AfflictionType.Freeze)).toBeDefined();
  });

  // find-by-type used to pin an effect to whoever applied it first, so a second
  // tank taunting the same enemy silently did nothing
  it('lets a louder taunt take over the source', () => {
    const store = useCombatStore.getState();
    store.applyEffect('foe', eff(AfflictionType.Taunt, { magnitude: 1, sourceUnitId: 'a' }));
    store.applyEffect('foe', eff(AfflictionType.Taunt, { magnitude: 5, sourceUnitId: 'b' }));
    const taunt = useCombatStore.getState().units
      .find((u) => u.id === 'foe')!
      .activeEffects.find((e) => e.type === AfflictionType.Taunt);
    expect(taunt?.sourceUnitId).toBe('b');
    expect(taunt?.magnitude).toBe(5);
  });

  it('keeps the stronger effect when a weaker one is re-applied', () => {
    const store = useCombatStore.getState();
    store.applyEffect('hero', eff(AuraType.DefenseBuff, { magnitude: 8, duration: 2 }));
    store.applyEffect('hero', eff(AuraType.DefenseBuff, { magnitude: 3, duration: 5 }));
    expect(effectOn(AuraType.DefenseBuff)).toMatchObject({ magnitude: 8, duration: 5 });
  });

  it('stamps recency so taunt ties resolve the same way twice', () => {
    const store = useCombatStore.getState();
    store.applyEffect('hero', eff(AuraType.Thorns, { magnitude: 0.2 }));
    store.applyEffect('foe', eff(AfflictionType.Root));
    const heroStamp = effectOn(AuraType.Thorns)!.appliedAt!;
    const foeStamp = useCombatStore.getState().units
      .find((u) => u.id === 'foe')!
      .activeEffects.find((e) => e.type === AfflictionType.Root)!.appliedAt!;
    expect(foeStamp).toBeGreaterThan(heroStamp);
  });

  it('still blocks every new affliction under DebuffImmunity', () => {
    const store = useCombatStore.getState();
    store.applyEffect('hero', eff(AuraType.DebuffImmunity, { duration: -1 }));
    for (const type of Object.values(AfflictionType)) {
      store.applyEffect('hero', eff(type, { magnitude: 3, sourceUnitId: 'foe' }));
    }
    expect(heroNow().activeEffects.filter((e) => isAffliction(e.type))).toEqual([]);
  });

  it('cleanses every new affliction and no aura', () => {
    const store = useCombatStore.getState();
    store.applyEffect('hero', eff(AfflictionType.Root));
    store.applyEffect('hero', eff(AfflictionType.Mark, { sourceUnitId: 'foe' }));
    store.applyEffect('hero', eff(AuraType.Thorns, { magnitude: 0.2 }));
    store.removeAllAfflictions('hero');
    expect(heroNow().activeEffects.map((e) => e.type)).toEqual([AuraType.Thorns]);
  });
});
