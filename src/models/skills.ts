import type { SkillTargetType } from './enums';
import type { HexCoord } from './hex';
import type { SkillId, SummonTemplateId } from './ids';
import type { WeaponAttackId } from './items';

/**
 * A picture a skill can wear: a skill's own, or one of the Basic Attack's weapon
 * faces (`skill:attack_<kind>` in the icon map), which are pictures and not skills.
 */
export type SkillPictureId = SkillId | `attack_${WeaponAttackId}`;
import type { AfflictionType, StatusEffectType } from './status';
import type { SkillGesture, SpellFamily, StrikeContact, StrikeDelivery, SupportFamily } from './sound';

// ============ SKILLS ============

/**
 * Visual shape of a skill's effect. Decoupled from gameplay: several skills with
 * different mechanics can share a kind, and `vfxColor` re-tints the same effect.
 * Lives here rather than in the vfx/ folder so HeroSkill can reference it without
 * pulling a React component tree into the data layer.
 */
export type VfxKind =
  | 'slash'   // swept arc at the target
  | 'bolt'    // projectile travels caster → target, then impacts
  | 'arc'     // widening wedge out of the caster, along a hex axis
  | 'nova'    // ring expanding outward from the caster
  | 'meteor'  // falls from above, impact + camera shake
  | 'bloom'   // rising motes + dome (heals)
  | 'buff'    // rising ring on the target (status application)
  // The three below are what the *large* area skills needed. All of them shipped
  // as 'meteor' or 'nova', which are both single-origin shapes — a skill whose
  // point is that it reaches everywhere cannot be drawn as one thing arriving in
  // one place, however big the ring around it is.
  | 'snow'    // weather falling on a whole footprint, over time
  | 'ignite'  // every struck hex catching, in a wave outward from the caster
  | 'quake'   // slabs heaving up out of the ground, plus ripple and shake
  // Electricity, which none of the shapes above can be re-tinted into: a bolt
  // glides and a nova expands, and lightning does neither — it is a jagged path
  // that is simply *there*, redrawn several times before it goes. Every
  // Stormcaller skill was resolving to one of the two, which made the class read
  // as a mage with a different palette.
  | 'lightning'
  // A weapon that left somebody's hand. `bolt` is the flat, fast read for
  // anything *shot*; this is the lobbed one — a high ballistic arc that starts
  // at the caster and ends on the ground, spinning the whole way. The
  // distinction is worth a shape because the alternatives both lie about where
  // the thing came from: `meteor` spawns it in the sky above the target (which
  // is what made Bolas read as a called-down rock rather than as a throw), and
  // `bolt` flies it flat and fast, which is an arrow. General rather than
  // bolas-shaped — a net, a flask, a javelin and a bag of caltrops all want it.
  | 'throw'
  // Several columns of turning air standing in the footprint at once. `snow`
  // is the other weather shape and it is deliberately *not* this: snow falls
  // from a ceiling onto everything evenly, which is what makes Blizzard read as
  // the sky closing in, while this is a handful of discrete things stalking
  // about on the ground. That distinction is the whole visual difference
  // between the Hydromancer's two capstones, and it is the one place in the
  // game an effect borrows a *summon's* model — the Rime Tornado used to be
  // one, and the funnel is already drawn.
  | 'cyclones'
  // Many discrete projectiles arriving over a whole footprint from above, each
  // with its own landing point, each left standing where it came down. Rain of
  // Arrows named no kind at all, so the derivation read "ranged Ring" and handed
  // it `meteor`: the Hunter's signature area attack was one burning rock landing
  // on the middle of the tiles with a camera shake behind it.
  //
  // The three shapes it is nearest are each wrong in a different direction, which
  // is the argument for a twelfth rather than a re-tint. `meteor` is one object
  // arriving at one point, and no amount of ring says "and also over there".
  // `snow` is weather — an even fall out of a ceiling, wrapping so the field
  // never empties, where the *ground going white* is the event and no individual
  // flake is anything; here every shaft is a thing somebody loosed, it arrives
  // once, and where it stuck is information. And `throw` has the right motion but
  // the wrong count: one weight, off one hand, onto one hex.
  //
  // General on purpose, the standing rule here — the shaft is a plain box in the
  // spec's colour, so a rank of crossbow bolts, a scatter of javelins or a fan of
  // thrown knives takes it unchanged.
  | 'arrows'
  // One arrow or quarrel, shot. `bolt` is a glowing mote on a gentle arc, which
  // is right for a magic missile and wrong for a bow: the Basic Attack draws
  // the thing it is holding, and a bow that fires a ball of light reads as a
  // wand. A thin shaft pointed along its flight, flat and fast.
  | 'shot'
  // A weapon carried a full turn round the caster: two blade arcs sweeping the
  // ring at reach, trailing light. `nova` is a shockwave — air, not steel — and
  // the Berserker's Whirlwind is "both blades through everything within reach",
  // which a widening hoop does not say.
  | 'spin'
  // A unit powering itself up: a column of light rising out of it, a burst at
  // its feet and motes climbing round it. Every capstone that is a *window* —
  // Carnage, Rapid Fire, Flurry, a blessed weapon — shipped as `buff`, the same
  // small rising ring as a Taunt landing, so a hero's biggest decision of the
  // fight looked like a status pip.
  | 'surge'
  // Glacial Barrage: shards rise and circle the caster, then leave one at a time
  // for whoever is the target at that moment (`VfxSpec.projectiles`).
  | 'barrage'
  // Absolute Zero's release: a wide beam from the caster to the arena's edge,
  // pulsing once per hit.
  | 'beam'
  // Ricochet Shot: one arrow that flies to the first target, then on to each
  // bounce in turn (`hitCoords`, in order).
  | 'ricochet'
  // Shield Avalanche's slam: a spectral shield driven through a cone, with an
  // impact wedge and dust behind it.
  | 'shieldwave'
  // A summon going off as it dies (the Fire Elemental): the core brightens, a
  // sharp blast over the burst's own footprint, embers after. A death, not a cast.
  | 'explosion'
  // Ancestral Hunt: spectral Bear, Wolf and Hawk through one enemy in turn, each on
  // its own beat (`SPIRIT_BEAT_MS`), then their trails returning to the caster.
  | 'spirits'
  // Living Stone (Stoneshaper remaster): cracks race from the caster across the
  // aimed area, slabs rip free and are flung away from the caster, then a heavy
  // impact with dust and fragments. Pushed bodies are thrown on the impact beat.
  | 'upheaval'
  // Knife Dance: actual ground dashes (`danceSteps`), each followed by a blade
  // thrown from its landing to the nearest living victim.
  | 'knifedance'
  // Blade Recall's pull: the caster's blades fly out of each enemy (`hitCoords`)
  // back to the caster's hand, one glint per blade removed.
  | 'extract'
  // A Freeze ending on a unit (`systems/combat/iceBreak.ts`): the ice bursting off
  // the body when a blow breaks it, or, at a smaller scale, thawing off on its own.
  // Drawn by the rules on a status, never authored on a skill.
  | 'shatter'
  // A blow from the target's side or back (`systems/combat/facing`): a flank-coloured arc
  // on the struck side of its hex, a star and sparks. Drawn by the rules on the
  // blow, never authored on a skill.
  | 'flank'
  // The archipelago's (`data/display/archipelagoEffects.ts`, specs from
  // `systems/combat/archipelagoVfx.ts`), built ahead of the abilities that fire them.
  //
  // A cannonball down a lane (Varr, the Redsail guns): a muzzle flash and smoke, then
  // one iron ball flying flat through every hex of `hitCoords` in order, tearing up
  // each one as it passes. `shot` is one shaft into one body; this is the whole lane.
  | 'cannon'
  // The Reef Titan's coral walls pushing up through the ground on each hex of
  // `hitCoords` (the walls themselves stand in `CoralField`), and one broken apart.
  | 'coral'
  | 'coralbreak'
  // A Siren's song reaching a hero: sea-glass rings and notes from the singer to the
  // target, closing on it as the charm takes. The pull after it is a move.
  | 'lure'
  // A grapnel thrown flat, biting, its rope snapping taut and reeled in, hauling
  // whoever `VfxSpec.haul` names along it.
  | 'hook'
  // Water bursting up on each hex of `hitCoords`: the tide flooding in, a body
  // thrown into it.
  | 'splash'
  // A wave rolling across the footprint from `casterPos` toward `targetCoord`,
  // throwing the bodies it pushes as its crest reaches them.
  | 'wave';

/**
 * A cast's tell, drawn at the caster before its main shape plays.
 *
 * The preparation half of "preparation, travel, impact and aftermath": a
 * capstone that fired in the same frame it was pressed had no moment in which
 * the player saw it coming. `gather` is a spell drawing power (motes pulled in,
 * a sigil under the feet), `brace` a body setting itself for a blow (dust
 * pulled in at the feet), `aim` a shot being lined up (a sight line onto the
 * target and a reticle closing on it), `halo` a blessing descending.
 *
 * It delays the main shape, so it delays the numbers: `skillImpactDelayMs` is
 * the one clock both read.
 */
export type VfxPrelude = 'gather' | 'brace' | 'aim' | 'halo';

/**
 * What a struck footprint keeps showing after the main shape has landed.
 *
 * Presentation only, and it never delays a number — the blow has landed; this
 * is the ground remembering it for a second: `embers` and scorch, `rime`,
 * `static`, rising `motes` (a blessing or a mending), `dust` settling, `venom`
 * bubbling, a red `spatter`, `smoke` hanging where somebody vanished.
 */
export type VfxAftermath =
  | 'embers' | 'rime' | 'static' | 'motes' | 'dust' | 'venom' | 'spatter' | 'smoke';

/**
 * Everything an effect needs to render itself, captured when the skill resolves.
 * Positions are snapshotted rather than read live so an effect keeps playing
 * correctly after the units involved move, die or unmount.
 */
/**
 * A thrown thing: a throwing weapon's own item form, or one of the things nobody wields — a
 * grapnel (the boarding hook's), a powder horn (the Powder Magazine's).
 */
export type Projectile =
  | 'throwing_axe' | 'throwing_blade' | 'spear' | 'bolas' | 'stone' | 'ice_block' | 'hook' | 'powder_horn';

export interface VfxSpec {
  kind: VfxKind;
  casterId: string;
  casterPos: HexCoord;
  /** Hex actually aimed at — origin for cones, landing point for bolts. */
  targetCoord: HexCoord;
  /** Units actually struck. */
  hitUnitIds: string[];
  /** Hexes to flash — the whole AoE footprint for area skills, else just the hits. */
  hitCoords: HexCoord[];
  /** Knife Dance: actual landings and the victim of each following thrown blade. */
  danceSteps?: { from: HexCoord; to: HexCoord; target: HexCoord; targetId: string; hit: boolean }[];
  color: string;
  /**
   * How the blow arrives — a sword's cut, a club's crush, a bite — from `strikeDelivery`, the
   * same answer the sound reads. Effects choose their swing, mark and particles by it.
   */
  delivery: StrikeDelivery;
  /** For a throw: what flies (`Projectile`); a stone when nothing says. */
  projectile?: Projectile;
  /** Multiplier on the effect's play time — see resolveVfxScale. Omitted = 1. */
  durationScale?: number;
  /**
   * Hold the effect this long before it starts. Omitted = at once.
   *
   * A dual-wield Basic Attack is two blows, and drawing both in the same frame
   * draws one: the second hand's effect waits `FLOAT_STAGGER_MS`, which is
   * exactly when the float queue lets its number onto the same anchor.
   */
  delayMs?: number;
  /**
   * Struck units to draw thrown into the air for the beat — the Troll
   * Chieftain's Farthest Prey. Presentation only: nothing about the unit's
   * height, hex or turn order changes, and the scene plays it from the same
   * spec that draws the impact.
   */
  knockUpIds?: string[];
  /**
   * A tell at the caster before the main shape (`VfxPrelude`). The main shape,
   * the caster's swing and the struck units' recoil all wait for it.
   */
  prelude?: VfxPrelude;
  /** What the footprint keeps showing once the main shape has landed (`VfxAftermath`). */
  aftermath?: VfxAftermath;
  /**
   * A barrage's whole supply of projectiles. `hitCoords` lists where each one that
   * found a target landed, in order; the rest dissolve where they circled.
   */
  projectiles?: number;
  /**
   * Which blow of a multi-blow attack this is, from 0 (a dual-wielder's second
   * hand, Carnage's doubled hits). The slash mirrors every other blow, so the
   * cuts alternate top-left → bottom-right and top-right → bottom-left.
   */
  strikeIndex?: number;
  /** The blow drinks from what it struck (lifesteal): drawn as blood pulled back into the caster. */
  drain?: boolean;
  /**
   * A `hook`'s haul: who rides the rope and where they land. The hooked body dragged to the
   * thrower (a Boarder, a Harpoon Diver), or the thrower pulled to the hook (the Corsair's
   * Boarding Hook) when `unitId` is the caster's. The rope follows that end while the other
   * holds. Absent, the hook is reeled back in empty. The move itself is the rules', as a dash
   * held until the reel (`hookReelMs`).
   */
  haul?: { unitId: string; from: HexCoord; to: HexCoord };
}

/**
 * A skill used twice across two turns: the first use charges (it is the skill as
 * authored, aimed at the caster) and the next regular turn's use is `release`,
 * merged over it. See `systems/combat/chargedCast`.
 */
export interface ChargeSpec {
  release: Partial<HeroSkill>;
  /**
   * Aimed at an enemy rather than the caster (Aimed Shot). The first use deals
   * nothing and lays `AuraType.Aiming` naming the target; the release may only
   * be fired at that same unit. Every other skill, Basic Attack included, is
   * locked while the aim stands, and moving drops it. The cooldown starts at the
   * aim (one turn longer, so it runs from the release) and the release ignores
   * it. See `systems/combat/chargedCast`.
   */
  aimed?: boolean;
}

/**
 * Creatures a skill calls into the fight.
 *
 * Summons are built from their own templates, carry no equipment, and are never
 * routed through `partyStore` — they exist only inside `combatStore`, so they
 * vanish when combat state is dropped. That is also what lets a summoning party
 * exceed `MAX_PARTY_SIZE` for the duration of a battle.
 */
export interface SummonSpec {
  templateId: SummonTemplateId;
  count: number;
  /** Turns the summon survives, counted on its own turns. Omit for "until it dies". */
  duration?: number;
  /**
   * Where the creature lands.
   *
   * `auto` (the default, and every enemy summon) drops it beside the caster via
   * `findSummonHexes`. `aimed` makes the skill ground-targeted: the player picks
   * a free hex within range, the way a blink does.
   *
   * Nested here rather than added to `HeroSkill` on purpose — `SummonSpec` has
   * exactly one read site in each of the four systems that care (highlights,
   * player resolver, AI resolver, AI scoring), so this is four known branches
   * rather than a rule every system has to learn.
   */
  placement?: 'auto' | 'aimed';
  /**
   * How strong the summon is relative to its template's numbers, set by the
   * node's rank (×0.75 / ×1 / ×1.25). Omitted means the template as authored.
   */
  statScale?: number;
  /**
   * A companion's Magic as a share of its summoner's (the Thunder Elemental). Set
   * only on companion summons; a rung moves it by `perRank.echoMagic` rather than
   * by the generic rank scale, so 0.3 / 0.5 / 0.7 is exactly what is stated.
   */
  echoMagic?: number;
  /**
   * The summon's maximum HP as a share of its caster's own (the Lantern Beacon),
   * in place of the template's level-scaled number. The rung's `statScale`
   * multiplies the share like any other strength.
   */
  ofCasterMaxHp?: number;
  /**
   * A summon that is built up over several casts, listed first to last.
   *
   * While a live unit summoned by this caster carries a non-final stage
   * template, its hex is the **only** legal target and casting advances it to
   * the next template. The unit *is* the state machine: no store flag, no
   * per-hero bookkeeping, and the thing dying resets the chain naturally.
   */
  stages?: SummonTemplateId[];
  /** Fires once, centred where the creature lands. */
  arrivalEffect?: SummonArrivalSpec;
}

/**
 * A mark a strike leaves on the enemy it lands on (Wildshape remaster, 2026-10).
 *
 * - `HuntersMark`: the next `charges` damaging Hawk attacks by the same caster against
 *   it deal `bonus` (a fraction, 0.4 = +40%) more, one charge each.
 * - `CrownedPrey`: the next `charges` damaging hits by the caster's side against it add
 *   `bonus` times the caster's Attack as magic damage, fixed when the mark is laid.
 *
 * Laid only by a strike that landed (a dodge lays nothing); a new one replaces the old.
 */
export interface StrikeMarkSpec {
  type: AfflictionType.HuntersMark | AfflictionType.CrownedPrey;
  charges: number;
  duration: number;
  bonus: number;
}

/**
 * Ancestral Hunt's three spirits (Wildshape remaster, 2026-10): one cast, three
 * strikes on the aimed enemy in order — the Bear's (with `bearEffect`), the Wolf's
 * (returning `wolfLifesteal` of what it dealt) and the Hawk's, which also strikes
 * every other enemy within `splashRadius` of the victim at `splashScale` of a hit.
 * Each strike rolls its own dodge and critical. The power is the caster's stronger
 * of Attack and Magic in the shape it stands in, so no form makes it useless.
 */
export interface SpiritHuntSpec {
  hit: number;
  bearEffect: SkillEffect;
  wolfLifesteal: number;
  splashRadius: number;
  splashScale: number;
}

/**
 * What arriving does to the ground around the summon.
 *
 * Measured in the *summon's* own attack rather than the caster's, so it scales
 * with the creature the skill is actually about — and stays honest when the
 * caster is a Druid casting off magic.
 */
export interface SummonArrivalSpec {
  kind: 'damage' | 'heal';
  radius: number;
  /** Multiplier on the summon's own attack. */
  amount: number;
  /** Optional rider, kept general — a burn on a fire arrival, say. */
  effect?: SkillEffect;
}

/**
 * Repositioning the caster as part of using a skill.
 *
 * A turn is move *or* act, so this is the only way to do both — which is what
 * makes the dash family worth a skill slot rather than being a strictly worse
 * "walk, then attack next turn".
 *
 * `range` is how far the caster may travel, and is independent of the skill's
 * own `range`, which still governs what the player may click.
 */
export interface SelfMoveSpec {
  /**
   * - `dash` — close to the nearest free hex adjacent to the target, then strike
   * - `blink` — teleport onto the target hex itself, ignoring what is in between
   * - `retreat` — strike, then withdraw directly away from the target
   * - `free` — go to the chosen hex and strike nobody
   *
   * `free` is the only kind not anchored to a target, which is exactly why it
   * suits a class whose three paths want to move in different directions: a
   * Marksman backs off, a Shadowblade gets behind.
   */
  kind: 'dash' | 'blink' | 'retreat' | 'free';
  range: number;
  /**
   * A `retreat` that ends this many hexes from the target rather than `range`
   * further from where the caster struck: the free hex at that distance nearest
   * the caster, away from other enemies on a tie. A caster already there stays.
   * The Hawk's Dive (playtest 2026-10-14): it struck from four hexes and then
   * flew two more, ending six away; now it lands at Talons' reach.
   */
  landAt?: number;
}

/**
 * A state of the target (or the strike) that a skill can be tuned against.
 *
 * This is what makes an affliction worth applying rather than merely worth
 * ticking: Burn on its own is a slow drip, but Burn plus a skill that hits
 * burning targets harder is a plan.
 */
export type DamageCondition =
  | 'burning' | 'chilled' | 'frozen' | 'shocked' | 'poisoned' | 'bleeding'
  | 'stunned' | 'rooted' | 'marked'
  | 'lowHp' | 'fullHp'
  /** Below half of its effective maximum HP (Rending Circle). */
  | 'wounded'
  /** No ally of the target stands adjacent to it. */
  | 'isolated';

export interface BonusVsSpec {
  condition: DamageCondition;
  /** Multiplier applied to the strike when the condition holds. */
  multiplier: number;
}

/** A state a target must already be in for a skill to be usable on it at all. */
export type TargetRequirement =
  /** At or below the execution window — see `executeThresholdHp`. */
  | 'executable'
  /** Carrying any amount of Poison. */
  | 'poisoned';

/**
 * Damage that grows with how much of an affliction the target already carries.
 *
 * The third member of a family: `bonusVs` is a flat reward for the affliction
 * being present, `detonates` cashes it in and takes it away, and this scales
 * smoothly with it and leaves it alone — which is what makes stacking the
 * affliction up over several turns a plan rather than a threshold to clear.
 */
export interface StatusAmplifierSpec {
  status: AfflictionType;
  /**
   * Extra multiplier per "hit's worth" of the affliction on the target, where a
   * hit's worth is the attacker's own attack stat. Measuring in the attacker's
   * own terms is what keeps this stable as both sides' numbers inflate.
   */
  per: number;
  /** Ceiling on the *bonus*, so 1.5 means "at most +150%". */
  max: number;
}

/**
 * Spending an affliction for a burst.
 *
 * Distinct from `bonusVs`, which merely rewards hitting an afflicted target.
 * A detonation cashes the affliction in: the bonus scales with how much of it
 * was left, and `consume` decides whether the target keeps it afterwards.
 */
export interface DetonateSpec {
  status: AfflictionType;
  /** Extra damage per remaining turn of the affliction, as a fraction. */
  multiplier: number;
  consume: boolean;
}

/** The two things a Zeal-owning Templar may do with Smite. */
export type SkillModeId = 'mercy' | 'wrath';

/**
 * What rung of its mastery node a granted passive is standing on.
 *
 * Lives here beside `PassiveId` rather than in `systems/progression/mastery`,
 * where it is produced, because `CombatUnit` carries it — and a model importing
 * a system type is the layering rule this codebase is built on, backwards.
 *
 * Both fields, because two passives cannot use the scale. `scale` is the
 * 0.75 / 1 / 1.25 factor almost everything wants; Wrath's threshold ladder
 * (16 / 12 / 8) and Vengeance's trigger chance (50 / 75 / 100) are neither
 * regular nor a multiple of an authored middle value, so they index `level`.
 */
export interface PassiveRank {
  /** 1-based rung of the node that granted it. */
  level: number;
  /** `LEVEL_SCALE` factor for that rung — always 1 for a single-level node. */
  scale: number;
}

/**
 * Combat events a passive can hang off.
 *
 * Deliberately a fixed, short list. `statMod` is the odd one out: it is not an
 * event but a continuous contribution to effective stats, and immunity passives
 * ride along with it since they are likewise always-on.
 */
export type PassiveTrigger =
  | 'onTurnStart'
  | 'onHit'
  | 'onKill'
  | 'onDamaged'
  | 'onHeal'
  | 'onMove'
  | 'onTauntApplied'
  /**
   * A Burning enemy died. Fired on the unit that applied its Burn (`other` is
   * the corpse), so the Pyromancer's Spark can pass a stack on.
   */
  | 'onBurningDeath'
  /**
   * A Burn was cashed in by a detonating skill. Fired on the caster (`other` is
   * the target as it stood before the strike), so Detonation can leave the
   * ground burning.
   */
  | 'onDetonate'
  /**
   * An enemy was actually frozen: a Freeze now stands on a unit that had none
   * (a Chill upgrading, or a Freeze applied outright). Fired on the unit that
   * applied it, with `other` the frozen enemy. A boss that ignores the disable
   * does not count; nothing froze.
   */
  | 'onFreeze'
  /**
   * A damaging cast finished. Fired once per cast on the caster, with `struck` the
   * enemies it hit as they stood before the blows, so a rule about the *cast* (how
   * many Shocked enemies it caught) can be read without owning per-hit state.
   */
  | 'onCast'
  /**
   * The turn has started and the effect tick has run. Fired on the unit whose turn
   * it is, for passives that lay an aura for this turn: it must come after the tick
   * or a one-turn aura would be counted down before anyone could use it.
   */
  /**
   * A unit died. Fired on the owner of what it carried (`other` is the corpse), so a
   * passive about a death can read the corpse's statuses without owning the death path.
   */
  | 'onDeath'
  /**
   * A cast finished: every strike, heal and pull is done and the caster stands as it
   * will. Fired once on the caster. For passives about what the cast was (it restored
   * HP, it struck an enemy) rather than about any one hit.
   */
  | 'onSkillResolved'
  | 'onTurnStartAura'
  | 'statMod';

/**
 * The whole passive vocabulary, capped on purpose.
 *
 * Twelve trees of bespoke passives would dwarf the rest of the overhaul.
 * Character comes from which of these a tree combines, not from each tree
 * inventing its own.
 */
export type PassiveId =
  | 'bloodscent'
  | 'frenzy'
  /**
   * The Marksman remaster's three positional passives. `markAndMove` hands back
   * a short reposition after Mark Target; `escapeRoute` steps away once a round
   * after a close-range hit; `settleIn` turns a turn spent standing still into
   * Physical Defense ignored by the next ranged cast. Follow-Through's free-turn
   * passive was retired with them.
   */
  | 'markAndMove'
  | 'escapeRoute'
  | 'settleIn'
  /**
   * The Skirmisher remaster's three. `fanOfBlades` is the Signature node: Blade
   * Recall throws a damaging, embedding cone before it extracts. `slipstream`
   * hands back a one-hex step after a damaging cast; `sharpenedSteel` makes the
   * first hit on a full-health enemy ignore part of Physical Defense.
   */
  | 'fanOfBlades'
  | 'slipstream'
  | 'sharpenedSteel'
  | 'retaliation'
  | 'braced'
  /**
   * Shielded Challenge, the Bulwark's Signature node: a Provoking Strike that
   * lands gives the Bulwark a Barrier worth a share of its Attack.
   */
  | 'shieldedChallenge'
  /**
   * The Templar's two replaced flat-stat nodes. `oath` hangs a brief Magic
   * Defense off every direct heal or cleanse that did something; `zeal` is the
   * rung that scales Smite's Mercy / Wrath choice and grants no stat itself.
   */
  | 'oath'
  | 'zeal'
  /**
   * The Stoneshaper's nodes. `crumble` (the remaster's replacement for
   * Stonecutter, 2026-10) strips both defences from an enemy for as long as a Stun
   * or Root the Stoneshaper laid stands on it; `aftershock` makes Tremor's
   * footprint erupt again at the start of the next turn; `rubbleRecovery` heals an
   * ally whose Stoneshaper Barrier an enemy breaks. `unyielding` hardens both
   * defences while a Barrier is up, and `seismicSense` lends a turn's extra
   * movement when a warned ground attack covers the hex it stands on.
   */
  | 'sacredRhythm'
  | 'groundedFocus'
  | 'crumble'
  | 'aftershock'
  | 'rubbleRecovery'
  | 'unyielding'
  | 'seismicSense'
  /** Stone's Answer (level 26): the enemy that breaks the Stoneshaper's Barrier is struck and Rooted. */
  | 'stonesAnswer'
  /**
   * The Berserker's two Bleed payoffs. `savageEdge` ticks a Bleed at once on a
   * critical hit against a Bleeding enemy, once per enemy per turn; `killingEye`
   * adds critical chance against Bleeding enemies only.
   */
  | 'savageEdge'
  | 'killingEye'
  /**
   * The Mantis's three rules (the private project notes, "### Mantis").
   * `bleedingBlades` makes the Basic Attack lay a Bleed; `reapingMomentum` is the
   * Signature node, Twin Reap's stacks on one prey (`systems/combat/mantis`);
   * `predatorsBreath` adds critical chance to Meditate's payout.
   */
  | 'bleedingBlades'
  | 'reapingMomentum'
  | 'predatorsBreath'
  /**
   * The Mantis's side-tree rules. `bleedHarvest` makes the Bleed Twin Reap reaps
   * deal its remaining damage at once (read by the resolver through
   * `systems/combat/mantis`); `freshKill` restores chi on a kill; `evasiveWeave`
   * adds Dodge on a turn the Mantis moved.
   */
  | 'bleedHarvest'
  | 'freshKill'
  | 'evasiveWeave'
  /**
   * The Pyromancer's three Burn decisions. `firemind` discounts Cinder Burst's
   * mana when it spends several Burn stacks; `spark` passes one stack from a
   * dying Burning enemy to a nearby unburned one; `detonation` leaves burning
   * ground where a Burn was cashed in.
   */
  | 'firemind'
  | 'spark'
  | 'detonation'
  /**
   * The Hydromancer's control-to-damage decisions. `shatterpoint` adds damage
   * to the blow that breaks a Freeze; `meltwater` shields the most wounded ally
   * when a Freeze lands; `deepCold` lengthens a Chill cast from beyond one hex;
   * `killingFrost` makes magic hits against a Chilled enemy ignore part of its
   * Magic Defense.
   */
  | 'shatterpoint'
  /**
   * Twin Fangs, the Hydromancer's Signature node: Frostbite strikes twice, the
   * second fang scaled by rung, and lays its Chill once after both. Read by
   * `statusEffects.strikeScales`.
   */
  | 'twinFangs'
  /**
   * Fuel the Flame, the Pyromancer's Signature node: Ignite on an enemy that is
   * already burning lays one extra Burn stack, its strength scaled by rung. Read
   * by `statusEffects.fuelTheFlameBurn`.
   */
  | 'fuelTheFlame'
  | 'meltwater'
  /**
   * Flying Shards, the Hydromancer's level-26 node: once a turn, the blow that breaks
   * a Freeze or a Brittle mark throws ice at the enemies around it.
   */
  | 'flyingShards'
  | 'deepCold'
  | 'killingFrost'
  /**
   * The Stormcaller's Overload: a cast that struck two or more already-Shocked
   * enemies primes the next single-target lightning bolt (see
   * `data/skills/lightningSkills`) to hit harder, once.
   */
  | 'overload'
  /**
   * Conductive Arc, the Stormcaller's Signature node: the Shock jump an Arc sets off
   * carries a larger share of the blow, scaled by rung. Read by
   * `statusEffects.shockChain`.
   */
  | 'conductiveArc'
  | 'vengeance'
  | 'undying'
  /**
   * Undying with a payload, two ways.
   *
   * Separate ids rather than options on `undying`, because three enemy
   * templates carry the plain one and none of them should start hitting harder
   * for having survived.
   */
  | 'lastBreath'
  | 'cryostasis'
  /**
   * The Berserker remaster (2026-10). `bloodRush` is the Signature node: Bloodthirst
   * dashes 2 / 3 / 4 hexes before it strikes (`passives.withBloodRush`).
   * `undyingFury` is the capstone's save: Last Breath's surge plus a protected
   * floor of 1 HP until two of the owner's regular turns have been played
   * (`AuraType.UndyingWindow`). Separate from `lastBreath` so the Bog Hulk keeps
   * its plain save.
   */
  | 'bloodRush'
  | 'undyingFury'
  | 'regeneration'
  | 'momentum'
  | 'lifebloom'
  /**
   * The Lifewarden remaster's first row (2026-10). Shared Bloom is the Signature
   * node: Lifebloom also heals the most wounded ally near its recipient, a rule
   * read by `skillResolution` through `sharedBloomRecipient`. Second Spring lays
   * damage reduction on a badly hurt ally a heal reaches. Cycle of Life banks one
   * Growth charge per healing cast and spends three on the next damaging spell.
   */
  | 'sharedBloom'
  | 'secondSpring'
  | 'cycleOfLife'
  /**
   * The Firefly's three passives (Monk). `brighterMotes` is the Signature node:
   * Glowmote's mote carries a larger share further (`fireflyRules.moteSpec`).
   * `lanternBreath` spreads Meditate's next-turn heal to the allies beside the
   * Firefly; `afterglow` lends Attack and Magic to any ally it heals.
   */
  | 'brighterMotes'
  | 'lanternBreath'
  | 'afterglow'
  /**
   * The Firefly's side trees. `farLight` (a one-rank starter) adds a hex to
   * Glowmote, Lightbond and Purifying Light, baked into the kit
   * (`fireflyRules.withFarLight`); `twinMotes` (the other starter) sends
   * Glowmote's mote to the two most hurt allies (`fireflyRules.moteRecipients`).
   * `steadyFlame` hands back chi from each cast of the Firefly's that heals an
   * ally; `secondLight` lays a Barrier on an ally a heal lifts past half health.
   */
  | 'farLight'
  | 'twinMotes'
  | 'steadyFlame'
  | 'secondLight'
  | 'intimidating'
  | 'wrath'
  | 'lastStand'
  | 'unstoppable'
  | 'immovable'
  // The Emerald Dragon: weak on his first turn, at full strength on his sixth, stronger every turn after
  | 'risingFire'
  /**
   * Tempo, one path each, and they are siblings rather than duplicates.
   *
   * `cadence` alternates: a turn of ordinary swings, then a turn that lands
   * harder, forever. `kindle` is the opposite trade — it pays only for standing
   * still, and pays more the longer you do.
   */
  | 'cadence'
  | 'kindle'
  /**
   * Two more ways to be handed a turn, past `frenzy` and `followThrough`.
   *
   * A free action is the strongest thing a passive can grant, so each of the
   * four buys it differently: `frenzy` wants a kill, `followThrough` wants a
   * critical kill, `shatterstep` wants ice on the target, and `thunderhead`
   * wants a kill *and* the dice. Four gates rather than four numbers, because
   * a gate is what makes a path play differently rather than merely better.
   */
  | 'shatterstep'
  | 'thunderhead'
  /** Hiding pays the Shadowblade back in time rather than in damage. */
  | 'nightfall'
  /**
   * The Shadowblade remaster's two. `shadowEcho` is the Signature node: Shadowstep
   * leaves a shadow at the hex it left, and the Shadowblade may return to it for
   * mana without spending the action. `venomTransfer` (Rot's replacement) passes
   * one dose of a dead enemy's Poison to a nearby unpoisoned enemy.
   */
  | 'shadowEcho'
  | 'venomTransfer'
  /**
   * The three Wildshape passives. All of them are about the shape rather than
   * about the Druid, which is why none of them can be handed to another path.
   */
  | 'secondSkin'
  | 'verdantBlood'
  /**
   * The elites' own passives, one each — see `systems/combat/eliteKits`. They are
   * enemy-only: no mastery node grants them.
   *
   * `winterSleep` (Cave Bear) and `soulFracture` (Revenant) are lethal saves that
   * are not an Undying: the blow that would have killed them starts a sleep or
   * breaks them into fragments instead. `painFeast` (Orc Berserker) turns every
   * blow it takes into Rage, and `captainsAuthority` (Brigand Captain) is worn by
   * the Captain and handed to every other ally of his as `AuraType.Authority`.
   */
  | 'winterSleep'
  | 'soulFracture'
  | 'painFeast'
  /** The Tanuki's trick (the Yokai): struck and still standing, it slips into Stealth. */
  | 'tanukiTrick'
  /**
   * The Frost Mote's shatter: it explodes in cold when it dies. The blast itself is
   * the template's `deathBurst`; this passive is what states it on the unit card.
   */
  | 'frostBurst'
  /**
   * Jadeveil: Silk Hollow / Yokai — the Nue's two (`yokaiActions.beginNueTurn`):
   * `nueThundercloud` Shocks every hero beside it at its turn start, and
   * `nueSerpentTail` strikes the hero standing directly behind it then.
   */
  | 'nueThundercloud'
  | 'nueSerpentTail'
  | 'captainsAuthority'
  /**
   * The Beetle's three feeder passives (the private project notes, "Beetle").
   * `shellBreath`: Meditate restores more chi and banks a Carapace charge.
   * `hardenedShell` is the Signature node: Iron Carapace strikes harder, and a
   * full carapace's soak shields every adjacent ally. `shoulderToShoulder`: allies
   * beside the Beetle take less from every blow, drawn as a ring at its feet.
   */
  | 'shellBreath'
  | 'hardenedShell'
  | 'shoulderToShoulder'
  /**
   * The Beetle's side trees. `secondWatch` (a starter, one rank) lets the Beetle
   * hold two prepared Reactions where everyone else holds one; `retribution`
   * strikes back at an attacker whose blow the Beetle took (Vengeful Shell) or
   * split (Carapace Bastion) for an ally. `numbingStaff` (a starter, one rank)
   * makes the Basic Attack lay Attack Down and Magic Down for a turn;
   * `heavyHands` is a rule about Horn Sweep and Grip and Throw; `plantedGuard`
   * hardens both defences from a turn ended without moving until the next move.
   */
  | 'secondWatch'
  | 'retribution'
  | 'numbingStaff'
  | 'heavyHands'
  | 'plantedGuard'
  // Advanced (level 21–25): Monk
  /**
   * The Monk's advanced-node passives. `shellWard` (Beetle) lays a defence-scaled
   * Barrier on every ally beside the Beetle at the start of its turn;
   * `searingLight` (Firefly) makes Glowmote's bolt lay Defense Down;
   * `reapingStride` (Mantis) leaves a free step after a Twin Reap that struck,
   * once a turn (`BALANCE.MONK_ADVANCED`).
   */
  | 'shellWard'
  | 'searingLight'
  | 'reapingStride'
  // Advanced (level 26): Monk
  /**
   * `returnedBlow` (Beetle) strikes the attacker of a blow a full Carapace soaked;
   * `spilledLight` (Firefly) turns the part of Glowmote's mote that healed nothing
   * on the enemy the bolt struck; `reapersBreath` (Mantis) returns chi on a reap.
   */
  | 'returnedBlow'
  | 'spilledLight'
  | 'reapersBreath'
  // Advanced (level 21–25): Champion
  /**
   * `rallyingTaunt` (Bulwark): a Taunt of the Bulwark's that lands gives every
   * ally within reach Defense for a turn. `redMist` (Berserker): critical chance
   * while at or below half health, a stat while it holds.
   */
  | 'rallyingTaunt'
  | 'redMist'
  // Advanced (level 21–25): Hunter
  /**
   * `eagleEye` (Marksman): critical chance against an enemy this unit has Marked.
   * `openSeams` (Skirmisher): critical chance against an enemy carrying this unit's
   * blades. Both read per target by `critBonusAgainst`. `unseenBlade` (Shadowblade):
   * critical chance while Stealthed, a stat while it holds.
   */
  | 'eagleEye'
  | 'openSeams'
  | 'unseenBlade'
  // Advanced (level 26): Hunter
  /**
   * `nextQuarry` (Marksman): this unit's Mark passes on when its wearer dies.
   * `intoTheDark` (Shadowblade): a kill by this unit's blow brings Shadowstep's cooldown forward.
   */
  | 'nextQuarry'
  | 'intoTheDark';

/** One status a skill lands, before the caster's stats are folded in. */
export interface SkillEffect {
  type: StatusEffectType;
  magnitude: number;
  duration: number;
  /**
   * Odds this entry lands at all, rolled **per target**. Absent means certain.
   *
   * A chance is what lets a low-cost skill carry a hard status: Tremor stuns
   * for a quarter of a cone rather than stunning the cone. Rolled per target so
   * a wide cast is a spread of outcomes rather than one coin flip deciding
   * whether the whole board is locked down.
   */
  chance?: number;
  /**
   * Land exactly what is named here, refusing any upgrade the store would
   * otherwise apply.
   *
   * Today that means one thing: `combatStore.applyEffect` turns a Chill landing
   * on an already-chilled unit into a Freeze, and every source of Chill in the
   * game gets that for free — which is deliberate, and is the entire point of
   * the Hydromancer's Blizzard. But the path's other capstone is the Rime
   * Tornado, whose bargain is the opposite: it covers far more ground and it
   * only ever slows, so a target already chilled simply takes the damage.
   * Without an opt-out the two capstones are the same spell at two radii.
   *
   * A flag on the *effect* rather than on the skill, because the escalation
   * happens per applied status: a skill carrying a Chill and a Burn should be
   * able to hold the Chill flat without saying anything about the Burn.
   * Absent means "upgrade as normal", so nothing authored before this exists
   * changes behaviour.
   */
  exact?: boolean;
  /**
   * This entry lands on the **caster alone**, whatever the skill's footprint.
   *
   * The general rule is one line in `skillResolution`: afflictions cross to the
   * other side, auras stay on your own. On a `Ring` centred on the caster that
   * reads "every ally standing in it", which is right for a blessing and wrong
   * for armour.
   *
   * Unbreakable Vow is the case that forced it. The Bulwark's capstone taunts a
   * two-hex ring and turns *its own* armour to spines — its description says so
   * and the code's own comment claimed "the aura stays on the caster" — but the
   * Thorns went to every ally in the radius. Those are precisely the allies
   * nothing is attacking, because the same button just pulled the whole ring
   * onto the Bulwark. The path built around being hit handed its retaliation to
   * the people who are not being hit.
   *
   * Per entry rather than per skill, the reason `exact` and `chance` are: the
   * Vow carries a Taunt that must cross the line and an aura that must not
   * leave the caster, in one cast.
   */
  selfOnly?: boolean;
  /**
   * `magnitude` is a share of the **recipient's** effective maximum HP rather than
   * a number resolved from the caster (Canopy Guard). For a summon whose own Magic
   * is too small to make a shield worth casting. Both execution paths read it
   * through `damageCalc.resolveEntryMagnitude`.
   */
  ofRecipientMaxHp?: boolean;
  /**
   * The stat a fractional `magnitude` is a share of, when it is not the skill's
   * own `scaling`. `'defense'` is Physical + Magic Defense: every Barrier the
   * Beetle grants is a factor of its own shell, read as the Barrier is laid
   * (`statusEffects.scalingPower`).
   */
  scaling?: EffectScaling;
}

/**
 * The stats an effect magnitude may be a share of: a skill's damage bases, and
 * `'defense'` — Physical + Magic Defense — for effects alone.
 */
export type EffectScaling = 'attack' | 'magic' | 'hybrid' | 'defense';

/**
 * What a hit is, for the defence that answers it. Independent of `scaling`:
 * that names the stat the damage is built from, this names the armour that
 * gets to push back. A magic-powered strike need not be magical, and a weapon
 * carrying a spell need not be physical.
 */
export type DamageType = 'physical' | 'magic';

/**
 * A skill that is announced now and lands later.
 *
 * Casting it fixes the footprint — the hexes, and the aim — and writes a
 * `PreparedAttack` instead of dealing damage; it resolves from `beginTurn` on a
 * later turn of its caster, and not before every unit standing in the
 * footprint when it was cast has had a turn of its own. Mana and cooldown are
 * paid at the cast.
 */
export interface PreparedSpec {
  /**
   * Which disabling statuses cancel the preparation when they are applied to
   * the caster. A boss ignores these as ordinary disables (`bossControl`), but an
   * accepted one still lands the interrupt. Root is only honoured if listed.
   */
  interruptedBy?: ('stun' | 'silence' | 'freeze' | 'root')[];
  /** Whether a Taunt on the caster cancels it. Taunt's target control is unchanged either way. */
  tauntCancels?: boolean;
  /**
   * Hero response windows before it lands. Absent is one: every responder takes a
   * turn. Two makes a countdown of two full rounds, and a speed-granted turn never
   * counts as one (`combatStore.nextTurn`), so a hero cannot burn both at once.
   */
  windows?: number;
  /**
   * Every living hero owes the window, not only those standing in the footprint
   * at the cast. For a blast the party can walk into or out of (a Furnace Heart)
   * and for an attack that covers the whole arena (Skyfire).
   */
  everyone?: boolean;
  /**
   * Shared damage: the landing's damage is divided among the opposing units it
   * strikes, each taking `1 / N` of what a lone hero would. A hero alone takes all
   * of it. Resolved by `preparedAttacks.landingPlan`, so the preview, the banner
   * and the landing agree on N.
   */
  split?: boolean;
  /**
   * What happens when the landing strikes nobody, as the id of a hook a boss script
   * fills (`EncounterScript.whiff`): a charge, a gauge step, an objective raised.
   * Fired exactly once per landing, never when someone is struck. The banner states
   * it from the `skillText` entry `whiff.<id>`.
   */
  onWhiff?: string;
  /**
   * A hero in the footprint who holds a Barrier, Last Stand or Immovable stops the
   * attack: the blow falls on them alone at `share` of its strength, the rest of
   * the footprint is spared, any push or affliction it carried is dropped, and the
   * caster takes `casterStatus` for the round. The blocker is the shielded hero
   * nearest the caster's cast position, ties by lower id.
   */
  blockedBy?: {
    share: number;
    casterStatus?: { type: StatusEffectType; magnitude: number; duration: number };
  };
  /**
   * A per-hex block: every hero in the footprint who holds a Barrier, Last Stand or Immovable takes `share`
   * of the blow on their own hex, and the rest of the footprint lands as it would (`LandingPlan.holders`).
   * Unlike `blockedBy` nobody is spared for it. Aethelred's Crownfall: a crown point held behind a Barrier.
   */
  heldBy?: { share: number };
  /**
   * Hexes of the footprint spared because they are beside a living objective of
   * kind `besideObjective`, or lie on a hazard labelled `onHazard`. A spared hex is
   * not struck and is drawn apart from the footprint.
   */
  shelter?: { besideObjective?: string; onHazard?: string };
  /**
   * The warning stamps a seal under each hero it names (`PreparedAttack.bound` and `centres`) and each seal
   * can be answered before the landing (`PreparedAttack.tolls`): a basic attack on the caster from the seal
   * pays it (the seal and its ring are spared), a class skill from the seal pays in health and the eruption
   * still lands, and a seal left empty charges the orb. Aethelred's Foreclosure is the only user.
   */
  sealed?: boolean;
  /**
   * Breaking the warning (an interrupt on its caster, the objective it rides on destroyed)
   * knocks the caster's heat gauge down (`heatAfterQuench`, in `combatStore.removePreparedAttack`). The
   * Emerald Dragon's Furnace Heart and Skyfire.
   */
  quenchedOnBreak?: boolean;
  /**
   * The warning rides on a hero (`PreparedAttack.bound[0]`, the carrier): its footprint is the disc of the
   * skill's `aoeRadius` round them wherever they stand (`combatStore.moveUnit` re-centres it), it lands at
   * once on their hex if they fall (`preparedResolve.resolveFallenCarriers`), and it runs alongside the
   * caster's other warnings rather than holding them back (`preparedCast.canPrepare`). The Emerald Dragon's
   * Furnace Heart.
   */
  carried?: boolean;
  /**
   * How the party can answer it, past what the rules above already say (an interrupt, `blockedBy`,
   * `split`, `sealed`, `shelter`: `warnedAnswers.answersOf` reads those off the spec). Every warned
   * move in a catalog names its own (`warnedAnswers.test.ts`), so the plate, the simulator's party and
   * the briefing ask the move rather than its id.
   */
  answers?: PublishedAnswer[];
}

/**
 * One way the party can answer a warned move: what the move publishes (`PreparedSpec.answers`) and
 * what its rules imply, read together by `warnedAnswers.answersOf`.
 */
export type WarnedAnswer =
  /** Leave the footprint before it lands. */
  | { kind: 'step' }
  /**
   * Leave it to land on nobody and pay what its whiff does (`onWhiff`): the move's own line on the plate
   * says that price, so the plate does not add its whiff note.
   */
  | { kind: 'outlast' }
  /** Stun, Silence, Freeze (or Taunt) the caster: `interruptedBy`, `tauntCancels`. */
  | { kind: 'break' }
  /**
   * Destroy what it is tied to: the objective of kind `objective` bound to it or riding on it
   * (`CombatUnit.objective.bindsPrepared`, `linkedPreparedId`), or with no `objective` the units it
   * binds (`PreparedAttack.bound`: a claim's soldiers). `graded`: until then it lands as hard as that
   * objective is whole.
   */
  | { kind: 'cancel'; objective?: string; graded?: true }
  /** Shed what it feeds on before it lands: a cleansed chain is gone, Taint shed before the Verdant Judgement. */
  | { kind: 'cleanse' }
  /**
   * Stand on spared ground: beside a living objective of a kind, or on a hazard with a label. From
   * `shelter`, or published by a move whose script fixes the ground at the cast (`PreparedAttack.sheltered`).
   */
  | { kind: 'shelter'; besideObjective?: string; onHazard?: string }
  /** Hold the line with a Barrier, Last Stand or Immovable: `blockedBy`. */
  | { kind: 'block' }
  /** Stand in it together and share the blow: `split`. */
  | { kind: 'share' }
  /** Pay a seal from it: `sealed`. */
  | { kind: 'toll' }
  /** Stand with rubble or the wall at your back, and its push does not move you. */
  | { kind: 'brace' }
  /** Stand where the caster comes down, take that blow and leave him sprawled (Skyfire's landing mark). */
  | { kind: 'sprawl' }
  /** Stand in it and take it, so the ground it falls on is kept (Crownfall's black glass). */
  | { kind: 'hold' }
  /** Hand what it rides on to another hero before it lands (a carried warning: the Furnace Heart). */
  | { kind: 'pass' };

/** The answers a move publishes itself: the rest its rules already imply. */
export type PublishedAnswer = Exclude<WarnedAnswer, { kind: 'break' | 'block' | 'share' | 'toll' }>;

/**
 * What sets a Reaction off. Every trigger is about a *hostile* unit — the unit
 * the response is aimed at — and is judged when the event happens, never later.
 */
export type ReactionTrigger =
  /** Hostile damage landed on the owner. `melee` also needs the attacker beside it. */
  | { kind: 'struck'; melee?: boolean }
  /** Hostile damage landed on one of the owner's allies (not the owner). */
  | { kind: 'allyStruck' }
  /** A hostile unit finished a move within `reach` hexes of the owner. */
  | { kind: 'foeApproaches'; reach: number }
  /**
   * Hostile damage landed on the one ally the Reaction was cast on (its ward,
   * `PreparedReaction.wardId`): Carapace Leap. The ward is the subject the response
   * is aimed at, not the attacker, and a response that moves its owner waits while
   * the owner is Rooted rather than firing without the move.
   */
  | { kind: 'wardStruck' }
  /**
   * A hostile single-target blow is about to land on one of the owner's allies
   * within `reach` hexes of it (Vengeful Shell). Judged **before** the blow
   * lands, in the resolver (`beetleMoves.interceptBlow`): the owner leaps to a
   * free hex beside the ally and is struck in the ally's place, and the response
   * then answers the attacker once the action has resolved. Area blows are never
   * taken. Each interception spends one of `shotsPerRound`.
   */
  | { kind: 'interceptAlly'; reach: number };

/**
 * A skill that trades the owner's action for a conditional answer.
 *
 * Casting it spends the owner's whole turn (`reactionCast`) and writes a
 * `PreparedReaction`; nothing is dealt. For `duration` of the owner's own
 * regular turns the trigger may set it off once — the `response` then resolves
 * through the ordinary skill resolver, aimed at the hostile unit that caused
 * the trigger, and the preparation is spent. If the trigger never comes the
 * preparation expires and the action is simply gone. The rules for ordering,
 * expiry and bonus turns live in `systems/combat/reactions`.
 */
export interface ReactionSpec {
  trigger: ReactionTrigger;
  /** The owner's own regular turns it stays ready. Bonus turns do not count. */
  duration: number;
  /** The strike or effect that fires. Never itself a Reaction or a preparation. */
  response: HeroSkill;
  /**
   * A watch rather than a one-shot answer (Covering Fire): it fires up to this
   * many times per owner round instead of once, the count refilling at the start
   * of each of the owner's regular turns, and stays until `duration` runs out.
   * An attacking cast is answered once however many allies it struck, and
   * damage dealt by a Reaction's own response never sets it off.
   */
  shotsPerRound?: number;
}

/**
 * A skill that raises attackable objectives — banners, a crystal. They stand on
 * the caster's side, never act, and mean something to the caster while they
 * stand (`ObjectiveSpec`). Their health is a share of the caster's own maximum,
 * so it follows the encounter's scaling rather than being copied into a template.
 */
export interface ObjectivePlacement {
  kind: string;
  /** The objective's name; absent when the `units` catalog names its kind (`objectiveName`). */
  name?: string;
  count: number;
  /**
   * The most of this kind the caster may have standing. Defaults to `count`, so
   * a skill cannot be recast on top of its own field: it is available again
   * once enough have fallen.
   */
  maxStanding?: number;
  /** Each objective's HP, as a fraction of the caster's maximum HP. */
  hpFraction: number;
  defense?: number;
  /** Share of the caster's incoming damage each absorbs while it stands. */
  protection?: number;
  /** Share of an area hit each shrugs off itself (`ObjectiveSpec.areaResist`). */
  areaResist?: number;
  /** The caster's turns before it expires. Absent = until destroyed. */
  turnsLeft?: number;
  onDestroy?: { type: StatusEffectType; magnitude: number; duration: number }[];
  onAllDestroyed?: { type: StatusEffectType; magnitude: number; duration: number }[];
  /** Where it goes: free hexes beside the caster (default) or the aimed hex. */
  placement?: 'near' | 'aimed' | 'front';
  /** Removed when the caster changes boss phase. Defaults to true. */
  shattersOnPhase?: boolean;
  /**
   * Tie it to the preparation this same skill announces: destroying it cancels
   * that attack, and the attack landing spends it. A Furnace Heart is this.
   */
  linkedToPrepared?: boolean;
  /**
   * The hero who destroys one of these takes a Barrier worth this share of their own maximum health
   * (`damageFunnel.objectiveFell`), in whatever order they fall. Destroying them any other way (the
   * phase turning, shattering) pays nobody. Aethelred's Imperial Standards pay the breaker.
   */
  breakerBarrier?: number;
  /**
   * Health the caster loses when one of these is destroyed, as a share of its maximum
   * (`ObjectiveSpec.backlash`). A Furnace Heart broken burns the Dragon.
   */
  backlash?: number;
  /**
   * What `backlash` loses for each challenge tier its caster stands above the first
   * (`CombatUnit.challengeTier`, `objectiveBoard.placementBacklash`), never below 0.
   * Aethelred's Imperial Standards cost him less at every Seal tier.
   */
  backlashTierStep?: number;
}

export interface HeroSkill {
  id: SkillId;
  /**
   * Legacy display text, read through `skillName` / `skillDescription` (`data/gameText.ts`),
   * which prefer the catalogs; absent on a skill whose words are in a catalog.
   */
  name?: string;
  description?: string;
  /**
   * The catalog id of this skill's words when it shares its `id` with another skill
   * but reads differently (Aethelred's final-phase Foreclosure).
   */
  textId?: string;
  targetType: SkillTargetType;
  range: number;
  aoeRadius?: number;
  damage?: number;
  /**
   * Which stat `damage` multiplies. Defaults to `attack`.
   *
   * Spells scale off `magic`, so a caster's damage comes from the stat its
   * class, gear and buffs actually build — a staff granting +magic used to do
   * nothing at all for an Arcanist's damage. Healing has always keyed off
   * `magic`; this makes offence match.
   */
  /**
   * `hybrid` averages the two — `(attack + magic) / 2` — and exists for the
   * Templar, whose whole kit is a weapon carried by holy light: gear and nodes
   * on either stat feed every offensive press, which is what makes the path a
   * hybrid rather than a warrior with a spellbook.
   */
  scaling?: 'attack' | 'magic' | 'hybrid';
  /**
   * The defence this skill's damage is measured against. Absent resolves
   * through `damageTypeOf`, which reads the deliberate per-skill table in
   * `data/skills/damageTypes.ts` and falls back to physical. Never inferred
   * from `scaling`: a Templar's hybrid strike and a Stoneshaper's magic-scaled
   * earth are decisions, not consequences.
   */
  damageType?: DamageType;
  /** Announce now, resolve later — see `PreparedSpec`. */
  prepares?: PreparedSpec;
  /** Spend the action on a conditional answer instead — see `ReactionSpec`. */
  reaction?: ReactionSpec;
  /** Raise attackable objectives — see `ObjectivePlacement`. */
  places?: ObjectivePlacement;
  healing?: number;
  /**
   * Makes `healing` depend on how wounded the **target** is: `healing` is what
   * the heal is worth on a target with almost nothing left, and the multiple
   * falls toward `floor` x `healing` as the target nears full health, along
   * `missingFraction ** curve`. Resolved by `calculateHealing` when it is given
   * the target, so the resolver, the AI and the tests share one curve; a tooltip
   * states the two ends rather than a single number. Second Wind is the only
   * user.
   */
  healingByMissing?: { floor: number; curve: number };
  /**
   * What `healing` is a multiple of. Omitted, it is the caster's Magic, as for
   * every ordinary heal. `'missingHp'` makes it a fraction of the **target's**
   * missing health instead (of its combat maximum, read as the heal lands), so
   * a heal that has nothing to do with spellcraft — Disengage binding a wound —
   * is worth the same to a Hunter as to a Druid and is worth most when it is
   * needed. Heal power from gear still amplifies it. Resolved in
   * `calculateHealing`; with no target given it reads the caster, which is who
   * a self-heal of this kind lands on.
   */
  healingBasis?: 'missingHp';
  /**
   * On dealing damage, mend the **most wounded ally by health fraction, the
   * caster included** (ties go to the nearer; see
   * `combatEvents.allyHealRecipient`) for this multiple of the caster's magic — through
   * `calculateHealing`, so `healPower` gear applies. Distinct from `healing`,
   * which lands on allies inside the skill's own footprint — Smite's footprint
   * is the enemy being hit, and the light spilling off the blow is the
   * Templar's identity in one field. Resolved in
   * `combatEvents.applyAllyHealOnHit` so both execution paths obey it.
   */
  allyHeal?: number;
  /**
   * Glowmote's mote: after the cast, `share` of the damage it dealt heals the
   * most hurt ally within `reach` hexes of the **caster**, by health fraction —
   * the caster only when nobody else in reach is hurt. Distinct from `allyHeal`,
   * which is a multiple of Magic and counts the caster among the candidates from
   * the start. Brighter Motes raises both numbers (`fireflyRules.moteSpec`).
   * Resolved in `combatEvents.applyMote`.
   */
  mote?: { share: number; reach: number };
  /**
   * Firefly Motes: a self-cast that lays `count` motes of light on random free
   * hexes within `BALANCE.FIREFLY.MOTES_RADIUS` of the caster. Each waits for the
   * fight on its hex until a unit arrives on it by any route — a move, a dash or
   * blink landing, a push (`combatStore.moveUnit`): an ally of the caster heals
   * `heal` × the caster's Magic (fixed when laid) and gains the mote's Attack and
   * critical chance; an enemy only puts it out. A rung moves the count by
   * `perRank.motes`. See `systems/combat/fireflyRules`.
   */
  motes?: { count: number; heal: number };
  /**
   * A single-target heal that also lands on its caster (Lay on Hands): aimed at an
   * ally, the ally and the caster each receive the whole `healing` once, each
   * through `calculateHealing` and `healUnit` for its own recipient, so each heal
   * raises its own `onHeal`. Aimed at the caster, the caster is healed once — the
   * footprint holds each distinct recipient a single time. It must be aimed at an
   * ally or the caster: the caster's own hex is always in the footprint, so the
   * highlight pass and the resolver both read the aimed hex alone for that rule.
   * Added to the footprint by `getSkillTargets`, so the preview, the resolver and
   * the AI read one list.
   */
  healsCaster?: boolean;
  /**
   * The caster stands in this skill's footprint but takes none of its `healing`:
   * "the allies around you" rather than "everyone here". The Firefly's Lantern
   * Sweep (a ring round itself) and Lantern Glide (a ring round its landing).
   */
  sparesCaster?: boolean;
  /**
   * The passive that lets whoever owns it choose a mode (Mercy or Wrath) for
   * this skill before aiming it. One skill, one id, one cooldown — the mode is
   * not a second skill but a choice made at the press and passed to the resolver
   * as `ResolveOptions.mode`; `skillModes.applySkillMode` derives the cast's
   * numbers from it. Smite names `zeal`.
   */
  modeChoice?: PassiveId;
  /**
   * The mode this particular copy has been resolved for. Stamped by
   * `applySkillMode` on a derived copy and never authored: it is how a tooltip
   * or a test can tell which numbers it is looking at.
   */
  mode?: SkillModeId;
  pushDistance?: number;
  /**
   * A status laid on a target the knockback drove into something — the arena's
   * edge, solid rubble, an objective or another body — whether it moved a hex
   * first or not at all. Concussive Shot's Stun. Nothing happens to a target
   * that cannot be shoved (Immovable): it was never driven into anything.
   */
  collisionEffect?: SkillEffect;
  /** Fraction of damage dealt returned to the caster as healing (0.3 = 30%). */
  lifesteal?: number;
  /** Moves the caster as part of the skill — see `SelfMoveSpec`. */
  selfMove?: SelfMoveSpec;
  /**
   * Strikes up to this many **different** living enemies, picked at random from those
   * within `aoeRadius` of the aimed hex when the skill resolves (Skyfall). Fewer
   * enemies means fewer strikes: a target is never struck twice to fill the count.
   * The footprint is the chosen enemies' hexes, so the flash and the camera frame
   * the bodies struck; the aim preview draws the whole area.
   */
  randomEnemies?: number;
  /**
   * Projectiles fired one after another at one enemy at a time (Glacial Barrage).
   * Each is a whole strike at `damage`; when the target dies the rest go to the
   * nearest other enemy in range, and they dissolve when none remains. A node's
   * rung moves the count (`perRank.barrage`), never the damage per projectile.
   */
  barrage?: number;
  /**
   * Reaches every living enemy in the arena, wherever it stands (Burning Out). The
   * footprint is those enemies' hexes and nothing else, so the preview, the flash and
   * the camera frame the bodies it reaches rather than a generated circle of empty or
   * off-board ground; range and radius modifiers have nothing to widen. Cast on the
   * caster's own hex, like a self-centred `Ring`.
   *
   * A skill that also helps its own side (`skillTargetKind` 'mixed', Bedrock Stand)
   * reaches every living ally in the arena too, the caster included; allied
   * objectives are not allies.
   */
  arenaWide?: boolean;
  /** Every target is struck this many times, each a whole strike (Absolute Zero's beam). */
  repeats?: number;
  /**
   * The footprint stays as living ground after the cast (Wild Sanctuary): at the
   * start of each of the caster's next `turns` regular turns it pulses the skill's
   * `healing` onto allies and `damage` onto enemies standing in it, and the first
   * pulse that catches an enemy, the cast's own included, Roots it for
   * `rootTurns`. One Root per enemy per cast. See `systems/combat/sanctuary`.
   */
  sanctuary?: { turns: number; rootTurns: number };
  /**
   * A `Line` that is three hexes wide and runs from the caster to the arena's edge
   * along the hex axis nearest the aim, rather than to the aimed hex.
   */
  beam?: boolean;
  /** Used across two turns: charge now, release next regular turn (`ChargeSpec`). */
  charge?: ChargeSpec;
  /**
   * Set on the release half of a charged skill (`chargeStage`), never authored.
   * `chargePending` marks one charged this very turn, which cannot fire yet.
   */
  releasing?: boolean;
  chargePending?: boolean;
  /**
   * Flat HP the caster pays to use this, taken on resolution.
   *
   * Flat rather than a fraction, and deliberately never scaled by a mastery
   * node's level: it is the *price*, and a price that shrank as the node was
   * raised would turn a trade into a strictly-better button. Ignores barriers
   * and armour for the same reason — this is not something hitting the caster.
   */
  selfDamage?: number;
  /**
   * Whether using this leaves the caster's turn unspent.
   *
   * Reposition carries it, and it is the reason that skill exists: a Bulwark's
   * job is to be *between* things, and every other way of getting there costs
   * the action it was trying to buy. Primal Surge and Disengage carry it too
   * (the full list is pinned by `v3Skills.test.ts`). Cooldowns and mana are
   * still paid — what is free is only the turn.
   */
  freeAction?: boolean;
  /**
   * Lets a `free` self-move be aimed at an ally as well as at open ground, and
   * the fraction of the skill's flat aura each of the two then receives.
   *
   * Aimed at ground the caster goes there and keeps the whole aura; aimed at an
   * ally the caster dashes to the nearest free hex beside them and the aura is
   * split — the caster and the ally each get this fraction (0.5 = half each).
   * Exactly one skill carries it (`reposition`).
   */
  allyShare?: number;
  /**
   * The caster blinks behind the enemy it strikes: its back hex when free, else the
   * free rear-side hex nearest the caster, else the caster stays (`facing.landingBehind`).
   * Not while the caster is Rooted, which binds every kind of self-move: the blow
   * lands from where it stands.
   *
   * - `'first'` (the Mantis's Flicker Cut, the Fallen Order's): the blink comes before
   *   the blow, so the blow is itself a backstab (playtest 2026-10-21, PT-17).
   * - `'after'` (the Last Lesson's Pilgrim's Step): the blow, then the blink, only while
   *   the enemy still stands; the caster ends facing it, so the next blow from there
   *   is a backstab or a flank until the enemy turns.
   */
  blinksBehind?: 'first' | 'after';
  /**
   * One of the Mantis's three capstones (`systems/combat/mantis`), each with a rule of
   * its own the resolver runs:
   *
   * - `markedPrey` marks an enemy and deals nothing; while the mark stands the same
   *   button is its release (`mantisStage`), a blink behind the prey, a certain
   *   critical Basic Attack, a cut worth a share of what the prey has lost since the
   *   mark, and a blink back. The mark locks nothing.
   * - `threefoldScythe` is a launch (the skill as authored) that queues two bonus
   *   turns, each locked to the next of its `stages`.
   * - `execution` blinks behind its prey before it cuts; a kill queues a bonus turn
   *   and leaves the cooldown unstarted.
   */
  mantisCapstone?: 'markedPrey' | 'threefoldScythe' | 'execution';
  /**
   * The later stages of a staged launch (Threefold Scythe), merged over the skill on
   * the bonus turns the launch queued: stage two is `stages[0]`, stage three
   * `stages[1]`. Ranked with the node when `perRank.nested` is set.
   */
  stages?: Partial<HeroSkill>[];
  /**
   * Set on a Mantis capstone's later half at use (`mantisStage`), never authored:
   * Marked Prey's `release`, or the Threefold Scythe stage (2 or 3) this turn is
   * locked to. Either costs nothing and ignores the cooldown the first half started.
   */
  mantisStage?: 'release' | 2 | 3;
  /** Caster cannot be targeted until the start of its next turn. */
  grantsUntargetable?: boolean;
  /**
   * What each rung of the node that grants this skill adds, around the authored
   * numbers (which are the middle rung's): rank 1 is `-1` step, rank 3 is `+1`.
   * `duration` is turns added to every status the skill applies; `cooldown` is
   * turns added to its cooldown (negative makes it faster). Only read by
   * `scaleSkill`, so a skill nobody ranks up never sees it.
   */
  perRank?: {
    duration?: number; cooldown?: number; barrage?: number; echoMagic?: number;
    /** Firefly Motes: motes added per rung (`HeroSkill.motes.count`). */
    motes?: number;
    /** Hexes of `aoeRadius` added per rung (Carapace Bastion: 1 / 2 / 3). */
    radius?: number;
    /** Hexes of an `interceptAlly` Reaction's reach added per rung (Vengeful Shell: 2 / 3 / 4). */
    reach?: number;
    /**
     * The rung also scales the damage of the nested strike: a charge's release or
     * a Reaction's response. Off by default, because Absolute Zero's beam and the
     * Bulwark's Riposte were authored flat.
     */
    nested?: boolean;
    /**
     * The rung curve the skill's Barrier entries scale by, rungs 1 / 2 / 3, in place
     * of the node's `LEVEL_SCALE` — the Beetle's shields climb more steeply than
     * anything else a rung buys (`BALANCE.BEETLE.BARRIER_RANK_SCALE`). The middle
     * value is 1, so the authored number stays the rank-two one. Reaches a nested
     * Reaction's response when `nested` is set too.
     */
    barrierScale?: readonly [number, number, number];
  };
  /** Hits harder when the target is in a particular state. */
  bonusVs?: BonusVsSpec;
  /**
   * What the skill becomes against a target that can be neither moved nor
   * stunned — a boss, or a unit both Immovable and immune to Stun (Grip and
   * Throw: the heavier blow instead of the throw and the Stun, and nothing
   * else). Merged over the skill like `occupiedVariant`, once, at the top of
   * `resolveSkillUse`, so the strike, the push and the statuses all read one
   * skill; `beetle.immovableTarget` is the test.
   */
  immovableVariant?: Partial<HeroSkill>;
  /**
   * The footprint becomes a Bastion for `turns` of the caster's regular turns
   * (Carapace Bastion): static ground, an `ArenaHazard` carrying `bastion`. While
   * an ally of the caster stands inside and is struck by a hostile blow, `share`
   * of it is taken by the caster instead (`beetle.bastionCover`). The caster's own
   * blows are never split. One per caster; a recast replaces it.
   */
  bastion?: { turns: number; share: number };
  /**
   * Trade places with the ally aimed at (Shell Swap): the caster lands on the
   * ally's hex and the ally on the hex the caster left, two bodies moved at once.
   * The skill's aura entries land on both; its affliction entries, with a shove
   * of `swapsPlaces.push` hexes, on every enemy beside the caster's new hex. Root
   * on the caster refuses it. See `beetleMoves.swapPlaces`.
   */
  swapsPlaces?: { push: number };
  /**
   * A state the target must already be in for the skill to be *legal* at all.
   *
   * Distinct from `bonusVs`, which only changes what a strike is worth. This
   * changes what may be clicked, so it has to be honoured in three places that
   * must agree — the targeting highlights, the resolver and the AI's candidate
   * scan — or the HUD will offer a target the rules then refuse.
   *
   * Deliberately a closed vocabulary rather than a predicate: a gate is a
   * promise the UI has to be able to explain and to draw, and every new kind is
   * a new sentence in the tooltip plus a new marker on the board.
   *
   * **All entries must hold.** The Shadowblade's Assassinate is the reason it
   * is a list — it wants a target that is both dying *and* poisoned, and two
   * separate fields would have made "and" versus "or" a thing every call site
   * had to guess at.
   */
  requiresTarget?: readonly TargetRequirement[];
  /**
   * What the skill becomes when the hex it is aimed at holds an enemy.
   *
   * One button, two skills, chosen by where it is pointed — the Shadowblade's
   * Shadowstep is a blink to open ground and a gap-closing stab at a body.
   * Merged over the base skill, so a variant only states what differs.
   *
   * Deliberately keyed on occupancy rather than on a modifier key or a second
   * button: the player is already pointing at the thing that decides it.
   */
  occupiedVariant?: Partial<HeroSkill>;
  /**
   * Which side of the line the aimed hex must hold a living unit of.
   *
   * Needed by skills whose payload is neither damage nor healing, because that
   * is what the highlight pass reads to decide who a skill is *for*: a Ring that
   * only taunts and repositions matched neither test, so every reachable hex lit
   * up. The Bulwark's Intercept — "throw yourself in front of an ally" — could
   * therefore be aimed at bare ground or at the enemy it was meant to body-block,
   * which is the opposite of the skill.
   *
   * The caster's own hex never satisfies it: standing in front of yourself is
   * Bellow, and it is a different node.
   */
  targetSide?: 'ally' | 'enemy';
  /**
   * Extra bodies a `Chain` skill leaps to after the one it was aimed at.
   *
   * Two numbers rather than one because they answer different questions: how
   * many enemies the bolt is worth, and how far apart they may stand. A single
   * "range" would make a crowd of three and a line of three across the arena the
   * same skill.
   */
  chainJumps?: number;
  /** How far each hop may reach. Defaults to 2. */
  chainRange?: number;
  /**
   * Each hop of a `Chain` lands at this fraction of the one before it (Ricochet
   * Shot: 1, then 0.7, then 0.49). Absent, every body takes the full strike.
   */
  chainFalloff?: number;
  /**
   * Damage scales with the hex distance from the caster to the target at the
   * moment it lands: the authored `damage` is the value at this distance, and
   * twice as far is twice as hard (Aimed Shot's release, reference 4).
   */
  distanceScale?: number;
  /**
   * The Skirmisher's Embedded Blades: each pass of this skill that lands on an
   * enemy (not dodged) leaves this many of the caster's blades in it. A pass is
   * counted once however many hands struck in it, so a dual-wield Basic Attack
   * is one blade and each Flurry knife is one more. Embedded after every pass and
   * before an extraction (`extractsBlades`). See `AfflictionType.Blades`.
   */
  embedsBlades?: number;
  /**
   * The Skirmisher's Signature: after its passes, pull the caster's own blades
   * out of every enemy in the footprint, one damage event per enemy worth
   * `BLADE_EXTRACT_PER_BLADE` × Attack for each blade removed. The extraction
   * cannot be dodged, can crit, and embeds nothing. Without the Fan of Blades
   * node the skill has no throw of its own: its only passes are Flurry's knives.
   */
  extractsBlades?: boolean;
  /**
     * Knife Dance: three legal dashes, each followed by a throw at the nearest
     * living enemy (random ties, repeat victims allowed). Root refuses it.
   */
  knifeDance?: boolean;
  /**
   * Assassinate (Shadowblade remaster): the cast deals nothing and puts the
   * caster's Death Mark on the enemy aimed at, at any range, moving it off any
   * unit it marked before. The execution comes later, by itself, at the start
   * of the caster's turn (`assassination`).
   */
  deathMark?: boolean;
  /**
   * An effect placed on the *caster* when this skill kills something.
   *
   * Distinct from a passive: it belongs to the skill, so a hero who has not
   * taken that node does not get it, and it does not fire off anyone else's
   * kills.
   */
  grantsOnKill?: SkillEffect;
  /**
   * Hits harder the more of an affliction the target is already carrying.
   *
   * Measured against the attacker's own attack rather than in raw magnitude, so
   * "a hit's worth of poison on them" means the same thing at level 5 and level
   * 20 — the alternative scales with the square of the campaign's stat inflation.
   */
  amplifiedBy?: StatusAmplifierSpec;
  /**
   * How wide this finisher's window is, relative to the standard one.
   *
   * Exists because two paths execute from very different places. The Berserker
   * stands in the middle of the fight to swing; the Marksman does it from six
   * hexes away and never pays for the position, so its window is narrower. A
   * scale rather than an absolute keeps both moving together when the base
   * threshold is retuned. Defaults to 1.
   */
  executeThresholdScale?: number;
  /** Cashes an affliction in for a burst — see `DetonateSpec`. */
  detonates?: DetonateSpec;
  unlockLevel: number;
  /**
   * Turns before the skill can be used again, counted from the turn after it is
   * cast. Omit for an at-will skill.
   *
   * Mana already limits *how many* strong things you do in a fight; a cooldown
   * limits how *often*, which is what stops an area taunt or a party-wide buff
   * from simply being pressed every round.
   */
  cooldown?: number;
  manaCost: number;
  vfxColor?: string;
  /**
   * The colour is part of what the attack is, so a plain strike keeps it instead of
   * being drawn neutral (`vfxResolve.isPlainStrike`): the Glass Spitter's blue bead.
   */
  vfxThemed?: boolean;
  /** Omit to fall back to a shape derived from targetType/range — see resolveVfxKind. */
  vfxKind?: VfxKind;
  /**
   * A tell drawn before the main shape — see `VfxPrelude`. Authored on the
   * capstones, whose importance the bare shape undersold. Never on a summon:
   * the creature stands on the board the moment the skill resolves, so a tell
   * that held its picture back would arrive after the thing it announces.
   */
  vfxPrelude?: VfxPrelude;
  /** What the struck ground keeps showing after the blow — see `VfxAftermath`. */
  vfxAftermath?: VfxAftermath;
  /**
   * How this skill's blows arrive, for the ear: a blade, a club, an arrow, a
   * beast's teeth, a spell. Presentation only, like `vfxKind` — nothing in the
   * rules reads it.
   *
   * **Omit it unless the skill says something its caster cannot.** Read through
   * `strikeDelivery`, which already knows a form skill is a beast's paws, a
   * magic-scaled skill is a spell, and a hero's weapon skill is delivered by the
   * weapon in their hand — so a Champion's Rend is a cut with a sword and a
   * crushing blow with a hammer, from one authored skill. It is named on the
   * shared skills whose owners cannot be read that way: a wolf's Bite, a troll's
   * Smash, a knife somebody throws.
   */
  delivery?: StrikeDelivery;
  /**
   * What a thrown skill throws, drawn as itself in flight (`VfxSpec.projectile`). Set by
   * `basicAttackWith` from a throwing weapon in the hand; named skills are mapped in
   * `THROWN_BY_SKILL`.
   */
  projectile?: Projectile;
  /**
   * The school this spell sounds as — fire, frost, storm, earth, nature or arcane,
   * or `bolt` for the plain magic missile. Presentation only.
   *
   * **Omit it unless the effect's own shape and colour read the wrong school.**
   * `spellFamily` reads the vfx kind (lightning is storm, snow is frost) and then
   * the effect's hue, so a skill drawn in orange is fire without saying so; it is
   * named where the picture is the wrong guide — a blue fire, a red frost.
   */
  spell?: SpellFamily;
  /**
   * A named move this skill is heard as when used — a horn, a beast's call, stone
   * raised, a creature spitting — in place of its cast or swing. Presentation only;
   * omit it for a skill its school or support kind already says. A shift and a
   * summon are read off `shiftsTo` and `summons` and need none.
   */
  gesture?: SkillGesture;
  /**
   * The kind of support this skill is heard as when its effects read the wrong one —
   * Shell Swap lays an Attack Down on the foe it swaps with, but what the player does
   * is put a shell on an ally. Presentation only; omit it where `supportFamily` reads right.
   */
  support?: SupportFamily;
  /**
   * What this skill's blows are made of where the delivery is the wrong guide — a
   * bite, a claw, a web, acid, a thrown block of ice — heard in place of the
   * delivery's or the school's landing. Presentation only.
   */
  contact?: StrikeContact;
  /**
   * Status the skill lands, or several of them.
   *
   * A list is allowed because some blessings are genuinely more than one thing —
   * "immune to everything" is `Invulnerability` *and* `DebuffImmunity`, and
   * splitting that across two skills would be a lie about what the button does.
   * Read it through `skillEffects()` rather than directly; the single form stays
   * legal because most skills apply exactly one status and a one-element array
   * everywhere would be noise.
   *
   * Side selection is per entry and unchanged: afflictions cross the line to
   * enemies, auras stay on allies.
   */
  appliesEffect?: SkillEffect | SkillEffect[];
  cleanse?: boolean;
  /** Calls creatures onto the field. Available to heroes and enemies alike. */
  summons?: SummonSpec;
  /**
   * Wildshape: the beast this skill turns the caster into. Casting it while
   * already in that shape turns them back, so one button covers both directions.
   */
  shiftsTo?: WildFormId;
  /**
   * Wildshape: the beast whose paws this skill needs.
   *
   * A form skill is on the hero's list the moment the node granting it is
   * bought, but it only reaches the action bar while that shape is worn — the
   * Druid cannot slam the ground with a bear's weight while standing upright.
   * Kept on the skill rather than as a second list on the form, so a node that
   * grants one cannot forget to register it somewhere else.
   */
  formSkill?: WildFormId;
  /**
   * Wildshape's form-usable capstones (Primal Surge, Ancestral Hunt): on the bar in
   * every shape the Druid wears, upright included, rather than in one shape only.
   * `skillsForForm` reads it. Never set together with `formSkill`.
   */
  anyForm?: boolean;
  /**
   * A dash whose area is a ring of `aoeRadius` round where it lands, not round the
   * aimed hex (Antler Charge). The preview, the resolver and the picture all read
   * the footprint from the landing.
   */
  landingBurst?: boolean;
  /**
   * Root and Chill come off the caster before it moves (Slip the Net), so the one
   * skill a Rooted Wolf can still use to leave is this one.
   */
  slipsBonds?: boolean;
  /**
   * Primal Surge: running cooldowns of the caster's Bear, Wolf and Hawk skills come
   * this many turns forward. Shift skills and capstones are left alone.
   */
  refreshesFormSkills?: number;
  /** Ancestral Hunt's three spirit strikes — see `SpiritHuntSpec`. */
  spiritHunt?: SpiritHuntSpec;
  /**
   * Pass the Heart: not a class skill but the party's action against the Emerald Dragon's carried
   * Furnace Heart, put on a hero's bar only while a pass is legal (`dragonScript.passTargets`). Aimed at an
   * ally (by the carrier) or at the carrier (by an ally), it moves the Heart to the other, costs the action
   * and nothing else (`dragonActions.passHeart`, through the resolver).
   */
  passesHeart?: boolean;
  /** A mark left on the enemy a landed strike hit — see `StrikeMarkSpec`. */
  marks?: StrikeMarkSpec;
  /**
   * The strike is made once per hand, each at `BALANCE.DUAL_WIELD_STRIKE_SCALE`.
   *
   * Only the weapon-driven Basic Attack of a hero holding two weapons carries
   * it — see `systems/combat/basicAttack.ts`. Each hand is a whole strike in
   * `resolveSkillUse`: its own dodge, crit, armour, on-hit statuses and its own
   * drain, which is the dual-wielder's advantage rather than an accident, so
   * nothing caps the procs to once per action.
   */
  dualWield?: boolean;
  /**
   * Whose picture stands for this skill while it has none of its own.
   *
   * The Basic Attack is one skill id wearing a weapon's face: a bow shows the
   * ranged shot and a staff the arcane bolt, so the bar says what the button
   * will do. Read through `constants/icons.skillIconFor`, never directly.
   */
  icon?: SkillPictureId;
}

/**
 * The Wildshape beasts.
 *
 * Named `WildFormId` rather than `FormId` because that name already belongs to
 * item silhouettes — two unrelated concepts sharing a type name is how a bow
 * ends up being a valid argument to `setWildForm`.
 */
export type WildFormId = "bear" | "wolf" | "hawk" | "apex";

/**
 * The shapes a Druid carries from one fight into the next (`Hero.wildForm`, PT-16):
 * the three animals. Apex is a three-turn burst on a clock with a long cooldown,
 * so it is never carried — a fight that ends in it begins the next one upright.
 */
export type CarriedWildFormId = Exclude<WildFormId, "apex">;
