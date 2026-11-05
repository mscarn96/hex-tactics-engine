import type { HeroSkill } from '@/models/types';
import { hexDistance, type HexCoord } from '@/utils/hexUtils';

export const STEP_MS = 224;
export const KNIFE_DANCE_HOP_MS = 190;
export const KNIFE_DANCE_STRIKE_MS = 360;
export const KNIFE_DANCE_BEAT_MS = KNIFE_DANCE_HOP_MS + KNIFE_DANCE_STRIKE_MS;

/** A ground-level dash, then a held landing while its blade flies. */
export function knifeDancePose(route: readonly { x: number; z: number }[], elapsedMs: number) {
  const legs = route.length - 1;
  const leg = Math.min(Math.max(0, legs - 1), Math.floor(Math.max(0, elapsedMs) / KNIFE_DANCE_BEAT_MS));
  const from = route[leg], to = route[leg + 1] ?? from;
  const t = Math.min(1, Math.max(0, elapsedMs - leg * KNIFE_DANCE_BEAT_MS) / KNIFE_DANCE_HOP_MS);
  const eased = 1 - (1 - t) ** 2;
  return { x: from.x + (to.x - from.x) * eased, z: from.z + (to.z - from.z) * eased,
    lift: 0, done: elapsedMs >= legs * KNIFE_DANCE_BEAT_MS };
}
/** A bare hero's model height (the warrior's): what a rig's `bulk` is measured in. */
export const HERO_MODEL_HEIGHT = 1.61;
/** Bulk from which an unarmed body slams with both arms rather than punching. */
export const SLAM_BULK = 1.4;
export const ATTACK_MS = 620;
/**
 * Where in an attack every melee blow lands, as a share of `ATTACK_MS`: overhead, heavy, stab,
 * thrust, slam, lunge and a bird's strike all reach their target here, so one moment times the
 * slash's contact, the victim's recoil and the hit-stop whatever the weapon.
 */
export const SWING_CONTACT = 0.5;
export const SWING_CONTACT_MS = ATTACK_MS * SWING_CONTACT;
/** The freeze on a melee contact, attacker and victim both: the blow's weight. */
export const HITSTOP_MS = 70;
export const HIT_MS = 480;
export const KNOCK_UP_MS = 1000;
export const recoilMs = (skill: HeroSkill): number =>
  skill.id === 'farthest_prey' || skill.id === 'undermine' ? KNOCK_UP_MS : HIT_MS;
/**
 * One hex of a dash (`movement.mode === 'dash'`): a swift slide, not a stride. A dash
 * walked at `STEP_MS` read as the unit strolling across the arena (playtest 2026-10-09:
 * the Burrowmother surfacing six hexes away took over a second to get there).
 */
export const DASH_STEP_MS = 70;
/** How long a dash of `steps` hexes takes. */
export const dashMs = (steps: number): number => Math.max(0, Math.round(steps)) * DASH_STEP_MS;
/** A melee dash slides in before the slash is drawn on its victim. */
export const selfMoveLeadMs = (skill: HeroSkill, from: HexCoord, landing: HexCoord): number =>
  // Mantis Execution, Marked Prey's release and Flicker Cut cross to their prey on the dash's clock too
  skill.selfMove?.kind === 'dash' || skill.mantisCapstone === 'execution' || skill.mantisStage === 'release'
    || skill.blinksBehind === 'first'
    ? dashMs(hexDistance(from, landing)) : 0;

/** One takeoff, airborne crossing and landing; shared by body, impact and sound clocks. */
export const JUMP_MS = 800;
/** A dash drawn as one leap rather than walked: Boulder Leap and the Bear's Crushing Leap. */
export const leapsSelfMove = (skill: HeroSkill): boolean =>
  skill.id === 'boulder_leap' || skill.id === 'crushing_leap';
export const jumpLeadMs = (skill: HeroSkill): number =>
  leapsSelfMove(skill) || skill.id === 'farthest_prey' ? JUMP_MS : 0;

/**
 * The Hawk's Dive flight (`movement.mode === 'swoop'`): the whole flight, and the
 * moment in it the talons meet the victim — when the slash and the number land.
 */
export const SWOOP_MS = 1150;
export const SWOOP_CONTACT_MS = 520;
export const swoopLeadMs = (skill: HeroSkill): number => (skill.id === 'dive' ? SWOOP_CONTACT_MS : 0);

/**
 * Ancestral Hunt: the gap between its three spirits' contacts (Bear, then Wolf, then
 * Hawk). The resolver floats each spirit's numbers this far apart and the picture
 * strikes on the same clock.
 */
export const SPIRIT_BEAT_MS = 560;

/**
 * Living Stone's eruption (`upheaval`): the whole picture, and the moment its slabs
 * land — the beat its numbers and its shoves belong to. Here rather than in the
 * effect's clock table because the resolver times the pushed bodies on it too.
 */
export const UPHEAVAL_MS = 1400;
export const UPHEAVAL_IMPACT_MS = 620;
/** How long a shoved body takes to be thrown along its line once it goes. */
export const SHOVE_MS = 360;

/**
 * Blade Recall's pull (`extract`): the whole effect, and the share of it spent
 * tearing the blades out, which is the hit — its numbers land at the tear.
 */
export const EXTRACT_MS = 700;
export const EXTRACT_TEAR = 0.3;
