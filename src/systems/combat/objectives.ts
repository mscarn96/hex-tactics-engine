import * as Crypto from '@/platform/uuid';
import { CombatUnit, HexCoord, ObjectiveEffect, ObjectiveSpec } from '@/models/types';
import { objectiveName } from '@/data/templates/unitText';

/**
 * Attackable arena objectives — an Imperial Standard, a Furnace Heart.
 *
 * An objective is a `CombatUnit` with an `objective` field, because everything
 * a hero needs to attack one is already unit behaviour: it occupies a hex, is
 * highlighted and targeted, takes damage through `damageUnit` (barrier, armour
 * and the damage types all apply), and dies the way anything dies. What makes it
 * an objective rather than a combatant is that it never takes a turn, is not in
 * the turn order, does not count for victory, and **means something to its
 * owner** — see `ObjectiveSpec`.
 *
 * The pure half is here; the two store-side effects (the owner's damage
 * reduction and the on-destroy outcome) run inside `combatStore.damageUnit`,
 * the one funnel every source of damage passes through, via
 * `protectedDamage` and `destroyedOutcome` below.
 */

/** The most of its incoming damage a boss's objectives may absorb between them. */
export const MAX_OBJECTIVE_PROTECTION = 0.99;

export const isObjective = (unit: CombatUnit): boolean => unit.objective !== undefined;

export interface ObjectiveInit {
  kind: string;
  /** Absent when the `units` catalog names the kind (`objectiveName`); displays read it from there anyway. */
  name?: string;
  owner: CombatUnit;
  position: HexCoord;
  hp: number;
  defense?: number;
  protection?: number;
  areaResist?: number;
  turnsLeft?: number;
  onDestroy?: ObjectiveEffect[];
  onAllDestroyed?: ObjectiveEffect[];
  linkedPreparedId?: string;
  shattersOnPhase?: boolean;
  bindsPrepared?: string;
  cancelsOnLast?: boolean;
  backlash?: number;
  onLast?: 'release' | 'expose';
  breakerBarrier?: number;
  linkedUnitId?: string;
  carrierId?: string;
}

/**
 * Builds an objective on its owner's side. Pure; `placeObjective` (in
 * `objectiveBoard`) is the store-writing wrapper. It stands on the owner's side, so a hero's attacks
 * reach it and the owner's AI does not mistake it for a foe.
 */
export function createObjective(init: ObjectiveInit): CombatUnit {
  const spec: ObjectiveSpec = {
    kind: init.kind,
    ownerId: init.owner.id,
    protection: init.protection,
    areaResist: init.areaResist,
    turnsLeft: init.turnsLeft,
    onDestroy: init.onDestroy,
    onAllDestroyed: init.onAllDestroyed,
    linkedPreparedId: init.linkedPreparedId,
    shattersOnPhase: init.shattersOnPhase,
    bindsPrepared: init.bindsPrepared,
    cancelsOnLast: init.cancelsOnLast,
    backlash: init.backlash,
    onLast: init.onLast,
    breakerBarrier: init.breakerBarrier,
    linkedUnitId: init.linkedUnitId,
    carrierId: init.carrierId,
  };
  return {
    id: `ob_${Crypto.randomUUID()}`,
    name: init.name ?? objectiveName(init.kind),
    isPlayer: init.owner.isPlayer,
    stats: {
      maxHp: init.hp,
      attack: 0,
      defense: init.defense ?? 0,
      magic: 0,
      speed: 1,
      moveRange: 0,
      maxMana: 0,
    },
    currentHp: init.hp,
    currentMana: 0,
    position: init.position,
    skills: [],
    hasMoved: false,
    hasActed: false,
    facingAngle: 0,
    activeEffects: [],
    objective: spec,
  };
}

/** The living objectives riding on `unitId` (a carried Furnace Heart): `ObjectiveSpec.carrierId`. */
export function carriedOn(unitId: string, units: readonly CombatUnit[]): CombatUnit[] {
  return units.filter((u) => u.currentHp > 0 && u.objective?.carrierId === unitId);
}

/** Whether `unit` is an objective riding on a hero, which never answers for its hex on its own. */
export const isCarried = (unit: CombatUnit): boolean => unit.objective?.carrierId !== undefined;

/**
 * The body a blow from `caster` lands on when it reaches `body`'s hex.
 *
 * A carried objective shares its carrier's hex, and the hex holds two bodies on two sides: a blow
 * that helps finds the carrier, a blow that harms an ally of the caster's — the carrier, or the caster
 * itself — finds the crystal riding on them, so the party can strike the Heart without hurting the hero
 * who holds it. Anything else is the body itself. The resolver, the highlights and the scene's preview
 * all ask this, so the hex that lights is the body that is struck.
 */
export function struckBody(
  caster: CombatUnit,
  body: CombatUnit | undefined,
  units: readonly CombatUnit[],
): CombatUnit | undefined {
  if (!body || body.currentHp <= 0 || body.isPlayer !== caster.isPlayer || body.objective) return body;
  return carriedOn(body.id, units).find((o) => o.isPlayer !== caster.isPlayer) ?? body;
}

export function objectivesOf(ownerId: string, units: CombatUnit[]): CombatUnit[] {
  return units.filter((u) => u.currentHp > 0 && u.objective?.ownerId === ownerId);
}

/**
 * The share of damage this unit's standing objectives soak up, 0–1.
 *
 * While a standard stands, the boss takes less; the fraction is the sum of what
 * the living objectives declare, capped so the owner is never untouchable.
 */
export function objectiveProtection(owner: CombatUnit, units: CombatUnit[]): number {
  const sum = objectivesOf(owner.id, units).reduce((n, o) => n + (o.objective?.protection ?? 0), 0);
  return Math.min(MAX_OBJECTIVE_PROTECTION, Math.max(0, sum));
}

/** An owner's damage after what its objectives soak. Never below 1 for a real hit. */
export function protectedDamage(owner: CombatUnit, units: CombatUnit[], amount: number): number {
  if (amount <= 0) return amount;
  const share = objectiveProtection(owner, units);
  if (share <= 0) return amount;
  return Math.max(1, Math.round(amount * (1 - share)));
}

export interface DestroyedOutcome {
  ownerId: string;
  /** Effects to put on the owner. */
  effects: ObjectiveEffect[];
  /** True when this was the last objective of its kind the owner had. */
  wasLast: boolean;
  /** The prepared attack that dies with it, if one was linked or bound. */
  cancelPreparedId?: string;
  /** A shared warning it answered its own part of (`ObjectiveSpec.boundHexes`): the hexes that part leaves. */
  trimPrepared?: { id: string; hexes: HexCoord[] };
  /** Share of the owner's maximum health it costs the owner, bypassing protection. */
  backlash?: number;
  /** What the last of its kind falling does to the owner. */
  onLast?: 'release' | 'expose';
  /** The Barrier the one who broke it takes, as a share of their own maximum health. */
  breakerBarrier?: number;
}

/**
 * What destroying `objective` does to the encounter. `units` is the roster as
 * it stands with the objective already fallen, so "was it the last" is a count.
 */
export function destroyedOutcome(objective: CombatUnit, units: CombatUnit[]): DestroyedOutcome | null {
  const spec = objective.objective;
  if (!spec) return null;
  const remaining = objectivesOf(spec.ownerId, units).filter(
    (o) => o.id !== objective.id && o.objective?.kind === spec.kind,
  );
  const wasLast = remaining.length === 0;
  // A part of a shared warning: the others bound to it still stand, so only its own hexes go
  const partners = spec.boundHexes && spec.bindsPrepared
    ? objectivesOf(spec.ownerId, units).filter((o) => o.id !== objective.id && o.objective?.bindsPrepared === spec.bindsPrepared)
    : [];
  const shared = partners.length > 0;
  const bound = spec.bindsPrepared && !shared && (!spec.cancelsOnLast || wasLast) ? spec.bindsPrepared : undefined;
  const kept = new Set(partners.flatMap((o) => o.objective?.boundHexes ?? []).map((h) => `${h.q},${h.r}`));
  return {
    ownerId: spec.ownerId,
    effects: [...(spec.onDestroy ?? []), ...(wasLast ? spec.onAllDestroyed ?? [] : [])],
    wasLast,
    cancelPreparedId: spec.linkedPreparedId ?? bound,
    ...(shared && {
      trimPrepared: { id: spec.bindsPrepared!, hexes: spec.boundHexes!.filter((h) => !kept.has(`${h.q},${h.r}`)) },
    }),
    ...(spec.backlash !== undefined && { backlash: spec.backlash }),
    ...(wasLast && spec.onLast !== undefined && { onLast: spec.onLast }),
    ...(spec.breakerBarrier !== undefined && { breakerBarrier: spec.breakerBarrier }),
  };
}
