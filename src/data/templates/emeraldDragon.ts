import { HeroSkill, SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';

/**
 * The Emerald Dragon — the Wyrm's Hollow's boss, in the kit
 * the private project notes agreed.
 *
 * Kept out of `skillData.ts` for the reason `aethelred.ts` and `trollChieftain.ts`
 * are: these are his alone, the repeatable claw included. The skills are what the
 * party *reads* — names, shapes, damage, the preparations they raise. Which one
 * he picks, where each warning lands and what a broken launch costs him is
 * `systems/combat/dragonScript` and `dragonActions`.
 *
 * He has **no fixed cycle**: the Claw is what he does when nothing else is worth
 * a turn, and the four signatures are chosen by what the board offers
 * (`chooseDragonMove`) and rest after use. Breath is not a spell of his any more —
 * it is the flame wave that follows a Wing Thrust.
 *
 * Each move wears the Claw's or the old Breath's picture until its own is drawn
 * (`assets/icons/iconMap.ts` maps their ids to those two files).
 */

/**
 * The label of the Rift's burning ground (an `ArenaHazard.label`, the catalog key of its name):
 * Skyfire shelters whoever stands on ground bearing it (`PreparedSpec.shelter.onHazard`).
 */
export const CINDER_RIFT_LABEL = 'bossLog.hazard.cinderRift';
/** The crystal a Furnace Heart rides in on its carrier: breaking it is one of the warning's answers. */
export const FURNACE_HEART_KIND = 'furnace_heart';

const DRAGON_RED = '#ff4422';
const EMBER = '#ff8a1e';
const FLAME = '#ff6600';

// ── The repeatable move ──────────────────────────────────────────────────────

/**
 * Dragon Claw. A wide frontal arc: everything in a deep wedge in front of him is
 * struck. It is not a single-target fallback — a hero standing alone in front of
 * him is raked as surely as three in a row, and the wedge does not follow a hero
 * who steps out of it.
 */
export const dragonClaw: HeroSkill = {
  id: 'dragon_claw',
  contact: 'claw',
  targetType: SkillTargetType.Arc,
  range: 2,
  aoeRadius: 3,
  damage: BALANCE.DRAGON_CLAW_DAMAGE,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: DRAGON_RED, vfxAftermath: 'spatter',
  vfxKind: 'arc',
  delivery: 'natural',
};

// ── The four signatures ──────────────────────────────────────────────────────

/**
 * Wing Thrust: **instant**, and a fraction of the power it had as a warned attack
 * (40%). Two blows, drawn apart: the wing (damage and a shove along the arc), then
 * the flame wave — the old Breath — over the ground the heroes were thrown to as
 * well as the ground they were thrown from. There is no warning and no response
 * window, so it is the move that can be made while one of his warnings is open: a
 * body the shove puts on or across a Cinder Rift pays its fire.
 */
export const wingThrust: HeroSkill = {
  id: 'wing_thrust',
  gesture: 'wing',
  targetType: SkillTargetType.Arc,
  range: 3,
  aoeRadius: 3,
  damage: BALANCE.DRAGON_WING_DAMAGE,
  pushDistance: BALANCE.DRAGON_WING_PUSH,
  cooldown: BALANCE.DRAGON_WING_COOLDOWN,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: EMBER, vfxAftermath: 'dust',
  vfxKind: 'quake',
};

/**
 * The second blow of a Wing Thrust. Never cast on its own and not on his bar: the
 * landing runs it over the wave's footprint once the wing's shove has settled.
 */
export const flameWave: HeroSkill = {
  id: 'flame_wave',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: BALANCE.DRAGON_WING_PUSH,
  damage: BALANCE.DRAGON_WAVE_DAMAGE,
  scaling: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: FLAME, vfxAftermath: 'embers',
  vfxKind: 'nova',
};

/**
 * Cinder Rift: a marked line across the arena that erupts when the party has had
 * its turn and then burns, crossable at a price, until his next Skyfire lands. The
 * script chooses the line (`riftLine`), so this skill's own shape is only the picture.
 */
export const cinderRift: HeroSkill = {
  id: 'cinder_rift',
  targetType: SkillTargetType.Line,
  range: 8,
  damage: BALANCE.DRAGON_RIFT_DAMAGE,
  scaling: 'magic',
  // The whole party answers the line, whether or not a hero stands on it at the cast. A line
  // nobody stood on stokes his fire (`dragonHeat`, `EncounterScript.whiff`)
  prepares: { everyone: true, onWhiff: 'dragonHeat', answers: [{ kind: 'step' }] },
  cooldown: BALANCE.DRAGON_RIFT_COOLDOWN,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: EMBER, vfxAftermath: 'embers',
  vfxKind: 'ignite',
};

/**
 * Furnace Heart: he throws his burning heart onto the hero with the most health, and the party plays hot
 * potato with it. The crystal rides on its carrier wherever they go (`ObjectiveSpec.carrierId`), and after
 * five rounds of the heroes' turns it bursts on whoever holds it, striking them and everyone beside them,
 * and his fire climbs a step. If its carrier falls first it bursts at once on their hex: passing it is how a
 * dying carrier is saved. Any hero can strike the crystal without hurting the one beneath it; broken, it
 * burns him and quenches his fire. The script throws it (`dragonActions.castDragonMove`): this skill's own
 * shape is the burst.
 */
export const furnaceHeart: HeroSkill = {
  id: 'furnace_heart',
  targetType: SkillTargetType.Ring,
  range: 8,
  aoeRadius: BALANCE.DRAGON_HEART_RADIUS,
  damage: BALANCE.DRAGON_HEART_BURST,
  scaling: 'magic',
  // Carried: it rides on its hero, lands at once if they fall, and runs alongside his other warnings
  prepares: {
    windows: BALANCE.DRAGON_HEART_WINDOWS, everyone: true, carried: true, quenchedOnBreak: true,
    // Pass it before it outgrows its carrier, or break the crystal (and he burns, and his fire is quenched)
    answers: [{ kind: 'pass' }, { kind: 'cancel', objective: FURNACE_HEART_KIND }],
  },
  cooldown: BALANCE.DRAGON_HEART_COOLDOWN,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: DRAGON_RED, vfxAftermath: 'embers',
  vfxKind: 'meteor',
};

/**
 * Skyfire: the fight's test of preparation. He rears and prepares to launch; for
 * one full round a Stun, Silence, Freeze or Taunt cancels it and leaves him
 * exposed. Otherwise he flies up, burns the whole arena — except the ground of a
 * burning Cinder Rift, which shelters whoever stands on it — and comes down on the
 * far half, on a landing area marked at the cast; a hero standing there sprawls him.
 */
export const skyfire: HeroSkill = {
  id: 'skyfire',
  targetType: SkillTargetType.Self,
  range: 0,
  damage: BALANCE.DRAGON_SKYFIRE_DAMAGE,
  scaling: 'magic',
  // The trench: heroes standing on the burning Rift are below the flame and take none of it
  prepares: {
    interruptedBy: ['stun', 'silence', 'freeze'],
    tauntCancels: true,
    everyone: true,
    quenchedOnBreak: true,
    shelter: { onHazard: CINDER_RIFT_LABEL },
    // The whole arena burns, so there is no stepping out of it: the landing mark is the third answer
    answers: [{ kind: 'sprawl' }],
  },
  cooldown: BALANCE.DRAGON_SKYFIRE_COOLDOWN,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: DRAGON_RED, vfxAftermath: 'embers',
  vfxKind: 'ignite',
};

/** Skyfire's second impact: he comes down on the area marked at the cast. Not on his bar. */
export const skyfireLanding: HeroSkill = {
  id: 'skyfire_landing',
  contact: 'dragonLanding',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: BALANCE.DRAGON_LANDING_RADIUS,
  damage: BALANCE.DRAGON_LANDING_DAMAGE,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: DRAGON_RED, vfxAftermath: 'dust',
  vfxKind: 'quake',
};

/**
 * Pass the Heart: the party's answer to the carried Furnace Heart, on a hero's skill bar only while a pass
 * is legal (`dragonScript.passTargets`): the carrier hands it to an ally within reach, or an ally within
 * reach of the carrier takes it from them. It costs the action and nothing else; the burn starts again
 * from its first step and the countdown keeps running. It wears the Heart's own picture.
 */
export const passHeart: HeroSkill = {
  id: 'pass_heart',
  icon: 'furnace_heart',
  targetType: SkillTargetType.Single,
  range: BALANCE.DRAGON_HEART_PASS_RANGE,
  passesHeart: true,
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: EMBER,
  vfxKind: 'bolt',
};

/** The actions his fight puts on a hero's bar: the pass. */
export const DRAGON_PARTY_ACTIONS: HeroSkill[] = [passHeart];

/** What he casts for himself; the two follow-up blows are run by the landing. */
export const DRAGON_SKILLS: HeroSkill[] = [dragonClaw, wingThrust, cinderRift, furnaceHeart, skyfire];

/** The blows the landing runs that are not on his bar. */
export const DRAGON_FOLLOW_UPS: HeroSkill[] = [flameWave, skyfireLanding];
