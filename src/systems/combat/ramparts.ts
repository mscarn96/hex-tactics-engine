import { ArenaHazard, CombatUnit, HeroSkill, HexCoord, SkillTargetType } from '@/models/types';
import { solidKeys } from '@/systems/combat/arenaGeometry';
import { getHexLine, getNeighbors, hexDistance, hexKey } from '@/utils/hexUtils';

export const RAMPART_KIND = 'rampart';
/**
 * Whether cover stands between `from` and `to` for this skill: a rampart's rocks, and (given the arena's
 * `hazards`) any solid ground — rubble, black glass. Single, Line and Chain shots of range above 1 cannot
 * pass over cover; a melee swing beside it is not a shot. Heroes, enemies, the highlights, the aim preview
 * and the resolver all ask this one function, so the board never offers a shot the rules refuse.
 */
export function rampartBlocksShot(
  skill: HeroSkill, from: HexCoord, to: HexCoord, units: readonly CombatUnit[], hazards: readonly ArenaHazard[] = [],
): boolean {
  if (!skill.damage || skill.range <= 1 || skill.selfMove
    || ![SkillTargetType.Single, SkillTargetType.Line, SkillTargetType.Chain].includes(skill.targetType)) return false;
  const occupied = solidKeys(hazards);
  for (const u of units) if (u.currentHp > 0 && u.objective?.kind === RAMPART_KIND) occupied.add(hexKey(u.position));
  return getHexLine(from, to).slice(1, -1).some(h => occupied.has(hexKey(h)));
}
/** Atomic placement; existing rocks remain occupied until a valid replacement exists. */
export function rampartPair(caster: CombatUnit, skill: HeroSkill, anchor: HexCoord, units: readonly CombatUnit[],
  legal: (h: HexCoord) => boolean, neighbor?: HexCoord): HexCoord[] {
  const free = (h: HexCoord) => legal(h) && hexDistance(caster.position, h) <= skill.range
    && !units.some(u => u.currentHp > 0 && hexKey(u.position) === hexKey(h));
  if (!free(anchor)) return [];
  const next = neighbor ?? getNeighbors(anchor).find(free);
  return next && hexDistance(anchor, next) === 1 && free(next) ? [anchor, next] : [];
}
