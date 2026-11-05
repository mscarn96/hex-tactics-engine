import { ArenaHazard, CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import { hexDistance } from '@/utils/hexUtils';
import { canStrike } from './targetLegality';
import { resolveSelfMove } from './forcedMovement';
import { roll } from './dice';

/** Each dash finds legal ground; each throw chooses the nearest living victim anew. */
export function knifeDanceStep(caster: CombatUnit, skill: HeroSkill, units: CombatUnit[], hazards: ArenaHazard[],
  aimed: HexCoord, first: boolean, previous?: string): { to: HexCoord; target: CombatUnit } | null {
  const enemies = units.filter(u => canStrike(caster, u, skill));
  const range = first ? skill.range : skill.chainRange ?? 2;
  const anchors = first ? enemies.filter(u => hexDistance(u.position, aimed) === 0
    && hexDistance(caster.position, u.position) <= skill.range)
    : enemies.filter(u => hexDistance(caster.position, u.position) <= range + 1)
      .sort((a, b) => Number(a.id === previous) - Number(b.id === previous)
        || hexDistance(caster.position, a.position) - hexDistance(caster.position, b.position));
  for (const anchor of anchors) {
    const to = resolveSelfMove(caster, { ...skill, selfMove: { kind: 'dash', range } }, anchor.position, units,
      [...hazards, { id: 'dance-origin', solid: true, hexes: [caster.position] }]);
    if (!to) continue;
    const nearby = enemies.filter(u => hexDistance(to, u.position) <= skill.range);
    const nearest = Math.min(...nearby.map(u => hexDistance(to, u.position)));
    const tied = nearby.filter(u => hexDistance(to, u.position) === nearest);
    if (tied.length) return { to, target: tied[Math.floor(roll() * tied.length)] };
  }
  return null;
}
