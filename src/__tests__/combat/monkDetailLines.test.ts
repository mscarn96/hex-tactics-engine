import { withHardenedShell } from '@/systems/combat/passives';
import { ironCarapace } from '@/data/skills/mastery/beetle';
import { twinReap } from '@/data/skills/mastery/mantis';
import { skillSimpleText } from '@/data/display/simpleText';
import { describeSkillSegments, skillEffectLines } from '@/data/display/skillDisplay';
import { PassiveId } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';

/**
 * Detailed is never shorter than Simple (playtest 2026-10-30): with Hardened
 * Shell, Iron Carapace's Simple line spoke of the Taunt and the dash and its
 * Detailed view of neither; Twin Reap's Detailed had no Bleed rule at all.
 */
const detailed = (skill: typeof ironCarapace, unit: ReturnType<typeof makeUnit>) =>
  [describeSkillSegments(skill, unit).map((s) => s.text).join(''), ...skillEffectLines(skill, unit, [unit])].join(' ');

it('Iron Carapace with Hardened Shell says in Detailed what Simple says, and more', () => {
  const rank = { level: 2, scale: 1 };
  const unit = makeUnit({ isPlayer: true, passives: ['hardenedShell'] as PassiveId[], passiveRanks: { hardenedShell: rank }, stats: makeStats({ attack: 20 }) });
  const skill = withHardenedShell(ironCarapace, { hardenedShell: rank });
  const text = detailed(skill, unit);
  expect(text).toMatch(/Carapace/);
  expect(text).toMatch(/Taunted/);
  expect(text).toMatch(/turn does not end/);
  expect(text.length).toBeGreaterThan(skillSimpleText(skill, unit)!.length);
});

it('Twin Reap names the Bleed reap and each held node in Detailed', () => {
  const unit = makeUnit({ isPlayer: true, passives: ['bleedHarvest', 'reapingMomentum'] as PassiveId[], stats: makeStats({ attack: 20 }) });
  const text = detailed(twinReap, unit);
  expect(text).toMatch(/Bleeding/);
  expect(text).toMatch(/remaining damage/);
  expect(text).toMatch(/same enemy/);
  expect(text.length).toBeGreaterThan(skillSimpleText(twinReap, unit)!.length);
});
