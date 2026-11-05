import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { skillEffectLines, skillStatLine } from '@/data/display/skillDisplay';
import { summonStatsFor } from '@/systems/combat/summoning';
import { findSummonTemplate } from '@/data/templates/summonTemplates';
import { nodeModifierAt, nodeSkillAt, masteryModifiers } from '@/systems/progression/mastery';
import { skillEffects } from '@/systems/combat/statusEffects';
import { Hero } from '@/models/types';

const node = (id: string) => MASTERY_PATHS.flatMap((p) => p.nodes).find((n) => n.id === id)!;
const ranks = [1, 2, 3];

describe('ranks that used to buy nothing', () => {
  it.each([
    ['berserker_carnage', [3, 4, 5]],
    ['marks_rapid_fire', [3, 4, 5]],
    ['skirm_flurry', [3, 4, 5]],
  ])('%s lasts %j turns by rank', (id, turns) => {
    const lasts = ranks.map((r) => skillEffects(nodeSkillAt(node(id), r)!)[0].duration);
    expect(lasts).toEqual(turns);
    // And the tree can say so
    const lines = ranks.map((r) => skillEffectLines(nodeSkillAt(node(id), r)!).join('|'));
    expect(new Set(lines).size).toBe(3);
  });

  it('Primal Surge cools down in 9 / 8 / 7 turns', () => {
    const cooldowns = ranks.map((r) => nodeSkillAt(node('wild_primal_surge'), r)!.cooldown);
    expect(cooldowns).toEqual([9, 8, 7]);
    expect(ranks.map((r) => skillStatLine(nodeSkillAt(node('wild_primal_surge'), r)!)).join('|'))
      .toContain('9t cooldown');
  });

  it('Barkskin grants 2 / 3 / 4 defence', () => {
    expect(ranks.map((r) => nodeModifierAt(node('life_barkskin'), r).healGrantsDefense)).toEqual([2, 3, 4]);
    const held = (level: number) => masteryModifiers({
      masteryPath: 'lifewarden', masteryNodes: { life_barkskin: level },
    } as unknown as Hero).healGrantsDefense;
    expect([1, 2, 3].map(held)).toEqual([2, 3, 4]);
  });

  it.each([
    'pyro_elemental', 'life_treant', 'stone_heart',
  ])('%s summons at 75%% / 100%% / 125%% strength, and the tree says so', (id) => {
    const specs = ranks.map((r) => nodeSkillAt(node(id), r)!.summons!);
    expect(specs.map((s) => s.statScale)).toEqual([0.75, 1, 1.25]);
    const lines = ranks.map((r) => skillEffectLines(nodeSkillAt(node(id), r)!).join('|'));
    expect(lines[0]).toContain('75% strength');
    expect(lines[2]).toContain('125% strength');
  });

  it('a summon\'s sheet follows the rank, from the same template numbers', () => {
    const template = findSummonTemplate('treant')!;
    const [low, mid, high] = [0.75, 1, 1.25].map((k) => summonStatsFor(template, 10, k));
    expect(mid).toEqual(summonStatsFor(template, 10));
    expect(low.maxHp).toBeLessThan(mid.maxHp);
    expect(high.maxHp).toBeGreaterThan(mid.maxHp);
    expect(high.attack).toBeGreaterThan(low.attack);
  });
});
