import { AuraType, HeroClass } from '@/models/types';
import { basicAttackWith, starterBasicAttack } from '@/systems/combat/basicAttack';
import { BLESSED_STRIKE_COLOR, ENVENOMED_STRIKE_COLOR, PLAIN_STRIKE_COLOR, skillVfx, strikeColor } from '@/systems/combat/vfxResolve';
import { bite, glassShot, shardShot, slash, venomBite, arcaneBurst } from '@/data/skills/skillData';
import { MARKSMAN_YELLOW } from '@/data/display/marksmanColors';
import { WEAPON_ATTACKS } from '@/data/items/weaponAttacks';

/**
 * Playtest 2026-10-09: ordinary attacks are drawn white-grey, and colour is kept for
 * what is special — a blessed weapon's gold, a magic missile, a poison, a themed shot.
 */
describe('plain strike colour', () => {
  const blessed = { activeEffects: [{ type: AuraType.BlessedWeapon, magnitude: 1, duration: 3 }] };

  it('draws a hero Basic Attack with a weapon, and an enemy slash or bite, white-grey', () => {
    expect(strikeColor(starterBasicAttack(HeroClass.Warrior))).toBe(PLAIN_STRIKE_COLOR);
    expect(strikeColor(slash)).toBe(PLAIN_STRIKE_COLOR);
    expect(strikeColor(bite)).toBe(PLAIN_STRIKE_COLOR);
    expect(skillVfx(bite, { skills: [bite] }).color).toBe(PLAIN_STRIKE_COLOR);
  });

  it('draws the same blow gold while the weapon is blessed', () => {
    expect(strikeColor(slash, blessed as never)).toBe(BLESSED_STRIKE_COLOR);
  });

  it('draws it green while Hemlock coats the blades', () => {
    const coated = { activeEffects: [{ type: AuraType.Envenomed, magnitude: 0.3, duration: 3 }] };
    expect(strikeColor(slash, coated as never)).toBe(ENVENOMED_STRIKE_COLOR);
  });

  it('keeps colour where it means something', () => {
    expect(strikeColor(basicAttackWith(undefined, false))).toBe(PLAIN_STRIKE_COLOR);
    expect(strikeColor({ ...slash, vfxColor: MARKSMAN_YELLOW })).toBe(MARKSMAN_YELLOW);
    expect(strikeColor(venomBite)).toBe(venomBite.vfxColor);
    expect(strikeColor(glassShot)).toBe(glassShot.vfxColor);
    expect(strikeColor(shardShot)).toBe(shardShot.vfxColor);
    expect(strikeColor(arcaneBurst)).toBe(arcaneBurst.vfxColor);
    const missile = { ...basicAttackWith(undefined), ...WEAPON_ATTACKS.arcane, id: 'basic_attack' as const };
    expect(strikeColor(missile)).toBe(WEAPON_ATTACKS.arcane.vfxColor);
  });
});
