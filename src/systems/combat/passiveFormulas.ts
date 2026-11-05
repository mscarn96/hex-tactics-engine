import { ActiveEffect, CombatUnit, PassiveRank } from "@/models/types";
import { magicDefenseOf } from '@/systems/combat/damageType';
import { BALANCE } from "@/data/balanceConstants";
import { burnPerStack } from "@/systems/combat/statusEffects";


/**
 * How much defence Braced may stack to at this rung.
 *
 * Named once because the resolver and `figures` must not disagree about it, and
 * they are the two halves that told a player different things when the step was
 * the scaled number: the panel promised the rung moved something and the fight
 * did not. Rounded because defence is a whole stat and the cap is compared
 * against one.
 */
export const bracedCeiling = (rank: PassiveRank): number =>
  Math.round(BALANCE.BRACED_MAX * rank.scale);


/**
 * Every magnitude a node level scales, named once.
 *
 * `PassiveRank.scale` multiplies whatever a passive grants by 0.75 / 1.0 / 1.25,
 * and the authored number here is the **level-2** value — so each of these has
 * to be a single figure the scale can be applied to, rather than arithmetic
 * spread through a resolver where only two thirds of it would move. That is why
 * a literal in a resolver is a bug in waiting and every one of them has been
 * lifted up here: `nodeLevels.test.ts` sweeps the ranks and cannot see a number
 * it has no name for.
 */
/** Rhythm's loud turn, as a fraction of the unit's own attack. */
export const CADENCE_ATTACK = 0.35;

/** Slow Burn's magic per stack, and how many it may hold. */
export const KINDLE_MAGIC_STEP = 0.2;

export const KINDLE_MAX_STACKS = 3;

/** Odds Shatterstep and Thunderhead hand the turn back. */
export const SHATTERSTEP_CHANCE = 0.35;

export const THUNDERHEAD_CHANCE = 0.25;

/** The health Second Skin leaves the Druid standing in. */
export const SECOND_SKIN_HP = 0.3;

/** The share of a beast's damage Verdant Blood drinks back. */
export const VERDANT_BLOOD_SHARE = 0.3;

/** The max health Bloodscent returns on a kill. */
export const BLOODSCENT_HEAL = 0.15;

/** The share of a blow Retaliation sends back. */
export const RETALIATION_SHARE = 0.15;

/** The share of a heal Lifebloom leaves behind as a heal-over-time. */
export const LIFEBLOOM_SHARE = 0.25;


/** Second Spring's damage reduction at a rung, in whole percent. */
export const secondSpringReduction = (rank: PassiveRank): number =>
  Math.round(BALANCE.SECOND_SPRING_REDUCTION * rank.scale);

/** Crit chance, in points, Momentum grants for a turn after moving. */
export const MOMENTUM_CRIT = 15;

/** Where Last Stand opens. */
export const LAST_STAND_AT = 0.3;


/**
 * The Magic Defense an Oath ward is worth to `recipient` at a rung.
 *
 * A share of the recipient's own Magic Defense with a floor, scaled by the rung
 * after the floor is applied so the floor cannot flatten the three ranks into
 * one number on a low-defence ally.
 */
export const oathWard = (recipient: CombatUnit, rank: PassiveRank): number =>
  Math.round(
    Math.max(BALANCE.OATH_MIN_WARD, magicDefenseOf(recipient.stats) * BALANCE.OATH_WARD_SHARE) *
      rank.scale,
  );


/** Carrying Word: what the next most wounded ally gets of a heal Smite spilled, the share read off the node's rank. */
export const carriedHeal = (amount: number, share: number): number => Math.round(amount * share);


/** Physical and Magic Defense Crumble strips while the Stoneshaper's Stun or Root stands, at a rung. */
export const crumbleShred = (rank: PassiveRank): number => rung(BALANCE.CRUMBLE_SHRED, rank);


/** Aftershock's repeat eruption, as a share of the Stoneshaper's Magic, at a rung. */
export const aftershockMultiplier = (rank: PassiveRank): number => rung(BALANCE.AFTERSHOCK_MAGIC, rank);


/** Rubble Recovery's heal, as a share of the Stoneshaper's Magic, at a rung. */
export const rubbleRecoveryMultiplier = (rank: PassiveRank): number => rung(BALANCE.RUBBLE_RECOVERY_MAGIC, rank);

/** Stone's Answer's blow, as a share of the Stoneshaper's Magic, at a rung. */
export const stonesAnswerMagic = (rank: PassiveRank): number => BALANCE.ADVANCED_DRUID.STONES_ANSWER_MAGIC * rank.scale;


/** Physical and Magic Defense Unyielding grants while a Barrier stands, at a rung. */
export const unyieldingDefense = (rank: PassiveRank): number =>
  Math.round(BALANCE.UNYIELDING_DEFENSE * rank.scale);


/** Extra hexes Seismic Sense lends at a rung. Authored per rung, not scaled. */
export const seismicSenseMove = (rank: PassiveRank): number =>
  BALANCE.SEISMIC_SENSE_MOVE[rank.level - 1] ?? BALANCE.SEISMIC_SENSE_MOVE[1];


/** The extra Bleed tick Savage Edge lands off a Bleed, at a rung. At least one point. */
export const savageEdgeTick = (bleed: ActiveEffect, rank: PassiveRank): number =>
  Math.max(1, Math.round(bleed.magnitude * BALANCE.SAVAGE_EDGE_TICK * rank.scale));


/** Critical chance Killing Eye adds against a Bleeding enemy, at a rung. */
export const killingEyeCrit = (rank: PassiveRank): number =>
  Math.round(BALANCE.KILLING_EYE_CRIT * rank.scale);


/** Mana Firemind takes off Cinder Burst per Burn stack beyond the first, at a rung. */
export const firemindPerStack = (rank: PassiveRank): number =>
  Math.round(BALANCE.FIREMIND_DISCOUNT_PER_STACK * rank.scale);


/**
 * Mana off a Cinder Burst that spends `stacks` Burn stacks, from a base price.
 * Nothing for one stack; never more than a fixed share of the price, so the
 * skill is cheaper, not free.
 */
export const firemindDiscount = (rank: PassiveRank, stacks: number, baseCost: number): number =>
  Math.min(
    Math.max(0, stacks - 1) * firemindPerStack(rank),
    Math.floor(baseCost * BALANCE.FIREMIND_MAX_DISCOUNT_SHARE),
  );


/** How far from a dying enemy Spark's stack may land, at a rung. */
export const sparkRange = (rank: PassiveRank): number =>
  BALANCE.SPARK_RANGE[rank.level - 1] ?? BALANCE.SPARK_RANGE[1];


/** The Burn Spark passes on: one stack's share of the dying enemy's pile, scaled by the rung. */
export const sparkMagnitude = (burn: ActiveEffect, rank: PassiveRank): number =>
  Math.max(1, burnPerStack(burn) * rank.scale);


/** Rounds Detonation's burning hex lasts, at a rung. */
export const detonationRounds = (rank: PassiveRank): number =>
  BALANCE.DETONATION_GROUND_TURNS[rank.level - 1] ?? BALANCE.DETONATION_GROUND_TURNS[1];


/** What a burning hex puts on an enemy that begins its turn there: one stack, scaled by the rung. */
export const detonationGroundMagnitude = (burn: ActiveEffect, rank: PassiveRank): number =>
  Math.max(1, burnPerStack(burn) * rank.scale);


/** Extra damage Shatterpoint adds to the blow that breaks a Freeze (the blow itself, without the ice's burst), at a rung. */
export const shatterpointBonus = (blow: number, rank: PassiveRank): number =>
  Math.max(1, Math.round(blow * BALANCE.SHATTERPOINT_BONUS * rank.scale));


/** Flying Shards: what a shard is worth in Magic, at a rung. */
export const flyingShardsMagic = (rank: PassiveRank): number =>
  BALANCE.ARCANIST_ROW_TWO.SHARD_MAGIC * rank.scale;

/** Flying Shards: one shard, from the thrower's effective Magic. */
export const flyingShardsDamage = (magic: number, rank: PassiveRank): number =>
  Math.max(1, Math.round(magic * flyingShardsMagic(rank)));

/** The flat Barrier Meltwater raises, at a rung (before the caster's shield bonuses). */
export const meltwaterBarrier = (rank: PassiveRank): number =>
  Math.max(1, Math.round(BALANCE.MELTWATER_BARRIER * rank.scale));


/** Turns Deep Cold adds to a Chill cast from beyond immediate reach, at a rung. */
export const deepColdTurns = (rank: PassiveRank): number =>
  BALANCE.DEEP_COLD_EXTRA_TURNS[rank.level - 1] ?? BALANCE.DEEP_COLD_EXTRA_TURNS[1];


/** Magic penetration, in points, Killing Frost adds to magic hits on a Chilled enemy, at a rung. */
export const killingFrostPen = (rank: PassiveRank): number =>
  Math.round(BALANCE.KILLING_FROST_PEN * rank.scale);


/** The fraction of damage Overload adds to the next lightning bolt, at a rung. */
export const overloadBonus = (rank: PassiveRank): number => BALANCE.OVERLOAD_BONUS * rank.scale;


/** Mark and Move's reposition, in hexes, at a rung. */
export const markAndMoveRange = (rank: PassiveRank): number =>
  BALANCE.MARK_AND_MOVE_RANGE[Math.min(2, Math.max(0, rank.level - 1))];


/** Settle In's armour penetration, in points, at a rung. */
export const settleInPen = (rank: PassiveRank): number =>
  Math.round(BALANCE.SETTLE_IN_PEN * rank.scale);


/** Slipstream's free step, in hexes, at a rung. */
export const slipstreamStep = (rank: PassiveRank): number =>
  BALANCE.SLIPSTREAM_STEP[Math.min(2, Math.max(0, rank.level - 1))];


/** Shadow Echo's return price, in mana: flat, the rungs add to the return instead. */
export const shadowEchoCost = (): number => BALANCE.SHADOW_ECHO_COST;

/** What a Shadow Echo return adds at a rung: Stealth, and a certain critical hit out of it. */
export const shadowEchoPerks = (rank: PassiveRank): { stealth: boolean; crit: boolean } => ({
  stealth: rank.level >= BALANCE.SHADOW_ECHO_STEALTH_RANK,
  crit: rank.level >= BALANCE.SHADOW_ECHO_CRIT_RANK,
});

/**
 * The magnitude of the Stealth a Shadow Echo return grants at the crit rung, which
 * is how the attack out of it knows it is owed a critical hit. Every other Stealth
 * is magnitude 1, and nothing else reads a Stealth's magnitude.
 */
export const ECHO_STEALTH_MARK = 2;


/** Sharpened Steel's armour penetration, in points, at a rung. */
export const sharpenedSteelPen = (rank: PassiveRank): number =>
  Math.round(BALANCE.SHARPENED_STEEL_PEN * rank.scale);



/** A per-rung ladder read at a rank, the middle rung when the rank is out of range. */
export const rung = (ladder: readonly number[], rank: PassiveRank): number =>
  ladder[rank.level - 1] ?? ladder[1];


/** The share of Attack Shielded Challenge's Barrier is worth, at a rung. Authored per rung. */
export const shieldedChallengeShare = (rank: PassiveRank): number =>
  rung(BALANCE.SHIELDED_CHALLENGE_BARRIER, rank);


/** Blood Rush: Bloodthirst's dash in hexes at a rung — exactly 1 / 2 / 3, never scaled again. */
export const bloodRushDash = (rank: PassiveRank): number => rung(BALANCE.BLOOD_RUSH_DASH, rank);


/** The share of all incoming damage Last Stand takes off once it holds, at a rung. */
export const lastStandReduction = (rank: PassiveRank): number =>
  rung(BALANCE.LAST_STAND_REDUCTION, rank);


/** Odds a hit taken while taunting makes Vengeance cut a turn off the cooldowns, at a rung. */
export const vengeanceChance = (rank: PassiveRank): number =>
  rung(BALANCE.VENGEANCE_CHANCE, rank);


/**
 * Health missing per point of attack Wrath grants, **per rank**.
 *
 * Authored rather than scaled because the rung runs the wrong way — a *smaller*
 * threshold is stronger — and `8 / 0.75` is 10.67 rather than the 16 intended.
 * Level 3 is the value Wrath shipped at; the two below it are the retune.
 */
export const WRATH_THRESHOLD = [0.16, 0.12, 0.08] as const;


// ─── Mantis ───────────────────────────────────────────────────────────────────
//
// The Mantis's side-tree passives, named once for the resolver and the panel's
// `figures` (`BALANCE.MANTIS`).

/** Fresh Kill: the chi a kill restores, at a rung. */
export const freshKillChi = (rank: PassiveRank): number =>
  Math.round(BALANCE.MANTIS.FRESH_KILL_CHI * rank.scale);

/** Evasive Weave: Dodge Chance, in points, after a move, at a rung. */
export const evasiveWeaveDodge = (rank: PassiveRank): number =>
  Math.round(BALANCE.MANTIS.EVASIVE_WEAVE_DODGE * rank.scale);

// ─── Beetle ───────────────────────────────────────────────────────────────────
//
// The Beetle's three feeder passives, named once for the resolver, the panel's
// `figures` and `systems/combat/beetle.ts` alike (`BALANCE.BEETLE`).

/** Shell Breath: the chi Meditate restores on top of its own, at a rung. */
export const shellBreathChi = (rank: PassiveRank): number =>
  Math.round(BALANCE.BEETLE.SHELL_BREATH_CHI * rank.scale);

/** Hardened Shell: Iron Carapace's reach at a rung (2 / 3 / 4). */
export const hardenedShellReach = (rank: PassiveRank): number =>
  BALANCE.BEETLE.HARDENED_SHELL_REACH + Math.max(0, rank.level - 1);

/** Hardened Shell: the share of Iron Carapace's damage its dash-strike deals at a rung (⅓ / ⅔ / all). */
export const hardenedShellDashDamage = (rank: PassiveRank): number => {
  const shares = BALANCE.BEETLE.HARDENED_SHELL_DASH_DAMAGE;
  return shares[Math.min(shares.length, Math.max(1, rank.level)) - 1];
};

/** Shoulder to Shoulder: the share of a blow an ally beside the Beetle does not take, at a rung. */
export const shoulderShare = (rank: PassiveRank): number =>
  BALANCE.BEETLE.SHOULDER_REDUCTION * rank.scale;

// The Beetle's side trees (`BALANCE.BEETLE`), ranked like the feeders: the authored
// number is rank two's.

/** Retribution: the strike at an attacker whose blow the Beetle took or split, as a multiple of Attack, at a rung. */
export const retributionStrike = (rank: PassiveRank): number =>
  BALANCE.BEETLE.RETRIBUTION_STRIKE * rank.scale;

/** Heavy Hands: Horn Sweep's and Grip and Throw's multiplier, as a factor on their authored one, at a rung (1.2 at rank two). */
export const heavyHandsDamage = (rank: PassiveRank): number =>
  1 + BALANCE.BEETLE.HEAVY_HANDS * rank.scale;

/** Planted Guard: Physical and Magic Defense each, while the Beetle holds its ground, at a rung (3 / 4 / 5). */
export const plantedGuardDefense = (rank: PassiveRank): number =>
  Math.round(BALANCE.BEETLE.PLANTED_GUARD_DEFENSE * rank.scale);

/**
 * Steady Flame: the chi the Firefly regains from a cast that heals an ally, a
 * point a rung around the authored middle value (2 / 3 / 4) — the scale cannot
 * ladder a 3 into three different whole numbers.
 */
export const steadyFlameChi = (rank: PassiveRank): number =>
  Math.max(1, BALANCE.FIREFLY.STEADY_FLAME_CHI + rank.level - 2);

/** Second Light: the Barrier's factor of the Firefly's Magic, at a rung (0.5 at rank two). */
export const secondLightBarrier = (rank: PassiveRank): number =>
  Math.round(BALANCE.FIREFLY.SECOND_LIGHT_BARRIER * rank.scale * 1000) / 1000;

// Advanced (level 21–25): Monk

/** Shell Ward: the ally Barrier's factor of the Beetle's Physical + Magic Defense, at a rung (0.2 at rank two). */
export const shellWardBarrier = (rank: PassiveRank): number =>
  Math.round(BALANCE.MONK_ADVANCED.SHELL_WARD_BARRIER * rank.scale * 1000) / 1000;

/** Searing Light: the Defense Down Glowmote's bolt lays, both defences, at a rung (4 / 5 / 6). */
export const searingLightShred = (rank: PassiveRank): number =>
  Math.round(BALANCE.MONK_ADVANCED.SEARING_LIGHT_DEFENSE_DOWN * rank.scale);

/** Reaping Stride: the free step after a Twin Reap, in hexes, at a rung (1 / 2 / 3). */
export const reapingStrideStep = (rank: PassiveRank): number =>
  BALANCE.MONK_ADVANCED.REAPING_STRIDE_STEP[Math.min(2, Math.max(0, rank.level - 1))];

// Advanced (level 26): Monk

/** Returned Blow: the strike at the attacker of a blow a full Carapace soaked, as a multiple of Attack, at a rung (0.75 / 1 / 1.25). */
export const returnedBlowStrike = (rank: PassiveRank): number =>
  BALANCE.BEETLE.RETURNED_BLOW_STRIKE * rank.scale;

/** Spilled Light: the share of a mote's unused part that strikes the bolt's enemy, at a rung (45 / 60 / 75%). */
export const spilledLightShare = (rank: PassiveRank): number =>
  Math.round(BALANCE.FIREFLY.SPILLED_LIGHT_SHARE * rank.scale * 1000) / 1000;

/** Reaper's Breath: the chi a reap returns, at a rung (4 / 6 / 8). */
export const reapersBreathChi = (rank: PassiveRank): number =>
  BALANCE.MANTIS.REAPERS_BREATH_CHI[Math.min(2, Math.max(0, rank.level - 1))];
// Advanced (level 21–25): Champion

/** Rallying Taunt: Defense each ally within reach gains when a Taunt lands, at a rung (3 / 4 / 5). */
export const rallyDefense = (rank: PassiveRank): number =>
  Math.round(BALANCE.ADVANCED_CHAMPION.RALLY_DEFENSE * rank.scale);

/** Red Mist: critical chance (points) while at or below `RED_MIST_AT` health, at a rung (9 / 12 / 15). */
export const redMistCrit = (rank: PassiveRank): number =>
  Math.round(BALANCE.ADVANCED_CHAMPION.RED_MIST_CRIT * rank.scale);

// Advanced (level 21–25): Hunter

/** Eagle Eye: critical chance (points) against an enemy this unit has Marked, at a rung (11 / 15 / 19). */
export const eagleEyeCrit = (rank: PassiveRank): number =>
  Math.round(BALANCE.ADVANCED_HUNTER.EAGLE_EYE_CRIT * rank.scale);

/** Open Seams: critical chance (points) against an enemy carrying this unit's blades, at a rung (9 / 12 / 15). */
export const openSeamsCrit = (rank: PassiveRank): number =>
  Math.round(BALANCE.ADVANCED_HUNTER.OPEN_SEAMS_CRIT * rank.scale);

/** Unseen Blade: critical chance (points) while Stealthed, at a rung (19 / 25 / 31). */
export const unseenBladeCrit = (rank: PassiveRank): number =>
  Math.round(BALANCE.ADVANCED_HUNTER.UNSEEN_BLADE_CRIT * rank.scale);

/** Next Quarry: how far from the corpse a Mark can pass, at a rung (2 / 3 / 4). */
export const nextQuarryReach = (rank: PassiveRank): number =>
  BALANCE.ADVANCED_HUNTER.NEXT_QUARRY_REACH[Math.min(2, Math.max(0, rank.level - 1))];

/** Next Quarry: the fewest turns a passed Mark stands for. */
export const nextQuarryMinTurns = (): number => BALANCE.ADVANCED_HUNTER.NEXT_QUARRY_MIN_TURNS;

/** Into the Dark: turns a kill brings Shadowstep's cooldown forward, at a rung (1 / 2 / 3). */
export const intoTheDarkTurns = (rank: PassiveRank): number =>
  BALANCE.ADVANCED_HUNTER.INTO_THE_DARK_TURNS[Math.min(2, Math.max(0, rank.level - 1))];
