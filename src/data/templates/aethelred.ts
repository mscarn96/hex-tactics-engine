import {
  AfflictionType,
  AuraType,
  HeroSkill,
  SkillTargetType,
  VfxKind,
} from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { StatMultipliers } from '@/systems/combat/forms';

/**
 * Aethelred the Obsidian Emperor — the only bespoke fight in the game, in the
 * three-phase form the private project notes agreed.
 *
 * Kept out of `skillData.ts` for the same reason `masterySkills.ts` is: these
 * are exclusive, and a shared file is where a tuning pass to a boss quietly
 * lands on a summon. **Every move here is his alone, including the repeatable
 * sword stroke** — there is no single-target fallback, and nothing he casts is
 * also on a hero's bar.
 *
 * The skills below are what the party *reads*: names, shapes, damage and the
 * statuses they leave. What makes the fight a sequence — which move comes next,
 * how a warning is built, the passives — is `systems/combat/bossScript`. A
 * generic "highest immediate damage" AI cannot execute a preparation, a linked
 * effect or a delayed payoff, so the script chooses and these describe.
 *
 * The three phases move from command, to collection, to self-destruction: the
 * sword and his symbols of authority first, then the orb that was made from the
 * realm he burned, then the cost of it.
 *
 * Skill ids keep the old nine's *pictures* until the new moves are drawn: each
 * borrows the nearest one through `icon`, the way the Basic Attack wears a
 * weapon's face. Nothing else of the old kit survives.
 */

const IMPERIAL_RED = '#c02028';
const ORB_RED = '#ff2a3a';
const BLACK_GLASS = '#3a2442';
const ECLIPSE = '#8a5ad0';

/** The whiff hook the Cleave names (`PreparedSpec.onWhiff`); its banner words are `skillText` `whiff.cleave`. */
export const CLEAVE_WHIFF = 'cleave';

// ── The shared action ────────────────────────────────────────────────────────

/**
 * The Emperor's Blade — what he does on an ordinary turn, in every phase.
 *
 * A short frontal sweep: everyone caught takes damage and Bleed, a second hit
 * refreshes the Bleed rather than piling it up (Bleed keeps the larger of the
 * two and the longer clock), and a hero standing alone is struck as surely as
 * three in a row. Facing matters because the arc does not follow a target.
 */
export const emperorsBlade: HeroSkill = {
  id: 'emperors_blade',
  targetType: SkillTargetType.Arc,
  range: 2,
  aoeRadius: 2,
  damage: BALANCE.AETHELRED_BLADE_DAMAGE,
  appliesEffect: {
    type: AfflictionType.Bleed,
    magnitude: BALANCE.AETHELRED_BLEED,
    duration: BALANCE.AETHELRED_BLEED_TURNS,
  },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: IMPERIAL_RED, vfxAftermath: 'spatter',
  vfxKind: 'arc',
  icon: 'ledger_strike',
};

// ── Phase 1 · The Emperor Commands ───────────────────────────────────────────

export const writOfSeizure: HeroSkill = {
  id: 'writ_of_seizure',
  targetType: SkillTargetType.Single,
  range: 6,
  // Duration 2 is one turn: effects tick at the start of the carrier's own
  // turn, so a 1 would be gone before they could choose anything.
  appliesEffect: { type: AfflictionType.Writ, magnitude: BALANCE.AETHELRED_WRIT_HP, duration: 2 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 3,
  vfxColor: IMPERIAL_RED, vfxAftermath: 'smoke',
  vfxKind: 'buff',
  icon: 'crimson_verdict',
};

export const imperialCleave: HeroSkill = {
  id: 'imperial_cleave',
  targetType: SkillTargetType.Arc,
  range: 3,
  aoeRadius: 3,
  damage: BALANCE.AETHELRED_CLEAVE_DAMAGE,
  pushDistance: 1,
  appliesEffect: {
    type: AfflictionType.Bleed,
    magnitude: BALANCE.AETHELRED_BLEED,
    duration: BALANCE.AETHELRED_BLEED_TURNS,
  },
  // The warning is the counterplay: step out of the wedge, or hold it behind a Barrier, Last Stand or
  // Immovable, which stops the blade (half the blow on the blocker alone, no push, no Bleed, the rest of
  // the wedge spared) and leaves him Exposed. A wedge nobody stands in charges the orb and, in phase 1,
  // raises a Standard where the sword fell (`scripts/aethelred.whiff`).
  prepares: {
    blockedBy: {
      share: BALANCE.AETHELRED_CLEAVE_BLOCK_SHARE,
      casterStatus: {
        type: AuraType.Exposed,
        magnitude: BALANCE.AETHELRED_CLEAVE_EXPOSED,
        duration: BALANCE.AETHELRED_CLEAVE_EXPOSED_TURNS,
      },
    },
    onWhiff: CLEAVE_WHIFF,
    answers: [{ kind: 'step' }],
  },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 4,
  vfxColor: IMPERIAL_RED, vfxAftermath: 'spatter',
  vfxKind: 'arc',
  icon: 'obsidian_sweep',
};

export const imperialStandards: HeroSkill = {
  id: 'imperial_standards',
  gesture: 'standard',
  targetType: SkillTargetType.Self,
  range: 0,
  places: {
    kind: 'imperial_standard',
    count: BALANCE.AETHELRED_STANDARDS,
    hpFraction: BALANCE.AETHELRED_STANDARD_HP,
    protection: BALANCE.AETHELRED_STANDARD_PROTECTION,
    areaResist: BALANCE.AETHELRED_STANDARD_AREA_RESIST,
    placement: 'front',
    shattersOnPhase: true,
    breakerBarrier: BALANCE.AETHELRED_STANDARD_BARRIER,
    backlash: BALANCE.AETHELRED_STANDARD_BACKLASH,
    backlashTierStep: BALANCE.AETHELRED_STANDARD_BACKLASH_TIER_STEP,
    onAllDestroyed: [
      { type: AfflictionType.DefenseDown, magnitude: BALANCE.AETHELRED_EXPOSED_DEFENSE, duration: 2 },
    ],
  },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 6,
  vfxColor: IMPERIAL_RED, vfxAftermath: 'dust',
  vfxKind: 'nova',
  icon: 'call_the_line',
};

// ── Phase 2 · The Orb Collects ───────────────────────────────────────────────

export const foreclosure: HeroSkill = {
  id: 'foreclosure',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: 0,
  damage: BALANCE.AETHELRED_FORECLOSURE_DAMAGE,
  scaling: 'magic',
  damageType: 'magic',
  // Each seal can be answered: stepped off (the orb takes a charge), paid by striking him from it, or paid in
  // blood by casting from it (`bossActions.applySealToll`, `afterForeclosureLanded`)
  prepares: { sealed: true, answers: [{ kind: 'step' }] },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: ORB_RED, vfxAftermath: 'dust',
  vfxKind: 'quake',
  spell: 'arcane',
  icon: 'sundering_spikes',
};

/** The same rule in the final phase — the party applying a learned answer under pressure. */
export const foreclosureFinal: HeroSkill = {
  ...foreclosure,
  // The same move, read differently: its words are `bossSkills.foreclosure_final.*`
  textId: 'foreclosure_final',
};

export const chainsOfTribute: HeroSkill = {
  id: 'chains_of_tribute',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: 0,
  damage: BALANCE.AETHELRED_CHAINS_DAMAGE,
  scaling: 'magic',
  damageType: 'magic',
  appliesEffect: { type: AfflictionType.Chained, magnitude: 1, duration: 3 },
  prepares: { answers: [{ kind: 'cleanse' }] },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 4,
  vfxColor: ORB_RED, vfxAftermath: 'smoke',
  vfxKind: 'buff',
  spell: 'arcane',
  icon: 'total_assessment',
};

export const collateralClaim: HeroSkill = {
  id: 'collateral_claim',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: BALANCE.AETHELRED_CLAIM_RADIUS,
  damage: BALANCE.AETHELRED_CLAIM_DAMAGE,
  scaling: 'magic',
  damageType: 'magic',
  prepares: { answers: [{ kind: 'step' }, { kind: 'cancel' }] },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 5,
  vfxColor: ORB_RED, vfxAftermath: 'smoke',
  vfxKind: 'nova',
  spell: 'arcane',
  icon: 'the_legion_answers',
};

// ── Phase 3 · The Empire Burns ───────────────────────────────────────────────

export const crownfall: HeroSkill = {
  id: 'crownfall',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: 0,
  damage: BALANCE.AETHELRED_CROWN_DAMAGE,
  scaling: 'magic',
  damageType: 'magic',
  // A hero holding a Barrier (Last Stand while it bites, Immovable) on a crown point takes part of it there
  prepares: { heldBy: { share: BALANCE.AETHELRED_CROWN_BLOCK_SHARE }, answers: [{ kind: 'step' }, { kind: 'hold' }] },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 4,
  vfxColor: BLACK_GLASS, vfxAftermath: 'smoke',
  vfxKind: 'meteor',
  spell: 'arcane',
  icon: 'interest_due',
};

export const realmThatBurned: HeroSkill = {
  id: 'the_realm_that_burned',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: BALANCE.AETHELRED_REALM_RADIUS,
  damage: BALANCE.AETHELRED_REALM_DAMAGE,
  scaling: 'magic',
  damageType: 'magic',
  prepares: { answers: [{ kind: 'step' }] },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 5,
  vfxColor: ORB_RED, vfxAftermath: 'embers',
  vfxKind: 'nova',
  spell: 'arcane',
  icon: 'blood_iron_ward',
};

// ── Overturn · the table flipped ─────────────────────────────────────────────

/**
 * Overturn (the boss feel pass): not a move he chooses but the sore loser's answer to losing. As each phase turns,
 * and once more near the end, he heaves the ground and every hero is thrown (`bossScript.overturnThrows`,
 * `bossActions.overturn`). This is the blow each landing hero takes: light, and his alone. Never on his bar.
 */
export const overturn: HeroSkill = {
  id: 'overturn',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: 0,
  damage: BALANCE.AETHELRED_OVERTURN_DAMAGE,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: IMPERIAL_RED, vfxAftermath: 'dust',
  vfxKind: 'quake',
  icon: 'sundering_spikes',
};

export const AETHELRED_SKILLS: HeroSkill[] = [
  emperorsBlade,
  writOfSeizure, imperialCleave, imperialStandards,
  foreclosure, chainsOfTribute, collateralClaim,
  crownfall, realmThatBurned, foreclosureFinal,
];

/**
 * His passives, by phase.
 *
 * These are *signature* rules rather than entries in the shared `PassiveId`
 * vocabulary — each belongs to this fight alone — so they live here as an id for
 * the card's text (`bossPassiveName`, `bossPassiveDescription`) and as code in
 * `bossScript`. Undying is gone: a boss that survives one lethal blow is a boss
 * whose health bar lies.
 */
export interface BossPassive {
  /** The key of its words: `bossSkills.passive.<id>.name` / `.description`. */
  id: string;
}

export const AETHELRED_PASSIVES: BossPassive[] = [
  { id: 'legion_responds' },
  { id: 'blood_in_the_ledger' },
  { id: 'tithe_on_mercy' },
];

// ── The three phases ─────────────────────────────────────────────────────────

export interface BossPhase {
  /**
   * The key of its words (`bossSkills.phase.<id>.*`, read through `phaseName`,
   * `phaseAnnounce` and `phaseRule`): the name, the line announced in the combat
   * log the moment it begins, and the rule it teaches — what the party is told the
   * phase *is* before its next action, in a line a landscape phone can hold.
   */
  id: string;
  /**
   * Fraction of max HP at or below which this phase begins.
   *
   * Doubles as the phase's **HP ceiling** once entered — see `combatStore`.
   * Phase 0's threshold of 1.0 is what makes that uniform: the opening phase
   * caps at full health, which is where he already is.
   */
  threshold: number;
  stats?: StatMultipliers;
  skills: HeroSkill[];
  /** The phase's own colour — on the banner, the strip and the transition's picture. */
  color: string;
  /** The picture the transition makes; the first phase makes none. */
  vfx?: { kind: VfxKind; scale: number };
  /**
   * How large he stands in this phase, as a multiple of his authored model. He
   * grows into the fight: the sword, the orb, the eclipse each take more of the
   * arena than the last. Presentation only — the model is rebuilt to it, never
   * the hit boxes, which are hexes.
   */
  presence: number;
  /** The signature rule this phase runs on — what the unit card lists as his passive. */
  passive: BossPassive;
  /** The banner carries the phase's `announce` line above its rule: the boss speaks (Aethelred the sore loser). */
  voiced?: boolean;
  /**
   * Entering this phase leaves the fight's sequence alone: the warnings he has
   * raised still land, the rotation does not restart and cooldowns carry on.
   * The Troll Chieftain's Fury is a state he is in, not a new kit.
   */
  keepsScript?: boolean;
  /** A status laid on the boss for the rest of the fight when the phase begins. */
  aura?: { type: AuraType; magnitude: number };
  /**
   * The phase is a Seal tier's twist: a boss fought below this `challengeTier` never enters it,
   * and its fight ends in the phase before (the Heart's tier-5 chain).
   */
  fromTier?: number;
}

/**
 * Phases are Wildshape wearing different clothes — the same store write, via
 * `systems/forms.ts`. Two rules carry over unchanged, and here they are
 * load-bearing rather than merely tidy:
 *
 * - **No `maxHp` multiplier.** The phase triggers *are* HP thresholds, so
 *   rescaling max HP on entry would re-trigger the thing that caused it.
 * - **No `speed` multiplier.** `turnOrder` is sorted once at init.
 */
export const AETHELRED_PHASES: BossPhase[] = [
  {
    id: 'aethelred_commands',
    voiced: true,
    threshold: 1.0,
    skills: [emperorsBlade, writOfSeizure, imperialCleave, imperialStandards],
    color: IMPERIAL_RED,
    presence: 1,
    passive: AETHELRED_PASSIVES[0],
  },
  {
    id: 'aethelred_collects',
    voiced: true,
    threshold: 0.66,
    // He stops holding back rather than becoming someone else — the kit change
    // is the phase, and the numbers only nudge
    stats: { magic: 1.2, defense: 1.1 },
    skills: [emperorsBlade, foreclosure, chainsOfTribute, collateralClaim],
    color: ORB_RED,
    vfx: { kind: 'nova', scale: 1.4 },
    presence: 1.07,
    passive: AETHELRED_PASSIVES[1],
  },
  {
    id: 'aethelred_burns',
    voiced: true,
    threshold: 0.33,
    stats: { attack: 1.2, magic: 1.25, defense: 0.9 },
    skills: [emperorsBlade, crownfall, realmThatBurned, foreclosureFinal],
    color: ECLIPSE,
    vfx: { kind: 'meteor', scale: 1.6 },
    presence: 1.15,
    passive: AETHELRED_PASSIVES[2],
  },
];
