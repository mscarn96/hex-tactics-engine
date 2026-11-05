


import * as Crypto from '@/platform/uuid';


import { CombatUnit, HexCoord, ArenaHazard } from '@/models/types';

import { getHexLine, getNeighbors, hexKey } from '@/utils/hexUtils';

import { isRooted } from '@/systems/combat/statusEffects';












import { inDuelCircle } from '@/systems/combat/duelRules';

import { inArena, solidKeys } from '@/systems/combat/arenaGeometry';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';



/** One hex's best route in `walkSearch`: its price, compared field by field, and where it came from. */
interface WalkLabel {
  /** Movement points spent — the only part the budget limits. */
  cost: number;
  /** Hexes of hostile burning ground stepped onto: among equal routes, the one around the fire. */
  burn: number;
  /** Steps off the straight line: among equal routes, the one that reads as walking straight. */
  bend: number;
  prev: string | null;
  hex: HexCoord;
}


const cheaper = (a: WalkLabel, b: WalkLabel) =>
  a.cost !== b.cost ? a.cost < b.cost : a.burn !== b.burn ? a.burn < b.burn : a.bend < b.bend;


/**
 * Every hex a unit can walk to with `range` movement points, and the route to each.
 *
 * A walk goes hex to hex. A hex holding any other living body — ally or enemy —
 * or solid rubble cannot be stepped through, nor can the arena's edge or a
 * duelist's rune circle, so a hex behind a wall of bodies is reachable only
 * around the wall, within the budget. Ground that costs extra to enter (frozen
 * ground, `ArenaHazard.moveCost`) is priced on the way. Among routes of equal
 * price the one that crosses less of an enemy's burning ground wins, and then
 * the one closest to the straight line to `toward`, so the route drawn is the one
 * a player would expect and the fire it pays (`settleCrossings`) is no more than
 * it has to be.
 */
function walkSearch(
  unit: CombatUnit,
  range: number,
  allUnits: CombatUnit[],
  hazards: readonly ArenaHazard[],
  toward?: HexCoord,
): Map<string, WalkLabel> {
  const from = unit.position;
  const blocked = solidKeys(hazards);
  for (const u of allUnits) if (u.currentHp > 0 && u.id !== unit.id) blocked.add(hexKey(u.position));
  const extra = new Map<string, number>();
  const burning = new Set<string>();
  for (const hazard of hazards) {
    if (hazard.moveCost) {
      for (const hex of hazard.hexes) extra.set(hexKey(hex), Math.max(extra.get(hexKey(hex)) ?? 0, hazard.moveCost));
    }
    if (!hazard.crossDamage || hazard.crossDamage <= 0) continue;
    const owner = hazard.ownerId ? allUnits.find((u) => u.id === hazard.ownerId) : undefined;
    if (owner && owner.isPlayer !== unit.isPlayer) for (const hex of hazard.hexes) burning.add(hexKey(hex));
  }
  const line = new Set(toward ? getHexLine(from, toward).map(hexKey) : []);

  const start = hexKey(from);
  const best = new Map<string, WalkLabel>([[start, { cost: 0, burn: 0, bend: 0, prev: null, hex: { q: from.q, r: from.r } }]]);
  const done = new Set<string>();
  const frontier: string[] = [start];
  while (frontier.length > 0) {
    // Cheapest first: the budget is tiny, so a scan is cheaper than a heap
    let at = 0;
    for (let i = 1; i < frontier.length; i++) if (cheaper(best.get(frontier[i])!, best.get(frontier[at])!)) at = i;
    const key = frontier.splice(at, 1)[0];
    if (done.has(key)) continue;
    done.add(key);
    const here = best.get(key)!;
    for (const next of getNeighbors(here.hex)) {
      const nextKey = hexKey(next);
      if (done.has(nextKey) || blocked.has(nextKey)) continue;
      if (!inArena(next) || !inDuelCircle(unit, next)) continue;
      const label: WalkLabel = {
        cost: here.cost + 1 + (extra.get(nextKey) ?? 0),
        burn: here.burn + (burning.has(nextKey) ? 1 : 0),
        bend: here.bend + (toward && !line.has(nextKey) ? 1 : 0),
        prev: key,
        hex: { q: next.q, r: next.r },
      };
      if (label.cost > range) continue;
      const known = best.get(nextKey);
      if (known && !cheaper(label, known)) continue;
      best.set(nextKey, label);
      frontier.push(nextKey);
    }
  }
  return best;
}


/** How far `unit` may walk this turn before the ground prices it: effective, and capped for a reposition. */
function walkBudget(unit: CombatUnit): number {
  // Effective, not base: a wolf's extra reach and a passive's move bonus both
  // live there, and reading `unit.stats` would silently discard both.
  // Mark and Move's reposition is a short step, never a fresh full move
  const full = getCombatEffectiveStats(unit).moveRange;
  return unit.repositionCap != null ? Math.min(full, unit.repositionCap) : full;
}


/**
 * The hexes `unit` can walk to this turn: every free hex with a route to it
 * (`walkSearch`) inside the budget. Shared by the player's Move button and the
 * AI's repositioning, so an enemy is held by a line of bodies exactly as a hero is.
 */
export function getMovementRange(
  unit: CombatUnit,
  allUnits: CombatUnit[],
  /**
   * The ground that remembers. A solid hazard (rubble) can be neither entered
   * nor walked through, so a hero and an enemy both refuse it — the same rule a
   * shove obeys in `traceForcedMove`. Omitted, nothing is solid.
   */
  hazards: ArenaHazard[] = [],
): HexCoord[] {
  // Root pins the unit in place but leaves it free to act — the exact inverse of
  // Silence. One check here covers the player's Move button, the AI's
  // repositioning, and anything else that asks where a unit could go.
  if (isRooted(unit)) return [];
  const start = hexKey(unit.position);
  return [...walkSearch(unit, walkBudget(unit), allUnits, hazards).entries()]
    .filter(([key]) => key !== start)
    .map(([, label]) => label.hex);
}


/**
 * The route an ordinary move walks from `unit`'s hex to `to`: every hex on the
 * way, both ends included, or `null` when `to` is not in `getMovementRange`.
 * The same search, so a hex is offered exactly when a route to it exists; the
 * walk is drawn along it, timed by its length, and burned by what it crosses.
 */
export function findMovePath(
  unit: CombatUnit,
  to: HexCoord,
  allUnits: CombatUnit[],
  hazards: ArenaHazard[] = [],
): HexCoord[] | null {
  if (isRooted(unit)) return null;
  const goal = hexKey(to);
  if (goal === hexKey(unit.position)) return null;
  const best = walkSearch(unit, walkBudget(unit), allUnits, hazards, to);
  if (!best.has(goal)) return null;
  const path: HexCoord[] = [];
  for (let key: string | null = goal; key !== null; key = best.get(key)!.prev) path.push(best.get(key)!.hex);
  return path.reverse();
}
