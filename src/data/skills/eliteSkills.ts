import { AfflictionType, HeroSkill, SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { armorBreaker, blight, groundSlam } from '@/data/skills/skillData';
import { FACTION_ELITE_SKILLS } from '@/data/skills/factionEliteSkills';
import { DRACONIC_HOST_SKILLS } from '@/data/skills/draconicHostSkills';
import { FALLEN_ORDER_SKILLS } from '@/data/skills/fallenOrderSkills';
import { YOKAI_SKILLS } from '@/data/skills/yokaiSkills';

/**
 * The elites' signature skills (`systems/combat/eliteKits` has the rules).
 *
 * Every one of them is enemy-only and has an id of its own, never a copy of the
 * shared skill it grows out of: the Cave Bear and the Bog Hulk both fight with
 * `ground_slam`, the Delve Pickhand and the Runeguard Sentinel with `armor_breaker`,
 * and a unique ability cannot be a number changed on a skill a dozen units share.
 *
 * Two of them are never in a kit. `mire_pull` and `geas_eruption` are the *payoffs*
 * of a warning: the Hulk's marsh drags, the Crone's curse erupts. They exist so a
 * warned attack has a skill to land as, the way the Heart's `whiteout_blast` does.
 */

// ── Orc Berserker: Pain Feast ────────────────────────────────────────────────

/**
 * The Slash the Berserker swaps in when its Rage is full. Never in the kit: the AI
 * trades it for `slash` for exactly one turn (`eliteKits.eliteSkillsFor`).
 */
export const painFeastSlash: HeroSkill = {
  id: 'pain_feast_slash',
  targetType: SkillTargetType.Arc,
  range: 2,
  aoeRadius: 2,
  damage: BALANCE.PAIN_FEAST_DAMAGE,
  damageType: 'physical',
  appliesEffect: {
    type: AfflictionType.Bleed,
    magnitude: BALANCE.PAIN_FEAST_BLEED,
    duration: BALANCE.PAIN_FEAST_BLEED_TURNS,
  },
  prepares: { interruptedBy: ['stun', 'silence', 'freeze'], windows: 1, answers: [{ kind: 'step' }] },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#ff4a2a',
  vfxKind: 'arc',
  // It leaves what it caught bleeding, and the ground says so
  vfxAftermath: 'spatter',
  // Borrows the Slash it replaces until it has a picture of its own
  icon: 'slash',
};

// ── Bog Hulk: Mire Undertow ──────────────────────────────────────────────────

/** Ground Slam, and the marsh it leaves. The slam strikes at once; the marsh is announced. */
export const mireUndertow: HeroSkill = {
  ...groundSlam,
  id: 'mire_undertow',
  cooldown: BALANCE.MIRE_COOLDOWN,
  vfxColor: '#7a9a4a',
  damageType: 'physical',
  icon: 'ground_slam',
};

/** The marsh itself: what lands when the window is over. Never in a kit. */
export const mirePull: HeroSkill = {
  id: 'mire_pull',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: BALANCE.MIRE_RADIUS,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#7a9a4a',
  vfxKind: 'nova',
  // The marsh churned where it dragged them
  vfxAftermath: 'dust',
  icon: 'ground_slam',
};

// ── Dark Mage: Mind Control ──────────────────────────────────────────────────

export const mindControl: HeroSkill = {
  id: 'mind_control',
  targetType: SkillTargetType.Single,
  range: BALANCE.MIND_CONTROL_RANGE,
  appliesEffect: {
    type: AfflictionType.MindControl,
    magnitude: 1,
    duration: BALANCE.MIND_CONTROL_TURNS,
  },
  prepares: { interruptedBy: ['stun', 'silence', 'freeze'], windows: 1, answers: [{ kind: 'step' }] },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: BALANCE.MIND_CONTROL_COOLDOWN,
  vfxColor: '#c24dff',
  vfxKind: 'bolt',
  icon: 'hex',
};

// ── Orc Warchief: Warband Order ──────────────────────────────────────────────

export const warbandOrder: HeroSkill = {
  id: 'warband_order',
  gesture: 'warhorn',
  targetType: SkillTargetType.Single,
  range: BALANCE.WARBAND_RANGE,
  appliesEffect: {
    type: AfflictionType.Warband,
    magnitude: 1,
    duration: BALANCE.WARBAND_TURNS,
  },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: BALANCE.WARBAND_COOLDOWN,
  vfxColor: '#ff7a3c',
  // Naming is aiming: the Warchief's line is drawn onto the hero before the mark
  // lands on them, so the party sees whom he chose before the warband turns. It was
  // a `bolt`, a projectile, for a skill that throws nothing.
  vfxKind: 'buff',
  vfxPrelude: 'aim',
  icon: 'rally',
};

// ── Coven Matriarch: Briar Claim ─────────────────────────────────────────────

/**
 * Her Blight, and the seed it plants beside one of the heroes it poisons. After a
 * full response window the seed becomes a Thrall — only if it still stands and the
 * hero is still poisoned by her. The rider is `eliteActions.afterEliteStrike`.
 */
export const briarBlight: HeroSkill = {
  ...blight,
  id: 'briar_blight',
  damageType: 'magic',
  icon: 'blight',
};

/** The warning a seed waits behind: what lands when its window is over. Never in a kit. */
export const briarClaim: HeroSkill = {
  id: 'briar_claim',
  targetType: SkillTargetType.Single,
  range: 3,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#6a9a3a',
  vfxKind: 'nova',
  vfxAftermath: 'motes',
  icon: 'blight',
};

// ── Ashwood Crone: Witch's Geas ──────────────────────────────────────────────

export const witchsGeas: HeroSkill = {
  id: 'witchs_geas',
  targetType: SkillTargetType.Single,
  range: BALANCE.GEAS_RANGE,
  appliesEffect: {
    type: AfflictionType.Geas,
    magnitude: 1,
    duration: BALANCE.GEAS_TURNS,
  },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: BALANCE.GEAS_COOLDOWN,
  vfxColor: '#9a5ac8',
  vfxKind: 'bolt',
  // The witch is seen drawing the curse before it flies
  vfxPrelude: 'gather',
  icon: 'dark_bolt',
};

/** The eruption a Geas raises round a spell's caster. Never in a kit. */
export const geasEruption: HeroSkill = {
  id: 'geas_eruption',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: BALANCE.GEAS_RADIUS,
  damage: BALANCE.GEAS_DAMAGE,
  scaling: 'magic',
  damageType: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#9a5ac8',
  vfxKind: 'nova',
  // The curse breaking open leaves its smoke round the one who cast
  vfxAftermath: 'smoke',
  icon: 'dark_bolt',
};

// ── Delve Overseer: Fracture ─────────────────────────────────────────────────

/** Armour Breaker, and the crack it leaves in the ground under a hero. */
export const fracturingBreaker: HeroSkill = {
  ...armorBreaker,
  id: 'fracturing_breaker',
  appliesEffect: [
    { type: AfflictionType.DefenseDown, magnitude: 5, duration: 2 },
    { type: AfflictionType.Fracture, magnitude: 1, duration: BALANCE.FRACTURE_TURNS },
  ],
  damageType: 'physical',
  icon: 'armor_breaker',
};

/**
 * Ground Slam, and what it does to a Fractured hero. Struck at once when nobody is
 * Fractured; with a mark on the board it is announced instead, with an eruption
 * drawn around every marked hero as well as round the Overseer
 * (`eliteActions.castFractureSlam`).
 */
export const fractureSlam: HeroSkill = {
  ...groundSlam,
  id: 'fracture_slam',
  damageType: 'physical',
  icon: 'ground_slam',
  // The ground it opened round them stays broken for a moment
  vfxAftermath: 'dust',
};

/** Every elite signature skill, for the suites that walk the whole skill roster. */
export const ELITE_SKILLS: HeroSkill[] = [
  ...FACTION_ELITE_SKILLS,
  // The Draconic Host's whole kit, regular and elite, lives in one file of its own
  ...DRACONIC_HOST_SKILLS,
  ...FALLEN_ORDER_SKILLS,
  ...YOKAI_SKILLS,
  painFeastSlash,
  mireUndertow, mirePull,
  mindControl,
  warbandOrder,
  briarBlight, briarClaim,
  witchsGeas, geasEruption,
  fracturingBreaker, fractureSlam,
];
