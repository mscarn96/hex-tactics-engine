import type { BossSignature } from '@/models/types';

/**
 * The attacks a named boss is heard by, as `[template id][skill id]`.
 *
 * Keyed by **who casts it as well as what it is**: a skill a boss shares with
 * its own roster must not make every caster of it sound like the boss. A
 * boss's other skills are heard as any other skill is, so a signature stays the
 * thing that marks the fight's one big moment. The Heart of Winter's is the
 * Whiteout Convergence warning; its crystal pulse is a named move of the skill's
 * own (`HeroSkill.gesture`), not a signature, because it is its repeatable attack.
 *
 * Phase changes (the Emperor's, the Warlord's Fury, Winter Unbound) are not skills
 * and are not here; the cues that answer them are `BOSS_PHASE_CUES` in
 * `audio/combatCues.ts`.
 */
export const BOSS_SIGNATURES: Readonly<Record<string, Readonly<Record<string, BossSignature>>>> = {
  // The roof coming down is the Warlord's one big moment; the leap, the sweep
  // and the smash are heard as any other blow is
  troll_chieftain: { warren_collapse: 'warlord' },
  // Skyfire is the Dragon's one big moment; the claw, wing and the rest are heard as any blow is
  dragon: { skyfire: 'dragon' },
  // Foreclosure is the orb's sentence, and Crownfall the final reckoning: the two
  // moves each later phase is known by. The sword and the writ are heard as any
  // blow and any curse are.
  aethelred: { foreclosure: 'verdict', crownfall: 'assessment' },
  // The warning as the Heart draws the cold in; the spires' blasts later land as frost
  heart_of_winter: { whiteout_convergence: 'whiteout' },
};

/** The signature `skillId` is for this caster, if it has one. */
export const bossSignature = (templateId: string | undefined, skillId: string): BossSignature | undefined =>
  templateId ? BOSS_SIGNATURES[templateId]?.[skillId] : undefined;
