import { crownedPreyFor, detonationTurns, executeThresholdHp, formSkillDamageScale, hasEffect, holyStrikeEligible, isAreaSkill, resolveEffectMagnitudeWith, sacredSealFor, scalingPower } from '@/systems/combat/statusEffects';
import { roll } from '@/systems/combat/dice';
import { difficultyDamage } from '@/systems/combat/runDifficulty';
import { AfflictionType, CombatUnit, DamageCondition, DeathBurst, EffectScaling, HeroSkill, AuraType, HeroStats, SkillTargetType } from '@/models/types';
import { isLightningBolt } from '@/data/skills/lightningSkills';
import { BALANCE } from '@/data/balanceConstants';
import { Flank, flankMultiplier } from '@/systems/combat/facing';
import { hexDistance } from '@/utils/hexUtils';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { combatMaxHp } from '@/systems/combat/forms';
import { critBonusAgainst, penetrationAgainst } from '@/systems/combat/passives';
import { damageTypeOf, defenceAgainst } from '@/systems/combat/damageType';
import type { DamageType } from '@/models/skills';
import type { StatusEffectType } from '@/models/types';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { beetleStrikeMultiplier } from '@/systems/combat/beetle';

/**
 * The variance stats, with defaults filled in.
 *
 * They are optional on `HeroStats` so no template has to declare them; this is
 * the one place that decides what "unspecified" means, so nothing downstream
 * has to repeat the fallbacks.
 */
export function variance(stats: HeroStats): {
  critChance: number;
  critDamage: number;
  dodgeChance: number;
} {
  return {
    critChance: clampPercent(stats.critChance ?? BALANCE.BASE_CRIT_CHANCE),
    critDamage: Math.max(100, stats.critDamage ?? BALANCE.BASE_CRIT_DAMAGE),
    dodgeChance: Math.min(
      BALANCE.MAX_DODGE,
      clampPercent(stats.dodgeChance ?? BALANCE.BASE_DODGE)
    ),
  };
}

const clampPercent = (n: number) => Math.min(100, Math.max(0, n));

/**
 * The attacker's critical chance against this particular target.
 *
 * Stats first, then whatever the attacker's passives add *for this target*
 * (Killing Eye against a Bleeding enemy), clamped once at the end. The one
 * reader the rolls and the AI's expectation share, so a conditional chance is
 * rolled and scored at the same number.
 */
export function critChanceAgainst(attacker: CombatUnit, target: CombatUnit): number {
  const { critChance } = variance(getCombatEffectiveStats(attacker));
  return clampPercent(critChance + critBonusAgainst(attacker, target));
}

/**
 * The fraction of the defence that answers a hit of `type` the attacker
 * ignores, as 0–1.
 *
 * Two stats, one per defence: `armourPen` pierces Physical Defense on a
 * physical hit and `magicPen` pierces Magic Defense on a magic one, and neither
 * ever reaches the other's defence. `extraPoints` are what a passive or a
 * single blow adds for this hit (Killing Frost, Settle In, Sharpened Steel);
 * each source only offers them for the hit type it pierces, so they are summed
 * with the matching stat under that stat's cap.
 *
 * Capped below 1 rather than at it. At exactly 1 armour stops existing, and the
 * defence stat — which items, buffs and a whole tank path are built around —
 * becomes worthless against anyone who stacked this. Leaving a sliver keeps
 * armour meaningful at every level of penetration, and keeps the subtraction
 * from ever turning into a bonus.
 */
export function penetration(attackerStats: HeroStats, type: DamageType, extraPoints: number = 0): number {
  const [stat, cap] = type === 'magic'
    ? [attackerStats.magicPen, BALANCE.MAX_MAGIC_PEN]
    : [attackerStats.armourPen, BALANCE.MAX_ARMOUR_PEN];
  return Math.min(cap, Math.max(0, (stat ?? 0) + extraPoints)) / 100;
}

/** `penetration` for a physical hit: the share of Physical Defense ignored. */
export const armourPenetration = (attackerStats: HeroStats, extraPoints: number = 0): number =>
  penetration(attackerStats, 'physical', extraPoints);

/** `penetration` for a magic hit: the share of Magic Defense ignored. */
export const magicPenetration = (attackerStats: HeroStats, extraPoints: number = 0): number =>
  penetration(attackerStats, 'magic', extraPoints);

/**
 * **The share of a hit a defence takes off** — a percentage of the whole hit,
 * never a flat subtraction (playtest 2026-10-14).
 *
 * `defence / (defence + DEFENSE_ATTACKER_K × power)`, where `power` is the
 * attacker's own stat behind the hit (`scalingPower`: Attack, Magic, their
 * average, or a Beetle's shell). Measured against the attacker rather than the
 * hit, so a big swing and a small one from the same hand lose the same share,
 * and against the attacker rather than a constant, so armour keeps its worth as
 * every stat grows about fourfold over a campaign. 100 defence against 100
 * power takes 40% off. Diminishing: each point is worth less than the last, and
 * the cap (`1 - MIN_DAMAGE_FRACTION`) is reached only far past any sheet.
 *
 * It was `max(raw × MIN_DAMAGE_FRACTION, raw − 0.4 × defence)`: a level-20
 * Bulwark's 140 Physical Defence took 56 off every hit, floored everything under
 * 70 raw at a fifth, and barely dented a boss's swing — immune to the many and
 * no better than anyone against the one.
 */
export function defenceReduction(defence: number, power: number): number {
  if (defence <= 0) return 0;
  const share = defence / (defence + BALANCE.DEFENSE_ATTACKER_K * Math.max(1, power));
  return Math.min(1 - BALANCE.MIN_DAMAGE_FRACTION, share);
}

/**
 * What a damage-over-time tick keeps of itself through the target's defence, as a
 * multiplier (playtest 2026-10-21: ticks ignored defence entirely).
 *
 * The ordinary percentage reduction, taken at `BALANCE.DOT_DEF_SHARE` of its size.
 * A Bleed is a wound and meets Physical Defense; a Burn and a Poison meet Magic
 * Defense. The power it is measured against is the larger of its source's Attack
 * and Magic — the stat that most likely sized the tick, since an effect does not
 * remember its scaling — less the source's matching penetration. With no source
 * left on the board the tick is measured as an even match (power = the defence).
 */
export function dotDefenceFactor(
  target: CombatUnit,
  source: CombatUnit | undefined,
  type: StatusEffectType,
): number {
  const hitType: DamageType = type === AfflictionType.Bleed ? 'physical' : 'magic';
  const defence = defenceAgainst(getCombatEffectiveStats(target), hitType);
  if (defence <= 0) return 1;
  const sourceStats = source ? getCombatEffectiveStats(source) : undefined;
  const pierced = sourceStats ? defence * (1 - penetration(sourceStats, hitType)) : defence;
  const power = sourceStats ? Math.max(sourceStats.attack, sourceStats.magic) : defence;
  return 1 - BALANCE.DOT_DEF_SHARE * defenceReduction(pierced, power);
}

/**
 * Damage before any variance is applied — the deterministic core.
 *
 * Kept as its own export because both halves of the system need it and must
 * agree: `resolveAttack` rolls on top of it, and `expectedDamage` averages over
 * it. Anything that reads damage without rolling should call this.
 */
/**
 * Aimed Shot's distance curve: the authored damage is the value at
 * `skill.distanceScale` hexes, and the hit scales in proportion to the hex
 * distance between the two units as it lands. 1 for every other skill.
 */
export function distanceFactor(attacker: CombatUnit, target: CombatUnit, skill: HeroSkill): number {
  if (!skill.distanceScale) return 1;
  return hexDistance(attacker.position, target.position) / skill.distanceScale;
}

export function calculateDamage(
  attacker: CombatUnit,
  target: CombatUnit,
  skill: HeroSkill,
  /** The approach the blow comes from (`flankOf`); front for anything that is not a struck blow. */
  flank: Flank = 'front',
  allUnits: CombatUnit[] = [],
  /**
   * Penetration points this one blow adds against the defence that answers it
   * (Sharpened Steel's opening hit, which only offers them on a physical hit).
   */
  extraPen: number = 0,
): number {
  if (target.activeEffects.some((e) => e.type === AuraType.Invulnerability)) return 0;

  const attackerStats = getCombatEffectiveStats(attacker);
  const targetStats   = getCombatEffectiveStats(target);
  const raw = rawSkillDamage(attacker, skill) * distanceFactor(attacker, target, skill);

  // Penetration reduces what the defence is worth, rather than adding to the
  // hit. That is the whole point of the stat: it is worth most against the
  // things attack is worth least against.
  //
  // Only the defence that matches the hit's type answers it: a physical blow is
  // never softened by Magic Defense, nor a spell by armour. The type is the
  // skill's, not its scaling's (see `damageTypeOf`) — and it picks the
  // penetration too: Armour Pen for a physical hit, Magic Pen for a magic one.
  const hitType = damageTypeOf(skill);
  const defence =
    defenceAgainst(targetStats, hitType) *
    // `penetrationAgainst` is what a passive adds for *this* target and hit
    // (Killing Frost against a Chilled one), summed with the matching stat
    // under that stat's cap.
    (1 - penetration(attackerStats, hitType, penetrationAgainst(attacker, target, skill) + extraPen));
  const power = scalingPower(attackerStats, skill.scaling);

  let damage = raw * (1 - defenceReduction(defence, power));

  // The holy rider is its own magic component, answered by Magic Defense in
  // full: no penetration reaches it, Magic Pen included, so a blessing is the
  // same size on every wielder.
  const holy = holyHitBonus(attacker, target, skill);
  if (holy > 0) damage += holy * (1 - defenceReduction(defenceAgainst(targetStats, 'magic'), power));
  // The side and back of a facing unit (`systems/combat/facing`)
  damage *= flankMultiplier(flank);

  // Mark, bonusVs and detonation all ride alongside the flank, after mitigation,
  // for the same reason: each is a condition on the strike rather than a change
  // to the weapon, and multiplying before defence would rescale every one of
  // them against every armour value in the game. The mastery bonuses keyed to
  // the target's *state* — dying, healthy, marked — are that same shape, and
  // land here rather than on the multiplier above for that same reason.
  damage *= markMultiplier(attacker, target);
  damage *= cutOpenMultiplier(attacker, target);
  damage *= conditionalMultiplier(attacker, target, skill, allUnits);
  damage *= detonationMultiplier(target, skill, attacker);
  damage *= statusAmplifier(attacker, target, skill);
  damage *= overloadMultiplier(attacker, skill);
  damage *= thirstMultiplier(attacker, skill);
  damage *= masteryTargetMultiplier(attacker, target);
  damage *= furyMultiplier(attacker);
  damage *= exposedMultiplier(target);
  damage *= deathMarkMultiplier(target);
  damage *= duelMultiplier(attacker, skill);
  damage *= slumberMultiplier(target);
  damage *= areaResistMultiplier(target, skill);

  return finishDamage(damage, attacker);
}

/**
 * What an area hit leaves of itself on an objective that resists one
 * (`ObjectiveSpec.areaResist`: Whiteout Convergence's spires, Aethelred's
 * standards). An area is a radius, a cone, a chain, a line or the whole arena —
 * anything that can reach several of them with one press. 1 for everything else.
 */
export function areaResistMultiplier(target: CombatUnit, skill: HeroSkill): number {
  const resist = target.objective?.areaResist ?? 0;
  if (resist <= 0) return 1;
  const area = isAreaSkill(skill) || skill.targetType === SkillTargetType.Line || !!skill.arenaWide || !!skill.randomEnemies;
  return area ? 1 - resist : 1;
}

/**
 * What a skill's hit is worth out of the attacker's hands, before anything on
 * the target answers it: effective power (buffs, a form, passives) times the
 * skill's multiplier and the mastery shape bonus, plus a blessing's flat edge.
 * `calculateDamage` reduces this by defence, and `skillDamagePreview` reads
 * it straight, which is why it is one function rather than a formula kept twice.
 */
function rawSkillDamage(attacker: CombatUnit, skill: HeroSkill): number {
  // The shape bonus rides on the *multiplier*, not on the finished number: a
  // path that is better at area magic is casting a better version of the spell,
  // so armour should still get to answer it. Same call `skillPowerBonus` makes
  // one layer up, and the opposite of the one `strikeScales` makes below.
  // Hardened Shell and Heavy Hands are the same kind of claim: a better Iron Carapace, not a bonus on top of one
  // Fang and Talon (advanced Wildshape) is that kind of claim too: a better claw
  const multiplier = (skill.damage ?? 0) * shapeDamageScale(attacker, skill) * beetleStrikeMultiplier(attacker, skill)
    * formSkillDamageScale(attacker, skill);
  // Spells scale off magic, weapon skills off attack, the Templar's kit off the
  // average of both. Defaulting to attack keeps every existing physical skill
  // unchanged without needing the field.
  const power = scalingPower(getCombatEffectiveStats(attacker), skill.scaling);
  // Holy riders are separate magic components in calculateDamage, so this
  // remains the base strike that physical or magic defense answers.
  return power * multiplier;
}

/** The floor, the rounding and the campaign difficulty, applied once to a finished hit. */
function finishDamage(damage: number, attacker: CombatUnit): number {
  return difficultyDamage(Math.max(BALANCE.MIN_DAMAGE, Math.round(damage)), attacker);
}

/**
 * The Cave Bear's Winter Sleep: every strike lands for
 * `1 - WINTER_SLEEP_DAMAGE_REDUCTION` while it sleeps. Last, after the floor and
 * every condition, so armour penetration cannot reach it and a crit (which
 * multiplies this number) doubles a small hit rather than a full one.
 */
export function slumberMultiplier(target: CombatUnit): number {
  return target.activeEffects.some((e) => e.type === AuraType.Slumber)
    ? 1 - BALANCE.WINTER_SLEEP_DAMAGE_REDUCTION
    : 1;
}

/**
 * What one full strike of `skill` is worth from `attacker` right now, before
 * the target's defence and with no crit: the number a skill's description
 * states. Exactly `calculateDamage` against a target with no defence and
 * nothing on it — every attacker-side term is the same call, and only the
 * terms that read the target (defence, Mark, `bonusVs`, detonation, Exposed,
 * the mastery's target-state bonuses) are left out. Enemy numbers include the
 * campaign difficulty, as their real hits do.
 */
export function skillDamagePreview(attacker: CombatUnit, skill: HeroSkill): number {
  if (!skill.damage) return 0;
  let damage = rawSkillDamage(attacker, skill) + blessedWeaponBonus(attacker, skill)
    + (holyStrikeEligible(skill) ? attacker.activeEffects.find(e => e.type === AuraType.SacredRhythm)?.magnitude ?? 0 : 0);
  // The order `calculateDamage` multiplies in, so the floating point agrees too
  damage *= overloadMultiplier(attacker, skill);
  damage *= thirstMultiplier(attacker, skill);
  damage *= furyMultiplier(attacker);
  damage *= duelMultiplier(attacker, skill);
  return finishDamage(damage, attacker);
}

/**
 * A share of a full strike — a dual-wield hand, a Rapid Fire arrow, a Flurry
 * blade — rounded the way `resolveAttack` rounds one.
 */
export function strikeShare(full: number, scale: number): number {
  return Math.max(BALANCE.MIN_DAMAGE, Math.round(full * scale));
}

/**
 * The number a status lands with when `caster` lays it: a fraction of power
 * resolved against the caster's power, then the global poison dial and every
 * amplifier the caster's mastery and gear add (see `resolveEffectMagnitudeWith`).
 *
 * Power is the caster's **combat-effective** stats — buffs, form, passives —
 * the same stats `calculateDamage` and `calculateHealing` read, so a Barrier
 * cast under Magic buff grows with the heal beside it. It used to read the
 * sheet's base stats, which made a skill's damage and its own rider disagree
 * about how strong the caster was. The tooltip calls this too, so the preview
 * is the cast.
 */
export function resolveEffectMagnitude(
  type: StatusEffectType,
  magnitude: number,
  caster: CombatUnit,
  scaling: EffectScaling = 'attack',
): number {
  return resolveEffectMagnitudeWith(getCombatEffectiveStats(caster), type, magnitude, caster, scaling);
}

/**
 * One skill entry's magnitude as it lands on `recipient`: a share of the
 * recipient's effective maximum HP for an `ofRecipientMaxHp` entry (Canopy
 * Guard), otherwise `resolveEffectMagnitude` from the caster as ever. Both
 * execution paths call this, so a summon's shield is the same size whichever
 * path cast it.
 */
export function resolveEntryMagnitude(
  entry: { type: StatusEffectType; magnitude: number; ofRecipientMaxHp?: boolean; scaling?: EffectScaling },
  caster: CombatUnit,
  recipient: CombatUnit,
  scaling: EffectScaling = 'attack',
): number {
  if (entry.ofRecipientMaxHp) return Math.max(1, Math.round(combatMaxHp(recipient) * entry.magnitude));
  // An entry naming its own basis (a Beetle's Barrier, of its two defences) overrides the skill's
  return resolveEffectMagnitude(entry.type, entry.magnitude, caster, entry.scaling ?? scaling);
}

/**
 * The Troll Chieftain's Fury: every blow he lands is worth `1 + magnitude`.
 * After mitigation like the other conditions on a strike, so it is a clean
 * +50% on what a hero would otherwise take rather than a number defence eats.
 */
function furyMultiplier(attacker: CombatUnit): number {
  return 1 + (attacker.activeEffects.find((e) => e.type === AuraType.Fury)?.magnitude ?? 0);
}

/**
 * The Rime Jarl's edge inside his rune circle: direct Attack-scaled damage is worth
 * `1 + magnitude` while the duel is on, and nothing else is changed. Rides on the Duel
 * aura, so it ends the moment the circle does.
 */
function duelMultiplier(attacker: CombatUnit, skill: HeroSkill): number {
  if (skill.scaling !== undefined && skill.scaling !== 'attack') return 1;
  return 1 + (attacker.activeEffects.find((e) => e.type === AuraType.Duel)?.magnitude ?? 0);
}

/**
 * Assassinate's Death Mark: the marked unit takes `1 + magnitude` from every direct
 * blow, whoever lands it. Damage over time is not a blow and is not raised.
 */
export function deathMarkMultiplier(target: CombatUnit): number {
  return 1 + (target.activeEffects.find((e) => e.type === AfflictionType.DeathMark)?.magnitude ?? 0);
}

/**
 * An earned opening: the target takes `1 + magnitude` from every blow. The
 * Lantern Beacon's light (`BeaconLit`) opens it the same way and adds to it, and so
 * does a Taunt that carries Dropped Guard, whoever lands the blow.
 */
export function exposedMultiplier(target: CombatUnit): number {
  return 1 + (target.activeEffects.find((e) => e.type === AuraType.Exposed)?.magnitude ?? 0)
    + (target.activeEffects.find((e) => e.type === AuraType.BeaconLit)?.magnitude ?? 0)
    + (target.activeEffects.find((e) => e.type === AfflictionType.Taunt)?.tauntedExposure ?? 0);
}

export interface AttackResult {
  /** Final damage to apply. Zero when dodged. */
  damage: number;
  crit: boolean;
  dodged: boolean;
  /** Healing owed back to the attacker, already derived from `damage`. */
  lifesteal: number;
}

export interface ResolveOptions {
  /** Where the attacker stands against the target's facing (`flankOf`). Front when absent. */
  flank?: Flank;
  /**
   * The full roster, needed by the `isolated` condition. Without it an
   * isolation bonus reads as false rather than as true, so a caller that
   * forgets loses a bonus instead of silently doubling its damage.
   */
  allUnits?: CombatUnit[];
  /**
   * Injectable roll, for tests and for replaying a fight deterministically.
   * Defaults to the combat `dice`.
   */
  rng?: () => number;
  /**
   * What fraction of a full strike this one is worth — see `strikePattern`.
   *
   * Applied to the finished number rather than to the skill's multiplier, and
   * that is the whole reason it lives here instead of in `calculateDamage`.
   * Scaling the multiplier would have run each arrow of a Rapid Fire burst
   * through the subtraction at a third of the power, so armour would eat a
   * flat five hits' worth and the "burst" would land for nothing against
   * anything armoured at all. Scaling the result keeps each arrow an honest
   * 30% of the shot it came from, with its own crit roll on top.
   */
  strikeScale?: number;
  /**
   * Nothing to step out of the way of: no dodge roll. Blade Recall's extraction,
   * whose blades are already in the target. Crit and defence still apply.
   */
  undodgeable?: boolean;
  /** Armour-penetration points for this blow alone — see `calculateDamage`. */
  extraPen?: number;
  /**
   * The blow is a critical hit if it lands: Twin Reap's second cut on a Bleeding
   * enemy. The dodge is still rolled — the certainty is the crit, not the hit.
   */
  guaranteedCrit?: boolean;
}

/**
 * Rolls a single attack against a single target.
 *
 * This is the **only** function that rolls. The AI scores with
 * `expectedDamage` instead, so its choice and the outcome of that choice are
 * never computed from different dice — otherwise the same board would score
 * differently on every evaluation.
 *
 * Order is dodge → base damage → flank → crit → lifesteal. Crit multiplies
 * *after* defence has been subtracted, matching how the flank bonus has always worked;
 * multiplying before mitigation would quietly rescale every existing skill in
 * the game against every existing defence value.
 */
export function resolveAttack(
  attacker: CombatUnit,
  target: CombatUnit,
  skill: HeroSkill,
  opts: ResolveOptions = {}
): AttackResult {
  const dice = opts.rng ?? roll;

  const dodge = opts.undodgeable ? 0 : variance(getCombatEffectiveStats(target)).dodgeChance;
  if (dodge > 0 && dice() * 100 < dodge) {
    return { damage: 0, crit: false, dodged: true, lifesteal: 0 };
  }

  const full = calculateDamage(attacker, target, skill, opts.flank, opts.allUnits, opts.extraPen);
  const base = opts.strikeScale === undefined ? full : strikeShare(full, opts.strikeScale);

  const { critDamage } = variance(getCombatEffectiveStats(attacker));
  const critChance = critChanceAgainst(attacker, target);
  const crit = opts.guaranteedCrit || (critChance > 0 && dice() * 100 < critChance);
  const damage = crit
    ? Math.max(BALANCE.MIN_DAMAGE, Math.round(base * (critDamage / 100)))
    : base;

  return { damage, crit, dodged: false, lifesteal: calculateLifesteal(skill, damage, attacker) };
}

/**
 * The overdose: a fourth dose of poison on a target already carrying three.
 *
 * Rolled like a strike so it crits and so armour and penetration apply, which
 * is what makes it worth gearing for — but it deliberately cannot be *dodged*.
 * The venom is already inside them; there is nothing to step out of the way of,
 * and a miss would mean the strike that carried the dose landed and the payoff
 * for three turns of setup did not.
 *
 * Scales off the attacker's attack rather than off how much poison is on the
 * target. Reading the pile would pay the fourth dose for work the first three
 * did, and those already bit for it.
 *
 * `poisonBurstBonus` moves `POISON_BURST` itself rather than the finished
 * number, so the overdose stays mitigated like the strike it is rolled as. It
 * is deliberately the only route the burst can be geared or specced for from
 * the poison side: `poisonAmplification` amplifies **the dose** and not the
 * pile, precisely so a bonus does not get paid three times over and then again
 * on the detonation.
 */
export function poisonBurstDamage(
  attacker: CombatUnit,
  target: CombatUnit,
  rng: () => number = roll,
): { damage: number; crit: boolean } {
  const skill: HeroSkill = {
    id: 'venom_burst' as HeroSkill['id'],
    targetType: SkillTargetType.Single,
    range: 1,
    damage: BALANCE.POISON_BURST * (1 + (attacker.masteryModifiers?.poisonBurstBonus ?? 0)),
    unlockLevel: 1,
    manaCost: 0,
  };

  const base = calculateDamage(attacker, target, skill);
  const { critDamage } = variance(getCombatEffectiveStats(attacker));
  const critChance = critChanceAgainst(attacker, target);
  const crit = critChance > 0 && rng() * 100 < critChance;
  return {
    damage: crit ? Math.max(BALANCE.MIN_DAMAGE, Math.round(base * (critDamage / 100))) : base,
    crit,
  };
}

/**
 * A unit going off when it dies (`DeathBurst`): a summon's blast, a Frost Mote's shatter.
 *
 * Rolled through the same pipeline as the poison overdose and for the same
 * reasons: armour and penetration apply and it can crit, but there is nothing
 * to dodge — the thing detonated where it stood. Sized by the burst's `scaling`
 * stat and answered by its `damageType`'s defence.
 */
export function deathBurstDamage(
  dying: CombatUnit,
  target: CombatUnit,
  burst: Pick<DeathBurst, 'amount' | 'scaling' | 'damageType'>,
  rng: () => number = roll,
): { damage: number; crit: boolean } {
  const skill: HeroSkill = {
    id: 'death_burst' as HeroSkill['id'],
    targetType: SkillTargetType.Ring,
    range: 0,
    damage: burst.amount,
    ...(burst.scaling && { scaling: burst.scaling }),
    ...(burst.damageType && { damageType: burst.damageType }),
    unlockLevel: 1,
    manaCost: 0,
  };

  const base = calculateDamage(dying, target, skill);
  const { critDamage } = variance(getCombatEffectiveStats(dying));
  const critChance = critChanceAgainst(dying, target);
  const crit = critChance > 0 && rng() * 100 < critChance;
  return {
    damage: crit ? Math.max(BALANCE.MIN_DAMAGE, Math.round(base * (critDamage / 100))) : base,
    crit,
  };
}

/**
 * What an attack is worth on average, for the AI to compare options with.
 *
 * `damage × (1 − dodge) × (1 + critChance × (critDamage − 1))`. The AI must
 * never call `resolveAttack`: scoring with a roll makes its preferences jitter
 * between evaluations, and makes the move it picked disagree with the move it
 * then took.
 */
export function expectedDamage(
  attacker: CombatUnit,
  target: CombatUnit,
  skill: HeroSkill,
  flank: Flank = 'front',
  allUnits: CombatUnit[] = []
): number {
  const base = calculateDamage(attacker, target, skill, flank, allUnits);
  const { dodgeChance } = variance(getCombatEffectiveStats(target));
  const { critDamage } = variance(getCombatEffectiveStats(attacker));
  const critChance = critChanceAgainst(attacker, target);

  const critBonus = (critChance / 100) * (critDamage / 100 - 1);
  return base * (1 - dodgeChance / 100) * (1 + critBonus);
}

/**
 * Healing a drain skill returns to its caster, from the damage it just dealt.
 *
 * Distinct from `skill.healing`, which only ever lands on *allies inside the
 * area* — which is why a boss's signature drain once healed it for exactly zero.
 * Lifesteal is keyed to damage actually dealt, so a blocked or fully-absorbed
 * hit returns nothing.
 */
/**
 * The sheet's lifesteal as a fraction of damage dealt, capped at
 * `MAX_LIFESTEAL`: gear and the passives that write the stat. Shared by the
 * drain and the skill preview so the two cannot disagree about the cap.
 */
export function sheetLifesteal(stats: Pick<HeroStats, 'lifesteal'>): number {
  return Math.min(BALANCE.MAX_LIFESTEAL, Math.max(0, stats.lifesteal ?? 0)) / 100;
}

export function calculateLifesteal(
  skill: HeroSkill,
  damageDealt: number,
  /**
   * The attacker, so a `Lifesteal` aura can add to skills that have none.
   *
   * Optional because most callers are asking a question about the skill alone —
   * the AI scoring a move it has not made yet, for instance. Omitting it loses
   * the aura's contribution rather than crashing, which is the safe direction.
   */
  attacker?: CombatUnit,
): number {
  const aura = attacker?.activeEffects.find((e) => e.type === AuraType.Lifesteal);
  // Three sources, one fraction: the skill's own drain, an aura, and the
  // attacker's gear. Gear is the one that turns lifesteal from a property of
  // *this spell* into a property of *this hero* — a Vampiric axe drains on
  // every swing, including the at-will one that has never had `lifesteal` on
  // it. Percent on the sheet, fraction here, the same conversion crit makes.
  //
  // The type of the hit is never asked: a spell's damage drains exactly as a
  // sword's does, so a Vampiric staff heals its caster from fire and frost.
  const gear = attacker ? sheetLifesteal(getCombatEffectiveStats(attacker)) : 0;
  const fraction = (skill.lifesteal ?? 0) + (aura?.magnitude ?? 0) + gear;
  if (fraction <= 0 || damageDealt <= 0) return 0;
  return Math.max(1, Math.round(damageDealt * fraction));
}

/**
 * The share of a `healingByMissing` skill's top-end heal that lands on `target`:
 * `floor` at full health, rising to 1 as the target's missing-HP fraction
 * approaches 1, along `missing ** curve`. 1 for an ordinary heal or with no
 * target in scope. Fraction of the target's *combat* maximum, so a form or a
 * phase ceiling changes what "wounded" means exactly as it changes the bar.
 */
export function missingHealthShare(skill: HeroSkill, target?: CombatUnit): number {
  const spec = skill.healingByMissing;
  if (!spec || !target) return 1;
  const max = Math.max(1, combatMaxHp(target));
  const missing = Math.min(1, Math.max(0, 1 - target.currentHp / max));
  return spec.floor + (1 - spec.floor) * Math.pow(missing, spec.curve);
}

/**
 * What a heal is worth: the caster's magic times the skill's multiplier, times
 * whatever the caster's gear adds.
 *
 * `healPower` is applied here rather than at the skill, so it reaches every
 * route healing takes — a direct heal, a party-wide one, a heal ridden in on a
 * `HealOverTime` aura's magnitude. It is the Druid half of the pair
 * `shieldPower` completes; keeping them separate is the whole reason a Lifewarden
 * and a Stoneshaper want different loot.
 */
export function calculateHealing(
  caster: CombatUnit,
  skill: HeroSkill,
  /**
   * Who is being mended. Only a skill whose heal depends on how wounded its
   * target is (`healingByMissing`) reads it; without one such a skill resolves
   * at its top end, which is what a caster-only estimate has to assume.
   */
  target?: CombatUnit,
): number {
  if (skill.healingBasis === 'missingHp') return healingOfMissing(caster, skill, target ?? caster);
  return healingAtShare(caster, skill, missingHealthShare(skill, target));
}

function healingAtShare(caster: CombatUnit, skill: HeroSkill, share: number): number {
  const multiplier = (skill.healing ?? 0) * share;
  const stats = getCombatEffectiveStats(caster);
  const amplified = multiplier * (1 + (stats.healPower ?? 0) / 100);
  return Math.round(stats.magic * amplified);
}

/**
 * A `healingBasis: 'missingHp'` heal: `healing` of what `target` is missing,
 * amplified by the caster's heal power exactly as a Magic heal is. Zero on a
 * target at full health — there is nothing for it to be a share of.
 */
function healingOfMissing(caster: CombatUnit, skill: HeroSkill, target: CombatUnit): number {
  const missing = Math.max(0, combatMaxHp(target) - target.currentHp);
  const power = 1 + (getCombatEffectiveStats(caster).healPower ?? 0) / 100;
  return Math.round(missing * (skill.healing ?? 0) * power);
}

/**
 * The two ends of a skill's heal for this caster: on a target at full health
 * and on one with almost nothing left. Equal for an ordinary heal. The tooltip
 * states these, computed by the same arithmetic the cast uses.
 */
export function healingRange(caster: CombatUnit, skill: HeroSkill): { min: number; max: number } {
  return {
    min: healingAtShare(caster, skill, skill.healingByMissing?.floor ?? 1),
    max: healingAtShare(caster, skill, 1),
  };
}



/**
 * Extra damage a blessed weapon adds to this strike.
 *
 * Single-target only, checked on the shape rather than on the hit count: a cone
 * that happens to catch one enemy is still a sweep, and letting it collect the
 * blessing would make the restriction depend on how the enemy stood.
 */
export function blessedWeaponBonus(attacker: CombatUnit, skill: HeroSkill): number {
  if (!holyStrikeEligible(skill)) return 0;
  const blessing = attacker.activeEffects.find((e) => e.type === AuraType.BlessedWeapon);
  return blessing ? blessing.magnitude : 0;
}


/**
 * How much a target's accumulated affliction amplifies this strike.
 *
 * Measured in the attacker's own attack stat rather than in raw magnitude, so a
 * "hit's worth of poison" means the same thing at every point in the campaign.
 * Raw magnitude would have scaled with the square of stat inflation: poison is
 * applied as a fraction of attack, so a flat per-point bonus would grow with
 * attack *and* be multiplied by a hit that already grew with attack.
 */
export function statusAmplifier(
  attacker: CombatUnit,
  target: CombatUnit,
  skill: HeroSkill,
): number {
  const spec = skill.amplifiedBy;
  if (!spec) return 1;
  // Barbed Blades counts blades, not hits' worth: only the attacker's own, one
  // step of `per` each (the Embedded Blades remaster)
  if (spec.status === AfflictionType.Blades) {
    const blades = target.activeEffects
      .filter((e) => e.type === AfflictionType.Blades && e.sourceUnitId === attacker.id)
      .reduce((total, e) => total + e.magnitude, 0);
    return 1 + Math.min(spec.max, spec.per * blades);
  }
  const carried = target.activeEffects
    .filter((e) => e.type === spec.status)
    .reduce((total, e) => total + e.magnitude, 0);
  if (carried <= 0) return 1;

  const perHit = Math.max(1, attacker.stats.attack);
  return 1 + Math.min(spec.max, spec.per * (carried / perHit));
}


/**
 * The damage multiplier an Overloaded caster's next single-target lightning bolt
 * carries, or 1. Read by `calculateDamage`, so the AI's expectation and the
 * skill preview see the same number the strike rolls; spent by the resolver after
 * the cast, whichever skill it was, only if that skill was a bolt.
 */
export function overloadMultiplier(attacker: CombatUnit, skill: HeroSkill): number {
  if (!isLightningBolt(skill)) return 1;
  const charge = attacker.activeEffects.find((e) => e.type === AuraType.Overloaded);
  return charge ? 1 + charge.magnitude : 1;
}

/**
 * Bottomless Thirst: Bloodthirst's slope, the node's whole bonus times the share of
 * the pool missing. No bonus while Undying's window stands: at 1 HP it would sit at
 * its maximum on top of Undying's own surge.
 */
export function thirstMultiplier(attacker: CombatUnit, skill: HeroSkill): number {
  const bonus = attacker.masteryModifiers?.thirstMissingBonus;
  if (!bonus || skill.id !== 'bloodthirst') return 1;
  if (attacker.activeEffects.some((e) => e.type === AuraType.UndyingWindow)) return 1;
  const max = Math.max(1, combatMaxHp(attacker));
  return 1 + bonus * Math.min(1, Math.max(0, 1 - attacker.currentHp / max));
}


// ─── Conditional damage ───────────────────────────────────────────────────────

/**
 * The conditions that are simply "has this affliction".
 *
 * Split out as its own union so the switch below stays exhaustive: adding a
 * condition to `DamageCondition` without handling it here is a compile error
 * rather than a silently-false bonus.
 */
type StatusCondition =
  | 'burning' | 'chilled' | 'frozen' | 'shocked'
  | 'poisoned' | 'bleeding' | 'stunned' | 'rooted';


export const CONDITION_STATUS: Record<StatusCondition, AfflictionType> = {
  burning:  AfflictionType.Burn,
  chilled:  AfflictionType.Chill,
  frozen:   AfflictionType.Freeze,
  shocked:  AfflictionType.Shock,
  poisoned: AfflictionType.Poison,
  bleeding: AfflictionType.Bleed,
  stunned:  AfflictionType.Stun,
  rooted:   AfflictionType.Root,
};


export const isStatusCondition = (c: DamageCondition): c is StatusCondition => c in CONDITION_STATUS;


/**
 * Whether a `bonusVs` condition holds for this strike.
 *
 * `marked` deliberately asks the same marker-exclusive question `markMultiplier`
 * does, so a skill tuned against marked targets and the Mark bonus itself agree
 * about who counts as the hunter.
 */
export function meetsCondition(
  condition: DamageCondition,
  attacker: CombatUnit,
  target: CombatUnit,
  allUnits: CombatUnit[]
): boolean {
  if (isStatusCondition(condition)) return hasEffect(target, CONDITION_STATUS[condition]);

  switch (condition) {
    case 'marked':
      return markMultiplier(attacker, target) > 1;
    case 'lowHp':
      return target.currentHp <= target.stats.maxHp * BALANCE.LOW_HP_THRESHOLD;
    case 'fullHp':
      return target.currentHp >= target.stats.maxHp;
    case 'wounded':
      return target.currentHp < combatMaxHp(target) * BALANCE.WOUNDED_THRESHOLD;
    case 'isolated':
      // Absent a roster there are no allies to find, so an isolation bonus
      // would fire on every target. Both execution paths pass `allUnits`;
      // this keeps a caller that forgets from silently doubling its damage.
      if (allUnits.length === 0) return false;
      return !allUnits.some(
        (u) =>
          u.id !== target.id &&
          u.currentHp > 0 &&
          u.isPlayer === target.isPlayer &&
          hexDistance(u.position, target.position) === 1
      );
  }
}


export function conditionalMultiplier(
  attacker: CombatUnit,
  target: CombatUnit,
  skill: HeroSkill,
  allUnits: CombatUnit[]
): number {
  if (!skill.bonusVs) return 1;
  return meetsCondition(skill.bonusVs.condition, attacker, target, allUnits)
    ? skill.bonusVs.multiplier
    : 1;
}


/**
 * Multiplier a detonation adds to the strike, or 1 if there is nothing to spend.
 *
 * Scaled by remaining duration rather than by the affliction's magnitude, so it
 * works the same for Burn (which stacks damage) and Freeze (whose magnitude
 * means nothing). Bounded above by `MAX_DETONATE_TURNS`.
 */
export function detonationMultiplier(target: CombatUnit, skill: HeroSkill, attacker?: CombatUnit): number {
  if (!skill.detonates) return 1;
  const effect = target.activeEffects.find((e) => e.type === skill.detonates!.status);
  if (!effect) return 1;
  // Cataclysm grows the bonus the detonation pays, never the strike underneath it
  const bonus = 1 + (attacker?.masteryModifiers?.detonationBonus ?? 0);
  return 1 + skill.detonates.multiplier * detonationTurns(effect.duration) * bonus;
}


// ─── Mark ─────────────────────────────────────────────────────────────────────

/**
 * Multiplier a Mark grants, but only to the unit that placed it.
 *
 * Marker-exclusive so it reads as a hunter's quarry rather than a generic
 * damage-taken debuff the whole party piles onto.
 */
export function markMultiplier(attacker: CombatUnit, target: CombatUnit): number {
  const mark = target.activeEffects.find(
    (e) => e.type === AfflictionType.Mark && e.sourceUnitId === attacker.id
  );
  return mark ? 1 + mark.magnitude : 1;
}

/**
 * Multiplier an Exposed carrier takes from the unit that exposed it (Pinning
 * Cut), and from nobody else. Unlike a Mark nothing spends it: it lasts its turns.
 */
export function cutOpenMultiplier(attacker: CombatUnit, target: CombatUnit): number {
  const cut = target.activeEffects.find(
    (e) => e.type === AfflictionType.CutOpen && e.sourceUnitId === attacker.id
  );
  return cut ? 1 + cut.magnitude : 1;
}

/**
 * Whether this blow cashes the Mark in: the owner's Basic Attack takes the
 * Mark's bonus (`markMultiplier`, read before the roll like every other term)
 * and then removes it, on a landed hit only — a dodge spends nothing, the way
 * Hunter's Mark charges work. Every other skill of the owner reads the Mark and
 * leaves it standing (playtest PT-04).
 */
export function basicAttackSpendsMark(attacker: CombatUnit, target: CombatUnit, skill: HeroSkill): boolean {
  return skill.id === BASIC_ATTACK_ID && markMultiplier(attacker, target) > 1;
}


// ─── Mastery damage bonuses ───────────────────────────────────────────────────

/**
 * What the attacker's mastery adds for the *kind* of skill this is.
 *
 * **Pre-mitigation**: `calculateDamage` folds it into the skill's multiplier,
 * which is the call `skillPowerBonus` already makes and for the same reason —
 * "you are better at area magic" is a better version of the spell, so armour
 * should still get to answer it. A post-mitigation bonus here would be worth
 * wildly more against a wall than against paper, which is armour penetration's
 * job and not this one's. `masteryTargetMultiplier` is the other half of the
 * pair and lands *after* the subtraction, because those are conditions on the
 * strike rather than a change to the weapon.
 *
 * The two shapes are mutually exclusive by construction. Area is `isAreaSkill`,
 * the codebase's one answer to that question — a second definition here is
 * exactly what once left a stealthed unit untargetable by a skill that visibly
 * swept its hex. Single-target is `SkillTargetType.Single` and nothing else: a
 * Line covers several hexes without naming a radius, so it is honestly neither,
 * and paying it either bonus would make the shape the cheapest way to collect
 * one.
 */
export function shapeDamageScale(attacker: CombatUnit, skill: HeroSkill): number {
  const mods = attacker.masteryModifiers;
  if (!mods) return 1;
  if (isAreaSkill(skill)) return 1 + (mods.aoeDamageBonus ?? 0);
  if (skill.targetType === SkillTargetType.Single) {
    return 1 + (mods.singleTargetDamageBonus ?? 0);
  }
  return 1;
}


/**
 * What the attacker's mastery adds for the state the *target* is in.
 *
 * **Post-mitigation**, riding alongside Mark, `bonusVs` and detonation, because
 * it is the same kind of claim all three are: a condition on this strike rather
 * than sharper steel. Multiplying before defence would rescale every one of
 * them against every armour value in the game.
 *
 * The three sum rather than compose. They are separate nodes granting separate
 * fractions, and multiplying a marked, dying target's two bonuses together pays
 * a build for a coincidence neither node promised.
 */
export function masteryTargetMultiplier(attacker: CombatUnit, target: CombatUnit): number {
  const mods = attacker.masteryModifiers;
  if (!mods) return 1;

  let bonus = 0;

  // The execute window, asked of the one function that owns it — including its
  // deliberate reading of `stats.maxHp`. That choice is what stops the marker
  // the board already draws over every eligible enemy from flickering as buffs
  // come and go, and a threshold computed separately here would be a second
  // answer to a question the player is being shown the first answer to. No
  // `skill` is passed: this is the attacker's window, not a particular
  // finisher's narrowed one, so the node pays on every swing at the threshold
  // the marker means.
  if (mods.lowHpDamageBonus && target.currentHp <= executeThresholdHp(attacker, target)) {
    bonus += mods.lowHpDamageBonus;
  }

  // "How hurt is this unit" goes through `combatMaxHp`, always — a bear at
  // 120/150 read against its Druid's own 100 looks above full. Mutually
  // exclusive with the window above by arithmetic rather than by a guard:
  // `EXECUTE_THRESHOLD_MAX` is 0.25 and this floor is 0.5, so nothing is ever
  // both.
  if (
    mods.highHpDamageBonus &&
    target.currentHp > combatMaxHp(target) * BALANCE.HIGH_HP_THRESHOLD
  ) {
    bonus += mods.highHpDamageBonus;
  }

  // Through the same marker-exclusive predicate `bonusVs: 'marked'` uses, so a
  // hunter's node and a skill tuned against marked targets cannot disagree
  // about whose quarry it is.
  if (mods.markedDamageBonus && markMultiplier(attacker, target) > 1) {
    bonus += mods.markedDamageBonus;
  }

  // Scent of Blood: read off the target as the blow lands, so the reap that
  // removes a Bleed still struck a Bleeding enemy
  if (mods.bleedingDamageBonus && hasEffect(target, AfflictionType.Bleed)) {
    bonus += mods.bleedingDamageBonus;
  }

  // Advanced (level 21–25): Arcanist. Read off the pre-blow target, so the hit
  // that shatters a Freeze or a Brittle mark still struck the ice
  if (
    mods.chilledDamageBonus &&
    (hasEffect(target, AfflictionType.Chill) || hasEffect(target, AfflictionType.Freeze) ||
      hasEffect(target, AfflictionType.Brittle))
  ) {
    bonus += mods.chilledDamageBonus;
  }
  if (mods.shockedDamageBonus && hasEffect(target, AfflictionType.Shock)) {
    bonus += mods.shockedDamageBonus;
  }

  // Advanced (level 21–25): Druid. Earth falls hardest on what cannot step aside
  if (mods.pinnedDamageBonus && (hasEffect(target, AfflictionType.Root) || hasEffect(target, AfflictionType.Stun))) {
    bonus += mods.pinnedDamageBonus;
  }

  return 1 + bonus;
}

/** Bonus magic damage riding on a hit, before Magic Defense: holy riders and Crowned Prey's crown. */
export function holyHitBonus(attacker: CombatUnit, target: CombatUnit, skill: HeroSkill): number {
  const rhythm = holyStrikeEligible(skill) ? attacker.activeEffects.find(e => e.type === AuraType.SacredRhythm)?.magnitude ?? 0 : 0;
  return blessedWeaponBonus(attacker, skill) + rhythm + (sacredSealFor(attacker, target)?.magnitude ?? 0)
    + (crownedPreyFor(attacker, target)?.magnitude ?? 0);
}
