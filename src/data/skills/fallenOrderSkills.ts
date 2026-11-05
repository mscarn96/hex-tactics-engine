import { AfflictionType, AuraType, HeroSkill, SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';

/**
 * The Fallen Order's kits (Jadeveil): the monks who taught the Monk's stances,
 * fighting in them still. Every member fights in one discipline — Beetle, Mantis
 * or Firefly (the private project notes) — with the Monk's own machinery spelled
 * for the enemy side: a Bastion, a blink behind its prey, a mote of healing, a
 * Vengeful Shell. None of them Taunts and none of them swaps stance: the Abbot
 * carries a technique from each discipline in one kit.
 *
 * Every skill is enemy-only and has an id of its own, never the Monk's: a hero's
 * skill costs chi, and an enemy has none. The rules that are not fields live in
 * `systems/combat/fallenOrderKits.ts`.
 */

const O = BALANCE.FALLEN_ORDER;

const BEETLE_OLIVE = '#9aac46';
const BEETLE_AMBER = '#e0a83c';
const MANTIS_GREEN = '#5ec440';
const LANTERN = '#ffb347';
const BELL_BRONZE = '#c89a4a';
const DOOM_VIOLET = '#9a6ae0';

const orderBleed = () => ({ type: AfflictionType.Bleed, magnitude: O.BLEED, duration: O.BLEED_TURNS });

// ── Novice ───────────────────────────────────────────────────────────────────

export const noviceStaff: HeroSkill = {
  id: 'novice_staff',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 0.8,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#c8a070', vfxAftermath: 'dust',
  delivery: 'blunt',
  icon: 'stone_fist',
};

// ── Beetle Warden ────────────────────────────────────────────────────────────

export const wardenStaff: HeroSkill = {
  id: 'warden_staff',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.0,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: BEETLE_OLIVE, vfxAftermath: 'dust',
  delivery: 'reach',
  icon: 'stone_fist',
};

/**
 * The Beetle's Carapace Bastion, on the enemy side: the Warden's hex and the six
 * round it are its ground for two of its turns, and while a monk stands inside and
 * is struck, the Warden takes half. It guards by standing between, never by a
 * Taunt: the answer is to strike what stands outside, to strike the Warden, or to
 * hit everyone at once. Cast only with a monk beside it worth covering
 * (`fallenOrderKits.fallenOrderSkillValue`).
 */
export const wardenBastion: HeroSkill = {
  id: 'warden_bastion',
  gesture: 'bastion',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: O.BASTION_RADIUS,
  bastion: { turns: O.BASTION_TURNS, share: O.BASTION_SHARE },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: O.BASTION_COOLDOWN,
  vfxColor: BEETLE_AMBER, vfxKind: 'nova', vfxPrelude: 'brace', vfxAftermath: 'dust',
  icon: 'stone_ward',
};

// ── Mantis Adept ─────────────────────────────────────────────────────────────

export const adeptCut: HeroSkill = {
  id: 'adept_cut',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 0.9,
  damageType: 'physical',
  appliesEffect: orderBleed(),
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: MANTIS_GREEN, vfxAftermath: 'spatter',
  delivery: 'blade',
  icon: 'venomed_blades',
};

/** The Mantis's Flicker Cut: a blink behind its prey, then the cut, a backstab (`blinksBehind`). */
export const adeptFlicker: HeroSkill = {
  id: 'adept_flicker',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.2,
  damageType: 'physical',
  blinksBehind: 'first',
  appliesEffect: orderBleed(),
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: MANTIS_GREEN, vfxAftermath: 'spatter',
  delivery: 'blade',
  icon: 'shadowstep',
};

/** The Mantis's Pounce: four hexes and a cut, leaving the prey Bleeding. */
export const adeptPounce: HeroSkill = {
  id: 'adept_pounce',
  targetType: SkillTargetType.Single,
  range: 4,
  selfMove: { kind: 'dash', range: 4 },
  damage: 1.3,
  damageType: 'physical',
  appliesEffect: orderBleed(),
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: MANTIS_GREEN, vfxAftermath: 'spatter',
  delivery: 'blade',
  icon: 'pounce',
};

// ── Chain-Sickle Monk ────────────────────────────────────────────────────────

/**
 * The kusarigama thrown on its chain, three hexes out. The Root is a chance, the
 * way Thorn Lash's is: a certain Root on an at-will would be a permanent lock.
 */
export const sickleThrow: HeroSkill = {
  id: 'sickle_throw',
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.9,
  damageType: 'physical',
  appliesEffect: { type: AfflictionType.Root, magnitude: 1, duration: 2, chance: O.SICKLE_ROOT_CHANCE },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#b8c0c8',
  vfxKind: 'throw',
  delivery: 'thrown',
  icon: 'cleaving_throw',
};

/** The chain thrown to bind: a certain Root, out-damaging the at-will so it is pressed. */
export const chainSnare: HeroSkill = {
  id: 'chain_snare',
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 1.1,
  damageType: 'physical',
  appliesEffect: { type: AfflictionType.Root, magnitude: 1, duration: 2 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: O.SNARE_COOLDOWN,
  vfxColor: '#b8c0c8',
  vfxKind: 'throw',
  contact: 'chain',
  delivery: 'thrown',
  icon: 'bolas',
};

// ── Firefly Chanter ──────────────────────────────────────────────────────────

/** The Firefly's Glowmote: a lantern bolt whose mote heals the most hurt monk near it. */
export const chanterMote: HeroSkill = {
  id: 'chanter_mote',
  spell: 'holy',
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.8,
  damageType: 'magic',
  scaling: 'magic',
  mote: { share: O.MOTE_SHARE, reach: O.MOTE_REACH },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: LANTERN, vfxKind: 'bolt',
  icon: 'plasma_orb',
};

/**
 * The Chanter's hymn: every monk within two hexes is healed and shielded. A
 * self-centred ring with no damage, so it is the AI's support branch that weighs
 * it — the healing it would do and the Barriers it would lay — never a damage score.
 */
export const lanternHymn: HeroSkill = {
  id: 'lantern_hymn',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: O.HYMN_RADIUS,
  healing: O.HYMN_HEAL,
  scaling: 'magic',
  appliesEffect: { type: AuraType.Barrier, magnitude: O.HYMN_BARRIER, duration: O.HYMN_TURNS },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: O.HYMN_COOLDOWN,
  vfxColor: LANTERN, vfxKind: 'nova', vfxAftermath: 'motes',
  icon: 'warding_bloom',
};

// ── Fallen Abbot ─────────────────────────────────────────────────────────────
//
// One technique from each discipline in one kit, and no form to change into:
// the Beetle's palm and its Vow of the Shell, the Mantis's Flicker Cut, the
// Firefly's Glowmote. The Vow is the signature and the problem he sets.

export const abbotPalm: HeroSkill = {
  id: 'abbot_palm',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.0,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: BEETLE_OLIVE, vfxAftermath: 'dust',
  delivery: 'blunt',
  icon: 'stone_fist',
};

export const abbotFlicker: HeroSkill = {
  ...adeptFlicker,
  id: 'abbot_flicker',
  damage: 1.3,
  delivery: 'blunt',
};

export const abbotGlowmote: HeroSkill = {
  id: 'abbot_glowmote',
  spell: 'holy',
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 1.2,
  damageType: 'magic',
  scaling: 'magic',
  mote: { share: O.ABBOT_MOTE_SHARE, reach: O.MOTE_REACH },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: LANTERN, vfxKind: 'bolt',
  icon: 'plasma_orb',
};

/** What the Vow fires once it has taken a blow: the palm at the attacker, wherever it stands. */
export const abbotVowAnswer: HeroSkill = {
  id: 'abbot_vow_answer',
  targetType: SkillTargetType.Single,
  range: 99,
  damage: O.VOW_STRIKE,
  damageType: 'physical',
  targetSide: 'enemy',
  unlockLevel: 1,
  icon: 'intercept',
  manaCost: 0,
  vfxColor: BEETLE_OLIVE, vfxAftermath: 'dust',
  delivery: 'natural',
};

/**
 * The Beetle's Vengeful Shell, sworn for his monks (`ReactionTrigger`
 * `interceptAlly`): for three of his turns, a single-target blow at a monk within two
 * hexes of him is taken by the Abbot instead — he leaps beside them — and answered.
 * Twice a round; an area blow is never taken. While it stands, picking off his
 * monks one blow at a time feeds him: hit him, hit them all at once, or fight them
 * out of his reach.
 */
export const abbotVow: HeroSkill = {
  id: 'abbot_vow',
  targetType: SkillTargetType.Self,
  range: 0,
  reaction: {
    trigger: { kind: 'interceptAlly', reach: O.VOW_REACH },
    duration: O.VOW_TURNS,
    shotsPerRound: O.VOW_ANSWERS,
    response: abbotVowAnswer,
  },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: O.VOW_COOLDOWN,
  vfxColor: BEETLE_OLIVE, vfxKind: 'buff', vfxPrelude: 'brace',
  icon: 'intercept',
};

// ── Bell-Keeper ──────────────────────────────────────────────────────────────

export const bellStrike: HeroSkill = {
  id: 'bell_strike',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.0,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: BELL_BRONZE, vfxAftermath: 'dust',
  delivery: 'blunt',
  icon: 'troll_smash',
};

/**
 * One toll, for one hero: a Doom that lands when its turns run out. The Doom is the
 * Keeper's own — it is lifted the moment the Keeper falls (`fallenOrderKits.liftedDooms`)
 * — so a tolled hero is a clock on the Keeper's life as much as on their own: kill it,
 * cleanse it, or take it.
 */
export const tollOfPassing: HeroSkill = {
  id: 'toll_of_passing',
  targetType: SkillTargetType.Single,
  range: O.TOLL_RANGE,
  damage: 0.5,
  damageType: 'magic',
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.Doom, magnitude: O.TOLL_DOOM, duration: O.TOLL_TURNS },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: O.TOLL_COOLDOWN,
  vfxColor: DOOM_VIOLET, vfxKind: 'bolt',
  icon: 'bellow',
};

/**
 * The great ring: announced over the ground within two hexes of the Keeper, it lands
 * after the heroes standing there have had a turn, damaging and Stunning whoever is
 * still inside. A Stun, Silence or Freeze on the Keeper breaks it. Closing on the
 * Keeper to end a toll is standing where the ring will land.
 */
export const greatRing: HeroSkill = {
  id: 'great_ring',
  spell: 'arcane',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: O.RING_RADIUS,
  damage: O.RING_DAMAGE,
  damageType: 'magic',
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.Stun, magnitude: 1, duration: 1 },
  prepares: { interruptedBy: ['stun', 'silence', 'freeze'], windows: 1, answers: [{ kind: 'step' }] },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: O.RING_COOLDOWN,
  vfxColor: BELL_BRONZE, vfxKind: 'nova', vfxAftermath: 'dust',
  icon: 'static_burst',
};

/** Every skill here, for the suites that walk the whole roster. */
export const FALLEN_ORDER_SKILLS: HeroSkill[] = [
  noviceStaff,
  wardenStaff, wardenBastion,
  adeptCut, adeptFlicker, adeptPounce,
  sickleThrow, chainSnare,
  chanterMote, lanternHymn,
  abbotPalm, abbotFlicker, abbotGlowmote, abbotVow, abbotVowAnswer,
  bellStrike, tollOfPassing, greatRing,
];
