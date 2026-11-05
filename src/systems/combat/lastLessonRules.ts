import type { CombatUnit, HexCoord, LessonMemory, LessonScriptState } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { LESSON_ORDER, LESSONS, LessonDef, LessonId } from '@/data/templates/lastLesson';
import type { Flank } from '@/systems/combat/facing';
import { hexDistance } from '@/utils/hexUtils';

/**
 * The Last Lesson's rules, pure (`data/templates/lastLesson` is the kit).
 *
 * - **The same mistake.** Each party unit's skill is remembered per regular turn:
 *   `history[id].now` is this turn's, `last` the previous turn's. A cast whose skill
 *   is `last` and that strikes him is parried and owed a riposte.
 * - **The lessons.** Named at the start of his regular turn (`nextLessons`), standing
 *   until his next one. A breach is judged where it happens: a blow from behind
 *   (Face) or the round's first blow (Patience) as it lands, a turn's distance
 *   travelled (Stillness) or where it ended (Distance) once the turn is over.
 *   Each breach owes the breaker one rebuke, at most once per lesson per round.
 *
 * Everything the store writes is `lastLessonWatch` (from the resolver) and
 * `scripts/lastLesson` (his turn and between turns).
 */

const L = BALANCE.LAST_LESSON;

export const LAST_LESSON_ID = 'last_lesson';

export const isLastLesson = (unit: Pick<CombatUnit, 'templateId' | 'isPlayer'>): boolean =>
  !unit.isPlayer && unit.templateId === LAST_LESSON_ID;

export const freshLessonMemory = (): LessonMemory => ({
  named: [], taught: 0, struck: false, history: {}, turnStart: {}, owed: [], rebuked: [],
});

export const initialLessonScript = (): LessonScriptState => ({ step: 0, phaseTurns: 0, unharmedRounds: 0, lesson: freshLessonMemory() });

/** His memory, or a fresh one for a unit that has none yet. */
export function lessonMemory(unit: CombatUnit): LessonMemory {
  const script = unit.bossScript;
  return script && 'lesson' in script ? script.lesson : freshLessonMemory();
}

/** The living Last Lesson on the board, if any. */
export const lastLessonOf = (units: readonly CombatUnit[]): CombatUnit | undefined =>
  units.find((u) => u.currentHp > 0 && isLastLesson(u));

/** The lessons he names on his `taught`-th naming: one, or two in the final phase. */
export function nextLessons(taught: number, final: boolean): LessonId[] {
  const n = LESSON_ORDER.length;
  const first = LESSON_ORDER[taught % n];
  return final ? [first, LESSON_ORDER[(taught + 1) % n]] : [first];
}

export const lessonsNamed = (memory: LessonMemory): LessonDef[] =>
  memory.named.filter((id): id is LessonId => id in LESSONS).map((id) => LESSONS[id]);

const stands = (memory: LessonMemory, lesson: LessonId) => memory.named.includes(lesson);

/** Whether this cast repeats the skill the unit used on its previous turn. */
export const isRepeat = (memory: LessonMemory, unitId: string, skillId: string): boolean =>
  memory.history[unitId]?.last === skillId;

/** Face Your Master: a blow from his back or rear sides while the lesson stands. */
export const breaksFace = (memory: LessonMemory, flank: Flank): boolean =>
  stands(memory, 'face') && (flank === 'back' || flank === 'side');

/** Patience: the first blow to land on him since he named it. */
export const breaksPatience = (memory: LessonMemory): boolean => stands(memory, 'patience') && !memory.struck;

/** Stillness: a turn that ended more than `STILLNESS_HEXES` from where it began. */
export const breaksStillness = (memory: LessonMemory, from: HexCoord, to: HexCoord): boolean =>
  stands(memory, 'stillness') && hexDistance(from, to) > L.STILLNESS_HEXES;

/** Keep Your Distance: a turn that ended beside him. */
export const breaksDistance = (memory: LessonMemory, unit: CombatUnit, boss: CombatUnit): boolean =>
  stands(memory, 'distance') && hexDistance(unit.position, boss.position) === 1;

/**
 * The memory with a rebuke owed to `unitId` for `lesson`, unless that lesson has
 * already rebuked it this round.
 */
export function oweRebuke(memory: LessonMemory, unitId: string, lesson: LessonId): LessonMemory {
  const key = `${lesson}:${unitId}`;
  if (memory.rebuked.includes(key)) return memory;
  return {
    ...memory,
    rebuked: [...memory.rebuked, key],
    owed: [...memory.owed, { unitId, kind: 'rebuke', lesson }],
  };
}

/** The memory with a riposte owed to `unitId`, once however many blows of one cast he parried. */
export function oweRiposte(memory: LessonMemory, unitId: string): LessonMemory {
  if (memory.owed.some((o) => o.unitId === unitId && o.kind === 'riposte')) return memory;
  return { ...memory, owed: [...memory.owed, { unitId, kind: 'riposte' }] };
}

/** A regular turn of a party unit begins: this turn's skill becomes last turn's, and where it stands is noted. */
export function beginPupilTurn(memory: LessonMemory, unit: CombatUnit): LessonMemory {
  const entry = memory.history[unit.id];
  return {
    ...memory,
    history: { ...memory.history, [unit.id]: { last: entry?.now } },
    turnStart: { ...memory.turnStart, [unit.id]: { q: unit.position.q, r: unit.position.r } },
  };
}

/** A party unit cast a skill on its turn. */
export function noteCast(memory: LessonMemory, unitId: string, skillId: string): LessonMemory {
  const entry = memory.history[unitId] ?? {};
  return { ...memory, history: { ...memory.history, [unitId]: { ...entry, now: skillId } } };
}

/**
 * Judges every party unit whose regular turn has ended since it began: Stillness on
 * how far it ended from its start, Distance on whether it ended beside him. Run
 * between turns, so a start noted for a unit is always a turn that has since ended
 * (its own turn start notes it after this has run).
 */
export function judgeTurnsEnded(
  memory: LessonMemory,
  boss: CombatUnit,
  units: readonly CombatUnit[],
): LessonMemory {
  let next = memory;
  for (const [unitId, from] of Object.entries(memory.turnStart)) {
    const unit = units.find((u) => u.id === unitId);
    const { [unitId]: _judged, ...rest } = next.turnStart;
    next = { ...next, turnStart: rest };
    if (!unit || unit.currentHp <= 0) continue;
    if (breaksStillness(next, from, unit.position)) next = oweRebuke(next, unitId, 'stillness');
    if (breaksDistance(next, unit, boss)) next = oweRebuke(next, unitId, 'distance');
  }
  return next;
}

/** He names a new round's lessons: what was owed is kept, the round's record is not. */
export function nameLessons(memory: LessonMemory, final: boolean): LessonMemory {
  return {
    ...memory,
    named: nextLessons(memory.taught, final),
    taught: memory.taught + 1,
    struck: false,
    rebuked: [],
  };
}
