import type { AchievementDefinition } from '@/models/achievements';
import { entryText } from '@/i18n/dataText';

/**
 * Catalogue approved by the designer on 2026-10-03. The words for each entry live in
 * the `achievements` locale namespace, read when shown through the helpers below.
 */
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  { id: 'still-standing', hardcore: false },
  { id: 'roadward', hardcore: false },
  { id: 'everyone-comes-home', hardcore: false },
  { id: 'under-the-warren', hardcore: false },
  { id: 'the-wyrm-falls', hardcore: false },
  { id: 'a-thaw-below', hardcore: false },
  { id: 'three-doors-shut', hardcore: false },
  { id: 'hold-the-gate', hardcore: false },
  { id: 'trouble-at-the-stones', hardcore: false },
  { id: 'a-second-chair', hardcore: false },
  { id: 'a-full-table', hardcore: false },
  { id: 'steel-at-your-side', hardcore: false },
  { id: 'sparks-at-your-side', hardcore: false },
  { id: 'roots-at-your-side', hardcore: false },
  { id: 'eyes-at-your-side', hardcore: false },
  { id: 'a-path-of-your-own', hardcore: false },
  { id: 'first-lesson', hardcore: false },
  { id: 'the-high-art', hardcore: false },
  { id: 'worth-keeping', hardcore: false },
  { id: 'a-fine-find', hardcore: false },
  { id: 'a-story-in-steel', hardcore: false },
  { id: 'beginning-to-match', hardcore: false },
  { id: 'dressed-for-legend', hardcore: false },
  { id: 'beyond-the-road', hardcore: false },
  { id: 'a-wider-country', hardcore: false },
  { id: 'water-remembers', hardcore: false },
  { id: 'a-promise-kept', hardcore: false },
  { id: 'word-gets-around', hardcore: false },
  { id: 'the-emperors-due', hardcore: false },
  { id: 'no-more-tribute', hardcore: false },
  { id: 'a-hard-crown', hardcore: false },
  { id: 'one-life-first-blood', hardcore: true },
  { id: 'one-life-deep-breath', hardcore: true },
  { id: 'one-life-no-emperor', hardcore: true },
];

export const achievementName = (id: string) => entryText('achievements', id, 'name');
export const achievementFlavour = (id: string) => entryText('achievements', id, 'flavour');
export const achievementCondition = (id: string) => entryText('achievements', id, 'condition');
