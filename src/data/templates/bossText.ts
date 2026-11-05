import { hasMessage, t, type MessageKey } from '@/i18n';
import { entryText } from '@/i18n/dataText';
import { BALANCE } from '@/data/balanceConstants';
import type { BossPassive, BossPhase } from '@/data/templates/aethelred';
import type { LessonId } from '@/data/templates/lastLesson';

/**
 * The words of the bosses' own rules, read from the `bossSkills` namespace when
 * shown. Their skills read through the shared `skillName` / `skillDescription`
 * (`data/gameText.ts`); this is the rest of the kit: signature passives, phases
 * and the Last Lesson's lessons.
 */

/** A boss's signature passive's name ("The Legion Responds"). */
export const bossPassiveName = (passive: BossPassive) => entryText('bossSkills', `passive.${passive.id}`, 'name');
/** What a boss's signature passive does. */
export const bossPassiveDescription = (passive: BossPassive) => entryText('bossSkills', `passive.${passive.id}`, 'description');

/** A boss phase's name ("The Orb Collects"). */
export const phaseName = (phase: BossPhase) => entryText('bossSkills', `phase.${phase.id}`, 'name');
/** The line announced in the combat log the moment a phase begins. */
export const phaseAnnounce = (phase: BossPhase) => entryText('bossSkills', `phase.${phase.id}`, 'announce');
/** The rule a phase teaches, on its banner and strip. */
export const phaseRule = (phase: BossPhase) => entryText('bossSkills', `phase.${phase.id}`, 'rule');

/** The warned or scripted moves of the four Empire bosses, and the Jorōgumo's venom, each of which states its target rule. */
export const TARGET_RULE_IDS: readonly string[] = [
  // The Troll Chieftain
  'farthest_prey', 'warren_collapse', 'boundary_smash', 'bonebreaker_sweep',
  // Aethelred (both Foreclosures: the first and the final phase's)
  'imperial_cleave', 'foreclosure', 'foreclosure_final', 'chains_of_tribute', 'collateral_claim', 'crownfall',
  'the_realm_that_burned',
  // The Emerald Dragon
  'furnace_heart', 'cinder_rift', 'skyfire', 'wing_thrust', 'dragon_claw',
  // The Heart of Winter
  'creeping_winter', 'icebound_reprisal', 'whiteout_convergence',
  // Jadeveil: the Jorōgumo's attack from the canopy (not warned, but its rule is stated)
  'canopy_venom',
];

/**
 * The one sentence that says whom or where a warned or scripted move picks, ties included, or
 * undefined for a move with no stated rule. The script follows exactly this rule
 * (`targetRules.test.ts` pins each); the briefing and the warning banner repeat it.
 */
export const skillTargetRule = (skill: { id: string; textId?: string }): string | undefined => {
  const key = `bossSkills.${skill.textId ?? skill.id}.target`;
  return hasMessage(key) ? t(key as MessageKey) : undefined;
};

/** The name the Last Lesson speaks for a lesson ("Stillness"). */
export const lessonName = (id: LessonId) => entryText('bossSkills', `lesson.${id}`, 'name');
/** A lesson's rule in one line. */
export const lessonRule = (id: LessonId) => entryText('bossSkills', `lesson.${id}`, 'rule', { count: BALANCE.LAST_LESSON.STILLNESS_HEXES });
/** What the banner adds under every lesson: the rule that never changes. */
export const lessonRepeatRule = () => t('bossSkills.lesson.repeatRule');
/** The log line when he names a lesson. */
export const lessonTeaches = (name: string, id: LessonId) =>
  t('bossSkills.lesson.teaches', { name, lesson: lessonName(id), rule: lessonRule(id) });
/** The log line when the chained Heart of Winter feeds on its standing anchors (`beginHeartTurn`). */
export const heartAnchorFeed = (name: string, count: number, share: string) =>
  t('bossSkills.heart.anchorFeed', { name, count, share });
/** The float over him when he parries a repeated skill. */
export const parryText = () => t('bossSkills.parried');
