import { roll } from '@/systems/combat/dice';
import {
  ActiveEffect,
  AfflictionType,
  ArenaHazard,
  AuraType,
  CombatUnit,
  HeroSkill,
  HeroStats,
  PassiveId,
  PassiveRank,
  PassiveTrigger,
  StatusEffectType,
} from "@/models/types";
import { damageTypeOf, magicDefenseOf } from '@/systems/combat/damageType';
import { BALANCE } from "@/data/balanceConstants";
import { burnPerStack, hasEffect, isSealed, isShatterable, isSuspended, resolveEffectMagnitudeWith, shatterBurst } from "@/systems/combat/statusEffects";
import { hexDistance, hexKey } from "@/utils/hexUtils";
import { combatMaxHp } from "@/systems/combat/forms";
import { BASIC_ATTACK_ID } from "@/systems/combat/basicAttack";
import { heatOf, heatStrength } from '@/systems/combat/dragonHeat';
import { BLOODSCENT_HEAL, CADENCE_ATTACK, KINDLE_MAGIC_STEP, KINDLE_MAX_STACKS, LAST_STAND_AT, LIFEBLOOM_SHARE, MOMENTUM_CRIT, RETALIATION_SHARE, SECOND_SKIN_HP, SHATTERSTEP_CHANCE, THUNDERHEAD_CHANCE, VERDANT_BLOOD_SHARE, WRATH_THRESHOLD, aftershockMultiplier, bloodRushDash, bracedCeiling, crumbleShred, deepColdTurns, detonationGroundMagnitude, detonationRounds, evasiveWeaveDodge, firemindPerStack, freshKillChi, killingEyeCrit, killingFrostPen, lastStandReduction, markAndMoveRange, meltwaterBarrier, oathWard, overloadBonus, rubbleRecoveryMultiplier, savageEdgeTick, secondSpringReduction, shellBreathChi, hardenedShellDashDamage, hardenedShellReach, steadyFlameChi, secondLightBarrier, shoulderShare, retributionStrike, heavyHandsDamage, plantedGuardDefense, seismicSenseMove, settleInPen, ECHO_STEALTH_MARK, shadowEchoCost, shadowEchoPerks, sharpenedSteelPen, shatterpointBonus, shieldedChallengeShare, slipstreamStep, sparkMagnitude, sparkRange, unyieldingDefense, vengeanceChance } from '@/systems/combat/passiveFormulas';
// Advanced (level 21–25): Monk
// Level 26: Arcanist
import { flyingShardsDamage, flyingShardsMagic } from '@/systems/combat/passiveFormulas';
import { reapingStrideStep, searingLightShred, shellWardBarrier } from '@/systems/combat/passiveFormulas';
import { reapersBreathChi, returnedBlowStrike, spilledLightShare } from '@/systems/combat/passiveFormulas';
// Advanced (level 21–25): Champion
import { rallyDefense, redMistCrit } from '@/systems/combat/passiveFormulas';
// Advanced (level 26): Druid
import { stonesAnswerMagic } from '@/systems/combat/passiveFormulas';
// Advanced (level 21–25): Hunter
import { eagleEyeCrit, intoTheDarkTurns, nextQuarryMinTurns, nextQuarryReach, openSeamsCrit, unseenBladeCrit } from '@/systems/combat/passiveFormulas';
import { ownBlades } from '@/systems/combat/blades';
import { unitName } from '@/data/templates/unitText';
import { formatDecimal, formatPercent, t, type MessageKey, type MessageParams } from '@/i18n';

/**
 * Always-on abilities that react to combat events.
 *
 * Two rules shape this file, and both exist to stop it becoming the largest
 * thing in the game:
 *
 * 1. **The vocabulary is capped.** Twelve mastery trees of bespoke passives is
 *    a bigger project than the rest of the overhaul combined. Uniqueness comes
 *    from *which* passives a tree combines, not from each tree inventing its
 *    own. Thirty-two definitions cover all twelve trees, and the cap is a
 *    *shape* rather than a number: nothing here may be a second passive that
 *    only differs by a magnitude, because the node levels already scale those.
 *    The four ways to be handed a free turn are the test of that — they differ
 *    by what they ask for, not by how much they give.
 * 2. **Resolution is pure.** `resolvePassives` returns a list of things to do;
 *    it never touches the store. That keeps every passive testable in the node
 *    environment, and keeps all the store writes in one applier where their
 *    ordering is visible.
 */

// ─── Outcomes ─────────────────────────────────────────────────────────────────

/**
 * A single consequence of a passive firing.
 *
 * A command list rather than direct writes: passives fire in the middle of
 * damage resolution, and letting each one call `set()` as it pleased is exactly
 * how `tickEffectsOnUnit` used to drop updates.
 */
export type PassiveOutcome =
  | {
      kind: "damage";
      unitId: string;
      amount: number;
      log: string;
      /** When set, the number is also floated over the unit in this colour. */
      color?: string;
    }
  | { kind: "heal"; unitId: string; amount: number; log: string }
  /** Chi (a Monk's mana) restored to the unit, floated over it (Fresh Kill). */
  | { kind: "chi"; unitId: string; amount: number; log: string }
  /**
   * `silent` lays a status the HUD already shows, with no float. An empty `log` writes
   * no line. `replace` clears the same status first; `color` tints the log line.
   */
  | { kind: "effect"; unitId: string; effect: ActiveEffect; log: string; silent?: boolean; replace?: boolean; color?: string }
  /** `onlyIds` brings back those skills alone (Into the Dark); absent is every running cooldown. */
  | { kind: "refundCooldown"; unitId: string; turns: number; log: string; onlyIds?: readonly string[] }
  /** The unit may act again this turn. */
  | { kind: "extraAction"; unitId: string; log: string }
  /**
   * Marks a once-per-turn allowance as used. `key` is stored against the current
   * turn and read back as `PassiveContext.turnSpent`, so a passive that may fire
   * "at most once per enemy per turn" owns the rule without owning any state.
   */
  | { kind: "spend"; key: string }
  /** Lays ground that remembers (replacing any hazard with the same id). */
  | { kind: "hazard"; hazard: ArenaHazard; log: string }
  /** The unit steps up to `range` hexes directly away from `fromId` (Escape Route). */
  | { kind: "retreat"; unitId: string; fromId: string; range: number; log: string }
  /**
   * The unit may take a free step of up to `range` hexes before the turn ends. The
   * caller owns the grant; `applyPassiveOutcomes` reports it as `reposition`.
   */
  | { kind: "reposition"; unitId: string; range: number; log: string; color: string }
  /** Marks a once-between-turns allowance on the unit as used (cleared when its turn begins). */
  | { kind: "spendAllowance"; unitId: string; allowance: "venomTransfer" }
  /** Mana — chi, for a Monk — back to the unit, up to its pool (Steady Flame). */
  | { kind: "mana"; unitId: string; amount: number; log: string };

/** The subset of triggers that `resolvePassives` actually dispatches on. */
export type PassiveTriggerArg = Exclude<PassiveTrigger, "statMod">;

export interface PassiveContext {
  self: CombatUnit;
  allUnits: CombatUnit[];
  /** The other party to the event — the target on a hit, the attacker on being hit. */
  other?: CombatUnit;
  /** Damage dealt or taken, or healing done, depending on the trigger. */
  amount?: number;
  /** HP the unit had *before* the event, for triggers that need to spot a kill. */
  hpBefore?: number;
  /**
   * Whether the blow that caused this was a critical hit.
   *
   * Absent means "not known", which resolves as *not* a crit — the safe
   * direction, since every passive reading it grants something extra.
   */
  crit?: boolean;
  /**
   * HP an `onHeal` actually put back, as against `amount`, which is what the
   * heal was worth before the ceiling and the receiver's own bonus.
   *
   * Absent means "not known", which resolves as nothing restored: Oath reads it,
   * and an unknown heal must not be able to grant a ward.
   */
  restored?: number;
  /**
   * Afflictions a cleanse removed, on an `onHeal` fired for one. Zero or absent
   * for an ordinary heal. Such an event has `amount: 0`, which is what keeps
   * the heal-reading passives (Lifebloom) quiet.
   */
  cleansed?: number;
  /**
   * The holder's effective Magic, on an `onHit` where a passive needs it (Flying
   * Shards): this module cannot reach `getCombatEffectiveStats`, so the caller reads it.
   */
  magic?: number;
  /**
   * The skill that landed the blow, on an `onHit`. Absent for an `onHit` with no
   * skill behind it (a reflect, a status): Stonecutter reads it to ask whether the
   * blow was earth.
   */
  skill?: HeroSkill;
  /**
   * Once-per-turn allowances already spent this turn (see the `spend` outcome).
   * Absent resolves as none spent.
   */
  turnSpent?: readonly string[];
  /**
   * `onCast` only: the enemies the cast struck, as they stood before the blows (a
   * dodged strike is not one). Absent resolves as none.
   */
  struck?: readonly CombatUnit[];
  /**
   * The Burn involved, on `onBurningDeath` (the dead enemy's Burn) and `onDetonate`
   * (the Burn the strike cashed in, as it stood before it was spent).
   */
  burn?: ActiveEffect;
  /** `onSkillResolved`: the cast restored HP to somebody. */
  restoredByCast?: boolean;
  /** `onSkillResolved`: the cast left an ally (the caster aside) with more health than it began with. */
  healedAlly?: boolean;
  /** `onSkillResolved`: the cast damaged an enemy. */
  damagedEnemy?: boolean;
  /** `onSkillResolved`: the cast was the turn's action, with no other grant already given. */
  spendsAction?: boolean;
  /** `onSkillResolved`: the caster could move at least one hex of `range` (the caller reads the board). */
  canStep?: (range: number) => boolean;
  /** The Poison a corpse carried when it died, on `onDeath`. */
  poison?: ActiveEffect;
  /** The Mark a corpse wore when it died, on `onDeath`. */
  mark?: ActiveEffect;
  /**
   * `onTurnStart` only: a warned ground attack from the other side covers the hex
   * this unit starts its turn on. Absent resolves as not threatened.
   */
  threatened?: boolean;
  /**
   * Whether the unit moved on the turn that just ended.
   *
   * `onTurnStart` only. Passed in rather than read off `self.hasMoved`, which
   * `beginTurnFlags` has already cleared by the time anything resolves — see
   * `beginTurn`.
   */
  movedLastTurn?: boolean;
  /**
   * Randomness, injectable for the same reason `effectLands`'s is: a proc
   * nobody can pin is a proc nobody can balance.
   *
   * Defaults to the combat `dice`, so neither execution path has to know that a
   * passive rolls — the two of them have drifted over exactly that kind of
   * detail before.
   */
  rng?: () => number;
}

// ─── Definitions ──────────────────────────────────────────────────────────────

/**
 * A passive's rules. Its words are not here: the name and description are read
 * through `passiveName` / `passiveDescription`, and `figures` writes through the
 * `passives` catalog, all in the current language when shown.
 */
interface PassiveDef {
  id: PassiveId;
  trigger: PassiveTrigger;
  /**
   * What this grants at a rung, as short player-facing phrases.
   *
   * **The mastery tree could not state a passive's numbers at all**, and said so
   * in a comment: "a passive's magnitude lives in its resolver rather than on the
   * node, so there is no figure to preview". It printed the flavour line and
   * "Stronger at each level." — so Spite offered "What you drag onto you swings
   * weaker" and nothing else, for a point that costs the same as a `+30 HP` node
   * spelling out its 30.
   *
   * Worse, the fallback was sometimes false. Follow-Through's resolver ignores
   * `rank` entirely, so the panel promised a scaling that does not exist. A
   * passive that returns the same phrases at every rung is now *detectable*
   * rather than assumed, which is the whole reason this returns a value instead
   * of a sentence.
   *
   * A list, and pre-rendered, because the caller pairs the rungs positionally to
   * draw `now → next`: entry *i* at one rank against entry *i* at another. So the
   * length must not vary with the rank — a figure that switches off is a phrase
   * that says so, not an entry that disappears.
   *
   * Optional only for the passives that genuinely grant no quantity — an
   * immunity is its own description. `masteryLabels.test.ts` fails any passive a
   * tree can reach that has neither a number in its description nor an entry
   * here, so the gap cannot come back quietly.
   */
  figures?: (rank: PassiveRank) => string[];
  /** Event passives. Absent on `statMod` and immunity passives. */
  resolve?: (ctx: PassiveContext, rank: PassiveRank) => PassiveOutcome[];
  /**
   * What the rule that reads this passive from **outside** this file resolves to
   * at a rung, for the passives that declare a rule rather than perform one —
   * Last Stand is read by `damageUnit`, and Zeal is read by the Smite resolver.
   *
   * Exists so the rank sweep in `nodeLevels.test.ts`, which resolves a passive
   * through its own definition, can still see that the rung moves *something*
   * for a passive with no `resolve` or `statMod`. Returns plain data.
   */
  resolved?: (rank: PassiveRank) => unknown;
  /**
   * Critical chance this passive adds against one particular target, in points.
   * Conditional on the target, so it cannot be a `statMod` (which sees only the
   * wearer) and must never be folded into the wearer's stats: the hero sheet's
   * Crit would then promise it against everything.
   */
  critAgainst?: (target: CombatUnit, rank: PassiveRank, attacker: CombatUnit) => number;
  /**
   * Penetration (percentage points of the defence that answers the hit) this passive
   * adds against one particular target and skill. Conditional on both, so it is not a
   * stat and is never folded into the wearer's sheet: the hero sheet's Armour Pen or
   * Magic Pen would promise it against everything. Each passive offers it only for the
   * hit type it pierces (Killing Frost: magic), and `damageCalc.penetration` sums it
   * with the matching stat under that stat's cap.
   */
  penAgainst?: (target: CombatUnit, skill: HeroSkill, rank: PassiveRank) => number;
  /** `statMod` passives only: what this adds to the unit's effective stats. */
  statMod?: (unit: CombatUnit, rank: PassiveRank) => Partial<HeroStats>;
  /** Statuses this passive refuses outright. */
  immuneTo?: StatusEffectType[];
  /** Whether the unit can be pushed or knocked back at all. */
  immuneToPush?: boolean;
  /** Whether afflictions this unit applies ignore `DebuffImmunity`. */
  piercesImmunity?: (unit: CombatUnit) => boolean;
  /**
   * Whether the unit is left at 1 HP instead of dying, once per battle.
   *
   * A predicate as well as a flag, because Second Skin is a save the *shape*
   * owns rather than the Druid: a plain `true` would catch a Druid standing
   * upright, which is the one state the passive is not about. All four saves
   * share one `UndyingSpent` marker, so a conditional one cannot be a second
   * life on top of somebody else's.
   */
  interceptsLethal?: boolean | ((unit: CombatUnit) => boolean);
  /**
   * What else happens at the moment the save fires.
   *
   * `interceptsLethal` alone leaves the unit standing at 1 HP, which is a
   * reprieve rather than a turn. These are the paths that make surviving mean
   * something — `other` is whoever landed the blow, which is why `damageUnit`
   * has to know who is attacking.
   */
  onLethalSave?: (ctx: PassiveContext, rank: PassiveRank) => PassiveOutcome[];
}

/**
 * The rank a passive resolves at when nothing says otherwise.
 *
 * Level 2 and scale 1, because the authored number in every definition below
 * *is* the level-2 value — the same convention `MasteryNode.maxLevel` documents.
 * So an enemy carrying a template passive, a summon, and every one of the thirty
 * test fixtures that builds a unit by hand resolve at the middle rung. Only a
 * hero with a tree behind them supplies `passiveRanks`.
 *
 * For the scaled passives that is also *exactly* what they granted before ranks
 * existed, since scale 1 multiplies nothing. The two authored ladders are the
 * exception and deliberately so: Wrath's middle rung is 12% where it shipped at
 * 8%, and Vengeance's is a 75% chance where it shipped at certainty. Wrath has
 * an enemy owner — the Corsair — so that retune reaches it too, which is the
 * intended direction rather than a side effect nobody looked at.
 */
const NEUTRAL_RANK: PassiveRank = { level: 2, scale: 1 };

/**
 * The rung this unit resolves that passive at.
 *
 * Exported so nothing has to restate the neutral convention — a caller writing
 * its own `{ level: 2, scale: 1 }` is a second copy of the rule that a change to
 * `LEVEL_SCALE` would leave behind.
 */
export const passiveRank = (unit: CombatUnit, id: PassiveId): PassiveRank =>
  unit.passiveRanks?.[id] ?? NEUTRAL_RANK;

// Every percentage here is a percentage of the pool being fought out of, not of
// the hero's own maximum — a bear at 120/150 is at full health, and reading the
// base 100 would have "below 30%" and "8% of max" both answering about somebody
// who is not currently standing there
const pct = (unit: CombatUnit, fraction: number) =>
  Math.max(1, Math.round(combatMaxHp(unit) * fraction));

const isBelow = (unit: CombatUnit, fraction: number) =>
  unit.currentHp <= combatMaxHp(unit) * fraction;

/** Whether this unit is currently holding somebody's attention. */
const isTaunting = (self: CombatUnit, allUnits: CombatUnit[]) =>
  allUnits.some((u) =>
    u.activeEffects.some(
      (e) =>
        e.type === AfflictionType.Taunt &&
        e.sourceUnitId === self.id &&
        u.currentHp > 0,
    ),
  );
/** Turns Nightfall takes off the cooldowns of a hidden Shadowblade. */
const NIGHTFALL_REFUND = 1;

/**
 * Who Shared Bloom's extra heal goes to when Lifebloom lands on `primary`: the
 * caster's living, wounded ally within `SHARED_BLOOM_REACH` hexes of the primary
 * with the lowest share of their effective maximum HP, the primary excluded.
 * Ties go to the nearer to the primary, then by coordinate, so the preview and
 * the cast always agree. Undefined when nobody qualifies.
 */
export function sharedBloomRecipient(
  caster: CombatUnit,
  primary: CombatUnit,
  units: CombatUnit[],
): CombatUnit | undefined {
  return units
    .filter((u) =>
      u.id !== primary.id && u.currentHp > 0 && !u.objective && !u.untargetable &&
      u.isPlayer === caster.isPlayer && u.currentHp < combatMaxHp(u) &&
      hexDistance(u.position, primary.position) <= BALANCE.SHARED_BLOOM_REACH)
    .sort((a, b) =>
      a.currentHp / combatMaxHp(a) - b.currentHp / combatMaxHp(b)
      || hexDistance(a.position, primary.position) - hexDistance(b.position, primary.position)
      || a.position.q - b.position.q || a.position.r - b.position.r)[0];
}

/** Growth charges this unit holds (Cycle of Life). */
export const growthCharges = (unit: CombatUnit): number =>
  Math.round(unit.activeEffects.find((e) => e.type === AuraType.Growth)?.magnitude ?? 0);

/**
 * Cycle of Life's payoff for this cast, or 0: the extra magic damage each enemy
 * it strikes takes, when the caster holds the passive and a full set of Growth
 * charges and the skill is a damaging spell (magic-scaled damage; a weapon swing
 * is not a spell). Read before the cast awards anything, so a cast can never earn
 * and spend its third charge at once.
 */
export function cycleOfLifeBonus(caster: CombatUnit, skill: HeroSkill, magic: number): number {
  if (!hasPassive(caster, 'cycleOfLife') || !skill.damage || skill.scaling !== 'magic') return 0;
  if (growthCharges(caster) < BALANCE.CYCLE_OF_LIFE_CHARGES) return 0;
  return Math.max(1, Math.round(magic * BALANCE.CYCLE_OF_LIFE_MAGIC * passiveRank(caster, 'cycleOfLife').scale));
}
/** The max health Regeneration returns each turn. */
const REGENERATION_SHARE = 0.03;
/** Last Breath's comeback: attack and lifesteal, both this share. */
const LAST_BREATH_SURGE = 0.25;
/** The max health Cryostasis closes over its owner as a shield. */
const CRYOSTASIS_BARRIER = 0.3;
/**
 * The least that shield may ever be worth, whatever the pool it is drawn from.
 *
 * Lifted out of the resolver, where it sat as a bare `20 * rank.scale`. Every
 * other magnitude in this file was hoisted up here on the stated rule that
 * `nodeLevels.test.ts` "cannot see a number it has no name for" — and a
 * rank-scaled literal is exactly the kind it cannot see. It binds only under
 * about seventy max health, which no owner of a tier-3 Arcanist node has, so it
 * is a floor for summons and the tuning harness rather than for a hero.
 */
const CRYOSTASIS_FLOOR = 20;

/** Whether a Chill laid from `from` onto `target` counts as cast from beyond immediate reach. */
const isFarChill = (from: CombatUnit, target: CombatUnit): boolean =>
  hexDistance(from.position, target.position) > BALANCE.DEEP_COLD_MIN_RANGE;

/**
 * The most wounded living ally by health fraction, the caster included; ties go to the
 * nearer one and then the id, so the same board always picks the same unit. An
 * objective is never a recipient.
 */
function mostWoundedAlly(caster: CombatUnit, units: CombatUnit[]): CombatUnit | undefined {
  const self = units.find((u) => u.id === caster.id) ?? caster;
  return units
    .filter((u) => u.currentHp > 0 && !u.objective && u.isPlayer === caster.isPlayer)
    .sort(
      (a, b) =>
        a.currentHp / combatMaxHp(a) - b.currentHp / combatMaxHp(b) ||
        hexDistance(a.position, self.position) - hexDistance(b.position, self.position) ||
        a.id.localeCompare(b.id),
    )[0];
}

/** The already-Shocked enemies in a cast's `struck` list: what Overload counts. */
const shockedStruck = (self: CombatUnit, struck: readonly CombatUnit[]): CombatUnit[] =>
  struck.filter(
    (u) => u.isPlayer !== self.isPlayer && !u.objective && hasEffect(u, AfflictionType.Shock),
  );

/**
 * Sharpened Steel's points for one blow of a cast, or 0: the holder's first
 * landed direct hit on each enemy that stood at full health when the cast began.
 * `opened` is the cast's own record of enemies already opened, so neither a
 * Flurry knife nor the extraction that follows replays it.
 */
export function sharpenedSteelFor(
  attacker: CombatUnit, target: CombatUnit, fullAtStart: boolean, opened: ReadonlySet<string>,
  skill: Pick<HeroSkill, 'id' | 'damageType'>,
): number {
  if (!hasPassive(attacker, 'sharpenedSteel') || !fullAtStart || opened.has(target.id)) return 0;
  // Steel pierces armour, never a ward: a magic hit gets nothing from it.
  if (damageTypeOf(skill) !== 'physical') return 0;
  return sharpenedSteelPen(passiveRank(attacker, 'sharpenedSteel'));
}

/**
 * Whether a cast is one Settle In is spent by: a ranged damaging cast. Its points only
 * pierce Physical Defense, so `penetrationAgainst` adds them to a physical hit alone.
 */
export const settleInApplies = (skill: HeroSkill): boolean =>
  !!skill.damage && skill.range >= 2;

/**
 * Bloodthirst as a Blood Rush holder casts it: a dash of `bloodRushDash` hexes to
 * the nearest free hex beside the target, then the ordinary strike. The reach is
 * the dash plus the hex it strikes across (Shield Avalanche's dash 4 / reach 5).
 * The landing rule is every dash's (`combatEngine.resolveSelfMove`): only the hex
 * it ends on must be free, Root refuses the movement, and aimed at an adjacent
 * enemy it is the plain strike. Carnage repeats the strike passes after the one
 * dash. Any other skill, or a unit without the passive, is returned untouched.
 */
export function withBloodRush(
  skill: HeroSkill,
  ranks: Partial<Record<PassiveId, PassiveRank>> | undefined,
): HeroSkill {
  const rank = ranks?.bloodRush;
  if (skill.id !== 'bloodthirst' || !rank) return skill;
  const dash = bloodRushDash(rank);
  return { ...skill, range: Math.max(skill.range, dash + 1), selfMove: { kind: 'dash', range: dash } };
}

/**
 * Hardened Shell's Iron Carapace (playtest 2026-10-28): its reach grows with the rung, and a
 * strike from beyond arm's length closes the gap first, as Blood Rush's Bloodthirst does. What
 * the strike then does depends on where it was struck from (`beetle.ironCarapaceAt`).
 */
export function withHardenedShell(
  skill: HeroSkill,
  ranks: Partial<Record<PassiveId, PassiveRank>> | undefined,
): HeroSkill {
  const rank = ranks?.hardenedShell;
  if (skill.id !== 'iron_carapace' || !rank) return skill;
  const reach = hardenedShellReach(rank);
  return { ...skill, range: Math.max(skill.range, reach), selfMove: { kind: 'dash', range: reach - 1 } };
}

/** Undying's comeback Attack, in points, for a unit at a rung. */
const undyingAttack = (unit: CombatUnit, rank: PassiveRank): number =>
  Math.max(BALANCE.UNDYING_SURGE_MIN, Math.round(unit.stats.attack * BALANCE.UNDYING_SURGE * rank.scale));

/** Whether the unit stands inside an Undying window, its HP held at 1 or above. */
const hasUndyingWindow = (unit: CombatUnit): boolean => hasEffect(unit, AuraType.UndyingWindow);

/**
 * The HP a unit is left on after losing `loss` from `hp`, honouring an Undying
 * window's floor of 1. The one rule every subtraction path shares — a blow, a
 * reflection, a damage-over-time tick, a Doom, a self-inflicted cost.
 */
export const flooredHp = (unit: CombatUnit, hp: number, loss: number): number => {
  const next = Math.max(0, hp - loss);
  return next < 1 && hp >= 1 && hasUndyingWindow(unit) ? 1 : next;
};

/**
 * An aura this unit re-grants on its own turn, kept alive one turn at a time.
 *
 * Two is the shortest duration that survives to be used: turn-start passives
 * fire *before* `tickEffectsOnUnit`, so a 1 is decremented to nothing between
 * being granted and the unit acting on it. A 2 leaves the aura up for exactly
 * the turn that granted it, and readable at the next turn's start — which is
 * what lets a passive read back what it granted last time and count with it.
 */
const SELF_GRANT_DURATION = 2;

/**
 * Whether a beast is wearing this shape, as opposed to a boss wearing a phase.
 *
 * Deliberately not `forms.hasForm`, which answers yes to both: the two share
 * one store write and `formStats` alone cannot tell a Bear from Aethelred's
 * second phase. Wildshape passives are about the animal.
 */
const isBeast = (unit: CombatUnit) => unit.wildForm != null;

/** A roll a caller may pin. See `PassiveContext.rng`. */
const rolls = (chance: number, rng: () => number = roll) => rng() < chance;

/**
 * A fraction as a whole-number percentage, for `figures` and nothing else.
 *
 * Every scaled magnitude below is authored as the level-2 value, so a rung is
 * 0.75 or 1.25 of it and lands on figures like 0.1125 — which reads as
 * `11.250000000000002%` if it reaches a panel unrounded. That is the same
 * failure `masteryLabels.test.ts` sweeps the modifier labels for, one table
 * over, so the rounding lives in one place here rather than twenty-three.
 *
 * Display only. Nothing a resolver grants goes through it: a figure that
 * re-derived its own number would be the second copy this whole member exists
 * to abolish.
 */
const asPct = (fraction: number) => formatPercent(fraction);

/** The skill Into the Dark brings forward. */
export const SHADOWSTEP_ID = 'shadowstep';

export const PASSIVE_DEFS: Record<PassiveId, PassiveDef> = {
  // ── onKill ──────────────────────────────────────────────────────────────────
  bloodscent: {
    id: "bloodscent",
    figures: (rank) => [t('passives.bloodscent.figure1', { a: asPct(BLOODSCENT_HEAL * rank.scale) })],
    trigger: "onKill",
    resolve: ({ self }, rank) => [
      {
        kind: "heal",
        unitId: self.id,
        amount: pct(self, BLOODSCENT_HEAL * rank.scale),
        log: passiveName("bloodscent"),
      },
    ],
  },

  frenzy: {
    id: "frenzy",
    // `resolve` takes no rank — a free turn has no fraction, the way
    // Follow-Through's does not. Stated flat so the panel can say so.
    figures: () => [t('passives.frenzy.figure1')],
    trigger: "onKill",
    resolve: ({ self }) => [
      { kind: "extraAction", unitId: self.id, log: passiveName("frenzy") },
    ],
  },

  // ── The Marksman's positional passives ─────────────────────────────────────

  /**
   * Mark and Move, the Marksman's Signature node. The passive only declares the
   * rule: `resolveSkillUse` grants the reposition after Mark Target resolves
   * (`markAndMoveRange`), and `getMovementRange` holds the move to it. A dodged
   * Mark Target still grants it; Root refuses it like any move.
   */
  markAndMove: {
    id: 'markAndMove',
    figures: (rank) => [t('passives.markAndMove.figure1', { count: markAndMoveRange(rank) })],
    trigger: 'statMod',
    resolved: (rank) => markAndMoveRange(rank),
  },

  /**
   * Escape Route: once per round, a close-range hit carries the Marksman away
   * from the attacker. Off its own turn, so the step is not a voluntary move: it
   * neither spends a Settle In charge nor drops Aimed Shot's aim. Root, Stun,
   * Freeze or sleep keep it in place, and the retreat is a push applied to
   * itself, so it stops at whatever blocks the way.
   */
  escapeRoute: {
    id: 'escapeRoute',
    figures: () => [
      t('passives.escapeRoute.figure1', { count: BALANCE.ESCAPE_ROUTE_RETREAT, b: formatDecimal(BALANCE.ESCAPE_ROUTE_REACH, 2) }),
      t('passives.escapeRoute.figure2'),
    ],
    trigger: 'onDamaged',
    resolve: ({ self, other, amount = 0 }) => {
      if (!other || amount <= 0 || other.isPlayer === self.isPlayer || self.currentHp <= 0) return [];
      if (self.escapeRouteSpent) return [];
      if (hexDistance(self.position, other.position) > BALANCE.ESCAPE_ROUTE_REACH) return [];
      const held = [AfflictionType.Root, AfflictionType.Stun, AfflictionType.Freeze];
      if (self.activeEffects.some((e) => held.includes(e.type as AfflictionType) || e.type === AuraType.Slumber)) return [];
      return [{ kind: 'retreat', unitId: self.id, fromId: other.id, range: BALANCE.ESCAPE_ROUTE_RETREAT, log: passiveName("escapeRoute") }];
    },
  },

  /**
   * Settle In: a turn ended without moving lays one `SettledAim` charge at the
   * next regular turn's start (`turnStart`), and the next ranged damaging cast
   * ignores this much Physical Defense and spends it (`resolveSkillUse`). Read
   * by `penetrationAgainst`; a Reaction's response does not use it.
   */
  settleIn: {
    id: 'settleIn',
    figures: (rank) => [
      t('passives.settleIn.figure1', { a: formatDecimal(settleInPen(rank), 2) }),
      t('passives.settleIn.figure2'),
    ],
    trigger: 'onTurnStartAura',
    // One charge, laid after a turn spent without moving; the caller clears last turn's first
    resolve: ({ self }, rank) => self.previousTurnStationary
      ? [{ kind: 'effect', unitId: self.id, log: '', silent: true,
          effect: { type: AuraType.SettledAim, duration: -1, magnitude: settleInPen(rank), sourceUnitId: self.id } }]
      : [],
    resolved: (rank) => settleInPen(rank),
  },

  // ── The Skirmisher's blades and footwork ─────────────────────────────────

  /**
   * Fan of Blades, the Skirmisher's Signature node: Blade Recall first throws a
   * damaging cone that embeds one blade in each enemy it hits, then pulls from
   * that same cone, in one cast. The throw is the rung's share of the skill's
   * authored damage (`strikeScales`); the passive only declares it.
   */
  fanOfBlades: {
    id: 'fanOfBlades',
    figures: (rank) => [t('passives.fanOfBlades.figure1', { a: asPct(rank.scale) })],
    trigger: 'statMod',
    resolved: (rank) => rank.scale,
  },

  /**
   * Slipstream: after a damaging cast that struck an enemy, a free step of
   * `slipstreamStep` hexes (once per regular turn, since the cast is the turn's
   * action). Granted by `resolveSkillUse` after the whole cast, Blade Recall's
   * extraction included, through the same reposition Mark and Move uses. Root
   * or no free hex leaves nothing to grant.
   */
  slipstream: {
    id: 'slipstream',
    figures: (rank) => [t('passives.slipstream.figure1', { count: slipstreamStep(rank) }), t('passives.slipstream.figure2')],
    trigger: 'onSkillResolved',
    // After the whole cast (Blade Recall's pull included), once per regular turn: the cast is
    // the turn's action. Root or no free hex grants nothing.
    resolve: ({ self, spendsAction, damagedEnemy, skill, canStep }, rank) => {
      if (!spendsAction || !damagedEnemy || skill?.freeAction || self.currentHp <= 0) return [];
      const step = slipstreamStep(rank);
      if (!canStep?.(step)) return [];
      return [{ kind: 'reposition', unitId: self.id, range: step, color: '#88ccff',
        log: t('combatLog.log.mayStep', { name: unitName(self), count: step }) }];
    },
    resolved: (rank) => slipstreamStep(rank),
  },

  /**
   * Sharpened Steel: the first landed direct hit of a cast on an enemy that was
   * at full health when the cast began ignores part of its Physical Defense
   * (`sharpenedSteelFor`). Never the extraction, never a second Flurry knife.
   */
  sharpenedSteel: {
    id: 'sharpenedSteel',
    figures: (rank) => [t('passives.sharpenedSteel.figure1', { a: formatDecimal(sharpenedSteelPen(rank), 2) })],
    trigger: 'statMod',
    resolved: (rank) => sharpenedSteelPen(rank),
  },

  /**
   * Shadow Echo, the Shadowblade's Signature node (2026-10 remaster): a
   * Shadowstep that moved leaves the caster's echo at the hex it left
   * (`AuraType.ShadowEcho`), and the caster may return to it for
   * `shadowEchoCost` mana without spending the action, before or after acting
   * (`shadowEcho.returnToEcho`). The price is flat; rank 2 makes the return grant
   * Stealth, rank 3 makes the first attack out of that Stealth a certain critical
   * hit (`critAgainst`, read off the Stealth's `ECHO_STEALTH_MARK`).
   */
  shadowEcho: {
    id: 'shadowEcho',
    figures: (rank) => {
      const perks = shadowEchoPerks(rank);
      return [
        t('passives.shadowEcho.figure1', { a: formatDecimal(shadowEchoCost(), 2) }),
        t('passives.shadowEcho.figure2'),
        t('passives.shadowEcho.figure3'),
        // Numbers at every rung (0 below the rank that adds them), so the preview pairs
        // "now → next" and shows what the point buys.
        t('passives.shadowEcho.figure4', { count: perks.stealth ? BALANCE.STEALTH_DURATION : 0 }),
        t('passives.shadowEcho.figure5', { a: perks.crit ? 100 : 0 }),
      ];
    },
    trigger: 'statMod',
    resolved: (rank) => shadowEchoPerks(rank),
    critAgainst: (_target, rank, attacker) =>
      shadowEchoPerks(rank).crit
      && attacker?.activeEffects.some((e) => e.type === AuraType.Stealth && e.magnitude === ECHO_STEALTH_MARK)
        ? 100 : 0,
  },

  /**
   * Venom Transfer (Rot's replacement): when an enemy carrying this unit's Poison
   * dies, one dose of it passes to the nearest unpoisoned enemy within
   * `VENOM_TRANSFER_RANGE`, at most once between two of the owner's regular turns.
   * The pile belongs to whoever laid its latest dose (`sourceUnitId`), so two
   * Shadowblades never both copy one death. Resolved in `combatStore.spreadVenom`,
   * down every path a unit can die by, like Spark.
   */
  venomTransfer: {
    id: 'venomTransfer',
    figures: () => [
      t('passives.venomTransfer.figure1', { count: BALANCE.VENOM_TRANSFER_RANGE }),
      t('passives.venomTransfer.figure2'),
      t('passives.venomTransfer.figure3'),
    ],
    trigger: 'onDeath',
    // One dose of the pile to the nearest unpoisoned ally of the corpse, once between turns
    resolve: ({ self, other: corpse, poison: pile, allUnits }) => {
      if (!corpse || !pile || self.venomTransferSpent) return [];
      const [next] = allUnits
        .filter((u) =>
          u.id !== corpse.id && u.currentHp > 0 && u.isPlayer === corpse.isPlayer && !u.objective
          && !u.activeEffects.some((e) => e.type === AfflictionType.Poison)
          && !isImmuneTo(u, AfflictionType.Poison)
          && hexDistance(u.position, corpse.position) <= BALANCE.VENOM_TRANSFER_RANGE)
        .sort((a, b) =>
          hexDistance(a.position, corpse.position) - hexDistance(b.position, corpse.position)
          || a.currentHp - b.currentHp || a.id.localeCompare(b.id));
      if (!next) return [];
      const dose = Math.max(1, Math.round(pile.magnitude / Math.max(1, pile.stacks ?? 1)));
      return [
        { kind: 'effect', unitId: next.id, log: '', silent: true,
          effect: { type: AfflictionType.Poison, magnitude: dose, duration: BALANCE.POISON_TICKS, sourceUnitId: self.id, stacks: 1 } },
        { kind: 'spendAllowance', unitId: self.id, allowance: 'venomTransfer' },
      ];
    },
  },

  /**
   * The third way to buy a free turn, and the one that pays out on a crowd.
   *
   * Frenzy is certainty and belongs to the Berserker, who has to be standing in
   * front of the thing it killed. Follow-Through wants a crit, which is a stat
   * the Marksman builds. This wants neither — it is a flat roll, and what makes
   * it a Stormcaller card rather than a worse Frenzy is *how many times it is
   * offered*: a Chain kills along a route, every kill on that route rolls
   * separately, and a bolt that walks a wounded line can hand back two turns
   * where Frenzy would have handed back one. A quarter is deliberately low
   * enough that it is never the plan and always the reason to aim at the line
   * rather than at the healthiest body on it.
   */
  thunderhead: {
    id: "thunderhead",
    figures: (rank) => [
      t('passives.thunderhead.figure1', { a: asPct(THUNDERHEAD_CHANCE * rank.scale) }),
    ],
    trigger: "onKill",
    resolve: ({ self, rng }, rank) =>
      rolls(THUNDERHEAD_CHANCE * rank.scale, rng)
        ? [{ kind: "extraAction", unitId: self.id, log: passiveName("thunderhead") }]
        : [],
  },

  // ── onHit ───────────────────────────────────────────────────────────────────
  /**
   * The Hydromancer's tempo, bought with ice rather than with a kill.
   *
   * Read off `other`, which both execution paths hand over as the target's
   * state *before* the damage was written — so the Freeze this asks about is
   * the one the blow is in the act of shattering. `damageUnit` strips Freeze on
   * any hit, so by the time the store is read again there is nothing left to
   * ask about. That is unchanged by the ice gaining a duration: a Freeze still
   * leaves on the blow that breaks it, and the pre-damage snapshot is still the
   * only place it can be seen. It is the same snapshot `shatterBurst` is
   * charged against, so the extra action and the extra damage cannot disagree
   * about whether the target was frozen.
   *
   * Frozen targets are the one thing the path reliably manufactures, which is
   * what makes this a loop rather than a lottery: chill, chill again to freeze,
   * break it, and sometimes go round again.
   */
  shatterstep: {
    id: "shatterstep",
    figures: (rank) => [
      t('passives.shatterstep.figure1', { a: asPct(SHATTERSTEP_CHANCE * rank.scale) }),
    ],
    trigger: "onHit",
    resolve: ({ self, other, rng }, rank) =>
      other &&
      isShatterable(other) &&
      rolls(SHATTERSTEP_CHANCE * rank.scale, rng)
        ? [{ kind: "extraAction", unitId: self.id, log: passiveName("shatterstep") }]
        : [],
  },

  /**
   * The Druid drinks from what the beast tears open.
   *
   * Gated on wearing a shape rather than on which skill was used, and the two
   * are the same question: `skillsForForm` is the only thing that puts a skill
   * on a beast's bar, and everything it puts there is either a form skill or a
   * shift, which deals no damage. `PassiveContext` carries no skill, and adding
   * one would be a field three systems have to fill in to answer a question the
   * silhouette already answers.
   */
  verdantBlood: {
    id: "verdantBlood",
    /**
     * **The resolver used to ignore its rank, and that was a bug rather than a
     * design.**
     *
     * `resolve` destructured `{ self, amount }` and never took the second
     * argument, so a Druid holding this at 3 of 3 drank exactly what they drank
     * at 1 of 3 — while `VERDANT_BLOOD_SHARE` sat in the block documented as
     * "every magnitude a node level scales". Two of the three rungs bought
     * nothing at all, silently: the node lit up, the heal happened, only the
     * amount never moved.
     *
     * It surfaced the moment the panel was asked to *state* the figure, which is
     * the whole argument for making passives report their numbers — a magnitude
     * nothing renders is a magnitude nothing checks.
     */
    figures: (rank) => [
      t('passives.verdantBlood.figure1', { a: asPct(VERDANT_BLOOD_SHARE * rank.scale) }),
    ],
    trigger: "onHit",
    resolve: ({ self, amount = 0 }, rank) =>
      isBeast(self) && amount > 0
        ? [
            {
              kind: "heal",
              unitId: self.id,
              amount: Math.max(1, Math.round(amount * VERDANT_BLOOD_SHARE * rank.scale)),
              log: passiveName("verdantBlood"),
            },
          ]
        : [],
  },

  // ── onDamaged ───────────────────────────────────────────────────────────────
  retaliation: {
    id: "retaliation",
    figures: (rank) => [t('passives.retaliation.figure1', { a: asPct(RETALIATION_SHARE * rank.scale) })],
    trigger: "onDamaged",
    resolve: ({ other, amount = 0 }, rank) =>
      other && amount > 0
        ? [
            {
              kind: "damage",
              unitId: other.id,
              amount: Math.max(1, Math.round(amount * RETALIATION_SHARE * rank.scale)),
              log: passiveName("retaliation"),
            },
          ]
        : [],
  },

  braced: {
    id: "braced",
    // Two figures because the passive is genuinely two numbers, and only one of
    // them moves — the *ceiling*, not the step. See `BALANCE.BRACED_STEP` for
    // why round trip: two is too small an integer for a 0.75 factor to change,
    // so a step that scaled was a rung that bought nothing.
    figures: (rank) => [
      t('passives.braced.figure1', { a: formatDecimal(BALANCE.BRACED_STEP, 2) }),
      t('passives.braced.figure2', { a: formatDecimal(bracedCeiling(rank), 2) }),
    ],
    trigger: "onDamaged",
    // The rank moves the *ceiling* and never the step. How deep a Bulwark can
    // dig is what a point buys; how fast they get there is the same at every
    // rung, because the step is two whole points of defence and there is no
    // fraction of that a rung could spend. Scaling both would compound — a
    // bigger step toward a higher cap is 1.56× the shipped node, not the 1.25×
    // a rung is priced at.
    resolve: ({ self, allUnits }, rank) => {
      if (!isTaunting(self, allUnits)) return [];
      const ceiling = bracedCeiling(rank);
      const current =
        self.activeEffects.find((e) => e.type === AuraType.DefenseBuff)
          ?.magnitude ?? 0;
      if (current >= ceiling) return [];
      return [
        {
          kind: "effect",
          unitId: self.id,
          // Applied as an absolute magnitude rather than an increment: the store
          // merges same-type effects by taking the stronger, so sending "+2"
          // would be swallowed by the stack already in place.
          effect: {
            type: AuraType.DefenseBuff,
            magnitude: Math.min(ceiling, current + BALANCE.BRACED_STEP),
            duration: -1,
          },
          log: passiveName("braced"),
        },
      ];
    },
  },

  /**
   * The Bulwark's Signature node (remaster, 2026-10): the free Taunt strike also
   * shields the Bulwark for the answer it invited. Fires on the hit, not on the
   * Taunt, so a boss or an immune enemy still pays it out; a dodge does not.
   */
  shieldedChallenge: {
    id: "shieldedChallenge",
    figures: (rank) => [
      t('passives.shieldedChallenge.figure1', { a: asPct(shieldedChallengeShare(rank)), count: BALANCE.SHIELDED_CHALLENGE_DURATION }),
    ],
    trigger: "onHit",
    resolved: (rank) => shieldedChallengeShare(rank),
    // A fraction of Attack goes through the shared magnitude path, so the Bulwark's
    // shield bonuses (Anchored, gear) apply; the store merges it with a Barrier
    // already up by keeping the larger, which is the refresh-never-stack rule.
    resolve: ({ self, skill }, rank) =>
      skill?.id === "provoking_strike"
        ? [
            {
              kind: "effect",
              unitId: self.id,
              effect: {
                type: AuraType.Barrier,
                magnitude: resolveEffectMagnitudeWith(
                  self.stats, AuraType.Barrier, shieldedChallengeShare(rank), self,
                ),
                duration: BALANCE.SHIELDED_CHALLENGE_DURATION,
                sourceUnitId: self.id,
              },
              log: passiveName("shieldedChallenge"),
            },
          ]
        : [],
  },

  /**
   * The Stoneshaper's reward for pinning something and then breaking the ground
   * under it: an earth strike that lands on a **Rooted** enemy cracks both
   * Physical and Magic Defense for a short while.
   *
   * Reads the target as it stood *before* the blow (`applyOnHitStatuses` hands it
   * the pre-damage snapshot), so the Root a skill lays in the same cast does not
   * count for that cast's own strike: Grasping Earth pins, the next earth skill
   * pays. The rung scales the shred and nothing else.
   */
  sacredRhythm: {
    id: 'sacredRhythm',
    figures: () => [t('passives.sacredRhythm.figure1'), t('passives.sacredRhythm.figure2')],
    trigger: 'onHeal',
    resolve: ({ self, restored }) => (restored ?? 0) > 0 ? [{ kind: 'effect', unitId: self.id,
      effect: { type: AuraType.SacredRhythm, magnitude: Math.round(self.stats.magic * BALANCE.SACRED_RHYTHM_MAGIC), duration: 3, sourceUnitId: self.id }, log: passiveName("sacredRhythm") }] : [],
  },
  groundedFocus: {
    id: 'groundedFocus',
    resolved: rank => BALANCE.GROUNDED_FOCUS[Math.min(2, rank.level - 1)],
    figures: rank => [t('passives.groundedFocus.figure1', { a: formatDecimal(Math.round(BALANCE.GROUNDED_FOCUS[Math.min(2, rank.level - 1)] * 100), 2) }), t('passives.groundedFocus.figure2')],
    trigger: 'onTurnStartAura',
    resolve: ({ self }, rank) => self.previousTurnStationary
      ? [{ kind: 'effect', unitId: self.id, log: '', silent: true,
          effect: { type: AuraType.GroundedFocus, duration: 1, magnitude: BALANCE.GROUNDED_FOCUS[Math.min(2, rank.level - 1)], sourceUnitId: self.id } }]
      : [],
  },
  /**
   * The Stoneshaper's control payoff, replacing Stonecutter (remaster, 2026-10).
   * Worked outside this file: `applyEffect` stamps the shred onto a Stun or Root
   * this unit lands on an enemy (`ActiveEffect.crumble`), and
   * `getCombatEffectiveStats` subtracts it while that control stands. No earth hit
   * is needed, and the shred cannot outlive or be resisted apart from its control.
   */
  crumble: {
    id: "crumble",
    figures: (rank) => [
      t('passives.crumble.figure1', { a: formatDecimal(crumbleShred(rank), 2) }),
      t('passives.crumble.figure2'),
    ],
    trigger: "statMod",
    resolved: (rank) => crumbleShred(rank),
  },

  /**
   * Tremor's Signature node. Worked by `skillResolution` (which marks the
   * footprint) and `systems/combat/aftershock` (which erupts it at the start of
   * the owner's next regular turn); this entry states the figures.
   */
  aftershock: {
    id: "aftershock",
    figures: (rank) => [
      t('passives.aftershock.figure1', { a: asPct(aftershockMultiplier(rank)) }),
      t('passives.aftershock.figure2'),
    ],
    trigger: "statMod",
    resolved: (rank) => aftershockMultiplier(rank),
  },

  /**
   * Worked by `combatStore.damageUnit`, the one funnel a Barrier is spent in: when
   * an enemy's damage empties a Barrier this unit supplied, the recipient is healed.
   * This entry states the figures.
   */
  rubbleRecovery: {
    id: "rubbleRecovery",
    figures: (rank) => [
      t('passives.rubbleRecovery.figure1', { a: asPct(rubbleRecoveryMultiplier(rank)) }),
      t('passives.rubbleRecovery.figure2'),
    ],
    trigger: "statMod",
    resolved: (rank) => rubbleRecoveryMultiplier(rank),
  },

  /**
   * Stone's Answer: the enemy that breaks a Barrier this Stoneshaper gave takes a
   * physical blow built from Magic and is Rooted. Worked by the store's
   * `answerFromStone`, on the same funnel event as Rubble Recovery.
   */
  stonesAnswer: {
    id: "stonesAnswer",
    figures: (rank) => [
      t('passives.stonesAnswer.figure1', { a: asPct(stonesAnswerMagic(rank)) }),
      t('passives.stonesAnswer.figure2'),
    ],
    trigger: "statMod",
    resolved: (rank) => stonesAnswerMagic(rank),
  },

  /**
   * Physical and Magic Defense while the Stoneshaper has a Barrier up, itself or
   * granted. A rule about standing state rather than an event, so `statMod`: it
   * is on the instant a Barrier lands and off the moment the last point of it is
   * spent, and a spent Barrier is removed from `activeEffects`, which is the
   * only thing it reads.
   */
  unyielding: {
    id: "unyielding",
    figures: (rank) => [
      t('passives.unyielding.figure1', { a: formatDecimal(unyieldingDefense(rank), 2) }),
      t('passives.unyielding.figure2'),
    ],
    trigger: "statMod",
    resolved: (rank) => unyieldingDefense(rank),
    statMod: (unit, rank) =>
      unit.activeEffects.some((e) => e.type === AuraType.Barrier && e.magnitude > 0)
        ? { defense: unyieldingDefense(rank), magicDefense: unyieldingDefense(rank) }
        : {},
  },

  /**
   * Feeling a warned ground attack through the feet: a turn that starts on a hex
   * a marked attack from the other side covers gets extra movement, so the
   * Stoneshaper can step out of it. Laid at the start of the turn (before the
   * effect tick, so a duration of 2 is exactly "this turn") and gone by the next.
   * Nothing happens for an unmarked turn or an attack on somebody else's hex.
   */
  seismicSense: {
    id: "seismicSense",
    figures: (rank) => [
      t('passives.seismicSense.figure1', { a: formatDecimal(seismicSenseMove(rank), 2) }),
      t('passives.seismicSense.figure2'),
    ],
    trigger: "onTurnStart",
    resolved: (rank) => seismicSenseMove(rank),
    resolve: ({ self, threatened }, rank) =>
      threatened
        ? [
            {
              kind: "effect",
              unitId: self.id,
              effect: {
                type: AuraType.SeismicStep,
                magnitude: seismicSenseMove(rank),
                duration: 2,
                sourceUnitId: self.id,
              },
              log: t('combatLog.log.seismicSense', { source: passiveName('seismicSense') }),
            },
          ]
        : [],
  },

  /**
   * The Berserker's reward for a critical hit on something already Bleeding: the
   * wound bleeds again at once, one extra tick of that Bleed's own damage.
   *
   * Damage only, and deliberately not a recovery route: it goes through
   * `damageUnit` like a DoT tick (a Barrier eats it), restores nothing to anyone,
   * and leaves the Bleed's clock alone. **Once per enemy per turn**, kept by the
   * `spend` outcome rather than by a counter of its own, so a doubled Carnage
   * swing or a Whirlwind pass that crits several times on one enemy ticks it once,
   * and the next turn starts fresh. The enemy must have been Bleeding when the
   * blow landed (the pre-strike snapshot), so the Bleed a skill lays in the same
   * cast does not count for that cast's own crit, and a corpse is not ticked.
   */
  savageEdge: {
    id: "savageEdge",
    figures: (rank) => [
      t('passives.savageEdge.figure1', { a: formatDecimal(Math.round(BALANCE.SAVAGE_EDGE_TICK * rank.scale * 100), 2) }),
      t('passives.savageEdge.figure2'),
    ],
    trigger: "onHit",
    resolved: (rank) => Math.round(BALANCE.SAVAGE_EDGE_TICK * rank.scale * 100),
    resolve: ({ self, other, crit, allUnits, turnSpent }, rank) => {
      if (!crit || !other) return [];
      const bleed = other.activeEffects.find((e) => e.type === AfflictionType.Bleed);
      if (!bleed) return [];
      const live = allUnits.find((u) => u.id === other.id);
      if (!live || live.currentHp <= 0) return [];
      const key = `savageEdge:${self.id}:${other.id}`;
      if (turnSpent?.includes(key)) return [];
      return [
        {
          kind: "damage",
          unitId: other.id,
          amount: savageEdgeTick(bleed, rank),
          color: "#cc4444",
          log: t('combatLog.log.savageEdge', { source: passiveName('savageEdge') }),
        },
        { kind: "spend", key },
      ];
    },
  },

  /**
   * Critical chance against Bleeding enemies, and only against them. Read per
   * target by `critBonusAgainst`; it is not a stat, so the hero sheet's Crit stays
   * the honest figure for an enemy that is not bleeding.
   */
  killingEye: {
    id: "killingEye",
    figures: (rank) => [t('passives.killingEye.figure1', { a: formatDecimal(killingEyeCrit(rank), 2) }), t('passives.killingEye.figure2')],
    trigger: "statMod",
    resolved: (rank) => killingEyeCrit(rank),
    critAgainst: (target, rank) =>
      hasEffect(target, AfflictionType.Bleed) ? killingEyeCrit(rank) : 0,
  },

  /**
   * The Mantis's setup: its Basic Attack leaves the enemy Bleeding, the wound
   * Twin Reap's second cut reaps (the private project notes, "### Mantis"). Read
   * off the blow's own skill, so only the Basic Attack lays it — a dual-wield swing
   * lays it from each hand that lands, and Bleed refreshes rather than stacks, so
   * that is one Bleed. Scaled from Attack like every authored Bleed, through the
   * unit's own stats: a passive cannot reach the combat-effective ones without a
   * cycle, so a buff the Mantis is under does not reach the wound.
   */
  bleedingBlades: {
    id: "bleedingBlades",
    figures: (rank) => [
      t('passives.bleedingBlades.figure1', { a: formatDecimal(BALANCE.MANTIS.BLEED * rank.scale, 2, { fixed: true }), count: BALANCE.MANTIS.BLEED_TURNS }),
    ],
    trigger: "onHit",
    resolved: (rank) => BALANCE.MANTIS.BLEED * rank.scale,
    resolve: ({ self, other, amount = 0, skill, allUnits }, rank) => {
      if (!other || amount <= 0 || skill?.id !== BASIC_ATTACK_ID) return [];
      // A killing swing opens no wound: the corpse is read live, not off the snapshot
      const live = allUnits.find((u) => u.id === other.id);
      if (!live || live.currentHp <= 0) return [];
      return [
        {
          kind: "effect",
          unitId: other.id,
          effect: {
            type: AfflictionType.Bleed,
            magnitude: resolveEffectMagnitudeWith(
              self.stats, AfflictionType.Bleed, BALANCE.MANTIS.BLEED * rank.scale, self,
            ),
            duration: BALANCE.MANTIS.BLEED_TURNS,
            sourceUnitId: self.id,
          },
          log: passiveName("bleedingBlades"),
          color: "#cc4444",
        },
      ];
    },
  },

  /**
   * Twin Reap remembers its last prey: each reap on the same enemy as the last adds
   * a step to its cuts, up to `MOMENTUM_MAX_STACKS`. A declared rule — the resolver
   * reads it through `systems/combat/mantis` — so this entry states the figure and
   * lets the rank sweep see that the rung moves it.
   */
  reapingMomentum: {
    id: "reapingMomentum",
    figures: (rank) => [
      t('passives.reapingMomentum.figure1', { a: asPct(BALANCE.MANTIS.MOMENTUM_STEP * rank.scale), b: formatDecimal(BALANCE.MANTIS.MOMENTUM_MAX_STACKS, 2) }),
    ],
    trigger: "statMod",
    resolved: (rank) => BALANCE.MANTIS.MOMENTUM_STEP * rank.scale,
  },

  /**
   * Meditate's payout also sharpens the eye: critical chance for the turn it pays
   * out, beside its Attack and Magic. Read by `meditate.meditationPayout`.
   */
  predatorsBreath: {
    id: "predatorsBreath",
    figures: (rank) => [
      t('passives.predatorsBreath.figure1', { a: formatDecimal(Math.round(BALANCE.MANTIS.PREDATORS_BREATH_CRIT * rank.scale), 2) }),
    ],
    trigger: "statMod",
    resolved: (rank) => Math.round(BALANCE.MANTIS.PREDATORS_BREATH_CRIT * rank.scale),
  },

  /**
   * The Mantis's side tree A starter, one rank: the Bleed Twin Reap's second cut
   * removes pays what it had left, at once. A declared rule — the resolver reads
   * it through `mantis.harvestDamage` as the reap lands — so the figure is flat.
   */
  bleedHarvest: {
    id: "bleedHarvest",
    figures: () => [t('passives.bleedHarvest.figure1')],
    trigger: "statMod",
  },

  /** Killing an enemy restores chi. */
  freshKill: {
    id: "freshKill",
    figures: (rank) => [t('passives.freshKill.figure1', { a: formatDecimal(freshKillChi(rank), 2) })],
    trigger: "onKill",
    resolved: (rank) => freshKillChi(rank),
    resolve: ({ self }, rank) => [
      { kind: "chi", unitId: self.id, amount: freshKillChi(rank), log: passiveName("freshKill") },
    ],
  },

  /**
   * Dodge on a turn the Mantis moved: an Evasive aura laid by the move, held
   * through the enemies' turns and gone at the Mantis's next turn (the tick at
   * turn start), where a move lays it again.
   */
  evasiveWeave: {
    id: "evasiveWeave",
    figures: (rank) => [t('passives.evasiveWeave.figure1', { a: formatDecimal(evasiveWeaveDodge(rank), 2) })],
    trigger: "onMove",
    resolved: (rank) => evasiveWeaveDodge(rank),
    resolve: ({ self }, rank) => [
      {
        kind: "effect",
        unitId: self.id,
        effect: { type: AuraType.Evasive, magnitude: evasiveWeaveDodge(rank), duration: 1, sourceUnitId: self.id },
        replace: true,
        silent: true,
        log: "",
      },
    ],
  },

  /**
   * Cinder Burst for less when it spends a deep pile of Burn. A rule about price,
   * read by `manaCostFor` for both the preview and the payment so the two cannot
   * disagree. It is cost efficiency and nothing else: no mana is ever returned.
   */
  firemind: {
    id: "firemind",
    figures: (rank) => [
      t('passives.firemind.figure1', { a: formatDecimal(firemindPerStack(rank), 2) }),
      t('passives.firemind.figure2'),
    ],
    trigger: "statMod",
    resolved: (rank) => firemindPerStack(rank),
  },

  /**
   * When a Burning enemy dies, one stack of its fire jumps to the nearest enemy
   * (of the same side) that is not already burning, inside a few hexes. Fired on the
   * unit that applied the Burn, so another hero's fire is not this hero's to pass.
   * Objectives are never a recipient: nothing attackable catches fire by accident.
   */
  spark: {
    id: "spark",
    figures: (rank) => [
      t('passives.spark.figure1', { count: sparkRange(rank) }),
      t('passives.spark.figure2', { a: formatDecimal(Math.round(rank.scale * 100), 2) }),
    ],
    trigger: "onBurningDeath",
    resolved: (rank) => [sparkRange(rank), rank.scale],
    resolve: ({ self, other, allUnits, burn }, rank) => {
      if (!other || !burn || self.currentHp <= 0 || self.isPlayer === other.isPlayer) return [];
      const range = sparkRange(rank);
      const [next] = allUnits
        .filter(
          (u) =>
            u.id !== other.id &&
            u.currentHp > 0 &&
            u.isPlayer === other.isPlayer &&
            !u.objective &&
            !hasEffect(u, AfflictionType.Burn) &&
            !isImmuneTo(u, AfflictionType.Burn) &&
            hexDistance(u.position, other.position) <= range,
        )
        .sort(
          (a, b) =>
            hexDistance(a.position, other.position) - hexDistance(b.position, other.position) ||
            a.currentHp - b.currentHp ||
            a.id.localeCompare(b.id),
        );
      if (!next) return [];
      return [
        {
          kind: "effect",
          unitId: next.id,
          effect: {
            type: AfflictionType.Burn,
            magnitude: sparkMagnitude(burn, rank),
            duration: Math.max(BALANCE.SPARK_MIN_DURATION, burn.duration),
            sourceUnitId: self.id,
            stacks: 1,
          },
          log: t('combatLog.log.sparkCarries', { source: passiveName('spark'), name: unitName(next) }),
        },
      ];
    },
  },

  /**
   * Cashing in a Burn leaves the hex burning. Where a detonating skill spends the
   * Burn on an enemy, that enemy's hex becomes burning ground for a few rounds: an
   * enemy that begins its turn there catches a Burn stack. Laid as an
   * `ArenaHazard` (non-solid, so it never blocks a body), one per hex and owner;
   * detonating the same hex again refreshes it instead of stacking a second.
   */
  detonation: {
    id: "detonation",
    figures: (rank) => [
      t('passives.detonation.figure1', { count: detonationRounds(rank) }),
      t('passives.detonation.figure2', { a: formatDecimal(Math.round(rank.scale * 100), 2) }),
    ],
    trigger: "onDetonate",
    resolved: (rank) => [detonationRounds(rank), rank.scale],
    resolve: ({ self, other, burn }, rank) => {
      if (!other || !burn || burn.type !== AfflictionType.Burn) return [];
      return [
        {
          kind: "hazard",
          hazard: {
            id: `burning:${self.id}:${hexKey(other.position)}`,
            hexes: [{ ...other.position }],
            solid: false,
            passiveId: "detonation",
            turnsLeft: detonationRounds(rank),
            ownerId: self.id,
            ignites: {
              magnitude: detonationGroundMagnitude(burn, rank),
              duration: BALANCE.DETONATION_BURN_DURATION,
            },
          },
          log: t('combatLog.log.detonationGround', { source: passiveName('detonation') }),
        },
      ];
    },
  },

  /**
   * Control cashed in for damage. The blow that breaks a Freeze lands extra, a share of
   * itself, on top of the ice's own burst, which every hit already earns.
   *
   * Read off `other`, the pre-damage snapshot, exactly as Shatterstep is: by the time
   * the store is read again the Freeze is gone. "First" is therefore literal. The
   * Freeze is spent by whichever hit lands first, so a second strike of the same cast
   * (or an ally who got there before you) finds nothing to break. The extra goes
   * through `damageUnit` like a tick, so a Barrier eats it. Not rolled and not
   * mitigated: it is the ice, not a second strike.
   */
  shatterpoint: {
    id: "shatterpoint",
    figures: (rank) => [
      t('passives.shatterpoint.figure1', { a: asPct(BALANCE.SHATTERPOINT_BONUS * rank.scale) }),
    ],
    trigger: "onHit",
    resolved: (rank) => BALANCE.SHATTERPOINT_BONUS * rank.scale,
    resolve: ({ other, amount = 0, allUnits }, rank) => {
      if (!other || !isShatterable(other)) return [];
      // The blow itself: the HP lost includes the ice's own burst, a share of the
      // target's pool that would make this scale with how big the enemy is.
      const blow = amount - shatterBurst(other);
      if (blow <= 0) return [];
      const live = allUnits.find((u) => u.id === other.id);
      if (!live || live.currentHp <= 0) return [];
      return [
        {
          kind: "damage",
          unitId: other.id,
          amount: shatterpointBonus(blow, rank),
          color: "#9fdcff",
          log: passiveName("shatterpoint"),
        },
      ];
    },
  },

  /**
   * Frostbite becomes two fangs. The rule is read by `strikeScales`, which has no
   * passive lookup of its own; this entry states the figure and lets the rank sweep
   * see that the rung moves it.
   */
  twinFangs: {
    id: "twinFangs",
    figures: (rank) => [
      t('passives.twinFangs.figure1', { a: asPct(BALANCE.TWIN_FANGS_SECOND_HIT * rank.scale) }),
    ],
    trigger: "statMod",
    resolved: (rank) => BALANCE.TWIN_FANGS_SECOND_HIT * rank.scale,
  },

  /**
   * Ignite feeds a fire that is already going. The rule is read in the resolver's
   * status pass through `fuelTheFlameBurn`; this entry states the figure and lets
   * the rank sweep see that the rung moves it.
   */
  fuelTheFlame: {
    id: "fuelTheFlame",
    figures: (rank) => [
      t('passives.fuelTheFlame.figure1', { a: asPct(BALANCE.FUEL_THE_FLAME_STACK * rank.scale) }),
    ],
    trigger: "statMod",
    resolved: (rank) => BALANCE.FUEL_THE_FLAME_STACK * rank.scale,
  },

  /**
   * A Freeze landing thaws a Barrier onto the ally who needs it most. Once a turn: a
   * Blizzard that freezes four is one shield, not four, so the node cannot be farmed
   * by area control. The Barrier goes through `resolveEffectMagnitude`, so the Hydromancer's
   * own shield bonuses (Thick Ice) apply, and a Freeze a boss ignored never fires it.
   */
  meltwater: {
    id: "meltwater",
    figures: (rank) => [
      t('passives.meltwater.figure1', { a: formatDecimal(meltwaterBarrier(rank), 2), count: BALANCE.MELTWATER_DURATION }),
      t('passives.meltwater.figure2'),
    ],
    trigger: "onFreeze",
    resolved: (rank) => meltwaterBarrier(rank),
    resolve: ({ self, allUnits, turnSpent }, rank) => {
      const key = `meltwater:${self.id}`;
      if (turnSpent?.includes(key)) return [];
      const ally = mostWoundedAlly(self, allUnits);
      if (!ally) return [];
      return [
        {
          kind: "effect",
          unitId: ally.id,
          effect: {
            type: AuraType.Barrier,
            // A flat amount, so the power stats are never read; the base sheet stands in
            // for the effective one `damageCalc.resolveEffectMagnitude` passes, which
            // this module cannot reach (`combatEngine` imports it).
            magnitude: resolveEffectMagnitudeWith(self.stats, AuraType.Barrier, meltwaterBarrier(rank), self, "magic"),
            duration: BALANCE.MELTWATER_DURATION,
            sourceUnitId: self.id,
          },
          log: t('combatLog.log.shields', { source: passiveName('meltwater'), name: unitName(ally) }),
        },
        { kind: "spend", key },
      ];
    },
  },

  /**
   * The ice goes outward. Read off `other`, the pre-blow snapshot, as Shatterpoint is.
   * Once a turn, and a blow with nobody beside it spends nothing, so a Blizzard throws
   * one volley from the first break that has anyone to hit. Not rolled and not
   * mitigated. A shard's Chill goes only on a warm enemy, so a shard never makes a
   * Freeze; it lands before the shard, so it never floats over a body.
   */
  flyingShards: {
    id: "flyingShards",
    figures: (rank) => [
      t('passives.flyingShards.figure1', { a: formatDecimal(flyingShardsMagic(rank), 2), count: BALANCE.ARCANIST_ROW_TWO.SHARD_REACH }),
      t('passives.flyingShards.figure2', { a: BALANCE.ARCANIST_ROW_TWO.SHARD_CHILL, count: BALANCE.ARCANIST_ROW_TWO.SHARD_CHILL_TURNS }),
    ],
    trigger: "onHit",
    resolved: (rank) => flyingShardsMagic(rank),
    resolve: ({ self, other, allUnits, turnSpent, magic }, rank) => {
      if (!other || !isShatterable(other) || self.isPlayer === other.isPlayer) return [];
      const key = `flyingShards:${self.id}`;
      if (turnSpent?.includes(key)) return [];
      const { SHARD_REACH, SHARD_CHILL, SHARD_CHILL_TURNS } = BALANCE.ARCANIST_ROW_TWO;
      const caught = allUnits.filter(
        (u) =>
          u.id !== other.id &&
          u.currentHp > 0 &&
          u.isPlayer === other.isPlayer &&
          !u.objective &&
          !u.untargetable &&
          hexDistance(u.position, other.position) <= SHARD_REACH,
      );
      if (caught.length === 0) return [];
      const amount = flyingShardsDamage(magic ?? self.stats.magic, rank);
      const outcomes: PassiveOutcome[] = [{ kind: "spend", key }];
      for (const u of caught) {
        if (!hasEffect(u, AfflictionType.Chill) && !hasEffect(u, AfflictionType.Freeze)) {
          outcomes.push({
            kind: "effect",
            unitId: u.id,
            effect: { type: AfflictionType.Chill, magnitude: SHARD_CHILL, duration: SHARD_CHILL_TURNS, sourceUnitId: self.id },
            log: "",
          });
        }
        outcomes.push({ kind: "damage", unitId: u.id, amount, color: "#9fdcff", log: passiveName("flyingShards") });
      }
      return outcomes;
    },
  },

  /**
   * A Chill laid from beyond immediate reach lasts longer. Read by `applySkillStatus`
   * through `deepColdExtraTurns` at the moment the Chill is applied, so a longer Chill
   * is also a longer window to Chill again and freeze it. Adjacent enemies get the
   * ordinary length, which is the decision: stand back.
   */
  deepCold: {
    id: "deepCold",
    figures: (rank) => [
      t('passives.deepCold.figure1', { count: deepColdTurns(rank) }),
    ],
    trigger: "statMod",
    resolved: (rank) => deepColdTurns(rank),
  },

  /**
   * Magic hits against a Chilled enemy ignore part of its Magic Defense. Read per target
   * and per skill by `penetrationAgainst`; it is not a stat. Chilled means Chill: a
   * Frozen enemy has spent its Chill, so this and Shatterpoint pull in different
   * directions on purpose.
   */
  killingFrost: {
    id: "killingFrost",
    figures: (rank) => [
      t('passives.killingFrost.figure1', { a: formatDecimal(killingFrostPen(rank), 2) }),
      t('passives.killingFrost.figure2'),
    ],
    trigger: "statMod",
    resolved: (rank) => killingFrostPen(rank),
    penAgainst: (target, skill, rank) =>
      damageTypeOf(skill) === "magic" && hasEffect(target, AfflictionType.Chill)
        ? killingFrostPen(rank)
        : 0,
  },

  /**
   * A cast that catches several already-Shocked enemies primes the next lightning bolt.
   *
   * Counts enemies that were Shocked *before* the cast's blows (the `struck` snapshot),
   * so the cast cannot charge itself with the Shock it lays: the setup (Arc, Static
   * Burst, Thunderstep) is one turn and the cast that cashes it in is the next. The
   * charge is an `Overloaded` aura, refreshed rather than stacked, held for
   * `OVERLOAD_DURATION` of the Stormcaller's own turns, and spent by the first
   * single-target lightning bolt (`isLightningBolt`: Arc and Thunderbolt, listed in
   * data) whatever it hits. A cast that is itself a bolt never charges it: a bolt hits
   * one enemy, which is fewer than the threshold.
   */
  overload: {
    id: "overload",
    figures: (rank) => [
      t('passives.overload.figure1', { a: asPct(overloadBonus(rank)) }),
      t('passives.overload.figure2', { a: formatDecimal(BALANCE.OVERLOAD_MIN_SHOCKED, 2), count: BALANCE.OVERLOAD_DURATION }),
    ],
    trigger: "onCast",
    resolved: (rank) => overloadBonus(rank),
    resolve: ({ self, struck = [] }, rank) =>
      shockedStruck(self, struck).length >= BALANCE.OVERLOAD_MIN_SHOCKED
        ? [
            {
              kind: "effect",
              unitId: self.id,
              effect: {
                type: AuraType.Overloaded,
                magnitude: overloadBonus(rank),
                duration: BALANCE.OVERLOAD_DURATION,
                sourceUnitId: self.id,
              },
              log: t('combatLog.log.overloadBuilds', { source: passiveName('overload') }),
            },
          ]
        : [],
  },

  /**
   * Arc's Shock jump carries more of the blow. The rule is read on the on-hit path
   * through `statusEffects.conductiveArcBonus`; this entry states the figure and lets
   * the rank sweep see that the rung moves it.
   */
  conductiveArc: {
    id: "conductiveArc",
    figures: (rank) => [
      t('passives.conductiveArc.figure1', { a: asPct(BALANCE.CONDUCTIVE_ARC_BONUS * rank.scale) }),
    ],
    trigger: "statMod",
    resolved: (rank) => BALANCE.CONDUCTIVE_ARC_BONUS * rank.scale,
  },

  vengeance: {
    id: "vengeance",
    // The refund is a whole turn at every rung — see the resolver — so the rank
    // is folded into the odds and the turn is stated once, in the same phrase.
    // Two entries would draw an arrow under a "1 turn" that never moves.
    figures: (rank) => [
      t('passives.vengeance.figure1', { a: asPct(vengeanceChance(rank)) }),
    ],
    trigger: "onDamaged",
    /**
     * The one passive whose rank buys *reliability* rather than size.
     *
     * A cooldown refund is counted in whole turns, so it cannot take a 0.75 /
     * 1.25 scale at all — 0.75 of a turn is either nothing or the whole thing
     * depending on where it rounds, which is the same reason `skillRangeBonus`
     * and its siblings are on `INTEGER_MODIFIERS`. The alternative was
     * `maxLevel: 1`; a trigger chance keeps the node rankable without inventing
     * a second effect, and the ladder is authored rather than scaled because
     * 0.75 / 1 / 1.25 of anything cannot land on a clean 50 / 75 / 100.
     *
     * The remaster (2026-10) moved it to a side-tree starter and set the odds to
     * 25 / 50 / 75%: it never fires every time.
     */
    resolve: ({ self, allUnits, rng }, rank) =>
      isTaunting(self, allUnits) && rolls(vengeanceChance(rank), rng)
        ? [
            {
              kind: "refundCooldown",
              unitId: self.id,
              turns: 1,
              log: passiveName("vengeance"),
            },
          ]
        : [],
  },

  undying: {
    id: "undying",
    // Not an `onDamaged` reaction: a hook that runs *after* the HP write would
    // be resurrecting a corpse rather than preventing a death, and the fight
    // would already have been decided by the victory check in between.
    trigger: "statMod",
    interceptsLethal: true,
  },

  lastBreath: {
    id: "lastBreath",
    // The save is the flat half and the surge is the half a rung buys, which is
    // the split the `onLethalSave` comment argues for — so they are two entries
    // rather than one sentence, and the arrow lands on the number that moves.
    // Both halves of the surge share `LAST_BREATH_SURGE`, so they share a line:
    // an attack figure and a lifesteal figure that can never disagree would be
    // two rows of the same percentage.
    figures: (rank) => [
      t('passives.lastBreath.figure1'),
      t('passives.lastBreath.figure2', { a: asPct(LAST_BREATH_SURGE * rank.scale) }),
    ],
    trigger: "statMod",
    interceptsLethal: true,
    // At 1 HP the Berserker is one chip of damage from dead, so a plain save
    // buys a turn of running away. The surge is what makes it a comeback: the
    // lifesteal is the part that matters, because it is the only way back up.
    //
    // Halved from +50% attack / 50% drain after a playtest: the save alone is
    // already a free turn, and at the old numbers the comeback out-hit the
    // fight that had just won — on enemies carrying it, a kill you had earned
    // un-killed itself and then killed *you*.
    //
    // The rank moves the surge and never the save: surviving is the capstone's
    // identity and a fraction of a life is not a thing, while a second one at
    // level 3 would be worth far more than a rung is priced at. The duration
    // stays put for the `INTEGER_MODIFIERS` reason — three turns scaled is 2.25.
    onLethalSave: ({ self }, rank) => [
      {
        kind: "effect",
        unitId: self.id,
        effect: {
          type: AuraType.AttackBuff,
          magnitude: Math.max(3, Math.round(self.stats.attack * LAST_BREATH_SURGE * rank.scale)),
          duration: 3,
        },
        log: passiveName("lastBreath"),
      },
      {
        kind: "effect",
        unitId: self.id,
        effect: {
          type: AuraType.Lifesteal,
          magnitude: LAST_BREATH_SURGE * rank.scale,
          duration: 3,
        },
        log: passiveName("lastBreath"),
      },
    ],
  },

  /**
   * The Berserker's Undying (remaster, 2026-10): Last Breath's save, then a window
   * in which nothing can take the Berserker below 1 HP until two of its own
   * regular turns on which it can act have been played.
   *
   * A protected floor rather than immunity: blows still land, still show their
   * numbers and still break barriers, and healing still counts, so the HP the
   * window closes on is the real one. The clock (`AuraType.UndyingWindow`) is
   * counted in `turnStart` and `combatStore.nextTurn`; the surge is a `statMod`
   * read while the window stands, so no duration can tick it away before either
   * response turn is played, and it ends with the window.
   */
  undyingFury: {
    id: "undyingFury",
    figures: (rank) => [
      t('passives.undyingFury.figure1'),
      t('passives.undyingFury.figure2', { count: BALANCE.UNDYING_RESPONSE_TURNS }),
      t('passives.undyingFury.figure3', { a: asPct(BALANCE.UNDYING_SURGE * rank.scale) }),
    ],
    trigger: "statMod",
    interceptsLethal: true,
    // The rung moves the surge, never the save or the two turns (as Last Breath)
    resolved: (rank) => BALANCE.UNDYING_SURGE * rank.scale,
    statMod: (unit, rank) =>
      hasUndyingWindow(unit)
        ? { attack: undyingAttack(unit, rank), lifesteal: Math.round(BALANCE.UNDYING_SURGE * rank.scale * 100) }
        : {},
    onLethalSave: ({ self }) => [
      {
        kind: "effect",
        unitId: self.id,
        effect: {
          type: AuraType.UndyingWindow,
          magnitude: BALANCE.UNDYING_RESPONSE_TURNS,
          duration: -1,
          sourceUnitId: self.id,
        },
        log: passiveName("undyingFury"),
      },
    ],
  },

  /**
   * Blood Rush, the Berserker's Signature node: Bloodthirst dashes before it
   * strikes. The skill itself is rewritten where the unit is built
   * (`withBloodRush`); this entry states the figure.
   */
  bloodRush: {
    id: "bloodRush",
    figures: (rank) => [t('passives.bloodRush.figure1', { count: bloodRushDash(rank) })],
    trigger: "statMod",
    resolved: (rank) => bloodRushDash(rank),
  },

  cryostasis: {
    id: "cryostasis",
    /**
     * The shield is stated as its share of the pool rather than in points,
     * because `figures` is handed a rank and no unit — and the share is the term
     * that actually decides the number on all but the smallest of pools. The
     * flat floor beside it in the resolver only binds on a unit whose maximum
     * health is under about seventy, which no owner of a tier-3 Arcanist node
     * is, so stating it would describe a case the reader is never in.
     *
     * The Freeze does not scale — the resolver's own note explains why a shorter
     * one at rank 1 would read as broken rather than as cheaper — so it is a
     * second entry that holds still while the first moves.
     */
    figures: (rank) => [
      t('passives.cryostasis.figure1', { a: asPct(CRYOSTASIS_BARRIER * rank.scale) }),
      t('passives.cryostasis.figure2', { count: BALANCE.FREEZE_DURATION }),
    ],
    trigger: "statMod",
    interceptsLethal: true,
    // The Hydromancer's version answers the same problem from the other side:
    // rather than swinging back it removes the thing that nearly killed it and
    // buys a wall. `FREEZE_DURATION` turns of it, and any blow from anyone ends
    // it early by shattering — so it is a window, not a lock, and the ally who
    // helpfully hits the frozen attacker is the one who closes it.
    //
    // The rank moves the wall and nothing else. The save is binary for Last
    // Breath's reason; the Freeze is measured in turns, and shortening the
    // window at rank 1 would make the low rungs of a capstone read as broken
    // rather than as cheaper — a 1-turn Freeze is the trap `rootDuration`
    // exists to catch, one system over.
    onLethalSave: ({ self, other }, rank) => [
      ...(other
        ? [
            {
              kind: "effect" as const,
              unitId: other.id,
              effect: {
                type: AfflictionType.Freeze,
                magnitude: 1,
                duration: BALANCE.FREEZE_DURATION,
              },
              log: passiveName("cryostasis"),
            },
          ]
        : []),
      {
        kind: "effect",
        unitId: self.id,
        effect: {
          type: AuraType.Barrier,
          magnitude: Math.max(
            Math.round(CRYOSTASIS_FLOOR * rank.scale),
            pct(self, CRYOSTASIS_BARRIER * rank.scale),
          ),
          duration: 4,
        },
        log: passiveName("cryostasis"),
      },
    ],
  },

  secondSkin: {
    id: "secondSkin",
    // `onLethalSave` below takes no rank, so the health it leaves is the same at
    // every rung. Stated anyway rather than omitted — a capstone that says
    // nothing about how much of you is left reads as one nobody documented.
    figures: () => [t('passives.secondSkin.figure1', { a: asPct(SECOND_SKIN_HP) })],
    trigger: "statMod",
    // The one conditional save. A Druid standing upright has no shape to spend,
    // and a `true` here would have handed the path a free life it never bought
    // — which is also why the condition is the *shape* rather than the path.
    interceptsLethal: isBeast,
    // Left at 1 HP the Druid is dead to the next tick, which is a reprieve
    // rather than a turn — the same argument Last Breath's surge answers, from
    // the side of a class that has no comeback damage to offer. Measured
    // against `combatMaxHp`, so a Bear's vigor is in the number.
    onLethalSave: ({ self }) => [
      {
        kind: "heal",
        unitId: self.id,
        amount: Math.max(1, pct(self, SECOND_SKIN_HP) - 1),
        log: passiveName("secondSkin"),
      },
    ],
  },

  // ── onTurnStart ─────────────────────────────────────────────────────────────
  /**
   * **A percentage heal per turn is a hard ceiling on how long a fight may
   * last, and 8% put that ceiling below the length of the fight it was on.**
   *
   * Healing `p` of max HP every round means the target is unkillable unless the
   * party clears `p × maxHp` a round — so at 8% anything taking more than 12.5
   * rounds does not merely take longer, it never dies at all. That is not a
   * gradient a player can feel their way along: it reads as "I did no damage",
   * and there is no amount of levelling that fixes it, because the passive is a
   * fraction of a pool that scales with the party.
   *
   * The Warren's boss carried this and sat the wrong side of the line at every
   * legal party size — 54 healed a round against 33 dealt. 3% puts the ceiling
   * at 33 rounds, which is far longer than any fight in the game, so the passive
   * is a real drain on the attrition a lair is about rather than a wall.
   */
  regeneration: {
    id: "regeneration",
    figures: (rank) => [t('passives.regeneration.figure1', { a: asPct(REGENERATION_SHARE * rank.scale) })],
    trigger: "onTurnStart",
    resolve: ({ self }, rank) =>
      self.currentHp >= combatMaxHp(self)
        ? []
        : [
            {
              kind: "heal",
              unitId: self.id,
              amount: pct(self, REGENERATION_SHARE * rank.scale),
              log: passiveName("regeneration"),
            },
          ],
  },

  /**
   * The Berserker's rhythm: one turn winding up, one turn landing.
   *
   * The alternation needs no counter and no new field, because the buff it
   * grants **is** the clock. Granted at `SELF_GRANT_DURATION` it is up for
   * exactly the turn that granted it and gone by the tick at the start of the
   * turn after — so "grant it whenever it is absent" produces on, off, on, off
   * on its own, and a save or a mid-fight reset cannot leave the count wrong
   * because there is no count.
   *
   * The cost of that is the one thing to know about it: any *other* attack buff
   * standing on the Berserker reads as the loud turn already being under way,
   * so a long rally from an ally suspends the rhythm until it expires and it
   * resumes by itself. That is a quiet turn, never a double one.
   */
  cadence: {
    id: "cadence",
    // A share of the unit's own attack, and `figures` has no unit — so the share
    // is what can be stated, which is also the honest figure: the resolver's
    // floor of 2 attack only decides the number on a Berserker too weak to have
    // reached this node.
    figures: (rank) => [t('passives.cadence.figure1', { a: asPct(CADENCE_ATTACK * rank.scale) })],
    trigger: "onTurnStart",
    resolve: ({ self }, rank) =>
      self.activeEffects.some((e) => e.type === AuraType.AttackBuff)
        ? []
        : [
            {
              kind: "effect",
              unitId: self.id,
              effect: {
                type: AuraType.AttackBuff,
                magnitude: Math.max(
                  2,
                  Math.round(self.stats.attack * CADENCE_ATTACK * rank.scale),
                ),
                duration: SELF_GRANT_DURATION,
              },
              log: passiveName("cadence"),
            },
          ],
  },

  /**
   * The Pyromancer's reward for planting itself: heat that builds while it
   * stands still.
   *
   * Absolute magnitudes rather than increments, the way Braced is, because the
   * store merges same-type auras by taking the stronger and a "+step" would be
   * swallowed by the stack already there. The stack count is read back out of
   * the magnitude instead of being stored: one number, so nothing can disagree
   * with itself about how hot the fire is.
   *
   * **The half that is missing is the half that costs anything.** Moving is
   * meant to put it out, and nothing here can do that — a passive's only way to
   * touch an effect is `applyEffect`, which merges by taking the *larger*
   * magnitude and the *longer* duration, so there is no value it can send that
   * lowers or clears one. The seam is `SELF_GRANT_DURATION`: the aura already
   * lives one turn at a time and is only alive because this re-grants it, so a
   * "did I move last turn" check here is the whole fix. That check needs a mark
   * laid by `onMove` and read at the next turn start, which needs one hidden
   * `AuraType` this file may not add.
   */
  kindle: {
    id: "kindle",
    // The step scales and the stack count does not, so they are two entries: the
    // resolver's note is that a rank moving the count would make the flavour
    // line wrong at two rungs, and the flavour line no longer states the count
    // precisely so that this can.
    figures: (rank) => [
      t('passives.kindle.figure1', { a: asPct(KINDLE_MAGIC_STEP * rank.scale) }),
      t('passives.kindle.figure2', { a: formatDecimal(KINDLE_MAX_STACKS, 2) }),
    ],
    trigger: "onTurnStart",
    // The rank moves the step, not the ceiling — the description promises three
    // turns and a rank that changed the count would make its own flavour line
    // wrong at two rungs out of three.
    resolve: ({ self, movedLastTurn }, rank) => {
      const step = Math.max(
        1,
        Math.round(self.stats.magic * KINDLE_MAGIC_STEP * rank.scale),
      );
      const banked =
        self.activeEffects.find((e) => e.type === AuraType.MagicBuff)
          ?.magnitude ?? 0;
      // Moving spends the heat. Without this the stack only ever ramps, and a
      // Pyromancer who walks the whole fight keeps three stacks of a bonus
      // whose entire condition is standing still.
      const stacks = movedLastTurn
        ? 1
        : Math.min(KINDLE_MAX_STACKS, Math.floor(banked / step) + 1);
      return [
        {
          kind: "effect",
          unitId: self.id,
          effect: {
            type: AuraType.MagicBuff,
            magnitude: step * stacks,
            duration: SELF_GRANT_DURATION,
          },
          log: passiveName("kindle"),
        },
      ];
    },
  },

  /**
   * Hiding pays the Shadowblade in time.
   *
   * Read at the start of every turn spent hidden rather than at the moment
   * Stealth lands, and the difference is smaller than it looks: attacking
   * breaks Stealth in `applyOnHitStatuses`, so a Shadowblade who steps into the
   * dark and then does what the path exists to do collects exactly one refund.
   * Staying hidden a second turn collects a second, which is the price of
   * having spent a second turn not killing anything.
   *
   * The literal "on entering" reading has nowhere to hang: `applySkillStatus`
   * fires `onTauntApplied` and nothing else, and there is no trigger for a
   * status arriving.
   */
  nightfall: {
    id: "nightfall",
    // `resolve` takes no rank, and a refund is counted in whole turns anyway —
    // Vengeance's note is the argument. Vengeance buys reliability with its rung
    // and this buys nothing, so it is flat and says so.
    figures: () => [t('passives.nightfall.figure1', { count: NIGHTFALL_REFUND })],
    trigger: "onTurnStart",
    resolve: ({ self }) =>
      hasEffect(self, AuraType.Stealth)
        ? [
            {
              kind: "refundCooldown",
              unitId: self.id,
              turns: NIGHTFALL_REFUND,
              log: passiveName("nightfall"),
            },
          ]
        : [],
  },

  // ── onMove ──────────────────────────────────────────────────────────────────
  momentum: {
    id: "momentum",
    // Already in points of crit chance rather than a fraction, so it is rounded
    // here rather than run through `asPct` — 15 is 15%, not 1500%.
    figures: (rank) => [t('passives.momentum.figure1', { a: formatDecimal(Math.round(MOMENTUM_CRIT * rank.scale), 2) })],
    trigger: "onMove",
    // Five nodes across four paths grant this, so its rank is the one decision
    // here that moves the Berserker, the Pyromancer, the Stormcaller, the
    // Marksman and the Skirmisher at once. The crit chance scales and the
    // duration does not: two turns is what makes it reach the strike it is named
    // for, and 1.5 of a turn is not a thing the tick can express.
    resolve: ({ self }, rank) => [
      {
        kind: "effect",
        unitId: self.id,
        effect: {
          type: AuraType.CritBuff,
          magnitude: MOMENTUM_CRIT * rank.scale,
          duration: 2,
        },
        log: passiveName("momentum"),
      },
    ],
  },

  // ── onHeal ──────────────────────────────────────────────────────────────────
  lifebloom: {
    id: "lifebloom",
    figures: (rank) => [
      t('passives.lifebloom.figure1', { a: asPct(LIFEBLOOM_SHARE * rank.scale) }),
    ],
    trigger: "onHeal",
    resolve: ({ other, amount = 0 }, rank) =>
      other && amount > 0
        ? [
            {
              kind: "effect",
              unitId: other.id,
              effect: {
                type: AuraType.HealOverTime,
                magnitude: Math.max(1, Math.round(amount * LIFEBLOOM_SHARE * rank.scale)),
                duration: 2,
              },
              log: passiveName("lifebloom"),
            },
          ]
        : [],
  },

  /**
   * Healing and cleansing keep the healer and the healed.
   *
   * Fires on `onHeal`, which the engine raises for a direct heal that was *cast*
   * (a skill's healing, Smite's incidental heal) and for a cleanse that removed
   * something. What it reads is `restored` and `cleansed`, not `amount`: a heal
   * on someone at full health restores nothing and a cleanse of a clean ally
   * removes nothing, and neither of those did anything worth rewarding. Passive
   * ticks (a heal-over-time, Regeneration) never raise the event at all.
   *
   * One ward per unit, refreshed rather than stacked — `MagicDefenseBuff` merges
   * by the stronger magnitude and the longer clock — so an area heal that
   * reaches four allies puts one ward on each and refreshes the Templar's own
   * four times to the same number. Each ally is warded by *their own* heal
   * actually restoring HP, so a topped-up ally standing in the ring gets
   * nothing from it.
   */
  oath: {
    id: "oath",
    figures: (rank) => [
      t('passives.oath.figure1', { a: asPct(BALANCE.OATH_WARD_SHARE * rank.scale), b: formatDecimal(Math.round(BALANCE.OATH_MIN_WARD * rank.scale), 2) }),
      t('passives.oath.figure2'),
    ],
    trigger: "onHeal",
    resolve: ({ self, other, restored = 0, cleansed = 0 }, rank) => {
      if (!other || (restored <= 0 && cleansed <= 0)) return [];
      const ward = (unit: CombatUnit): PassiveOutcome => ({
        kind: "effect",
        unitId: unit.id,
        effect: {
          type: AuraType.MagicDefenseBuff,
          magnitude: oathWard(unit, rank),
          duration: BALANCE.OATH_WARD_DURATION,
          sourceUnitId: self.id,
        },
        log: passiveName("oath"),
      });
      return other.id === self.id ? [ward(self)] : [ward(other), ward(self)];
    },
  },

  /**
   * The Lifewarden's Signature node: Lifebloom's direct heal also reaches the most
   * wounded ally near its recipient. Read by `skillResolution` through
   * `sharedBloomRecipient`; this entry states the figure for the panel and the
   * rank sweep. The extra heal is direct, so it raises its own `onHeal`, but it is
   * never a second Lifebloom: no regeneration of the signature's, and no chain.
   */
  sharedBloom: {
    id: "sharedBloom",
    figures: (rank) => [
      t('passives.sharedBloom.figure1', { a: asPct(BALANCE.SHARED_BLOOM_SHARE * rank.scale) }),
      t('passives.sharedBloom.figure2', { count: BALANCE.SHARED_BLOOM_REACH }),
    ],
    trigger: "statMod",
    resolved: (rank) => BALANCE.SHARED_BLOOM_SHARE * rank.scale,
  },

  // ── The Firefly (Monk) ───────────────────────────────────────────────────────

  /**
   * The Firefly's Signature node: Glowmote's mote heals a larger share of the bolt
   * and flies further. Read by `fireflyRules.moteSpec`; this entry states the
   * figure for the panel and the rank sweep. The reach is an integer step and
   * holds at every rung.
   */
  brighterMotes: {
    id: "brighterMotes",
    figures: (rank) => [
      t('passives.brighterMotes.figure1', { a: asPct(BALANCE.FIREFLY.BRIGHTER_MOTE_SHARE * rank.scale), b: asPct(BALANCE.FIREFLY.MOTE_SHARE) }),
      t('passives.brighterMotes.figure2', { count: BALANCE.FIREFLY.BRIGHTER_MOTE_REACH, b: formatDecimal(BALANCE.FIREFLY.MOTE_REACH, 2) }),
    ],
    trigger: "statMod",
    resolved: (rank) => BALANCE.FIREFLY.BRIGHTER_MOTE_SHARE * rank.scale,
  },

  /**
   * Meditate's next-turn heal also reaches the allies beside the Firefly. Read by
   * the store's `payMeditation` through `fireflyRules.lanternBreathShares`, on the
   * tick that retires the Meditation aura — so it lands on whoever stands beside
   * the Monk *then*, not when it sat down.
   */
  lanternBreath: {
    id: "lanternBreath",
    figures: (rank) => [
      t('passives.lanternBreath.figure1', { a: asPct(BALANCE.FIREFLY.LANTERN_BREATH_SHARE * rank.scale) }),
    ],
    trigger: "statMod",
    resolved: (rank) => BALANCE.FIREFLY.LANTERN_BREATH_SHARE * rank.scale,
  },

  /**
   * Any ally the Firefly heals is brighter for a turn: Attack and Magic. Fires on
   * `onHeal` and rewards only a heal that restored something, as Oath does; the
   * Firefly's own mote returning to it is not an ally being healed. Buffs merge
   * by the stronger magnitude and the longer clock, so a second heal refreshes.
   */
  afterglow: {
    id: "afterglow",
    figures: (rank) => [
      t('passives.afterglow.figure1', { a: formatDecimal(afterglowPoints(BALANCE.FIREFLY.AFTERGLOW_ATTACK, rank), 2), b: formatDecimal(afterglowPoints(BALANCE.FIREFLY.AFTERGLOW_MAGIC, rank), 2) }),
      t('passives.afterglow.figure2'),
    ],
    trigger: "onHeal",
    resolve: ({ self, other, restored = 0 }, rank) => {
      if (!other || other.id === self.id || restored <= 0) return [];
      return afterglowEffects(self.id, rank).map((effect) => ({
        kind: "effect" as const, unitId: other.id, effect, log: passiveName("afterglow"),
      }));
    },
  },

  /**
   * Far Light, a side-tree starter: Glowmote, Lightbond and Purifying Light reach
   * a hex further. A rule on the kit rather than an event, so it is baked into the
   * skills when the unit is built (`fireflyRules.withFarLight`), the way Blood
   * Rush is — the highlight, the range check and the inspector read one range.
   */
  farLight: {
    id: "farLight",
    figures: () => [t('passives.farLight.figure1', { a: formatDecimal(BALANCE.FIREFLY.FAR_LIGHT_RANGE, 2) })],
    trigger: "statMod",
    resolved: () => BALANCE.FIREFLY.FAR_LIGHT_RANGE,
  },

  /**
   * Twin Motes, the other starter: Glowmote's mote heals the two most hurt allies
   * in reach, each for the whole mote. Read by `combatEvents.applyMote` through
   * `fireflyRules.moteRecipients`.
   */
  twinMotes: {
    id: "twinMotes",
    figures: () => [t('passives.twinMotes.figure1', { count: BALANCE.FIREFLY.TWIN_MOTES })],
    trigger: "statMod",
    resolved: () => BALANCE.FIREFLY.TWIN_MOTES,
  },

  /**
   * A cast of the Firefly's that heals an ally — the heal itself, the mote, the
   * bond, a sweep — hands back chi once, however many it mended: Lantern Sweep
   * mends a whole line, and a refund per body would make it pay for itself.
   * Fires on `onSkillResolved`, after the cast is paid for, so a Firefly casting
   * from a full pool still keeps it. Healing only itself pays nothing.
   */
  steadyFlame: {
    id: "steadyFlame",
    figures: (rank) => [t('passives.steadyFlame.figure1', { a: formatDecimal(steadyFlameChi(rank), 2) })],
    trigger: "onSkillResolved",
    resolved: (rank) => steadyFlameChi(rank),
    resolve: ({ self, healedAlly }, rank) =>
      healedAlly ? [{ kind: "mana", unitId: self.id, amount: steadyFlameChi(rank), log: passiveName("steadyFlame") }] : [],
  },

  /**
   * A heal that lifts an ally from below half its health to above it lays a
   * Barrier off the Firefly's Magic. Reads the ally as it stood before the heal
   * (`applyOnHeal` hands over the pre-heal snapshot) and what the heal restored.
   */
  secondLight: {
    id: "secondLight",
    figures: (rank) => [
      t('passives.secondLight.figure1', { a: asPct(secondLightBarrier(rank)), count: BALANCE.FIREFLY.SECOND_LIGHT_DURATION }),
      t('passives.secondLight.figure2', { a: asPct(BALANCE.FIREFLY.SECOND_LIGHT_THRESHOLD) }),
    ],
    trigger: "onHeal",
    resolved: (rank) => secondLightBarrier(rank),
    resolve: ({ self, other, restored = 0 }, rank) => {
      if (!other || other.id === self.id || restored <= 0 || other.isPlayer !== self.isPlayer) return [];
      const line = combatMaxHp(other) * BALANCE.FIREFLY.SECOND_LIGHT_THRESHOLD;
      if (other.currentHp >= line || other.currentHp + restored <= line) return [];
      return [{
        kind: "effect",
        unitId: other.id,
        effect: {
          type: AuraType.Barrier,
          magnitude: resolveEffectMagnitudeWith(self.stats, AuraType.Barrier, secondLightBarrier(rank), self, "magic"),
          duration: BALANCE.FIREFLY.SECOND_LIGHT_DURATION,
          sourceUnitId: self.id,
        },
        log: t('combatLog.log.shields', { source: passiveName('secondLight'), name: unitName(other) }),
      }];
    },
  },

  /**
   * Emergency healing that also braces. Reads the ally as it stood **before** the
   * heal (`applyOnHeal` is handed the pre-heal snapshot), against the ally's own
   * effective maximum, so a bear-shaped Druid is measured in the pool it is in. A
   * fresh application refreshes rather than stacks (`applyEffect` keeps the
   * stronger magnitude and the longer clock). Only a heal that restored HP counts.
   */
  secondSpring: {
    id: "secondSpring",
    figures: (rank) => [
      t('passives.secondSpring.figure1', { a: formatDecimal(secondSpringReduction(rank), 2) }),
      t('passives.secondSpring.figure2', { a: asPct(BALANCE.SECOND_SPRING_THRESHOLD) }),
    ],
    trigger: "onHeal",
    resolved: (rank) => secondSpringReduction(rank),
    resolve: ({ self, other, restored = 0 }, rank) => {
      if (!other || restored <= 0 || other.isPlayer !== self.isPlayer) return [];
      if (other.currentHp >= combatMaxHp(other) * BALANCE.SECOND_SPRING_THRESHOLD) return [];
      return [{
        kind: "effect",
        unitId: other.id,
        effect: {
          type: AuraType.SecondSpring,
          magnitude: secondSpringReduction(rank),
          duration: BALANCE.SECOND_SPRING_DURATION,
          sourceUnitId: self.id,
        },
        log: passiveName("secondSpring"),
      }];
    },
  },

  /**
   * Heal, heal, heal, then hit. The charges and the spend are worked by
   * `skillResolution` (`cycleOfLifeBonus`, `awardGrowth`), because "one per cast"
   * is a fact about the cast and `onHeal` fires once per ally mended. This entry
   * states the figures.
   */
  cycleOfLife: {
    id: "cycleOfLife",
    figures: (rank) => [
      t('passives.cycleOfLife.figure1', { a: asPct(BALANCE.CYCLE_OF_LIFE_MAGIC * rank.scale) }),
      t('passives.cycleOfLife.figure2', { count: BALANCE.CYCLE_OF_LIFE_CHARGES }),
    ],
    trigger: "onSkillResolved",
    // Spend before award is the caller's: a cast that paid out has already cleared the charges
    resolve: ({ self, restoredByCast }) => {
      if (!restoredByCast) return [];
      const next = Math.min(BALANCE.CYCLE_OF_LIFE_CHARGES, growthCharges(self) + 1);
      return [{ kind: 'effect', unitId: self.id, replace: true, silent: true, color: '#9be86a',
        log: t('combatLog.log.storesGrowth', { name: unitName(self), count: next, max: BALANCE.CYCLE_OF_LIFE_CHARGES }),
        effect: { type: AuraType.Growth, magnitude: next, duration: -1, sourceUnitId: self.id } }];
    },
    resolved: (rank) => BALANCE.CYCLE_OF_LIFE_MAGIC * rank.scale,
  },

  // ── onTauntApplied ──────────────────────────────────────────────────────────
  intimidating: {
    id: "intimidating",
    /**
     * The reference case for `figures`, and the one a player complained about.
     *
     * "Enemies you taunt hit for less" was the whole of what the Bulwark's Spite
     * node told anybody, at any rung, for a point costing exactly what the
     * `+30 HP` node beside it costs — and that one prints its 30.
     *
     * The number stays *out* of the description on purpose. A figure baked into
     * prose is the level-2 value written down a second time, and it is then
     * wrong at two of the three rungs; `figures` is read at the rank actually
     * held.
     */
    figures: (rank) => [
      t('passives.intimidating.figure1', { a: formatDecimal(Math.round(BALANCE.INTIMIDATING_SHRED * rank.scale), 2) }),
    ],
    trigger: "onTauntApplied",
    resolve: ({ self, other }, rank) =>
      other
        ? [
            {
              kind: "effect",
              unitId: other.id,
              effect: {
                type: AfflictionType.AttackDown,
                magnitude: BALANCE.INTIMIDATING_SHRED * rank.scale,
                duration: 2,
                sourceUnitId: self.id,
              },
              log: passiveName("intimidating"),
            },
          ]
        : [],
  },

  // ── statMod ─────────────────────────────────────────────────────────────────
  wrath: {
    id: "wrath",
    /**
     * The one figure that reads *downward* as it improves, and the panel will
     * draw it that way: "per 16% missing → per 12% missing".
     *
     * That is the ladder, not a mistake — see `WRATH_THRESHOLD`. Attack is a
     * whole number, so the rung buys a cheaper point rather than a bigger one,
     * and the threshold is the only number there is to state. Phrased as "per
     * … missing" precisely so the smaller value reads as the better deal; "+1
     * attack at 16%" would read as the opposite.
     *
     * Indexed by `level` rather than multiplied by `scale`, exactly as the
     * `statMod` below does it — the two must not disagree about which rung is
     * which.
     */
    figures: (rank) => [
      t('passives.wrath.figure1', { a: asPct(WRATH_THRESHOLD[rank.level - 1] ?? WRATH_THRESHOLD[1]) }),
    ],
    trigger: "statMod",
    /**
     * The one rank that runs *downward*, and the one that is a nerf below the
     * top rung.
     *
     * Attack is a whole number and the +1 granularity is what the description
     * promises, so the rung moves the **threshold** instead: a smaller share of
     * health missing buys the same point. That inverts the usual direction —
     * `rank.scale` cannot express it, since 8 ÷ 0.75 is 10.67 rather than the
     * 16 this ladder wants — so the rungs are authored, the way Vengeance's
     * chance is.
     *
     * Level 3 is the shipped 8%; 1 and 2 are deliberately weaker than what
     * Wrath did before ranks existed. That is the intended retune, not a
     * rounding artefact: the passive was reaching +12 attack on a Berserker
     * whose whole plan is to be nearly dead, for one point at tier 1.
     */
    statMod: (unit, rank) => {
      const missing = 1 - unit.currentHp / combatMaxHp(unit);
      const perPoint = WRATH_THRESHOLD[rank.level - 1] ?? WRATH_THRESHOLD[1];
      return { attack: Math.floor(missing / perPoint) };
    },
  },

  lastStand: {
    id: "lastStand",
    // The threshold holds still and the reduction moves, so the window is its own
    // entry. The unshakeable-taunt half is a rule and not a quantity; it stays in
    // the description, where `piercesImmunity` has nothing to add to it.
    figures: (rank) => [
      t('passives.lastStand.figure1', { a: asPct(LAST_STAND_AT) }),
      t('passives.lastStand.figure2', { a: asPct(lastStandReduction(rank)) }),
    ],
    // Not a stat: the reduction is total incoming damage, read by `incomingDamageScale`
    // at the two places health is taken (`damageUnit` and the effect tick), so a
    // poison tick and a Thorns reflection are reduced exactly as a blow is.
    trigger: "statMod",
    resolved: (rank) => lastStandReduction(rank),
    piercesImmunity: (unit) => isBelow(unit, LAST_STAND_AT),
  },


  /**
   * Smite's Mercy / Wrath choice. Grants no stat and fires on nothing: owning it
   * is what makes `skillModes.skillModesFor` offer the choice on Smite, and its
   * rung is what scales whichever mode is picked.
   */
  zeal: {
    id: "zeal",
    figures: (rank) => [
      t('passives.zeal.figure1', { a: asPct(BALANCE.ZEAL_MERCY_STRIKE[rank.level - 1] ?? 1), b: asPct(BALANCE.ZEAL_MERCY_HEAL[rank.level - 1] ?? 1) }),
      t('passives.zeal.figure2', { a: asPct(BALANCE.ZEAL_WRATH_STRIKE[rank.level - 1] ?? 1) }),
    ],
    trigger: "statMod",
    resolved: (rank) => [
      BALANCE.ZEAL_MERCY_STRIKE[rank.level - 1],
      BALANCE.ZEAL_MERCY_HEAL[rank.level - 1],
      BALANCE.ZEAL_WRATH_STRIKE[rank.level - 1],
    ],
  },

  // ── Immunities ──────────────────────────────────────────────────────────────
  unstoppable: {
    id: "unstoppable",
    // An immunity is its own magnitude — there is no more or less of one — so
    // both of these list what is refused, one entry per status, and the panel
    // reports the node as flat. One entry reading "immune to Root and Chill"
    // would work too; two is what a third status being added would extend
    // without re-writing a sentence.
    figures: () => [t('passives.unstoppable.figure1'), t('passives.unstoppable.figure2')],
    trigger: "statMod",
    immuneTo: [AfflictionType.Root, AfflictionType.Chill],
  },

  risingFire: {
    id: "risingFire",
    figures: () => [
      t('passives.risingFire.figure1', { a: asPct(BALANCE.DRAGON_RISE_START) }),
      t('passives.risingFire.figure2', { a: asPct(BALANCE.DRAGON_RISE_STEP) }),
      t('passives.risingFire.figure3', { a: formatDecimal(BALANCE.DRAGON_RISE_FULL_TURN, 2) }),
    ],
    trigger: "statMod",
    // A share of the stat he already has, so it follows the encounter's scaling. The
    // reading is his heat (`bossScript.heat`, `dragonHeat`); before his first turn it
    // reads as the first.
    statMod: (unit) => {
      const share = heatStrength(heatOf(unit)) - 1;
      return {
        attack: Math.round(unit.stats.attack * share),
        magic: Math.round(unit.stats.magic * share),
      };
    },
  },

  immovable: {
    id: "immovable",
    figures: () => [t('passives.immovable.figure1'), t('passives.immovable.figure2')],
    trigger: "statMod",
    immuneTo: [AfflictionType.Root],
    immuneToPush: true,
  },

  // ─── The elites' own ──────────────────────────────────────────────────────
  //
  // Enemy-only, one each, and none of them is reachable from a mastery tree. They
  // are declared here and not beside the elite that owns them because the lethal
  // saves have to be read by `survivesLethal`, and everything else asks the same
  // table whether a unit carries one. The rules that need the board — fragments,
  // rage, the Captain's word — are in `eliteKits` and the store.

  winterSleep: {
    id: "winterSleep",
    figures: () => [
      t('passives.winterSleep.figure1', { count: BALANCE.WINTER_SLEEP_TURNS }),
      t('passives.winterSleep.figure2', { a: asPct(BALANCE.WINTER_SLEEP_HEAL), b: asPct(BALANCE.WINTER_SLEEP_DAMAGE_REDUCTION) }),
      t('passives.winterSleep.figure3'),
    ],
    // A save like Undying — before the HP write, one shared `UndyingSpent` mark —
    // but what it saves it into is a sleep, not a second wind
    trigger: "statMod",
    interceptsLethal: true,
    onLethalSave: ({ self }) => [
      {
        kind: "heal",
        unitId: self.id,
        amount: pct(self, BALANCE.WINTER_SLEEP_HEAL),
        log: passiveName("winterSleep"),
      },
      {
        kind: "effect",
        unitId: self.id,
        effect: {
          type: AuraType.Slumber,
          magnitude: 1,
          duration: BALANCE.WINTER_SLEEP_TURNS,
          sourceUnitId: self.id,
        },
        log: passiveName("winterSleep"),
      },
    ],
  },

  // The Frost Mote's shatter. Nothing to resolve: the blast is the template's
  // `deathBurst`, set off by `detonateDeathBurst` on any death; this states it.
  frostBurst: {
    id: "frostBurst",
    figures: () => [
      t('passives.frostBurst.figure1', { a: asPct(BALANCE.FROST_MOTE_BURST.AMOUNT), count: BALANCE.FROST_MOTE_BURST.RADIUS }),
      t('passives.frostBurst.figure2', { count: BALANCE.FROST_MOTE_BURST.CHILL_TURNS }),
    ],
    trigger: "statMod",
  },

  soulFracture: {
    id: "soulFracture",
    figures: () => [
      t('passives.soulFracture.figure1', { count: BALANCE.SOUL_FRAGMENTS }),
      t('passives.soulFracture.figure2', { a: asPct(BALANCE.SOUL_REFORM_PER_FRAGMENT) }),
    ],
    // The save is what holds the body at 1 HP; the fragments themselves are laid by
    // the store (`breakSoul`), which can put units on the board and a passive cannot
    trigger: "statMod",
    interceptsLethal: true,
    onLethalSave: () => [],
  },

  painFeast: {
    id: "painFeast",
    figures: () => [
      t('passives.painFeast.figure1', { count: BALANCE.PAIN_FEAST_THRESHOLD }),
      t('passives.painFeast.figure2', { a: formatDecimal(BALANCE.PAIN_FEAST_DAMAGE, 2) }),
    ],
    // Counted where every blow is counted — `combatStore.damageUnit` — and spent when
    // the feast is announced (`eliteActions`)
    trigger: "statMod",
  },

  tanukiTrick: {
    id: "tanukiTrick",
    figures: () => [t('passives.tanukiTrick.figure1', { count: BALANCE.STEALTH_DURATION })],
    // Laid where every blow lands — `damageFunnel`
    trigger: "statMod",
  },

  // ── Jadeveil: Silk Hollow / Yokai ──────────────────────────────────────────
  // The Nue's two, both played at its turn start by the Yokai script
  // (`yokaiActions.beginNueTurn`); these entries are what the unit card says.
  nueThundercloud: {
    id: "nueThundercloud",
    figures: () => [t('passives.nueThundercloud.figure1', { count: BALANCE.NUE.SHOCK_TURNS })],
    trigger: "statMod",
  },

  nueSerpentTail: {
    id: "nueSerpentTail",
    figures: () => [t('passives.nueSerpentTail.figure1', { a: formatDecimal(BALANCE.NUE.TAIL_DAMAGE, 2) })],
    trigger: "statMod",
  },

  captainsAuthority: {
    id: "captainsAuthority",
    figures: () => [t('passives.captainsAuthority.figure1', { a: asPct(BALANCE.AUTHORITY_BONUS) })],
    // Worn by the Captain, handed out by `syncAuthority` as `AuraType.Authority`
    trigger: "statMod",
  },

  // ── The Beetle (Monk) ───────────────────────────────────────────────────────
  //
  // Rules, not performances: each is read where its moment already lives —
  // Meditate's refill (`skillResolution`), the funnel's soak and its share
  // (`damageFunnel`) — through `systems/combat/beetle.ts`. These entries state
  // the figures a rung moves.

  shellBreath: {
    id: "shellBreath",
    figures: (rank) => [
      t('passives.shellBreath.figure1', { a: formatDecimal(shellBreathChi(rank), 2) }),
      t('passives.shellBreath.figure2', { count: BALANCE.BEETLE.SHELL_BREATH_CHARGES }),
    ],
    trigger: "statMod",
    resolved: (rank) => shellBreathChi(rank),
  },

  hardenedShell: {
    id: "hardenedShell",
    figures: (rank) => [
      t('passives.hardenedShell.figure1', { count: hardenedShellReach(rank) }),
      t('passives.hardenedShell.figure2', { a: asPct(hardenedShellDashDamage(rank)) }),
    ],
    trigger: "statMod",
    resolved: (rank) => hardenedShellReach(rank),
  },

  shoulderToShoulder: {
    id: "shoulderToShoulder",
    figures: (rank) => [t('passives.shoulderToShoulder.figure1', { a: asPct(shoulderShare(rank)) })],
    trigger: "statMod",
    resolved: (rank) => shoulderShare(rank),
  },

  // ── The Beetle's side trees ──────────────────────────────────────────────

  /**
   * Second Watch, side tree A's starter: a Beetle holding it may stand two prepared
   * Reactions at once, where every other unit stands one. A declared rule, read by
   * `beetle.reactionLimit` wherever a Reaction is prepared (`reactionCast`).
   */
  secondWatch: {
    id: "secondWatch",
    figures: () => [t('passives.secondWatch.figure1', { count: BALANCE.BEETLE.SECOND_WATCH_REACTIONS })],
    trigger: "statMod",
    resolved: () => BALANCE.BEETLE.SECOND_WATCH_REACTIONS,
  },

  /**
   * Retribution: an attacker whose blow the Beetle took for an ally (Vengeful
   * Shell) or split with one (Carapace Bastion) is struck back by the Beetle, a
   * certain blow answered by Physical Defense. Worked by `beetleMoves.retribute`,
   * called by the resolver where the blow lands.
   */
  retribution: {
    id: "retribution",
    figures: (rank) => [t('passives.retribution.figure1', { a: formatDecimal(retributionStrike(rank), 2, { fixed: true }) })],
    trigger: "statMod",
    resolved: (rank) => retributionStrike(rank),
  },

  /**
   * Numbing Staff, side tree B's starter: the greatstaff's Basic Attack leaves the
   * enemy with less Attack and less Magic for its next turn, so it hits and casts
   * weaker. Read off the blow's own skill, like Bleeding Blades; a killing swing
   * numbs nobody.
   */
  numbingStaff: {
    id: "numbingStaff",
    figures: () => [
      t('passives.numbingStaff.figure1', { a: formatDecimal(BALANCE.BEETLE.NUMBING_ATTACK_DOWN, 2), b: formatDecimal(BALANCE.BEETLE.NUMBING_MAGIC_DOWN, 2) }),
      t('passives.numbingStaff.figure2'),
    ],
    trigger: "onHit",
    resolve: ({ self, other, amount = 0, skill, allUnits }) => {
      if (!other || amount <= 0 || skill?.id !== BASIC_ATTACK_ID) return [];
      const live = allUnits.find((u) => u.id === other.id);
      if (!live || live.currentHp <= 0) return [];
      const numb = (type: AfflictionType, magnitude: number, log: string): PassiveOutcome => ({
        kind: "effect",
        unitId: other.id,
        effect: { type, magnitude, duration: BALANCE.BEETLE.NUMBING_TURNS, sourceUnitId: self.id },
        log,
        color: "#9a7acc",
      });
      return [
        numb(AfflictionType.AttackDown, BALANCE.BEETLE.NUMBING_ATTACK_DOWN, passiveName("numbingStaff")),
        numb(AfflictionType.MagicDown, BALANCE.BEETLE.NUMBING_MAGIC_DOWN, ""),
      ];
    },
  },

  /**
   * Heavy Hands: Horn Sweep and Grip and Throw hit harder, on the skills'
   * multipliers like Hardened Shell's (`beetle.beetleStrikeMultiplier`), so the
   * boss blow of Grip and Throw is raised too.
   */
  heavyHands: {
    id: "heavyHands",
    figures: (rank) => [t('passives.heavyHands.figure1', { a: asPct(heavyHandsDamage(rank) - 1) })],
    trigger: "statMod",
    resolved: (rank) => heavyHandsDamage(rank),
  },

  /**
   * Planted Guard: from a turn the Beetle ended without a step of its own until
   * its next step, both defences harden. A shove, a throw or a Reaction's leap is
   * not a step (`voluntaryMoved`), so being moved does not break the stance.
   */
  plantedGuard: {
    id: "plantedGuard",
    figures: (rank) => [
      t('passives.plantedGuard.figure1', { a: formatDecimal(plantedGuardDefense(rank), 2) }),
      t('passives.plantedGuard.figure2'),
    ],
    trigger: "statMod",
    statMod: (unit, rank) => (planted(unit)
      ? { defense: plantedGuardDefense(rank), magicDefense: plantedGuardDefense(rank) }
      : {}),
    resolved: (rank) => plantedGuardDefense(rank),
  },

  // Advanced (level 21–25): Monk

  /**
   * Shell Ward (Beetle): at the start of each of the Beetle's turns, every living
   * ally beside it gains a Barrier worth `shellWardBarrier` of its Physical + Magic
   * Defense. A Barrier merges as the stronger of the two, so the ward tops up a
   * worn one and never shrinks a bigger one (a Shell Wall's). The base sheet stands
   * in for effective stats, as Meltwater's does: this module cannot reach `damageCalc`.
   */
  shellWard: {
    id: "shellWard",
    figures: (rank) => [
      t('passives.shellWard.figure1', { a: asPct(shellWardBarrier(rank)) }),
      t('passives.shellWard.figure2', { count: BALANCE.MONK_ADVANCED.SHELL_WARD_TURNS }),
    ],
    trigger: "onTurnStart",
    resolve: ({ self, allUnits }, rank) => {
      if (self.currentHp <= 0) return [];
      const magnitude = resolveEffectMagnitudeWith(self.stats, AuraType.Barrier, shellWardBarrier(rank), self, "defense");
      return allUnits
        .filter((u) => u.id !== self.id && u.currentHp > 0 && !u.objective && u.isPlayer === self.isPlayer
          && hexDistance(u.position, self.position) === 1)
        .map((ally): PassiveOutcome => ({
          kind: "effect",
          unitId: ally.id,
          effect: { type: AuraType.Barrier, magnitude, duration: BALANCE.MONK_ADVANCED.SHELL_WARD_TURNS, sourceUnitId: self.id },
          log: t('combatLog.log.shields', { source: passiveName('shellWard'), name: unitName(ally) }),
        }));
    },
    resolved: (rank) => shellWardBarrier(rank),
  },

  /**
   * Searing Light (Firefly): Glowmote's bolt, landing on a living enemy, lays Defense
   * Down — both defences — for its next turn. Re-laid, the stronger stands.
   */
  searingLight: {
    id: "searingLight",
    figures: (rank) => [
      t('passives.searingLight.figure1', { a: formatDecimal(searingLightShred(rank), 2) }),
      t('passives.searingLight.figure2'),
    ],
    trigger: "onHit",
    resolve: ({ self, other, amount = 0, skill, allUnits }, rank) => {
      if (!other || amount <= 0 || skill?.id !== "glowmote") return [];
      const live = allUnits.find((u) => u.id === other.id);
      if (!live || live.currentHp <= 0) return [];
      return [{
        kind: "effect",
        unitId: other.id,
        effect: {
          type: AfflictionType.DefenseDown,
          magnitude: searingLightShred(rank),
          duration: BALANCE.MONK_ADVANCED.SEARING_LIGHT_TURNS,
          sourceUnitId: self.id,
        },
        log: passiveName("searingLight"),
        color: "#ffcf5a",
      }];
    },
    resolved: (rank) => searingLightShred(rank),
  },

  /**
   * Reaping Stride (Mantis): a Twin Reap that struck an enemy and spent the turn's
   * action leaves a free step of `reapingStrideStep` hexes, through the reposition
   * Slipstream uses. **Once a turn** (the `spend` key), so nothing that hands the
   * Mantis another action in the same turn earns a second step; a bonus turn
   * (Threefold Scythe, Mantis Execution) is a turn of its own. Root or no free hex
   * grants nothing and spends nothing.
   */
  reapingStride: {
    id: "reapingStride",
    figures: (rank) => [t('passives.reapingStride.figure1', { count: reapingStrideStep(rank) }), t('passives.reapingStride.figure2')],
    trigger: "onSkillResolved",
    resolve: ({ self, spendsAction, damagedEnemy, skill, canStep, turnSpent }, rank) => {
      if (!spendsAction || !damagedEnemy || skill?.id !== "twin_reap" || self.currentHp <= 0) return [];
      const key = `reapingStride:${self.id}`;
      if (turnSpent?.includes(key)) return [];
      const step = reapingStrideStep(rank);
      if (!canStep?.(step)) return [];
      return [
        { kind: "spend", key },
        { kind: "reposition", unitId: self.id, range: step, color: "#7fd16a",
          log: t('combatLog.log.mayStep', { name: unitName(self), count: step }) },
      ];
    },
    resolved: (rank) => reapingStrideStep(rank),
  },
  // Advanced (level 26): Monk

  /**
   * Returned Blow (Beetle): the attacker of a blow a full Carapace soaked is struck
   * back, wherever it stands, a certain blow answered by Physical Defense. Worked by
   * `combatStore.carapaceSoaked`, which the funnel calls for the soak.
   */
  returnedBlow: {
    id: "returnedBlow",
    figures: (rank) => [
      t('passives.returnedBlow.figure1', { a: formatDecimal(returnedBlowStrike(rank), 2, { fixed: true }) }),
      t('passives.returnedBlow.figure2'),
    ],
    trigger: "statMod",
    resolved: (rank) => returnedBlowStrike(rank),
  },

  /**
   * Spilled Light (Firefly): the part of Glowmote's mote that restored nothing
   * strikes the enemy the bolt struck, fixed. Worked by `combatEvents.applyMote`.
   */
  spilledLight: {
    id: "spilledLight",
    figures: (rank) => [
      t('passives.spilledLight.figure1', { a: formatPercent(spilledLightShare(rank)) }),
      t('passives.spilledLight.figure2'),
    ],
    trigger: "statMod",
    resolved: (rank) => spilledLightShare(rank),
  },

  /**
   * Reaper's Breath (Mantis): a reap returns chi. Read by the resolver where Twin
   * Reap's reap lands, and paid after the cast's own price.
   */
  reapersBreath: {
    id: "reapersBreath",
    figures: (rank) => [t('passives.reapersBreath.figure1', { a: formatDecimal(reapersBreathChi(rank), 2) })],
    trigger: "statMod",
    resolved: (rank) => reapersBreathChi(rank),
  },
  // Advanced (level 21–25): Champion

  /**
   * Rallying Taunt, the Bulwark's advanced support node: every Taunt of the
   * Bulwark's that lands (`onTauntApplied`, so a boss that shrugs it off pays
   * nothing) gives each living ally within `RALLY_REACH` hexes Defense for a turn.
   * The Bulwark itself is not one of them — Braced owns its own Defense buff. The
   * store merges a Defense buff by keeping the stronger, so a Bellow that taunts
   * four enemies steadies each ally once, never four times.
   */
  rallyingTaunt: {
    id: "rallyingTaunt",
    figures: (rank) => [
      t('passives.rallyingTaunt.figure1', { a: formatDecimal(rallyDefense(rank), 2) }),
      t('passives.rallyingTaunt.figure2', { count: BALANCE.ADVANCED_CHAMPION.RALLY_REACH }),
    ],
    trigger: "onTauntApplied",
    resolved: (rank) => rallyDefense(rank),
    resolve: ({ self, allUnits }, rank) =>
      allUnits
        .filter((u) => u.id !== self.id && u.isPlayer === self.isPlayer && u.currentHp > 0
          && hexDistance(u.position, self.position) <= BALANCE.ADVANCED_CHAMPION.RALLY_REACH)
        .map((ally) => ({
          kind: "effect" as const,
          unitId: ally.id,
          effect: {
            type: AuraType.DefenseBuff,
            magnitude: rallyDefense(rank),
            duration: BALANCE.ADVANCED_CHAMPION.RALLY_TURNS,
            sourceUnitId: self.id,
          },
          log: passiveName("rallyingTaunt"),
        })),
  },

  /**
   * Red Mist, the Berserker's advanced node: critical chance while at or below
   * `RED_MIST_AT` of its fighting maximum. A stat while it holds, like Wrath, so
   * the sheet shows it exactly when the fight rolls it.
   */
  redMist: {
    id: "redMist",
    figures: (rank) => [
      t('passives.redMist.figure1', { a: formatDecimal(redMistCrit(rank), 2) }),
      t('passives.redMist.figure2', { a: asPct(BALANCE.ADVANCED_CHAMPION.RED_MIST_AT) }),
    ],
    trigger: "statMod",
    resolved: (rank) => redMistCrit(rank),
    statMod: (unit, rank) =>
      isBelow(unit, BALANCE.ADVANCED_CHAMPION.RED_MIST_AT) ? { critChance: redMistCrit(rank) } : {},
  },

  // Advanced (level 21–25): Hunter

  /**
   * Eagle Eye, the Marksman's advanced node: critical chance against an enemy
   * carrying this unit's own Mark — the same owner check `markMultiplier` makes, so
   * another Marksman's quarry is not this one's. Per target, never a stat.
   */
  eagleEye: {
    id: "eagleEye",
    figures: (rank) => [t('passives.eagleEye.figure1', { a: formatDecimal(eagleEyeCrit(rank), 2) }), t('passives.eagleEye.figure2')],
    trigger: "statMod",
    resolved: (rank) => eagleEyeCrit(rank),
    critAgainst: (target, rank, attacker) =>
      target.activeEffects.some((e) => e.type === AfflictionType.Mark && e.sourceUnitId === attacker.id)
        ? eagleEyeCrit(rank)
        : 0,
  },

  /**
   * Open Seams, the Skirmisher's advanced node: critical chance against an enemy
   * with at least one of this unit's blades in it (`ownBlades`), read off the
   * target as the strike is rolled — so a cast's first blade does not sharpen
   * its own throw, and an extraction rolls against the blades it is about to pull.
   */
  openSeams: {
    id: "openSeams",
    figures: (rank) => [t('passives.openSeams.figure1', { a: formatDecimal(openSeamsCrit(rank), 2) }), t('passives.openSeams.figure2')],
    trigger: "statMod",
    resolved: (rank) => openSeamsCrit(rank),
    critAgainst: (target, rank, attacker) => (ownBlades(target, attacker.id) > 0 ? openSeamsCrit(rank) : 0),
  },

  /**
   * Unseen Blade, the Shadowblade's advanced node: critical chance while the unit
   * is Stealthed. A stat while it holds, so the strike that breaks Stealth
   * (`applyOnHitStatuses`, after the roll) is the one it sharpens.
   */
  unseenBlade: {
    id: "unseenBlade",
    figures: (rank) => [t('passives.unseenBlade.figure1', { a: formatDecimal(unseenBladeCrit(rank), 2) }), t('passives.unseenBlade.figure2')],
    trigger: "statMod",
    resolved: (rank) => unseenBladeCrit(rank),
    statMod: (unit, rank) => (hasEffect(unit, AuraType.Stealth) ? { critChance: unseenBladeCrit(rank) } : {}),
  },

  // Advanced (level 26): Hunter

  /**
   * Next Quarry, the Marksman's level-26 node: when an enemy wearing this unit's Mark
   * dies, the Mark passes to the nearest enemy near the corpse that can wear one and
   * does not already wear this unit's, so a pass is never wasted, for the turns it had
   * left and at least `NEXT_QUARRY_MIN_TURNS`. Resolved in
   * `combatStore.spreadMark`, down every path a unit can die by. A Basic Attack that
   * cashed the Mark removed it before the blow landed, so that kill passes nothing.
   */
  nextQuarry: {
    id: 'nextQuarry',
    figures: (rank) => [
      t('passives.nextQuarry.figure1', { count: nextQuarryReach(rank) }),
      t('passives.nextQuarry.figure2', { count: nextQuarryMinTurns() }),
      t('passives.nextQuarry.figure3'),
    ],
    trigger: 'onDeath',
    resolved: (rank) => nextQuarryReach(rank),
    resolve: ({ self, other: corpse, mark, allUnits }, rank) => {
      if (!corpse || !mark) return [];
      const reach = nextQuarryReach(rank);
      const [next] = allUnits
        .filter((u) =>
          u.id !== corpse.id && u.currentHp > 0 && u.isPlayer === corpse.isPlayer && !u.objective
          && !u.activeEffects.some((e) => e.type === AfflictionType.Mark && e.sourceUnitId === self.id)
          && !isImmuneTo(u, AfflictionType.Mark) && !isSealed(u) && !isSuspended(u)
          && (!hasEffect(u, AuraType.DebuffImmunity) || piercesImmunity(self))
          && hexDistance(u.position, corpse.position) <= reach)
        .sort((a, b) =>
          hexDistance(a.position, corpse.position) - hexDistance(b.position, corpse.position)
          || a.currentHp - b.currentHp || a.id.localeCompare(b.id));
      if (!next) return [];
      return [{
        kind: 'effect', unitId: next.id, log: '', silent: true,
        effect: {
          type: AfflictionType.Mark, magnitude: mark.magnitude, sourceUnitId: self.id,
          duration: Math.max(mark.duration, nextQuarryMinTurns()),
        },
      }];
    },
  },

  /**
   * Into the Dark, the Shadowblade's level-26 node: a kill this unit's blow makes
   * brings Shadowstep's cooldown forward. `onKill` fires from `applyOnHitStatuses`, so
   * a poison tick and the Assassinate execution do not count. A step that kills with
   * its own blow starts its cooldown after this has fired, and `resolveSkillUse`
   * brings that one forward once it has started.
   */
  intoTheDark: {
    id: 'intoTheDark',
    figures: (rank) => [t('passives.intoTheDark.figure1', { count: intoTheDarkTurns(rank) }), t('passives.intoTheDark.figure2')],
    trigger: 'onKill',
    resolved: (rank) => intoTheDarkTurns(rank),
    resolve: ({ self }, rank) => ((self.cooldowns?.[SHADOWSTEP_ID] ?? 0) > 0
      ? [{ kind: 'refundCooldown', unitId: self.id, turns: intoTheDarkTurns(rank), log: passiveName('intoTheDark'), onlyIds: [SHADOWSTEP_ID] }]
      : []),
  },
};

/**
 * Whether a unit is planted (Planted Guard): its last turn ended without a step
 * of its own, and it has not stepped since. Not on a unit's first turn of a fight.
 */
export const planted = (unit: Pick<CombatUnit, 'previousTurnStationary' | 'voluntaryMoved'>): boolean =>
  unit.previousTurnStationary === true && !unit.voluntaryMoved;

// ─── Text ─────────────────────────────────────────────────────────────────────

/** The numbers some descriptions quote, read from the rules when shown. */
const DESCRIPTION_PARAMS: Partial<Record<PassiveId, () => MessageParams>> = {
  painFeast: () => ({ threshold: BALANCE.PAIN_FEAST_THRESHOLD }),
  captainsAuthority: () => ({ bonus: asPct(BALANCE.AUTHORITY_BONUS) }),
  frostBurst: () => ({ share: asPct(BALANCE.FROST_MOTE_BURST.AMOUNT), count: BALANCE.FROST_MOTE_BURST.RADIUS }),
};

/** A passive's name ("Bloodscent" / "Woń krwi"): `passives.<id>.name`. */
export function passiveName(id: PassiveId): string {
  return t(`passives.${id}.name` as MessageKey);
}

/** A passive's one-line description: `passives.<id>.description`. */
export function passiveDescription(id: PassiveId): string {
  return t(`passives.${id}.description` as MessageKey, DESCRIPTION_PARAMS[id]?.());
}

// ─── Queries ──────────────────────────────────────────────────────────────────

const defsOf = (unit: CombatUnit): PassiveDef[] =>
  (unit.passives ?? []).map((id) => PASSIVE_DEFS[id]).filter(Boolean);

/**
 * Afterglow's two buffs, laid by `healerId` at this rung. Exported so Lantern
 * Breath, which heals on a store tick where no `onHeal` is raised, lays the very
 * same pair (`fireflyRules.lanternBreathShares`).
 */
export function afterglowEffects(healerId: string, rank: PassiveRank): ActiveEffect[] {
  const F = BALANCE.FIREFLY;
  return [
    { type: AuraType.AttackBuff, magnitude: afterglowPoints(F.AFTERGLOW_ATTACK, rank), duration: F.AFTERGLOW_DURATION, sourceUnitId: healerId },
    { type: AuraType.MagicBuff, magnitude: afterglowPoints(F.AFTERGLOW_MAGIC, rank), duration: F.AFTERGLOW_DURATION, sourceUnitId: healerId },
  ];
}

/**
 * Afterglow's points at a rung: a point a rung around the authored middle value
 * (1 / 2 / 3). The scale cannot ladder a 2 — 1.5 and 2 round together — and a
 * rung that buys nothing is the one thing a ranked node must not offer.
 */
export function afterglowPoints(authored: number, rank: PassiveRank): number {
  return Math.max(1, authored + rank.level - 2);
}

export function hasPassive(unit: CombatUnit, id: PassiveId): boolean {
  return (unit.passives ?? []).includes(id);
}

/**
 * The factor on all damage this unit takes right now: Last Stand's reduction once it
 * holds, 1 otherwise. Read where health is taken — `damageUnit` and the effect tick —
 * so a blow, a damage-over-time tick, a Doom and a reflection are reduced alike.
 */
function incomingDamageScale(unit: CombatUnit): number {
  if (!hasPassive(unit, 'lastStand') || !isBelow(unit, LAST_STAND_AT)) return 1;
  return 1 - lastStandReduction(passiveRank(unit, 'lastStand'));
}

/** Whether Last Stand holds on this unit right now: it has the passive and is hurt enough for it to bite. */
export const lastStandHolds = (unit: CombatUnit): boolean => incomingDamageScale(unit) < 1;

/** `amount` after `incomingDamageScale`. Rounded, and a hit that lands is never reduced to 0. */
export function reduceIncoming(unit: CombatUnit, amount: number): number {
  const scale = incomingDamageScale(unit);
  if (scale === 1 || amount <= 0) return amount;
  return Math.max(1, Math.round(amount * scale));
}

/**
 * Everything that should happen because `trigger` just fired.
 *
 * Pure. The caller applies the result; nothing here reads or writes the store,
 * which is what lets every passive be tested against a plain object.
 */
export function resolvePassives(
  trigger: PassiveTriggerArg,
  ctx: PassiveContext,
): PassiveOutcome[] {
  const outcomes: PassiveOutcome[] = [];
  for (const def of defsOf(ctx.self)) {
    if (def.trigger !== trigger || !def.resolve) continue;
    outcomes.push(...def.resolve(ctx, passiveRank(ctx.self, def.id)));
  }
  return outcomes;
}

/**
 * Critical chance, in points, the attacker's passives add against this target.
 * Zero for most targets: every contribution is conditional on the target.
 */
export function critBonusAgainst(attacker: CombatUnit, target: CombatUnit): number {
  let total = 0;
  for (const def of defsOf(attacker)) {
    if (def.critAgainst) total += def.critAgainst(target, passiveRank(attacker, def.id), attacker);
  }
  return total;
}

/**
 * Penetration, in points, the attacker's passives add against this target with this
 * skill — against whichever defence answers the hit, and only from passives that pierce
 * that defence. Zero for most hits: every contribution is conditional.
 */
export function penetrationAgainst(attacker: CombatUnit, target: CombatUnit, skill: HeroSkill): number {
  // Settle In's charge, carried as an aura so the HUD shows it and a cast can spend it.
  // Armour penetration: a magic ranged cast still spends it but is not sharpened by it.
  let total = settleInApplies(skill) && damageTypeOf(skill) === 'physical'
    ? attacker.activeEffects.find((e) => e.type === AuraType.SettledAim)?.magnitude ?? 0
    : 0;
  for (const def of defsOf(attacker)) {
    if (def.penAgainst) total += def.penAgainst(target, skill, passiveRank(attacker, def.id));
  }
  return total;
}

/**
 * The turns Deep Cold adds to a Chill `caster` lays on `target`: nothing unless the
 * caster owns it and the target is beyond immediate reach. The one reader the
 * application, the skill preview and the tests share.
 */
export function deepColdExtraTurns(caster: CombatUnit, target: CombatUnit): number {
  if (!hasPassive(caster, "deepCold") || !isFarChill(caster, target)) return 0;
  return deepColdTurns(passiveRank(caster, "deepCold"));
}

/** Whether this passive's lethal save applies to the unit as it currently stands. */
const savesUnit = (def: PassiveDef, unit: CombatUnit): boolean =>
  typeof def.interceptsLethal === "function"
    ? def.interceptsLethal(unit)
    : !!def.interceptsLethal;

/** What this unit's passives add to its stats, folded into `getCombatEffectiveStats`. */
export function passiveStatMods(unit: CombatUnit): Partial<HeroStats> {
  const total: Partial<HeroStats> = {};
  for (const def of defsOf(unit)) {
    if (!def.statMod) continue;
    for (const [key, value] of Object.entries(def.statMod(unit, passiveRank(unit, def.id))) as [
      keyof HeroStats,
      number | undefined,
    ][]) {
      if (value === undefined) continue;
      total[key] = (total[key] ?? 0) + value;
    }
  }
  return total;
}

/** Whether a passive refuses this status outright, before `DebuffImmunity` is consulted. */
export function isImmuneTo(unit: CombatUnit, type: StatusEffectType): boolean {
  return defsOf(unit).some((def) => def.immuneTo?.includes(type));
}

export function isImmuneToPush(unit: CombatUnit): boolean {
  return defsOf(unit).some((def) => def.immuneToPush);
}

/**
 * Whether afflictions this unit applies ignore the target's `DebuffImmunity`.
 *
 * Only Last Stand grants it, and only while its owner is nearly dead — an
 * unconditional version would quietly delete the counterplay that boss-tier
 * immunity exists to provide.
 */
export function piercesImmunity(unit: CombatUnit): boolean {
  return defsOf(unit).some((def) => def.piercesImmunity?.(unit));
}

/**
 * Whether this hit should leave the unit at 1 HP instead of killing it.
 *
 * Checked before the HP write rather than after, and from every path that
 * subtracts health — including damage-over-time. A save that only caught skill
 * damage would let a burning hero die to the tick with Undying still unspent,
 * which reads as the passive being broken rather than as a rule.
 */
export function survivesLethal(
  unit: CombatUnit,
  incomingDamage: number,
): boolean {
  if (incomingDamage < unit.currentHp) return false;
  if (hasEffect(unit, AuraType.UndyingSpent)) return false;
  return defsOf(unit).some((def) => savesUnit(def, unit));
}

/**
 * What the save does beyond leaving the unit at 1 HP.
 *
 * Pure, like everything else here: `damageUnit` calls it at the moment it
 * decides not to kill somebody, and applies whatever comes back.
 */
export function lethalSaveOutcomes(
  unit: CombatUnit,
  attacker?: CombatUnit,
): PassiveOutcome[] {
  return defsOf(unit)
    .filter((def) => savesUnit(def, unit) && def.onLethalSave)
    .flatMap((def) =>
      def.onLethalSave!({ self: unit, allUnits: [], other: attacker }, passiveRank(unit, def.id)),
    );
}

/** The marker recording that a unit has spent its save for this battle. */
export const UNDYING_SPENT_EFFECT: ActiveEffect = {
  type: AuraType.UndyingSpent,
  magnitude: 1,
  duration: -1,
};
