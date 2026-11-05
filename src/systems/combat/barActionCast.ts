import type { CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import type { CombatSink } from '@/systems/combat/combatSink';
import { passHeart } from '@/systems/combat/dragonActions';

/**
 * Casting what a fight lends a hero's bar (`barActions`), the store-writing half: Pass the Heart moves the
 * Emerald Dragon's Furnace Heart to or from the hero at the aim (`dragonActions.passHeart`). The resolver asks
 * this before anything else reads the skill, so it names no boss; undefined for a skill that is not one,
 * `false` for one refused here (nobody to pass to), `true` once it is done and the action spent.
 */
export function castBarAction(
  caster: CombatUnit,
  skill: HeroSkill,
  aim: HexCoord,
  units: readonly CombatUnit[],
  sink: CombatSink,
): boolean | undefined {
  if (!skill.passesHeart) return undefined;
  const other = units.find((u) => u.currentHp > 0 && !u.objective && u.position.q === aim.q && u.position.r === aim.r);
  return !!other && passHeart(caster, other, sink).ok;
}
