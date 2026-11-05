import { BALANCE } from '@/data/balanceConstants';
import { AfflictionType, AuraType, HeroSkill, SkillTargetType } from '@/models/types';

/**
 * The Beetle's skills — the Monk's plate path, the bodyguard
 * (the private project notes, "Beetle"). Rules too particular to be a field live
 * in `systems/combat/beetle.ts`.
 *
 * **Every cost is chi**, authored as the rank-two value. The signature costs chi
 * too: a free signature would always beat a Basic Attack and the chi loop would
 * never turn (60 pool, +5 a turn, +20 a swing). Cadences are spelled as
 * `cooldown` one lower than the plan's words: "every other turn" is 1, "every
 * third turn" is 2.
 *
 * **Every Barrier the Beetle grants is a factor of its own defences**, Physical +
 * Magic (`scaling: 'defense'` on the entry), read as it is laid. The Barrier
 * skills climb their own rung curve (`perRank.barrierScale`,
 * `BALANCE.BEETLE.BARRIER_RANK_SCALE`), steeper than the global one.
 */

const TREE = 5;
const B = BALANCE.BEETLE;

/** The carapace's olive, the path colour (`MASTERY_COLOR.beetle`). */
const BEETLE_OLIVE = '#9aac46';
/** The amber of the shell's gems, for what the Beetle lays on others. */
const BEETLE_AMBER = '#e0a83c';

/**
 * The signature. A staff blow that banks a Carapace charge on the Beetle, up to
 * three (`beetle.bankedCarapace`); each is Physical Defense, and a full set soaks
 * the next hostile blow whole and is spent (`damageFunnel.takeDamage`). The charge
 * is banked by the cast, dodged or not, like the chi a Basic Attack refills.
 * Hardened Shell strikes harder with it (`beetle.beetleStrikeMultiplier`).
 */
export const ironCarapace: HeroSkill = {
  id: 'iron_carapace',
  targetType: SkillTargetType.Single, range: 1, damage: 1.21,
  unlockLevel: TREE, manaCost: BALANCE.CHI.SIGNATURE, vfxColor: BEETLE_OLIVE, vfxAftermath: 'dust',
  // Borrows the Bulwark's shield blow until the Beetle's pictures are drawn
  icon: 'provoking_strike',
};

/**
 * A three-hex arc in front of the Beetle (`Arc`, depth 1): every enemy hit is
 * shoved a hex and blunted for its next turn (an Attack Down of two ticks is one
 * turn of the victim's: it ticks at the start of each of its turns).
 */
export const hornSweep: HeroSkill = {
  id: 'horn_sweep',
  targetType: SkillTargetType.Arc, range: 1, aoeRadius: 1, damage: 1.21,
  pushDistance: 1,
  appliesEffect: { type: AfflictionType.AttackDown, magnitude: B.HORN_SWEEP_ATTACK_DOWN, duration: 2 },
  unlockLevel: TREE, manaCost: 20, cooldown: 1, vfxColor: BEETLE_OLIVE, vfxKind: 'arc', vfxAftermath: 'dust',
  icon: 'antler_charge',
};

/**
 * What Carapace Leap fires when its ward is struck: a dash to a free hex beside
 * the ward, and a Barrier on each of the two. The ward's comes from the aura
 * entry (the footprint is the ward), the Beetle's from the `selfOnly` one, which
 * lands on the caster wherever the footprint is.
 */
const carapaceLeapAnswer: HeroSkill = {
  id: 'carapace_leap_answer',
  targetType: SkillTargetType.Single, range: B.LEAP_REACH,
  targetSide: 'ally',
  selfMove: { kind: 'dash', range: B.LEAP_REACH },
  appliesEffect: [
    { type: AuraType.Barrier, magnitude: B.LEAP_BARRIER, duration: B.LEAP_BARRIER_TURNS, scaling: 'defense' },
    { type: AuraType.Barrier, magnitude: B.LEAP_BARRIER, duration: B.LEAP_BARRIER_TURNS, scaling: 'defense', selfOnly: true },
  ],
  unlockLevel: TREE, manaCost: 0, vfxColor: BEETLE_AMBER, vfxKind: 'buff', vfxAftermath: 'dust',
};

/**
 * A Reaction on one named ally (`ReactionTrigger` `wardStruck`): cast on an ally
 * within four hexes, it spends the whole turn like every Reaction. For three of
 * the Beetle's turns, the first time that ally is struck, the Beetle leaps beside
 * them and both gain a Barrier. Once, for that ally only. Rooted, the Beetle
 * cannot leap and the Reaction waits.
 */
export const carapaceLeap: HeroSkill = {
  id: 'carapace_leap',
  targetType: SkillTargetType.Single, range: B.LEAP_CAST_RANGE,
  targetSide: 'ally',
  perRank: { nested: true, barrierScale: B.BARRIER_RANK_SCALE },
  reaction: {
    trigger: { kind: 'wardStruck' },
    duration: B.LEAP_TURNS,
    response: carapaceLeapAnswer,
  },
  unlockLevel: TREE, manaCost: 20, cooldown: 2, vfxColor: BEETLE_AMBER, vfxKind: 'buff', vfxPrelude: 'brace',
  icon: 'intercept',
};

/**
 * Seize an adjacent enemy, throw it three hexes straight away from the Beetle —
 * stopped short by the first unit, objective, solid ground or edge on the line
 * (`forcedMovement.traceForcedMove`) — and Stun it for its next turn. A target
 * that can be neither thrown nor stunned, a boss, takes the heavier blow instead
 * and nothing else (`immovableVariant`, `beetle.immovableTarget`).
 */
export const gripAndThrow: HeroSkill = {
  id: 'grip_and_throw',
  targetType: SkillTargetType.Single, range: 1, damage: 1.1,
  pushDistance: B.THROW_DISTANCE,
  appliesEffect: { type: AfflictionType.Stun, magnitude: 1, duration: 1 },
  immovableVariant: { damage: B.THROW_IMMOVABLE_DAMAGE, pushDistance: 0, appliesEffect: [] },
  unlockLevel: TREE, manaCost: 25, cooldown: 2, vfxColor: BEETLE_OLIVE, vfxPrelude: 'brace', vfxAftermath: 'dust',
  icon: 'bear_grapple',
};

/**
 * Every ally within two hexes, the Beetle included, gains a Barrier worth a
 * share of the Beetle's two defences (`SHELL_WALL_BARRIER`) for three turns. A self-centred `Ring`:
 * auras stay on the caster's side, and the caster stands in its own ring.
 */
export const shellWall: HeroSkill = {
  id: 'shell_wall',
  targetType: SkillTargetType.Ring, range: 0, aoeRadius: B.SHELL_WALL_RADIUS,
  perRank: { barrierScale: B.BARRIER_RANK_SCALE },
  appliesEffect: { type: AuraType.Barrier, magnitude: B.SHELL_WALL_BARRIER, duration: B.SHELL_WALL_TURNS, scaling: 'defense' },
  unlockLevel: TREE, manaCost: 25, cooldown: 2, vfxColor: BEETLE_AMBER, vfxKind: 'nova', vfxPrelude: 'brace', vfxAftermath: 'dust',
  icon: 'shield_wall',
};

// ── Capstones (40 chi each; exclusive) ────────────────────────────────────────

/**
 * What a Vengeful Shell fires once it has taken a blow: the staff at the
 * attacker, wherever it stands (`BALANCE.BEETLE.VENGEFUL_STRIKE_RANGE`). The leap
 * and the taking happened before the blow landed (`beetleMoves.interceptBlow`).
 */
const vengefulShellAnswer: HeroSkill = {
  id: 'vengeful_shell_answer',
  targetType: SkillTargetType.Single, range: B.VENGEFUL_STRIKE_RANGE, damage: B.VENGEFUL_STRIKE,
  targetSide: 'enemy',
  unlockLevel: TREE, manaCost: 0, vfxColor: BEETLE_OLIVE, vfxAftermath: 'dust',
};

/**
 * A two-turn Reaction that takes blows **before** they land (`ReactionTrigger`
 * `interceptAlly`). Whenever an enemy strikes an ally within two hexes of the
 * Beetle with a single-target blow, the Beetle leaps to a free hex beside the
 * ally and is struck instead, then answers the attacker for 1.2×. Up to two a
 * round; an area blow is never taken. Like every Reaction, it is the whole turn.
 */
export const vengefulShell: HeroSkill = {
  id: 'vengeful_shell',
  targetType: SkillTargetType.Self, range: 0,
  perRank: { nested: true, reach: B.VENGEFUL_REACH_PER_RANK },
  reaction: {
    trigger: { kind: 'interceptAlly', reach: B.VENGEFUL_REACH },
    duration: B.VENGEFUL_TURNS,
    shotsPerRound: B.VENGEFUL_ANSWERS,
    response: vengefulShellAnswer,
  },
  unlockLevel: TREE, manaCost: BALANCE.CHI.CAPSTONE, cooldown: 4, vfxColor: BEETLE_OLIVE, vfxKind: 'buff', vfxPrelude: 'brace',
  // Borrows the Riposte stance until the Beetle's pictures are drawn
  icon: 'riposte_stance',
};

/**
 * Slam the staff: the Beetle's hex and the six round it become the Bastion for
 * two of its turns — static ground, where it fell (`HeroSkill.bastion`). An ally
 * struck inside it takes half; the Beetle takes the other half down its own
 * funnel (`beetle.bastionCover`, `damageFunnel.damageUnit`). The Beetle's own
 * blows are never split.
 */
export const carapaceBastion: HeroSkill = {
  id: 'carapace_bastion',
  gesture: 'bastion',
  targetType: SkillTargetType.Ring, range: 0, aoeRadius: B.BASTION_RADIUS,
  perRank: { radius: B.BASTION_RADIUS_PER_RANK },
  bastion: { turns: B.BASTION_TURNS, share: B.BASTION_SHARE },
  unlockLevel: TREE, manaCost: BALANCE.CHI.CAPSTONE, cooldown: 4, vfxColor: BEETLE_AMBER, vfxKind: 'nova', vfxPrelude: 'brace', vfxAftermath: 'dust',
  // Borrows the Stoneshaper's ward until the Beetle's pictures are drawn
  icon: 'stone_ward',
};

/**
 * Dash to an ally within four hexes and trade places (`HeroSkill.swapsPlaces`,
 * `beetleMoves.swapPlaces`): the ally lands on the hex the Beetle left, both gain
 * a Barrier from the Beetle's defences, and every enemy beside the Beetle's new
 * hex is shoved a hex and blunted. Cover by extraction. Root refuses it.
 */
export const shellSwap: HeroSkill = {
  id: 'shell_swap',
  support: 'ward',
  targetType: SkillTargetType.Single, range: B.SWAP_RANGE,
  targetSide: 'ally',
  swapsPlaces: { push: B.SWAP_PUSH },
  perRank: { barrierScale: B.BARRIER_RANK_SCALE },
  appliesEffect: [
    { type: AuraType.Barrier, magnitude: B.SWAP_BARRIER, duration: B.SWAP_BARRIER_TURNS, scaling: 'defense' },
    { type: AfflictionType.AttackDown, magnitude: B.SWAP_ATTACK_DOWN, duration: 2 },
  ],
  unlockLevel: TREE, manaCost: BALANCE.CHI.CAPSTONE, cooldown: 3, vfxColor: BEETLE_AMBER, vfxKind: 'buff', vfxAftermath: 'dust',
  // Borrows Reposition until the Beetle's pictures are drawn
  icon: 'reposition',
};
