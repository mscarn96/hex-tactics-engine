import type { HeroClass } from './enums';
import type { SkillId } from './ids';
import type { PassiveId } from './skills';
import type { HeroStats } from './units';

// ============ MASTERY TREES ============

/**
 * What a path does for the party, at a glance: deals the damage, takes the hits,
 * or keeps the others standing. A path may name two, leading with the one it is
 * mostly for. A reading aid for choosing — no rule reads it.
 */
export type MasteryRole = "damage" | "tank" | "support";

/** Mastery paths, chosen at level 5. Data lives in data/masteryData.ts. */
export type MasteryId =
  // Champion
  | "bulwark" | "templar" | "berserker"
  // Arcanist
  | "pyromancer" | "hydromancer" | "stormcaller"
  // Druid
  | "lifewarden" | "stoneshaper" | "wildshape"
  // Hunter
  | "marksman" | "skirmisher" | "shadowblade"
  // Monk
  | "mantis" | "firefly" | "beetle";

/**
 * Things a node can change that are not "grant a skill", "grant a passive" or
 * "add a stat".
 *
 * Deliberately a short, closed list. Every entry here is a rule some other
 * system has to learn to read, so a tree wanting a genuinely new behaviour
 * should get a skill or a passive instead — those already have homes.
 */
export interface MasteryModifier {
  /** Extra turns on every Taunt this hero applies. */
  tauntDurationBonus?: number;
  /** Added to `skill.lifesteal` on every skill the hero uses, including those with none. */
  lifestealBonus?: number;
  /**
   * Multiplies the magnitude of Thorns auras the hero carries. Authored on a node as
   * the bonus (0.25 = +25%); `masteryModifiers` hands the hero the product, 1.25.
   */
  thornsMultiplier?: number;
  /** Extra range on every skill that already has some. */
  skillRangeBonus?: number;
  /** Extra radius on the hero's area skills. */
  aoeRadiusBonus?: number;
  /**
   * Fraction added to the magnitude of every Burn this hero applies.
   *
   * Burn is the one affliction that stacks, so amplifying it compounds with the
   * path's own plan rather than just being a bigger number — and it reaches
   * `MAX_BURN_MAGNITUDE` in fewer casts, which is what the detonators are for.
   */
  burnMagnitudeBonus?: number;
  /**
   * Fraction added to the magnitude of every Barrier this hero grants.
   *
   * Applied to the *resolved* value, after the flat/fraction split — so a flat
   * 30-point barrier and a fractional one authored against magic both scale,
   * rather than the bonus quietly reaching only one authoring style.
   */
  shieldPowerBonus?: number;
  /** Fraction added to the damage of skills that cover an area (`aoeRadius > 0`). */
  aoeDamageBonus?: number;
  /** Fraction added to the damage of skills that hit exactly one hex. */
  singleTargetDamageBonus?: number;
  /** Fraction added to every Barrier and heal *received* by this hero. */
  incomingSupportBonus?: number;
  /** Fraction added to this hero's own max HP, after flat bonuses. */
  maxHpPercentBonus?: number;
  /**
   * Fraction added to this hero's own Magic, after the flat sources and the gear
   * (playtest 2026-10-23: a flat few points of Magic was nothing late on).
   */
  magicPercentBonus?: number;
  /** Fraction added to damage against enemies below `EXECUTE_THRESHOLD`. */
  lowHpDamageBonus?: number;
  /** Fraction added to damage against enemies above half health. */
  highHpDamageBonus?: number;
  /** Fraction added to damage against a target this hero has Marked. */
  markedDamageBonus?: number;
  /** Fraction added to the magnitude of every heal-over-time this hero applies. */
  regenMagnitudeBonus?: number;
  /** Mana restored to an ally alongside any healing this hero lands on them. */
  healRestoresMana?: number;
  /** Defence granted for one turn to anyone this hero heals. */
  healGrantsDefense?: number;
  /** Fraction added to the poison burst that fires when a dose lands on a full pile. */
  poisonBurstBonus?: number;
  /** Fraction added to the magnitude of every Bleed this hero applies. */
  bleedMagnitudeBonus?: number;
  /**
   * Extra turns on every Bleed this hero applies, by skill or by passive (Deep
   * Cuts). Stamped where every status lands, `combatStore.applyEffect`, off the
   * Bleed's `sourceUnitId`, so a Bleed laid by a stage, a passive or a skill all
   * last alike.
   */
  bleedDurationBonus?: number;
  /** Fraction added to damage against a Bleeding target (Scent of Blood). */
  bleedingDamageBonus?: number;
  /**
   * Fraction added to one named skill's damage and healing, by skill id.
   *
   * The one non-scalar entry, and the only one no mastery *node* grants: it
   * comes off a legendary set piece, which rolls a skill from its own path when
   * it is acquired. It rides here rather than on a channel of its own because
   * `applyMasteryModifiers` is already the single place a hero's skill list is
   * baked — once, in `createPlayerUnits` — so the HUD, the targeting highlights
   * and the damage resolution all read the same number, which is the property
   * a second pipe would have to reproduce and eventually fail to.
   */
  skillPowerBonus?: Partial<Record<SkillId, number>>;

  // Advanced (level 21–25): Arcanist
  /**
   * Fraction added to `MAX_BURN_MAGNITUDE` for a Burn pile this hero adds to
   * (White Heat). Read in `combatStore.applyEffect` off the incoming Burn's
   * source, so the pile's ceiling is the hand that stacked it last.
   */
  burnCapBonus?: number;
  /**
   * Level 26, Brimming Over: the share of Burn this hero adds past the ceiling that
   * spills onto a nearby enemy. Read in `combatStore.applyEffect` off the Burn's source.
   */
  burnOverflowShare?: number;
  /**
   * Level 26, Forked Current: the second hop of a Shock jump, as a share of the first
   * (`statusEffects.shockSecondHop`). The owner's also forks its companion's echoes.
   */
  shockSecondHop?: number;
  /** Fraction added to the bonus a detonation pays (`detonationMultiplier`) on this hero's strikes. */
  detonationBonus?: number;
  /** Extra turns on every Freeze, and every boss's Brittle mark, this hero's Chill makes. */
  freezeDurationBonus?: number;
  /** Fraction added to damage against a Chilled, Frozen or Brittle target. */
  chilledDamageBonus?: number;
  /** Fraction added to damage against a Shocked target. */
  shockedDamageBonus?: number;
  /** Extra share of `SHOCK_CHAIN_FRACTION` on every Shock jump this hero's spells set off. */
  shockChainBonus?: number;

  // Advanced (level 21–25): Druid
  /**
   * Fraction of a heal's overflow — what it was worth beyond the HP it put back —
   * that becomes a Barrier on the mended unit (Overflowing Grace).
   */
  overhealBarrier?: number;
  /** Extra turns on every Root this hero applies (Deep Grip). */
  rootDurationBonus?: number;
  /** Fraction added to damage against a Rooted or Stunned target. */
  pinnedDamageBonus?: number;
  /** Hunter, level 26 (Buried Steel): blades past `BLADES_CAP` this Skirmisher can leave in one enemy. */
  bladesCapBonus?: number;
  /** Fraction added to the vigor (the pool multiplier) of whichever shape this hero wears. */
  formVigorBonus?: number;
  /** Fraction added to the damage of the skills a shape fights with (`formSkill`). */
  formSkillDamageBonus?: number;
  // Advanced (level 26): Druid
  /**
   * Last Bloom: a Regen this hero laid that runs out on a living ally heals once
   * more, for this multiple of its tick. Read off the effect's source in `effectTick`.
   */
  hotBloomShare?: number;
  /**
   * Second Nature: Attack and both defences per `CombatUnit.shapeTurns` step, as a
   * fraction of the worn shape's own. Read in `getCombatEffectiveStats`.
   */
  shapeSettledBonus?: number;

  // Advanced (level 26): Champion
  /** Dropped Guard: stamped on every Taunt this hero lands; the enemy takes this much more from every direct hit. */
  tauntedExposure?: number;
  /** Carrying Word: the next most wounded ally also gets this share of `skill.allyHeal`'s heal. */
  allyHealSpill?: number;
  /** Bottomless Thirst: Bloodthirst's bonus at no health left, sloping up with the share of health missing. */
  thirstMissingBonus?: number;

  // Worn set pieces (`systems/progression/setBonuses.ts`)
  /** Extra jumps on every chain skill the hero casts. */
  chainJumpBonus?: number;
  /** Extra charges the hero's Carapace holds. */
  carapaceChargeBonus?: number;
}

/**
 * Tier 1 is five feeder nodes, tier 2 is four, tier 3 is three capstones, and
 * tier 4 is the path's two or three **advanced** nodes.
 *
 * Tier 4 is not a fourth pyramid row. Advanced nodes open by hero level, row by
 * row (`BALANCE.MASTERY_ROW_LEVELS`), behind whichever capstone the hero took,
 * draw on a tab of their own, and name their prerequisites in `requires`: a
 * derived parent pair would be two capstones, which no hero can hold.
 */
export type MasteryTier = 1 | 2 | 3 | 4;

/** The three tiers that make up the pyramid; tier 4 stands outside it. */
export type PyramidTier = 1 | 2 | 3;

/** The advanced tier: nodes past the capstone, open from level 21 up, row by row. */
export const ADVANCED_TIER = 4;

/**
 * Levels every node holds unless it names its own `maxLevel`.
 *
 * `LEVEL_SCALE` is what a level is worth, and the authored number is the middle
 * one — so the whole roster of numbers stayed exactly where it was when levels
 * were introduced, and level 1 became a discount rather than every node needing
 * a new value.
 */
export const NODE_MAX_LEVEL = 3;
export const LEVEL_SCALE = [0.75, 1, 1.25] as const;

/**
 * How many nodes each tier holds in the **standard** pyramid.
 *
 * Eleven of the twelve paths are this shape. Wildshape is not — see
 * `MasteryPath.tierWidths` — so anything walking every path has to read the
 * path rather than this constant.
 */
export const MASTERY_TIER_WIDTH: Record<PyramidTier, number> = { 1: 5, 2: 4, 3: 3 };

export interface MasteryNode {
  id: string;
  /**
   * Legacy display words, for a tree whose text is not in the catalogs yet.
   * Read through `masteryNodeName` / `masteryNodeDescription`
   * (`data/display/masteryText.ts`), never directly.
   */
  name?: string;
  description?: string;
  /** 1–4. Tier 3 nodes are the capstones; tier 4 the advanced nodes past them. */
  tier: MasteryTier;
  /**
   * Position within its tier, left to right, starting at 0.
   *
   * In the standard pyramid prerequisites are **derived from this**, not
   * authored: a node requires both nodes above it, at `column` and `column + 1`.
   * That is what keeps a twelve-path tree from needing a hand-written edge table
   * nobody would maintain. A node carrying `requires` opts out of the derivation
   * and `column` becomes ordering only.
   */
  column: number;
  cost: number;
  /**
   * How many levels this node holds. Defaults to `NODE_MAX_LEVEL`.
   *
   * Every authored number is the **level-2** value: level 1 is `LEVEL_SCALE[0]`
   * of it and level 3 is `LEVEL_SCALE[2]`, so retuning a node moves all three
   * rungs together and the shipped numbers stayed put when levels arrived.
   *
   * `1` is not an unfilled field, it is a statement — the things that cannot
   * hold three levels are the binary immunities and the integer steps (+1 range,
   * +1 radius, +1 taunt turn), and those are exactly the nodes each path's two
   * side trees start with.
   */
  maxLevel?: number;
  grantsSkill?: SkillId;
  grantsPassive?: PassiveId;
  /** Flat stat additions, applied before item modifiers — see D3. */
  statBonus?: Partial<HeroStats>;
  modifier?: MasteryModifier;

  /**
   * Explicit prerequisites, replacing the derived pyramid for this node.
   *
   * Only Wildshape uses it, because only Wildshape is a set of exclusive
   * branches rather than a converging grid — a Bear node is fed by Bear Form
   * and by nothing else, which no arrangement of columns can express.
   */
  requires?: readonly string[];
  /**
   * How many of `requires` are enough. Defaults to all of them.
   *
   * Apex is the only "any N of these" node in the game: it lists every branch
   * node in the path and asks for two, which reads as "go two deep into your
   * shape" without naming which two.
   */
  requiresCount?: number;
  /**
   * Overrides the "Feeds from A + B" line when listing every prerequisite would
   * be noise: an id into `masteryCommon.requires.*` (`'firstCapstone'`,
   * `'advanced'`), shown through `masteryRequiresLabel`.
   */
  requiresLabel?: string;
  /**
   * Nodes carrying the same tag in the same path lock each other out forever.
   *
   * A tag rather than a list of ids, so exclusivity cannot be declared on one
   * side and forgotten on the other.
   */
  exclusiveGroup?: string;
  /**
   * Which of the path's two side trees this node belongs to, if either.
   *
   * A side tree is not a tier. It hangs off the main tree's capstones rather
   * than off a column, so it is excluded from every pyramid invariant — the
   * 5/4/3 widths, the derived prerequisites, the column runs. `tier` still says
   * which **row** it draws on (1 for the starter, 2 for its two children),
   * which is what keeps the layout one grid instead of two.
   *
   * The tag is what makes "you take one side tree" expressible at all: both
   * starters carry `exclusiveGroup: 'side'`, and everything under a starter
   * reaches it through `requires`.
   */
  sideTree?: 'a' | 'b';
  /**
   * Which advanced row a tier-4 node stands in, from 1: its index into
   * `BALANCE.MASTERY_ROW_LEVELS`, plus one. Absent means row 1, which is every
   * level-21 node. Means nothing on the other tiers.
   */
  masteryRow?: 1 | 2 | 3 | 4;
  /**
   * Horizontal position in cells, for drawing only.
   *
   * Defaults to the pyramid's staggered slot. A branching tree needs its parent
   * to sit over its own children rather than in a shared centred row.
   */
  x?: number;
}

export interface MasteryPath {
  id: MasteryId;
  /** Legacy display name, for a path not yet in the catalogs; read through `pathName`. */
  name?: string;
  /** What the path is for in a party, main role first. See `MasteryRole`. */
  roles: readonly MasteryRole[];
  heroClass: HeroClass;
  /**
   * Legacy tagline, for a path not yet in the catalogs. The line shown on the
   * irreversible choice screen is `path.<id>.description`, read through
   * `masteryPathTagline`.
   */
  tagline?: string;
  /**
   * Granted free when the path is chosen at level 5, outside the point economy.
   *
   * `null` for a path that hands over a **point** instead — see `bonusPoints`.
   * A signature is a skill the path decides for you; Wildshape's first decision
   * is which animal you are, and choosing it for the player would remove the
   * only thing that tier exists to ask.
   */
  signatureSkill: SkillId | null;
  /** Extra points granted on choosing the path, in place of a signature skill. */
  bonusPoints?: number;
  /** Nodes per tier, when the path is not the standard 5 → 4 → 3 pyramid. */
  tierWidths?: readonly number[];
  nodes: MasteryNode[];
}
