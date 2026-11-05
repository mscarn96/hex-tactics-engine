import { skillName } from '@/data/gameText';
import { AfflictionType, CombatUnit, HeroSkill, PreparedAttack, StatusEffectType } from '@/models/types';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { isAffliction, skillEffects } from '@/systems/combat/statusEffects';
import { statusInterrupts } from '@/systems/combat/preparedAttacks';

/**
 * Bosses and disabling control.
 *
 * A boss is never stun-locked: Stun, Silence, Freeze and **Root** do not stay
 * on it during ordinary turns, so a party cannot win a boss fight by chaining
 * disables. Taunt is the exception and stays normal target control — it is how
 * a tank holds a boss, and removing it would delete the role.
 *
 * What a disable *can* do is interrupt, but only a preparation that says so
 * (`PreparedSpec`): the status still does not persist, it cancels the one
 * announced attack and nothing else. The authored spec is the whole rule, and
 * the skill preview reads the same function the resolver does.
 *
 * **Root is resolved here, explicitly.** It is a disable with a displacement
 * edge — a rooted boss cannot leave a warned footprint or reach a marked hero,
 * which breaks the positional contract the encounter kits are built on — so a
 * boss ignores it as it ignores the others, and a preparation may still list it
 * as an interrupt.
 */
export const BOSS_IGNORED_DISABLES: readonly StatusEffectType[] = [
  AfflictionType.Stun,
  AfflictionType.Silence,
  AfflictionType.Freeze,
  AfflictionType.Root,
];

/** The encounter tier of a unit: its template's, or `normal` for heroes and summons. */
export function unitTier(unit: CombatUnit): 'normal' | 'elite' | 'boss' {
  const template = unit.templateId
    ? enemyTemplates.find((t) => t.id === unit.templateId)
    : undefined;
  return template?.tier ?? 'normal';
}

export const isBoss = (unit: CombatUnit): boolean => !unit.isPlayer && unitTier(unit) === 'boss';

/**
 * Whether this unit's health is read across the top of the screen, by name, with
 * its phase. The arena draws no HP bar over such a unit: the same predicate
 * decides both, so a boss never has two bars or none.
 */
export const showsBossHealthBar = (unit: CombatUnit): boolean => unit.currentHp > 0 && isBoss(unit);

/** Whether this unit shrugs off `type` as an ordinary disable. */
export function ignoresDisable(unit: CombatUnit, type: StatusEffectType): boolean {
  return isBoss(unit) && BOSS_IGNORED_DISABLES.includes(type);
}

export interface InterruptPreview {
  attackId: string;
  /** The preparation's skill, by name, for the card. */
  name: string;
  /** False when the status rides on a chance and may not land. */
  certain: boolean;
}

/**
 * Which pending preparations a skill would cancel if it landed on their caster.
 *
 * Only afflictions count — an aura a skill grants its own side is never aimed
 * at the boss. Shown on the armed skill so the player can tell, before they
 * commit, whether this is the button that answers the warning.
 */
export function previewInterrupts(
  skill: HeroSkill,
  attacks: PreparedAttack[],
): InterruptPreview[] {
  const out: InterruptPreview[] = [];
  for (const attack of attacks) {
    const entry = skillEffects(skill).find(
      (e) => isAffliction(e.type) && statusInterrupts(attack, e.type),
    );
    if (!entry) continue;
    out.push({
      attackId: attack.id,
      name: skillName(attack.skill),
      certain: entry.chance === undefined || entry.chance >= 1,
    });
  }
  return out;
}
