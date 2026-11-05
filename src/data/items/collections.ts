import { CollectionId, FormId, ItemTemplate, MasteryId, MotifId } from '@/models/types';
import { ArmourWeight, MASTERY_ARMOUR_WEIGHT, PATH_CLASS, armourWeightOf } from '@/data/items/itemForms';

/**
 * A world's legendary armour collections — one per armour weight, worn across
 * classes (the private project notes, "Equipment across worlds").
 *
 * **A collection is identified by its weight, and by nothing about a path.** A
 * mastery set is one path's look and is `masteryLock`ed to it; a collection is a
 * weight's look and is worn by every path of that weight — Jade Bastion by the
 * three Champion paths and the Beetle, Canopy Strider by the Hunters and the
 * Mantis, Cloud Script by the Arcanists, Monastery Oath by the Druids and the
 * Firefly. So a collection carries no `masteryLock`, and its class lock is the
 * weight's (`itemGen.classLockFor`), which `canEquip` already enforces through
 * `wearableWeights`. The two kinds of legendary armour never share a motif, so
 * the twelve mastery sets and the Monk's three behave exactly as they did.
 *
 * Each piece still rolls a skill bonus (`setBonus.ts`), from **one path of its
 * weight** rather than its own: a roll that can land on a path the wearer did
 * not choose is a mismatch the piece states and the forge can re-aim.
 */

/** The four pieces every collection has. Weapons, off-hands and jewellery are separate rewards. */
export const COLLECTION_SLOTS = ['head', 'chest', 'legs', 'feet'] as const;

/** Every world's collections, by the weight each is cut in: Jadeveil's four, then the archipelago's. */
export const COLLECTION_WEIGHT: Record<CollectionId, ArmourWeight> = {
  jade_bastion: 'plate',
  canopy_strider: 'hide',
  cloud_script: 'robe',
  monastery_oath: 'vestment',
  ironclad_admiral: 'plate',
  saltrunner: 'hide',
  stormglass: 'robe',
  shellwoven: 'vestment',
};

export const COLLECTION_IDS = Object.keys(COLLECTION_WEIGHT) as CollectionId[];

/**
 * The world each collection drops and forges in (`worldGear.ts`). The
 * archipelago's are built ahead of the world itself — the campaign has no
 * `'archipelago'` world yet, so no loot, chest or forge rolls them — and their
 * pieces dress the bodies and draw their icons meanwhile.
 */
export const COLLECTION_WORLD: Record<CollectionId, NonNullable<ItemTemplate['world']>> = {
  jade_bastion: 'jadeveil',
  canopy_strider: 'jadeveil',
  cloud_script: 'jadeveil',
  monastery_oath: 'jadeveil',
  ironclad_admiral: 'archipelago',
  saltrunner: 'archipelago',
  stormglass: 'archipelago',
  shellwoven: 'archipelago',
};

const COLLECTION_SET = new Set<string>(COLLECTION_IDS);

/** Whether a motif is one of the world collections. */
export function isCollectionMotif(motif: MotifId | string): motif is CollectionId {
  return COLLECTION_SET.has(motif);
}

/** A collection's four armour forms, head to feet. */
export function collectionForms(collection: CollectionId): FormId[] {
  const weight = COLLECTION_WEIGHT[collection];
  return COLLECTION_SLOTS.map((slot) => `${weight}_${slot}` as FormId);
}

/** Whether a form is one of a collection's pieces — its weight's head, chest, legs or feet. */
export function collectionHasForm(collection: CollectionId, form: FormId): boolean {
  return armourWeightOf(form) === COLLECTION_WEIGHT[collection];
}

/**
 * Every path that wears a collection's weight, in `PATH_CLASS` order — the
 * paths a piece's skill roll may target, and the forge's re-aim may choose.
 * Derived from `MASTERY_ARMOUR_WEIGHT`, so a path that later wears plate is
 * eligible for Jade Bastion's rolls without this module learning its name.
 */
export function collectionPaths(collection: CollectionId): MasteryId[] {
  const weight = COLLECTION_WEIGHT[collection];
  return (Object.keys(PATH_CLASS) as MasteryId[]).filter((p) => MASTERY_ARMOUR_WEIGHT[p] === weight);
}
