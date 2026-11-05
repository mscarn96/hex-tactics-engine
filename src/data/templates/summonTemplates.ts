import { AfflictionType, CombatUnit, DeathBurst, HeroStats, HeroSkill, SummonTemplateId } from '@/models/types';
import {
  bite, stoneFist, groundSlam,
  boulderLeap, flareDash, timberCrush, rootlashSweep, canopyGuard,
} from '@/data/skills/skillData';
import { maul, roar, rip, pounce, talons, dive } from '@/data/skills/mastery/druid';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { broodBite } from '@/data/templates/kairen';
import { BALANCE } from '@/data/balanceConstants';

/**
 * Creatures that exist only while a battle lasts.
 *
 * Separate from `enemyTemplates` because `encounterGenerator` builds fights by
 * filtering that table on tier — anything added there starts turning up as a
 * wandering monster and in loot tables. A summon is neither: it has no XP, no
 * gold and no drops, because the reward for the fight already accounts for the
 * caster.
 *
 * Stats are authored against a mid-game party and then scaled by the summoner's
 * level, the same way `createEnemyUnits` scales encounter enemies.
 */
/** A summon. Its name is `units.<id>.name`, read through `templateName`. */
export interface SummonTemplate {
  id: SummonTemplateId;
  baseStats: HeroStats;
  skills: HeroSkill[];
  /**
   * Fraction of its own max HP the creature loses at the start of each of its
   * turns — a clock that is not a duration.
   *
   * A duration is a number the player cannot interact with. Burning down is
   * health, so healing it extends the thing and every source of damage cuts it
   * short. Routed through `damageUnit` rather than dealt as a permanent Burn,
   * because DoT ticks bypass that funnel and the funnel is what makes Barrier,
   * Undying and the death burst behave with one code path.
   */
  decayFraction?: number;
  /**
   * A companion rather than a creature with turns of its own (the Thunder
   * Elemental): it is left out of `turnOrder`, follows its summoner, counts its
   * lifetime and statuses down on the summoner's regular turns, and acts only by
   * echoing the summoner's spells. See `systems/combat/companion`.
   */
  companion?: boolean;
  /**
   * A companion that stays where it was summoned rather than following its
   * summoner (the Lantern Beacon). Only meaningful with `companion`.
   */
  stationary?: boolean;
  /** What it does to the ground around it when it dies, from any cause. */
  deathBurst?: DeathBurst;
}

export const summonTemplates: SummonTemplate[] = [
  {
    id: 'fire_elemental',
    /**
     * A smart missile rather than a pet.
     *
     * One skill, which closes and hits — it was `slash` and `arcaneBolt`, two
     * generic swings that made it a small extra body. It has no duration: the
     * decay is the clock, which is a clock the player can interact with (heal
     * it and it lasts, and every point of damage it takes shortens it), and it
     * ends in a blast rather than in a puff.
     */
    baseStats: {
      maxHp: 45, attack: 20, defense: 4, magic: 14, speed: 12, moveRange: 3, maxMana: 0,
    },
    skills: [flareDash],
    // ~3 turns of life. Ceil, so it always burns down rather than converging.
    decayFraction: 0.34,
    deathBurst: {
      radius: 2,
      amount: 1.1,
      effect: { type: AfflictionType.Burn, magnitude: 0.4, duration: 2 },
    },
  },
  {
    id: 'thunder_elemental',
    /**
     * The Stormcaller's ultimate: a small storm that stands beside its caster and
     * casts every Stormcaller spell a second time. It has no skills and no legs of
     * its own because it never takes a turn — `companion` is what moves it and what
     * makes it cast. Fragile on purpose: it is a target the enemy can answer, and
     * killing it ends the echoes early. Its Magic is not authored here: it is a
     * share of the owner's (`SummonSpec.echoMagic`), so `magic: 0`.
     */
    baseStats: {
      maxHp: 32, attack: 0, defense: 4, magicDefense: 8, magic: 0, speed: 1, moveRange: 0, maxMana: 0,
    },
    skills: [],
    companion: true,
  },
  // ── The Stoneshaper's three casts ──────────────────────────────────────────
  //
  // No attack, no movement and no skills: `isInert` reads exactly that pair and
  // the rock passes its turns. It is *attackable*, which is the whole tension —
  // three casts is a real investment and the enemy gets to answer it.
  {
    id: 'stone_heart_rock',
    baseStats: {
      maxHp: 90, attack: 0, defense: 25, magic: 0, speed: 1, moveRange: 0, maxMana: 0,
    },
    skills: [],
  },
  {
    id: 'stone_heart_stack',
    baseStats: {
      maxHp: 130, attack: 0, defense: 25, magic: 0, speed: 1, moveRange: 0, maxMana: 0,
    },
    skills: [],
  },
  {
    id: 'stone_elemental',
    // The opposite trade — a body to put between the party and the enemy.
    // "Between" is doing real work now: Ground Slam taunts everything adjacent,
    // so the elemental is not just a wall the enemy can walk around.
    //
    // Raised from 110/12/18/5: it is the third cast of a three-cast capstone
    // now, not a one-button summon, and it has to be worth the two turns and
    // the rock that could have been killed on either of them.
    baseStats: {
      maxHp: 150, attack: 16, defense: 22, magic: 0, speed: 6, moveRange: 2, maxMana: 0,
    },
    skills: [stoneFist, groundSlam, boulderLeap],
  },
  {
    id: 'treant',
    // `slash` dropped for the same reason the fire elemental's was: a shared
    // generic swing on a summon is a body rather than a creature. A heavy
    // single blow and a sweep that roots is a treant.
    baseStats: {
      maxHp: 85, attack: 14, defense: 12, magic: 6, speed: 7, moveRange: 2, maxMana: 0,
    },
    // Canopy Guard (remaster, 2026-10) is the third: a heavy blow, a holding sweep
    // and bark over the party.
    skills: [timberCrush, rootlashSweep, canopyGuard],
  },
  // ── Wildshape's Primal Bond, one per shape ─────────────────────────────────
  //
  // The Druid's chosen animal fighting beside it instead of being worn. They
  // carry the *form's own* skills rather than generic ones, which is what makes
  // three summons off one node read as three different capstones: the bear
  // taunts and slams, the wolf leaps and bleeds, the hawk strikes from two hexes
  // and withdraws.
  //
  // Deliberately weaker than the shape the Druid could have become. Primal Bond
  // buys an extra *body* while keeping the caster's hands free — a companion at
  // parity with the form would make wearing it strictly worse.
  {
    id: 'bonded_bear',
    baseStats: {
      maxHp: 120, attack: 14, defense: 18, magic: 0, speed: 6, moveRange: 2, maxMana: 0,
    },
    skills: [maul, roar],
  },
  {
    id: 'bonded_wolf',
    baseStats: {
      maxHp: 70, attack: 17, defense: 8, magic: 0, speed: 13, moveRange: 4, maxMana: 0,
    },
    skills: [rip, pounce],
  },
  {
    id: 'bonded_hawk',
    baseStats: {
      maxHp: 45, attack: 18, defense: 5, magic: 0, speed: 15, moveRange: 5, maxMana: 0,
    },
    skills: [talons, dive],
  },
  // ── The Firefly's Lantern Beacon ───────────────────────────────────────────
  //
  // A companion that stays where it was planted: no turn, no skills, no legs.
  // Its health is a share of the Firefly's (`SummonSpec.ofCasterMaxHp`), so the
  // `maxHp` here is never read. Its clock — a third of its health burned at the
  // start of each Firefly turn — and its pulse are `fireflyGround.tendBeacon`;
  // its light is `combatStore.syncBeacons`.
  {
    id: 'lantern_beacon',
    baseStats: {
      maxHp: 60, attack: 0, defense: 6, magicDefense: 6, magic: 0, speed: 1, moveRange: 0, maxMana: 0,
    },
    skills: [],
    companion: true,
    stationary: true,
  },
  {
    id: 'risen_skeleton',
    // Deliberately weak — enemy casters raise several at once
    baseStats: {
      maxHp: 30, attack: 11, defense: 5, magic: 0, speed: 9, moveRange: 3, maxMana: 0,
    },
    skills: [bite],
  },
  // ── Aethelred's reinforcements ─────────────────────────────────────────────
  //
  // The same soldiers you fight on the map, read off `enemyTemplates` rather
  // than copied: a retune to the Obsidian Infantry has to reach the ones he
  // calls, or the fight slowly drifts away from the faction it belongs to.
  //
  // They need their own ids because `encounterGenerator` builds fights by
  // filtering `enemyTemplates` — a summon listed there would start turning up as
  // a wandering monster. `MODEL_DEFS` aliases the ids onto the same builders.
  fromLegion('legion_infantry', 'obsidian_infantry'),
  fromLegion('legion_knight', 'dread_knight'),
  // Jadeveil: Kairen's Brood of the Orb — the field Wyrmling at a share of its health and
  // bite (`BALANCE.KAIREN.BROOD_*`), its bite carrying Jade Taint. Read off the Wyrmling
  // so a retune of the field unit reaches the brood.
  broodWyrmling(),
];

/** A brood wyrmling: the field Wyrmling weakened, its bite tainting. */
function broodWyrmling(): SummonTemplate {
  const wyrmling = enemyTemplates.find((t) => t.id === 'wyrmling');
  if (!wyrmling) throw new Error('No enemy template "wyrmling" for the brood');
  const s = wyrmling.baseStats;
  return {
    id: 'brood_wyrmling',
    baseStats: {
      ...s,
      maxHp: Math.max(1, Math.round(s.maxHp * BALANCE.KAIREN.BROOD_HP)),
      attack: Math.max(1, Math.round(s.attack * BALANCE.KAIREN.BROOD_ATTACK)),
    },
    skills: [broodBite],
  };
}

/** A Legion soldier, borrowed from the enemy roster as a summon. */
function fromLegion(id: SummonTemplateId, templateId: string): SummonTemplate {
  const template = enemyTemplates.find((t) => t.id === templateId);
  if (!template) throw new Error(`No enemy template "${templateId}" to summon`);
  return { id, baseStats: { ...template.baseStats }, skills: template.skills };
}

export function findSummonTemplate(id: SummonTemplateId): SummonTemplate | undefined {
  return summonTemplates.find((t) => t.id === id);
}

/**
 * The blast a unit sets off when it dies: its summon template's, else its enemy
 * template's (the Frost Mote). Summons first, because a summon borrowed from the
 * enemy roster is the summon.
 */
export function deathBurstOf(unit: Pick<CombatUnit, 'templateId'>): DeathBurst | undefined {
  if (!unit.templateId) return undefined;
  return findSummonTemplate(unit.templateId as SummonTemplateId)?.deathBurst
    ?? enemyTemplates.find((t) => t.id === unit.templateId)?.deathBurst;
}
