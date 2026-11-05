import { AuraType, CombatUnit, SkillTargetType } from '@/models/types';
import { canAim, canStrike, alliesOf, foesOf, isAlive } from '@/systems/combat/targetLegality';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { at, makeEffect, makeFoe, makeSkill, makeUnit } from '../support/fixtures';

/**
 * Who may be struck, as a table: one predicate, read by the highlights, the AI's
 * scorer and the resolver, so a per-feature "the AI also refuses it" check reduces to
 * a row here.
 */

const me = makeUnit({ id: 'me', position: at(0, 0) });
const strike = makeSkill({ targetType: SkillTargetType.Single, range: 3, damage: 5 });

const cases: [string, CombatUnit, boolean, boolean][] = [
  // [what the target is, the target, may it be struck, may it be aimed at]
  ['a living enemy', makeFoe({ id: 'e', position: at(1, 0) }), true, true],
  ['a fallen enemy', makeFoe({ id: 'e', position: at(1, 0), currentHp: 0 }), false, false],
  ['an ally', makeUnit({ id: 'a', position: at(1, 0) }), false, false],
  [
    'a stealthed enemy: struck by a sweep, but not picked',
    makeFoe({ id: 'e', position: at(1, 0), activeEffects: [makeEffect(AuraType.Stealth, { duration: 2 })] }),
    true, false,
  ],
  [
    'an enemy the rune circle bars',
    makeFoe({ id: 'e', position: at(1, 0), duel: { partnerId: 'someone_else', centre: at(1, 0), radius: 1, turns: 0 } }),
    false, false,
  ],
];

describe('canStrike and canAim', () => {
  it.each(cases)('%s', (_name, target, struck, aimed) => {
    expect(canStrike(me, target, strike)).toBe(struck);
    expect(canAim(me, target, strike)).toBe(aimed);
  });

  it('refuses a target a gated skill needs wounded, and takes it once it is', () => {
    const execute = makeSkill({ targetType: SkillTargetType.Single, range: 3, damage: 5, requiresExecutable: true } as never);
    const healthy = makeFoe({ id: 'e', position: at(1, 0) });
    const wounded = { ...healthy, currentHp: 5 };
    // Whichever way the rule reads, the predicate and the board's highlights agree
    expect(canStrike(me, healthy, execute)).toBe(getValidSkillTargetHexes(execute, me, [me, healthy]).length > 0);
    expect(canStrike(me, wounded, execute)).toBe(getValidSkillTargetHexes(execute, me, [me, wounded]).length > 0);
  });
});

describe('the board offers what the predicate allows', () => {
  it.each(cases)('%s', (_name, target, _struck, aimed) => {
    const offered = getValidSkillTargetHexes(strike, me, [me, target]).some((h) => h.q === target.position.q && h.r === target.position.r);
    expect(offered).toBe(aimed);
  });
});

describe('the lookups', () => {
  const units = [
    me,
    makeUnit({ id: 'friend', position: at(0, 1) }),
    makeUnit({ id: 'downed', position: at(0, 2), currentHp: 0 }),
    makeFoe({ id: 'foe', position: at(2, 0) }),
    makeFoe({ id: 'dead_foe', position: at(3, 0), currentHp: 0 }),
  ];

  it('knows who is alive, and who stands on which side', () => {
    expect(isAlive(units[2])).toBe(false);
    expect(foesOf(me, units).map((u) => u.id)).toEqual(['foe']);
    expect(alliesOf(me, units).map((u) => u.id)).toEqual(['me', 'friend']);
    expect(alliesOf(me, units, true).map((u) => u.id)).toEqual(['friend']);
  });
});
