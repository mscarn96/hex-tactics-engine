import { spyDice } from '../support/dice';
import {
  PASSIVE_DEFS,
  hasPassive,
  isImmuneTo,
  isImmuneToPush,
  passiveStatMods,
  piercesImmunity,
  resolvePassives,
  survivesLethal,
} from '@/systems/combat/passives';
import {
  applyOnHitStatuses,
  applyOnTurnStart,
  applySkillStatus,
} from '@/systems/combat/combatEvents';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { resolvePush } from '@/systems/combat/forcedMovement';
import { refundedCooldowns } from '@/systems/combat/cooldowns';
import { useCombatStore } from '@/stores/combatStore';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { slash } from '@/data/skills/skillData';
import {
  ActiveEffect,
  AfflictionType,
  AuraType,
  CombatUnit,
  HeroSkill,
  HexCoord,
  PassiveId,
} from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { makeStats, makeUnit } from '../support/fixtures';
import { skillEffects } from '@/systems/combat/statusEffects';
import { requireUnit } from '@/systems/combat/unitLookup';
import { passiveName, passiveDescription } from '@/systems/combat/passives';

const at = (q: number, r: number): HexCoord => ({ q, r });
const eff = (type: ActiveEffect['type'], over: Partial<ActiveEffect> = {}): ActiveEffect => ({
  type,
  magnitude: 1,
  duration: 3,
  ...over,
});

const unit = (id: string, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ id, isPlayer: false, stats: makeStats({ defense: 10, moveRange: 2, maxMana: 20 }), ...over });

const withPassive = (id: PassiveId, over: Partial<CombatUnit> = {}) =>
  unit('p', { passives: [id], ...over });

const hpOf = (id: string) => requireUnit(useCombatStore.getState().units, id).currentHp;
const unitNow = (id: string) => requireUnit(useCombatStore.getState().units, id);

// ─── Vocabulary discipline ────────────────────────────────────────────────────

describe('the passive vocabulary', () => {
  /**
   * Twelve trees of bespoke passives would dwarf the rest of the overhaul, and
   * character is meant to come from which passives a tree *combines*.
   *
   * The number went 41 → 42 with the Stormcaller's Overload, which replaced a flat
   * crit node with a rule about a whole cast: it reads how many already-Shocked
   * enemies one cast struck (a new `onCast` event, because no per-hit trigger sees
   * the cast) and primes the next single-target lightning bolt once.
   *
   * The number went 37 → 41 with the Hydromancer control-to-damage nodes, which
   * replaced four flat-stat nodes (Shatterpoint, Meltwater, Deep Cold, Killing
   * Frost) with a rule each: extra damage on the blow that breaks a Freeze, a
   * Barrier when a Freeze lands, a longer Chill from beyond one hex, and magic
   * penetration against a Chilled enemy. Each reads different state (a spent
   * Freeze, a Freeze landing, the distance of a Chill, a target's Chill and the
   * hit's type), so none is a magnitude variant of another.
   *
   * The number went 32 → 37 with the Berserker and Pyromancer Bleed / Burn
   * decisions, which replaced five flat-stat nodes (Savage Edge, Killing Eye,
   * Firemind, Spark, Detonation) with a rule each: a once-a-turn Bleed tick on a
   * crit, a crit chance that exists only against a Bleeding target, a mana
   * discount for spending a deep Burn pile, a Burn stack that jumps when its
   * carrier dies, and ground left burning by a detonation. Each reads a different
   * piece of state (a crit, a target status, a stack count, a death, a Burn being
   * spent), so none is a magnitude variant of another.
   *
   * The number went 29 → 32 with the Stoneshaper ground-response nodes, which
   * replaced three flat-stat nodes (Stonecutter, Unyielding, Seismic Sense) with
   * a rule each: a Root-gated armour crack on earth hits, a defence that tracks a
   * standing Barrier, and a move extension keyed to a warned footprint. Each
   * reads a different piece of state, so none is a magnitude variant of another.
   *
   * The number went 26 → 29 with the mastery answers pass, which replaced three
   * flat-stat nodes (Set Stance, Oath, Zeal) with a rule each: a first-hit
   * stance, a ward after a heal that did something, and a Mercy / Wrath choice.
   * None differs from an existing passive by magnitude; each is a new gate.
   *
   * The number went 17 → 26 with the v3 tree rework, which gave each of the
   * twelve paths two side trees and a unique non-upgradeable passive to start
   * each one. That is nine genuinely new ideas rather than nine restatements,
   * and it is the ceiling: a side tree opens on a capstone and there are two
   * per path, so the shape of the trees cannot ask for more.
   *
   * **The cap is a shape, not a number.** What it forbids is a passive that
   * differs from an existing one only by magnitude — node levels scale those
   * now, so a "bigger Frenzy" is a third level of Frenzy and not a definition.
   * The free-turn passives are the worked example: `frenzy`, `thunderhead` and
   * `shatterstep` all hand back an action and all are legitimate, because they
   * differ by *what they ask for* — a kill, a kill and a roll, a shattered Freeze.
   */
  it('stays capped at a small shared set', () => {
    // 43: the Emerald Dragon's Rising Fire, a boss-only passive that is a rule about his turn
    // count and cannot be a second level of any other
    // 47: the four elites' own — Winter Sleep, Soul Fracture, Pain Feast and Captain's Authority.
    // Each is a rule about one unit (a lethal save into a sleep, a lethal save into fragments, a
    // counter fed by every blow, an aura that must be laid on others) and none can be a second
    // level of a shared passive, which is the test of whether this vocabulary has grown
    // 50: Twin Fangs, the Hydromancer's Signature node. Like Zeal it is a rule about one
    // skill (Frostbite strikes twice) rather than a level of anything shared
    // 51: Fuel the Flame, the Pyromancer's Signature node: a rule about one skill (Ignite on a
    // burning enemy lays an extra stack), replacing a flat-stat node rather than restating a passive
    // 54: the Lifewarden remaster's Shared Bloom (a rule about Lifebloom, like Zeal), Second
    // Spring (a heal reading the ally's wound, which nothing shared does) and Cycle of Life
    // (charges banked per healing cast and spent by a spell)
    // 56: the Marksman remaster retired Follow-Through's free turn and added three
    // positional rules (Mark and Move, Escape Route, Settle In), each a rule about
    // where the Marksman stands rather than a level of a shared passive
    // 57: Conductive Arc, the Stormcaller's Signature node: a rule about one skill (Arc's
    // Shock jump carries more), replacing a flat-stat node (Quickened)
    // 59: the Stoneshaper remaster's Aftershock (a rule about Tremor), Rubble Recovery (a heal
    // on a broken Barrier, read in the Barrier funnel) and Crumble, which replaced Stonecutter
    // 62: the Skirmisher remaster's Fan of Blades (a rule about Blade Recall, like Twin Fangs),
    // Slipstream (a step after a damaging cast) and Sharpened Steel (an opening hit at full health),
    // each replacing a flat-stat node rather than restating a shared passive
    // 64: the Berserker remaster's Blood Rush (a rule about Bloodthirst, like Zeal) and
    // Undying (Last Breath's save with a two-turn HP floor; `lastBreath` stays for the
    // Bog Hulk, as the plain `undying` stays for its carriers)
    // 65: the Shadowblade remaster's Shadow Echo (a rule about Shadowstep, replacing a flat-stat
    // node) and Venom Transfer, which replaced Rot one for one
    // +3: the Mantis's Bleeding Blades (the Basic Attack's Bleed), Reaping Momentum (a rule
    // about Twin Reap, like Twin Fangs) and Predator's Breath (a rule about Meditate) — a new
    // class's path, so nothing to replace; counted from the 64 standing when it landed
    // +3: the Firefly's Brighter Motes (a rule about Glowmote's mote, like Zeal), Lantern Breath
    // (a rule about Meditate's payout) and Afterglow (a buff on whoever a heal reached —
    // Barkskin's shape, but Attack and Magic and never the healer)
    // +3: the Beetle's Shell Breath (a rule about Meditate), Hardened Shell (a rule about Iron
    // Carapace and its soak, like Twin Fangs) and Shoulder to Shoulder (a share off blows taken
    // beside the Beetle, read in the damage funnel) — likewise nothing to replace
    // +5: the Beetle's side trees. Second Watch (two Reactions, a rule nothing else
    // states), Retribution (a strike back for a blow taken or split, read where it lands),
    // Numbing Staff (the Basic Attack's Attack and Magic Down, Bleeding Blades' shape with
    // a different wound), Heavy Hands (a rule about two skills, like Hardened Shell) and
    // Planted Guard (both defences while unmoved — Grounded Focus's condition, a different
    // gift). Lasting Shell needed none: it is the shared shield bonus
    // +4: the Firefly's side trees — Far Light and Twin Motes (one-rank rules about named
    // skills, which `skillRangeBonus` and the mote's own fields cannot scope), Steady Flame
    // (chi back once a healing cast) and Second Light (a Barrier on a heal across half health)
    // +3: the Mantis's side trees — Bleed Harvest (a rule about Twin Reap's reap, a one-rank
    // starter), Fresh Kill (chi on a kill: Bloodscent's shape, but the pool a Monk spends)
    // and Evasive Weave (Dodge laid by a move, Momentum's shape for the other roll). Its
    // other three side nodes are modifiers, not passives
    // +1: the Yokai's Tanuki's Trick (Stealth laid by a hit taken; nothing shared lays a status
    // on its owner when struck)
    // Advanced (level 21–25): Monk
    // +3: Shell Ward (a Barrier laid on the Beetle's neighbours each turn; Meltwater's Barrier
    // on a different trigger and reach), Searing Light (Glowmote's Defense Down, Numbing Staff's
    // shape on a named skill) and Reaping Stride (Slipstream's step, scoped to Twin Reap and
    // capped once a turn). The other six Monk advanced nodes reuse passives, stats or modifiers
    // Advanced (level 21–25): Champion +2 — Rallying Taunt (Defense to allies near a landed
    // Taunt) and Red Mist (critical chance at half health or below)
    // Advanced (level 21–25): Hunter +3 — Eagle Eye (crit at your own Mark), Open Seams (crit at
    // your own blades) and Unseen Blade (crit while Stealthed)
    // Jadeveil: Silk Hollow / Yokai +2 — the Nue's Thundercloud and Serpent Tail, enemy-only like the
    // elites' own (read at its turn start by the Yokai script)
    // PT-22 +1 — the Frost Mote's Shatter, which states its death burst on the unit card
    // Advanced (level 26): Monk +3 — Returned Blow (a strike back for the Beetle's own soak),
    // Spilled Light (a rule about Glowmote's mote) and Reaper's Breath (chi on Twin Reap's reap)
    // +1: Stone's Answer, the Stoneshaper's level-26 node: a rule about the Barrier breaking
    // on the enemy that broke it, which is no level of Rubble Recovery's heal
    // Level 26: Arcanist +1 — Flying Shards (a once-a-turn volley off a broken Freeze; nothing
    // shared strikes the enemies around the blow). Brimming Over and Forked Current are modifiers
    // Advanced (level 26): Hunter +2 — Next Quarry (a Mark passes on a death) and Into the Dark
    // (Shadowstep's cooldown on a kill); Buried Steel is a modifier
    expect(Object.keys(PASSIVE_DEFS).length).toBeLessThanOrEqual(86 + 3 + 2 + 3 + 2 + 1 + 3 + 1 + 1 + 2);
  });

  it('keeps every definition keyed by its own id', () => {
    for (const [key, def] of Object.entries(PASSIVE_DEFS)) {
      expect(def.id).toBe(key);
    }
  });

  it('gives every definition a name and a description a player could read', () => {
    for (const def of Object.values(PASSIVE_DEFS)) {
      expect(passiveName(def.id).length).toBeGreaterThan(0);
      expect(passiveDescription(def.id).length).toBeGreaterThan(10);
    }
  });

  it('covers every event trigger with at least one passive', () => {
    const triggers = new Set(Object.values(PASSIVE_DEFS).map((d) => d.trigger));
    for (const t of ['onKill', 'onDamaged', 'onTurnStart', 'onMove', 'onHeal', 'onTauntApplied']) {
      expect(triggers).toContain(t);
    }
  });

  // An event passive without a resolver is a node that does nothing at all
  it('gives every event passive something to do', () => {
    for (const def of Object.values(PASSIVE_DEFS)) {
      if (def.trigger === 'statMod') continue;
      expect(typeof def.resolve).toBe('function');
    }
  });

  it('reports what a unit carries', () => {
    expect(hasPassive(withPassive('wrath'), 'wrath')).toBe(true);
    expect(hasPassive(withPassive('wrath'), 'frenzy')).toBe(false);
    expect(hasPassive(unit('none'), 'wrath')).toBe(false);
  });

  it('resolves nothing for a unit with no passives', () => {
    expect(resolvePassives('onKill', { self: unit('u'), allUnits: [] })).toEqual([]);
    expect(passiveStatMods(unit('u'))).toEqual({});
  });
});

// ─── statMod ──────────────────────────────────────────────────────────────────

describe('statMod passives', () => {
  /**
   * The middle rung, which is what a unit with no tree behind it resolves at —
   * every enemy, every summon and every fixture here. Wrath is one of two
   * passives whose middle is *not* what it shipped at: the ladder runs
   * 16 / 12 / 8 percent of health missing per point of attack, so 12 is the
   * baseline now and the old 8 is what full investment buys.
   */
  it('gives Wrath attack as health drains', () => {
    expect(passiveStatMods(withPassive('wrath')).attack).toBe(0);
    expect(passiveStatMods(withPassive('wrath', { currentHp: 50 })).attack).toBe(4);
    expect(passiveStatMods(withPassive('wrath', { currentHp: 1 })).attack).toBe(8);
  });

  /**
   * The rung is what moves it, and the ladder is inverse — a *higher* rank is a
   * smaller threshold. Pinned across all three because the direction is the
   * thing that would be got wrong, and a single-rung check cannot see it.
   */
  it('sharpens Wrath as its node is raised', () => {
    const atRank = (level: number) =>
      passiveStatMods(
        withPassive('wrath', {
          currentHp: 1,
          passiveRanks: { wrath: { level, scale: 1 } },
        }),
      ).attack;

    expect(atRank(1)).toBe(6);
    expect(atRank(2)).toBe(8);
    expect(atRank(3)).toBe(12);
  });

  it('folds Wrath into effective stats rather than raw ones', () => {
    const wounded = withPassive('wrath', { currentHp: 50 });
    expect(wounded.stats.attack).toBe(20);
    expect(getCombatEffectiveStats(wounded).attack).toBe(24);
  });

  it('stacks a passive on top of an aura', () => {
    const wounded = withPassive('wrath', {
      currentHp: 50,
      activeEffects: [eff(AuraType.AttackBuff, { magnitude: 4 })],
    });
    expect(getCombatEffectiveStats(wounded).attack).toBe(28);
  });

  // The remaster (2026-10) made Last Stand a damage reduction, not a defence
  // bonus: see bulwarkRemaster.test.ts
  it('gives Last Stand no defence stat, even below the threshold', () => {
    expect(passiveStatMods(withPassive('lastStand', { currentHp: 20 })).defense).toBeUndefined();
    expect(passiveStatMods(withPassive('lastStand', { currentHp: 20 })).magicDefense).toBeUndefined();
  });

  it('sums two statMod passives on the same unit', () => {
    const both = unit('p', {
      passives: ['wrath', 'unyielding'], currentHp: 20,
      activeEffects: [eff(AuraType.Barrier, { magnitude: 10 })],
    });
    const mods = passiveStatMods(both);
    expect(mods.attack).toBe(6);
    expect(mods.defense).toBe(BALANCE.UNYIELDING_DEFENSE);
  });
});

// ─── Immunities ───────────────────────────────────────────────────────────────

describe('immunity passives', () => {
  it('refuses the listed statuses', () => {
    const unstoppable = withPassive('unstoppable');
    expect(isImmuneTo(unstoppable, AfflictionType.Root)).toBe(true);
    expect(isImmuneTo(unstoppable, AfflictionType.Chill)).toBe(true);
    expect(isImmuneTo(unstoppable, AfflictionType.Stun)).toBe(false);
  });

  it('blocks the status at the store, not just in a query', () => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([withPassive('unstoppable', { isPlayer: true })], []);
    useCombatStore.getState().applyEffect('p', eff(AfflictionType.Root));
    expect(unitNow('p').activeEffects).toEqual([]);
  });

  it('lets an unrelated status through', () => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([withPassive('unstoppable', { isPlayer: true })], []);
    useCombatStore.getState().applyEffect('p', eff(AfflictionType.Stun));
    expect(unitNow('p').activeEffects).toHaveLength(1);
  });

  it('makes Immovable proof against knockback', () => {
    const rock = withPassive('immovable', { position: at(0, 0) });
    const ordinary = unit('o', { position: at(0, 0) });
    expect(isImmuneToPush(rock)).toBe(true);
    expect(resolvePush(at(0, -2), rock, 2, [rock])).toBeNull();
    expect(resolvePush(at(0, -2), ordinary, 2, [ordinary])).not.toBeNull();
  });
});

// ─── Undying ──────────────────────────────────────────────────────────────────

describe('undying', () => {
  const doomed = () => withPassive('undying', { isPlayer: true, currentHp: 10 });

  it('catches a lethal hit and nothing less', () => {
    expect(survivesLethal(doomed(), 10)).toBe(true);
    expect(survivesLethal(doomed(), 500)).toBe(true);
    expect(survivesLethal(doomed(), 9)).toBe(false);
    expect(survivesLethal(unit('u', { currentHp: 10 }), 500)).toBe(false);
  });

  it('leaves the unit at 1 HP instead of dead', () => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([doomed()], []);
    useCombatStore.getState().damageUnit('p', 999);
    expect(hpOf('p')).toBe(1);
  });

  it('only fires once per battle', () => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([doomed()], []);
    const store = useCombatStore.getState();
    store.damageUnit('p', 999);
    expect(hpOf('p')).toBe(1);
    store.damageUnit('p', 999);
    expect(hpOf('p')).toBe(0);
  });

  // A save that only caught skill damage would let a burning hero die to the
  // burn with it still unspent, which reads as the passive being broken
  it('catches a lethal damage-over-time tick too', () => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([doomed()], []);
    const store = useCombatStore.getState();
    store.applyEffect('p', eff(AfflictionType.Burn, { magnitude: 50, duration: 3 }));
    store.tickEffectsOnUnit('p');
    expect(hpOf('p')).toBe(1);
  });

  it('cannot be spent twice by two afflictions in one tick', () => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([doomed()], []);
    const store = useCombatStore.getState();
    store.applyEffect('p', eff(AfflictionType.Burn, { magnitude: 50, duration: 3 }));
    store.applyEffect('p', eff(AfflictionType.Bleed, { magnitude: 50, duration: 3 }));
    store.tickEffectsOnUnit('p');
    expect(hpOf('p')).toBe(0);
  });

  it('resets for the next fight', () => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([doomed()], []);
    useCombatStore.getState().damageUnit('p', 999);
    useCombatStore.getState().initCombat([doomed()], []);
    useCombatStore.getState().damageUnit('p', 999);
    expect(hpOf('p')).toBe(1);
  });
});

// ─── Event passives through the store ─────────────────────────────────────────

describe('event passives', () => {
  const foe = unit('foe', { position: at(0, -1) });

  const setup = (hero: CombatUnit, enemies: CombatUnit[] = [foe]) => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([{ ...hero, isPlayer: true }], enemies);
  };

  it('heals the killer with Bloodscent', () => {
    const hunter = withPassive('bloodscent', { currentHp: 50 });
    setup(hunter, [{ ...foe, currentHp: 1 }]);
    useCombatStore.getState().damageUnit('foe', 50);
    applyOnHitStatuses(unitNow('p'), unitNow('foe'), 50, undefined, 1);
    expect(hpOf('p')).toBe(65);
  });

  it('does not fire onKill when the target lived', () => {
    const hunter = withPassive('bloodscent', { currentHp: 50 });
    setup(hunter);
    applyOnHitStatuses(unitNow('p'), unitNow('foe'), 10, undefined, 100);
    expect(hpOf('p')).toBe(50);
  });

  it('grants an extra action with Frenzy on a kill', () => {
    const berserk = withPassive('frenzy');
    setup(berserk, [{ ...foe, currentHp: 1 }]);
    useCombatStore.getState().damageUnit('foe', 50);
    const result = applyOnHitStatuses(unitNow('p'), unitNow('foe'), 50, undefined, 1);
    expect(result.extraAction).toBe(true);
  });

  it('grants no extra action without a kill', () => {
    const berserk = withPassive('frenzy');
    setup(berserk);
    expect(applyOnHitStatuses(unitNow('p'), unitNow('foe'), 10, undefined, 100).extraAction).toBe(
      false
    );
  });

  it('reflects with Retaliation when hit', () => {
    setup(withPassive('retaliation'));
    applyOnHitStatuses(unitNow('foe'), unitNow('p'), 20);
    expect(hpOf('foe')).toBe(97);
  });

  // Nothing reached the target, so nothing bounces
  it('reflects nothing off a fully absorbed hit', () => {
    setup(withPassive('retaliation'));
    applyOnHitStatuses(unitNow('foe'), unitNow('p'), 0);
    expect(hpOf('foe')).toBe(100);
  });

  // 3% of a 100 HP pool. Was 8%, which on a boss is not a heal but a ceiling on
  // how long the fight may last — see `lairBosses.test.ts`, where the Warren's
  // boss sat the wrong side of it and could not be killed at all.
  it('regenerates at the start of the turn', () => {
    setup(withPassive('regeneration', { currentHp: 40 }));
    applyOnTurnStart(unitNow('p'));
    expect(hpOf('p')).toBe(43);
  });

  it('does not regenerate past full', () => {
    setup(withPassive('regeneration'));
    applyOnTurnStart(unitNow('p'));
    expect(hpOf('p')).toBe(100);
  });

  describe('while taunting', () => {
    const tank = (id: PassiveId, ranks?: CombatUnit['passiveRanks']) =>
      withPassive(id, { id: 'p', ...(ranks ? { passiveRanks: ranks } : {}) });
    const taunted = { ...foe, activeEffects: [eff(AfflictionType.Taunt, { sourceUnitId: 'p' })] };

    it('Braced stacks defence per hit, up to its ceiling', () => {
      setup(tank('braced'), [taunted]);
      for (let i = 0; i < 10; i++) {
        applyOnHitStatuses(unitNow('foe'), unitNow('p'), 5);
      }
      const buff = unitNow('p').activeEffects.find((e) => e.type === AuraType.DefenseBuff);
      expect(buff?.magnitude).toBe(BALANCE.BRACED_MAX);
    });

    it('Braced does nothing when nobody is taunted', () => {
      setup(tank('braced'), [foe]);
      applyOnHitStatuses(unitNow('foe'), unitNow('p'), 5);
      expect(unitNow('p').activeEffects.find((e) => e.type === AuraType.DefenseBuff)).toBeUndefined();
    });

    /**
     * The refund is a whole turn and cannot be fractioned, so the node's rungs buy
     * *odds* — 25% / 50% / 75% since the remaster. The roll is pinned to succeed,
     * because no rung is certain any more.
     */
    it('Vengeance brings a cooldown back a turn early when its roll succeeds', () => {
      setup(tank('vengeance', { vengeance: { level: 3, scale: 1.25 } }), [taunted]);
      useCombatStore.getState().startCooldown('p', { ...slash, cooldown: 3 });
      const before = unitNow('p').cooldowns!.slash;
      const random = spyDice().mockReturnValue(0);
      applyOnHitStatuses(unitNow('foe'), unitNow('p'), 5);
      random.mockRestore();
      expect(unitNow('p').cooldowns!.slash).toBe(before - 1);
    });

    /** And that every rung really is a roll, pinned rather than sampled. */
    it('Vengeance is a roll at every rank', () => {
      for (const [level, scale, chance] of [[1, 0.75, 0.25], [2, 1, 0.5], [3, 1.25, 0.75]] as const) {
        const self = tank('vengeance', { vengeance: { level, scale } });
        const ctx = { self, allUnits: [self, taunted], other: taunted, amount: 5 };
        expect(resolvePassives('onDamaged', { ...ctx, rng: () => chance - 0.01 })).toHaveLength(1);
        expect(resolvePassives('onDamaged', { ...ctx, rng: () => chance + 0.01 })).toEqual([]);
      }
    });
  });

  describe('onTauntApplied', () => {
    it('shreds the attack of an enemy it taunts', () => {
      setup(withPassive('intimidating'));
      applySkillStatus(unitNow('p'), 'foe', {
        type: AfflictionType.Taunt,
        magnitude: 2,
        duration: 2,
        sourceUnitId: 'p',
      });
      const shred = unitNow('foe').activeEffects.find((e) => e.type === AfflictionType.AttackDown);
      expect(shred?.magnitude).toBe(BALANCE.INTIMIDATING_SHRED);
    });

    // A free debuff from a button that did nothing would be strictly better
    // than the taunt landing
    it('does not shred when the taunt was shrugged off', () => {
      setup(withPassive('intimidating'), [
        { ...foe, activeEffects: [eff(AuraType.DebuffImmunity, { duration: -1 })] },
      ]);
      applySkillStatus(unitNow('p'), 'foe', {
        type: AfflictionType.Taunt,
        magnitude: 2,
        duration: 2,
        sourceUnitId: 'p',
      });
      expect(
        unitNow('foe').activeEffects.find((e) => e.type === AfflictionType.AttackDown)
      ).toBeUndefined();
    });

    it('does not fire for a status that is not a taunt', () => {
      setup(withPassive('intimidating'));
      applySkillStatus(unitNow('p'), 'foe', eff(AfflictionType.Poison, { sourceUnitId: 'p' }));
      expect(
        unitNow('foe').activeEffects.find((e) => e.type === AfflictionType.AttackDown)
      ).toBeUndefined();
    });
  });

  describe('Last Stand pierces immunity', () => {
    it('only while its owner is nearly dead', () => {
      expect(piercesImmunity(withPassive('lastStand'))).toBe(false);
      expect(piercesImmunity(withPassive('lastStand', { currentHp: 20 }))).toBe(true);
    });

    it('lands a taunt on a boss that would otherwise shrug it off', () => {
      setup(withPassive('lastStand', { currentHp: 20 }), [
        { ...foe, activeEffects: [eff(AuraType.DebuffImmunity, { duration: -1 })] },
      ]);
      useCombatStore.getState().applyEffect('foe', {
        type: AfflictionType.Taunt,
        magnitude: 2,
        duration: 2,
        sourceUnitId: 'p',
      });
      expect(
        unitNow('foe').activeEffects.some((e) => e.type === AfflictionType.Taunt)
      ).toBe(true);
    });
  });
});

// ─── Cooldown refunds ─────────────────────────────────────────────────────────

describe('refundedCooldowns', () => {
  it('brings every running cooldown forward', () => {
    expect(refundedCooldowns({ a: 4, b: 2 }, 1)).toEqual({ a: 3, b: 1 });
  });

  it('drops entries the refund finishes', () => {
    expect(refundedCooldowns({ a: 1 }, 1)).toEqual({});
    expect(refundedCooldowns({ a: 2 }, 5)).toEqual({});
  });

  it('returns the same object when there is nothing to refund', () => {
    const empty = {};
    expect(refundedCooldowns(empty, 1)).toBe(empty);
    expect(refundedCooldowns(undefined, 1)).toBeUndefined();
    const running = { a: 3 };
    expect(refundedCooldowns(running, 0)).toBe(running);
  });
});

// ─── Live content ─────────────────────────────────────────────────────────────

describe('the enemies that now carry passives', () => {
  const templateFor = (id: string) => enemyTemplates.find((t) => t.id === id)!;

  it('names only passives that exist', () => {
    for (const template of enemyTemplates) {
      for (const id of template.passives ?? []) {
        expect(PASSIVE_DEFS[id]).toBeDefined();
      }
    }
  });

  it('gives the troll nothing to heal with, and keeps it unslowable', () => {
    // Regeneration is gone for good: a percentage heal caps how long the fight can last
    // and is the opposite of a fight that ends in Fury. See `lairBosses.test.ts`.
    expect(templateFor('troll_chieftain').passives).toEqual(['unstoppable']);
  });

  it('puts a passive on every boss, or scripts its fight', () => {
    // Aethelred's passives are signature rules (`AETHELRED_PASSIVES`, run by
    // `bossScript`) rather than entries in the shared vocabulary
    for (const boss of enemyTemplates.filter((t) => t.tier === 'boss' && t.id !== 'aethelred')) {
      expect(boss.passives?.length ?? 0).toBeGreaterThan(0);
    }
    expect(templateFor('aethelred').passives ?? []).toEqual([]);
  });
});

describe('passives that require a condition the unit can reach', () => {
  /**
   * `braced` grants defence for being hit *while taunting*, so a unit with no
   * way to taunt carries a line of description text that can never fire — the
   * worst kind of bug, because the unit looks correct.
   */
  it('only gives Braced to something that can actually taunt', () => {
    const canTaunt = (skills: HeroSkill[]) =>
      skills.some((s) => skillEffects(s).some((e) => e.type === AfflictionType.Taunt));

    const useless = enemyTemplates
      .filter((t) => t.passives?.includes('braced'))
      .filter((t) => !canTaunt(t.skills))
      .map((t) => t.id);
    expect(useless).toEqual([]);
  });

  it('names only passives that exist', () => {
    const unknown = enemyTemplates.flatMap((t) =>
      (t.passives ?? []).filter((p) => !PASSIVE_DEFS[p]).map((p) => `${t.id}: ${p}`),
    );
    expect(unknown).toEqual([]);
  });
});
