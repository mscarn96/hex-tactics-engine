import { decideEnemyAction } from '@/systems/combat/enemyAI';
import { raiseDead, darkBolt } from '@/data/skills/skillData';
import { CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';

const unit = (id: string, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ id, isPlayer: false, stats: makeStats({ maxHp: 60, attack: 8, defense: 4, magic: 12, moveRange: 2, maxMana: 0 }), ...over });

const skillIdsIn = (actions: ReturnType<typeof decideEnemyAction>) =>
  actions.filter((a) => a.type === 'skill').map((a) => a.skill?.id);

describe('enemy AI and summons', () => {
  const hero = (pos: HexCoord) => unit('hero', { isPlayer: true, heroId: 'h1', position: pos });

  // evaluateSkill returns null at zero damage, so without a dedicated branch a
  // summon scores nothing and is never chosen — the bug this test pins down
  it('casts a summon at all', () => {
    const caster = unit('mage', { skills: [raiseDead], position: { q: 0, r: 0 } });
    const actions = decideEnemyAction(caster, [caster, hero({ q: 0, r: 3 })]);
    expect(skillIdsIn(actions)).toContain('raise_dead');
  });

  it('prefers a direct hit when one is available and it already has help', () => {
    const caster = unit('mage', { skills: [darkBolt, raiseDead], position: { q: 0, r: 0 } });
    const existing = [1, 2, 3].map((i) =>
      unit(`s${i}`, { summonedBy: 'mage', position: { q: -i, r: 0 } }),
    );
    const actions = decideEnemyAction(caster, [caster, ...existing, hero({ q: 0, r: 2 })]);
    expect(skillIdsIn(actions)).toContain('dark_bolt');
  });

  it('will not cast a summon it has no room to place', () => {
    const caster = unit('mage', { skills: [raiseDead], position: { q: 0, r: 0 } });
    // Fill everything within the search radius
    const packed: CombatUnit[] = [];
    let n = 0;
    for (let q = -3; q <= 3; q++) {
      for (let r = -3; r <= 3; r++) {
        if (q === 0 && r === 0) continue;
        packed.push(unit(`p${n++}`, { position: { q, r } }));
      }
    }
    const actions = decideEnemyAction(caster, [caster, ...packed, hero({ q: 0, r: 5 })]);
    expect(skillIdsIn(actions)).not.toContain('raise_dead');
  });

  it('summons even with no player in range, since it targets itself', () => {
    const caster = unit('mage', { skills: [raiseDead], position: { q: 0, r: 0 } });
    const actions = decideEnemyAction(caster, [caster, hero({ q: 3, r: 4 })]);
    expect(skillIdsIn(actions)).toContain('raise_dead');
  });

  /**
   * A staged summon is a three-cast plan aimed at a hex the AI cannot pick.
   *
   * Nothing enemy-side carries one, and refusing to score it is cheaper than
   * teaching `evaluateSummon` a chain it will never be asked to run — but a
   * defensive line only defends if something checks it, because the failure
   * would be an enemy spending every turn placing a rock it cannot build on.
   */
  it('never scores a staged summon', () => {
    const staged: HeroSkill = {
      ...raiseDead,
      summons: {
        templateId: 'stone_heart_rock',
        count: 1,
        placement: 'aimed',
        stages: ['stone_heart_rock', 'stone_heart_stack', 'stone_elemental'],
      },
    };
    const caster = unit('mage', { skills: [staged], position: { q: 0, r: 0 } });
    const actions = decideEnemyAction(caster, [caster, hero({ q: 0, r: 3 })]);
    expect(skillIdsIn(actions)).not.toContain('raise_dead');
  });
});
