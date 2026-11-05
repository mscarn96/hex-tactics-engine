import { AfflictionType, EnemyTemplate } from "@/models/types";
import { BALANCE } from '@/data/balanceConstants';
import {
  bite,
  slash,
  rangedShot,
  charge,
  darkBolt,
  ghostTouch,
  raiseDead,
  cleave,
  hex,
  blight,
  web,
  venomBite,
  maul,
  cutpurse,
  rally,
  boneShards,
  arcaneBolt,
  poisonArrow,
  groundSlam,
  legionAdvance,
  shieldWall,
  plasmaOrb,
  obsidianSpikes,
  dreadCharge,
  runeDome,
  armorBreaker,
  meltAway,
  serratedDaggers,
  poisonedShot,
  mireGrasp,
  caveIn,
  blastingCharge,
  glassShot,
  scorpidSting,
  acidSpit,
  sandSquall,
  doubleSting,
  hoofKick,
  lanceThrust,
  runningLance,
  recurveShot,
  partingShot,
  thunderbeat,
  rollingThunder,
  glaiveSweep,
  spearJab,
  clubStrike,
  clubSweep,
  hurlIceBlock,
  rimeNote,
  shelterOfTheHold,
  winterHorn,
  axeHew,
  coldSpark,
  iceFist,
  frozenBulwark,
  shardShot,
  icicleLance,
  frostBolt,
  coldGrasp,
  snowblind,
  glacierHammer,
} from '@/data/skills/skillData';
import {
  briarBlight,
  fracturingBreaker,
  fractureSlam,
  mindControl,
  mireUndertow,
  warbandOrder,
  witchsGeas,
} from '@/data/skills/eliteSkills';
import { undermine, twinRaid, jarlsChallenge, glacialTomb } from '@/data/skills/factionEliteSkills';
import {
  kanaboBlow, oniCrush, wyrmBite, jadeFlameBite, featherDart, crowsFlit, raijuSpark, raijuChain,
  warlordStrike, twoHandedSweep, warlordsDoom, galeCut, hushOfThePeaks, greatGale,
} from '@/data/skills/draconicHostSkills';
import {
  noviceStaff, wardenStaff, wardenBastion, adeptCut, adeptFlicker, adeptPounce, sickleThrow, chainSnare,
  chanterMote, lanternHymn, abbotPalm, abbotFlicker, abbotGlowmote, abbotVow, bellStrike, tollOfPassing, greatRing,
} from '@/data/skills/fallenOrderSkills';
import {
  bellySlam, foxFlame, foxfire, kappaGrapple, kitsuneHush, kodamaRattle, shellBash,
  nueBlackThunder, nueClaws,
} from '@/data/skills/yokaiSkills';
import { AETHELRED_PHASES } from "./aethelred";
import { TROLL_PHASES } from "./trollChieftain";
import { DRAGON_SKILLS } from "./emeraldDragon";
import { HEART_PHASES } from "./heartOfWinter";
// Jadeveil: Kairen, the summit's boss
import { KAIREN_PHASES } from "./kairen";
// Jadeveil: Silent Hall / Fallen Order
import { LESSON_PHASES } from "./lastLesson";
// Jadeveil: Silk Hollow / Yokai
import { JOROGUMO_PHASES } from "./jorogumoWeaver";

/** State both defences so the lighter magic ward does not inherit physical armour. */
function bossDefences(defense: number) {
  return {
    defense: Math.round(defense * BALANCE.BOSS_PHYSICAL_DEFENSE_SCALE),
    magicDefense: Math.round(defense * BALANCE.BOSS_MAGIC_DEFENSE_SCALE),
  };
}

export const enemyTemplates: EnemyTemplate[] = [
  // ============ CHAFF ============
  //
  // The home ring, and the only fights a level-1 party of *one* hero is expected
  // to win. The game starts with a single hero, so band 0 has to be beatable by
  // a lone level-1 Arcanist at 70 HP and 6 attack — and two Orc Grunts at 70 HP
  // and 12 attack each, which is what band 0 used to field, simply is not.
  //
  // Deliberately feeble rather than merely small: low HP so one skill removes
  // one of them, low attack so a mistake costs a turn rather than a hero, and no
  // passives at all. Their job is to teach movement, range and turn order.
  {
    id: "goblin_whelp",
    tier: "normal",
    blow: "blade",
    baseStats: { maxHp: 22, attack: 5, defense: 1, magic: 0, speed: 9, moveRange: 3, maxMana: 0 },
    skills: [slash],
    xpReward: 10,
    goldReward: 5,
  },
  {
    id: "wolf_pup",
    tier: "normal",
    blow: "natural",
    // Fast, so it reaches you first and teaches that speed decides turn order —
    // and then does almost nothing when it gets there
    baseStats: { maxHp: 24, attack: 5, defense: 1, magic: 0, speed: 12, moveRange: 4, maxMana: 0 },
    skills: [bite],
    xpReward: 10,
    goldReward: 3,
  },
  {
    id: "footpad",
    tier: "normal",
    blow: "blade",
    baseStats: { maxHp: 28, attack: 6, defense: 2, magic: 0, speed: 8, moveRange: 3, maxMana: 0 },
    skills: [slash],
    xpReward: 12,
    goldReward: 9,
  },

  // ============ NORMAL ============
  {
    id: "goblin",
    tier: "normal",
    blow: "blade",
    baseStats: {
      maxHp: 40,
      attack: 8,
      defense: 4,
      magic: 2,
      speed: 10,
      moveRange: 3,
      maxMana: 0,
    },
    skills: [slash],
    xpReward: 20,
    goldReward: 10,
  },
  {
    id: "goblin_spearthrower",
    tier: "normal",
    blow: "reach",
    baseStats: {
      maxHp: 30,
      attack: 9,
      defense: 3,
      magic: 1,
      speed: 11,
      moveRange: 3,
      maxMana: 0,
    },
    skills: [slash, rangedShot],
    xpReward: 22,
    goldReward: 12,
  },
  {
    id: "skeleton_archer",
    tier: "normal",
    blow: "bow",
    baseStats: {
      maxHp: 35,
      attack: 10,
      defense: 3,
      magic: 2,
      speed: 9,
      moveRange: 2,
      maxMana: 0,
    },
    skills: [rangedShot],
    xpReward: 25,
    goldReward: 12,
  },
  {
    id: "wolf",
    tier: "normal",
    blow: "natural",
    baseStats: {
      maxHp: 45,
      attack: 9,
      defense: 3,
      magic: 1,
      speed: 13,
      moveRange: 4,
      maxMana: 0,
    },
    skills: [bite],
    // A wolf that closes distance strikes harder for it
    passives: ['momentum'],
    xpReward: 20,
    goldReward: 8,
  },
  {
    id: "bandit",
    tier: "normal",
    blow: "blade",
    baseStats: {
      maxHp: 50,
      attack: 10,
      defense: 6,
      magic: 2,
      speed: 8,
      moveRange: 3,
      maxMana: 0,
    },
    skills: [slash],
    xpReward: 25,
    goldReward: 15,
  },


  // ── Greenskins ─────────────────────────────────────────────────────────────
  {
    id: "goblin_shaman",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 32, attack: 5, defense: 3, magic: 12, speed: 10, moveRange: 2, maxMana: 0 },
    // The reason a goblin pack is more than the sum of its goblins
    skills: [hex, arcaneBolt],
    xpReward: 28,
    goldReward: 16,
  },
  {
    id: "orc_grunt",
    tier: "normal",
    blow: "blade",
    baseStats: { maxHp: 70, attack: 12, defense: 8, magic: 1, speed: 6, moveRange: 2, maxMana: 0 },
    skills: [slash, cleave],
    xpReward: 35,
    goldReward: 18,
  },

  // ── The Restless Dead ──────────────────────────────────────────────────────
  {
    id: "skeleton_warrior",
    tier: "normal",
    blow: "blade",
    baseStats: { maxHp: 48, attack: 11, defense: 7, magic: 1, speed: 8, moveRange: 3, maxMana: 0 },
    skills: [slash],
    // Bones do not bruise — it keeps swinging long after it should have stopped.
    //
    // Was `braced`, which grants defence for being hit *while taunting*. It has
    // no taunt and never will, so the passive was a line of text that never
    // fired. `retaliation` says the same thing and actually happens: hitting a
    // skeleton costs you something.
    passives: ['retaliation'],
    xpReward: 28,
    goldReward: 12,
  },
  {
    id: "skeleton_mage",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 34, attack: 4, defense: 4, magic: 14, speed: 9, moveRange: 2, maxMana: 0 },
    skills: [boneShards, arcaneBolt],
    xpReward: 32,
    goldReward: 18,
  },

  // ── Beasts ─────────────────────────────────────────────────────────────────
  {
    id: "dire_wolf",
    tier: "normal",
    blow: "natural",
    baseStats: { maxHp: 62, attack: 13, defense: 5, magic: 1, speed: 14, moveRange: 4, maxMana: 0 },
    skills: [bite, charge],
    passives: ['momentum'],
    xpReward: 34,
    goldReward: 14,
  },
  {
    id: "giant_spider",
    tier: "normal",
    blow: "natural",
    baseStats: { maxHp: 44, attack: 10, defense: 4, magic: 6, speed: 11, moveRange: 3, maxMana: 0 },
    // The one beast with an answer to a party that keeps its distance
    skills: [venomBite, web],
    xpReward: 32,
    goldReward: 14,
  },

  // ── Brigands ───────────────────────────────────────────────────────────────
  {
    id: "brigand_archer",
    tier: "normal",
    blow: "bow",
    baseStats: { maxHp: 40, attack: 11, defense: 4, magic: 2, speed: 11, moveRange: 3, maxMana: 0 },
    skills: [rangedShot, poisonArrow],
    xpReward: 30,
    goldReward: 20,
  },

  // ── The Fenfolk ────────────────────────────────────────────────────────────
  //
  // The swamp had nobody below band 2 — the Restless Dead start at 1 and the
  // Coven at 2 — so a marsh in the home ring fought whoever happened to wander
  // in from the plains. These are what lives there.
  {
    id: "fen_spawn",
    tier: "normal",
    blow: "blade",
    // Chaff, and therefore band 0, which is a much tighter brief than it looks:
    // no passives at all (the home ring forbids them), and two of these have to
    // leave a level-1 Arcanist at least six rounds to work with. Sits between
    // the Wolf Pup and the Footpad on every axis.
    baseStats: { maxHp: 26, attack: 5, defense: 2, magic: 0, speed: 10, moveRange: 3, maxMana: 0 },
    skills: [bite],
    xpReward: 12,
    goldReward: 6,
  },
  {
    id: "mire_wader",
    tier: "normal",
    blow: "blade",
    baseStats: { maxHp: 48, attack: 9, defense: 5, magic: 1, speed: 9, moveRange: 3, maxMana: 0 },
    // `mireGrasp` out-damages `slash`, which is the only reason the AI will ever
    // cast it — see the skill's own note. The cooldown is what keeps the plain
    // swing in the rotation.
    skills: [slash, mireGrasp],
    xpReward: 30,
    goldReward: 14,
  },
  {
    id: "reed_stalker",
    tier: "normal",
    blow: "bow",
    baseStats: { maxHp: 34, attack: 10, defense: 3, magic: 1, speed: 11, moveRange: 3, maxMana: 0 },
    skills: [rangedShot, poisonedShot],
    xpReward: 30,
    goldReward: 16,
  },
  {
    id: "silt_speaker",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 36, attack: 6, defense: 3, magic: 14, speed: 9, moveRange: 2, maxMana: 0 },
    skills: [arcaneBolt, blight],
    xpReward: 34,
    goldReward: 18,
  },
  {
    id: "bog_hulk",
    tier: "elite",
    blow: "blunt",
    baseStats: { maxHp: 132, attack: 16, defense: 7, magic: 2, speed: 7, moveRange: 3, maxMana: 0 },
    // Mire Undertow is its Ground Slam with a rider of its own: the marsh round it drags
    // whoever is still standing in it. The Club Strike, his mace, is the turn between
    // Mauls: Maul shoves and waits a turn, and at will it kept a lone melee hero
    // walking back to him for the whole fight (PT-14)
    skills: [clubStrike, maul, mireUndertow],
    // `lastBreath` had no owner anywhere in the game. A thing dragged out of a
    // marsh that will not accept having been killed is what it was written for.
    passives: ['lastBreath'],
    xpReward: 90,
    goldReward: 55,
  },

  // ── The Ashwood Coven ──────────────────────────────────────────────────────
  {
    id: "coven_thrall",
    tier: "normal",
    blow: "blade",
    // Not a skeleton. The Coven's bodies are people it took, which is the whole
    // reason the faction is unpleasant rather than merely dangerous.
    baseStats: { maxHp: 55, attack: 9, defense: 5, magic: 2, speed: 6, moveRange: 2, maxMana: 0 },
    skills: [slash],
    // Same dead-passive problem the Skeleton Warrior had: no taunt, so `braced`
    // could never fire. A thrall walks forward until it stops — `unstoppable`
    // is what that actually looks like.
    passives: ['unstoppable'],
    xpReward: 26,
    goldReward: 12,
  },
  {
    id: "hexer",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 38, attack: 4, defense: 4, magic: 16, speed: 10, moveRange: 2, maxMana: 0 },
    skills: [hex, blight],
    xpReward: 36,
    goldReward: 22,
  },

  // ============ ELITE ============

  {
    id: "orc_berserker",
    tier: "elite",
    blow: "blunt",
    baseStats: {
      maxHp: 100,
      attack: 16,
      defense: 8,
      magic: 2,
      speed: 7,
      moveRange: 3,
      maxMana: 0,
    },
    skills: [charge, slash],
    // A berserker feeds on the kill — the fight gets harder the worse it goes — and on the
    // pain: Pain Feast turns every blow it takes into Rage, and a full Rage into one wide,
    // bleeding, announced Slash
    passives: ['bloodscent', 'painFeast'],
    xpReward: 60,
    goldReward: 30,
  },
  {
    id: "dark_mage",
    tier: "elite",
    blow: "blunt",
    baseStats: {
      maxHp: 60,
      attack: 6,
      defense: 5,
      magic: 18,
      speed: 10,
      moveRange: 2,
      maxMana: 0,
    },
    // Mind Control is the Mage's own: a hero it marks fights for it for two turns, and it
    // rests for longer than that, so it can never hold one for good
    skills: [darkBolt, mindControl, raiseDead],
    xpReward: 65,
    goldReward: 35,
  },
  {
    id: "ghost",
    tier: "elite",
    blow: "natural",
    baseStats: {
      maxHp: 55,
      attack: 8,
      defense: 10,
      magic: 14,
      speed: 12,
      moveRange: 3,
      maxMana: 0,
    },
    skills: [ghostTouch],
    xpReward: 55,
    goldReward: 25,
  },

  {
    id: "orc_warchief",
    tier: "elite",
    blow: "blade",
    baseStats: { maxHp: 130, attack: 18, defense: 11, magic: 2, speed: 8, moveRange: 3, maxMana: 0 },
    // Rally is what makes a warchief worse than a bigger orc: kill it first, or
    // fight everything else at +5 attack for the rest of the battle. Warband Order is his
    // own: the Orcs of his warband converge on a hero he names, and he calls a Grunt if
    // none are left. `intimidating` came off: it reads a Taunt this kit can never lay
    skills: [cleave, rally, charge, warbandOrder],
    xpReward: 80,
    goldReward: 45,
  },
  {
    id: "revenant",
    tier: "elite",
    blow: "blade",
    baseStats: { maxHp: 95, attack: 15, defense: 9, magic: 8, speed: 9, moveRange: 3, maxMana: 0 },
    skills: [slash, boneShards],
    // Gets back up once, but not for free: Soul Fracture breaks it into three fragments
    // that race home, and the party decides how many arrive
    passives: ['soulFracture', 'retaliation'],
    xpReward: 75,
    goldReward: 40,
  },
  {
    id: "cave_bear",
    tier: "elite",
    blow: "natural",
    baseStats: { maxHp: 140, attack: 17, defense: 10, magic: 1, speed: 6, moveRange: 3, maxMana: 0 },
    // The Bite is the turn between Mauls: Maul shoves and waits a turn (PT-14)
    skills: [bite, maul, groundSlam],
    // Winter Sleep is the Bear's own: the first fatal blow puts it to sleep instead, and it
    // wakes at full health unless the party finishes it in the window
    passives: ['immovable', 'lastStand', 'winterSleep'],
    xpReward: 78,
    goldReward: 36,
  },
  {
    id: "brigand_captain",
    tier: "elite",
    blow: "blade",
    baseStats: { maxHp: 90, attack: 16, defense: 8, magic: 3, speed: 12, moveRange: 3, maxMana: 0 },
    // Captain's Authority is his own: every other ally fights with half again as much of every
    // stat while he lives, and his guard stands in front of him
    skills: [cutpurse, slash, rally],
    passives: ['frenzy', 'captainsAuthority'],
    xpReward: 70,
    goldReward: 60,
  },
  {
    id: "coven_matriarch",
    tier: "elite",
    blow: "blunt",
    baseStats: { maxHp: 75, attack: 5, defense: 6, magic: 22, speed: 10, moveRange: 2, maxMana: 0 },
    // Briar Claim is her own: her Blight plants a seed that grows into a Thrall unless the
    // party cleanses the poison or cuts it down. It replaces the generic Raise Dead and the
    // Lifebloom that could never fire from anything in her kit
    skills: [briarBlight, hex],
    xpReward: 85,
    goldReward: 55,
  },
  // Two more, and they exist for one measured reason: the Coven is the only
  // faction at band 4 away from the castle, and with three members it produced
  // *two* possible fights however many ways the shape table asked for them.
  // Shapes multiply a roster; they cannot conjure one.
  {
    id: "briar_shrike",
    tier: "normal",
    blow: "bow",
    // The Coven's first shooter. Its `ranged` slot used to fall through to the
    // Hexer, so every arrangement that wanted a skirmisher got another caster.
    baseStats: { maxHp: 42, attack: 12, defense: 4, magic: 6, speed: 12, moveRange: 3, maxMana: 0 },
    skills: [rangedShot, poisonedShot],
    xpReward: 40,
    goldReward: 26,
  },
  {
    id: "ashwood_crone",
    tier: "elite",
    blow: "blunt",
    baseStats: { maxHp: 82, attack: 5, defense: 6, magic: 20, speed: 9, moveRange: 2, maxMana: 0 },
    // Witch's Geas is hers: a curse on a hero's next spell, which still works and raises a
    // warned eruption round them
    skills: [hex, boneShards, web, witchsGeas],
    passives: ['undying'],
    xpReward: 82,
    goldReward: 52,
  },

  // ── The Delve ──────────────────────────────────────────────────────────────
  //
  // Exiles who went into the mountains after ore and did not come back the same.
  // No chaff: they start at band 1, so the chaff slot falls through to the front
  // line the way the Restless Dead's already does.
  {
    id: "delve_pickhand",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 46, attack: 10, defense: 5, magic: 1, speed: 8, moveRange: 3, maxMana: 0 },
    skills: [slash, armorBreaker],
    xpReward: 28,
    goldReward: 18,
  },
  {
    id: "delve_breaker",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 58, attack: 12, defense: 6, magic: 1, speed: 7, moveRange: 3, maxMana: 0 },
    skills: [slash, caveIn],
    xpReward: 34,
    goldReward: 20,
  },
  {
    id: "delve_slinger",
    tier: "normal",
    // A sling, drawn on the bow's grip: it slings stones (a `throw`), it does not loose arrows
    blow: "thrown",
    baseStats: { maxHp: 36, attack: 11, defense: 4, magic: 2, speed: 10, moveRange: 3, maxMana: 0 },
    skills: [rangedShot],
    xpReward: 30,
    goldReward: 20,
  },
  {
    id: "delve_alchemist",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 38, attack: 6, defense: 4, magic: 15, speed: 9, moveRange: 2, maxMana: 0 },
    skills: [arcaneBolt, blastingCharge],
    xpReward: 36,
    goldReward: 24,
  },
  {
    id: "delve_overseer",
    tier: "elite",
    blow: "blunt",
    baseStats: { maxHp: 124, attack: 17, defense: 8, magic: 3, speed: 8, moveRange: 3, maxMana: 0 },
    // Fracture is its own: Armour Breaker marks the ground under a hero, and the next Ground
    // Slam erupts round every marked hero too
    skills: [fracturingBreaker, fractureSlam],
    // `wrath` — +1 attack per 8% health missing — had no owner. A crew that is
    // starving at altitude and getting worse is precisely the brief, and pairing
    // it with `groundSlam`'s Taunt means the Overseer is most dangerous exactly
    // when it has pulled the party onto itself.
    passives: ['wrath'],
    xpReward: 88,
    goldReward: 60,
  },

  // ── The Sandscourge ────────────────────────────────────────────────────────
  //
  // The desert's own: it had no native faction at any band and borrowed the
  // plains' Greenskins and Brigands. Scorpion-kin under the sand — poison,
  // Defense Down and a Silence — at bands 1–3. Their kits are the shared
  // vocabulary (`skillData.ts`, "The four frozen-north factions"); the
  // Burrowmother's Undermine is `factionEliteSkills.ts`, and the Brute's Pincer Grab
  // waits for the battle epic, because nothing in the engine can pull a unit.
  {
    id: "sand_mite",
    tier: "normal",
    blow: "natural",
    // Chaff at band 1 and 2: a beetle with a bite and nothing else, and no
    // passives — what the Undermine spawns out of its vents.
    baseStats: { maxHp: 26, attack: 6, defense: 2, magic: 0, speed: 10, moveRange: 3, maxMana: 0 },
    skills: [bite],
    xpReward: 12,
    goldReward: 6,
  },
  {
    id: "scorpid_brute",
    tier: "normal",
    blow: "natural",
    baseStats: { maxHp: 54, attack: 11, defense: 6, magic: 1, speed: 8, moveRange: 3, maxMana: 0 },
    skills: [slash, scorpidSting],
    xpReward: 30,
    goldReward: 16,
  },
  {
    id: "glass_spitter",
    tier: "normal",
    blow: "natural",
    baseStats: { maxHp: 36, attack: 11, defense: 3, magic: 2, speed: 10, moveRange: 3, maxMana: 0 },
    skills: [glassShot, acidSpit],
    xpReward: 30,
    goldReward: 18,
  },
  {
    id: "dune_caller",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 36, attack: 5, defense: 3, magic: 14, speed: 9, moveRange: 2, maxMana: 0 },
    skills: [arcaneBolt, sandSquall],
    xpReward: 34,
    goldReward: 20,
  },
  {
    id: "burrowmother",
    tier: "elite",
    blow: "natural",
    baseStats: { maxHp: 120, attack: 16, defense: 8, magic: 3, speed: 8, moveRange: 3, maxMana: 0 },
    skills: [slash, doubleSting, undermine],
    xpReward: 85,
    goldReward: 50,
  },

  // ── The Thunder Herd ───────────────────────────────────────────────────────
  //
  // Centaur clans on the late plains and the highlands, bands 2–4. Fast, five
  // hexes to a move, and thin: very high speed and low defence, so they act
  // first and are worth catching. The plan's speeds are drafted as a share over
  // an ordinary unit of their level (+20% to +40%), set here against the roster's
  // ordinary 9–10. The Khan's Twin Raid is `factionEliteSkills.ts`.
  {
    id: "colt_runner",
    tier: "normal",
    blow: "natural",
    baseStats: { maxHp: 30, attack: 8, defense: 1, magic: 0, speed: 14, moveRange: 5, maxMana: 0 },
    skills: [hoofKick],
    xpReward: 14,
    goldReward: 8,
  },
  {
    id: "herd_lancer",
    tier: "normal",
    blow: "reach",
    baseStats: { maxHp: 52, attack: 12, defense: 3, magic: 1, speed: 12, moveRange: 5, maxMana: 0 },
    skills: [lanceThrust, runningLance],
    xpReward: 36,
    goldReward: 20,
  },
  {
    id: "steppe_archer",
    tier: "normal",
    blow: "bow",
    baseStats: { maxHp: 38, attack: 12, defense: 2, magic: 2, speed: 13, moveRange: 5, maxMana: 0 },
    skills: [recurveShot, partingShot],
    xpReward: 36,
    goldReward: 22,
  },
  {
    id: "storm_drummer",
    tier: "normal",
    blow: "blunt",
    // Quickening Rhythm is left out: it grants speed, and speed decides nothing
    // once a fight has started (`turnOrder` is sorted once). It arrives with the
    // battle plan's speed-based extra turns, which is the thing it buffs.
    baseStats: { maxHp: 36, attack: 4, defense: 2, magic: 15, speed: 11, moveRange: 4, maxMana: 0 },
    skills: [thunderbeat, rollingThunder],
    xpReward: 38,
    goldReward: 24,
  },
  {
    id: "herd_khan",
    tier: "elite",
    blow: "reach",
    baseStats: { maxHp: 115, attack: 17, defense: 5, magic: 3, speed: 13, moveRange: 5, maxMana: 0 },
    skills: [glaiveSweep, twinRaid],
    xpReward: 90,
    goldReward: 55,
  },

  // ── The Rime Jarls ─────────────────────────────────────────────────────────
  //
  // Frost giants and their thralls on the tundra, bands 2–4: few bodies, each a
  // wall. Slow, two hexes to a giant's move, high health and defence, and short
  // area attacks — they win by holding ground rather than by freezing it. The
  // Jarl's Challenge is `factionEliteSkills.ts`; he closes with the Champion's
  // shared Charge, which the plan gives him besides.
  {
    id: "hold_thrall",
    tier: "normal",
    blow: "reach",
    baseStats: { maxHp: 34, attack: 8, defense: 4, magic: 0, speed: 7, moveRange: 3, maxMana: 0 },
    skills: [spearJab],
    xpReward: 14,
    goldReward: 8,
  },
  {
    id: "rime_giantling",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 78, attack: 12, defense: 9, magic: 1, speed: 6, moveRange: 2, maxMana: 0 },
    skills: [clubStrike, clubSweep],
    xpReward: 40,
    goldReward: 20,
  },
  {
    id: "glacier_hurler",
    tier: "normal",
    blow: "blunt",
    // No attack but the throw, by design: the turn between throws is the raise.
    baseStats: { maxHp: 66, attack: 13, defense: 8, magic: 1, speed: 5, moveRange: 2, maxMana: 0 },
    skills: [hurlIceBlock],
    xpReward: 42,
    goldReward: 22,
  },
  {
    id: "rime_skald",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 60, attack: 5, defense: 7, magic: 14, speed: 6, moveRange: 2, maxMana: 0 },
    skills: [rimeNote, shelterOfTheHold, winterHorn],
    xpReward: 42,
    goldReward: 24,
  },
  {
    id: "rime_jarl",
    tier: "elite",
    blow: "blade",
    baseStats: { maxHp: 155, attack: 18, defense: 12, magic: 3, speed: 6, moveRange: 2, maxMana: 0 },
    skills: [axeHew, charge, jarlsChallenge],
    xpReward: 100,
    goldReward: 60,
  },

  // ── The Hoarfrost ──────────────────────────────────────────────────────────
  //
  // Living ice, the Heart of Winter's own, met only inside the ice lair
  // (`Faction.lairOnly`) at band 4. Chill, Freeze and the Chill-to-Freeze
  // escalation every source of Chill shares. The Mote shatters when it dies
  // (`deathBurst`, stated by its `frostBurst` passive): a cold blast on the heroes
  // beside it, Chilling them. The Sentinel's icy footsteps still wait: the engine
  // has no ground that remembers being walked on. The Colossus's Glacial Tomb is
  // `factionEliteSkills.ts`. Their damage stat was raised about a quarter across
  // the five (playtest 2026-10-23b: the cold hit too softly); verify in playtest.
  {
    id: "frost_mote",
    tier: "normal",
    blow: "natural",
    baseStats: { maxHp: 24, attack: 2, defense: 2, magic: 14, speed: 10, moveRange: 3, maxMana: 0 },
    skills: [coldSpark],
    passives: ['frostBurst'],
    deathBurst: {
      radius: BALANCE.FROST_MOTE_BURST.RADIUS,
      amount: BALANCE.FROST_MOTE_BURST.AMOUNT,
      scaling: 'magic',
      damageType: 'magic',
      color: '#bfe6f5',
      aftermath: 'rime',
      effect: { type: AfflictionType.Chill, magnitude: BALANCE.FROST_MOTE_BURST.CHILL, duration: BALANCE.FROST_MOTE_BURST.CHILL_TURNS },
    },
    xpReward: 14,
    goldReward: 6,
  },
  {
    id: "frost_sentinel",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 96, attack: 16, defense: 13, magic: 2, speed: 7, moveRange: 3, maxMana: 0 },
    skills: [iceFist, frozenBulwark],
    xpReward: 46,
    goldReward: 22,
  },
  {
    id: "shardcaster",
    tier: "normal",
    blow: "bow",
    baseStats: { maxHp: 40, attack: 16, defense: 4, magic: 2, speed: 9, moveRange: 3, maxMana: 0 },
    skills: [shardShot, icicleLance],
    xpReward: 42,
    goldReward: 24,
  },
  {
    id: "hoarfrost_wraith",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 44, attack: 3, defense: 4, magic: 21, speed: 10, moveRange: 3, maxMana: 0 },
    skills: [frostBolt, coldGrasp, snowblind],
    xpReward: 44,
    goldReward: 26,
  },
  {
    id: "glacier_colossus",
    tier: "elite",
    blow: "blunt",
    baseStats: { maxHp: 170, attack: 22, defense: 14, magic: 8, speed: 5, moveRange: 2, maxMana: 0 },
    skills: [glacierHammer, glacialTomb],
    xpReward: 110,
    goldReward: 60,
  },

  // ── The Draconic Host ──────────────────────────────────────────────────────
  //
  // Jadeveil's summit approach, bands 3–4: Kairen's chosen, shaped by the jade
  // dragon's green orb. No chaff, as the Legion has none: the Host is never met
  // low enough to need it. Every member sits a step over the frozen north's at
  // its role and short of the Legion's — the Legion is an army that took the
  // world, the Host a god's household. Kits and the two elites' signatures are
  // `draconicHostSkills.ts`; the Warlord's Doom and the Daitengu's Great Gale
  // ride the shared warning (`prepares`), scored by `draconicHostAI.ts`.
  {
    id: "oni_brute",
    tier: "normal",
    blow: "blunt",
    // Health and weight over speed: every blow shoves, so it holds the line by
    // moving the party off it rather than by standing in it
    baseStats: { maxHp: 82, attack: 12, defense: 9, magic: 1, speed: 6, moveRange: 3, maxMana: 0 },
    skills: [kanaboBlow, oniCrush],
    // The Brutes lead; the Tengu, the Raijū and the Daitengu keep behind them
    formation: 'line',
    xpReward: 48,
    goldReward: 24,
  },
  {
    id: "wyrmling",
    tier: "normal",
    blow: "natural",
    baseStats: { maxHp: 82, attack: 15, defense: 8, magic: 6, speed: 10, moveRange: 4, maxMana: 0 },
    skills: [wyrmBite, jadeFlameBite],
    xpReward: 46,
    goldReward: 24,
  },
  {
    id: "karasu_tengu",
    tier: "normal",
    // Its talons are its own blow; the feathers it throws say so on the skills
    blow: "natural",
    // Quick and thin: it acts early, throws and is gone to the next perch
    baseStats: { maxHp: 54, attack: 15, defense: 4, magic: 3, speed: 13, moveRange: 4, maxMana: 0 },
    skills: [featherDart, crowsFlit],
    formation: 'behind',
    xpReward: 46,
    goldReward: 26,
  },
  {
    id: "raiju",
    tier: "normal",
    blow: "natural",
    baseStats: { maxHp: 68, attack: 6, defense: 6, magic: 18, speed: 12, moveRange: 4, maxMana: 0 },
    skills: [raijuSpark, raijuChain],
    formation: 'behind',
    xpReward: 48,
    goldReward: 28,
  },
  {
    id: "oni_warlord",
    tier: "elite",
    blow: "blunt",
    baseStats: { maxHp: 158, attack: 17, defense: 12, magic: 4, speed: 6, moveRange: 2, maxMana: 0 },
    skills: [warlordStrike, twoHandedSweep, warlordsDoom],
    xpReward: 115,
    goldReward: 65,
  },
  {
    id: "daitengu",
    tier: "elite",
    blow: "blunt",
    baseStats: { maxHp: 135, attack: 9, defense: 8, magic: 17, speed: 10, moveRange: 4, maxMana: 0 },
    skills: [galeCut, hushOfThePeaks, greatGale],
    formation: 'behind',
    xpReward: 115,
    goldReward: 65,
  },
  // ── The Fallen Order (Jadeveil) ────────────────────────────────────────────
  //
  // The monks who taught the Monk's stances, on the shrine ground and the mist
  // ridges at bands 1–3. One monk body in three disciplines: the Beetle guards
  // by standing between (no Taunt), the Mantis moves and bleeds, the Firefly
  // mends. The Abbot carries a technique of each in one kit and changes no form;
  // the Bell-Keeper tolls a Doom that is lifted when it falls. Kits and their
  // reasons are `fallenOrderSkills.ts`, their rules `fallenOrderKits.ts`.
  {
    id: "order_novice",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 30, attack: 7, defense: 2, magic: 0, speed: 9, moveRange: 3, maxMana: 0 },
    skills: [noviceStaff],
    xpReward: 12,
    goldReward: 7,
  },
  {
    id: "beetle_warden",
    tier: "normal",
    blow: "reach",
    // Slow and thick. Retaliation is its reaction: a share of every blow it takes,
    // its Bastion's half of a monk's included, goes back at whoever landed it.
    baseStats: { maxHp: 74, attack: 11, defense: 9, magic: 2, speed: 7, moveRange: 3, maxMana: 0 },
    skills: [wardenStaff, wardenBastion],
    passives: ['retaliation'],
    // It leads, and the Chanter keeps behind it until it has engaged
    formation: 'line',
    xpReward: 38,
    goldReward: 20,
  },
  {
    id: "mantis_adept",
    tier: "normal",
    blow: "blade",
    baseStats: { maxHp: 48, attack: 13, defense: 3, magic: 1, speed: 12, moveRange: 4, maxMana: 0 },
    skills: [adeptCut, adeptFlicker, adeptPounce],
    xpReward: 36,
    goldReward: 20,
  },
  {
    id: "chain_sickle_monk",
    tier: "normal",
    blow: "blade",
    baseStats: { maxHp: 40, attack: 12, defense: 3, magic: 1, speed: 10, moveRange: 3, maxMana: 0 },
    skills: [sickleThrow, chainSnare],
    xpReward: 36,
    goldReward: 22,
  },
  {
    id: "firefly_chanter",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 40, attack: 4, defense: 3, magic: 13, speed: 9, moveRange: 3, maxMana: 0 },
    skills: [chanterMote, lanternHymn],
    formation: 'behind',
    xpReward: 38,
    goldReward: 24,
  },
  {
    id: "fallen_abbot",
    tier: "elite",
    blow: "blunt",
    baseStats: { maxHp: 140, attack: 16, defense: 8, magic: 12, speed: 10, moveRange: 3, maxMana: 0 },
    skills: [abbotPalm, abbotFlicker, abbotGlowmote, abbotVow],
    xpReward: 95,
    goldReward: 55,
  },
  {
    id: "bell_keeper",
    tier: "elite",
    blow: "blunt",
    baseStats: { maxHp: 135, attack: 14, defense: 8, magic: 15, speed: 7, moveRange: 2, maxMana: 0 },
    skills: [bellStrike, tollOfPassing, greatRing],
    xpReward: 95,
    goldReward: 55,
  },
  // ── Jadeveil: Silent Hall / Fallen Order ──────────────────────────────────
  {
    id: "last_lesson",
    tier: "boss",
    blow: "blunt",
    /**
     * The Silent Hall's boss (`data/templates/lastLesson`): a blind old master whose
     * fight is two rules — a repeated skill is parried and riposted, and each round's
     * named lesson rebukes whoever breaks it. His own kit is a staff and a step.
     *
     * The highest lair gate (92), so the strongest lair boss by the
     * `lairBosses.test.ts` weight (`maxHp + 5 x the larger of attack and magic`):
     * above the Heart of Winter and the Silk Hollow's boss. A first estimate, to be
     * retuned from play.
     */
    baseStats: {
      maxHp: 2700,
      attack: 46,
      ...bossDefences(16),
      magic: 20,
      speed: 11,
      moveRange: 3,
      maxMana: 0,
    },
    skills: LESSON_PHASES[0].skills,
    // Rooted in his stance: nothing shoves the master off his ground
    passives: ['immovable'],
    xpReward: 260,
    goldReward: 185,
    lootTable: [{ templateId: "silent_lesson_staff", weight: 1 }],
  },
  // ── The Yokai of the low forest (Jadeveil) ─────────────────────────────────
  //
  // Bamboo forest and terraced slope, bands 0–2: "nothing here is what it looks
  // like" (the private project notes). Numbers sit beside the
  // Greenskins and the Beasts, the Empire's band-0–2 rosters: a Kodama is a whelp,
  // the front line a goblin-to-grunt, the Jorōgumo a Bog Hulk's weight whose bite is
  // the fight. Her web volley and its bite are `yokaiSkills.ts`, turned by
  // `systems/combat/scripts/yokai`.
  {
    id: "kodama",
    tier: "normal",
    blow: "natural",
    // Weak and quick: its blow shoves, so the first fight in the range teaches that
    // where a hero stands is something the enemy can change
    baseStats: { maxHp: 20, attack: 5, defense: 1, magic: 0, speed: 10, moveRange: 4, maxMana: 0 },
    skills: [kodamaRattle],
    xpReward: 12,
    goldReward: 6,
  },
  {
    id: "kappa",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 58, attack: 11, defense: 7, magic: 1, speed: 7, moveRange: 3, maxMana: 0 },
    skills: [shellBash, kappaGrapple],
    xpReward: 32,
    goldReward: 18,
  },
  {
    id: "tanuki",
    tier: "normal",
    blow: "blunt",
    // Thin for a front-liner: what keeps it standing is that a hit hides it
    baseStats: { maxHp: 50, attack: 11, defense: 4, magic: 2, speed: 9, moveRange: 3, maxMana: 0 },
    skills: [bellySlam],
    passives: ['tanukiTrick'],
    xpReward: 32,
    goldReward: 20,
  },
  {
    id: "onibi",
    tier: "normal",
    blow: "natural",
    baseStats: { maxHp: 28, attack: 2, defense: 2, magic: 12, speed: 10, moveRange: 3, maxMana: 0 },
    skills: [foxfire],
    xpReward: 30,
    goldReward: 18,
  },
  {
    id: "kitsune",
    tier: "normal",
    blow: "natural",
    baseStats: { maxHp: 34, attack: 3, defense: 3, magic: 13, speed: 12, moveRange: 4, maxMana: 0 },
    skills: [foxFlame, kitsuneHush],
    xpReward: 34,
    goldReward: 22,
  },
  // ── Jadeveil: Silk Hollow / Yokai ──────────────────────────────────────────
  {
    id: "nue",
    tier: "elite",
    blow: "natural",
    /**
     * The Yokai's roaming elite since the shrine campaign
     * (the private project notes): a chimera in a black thundercloud.
     * Heroes beside it are Shocked at its turn start, the hero behind it is bitten by
     * its snake tail, and Black Thunder hides it in its cloud. Sized beside the
     * Jorōgumo it replaces (150 health, 16 attack): verify in playtest.
     */
    baseStats: { maxHp: 160, attack: 16, defense: 7, magic: 14, speed: 11, moveRange: 4, maxMana: 0 },
    skills: [nueClaws, nueBlackThunder],
    passives: ['nueThundercloud', 'nueSerpentTail'],
    xpReward: 90,
    goldReward: 55,
  },

  // ── The Obsidian Legion ────────────────────────────────────────────────────
  //
  // The only roster that fights as a unit. Every other faction is individuals
  // who happen to be standing together; the Legion has a front line that makes
  // you engage it, a wall that hardens the front line, and shock troops that
  // come through whatever gap that opens.
  //
  // Deliberately above the curve at every tier. These are the soldiers who took
  // the world, they only appear at the two worst threat bands, and the tribute
  // clock is the reason you meet them before you are ready.
  {
    id: "obsidian_infantry",
    tier: "normal",
    blow: "blade",
    // Defence is the stat, not health: it makes the party's small hits worthless
    // and rewards the one big swing, which is what fighting a phalanx should be
    baseStats: { maxHp: 148, attack: 21, defense: 18, magic: 3, speed: 6, moveRange: 3, maxMana: 0 },
    skills: [legionAdvance, shieldWall, slash],
    passives: ['braced'],
    // The line: it leads the advance, and the Stalker and the Arcanist keep behind it
    // until it has engaged (playtest PT-12)
    formation: 'line',
    xpReward: 48,
    goldReward: 26,
  },
  {
    id: "blood_iron_arcanist",
    tier: "normal",
    blow: "blunt",
    baseStats: { maxHp: 107, attack: 8, defense: 10, magic: 33, speed: 9, moveRange: 3, maxMana: 0 },
    skills: [plasmaOrb, obsidianSpikes],
    formation: 'behind',
    xpReward: 52,
    goldReward: 30,
  },
  {
    id: "blood_thirster_stalker",
    tier: "normal",
    blow: "blade",
    // Fast and fragile: the one Legion unit you can actually kill quickly, and
    // the one that punishes you hardest for leaving somebody wounded
    baseStats: { maxHp: 99, attack: 25, defense: 6, magic: 3, speed: 15, moveRange: 4, maxMana: 0 },
    skills: [serratedDaggers, meltAway],
    passives: ['bloodscent'],
    // It comes through the gap the line opens, not ahead of it (PT-12)
    formation: 'behind',
    xpReward: 50,
    goldReward: 28,
  },
  {
    id: "runeguard_sentinel",
    tier: "elite",
    blow: "blunt",
    baseStats: { maxHp: 264, attack: 23, defense: 23, magic: 10, speed: 4, moveRange: 2, maxMana: 0 },
    skills: [runeDome, armorBreaker],
    formation: 'line',
    // It does not move and it cannot be moved — a wall that a push could shove
    // out of the way is not a wall.
    //
    // `braced` came off for the same reason as the skeletons': it has no taunt,
    // so the defence it promised for holding the line never arrived.
    passives: ['immovable', 'retaliation'],
    xpReward: 105,
    goldReward: 60,
  },
  {
    id: "dread_knight",
    tier: "elite",
    blow: "reach",
    baseStats: { maxHp: 239, attack: 35, defense: 17, magic: 7, speed: 11, moveRange: 4, maxMana: 0 },
    skills: [dreadCharge, slash],
    // Nothing stops the charge, and the charge is worth more the further it came
    passives: ['unstoppable', 'momentum'],
    xpReward: 110,
    goldReward: 65,
  },

  // ============ BOSS ============
  {
    id: "dragon",
    tier: "boss",
    blow: "natural",
    baseStats: {
      // Once twice the Warren's boss in health (830), with the kit's bigger multipliers on
      // top: at a flat 2x attack the sim pair dies in six turns. Trimmed 10% from 1,660 after
      // a playtest found the fight dragging, then nerfed to about 1.45x health and the troll's
      // attack (2026-10-19); his magic and defences still outweigh the troll's.
      maxHp: 1200,
      attack: 15,
      ...bossDefences(10),
      magic: 15,
      speed: 6,
      moveRange: 2,
      maxMana: 0,
    },
    skills: DRAGON_SKILLS,
    // Digs in when wounded, and nothing shoves a dragon around
    passives: ['lastStand', 'immovable', 'risingFire'],
    xpReward: 200,
    goldReward: 150,
    lootTable: [{ templateId: "dragon_scale_armor", weight: 1 }],
  },
  {
    id: "troll_chieftain",
    tier: "boss",
    blow: "blunt",
    /**
     * The Warren's boss, tuned for the party that will really fight it — **two
     * heroes at level 8–12** — rather than to the plan's ~1,500 encounter HP,
     * which assumed a smaller party: `maxHp` is 750 and the combat engine scales
     * it by `(1 + 0.15 × (average party level − 1))` and the lair's band power
     * (1.25), so about 2,200 encounter HP for a pair at level 10 (1,900 at 8,
     * 2,400 at 12) and about 1,350 for the
     * level-4 pair the gate (8) admits. Health and attack were cut about 10% on
     * 2026-10-24 (from 830 and 16) once regeneration made the pair's damage stick
     * less; defence stays at 9, where the physical/magic split still shows. Measured through the real fight
     * (`systems/sim/trollMeasure`), such a party deals about a hundred a boss
     * turn, so the fight runs the fifteen to twenty turns that let all three
     * signatures land more than once and bring Fury in at about the halfway mark.
     *
     * Attack is low on purpose: the fight's pressure is what it *adds* — a wound
     * on every hero the Sweep catches that never wears off, three signature
     * moves and a Fury that adds half again and a second Sweep. The numbers are
     * from the sim's parties, which neither heal nor cleanse, so they are a
     * floor on the party's answer; retune from play, not from the sim (the
     * Emperor's lesson).
     *
     * It was, before, a regenerating 140-HP brawler with Smash and Charge; the
     * regeneration is gone for the reason `lairBosses.test.ts` still pins.
     * Dragon (~2,000) and the Heart of Winter are the epic's other retunes; until
     * they land this boss is the strongest of the three by raw weight, which the
     * ordering test records rather than hides.
     */
    baseStats: {
      maxHp: 750,
      attack: 14,
      ...bossDefences(9),
      magic: 4,
      speed: 5,
      moveRange: 2,
      maxMana: 0,
    },
    // The fixed six-turn cycle (`data/templates/trollChieftain`, played by
    // `systems/combat/trollScript`). Smash and Charge are the old kit's and are
    // gone from him: nothing he casts is also on a hero's bar.
    skills: TROLL_PHASES[0].skills,
    // No regeneration: its healing is the opposite of a fight that ends in Fury,
    // and the percentage heal capped how long the fight could last. A troll you
    // cannot slow is still a troll that reaches you, so Unstoppable stays.
    passives: ['unstoppable'],
    xpReward: 200,
    goldReward: 130,
    lootTable: [{ templateId: "chieftain_club", weight: 1 }],
  },
  {
    id: "heart_of_winter",
    tier: "boss",
    blow: "natural",
    /**
     * The ice lair's boss, in its agreed kit (`data/templates/heartOfWinter`): the
     * Blood-Iron anchors, the spreading ice and four unique spells, in two phases.
     *
     * Set between the Dragon (1,200 health, 15 attack and magic since 2026-10-19) and the Emperor
     * (2,080 health, 48), by the rule `lairBosses.test.ts` holds: the last lair's
     * boss is the strongest of the three by `maxHp + 5 x the larger of attack and
     * magic` and short of Aethelred. A caster, so every spell scales off magic, and
     * slow: it is chained. A first estimate to be retuned from play. Attack and
     * magic −10% (20 → 18, 34 → 31) after the playtest of 2026-10-14, and again
     * (18 → 16, 31 → 28, defence 14 → 13) on 2026-10-19. Magic 28 → 26
     * (playtest 2026-10-21), paid back by the anchors feeding it while it is chained
     * (`BALANCE.HEART_ANCHOR_EMPOWER`), so a slow first phase costs the party.
     */
    baseStats: {
      maxHp: 1880,
      attack: 16,
      ...bossDefences(13),
      magic: 26,
      speed: 7,
      moveRange: 0,
      maxMana: 0,
    },
    skills: HEART_PHASES[0].skills,
    // Chained to the Empire's anchors, so nothing shoves it anywhere
    passives: ['immovable'],
    xpReward: 240,
    goldReward: 170,
    lootTable: [{ templateId: "heartfrost_staff", weight: 1 }],
  },
  // Jadeveil: Silk Hollow / Yokai — among the bosses, after the Empire's lair bosses
  {
    id: "jorogumo",
    tier: "boss",
    blow: "natural",
    /**
     * Jadeveil: Silk Hollow / Yokai — the Silk Hollow's boss since the shrine campaign
     * (`data/templates/jorogumoWeaver`): she hangs on three threads until they are cut,
     * then fights on the board. Silk Shroud is played by her script's cycle (web → bite
     * or attack → attack).
     *
     * Set just above the Heart of Winter by the rule `lairBosses.test.ts` holds (gate 84
     * after the Heart's 39, by `maxHp + 5 x the larger of attack and magic`), and short of
     * the next Jadeveil lair's boss. A first estimate: verify in playtest.
     */
    baseStats: {
      maxHp: 1900,
      attack: 44,
      ...bossDefences(15),
      magic: 20,
      speed: 10,
      moveRange: 4,
      maxMana: 0,
    },
    skills: JOROGUMO_PHASES[0].skills,
    // Hung on her threads, and then too heavy to shove
    passives: ['immovable'],
    xpReward: 260,
    goldReward: 180,
    lootTable: [{ templateId: "widows_needle", weight: 1 }],
  },
  {
    id: "aethelred",
    tier: "boss",
    blow: "blade",
    // The stat block is phase 1 only. Phases 2 and 3 layer multipliers on top of
    // this through `systems/forms.ts` — and neither touches maxHp or speed, for
    // the reasons documented in `data/aethelred.ts`.
    //
    // Health +50% (2,080 → 3,120) and attack +10% (48 → 53) after the playtest of
    // 2026-10-14 found him weaker than the Heart of Winter; his magic is unchanged.
    // Health 3,120 → 5,600 (playtest 2026-10-23): `CASTLE_HP_SCALE` had put him back
    // under the Heart (about 8,400 against 12,300 at level 20, tier 1); now about 15,100.
    // Defences 20 → 16, health kept (playtest 2026-10-28): the rework and the health
    // together had overbuffed him.
    baseStats: {
      maxHp: 5600,
      attack: 53,
      ...bossDefences(16),
      magic: 48,
      speed: 9,
      moveRange: 3,
      maxMana: 0,
    },
    skills: AETHELRED_PHASES[0].skills,
    // No Undying: a boss that survives one lethal blow is a boss whose health bar
    // lies. His passives are the signature rules in `bossScript` — The Legion
    // Responds, Blood in the Ledger, Tithe on Mercy — not entries in the shared
    // vocabulary.
    passives: [],
    // Never rolled: the castle ends at a chest, not at the usual reward roll
    xpReward: 600,
    goldReward: 400,
    lootTable: [{ templateId: "last_legion_crown", weight: 1 }],
  },
  // ── Jadeveil: Kairen, the Cloud-Crowned Dragon ────────────────────────────
  {
    id: "kairen",
    tier: "boss",
    blow: "natural",
    /**
     * The summit's boss (`data/templates/kairen`, the private project notes): one
     * hex of head and forebody, rearing from a loop of his own body. The strongest boss by design —
     * about a quarter above Aethelred in health and attack — and exempt from wrath's
     * multiplier (`encounterSetup.encounterPowerScale`), since he is only ever fought at a
     * full bar; Storm Seal tiers scale him as the castle's tiers scale the Emperor. Rooted
     * by his own body: nothing shoves the head. First estimates: verify in playtest.
     */
    // Health ×1.28 and his Attack and Magic about ×1.24 of the Emperor's as he fights
    // (Aethelred's phases raise his own by a sixth on average; Kairen's do not): about
    // ×1.26 the fight, `kairenStrength.test.ts`. Verify in playtest. Health 4,000 → 5,200
    // (playtest 2026-10-23) with the Emperor's raise, measured against his health as the
    // castle fields it (`CASTLE_HP_SCALE`): ×1.33 health, about ×1.28 the fight.
    baseStats: {
      maxHp: 5200,
      attack: 72,
      ...bossDefences(20),
      magic: 66,
      speed: 10,
      moveRange: 2,
      maxMana: 0,
    },
    skills: KAIREN_PHASES[0].skills,
    passives: ['immovable'],
    // The summit pays the boss roll and a chest (`combatRewards`); his Fang is his alone, and never certain
    xpReward: 700,
    goldReward: 450,
    lootTable: [{ templateId: "kairens_fang", weight: 1 }],
  },
];
