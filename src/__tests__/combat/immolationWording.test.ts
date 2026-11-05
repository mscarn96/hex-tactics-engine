import { SkillTargetType } from '@/models/types';
import { immolation } from '@/data/skills/mastery/arcanist';
import { pyromancer } from '@/data/skills/trees/arcanist';
import { masteryNodeDescription } from '@/data/display/masteryText';
import { skillDescription } from '@/data/gameText';

/**
 * Immolation is an aimed blast of radius two, not a field-wide detonation; the
 * tree node and the skill have to say the same thing about it.
 */
describe('Immolation wording', () => {
  const node = pyromancer.nodes.find((n) => n.id === 'pyro_immolation')!;

  it('is an aimed ring, so the words must not promise the whole field', () => {
    expect(immolation.targetType).toBe(SkillTargetType.Ring);
    expect(immolation.range).toBeGreaterThan(0);
    expect(immolation.aoeRadius).toBeLessThan(9);
    for (const text of [skillDescription(immolation), masteryNodeDescription(node)]) {
      expect(text).not.toMatch(/field|every fire/i);
      expect(text).toMatch(/Burn/);
      expect(text).toMatch(/target/);
    }
  });

  it('gives the tree and the skill the same sentence', () => {
    expect(masteryNodeDescription(node)).toBe(skillDescription(immolation));
  });
});
