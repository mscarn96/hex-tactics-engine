import type { DamageType } from '@/models/skills';

/**
 * The deliberate type of every damaging skill the game fields.
 *
 * Physical and magic are *hit* types, each answered by its own defence. They
 * are decided here, per skill, and never inferred from `HeroSkill.scaling`: the
 * stat a hit is built from and the armour that answers it are separate
 * questions. A Templar's `smite` scales off both stats and is a physical blow;
 * the Stoneshaper's earth is built from magic and is physical stone; a
 * Basic Attack takes its type from the weapon profile instead.
 *
 * Every skill with a `damage` must have an entry — `damageTypes.test.ts` fails
 * a new one that is missing, so a type is always a choice somebody made.
 * Anything with no entry (a heal, a status) deals no hit to type.
 */
export const SKILL_DAMAGE_TYPES: Readonly<Record<string, DamageType>> = {
  // ── Physical: weapons, claws, teeth, earth and thorn ──
  acid_spit: 'physical', aimed_shot: 'physical', antler_charge: 'physical',
  armor_breaker: 'physical', arrow_shot: 'physical',
  assassinate: 'physical', axe_hew: 'physical', barbed_blades: 'physical',
  crushing_leap: 'physical', crowned_prey: 'physical', bear_slam: 'physical', beast_maul: 'physical',
  bedrock_stand: 'physical', bite: 'physical', bloodthirst: 'physical', bolas: 'physical',
  boulder_leap: 'physical', cave_in: 'physical', charge: 'physical', cheap_shot: 'physical',
  cleave: 'physical', cleaving_throw: 'physical', club_strike: 'physical', club_sweep: 'physical',
  creeping_death: 'physical', cutpurse: 'physical', cyclone: 'physical', dive: 'physical',
  double_sting: 'physical', dragon_claw: 'physical', dread_charge: 'physical', concussive_shot: 'physical',
  executioner: 'physical', flare_dash: 'physical', garrote: 'physical', glacier_hammer: 'physical',
  glaive_sweep: 'physical', glass_shot: 'physical', grasping_earth: 'physical',
  ground_slam: 'physical', hamstring_shot: 'physical', hawk_shear: 'physical',
  hit_and_run: 'physical', hoof_kick: 'physical', hurl_ice_block: 'physical', ice_fist: 'physical',
  icicle_lance: 'physical', lance_thrust: 'physical',
  wing_thrust: 'physical', skyfire_landing: 'physical',
  bonebreaker_sweep: 'physical', farthest_prey: 'physical', boundary_smash: 'physical', warren_collapse: 'physical',
  emperors_blade: 'physical', imperial_cleave: 'physical', legion_advance: 'physical', living_stone: 'physical',
  mace_strike: 'physical', mark_target: 'physical', maul: 'physical', mire_grasp: 'physical',
  parting_shot: 'physical', ricochet_shot: 'physical',
  poison_arrow: 'physical', poisoned_shot: 'physical', pounce: 'physical',
  primal_wrath: 'physical', provoking_strike: 'physical', rain_of_arrows: 'physical',
  ranged_shot: 'physical', recurve_shot: 'physical', rend: 'physical', rip: 'physical',
  rootlash_sweep: 'physical', running_lance: 'physical', scorpid_sting: 'physical',
  serrated_daggers: 'physical', shard_shot: 'physical', shield_avalanche: 'physical', slash: 'physical', smite: 'physical',
  spear_jab: 'physical', stone_fist: 'physical', talons: 'physical', thorn_lash: 'physical',
  thornrow: 'physical', throat_tear: 'physical', throw_knife: 'physical',
  blade_recall: 'physical', knife_dance: 'physical', timber_crush: 'physical', tremor: 'physical',
  troll_smash: 'physical', upheaval: 'physical', venom_bite: 'physical',
  venomed_blades: 'physical', web: 'physical', whirlwind: 'physical',
  rending_circle: 'physical', hunters_mark: 'physical', ancestral_hunt: 'physical',
  twin_reap: 'physical', scything_step: 'physical', flicker_cut: 'physical', pinning_cut: 'physical',
  mantis_pounce: 'physical', marked_prey: 'physical', threefold_scythe: 'physical', mantis_execution: 'physical',
  iron_carapace: 'physical', horn_sweep: 'physical', grip_and_throw: 'physical',
  // ── Magic: spells, breath, holy and cold ──
  glowmote: 'magic', lantern_sweep: 'magic', firefly_swarm: 'magic',
  arc: 'magic', arcane_bolt: 'magic', arcane_burst: 'magic', blasting_charge: 'magic',
  blight: 'magic', blizzard: 'magic', bone_shards: 'magic', chain_lightning: 'magic',
  cinder_burst: 'magic', cold_grasp: 'magic', cold_snap: 'magic', cold_spark: 'magic',
  consecrate: 'magic', dark_bolt: 'magic', flame_wave: 'magic',
  splintering_pulse: 'magic', splintering_fracture: 'magic', creeping_winter: 'magic',
  icebound_reprisal: 'magic', whiteout_convergence: 'magic', whiteout_blast: 'magic', cinder_rift: 'magic', furnace_heart: 'magic', skyfire: 'magic', wild_sanctuary: 'magic',
  frost_bolt: 'magic', frost_lance: 'magic', frostbite: 'magic', ghost_touch: 'magic',
  hex: 'magic', holy_bolt: 'magic', ignite: 'magic', immolation: 'magic', judgement: 'magic',
  meteor: 'magic', obsidian_spikes: 'magic', plasma_orb: 'magic', rime_note: 'magic',
  rolling_thunder: 'magic', sanction: 'magic', sand_squall: 'magic', silencing_depths: 'magic',
  skyfall: 'magic', snowblind: 'magic', static_burst: 'magic', glacial_barrage: 'magic', absolute_zero: 'magic',
  tempest: 'magic', thunderbeat: 'magic', thunderbolt: 'magic',
  thunderstep: 'magic', wildfire: 'magic', winter_horn: 'magic',
};
