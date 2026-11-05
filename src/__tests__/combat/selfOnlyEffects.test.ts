import { AuraType, AfflictionType } from '@/models/types';
import { effectReaches, skillEffects } from '@/systems/combat/statusEffects';
import { unbreakableVow } from '@/data/skills/mastery/champion';
import { makeUnit } from '@/__tests__/support/fixtures';

/**
 * "Your own side" and "you" are not the same thing on a self-centred ring.
 *
 * Unbreakable Vow is the Bulwark's capstone: taunt a two-hex ring and turn your
 * armour to spines. Its description says that, and the code's own comment said
 * "the aura stays on the caster" — but the rule it leaned on is that auras stay
 * on the caster's *side*, and the skill's footprint is a ring centred on the
 * caster. So the Thorns went to every ally standing inside two hexes.
 *
 * That is the worst possible set of recipients. The Taunt in the same cast has
 * just dragged every enemy in the ring onto the Bulwark, so the allies holding
 * the retaliation are exactly the ones guaranteed not to be hit, and the one
 * unit being hit by everything has none. The whole path is built around being
 * hit; its capstone did nothing about it.
 *
 * `SkillEffect.selfOnly` is the narrowing, and it is per *entry* rather than per
 * skill because this one cast needs both behaviours at once — a Taunt that must
 * cross the line and an aura that must not leave the caster.
 */

const bulwark = () => makeUnit({ id: 'bulwark', isPlayer: true });
const ally = () => makeUnit({ id: 'ally', isPlayer: true });
const enemy = () => makeUnit({ id: 'orc', isPlayer: false });

describe('who a skill effect reaches', () => {
  describe('the standing rule, unchanged', () => {
    it('sends an affliction across the line and never to your own side', () => {
      const curse = { type: AfflictionType.Taunt, magnitude: 4, duration: 3 };
      expect(effectReaches(curse, bulwark(), enemy())).toBe(true);
      expect(effectReaches(curse, bulwark(), ally())).toBe(false);
      expect(effectReaches(curse, bulwark(), bulwark())).toBe(false);
    });

    it('keeps an aura on your own side, the caster included', () => {
      const blessing = { type: AuraType.Thorns, magnitude: 0.4, duration: 3 };
      expect(effectReaches(blessing, bulwark(), ally())).toBe(true);
      expect(effectReaches(blessing, bulwark(), bulwark())).toBe(true);
      expect(effectReaches(blessing, bulwark(), enemy())).toBe(false);
    });

    /**
     * Symmetric, which is the property `combatEvents` exists to hold. An enemy
     * warchief's `rally` sat on its template for a whole version without ever
     * landing, because the AI path checked `isAffliction && target.isPlayer`.
     */
    it('runs the same way round for an enemy caster', () => {
      const blessing = { type: AuraType.Thorns, magnitude: 0.4, duration: 3 };
      expect(effectReaches(blessing, enemy(), enemy())).toBe(true);
      expect(effectReaches(blessing, enemy(), bulwark())).toBe(false);
    });
  });

  describe('selfOnly', () => {
    it('refuses an ally standing in the footprint', () => {
      const armour = { type: AuraType.Thorns, magnitude: 0.4, duration: 3, selfOnly: true };
      expect(effectReaches(armour, bulwark(), bulwark())).toBe(true);
      expect(effectReaches(armour, bulwark(), ally())).toBe(false);
      expect(effectReaches(armour, bulwark(), enemy())).toBe(false);
    });

    /**
     * Identity, not side. Two heroes are both `isPlayer`, so anything reading
     * the side would hand the second one the armour as well — which is the bug.
     */
    it('is decided by who the unit is, not which side it is on', () => {
      const armour = { type: AuraType.Thorns, magnitude: 1, duration: 2, selfOnly: true };
      const caster = bulwark();
      const twin = makeUnit({ id: 'other-bulwark', isPlayer: true });
      expect(twin.isPlayer).toBe(caster.isPlayer);
      expect(effectReaches(armour, caster, twin)).toBe(false);
    });
  });

  /**
   * The skill this exists for, checked as authored rather than in the abstract.
   *
   * Both halves in one cast is the whole reason the flag is per entry: the Taunt
   * must reach the ring and the Thorns must not.
   */
  describe('Unbreakable Vow', () => {
    const entries = () => skillEffects(unbreakableVow);

    it('still taunts every enemy in the ring', () => {
      const taunt = entries().find((e) => e.type === AfflictionType.Taunt)!;
      expect(taunt).toBeDefined();
      expect(taunt.selfOnly).toBeFalsy();
      expect(effectReaches(taunt, bulwark(), enemy())).toBe(true);
    });

    it('keeps its spines on the Bulwark and off the allies it just protected', () => {
      const thorns = entries().find((e) => e.type === AuraType.Thorns)!;
      expect(thorns).toBeDefined();
      expect(effectReaches(thorns, bulwark(), bulwark())).toBe(true);
      expect(effectReaches(thorns, bulwark(), ally())).toBe(false);
    });
  });
});
