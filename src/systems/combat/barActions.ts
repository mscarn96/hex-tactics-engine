import type { CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import { passHeart } from '@/data/templates/emeraldDragon';
import { passTargets } from '@/systems/combat/dragonScript';

/**
 * What a fight puts on a hero's skill bar besides their own kit, while it is legal: the Emerald Dragon's
 * Pass the Heart (`dragonScript.passTargets`). The scene draws these after the kit and the tactical AI
 * weighs them with it, so neither has to name the boss whose fight lends them.
 */
export function barActions(unit: CombatUnit, units: readonly CombatUnit[]): HeroSkill[] {
  return passTargets(unit, units).length > 0 ? [passHeart] : [];
}

/**
 * Where a bar action may be aimed, or undefined for a skill that is not one: Pass the Heart goes to the allies
 * the carrier can hand it to, or to the carrier an ally can take it from. Read by the highlights
 * (`targeting.getValidSkillTargetHexes`), so the board lights only what the cast accepts.
 */
export function barActionTargets(caster: CombatUnit, skill: HeroSkill, units: readonly CombatUnit[]): HexCoord[] | undefined {
  if (skill.passesHeart) return passTargets(caster, units).map((u) => ({ ...u.position }));
  return undefined;
}
