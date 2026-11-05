import {
  FormId, HandRule, HeroClass, ItemModifiers, ItemSlot,
  MotifId, OffHandKind, MasteryId,
} from '@/models/types';
import type { WeaponAttackId } from '@/data/items/weaponAttacks';

/**
 * Game metadata for each item form.
 *
 * The counterpart to `voxel/items/forms.ts`, which holds the geometry for the
 * same `FormId` keys. Splitting them keeps `voxel/` free of game rules so the
 * preview harness and node-environment tests can import it directly.
 *
 * `data/itemGen.ts` crosses this table with the motif table to produce the item
 * library; nothing here is a finished item.
 */

/** Stat weights, normalised at generation time. Not final numbers. */
export type StatTilt = Partial<Record<keyof ItemModifiers, number>>;

export interface FormSpec {
  slot: ItemSlot;
  /**
   * Which classes may use it above common. Weapons apply it at every rarity.
   * A list: gear is shared between classes, so a form names every class with a
   * path that carries it.
   */
  classLock?: HeroClass[];
  handRule?: HandRule;
  offHandKind?: OffHandKind;
  /** How this form splits its stat budget. */
  tilt: StatTilt;
  /** Motifs this form is generated in. Armour weights carry a themed subset. */
  motifs: MotifId[];
  /**
   * The Basic Attack this weapon makes — see `data/items/weaponAttacks.ts`.
   *
   * Every weapon names exactly one and nothing else names any, which
   * `basicAttack.test.ts` pins: a weapon with no profile would fall through to
   * the unarmed blow while the hero is visibly holding a sword.
   */
  attack?: WeaponAttackId;
}

/**
 * Which forms each legendary mastery set covers.
 *
 * Seven pieces: four armour, a pendant, and the path's weapons. Rings are
 * deliberately absent — a band has no silhouette to make legendary, and adding
 * two per set would double the forge list for nothing to look at.
 *
 * Shadowblade lists one dagger and no off-hand: it dual-wields, so the second
 * blade is the same recipe crafted twice.
 */
export const MASTERY_SET_FORMS: Record<MasteryId, FormId[]> = {
  bulwark:     ['plate_head', 'plate_chest', 'plate_legs', 'plate_feet', 'pendant', 'warhammer', 'tower_shield'],
  templar:     ['plate_head', 'plate_chest', 'plate_legs', 'plate_feet', 'pendant', 'long_sword', 'round_shield'],
  berserker:   ['plate_head', 'plate_chest', 'plate_legs', 'plate_feet', 'pendant', 'war_axe', 'short_sword'],

  pyromancer:  ['robe_head', 'robe_chest', 'robe_legs', 'robe_feet', 'pendant', 'staff', 'orb'],
  hydromancer: ['robe_head', 'robe_chest', 'robe_legs', 'robe_feet', 'pendant', 'staff', 'tome'],
  stormcaller: ['robe_head', 'robe_chest', 'robe_legs', 'robe_feet', 'pendant', 'wand', 'orb'],

  lifewarden:  ['vestment_head', 'vestment_chest', 'vestment_legs', 'vestment_feet', 'pendant', 'branch', 'fetish'],
  stoneshaper: ['vestment_head', 'vestment_chest', 'vestment_legs', 'vestment_feet', 'pendant', 'branch', 'fetish'],
  wildshape:   ['vestment_head', 'vestment_chest', 'vestment_legs', 'vestment_feet', 'pendant', 'branch', 'fetish'],

  marksman:    ['hide_head', 'hide_chest', 'hide_legs', 'hide_feet', 'pendant', 'bow', 'quiver'],
  skirmisher:  ['hide_head', 'hide_chest', 'hide_legs', 'hide_feet', 'pendant', 'throwing_blade', 'quiver'],
  shadowblade: ['hide_head', 'hide_chest', 'hide_legs', 'hide_feet', 'pendant', 'dagger'],

  // The Monk's three, from `assets/art/jadeveil/monk/` (the private project notes,
  // "Equipment rules"). The Beetle's greatstaff fills both hands, so six pieces
  // and no off-hand; the Mantis's handblade is one recipe crafted twice, as the
  // Shadowblade's dagger is; the Firefly carries the Arcanist's staff and the
  // lantern as its focus — seven.
  beetle:      ['plate_head', 'plate_chest', 'plate_legs', 'plate_feet', 'pendant', 'greatstaff'],
  firefly:     ['vestment_head', 'vestment_chest', 'vestment_legs', 'vestment_feet', 'pendant', 'staff', 'lantern'],
  mantis:      ['hide_head', 'hide_chest', 'hide_legs', 'hide_feet', 'pendant', 'handblade'],
};

/**
 * The weapons each path may hold, once it has been chosen.
 *
 * **A set is not a vocabulary.** `MASTERY_SET_FORMS` names the seven pieces of a
 * path's legendary set — two of which happen to be weapons — and reading the
 * lock off it would say a Berserker may hold exactly a war axe and a short
 * sword, which is a set list wearing a rule's hat. A path is allowed to reach
 * for more than the two pieces somebody drew art for; what it is not allowed to
 * do is reach for the weapon another path is built around. So this is authored,
 * and `itemForms.test.ts` pins that every set weapon appears in its own path's
 * list — the set can never contain something the path may not hold.
 *
 * Every list is a subset of the forms its class may hold at all: the mastery
 * lock narrows the class lock, it never widens it. Before a path is chosen a
 * hero keeps the whole class vocabulary, so a level-1 Hunter still carries the
 * bow the tutorial hands them.
 *
 * **The Hunter is where the whole rule came from.** A Skirmisher throws blades
 * and fights at a spear's length; handing it a bow let it opt out of every risk
 * the path is priced around while keeping the bonuses for taking them. The
 * Marksman is the mirror and gives up the blades.
 *
 * **Arcanists and Druids deliberately keep both of their implements.** Two
 * forms is the entire class vocabulary, and splitting it one-each would make the
 * lock the *only* thing distinguishing three paths that are otherwise
 * distinguished by twelve nodes apiece. Their off-hand already differs (an orb
 * is not a tome) and that is the slot their class was always defined by.
 */
export const MASTERY_WEAPON_FORMS: Record<MasteryId, FormId[]> = {
  // ── Champion ──────────────────────────────────────────────────────────────
  // Hammer and board. No greatsword by construction: a two-hander leaves no
  // room for the shield the whole path is built standing behind.
  bulwark:     ['warhammer', 'flanged_mace', 'short_sword'],
  // A sword arm, and the mace a militant order carries when a blade is the
  // wrong statement.
  templar:     ['long_sword', 'warhammer', 'flanged_mace'],
  // The only Champion path that gives up the shield, so it is the only one
  // allowed the two-hander — and the short sword is its off-hand.
  berserker:   ['war_axe', 'greatsword', 'short_sword'],

  // ── Arcanist ──────────────────────────────────────────────────────────────
  pyromancer:  ['staff', 'wand'],
  hydromancer: ['staff', 'wand'],
  stormcaller: ['wand', 'staff'],

  // ── Druid ─────────────────────────────────────────────────────────────────
  // The sickle is the Druid's blade, and all three paths keep it: the class's
  // two physical weapons are what a Druid reaches for when magic is the wrong
  // answer, and no path of the three is defined by refusing that.
  lifewarden:  ['branch', 'cudgel', 'sickle'],
  stoneshaper: ['branch', 'cudgel', 'sickle'],
  wildshape:   ['branch', 'cudgel', 'sickle'],

  // ── Hunter ────────────────────────────────────────────────────────────────
  // The shooter. Gives up every blade, which is what makes the crossbow a
  // choice rather than a spare.
  marksman:    ['bow', 'crossbow'],
  // Thrown steel and a spear's reach. **No bow** — this is the playtest report
  // this rule exists to answer.
  skirmisher:  ['throwing_blade', 'throwing_axe', 'spear', 'dagger'],
  // Two daggers, and nothing else. It used to keep the throwing blade "for when
  // the gap is wrong" — but a gap is exactly the risk this path is priced
  // around: it closes distance, it opens from behind, and the whole tree pays
  // for standing next to somebody. A thrown option is the same opt-out the bow
  // was for the Skirmisher, one path over. Thrown steel is the Skirmisher's, and
  // this is the only Hunter path that dual-wields, so one form is a full pair of
  // hands rather than half a vocabulary.
  //
  // The sabre widens it without breaking it: a longer blade is still a blade
  // held at arm's length, so the path gains reach of steel and no reach of
  // flight. It dual-wields like the dagger.
  shadowblade: ['dagger', 'sabre'],

  // ── Monk ──────────────────────────────────────────────────────────────────
  // One vocabulary per path, each its own (the private project notes, "New
  // forms"). The hand wraps are the apprentice's and no path keeps them: the
  // path's iron replaces them and the sweep sends them to the bag.
  //
  // The Beetle's greatstaff and nothing else: it is two-handed, so a Beetle
  // holds no one-hander and no off-hand — it protects by standing between, not
  // behind a board.
  beetle:      ['greatstaff'],
  // The Arcanist's implements, shared rather than redrawn: a staff or a wand in
  // the main hand and a focus in the off-hand (`OFFHAND_MASTERIES`). Not the
  // Druid's branch — the Firefly's light is a bolt, and the bolt is the staff's.
  firefly:     ['staff', 'wand'],
  // The handblade, one in each hand: the third dual-wield path
  // (`equipRules.DUAL_WIELD_MASTERIES`). One form is a full pair of hands, the
  // Shadowblade's argument for its daggers.
  mantis:      ['handblade'],
};

/**
 * Whether `path` may hold `form`, with no path meaning "no narrowing".
 *
 * The one predicate `canEquip` asks, so a caller cannot get the "before a path
 * is chosen" case wrong by testing the table directly and finding nothing.
 */
export function masteryAllowsWeapon(path: MasteryId | null | undefined, form: FormId): boolean {
  if (!path) return true;
  return MASTERY_WEAPON_FORMS[path].includes(form);
}

/**
 * The class each path belongs to, as the item rules need it.
 *
 * `masteryData` says the same for the chosen-able paths and carries their
 * trees; the item tables cannot import it without pulling every skill in the
 * game into item generation, and the Monk's paths have no tree yet.
 * `itemForms.test.ts` pins the two against each other.
 */
export const PATH_CLASS: Record<MasteryId, HeroClass> = {
  bulwark: HeroClass.Warrior, templar: HeroClass.Warrior, berserker: HeroClass.Warrior,
  pyromancer: HeroClass.Mage, hydromancer: HeroClass.Mage, stormcaller: HeroClass.Mage,
  lifewarden: HeroClass.Healer, stoneshaper: HeroClass.Healer, wildshape: HeroClass.Healer,
  marksman: HeroClass.Ranger, skirmisher: HeroClass.Ranger, shadowblade: HeroClass.Ranger,
  beetle: HeroClass.Monk, firefly: HeroClass.Monk, mantis: HeroClass.Monk,
};

const PATH_IDS = Object.keys(PATH_CLASS) as MasteryId[];

/** The paths a class chooses between, in table order. */
export function pathsOfClass(heroClass: HeroClass): MasteryId[] {
  return PATH_IDS.filter((p) => PATH_CLASS[p] === heroClass);
}

export type ArmourWeight = 'plate' | 'hide' | 'robe' | 'vestment';

/**
 * The armour weight each path wears — a path vocabulary, like the weapons above.
 *
 * Every existing path wears its class's weight, so for them this changes
 * nothing. The Monk is why it exists: one class, three weights — the Beetle in
 * plate, the Firefly in vestment, the Mantis in hide — and before its path the
 * Monk may wear all three (`wearableWeights`). Armour's class lock is derived
 * from this table, so a weight names exactly the classes with a path that
 * wears it and the two cannot disagree.
 */
export const MASTERY_ARMOUR_WEIGHT: Record<MasteryId, ArmourWeight> = {
  bulwark: 'plate', templar: 'plate', berserker: 'plate',
  pyromancer: 'robe', hydromancer: 'robe', stormcaller: 'robe',
  lifewarden: 'vestment', stoneshaper: 'vestment', wildshape: 'vestment',
  marksman: 'hide', skirmisher: 'hide', shadowblade: 'hide',
  beetle: 'plate', firefly: 'vestment', mantis: 'hide',
};

/**
 * The weights a hero may wear: its path's, or before a path the union of every
 * path its class could choose. A path only ever narrows the class.
 */
export function wearableWeights(heroClass: HeroClass, path: MasteryId | null | undefined): ArmourWeight[] {
  if (path) return [MASTERY_ARMOUR_WEIGHT[path]];
  return [...new Set(pathsOfClass(heroClass).map((p) => MASTERY_ARMOUR_WEIGHT[p]))];
}

/** The weight an armour form is cut in, or null for anything that is not armour. */
export function armourWeightOf(form: FormId): ArmourWeight | null {
  const [weight, slot, ...rest] = form.split('_');
  if (rest.length > 0 || !ARMOUR_SLOTS.includes(slot as ArmourSlot)) return null;
  return ARMOUR_WEIGHTS.includes(weight as ArmourWeight) ? (weight as ArmourWeight) : null;
}

/** The set motifs a given form belongs to — the inverse of the table above. */
const SET_MOTIFS_BY_FORM = new Map<FormId, MasteryId[]>();
for (const [mastery, forms] of Object.entries(MASTERY_SET_FORMS) as [MasteryId, FormId[]][]) {
  for (const form of forms) {
    SET_MOTIFS_BY_FORM.set(form, [...(SET_MOTIFS_BY_FORM.get(form) ?? []), mastery]);
  }
}

export function masterySetMotifsFor(form: FormId): MasteryId[] {
  return SET_MOTIFS_BY_FORM.get(form) ?? [];
}

/** The forms in a path's legendary set. Every path has one, the Monk's three included. */
export function setFormsOf(path: MasteryId): FormId[] {
  return MASTERY_SET_FORMS[path];
}

const ALL_MOTIFS: MotifId[] = [
  'plain', 'iron', 'steel', 'silver', 'bronze', 'gold', 'runed',
  'fire', 'ice', 'storm', 'nature', 'shadow', 'holy',
];

/**
 * Armour weights get a themed subset rather than all thirteen.
 *
 * Partly for volume — sixteen armour forms × thirteen motifs is a lot of nearly
 * identical loot — but mostly because a Hallowed Hide Jerkin and an Umbral
 * Cuirass read as mismatched.
 *
 * **Every weight lands on 2 common / 2 rare / 3 epic, and that is the rule the
 * specific motifs get retuned inside of.** It used to be 2/1/3, which sounds
 * like a rounding error and is not: rarity rides on the motif, so the count *is*
 * the drop pool, and one rare treatment per weight meant a Champion's entire
 * rare armour library was a Steel Helm, Cuirass, Greaves and Sabatons — four
 * items, all of one colour, for the whole stretch of the campaign between the
 * starter kit and the first Epic. Hide was worse still at Epic: it carried two
 * where the others carried three, so a Hunter's epic armour was 10.5% of what
 * the drop table could hand them against a Champion's 25%. Armour takes its
 * class from the *weight*, not the motif, so nothing here is constrained by
 * `MOTIF_CLASS` — only by what reads as one suit.
 *
 * Pinned by `lootGenerator.test.ts`.
 */
const PLATE_MOTIFS: MotifId[] = ['plain', 'iron', 'steel', 'bronze', 'gold', 'fire', 'holy'];
const HIDE_MOTIFS: MotifId[] = ['plain', 'iron', 'silver', 'nature', 'gold', 'storm', 'shadow'];
const ROBE_MOTIFS: MotifId[] = ['plain', 'iron', 'silver', 'runed', 'fire', 'ice', 'storm'];
const VESTMENT_MOTIFS: MotifId[] = ['plain', 'iron', 'nature', 'bronze', 'gold', 'ice', 'holy'];

/**
 * Class affinity per motif.
 *
 * Non-common items must lock to their classes. Armour takes its classes from
 * the weight and weapons from the form, but a pendant has neither — so
 * jewellery takes them from the motif, which also gives the treatment a
 * consistent identity across the library.
 *
 * **Every rarity therefore has to name every class, or one of them cannot
 * obtain jewellery at that tier at all.** Rare named Warrior, Hunter and Druid
 * and stopped: an Arcanist could not be handed a rare pendant or a rare ring by
 * any route in the game — no drop, no forge, no shop — and nothing said so,
 * because a lock that excludes everybody looks exactly like a lock. `runed` is
 * the Arcanist's rare entry and `lootPool.test.ts` pins the coverage.
 *
 * The Monk shares the casters' motifs: every material motif that names the
 * Druid or the Arcanist names the Monk too (the private project notes,
 * "Equipment rules"). The set motifs stay single: a set piece is locked to its
 * path, so a second class there would be a lock saying something the item does
 * not mean.
 */
export const MOTIF_CLASS: Record<MotifId, HeroClass[]> = {
  plain: [HeroClass.Warrior],
  iron: [HeroClass.Warrior],
  steel: [HeroClass.Warrior],
  bronze: [HeroClass.Warrior],
  gold: [HeroClass.Warrior],
  silver: [HeroClass.Ranger],
  shadow: [HeroClass.Ranger],
  runed: [HeroClass.Mage, HeroClass.Monk],
  fire: [HeroClass.Mage, HeroClass.Monk],
  ice: [HeroClass.Mage, HeroClass.Monk],
  storm: [HeroClass.Mage, HeroClass.Monk],
  nature: [HeroClass.Healer, HeroClass.Monk],
  holy: [HeroClass.Healer, HeroClass.Monk],
  // Jadeveil's two are minted on armour and weapons only (`worldGear.ts`), which
  // take their class from the weight or the form, so this names everybody and
  // decides nothing: jewellery stays on the Empire's motifs' affinity.
  votive: [HeroClass.Warrior, HeroClass.Mage, HeroClass.Healer, HeroClass.Ranger, HeroClass.Monk],
  spiritsealed: [HeroClass.Warrior, HeroClass.Mage, HeroClass.Healer, HeroClass.Ranger, HeroClass.Monk],
  // The archipelago's two are minted on armour alone, whose class comes from
  // the weight, so they name everybody and decide nothing, as Jadeveil's do.
  redflag: [HeroClass.Warrior, HeroClass.Mage, HeroClass.Healer, HeroClass.Ranger, HeroClass.Monk],
  compassbound: [HeroClass.Warrior, HeroClass.Mage, HeroClass.Healer, HeroClass.Ranger, HeroClass.Monk],
  // A collection is its weight's, so it names the weight's classes
  // (`weightClasses`), as its pieces' locks do.
  jade_bastion: [HeroClass.Warrior, HeroClass.Monk],
  canopy_strider: [HeroClass.Ranger, HeroClass.Monk],
  cloud_script: [HeroClass.Mage],
  monastery_oath: [HeroClass.Healer, HeroClass.Monk],
  ironclad_admiral: [HeroClass.Warrior, HeroClass.Monk],
  saltrunner: [HeroClass.Ranger, HeroClass.Monk],
  stormglass: [HeroClass.Mage],
  shellwoven: [HeroClass.Healer, HeroClass.Monk],

  // Mastery sets take the class their path belongs to; `masteryLock` narrows it
  // further to the single path, which is the real gate
  bulwark: [HeroClass.Warrior],
  templar: [HeroClass.Warrior],
  berserker: [HeroClass.Warrior],
  pyromancer: [HeroClass.Mage],
  hydromancer: [HeroClass.Mage],
  stormcaller: [HeroClass.Mage],
  lifewarden: [HeroClass.Healer],
  stoneshaper: [HeroClass.Healer],
  wildshape: [HeroClass.Healer],
  marksman: [HeroClass.Ranger],
  skirmisher: [HeroClass.Ranger],
  shadowblade: [HeroClass.Ranger],
  beetle: [HeroClass.Monk],
  firefly: [HeroClass.Monk],
  mantis: [HeroClass.Monk],
};

/**
 * Which classes each off-hand kind belongs to.
 *
 * This is what makes the off-hand class-defining. `weapon` (dual-wield) is null
 * because it is gated by mastery rather than class — see
 * `equipRules.DUAL_WIELD_MASTERIES`.
 *
 * Item metadata, so it lives beside the forms rather than in the rule that
 * enforces it: `itemAffixes` needs the same answer to decide which affixes suit
 * a quiver, and a `data/` module cannot reach up into `systems/` for it.
 */
export const OFFHAND_CLASS: Record<OffHandKind, HeroClass[] | null> = {
  shield: [HeroClass.Warrior],
  quiver: [HeroClass.Ranger],
  // The Firefly carries the Arcanist's focus; `equipRules.OFFHAND_MASTERIES`
  // keeps it from the Beetle and the Mantis.
  focus: [HeroClass.Mage, HeroClass.Monk],
  totem: [HeroClass.Healer],
  weapon: null,
};

type ArmourSlot = 'head' | 'chest' | 'legs' | 'feet';
/** Verified against FormId below, so a rename on either side fails to compile. */
type ArmourFormId = `${ArmourWeight}_${ArmourSlot}`;

const ARMOUR_WEIGHTS: ArmourWeight[] = ['plate', 'hide', 'robe', 'vestment'];
const ARMOUR_SLOTS: ArmourSlot[] = ['head', 'chest', 'legs', 'feet'];

/**
 * Armour weight → the classes it belongs to above common: every class with a
 * path that wears it (`MASTERY_ARMOUR_WEIGHT`), in `HeroClass` order.
 */
function weightClasses(weight: ArmourWeight): HeroClass[] {
  return Object.values(HeroClass).filter((c) =>
    pathsOfClass(c).some((p) => MASTERY_ARMOUR_WEIGHT[p] === weight));
}

const WEIGHT_MOTIFS: Record<ArmourWeight, MotifId[]> = {
  plate: PLATE_MOTIFS,
  hide: HIDE_MOTIFS,
  robe: ROBE_MOTIFS,
  vestment: VESTMENT_MOTIFS,
};

/** How each weight spends its budget — heavy buys defence, light buys speed. */
const WEIGHT_TILT: Record<ArmourWeight, StatTilt> = {
  plate: { defense: 3, maxHp: 2 },
  hide: { defense: 1, speed: 2, attack: 1 },
  robe: { magic: 3, magicDefense: 1 },
  vestment: { magic: 2, maxHp: 2, defense: 0.5, magicDefense: 0.5 },
};

/** Built rather than written out — sixteen near-identical literals hide their own typos. */
function armourForms(): Record<ArmourFormId, FormSpec> {
  const out = {} as Record<ArmourFormId, FormSpec>;
  for (const weight of ARMOUR_WEIGHTS) {
    for (const slot of ARMOUR_SLOTS) {
      out[`${weight}_${slot}`] = {
        slot,
        classLock: weightClasses(weight),
        tilt: WEIGHT_TILT[weight],
        motifs: [...WEIGHT_MOTIFS[weight]],
      };
    }
  }
  return out;
}

export const FORMS: Record<FormId, FormSpec> = {
  // ── Armour ────────────────────────────────────────────────────────────────
  ...armourForms(),

  // ── Weapons ───────────────────────────────────────────────────────────────
  short_sword: {
    slot: 'mainHand', handRule: 'main', attack: 'blade',
    classLock: [HeroClass.Warrior], tilt: { attack: 3, speed: 1 }, motifs: ALL_MOTIFS,
  },
  long_sword: {
    slot: 'mainHand', handRule: 'main', attack: 'blade',
    classLock: [HeroClass.Warrior], tilt: { attack: 4 }, motifs: ALL_MOTIFS,
  },
  greatsword: {
    slot: 'mainHand', handRule: 'twoHanded', attack: 'blade',
    classLock: [HeroClass.Warrior], tilt: { attack: 6, defense: 1 }, motifs: ALL_MOTIFS,
  },
  war_axe: {
    slot: 'mainHand', handRule: 'main', attack: 'blade',
    classLock: [HeroClass.Warrior], tilt: { attack: 4, defense: 1 }, motifs: ALL_MOTIFS,
  },
  dagger: {
    slot: 'mainHand', handRule: 'main', attack: 'blade',
    classLock: [HeroClass.Ranger], tilt: { attack: 2, speed: 3 }, motifs: ALL_MOTIFS,
  },
  spear: {
    slot: 'mainHand', handRule: 'main', attack: 'reach',
    classLock: [HeroClass.Ranger], tilt: { attack: 3, speed: 1, defense: 1 }, motifs: ALL_MOTIFS,
  },
  throwing_blade: {
    slot: 'mainHand', handRule: 'main', attack: 'thrown',
    classLock: [HeroClass.Ranger], tilt: { attack: 3, speed: 2 }, motifs: ALL_MOTIFS,
  },
  bow: {
    slot: 'mainHand', handRule: 'main', attack: 'bow',
    classLock: [HeroClass.Ranger], tilt: { attack: 3, speed: 2 }, motifs: ALL_MOTIFS,
  },
  crossbow: {
    slot: 'mainHand', handRule: 'main', attack: 'crossbow',
    classLock: [HeroClass.Ranger], tilt: { attack: 4, defense: 1 }, motifs: ALL_MOTIFS,
  },
  // The staff and the wand are shared with the Monk, whose Firefly casts with
  // them; `MASTERY_WEAPON_FORMS` keeps them from its other two paths.
  staff: {
    slot: 'mainHand', handRule: 'main', attack: 'arcane',
    classLock: [HeroClass.Mage, HeroClass.Monk], tilt: { magic: 4, maxHp: 1 }, motifs: ALL_MOTIFS,
  },
  wand: {
    slot: 'mainHand', handRule: 'main', attack: 'arcane',
    classLock: [HeroClass.Mage, HeroClass.Monk], tilt: { magic: 3, speed: 1 }, motifs: ALL_MOTIFS,
  },
  warhammer: {
    slot: 'mainHand', handRule: 'main', attack: 'blunt',
    classLock: [HeroClass.Warrior], tilt: { attack: 3, defense: 2 }, motifs: ALL_MOTIFS,
  },
  cudgel: {
    slot: 'mainHand', handRule: 'main', attack: 'blunt',
    classLock: [HeroClass.Healer], tilt: { attack: 3, magic: 1 }, motifs: ALL_MOTIFS,
  },
  branch: {
    slot: 'mainHand', handRule: 'main', attack: 'wild',
    classLock: [HeroClass.Healer], tilt: { magic: 3, maxHp: 1 }, motifs: ALL_MOTIFS,
  },
  // The Champion's mace: harder-hitting than the warhammer and less of a wall.
  flanged_mace: {
    slot: 'mainHand', handRule: 'main', attack: 'blunt',
    classLock: [HeroClass.Warrior], tilt: { attack: 4, maxHp: 1 }, motifs: ALL_MOTIFS,
  },
  // The Druid's blade — a physical melee cut, like the cudgel's blow but quicker.
  sickle: {
    slot: 'mainHand', handRule: 'main', attack: 'blade',
    classLock: [HeroClass.Healer], tilt: { attack: 3, speed: 1, magic: 1 }, motifs: ALL_MOTIFS,
  },
  // The Shadowblade's longer blade: more weight per cut than a dagger, less pace.
  sabre: {
    slot: 'mainHand', handRule: 'main', attack: 'blade',
    classLock: [HeroClass.Ranger], tilt: { attack: 4, speed: 1 }, motifs: ALL_MOTIFS,
  },
  // The Skirmisher's second thrown weapon: heavier than the blade, and slower.
  throwing_axe: {
    slot: 'mainHand', handRule: 'main', attack: 'thrown',
    classLock: [HeroClass.Ranger], tilt: { attack: 4, speed: 1 }, motifs: ALL_MOTIFS,
  },

  // The Monk's apprentice weapon: the hands, bound. Plain only — it is the one
  // weapon a Monk holds before its path, the main hand is locked around it
  // until then (`equipRules.mainHandLocked`), and the path's iron replaces it,
  // so a better pair could never be worn and would only be bag fodder.
  hand_wraps: {
    slot: 'mainHand', handRule: 'main', attack: 'fist',
    classLock: [HeroClass.Monk], tilt: { attack: 3, speed: 1 }, motifs: ['plain'],
  },
  // The Beetle's weapon: a long iron-shod staff swung in both hands. Blunt, and
  // tilted toward the defences the path's Barriers scale from.
  greatstaff: {
    slot: 'mainHand', handRule: 'twoHanded', attack: 'blunt',
    classLock: [HeroClass.Monk], tilt: { attack: 5, defense: 1, magicDefense: 1 }, motifs: ALL_MOTIFS,
  },
  // The Mantis's blade, gripped across the fist and punched rather than swung,
  // and held in both hands. Quicker than a dagger is heavy.
  handblade: {
    slot: 'mainHand', handRule: 'main', attack: 'blade',
    classLock: [HeroClass.Monk], tilt: { attack: 3, speed: 2 }, motifs: ALL_MOTIFS,
  },

  // ── Off-hand. Class comes from offHandKind, not classLock. ────────────────
  round_shield: {
    slot: 'offHand', offHandKind: 'shield',
    tilt: { defense: 3, maxHp: 1 }, motifs: ALL_MOTIFS,
  },
  tower_shield: {
    slot: 'offHand', offHandKind: 'shield',
    tilt: { defense: 4, maxHp: 2 }, motifs: ALL_MOTIFS,
  },
  quiver: {
    slot: 'offHand', offHandKind: 'quiver',
    tilt: { attack: 3, speed: 1 }, motifs: ALL_MOTIFS,
  },
  orb: {
    slot: 'offHand', offHandKind: 'focus',
    tilt: { magic: 3, maxHp: 1 }, motifs: ALL_MOTIFS,
  },
  tome: {
    slot: 'offHand', offHandKind: 'focus',
    tilt: { magic: 3, magicDefense: 1 }, motifs: ALL_MOTIFS,
  },
  fetish: {
    slot: 'offHand', offHandKind: 'totem',
    tilt: { magic: 2, maxHp: 2 }, motifs: ALL_MOTIFS,
  },
  // The Arcanist's third focus, and its quickest: a light carried ahead.
  lantern: {
    slot: 'offHand', offHandKind: 'focus',
    tilt: { magic: 3, speed: 1 }, motifs: ALL_MOTIFS,
  },

  // ── Jewellery. Class comes from the motif — see MOTIF_CLASS. ──────────────
  pendant: {
    slot: 'neck', tilt: { maxHp: 2, magic: 1 }, motifs: ALL_MOTIFS,
  },
  band: {
    slot: 'ring', tilt: { attack: 1, magic: 1, speed: 1 }, motifs: ALL_MOTIFS,
  },
};

export const FORM_IDS = Object.keys(FORMS) as FormId[];

/**
 * Compile-time check that every `<weight>_<slot>` pair exists in `FormId`, and
 * that `FormId` has no armour entry this table forgot. Renaming a weight on
 * either side now fails to build instead of silently dropping sixteen items.
 */
type _ArmourIdsMatch = ArmourFormId extends FormId ? true : never;
const _armourIdsMatch: _ArmourIdsMatch = true;
void _armourIdsMatch;
