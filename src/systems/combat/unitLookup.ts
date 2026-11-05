


import * as Crypto from '@/platform/uuid';


import { CombatUnit } from '@/models/types';



















/**
 * A unit by id, from a list.
 *
 * Written out at ~30 call sites, twenty of them inside `combatStore` alone.
 * Named so the store, the resolvers and the AI are visibly asking one question
 * — `currentUnitId` tracks the active unit *by id* precisely because a list
 * index does not survive a summon splicing into `turnOrder` mid-fight.
 *
 * The id may be `undefined`: an effect's `sourceUnitId` is optional, and "no
 * such unit" is the right answer to "who applied this" for a dose left behind
 * by something already dead.
 */
export const unitById = (units: CombatUnit[], id: string | undefined): CombatUnit | undefined =>
  units.find((u) => u.id === id);


/** The same lookup where the caller has already established the unit exists. */
export const requireUnit = (units: CombatUnit[], id: string): CombatUnit =>
  units.find((u) => u.id === id)!;


/**
 * A unit with literally nothing it could do on its turn.
 *
 * Derived rather than a field: only a unit with no skills *and* no movement
 * matches, which is a state one thing in the game deliberately occupies — the
 * Stoneshaper's rock, waiting to be built up. It stays in `turnOrder` so
 * damage-over-time and effect durations tick on it like anything else, and the
 * turn is simply passed on.
 */
export const isInert = (unit: CombatUnit): boolean =>
  unit.skills.length === 0 && unit.stats.moveRange === 0;


/**
 * The caster's own live stage-unit for a staged summon, if it has one.
 *
 * The rock *is* the state machine: found by `summonedBy` and by carrying a
 * non-final stage template, so two Stoneshapers each track their own and the
 * chain resets by the thing dying. Shared by the highlight pass and the
 * resolver, which must agree about what a cast means.
 */
export function findStageUnit(
  spec: { stages?: string[] } | undefined,
  caster: CombatUnit,
  allUnits: CombatUnit[],
): CombatUnit | undefined {
  const stages = spec?.stages;
  if (!stages || stages.length < 2) return undefined;
  const pending = new Set(stages.slice(0, -1));
  return allUnits.find(
    (u) =>
      u.currentHp > 0 &&
      u.summonedBy === caster.id &&
      !!u.templateId &&
      pending.has(u.templateId),
  );
}


/**
 * The caster's finished construction — the last stage of a staged summon (Stone
 * Heart's Stone Elemental) — while it stands. A staged skill is locked while one
 * lives and free again the moment it dies or is removed.
 */
export function finishedStageUnit(
  spec: { stages?: string[] } | undefined,
  caster: CombatUnit,
  allUnits: CombatUnit[],
): CombatUnit | undefined {
  const stages = spec?.stages;
  if (!stages || stages.length < 2) return undefined;
  const last = stages[stages.length - 1];
  return allUnits.find((u) => u.currentHp > 0 && u.summonedBy === caster.id && u.templateId === last);
}
