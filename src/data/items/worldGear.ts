import { FormId, ItemTemplate, MotifId } from '@/models/types';
import { COLLECTION_IDS, COLLECTION_WORLD, collectionForms, isCollectionMotif } from '@/data/items/collections';

/**
 * Which gear belongs to which world.
 *
 * **Each expansion's motifs drop and forge only in their world**
 * (the private project notes, "Equipment across worlds"), so a later
 * world's loot never dilutes an earlier one's: the Empire's drop tables, chests,
 * shop and recipes are exactly the catalogue they were, and Jadeveil adds its own
 * on top of them. A template says so in `ItemTemplate.world`, which the
 * generator writes from the motif (`motifWorld`) and an authored unique states;
 * every pool that rolls or stocks gear asks `inWorld`.
 */
export type GearWorld = NonNullable<ItemTemplate['world']>;

/** Jadeveil's ordinary motifs: Votive is its Rare, Spiritsealed its Epic. */
export const JADEVEIL_MOTIFS: MotifId[] = ['votive', 'spiritsealed'];

/**
 * The held forms Jadeveil's two motifs are minted on — **selected**, not every
 * weapon: one a path reaches for at least, so every path can find a Votive and a
 * Spiritsealed weapon it may hold (`MASTERY_WEAPON_FORMS`), and nothing more.
 * Off-hands and jewellery keep the Empire's motifs; jewellery's class comes
 * from its motif (`MOTIF_CLASS`), and these two would name everybody.
 */
export const JADEVEIL_MOTIF_WEAPONS: FormId[] = [
  'long_sword', 'warhammer', 'war_axe',
  'staff', 'wand',
  'branch',
  'bow', 'spear', 'dagger',
  'greatstaff', 'handblade',
];

/** Every armour form, which both motifs cover in all four weights. */
const ARMOUR_FORMS: FormId[] = [...new Set(COLLECTION_IDS.flatMap(collectionForms))];

const MOTIF_FORMS: FormId[] = [...ARMOUR_FORMS, ...JADEVEIL_MOTIF_WEAPONS];

/**
 * The archipelago's ordinary motifs: Redflag is its Rare, Compassbound its
 * Epic. Built ahead of its world, so they carry `'archipelago'` and nothing
 * rolls them yet.
 */
export const ARCHIPELAGO_MOTIFS: MotifId[] = ['redflag', 'compassbound'];

/**
 * The forms the archipelago's two are minted on: every armour form, all four
 * weights, as a world's motifs cover them. No weapon is minted in them yet.
 */
export const ARCHIPELAGO_MOTIF_FORMS: FormId[] = ARMOUR_FORMS;

/** The world a motif belongs to, or undefined for the Empire's, which every world shares. */
export function motifWorld(motif: MotifId): GearWorld | undefined {
  if (isCollectionMotif(motif)) return COLLECTION_WORLD[motif];
  if (ARCHIPELAGO_MOTIFS.includes(motif)) return 'archipelago';
  return JADEVEIL_MOTIFS.includes(motif) ? 'jadeveil' : undefined;
}

/**
 * The world motifs a form is generated in, besides its own `FormSpec.motifs` —
 * Jadeveil's two on every armour piece and the selected weapons, the
 * archipelago's two on every armour piece, and the collection of the piece's
 * weight on its four. Listed here rather than in `FORMS`, so a weight's own
 * motif list — the Empire's drop pool and its 2 / 2 / 3 rule — is untouched.
 */
export function worldMotifsFor(form: FormId): MotifId[] {
  const out: MotifId[] = MOTIF_FORMS.includes(form) ? [...JADEVEIL_MOTIFS] : [];
  if (ARCHIPELAGO_MOTIF_FORMS.includes(form)) out.push(...ARCHIPELAGO_MOTIFS);
  for (const collection of COLLECTION_IDS) {
    if (collectionForms(collection).includes(form)) out.push(collection);
  }
  return out;
}

/**
 * Whether a template may be rolled, stocked or crafted in `world`. The Empire's
 * catalogue is everywhere; a world's own gear only in that world.
 */
export function inWorld(template: Pick<ItemTemplate, 'world'>, world: GearWorld | 'empire' | undefined): boolean {
  return !template.world || template.world === world;
}
