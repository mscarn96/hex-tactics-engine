import type { HeroClass } from './enums';
import type { HexCoord, HexDirection } from './hex';
import type { EnemyTemplateId, HeroTemplateId, SummonTemplateId } from './ids';
import type { EquipSlot } from './items';
import type { MasteryId, MasteryModifier } from './mastery';
import type { DamageType, HeroSkill, PassiveId, PassiveRank, PreparedSpec, ReactionSpec, SkillEffect, VfxAftermath, WildFormId, CarriedWildFormId } from './skills';
import type { ActiveEffect, StatusEffectType } from './status';
import type { StrikeDelivery } from './sound';

// ============ STATS ============

export interface HeroStats {
  maxHp: number;
  attack: number;
  /** Physical Defense: what answers physical hits. */
  defense: number;
  /**
   * Magic Defense: what answers magic hits. Optional — absent tracks
   * `defense` at `BALANCE.MAGIC_DEFENSE_RATIO`, so a unit that never states one
   * is mitigated alike by both until content separates them. Stated, it is
   * independent. `magicDefenseOf` is the one reader.
   */
  magicDefense?: number;
  magic: number;
  speed: number;
  moveRange: number;
  maxMana: number;

  /**
   * Variance stats, all percentages, all optional.
   *
   * Optional so the existing hero, enemy and summon templates need no edits —
   * `resolveAttack` fills in the BALANCE defaults. Dodge in particular defaults
   * to **zero**, which keeps combat fully deterministic until something
   * deliberately grants it.
   */
  critChance?: number;
  /** Percent of base damage a crit deals. Defaults to 200. */
  critDamage?: number;
  dodgeChance?: number;

  /**
   * Percent of the target's **Physical Defense** ignored when this unit lands a
   * physical hit. Never read for a magic hit: that is `magicPen`'s.
   *
   * A separate lever from raw attack, and a sharply different one: attack is
   * worth least against armour and most against paper, and this is the exact
   * inverse. It is the answer to a wall rather than a bigger number, which is
   * why it belongs to the Berserker and to every Hunter path — the three
   * things in the game whose job is a target that will not die.
   *
   * Percentage rather than flat so it keeps meaning the same thing as defence
   * values inflate, and clamped in `damageCalc.penetration` so it can only ever
   * reduce mitigation, never invert it into a bonus.
   */
  armourPen?: number;
  /**
   * Percent of the target's **Magic Defense** ignored when this unit lands a
   * magic hit — `armourPen`'s twin for spells, under its own cap. Split from it
   * so a caster's gear can carry penetration that is worth something to a
   * caster: one stat that pierced whichever defence answered meant every
   * Sundering roll was a martial roll.
   */
  magicPen?: number;

  /**
   * The five stats a piece of loot uses to say what kind of hero it is for.
   *
   * All optional, all absent-means-zero, and every one of them is consumed by
   * exactly one system — `damageCalc`, the mana tick in `combatStore`, or
   * `statusEffects` — because a stat nothing reads is a line on a tooltip.
   *
   * They are deliberately **not** one "power" stat. Healing, shielding and
   * poison are three different jobs done by three different paths, and folding
   * them together is what made a Druid's loot and an Arcanist's loot the same
   * item with a different colour.
   */
  /** Percent of damage dealt returned to the attacker as health. */
  lifesteal?: number;
  /** Flat mana restored at the start of this unit's turn. Not a percentage. */
  manaRegen?: number;
  /** Percent added to healing this unit does. */
  healPower?: number;
  /** Percent added to the Barrier this unit grants — its own craft, not the wearer's. */
  shieldPower?: number;
  /** Percent added to the magnitude of a poison dose this unit applies. */
  poisonPower?: number;
}

// ============ HEROES ============

export interface Hero {
  id: string;
  templateId: HeroTemplateId;
  name: string;
  heroClass: HeroClass;
  level: number;
  xp: number;
  baseStats: HeroStats;
  currentHp: number;
  currentMana: number;
  skills: HeroSkill[];
  /** Item ids by slot. A missing key is an empty slot. */
  equipment: Partial<Record<EquipSlot, string>>;
  /** Chosen at level 5, permanent. Null until then. */
  masteryPath: MasteryId | null;
  /** Unspent points. One is granted per level from 6 onward. */
  masteryPoints: number;
  /**
   * Purchased nodes: node id → how many levels are bought, 1 upward.
   *
   * A map rather than the `string[]` it used to be, because a node is no longer
   * owned-or-not: every node in a tree holds three levels and each is a point.
   * An absent key and a 0 both mean unowned, and `nodeLevel` is the only thing
   * that should read this directly — a second `includes` somewhere is a second
   * place that has to remember 0 is not ownership.
   */
  masteryNodes: Record<string, number>;
  /**
   * The Wildshape animal this hero was wearing when their last fight ended, and
   * so the shape they walk into the next one in (`wildshape.openingForm`). Absent
   * or null for every hero standing in their own shape — and for every non-Druid.
   * Never `apex`: see `CarriedWildFormId`.
   */
  wildForm?: CarriedWildFormId | null;
}

export interface HeroTemplate {
  id: HeroTemplateId;
  heroClass: HeroClass;
  baseStats: HeroStats;
  statGrowth: HeroStats;
  skills: HeroSkill[];
}

// ============ ENEMIES ============

/**
 * What a unit does to the ground around it when it dies, from any cause: a Fire
 * Elemental's blast, a Frost Mote's shatter. Read off the summon or enemy template
 * (`summonTemplates.deathBurstOf`) and set off by `combatStore.detonateDeathBurst`,
 * once per death. It strikes the dying unit's opponents only.
 */
export interface DeathBurst {
  radius: number;
  /** Multiplier on the dying unit's own `scaling` stat. */
  amount: number;
  /** The stat the blast is sized by. Attack when unset (the Fire Elemental). */
  scaling?: 'attack' | 'magic';
  /** The defence that answers it. Physical when unset. */
  damageType?: DamageType;
  /** The explosion's and the numbers' colour, and what it leaves on the ground. Fire when unset. */
  color?: string;
  aftermath?: VfxAftermath;
  /** A status every unit it catches is given, sized by the dying unit's stats. */
  effect?: SkillEffect;
}

export interface EnemyTemplate {
  id: EnemyTemplateId;
  tier: "normal" | "elite" | "boss";
  baseStats: HeroStats;
  skills: HeroSkill[];
  passives?: PassiveId[];
  xpReward: number;
  goldReward: number;
  lootTable?: { templateId: string; weight: number }[];
  /**
   * What this enemy's weapon blows land as: what its model holds, or its own body when it holds
   * nothing — a club is `blunt`, claws `natural`. Read by `strikeDelivery` for a skill that names
   * no delivery of its own, so a shared Slash crushes in a troll's hand and cuts in an orc's.
   * `enemyBlows.test.ts` holds it to the model.
   */
  blow?: StrikeDelivery;
  /**
   * Its place in a warband that fights as a formation (`systems/combat/formation.ts`).
   * `line` leads the advance and marches rather than spending turns on formation buffs
   * while no foe is near; `behind` spawns on the back rank and keeps behind the line's
   * front until the line engages. Absent means it fights as an individual.
   */
  formation?: 'line' | 'behind';
  /** Goes off when it dies (`DeathBurst`); pair it with a passive that says so (the Frost Mote's `frostBurst`). */
  deathBurst?: DeathBurst;
}

// ============ COMBAT ============

/**
 * Ground that remembers: a set of hexes with a rule. A `solid` hazard (rubble)
 * is an obstacle forced movement cannot enter; a non-solid one (a fire line)
 * can be crossed and is reported when a push lands on or through it.
 */
export interface ArenaHazard {
  id: string;
  hexes: HexCoord[];
  solid: boolean;
  /**
   * What laid this ground, by id, so whatever names it reads the name in the
   * current language (`skillName` / `passiveName`): never display text, which
   * would keep the language it was laid in. Ground with neither is unnamed.
   */
  skillId?: string;
  passiveId?: string;
  /**
   * A developer's tag for authored or scripted ground (a boss's rift, a test's
   * rubble). Never shown to the player.
   */
  label?: string;
  /** Rounds left, counted when the unit that laid it begins its turn. Absent = until cleared. */
  turnsLeft?: number;
  /**
   * What ends this ground besides `turnsLeft`: `'phase'` lasts until its owner's boss
   * phase turns (`combatStore.enterPendingPhase` clears it with the objectives it
   * shatters); `'replaced'` lasts until its owner lays the next hazard of the same
   * `kind` (`combatStore.addHazard` clears the old one). Rubble, the Cinder Rift and
   * black glass use them. Absent, only `turnsLeft` (or nothing) ends it.
   */
  lasts?: 'phase' | 'replaced';
  /** The family a `'replaced'` hazard belongs to: the next hazard of this kind by the same owner replaces it. */
  kind?: string;
  ownerId?: string;
  /**
   * Set on burning ground: an enemy of `ownerId` that begins its turn on one of
   * these hexes catches a Burn stack of this size. The Pyromancer's Detonation
   * is the only thing that lays it. Never solid, and never lit under an objective.
   */
  ignites?: { magnitude: number; duration: number };
  /**
   * Fire damage a hostile body takes each time a move ends on or crosses one of
   * these hexes — its own step or a shove (`combatStore.moveUnit`). Fixed when the
   * ground is laid, so the warning can say it. A Cinder Rift is the only user.
   */
  crossDamage?: number;
  /**
   * Extra movement points a body pays to *enter* one of these hexes (frozen
   * ground). Counted by `getMovementRange`; a shove ignores it. The Heart of
   * Winter's Creeping Winter is the only user.
   */
  moveCost?: number;
  /**
   * Living ground (Wild Sanctuary): `ownerId`'s skill `skillId` pulses here at the
   * start of each of the owner's regular turns while `turnsLeft` lasts. `rooted`
   * lists the enemies this cast has already Rooted, so walking out and back in is
   * never a second Root. See `systems/combat/sanctuary`.
   */
  sanctuary?: { skillId: string; rooted: string[] };
  /**
   * Aftershock (Stoneshaper remaster, 2026-10): Tremor's footprint, marked for one
   * repeat eruption at the start of `ownerId`'s next regular turn, worth
   * `multiplier` of the owner's live Magic as physical damage to every enemy still
   * standing on it. No Stun. See `systems/combat/aftershock`.
   */
  aftershock?: { multiplier: number };
  /**
   * Carapace Bastion's ground (`HeroSkill.bastion`): while an ally of `ownerId`
   * stands on one of these hexes and is struck by a hostile blow, `share` of the
   * blow is taken by the owner instead. See `beetle.bastionCover`.
   */
  bastion?: { share: number };
  /**
   * A Firefly Mote (`HeroSkill.motes`): one hex, lasting the fight. The first unit
   * to arrive on it by any route puts it out — an ally of `ownerId` is healed `heal`
   * (fixed when laid) and gains the mote's Attack and critical chance, an enemy
   * gains nothing. Never solid and never sought: the AI's moves do not read it.
   */
  mote?: { heal: number };
}

/** What destroying, or outlasting, an objective does to the unit it belongs to. */
export interface ObjectiveEffect {
  type: StatusEffectType;
  magnitude: number;
  duration: number;
}

/**
 * Marks a `CombatUnit` as an attackable arena objective — an Imperial Standard,
 * a Furnace Heart. It has HP and can be targeted and destroyed like any enemy,
 * but it never takes a turn, never counts as a combatant for victory, and
 * stays out of the turn order. See `systems/combat/objectives`.
 */
export interface ObjectiveSpec {
  /** Which kind of objective this is, for display and for grouping. */
  kind: string;
  /** The unit whose encounter it belongs to. */
  ownerId: string;
  /** Fraction of the owner's incoming damage this objective absorbs while it stands (0–1). */
  protection?: number;
  /**
   * Fraction of an area hit's damage this objective itself shrugs off (0–1):
   * Whiteout Convergence's spires and Aethelred's standards take half from area
   * skills (playtest 2026-10-14), so one Blizzard does not clear a field of them.
   * `damageCalc.areaResistMultiplier` reads it; single-target hits are untouched.
   */
  areaResist?: number;
  /** Owner's turns left before it expires (a countdown on the owner's turn starts). */
  turnsLeft?: number;
  /** Applied to the owner when this objective is destroyed. */
  onDestroy?: ObjectiveEffect[];
  /** Applied to the owner when the *last* objective of this kind is destroyed. */
  onAllDestroyed?: ObjectiveEffect[];
  /** A prepared attack that dies with it: destroying the objective cancels it. */
  linkedPreparedId?: string;
  /** Removed when the owner changes boss phase. Defaults to true. */
  shattersOnPhase?: boolean;
  /**
   * A warning of the owner's that this objective answers without riding on it:
   * unlike `linkedPreparedId` it is not spent when the warning lands. Destroying
   * it cancels that warning — at once, or only when it is the last objective of
   * its kind to fall when `cancelsOnLast` is set.
   */
  bindsPrepared?: string;
  cancelsOnLast?: boolean;
  /**
   * Its own part of a warning it shares with other objectives bound to it: the Heart's two-anchor
   * Reprisal (tier 3 up), one warning with a line to each. Destroying it takes these hexes out of
   * the warning rather than cancelling it, and only the last of them standing cancels it.
   */
  boundHexes?: HexCoord[];
  /**
   * Health the owner loses when this falls, as a share of its maximum. Bypasses
   * the protection the objectives themselves give it.
   */
  backlash?: number;
  /**
   * What the last objective of its kind falling does to the owner: `release`
   * tears it out of its current boss phase into the next and exposes it,
   * `expose` only exposes it. Both are one window (`BALANCE.HEART_EXPOSED`).
   */
  onLast?: 'release' | 'expose';
  /** The Barrier the hero who destroys it takes, as a share of their own maximum health (`ObjectivePlacement.breakerBarrier`). */
  breakerBarrier?: number;
  /**
   * The hero this objective feeds on. A Coven Matriarch's briar seed grows only
   * while this hero is still poisoned by her; the Revenant's soul fragments name
   * no hero and leave it unset.
   */
  linkedUnitId?: string;
  /**
   * A soul fragment travelling to its body: the hexes still to cross, nearest
   * first, and how many of the owner's turns it has been under way. Nothing else
   * carries one.
   */
  route?: HexCoord[];
  travelled?: number;
  /**
   * The hero it rides on: the Emerald Dragon's carried Furnace Heart. It stands on its carrier's hex and
   * goes wherever they go (`combatStore.moveUnit`), always after them in `units`, so a lookup by hex finds
   * the hero; a blow from the carrier's side aimed at that hex strikes it instead (`objectives.struckBody`),
   * and it never stands in anyone's way.
   */
  carrierId?: string;
}

/**
 * A Reaction a unit has prepared and not yet spent. Lives in `combatStore` and
 * is only ever written through `systems/combat/reactions`.
 */
export interface PreparedReaction {
  id: string;
  ownerId: string;
  /** The skill that was cast, for its name and icon. */
  skill: HeroSkill;
  spec: ReactionSpec;
  /** The owner's regular turns left; it expires when this reaches zero. */
  turnsLeft: number;
  /** Order of preparation. Reactions answering one event fire in this order. */
  sequence: number;
  /** Answers left this owner round, for a watch (`ReactionSpec.shotsPerRound`). */
  shotsLeft?: number;
  /** The ally a `wardStruck` Reaction was cast on (Carapace Leap). */
  wardId?: string;
}

/** Something that happened which a Reaction may be waiting for. */
export type ReactionEvent =
  | { kind: 'damaged'; targetId: string; attackerId: string; byReaction?: boolean }
  | { kind: 'moved'; unitId: string }
  /**
   * An `interceptAlly` Reaction took a blow in an ally's place (Vengeful Shell):
   * its response answers `attackerId` once the action has resolved.
   */
  | { kind: 'intercepted'; reactionId: string; attackerId: string };

/** What brings an announced wave in. */
export type WaveTrigger =
  /** No enemy is left standing. */
  | { kind: 'enemiesFallen' }
  /** A unit of this template has fallen. */
  | { kind: 'unitFallen'; templateId: string };

/**
 * Reinforcements an encounter announces. A wave fires once, in authored order,
 * and the fight does not end while one is still to arrive — see
 * `systems/combat/waves`.
 */
export interface EncounterWave {
  /** Also the key of what the party is told when it arrives (`waveAnnounce`). */
  id: string;
  trigger: WaveTrigger;
  templateIds: string[];
  /** Living enemies the board may hold after it arrives. Defaults to `BALANCE.WAVE_MAX_ACTIVE`. */
  maxActive?: number;
}

/** A wave and how far through arriving it is. */
export interface WaveState {
  wave: EncounterWave;
  status: 'waiting' | 'arriving' | 'done';
  /** Templates that have not yet taken the field. */
  pending: string[];
}

/**
 * A delayed attack on the board: a fixed footprint, who it is owed a response
 * from, and how far through its window it is. Lives in `combatStore` and is
 * only ever written through `systems/combat/preparedAttacks`.
 */
export interface PreparedAttack {
  id: string;
  casterId: string;
  /** The skill as it will resolve — `prepares` stripped, so it cannot prepare again. */
  skill: HeroSkill;
  spec: PreparedSpec;
  /** Where the caster was aiming. Never re-aimed: the warning cannot retarget. */
  aim: HexCoord;
  /** Where the caster stood at the cast: the origin of any push it carries. */
  origin: HexCoord;
  /** The threatened hexes, fixed at the cast. */
  hexes: HexCoord[];
  /** Opposing units standing in `hexes` at the cast — each is owed a turn. */
  responders: string[];
  /**
   * The opposing bodies with a turn of their own that stood in `hexes` at the cast: the heroes
   * this warning threatened, and so the heroes its answer tally counts (`answerTally`). Differs
   * from `responders` only for a warning the whole party answers (a Furnace Heart, Skyfire),
   * which owes a turn from everyone but threatens only those in the blast. Absent: `responders`.
   */
  threatened?: string[];
  /**
   * Responders whose turn has ended since the cast. Listed once per window a
   * responder has answered, so a two-window warning holds each id twice when done.
   */
  responded: string[];
  /** Response windows owed by each responder before it lands. One unless the spec says more. */
  windows?: number;
  /**
   * A second footprint the same warning will strike after the first, fixed at
   * the cast: where Skyfire lands. Drawn on the board apart from `hexes`.
   */
  landing?: HexCoord[];
  /**
   * Hexes in `hexes` that an orb charge added, so the board can mark them apart
   * from the pattern the move always makes. Part of the warning, never a secret.
   */
  bonusHexes?: HexCoord[];
  /**
   * Ground left out of `hexes` at the cast because it is sheltered (Creeping Winter spares the hexes
   * beside a standing anchor), fixed with the footprint: an anchor that falls afterwards does not
   * bring it back. Drawn apart from the footprint. A hero who stands on it when the warning lands
   * stood in the warning and was not struck (`answerTally`: unharmed).
   */
  sheltered?: HexCoord[];
  /**
   * Which scripted move this warning belongs to, when it is not an ordinary
   * footprint (`systems/combat/bossScript`): a chain follows its two heroes, a
   * claim loses ground as its soldiers fall and the black sun widens.
   */
  scripted?: ScriptedWarning;
  /**
   * The units a scripted warning is tied to — the two chained heroes, the
   * branded soldiers — and, for a claim, where each stood at the cast
   * (`centres`, in the same order). The warning loses or follows them; it never
   * picks a new target.
   */
  bound?: string[];
  centres?: HexCoord[];
  /**
   * How the heroes sealed by this warning have answered it so far (`PreparedSpec.sealed`): `strike` is a basic
   * attack on the caster from the seal, which pays it; `blood` is a class skill cast from the seal, paid in
   * health. Each hero appears at most once. Foreclosure's landing reads it for the empty seals it charges the
   * orb for and the seals it spares.
   */
  tolls?: { unitId: string; how: 'strike' | 'blood' }[];
  /**
   * The vents round the edge of an Undermine footprint, fixed at the cast. A vent no
   * hero is standing on when the eruption lands spawns a Sand Mite; drawn on the
   * board apart from `hexes`, and named in the banner.
   */
  vents?: HexCoord[];
  /**
   * Jadeveil: Kairen's Gale — the one hex direction the wind blows every body along,
   * fixed at the cast. A warning with a wind pushes along it rather than away from
   * its origin (`preparedAttacks.previewPrepared`, `kairenRules.windMoves`).
   */
  wind?: HexCoord;
  /** How many hexes the wind pushes (`wind`). */
  windDistance?: number;
}

export type ScriptedWarning =
  | 'chains' | 'claim' | 'realm' | 'prey' | 'collapse'
  // The elites' (`systems/combat/eliteKits`): a marsh that pulls, a mind taken, a seed
  // that grows, a fracture that follows its heroes
  | 'undertow' | 'mind' | 'briar' | 'fracture'
  // The new-faction elites' (`systems/combat/factionEliteKits`): the Burrowmother's
  // eruption and the Glacier Colossus's collapsing tomb
  | 'undermine' | 'tomb'
  // The Jorogumo's bite (`systems/combat/yokaiKits`), bound to the webs that hold its heroes
  | 'web'
  // The Emerald Dragon's Furnace Heart, carried by a hero (`bound[0]`, `PreparedSpec.carried`)
  | 'heart'
  // Jadeveil: Kairen (`systems/combat/kairenRules`): the dive's line, the gale and its
  // downdraft, the storm's marks, the orb's ring and the judgement it calls down
  | 'kairen_dive' | 'kairen_gale' | 'kairen_storm' | 'kairen_nova' | 'kairen_verdant'
  // The archipelago, drawn ahead of its rules (`data/display/archipelagoEffects.ts`): a cannon
  // lane down from Varr's gun or from the Redsail ship offshore (`hexes` ordered from the gun,
  // drawn by `LaneMarks`), the storm deck's lightning marks and its waves, and a Siren's song
  // holding the heroes it `bound`s (drawn as `SongTether`)
  | 'varr_lane' | 'gunner_lane' | 'deck_storm' | 'deck_wave' | 'siren_song';

/**
 * What a scripted boss remembers between its turns: the counting nobody sees.
 * Everything the party can read off the board (orb charges, writs, chains,
 * brands) is a status instead.
 *
 * This is what every script shares. A script's own counters extend it
 * (`LegionScriptState`) and are read through that script's accessor, so a boss
 * that has no use for a field does not carry one.
 */
export interface BossScriptState {
  /** Position in the current phase's rotation. */
  step: number;
  /** Boss turns begun in the current phase. A phase always gets at least one. */
  phaseTurns: number;
  /**
   * A boss with no cycle remembers its own choices instead (the Emerald Dragon, the
   * Heart of Winter): the turn (`phaseTurns`) each move was last made on. `step` is
   * the turn of its last signature.
   */
  lastUsed?: Record<string, number>;
  /**
   * His regular turns begun since a hero last damaged him: 0 after any hero damage
   * (`damageFunnel`), up by one as each regular turn begins (`unharmed.noteTurnBegun`).
   * A Fury action or a speed bonus turn neither counts nor resets it. A whole round
   * unharmed reads 2 or more at the start of his turn (`wholeRoundUnharmed`).
   */
  unharmedRounds: number;
  /**
   * The Emerald Dragon's heat (`systems/combat/dragonHeat`): the reading of his Rising Fire, in
   * steps. Absent before his first turn. Each regular turn of his moves it up one step; a warning
   * of his that strikes nobody adds one more; a broken Furnace Heart, an interrupted Skyfire or a
   * sprawled landing knock it down a few steps, to no lower than a floor that rises with his turns
   * (`heatAfterQuench`).
   */
  heat?: number;
}

/** The Obsidian Emperor's own counters (`systems/combat/scripts/aethelred`). */
export interface LegionScriptState extends BossScriptState {
  /** Damage dealt to the boss since its last turn began, for The Legion Responds. */
  damageWindow: number;
  /** The Legion Responds has fired — it happens once, in phase 1. */
  legionResponded: boolean;
  /** Tithe on Mercy has already charged the orb since the last boss turn. */
  titheSpent: boolean;
  /** Damage dealt since the black sun was opened, for the Pyre's Bargain. */
  pyreDamage: number;
  /**
   * Overturn's thresholds already thrown (`bossScript.overturnDue`): 0 to 3, the first two as the phase turns,
   * the third at `AETHELRED_OVERTURN_LAST` of his health in phase 3. It outlives a phase change, so each throws once.
   */
  overturns: number;
  /** Castle tier 2: a Standard has fallen since the board last settled, so those left standing mend (`bossActions.mendStandards`). */
  standardFell?: boolean;
  /** Castle tier 5: his last throw has called the black sun, and it is his next move (`bossScript.chooseMove`). */
  realmOwed?: boolean;
}

// ── Jadeveil: Silent Hall / Fallen Order ─────────────────────────────────────

/** The Last Lesson's memory of the round (`systems/combat/lastLessonRules`). */
export interface LessonMemory {
  /** The lessons standing until his next regular turn, by id (`data/templates/lastLesson`). */
  named: string[];
  /** How many times he has named lessons: the step in their order. */
  taught: number;
  /** Whether a blow has landed on him since he named them (Patience). */
  struck: boolean;
  /** Per party unit: the skill used on its previous regular turn and on this one. */
  history: Record<string, { last?: string; now?: string }>;
  /** Where each party unit stood when its regular turn began, until that turn is judged. */
  turnStart: Record<string, HexCoord>;
  /** Strikes he owes, made between turns: a riposte for a repeat, a rebuke for a lesson. */
  owed: { unitId: string; kind: 'riposte' | 'rebuke'; lesson?: string }[];
  /** `lesson:unitId` already rebuked this round, so one lesson rebukes a unit once. */
  rebuked: string[];
}

export interface LessonScriptState extends BossScriptState {
  lesson: LessonMemory;
}

// ── Jadeveil: Kairen ─────────────────────────────────────────────────────────

/** What Kairen remembers across his whole fight (`systems/combat/kairenRules`); phases keep it. */
export interface KairenMemory {
  /** His regular turns begun this fight, every phase counted. */
  turns: number;
  /** The turn each of his moves was last made on (absent: never). */
  lastUsed: Record<string, number>;
  /** The phase the board was last put right for (0–2), or −1 before the first. */
  boardPhase: number;
  /** The wyrmlings of his last Brood, by id, and the turn it was cast. */
  brood: string[];
  broodTurn: number;
  /** How many Gales he has called: the wind turns with each. */
  gales: number;
  /** Each hero's Taint as the board last said it, so a change floats once. */
  taintSeen: Record<string, number>;
}

export interface KairenScriptState extends BossScriptState {
  kairen: KairenMemory;
}


export interface CombatUnit {
  /** Actual hero level, or an enemy's combined encounter power compressed into the campaign display range. */
  level?: number;
  id: string;
  name: string;
  isPlayer: boolean;
  /**
   * Links back to a `partyStore` hero. Summons deliberately have none, which is
   * what the defeat check keys on — a surviving summon must not keep a wiped
   * party standing.
   */
  heroId?: string;
  templateId?: HeroTemplateId | EnemyTemplateId | SummonTemplateId;
  /** An enemy's `EnemyTemplate.blow`: what its weapon blows land as. */
  blow?: StrikeDelivery;
  /** Level/encounter strength before campaign HP scaling; summon inheritance never re-infers it from rounded HP. */
  enemyStatScale?: number;
  /** Beyond the Empire: the fixed level this enemy's fight stands at, which what it calls up reads as too. */
  contentLevel?: number;
  /**
   * A home-ring foe, and what it summons or calls: left at the base balance by
   * `BALANCE.ENEMY_STRENGTH` (playtest 2026-10-30), so the ground round the city
   * stays the tutorial `homeRing.test.ts` holds it to. See `runDifficulty.ts`.
   */
  sparedStrength?: boolean;
  /** Set on summoned units. Its presence is what marks a unit as temporary. */
  summonedBy?: string;
  /**
   * A summon fielded with others of its kind is numbered ("Risen Skeleton 2"):
   * `unitName` reads its template's name and adds this.
   */
  nameIndex?: number;
  /** Turns left before the summon expires. Undefined means "until it dies". */
  summonTurnsLeft?: number;
  /**
   * A companion summon (the Thunder Elemental): it takes no turn of its own and has
   * no place in `turnOrder`. Its lifetime and its statuses count down on its
   * summoner's regular turns, it moves when its summoner moves, and it acts only by
   * echoing its summoner's spells — see `systems/combat/companion`.
   */
  companion?: boolean;
  /** A companion's Magic as a share of its summoner's current Magic (`SummonSpec.echoMagic`). */
  echoMagic?: number;
  /**
   * Latch: this unit's death burst has already gone off.
   *
   * Death reaches the store down three paths — a blow, a tick, a summon
   * expiring — and a burst that kills another burster re-enters the same
   * action. The same shape as `UNDYING_SPENT_EFFECT`, on the unit rather than
   * in `activeEffects` because a corpse's effect list is not read again.
   */
  deathBurstSpent?: boolean;
  /**
   * Turns remaining per skill id. Absent or zero means ready.
   *
   * Lives on the combat unit rather than the hero: cooldowns are per-fight
   * state, so they reset simply by not being carried into the next battle.
   */
  cooldowns?: Record<string, number>;
  stats: HeroStats;
  currentHp: number;
  currentMana: number;
  /**
   * `'chi'` when this unit's pool is chi (`data/classResource`): the same
   * `currentMana`, filled by the chi rules and labelled Chi. Absent means mana.
   */
  resource?: 'chi';
  position: HexCoord;
  /**
   * Transient presentation of the latest move; leaps travel in one airborne arc.
   * `swoop` is the Hawk's Dive: up, down onto `via` (the victim), then away to the
   * landing — one flight, drawn by `swoopPose`. `dash` is a swift slide (`dashPose`,
   * `DASH_STEP_MS` a hex) with dust kicked up behind it: a dash self-move, the
   * Burrowmother surfacing, the Herd-Khan's raid.
   */
  movement?: {
    mode: 'walk' | 'jump' | 'swoop' | 'dash';
    from: HexCoord;
    via?: HexCoord;
    /**
     * An ordinary move's route (`findMovePath`), both ends included: a walk goes
     * around the bodies and rubble in its way and is drawn that way. Absent, the
     * move is drawn along the straight hex line (a shove, a dash).
     */
    path?: HexCoord[];
    /** Knife Dance's landings, with a throw pause after each dash. */
    dance?: { stops: HexCoord[]; delayMs: number };
    /**
     * A shove drawn on the blow's clock rather than at once: the body is held where
     * it stood for this many milliseconds, then thrown back along the line (Living
     * Stone's eruption, a wave's crest). With mode `dash` it is held, then slid: a
     * body hauled on a hook's rope once the rope is reeled (`hookReelMs`).
     * Presentation only; the rules have already moved it.
     */
    shoveDelayMs?: number;
  };
  /**
   * Blood Howl's extra turns for this unit: `howlQueued` earned and not yet taken,
   * `howlGranted` already taken, both since its last regular turn began. Their sum
   * never passes `BLOOD_HOWL_TURN_CAP`; the next regular turn clears both.
   */
  howlQueued?: number;
  howlGranted?: number;
  /** The Apex spells already used in the current Apex shape (one use each). */
  apexSpent?: string[];
  /** Set by `nextTurn` when the Apex shape ran out, until the next turn start draws it. */
  apexReverted?: boolean;
  skills: HeroSkill[];
  hasMoved: boolean;
  voluntaryMoved?: boolean;
  previousTurnStationary?: boolean;
  /**
   * Mark and Move: after Mark Target the unit may move again this turn, at most
   * this many hexes. Cleared by the move and when any turn begins.
   */
  repositionCap?: number;
  /** Escape Route has carried this unit away since its last regular turn began. */
  escapeRouteSpent?: boolean;
  /** Venom Transfer has passed a dose on since this unit's last regular turn began. */
  venomTransferSpent?: boolean;
  /**
   * The Mantis's Reaping Momentum: the enemy its last Twin Reap was aimed at, and
   * the stacks that reap carried. Written only by Twin Reap, so other skills between
   * reaps keep it; a reap on anyone else starts it over (`systems/combat/mantis`).
   * Combat-only, like everything on the unit.
   */
  reapPrey?: { targetId: string; stacks: number };
  /**
   * Bonus turns a Mantis capstone queued, taken one at a time straight after the
   * turn that earned them with the order unmoved (`combatStore.nextTurn`): Threefold
   * Scythe's two stages, or the turn a killing Mantis Execution grants. Bonus turns
   * in every other respect — nothing ticks and nothing regenerates.
   */
  mantisTurns?: MantisTurn[];
  /** The Threefold Scythe stage the turn being taken is locked to: that stage or a move, nothing else. */
  scytheStage?: 2 | 3;
  /**
   * Shadow Echo's post-action window: the action is spent and the turn waits
   * for a return to the echo or End Turn, with no Move. Cleared when any turn begins.
   */
  echoHold?: boolean;
  hasActed: boolean;
  /**
   * The hex this unit began its current turn on, written when the turn starts.
   *
   * `hasMoved` only records a *walk*; a dash, a blink or Intercept's dash moves
   * the unit without setting it, because setting it would also forbid the walk a
   * free-action dash leaves open. Set Stance's "ended its turn without moving"
   * is therefore read as `!hasMoved` **and** still standing here. Absent on a
   * unit whose turn never began through the store (a fixture), which falls back
   * to `hasMoved` alone.
   */
  turnStartPos?: HexCoord;
  /**
   * Cannot be targeted until the start of this unit's next turn.
   *
   * Set by `disengage`. Cleared in `beginTurn` rather than by a duration,
   * because "one turn of safety" means until you act again — a duration would
   * tick down on the *caster's* schedule and expire early against a fast enemy.
   */
  untargetable?: boolean;
  /**
   * Rubble Recovery's allowance: the allies this Stoneshaper has already healed
   * for a broken Barrier since its own last regular turn began. Cleared at that
   * turn's start, so each recipient is healed at most once per Stoneshaper turn.
   */
  rubbleRecovered?: string[];
  /**
   * Stone's Answer's allowance, Rubble Recovery's in shape: the protected allies
   * this Stoneshaper has already answered for since its own last regular turn began.
   */
  stonesAnswered?: string[];
  /**
   * Second Nature's steps: the regular turns begun in the shape worn now. Counted in
   * `turnStart.beginRegularTurn` and zeroed by `setWildForm`, so a carried opening
   * shape starts at none. Only a hero holding the node counts.
   */
  shapeTurns?: number;
  /**
   * Multiplier on max HP from the shape currently worn. Wildshape only.
   *
   * Kept off `formStats` on purpose: `applyStatMultipliers` is shared with boss
   * phases, whose triggers *are* HP thresholds, so a max-HP multiplier reachable
   * from there would re-fire the transition that set it. Written only by
   * `setWildForm`, read only through `combatMaxHp`.
   */
  formVigor?: number;
  /**
   * Y-axis rotation in radians — the drawn turn of the model, updated by moveUnit
   * and setFacing in combatStore. The rule reads `facing`, not this.
   */
  facingAngle: number;
  /**
   * The hex direction this unit faces, which decides the side and back hexes a
   * flank is struck from (`systems/combat/facing`). Set toward the enemy side at
   * deployment, to the last step of a move, toward the target of an attack or
   * targeted skill and toward the attacker of a Reaction answer; forced movement
   * leaves it. Absent on a unit with no front at all — an objective — which is
   * never flanked.
   */
  facing?: HexDirection;
  activeEffects: ActiveEffect[];
  /** Always-on abilities, from an enemy template or a hero's mastery tree. */
  passives?: PassiveId[];
  /**
   * How far up its node each of those passives was bought.
   *
   * Absent for an enemy, whose passives come off a template and have no tree
   * behind them — `passiveRank` answers level 2 / scale 1 for a missing entry,
   * which is the authored value, so a template passive is unaffected by the
   * mechanic existing. Heroes get it from `masteryPassiveRanks` when the unit is
   * built, beside `passives` itself: the two are one fact read twice, and a
   * passive present in one and missing from the other is the bug this pairing
   * exists to prevent.
   */
  passiveRanks?: Partial<Record<PassiveId, PassiveRank>>;
  /** The hero's chosen path, so the arena can show the right silhouette. */
  masteryPath?: MasteryId | null;
  /**
   * The hero's merged mastery modifiers.
   *
   * Range and lifesteal bonuses are baked into `skills` when the unit is built,
   * but `thornsMultiplier` cannot be: Thorns may be applied to this unit by
   * somebody else's skill, so the multiplier has to be readable at the moment
   * damage is reflected rather than at the moment the aura was created.
   */
  masteryModifiers?: MasteryModifier;
  /**
   * Wildshape: the beast currently worn, or null/undefined for the hero's own
   * shape. Combat-only — it is never written back to `partyStore`, so a fight
   * always starts on two legs.
   */
  wildForm?: WildFormId | null;
  /**
   * The hero's **whole** kit, form skills included, with mastery modifiers
   * already baked in — the list a shift draws on and a revert restores.
   *
   * **Written up front by `createPlayerUnits`, not stashed lazily on the first
   * shift**, and the difference was a dead mechanic rather than a tidiness
   * question. `skills` is `skillsForForm(null, …)`, which strips every
   * `formSkill` — so a `humanSkills ?? skills` fallback stashed the *filtered*
   * list, and all twelve tier-2 Wildshape skills could never reach the bar in
   * any shape. The unfiltered list has to survive somewhere for the shift to
   * have anything to find.
   *
   * Absent on enemies and summons, which have no tree and never shift.
   */
  humanSkills?: HeroSkill[];
  /**
   * How far up its node each Wildshape shape this hero owns was bought.
   *
   * `passiveRanks`' sibling, and populated beside it for the same reason: the
   * level is a fact about the hero's tree, `setWildForm` has only the unit, and
   * a store action re-deriving it from `partyStore` would be a cross-store read
   * inside a `set()`. Absent means the middle rung — the authored value — so a
   * unit with no tree behind it wears exactly the shape `WILD_FORMS` describes.
   */
  formRanks?: Partial<Record<WildFormId, number>>;
  /**
   * Flat stats the worn shape adds, on top of `formStats`' multipliers.
   *
   * Wildshape's magic conversion, and nothing else today — a boss phase has no
   * business owning one. **Never carries `maxHp`**: the pool a unit fights out
   * of is `combatMaxHp`, which reads `formVigor` and is what the victory
   * write-back divides by, so health added anywhere else is invisible to the bar
   * and laundered by a fight that ends mid-shift. See `wildshape.wornForm`.
   */
  formBonus?: Partial<HeroStats>;
  /**
   * Stat multipliers currently in force, from a Wildshape form or a boss phase.
   *
   * Written by whichever of the two put the unit into its current shape, and
   * read by `getCombatEffectiveStats` without caring which. Keeping the numbers
   * on the unit rather than re-deriving them from `wildForm` is what lets a boss
   * phase use the same machinery without owning a form id.
   */
  formStats?: Partial<Record<keyof HeroStats, number>>;
  /**
   * Which phase a multi-phase boss is in, counting from 0.
   *
   * **Monotonic.** It only ever increases, which is what stops a lifesteal heal
   * walking a boss backwards and stops a threshold firing twice — including when
   * one blow crosses two of them at once.
   */
  bossPhase?: number;
  /**
   * Hard HP ceiling, set on entering a boss phase to that phase's own entry
   * threshold.
   *
   * Without it a boss with heavy lifesteal can sit at 60% in its most dangerous
   * phase forever and every point of damage already dealt counts for nothing.
   * With it the health bar is a ratchet: sustain matters *within* the band, and
   * can never undo work.
   */
  hpCeiling?: number;
  /** Present on an attackable arena objective, absent on every combatant. */
  objective?: ObjectiveSpec;
  /**
   * The bookkeeping a scripted boss keeps between its turns — see
   * `systems/combat/bossScript`. Only scripted bosses carry one.
   */
  bossScript?: BossScriptState | LegionScriptState | LessonScriptState | KairenScriptState;
  /**
   * The Seal tier this boss is fought at (1 is the first): Kairen's Storm Seal, whose
   * tier picks his twist (`kairenRules.tierOf`), and Aethelred's castle Seal, which his
   * standards' backlash falls with (`objectiveBoard.placementBacklash`) and his twists read
   * (`bossScript.aethelredTwist`). Set when the
   * encounter is built and carried in its snapshot, so a resumed fight keeps it.
   */
  challengeTier?: number;
  /**
   * This hero is acting for the other side for the length of this turn (the Dark
   * Mage's Mind Control). `isPlayer` is flipped for the turn and handed back when
   * it ends, so every rule that asks who a unit fights for reads the truth, and
   * the flag is how the hand-back knows which units to restore.
   */
  seized?: boolean;
  /**
   * The rune circle this unit is bound to while the Rime Jarl's duel is on: the
   * partner, the fixed centre and radius, and how many of this unit's regular
   * turns have ended since it was accepted (the acceptance turn included). Both
   * duelists carry one, so every pure rule — movement, targeting, an area's
   * reach — reads it off the roster without asking the store.
   */
  duel?: DuelBond;
  /** A challenge this hero has been issued and has not answered; see `DuelChallenge`. */
  challenge?: DuelChallenge;
}

/** What one duelist carries while the rune circle is up. */
export interface DuelBond {
  partnerId: string;
  /** The Jarl's hex at the challenge: fixed, whatever either duelist does after. */
  centre: HexCoord;
  radius: number;
  /** Regular turns this unit has ended since acceptance. Bonus turns never count. */
  turns: number;
}

/** A pending challenge: the rune circle that will close if the hero accepts. */
export interface DuelChallenge {
  jarlId: string;
  centre: HexCoord;
  radius: number;
}

/** A bonus turn a Mantis capstone queued (`CombatUnit.mantisTurns`). */
export type MantisTurn = { cause: 'scythe'; stage: 2 | 3 } | { cause: 'execution' };
