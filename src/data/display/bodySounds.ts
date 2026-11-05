import type { BodyMaterial, FootKind, SkillGesture } from '@/models/types';

/**
 * What a body sounds like: what it is made of when it is struck and when it
 * falls, what its feet are when it walks, and what a summon sounds like arriving.
 *
 * Keyed by template id and by objective kind rather than stored on the unit, so a
 * new creature is one line here and a save never carries a sound. A template not
 * named is flesh in boots, heard as every blow and fall always was. The objective
 * kinds are the `*_KIND` constants of `systems/combat` (`bodySounds.test.ts` holds
 * every key to one that exists); they are spelled out here because data does not
 * import the rules.
 */

/** Creatures that are not flesh. */
export const MATERIAL_BY_TEMPLATE: Readonly<Record<string, BodyMaterial>> = {
  // Bone
  skeleton_archer: 'bone',
  skeleton_warrior: 'bone',
  skeleton_mage: 'bone',
  risen_skeleton: 'bone',
  // Stone
  stone_heart_rock: 'stone',
  stone_heart_stack: 'stone',
  stone_elemental: 'stone',
  // Living wood
  treant: 'wood',
  kodama: 'wood',
  // The Firefly's lantern on its pole
  lantern_beacon: 'wood',
  // Ice that walks
  frost_sentinel: 'ice',
  glacier_colossus: 'ice',
  heart_of_winter: 'ice',
  // Spirits and elementals: no body to fall, only something dispersing
  ghost: 'spirit',
  frost_mote: 'spirit',
  hoarfrost_wraith: 'spirit',
  onibi: 'spirit',
  fire_elemental: 'spirit',
  thunder_elemental: 'spirit',
};

/** Arena objectives that are not flesh, by `ObjectiveSpec.kind`. */
export const MATERIAL_BY_OBJECTIVE: Readonly<Record<string, BodyMaterial>> = {
  ice_spire: 'ice',
  glacialTomb: 'ice',
  blood_iron_anchor: 'iron',
  imperial_standard: 'wood',
  briarSeed: 'wood',
  rampart: 'stone',
  soulFragment: 'spirit',
  jade_shard: 'jade',
  // The Jorōgumo's webs and the threads she hangs from part as silk
  jorogumoWeb: 'silk',
  jorogumoThread: 'silk',
};

/** What a unit is made of, for the ear: its objective kind first, then its template. */
export function bodyMaterial(unit: { templateId?: string; objective?: { kind: string } }): BodyMaterial | undefined {
  if (unit.objective) return MATERIAL_BY_OBJECTIVE[unit.objective.kind];
  return unit.templateId ? MATERIAL_BY_TEMPLATE[unit.templateId] : undefined;
}

/** Walkers that are not in boots. */
export const FEET_BY_TEMPLATE: Readonly<Record<string, FootKind>> = {
  wolf_pup: 'paw',
  wolf: 'paw',
  dire_wolf: 'paw',
  cave_bear: 'paw',
  bonded_bear: 'paw',
  bonded_wolf: 'paw',
  kitsune: 'paw',
  tanuki: 'paw',
  nue: 'paw',
  // The Thunder Herd are centaurs
  colt_runner: 'hoof',
  herd_lancer: 'hoof',
  steppe_archer: 'hoof',
  storm_drummer: 'hoof',
  herd_khan: 'hoof',
};

/** A Druid's feet in each shape: a bear's and a wolf's paws, the antlered Apex's hooves. */
export const FEET_BY_FORM: Readonly<Record<string, FootKind>> = {
  bear: 'paw',
  wolf: 'paw',
  apex: 'hoof',
};

/** What a unit walks on: its shape's feet, then its template's; absent is boots. */
export function footKind(unit: { templateId?: string; wildForm?: string | null }): FootKind | undefined {
  if (unit.wildForm) return FEET_BY_FORM[unit.wildForm];
  return unit.templateId ? FEET_BY_TEMPLATE[unit.templateId] : undefined;
}

/**
 * What a summon sounds like arriving, by the template it calls. A summon not
 * named is heard as the plain summoning (`cast.summon`).
 */
export const SUMMON_GESTURES: Readonly<Record<string, SkillGesture>> = {
  fire_elemental: 'summonFire',
  thunder_elemental: 'summonStorm',
  // Every stage of the Stone Heart is stone being put together
  stone_heart_rock: 'summonStone',
  stone_heart_stack: 'summonStone',
  stone_elemental: 'summonStone',
  treant: 'summonTreant',
  risen_skeleton: 'summonUndead',
};
