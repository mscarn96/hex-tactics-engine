import { roll } from '@/systems/combat/dice';

import { rampartBlocksShot, rampartPair, RAMPART_KIND } from '@/systems/combat/ramparts';


import * as Crypto from '@/platform/uuid';

import { canAim } from '@/systems/combat/targetLegality';
import { struckBody } from '@/systems/combat/objectives';
import { barActionTargets } from '@/systems/combat/barActions';

import { CombatUnit, HeroSkill, SkillTargetType, HexCoord, AuraType, ArenaHazard } from '@/models/types';

import { hexDistance, getHexesInRange, getHexLine, hexKey } from '@/utils/hexUtils';

import { isRooted, isAreaSkill, grantsAura, skillVariantFor } from '@/systems/combat/statusEffects';


import { skillTargetKind } from '@/systems/combat/targetKind';
import { watchesWard } from '@/systems/combat/reactions';










import { duelBars, inDuelCircle } from '@/systems/combat/duelRules';

import { HEX_DIRS, arcHexes, arenaHexes, arenaWideHexes, beamHexes, inArena, solidKeys } from '@/systems/combat/arenaGeometry';
import { resolveSelfMove, selfMoveBlocked, selfMoveIsThePoint } from '@/systems/combat/forcedMovement';
import { findStageUnit, finishedStageUnit } from '@/systems/combat/unitLookup';



/**
 * The route a chaining skill takes: the aimed hex, then the nearest untouched
 * enemy within `chainRange` of the last one, and so on.
 *
 * Pure and deterministic — ties break by distance and then by coordinate, the
 * same rule `resolveSelfMove`'s dash follows, because the highlight pass, the
 * damage resolution and the AI's scoring all call this and a bolt that took a
 * different route in each of them would be three different skills.
 *
 * Whose side the chain jumps to is decided by the *aimed* unit rather than by
 * the caster, so the same function serves an enemy Stormcaller: a bolt that
 * started on a hero keeps leaping between heroes.
 */
function chainHexes(
  skill: HeroSkill,
  casterPos: HexCoord,
  targetPos: HexCoord,
  allUnits: CombatUnit[],
  hazards: ArenaHazard[] = [],
): HexCoord[] {
  const alive = allUnits.filter((u) => u.currentHp > 0);
  const first = alive.find((u) => u.position.q === targetPos.q && u.position.r === targetPos.r);
  // Aimed at empty ground: there is nothing to conduct through, and the hex
  // itself is still the honest answer for the range preview
  if (!first) return [targetPos];

  const reach = skill.chainRange ?? 2;
  const struck = [first];
  const seen = new Set([first.id]);

  for (let jump = 0; jump < (skill.chainJumps ?? 0); jump++) {
    const from = struck[struck.length - 1];
    const next = alive
      .filter((u) => !seen.has(u.id) && u.isPlayer === first.isPlayer)
      .filter((u) => hexDistance(from.position, u.position) <= reach)
      .filter((u) => !rampartBlocksShot(skill, from.position, u.position, allUnits, hazards))
      .filter((u) => inArena(u.position))
      .sort((a, b) => {
        const byDistance =
          hexDistance(from.position, a.position) - hexDistance(from.position, b.position);
        return byDistance !== 0
          ? byDistance
          : a.position.q - b.position.q || a.position.r - b.position.r;
      })[0];
    if (!next) break;
    seen.add(next.id);
    struck.push(next);
  }

  return struck.map((u) => u.position);
}


/** Whether an arena-wide skill also reaches the caster's own side (Bedrock Stand). */
const arenaWideWithAllies = (skill: HeroSkill): boolean => skillTargetKind(skill) === 'mixed';
/**
 * A self-centred ring that harms nobody: a Barrier or a heal round the caster
 * (Shell Wall), or a Bastion laid on the ground (Carapace Bastion). Nothing has
 * to be standing near for it to be worth the turn, so the caster's hex is offered
 * with no enemy in reach — the resolver never asked for one.
 */
const selfRingIsDefensive = (skill: HeroSkill): boolean =>
  !skill.damage && (!!skill.bastion || skillTargetKind(skill) === 'support');


/**
 * The enemies a random-strike skill (Skyfall) may pick from: every living opponent
 * of whoever stands at `casterPos` within the skill's `aoeRadius` of the aimed hex
 * (playtest 2026-10-17, PT-18: it used to be the whole arena), that can be
 * targeted at all — not an objective and not untargetable.
 */
export function randomStrikeCandidates(
  skill: Pick<HeroSkill, 'aoeRadius'>,
  casterPos: HexCoord,
  targetPos: HexCoord,
  allUnits: CombatUnit[],
): HexCoord[] {
  const caster = allUnits.find(
    (u) => u.currentHp > 0 && u.position.q === casterPos.q && u.position.r === casterPos.r,
  );
  const side = caster?.isPlayer ?? true;
  const radius = skill.aoeRadius ?? 0;
  return allUnits
    .filter((u) => u.currentHp > 0 && u.isPlayer !== side && !u.objective && !u.untargetable && inArena(u.position)
      && hexDistance(u.position, targetPos) <= radius)
    .map((u) => u.position);
}


/**
 * The hexes a random-strike skill actually strikes: up to `skill.randomEnemies`
 * **different** candidates, drawn without replacement, so one enemy is never struck
 * twice to fill the count and two enemies left means two strikes. Rolled once per
 * cast by the resolver; a companion's echo reuses the same set.
 */
export function pickRandomStrikes(
  skill: HeroSkill,
  casterPos: HexCoord,
  targetPos: HexCoord,
  allUnits: CombatUnit[],
  rng: () => number = roll,
): HexCoord[] {
  const pool = [...randomStrikeCandidates(skill, casterPos, targetPos, allUnits)];
  const picked: HexCoord[] = [];
  while (picked.length < (skill.randomEnemies ?? 0) && pool.length > 0) {
    const i = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
}


export function getSkillTargets(
  skill: HeroSkill,
  casterPos: HexCoord,
  targetPos: HexCoord,
  allUnits: CombatUnit[],
  /** The arena's hazards: a chain does not jump over solid ground. Omitted, nothing is solid. */
  hazards: ArenaHazard[] = [],
): HexCoord[] {
  if (skill.arenaWide) return arenaWideHexes(casterPos, allUnits, arenaWideWithAllies(skill));
  // Antler Charge: the burst is round where the dash landed, which is what both the
  // resolver and the highlight pass hand in as `casterPos` for a dash
  if (skill.landingBurst) return getHexesInRange(casterPos, skill.aoeRadius ?? 1).filter(inArena);
  // Every enemy it could pick in the aimed area: the resolver rolls the actual strikes from these
  if (skill.randomEnemies) return randomStrikeCandidates(skill, casterPos, targetPos, allUnits);
  switch (skill.targetType) {
    case SkillTargetType.Single:
      // Lay on Hands: the aimed ally and the caster, each once
      if (skill.healsCaster && (targetPos.q !== casterPos.q || targetPos.r !== casterPos.r)) {
        return [targetPos, casterPos];
      }
      return [targetPos];

    case SkillTargetType.Self:
      if (skill.aoeRadius) {
        return getHexesInRange(casterPos, skill.aoeRadius);
      }
      return [casterPos];

    case SkillTargetType.Ring:
      if (skill.range === 0) {
        // Centered on self
        return getHexesInRange(casterPos, skill.aoeRadius ?? 1);
      }
      return getHexesInRange(targetPos, skill.aoeRadius ?? 1);

    case SkillTargetType.Line:
      return skill.beam ? beamHexes(casterPos, targetPos) : getHexLine(casterPos, targetPos);

    case SkillTargetType.Chain:
      return chainHexes(skill, casterPos, targetPos, allUnits, hazards);

    case SkillTargetType.Arc:
      return arcHexes(skill, casterPos, targetPos);

    case SkillTargetType.Cross:
      return crossHexes(skill, targetPos);

    default:
      return [targetPos];
  }
}


/**
 * The aimed hex and two full lines crossing on it.
 *
 * The arms run along `HEX_DIRS[0]` and `HEX_DIRS[2]` — 120° apart, so with
 * their opposites they make four arms and leave two gaps. Fixed rather than
 * aimed because the figure is symmetric under a 60° turn about its own centre:
 * offering the player a rotation would be a control that changes nothing about
 * which hexes are covered.
 *
 * Deduplicated through a key set because the centre belongs to both arms, and a
 * hex listed twice is a target struck twice — the area loop does not check.
 */
function crossHexes(skill: HeroSkill, targetPos: HexCoord): HexCoord[] {
  const reach = skill.aoeRadius ?? 1;
  const out: HexCoord[] = [targetPos];
  const seen = new Set([hexKey(targetPos)]);

  for (const axis of [HEX_DIRS[0], HEX_DIRS[2]]) {
    for (const sign of [1, -1]) {
      for (let step = 1; step <= reach; step++) {
        const hex = { q: targetPos.q + axis.q * step * sign, r: targetPos.r + axis.r * step * sign };
        const key = hexKey(hex);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(hex);
      }
    }
  }
  return out;
}


/**
 * All hexes within the skill's range — no unit-presence check.
 * Used to render the dim "range zone" overlay behind valid-target highlights.
 */
export function getSkillRangeHexes(skill: HeroSkill, caster: CombatUnit): HexCoord[] {
  // Arena-wide: the reach is the playable arena itself, and nothing outside it
  if (skill.arenaWide) {
    return arenaHexes().filter((h) => !(h.q === caster.position.q && h.r === caster.position.r));
  }
  if (skill.targetType === SkillTargetType.Self) {
    // Show the full AoE area when the skill has a radius (e.g. Divine Light)
    if (skill.aoeRadius) return getHexesInRange(caster.position, skill.aoeRadius).filter(inArena);
    return [caster.position];
  }
  // Self-centered Ring (range=0, e.g. Whirlwind): show the AoE area as the preview,
  // excluding the caster's own tile so the player can see what gets hit.
  if (skill.targetType === SkillTargetType.Ring && !skill.range) {
    return getHexesInRange(caster.position, skill.aoeRadius ?? 1).filter(
      (h) => !(h.q === caster.position.q && h.r === caster.position.r) && inArena(h)
    );
  }
  // A pure attack cannot be aimed at the caster; anything that mends, cleanses
  // or blesses can. This one line is why a lone Druid's Heal was dead weight —
  // the caster's own hex was filtered out of *every* ranged skill regardless of
  // what it did, and the game hands you a single hero to start with.
  //
  // The aura clause matters for the same reason: a skill whose whole payload is
  // a buff has no `healing` to give it away, so "shield an ally" quietly meant
  // "shield anyone but yourself".
  const selfIsValid = !!skill.healing || !!skill.cleanse || grantsAura(skill);

  return getHexesInRange(caster.position, skill.range || 0).filter((h) => {
    const isSelf = h.q === caster.position.q && h.r === caster.position.r;
    if (isSelf && !selfIsValid) return false;
    if (!inArena(h)) return false;
    return hexDistance(caster.position, h) <= skill.range;
  });
}


export function getValidSkillTargetHexes(
  skill: HeroSkill,
  caster: CombatUnit,
  allUnits: CombatUnit[],
  /** The arena's hazards: no self-move is offered a landing on solid rubble. Omitted, nothing is solid. */
  hazards: ArenaHazard[] = [],
): HexCoord[] {
  // A skill that is nothing but a way of arriving somewhere offers no hexes at
  // all while the caster is rooted. First, so no branch below can hand back a
  // hex the resolver would then refuse — which is the failure this pass exists
  // to prevent, and the reason the check is stated once rather than per branch.
  if (selfMoveIsThePoint(skill) && isRooted(caster)) return [];

  if (skill.targetType === SkillTargetType.Self) {
    return [caster.position];
  }

  // What a fight lends the bar (Pass the Heart) is aimed where its own rule says
  const lent = barActionTargets(caster, skill, allUnits);
  if (lent) return lent;

  // Marked Prey's release: the prey the mark names, wherever it stands now
  if (skill.mantisStage === 'release') {
    const aimAt = caster.activeEffects.find((e) => e.type === AuraType.MarkedPrey)?.aimAt;
    const prey = allUnits.find((u) => u.id === aimAt && u.currentHp > 0);
    return prey ? [prey.position] : [];
  }

  // Aimed Shot's release: the one unit it aimed at, while that unit is in reach
  if (skill.charge?.aimed && skill.releasing) {
    const aimAt = caster.activeEffects.find((e) => e.type === AuraType.Aiming)?.aimAt;
    const prey = allUnits.find((u) => u.id === aimAt && u.currentHp > 0);
    if (!prey) return [];
    const reach = new Set(getSkillRangeHexes(skill, caster).map(hexKey));
    return reach.has(hexKey(prey.position)) ? [prey.position] : [];
  }

  // Arena-wide: cast on the caster's own hex, while any enemy is standing anywhere
  if (skill.arenaWide) {
    // An arena-wide skill that also shields allies still needs an enemy to be worth casting
    return arenaWideHexes(caster.position, allUnits).length > 0 ? [caster.position] : [];
  }

  // Self-centered Ring (range=0, e.g. Whirlwind): the only click target is the
  // caster's own hex — but only show it when at least one enemy is in range.
  // A ring that only helps (Shell Wall, Carapace Bastion) is cast whenever: a
  // shield raised before the enemy closes is the point of it (PT-06)
  if (skill.targetType === SkillTargetType.Ring && !skill.range) {
    if (selfRingIsDefensive(skill)) return [caster.position];
    const aoeHexes = getHexesInRange(caster.position, skill.aoeRadius ?? 1);
    const hasEnemy = aoeHexes.some((h) =>
      allUnits.find(
        (u) => u.currentHp > 0 && !u.isPlayer &&
               u.position.q === h.q && u.position.r === h.r
      )
    );
    return hasEnemy ? [caster.position] : [];
  }

  // An attack may be aimed at the caster's own hex while a crystal of the other side rides on them:
  // the carrier strikes the Furnace Heart they hold (`objectives.struckBody`)
  const carrying = !!skill.damage && !skill.healing && struckBody(caster, caster, allUnits)?.id !== caster.id;
  const candidates = carrying ? [caster.position, ...getSkillRangeHexes(skill, caster)] : getSkillRangeHexes(skill, caster);

  // An aimed summon is ground-targeted, the way a blink is — except while the
  // caster has a stage-unit standing, when the only thing the button does is
  // build that one up, so its hex is the only thing worth offering.
  if (skill.summons?.placement === 'aimed') {
    // A finished construction locks the skill until it falls
    if (finishedStageUnit(skill.summons, caster, allUnits)) return [];
    const stageUnit = findStageUnit(skill.summons, caster, allUnits);
    if (stageUnit) {
      return hexDistance(caster.position, stageUnit.position) <= skill.range
        ? [stageUnit.position]
        : [];
    }
    return candidates.filter(
      (h) =>
        inArena(h) &&
        !allUnits.some((u) => u.currentHp > 0 && u.position.q === h.q && u.position.r === h.r),
    );
  }

  // Objectives placed on an aimed hex are ground-targeted the same way
  if (skill.places?.kind === RAMPART_KIND) return candidates.filter(h => rampartPair(caster, skill, h, allUnits, inArena).length === 2);
  if (skill.places?.placement === 'aimed') {
    return candidates.filter(
      (h) =>
        inArena(h) &&
        !allUnits.some((u) => u.currentHp > 0 && u.position.q === h.q && u.position.r === h.r),
    );
  }

  // A skill that names its own destination is aimed at ground, so every free
  // reachable hex is a target — filtering to hexes holding a unit would leave
  // nothing to click. Both kinds that take an exact coordinate qualify: `free`
  // is the whole skill, and `blink` is the approach to one.
  if (skill.selfMove?.kind === 'free' || skill.selfMove?.kind === 'blink') {
    const solid = solidKeys(hazards);
    const reach = skill.selfMove.range;
    return candidates.filter((h) => {
      if (solid.has(hexKey(h))) return false;
      // The move's own limits, which `resolveSelfMove` refuses on: its reach
      // (not the skill's `range`) and a Jarl's duel circle. Not the resolver
      // itself, which refuses a Rooted caster that Slip the Net is about to free
      if (hexDistance(caster.position, h) > reach || !inDuelCircle(caster, h)) return false;
      const occupant = allUnits.find(
        (u) => u.currentHp > 0 && u.position.q === h.q && u.position.r === h.r,
      );
      if (!occupant) return true;

      // An ally is a legal aim for a move that dashes to allies (Reposition), as
      // long as there is a free hex beside them within reach.
      if (skill.allyShare && occupant.id !== caster.id && occupant.isPlayer === caster.isPlayer) {
        return resolveSelfMove(caster, skill, h, allUnits, hazards) !== null;
      }

      // ...except when the skill has another half for exactly this case. The
      // filter above used to be unconditional, which made every `occupiedVariant`
      // on a blink unreachable by construction: Shadowstep's strike could not be
      // clicked, so the Shadowblade's signature was an escape and nothing else —
      // and the poison it applies is what tier 3's Assassinate is gated on.
      if (!skill.occupiedVariant) return false;
      const variant = skillVariantFor(skill, true);
      if (!canAim(caster, occupant, variant)) return false;
      // The variant closes the distance with a `dash`, which needs a free hex
      // beside the target. Surrounded on all six sides, there is no way in — and
      // the board says so, rather than the player clicking and reading a toast.
      //
      // Asked through `selfMoveBlocked` rather than `resolveSelfMove` directly,
      // because a `null` from the resolver means two *opposite* things and only
      // one of them is a refusal: no landing hex, or none needed. A caster
      // already standing beside its target is its own nearest free neighbour, so
      // the dash resolves to the hex it is on and returns `null` — and this
      // filter therefore withheld the one hex the strike half exists for
      // whenever the Shadowblade was in melee. The resolver has always allowed
      // it (`dashGapClosed`); the board was the half that disagreed, which is
      // exactly the mismatch this predicate was written to end.
      return !selfMoveBlocked(caster, variant, h, allUnits, hazards);
    });
  }

  // Everything past here is aimed at a body, and getting there is part of the
  // cast: an ally hemmed in on all six sides cannot be stepped in front of, a
  // rooted Champion cannot charge across the board, and offering either hex
  // would be a refusal waiting to happen. Shared with `skillResolution` and
  // with the AI's scoring through `selfMoveBlocked`, so the board and the rules
  // cannot answer it differently. The two branches above ask it their own way
  // because a blink may legally be aimed at the one occupied hex its
  // `occupiedVariant` exists for, which this filter would strip.
  const reachable = candidates.filter((h) => !selfMoveBlocked(caster, skill, h, allUnits, hazards) && !rampartBlocksShot(skill, caster.position, h, allUnits, hazards));

  // A skill that names the side it is for says so, and that is the only thing
  // the highlight pass can go on when the payload is neither damage nor healing
  if (skill.targetSide) {
    const wantsAlly = skill.targetSide === 'ally';
    // A Reaction on one named ally refuses an objective as its ward (`castReaction`)
    const refusesObjective = !!skill.reaction && watchesWard(skill);
    return reachable.filter((h) => {
      const occupant = allUnits.find(
        (u) => u.currentHp > 0 && u.position.q === h.q && u.position.r === h.r,
      );
      if (!occupant || occupant.id === caster.id) return false;
      if (refusesObjective && occupant.objective) return false;
      return (occupant.isPlayer === caster.isPlayer) === wantsAlly;
    });
  }

  const isAttack = !!skill.damage && !skill.healing;
  const isHeal   = !!skill.healing && !skill.damage;

  // For hybrid / special skills show every reachable hex
  if (!isAttack && !isHeal) return reachable;

  // For pure attack / pure heal, only show hexes that would affect at least one
  // unit of the appropriate side when targeted.
  return reachable.filter((h) => {
    // A charge strikes from where it lands, so an area it carries (Shield
    // Avalanche's cone) is read from the landing, as the resolver reads it
    const from = skill.selfMove?.kind === 'dash'
      ? resolveSelfMove(caster, skill, h, allUnits, hazards) ?? caster.position
      : caster.position;
    // The caster is always in a self-including heal's footprint, so only the aimed
    // hex says whether there is an ally (or the caster) to aim it at
    const affected = skill.healsCaster ? [h] : getSkillTargets(skill, from, h, allUnits, hazards);
    return affected.some((affectedHex) => {
      const unit = allUnits.find(
        (u) => u.currentHp > 0 &&
               u.position.q === affectedHex.q &&
               u.position.r === affectedHex.r
      );
      if (!unit) return false;
      // An attack needs an enemy it may strike: a stealthed one offers no highlight to
      // click (area skills still list the hex, so it can be swept out), the rune circle
      // lets a duelist reach only the other, and a gated skill offers nothing it would
      // refuse — "which enemies can I execute" is answered by the board.
      // A carried Furnace Heart on an ally's hex (or the caster's own) is what an attack there strikes
      if (isAttack) return canAim(caster, struckBody(caster, unit, allUnits) ?? unit, skill);
      // A heal needs an ally the rune circle lets it reach
      return !duelBars(caster, unit) && unit.isPlayer === caster.isPlayer;
    });
  });
}


/** Re-exported so callers here need not reach into `statusEffects` for it. */
export const isAoESkill = isAreaSkill;
