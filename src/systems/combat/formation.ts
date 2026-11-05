import { CombatUnit, EnemyTemplate, HexCoord } from '@/models/types';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { BALANCE } from '@/data/balanceConstants';
import { hexDistance } from '@/utils/hexUtils';

/**
 * A warband that fights as a formation (playtest PT-12).
 *
 * The Obsidian Legion's frontliners are its slowest bodies and its Stalker and
 * Arcanist its quickest, so a warband of individuals arrived back to front: the
 * Stalker and the Arcanist reached the party alone while the Infantry stood on
 * its spawn rank locking shields with nobody near. `EnemyTemplate.formation`
 * names who leads (`line`) and who follows (`behind`); this module answers the
 * two board questions `enemyAI` asks of them. Templates without a formation
 * are never affected.
 */

type Formation = NonNullable<EnemyTemplate['formation']>;

const FORMATION = new Map<string, Formation>(
  enemyTemplates.filter((t) => t.formation).map((t) => [t.id as string, t.formation as Formation]),
);

/** The unit's place in its warband's formation, if it has one. */
export function formationOf(unit: Pick<CombatUnit, 'templateId'>): Formation | undefined {
  return unit.templateId ? FORMATION.get(unit.templateId) : undefined;
}

/** Whether this template id spawns behind the rest of its warband. */
export const spawnsBehind = (templateId: string): boolean => FORMATION.get(templateId) === 'behind';

const nearestFoe = (pos: HexCoord, foes: readonly CombatUnit[]): number =>
  foes.reduce((best, f) => Math.min(best, hexDistance(pos, f.position)), Infinity);

/**
 * How close the line's frontmost living member stands to the nearest foe, or
 * `null` when the unit's side fields no line (none was brought, or it is dead).
 */
export function lineFront(unit: CombatUnit, allUnits: readonly CombatUnit[], foes: readonly CombatUnit[]): number | null {
  let front: number | null = null;
  for (const u of allUnits) {
    if (u.id === unit.id || u.currentHp <= 0 || u.isPlayer !== unit.isPlayer || formationOf(u) !== 'line') continue;
    const d = nearestFoe(u.position, foes);
    if (front === null || d < front) front = d;
  }
  return front;
}

/**
 * The nearest-foe distance a `behind` unit may not end a move inside of, or
 * `null` when it moves freely: it is not a `behind` unit, its side has no line,
 * or the line has engaged (`AI_LINE_ENGAGED_REACH`).
 */
export function behindLineFloor(unit: CombatUnit, allUnits: readonly CombatUnit[], foes: readonly CombatUnit[]): number | null {
  if (formationOf(unit) !== 'behind' || foes.length === 0) return null;
  const front = lineFront(unit, allUnits, foes);
  if (front === null || front <= BALANCE.AI_LINE_ENGAGED_REACH) return null;
  return front + BALANCE.AI_BEHIND_LINE_GAP;
}

/**
 * Whether a held `behind` unit may end its move on `pos`. It is never pushed back:
 * a unit already inside the floor may stay where it is or fall back, just not
 * advance further.
 */
export function keepsBehindLine(unit: CombatUnit, pos: HexCoord, floor: number, foes: readonly CombatUnit[]): boolean {
  return nearestFoe(pos, foes) >= Math.min(floor, nearestFoe(unit.position, foes));
}

/**
 * Whether a `line` unit is still marching: no foe within `AI_LINE_CONTACT_REACH`.
 * A formation buff cast now would run out before the fight reached it.
 */
export function lineIsMarching(unit: CombatUnit, foes: readonly CombatUnit[]): boolean {
  return formationOf(unit) === 'line' && foes.length > 0 &&
    nearestFoe(unit.position, foes) > BALANCE.AI_LINE_CONTACT_REACH;
}
