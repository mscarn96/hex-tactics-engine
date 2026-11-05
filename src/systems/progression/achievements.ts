import { isLegendaryGrade } from '@/data/items/rarity';
import { ACHIEVEMENTS } from '@/data/achievements';
import type { AchievementEvent, EarnedAchievements } from '@/models/achievements';
import type { RunOptions } from '@/models/run';

export interface AchievementContext extends RunOptions {
  campaign: boolean;
  harness: boolean;
}

export function eligibleForAchievements(context: AchievementContext): boolean {
  return context.campaign && !context.harness && (context.difficulty === 'medium' || context.difficulty === 'hard');
}

/** All thresholds are authored goals, rather than combat balance values. */
export function matchingAchievements(event: AchievementEvent, victories: number, context: AchievementContext): string[] {
  if (!eligibleForAchievements(context)) return [];
  const ids: string[] = [];
  const add = (id: string, condition = true) => { if (condition) ids.push(id); };
  switch (event.kind) {
    case 'victory':
      add('still-standing');
      add('roadward', victories >= 10);
      add('everyone-comes-home', event.clean);
      add('under-the-warren', event.encounterId === 'lair_warren_boss');
      add('the-wyrm-falls', event.encounterId === 'lair_wyrm_boss');
      add('a-thaw-below', event.encounterId === 'lair_barrow_boss');
      add('hold-the-gate', /^empire_siege_\d+$/.test(event.encounterId));
      add('one-life-first-blood');
      break;
    case 'recruit':
      add('a-second-chair', event.size >= 2);
      add('a-full-table', event.size >= 4);
      if (event.size >= 2) {
        // The Monk has no recruit achievement of its own yet
        const byClass: Partial<Record<string, string>> = { warrior: 'steel-at-your-side', mage: 'sparks-at-your-side', healer: 'roots-at-your-side', ranger: 'eyes-at-your-side' };
        const earned = byClass[event.heroClass];
        if (earned) add(earned);
      }
      break;
    case 'mastery':
      add('a-path-of-your-own', event.action === 'path');
      add('first-lesson', event.action !== 'path');
      add('the-high-art', event.action === 'capstone');
      break;
    case 'item':
      add('worth-keeping', event.rarity === 'rare');
      add('a-fine-find', event.rarity === 'epic');
      add('a-story-in-steel', isLegendaryGrade(event.rarity));
      break;
    case 'equipment':
      add('beginning-to-match', event.pieces >= 3);
      add('dressed-for-legend', event.pieces >= 7);
      break;
    case 'explore':
      add('beyond-the-road', event.tiles >= 100);
      add('a-wider-country', event.tiles >= 500);
      break;
    case 'well': add('water-remembers'); break;
    case 'site': add('trouble-at-the-stones'); break;
    case 'quest':
      add('a-promise-kept', event.completed >= 1);
      add('word-gets-around', event.completed >= 5);
      break;
    case 'tribute': add('the-emperors-due'); break;
    case 'lairs':
      add('three-doors-shut', event.cleared >= 3);
      add('one-life-deep-breath', event.cleared >= 1);
      break;
    case 'castle':
      add('no-more-tribute');
      add('a-hard-crown', context.difficulty === 'hard');
      add('one-life-no-emperor');
      break;
  }
  return ids.filter(id => {
    const definition = ACHIEVEMENTS.find(a => a.id === id)!;
    return !definition.hardcore || (context.difficulty === 'hard' && context.hardcore);
  });
}

export function unlockAchievements(earned: EarnedAchievements, ids: readonly string[], date: string): EarnedAchievements {
  const fresh = ids.filter(id => earned[id] === undefined && ACHIEVEMENTS.some(a => a.id === id));
  return fresh.length === 0 ? earned : { ...earned, ...Object.fromEntries(fresh.map(id => [id, date])) };
}

/** A corrupt entry cannot hide the rest of a player's profile. */
export function readAchievements(raw: unknown): EarnedAchievements {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([id, date]) =>
    ACHIEVEMENTS.some(a => a.id === id) && typeof date === 'string' && Number.isFinite(Date.parse(date))));
}
