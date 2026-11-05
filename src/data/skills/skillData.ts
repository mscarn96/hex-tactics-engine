import { HeroSkill, SkillTargetType, AfflictionType, AuraType } from "@/models/types";
import { BALANCE } from "@/data/balanceConstants";
import { MARKSMAN_YELLOW } from "@/data/display/marksmanColors";

/**
 * Tuning scale
 *
 * Damage is `power × damage`, less the share the target's defence takes off it
 * (`defenceReduction`: defence against `DEFENSE_ATTACKER_K × power`), where
 * `power` is `attack` for weapon skills and `magic` for anything carrying
 * `scaling: 'magic'`. Healing has always keyed off `magic`.
 *
 * That split is what lets one multiplier band cover every class: a Champion
 * swinging at 14 attack and an Arcanist casting at 16 magic sit in the same
 * range, so the numbers below mean the same thing wherever they appear.
 * Rough targets, measured as raw output before defence:
 *
 *   free at-will attack    ~12   (the fallback you press when out of mana)
 *   cheap costed skill     ~16   (a clear upgrade, still spammable)
 *   area skill, per target ~11   (less each, more of them)
 *   level-5 capstone       ~16+  (or a large area)
 *
 * One rule keeps this from drifting: **shared skills stay neutral.** `slash`,
 * `mace_strike`, `arcane_bolt` and `bite` are used by heroes, enemies and
 * summons alike, so their multipliers are generic and the caster's stats do the
 * differentiating. Only a class's *exclusive* skills are tuned to that class.
 */

// ============ WARRIOR SKILLS ============
export const slash: HeroSkill = {
  id: "slash",
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.1,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#ff4444',
};

export const groundSlam: HeroSkill = {
  id: "ground_slam",
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: 1,
  damage: 0.7,
  // Zero mana is a hard requirement, not a discount. Summons are built with
  // `maxMana: 0`, and skill use is gated on mana — a costed skill on the Stone
  // Elemental would be a button that can never be pressed. The cooldown is what
  // limits it, which is exactly why area taunt waited for cooldowns to exist.
  manaCost: 0,
  cooldown: 3,
  unlockLevel: 1,
  appliesEffect: { type: AfflictionType.Taunt, magnitude: 1, duration: 2 },
  vfxColor: '#c8a878', vfxAftermath: "dust",
  vfxKind: 'nova',
};

// Whirlwind moved to `masterySkills.ts`. It was never on a template — the
// Berserker's node was the only thing that granted it — so the neutrality this
// file demands was costing tuning and buying nothing.

// ============ MAGE SKILLS ============
export const meteor: HeroSkill = {
  id: "meteor",
  targetType: SkillTargetType.Ring,
  range: 3,
  aoeRadius: 2,
  damage: 0.81,
  scaling: 'magic',
  unlockLevel: 5,
  manaCost: 30,
  vfxColor: '#ff6600',
};

// ============ HEALER SKILLS ============
export const heal: HeroSkill = {
  id: "heal",
  targetType: SkillTargetType.Single,
  range: 2,
  // Retuned after a playtest: at 1.4 for 5 mana this returned about 4.5 HP per
  // point of mana, which is ~180 HP off a full pool — more than anything in the
  // first half of the game can put out, and with no cooldown to interrupt it.
  // The knock-on was worse than the number: self-healing on repeat out-tanked
  // Wildshape's Bear outright, so the tank shape's best move was not to be one.
  //
  // Split again since: half the budget is now a Barrier, which is *pre*-emptive
  // rather than reactive, so the same button rewards reading the fight instead
  // of waiting for the damage. It also gives the Stoneshaper's shield modifier
  // something every Druid holds from level 3.
  healing: 0.52,
  // Required, not decoration. The Barrier below is authored as a fraction, so
  // it rides `resolveEffectMagnitude`'s scaled path — and that defaults to
  // *attack*, which the Druid has 5 of against 14 magic.
  scaling: 'magic',
  appliesEffect: { type: AuraType.Barrier, magnitude: 0.40, duration: 3 },
  // The Druid's level-3 identity skill, and self-targetable — the game hands
  // you one hero, so an ally-only heal is a button that does nothing for the
  // first stretch of a save.
  unlockLevel: 3,
  manaCost: 9,
  vfxColor: '#44dd88', vfxAftermath: "motes",
};

export const divineLight: HeroSkill = {
  id: "divine_light",
  targetType: SkillTargetType.Self,
  range: 0,
  aoeRadius: 3,
  // The Templar's ally cleanse lives here — the one existing Templar skill that
  // already reaches the whole line. It is paid for three ways rather than
  // given: the heal is cut from 1.3 to 1.1, the mana from 18 to 22, and it now
  // waits three turns, so one press is a decision between "heal" and "heal and
  // cleanse" rather than a free rider on a button that used to be spammable.
  // Nothing here refunds mana or shortens a cooldown: the Templar's resource
  // recovery stays exactly what it already was.
  //
  // (30 mana was most of a Templar's pool for one press in an earlier pass —
  // the node that grants it was a button used once a fight and then regretted;
  // 22 plus a cooldown keeps it a once-per-few-turns tool, not a regretted one.)
  healing: 1.21,
  cleanse: true,
  unlockLevel: 5,
  manaCost: 22,
  cooldown: 3,
  // Holy, drawn as Consecrate is: a pale gold bloom under a halo, motes after.
  // It was the Druid's heal green, which `isNature` grew vines and moss from.
  vfxColor: '#ffe9a8',
  vfxKind: 'bloom',
  vfxPrelude: 'halo',
  vfxAftermath: 'motes',
  // Light rather than a mace swing: the effect's blow, so it throws the holy
  // light flash (`spellElement`). Changes no number — healing keys off magic
  // whatever the delivery — and a heal has no cast or strike cue to re-voice.
  delivery: 'spell',
};

// ============ RANGER SKILLS ============
export const arrowShot: HeroSkill = {
  id: "arrow_shot",
  targetType: SkillTargetType.Single,
  range: 4,
  damage: 1.0,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#ffaa44',
};

export const poisonArrow: HeroSkill = {
  id: "poison_arrow",
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 1.3,
  unlockLevel: 3,
  manaCost: 10,
  vfxColor: '#88cc44', vfxAftermath: "venom",
  appliesEffect: { type: AfflictionType.Poison, magnitude: 0.4, duration: 3 },
};

export const rainOfArrows: HeroSkill = {
  id: "rain_of_arrows",
  targetType: SkillTargetType.Ring,
  range: 3,
  aoeRadius: 2,
  damage: 0.765,
  unlockLevel: 5,
  manaCost: 25,
  /**
   * Three, sized against the neighbours rather than picked.
   *
   * It shipped with **none**, which is the failure `arcFootprint.test.ts` states
   * in general: mana caps how many strong things you do in a *fight*, a cooldown
   * caps how *often*, and only the second stops an area attack from being the
   * right press on literally every turn. A Ranger unlocks this at level 5 with
   * ~74 mana, so 25 buys three casts — the fight is over before the pool is, and
   * for anything that picks it up off the neutral list (this file's skills reach
   * summons and enemies, who are built `maxMana: 0`) the mana is no limit at all.
   *
   * The band, in the Hunter's own tree: `throwing_blades` is 2 for a free depth-2
   * arc at 0.5×, and `volley` is 4 — the Marksman capstone that is *this skill
   * grown up*, same Ring at the same radius, 1.1× with a Bleed for 26 mana. This
   * has to sit strictly under that or the capstone buys only damage. `bolas`,
   * `aimed_shot` and `creeping_death` are all 3, as are `cleaving_throw`,
   * `bone_shards` and `rootlash_sweep` one tree over: three is where the game
   * already puts "strong, aimed, not every turn".
   *
   * Three also keeps `resolveVfxScale` where it was — 4 would clear
   * `HUGE_COOLDOWN` and hand a level-5 skill the 1.7× play time reserved for
   * whole-arena capstones.
   */
  cooldown: 3,
  // The Marksman's yellow: this volley is only ever fielded from that tree
  vfxColor: MARKSMAN_YELLOW,
  /**
   * Explicit, because the derivation cannot reach it and what it reaches instead
   * is wrong: a ranged `Ring` reads as "called down", which is `meteor` — one
   * burning rock on the centre of the footprint, camera shake included, for a
   * skill whose whole name is a volley. See `VfxKind`.
   */
  vfxKind: 'arrows',
  // Arrows whatever the Hunter happens to be holding: `strikeDelivery` would
  // otherwise hear the weapon in hand, and a Ring is read as a slam.
  delivery: 'bow',
};

// ============ MAGE / HEALER BASIC ATTACKS ============
export const arcaneBolt: HeroSkill = {
  id: "arcane_bolt",
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.8,
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#aa44ff',
  // The staff's Basic Attack in an enemy caster's hand: heard as the missile, not as an arcane spell
  spell: 'bolt',
};

/**
 * The Druid's at-will offence.
 *
 * `mace_strike` is shared with enemies and summons, so it scales off `attack` —
 * and the Druid has 5 of it against 14 magic, which left the class with no way
 * to threaten anything between heals. This is the same skill in the caster's own
 * currency.
 */
export const holyBolt: HeroSkill = {
  id: "holy_bolt",
  spell: 'holy',
  targetType: SkillTargetType.Single,
  range: 2,
  damage: 0.8,
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#ffe9a8',
};

export const maceStrike: HeroSkill = {
  id: "mace_strike",
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 0.9,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#ff4444',
  delivery: 'blunt',
};

/**
 * The Stone Elemental's swing.
 *
 * The same blow as `mace_strike` in every number, and a separate skill anyway:
 * `mace_strike` is shared vocabulary — the Druid and several enemies press it —
 * so it cannot be renamed, and a summoned slab of rock holding a mace was the
 * one place the shared name stopped describing what was on screen. Tuning it
 * here would be tuning the elemental, which is the point of a private id.
 */
export const stoneFist: HeroSkill = {
  id: "stone_fist",
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 0.9,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#9a8f7d', vfxAftermath: "dust",
  delivery: 'blunt',
};

// ============ ENEMY SKILLS ============
export const bite: HeroSkill = {
  id: "bite",
  contact: 'bite',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 0.8,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#ff4444', vfxAftermath: "spatter",
  delivery: 'natural',
};

export const rangedShot: HeroSkill = {
  id: "ranged_shot",
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.7,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#ffaa44',
};

/**
 * The pre-mastery kit, added in v0.6.
 *
 * Each of these has to stay useful and on-theme for all three of its class's
 * paths, because they are owned before a path is chosen. That rules out
 * elements (two of three Arcanist paths are not fire) and roles (a Berserker
 * never wants to taunt), and leaves verbs.
 */
export const arcaneBurst: HeroSkill = {
  id: "arcane_burst",
  targetType: SkillTargetType.Ring,
  range: 3,
  aoeRadius: 1,
  damage: 0.7,
  scaling: 'magic',
  unlockLevel: 3,
  manaCost: 12,
  cooldown: 2,
  // Arcane is the non-element: fire, frost and storm all build past it, so the
  // class can have area damage without a path having to share its identity.
  vfxColor: '#b48aff',
};

/**
 * No longer fielded by anybody. It was the Druid's at-will until every hero's
 * free attack became the weapon-driven Basic Attack; a Druid's branch now makes
 * that attack, in this skill's colour and under this skill's picture, without
 * the Root rider. Kept because the definition — and the rider's history below —
 * is vocabulary a future enemy can reach for.
 */
export const thornLash: HeroSkill = {
  id: "thorn_lash",
  targetType: SkillTargetType.Single,
  range: 2,
  damage: 0.8,
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  // "Sometimes" is the description's word and now the mechanic's. It shipped as
  // a certain Root of duration 1, which is a status that cannot happen: effects
  // tick at the *start* of the victim's turn and a duration of 1 is decremented
  // to zero there, before it has ever been asked whether the unit may move. The
  // player saw "Rooted" float and then watched the enemy walk away.
  //
  // Duration 2 is the smallest number that costs the victim a turn — the same
  // arithmetic Doom records ("a Doom of duration 2 gives exactly one turn to
  // answer"). The chance is what pays for it: this is a no-cooldown, no-mana
  // at-will, so a certain 2-turn Root would be a permanent single-target lock
  // for free, which is a stronger effect than anything on the Druid's actual
  // control path. A hold that lands three casts in ten is a tempo swing; one
  // that lands every cast is the fight.
  appliesEffect: { type: AfflictionType.Root, magnitude: 1, duration: 2, chance: 0.3 },
  vfxColor: '#7fbf5a',
};

/**
 * No longer fielded: the Hunter's at-will until the Basic Attack replaced it. A
 * throwing blade in the hand makes the same throw, at the same numbers, under
 * this picture.
 */
export const throwKnife: HeroSkill = {
  id: "throw_knife",
  targetType: SkillTargetType.Single,
  // Short range on purpose: the Marksman's sidearm, the Skirmisher's whole
  // theme, and something a Shadowblade can open with before closing.
  range: 2,
  damage: 0.9,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#c8d0dd',
  delivery: 'thrown',
};

export const disengage: HeroSkill = {
  id: "disengage",
  targetType: SkillTargetType.Single,
  range: 3,
  selfMove: { kind: 'free', range: 3 },
  // A share of the wound, not of Magic (2026-10-08 playtest): a Hunter has
  // little Magic, and binding a wound is worth most when the wound is deep.
  healing: 0.3,
  healingBasis: 'missingHp',
  // No untargetable (2026-10-08 playtest): with the turn left unspent it let the
  // Hunter break away, shoot, and stay out of reach for the enemy's reply.
  unlockLevel: 3,
  manaCost: 8,
  // Like Reposition, the escape leaves the turn unspent: break away, then act.
  freeAction: true,
  // A move, a heal and a free turn is a lot, and the cooldown is what stops it
  // being the answer to every turn.
  cooldown: 3,
  vfxColor: '#8ad9c8',
};

/**
 * The Monk's level-3 identity skill: skip the strike, brace, and be paid for it
 * at the start of the next turn (`systems/combat/meditate.ts`). It costs no chi
 * and refills some, so it is the loop's third way back after the per-turn regen
 * and the Basic Attack. Every other turn (`cooldown: 1`), and the action only:
 * the Monk may still move.
 */
export const meditate: HeroSkill = {
  id: "meditate",
  targetType: SkillTargetType.Self,
  range: 0,
  // Flat points: neither buff type scales off the caster (`isScaledMagnitude`).
  // The Meditation aura's magnitude is unused; its payout is `BALANCE.MEDITATE`.
  appliesEffect: [
    { type: AuraType.DefenseBuff, magnitude: BALANCE.MEDITATE.PHYSICAL_DEFENSE, duration: 1 },
    { type: AuraType.MagicDefenseBuff, magnitude: BALANCE.MEDITATE.MAGIC_DEFENSE, duration: 1 },
    { type: AuraType.Meditation, magnitude: 1, duration: 1 },
  ],
  unlockLevel: 3,
  manaCost: 0,
  cooldown: 1,
  vfxColor: '#e8d8a8', vfxKind: 'surge', vfxAftermath: 'motes',
  // Borrowed until the Monk's skill pictures are drawn: Riposte Stance's
  // gauntlet, a stance held with a bound hand. Its own skill has left the game,
  // so no other fielded skill wears it and a mixed party's bars never show one
  // picture for two skills (`npm run icons:status`, "borrowed").
  icon: 'riposte_stance',
};

export const charge: HeroSkill = {
  id: "charge",
  targetType: SkillTargetType.Single,
  // Reach, not melee range: `selfMove` closes the gap before the strike lands.
  // The skill has been called Charge since the start while being an ordinary
  // range-1 swing that never moved anybody.
  range: 3,
  selfMove: { kind: 'dash', range: 3 },
  damage: 1.3,
  // The Champion's level-3 identity skill. Closing distance is what a Bulwark,
  // a Templar and a Berserker all want to do first, which is why this is the
  // one that survives the path choice where `provoke` did not.
  unlockLevel: 3,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#ff4444', vfxAftermath: "dust",
};

export const darkBolt: HeroSkill = {
  id: "dark_bolt",
  spell: 'shadow',
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.7,
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#aa44ff',
};

export const ghostTouch: HeroSkill = {
  id: "ghost_touch",
  spell: 'shadow',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 0.9,
  scaling: 'magic',
  lifesteal: 0.5,
  // Hit and drift: a ghost that stands still after touching you is just a
  // slower skeleton
  selfMove: { kind: 'retreat', range: 2 },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#cc44ff',
};

export const trollSmash: HeroSkill = {
  id: "troll_smash",
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: 1,
  damage: 1.6,
  unlockLevel: 1,
  manaCost: 0,
  // A free 1.6× ring with nothing limiting it, on the first boss in the game.
  // `enemyAI` scores in expected damage, so against a party stood anywhere near
  // each other this beat `charge` on every turn it was ever offered — the troll
  // did not have two moves, it had one, and it landed on the whole party. Two
  // turns makes the fight the rhythm the second skill was written for. Same
  // reasoning and the same number as `dragon_breath`.
  cooldown: 2,
  vfxColor: '#ff4444', vfxAftermath: "dust",
};

// ─── Summoning ───────────────────────────────────────────────────────────────
//
// Summon skills target Self: the spec places the creatures relative to the
// caster, so there is no hex for the player to pick. They deal no damage, which
// is why `enemyAI.evaluateSkill` needs its own branch for them.

// ── Faction skills ────────────────────────────────────────────────────────────
//
// Shared inside a faction, not across the roster: a Greenskin shaman and a Coven
// hexer both debuff, but they do it with their own skills so either can be
// retuned without touching the other. Neutral by the same rule as `slash` — a
// summon or a future hero could pick any of these up.

export const cleave: HeroSkill = {
  id: "cleave",
  targetType: SkillTargetType.Arc,
  range: 2,
  aoeRadius: 2,
  damage: 0.6,
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#ff6644',
};

export const hex: HeroSkill = {
  id: "hex",
  spell: 'shadow',
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.5,
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.AttackDown, magnitude: 4, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#8844cc',
  vfxKind: 'bolt',
};

export const blight: HeroSkill = {
  id: "blight",
  spell: 'venom',
  targetType: SkillTargetType.Ring,
  range: 3,
  aoeRadius: 1,
  damage: 0.5,
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.Poison, magnitude: 0.25, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 3,
  vfxColor: '#6a9a3a',
  vfxKind: 'nova',
};

export const web: HeroSkill = {
  id: "web",
  gesture: 'spit', contact: 'web',
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.4,
  appliesEffect: { type: AfflictionType.Root, magnitude: 1, duration: 2 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 3,
  vfxColor: '#d8d8c0',
  vfxKind: 'bolt',
  // Spat silk, not a shot: a range-3 single would otherwise read as an arrow.
  delivery: 'natural',
};

/**
 * The enemy-side poisoned arrow, and the reason there has to be one.
 *
 * `poisonArrow` is the Ranger's, and it costs 10 mana. Enemies are built with
 * `maxMana: 0` and `currentMana: 0`, so `canUseSkill` has rejected it on every
 * turn of every fight since the Brigand Archer shipped carrying it — the AI logs
 * it as `unusable` and falls back to a plain shot. Giving the archer a mana pool
 * would not fix it either, because `makeEnemyUnit` starts every enemy empty.
 */
export const poisonedShot: HeroSkill = {
  id: "poisoned_shot",
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.9,
  appliesEffect: { type: AfflictionType.Poison, magnitude: 0.3, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#8fbf4a', vfxAftermath: "venom",
};

/**
 * The first Chill anything on the enemy side has ever applied.
 *
 * **Damage 1.2 against the Wader's own `slash` at 1.1, and that is deliberate.**
 * `enemyAI` scores expected damage and nothing else — `skillEffects` are
 * filtered to auras before scoring and afflictions are worth exactly zero — so a
 * control skill that does not out-damage its owner's at-will attack is never
 * selected, and the unit's whole identity sits unused behind a better number.
 * Same shape as `legionAdvance`, for the same reason. The cooldown is what stops
 * it simply replacing the at-will.
 */
export const mireGrasp: HeroSkill = {
  id: "mire_grasp",
  contact: 'mire',
  targetType: SkillTargetType.Single,
  range: 2,
  damage: 1.2,
  appliesEffect: { type: AfflictionType.Chill, magnitude: 3, duration: 2 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#6f8f6a',
  vfxKind: 'bolt',
  delivery: 'natural',
};

/**
 * The Giant Spider's bite — and the one poison in the game that is a *risk*
 * rather than a certainty.
 *
 * It applied its dose unconditionally, on a free at-will with no cooldown, which
 * is the same trap `thorn_lash` records one file over: a rider that always lands
 * is not a rider, it is the skill. Two spiders could put a hero at the dose cap
 * in two turns without ever choosing to, and the burst that follows is priced as
 * a capstone.
 *
 * A half chance leaves the average dose rate roughly where the encounter was
 * balanced and puts the variance back — sometimes the bite is just a bite. The
 * roll lives in `effectLands`, so a miss does not mark the skill as having
 * landed a status and the AI's turn is still spent on a real attack.
 */
export const venomBite: HeroSkill = {
  id: "venom_bite",
  contact: 'bite',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 0.7,
  appliesEffect: { type: AfflictionType.Poison, magnitude: 0.3, duration: 3, chance: 0.5 },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#7aca4a', vfxAftermath: "venom",
  delivery: 'natural',
};

export const maul: HeroSkill = {
  id: "beast_maul",
  contact: 'claw',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.2,
  pushDistance: 1,
  unlockLevel: 1,
  manaCost: 0,
  // At will, the shove kept a lone melee hero walking back every turn (PT-14);
  // its owners carry a plain blow for the turns between
  cooldown: BALANCE.MAUL_COOLDOWN,
  vfxColor: '#aa7744', vfxAftermath: "spatter",
  delivery: 'natural',
};

export const cutpurse: HeroSkill = {
  id: "cutpurse",
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 0.7,
  lifesteal: 0.2,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#c8b070',
};

export const rally: HeroSkill = {
  id: "rally",
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: 2,
  appliesEffect: { type: AuraType.AttackBuff, magnitude: 5, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 4,
  vfxColor: '#ffaa44', vfxAftermath: "motes",
  vfxKind: 'nova',
  gesture: 'command',
};

export const boneShards: HeroSkill = {
  id: "bone_shards",
  targetType: SkillTargetType.Arc,
  range: 3,
  aoeRadius: 3,
  damage: 0.6,
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.Bleed, magnitude: 0.25, duration: 2 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 3,
  vfxColor: '#ded6c0',
  vfxKind: 'arc',
};

// ── The Obsidian Legion ──────────────────────────────────────────────────────
//
// The one roster in the game that fights like an army rather than like a group
// of monsters standing near each other: a line that makes you hit it, a wall
// that hardens the line, and shock troops that arrive through the gap.
//
// Every one of these is an existing mechanic — taunt, Root, Barrier, Stealth,
// push, `bonusVs`. Nothing here is a new system, which is the whole reason the
// endgame is affordable.

export const legionAdvance: HeroSkill = {
  id: "legion_advance",
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.3,
  // Taunt is invisible to the AI's scoring, which weighs damage alone — so this
  // has to out-damage the Infantry's at-will swing or it would never be picked
  // and the unit's entire identity would sit unused behind a better number.
  appliesEffect: { type: AfflictionType.Taunt, magnitude: 1, duration: 2 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#c02028',
  vfxKind: 'slash',
};

export const shieldWall: HeroSkill = {
  id: "shield_wall",
  targetType: SkillTargetType.Self,
  range: 0,
  aoeRadius: 1,
  appliesEffect: { type: AuraType.DefenseBuff, magnitude: 6, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 4,
  vfxColor: '#c02028',
  vfxKind: 'nova',
};

export const plasmaOrb: HeroSkill = {
  id: "plasma_orb",
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 1.0,
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#ff2a3a',
  vfxKind: 'bolt',
};

export const obsidianSpikes: HeroSkill = {
  id: "obsidian_spikes",
  targetType: SkillTargetType.Ring,
  range: 3,
  aoeRadius: 1,
  damage: 0.7,
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.Root, magnitude: 1, duration: 2 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 3,
  vfxColor: '#4a2a52',
  vfxKind: 'nova',
};

export const dreadCharge: HeroSkill = {
  id: "dread_charge",
  targetType: SkillTargetType.Single,
  range: 3,
  selfMove: { kind: 'dash', range: 3 },
  damage: 1.5,
  pushDistance: 1,
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#c02028', vfxAftermath: "dust",
  vfxKind: 'slash',
};

export const runeDome: HeroSkill = {
  id: "rune_dome",
  targetType: SkillTargetType.Self,
  range: 0,
  aoeRadius: 1,
  // Flat pool, not attack-scaled: `resolveEffectMagnitude` only scales the DoTs,
  // so a Barrier means the same number wherever it comes from
  appliesEffect: { type: AuraType.Barrier, magnitude: 30, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 4,
  vfxColor: '#ff4a5a',
  vfxKind: 'nova',
};

export const armorBreaker: HeroSkill = {
  id: "armor_breaker",
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.2,
  appliesEffect: { type: AfflictionType.DefenseDown, magnitude: 5, duration: 2 },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#d0d0c0', vfxAftermath: "dust",
  vfxKind: 'slash',
  delivery: 'blunt',
};

export const meltAway: HeroSkill = {
  id: "melt_away",
  targetType: SkillTargetType.Self,
  range: 0,
  appliesEffect: { type: AuraType.Stealth, magnitude: 1, duration: BALANCE.STEALTH_DURATION },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 4,
  vfxColor: '#8a2a4a', vfxAftermath: "smoke",
  vfxKind: 'buff',
};

/**
 * The first Stun anything on the enemy side has ever applied.
 *
 * A Ring rather than a Single because the fantasy is the roof coming down, and
 * because `enemyAI` sums expected damage across everything an area catches —
 * which is what lets a 0.8 multiplier out-score a 1.2 single-target swing often
 * enough to be worth carrying, without being strictly better than it.
 */
export const caveIn: HeroSkill = {
  id: "cave_in",
  targetType: SkillTargetType.Ring,
  range: 3,
  aoeRadius: 1,
  damage: 0.8,
  appliesEffect: { type: AfflictionType.Stun, magnitude: 1, duration: 1 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 4,
  vfxColor: '#a08050', vfxAftermath: "dust",
  vfxKind: 'quake',
};

/**
 * Mining powder, used on people. Scales off `magic` — the Alchemist is the
 * Delve's caster and carries the magic to justify it, which `skillScaling` pins:
 * a magic-scaling skill on a brute with `magic <= 4` is a test failure.
 */
export const blastingCharge: HeroSkill = {
  id: "blasting_charge",
  targetType: SkillTargetType.Ring,
  range: 3,
  aoeRadius: 1,
  damage: 0.9,
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#ff9a3a', vfxAftermath: "embers",
  vfxKind: 'nova',
};

export const serratedDaggers: HeroSkill = {
  id: "serrated_daggers",
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 0.9,
  appliesEffect: { type: AfflictionType.Poison, magnitude: 0.3, duration: 3 },
  bonusVs: { condition: 'lowHp', multiplier: 1.6 },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#8a2a4a', vfxAftermath: "spatter",
  vfxKind: 'slash',
};

// ── The four frozen-north factions ──────────────────────────────────────────
//
// the private project notes is the design. These are its
// kits built from the shared vocabulary, which is what the rosters field until
// the battle epic adds what they cannot be built from — the elites' unique
// abilities, and the handful of regular mechanics the plan names that the
// engine has no field for (`docs/combat.md` lists them). Three rules
// set the numbers:
//
// - **A planned cadence is spelled one lower.** The plan writes "CD N" as cast
//   on turn T and ready on T+N; `cooldown` counts the turns *skipped*
//   (`withCooldownStarted` stores N + 1 and ticks before its owner acts), so the
//   plan's CD 3 is `cooldown: 2`.
// - **A status that must last a turn is spelled one higher** (the Root note
//   above): "two affected turns" of Chill, Shock or Bleed is `duration: 3`, and a
//   Silence that costs one turn is `2`. Stun and Freeze are read before the tick,
//   so their one turn is `1`.
// - **A skill whose point is a status out-damages its owner's at-will**, because
//   `enemyAI` scores expected damage and nothing else (`mireGrasp`'s note). Where
//   the plan drafted the opposite — a 0.6 Cold Grasp beside a 0.9 Frost Bolt,
//   a 0.9 Parting Shot beside a 1.0 Recurve Shot — the at-will came down a step
//   rather than the spell going unpressed for ever.
//
// Until a skill has a picture of its own it borrows the nearest one (`icon`),
// and `icons.test.ts` lists it as awaiting art.

/** The Glass Spitter's at-will: `rangedShot`'s numbers, in the blue its gut glows. */
export const glassShot: HeroSkill = {
  id: "glass_shot",
  gesture: 'spit', contact: 'glass',
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.7,
  unlockLevel: 1,
  manaCost: 0,
  // The plan's one fixed requirement for the at-will: the shot is the bright
  // blue of the model's abdomen, so a spitter is found by what it fires.
  vfxColor: '#3fc8ff', vfxThemed: true,
  vfxKind: 'bolt',
  delivery: 'natural',
  icon: 'ranged_shot',
};

export const scorpidSting: HeroSkill = {
  id: "scorpid_sting",
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.2,
  appliesEffect: { type: AfflictionType.Poison, magnitude: 0.3, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#c8e04a', vfxAftermath: "venom",
  vfxKind: 'slash',
  delivery: 'natural',
  icon: 'venom_bite',
};

export const acidSpit: HeroSkill = {
  id: "acid_spit",
  gesture: 'spit', contact: 'acid',
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.9,
  appliesEffect: { type: AfflictionType.DefenseDown, magnitude: 5, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#3fc8ff', vfxAftermath: "venom",
  vfxKind: 'bolt',
  delivery: 'natural',
  icon: 'poisoned_shot',
};

/** One spell landing both halves — the damage and the Silence are not two casts. */
export const sandSquall: HeroSkill = {
  id: "sand_squall",
  spell: 'sand',
  targetType: SkillTargetType.Ring,
  range: 3,
  aoeRadius: 1,
  damage: 0.6,
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.Silence, magnitude: 1, duration: 2 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#d8b878',
  vfxKind: 'nova',
  icon: 'silencing_depths',
};

/**
 * The Burrowmother's two stingers, one ranged action over two heroes.
 *
 * A `Chain` of one jump is exactly "up to two distinct heroes, once each": the
 * aimed hero, then the nearest one the first sting did not touch. With nobody
 * in reach of the second it stings once, which is the plan's proposed fallback,
 * and it never puts both stings into one body. The per-target sting is
 * `scorpidSting`'s — her stats are what make it hit harder.
 */
export const doubleSting: HeroSkill = {
  id: "double_sting",
  targetType: SkillTargetType.Chain,
  range: 3,
  chainJumps: 1,
  chainRange: 3,
  damage: 1.2,
  // Halved from 0.3 after a playtest: two doses a turn on two heroes outran every
  // way the party had of cleansing it.
  appliesEffect: { type: AfflictionType.Poison, magnitude: 0.15, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 1,
  vfxColor: '#c8e04a', vfxAftermath: "venom",
  vfxKind: 'bolt',
  delivery: 'natural',
  icon: 'venom_bite',
};

export const hoofKick: HeroSkill = {
  id: "hoof_kick",
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 0.8,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#c8a070', vfxAftermath: "dust",
  delivery: 'blunt',
  icon: 'bite',
};

export const lanceThrust: HeroSkill = {
  id: "lance_thrust",
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.0,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#d84a3a',
  vfxKind: 'slash',
  delivery: 'reach',
  icon: 'slash',
};

/**
 * A charge from further out than anything else on the board, and no push.
 *
 * The plan's Running Lance runs a straight lane and strikes every hero it
 * crosses. A dash lands *before* its strike resolves, so a `Line` paired with
 * one collapses to the hero beside the landing; what the shared vocabulary can
 * say is a five-hex dash and one strike. The lane is the battle epic's. The
 * no-push is the plan's own: displacement belongs to the Dread-Knight.
 */
export const runningLance: HeroSkill = {
  id: "running_lance",
  targetType: SkillTargetType.Single,
  range: 5,
  selfMove: { kind: 'dash', range: 5 },
  damage: 1.2,
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#d84a3a',
  vfxKind: 'slash',
  delivery: 'reach',
  icon: 'charge',
};

export const recurveShot: HeroSkill = {
  id: "recurve_shot",
  targetType: SkillTargetType.Single,
  range: 4,
  damage: 0.8,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#ffaa44',
  delivery: 'bow',
  icon: 'ranged_shot',
};

/** Shoot, then put two hexes between you and the answer — `hitAndRun` without the shove. */
export const partingShot: HeroSkill = {
  id: "parting_shot",
  targetType: SkillTargetType.Single,
  range: 4,
  damage: 0.9,
  selfMove: { kind: 'retreat', range: 2 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 1,
  vfxColor: '#ffaa44',
  delivery: 'bow',
  icon: 'hit_and_run',
};

/**
 * The Drummer's at-will, and the reason one Drummer is a storm on its own.
 *
 * It applies Shock, and its damage sets off a Shock already there through the
 * shared rule, so a single Drummer keeps its own interaction going between
 * Rolling Thunders. The plan keeps that on purpose and tunes the numbers if it
 * proves too much. It is a basic magic attack, so the battle plan's Silence
 * change will leave it usable.
 */
export const thunderbeat: HeroSkill = {
  id: "thunderbeat",
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.9,
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.Shock, magnitude: 1, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#7ab8ff',
  vfxKind: 'lightning',
  icon: 'thunderbolt',
};

export const rollingThunder: HeroSkill = {
  id: "rolling_thunder",
  targetType: SkillTargetType.Ring,
  range: 3,
  aoeRadius: 1,
  damage: 0.7,
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.Shock, magnitude: 1, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#7ab8ff',
  vfxKind: 'lightning',
  icon: 'static_burst',
};

/**
 * The Herd-Khan's at-will: the hex it swings at and the two beside it.
 *
 * One of the two arcs in the game with no cooldown, because it *is* the
 * attack — the plan gives the Khan no single-target swing to prefer it over.
 * `arcFootprint.test.ts` names both and holds them to that.
 */
export const glaiveSweep: HeroSkill = {
  id: "glaive_sweep",
  targetType: SkillTargetType.Arc,
  range: 1,
  aoeRadius: 1,
  damage: 1.0,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#e05040',
  vfxKind: 'arc',
  delivery: 'blade',
  icon: 'cleave',
};

export const spearJab: HeroSkill = {
  id: "spear_jab",
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 0.8,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#c8d0dd',
  vfxKind: 'slash',
  delivery: 'reach',
  icon: 'slash',
};

export const clubStrike: HeroSkill = {
  id: "club_strike",
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.0,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#bfe6f5',
  vfxKind: 'slash',
  delivery: 'blunt',
  icon: 'stone_fist',
};

export const clubSweep: HeroSkill = {
  id: "club_sweep",
  targetType: SkillTargetType.Arc,
  range: 1,
  aoeRadius: 1,
  damage: 1.2,
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#bfe6f5',
  vfxKind: 'arc',
  delivery: 'blunt',
  icon: 'cleave',
};

/**
 * The Glacier Hurler's throw, and the whole of what it does.
 *
 * The plan's Hurler has two skills and no attack: a turn raising the block and
 * a turn throwing it, the held block being the state that orders them. Nothing
 * in the engine holds such a state yet, so the raise is spelled as the cooldown
 * — throw, a turn without one, throw — which is the same rhythm with the lift
 * left out. The knock-up is the plan's picture of the Stun landing, so a hero
 * it lands on loses exactly one turn (`duration: 1`, read before the tick).
 */
export const hurlIceBlock: HeroSkill = {
  id: "hurl_ice_block",
  contact: 'iceBlock',
  targetType: SkillTargetType.Ring,
  range: 3,
  aoeRadius: 1,
  damage: 1.6,
  appliesEffect: { type: AfflictionType.Stun, magnitude: 1, duration: 1, chance: 0.3 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 1,
  vfxColor: '#bfe6f5', vfxAftermath: "rime",
  vfxKind: 'throw',
  delivery: 'thrown',
  icon: 'boulder_leap',
};

export const rimeNote: HeroSkill = {
  id: "rime_note",
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.9,
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#9fd8ff',
  vfxKind: 'bolt',
  icon: 'arcane_bolt',
};

/**
 * A barrier on the Skald and every giant near it, worth 1.2× the Skald's magic.
 *
 * A fraction rather than a flat pool, so it inflates with the band
 * (`resolveEffectMagnitude`). The plan leaves the Hold Thralls out of it; the
 * shared ring cannot tell a thrall from a giant, so a thrall standing in it is
 * shielded too until the battle epic gives a footprint a filter.
 */
export const shelterOfTheHold: HeroSkill = {
  id: "shelter_of_the_hold",
  targetType: SkillTargetType.Self,
  range: 0,
  aoeRadius: 2,
  scaling: 'magic',
  appliesEffect: { type: AuraType.Barrier, magnitude: 1.2, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 3,
  vfxColor: '#9fd8ff',
  vfxKind: 'nova',
  icon: 'rune_dome',
};

export const winterHorn: HeroSkill = {
  id: "winter_horn",
  gesture: 'warhorn',
  targetType: SkillTargetType.Ring,
  range: 3,
  aoeRadius: 1,
  damage: 0.6,
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.Chill, magnitude: 3, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#bfe6f5',
  vfxKind: 'snow',
  icon: 'blizzard',
};

export const axeHew: HeroSkill = {
  id: "axe_hew",
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.2,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#bfe6f5',
  vfxKind: 'slash',
  delivery: 'blade',
  icon: 'slash',
};

export const coldSpark: HeroSkill = {
  id: "cold_spark",
  targetType: SkillTargetType.Single,
  range: 2,
  damage: 0.7,
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#bfe6f5',
  vfxKind: 'bolt',
  icon: 'frostbite',
};

export const iceFist: HeroSkill = {
  id: "ice_fist",
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.0,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#bfe6f5', vfxAftermath: "rime",
  delivery: 'blunt',
  icon: 'stone_fist',
};

/**
 * About a quarter of the Sentinel's health again, in ice, on itself.
 *
 * The plan's "25% of maximum HP" has no field to say it in — a barrier scales
 * off a power stat, not off health — so it is authored against attack at the
 * ratio the Sentinel's own stat block puts the two in, and both inflate together
 * with the band. Self-only, so the AI weighs it at half an ally's worth: the
 * Sentinel raises it walking in and swings once it arrives.
 */
export const frozenBulwark: HeroSkill = {
  id: "frozen_bulwark",
  targetType: SkillTargetType.Self,
  range: 0,
  appliesEffect: { type: AuraType.Barrier, magnitude: 1.8, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 3,
  vfxColor: '#bfe6f5', vfxAftermath: "rime",
  vfxKind: 'buff',
  icon: 'ice_barrier',
};

export const shardShot: HeroSkill = {
  id: "shard_shot",
  targetType: SkillTargetType.Single,
  range: 4,
  damage: 1.0,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#bfe6f5', vfxThemed: true, vfxAftermath: "rime",
  // A crystal fired, not a spell cast: it flies as a shaft (physical), tinted ice
  vfxKind: 'shot',
  icon: 'ranged_shot',
};

/**
 * Everything on the line chills, and anything chilled already freezes.
 *
 * The escalation is the shared one in `combatStore.applyEffect`, so the lance
 * is the Hoarfrost's Chill-to-Freeze in one shot, as `frostLance` is the
 * Hydromancer's. Bodies do not stop it; the line runs from the caster to the
 * hero it is aimed at.
 */
export const icicleLance: HeroSkill = {
  id: "icicle_lance",
  targetType: SkillTargetType.Line,
  range: 4,
  damage: 1.2,
  appliesEffect: { type: AfflictionType.Chill, magnitude: 3, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#bfe6f5', vfxAftermath: "rime",
  vfxKind: 'shot',
  icon: 'frost_lance',
};

export const frostBolt: HeroSkill = {
  id: "frost_bolt",
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.8,
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#7fe8ff',
  vfxKind: 'bolt',
  icon: 'frostbite',
};

export const coldGrasp: HeroSkill = {
  id: "cold_grasp",
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.9,
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.Freeze, magnitude: 1, duration: 1 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 3,
  vfxColor: '#7fe8ff',
  vfxKind: 'bolt',
  icon: 'cold_snap',
};

export const snowblind: HeroSkill = {
  id: "snowblind",
  targetType: SkillTargetType.Ring,
  range: 3,
  aoeRadius: 1,
  damage: 0.6,
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.Chill, magnitude: 3, duration: 3 },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: '#7fe8ff',
  vfxKind: 'snow',
  icon: 'blizzard',
};

/** The Colossus's at-will, and the other arc with no cooldown — see `glaiveSweep`. */
export const glacierHammer: HeroSkill = {
  id: "glacier_hammer",
  targetType: SkillTargetType.Arc,
  range: 1,
  aoeRadius: 1,
  damage: 1.1,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#7fe8ff', vfxAftermath: "rime",
  vfxKind: 'arc',
  delivery: 'blunt',
  icon: 'cleave',
};

// `summon_elemental` and `summon_treant` moved to `data/skills/mastery/` — each
// is granted by exactly one node and carried by no template, so the neutrality
// this file demands was costing tuning and buying nothing. Whirlwind is the
// precedent. What stays here is what the *creatures* press.

/**
 * The fire elemental's whole kit: close, and hit.
 *
 * Zero mana for the hard reason `groundSlam` is — summons are built with
 * `maxMana: 0` and skill use is gated on mana — and no cooldown, because the
 * decay already bounds how many times it can ever be pressed.
 */
export const flareDash: HeroSkill = {
  id: "flare_dash",
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 1.2,
  selfMove: { kind: 'dash', range: 3 },
  manaCost: 0,
  unlockLevel: 1,
  vfxKind: 'bolt',
  vfxColor: '#ff8a1e', vfxAftermath: "embers",
};

/**
 * The stone elemental's leap, and the only thing on the roster that stuns.
 *
 * The blink resolves *before* the strike, so the radius-1 smash is computed
 * from the landing hex rather than from where it started — which is what makes
 * it a jump onto a group instead of a ranged attack.
 */
export const boulderLeap: HeroSkill = {
  id: "boulder_leap",
  targetType: SkillTargetType.Ring,
  range: 3,
  aoeRadius: 1,
  damage: 0.9,
  selfMove: { kind: 'blink', range: 3 },
  appliesEffect: { type: AfflictionType.Stun, magnitude: 1, duration: 1 },
  manaCost: 0,
  cooldown: 3,
  unlockLevel: 1,
  vfxKind: 'quake',
  vfxColor: '#9a8f7d', vfxAftermath: "dust",
};

export const timberCrush: HeroSkill = {
  id: "timber_crush",
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.7,
  manaCost: 0,
  // The Treant's basic attack, so it has none (remaster, 2026-10): with a
  // cooldown of 2 the creature spent every other turn walking. It still costs
  // the Treant's action like any skill, so this is one swing a turn, not more.
  unlockLevel: 1,
  vfxKind: 'slash',
  vfxColor: '#8ac070', vfxAftermath: "dust",
  delivery: 'blunt',
};

export const rootlashSweep: HeroSkill = {
  id: "rootlash_sweep",
  targetType: SkillTargetType.Arc,
  range: 2,
  aoeRadius: 2,
  damage: 0.6,
  appliesEffect: { type: AfflictionType.Root, magnitude: 1, duration: 2 },
  manaCost: 0,
  cooldown: 3,
  unlockLevel: 1,
  vfxKind: 'arc',
  vfxColor: '#8ac070',
  delivery: 'blunt',
};

/**
 * The Treant's third skill (Lifewarden remaster, 2026-10): bark Barriers on every
 * ally within two hexes, the Treant included.
 *
 * Sized from each **recipient's** maximum HP (`ofRecipientMaxHp`) rather than the
 * Treant's Magic, which is 6 and would make a shield nobody notices. A Self ring,
 * so the summon AI scores it per ally still missing a Barrier (`supportValue`).
 */
export const canopyGuard: HeroSkill = {
  id: "canopy_guard",
  targetType: SkillTargetType.Self,
  range: 0,
  aoeRadius: 2,
  appliesEffect: { type: AuraType.Barrier, magnitude: BALANCE.CANOPY_GUARD_MAX_HP, duration: 3, ofRecipientMaxHp: true },
  manaCost: 0,
  cooldown: 3,
  unlockLevel: 1,
  vfxKind: 'buff',
  vfxColor: '#8ac070', vfxAftermath: "motes",
  // Warding Bloom's bark until its own drawing is approved (`npm run icons:status`)
  icon: 'warding_bloom',
};

export const raiseDead: HeroSkill = {
  id: "raise_dead",
  targetType: SkillTargetType.Self,
  range: 0,
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 3,
  vfxKind: 'nova',
  vfxColor: '#7aff9a',
  summons: { templateId: 'risen_skeleton', count: 2, duration: 4 },
};

/** Every shared skill, for id lookups and validation. */
export const ALL_SKILLS: HeroSkill[] = [
  slash, groundSlam,
  meteor, heal, divineLight,
  arrowShot, poisonArrow, rainOfArrows, arcaneBolt, holyBolt,
  arcaneBurst, thornLash, throwKnife, disengage, meditate,
  maceStrike, stoneFist, bite, rangedShot, charge, darkBolt,
  ghostTouch,
  trollSmash, raiseDead,
  flareDash, boulderLeap, timberCrush, rootlashSweep, canopyGuard,
  cleave, hex, blight, web, venomBite, maul, cutpurse, rally, boneShards,
  poisonedShot, mireGrasp, caveIn, blastingCharge,
  legionAdvance, shieldWall, plasmaOrb, obsidianSpikes, dreadCharge,
  runeDome, armorBreaker, meltAway, serratedDaggers,
  glassShot, scorpidSting, acidSpit, sandSquall, doubleSting,
  hoofKick, lanceThrust, runningLance, recurveShot, partingShot,
  thunderbeat, rollingThunder, glaiveSweep,
  spearJab, clubStrike, clubSweep, hurlIceBlock, rimeNote,
  shelterOfTheHold, winterHorn, axeHew,
  coldSpark, iceFist, frozenBulwark, shardShot, icicleLance,
  frostBolt, coldGrasp, snowblind, glacierHammer,
];
