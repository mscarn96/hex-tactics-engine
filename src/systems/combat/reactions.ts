import {
  AfflictionType,
  CombatUnit,
  HeroSkill,
  PreparedReaction,
  ReactionEvent,
  ReactionTrigger,
} from '@/models/types';
import { hexDistance } from '@/utils/hexUtils';
import { t } from '@/i18n';

/**
 * Prepared Reactions, as pure rules over a roster. The one contract both sides
 * share: a hero's Riposte and an enemy's counter-spell are the same
 * `PreparedReaction`, matched and ordered here and resolved by `reactionResolve`.
 *
 * **What a Reaction is.** Casting one spends the owner's whole turn (move and
 * action) and prepares a trigger and a response. It is *not* a held action: if
 * the trigger never comes, the turn bought nothing.
 *
 * **When it fires.** The store records what happens (`ReactionEvent`s: a hostile
 * blow landed, a hostile unit finished a move). The queue is drained at the
 * documented moment — *after the action that caused the event has fully
 * resolved, before any other unit acts* — so a reaction never interrupts the
 * middle of a multi-hit skill, and an area blow that strikes three heroes is
 * judged once all three are struck. Several reactions answering one event fire
 * in the order they were prepared. A reaction fires **once** and is spent.
 *
 * **What can stop it.** An owner that is stunned or frozen when the moment
 * comes cannot answer; the preparation waits and may still expire. A response
 * that cannot reach its subject (out of the response skill's range) does not
 * fire either — the same range the player would be held to.
 *
 * **When it expires.** At the start of the owner's *regular* turn it loses one
 * turn from its count and is gone at zero, so `duration: 1` covers exactly the
 * window until the owner's next turn. A bonus turn (`turnTempo`) is extra action
 * and never extra time: it neither ticks nor extends a Reaction, and an owner
 * who has just prepared one and receives a bonus turn may not prepare a second
 * while it stands.
 *
 * **Chains.** A response's own damage and movement are events like any other,
 * answered after it resolves; each Reaction can only fire once, so a chain ends,
 * and `BALANCE.REACTION_CASCADE_LIMIT` is the backstop.
 */

let reactionSequence = 0;

export function createReaction(owner: CombatUnit, skill: HeroSkill, ward?: CombatUnit): PreparedReaction {
  const spec = skill.reaction!;
  return {
    id: `react_${++reactionSequence}`,
    ownerId: owner.id,
    skill,
    spec,
    turnsLeft: spec.duration,
    sequence: reactionSequence,
    ...(spec.shotsPerRound && { shotsLeft: spec.shotsPerRound }),
    ...(ward && { wardId: ward.id }),
  };
}

/** Whether a Reaction takes blows before they land rather than answering after (Vengeful Shell). */
export const intercepts = (reaction: Pick<PreparedReaction, 'spec'>): boolean =>
  reaction.spec.trigger.kind === 'interceptAlly';

/** Whether a Reaction is cast on one named ally rather than on the owner (Carapace Leap). */
export const watchesWard = (skill: Pick<HeroSkill, 'reaction'>): boolean =>
  skill.reaction?.trigger.kind === 'wardStruck';

export const reactionOf = (ownerId: string, reactions: readonly PreparedReaction[]) =>
  reactions.find((r) => r.ownerId === ownerId);

/**
 * One at a time per owner: a second cast while one stands is refused. `limit` is
 * how many the owner may stand at once — two for a Beetle holding Second Watch
 * (`beetle.reactionLimit`), one for everybody else.
 */
export const canPrepareReaction = (ownerId: string, reactions: readonly PreparedReaction[], limit = 1) =>
  reactions.filter((r) => r.ownerId === ownerId).length < limit;

/**
 * An owner that cannot act cannot answer. With the reaction in hand, a response
 * that moves its owner (Carapace Leap) also cannot answer while the owner is
 * Rooted: the leap is refused and the Reaction waits, as it waits out a Stun.
 */
export function canReact(owner: CombatUnit, reaction?: Pick<PreparedReaction, 'spec'>): boolean {
  if (reaction?.spec.response.selfMove && owner.activeEffects.some((e) => e.type === AfflictionType.Root)) return false;
  return (
    owner.currentHp > 0 &&
    !owner.activeEffects.some((e) => e.type === AfflictionType.Stun || e.type === AfflictionType.Freeze)
  );
}

const hostile = (a: CombatUnit, b: CombatUnit) => a.isPlayer !== b.isPlayer;

/**
 * The hostile unit a reaction would answer, if this event is one it is waiting
 * for. Pure of the reaction's own state: whether the owner can act is
 * `canReact`'s question.
 */
export function triggerSubject(
  reaction: PreparedReaction,
  event: ReactionEvent,
  units: readonly CombatUnit[],
): CombatUnit | undefined {
  const owner = units.find((u) => u.id === reaction.ownerId);
  if (!owner || owner.currentHp <= 0) return undefined;
  const trigger = reaction.spec.trigger;

  // An interception was paid for when the blow was taken (`interceptBlow`): its
  // answer goes to the attacker of that blow, and to nothing else
  if (trigger.kind === 'interceptAlly') {
    if (event.kind !== 'intercepted' || event.reactionId !== reaction.id) return undefined;
    const attacker = units.find((u) => u.id === event.attackerId);
    if (!attacker || attacker.currentHp <= 0 || attacker.objective || !hostile(attacker, owner)) return undefined;
    if (hexDistance(owner.position, attacker.position) > reaction.spec.response.range) return undefined;
    return attacker;
  }

  // A watch answers a set number of times a round, and never a Reaction's own blow
  if (reaction.spec.shotsPerRound) {
    if ((reaction.shotsLeft ?? 0) <= 0) return undefined;
    if (event.kind === 'damaged' && event.byReaction) return undefined;
  }

  let subject: CombatUnit | undefined;
  if (event.kind === 'damaged' && (trigger.kind === 'struck' || trigger.kind === 'allyStruck')) {
    const target = units.find((u) => u.id === event.targetId);
    const attacker = units.find((u) => u.id === event.attackerId);
    if (!target || !attacker || !hostile(attacker, owner)) return undefined;
    if (trigger.kind === 'struck') {
      if (target.id !== owner.id) return undefined;
      if (trigger.melee && hexDistance(owner.position, attacker.position) > 1) return undefined;
    } else {
      if (target.id === owner.id || target.isPlayer !== owner.isPlayer) return undefined;
    }
    subject = attacker;
  } else if (event.kind === 'damaged' && trigger.kind === 'wardStruck') {
    // The ward is who the answer goes to, so the ward is the subject: the leap
    // is aimed at the ally, and its reach is measured to the ally
    const attacker = units.find((u) => u.id === event.attackerId);
    if (!attacker || !hostile(attacker, owner) || event.targetId !== reaction.wardId) return undefined;
    const ward = units.find((u) => u.id === reaction.wardId);
    if (!ward || ward.currentHp <= 0) return undefined;
    if (hexDistance(owner.position, ward.position) > reaction.spec.response.range) return undefined;
    return ward;
  } else if (event.kind === 'moved' && trigger.kind === 'foeApproaches') {
    const mover = units.find((u) => u.id === event.unitId);
    if (!mover || !hostile(mover, owner)) return undefined;
    if (hexDistance(owner.position, mover.position) > trigger.reach) return undefined;
    subject = mover;
  }

  if (!subject || subject.currentHp <= 0 || subject.objective || subject.id === owner.id) return undefined;
  // The same reach the response would be held to if it were cast by hand
  if (hexDistance(owner.position, subject.position) > reaction.spec.response.range) return undefined;
  return subject;
}

export interface ReactionMatch {
  reaction: PreparedReaction;
  subject: CombatUnit;
}

/** Every reaction this event sets off, in the order they were prepared. */
export function reactionsMatching(
  event: ReactionEvent,
  reactions: readonly PreparedReaction[],
  units: readonly CombatUnit[],
): ReactionMatch[] {
  const out: ReactionMatch[] = [];
  for (const reaction of reactions) {
    const owner = units.find((u) => u.id === reaction.ownerId);
    if (!owner || !canReact(owner, reaction)) continue;
    const subject = triggerSubject(reaction, event, units);
    if (subject) out.push({ reaction, subject });
  }
  return out.sort((a, b) => a.reaction.sequence - b.reaction.sequence);
}

/**
 * The owner's reaction after one of its regular turns begins: counted down, and
 * `expired` once it reaches zero. Pure — the store applies the result.
 */
export function tickReaction(reaction: PreparedReaction): { reaction: PreparedReaction; expired: boolean } {
  const turnsLeft = reaction.turnsLeft - 1;
  // A watch's answers refill with each of the owner's regular turns
  const refilled = reaction.spec.shotsPerRound ? { shotsLeft: reaction.spec.shotsPerRound } : {};
  return { reaction: { ...reaction, turnsLeft, ...refilled }, expired: turnsLeft <= 0 };
}

export function triggerText(trigger: ReactionTrigger): string {
  switch (trigger.kind) {
    case 'struck':
      return t(trigger.melee ? 'combatLog.reaction.struckMelee' : 'combatLog.reaction.struck');
    case 'allyStruck':
      return t('combatLog.reaction.allyStruck');
    case 'foeApproaches':
      return t('combatLog.reaction.foeApproaches', { reach: trigger.reach });
    case 'wardStruck':
      return t('combatLog.reaction.wardStruck');
    case 'interceptAlly':
      return t('combatLog.reaction.interceptAlly', { reach: trigger.reach });
  }
}

/** "When struck in melee" — what sets the Reaction off, on its own (the HUD banner adds its own clock). */
export function reactionWhen(skill: Pick<HeroSkill, 'reaction'>): string {
  return skill.reaction ? t('combatLog.reaction.when', { trigger: triggerText(skill.reaction.trigger) }) : '';
}

/** "When struck in melee · ready 2 turns" — the line the HUD and the tooltip share. */
export function reactionSummary(skill: Pick<HeroSkill, 'reaction'>): string {
  const spec = skill.reaction;
  if (!spec) return '';
  const shots = spec.shotsPerRound ? t('combatLog.reaction.shots', { count: spec.shotsPerRound }) : '';
  return t('combatLog.reaction.summary', { when: reactionWhen(skill), count: spec.duration, shots });
}
