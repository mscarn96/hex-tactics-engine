import { AfflictionType, HeroSkill, SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';

/**
 * The new-faction elites' signature skills (`systems/combat/factionEliteKits` has the
 * rules, `factionEliteActions` and `factionEliteWarnings` put them on the board).
 *
 * Like `eliteSkills`, each has an id of its own, and four of them are only ever the
 * *payoff* of something already announced and never sit in a kit: the Burrowmother's
 * eruption, the Khan's per-arrival burst and the Colossus's collapse are what lands
 * through the shared resolver, so a hero's Dodge, defence, crit and on-hit rules answer
 * them exactly as they answer any other blow.
 */

// ── Burrowmother: Undermine ──────────────────────────────────────────────────

export const undermine: HeroSkill = {
  id: 'undermine',
  gesture: 'burrow',
  targetType: SkillTargetType.Self,
  range: 0,
  unlockLevel: 1,
  manaCost: 0,
  cooldown: BALANCE.UNDERMINE_COOLDOWN,
  vfxColor: '#d8b878', vfxAftermath: 'dust',
  vfxKind: 'nova',
  icon: 'grasping_earth',
};

/** What lands when the window is over. Never in a kit. */
export const undermineEruption: HeroSkill = {
  id: 'undermine_eruption',
  // The knock-up is the picture of the blow (`knockUpIds` on its effect), as Farthest Prey's is:
  // it throws the hero into the air for the beat and changes nothing about where they stand or
  // when they act. The plan leaves its meaning open; a Stun on the whole party was what the
  // first measurement found too heavy.
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: BALANCE.UNDERMINE_RADIUS,
  damage: BALANCE.UNDERMINE_DAMAGE,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#d8b878', vfxAftermath: 'dust',
  vfxKind: 'nova',
  icon: 'grasping_earth',
};

// ── Herd-Khan: Twin Raid ─────────────────────────────────────────────────────

export const twinRaid: HeroSkill = {
  id: 'twin_raid',
  targetType: SkillTargetType.Self,
  range: 0,
  unlockLevel: 1,
  manaCost: 0,
  cooldown: BALANCE.TWIN_RAID_COOLDOWN,
  vfxColor: '#e05040',
  vfxKind: 'nova',
  icon: 'dread_charge',
};

/** One arrival's burst. Never in a kit. */
export const twinRaidBurst: HeroSkill = {
  id: 'twin_raid_burst',
  targetType: SkillTargetType.Ring,
  range: 0,
  aoeRadius: BALANCE.TWIN_RAID_RADIUS,
  damage: BALANCE.TWIN_RAID_DAMAGE,
  damageType: 'physical',
  appliesEffect: {
    type: AfflictionType.Bleed,
    magnitude: BALANCE.TWIN_RAID_BLEED,
    duration: BALANCE.TWIN_RAID_BLEED_TURNS,
  },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#e05040',
  vfxKind: 'nova',
  icon: 'dread_charge',
};

// ── Rime Jarl: Jarl's Challenge ──────────────────────────────────────────────

export const jarlsChallenge: HeroSkill = {
  id: 'jarls_challenge',
  targetType: SkillTargetType.Single,
  range: BALANCE.CHALLENGE_RANGE,
  unlockLevel: 1,
  manaCost: 0,
  cooldown: BALANCE.CHALLENGE_COOLDOWN,
  vfxColor: '#bfe6f5',
  vfxKind: 'bolt',
  icon: 'challenge',
};

// ── Glacier Colossus: Glacial Tomb ───────────────────────────────────────────

export const glacialTomb: HeroSkill = {
  id: 'glacial_tomb',
  gesture: 'tomb',
  targetType: SkillTargetType.Single,
  range: BALANCE.TOMB_RANGE,
  unlockLevel: 1,
  manaCost: 0,
  cooldown: BALANCE.TOMB_COOLDOWN,
  vfxColor: '#7fe8ff',
  vfxKind: 'bolt',
  icon: 'ice_barrier',
};

/**
 * The collapse of a tomb nobody broke. The Chill is `exact`: it is a Chill even on a hero
 * already Chilled, never the shared Chill-to-Freeze upgrade. Never in a kit.
 */
export const tombCollapse: HeroSkill = {
  id: 'tomb_collapse',
  targetType: SkillTargetType.Single,
  range: 0,
  damage: BALANCE.TOMB_DAMAGE,
  scaling: 'magic',
  damageType: 'magic',
  appliesEffect: {
    type: AfflictionType.Chill,
    magnitude: 3,
    duration: BALANCE.TOMB_CHILL_TURNS,
    exact: true,
  },
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#7fe8ff',
  vfxKind: 'nova',
  icon: 'ice_barrier',
};

/** Every skill here, for the suites that walk the whole roster. */
export const FACTION_ELITE_SKILLS: HeroSkill[] = [
  undermine, undermineEruption,
  twinRaid, twinRaidBurst,
  jarlsChallenge,
  glacialTomb, tombCollapse,
];
