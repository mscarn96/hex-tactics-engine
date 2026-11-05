import { HeroSkill, SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import type { BossPassive, BossPhase } from '@/data/templates/aethelred';

/**
 * The Heart of Winter — the ice lair's boss, in the kit
 * the private project notes agreed.
 *
 * Kept out of `skillData.ts` for the reason the other bosses' kits are: these are
 * its alone. The skills are what the party *reads* — names, shapes, damage and
 * the warnings they raise. Which it casts, where each warning lands and what
 * breaking an anchor does is `systems/combat/heartScript` and `heartActions`.
 *
 * Two phases. **Chained**: three Blood-Iron anchors soak 99 / 66 / 33% of what it
 * takes, and Icebound Reprisal exploits them. **Unbound**: the restraints are gone,
 * it hits a fifth harder, and Whiteout Convergence replaces Reprisal. Splintering
 * Pulse and Creeping Winter belong to both. There is no summon and no Glacial Tomb.
 *
 * Each move wears an existing picture until its own is drawn
 * (`assets/icons/iconMap.ts`).
 */

/** The objectives the fight places: the anchors that hold it, and the spires of its Convergence. */
export const ANCHOR_KIND = 'blood_iron_anchor';
export const SPIRE_KIND = 'ice_spire';

const FROST = '#7fe4ff';
const WINTER_WHITE = '#dff6ff';
const BLOOD_IRON = '#c02a3a';

// ── The repeatable move ──────────────────────────────────────────────────────

/**
 * Splintering Pulse: a crystal splinter at one hero, and a fracture that carries on
 * to the hex directly behind them. Instant, no cooldown. The script decides the
 * secondary hex and whether ice under the target shatters; this is the picture.
 */
export const splinteringPulse: HeroSkill = {
  id: 'splintering_pulse',
  gesture: 'crystalPulse', contact: 'crystal',
  targetType: SkillTargetType.Single,
  range: BALANCE.HEART_PULSE_RANGE,
  damage: BALANCE.HEART_PULSE_DAMAGE,
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: FROST, vfxAftermath: 'rime',
  vfxKind: 'bolt',
  delivery: 'natural',
  icon: 'frost_lance',
};

/** The second blow of a Pulse: never on its bar. */
export const splinteringFracture: HeroSkill = {
  id: 'splintering_fracture',
  targetType: SkillTargetType.Single,
  range: 8,
  damage: BALANCE.HEART_PULSE_FRACTURE,
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: FROST, vfxAftermath: 'rime',
  vfxKind: 'bolt',
  icon: 'frost_lance',
};

// ── The signatures ───────────────────────────────────────────────────────────

/**
 * Creeping Winter: half the arena's clear hexes, nearest the party, are marked now.
 * When the party has had its turn each erupts for damage to a hero standing there
 * and freezes over — ground that costs one extra movement point to enter.
 */
export const creepingWinter: HeroSkill = {
  id: 'creeping_winter',
  spell: 'frost',
  targetType: SkillTargetType.Ring,
  range: 0,
  damage: BALANCE.HEART_WINTER_DAMAGE,
  scaling: 'magic',
  prepares: { everyone: true, answers: [{ kind: 'step' }, { kind: 'shelter', besideObjective: ANCHOR_KIND }] },
  cooldown: BALANCE.HEART_WINTER_COOLDOWN,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: WINTER_WHITE, vfxAftermath: 'rime',
  vfxKind: 'quake',
  icon: 'blizzard',
};

/**
 * Icebound Reprisal (chained phase): it strains against one anchor and marks the
 * line between them. When the party has had its turn the chain snaps taut for
 * damage to everyone on the line, and the Heart gains a Barrier. Destroying that
 * anchor first cancels both and costs the Heart a share of its health.
 */
export const iceboundReprisal: HeroSkill = {
  id: 'icebound_reprisal',
  spell: 'frost',
  targetType: SkillTargetType.Line,
  range: 8,
  damage: BALANCE.HEART_REPRISAL_DAMAGE,
  scaling: 'magic',
  prepares: { answers: [{ kind: 'step' }, { kind: 'cancel', objective: ANCHOR_KIND, graded: true }] },
  cooldown: BALANCE.HEART_REPRISAL_COOLDOWN,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: BLOOD_IRON, vfxAftermath: 'rime',
  vfxKind: 'bolt',
  icon: 'cold_snap',
};

/**
 * Whiteout Convergence (unbound phase): up to eight ice spires rise, each marking a blast
 * around itself. Break a spire and its blast is cancelled and the Heart takes a
 * share of its health; break all of them and its guard is torn open.
 */
export const whiteoutConvergence: HeroSkill = {
  id: 'whiteout_convergence',
  targetType: SkillTargetType.Self,
  range: 0,
  damage: BALANCE.HEART_CONVERGENCE_DAMAGE,
  scaling: 'magic',
  prepares: { everyone: true, answers: [{ kind: 'step' }, { kind: 'cancel', objective: SPIRE_KIND }] },
  cooldown: BALANCE.HEART_CONVERGENCE_COOLDOWN,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: FROST, vfxAftermath: 'rime',
  vfxKind: 'nova',
  icon: 'blizzard',
};

/** One spire's blast: never on its bar, run once per spire standing when the warning lands. */
export const whiteoutBlast: HeroSkill = {
  id: 'whiteout_blast',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: BALANCE.HEART_CONVERGENCE_RADIUS,
  damage: BALANCE.HEART_CONVERGENCE_DAMAGE,
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: FROST, vfxAftermath: 'rime',
  vfxKind: 'nova',
  icon: 'frostbite',
};

export const HEART_CHAINED_SKILLS: HeroSkill[] = [splinteringPulse, creepingWinter, iceboundReprisal];
export const HEART_UNBOUND_SKILLS: HeroSkill[] = [splinteringPulse, creepingWinter, whiteoutConvergence];
/** What the Heart casts for itself; the follow-up blows are run by the landing. */
export const HEART_FOLLOW_UPS: HeroSkill[] = [splinteringFracture, whiteoutBlast];

// ── Passives and phases ──────────────────────────────────────────────────────

export const HEART_PASSIVES: BossPassive[] = [
  { id: 'blood_iron_restraints' },
  { id: 'torn_free' },
];

export const HEART_PHASES: BossPhase[] = [
  {
    id: 'heart_chained',
    threshold: 1.0,
    skills: HEART_CHAINED_SKILLS,
    color: BLOOD_IRON,
    presence: 1,
    passive: HEART_PASSIVES[0],
  },
  {
    id: 'heart_unbound',
    threshold: BALANCE.HEART_RELEASE_THRESHOLD,
    stats: { attack: BALANCE.HEART_UNBOUND_POWER, magic: BALANCE.HEART_UNBOUND_POWER },
    skills: HEART_UNBOUND_SKILLS,
    color: FROST,
    vfx: { kind: 'nova', scale: 1.8 },
    presence: 1.1,
    passive: HEART_PASSIVES[1],
  },
  // Tier 5 only (`fromTier`): at a quarter health two anchors rise and chain it again
  // (`bossRegistry`'s `raise`). It keeps the unbound phase's power and casts the chained kit.
  {
    id: 'heart_rechained',
    threshold: BALANCE.HEART_SEAL.RECHAIN_AT,
    stats: { attack: BALANCE.HEART_UNBOUND_POWER, magic: BALANCE.HEART_UNBOUND_POWER },
    skills: HEART_CHAINED_SKILLS,
    color: BLOOD_IRON,
    vfx: { kind: 'nova', scale: 1.4 },
    presence: 1.1,
    passive: HEART_PASSIVES[0],
    fromTier: 5,
  },
  // Torn from that chain by its last anchor (a release, never a health threshold: 0 is never
  // crossed alive), exposed as at the first release, with the unbound kit back.
  {
    id: 'heart_torn',
    threshold: 0,
    stats: { attack: BALANCE.HEART_UNBOUND_POWER, magic: BALANCE.HEART_UNBOUND_POWER },
    skills: HEART_UNBOUND_SKILLS,
    color: FROST,
    vfx: { kind: 'nova', scale: 1.8 },
    presence: 1.1,
    passive: HEART_PASSIVES[1],
    fromTier: 5,
  },
];
