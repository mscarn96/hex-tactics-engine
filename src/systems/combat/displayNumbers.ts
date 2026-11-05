import { BALANCE } from '@/data/balanceConstants';
import type { CombatUnit } from '@/models/types';
import { bladesCapOf } from '@/systems/combat/blades';

/**
 * The tunables the display shows, read through functions.
 *
 * `data/display` writes prose that quotes numbers the combat rules also apply.
 * It reads them here, not from `BALANCE`, so a rule that stops using a key as
 * a plain constant (a rank scale, a cap that depends on the unit) changes the
 * answer in one place and the text follows. `displayNumbers.test.ts` forbids
 * any `BALANCE` key from being read by both `systems/combat` and
 * `data/display`; this file is the only `systems/combat` reader of these
 * keys on the display's behalf.
 */

// Ranger and Rogue
export const rapidFireStrikes = () => BALANCE.RAPID_FIRE_STRIKES;
export const rapidFireTotal = () => BALANCE.RAPID_FIRE_TOTAL;
export const smokeDodge = () => BALANCE.SMOKE_DODGE;
export const bladestormRadius = () => BALANCE.BLADESTORM_RADIUS;
export const flurryFollowupsSingle = () => BALANCE.FLURRY_FOLLOWUPS_SINGLE;
export const flurryFollowupsArea = () => BALANCE.FLURRY_FOLLOWUPS_AREA;
export const flurryScale = () => BALANCE.FLURRY_SCALE;
export const deathMarkTurns = () => BALANCE.DEATH_MARK_TURNS;
export const deathMarkBonus = () => BALANCE.DEATH_MARK_BONUS;
export const bladesCap = (owner?: Pick<CombatUnit, 'masteryModifiers'>) => bladesCapOf(owner);
export const secondNatureMaxSteps = () => BALANCE.SECOND_NATURE_MAX_STEPS;
export const bladeExtractPerBlade = () => BALANCE.BLADE_EXTRACT_PER_BLADE;
export const dualWieldStrikeScale = () => BALANCE.DUAL_WIELD_STRIKE_SCALE;
export const maxPoisonStacks = () => BALANCE.MAX_POISON_STACKS;
export const venomTransferRange = () => BALANCE.VENOM_TRANSFER_RANGE;

// The hero sheet's stat tips (`data/display/statTips`)
export const maxLifesteal = () => BALANCE.MAX_LIFESTEAL;

// Monk
export const meditate = () => BALANCE.MEDITATE;
export const beetle = () => BALANCE.BEETLE;
export const mantis = () => BALANCE.MANTIS;
export const firefly = () => BALANCE.FIREFLY;

// Druid and Healer
export const apexTurns = () => BALANCE.APEX_TURNS;
export const sharedBloomReach = () => BALANCE.SHARED_BLOOM_REACH;
export const sharedBloomShare = () => BALANCE.SHARED_BLOOM_SHARE;
export const secondSpringThreshold = () => BALANCE.SECOND_SPRING_THRESHOLD;
export const cycleOfLifeMagic = () => BALANCE.CYCLE_OF_LIFE_MAGIC;
export const groundedFocus = () => BALANCE.GROUNDED_FOCUS;
export const sacredSealHeal = () => BALANCE.SACRED_SEAL_HEAL;
export const sacredRhythmMagic = () => BALANCE.SACRED_RHYTHM_MAGIC;
export const oathWardShare = () => BALANCE.OATH_WARD_SHARE;
export const zealMercyStrike = () => BALANCE.ZEAL_MERCY_STRIKE;
export const zealMercyHeal = () => BALANCE.ZEAL_MERCY_HEAL;
export const zealWrathStrike = () => BALANCE.ZEAL_WRATH_STRIKE;

// Mage
export const fuelTheFlameStack = () => BALANCE.FUEL_THE_FLAME_STACK;
export const conductiveArcBonus = () => BALANCE.CONDUCTIVE_ARC_BONUS;
export const overloadMinShocked = () => BALANCE.OVERLOAD_MIN_SHOCKED;
export const shatterpointBonus = () => BALANCE.SHATTERPOINT_BONUS;
export const shockChainFraction = () => BALANCE.SHOCK_CHAIN_FRACTION;
export const deepColdMinRange = () => BALANCE.DEEP_COLD_MIN_RANGE;

// Warrior, Paladin and Berserker
export const shieldedChallengeDuration = () => BALANCE.SHIELDED_CHALLENGE_DURATION;
export const intimidatingShred = () => BALANCE.INTIMIDATING_SHRED;
export const bracedStep = () => BALANCE.BRACED_STEP;
export const escapeRouteRetreat = () => BALANCE.ESCAPE_ROUTE_RETREAT;
export const undyingSurge = () => BALANCE.UNDYING_SURGE;
export const savageEdgeTick = () => BALANCE.SAVAGE_EDGE_TICK;
export const reckoningBase = () => BALANCE.RECKONING_BASE;
export const reckoningCap = () => BALANCE.RECKONING_CAP;
export const reckoningRadius = () => BALANCE.RECKONING_RADIUS;
export const bloodHowlCrit = () => BALANCE.BLOOD_HOWL_CRIT;
export const bloodHowlTurnCap = () => BALANCE.BLOOD_HOWL_TURN_CAP;

// Elites and winter
export const winterSleepTurns = () => BALANCE.WINTER_SLEEP_TURNS;
export const winterSleepDamageReduction = () => BALANCE.WINTER_SLEEP_DAMAGE_REDUCTION;
export const painFeastThreshold = () => BALANCE.PAIN_FEAST_THRESHOLD;
export const mirePull = () => BALANCE.MIRE_PULL;

// Advanced (level 21–25): Champion
export const advancedChampion = () => BALANCE.ADVANCED_CHAMPION;

// Level 26: Arcanist
export const arcanistRowTwo = () => BALANCE.ARCANIST_ROW_TWO;

// Advanced (level 21–25): Hunter
export const advancedHunter = () => BALANCE.ADVANCED_HUNTER;

// A campaign's difficulty, as its description quotes it
export const runDifficulty = () => BALANCE.RUN_DIFFICULTY;
