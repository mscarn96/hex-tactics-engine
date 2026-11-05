import { casterManaCost } from '@/data/skills/casterMana';
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

// ═══ ARCANIST ═══════════════════════════════════════════════════════════════

// ── Pyromancer — stack and detonate ───────────────────────────────────────────

export const ignite: HeroSkill = {
  id: 'ignite',
  targetType: SkillTargetType.Single, range: 3, damage: 0.63, scaling: 'magic',
  appliesEffect: { type: AfflictionType.Burn, magnitude: 0.27, duration: 3 },
  // Embers on the struck hex: a fire spell lands as fire, not as a warm-tinted magic bolt
  unlockLevel: TREE, manaCost: 0, vfxColor: '#ff6600', vfxKind: 'bolt', vfxAftermath: 'embers',
};

export const cinderBurst: HeroSkill = {
  id: 'cinder_burst',
  targetType: SkillTargetType.Single, range: 3, damage: 0.99, scaling: 'magic',
  detonates: { status: AfflictionType.Burn, multiplier: 0.5, consume: true },
  unlockLevel: TREE, manaCost: casterManaCost(12), vfxColor: '#ff6600', vfxKind: 'bolt',
};

export const wildfire: HeroSkill = {
  id: 'wildfire',
  targetType: SkillTargetType.Arc, range: 3, aoeRadius: 3,
  damage: 0.72, scaling: 'magic',
  appliesEffect: { type: AfflictionType.Burn, magnitude: 0.225, duration: 3 },
  unlockLevel: TREE, manaCost: casterManaCost(20), cooldown: 2, vfxColor: '#ff6600', vfxKind: 'arc',
};

export const immolation: HeroSkill = {
  id: 'immolation',
  targetType: SkillTargetType.Ring, range: 3, aoeRadius: 2,
  damage: 0.99, scaling: 'magic',
  detonates: { status: AfflictionType.Burn, multiplier: 0.6, consume: true },
  unlockLevel: TREE, manaCost: casterManaCost(30, true), cooldown: 4, vfxColor: '#ff6600', vfxKind: 'ignite',
  vfxPrelude: 'gather', vfxAftermath: 'embers',
};

/**
 * The Pyromancer's elemental, moved off the shared pool.
 *
 * Granted by exactly one node and carried by no template, so keeping it neutral
 * cost tuning and bought nothing — Whirlwind is the precedent.
 *
 * It is a **thrown bomb** rather than a pet now, and every part of that is in
 * the spec: aimed placement decides where it lands, the arrival blast is what
 * landing does, and the template's decay is the clock. Deliberately **no
 * duration** — a duration is a number the player cannot touch, and the whole
 * point of burning down instead is that healing it extends the thing and every
 * hit it takes brings the detonation forward.
 */
export const summonElemental: HeroSkill = {
  id: 'summon_elemental',
  targetType: SkillTargetType.Single, range: 3,
  unlockLevel: TREE, manaCost: casterManaCost(35, true), cooldown: 4,
  vfxColor: '#ff8a1e', vfxKind: 'ignite', vfxAftermath: 'embers',
  summons: {
    templateId: 'fire_elemental',
    count: 1,
    placement: 'aimed',
    arrivalEffect: { kind: 'damage', radius: 1, amount: 0.8 },
  },
};

export const burningOut: HeroSkill = {
  id: 'burning_out',
  // No damage of its own, deliberately. Burn is the one status that *adds*
  // magnitude on re-application rather than refreshing, so this is a
  // multiplier on everything the path has already lit — and Cinder Burst
  // beside it is what turns the stacks back into a number. A fraction of Magic,
  // like every Pyromancer burn; it once defaulted to Attack at 0.5, which is
  // about 0.2 of a Pyromancer's Magic, so the stack kept its strength.
  //
  // Arena-wide rather than a radius-9 ring round the caster (remaster, 2026-10):
  // the ring was a stand-in that handed the flash and the camera a circle of
  // empty and off-board hexes. Now the footprint is the enemies themselves.
  targetType: SkillTargetType.Ring, range: 0, arenaWide: true, scaling: 'magic',
  appliesEffect: { type: AfflictionType.Burn, magnitude: 0.18, duration: 3 },
  unlockLevel: TREE, manaCost: casterManaCost(30, true), cooldown: 4, vfxColor: '#ff6600', vfxKind: 'ignite',
  vfxPrelude: 'gather', vfxAftermath: 'embers',
};

// ── Hydromancer — control ─────────────────────────────────────────────────────

export const frostbite: HeroSkill = {
  id: 'frostbite',
  targetType: SkillTargetType.Single, range: 3, damage: 0.7, scaling: 'magic',
  appliesEffect: { type: AfflictionType.Chill, magnitude: 3, duration: 3 },
  // Costed, and not lightly. Free Chill meant a Hydromancer could apply the
  // freeze half of its own combo every single turn forever — the path's whole
  // decision, "spend now or set up the detonation", did not exist.
  unlockLevel: TREE, manaCost: casterManaCost(8), vfxColor: '#44bbff', vfxKind: 'bolt',
};

export const iceBarrier: HeroSkill = {
  id: 'ice_barrier',
  targetType: SkillTargetType.Single, range: 3,
  appliesEffect: { type: AuraType.Barrier, magnitude: 35, duration: 4 },
  unlockLevel: TREE, manaCost: casterManaCost(16), cooldown: 3, vfxColor: '#66ccff', vfxKind: 'buff',
};

export const silencingDepths: HeroSkill = {
  id: 'silencing_depths',
  targetType: SkillTargetType.Single, range: 3, damage: 0.6, scaling: 'magic',
  appliesEffect: { type: AfflictionType.Silence, magnitude: 1, duration: 2 },
  // Deep indigo and a muffling haze, so it is not mistaken for Frostbite's ice
  unlockLevel: TREE, manaCost: casterManaCost(14), cooldown: 3, vfxColor: '#3d5cff', vfxKind: 'bolt', vfxAftermath: 'smoke',
};

export const blizzard: HeroSkill = {
  id: 'blizzard',
  targetType: SkillTargetType.Ring, range: 3, aoeRadius: 3,
  damage: 1.4, scaling: 'magic',
  // Chill rather than Freeze, and that is the point of the capstone: `applyEffect`
  // upgrades a chill on an already-chilled target into a Freeze, so a Blizzard
  // dropped on ground the Hydromancer has already worked freezes the lot.
  appliesEffect: { type: AfflictionType.Chill, magnitude: 4, duration: 3 },
  unlockLevel: TREE, manaCost: casterManaCost(34, true), cooldown: 4, vfxColor: '#bfe9ff', vfxKind: 'snow',
  vfxPrelude: 'gather', vfxAftermath: 'rime',
};

/**
 * The Hydromancer's single-target capstone: 5 / 6 / 7 ice shards by rung.
 *
 * One enemy at a time, never splash. Each shard is a whole strike with its own
 * critical roll, so the damage per shard is low and the count is the rung (the
 * damage does not also scale, see `scaleSkill`). When the target dies the rest go
 * to the nearest other enemy in range; with none left they dissolve. Only the
 * first shard can break a Freeze or Brittle mark, because the first hit spends it.
 */
export const glacialBarrage: HeroSkill = {
  id: 'glacial_barrage',
  targetType: SkillTargetType.Single, range: 3, targetSide: 'enemy',
  // 0.585 per shard: 0.45 +30% after the playtest of 2026-10-14 found it far too weak
  damage: 0.585, scaling: 'magic',
  barrage: 6, perRank: { barrage: 1 },
  // Borrows the retired Rime Tornado's drawing until its own is made
  icon: 'summon_rime_tornado',
  unlockLevel: TREE, manaCost: casterManaCost(34, true), cooldown: 4, vfxColor: '#bfe9ff', vfxKind: 'barrage',
  vfxPrelude: 'gather', vfxAftermath: 'rime',
};

/**
 * The Hydromancer's charged capstone: charge now, fire a wide beam next turn.
 *
 * The charge is the skill as authored (aimed at the caster, the mana paid here);
 * its release is the beam, aimed when it is fired, three hexes wide to the arena's
 * edge, striking every enemy in it three times. Stun, Silence or Taunt on the
 * Hydromancer while it charges breaks the charge, and the mana is gone. The
 * cooldown starts on release. See `systems/combat/chargedCast`.
 */
export const absoluteZero: HeroSkill = {
  id: 'absolute_zero',
  targetType: SkillTargetType.Self, range: 0,
  // Borrows Blizzard's drawing (an exclusive capstone, so never on the same bar) until its own is made
  icon: 'blizzard',
  appliesEffect: { type: AuraType.Charging, magnitude: 1, duration: BALANCE.CHARGE_DURATION, selfOnly: true },
  unlockLevel: TREE, manaCost: casterManaCost(34, true), vfxColor: '#e6f7ff', vfxKind: 'buff',
  // Drawing in the cold is spellwork: frost grows round the Arcanist as it charges
  delivery: 'spell',
  vfxPrelude: 'gather',
  charge: {
    release: {
      targetType: SkillTargetType.Line, range: 9, beam: true,
      damage: 0.6, scaling: 'magic', repeats: 3,
      manaCost: 0, cooldown: 4, vfxKind: 'beam', vfxColor: '#d9f3ff', vfxPrelude: undefined, vfxAftermath: 'rime',
    },
  },
};

// ── Stormcaller — speed and chains ────────────────────────────────────────────
//
// Playtest 2026-10-23: every Stormcaller spell's `damage` was trimmed about 10%
// (Arc 0.8, Static Burst 0.8, Thunderstep 0.9, Chain Lightning 1.5, Tempest 1.1,
// Thunderbolt 2.0, Skyfall 0.7 before). Verify in playtest.

export const arc: HeroSkill = {
  id: 'arc',
  targetType: SkillTargetType.Single, range: 3, damage: 0.648, scaling: 'magic',
  // The signature rewards its own debuff, which is what turns "press Arc" into
  // "press Arc twice". Costed, unlike the class's level-1 attack: only the
  // basic at-will is free, and a signature that also paid nothing made the
  // Stormcaller's mana bar decoration.
  bonusVs: { condition: 'shocked', multiplier: 1.5 },
  appliesEffect: { type: AfflictionType.Shock, magnitude: 1, duration: 3 },
  // Pale blue rather than the path's yellow, and the same on every skill below:
  // the yellow was inherited from the mastery's *icon* colour, and lightning
  // drawn in it reads as a spark rather than as a strike.
  unlockLevel: TREE, manaCost: casterManaCost(6), vfxColor: '#8fd8ff', vfxKind: 'lightning',
};

/**
 * The thunder arrives with you.
 *
 * It was a blink and nothing else: a turn spent moving, on a class whose problem
 * is rarely where it is standing. The arrival is the skill now — everything
 * adjacent to the landing hex takes the crack and is left conducting, so
 * Thunderstep is an *entrance* into a knot of enemies rather than an exit from
 * one, and it sets up Chain Lightning's `bonusVs` while it is at it.
 *
 * `Ring` with a `blink`, which the resolver already orders correctly: dash and
 * blink land *before* the strike, so the targets are computed from where the
 * caster ends up. The blink still names its exact hex and still refuses an
 * occupied one — see the `Single` note it used to carry.
 */
export const thunderstep: HeroSkill = {
  id: 'thunderstep',
  targetType: SkillTargetType.Ring, range: 4, aoeRadius: 1,
  damage: 0.72, scaling: 'magic',
  selfMove: { kind: 'blink', range: 4 },
  appliesEffect: { type: AfflictionType.Shock, magnitude: 1, duration: 2 },
  unlockLevel: TREE, manaCost: casterManaCost(10), cooldown: 3, vfxColor: '#8fd8ff', vfxKind: 'lightning',
};

/**
 * A route through bodies, not a direction.
 *
 * It was a `Line` — which meant it hit whatever happened to be standing along
 * one of six axes and, against a spread-out enemy, frequently one thing. That is
 * a lance, and the skill is called Chain Lightning: the promise is that a
 * crowded fight is what it is *for*. As a chain it starts on the target and
 * leaps to the nearest enemy it has not touched, so the Stormcaller's job
 * becomes reading where the enemy has clumped.
 *
 * Damage is per body and unsplit, with the Shock it applies feeding its own
 * `bonusVs` on the next cast.
 */
export const chainLightning: HeroSkill = {
  id: 'chain_lightning',
  targetType: SkillTargetType.Chain, range: 6, damage: 1.215, scaling: 'magic',
  // Four bodies in total. The hop is short, so a line of stragglers is one hit
  // and a knot of three is the whole capstone — which is the decision the skill
  // exists to pose.
  chainJumps: 3, chainRange: 2,
  bonusVs: { condition: 'shocked', multiplier: 1.8 },
  appliesEffect: { type: AfflictionType.Shock, magnitude: 1, duration: 2 },
  unlockLevel: TREE, manaCost: casterManaCost(26, true), cooldown: 3, vfxColor: '#8fd8ff', vfxKind: 'lightning',
  vfxPrelude: 'gather', vfxAftermath: 'static',
};

/**
 * The Stormcaller's companion ultimate (remaster, 2026-10), replacing Afterimage.
 *
 * A small storm beside the caster that takes no turn of its own: it follows its
 * owner wherever they go and casts each Stormcaller spell a second time, from where
 * it stands, at the original's targets, with its own Magic — a stated share of the
 * owner's (0.3 / 0.5 / 0.7 by rung, `perRank.echoMagic`). It lasts three of the
 * owner's regular turns after the one it arrived on, or until it is killed; a recast
 * replaces it. The rules live in `systems/combat/companion`.
 */
export const summonThunderElemental: HeroSkill = {
  id: 'summon_thunder_elemental',
  targetType: SkillTargetType.Self, range: 0,
  unlockLevel: TREE, manaCost: casterManaCost(28, true), cooldown: 5,
  // No tell: a summon's arrival is its own picture (`capstoneVfx.test.ts`). The
  // static crackles on the hex the elemental arrives on.
  // A summoning is spellwork: without this it resolved to a blunt blow and lost lightning's light and sparks
  delivery: 'spell',
  vfxColor: '#8fd8ff', vfxKind: 'lightning', vfxAftermath: 'static',
  // Afterimage's committed drawing until this skill has its own
  icon: 'afterimage',
  summons: {
    templateId: 'thunder_elemental',
    count: 1,
    duration: BALANCE.THUNDER_ELEMENTAL_TURNS,
    echoMagic: BALANCE.THUNDER_ELEMENTAL_MAGIC,
  },
  perRank: { echoMagic: BALANCE.THUNDER_ELEMENTAL_MAGIC_STEP },
};

export const tempest: HeroSkill = {
  id: 'tempest',
  // Radius 3 since the remaster (2026-10); Squall's +1 still adds on top of it.
  targetType: SkillTargetType.Ring, range: 0, aoeRadius: 3,
  damage: 0.9, scaling: 'magic',
  appliesEffect: { type: AfflictionType.Shock, magnitude: 1, duration: 2 },
  unlockLevel: TREE, manaCost: casterManaCost(28, true), cooldown: 4, vfxColor: '#8fd8ff', vfxKind: 'lightning',
  vfxPrelude: 'gather', vfxAftermath: 'static',
};

// ═══ Added by the v3 tree rework ═════════════════════════════════════════════
//
// Tier 2 is four active skills on every path now. See the private project notes.

/**
 * The Pyromancer's one skill aimed at an ally, and the path's answer to having
 * nothing to do on a turn the enemy is out of reach.
 *
 * Thorns by rule rather than a new mechanic: Flame Guard reflects a fraction of
 * the damage an enemy's hit deals to the ally back at that enemy, and nothing
 * more — it applies no Burn and absorbs nothing. Its own aura type exists so the
 * remaster (2026-10) could give it fire's name, mark, colour and a flame shroud
 * without repainting every other Thorns source.
 */
export const emberShroud: HeroSkill = {
  id: 'ember_shroud',
  targetType: SkillTargetType.Single, range: 3, targetSide: 'ally',
  appliesEffect: { type: AuraType.FlameGuard, magnitude: 0.35, duration: 2 },
  // Fire rising round the ally as the shroud takes hold: the buff ring read as a slash
  unlockLevel: TREE, manaCost: casterManaCost(14), cooldown: 3, vfxColor: '#ff7733', vfxKind: 'surge',
};

/**
 * The Hydromancer's line, and the one skill that plays the path's combo by
 * itself: chilling an already-chilled target *is* a Freeze, so a lance down a
 * column freezes whatever the last one caught.
 */
export const frostLance: HeroSkill = {
  id: 'frost_lance',
  targetType: SkillTargetType.Line, range: 4, damage: 1.0, scaling: 'magic',
  appliesEffect: { type: AfflictionType.Chill, magnitude: 4, duration: 2 },
  unlockLevel: TREE, manaCost: casterManaCost(16), cooldown: 2, vfxColor: '#bfe6f5', vfxKind: 'bolt',
};

/**
 * Aimed at an **ally**, which is what separates it from every other ranged area
 * skill: it is centred on whoever is already being surrounded, so what it is
 * worth scales with how badly the fight is going rather than with the caster's
 * own positioning.
 *
 * Not the caster's own hex — `targetSide` never accepts it, deliberately, and
 * the draft's "yourself included" was written against a rule that does not
 * exist. Bending it here would mean every `targetSide` skill in the game had to
 * decide the question separately.
 */
export const coldSnap: HeroSkill = {
  id: 'cold_snap',
  targetType: SkillTargetType.Ring, range: 3, aoeRadius: 1,
  damage: 0.9, scaling: 'magic', targetSide: 'ally',
  appliesEffect: { type: AfflictionType.Chill, magnitude: 4, duration: 2 },
  unlockLevel: TREE, manaCost: casterManaCost(18), cooldown: 3, vfxColor: '#bfe6f5', vfxKind: 'nova',
};

/**
 * The Stormcaller's cheap one. Everything else on the path is a cooldown or a
 * blink, so without this the tree's opening turn is always Arc.
 */
export const staticBurst: HeroSkill = {
  id: 'static_burst',
  targetType: SkillTargetType.Ring, range: 2, aoeRadius: 1,
  damage: 0.648, scaling: 'magic',
  appliesEffect: { type: AfflictionType.Shock, magnitude: 0.3, duration: 2 },
  unlockLevel: TREE, manaCost: casterManaCost(10), cooldown: 1, vfxColor: '#88ddff', vfxKind: 'lightning',
};

/**
 * The path's single-target answer, and the most expensive button an Arcanist
 * owns.
 *
 * Stormcaller is otherwise all area and all tempo, which left it with nothing to
 * point at a boss — a fight with one enemy in it turned the whole tree into a
 * worse Pyromancer. The reach rather than the number is what is being bought:
 * seven hexes opens on something that has not had a turn yet.
 */
export const thunderbolt: HeroSkill = {
  id: 'thunderbolt',
  targetType: SkillTargetType.Single, range: 7, damage: 1.62, scaling: 'magic',
  bonusVs: { condition: 'lowHp', multiplier: 1.5 },
  appliesEffect: { type: AfflictionType.Shock, magnitude: 0.35, duration: 2 },
  unlockLevel: TREE, manaCost: casterManaCost(28), cooldown: 4, vfxColor: '#ccf0ff', vfxKind: 'lightning',
};

/**
 * Lightning on enemies nobody chose — but always on enemies (remaster, 2026-10).
 *
 * It rolled five random arena hexes and the misses were the skill; the player
 * pressed it and watched bolts land on grass. Now it picks up to three **different**
 * living enemies (`randomEnemies`), so with two left it strikes two and with one it
 * strikes one — never the same enemy twice. Allies are never candidates. Since the
 * 2026-10-17 playtest (PT-18) the player aims it: a hex up to `SKYFALL_RANGE` away,
 * and the strikes fall among the enemies within `SKYFALL_RADIUS` of it, never
 * anywhere on the map. 0.7× Magic per strike at the middle rung.
 */
export const skyfall: HeroSkill = {
  id: 'skyfall',
  targetType: SkillTargetType.Ring, range: BALANCE.SKYFALL_RANGE, aoeRadius: BALANCE.SKYFALL_RADIUS,
  damage: 0.567, scaling: 'magic',
  randomEnemies: BALANCE.SKYFALL_TARGETS,
  appliesEffect: { type: AfflictionType.Shock, magnitude: 0.3, duration: 2 },
  unlockLevel: TREE, manaCost: casterManaCost(24), cooldown: 4, vfxColor: '#ccf0ff', vfxKind: 'lightning',
};
