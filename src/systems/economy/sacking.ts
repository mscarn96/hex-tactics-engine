import { BALANCE } from '@/data/balanceConstants';
import type { Building, BuildingData, ResourceType } from '@/models/types';

/**
 * The sacking of the town after a lost siege, as a rule on days.
 *
 * Losing the siege drops every service to level 0 (`encounterResolution.ts`),
 * but each remembers the level it stood at (`Building.rebuildTo`): raising it
 * back to that level costs `REBUILD_COST_FRACTION` of each step's price;
 * for `SACK_DAYS` after it the town also *looks* sacked — each service drawn
 * as its level-0 building charred and holed (`town_<service>_sacked`) — and
 * then as its level-0 building again. The town stays open throughout.
 *
 * Kept as a day the sacking ends rather than a day it began, so "is it still
 * sacked" is one comparison against the calendar and a save holds one number.
 */

/** The first day the town is no longer sacked, for a siege lost on `today`. */
export function sackedUntil(today: number): number {
  return today + BALANCE.SACK_DAYS;
}

/** Whether the town still looks sacked on `today`. `until` 0 is a town never sacked. */
export function isSacked(today: number, until: number): boolean {
  return today < until;
}

/** A building after the sack: level 0, remembering the highest level it has to rebuild to. */
export function sackBuilding(b: Building): Building {
  const rebuildTo = Math.max(b.level, b.rebuildTo ?? 0);
  return rebuildTo > 0 ? { type: b.type, level: 0, rebuildTo } : { type: b.type, level: 0 };
}

/** Whether the next step up for `b` rebuilds a level the sack took, at the discounted price. */
export function isRebuild(b: Building): boolean {
  return b.level < (b.rebuildTo ?? 0);
}

/**
 * The price of `b`'s next level: the building's own step, or `REBUILD_COST_FRACTION`
 * of it (rounded up) while it is still below the level a sack took from it. Null at
 * the top.
 */
export function nextLevelCost(data: BuildingData, b: Building): Record<ResourceType, number> | null {
  if (b.level >= data.maxLevel) return null;
  const step = data.upgradeCosts[b.level];
  if (!step) return null;
  if (!isRebuild(b)) return step;
  const out = { ...step };
  for (const k of Object.keys(out) as ResourceType[]) out[k] = Math.ceil(out[k] * BALANCE.REBUILD_COST_FRACTION);
  return out;
}

/** The building one level up; the remembered level is dropped once it is reached again. */
export function raisedBuilding(b: Building): Building {
  const level = b.level + 1;
  return (b.rebuildTo ?? 0) > level ? { ...b, level } : { type: b.type, level };
}
