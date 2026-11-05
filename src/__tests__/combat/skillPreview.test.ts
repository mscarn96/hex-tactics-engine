import { AuraType, CombatUnit, HeroSkill } from '@/models/types';
import { ALL_SKILLS } from '@/data/skills/skillData';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { heal } from '@/data/skills/skillData';
import {
  calculateDamage, calculateHealing, resolveEffectMagnitude, skillDamagePreview,
} from '@/systems/combat/damageCalc';
import { useRunSettingsStore } from '@/stores/runSettingsStore';
import { makeEffect, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * The number a skill's description states is the cast, not an estimate of it.
 *
 * `skillDamagePreview` is the attacker's half of `calculateDamage`, so against a
 * target with no defence and nothing on it the two must agree exactly — under
 * buffs, a blessing, a boss's Fury and the campaign difficulty alike. A preview
 * that drifted from the cast would be a tooltip promising a number the fight
 * never shows.
 */

beforeEach(() => {
  resetFixtureIds();
  useRunSettingsStore.getState().begin();
});
afterEach(() => useRunSettingsStore.getState().begin());

/** Skills whose damage reads nothing off the target but its defence. */
const plain = [...ALL_SKILLS, ...MASTERY_SKILLS].filter(
  (s: HeroSkill) => s.damage && !s.bonusVs && !s.amplifiedBy && !s.detonates,
);

/** No defence, no statuses, wounded enough that no "healthy target" bonus applies. */
const dummy = (): CombatUnit =>
  makeUnit({
    id: 'dummy',
    isPlayer: true,
    stats: makeStats({ maxHp: 1000, defense: 0, magicDefense: 0 }),
    currentHp: 500,
  });

const casters = (): [string, CombatUnit][] => [
  ['plain', makeFoe({ id: 'plain', stats: makeStats({ attack: 23, magic: 31 }) })],
  [
    'buffed and blessed',
    makeFoe({
      id: 'buffed',
      stats: makeStats({ attack: 17, magic: 29 }),
      activeEffects: [
        makeEffect(AuraType.AttackBuff, { magnitude: 6 }),
        makeEffect(AuraType.MagicBuff, { magnitude: 9 }),
        makeEffect(AuraType.BlessedWeapon, { magnitude: 7 }),
        makeEffect(AuraType.Fury, { magnitude: 0.5 }),
      ],
    }),
  ],
];

describe('skillDamagePreview', () => {
  it.each(['easy', 'medium', 'hard'] as const)(
    'equals the cast against a 0-defence target (%s)',
    (difficulty) => {
      useRunSettingsStore.getState().begin({ difficulty, hardcore: false });
      const offenders: string[] = [];
      for (const [label, caster] of casters()) {
        for (const skill of plain) {
          const preview = skillDamagePreview(caster, skill);
          const cast = calculateDamage(caster, dummy(), skill);
          if (preview !== cast) offenders.push(`${label} ${skill.id}: ${preview} vs ${cast}`);
        }
      }
      expect(offenders).toEqual([]);
    },
  );

  it('is the player number with no difficulty applied', () => {
    useRunSettingsStore.getState().begin({ difficulty: 'hard', hardcore: false });
    const hero = makeUnit({ id: 'hero', stats: makeStats({ attack: 14 }) });
    const slash = ALL_SKILLS.find((s) => s.id === 'slash')!;
    expect(skillDamagePreview(hero, slash)).toBe(15);
  });
});

describe('resolveEffectMagnitude', () => {
  it('reads the same effective power the heal beside it reads', () => {
    const druid = makeUnit({
      id: 'druid',
      stats: makeStats({ magic: 41 }),
      activeEffects: [makeEffect(AuraType.MagicBuff, { magnitude: 10 })],
    });
    const barrier = resolveEffectMagnitude(AuraType.Barrier, 0.4, druid, 'magic');
    // 0.4 × (41 + 10), the buffed Magic the heal also scales off
    expect(barrier).toBe(Math.round(0.4 * 51));
    expect(calculateHealing(druid, heal)).toBe(Math.round(0.52 * 51));
  });
});
