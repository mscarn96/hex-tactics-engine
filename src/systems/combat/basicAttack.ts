import { Hero, HeroClass, HeroSkill, Item, SkillTargetType } from '@/models/types';
import { FORMS } from '@/data/items/itemForms';
import { STARTER_KIT, itemTemplates } from '@/data/items/itemTemplates';
import { WEAPON_ATTACKS, WeaponAttack, WeaponAttackId, weaponAttackVerb } from '@/data/items/weaponAttacks';
import { itemName, type NamedItem } from '@/data/items/itemText';
import { t } from '@/i18n';
import { canDualWield, EquippedItems } from '@/systems/progression/equipRules';
import { MARKSMAN_YELLOW } from '@/data/display/marksmanColors';

/**
 * A hero's Basic Attack, read off what they are holding.
 *
 * Heroes used to own a class at-will — Slash, Arcane Bolt, Thorn Lash, Throw
 * Knife — granted by their template and therefore fixed for the life of the
 * save, whatever was in their hands. So a Hunter holding a bow threw knives,
 * and a Druid who picked up a cudgel went on casting. The button is one skill
 * now, and the main-hand weapon's `FormSpec.attack` decides its reach, its
 * stat, and what the board draws.
 *
 * **Built at combat setup, never stored.** `createPlayerUnits` calls this with
 * the gear worn when the fight starts, so there is nothing on `Hero.skills` to
 * go stale when the weapon changes, and no save field to migrate. The shared
 * definitions the heroes gave up (`slash`, `arcane_bolt` …) stay in
 * `skillData.ts`: enemies and summons still press them.
 *
 * Pure: the caller resolves the worn items, the way `canEquip`'s callers do.
 */

export const BASIC_ATTACK_ID = 'basic_attack' as const;

/** What is in a hand, as far as the attack cares: a worn item or a template. */
type Held = NamedItem & Pick<Item, 'slot'> & Partial<Pick<Item, 'attack'>>;

/**
 * Which profile a worn main hand makes.
 *
 * `unarmed` for an empty hand *and* for a main-hand slot holding something
 * that is not a weapon — which the equip rules make unreachable, and which is
 * exactly why it must not crash if it ever happens.
 */
export function weaponAttackId(main: Held | undefined): WeaponAttackId {
  if (!main || main.slot !== 'mainHand') return 'unarmed';
  // An authored weapon may make an attack of its own (Kairen's Fang, the
  // Bellstaff); everything else makes its form's.
  return main.attack ?? FORMS[main.form]?.attack ?? 'unarmed';
}

export function weaponAttackFor(main: Held | undefined): WeaponAttack {
  return WEAPON_ATTACKS[weaponAttackId(main)];
}

/**
 * Whether this loadout swings twice.
 *
 * A mastery that may dual-wield, a weapon in the main hand, and a second
 * *weapon* in the off-hand — `slot === 'mainHand'` is what makes an off-hand
 * item a weapon, the same test `canEquip` uses to decide it needs the mastery
 * at all. A Berserker who has picked up a greatsword has an empty off-hand and
 * swings once.
 */
export function isDualWielding(
  hero: Pick<Hero, 'masteryPath'>,
  equipped: EquippedItems,
): boolean {
  const main = equipped.mainHand;
  const off = equipped.offHand;
  return (
    canDualWield(hero) &&
    !!main && main.slot === 'mainHand' &&
    !!off && off.slot === 'mainHand'
  );
}

export function basicAttackFor(
  hero: Pick<Hero, 'masteryPath'>,
  equipped: EquippedItems,
): HeroSkill {
  const attack = basicAttackWith(equipped.mainHand, isDualWielding(hero, equipped));
  // A Marksman's shots, the plain one included, fly in the path's yellow
  if (hero.masteryPath === 'marksman') return { ...attack, vfxColor: MARKSMAN_YELLOW };
  // A Skirmisher's Basic Attack leaves one blade with any of its four weapons
  if (hero.masteryPath === 'skirmisher' && leavesBlade(equipped.mainHand)) return { ...attack, embedsBlades: 1 };
  return attack;
}

/** The Skirmisher's four main-hand forms, any of which leaves a blade on a Basic Attack. */
export const BLADE_FORMS: readonly string[] = ['throwing_blade', 'throwing_axe', 'spear', 'dagger'];

/** Whether this main hand makes a Skirmisher's Basic Attack leave a blade. */
export function leavesBlade(main: Held | undefined): boolean {
  return !!main && main.slot === 'mainHand' && BLADE_FORMS.includes(main.form);
}

/**
 * The Basic Attack a given weapon makes, with no hero attached.
 *
 * For the places that show a weapon rather than a loadout — the hero-select
 * screen describing what a class starts holding has a template, not a worn
 * item, and no mastery that could make it two.
 */
export function basicAttackWith(main: Held | undefined, dualWield = false): HeroSkill {
  const profile = weaponAttackFor(main);
  const held = main && main.slot === 'mainHand' ? itemName(main) : null;
  const verb = weaponAttackVerb(weaponAttackId(main));

  const skill: HeroSkill = {
    id: BASIC_ATTACK_ID,
    description: held
      ? t(dualWield ? 'items.attackWith.dual' : 'items.attackWith.single', { item: held, verb })
      : verb,
    targetType: SkillTargetType.Single,
    range: profile.range,
    damage: profile.damage,
    scaling: profile.scaling,
    damageType: profile.damageType,
    unlockLevel: 1,
    manaCost: 0,
    vfxKind: profile.vfxKind,
    vfxColor: profile.vfxColor,
    icon: profile.icon,
    // What the blow sounds like, and — read back by `strikeDelivery` — what
    // every other weapon skill of this hero sounds like too: the Basic Attack
    // is the one skill that knows what is in the hand.
    delivery: profile.delivery,
    ...(profile.spell ? { spell: profile.spell } : {}),
    ...(profile.gesture ? { gesture: profile.gesture } : {}),
  };
  // A throwing weapon flies as itself
  const form = main?.form;
  if (profile.delivery === 'thrown' && (form === 'throwing_axe' || form === 'throwing_blade' || form === 'spear')) {
    skill.projectile = form;
  }
  if (dualWield) skill.dualWield = true;
  return skill;
}

/**
 * The Basic Attack a class walks in holding — the first entry of its starter kit.
 *
 * What a template's level-1 kit *is*, now that the template has no at-will of
 * its own: the hero-select screen shows it, and the suites that pin "every
 * class opens with a damaging attack" ask it rather than the template.
 */
export function starterBasicAttack(heroClass: HeroClass): HeroSkill {
  return basicAttackWith(itemTemplates.find((t) => t.id === STARTER_KIT[heroClass][0]));
}
