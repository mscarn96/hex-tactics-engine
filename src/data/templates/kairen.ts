import { AfflictionType, HeroSkill, SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import type { BossPassive, BossPhase } from '@/data/templates/aethelred';

/**
 * Jadeveil: Kairen, the Cloud-Crowned Dragon — the summit's boss
 * (the private project notes).
 *
 * A storm sky-serpent whose green orb has corrupted him: the storm is his, the jade
 * taint is the orb's. One boss unit on one hex — the engine has no multi-hex units —
 * rearing out of a loop of his own body on that hex.
 *
 * Three phases, each with its weather: **Gale** (the wind piles the party against the
 * downwind edge), **Thunderhead** (lightning that hurts and cleanses, and the Brood of the
 * Orb), **Jade Tempest** (the orb takes the storm: every orb move taints in full, and
 * broken Jade Shards are the cure). No Emerald Dragon move is reused.
 *
 * The skills are what the party reads; which he casts, where each warning lands and what
 * the storm does is `systems/combat/kairenRules`, `kairenActions` and `scripts/kairen`.
 * Each move wears a drawn picture until its own is made (`HeroSkill.icon`).
 */

export const KAIREN_STORM = '#bcd8ff';
export const KAIREN_JADE = '#3fe0a0';
export const KAIREN_GALE = '#d8e6ee';

const K = BALANCE.KAIREN;

const taint = (stacks: number) => ({ type: AfflictionType.JadeTaint, magnitude: stacks, duration: -1 });

// ── Every phase ──────────────────────────────────────────────────────────────

/** His ordinary blow: his body sweeps the hexes in front of his head and knocks back. */
export const coilLash: HeroSkill = {
  id: 'coil_lash',
  targetType: SkillTargetType.Arc,
  range: 1,
  aoeRadius: 1,
  damage: K.LASH_DAMAGE,
  pushDistance: K.LASH_PUSH,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: KAIREN_STORM, vfxAftermath: 'dust',
  vfxKind: 'arc',
  delivery: 'natural',
  icon: 'whirlwind',
};

/** The warned dive: up into the clouds, down along a line, landing Exposed at its far end. */
export const cloudDive: HeroSkill = {
  id: 'cloud_dive',
  contact: 'dragonLanding',
  targetType: SkillTargetType.Line,
  range: 12,
  damage: K.DIVE_DAMAGE,
  damageType: 'physical',
  prepares: { answers: [{ kind: 'step' }] },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: KAIREN_STORM, vfxAftermath: 'dust',
  vfxKind: 'meteor',
  delivery: 'natural',
  icon: 'skyfall',
};

// ── Phase 1: Gale ────────────────────────────────────────────────────────────

/**
 * Gale and Downdraft, one warning: the wind pushes every body along the shown
 * direction, then the downdraft strikes the downwind edge where the wind piled them.
 */
export const galeDowndraft: HeroSkill = {
  id: 'gale_downdraft',
  targetType: SkillTargetType.Ring,
  range: 0,
  damage: K.DOWNDRAFT_DAMAGE,
  damageType: 'physical',
  prepares: { everyone: true, answers: [{ kind: 'step' }] },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: KAIREN_GALE, vfxAftermath: 'dust',
  vfxKind: 'quake',
  delivery: 'natural',
  contact: 'gale',
  icon: 'cyclone',
};

/** The orb's ordinary bolt: one hero, and a stack of Jade Taint. */
export const orbBolt: HeroSkill = {
  id: 'orb_bolt',
  spell: 'jade',
  targetType: SkillTargetType.Single,
  range: K.ORB_BOLT_RANGE,
  damage: K.ORB_BOLT_DAMAGE,
  scaling: 'magic',
  damageType: 'magic',
  appliesEffect: taint(1),
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: KAIREN_JADE, vfxThemed: true,
  vfxKind: 'bolt',
  delivery: 'spell',
  icon: 'plasma_orb',
};

// ── Phase 2: Thunderhead ─────────────────────────────────────────────────────

/** The storm's marks: lightning strikes them on his next turn. It hurts, and it cleanses Taint. */
export const thunderhead: HeroSkill = {
  id: 'thunderhead',
  targetType: SkillTargetType.Ring,
  range: 0,
  damage: K.THUNDER_DAMAGE,
  scaling: 'magic',
  damageType: 'magic',
  prepares: { everyone: true, answers: [{ kind: 'step' }] },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: KAIREN_STORM,
  vfxKind: 'lightning',
  delivery: 'spell',
  icon: 'thunderbolt',
};

/** The orb's judgement on every hero, multiplied by the Taint they carry. */
export const verdantJudgement: HeroSkill = {
  id: 'verdant_judgement',
  spell: 'jade',
  targetType: SkillTargetType.Ring,
  range: 0,
  damage: K.VERDANT_BASE,
  scaling: 'magic',
  damageType: 'magic',
  prepares: { everyone: true, answers: [{ kind: 'cleanse' }] },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: KAIREN_JADE, vfxThemed: true,
  vfxKind: 'lightning',
  delivery: 'spell',
  icon: 'judgement',
};

/** The summon: wyrmlings out of the clouds, whose bites taint. */
export const broodOfTheOrb: HeroSkill = {
  id: 'brood_of_the_orb',
  support: 'summon',
  targetType: SkillTargetType.Self,
  range: 0,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: KAIREN_JADE,
  vfxKind: 'nova',
  delivery: 'spell',
  icon: 'raise_dead',
};

/** A brood wyrmling's bite: small, and a stack of Jade Taint. Never on Kairen's bar. */
export const broodBite: HeroSkill = {
  id: 'brood_bite',
  contact: 'bite',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.0,
  damageType: 'physical',
  appliesEffect: taint(1),
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: KAIREN_JADE,
  delivery: 'natural',
  icon: 'bite',
};

// ── Phase 3: Jade Tempest ────────────────────────────────────────────────────

/** Orb Bolt once the orb has the storm: the full three stacks at once. */
export const jadeOrbBolt: HeroSkill = {
  ...orbBolt,
  id: 'jade_orb_bolt',
  appliesEffect: taint(K.TAINT_CAP),
};

/** The ring around him: damage, full Taint, and two Jade Shards left on the board. */
export const orbNova: HeroSkill = {
  id: 'orb_nova',
  spell: 'jade',
  targetType: SkillTargetType.Ring,
  range: 0,
  damage: K.NOVA_DAMAGE,
  scaling: 'magic',
  damageType: 'magic',
  appliesEffect: taint(K.TAINT_CAP),
  prepares: { everyone: true, answers: [{ kind: 'step' }] },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: KAIREN_JADE, vfxThemed: true,
  vfxKind: 'nova',
  delivery: 'spell',
  icon: 'arcane_burst',
};

/** What a broken Jade Shard does to the hero who broke it. Never on a bar. */
export const shardBurst: HeroSkill = {
  id: 'shard_burst',
  spell: 'jade',
  targetType: SkillTargetType.Single,
  range: 12,
  damage: K.THUNDER_DAMAGE,
  scaling: 'magic',
  damageType: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: KAIREN_JADE,
  vfxKind: 'nova',
  delivery: 'spell',
  icon: 'bone_shards',
};

export const KAIREN_GALE_SKILLS: HeroSkill[] = [coilLash, orbBolt, cloudDive, galeDowndraft];
export const KAIREN_THUNDER_SKILLS: HeroSkill[] = [coilLash, orbBolt, cloudDive, thunderhead, verdantJudgement, broodOfTheOrb];
export const KAIREN_TEMPEST_SKILLS: HeroSkill[] = [coilLash, jadeOrbBolt, cloudDive, orbNova, verdantJudgement, broodOfTheOrb];
/** Struck by his script and never on his bar. */
export const KAIREN_FOLLOW_UPS: HeroSkill[] = [shardBurst, broodBite];

// ── Passives and phases ──────────────────────────────────────────────────────

export const KAIREN_PASSIVES: BossPassive[] = [
  { id: 'kairen_gale' },
  { id: 'kairen_thunderhead' },
  { id: 'kairen_tempest' },
];

export const KAIREN_PHASES: BossPhase[] = [
  {
    id: 'kairen_gale',
    threshold: 1.0,
    skills: KAIREN_GALE_SKILLS,
    color: KAIREN_GALE,
    presence: 1,
    passive: KAIREN_PASSIVES[0],
  },
  {
    id: 'kairen_thunderhead',
    threshold: 0.66,
    skills: KAIREN_THUNDER_SKILLS,
    color: KAIREN_STORM,
    vfx: { kind: 'lightning', scale: 1.8 },
    presence: 1.05,
    passive: KAIREN_PASSIVES[1],
  },
  {
    id: 'kairen_tempest',
    threshold: 0.33,
    skills: KAIREN_TEMPEST_SKILLS,
    color: KAIREN_JADE,
    vfx: { kind: 'nova', scale: 2 },
    presence: 1.1,
    passive: KAIREN_PASSIVES[2],
  },
];
