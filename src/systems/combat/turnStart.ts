import { skillName, statusName } from '@/data/gameText';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { BALANCE } from '@/data/balanceConstants';
import { hasPassive, passiveRank } from '@/systems/combat/passives';
import { settleInPen } from '@/systems/combat/passiveFormulas';
import { MARKSMAN_YELLOW } from '@/data/display/marksmanColors';
import { ActiveEffect, AfflictionType, AuraType, CombatUnit, SummonTemplateId } from '@/models/types';
import { TickEvent, useCombatStore } from '@/stores/combatStore';
import { applyOnTurnStart, applyOnTurnStartAura } from '@/systems/combat/combatEvents';
import { isDeadlocked } from '@/systems/combat/combatOutcome';
import { CombatSink } from '@/systems/combat/skillResolution';
import { isInert, unitById } from '@/systems/combat/unitLookup';
import { heldMark } from '@/systems/combat/mantis';
import { MANTIS_GREEN } from '@/data/skills/mastery/mantis';
import { combatMaxHp, settlesShape } from '@/systems/combat/forms';
import { findSummonTemplate } from '@/data/templates/summonTemplates';
import { resolveDuePrepared, resolveFallenCarriers } from '@/systems/combat/preparedResolve';
import { flushReactions } from '@/systems/combat/reactionResolve';
import { resolveWaves } from '@/systems/combat/waveResolve';
import { scriptsBeginTurn, scriptsBetweenTurns, scriptsTurnTick } from '@/systems/combat/scriptRegistry';
import { isSoulSplit } from '@/systems/combat/eliteKits';
import { beginChallengeTurn } from '@/systems/combat/factionEliteActions';
import { isBurrowed, isEncased } from '@/systems/combat/factionEliteKits';
import { isWebbed } from '@/systems/combat/yokaiKits';
import { isActionLocked } from '@/systems/combat/statusEffects';
import { pulseSanctuaries } from '@/systems/combat/sanctuary';
import { eruptAftershocks } from '@/systems/combat/aftershock';
import { resolveDeathMarks } from '@/systems/combat/assassination';
import { isLanternBeacon } from '@/systems/combat/fireflyRules';
import { tendBeacon } from '@/systems/combat/fireflyGround';
import { supportIntent } from '@/systems/combat/soundIntents';
import { activeTaunt } from '@/systems/combat/taunt';
import { STATUS_DISPLAY } from '@/data/display/statusDisplay';

/**
 * Everything that happens to a unit before it may act.
 *
 * Ordering here is load-bearing and was tuned by bug reports rather than by
 * design, so it lives in one function instead of being re-derived by every
 * driver: summon lifetime, then cooldowns, then turn-start passives, then the
 * effect tick, then the crowd-control checks.
 *
 * The caller decides what each verdict *means* — the app shows a toast and
 * calls `nextTurn`, a harness just advances — because turn order and player
 * feedback are the driver's business, not the rules'.
 */
export type TurnStart =
  /** A timed summon ran out and left the field. */
  | { kind: 'expired' }
  /** Died to a damage-over-time tick before acting. */
  | { kind: 'dead' }
  | { kind: 'stunned' }
  /**
   * Sleeping off a fatal blow (the Cave Bear's Winter Sleep). It loses the turn like a
   * stun does, but it is not a status the party applied: no cleanse reaches it.
   */
  | { kind: 'asleep' }
  /**
   * The Rime Jarl kneeling after a duel the hero survived: the turn is lost and no
   * speed-granted turn bypasses it (`AuraType.Kneeling`).
   */
  | { kind: 'kneeling' }
  /**
   * Nothing it could do — no skills, no movement. The Stoneshaper's rock waits
   * out its turns like this; the driver just passes the turn on, with no toast,
   * because a thing that is not supposed to act has not been prevented from it.
   *
   * `deadlocked` means every living unit on the board is one of these, so the
   * turn will be passed on forever. It used to ride on `frozen`, back when a
   * Freeze held until something struck it; both crowd-control locks are finite
   * now and unstick themselves, so a rock is the only thing left that never
   * acts. See `isDeadlocked`.
   */
  | { kind: 'inert'; deadlocked: boolean }
  | { kind: 'frozen' }
  /**
   * A broken Revenant's turn, spent letting its soul fragments cross (and, when
   * the last one is home, reform the body). Nothing acts, but the driver holds
   * the camera for `SOUL_BEAT_MS` instead of passing the turn at once.
   */
  | { kind: 'soul' }
  /**
   * A warned attack landed: this turn *was* that strike (`preparedResolve`), so
   * the driver passes the turn on after the beat rather than asking the unit for
   * an action it has already spent.
   */
  | { kind: 'resolved' }
  | { kind: 'act' };

/** The verdict a driver recorded for one turn: whose it was and which turn (`turnSerial`). */
export interface TurnVerdict {
  unitId: string;
  serial: number;
  kind: TurnStart['kind'];
}

/**
 * Whether a driver may ask a unit for its action now.
 *
 * The scene starts a turn (`beginTurn`) and asks the AI for an action from two
 * separate effects, and the AI's timer used to fire regardless of the verdict:
 * a Cave Bear asleep, or anything stunned on the last turn of its stun (read
 * pre-tick, so the status is already gone), still swung while the turn was
 * being handed on. The verdict for *this* turn is the rule; the lock check is
 * the backstop for a turn whose start the driver never saw.
 */
export function mayTakeAction(
  verdict: TurnVerdict | null | undefined,
  unit: CombatUnit,
  serial: number,
): boolean {
  if (unit.currentHp <= 0) return false;
  if (verdict && verdict.unitId === unit.id && verdict.serial === serial) return verdict.kind === 'act';
  return !isActionLocked(unit);
}

/**
 * Puts a list of store-returned events on the board.
 *
 * Payloads that fire without a resolver in the call stack — a Martyr seal going
 * off, a Bladestorm ring biting, a summon detonating as it burns out — hand a
 * spec back with the numbers, and this is where they are played. Positions are
 * re-read per event: an earlier one may have moved or killed the unit.
 */
function play(events: TickEvent[], sink: CombatSink): void {
  for (const ev of events) {
    if (ev.vfx) sink.vfx(ev.vfx);
    const target = unitById(useCombatStore.getState().units, ev.unitId);
    if (!target) continue;
    sink.log(`${unitName(target)} ${ev.log ?? ev.text}`, ev.color);
    // Just before its number, the order every strike keeps, so a scene can time
    // the two together — see `CombatSink.sound`.
    if (ev.sound) sink.sound?.(ev.sound);
    sink.float(target.position, ev.text, ev.color);
  }
}

/**
 * Everything that happens to a unit before it may act.
 *
 * Two things come first, whoever's turn it is, because both belong *between*
 * turns: Reactions owed for the last action are answered (`reactionResolve`),
 * then a wave the last action earned arrives (`waveResolve`). A speed-granted
 * bonus turn (`turnTempo`) then takes the short road — flags reset and nothing
 * else, since it is extra action and never extra time — and every regular turn
 * takes the long one below. A turn the unit loses to a disable loses its bonus
 * turn with it.
 */
export function beginTurn(unitId: string, sink: CombatSink): TurnStart {
  flushReactions(sink);
  resolveWaves(sink);
  // What the last action earned or changed for a scripted boss — the Legion
  // answering a burst, the black sun widening, a chain or a fracture following its heroes
  scriptsBetweenTurns(sink);
  // A carried warning whose carrier fell since the last turn began lands at once, before anyone
  // acts: the Furnace Heart bursts on the hex its carrier fell on
  resolveFallenCarriers(sink);
  // An Apex shape that ran out with the last turn is seen to go
  drawApexReversions(sink);

  const store = useCombatStore.getState();
  const bonus = (store.bonusTurn.active || store.furyExtra.active) && store.currentUnitId === unitId;
  const verdict = bonus ? beginBonusTurn(unitId, sink) : beginRegularTurn(unitId, sink);
  if (verdict.kind !== 'act' && verdict.kind !== 'resolved') store.cancelBonusTurn(unitId);
  return verdict;
}

/**
 * The Apex shape ends in `nextTurn`, which has no screen; the reversion is drawn
 * here, as the next turn starts: a log line and the shift ring on the Druid.
 */
function drawApexReversions(sink: CombatSink): void {
  const store = useCombatStore.getState();
  for (const unit of store.units.filter((u) => u.apexReverted)) {
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === unit.id ? { ...u, apexReverted: undefined } : u)),
    }));
    if (unit.currentHp <= 0) continue;
    sink.log(t('combatLog.log.apexFades', { name: unitName(unit), form: statusName(AuraType.Apex) }), '#9dff6a');
    // Heard as a shape given up by hand is: the beast withdrawing
    sink.sound?.(supportIntent(unit, { gesture: 'shiftReturn' }));
    sink.vfx({
      kind: 'nova', delivery: 'spell', casterId: unit.id, casterPos: unit.position, targetCoord: unit.position,
      hitUnitIds: [], hitCoords: [unit.position], color: '#9dff6a',
    });
  }
}

/**
 * A bonus turn: a fresh set of actions and nothing else. No cooldown, effect,
 * summon-lifetime, objective or Reaction clock moves, and a warned attack is
 * not landed — its response window is counted in the responders' turns, and
 * the caster's extra action does not shorten it.
 */
function beginBonusTurn(unitId: string, sink: CombatSink): TurnStart {
  const store = useCombatStore.getState();
  const unit = unitById(store.units, unitId);
  if (!unit || unit.currentHp <= 0) return { kind: 'dead' };
  store.beginTurnFlags(unit.id);
  armHeldAims(unit.id);
  if (isSoulSplit(unit) || isBurrowed(unit) || isEncased(unit) || isWebbed(unit)) return { kind: 'inert', deadlocked: false };
  if (unit.activeEffects.some((e) => e.type === AuraType.Kneeling)) return { kind: 'kneeling' };
  if (unit.activeEffects.some((e) => e.type === AuraType.Slumber)) return { kind: 'asleep' };
  if (unit.activeEffects.some((e) => e.type === AfflictionType.Stun)) return { kind: 'stunned' };
  if (unit.activeEffects.some((e) => e.type === AfflictionType.Freeze)) return { kind: 'frozen' };
  remindImpairments(unit, sink);
  return { kind: 'act' };
}

/**
 * A bonus turn arms an Aimed Shot aim or a Marked Prey mark laid before it: the
 * release may be fired now. Without this the extra turn was wasted — the aim locks
 * every other skill and moving drops it, and no clock ticks on a bonus turn.
 */
function armHeldAims(unitId: string): void {
  const arms = (e: ActiveEffect) => (e.type === AuraType.Aiming || e.type === AuraType.MarkedPrey) && !e.armed;
  useCombatStore.setState((s) => ({
    units: s.units.map((u) => (u.id === unitId && u.activeEffects.some(arms)
      ? { ...u, activeEffects: u.activeEffects.map((e) => (arms(e) ? { ...e, armed: true } : e)) }
      : u)),
  }));
}

/**
 * A companion's clock (the Thunder Elemental): counted on its owner's regular turns,
 * never on a bonus turn, and not on the turn it was summoned — `tickCompanionLifetime`
 * says how the count runs. Its statuses tick here too, so a Burn on it burns and a
 * Stun on it wears off, though it has no turn for either to cost.
 */
function tickCompanions(ownerId: string, sink: CombatSink): void {
  const store = useCombatStore.getState();
  // A companion outlives nobody: one whose owner has fallen fades with them
  for (const orphan of store.units.filter((u) => u.companion && u.currentHp > 0
    && !(unitById(store.units, u.summonedBy ?? '')?.currentHp ?? 0))) {
    store.damageUnit(orphan.id, orphan.currentHp, undefined, { bypassProtection: true });
    sink.log(t('combatLog.log.fadesAway', { name: unitName(orphan) }), '#aa88ff');
  }
  for (const companion of store.units.filter((u) => u.companion && u.summonedBy === ownerId && u.currentHp > 0)) {
    // A Lantern Beacon has no lifetime to count: it heals, then burns (`fireflyGround`)
    if (isLanternBeacon(companion)) {
      const owner = unitById(useCombatStore.getState().units, ownerId);
      if (owner && tendBeacon(companion, owner, sink)) play(store.tickEffectsOnUnit(companion.id), sink);
      continue;
    }
    if (store.tickCompanionLifetime(companion.id) === 'expired') {
      sink.log(t('combatLog.log.fadesAway', { name: unitName(companion) }), '#aa88ff');
      sink.float(companion.position, t('combatLog.float.fades'), '#aa88ff');
      continue;
    }
    // Its clock, said where it stands: the companion has no turn of its own on
    // which the player could otherwise read it
    // (this turn included, so the third reads as the last)
    const left = unitById(useCombatStore.getState().units, companion.id)?.summonTurnsLeft ?? 0;
    sink.status(companion.position, left > 0 ? t('combatLog.float.turnsLeft', { count: left + 1 }) : t('combatLog.float.lastTurn'), '#8fd8ff');
    play(store.tickEffectsOnUnit(companion.id), sink);
  }
}

/** What leaves a turn playable but narrower, reminded as it begins (PT-02b). */
const REMINDED_IMPAIRMENTS = [AfflictionType.Root, AfflictionType.Silence] as const;

/**
 * At the start of a turn the unit can play, say what still binds it: the status
 * floated over it, as when it landed, and a log line. Taunt names its taunter
 * (`activeTaunt`, so a taunt by the fallen says nothing); Root and Silence say
 * themselves. Lost turns are told by the driver, not here. Writ and Geas are
 * charges on the next cast rather than limits on the turn, and are left out.
 */
export function remindImpairments(unit: CombatUnit, sink: CombatSink): void {
  const live = unitById(useCombatStore.getState().units, unit.id);
  if (!live || live.currentHp <= 0) return;
  const taunter = activeTaunt(live, useCombatStore.getState().units);
  if (taunter) {
    const color = STATUS_DISPLAY[AfflictionType.Taunt].color;
    sink.status(live.position, statusName(AfflictionType.Taunt), color);
    sink.log(t('combatLog.log.taunted', { name: unitName(live), taunter: unitName(taunter) }), color);
  }
  for (const type of REMINDED_IMPAIRMENTS) {
    if (!live.activeEffects.some((e) => e.type === type)) continue;
    const color = STATUS_DISPLAY[type].color;
    sink.status(live.position, statusName(type), color);
    sink.log(t('combatLog.log.impaired', { name: unitName(live), status: statusName(type) }), color);
  }
}

/**
 * Undying's response turns: a regular turn the Berserker can act on counts as one
 * of the two it is owed. Reached only past every lost-turn verdict (Stun, Freeze,
 * sleep, kneeling, the tomb), so a turn taken away is never spent; a turn acted
 * for the Dark Mage under Mind Control is not the player's response either. Root,
 * Silence and Taunt leave the turn playable, so it counts. Spent when the turn
 * ends (`combatStore.nextTurn`), and said overhead so the player knows when the
 * protection lifts.
 */
function markUndyingResponse(unitId: string, sink: CombatSink): void {
  const store = useCombatStore.getState();
  const unit = unitById(store.units, unitId);
  const window = unit?.activeEffects.find((e) => e.type === AuraType.UndyingWindow);
  if (!unit || !window || unit.seized) return;
  useCombatStore.setState((s) => ({
    units: s.units.map((u) => u.id !== unitId ? u : {
      ...u,
      activeEffects: u.activeEffects.map((e) => e.type === AuraType.UndyingWindow ? { ...e, responding: true } : e),
    }),
  }));
  const left = Math.round(window.magnitude);
  sink.status(unit.position, left > 1 ? t('combatLog.float.undyingLeft', { count: left }) : t('combatLog.float.undyingLast'), '#ff3b3b');
}

function beginRegularTurn(unitId: string, sink: CombatSink): TurnStart {
  const store = useCombatStore.getState();
  const unit = unitById(store.units, unitId);
  if (!unit || unit.currentHp <= 0) return { kind: 'dead' };

  /**
   * Whether this unit moved on the turn that just ended.
   *
   * Read here and threaded through deliberately, because `beginTurnFlags` on
   * the next line clears it. A passive resolver reading `self.hasMoved` gets
   * the right answer today only by accident — `unit` is a snapshot taken before
   * that write, so it is stale in exactly the way that happens to be useful,
   * and the next person to re-read the unit from the store would silently break
   * Slow Burn with no test able to see it.
   */
  const movedLastTurn = unit.hasMoved;

  // The Dark Mage's Mind Control: this hero is acting for the Mage, and the party is told so
  // as the turn begins — the log, and the banner, so it is never an unexplained attack
  if (unit.seized) {
    const holder = unit.activeEffects.find((e) => e.type === AfflictionType.MindControl);
    const mage = holder?.sourceUnitId ? unitById(store.units, holder.sourceUnitId) : undefined;
    const line = mage
      ? t('combatLog.log.actsFor', { name: unitName(unit), master: unitName(mage) })
      : t('combatLog.log.actsForMage', { name: unitName(unit) });
    sink.log(line, '#c24dff');
    sink.announce?.(line);
  }

  // First, before anything else can write to `units`: a unit reaching its own
  // turn must be able to act. See `beginTurnFlags` for why `nextTurn` clearing
  // them is not enough on its own.
  store.beginTurnFlags(unit.id);

  // A hero sealed in the Colossus's tomb has no turn: nothing ticks, no cooldown counts, and the
  // statuses they carry keep exactly the clock they had until they are freed
  // A hero in the Jorogumo's web likewise
  if (isEncased(unit) || isWebbed(unit)) return { kind: 'inert', deadlocked: false };

  // Second Nature: a regular turn begun in the same shape is a step, read by the tick
  // below too. Here rather than in `beginTurn`, so a bonus turn adds none.
  if (settlesShape(unit)) {
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => u.id === unit.id
        ? { ...u, shapeTurns: Math.min(BALANCE.SECOND_NATURE_MAX_STEPS, (u.shapeTurns ?? 0) + 1) }
        : u),
    }));
  }

  // The owner's companions have no turn of their own: their lifetime and their
  // statuses count down here, on the owner's regular turn, before the owner acts
  tickCompanions(unit.id, sink);

  // A timed summon burns one turn of its lifetime before it acts. Expiry sets
  // HP to zero, so it then leaves the field down every path a death already
  // takes — turn skipping, the victory check, unmounting the model.
  if (store.tickSummonLifetime(unit.id) === 'expired') {
    sink.log(t('combatLog.log.fadesAway', { name: unitName(unit) }), '#aa88ff');
    sink.float(unit.position, t('combatLog.float.fades'), '#aa88ff');
    // Expiry writes HP to zero directly, so the death has to be resolved here —
    // "on death from any cause" with an exception is not a rule.
    play(store.resolveDeath(unit.id), sink);
    return { kind: 'expired' };
  }

  // Burning down: a clock made of health rather than of turns, so healing
  // extends it and every source of damage cuts it short. Through `damageUnit`
  // deliberately — that funnel is what makes Barrier, Undying and the death
  // burst all behave without a second code path.
  const decay = findSummonTemplate(unit.templateId as SummonTemplateId)?.decayFraction;
  if (decay && unit.summonedBy !== undefined) {
    const loss = Math.ceil(combatMaxHp(unit) * decay);
    const result = store.damageUnit(unit.id, loss);
    sink.float(unit.position, `-${result.hpLost}`, '#ff8a1e');
    if (result.deathEvents) play(result.deathEvents, sink);
    const burned = unitById(useCombatStore.getState().units, unit.id);
    if (!burned || burned.currentHp <= 0) {
      sink.log(t('combatLog.log.burnsOut', { name: unitName(unit) }), '#ff8a1e');
      return { kind: 'dead' };
    }
  }

  // Whatever safety the unit bought itself lasts until it acts again, which is
  // now. Cleared here rather than by a duration: a duration would tick on the
  // caster's own schedule and expire early against anything faster.
  if (unit.untargetable) store.setUntargetable(unit.id, false);

  // Cooldowns tick at the start of the unit's own turn, so "3 turns" means
  // three of *its* turns rather than three global turn-order slots — which
  // would otherwise make a fast unit's cooldowns run out sooner than a slow
  // one's for the same number.
  store.tickCooldowns(unit.id);

  // A prepared Reaction counts down on its owner's regular turns. One that
  // reaches zero unused is simply gone: the action it cost is not refunded.
  for (const spent of store.tickReactionsFor(unit.id)) {
    sink.log(t('combatLog.log.reactionUnused', { name: unitName(unit), skill: skillName(spent.skill) }), '#7a8fa6');
  }

  // Read pre-tick: a Stun of duration N must cost turns N..1, and the tick
  // below decrements it — reading afterwards would hand the final turn back.
  //
  // Freeze is read the same way and for the same reason. It used to be checked
  // *after* the tick, which was correct only while it was authored at the `99`
  // sentinel and left by damage rather than by a clock; on a real duration that
  // reading silently costs one turn fewer than the number says, which is the
  // `duration: 1` trap three afflictions have already fallen into. Two turns of
  // ice is spelled `FREEZE_DURATION: 2` and nothing here removes it — the
  // ordinary decrement retires it.
  const wasStunned = unit.activeEffects.some((e) => e.type === AfflictionType.Stun);
  const wasFrozen = unit.activeEffects.some((e) => e.type === AfflictionType.Freeze);
  // Asleep is read pre-tick for the same reason: a sleep of N turns costs N turns, and the
  // tick that retires it is the one that wakes the sleeper at full health
  const wasAsleep = unit.activeEffects.some((e) => e.type === AuraType.Slumber);
  // And the Jarl's kneeling, for the same reason: one turn lost is a duration of 1
  const wasKneeling = unit.activeEffects.some((e) => e.type === AuraType.Kneeling);

  // Passives that fire at the start of the turn, before the effect tick — a
  // regenerating unit should get its heal before a poison takes it down.
  applyOnTurnStart(unit, sink, movedLastTurn);

  // Marked Prey's mark, read before the tick that may retire it
  const markBefore = heldMark(unit);
  play(store.tickEffectsOnUnit(unit.id), sink);
  store.removeEffect(unit.id, AuraType.GroundedFocus);
  // Settle In: one charge, laid after a turn spent without moving, re-read each turn
  store.removeEffect(unit.id, AuraType.SettledAim);
  // Aimed Shot's aim does not outlive its target
  const aim = unit.activeEffects.find((e) => e.type === AuraType.Aiming);
  if (aim) {
    const prey = useCombatStore.getState().units.find((u) => u.id === aim.aimAt);
    if (!prey || prey.currentHp <= 0 || prey.untargetable) {
      store.removeEffect(unit.id, AuraType.Aiming);
      sink.log(`  ${t('combatLog.log.losesAim', { name: unitName(unit) })}`, MARKSMAN_YELLOW);
    }
  }
  // Marked Prey's mark fades unreleased, and does not outlive its prey
  if (markBefore) {
    const held = unitById(useCombatStore.getState().units, unit.id);
    const prey = useCombatStore.getState().units.find((u) => u.id === markBefore.aimAt);
    if (held && !heldMark(held)) {
      sink.log(`  ${prey
        ? t('combatLog.log.markFades', { name: unitName(unit), target: unitName(prey) })
        : t('combatLog.log.markFadesPrey', { name: unitName(unit) })}`, MANTIS_GREEN);
    } else if (!prey || prey.currentHp <= 0) {
      store.removeEffect(unit.id, AuraType.MarkedPrey);
      sink.log(`  ${t('combatLog.log.markDropped', { name: unitName(unit) })}`, MANTIS_GREEN);
    }
  }
  // Settle In's charge and Grounded Focus: auras for this turn, laid by their passives
  applyOnTurnStartAura(unit, sink);
  // The owner's timed objectives count down on its own turns, like a cooldown
  play(store.tickObjectives(unit.id), sink);
  // Wild Sanctuary pulses on its owner's regular turns, before the ground below
  // is counted down — so its last turn still pulses (see `sanctuary`)
  pulseSanctuaries(unitById(useCombatStore.getState().units, unit.id) ?? unit, sink);
  // Aftershock: Tremor's marked ground erupts once at the start of its owner's next
  // regular turn, before the ground below is counted out (see `aftershock`)
  eruptAftershocks(unitById(useCombatStore.getState().units, unit.id) ?? unit, sink);
  // Rubble Recovery's once-per-ally allowance runs from one regular turn to the next
  if (unit.rubbleRecovered?.length) {
    useCombatStore.setState((s) => ({ units: s.units.map((u) => u.id === unit.id ? { ...u, rubbleRecovered: [] } : u) }));
  }
  // Stone's Answer's, the same way
  if (unit.stonesAnswered?.length) {
    useCombatStore.setState((s) => ({ units: s.units.map((u) => u.id === unit.id ? { ...u, stonesAnswered: [] } : u) }));
  }
  // Burning ground: lit under a hostile unit beginning its turn, and counted
  // down on its owner's turns
  play(store.tickHazards(unit.id), sink);
  // What a script lays on a unit that bites as its turn begins, whether or not it may act: the
  // Furnace Heart's burn on its carrier
  scriptsTurnTick(unitById(useCombatStore.getState().units, unit.id) ?? unit, sink);

  // Re-read after the tick — HP may have changed, and a poison can finish a
  // unit before it ever acts
  const fresh = unitById(useCombatStore.getState().units, unit.id);
  if (!fresh || fresh.currentHp <= 0) return { kind: 'dead' };

  // A Revenant lying broken between its lives does nothing but let its fragments travel:
  // each crosses its next hexes now, and the last one home decides whether it rises
  if (isSoulSplit(fresh)) {
    const marched = store.tickSoulFragments(fresh.id);
    play(marched, sink);
    // Worth a held beat: the fragments crossing and the body rising are the
    // whole passive, and both used to be over before the camera arrived
    return marched.length > 0 ? { kind: 'soul' } : { kind: 'inert', deadlocked: false };
  }

  // The Burrowmother under the sand does nothing but wait for her eruption: it lands as her
  // turn once every hero standing in the footprint has had theirs, and until then she is simply
  // not there
  if (isBurrowed(fresh)) {
    if (resolveDuePrepared(fresh.id, sink).length > 0) return { kind: 'resolved' };
    return { kind: 'inert', deadlocked: false };
  }

  // Checked before the crowd control: a rock is not stunned, it is a rock, and
  // saying so would be a toast every round about a thing working as intended.
  if (isInert(fresh)) {
    return { kind: 'inert', deadlocked: isDeadlocked(useCombatStore.getState().units) };
  }

  // Stun and Freeze each cost exactly the turns their duration says, because
  // both are read pre-tick and the normal effect decrement is what retires
  // them. Nothing here removes either.
  if (wasAsleep) {
    return { kind: 'asleep' };
  }

  if (wasKneeling) {
    return { kind: 'kneeling' };
  }

  if (wasStunned) {
    return { kind: 'stunned' };
  }

  if (wasFrozen) {
    return { kind: 'frozen' };
  }

  // A scripted boss's or elite's own turn beginning (each script's `beginTurn`): the
  // Emperor's deferred phase change and orb's Ledger, the Troll's Fury and regeneration, the
  // Dragon's heat, the Heart's feed; then every boss's turn count (`bossRegistry.turnBegun`),
  // which holds their spells back from the opening turns
  scriptsBeginTurn(fresh, sink);

  // A warning whose response window is over lands now, and is this turn's
  // action. One still owed a response waits; the caster acts normally meanwhile.
  if (resolveDuePrepared(unit.id, sink).length > 0) {
    return { kind: 'resolved' };
  }

  // Assassinate's Death Marks: read once now that the turn will be acted, after
  // every tick (a poison can push the victim into the window). An eligible victim
  // is blinked to and finished before the action, which is kept (`assassination`)
  play(resolveDeathMarks(fresh.id, sink), sink);

  // A hero the Rime Jarl has challenged and who can act now is asked; the scene puts the
  // question, and a hero nobody is steering answers by policy
  if (fresh.challenge) beginChallengeTurn(fresh, !!sink.interactive, sink);

  remindImpairments(fresh, sink);
  markUndyingResponse(fresh.id, sink);

  return { kind: 'act' };
}
