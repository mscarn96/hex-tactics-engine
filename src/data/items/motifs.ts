import { MotifId, MasteryId, Rarity } from '@/models/types';

/** What an item is made of, as far as the rules care. */
export interface MotifSpec {
  /** Whether the motif counts as an elemental one when items are weighted and priced. */
  elemental: boolean;
}

export const MOTIFS: Record<MotifId, MotifSpec> = {
  plain: { elemental: false },
  iron: { elemental: false },
  steel: { elemental: false },
  silver: { elemental: false },
  bronze: { elemental: false },
  gold: { elemental: false },
  runed: { elemental: false },
  fire: { elemental: true },
  ice: { elemental: true },
  storm: { elemental: true },
  nature: { elemental: true },
  shadow: { elemental: true },
  holy: { elemental: true },
  votive: { elemental: false },
  spiritsealed: { elemental: true },
  redflag: { elemental: false },
  compassbound: { elemental: true },
  jade_bastion: { elemental: true },
  canopy_strider: { elemental: true },
  cloud_script: { elemental: true },
  monastery_oath: { elemental: true },
  ironclad_admiral: { elemental: true },
  saltrunner: { elemental: true },
  stormglass: { elemental: true },
  shellwoven: { elemental: true },
  bulwark: { elemental: true },
  templar: { elemental: true },
  berserker: { elemental: true },
  pyromancer: { elemental: true },
  hydromancer: { elemental: true },
  stormcaller: { elemental: true },
  lifewarden: { elemental: true },
  stoneshaper: { elemental: true },
  wildshape: { elemental: true },
  marksman: { elemental: true },
  skirmisher: { elemental: true },
  shadowblade: { elemental: true },
  beetle: { elemental: true },
  firefly: { elemental: true },
  mantis: { elemental: true },
};

/**
 * Rarity is a property of the motif, not an independent axis.
 *
 * Rolling them separately would generate a Legendary Plain Dagger, which looks
 * identical to the common one — the whole point of the system is that a better
 * item looks better.
 */
export const MOTIF_RARITY: Record<MotifId, Rarity> = {
  plain: Rarity.Common,
  iron: Rarity.Common,
  steel: Rarity.Rare,
  silver: Rarity.Rare,
  nature: Rarity.Rare,
  // Rarity rides on the motif, so the *count* per rarity is the size of the drop
  // pool at that rarity. Three rare motifs against six epic left every armour
  // weight with exactly one rare treatment — a Champion's entire rare armour
  // library was one Steel Helm, Cuirass, Greaves and Sabatons — and left the
  // Arcanist with no rare jewellery at all, since `classLockFor` reads a
  // pendant's class off `MOTIF_CLASS` and steel, silver and nature are Warrior,
  // Hunter and Druid.
  bronze: Rarity.Rare,
  runed: Rarity.Rare,
  gold: Rarity.Epic,
  fire: Rarity.Epic,
  ice: Rarity.Epic,
  storm: Rarity.Epic,
  shadow: Rarity.Epic,
  holy: Rarity.Epic,
  // Jadeveil's two, which drop and forge only there
  votive: Rarity.Rare,
  spiritsealed: Rarity.Epic,
  // The archipelago's two, built ahead of its world
  redflag: Rarity.Rare,
  compassbound: Rarity.Epic,
  // Jadeveil's four collections are legendary, and are not mastery sets
  jade_bastion: Rarity.Legendary,
  canopy_strider: Rarity.Legendary,
  cloud_script: Rarity.Legendary,
  monastery_oath: Rarity.Legendary,
  ironclad_admiral: Rarity.Legendary,
  saltrunner: Rarity.Legendary,
  stormglass: Rarity.Legendary,
  shellwoven: Rarity.Legendary,

  // Every mastery set is legendary, and legendary exists nowhere else
  bulwark: Rarity.Legendary,
  templar: Rarity.Legendary,
  berserker: Rarity.Legendary,
  pyromancer: Rarity.Legendary,
  hydromancer: Rarity.Legendary,
  stormcaller: Rarity.Legendary,
  lifewarden: Rarity.Legendary,
  stoneshaper: Rarity.Legendary,
  wildshape: Rarity.Legendary,
  marksman: Rarity.Legendary,
  skirmisher: Rarity.Legendary,
  shadowblade: Rarity.Legendary,
  beetle: Rarity.Legendary,
  firefly: Rarity.Legendary,
  mantis: Rarity.Legendary,
};

/**
 * The set motifs, in `MASTERY_PATHS` order: the twelve, and the Monk's three.
 */
export const MASTERY_MOTIFS: MasteryId[] = [
  'bulwark', 'templar', 'berserker',
  'pyromancer', 'hydromancer', 'stormcaller',
  'lifewarden', 'stoneshaper', 'wildshape',
  'marksman', 'skirmisher', 'shadowblade',
  'beetle', 'firefly', 'mantis',
];

const MASTERY_MOTIF_SET = new Set<string>(MASTERY_MOTIFS);

/** Whether a motif is one of the legendary mastery sets. */
export function isMasteryMotif(motif: string): motif is MasteryId {
  return MASTERY_MOTIF_SET.has(motif);
}

/** Motifs available at each rarity. Legendary is uniques only, so it is empty. */
/**
 * Motifs grouped by rarity.
 *
 * Derived from `MOTIF_RARITY` rather than written out again — it was a
 * hand-maintained duplicate, and adding the twelve set motifs silently left it
 * claiming no legendaries existed while twelve sets were generating.
 */
export const RARITY_MOTIFS: Record<Rarity, MotifId[]> = (() => {
  const out = {
    [Rarity.Common]: [], [Rarity.Rare]: [], [Rarity.Epic]: [], [Rarity.Legendary]: [], [Rarity.Mythic]: [],
  } as Record<Rarity, MotifId[]>;
  for (const [motif, rarity] of Object.entries(MOTIF_RARITY) as [MotifId, Rarity][]) {
    out[rarity].push(motif);
  }
  return out;
})();
