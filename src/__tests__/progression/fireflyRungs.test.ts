import { firefly } from '@/data/skills/trees/firefly';
import { nodeSimpleText } from '@/data/display/simpleText';
import { skillEffectLines } from '@/data/display/skillDisplay';
import { nodeSkillAt } from '@/systems/progression/mastery';

/**
 * Playtest 2026-10-23: the Firefly's tree read 41% and 69% — a 55% share scaled by
 * the 0.75 / 1.25 rungs. Its shares are authored as multiples of 20% so every rung
 * reads a round figure; any percentage of 10 or more on its nodes is a multiple of 5.
 */
const percents = (text: string) => [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));

describe('the Firefly tree at every rung', () => {
  for (const node of firefly.nodes) {
    it(`${node.id} shows round percentages`, () => {
      for (let level = 1; level <= (node.maxLevel ?? 3); level++) {
        const skill = node.grantsSkill ? nodeSkillAt(node, level) : undefined;
        const text = [
          nodeSimpleText(node, level) ?? '',
          ...(skill ? skillEffectLines(skill).map((line) => JSON.stringify(line)) : []),
        ].join(' ');
        for (const p of percents(text)) if (p >= 10) expect(`${node.id} L${level}: ${p % 5 === 0 ? 'round' : `${p}%`}`).toBe(`${node.id} L${level}: round`);
      }
    });
  }
});
