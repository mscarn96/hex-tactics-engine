import { AfflictionType, HeroSkill, SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';

/**
 * The Draconic Host's kits: the summit approach's own, Kairen's chosen, bent by the
 * jade dragon's green orb (the private project notes).
 *
 * Every member's skills live here rather than in `skillData.ts`, the regular kits and
 * the two elites' signatures alike, so the faction is one file to read. The numbers
 * follow the frozen north's three rules (`skillData.ts`, "The four frozen-north
 * factions"): a cadence is spelled one lower, a status that must cost a turn one higher,
 * and a single-target cooldown skill out-damages its owner's at-will so the AI presses it.
 * Every tunable an elite's rule reads is `BALANCE.DRACONIC_HOST`.
 *
 * **The orb's light is a pale jade** (`JADE_LIGHT`), not the Empire's ember orange: the
 * Host fights on Jadeveil's green ground, and an effect drawn in a mid green is a hue
 * the ground already has. A bright mint core stands well clear of every Jadeveil and
 * green arena tile by value (`draconicHostFaction.test.ts`), and the glow kit derives a
 * darker halo and a white core from it (`glowPalette`), so the outline reads on bamboo
 * as on scree. No fire-mountain, no ash: the Wyrmling's Burn is jade flame.
 *
 * Until a skill has its own picture it borrows the nearest drawn one (`icon`), and
 * `icons.test.ts` lists it as awaiting art.
 */

/** The orb's light: every jade effect the Host casts. */
export const JADE_LIGHT = '#6effc4';
/** The orb's storm, for the Raijū's lightning: a pale jade-white, not the Drummer's blue. */
export const JADE_STORM = '#c8ffe4';
/** The Daitengu's wind, a pale sage-white that reads as air over green ground. */
export const JADE_GALE = '#e2fff0';

// ── Oni Brute ────────────────────────────────────────────────────────────────

/** The kanabō's at-will. Every blow moves what it hits. */
export const kanaboBlow: HeroSkill = {
  id: 'kanabo_blow',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.0,
  pushDistance: 1,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#e4e6ea', vfxAftermath: 'dust',
  delivery: 'blunt',
  icon: 'maul',
};

/**
 * The overhead crush: the shove is two hexes. It drove a hero into anything with a Stun
 * as well until the first measurement: beside any elite, two Brutes' crushes held the
 * harness party in Stuns for most of the fight (0 wins in 12), so the shove is the blow's
 * whole point and the Stun went.
 */
export const oniCrush: HeroSkill = {
  id: 'oni_crush',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.4,
  pushDistance: 2,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: JADE_LIGHT, vfxThemed: true, vfxAftermath: 'dust',
  vfxKind: 'slash',
  delivery: 'blunt',
  icon: 'troll_smash',
};

// ── Wyrmling ─────────────────────────────────────────────────────────────────

export const wyrmBite: HeroSkill = {
  id: 'wyrm_bite',
  contact: 'bite',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.0,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#e4e6ea',
  delivery: 'natural',
  icon: 'bite',
};

/** Bite plus Burn: the jade flame in the wyrm's throat goes in with the teeth. */
export const jadeFlameBite: HeroSkill = {
  id: 'jade_flame_bite',
  contact: 'bite',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.3,
  appliesEffect: { type: AfflictionType.Burn, magnitude: 0.3, duration: 3 },
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: JADE_LIGHT, vfxThemed: true, vfxAftermath: 'embers',
  vfxKind: 'slash',
  delivery: 'natural',
  icon: 'dragon_claw',
};

// ── Karasu-Tengu ─────────────────────────────────────────────────────────────

export const featherDart: HeroSkill = {
  id: 'feather_dart',
  targetType: SkillTargetType.Single,
  range: 4,
  damage: 0.8,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: JADE_LIGHT, vfxThemed: true,
  delivery: 'thrown',
  icon: 'throwing_blades',
};

/**
 * Throw, then gone to the next perch: the crow tengu never stays where it struck from.
 * A `retreat` of three hexes, the Steppe Archer's Parting Shot made a crow's.
 */
export const crowsFlit: HeroSkill = {
  id: 'crows_flit',
  targetType: SkillTargetType.Single,
  range: 4,
  damage: 1.0,
  selfMove: { kind: 'retreat', range: 3 },
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 1,
  vfxColor: JADE_LIGHT, vfxThemed: true,
  delivery: 'thrown',
  icon: 'hit_and_run',
};

// ── Raijū ────────────────────────────────────────────────────────────────────

export const raijuSpark: HeroSkill = {
  id: 'raiju_spark',
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.85,
  scaling: 'magic',
  damageType: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: JADE_STORM,
  vfxKind: 'lightning',
  icon: 'thunderbolt',
};

/** Chain lightning with Shock: the aimed hero and two more within two hexes of the last. */
export const raijuChain: HeroSkill = {
  id: 'raiju_chain',
  targetType: SkillTargetType.Chain,
  range: 3,
  chainJumps: 2,
  chainRange: 2,
  damage: 0.9,
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.Shock, magnitude: 1, duration: 3 },
  damageType: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  cooldown: 2,
  vfxColor: JADE_STORM, vfxAftermath: 'static',
  vfxKind: 'lightning',
  icon: 'chain_lightning',
};

// ── Oni Warlord ──────────────────────────────────────────────────────────────

export const warlordStrike: HeroSkill = {
  id: 'warlord_strike',
  targetType: SkillTargetType.Single,
  range: 1,
  damage: 1.0,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: '#e4e6ea', vfxAftermath: 'dust',
  delivery: 'blunt',
  icon: 'maul',
};

/**
 * The two-handed sweep: everything in a deep wedge in front of him. On a cooldown, so the
 * arc rule holds (`arcFootprint.test.ts`): only an elite's plain at-will may be an arc.
 */
export const twoHandedSweep: HeroSkill = {
  id: 'two_handed_sweep',
  targetType: SkillTargetType.Arc,
  range: 2,
  aoeRadius: 2,
  damage: 0.8,
  damageType: 'physical',
  unlockLevel: 1,
  manaCost: 0,
  cooldown: BALANCE.DRACONIC_HOST.SWEEP_COOLDOWN,
  vfxColor: JADE_LIGHT, vfxThemed: true, vfxAftermath: 'dust',
  vfxKind: 'arc',
  delivery: 'blunt',
  icon: 'obsidian_sweep',
};

/**
 * The Warlord's signature: a telegraphed Doom.
 *
 * He brands a circle of ground round a hero with the orb's mark, announced through the
 * shared warning (`prepares`): every hero standing in it owes a turn. Whoever is still in
 * it when it lands carries a Doom — nothing while it runs, and `DOOM_DAMAGE` x his Attack
 * the moment it expires a turn later. Three answers, in order: leave the circle, Stun,
 * Silence or Freeze him before it lands, or cleanse the Doom once it is on you.
 */
export const warlordsDoom: HeroSkill = {
  id: 'warlords_doom',
  targetType: SkillTargetType.Ring,
  range: BALANCE.DRACONIC_HOST.DOOM_RANGE,
  aoeRadius: BALANCE.DRACONIC_HOST.DOOM_RADIUS,
  appliesEffect: {
    type: AfflictionType.Doom,
    magnitude: BALANCE.DRACONIC_HOST.DOOM_DAMAGE,
    duration: BALANCE.DRACONIC_HOST.DOOM_TURNS,
  },
  prepares: { interruptedBy: ['stun', 'silence', 'freeze'], windows: 1, answers: [{ kind: 'step' }] },
  unlockLevel: 1,
  manaCost: 0,
  cooldown: BALANCE.DRACONIC_HOST.DOOM_COOLDOWN,
  vfxColor: JADE_LIGHT, vfxAftermath: 'motes',
  vfxKind: 'nova',
  icon: 'judgement',
};

// ── Daitengu ─────────────────────────────────────────────────────────────────

export const galeCut: HeroSkill = {
  id: 'gale_cut',
  spell: 'gale',
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 0.85,
  scaling: 'magic',
  damageType: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  vfxColor: JADE_GALE,
  vfxKind: 'bolt',
  icon: 'cyclone',
};

/** Silence: a hero who would cast is left with only their weapon for a turn. */
export const hushOfThePeaks: HeroSkill = {
  id: 'hush_of_the_peaks',
  spell: 'jade',
  targetType: SkillTargetType.Single,
  range: 3,
  damage: 1.05,
  scaling: 'magic',
  appliesEffect: { type: AfflictionType.Silence, magnitude: 1, duration: 2 },
  damageType: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  cooldown: BALANCE.DRACONIC_HOST.HUSH_COOLDOWN,
  vfxColor: JADE_LIGHT,
  vfxKind: 'bolt',
  icon: 'silencing_depths',
};

/**
 * The Daitengu's signature: a wind in an arc that pushes, announced a round ahead.
 *
 * The wedge is fixed at the cast through the shared warning, and the board draws where
 * each body will be blown to (`warnedPushes`). Whoever is still in it is struck and driven
 * `GALE_PUSH` hexes away from where he stood; a Stun, Silence or Freeze on him breaks it.
 */
export const greatGale: HeroSkill = {
  id: 'great_gale',
  spell: 'gale',
  targetType: SkillTargetType.Arc,
  range: 2,
  aoeRadius: BALANCE.DRACONIC_HOST.GALE_DEPTH,
  damage: BALANCE.DRACONIC_HOST.GALE_DAMAGE,
  scaling: 'magic',
  pushDistance: BALANCE.DRACONIC_HOST.GALE_PUSH,
  prepares: { interruptedBy: ['stun', 'silence', 'freeze'], windows: 1, answers: [{ kind: 'step' }] },
  damageType: 'magic',
  unlockLevel: 1,
  manaCost: 0,
  cooldown: BALANCE.DRACONIC_HOST.GALE_COOLDOWN,
  vfxColor: JADE_GALE, vfxAftermath: 'dust',
  vfxKind: 'arc',
  icon: 'cyclone',
};

/** The two elites' signatures, whose AI scoring and banner lines are the Host's own. */
export const DRACONIC_SIGNATURES = ['warlords_doom', 'great_gale'] as const;

/** Every skill here, for the suites that walk the whole roster. */
export const DRACONIC_HOST_SKILLS: HeroSkill[] = [
  kanaboBlow, oniCrush,
  wyrmBite, jadeFlameBite,
  featherDart, crowsFlit,
  raijuSpark, raijuChain,
  warlordStrike, twoHandedSweep, warlordsDoom,
  galeCut, hushOfThePeaks, greatGale,
];
