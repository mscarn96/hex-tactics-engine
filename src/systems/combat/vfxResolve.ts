import {
  AuraType, HeroSkill, Projectile, SkillTargetType, StrikeDelivery, VfxAftermath, VfxKind, VfxPrelude, VfxSpec,
} from '@/models/types';
import { jumpLeadMs, selfMoveLeadMs, swoopLeadMs } from '@/data/display/combatMotion';
import { strikeDelivery, Wielder } from '@/systems/combat/soundIntents';
import { PROJECTILE, THROWN, THROWN_BY_SKILL } from '@/data/display/effectParts';
import { MARKSMAN_YELLOW } from '@/data/display/marksmanColors';
import type { HexCoord } from '@/models/types';

const DEFAULT_COLOR = '#ff4444';
/** A plain weapon blow, drawn in the steel of the swing rather than a colour of its own. */
export const PLAIN_STRIKE_COLOR = '#e4e6ea';
/** The same blow from a blessed weapon (the Templar's Righteous Fury): the gold the weapon glows. */
export const BLESSED_STRIKE_COLOR = '#ffdd44';
/** The same blow from blades wet with Hemlock (`Envenomed`): the coating's green. */
export const ENVENOMED_STRIKE_COLOR = '#88cc44';

/**
 * An ordinary attack: free, single-target, physical, with nothing riding on it — a hero's
 * Basic Attack, an enemy's slash, bite or arrow. These are drawn white-grey: colour on the
 * board is kept for what is special, and a red swing on every turn spent it. Magic missiles
 * keep theirs (the colour is their school, and how they sound), as does anything that applies
 * a status, drinks, prepares or marks, a skill whose colour is its identity (`vfxThemed`) and
 * the Marksman's yellow, which is the path's.
 */
export function isPlainStrike(skill: HeroSkill): boolean {
  return (skill.damage ?? 0) > 0 && skill.manaCost === 0 && !skill.cooldown
    && skill.targetType === SkillTargetType.Single && !skill.aoeRadius
    && skill.scaling !== 'magic' && skill.damageType !== 'magic' && skill.vfxKind !== 'bolt'
    && !skill.appliesEffect && !skill.lifesteal && !skill.prepares && !skill.marks && !skill.deathMark
    && !skill.vfxThemed && skill.vfxColor !== MARKSMAN_YELLOW;
}

/** The colour a strike is drawn in, by who makes it: a plain blow is neutral, gold from a blessed weapon, green from coated blades. */
export function strikeColor(skill: HeroSkill, caster?: Pick<Wielder, 'activeEffects'>): string {
  if (!isPlainStrike(skill)) return resolveVfxColor(skill);
  const wears = (type: AuraType) => caster?.activeEffects?.some((e) => e.type === type) ?? false;
  if (wears(AuraType.BlessedWeapon)) return BLESSED_STRIKE_COLOR;
  if (wears(AuraType.Envenomed)) return ENVENOMED_STRIKE_COLOR;
  return PLAIN_STRIKE_COLOR;
}

/**
 * Picks the visual shape for a skill. Damaging melee dashes use a landed slash;
 * otherwise an explicit `vfxKind` wins. The
 * derivation below exists so skills that predate the VFX system — or new ones
 * where the default reads fine — still get something sensible.
 *
 * Lives in systems/ rather than the vfx/ component folder because enemyAI needs
 * it too, and systems must not import from components.
 */
export function resolveVfxKind(skill: HeroSkill): VfxKind {
  // Range on a gap-closer is travel reach, not projectile reach. The shield wave is
  // the one shape drawn from where the dash lands (Shield Avalanche's cone), so it
  // keeps its own picture.
  // Antler Charge's burst is drawn round its landing in the same way.
  if (skill.damage && skill.selfMove?.kind === 'dash' && skill.vfxKind !== 'shieldwave' && !skill.landingBurst) return 'slash';
  if (skill.vfxKind) return skill.vfxKind;

  // Pure support skills — nothing is struck, so lead with the heal/status read
  if (skill.healing && !skill.damage) return 'bloom';
  if (!skill.healing && !skill.damage) return 'buff';

  switch (skill.targetType) {
    case SkillTargetType.Arc:
      return 'arc';
    case SkillTargetType.Ring:
      // range 0 = centred on the caster (Whirlwind, Smash); ranged = called down (Meteor)
      return skill.range === 0 ? 'nova' : 'meteor';
    case SkillTargetType.Self:
      return 'nova';
    case SkillTargetType.Line:
    // Deliberately *not* 'lightning'. A chain is a route through bodies, which
    // says nothing about what is travelling it — the same shape would serve a
    // ricocheting knife. Skills that are electricity say so by name, the way
    // weather does.
    case SkillTargetType.Chain:
      return 'bolt';
    case SkillTargetType.Single:
    default:
      return skill.range <= 1 ? 'slash' : 'bolt';
  }
}

export function resolveVfxColor(skill: HeroSkill): string {
  return skill.vfxColor ?? DEFAULT_COLOR;
}

// Pacing constants live here rather than in BALANCE: they tune a picture, not a
// rule — nothing about the fight changes when they move.
const SCALE_LARGE = 1.4;
const SCALE_HUGE = 1.7;
const HUGE_AOE = 3;
const LARGE_AOE = 2;
const HUGE_MANA = 30;
const HUGE_COOLDOWN = 4;

/**
 * How long a skill's effect lingers, relative to the stock play time.
 *
 * A whole-arena capstone that plays in the same half-second as a basic attack
 * reads as a misfire — the picture is over before the numbers land. Ultimates
 * qualify by cost as well as by footprint, because a single-target finisher
 * priced like a capstone deserves the same weight on screen. The tiers overlap,
 * so the largest applicable one wins.
 */
export function resolveVfxScale(skill: HeroSkill): number {
  // Ancestral Hunt's spirits strike on a fixed beat the resolver also floats by
  if (skill.spiritHunt || skill.knifeDance) return 1.0;
  const aoe = skill.aoeRadius ?? 0;
  // A reach of every enemy is the largest footprint there is, whatever it costs —
  // Primal Wrath is free and cooldown-free (its limit is one use per Apex shape)
  if (skill.arenaWide || aoe >= HUGE_AOE || skill.manaCost >= HUGE_MANA || (skill.cooldown ?? 0) >= HUGE_COOLDOWN) {
    return SCALE_HUGE;
  }
  // The Apex's three spells are each a once-per-shape capstone, priced in charges
  if (aoe >= LARGE_AOE || skill.formSkill === 'apex') return SCALE_LARGE;
  return 1.0;
}

/**
 * How long a prelude holds the main shape back, at stock speed.
 *
 * Long enough to be seen as its own beat on a phone — a tell shorter than a
 * blink is not a tell — and short enough that a capstone pressed three times a
 * fight does not become a wait. It grows with `resolveVfxScale` — a whole-arena
 * capstone gathers longer than a single shot is lined up — but by the square
 * root of it: Burning Out's ignition already holds its numbers two seconds, and
 * a tell that grew as fast as the shape would add two-thirds of a second more.
 * Here rather than beside the other clocks in `vfx/impact.ts` because the
 * resolvers time the launch sound by it, and systems may not import components.
 */
export const PRELUDE_MS = 380;

/** The tell a skill opens with, if it has one. */
export function resolveVfxPrelude(skill: HeroSkill): VfxPrelude | undefined {
  return skill.vfxPrelude;
}

/** The ground a skill leaves behind it, if anything. */
export function resolveVfxAftermath(skill: HeroSkill): VfxAftermath | undefined {
  return skill.vfxAftermath;
}

/** How long this skill's prelude holds everything after it, scaled like its shape. 0 without one. */
export function preludeMs(skill: HeroSkill): number {
  return resolveVfxPrelude(skill) ? PRELUDE_MS * Math.sqrt(resolveVfxScale(skill)) : 0;
}

/** The same, read off a spec — what the arena has once the skill is gone. */
export function specPreludeMs(spec: Pick<VfxSpec, 'prelude' | 'durationScale'>): number {
  return spec.prelude ? PRELUDE_MS * Math.sqrt(spec.durationScale ?? 1) : 0;
}

/**
 * Everything about a skill's picture that its spec carries, in one place.
 *
 * Every resolver that draws a skill spreads this rather than asking for the
 * shape, the colour and the speed one at a time — three sites restating three
 * calls was how a fourth field would have reached one path and not the other,
 * and a hero the Dark Mage is holding casts through the AI's path with the
 * player's own capstones.
 */
export function skillVfx(
  skill: HeroSkill,
  caster: Wielder,
  from?: HexCoord,
  landing?: HexCoord,
): Pick<VfxSpec, 'kind' | 'color' | 'delivery' | 'projectile' | 'durationScale' | 'prelude' | 'aftermath' | 'delayMs' | 'drain'> {
  const prelude = resolveVfxPrelude(skill);
  const aftermath = resolveVfxAftermath(skill);
  const lead = jumpLeadMs(skill) || swoopLeadMs(skill) || (from && landing ? selfMoveLeadMs(skill, from, landing) : 0);
  const delivery = strikeDelivery(skill, caster);
  const kind = physicalShape(skill, delivery);
  // A quarrel flies faster than an arrow, and a thrown bolt as fast as the bolt it replaces.
  // Numbers time off the skill's own shape and speed, which is never faster than these, so they
  // still land after the thing does.
  const derivedBolt = resolveVfxKind(skill) === 'bolt';
  const speed = kind === 'shot' && delivery === 'crossbow' ? PROJECTILE.boltSpeed
    : kind === 'throw' && derivedBolt ? THROWN.fromBoltSpeed : 1;
  const projectile = kind === 'throw' ? projectileOf(skill, caster) : undefined;
  return {
    kind,
    color: strikeColor(skill, caster),
    delivery,
    ...(projectile ? { projectile } : {}),
    // A blow that drinks draws the blood it took flowing back (Bloodthirst)
    ...((skill.lifesteal ?? 0) > 0 ? { drain: true } : {}),
    durationScale: resolveVfxScale(skill) * speed,
    ...(lead ? { delayMs: lead } : {}),
    ...(prelude ? { prelude } : {}),
    ...(aftermath ? { aftermath } : {}),
  };
}

/**
 * An arrow is not a spell: a shape the derivation guessed as a glowing `bolt`, loosed from a bow or
 * a crossbow, is drawn as the shaft it is (`shot`). An authored shape stands — a Shardcaster's ice
 * lance is ice whatever it is fired from.
 */
function physicalShape(skill: HeroSkill, delivery: StrikeDelivery): VfxKind {
  const kind = resolveVfxKind(skill);
  if (skill.vfxKind || kind !== 'bolt') return kind;
  if (delivery === 'bow' || delivery === 'crossbow') return 'shot';
  // ...and a thrown knife or javelin is not one either: it flies as what it is
  return delivery === 'thrown' ? 'throw' : kind;
}

/** What a throw throws: the skill's own, a named skill's, a thrower's spear, else a stone. */
function projectileOf(skill: HeroSkill, caster: Wielder): Projectile {
  return skill.projectile ?? THROWN_BY_SKILL[skill.id] ?? (caster.blow === 'reach' ? 'spear' : 'stone');
}

/**
 * When a skill's launch is heard, relative to the press.
 *
 * A spell's cast cue is a swell that rises as the caster begins, so it starts
 * with the prelude: the gathering *is* the beginning of the cast. A blow's
 * launch is the swing itself — the whoosh of a blade, a bowstring — and the
 * swing waits for the prelude, so its sound does too; a Whirlwind heard half a
 * second before it is seen to turn is heard as something else.
 */
export function launchLeadMs(skill: HeroSkill, delivery: StrikeDelivery): number {
  return jumpLeadMs(skill) + swoopLeadMs(skill) + (delivery === 'spell' ? 0 : preludeMs(skill));
}

/** The shapes that fly from the caster to the target: the projectiles. */
const PROJECTILE_KINDS = new Set<VfxKind>(['bolt', 'shot', 'throw', 'ricochet', 'arrows', 'barrage', 'beam', 'cannon', 'hook']);

/** Blows whose projectile is a thing rather than a spell: an arrow, a quarrel, a thrown weapon, a spit or a web. */
const PHYSICAL_DELIVERIES = new Set<StrikeDelivery>(['bow', 'crossbow', 'thrown', 'natural']);
/** Shapes that are a thing whatever carries them: a cannonball, a grapnel on its rope. */
const PHYSICAL_KINDS = new Set<VfxKind>(['cannon', 'hook']);

/**
 * **Whether a projectile is physical or magic** — the split the effects draw by: a physical one
 * flies as itself with debris (`shot`, `throw`), a magic one glows (`bolt`, `beam`). Read off the
 * shape and the blow (`VfxSpec.kind` and `.delivery`); undefined for anything that does not fly.
 * `projectileFamily.test.ts` pins it over the whole skill corpus, and the lab shows it.
 */
export function projectileFamily(kind: VfxKind, delivery: StrikeDelivery): 'physical' | 'magic' | undefined {
  if (!PROJECTILE_KINDS.has(kind)) return undefined;
  return PHYSICAL_KINDS.has(kind) || PHYSICAL_DELIVERIES.has(delivery) ? 'physical' : 'magic';
}
