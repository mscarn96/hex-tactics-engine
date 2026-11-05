import type {
  DamageType, SkillGesture, SkillPictureId, SpellFamily, StrikeDelivery, VfxKind, WeaponAttackId,
} from '@/models/types';
import { t, type MessageKey } from '@/i18n';

/**
 * What a hero's Basic Attack is, for each kind of thing they could be holding.
 *
 * A hero has no class at-will any more: the button is always "Basic Attack" and
 * the weapon in the main hand decides everything about it — how far it reaches,
 * which stat it hits with, and what the board draws. So a Druid swapping a
 * branch for a cudgel stops throwing light and starts clubbing, and a Hunter
 * who picks up a bow can shoot across the arena, with no mastery node or class
 * table involved. `FormSpec.attack` names one of these per weapon form, and
 * `systems/combat/basicAttack.ts` turns the one worn into a skill.
 *
 * **Keyed by how a weapon fights, not by what it is.** A long sword and a war
 * axe are the same attack; eight forms share five profiles, and a new form picks
 * an existing one rather than restating its numbers. The animation is not stated
 * here at all: the rig already swings, shoots or casts from the held model's own
 * `WeaponType` (`voxel/items/forms.ts`), and `basicAttack.test.ts` pins that a
 * profile's `style` agrees with the model it is drawn with — a bow profile on a
 * model that chops would be a picture of the wrong attack.
 *
 * The multipliers are the old at-wills', moved rather than re-tuned: `slash`
 * was 1.1, `throw_knife` 0.9, `arcane_bolt` 0.8 and `thorn_lash` 0.8, so a hero
 * holding their class's starter weapon hits exactly as hard as they did.
 */

/**
 * The four shapes a Basic Attack comes in.
 *
 * - `melee` — physical, beside the target (a spear's reach is still melee).
 * - `thrown` — physical, short range; the weapon leaves the hand.
 * - `ranged` — physical, long range; something is shot.
 * - `missile` — magical, off the caster's `magic`; a basic bolt of power.
 */
export type AttackStyle = 'melee' | 'thrown' | 'ranged' | 'missile';

export interface WeaponAttack {
  style: AttackStyle;
  range: number;
  /** Multiplier on the scaling stat, in the at-will band (~0.8–1.1). */
  damage: number;
  /** `attack` for anything physical, `magic` for a missile. */
  scaling: 'attack' | 'magic';
  /** The defence that answers the blow — decided here, not read off `scaling`. */
  damageType: DamageType;
  vfxKind: VfxKind;
  vfxColor: string;
  /** Its face on the bar: the weapon kind's own picture (`skill:attack_<kind>`). */
  icon: SkillPictureId;
  /**
   * What the blow sounds like — the material it is made of, for
   * `soundIntents.strikeDelivery`. Stated per profile rather than derived from
   * `style`, because `style` groups by reach and the ear groups by material: a
   * sword, a hammer and a bare fist are all `melee`, and a bow and a crossbow
   * are both `ranged` while one twangs and the other slams.
   */
  delivery: StrikeDelivery;
  /**
   * The school a missile is heard as, where its colour would name the wrong one
   * (`HeroSkill.spell`). The staff's bolt is `bolt`, a quick zip and a fizzing
   * pop, rather than the arcane spells' slow swell and bell; the branch's mote
   * is left to its green, and heard as nature.
   */
  spell?: SpellFamily;
  /** A blow heard as its own swing rather than its delivery's (`HeroSkill.gesture`): a fist thrown. */
  gesture?: SkillGesture;
}

export type { WeaponAttackId } from '@/models/types';

/**
 * A profile's one line for the tooltip (`items.attack.<id>.verb`); the
 * weapon's own name is put in front of it (`items.attackWith.*`).
 */
export function weaponAttackVerb(id: WeaponAttackId): string {
  return t(`items.attack.${id}.verb` as MessageKey);
}

export const WEAPON_ATTACKS: Record<WeaponAttackId, WeaponAttack> = {
  // Swords, axes, daggers. `slash` at 1.1 was the Champion's at-will.
  blade: {
    style: 'melee', range: 1, damage: 1.1, scaling: 'attack', damageType: 'physical',
    vfxKind: 'slash', vfxColor: '#ff5a4a', icon: 'attack_blade', delivery: 'blade',
  },
  // Hammers and cudgels. The same blow, drawn heavier-coloured: a Druid with a
  // cudgel is making a physical attack, and the swing should not look like the
  // light they would otherwise be throwing.
  blunt: {
    style: 'melee', range: 1, damage: 1.1, scaling: 'attack', damageType: 'physical',
    vfxKind: 'slash', vfxColor: '#e0a860', icon: 'attack_blunt', delivery: 'blunt',
  },
  // A spear fights at its own length — one hex further than a sword, and a
  // little lighter for it, which is the Skirmisher's "a spear's reach".
  reach: {
    style: 'melee', range: 2, damage: 0.9, scaling: 'attack', damageType: 'physical',
    vfxKind: 'slash', vfxColor: '#d8d0c0', icon: 'attack_reach', delivery: 'reach',
  },
  // `throw_knife`'s numbers: short, sure, and the Hunter's starting kit.
  thrown: {
    style: 'thrown', range: 2, damage: 0.9, scaling: 'attack', damageType: 'physical',
    vfxKind: 'throw', vfxColor: '#c8d0dd', icon: 'attack_thrown', delivery: 'thrown',
  },
  // The longest free reach in the game, and a little lighter per arrow than a
  // sword for it — the Marksman's whole kit is built on standing far away.
  bow: {
    style: 'ranged', range: 4, damage: 0.9, scaling: 'attack', damageType: 'physical',
    vfxKind: 'shot', vfxColor: '#ffc070', icon: 'attack_bow', delivery: 'bow',
  },
  // Heavier and shorter than the bow: the reason to carry one.
  crossbow: {
    style: 'ranged', range: 3, damage: 1.0, scaling: 'attack', damageType: 'physical',
    vfxKind: 'shot', vfxColor: '#d0d8e0', icon: 'attack_crossbow', delivery: 'crossbow',
  },
  // `arcane_bolt`: the Arcanist's staff or wand.
  arcane: {
    style: 'missile', range: 3, damage: 0.8, scaling: 'magic', damageType: 'magic',
    vfxKind: 'bolt', vfxColor: '#aa44ff', icon: 'attack_arcane', delivery: 'spell', spell: 'bolt',
  },
  // The Druid's branch: the same missile in green, at the reach Thorn Lash and
  // Holy Bolt both had. No Root — the rider was Thorn Lash's, and this is not
  // Thorn Lash.
  wild: {
    style: 'missile', range: 2, damage: 0.8, scaling: 'magic', damageType: 'magic',
    vfxKind: 'bolt', vfxColor: '#7fbf5a', icon: 'attack_wild', delivery: 'spell',
  },
  // The Monk's hand wraps: the bare-handed blow at full strength. The same
  // stone-fist picture as `unarmed`, and the wraps are why it is not half a
  // blow: bound hands are a weapon (the private project notes).
  fist: {
    style: 'melee', range: 1, damage: 1.0, scaling: 'attack', damageType: 'physical',
    vfxKind: 'slash', vfxColor: '#e8d0b0', icon: 'attack_fist', delivery: 'blunt', gesture: 'fist',
  },
  // ── Jadeveil's authored weapons (`itemTemplates.ts`) ─────────────────────
  // Kairen's Fang: a spear's reach, and a heavier thrust than any spear for being
  // a dragon's tooth. Jade-lit, and pictured with the Draconic Host's bite.
  dragon_fang: {
    style: 'melee', range: 2, damage: 1.0, scaling: 'attack', damageType: 'physical',
    vfxKind: 'slash', vfxColor: '#4fe08a', icon: 'attack_dragon_fang', delivery: 'reach',
  },
  // The Monastery Bellstaff: the staff's bolt, struck rather than shot — a little
  // harder and heard as a bell (the arcane school's tone) where the staff's zips.
  bell_toll: {
    style: 'missile', range: 3, damage: 0.9, scaling: 'magic', damageType: 'magic',
    vfxKind: 'bolt', vfxColor: '#6fe8a8', icon: 'attack_bell_toll', delivery: 'spell', spell: 'arcane',
  },
  // Nothing in the main hand. Weak on purpose — it exists so that a hero is
  // never without a button, not so that going unarmed is ever a choice.
  unarmed: {
    style: 'melee', range: 1, damage: 0.5, scaling: 'attack', damageType: 'physical',
    vfxKind: 'slash', vfxColor: '#e8d0b0', icon: 'attack_unarmed', delivery: 'blunt', gesture: 'fist',
  },
};
