import { CombatUnit, HeroSkill, SkillModeId } from '@/models/types';
import { formatPercent, t } from '@/i18n';
import { BALANCE } from '@/data/balanceConstants';
import { hasPassive, passiveRank } from '@/systems/combat/passives';

/**
 * Zeal's Mercy / Wrath: one skill, a choice at the press, numbers derived once.
 *
 * Smite stays one skill — one id, one cooldown, one range and cost — and the
 * mode is a *derived copy* of it for one cast. Everything that has to agree
 * about what a mode does reads this file: the resolver (`resolveSkillUse` takes
 * `mode` in its options and runs the copy), the choice panel and the tooltip
 * (which print the copy's numbers), and the tests. That is the whole of "the
 * preview equals the execution": there is no second place the arithmetic lives.
 *
 * Pure, and free of React and the store, so it runs under the Node suites.
 */

/** What one mode does to Smite's authored numbers, at the owner's Zeal rung. */
export interface SkillModeSpec {
  id: SkillModeId;
  label: string;
  /** Multiplies the skill's `damage`. */
  strikeScale: number;
  /** Multiplies the skill's `allyHeal`; zero removes the heal altogether. */
  healScale: number;
  /** One line for the choice panel, stated from the numbers above. */
  summary: string;
}

const pct = (n: number) => formatPercent(n);

/**
 * The modes `unit` may choose for `skill`, or none.
 *
 * Empty unless the skill declares a `modeChoice` and the unit owns that passive
 * — so a Templar without Zeal is never asked, and a skill with no choice is
 * never offered one. The rung is the passive's: it is 1 / 2 / 3 as the node was
 * bought, and a unit with the passive but no recorded rank (a fixture) resolves
 * at the middle one, like every other passive.
 */
export function skillModesFor(unit: CombatUnit, skill: HeroSkill): SkillModeSpec[] {
  if (!skill.modeChoice || !hasPassive(unit, skill.modeChoice)) return [];
  const rung = Math.min(3, Math.max(1, passiveRank(unit, skill.modeChoice).level)) - 1;

  const mercyStrike = BALANCE.ZEAL_MERCY_STRIKE[rung];
  const mercyHeal = BALANCE.ZEAL_MERCY_HEAL[rung];
  const wrathStrike = BALANCE.ZEAL_WRATH_STRIKE[rung];
  return [
    {
      id: 'mercy',
      label: t('combat.mode.mercy'),
      strikeScale: mercyStrike,
      healScale: mercyHeal,
      summary: t('combatLog.mode.mercySummary', { strike: pct(mercyStrike), heal: pct(mercyHeal) }),
    },
    {
      id: 'wrath',
      label: t('combat.mode.wrath'),
      strikeScale: wrathStrike,
      healScale: 0,
      summary: t('combatLog.mode.wrathSummary', { strike: pct(wrathStrike) }),
    },
  ];
}

/** The mode's spec for `unit` and `skill`, or `undefined` if it is not on offer. */
export function skillModeSpec(
  unit: CombatUnit,
  skill: HeroSkill,
  mode: SkillModeId,
): SkillModeSpec | undefined {
  return skillModesFor(unit, skill).find((m) => m.id === mode);
}

/**
 * The skill as one cast of it in `mode` resolves.
 *
 * Returns the skill untouched when no mode is given — a plain Smite is a
 * perfectly good cast, and it is what a caller that does not know about modes
 * (the AI, a harness) gets. An unoffered mode is also a no-op here; the
 * resolver is what refuses it, so this stays total.
 *
 * Rounded to the precision damage multipliers are authored to, for the same
 * reason `mastery.round2` is: this number is rendered.
 */
export function applySkillMode(
  unit: CombatUnit,
  skill: HeroSkill,
  mode: SkillModeId | undefined,
): HeroSkill {
  if (!mode) return skill;
  const spec = skillModeSpec(unit, skill, mode);
  if (!spec) return skill;

  const next: HeroSkill = { ...skill, mode };
  if (skill.damage) next.damage = Math.round(skill.damage * spec.strikeScale * 100) / 100;
  if (skill.allyHeal) {
    const healed = Math.round(skill.allyHeal * spec.healScale * 1000) / 1000;
    if (healed > 0) next.allyHeal = healed;
    else delete next.allyHeal;
  }
  return next;
}

/**
 * Whether pressing `skill` should ask a question before it selects anything.
 *
 * The choices to put to the player, or `null` when selection may go straight on:
 * the skill offers no choice, or one has already been made. Shared by the combat
 * HUD, so "pressing Smite asks, pressing it again after answering aims" is a
 * rule with a test rather than an `if` inside a component. Asking costs
 * nothing — the caller selects nothing and spends no action until a mode comes
 * back, so abandoning the question leaves the turn exactly as it was.
 */
export function modeQuestionFor(
  unit: CombatUnit,
  skill: HeroSkill,
  chosen?: SkillModeId,
): SkillModeSpec[] | null {
  if (chosen) return null;
  const modes = skillModesFor(unit, skill);
  return modes.length > 0 ? modes : null;
}
