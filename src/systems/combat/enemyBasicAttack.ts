import { CombatUnit, HeroSkill, SkillTargetType } from '@/models/types';
import { WEAPON_ATTACKS, WeaponAttack } from '@/data/items/weaponAttacks';
import { BALANCE } from '@/data/balanceConstants';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { isAoESkill } from '@/systems/combat/targeting';

/**
 * The Basic Attack a unit falls back on when nothing else in its kit will do.
 *
 * Playtest 2026-10-23: a taunted elite whose kit is all area skills — or all on
 * cooldown — found nothing it was allowed to aim at the taunter and passed the
 * turn. Heroes carry a Basic Attack read off their weapon; an enemy wears none, so
 * its fallback is read off its kit instead: a bolt if most of its blows scale on
 * Magic, a reach of `ENEMY_BASIC_ATTACK_RANGED_REACH` if its single-target blows
 * all reach that far, one hex otherwise. It deals
 * `ENEMY_BASIC_ATTACK_DAMAGE`, under any authored skill, so the AI only presses it
 * when it would otherwise do nothing (`enemyAI.decideEnemyAction`). A unit that
 * already carries one (a hero the AI drives) keeps its own.
 *
 * Pure: built at the decision, never stored on the unit.
 */
export function fallbackBasicAttack(unit: Pick<CombatUnit, 'skills'>): HeroSkill {
  const own = unit.skills.find((s) => s.id === BASIC_ATTACK_ID);
  if (own) return own;

  const blows = unit.skills.filter((s) => (s.damage ?? 0) > 0);
  const magic = blows.filter((s) => s.scaling === 'magic').length * 2 > blows.length;
  // A charge's or a dash's range is how far it moves, not how far it shoots
  const single = blows.filter((s) => !isAoESkill(s) && s.range > 0 && !s.selfMove);
  const reach = BALANCE.ENEMY_BASIC_ATTACK_RANGED_REACH;
  const ranged = single.length > 0 && single.every((s) => s.range >= reach);

  const profile: WeaponAttack = magic ? WEAPON_ATTACKS.arcane : ranged ? WEAPON_ATTACKS.crossbow : WEAPON_ATTACKS.blunt;
  return {
    id: BASIC_ATTACK_ID,
    targetType: SkillTargetType.Single,
    range: ranged ? reach : 1,
    damage: BALANCE.ENEMY_BASIC_ATTACK_DAMAGE,
    scaling: profile.scaling,
    damageType: profile.damageType,
    unlockLevel: 1,
    manaCost: 0,
    vfxKind: profile.vfxKind,
    vfxColor: profile.vfxColor,
    icon: profile.icon,
    delivery: profile.delivery,
    ...(profile.spell ? { spell: profile.spell } : {}),
  };
}
