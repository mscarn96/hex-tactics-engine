import { skillName } from '@/data/gameText';
import type { CombatUnit, PreparedReaction } from '@/models/types';
import { reactionWhen } from '@/systems/combat/reactions';
import type { WarningLine } from '@/data/display/preparedDisplay';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';

/**
 * How a prepared Reaction reads on the HUD banner, beside the warnings: whose
 * it is, what sets it off and how long it lasts. Pure and React-free, like
 * `preparedDisplay`, so the wording is testable. A Reaction whose owner has
 * fallen is left off: the rules already ignore it (`canReact`), so the banner
 * must not promise it.
 */
export function reactionLines(
  reactions: readonly PreparedReaction[],
  units: readonly CombatUnit[],
): WarningLine[] {
  return reactions.flatMap((r) => {
    const owner = units.find((u) => u.id === r.ownerId);
    if (owner && owner.currentHp <= 0) return [];
    const left = r.turnsLeft === 1 ? t('statuses.reaction.lastTurn') : t('statuses.reaction.turnsLeft', { count: r.turnsLeft });
    return [{
      id: r.id,
      title: t('statuses.reaction.ready', { owner: owner ? unitName(owner) : t('statuses.reaction.unit'), skill: skillName(r.skill) }),
      detail: `${reactionWhen(r.skill)} · ${left}`,
      imminent: false,
    }];
  });
}
