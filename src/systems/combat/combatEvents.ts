import { skillName, statusName } from '@/data/gameText';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import type { CombatSink } from '@/systems/combat/combatSink';
import { resourceShort } from '@/data/classResource';
import { difficultyDamage } from '@/systems/combat/runDifficulty';
import { ActiveEffect, AfflictionType, AuraType, CombatUnit, HeroSkill, StatusEffectType, SummonArrivalSpec } from '@/models/types';
import { carriedHeal } from '@/systems/combat/passiveFormulas';
import { calculateHealing, resolveEffectMagnitude } from '@/systems/combat/damageCalc';
import { combatMaxHp } from '@/systems/combat/forms';
import { CHI_COLOR, STATUS_DISPLAY, resourceColor } from '@/data/display/statusDisplay';
import { EffectOutcome, TickEvent, useCombatStore } from '@/stores/combatStore';
import { hexDistance } from '@/utils/hexUtils';
import { chillUpgrades, chillMakesBrittle, hasEffect, isRooted, reflectedDamage, shatterBurst, shockChain, shockJumpBonus, shockSecondHop, shockSecondHopShare, triggersShock, overhealBarrier } from '@/systems/combat/statusEffects';
import { BALANCE } from '@/data/balanceConstants';
import { deepColdExtraTurns, passiveName, PassiveContext, PassiveOutcome, PassiveTriggerArg, resolvePassives } from '@/systems/combat/passives';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { resolvePush } from '@/systems/combat/forcedMovement';
import { unitById } from '@/systems/combat/unitLookup';
import { getMovementRange } from '@/systems/combat/movement';
import { mendIntent, moveIntent, strikeDetail, strikeIntent, strikeOutcome } from '@/systems/combat/soundIntents';
import { shatterVfx } from '@/systems/combat/iceBreak';
import { MARKSMAN_YELLOW } from '@/data/display/marksmanColors';
import { ignoresDisable } from '@/systems/combat/bossControl';
import { CHARGE_BREAKERS, heldCharge } from '@/systems/combat/chargedCast';
import { interruptedBy, threatensUnit } from '@/systems/combat/preparedAttacks';
import { onDragonInterrupted } from '@/systems/combat/dragonActions';
import { lightbondHeal, lightbondOf, moteCount, moteHeal, moteRecipients, moteSpec, spilledLightDamage } from '@/systems/combat/fireflyRules';

/** The Firefly's amber: its mote, its bond and their log lines (`MASTERY_COLOR.firefly`). */
export const FIREFLY_AMBER = '#ff9e00';

/**
 * What this module is allowed to say to whoever is watching.
 *
 * A narrowed view of `CombatSink` (`combatSink`): the channels a rule here speaks
 * through, all but `log` optional. Both execution paths hand their own sink
 * straight in and nothing has to adapt.
 *
 * It grew from a bare log function because a status landing is a thing that
 * *happens to a unit*, and until now the only record of it was a line of text in
 * a scrolling log that nobody reads mid-fight.
 */
export type EventSink = Pick<CombatSink, 'log'> & Partial<Pick<CombatSink, 'float' | 'status' | 'sound' | 'impactVfx'>>;

/** The colour of a Shock spark: its log line, its number and its bolt. */
export const SHOCK_COLOR = '#66ccff';

/** Flame Guard's colour: its badge, its shroud, and the fire it throws back. */
export const FLAME_GUARD_COLOR = '#ff7a2e';

/**
 * Puts the events a lethal side-blow handed back on the board — the explosion of
 * a Fire Elemental that a reflection, a stored charge or a passive finished —
 * as the blow lands. Every death shows its own blast, whichever path killed it.
 */
export function playDeathEventsAt(events: readonly TickEvent[] | undefined, sink?: EventSink): void {
  for (const ev of events ?? []) {
    if (ev.vfx) sink?.impactVfx?.(ev.vfx);
    const hurt = unitById(useCombatStore.getState().units, ev.unitId);
    if (!hurt) continue;
    sink?.log(`  ${unitName(hurt)} ${ev.log ?? ev.text}`, ev.color);
    if (ev.sound) sink?.sound?.(ev.sound);
    sink?.float?.(hurt.position, ev.text, ev.color);
  }
}

type Logger = EventSink;

/**
 * Everything that happens *because* something happened — statuses reacting to a
 * hit, and passives reacting to any combat event.
 *
 * The player's `executeSkill` and the AI's `executeAIActions` are two separate
 * copies of "resolve a skill", and they have drifted before: enemy push skills
 * silently did nothing for a while because only one path implemented knockback.
 * Reflect, chaining and every passive trigger are exactly that shape of rule, so
 * they live here and both paths call in.
 */

// ─── Passive outcomes ─────────────────────────────────────────────────────────

/**
 * Applies a resolved list of passive outcomes to the store.
 *
 * The single place passive side effects are written, so their ordering is
 * visible in one function rather than scattered across fourteen definitions.
 */
export function applyPassiveOutcomes(
  outcomes: PassiveOutcome[],
  sink?: EventSink,
  sourceUnitId?: string,
): { extraAction: boolean; repositioned: boolean } {
  const store = useCombatStore.getState();
  let extraAction = false;
  let repositioned = false;

  for (const outcome of outcomes) {
    switch (outcome.kind) {
      case 'damage': {
        const result = store.damageUnit(outcome.unitId, outcome.amount, undefined, { sourceUnitId });
        sink?.log(`  ${outcome.log}: ${nameOf(outcome.unitId)} -${result.hpLost}`, outcome.color ?? '#88cc44');
        const struck = outcome.color
          ? unitById(useCombatStore.getState().units, outcome.unitId)
          : undefined;
        if (struck) sink?.float?.(struck.position, `-${result.hpLost}`, outcome.color!);
        playDeathEventsAt(result.deathEvents, sink);
        break;
      }
      case 'spend':
        store.spendThisTurn(outcome.key);
        break;
      case 'hazard':
        // One patch per id: laying it again refreshes it rather than doubling it
        store.removeHazard(outcome.hazard.id);
        store.addHazard(outcome.hazard);
        sink?.log(`  ${outcome.log}`, '#ff8844');
        break;
      case 'heal': {
        const landed = store.healUnit(outcome.unitId, outcome.amount);
        sink?.log(`  ${outcome.log}: ${nameOf(outcome.unitId)} +${landed}`, '#44dd88');
        break;
      }
      case 'chi': {
        const unit = unitById(useCombatStore.getState().units, outcome.unitId);
        if (!unit || unit.currentHp <= 0) break;
        const before = unit.currentMana;
        store.restoreMana(outcome.unitId, outcome.amount);
        const gained = (unitById(useCombatStore.getState().units, outcome.unitId)?.currentMana ?? before) - before;
        if (gained <= 0) break;
        sink?.log(`  ${outcome.log}: ${unitName(unit)} ${t('combatLog.float.chi', { amount: gained })}`, CHI_COLOR);
        // Said the way the Basic Attack's refill says it (`skillResolution.refillChi`)
        sink?.float?.(unit.position, t('combatLog.float.chi', { amount: gained }), CHI_COLOR);
        break;
      }
      case 'effect': {
        // Announced as what landed rather than as what was asked for — see
        // `EffectOutcome.landed`; a passive's Chill can arrive as a Freeze too.
        if (outcome.replace) store.removeEffect(outcome.unitId, outcome.effect.type);
        const landed = store.applyEffect(outcome.unitId, outcome.effect);
        if (outcome.log) sink?.log(`  ${outcome.log}`, outcome.color ?? '#aa88ff');
        announceSpill(landed, sink);
        if (outcome.silent) break;
        announceStatus(outcome.unitId, landed?.landed ?? outcome.effect.type, sink);
        break;
      }
      case 'reposition':
        store.grantReposition(outcome.unitId, outcome.range);
        sink?.log(`  ${outcome.log}`, outcome.color);
        repositioned = true;
        break;
      case 'spendAllowance':
        useCombatStore.setState((st) => ({
          units: st.units.map((u) => (u.id === outcome.unitId ? { ...u, venomTransferSpent: true } : u)),
        }));
        break;
      case 'mana': {
        store.restoreMana(outcome.unitId, outcome.amount);
        const unit = unitById(useCombatStore.getState().units, outcome.unitId);
        sink?.log(`  ${outcome.log}: ${nameOf(outcome.unitId)} +${outcome.amount} ${resourceShort(unit?.resource)}`, resourceColor(unit?.resource));
        break;
      }
      case 'refundCooldown':
        store.refundCooldown(outcome.unitId, outcome.turns, outcome.onlyIds);
        sink?.log(`  ${outcome.log}`, '#66ccff');
        break;
      case 'extraAction':
        extraAction = true;
        sink?.log(`  ${outcome.log}!`, '#ffcc44');
        break;
      case 'retreat': {
        // Escape Route: a push the unit applies to itself, away from the attacker,
        // so it stops at whatever blocks the way. Not a voluntary move.
        const live = useCombatStore.getState();
        const unit = unitById(live.units, outcome.unitId);
        const from = unitById(live.units, outcome.fromId);
        if (!unit || !from || unit.currentHp <= 0) break;
        const to = resolvePush(from.position, unit, outcome.range, live.units, live.hazards);
        if (!to) break;
        for (const ev of store.moveUnit(unit.id, to, 'walk', false)) sink?.log(`  ${nameOf(ev.unitId)} ${ev.log ?? ev.text}`, ev.color);
        useCombatStore.setState((s) => ({
          units: s.units.map((u) => (u.id === unit.id ? { ...u, escapeRouteSpent: true } : u)),
        }));
        sink?.sound?.(moveIntent(unit.id, unit.position, to, 'retreat'));
        sink?.log(`  ${t('combatLog.log.stepsBack', { source: outcome.log, name: unitName(unit) })}`, MARKSMAN_YELLOW);
        break;
      }
    }
  }

  return { extraAction, repositioned };
}

const nameOf = (unitId: string) => {
  const unit = unitById(useCombatStore.getState().units, unitId);
  return unit ? unitName(unit) : t('combatLog.log.someone');
};

/**
 * Put the name of a status that just landed over the unit wearing it.
 *
 * One function, called from every route a status can arrive by — a skill, a
 * passive, an enemy's bite, a coated blade — for the same reason the rest of
 * this module exists: the alternative is each path announcing its own, and the
 * AI's half quietly not doing it.
 *
 * Reads the target back out of the store rather than trusting the write. That
 * is not defensive nicety: `applyEffect` is where `DebuffImmunity` silently
 * drops afflictions, and "STUNNED" floating over something that shrugged the
 * stun off is worse than saying nothing at all.
 *
 * `hidden` entries are internal bookkeeping — the display table already records
 * which statuses the player is never meant to see.
 */
function announceStatus(targetId: string, type: StatusEffectType, sink?: EventSink): void {
  if (!sink?.status) return;
  const display = STATUS_DISPLAY[type];
  if (!display || display.hidden) return;

  const target = unitById(useCombatStore.getState().units, targetId);
  if (!target || !hasEffect(target, type)) return;

  // Poison is the one status whose count is the story rather than a detail: the
  // pile is what decides whether the next dose stacks or detonates.
  const stacks = target.activeEffects.find((e) => e.type === type)?.stacks ?? 1;
  const label =
    type === AfflictionType.Poison && stacks > 1
      ? `${statusName(type)} ×${stacks}`
      : statusName(type);

  sink.status(target.position, label, display.color);
}

const fire = (
  trigger: PassiveTriggerArg,
  self: CombatUnit,
  ctx: Omit<PassiveContext, 'self' | 'allUnits'>,
  sink?: EventSink
) => {
  const state = useCombatStore.getState();
  return applyPassiveOutcomes(
    resolvePassives(trigger, {
      self,
      allUnits: state.units,
      // What has already been used this turn, so a once-a-turn passive can say no
      turnSpent: state.spentThisTurn.serial === state.turnSerial ? state.spentThisTurn.keys : [],
      ...ctx,
    }),
    sink,
    self.id,
  );
};

/** A Shock jump landing, drawn and heard: the first off the struck unit, Forked Current's off the first victim. */
function landShockJump(
  attacker: CombatUnit,
  from: { q: number; r: number },
  chain: { unit: CombatUnit; damage: number },
  sink?: EventSink,
): void {
  const jumped = useCombatStore.getState().damageUnit(chain.unit.id, chain.damage, attacker.id, { difficultyApplied: true });
  const { deathEvents } = jumped;
  sink?.log(`  ${t('combatLog.log.shockJump', { name: unitName(chain.unit), amount: chain.damage })}`, SHOCK_COLOR);
  // The spark is drawn from where it leapt to the one it jumps to, and its
  // number floats over the one it hurt — both as the blow lands. The recipient
  // is named as the "caster" too, so the only animation it plays is the recoil.
  sink?.impactVfx?.({
    kind: 'lightning', delivery: 'spell',
    casterId: chain.unit.id,
    casterPos: from,
    targetCoord: chain.unit.position,
    hitUnitIds: [chain.unit.id],
    hitCoords: [chain.unit.position],
    color: SHOCK_COLOR,
    durationScale: 0.7,
  });
  // The spark lands as lightning, with its number
  sink?.sound?.(strikeIntent(
    chain.unit, 'spell', strikeOutcome({ dodged: false, crit: false }, jumped.hpLost), 'storm', undefined,
    strikeDetail(undefined, jumped),
  ));
  sink?.float?.(chain.unit.position, `-${chain.damage}`, SHOCK_COLOR);
  // A summon the spark killed goes off, the same as one killed by the blow
  playDeathEventsAt(deathEvents, sink);
}

// ─── On being hit ─────────────────────────────────────────────────────────────

export interface HitOutcome {
  /** The attacker may act again — Frenzy on a kill. */
  extraAction: boolean;
  /**
   * A poison overdose triggered by the strike itself, via coated blades.
   *
   * Returned rather than drawn here for the same reason the one in
   * `applySkillStatus` is: this file has no screen, and the two execution paths
   * put a number on the board in different ways.
   */
  poisonBurst?: EffectOutcome;
}

/**
 * Statuses and passives that fire when a strike lands.
 *
 * Takes HP actually lost, not damage rolled: a hit entirely eaten by a Barrier
 * should not reflect off Thorns, jump via Shock or count toward Braced, because
 * nothing reached the target to react to.
 *
 * `hpBefore` is the target's health *before* the damage was written, which is
 * the only way to tell a kill from a scratch after the fact.
 */
export function applyOnHitStatuses(
  attacker: CombatUnit,
  target: CombatUnit,
  hpLost: number,
  sink?: EventSink,
  hpBefore?: number,
  /**
   * Whether the blow was a critical hit.
   *
   * Only Follow-Through reads it, but it has to arrive here rather than being
   * inferred: by the time a passive fires, the roll is long gone and nothing
   * about the resulting HP tells a crit apart from a big hit.
   */
  crit?: boolean,
  /**
   * The skill that landed the blow, for passives that care what kind it was
   * (Stonecutter asks whether it was earth). Optional: a blow with no skill
   * behind it resolves exactly as before.
   */
  skill?: HeroSkill,
  /**
   * The full damage the blow carried past any Barrier, overkill included, when it
   * reached the target's health at all. A Shock spark is sized from this rather
   * than from `hpLost`, so a killing blow on a nearly dead unit still jumps with
   * the weight of the hit. Omitted, the spark falls back to `hpLost`.
   */
  dealt?: number,
): HitOutcome {
  const store = useCombatStore.getState();
  let extraAction = false;
  let poisonBurst: EffectOutcome | undefined;

  // Attacking gives away the position — Stealth cannot survive its own payoff
  if (hasEffect(attacker, AuraType.Stealth)) {
    store.removeEffect(attacker.id, AuraType.Stealth);
    sink?.log(`  ${t('combatLog.log.breaksStealth', { name: unitName(attacker) })}`, '#aa88ff');
  }

  if (hpLost <= 0) return { extraAction };

  /**
   * The ice breaking, said out loud.
   *
   * Announced here rather than at each call site for the reason the whole
   * module exists: a shatter one call site draws and another forgets is exactly
   * the drift this file was written to prevent. `target` is the
   * snapshot taken *before* the blow — the same one Shatterstep reads — so the
   * Freeze is still on it, and `shatterBurst` is the one definition of what it
   * was worth, shared with the `damageUnit` that actually charged it.
   *
   * Through `status` rather than `float` because the strike's own number is
   * already going up on this hex in this frame; that channel is what staggers
   * the second text. A blow entirely eaten by a Barrier, or landing on an
   * Invulnerable target, never reaches here — the guard above sees `hpLost` of
   * zero — which is right: nothing broke.
   */
  const shatter = difficultyDamage(shatterBurst(target), attacker);
  if (shatter > 0) {
    const ice = STATUS_DISPLAY[AfflictionType.Freeze];
    // The ice bursts off the body as the blow lands, and is heard breaking
    sink?.impactVfx?.(shatterVfx(target.id, target.position));
    sink?.sound?.(strikeIntent(target, 'spell', 'hit', 'frost'));
    sink?.status?.(target.position, t('combatLog.float.shatter', { amount: shatter }), ice.color);
    sink?.log(`  ${t('combatLog.log.shatters', { name: unitName(target), amount: shatter })}`, ice.color);
  }

  const thorns = reflectedDamage(target, hpLost);
  if (thorns > 0) {
    const reflected = store.damageUnit(attacker.id, thorns, target.id);
    // Flame Guard throws its share back as a burst of fire at whoever struck,
    // drawn as the blow lands and carrying the number, so the retaliation is seen
    const fire = target.activeEffects.some((e) => e.type === AuraType.FlameGuard)
      && !target.activeEffects.some((e) => e.type === AuraType.Thorns);
    // The retaliation is heard as its school, as it lands: thorns are nature, Flame Guard fire
    sink?.sound?.(strikeIntent(
      attacker, 'spell', strikeOutcome({ dodged: false, crit: false }, reflected.hpLost), fire ? 'fire' : 'nature', undefined,
      strikeDetail(undefined, reflected),
    ));
    if (fire) {
      sink?.log(`  ${t('combatLog.log.takesFrom', { name: unitName(attacker), amount: reflected.hpLost, source: statusName(AuraType.FlameGuard) })}`, FLAME_GUARD_COLOR);
      sink?.impactVfx?.({
        kind: 'bolt', delivery: 'spell',
        casterId: target.id,
        casterPos: target.position,
        targetCoord: attacker.position,
        hitUnitIds: [attacker.id],
        hitCoords: [attacker.position],
        color: FLAME_GUARD_COLOR,
        durationScale: 0.6,
      });
      sink?.float?.(attacker.position, `-${reflected.hpLost}`, FLAME_GUARD_COLOR);
    } else {
      sink?.log(`  ${t('combatLog.log.takesFrom', { name: unitName(attacker), amount: reflected.hpLost, source: statusName(AuraType.Thorns) })}`, '#88cc44');
    }
    playDeathEventsAt(reflected.deathEvents, sink);
  }

  // A stored charge answers once and is gone. Read from the store rather than
  // from `target`, which is a snapshot taken before the damage landed, and
  // removed *first* so a lethal answer cannot re-enter this path and spend the
  // same charge twice.
  const charge = unitById(store.units, target.id)
    ?.activeEffects.find((e) => e.type === AuraType.StaticCharge);
  if (charge) {
    store.removeEffect(target.id, AuraType.StaticCharge);
    const bolt = Math.max(1, Math.round(charge.magnitude));
    const answered = store.damageUnit(attacker.id, bolt, target.id);
    // The stored charge answers as lightning, heard as it strikes
    sink?.sound?.(strikeIntent(
      attacker, 'spell', strikeOutcome({ dodged: false, crit: false }, answered.hpLost), 'storm', undefined,
      strikeDetail(undefined, answered),
    ));
    playDeathEventsAt(answered.deathEvents, sink);
    store.applyEffect(attacker.id, {
      type: AfflictionType.Shock,
      magnitude: 1,
      duration: 2,
      sourceUnitId: charge.sourceUnitId ?? target.id,
    });
    sink?.log(`  ${t('combatLog.log.chargeAnswers', { name: unitName(attacker), amount: answered.hpLost })}`, '#ffee66');
    announceStatus(attacker.id, AfflictionType.Shock, sink);
  }

  // Coated blades. Every strike the carrier lands doses the target, which is
  // what a turn spent on Hemlock bought — and it goes through `applyEffect` like
  // any other dose, so a target already carrying three gets the overdose here
  // rather than a fourth stack the rule elsewhere says it cannot have.
  const coating = attacker.activeEffects.find((e) => e.type === AuraType.Envenomed);
  if (coating) {
    const outcome = store.applyEffect(target.id, {
      type: AfflictionType.Poison,
      magnitude: resolveEffectMagnitude(
        AfflictionType.Poison, coating.magnitude, attacker, 'attack',
      ),
      duration: BALANCE.POISON_TICKS,
      sourceUnitId: attacker.id,
    });
    // Only an overdose is handed upward: both resolvers float `poisonBurst`
    // unconditionally, so reporting an ordinary dose here would put a `-0` on
    // the board for every strike a coated blade lands.
    poisonBurst = outcome && outcome.burst > 0 ? outcome : undefined;
    sink?.log(
      `  ${poisonBurst
        ? t('combatLog.log.convulses', { name: unitName(target), amount: poisonBurst.burst, crit: '' })
        : t('combatLog.log.poisoned', { name: unitName(target) })}`,
      '#88cc44',
    );
    announceStatus(target.id, outcome?.landed ?? AfflictionType.Poison, sink);
  }

  // Read positions fresh: an earlier target in this same AoE may already have
  // been pushed, which changes who counts as adjacent
  //
  // Only a spell that itself lays Shock sets the jump off (`triggersShock`), and
  // `target` is the snapshot from before the blow, so the Shock this same cast is
  // about to lay never counts.
  const chain = triggersShock(skill)
    ? shockChain(target, useCombatStore.getState().units, dealt ?? hpLost, shockJumpBonus(attacker, skill))
    : null;
  if (chain) {
    landShockJump(attacker, target.position, chain, sink);
    // Forked Current: one more, off the first victim, from the board as the jump left it
    const units = useCombatStore.getState().units;
    const hop = shockSecondHop(target, chain, units, shockSecondHopShare(attacker, units));
    if (hop) landShockJump(attacker, chain.unit.position, hop, sink);
  }

  extraAction = fire('onHit', attacker, {
    other: target, amount: hpLost, crit, skill,
    ...(attacker.passives?.includes('flyingShards') && { magic: getCombatEffectiveStats(attacker).magic }),
  }, sink).extraAction;

  // The victim reacts from its post-damage state, so Braced sees the stack it
  // already has and Wrath sees the health it actually has left
  const victim = unitById(useCombatStore.getState().units, target.id) ?? target;
  fire('onDamaged', victim, { other: attacker, amount: hpLost }, sink);

  if ((hpBefore ?? target.currentHp) > 0 && victim.currentHp <= 0) {
    const killer = unitById(useCombatStore.getState().units, attacker.id) ?? attacker;
    extraAction =
      fire('onKill', killer, { other: victim, amount: hpLost, crit }, sink).extraAction ||
      extraAction;
  }

  return { extraAction, poisonBurst };
}

/** A `skill.allyHeal` that landed — returned so the caller can float the number. */
export interface AllyHealOutcome {
  unitId: string;
  at: { q: number; r: number };
  amount: number;
  /**
   * This heal is the Templar's incidental Smite heal, which the plan exempts from
   * Aethelred's Tithe on Mercy. **Aethelred's Tithe is not in the code yet**; the
   * flag is here so the task that adds it honours the exemption by reading this
   * field instead of rediscovering the rule. Always `true` for this outcome,
   * because `applyAllyHealOnHit` is the only producer.
   */
  exemptFromTithe: true;
}

/**
 * Who a damaging blow's incidental heal goes to: the living ally with the
 * **lowest health fraction**, the caster included, and ties to the nearer one.
 *
 * Wound severity comes before proximity on purpose. The old rule took the
 * *nearest* wounded ally, which would have made the Templar win every time it
 * was allowed to choose itself — a caster stands at distance zero from itself.
 * Fraction rather than missing HP, so a nearly-dead squishy outranks a
 * lightly-scratched tank. A final tie goes to the id, so the same board always
 * picks the same unit.
 *
 * Exported and pure so the tooltip, the tests and the resolver all state one
 * rule. `units` is read fresh by the caller; an objective is never a recipient.
 */
export function allyHealRecipient(
  caster: CombatUnit,
  units: CombatUnit[],
): CombatUnit | undefined {
  return allyHealOrder(caster, units)[0];
}

/** Every wounded ally in the order `allyHealRecipient` picks from, most wounded first. */
export function allyHealOrder(
  caster: CombatUnit,
  units: CombatUnit[],
): CombatUnit[] {
  const self = unitById(units, caster.id) ?? caster;
  const wounded = units.filter(
    (u) =>
      u.currentHp > 0 &&
      !u.objective &&
      u.isPlayer === caster.isPlayer &&
      u.currentHp < combatMaxHp(u),
  );
  return wounded.sort((a, b) => {
    const worse = a.currentHp / combatMaxHp(a) - b.currentHp / combatMaxHp(b);
    if (worse !== 0) return worse;
    const closer = hexDistance(a.position, self.position) - hexDistance(b.position, self.position);
    if (closer !== 0) return closer;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The light spilling off a damaging blow — `HeroSkill.allyHeal`.
 *
 * Lives here for the reason everything in this file does: both execution paths
 * deal damage, and a rider that mended the line only when the *player* pressed
 * the button is the drift this module exists to prevent. The recipient is
 * `allyHealRecipient`, read fresh from the store because the strike that
 * triggered this may have moved or killed people. Carrying Word sends a share of
 * the heal on to the next ally of that order. Its share is of what was cast, so
 * a first ally a point short of full does not shrink it. Returns one outcome per
 * ally mended, for the caller to float.
 */
export function applyAllyHealOnHit(
  caster: CombatUnit,
  skill: HeroSkill,
  damageDealt: number,
  sink?: EventSink,
): AllyHealOutcome[] {
  if (!skill.allyHeal || damageDealt <= 0) return [];
  const store = useCombatStore.getState();

  const [target, next] = allyHealOrder(caster, store.units);
  if (!target) return [];

  // Through `calculateHealing`, so heal-power gear reaches this the way it
  // reaches every other route healing takes.
  const amount = calculateHealing(caster, { ...skill, healing: skill.allyHeal });
  if (amount <= 0) return [];

  const carried = next ? carriedHeal(amount, caster.masteryModifiers?.allyHealSpill ?? 0) : 0;
  const mends = carried > 0
    ? [{ unit: target, heal: amount }, { unit: next, heal: carried }]
    : [{ unit: target, heal: amount }];
  return mends.map(({ unit, heal }) => {
    // What landed, not what was cast — the target's own support bonus and the
    // ceiling both sit inside `healUnit`, and the float is where the player sees
    // the difference.
    const landed = useCombatStore.getState().healUnit(unit.id, heal, caster.id);
    applyOnHeal(caster, unit, heal, sink, landed);
    sink?.log(`  ${unitName(unit)} +${landed} (${skillName(skill)})`, '#44dd88');
    // Said here rather than beside the caller's float, so both paths are heard
    // mending the line — only the player's draws the number, and it draws it
    // straight after this returns, which keeps the sound ahead of it.
    sink?.sound?.(mendIntent(unit));
    return { unitId: unit.id, at: unit.position, amount: landed, exemptFromTithe: true as const };
  });
}

/** A Firefly heal that landed — the mote or a bond — returned so the caller can float it. */
export interface FireflyHealOutcome {
  unitId: string;
  at: { q: number; r: number };
  amount: number;
}

/**
 * Glowmote's mote (`HeroSkill.mote`): once the cast is done, a share of what it
 * dealt heals the most hurt ally near the Firefly, or the Firefly itself when
 * nobody else is hurt (`fireflyRules.moteRecipients`) — the two most hurt with
 * Twin Motes, each for the whole mote. Read fresh from the store because the bolt
 * may have killed or moved somebody. A cast that dealt nothing — a dodge — sends
 * no mote. Returns one outcome per ally mended, for the caller to float.
 *
 * Spilled Light: what the mote could not restore strikes `struckId`, the enemy the
 * bolt struck. Straight through `damageUnit` and fixed, so it is no blow of the cast's:
 * no bond heal, no second mote and no Steady Flame follow it.
 */
export function applyMote(
  caster: CombatUnit,
  skill: HeroSkill,
  damageDealt: number,
  sink?: EventSink,
  struckId?: string,
): FireflyHealOutcome[] {
  const spec = moteSpec(caster, skill);
  if (!spec || damageDealt <= 0) return [];
  const store = useCombatStore.getState();
  const self = unitById(store.units, caster.id) ?? caster;
  const amount = moteHeal(spec.share, damageDealt);
  const mended = moteRecipients(self, store.units, spec.reach, moteCount(self)).map((target) => {
    const landed = useCombatStore.getState().healUnit(target.id, amount, caster.id);
    applyOnHeal(self, target, amount, sink, landed);
    sink?.log(`  ${t('combatLog.log.moteHeal', { name: unitName(target), amount: landed })}`, FIREFLY_AMBER);
    sink?.sound?.(mendIntent(target));
    return { unitId: target.id, at: target.position, amount: landed };
  });
  const struck = struckId ? unitById(useCombatStore.getState().units, struckId) : undefined;
  const spilled = spilledLightDamage(self, amount, mended.map((m) => m.amount));
  if (struck && struck.currentHp > 0 && spilled > 0) {
    const paid = useCombatStore.getState().damageUnit(struck.id, spilled, caster.id);
    sink?.sound?.(strikeIntent(struck, 'spell', strikeOutcome({ dodged: false, crit: false }, paid.hpLost), 'holy'));
    sink?.float?.(struck.position, `-${spilled}`, FIREFLY_AMBER);
    sink?.log(`  ${passiveName('spilledLight')}: ${unitName(struck)} -${paid.hpLost}`, FIREFLY_AMBER);
    playDeathEventsAt(paid.deathEvents, sink);
  }
  return mended;
}

/**
 * Lightbond: one blow the Firefly landed for `damage` heals its bonded ally for a
 * share of it (`fireflyRules.lightbondOf`). Called once per damaging event — each
 * body a cast strikes is one — never once per cast, and never for damage the
 * Firefly takes.
 */
export function applyLightbond(
  caster: CombatUnit,
  damage: number,
  sink?: EventSink,
): FireflyHealOutcome | undefined {
  if (damage <= 0) return undefined;
  const store = useCombatStore.getState();
  const bond = lightbondOf(caster, store.units);
  if (!bond) return undefined;
  const amount = lightbondHeal(bond.percent, damage);
  if (amount <= 0) return undefined;
  const landed = store.healUnit(bond.unit.id, amount, caster.id);
  applyOnHeal(caster, bond.unit, amount, sink, landed);
  sink?.log(`  ${statusName(AuraType.Lightbond)}: ${unitName(bond.unit)} +${landed}`, FIREFLY_AMBER);
  return { unitId: bond.unit.id, at: bond.unit.position, amount: landed };
}

// ─── Other events ─────────────────────────────────────────────────────────────

/**
 * What a summon's arrival does to the ground it lands on.
 *
 * Lives here for the reason the rest of this file does: both execution paths
 * summon, and an arrival blast that fired for the player and not the AI is
 * exactly the drift this module exists to prevent. Scaled off the *summon's*
 * own attack, so the number belongs to the creature rather than to whoever
 * called it.
 */
export function applySummonArrival(
  spec: SummonArrivalSpec,
  summoned: CombatUnit[],
  sink?: EventSink,
): void {
  const store = useCombatStore.getState();

  for (const arrival of summoned) {
    const amount = Math.max(1, Math.round(arrival.stats.attack * spec.amount));
    // Read fresh per arrival: an earlier one in the same cast may already have
    // finished somebody standing in this radius.
    const caught = useCombatStore.getState().units.filter(
      (u) =>
        u.currentHp > 0 &&
        u.id !== arrival.id &&
        hexDistance(u.position, arrival.position) <= spec.radius &&
        (spec.kind === 'damage' ? u.isPlayer !== arrival.isPlayer : u.isPlayer === arrival.isPlayer),
    );

    for (const unit of caught) {
      if (spec.kind === 'damage') {
        const arrived = store.damageUnit(unit.id, amount, arrival.id);
        sink?.log(`  ${unitName(unit)} -${arrived.hpLost}`, '#ff8a1e');
        playDeathEventsAt(arrived.deathEvents, sink);
      } else {
        store.healUnit(unit.id, amount);
        sink?.log(`  ${unitName(unit)} +${amount}`, '#44dd88');
      }
      if (spec.effect) {
        applySkillStatus(
          arrival,
          unit.id,
          {
            type: spec.effect.type,
            magnitude: resolveEffectMagnitude(spec.effect.type, spec.effect.magnitude, arrival),
            duration: spec.effect.duration,
            sourceUnitId: arrival.id,
          },
          sink,
        );
      }
    }
  }
}

export function applyOnTurnStart(
  unit: CombatUnit,
  sink?: EventSink,
  movedLastTurn = false,
): void {
  const { preparedAttacks, units } = useCombatStore.getState();
  const threatened = preparedAttacks.some((p) => threatensUnit(p, unit, units));
  fire('onTurnStart', unit, { movedLastTurn, threatened }, sink);
}

/**
 * The turn's effect tick has run: the passives that lay an aura for this turn do so now
 * (Settle In's charge, Grounded Focus). `unit` is the pre-tick snapshot, which is what
 * carries `previousTurnStationary`.
 */
export function applyOnTurnStartAura(unit: CombatUnit, sink?: EventSink): void {
  fire('onTurnStartAura', unit, {}, sink);
}

/**
 * A detonating skill just spent a Burn on `target` (the unit as it stood before
 * the strike, Burn still on it). Detonation answers by lighting the hex. Called by
 * both execution paths for the same reason every hook here is.
 */
export function applyOnDetonate(
  attacker: CombatUnit,
  target: CombatUnit,
  spent: StatusEffectType,
  sink?: EventSink,
): void {
  const burn = target.activeEffects.find((e) => e.type === spent);
  if (!burn) return;
  fire('onDetonate', attacker, { other: target, burn }, sink);
}

/**
 * A damaging cast finished. `struck` is every enemy it hit as it stood before the
 * blows. Fires `onCast` once on the caster, which is how Overload sees the whole
 * cast rather than one target at a time. Called by `resolveSkillUse`, which every
 * caster's cast goes through, so an enemy carrying a cast passive raises it too.
 */
export function applyOnCast(
  caster: CombatUnit,
  skill: HeroSkill,
  struck: CombatUnit[],
  sink?: EventSink,
): void {
  if (struck.length === 0) return;
  const live = unitById(useCombatStore.getState().units, caster.id) ?? caster;
  fire('onCast', live, { skill, struck }, sink);
}

/**
 * A cast finished. Returns whether a passive granted the caster a free step, in which
 * case the turn waits for it. `canStep` is the board question the pure passive cannot ask.
 */
export function applyOnSkillResolved(
  caster: CombatUnit,
  skill: HeroSkill,
  cast: { restoredByCast: boolean; damagedEnemy: boolean; healedAlly?: boolean; spendsAction: boolean },
  sink?: EventSink,
): boolean {
  const live = unitById(useCombatStore.getState().units, caster.id) ?? caster;
  const canStep = (range: number) => {
    const state = useCombatStore.getState();
    return !isRooted(live) && getMovementRange({ ...live, repositionCap: range }, state.units, state.hazards).length > 0;
  };
  return fire('onSkillResolved', live, { skill, ...cast, canStep }, sink).repositioned;
}

export function applyOnMove(unit: CombatUnit, sink?: EventSink): void {
  fire('onMove', unit, {}, sink);
}

/**
 * A heal landing, and the two things a mastery can hang off one.
 *
 * Here rather than at the heal itself for the reason the whole module exists:
 * `skillResolution` and the Templar's spill both mend allies, and a rider that
 * fired for the button and not for the spill is exactly the drift this file was
 * written to prevent.
 */
export function applyOnHeal(
  healer: CombatUnit,
  target: CombatUnit,
  amount: number,
  sink?: EventSink,
  /**
   * HP the heal actually put back. A heal on someone at full health restores
   * nothing, and Oath rewards only a heal that did something — so every real
   * caller passes what `healUnit` returned. Defaults to `amount` for the
   * callers that only ever heal the wounded, which keeps their old reading.
   */
  restored: number = amount,
): void {
  fire('onHeal', { ...healer, stats: getCombatEffectiveStats(healer) }, { other: target, amount, restored }, sink);

  const mods = healer.masteryModifiers;
  if (!mods || amount <= 0) return;
  const store = useCombatStore.getState();

  /**
   * Mana back to whoever was mended — and never to the healer themselves.
   *
   * "An ally", literally. A heal that refunds its own caster more mana than it
   * cost is an infinite pool with a button on it, and the cheap at-will mends
   * are precisely the ones that would be pressed for it. Excluding the caster
   * makes that impossible rather than a tuning constraint somebody has to
   * remember every time a heal's cost moves.
   */
  if (mods.healRestoresMana && target.id !== healer.id) {
    store.restoreMana(target.id, mods.healRestoresMana);
    sink?.log(`  ${unitName(target)} +${mods.healRestoresMana} ${resourceShort(target.resource)}`, resourceColor(target.resource));
  }

  /**
   * A turn of guard on anyone mended, the healer included — there is no loop to
   * close here, so the exclusion above would only be an arbitrary hole.
   *
   * `2`, not `1`. Effects tick at the *start* of the wearer's turn and the tick
   * decrements before they act, so a duration of 1 is stripped on the way in
   * and the buff never once applies — the same trap three afflictions fell into
   * before it was written down. "Exactly one turn" is spelled 2.
   */
  if (mods.healGrantsDefense) {
    store.applyEffect(target.id, {
      type: AuraType.DefenseBuff,
      magnitude: mods.healGrantsDefense,
      duration: 2,
      sourceUnitId: healer.id,
    });
    announceStatus(target.id, AuraType.DefenseBuff, sink);
  }

  // Advanced (level 21–25): Druid. Overflowing Grace: what the heal was worth
  // beyond the HP it put back closes over the ally as a Barrier
  const ward = overhealBarrier(healer, amount, restored);
  if (ward > 0) {
    store.applyEffect(target.id, {
      type: AuraType.Barrier, magnitude: ward, duration: BALANCE.OVERHEAL_BARRIER_TURNS, sourceUnitId: healer.id,
    });
    announceStatus(target.id, AuraType.Barrier, sink);
  }
}

/**
 * A cleanse that took something off an ally — the other half of "a heal that
 * did something", for Oath.
 *
 * Raised as an `onHeal` with `amount: 0`, so the passives that read a heal's
 * size (Lifebloom) stay quiet and the ones that read `cleansed` fire. Called
 * only when at least one affliction was actually removed: cleansing someone
 * who was clean is not an event.
 */
export function applyOnCleanse(
  healer: CombatUnit,
  target: CombatUnit,
  removed: number,
  sink?: EventSink,
): void {
  if (removed <= 0) return;
  fire('onHeal', healer, { other: target, amount: 0, restored: 0, cleansed: removed }, sink);
}

/** Say where Brimming Over's spill went, once the Burn that made it has been announced. */
function announceSpill(outcome: EffectOutcome | undefined, sink?: EventSink): void {
  if (!outcome?.spilledTo) return;
  sink?.log(`  ${t('combatLog.log.burnSpills', { name: nameOf(outcome.spilledTo) })}`, '#ff8844');
  announceStatus(outcome.spilledTo, AfflictionType.Burn, sink);
}

/**
 * Applies a skill's status to a target, and fires `onTauntApplied` when the
 * status is a taunt.
 *
 * Shared so the trigger cannot land on one execution path and not the other —
 * the exact failure the rest of this file exists to prevent.
 */
export function applySkillStatus(
  caster: CombatUnit,
  targetId: string,
  effect: ActiveEffect,
  sink?: EventSink
): EffectOutcome | undefined {
  const store = useCombatStore.getState();
  const victim = unitById(store.units, targetId);

  // Deep Cold: a Chill laid from beyond immediate reach lasts longer. Settled
  // before anything reads the effect, so the preview, the stored duration and the
  // Freeze check below all see the one length.
  if (victim && effect.type === AfflictionType.Chill) {
    const extra = deepColdExtraTurns(caster, victim);
    if (extra > 0) effect = { ...effect, duration: effect.duration + extra };
  }
  const becomesFreeze = !!victim && chillUpgrades(victim, effect);
  const hadFreeze = !!victim && hasEffect(victim, AfflictionType.Freeze);
  // A boss the Freeze would have bounced off becomes Brittle instead: no "IMMUNE",
  // because something did land. Refreshing a mark it already wears is no new setup.
  const becomesBrittle = !!victim && chillMakesBrittle(
    victim, effect, caster.isPlayer, ignoresDisable(victim, AfflictionType.Freeze),
  );
  const hadBrittle = !!victim && hasEffect(victim, AfflictionType.Brittle);

  // An accepted interrupt cancels the preparation whether or not the status
  // is allowed to stay: a boss ignores a Stun as an ordinary disable, and the
  // Stun still breaks the one attack whose spec lists it. Settled before the
  // application so a refusal below cannot swallow it, and only ever cancels
  // what the spec names — the boss's other warnings are untouched.
  if (victim) {
    // A Chill that freezes interrupts as the Freeze it is: the Hydromancer's own way
    // of answering a warning that accepts Stun is a second Chill.
    const landing = becomesFreeze ? AfflictionType.Freeze : effect.type;
    for (const prepared of interruptedBy(targetId, landing, store.preparedAttacks)) {
      store.removePreparedAttack(prepared.id, 'broken');
      sink?.log(`  ${t('combatLog.log.interrupts', { name: unitName(caster), target: unitName(victim), skill: skillName(prepared.skill) })}`, '#ffdd66');
      sink?.float?.(victim.position, t('combatLog.float.interrupted'), '#ffdd66');
      // A broken Skyfire leaves the Dragon exposed (a no-op for any other warning)
      onDragonInterrupted(prepared, victim, { log: (text, color) => sink?.log(text, color) });
    }
    if (!becomesBrittle && ignoresDisable(victim, landing)) {
      const label = statusName(landing, landing);
      sink?.log(`  ${t('combatLog.log.ignores', { name: unitName(victim), status: label })}`, '#aaaaaa');
      sink?.float?.(victim.position, t('combatLog.float.immune'), '#aaaaaa');
    }
  }

  // One bond per Firefly: a new Lightbond lifts the one it laid on anybody else
  if (effect.type === AuraType.Lightbond) {
    for (const held of store.units) {
      if (held.id !== targetId && held.activeEffects.some((e) => e.type === AuraType.Lightbond && e.sourceUnitId === caster.id)) {
        store.removeEffect(held.id, AuraType.Lightbond);
      }
    }
  }

  const outcome = store.applyEffect(targetId, effect);

  // Crumble rode in on the control: say what it cracked, once, as it lands
  if (effect.type === AfflictionType.Stun || effect.type === AfflictionType.Root) {
    const held = unitById(useCombatStore.getState().units, targetId);
    const control = held?.activeEffects.find((e) => e.type === effect.type);
    if (held && control?.crumble && control.sourceUnitId === caster.id) {
      sink?.log(`  ${t('combatLog.log.crumble', { source: passiveName('crumble'), name: unitName(held), amount: control.crumble, status: statusName(effect.type) })}`, '#c8a878');
    }
  }

  // A charge does not survive being stunned, silenced or taunted: the status has
  // to have actually stood, so a refused or immune application breaks nothing.
  if (CHARGE_BREAKERS.includes(effect.type)) {
    const holder = unitById(useCombatStore.getState().units, targetId);
    const held = holder && heldCharge(holder);
    if (holder && held && hasEffect(holder, effect.type)) {
      store.removeEffect(targetId, held.type);
      // Aimed Shot's aim breaks the same way; its cooldown was already started at the aim
      const aim = held.type === AuraType.Aiming;
      sink?.log(`  ${t(aim ? 'combatLog.log.aimBreaks' : 'combatLog.log.chargeBreaks', { name: unitName(holder) })}`, aim ? MARKSMAN_YELLOW : '#aaccff');
      sink?.float?.(holder.position, t(aim ? 'combatLog.float.aimBroken' : 'combatLog.float.chargeBroken'), aim ? MARKSMAN_YELLOW : '#aaccff');
    }
  }

  // What landed, not what was asked for. A Chill on an already-chilled unit
  // arrives as a Freeze, and announcing the request meant announcing a status
  // that is not there — `announceStatus` then correctly found nothing and said
  // nothing, so the upgrade the Hydromancer's loop is built on was silent.
  announceStatus(targetId, outcome?.landed ?? effect.type, sink);
  announceSpill(outcome, sink);

  // An enemy that actually froze: a Freeze stands on it now that did not before
  // (a boss that refused the ice, or one already frozen, is not a Freeze landing).
  // Fired on the caster; Meltwater is the only reader.
  // A boss newly made Brittle is the same setup, and fires the same event once.
  if (!hadFreeze && !(becomesBrittle && hadBrittle)) {
    const frozen = unitById(useCombatStore.getState().units, targetId);
    const iced = frozen && (hasEffect(frozen, AfflictionType.Freeze)
      || (becomesBrittle && hasEffect(frozen, AfflictionType.Brittle)));
    if (frozen && iced) {
      const source = unitById(useCombatStore.getState().units, caster.id) ?? caster;
      fire('onFreeze', source, { other: frozen }, sink);
    }
  }

  // A dose that overdosed. Logged here so both execution paths say it, and
  // returned so whichever of them has a screen can put a number on the target.
  const burst = outcome && outcome.burst > 0 ? outcome : undefined;
  if (burst) {
    sink?.log(
      `  ${t('combatLog.log.convulses', { name: nameOf(targetId), amount: burst.burst, crit: burst.crit ? t('combatLog.log.critSuffix') : '' })}`,
      burst.crit ? '#ffcc44' : '#88cc44',
    );
  }

  if (effect.type !== AfflictionType.Taunt) return burst;

  // Confirm it actually landed: DebuffImmunity silently drops afflictions, and
  // an Intimidating shred on an enemy that shrugged the taunt off would be a
  // free debuff from a button that did nothing
  const target = unitById(useCombatStore.getState().units, targetId);
  if (!target || !hasEffect(target, AfflictionType.Taunt)) return burst;

  fire('onTauntApplied', caster, { other: target }, sink);
  return burst;
}
