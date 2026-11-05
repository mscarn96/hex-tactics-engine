import { BALANCE } from '@/data/balanceConstants';
import { skillName } from '@/data/gameText';
import { resourceLacking } from '@/data/classResource';
import { AuraType, CombatUnit, HeroSkill, PreparedReaction } from '@/models/types';
import { isRooted, isSilenced } from '@/systems/combat/statusEffects';
import { finishedStageUnit } from '@/systems/combat/unitLookup';
import { selfMoveIsThePoint } from '@/systems/combat/forcedMovement';
import { aimLocks } from '@/systems/combat/chargedCast';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { markPending, scytheLocked, scytheLocks } from '@/systems/combat/mantis';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { canPrepareReaction } from '@/systems/combat/reactions';
import { reactionLimit } from '@/systems/combat/beetle';

/**
 * Turns left before `skill` can be used again. Zero means ready now.
 *
 * One reader for the HUD, the AI and the execution paths, so a skill can never
 * look available in one place and be rejected in another.
 */
export function cooldownLeft(unit: CombatUnit, skill: HeroSkill): number {
  // An aimed shot's cooldown started at the aim; the release is not held to it
  if (skill.releasing && skill.charge?.aimed) return 0;
  // A Mantis capstone's later half: the launch started the cooldown (the Scythe) or
  // the release will (Marked Prey), and neither half waits on it
  if (skill.mantisStage) return 0;
  return unit.cooldowns?.[skill.id] ?? 0;
}

export function isSkillReady(unit: CombatUnit, skill: HeroSkill): boolean {
  return cooldownLeft(unit, skill) <= 0;
}

/**
 * Whether a Silence stops this unit using `skill`: every skill but the Basic Attack,
 * which is the weapon in the hand, not a technique (playtest 2026-10-21, PT-19).
 */
export function silenceBars(unit: CombatUnit, skill: Pick<HeroSkill, 'id'>): boolean {
  return isSilenced(unit) && skill.id !== BASIC_ATTACK_ID;
}

/** What the resolver says when a Root stops a cast, and so what every other surface says. */
export const rootedRefusal = (): string => t('combatLog.refuse.rooted');
/** An Apex spell is one use per Apex shape. */
export const apexSpent = (): string => t('combatLog.refuse.apexSpent');
/** A charged skill pressed on the turn it was charged. */
export const chargePending = (): string => t('combatLog.refuse.chargePending');
/** Any other skill pressed while Aimed Shot's aim stands. */
export const aimLocked = (): string => t('combatLog.refuse.aimLocked');

export type UsabilityGuard =
  'fury' | 'rooted' | 'apex' | 'charge' | 'aim' | 'scythe' | 'stage' | 'reaction' | 'silenced' | 'cooldown' | 'mana';

export type Usability = { ok: true } | { ok: false; guard: UsabilityGuard; reason: string };

interface Guard {
  id: UsabilityGuard;
  /** Why this unit cannot use this skill, or null when this guard lets it through. */
  reason(unit: CombatUnit, skill: HeroSkill, units: CombatUnit[], reactions: readonly PreparedReaction[]): string | null;
  /** The cast itself refuses as `unusable` (the AI does not score it, the resolver turns it away). */
  refusesCast: boolean;
  /**
   * The press can name it without looking at the board. A guard the resolver refuses
   * with a reason of its own (a Root, a finished construction) is previewed but is
   * not `unusable`, because that refusal carries a better message than "Cannot use that yet".
   */
  previewed: boolean;
}

/**
 * Every reason a unit cannot use a skill, in one list, in the order they are named.
 *
 * The AI's scorer, the HUD's button, the preview's reason and the resolver's refusal
 * used to keep two lists of these (`canUseSkill` here and `skillBlockedReason` in
 * `skillAvailability`) that agreed by convention: Righteous Fury at its cap, a charge
 * laid this turn, Aimed Shot's lock and a spent Apex spell were each written twice. A
 * guard added to one and not the other is a button that looks pressable and is
 * refused, or the reverse. Silence lives here for the reason it always did: a silence
 * enforced in only some of the surfaces is a silence the AI happily ignores.
 */
const GUARDS: readonly Guard[] = [
  {
    id: 'fury', refusesCast: true, previewed: true,
    reason: (u, s) =>
      s.id === 'righteous_fury' && (u.activeEffects.find((e) => e.type === AuraType.BlessedWeapon)?.stacks ?? 0) >= BALANCE.FURY_MAX_STACKS
        ? t('combatLog.refuse.furyFull', { skill: skillName(s), max: BALANCE.FURY_MAX_STACKS })
        : null,
  },
  {
    id: 'rooted', refusesCast: false, previewed: true,
    reason: (u, s) => (selfMoveIsThePoint(s) && isRooted(u) ? rootedRefusal() : null),
  },
  {
    id: 'apex', refusesCast: true, previewed: true,
    // An Apex spell is used once per Apex shape: the charge is its only limit
    reason: (u, s) => (s.formSkill === 'apex' && u.apexSpent?.includes(s.id) ? apexSpent() : null),
  },
  {
    id: 'charge', refusesCast: true, previewed: true,
    // A charge laid this turn fires on the next regular one, not now
    reason: (_u, s) => (s.chargePending ? (s.mantisStage === 'release' ? markPending() : chargePending()) : null),
  },
  {
    id: 'aim', refusesCast: true, previewed: true,
    // Aimed Shot's aim: shoot or move, nothing else
    reason: (u, s) => (aimLocks(u, s) ? aimLocked() : null),
  },
  {
    id: 'scythe', refusesCast: true, previewed: true,
    // A Threefold Scythe stage turn: that stage or a move, nothing else
    reason: (u, s) => (scytheLocks(u, s) ? scytheLocked() : null),
  },
  {
    id: 'stage', refusesCast: false, previewed: true,
    // Stone Heart: one finished Stone Elemental at a time; free again once it falls
    reason: (u, s, units) => {
      const finished = finishedStageUnit(s.summons, u, units);
      return finished ? t('combatLog.refuse.stageStands', { name: unitName(finished) }) : null;
    },
  },
  {
    id: 'reaction', refusesCast: false, previewed: true,
    // Every Reaction slot already stands (one, two with Second Watch): `castReaction`
    // refuses the cast, so the button says so up front rather than lighting the
    // board for taps that do nothing (PT-06). The board's reactions are only known
    // to a caller that passes them; the resolver's own refusal backs this up.
    reason: (u, s, _units, reactions) =>
      s.reaction && !canPrepareReaction(u.id, reactions, reactionLimit(u)) ? t('combatLog.refuse.reactionHeld') : null,
  },
  { id: 'silenced', refusesCast: true, previewed: false, reason: (u, s) => (silenceBars(u, s) ? t('combatLog.refuse.silenced') : null) },
  {
    id: 'cooldown', refusesCast: true, previewed: false,
    reason: (u, s) => (isSkillReady(u, s) ? null : t('combatLog.refuse.cooldown', { count: cooldownLeft(u, s) })),
  },
  { id: 'mana', refusesCast: true, previewed: false, reason: (u, s) => (u.currentMana >= s.manaCost ? null : resourceLacking(u.resource)) },
];

/** The first guard that stops this unit using this skill, with its reason; `{ ok: true }` when none does. */
export function skillUsability(
  unit: CombatUnit, skill: HeroSkill, units: CombatUnit[] = [], reactions: readonly PreparedReaction[] = [],
): Usability {
  for (const guard of GUARDS) {
    const reason = guard.reason(unit, skill, units, reactions);
    if (reason) return { ok: false, guard: guard.id, reason };
  }
  return { ok: true };
}

/** Whether the unit can actually press this skill right now: every guard the cast itself refuses on. */
export function canUseSkill(unit: CombatUnit, skill: HeroSkill): boolean {
  return GUARDS.every((guard) => !guard.refusesCast || !guard.reason(unit, skill, [], []));
}

/**
 * A reason this caster cannot use this skill at all right now, when one can be named
 * without looking at the board (the same guards, so the preview and the refusal agree).
 */
export function skillBlockedReason(
  skill: HeroSkill, caster: CombatUnit, units: CombatUnit[] = [], reactions: readonly PreparedReaction[] = [],
): string | null {
  for (const guard of GUARDS) {
    if (!guard.previewed) continue;
    const reason = guard.reason(caster, skill, units, reactions);
    if (reason) return reason;
  }
  return null;
}

/**
 * The cooldown map after casting `skill`.
 *
 * Set to `cooldown + 1` because the counter is decremented at the start of the
 * caster's *next* turn, which would otherwise consume the first turn of the
 * wait for free — a "1 turn" cooldown would then mean no wait at all.
 */
export function withCooldownStarted(
  cooldowns: Record<string, number> | undefined,
  skill: HeroSkill
): Record<string, number> | undefined {
  if (!skill.cooldown || skill.cooldown <= 0) return cooldowns;
  return { ...(cooldowns ?? {}), [skill.id]: skill.cooldown + 1 };
}

/**
 * The cooldown map one turn later, with finished entries dropped.
 *
 * Returns the original object when nothing changed, so callers can skip a
 * needless store write on the many turns where no cooldown is running.
 */
export function tickedCooldowns(
  cooldowns: Record<string, number> | undefined
): Record<string, number> | undefined {
  if (!cooldowns) return cooldowns;
  const entries = Object.entries(cooldowns).filter(([, turns]) => turns > 0);
  if (entries.length === 0) return cooldowns;

  const next: Record<string, number> = {};
  for (const [id, turns] of entries) {
    if (turns - 1 > 0) next[id] = turns - 1;
  }
  return next;
}

/**
 * The cooldown map with every running entry brought forward by `turns`.
 *
 * Like `tickedCooldowns`, returns the original object when nothing changed so
 * the caller can skip the store write. A refund that empties an entry drops it
 * rather than leaving a zero behind — `cooldownLeft` treats both as ready, but
 * an accumulating map of dead keys is a leak nobody would think to look for.
 */
export function refundedCooldowns(
  cooldowns: Record<string, number> | undefined,
  turns: number
): Record<string, number> | undefined {
  if (!cooldowns || turns <= 0) return cooldowns;
  const entries = Object.entries(cooldowns).filter(([, left]) => left > 0);
  if (entries.length === 0) return cooldowns;

  const next: Record<string, number> = {};
  for (const [id, left] of entries) {
    if (left - turns > 0) next[id] = left - turns;
  }
  return next;
}
