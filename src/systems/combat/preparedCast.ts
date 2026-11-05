import { CombatUnit, HeroSkill, HexCoord, PreparedAttack, SkillTargetType } from '@/models/types';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { useCombatStore } from '@/stores/combatStore';
import { arcAimHex } from '@/systems/combat/arenaGeometry';
import { createPreparedAttack, preparedBy } from '@/systems/combat/preparedAttacks';
import { skillName } from '@/data/gameText';

/**
 * Casting a preparation: the half every caster shares.
 *
 * `resolveSkillUse` is the one resolver a hero's cast and an enemy's cast go
 * through, but a warned attack is also announced by other paths (a boss script's
 * footprint, a landing), so announcing is kept as one rule here: the footprint
 * is fixed here, mana and the cooldown are paid here, and nothing is dealt.
 *
 * Kept free of `skillResolution` so the resolver can import it without closing
 * a cycle; the landing half, which needs the resolver, is `preparedResolve`.
 */

export type PrepareRefusal = 'already-preparing';

/**
 * One major delayed attack per caster at a time. A boss that stacked warnings
 * would be combining them into a pattern with no safe response — the one thing
 * the encounter rules forbid — so a second preparation is refused here and the
 * AI is told not to score it (`canPrepare`).
 *
 * A warning carried by a hero (`PreparedSpec.carried`: the Furnace Heart) is the
 * exception on both sides: it rides on one hero for rounds, and its answer is
 * passing or breaking it rather than standing anywhere, so it neither holds the
 * caster's other warnings back nor is held back by them — but only one of it
 * stands at a time. `carried` asks about a new carried warning.
 */
export function canPrepare(casterId: string, carried = false): boolean {
  return preparedBy(casterId, useCombatStore.getState().preparedAttacks)
    .every((p) => !!p.spec.carried !== carried);
}

export function castPrepared(
  caster: CombatUnit,
  skill: HeroSkill,
  aim: HexCoord,
  hexes: HexCoord[],
  units: CombatUnit[],
  log: (text: string, color: string) => void,
  spared: readonly HexCoord[] = [],
): { ok: true; attack: PreparedAttack } | { ok: false; refusal: PrepareRefusal } {
  const store = useCombatStore.getState();
  if (!canPrepare(caster.id, !!skill.prepares?.carried)) return { ok: false, refusal: 'already-preparing' };

  const attack = createPreparedAttack(caster, skill, aim, hexes, units, spared);
  store.addPreparedAttack(attack);
  log(t('combatLog.log.prepares', { name: unitName(caster), skill: skillName(skill) }), '#ffaa44');

  // The caster commits its facing to the warning too, so the model, the
  // wedge on the floor and the strike that lands all point the same way.
  store.setFacing(
    caster.id,
    skill.targetType === SkillTargetType.Arc ? arcAimHex(caster.position, aim) : aim,
  );
  if (skill.manaCost > 0) store.spendMana(caster.id, skill.manaCost);
  store.startCooldown(caster.id, skill);
  return { ok: true, attack };
}
