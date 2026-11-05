import { HeroSkill } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { ALL_SKILLS } from '@/data/skills/skillData';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { AETHELRED_SKILLS } from '@/data/templates/aethelred';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import * as fallenOrder from '@/data/skills/fallenOrderSkills';
import * as factionElite from '@/data/skills/factionEliteSkills';
import * as elite from '@/data/skills/eliteSkills';
import * as yokai from '@/data/skills/yokaiSkills';
import * as draconic from '@/data/skills/draconicHostSkills';
import * as lightning from '@/data/skills/lightningSkills';

/**
 * A prepared Reaction waits for a trigger, so it needs time for the trigger to
 * come (playtest 2026-10-17, PT-10): none stands for fewer than
 * `BALANCE.REACTION_TURNS` of its owner's turns, hero or enemy.
 */

const isSkill = (v: unknown): v is HeroSkill =>
  !!v && typeof v === 'object' && typeof (v as HeroSkill).id === 'string' && 'targetType' in (v as object);

function everySkill(): HeroSkill[] {
  const seen = new Map<string, HeroSkill>();
  const add = (s: HeroSkill) => seen.set(s.id, s);
  ALL_SKILLS.forEach(add);
  MASTERY_SKILLS.forEach(add);
  AETHELRED_SKILLS.forEach(add);
  for (const template of enemyTemplates) template.skills.forEach(add);
  for (const mod of [fallenOrder, factionElite, elite, yokai, draconic, lightning]) {
    for (const value of Object.values(mod)) {
      if (isSkill(value)) add(value);
      else if (Array.isArray(value)) value.filter(isSkill).forEach(add);
    }
  }
  return [...seen.values()];
}

describe('Reaction durations', () => {
  const reactions = everySkill().filter((s) => s.reaction);

  it('finds the Reactions the game fields', () => {
    expect(reactions.map((s) => s.id)).toEqual(expect.arrayContaining([
      'carapace_leap', 'vengeful_shell', 'covering_fire', 'abbot_vow',
    ]));
  });

  it(`holds every Reaction to at least ${BALANCE.REACTION_TURNS} turns`, () => {
    expect(BALANCE.REACTION_TURNS).toBeGreaterThanOrEqual(3);
    const short = reactions
      .filter((s) => s.reaction!.duration < BALANCE.REACTION_TURNS)
      .map((s) => `${s.id}: ${s.reaction!.duration}`);
    expect(short).toEqual([]);
  });
});
