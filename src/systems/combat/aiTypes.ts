import type { HeroSkill, HexCoord } from '@/models/types';

/** What an enemy's brain hands the executor, and what it says about the choice. */

export interface AIAction {
  type: 'move' | 'skill' | 'endturn';
  targetPos?: HexCoord;
  /**
   * A move made as a dash (the Herd-Khan's first raid leg): slid swiftly along this
   * route (start excluded, landing included) rather than walked.
   */
  dash?: HexCoord[];
  skill?: HeroSkill;
  skillTarget?: HexCoord;
  /**
   * A scripted boss's rotation position once this action is done. Carried on the
   * action rather than written when it is *chosen*, so deciding stays free of
   * side effects and a turn the boss never gets to take does not advance it.
   */
  bossStep?: number;
}

/**
 * One skill the AI weighed, and what it came to.
 *
 * The score already existed — `findBestSkill` computed it for every candidate
 * and kept only the winner. Handing the whole table back is what makes a
 * baffling AI turn explicable in the tuning harness: a skill that is never
 * chosen is usually not broken, it is simply scoring below an at-will attack,
 * and that is invisible unless the losers are shown too.
 */
export interface AIConsideration {
  skillId: string;
  skillName: string;
  /** Expected value in damage-equivalent points; null when never scored. */
  value: number | null;
  targetPos?: HexCoord;
  /** Why it never got a score. */
  rejected?: 'unusable' | 'no-target';
}

export interface AITrace {
  unitId: string;
  unitName: string;
  /** Name of the unit whose taunt removed the choice, when one did. */
  forcedBy?: string;
  silenced?: boolean;
  considered: AIConsideration[];
  /** Human-readable summary of what was actually done. */
  chose: string;
  /**
   * The winning skill, named rather than described.
   *
   * `chose` is a display string and its shape varies by branch ("taunted —
   * Slash"), so anything trying to highlight the winner by parsing it gets the
   * taunt path wrong. This is the field to compare against.
   */
  choseSkillId?: string;
}

export interface SkillResult {
  skill: HeroSkill;
  targetPos: HexCoord;
  value: number;
}
