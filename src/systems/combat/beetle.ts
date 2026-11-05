import {
  ActiveEffect, AfflictionType, ArenaHazard, AuraType, CombatUnit, HeroSkill, HexCoord, PreparedReaction, SkillTargetType,
} from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { hexDistance } from '@/utils/hexUtils';
import { canReact, intercepts, watchesWard } from '@/systems/combat/reactions';
import { resolveSelfMove } from '@/systems/combat/forcedMovement';
import { isRooted } from '@/systems/combat/statusEffects';
import { hasPassive, isImmuneTo, isImmuneToPush, passiveRank } from '@/systems/combat/passives';
import { hardenedShellDashDamage, heavyHandsDamage, retributionStrike, returnedBlowStrike, shellBreathChi, shoulderShare } from '@/systems/combat/passiveFormulas';
import { ignoresDisable, isBoss } from '@/systems/combat/bossControl';

/**
 * The Beetle's rules (the private project notes, "Beetle"), pure.
 *
 * A Monk path that protects by standing between: staff blows bank a carapace,
 * chi is spent on getting between an ally and a blow and on moving enemies.
 * What is new machinery lives here and is read by the systems that already own
 * the moment — the damage funnel soaks and shares, the resolver banks and
 * throws, the reactions leap — so each of them learns one call rather than a
 * Beetle's worth of branches.
 *
 * - **Carapace charges** (`AuraType.Carapace`): a counted self-aura, banked by
 *   Iron Carapace and by Meditate with Shell Breath, each worth Physical
 *   Defense. A full set soaks the next hostile blow whole and is spent.
 * - **Shoulder to Shoulder**: an ally beside a Beetle that owns it takes less
 *   from every blow, and the Beetle wears a badge for the whole fight.
 * - **Grip and Throw's boss clause**: a target that can be neither thrown nor
 *   stunned takes the heavier blow instead, and nothing else.
 * - **Vengeful Shell** (`vengefulCover`): a Reaction judged *before* a blow
 *   lands. A hostile single-target blow at an ally within reach is taken by the
 *   Beetle, who leaps beside the ally first; the answer strikes the attacker.
 * - **Carapace Bastion** (`bastionCover`): static ground on which a covered
 *   ally's hostile blow is split, the Beetle taking its share.
 */

export const IRON_CARAPACE_ID = 'iron_carapace';
export const GRIP_AND_THROW_ID = 'grip_and_throw';
export const HORN_SWEEP_ID = 'horn_sweep';

const B = BALANCE.BEETLE;

/** Carapace charges this unit holds. */
export function carapaceCharges(unit: Pick<CombatUnit, 'activeEffects'>): number {
  return Math.round(unit.activeEffects.find((e) => e.type === AuraType.Carapace)?.magnitude ?? 0);
}

/** Whether the carapace is full: the next hostile blow is soaked whole. */
export function carapaceFull(unit: Pick<CombatUnit, 'activeEffects' | 'masteryModifiers'>): boolean {
  return carapaceCharges(unit) >= carapaceMax(unit);
}

/** How many charges this unit's carapace holds: a full set, and what a worn set adds. */
export function carapaceMax(unit: Pick<CombatUnit, 'masteryModifiers'>): number {
  return B.CARAPACE_MAX + (unit.masteryModifiers?.carapaceChargeBonus ?? 0);
}

/**
 * The Carapace aura after banking `count` more charges, capped at a full set.
 * The store merges a re-applied aura by keeping the larger magnitude, so laying
 * this is the bank — and a bank at a full set changes nothing.
 */
export function bankedCarapace(unit: CombatUnit, count = 1): ActiveEffect {
  return {
    type: AuraType.Carapace,
    magnitude: Math.min(carapaceMax(unit), carapaceCharges(unit) + count),
    duration: -1,
    sourceUnitId: unit.id,
  };
}

/**
 * Whether a full carapace soaks this damage: a hostile blow (not a clock running
 * out, not the carrier's own price) of at least a point. Soaked whole, before
 * any Barrier, so the shell is the outermost thing the blow meets.
 */
export function carapaceSoaks(
  target: Pick<CombatUnit, 'activeEffects' | 'id' | 'masteryModifiers'>,
  amount: number,
  sourceId: string | undefined,
  fromTick: boolean | undefined,
): boolean {
  return amount > 0 && !fromTick && sourceId !== undefined && sourceId !== target.id && carapaceFull(target);
}

/**
 * The share of a blow `target` does not take for standing beside a Beetle that
 * owns Shoulder to Shoulder: the best such neighbour's, never summed (two Beetles
 * are two rings, not a thicker one). The Beetle's own blows are its own.
 */
export function shoulderReduction(target: CombatUnit, units: readonly CombatUnit[]): number {
  let best = 0;
  for (const u of units) {
    if (u.id === target.id || u.currentHp <= 0 || u.isPlayer !== target.isPlayer) continue;
    if (!hasPassive(u, 'shoulderToShoulder') || hexDistance(u.position, target.position) !== 1) continue;
    best = Math.max(best, shoulderShare(passiveRank(u, 'shoulderToShoulder')));
  }
  return best;
}

/**
 * What a unit wears from the first moment of a fight: Shoulder to Shoulder's
 * badge, for the whole fight, so the player remembers to stand in the ring.
 * Empty for every unit without it.
 */
export function fightStartAuras(unit: Pick<CombatUnit, 'id' | 'passives' | 'passiveRanks'>): ActiveEffect[] {
  if (!unit.passives?.includes('shoulderToShoulder')) return [];
  return [{
    type: AuraType.ShoulderGuard,
    magnitude: Math.round(shoulderShare(passiveRank(unit as CombatUnit, 'shoulderToShoulder')) * 100),
    duration: -1,
    sourceUnitId: unit.id,
  }];
}

/**
 * What a Beetle's strike is multiplied by for its rules about its own skills: Heavy
 * Hands' Horn Sweep and Grip and Throw (20% harder, the boss blow included). On the
 * multiplier, so armour still answers the better blow. 1 for every other skill and
 * every other attacker.
 */
export function beetleStrikeMultiplier(attacker: CombatUnit, skill: Pick<HeroSkill, 'id'>): number {
  if ((skill.id === HORN_SWEEP_ID || skill.id === GRIP_AND_THROW_ID) && hasPassive(attacker, 'heavyHands')) {
    return heavyHandsDamage(passiveRank(attacker, 'heavyHands'));
  }
  return 1;
}

/**
 * Whether a target can be neither thrown nor stunned, which turns Grip and Throw
 * into its heavier blow (`HeroSkill.immovableVariant`). A boss is both: too heavy
 * to lift, and it does not keep a Stun. Anything else needs both immunities — an
 * Immovable target that can still be stunned is gripped and stunned where it
 * stands.
 */
export function immovableTarget(target: CombatUnit): boolean {
  if (isBoss(target)) return true;
  const unthrowable = isImmuneToPush(target);
  const unstunnable = ignoresDisable(target, AfflictionType.Stun) || isImmuneTo(target, AfflictionType.Stun);
  return unthrowable && unstunnable;
}

/** The skill as it lands on `target`: its immovable variant when the target is one. */
export function skillAgainstTarget(skill: HeroSkill, target: CombatUnit | undefined): HeroSkill {
  if (!skill.immovableVariant || !target || target.isPlayer === undefined) return skill;
  return immovableTarget(target) ? { ...skill, ...skill.immovableVariant } : skill;
}

/**
 * Hardened Shell's Iron Carapace as it lands from where the Beetle stands (playtest
 * 2026-10-28). The reach and the dash are baked in when the unit is built
 * (`passives.withHardenedShell`); this is the half that depends on the cast. Struck
 * from beside the target it Taunts it for one round; struck from further off the
 * Beetle dashes in, the cast leaves its turn unspent (`freeAction`), and the blow
 * lands at the rung's share of its damage (playtest 2026-10-29: ⅓ / ⅔ / all). Any
 * other skill, or an Iron Carapace without the node, is returned as it is.
 */
export function ironCarapaceAt(caster: CombatUnit, skill: HeroSkill, targetCoord: HexCoord): HeroSkill {
  if (skill.id !== IRON_CARAPACE_ID || skill.selfMove?.kind !== 'dash' || !hasPassive(caster, 'hardenedShell')) return skill;
  if (hexDistance(caster.position, targetCoord) > 1) {
    const share = hardenedShellDashDamage(passiveRank(caster, 'hardenedShell'));
    return { ...skill, freeAction: true, damage: (skill.damage ?? 0) * share };
  }
  const taunt = { type: AfflictionType.Taunt, magnitude: 1, duration: B.HARDENED_SHELL_TAUNT_TURNS };
  const effects = skill.appliesEffect === undefined ? [] : Array.isArray(skill.appliesEffect) ? skill.appliesEffect : [skill.appliesEffect];
  return { ...skill, appliesEffect: [...effects, taunt] };
}

/** Chi Meditate restores on top of its own for this unit: Shell Breath's, or none. */
export function meditateChiBonus(unit: CombatUnit): number {
  return hasPassive(unit, 'shellBreath') ? shellBreathChi(passiveRank(unit, 'shellBreath')) : 0;
}

// ─── The capstones ────────────────────────────────────────────────────────────

/**
 * Whether a blow is one a Vengeful Shell may take: one aimed body, struck by a
 * single-target skill. Anything with an area — a radius, a ricochet, random
 * strikes, a knife dance between bodies, any shape but `Single` — is not taken,
 * and lands where it was aimed.
 */
export function takeableBlow(skill: Pick<HeroSkill, 'targetType' | 'aoeRadius' | 'chainFalloff' | 'randomEnemies' | 'knifeDance' | 'arenaWide'>): boolean {
  return skill.targetType === SkillTargetType.Single && !skill.aoeRadius && !skill.chainFalloff
    && !skill.randomEnemies && !skill.knifeDance && !skill.arenaWide;
}

/** Who takes a blow aimed at `target`, and where it stands to take it. */
export interface VengefulCover {
  reaction: PreparedReaction;
  owner: CombatUnit;
  /** The free hex beside the ally the owner leaps to; its own hex when it already stands beside them. */
  landing: HexCoord;
}

/**
 * The Vengeful Shell that takes this blow, if one does: the first prepared
 * (in preparation order) whose owner can act, has an answer left this round,
 * stands within reach of the struck ally and can reach a free hex beside them.
 * A Root holds an owner that would have to leap; one already beside the ally
 * takes the blow where it stands. The owner's own blows, a blow at the owner and
 * an area blow are never taken.
 */
export function vengefulCover(
  attacker: CombatUnit,
  target: CombatUnit,
  skill: HeroSkill,
  reactions: readonly PreparedReaction[],
  units: CombatUnit[],
  hazards: ArenaHazard[] = [],
): VengefulCover | undefined {
  if (!takeableBlow(skill) || target.objective || target.currentHp <= 0) return undefined;
  if (attacker.isPlayer === target.isPlayer) return undefined;
  const ordered = reactions.filter(intercepts).sort((a, b) => a.sequence - b.sequence);
  for (const reaction of ordered) {
    if ((reaction.shotsLeft ?? 0) <= 0) continue;
    const owner = units.find((u) => u.id === reaction.ownerId);
    if (!owner || owner.id === target.id || owner.id === attacker.id || owner.isPlayer !== target.isPlayer) continue;
    if (!canReact(owner, reaction)) continue;
    const trigger = reaction.spec.trigger;
    if (trigger.kind !== 'interceptAlly' || hexDistance(owner.position, target.position) > trigger.reach) continue;
    if (hexDistance(owner.position, target.position) === 1) return { reaction, owner, landing: owner.position };
    if (isRooted(owner)) continue;
    const leap: HeroSkill = { ...skill, selfMove: { kind: 'dash', range: trigger.reach + 1 } };
    const landing = resolveSelfMove(owner, leap, target.position, units, hazards);
    if (landing) return { reaction, owner, landing };
  }
  return undefined;
}

/**
 * The Carapace Leap that shields this blow's target before it lands, if one
 * does: the first prepared (in preparation order) `wardStruck` Reaction whose
 * ward is `target`, whose owner can act and stands within the leap's reach, and
 * which can reach a free hex beside the ward (its own hex when already beside
 * it). Any hostile blow counts, area blows included: the Leap does not take the
 * blow, it lays the Barriers that soak it. A Root holds the leap and the
 * Reaction waits, as `canReact` says.
 */
export function wardCover(
  attacker: CombatUnit,
  target: CombatUnit,
  reactions: readonly PreparedReaction[],
  units: CombatUnit[],
  hazards: ArenaHazard[] = [],
): VengefulCover | undefined {
  if (target.objective || target.currentHp <= 0 || attacker.isPlayer === target.isPlayer) return undefined;
  const ordered = reactions.filter((r) => watchesWard(r.skill) && r.wardId === target.id)
    .sort((a, b) => a.sequence - b.sequence);
  for (const reaction of ordered) {
    const owner = units.find((u) => u.id === reaction.ownerId);
    if (!owner || owner.id === target.id || owner.isPlayer !== target.isPlayer || !canReact(owner, reaction)) continue;
    const response = reaction.spec.response;
    if (hexDistance(owner.position, target.position) > response.range) continue;
    if (hexDistance(owner.position, target.position) === 1) return { reaction, owner, landing: owner.position };
    const landing = resolveSelfMove(owner, response, target.position, units, hazards);
    if (landing) return { reaction, owner, landing };
  }
  return undefined;
}

/**
 * The Bastion ground a cast leaves (`HeroSkill.bastion`), one per caster: a
 * recast replaces it by id.
 */
export const bastionId = (ownerId: string) => `bastion:${ownerId}`;

export function bastionHazard(owner: Pick<CombatUnit, 'id'>, skill: Pick<HeroSkill, 'id' | 'name' | 'bastion'>, hexes: HexCoord[]): ArenaHazard | undefined {
  if (!skill.bastion) return undefined;
  return {
    id: bastionId(owner.id),
    hexes,
    solid: false,
    skillId: skill.id,
    turnsLeft: skill.bastion.turns,
    ownerId: owner.id,
    bastion: { share: skill.bastion.share },
  };
}

/**
 * The Beetle that takes a share of a blow on `target`, and how much of `amount`
 * it takes: an ally standing in a living Beetle's Bastion, struck by a hostile
 * blow (not a clock running out, not its own price). The Beetle's own blows are
 * never split, and a share that rounds to nothing is no split.
 */
export function bastionCover(
  target: CombatUnit,
  amount: number,
  sourceId: string | undefined,
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[] | undefined,
  fromTick: boolean | undefined,
): { owner: CombatUnit; taken: number } | undefined {
  if (!hazards || fromTick || amount <= 0 || sourceId === undefined || target.objective) return undefined;
  const source = units.find((u) => u.id === sourceId);
  if (!source || source.isPlayer === target.isPlayer) return undefined;
  for (const ground of hazards) {
    if (!ground.bastion || ground.ownerId === undefined || ground.ownerId === target.id) continue;
    if (!ground.hexes.some((h) => h.q === target.position.q && h.r === target.position.r)) continue;
    const owner = units.find((u) => u.id === ground.ownerId);
    if (!owner || owner.currentHp <= 0 || owner.isPlayer !== target.isPlayer) continue;
    const taken = Math.floor(amount * ground.bastion.share);
    if (taken > 0) return { owner, taken };
  }
  return undefined;
}

// ─── The side trees ───────────────────────────────────────────────────────────

/**
 * How many prepared Reactions this unit may stand at once: two for a Beetle
 * holding Second Watch, one for everybody else.
 */
export function reactionLimit(unit: Pick<CombatUnit, 'passives'>): number {
  return unit.passives?.includes('secondWatch') ? B.SECOND_WATCH_REACTIONS : 1;
}

/** The id the Retribution blow is resolved as, for the log and the damage type. */
export const RETRIBUTION_ID = 'retribution_strike';

/**
 * The blow Retribution answers with, at the Beetle's rung, or undefined for a
 * unit without it: a single physical strike of a share of Attack, reaching
 * wherever the attacker stands.
 */
export function retributionBlow(owner: CombatUnit): HeroSkill | undefined {
  if (!hasPassive(owner, 'retribution')) return undefined;
  return {
    id: RETRIBUTION_ID,
    targetType: SkillTargetType.Single, range: B.VENGEFUL_STRIKE_RANGE,
    damage: retributionStrike(passiveRank(owner, 'retribution')),
    unlockLevel: 1, manaCost: 0,
  };
}

/** The id the Returned Blow is resolved as, for the damage type. */
export const RETURNED_BLOW_ID = 'returned_blow_strike';

/**
 * The blow Returned Blow answers a soak with, at the Beetle's rung, or undefined
 * for a unit without it: Retribution's shape, a single physical strike of a share of
 * Attack, reaching wherever the attacker stands.
 */
export function returnedBlow(owner: CombatUnit): HeroSkill | undefined {
  if (!hasPassive(owner, 'returnedBlow')) return undefined;
  return {
    id: RETURNED_BLOW_ID,
    targetType: SkillTargetType.Single, range: B.VENGEFUL_STRIKE_RANGE,
    damage: returnedBlowStrike(passiveRank(owner, 'returnedBlow')),
    unlockLevel: 1, manaCost: 0,
  };
}
