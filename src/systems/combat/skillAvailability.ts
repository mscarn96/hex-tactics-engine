import { AfflictionType, CombatUnit, HeroSkill } from '@/models/types';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { isRooted } from '@/systems/combat/statusEffects';
import { rootedRefusal, skillBlockedReason } from '@/systems/combat/cooldowns';
import { t } from '@/i18n';

export { aimLocked, apexSpent, chargePending, rootedRefusal, skillBlockedReason } from '@/systems/combat/cooldowns';

/** The fallback when a skill has aim-able targets in principle but none in reach. */
export const nothingInRange = (): string => t('combatLog.refuse.nothingInRange');

/** What to tell a player whose skill found nothing to aim at. */
export function noTargetsMessage(skill: HeroSkill, caster: CombatUnit, units: CombatUnit[] = []): string {
  if (skill.selfMove?.kind === 'dash' && isRooted(caster)) {
    const unrooted = { ...caster, activeEffects: caster.activeEffects.filter(e => e.type !== AfflictionType.Root) };
    if (getValidSkillTargetHexes(skill, unrooted, units.map(u => u.id === caster.id ? unrooted : u)).length > 0) return rootedRefusal();
  }
  return skillBlockedReason(skill, caster, units) ?? nothingInRange();
}
