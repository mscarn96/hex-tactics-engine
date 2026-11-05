import { roll } from '@/systems/combat/dice';
import {
  ActiveEffect,
  AfflictionType,
  AuraType,
  CombatUnit,
  DamageCondition,
  EffectScaling,
  HeroSkill,
  SkillEffect,
  SkillTargetType,
  StatusEffectType,
} from '@/models/types';
import { hexDistance } from '@/utils/hexUtils';
import { isLightningBolt } from '@/data/skills/lightningSkills';
import { BALANCE } from '@/data/balanceConstants';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { combatMaxHp } from '@/systems/combat/forms';

/**
 * Pure rules for the status vocabulary.
 *
 * Everything here is a function of a snapshot — no store reads, no `set()`. The
 * two execution paths (the player's `executeSkill` and `executeAIActions`) have
 * drifted apart before, so anything a status does on a hit is written once here
 * and applied at both call sites, the same way `resolvePush` and
 * `calculateLifesteal` already work.
 */

const AFFLICTION_VALUES = new Set<string>(Object.values(AfflictionType));

/** Afflictions are what `DebuffImmunity` blocks and `cleanse` strips. */
export function isAffliction(type: StatusEffectType): boolean {
  return AFFLICTION_VALUES.has(type);
}

/**
 * Afflictions no cleanse reaches: Kairen's Jade Taint, cleared only by his own lightning
 * and a broken Jade Shard (`kairenRules`), and the Furnace Heart's Seared, which leaves only
 * with the Heart it comes from. Still afflictions — they cross to the other side and Debuff
 * Immunity refuses them.
 */
export const UNCLEANSABLE: ReadonlySet<StatusEffectType> = new Set([AfflictionType.JadeTaint, AfflictionType.Seared]);

/** Whether a cleanse strips this status. */
export const isCleansable = (type: StatusEffectType): boolean => isAffliction(type) && !UNCLEANSABLE.has(type);

export function hasEffect(unit: CombatUnit, type: StatusEffectType): boolean {
  return unit.activeEffects.some((e) => e.type === type);
}

/**
 * The statuses a skill lands, however it was authored.
 *
 * `appliesEffect` takes either one entry or a list, because most skills apply
 * exactly one status and wrapping every one of those in an array would be noise
 * — but a blessing like total immunity is honestly two auras. Every reader goes
 * through here so neither form needs handling twice.
 */
export function skillEffects(skill: HeroSkill): SkillEffect[] {
  const applied = skill.appliesEffect;
  if (!applied) return [];
  return Array.isArray(applied) ? applied : [applied];
}

/**
 * Rolls a `SkillEffect.chance`, once for the target being considered.
 *
 * Lives here rather than inside `applySkillStatus` because a miss must not
 * build an `ActiveEffect` at all — the two execution paths both read the
 * outcome of the application to decide whether to flash a support target and
 * whether a poison overdosed, and a status that never landed has neither.
 * `rng` is injectable for the same reason `damageCalc`'s is: a proc nobody can
 * pin is a proc nobody can balance.
 */
export function effectLands(effect: SkillEffect, rng: () => number = roll): boolean {
  return effect.chance === undefined || rng() < effect.chance;
}

/**
 * Whether this entry belongs on this unit at all.
 *
 * The side rule, stated once. Afflictions cross to the other side and auras stay
 * on your own — decided **per entry**, so a skill carrying a curse and a
 * blessing at the same time works, and a blessing that is two auras works too.
 *
 * `selfOnly` is the narrowing on top of it, and it exists because "your own
 * side" and "you" are not the same thing on a self-centred `Ring`. Unbreakable
 * Vow taunts a two-hex ring and turns its own armour to spines; the aura went to
 * every ally standing in the radius, which is exactly the set of people the same
 * button just made safe by pulling the ring onto the Bulwark. Its own comment
 * claimed the aura stayed on the caster, so the description, the comment and the
 * code were three answers to one question.
 *
 * Here rather than at each call site for the reason `combatEvents` exists:
 * the hero resolver and the enemy executor were separate copies of "resolve a
 * skill" and drifted — enemy push skills did nothing for a whole version
 * because only one implemented knockback. A rule every caster must obey lives in
 * one function they all call.
 */
export function effectReaches(
  effect: SkillEffect,
  caster: Pick<CombatUnit, 'id' | 'isPlayer'>,
  target: Pick<CombatUnit, 'id' | 'isPlayer'>,
): boolean {
  if (effect.selfOnly) return target.id === caster.id;
  return isAffliction(effect.type)
    ? target.isPlayer !== caster.isPlayer
    : target.isPlayer === caster.isPlayer;
}

/**
 * Whether a skill's payload includes something an ally would want.
 *
 * Used to decide whether the caster's own hex is a legal target: a skill whose
 * only output is a buff has no `healing` to give it away, and without this
 * "shield an ally" silently meant "shield anyone but yourself".
 */
export function grantsAura(skill: HeroSkill): boolean {
  return skillEffects(skill).some((e) => !isAffliction(e.type));
}

// ─── Authoring magnitudes ─────────────────────────────────────────────────────

/**
 * Damage-over-time is authored as a fraction of the caster's attack; every
 * other affliction carries a literal magnitude.
 *
 * This used to be inferred from the number alone — "between 0 and 5, so it must
 * be a fraction" — duplicated in both execution paths. That was fine while
 * Poison and Bleed were the only afflictions carrying a magnitude at all. It
 * stops being fine the moment Taunt uses magnitude as threat: a threat of 2
 * would be read as a fraction and multiplied by attack, so which taunt won
 * would depend on the taunter's weapon.
 */
const SCALED_BY_ATTACK: ReadonlySet<string> = new Set<string>([
  AfflictionType.SacredSeal,
  AfflictionType.Poison,
  AfflictionType.Bleed,
  AfflictionType.Burn,
  // Doom is a single enormous hit rather than a trickle, but it scales for the
  // same reason: a flat number authored against one stat block would be
  // trivial at tier 5 and lethal at tier 1, and the boss it belongs to is
  // multiplied by both party level and Seal tier.
  AfflictionType.Doom,
  // Same reasoning as Doom, from the other side of the line: the Martyr's
  // detonation is one large hit authored once and cast by a hero whose attack
  // triples over the campaign.
  AuraType.MartyrSeal,
  // The Bladestorm's ring bites once per turn for the whole time it is up, so
  // it is a trickle in every sense that matters here — a flat number would be
  // the whole fight at level 5 and a rounding error at level 20.
  AuraType.BladeStorm,
  // A shield is worth what it stops, so it inflates with the blows it is
  // stopping. Every barrier authored before this is a flat 30–90 and stays
  // exactly as it was: the `>= 5` guard below means only a value authored as a
  // fraction scales, which is opt-in per skill rather than a re-tuning of four.
  AuraType.Barrier,
  // Reckoning is a Barrier with a memory, authored as a fraction of Attack the same way
  AuraType.Reckoning,
]);

/**
 * The stat a skill's power comes from, resolved from its `scaling`.
 *
 * One function shared by `calculateDamage` and the fractional-magnitude path
 * below, so `hybrid` cannot mean two different arithmetics — it is the average
 * of the two stats, which keeps a hybrid skill on the same tuning scale as a
 * pure one instead of double-dipping the sum.
 */
export function scalingPower(
  stats: { attack: number; magic: number; defense?: number; magicDefense?: number },
  scaling: EffectScaling = 'attack',
): number {
  if (scaling === 'magic') return stats.magic;
  if (scaling === 'hybrid') return (stats.attack + stats.magic) / 2;
  // The Beetle's shell: Physical + Magic Defense, summed rather than averaged —
  // the factors in `BALANCE.BEETLE` are authored against the sum
  if (scaling === 'defense') return (stats.defense ?? 0) + (stats.magicDefense ?? 0);
  return stats.attack;
}

/**
 * Statuses whose magnitude is a damage ratio (0.2 = +20% taken), stored as
 * authored: rounding it to a whole point made Mark Target's 0.4 a +100% Mark,
 * and would make Pinning Cut's 0.2 Exposed the same.
 */
export const RATIO_MAGNITUDE: ReadonlySet<StatusEffectType> = new Set<StatusEffectType>([
  AfflictionType.Mark,
  AfflictionType.CutOpen,
]);

/** A resolved skill-effect magnitude as stored: a ratio as it is, everything else a whole point of at least 1. */
export function settleMagnitude(type: StatusEffectType, value: number): number {
  return RATIO_MAGNITUDE.has(type) ? value : Math.max(1, Math.round(value));
}

/**
 * Whether an authored magnitude is a fraction of the caster's power rather than
 * a literal — the one rule `resolveEffectMagnitude` resolves by and the
 * tooltips state by, so the two cannot disagree about which numbers scale.
 */
export function isScaledMagnitude(type: StatusEffectType, magnitude: number): boolean {
  return SCALED_BY_ATTACK.has(type) && magnitude > 0 && magnitude < 5;
}

/**
 * `resolveEffectMagnitude`'s arithmetic, given the power stats to read.
 *
 * The public entry is `damageCalc.resolveEffectMagnitude`, which passes the
 * caster's *combat-effective* stats — the ones a direct hit or a heal reads —
 * so a Barrier or a Burn cast under a Magic buff, in a form or with a passive's
 * stat bonus grows exactly as the spell's own damage does. It cannot live here
 * because effective stats are `combatEngine`'s, which imports this module.
 * Passives call this directly for the same reason, and only with flat amounts.
 */
export function resolveEffectMagnitudeWith(
  powerStats: { attack: number; magic: number; defense?: number; magicDefense?: number },
  type: StatusEffectType,
  magnitude: number,
  caster: CombatUnit,
  /**
   * The stat the *skill* scales off, when there is one.
   *
   * Defaults to attack, which is what every physical DoT wants. Passing it
   * matters most for the caster paths: every Pyromancer burn is authored on a
   * skill that scales off `magic`, but the magnitude was keyed to `attack`
   * regardless — so a mage stacking magic grew their direct damage and left
   * their signature damage-over-time exactly where it started. The path's whole
   * plan is "stack the fire, then blow it up", and half of it was pinned to the
   * one stat the class never builds.
   */
  scaling: EffectScaling = 'attack',
): number {
  let resolved = magnitude;
  if (isScaledMagnitude(type, magnitude)) {
    const power = scalingPower(powerStats, scaling);
    const amplified = magnitude * (1 + burnAmplification(caster, type));
    resolved = Math.max(1, Math.round(power * amplified));
  }

  /**
   * The global poison dial, applied before anything that amplifies it.
   *
   * A 10% cut to poison was wanted across the board, and the alternative was
   * retuning the eight authored magnitudes scattered across `skillData`,
   * `mastery/hunter` and the enemy kits — eight numbers that would then have to
   * be re-derived by hand for every future retune, with nothing to notice one
   * being missed. One factor here is the same dial for all of them, and it is
   * **symmetric by construction**: a hero's dose and a spider's dose both arrive
   * through this function, which is the property the whole poison design rests
   * on (see `MAX_POISON_STACKS`).
   *
   * Before the amplifiers rather than after, so a Toxicologist's node still
   * multiplies the number the player is actually taking — a discount applied
   * last would be a bigger cut the more the build had invested in poison, which
   * is a nerf aimed at exactly the people who chose the path.
   */
  if (type === AfflictionType.Poison) {
    resolved = Math.max(1, Math.round(resolved * BALANCE.POISON_POWER));
  }

  // On the *resolved* value, after the flat/fraction split, so a flat 30-point
  // barrier and a fractional one authored against magic both scale — and so a
  // poison dose authored as a literal is amplified exactly as one authored as a
  // fraction of attack is.
  const amp =
    shieldAmplification(caster, type) +
    poisonAmplification(caster, type) +
    magnitudeAmplification(caster, type);
  return amp > 0 ? Math.round(resolved * (1 + amp)) : resolved;
}

/**
 * Statuses a mastery node makes stronger, and the key that does it.
 *
 * A table rather than a fourth `xAmplification` function: these are one rule
 * said three times over, and the next one should be a row instead of another
 * near-copy of the same three lines.
 *
 * Burn is deliberately *not* here even though it is the precedent for all of
 * this. It is amplified inside the fraction branch above, which predates the
 * flat/fraction split argument `shieldAmplification` records — and the two
 * placements agree on every skill that exists, because a Burn is always
 * authored as a fraction of attack. Moving it would retune the Pyromancer for
 * nothing. The two new entries take the *resolved* placement instead, which is
 * a strict superset: a Bleed authored as a flat number scales too, where beside
 * Burn it would silently not.
 */
const MAGNITUDE_BONUS_KEY: Partial<
  Record<StatusEffectType, 'bleedMagnitudeBonus' | 'regenMagnitudeBonus'>
> = {
  [AfflictionType.Bleed]: 'bleedMagnitudeBonus',
  [AuraType.HealOverTime]: 'regenMagnitudeBonus',
};

/**
 * Read off the *applier*, the same side as burn, shielding and venom: this is a
 * hero knowing their own craft rather than a property of being bled or mended.
 */
function magnitudeAmplification(caster: CombatUnit, type: StatusEffectType): number {
  const key = MAGNITUDE_BONUS_KEY[type];
  return key ? caster.masteryModifiers?.[key] ?? 0 : 0;
}

/**
 * What a heal or a granted pool is worth *to the unit receiving it*.
 *
 * The one amplifier in the game on this side of the line. Every other one reads
 * the hand that cast, because "your fire burns hotter" is a claim about the
 * caster; this is the opposite claim — a hero who is easier to keep alive — and
 * reading it off the caster would mean a Bulwark's node worked only when a
 * Bulwark was doing the healing.
 *
 * It composes with the caster's own bonus by multiplying, which happens for
 * free: `healPower` and `shieldPowerBonus` are already inside the number handed
 * in. They are claims about two different people and neither scales the other.
 */
export function incomingSupportScale(unit: CombatUnit): number {
  return 1 + (unit.masteryModifiers?.incomingSupportBonus ?? 0);
}

/** `amount` after the receiver's own support bonus. Rounded — health is whole. */
export function amplifyIncomingSupport(unit: CombatUnit, amount: number): number {
  const scale = incomingSupportScale(unit);
  return scale === 1 ? amount : Math.round(amount * scale);
}

/**
 * The share of a heal `unit` receives: whole, less the Furnace Heart's Seared (`magnitude`, a fraction)
 * while it carries the Heart. Healing only — a direct heal, a heal over time, a drain, a mote — and never
 * a Barrier, which is a shield and not health given back.
 */
export function healingReceivedScale(unit: CombatUnit): number {
  const seared = unit.activeEffects.find((e) => e.type === AfflictionType.Seared);
  return seared ? Math.max(0, 1 - seared.magnitude) : 1;
}

/** `amount` of healing as `unit` receives it (`healingReceivedScale`). Rounded — health is whole. */
export function healingReceived(unit: CombatUnit, amount: number): number {
  const scale = healingReceivedScale(unit);
  return scale === 1 ? amount : Math.round(amount * scale);
}

/**
 * Extra burn magnitude a mastery grants, as a fraction.
 *
 * Only Burn, and only from the hero carrying the modifier: this is the
 * Pyromancer knowing its own fire, not a property of being on fire.
 */
function burnAmplification(caster: CombatUnit, type: StatusEffectType): number {
  if (type !== AfflictionType.Burn) return 0;
  return caster.masteryModifiers?.burnMagnitudeBonus ?? 0;
}

/**
 * Extra shielding a mastery grants, as a fraction of the barrier's magnitude.
 *
 * Read off the *granting* hero rather than the wearer, the same way the burn
 * bonus is: this is the Stoneshaper's own craft, not a property of being
 * shielded — an ally warded by two Druids should get each one's strength.
 */
function shieldAmplification(caster: CombatUnit, type: StatusEffectType): number {
  if (type !== AuraType.Barrier && type !== AuraType.Reckoning) return 0;
  // A node and a piece of gear compose additively: both are the caster knowing
  // their own craft, and there is no reading under which one should scale the
  // other. The stat is a percentage on the sheet and a fraction here.
  return (caster.masteryModifiers?.shieldPowerBonus ?? 0) + (caster.stats.shieldPower ?? 0) / 100
    + (caster.activeEffects.find(e => e.type === AuraType.GroundedFocus)?.magnitude ?? 0);
}

/**
 * Extra venom the applier's gear carries, as a fraction of the dose.
 *
 * The mirror of the shield bonus, and read off the applier for the same reason:
 * a dose is worth what the hand that laid it is worth. It amplifies **the dose**
 * and not the pile — `mergePoison` adds already-amplified magnitudes, so the
 * bonus compounds by being applied three times rather than by being reapplied
 * to work three earlier strikes already paid for. The overdose is deliberately
 * untouched: `poisonBurstDamage` rolls off the attacker's *attack* through the
 * full damage pipeline, so it already has its own way to be geared for.
 */
function poisonAmplification(caster: CombatUnit, type: StatusEffectType): number {
  if (type !== AfflictionType.Poison) return 0;
  return (caster.stats.poisonPower ?? 0) / 100;
}

// ─── Stacking ─────────────────────────────────────────────────────────────────

/**
 * Statuses whose magnitude *adds* on re-application, and the ceiling it adds to.
 *
 * Everything else takes the larger of the two, which is the right default: a
 * second Attack Buff from a weaker source should not make a hero stronger than
 * the stronger source alone did. These are the deliberate exceptions, and both
 * are exceptions for the same reason — the *point* of the skill is that casting
 * it again is worth doing.
 *
 * The cap is what keeps that from being unbounded. A whole fight spent stacking
 * one thing has to converge, or the answer to every encounter is "cast it more".
 */
export const STACKING_MAGNITUDE: Partial<Record<StatusEffectType, number>> = {
  [AfflictionType.Burn]: BALANCE.MAX_BURN_MAGNITUDE,
  [AuraType.BlessedWeapon]: BALANCE.MAX_BLESSED_WEAPON,
  // The Troll Chieftain's wound has no stack cap by design: it never expires and
  // only a cleanse removes it. The shred floor in `getCombatEffectiveStats` is
  // what keeps a pile of it from taking defence below a fraction of its base.
  [AfflictionType.Wound]: Infinity,
  // Jadeveil: Kairen's Jade Taint adds a stack a dose, to three
  [AfflictionType.JadeTaint]: BALANCE.KAIREN.TAINT_CAP,
  // Poison also stacks, and is deliberately *not* here: its ceiling is counted
  // in doses rather than points and reaching it does something rather than
  // nothing, neither of which a flat magnitude cap can express. See below.
};

/**
 * Burn stacks: how many separate applications are in the pile.
 *
 * Counted rather than derived from the magnitude, because a magnitude is worth
 * whatever the applier's Magic made it — three stacks from one Pyromancer are
 * not the same number as three from another. One, unless it says otherwise, so
 * every single application anywhere in the game is a legal one-stack Burn.
 * Firemind reads it (the discount is per stack spent) and Spark passes one
 * stack's share of the pile on.
 */
export function burnStacks(effect: ActiveEffect): number {
  return effect.stacks ?? 1;
}

/** One stack's share of a Burn's magnitude. */
export function burnPerStack(effect: ActiveEffect): number {
  return effect.magnitude / burnStacks(effect);
}

/**
 * Fuel the Flame: the extra Burn stack Ignite lays on an enemy that was already
 * burning before the cast, as a magnitude, or 0 when the rule does not apply.
 *
 * `igniteBurn` is Ignite's own Burn after the caster's amplifiers, so Hot Blood
 * reaches the bonus stack through it once rather than twice. Read off the unit's
 * own passive list, since this module sits beneath `passives`.
 */
export function fuelTheFlameBurn(
  attacker: CombatUnit,
  skill: HeroSkill,
  wasBurning: boolean,
  igniteBurn: number,
): number {
  if (skill.id !== 'ignite' || !wasBurning || !attacker.passives?.includes('fuelTheFlame')) return 0;
  const scale = attacker.passiveRanks?.fuelTheFlame?.scale ?? 1;
  return Math.max(1, Math.round(igniteBurn * BALANCE.FUEL_THE_FLAME_STACK * scale));
}

// ─── Poison ───────────────────────────────────────────────────────────────────

/**
 * Doses in a poison effect. One, unless it says otherwise.
 *
 * The fallback is what makes every existing source of poison — enemy skills,
 * summons, the loot pool's venom riders — a legal one-dose application without
 * any of them being told about the mechanic.
 */
export function poisonStacks(effect: ActiveEffect): number {
  return effect.stacks ?? 1;
}

/**
 * The Poison doses a unit carries, as its model's dose markers show them: 0 when
 * clean, never more than `MAX_POISON_STACKS` (an Overdose bursts and leaves the
 * pile at the cap, so it is a flash on the markers, never a fourth dose).
 */
export function poisonDoses(unit: CombatUnit): number {
  const pile = unit.activeEffects.find((e) => e.type === AfflictionType.Poison);
  return pile ? Math.min(BALANCE.MAX_POISON_STACKS, Math.max(1, poisonStacks(pile))) : 0;
}

/** Whether another dose would overdose rather than accumulate. */
export function poisonAtCap(effect: ActiveEffect | undefined): boolean {
  return !!effect && poisonStacks(effect) >= BALANCE.MAX_POISON_STACKS;
}

/**
 * A dose landing on a target that is not yet at the cap.
 *
 * Magnitude adds and the clock goes back to full, so a Shadowblade working one
 * target keeps the whole pile alive rather than watching the first dose expire
 * while laying the third.
 */
export function mergePoison(existing: ActiveEffect, incoming: ActiveEffect): ActiveEffect {
  // The cap holds here as well as at the burst, and it has to: the burst needs
  // an attacker to roll against, and a dose from a source that has since died —
  // or from no unit at all — would otherwise stack past the ceiling by taking
  // the one path that never checks it.
  const full = poisonAtCap(existing);
  return {
    ...existing,
    magnitude: full ? existing.magnitude : existing.magnitude + incoming.magnitude,
    stacks: full ? poisonStacks(existing) : poisonStacks(existing) + 1,
    duration: BALANCE.POISON_TICKS,
    sourceUnitId: incoming.sourceUnitId ?? existing.sourceUnitId,
    appliedAt: incoming.appliedAt,
  };
}

/** The first dose on a clean target. */
export function freshPoison(incoming: ActiveEffect): ActiveEffect {
  return { ...incoming, stacks: 1, duration: BALANCE.POISON_TICKS };
}

/**
 * What a poison tick takes, read on the *incoming* duration.
 *
 * Front-loaded: full magnitude on the first tick of a dose, half on each of the
 * two after it. Same total as biting evenly for two turns, and it is the
 * difference between poison being a threat now and being an accountant's note
 * about three turns' time — which matters most to the path that has to spend
 * turns setting it up in the first place.
 */
export function poisonTickDamage(effect: ActiveEffect): number {
  const full = effect.duration >= BALANCE.POISON_TICKS;
  return Math.max(1, Math.round(full ? effect.magnitude : effect.magnitude / 2));
}

// ─── Execution ────────────────────────────────────────────────────────────────

/**
 * The fraction of maximum health at or below which a target can be executed.
 *
 * Grows with the executioner's attack, so a finishing blow stays a finishing
 * blow as the numbers on both sides inflate — a flat 15% would mean something
 * different at level 5 and level 20. Capped, because this pairs with Frenzy:
 * a kill refunds the action, so a threshold high enough to catch a healthy
 * enemy would let one Berserker take a turn per enemy on the board.
 *
 * Read from `unit.stats` rather than effective stats, on purpose. It is drawn
 * on the board as a marker over every eligible enemy, and keying it to buffs
 * and Wrath's missing-health bonus would make those markers flicker on and off
 * as the fight moved — a gate the player cannot predict is worse than a
 * slightly less precise one. Equipment is already in `stats`, so gearing for it
 * still works.
 */
export function executeThresholdFraction(
  attacker: CombatUnit,
  /**
   * The prey, when it is known.
   *
   * Omitted by the tooltip, which describes the skill rather than a particular
   * victim, and by anything asking "how wide is my window in general".
   */
  target?: CombatUnit,
  /**
   * The finisher being asked about.
   *
   * Optional so callers that mean "how wide is this unit's window in general"
   * keep working — omitting it describes the standard window rather than any
   * particular skill's.
   */
  skill?: HeroSkill,
): number {
  const base = Math.min(
    BALANCE.EXECUTE_THRESHOLD_MAX,
    BALANCE.EXECUTE_THRESHOLD_BASE + attacker.stats.attack * BALANCE.EXECUTE_THRESHOLD_PER_ATTACK,
  );
  const scaled = base * (skill?.executeThresholdScale ?? 1);
  return scaled / (target ? executeTierDivisor(target) : 1);
}

/**
 * How much the window narrows against this creature.
 *
 * A percentage of a boss's health bar is an enormous number of hit points, so a
 * flat threshold turned "finish the wounded" into "delete the encounter"
 * precisely where the encounter is the content. Read from the template's tier
 * so a boss added later cannot inherit the trash-mob window by omission.
 *
 * Player units and anything without a template are `normal`: heroes are not
 * executable prey, and a summon standing in for one should not be sturdier than
 * the thing it imitates.
 */
export function executeTierDivisor(target: CombatUnit): number {
  const template = target.templateId
    ? enemyTemplates.find((t) => t.id === target.templateId)
    : undefined;
  return BALANCE.EXECUTE_TIER_DIVISOR[template?.tier ?? 'normal'];
}

/** The actual HP number an execution needs the target at or below. */
export function executeThresholdHp(
  attacker: CombatUnit,
  target: CombatUnit,
  skill?: HeroSkill,
): number {
  return Math.floor(target.stats.maxHp * executeThresholdFraction(attacker, target, skill));
}

/** Whether this skill only accepts targets already near death. */
export function requiresExecutable(skill: HeroSkill): boolean {
  return skill.requiresTarget?.includes('executable') ?? false;
}

/**
 * Whether `target` is a legal target for `skill` cast by `attacker`.
 *
 * Everything without a `requiresTarget` passes, so this can be applied
 * unconditionally at every site that picks targets.
 */
export function meetsTargetRequirement(
  attacker: CombatUnit,
  target: CombatUnit,
  skill: HeroSkill,
): boolean {
  // Every entry must hold. Assassinate wants a target that is both dying and
  // poisoned, and "any of these" would make it strictly easier to use than
  // either half — the opposite of what a capstone gate is for.
  return (skill.requiresTarget ?? []).every((requirement) => {
    switch (requirement) {
      case 'executable':
        return target.currentHp <= executeThresholdHp(attacker, target, skill);
      case 'poisoned':
        return hasEffect(target, AfflictionType.Poison);
    }
  });
}

/**
 * The form a skill takes when aimed at an occupied hex.
 *
 * Pure and shared, because three places have to agree on it: the resolver that
 * runs the skill, the tooltip that describes it, and the highlight pass that
 * decides which hexes are legal. A variant computed independently in any of
 * them would be a button whose description did not match what it did.
 */
export function skillVariantFor(skill: HeroSkill, targetIsEnemy: boolean): HeroSkill {
  if (!skill.occupiedVariant || !targetIsEnemy) return skill;
  return { ...skill, ...skill.occupiedVariant };
}

// ─── Repeat strikes ───────────────────────────────────────────────────────────

/**
 * The strikes Carnage doubles.
 *
 * Named rather than derived, and short on purpose. "Every single-target skill"
 * would sweep in Executioner and Rend — a doubled finisher is two kills, and a
 * doubled Rend is a bleed applied twice on a status that stacks. These two are
 * the Berserker's free swings, which is what makes doubling them a tempo
 * capstone rather than a damage multiplier on the whole kit.
 *
 * The first used to be `slash`, the Champion's class at-will. The Berserker's
 * free swing is its weapon's Basic Attack now, so that is what Carnage repeats.
 * A Berserker holding two weapons does **not** get two passes of two half-hands
 * (four half-blows): since the remaster (2026-10) it is exactly two full hits, one
 * from each weapon — see `carnageDualWield`.
 */
const CARNAGE_SKILLS: ReadonlySet<string> = new Set(['basic_attack', 'bloodthirst']);

const SINGLE_STRIKE: readonly number[] = [1];

/**
 * A dual-wield Basic Attack under Carnage: two full-strength hits, one per weapon.
 * Read by both `strikeScales` (one pass) and `weaponStrikes` (both hands at 1.0),
 * so the resolver, the preview and the floating numbers all land two blows, each
 * with its own dodge, crit, on-hit effects and drain.
 */
export function carnageDualWield(attacker: CombatUnit | undefined, skill: HeroSkill): boolean {
  return !!attacker && !!skill.dualWield && !!skill.damage && CARNAGE_SKILLS.has(skill.id)
    && hasEffect(attacker, AuraType.Carnage);
}

/**
 * How many times a strike lands, and for how much each time — one entry per
 * pass, holding that pass's fraction of a full strike.
 *
 * A list rather than a count-and-scale pair, because the three auras that
 * answer this want three different shapes and only a list holds all of them:
 *
 * - **Carnage** repeats two named at-will swings at *full* value, so it is a
 *   tempo capstone on skills that were free anyway.
 * - **Rapid Fire** splits any single-target shot into a burst worth slightly
 *   more in total but far less per arrow — five crit rolls and five kill checks
 *   instead of one.
 * - **Flurry** leaves the strike itself alone and hangs three light blades off
 *   the back of it, which is the only one of the three that needs an uneven
 *   list.
 *
 * First match wins, and no hero can hold two of these: they are capstones on
 * three different paths, and a hero has exactly one path.
 *
 * Mana and cooldown are spent once regardless. Charging per strike would make
 * Rapid Fire cost five times as much to fire the same arrow, which is a
 * different mechanic wearing the same name.
 */
export function strikeScales(attacker: CombatUnit, skill: HeroSkill): readonly number[] {
  if (CARNAGE_SKILLS.has(skill.id) && hasEffect(attacker, AuraType.Carnage)) {
    return carnageDualWield(attacker, skill) ? SINGLE_STRIKE : [1, 1];
  }
  if (!skill.damage) return SINGLE_STRIKE;

  // A barrage is its projectiles and a repeating skill its hits: whole strikes,
  // each with its own crit and dodge, and one cast for mana and cooldown.
  if (skill.barrage) return Array<number>(skill.barrage).fill(1);
  if (skill.repeats) return Array<number>(skill.repeats).fill(1);

  // Twin Fangs: Frostbite's second fang. A pass rather than a hand, because each
  // fang is a whole strike (its own crit, dodge and on-hit) and the Chill the
  // skill carries is applied once after every pass. Read off the unit's own
  // passive list, since this module sits beneath `passives`.
  if (skill.id === 'frostbite' && attacker.passives?.includes('twinFangs')) {
    const scale = attacker.passiveRanks?.twinFangs?.scale ?? 1;
    return [1, Math.round(BALANCE.TWIN_FANGS_SECOND_HIT * scale * 1000) / 1000];
  }

  // Any single-target shot, including the finisher: five 30% executions still
  // total one execution, so the burst never widens the window it fires into.
  if (skill.targetType === SkillTargetType.Single && hasEffect(attacker, AuraType.RapidFire)) {
    return Array<number>(BALANCE.RAPID_FIRE_STRIKES).fill(
      BALANCE.RAPID_FIRE_TOTAL / BALANCE.RAPID_FIRE_STRIKES,
    );
  }

  // Blade Recall: the throw in front of the extraction belongs to the Fan of
  // Blades node (at its rung); without it the Signature throws nothing of its own
  // and only Flurry's knives fly, each a quarter of the throw it would have
  // chased. The extraction is not a pass at all — see `skillResolution`.
  if (skill.extractsBlades) {
    const fan = attacker.passives?.includes('fanOfBlades')
      ? [attacker.passiveRanks?.fanOfBlades?.scale ?? 1]
      : [];
    const knives = hasEffect(attacker, AuraType.Flurry)
      ? Array<number>(flurryFollowupsFor(skill)).fill(BALANCE.FLURRY_SCALE)
      : [];
    return [...fan, ...knives];
  }

  // Unrestricted by shape — the Skirmisher's whole identity is area damage, so a
  // follow-up that only fired on single targets would be a capstone the path is
  // built not to use — but fewer behind an area strike (`flurryFollowupsFor`)
  if (hasEffect(attacker, AuraType.Flurry)) {
    return [1, ...Array<number>(flurryFollowupsFor(skill)).fill(BALANCE.FLURRY_SCALE)];
  }

  return SINGLE_STRIKE;
}

/**
 * The knives Flurry sends after one strike of `skill`: `FLURRY_FOLLOWUPS_SINGLE` behind a
 * single-target strike, `FLURRY_FOLLOWUPS_AREA` behind an area one (`isAreaSkill`), which
 * reaches every enemy it hits with them (playtest 2026-10-21, PT-40). Each knife that
 * lands embeds a blade, so the blades follow the same count.
 */
export function flurryFollowupsFor(skill: HeroSkill): number {
  return isAreaSkill(skill) ? BALANCE.FLURRY_FOLLOWUPS_AREA : BALANCE.FLURRY_FOLLOWUPS_SINGLE;
}

/**
 * The hands a single strike is made with, as fractions of a full blow.
 *
 * `[1]` for everything but a dual-wield Basic Attack, which is one strike per
 * weapon at `DUAL_WIELD_STRIKE_SCALE` each. Kept apart from `strikeScales`
 * rather than folded into it because the two answer different questions and
 * compose: a *pass* is how many times the action repeats (Carnage, Rapid
 * Fire, Flurry), a *hand* is what one pass is made of. The one exception is a
 * dual-wield Basic Attack under Carnage: one pass of two *full* hands
 * (`carnageDualWield`), never two passes of two halves.
 *
 * The resolver also settles each hand's drain on its own, which is the
 * difference the split exists to carry: every other multi-strike pools its
 * lifesteal and heals once, and a dual-wielder's two hands are two blows.
 */
export function weaponStrikes(skill: HeroSkill, attacker?: CombatUnit): readonly number[] {
  if (!skill.dualWield || !skill.damage) return SINGLE_STRIKE;
  if (carnageDualWield(attacker, skill)) return [1, 1];
  return [BALANCE.DUAL_WIELD_STRIKE_SCALE, BALANCE.DUAL_WIELD_STRIKE_SCALE];
}

// ─── Action and movement locks ────────────────────────────────────────────────

/**
 * Root and Silence are near inverses, and that is the whole point of the pair:
 * a rooted unit fights from where it stands, a silenced one can walk but uses no
 * skill but its Basic Attack (`cooldowns.silenceBars`). Stun and Freeze remain the only effects that take a whole turn away, and
 * both are handled at turn start rather than here — read *pre*-tick, so their
 * durations mean what they say.
 */
export function isRooted(unit: CombatUnit): boolean {
  return hasEffect(unit, AfflictionType.Root);
}

export function isSilenced(unit: CombatUnit): boolean {
  return hasEffect(unit, AfflictionType.Silence);
}

/**
 * Whether a unit is prevented from doing anything at all this turn.
 *
 * Folded into one predicate because there are now three ways in and the HUD,
 * the AI and the resolver all have to agree on the answer. The third is not a
 * debuff at all — a Shadowblade winding up Vanish is holding perfectly still on
 * purpose — which is exactly why the question is "can this unit act" rather
 * than "is this unit stunned".
 */
export function isActionLocked(unit: CombatUnit): boolean {
  return (
    hasEffect(unit, AfflictionType.Stun) ||
    hasEffect(unit, AfflictionType.Freeze) ||
    // The Cave Bear's Winter Sleep and the Rime Jarl's kneel cost the turn the
    // same way, though neither is an affliction the party applied
    hasEffect(unit, AuraType.Slumber) ||
    hasEffect(unit, AuraType.Kneeling) ||
    isWindingUp(unit)
  );
}

// ─── Vanish ───────────────────────────────────────────────────────────────────

/**
 * Whether the Shadowblade is still paying for its Vanish.
 *
 * The wind-up is over on the aura's *last* turn, so a Vanish cast with two
 * turns of wind-up costs exactly two turns and the third is the payoff. Reading
 * the outgoing duration is the same trick Doom and the Martyr seal use, for the
 * same reason: it is the only way to name "the turn this ends" from inside a
 * countdown.
 */
export function isWindingUp(unit: CombatUnit): boolean {
  const ambush = unit.activeEffects.find((e) => e.type === AuraType.Ambush);
  return !!ambush && ambush.duration > 1;
}

/** How many banked actions the unit has left, if any. */
export function ambushCharges(unit: CombatUnit): number {
  if (isWindingUp(unit)) return 0;
  const ambush = unit.activeEffects.find((e) => e.type === AuraType.Ambush);
  return ambush ? Math.max(0, Math.round(ambush.magnitude)) : 0;
}

// ─── Stealth ──────────────────────────────────────────────────────────────────

/**
 * Stealth hides a unit from single-target skills only. Area skills still catch
 * it — otherwise Stealth would be flat invulnerability with a duration, and the
 * counterplay (sweep the area you think it is in) would not exist.
 */
/**
 * Whether the unit is held out of the fight: the Burrowmother under the sand, a hero in
 * the Colossus's tomb or the Jorogumo's web. Nothing aims at it, damages it or afflicts it, and its turn is lost
 * (its statuses keep exactly the clock they had).
 */
export const isSealed = (unit: CombatUnit): boolean =>
  hasEffect(unit, AuraType.Burrowed) || hasEffect(unit, AuraType.Encased) || hasEffect(unit, AuraType.Webbed);

/** What nothing may damage: Invulnerability, a Revenant between lives, and anything sealed. */
export const isHeldFromHarm = (effects: ActiveEffect[]): boolean =>
  effects.some(
    (e) =>
      e.type === AuraType.Invulnerability ||
      e.type === AuraType.SoulSplit ||
      e.type === AuraType.Burrowed ||
      e.type === AuraType.Encased ||
      e.type === AuraType.Webbed ||
      e.type === AuraType.Suspended ||
      // Jadeveil: Kairen up in the clouds while his dive is warned
      e.type === AuraType.Aloft,
  );

/**
 * Jadeveil: Silk Hollow / Yokai — the Jorōgumo on her threads above the arena. Unlike a
 * sealed unit she acts; like one, nothing aims at her, harms her or afflicts her.
 */
export const isSuspended = (unit: CombatUnit): boolean =>
  hasEffect(unit, AuraType.Suspended) || hasEffect(unit, AuraType.Aloft);

export function isHiddenFrom(target: CombatUnit, skill: HeroSkill): boolean {
  // Two ways to be unpickable, folded into one predicate so every call site —
  // the targeting highlights and the AI's candidate scan — honours both without
  // having to know there are two.
  if (target.untargetable) return true;
  // A Revenant lying broken between its lives is not there to be aimed at
  if (hasEffect(target, AuraType.SoulSplit)) return true;
  // Under the sand, or sealed in a tomb whose block stands in the hero's place
  if (isSealed(target)) return true;
  // Hanging above the arena on her threads
  if (isSuspended(target)) return true;
  return hasEffect(target, AuraType.Stealth) && !isAreaSkill(skill);
}

/**
 * Whether a skill covers an area rather than a single target.
 *
 * Lives here rather than in `combatEngine` because that module imports this one.
 * There were briefly two definitions, and they disagreed about cones: cones take
 * their extent from `range` and ignore `aoeRadius` entirely, so a cone with the
 * field omitted counted as area for the taunt rule and as single-target for
 * stealth. A stealthed unit was untargetable by a skill that visibly swept the
 * hex it stood on.
 */
export function isAreaSkill(skill: HeroSkill): boolean {
  return (
    skill.targetType === SkillTargetType.Ring ||
    skill.targetType === SkillTargetType.Arc ||
    // A chain reaches several bodies without naming a radius, which is the same
    // thing this predicate exists to catch: it should sweep a hidden unit up
    // rather than be refused for not being able to see one.
    skill.targetType === SkillTargetType.Chain ||
    (skill.aoeRadius ?? 0) > 0
  );
}

// ─── Barrier ──────────────────────────────────────────────────────────────────

export interface BarrierResult {
  /** Damage that survives to reach HP. */
  hpDamage: number;
  absorbed: number;
  /** Effect list with the barrier drained, and removed if fully spent. */
  effects: ActiveEffect[];
}

/**
 * Spends a barrier against an incoming hit.
 *
 * Called from inside `damageUnit`, before the HP subtraction, so every source
 * of damage in the game is covered by construction — a barrier that only
 * stopped skill damage but not a poison tick would be a bug nobody notices
 * until a fight is lost to it.
 */
export function absorbWithBarrier(effects: ActiveEffect[], amount: number): BarrierResult {
  const barrier = effects.find((e) => e.type === AuraType.Barrier);
  if (!barrier || barrier.magnitude <= 0 || amount <= 0) {
    return { hpDamage: amount, absorbed: 0, effects };
  }

  const absorbed = Math.min(barrier.magnitude, amount);
  const remaining = barrier.magnitude - absorbed;

  return {
    hpDamage: amount - absorbed,
    absorbed,
    effects:
      remaining > 0
        ? effects.map((e) => (e === barrier ? { ...e, magnitude: remaining } : e))
        : effects.filter((e) => e !== barrier),
  };
}

/**
 * Spends a Reckoning barrier against incoming damage, before any ordinary Barrier.
 *
 * Only what this barrier soaks is stored, once per call — so each hit counts once,
 * and nothing another shield absorbed ever feeds the shockwave. When it is spent to
 * nothing it is removed and returned as `broken` (carrying its final `stored`), and
 * the caller sets off the release once the write has landed.
 */
export function absorbWithReckoning(
  effects: ActiveEffect[],
  amount: number,
): BarrierResult & { broken?: ActiveEffect } {
  const shield = effects.find((e) => e.type === AuraType.Reckoning);
  if (!shield || shield.magnitude <= 0 || amount <= 0) {
    return { hpDamage: amount, absorbed: 0, effects };
  }
  const absorbed = Math.min(shield.magnitude, amount);
  const next: ActiveEffect = {
    ...shield,
    magnitude: shield.magnitude - absorbed,
    stored: (shield.stored ?? 0) + absorbed,
  };
  return next.magnitude > 0
    ? { hpDamage: amount - absorbed, absorbed, effects: effects.map((e) => (e === shield ? next : e)) }
    : { hpDamage: amount - absorbed, absorbed, effects: effects.filter((e) => e !== shield), broken: next };
}

/**
 * The shockwave a Reckoning releases: the base share of its owner's Attack plus what
 * it stored, the stored part capped. Fixed damage, no crit and no defence.
 */
export function reckoningBurst(attack: number, stored: number): number {
  const base = attack * BALANCE.RECKONING_BASE;
  const banked = Math.min(Math.max(0, stored), attack * BALANCE.RECKONING_CAP);
  return Math.max(1, Math.round(base + banked));
}

// ─── Freeze ───────────────────────────────────────────────────────────────────

/**
 * The bonus damage a struck frozen unit takes as the ice gives way.
 *
 * A fraction of the **target's own** pool rather than anything about whoever
 * struck it, and that is the whole design: a Doom expiring, a Thorns reflection,
 * a summon's decay and a coated blade all shatter the same way, and half of
 * those have no attacker to roll a strike against. Read through `combatMaxHp`,
 * so a Wildshaped Druid frozen in bear form is measured against the pool it is
 * actually fighting out of.
 *
 * One definition, two readers: `combatStore.damageUnit` adds it to the incoming
 * blow, and `combatEvents.applyOnHitStatuses` announces it. It is deliberately
 * *not* rolled through `damageCalc` — no crit, no defence subtraction — because
 * this is the ice breaking rather than a second strike.
 */
export function shatterBurst(unit: CombatUnit): number {
  if (hasEffect(unit, AfflictionType.Freeze)) {
    return Math.max(1, Math.round(combatMaxHp(unit) * BALANCE.SHATTER_BURST_HP));
  }
  // A boss's Brittle mark carries its burst, sized from its creator when it was made
  const brittle = unit.activeEffects.find((e) => e.type === AfflictionType.Brittle);
  return brittle ? Math.max(1, Math.round(brittle.magnitude)) : 0;
}

/**
 * Whether the next blow on this unit shatters something: a Freeze, or the Brittle
 * mark a boss wears instead of one. What Shatterpoint and Shatterstep ask of the
 * pre-blow snapshot, so both recognise either kind of ice the same way.
 */
export function isShatterable(unit: CombatUnit): boolean {
  return hasEffect(unit, AfflictionType.Freeze) || hasEffect(unit, AfflictionType.Brittle);
}

/**
 * Whether a Chill that would freeze this target makes it Brittle instead: the
 * target refuses Freeze (a boss), and the Chill comes from the player's side,
 * which in practice is the Hydromancer's own kit. A boss chilling a hero still
 * freezes the hero.
 */
export function chillMakesBrittle(
  target: CombatUnit,
  effect: Pick<ActiveEffect, 'type' | 'exact'>,
  sourceIsPlayer: boolean,
  refusesFreeze: boolean,
): boolean {
  return sourceIsPlayer && refusesFreeze && chillUpgrades(target, effect);
}

/**
 * Whether landing this effect on `target` turns a Chill into a Freeze: a Chill
 * arriving on an already-chilled unit, unless it is `exact`. The one definition
 * the store applies and the interrupt check reads, so a Chill that freezes is
 * treated as a Freeze (an interrupt, a boss's refusal) before it is written.
 */
export function chillUpgrades(
  target: CombatUnit,
  effect: Pick<ActiveEffect, 'type' | 'exact'>,
): boolean {
  return (
    !effect.exact &&
    effect.type === AfflictionType.Chill &&
    target.activeEffects.some((e) => e.type === AfflictionType.Chill)
  );
}

// ─── Thorns ───────────────────────────────────────────────────────────────────

/**
 * Damage a Thorns aura sends back to whoever landed the hit.
 *
 * Scaled off the damage actually taken rather than a flat number, so retaliation
 * is a reason to be hit hard — which is exactly the trade a taunting tank is
 * making. Deliberately not routed back through `damageUnit`'s barrier logic on
 * the attacker's side beyond the normal path: reflect is damage like any other.
 */
export function reflectedDamage(target: CombatUnit, damageTaken: number): number {
  // Flame Guard is Thorns in fire's colours; a unit wearing both reflects the stronger
  const thorns = target.activeEffects
    .filter((e) => e.type === AuraType.Thorns || e.type === AuraType.FlameGuard)
    .sort((a, b) => b.magnitude - a.magnitude)[0];
  if (!thorns || damageTaken <= 0) return 0;
  // Read here rather than baked into the aura: Thorns is often applied *to* this
  // unit by an ally's skill, and "your thorns bite deeper" is a property of who
  // is wearing them, not of who cast them
  const multiplier = target.masteryModifiers?.thornsMultiplier ?? 1;
  return Math.max(1, Math.round(damageTaken * thorns.magnitude * multiplier));
}

// ─── Shock ────────────────────────────────────────────────────────────────────

/**
 * Where a shocked unit's damage jumps to, and how much of it arrives.
 *
 * One adjacent ally, nearest-then-lowest-HP, at `SHOCK_CHAIN_FRACTION`. A single
 * hop rather than a spreading chain: chains that re-trigger off their own damage
 * are how a status accidentally becomes the strongest thing in the game, and
 * capping the hop count makes that impossible rather than unlikely. Forked Current
 * is the one exception, and it is one more hop (`shockSecondHop`), never a chain.
 */
export function shockChain(
  target: CombatUnit,
  allUnits: CombatUnit[],
  damageTaken: number,
  /** Extra share of the base fraction the jump carries (Conductive Arc), 0 for none. */
  bonus = 0,
): { unit: CombatUnit; damage: number } | null {
  if (damageTaken <= 0 || !hasEffect(target, AfflictionType.Shock)) return null;

  const victim = lowestBeside(target, allUnits, [target.id]);
  if (!victim) return null;

  const damage = Math.max(1, Math.round(damageTaken * BALANCE.SHOCK_CHAIN_FRACTION * (1 + bonus)));
  return { unit: victim, damage };
}

/** The lowest-health living unit of `from`'s side next to it, leaving out `skip`. */
function lowestBeside(from: CombatUnit, allUnits: CombatUnit[], skip: readonly string[]): CombatUnit | undefined {
  return allUnits
    .filter(
      (u) =>
        !skip.includes(u.id) &&
        u.currentHp > 0 &&
        u.isPlayer === from.isPlayer &&
        hexDistance(u.position, from.position) === 1
    )
    .sort((a, b) => a.currentHp - b.currentHp)[0];
}

/**
 * Forked Current: the one hop past the first jump, to the lowest-health unit beside
 * the first victim, at `share` of what the first jump carried. Never back to the
 * struck unit. It has no way to call itself, so there is no third hop.
 */
export function shockSecondHop(
  struck: CombatUnit,
  first: { unit: CombatUnit; damage: number },
  allUnits: CombatUnit[],
  share: number,
): { unit: CombatUnit; damage: number } | null {
  if (share <= 0) return null;
  const victim = lowestBeside(first.unit, allUnits, [struck.id, first.unit.id]);
  return victim ? { unit: victim, damage: Math.max(1, Math.round(first.damage * share)) } : null;
}

/**
 * The share Forked Current gives a jump `attacker` set off. A companion holds no
 * modifiers of its own, so its echo forks on its owner's node.
 */
export function shockSecondHopShare(attacker: CombatUnit, allUnits: CombatUnit[]): number {
  const holder = attacker.companion ? allUnits.find((u) => u.id === attacker.summonedBy) : attacker;
  return holder?.masteryModifiers?.shockSecondHop ?? 0;
}

/**
 * Whether a blow from `skill` may set off Shock's jump (remaster, 2026-10): only a
 * spell that itself applies Shock. A Basic Attack, a spell that lays no Shock, damage
 * over time, reflected damage and the jump itself never do — the last three never
 * reach the on-hit path at all, and the first two fail here. The victim must already
 * be Shocked *before* the blow (the caller passes the pre-blow snapshot), so the
 * first Shock a spell lays never jumps on the same hit. Side-blind on purpose: an
 * enemy spell that applies Shock (the Drummer's) keeps its own interaction, and no
 * enemy ability is reclassified as a Stormcaller spell to get there.
 */
export function triggersShock(skill: HeroSkill | undefined): boolean {
  return !!skill && skillEffects(skill).some((e) => e.type === AfflictionType.Shock);
}

/**
 * Conductive Arc's extra share of the Shock jump an Arc sets off, by rung; 0 for any
 * other skill or a caster without the node. A companion's echo carries none: the
 * node is its owner's, not the elemental's.
 */
export function conductiveArcBonus(attacker: CombatUnit, skill: HeroSkill | undefined): number {
  if (skill?.id !== 'arc' || !attacker.passives?.includes('conductiveArc')) return 0;
  return BALANCE.CONDUCTIVE_ARC_BONUS * (attacker.passiveRanks?.conductiveArc?.scale ?? 1);
}

// ─── Detonation ───────────────────────────────────────────────────────────────

/**
 * Turns of an affliction that count toward a detonation.
 *
 * Permanent (`-1`) and conditional (`99`) durations are not a stockpile of
 * pending ticks — a permanent aura is one turn's worth of "still on", not
 * ninety-nine — so they count as a single turn. Real durations are capped too,
 * so a long-stacked affliction cannot detonate for an unbounded multiple.
 *
 * The `99` arm is kept even though **Freeze no longer uses it**: it was the only
 * affliction authored that way, and it runs at `FREEZE_DURATION` now. Auras with
 * no natural end still reach here through `detonationMultiplier`, and a
 * detonator aimed at one must not read the sentinel as ninety-nine turns banked.
 */
export function detonationTurns(duration: number): number {
  if (duration === -1 || duration === 99) return 1;
  return Math.max(0, Math.min(BALANCE.MAX_DETONATE_TURNS, duration));
}

/** The affliction a detonation would strip, or null if it leaves the target alone. */
export function detonationConsumes(
  target: CombatUnit,
  skill: HeroSkill
): AfflictionType | null {
  if (!skill.detonates?.consume) return null;
  const present = target.activeEffects.some((e) => e.type === skill.detonates!.status);
  return present ? skill.detonates.status : null;
}

/** Holy weapon riders deliberately exclude all other spells and area strikes. */
export function holyStrikeEligible(skill: HeroSkill): boolean {
  return skill.id === 'basic_attack' || skill.id === 'smite';
}
export function sacredSealFor(attacker: CombatUnit, target: CombatUnit): ActiveEffect | undefined {
  return target.activeEffects.find(e => e.type === AfflictionType.SacredSeal && e.sourceSide === attacker.isPlayer);
}
/**
 * Crowned Prey's crown on `target`, if `attacker`'s side may spend it: any damaging hit
 * by the side that laid it (`sourceSide`), the Apex's own included.
 */
export function crownedPreyFor(attacker: CombatUnit, target: CombatUnit): ActiveEffect | undefined {
  return target.activeEffects.find(e => e.type === AfflictionType.CrownedPrey && e.sourceSide === attacker.isPlayer && (e.stacks ?? 1) > 0);
}
/**
 * Hunter's Mark on `target` that this strike reads: only the marking Hawk's own Hawk
 * attacks, Hunter's Mark itself excluded (it lays the mark rather than spending it).
 */
export function huntersMarkFor(attacker: CombatUnit, target: CombatUnit, skill: HeroSkill): ActiveEffect | undefined {
  if (skill.formSkill !== 'hawk' || skill.marks?.type === AfflictionType.HuntersMark) return undefined;
  return target.activeEffects.find(e => e.type === AfflictionType.HuntersMark && e.sourceUnitId === attacker.id && (e.stacks ?? 1) > 0);
}

// Advanced (level 21–25): Arcanist

/**
 * White Heat: the factor on a stacking status's ceiling when `source` adds to the
 * pile. Only Burn, and only off the hand stacking it now — the ceiling is the
 * Pyromancer's own craft, the way `burnMagnitudeBonus` is. 1 for anything else.
 */
export function burnCeilingScale(source: CombatUnit | undefined, type: StatusEffectType): number {
  if (type !== AfflictionType.Burn) return 1;
  return 1 + (source?.masteryModifiers?.burnCapBonus ?? 0);
}

/**
 * Brimming Over: how much of `incoming` spills, by `source`'s share of what the pile
 * could not hold. 0 for a Burn landing on nothing: that pile has lost nothing. Never
 * more than the share of what arrived, where a pile already stands past this hand's
 * ceiling (another hand's White Heat).
 */
export function burnSpill(
  source: CombatUnit | undefined,
  pile: ActiveEffect | undefined,
  incoming: ActiveEffect,
): number {
  const share = source?.masteryModifiers?.burnOverflowShare ?? 0;
  if (share <= 0 || !pile || incoming.type !== AfflictionType.Burn) return 0;
  const excess = pile.magnitude + incoming.magnitude - burnCeiling(source);
  return excess > 0 ? Math.min(incoming.magnitude, excess) * share : 0;
}

/** The ceiling of a Burn pile `source` adds to, which is what a spill measures against. */
export function burnCeiling(source: CombatUnit | undefined): number {
  return BALANCE.MAX_BURN_MAGNITUDE * burnCeilingScale(source, AfflictionType.Burn);
}

/** Permafrost: whole turns added to a Freeze (or a boss's Brittle mark) `source`'s Chill makes. */
export function freezeDurationBonus(source: CombatUnit | undefined): number {
  return Math.round(source?.masteryModifiers?.freezeDurationBonus ?? 0);
}

/**
 * The whole extra share a Shock jump carries off `attacker`'s spell: Conductive
 * Arc's (Arc only) plus High Voltage's (every Shock-laying spell). They add, as
 * two nodes granting two fractions of the same base.
 */
export function shockJumpBonus(attacker: CombatUnit, skill: HeroSkill | undefined): number {
  return conductiveArcBonus(attacker, skill) + (attacker.masteryModifiers?.shockChainBonus ?? 0);
}

// Advanced (level 21–25): Druid

/**
 * Overflowing Grace: the Barrier a heal leaves behind, from the part of it that
 * put no HP back (`amount` against `restored`). 0 without the node or with
 * nothing spilled over. Rounded — a pool is whole.
 */
export function overhealBarrier(healer: CombatUnit, amount: number, restored: number): number {
  const share = healer.masteryModifiers?.overhealBarrier ?? 0;
  const spilled = amount - restored;
  if (share <= 0 || spilled <= 0) return 0;
  return Math.max(1, Math.round(spilled * share));
}

/**
 * Deep Grip: whole turns added to a Root, off the unit that laid it — stamped in
 * `combatStore.applyEffect` beside Deep Cuts' Bleed, so a skill, a passive and
 * a stage's Root all last alike.
 */
export function rootDurationBonus(
  units: readonly Pick<CombatUnit, 'id' | 'masteryModifiers'>[],
  effect: Pick<ActiveEffect, 'type' | 'sourceUnitId'>,
): number {
  if (effect.type !== AfflictionType.Root || !effect.sourceUnitId) return 0;
  return Math.round(units.find((u) => u.id === effect.sourceUnitId)?.masteryModifiers?.rootDurationBonus ?? 0);
}

/** Fang and Talon: the factor on a shape's own skills (`formSkill`) for this attacker. */
export function formSkillDamageScale(attacker: CombatUnit, skill: HeroSkill): number {
  if (!skill.formSkill) return 1;
  return 1 + (attacker.masteryModifiers?.formSkillDamageBonus ?? 0);
}
