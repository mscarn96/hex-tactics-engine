import { skillName } from '@/data/gameText';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { AuraType, PreparedReaction, ReactionEvent } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { useCombatStore } from '@/stores/combatStore';
import { unitById } from '@/systems/combat/unitLookup';
import { reactionsMatching, triggerSubject, canReact, intercepts, watchesWard } from '@/systems/combat/reactions';
import { CombatSink, resolveSkillUse } from '@/systems/combat/skillResolution';

/**
 * Firing prepared Reactions — the one resolver for heroes and enemies.
 *
 * Drains the events the store has recorded and answers each, in the order the
 * events happened and, within one event, the order the reactions were prepared.
 * Called by `beginTurn` before anything else, so a reaction always lands before
 * the next unit acts, and by the scene once an action has finished drawing.
 * See `reactions` for the full contract.
 *
 * The response is the ordinary resolver, `resolving` so that it costs nothing
 * and ignores cooldowns (they were paid at the cast), aimed at the hostile unit
 * that set it off.
 */
export function flushReactions(sink: CombatSink): PreparedReaction[] {
  const fired: PreparedReaction[] = [];
  const queue: ReactionEvent[] = [];
  let guard = BALANCE.REACTION_CASCADE_LIMIT;
  // A watch answers an attacking cast once, however many allies it struck: the
  // events of one flush are one action's
  const answered = new Set<string>();

  for (;;) {
    queue.push(...useCombatStore.getState().drainReactionEvents());
    const event = queue.shift();
    if (!event) break;

    for (const match of reactionsMatching(
      event,
      useCombatStore.getState().reactions,
      useCombatStore.getState().units,
    )) {
      if (guard <= 0) return fired;
      const store = useCombatStore.getState();
      // An earlier answer to this same event may have killed or disabled the
      // owner, or removed the one it was aimed at: judge again on the live board.
      const live = store.reactions.find((r) => r.id === match.reaction.id);
      const owner = unitById(store.units, match.reaction.ownerId);
      if (!live || !owner || !canReact(owner, live)) continue;
      const subject = triggerSubject(live, event, store.units);
      if (!subject) continue;

      // An interception's answer was paid for when the blow was taken, once per blow
      const watch = !!live.spec.shotsPerRound && !intercepts(live);
      const key = `${live.id}:${subject.id}`;
      if (watch && answered.has(key)) continue;

      guard--;
      if (watch) {
        answered.add(key);
        useCombatStore.setState((s) => ({
          reactions: s.reactions.map((r) => (r.id === live.id ? { ...r, shotsLeft: (r.shotsLeft ?? 1) - 1 } : r)),
        }));
      } else if (!intercepts(live)) {
        store.removeReaction(live.id);
      }
      store.setFacing(owner.id, subject.position);
      sink.log(t('combatLog.log.reactionAnswers', { name: unitName(owner), skill: skillName(live.skill) }), '#9ad0ff');
      sink.lands?.(live.spec.response, owner.position, subject.position);
      // The response is its own blow: it neither spends nor uses a Settle In
      // charge, and what it deals is marked so no watch answers it
      const shooter = { ...owner, activeEffects: owner.activeEffects.filter((e) => e.type !== AuraType.SettledAim) };
      useCombatStore.setState({ answeringReaction: true });
      try {
        resolveSkillUse(shooter, live.spec.response, subject.position, sink, { resolving: true, reacting: true });
      } finally {
        useCombatStore.setState({ answeringReaction: false });
      }
      // A Reaction answer turns its owner toward the attacker. A ward's leap is
      // aimed at the ally it lands beside, so it is turned once it has landed
      const attacker = event.kind === 'damaged' ? unitById(useCombatStore.getState().units, event.attackerId) : undefined;
      if (watchesWard(live.skill) && attacker && attacker.currentHp > 0) {
        useCombatStore.getState().setFacing(owner.id, attacker.position);
      }
      fired.push(live);
    }
  }
  return fired;
}
