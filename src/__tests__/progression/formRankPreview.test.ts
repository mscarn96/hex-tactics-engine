import { LEVEL_SCALE, WildFormId } from '@/models/types';
import { WILD_FORMS } from '@/data/templates/wildForms';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { formFigures, formRankLines } from '@/data/display/masteryDisplay';
import { skillEffectLines, skillStatLine } from '@/data/display/skillDisplay';
import { PASSIVE_DEFS } from '@/systems/combat/passives';
import { wornForm } from '@/systems/combat/wildshape';
import {
  levelScale, maxLevelOf, nodeModifierAt, nodeSkillAt, nodeStatBonusAt,
} from '@/systems/progression/mastery';
import { makeStats, makeUnit } from '../support/fixtures';

const FORMS = Object.keys(WILD_FORMS) as WildFormId[];
const clean = (m: number) => Number(m.toFixed(2));

describe('Wildshape shape nodes preview the body each rank buys', () => {
  it.each(FORMS)('%s: the preview is what wornForm yields at that rank', (form) => {
    for (let rank = 1; rank <= LEVEL_SCALE.length; rank++) {
      // No magic and a round pool, so only the ramp is in play
      const unit = makeUnit({
        id: 'd', stats: makeStats({ magic: 0, maxHp: 100 }), formRanks: { [form]: rank },
      });
      const worn = wornForm(unit, form);
      const expected = [
        ...Object.entries(worn.stats)
          .filter(([, m]) => clean(m as number) !== 1)
          .map(([k, m]) => ({ k, m: clean(m as number) })),
        ...(clean(worn.vigor) !== 1 ? [{ k: 'HP', m: clean(worn.vigor) }] : []),
      ];
      const shown = formFigures(form, rank).map((line) => {
        const [k, m] = line.split(' ×');
        return { k, m: Number(m) };
      });
      expect(shown.map((s) => s.m)).toEqual(expected.map((e) => e.m));
    }
  });

  it('shows the Bear\'s attack as ×1.19 → ×1.25 between ranks one and two', () => {
    expect(formRankLines('bear', 1, 2).join(' · ')).toContain('ATK ×1.19 → ATK ×1.25');
    expect(formRankLines('bear', 2, 3).join(' · ')).toContain('ATK ×1.25 → ATK ×1.31');
  });

  it('shows only the offer on an unowned node and only the held rung at max', () => {
    expect(formRankLines('wolf', null, 1).join()).not.toContain('→');
    expect(formRankLines('wolf', 3, null).join()).not.toContain('→');
  });

  it('leaves unchanged multipliers out', () => {
    // The Bear's move multiplier is exactly 1
    expect(formFigures('bear', 2).join()).not.toMatch(/Move/);
  });
});

/**
 * The same gap on every other node: a rank that costs a point and changes
 * nothing the panel prints. Walks all twelve trees at every rung.
 */
/** Every multi-rank node prints something that changes with its rank. */
describe('every multi-rank node shows something that changes with its rank', () => {
  const printed = (node: (typeof MASTERY_PATHS)[number]['nodes'][number], level: number) => {
    const skill = nodeSkillAt(node, level);
    const passive = node.grantsPassive ? PASSIVE_DEFS[node.grantsPassive] : undefined;
    return JSON.stringify({
      stats: nodeStatBonusAt(node, level),
      mods: nodeModifierAt(node, level),
      skill: skill ? [skillStatLine(skill), skillEffectLines(skill)] : null,
      body: skill?.shiftsTo ? formFigures(skill.shiftsTo, level) : null,
      passive: passive?.figures?.({ level, scale: levelScale(node, level) }) ?? null,
    });
  };

  it('has no node whose ranks print identically', () => {
    const flat: string[] = [];
    for (const path of MASTERY_PATHS) {
      for (const node of path.nodes) {
        const max = maxLevelOf(node);
        if (max < 2) continue;
        const rungs = Array.from({ length: max }, (_, i) => printed(node, i + 1));
        if (rungs.every((r) => r === rungs[0])) flat.push(`${path.id}/${node.id}`);
      }
    }
    expect(flat).toEqual([]);
  });
});
