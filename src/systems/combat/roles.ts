import { AfflictionType, AuraType, CombatUnit, HeroSkill } from '@/models/types';
import { skillTargetKind } from '@/systems/combat/targetKind';
import { skillEffects } from '@/systems/combat/statusEffects';

/**
 * What a hero is for in a fight, read from its kit. Shared by the balance lab's party
 * (`partyPolicy`) and the tactical AI (`tacticalAI`), which both play heroes the way a player would.
 */

export type PartyRole = 'tank' | 'healer' | 'ranged' | 'melee';

export const tauntsOthers = (skill: HeroSkill) =>
  skillEffects(skill).some((e) => e.type === AfflictionType.Taunt && !e.selfOnly);

/** A skill that helps and harms nobody. */
export const helps = (s: HeroSkill) => skillTargetKind(s) === 'support';
export const healsOthers = (s: HeroSkill) => helps(s) && !!(s.healing || s.cleanse);
/** A shield granted to others, with or without a blow riding on it: Shell Wall, Shell Swap, Carapace Leap. */
export const shields = (s: HeroSkill) =>
  !s.healing && !s.cleanse && skillEffects(s).some((e) => !e.selfOnly && e.type === AuraType.Barrier);

/**
 * What a hero is for, from its kit: a heal and a second support skill make a healer; a Taunt, or two
 * shields for others, a tank (a bear's Maul and a Beetle's Shell Wall are both that); a best strike of
 * range 3 or more a ranged hero; anything else melee.
 */
export function roleOf(unit: CombatUnit): PartyRole {
  const heals = unit.skills.filter(healsOthers).length;
  const guards = unit.skills.filter(shields).length;
  if (heals >= 1 && heals + guards >= 2) return 'healer';
  if (unit.skills.some(tauntsOthers) || guards >= 2) return 'tank';
  // A gap-closer (a Charge, a leap) is a brawler's reach, not an archer's
  const real = unit.skills.filter((s) => s.damage && !s.selfMove);
  const top = Math.max(0, ...real.map((s) => s.damage ?? 0));
  const best = real.filter((s) => (s.damage ?? 0) >= 0.6 * top);
  return best.length > 0 && best.every((s) => s.range >= 3) ? 'ranged' : 'melee';
}
