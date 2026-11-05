import { HeroSkill, SkillTargetType, AfflictionType, AuraType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { MARKSMAN_YELLOW } from '@/data/display/marksmanColors';

/**
 * Every skill that comes from a mastery tree.
 *
 * Separate from `skillData.ts` because that file holds the *shared* vocabulary —
 * skills used by heroes, enemies and summons alike, whose multipliers therefore
 * have to stay generic. Everything here belongs to exactly one path, so it can
 * be tuned to that path without a Fire Elemental quietly inheriting a buff meant
 * for an Arcanist.
 *
 * Tuning follows the same scale as `skillData.ts`: raw output before defence,
 * where `power` is `attack` or (with `scaling: 'magic'`) `magic`.
 *
 *   signature, at-will      ~13   (the path's staple, pressed most turns)
 *   tier 2–3 costed skill   ~17
 *   capstone                ~20   (or a large area, or a strong rider)
 *
 * `unlockLevel: 5` throughout: a tree skill is gated by the node that grants it,
 * not by a level threshold, and 5 is the earliest a path can be chosen at all.
 */

const TREE = 5;

// ═══ HUNTER ═════════════════════════════════════════════════════════════════

// ── Marksman — precision ──────────────────────────────────────────────────────

export const markTarget: HeroSkill = {
  id: 'mark_target',
  targetType: SkillTargetType.Single, range: 5, damage: 0.595,
  appliesEffect: { type: AfflictionType.Mark, magnitude: 0.4, duration: 4 },
  unlockLevel: TREE, manaCost: 0, vfxColor: MARKSMAN_YELLOW, vfxAftermath: 'motes', vfxKind: 'shot',
};

/**
 * Piercing Shot's replacement: a precision shot that keeps paying on a
 * scattered field, where a line almost never forms. One arrow, two bounces at
 * most, each to the nearest enemy within two hexes of the one before that has
 * not been hit yet, each at 70% of the hit before it. No repeat victims and no
 * second ricochet off a bounce's own kill.
 */
export const ricochetShot: HeroSkill = {
  id: 'ricochet_shot',
  targetType: SkillTargetType.Chain, range: 5, damage: 0.85, targetSide: 'enemy',
  chainJumps: 2, chainRange: 2, chainFalloff: 0.7,
  // Borrows the retired Piercing Shot's drawing until its own is made
  icon: 'piercing_shot',
  unlockLevel: TREE, manaCost: 12, cooldown: 2, vfxColor: MARKSMAN_YELLOW, vfxKind: 'ricochet',
};

/**
 * Concussive Shot: a blunt head that knocks the target two hexes straight away
 * from the Marksman. Driven into the arena's edge, rubble or another body before
 * the two hexes are spent, it is Stunned for a turn (`collisionEffect`).
 *
 * The playtest of 2026-10-13 retired Execute from this slot: a ranged finisher
 * gated on a narrower window than the Berserker's killed only what a Basic
 * Attack would have. The tree had nothing that made space when melee closed in,
 * and that is the job "from further than they can answer" was missing.
 * An Immovable boss is never shoved, so it is never stunned by the wall either.
 */
export const concussiveShot: HeroSkill = {
  id: 'concussive_shot',
  targetType: SkillTargetType.Single, range: 5, damage: 1.02,
  pushDistance: 2,
  collisionEffect: { type: AfflictionType.Stun, magnitude: 1, duration: 1 },
  // Borrows the retired Execute's drawing until its own is made
  icon: 'execute',
  unlockLevel: TREE, manaCost: 12, cooldown: 3, vfxColor: MARKSMAN_YELLOW, vfxAftermath: 'dust', vfxKind: 'shot',
};

/**
 * Aimed Shot, a manual two-turn shot (`HeroSkill.charge.aimed`).
 *
 * The first use picks one enemy and spends the turn aiming: nothing is dealt,
 * the mana is paid, and a yellow sight line ties the Marksman to it. On the next
 * regular turn the same button shoots that enemy, from wherever both now stand:
 * the hit is 1.2 / 1.6 / 2.0x Attack at four hexes by rung and scales with the
 * distance, so a target at nine hexes takes 2.25x the four-hex number. Moving
 * cancels it, and so do Stun, Silence, Taunt and the target falling; every
 * other skill, Basic Attack included, is locked while it stands.
 *
 * Range 9 is the arena's widest gap less one, so Longshot's +1 reaches the far
 * wall. The marked-target multiplier came down from 1.8 to 1.5, because the
 * distance curve now carries most of the payoff. The cooldown is three turns
 * from the release; it is started at the aim one turn longer, so a cancelled
 * aim also costs it.
 */
export const aimedShot: HeroSkill = {
  id: 'aimed_shot',
  targetType: SkillTargetType.Single, range: 9, targetSide: 'enemy',
  perRank: { nested: true },
  unlockLevel: TREE, manaCost: 26, cooldown: 3, vfxColor: MARKSMAN_YELLOW, vfxKind: 'buff', vfxPrelude: 'aim',
  charge: {
    aimed: true,
    release: {
      damage: 1.6, distanceScale: BALANCE.AIMED_SHOT_REFERENCE_DISTANCE,
      bonusVs: { condition: 'marked', multiplier: 1.5 },
      manaCost: 0, vfxKind: 'shot', vfxPrelude: 'aim', vfxAftermath: 'spatter',
    },
  },
};

/**
 * Rapid Fire — the window, not the shot.
 *
 * Applies no damage of its own on purpose: spending a turn to make the next
 * three better is the decision, and a skill that also hit would make taking it
 * free. The cooldown is longer than the duration so the window closes before it
 * can be reopened, which is what keeps it a burst rather than a stance.
 */
export const rapidFire: HeroSkill = {
  id: 'rapid_fire',
  targetType: SkillTargetType.Self, range: 0,
  // The authored duration is the middle rung's: 3 / 4 / 5 turns by node rank
  perRank: { duration: 1 },
  appliesEffect: { type: AuraType.RapidFire, magnitude: 1, duration: 4 },
  unlockLevel: TREE, manaCost: 20, cooldown: 5, vfxColor: MARKSMAN_YELLOW, vfxKind: 'surge',
};

/** Covering Fire's answer: one arrow at whoever struck the ally. Never on a bar. */
const coveringFireShot: HeroSkill = {
  id: 'covering_fire_shot',
  targetType: SkillTargetType.Single, range: 6, damage: 0.8,
  unlockLevel: TREE, manaCost: 0, vfxColor: MARKSMAN_YELLOW, vfxKind: 'shot',
};

/**
 * Covering Fire, Follow-Through's replacement and both of its halves: the
 * Crit / Crit Damage buff and the killing-crit free turn are retired with it.
 *
 * A three-turn watch (`BALANCE.REACTION_TURNS`). Whenever an enemy damages an ally (not the Marksman), the
 * Marksman shoots it if it stands within six hexes — up to twice per round,
 * once per attacking cast however many allies it struck, and never in answer to
 * another Reaction's blow. The Marksman's own turns are untouched; casting it is
 * the turn's action. The reaction shot is 0.6 / 0.8 / 1.0x Attack by rung.
 */
export const coveringFire: HeroSkill = {
  id: 'covering_fire',
  gesture: 'mark',
  targetType: SkillTargetType.Self, range: 0,
  perRank: { nested: true },
  reaction: {
    trigger: { kind: 'allyStruck' },
    duration: BALANCE.REACTION_TURNS,
    shotsPerRound: 2,
    response: coveringFireShot,
  },
  // Borrows the retired Follow-Through's drawing until its own is made
  icon: 'follow_through',
  // The bow held ready: the Marksman braces as the watch begins
  unlockLevel: TREE, manaCost: 22, cooldown: 5, vfxColor: MARKSMAN_YELLOW, vfxKind: 'buff', vfxPrelude: 'brace',
};

// ── Skirmisher — thrown weapons ───────────────────────────────────────────────

/**
 * The Skirmisher's Signature (2026-10 remaster): pull your own blades out of
 * every enemy in a cone. One undodgeable hit per enemy, worth
 * `BLADE_EXTRACT_PER_BLADE` × Attack for each blade removed; an enemy with none
 * of yours takes nothing. With nothing to pull and nothing to throw, the cast is
 * refused rather than spent.
 *
 * `damage` is the throw the Fan of Blades node adds in front of the extraction
 * (scaled by that node's rung): the same cone, embedding one blade in each enemy
 * it hits, then the pull. Without the node the only throw is Flurry's knives,
 * which still embed before the single extraction. See `strikeScales`.
 *
 * Free with a two-turn cooldown, the bargain Throwing Blades struck.
 */
export const bladeRecall: HeroSkill = {
  id: 'blade_recall',
  targetType: SkillTargetType.Arc, range: 2, aoeRadius: 2, damage: 0.7,
  embedsBlades: 1, extractsBlades: true,
  // Borrows the retired Throwing Blades' drawing until its own is made
  icon: 'throwing_blades',
  unlockLevel: TREE, manaCost: 0, cooldown: 2, vfxColor: '#c0c8d0', vfxKind: 'arc',
  delivery: 'thrown',
};

/**
 * Was a single-target root. On a path whose entire identity is area damage, the
 * one skill that pinned a target was also the one skill that asked the player
 * to pick a target — so it now tangles a cluster, and the Skirmisher's answer
 * to a charge is to stop the charge rather than one member of it.
 *
 * `throw`, not `meteor`. It is a ranged Ring, which is what the derivation calls
 * "called down from above", and that is what it played as: cords appearing in
 * the sky over the target and dropping, with the Skirmisher standing there
 * having apparently done nothing. It is a weapon somebody spun up and let go of.
 */
export const bolas: HeroSkill = {
  id: 'bolas',
  contact: 'bolas',
  targetType: SkillTargetType.Ring, range: 4, aoeRadius: 1, damage: 0.7,
  appliesEffect: { type: AfflictionType.Root, magnitude: 1, duration: 2 },
  embedsBlades: 1,
  unlockLevel: TREE, manaCost: 12, cooldown: 3, vfxColor: '#c0c8d0', vfxAftermath: 'dust', vfxKind: 'throw',
  delivery: 'thrown',
};

export const hitAndRun: HeroSkill = {
  id: 'hit_and_run',
  targetType: SkillTargetType.Single, range: 2, damage: 1.1,
  pushDistance: 1,
  selfMove: { kind: 'retreat', range: 2 },
  embedsBlades: 1,
  unlockLevel: TREE, manaCost: 12, cooldown: 2, vfxColor: '#c0c8d0', vfxAftermath: 'dust',
};

/**
 * Knife Dance: three legal ground dashes, a nearest-enemy throw after each.
 * Random ties and repeat victims; every landed blade sets up extraction.
 * No extra turn per throw. Root refuses it.
 */
export const knifeDance: HeroSkill = {
  id: 'knife_dance',
  targetType: SkillTargetType.Single, range: 3, damage: 1.3, targetSide: 'enemy',
  chainJumps: BALANCE.KNIFE_DANCE_STRIKES - 1, chainRange: BALANCE.KNIFE_DANCE_HOP,
  embedsBlades: 1, knifeDance: true,
  delivery: 'thrown', projectile: 'throwing_blade',
  // Borrows the retired Volley's drawing until its own is made
  icon: 'volley',
  unlockLevel: TREE, manaCost: 26, cooldown: 4, vfxColor: '#d8dee6', vfxKind: 'knifedance', vfxPrelude: 'brace',
};

/**
 * Bladestorm — was the `momentum` passive, which gave a small bonus for having
 * moved. This is the same idea with the handbrake off: go wherever you like,
 * and everything you end up next to pays for it.
 *
 * The movement and the blades are one aura because neither is worth much alone
 * — see `AuraType.BladeStorm`. Each bite leaves one blade per enemy, however
 * many blades the ring draws.
 */
export const bladestorm: HeroSkill = {
  id: 'bladestorm',
  targetType: SkillTargetType.Self, range: 0,
  appliesEffect: { type: AuraType.BladeStorm, magnitude: 0.75, duration: 3 },
  unlockLevel: TREE, manaCost: 26, cooldown: 5, vfxColor: '#ff4a4a', vfxKind: 'spin', vfxPrelude: 'brace',
};

/**
 * Flurry — was `undying`, a once-a-battle save that had nothing to do with the
 * path it sat on. This is the capstone the area identity actually wants: it
 * multiplies *every* skill, so it is worth most on the widest one. Each knife
 * that lands on a blade-leaving skill leaves a blade of its own, and on Blade
 * Recall they all go in before the one extraction.
 */
export const flurry: HeroSkill = {
  id: 'flurry',
  targetType: SkillTargetType.Self, range: 0,
  // The authored duration is the middle rung's: 3 / 4 / 5 turns by node rank
  perRank: { duration: 1 },
  appliesEffect: { type: AuraType.Flurry, magnitude: 1, duration: 4 },
  unlockLevel: TREE, manaCost: 24, cooldown: 6, vfxColor: '#ff4a4a', vfxKind: 'surge',
};

// ── Shadowblade — dual melee assassin ─────────────────────────────────────────

/**
 * One button, two skills, chosen by where it is pointed: open ground is an
 * escape, a body is an opening.
 *
 * The escape half is why the Stealth lands on the caster at all — the blink
 * happens first, so the caster *is* the unit standing on the targeted hex by
 * the time statuses are applied.
 */
export const shadowstep: HeroSkill = {
  id: 'shadowstep',
  // Single, not Self. `Self` short-circuits target selection to the caster's own
  // hex, so the blink resolved to where it started and the skill spent a turn
  // doing nothing but the Stealth — which is what "chosen hex" was supposed to
  // mean. Anything with a `blink` has to be able to name a destination.
  targetType: SkillTargetType.Single, range: 4,
  selfMove: { kind: 'blink', range: 4 },
  appliesEffect: { type: AuraType.Stealth, magnitude: 1, duration: BALANCE.VANISH_STEALTH },
  occupiedVariant: {
    // `dash` rather than `blink`: a blink names its exact destination and would
    // simply refuse an occupied hex, which is the whole case this variant is for
    selfMove: { kind: 'dash', range: 4 },
    damage: 1.21,
    appliesEffect: { type: AfflictionType.Poison, magnitude: 0.33, duration: 3 },
    vfxKind: 'slash',
  },
  unlockLevel: TREE, manaCost: 12, cooldown: 3, vfxColor: '#8844cc', vfxAftermath: 'smoke', vfxKind: 'buff',
};

/**
 * Both blades, both wet — and a turn's gap between them.
 *
 * It shipped free and off cooldown, which made it a strictly better at-will than
 * the one it sits beside: the same reach, the same 1.0×, plus 20% drain and a
 * dose of poison for nothing. A skill that dominates the basic attack on every
 * axis is not a choice, it is a replacement, and the whole poison plan (coat,
 * strike, strike, strike, burst) stops being a plan when one button does all of
 * it for free.
 *
 * 8 mana and one turn. The cooldown is the smaller number on purpose: this is a
 * *striking* skill, and a longer one would push the Shadowblade back onto the
 * plain attack for the very turns the pile is supposed to be growing. One turn
 * alternates them, which is the shape the path already asks for.
 */
export const venomedBlades: HeroSkill = {
  id: 'venomed_blades',
  targetType: SkillTargetType.Single, range: 1, damage: 1.1, lifesteal: 0.2,
  appliesEffect: { type: AfflictionType.Poison, magnitude: 0.385, duration: 3 },
  unlockLevel: TREE, manaCost: 8, cooldown: 1, vfxColor: '#88cc44', vfxAftermath: 'venom',
};

export const garrote: HeroSkill = {
  id: 'garrote',
  targetType: SkillTargetType.Single, range: 1, damage: 1.1,
  bonusVs: { condition: 'isolated', multiplier: 1.8 },
  appliesEffect: { type: AfflictionType.Silence, magnitude: 1, duration: 2 },
  unlockLevel: TREE, manaCost: 14, cooldown: 3, vfxColor: '#8844cc', vfxAftermath: 'spatter',
};

/**
 * A turn spent arming the next three.
 *
 * This node used to grant `bloodscent` — heal on a kill, a card the Berserker
 * and the Wolf branch both already hold, and one that does nothing at all for
 * the plan the rest of the tree is built around. Meanwhile the path's own
 * capstone is gated on a poisoned target, and everything that could poison one
 * was either the signature (whose strike half was unreachable) or a single
 * tier-2 node, so a legal route to Assassinate could arrive holding no way to
 * open its gate.
 *
 * Poison is the answer, so the node applies poison — but not directly. It coats
 * the blades and lets the *next three turns* do it, which is what makes it a
 * combo piece rather than a fourth poison button: the fourth dose bursts, so
 * three coated strikes on one target is a plan with a payoff at the end of it.
 *
 * No damage and no movement: the turn is the cost, and paying it in full is
 * what a three-turn window is worth.
 */
export const hemlock: HeroSkill = {
  id: 'hemlock',
  targetType: SkillTargetType.Self, range: 0,
  appliesEffect: {
    type: AuraType.Envenomed,
    // The dose itself, as a fraction of attack — the same currency every other
    // poison in the game is priced in, so a coated strike and a Venomed Blades
    // strike are worth comparing.
    magnitude: 0.3,
    duration: BALANCE.HEMLOCK_DURATION,
  },
  // One turn's gap between windows. Held open permanently it would stop being a
  // decision and start being a passive with extra steps — which is the thing
  // this node was before.
  unlockLevel: TREE, manaCost: 14, cooldown: 4, vfxColor: '#88cc44', vfxAftermath: 'venom', vfxKind: 'buff',
};

/**
 * Assassinate (2026-10 remaster): a delayed, automatic execution.
 *
 * The cast marks one enemy anywhere on the field and deals nothing; the mark makes
 * it take 10% more direct damage from everyone. At the start of each of the
 * Shadowblade's next three regular turns, a marked enemy inside the execution
 * window (the shared window at full width) is blinked to and finished before the
 * turn's action, which is kept. One mark per Shadowblade; a recast moves it. No
 * poison gate, no range limit and no cast-time damage any more. See
 * `systems/combat/assassination.ts` for the whole rule set.
 */
export const assassinate: HeroSkill = {
  id: 'assassinate',
  targetType: SkillTargetType.Single, range: 20, targetSide: 'enemy',
  deathMark: true,
  unlockLevel: TREE, manaCost: 24, cooldown: 4, vfxColor: '#b04dff', vfxKind: 'buff',
  vfxPrelude: 'aim',
};

/**
 * Was `frenzy` — a kill buying the next kill, which is a Berserker's card. This
 * is the same phrase read the other way: the poison you have been laying down
 * one strike at a time all arriving at once, on everyone.
 */
export const creepingDeath: HeroSkill = {
  id: 'creeping_death',
  spell: 'venom',
  targetType: SkillTargetType.Ring, range: 3, aoeRadius: 1, damage: 1.1,
  appliesEffect: { type: AfflictionType.Poison, magnitude: 0.385, duration: 3 },
  amplifiedBy: { status: AfflictionType.Poison, per: 0.5, max: 1.5 },
  unlockLevel: TREE, manaCost: 26, cooldown: 3, vfxColor: '#88cc44', vfxKind: 'nova',
  vfxPrelude: 'gather', vfxAftermath: 'venom',
  // Nothing is swung: the venom already in them turns, so it is heard as a
  // status is rather than as the Shadowblade's daggers.
  delivery: 'spell',
};

/**
 * Was `undying` — a once-a-battle death save borrowed from the Templar. This is
 * the card the path's name has always implied: disappear, and come back all at
 * once.
 *
 * Deliberately close to break-even in raw actions. The payoff is that three
 * actions land *between* two of the enemy's, which is the only way in the game
 * to kill something that would otherwise get a turn in the middle of your
 * combination.
 */
export const vanish: HeroSkill = {
  id: 'vanish',
  targetType: SkillTargetType.Self, range: 0,
  appliesEffect: [
    // The whole wind-up hidden (`VANISH_STEALTH`): fb3a9d75 meant this for Vanish and
    // set it on Shadowstep instead, leaving the wind-up's second round open (PT-03)
    { type: AuraType.Stealth, magnitude: 1, duration: BALANCE.VANISH_STEALTH },
    {
      type: AuraType.Ambush,
      magnitude: BALANCE.VANISH_CHARGES,
      // One longer than the wind-up: the aura's last turn is the payoff, and
      // the wind-up is every turn before it.
      duration: BALANCE.VANISH_WINDUP + 1,
    },
  ],
  unlockLevel: TREE, manaCost: 20, cooldown: 6, vfxColor: '#8844cc', vfxKind: 'buff', vfxAftermath: 'smoke',
};

// ═══ Added by the v3 tree rework ═════════════════════════════════════════════
//
// Tier 2 is four active skills on every path now. See the private project notes.

/**
 * The Marksman's control, and the path's first piece of it.
 *
 * "Never let them close" was the tagline of a tree whose whole kit was damage,
 * so the only way it ever stopped a charge was by killing it. A Root at range is
 * the honest version of the fantasy, and it is why this carries a plain 1.0
 * rather than a bigger number: what is bought is the distance staying the
 * distance.
 */
export const hamstringShot: HeroSkill = {
  id: 'hamstring_shot',
  targetType: SkillTargetType.Single, range: 5, damage: 0.85,
  appliesEffect: { type: AfflictionType.Root, magnitude: 1, duration: 2 },
  unlockLevel: TREE, manaCost: 10, cooldown: 3, vfxColor: MARKSMAN_YELLOW, vfxAftermath: 'spatter', vfxKind: 'shot',
};

/**
 * The Skirmisher's disengage (2026-10 remaster): a cloud dropped at your feet
 * that stays where it fell. While you stand in it your Dodge is at least
 * `SMOKE_DODGE` percent; it lasts 2 / 3 / 4 of your turns by rung. The enemies
 * caught in the drop have their Attack lowered. The old forced retreat is gone:
 * the cloud is the escape, and stepping out of it is a choice.
 */
export const smokeBomb: HeroSkill = {
  id: 'smoke_bomb',
  targetType: SkillTargetType.Self, range: 0, aoeRadius: 1,
  perRank: { duration: 1 },
  appliesEffect: [
    { type: AfflictionType.AttackDown, magnitude: 6, duration: 2 },
    { type: AuraType.SmokeCover, magnitude: 1, duration: 3, selfOnly: true },
  ],
  unlockLevel: TREE, manaCost: 12, cooldown: 4, vfxColor: '#9aa4b0', vfxKind: 'nova',
};

/**
 * The Skirmisher's focused throw: worse the more of your blades are already in.
 * `amplifiedBy` on `Blades` counts only the caster's own, read as they stood
 * when the cast began (the new blade goes in after every pass), and does not
 * pull them: throwing the same blade three times is a plan, not a reset.
 */
export const barbedBlades: HeroSkill = {
  id: 'barbed_blades',
  targetType: SkillTargetType.Single, range: 3, damage: 1.1,
  amplifiedBy: { status: AfflictionType.Blades, per: BALANCE.BARBED_PER_BLADE, max: BALANCE.BARBED_MAX },
  embedsBlades: 1,
  unlockLevel: TREE, manaCost: 10, cooldown: 2, vfxColor: '#c0c8d0', vfxAftermath: 'spatter', vfxKind: 'throw',
  delivery: 'thrown',
};

/**
 * The Shadowblade's only hard control, and the reason it needed one.
 *
 * The path's plan is kill, vanish, walk in, poison, kill — and every step of it
 * assumes the target is still standing there at the end of the turn. Against
 * anything that could simply leave, the whole chain came apart with no answer in
 * the kit. The long cooldown is the price: two turns of somebody doing nothing
 * is what an assassin's entire combination is priced against.
 */
export const cheapShot: HeroSkill = {
  id: 'cheap_shot',
  targetType: SkillTargetType.Single, range: 1, damage: 1.1,
  appliesEffect: { type: AfflictionType.Stun, magnitude: 1, duration: 2 },
  unlockLevel: TREE, manaCost: 14, cooldown: 5, vfxColor: '#8844cc', vfxAftermath: 'spatter',
};
