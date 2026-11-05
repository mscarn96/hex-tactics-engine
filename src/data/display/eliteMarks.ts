import { painFeastThreshold, winterSleepTurns } from '@/systems/combat/displayNumbers';
import { AfflictionType, AuraType, CombatUnit } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { hasPassive } from '@/systems/combat/passives';
import { rageStacks, warbandTargetFor } from '@/systems/combat/eliteKits';

/**
 * What the arena draws *on a unit* to say an elite's signature is in play —
 * the tell that has to be read before the consequence lands.
 *
 * `eliteLinks` draws the relationships (who holds whom, who serves whom); this
 * is the state of one body: a lethal save not yet spent, a sleep counting down
 * to a full-health wake, a Rage gauge filling, a hero an elite has named, an
 * Orc answering the Warchief. Every one of these was readable only as a status
 * badge on the unit card, which a player has to tap to see — and the board is
 * where the decision is made: *do I kill the Bear now or wait*, *who is the
 * Warchief sending at*, *how close is the feast*.
 *
 * Pure and React-free, so the table is checkable in Node; `EliteMarks` in the
 * arena draws it.
 */
export type EliteMark =
  /** A once-a-fight lethal save not yet spent: the first killing blow will not kill it. */
  | { kind: 'save'; colour: string }
  /** Asleep, waking at full health when the count runs out (its own turns). */
  | { kind: 'sleep'; turnsLeft: number; of: number }
  /** Pain Feast's Rage: separate blows taken, out of the threshold that brings the feast. */
  | { kind: 'rage'; stacks: number; of: number }
  /** A hero an elite has named. The shape says which kind of naming it is. */
  | { kind: 'named'; colour: string; shape: NamedShape }
  /** An Orc carrying out the Warchief's order, making for the hero he named. */
  | { kind: 'answering'; colour: string };

/**
 * `chevron` points down at a hero someone is coming for (the Warchief's order);
 * `sigil` turns over the head of a hero something has taken hold of (the Mage's
 * hold, the Crone's curse); `crack` is drawn on the ground under a hero the ground
 * will open round (the Overseer's Fracture).
 */
export type NamedShape = 'chevron' | 'sigil' | 'crack';

export const ELITE_MARK_COLOUR = {
  winterSave: '#9ec8ff',
  soulSave: '#c8f0ff',
  warband: '#ff7a3c',
  mind: '#c24dff',
  geas: '#b07ae0',
  fracture: '#ffb050',
} as const;

const alive = (u: CombatUnit): boolean => u.currentHp > 0;
const spent = (u: CombatUnit): boolean => u.activeEffects.some((e) => e.type === AuraType.UndyingSpent);

export function eliteMarks(unit: CombatUnit, units: CombatUnit[]): EliteMark[] {
  if (!alive(unit)) return [];
  const out: EliteMark[] = [];

  // The lethal saves, while they are still to come
  if (!spent(unit) && hasPassive(unit, 'winterSleep')) out.push({ kind: 'save', colour: ELITE_MARK_COLOUR.winterSave });
  if (!spent(unit) && hasPassive(unit, 'soulFracture')) out.push({ kind: 'save', colour: ELITE_MARK_COLOUR.soulSave });

  // The sleep the Bear's save put it in, and how long the party has
  const sleep = unit.activeEffects.find((e) => e.type === AuraType.Slumber);
  if (sleep) {
    out.push({ kind: 'sleep', turnsLeft: Math.max(1, sleep.duration), of: winterSleepTurns() });
  }

  // The Rage the Berserker has been fed, filling toward the feast
  if (hasPassive(unit, 'painFeast')) {
    out.push({ kind: 'rage', stacks: Math.min(rageStacks(unit), painFeastThreshold()), of: painFeastThreshold() });
  }

  // A hero an elite has named, by what it did
  const named = (type: AfflictionType) => unit.activeEffects.some((e) => e.type === type);
  if (named(AfflictionType.Warband)) out.push({ kind: 'named', colour: ELITE_MARK_COLOUR.warband, shape: 'chevron' });
  if (named(AfflictionType.MindControl)) out.push({ kind: 'named', colour: ELITE_MARK_COLOUR.mind, shape: 'sigil' });
  if (named(AfflictionType.Geas)) out.push({ kind: 'named', colour: ELITE_MARK_COLOUR.geas, shape: 'sigil' });
  if (named(AfflictionType.Fracture)) out.push({ kind: 'named', colour: ELITE_MARK_COLOUR.fracture, shape: 'crack' });

  // An Orc the order is moving: the same question its AI asks, so the ring and the walk agree
  if (warbandTargetFor(unit, units)) out.push({ kind: 'answering', colour: ELITE_MARK_COLOUR.warband });

  return out;
}
