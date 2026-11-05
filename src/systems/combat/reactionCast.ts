import { skillName } from '@/data/gameText';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { CombatUnit, HeroSkill } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { canPrepareReaction, createReaction, reactionSummary, watchesWard } from '@/systems/combat/reactions';
import { hexDistance } from '@/utils/hexUtils';
import { reactionLimit } from '@/systems/combat/beetle';

/**
 * Casting a Reaction: the half every caster shares.
 *
 * `resolveSkillUse`, which a hero's cast and an enemy's cast both go through,
 * calls this, so preparing is one rule — the same shape as `preparedCast`.
 * Mana and the cooldown are paid here, the whole turn is spent (the move as
 * well as the action: a Reaction is the turn), and nothing is dealt. Firing is
 * `reactionResolve`.
 *
 * Kept free of `skillResolution` so the AI can import it without closing a
 * cycle.
 */

export type ReactionRefusal = 'already-prepared' | 'needs-ward';

export function castReaction(
  caster: CombatUnit,
  skill: HeroSkill,
  log: (text: string, color: string) => void,
  /** The ally a Reaction on one named ally is cast on (`watchesWard`): a living ally in range, never the caster. */
  ward?: CombatUnit,
): { ok: true } | { ok: false; refusal: ReactionRefusal } {
  const store = useCombatStore.getState();
  if (!skill.reaction) throw new Error(`${skill.id} is not a Reaction`);
  const limit = reactionLimit(caster);
  if (!canPrepareReaction(caster.id, store.reactions, limit)) return { ok: false, refusal: 'already-prepared' };
  const named = watchesWard(skill);
  if (named && (!ward || ward.id === caster.id || ward.isPlayer !== caster.isPlayer || ward.currentHp <= 0
    || ward.objective || hexDistance(caster.position, ward.position) > skill.range)) {
    return { ok: false, refusal: 'needs-ward' };
  }

  store.addReaction(createReaction(caster, skill, named ? ward : undefined), limit);
  const readied = { name: unitName(caster), skill: skillName(skill), summary: reactionSummary(skill) };
  log(named && ward
    ? t('combatLog.log.readiesOver', { ...readied, ward: unitName(ward) })
    : t('combatLog.log.readies', readied), '#9ad0ff');

  if (skill.manaCost > 0) store.spendMana(caster.id, skill.manaCost);
  store.startCooldown(caster.id, skill);
  // The turn is spent: nothing else this turn, whichever driver is playing it.
  store.markMoved(caster.id);
  store.markActed(caster.id);
  return { ok: true };
}
