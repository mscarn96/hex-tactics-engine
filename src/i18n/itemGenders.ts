import type { Gender } from './grammar';
import type { items } from './locales/en/items';

/**
 * The grammatical gender of every Polish item noun in `pl/items.ts`, which the
 * motif and affix adjectives agree with (`Hartowany miecz`, `Hartowana
 * włócznia`, `Hartowane ostrze`, `Hartowane nagolenniki`). Not a catalog
 * namespace: grammar beside the Polish words, read by `data/items/itemText.ts`.
 *
 * Both tables are keyed off the English catalog's keys, so a noun or a unique
 * added there without a gender here is a type error. See
 * the private project notes, "Generated names".
 */
type Keys = keyof typeof items;
type NounOf<K> = K extends `noun.${infer N}` ? N : never;
type UniqueOf<K> = K extends `unique.${infer U}.name` ? U : never;

/** A form or named silhouette with a noun in the catalog. */
export type NounKey = NounOf<Keys>;
/** An authored legendary with a name in the catalog. */
export type UniqueNameKey = UniqueOf<Keys>;

export const NOUN_GENDERS: Record<NounKey, Gender> = {
  // Forms
  plate_head: 'm', plate_chest: 'm', plate_legs: 'pl', plate_feet: 'pl',
  hide_head: 'm', hide_chest: 'm', hide_legs: 'pl', hide_feet: 'pl',
  robe_head: 'f', robe_chest: 'f', robe_legs: 'pl', robe_feet: 'pl',
  vestment_head: 'm', vestment_chest: 'm', vestment_legs: 'pl', vestment_feet: 'pl',
  short_sword: 'm', long_sword: 'm', greatsword: 'm', war_axe: 'm',
  dagger: 'm', spear: 'f', throwing_blade: 'n', bow: 'm', crossbow: 'f',
  staff: 'm', wand: 'f', warhammer: 'm', cudgel: 'f', branch: 'f',
  flanged_mace: 'm', sickle: 'm', sabre: 'f', throwing_axe: 'm',
  hand_wraps: 'pl', greatstaff: 'm', handblade: 'n',
  round_shield: 'f', tower_shield: 'f', quiver: 'm', orb: 'f', tome: 'f',
  fetish: 'm', lantern: 'f', pendant: 'm', band: 'm',
  // Named silhouettes
  falchion: 'm', estoc: 'm', broadsword: 'm', flamberge: 'm', claymore: 'm',
  scimitar: 'm', bearded_axe: 'm', maul: 'm', morning_star: 'm',
  knobkerrie: 'f', billhook: 'm', stiletto: 'f', partisan: 'f', kunai: 'n',
  francisca: 'f', longbow: 'm', hornbow: 'm', arbalest: 'm', repeater: 'f',
  crozier: 'm', sceptre: 'n', thornwood: 'f', heater_shield: 'f', pavise: 'f',
  war_quiver: 'm', prism: 'm', scroll: 'm', effigy: 'f', censer: 'f',
  ringed_staff: 'm', crescent_blade: 'n', cestus: 'm',
};

export const UNIQUE_GENDERS: Record<UniqueNameKey, Gender> = {
  excalibur: 'm',
  aegis: 'f',
  heartfrost_staff: 'n',
  dragon_scale_armor: 'f',
  chieftain_club: 'f',
  kairens_fang: 'm',
  monastery_bellstaff: 'm',
  oathbreaker_maul: 'm',
  stormglass_wand: 'f',
  greenheart_branch: 'f',
  windpiercer: 'm',
  long_road_vestment: 'f',
  emberheart_pendant: 'm',
  last_legion_crown: 'f',
  widows_needle: 'f',
  silent_lesson_staff: 'm',
};
