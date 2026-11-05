import { useAscentStore } from '@/stores/ascentStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import type { WorldId } from '@/data/worlds';
import { liveWrath, summitWindowHours, weatherAt, type WrathAward, type WrathSource, type WrathWeather } from '@/systems/world/wrath';
import { blessedWrathPower, type Vows } from '@/systems/world/monastery';

/**
 * Where the pure wrath and monastery rules meet the stores: the reading now,
 * the weather now, what a fight starting now is built with, and the one door
 * every Jadeveil gain goes through.
 *
 * **Only Jadeveil has wrath.** Its bar keeps decaying with the shared clock
 * while the party is in the Empire, but the Empire's sky, fights and dawn are
 * never touched by it, and its vows are not in force there.
 */
export function inJadeveil(world: WorldId = useWorldMapStore.getState().worldId): boolean {
  return world === 'jadeveil';
}

export function wrathNow(): number {
  return liveWrath(useAscentStore.getState().wrath, useCalendarStore.getState().totalHours);
}

export function summitWindowNow(): number {
  return summitWindowHours(useAscentStore.getState().wrath, useCalendarStore.getState().totalHours);
}

export function weatherNow(): WrathWeather {
  return weatherAt(useAscentStore.getState().wrath, useCalendarStore.getState().totalHours);
}

/** What a fight starting now is built with: wrath's multiplier and the vows in Jadeveil, nothing elsewhere. */
export function jadeveilFightTerms(): { wrathPower?: number; vows?: Vows } {
  if (!inJadeveil()) return {};
  const { vows } = useAscentStore.getState();
  return { wrathPower: blessedWrathPower(wrathNow(), vows), vows };
}

/**
 * Award a deliberate Jadeveil deed — a quest done, a lair cleared — when it
 * was done in Jadeveil. `null` anywhere else: the Empire's work never provokes
 * the range.
 */
export function provokeJadeveil(source: WrathSource): WrathAward | null {
  if (!inJadeveil()) return null;
  return useAscentStore.getState().gainWrath(source);
}
