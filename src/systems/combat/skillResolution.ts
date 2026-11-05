import { skillName, statusName } from '@/data/gameText';
import { t } from '@/i18n';
import { canStrike, isAlive } from '@/systems/combat/targetLegality';
import { knifeDanceStep } from '@/systems/combat/knifeDance';
import { KNIFE_DANCE_BEAT_MS, leapsSelfMove, SPIRIT_BEAT_MS, UPHEAVAL_IMPACT_MS, EXTRACT_MS, EXTRACT_TEAR } from '@/data/display/combatMotion';
import { withDice } from '@/systems/combat/dice';
import { CombatSink, SILENT_SINK, skillLogIcon } from '@/systems/combat/combatSink';
import { rampartBlocksShot } from '@/systems/combat/ramparts';
import { crownedPreyFor, holyStrikeEligible, huntersMarkFor, sacredSealFor, isHeldFromHarm, detonationConsumes, effectLands, effectReaches, fuelTheFlameBurn, hasEffect, isCleansable, isRooted, requiresExecutable, settleMagnitude, skillEffects, skillVariantFor, strikeScales, weaponStrikes } from '@/systems/combat/statusEffects';
import { BALANCE } from '@/data/balanceConstants';
import { chargePending, rootedRefusal } from '@/systems/combat/skillAvailability';
import { chargeAura, chargeStage, heldAim } from '@/systems/combat/chargedCast';
import { MARKSMAN_YELLOW } from '@/data/display/marksmanColors';
import { AfflictionType, AuraType, CombatUnit, HeroSkill, HexCoord, MantisTurn, SkillModeId, SkillTargetType, VfxSpec, WildFormId } from '@/models/types';
import { TickEvent, useCombatStore } from '@/stores/combatStore';
import { isLightningBolt, isStormcallerSpell } from '@/data/skills/lightningSkills';
import { usePartyStore } from '@/stores/partyStore';
import { getHexesInRange, hexDistance, hexKey } from '@/utils/hexUtils';
import { dashGapClosed, resolveSelfMove, selfMoveBlocked, traceForcedMove } from '@/systems/combat/forcedMovement';
import { findStageUnit, finishedStageUnit, unitById } from '@/systems/combat/unitLookup';
import { getSkillTargets, pickRandomStrikes } from '@/systems/combat/targeting';
import { Flank, flankOf, standableFor } from '@/systems/combat/facing';
import { FLANK_COLOR, flankFloat, flankVfx } from '@/data/display/flankDisplay';
import { inArena, arcAimHex } from '@/systems/combat/arenaGeometry';
import { companionMagic, createSummonUnits, findSummonHexes } from '@/systems/combat/summoning';
import { findSummonTemplate } from '@/data/templates/summonTemplates';
import { castPrepared } from '@/systems/combat/preparedCast';
import { duelBars } from '@/systems/combat/duelRules';
import { castReaction } from '@/systems/combat/reactionCast';
import { IRON_CARAPACE_ID, bankedCarapace, carapaceCharges, carapaceMax, ironCarapaceAt, meditateChiBonus, skillAgainstTarget } from '@/systems/combat/beetle';
import { castObjectives } from '@/systems/combat/objectiveBoard';
import { struckBody } from '@/systems/combat/objectives';
import { castBarAction } from '@/systems/combat/barActionCast';
import { applySkillMode, skillModeSpec } from '@/systems/combat/skillModes';
import { basicAttackSpendsMark, calculateHealing, calculateLifesteal, resolveAttack, resolveEffectMagnitude, resolveEntryMagnitude } from '@/systems/combat/damageCalc';
import { canUseSkill } from '@/systems/combat/cooldowns';
import { castPaid } from '@/systems/combat/castRules';
import { resolveShift, shiftEndsTurn } from '@/systems/combat/wildshape';
import { WILD_FORMS } from '@/data/templates/wildForms';
import { applyAllyHealOnHit, applyLightbond, applyMote, applyPassiveOutcomes, FIREFLY_AMBER, FireflyHealOutcome, applyOnCleanse, applyOnHeal, applyOnCast, applyOnDetonate, applyOnSkillResolved, applyOnHitStatuses, applySkillStatus, applySummonArrival } from '@/systems/combat/combatEvents';
import { manaCostFor } from '@/systems/combat/manaCost';
import { chiRefill, ChiRefillSource } from '@/systems/combat/chi';
import { MEDITATE_ID } from '@/systems/combat/meditate';
import { EXECUTION_TURN, flickerLanding, harvestDamage, heldMark, isTwinReap, markedPreyCut, momentumScale, reapingCut, reapStacks, SCYTHE_TURNS, strikeLanding } from '@/systems/combat/mantis';
import { MANTIS_GREEN } from '@/data/skills/mastery/mantis';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { echoReturnBlock, leaveEcho, SHADOW_ECHO_COLOR } from '@/systems/combat/shadowEcho';
import { DEATH_MARK_COLOR, markForDeath } from '@/systems/combat/assassination';
import { cycleOfLifeBonus, growthCharges, hasPassive, passiveName, passiveRank, settleInApplies, SHADOWSTEP_ID, sharedBloomRecipient, sharpenedSteelFor } from '@/systems/combat/passives';
import { intoTheDarkTurns, markAndMoveRange, reapersBreathChi, slipstreamStep } from '@/systems/combat/passiveFormulas';
import { ownBlades } from '@/systems/combat/blades';
import { combatMaxHp } from '@/systems/combat/forms';
import { laySanctuary } from '@/systems/combat/sanctuary';
import { interceptBlow, layBastion, retribute, shieldWard, swapPlaces } from '@/systems/combat/beetleMoves';
import { layMotes } from '@/systems/combat/fireflyGround';
import { markAftershock } from '@/systems/combat/aftershock';
import { resolveVfxScale, skillVfx, launchLeadMs, preludeMs } from '@/systems/combat/vfxResolve';
import { lessonParries, noteLessonCast, noteLessonParry, noteLessonStrike } from '@/systems/combat/lastLessonWatch';
import { LESSON_RED } from '@/data/templates/lastLesson';
import { BARRIER_COLOR, CARAPACE_COLOR, CHI_COLOR, DODGE_COLOR, dodgeText } from '@/data/display/statusDisplay';
import { FLOAT_COLOR, hitFloatColor } from '@/data/display/floatColors';
import { damageTypeOf } from '@/systems/combat/damageType';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { getMovementRange } from '@/systems/combat/movement';
import { playTickEvents } from '@/systems/combat/tickEvents';
import { FLOAT_STAGGER_MS } from '@/utils/floatQueue';
import {
  afflictionIntent, launchIntent, mendIntent, moveIntent, selfMoveMode, shiftGesture, spellOf, strikeDelivery, strikeDetail,
  skillGesture, strikeIntent, strikeOutcome, supportIntent, voiced,
} from '@/systems/combat/soundIntents';
import { skillVoice } from '@/data/display/skillSounds';
import { parryText } from '@/data/templates/bossText';
import { unitName, wildFormName } from '@/data/templates/unitText';

/**
 * Using a skill, resolved away from the screen.
 *
 * This lived inside `CombatScene`'s arena component for most of the project's
 * life, which made the rules of the game unreachable from anything that is not
 * a mounted React tree — no end-to-end test could drive a fight, and no tuning
 * harness could run one. Everything here is store writes and pure systems, so
 * it runs equally well under Jest, under the Vite harness and in the app.
 *
 * What stayed behind in the component is genuinely presentational: projecting a
 * hex to screen space, the floating-number pool, the log view and the VFX
 * layer. Those arrive through `CombatSink`.
 */

export { SILENT_SINK };
export type { CombatSink };

export type SkillRefusal =
  /** Mana, cooldown or Silence — the same check the HUD and the AI make. */
  | 'unusable'
  | 'blink-blocked'
  /** A gap-closer with nowhere to land: every hex beside the target is taken. */
  | 'no-landing'
  /**
   * Root, against a skill that has to move the caster to do anything.
   *
   * Its own refusal rather than borrowing `no-landing` or `blink-blocked`,
   * because those describe the board and this describes the caster — "No way
   * in" on an enemy standing alone in the open reads as a bug.
   */
  | 'rooted'
  | 'no-summon-room'
  | 'no-targets';

export interface SkillResult {
  ok: boolean;
  refusal?: SkillRefusal;
  /** Player-facing reason, ready for a toast. */
  message?: string;
  /**
   * Whether the caster's turn is over.
   *
   * `false` on a Frenzy kill, which refunds the action. The caller decides what
   * that means — the app resets the targeting UI, a headless driver simply lets
   * the same unit act again — because phase and highlight state are the
   * player's problem and not the rules'.
   */
  endsTurn: boolean;
}

/** A struck unit's log line: its name, the damage, and the critical mark when it was one. */
const critSuffix = (crit: boolean | undefined): string => (crit ? t('combatLog.log.critSuffix') : '');
const hitLine = (target: CombatUnit, damage: number, crit: boolean | undefined): string =>
  t('combatLog.log.hit', { name: unitName(target), damage, crit: critSuffix(crit) });

const refuse = (refusal: SkillRefusal, message: string): SkillResult => ({
  ok: false,
  refusal,
  message,
  endsTurn: false,
});

/**
 * The one hex an aimed summon may land on, or none.
 *
 * The player named it, so this refuses rather than choosing somewhere else —
 * the same contract a blink has, and for the same reason: a creature placed
 * where you did not point is a different cast.
 */
function aimedSummonHex(
  caster: CombatUnit,
  skill: HeroSkill,
  targetCoord: HexCoord,
  units: CombatUnit[],
): HexCoord[] {
  if (!inArena(targetCoord)) return [];
  if (hexDistance(caster.position, targetCoord) > skill.range) return [];
  const taken = units.some(
    (u) => u.currentHp > 0 && u.position.q === targetCoord.q && u.position.r === targetCoord.r,
  );
  return taken ? [] : [targetCoord];
}

/**
 * Puts a killed unit's parting blast on the board.
 *
 * `damageUnit` hands the events back rather than drawing them, so both
 * execution paths play them themselves — the store has no screen.
 */
/** The caster is on the board and has been killed — an unknown id is not "fell". */
function casterFell(casterId: string): boolean {
  const live = unitById(useCombatStore.getState().units, casterId);
  return !!live && live.currentHp <= 0;
}

function playDeathEvents(events: TickEvent[] | undefined, sink: CombatSink): void {
  if (!events) return;
  for (const ev of events) {
    if (ev.vfx) (sink.impactVfx ?? sink.vfx)(ev.vfx);
    const target = unitById(useCombatStore.getState().units, ev.unitId);
    if (!target) continue;
    sink.log(`  ${unitName(target)} ${ev.log ?? ev.text}`, ev.color);
    // Before its number, the order every strike keeps — see `CombatSink.sound`
    if (ev.sound) sink.sound?.(ev.sound);
    sink.float(target.position, ev.text, ev.color);
  }
}

/** How a prepared attack's landing differs from an ordinary cast. */
export interface ResolveOptions {
  /**
   * This is a warned attack landing, not a cast. The costs were paid at the cast
   * and the caster may have been silenced since, so availability is not
   * re-checked; the footprint is the one that was warned, not a fresh aim; and a
   * strike that finds nobody still happened rather than being refused.
   */
  resolving?: boolean;
  /** A warning landing (`warnedLanding`), alongside `resolving`: heard as its skill's release, not its cast again. */
  landing?: boolean;
  /** The warned footprint, in place of one worked out from the caster's position. */
  fixedHexes?: HexCoord[];
  rampartNeighbor?: HexCoord;
  /** Where a push comes *from* — the caster's position at the cast, not now. */
  pushOrigin?: HexCoord;
  /**
   * The Mercy / Wrath choice for a skill that offers one (`HeroSkill.modeChoice`).
   *
   * The resolver derives the cast's numbers from it with `applySkillMode` — the
   * same function the choice panel prints from — so what was previewed is what
   * lands. Refused as `unusable` when the caster is not offered that mode, so a
   * caller cannot ask for a stance it never bought.
   */
  mode?: SkillModeId;
  /**
   * A companion's echo of its owner's spell (the Thunder Elemental). The owner paid
   * for the cast, so nothing is checked or spent; the footprint is the original's
   * (`fixedHexes`), so a target that died since is simply missed; nothing moves,
   * summons or places; and the owner's turn-shaped riders — Overload, on-cast
   * passives, Frenzy, a banked action — belong to the original alone. An echo never
   * echoes.
   */
  echo?: boolean;
  /**
   * The dice for this cast: every dodge, crit, status chance and passive proc
   * inside it, the store's poison and death-burst rolls included (see `dice`).
   * Absent, they roll `Math.random`. A fixed one makes the cast replayable.
   */
  rng?: () => number;
  /**
   * A Reaction's answer (`reactionResolve`), alongside `resolving`: it costs
   * nothing, as a landing warned attack does, but its own move still happens —
   * Carapace Leap's answer is a leap. A warned attack's footprint was fixed at
   * the cast, so its caster stays put; an answer is aimed now.
   */
  reacting?: boolean;
  /**
   * Jadeveil: Silent Hall / Fallen Order. The Last Lesson's id when this cast repeats
   * the skill its caster used on its previous turn (`lastLessonWatch`): every blow of
   * it that reaches him is parried. Set by `resolveSkillUse` itself, never by a caller.
   */
  lessonRepeat?: string;
  /**
   * Each struck hex's share of the damage (by `hexKey`), from a warned attack's landing plan
   * (`preparedAttacks.landingPlan`): a shared landing divides its damage among the bodies it
   * strikes, a blocked one lets the blocker take a stated share. A hex not listed takes it whole.
   */
  shares?: Readonly<Record<string, number>>;
}

/** How long after the original cast a companion's echo is drawn, so the two read as two sources. */
export const ECHO_DELAY_MS = 380;

export function resolveSkillUse(
  caster: CombatUnit,
  skill: HeroSkill,
  targetCoord: HexCoord,
  sink: CombatSink,
  opts: ResolveOptions = {},
): SkillResult {
  // Jadeveil: Silent Hall / Fallen Order — a unit's own cast is remembered by the
  // Last Lesson, and one repeating its last turn's skill is parried
  const own = !opts.resolving && !opts.echo && !opts.reacting;
  const lessonRepeat = own ? lessonParries(caster, skill) : undefined;
  const result = withDice(opts.rng, () => resolveCast(caster, skill, targetCoord, sink, {
    ...opts, ...(lessonRepeat && { lessonRepeat }),
  }));
  if (own && result.ok) noteLessonCast(caster, skill);
  return result;
}

function resolveCast(
  caster: CombatUnit,
  skill: HeroSkill,
  targetCoord: HexCoord,
  sink: CombatSink,
  opts: ResolveOptions,
): SkillResult {
  const store = useCombatStore.getState();
  const units = store.units;
  if (rampartBlocksShot(skill, caster.position, targetCoord, units)) return refuse('no-targets', t('combatLog.refuse.rampart'));
  // Solid ground (rubble, black glass) is cover as a rampart is
  if (rampartBlocksShot(skill, caster.position, targetCoord, units, store.hazards)) return refuse('no-targets', t('combatLog.refuse.cover'));

  // A charged skill is its release while the charge is held. Settled before the
  // usability check, because the release is what costs (nothing) and cools down.
  skill = chargeStage(caster, skill);
  if (!opts.resolving && !opts.echo && skill.chargePending) return refuse('unusable', chargePending());

  // Mana, cooldown and Silence in one check — the same one the HUD and the AI
  // ask, so a skill can never be pressable there and refused here
  if (!opts.resolving && !opts.echo && !canUseSkill(caster, skill)) return refuse('unusable', t('combatLog.refuse.cannotUse'));

  // What a fight lends the bar (Pass the Heart) is cast its own way, and the action is spent on it
  const lent = castBarAction(caster, skill, targetCoord, units, sink);
  if (lent === false) return refuse('no-targets', t('combatLog.refuse.cannotPass'));
  if (lent) return { ok: true, endsTurn: true };

  // A chosen mode is applied before anything reads the skill, so the strike, the
  // incidental heal and every rider below see the one derived copy. Same id and
  // same cooldown: the cooldown and the mana are spent against `skill.id`.
  if (opts.mode) {
    if (!skillModeSpec(caster, skill, opts.mode)) {
      return refuse('unusable', t('combatLog.refuse.modeUnavailable'));
    }
    skill = applySkillMode(caster, skill, opts.mode);
  }

  // A Reaction spends the turn on a conditional answer and strikes nobody now
  // (see `reactions`). Handled before anything reads a target: it has none.
  if (skill.reaction && !opts.resolving) {
    // A Reaction on one named ally is cast on the living ally at the aim
    const ward = units.find(
      (u) => u.currentHp > 0 && u.position.q === targetCoord.q && u.position.r === targetCoord.r,
    );
    const cast = castReaction(caster, skill, (text, color) => sink.log(text, color), ward);
    if (!cast.ok) {
      return cast.refusal === 'needs-ward'
        ? refuse('no-targets', t('combatLog.refuse.allyInRange'))
        : refuse('unusable', t('combatLog.refuse.reactionHeld'));
    }
    sink.vfx({
      kind: 'buff', delivery: 'spell',
      casterId: caster.id,
      casterPos: caster.position,
      targetCoord: caster.position,
      hitUnitIds: [caster.id],
      hitCoords: [caster.position],
      color: skill.vfxColor ?? '#9ad0ff',
      durationScale: resolveVfxScale(skill),
      ...(skill.vfxPrelude && { prelude: skill.vfxPrelude }),
    });
    // A guard taken up is heard as a ward going up, unless the skill names its own move (a shot readied)
    const readied = skillGesture(skill);
    sink.sound?.(supportIntent(caster, readied ? { gesture: readied } : { family: 'ward' }, skillVoice(skill.id)));
    return { ok: true, endsTurn: true };
  }

  // A multipurpose skill becomes its other self before anything else reads it,
  // so the whole function below — targeting, damage, statuses, the tooltip's
  // numbers — sees one skill rather than branching on occupancy in six places.
  const occupant = units.find(
    (u) => u.currentHp > 0 && u.position.q === targetCoord.q && u.position.r === targetCoord.r,
  );
  skill = skillVariantFor(skill, !!occupant && occupant.isPlayer !== caster.isPlayer);
  // Grip and Throw on what can be neither thrown nor stunned is its heavier blow
  // alone — decided once, here, for the same reason as the variant above
  skill = skillAgainstTarget(skill, occupant && occupant.isPlayer !== caster.isPlayer ? occupant : undefined);
  // Hardened Shell's Iron Carapace: a Taunt from beside the target, a free dash-strike from further off
  skill = ironCarapaceAt(caster, skill, targetCoord);
  // What this cast costs against the unit it is aimed at, read now: a detonating
  // skill spends the target's Burn, and the price depends on the pile it found.
  // The same function the skill inspector prints, so the two agree.
  const manaToPay = manaCostFor(
    caster, skill, occupant && occupant.isPlayer !== caster.isPlayer ? occupant : undefined,
  );
  // How its blows arrive, for the ear — read off the resolved variant, so
  // Shadowstep's stab and its blink are each heard as what they are.
  const delivery = strikeDelivery(skill, caster);

  // The rule behind the highlights, checked here too — the AI aims by its own
  // scoring and never asks the highlight pass anything
  if (skill.targetSide) {
    const wantsAlly = skill.targetSide === 'ally';
    const valid =
      !!occupant &&
      occupant.id !== caster.id &&
      (occupant.isPlayer === caster.isPlayer) === wantsAlly;
    if (!valid) {
      return refuse('no-targets', t(wantsAlly ? 'combatLog.refuse.aimAlly' : 'combatLog.refuse.aimEnemy'));
    }
  }
  // A heal that also lands on its caster still needs a body to be aimed at: the
  // caster's own hex is always in its footprint, so an empty hex would otherwise heal
  if (skill.healsCaster && !(occupant && occupant.isPlayer === caster.isPlayer && !occupant.objective)) {
    return refuse('no-targets', t('combatLog.refuse.aimAllyOrSelf'));
  }

  // Aimed Shot's first use: aim at one enemy, deal nothing. The mana is paid now
  // and the cooldown starts now, one turn longer, so it runs from the release
  // (which ignores it). See `chargedCast`.
  if (skill.charge?.aimed && !skill.releasing && !opts.resolving) {
    const aimed = occupant && occupant.isPlayer !== caster.isPlayer && !occupant.objective ? occupant : undefined;
    if (!aimed) return refuse('no-targets', t('combatLog.refuse.aimEnemy'));
    if (hexDistance(caster.position, aimed.position) > skill.range) return refuse('no-targets', t('combatLog.refuse.outOfRange'));
    store.applyEffect(caster.id, {
      type: AuraType.Aiming, magnitude: 1, duration: BALANCE.CHARGE_DURATION,
      sourceUnitId: caster.id, aimAt: aimed.id,
    });
    if (manaToPay > 0) store.spendMana(caster.id, manaToPay);
    store.startCooldown(caster.id, { ...skill, cooldown: (skill.cooldown ?? 0) + 1 });
    store.setFacing(caster.id, aimed.position);
    sink.log(`${unitName(caster)}: ${skillName(skill)}`, '#ffffff', skillLogIcon(skill));
    sink.log(`  ${t('combatLog.log.takesAim', { name: unitName(caster), target: unitName(aimed) })}`, MARKSMAN_YELLOW);
    sink.sound?.(supportIntent(caster, { family: 'mark' }, skillVoice(skill.id, { beat: 'aim' })));
    sink.vfx({
      kind: 'buff', delivery: 'spell', prelude: 'aim',
      casterId: caster.id, casterPos: caster.position, targetCoord: aimed.position,
      hitUnitIds: [], hitCoords: [caster.position],
      color: skill.vfxColor ?? MARKSMAN_YELLOW, durationScale: resolveVfxScale(skill),
    });
    return { ok: true, endsTurn: true };
  }
  // Its release goes only to the unit it aimed at
  if (skill.charge?.aimed && skill.releasing && !opts.resolving) {
    const aim = heldAim(caster);
    if (!aim || !occupant || occupant.id !== aim.aimAt) return refuse('no-targets', t('combatLog.refuse.shootAimed'));
  }

  // Marked Prey's mark: one enemy named, nothing dealt, nothing locked. The chi is
  // paid now; the cooldown waits for the release. While the mark stands the button
  // is the release, which runs on its own (`resolveMarkedPreyRelease`).
  if (skill.mantisCapstone === 'markedPrey' && !opts.resolving && !opts.echo) {
    if (skill.mantisStage === 'release') return resolveMarkedPreyRelease(caster, skill, targetCoord, sink);
    const prey = occupant && occupant.isPlayer !== caster.isPlayer && !occupant.objective ? occupant : undefined;
    if (!prey) return refuse('no-targets', t('combatLog.refuse.aimEnemy'));
    if (hexDistance(caster.position, prey.position) > skill.range) return refuse('no-targets', t('combatLog.refuse.outOfRange'));
    store.applyEffect(caster.id, {
      type: AuraType.MarkedPrey, magnitude: 1, duration: BALANCE.MANTIS.MARK_TURNS,
      sourceUnitId: caster.id, aimAt: prey.id, stored: 0,
    });
    if (manaToPay > 0) store.spendMana(caster.id, manaToPay);
    store.setFacing(caster.id, prey.position);
    sink.log(`${unitName(caster)}: ${skillName(skill)}`, '#ffffff', skillLogIcon(skill));
    sink.log(`  ${t('combatLog.log.marksPrey', { name: unitName(caster), target: unitName(prey) })}`, MANTIS_GREEN);
    sink.sound?.(supportIntent(caster, { family: 'mark' }, skillVoice(skill.id, { beat: 'mark' })));
    sink.status(prey.position, t('combatLog.float.marked'), MANTIS_GREEN);
    sink.vfx({
      kind: 'buff', delivery: 'spell', prelude: 'aim',
      casterId: caster.id, casterPos: caster.position, targetCoord: prey.position,
      hitUnitIds: [prey.id], hitCoords: [prey.position],
      color: skill.vfxColor ?? MANTIS_GREEN, durationScale: resolveVfxScale(skill),
    });
    return { ok: true, endsTurn: true };
  }

  // Assassinate: the Death Mark, and nothing dealt now. The execution comes by
  // itself at the start of a later turn (`assassination`).
  if (skill.deathMark && !opts.resolving) {
    const prey = occupant && occupant.isPlayer !== caster.isPlayer && !occupant.objective ? occupant : undefined;
    if (!prey) return refuse('no-targets', t('combatLog.refuse.aimEnemy'));
    if (hexDistance(caster.position, prey.position) > skill.range) return refuse('no-targets', t('combatLog.refuse.outOfRange'));
    const landed = markForDeath(caster, prey.id);
    if (manaToPay > 0) store.spendMana(caster.id, manaToPay);
    store.startCooldown(caster.id, skill);
    store.setFacing(caster.id, prey.position);
    sink.log(`${unitName(caster)}: ${skillName(skill)}`, '#ffffff', skillLogIcon(skill));
    sink.log(`  ${t(landed ? 'combatLog.log.markedForDeath' : 'combatLog.log.shrugsMark', { name: unitName(prey) })}`, DEATH_MARK_COLOR);
    sink.sound?.(supportIntent(caster, { family: 'mark' }, skillVoice(skill.id, { beat: 'mark' })));
    if (landed) sink.status(prey.position, t('combatLog.float.marked'), DEATH_MARK_COLOR);
    sink.vfx({
      kind: 'buff', delivery: 'spell', prelude: 'aim',
      casterId: caster.id, casterPos: caster.position, targetCoord: prey.position,
      hitUnitIds: [prey.id], hitCoords: [prey.position],
      color: DEATH_MARK_COLOR, durationScale: resolveVfxScale(skill),
    });
    if (echoHoldAfter(caster, sink)) return { ok: true, endsTurn: false };
    return { ok: true, endsTurn: true };
  }

  // Knife Dance is the caster dashing between its victims: Root binds it
  if (skill.knifeDance && !opts.resolving && isRooted(caster)) return refuse('rooted', rootedRefusal());

  // Wildshape resolves on its own and returns: a shift strikes nobody, so
  // falling through to the target loop would trip the "no valid targets"
  // guard, refund the turn and leave the Druid standing there as a person.
  const shift = resolveShift(caster, skill);
  if (shift !== undefined) {
    store.setWildForm(caster.id, shift);
    announceShift(caster, skill, shift, sink);
    // Mana and the cooldown still stand either way — free is the *action*, not
    // the shift. See `shiftEndsTurn` for why only one direction is free. (Feral
    // Heart's free shifting went with Feral Heart in the remaster, 2026-10.)
    //
    // Apex is the exception for the cooldown: entering starts nothing, so the same
    // button can revert by hand, and leaving starts the long wait from the moment the
    // shape goes — `setWildForm` does that for every way out, this one included.
    if (skill.manaCost > 0) store.spendMana(caster.id, skill.manaCost);
    if (skill.shiftsTo !== 'apex') store.startCooldown(caster.id, skill);
    return { ok: true, endsTurn: shiftEndsTurn(caster, shift) };
  }

  // Ancestral Hunt's three spirits resolve on their own: three different strikes on
  // one body with their own riders, which the one-skill loop below cannot express.
  if (skill.spiritHunt && !opts.echo && !opts.resolving) return resolveSpiritHunt(caster, skill, targetCoord, sink);

  // Dash and blink land before the strike, so the skill resolves from where
  // the caster ends up rather than from where it started. Retreat runs after
  // the loop instead — withdrawing first would take you out of your own range.
  let activeCaster = caster;
  // Set when the caster actually went somewhere. A pure repositioning skill
  // strikes nobody, so without this the "no valid targets" guard below refunds
  // the turn — Thunderstep blinked across the field and then un-cast itself.
  let moved = false;
  // Slip the Net: the bonds come off first, so the move that follows is legal
  if (!opts.resolving && !opts.echo && skill.slipsBonds) {
    const bound = caster.activeEffects.filter((e) => e.type === AfflictionType.Root || e.type === AfflictionType.Chill);
    for (const bond of bound) store.removeEffect(caster.id, bond.type);
    if (bound.length > 0) {
      caster = unitById(useCombatStore.getState().units, caster.id) ?? caster;
      sink.log(`  ${t('combatLog.log.slipsFree', { name: unitName(caster) })}`, '#8899aa');
    }
  }
  // Mantis Execution: in behind its prey before the cuts - the back hex when free,
  // else a rear side, else any hex beside it. Already beside it with nothing behind
  // free, it cuts from where it stands; a Root keeps it there, and refuses a blink.
  let executionPrey: CombatUnit | undefined;
  if (skill.mantisCapstone === 'execution' && !opts.resolving && !opts.echo) {
    const prey = occupant && occupant.isPlayer !== caster.isPlayer && !occupant.objective ? occupant : undefined;
    if (!prey) return refuse('no-targets', t('combatLog.refuse.aimEnemy'));
    if (hexDistance(caster.position, prey.position) > skill.range) return refuse('no-targets', t('combatLog.refuse.outOfRange'));
    const live = useCombatStore.getState();
    const landing = strikeLanding(caster, prey, live.units, live.hazards);
    if (!landing) return refuse('no-landing', t('combatLog.refuse.noWayIn'));
    if (landing.q !== caster.position.q || landing.r !== caster.position.r) {
      if (isRooted(caster)) return refuse('rooted', rootedRefusal());
      store.moveUnit(caster.id, landing, 'dash');
      sink.sound?.(moveIntent(caster.id, caster.position, landing, 'blink'));
      activeCaster = { ...caster, position: landing };
      moved = true;
    }
    executionPrey = prey;
  }
  // Flicker Cut: in behind its prey before the cut, so the cut is a backstab (PT-17). It
  // is beside its prey already, so with nothing behind free it cuts from where it stands,
  // and a Root keeps it there too — the cut still lands.
  if (skill.blinksBehind === 'first' && !opts.resolving && !opts.echo && !isRooted(caster)) {
    const prey = occupant && occupant.isPlayer !== caster.isPlayer && !occupant.objective ? occupant : undefined;
    const live = useCombatStore.getState();
    const landing = prey && hexDistance(caster.position, prey.position) <= skill.range
      ? strikeLanding(caster, prey, live.units, live.hazards)
      : undefined;
    if (prey && landing && (landing.q !== caster.position.q || landing.r !== caster.position.r)) {
      store.moveUnit(caster.id, landing, 'dash');
      sink.sound?.(moveIntent(caster.id, caster.position, landing, 'blink'));
      activeCaster = { ...caster, position: landing };
      moved = true;
      logFlicker(sink, caster, prey);
    }
  }
  if ((!opts.resolving || opts.reacting) && !opts.echo && skill.selfMove && skill.selfMove.kind !== 'retreat') {
    const destination = resolveSelfMove(caster, skill, targetCoord, units, useCombatStore.getState().hazards);
    if (destination) {
      store.moveUnit(caster.id, destination, leapsSelfMove(skill) ? 'jump' : skill.selfMove.kind === 'dash' ? 'dash' : 'walk');
      sink.sound?.(moveIntent(caster.id, caster.position, destination, selfMoveMode(skill.selfMove)));
      activeCaster = { ...caster, position: destination };
      moved = true;
      // Shadow Echo: a Shadowstep that went somewhere leaves the caster's shadow
      // where it stood, replacing any earlier one. Assassinate's blink never does.
      if (skill.id === 'shadowstep' && hasPassive(caster, 'shadowEcho')) leaveEcho(caster.id, caster.position);
    } else if (isRooted(caster) && selfMoveBlocked(caster, skill, targetCoord, units, useCombatStore.getState().hazards)) {
      // Root binds every kind, so this is checked before the two board-shaped
      // refusals below or a rooted blink would report "Cannot blink there"
      // about a hex that is perfectly fine. `selfMoveBlocked` is what keeps the
      // adjacent-charge case out: no ground to cover, nothing for a Root to
      // stop, and the swing still lands.
      return refuse('rooted', rootedRefusal());
    } else if (skill.selfMove.kind === 'blink') {
      // A blink names its destination exactly; landing somewhere else would
      // not be the move the player asked for
      return refuse('blink-blocked', t('combatLog.refuse.blinkBlocked'));
    } else if (dashGapClosed(caster, skill, targetCoord)) {
      // Already beside them: the charge has no ground left to cover, so it
      // lands as the melee attack it ends in. Refusing here made every
      // gap-closer unusable at exactly the range it does its damage from.
    } else if (skill.occupiedVariant || occupant) {
      // A gap-closer that could not close the gap. The variant's damage is the
      // payoff for arriving, so landing it from four hexes away would make
      // Shadowstep a better ranged attack than the Shadowblade's actual ranged
      // options — against a target surrounded by its own escort, of all things.
      return refuse('no-landing', t('combatLog.refuse.noWayIn'));
    }
  }

  // Random enemies inside the aimed area rather than aimed ones (Skyfall): rolled
  // here, once, so a companion's echo can strike the very same set. The preview
  // shows the area — every enemy it could pick — not its landing.
  const rawAffected =
    opts.fixedHexes ??
    (skill.randomEnemies
      ? pickRandomStrikes(skill, activeCaster.position, targetCoord, units)
      : getSkillTargets(skill, activeCaster.position, targetCoord, units, store.hazards));
  // A warned strike resolves its bodies in the order `forcedMoveOrder` previews
  // them, so a shove that needs the hex in front of it cleared finds it so.
  const affected = opts.pushOrigin ? orderForPush(opts.pushOrigin, rawAffected) : rawAffected;

  // A preparation announces instead of striking: the footprint is fixed now and
  // lands later from `beginTurn` (see `preparedResolve`).
  if (skill.prepares && !opts.resolving) {
    if (skill.summons || skill.selfMove) {
      return refuse('unusable', t('combatLog.refuse.cannotPrepare'));
    }
    const cast = castPrepared(
      caster, skill, targetCoord, affected, units,
      (text, color) => sink.log(text, color),
    );
    if (!cast.ok) return refuse('unusable', t('combatLog.refuse.alreadyPreparing'));
    // A crystal that rides on the warning (a Furnace Heart) is raised with it
    if (skill.places) {
      castObjectives(caster, skill, targetCoord, units, (text, c) => sink.log(text, c), cast.attack.id);
    }
    sink.sound?.(launchIntent(caster, skill, delivery));
    // Announcing a spell is casting it: paid now, though it strikes nobody yet
    castPaid(caster, skill, [], sink);
    return { ok: true, endsTurn: true };
  }
  let anyHit = moved || !!opts.resolving || !!opts.echo;
  // Set by Frenzy on a kill: the turn is not spent and the unit acts again
  let extraAction = false;
  // Summed across every target, then returned to the caster once — an AoE
  // drain heals from the whole strike, not from each victim separately. A
  // dual-wield hand is the one exception and settles its own: see below.
  let lifestealPool = 0;
  // Everything dealt, for the Templar's spill, which heals once per cast
  // however many blows it was made of.
  let damageDealt = 0;
  const settleDrain = () => {
    const drained = calculateLifesteal(skill, lifestealPool, activeCaster);
    lifestealPool = 0;
    if (drained <= 0) return;
    const landed = store.healUnit(caster.id, drained, caster.id);
    sink.float(activeCaster.position, `+${landed}`, FLOAT_COLOR.heal);
    sink.log(`  ${t('combatLog.log.drains', { name: unitName(caster), amount: landed })}`, '#cc44ff');
  };
  const hitUnitIds: string[] = [];
  const hitCoords: HexCoord[] = [];

  // The one log line that is *about* an ability rather than about its fallout,
  // and therefore the only one that leads with an icon. Both the player's path
  // and the AI's come through here, so neither needs to know.
  sink.log(`${unitName(caster)}: ${skillName(skill)}`, '#ffffff', skillLogIcon(skill));

  // Shell Swap: the Beetle and its ally trade hexes before anything reads the
  // footprint — the aimed hex, where the Beetle now stands and takes its Barrier
  if (skill.swapsPlaces && !opts.resolving && !opts.echo) {
    const swap = swapPlaces(caster, skill, occupant, sink);
    if (!swap.ok) return swap.refusal === 'rooted' ? refuse('rooted', rootedRefusal()) : refuse('no-targets', t('combatLog.refuse.allyInRange'));
    activeCaster = swap.caster;
    moved = true;
    anyHit = true;
  }

  // Summons resolve first. A summon skill strikes nobody, so it has to count
  // as a hit in its own right or the "no valid targets" guard below refunds
  // the turn and the creatures never appear.
  if (skill.summons && !opts.echo) {
    const spec = skill.summons;
    const casterLevel =
      usePartyStore.getState().heroes.find((h) => h.id === caster.heroId)?.level ?? caster.level ?? 1;

    // The caster's own live stage-unit, if it has one. While it stands, this
    // button does exactly one thing: build it up. The unit is the state
    // machine, so nothing has to be stored and its death resets the chain.
    // A finished construction (Stone Heart's Stone Elemental) locks the skill until it falls
    const finished = finishedStageUnit(spec, activeCaster, units);
    if (finished) return refuse('unusable', t('combatLog.refuse.stageStands', { name: unitName(finished) }));
    const stageUnit = findStageUnit(spec, activeCaster, units);
    if (stageUnit) {
      if (
        stageUnit.position.q !== targetCoord.q ||
        stageUnit.position.r !== targetCoord.r
      ) {
        return refuse('no-targets', t('combatLog.refuse.aimStage', { name: unitName(stageUnit) }));
      }
      const stages = spec.stages!;
      const next = stages[stages.indexOf(stageUnit.templateId as never) + 1];
      store.transformUnit(stageUnit.id, next, casterLevel, spec.statScale);
      const grown = unitById(useCombatStore.getState().units, stageUnit.id);
      if (grown) sink.log(`  ${t('combatLog.log.rises', { name: unitName(grown) })}`, '#c8a878');
      hitCoords.push(stageUnit.position);
      anyHit = true;
    } else {
      const hexes =
        spec.placement === 'aimed'
          ? aimedSummonHex(activeCaster, skill, targetCoord, units)
          : findSummonHexes(activeCaster.position, spec.count, units);
      if (hexes.length === 0) return refuse('no-summon-room', t('combatLog.refuse.noSummonRoom'));

      // One companion per summoner: a recast replaces the one standing
      if (findSummonTemplate(spec.templateId)?.companion) {
        for (const old of units.filter((u) => u.companion && u.summonedBy === caster.id && u.currentHp > 0)) {
          store.damageUnit(old.id, old.currentHp, undefined, { bypassProtection: true });
          sink.log(`  ${t('combatLog.log.fades', { name: unitName(old) })}`, '#aa88ff');
        }
      }
      const summoned = createSummonUnits(spec, activeCaster, hexes, casterLevel);
      store.addUnits(summoned);
      for (const unit of summoned) {
        hitCoords.push(unit.position);
        sink.log(`  ${t('combatLog.log.answersCall', { name: unitName(unit) })}`, '#aa88ff');
      }
      if (spec.arrivalEffect) applySummonArrival(spec.arrivalEffect, summoned, sink);
      anyHit = summoned.length > 0;
    }
  }

  // Objectives are raised before the strike for the reason summons are: a skill
  // that raises one strikes nobody, and has to count as having happened.
  if (skill.places && !opts.resolving && !opts.echo) {
    const placed = castObjectives(
      activeCaster, skill, targetCoord, units, (text, c) => sink.log(text, c), undefined, opts.rampartNeighbor,
    );
    if (placed.length === 0 && !skill.damage) return refuse('no-summon-room', t('combatLog.refuse.noPlaceRoom'));
    for (const unit of placed) hitCoords.push(unit.position);
    anyHit = anyHit || placed.length > 0;
  }

  // Carnage doubles the Berserker's free swings; Rapid Fire splits a shot into
  // five; Flurry hangs three light blades off the back of one. The whole pass
  // repeats rather than the damage number changing, so every blow rolls its own
  // crit and dodge and fires on-hit effects again — which is the point, and is
  // also why the target is re-read from the store below: it may not have
  // survived the previous one.
  //
  // Inside each pass, a dual-wielder's Basic Attack is two hands — two whole
  // strikes at half power, each with its own dodge, crit, on-hit statuses and
  // drain. There is deliberately no once-per-action cap on any of it: the
  // second proc is what holding two weapons buys.
  const hands = weaponStrikes(skill, activeCaster);
  const struckByCast: CombatUnit[] = [];
  let reapChi = 0;
  // A barrage aims each projectile when it leaves: the same target while it
  // stands, then the nearest other enemy in range, and nothing once none is left.
  let barrageAim: HexCoord | undefined = targetCoord;
  // Cycle of Life: the payoff is read from the charges held before this cast,
  // and any charge the cast earns is awarded after it — never both at once.
  const growthBonus = cycleOfLifeBonus(activeCaster, skill, getCombatEffectiveStats(activeCaster).magic);
  const growthPaid = new Set<string>();
  let restoredByCast = false;
  // Embedded Blades: the passes that landed on each enemy, so a dual-wield pass
  // is one blade and every Flurry knife one more. Embedded after the last pass,
  // so Barbed Blades reads the blades that were in when the cast began.
  const bladePasses = new Map<string, Set<number>>();
  const danceSteps: NonNullable<VfxSpec['danceSteps']> = [];
  const danceTargets: HexCoord[] = [];
  const danceFollowups: VfxSpec[] = [];
  let previousDanceTarget: string | undefined;
  const castSink = sink;
  // Sharpened Steel: who stood at full health as the cast began, and who has had
  // their opening hit already
  const fullAtStart = new Set(units.filter((u) => u.currentHp > 0 && u.currentHp >= combatMaxHp(u)).map((u) => u.id));
  // Steady Flame asks whether the cast healed an ally: anyone on the caster's side
  // (the caster aside) who ends the cast with more health than they began it with
  const allyHpAtStart = new Map(units
    .filter((u) => u.isPlayer === caster.isPlayer && u.id !== caster.id && u.currentHp > 0)
    .map((u) => [u.id, u.currentHp]));
  const opened = new Set<string>();
  // Bodies a shove moved off the hex they were struck on, by that hex: the
  // statuses below are laid on who was struck there, not on whoever stands there now
  const shovedFrom = new Map<string, string>();
  // Slipstream asks whether the cast damaged an enemy at all
  let damagedEnemy = false;
  // Twin Reap's prey, and the Reaping Momentum this reap carries against it — read
  // before the cuts and written after them, so both cuts carry the same stacks
  const reapPrey = isTwinReap(skill) && occupant && occupant.isPlayer !== caster.isPlayer && !opts.echo
    ? occupant : undefined;
  const reapStack = reapPrey ? reapStacks(caster, reapPrey.id) : 0;
  const reapScale = momentumScale(caster, reapStack);
  let passIndex = -1;
  const passTotal = strikeScales(activeCaster, skill).length;
  for (const passScale of strikeScales(activeCaster, skill)) {
  passIndex++;
  if (skill.barrage) {
    barrageAim = barrageAim && barrageTarget(activeCaster, skill, barrageAim, useCombatStore.getState().units);
    if (!barrageAim) break;
  }
  const passHexes = skill.knifeDance
    ? passIndex === 0 ? (affected.length ? Array.from({ length: BALANCE.KNIFE_DANCE_STRIKES }, () => targetCoord) : []) : danceTargets
    : skill.barrage && barrageAim ? [barrageAim] : affected;
  for (const [handIndex, handScale] of hands.entries()) {
  const strikeScale = passScale * handScale;
  // A shove lands with the last blow of the cast: pushed by the first of a
  // Rapid Fire burst or a second hand, the target left the hex the rest aim at
  const finalBlow = passIndex === passTotal - 1 && handIndex === hands.length - 1;
  for (const [hop, hex] of passHexes.entries()) {
    // A caster a Retaliation or Thorns killed mid-cast lands nothing more: the
    // rest of an area, a second hand or a later pass would be struck by a corpse
    if (casterFell(caster.id)) break;
    // Ricochet Shot: each bounce lands at a fraction of the one before it
    const hopScale = skill.chainFalloff ? skill.chainFalloff ** hop : 1;
    let target = store.getUnitAt(hex);
    if (skill.knifeDance && passIndex === 0) {
      const live = useCombatStore.getState();
      const step = knifeDanceStep(activeCaster, skill, live.units, live.hazards, targetCoord, hop === 0, previousDanceTarget);
      if (!step) break;
      const from = activeCaster.position;
      store.moveUnit(caster.id, step.to, 'dash');
      activeCaster = unitById(useCombatStore.getState().units, caster.id)!;
      moved = true;
      if (casterFell(caster.id)) break;
      target = step.target;
      previousDanceTarget = target.id;
      danceSteps.push({ from, to: step.to, target: target.position, targetId: target.id, hit: false });
      danceTargets.push(target.position);
    }
    if (skill.knifeDance) {
      sink = { ...castSink, float: (at, text, color, delay = 0) => castSink.float(at, text, color,
        delay + hop * KNIFE_DANCE_BEAT_MS + passIndex * FLOAT_STAGGER_MS) };
    }
    if (!target || target.currentHp <= 0) continue;
    // The Jarl's rune circle: the duelists reach each other and nobody else
    if (duelBars(activeCaster, target)) continue;
    // Vengeful Shell: a Beetle covering this ally leaps beside it and is the body
    // the blow strikes, before anything about the blow is read. What the blow
    // carries afterwards (its statuses) follows it to the Beetle.
    let takenBy: string | undefined;
    if (skill.damage && canStrike(activeCaster, target, skill)) {
      const taker = interceptBlow(activeCaster, target, skill, sink);
      if (taker.id !== target.id) {
        shovedFrom.set(hexKey(hex), taker.id);
        target = taker;
        takenBy = taker.id;
      }
      // Carapace Leap: a Beetle watching this ally leaps beside it and both are
      // shielded before the blow lands, so the Barrier soaks it
      if (!takenBy && shieldWard(activeCaster, target, sink)) {
        target = unitById(useCombatStore.getState().units, target.id) ?? target;
      }
    }

    if (skill.healing && target.isPlayer === caster.isPlayer && !target.objective && !(skill.sparesCaster && target.id === caster.id)) {
      const healing = calculateHealing(caster, skill, target);
      // The number on the board is what landed, not what was cast: the target's
      // own `incomingSupportBonus` and a phase ceiling both sit inside
      // `healUnit`, and this is the only place either is ever shown.
      const landed = store.healUnit(target.id, healing, caster.id);
      // A heal that actually restored something is Tithe on Mercy's trigger. Only
      // this route counts: Smite's incidental heal, regeneration and a lethal
      // save are not a hero choosing to heal.
      if (landed > 0) store.noteMercy(target.id);
      applyOnHeal(activeCaster, target, healing, sink, landed);
      sink.sound?.(mendIntent(target, skillVoice(skill.id)));
      sink.float(target.position, `+${landed}`, FLOAT_COLOR.heal);
      sink.log(`  ${unitName(target)} +${landed}`, '#44dd88');
      hitUnitIds.push(target.id);
      hitCoords.push(target.position);
      anyHit = true;
      if (landed > 0) restoredByCast = true;
      // Shared Bloom: a smaller direct heal to the most wounded ally near the
      // recipient — a heal, not a second Lifebloom, so no signature regeneration
      // and nothing that could pick a third ally.
      if (skill.id === 'lifebloom_skill' && hasPassive(caster, 'sharedBloom')) {
        const second = sharedBloomRecipient(activeCaster, target, useCombatStore.getState().units);
        if (second) {
          const share = Math.max(1, Math.round(
            healing * BALANCE.SHARED_BLOOM_SHARE * passiveRank(caster, 'sharedBloom').scale,
          ));
          const spread = store.healUnit(second.id, share, caster.id);
          if (spread > 0) {
            restoredByCast = true;
            store.noteMercy(second.id);
          }
          applyOnHeal(activeCaster, second, share, sink, spread);
          sink.float(second.position, `+${spread}`, FLOAT_COLOR.heal);
          sink.log(`  ${passiveName('sharedBloom')}: ${unitName(second)} +${spread}`, '#44dd88');
          sink.vfx({
            kind: 'bloom', delivery: 'spell', casterId: caster.id, casterPos: caster.position, targetCoord: second.position,
            hitUnitIds: [second.id], hitCoords: [second.position], color: skill.vfxColor ?? '#44dd88',
            delayMs: preludeMs(skill),
          });
        }
      }
    }
    // A carried Furnace Heart shares its carrier's hex: a blow that harms, landing on the caster's
    // own side there, strikes the crystal riding on them and leaves the hero beneath it unhurt
    if (skill.damage) target = struckBody(activeCaster, target, useCombatStore.getState().units) ?? target;
    if (
      skill.damage &&
      // Re-checked here rather than trusted from the highlights: this is the rule, and
      // the highlights are a drawing of it. The AI asks the same question before it scores.
      canStrike(activeCaster, target, skill)
    ) {
      // The approach against the target's facing: its rear sides and its back
      const flank = flankOf(activeCaster, target);
      // Jadeveil: Silent Hall / Fallen Order — the Last Lesson parries a repeated skill:
      // the blow deals nothing, and the riposte is owed once the cast is over
      if (opts.lessonRepeat === target.id) {
        noteLessonParry(activeCaster, target.id);
        // His staff snapping the blow aside: wood, not steel
        sink.sound?.(strikeIntent(target, delivery, 'blocked', undefined, undefined, { parry: true }));
        sink.float(target.position, parryText(), LESSON_RED);
        sink.log(`  ${t('combatLog.log.parries', { name: unitName(target) })}`, LESSON_RED);
        hitCoords.push(target.position);
        anyHit = true;
        continue;
      }
      // Read what the detonation will spend *before* rolling: the multiplier
      // is computed from the affliction still being there
      const detonated = detonationConsumes(target, skill);
      // The Wildshape marks this blow may spend, read before it lands: Hunter's Mark
      // scales a Hawk attack, Crowned Prey's magic rides inside `resolveAttack`
      const hunted = huntersMarkFor(activeCaster, target, skill);
      const crowned = crownedPreyFor(activeCaster, target);
      const cashesMark = basicAttackSpendsMark(activeCaster, target, skill);
      const extraPen = sharpenedSteelFor(activeCaster, target, fullAtStart.has(target.id), opened, skill);
      // Twin Reap's second blade on a Bleeding enemy: a certain critical, and the reap
      const reaps = reapingCut(skill, handIndex, target);
      const result = resolveAttack(activeCaster, target, skill, {
        flank,
        allUnits: units,
        strikeScale: strikeScale * hopScale * (hunted ? 1 + hunted.magnitude / 100 : 1)
          * (reapPrey?.id === target.id ? reapScale : 1)
          * (opts.shares?.[hexKey(hex)] ?? 1),
        ...(extraPen > 0 && { extraPen }),
        ...(reaps && { guaranteedCrit: true }),
      });

      if (skill.knifeDance && passIndex > 0) {
        const step = danceSteps[hop];
        // Flurry adds a throw from this landing, never another model dash.
        const hits = result.dodged ? [] : [target.id];
        danceFollowups.push({
          kind: 'knifedance', delivery: 'thrown', casterId: caster.id, casterPos: step.to,
          targetCoord: target.position, hitCoords: [target.position], hitUnitIds: hits,
          color: skill.vfxColor ?? BLADE_COLOR, durationScale: 1,
          danceSteps: [{ from: step.to, to: step.to, target: target.position, targetId: target.id, hit: !result.dodged }],
          delayMs: preludeMs(skill) + hop * KNIFE_DANCE_BEAT_MS + passIndex * FLOAT_STAGGER_MS,
        });
      }

      // A dodge still counts as the skill having landed somewhere — the turn
      // is spent either way, and refunding it via the `anyHit` guard would let
      // a player re-roll a miss for free.
      if (result.dodged) {
        // Through the shared constants, so this path and the AI's cannot say
        // two different things about one event — they already did: `MISS` here
        // and a literal `-0` there. "DODGED" because the roll is the target's.
        sink.sound?.(strikeIntent(target, delivery, 'dodged', spellOf(skill, delivery)));
        sink.float(target.position, dodgeText(), DODGE_COLOR);
        sink.log(`  ${t('combatLog.log.dodged', { name: unitName(target) })}`, DODGE_COLOR);
        hitCoords.push(target.position);
        anyHit = true;
        continue;
      }

      // A landed blow spends one charge of each mark it read; a dodge spent none
      if (skill.knifeDance && passIndex === 0) danceSteps[hop].hit = true;
      if (hunted) store.spendMarkCharge(target.id, AfflictionType.HuntersMark);
      if (crowned) store.spendMarkCharge(target.id, AfflictionType.CrownedPrey);
      // The Marksman's Basic Attack cashes its own Mark in (the bonus rode in `resolveAttack`)
      if (cashesMark) store.removeEffect(target.id, AfflictionType.Mark);

      // Counted for the cast as it stood before this blow, once per enemy: Overload
      // reads how many Shocked enemies the whole cast struck.
      if (!struckByCast.some((u) => u.id === target.id)) struckByCast.push(target);
      opened.add(target.id);
      damagedEnemy = true;
      if (skill.embedsBlades) {
        const passes = bladePasses.get(target.id) ?? new Set<number>();
        passes.add(skill.knifeDance ? passIndex * BALANCE.KNIFE_DANCE_STRIKES + hop : passIndex);
        bladePasses.set(target.id, passes);
      }

      if (!isHeldFromHarm(target.activeEffects) && holyStrikeEligible(skill) && activeCaster.activeEffects.some(e => e.type === AuraType.SacredRhythm)) {
        store.removeEffect(caster.id, AuraType.SacredRhythm);
        activeCaster = { ...activeCaster, activeEffects: activeCaster.activeEffects.filter(e => e.type !== AuraType.SacredRhythm) };
      }
      const seal = sacredSealFor(activeCaster, target);
      if (seal && !isHeldFromHarm(target.activeEffects)) {
        store.removeEffect(target.id, AfflictionType.SacredSeal);
        const healed = store.healUnit(caster.id, seal.healMagnitude ?? 0, seal.sourceUnitId);
        if (healed > 0) sink.float(activeCaster.position, `+${healed}`, FLOAT_COLOR.heal);
      }
      const damage = result.damage;
      const hpBefore = target.currentHp;
      const { absorbed, deathEvents, hpLost: lost, shared, sharedBy, shieldedBy, shieldBroke } = store.damageUnit(
        target.id, damage, activeCaster.id, { difficultyApplied: true },
      );
      // Jadeveil: Silent Hall / Fallen Order — a blow that broke one of his lessons
      noteLessonStrike(activeCaster, target, flank);
      // A Carapace Bastion's owner took its share in the ally's place: the ally's
      // number is what was left of the blow, and the owner's rides in `deathEvents`
      const shown = damage - (shared ?? 0);
      // The HP the blow took as it landed, before any lethal save put some back
      // — a saved unit was still hit, and reading it back afterwards could
      // report a body kept on its feet as a blow that never got through.
      // Which pass and which hop this is, for a skill heard blow by blow; Blade
      // Recall's own sound is its pull, below, not its throw
      sink.sound?.(strikeIntent(
        target, delivery, strikeOutcome(result, lost), spellOf(skill, delivery), flank,
        strikeDetail(skill, { shieldedBy, shieldBroke }, skill.extractsBlades ? undefined : { index: passIndex, count: passTotal, hop }),
      ));
      // Coloured by the defence that answered it; a crit is told by its size and label
      sink.float(target.position, result.crit ? `-${shown}!` : `-${shown}`, hitFloatColor(damageTypeOf(skill)));
      if (absorbed > 0) {
        sink.log(`  ${t('combatLog.log.absorbs', { name: unitName(target), amount: absorbed })}`, BARRIER_COLOR);
      }
      sink.log(`  ${hitLine(target, shown, result.crit)}`, result.crit ? '#ffcc44' : '#ff4444');
      showFlank(sink, activeCaster, target, flank);
      hitUnitIds.push(target.id);
      hitCoords.push(target.position);
      anyHit = true;
      lifestealPool += damage;
      damageDealt += damage;
      floatFireflyHeal(sink, applyLightbond(activeCaster, damage, sink));
      playDeathEvents(deathEvents, sink);
      // Retribution: a Beetle that took this blow for an ally, or split it with one, strikes back
      const retributor = takenBy ?? sharedBy;
      if (retributor) retribute(retributor, activeCaster.id, sink);

      // The reap closes the wound the Basic Attack opened. A dodged cut reaped
      // nothing, so the Bleed stays for the next one.
      if (reaps) {
        // Bleed Harvest: the wound pays what it had left, at once, before it closes
        const reaped = unitById(useCombatStore.getState().units, target.id);
        const harvest = reaped && reaped.currentHp > 0
          ? harvestDamage(activeCaster, reaped.activeEffects.find((e) => e.type === AfflictionType.Bleed))
          : 0;
        store.removeEffect(target.id, AfflictionType.Bleed);
        sink.log(`  ${t('combatLog.log.bleedReaped', { name: unitName(target) })}`, MANTIS_GREEN);
        // Reaper's Breath: owed here and paid after the cast's price, or a pool near
        // full would lose the refund to the ceiling before the cost came off
        if (hasPassive(activeCaster, 'reapersBreath')) reapChi += reapersBreathChi(passiveRank(activeCaster, 'reapersBreath'));
        if (harvest > 0) {
          const paid = store.damageUnit(target.id, harvest, activeCaster.id);
          // The Bleed let out at once: heard as the bleed it was, with its number
          sink.sound?.(afflictionIntent(target, AfflictionType.Bleed));
          sink.float(target.position, `-${harvest}`, FLOAT_COLOR.bleed);
          sink.log(`  ${passiveName('bleedHarvest')}: ${unitName(target)} -${paid.hpLost}`, MANTIS_GREEN);
          playDeathEvents(paid.deathEvents, sink);
        }
      }

      // Blood Howl: a direct critical hit by the Wolf under it earns an extra turn,
      // one per critical hit while the allowance has room (`queueHowlTurn`)
      if (result.crit && !opts.echo && !opts.resolving && activeCaster.wildForm === 'wolf'
        && hasEffect(activeCaster, AuraType.BloodHowl) && store.queueHowlTurn(caster.id)) {
        sink.log(`  ${t('combatLog.log.actsAgain', { source: skillName({ id: 'blood_howl' }), name: unitName(caster) })}`, '#ff6a72');
      }
      // Hunter's Mark and Crowned Prey are laid by the blow that landed
      if (skill.marks) layStrikeMark(activeCaster, target.id, skill, sink);

      // Cycle of Life's payoff: once per enemy the spell strikes, fixed like a
      // shatter burst (no roll, no defence), and only on a body still standing.
      const grown = unitById(useCombatStore.getState().units, target.id);
      if (growthBonus > 0 && !growthPaid.has(target.id) && grown && grown.currentHp > 0) {
        growthPaid.add(target.id);
        const bonus = store.damageUnit(target.id, growthBonus, activeCaster.id);
        sink.float(target.position, `-${growthBonus}`, '#9be86a');
        sink.log(`  ${passiveName('cycleOfLife')}: ${unitName(target)} -${bonus.hpLost}`, '#9be86a');
        playDeathEvents(bonus.deathEvents, sink);
      }

      // What the target actually lost, read back rather than inferred.
      // `damage - absorbed` accounts for a Barrier and for nothing else, so an
      // Invulnerable target still reflected Thorns, still chained Shock and —
      // once coated blades existed — still took a dose from a blow that never
      // reached it. This is the number `applyOnHitStatuses` has always said it
      // wanted.
      const struck = unitById(useCombatStore.getState().units, target.id);
      const hpLost = hpBefore - (struck?.currentHp ?? hpBefore);

      const hit = applyOnHitStatuses(activeCaster,
        target,
        hpLost,
        sink,
        hpBefore,
        result.crit,
        skill,
        // The whole blow past any Barrier, overkill included — what a Shock spark is sized from
        lost > 0 ? Math.max(lost, damage - absorbed) : 0,
      );
      extraAction = extraAction || hit.extraAction;
      // Coated blades filled the target's last dose and it went off
      if (hit.poisonBurst) {
        sink.sound?.(afflictionIntent(target, AfflictionType.Poison));
        sink.float(
          target.position,
          hit.poisonBurst.crit ? `-${hit.poisonBurst.burst}!` : `-${hit.poisonBurst.burst}`,
          FLOAT_COLOR.poison,
        );
      }

      // A reward that belongs to the skill rather than to the killer — read
      // from the store because the local `target` is a snapshot taken before
      // the blow landed.
      const slain = unitById(useCombatStore.getState().units, target.id);
      if (skill.grantsOnKill && hpBefore > 0 && slain && slain.currentHp <= 0) {
        store.applyEffect(activeCaster.id, {
          type: skill.grantsOnKill.type,
          magnitude: resolveEffectMagnitude(
            skill.grantsOnKill.type,
            skill.grantsOnKill.magnitude,
            activeCaster,
            skill.scaling,
          ),
          duration: skill.grantsOnKill.duration,
          sourceUnitId: activeCaster.id,
        });
        sink.log(`  ${t('combatLog.log.backIntoDark', { name: unitName(activeCaster) })}`, '#aa88ff');
      }

      if (detonated) {
        store.removeEffect(target.id, detonated);
        sink.log(`  ${t('combatLog.log.detonated', { status: statusName(detonated) })}`, '#ff8844');
        // Detonation lights the hex the Burn was spent on
        applyOnDetonate(activeCaster, target, detonated, sink);
      }

      if (skill.pushDistance && finalBlow) {
        const shove = traceForcedMove(
          opts.pushOrigin ?? activeCaster.position,
          target,
          skill.pushDistance,
          useCombatStore.getState().units,
          useCombatStore.getState().hazards,
        );
        const pushed = shove.moved ? shove.to : null;
        if (pushed) {
          // A shove onto or across burning ground pays its fire as it lands
          playTickEvents(store.moveUnit(target.id, pushed, 'walk', false), sink);
          // An eruption throws the bodies on its impact beat, not before it lands
          if (skill.vfxKind === 'upheaval') {
            const shoveDelayMs = preludeMs(skill) + UPHEAVAL_IMPACT_MS * resolveVfxScale(skill);
            useCombatStore.setState((s) => ({
              units: s.units.map((u) => u.id === target.id && u.movement ? { ...u, movement: { ...u.movement, shoveDelayMs } } : u),
            }));
          }
          sink.sound?.(moveIntent(target.id, target.position, pushed, 'shove'));
          sink.log(`  ${t('combatLog.log.pushedBack', { name: unitName(target) })}`, '#ffaa44');
          shovedFrom.set(hexKey(hex), target.id);
        }
        // Driven into something before the shove was spent: Concussive Shot's Stun
        const slammed = unitById(useCombatStore.getState().units, target.id);
        if (shove.blockedBy && skill.collisionEffect && slammed && slammed.currentHp > 0) {
          const entry = skill.collisionEffect;
          sink.log(`  ${t(shove.blockedBy.kind === 'unit' ? 'combatLog.log.slamsBody' : 'combatLog.log.slamsWall', { name: unitName(target) })}`, '#ffaa44');
          applySkillStatus(activeCaster, slammed.id, {
            type: entry.type,
            magnitude: settleMagnitude(entry.type, resolveEntryMagnitude(entry, caster, slammed, skill.scaling)),
            duration: entry.duration,
            exact: entry.exact,
            sourceUnitId: caster.id,
          }, sink);
        }
      }
    }
  }
  // Each hand drains on its own — `max(1, …)` is a floor per blow, and two
  // blows are two chances at it. A single-handed strike leaves the pool for
  // the one settlement after every pass.
  if (hands.length > 1) settleDrain();
  }
  }

  settleDrain();

  // Embedded Blades go in once every pass has landed — the throw and each Flurry
  // knife a blade — and before any extraction, which then pulls them too
  for (const [targetId, passes] of bladePasses) {
    const per = skill.embedsBlades ?? 0;
    const held = store.embedBlades(targetId, caster.id, passes.size * per);
    const victim = unitById(useCombatStore.getState().units, targetId);
    if (held > 0 && victim) sink.log(`  ${t('combatLog.log.carriesBlades', { name: unitName(victim), count: held })}`, BLADE_COLOR);
  }

  // Blade Recall's pull: one undodgeable hit per enemy in the footprint holding
  // this caster's blades, worth a share of Attack per blade removed. It embeds
  // nothing, and an enemy with none of the caster's blades takes nothing.
  const extracted: { id: string; at: HexCoord; count: number }[] = [];
  if (skill.extractsBlades) {
    for (const hex of affected) {
      const target = useCombatStore.getState().getUnitAt(hex);
      if (!target || target.currentHp <= 0 || target.isPlayer === caster.isPlayer) continue;
      if (duelBars(activeCaster, target) || ownBlades(target, caster.id) <= 0) continue;
      const count = store.extractBlades(target.id, caster.id);
      const pull: HeroSkill = {
        ...skill, damage: BALANCE.BLADE_EXTRACT_PER_BLADE * count, amplifiedBy: undefined, detonates: undefined,
      };
      const result = resolveAttack(activeCaster, target, pull, { allUnits: useCombatStore.getState().units, undodgeable: true });
      const hpBefore = target.currentHp;
      const { absorbed, deathEvents, hpLost: lost, shieldedBy, shieldBroke } = store.damageUnit(
        target.id, result.damage, activeCaster.id, { difficultyApplied: true },
      );
      // Heard once per blade pulled out of this enemy
      sink.sound?.(strikeIntent(
        target, delivery, strikeOutcome(result, lost), spellOf(skill, delivery), undefined,
        strikeDetail(skill, { shieldedBy, shieldBroke }, { repeat: count }),
      ));
      sink.float(target.position, result.crit ? `-${result.damage}!` : `-${result.damage}`, hitFloatColor(damageTypeOf(pull)));
      if (absorbed > 0) sink.log(`  ${t('combatLog.log.absorbs', { name: unitName(target), amount: absorbed })}`, BARRIER_COLOR);
      sink.log(`  ${t('combatLog.log.bladesPulled', { name: unitName(target), count, damage: result.damage, crit: critSuffix(result.crit) })}`, BLADE_COLOR);
      extracted.push({ id: target.id, at: target.position, count });
      if (!hitUnitIds.includes(target.id)) hitUnitIds.push(target.id);
      hitCoords.push(target.position);
      anyHit = true;
      damagedEnemy = true;
      lifestealPool += result.damage;
      damageDealt += result.damage;
      floatFireflyHeal(sink, applyLightbond(activeCaster, result.damage, sink));
      playDeathEvents(deathEvents, sink);
      const struck = unitById(useCombatStore.getState().units, target.id);
      const hpLost = hpBefore - (struck?.currentHp ?? hpBefore);
      const hit = applyOnHitStatuses(activeCaster, target, hpLost, sink, hpBefore, result.crit, pull,
        lost > 0 ? Math.max(lost, result.damage - absorbed) : 0);
      extraAction = extraAction || hit.extraAction;
    }
    settleDrain();
  }

  sink = castSink;
  if (danceSteps.length) {
    const stops = [caster.position, ...danceSteps.map(step => step.to)];
    useCombatStore.setState(state => ({ units: state.units.map(unit => unit.id === caster.id
      ? { ...unit, movement: { mode: 'dash', from: caster.position, path: stops,
        dance: { stops, delayMs: preludeMs(skill) } } } : unit) }));
  }

  // The Templar's spill: a damaging blow mends the nearest wounded ally. Off
  // the summed damage like lifesteal, so a multi-strike cast heals once.
  for (const spill of applyAllyHealOnHit(activeCaster, skill, damageDealt, sink)) {
    sink.float(spill.at, `+${spill.amount}`, FLOAT_COLOR.heal);
  }
  // Glowmote's mote: off the summed damage like the spill, flying on from the
  // bolt's landing to whoever it mends (two of them with Twin Motes)
  for (const mote of applyMote(activeCaster, skill, damageDealt, sink, struckByCast[0]?.id)) {
    floatFireflyHeal(sink, mote);
    sink.vfx({
      kind: 'bolt', delivery: 'spell', casterId: caster.id, casterPos: targetCoord, targetCoord: mote.at,
      hitUnitIds: [mote.unitId], hitCoords: [mote.at], color: FIREFLY_AMBER, durationScale: 0.8,
      delayMs: preludeMs(skill) + FLOAT_STAGGER_MS,
    });
  }

  // Where the blows were struck from, before any withdrawal: that is where the
  // swing is heard leaving, on this side and on the AI's.
  const struckFrom = activeCaster;

  // Retreat resolves last — hit and run, in that order. Occupancy is read
  // fresh because a knockback earlier in this same strike may have moved
  // somebody into the hex we would have withdrawn through.
  if (skill.selfMove?.kind === 'retreat' && anyHit) {
    const withdrawn = resolveSelfMove(
      activeCaster,
      skill,
      targetCoord,
      useCombatStore.getState().units,
      useCombatStore.getState().hazards,
    );
    if (withdrawn) {
      // Dive is drawn as one flight down onto its victim and away (`swoop`)
      if (skill.id === 'dive') store.moveUnit(caster.id, withdrawn, 'swoop', undefined, targetCoord);
      else store.moveUnit(caster.id, withdrawn);
      sink.sound?.(moveIntent(caster.id, activeCaster.position, withdrawn, 'retreat'));
      activeCaster = { ...activeCaster, position: withdrawn };
      sink.log(`  ${t('combatLog.log.withdraws', { name: unitName(caster) })}`, '#88ccff');
    }
  }

  // Pilgrim's Step: the blow landed (or was dodged), and the caster is behind its prey —
  // a blink, so it crosses the body, and a Root holds it where it struck from
  if (skill.blinksBehind === 'after' && anyHit && !opts.resolving && !opts.echo && occupant) {
    const live = useCombatStore.getState();
    const self = unitById(live.units, caster.id);
    const prey = unitById(live.units, occupant.id);
    const landing = self && self.currentHp > 0 && !isRooted(self)
      ? flickerLanding(self, prey, live.units, live.hazards)
      : undefined;
    if (self && prey && landing) {
      store.moveUnit(caster.id, landing, 'dash');
      sink.sound?.(moveIntent(caster.id, self.position, landing, 'blink'));
      activeCaster = { ...activeCaster, position: landing };
      logFlicker(sink, caster, prey);
    }
  }

  const applied = skillEffects(skill);
  if (applied.length > 0 || skill.cleanse) {
    const latestUnits = useCombatStore.getState().units;
    for (const hex of affected) {
      // A body shoved off this hex by the blow still takes what the blow carries
      // (Horn Sweep's Attack Down, Grip and Throw's Stun)
      const shovedId = shovedFrom.get(hexKey(hex));
      const target = shovedId
        ? latestUnits.find((u) => u.id === shovedId && u.currentHp > 0)
        : latestUnits.find((u) => u.currentHp > 0 && u.position.q === hex.q && u.position.r === hex.r);
      if (!target || duelBars(activeCaster, target)) continue;
      // Side is decided per entry, not per skill: a blessing that is two auras
      // and a curse that is two afflictions both work, and so does a skill
      // carrying one of each. `effectReaches` is that rule plus `selfOnly`, and
      // it is shared with `enemyAI` rather than restated — the two paths have
      // drifted over exactly this kind of clause before.
      // Reposition aimed at an ally: the caster stands beside them now and the
      // aura is split, each of the two getting `allyShare` of it.
      const splitWith = skill.allyShare && target.id !== caster.id && target.isPlayer === caster.isPlayer
        ? caster : null;
      // Fuel the Flame asks whether the fire was already going before this cast lit it
      const wasBurning = target.activeEffects.some((e) => e.type === AfflictionType.Burn);
      for (const entry of applied) {
        const { type, duration, exact } = entry;
        if (type === AfflictionType.SacredSeal && !struckByCast.some(u => u.id === target.id)) continue;
        const shouldApply = effectReaches(entry, caster, target) && effectLands(entry);
        if (shouldApply) {
          for (const recipient of splitWith ? [target, splitWith] : [target]) {
            const share = splitWith ? skill.allyShare! : 1;
            const outcome = applySkillStatus(
              activeCaster,
              recipient.id,
              {
                // Smoke Bomb's cloud stays where it was dropped: the hexes go with it
                ...(type === AuraType.SmokeCover && { zone: affected }),
                type,
                magnitude: settleMagnitude(type, resolveEntryMagnitude(entry, caster, recipient, skill.scaling) * share),
                duration,
                // Forwarded rather than dropped: both execution paths rebuild the
                // effect field by field, so an addition to `SkillEffect` reaches
                // the store only if it is named here *and* in `enemyAI`. That is
                // the seam `docs/combat.md` warns about — an enemy Hydromancer's tornado
                // must not freeze what the player's cannot.
                exact,
                sourceUnitId: caster.id,
                ...(type === AfflictionType.SacredSeal && { sourceSide: caster.isPlayer,
                  healMagnitude: calculateHealing(caster, { ...skill, healing: BALANCE.SACRED_SEAL_HEAL }) }),
              },
              sink
            );
            // A poison overdose is real damage arriving from a status application,
            // so it needs the number on the board that any other blow would get
            if (outcome) {
              sink.sound?.(afflictionIntent(recipient, AfflictionType.Poison));
              sink.float(
                recipient.position,
                outcome.crit ? `-${outcome.burst}!` : `-${outcome.burst}`,
                FLOAT_COLOR.poison,
              );
            }
          }
          anyHit = true;
          // Fuel the Flame: one extra stack on a target that was already burning
          const fuel = type === AfflictionType.Burn && fuelTheFlameBurn(
            activeCaster, skill, wasBurning, resolveEffectMagnitude(type, entry.magnitude, caster, skill.scaling),
          );
          if (fuel) {
            applySkillStatus(activeCaster, target.id, { type, magnitude: fuel, duration, sourceUnitId: caster.id }, sink);
            sink.log(`  ${t('combatLog.log.burnsHotter', { source: passiveName('fuelTheFlame'), name: unitName(target) })}`, '#ff8a1e');
          }
        }
      }
      if (skill.cleanse && target.isPlayer === caster.isPlayer) {
        // Counted before they are stripped: Oath rewards a cleanse that removed
        // something, not one aimed at an ally who was already clean.
        const fresh = unitById(useCombatStore.getState().units, target.id) ?? target;
        const afflictions = fresh.activeEffects.filter((e) => isCleansable(e.type)).length;
        store.removeAllAfflictions(target.id);
        if (afflictions > 0) {
          sink.log(`  ${t('combatLog.log.cleansed', { name: unitName(target) })}`, '#c8f0ff');
          applyOnCleanse(activeCaster, fresh, afflictions, sink);
        }
        anyHit = true;
      }
    }
    // A `selfOnly` entry lands on the caster wherever the footprint is: a skill
    // aimed at somebody else (Carapace Leap's answer, at its ward) still gives
    // its caster its own share. A footprint the caster stands in did so above.
    const selfEntries = applied.filter((e) => e.selfOnly);
    const self = unitById(useCombatStore.getState().units, caster.id);
    if (selfEntries.length > 0 && self && self.currentHp > 0
      && !affected.some((h) => h.q === self.position.q && h.r === self.position.r)) {
      for (const entry of selfEntries) {
        if (!effectLands(entry)) continue;
        applySkillStatus(activeCaster, self.id, {
          type: entry.type,
          magnitude: settleMagnitude(entry.type, resolveEntryMagnitude(entry, caster, self, skill.scaling)),
          duration: entry.duration,
          exact: entry.exact,
          sourceUnitId: caster.id,
        }, sink);
        anyHit = true;
      }
    }
  }

  // Primal Surge: the shapes' own skills come forward; shifts and capstones do not
  if (skill.refreshesFormSkills) {
    const held = unitById(useCombatStore.getState().units, caster.id);
    if (held) store.refundCooldown(caster.id, skill.refreshesFormSkills, shapeSkillIds(held));
    anyHit = true;
  }

  // Firefly Motes: the cast is the motes, laid on free ground round the caster
  if (skill.motes && !opts.echo) {
    if (layMotes(activeCaster, skill, sink).length === 0) return refuse('no-summon-room', t('combatLog.refuse.noMoteRoom'));
    anyHit = true;
  }

  // Living ground is laid even over empty hexes: the sanctuary is the cast.
  if (skill.sanctuary && affected.length > 0) {
    laySanctuary(activeCaster, skill, affected, sink);
    anyHit = true;
  }
  // Carapace Bastion: the slam is the cast, and the ground stays where it fell
  if (skill.bastion && affected.length > 0 && !opts.echo && layBastion(activeCaster, skill, affected, sink)) {
    anyHit = true;
  }

  // Aftershock: a Tremor that went off leaves its ground marked for one more
  // eruption at the start of the caster's next regular turn
  if (anyHit && markAftershock(activeCaster, skill, affected)) {
    sink.log(`  ${t('combatLog.log.groundShaking', { skill: skillName(skill) })}`, '#c8a878');
  }

  if (!anyHit) {
    // A gated skill that found nobody says *why*. "No valid targets" on a
    // finisher reads as a bug when the enemy is standing right there.
    if (skill.extractsBlades) return refuse('no-targets', t('combatLog.refuse.noBlades'));
    return requiresExecutable(skill)
      ? refuse('no-targets', t('combatLog.refuse.notWounded'))
      : refuse('no-targets', t('combatLog.refuse.noTargets'));
  }

  // Reaping Momentum's memory: this reap's prey and the stacks it carried. Only Twin
  // Reap writes it, so every other skill between two reaps keeps the count.
  if (reapPrey) {
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === caster.id ? { ...u, reapPrey: { targetId: reapPrey.id, stacks: reapStack } } : u)),
    }));
    if (reapStack > 0) sink.log(`  ${passiveName('reapingMomentum')} ×${reapStack}`, MANTIS_GREEN);
  }

  // Cycle of Life's bookkeeping, spend before award: a cast that paid out clears
  // the charges, then a cast that restored HP banks one (up to the full set).
  if (growthPaid.size > 0) store.removeEffect(caster.id, AuraType.Growth);

  // Turn caster to face the target before the turn ends.
  //
  // A cone faces the axis it snapped to rather than the hex that was tapped, so
  // the model, the wedge and the hexes that actually burn all point the same
  // way. Facing the tapped hex left the caster aimed up to thirty degrees off
  // its own blast, which is most of what read as "the cone fires wherever it
  // likes".
  store.setFacing(
    caster.id,
    skill.targetType === SkillTargetType.Arc
      // From where the blow was struck: Shield Avalanche dashes first, and an aim
      // hex taken off the start had the Bulwark land facing back the way he came
      ? arcAimHex(struckFrom.position, targetCoord)
      : targetCoord,
  );
  // Flash all hexes in the AoE area (including empty tiles and allied tiles),
  // not just those where a unit was actually struck.
  const flashCoords = affected.length > 1 ? affected : hitCoords;
  const passCount = strikeScales(activeCaster, skill).length;
  const threw = !skill.extractsBlades || hasPassive(caster, 'fanOfBlades');
  const effect: VfxSpec = {
    ...skillVfx(skill, caster, caster.position, activeCaster.position),
    casterId: caster.id,
    // A cone opens where it was struck from — the landing, for Shield Avalanche's
    // dash. Every other kind keeps the start: slashes and dash trails read it
    casterPos: skill.targetType === SkillTargetType.Arc ? struckFrom.position : caster.position,
    // Antler Charge bursts round its landing, so the picture is centred there
    targetCoord: skill.landingBurst ? activeCaster.position : targetCoord,
    hitUnitIds,
    ...(danceSteps.length > 0 && { danceSteps }),
    hitCoords: skill.knifeDance ? hitCoords : flashCoords,
    ...(skill.barrage && { projectiles: skill.barrage }),
  };
  if (threw) sink.vfx(effect);
  for (const followup of danceFollowups) sink.vfx(followup);
  if (skill.extractsBlades) {
    // One cone (when there was a throw), then each Flurry knife from the caster to
    // every enemy the throw reached, then the blades pulled back out of each enemy
    const knifeFrom = threw ? 1 : 0;
    const victims = struckByCast.map((u) => u.position);
    const lead = (threw ? preludeMs(skill) : 0) + (threw ? FLOAT_STAGGER_MS : 0);
    for (let i = knifeFrom; i < passCount; i++) {
      for (const at of victims) {
        sink.vfx({
          kind: 'shot', delivery: 'thrown', casterId: caster.id, casterPos: caster.position, targetCoord: at,
          hitUnitIds: [], hitCoords: [at], color: skill.vfxColor ?? BLADE_COLOR, durationScale: 0.6,
          delayMs: lead + (i - knifeFrom) * FLOAT_STAGGER_MS,
        });
      }
    }
    if (extracted.length > 0) {
      // On the numbers' clock (`impactVfx`), torn out as the pull's numbers land:
      // after the throw's and each knife's number on the same anchor
      (sink.impactVfx ?? sink.vfx)({
        kind: 'extract', delivery: 'thrown', casterId: caster.id, casterPos: activeCaster.position, targetCoord,
        hitUnitIds: extracted.map((e) => e.id), hitCoords: extracted.map((e) => e.at),
        projectiles: extracted.reduce((n, e) => n + e.count, 0),
        color: skill.vfxColor ?? BLADE_COLOR,
        delayMs: Math.max(0, passCount * FLOAT_STAGGER_MS - EXTRACT_MS * EXTRACT_TEAR),
      });
    }
  }
  // A blow is heard as it is swung, which waits for its tell; a spell's cast is
  // heard as it begins, which is the tell (`launchLeadMs`).
  const lead = launchLeadMs(skill, delivery) + (skill.selfMove?.kind === 'dash' ? effect.delayMs ?? 0 : 0);
  sink.sound?.(voiced(launchIntent(struckFrom, skill, delivery, lead), opts.landing ? skillVoice(skill.id, { beat: 'release' }) : undefined));
  // A dual-wielder's blows are drawn one after another, each one float-stagger
  // behind the last — the gap the float queue puts between their numbers on
  // the same anchor, so every blow's picture arrives with its own number. Each
  // drawn blow is swung, so each is heard leaving the hand on the same clock.
  // The later blows have no tell of their own: they follow the first one's.
  // A barrage and a repeating beam draw every one of their hits in their own shape
  if (!skill.knifeDance && !skill.barrage && !skill.repeats && !skill.extractsBlades && hands.length * strikeScales(activeCaster, skill).length > 1) {
    const blows = hands.length * strikeScales(activeCaster, skill).length;
    for (let i = 1; i < blows; i++) {
      sink.vfx({ ...effect, prelude: undefined, delayMs: (effect.delayMs ?? 0) + preludeMs(skill) + i * FLOAT_STAGGER_MS, strikeIndex: i });
      sink.sound?.(launchIntent(struckFrom, skill, delivery, lead + i * FLOAT_STAGGER_MS));
    }
  }

  if (skill.grantsUntargetable) store.setUntargetable(caster.id, true);

  // Overload: a bolt spends the charge it was boosted by (whether or not it landed:
  // the cast is what is spent), then the cast is read for a new charge. In that
  // order, so a cast cannot both spend and refill the same one.
  const holder = unitById(useCombatStore.getState().units, caster.id);
  if (opts.echo) return { ok: true, endsTurn: false };
  if (isLightningBolt(skill) && holder && hasEffect(holder, AuraType.Overloaded)) {
    store.removeEffect(caster.id, AuraType.Overloaded);
    sink.log(`  ${t('combatLog.log.overloadDischarges', { name: unitName(caster) })}`, '#9ee8ff');
  }
  applyOnCast(activeCaster, skill, struckByCast, sink);

  // A released charge is spent by firing it
  if (skill.releasing) store.removeEffect(caster.id, chargeAura(skill));
  // Settle In's charge is spent by the ranged damaging cast it sharpened
  if (!opts.resolving && settleInApplies(skill)) store.removeEffect(caster.id, AuraType.SettledAim);

  // Paid at the cast for a warned attack, not again when it lands
  if (!opts.resolving) {
    if (manaToPay > 0) store.spendMana(caster.id, manaToPay);
    // Chi's refill lands once per Basic Attack action, dodged or not — after the
    // pay, and once for a dual-wield swing, whose two blows are this one action
    if (skill.id === BASIC_ATTACK_ID) refillChi(caster.id, 'basicAttack', sink);
    // Meditate's chi lands now; its heal and buffs wait for the next turn start.
    // Shell Breath adds to the refill and banks a Carapace charge with it
    if (skill.id === MEDITATE_ID) {
      refillChi(caster.id, 'meditate', sink, meditateChiBonus(caster));
      if (hasPassive(caster, 'shellBreath')) bankCarapace(caster.id, BALANCE.BEETLE.SHELL_BREATH_CHARGES, sink);
    }
    // Iron Carapace banks its charge with the cast, dodged or not, as a swing refills chi
    if (skill.id === IRON_CARAPACE_ID) bankCarapace(caster.id, 1, sink);
    // A killing Mantis Execution: a bonus turn at once, and the cooldown left unstarted
    const executed = !!executionPrey && executionPrey.currentHp > 0
      && (unitById(useCombatStore.getState().units, executionPrey.id)?.currentHp ?? 0) <= 0;
    if (executed) {
      queueMantisTurns(caster.id, [EXECUTION_TURN]);
      sink.log(`  ${t('combatLog.log.actsAgain', { source: skillName({ id: 'mantis_execution' }), name: unitName(caster) })}`, MANTIS_GREEN);
    }
    // Threefold Scythe's launch: two bonus turns at once, each locked to its stage
    if (skill.mantisCapstone === 'threefoldScythe' && !skill.mantisStage) queueMantisTurns(caster.id, SCYTHE_TURNS);
    // An aimed release's cooldown was started at the aim; a Scythe stage's at the launch
    if (!(skill.releasing && skill.charge?.aimed) && !skill.mantisStage && !executed) store.startCooldown(caster.id, skill);
    // Into the Dark: a step that killed with its own blow had no cooldown running when `onKill` fired
    if (skill.id === SHADOWSTEP_ID && hasPassive(caster, 'intoTheDark')
      && struckByCast.some((u) => (unitById(useCombatStore.getState().units, u.id)?.currentHp ?? 0) <= 0)) {
      store.refundCooldown(caster.id, intoTheDarkTurns(passiveRank(caster, 'intoTheDark')), [SHADOWSTEP_ID]);
      sink.log(`  ${passiveName('intoTheDark')}`, '#66ccff');
    }
    // An Apex spell is spent for the rest of this Apex shape
    if (skill.formSkill === 'apex') store.spendApexSpell(caster.id, skill.id);
    // Paid for: whatever an encounter laid on the caster answers it (a Writ, a seal, a Geas)
    castPaid(caster, skill, hitUnitIds, sink);
    if (reapChi > 0) applyPassiveOutcomes([{ kind: 'chi', unitId: caster.id, amount: reapChi, log: passiveName('reapersBreath') }], sink);
  }

  // A banked Vanish action is spent here rather than on a kill, and only if
  // nothing else already refunded the turn — spending a charge to keep a turn
  // Frenzy had already kept would burn one of three for nothing.
  if (!extraAction && store.spendAmbushCharge(caster.id)) {
    sink.log(`  ${t('combatLog.log.movingAgain', { name: unitName(caster) })}`, '#aa88ff');
    extraAction = true;
  }

  /**
   * The caster's own price, paid last.
   *
   * After the strike rather than before it, because `wrath` reads how hurt the
   * unit is when damage is calculated — taking the wound first would let Blood
   * Price pay for its own buff twice over on the same turn.
   */
  if (skill.selfDamage) {
    store.damageUnit(caster.id, skill.selfDamage);
    sink.log(`  ${t('combatLog.log.paysHealth', { name: unitName(caster), amount: skill.selfDamage })}`, '#cc2244');
  }

  // The Thunder Elemental casts it again, after everything the original did
  echoThroughCompanions(caster, skill, targetCoord, affected, sink);

  // Frenzy: the kill refunds the action rather than ending the turn. The
  // cooldown and mana still stand — otherwise a chain of kills would be free.
  //
  // `freeAction` is the same answer arrived at from the other end: Reposition
  // costs its mana and its cooldown and simply does not spend the turn.
  // What the cast did, for the passives about it: Cycle of Life banks a charge for a healing cast
  // and Slipstream leaves a free step after a damaging one — the cast is the turn's action, so
  // once per regular turn
  const healedAlly = useCombatStore.getState().units
    .some((u) => u.currentHp > (allyHpAtStart.get(u.id) ?? Infinity));
  if (applyOnSkillResolved(caster, skill, { restoredByCast, damagedEnemy, healedAlly, spendsAction: !opts.resolving && !extraAction }, sink)) {
    return { ok: true, endsTurn: false };
  }
  // Mark and Move: Mark Target spends the action and leaves a short move. The
  // turn waits for it (or for End Turn); Root leaves nothing to grant.
  if (!opts.resolving && !extraAction && skill.id === 'mark_target' && hasPassive(caster, 'markAndMove')) {
    const after = unitById(useCombatStore.getState().units, caster.id);
    if (after && after.currentHp > 0 && !isRooted(after)) {
      store.grantReposition(caster.id, markAndMoveRange(passiveRank(caster, 'markAndMove')));
      sink.log(`  ${t('combatLog.log.mayReposition', { name: unitName(caster) })}`, MARKSMAN_YELLOW);
      return { ok: true, endsTurn: false };
    }
  }

  // Shadow Echo: after the action, the turn waits for a return to the shadow (it
  // costs mana and no action) or End Turn, while a return is possible at all.
  if (!opts.resolving && !extraAction && !skill.freeAction && echoHoldAfter(caster, sink)) {
    return { ok: true, endsTurn: false };
  }

  return { ok: true, endsTurn: !extraAction && !skill.freeAction };
}

/** A Firefly heal's number, where it landed (the mote, a Lightbond). */
function floatFireflyHeal(sink: CombatSink, healed: FireflyHealOutcome | undefined): void {
  if (healed) sink.float(healed.at, `+${healed.amount}`, FLOAT_COLOR.heal);
}

/**
 * Shadow Echo's post-action window: when the caster holds the node and could
 * return to its shadow now, the turn waits for the return or End Turn
 * (`combatStore.holdForEcho`) instead of ending. Returns whether it waits.
 */
/**
 * Pay a chi refill into a unit's pool and float it (`systems/combat/chi`). Does
 * nothing for a unit that does not use chi, or whose pool is already full.
 */
export function refillChi(unitId: string, source: ChiRefillSource, sink: CombatSink, extra = 0): number {
  const unit = unitById(useCombatStore.getState().units, unitId);
  if (!unit) return 0;
  const gained = chiRefill(unit, source, extra);
  if (gained <= 0) return 0;
  useCombatStore.getState().restoreMana(unitId, gained);
  sink.float(unit.position, t('combatLog.float.chi', { amount: gained }), CHI_COLOR);
  return gained;
}

/**
 * Bank Carapace charges on a Beetle (`beetle.bankedCarapace`), up to a full set,
 * and say so. A bank at a full set changes nothing and says nothing.
 */
export function bankCarapace(unitId: string, count: number, sink: CombatSink): number {
  const store = useCombatStore.getState();
  const unit = unitById(store.units, unitId);
  if (!unit || unit.currentHp <= 0) return 0;
  const before = carapaceCharges(unit);
  const banked = bankedCarapace(unit, count);
  if (banked.magnitude <= before) return before;
  store.applyEffect(unitId, banked);
  const full = banked.magnitude >= carapaceMax(unit);
  const charges = { name: unitName(unit), charges: `${banked.magnitude}/${carapaceMax(unit)}` };
  sink.log(`  ${t(full ? 'combatLog.log.carapaceFull' : 'combatLog.log.carapaceBanked', charges)}`, CARAPACE_COLOR);
  sink.float(unit.position, full ? t('combatLog.float.carapaceFull') : t('combatLog.float.carapace', { count: banked.magnitude }), CARAPACE_COLOR);
  return banked.magnitude;
}

function echoHoldAfter(caster: CombatUnit, sink: CombatSink): boolean {
  if (!hasPassive(caster, 'shadowEcho')) return false;
  const live = useCombatStore.getState();
  const after = unitById(live.units, caster.id);
  if (!after || echoReturnBlock(after, live.units) !== null) return false;
  live.holdForEcho(caster.id);
  sink.log(`  ${t('combatLog.log.mayReturnShadow', { name: unitName(caster) })}`, SHADOW_ECHO_COLOR);
  return true;
}

/** The steel of the Skirmisher's blades, for the lines that count them. */
const BLADE_COLOR = '#c0c8d0';

function orderForPush(origin: HexCoord, hexes: HexCoord[]): HexCoord[] {
  return [...hexes].sort(
    (a, b) =>
      hexDistance(origin, b) - hexDistance(origin, a) || a.q - b.q || a.r - b.r,
  );
}

/**
 * Where a barrage's next projectile goes: the current target while it lives,
 * else the nearest living enemy within the skill's range of the caster (ties by
 * distance to the fallen target, then by coordinate, so a replay is the same).
 * Undefined when nothing is left in range.
 */
/**
 * The picture, the line and the sound of a shift — the whole of what a Wildshape
 * cast shows. Shared with the opening shape a Druid carries into a fight
 * (`openingForms`), so walking in as a bear is drawn exactly as becoming one is.
 */
export function announceShift(
  caster: CombatUnit,
  skill: HeroSkill,
  shift: WildFormId | null,
  sink: CombatSink,
): void {
  const form = shift ? WILD_FORMS[shift] : null;
  sink.log(
    form ? t('combatLog.log.takesForm', { name: unitName(caster), form: wildFormName(form.id) }) : t('combatLog.log.ownShape', { name: unitName(caster) }),
    form?.color ?? '#88aa44'
  );
  sink.vfx({
    // Taking a shape is drawn as the skill says (Apex surges); giving one up is a quiet ring
    kind: shift ? (skill.vfxKind ?? 'buff') : 'buff', delivery: 'spell',
    casterId: caster.id,
    casterPos: caster.position,
    targetCoord: caster.position,
    hitUnitIds: [caster.id],
    hitCoords: [caster.position],
    color: form?.color ?? '#88aa44',
    durationScale: resolveVfxScale(skill),
  });
  sink.sound?.(launchIntent(caster, skill, strikeDelivery(skill, caster), undefined, shiftGesture(shift)));
}

export function barrageTarget(
  caster: CombatUnit,
  skill: HeroSkill,
  current: HexCoord,
  units: CombatUnit[],
): HexCoord | undefined {
  const alive = (u: CombatUnit) => isAlive(u) && u.isPlayer !== caster.isPlayer && !u.untargetable;
  const standing = units.find((u) => alive(u) && u.position.q === current.q && u.position.r === current.r);
  if (standing) return current;
  const next = units
    .filter((u) => alive(u) && hexDistance(caster.position, u.position) <= skill.range)
    .sort((a, b) =>
      hexDistance(caster.position, a.position) - hexDistance(caster.position, b.position)
      || hexDistance(current, a.position) - hexDistance(current, b.position)
      || a.position.q - b.position.q || a.position.r - b.position.r)[0];
  return next?.position;
}

/**
 * A companion's echo of its owner's Stormcaller spell (the Thunder Elemental).
 *
 * One echo per original cast and per living companion of that owner, never an echo
 * of an echo, never of a Basic Attack or of the summon itself (`isStormcallerSpell`).
 * The echo strikes the original's footprint — Skyfall's rolled enemies, Thunderstep's
 * landing ring, Chain Lightning's route — from wherever the companion now stands, with
 * the companion's own Magic: its share of the owner's *current* effective Magic, read
 * at the echo, so a Magic buff on the owner reaches it. Its crits are its own roll;
 * the owner's passives and modifiers are not inherited, Forked Current's second hop
 * aside (`shockSecondHopShare`). A target that died before the
 * echo is missed rather than replaced. Drawn `ECHO_DELAY_MS` after the original.
 */
function echoThroughCompanions(
  owner: CombatUnit,
  skill: HeroSkill,
  targetCoord: HexCoord,
  affected: HexCoord[],
  sink: CombatSink,
): void {
  if (!isStormcallerSpell(skill)) return;
  const store = useCombatStore.getState();
  const ownerNow = unitById(store.units, owner.id);
  if (!ownerNow) return;
  const companions = store.units.filter((u) => u.companion && u.summonedBy === owner.id && u.currentHp > 0);
  if (companions.length === 0) return;
  const impact = sink.impactVfx;
  const later: CombatSink = {
    ...sink,
    vfx: (spec) => sink.vfx({ ...spec, delayMs: (spec.delayMs ?? 0) + ECHO_DELAY_MS }),
    ...(impact && {
      impactVfx: (spec: VfxSpec) => impact({ ...spec, delayMs: (spec.delayMs ?? 0) + ECHO_DELAY_MS }),
    }),
  };
  const ownerMagic = getCombatEffectiveStats(ownerNow).magic;
  for (const companion of companions) {
    store.setUnitMagic(companion.id, companionMagic(ownerMagic, companion.echoMagic ?? 0));
    const echoer = unitById(useCombatStore.getState().units, companion.id);
    if (!echoer || echoer.currentHp <= 0) continue;
    resolveSkillUse(echoer, skill, targetCoord, later, { echo: true, fixedHexes: affected });
  }
}

// ── Wildshape remaster (2026-10) ─────────────────────────────────────────────

/** Mark colours, as the status float announces them; the word is the status's own name. */
const MARK_COLOR: Record<AfflictionType.HuntersMark | AfflictionType.CrownedPrey, string> = {
  [AfflictionType.HuntersMark]: '#f2c84a',
  [AfflictionType.CrownedPrey]: '#9dff6a',
};

/**
 * Lays a skill's `marks` on the enemy its blow just landed on, replacing any mark of
 * the same kind. Crowned Prey's bonus is fixed now from the marker's Attack, so the
 * crown keeps its worth after the Apex shape is gone; Hunter's Mark stores its bonus
 * as a percentage.
 */
function layStrikeMark(caster: CombatUnit, targetId: string, skill: HeroSkill, sink: CombatSink): void {
  const spec = skill.marks;
  if (!spec) return;
  const store = useCombatStore.getState();
  const victim = unitById(store.units, targetId);
  if (!victim || victim.currentHp <= 0) return;
  const magnitude = spec.type === AfflictionType.CrownedPrey
    ? Math.max(1, Math.round(spec.bonus * getCombatEffectiveStats(caster).attack))
    : Math.round(spec.bonus * 100);
  store.removeEffect(targetId, spec.type);
  store.applyEffect(targetId, {
    type: spec.type, magnitude, duration: spec.duration, stacks: spec.charges,
    sourceUnitId: caster.id, sourceSide: caster.isPlayer,
  });
  const laid = unitById(useCombatStore.getState().units, targetId)?.activeEffects.some((e) => e.type === spec.type);
  if (laid) sink.status(victim.position, statusName(spec.type), MARK_COLOR[spec.type]);
}

/**
 * The skills Primal Surge refreshes: every Bear, Wolf and Hawk skill the Druid has —
 * the shapes' innate pairs and what the tree taught them. Never a shift skill, an
 * Apex spell or a capstone.
 */
export function shapeSkillIds(unit: CombatUnit): string[] {
  const shapes = ['bear', 'wolf', 'hawk'] as const;
  const learned = (unit.humanSkills ?? unit.skills)
    .filter((s) => s.formSkill && (shapes as readonly string[]).includes(s.formSkill))
    .map((s) => s.id);
  return [...new Set([...shapes.flatMap((f) => WILD_FORMS[f].skills), ...learned])];
}

/**
 * Ancestral Hunt: Bear, Wolf and Hawk spirits through one enemy, in that order, each
 * on its own beat (`SPIRIT_BEAT_MS` apart, the picture keeping the same clock).
 *
 * Every strike is its own roll — dodge, critical, defence — at the stronger of the
 * Druid's current Attack and Magic, so the spell is as strong upright as in a claw
 * shape. The Bear's lands its Attack Down, the Wolf's returns `wolfLifesteal` of what
 * it dealt as healing, the Hawk's also strikes every other enemy within
 * `splashRadius` of the victim at `splashScale`. If the victim falls early the
 * remaining spirits still arrive — the Hawk's splash still bursts where it stood.
 * The spirits are the spell's picture, not units: nothing is summoned, nothing acts
 * later, and their critical hits are not the Wolf's own (Blood Howl ignores them).
 */
function resolveSpiritHunt(caster: CombatUnit, skill: HeroSkill, targetCoord: HexCoord, sink: CombatSink): SkillResult {
  const spec = skill.spiritHunt!;
  const store = useCombatStore.getState();
  const victim = store.getUnitAt(targetCoord);
  if (!victim || victim.isPlayer === caster.isPlayer || victim.objective) return refuse('no-targets', t('combatLog.refuse.aimEnemy'));
  if (hexDistance(caster.position, targetCoord) > skill.range) return refuse('no-targets', t('combatLog.refuse.outOfRange'));
  if (duelBars(caster, victim)) return refuse('no-targets', t('combatLog.refuse.noTargets'));

  const power = getCombatEffectiveStats(caster);
  const scaling: HeroSkill['scaling'] = power.magic > power.attack ? 'magic' : 'attack';
  const strike = (damage: number, lifesteal?: number): HeroSkill => ({
    ...skill, damage, scaling, damageType: 'physical', lifesteal, spiritHunt: undefined, appliesEffect: undefined,
    targetType: SkillTargetType.Single,
  });
  const delivery = strikeDelivery(skill, caster);
  const hitUnitIds: string[] = [];
  const struck: CombatUnit[] = [];
  const splashHexes = getHexesInRange(targetCoord, spec.splashRadius).filter(inArena);

  sink.log(`${unitName(caster)}: ${skillName(skill)}`, '#ffffff', skillLogIcon(skill));

  const hit = (targetId: string, blow: HeroSkill, beat: number, who: string): number => {
    const target = unitById(useCombatStore.getState().units, targetId);
    if (!target || target.currentHp <= 0) return 0;
    const crowned = crownedPreyFor(caster, target);
    const flank = flankOf(caster, target);
    const result = resolveAttack(caster, target, blow, { flank, allUnits: useCombatStore.getState().units });
    if (result.dodged) {
      sink.sound?.(strikeIntent(target, delivery, 'dodged', spellOf(skill, delivery)));
      sink.float(target.position, dodgeText(), DODGE_COLOR, beat);
      sink.log(`  ${who}: ${t('combatLog.log.dodged', { name: unitName(target) })}`, DODGE_COLOR);
      return 0;
    }
    if (crowned) store.spendMarkCharge(target.id, AfflictionType.CrownedPrey);
    const hpBefore = target.currentHp;
    const { absorbed, deathEvents, hpLost: lost, shieldedBy, shieldBroke } = store.damageUnit(target.id, result.damage, caster.id, { difficultyApplied: true });
    // Which spirit this is, by its beat: the hunt is heard as one run of the three
    sink.sound?.(strikeIntent(
      target, delivery, strikeOutcome(result, lost), spellOf(skill, delivery), flank,
      strikeDetail(blow, { shieldedBy, shieldBroke }, { index: Math.round(beat / SPIRIT_BEAT_MS) }),
    ));
    sink.float(target.position, result.crit ? `-${result.damage}!` : `-${result.damage}`, hitFloatColor(damageTypeOf(blow)), beat);
    if (absorbed > 0) sink.log(`  ${t('combatLog.log.absorbs', { name: unitName(target), amount: absorbed })}`, BARRIER_COLOR);
    sink.log(`  ${who}: ${hitLine(target, result.damage, result.crit)}`, result.crit ? '#ffcc44' : '#ff4444');
    showFlank(sink, caster, target, flank, beat);
    if (!hitUnitIds.includes(target.id)) hitUnitIds.push(target.id);
    if (!struck.some((u) => u.id === target.id)) struck.push(target);
    playDeathEvents(deathEvents, sink);
    const after = unitById(useCombatStore.getState().units, target.id);
    applyOnHitStatuses(caster, target, hpBefore - (after?.currentHp ?? hpBefore), sink, hpBefore, result.crit, blow,
      lost > 0 ? Math.max(lost, result.damage - absorbed) : 0);
    return result.damage;
  };

  // The Bear: a heavy hit and the victim's Attack lowered
  if (hit(victim.id, strike(spec.hit), 0, t('combatLog.log.spiritBear')) > 0) {
    const entry = spec.bearEffect;
    const standing = unitById(useCombatStore.getState().units, victim.id);
    if (standing && standing.currentHp > 0 && effectLands(entry)) {
      applySkillStatus(caster, victim.id, {
        type: entry.type,
        magnitude: settleMagnitude(entry.type, resolveEntryMagnitude(entry, caster, standing, scaling)),
        duration: entry.duration, sourceUnitId: caster.id,
      }, sink);
    }
  }
  // The Wolf: a bite that feeds the Druid
  const bite = strike(spec.hit, spec.wolfLifesteal);
  const bitten = hit(victim.id, bite, SPIRIT_BEAT_MS, t('combatLog.log.spiritWolf'));
  const drained = bitten > 0 ? calculateLifesteal(bite, bitten, caster) : 0;
  if (drained > 0) {
    const landed = store.healUnit(caster.id, drained, caster.id);
    if (landed > 0) {
      sink.float(caster.position, `+${landed}`, FLOAT_COLOR.heal, SPIRIT_BEAT_MS);
      sink.log(`  ${t('combatLog.log.drains', { name: unitName(caster), amount: landed })}`, '#cc44ff');
    }
  }
  // The Hawk: the victim, then everyone beside it
  hit(victim.id, strike(spec.hit), 2 * SPIRIT_BEAT_MS, t('combatLog.log.spiritHawk'));
  for (const hex of splashHexes) {
    if (hex.q === targetCoord.q && hex.r === targetCoord.r) continue;
    const other = store.getUnitAt(hex);
    if (!other || other.isPlayer === caster.isPlayer || other.objective || duelBars(caster, other)) continue;
    hit(other.id, strike(spec.hit * spec.splashScale), 2 * SPIRIT_BEAT_MS, t('combatLog.log.spiritHawk'));
  }

  store.setFacing(caster.id, targetCoord);
  sink.vfx({
    ...skillVfx(skill, caster, caster.position, caster.position),
    casterId: caster.id, casterPos: caster.position, targetCoord,
    hitUnitIds, hitCoords: splashHexes,
  });
  sink.sound?.(launchIntent(caster, skill, delivery, launchLeadMs(skill, delivery)));

  applyOnCast(caster, skill, struck, sink);
  if (skill.manaCost > 0) store.spendMana(caster.id, manaCostFor(caster, skill, victim));
  store.startCooldown(caster.id, skill);
  castPaid(caster, skill, struck.map((u) => u.id), sink);
  return { ok: true, endsTurn: true };
}

/** The log line for a blink behind a prey (`blinksBehind`, either order). */
function logFlicker(sink: CombatSink, caster: CombatUnit, prey: CombatUnit): void {
  sink.log(`  ${t('combatLog.log.flickersBehind', { name: unitName(caster), target: unitName(prey) })}`, MANTIS_GREEN);
}

/** Adds Mantis capstone turns to a unit's queue (`CombatUnit.mantisTurns`), taken by `nextTurn`. */
function queueMantisTurns(unitId: string, turns: readonly MantisTurn[]): void {
  useCombatStore.setState((s) => ({
    units: s.units.map((u) => (u.id === unitId ? { ...u, mantisTurns: [...(u.mantisTurns ?? []), ...turns] } : u)),
  }));
}

/**
 * Marked Prey's release, on the prey the mark names, wherever it stands now.
 *
 * The Mantis blinks in behind it (`strikeLanding`) and lands a Basic Attack that is
 * a certain critical hit — its own dodge roll, its flank, and the on-hit riders a
 * Basic Attack carries, Bleeding Blades' Bleed among them, but no chi refill, since
 * the button pressed was the capstone. Then a second cut worth `markedPreyCut` of
 * what the prey has lost since the mark, the first cut included. That cut is fixed:
 * no roll and no defence, because it is already a count of damage taken. Then the
 * Mantis blinks back to the hex it left, if that hex is free and it is not Rooted.
 * The mark is spent and the cooldown starts; the chi was paid at the mark.
 */
function resolveMarkedPreyRelease(caster: CombatUnit, skill: HeroSkill, targetCoord: HexCoord, sink: CombatSink): SkillResult {
  const store = useCombatStore.getState();
  const mark = heldMark(caster);
  const prey = mark?.aimAt ? unitById(store.units, mark.aimAt) : undefined;
  if (!prey || prey.currentHp <= 0) return refuse('no-targets', t('combatLog.refuse.preyGone'));
  if (prey.position.q !== targetCoord.q || prey.position.r !== targetCoord.r) return refuse('no-targets', t('combatLog.refuse.strikeMarked'));
  if (duelBars(caster, prey)) return refuse('no-targets', t('combatLog.refuse.noTargets'));
  const origin = caster.position;
  const landing = strikeLanding(caster, prey, store.units, store.hazards);
  if (!landing) return refuse('no-landing', t('combatLog.refuse.noWayIn'));
  const moves = landing.q !== origin.q || landing.r !== origin.r;
  if (moves && isRooted(caster)) return refuse('rooted', rootedRefusal());

  sink.log(`${unitName(caster)}: ${skillName(skill)}`, '#ffffff', skillLogIcon(skill));
  if (moves) {
    store.moveUnit(caster.id, landing, 'dash');
    sink.sound?.(moveIntent(caster.id, origin, landing, 'blink'));
    sink.log(`  ${t('combatLog.log.blinksBehind', { name: unitName(caster), target: unitName(prey) })}`, MANTIS_GREEN);
  }
  store.setFacing(caster.id, prey.position);
  const basic = caster.skills.find((s) => s.id === BASIC_ATTACK_ID);
  const delivery = strikeDelivery(basic ?? skill, caster);

  // The first cut: the Basic Attack, a certain critical hit
  const striker = unitById(useCombatStore.getState().units, caster.id) ?? caster;
  if (basic) {
    const target = unitById(useCombatStore.getState().units, prey.id) ?? prey;
    const flank = flankOf(striker, target);
    const result = resolveAttack(striker, target, basic, { flank, allUnits: useCombatStore.getState().units, guaranteedCrit: true });
    if (result.dodged) {
      sink.sound?.(strikeIntent(target, delivery, 'dodged', spellOf(basic, delivery)));
      sink.float(target.position, dodgeText(), DODGE_COLOR);
      sink.log(`  ${t('combatLog.log.dodged', { name: unitName(target) })}`, DODGE_COLOR);
    } else {
      const hpBefore = target.currentHp;
      const { absorbed, deathEvents, hpLost: lost, shieldedBy, shieldBroke } = store.damageUnit(target.id, result.damage, caster.id, { difficultyApplied: true });
      sink.sound?.(strikeIntent(
        target, delivery, strikeOutcome(result, lost), spellOf(basic, delivery), flank,
        strikeDetail(basic, { shieldedBy, shieldBroke }, { skillId: skill.id, index: 0 }),
      ));
      sink.float(target.position, `-${result.damage}!`, hitFloatColor(damageTypeOf(basic)));
      if (absorbed > 0) sink.log(`  ${t('combatLog.log.absorbs', { name: unitName(target), amount: absorbed })}`, BARRIER_COLOR);
      sink.log(`  ${hitLine(target, result.damage, true)}`, '#ffcc44');
      showFlank(sink, striker, target, flank);
      playDeathEvents(deathEvents, sink);
      const after = unitById(useCombatStore.getState().units, target.id);
      applyOnHitStatuses(striker, target, hpBefore - (after?.currentHp ?? hpBefore), sink, hpBefore, true, basic,
        lost > 0 ? Math.max(lost, result.damage - absorbed) : 0);
    }
  }

  // The second cut: a share of everything the prey has lost since the mark
  const standing = unitById(useCombatStore.getState().units, prey.id);
  const self = unitById(useCombatStore.getState().units, caster.id);
  if (standing && standing.currentHp > 0 && self && self.currentHp > 0) {
    const cut = markedPreyCut(heldMark(self), getCombatEffectiveStats(self).attack);
    if (cut > 0) {
      // Counted from damage already taken, so the run's difficulty is in it once already
      const { absorbed, deathEvents, hpLost: cutLost, shieldedBy, shieldBroke } = store.damageUnit(standing.id, cut, caster.id, { difficultyApplied: true });
      // The second cut is a blow of its own, heard with its own number
      sink.sound?.(strikeIntent(
        standing, delivery, strikeOutcome({ dodged: false, crit: false }, cutLost), spellOf(basic ?? skill, delivery), undefined,
        strikeDetail(undefined, { shieldedBy, shieldBroke }, { skillId: skill.id, index: 1 }),
      ));
      sink.float(standing.position, `-${cut}`, MANTIS_GREEN, FLOAT_STAGGER_MS);
      if (absorbed > 0) sink.log(`  ${t('combatLog.log.absorbs', { name: unitName(standing), amount: absorbed })}`, BARRIER_COLOR);
      sink.log(`  ${skillName(skill)}: ${unitName(standing)} -${cut}`, MANTIS_GREEN);
      playDeathEvents(deathEvents, sink);
    } else {
      sink.log(`  ${t('combatLog.log.lostNothing', { name: unitName(standing) })}`, MANTIS_GREEN);
    }
  }

  // And back to the hex it left
  const live = useCombatStore.getState();
  const back = unitById(live.units, caster.id);
  if (moves && back && back.currentHp > 0 && !isRooted(back) && standableFor(caster.id, live.units, live.hazards)(origin)) {
    store.moveUnit(caster.id, origin, 'dash');
    sink.sound?.(moveIntent(caster.id, back.position, origin, 'blink'));
    sink.log(`  ${t('combatLog.log.backWhereStood', { name: unitName(caster) })}`, MANTIS_GREEN);
  }

  store.removeEffect(caster.id, AuraType.MarkedPrey);
  store.startCooldown(caster.id, skill);
  sink.vfx({
    ...skillVfx(skill, caster, landing, landing),
    casterId: caster.id, casterPos: landing, targetCoord: prey.position,
    hitUnitIds: [prey.id], hitCoords: [prey.position],
  });
  // The blow is the Basic Attack's; the moment is Marked Prey's release
  sink.sound?.(voiced(launchIntent(striker, basic ?? skill, delivery, launchLeadMs(basic ?? skill, delivery)), skillVoice(skill.id, { beat: 'release' })));
  castPaid(caster, skill, [prey.id], sink);
  return { ok: true, endsTurn: true };
}

/**
 * A landed blow from the target's side or back, shown: the SIDE or BACK word with
 * its multiplier, on the status channel so it rises after the blow's own number,
 * and the `flank` effect on the struck unit as the blow lands. The ear has it on
 * the strike's intent. Nothing for a blow from the front.
 */
function showFlank(sink: CombatSink, attacker: CombatUnit, target: CombatUnit, flank: Flank, delayMs = 0): void {
  const word = flankFloat(flank);
  const fx = flankVfx(attacker, target, flank);
  if (!word || !fx) return;
  (sink.impactVfx ?? sink.vfx)({ ...fx, ...(delayMs > 0 && { delayMs }) });
  sink.status(target.position, word, FLANK_COLOR);
  sink.log(`  ${t(flank === 'back' ? 'combatLog.log.fromBehind' : 'combatLog.log.fromSide', { word })}`, FLANK_COLOR);
}
