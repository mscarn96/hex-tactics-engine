import { HeroSkill } from '@/models/types';
import { isAffliction, skillEffects } from '@/systems/combat/statusEffects';

/**
 * What a skill does to the people it is aimed at, for the colour of its preview.
 *
 * The overlay used to ask one question — does the skill carry direct `healing`?
 * — so Rooted Vitality, which heals only through a Heal Over Time aura, and
 * Warding Bloom, a Barrier and a cleanse, previewed in the attack red. This reads
 * the whole skill instead:
 *
 * - **support**: it helps and harms nobody — healing, a beneficial aura, a cleanse;
 * - **attack**: it harms and helps nobody but perhaps the caster (a `selfOnly`
 *   rider on a strike is the strike's price or reward, not a heal aimed out);
 * - **mixed**: it does both to whoever it covers (Thornrow, Wild Sanctuary), so
 *   the preview has to say which hexes get which.
 *
 * A skill that does neither (a summon, a move) previews as `attack`, as it always has.
 *
 * A Reaction does nothing at its cast; what it is for lives in its response, so a
 * Reaction with no payload of its own is read by that (PT-06: Carapace Leap lit
 * the ally it watches over in attack red, because its Barriers are the response's).
 */
export type SkillTargetKind = 'support' | 'attack' | 'mixed';

export function skillTargetKind(skill: HeroSkill): SkillTargetKind {
  const response = skill.reaction?.response;
  if (response && !skill.damage && !skill.healing && !skill.cleanse && skillEffects(skill).length === 0) {
    return skillTargetKind(response);
  }
  const effects = skillEffects(skill).filter((e) => !e.selfOnly);
  const helps = !!skill.healing || !!skill.cleanse || effects.some((e) => !isAffliction(e.type));
  const harms = !!skill.damage || effects.some((e) => isAffliction(e.type));
  if (helps && harms) return 'mixed';
  return helps ? 'support' : 'attack';
}
