import { rampartPair, RAMPART_KIND } from '@/systems/combat/ramparts';
import { CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { createObjective, ObjectiveInit, objectivesOf } from '@/systems/combat/objectives';
import { findSummonHexes } from '@/systems/combat/summoning';
import { hexDistance } from '@/utils/hexUtils';
import { inArena } from '@/systems/combat/arenaGeometry';
import { objectiveName, unitName } from '@/data/templates/unitText';
import { t } from '@/i18n';

/**
 * The store-writing half of `objectives`, kept apart because the store itself
 * imports the pure half (`damageUnit` applies an objective's protection and its
 * destruction), and this half imports the store.
 */

/** Puts an objective on the board. It joins `units` and never the turn order. */
export function placeObjective(init: ObjectiveInit): CombatUnit {
  const unit = createObjective(init);
  useCombatStore.getState().addUnits([unit]);
  return unit;
}

/**
 * A warned attack has resolved: the objectives built to ride on it have done
 * their job and leave the board.
 */
export function retireLinkedObjectives(preparedId: string): CombatUnit[] {
  const store = useCombatStore.getState();
  const linked = store.units.filter(
    (u) => u.currentHp > 0 && u.objective?.linkedPreparedId === preparedId,
  );
  for (const unit of linked) store.removeObjective(unit.id);
  return linked;
}

/**
 * Where a placing skill's objectives would stand — free hexes beside the
 * caster, or the aimed hex. The resolver and the AI's scoring both read it, so
 * a skill the AI values is a skill that can actually be placed.
 */
export function objectiveHexes(
  caster: CombatUnit,
  skill: HeroSkill,
  aim: HexCoord,
  units: CombatUnit[],
  neighbor?: HexCoord,
): HexCoord[] {
  const spec = skill.places;
  if (!spec) return [];
  if (spec.kind === RAMPART_KIND) return rampartPair(caster, skill, aim, units, inArena, neighbor);
  const room = (spec.maxStanding ?? spec.count) - standingObjectives(caster, spec.kind, units);
  if (room <= 0) return [];
  if (spec.placement === 'aimed') {
    const taken = units.some(
      (u) => u.currentHp > 0 && u.position.q === aim.q && u.position.r === aim.r,
    );
    return inArena(aim) && hexDistance(caster.position, aim) <= skill.range && !taken ? [aim] : [];
  }
  if (spec.placement === 'front') return frontHexes(caster, Math.min(spec.count, room), units);
  return findSummonHexes(caster.position, Math.min(spec.count, room), units);
}

/**
 * Free hexes between the caster and the opposition, spread apart.
 *
 * `near` fills the hexes beside the caster in a fixed order, which tucked one
 * banner behind a big boss every time. This puts them on the party's side of the
 * caster, two hexes or more from each other where the board allows, so each
 * objective is out in the open and a hero can walk to it.
 */
function frontHexes(caster: CombatUnit, count: number, units: CombatUnit[]): HexCoord[] {
  const foes = units.filter((u) => u.currentHp > 0 && u.isPlayer !== caster.isPlayer && !u.objective);
  const taken = new Set(units.filter((u) => u.currentHp > 0).map((u) => `${u.position.q},${u.position.r}`));
  const toward = foes.length
    ? {
        q: foes.reduce((n, f) => n + f.position.q, 0) / foes.length,
        r: foes.reduce((n, f) => n + f.position.r, 0) / foes.length,
      }
    : caster.position;
  const gap = (a: HexCoord, b: HexCoord) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
  const candidates = findSummonHexes(caster.position, 40, units)
    .filter((h) => hexDistance(caster.position, h) >= 2 && hexDistance(caster.position, h) <= 3 && !taken.has(`${h.q},${h.r}`))
    .sort((a, b) => gap(a, toward) - gap(b, toward) || a.q - b.q || a.r - b.r);
  const picked: HexCoord[] = [];
  for (const spread of [2, 1, 0]) {
    for (const h of candidates) {
      if (picked.length >= count) break;
      if (picked.some((p) => p.q === h.q && p.r === h.r)) continue;
      if (picked.every((p) => gap(p, h) >= spread)) picked.push(h);
    }
  }
  return picked.length >= count ? picked : [...picked, ...findSummonHexes(caster.position, count, units).filter((h) => !picked.some((p) => p.q === h.q && p.r === h.r))].slice(0, count);
}

/** The backlash a placed objective carries: its spec's, less its step for each tier the caster stands above the first. */
export function placementBacklash(spec: NonNullable<HeroSkill['places']>, caster: CombatUnit): number | undefined {
  if (spec.backlash === undefined) return undefined;
  const above = Math.max(0, (caster.challengeTier ?? 1) - 1);
  return Math.max(0, spec.backlash - (spec.backlashTierStep ?? 0) * above);
}

/**
 * Raises a skill's objectives. Shared by both resolvers, like `castPrepared`:
 * the player's and the AI's are the same rule. `preparedId` links them to the
 * warning the same cast announced, when the spec asks for it.
 */
export function castObjectives(
  caster: CombatUnit,
  skill: HeroSkill,
  aim: HexCoord,
  units: CombatUnit[],
  log: (text: string, color: string) => void,
  preparedId?: string,
  neighbor?: HexCoord,
): CombatUnit[] {
  const spec = skill.places;
  if (!spec) return [];
  const placed: CombatUnit[] = [];
  const hexes = objectiveHexes(caster, skill, aim, units, neighbor);
  if (spec.kind === RAMPART_KIND && hexes.length !== 2) return [];
  for (const position of hexes) {
    const unit = createObjective({
      kind: spec.kind,
      name: spec.name ?? objectiveName(spec.kind),
      owner: caster,
      position,
      hp: Math.max(1, Math.round(caster.stats.maxHp * spec.hpFraction)),
      defense: spec.defense,
      protection: spec.protection,
      areaResist: spec.areaResist,
      turnsLeft: spec.turnsLeft,
      onDestroy: spec.onDestroy,
      onAllDestroyed: spec.onAllDestroyed,
      shattersOnPhase: spec.shattersOnPhase,
      breakerBarrier: spec.breakerBarrier,
      linkedPreparedId: spec.linkedToPrepared ? preparedId : undefined,
      backlash: placementBacklash(spec, caster),
    });
    placed.push(unit);
  }
  if (placed.length > 0) {
    if (spec.kind === RAMPART_KIND) for (const old of objectivesOf(caster.id, units)) {
      if (old.objective?.kind === RAMPART_KIND) useCombatStore.getState().removeObjective(old.id);
    }
    useCombatStore.getState().addUnits(placed);
    for (const unit of placed) log(`  ${t('combatLog.log.rises', { name: unitName(unit) })}`, '#ffaa44');
  }
  return placed;
}

/** How many of a kind the caster already has standing — the AI's crowding term. */
export function standingObjectives(caster: CombatUnit, kind: string, units: CombatUnit[]): number {
  return objectivesOf(caster.id, units).filter((o) => o.objective?.kind === kind).length;
}
