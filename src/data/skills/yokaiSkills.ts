import { AfflictionType, HeroSkill, SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';

/**
 * The Yokai of the low forest (the private project notes): Jadeveil's
 * bands 0–2, "nothing here is what it looks like".
 *
 * The rank and file are ordinary skills. The Jorōgumo's web volley and the bite it
 * buys are hers alone (`systems/combat/yokaiKits` has the rules, `yokaiActions` puts
 * them on the board, `scripts/yokai` turns her cycle): the bite is only ever the
 * *payoff* of a web that was left standing, so it never sits in a kit and lands
 * through the shared resolver, where a hero's Dodge, defence and crit answer it.
 *
 * Every single-target cooldown skill here out-damages its owner's at-will, because the
 * enemy AI scores damage and nothing else (`frozenNorthFactions.test.ts` holds the same
 * rule for the frozen north): a Kappa's grapple or a Kitsune's hush that scored below
 * the swing beside it would never be pressed and its status would never land.
 */

// ── Kodama ───────────────────────────────────────────────────────────────────

/**
 * The chaff's only blow, and its lesson: it shoves. A band-0 party learns from the
 * first fight that where it stands is something the enemy can change.
 */
export const kodamaRattle: HeroSkill = {
  id: 'kodama_rattle',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 0.7,
  damageType: 'physical',
  pushDistance: 1,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#b8d890',
  vfxKind: 'slash',
  delivery: 'natural',
  icon: 'stone_fist',
};

// ── Kappa ────────────────────────────────────────────────────────────────────

export const shellBash: HeroSkill = {
  id: 'shell_bash',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 0.9,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#6a9a5a',
  vfxKind: 'slash',
  delivery: 'blunt',
  icon: 'stone_fist',
};

/** The grapple: a heavier hold that sometimes keeps you there (Root, two turns). */
export const kappaGrapple: HeroSkill = {
  id: 'kappa_grapple',
  contact: 'mire',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.1,
  damageType: 'physical',
  appliesEffect: { type: AfflictionType.Root, magnitude: 1, duration: 2, chance: BALANCE.KAPPA_ROOT_CHANCE },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#4a8a8a', vfxAftermath: 'venom',
  vfxKind: 'slash',
  delivery: 'natural',
  icon: 'mire_grasp',
};

// ── Tanuki ───────────────────────────────────────────────────────────────────

/** Its at-will. The trick is its passive (`tanukiTrick`): struck, it is gone from sight. */
export const bellySlam: HeroSkill = {
  id: 'belly_slam',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.0,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#a07a4a',
  vfxKind: 'slash',
  delivery: 'blunt',
  icon: 'stone_fist',
};

// ── Onibi ────────────────────────────────────────────────────────────────────

/** Fire that stacks: every throw is another Burn on the pile. */
export const foxfire: HeroSkill = {
  id: 'foxfire',
  spell: 'fire',
  targetType: SkillTargetType.Single,
  range: 4,
  damage: 0.7,
  damageType: 'magic',
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.Burn, magnitude: 0.3, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#6ad0ff', vfxAftermath: 'embers',
  vfxKind: 'bolt',
  icon: 'ignite',
};

// ── Kitsune ──────────────────────────────────────────────────────────────────

export const foxFlame: HeroSkill = {
  id: 'fox_flame',
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.8,
  damageType: 'magic',
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#ffb070',
  vfxKind: 'bolt',
  icon: 'arcane_bolt',
};

/** Silence, and then she is somewhere else: the hush ends with a blink two hexes away. */
export const kitsuneHush: HeroSkill = {
  id: 'kitsune_hush',
  targetType: SkillTargetType.Single,
  range: 4,
  damage: 1.0,
  damageType: 'magic',
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.Silence, magnitude: 1, duration: 2 },
  selfMove: { kind: 'retreat', range: 2 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 3,
  vfxColor: '#e0a0ff', vfxAftermath: 'smoke',
  vfxKind: 'bolt',
  icon: 'silencing_depths',
};

// ── Nue ──────────────────────────────────────────────────────────────────────
//
// The roaming elite since the shrine campaign: a chimera in a black thundercloud. Its
// two passives (`nueThundercloud`, `nueSerpentTail`) are played at its turn start by the
// Yokai script (`yokaiActions.beginNueTurn`); Black Thunder's hiding is laid after the
// strike (`yokaiActions.cloakNue`).

/** Its at-will: the tiger's claws. */
export const nueClaws: HeroSkill = {
  id: 'nue_claws',
  contact: 'claw',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.0,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#e89a3a',
  vfxKind: 'slash',
  delivery: 'natural',
  icon: 'venom_bite',
};

/**
 * The cloud breaks over everyone beside it, and closes again over the Nue: it is in
 * Stealth until its next turn, out of reach of anything aimed at it alone.
 */
export const nueBlackThunder: HeroSkill = {
  id: 'nue_black_thunder',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: 1,
  damage: BALANCE.NUE.THUNDER_DAMAGE,
  damageType: 'magic',
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  cooldown: BALANCE.NUE.THUNDER_COOLDOWN,
  vfxColor: '#f2e46a', vfxAftermath: 'static',
  vfxKind: 'nova',
  icon: 'thunderbolt',
};

/** The snake tail's strike on the hero standing behind it, at its turn start. Never in a kit. */
export const nueSerpentStrike: HeroSkill = {
  id: 'nue_serpent_strike',
  contact: 'bite',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: BALANCE.NUE.TAIL_DAMAGE,
  damageType: 'physical',
  appliesEffect: { type: AfflictionType.Poison, magnitude: BALANCE.NUE.TAIL_POISON, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#6ac04a', vfxAftermath: 'venom',
  vfxKind: 'slash',
  delivery: 'natural',
  icon: 'venom_bite',
};

// ── Jorōgumo ─────────────────────────────────────────────────────────────────

/** Her at-will: a bite that leaves a dose of Poison behind. */
export const venomFangs: HeroSkill = {
  id: 'venom_fangs',
  contact: 'bite',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.0,
  damageType: 'physical',
  appliesEffect: { type: AfflictionType.Poison, magnitude: 0.3, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#9ad04a', vfxAftermath: 'venom',
  vfxKind: 'slash',
  delivery: 'natural',
  icon: 'venom_bite',
};

/** Spat silk at range that pins the target for 2 turns. */
export const silkSnare: HeroSkill = {
  id: 'silk_snare',
  gesture: 'spit', contact: 'web',
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 1.1,
  damageType: 'physical',
  appliesEffect: { type: AfflictionType.Root, magnitude: 1, duration: 2 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#e8e4d0',
  vfxKind: 'bolt',
  delivery: 'natural',
  icon: 'web',
};

/**
 * Her signature: the web volley. It strikes nobody; it wraps heroes in webs that can be
 * cut (`yokaiActions.castWebVolley`) and announces the bite. Taken by her script, which
 * picks who is webbed.
 */
export const jorogumoWeb: HeroSkill = {
  id: 'jorogumo_web',
  gesture: 'spit', contact: 'web',
  targetType: SkillTargetType.Self,
  range: BALANCE.JOROGUMO_WEB_RANGE,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#f0ecd8',
  vfxKind: 'bolt',
  icon: 'web',
};

/** What lands on a hero a web still holds. Never in a kit. */
export const jorogumoBite: HeroSkill = {
  id: 'jorogumo_bite',
  contact: 'bite',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: BALANCE.JOROGUMO_BITE_DAMAGE,
  damageType: 'physical',
  appliesEffect: { type: AfflictionType.Poison, magnitude: BALANCE.JOROGUMO_BITE_POISON, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#c8f04a', vfxAftermath: 'venom',
  vfxKind: 'slash',
  delivery: 'natural',
  icon: 'venom_bite',
};

// Jadeveil: Silk Hollow / Yokai — the canopy weaver's attack while she hangs
/** From the canopy: venom on any hero below. Her attack between volleys while she hangs. */
export const canopyVenom: HeroSkill = {
  id: 'canopy_venom',
  gesture: 'spit', contact: 'acid',
  targetType: SkillTargetType.Single,
  range: BALANCE.JOROGUMO_WEAVER.VENOM_RANGE,
  damage: BALANCE.JOROGUMO_WEAVER.VENOM_DAMAGE,
  damageType: 'physical',
  appliesEffect: { type: AfflictionType.Poison, magnitude: BALANCE.JOROGUMO_WEAVER.VENOM_POISON, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#9ad04a', vfxAftermath: 'venom',
  vfxKind: 'bolt',
  delivery: 'natural',
  icon: 'venom_bite',
};

/** Every Yokai skill, for the suites that walk the whole roster. */
export const YOKAI_SKILLS: HeroSkill[] = [
  kodamaRattle,
  shellBash, kappaGrapple,
  bellySlam,
  foxfire,
  foxFlame, kitsuneHush,
  nueClaws, nueBlackThunder, nueSerpentStrike,
  venomFangs, silkSnare, jorogumoWeb, jorogumoBite, canopyVenom,
];
