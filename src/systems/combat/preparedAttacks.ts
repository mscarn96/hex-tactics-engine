import { skillName } from '@/data/gameText';
import {
  AfflictionType,
  ArenaHazard,
  AuraType,
  CombatUnit,
  HeroSkill,
  HexCoord,
  PreparedAttack,
  PreparedSpec,
  StatusEffectType,
} from '@/models/types';
import { ForcedMove, forcedMoveOrder, previewForcedMoves } from '@/systems/combat/forcedMovement';
import { previewPulls } from '@/systems/combat/eliteKits';
import { BALANCE } from '@/data/balanceConstants';
import { galeSheltered, windBodies, windMoves } from '@/systems/combat/kairenRules';
import { isImmuneToPush, lastStandHolds } from '@/systems/combat/passives';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { discAround } from '@/systems/combat/arenaGeometry';

/**
 * Delayed attacks, as pure rules over a footprint and a roster.
 *
 * A prepared attack is *announced* when it is cast — the hexes, the aim and the
 * people standing in them are fixed there — and it *lands* from the caster's
 * `beginTurn` once every unit that was standing in the footprint has had a turn
 * of its own. The window is counted in the responders' turns, never the
 * caster's, so nothing the caster does with extra turns, bonus actions or a
 * phase change can shorten it. The store holds the list
 * (`combatStore.preparedAttacks`); this file owns what the list means, and the
 * HUD, the resolver and the tests all ask it rather than each other.
 *
 * Pure and store-free so the Node suites and any tuning harness can use it.
 */

/** The skill as it will resolve: `prepares` stripped so it cannot prepare again. */
export function resolvedSkill(skill: HeroSkill): HeroSkill {
  const { prepares: _prepares, ...rest } = skill;
  return rest;
}

let preparedSequence = 0;

/**
 * Fixes a warning: the footprint, the aim, and who is owed a turn.
 *
 * `hexes` is whatever the skill's own targeting produced at the cast — it is
 * stored, never recomputed, which is why a caster that moves or turns cannot
 * retarget the area it warned.
 */
export function createPreparedAttack(
  caster: CombatUnit,
  skill: HeroSkill,
  aim: HexCoord,
  hexes: HexCoord[],
  units: CombatUnit[],
  spared: readonly HexCoord[] = [],
): PreparedAttack {
  const standing = unitsOnHexes(hexes, units);
  // A warning the whole party answers (a Furnace Heart, Skyfire) owes a window
  // from every living hero, wherever they stood at the cast
  const answering = skill.prepares?.everyone
    ? units.filter((u) => u.currentHp > 0 && !u.objective && !u.summonedBy)
    : standing;
  const windows = skill.prepares?.windows;
  return {
    id: `prep_${++preparedSequence}`,
    casterId: caster.id,
    skill: resolvedSkill(skill),
    spec: skill.prepares ?? {},
    aim,
    origin: caster.position,
    hexes: hexes.map((h) => ({ q: h.q, r: h.r })),
    // Only a unit with a turn of its own can answer: an objective or a companion (the
    // Thunder Elemental) standing in the footprint is struck but owes nothing, or the
    // warning would wait on it for ever (playtest 2026-10-23: the Burrowmother's Undermine)
    responders: answering
      .filter((u) => u.isPlayer !== caster.isPlayer && !u.objective && !u.companion)
      .map((u) => u.id),
    responded: [],
    threatened: standing
      .filter((u) => u.isPlayer !== caster.isPlayer && !u.objective && !u.companion)
      .map((u) => u.id),
    ...(windows !== undefined && windows > 1 && { windows }),
    ...(spared.length > 0 && { sheltered: spared.map((h) => ({ q: h.q, r: h.r })) }),
  };
}

// ── a warning carried by a hero ──────────────────────────────────────────────

/** The hero a carried warning rides on (`PreparedSpec.carried`): the first it binds. */
export const carrierOf = (attack: PreparedAttack): string | undefined =>
  attack.spec?.carried ? attack.bound?.[0] : undefined;

/**
 * A carried warning's footprint with its carrier standing at `at`: the disc of the skill's radius round
 * them. The store re-centres it on every move (`combatStore.moveUnit`) and the landing strikes it, so the
 * warning drawn is the warning that lands.
 */
export const carriedFootprint = (attack: PreparedAttack, at: HexCoord): HexCoord[] =>
  discAround(at, attack.skill.aoeRadius ?? 1);

export function unitsOnHexes(hexes: HexCoord[], units: CombatUnit[]): CombatUnit[] {
  return units.filter(
    (u) => u.currentHp > 0 && hexes.some((h) => h.q === u.position.q && h.r === u.position.r),
  );
}

/**
 * The units this warning will hit if it resolved now: whoever is standing in
 * the fixed footprint, on the other side of the caster for damage and on its
 * own side for help. The preview and the resolution both read this, so what the
 * HUD names is what the strike strikes.
 */
export function affectedBy(attack: PreparedAttack, units: CombatUnit[]): CombatUnit[] {
  return affectedOn(attack, attack.hexes, units);
}

/** `affectedBy`, over `hexes` instead of the whole fixed footprint: what a landing plan strikes. */
export function affectedOn(attack: PreparedAttack, hexes: readonly HexCoord[], units: CombatUnit[]): CombatUnit[] {
  const caster = units.find((u) => u.id === attack.casterId);
  const inside = unitsOnHexes(hexes as HexCoord[], units);
  if (!caster) return inside;
  return inside.filter((u) => {
    const hostile = u.isPlayer !== caster.isPlayer;
    // A marsh that drags is aimed at the other side whatever it deals
    if (attack.skill.damage || attack.skill.pushDistance || attack.scripted === 'undertow') return hostile;
    return true;
  });
}

// ── what a landing will do: shared damage, blockers, shelter ────────────────

/**
 * What a warned attack resolves over, once its authored rules are applied to the
 * board as it stands (`PreparedSpec.split`, `blockedBy`, `shelter`).
 *
 * One plan, read by the landing (`warnedLanding`), the preview (`previewPrepared`), the
 * board's overlays and the banner, so what the party is shown is what lands. A warning
 * with none of the three fields has the identity plan: its own footprint, nothing
 * sheltered, no shares.
 */
export interface LandingPlan {
  /** The hexes the strike resolves over: the footprint less the sheltered, or the blocker's hex alone. */
  hexes: HexCoord[];
  /** Footprint hexes spared by a living objective or a hazard (`PreparedSpec.shelter`). */
  sheltered: HexCoord[];
  /** The opposing bodies with a turn of their own that the strike lands on, by id. */
  struckIds: string[];
  /** Each struck hex's share of the damage (by `hexKey`), present only when it is not whole. */
  shares: Record<string, number>;
  /** How many bodies divide a shared landing (1 when it is not shared or a hero stands alone). */
  splitBy: number;
  /** The hero who stopped the attack, when `blockedBy` caught one. */
  blockerId?: string;
  blocked: boolean;
  /**
   * The heroes who hold their own hex behind a Barrier, Last Stand or Immovable (`PreparedSpec.heldBy`), each
   * struck at its share there. Present only for such a warning.
   */
  holders?: string[];
}

/** Whether a body holds what stops an attack outright: a Barrier, Last Stand (once it holds) or Immovable. */
export function isShieldingBody(unit: CombatUnit): boolean {
  return unit.currentHp > 0
    && (unit.activeEffects.some((e) => e.type === AuraType.Barrier && e.magnitude > 0)
      || lastStandHolds(unit)
      || isImmuneToPush(unit));
}

/**
 * The seals a hero has paid by striking the caster from them (`PreparedSpec.sealed`): the seal's
 * hex and the ring round it, less any hex a seal still to erupt also covers and less the orb's
 * added hexes, which belong to no hero. A paid hero's own hex is spared whatever else covers it.
 */
export function paidSealHexes(attack: PreparedAttack, footprint: readonly HexCoord[]): HexCoord[] {
  const { bound, centres } = attack;
  if (!attack.spec.sealed || !bound || !centres) return [];
  const paid = new Set((attack.tolls ?? []).filter((toll) => toll.how === 'strike').map((toll) => toll.unitId));
  if (paid.size === 0) return [];
  const radius = BALANCE.AETHELRED_FORECLOSURE_RADIUS;
  const added = new Set((attack.bonusHexes ?? []).map(hexKey));
  const paidCentres = centres.filter((_, i) => paid.has(bound[i]));
  const liveCentres = centres.filter((_, i) => !paid.has(bound[i]));
  const ownHexes = new Set(paidCentres.map(hexKey));
  return footprint.filter((h) => {
    if (ownHexes.has(hexKey(h))) return true;
    return !added.has(hexKey(h))
      && paidCentres.some((c) => hexDistance(c, h) <= radius)
      && !liveCentres.some((c) => hexDistance(c, h) <= radius);
  });
}

/** The footprint hexes `spec.shelter` spares on this board, and the seals a hero has paid. */
export function shelteredHexes(
  attack: PreparedAttack,
  footprint: readonly HexCoord[],
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[],
): HexCoord[] {
  const paid = paidSealHexes(attack, footprint);
  // Ground the script spared at the cast is part of the warning, whatever the spec says
  const fixed = (attack.sheltered ?? []).filter((h) => !paid.some((p) => hexKey(p) === hexKey(h)));
  const shelter = attack.spec.shelter;
  if (!shelter) return [...paid, ...fixed];
  const beside = shelter.besideObjective
    ? units.filter((u) => u.currentHp > 0 && u.objective?.kind === shelter.besideObjective)
    : [];
  const ground = shelter.onHazard
    ? new Set(hazards.filter((h) => h.label === shelter.onHazard).flatMap((h) => h.hexes.map(hexKey)))
    : undefined;
  const paidKeys = new Set(paid.map(hexKey));
  const spared = footprint.filter((h) =>
    paidKeys.has(hexKey(h)) || beside.some((o) => hexDistance(o.position, h) === 1) || ground?.has(hexKey(h)));
  const seen = new Set(spared.map(hexKey));
  return [...spared, ...fixed.filter((h) => !seen.has(hexKey(h)))];
}

/**
 * The hero who stops a blockable attack: the shielded one nearest where the caster
 * stood at the cast, ties by lower id. Preview and landing both ask this.
 */
export function landingBlocker(
  attack: PreparedAttack,
  struck: readonly CombatUnit[],
): CombatUnit | undefined {
  if (!attack.spec.blockedBy) return undefined;
  return struck
    .filter(isShieldingBody)
    .sort((a, b) =>
      hexDistance(attack.origin, a.position) - hexDistance(attack.origin, b.position)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

/**
 * Whether a body is one `attack` lands on: the other side's, with a turn of its own (an objective
 * or a companion is neither struck by a warning nor counted as struck).
 */
export function opposedBy(attack: PreparedAttack, units: readonly CombatUnit[]): (unit: CombatUnit) => boolean {
  const caster = units.find((u) => u.id === attack.casterId);
  return (u) => !u.objective && !u.companion && (!caster || u.isPlayer !== caster.isPlayer);
}

export const hasLandingRules = (spec: PreparedSpec): boolean =>
  !!spec.split || !!spec.blockedBy || !!spec.heldBy || !!spec.shelter || !!spec.sealed;

/**
 * The plan for `attack` over `footprint` (its own hexes unless a script lands a different
 * area with the same warning). Pure over the roster and hazards passed in.
 */
export function landingPlan(
  attack: PreparedAttack,
  units: CombatUnit[],
  hazards: ArenaHazard[] = [],
  footprint: HexCoord[] = attack.hexes,
): LandingPlan {
  const opposing = opposedBy(attack, units);
  const spec = attack.spec;
  if (!hasLandingRules(spec)) {
    return {
      hexes: footprint, sheltered: [...(attack.sheltered ?? [])], shares: {}, splitBy: 1, blocked: false,
      struckIds: unitsOnHexes(footprint, units).filter(opposing).map((u) => u.id),
    };
  }
  const sheltered = shelteredHexes(attack, footprint, units, hazards);
  const spared = new Set(sheltered.map(hexKey));
  const open = footprint.filter((h) => !spared.has(hexKey(h)));
  const struck = unitsOnHexes(open, units).filter(opposing);
  const blocker = landingBlocker(attack, struck);
  if (blocker && spec.blockedBy) {
    return {
      hexes: [{ q: blocker.position.q, r: blocker.position.r }],
      sheltered,
      struckIds: [blocker.id],
      shares: { [hexKey(blocker.position)]: spec.blockedBy.share },
      splitBy: 1,
      blockerId: blocker.id,
      blocked: true,
    };
  }
  const shares: Record<string, number> = {};
  if (spec.split && struck.length > 1) {
    for (const u of struck) shares[hexKey(u.position)] = 1 / struck.length;
  }
  // Each hero who holds their hex behind a shield takes the held share there, and nobody else is spared
  const holders = spec.heldBy ? struck.filter(isShieldingBody) : [];
  for (const u of holders) shares[hexKey(u.position)] = (shares[hexKey(u.position)] ?? 1) * spec.heldBy!.share;
  return {
    hexes: open, sheltered, shares, blocked: false,
    splitBy: spec.split ? Math.max(1, struck.length) : 1,
    struckIds: struck.map((u) => u.id),
    ...(spec.heldBy && { holders: holders.map((u) => u.id) }),
  };
}

/**
 * Whether a warned attack from the other side covers the hex `unit` stands on and
 * would hit it — the question Seismic Sense asks at the start of a turn. Same
 * `affectedBy` rule the HUD and the resolution use, so "threatened" means exactly
 * "named in the warning".
 */
export function threatensUnit(
  attack: PreparedAttack,
  unit: CombatUnit,
  units: CombatUnit[],
): boolean {
  const caster = units.find((u) => u.id === attack.casterId);
  if (!caster || caster.isPlayer === unit.isPlayer || caster.currentHp <= 0) return false;
  return affectedBy(attack, units).some((u) => u.id === unit.id);
}

/** Response windows each responder owes: one unless the warning is a longer countdown. */
export const windowsOf = (attack: PreparedAttack): number => attack.windows ?? 1;

/**
 * Rounds of the responders' turns before the warning is due: the windows still owed by the responder
 * furthest behind (a fallen one owes nothing). 0 once it is due. A long countdown (a carried Furnace
 * Heart) is read off this rather than off the list of who still owes.
 */
export function windowsLeft(attack: PreparedAttack, units: readonly CombatUnit[]): number {
  const need = windowsOf(attack);
  const owed = attack.responders
    .filter((id) => units.some((u) => u.id === id && u.currentHp > 0))
    .map((id) => need - attack.responded.filter((r) => r === id).length);
  return Math.max(0, ...owed);
}

/** Responders still owed a turn: alive and not yet through every window the warning asks. */
export function responsesOwed(attack: PreparedAttack, units: CombatUnit[]): string[] {
  const need = windowsOf(attack);
  return attack.responders.filter(
    (id) =>
      attack.responded.filter((r) => r === id).length < need &&
      units.some((u) => u.id === id && u.currentHp > 0),
  );
}

/**
 * Whether the response window is over. A dead responder no longer owes one, and
 * an empty footprint is due at once — the caster commits to a strike that
 * misses, rather than waiting on nobody.
 */
export function isPreparedDue(attack: PreparedAttack, units: CombatUnit[]): boolean {
  return responsesOwed(attack, units).length === 0;
}

export function preparedBy(casterId: string, attacks: PreparedAttack[]): PreparedAttack[] {
  return attacks.filter((p) => p.casterId === casterId);
}

export interface PreparedPreview {
  attackId: string;
  skillName: string;
  /** The fixed footprint. */
  hexes: HexCoord[];
  /** Who stands in it now. */
  targetIds: string[];
  /** Where each pushed body will end up — the same trace the resolution uses. */
  landings: ForcedMove[];
  /** Who still owes a turn before it can land. */
  responsesOwed: string[];
  /** True once nothing is owed: it lands on its caster's next turn. */
  due: boolean;
  /** Ids of hazards a push in this attack will land on or cross. */
  hazardIds: string[];
  /** Each struck body's share of the damage, when the landing is shared or blocked (otherwise empty). */
  shares: { unitId: string; share: number }[];
  /** How many bodies divide a shared landing (1 when it is not shared). */
  splitBy: number;
  /** The hero who will stop the attack, named on the banner. */
  blockerId?: string;
  /**
   * Struck bodies a push will not move because the wall or solid ground (rubble, glass) stands
   * directly behind them: held where they stand, the same trace the landing runs. Named on the banner.
   */
  braced: string[];
  /**
   * Jadeveil: the heroes a body keeps off Kairen's Downdraft — the wind would carry each onto its rows
   * if they stood alone, and a body that holds stops them short (`galeSheltered`). Named on the banner
   * and drawn in the shelter colour where they will stand. Empty for every other warning.
   */
  windSheltered: string[];
  /** Footprint hexes spared by shelter, drawn apart from the footprint. */
  sheltered: HexCoord[];
  /** The whiff hook id, when the warning has one and nobody would be struck now. */
  whiffsNow?: string;
  /** The landing plan all of this was read from, which the landing holds and strikes by. */
  plan: LandingPlan;
}

/**
 * What a warning will do, as the HUD and the board show it.
 *
 * Built from the same `affectedBy` and `previewForcedMoves` the resolution
 * runs, from the fixed `origin`, so the preview cannot describe a different
 * attack than the one that lands. It assumes survivors: a body killed by the
 * damage half of the same blow frees its hex for the pushes behind it, which
 * only ever loosens a landing the preview called blocked.
 */
export function previewPrepared(
  attack: PreparedAttack,
  units: CombatUnit[],
  hazards: ArenaHazard[] = [],
): PreparedPreview {
  // Jadeveil: Kairen's Gale blows every body along its wind, wherever it stands
  const wind = attack.wind;
  const plan = landingPlan(attack, units, hazards);
  // A blocked landing carries no push: the blow falls on the blocker alone
  const hit = wind ? windBodies(attack.casterId, units) : affectedOn(attack, plan.hexes, units);
  const distance = plan.blocked ? 0 : (attack.skill.pushDistance ?? 0);
  // The Bog Hulk's marsh drags toward the Hulk where he stands *now*; every other
  // landing is a push from where the caster stood at the cast
  const hulk = attack.scripted === 'undertow' ? units.find((u) => u.id === attack.casterId) : undefined;
  const landings =
    wind
      ? windMoves(wind, attack.windDistance ?? BALANCE.KAIREN.GALE_PUSH, attack.casterId, units, hazards)
      : hulk
      ? previewPulls(hulk.position, hit, BALANCE.MIRE_PULL, units, hazards)
      : distance > 0
        ? previewForcedMoves(attack.origin, forcedMoveOrder(attack.origin, hit), distance, units, hazards)
        : [];
  const hazardIds: string[] = [];
  for (const move of landings) {
    for (const id of move.hazardIds) if (!hazardIds.includes(id)) hazardIds.push(id);
  }
  return {
    attackId: attack.id,
    skillName: skillName(attack.skill),
    hexes: attack.hexes,
    targetIds: hit.map((u) => u.id),
    landings,
    responsesOwed: responsesOwed(attack, units),
    due: isPreparedDue(attack, units),
    hazardIds,
    braced: landings
      .filter((m) => !m.moved && (m.blockedBy?.kind === 'boundary' || m.blockedBy?.kind === 'hazard'))
      .map((m) => m.unitId),
    windSheltered: wind ? galeSheltered(attack, units, hazards, landings) : [],
    shares: Object.entries(plan.shares).flatMap(([key, share]) => {
      const unit = units.find((u) => u.currentHp > 0 && hexKey(u.position) === key);
      return unit ? [{ unitId: unit.id, share }] : [];
    }),
    splitBy: plan.splitBy,
    ...(plan.blockerId && { blockerId: plan.blockerId }),
    sheltered: plan.sheltered,
    ...(attack.spec.onWhiff && plan.struckIds.length === 0 && { whiffsNow: attack.spec.onWhiff }),
    plan,
  };
}

/**
 * The pushes a warning will make, as the board draws them: each body that will
 * actually move, from where it stands to where it lands. A landing is drawn as an
 * arrow from the body, never as a lit hex — a landing tile in the warning's colour
 * read as a stray hex of the footprint (PT-06), one ring outside the smash.
 */
export function warnedPushes(
  attack: PreparedAttack,
  units: CombatUnit[],
  hazards: ArenaHazard[] = [],
): { unitId: string; from: HexCoord; to: HexCoord }[] {
  return previewPrepared(attack, units, hazards).landings
    .filter((m) => m.moved)
    .map((m) => ({ unitId: m.unitId, from: m.from, to: m.to }));
}

// ── interrupts ───────────────────────────────────────────────────────────────

const INTERRUPT_KEY: Partial<Record<StatusEffectType, NonNullable<PreparedSpec['interruptedBy']>[number]>> = {
  [AfflictionType.Stun]: 'stun',
  [AfflictionType.Silence]: 'silence',
  [AfflictionType.Freeze]: 'freeze',
  [AfflictionType.Root]: 'root',
};

/**
 * Whether landing this status on the caster cancels the attack. Only what the
 * authored spec lists does: an unlisted disable is shrugged off, and Taunt is
 * a separate switch because it is target control first and an interrupt only
 * where a preparation says so.
 */
export function statusInterrupts(attack: PreparedAttack, type: StatusEffectType): boolean {
  if (type === AfflictionType.Taunt) return attack.spec.tauntCancels === true;
  const key = INTERRUPT_KEY[type];
  return key !== undefined && (attack.spec.interruptedBy ?? []).includes(key);
}

/** The pending attacks of `casterId` that `type` would cancel. */
export function interruptedBy(
  casterId: string,
  type: StatusEffectType,
  attacks: PreparedAttack[],
): PreparedAttack[] {
  return preparedBy(casterId, attacks).filter((p) => statusInterrupts(p, type));
}
