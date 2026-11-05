import { HeroTemplate, HeroClass } from "@/models/types";
import {
  charge,
  arcaneBurst,
  heal,
  disengage,
  meditate,
} from '@/data/skills/skillData';
import { BALANCE } from '@/data/balanceConstants';
import { expansionOfClass, type ExpansionId } from '@/data/expansions';

/**
 * What a hero owns before it picks a path.
 *
 * One identity skill at level 3, and nothing else — everything further is
 * earned from a mastery tree. **There is no at-will here.** Every hero's free
 * attack is the weapon-driven Basic Attack, built at combat setup from what is
 * in their main hand (`systems/combat/basicAttack.ts`), so the class-fixed
 * Slash, Arcane Bolt, Thorn Lash and Throw Knife that used to lead these lists
 * are gone from heroes — they stay in `skillData.ts` for the enemies and
 * summons that still press them.
 *
 * The constraint that shapes this table: **all of it must stay useful and
 * on-theme for all three of the class's paths**, because it is owned before the
 * choice is made. That rules out elements (two of three Arcanist paths are not
 * fire) and roles (a Berserker never wants to taunt), and leaves verbs — close,
 * burst, mend, reposition.
 *
 * Skills at `unlockLevel >= 5` are deliberately absent: `deriveHeroSkills` caps
 * template grants at level 4, so any listed here could never be handed out, and
 * six of them sat in this file being advertised by the hero-select screen and
 * never arriving.
 */

export const heroTemplates: HeroTemplate[] = [
  {
    id: "warrior",
    heroClass: HeroClass.Warrior,
    baseStats: {
      maxHp: 120,
      attack: 14,
      defense: 12,
      magic: 4,
      speed: 8,
      moveRange: 3,
      maxMana: 40,
    },
    statGrowth: {
      maxHp: 15,
      attack: 3,
      defense: 2,
      magic: 1,
      speed: 1,
      moveRange: 0,
      maxMana: 5,
    },
    skills: [charge],
  },
  {
    id: "mage",
    heroClass: HeroClass.Mage,
    baseStats: {
      maxHp: 70,
      attack: 6,
      defense: 5,
      magic: 16,
      speed: 9,
      moveRange: 3,
      maxMana: 80,
    },
    statGrowth: {
      maxHp: 8,
      attack: 1,
      defense: 1,
      magic: 4,
      speed: 1,
      moveRange: 0,
      maxMana: 12,
    },
    skills: [arcaneBurst],
  },
  {
    id: "healer",
    heroClass: HeroClass.Healer,
    baseStats: {
      maxHp: 80,
      attack: 5,
      defense: 7,
      magic: 14,
      speed: 10,
      moveRange: 3,
      maxMana: 70,
    },
    statGrowth: {
      maxHp: 10,
      attack: 1,
      defense: 1,
      magic: 3,
      speed: 1,
      moveRange: 0,
      maxMana: 10,
    },
    skills: [heal],
  },
  {
    id: "ranger",
    heroClass: HeroClass.Ranger,
    baseStats: {
      maxHp: 85,
      attack: 12,
      defense: 6,
      magic: 6,
      speed: 14,
      moveRange: 4,
      maxMana: 50,
    },
    statGrowth: {
      maxHp: 10,
      attack: 3,
      defense: 1,
      magic: 1,
      speed: 2,
      moveRange: 0,
      maxMana: 6,
    },
    skills: [disengage],
  },
  {
    // The Monk (the private project notes, "The base class"): a fighter in the
    // middle of the Champion and the Hunter, with magic enough for the Firefly.
    // Its pool is chi, fixed at `BALANCE.CHI.POOL` whatever the template says
    // (`leveling.calculateStatsForLevel`), so it is stated as that and grows by
    // nothing. No flat HP beyond the class growth: toughness is bought as the
    // right kind of defence on the paths.
    id: "monk",
    heroClass: HeroClass.Monk,
    baseStats: {
      maxHp: 100,
      attack: 12,
      defense: 9,
      magic: 9,
      speed: 12,
      moveRange: 3,
      maxMana: BALANCE.CHI.POOL,
    },
    statGrowth: {
      maxHp: 12,
      attack: 2,
      defense: 2,
      magic: 2,
      speed: 1,
      moveRange: 0,
      maxMana: 0,
    },
    skills: [meditate],
  },
];

/**
 * The classes a player who owns these expansions may start a campaign as or
 * recruit at the Tavern: every base class, and an expansion's class (the Monk,
 * with Jadeveil) only while it is owned. Ownership alone — not the Emperor, not
 * a visit to Jadeveil, not a level. A Monk already in a party is never taken
 * away by this; it only decides what is *offered*.
 */
export function heroTemplatesOpenTo(owned: (id: ExpansionId) => boolean): HeroTemplate[] {
  return heroTemplates.filter((t) => {
    const expansion = expansionOfClass(t.heroClass);
    return expansion === null || owned(expansion);
  });
}
