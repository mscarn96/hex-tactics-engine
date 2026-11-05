import type { HeroClass, Rarity } from './enums';
import type { SkillId } from './ids';
import type { MasteryId } from './mastery';

// ============ EQUIPMENT SLOTS ============

/** Where a worn item actually sits on a hero. */
export type EquipSlot =
  | "head"
  | "neck"
  | "chest"
  | "legs"
  | "feet"
  | "mainHand"
  | "offHand"
  | "ring1"
  | "ring2";

/**
 * What an item declares. Rings say `ring` and fit either ring slot — the item
 * doesn't care which, so it shouldn't have to name one.
 */
export type ItemSlot = Exclude<EquipSlot, "ring1" | "ring2"> | "ring";

/**
 * Every slot, in the order a hero is dressed and displayed.
 *
 * **This is a balance input, not just an iteration helper.**
 * `lootGenerator.SLOT_DROP_WEIGHT` is derived by counting it — a slot's share of
 * drops is its share of the body — so its *length* is the denominator of every
 * drop share in the game and each entry moves the loot table. Adding a member to
 * `EquipSlot` and forgetting this list would silently leave the new slot
 * undressable and unrollable, and nothing at runtime could notice: both are
 * `EquipSlot[]`, and a list missing a member of a union type is perfectly legal.
 *
 * So it is checked at compile time. `SLOT_ORDER` is `as const`, which makes the
 * literal union available to `_UnlistedSlot` below; the annotation on the export
 * catches the opposite mistake, a typo that is not a slot at all.
 */
const SLOT_ORDER = [
  "head", "neck", "chest", "legs", "feet", "mainHand", "offHand", "ring1", "ring2",
] as const;

export const EQUIP_SLOTS: EquipSlot[] = [...SLOT_ORDER];

/**
 * Compile error if `EquipSlot` gains a member `SLOT_ORDER` does not list.
 *
 * The tuple form is load-bearing: a bare `_UnlistedSlot extends never` is a
 * *distributive* conditional, and distributing over `never` yields `never`
 * rather than the `true` branch — so the healthy case would fail to compile and
 * the broken one would pass. Same shape as `_ArmourIdsMatch` in
 * `data/items/itemForms.ts`.
 */
type _UnlistedSlot = Exclude<EquipSlot, (typeof SLOT_ORDER)[number]>;
const _everySlotListed: [_UnlistedSlot] extends [never] ? true : never = true;
void _everySlotListed;

/** How a weapon occupies the hands. */
export type HandRule =
  /** Main hand only. */
  | "main"
  /** Consumes both hands, so nothing can sit in the off-hand. */
  | "twoHanded";

/**
 * What kind of thing fills the off-hand.
 *
 * Each class has its own, which is what makes the slot class-defining rather
 * than "shield or empty": shields are Champion, quivers are Hunter, and so on.
 * `weapon` is dual-wielding and is the only kind gated by a mastery instead of
 * by class.
 */
export type OffHandKind = "shield" | "quiver" | "focus" | "totem" | "weapon";


// ============ ITEMS ============

/**
 * The forms a hand closes on: every weapon and every off-hand.
 *
 * Split out of `FormId` because these are the forms that carry **named model
 * variants** (`ModelVariantId`) — armour is the rig's own re-skin and jewellery
 * is too small to have a silhouette worth varying.
 */
export type HeldFormId =
  // Weapons
  | "short_sword" | "long_sword" | "greatsword" | "war_axe"
  | "dagger" | "spear" | "throwing_blade" | "throwing_axe" | "sabre"
  | "bow" | "crossbow"
  | "staff" | "wand" | "cudgel" | "sickle"
  | "warhammer" | "flanged_mace" | "branch"
  // The Monk's: the apprentice's wraps, the Beetle's two-handed staff and the
  // Mantis's blade, held one in each hand
  | "hand_wraps" | "greatstaff" | "handblade"
  // Off-hand
  | "round_shield" | "tower_shield" | "quiver" | "orb" | "tome" | "fetish"
  | "lantern";

/**
 * A named silhouette *within* a held form — a Falchion is a short sword, a
 * Longbow is a bow.
 *
 * **A variant is geometry and a noun, and nothing else.** It shares its form's
 * equip rule, stat tilt and Basic Attack, which is why none of those tables is
 * keyed by it. Each form's first variant is spelled the same as the form itself
 * and draws the form's original model, so "no variant" and "the base variant"
 * are one answer. The form → variant list lives in `voxel/items/variants.ts`,
 * the nouns in `data/items/itemForms.ts`.
 */
export type ModelVariantId =
  | HeldFormId
  // Swords
  | "falchion" | "estoc" | "broadsword" | "flamberge" | "claymore" | "scimitar"
  // Axes, maces, hammers, clubs, sickles
  | "bearded_axe" | "maul" | "morning_star" | "knobkerrie" | "billhook"
  // Daggers, spears, thrown
  | "stiletto" | "partisan" | "kunai" | "francisca"
  // Bows and crossbows
  | "longbow" | "hornbow" | "arbalest" | "repeater"
  // Caster weapons
  | "crozier" | "sceptre" | "thornwood"
  // The Monk's
  | "ringed_staff" | "crescent_blade" | "cestus"
  // Off-hands
  | "heater_shield" | "pavise" | "war_quiver" | "prism" | "scroll"
  | "effigy" | "censer";

/**
 * Item silhouette.
 *
 * An item is a **form** (this) × a **motif** (treatment) × a rarity. The form
 * decides what the thing *is* — a short sword, a plate cuirass — and the motif
 * decides what it is made of and how it is decorated. Geometry lives in
 * `voxel/items/forms.ts`, game metadata in `data/itemForms.ts`; both are keyed
 * by these ids.
 *
 * Armour forms are `<weight>_<slot>`, where the weight carries the class
 * flavour: plate is Champion, hide is Hunter, robe is Arcanist, vestment is
 * Druid.
 */
export type FormId =
  | HeldFormId
  // Armour
  | "plate_head" | "plate_chest" | "plate_legs" | "plate_feet"
  | "hide_head" | "hide_chest" | "hide_legs" | "hide_feet"
  | "robe_head" | "robe_chest" | "robe_legs" | "robe_feet"
  | "vestment_head" | "vestment_chest" | "vestment_legs" | "vestment_feet"
  // Jewellery
  | "pendant" | "band";

/**
 * Item treatment — material and elemental decoration.
 *
 * A motif supplies a palette plus optional gem, spurs and glow, so the same
 * form yields an Iron Short Sword and a Frostbound Short Sword with no extra
 * art. Rarity is derived from the motif (see `MOTIF_RARITY`), which is what
 * keeps a "legendary plain dagger" from ever being generated.
 */
/**
 * A world-themed legendary armour collection — four pieces in one weight, worn
 * across classes. Named here, beside the motifs they are, so the data and the
 * voxel tables can key on it without importing each other.
 */
export type CollectionId =
  | "jade_bastion" | "canopy_strider" | "cloud_script" | "monastery_oath"
  // The archipelago's, built ahead of its world (`data/items/collections.ts`)
  | "ironclad_admiral" | "saltrunner" | "stormglass" | "shellwoven";

export type MotifId =
  | "plain" | "iron" | "steel" | "silver" | "bronze" | "gold"
  /**
   * Carved sigils rather than an element, and deliberately not `elemental` —
   * see `MOTIFS.runed`. It exists because rarity rides on the motif, so a
   * rarity with no Arcanist motif in it is a rarity an Arcanist cannot obtain
   * jewellery at: every rare pendant and ring in the game was locked to
   * Warrior, Hunter or Druid, because `classLockFor` reads jewellery's class off
   * `MOTIF_CLASS` and no rare motif named the Arcanist.
   */
  | "runed"
  | "fire" | "ice" | "storm" | "nature" | "shadow" | "holy"
  /**
   * Jadeveil's two ordinary motifs — Votive (Rare) and Spiritsealed (Epic). They
   * drop and forge only in their world (`data/items/worldGear.ts`), so the
   * Empire's loot is exactly what it was.
   */
  | "votive" | "spiritsealed"
  /**
   * The archipelago's two ordinary motifs — Redflag (Rare) and Compassbound
   * (Epic) — built ahead of its world and minted on all four armour weights
   * (`data/items/worldGear.ts`).
   */
  | "redflag" | "compassbound"
  /**
   * Jadeveil's four legendary armour collections, one per weight
   * (`data/items/collections.ts`). Worn by every path of their weight rather
   * than locked to one, and rolling a skill bonus from any of those paths.
   */
  | CollectionId
  /**
   * Legendary mastery sets. These share their names with `MasteryId` on
   * purpose: a set *is* its path, and the overlap lets one string key the
   * motif, the lock and the recipe filter without a translation table.
   * Every path's, the Monk's three included.
   */
  | MasteryId;

/**
 * A named rider rolled onto an instance at acquisition — rare and above only.
 *
 * Here beside `FormId` and `MotifId` because it is the third axis an item is
 * identified by and, like them, a string-literal union: an id that no longer
 * exists is a compile error rather than an affix that silently grants nothing.
 * The table itself lives in `data/items/itemAffixes.ts`.
 */
export type AffixId =
  // Prefixes — one stat, said loudly
  | "keen" | "brutal" | "sundering" | "piercing" | "vampiric" | "attuned"
  | "blessed" | "warded" | "venomous" | "swift" | "stalwart"
  // Suffixes — a pair that says what the piece is for
  | "of_the_viper" | "of_the_leech" | "of_the_duelist" | "of_ruin" | "of_unmaking"
  | "of_the_wellspring" | "of_the_grove" | "of_the_aegis"
  | "of_the_wind" | "of_the_ox" | "of_fury";

export interface ItemModifiers {
  maxHp?: number;
  /**
   * Percent of maximum HP, applied last on the sheet with the mastery
   * percentage (`statCalc`). Not a sheet field: it scales `maxHp` and is gone.
   * Jade's stat since the playtest of 2026-10-14, which asked for health buffs
   * to be percentages rather than flat amounts.
   */
  maxHpPercent?: number;
  attack?: number;
  defense?: number;
  /** Magic Defence only; physical defence bonuses never grant this implicitly. */
  magicDefense?: number;
  magic?: number;
  speed?: number;
  critChance?: number;
  critDamage?: number;
  dodgeChance?: number;
  /** Percent of the target's Physical Defense physical hits ignore. Epic and legendary only. */
  armourPen?: number;
  /** Percent of the target's Magic Defense magic hits ignore. Epic and legendary only. */
  magicPen?: number;

  /**
   * The five stats that let loot say who it is for — see `HeroStats` for what
   * each one does and where it is spent.
   *
   * Every key here has to exist on `HeroStats` too, because `statCalc` is what
   * carries a modifier onto a sheet and it can only write fields a sheet has.
   */
  lifesteal?: number;
  manaRegen?: number;
  healPower?: number;
  shieldPower?: number;
  poisonPower?: number;
}

export type GemKind = 'ruby' | 'sapphire' | 'jade' | 'amber';
/** Cut and Brilliant are the core game's; each expansion adds one above (Jadeveil: `spirit`). */
export type GemTier = 'cut' | 'brilliant' | 'spirit';
export type GemId = `${GemKind}_${GemTier}`;

/** Fields shared by an item template and a rolled instance. */
interface ItemBase {
  // No name or description: both are built from the ids below when shown, in
  // the current language (`data/items/itemText.ts`: `itemName`, `itemDescription`).
  rarity: Rarity;
  modifiers: ItemModifiers;
  sellPrice: number;
  slot: ItemSlot;
  /** Silhouette. Drives both the worn model and the inventory icon. */
  form: FormId;
  /** Material/elemental treatment layered onto the form. */
  motif: MotifId;
  /**
   * Which named silhouette of a held form this is. Set on every generated
   * weapon and off-hand; absent means the form's base model, which is what the
   * authored uniques deliberately keep.
   */
  variant?: ModelVariantId;
  /**
   * Overrides the motif palette. Uniques only — a one-off colourway is cheaper
   * than a motif nobody else can use.
   */
  tint?: { color?: string; accent?: string };
  /** Weapons only. Defaults to "main". */
  handRule?: HandRule;
  /** Off-hand items only — decides which class may carry it. */
  offHandKind?: OffHandKind;
  /**
   * The classes that may use the item — a list, because gear is shared between
   * classes: plate names the Champion and the Monk, whose Beetle wears it.
   * Common armour leaves this unset — its weight is still asked of the
   * wearer's path by `canEquip` — while common *weapons* set it.
   */
  classLock?: HeroClass[];
  /** Restricts the item further, to specific mastery paths — any `MasteryId`. */
  masteryLock?: MasteryId[];
  /**
   * The world whose loot and forge this piece belongs to, where it is not every
   * world's. Absent means the Empire's catalogue, which every world shares.
   * Jadeveil's motifs, collections and weapons carry `'jadeveil'`, so no drop,
   * chest, shop or recipe outside the range can reach them
   * (`data/items/worldGear.ts`). The archipelago's collections and its two
   * motifs carry `'archipelago'`, a world the campaign does not have yet, so
   * nothing rolls them.
   */
  world?: 'jadeveil' | 'archipelago';
  /**
   * Dropped only by the boss whose `lootTable` names it, at a chance, never
   * guaranteed: it is outside every random pool (`lootGenerator.ts`).
   */
  bossOnly?: true;
  /**
   * An authored weapon's own Basic Attack, where its form's would not do —
   * `data/items/weaponAttacks.ts`. Absent, the form's (`FormSpec.attack`).
   */
  attack?: WeaponAttackId;
  /**
   * An authored weapon's own held model, drawn in place of its form's
   * (`voxel/items/uniques/`). Absent, the form's model in its motif or tint.
   */
  model?: UniqueModelId;
}

/**
 * How a weapon makes its Basic Attack — the profiles are `WEAPON_ATTACKS` in
 * `data/items/weaponAttacks.ts`. Here so an item can name one without the
 * models importing the data layer.
 */
export type WeaponAttackId =
  | 'blade'
  | 'blunt'
  | 'reach'
  | 'thrown'
  | 'bow'
  | 'crossbow'
  | 'arcane'
  | 'wild'
  | 'fist'
  | 'unarmed'
  // Jadeveil's two authored weapons
  | 'dragon_fang'
  | 'bell_toll';

/** The authored weapons with a model of their own. */
export type UniqueModelId = "kairens_fang" | "monastery_bellstaff" | "silent_lesson_staff";

export interface Item extends ItemBase {
  id: string;
  templateId: string;
  /**
   * The level this instance was acquired at, and what its `modifiers` are
   * scaled to. Saved, and never an equip requirement.
   *
   * **It is also a legendary's upgrade track.** A legendary drops at the cap in
   * force and each Obsidian Crystal raises it one level past it, up to
   * `BALANCE.MAX_UPGRADE_LEVEL` beyond — its "+3" is three levels over the cap,
   * never a second multiplier. Raising the cap later mints stronger legendaries;
   * it does not re-level old ones. Required rather than optional so that every place an instance is
   * built has to say what level it is, which is the only way "every acquisition
   * persists a level" is checked by the compiler rather than hoped for. See
   * `data/items/itemLevel.ts`.
   */
  itemLevel: number;
  /** Rolled once on acquisition. Array length is permanent capacity; null is empty. */
  sockets?: (GemId | null)[];
  /**
   * Named riders rolled when this instance was acquired. Rare and above only.
   *
   * The stats they grant are **baked into `modifiers`**, so nothing downstream —
   * `statCalc`, `effectiveModifiers` — has to learn the mechanic exists, and
   * `itemName` says them in the name. What this field is for is saying *which*
   * riders they were: the difference between "a
   * sword with some crit on it" and "a Keen sword", which is the difference
   * between a number and a thing a player asks for. See `data/items/itemAffixes`.
   */
  affixes?: AffixId[];
  /**
   * A legendary mastery set piece's skill bonus, rolled once when it was
   * acquired. Absent on everything else.
   *
   * The skill is drawn from **the piece's own path**, so it can never be a bonus
   * for a path that cannot wear it — a Nightveil dagger is worthless to a
   * Marksman for a great many reasons already and "boosts a Marksman skill"
   * should not be one of them. A *miss* is therefore build-relative rather than
   * path-relative: it boosts a node this particular Shadowblade skipped, and the
   * point budget guarantees skipped nodes exist. That is the roll worth
   * rerolling, which is what a level-3 forge is for.
   */
  setBonus?: SetSkillBonus;
}

/**
 * What the bag holds: every carried thing is one entry with a kind. Each kind is
 * declared once in `data/items/bagKinds.ts` (name, icon, stack cap, actions);
 * the entries and their rules are `data/items/bag.ts`.
 */
export type BagKind = 'gear' | 'gem' | 'ration' | 'townPortal' | 'incense';

/** A piece of gear, held whole; every other kind is a stack with a count. */
export type GearEntry = { kind: 'gear'; item: Item };
export type GemEntry = { kind: 'gem'; gem: GemId; count: number };
/** A stack of one kind with nothing more to tell it apart. */
export type PlainStackEntry = { kind: 'ration' | 'townPortal' | 'incense'; count: number };
export type StackEntry = GemEntry | PlainStackEntry;
export type BagEntry = GearEntry | StackEntry;

/** One rolled skill bonus. See `Item.setBonus` and `data/items/setBonus.ts`. */
export interface SetSkillBonus {
  skillId: SkillId;
  /**
   * The path the skill belongs to. A set piece's is always its own path; a
   * collection piece's is any path of its weight, and may not be the wearer's
   * — which is what the item lines and the forge's re-aim read.
   */
  path?: MasteryId;
  /** Added to the skill's damage and healing multipliers, as a percentage. */
  percent: number;
}

export interface ItemTemplate extends ItemBase {
  id: string;
}
