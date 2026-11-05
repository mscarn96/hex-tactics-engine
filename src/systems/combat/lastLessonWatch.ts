import type { CombatUnit, HeroSkill, LessonMemory } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import type { Flank } from '@/systems/combat/facing';
import {
  breaksFace, breaksPatience, isLastLesson, isRepeat, lastLessonOf, lessonMemory, noteCast, oweRebuke, oweRiposte,
} from '@/systems/combat/lastLessonRules';

/**
 * What the resolver tells the Last Lesson (`lastLessonRules`): which skill each of
 * the party cast, which blow he parries, and which blows broke a lesson.
 *
 * Kept apart from his script, which makes the strikes he owes and so needs the
 * resolver: this half is imported *by* the resolver and must not import it back.
 * Every function is a no-op without him on the board.
 */

function write(boss: CombatUnit, next: LessonMemory): void {
  useCombatStore.getState().patchBossScript(boss.id, { lesson: next });
}

const pupil = (caster: CombatUnit, boss: CombatUnit) => caster.isPlayer !== boss.isPlayer;

/**
 * Before a party unit's own cast: the Last Lesson's id when this cast repeats the
 * skill it used on its previous turn, so every blow of it that reaches him is parried.
 */
export function lessonParries(caster: CombatUnit, skill: HeroSkill): string | undefined {
  const boss = lastLessonOf(useCombatStore.getState().units);
  if (!boss || !pupil(caster, boss)) return undefined;
  return isRepeat(lessonMemory(boss), caster.id, skill.id) ? boss.id : undefined;
}

/** After a party unit's own cast went through: it is this turn's skill. */
export function noteLessonCast(caster: CombatUnit, skill: HeroSkill): void {
  const boss = lastLessonOf(useCombatStore.getState().units);
  if (!boss || !pupil(caster, boss)) return;
  write(boss, noteCast(lessonMemory(boss), caster.id, skill.id));
}

/** A parried blow: the riposte is owed and made once the cast is over. */
export function noteLessonParry(caster: CombatUnit, bossId: string): void {
  const boss = useCombatStore.getState().units.find((u) => u.id === bossId);
  if (!boss) return;
  write(boss, oweRiposte(lessonMemory(boss), caster.id));
}

/**
 * A blow landed on him: Face Your Master if it came from behind, Patience if it was
 * the round's first. Any party unit counts, a summon included — so a summon can
 * spend Patience for the party.
 */
export function noteLessonStrike(attacker: CombatUnit, target: CombatUnit, flank: Flank): void {
  if (!pupil(attacker, target)) return;
  const boss = useCombatStore.getState().units.find((u) => u.id === target.id);
  if (!boss || !isLastLesson(boss)) return;
  let memory = lessonMemory(boss);
  if (breaksFace(memory, flank)) memory = oweRebuke(memory, attacker.id, 'face');
  if (breaksPatience(memory)) memory = oweRebuke(memory, attacker.id, 'patience');
  if (!memory.struck) memory = { ...memory, struck: true };
  write(boss, memory);
}
