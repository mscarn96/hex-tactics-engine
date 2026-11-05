import { AfflictionType, SkillTargetType } from '@/models/types';
import { ALL_SKILLS } from '@/data/skills/skillData';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import {
  nothingInRange, rootedRefusal, noTargetsMessage, skillBlockedReason,
} from '@/systems/combat/skillAvailability';
import { makeUnit } from '../support/fixtures';

const EVERY_SKILL = [...ALL_SKILLS, ...MASTERY_SKILLS];
// Slip the Net takes the Root off before it moves, so it is the one move a Root never stops
const moves = EVERY_SKILL.filter((s) => (s.selfMove?.kind === 'free' || s.selfMove?.kind === 'blink') && !s.slipsBonds);

const rooted = makeUnit({
  id: 'r',
  activeEffects: [{ type: AfflictionType.Root, magnitude: 0, duration: 2, sourceUnitId: 'x' }],
});
const free = makeUnit({ id: 'f' });

describe('why a skill found nothing to aim at', () => {
  it('has self-move skills to test', () => {
    expect(moves.length).toBeGreaterThan(0);
  });

  it.each(moves.map((s) => [s.id, s] as const))('%s names the Root, never "Nothing in range"', (_id, skill) => {
    expect(getValidSkillTargetHexes(skill, rooted, [rooted])).toEqual([]);
    expect(skillBlockedReason(skill, rooted)).toBe(rootedRefusal());
    expect(noTargetsMessage(skill, rooted)).toBe(rootedRefusal());
    expect(skillBlockedReason(skill, free)).toBeNull();
  });

  it('keeps "Nothing in range" for a plain miss', () => {
    const bolt = EVERY_SKILL.find((s) => s.targetType === SkillTargetType.Single && !s.selfMove)!;
    expect(noTargetsMessage(bolt, rooted)).toBe(nothingInRange());
    expect(noTargetsMessage(bolt, free)).toBe(nothingInRange());
  });
});
