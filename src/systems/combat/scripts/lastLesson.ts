import type { CombatUnit, LessonMemory } from '@/models/types';
import { LESSON_RED, lessonRebuke, lessonRiposte, LESSONS, LessonId } from '@/data/templates/lastLesson';
import { useCombatStore } from '@/stores/combatStore';
import {
  beginPupilTurn, isLastLesson, judgeTurnsEnded, lastLessonOf, lessonMemory, lessonsNamed, nameLessons,
} from '@/systems/combat/lastLessonRules';
import { resolveSkillUse } from '@/systems/combat/skillResolution';
import { unitById } from '@/systems/combat/unitLookup';
import { supportIntent } from '@/systems/combat/soundIntents';
import type { CombatSink } from '@/systems/combat/combatSink';
import type { EncounterScript } from '@/systems/combat/encounterScript';
import { lessonName, lessonTeaches } from '@/data/templates/bossText';
import { unitName } from '@/data/templates/unitText';
import { t } from '@/i18n';

/**
 * Jadeveil: Silent Hall / Fallen Order — the Last Lesson.
 *
 * He chooses his blows by the ordinary scoring (a staff and a step behind his
 * pupil); what is his is the round around them:
 *
 * - **His turn begins**: he names the round's lesson — two in the final phase —
 *   in the log, over his head and on the banner (`bossRegistry` readout, `bossReadoutText.lessonWarnings`),
 *   before any hero after him acts.
 * - **A party unit's turn begins**: last turn's skill is remembered as such, and
 *   where it stands is noted for Stillness.
 * - **Between turns**: every turn that has ended is judged, and every strike he is
 *   owed — a riposte for a parried repeat (`lastLessonWatch`), a rebuke for a broken
 *   lesson — is made, at any reach, before the next unit acts.
 */

/** How far apart the clappers' two clacks fall when he names two lessons at once. */
const LESSON_CLACK_GAP_MS = 280;

const write = (boss: CombatUnit, lesson: LessonMemory) =>
  useCombatStore.getState().patchBossScript(boss.id, { lesson });

function nameRound(boss: CombatUnit, sink: CombatSink): void {
  const store = useCombatStore.getState();
  const final = (boss.bossPhase ?? 0) >= 1;
  const memory = nameLessons(lessonMemory(boss), final);
  store.patchBossScript(boss.id, { lesson: memory });
  const named = lessonsNamed(memory);
  named.forEach((lesson, i) => {
    sink.log(lessonTeaches(unitName(boss), lesson.id), LESSON_RED);
    // One clack of the clappers per lesson named: two, a beat apart, in his final phase
    sink.sound?.({ ...supportIntent(boss, { gesture: 'lesson' }), ...(i > 0 ? { delayMs: i * LESSON_CLACK_GAP_MS } : {}) });
  });
  sink.status(boss.position, named.map((l) => lessonName(l.id).toUpperCase()).join(' · '), LESSON_RED);
}

function strikeOwed(boss: CombatUnit, sink: CombatSink): void {
  const store = useCombatStore.getState();
  const memory = judgeTurnsEnded(lessonMemory(boss), boss, store.units);
  const owed = memory.owed;
  write(boss, { ...memory, owed: [] });
  for (const debt of owed) {
    const live = unitById(useCombatStore.getState().units, boss.id);
    const pupil = unitById(useCombatStore.getState().units, debt.unitId);
    if (!live || live.currentHp <= 0 || !pupil || pupil.currentHp <= 0) continue;
    if (debt.kind === 'riposte') {
      sink.log(t('bossLog.lesson.riposte', { name: unitName(live), target: unitName(pupil) }), LESSON_RED);
      resolveSkillUse(live, lessonRiposte, pupil.position, sink, { resolving: true });
    } else {
      const lesson = LESSONS[debt.lesson as LessonId];
      sink.log(lesson
        ? t('bossLog.lesson.rebuke', { name: unitName(live), target: unitName(pupil), lesson: lessonName(lesson.id) })
        : t('bossLog.lesson.rebukeUnnamed', { name: unitName(live), target: unitName(pupil) }), LESSON_RED);
      resolveSkillUse(live, lessonRebuke, pupil.position, sink, { resolving: true });
    }
  }
}

export const lastLessonScript: EncounterScript = {
  id: 'lastLesson',

  beginTurn(unit, sink) {
    const store = useCombatStore.getState();
    if (isLastLesson(unit)) {
      nameRound(unit, sink);
      return;
    }
    const boss = lastLessonOf(store.units);
    if (!boss || unit.isPlayer === boss.isPlayer || unit.objective) return;
    write(boss, beginPupilTurn(lessonMemory(boss), unit));
  },

  betweenTurns(sink) {
    const boss = lastLessonOf(useCombatStore.getState().units);
    if (boss) strikeOwed(boss, sink);
  },
};

