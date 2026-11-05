import { ACHIEVEMENTS } from '@/data/achievements';
import type { AchievementEvent } from '@/models/achievements';
import { HeroClass, Rarity } from '@/models/types';
import { matchingAchievements, readAchievements, unlockAchievements } from '@/systems/progression/achievements';

const hardcore = { campaign: true, harness: false, difficulty: 'hard' as const, hardcore: true };
const victory = (encounterId = 'road', clean = false): AchievementEvent => ({ kind: 'victory', key: 'fight', encounterId, clean });
const scenarios: [string, AchievementEvent, number, string[]][] = [
  ['first fight with a fallen hero', victory(), 1, ['still-standing', 'one-life-first-blood']],
  ['tenth fight and everyone alive', victory('road', true), 10, ['still-standing', 'roadward', 'everyone-comes-home', 'one-life-first-blood']],
  ['Warren boss victory', victory('lair_warren_boss'), 1, ['still-standing', 'under-the-warren', 'one-life-first-blood']],
  ['Hollow boss victory', victory('lair_wyrm_boss'), 1, ['still-standing', 'the-wyrm-falls', 'one-life-first-blood']],
  ['Glacier boss victory', victory('lair_barrow_boss'), 1, ['still-standing', 'a-thaw-below', 'one-life-first-blood']],
  ['siege victory', victory('empire_siege_5'), 1, ['still-standing', 'hold-the-gate', 'one-life-first-blood']],
  ['combat site cleared', { kind: 'site' }, 0, ['trouble-at-the-stones']],
  ['Champion recruited', { kind: 'recruit', heroClass: HeroClass.Warrior, size: 2 }, 0, ['a-second-chair', 'steel-at-your-side']],
  ['Arcanist recruited', { kind: 'recruit', heroClass: HeroClass.Mage, size: 2 }, 0, ['a-second-chair', 'sparks-at-your-side']],
  ['Druid recruited', { kind: 'recruit', heroClass: HeroClass.Healer, size: 2 }, 0, ['a-second-chair', 'roots-at-your-side']],
  ['Hunter completes the party', { kind: 'recruit', heroClass: HeroClass.Ranger, size: 4 }, 0, ['a-second-chair', 'a-full-table', 'eyes-at-your-side']],
  ['mastery chosen', { kind: 'mastery', action: 'path' }, 0, ['a-path-of-your-own']],
  ['node bought', { kind: 'mastery', action: 'node' }, 0, ['first-lesson']],
  ['capstone bought', { kind: 'mastery', action: 'capstone' }, 0, ['first-lesson', 'the-high-art']],
  ['Rare acquired', { kind: 'item', rarity: Rarity.Rare }, 0, ['worth-keeping']],
  ['Epic acquired', { kind: 'item', rarity: Rarity.Epic }, 0, ['a-fine-find']],
  ['Legendary acquired', { kind: 'item', rarity: Rarity.Legendary }, 0, ['a-story-in-steel']],
  ['three set pieces worn', { kind: 'equipment', pieces: 3 }, 0, ['beginning-to-match']],
  ['full set worn', { kind: 'equipment', pieces: 7 }, 0, ['beginning-to-match', 'dressed-for-legend']],
  ['100 tiles explored', { kind: 'explore', tiles: 100 }, 0, ['beyond-the-road']],
  ['500 tiles explored', { kind: 'explore', tiles: 500 }, 0, ['beyond-the-road', 'a-wider-country']],
  ['well used', { kind: 'well' }, 0, ['water-remembers']],
  ['first hand-in', { kind: 'quest', completed: 1 }, 0, ['a-promise-kept']],
  ['fifth hand-in', { kind: 'quest', completed: 5 }, 0, ['a-promise-kept', 'word-gets-around']],
  ['tribute paid', { kind: 'tribute' }, 0, ['the-emperors-due']],
  ['first lair cleared', { kind: 'lairs', cleared: 1 }, 0, ['one-life-deep-breath']],
  ['third lair cleared', { kind: 'lairs', cleared: 3 }, 0, ['three-doors-shut', 'one-life-deep-breath']],
  ['campaign won', { kind: 'castle' }, 0, ['no-more-tribute', 'a-hard-crown', 'one-life-no-emperor']],
];

it.each(scenarios)('%s unlocks exactly its conditions', (_name, event, count, expected) => {
  expect(matchingAchievements(event, count, hardcore).sort()).toEqual([...expected].sort());
});

it('every approved achievement has an event witness and a unique id', () => {
  expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(25);
  expect(ACHIEVEMENTS.length).toBeLessThanOrEqual(35);
  expect(new Set(ACHIEVEMENTS.map(a => a.id)).size).toBe(ACHIEVEMENTS.length);
  expect([...new Set(scenarios.flatMap(s => s[3]))].sort()).toEqual(ACHIEVEMENTS.map(a => a.id).sort());
});

it.each(scenarios)('%s earns nothing on Easy, outside a campaign, or in a harness', (_name, event, count) => {
  for (const override of [{ difficulty: 'easy' as const }, { campaign: false }, { harness: true }]) {
    expect(matchingAchievements(event, count, { ...hardcore, ...override })).toEqual([]);
  }
});

it.each(['medium', 'hard'] as const)('Hardcore entries cannot unlock on ordinary %s', difficulty => {
  const earned = scenarios.flatMap(s => matchingAchievements(s[1], s[2], { ...hardcore, difficulty, hardcore: false }));
  expect(earned.filter(id => ACHIEVEMENTS.find(a => a.id === id)!.hardcore)).toEqual([]);
  expect(matchingAchievements({ kind: 'castle' }, 0, { ...hardcore, difficulty, hardcore: false }))
    .toEqual(difficulty === 'medium' ? ['no-more-tribute'] : ['no-more-tribute', 'a-hard-crown']);
});

it('near milestones, starters, common gear and unfinished sites do not grant milestones', () => {
  expect(matchingAchievements({ kind: 'recruit', size: 1, heroClass: HeroClass.Warrior }, 0, hardcore)).toEqual([]);
  for (const event of [
    { kind: 'equipment', pieces: 2 }, { kind: 'explore', tiles: 99 },
    { kind: 'quest', completed: 0 }, { kind: 'lairs', cleared: 0 }, { kind: 'item', rarity: Rarity.Common },
  ] as AchievementEvent[]) expect(matchingAchievements(event, 0, hardcore)).toEqual([]);
  expect(matchingAchievements(victory('lair_warren_1'), 9, hardcore))
    .toEqual(['still-standing', 'one-life-first-blood']);
});

it('duplicate unlocks preserve the first earned date and raise no change', () => {
  const first = unlockAchievements({}, ['still-standing'], '2026-10-03T10:00:00.000Z');
  expect(unlockAchievements(first, ['still-standing'], '2026-10-04T10:00:00.000Z')).toBe(first);
  expect(unlockAchievements(first, ['unknown'], '2026-10-04T10:00:00.000Z')).toBe(first);
  expect(readAchievements({ ...first, 'a-full-table': 'invalid', unknown: '2026-10-03' })).toEqual(first);
});
