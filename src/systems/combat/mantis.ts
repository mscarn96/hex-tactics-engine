import { ActiveEffect, AfflictionType, ArenaHazard, AuraType, CombatUnit, HeroSkill, HexCoord, MantisTurn } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { MARKED_PREY_RELEASE } from '@/data/skills/mastery/mantis';
import { hasEffect } from '@/systems/combat/statusEffects';
import { hasPassive, passiveRank } from '@/systems/combat/passives';
import { landingBehind, standableFor } from '@/systems/combat/facing';
import { getNeighbors, hexDistance } from '@/utils/hexUtils';
import { t } from '@/i18n';
import { skillName } from '@/data/gameText';

/**
 * The Mantis's rules (the private project notes, "### Mantis"), pure: the
 * resolver asks, the store writes.
 *
 * - **Twin Reap** is two cuts, one per blade. The second cut on a Bleeding enemy
 *   is a certain critical hit and reaps the Bleed — removes it once it lands.
 * - **Reaping Momentum** remembers the last prey: each reap on the same enemy as
 *   the last carries one more stack (up to `MOMENTUM_MAX_STACKS`), and each stack
 *   adds `MOMENTUM_STEP` × rank to the reap's cuts. Only Twin Reap writes the
 *   memory, so any other skill between two reaps — a Pounce, a Basic Attack —
 *   keeps the count; a reap on another enemy starts it over at none.
 * - **Flicker Cut** blinks behind its prey before the cut (`strikeLanding`), so the
 *   cut is a backstab. (`flickerLanding` is the blink after a blow, Pilgrim's Step's.)
 * - **The capstones** (`HeroSkill.mantisCapstone`). Marked Prey's mark is an aura
 *   on the Mantis that counts what its prey loses (`tallyMarkedPrey`) and turns the
 *   button into the release (`mantisStage`). Threefold Scythe's launch queues two
 *   bonus turns, each locked to its stage (`scytheLocks`). Mantis Execution lands
 *   behind its prey before the cuts, and a kill queues a bonus turn and leaves the
 *   cooldown unstarted. The bonus turns are taken in `combatStore.nextTurn`.
 */

export const TWIN_REAP_ID = 'twin_reap';

/** Whether this cast is the Mantis's signature. */
export function isTwinReap(skill: Pick<HeroSkill, 'id'>): boolean {
  return skill.id === TWIN_REAP_ID;
}

/**
 * Whether this cut of a Twin Reap reaps: the second blade (`handIndex` 1) against
 * a Bleeding enemy. Read off the enemy as the cut lands, so the first cut cannot
 * change the answer — it lays no Bleed of its own.
 */
export function reapingCut(skill: Pick<HeroSkill, 'id'>, handIndex: number, target: CombatUnit): boolean {
  return isTwinReap(skill) && handIndex === 1 && hasEffect(target, AfflictionType.Bleed);
}

/**
 * The stacks a Twin Reap on `targetId` carries: one more than the last reap's
 * when it is the same prey, capped, and none on a new prey or without the node.
 * The first reap on an enemy carries none — it is the one that names the prey.
 */
export function reapStacks(caster: CombatUnit, targetId: string): number {
  if (!hasPassive(caster, 'reapingMomentum')) return 0;
  const prey = caster.reapPrey;
  if (!prey || prey.targetId !== targetId) return 0;
  return Math.min(prey.stacks + 1, BALANCE.MANTIS.MOMENTUM_MAX_STACKS);
}

/** The factor Reaping Momentum puts on a reap's cuts at `stacks`, by the node's rung. */
export function momentumScale(caster: CombatUnit, stacks: number): number {
  if (stacks <= 0) return 1;
  return 1 + stacks * BALANCE.MANTIS.MOMENTUM_STEP * passiveRank(caster, 'reapingMomentum').scale;
}

/**
 * Where a blink after the blow (`blinksBehind: 'after'`, Pilgrim's Step) puts the
 * caster: behind the prey (its back hex when free, else the free rear-side hex
 * nearest the caster), or nowhere — the caster stays — when the prey has fallen,
 * has no facing, or every hex behind it is taken.
 */
export function flickerLanding(
  caster: CombatUnit,
  prey: CombatUnit | undefined,
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[],
): HexCoord | undefined {
  if (!prey || prey.currentHp <= 0) return undefined;
  return landingBehind(prey, caster.position, standableFor(caster.id, units, hazards));
}

// ─── Capstones ───────────────────────────────────────────────────────────────

/** What the guard says about any other button on a Threefold Scythe stage turn. */
export const scytheLocked = (): string => t('combatLog.refuse.scytheLocked', { skill: skillName({ id: 'threefold_scythe' }) });
/** What the guard says about the release pressed on the turn the mark was laid. */
export const markPending = (): string => t('combatLog.refuse.markPending');

/** The Marked Prey mark this unit holds, if any. */
export const heldMark = (unit: CombatUnit): ActiveEffect | undefined =>
  unit.activeEffects.find((e) => e.type === AuraType.MarkedPrey);

/**
 * The half of a Mantis capstone this unit would use now, the way `chargeStage`
 * answers for a charged skill: Marked Prey's release while its mark stands (marked
 * `chargePending` on the turn it was laid, until a bonus turn arms it — `armed`), the
 * Threefold Scythe stage this turn is locked to, else the skill as authored. Read at
 * the moment of use, so nothing has to put the old skill back.
 */
export function mantisStage(unit: CombatUnit, skill: HeroSkill): HeroSkill {
  if (skill.mantisCapstone === 'markedPrey') {
    const mark = heldMark(unit);
    if (!mark) return skill;
    const release: HeroSkill = { ...skill, ...MARKED_PREY_RELEASE, mantisStage: 'release' };
    return mark.duration >= BALANCE.MANTIS.MARK_TURNS && !mark.armed ? { ...release, chargePending: true } : release;
  }
  if (skill.mantisCapstone === 'threefoldScythe' && unit.scytheStage) {
    const stage = skill.stages?.[unit.scytheStage - 2];
    if (stage) return { ...skill, ...stage, mantisStage: unit.scytheStage };
  }
  return skill;
}

/**
 * Whether a Threefold Scythe stage turn refuses `skill`: every button but the stage
 * the turn is locked to, the Basic Attack and Meditate included. A move is not a
 * skill and stays free.
 */
export function scytheLocks(unit: CombatUnit, skill: HeroSkill): boolean {
  return !!unit.scytheStage && skill.mantisStage !== unit.scytheStage;
}

/** The two bonus turns a Threefold Scythe launch queues, in the order they are taken. */
export const SCYTHE_TURNS: readonly MantisTurn[] = [{ cause: 'scythe', stage: 2 }, { cause: 'scythe', stage: 3 }];

/** The bonus turn a killing Mantis Execution queues. */
export const EXECUTION_TURN: MantisTurn = { cause: 'execution' };

/**
 * Whether aiming this skill closes on its prey from behind before the blow, so the
 * board tints the rear of every enemy it could reach (`boardOverlays.flankShownIds`):
 * Mantis Execution, Marked Prey's release and Flicker Cut (`blinksBehind: 'first'`).
 */
export function blinksInBehind(skill: HeroSkill): boolean {
  return skill.mantisCapstone === 'execution' || skill.mantisStage === 'release' || skill.blinksBehind === 'first';
}

/**
 * Where a blink in behind `prey` lands (Mantis Execution, Marked Prey's release, Flicker Cut):
 * its back hex when free, else the free rear-side hex nearest `from`, else the free
 * hex beside it nearest `from` — which is where the Mantis already stands when it is
 * beside the prey with every other hex taken. Nowhere when the prey has fallen or
 * nothing beside it is free.
 */
export function strikeLanding(
  mover: CombatUnit,
  prey: CombatUnit | undefined,
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[],
): HexCoord | undefined {
  if (!prey || prey.currentHp <= 0) return undefined;
  const free = standableFor(mover.id, units, hazards);
  return landingBehind(prey, mover.position, free)
    ?? getNeighbors(prey.position).filter(free)
      .sort((a, b) => hexDistance(mover.position, a) - hexDistance(mover.position, b) || a.q - b.q || a.r - b.r)[0];
}

/**
 * Marked Prey's second cut: `MARK_SHARE` of what the prey has lost since the mark,
 * never more than `MARK_CAP` × the Mantis's Attack. Fixed — no roll, no defence —
 * because the number is already a count of damage the prey took.
 */
export function markedPreyCut(mark: Pick<ActiveEffect, 'stored'> | undefined, attack: number): number {
  const M = BALANCE.MANTIS;
  return Math.max(0, Math.min(Math.round((mark?.stored ?? 0) * M.MARK_SHARE), Math.round(M.MARK_CAP * attack)));
}

/**
 * The units after `preyId` lost `hpLost`: every Marked Prey aimed at it counts it.
 * Any source counts — a blow, a Bleed, an ally's spell — since the mark promises
 * a share of what the prey has suffered, not of what the Mantis dealt. The same
 * array back when nothing counted.
 */
export function tallyMarkedPrey<U extends CombatUnit>(units: U[], preyId: string, hpLost: number): U[] {
  if (hpLost <= 0) return units;
  const marked = (u: U) => u.activeEffects.some((e) => e.type === AuraType.MarkedPrey && e.aimAt === preyId);
  if (!units.some(marked)) return units;
  return units.map((u) => (marked(u)
    ? {
        ...u,
        activeEffects: u.activeEffects.map((e) => (e.type === AuraType.MarkedPrey && e.aimAt === preyId
          ? { ...e, stored: (e.stored ?? 0) + hpLost }
          : e)),
      }
    : u));
}

// ─── Side trees ──────────────────────────────────────────────────────────────

/**
 * Bleed Harvest: what the Bleed a reap removes would still have dealt — its
 * per-turn damage times the turns it had left — paid at once when the reap
 * lands. Nothing without the node, a Bleed, or a turn left on it.
 */
export function harvestDamage(caster: CombatUnit, bleed: Pick<ActiveEffect, 'magnitude' | 'duration'> | undefined): number {
  if (!bleed || !hasPassive(caster, 'bleedHarvest')) return 0;
  if (!Number.isFinite(bleed.duration) || bleed.duration <= 0) return 0;
  return Math.max(0, Math.round(bleed.magnitude * bleed.duration));
}

/**
 * Deep Cuts: the turns added to a Bleed by the unit that laid it, read off the
 * Bleed's `sourceUnitId` among `units`. Asked by `combatStore.applyEffect`, where
 * every status lands, so a Bleed from a skill, a stage or a passive lasts alike.
 */
export function bleedDurationBonus(
  units: readonly Pick<CombatUnit, 'id' | 'masteryModifiers'>[],
  effect: Pick<ActiveEffect, 'type' | 'sourceUnitId'>,
): number {
  if (effect.type !== AfflictionType.Bleed || !effect.sourceUnitId) return 0;
  return units.find((u) => u.id === effect.sourceUnitId)?.masteryModifiers?.bleedDurationBonus ?? 0;
}
