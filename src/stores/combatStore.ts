import { directionAngle, directionToward, facingTowardFoes, hasFacing, moveFacing } from '@/systems/combat/facing';
import { difficultyHp } from '@/systems/combat/runDifficulty';
import { createDeployment, DeploymentPlan, deploymentTargets, placeDeployment } from '@/systems/combat/deployment';
import { arenaHexes } from '@/systems/combat/arenaGeometry';
import { createStore as create } from 'zustand/vanilla';
import {
  arrangeOpening, brokenWrites, grantsExtraAction, intoNewPhase, mercyWrites, phaseRaises, ScriptWrite, scriptStateFor, stepVoids,
} from '@/systems/combat/bossRegistry';
import { damageUnit, resolveDeath } from '@/systems/combat/damageFunnel';
import { tickEffects, TickHost } from '@/systems/combat/effectTick';
import { creditFightStats, DOT_ENEMY_STATS_ID, DOT_PLAYER_STATS_ID, TickEvent, UnitFightStats } from '@/systems/combat/combatTypes';

export { DOT_ENEMY_STATS_ID, DOT_PLAYER_STATS_ID };
export type { TickEvent, UnitFightStats };
import { ArenaHazard, CombatUnit, SkillModeId, CombatPhase, EncounterWave, HexCoord, HexDirection, HeroSkill, ActiveEffect, LegionScriptState, LessonScriptState, KairenScriptState, ObjectiveSpec, PreparedAttack, PreparedReaction, ReactionEvent, WaveState, AfflictionType, AuraType, StatusEffectType, SummonTemplateId, VfxSpec, WildFormId, MantisTurn } from '@/models/types';
import { getHexLine, hexDistance, hexToPixel } from '@/utils/hexUtils';
import { withCooldownStarted, tickedCooldowns, refundedCooldowns } from '@/systems/combat/cooldowns';
import { reckoningBurst, isSealed, isSuspended, isCleansable, ambushCharges, amplifyIncomingSupport, healingReceived, burnStacks, isAffliction, STACKING_MAGNITUDE, freshPoison, mergePoison, poisonAtCap, chillUpgrades, chillMakesBrittle, burnCeiling, burnCeilingScale, burnSpill, freezeDurationBonus, rootDurationBonus } from '@/systems/combat/statusEffects';
import { calculateDamage, deathBurstDamage, poisonBurstDamage, resolveEffectMagnitude } from '@/systems/combat/damageCalc';
import { bleedDurationBonus } from '@/systems/combat/mantis';
import { deathBurstOf, findSummonTemplate } from '@/data/templates/summonTemplates';
import { companionFollowHex, summonStatsFor } from '@/systems/combat/summoning';
import { apexSpentAll, skillsForForm, wornForm } from '@/systems/combat/wildshape';
import { UnitForm, combatMaxHp } from '@/systems/combat/forms';
import { meditationPayout } from '@/systems/combat/meditate';
import { lanternBreathShares, moteAt, moteBuffs, syncBeaconLight } from '@/systems/combat/fireflyRules';
import { FLOAT_COLOR } from '@/data/display/floatColors';
import { MARKSMAN_YELLOW } from '@/data/display/marksmanColors';
import { pendingPhase, phaseAtTier, phaseHpCeiling, phasesFor } from '@/systems/combat/bossPhases';
import type { BossPhase } from '@/data/templates/aethelred';
import { initialBossScript } from '@/systems/combat/bossScript';
import { addAnswers, AnswerKind, AnswerTally, classifyBroken, moveIdOf } from '@/systems/combat/answerTally';
import { isImmuneTo, resolvePassives, hasPassive, passiveName, passiveRank, piercesImmunity } from '@/systems/combat/passives';
import { crumbleShred, rubbleRecoveryMultiplier, stonesAnswerMagic } from '@/systems/combat/passiveFormulas';
import { duelBars } from '@/systems/combat/duelRules';
import { SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { bladesCapOf, ownBlades, takesBlades, withBlades, withoutBlades } from '@/systems/combat/blades';
import { tombCollapse } from '@/data/skills/factionEliteSkills';
// Jadeveil: Kairen's Jade Shards
import { shardBurst } from '@/data/templates/kairen';
import { shardCleanses, taintOf } from '@/systems/combat/kairenRules';
import { duelRunOut, shatterHexes, TOMB_KIND } from '@/systems/combat/factionEliteKits';
import { WEB_KIND } from '@/systems/combat/yokaiKits';
import { CARAPACE_COLOR, RECKONING_COLOR } from '@/data/display/statusDisplay';
import { returnedBlow } from '@/systems/combat/beetle';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { unitById } from '@/systems/combat/unitLookup';
import { ignoresDisable } from '@/systems/combat/bossControl';
import { carriedOn, createObjective } from '@/systems/combat/objectives';
import { carriedFootprint, carrierOf } from '@/systems/combat/preparedAttacks';
import { mendIntent, strikeDetail, strikeIntent, strikeOutcome } from '@/systems/combat/soundIntents';
import { rollBonusTurn } from '@/systems/combat/turnTempo';
import { createWaveStates } from '@/systems/combat/waves';
import { tickReaction } from '@/systems/combat/reactions';
import { authorityChanges, canBeSeized, controlVerdict, fragmentsOf, reformedFraction, SEED_KIND, SOUL_FRAGMENT_KIND, soulRoute, soulSpots, stepFragment } from '@/systems/combat/eliteKits';
import { phaseName } from '@/data/templates/bossText';
import { templateName, unitName } from '@/data/templates/unitText';
import { t } from '@/i18n';
import { statusName } from '@/data/gameText';

/**
 * Recency counter for `ActiveEffect.appliedAt`.
 *
 * Module-level rather than store state: it only ever needs to increase, it is
 * never read back after a fight, and combat is not persisted — so there is
 * nothing to reset and nothing to serialise.
 */
let effectSequence = 0;
const nextEffectSequence = () => ++effectSequence;

/**
 * How a re-applied effect combines with the one already on the target.
 *
 * Two rules, and the split matters. Burn *adds* — stacking is its identity, and
 * it is what a detonate later spends. Everything else takes the stronger of the
 * two and the longer duration, and adopts the new source when it is at least as
 * strong: without that last part, `find`-by-type would pin a taunt to whoever
 * applied it first, so a second tank taunting the same enemy would silently do
 * nothing at all.
 */
function mergeEffect(existing: ActiveEffect, incoming: ActiveEffect, capScale = 1): ActiveEffect {
  const duration = Math.max(existing.duration, incoming.duration);
  if (incoming.type === AuraType.BlessedWeapon) {
    const stacks = Math.min(BALANCE.FURY_MAX_STACKS, (existing.stacks ?? 1) + 1);
    return { ...incoming, duration: -1, stacks, magnitude: incoming.magnitude * stacks };
  }

  // Burn and the Templar's weapon blessing add rather than refresh — the point
  // of both is that casting again is worth doing. `STACKING_MAGNITUDE` carries
  // the ceiling that keeps "cast it more" from being the answer to everything.
  const cap = STACKING_MAGNITUDE[incoming.type];
  if (cap !== undefined) {
    return {
      ...existing,
      // White Heat raises the ceiling of the pile its holder stacks (`capScale`)
      magnitude: Math.min(cap * capScale, existing.magnitude + incoming.magnitude),
      // Burn and the Troll's wound also count their applications — see `burnStacks`
      ...((incoming.type === AfflictionType.Burn || incoming.type === AfflictionType.Wound) && {
        stacks: burnStacks(existing) + burnStacks(incoming),
      }),
      duration,
      sourceUnitId: incoming.sourceUnitId ?? existing.sourceUnitId,
      appliedAt: incoming.appliedAt,
    };
  }

  // Crumble rides the control it was stamped on: a re-applied Stun or Root is
  // still that control, so the larger shred either carried survives the merge
  const crumble = Math.max(existing.crumble ?? 0, incoming.crumble ?? 0);
  // Dropped Guard rides a Taunt the same way
  const tauntedExposure = Math.max(existing.tauntedExposure ?? 0, incoming.tauntedExposure ?? 0);
  const kept = { ...(crumble > 0 && { crumble }), ...(tauntedExposure > 0 && { tauntedExposure }) };
  if (incoming.magnitude >= existing.magnitude) {
    // A sourceless re-application keeps the author it replaces, so a Bleed's
    // ticks still have someone to be credited to in the battle report
    return { ...incoming, duration, ...kept, sourceUnitId: incoming.sourceUnitId ?? existing.sourceUnitId };
  }
  return { ...existing, duration, ...kept };
}

/**
 * What a boss's phase change clears off the board: the writs, chains and brands
 * it laid. An old warning that kept running into a new kit would be an unexplained
 * hit, so the statuses that tracked it go with it.
 */
const PHASE_BOUND = new Set<StatusEffectType>([
  AfflictionType.Writ,
  AfflictionType.Chained,
  AfflictionType.Branded,
]);

const isPhaseBound = (unit: CombatUnit, bossId: string): boolean =>
  unit.activeEffects.some((e) => PHASE_BOUND.has(e.type) && e.sourceUnitId === bossId);

/** What a boss's entry asks of the store (`bossRegistry.ScriptWrite`), made in order. */
function applyScriptWrites(store: Pick<CombatState, 'patchBossScript' | 'removeEffect' | 'applyEffect'>, writes: ScriptWrite[]): void {
  for (const write of writes) {
    if (write.patch) store.patchBossScript(write.unitId, write.patch);
    if (write.removeEffect) store.removeEffect(write.unitId, write.removeEffect);
    if (write.setEffect) store.applyEffect(write.unitId, write.setEffect);
  }
}

/**
 * Statuses that are a *pool handed to* a unit rather than something done to it.
 *
 * Both are worth what the unit receiving them says they are worth, so they take
 * `incomingSupportBonus` — the one amplifier in the game read off the target
 * rather than the caster. Applied in `applyEffect` for the same reason the
 * poison overdose is decided there: a skill, a passive, a summon's arrival and a
 * lethal save are four ways one of these arrives, and a bonus that reached only
 * the first would be worth whatever the fight happened to consist of.
 */
const SUPPORT_POOLS = new Set<StatusEffectType>([AuraType.Barrier, AuraType.Reckoning, AuraType.HealOverTime]);

function withIncomingSupport(
  receiver: CombatUnit | undefined,
  effect: ActiveEffect,
): ActiveEffect {
  if (!receiver || !SUPPORT_POOLS.has(effect.type)) return effect;
  const magnitude = amplifyIncomingSupport(receiver, effect.magnitude);
  return magnitude === effect.magnitude ? effect : { ...effect, magnitude };
}

/** Whether the unit that applied an effect can push it past `DebuffImmunity`. */
function sourcePierces(units: CombatUnit[], sourceUnitId: string | undefined): boolean {
  if (!sourceUnitId) return false;
  const source = unitById(units, sourceUnitId);
  return !!source && piercesImmunity(source);
}

/**
 * Who catches Brimming Over's spill: the nearest enemy of `source` within reach of
 * the target that the Burn would actually land on and add to. Objectives and whatever
 * would refuse a Burn are passed over, so a spill is not lost on them with a taker
 * beside them.
 */
function burnSpillReceiver(units: CombatUnit[], target: CombatUnit, source: CombatUnit): CombatUnit | undefined {
  const reach = BALANCE.ARCANIST_ROW_TWO.BURN_OVERFLOW_REACH;
  const ceiling = burnCeiling(source);
  return units
    .filter((u) =>
      u.id !== target.id && u.currentHp > 0 && u.isPlayer === target.isPlayer && !u.objective && !u.untargetable
      && hexDistance(u.position, target.position) <= reach
      && !isImmuneTo(u, AfflictionType.Burn) && !isSealed(u) && !isSuspended(u)
      && (!u.activeEffects.some((e) => e.type === AuraType.DebuffImmunity) || piercesImmunity(source))
      && (u.activeEffects.find((e) => e.type === AfflictionType.Burn)?.magnitude ?? 0) < ceiling)
    .sort((a, b) =>
      hexDistance(a.position, target.position) - hexDistance(b.position, target.position)
      || a.currentHp - b.currentHp
      || a.id.localeCompare(b.id))[0];
}

/**
 * Turns units toward the enemy side, as they face at deployment: every unit with
 * a front, or only those named in `only`.
 */
function faceTheEnemy(units: CombatUnit[], only?: ReadonlySet<string>): CombatUnit[] {
  return units.map((u) => (hasFacing(u) && (!only || only.has(u.id)) ? faced(u, facingTowardFoes(u, units)) : u));
}

/**
 * A unit looking along `facing`, its model turned to match: the drawn turn is
 * always the rule's hex direction, never the exact aim between two of them, so
 * the back the player sees is the back the rule strikes (`directionAngle`).
 */
function faced(u: CombatUnit, facing: HexDirection): CombatUnit {
  return { ...u, facing, facingAngle: directionAngle(facing) };
}

/** Angle (radians) to face from hex `from` toward hex `to`. Returns null if same hex. */
function computeFacingAngle(from: import('@/models/types').HexCoord, to: import('@/models/types').HexCoord): number | null {
  const fp = hexToPixel(from);
  const tp = hexToPixel(to);
  const dx = tp.x - fp.x;
  const dz = tp.y - fp.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return null;
  return Math.atan2(dx, dz);
}

/**
 * A soul's picture: a wisp of light between two hexes, held back by `delayMs` so
 * the fragments of one break or one march are seen one after another rather than
 * as a single flash. The Revenant's whole passive used to resolve inside one frame.
 */
function soulVfx(
  kind: 'bolt' | 'nova' | 'bloom',
  ownerId: string,
  from: HexCoord,
  to: HexCoord,
  delayMs = 0,
): VfxSpec {
  return {
    kind, delivery: 'spell', casterId: ownerId, casterPos: from, targetCoord: to,
    hitUnitIds: [], hitCoords: [to], color: '#c8f0ff', durationScale: 1.6, delayMs,
  };
}

/** What applying a status did, when it did something beyond landing as asked. */
export interface EffectOutcome {
  /**
   * The status that ended up on the unit, which is not always the one asked for.
   *
   * A Chill landing on an already-chilled unit arrives as a **Freeze**, and for
   * as long as that substitution was invisible from outside `applyEffect` the
   * player was told about neither: `announceStatus` asked whether the *Chill* it
   * requested was on the target, found it gone, and said nothing — so the one
   * status the Hydromancer's whole loop is built on never once floated.
   */
  landed: StatusEffectType;
  /** HP taken by a poison overdose — see `applyEffect`. Zero when none fired. */
  burst: number;
  crit: boolean;
  /** The enemy Brimming Over's spill landed on, for whoever has a screen to say so. */
  spilledTo?: string;
}

interface CombatState {
  units: CombatUnit[];
  turnOrder: string[];
  /**
   * The unit whose turn it is, by id rather than by index into `turnOrder`.
   *
   * An index breaks as soon as anything is inserted into `turnOrder` mid-combat
   * (summons): splicing a unit in ahead of the active one shifts every later
   * index, silently handing the turn to a different unit. An id survives any
   * reordering.
   */
  currentUnitId: string | null;
  phase: CombatPhase;
  selectedSkill: HeroSkill | null;
  /**
   * The Mercy / Wrath choice made for `selectedSkill`, when the skill offers one.
   *
   * Cleared whenever the selected skill changes, so a stance chosen for one press
   * can never leak into the next. It is only ever set together with the skill it
   * belongs to, by the choice panel — cancelling the panel selects nothing and
   * leaves the turn exactly as it was.
   */
  selectedMode: SkillModeId | null;
  highlightedHexes: HexCoord[];
  /**
   * True from the moment an action resolves until the turn is handed on — the
   * pause in which its picture plays and the camera stays put. The HUD hides
   * and the board refuses taps while it is set. Here rather than in the scene
   * so anything that rearranges a turn from outside (the capture harness) can
   * cancel a pending hand-over by clearing it, and so `nextTurn` ends it.
   */
  handingOver: boolean;
  arenaRadius: number;
  /**
   * Damage and healing tallies by unit id for the battle report, plus the two
   * synthetic DoT rows above. Written by `damageUnit`, `healUnit` and the DoT
   * branch of `tickEffectsOnUnit`; cleared with the rest of a fight.
   */
  fightStats: Record<string, UnitFightStats>;
  /**
   * How each warned move was answered this fight (`systems/combat/answerTally`): per move, how many
   * of the heroes it threatened stepped off, took it, blocked it, stood in it unharmed or saw it
   * broken. Counted where a warning resolves or is broken; cleared with the rest of a fight.
   */
  answerTally: AnswerTally;
  /**
   * Delayed attacks that have been announced and not yet landed. Written only
   * through `systems/combat/preparedAttacks`, which owns what a window is.
   */
  preparedAttacks: PreparedAttack[];
  /** Ground that remembers: rubble, fire lines. Read by forced movement. */
  hazards: ArenaHazard[];
  /**
   * Counts every hand-over, including a bonus turn that leaves `currentUnitId`
   * unchanged. Anything that must run once per turn keys on this rather than on
   * the id, or a unit's bonus turn would never start.
   */
  turnSerial: number;
  /**
   * Speed-granted bonus turn — see `systems/combat/turnTempo`.
   *
   * `pending` is rolled when a regular turn begins and is what the queue shows
   * ahead of time: that unit acts again straight after this turn. `active` is
   * true while the bonus turn itself is being taken, so it cannot be rolled for
   * again and `beginTurn` knows to skip upkeep.
   */
  bonusTurn: { pending: string | null; active: boolean; howl?: boolean; mantis?: MantisTurn['cause'] };
  /**
   * The Troll Chieftain's Fury action: true while the turn being taken is the
   * second action his Fury grants a turn. It is granted *after* the turn it
   * follows — a regular turn and a speed bonus turn each get one, so the four
   * actions a pair can hold — and never rolled, never ticked and never
   * advancing the six-turn cycle. `beginTurn` takes the short road for it, as
   * for a bonus turn.
   */
  furyExtra: { active: boolean };
  /** Announced reinforcements — see `systems/combat/waves`. */
  waves: WaveState[];
  /** What a wave's bodies are built with: the encounter's own scaling. */
  waveScale: { partyLevel: number; powerScale: number; spared?: boolean; contentLevel?: number };
  /** Prepared Reactions — see `systems/combat/reactions`. */
  reactions: PreparedReaction[];
  /** Things that happened which a Reaction may be waiting for, oldest first. */
  reactionEvents: ReactionEvent[];
  /**
   * A Reaction's response is resolving: damage it deals is recorded as
   * `byReaction`, which a watch (Covering Fire) never answers.
   */
  answeringReaction: boolean;

  deployment: DeploymentPlan | null;
  deploymentHero: string | null;
  selectDeploymentHero: (id: string) => void;
  placeDeploymentHero: (hex: HexCoord) => boolean;
  resetDeployment: () => void;
  confirmDeployment: () => void;
  /**
   * `enemiesFirst` opens the fight on the fastest enemy rather than the fastest unit: a party that tried to
   * flee and failed (Escape). The speed order is unchanged, so every faster hero acts once the round comes round.
   */
  initCombat: (playerUnits: CombatUnit[], enemyUnits: CombatUnit[], deploymentLevel?: number, enemiesFirst?: boolean) => void;
  setPhase: (phase: CombatPhase) => void;
  setWaves: (waves: readonly EncounterWave[], scale?: CombatState['waveScale']) => void;
  patchWave: (id: string, patch: Partial<Pick<WaveState, 'status' | 'pending'>>) => void;
  /** Stops a unit's pending bonus turn: it lost its turn to a disable. */
  cancelBonusTurn: (unitId: string) => void;
  /** Stands a prepared Reaction; the owner keeps at most `limit` (Second Watch: two), the oldest giving way. */
  addReaction: (reaction: PreparedReaction, limit?: number) => void;
  removeReaction: (id: string) => void;
  /** Counts the owner's reaction down at a regular turn start; returns what expired. */
  tickReactionsFor: (ownerId: string) => PreparedReaction[];
  /** Takes every recorded reaction event, oldest first. */
  drainReactionEvents: () => ReactionEvent[];
  addPreparedAttack: (attack: PreparedAttack) => void;
  /**
   * Takes a warning off the board. `'broken'` is the party's doing (an interrupt, the bound objective
   * destroyed, a chain cleansed): everyone it threatened is counted as having seen it broken.
   */
  removePreparedAttack: (id: string, how?: 'broken') => void;
  trimPreparedAttack: (id: string, hexes: readonly HexCoord[]) => void;
  /** Counts how the heroes a warning threatened answered it (`answerTally`). */
  noteAnswers: (moveId: string, answers: readonly { kind: AnswerKind }[]) => void;
  /** Rewrites part of a pending warning in place — a widened blast, a chain following its heroes. */
  updatePreparedAttack: (id: string, patch: Partial<PreparedAttack>) => void;
  /** Writes part of a scripted boss's own bookkeeping. */
  patchBossScript: (unitId: string, patch: Partial<LegionScriptState> & Partial<LessonScriptState> & Partial<KairenScriptState>) => void;
  /**
   * Takes health from a unit that is *paying* it — a Writ's price, the black
   * sun's cost. Ignores Barrier and armour, because nothing is hitting them,
   * and never kills: it stops at 1. Returns what was paid.
   */
  payHealth: (unitId: string, amount: number) => number;
  /**
   * A hero was healed or shielded: Aethelred's Tithe on Mercy. Charges his orb
   * once between two of his turns, in phase 3 only.
   */
  noteMercy: (unitId: string) => void;
  /** Cancels every preparation a caster has pending; returns what was cleared. */
  clearPreparedFor: (casterId: string) => PreparedAttack[];
  addHazard: (hazard: ArenaHazard) => void;
  /** Takes an objective off the board without a kill: expired, or spent by its attack. */
  removeObjective: (unitId: string) => void;
  /**
   * Hands a carried objective (the Furnace Heart) to another hero: it moves onto their hex and after them
   * in `units`, the warning it rides on is re-centred on them, and its Seared goes with it, its count of
   * turns kept starting again. The carrier's own move is `moveUnit`'s.
   */
  carryObjective: (objectiveId: string, carrierId: string) => void;
  /** Rewrites part of an objective's spec — the warning an anchor is bound to, its backlash. */
  patchObjective: (unitId: string, patch: Partial<ObjectiveSpec>) => void;
  /** Counts down the owner's timed objectives; returns what expired. */
  tickObjectives: (ownerId: string) => TickEvent[];
  removeHazard: (id: string) => void;
  /**
   * Once-per-turn allowances a passive has used since the current turn began,
   * keyed to `turnSerial` so a new turn (a bonus turn included) starts empty.
   */
  spentThisTurn: { serial: number; keys: string[] };
  spendThisTurn: (key: string) => void;
  /**
   * Burning ground, on the turn of whoever stands on it or laid it: an enemy of
   * the owner beginning its turn on a hex that ignites catches the Burn it
   * carries, and the owner's own turn counts the ground down. Ground whose owner
   * has died goes out. Returns the ignitions for the driver to play.
   */
  tickHazards: (unitId: string) => TickEvent[];
  /**
   * Passes one stack of a dead Burning enemy's fire on (the `spark` passive).
   * Called from every path an enemy can die down, like the death burst. The
   * dead unit's Burn is spent by the call, which is what makes calling it twice
   * harmless. `knownBurn` covers a Burn the final tick already dropped.
   */
  spreadSpark: (unitId: string, knownBurn?: ActiveEffect) => TickEvent[];
  /**
   * Venom Transfer: passes one dose of a dead enemy's Poison to the nearest
   * unpoisoned enemy near it, when the pile's owner (the unit that laid its
   * latest dose) holds the node and has not passed one on since its last regular
   * turn began. Called from every death path, like `spreadSpark`; the corpse's
   * Poison is spent by the call, so a second call finds nothing. `knownPoison`
   * covers a pile the final tick already dropped.
   */
  spreadVenom: (unitId: string, knownPoison?: ActiveEffect) => TickEvent[];
  /**
   * Next Quarry: a dead enemy's Mark passes on when its owner holds the node. The
   * passive picks the receiver and the turns. The corpse's Mark is spent by the
   * call, so a second call finds nothing, and `knownMark` covers a Mark the final
   * tick already dropped.
   */
  spreadMark: (unitId: string, knownMark?: ActiveEffect) => TickEvent[];
  /**
   * Shadow Echo's post-action window: the action is spent, no Move is left, and
   * the turn waits for a return to the echo or End Turn (`CombatUnit.echoHold`).
   */
  holdForEcho: (unitId: string) => void;
  selectSkill: (skill: HeroSkill | null, mode?: SkillModeId) => void;
  setHighlights: (hexes: HexCoord[]) => void;
  /**
   * Moves a unit. Returns what the ground it crossed did to it — the fire of a
   * Cinder Rift (`ArenaHazard.crossDamage`) — so the caller with a sink can put
   * the numbers on the board. Callers with nothing to show may ignore it.
   */
  /**
   * `via` is the hex a `swoop` passes over on the way (the Hawk's Dive: its victim).
   * `path` is an ordinary move's route from `findMovePath`, both ends included: it is
   * what the walk is drawn along and what its crossings are read from. Absent, the
   * straight hex line (a shove, a dash).
   */
  moveUnit: (unitId: string, to: HexCoord, mode?: NonNullable<CombatUnit['movement']>['mode'], voluntary?: boolean, via?: HexCoord, path?: HexCoord[]) => TickEvent[];
  setFacing: (unitId: string, toward: HexCoord) => void;
  /** Untargetable until the unit's own next turn — see `turnStart`. */
  setUntargetable: (unitId: string, value: boolean) => void;
  /** A companion's Magic, re-read from its owner's at each echo (`skillResolution`). */
  setUnitMagic: (unitId: string, magic: number) => void;
  /**
   * Counts a companion's lifetime down on its owner's regular turn. `stays` until
   * the counter would go below zero, so a lifetime of 3 stands through the owner's
   * next three regular turns and is gone as the fourth begins.
   */
  tickCompanionLifetime: (unitId: string) => 'alive' | 'expired';
  /**
   * Returns what actually happened, so callers can report an absorb distinctly
   * from a hit. `phaseEntered` is the name of a boss phase this blow triggered,
   * for the combat log — absent on every other hit, which is almost all of them.
   */
  damageUnit: (
    unitId: string,
    amount: number,
    /**
     * Who landed the blow, when anybody did.
     *
     * Consulted by lethal-save passives that answer the attacker — Cryostasis
     * freezes them — and credited with the damage in `fightStats`. Optional
     * because some damage has no author: a poison tick, a Doom.
     */
    attackerId?: string,
    /** `bypassProtection`: an objective's backlash, which the objectives' own protection does not soak. */
    options?: { bypassProtection?: boolean; difficultyApplied?: boolean; sourceUnitId?: string },
  ) => {
    hpLost: number;
    absorbed: number;
    phaseEntered?: string;
    /**
     * Bonus damage this blow added because the target was frozen, when it was.
     *
     * The ice breaking is a distinct event from the strike that broke it, so it
     * is reported rather than folded silently into `hpLost` — the same argument
     * `phaseEntered` makes. `combatEvents.applyOnHitStatuses` is what announces
     * it, so both execution paths say it without either being asked to.
     */
    shatter?: number;
    /** What a Carapace Bastion's owner took of this blow in the struck ally's place (`DamageResult.shared`). */
    shared?: number;
    /** The Beetle that took `shared` (`DamageResult.sharedBy`). */
    sharedBy?: string;
    /** What took the blow, for the ear (`DamageResult.shieldedBy`). */
    shieldedBy?: 'magic' | 'shell';
    /** This blow emptied a standing Barrier (`DamageResult.shieldBroke`). */
    shieldBroke?: true;
    /**
     * Present when the blow killed something that goes off when it dies.
     *
     * Handed back rather than played here, for the same reason a tick's events
     * are: this store has no screen. Both resolvers put them on the board.
     */
    deathEvents?: TickEvent[];
  };
  /**
   * `healerId` is credited with the HP actually restored in `fightStats`.
   *
   * Returns that same number, which is what a caller should put on the board:
   * once a phase ceiling or the receiver's own `incomingSupportBonus` is in
   * play, what was cast and what landed are two different figures, and the
   * float is the only place the player ever sees either.
   */
  healUnit: (unitId: string, amount: number, healerId?: string) => number;
  markMoved: (unitId: string) => void;
  markActed: (unitId: string) => void;
  /**
   * Mark and Move: the action is spent, and the unit may still move this turn,
   * at most `cap` hexes (`CombatUnit.repositionCap`).
   */
  grantReposition: (unitId: string, cap: number) => void;
  /**
   * Hands a unit a fresh turn's worth of actions.
   *
   * `nextTurn` also clears these, but that clears them on the unit it is
   * advancing *to*, at the moment the previous turn ends — so any write that
   * rebuilds `units` from a snapshot taken before it lands would restore them,
   * and the unit reaches its own turn with Move and every skill already spent.
   * That is a soft-lock: the action bar renders nothing and only End Turn is
   * left. Establishing the flags at the start of the turn that uses them makes
   * the ordering irrelevant.
   */
  beginTurnFlags: (unitId: string) => void;
  /**
   * Becomes something else: new stat multipliers, new kit. The shared half of
   * Wildshape and boss phases — see `systems/forms.ts`.
   */
  setForm: (unitId: string, form: UnitForm | null) => void;
  /**
   * Advances a phased boss if its HP has fallen past a threshold, returning the
   * phase name for the log. Called by `damageUnit`; exposed so tests can drive
   * it directly.
   */
  enterPendingPhase: (unitId: string, forced?: { index: number; phase: BossPhase }) => string | undefined;
  /** Tears a phased boss out of its current phase into the next, whatever its health: the Heart's last anchor. */
  releaseBossPhase: (unitId: string) => string | undefined;
  /** Wildshape: `null` returns the unit to its own shape. */
  setWildForm: (unitId: string, form: WildFormId | null) => void;
  startCooldown: (unitId: string, skill: HeroSkill) => void;
  tickCooldowns: (unitId: string) => void;
  /** Brings every running cooldown back by `turns` — the Vengeance passive. */
  refundCooldown: (unitId: string, turns: number, onlyIds?: readonly string[]) => void;
  /**
   * Blood Howl: a direct critical hit by a Wolf under it queues one extra turn, if the
   * allowance between its regular turns (`BLOOD_HOWL_TURN_CAP`, taken and queued
   * together) has room. Returns whether one was queued. `nextTurn` grants them.
   */
  queueHowlTurn: (unitId: string) => boolean;
  /** Records an Apex spell as used for the rest of this Apex shape. */
  spendApexSpell: (unitId: string, skillId: string) => void;
  /** Spends one charge (`stacks`) of a charged mark — Hunter's Mark, Crowned Prey — removing it at none. */
  spendMarkCharge: (unitId: string, type: StatusEffectType) => void;
  spendMana: (unitId: string, amount: number) => void;
  restoreMana: (unitId: string, amount: number) => void;
  /**
   * Puts a status on a unit, and reports back only when applying it *was* the
   * event rather than a status arriving as asked.
   *
   * Two cases, and the second is why the report carries a type at all: a fourth
   * dose of poison is a detonation rather than a stack, and a Chill on an
   * already-chilled unit is a Freeze. The caller owns the floating number and
   * the log line for both.
   */
  applyEffect: (unitId: string, effect: ActiveEffect) => EffectOutcome | undefined;
  removeEffect: (unitId: string, type: StatusEffectType) => void;
  removeAllAfflictions: (unitId: string) => void;
  tickEffectsOnUnit: (unitId: string) => TickEvent[];
  /**
   * Everything dying means, for a unit whose HP is already zero (`damageFunnel.resolveDeath`).
   * `damageUnit` and the effect tick call it themselves; this is for the death that
   * wrote its own HP — a summon's clock running out. A no-op on a unit still standing.
   */
  resolveDeath: (unitId: string, ctx?: { attackerId?: string; knownBurn?: ActiveEffect; knownPoison?: ActiveEffect; knownMark?: ActiveEffect }) => TickEvent[];
  /**
   * Spends an expiring Martyr seal on everything around its carrier.
   *
   * Separate from the tick that notices it, because the tick writes exactly one
   * unit and this writes several. Called from there rather than by any scene.
   */
  detonateMartyrSeal: (
    unitId: string,
    seal: ActiveEffect,
  ) => TickEvent[];
  /**
   * Sets off a Reckoning that broke or ran out: a shockwave on every enemy around its
   * owner, sized from the owner's Attack and what the barrier stored. Called by
   * `damageUnit` and the effect tick once their own write has landed; the barrier is
   * already gone by then, so nothing the shockwave causes can feed it.
   */
  releaseReckoning: (unitId: string, spent: ActiveEffect) => TickEvent[];
  /**
   * Sets off a dead summon's parting blast, at most once.
   *
   * Called from every path a unit can die down — a blow, a damage-over-time
   * tick, a summon's decay, a timed expiry — because "on death from any cause"
   * has to mean that or it becomes a rule with four exceptions. The
   * `deathBurstSpent` latch is what makes calling it four times safe, including
   * when one burst kills another burster and re-enters this action.
   */
  detonateDeathBurst: (unitId: string) => TickEvent[];
  /**
   * Rebuilds a unit as a different summon template, in place.
   *
   * Keeps the id, the hex, the facing and `summonedBy`; replaces everything
   * that describes *what* it is. Keeping the id keeps its `turnOrder` entry
   * valid — `currentUnitId` is tracked by id precisely so this is possible —
   * and `getModelKey` reads `templateId`, so the silhouette swaps for free.
   */
  transformUnit: (
    unitId: string, templateId: SummonTemplateId, casterLevel: number, strength?: number,
  ) => void;
  /**
   * Bites everything standing next to a Bladestorm's carrier.
   *
   * Same shape and same reason as the Martyr detonation: noticed by the tick,
   * resolved outside it, because the tick writes exactly one unit.
   */
  sweepBladeStorm: (
    unitId: string,
    storm: ActiveEffect,
  ) => TickEvent[];
  /**
   * Meditate's payout at the start of the Monk's next turn: the heal and the
   * turn's Attack and Magic (`meditate.meditationPayout`). Called by the tick
   * that retires the Meditation aura, once its own write has landed.
   */
  payMeditation: (unitId: string) => TickEvent[];
  /**
   * The Skirmisher's Embedded Blades: `count` more of `ownerId`'s blades in the
   * victim, capped, in that owner's own entry. Returns the count now held (0 when
   * the victim takes none: dead, Invulnerable, sealed or warded). See `blades`.
   */
  embedBlades: (victimId: string, ownerId: string, count: number) => number;
  /** Pulls every one of `ownerId`'s blades out of the victim; returns how many came out. */
  extractBlades: (victimId: string, ownerId: string) => number;
  /**
   * The Revenant's first death, as a break: the body lies inert at 1 health and its
   * soul fragments appear at separated graves (`eliteKits.soulSpots`). Called by
   * `damageUnit` the moment the lethal save fires, and by nothing else.
   */
  breakSoul: (unitId: string) => TickEvent[];
  /**
   * Settles a broken Revenant once every fragment is accounted for: with none home
   * it dies for good, with some it reforms with health in proportion. Called when
   * a fragment is destroyed and when one arrives, and a no-op while any is loose.
   */
  settleSoul: (ownerId: string) => TickEvent[];
  /** The Revenant's own turn beginning: each fragment still loose crosses its next hexes. */
  tickSoulFragments: (ownerId: string) => TickEvent[];
  /**
   * The Rime Jarl names a hero: the hero carries the pending challenge (the circle that
   * would close, fixed at the Jarl's hex now) and a Challenged badge until they answer.
   */
  issueChallenge: (jarlId: string, heroId: string) => void;
  /**
   * The hero's answer. Accept closes the circle round both (each carries a `DuelBond`, the
   * Jarl carries the damage bonus); refuse wraps only the Jarl in a Barrier. Either way
   * the challenge is spent. Returns what to tell the party.
   */
  answerChallenge: (heroId: string, accept: boolean) => TickEvent[];
  /**
   * One regular turn of a duelist has ended: counted, and when both have ended their
   * share the circle dissolves and the Jarl kneels.
   */
  noteDuelTurn: (unitId: string) => TickEvent[];
  /**
   * Dissolves what a fall has broken and drops a challenge that no longer stands: called
   * whenever a unit dies, and a no-op while nobody is bound. A duel ended by a death has no
   * punishment and no reward.
   */
  settleDuels: () => TickEvent[];
  /** Drops a pending challenge. */
  dropChallenge: (heroId: string) => void;
  /**
   * Seals a hero in a tomb: the block goes to the *front* of the roster so everything that
   * finds a unit by its hex finds the block and not the hero it stands over.
   */
  sealInTomb: (tomb: CombatUnit, heroId: string) => void;
  /** Takes a tomb away and frees the hero in it, with nothing struck. */
  releaseTomb: (tombId: string) => void;
  /**
   * A tomb broken from outside: the hero is freed and the block shatters outward into every
   * enemy of the party beside it. Called by `damageUnit` when the block falls.
   */
  breakTomb: (tombId: string, attackerId?: string) => TickEvent[];
  /**
   * Jadeveil: Kairen — a Jade Shard broken: every hero beside it loses all Taint, and the
   * one who broke it takes its burst (`kairenRules.shardCleanses`). Called by `damageUnit`.
   */
  breakShard: (shardId: string, attackerId?: string) => TickEvent[];
  /**
   * Wraps a hero in one of the Jorogumo's webs: the web goes to the front of the roster, as
   * a tomb does, and the hero is held (`AuraType.Webbed`).
   */
  spinWeb: (web: CombatUnit, heroId: string) => void;
  /**
   * A web cut, or taken away by the bite or by its owner falling: the hero is freed. `remove`
   * also takes the web off the board (a web that was destroyed is already gone).
   */
  freeFromWeb: (webId: string, remove?: boolean) => TickEvent[];
  /**
   * Lays the Brigand Captain's word on every ally of a living Captain and lifts it from
   * everyone it no longer belongs to. Idempotent, and the one place that decides who wears
   * it: called when a fight begins, when units arrive, and the instant a Captain falls, so
   * the aura never outlives him and never needs a second rule to find a latecomer. Health
   * keeps its share of the maximum as the maximum moves.
   */
  syncAuthority: () => void;
  /**
   * Lays and lifts the Lantern Beacon's light (`fireflyRules.syncBeaconLight`) to
   * match where everyone stands now. Called after every move, arrival and death;
   * a no-op on a board with no Beacon.
   */
  syncBeacons: () => void;
  /**
   * What a fallen unit leaves behind that belonged to it: the warnings it had open (a
   * marsh, a seed's claim, an eruption) and the briar seed it planted. A dead
   * caster lands nothing, so its footprint must not stay lit on the board and its seed must
   * not stand waiting on a turn that will never come. Called from every path a unit dies down.
   */
  retireOwned: (unitId: string) => void;
  /**
   * Rubble Recovery: `ownerId`'s Barrier on `recipientId` was just broken by an
   * enemy. Heals the recipient for the rung's share of the owner's Magic when the
   * owner holds the node, both still stand, and the owner has not healed this
   * recipient since its own last regular turn began. Returns the event to show.
   */
  recoverFromRubble: (recipientId: string, ownerId: string) => TickEvent | undefined;
  /**
   * Stone's Answer: `ownerId`'s Barrier on `recipientId` was just broken by
   * `breakerId`. The breaker takes a certain physical blow built from the owner's
   * Magic and is Rooted, once per recipient per owner's turn. A boss refuses the Root
   * in `applyEffect` and keeps the damage.
   */
  answerFromStone: (recipientId: string, ownerId: string, breakerId: string) => TickEvent[];
  /**
   * A full Carapace has just soaked a blow on `unitId` (`damageFunnel`). Says so,
   * and with Hardened Shell gives every ally beside the carrier a Barrier worth
   * the rung's share of its Physical + Magic Defense, read now. Returns the
   * events to show.
   */
  carapaceSoaked: (unitId: string, attackerId?: string) => TickEvent[];
  /**
   * Spends one of a Vanish's banked actions, dropping the aura when the last
   * one goes. Returns whether there was one to spend.
   */
  spendAmbushCharge: (unitId: string) => boolean;
  addUnits: (units: CombatUnit[]) => void;
  tickSummonLifetime: (unitId: string) => 'alive' | 'expired';
  nextTurn: () => void;
  getCurrentUnit: () => CombatUnit | undefined;
  getUnitAt: (coord: HexCoord) => CombatUnit | undefined;
  getAliveUnits: (isPlayer?: boolean) => CombatUnit[];
  reset: () => void;
}

/**
 * The fire a move takes from ground that burns what crosses it.
 *
 * The path is the route the move walked (`findMovePath`, handed in by an
 * ordinary move), or else the straight line from where the unit stood to where
 * it ended — a shove and a dash travel a straight line, and the warning's
 * landing hexes are the hexes this reads. Each patch of ground costs a body once
 * per move however many of its hexes the route touches, and only the owner's
 * enemies are burned. Defined beside the store because it writes through it.
 */
function settleCrossings(before: CombatUnit, to: HexCoord, route?: HexCoord[]): TickEvent[] {
  const state = useCombatStore.getState();
  if (before.currentHp <= 0 || before.objective) return [];
  const crossed = state.hazards.filter((h) => h.crossDamage !== undefined && h.crossDamage > 0);
  if (crossed.length === 0) return [];
  const path = (route ?? getHexLine(before.position, to)).slice(1);
  const events: TickEvent[] = [];
  for (const hazard of crossed) {
    const owner = hazard.ownerId ? unitById(state.units, hazard.ownerId) : undefined;
    if (!owner || owner.isPlayer === before.isPlayer) continue;
    if (!path.some((hex) => hazard.hexes.some((h) => h.q === hex.q && h.r === hex.r))) continue;
    const live = unitById(useCombatStore.getState().units, before.id);
    if (!live || live.currentHp <= 0) break;
    const result = useCombatStore.getState().damageUnit(before.id, hazard.crossDamage ?? 0, owner.id);
    events.push({ text: `-${result.hpLost}`, color: '#ff7a2a', unitId: before.id });
    if (result.deathEvents) events.push(...result.deathEvents);
  }
  return events;
}

/**
 * A Firefly Mote under the hex a move ended on (`ArenaHazard.mote`): whoever
 * arrives puts it out, by any route — a step, a dash or blink landing, a shove —
 * because every one of them comes through `moveUnit`. An ally of the mote's
 * owner is healed the amount fixed when it was laid and gains its Attack and
 * Critical Chance; an enemy gains nothing. Only the landing hex counts: a mote
 * is stood on, not crossed. Defined beside the store because it writes through it.
 */
function settleMotes(unitId: string, to: HexCoord): TickEvent[] {
  const state = useCombatStore.getState();
  const unit = unitById(state.units, unitId);
  if (!unit || unit.currentHp <= 0 || unit.objective) return [];
  const mote = moteAt(state.hazards, to);
  if (!mote?.mote) return [];
  state.removeHazard(mote.id);
  const owner = mote.ownerId ? unitById(state.units, mote.ownerId) : undefined;
  if (!owner || owner.isPlayer !== unit.isPlayer) {
    return [{ text: t('combatLog.tick.putsOutMote'), color: '#b08a50', unitId }];
  }
  const restored = state.healUnit(unitId, mote.mote.heal, owner.id);
  for (const buff of moteBuffs(owner.id)) state.applyEffect(unitId, buff);
  return [{
    text: t('combatLog.float.moteHeal', { amount: restored }), log: t('combatLog.tick.moteHeal', { amount: restored }), color: FLOAT_COLOR.heal, unitId,
    ...(restored > 0 && { sound: mendIntent(unit) }),
  }];
}

export const useCombatStore = create<CombatState>((set, get) => ({
  units: [],
  turnOrder: [],
  currentUnitId: null,
  phase: CombatPhase.PlayerSelect,
  selectedSkill: null,
  selectedMode: null,
  highlightedHexes: [],
  handingOver: false,
  arenaRadius: 4,
  fightStats: {},
  answerTally: {},
  preparedAttacks: [],
  hazards: [],
  turnSerial: 0,
  spentThisTurn: { serial: 0, keys: [] },
  bonusTurn: { pending: null, active: false },
  furyExtra: { active: false },
  waves: [],
  waveScale: { partyLevel: 1, powerScale: 1 },
  reactions: [],
  reactionEvents: [],
  answeringReaction: false,

  deployment: null,
  deploymentHero: null,
  selectDeploymentHero: (id) => {
    const s = get();
    if (!s.deployment || !s.units.some(u => u.id === id && u.isPlayer && u.currentHp > 0)) return;
    set({ deploymentHero: id, highlightedHexes: deploymentTargets(s.deployment, s.units, id) });
  },
  placeDeploymentHero: (hex) => {
    const s = get();
    if (!s.deployment || !s.deploymentHero) return false;
    const placed = placeDeployment(s.deployment, s.units, s.deploymentHero, hex);
    if (!placed) return false;
    // A placed hero faces the enemy from where it now stands, as it will when the fight begins
    const units = faceTheEnemy(placed, new Set([s.deploymentHero]));
    set({ units, highlightedHexes: deploymentTargets(s.deployment, units, s.deploymentHero) });
    return true;
  },
  resetDeployment: () => {
    const s = get();
    if (!s.deployment) return;
    const plan = s.deployment;
    const units = faceTheEnemy(s.units.map(u => plan.starts[u.id] ? { ...u, position: { ...plan.starts[u.id] } } : u));
    set({ units, highlightedHexes: s.deploymentHero ? deploymentTargets(plan, units, s.deploymentHero) : [] });
  },
  // The heroes stand where they were placed now, so they face the enemy from there
  confirmDeployment: () => set((s) => ({
    deployment: null, deploymentHero: null, highlightedHexes: [], units: faceTheEnemy(s.units),
  })),
  initCombat: (playerUnits, enemyUnits, deploymentLevel = 0, enemiesFirst = false) => {
    // A script may place its own units and put things on the board from the first turn
    // (the Heart of Winter fights from the middle, chained to three anchors)
    const opening = arrangeOpening(enemyUnits);
    enemyUnits = opening.enemies;
    const anchors = opening.extra;
    // `cooldowns: {}` is deliberate: units are rebuilt from templates each
    // fight, but a caller reusing a unit object would otherwise carry a
    // half-spent cooldown into a fresh battle.
    const allUnits = [...playerUnits, ...enemyUnits].map((u) => ({
      ...u,
      activeEffects: u.activeEffects ?? [],
      cooldowns: {},
      // A scripted boss starts its fight with a clean sheet
      ...(scriptStateFor(u) && { bossScript: scriptStateFor(u) }),
    }));
    // The Captain's word is +50% speed for his allies, so it counts in the opening order too
    const { lay: laid } = authorityChanges(allUnits);
    const openingSpeed = (u: CombatUnit) =>
      u.stats.speed * (laid.some((l) => l.id === u.id) ? 1 + BALANCE.AUTHORITY_BONUS : 1);
    const sorted = [...allUnits].sort((a, b) => openingSpeed(b) - openingSpeed(a));
    const first = enemiesFirst ? sorted.find((u) => !u.isPlayer) ?? sorted[0] : sorted[0];
    set({
      deployment: deploymentLevel > 0 ? createDeployment(deploymentLevel, playerUnits, enemyUnits, arenaHexes()) : null,
      deploymentHero: null,
      units: faceTheEnemy([...allUnits, ...anchors]),
      turnOrder: sorted.map((u) => u.id),
      currentUnitId: first?.id ?? null,
      phase: first?.isPlayer ? CombatPhase.PlayerSelect : CombatPhase.EnemyTurn,
      selectedSkill: null,
      selectedMode: null,
      highlightedHexes: [],
      handingOver: false,
      fightStats: {},
      answerTally: {},
      preparedAttacks: [],
      hazards: [],
      turnSerial: 0,
      spentThisTurn: { serial: 0, keys: [] },
      bonusTurn: { pending: first && rollBonusTurn(first, allUnits) ? first.id : null, active: false },
      furyExtra: { active: false },
      waves: [],
      waveScale: { partyLevel: 1, powerScale: 1 },
      reactions: [],
      reactionEvents: [],
    });
    // A Brigand Captain's allies fight under his word from the first turn
    get().syncAuthority();
  },

  // The fight is over, one way or the other: a hero the Mage was holding goes home to its own
  // side before anything reads the roster for rewards or penalties
  setPhase: (phase) =>
    set((s) =>
      phase === CombatPhase.Victory || phase === CombatPhase.Defeat
        ? {
            phase,
            units: s.units.map((u) => (u.seized ? { ...u, isPlayer: true, seized: false } : u)),
          }
        : { phase },
    ),
  setWaves: (waves, scale) =>
    set((s) => ({ waves: createWaveStates(waves), waveScale: scale ?? s.waveScale })),
  patchWave: (id, patch) =>
    set((s) => ({ waves: s.waves.map((w) => (w.wave.id === id ? { ...w, ...patch } : w)) })),
  queueHowlTurn: (unitId) => {
    const unit = unitById(get().units, unitId);
    if (!unit || unit.currentHp <= 0) return false;
    const queued = unit.howlQueued ?? 0;
    if (queued + (unit.howlGranted ?? 0) >= BALANCE.BLOOD_HOWL_TURN_CAP) return false;
    set((s) => ({ units: s.units.map((u) => (u.id === unitId ? { ...u, howlQueued: queued + 1 } : u)) }));
    return true;
  },
  spendApexSpell: (unitId, skillId) =>
    set((s) => ({
      units: s.units.map((u) =>
        u.id === unitId && !u.apexSpent?.includes(skillId) ? { ...u, apexSpent: [...(u.apexSpent ?? []), skillId] } : u,
      ),
    })),
  spendMarkCharge: (unitId, type) =>
    set((s) => ({
      units: s.units.map((u) => {
        if (u.id !== unitId) return u;
        const mark = u.activeEffects.find((e) => e.type === type);
        if (!mark) return u;
        const left = (mark.stacks ?? 1) - 1;
        return {
          ...u,
          activeEffects: left > 0
            ? u.activeEffects.map((e) => (e === mark ? { ...e, stacks: left } : e))
            : u.activeEffects.filter((e) => e !== mark),
        };
      }),
    })),
  cancelBonusTurn: (unitId) =>
    set((s) => (s.bonusTurn.pending === unitId ? { bonusTurn: { ...s.bonusTurn, pending: null } } : s)),
  addReaction: (reaction, limit = 1) =>
    set((s) => {
      // The owner keeps its newest `limit - 1` others (Second Watch stands two); the oldest give way
      const mine = s.reactions.filter((r) => r.ownerId === reaction.ownerId);
      const kept = new Set(mine.slice(Math.max(0, mine.length - (limit - 1))).map((r) => r.id));
      if (limit <= 1) kept.clear();
      return { reactions: [...s.reactions.filter((r) => r.ownerId !== reaction.ownerId || kept.has(r.id)), reaction] };
    }),
  removeReaction: (id) => set((s) => ({ reactions: s.reactions.filter((r) => r.id !== id) })),
  tickReactionsFor: (ownerId) => {
    const expired: PreparedReaction[] = [];
    set((s) => ({
      reactions: s.reactions.flatMap((r) => {
        if (r.ownerId !== ownerId) return [r];
        const ticked = tickReaction(r);
        if (ticked.expired) {
          expired.push(r);
          return [];
        }
        return [ticked.reaction];
      }),
    }));
    return expired;
  },
  drainReactionEvents: () => {
    const events = get().reactionEvents;
    if (events.length > 0) set({ reactionEvents: [] });
    return events;
  },
  addPreparedAttack: (attack) => set((s) => ({ preparedAttacks: [...s.preparedAttacks, attack] })),
  removePreparedAttack: (id, how) => {
    const attack = how === 'broken' ? get().preparedAttacks.find((p) => p.id === id) : undefined;
    set((s) => ({
      preparedAttacks: s.preparedAttacks.filter((p) => p.id !== id),
      ...(attack && { answerTally: addAnswers(s.answerTally, moveIdOf(attack), classifyBroken(attack, s.units)) }),
    }));
    // A boss may answer its warning being broken (the Dragon's Furnace Heart and Skyfire quench his heat)
    if (attack) applyScriptWrites(get(), brokenWrites(attack, get().units));
  },
  noteAnswers: (moveId, answers) => set((s) => ({ answerTally: addAnswers(s.answerTally, moveId, answers) })),
  trimPreparedAttack: (id, hexes) => {
    const gone = new Set(hexes.map((h) => `${h.q},${h.r}`));
    set((s) => ({
      preparedAttacks: s.preparedAttacks.map((p) =>
        p.id === id ? { ...p, hexes: p.hexes.filter((h) => !gone.has(`${h.q},${h.r}`)) } : p),
    }));
  },
  updatePreparedAttack: (id, patch) =>
    set((s) => ({
      preparedAttacks: s.preparedAttacks.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),
  patchBossScript: (unitId, patch) =>
    set((s) => ({
      units: s.units.map((u) =>
        u.id === unitId ? { ...u, bossScript: { ...(u.bossScript ?? initialBossScript()), ...patch } } : u,
      ),
    })),
  payHealth: (unitId, amount) => {
    let paid = 0;
    set((s) => ({
      units: s.units.map((u) => {
        if (u.id !== unitId) return u;
        const next = Math.max(1, u.currentHp - Math.max(0, Math.round(amount)));
        paid = u.currentHp - next;
        return { ...u, currentHp: next };
      }),
    }));
    return paid;
  },
  noteMercy: (unitId) => {
    const target = unitById(get().units, unitId);
    if (!target || !target.isPlayer || target.objective) return;
    // A script may answer a hero being healed or shielded (Tithe on Mercy charges the Emperor's orb)
    applyScriptWrites(get(), mercyWrites(get().units));
  },
  clearPreparedFor: (casterId) => {
    const cleared = get().preparedAttacks.filter((p) => p.casterId === casterId);
    if (cleared.length > 0) {
      set((s) => ({ preparedAttacks: s.preparedAttacks.filter((p) => p.casterId !== casterId) }));
    }
    return cleared;
  },
  // Ground that lasts "until replaced" goes when its owner lays the next of its kind
  addHazard: (hazard) => set((s) => ({
    hazards: [
      ...(hazard.lasts === 'replaced' && hazard.kind !== undefined
        ? s.hazards.filter((h) => !(h.lasts === 'replaced' && h.kind === hazard.kind && h.ownerId === hazard.ownerId))
        : s.hazards),
      hazard,
    ],
  })),
  patchObjective: (unitId, patch) =>
    set((s) => ({
      units: s.units.map((u) => (u.id === unitId && u.objective ? { ...u, objective: { ...u.objective, ...patch } } : u)),
    })),
  removeObjective: (unitId) => {
    const carrierId = unitById(get().units, unitId)?.objective?.carrierId;
    set((s) => ({
      units: s.units.map((u) => (u.id === unitId && u.objective ? { ...u, currentHp: 0 } : u)),
    }));
    // A carried Heart that leaves takes its Seared with it
    if (carrierId) get().removeEffect(carrierId, AfflictionType.Seared);
  },
  carryObjective: (objectiveId, carrierId) => {
    const crystal = unitById(get().units, objectiveId);
    const from = crystal?.objective?.carrierId;
    const to = unitById(get().units, carrierId);
    if (!crystal?.objective || !to || from === carrierId) return;
    const seared = from ? unitById(get().units, from)?.activeEffects.find((e) => e.type === AfflictionType.Seared) : undefined;
    set((s) => ({
      // Last, so a lookup by hex finds the hero and not the crystal riding on them
      units: [
        ...s.units.filter((u) => u.id !== objectiveId),
        { ...crystal, position: { ...to.position }, objective: { ...crystal.objective!, carrierId } },
      ],
      preparedAttacks: s.preparedAttacks.map((p) => (p.id === crystal.objective!.linkedPreparedId && carrierOf(p)
        ? { ...p, bound: [carrierId], hexes: carriedFootprint(p, to.position) }
        : p)),
    }));
    if (from) get().removeEffect(from, AfflictionType.Seared);
    // The burn starts again from its first step on the new carrier (`stacks`: turns kept)
    if (seared) get().applyEffect(carrierId, { ...seared, stacks: 0 });
  },
  tickObjectives: (ownerId) => {
    const events: TickEvent[] = [];
    set((s) => ({
      units: s.units.map((u) => {
        if (u.currentHp <= 0 || u.objective?.ownerId !== ownerId || u.objective.turnsLeft === undefined) {
          return u;
        }
        const left = u.objective.turnsLeft - 1;
        if (left > 0) return { ...u, objective: { ...u.objective, turnsLeft: left } };
        events.push({ text: t('combatLog.float.fades'), color: '#aaaaaa', unitId: u.id });
        return { ...u, currentHp: 0, objective: { ...u.objective, turnsLeft: 0 } };
      }),
    }));
    return events;
  },
  removeHazard: (id) => set((s) => ({ hazards: s.hazards.filter((h) => h.id !== id) })),
  spendThisTurn: (key) =>
    set((s) => ({
      spentThisTurn: {
        serial: s.turnSerial,
        keys: [...(s.spentThisTurn.serial === s.turnSerial ? s.spentThisTurn.keys : []), key],
      },
    })),
  tickHazards: (unitId) => {
    const events: TickEvent[] = [];
    const unit = unitById(get().units, unitId);
    if (!unit) return events;

    // Ground whose owner is gone goes out with it
    const alive = (ownerId?: string) =>
      ownerId === undefined || get().units.some((u) => u.id === ownerId && u.currentHp > 0);
    if (get().hazards.some((h) => !alive(h.ownerId))) {
      set((s) => ({ hazards: s.hazards.filter((h) => alive(h.ownerId)) }));
    }

    // Lit ground catches a hostile body beginning its turn on it. Objectives never
    // take a turn, and a unit's own side is never burned by its own fire.
    if (unit.currentHp > 0 && !unit.objective) {
      for (const hazard of get().hazards) {
        if (!hazard.ignites || !hazard.ownerId) continue;
        const owner = unitById(get().units, hazard.ownerId);
        if (!owner || owner.isPlayer === unit.isPlayer) continue;
        if (!hazard.hexes.some((h) => h.q === unit.position.q && h.r === unit.position.r)) continue;
        get().applyEffect(unit.id, {
          type: AfflictionType.Burn,
          magnitude: hazard.ignites.magnitude,
          duration: hazard.ignites.duration,
          sourceUnitId: owner.id,
        });
        events.push({ text: t('combatLog.tick.ignites'), color: '#ff8844', unitId: unit.id });
        break; // two patches under one body are still one stack a turn
      }
    }

    // The owner's turn counts its ground down
    set((s) => ({
      hazards: s.hazards
        .map((h) =>
          h.ownerId === unitId && h.turnsLeft !== undefined ? { ...h, turnsLeft: h.turnsLeft - 1 } : h,
        )
        .filter((h) => h.turnsLeft === undefined || h.turnsLeft > 0),
    }));
    return events;
  },
  spreadSpark: (unitId, knownBurn) => {
    const events: TickEvent[] = [];
    const corpse = unitById(get().units, unitId);
    if (!corpse || corpse.currentHp > 0 || corpse.objective) return events;
    const burn = knownBurn ?? corpse.activeEffects.find((e) => e.type === AfflictionType.Burn);
    if (!burn) return events;
    // Spent first, so a second call down another death path finds nothing to pass
    get().removeEffect(unitId, AfflictionType.Burn);

    const source = unitById(get().units, burn.sourceUnitId);
    if (!source || source.currentHp <= 0) return events;

    for (const outcome of resolvePassives('onBurningDeath', {
      self: source, allUnits: get().units, other: corpse, burn,
    })) {
      if (outcome.kind !== 'effect') continue;
      get().applyEffect(outcome.unitId, outcome.effect);
      const receiver = unitById(get().units, outcome.unitId);
      if (receiver && receiver.activeEffects.some((e) => e.type === outcome.effect.type)) {
        events.push({ text: t('combatLog.tick.catchesSpark'), color: '#ff8844', unitId: receiver.id });
      }
    }
    return events;
  },
  spreadVenom: (unitId, knownPoison) => {
    const events: TickEvent[] = [];
    const corpse = unitById(get().units, unitId);
    if (!corpse || corpse.currentHp > 0 || corpse.objective) return events;
    const pile = knownPoison ?? corpse.activeEffects.find((e) => e.type === AfflictionType.Poison);
    if (!pile) return events;
    // Spent first, so a second call down another death path finds nothing to pass
    if (corpse.activeEffects.some((e) => e.type === AfflictionType.Poison)) {
      get().removeEffect(unitId, AfflictionType.Poison);
    }
    const owner = unitById(get().units, pile.sourceUnitId);
    if (!owner || owner.currentHp <= 0 || owner.isPlayer === corpse.isPlayer) return events;
    // The passive picks the receiver and the dose; the store only lays what it says
    for (const o of resolvePassives('onDeath', { self: owner, allUnits: get().units, other: corpse, poison: pile })) {
      if (o.kind === 'effect') {
        get().applyEffect(o.unitId, o.effect);
        const receiver = unitById(get().units, o.unitId);
        if (receiver?.activeEffects.some((e) => e.type === AfflictionType.Poison)) {
          events.push({ text: t('combatLog.float.venomSpreads'), log: t('combatLog.tick.catchesVenom'), color: '#88cc44', unitId: receiver.id });
        }
      } else if (o.kind === 'spendAllowance') {
        set((st) => ({ units: st.units.map((u) => (u.id === o.unitId ? { ...u, venomTransferSpent: true } : u)) }));
      }
    }
    return events;
  },
  spreadMark: (unitId, knownMark) => {
    const events: TickEvent[] = [];
    const corpse = unitById(get().units, unitId);
    if (!corpse || corpse.currentHp > 0 || corpse.objective) return events;
    const mark = knownMark ?? corpse.activeEffects.find((e) => e.type === AfflictionType.Mark);
    if (!mark) return events;
    const owner = unitById(get().units, mark.sourceUnitId);
    if (!owner || owner.currentHp <= 0 || owner.isPlayer === corpse.isPlayer || !hasPassive(owner, 'nextQuarry')) return events;
    // Spent first, so a second call down another death path finds nothing to pass
    get().removeEffect(unitId, AfflictionType.Mark);
    for (const o of resolvePassives('onDeath', { self: owner, allUnits: get().units, other: corpse, mark })) {
      if (o.kind !== 'effect') continue;
      get().applyEffect(o.unitId, o.effect);
      const receiver = unitById(get().units, o.unitId);
      if (receiver?.activeEffects.some((e) => e.type === AfflictionType.Mark)) {
        events.push({ text: t('combatLog.float.markPasses'), log: t('combatLog.tick.catchesMark'), color: MARKSMAN_YELLOW, unitId: receiver.id });
      }
    }
    return events;
  },
  holdForEcho: (unitId) => {
    set((s) => ({
      units: s.units.map((u) => (u.id === unitId ? { ...u, hasActed: true, echoHold: true, repositionCap: undefined } : u)),
    }));
  },
  // The mode belongs to the press it was chosen for: selecting anything else —
  // or nothing — drops it, so a stale stance cannot ride into the next cast.
  selectSkill: (skill, mode) => set({ selectedSkill: skill, selectedMode: skill ? mode ?? null : null }),
  setHighlights: (hexes) => set({ highlightedHexes: hexes }),

  moveUnit: (unitId, to, mode = 'walk', voluntary = get().currentUnitId === unitId, via, path) => {
    const before = unitById(get().units, unitId);
    set((s) => ({
      units: s.units.map((u) => {
        if (u.id !== unitId) return u;
        // A unit's own move turns it to its last step; a shove, a drag or a pull
        // moves the body and leaves it looking where it looked
        // (an objective, with no front to snap, still turns its picture to the move)
        const facing = voluntary && hasFacing(u) ? moveFacing(u.position, to, path) : null;
        const angle = facing !== null ? directionAngle(facing) : voluntary ? computeFacingAngle(u.position, to) : null;
        return {
          ...u, voluntaryMoved: u.voluntaryMoved || voluntary, position: to,
          movement: { mode, from: u.position, ...(via && { via }), ...(path && { path }) },
          ...(angle !== null && { facingAngle: angle }),
          ...(facing !== null && { facing }),
        };
      }),
      // Recorded only while somebody is waiting for it, so a fight with no
      // Reaction in it pays nothing for the feature.
      ...(s.reactions.length > 0 && {
        reactionEvents: [...s.reactionEvents, { kind: 'moved' as const, unitId }],
      }),
    }));
    // A carried Heart rides on its carrier, and the warning it rides on is re-centred with it
    const riders = carriedOn(unitId, get().units);
    if (riders.length > 0) {
      const ids = new Set(riders.map((r) => r.id));
      const linked = new Set(riders.map((r) => r.objective?.linkedPreparedId));
      set((s) => ({
        units: s.units.map((u) => (ids.has(u.id) ? { ...u, position: { ...to } } : u)),
        preparedAttacks: s.preparedAttacks.map((p) => (linked.has(p.id) && carrierOf(p) === unitId
          ? { ...p, hexes: carriedFootprint(p, to) }
          : p)),
      }));
    }
    // A companion follows its summoner wherever it went, however far, without a
    // move of its own: it is set down beside the owner and crosses nothing
    // (a stationary one — the Lantern Beacon — stays where it was planted)
    const followers = get().units.filter((u) => u.companion && u.summonedBy === unitId && u.currentHp > 0
      && !findSummonTemplate(u.templateId as SummonTemplateId)?.stationary);
    for (const follower of followers) {
      const spot = companionFollowHex(follower, to, get().units);
      if (!spot) continue;
      set((s) => ({
        units: s.units.map((u) => (u.id === follower.id
          ? { ...u, position: spot, movement: { mode: 'jump' as const, from: u.position } }
          : u)),
      }));
    }
    const crossed = before ? settleCrossings(before, to, path) : [];
    const motes = settleMotes(unitId, to);
    // Whoever moved may have stepped into or out of a Beacon's light
    get().syncBeacons();
    return [...crossed, ...motes];
  },

  setUnitMagic: (unitId, magic) => {
    set((s) => ({
      units: s.units.map((u) => (u.id === unitId ? { ...u, stats: { ...u.stats, magic } } : u)),
    }));
  },

  tickCompanionLifetime: (unitId) => {
    const unit = unitById(get().units, unitId);
    if (!unit || unit.summonTurnsLeft === undefined) return 'alive';
    const left = unit.summonTurnsLeft - 1;
    set((s) => ({
      units: s.units.map((u) =>
        u.id === unitId ? { ...u, summonTurnsLeft: Math.max(0, left), ...(left < 0 && { currentHp: 0 }) } : u,
      ),
    }));
    return left < 0 ? 'expired' : 'alive';
  },

  setUntargetable: (unitId, value) => {
    set((s) => ({
      units: s.units.map((u) => (u.id === unitId ? { ...u, untargetable: value } : u)),
    }));
  },

  setFacing: (unitId, toward) => {
    set((s) => ({
      units: s.units.map((u) => {
        if (u.id !== unitId) return u;
        // The model turns to the rule's hex direction, not the exact aim between two of them
        const facing = hasFacing(u) ? directionToward(u.position, toward) : null;
        if (facing !== null) return faced(u, facing);
        const angle = computeFacingAngle(u.position, toward);
        return angle === null ? u : { ...u, facingAngle: angle };
      }),
    }));
  },

  damageUnit: (unitId, amount, attackerId, options) => damageUnit(host, unitId, amount, attackerId, options),
  resolveDeath: (unitId, ctx) => resolveDeath(host, unitId, ctx),

  /**
   * Moves a phased boss into whatever phase its current HP deserves.
   *
   * Returns the phase name when one was entered, for the log. All three rules
   * live here: the index only increases, a blow crossing two thresholds lands on
   * the deeper one, and the threshold it entered at becomes a hard HP ceiling.
   */
  releaseBossPhase: (unitId) => {
    const unit = unitById(get().units, unitId);
    if (!unit || unit.currentHp <= 0) return undefined;
    const index = (unit.bossPhase ?? 0) + 1;
    const phase = phasesFor(unit.templateId)?.[index];
    return phase && phaseAtTier(unit, phase) ? get().enterPendingPhase(unitId, { index, phase }) : undefined;
  },

  enterPendingPhase: (unitId, forced) => {
    const unit = unitById(get().units, unitId);
    if (!unit || unit.currentHp <= 0) return undefined;

    const next = forced ?? pendingPhase(unit);
    if (!next) return undefined;

    // A forced release is not a health threshold: it takes nothing from the boss and
    // caps nothing, so the damage it has taken is exactly what the party dealt
    const ceiling = forced ? undefined : phaseHpCeiling(unit, next.phase);
    // A phase that keeps the script (the Troll's Fury) is a state he is in, not a
    // new kit: warnings in flight still land, the cycle carries on and nothing
    // that was cooling down is handed back
    const keeps = next.phase.keepsScript === true;
    const lit = next.phase.aura;
    set((s) => ({
      // A phase change is a reset of rhythm: an old warning never resolves into
      // the new kit as an unexplained hit, and what the old phase raised on the
      // board — a standard, a seal — does not silently protect the next one.
      preparedAttacks: keeps ? s.preparedAttacks : s.preparedAttacks.filter((p) => p.casterId !== unitId),
      // and the ground it laid "until the phase turns" (black glass) goes with the objectives it shatters
      hazards: keeps ? s.hazards : s.hazards.filter((h) => !(h.lasts === 'phase' && h.ownerId === unitId)),
      units: s.units.map((u) =>
        !keeps && u.objective && u.objective.ownerId === unitId && u.objective.shattersOnPhase !== false
          ? { ...u, currentHp: 0 }
          : u.id === unitId
          ? {
              ...u,
              bossPhase: next.index,
              formStats: next.phase.stats,
              skills: next.phase.skills,
              hpCeiling: ceiling,
              currentHp: ceiling === undefined ? u.currentHp : Math.min(u.currentHp, ceiling),
              ...(keeps
                ? {
                    activeEffects: lit
                      ? [
                          ...u.activeEffects.filter((e) => e.type !== lit.type),
                          { type: lit.type, magnitude: lit.magnitude, duration: -1, sourceUnitId: u.id },
                        ]
                      : u.activeEffects,
                  }
                : {
                    // A new phase arrives with its kit ready. Carrying cooldowns across
                    // would mean a phase whose signature skill is unavailable for its
                    // first two turns, which reads as the transition not having
                    // happened at all.
                    cooldowns: {},
                    // The rotation starts over, and the boss keeps and sheds what its entry says
                    ...intoNewPhase(u),
                  }),
            }
          : !keeps && isPhaseBound(u, unitId)
          ? { ...u, activeEffects: u.activeEffects.filter((e) => !PHASE_BOUND.has(e.type)) }
          : u
      ),
    }));
    // What the boss raises on the board as the phase begins (the Heart's tier-5 anchors)
    const entered = unitById(get().units, unitId);
    const raised = entered ? phaseRaises(entered, get().units) : [];
    if (raised.length > 0) get().addUnits(raised);
    return phaseName(next.phase);
  },

  healUnit: (unitId, amount, healerId) => {
    // Credited with what landed rather than what was cast: healing a unit at
    // full health is a wasted turn, and the report should say so.
    let restored = 0;

    set((s) => {
      const units = s.units.map((u) => {
        if (u.id !== unitId) return u;
        // The dead stay dead. Nothing in combat revives, and every heal route —
        // a drain settling after Retaliation killed its owner, a Sacred Seal, an
        // ally heal on hit — used to be able to mend a corpse back onto the board
        // after its death had already played (playtest 2026-10-08). A lethal save
        // never lands here at 0: Undying holds the unit at 1 before its heal.
        if (u.currentHp <= 0) return u;
        // The receiver's own bonus, read here rather than at the call sites: a
        // skill heal, a drain, a passive's mend, the Templar's spill and a
        // lethal save are five routes in, and a bonus that reached only the
        // first would be worth whatever the fight happened to consist of. The
        // caster's `healPower` is already inside `amount` — see
        // `calculateHealing` — and the two compose, being claims about two
        // different people.
        // The Furnace Heart's Seared takes its share off what arrives (`healingReceived`)
        const incoming = healingReceived(u, amplifyIncomingSupport(u, amount));
        // The ceiling is what makes a phased boss's health bar a ratchet: it
        // recovers *within* its band and can never undo work already done
        const healed = Math.min(u.hpCeiling ?? combatMaxHp(u), u.currentHp + incoming);
        restored = healed - u.currentHp;
        return { ...u, currentHp: healed };
      });
      return {
        units,
        fightStats: creditFightStats(s.fightStats, [[healerId, 'healingDone', restored]]),
      };
    });

    return restored;
  },

  markMoved: (unitId) => {
    set((s) => ({
      units: s.units.map((u) => {
        if (u.id !== unitId) return u;
        // Walking drops Aimed Shot's aim (the turn was spent moving) and whatever a boss's
        // entry says a step voids (Aethelred's Writ)
        const voided = new Set<StatusEffectType>([AuraType.Aiming, ...stepVoids(u)]);
        return {
          ...u,
          hasMoved: true,
          repositionCap: undefined,
          activeEffects: u.activeEffects.some((e) => voided.has(e.type))
            ? u.activeEffects.filter((e) => !voided.has(e.type))
            : u.activeEffects,
        };
      }),
    }));
  },

  beginTurnFlags: (unitId) => {
    set((s) => ({
      units: s.units.map((u) =>
        u.id === unitId
          ? { ...u, hasMoved: false, hasActed: false, turnStartPos: u.position, repositionCap: undefined, echoHold: undefined }
          : u,
      ),
    }));
  },

  markActed: (unitId) => {
    set((s) => ({
      units: s.units.map((u) => (u.id === unitId ? { ...u, hasActed: true } : u)),
    }));
  },

  grantReposition: (unitId, cap) => {
    set((s) => ({
      units: s.units.map((u) =>
        u.id === unitId ? { ...u, hasActed: true, hasMoved: false, repositionCap: cap } : u,
      ),
    }));
  },

  setForm: (unitId, form) => {
    set((s) => ({
      units: s.units.map((u) =>
        u.id === unitId
          ? { ...u, formStats: form?.stats, skills: form ? form.skills : u.skills }
          : u
      ),
    }));
  },

  setWildForm: (unitId, form) => {
    const unit = unitById(get().units, unitId);
    if (!unit) return;

    /**
     * The hero's own kit, whole.
     *
     * `createPlayerUnits` writes it up front, form skills included, because
     * `unit.skills` is the *upright* filter of it and stashing that on the first
     * shift is what made every tier-2 Wildshape node unreachable. The fallback
     * survives for units built by hand — a fixture, the sim harness — and is
     * still never re-derived mid-fight, which would drop anything gained since
     * the fight began.
     */
    const humanSkills = unit.humanSkills ?? unit.skills;

    /**
     * The shape as *this* Druid wears it: the node's level ramped over each
     * multiplier's distance from 1, and their own magic carried across. Both
     * live in `wildshape.wornForm`, which is pure and testable; nothing about a
     * shape's numbers is decided in here.
     */
    const worn = form ? wornForm(unit, form) : null;

    get().setForm(unitId, {
      stats: worn?.stats,
      skills: skillsForForm(form, humanSkills, unit.masteryModifiers),
    });

    /**
     * Health moves with the shape, keeping its fraction.
     *
     * A bear at 1.5× vigor takes an 80/100 Druid to 120/150 — the same share of
     * a bigger pool. Preserving the *ratio* rather than adding a flat block is
     * what makes it safe in both directions: shifting out cannot launder health
     * (75/150 comes back as 50/100), and shifting in at death's door does not
     * hand out a rescue. Floored at 1, so reverting can never round a living
     * hero down to a corpse.
     *
     * The ratio is still two vigors and needs no other term, which is the whole
     * reason the Bear's converted magic is folded into `vigor` rather than added
     * to the pool beside it — a second term here would have to be undone in
     * lockstep by the revert and by `CombatScene`'s victory write-back, which
     * divides current HP by exactly this number.
     */
    const nextVigor = worn?.vigor ?? 1;
    const prevVigor = unit.formVigor ?? 1;
    const scale = nextVigor / prevVigor;

    // `wildForm` is genuinely Wildshape's own — it is the model key, and a boss
    // phase has no business owning one
    set((s) => ({
      units: s.units.map((u) =>
        u.id === unitId
          ? {
              ...u,
              wildForm: form,
              humanSkills,
              formVigor: nextVigor,
              // Cleared on reverting, or a Druid standing upright would keep the
              // wolf's teeth
              formBonus: worn?.bonus,
              // Second Nature: shifting, whichever way, starts the count again
              shapeTurns: 0,
              currentHp: u.currentHp > 0 ? Math.max(1, Math.round(u.currentHp * scale)) : u.currentHp,
            }
          : u,
      ),
    }));

    // What the shape left behind or put on (remaster, 2026-10).
    const leaving = unit.wildForm ?? null;
    if (leaving === form) return;
    const patch = (fields: Partial<CombatUnit>) =>
      set((s) => ({ units: s.units.map((u) => (u.id === unitId ? { ...u, ...fields } : u)) }));
    // Blood Howl is the Wolf's alone: the aura and any turns it queued go with the shape
    if (leaving === 'wolf') {
      get().removeEffect(unitId, AuraType.BloodHowl);
      patch({ howlQueued: 0 });
    }
    // Leaving Apex — by its clock, by its spells, by hand or by Second Skin — starts
    // its long cooldown from now and throws away whatever spells were left
    if (leaving === 'apex') {
      get().removeEffect(unitId, AuraType.Apex);
      patch({ apexSpent: undefined });
      const apex = humanSkills.find((s) => s.id === 'apex_form');
      if (apex) get().startCooldown(unitId, apex);
    }
    // A fresh Apex: three regular turns on the clock and all three spells unspent
    if (form === 'apex') {
      patch({ apexSpent: [] });
      get().applyEffect(unitId, {
        type: AuraType.Apex, magnitude: BALANCE.APEX_TURNS, duration: BALANCE.APEX_TURNS, sourceUnitId: unitId,
      });
    }
  },

  startCooldown: (unitId, skill) => {
    if (!skill.cooldown || skill.cooldown <= 0) return;
    set((s) => ({
      units: s.units.map((u) =>
        u.id === unitId ? { ...u, cooldowns: withCooldownStarted(u.cooldowns, skill) } : u
      ),
    }));
  },

  refundCooldown: (unitId, turns, onlyIds) => {
    const unit = unitById(get().units, unitId);
    if (!unit?.cooldowns) return;
    // Primal Surge refunds only the shapes' own skills; the rest are carried as they are
    const pick = onlyIds
      ? Object.fromEntries(Object.entries(unit.cooldowns).filter(([id]) => onlyIds.includes(id)))
      : unit.cooldowns;
    const refunded = refundedCooldowns(pick, turns);
    if (refunded === pick) return;
    const next = onlyIds
      ? { ...Object.fromEntries(Object.entries(unit.cooldowns).filter(([id]) => !onlyIds.includes(id))), ...refunded }
      : refunded;
    if (next === unit.cooldowns) return;
    set((s) => ({
      units: s.units.map((u) => (u.id === unitId ? { ...u, cooldowns: next } : u)),
    }));
  },

  tickCooldowns: (unitId) => {
    const unit = unitById(get().units, unitId);
    if (!unit?.cooldowns) return;
    const next = tickedCooldowns(unit.cooldowns);
    // Identity means nothing was running — skip the write rather than
    // re-rendering every unit on every turn of every fight
    if (next === unit.cooldowns) return;
    set((s) => ({
      units: s.units.map((u) => (u.id === unitId ? { ...u, cooldowns: next } : u)),
    }));
  },

  spendMana: (unitId, amount) => {
    set((s) => ({
      units: s.units.map((u) =>
        u.id === unitId ? { ...u, currentMana: Math.max(0, u.currentMana - amount) } : u
      ),
    }));
  },

  restoreMana: (unitId, amount) => {
    set((s) => ({
      units: s.units.map((u) =>
        u.id === unitId
          ? { ...u, currentMana: Math.min(u.stats.maxMana, u.currentMana + amount) }
          : u
      ),
    }));
  },

  applyEffect: (unitId, { spilled, ...effect }) => {
    const stamped = withIncomingSupport(unitById(get().units, unitId), {
      ...effect,
      // Deep Cuts: every Bleed its applier lays lasts longer, whatever laid it
      duration: effect.duration + bleedDurationBonus(get().units, effect) + rootDurationBonus(get().units, effect),
      appliedAt: nextEffectSequence(),
    });

    // The overdose. Decided here, before the write, because it is the one
    // application that adds nothing to the pile — and decided in the store
    // rather than at the call sites so that every route in obeys it: a skill,
    // a passive, an enemy's bite, a coated blade. Reaching the cap used to make
    // further doses do *nothing*, which meant the reward for the poison path
    // succeeding was that its strikes stopped counting.
    if (stamped.type === AfflictionType.Poison) {
      const target = unitById(get().units, unitId);
      const carried = target?.activeEffects.find((e) => e.type === AfflictionType.Poison);
      const attacker = unitById(get().units, stamped.sourceUnitId);

      if (target && attacker && poisonAtCap(carried)) {
        const { damage, crit } = poisonBurstDamage(attacker, target);
        const { absorbed } = get().damageUnit(unitId, damage, attacker.id, { difficultyApplied: true });
        // The pile is spent: the burst is what the doses were building to, and the
        // next one starts again from nothing. Keeping the doses made every hit on a
        // capped target another burst — two a turn from Venomed Blades.
        set((s) => ({
          units: s.units.map((u) =>
            u.id !== unitId ? u : {
              ...u,
              activeEffects: u.activeEffects.filter((e) => e.type !== AfflictionType.Poison),
            },
          ),
        }));
        return { landed: AfflictionType.Poison, burst: damage - absorbed, crit };
      }
    }

    /**
     * The two refusals and the one substitution, decided *before* the write.
     *
     * They used to live inside the mapper, which meant the only record of what
     * had happened was the unit itself — so nothing outside could tell a Chill
     * landing from a Chill becoming a Freeze, which is exactly the thing the
     * announcement needs to know. See `EffectOutcome.landed`.
     */
    const target = unitById(get().units, unitId);
    if (!target) return undefined;

    // A passive immunity refuses the status outright, before anything else
    if (isImmuneTo(target, stamped.type)) return undefined;

    // Nothing hides in a Lantern Beacon's light
    if (stamped.type === AuraType.Stealth && target.activeEffects.some((e) => e.type === AuraType.BeaconLit)) return undefined;

    // Nothing afflicts what is held out of the fight: a Burrowmother under the sand, a hero in a tomb
    if ((isSealed(target) || isSuspended(target)) && isAffliction(stamped.type)) return undefined;

    // Brittle: a hero's Chill that would freeze a boss spends the Chill and leaves
    // one mark instead, which disables nothing. Its burst is fixed now, from the
    // creator's Magic, so a later buff or death of the creator cannot change it. A
    // mark already standing is refreshed, never stacked.
    const source = stamped.sourceUnitId ? unitById(get().units, stamped.sourceUnitId) : undefined;
    if (source && chillMakesBrittle(target, stamped, source.isPlayer, ignoresDisable(target, AfflictionType.Freeze))) {
      const mark: ActiveEffect = {
        type: AfflictionType.Brittle,
        magnitude: Math.max(1, Math.round(getCombatEffectiveStats(source).magic * BALANCE.BRITTLE_BURST_MAGIC)),
        duration: BALANCE.BRITTLE_DURATION + freezeDurationBonus(source),
        sourceUnitId: source.id,
        appliedAt: stamped.appliedAt,
      };
      set((s) => ({
        units: s.units.map((u) => u.id !== unitId ? u : {
          ...u,
          activeEffects: [
            ...u.activeEffects.filter((e) => e.type !== AfflictionType.Chill && e.type !== AfflictionType.Brittle),
            mark,
          ],
        }),
      }));
      return { landed: AfflictionType.Brittle, burst: 0, crit: false };
    }

    // A boss does not keep an ordinary disable. Any interrupt it is owed was
    // settled by `applySkillStatus` before this point; Taunt is not on the list.
    // A Chill that would become a Freeze is a Freeze for this purpose: a boss does
    // not keep the ice either, though the Chill it already wears is left alone.
    if (ignoresDisable(target, chillUpgrades(target, stamped) ? AfflictionType.Freeze : stamped.type)) {
      return undefined;
    }

    // DebuffImmunity: silently skip afflictions, unless the source pierces it
    if (
      isAffliction(stamped.type) &&
      target.activeEffects.some((e) => e.type === AuraType.DebuffImmunity) &&
      !sourcePierces(get().units, stamped.sourceUnitId)
    ) {
      return undefined;
    }

    // Mind Control takes nobody from a party of one: the last hero is never turned
    if (stamped.type === AfflictionType.MindControl && !canBeSeized(target, get().units)) {
      return undefined;
    }

    /**
     * Chill on an already-chilled target freezes it. The upgrade is the whole
     * reason Chill is worth applying to something already slowed, and doing it
     * here means every source of Chill gets it for free. `FREEZE_DURATION`
     * rather than the old `99` sentinel: the ice runs on a clock now, read
     * pre-tick in `turnStart` the way a Stun is.
     *
     * `exact` is the one opt-out, and it exists for the Hydromancer's second
     * capstone rather than as a general escape hatch — the Rime Tornado covers
     * far more ground than Blizzard on the bargain that it only ever slows. The
     * check is here rather than at the call sites for the same reason the
     * upgrade is: this is the single funnel every application passes through, so
     * a skill, a passive and an enemy's bite all obey one rule.
     */
    const upgraded = chillUpgrades(target, stamped);
    // Crumble: a Stun or Root its holder lands on an enemy carries the defence it
    // strips, so the shred stands exactly as long as the control does
    const crumble = source && source.isPlayer !== target.isPlayer && hasPassive(source, 'crumble')
      && (stamped.type === AfflictionType.Stun || stamped.type === AfflictionType.Root)
      ? crumbleShred(passiveRank(source, 'crumble'))
      : 0;
    // Dropped Guard: a Taunt its holder lands carries the opening, so it stands exactly as long as the Taunt does
    const tauntedExposure = source && source.isPlayer !== target.isPlayer && stamped.type === AfflictionType.Taunt
      ? source.masteryModifiers?.tauntedExposure ?? 0
      : 0;
    const arriving: ActiveEffect = upgraded
      ? { ...stamped, type: AfflictionType.Freeze, duration: BALANCE.FREEZE_DURATION + freezeDurationBonus(source) }
      : crumble > 0 ? { ...stamped, crumble }
      : tauntedExposure > 0 ? { ...stamped, tauntedExposure } : stamped;

    // Brimming Over: measured against the same ceiling `mergeEffect` is about to
    // hold the pile to. A spill never spills again, which bounds it at one step.
    const overflow = spilled ? 0 : burnSpill(
      source, target.activeEffects.find((e) => e.type === AfflictionType.Burn), arriving,
    );

    set((s) => ({
      units: s.units.map((u) => {
        if (u.id !== unitId) return u;
        // The Chill it was is spent becoming the Freeze it is now
        const base = upgraded
          ? u.activeEffects.filter((e) => e.type !== AfflictionType.Chill)
          : u.activeEffects;

        const existing = base.find((e) => e.type === arriving.type);
        const fresh =
          arriving.type === AfflictionType.Poison
            ? freshPoison(arriving)
            // The first wound is already a stack, so the count is read off the
            // effect from the start rather than assumed
            : arriving.type === AfflictionType.Wound
              ? { ...arriving, stacks: arriving.stacks ?? 1 }
              : arriving;
        if (!existing) return { ...u, activeEffects: [...base, arriving.type === AuraType.BlessedWeapon ? { ...fresh, stacks: 1 } : fresh],
          ...(arriving.type === AuraType.BlessedWeapon && { skills: u.skills.map(skill =>
            skill.id === 'basic_attack' || skill.id === 'smite' ? { ...skill, range: skill.range + 1 } : skill) }) };

        return {
          ...u,
          activeEffects: base.map((e) =>
            e !== existing
              ? e
              : arriving.type === AfflictionType.Poison
                ? mergePoison(e, arriving)
                : mergeEffect(e, arriving, burnCeilingScale(source, arriving.type)),
          ),
        };
      }),
    }));

    // A Barrier landing on a hero is the Tithe's second trigger (a heal is the
    // first). Noted once the status has actually gone on.
    if (arriving.type === AuraType.Barrier && target.isPlayer && arriving.magnitude > 0) {
      get().noteMercy(unitId);
    }

    if (overflow > 0 && source && source.isPlayer !== target.isPlayer && target.currentHp > 0) {
      const receiver = burnSpillReceiver(get().units, target, source);
      if (receiver) {
        get().applyEffect(receiver.id, {
          type: AfflictionType.Burn, magnitude: overflow, duration: arriving.duration, sourceUnitId: source.id, spilled: true,
        });
        return { landed: arriving.type, burst: 0, crit: false, spilledTo: receiver.id };
      }
    }

    // Silent unless the application *was* the event. A status landing exactly as
    // it was asked for is the overwhelmingly common case and needs no report —
    // the caller already knows what it sent. Only the substitution does.
    return upgraded ? { landed: arriving.type, burst: 0, crit: false } : undefined;
  },

  removeEffect: (unitId, type) => {
    set((s) => ({
      units: s.units.map((u) =>
        u.id === unitId
          ? { ...u, activeEffects: u.activeEffects.filter((e) => e.type !== type),
            ...(type === AuraType.BlessedWeapon && u.activeEffects.some(e => e.type === type) && { skills: u.skills.map(skill =>
              skill.id === 'basic_attack' || skill.id === 'smite' ? { ...skill, range: skill.range - 1 } : skill) }) }
          : u
      ),
    }));
  },

  removeAllAfflictions: (unitId) => {
    set((s) => ({
      units: s.units.map((u) =>
        u.id === unitId
          ? { ...u, activeEffects: u.activeEffects.filter((e) => !isCleansable(e.type)) }
          : u
      ),
    }));
  },

  tickEffectsOnUnit: (unitId) => tickEffects(host, unitId),

  detonateMartyrSeal: (unitId, seal) => {
    const events: TickEvent[] = [];
    const carrier = unitById(get().units, unitId);
    if (!carrier) return events;

    const amount = Math.max(1, Math.round(seal.magnitude));
    // Everything on the far side of the line, within the blast. The carrier is
    // untouched by construction — it is the bomb, not a casualty — and so are
    // its allies: no skill in this game has ever hurt its own side.
    const caught = get().units.filter(
      (u) =>
        u.currentHp > 0 &&
        u.isPlayer !== carrier.isPlayer &&
        hexDistance(u.position, carrier.position) <= BALANCE.MARTYR_BLAST_RADIUS,
    );

    for (const victim of caught) {
      const taken = get().damageUnit(victim.id, amount, carrier.id);
      const { hpLost } = taken;
      events.push({
        text: `-${hpLost}`, color: '#ffe9a8', unitId: victim.id,
        sound: strikeIntent(victim, 'spell', strikeOutcome({ dodged: false, crit: false }, hpLost), undefined, undefined, strikeDetail(undefined, taken, { skillId: 'martyr' })),
      });
    }

    // One spec for the blast itself, on the first event rather than one per
    // victim — the detonation is a single thing happening at the carrier, and
    // four overlapping novas on the same hex is just a brighter nova.
    if (events.length > 0) {
      events[0].vfx = {
        kind: 'nova', delivery: 'spell',
        casterId: carrier.id,
        casterPos: carrier.position,
        targetCoord: carrier.position,
        hitUnitIds: caught.map((u) => u.id),
        hitCoords: caught.map((u) => u.position),
        color: '#ffe9a8',
      };
    }
    return events;
  },

  recoverFromRubble: (recipientId, ownerId) => {
    const owner = unitById(get().units, ownerId);
    const recipient = unitById(get().units, recipientId);
    if (!owner || owner.currentHp <= 0 || !hasPassive(owner, 'rubbleRecovery')) return undefined;
    if (!recipient || recipient.currentHp <= 0 || recipient.objective) return undefined;
    if (owner.rubbleRecovered?.includes(recipientId)) return undefined;
    const amount = Math.max(1, Math.round(
      getCombatEffectiveStats(owner).magic * rubbleRecoveryMultiplier(passiveRank(owner, 'rubbleRecovery')),
    ));
    set((s) => ({
      units: s.units.map((u) => u.id === ownerId ? { ...u, rubbleRecovered: [...(u.rubbleRecovered ?? []), recipientId] } : u),
    }));
    const landed = get().healUnit(recipientId, amount, ownerId);
    return { text: t('combatLog.float.rubble', { amount: landed }), log: `${passiveName('rubbleRecovery')} +${landed}`, color: '#7fd17a', unitId: recipientId };
  },

  answerFromStone: (recipientId, ownerId, breakerId) => {
    const owner = unitById(get().units, ownerId);
    const breaker = unitById(get().units, breakerId);
    if (!owner || owner.currentHp <= 0 || !hasPassive(owner, 'stonesAnswer')) return [];
    if (!breaker || breaker.currentHp <= 0 || breaker.isPlayer === owner.isPlayer || duelBars(owner, breaker)) return [];
    if (owner.stonesAnswered?.includes(recipientId)) return [];
    set((s) => ({
      units: s.units.map((u) => u.id === ownerId ? { ...u, stonesAnswered: [...(u.stonesAnswered ?? []), recipientId] } : u),
    }));
    const blow: HeroSkill = {
      id: 'stones_answer',
      targetType: SkillTargetType.Single, range: 1, scaling: 'magic', damageType: 'physical',
      damage: stonesAnswerMagic(passiveRank(owner, 'stonesAnswer')),
      unlockLevel: 1, manaCost: 0,
    };
    const taken = get().damageUnit(breakerId, calculateDamage(owner, breaker, blow, 'front', get().units), ownerId, { difficultyApplied: true });
    const events: TickEvent[] = [{
      text: `-${taken.hpLost + taken.absorbed}`, log: `${passiveName('stonesAnswer')} -${taken.hpLost}`, color: '#c8a878', unitId: breakerId,
      sound: strikeIntent(breaker, 'blunt', strikeOutcome({ dodged: false, crit: false }, taken.hpLost), undefined, undefined, strikeDetail(undefined, taken)),
    }, ...(taken.deathEvents ?? [])];
    if ((unitById(get().units, breakerId)?.currentHp ?? 0) > 0) {
      get().applyEffect(breakerId, { type: AfflictionType.Root, magnitude: 1, duration: BALANCE.ADVANCED_DRUID.STONES_ANSWER_ROOT_TURNS, sourceUnitId: ownerId });
    }
    return events;
  },
  carapaceSoaked: (unitId, attackerId) => {
    const carrier = unitById(get().units, unitId);
    if (!carrier) return [];
    // PT-08: the float was the whole sentence, too long to read over a unit
    const soak: TickEvent = { text: t('combatLog.float.carapaceSoak'), log: t('combatLog.tick.carapaceSoak'), color: CARAPACE_COLOR, unitId };
    // Returned Blow: `beetleMoves.retribute`'s certain blow, for the Beetle's own soak
    const blow = returnedBlow(carrier);
    const attacker = attackerId ? unitById(get().units, attackerId) : undefined;
    if (!blow || !attacker || carrier.currentHp <= 0 || attacker.currentHp <= 0 || attacker.isPlayer === carrier.isPlayer) return [soak];
    const damage = calculateDamage(carrier, attacker, blow, 'front', get().units);
    const taken = get().damageUnit(attacker.id, damage, carrier.id, { difficultyApplied: true });
    return [
      soak,
      {
        text: `-${damage}`, log: `${passiveName('returnedBlow')} -${taken.hpLost}`, color: CARAPACE_COLOR, unitId: attacker.id,
        sound: strikeIntent(attacker, 'blunt', strikeOutcome({ dodged: false, crit: false }, taken.hpLost), undefined, undefined, strikeDetail(undefined, taken)),
      },
      ...(taken.deathEvents ?? []),
    ];
  },

  releaseReckoning: (unitId, spent) => {
    const carrier = unitById(get().units, unitId);
    if (!carrier) return [];
    const amount = reckoningBurst(getCombatEffectiveStats(carrier).attack, spent.stored ?? 0);
    // Every living enemy of the carrier within the ring. Fixed damage through
    // `damageUnit`, so a Barrier on a victim still soaks it, and the carrier's own
    // Reckoning is already gone: the shockwave cannot charge itself.
    const caught = get().units.filter(
      (u) =>
        u.currentHp > 0 &&
        !u.objective &&
        u.isPlayer !== carrier.isPlayer &&
        hexDistance(u.position, carrier.position) <= BALANCE.RECKONING_RADIUS,
    );
    const events: TickEvent[] = [{
      text: statusName(AuraType.Reckoning), color: RECKONING_COLOR, unitId,
      vfx: {
        kind: 'nova', delivery: 'spell',
        casterId: carrier.id,
        casterPos: carrier.position,
        targetCoord: carrier.position,
        hitUnitIds: caught.map((u) => u.id),
        hitCoords: caught.map((u) => u.position),
        color: RECKONING_COLOR,
        aftermath: 'embers',
      },
    }];
    for (const victim of caught) {
      const taken = get().damageUnit(victim.id, amount, carrier.id);
      const { hpLost, deathEvents } = taken;
      events.push({
        text: `-${hpLost}`, color: RECKONING_COLOR, unitId: victim.id,
        sound: strikeIntent(victim, 'blunt', strikeOutcome({ dodged: false, crit: false }, hpLost), undefined, undefined, strikeDetail(undefined, taken, { skillId: 'reckoning' })),
      });
      if (deathEvents) events.push(...deathEvents);
    }
    return events;
  },

  retireOwned: (unitId) => {
    // A fallen Shadowblade's Death Marks go with it: nobody is left to answer them
    if (get().units.some((u) => u.activeEffects.some((e) => e.type === AfflictionType.DeathMark && e.sourceUnitId === unitId))) {
      set((s) => ({
        units: s.units.map((u) => u.activeEffects.some((e) => e.type === AfflictionType.DeathMark && e.sourceUnitId === unitId)
          ? { ...u, activeEffects: u.activeEffects.filter((e) => !(e.type === AfflictionType.DeathMark && e.sourceUnitId === unitId)) }
          : u),
      }));
    }
    // A seed goes with its owner, and so does a tomb, which frees the hero it held. Every other
    // objective is left as it always was (a boss's standards stand after it falls, and the
    // fight is over by then anyway)
    const isSeed = (u: CombatUnit) =>
      u.currentHp > 0 && u.objective?.kind === SEED_KIND && u.objective.ownerId === unitId;
    // A Jorogumo's webs are held the same way, and go with her
    const isTomb = (u: CombatUnit) =>
      u.currentHp > 0 && (u.objective?.kind === TOMB_KIND || u.objective?.kind === WEB_KIND) && u.objective.ownerId === unitId;
    const held = new Set(
      get().units.filter(isTomb).map((u) => u.objective?.linkedUnitId).filter((id): id is string => !!id),
    );
    const open = get().preparedAttacks.some((p) => p.casterId === unitId);
    if (!open && !get().units.some(isSeed) && held.size === 0) return;
    set((s) => ({
      preparedAttacks: s.preparedAttacks.filter((p) => p.casterId !== unitId),
      units: s.units.map((u) =>
        isSeed(u) || isTomb(u)
          ? { ...u, currentHp: 0 }
          : held.has(u.id)
            ? { ...u, activeEffects: u.activeEffects.filter((e) => e.type !== AuraType.Encased && e.type !== AuraType.Webbed) }
            : u,
      ),
    }));
  },

  syncBeacons: () => {
    const units = get().units;
    const next = syncBeaconLight(units);
    if (next !== units) set({ units: [...next] });
  },

  syncAuthority: () => {
    const { lay, lift } = authorityChanges(get().units);
    if (lay.length === 0 && lift.length === 0) return;
    const layIds = new Set(lay.map((u) => u.id));
    const liftIds = new Set(lift.map((u) => u.id));
    set((s) => {
      const captains = s.units.filter(
        (c) => c.currentHp > 0 && !c.objective && hasPassive(c, 'captainsAuthority'),
      );
      return {
        units: s.units.map((u) => {
          if (!layIds.has(u.id) && !liftIds.has(u.id)) return u;
          const lead = captains.find((c) => c.id !== u.id && c.isPlayer === u.isPlayer);
          const changed: CombatUnit = layIds.has(u.id)
            ? {
                ...u,
                activeEffects: [
                  ...u.activeEffects,
                  { type: AuraType.Authority, magnitude: BALANCE.AUTHORITY_BONUS, duration: -1, sourceUnitId: lead?.id },
                ],
              }
            : { ...u, activeEffects: u.activeEffects.filter((e) => e.type !== AuraType.Authority) };
          // Health keeps its share of the maximum: a unit at half stays at half
          const before = combatMaxHp(u);
          const after = combatMaxHp(changed);
          if (u.currentHp <= 0 || before === after) return changed;
          return {
            ...changed,
            currentHp: Math.min(after, Math.max(1, Math.round((u.currentHp * after) / before))),
          };
        }),
      };
    });
  },

  breakSoul: (unitId) => {
    const events: TickEvent[] = [];
    const body = unitById(get().units, unitId);
    if (!body || body.currentHp <= 0) return events;

    const spots = soulSpots(body, get().units, get().hazards);
    const hp = Math.max(1, Math.round(combatMaxHp(body) * BALANCE.SOUL_FRAGMENT_HP));
    const fragments = spots.map((position, i) => {
      const made = createObjective({
        kind: SOUL_FRAGMENT_KIND,
        owner: body,
        position,
        hp,
        defense: 0,
        // A phase change is not a reason for a soul to vanish
        shattersOnPhase: false,
      });
      return {
        ...made,
        nameIndex: i + 1,
        objective: { ...made.objective!, route: soulRoute(position, body.position), travelled: 0 },
      };
    });

    set((s) => ({
      // Nothing in flight survives the body lying down
      preparedAttacks: s.preparedAttacks.filter((p) => p.casterId !== unitId),
      units: s.units.map((u) =>
        u.id === unitId
          ? {
              ...u,
              activeEffects: [
                ...u.activeEffects.filter((e) => e.type !== AuraType.SoulSplit),
                { type: AuraType.SoulSplit, magnitude: 0, stacks: fragments.length, duration: -1, sourceUnitId: unitId },
              ],
            }
          : u,
      ),
    }));
    get().addUnits(fragments);
    events.push({
      text: fragments.length > 0 ? t('combatLog.float.splits', { count: fragments.length }) : t('combatLog.float.noSoul'),
      log: fragments.length > 0
        ? t('combatLog.tick.breaksSoul', { count: fragments.length })
        : t('combatLog.tick.noSoulBreak'),
      color: '#c8f0ff',
      unitId,
      vfx: soulVfx('nova', unitId, body.position, body.position),
    });
    // Each fragment leaves the body in turn, so the break can be followed
    fragments.forEach((f, i) => {
      events.push({
        text: t('combatLog.tick.tearsFree'),
        color: '#c8f0ff',
        unitId: f.id,
        vfx: soulVfx('bolt', unitId, body.position, f.position, 400 + i * 350),
      });
    });
    if (fragments.length === 0) events.push(...get().settleSoul(unitId));
    return events;
  },

  settleSoul: (ownerId) => {
    const events: TickEvent[] = [];
    const body = unitById(get().units, ownerId);
    const split = body?.activeEffects.find((e) => e.type === AuraType.SoulSplit);
    if (!body || body.currentHp <= 0 || !split) return events;

    const loose = fragmentsOf(body, get().units).length;
    if (loose > 0) {
      set((s) => ({
        units: s.units.map((u) =>
          u.id === ownerId
            ? { ...u, activeEffects: u.activeEffects.map((e) => (e === split ? { ...e, stacks: loose } : e)) }
            : u,
        ),
      }));
      return events;
    }

    // Every fragment is accounted for: destroyed, or home
    const arrived = Math.round(split.magnitude);
    set((s) => ({
      units: s.units.map((u) =>
        u.id === ownerId
          ? { ...u, activeEffects: u.activeEffects.filter((e) => e.type !== AuraType.SoulSplit) }
          : u,
      ),
    }));
    if (arrived <= 0) {
      events.push({ text: t('combatLog.float.goneForGood'), log: t('combatLog.tick.goneForGood'), color: '#c8f0ff', unitId: ownerId });
      // The save is spent, so this is an ordinary death down the ordinary funnel
      const result = get().damageUnit(ownerId, body.currentHp);
      events.push(...(result.deathEvents ?? []));
      return events;
    }
    const restored = Math.max(1, Math.round(combatMaxHp(body) * reformedFraction(arrived)));
    set((s) => ({
      units: s.units.map((u) =>
        u.id === ownerId ? { ...u, currentHp: Math.min(combatMaxHp(u), restored), untargetable: false } : u,
      ),
    }));
    events.push({
      text: t('combatLog.float.reforms', { count: arrived, max: BALANCE.SOUL_FRAGMENTS }),
      log: t('combatLog.tick.reforms', { count: arrived, max: BALANCE.SOUL_FRAGMENTS }),
      color: '#c8f0ff',
      unitId: ownerId,
      vfx: soulVfx('bloom', ownerId, body.position, body.position, 900),
    });
    return events;
  },

  issueChallenge: (jarlId, heroId) => {
    const jarl = unitById(get().units, jarlId);
    if (!jarl) return;
    set((s) => ({
      units: s.units.map((u) =>
        u.id === heroId
          ? {
              ...u,
              challenge: { jarlId, centre: { ...jarl.position }, radius: BALANCE.CHALLENGE_RADIUS },
              activeEffects: [
                ...u.activeEffects.filter((e) => e.type !== AuraType.Challenged),
                { type: AuraType.Challenged, magnitude: 0, duration: -1, sourceUnitId: jarlId },
              ],
            }
          : u,
      ),
    }));
  },

  dropChallenge: (heroId) => {
    set((s) => ({
      units: s.units.map((u) => {
        if (u.id !== heroId) return u;
        const { challenge: _gone, ...rest } = u;
        return { ...rest, activeEffects: u.activeEffects.filter((e) => e.type !== AuraType.Challenged) };
      }),
    }));
  },

  answerChallenge: (heroId, accept) => {
    const events: TickEvent[] = [];
    const hero = unitById(get().units, heroId);
    const open = hero?.challenge;
    if (!hero || !open) return events;
    const jarl = unitById(get().units, open.jarlId);
    get().dropChallenge(heroId);
    if (!jarl || jarl.currentHp <= 0) return events;

    if (accept) {
      const bond = { centre: open.centre, radius: open.radius, turns: 0 };
      set((s) => ({
        units: s.units.map((u) => {
          if (u.id === jarl.id) {
            return {
              ...u,
              duel: { ...bond, partnerId: hero.id },
              activeEffects: [
                ...u.activeEffects.filter((e) => e.type !== AuraType.Duel),
                { type: AuraType.Duel, magnitude: BALANCE.DUEL_DAMAGE_BONUS, duration: -1, sourceUnitId: jarl.id },
              ],
            };
          }
          if (u.id === hero.id) {
            return {
              ...u,
              duel: { ...bond, partnerId: jarl.id },
              activeEffects: [
                ...u.activeEffects.filter((e) => e.type !== AuraType.Duel),
                { type: AuraType.Duel, magnitude: 0, duration: -1, sourceUnitId: jarl.id },
              ],
            };
          }
          return u;
        }),
      }));
      events.push({ text: t('combatLog.float.accepts'), log: t('combatLog.tick.accepts'), color: '#bfe6f5', unitId: hero.id });
      return events;
    }

    // Refused: no circle, no mark, nobody denied an action. The Jarl alone is wrapped in a
    // Barrier worth a share of his maximum health. Replaced, never stacked.
    set((s) => ({
      units: s.units.map((u) =>
        u.id === jarl.id
          ? {
              ...u,
              activeEffects: [
                ...u.activeEffects.filter((e) => e.type !== AuraType.Barrier),
                {
                  type: AuraType.Barrier,
                  magnitude: Math.round(combatMaxHp(u) * BALANCE.REFUSE_BARRIER),
                  // The status ticks at the start of his own turn before he acts, so a
                  // duration one higher is exactly the turns the plan names
                  duration: BALANCE.REFUSE_BARRIER_TURNS + 1,
                  sourceUnitId: jarl.id,
                },
              ],
            }
          : u,
      ),
    }));
    events.push({ text: t('combatLog.float.refuses'), log: t('combatLog.tick.refuses'), color: '#bfe6f5', unitId: hero.id });
    events.push({ text: t('combatLog.float.encased'), log: t('combatLog.tick.encased'), color: '#9fd8ff', unitId: jarl.id });
    return events;
  },

  noteDuelTurn: (unitId) => {
    const events: TickEvent[] = [];
    const unit = unitById(get().units, unitId);
    if (!unit?.duel) return events;
    set((s) => ({
      units: s.units.map((u) => (u.id === unitId && u.duel ? { ...u, duel: { ...u.duel, turns: u.duel.turns + 1 } } : u)),
    }));
    if (!duelRunOut(get().units)) return events;
    // Both have ended their share: the circle dissolves, and the Jarl, the hero having lived,
    // kneels and loses his next regular turn
    const bound = get().units.filter((u) => u.duel);
    const isJarl = (u: CombatUnit) => (u.activeEffects.find((e) => e.type === AuraType.Duel)?.magnitude ?? 0) > 0;
    set((s) => ({
      units: s.units.map((u) => {
        if (!u.duel) return u;
        const { duel: _gone, ...rest } = u;
        const effects = u.activeEffects.filter((e) => e.type !== AuraType.Duel);
        return {
          ...rest,
          activeEffects: isJarl(u)
            ? [...effects, { type: AuraType.Kneeling, magnitude: 0, duration: 1, sourceUnitId: u.id }]
            : effects,
        };
      }),
    }));
    for (const u of bound) {
      events.push({
        text: t(isJarl(u) ? 'combatLog.float.kneels' : 'combatLog.float.duelWon'),
        log: t(isJarl(u) ? 'combatLog.tick.kneels' : 'combatLog.tick.survivesDuel'),
        color: '#bfe6f5',
        unitId: u.id,
      });
    }
    return events;
  },

  settleDuels: () => {
    const events: TickEvent[] = [];
    const units = get().units;
    const broken = units.some(
      (u) => u.duel && (u.currentHp <= 0 || !units.some((p) => p.id === u.duel!.partnerId && p.currentHp > 0)),
    );
    if (broken) {
      const survivor = units.find((u) => u.duel && u.currentHp > 0);
      set((s) => ({
        units: s.units.map((u) => {
          if (!u.duel) return u;
          const { duel: _gone, ...rest } = u;
          return { ...rest, activeEffects: u.activeEffects.filter((e) => e.type !== AuraType.Duel) };
        }),
      }));
      if (survivor) events.push({ text: t('combatLog.float.circleFades'), log: t('combatLog.tick.circleFades'), color: '#bfe6f5', unitId: survivor.id });
    }
    for (const hero of units) {
      const challenge = hero.challenge;
      if (!challenge) continue;
      const jarl = units.find((u) => u.id === challenge.jarlId);
      if (hero.currentHp <= 0 || !jarl || jarl.currentHp <= 0) get().dropChallenge(hero.id);
    }
    return events;
  },

  sealInTomb: (tomb, heroId) => {
    set((s) => ({
      units: [
        // First, so a lookup by hex finds the block and not the hero beneath it
        tomb,
        ...s.units.map((u) =>
          u.id === heroId
            ? {
                ...u,
                activeEffects: [
                  ...u.activeEffects.filter((e) => e.type !== AuraType.Encased),
                  { type: AuraType.Encased, magnitude: 0, duration: -1, sourceUnitId: tomb.objective?.ownerId },
                ],
              }
            : u,
        ),
      ],
    }));
  },

  releaseTomb: (tombId) => {
    const tomb = unitById(get().units, tombId);
    if (!tomb?.objective) return;
    const heroId = tomb.objective.linkedUnitId;
    set((s) => ({
      units: s.units.map((u) =>
        u.id === tombId
          ? { ...u, currentHp: 0 }
          : u.id === heroId
            ? { ...u, activeEffects: u.activeEffects.filter((e) => e.type !== AuraType.Encased) }
            : u,
      ),
    }));
  },

  spinWeb: (web, heroId) => {
    set((s) => ({
      units: [
        // First, so a lookup by hex finds the web and not the hero inside it
        web,
        ...s.units.map((u) =>
          u.id === heroId
            ? {
                ...u,
                activeEffects: [
                  ...u.activeEffects.filter((e) => e.type !== AuraType.Webbed),
                  { type: AuraType.Webbed, magnitude: 0, duration: -1, sourceUnitId: web.objective?.ownerId },
                ],
              }
            : u,
        ),
      ],
    }));
  },

  freeFromWeb: (webId, remove = false) => {
    const web = unitById(get().units, webId);
    const heroId = web?.objective?.linkedUnitId;
    if (!web || !heroId) return [];
    set((s) => ({
      units: s.units.map((u) =>
        u.id === webId && remove
          ? { ...u, currentHp: 0 }
          : u.id === heroId
            ? { ...u, activeEffects: u.activeEffects.filter((e) => e.type !== AuraType.Webbed) }
            : u,
      ),
    }));
    return [{ text: t('combatLog.float.freed'), log: t('combatLog.tick.cutFree'), color: '#f0ecd8', unitId: heroId }];
  },

  breakShard: (shardId, attackerId) => {
    const events: TickEvent[] = [];
    const shard = unitById(get().units, shardId);
    if (!shard?.objective) return events;
    const owner = unitById(get().units, shard.objective.ownerId);
    const cleansed = shardCleanses(shard.position, get().units).filter((u) => taintOf(u) > 0);
    for (const hero of cleansed) get().removeEffect(hero.id, AfflictionType.JadeTaint);
    const breaker = attackerId ? unitById(get().units, attackerId) : undefined;
    const bursts = !!owner && !!breaker && breaker.currentHp > 0 && !breaker.objective && breaker.isPlayer !== owner.isPlayer;
    events.push({
      text: t('combatLog.tick.breaks'),
      log: cleansed.length > 0
        ? t('combatLog.tick.breaksCleansing', { names: cleansed.map(unitName).join(', ') })
        : t('combatLog.tick.breaks'),
      color: '#3fe0a0',
      unitId: shard.id,
      vfx: {
        kind: 'nova', delivery: 'spell',
        casterId: owner?.id ?? shard.id,
        casterPos: shard.position,
        targetCoord: shard.position,
        hitUnitIds: bursts && breaker ? [breaker.id] : [],
        hitCoords: [shard.position, ...cleansed.map((u) => u.position)],
        color: '#3fe0a0',
      },
    });
    if (bursts && owner && breaker) {
      const amount = calculateDamage(owner, breaker, shardBurst);
      const result = get().damageUnit(breaker.id, amount, owner.id, { difficultyApplied: true, sourceUnitId: owner.id });
      events.push({ text: `-${result.hpLost}`, color: '#3fe0a0', unitId: breaker.id });
      events.push(...(result.deathEvents ?? []));
    }
    return events;
  },

  breakTomb: (tombId, attackerId) => {
    const events: TickEvent[] = [];
    const tomb = unitById(get().units, tombId);
    if (!tomb?.objective) return events;
    const heroId = tomb.objective.linkedUnitId;
    const owner = unitById(get().units, tomb.objective.ownerId);
    if (heroId) {
      set((s) => ({
        units: s.units.map((u) =>
          u.id === heroId ? { ...u, activeEffects: u.activeEffects.filter((e) => e.type !== AuraType.Encased) } : u,
        ),
      }));
      events.push({ text: t('combatLog.float.freed'), log: t('combatLog.tick.freedFromIce'), color: '#bfe6f5', unitId: heroId });
    }
    if (!owner || owner.currentHp <= 0) return events;

    // The block bursts outward into whatever of the party's enemies stands beside it
    const caught = shatterHexes(tomb.position)
      .map((h) => get().units.find((u) => u.currentHp > 0 && u.position.q === h.q && u.position.r === h.r))
      .filter((u): u is CombatUnit => !!u && u.isPlayer === tomb.isPlayer && !u.objective);
    events.push({
      text: t('combatLog.tick.shattersOutward'),
      color: '#7fe8ff',
      unitId: heroId ?? tomb.id,
      vfx: {
        kind: 'nova', delivery: 'spell',
        casterId: owner.id,
        casterPos: tomb.position,
        targetCoord: tomb.position,
        hitUnitIds: caught.map((u) => u.id),
        hitCoords: shatterHexes(tomb.position),
        color: '#7fe8ff',
      },
    });
    for (const target of caught) {
      const amount = calculateDamage(owner, target, tombCollapse);
      const result = get().damageUnit(target.id, amount, attackerId, { difficultyApplied: true, sourceUnitId: owner.id });
      events.push({ text: `-${result.hpLost}`, color: '#7fe8ff', unitId: target.id });
      events.push(...(result.deathEvents ?? []));
    }
    return events;
  },

  tickSoulFragments: (ownerId) => {
    const events: TickEvent[] = [];
    const body = unitById(get().units, ownerId);
    const split = body?.activeEffects.find((e) => e.type === AuraType.SoulSplit);
    if (!body || !split) return events;

    let arrived = Math.round(split.magnitude);
    for (const fragment of fragmentsOf(body, get().units)) {
      const travelled = (fragment.objective?.travelled ?? 0) + 1;
      const step = stepFragment(fragment, body, get().units, get().hazards);
      // Past its time, every fragment still loose is home whatever stood in its way
      const home = step.arrived || travelled >= BALANCE.SOUL_FRAGMENT_MAX_TURNS;
      // One after another, so the party can count which fragment went where
      const delayMs = events.length * 450;
      if (home) {
        get().removeObjective(fragment.id);
        arrived += 1;
        events.push({
          text: t('combatLog.float.soulHome'),
          log: t('combatLog.tick.soulHome'),
          color: '#c8f0ff',
          unitId: body.id,
          vfx: soulVfx('bolt', body.id, fragment.position, body.position, delayMs),
        });
        continue;
      }
      events.push({
        text: t('combatLog.tick.closesIn'),
        color: '#c8f0ff',
        unitId: fragment.id,
        vfx: soulVfx('bolt', body.id, fragment.position, step.position, delayMs),
      });
      set((s) => ({
        units: s.units.map((u) =>
          u.id === fragment.id
            ? {
                ...u,
                position: step.position,
                objective: u.objective && {
                  ...u.objective,
                  travelled,
                  route: soulRoute(step.position, body.position),
                },
              }
            : u,
        ),
      }));
    }
    set((s) => ({
      units: s.units.map((u) =>
        u.id === ownerId
          ? { ...u, activeEffects: u.activeEffects.map((e) => (e === split ? { ...e, magnitude: arrived } : e)) }
          : u,
      ),
    }));
    events.push(...get().settleSoul(ownerId));
    return events;
  },

  detonateDeathBurst: (unitId) => {
    const events: TickEvent[] = [];
    const corpse = unitById(get().units, unitId);
    if (!corpse || corpse.currentHp > 0 || corpse.deathBurstSpent) return events;

    // A summon's blast or an enemy's (the Frost Mote's shatter)
    const burst = deathBurstOf(corpse);
    if (!burst) return events;
    const color = burst.color ?? '#ff7a1e';

    // Latched *before* the blast, not after: the blast can kill another burster,
    // whose own detonation re-enters this action with this corpse still in the
    // list. Setting it first is what makes the recursion terminate.
    set((s) => ({
      units: s.units.map((u) => (u.id === unitId ? { ...u, deathBurstSpent: true } : u)),
    }));

    const caught = get().units.filter(
      (u) =>
        u.currentHp > 0 &&
        u.isPlayer !== corpse.isPlayer &&
        hexDistance(u.position, corpse.position) <= burst.radius,
    );

    // The explosion leads, once per death, whether or not it catches anybody: a
    // blast that only showed when it hit something read as the elemental simply
    // vanishing. Its footprint is the burst's own ground inside the arena, so the
    // picture covers exactly what the damage could reach, and the numbers follow.
    events.push({
      text: t('combatLog.tick.explodes'),
      color: burst.color ?? '#ff8a1e',
      unitId: corpse.id,
      vfx: {
        kind: 'explosion', delivery: 'spell',
        casterId: corpse.id,
        casterPos: corpse.position,
        targetCoord: corpse.position,
        hitUnitIds: caught.map((u) => u.id),
        hitCoords: arenaHexes().filter((h) => hexDistance(h, corpse.position) <= burst.radius),
        color,
        aftermath: burst.aftermath ?? 'embers',
      },
    });

    for (const victim of caught) {
      const { damage, crit } = deathBurstDamage(corpse, victim, burst);
      const nested = get().damageUnit(victim.id, damage, unitId, { difficultyApplied: true });
      events.push({
        text: crit ? `-${damage}!` : `-${damage}`,
        color: burst.color ?? '#ff8844',
        unitId: victim.id,
        sound: strikeIntent(victim, 'spell', strikeOutcome({ dodged: false, crit }, nested.hpLost), undefined, undefined, strikeDetail(undefined, nested)),
      });
      if (burst.effect) {
        get().applyEffect(victim.id, {
          type: burst.effect.type,
          magnitude: resolveEffectMagnitude(burst.effect.type, burst.effect.magnitude, corpse, burst.effect.scaling ?? burst.scaling),
          duration: burst.effect.duration,
          sourceUnitId: unitId,
        });
      }
      // A chain: this blast finished something that also goes off
      if (nested.deathEvents) events.push(...nested.deathEvents);
    }

    return events;
  },

  transformUnit: (unitId, templateId, casterLevel, strength) => {
    const template = findSummonTemplate(templateId);
    if (!template) return;
    const base = summonStatsFor(template, casterLevel, strength);
    const owner = unitById(get().units, unitId);
    const stats = owner?.isPlayer ? base : difficultyHp(base, undefined, owner?.sparedStrength);

    set((s) => ({
      units: s.units.map((u) =>
        u.id !== unitId
          ? u
          : {
              ...u,
              templateId,
              name: templateName(template.id),
              nameIndex: undefined,
              stats,
              currentHp: stats.maxHp,
              currentMana: 0,
              skills: template.skills,
              cooldowns: {},
              activeEffects: [],
              // The chain's last stage is permanent: nothing carried a lifetime
              // in, and nothing acquires one on the way up.
              summonTurnsLeft: undefined,
              deathBurstSpent: undefined,
              hpCeiling: undefined,
            },
      ),
    }));
  },

  embedBlades: (victimId, ownerId, count) => {
    const victim = unitById(get().units, victimId);
    if (!victim || count <= 0 || !takesBlades(victim)) return 0;
    const appliedAt = nextEffectSequence();
    // Buried Steel raises the owner's own cap
    const cap = bladesCapOf(unitById(get().units, ownerId));
    set((s) => ({
      units: s.units.map((u) => (u.id === victimId ? { ...u, activeEffects: withBlades(u.activeEffects, ownerId, count, appliedAt, cap) } : u)),
    }));
    return ownBlades(unitById(get().units, victimId) ?? victim, ownerId);
  },

  extractBlades: (victimId, ownerId) => {
    const victim = unitById(get().units, victimId);
    const held = victim ? ownBlades(victim, ownerId) : 0;
    if (held <= 0) return 0;
    set((s) => ({
      units: s.units.map((u) => (u.id === victimId ? { ...u, activeEffects: withoutBlades(u.activeEffects, ownerId) } : u)),
    }));
    return held;
  },

  payMeditation: (unitId) => {
    const unit = unitById(get().units, unitId);
    if (!unit || unit.currentHp <= 0) return [];
    const payout = meditationPayout(unit);
    const restored = get().healUnit(unitId, payout.heal, unitId);
    for (const effect of payout.effects) get().applyEffect(unitId, effect);
    const events: TickEvent[] = [];
    if (restored > 0) events.push({ text: `+${restored}`, color: FLOAT_COLOR.heal, unitId, sound: mendIntent(unit) });
    events.push({ text: t('combatLog.float.centred'), log: t('combatLog.tick.centred'), color: '#e8d8a8', unitId });
    // Lantern Breath (the Firefly): the heal also reaches whoever stands beside the Monk now
    for (const share of lanternBreathShares(unit, get().units, payout.heal)) {
      const ally = unitById(get().units, share.unitId);
      if (!ally) continue;
      const mended = get().healUnit(share.unitId, share.heal, unitId);
      for (const effect of share.effects) get().applyEffect(share.unitId, effect);
      if (mended > 0) events.push({ text: `+${mended}`, color: FLOAT_COLOR.heal, unitId: share.unitId, sound: mendIntent(ally) });
    }
    return events;
  },

  sweepBladeStorm: (unitId, storm) => {
    const events: TickEvent[] = [];
    const carrier = unitById(get().units, unitId);
    if (!carrier || carrier.currentHp <= 0) return events;

    const amount = Math.max(1, Math.round(storm.magnitude));
    // Within `BLADESTORM_RADIUS` — the blades are a ring on the carrier, not an area it
    // targets. That is what makes Bladestorm's free movement the skill: the
    // damage is a consequence of where the Skirmisher chooses to stand.
    const caught = get().units.filter(
      (u) =>
        u.currentHp > 0 &&
        u.isPlayer !== carrier.isPlayer &&
        hexDistance(u.position, carrier.position) <= BALANCE.BLADESTORM_RADIUS,
    );

    for (const victim of caught) {
      const taken = get().damageUnit(victim.id, amount, carrier.id);
      const { hpLost, absorbed } = taken;
      // One of the carrier's blades per enemy per bite, however many the ring
      // draws: a bite that reached the body (or its Barrier) lodges one
      if (hpLost + absorbed > 0) get().embedBlades(victim.id, carrier.id, 1);
      events.push({
        text: `-${hpLost}`, color: '#ff4a4a', unitId: victim.id,
        // The blades are the Skirmisher's own steel, turning round them.
        sound: strikeIntent(victim, 'blade', strikeOutcome({ dodged: false, crit: false }, hpLost), undefined, undefined, strikeDetail(undefined, taken)),
      });
    }

    // Same reasoning as the Martyr seal above — one blast at the carrier, not
    // one per body caught in it.
    if (events.length > 0) {
      events[0].vfx = {
        kind: 'nova', delivery: 'spell',
        casterId: carrier.id,
        casterPos: carrier.position,
        targetCoord: carrier.position,
        hitUnitIds: caught.map((u) => u.id),
        hitCoords: caught.map((u) => u.position),
        color: '#ff4a4a',
      };
    }
    return events;
  },

  spendAmbushCharge: (unitId) => {
    const unit = unitById(get().units, unitId);
    if (!unit || ambushCharges(unit) <= 0) return false;

    set((s) => ({
      units: s.units.map((u) => {
        if (u.id !== unitId) return u;
        const activeEffects = u.activeEffects
          .map((e) =>
            e.type === AuraType.Ambush ? { ...e, magnitude: e.magnitude - 1 } : e,
          )
          // Dropped the moment the last charge goes rather than waiting for the
          // duration: an Ambush at zero charges is a pip that says nothing and
          // a lock that would fire again on the next tick.
          .filter((e) => e.type !== AuraType.Ambush || e.magnitude > 0);
        return { ...u, activeEffects };
      }),
    }));
    return true;
  },

  /**
   * Splices new units into the fight mid-combat — summoning.
   *
   * `turnOrder` is speed-sorted at init, so a newcomer is inserted where its
   * speed puts it rather than appended. Two consequences worth being explicit
   * about: a summon faster than the caster still waits until the next round
   * (because `nextTurn` scans forward from the active unit), and this is only
   * safe at all because the active unit is tracked by id — with an index, an
   * insertion ahead of it would silently hand the turn to somebody else.
   */
  addUnits: (newUnits) => {
    if (newUnits.length === 0) return;

    set((s) => {
      const joined = [...s.units, ...newUnits.map((u) => ({ ...u, activeEffects: u.activeEffects ?? [] }))];
      // An arrival that brings no facing of its own (a wave, a summon) faces the enemy side
      const arriving = new Set(newUnits.filter((u) => u.facing === undefined).map((u) => u.id));
      const units = faceTheEnemy(joined, arriving);
      const speedOf = (id: string) => unitById(units, id)?.stats.speed ?? 0;
      const turnOrder = [...s.turnOrder];

      for (const unit of newUnits) {
        // An objective never acts, so it has no place in the order; nor does a
        // companion, which acts only through its summoner's casts
        if (unit.objective || unit.companion) continue;
        const at = turnOrder.findIndex((id) => speedOf(id) < unit.stats.speed);
        if (at === -1) turnOrder.push(unit.id);
        else turnOrder.splice(at, 0, unit.id);
      }

      return { units, turnOrder };
    });
    // Whoever arrives joins a living Captain's side under his word (and a Captain arriving
    // lays it on the side already standing)
    get().syncAuthority();
    // A Beacon arriving lights whoever stands round it; anyone arriving may stand in one's light
    get().syncBeacons();
  },

  /**
   * Counts down a timed summon at the start of its own turn.
   *
   * Expiry is dealt as "HP to zero" rather than removal from `units`, so it
   * flows through every path that already handles a death — turn skipping, the
   * victory check, the model unmounting. Removing the unit outright would need
   * all of those to learn a second way for a unit to leave the field.
   */
  tickSummonLifetime: (unitId) => {
    const unit = unitById(get().units, unitId);
    if (!unit || unit.summonTurnsLeft === undefined) return 'alive';

    const left = unit.summonTurnsLeft - 1;
    set((s) => ({
      units: s.units.map((u) =>
        u.id === unitId
          ? { ...u, summonTurnsLeft: left, ...(left <= 0 && { currentHp: 0 }) }
          : u,
      ),
    }));
    return left <= 0 ? 'expired' : 'alive';
  },

  nextTurn: () => {
    if (get().deployment) return;
    const { turnOrder, currentUnitId, units, bonusTurn } = get();
    if (turnOrder.length === 0) return;

    // The unit whose turn just ended has now had its chance to answer any
    // warning it was standing in. Marked here — the one funnel every turn
    // passes through, a stunned or skipped one included — rather than where an
    // action resolves, so a hero that does nothing still counts as having been
    // given the turn. The caster's own turn never answers its own warning.
    const outgoing = currentUnitId;
    // A countdown of several windows is counted in regular turns only: a hero's
    // speed-granted turn is a second action inside the same window, never a
    // second window, or one fast hero could run a Furnace Heart's clock out alone.
    const markResponded = (attacks: PreparedAttack[], bonus = false) =>
      outgoing
        ? attacks.map((p) => {
            if (p.casterId === outgoing || !p.responders.includes(outgoing)) return p;
            const answered = p.responded.filter((r) => r === outgoing).length;
            if (answered >= (p.windows ?? 1)) return p;
            // Within a single window the first turn that ends counts, bonus or not
            if (bonus && (p.windows ?? 1) > 1) return p;
            return { ...p, responded: [...p.responded, outgoing] };
          })
        : attacks;

    const finishing = outgoing ? unitById(units, outgoing) : undefined;

    // The Apex shape ends with a turn: the regular turn its clock shows as the last,
    // or whichever turn its third spell was used on. Reverted here, the one funnel
    // every turn passes through, so an End Turn or a stunned turn counts too; the
    // next `beginTurn` draws the change (`apexReverted`).
    if (finishing && finishing.currentHp > 0 && finishing.wildForm === 'apex') {
      const clock = finishing.activeEffects.find((e) => e.type === AuraType.Apex);
      const regularEnd = !bonusTurn.active && !get().furyExtra.active;
      if (apexSpentAll(finishing) || (regularEnd && (!clock || clock.duration <= 1))) {
        get().setWildForm(finishing.id, null);
        set((s) => ({ units: s.units.map((u) => (u.id === finishing.id ? { ...u, apexReverted: true } : u)) }));
      }
    }

    // The Troll Chieftain's Fury: a turn that has just ended is followed at once
    // by a second action of his, the same unit with the order unmoved. It is
    // granted after a regular turn *and* after a bonus turn, which is how the
    // two stack into four, and never after the extra itself.
    if (
      outgoing && finishing && finishing.currentHp > 0 && !get().furyExtra.active &&
      grantsExtraAction(finishing) &&
      !finishing.activeEffects.some((e) => e.type === AfflictionType.Stun || e.type === AfflictionType.Freeze)
    ) {
      set((s) => ({
        preparedAttacks: markResponded(s.preparedAttacks),
        furyExtra: { active: true },
        turnSerial: s.turnSerial + 1,
        phase: CombatPhase.EnemyTurn,
        selectedSkill: null,
        selectedMode: null,
        highlightedHexes: [],
        handingOver: false,
        units: s.units.map((u) =>
          u.id === outgoing ? { ...u, hasMoved: false, hasActed: false, turnStartPos: u.position, repositionCap: undefined, echoHold: undefined } : u,
        ),
      }));
      return;
    }

    // The Mantis's capstone turns: Threefold Scythe's two stages and the turn a
    // killing Mantis Execution earns, each taken at once after the turn that queued
    // it, the order unmoved, and before a speed turn the unit also has coming — the
    // three stages are three turns in a row. A bonus turn in every other respect
    // (`bonusTurn.active`: nothing ticks, nothing regenerates); a pending speed turn
    // is kept and taken after them. Thrown away if the Mantis is down.
    const lockedStage = finishing?.scytheStage;
    if (outgoing && finishing && ((finishing.mantisTurns?.length ?? 0) > 0 || lockedStage)) {
      const live = unitById(get().units, outgoing);
      const [turn, ...rest] = live && live.currentHp > 0 ? live.mantisTurns ?? [] : [];
      if (turn) {
        set((s) => ({
          preparedAttacks: markResponded(s.preparedAttacks, bonusTurn.active),
          bonusTurn: { pending: s.bonusTurn.pending, active: true, mantis: turn.cause },
          furyExtra: { active: false },
          turnSerial: s.turnSerial + 1,
          phase: finishing.isPlayer ? CombatPhase.PlayerSelect : CombatPhase.EnemyTurn,
          selectedSkill: null,
          selectedMode: null,
          highlightedHexes: [],
          handingOver: false,
          units: s.units.map((u) =>
            u.id === outgoing
              ? {
                  ...u, mantisTurns: rest.length > 0 ? rest : undefined,
                  scytheStage: turn.cause === 'scythe' ? turn.stage : undefined,
                  hasMoved: false, hasActed: false, turnStartPos: u.position, repositionCap: undefined, echoHold: undefined,
                }
              : u,
          ),
        }));
        return;
      }
      set((s) => ({ units: s.units.map((u) => (u.id === outgoing ? { ...u, mantisTurns: undefined, scytheStage: undefined } : u)) }));
    }

    // A granted bonus turn: the same unit acts again at once, without the
    // order moving. `active` is what stops it being rolled for a third time —
    // except after a Mantis capstone's turns, which ride the same flag and leave
    // the unit's own speed turn still to come.
    if (
      outgoing && finishing && finishing.currentHp > 0 &&
      bonusTurn.pending === outgoing && (!bonusTurn.active || !!bonusTurn.mantis)
    ) {
      set((s) => ({
        preparedAttacks: markResponded(s.preparedAttacks),
        bonusTurn: { pending: null, active: true },
        furyExtra: { active: false },
        turnSerial: s.turnSerial + 1,
        phase: finishing.isPlayer ? CombatPhase.PlayerSelect : CombatPhase.EnemyTurn,
        selectedSkill: null,
        selectedMode: null,
        highlightedHexes: [],
        handingOver: false,
        units: s.units.map((u) =>
          u.id === outgoing ? { ...u, hasMoved: false, hasActed: false, turnStartPos: u.position, repositionCap: undefined, echoHold: undefined } : u,
        ),
      }));
      return;
    }

    // Blood Howl's extra turns: queued by the Wolf's critical hits and taken one at a
    // time straight after the turn that earned them, the order unmoved. A bonus turn
    // in every other respect (`bonusTurn.active`: nothing ticks, no warning window is
    // spent). Thrown away if the Wolf is down, out of Wolf form or out of the Howl.
    if (outgoing && finishing && (finishing.howlQueued ?? 0) > 0) {
      const live = unitById(get().units, outgoing);
      const eligible = !!live && live.currentHp > 0 && live.wildForm === 'wolf'
        && live.activeEffects.some((e) => e.type === AuraType.BloodHowl);
      if (eligible) {
        set((s) => ({
          preparedAttacks: markResponded(s.preparedAttacks, bonusTurn.active),
          bonusTurn: { pending: null, active: true, howl: true },
          furyExtra: { active: false },
          turnSerial: s.turnSerial + 1,
          phase: finishing.isPlayer ? CombatPhase.PlayerSelect : CombatPhase.EnemyTurn,
          selectedSkill: null,
          selectedMode: null,
          highlightedHexes: [],
          handingOver: false,
          units: s.units.map((u) =>
            u.id === outgoing
              ? {
                  ...u, howlQueued: Math.max(0, (u.howlQueued ?? 1) - 1), howlGranted: (u.howlGranted ?? 0) + 1,
                  hasMoved: false, hasActed: false, turnStartPos: u.position, repositionCap: undefined,
                }
              : u,
          ),
        }));
        return;
      }
      set((s) => ({ units: s.units.map((u) => (u.id === outgoing ? { ...u, howlQueued: 0 } : u)) }));
    }

    if (finishing) set(s => ({ units: s.units.map(u => u.id === finishing.id
      ? { ...u, previousTurnStationary: !u.voluntaryMoved, voluntaryMoved: false } : u) }));

    // Undying's clock: a response turn is spent when the unit's whole turn is
    // over — here, where the order moves on, so a bonus turn played after it is
    // part of the same response rather than a second one. Only a turn that began
    // as a response counts (`turnStart` marks it); the window closes on the
    // second, and the HP it closes on is whatever the unit really has.
    const window = finishing?.activeEffects.find((e) => e.type === AuraType.UndyingWindow);
    if (finishing && window?.responding) {
      const left = window.magnitude - 1;
      set(s => ({ units: s.units.map(u => u.id !== finishing.id ? u : {
        ...u,
        activeEffects: left > 0
          ? u.activeEffects.map(e => e.type === AuraType.UndyingWindow ? { ...e, magnitude: left, responding: false } : e)
          : u.activeEffects.filter(e => e.type !== AuraType.UndyingWindow),
      }) }));
    }

    // The Rime Jarl's duel counts regular turns ended, a bonus turn never
    if (outgoing && finishing?.duel && !bonusTurn.active && !get().furyExtra.active) {
      get().noteDuelTurn(outgoing);
    }

    // A unit removed from turnOrder (or a null start) resolves to -1, so the
    // scan below starts from index 0 — the correct fallback either way.
    const currentIndex = currentUnitId ? turnOrder.indexOf(currentUnitId) : -1;

    // Find next alive unit
    let nextIndex = (currentIndex + 1) % turnOrder.length;
    let attempts = 0;
    while (attempts < turnOrder.length) {
      const unit = unitById(units, turnOrder[nextIndex]);
      if (unit && unit.currentHp > 0) break;
      nextIndex = (nextIndex + 1) % turnOrder.length;
      attempts++;
    }

    const nextId = turnOrder[nextIndex];
    const nextUnit = unitById(units, nextId);
    // Rolled as the regular turn begins, so the queue can show it before it
    // happens. A bonus turn never reaches here: it returned above.
    const granted = !!nextUnit && rollBonusTurn(nextUnit, units);
    // The Dark Mage's Mind Control: the hero whose turn this is acts for the Mage if its
    // control holds, and is freed if it does not (the Mage is down, or no other hero is)
    const control = nextUnit ? controlVerdict(nextUnit, units) : 'none';
    // Reset moved/acted for next unit
    set((s) => ({
      preparedAttacks: markResponded(s.preparedAttacks, bonusTurn.active || get().furyExtra.active),
      currentUnitId: nextId,
      bonusTurn: { pending: granted ? nextId : null, active: false },
      furyExtra: { active: false },
      turnSerial: s.turnSerial + 1,
      phase: nextUnit?.isPlayer && control !== 'seize' ? CombatPhase.PlayerSelect : CombatPhase.EnemyTurn,
      selectedSkill: null,
      selectedMode: null,
      highlightedHexes: [],
      handingOver: false,
      units: s.units.map((raw) => {
        // The turn that just ended was borrowed: the hero goes back to its own side
        const u = raw.seized && raw.id === outgoing ? { ...raw, isPlayer: true, seized: false } : raw;
        if (u.id !== nextId) return u;
        // A regular turn: Escape Route may carry the unit again this round
        const next = {
          ...u, hasMoved: false, hasActed: false, turnStartPos: u.position, repositionCap: undefined, escapeRouteSpent: false, venomTransferSpent: false, echoHold: undefined,
          // Blood Howl's allowance refills only here, on a regular turn
          howlQueued: 0, howlGranted: 0,
        };
        if (control === 'seize') return { ...next, isPlayer: false, seized: true };
        if (control === 'free') {
          return { ...next, activeEffects: next.activeEffects.filter((e) => e.type !== AfflictionType.MindControl) };
        }
        return next;
      }),
    }));
  },

  getCurrentUnit: () => {
    const { units, currentUnitId } = get();
    return currentUnitId ? unitById(units, currentUnitId) : undefined;
  },

  getUnitAt: (coord) => {
    // A carried Heart never answers for its hex: its carrier does (`objectives.struckBody`)
    return get().units.find(
      (u) => u.currentHp > 0 && u.position.q === coord.q && u.position.r === coord.r && !u.objective?.carrierId
    );
  },

  getAliveUnits: (isPlayer) => {
    return get().units.filter(
      (u) => u.currentHp > 0 && (isPlayer === undefined || u.isPlayer === isPlayer)
    );
  },

  reset: () =>
    set({
      deployment: null,
      deploymentHero: null,
      units: [],
      turnOrder: [],
      currentUnitId: null,
      phase: CombatPhase.PlayerSelect,
      selectedSkill: null,
      selectedMode: null,
      highlightedHexes: [],
      handingOver: false,
      fightStats: {},
      answerTally: {},
      preparedAttacks: [],
      hazards: [],
      turnSerial: 0,
      spentThisTurn: { serial: 0, keys: [] },
      bonusTurn: { pending: null, active: false },
      furyExtra: { active: false },
      waves: [],
      waveScale: { partyLevel: 1, powerScale: 1 },
      reactions: [],
      reactionEvents: [],
    }),
}));

/** The funnel (`damageFunnel`) acts on the store through this: it is imported by the store, so it cannot import it. */
const host: TickHost = {
  get: () => useCombatStore.getState(),
  set: (patch) => useCombatStore.setState(patch),
};
