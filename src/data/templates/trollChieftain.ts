import {
  AfflictionType,
  AuraType,
  HeroSkill,
  SkillTargetType,
} from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import type { BossPassive, BossPhase } from '@/data/templates/aethelred';

/**
 * The Troll Chieftain / Bonebound Warlord — the Warren's boss, in the six-turn
 * form the private project notes agreed.
 *
 * Kept out of `skillData.ts` for the reason `aethelred.ts` is: these are his
 * alone, including the repeatable club stroke, and a shared file is where a
 * tuning pass to a boss quietly lands on a summon. The skills are what the party
 * *reads* — names, shapes, damage, the statuses they leave. Which one comes
 * next, where each warning lands and what Fury does with a turn is
 * `systems/combat/trollScript`.
 *
 * The cycle is fixed, and every third beat is the repeatable one: Farthest Prey,
 * Bonebreaker Sweep, Boundary Smash, Bonebreaker Sweep, Warren Collapse,
 * Bonebreaker Sweep. The old Regeneration passive is gone, because
 * healing every turn is the opposite of a fight that ends in Fury. What he does
 * recover is the price of a round nobody fought him in, and it is a rule of his
 * script rather than a passive (`trollActions.beginTrollTurn`).
 *
 * Each move borrows the Smash's picture through `HeroSkill.icon` until its own
 * is drawn, the way the Basic Attack wears a weapon's face.
 */

const WARLORD_RED = '#d94a2a';
const ROCK = '#9a7a52';
const FURY_RED = '#ff2a2a';

// ── The repeatable move ──────────────────────────────────────────────────────

/**
 * Bonebreaker Sweep — what he does on every third beat, and as the second action
 * of every Fury turn. A short frontal club arc: everyone caught takes damage and
 * one stack of a wound that takes Defence and never wears off. It is not a
 * single-target fallback — a hero standing alone in front of him is struck as
 * surely as three in a row, and facing matters because the arc does not follow.
 */
export const bonebreakerSweep: HeroSkill = {
  id: 'bonebreaker_sweep',
  targetType: SkillTargetType.Arc,
  range: 2,
  aoeRadius: 2,
  damage: BALANCE.TROLL_SWEEP_DAMAGE,
  appliesEffect: {
    type: AfflictionType.Wound,
    magnitude: BALANCE.TROLL_WOUND_DEFENSE,
    // Never expires: only a cleanse removes it
    duration: -1,
  },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: WARLORD_RED, vfxAftermath: 'dust',
  vfxKind: 'arc',
  icon: 'troll_smash',
};

// ── The three signatures ─────────────────────────────────────────────────────

/**
 * Farthest Prey. The footprint is the hero farthest from him, and the hexes
 * around them, marked now; he leaps in when the party has had its turn. The
 * script builds the footprint (`preyTarget`), so this skill's own shape is only
 * the radius the picture and the tooltip speak of.
 */
export const farthestPrey: HeroSkill = {
  id: 'farthest_prey',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: BALANCE.TROLL_PREY_RADIUS,
  damage: BALANCE.TROLL_PREY_DAMAGE,
  appliesEffect: {
    type: AfflictionType.Stun,
    magnitude: 1,
    duration: BALANCE.TROLL_PREY_STUN,
  },
  prepares: { answers: [{ kind: 'step' }] },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: WARLORD_RED, vfxAftermath: 'dust',
  // His body is the falling weight; only the landing shockwave is an effect.
  vfxKind: 'nova',
  icon: 'troll_smash',
};

/**
 * Boundary Smash: the club into the ground, and every hero within two hexes is
 * thrown away from him — toward the wall. Pushes resolve through the one forced
 * movement trace (`traceForcedMove`), so the landings the warning draws are the
 * landings that happen.
 */
export const boundarySmash: HeroSkill = {
  id: 'boundary_smash',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: BALANCE.TROLL_SMASH_RADIUS,
  damage: BALANCE.TROLL_SMASH_DAMAGE,
  pushDistance: BALANCE.TROLL_SMASH_PUSH,
  prepares: { answers: [{ kind: 'step' }, { kind: 'brace' }] },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: WARLORD_RED, vfxAftermath: 'dust',
  vfxKind: 'quake',
  icon: 'troll_smash',
};

/**
 * Warren Collapse. He brings the roof down on the densest knot of heroes: a
 * fixed footprint, marked now, that the rocks fall on only after every hero
 * standing in it has had a turn. **The weight is shared** (`split`): two heroes
 * under it take half each, one alone takes the whole roof. What lands on empty
 * ground becomes rubble that stands until his next Collapse.
 */
export const warrenCollapse: HeroSkill = {
  id: 'warren_collapse',
  contact: 'collapse',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: BALANCE.TROLL_COLLAPSE_RADIUS,
  damage: BALANCE.TROLL_COLLAPSE_DAMAGE,
  prepares: { split: true, answers: [{ kind: 'step' }] },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: ROCK, vfxAftermath: 'dust',
  vfxKind: 'quake',
  icon: 'troll_smash',
};

export const TROLL_SKILLS: HeroSkill[] = [
  bonebreakerSweep,
  farthestPrey,
  boundarySmash,
  warrenCollapse,
];

// ── Passives and phases ──────────────────────────────────────────────────────

export const TROLL_PASSIVES: BossPassive[] = [
  { id: 'bonebreak' },
  { id: 'fury' },
];

/**
 * Two phases, and the second is only a state he is in. **Entering Fury keeps the
 * script**: the six-turn cycle carries on from where it was, a warning he has
 * raised still lands and his cooldowns are untouched (`keepsScript`), because
 * Fury adds actions to the sequence rather than starting a new one. What the
 * phase machinery is used for is the part that is the same for every boss — the
 * banner, the strip, the transition's picture and sound, and standing larger.
 */
export const TROLL_PHASES: BossPhase[] = [
  {
    id: 'troll_warlord',
    threshold: 1.0,
    skills: TROLL_SKILLS,
    color: WARLORD_RED,
    presence: 1,
    passive: TROLL_PASSIVES[0],
  },
  {
    id: 'troll_fury',
    threshold: BALANCE.TROLL_FURY_THRESHOLD,
    skills: TROLL_SKILLS,
    color: FURY_RED,
    vfx: { kind: 'nova', scale: 1.5 },
    presence: 1.12,
    passive: TROLL_PASSIVES[1],
    keepsScript: true,
    aura: { type: AuraType.Fury, magnitude: BALANCE.TROLL_FURY_DAMAGE },
  },
];
