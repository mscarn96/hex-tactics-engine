import { HeroSkill, SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import type { BossPassive, BossPhase } from '@/data/templates/aethelred';

/**
 * The Last Lesson — the Silent Hall's boss, the Fallen Order's blind old master
 * (the private project notes).
 *
 * Two rules make the fight, and both are about what the party does rather than
 * what he does:
 *
 * - **Repetition is punished.** A hero who uses on him the skill they used on their
 *   own previous turn is parried — the blow deals nothing — and riposted.
 * - **Each round he names a lesson** at the start of his turn, before the heroes
 *   after him act, and rebukes whoever breaks it before his next turn. Under half
 *   health he names two at once.
 *
 * His own kit is modest on purpose: a walking staff and a step behind his pupil.
 * The rules are `systems/combat/lastLessonRules` (pure) and `lastLessonWatch`
 * (what the resolver tells him); the strikes he owes are made by
 * `systems/combat/scripts/lastLesson`.
 */

const L = BALANCE.LAST_LESSON;

export const LESSON_RED = '#e0443a';
const STAFF_BROWN = '#b08a5a';

// ── The lessons ──────────────────────────────────────────────────────────────

export type LessonId = 'face' | 'stillness' | 'patience' | 'distance';

/**
 * A lesson. Its words — the name he speaks, on the banner and in the log, and the
 * rule in one line a landscape phone can hold — are `bossSkills.lesson.<id>.*`,
 * read through `lessonName` and `lessonRule` (`bossText.ts`).
 */
export interface LessonDef {
  id: LessonId;
}

export const LESSONS: Record<LessonId, LessonDef> = {
  face: { id: 'face' },
  stillness: { id: 'stillness' },
  patience: { id: 'patience' },
  distance: { id: 'distance' },
};

/** The order he teaches them in, one step a round; the final phase speaks two at once. */
export const LESSON_ORDER: readonly LessonId[] = ['face', 'stillness', 'patience', 'distance'];

// ── His kit ──────────────────────────────────────────────────────────────────

/** Walking Staff: the old man's at-will, a rap of the staff. */
export const walkingStaff: HeroSkill = {
  id: 'lesson_staff',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: L.STAFF_DAMAGE,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: STAFF_BROWN, vfxAftermath: 'dust',
  delivery: 'blunt',
  icon: 'stone_fist',
};

/** Pilgrim's Step: his reposition — a blow, and he stands behind whoever took it. */
export const pilgrimStep: HeroSkill = {
  id: 'lesson_step',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: L.STEP_DAMAGE,
  damageType: 'physical',
  blinksBehind: 'after',
  unlockLevel: 1,
  manaCost: 0,
  cooldown: L.STEP_COOLDOWN,
  vfxColor: STAFF_BROWN, vfxAftermath: 'dust',
  delivery: 'blunt',
  icon: 'shadowstep',
};

/** The answer to a repeated skill: never on his bar, struck by his script at any reach. */
export const lessonRiposte: HeroSkill = {
  id: 'lesson_riposte',
  targetType: SkillTargetType.Single,
  range: 99,
  damage: L.RIPOSTE_DAMAGE,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: LESSON_RED, vfxKind: 'bolt',
  delivery: 'blunt',
  icon: 'stone_fist',
};

/** The answer to a broken lesson: never on his bar, struck by his script at any reach. */
export const lessonRebuke: HeroSkill = {
  id: 'lesson_rebuke',
  targetType: SkillTargetType.Single,
  range: 99,
  damage: L.REBUKE_DAMAGE,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: LESSON_RED, vfxKind: 'bolt',
  delivery: 'blunt',
  icon: 'stone_fist',
};

export const LESSON_SKILLS: HeroSkill[] = [walkingStaff, pilgrimStep];
/** Struck by the script, never chosen. */
export const LESSON_FOLLOW_UPS: HeroSkill[] = [lessonRiposte, lessonRebuke];

// ── Passives and phases ──────────────────────────────────────────────────────

export const LESSON_PASSIVES: BossPassive[] = [
  { id: 'same_mistake' },
  { id: 'last_lesson' },
];

export const LESSON_PHASES: BossPhase[] = [
  {
    id: 'lesson_lesson',
    threshold: 1.0,
    skills: LESSON_SKILLS,
    color: LESSON_RED,
    presence: 1,
    passive: LESSON_PASSIVES[0],
  },
  {
    id: 'lesson_last',
    threshold: L.FINAL_THRESHOLD,
    stats: { attack: L.FINAL_POWER },
    skills: LESSON_SKILLS,
    color: LESSON_RED,
    vfx: { kind: 'nova', scale: 1.4 },
    presence: 1.05,
    passive: LESSON_PASSIVES[1],
    // The lessons, the heroes' last skills and the rebukes owed carry over
    keepsScript: true,
  },
];
