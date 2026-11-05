import { FormId, HeldFormId, ModelVariantId } from '@/models/types';

/**
 * Which named silhouettes each held form comes in.
 *
 * **The first entry of every list is the form itself**, drawing the form's own
 * builder in `forms.ts` — so an item with no `variant` and an item whose
 * variant is its form are the same model, and the eight authored uniques that
 * never name one keep the silhouette they were chosen for.
 *
 * Game rules are keyed by form and never by variant: a Falchion is a short
 * sword to `canEquip`, to the stat tilt and to the Basic Attack. That is the
 * whole contract, and it is why this table lives in `voxel/` — it is a fact
 * about models. The nouns live beside the forms in `data/items/itemForms.ts`.
 *
 * A `Record` over `HeldFormId`, so a held form added without saying what its
 * variants are fails to compile rather than quietly having one.
 */
export const FORM_VARIANTS: Record<HeldFormId, readonly ModelVariantId[]> = {
  short_sword: ['short_sword', 'falchion'],
  long_sword: ['long_sword', 'estoc', 'broadsword'],
  greatsword: ['greatsword', 'flamberge', 'claymore'],
  war_axe: ['war_axe', 'bearded_axe'],
  dagger: ['dagger', 'stiletto'],
  spear: ['spear', 'partisan'],
  throwing_blade: ['throwing_blade', 'kunai'],
  throwing_axe: ['throwing_axe', 'francisca'],
  sabre: ['sabre', 'scimitar'],
  bow: ['bow', 'longbow', 'hornbow'],
  crossbow: ['crossbow', 'arbalest', 'repeater'],
  staff: ['staff', 'crozier'],
  wand: ['wand', 'sceptre'],
  cudgel: ['cudgel', 'knobkerrie'],
  sickle: ['sickle', 'billhook'],
  hand_wraps: ['hand_wraps', 'cestus'],
  greatstaff: ['greatstaff', 'ringed_staff'],
  handblade: ['handblade', 'crescent_blade'],
  warhammer: ['warhammer', 'maul'],
  flanged_mace: ['flanged_mace', 'morning_star'],
  branch: ['branch', 'thornwood'],

  round_shield: ['round_shield', 'heater_shield'],
  tower_shield: ['tower_shield', 'pavise'],
  quiver: ['quiver', 'war_quiver'],
  orb: ['orb', 'prism'],
  tome: ['tome', 'scroll'],
  fetish: ['fetish', 'effigy'],
  lantern: ['lantern', 'censer'],
};

export const HELD_FORM_IDS = Object.keys(FORM_VARIANTS) as HeldFormId[];

/** Whether a form carries named variants — every held form, nothing else. */
export function hasVariants(form: FormId): form is HeldFormId {
  return (FORM_VARIANTS as Partial<Record<FormId, readonly ModelVariantId[]>>)[form] !== undefined;
}

/** The variants a form comes in, base first. Empty for armour and jewellery. */
export function variantsOf(form: FormId): readonly ModelVariantId[] {
  return hasVariants(form) ? FORM_VARIANTS[form] : [];
}

/** Whether `variant` is one of `form`'s. Absent is always legal — it is the base. */
export function isVariantOf(form: FormId, variant: ModelVariantId | undefined): boolean {
  return variant === undefined || variantsOf(form).includes(variant);
}
