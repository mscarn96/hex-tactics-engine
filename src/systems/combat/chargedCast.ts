import { BALANCE } from '@/data/balanceConstants';
import { AfflictionType, AuraType, CombatUnit, HeroSkill, StatusEffectType } from '@/models/types';
import { mantisStage } from '@/systems/combat/mantis';

/**
 * Skills used twice across two turns (`HeroSkill.charge`): Absolute Zero and
 * Aimed Shot.
 *
 * The first use is the skill as authored. Absolute Zero's targets the caster and
 * lays a `Charging` aura, paying the mana. Aimed Shot's (`charge.aimed`) is aimed
 * at an enemy, deals nothing, and lays `Aiming` naming that enemy. While the aura
 * stands, the same button is the release (`charge.release` merged over the
 * skill), which costs no mana. Read at the moment of use rather than written into
 * the unit's skill list, so nothing has to put the old skill back when the charge
 * ends, whichever way it ends.
 *
 * Absolute Zero's release is aimed when it is fired and starts the cooldown. Aimed
 * Shot's may only be fired at the unit it aimed at; its cooldown was started at
 * the aim, one turn longer, and the release ignores it (`cooldownLeft`).
 */

/** What breaks a charge when it lands on its holder. */
export const CHARGE_BREAKERS: readonly StatusEffectType[] = [
  AfflictionType.Stun, AfflictionType.Silence, AfflictionType.Taunt,
];

/** The aura a charged skill holds: `Aiming` for an aimed one, else `Charging`. */
export const chargeAura = (skill: HeroSkill): AuraType =>
  skill.charge?.aimed ? AuraType.Aiming : AuraType.Charging;

/** The charge this unit holds, if any (either kind). */
export const heldCharge = (unit: CombatUnit) =>
  unit.activeEffects.find((e) => e.type === AuraType.Charging || e.type === AuraType.Aiming);

/** The aim this unit holds, if any. */
export const heldAim = (unit: CombatUnit) =>
  unit.activeEffects.find((e) => e.type === AuraType.Aiming);

/**
 * Whether an aim this unit holds locks `skill`: every skill other than the one
 * that aimed, Basic Attack included, while the aim stands.
 */
export function aimLocks(unit: CombatUnit, skill: HeroSkill): boolean {
  if (!heldAim(unit)) return false;
  return !skill.charge?.aimed;
}

/**
 * The half of a charged skill this unit would use now: the skill itself, or its
 * release while a charge is held (and a Mantis capstone's, `mantisStage`). A charge laid this turn has not ticked yet, and
 * its release comes back marked `chargePending`, which `canUseSkill` refuses — unless a
 * bonus turn has armed it since (`ActiveEffect.armed`, an aim only).
 */
export function chargeStage(unit: CombatUnit, skill: HeroSkill): HeroSkill {
  // A Mantis capstone's later half — Marked Prey's release, a Threefold Scythe
  // stage — is read the same way, at the moment of use, by every caller of this
  if (skill.mantisCapstone) return mantisStage(unit, skill);
  if (!skill.charge) return skill;
  const aura = chargeAura(skill);
  const charge = unit.activeEffects.find((e) => e.type === aura);
  if (!charge) return skill;
  const release: HeroSkill = {
    ...skill,
    ...skill.charge.release,
    charge: skill.charge.aimed ? skill.charge : undefined,
    appliesEffect: skill.charge.release.appliesEffect,
    releasing: true,
  };
  return charge.duration >= BALANCE.CHARGE_DURATION && !charge.armed ? { ...release, chargePending: true } : release;
}
