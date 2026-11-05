import {
  EquipSlot, HeroClass, ItemTemplate, MasteryId, Rarity,
} from '@/models/types';
import { generateItemTemplates } from '@/data/items/itemGen';

/**
 * The item library: a generated form × motif cross-product plus hand-written
 * uniques.
 *
 * Generation is in `itemGen.ts`; this file exists to bolt the uniques on and to
 * be the one import everything else uses. Uniques win on id collision, so a
 * unique can deliberately replace a generated combination.
 *
 * Junk loot is intended. Off-class drops are sell fodder that funds the forge,
 * which is where you get the piece you actually wanted.
 */

/**
 * One-off items: boss drops and quest rewards.
 *
 * Legendary exists only here — `MOTIF_RARITY` never assigns it, so no generated
 * item can reach that tier. Their stats are hand-set rather than budgeted,
 * because the whole point of a unique is that it breaks the curve.
 *
 * Each one's name and description are `items.unique.<id>.name` / `.description`,
 * with its Polish gender in `i18n/itemGenders.ts` (`itemText.itemName`).
 */
const uniqueTemplates: ItemTemplate[] = [
  {
    id: 'excalibur',
    rarity: Rarity.Legendary, slot: 'mainHand', handRule: 'main',
    form: 'long_sword', motif: 'holy', tint: { color: '#eaf2ff', accent: '#d8a838' },
    classLock: [HeroClass.Warrior],
    modifiers: { attack: 22, defense: 8, speed: 4 }, sellPrice: 420,
  },
  {
    id: 'aegis',
    rarity: Rarity.Legendary, slot: 'offHand', offHandKind: 'shield',
    form: 'tower_shield', motif: 'gold', tint: { color: '#d8a838', accent: '#eaf2ff' },
    modifiers: { defense: 20, maxHp: 60 }, sellPrice: 380,
  },
  {
    id: 'heartfrost_staff', bossOnly: true,
    rarity: Rarity.Legendary, slot: 'mainHand', handRule: 'main',
    form: 'staff', motif: 'ice', tint: { color: '#cfeaf5', accent: '#5fe0ff' },
    classLock: [HeroClass.Mage],
    modifiers: { magic: 24, attack: 6 }, sellPrice: 400,
  },
  {
    id: 'dragon_scale_armor', bossOnly: true,
    rarity: Rarity.Legendary, slot: 'chest',
    form: 'plate_chest', motif: 'nature', tint: { color: '#2f7a4a', accent: '#d8f0a0' },
    classLock: [HeroClass.Warrior],
    modifiers: { defense: 18, maxHp: 70, speed: 3 }, sellPrice: 440,
  },
  {
    id: 'chieftain_club', bossOnly: true,
    rarity: Rarity.Legendary, slot: 'mainHand', handRule: 'main',
    form: 'cudgel', motif: 'iron', tint: { color: '#6a5038', accent: '#3a2a1a' },
    classLock: [HeroClass.Healer],
    modifiers: { attack: 26, maxHp: 20 }, sellPrice: 400,
  },

  // ── Standalone legendaries beyond Excalibur and Aegis ────────────────────
  // Outside every mastery set and collection: one general piece for most of the
  // classes, and a boss-only piece (`bossOnly`) for each boss that had none.
  // Hand-set stats, like the rest of the uniques. Verify in playtest.
  //
  // The general six: a Champion's hammer, an Arcanist's (and Monk's) wand, a
  // Druid's branch, a Hunter's bow, a vestment for the Druid and the Firefly,
  // and a pendant for the Arcanist and the Monk.
  {
    id: 'oathbreaker_maul',
    rarity: Rarity.Legendary, slot: 'mainHand', handRule: 'main',
    form: 'warhammer', motif: 'iron', tint: { color: '#8c929c', accent: '#d8a838' },
    classLock: [HeroClass.Warrior],
    modifiers: { attack: 24, maxHp: 40, defense: 5 }, sellPrice: 410,
  },
  {
    id: 'stormglass_wand',
    rarity: Rarity.Legendary, slot: 'mainHand', handRule: 'main',
    form: 'wand', motif: 'storm', tint: { color: '#c4e8ff', accent: '#7a5cff' },
    classLock: [HeroClass.Mage, HeroClass.Monk],
    modifiers: { magic: 22, speed: 4, magicPen: 8 }, sellPrice: 410,
  },
  {
    id: 'greenheart_branch',
    rarity: Rarity.Legendary, slot: 'mainHand', handRule: 'main',
    form: 'branch', motif: 'nature', tint: { color: '#5a7a38', accent: '#f0e48c' },
    classLock: [HeroClass.Healer],
    modifiers: { magic: 22, maxHp: 45, manaRegen: 2 }, sellPrice: 410,
  },
  {
    id: 'windpiercer',
    rarity: Rarity.Legendary, slot: 'mainHand', handRule: 'main',
    form: 'bow', motif: 'silver', tint: { color: '#dfe6ee', accent: '#5fb4d8' },
    classLock: [HeroClass.Ranger],
    modifiers: { attack: 23, speed: 5, armourPen: 8 }, sellPrice: 420,
  },
  {
    id: 'long_road_vestment',
    rarity: Rarity.Legendary, slot: 'chest',
    form: 'vestment_chest', motif: 'gold', tint: { color: '#b8a468', accent: '#4f7a48' },
    classLock: [HeroClass.Healer, HeroClass.Monk],
    modifiers: { defense: 8, magicDefense: 10, maxHp: 60, magic: 8 }, sellPrice: 400,
  },
  {
    id: 'emberheart_pendant',
    rarity: Rarity.Legendary, slot: 'neck',
    form: 'pendant', motif: 'fire', tint: { color: '#e8643c', accent: '#ffd870' },
    classLock: [HeroClass.Mage, HeroClass.Monk],
    modifiers: { maxHp: 55, attack: 8, magic: 8 }, sellPrice: 390,
  },

  // ── Boss-only: Aethelred's, Jorōgumo's and the Last Lesson's ─────────────
  // Each drops only from its boss, at a chance (`BALANCE.BOSS_LOOT`); the
  // Jadeveil two carry their world as Kairen's Fang does.
  {
    id: 'last_legion_crown', bossOnly: true,
    rarity: Rarity.Legendary, slot: 'head',
    form: 'plate_head', motif: 'fire', tint: { color: '#1c1216', accent: '#b01c26' },
    classLock: [HeroClass.Warrior, HeroClass.Monk],
    modifiers: { defense: 14, maxHp: 90, attack: 6 }, sellPrice: 430,
  },
  {
    id: 'widows_needle', bossOnly: true,
    rarity: Rarity.Legendary, slot: 'mainHand', handRule: 'main',
    form: 'dagger', motif: 'shadow', world: 'jadeveil', tint: { color: '#3a3350', accent: '#9be37a' },
    classLock: [HeroClass.Ranger],
    modifiers: { attack: 21, speed: 7, critChance: 8 }, sellPrice: 420,
  },
  {
    id: 'silent_lesson_staff', bossOnly: true,
    rarity: Rarity.Legendary, slot: 'mainHand', handRule: 'main',
    form: 'greatstaff', motif: 'holy', world: 'jadeveil', model: 'silent_lesson_staff',
    tint: { color: '#e6dcc0', accent: '#d8aa3c' },
    classLock: [HeroClass.Monk],
    modifiers: { attack: 25, defense: 6, magicDefense: 8 }, sellPrice: 430,
  },

  // ── Jadeveil's authored weapons ──────────────────────────────────────────
  // Not pieces of the four collections and not one per class: a weapon where a
  // boss or a place gives one a story (the private project notes).
  // Each has a model of its own (`voxel/items/uniques/`) and a Basic Attack of
  // its own, and drops only in the range (`world`, `worldGear.ts`); where each
  // is found is `jadeveilRewards.ts`.
  //
  // Kairen's Fang: a spear, so the Skirmisher's — the one path whose vocabulary
  // holds a spear (`MASTERY_WEAPON_FORMS`); before a path, any Hunter.
  {
    id: 'kairens_fang', bossOnly: true,
    rarity: Rarity.Legendary, slot: 'mainHand', handRule: 'main',
    form: 'spear', motif: 'spiritsealed', world: 'jadeveil',
    attack: 'dragon_fang', model: 'kairens_fang',
    tint: { color: '#e8e0c8', accent: '#2e6a40' },
    classLock: [HeroClass.Ranger],
    modifiers: { attack: 24, speed: 4, armourPen: 6 }, sellPrice: 430,
  },
  // The Monastery Bellstaff: a staff, so the Arcanists' and the Firefly's —
  // every path that holds one. The Silent Hall's, where the bells stopped.
  {
    id: 'monastery_bellstaff',
    rarity: Rarity.Legendary, slot: 'mainHand', handRule: 'main',
    form: 'staff', motif: 'votive', world: 'jadeveil',
    attack: 'bell_toll', model: 'monastery_bellstaff',
    tint: { color: '#6a4228', accent: '#d8aa3c' },
    classLock: [HeroClass.Mage, HeroClass.Monk],
    modifiers: { magic: 24, maxHp: 30, manaRegen: 2 }, sellPrice: 420,
  },
];

const generated = generateItemTemplates();
const uniqueIds = new Set(uniqueTemplates.map((t) => t.id));

export const itemTemplates: ItemTemplate[] = [
  ...generated.filter((t) => !uniqueIds.has(t.id)),
  ...uniqueTemplates,
];

/**
 * Starter loadout per class — granted by `partyStore.addHero`.
 *
 * All `plain`, which is the weakest motif: a new hero is dressed, not equipped.
 * The off-hand is included so the class-defining slot is visible from the first
 * fight rather than being an empty square nobody investigates.
 */
/**
 * Weapons handed over when a hero commits to a mastery path.
 *
 * A Hunter who takes Shadowblade is a dual-wield assassin holding a bow — the
 * class starter kit was chosen four levels before the path existed, and half the
 * paths change what "correct weapon" even means. These are `iron`, one step
 * above the plain starter kit: enough to be usable in the new role immediately,
 * not enough to stop the player wanting better.
 *
 * Both hands are always specified, so the pair is coherent. Two-handed weapons
 * carry an empty off-hand rather than a shield they cannot hold.
 *
 * Keyed by every path, the Monk's included.
 */
export const MASTERY_STARTER_WEAPONS: Record<MasteryId, { mainHand: string; offHand?: string }> = {
  // ── Champion ──────────────────────────────────────────────────────────────
  // Hammer and a wall to stand behind
  bulwark:     { mainHand: 'warhammer_iron',   offHand: 'tower_shield_iron' },
  templar:     { mainHand: 'long_sword_iron',  offHand: 'round_shield_iron' },
  // The only path that fights with two weapons, so it gets two
  berserker:   { mainHand: 'war_axe_iron',     offHand: 'short_sword_iron' },

  // ── Arcanist ──────────────────────────────────────────────────────────────
  pyromancer:  { mainHand: 'staff_iron',       offHand: 'orb_iron' },
  hydromancer: { mainHand: 'staff_iron',       offHand: 'tome_iron' },
  stormcaller: { mainHand: 'wand_iron',        offHand: 'orb_iron' },

  // ── Druid ─────────────────────────────────────────────────────────────────
  lifewarden:  { mainHand: 'branch_iron',      offHand: 'fetish_iron' },
  stoneshaper: { mainHand: 'branch_iron',      offHand: 'fetish_iron' },
  wildshape:   { mainHand: 'branch_iron',      offHand: 'fetish_iron' },

  // ── Hunter ────────────────────────────────────────────────────────────────
  marksman:    { mainHand: 'bow_iron',         offHand: 'quiver_iron' },
  skirmisher:  { mainHand: 'throwing_blade_iron', offHand: 'quiver_iron' },
  // Dual daggers — the whole reason this grant exists
  shadowblade: { mainHand: 'dagger_iron',      offHand: 'dagger_iron' },

  // ── Monk ──────────────────────────────────────────────────────────────────
  // The greatstaff fills both hands
  beetle:      { mainHand: 'greatstaff_iron' },
  // The Arcanist's staff, and its lantern for a focus
  firefly:     { mainHand: 'staff_iron',       offHand: 'lantern_iron' },
  // A handblade in each hand
  mantis:      { mainHand: 'handblade_iron',   offHand: 'handblade_iron' },
};

/**
 * Everything the path choice hands out, slot → template id: its iron weapons
 * (`MASTERY_STARTER_WEAPONS`) and nothing else. The Monk's hand is locked until
 * the path, so the path must fill it; armour is never issued (playtest
 * 2026-10-17, PT-03: iron chest, legs and feet were more than any other class
 * was handed). Armour outside the path's weight still goes to the bag in the
 * strip that follows (`illegalSlots`).
 */
export function masteryIssue(path: MasteryId): Partial<Record<EquipSlot, string>> {
  const hands = MASTERY_STARTER_WEAPONS[path];
  return { mainHand: hands.mainHand, ...(hands.offHand && { offHand: hands.offHand }) };
}

export const STARTER_KIT: Record<HeroClass, string[]> = {
  [HeroClass.Warrior]: [
    'short_sword_plain', 'round_shield_plain',
    'plate_chest_plain', 'plate_legs_plain', 'plate_feet_plain',
  ],
  [HeroClass.Mage]: [
    'wand_plain', 'orb_plain',
    'robe_chest_plain', 'robe_legs_plain', 'robe_feet_plain',
  ],
  [HeroClass.Healer]: [
    // A branch, so the Druid's first Basic Attack is the magic missile its 14
    // magic is built for. With the cudgel it would be a physical blow off 5
    // attack — legal, and a choice the player can make later, not the default.
    'branch_plain', 'fetish_plain',
    'vestment_chest_plain', 'vestment_legs_plain', 'vestment_feet_plain',
  ],
  [HeroClass.Ranger]: [
    // Thrown steel: the Basic Attack it makes is the short-range throw every
    // Hunter path can start from, and the one two of the three keep.
    'throwing_blade_plain', 'quiver_plain',
    'hide_chest_plain', 'hide_legs_plain', 'hide_feet_plain',
  ],
  [HeroClass.Monk]: [
    // The apprentice trains bare-handed: the wraps are locked on until the path
    // issues its iron (`equipRules.mainHandLocked`). No off-hand before a path.
    'hand_wraps_plain',
    'vestment_chest_plain', 'vestment_legs_plain', 'vestment_feet_plain',
  ],
};
