import { AfflictionType, CombatUnit, HeroSkill } from '@/models/types';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { hasPassive, passiveName, passiveRank } from '@/systems/combat/passives';
import { firemindDiscount, firemindPerStack } from '@/systems/combat/passiveFormulas';
import { burnStacks } from '@/systems/combat/statusEffects';

/**
 * What a cast actually costs against a particular target.
 *
 * One function for the preview and for the payment: the skill inspector prints
 * what this returns and `resolveSkillUse` spends what this returns, so the number
 * a player is shown is the number they pay. Everything but Firemind pays the
 * authored `manaCost`.
 *
 * **Firemind** discounts Cinder Burst when it spends more than one Burn stack on
 * its target. It reads the target as it stands *before* the strike (the Burn is
 * spent by the strike), and it is cost efficiency only: the price falls, nothing
 * is ever returned, and it can never reach free.
 */
export function manaCostFor(caster: CombatUnit, skill: HeroSkill, target?: CombatUnit): number {
  const base = skill.manaCost;
  if (base <= 0 || !target || !hasPassive(caster, 'firemind')) return base;
  if (skill.id !== 'cinder_burst' || !skill.detonates?.consume) return base;
  const burn = target.activeEffects.find((e) => e.type === AfflictionType.Burn);
  if (!burn) return base;
  const discount = firemindDiscount(passiveRank(caster, 'firemind'), burnStacks(burn), base);
  return Math.max(0, base - discount);
}

/**
 * The lines the skill inspector adds for a skill whose price depends on its target.
 * Empty for every other skill. Per enemy rather than a rule alone, so what the
 * player reads is each target's real price, from `manaCostFor`.
 */
export function manaCostNotes(caster: CombatUnit, skill: HeroSkill, units: CombatUnit[]): string[] {
  if (skill.id !== 'cinder_burst' || !hasPassive(caster, 'firemind')) return [];
  const rank = passiveRank(caster, 'firemind');
  const lines = [t('combatLog.mana.firemind', { source: passiveName('firemind'), amount: firemindPerStack(rank) })];
  for (const foe of units) {
    if (foe.currentHp <= 0 || foe.isPlayer === caster.isPlayer || foe.objective) continue;
    const burn = foe.activeEffects.find((e) => e.type === AfflictionType.Burn);
    if (!burn || burnStacks(burn) < 2) continue;
    const cost = manaCostFor(caster, skill, foe);
    if (cost < skill.manaCost) {
      lines.push(t('combatLog.mana.foe', { name: unitName(foe), count: burnStacks(burn), cost }));
    }
  }
  return lines;
}
