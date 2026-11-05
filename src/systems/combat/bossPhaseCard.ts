import type { CombatUnit } from '@/models/types';
import { phaseAtTier, phasesFor } from '@/systems/combat/bossPhases';
import { bossPassiveDescription, bossPassiveName, phaseAnnounce, phaseName, phaseRule } from '@/data/templates/bossText';
import { unitName } from '@/data/templates/unitText';

/**
 * How a phased boss's current phase reads on the HUD, as plain data.
 *
 * One card per phase, read by the banner that announces a transition, the strip
 * that keeps the phase on screen for the rest of the fight and the model that
 * grows into it — so none of them can say a different thing about it. Pure and
 * React-free, the way `preparedDisplay` is.
 */

export interface PhaseCard {
  templateId: string;
  bossName: string;
  /** Zero-based phase index. */
  index: number;
  total: number;
  /** "I", "II", "III" — the strip's mark. */
  numeral: string;
  title: string;
  /** The rule the phase teaches. */
  rule: string;
  /** What the boss says as the phase turns, for a boss who speaks on his banner (`BossPhase.voiced`). */
  voice?: string;
  color: string;
  /** The signature rule the phase runs on, for the unit card's passive list. */
  passive: { name: string; description: string };
}

/**
 * Minimum time for a transition's picture to land. The announcement itself
 * remains on screen, and pacing stays paused, until the player acknowledges it.
 */
export const PHASE_BEAT_MS = 2200;

/**
 * The tone a boss's warned hexes are drawn in, by template. Unlisted bosses and
 * every ordinary enemy use the theme's default violet warning; a boss whose fight
 * has its own colour (Aethelred's is a deep red) names a tone here. A *name*, not
 * a colour: the overlay resolves it, so no call site passes a colour to the board.
 *
 * The archipelago's lanes take theirs by scripted kind (`boardOverlays.casterTone`): Varr's in his
 * own yellow, which no other warning wears, and the Redsail ship's in signal-flag red.
 */
export type WarningTone = 'crimson' | 'frost' | 'varr' | 'redsail';

const WARNING_TONES: Readonly<Record<string, WarningTone>> = {
  aethelred: 'crimson',
  // The Heart's blasts and chains are drawn in cold, apart from the violet of an ordinary warning
  heart_of_winter: 'frost',
};

export const warningToneFor = (templateId: string | undefined): WarningTone | undefined =>
  templateId ? WARNING_TONES[templateId] : undefined;

const NUMERALS = ['I', 'II', 'III', 'IV', 'V'];

/** Built when shown: its words are in the current language. */
export function phaseCardFor(
  unit: Pick<CombatUnit, 'templateId' | 'name' | 'bossPhase' | 'isPlayer'> & Partial<Pick<CombatUnit, 'challengeTier'>>,
): PhaseCard | undefined {
  const phases = phasesFor(unit.templateId);
  if (!phases) return undefined;
  const index = Math.min(phases.length - 1, unit.bossPhase ?? 0);
  const phase = phases[index];
  return {
    templateId: unit.templateId as string,
    bossName: unitName(unit),
    index,
    // A phase only a higher Seal tier lives (`BossPhase.fromTier`) is not counted below it
    total: phases.filter((p) => phaseAtTier(unit, p)).length,
    numeral: NUMERALS[index] ?? String(index + 1),
    title: phaseName(phase),
    rule: phaseRule(phase),
    ...(phase.voiced && { voice: phaseAnnounce(phase) }),
    color: phase.color,
    passive: { name: bossPassiveName(phase.passive), description: bossPassiveDescription(phase.passive) },
  };
}

/** How large the boss stands in its current phase, as a multiple of its authored model. */
export function phasePresence(unit: Pick<CombatUnit, 'templateId' | 'bossPhase'>): number {
  const phases = phasesFor(unit.templateId);
  if (!phases) return 1;
  return phases[Math.min(phases.length - 1, unit.bossPhase ?? 0)].presence;
}
