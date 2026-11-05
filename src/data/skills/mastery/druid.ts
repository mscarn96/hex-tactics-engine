import { casterManaCost } from '@/data/skills/casterMana';
import { HeroSkill, SkillTargetType, AfflictionType, AuraType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';

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

// ═══ DRUID ══════════════════════════════════════════════════════════════════

// ── Lifewarden — keep everyone standing ───────────────────────────────────────

export const lifebloomSkill: HeroSkill = {
  id: 'lifebloom_skill',
  targetType: SkillTargetType.Single, range: 3, healing: 0.68,
  appliesEffect: { type: AuraType.HealOverTime, magnitude: 4.25, duration: 3 },
  // Costed, unlike the other signatures: a free heal-plus-regrowth every single
  // turn is out-of-combat sustain with no decision in it — the Lifewarden
  // simply undid attrition by existing. Cheap enough to stay the staple, dear
  // enough that a long fight can still run the well dry.
  unlockLevel: TREE, manaCost: casterManaCost(8), vfxColor: '#44dd88', vfxKind: 'bloom',
};

export const wardingBloom: HeroSkill = {
  id: 'warding_bloom',
  targetType: SkillTargetType.Single, range: 3,
  // The early ally cleanse the Lifewarden was missing: the bark is thinner than
  // it was (30 to 18) because it now does two jobs, and it comes before
  // the capstones; the Evergreen cone that once cleansed the whole line is gone (2026-10).
  appliesEffect: { type: AuraType.Barrier, magnitude: BALANCE.WARDING_BLOOM_BARRIER, duration: 4 },
  cleanse: true,
  unlockLevel: TREE, manaCost: casterManaCost(14), cooldown: 2, vfxColor: '#44dd88', vfxAftermath: 'motes', vfxKind: 'buff',
};

export const emergencyBloom: HeroSkill = {
  id: 'emergency_bloom',
  // `healing` is the top end, on a target with almost nothing left. The curve is
  // what makes it a rescue and not a stronger Lifebloom: at 70% health it is
  // weaker than the staple, so it is never the right button until it is late.
  targetType: SkillTargetType.Single, range: 4, healing: 2.38,
  healingByMissing: { floor: BALANCE.SECOND_WIND_FLOOR, curve: BALANCE.SECOND_WIND_CURVE },
  unlockLevel: TREE, manaCost: casterManaCost(22), cooldown: 3, vfxColor: '#44dd88', vfxKind: 'bloom',
};

export const wellspring: HeroSkill = {
  id: 'wellspring',
  targetType: SkillTargetType.Self, range: 0, aoeRadius: 3, healing: 1.02,
  appliesEffect: { type: AuraType.HealOverTime, magnitude: 6.8, duration: 3 },
  unlockLevel: TREE, manaCost: casterManaCost(32, true), cooldown: 5, vfxColor: '#44dd88', vfxKind: 'bloom',
  vfxPrelude: 'gather', vfxAftermath: 'motes',
  // A spell: read off its shape (a ring round the caster) it was a staff's weight, and
  // `isNature` grows vines only from spells (PT-18)
  delivery: 'spell',
};

export const rootedVitality: HeroSkill = {
  id: 'rooted_vitality',
  // Lays no Root on anybody: the name is the plant, not the status. The old
  // flavour line said "sink roots into an ally", which read as a Root.
  // Was a passive that trickled health into the Lifewarden alone. As a cast it
  // is the same budget aimed wherever the party is actually bleeding, and the
  // cooldown outlasting the duration is what stops it being permanent uptime
  // on the whole roster.
  targetType: SkillTargetType.Single, range: 3,
  appliesEffect: { type: AuraType.HealOverTime, magnitude: 10.2, duration: 3 },
  unlockLevel: TREE, manaCost: casterManaCost(14), cooldown: 4, vfxColor: '#44dd88', vfxKind: 'bloom',
};

/**
 * The Lifewarden's ground-control capstone, replacing Evergreen (remaster, 2026-10).
 *
 * The cast is an ordinary aimed area that heals allies and hurts enemies — the
 * per-side rule every split skill uses — and then the footprint stays: it pulses
 * the same `healing` and `damage` at the start of each of the Lifewarden's next
 * three regular turns (`sanctuary`). The Root is not in `appliesEffect` because
 * it is owed once per enemy per cast, on the first pulse that catches it, which
 * the hazard remembers; a plain effect would land again on every recast pulse.
 */
export const wildSanctuary: HeroSkill = {
  id: 'wild_sanctuary',
  targetType: SkillTargetType.Ring, range: 4, aoeRadius: 2,
  damage: 0.425, healing: 0.383, scaling: 'magic',
  sanctuary: { turns: BALANCE.WILD_SANCTUARY_TURNS, rootTurns: BALANCE.WILD_SANCTUARY_ROOT_TURNS },
  unlockLevel: TREE, manaCost: casterManaCost(34, true), cooldown: 5, vfxColor: '#7ee08a', vfxKind: 'bloom', spell: 'nature',
  vfxPrelude: 'gather', vfxAftermath: 'motes',
  // Evergreen's drawing until its own is approved (`npm run icons:status`)
  icon: 'evergreen',
};

/**
 * The Lifewarden's treant, moved off the shared pool.
 *
 * Granted by exactly one node and carried by no template, so keeping it neutral
 * cost tuning and bought nothing. Aimed placement is what makes the arrival
 * heal a decision: the tree lands where the party is bleeding.
 *
 * It sat in the Stoneshaper block below for its whole existence, under this same
 * comment naming the path it actually belongs to — see the header note on why
 * nothing caught that.
 */
export const summonTreant: HeroSkill = {
  id: 'summon_treant',
  targetType: SkillTargetType.Single, range: 3,
  unlockLevel: TREE, manaCost: casterManaCost(30, true), cooldown: 4,
  // Arrives as a column of light on the hex it comes up through: a body appearing
  // under a heal's soft bloom read as the heal, not as something waking
  vfxColor: '#8ac070', vfxKind: 'surge', vfxAftermath: 'motes',
  summons: {
    templateId: 'treant',
    count: 1,
    duration: 6,
    placement: 'aimed',
    arrivalEffect: { kind: 'heal', radius: 1, amount: 1.0 },
  },
};

// ── Stoneshaper — earth and denial ────────────────────────────────────────────

/**
 * The path's signature, and the shape of everything after it.
 *
 * It replaced Entangle, which rooted one target: Root was the old Stoneshaper's
 * whole identity, and the path is control and shields now. A quarter chance per
 * enemy is what lets a cheap, low-cooldown arc carry a status as hard as Stun
 * without being an at-will lockdown — and rolled per target it reads as the
 * ground giving way under some of them rather than a coin flip on the fight.
 *
 * An Arc's depth is its `aoeRadius`; `range` is how far it may be aimed.
 */
export const tremor: HeroSkill = {
  id: 'tremor',
  targetType: SkillTargetType.Arc, range: 2, aoeRadius: 2, damage: 0.6, scaling: 'magic',
  appliesEffect: { type: AfflictionType.Stun, magnitude: 1, duration: 1, chance: 0.25 },
  unlockLevel: TREE, manaCost: casterManaCost(6), cooldown: 2, vfxColor: '#c8a878', vfxKind: 'quake',
};

export const stoneskin: HeroSkill = {
  id: 'stoneskin',
  targetType: SkillTargetType.Single, range: 3,
  scaling: 'magic',
  // The Barrier was doubled in the remaster (0.35 to 0.7 of Magic, 2026-10); the
  // Defense buff and both durations were deliberately left as they were.
  appliesEffect: [{ type: AuraType.DefenseBuff, magnitude: 8, duration: 4 }, { type: AuraType.Barrier, magnitude: BALANCE.STONESKIN_BARRIER, duration: 3 }],
  unlockLevel: TREE, manaCost: casterManaCost(12), cooldown: 3, vfxColor: '#c8a878', vfxPrelude: 'brace', vfxAftermath: 'dust', vfxKind: 'buff',
};

/**
 * The path's area control, replacing Thornfield.
 *
 * Thorns punished an enemy for a choice it had already made; this takes the
 * choice away. That is what the rest of the path is about, and it is what the
 * Lifewarden beside it cannot do.
 */
export const graspingEarth: HeroSkill = {
  id: 'grasping_earth',
  targetType: SkillTargetType.Ring, range: 3, aoeRadius: 2,
  damage: 0.5, scaling: 'magic',
  appliesEffect: { type: AfflictionType.Root, magnitude: 1, duration: 2 },
  unlockLevel: TREE, manaCost: casterManaCost(20), cooldown: 3, vfxColor: '#c8a878', vfxKind: 'quake',
};

/**
 * A shield, and the reason `shieldPowerBonus` exists.
 *
 * `magnitude: 0.9` is under 5, so it rides the scaled path — and
 * `scaling: 'magic'` is therefore **required**, or the fraction resolves
 * against the Druid's attack of 5. `grantsAura` is what makes the caster's own
 * hex a legal target, so a lone Stoneshaper can ward itself.
 */
export const stoneWard: HeroSkill = {
  id: 'stone_ward',
  // The Stoneshaper's one cleanse, hosted here because this is already the skill
  // that answers "my ally is in trouble" and it is the one place the path's
  // shielding identity and a cleanse meet. The visible tradeoff is that the
  // cleansing shell is the weakest in the kit: a smaller shell (0.9 to 0.7 of
  // Magic), more mana (12 to 16) and a longer cooldown (2 to 3) than the
  // cleanse-less ward it replaced. Nothing here restores mana or shortens a cooldown.
  targetType: SkillTargetType.Single, range: 3, scaling: 'magic',
  appliesEffect: { type: AuraType.Barrier, magnitude: BALANCE.STONE_WARD_BARRIER, duration: 3 },
  cleanse: true,
  unlockLevel: TREE, manaCost: casterManaCost(16), cooldown: 3, vfxColor: '#c8a878', vfxPrelude: 'brace', vfxAftermath: 'dust', vfxKind: 'buff',
};

/**
 * The path's stun, and its only one.
 *
 * Was a range-3 radius-2 ring that rooted — which is what Grasping Earth is
 * now, and two skills doing the same thing meant one of them was always the
 * wrong button. An arc at the Stoneshaper's own feet is the close-range answer
 * the ranged half of the path was missing.
 */
export const upheaval: HeroSkill = {
  id: 'upheaval',
  gesture: 'rampart',
  targetType: SkillTargetType.Single, range: 3,
  places: { kind: 'rampart', count: 2, placement: 'aimed', hpFraction: BALANCE.RAMPART_HP_SHARE,
    defense: BALANCE.RAMPART_DEFENSE, turnsLeft: BALANCE.RAMPART_TURNS },
  unlockLevel: TREE, manaCost: casterManaCost(16), cooldown: 3, vfxColor: '#c8a878', vfxKind: 'quake',
};

/**
 * The capstone: three casts, and the thing being built can be killed.
 *
 * `summon_stone_elemental` was one button that put a wall on the board, which
 * is a capstone with no decision in it. Aimed placement makes *where* a real
 * question, and the stages make it a commitment the enemy gets two turns to
 * answer — the rock has 90 HP, 25 defence and no way to defend itself.
 *
 * The stage chain needs no state of its own: while a live rock summoned by this
 * caster is standing, the targeting pass offers only its hex and the resolver
 * advances it. The last stage is permanent — nothing here carries a duration.
 */
export const stoneHeart: HeroSkill = {
  id: 'stone_heart',
  // No cooldown between the three paid stages (remaster, 2026-10): each is still a
  // cast and a mana payment. The lock is the living elemental itself
  // (`finishedStageUnit`), freed the moment it dies or is removed; a stage rock
  // broken mid-build simply resets the chain to a fresh stone.
  targetType: SkillTargetType.Single, range: 3,
  unlockLevel: TREE, manaCost: casterManaCost(18, true),
  vfxColor: '#c8a878', vfxKind: 'quake', vfxAftermath: 'dust',
  summons: {
    templateId: 'stone_heart_rock',
    count: 1,
    placement: 'aimed',
    stages: ['stone_heart_rock', 'stone_heart_stack', 'stone_elemental'],
  },
};

export const livingStone: HeroSkill = {
  id: 'living_stone',
  // Knockback resolves per target inside the area loop, so this shoves a whole
  // cluster off the Stoneshaper at once. That is the path's actual answer to
  // being closed on: it does not out-damage a Berserker, it un-arranges the fight.
  //
  // Drawn as `upheaval` (remaster, 2026-10): cracks, slabs ripping free and flung
  // away from the caster, a heavy impact — and the pushed bodies are thrown on that
  // impact beat. Damage, area and push are unchanged.
  targetType: SkillTargetType.Ring, range: 3, aoeRadius: 2,
  damage: 1.4, scaling: 'magic', pushDistance: 2,
  unlockLevel: TREE, manaCost: casterManaCost(30, true), cooldown: 4, vfxColor: '#c8a878', vfxKind: 'upheaval',
  vfxPrelude: 'gather', vfxAftermath: 'dust',
};

export const bedrockStand: HeroSkill = {
  id: 'bedrock_stand',
  // Arena-wide (remaster, 2026-10), like Burning Out: every living enemy and every
  // living ally in the arena, the caster included, wherever they stand. It was a
  // radius-9 ring round the caster that handed the flash and the camera a circle
  // of empty and off-board hexes; now the footprint is the bodies themselves.
  //
  // One cast serving both sides, which the per-entry side rule has always
  // supported: the affliction crosses to enemies, the Barrier stays on allies.
  // `thornrow` is the precedent. Damage came down from 1.0 to pay for it — the
  // party-wide shield is what the capstone is for, not the number.
  targetType: SkillTargetType.Ring, range: 0, arenaWide: true,
  damage: 0.6, scaling: 'magic',
  appliesEffect: [
    { type: AfflictionType.DefenseDown, magnitude: 6, duration: 3 },
    { type: AuraType.Barrier, magnitude: 0.6, duration: 3 },
  ],
  unlockLevel: TREE, manaCost: casterManaCost(36, true), cooldown: 5, vfxColor: '#a08858', vfxKind: 'quake',
  vfxPrelude: 'gather', vfxAftermath: 'dust',
};

// ── Wildshape — become the animal ─────────────────────────────────────────────
//
// Two kinds of skill live here. The **shift** skills swap the Druid's whole kit
// for a beast's; the **form** skills are what that beast presses once worn. A
// shift skill cast while already wearing its own shape turns the Druid back, so
// one button covers both directions and no "revert" entry clutters the bar.
//
// Form skills cost no mana and are deliberately strong for it: the mana was
// already paid at the shift, and a Druid stuck in bear shape has given up
// healing, ranged damage and every spell they own to be there.
//
// Every shape carries exactly two skills innately — **a free basic attack with
// no cooldown, and a signature**. The basic is not a courtesy: a form whose
// whole kit is on cooldown is a turn spent walking, which is precisely what a
// Hawk holding only Dive and Screech was. Everything past those two is learned
// from the shape's own branch of the tree and carries `formSkill`, so it lives
// on `hero.skills` with everything else and only reaches the bar with the right
// paws under it.

export const bearForm: HeroSkill = {
  id: 'bear_form',
  targetType: SkillTargetType.Self, range: 0, shiftsTo: 'bear',
  unlockLevel: TREE, manaCost: 10, cooldown: 1, vfxColor: '#aa7744', vfxPrelude: 'gather', vfxAftermath: 'dust', vfxKind: 'surge',
};

export const wolfForm: HeroSkill = {
  id: 'wolf_form',
  targetType: SkillTargetType.Self, range: 0, shiftsTo: 'wolf',
  unlockLevel: TREE, manaCost: 10, cooldown: 1, vfxColor: '#8899aa', vfxPrelude: 'gather', vfxAftermath: 'dust', vfxKind: 'surge',
};

export const hawkForm: HeroSkill = {
  id: 'hawk_form',
  targetType: SkillTargetType.Self, range: 0, shiftsTo: 'hawk',
  unlockLevel: TREE, manaCost: 12, cooldown: 1, vfxColor: '#c8b070', vfxPrelude: 'gather', vfxAftermath: 'dust', vfxKind: 'surge',
};

/**
 * The three-turn burst shape (remaster, 2026-10).
 *
 * Entering keeps the action, from Druid form or from another animal
 * (`shiftEndsTurn`), so the three turns hold three spells. `setWildForm` puts the
 * `Apex` clock on and clears the spent spells; `nextTurn` reverts the Druid when the
 * clock runs out or all three spells are spent. The `cooldown` here is the wait
 * from the reversion, started by `setWildForm` on leaving the shape — never at the
 * entry, so the button stays free to revert by hand.
 */
export const apexForm: HeroSkill = {
  id: 'apex_form',
  targetType: SkillTargetType.Self, range: 0, shiftsTo: 'apex',
  unlockLevel: TREE, manaCost: 25, cooldown: BALANCE.APEX_COOLDOWN, vfxColor: '#9dff6a', vfxKind: 'surge',
};

// Bear — the taunting shape. The only form carrying threat, which is what makes
// picking a form a decision rather than a stat swap.

export const maul: HeroSkill = {
  id: 'maul',
  contact: 'claw',
  // Says the taunt out loud. It is a free, cooldown-less attack that taunts on
  // every swing, so anything the bear stays next to is permanently locked onto
  // it — which is the shape's whole job, and read as a bug for one version
  // because "makes it personal" did not tell anybody it was happening.
  targetType: SkillTargetType.Single, range: 1, damage: 1.3,
  appliesEffect: { type: AfflictionType.Taunt, magnitude: 2, duration: 2 },
  unlockLevel: TREE, manaCost: 0, formSkill: 'bear', vfxColor: '#aa7744', vfxAftermath: 'spatter',
};

export const roar: HeroSkill = {
  id: 'roar',
  gesture: 'bearRoar',
  targetType: SkillTargetType.Ring, range: 0, aoeRadius: 1,
  appliesEffect: { type: AfflictionType.Taunt, magnitude: 3, duration: 2 },
  unlockLevel: TREE, manaCost: 0, cooldown: 3, formSkill: 'bear',
  vfxColor: '#aa7744', vfxKind: 'nova',
};

export const bearSlam: HeroSkill = {
  id: 'bear_slam',
  targetType: SkillTargetType.Ring, range: 0, aoeRadius: 1, damage: 0.9,
  appliesEffect: { type: AfflictionType.DefenseDown, magnitude: 6, duration: 3 },
  unlockLevel: TREE, manaCost: 0, cooldown: 3, formSkill: 'bear',
  vfxColor: '#aa7744', vfxKind: 'meteor',
};

/**
 * The bear's sustain, paid in regeneration rather than in a heal.
 *
 * `healing` scales off magic, and every beast profile cuts magic hard — a Druid
 * on four legs has stopped being a caster, which is the trade the whole path is
 * built on. A flat heal-over-time is the one form of mending a shape with 0.4×
 * magic can still deliver honestly.
 */
export const hibernate: HeroSkill = {
  id: 'hibernate',
  targetType: SkillTargetType.Self, range: 0,
  appliesEffect: [
    { type: AuraType.HealOverTime, magnitude: 14, duration: 3 },
    { type: AuraType.DefenseBuff, magnitude: 8, duration: 3 },
  ],
  unlockLevel: TREE, manaCost: 0, cooldown: 5, formSkill: 'bear',
  vfxColor: '#aa7744', vfxAftermath: 'motes', vfxKind: 'bloom',
};

// Wolf — the closing shape. Both skills move you, because a wolf that stands
// still is just a worse bear.

export const pounce: HeroSkill = {
  id: 'pounce',
  contact: 'bite',
  targetType: SkillTargetType.Single, range: 3, damage: 1.2,
  selfMove: { kind: 'dash', range: 3 },
  appliesEffect: { type: AfflictionType.Bleed, magnitude: 0.3, duration: 2 },
  unlockLevel: TREE, manaCost: 0, cooldown: 2, formSkill: 'wolf', vfxColor: '#8899aa', vfxAftermath: 'spatter',
};

export const rip: HeroSkill = {
  id: 'rip',
  contact: 'claw',
  targetType: SkillTargetType.Single, range: 1, damage: 1.1,
  bonusVs: { condition: 'bleeding', multiplier: 1.5 },
  appliesEffect: { type: AfflictionType.Bleed, magnitude: 0.35, duration: 3 },
  unlockLevel: TREE, manaCost: 0, formSkill: 'wolf', vfxColor: '#8899aa', vfxAftermath: 'spatter',
};

export const throatTear: HeroSkill = {
  id: 'throat_tear',
  contact: 'bite',
  targetType: SkillTargetType.Single, range: 1, damage: 1.5,
  bonusVs: { condition: 'bleeding', multiplier: 1.8 },
  lifesteal: 0.25,
  unlockLevel: TREE, manaCost: 0, cooldown: 3, formSkill: 'wolf', vfxColor: '#8899aa', vfxAftermath: 'spatter',
};

/**
 * The Wolf's own hunt (remaster, 2026-10): stronger than the old party shout and
 * the Wolf's alone. One `BloodHowl` aura carries the Attack (its magnitude) and the
 * Critical Chance, read only while the Druid is a Wolf, so the benefit cannot ride
 * into another shape; leaving Wolf form takes the aura off. While it lasts each
 * direct critical hit queues an extra turn, bounded by `BLOOD_HOWL_TURN_CAP` between
 * two regular Wolf turns — see `combatStore.queueHowlTurn`.
 */
export const bloodHowl: HeroSkill = {
  id: 'blood_howl',
  gesture: 'wolfHowl',
  targetType: SkillTargetType.Self, range: 0,
  appliesEffect: { type: AuraType.BloodHowl, magnitude: 12, duration: 3, selfOnly: true },
  unlockLevel: TREE, manaCost: 0, cooldown: 5, formSkill: 'wolf',
  vfxColor: '#c0404a', vfxKind: 'nova',
};

// Hawk — the harassing shape. No melee worth the name; it goes where it likes
// and makes other people's turns worse.

/**
 * The hawk's at-will, and the reason it has one.
 *
 * Dive and Screech are both on cooldowns, so a Hawk that had only those spent
 * every second turn flying in circles — a shape whose whole identity is going
 * where it likes, with nothing to do once it arrived. Range 2 rather than 1
 * because a bird that has to land to attack is not the fantasy.
 */
export const talons: HeroSkill = {
  id: 'talons',
  contact: 'claw',
  // 1.15 rather than 1.0. An at-will is the floor of a shape's output — it is
  // what the turn is worth once the cooldowns are spent — and the Hawk's floor
  // was the lowest of the four while its survivability was also the lowest.
  // Still under the Apex's 1.4 and the Wolf's bleeding opener, because this one
  // strikes from two hexes and never has to stand anywhere dangerous. (The
  // playtest of 2026-10-14 raised the Hawk's attack multiplier instead: Talons at
  // 1.3 as well put the Bear and the Wolf outside `wildForms.test.ts`'s band.)
  // 1.15 → 1.25 in the playtest of 2026-10-24, which asked for ratios over defence.
  targetType: SkillTargetType.Single, range: 2, damage: 1.25,
  // Drawn as the claw rakes a `natural` blow leaves on the body (`slash`), not a
  // flying `bolt`: with no `vfxKind` a two-hex Single was derived as a magic
  // missile, which the playtest of 2026-10-14 read as exactly that.
  unlockLevel: TREE, manaCost: 0, formSkill: 'hawk', vfxColor: '#c8b070', vfxKind: 'slash', vfxAftermath: 'spatter',
};

export const dive: HeroSkill = {
  id: 'dive',
  contact: 'claw',
  // 1.85 (1.7 until the playtest of 2026-10-24), and this is where the shape's identity is bought. Dive is the only
  // skill in the game that strikes from four hexes and then withdraws two, so
  // it is the one attack that can be made with no exposure at all — which is
  // exactly the thing that should hit hardest on a body that cannot take a
  // counter. At 1.3 it was a worse Antler Charge on a squishier frame.
  //
  // Drawn as the flight it is (remaster, 2026-10): the Hawk rises, folds, dives onto
  // the victim — the talon slash and the number land at that contact — then climbs
  // away to the retreat hex (`movement.mode === 'swoop'`). It was a `meteor` falling
  // on the victim while the bird stood still. The flight is a picture: the Hawk
  // still strikes from where it stood and still only occupies its start and landing.
  //
  // It lands two hexes from the victim (`landAt`, playtest 2026-10-14) — Talons'
  // reach — instead of withdrawing two further from wherever it struck, which
  // left it up to six away.
  targetType: SkillTargetType.Single, range: 4, damage: 1.85,
  selfMove: { kind: 'retreat', range: 2, landAt: 2 },
  unlockLevel: TREE, manaCost: 0, cooldown: 2, formSkill: 'hawk',
  vfxColor: '#c8b070', vfxAftermath: 'dust', vfxKind: 'slash',
};

export const screech: HeroSkill = {
  id: 'screech',
  gesture: 'hawkScreech',
  targetType: SkillTargetType.Ring, range: 2, aoeRadius: 1,
  appliesEffect: { type: AfflictionType.AttackDown, magnitude: 5, duration: 2 },
  unlockLevel: TREE, manaCost: 0, cooldown: 3, formSkill: 'hawk',
  vfxColor: '#c8b070', vfxKind: 'nova',
};

export const cyclone: HeroSkill = {
  id: 'cyclone',
  // No Root any more (remaster, 2026-10): the designer asked for it gone. The damage and
  // the push are kept, and the cooldown comes down from 4 to 3 to pay for the lost
  // hold rather than substituting another disable nobody selected.
  targetType: SkillTargetType.Ring, range: 3, aoeRadius: 1, damage: 1.0,
  pushDistance: 1,
  unlockLevel: TREE, manaCost: 0, cooldown: 3, formSkill: 'hawk',
  vfxColor: '#c8b070', vfxKind: 'cyclones',
};

// Apex — the capstone shape. Upright, antlered, and the only form that still
// remembers how to mend something.

// Each Apex spell is used once per Apex shape (`unit.apexSpent`, checked by
// `canUseSkill`), so none carries a cooldown: the charge is the limit.

/**
 * Crowned Prey (replaces Antler Strike, remaster 2026-10): Apex's focused spell. A
 * heavy hit, and a crown left on the victim that adds magic damage to the next two
 * damaging hits the party lands on it. The bonus is fixed from the Apex's Attack
 * when the crown is laid, so it outlasts the shape it came from.
 */
export const crownedPrey: HeroSkill = {
  id: 'crowned_prey',
  targetType: SkillTargetType.Single, range: 2, damage: 2.2,
  marks: { type: AfflictionType.CrownedPrey, charges: 2, duration: 3, bonus: 0.5 },
  icon: 'antler_strike',
  unlockLevel: TREE, manaCost: 0, formSkill: 'apex', vfxColor: '#9dff6a', vfxKind: 'meteor',
  vfxAftermath: 'motes',
};

/**
 * Antler Charge (remaster, 2026-10): a dash to the enemy, then a radius-2 burst
 * round where it lands rather than one shoved victim. The push is gone with the
 * single target.
 */
export const antlerCharge: HeroSkill = {
  id: 'antler_charge',
  targetType: SkillTargetType.Single, range: 4, aoeRadius: 2, damage: 1.5,
  selfMove: { kind: 'dash', range: 4 }, landingBurst: true,
  unlockLevel: TREE, manaCost: 0, formSkill: 'apex', vfxColor: '#9dff6a', vfxKind: 'nova',
  vfxAftermath: 'dust',
};

/**
 * The capstone's ultimate: a stamp of the antlers that breaks the ground around
 * where it lands.
 *
 * A targeted area (range 3, radius 2: nineteen hexes) since the playtest of
 * 2026-10-14. It was `arenaWide` — every enemy wherever it stood — which made the
 * Apex's last word the same cast in every fight; an area asks where the enemy is
 * bunched. Three payloads on one cast (damage, Root, AttackDown); Root and Attack
 * Down follow the ordinary immunity rules, the damage lands on every enemy in it.
 */
export const primalWrath: HeroSkill = {
  id: 'primal_wrath',
  targetType: SkillTargetType.Ring, range: 3, aoeRadius: 2, damage: 1.3,
  appliesEffect: [
    { type: AfflictionType.Root, magnitude: 1, duration: 2 },
    { type: AfflictionType.AttackDown, magnitude: 8, duration: 3 },
  ],
  unlockLevel: TREE, manaCost: 0, formSkill: 'apex',
  vfxColor: '#9dff6a', vfxKind: 'ignite', vfxPrelude: 'gather', vfxAftermath: 'motes',
};

// ═══ Added by the v3 tree rework ═════════════════════════════════════════════

/**
 * The Lifewarden's fourth active, and its everyday reach into the enemy.
 *
 * One cast doing opposite things to the two sides, which the resolver has always
 * supported (`bedrock_stand`, `wild_sanctuary`): `healing` lands on allies,
 * `damage` and the Root on enemies, the regeneration on allies.
 */
export const thornrow: HeroSkill = {
  id: 'thornrow',
  // A radius-1 patch rather than the old range-4 line (remaster, 2026-10): the
  // line had to be aimed down a lane holding both sides to be worth more than
  // either half of it, which almost never happened. Seven hexes against a line's
  // four is why both halves came down (0.8 / 0.9 to 0.6 / 0.7). Broad Bloom
  // widens it to radius 2 like any other area.
  targetType: SkillTargetType.Ring, range: 4, aoeRadius: 1,
  damage: 0.51, healing: 0.595, scaling: 'magic',
  appliesEffect: [
    { type: AfflictionType.Root, magnitude: 1, duration: 2 },
    { type: AuraType.HealOverTime, magnitude: 5.1, duration: 2 },
  ],
  unlockLevel: TREE, manaCost: casterManaCost(18), cooldown: 3, vfxColor: '#44dd88', vfxKind: 'quake', spell: 'nature',
};

// ── Wildshape: the second two form skills per shape ───────────────────────────
//
// Each shape learns **four** now rather than two. Two learnable skills on top of
// two innate ones left every animal with a kit that was entirely on cooldown
// every second turn, which is the same complaint the Hawk's at-will was added to
// answer — one shape at a time rather than as a rule.
//
// Form skills cost no mana, always: the mana was paid at the shift, and a beast
// is built against a pool it does not have.

/**
 * Bear: the hold, reached by a leap (remaster, 2026-10; was Bear Hug).
 *
 * The same strike and two-turn Stun, after a short approach drawn as a jump —
 * crouch, spring, arc and land with the impact (`movement.mode === 'jump'`). The
 * jump is a picture of the dash: Root still refuses it and the landing is the
 * ordinary nearest free hex beside the target, so it grants no new traversal.
 * Borrows Boulder Leap's picture until its own (a leaping bear) is drawn.
 */
export const crushingLeap: HeroSkill = {
  id: 'crushing_leap',
  targetType: SkillTargetType.Single, range: 2, damage: 1.1,
  selfMove: { kind: 'dash', range: 2 },
  appliesEffect: { type: AfflictionType.Stun, magnitude: 1, duration: 2 },
  icon: 'boulder_leap',
  unlockLevel: TREE, manaCost: 0, cooldown: 5, formSkill: 'bear', vfxColor: '#aa7744', vfxAftermath: 'dust',
};

/**
 * Bear: the answer to control, which no shape had.
 *
 * A Druid who shifts into the tank and is then rooted or silenced has spent a
 * turn and a shift to stand still, and reverting costs the turn as well
 * (`shiftEndsTurn`) — so being caught was strictly worse in beast shape than
 * upright. `cleanse` is what makes committing to the shape survivable.
 */
export const bearShrug: HeroSkill = {
  id: 'bear_shrug',
  targetType: SkillTargetType.Self, range: 0, cleanse: true,
  appliesEffect: { type: AuraType.Barrier, magnitude: 28, duration: 3 },
  unlockLevel: TREE, manaCost: 0, cooldown: 5, formSkill: 'bear',
  vfxColor: '#aa7744', vfxPrelude: 'brace', vfxAftermath: 'dust', vfxKind: 'buff',
};

/**
 * Wolf: the escape (remaster, 2026-10; replaces Hamstring, whose Root and Bleed
 * repeated what Rip and Pounce already do). Root and Chill come off first, so it is
 * the one way a Rooted Wolf can leave; then a move to a chosen free hex within two,
 * and Dodge for the enemies' answer. Borrows Hamstring's picture until drawn.
 */
export const slipTheNet: HeroSkill = {
  id: 'slip_the_net',
  targetType: SkillTargetType.Single, range: 2,
  selfMove: { kind: 'free', range: 2 }, slipsBonds: true,
  appliesEffect: { type: AuraType.Evasive, magnitude: 30, duration: 2, selfOnly: true },
  icon: 'wolf_hamstring',
  unlockLevel: TREE, manaCost: 0, cooldown: 4, formSkill: 'wolf', vfxColor: '#8899aa', vfxAftermath: 'dust', vfxKind: 'buff',
};

/**
 * Wolf: the area finisher (remaster, 2026-10; replaces Takedown, whose push sent
 * its melee victim out of reach). Every adjacent enemy, harder on the wounded, no
 * forced movement and no extra Bleed. Borrows Takedown's picture until drawn.
 */
export const rendingCircle: HeroSkill = {
  id: 'rending_circle',
  targetType: SkillTargetType.Ring, range: 0, aoeRadius: 1, damage: 1.1,
  bonusVs: { condition: 'wounded', multiplier: 1.5 },
  icon: 'wolf_takedown',
  unlockLevel: TREE, manaCost: 0, cooldown: 3, formSkill: 'wolf', vfxColor: '#c0404a', vfxKind: 'spin',
};

/**
 * Hawk: the broad pass (remaster, 2026-10). A depth-3 cone — 15 hexes, 120° wide —
 * instead of the thin range-4 line: the same damage type and one-hex push, away
 * from the Hawk, so the preview, the shove and the wedge all read one footprint.
 * 1.0 to 0.9 for nearly four times the ground.
 */
export const hawkShear: HeroSkill = {
  id: 'hawk_shear',
  targetType: SkillTargetType.Arc, range: 3, aoeRadius: 3, damage: 0.9, pushDistance: 1,
  unlockLevel: TREE, manaCost: 0, cooldown: 3, formSkill: 'hawk', vfxColor: '#e2d8a0', vfxKind: 'arc',
};

/**
 * Hawk: the setup (remaster, 2026-10; replaces Skyward). A strike that leaves a
 * gold feather over the victim: the Hawk's next two damaging attacks on it deal
 * 40% more, one charge each. Only this Hawk's own form attacks read it; an ally's
 * hit leaves it standing. Skyward's escape is gone, so the cooldown stays short
 * and Dive's retreat is the shape's way out. Borrows Skyward's picture until drawn.
 */
export const huntersMark: HeroSkill = {
  id: 'hunters_mark',
  gesture: 'mark', contact: 'claw',
  targetType: SkillTargetType.Single, range: 4, damage: 1.2,
  marks: { type: AfflictionType.HuntersMark, charges: 2, duration: 3, bonus: 0.4 },
  icon: 'hawk_skyward',
  unlockLevel: TREE, manaCost: 0, cooldown: 3, formSkill: 'hawk', vfxColor: '#f2c84a', vfxAftermath: 'motes', vfxKind: 'bolt',
};

// ── Wildshape capstones usable in every shape (remaster, 2026-10) ─────────────
//
// They replace Feral Heart and Primal Bond, which both paid the Druid for going
// back to the upright kit. Exclusive with Apex and with each other, as the old
// capstones were. `anyForm` puts them on the bar in Druid form and in Bear, Wolf
// and Hawk; like form skills they cost no mana, and their cooldowns are the price.

/**
 * Primal Surge: cleanse, bring the Bear/Wolf/Hawk skills' cooldowns two turns
 * forward, and act again (`freeAction`: the cast does not spend the turn). One
 * bounded extra action on a long cooldown; shift skills and capstones are not
 * refreshed. Borrows Roar's picture until its own is drawn.
 */
export const primalSurge: HeroSkill = {
  id: 'primal_surge',
  targetType: SkillTargetType.Self, range: 0, cleanse: true,
  refreshesFormSkills: 2, freeAction: true, anyForm: true,
  // 8 turns at the middle rung: 9 / 8 / 7 by node rank
  perRank: { cooldown: -1 },
  icon: 'roar',
  unlockLevel: TREE, manaCost: 0, cooldown: 8, vfxColor: '#9dff6a', vfxKind: 'surge',
  vfxPrelude: 'gather',
  // A spell, named for the reason Wellspring's is (PT-18)
  delivery: 'spell',
};

/**
 * Ancestral Hunt: three spectral animals through one enemy, one spell (see
 * `SpiritHuntSpec`). Bear hits and lowers its Attack, Wolf hits and heals the
 * Druid, Hawk hits and splashes every enemy beside it. Scaled from the stronger of
 * the Druid's current Attack and Magic, so it is as strong upright as in a claw
 * shape. Borrows Primal Bond's picture until its own is drawn.
 */
export const ancestralHunt: HeroSkill = {
  id: 'ancestral_hunt',
  targetType: SkillTargetType.Single, range: 3, damage: 0.8, targetSide: 'enemy', anyForm: true,
  spiritHunt: {
    hit: 0.8,
    bearEffect: { type: AfflictionType.AttackDown, magnitude: 6, duration: 2 },
    wolfLifesteal: 0.5,
    splashRadius: 1,
    splashScale: 0.5,
  },
  icon: 'primal_bond',
  unlockLevel: TREE, manaCost: 0, cooldown: 6, vfxColor: '#a8ffd8', vfxKind: 'spirits', vfxAftermath: 'motes',
};
