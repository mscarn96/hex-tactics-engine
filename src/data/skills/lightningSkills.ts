import { HeroSkill, SkillTargetType } from '@/models/types';

/**
 * The Stormcaller's single-target lightning bolts: the skills that count as "the
 * next bolt" for Overload.
 *
 * A deliberate list rather than something inferred: "lightning" is an
 * element the Stormcaller's whole kit shares, and "single-target" is a shape that
 * other skills have too. Arc is the signature bolt and Thunderbolt the long-range
 * one. Chain Lightning, Tempest, Static Burst, Thunderstep and Skyfall are
 * lightning too but they are not bolts: they are what *charges* Overload by
 * striking several Shocked enemies at once, so counting them as the payoff would
 * let one cast both fill and spend it.
 */
export const LIGHTNING_BOLT_IDS: ReadonlySet<string> = new Set(['arc', 'thunderbolt']);

export const isLightningBolt = (skill: Pick<HeroSkill, 'id' | 'targetType'>): boolean =>
  LIGHTNING_BOLT_IDS.has(skill.id) && skill.targetType === SkillTargetType.Single;

/**
 * The Stormcaller's spells: what the Thunder Elemental echoes.
 *
 * A list rather than "every lightning skill" for the reason the bolt list is one:
 * an enemy Drummer's Thunderbeat is lightning too and is nobody's to copy. The
 * Signature, every tree spell — and nothing else: not a Basic Attack, and not the
 * summon itself, so an elemental never calls up another.
 */
export const STORMCALLER_SPELL_IDS: ReadonlySet<string> = new Set([
  'arc', 'static_burst', 'thunderbolt', 'thunderstep', 'skyfall', 'tempest', 'chain_lightning',
]);

export const isStormcallerSpell = (skill: Pick<HeroSkill, 'id'>): boolean => STORMCALLER_SPELL_IDS.has(skill.id);
