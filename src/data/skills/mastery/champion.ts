import { BALANCE } from '@/data/balanceConstants';
import { HeroSkill, SkillTargetType, AfflictionType, AuraType } from '@/models/types';

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

/** Further than any arena is wide: Reposition goes "anywhere" the board has a free hex. */
const REPOSITION_RANGE = 12;

// ═══ CHAMPION ═══════════════════════════════════════════════════════════════

// ── Bulwark — everything hits me ──────────────────────────────────────────────

export const provokingStrike: HeroSkill = {
  id: 'provoking_strike',
  targetType: SkillTargetType.Single, range: 1, damage: 1.0,
  appliesEffect: { type: AfflictionType.Taunt, magnitude: 2, duration: 2 },
  // A small price (2026-10-08 playtest): a free taunt-and-strike was the press
  // every turn; 4 keeps it the staple without it being free. Smite costs 3.
  unlockLevel: TREE, manaCost: 4, vfxColor: '#ff8800',
};

export const challenge: HeroSkill = {
  id: 'challenge',
  targetType: SkillTargetType.Single, range: 3,
  // Both halves are the skill. The description has always said "taunting them"
  // while the data applied only the Attack Down, so the one ranged way to pull
  // an enemy off a healer did not pull. The Taunt is shorter than the Attack
  // Down on purpose: the enemy is made to answer for two turns and stays
  // blunted for a third, which is what a call-out from range should leave behind.
  appliesEffect: [
    { type: AfflictionType.Taunt, magnitude: 2, duration: 2 },
    { type: AfflictionType.AttackDown, magnitude: 4, duration: 3 },
  ],
  unlockLevel: TREE, manaCost: 8, cooldown: 2, vfxColor: '#ff8800', vfxKind: 'buff',
  gesture: 'command',
};

/**
 * Aimed at an ally, and now it says so.
 *
 * With no damage and no healing on it, the highlight pass had nothing to go on
 * and lit up every hex in range — so the button that means "get between them
 * and my healer" could be pointed at bare ground, or at the enemy itself, and
 * the taunt would go off around whatever was there. `targetSide` is the rule it
 * was always supposed to have.
 *
 * The shield is on the same `appliesEffect` list as the taunt rather than on a
 * field of its own, and that is the whole trick: afflictions cross the line and
 * auras do not, so the taunt lands on the enemies in the ring and the barrier
 * lands on the allies in it. The dash puts the Bulwark adjacent to the ally, so
 * the Bulwark is *always* inside its own radius — both of them are covered by
 * one rule the engine already had, rather than by a second field saying "and
 * also the caster".
 */
export const intercept: HeroSkill = {
  id: 'intercept',
  targetType: SkillTargetType.Ring, range: 4, aoeRadius: 1,
  targetSide: 'ally',
  selfMove: { kind: 'dash', range: 4 },
  appliesEffect: [
    { type: AfflictionType.Taunt, magnitude: 2, duration: 2 },
    // Authored as a fraction of attack, so it is still worth something at level
    // 20 — see `SCALED_BY_ATTACK`. Small on purpose: it is the difference
    // between the blow the Bulwark just invited and the blow after it, not a
    // second Unbreakable Vow.
    { type: AuraType.Barrier, magnitude: 0.7, duration: 2 },
  ],
  unlockLevel: TREE, manaCost: 12, cooldown: 3, vfxColor: '#ff8800', vfxKind: 'nova', vfxAftermath: 'dust',
};

export const bellow: HeroSkill = {
  id: 'bellow',
  targetType: SkillTargetType.Ring, range: 0, aoeRadius: 1,
  appliesEffect: { type: AfflictionType.Taunt, magnitude: 3, duration: 2 },
  unlockLevel: TREE, manaCost: 10, cooldown: 3, vfxColor: '#ff8800', vfxKind: 'nova',
  gesture: 'command',
};

export const unbreakableVow: HeroSkill = {
  id: 'unbreakable_vow',
  targetType: SkillTargetType.Ring, range: 0, aoeRadius: 2,
  // The spines are real now. The description has promised them since the skill
  // was written and it only ever taunted — so the capstone of the path built
  // entirely around being hit did nothing *about* being hit, and the Bulwark
  // had no Thorns anywhere in its kit. Caught by `deadNodes.test.ts` the moment
  // a node tried to multiply them.
  //
  // **And `selfOnly` is what makes the second entry mean what this comment has
  // always claimed.** It used to say "the aura stays on the caster"; the rule it
  // relied on says auras stay on your own *side*, which on a ring centred on the
  // Bulwark is every ally inside two hexes. Those are precisely the allies
  // nothing is attacking — the Taunt in the line above just pulled the whole
  // ring onto the Bulwark — so the path's capstone spent its retaliation on the
  // people guaranteed not to be hit, and the one unit being hit got nothing.
  // A playtest reported it as the Thorns being useless, which they were.
  appliesEffect: [
    { type: AfflictionType.Taunt, magnitude: 4, duration: 3 },
    { type: AuraType.Thorns, magnitude: 0.4, duration: 3, selfOnly: true },
  ],
  unlockLevel: TREE, manaCost: 25, cooldown: 5, vfxColor: '#ffcc44', vfxKind: 'nova',
  vfxPrelude: 'brace', vfxAftermath: 'dust',
};

/**
 * The Bulwark's charge capstone (remaster, 2026-10).
 *
 * A dash and a cone on one press: the dash lands on the free hex beside the aimed
 * hex that is nearest the Bulwark (up to four hexes of travel, which is why the reach
 * is five), and the cone is then drawn from the landing towards the aimed hex. Aimed
 * from beside the target, there is no ground to cover and the slam lands from where
 * the Bulwark stands. Root, a blocked path and Stun-immune targets keep their
 * ordinary rules: a boss takes the damage and keeps acting.
 */
export const shieldAvalanche: HeroSkill = {
  id: 'shield_avalanche',
  targetType: SkillTargetType.Arc, range: 5, aoeRadius: 2,
  selfMove: { kind: 'dash', range: 4 },
  damage: 1.5,
  appliesEffect: { type: AfflictionType.Stun, magnitude: 1, duration: 1 },
  // Borrows the shield-wall drawing until its own is made
  icon: 'shield_wall',
  unlockLevel: TREE, manaCost: 24, cooldown: 5, vfxColor: '#e2ecf6', vfxKind: 'shieldwave',
  vfxPrelude: 'brace', vfxAftermath: 'dust',
};

/**
 * The Bulwark's answer capstone (remaster, 2026-10).
 *
 * A large Barrier of its own (`AuraType.Reckoning`), two of the Bulwark's turns
 * long, that soaks before any ordinary Barrier and stores what it soaks. When it
 * breaks or runs out the stored damage goes off as a shockwave around the Bulwark —
 * see `combatStore.releaseReckoning` and `statusEffects.reckoningBurst`. The rung
 * scales the Barrier, so a higher rung can store more before it breaks.
 */
export const reckoning: HeroSkill = {
  id: 'reckoning',
  targetType: SkillTargetType.Self, range: 0,
  appliesEffect: { type: AuraType.Reckoning, magnitude: 2.0, duration: 2, selfOnly: true },
  // Borrows the blood-iron ward's drawing until its own is made
  icon: 'blood_iron_ward',
  unlockLevel: TREE, manaCost: 22, cooldown: 5, vfxColor: '#ff8a3a', vfxKind: 'buff',
  vfxPrelude: 'brace', vfxAftermath: 'embers',
};

// ── Templar — shield and judgement ────────────────────────────────────────────
//
// The hybrid path: every offensive press is `scaling: 'hybrid'`, the average of
// attack and magic, so the sword arm and the faith feed one number and gear on
// either stat is never a dead stat. The old Smite carried `bonusVs: poisoned`,
// which belonged to a poison class the Templar is not and read as a typo in
// play — a paladin fishing for venom synergy nobody on the path can supply.

export const smite: HeroSkill = {
  id: 'smite',
  spell: 'holy',
  targetType: SkillTargetType.Single, range: 1, damage: 1.21, scaling: 'hybrid',
  // Small on purpose: the at-will already does full damage, so the heal is a
  // trickle that makes pressing Smite *at* the enemy still count as tending the
  // line — the path's whole identity in its cheapest button.
  allyHeal: 0.385,
  // Zeal turns the one press into a choice (Mercy / Wrath) — same skill, same
  // range, cost and cooldown. See `systems/combat/skillModes.ts`.
  modeChoice: 'zeal',
  unlockLevel: TREE, manaCost: 3, vfxColor: '#ffe9a8',
};

/**
 * One cast, two recipients (remaster, 2026-10): aimed at an ally within 3 hexes,
 * the ally and the Templar are each healed for the whole `healing` (0.6 / 0.8 /
 * 1.0x Magic by rung) — not one pool split between them. Aimed at the Templar it
 * heals the Templar once. Each heal resolves for its own recipient (their
 * `incomingSupportBonus`, a phase ceiling) and raises its own `onHeal`, so
 * Blessed Hands' regeneration lands on both; a caster charge such as Sacred
 * Rhythm's is one aura that a second heal only refreshes. Cost and cooldown are
 * the old self-heal's.
 */
export const layOnHands: HeroSkill = {
  id: 'lay_on_hands',
  targetType: SkillTargetType.Single, range: 3, healing: 0.88, healsCaster: true,
  unlockLevel: TREE, manaCost: 12, cooldown: 3, vfxColor: '#ffe9a8', vfxKind: 'bloom',
};

export const judgement: HeroSkill = {
  id: 'judgement',
  spell: 'holy',
  targetType: SkillTargetType.Single, range: 2, damage: 1.65, scaling: 'hybrid',
  appliesEffect: { type: AfflictionType.DefenseDown, magnitude: 8, duration: 2 },
  unlockLevel: TREE, manaCost: 14, vfxColor: '#ffe9a8', vfxKind: 'bolt',
};

export const consecrate: HeroSkill = {
  id: 'consecrate',
  spell: 'holy',
  // Hybrid on the burn; the mending half keys off magic the way all healing
  // does, so the two halves of the ground read off the two halves of the hero.
  targetType: SkillTargetType.Ring, range: 2, aoeRadius: 2,
  damage: 1.1, healing: 0.77, scaling: 'hybrid',
  unlockLevel: TREE, manaCost: 28, cooldown: 4, vfxColor: '#ffe9a8', vfxKind: 'bloom',
  vfxPrelude: 'halo', vfxAftermath: 'motes',
};

export const martyr: HeroSkill = {
  id: 'martyr',
  // Three auras on one target, which is what `appliesEffect` accepting a list
  // is for: "immune to everything" is honestly two statuses, and the seal that
  // pays for them is a third. Splitting them across separate skills would be a
  // lie about what the button does.
  //
  // The long cooldown is the balance: for two turns the target cannot be hurt
  // *or* debuffed, so this is a free walk into the middle of the enemy line —
  // and the detonation is the price they pay for having let it happen.
  // `scaling: 'hybrid'` reaches the seal through `resolveEffectMagnitude`, so
  // the detonation is priced off the same average every other Templar press is.
  targetType: SkillTargetType.Single, range: 3, scaling: 'hybrid',
  appliesEffect: [
    { type: AuraType.Invulnerability, magnitude: 1, duration: 2 },
    { type: AuraType.DebuffImmunity, magnitude: 1, duration: 2 },
    { type: AuraType.MartyrSeal, magnitude: 3.2, duration: 2 },
  ],
  unlockLevel: TREE, manaCost: 30, cooldown: 6, vfxColor: '#ffe9a8', vfxKind: 'surge',
  vfxPrelude: 'halo', vfxAftermath: 'motes',
};

export const righteousFury: HeroSkill = {
  id: 'righteous_fury',
  // Self-cast, permanent for the fight, and it stacks: `BlessedWeapon` is one of
  // the two statuses whose magnitude adds on re-application. The cooldown is
  // the whole cost — a turn spent blessing is a turn not spent swinging, and
  // `MAX_BLESSED_WEAPON` is where four of those stop paying off.
  targetType: SkillTargetType.Self, range: 0,
  appliesEffect: { type: AuraType.BlessedWeapon, magnitude: BALANCE.FURY_PER_STACK, duration: -1 },
  unlockLevel: TREE, manaCost: 16, cooldown: 3, vfxColor: '#ffe9a8', vfxKind: 'surge',
  vfxPrelude: 'halo', vfxAftermath: 'motes',
};

// ── Berserker — dual-wield, no shield ─────────────────────────────────────────

// Free, at-will and self-sustaining is one thing too many. At 30% drain and a
// full damage multiplier this was strictly better than a basic attack every
// single turn, so there was never a reason to press anything else — the
// Berserker played itself. The drain now starts small and *Carnage* is where the
// sustain build actually pays off, which is where a tier-4 node belongs.
export const bloodthirst: HeroSkill = {
  id: 'bloodthirst',
  targetType: SkillTargetType.Single, range: 1, damage: 0.9, lifesteal: 0.15,
  // A red cut, blood on the ground and the drink drawn back into the Berserker (`drain`)
  unlockLevel: TREE, manaCost: 0, vfxColor: '#cc2244', vfxAftermath: 'spatter',
};

export const carnage: HeroSkill = {
  id: 'carnage',
  // Cooldown deliberately outlasts the duration: Carnage is a window the
  // Berserker opens and then has to fight without, not a stance. Bloodthirst
  // drains, so a doubled one is double the sustain too — which is what makes
  // this the node the lifesteal build was always pointing at.
  targetType: SkillTargetType.Self, range: 0,
  // The authored duration is the middle rung's: 3 / 4 / 5 turns by node rank
  perRank: { duration: 1 },
  appliesEffect: { type: AuraType.Carnage, magnitude: 1, duration: 4 },
  unlockLevel: TREE, manaCost: 24, cooldown: 6, vfxColor: '#cc2244', vfxKind: 'surge', vfxPrelude: 'brace', vfxAftermath: 'spatter',
};

export const rend: HeroSkill = {
  id: 'rend',
  targetType: SkillTargetType.Single, range: 1, damage: 1.2,
  bonusVs: { condition: 'bleeding', multiplier: 1.5 },
  appliesEffect: { type: AfflictionType.Bleed, magnitude: 0.35, duration: 3 },
  unlockLevel: TREE, manaCost: 10, vfxColor: '#cc2244',
};

export const executioner: HeroSkill = {
  id: 'executioner',
  // `bonusVs: lowHp ×3` is gone: it was a large multiplier that happened to
  // apply, and the skill was a slightly worse basic attack the rest of the
  // time. As a gate the same idea reads as a decision — the window is drawn on
  // the board, so the question becomes *when*, not *whether*.
  //
  // The multiplier is flat and high because everything inside the window is
  // meant to die. Note the cooldown: Frenzy is two tiers up the same path and
  // refunds the action on a kill, so an at-will executioner would chain.
  // Reach 2 and no cooldown: the target gate *is* the limiter, so a cooldown on
  // top was two locks on one door — and the one that hurt was the arbitrary
  // one, since a finisher you cannot use on the turn the window opens is a
  // finisher you watch somebody else get. Mana is what still bounds the chain
  // with Frenzy: 18 a swing empties a Warrior's pool in three.
  targetType: SkillTargetType.Single, range: 2, damage: 2.4,
  requiresTarget: ['executable'],
  // A braced, overhead killing stroke that leaves blood — it had no picture and drew a bow's shot
  unlockLevel: TREE, manaCost: 18, vfxColor: '#cc2244', vfxKind: 'slash', vfxPrelude: 'brace', vfxAftermath: 'spatter',
};

/**
 * The Berserker's spin, promoted to tier 3.
 *
 * Lives here rather than in `skillData.ts` now. It was in the shared file but
 * on no template at all — nothing but this one node ever granted it — so the
 * neutrality that file demands was buying nothing while stopping the node from
 * being tuned. A tier's worth of promotion: harder, wider, and it opens wounds
 * so Rend has something to bite on afterwards.
 */
export const whirlwind: HeroSkill = {
  id: 'whirlwind',
  targetType: SkillTargetType.Ring, range: 0, aoeRadius: 2,
  damage: 1.45,
  appliesEffect: { type: AfflictionType.Bleed, magnitude: 0.25, duration: 3 },
  unlockLevel: TREE, manaCost: 26, cooldown: 3, vfxColor: '#ff4444', vfxKind: 'spin',
  vfxPrelude: 'brace', vfxAftermath: 'spatter',
};

// ═══ Added by the v3 tree rework ═════════════════════════════════════════════
//
// Tier 2 is four active skills on every path now, so each of the three Champion
// trees needed one more. See the private project notes.

/**
 * The Bulwark's one piece of mobility, and the only skill in the game that does
 * not end the turn.
 *
 * That is the whole point of it rather than a convenience: a Bulwark's job is to
 * be *between* things, and every other way of getting there costs the action it
 * was trying to buy — so the tank arrived one turn after the moment it was
 * needed, every time. `freeAction` is what makes stepping into the gap and then
 * taunting a single turn's work.
 *
 * It is priced against that: a cooldown long enough that it cannot be a walk,
 * and a barrier small enough to be a flinch rather than a plan. It goes to any
 * open hex; aimed at an ally it lands beside them and shares the barrier.
 */
export const reposition: HeroSkill = {
  id: 'reposition',
  targetType: SkillTargetType.Single, range: REPOSITION_RANGE,
  selfMove: { kind: 'free', range: REPOSITION_RANGE },
  allyShare: 0.5,
  appliesEffect: { type: AuraType.Barrier, magnitude: 18, duration: 2 },
  freeAction: true,
  unlockLevel: TREE, manaCost: 8, cooldown: 4, vfxColor: '#88aacc', vfxKind: 'buff', vfxAftermath: 'dust',
};

/**
 * The Templar's setup skill, and the only mark in the game that pays somebody
 * other than the caster.
 *
 * `Mark` is normally the Marksman's — `magnitude` extra damage from
 * `sourceUnitId` alone. This one is aimed the other way: the Templar lights the
 * target and the *party* spends it, which is what a support strike on a path
 * that also heals should do. The heal on the detonation is why it is worth a
 * turn at all; the damage on its own would be a worse Smite.
 */
export const sanction: HeroSkill = {
  id: 'sanction',
  targetType: SkillTargetType.Arc, range: 2, aoeRadius: 2, damage: 0.88, scaling: 'hybrid',
  appliesEffect: { type: AfflictionType.SacredSeal, magnitude: BALANCE.SACRED_SEAL_DAMAGE, duration: 3 },
  unlockLevel: TREE, manaCost: 12, cooldown: 2, vfxColor: '#ffe9a8', vfxKind: 'arc',
};

/**
 * The Berserker's answer to standing still, which it otherwise has none of.
 *
 * Every other skill on the path is range 1 and half of them are self-buffs, so
 * a Berserker whose target died out of reach spent the turn walking. Thrown, it
 * is deliberately weaker per body than Whirlwind and lands on a cross rather
 * than a disc — the shape is the tuning: it catches a line either way through
 * the target and misses the diagonals, so it rewards aiming at the middle of a
 * formation rather than at whatever is nearest.
 */
export const cleavingThrow: HeroSkill = {
  id: 'cleaving_throw',
  targetType: SkillTargetType.Cross, range: 3, aoeRadius: 2, damage: 1.1,
  // Dust over the whole cross, not only where the axe landed
  unlockLevel: TREE, manaCost: 12, cooldown: 3, vfxColor: '#cc7744', vfxKind: 'throw', vfxAftermath: 'dust',
  // An axe thrown, whatever the Berserker is holding.
  delivery: 'thrown',
};

/**
 * Health spent for damage, which is the path's whole bargain said out loud.
 *
 * The self-damage is **flat and does not scale with the node's level** — it is
 * the price, and a price that shrinks as the node is raised would make the
 * third level strictly better in both directions rather than a trade at all.
 * `wrath` two nodes over turns the wound into attack as well, which is the
 * combination this exists for.
 */
export const bloodPrice: HeroSkill = {
  id: 'blood_price',
  targetType: SkillTargetType.Self, range: 0,
  selfDamage: 12,
  appliesEffect: { type: AuraType.AttackBuff, magnitude: 10, duration: 3 },
  unlockLevel: TREE, manaCost: 6, cooldown: 5, vfxColor: '#cc2244', vfxKind: 'buff', vfxAftermath: 'spatter',
};
