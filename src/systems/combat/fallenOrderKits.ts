import { AfflictionType, ArenaHazard, CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { hasEffect, isActionLocked, isHiddenFrom, meetsTargetRequirement } from '@/systems/combat/statusEffects';
import { hexDistance } from '@/utils/hexUtils';

/**
 * The Fallen Order's rules, pure: what each kit's signature is worth to the enemy AI,
 * and which of the Bell-Keeper's Dooms the bell no longer holds. The kits are
 * `data/skills/fallenOrderSkills.ts`; the board writes are `scripts/fallenOrder.ts`.
 *
 * Every signature here deals little or nothing at the cast, so the ordinary
 * damage-only score would never press it (`enemyAI.evaluateSkill`). Each is scored
 * on the problem it sets instead — above an at-will whenever it does something,
 * never when it would do nothing — and its cooldown is what limits it.
 */

const O = BALANCE.FALLEN_ORDER;

/** What a signature is worth, on the AI's damage scale (an at-will is about 10). */
export const ORDER_SIGNATURE_VALUE = 30;

export interface OrderValue {
  skill: HeroSkill;
  targetPos: HexCoord;
  value: number;
}

const alive = (u: CombatUnit) => u.currentHp > 0 && !u.objective;

/** The caster's living monks (not itself, not an objective). */
export function monksOf(caster: CombatUnit, units: readonly CombatUnit[]): CombatUnit[] {
  return units.filter((u) => alive(u) && u.id !== caster.id && u.isPlayer === caster.isPlayer);
}

/** The heroes standing against the caster. */
export function heroesAgainst(caster: CombatUnit, units: readonly CombatUnit[]): CombatUnit[] {
  return units.filter((u) => alive(u) && u.isPlayer !== caster.isPlayer && !u.summonedBy);
}

/** Whether a foe stands within `reach` of `pos`. */
const foeNear = (pos: HexCoord, foes: readonly CombatUnit[], reach: number) =>
  foes.some((f) => alive(f) && hexDistance(pos, f.position) <= reach);

/**
 * The monks a Bastion laid now would cover: those standing in the Warden's ring
 * with a hero close enough to strike them next turn.
 */
export function bastionCovers(warden: CombatUnit, foes: readonly CombatUnit[], units: readonly CombatUnit[]): CombatUnit[] {
  return monksOf(warden, units).filter(
    (m) => hexDistance(m.position, warden.position) <= O.BASTION_RADIUS && foeNear(m.position, foes, 4),
  );
}

/** Whether the Warden already has its Bastion standing. */
export function hasBastion(warden: CombatUnit, hazards: readonly ArenaHazard[]): boolean {
  return hazards.some((h) => h.bastion && h.ownerId === warden.id);
}

/** The monks the Abbot's Vow would answer for: within its reach, with a hero near them. */
export function vowCovers(abbot: CombatUnit, foes: readonly CombatUnit[], units: readonly CombatUnit[]): CombatUnit[] {
  return monksOf(abbot, units).filter(
    (m) => hexDistance(m.position, abbot.position) <= O.VOW_REACH && foeNear(m.position, foes, 4),
  );
}

/**
 * Who the bell tolls for: a hero in reach and in sight, not already Doomed, the
 * hardest hitter first — a clock on the party's damage is a clock on the Keeper.
 */
export function tollTarget(keeper: CombatUnit, skill: HeroSkill, foes: readonly CombatUnit[]): CombatUnit | undefined {
  return foes
    .filter(
      (f) =>
        alive(f) &&
        !isHiddenFrom(f, skill) &&
        meetsTargetRequirement(keeper, f, skill) &&
        hexDistance(keeper.position, f.position) <= skill.range &&
        !hasEffect(f, AfflictionType.Doom),
    )
    .sort(
      (a, b) =>
        Math.max(b.stats.attack, b.stats.magic) - Math.max(a.stats.attack, a.stats.magic) ||
        (a.id < b.id ? -1 : 1),
    )[0];
}

/** The heroes the Great Ring would catch if it rang now, less any already held. */
export function ringCatches(keeper: CombatUnit, foes: readonly CombatUnit[]): CombatUnit[] {
  return foes.filter(
    (f) => alive(f) && hexDistance(keeper.position, f.position) <= O.RING_RADIUS && !isActionLocked(f),
  );
}

/**
 * What a Fallen Order signature is worth to its AI, `null` when it would do nothing
 * now, or `undefined` when the skill is not one of the Order's scored signatures.
 */
export function fallenOrderSkillValue(
  caster: CombatUnit,
  skill: HeroSkill,
  foes: CombatUnit[],
  allUnits: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): OrderValue | null | undefined {
  switch (skill.id) {
    case 'warden_bastion': {
      if (hasBastion(caster, hazards)) return null;
      const covered = bastionCovers(caster, foes, allUnits).length;
      return covered > 0 ? { skill, targetPos: caster.position, value: ORDER_SIGNATURE_VALUE + 6 * covered } : null;
    }
    case 'abbot_vow': {
      const covered = vowCovers(caster, foes, allUnits).length;
      return covered > 0 ? { skill, targetPos: caster.position, value: ORDER_SIGNATURE_VALUE + 8 * covered } : null;
    }
    case 'toll_of_passing': {
      const target = tollTarget(caster, skill, foes);
      return target ? { skill, targetPos: target.position, value: ORDER_SIGNATURE_VALUE + 15 } : null;
    }
    case 'great_ring': {
      const caught = ringCatches(caster, foes).length;
      return caught > 0 ? { skill, targetPos: caster.position, value: ORDER_SIGNATURE_VALUE + 10 * caught } : null;
    }
    default:
      return undefined;
  }
}

/**
 * The Dooms the bell no longer holds: every Doom whose source is a Bell-Keeper that
 * has fallen. The toll is the Keeper's own, so killing it lifts every toll it rang —
 * the answer the Doom asks for besides a cleanse.
 */
export function liftedDooms(units: readonly CombatUnit[]): { unitId: string; keeperId: string }[] {
  const out: { unitId: string; keeperId: string }[] = [];
  for (const unit of units) {
    if (unit.currentHp <= 0) continue;
    for (const effect of unit.activeEffects) {
      if (effect.type !== AfflictionType.Doom || effect.sourceUnitId === undefined) continue;
      const keeper = units.find((u) => u.id === effect.sourceUnitId);
      if (keeper?.templateId === 'bell_keeper' && keeper.currentHp <= 0) {
        out.push({ unitId: unit.id, keeperId: keeper.id });
      }
    }
  }
  return out;
}
