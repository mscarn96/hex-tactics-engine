import { LAIR_SPECS, LocationDef, LocationId, getLocation } from '@/locations';
import { EMPIRE_LAIRS } from '@/locations/lairs';
import { triggerKey } from '@/locations/types';
import { BALANCE } from '@/data/balanceConstants';
import { contentBand } from '@/data/levelCap';
import { bandGateBase } from '@/systems/world/worldBands';

/**
 * What the lairs are worth, and when they open.
 *
 * Pure: everything is derived from the spent-trigger set the save already keeps.
 * There is no "lairs cleared" field, because a second record of the same fact is
 * a second thing that can be wrong — a save where the boss trigger is spent and
 * the counter says zero would silently cost the player a hero.
 */

/** A lair is beaten when its boss hex's trigger has been spent. */
export function isLairCleared(id: LocationId, spent: ReadonlySet<string>): boolean {
  const lair = getLocation(id).lair;
  return !!lair && spent.has(triggerKey(id, lair.bossAt));
}

/** Every lair beaten, in any world. */
export function clearedLairs(spent: ReadonlySet<string>): LocationId[] {
  return LAIR_SPECS.map((s) => s.id).filter((id) => isLairCleared(id, spent));
}

/** The Empire's lairs beaten: what the party's slots, the castle and the war's quests count. */
export function clearedEmpireLairs(spent: ReadonlySet<string>): LocationId[] {
  return EMPIRE_LAIRS.map((s) => s.id).filter((id) => isLairCleared(id, spent));
}

/**
 * How many heroes the party may hold.
 *
 * The party starts short-handed and earns its width. Quests hand out *who* is
 * available; lairs hand out *room for them* — two different currencies of
 * progress, so neither is the only thing happening at a time.
 */
export function partySlots(spent: ReadonlySet<string>): number {
  return Math.min(
    BALANCE.MAX_PARTY_SIZE,
    BALANCE.PARTY_SLOTS_BASE + clearedEmpireLairs(spent).length,
  );
}

/** Every slot earned — the condition the Obsidian castle waits on. */
export function allLairsCleared(spent: ReadonlySet<string>): boolean {
  return clearedEmpireLairs(spent).length === EMPIRE_LAIRS.length;
}

/**
 * The summed level a lair opens at: its own number in the Empire, and over the band's
 * gate base in an expansion world, so it moves with the band its world took.
 */
export function lairUnlockLevel(id: LocationId): number {
  const spec = LAIR_SPECS.find((s) => s.id === id);
  const band = spec?.world ? contentBand(spec.world) : null;
  if (spec?.unlockOverBand !== undefined && band !== null) return bandGateBase(band) + spec.unlockOverBand;
  return getLocation(id).lair?.unlockLevel ?? 0;
}

export type LairGate =
  | { open: true; lair: LocationDef }
  | { open: false; lair: LocationDef; needed: number; have: number }
  | { open: false; lair: LocationDef; cleared: true };

/**
 * Whether the party may go in.
 *
 * Gated on **summed** party level, the same measure the quest gates use: a lair
 * is one fight the party has to be worth as a whole, and a solo hero at twice
 * the level is not the same thing as three at a third of it.
 */
export function lairGate(
  id: LocationId,
  partyLevel: number,
  spent: ReadonlySet<string>,
): LairGate {
  const lair = getLocation(id);
  if (!lair.lair) return { open: true, lair };
  if (isLairCleared(id, spent)) return { open: false, lair, cleared: true };
  const needed = lairUnlockLevel(id);
  return partyLevel >= needed
    ? { open: true, lair }
    : { open: false, lair, needed, have: partyLevel };
}

/**
 * Which of the Empire's lairs a boss tile leads to.
 *
 * The map places boss tiles by index and there are exactly as many tiles as
 * lairs — `mapGenerator` stops at `LAIR_SPECS.length` rather than at a
 * density-derived count, which is what fixed six tiles pointing at three bosses.
 */
export function lairForIndex(index: number): LocationId | null {
  return EMPIRE_LAIRS[index]?.id ?? null;
}
