import { AfflictionType, AuraType, CombatUnit, HeroSkill, SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { canUseSkill, skillBlockedReason, skillUsability, UsabilityGuard } from '@/systems/combat/cooldowns';
import { makeEffect, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * One guard list answers "can this unit use this skill": the AI's scorer and the
 * resolver's refusal (`canUseSkill`), the preview's reason (`skillBlockedReason`) and
 * the first failing guard itself (`skillUsability`). Each pair is pinned to agree.
 */

const me = (over: Partial<CombatUnit> = {}) => makeUnit({ id: 'me', stats: makeStats({ maxMana: 50 }), ...over });
const skill = (over: Partial<HeroSkill> = {}) => makeSkill({ manaCost: 5, ...over });

interface Case { guard: UsabilityGuard; unit: CombatUnit; skill: HeroSkill; refusesCast: boolean; previewed: boolean }

const CASES: Case[] = [
  {
    guard: 'fury', refusesCast: true, previewed: true,
    unit: me({ activeEffects: [makeEffect(AuraType.BlessedWeapon, { stacks: BALANCE.FURY_MAX_STACKS, duration: -1 })] }),
    skill: skill({ id: 'righteous_fury' as never }),
  },
  { guard: 'charge', refusesCast: true, previewed: true, unit: me(), skill: skill({ chargePending: true }) },
  {
    guard: 'apex', refusesCast: true, previewed: true,
    unit: me({ apexSpent: ['surge'] }), skill: skill({ id: 'surge' as never, formSkill: 'apex' } as never),
  },
  {
    guard: 'aim', refusesCast: true, previewed: true,
    unit: me({ activeEffects: [makeEffect(AuraType.Aiming, { aimAt: 'foe', duration: 2 } as never)] }),
    skill: skill({ id: 'slash' as never }),
  },
  {
    guard: 'rooted', refusesCast: false, previewed: true,
    unit: me({ activeEffects: [makeEffect(AfflictionType.Root, { duration: 2 })] }),
    skill: skill({ targetType: SkillTargetType.Single, selfMove: { kind: 'blink', range: 3 } } as never),
  },
  {
    guard: 'silenced', refusesCast: true, previewed: false,
    unit: me({ activeEffects: [makeEffect(AfflictionType.Silence, { duration: 2 })] }), skill: skill(),
  },
  {
    guard: 'cooldown', refusesCast: true, previewed: false,
    unit: me({ cooldowns: { slash: 2 } }), skill: skill({ id: 'slash' as never }),
  },
  { guard: 'mana', refusesCast: true, previewed: false, unit: me({ currentMana: 1 }), skill: skill({ manaCost: 20 }) },
];

describe('skillUsability', () => {
  it('lets a ready skill through every guard', () => {
    expect(skillUsability(me(), skill())).toEqual({ ok: true });
    expect(canUseSkill(me(), skill())).toBe(true);
    expect(skillBlockedReason(skill(), me())).toBeNull();
  });

  it.each(CASES)('$guard: names itself, and the cast and the preview agree', ({ guard, unit, skill: s, refusesCast, previewed }) => {
    const usability = skillUsability(unit, s);
    expect(usability).toMatchObject({ ok: false, guard });
    // The AI and the resolver: a guard the cast refuses on makes the skill unusable
    expect(canUseSkill(unit, s)).toBe(!refusesCast);
    // The preview names the same reason, for the guards it can name without the board
    const preview = skillBlockedReason(s, unit);
    if (previewed) expect(preview).toBe((usability as { reason: string }).reason);
    else expect(preview).toBeNull();
  });

  it('reports the first guard, in the order the preview names them', () => {
    const capped = me({
      activeEffects: [
        makeEffect(AuraType.BlessedWeapon, { stacks: BALANCE.FURY_MAX_STACKS, duration: -1 }),
        makeEffect(AfflictionType.Silence, { duration: 2 }),
      ],
      currentMana: 0,
    });
    expect(skillUsability(capped, skill({ id: 'righteous_fury' as never, manaCost: 20 }))).toMatchObject({ guard: 'fury' });
  });
});
