import { ActiveEffect, AfflictionType, ArenaHazard, AuraType, CombatUnit, HexCoord, LegionScriptState, PreparedReaction, ReactionEvent, StatusEffectType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { aethelredTwist, legionOf, STANDARD_KIND } from '@/systems/combat/bossScript';
import { difficultyDamage } from '@/systems/combat/runDifficulty';
import { unitById } from '@/systems/combat/unitLookup';
import { combatMaxHp } from '@/systems/combat/forms';
import { destroyedOutcome, protectedDamage } from '@/systems/combat/objectives';
import {
  absorbWithBarrier,
  absorbWithReckoning,
  isHeldFromHarm,
  shatterBurst,
} from '@/systems/combat/statusEffects';
import {
  PassiveOutcome,
  UNDYING_SPENT_EFFECT,
  flooredHp,
  hasPassive,
  passiveName,
  lethalSaveOutcomes,
  reduceIncoming,
  survivesLethal,
} from '@/systems/combat/passives';
import { SOUL_FRAGMENT_KIND } from '@/systems/combat/eliteKits';
import { bastionCover, carapaceSoaks, shoulderReduction } from '@/systems/combat/beetle';
import { tallyMarkedPrey } from '@/systems/combat/mantis';
import { TOMB_KIND } from '@/systems/combat/factionEliteKits';
import { WEB_KIND } from '@/systems/combat/yokaiKits';
import { SHARD_KIND } from '@/systems/combat/kairenRules';
import { creditFightStats, eliteBeat, TickEvent, UnitFightStats } from '@/systems/combat/combatTypes';
import { saveIntent, supportIntent } from '@/systems/combat/soundIntents';
import { t } from '@/i18n';
import { skillName } from '@/data/gameText';

/**
 * Damage and death: the one funnel every hit, tick, reflection and expiry passes.
 *
 * Two halves, kept apart on purpose.
 *
 * **`takeDamage` is pure.** State in, a patch and a report out; it reads nothing
 * but its arguments and writes nothing. Every ordering rule that decides how
 * much a unit actually loses lives in it, in this order and no other: difficulty,
 * the objectives' share, Second Spring, **then** the ice's shatter, Last Stand,
 * the Reckoning, the Barrier, the lethal save and finally the HP write. A rule
 * that reads the number after another has touched it is a rule about that order,
 * and `damageFunnel.test.ts` pins each pair.
 *
 * **`damageUnit` and `resolveDeath` act on a host.** What follows a blow reaches
 * other units and other parts of the store — a phase change, a parting blast, a
 * Revenant breaking — so it needs the store's own operations. The host is that
 * store, passed in rather than imported (this module is imported *by* the store,
 * and the import-cycle rule forbids the reverse), narrowed to the operations the
 * funnel calls.
 */

// ─── The data the funnel reads and writes ─────────────────────────────────────

/** The store's data a blow touches. A strict subset of the combat state. */
export interface FunnelData {
  units: CombatUnit[];
  fightStats: Record<string, UnitFightStats>;
  reactions: PreparedReaction[];
  reactionEvents: ReactionEvent[];
  answeringReaction: boolean;
  /**
   * The arena's ground, read by `damageUnit` for a Bastion's split (Carapace
   * Bastion). Optional so the pure arithmetic's callers need not carry it.
   */
  hazards?: ArenaHazard[];
}

export interface DamageOptions {
  /** An objective's backlash, which the objectives' own protection does not soak. */
  bypassProtection?: boolean;
  /**
   * A restraint's backlash reaches the one it held up: the Jorōgumo's thread cut tears at her
   * while she still hangs (`AuraType.Suspended`). Nothing else that holds a unit from harm gives way.
   */
  throughSuspension?: boolean;
  /** The amount already carries the run difficulty (a strike's damage does). */
  difficultyApplied?: boolean;
  /** Who the damage is attributed to when it was not `attackerId`. */
  sourceUnitId?: string;
  /**
   * The damage is a clock running out, not a blow: a damage-over-time dose.
   *
   * It goes through the same Last Stand, Reckoning, Barrier and lethal-save
   * arithmetic as a strike, and none of the rest of what a blow does — the ice
   * does not shatter, a Freeze is not broken, objectives take no share, Second
   * Spring does not trim it. `creditTo` is the report row it is pooled under.
   */
  fromTick?: boolean;
  creditTo?: string;
}

/** What a blow did, as `damageUnit` reports it. */
export interface DamageResult {
  hpLost: number;
  absorbed: number;
  phaseEntered?: string;
  /**
   * Bonus damage this blow added because the target was frozen, when it was.
   *
   * The ice breaking is a distinct event from the strike that broke it, so it
   * is reported rather than folded silently into `hpLost`.
   */
  shatter?: number;
  /** Present when the blow killed something that goes off when it dies. */
  deathEvents?: TickEvent[];
  /**
   * What a Carapace Bastion's owner took of this blow in the struck ally's place,
   * before the ally's own share was dealt. Its number on the owner rides in
   * `deathEvents`; a caller that floats the blow's number subtracts this.
   */
  shared?: number;
  /** The Beetle that took `shared` (Retribution answers the attacker for it). */
  sharedBy?: string;
  /**
   * What took the blow, when something did — for the ear, which hears a shield
   * taking it apart from steel. `magic` is a Barrier or a Reckoning soaking it, or a
   * unit held from harm; `shell` a Beetle's full carapace.
   */
  shieldedBy?: 'magic' | 'shell';
  /** This blow emptied a Barrier that was standing. */
  shieldBroke?: true;
}

/** What the arithmetic found, beyond the HP it took. */
export interface DamageReport {
  hpLost: number;
  absorbed: number;
  shatter: number;
  /** The damage that reached HP before a lethal save or the floor held it up. */
  net: number;
  /** What took the blow (`DamageResult.shieldedBy`). */
  shieldedBy?: 'magic' | 'shell';
  /** A standing Barrier was emptied (`DamageResult.shieldBroke`). */
  shieldBroke?: true;
  /** The shared funnel's follow-ups, run by `settleDamage` once the write has landed. */
  follow: DamageFollow;
}

export interface DamageFollow {
  /** A lethal save fired, whatever it had to add. */
  saved: boolean;
  saveOutcomes: PassiveOutcome[];
  /** The blow that filled the Berserker's Rage. */
  rageFull: boolean;
  /** Whose Barrier an enemy blow just broke, for Rubble Recovery. */
  brokenBarrierOf?: string;
  /** Who broke it, for Stone's Answer. */
  brokenBarrierBy?: string;
  /** A Reckoning this blow broke, released once the write has landed. */
  reckoningBroken?: ActiveEffect;
  /** A full Carapace soaked this blow (Hardened Shell shields the carrier's neighbours). */
  carapaceSoaked?: boolean;
  /** The Tanuki was struck and slipped into Stealth. */
  tricked?: boolean;
}

export const NO_FOLLOW: DamageFollow = { saved: false, saveOutcomes: [], rageFull: false };

// ─── The arithmetic ───────────────────────────────────────────────────────────

/**
 * What `amount` of damage does to one unit, and the state that results.
 *
 * Pure: `state` is not modified, and the patch is the only thing written. A unit
 * that is held from harm (Invulnerable, or a Revenant lying broken between its
 * lives) takes nothing and the report is empty.
 */
export function takeDamage(
  state: FunnelData,
  unitId: string,
  amount: number,
  attackerId?: string,
  options: DamageOptions = {},
): { patch: Partial<FunnelData>; report: DamageReport } {
  // Standard strikes already carry the modifier from damageCalc. Fixed damage,
  // reflection and hazards enter here unscaled; self-costs have no hostile source.
  const sourceId = options.sourceUnitId ?? attackerId;
  if (!options.difficultyApplied && sourceId !== unitId) {
    amount = difficultyDamage(amount, unitById(state.units, sourceId));
  }
  // Standing objectives soak a share of what their owner takes — read before
  // the barrier and the phase check so every source of damage sees one number.
  const owner = unitById(state.units, unitId);
  if (owner && !options.bypassProtection && !options.fromTick) {
    amount = protectedDamage(owner, state.units, amount);
  }
  // Second Spring: a share off everything that comes through this funnel, before the
  // barrier, so a shield and the reduction never both claim the same points.
  const spring = sourceId !== unitId && !options.fromTick
    ? owner?.activeEffects.find((e) => e.type === AuraType.SecondSpring)
    : undefined;
  if (spring && amount > 0) amount = Math.max(1, Math.round(amount * (1 - spring.magnitude / 100)));
  // Shoulder to Shoulder: standing beside a Beetle that owns it, a share off every
  // blow — the same blows Second Spring trims, and after it, before any shield
  const shoulder = owner && sourceId !== unitId && !options.fromTick ? shoulderReduction(owner, state.units) : 0;
  if (shoulder > 0 && amount > 0) amount = Math.max(1, Math.round(amount * (1 - shoulder)));

  let absorbed = 0;
  let hpLost = 0;
  let shatter = 0;
  let net = 0;
  // Written inside the map below, where narrowing cannot follow: an object, so the reads see the writes
  const guard: { by?: 'magic' | 'shell'; broke?: true } = {};
  const follow: DamageFollow = { saved: false, saveOutcomes: [], rageFull: false };

  const units = state.units.map((u) => {
    if (u.id !== unitId) return u;
    // Invulnerability: skip damage entirely. A Revenant lying broken between its
    // lives is held the same way: nothing finishes the body before its fragments
    // have decided whether it rises again.
    const holding = options.throughSuspension
      ? u.activeEffects.filter((e) => e.type !== AuraType.Suspended)
      : u.activeEffects;
    if (isHeldFromHarm(holding)) {
      if (amount > 0) guard.by = 'magic';
      return u;
    }

    /**
     * The ice gives way.
     *
     * A fraction of the target's *own* `combatMaxHp` (never `stats.maxHp`,
     * or a bear-shaped Druid is measured against a pool it is not standing
     * in), added to the incoming amount **before** the barrier — so Barrier,
     * Undying, the phase check and the death burst all see one number down
     * the one funnel they already go through.
     *
     * No crit roll and no defence subtraction: this is the ice breaking, not
     * a second strike. That is also why it is a share of the target rather
     * than of the attacker — a Doom expiring, a Thorns reflection and a
     * summon's decay have no attacker at all, and every one of them should
     * shatter. A damage-over-time dose is not a blow and does not.
     */
    if (!options.fromTick) {
      shatter = difficultyDamage(shatterBurst(u), sourceId !== unitId ? unitById(state.units, sourceId) : undefined);
    }

    // A full carapace soaks the blow whole, the ice's burst with it, before
    // anything else gets a say, and is spent. The blow still landed: it counts
    // as a hit for a Reaction and breaks the ice, as one a Barrier ate does.
    if (carapaceSoaks(u, amount + shatter, sourceId, options.fromTick)) {
      absorbed = amount + shatter;
      guard.by = 'shell';
      follow.carapaceSoaked = true;
      return {
        ...u,
        activeEffects: u.activeEffects.filter((e) =>
          e.type !== AuraType.Carapace && e.type !== AfflictionType.Freeze && e.type !== AfflictionType.Brittle),
      };
    }

    // Barrier is spent here rather than at the call sites so that *every*
    // source of damage goes through it — a barrier that stopped skills but
    // not a poison tick is the kind of hole nobody notices until a fight is
    // lost to it.
    // Last Stand first: it reduces everything the unit takes, the ice's burst
    // and a reflection included. Then a Reckoning soaks (and stores) before an
    // ordinary Barrier, so only its own absorption feeds its shockwave.
    const incoming = reduceIncoming(u, amount + shatter);
    const reckoned = absorbWithReckoning(u.activeEffects, incoming);
    follow.reckoningBroken = reckoned.broken;
    const soaked = absorbWithBarrier(reckoned.effects, reckoned.hpDamage);
    absorbed = soaked.absorbed + reckoned.absorbed;
    net = soaked.hpDamage;
    // Broken by an enemy: the Barrier was standing and this blow emptied it.
    // Expiry and dispels never come through here, so they never count.
    const shield = reckoned.effects.find((e) => e.type === AuraType.Barrier && e.magnitude > 0);
    const hostile = sourceId !== undefined && state.units.some((a) => a.id === sourceId && a.isPlayer !== u.isPlayer);
    const emptied = !!shield && !soaked.effects.some((e) => e.type === AuraType.Barrier);
    if (emptied && hostile) {
      follow.brokenBarrierOf = shield!.sourceUnitId;
      follow.brokenBarrierBy = sourceId;
    }
    if (emptied) guard.broke = true;
    if (absorbed > 0) guard.by = 'magic';

    // Undying is checked *before* the HP write, so it prevents a death
    // rather than reversing one — the victory check runs off HP, and a unit
    // that touched zero has already lost the fight for its side.
    const saved = survivesLethal(u, soaked.hpDamage);
    // An Undying window holds the floor at 1 for every later blow, whoever lands it
    const newHp = saved ? 1 : flooredHp(u, u.currentHp, soaked.hpDamage);
    hpLost = u.currentHp - newHp;

    if (saved) {
      follow.saved = true;
      follow.saveOutcomes = lethalSaveOutcomes(
        u,
        attackerId ? state.units.find((a) => a.id === attackerId) : undefined,
      );
    }

    // Freeze: the shattering blow takes it, whatever else the blow did. A
    // hit fully eaten by a barrier still counts as a hit — the target was
    // struck, it just did not bleed.
    // A boss's Brittle mark is the same ice and goes the same way.
    const newEffects = options.fromTick
      ? [...soaked.effects]
      : soaked.effects.filter((e) => e.type !== AfflictionType.Freeze && e.type !== AfflictionType.Brittle);
    if (saved) newEffects.push(UNDYING_SPENT_EFFECT);

    // What the party took off a scripted boss — the blow, whatever a barrier
    // ate of it — counted since its last turn (The Legion Responds) and since
    // it opened a black sun (the Pyre's Bargain). Only a hero's own hit
    // counts: a tick or a Thorns reflection is nobody's burst.
    const dealt = hpLost + absorbed;
    const legion = legionOf(u);
    const counts = legion && attackerId !== undefined && attackerId !== unitId && dealt > 0;
    // A hero's blow, a barrier eating it included, ends the boss's run of unharmed rounds
    // (`BossScriptState.unharmedRounds`); a tick or a reflection with no hostile author does not
    const harmedByHero = !!u.bossScript && dealt > 0 && attackerId !== undefined
      && state.units.some((a) => a.id === attackerId && a.isPlayer !== u.isPlayer);

    // Pain Feast: each separate blow that lands feeds the Berserker's Rage. This is
    // the funnel every strike of every skill passes through one at a time — a
    // multi-hit skill calls it once per strike — so counting here is what makes
    // "each hit counts" mean exactly that, deterministically. A tick or a
    // reflection has no hostile author and is nobody's blow.
    let effects = newEffects;
    if (hasPassive(u, 'painFeast') && attackerId !== undefined && dealt > 0) {
      const attacker = state.units.find((a) => a.id === attackerId);
      if (attacker && attacker.isPlayer !== u.isPlayer) {
        const held = newEffects.find((e) => e.type === AuraType.Rage);
        const stacks = Math.min(BALANCE.PAIN_FEAST_THRESHOLD, Math.round(held?.magnitude ?? 0) + 1);
        if (stacks === BALANCE.PAIN_FEAST_THRESHOLD && (held?.magnitude ?? 0) < stacks) follow.rageFull = true;
        effects = [
          ...newEffects.filter((e) => e.type !== AuraType.Rage),
          { type: AuraType.Rage, magnitude: stacks, duration: -1, sourceUnitId: u.id },
        ];
      }
    }
    // The Tanuki's trick: struck by an enemy and still standing, it is gone from sight
    if (hasPassive(u, 'tanukiTrick') && attackerId !== undefined && dealt > 0 && newHp > 0
      && state.units.some((a) => a.id === attackerId && a.isPlayer !== u.isPlayer)) {
      effects = [
        ...effects.filter((e) => e.type !== AuraType.Stealth),
        { type: AuraType.Stealth, magnitude: 1, duration: BALANCE.STEALTH_DURATION, sourceUnitId: u.id },
      ];
      follow.tricked = true;
    }
    return {
      ...u,
      currentHp: newHp,
      activeEffects: effects,
      ...((counts || harmedByHero) && {
        bossScript: {
          ...u.bossScript!,
          ...(counts && {
            damageWindow: legion!.damageWindow + dealt,
            pyreDamage: legion!.pyreDamage + dealt,
          }),
          ...(harmedByHero && { unharmedRounds: 0 }),
        },
      }),
    };
  });

  // The attacker is credited what the blow was worth — HP lost *and* what a
  // barrier ate — so a shielded target does not erase the contribution.
  // What the target took is the HP it actually lost.
  const patch: Partial<FunnelData> = {
    // A Mantis's Marked Prey counts what its prey lost, whoever dealt it
    units: tallyMarkedPrey(units, unitId, hpLost),
    fightStats: creditFightStats(state.fightStats, [
      [options.creditTo ?? attackerId, 'damageDealt', hpLost + absorbed],
      [unitId, 'damageTaken', hpLost],
    ]),
    // A blow that landed — HP lost or eaten by a barrier — is what a
    // Reaction waits on. Authorless damage (a poison tick, a Doom) is not a
    // hostile act and answers to nobody.
    ...(attackerId && state.reactions.length > 0 && hpLost + absorbed > 0 && {
      reactionEvents: [
        ...state.reactionEvents,
        { kind: 'damaged' as const, targetId: unitId, attackerId, ...(state.answeringReaction && { byReaction: true }) },
      ],
    }),
  };
  return {
    patch,
    report: { hpLost, absorbed, shatter, net, follow, ...(guard.by && { shieldedBy: guard.by }), ...(guard.broke && { shieldBroke: true as const }) },
  };
}

// ─── What follows ─────────────────────────────────────────────────────────────

/**
 * The store, as far as the funnel needs it.
 *
 * The operations are the store's own and are called, not reimplemented: each is a
 * rule in its own right (a Revenant breaking, a phase change, a parting blast).
 * What this module owns is the *order* they run in and the single list of what
 * dying means.
 */
export interface FunnelOps {
  applyEffect(unitId: string, effect: ActiveEffect): unknown;
  removeEffect(unitId: string, type: StatusEffectType): void;
  healUnit(unitId: string, amount: number, healerId?: string): number;
  patchBossScript(unitId: string, patch: Partial<LegionScriptState>): void;
  setWildForm(unitId: string, form: null): void;
  breakSoul(unitId: string): TickEvent[];
  settleSoul(ownerId: string): TickEvent[];
  breakTomb(tombId: string, attackerId?: string): TickEvent[];
  breakShard(shardId: string, attackerId?: string): TickEvent[];
  freeFromWeb(webId: string): TickEvent[];
  enterPendingPhase(unitId: string): string | undefined;
  releaseBossPhase(unitId: string): string | undefined;
  releaseReckoning(unitId: string, spent: ActiveEffect): TickEvent[];
  detonateDeathBurst(unitId: string): TickEvent[];
  recoverFromRubble(recipientId: string, ownerId: string): TickEvent | undefined;
  answerFromStone(recipientId: string, ownerId: string, breakerId: string): TickEvent[];
  /** A full Carapace has soaked a blow on this unit: say so, Hardened Shell's Barriers, and Returned Blow's answer. */
  carapaceSoaked(unitId: string, attackerId?: string): TickEvent[];
  retireOwned(unitId: string): void;
  settleDuels(): TickEvent[];
  syncAuthority(): void;
  syncBeacons(): void;
  spreadSpark(unitId: string, knownBurn?: ActiveEffect): TickEvent[];
  spreadVenom(unitId: string, knownPoison?: ActiveEffect): TickEvent[];
  spreadMark(unitId: string, knownMark?: ActiveEffect): TickEvent[];
  removePreparedAttack(id: string, how?: 'broken'): void;
  /** Takes hexes out of an open warning: one line of a shared one broken (`ObjectiveSpec.boundHexes`). */
  trimPreparedAttack(id: string, hexes: readonly HexCoord[]): void;
}

export interface FunnelHost {
  get(): FunnelData & FunnelOps;
  set(patch: Partial<FunnelData>): void;
}

/**
 * Applies a lethal save's outcomes.
 *
 * Only the two kinds a save can produce — a status and a heal — and both are
 * store operations. A save has no sink: whoever called the funnel reports what it
 * returns.
 */
function applySaveOutcomes(host: FunnelHost, outcomes: PassiveOutcome[]): void {
  for (const outcome of outcomes) {
    if (outcome.kind === 'effect') host.get().applyEffect(outcome.unitId, outcome.effect);
    if (outcome.kind === 'heal') host.get().healUnit(outcome.unitId, outcome.amount);
  }
}

/**
 * Everything a blow sets in motion once its HP write has landed.
 *
 * The order is the rule. Second Skin strips the shape **before** the save's heal,
 * because dropping the form drops `formVigor` and so `combatMaxHp`: heal first
 * and the Druid is topped up against the beast's pool and then has that pool
 * taken away. The phase check follows the write because a threshold is read off
 * HP, and the death list (`resolveDeath`) runs last of the HP rules because a
 * parting blast must see the board the blow left.
 */
export function settleDamage(
  host: FunnelHost,
  unitId: string,
  attackerId: string | undefined,
  follows: DamageFollow[],
  /** The piles a corpse carried before a final tick dropped them (see `resolveDeath`). */
  piles: { knownBurn?: ActiveEffect; knownPoison?: ActiveEffect; knownMark?: ActiveEffect } = {},
): { phaseEntered?: string; events: TickEvent[] } {
  const ops = () => host.get();
  let events: TickEvent[] = [];
  const saves = follows.filter((f) => f.saved);
  const savedUnit = saves.length > 0 ? unitById(host.get().units, unitId) : undefined;

  /**
   * Second Skin strips the shape rather than merely surviving in it.
   *
   * Read off the saved unit rather than the outcome list because it is a
   * property of *how* the save happened, and `PassiveOutcome` has no kind for
   * "become something else" — one that only ever applies to a single passive
   * is a vocabulary entry earning nothing.
   */
  if (savedUnit?.wildForm && hasPassive(savedUnit, 'secondSkin')) ops().setWildForm(unitId, null);
  for (const f of saves) applySaveOutcomes(host, f.saveOutcomes);

  // The Revenant's save is a break, not a second wind: the fragments go out now
  let soulEvents: TickEvent[] | undefined;
  if (savedUnit && hasPassive(savedUnit, 'soulFracture')) soulEvents = ops().breakSoul(unitId);

  // Phase check goes here rather than at the call sites: this is the one funnel
  // every source of damage already passes through — skills, DoT ticks, Thorns
  // reflection, Doom — which is the same reasoning that put Barrier and Undying
  // above it.
  const phaseEntered = ops().enterPendingPhase(unitId);

  const slain = unitById(host.get().units, unitId);
  const dead = !!slain && slain.currentHp <= 0;
  // A blow is one of four ways to die, and the parting blast has to fire down all of them
  if (dead) events.push(...resolveDeath(host, unitId, { attackerId, ...piles }));
  if (soulEvents) events = [...events, ...soulEvents];
  // The Bear's save is a sleep, and it is seen to fall into it: frost settling on
  // the one hex, rime left on it. The sleep itself is then drawn for as long as it
  // lasts (`eliteMarks`), so this is the moment and not the state.
  if (savedUnit && hasPassive(savedUnit, 'winterSleep')) {
    events.push({
      text: passiveName('winterSleep'), log: t('combatLog.tick.winterSleep'), color: '#9ec8ff', unitId,
      vfx: eliteBeat('snow', unitId, savedUnit.position, [savedUnit.position], '#cfe9ff', 'rime'),
    });
  }
  // The Berserker's Undying is seen and heard standing back up, whether a blow or a
  // tick was the one it refused (PT-34: it used to fire in silence)
  if (savedUnit && hasPassive(savedUnit, 'undyingFury')) {
    events.push({ text: t('combatLog.float.undying'), log: t('combatLog.tick.undying'), color: '#ff3b3b', unitId, sound: saveIntent(savedUnit, 'undying') });
  }
  // Rubble Recovery: the Stoneshaper whose Barrier an enemy broke heals the ally it
  // protected, once per ally per Stoneshaper turn
  for (const f of follows) {
    const mended = f.brokenBarrierOf ? ops().recoverFromRubble(unitId, f.brokenBarrierOf) : undefined;
    if (mended) events.push(mended);
    // Stone's Answer: the same break, answered on the enemy that made it
    if (f.brokenBarrierOf && f.brokenBarrierBy) {
      events.push(...ops().answerFromStone(unitId, f.brokenBarrierOf, f.brokenBarrierBy));
    }
  }
  if (follows.some((f) => f.rageFull) && (slain?.currentHp ?? 0) > 0) {
    events.push({ text: t('combatLog.float.feastReady'), log: t('combatLog.tick.feastReady', { skill: skillName({ id: 'slash' }) }), color: '#ff5a3c', unitId });
  }
  if (slain && follows.some((f) => f.tricked) && slain.currentHp > 0) {
    // The trick is a puff of smoke, heard with the word
    events.push({ text: t('combatLog.float.stealthed'), log: t('combatLog.tick.slipsStealth'), color: '#c8a070', unitId, sound: supportIntent(slain, { family: 'smoke' }) });
  }
  // A carapace that soaked a blow is seen to, and Hardened Shell shields its neighbours
  if (follows.some((f) => f.carapaceSoaked)) events.push(...ops().carapaceSoaked(unitId, attackerId));
  // The Reckoning this blow broke goes off, after the write that removed it
  for (const f of follows) {
    if (!f.reckoningBroken) continue;
    const released = ops().releaseReckoning(unitId, f.reckoningBroken);
    if (released.length > 0) events.push(...released);
  }
  return { phaseEntered, events };
}

/**
 * Everything dying means, in one list.
 *
 * A unit can die to a blow, to a damage-over-time dose, to ground it crossed, to
 * a price it paid for its own skill and to a summon's clock running out. Each of
 * those used to carry its own subset of this list — the tick had no duels and no
 * objectives, expiry fired the parting blast and nothing else — so "on death
 * from any cause" was a rule with exceptions. It is called once the unit's HP is
 * at zero, from the funnel, and every consequence is safe to run twice (each
 * latches or finds nothing the second time), so a caller that is unsure whether
 * a unit already died may call it.
 *
 * `knownBurn`, `knownPoison` and `knownMark` are what the corpse carried before its
 * final tick dropped them, for the three spreads that read them.
 */
export function resolveDeath(
  host: FunnelHost,
  unitId: string,
  ctx: { attackerId?: string; knownBurn?: ActiveEffect; knownPoison?: ActiveEffect; knownMark?: ActiveEffect } = {},
): TickEvent[] {
  const ops = () => host.get();
  const slain = unitById(host.get().units, unitId);
  if (!slain || slain.currentHp > 0) return [];
  const events: TickEvent[] = [];

  // A summon's parting blast
  events.push(...ops().detonateDeathBurst(unitId));
  // A Lantern Beacon going out takes its light off everyone it reached
  if (slain.templateId === 'lantern_beacon') ops().syncBeacons();
  // A Captain falling takes his word with him, at once, from every ally he had —
  // and each of them is seen to lose it, a gold ring lifting off them, so the
  // warband's sudden weakness has a cause on the board
  if (hasPassive(slain, 'captainsAuthority')) {
    const wore = ops().units.filter((u) => u.currentHp > 0 && u.activeEffects.some((e) => e.type === AuraType.Authority)).map((u) => u.id);
    ops().syncAuthority();
    const freed = ops().units.filter((u) => wore.includes(u.id) && !u.activeEffects.some((e) => e.type === AuraType.Authority));
    if (freed.length > 0) {
      events.push({
        text: t('combatLog.float.falls'), log: t('combatLog.tick.captainFalls'), color: '#e8b84a', unitId,
        vfx: eliteBeat('buff', unitId, slain.position, freed.map((u) => u.position), '#e8b84a'),
      });
    }
  }
  if (!slain.objective) {
    // And whatever the fallen had open or owned goes with it
    ops().retireOwned(unitId);
    // A duelist falling dissolves the circle, with no punishment and no reward; a challenge
    // whose Jarl or hero has fallen is gone
    events.push(...ops().settleDuels());
  }
  // A Burning enemy's fire may jump on as it falls (Spark)
  events.push(...ops().spreadSpark(unitId, ctx.knownBurn));
  // And a poisoned one's venom may pass on (Venom Transfer)
  events.push(...ops().spreadVenom(unitId, ctx.knownPoison));
  // And a Marked one's Mark may find its next wearer (Next Quarry)
  events.push(...ops().spreadMark(unitId, ctx.knownMark));

  // An objective falling changes its owner's encounter: the effects it was
  // built to leave behind land on the owner, and an attack riding on it is
  // cancelled. Here, in the one funnel, so a standard burned down by a
  // damage-over-time tick counts as destroyed just as a struck one does.
  if (slain.objective) events.push(...objectiveFell(host, slain, ctx.attackerId));
  return events;
}

/** The owner-side consequences of an objective being destroyed. */
function objectiveFell(host: FunnelHost, slain: CombatUnit, attackerId?: string): TickEvent[] {
  const ops = () => host.get();
  const objective = slain.objective!;
  const outcome = destroyedOutcome(slain, ops().units);
  const events: TickEvent[] = [{ text: t('combatLog.tick.destroyed'), color: '#ffaa44', unitId: slain.id }];
  if (outcome) {
    for (const effect of outcome.effects) {
      ops().applyEffect(outcome.ownerId, { ...effect, sourceUnitId: attackerId });
    }
    if (outcome.cancelPreparedId) ops().removePreparedAttack(outcome.cancelPreparedId, 'broken');
    // Its own line of a warning it shares: that line goes, the warning stands on the others
    if (outcome.trimPrepared) ops().trimPreparedAttack(outcome.trimPrepared.id, outcome.trimPrepared.hexes);
    // A banner whose fall mends the rest (Aethelred's castle tier 2): marked here, settled once the turn's blows have landed
    if (objective.kind === STANDARD_KIND) {
      const owner = unitById(ops().units, outcome.ownerId);
      if (owner && aethelredTwist(owner, 'mendingStandards')) ops().patchBossScript(owner.id, { standardFell: true });
    }
    // A banner that pays the breaker: the hero who brought it down takes a Barrier, in whatever order they fall
    const breaker = outcome.breakerBarrier && attackerId ? unitById(ops().units, attackerId) : undefined;
    if (outcome.breakerBarrier && breaker && breaker.isPlayer && breaker.currentHp > 0 && !breaker.objective) {
      const barrier = Math.max(1, Math.round(combatMaxHp(breaker) * outcome.breakerBarrier));
      ops().applyEffect(breaker.id, {
        type: AuraType.Barrier, magnitude: barrier, duration: BALANCE.AETHELRED_STANDARD_BARRIER_TURNS, sourceUnitId: breaker.id,
      });
      events.push({ text: t('combatLog.tick.standardPays', { amount: barrier }), color: '#9ad0ff', unitId: breaker.id });
    }
    if (outcome.wasLast && outcome.effects.length > 0) {
      events.push({ text: t('combatLog.tick.leftExposed'), color: '#ffdd66', unitId: outcome.ownerId });
    }
    // A restraint snapping back on the one it held: its owner pays a share of its
    // health, which the objectives' own protection does not soak
    const boss = unitById(ops().units, outcome.ownerId);
    if (outcome.backlash && boss && boss.currentHp > 0) {
      const back = damageUnit(
        host, boss.id, Math.max(1, Math.round(boss.stats.maxHp * outcome.backlash)), attackerId,
        { bypassProtection: true, throughSuspension: true },
      );
      events.push({ text: `-${back.hpLost}`, color: '#ff7a7a', unitId: boss.id });
    }
    // The last of a kind falling: the restraints give way, or the guard is torn open
    const after = boss && unitById(ops().units, boss.id);
    if (outcome.onLast && after && after.currentHp > 0) {
      if (outcome.onLast === 'release') ops().releaseBossPhase(after.id);
      ops().applyEffect(after.id, {
        type: AuraType.Exposed,
        magnitude: BALANCE.HEART_EXPOSED,
        duration: BALANCE.HEART_EXPOSED_TURNS,
        sourceUnitId: after.id,
      });
      events.push({ text: t('combatLog.tick.tornOpen'), color: '#ffdd66', unitId: after.id });
    }
  }
  // A carried Heart broken: its Seared leaves the hero who held it
  if (objective.carrierId) ops().removeEffect(objective.carrierId, AfflictionType.Seared);
  // A soul fragment destroyed is one fewer on its way home — and the last of them
  // decides whether the Revenant rises
  if (objective.kind === SOUL_FRAGMENT_KIND) events.push(...ops().settleSoul(objective.ownerId));
  // A tomb broken from outside frees the hero and bursts outward
  if (objective.kind === TOMB_KIND) events.push(...ops().breakTomb(slain.id, attackerId));
  // A web cut from outside frees the hero it held
  if (objective.kind === WEB_KIND) events.push(...ops().freeFromWeb(slain.id));
  // Jadeveil: a Jade Shard cleanses the heroes beside it and bursts into whoever broke it
  if (objective.kind === SHARD_KIND) events.push(...ops().breakShard(slain.id, attackerId));
  return events;
}

// ─── The store's entry point ──────────────────────────────────────────────────

/**
 * Takes `amount` of damage off a unit and runs everything it sets in motion.
 *
 * The store's `damageUnit` is this with the store as the host.
 */
export function damageUnit(
  host: FunnelHost,
  unitId: string,
  amount: number,
  attackerId?: string,
  options: DamageOptions = {},
): DamageResult {
  // Carapace Bastion: an ally standing in a Beetle's Bastion hands the Beetle its
  // share of a hostile blow, which goes down the Beetle's own funnel (its
  // carapace, its Barrier, its death) before the ally's part lands. The run
  // difficulty is settled once, on the whole blow, so the halves add up to it.
  const state = host.get();
  const struck = unitById(state.units, unitId);
  const sourceId = options.sourceUnitId ?? attackerId;
  let shared: DamageResult | undefined;
  let sharedAmount = 0;
  let sharedBy: string | undefined;
  if (struck && !options.bypassProtection) {
    const whole = options.difficultyApplied || sourceId === unitId
      ? amount
      : difficultyDamage(amount, unitById(state.units, sourceId));
    const cover = bastionCover(struck, whole, sourceId, state.units, state.hazards, options.fromTick);
    if (cover) {
      sharedAmount = cover.taken;
      sharedBy = cover.owner.id;
      shared = damageUnit(host, cover.owner.id, cover.taken, attackerId, { ...options, difficultyApplied: true });
      amount = whole - cover.taken;
      options = { ...options, difficultyApplied: true };
    }
  }

  const { patch, report } = takeDamage(host.get(), unitId, amount, attackerId, options);
  host.set(patch);
  const settled = settleDamage(host, unitId, attackerId, [report.follow]);
  const events = sharedBy
    ? [{ text: `-${sharedAmount}`, color: BASTION_COLOR, unitId: sharedBy }, ...(shared?.deathEvents ?? []), ...settled.events]
    : settled.events;
  return {
    hpLost: report.hpLost,
    absorbed: report.absorbed,
    phaseEntered: settled.phaseEntered,
    ...(report.shatter > 0 && { shatter: report.shatter }),
    ...(report.shieldedBy && { shieldedBy: report.shieldedBy }),
    ...(report.shieldBroke && { shieldBroke: true as const }),
    ...(events.length > 0 && { deathEvents: events }),
    ...(sharedBy && { shared: sharedAmount, sharedBy }),
  };
}

/** The Bastion's share, floated on the Beetle that took it: the carapace's amber. */
const BASTION_COLOR = '#e0a83c';
