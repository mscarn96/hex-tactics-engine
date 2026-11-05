import type { SkillVoice } from '@/models/types';

/**
 * The skills heard by a sound of their own: every mastery path's signature and
 * capstone skill (the private project notes, U1–U53), Hemlock
 * and the Bell-Keeper's kit (the private project notes). Which
 * sound answers each moment of them is `SKILL_CUES` in `audio/skillCues.ts`;
 * this is only the list, so the rules know which casts carry a voice and the
 * rest of the game's intents stay as they were.
 *
 * Keyed by skill id alone: a shared skill sounds the same for whoever uses it.
 */
export const VOICED_SKILLS: ReadonlySet<string> = new Set([
  // Champion
  'provoking_strike', 'unbreakable_vow', 'shield_avalanche', 'reckoning',
  'smite', 'righteous_fury', 'martyr', 'consecrate',
  'bloodthirst', 'whirlwind', 'carnage',
  // Arcanist
  'ignite', 'immolation', 'burning_out',
  'frostbite', 'blizzard', 'glacial_barrage', 'absolute_zero',
  'arc', 'tempest', 'chain_lightning',
  // Druid
  'lifebloom_skill', 'wellspring', 'wild_sanctuary',
  'tremor', 'living_stone', 'bedrock_stand',
  'primal_surge', 'ancestral_hunt',
  // Hunter
  'mark_target', 'aimed_shot', 'rapid_fire', 'covering_fire',
  'blade_recall', 'knife_dance', 'bladestorm', 'flurry',
  'shadowstep', 'assassinate', 'creeping_death', 'vanish', 'hemlock',
  // Monk
  'twin_reap', 'marked_prey', 'threefold_scythe', 'mantis_execution',
  'glowmote', 'firefly_motes', 'firefly_swarm', 'lantern_beacon',
  'iron_carapace', 'vengeful_shell', 'carapace_bastion', 'shell_swap',
  // The Bell-Keeper
  'bell_strike', 'toll_of_passing', 'great_ring',
]);

/** The voice a moment of this skill carries, or `undefined` for a skill heard as its school or its blow. */
export function skillVoice(skillId: string | undefined, at: Omit<SkillVoice, 'skillId'> = {}): SkillVoice | undefined {
  return skillId && VOICED_SKILLS.has(skillId) ? { skillId, ...at } : undefined;
}
