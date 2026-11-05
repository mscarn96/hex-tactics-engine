import type { ArenaHazard, CombatUnit, HeroSkill, HexCoord, PreparedAttack } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { arcHexes } from '@/systems/combat/arenaGeometry';
import { canUseSkill } from '@/systems/combat/cooldowns';
import { calculateDamage } from '@/systems/combat/damageCalc';
import type { AIAction } from '@/systems/combat/enemyAI';
import { traceForcedMove } from '@/systems/combat/forcedMovement';
import { getMovementRange } from '@/systems/combat/movement';
import { affectedBy, previewPrepared, threatensUnit } from '@/systems/combat/preparedAttacks';
import { getValidSkillTargetHexes } from '@/systems/combat/targeting';
import {
  heapsBetween, heapsOf, isFurious, isTroll, trollMoveOfSkill, upcomingMoves, willRegenerate,
} from '@/systems/combat/trollScript';
import { answerOf } from '@/systems/combat/warnedAnswers';
import { hexDistance, hexKey } from '@/utils/hexUtils';

/**
 * What a simulated pair does with the Troll Chieftain's three warnings now that each has more than
 * one answer (`docs/combat.md`, the Troll Chieftain; designed in the private project notes, 4.1,
 * and the fort in the private project notes). Basic tactics, like the rest of the party policy, and nothing
 * here depends on a mastery:
 *
 * - **Share the roof** (`share`). Both heroes inside the Collapse's mark stay, when each would survive its half;
 *   a hero alone under it waits for a partner who can still walk in this round, and that partner walks in.
 * - **Brace** (`brace`). A hero in the Smash's ring with rubble or the wall at their back keeps the hex and the
 *   turn and takes the blow; a melee hero who can reach such a hex in the ring walks to it instead of
 *   out of the ring.
 * - **Keep him from regenerating.** In a round he would otherwise regenerate (nobody has struck him
 *   since his last turn) a hero who can survive the blow and is the last to act before him stays and
 *   strikes rather than step, so the round is not spent entirely on its feet.
 *
 * Everything else about a warning is `respondingPolicy`'s step. Reads the same plans the preview and
 * the landing read, so the policy and the game cannot disagree about who is braced or what is shared.
 * What the pair does with the fort when no warning asks anything of a hero is `trollFort`.
 */

/** A hero's survival margin against a blow: its health must exceed the expected blow by this much. */
const SAFETY = 1.25;

export type TrollStand =
  /**
   * Stay where the hero stands and act (strike, or hold if nothing is in reach). `needsStrike`: staying
   * is only worth it if the hero can strike him from here; otherwise it steps as usual.
   */
  | { kind: 'stay'; reason: string; needsStrike?: true }
  /** Walk to a better hex of the same mark. */
  | { kind: 'move'; reason: string; actions: AIAction[] };

const isHero = (u: CombatUnit) => u.isPlayer && !u.objective && !u.summonedBy && u.currentHp > 0;

/** The blow a hero would take from `attack` at `share` of its strength, expected and without a crit. */
function expectedBlow(attack: PreparedAttack, boss: CombatUnit, hero: CombatUnit, units: CombatUnit[], share: number): number {
  return share * calculateDamage(boss, hero, attack.skill, 'front', units);
}

const survives = (attack: PreparedAttack, boss: CombatUnit, hero: CombatUnit, units: CombatUnit[], share: number) =>
  hero.currentHp > SAFETY * expectedBlow(attack, boss, hero, units, share);

/**
 * Heroes that act after `unit` and before `boss` does, and so can still strike him this round from a
 * hex the warning does not reach.
 */
function laterStrikers(unit: CombatUnit, units: CombatUnit[], boss: CombatUnit, attack: PreparedAttack, order: readonly string[]): CombatUnit[] {
  const at = order.indexOf(unit.id);
  if (at < 0) return [];
  const later: CombatUnit[] = [];
  for (let i = 1; i < order.length; i++) {
    const id = order[(at + i) % order.length];
    if (id === boss.id) break;
    const other = units.find((u) => u.id === id);
    if (other && isHero(other) && !threatensUnit(attack, other, units)) later.push(other);
  }
  return later;
}

/** Heroes that act after `unit` and before `boss` does this round. */
function laterHeroes(unit: CombatUnit, units: CombatUnit[], boss: CombatUnit, order: readonly string[]): CombatUnit[] {
  const at = order.indexOf(unit.id);
  if (at < 0) return [];
  const later: CombatUnit[] = [];
  for (let i = 1; i < order.length; i++) {
    const id = order[(at + i) % order.length];
    if (id === boss.id) break;
    const other = units.find((u) => u.id === id);
    if (other && isHero(other)) later.push(other);
  }
  return later;
}

/** A free hex of the roof's mark the hero can walk to this turn, the nearest first. */
function roofSpot(unit: CombatUnit, attack: PreparedAttack, units: CombatUnit[], hazards: ArenaHazard[]): HexCoord | undefined {
  const mark = new Set(attack.hexes.map(hexKey));
  return getMovementRange(unit, units, hazards)
    .filter((h) => mark.has(hexKey(h)))
    .sort((a, b) => hexDistance(a, unit.position) - hexDistance(b, unit.position) || a.q - b.q || a.r - b.r)[0];
}

/** The hero's best usable strike on `target` from `hex`, if one reaches it from there. */
function strikeAt(unit: CombatUnit, hex: HexCoord, units: CombatUnit[], hazards: ArenaHazard[], target: CombatUnit): HeroSkill | undefined {
  const there = { ...unit, position: hex };
  const board = units.map((u) => (u.id === unit.id ? there : u));
  return unit.skills
    .filter((s) => !!s.damage && !s.prepares && !s.selfMove && canUseSkill(unit, s))
    .filter((s) => getValidSkillTargetHexes(s, there, board, hazards).some((h) => hexKey(h) === hexKey(target.position)))
    .sort((a, b) => (b.damage ?? 0) - (a.damage ?? 0))[0];
}

/** Walk to `hex` (unless already there), then strike `target` from it if a strike reaches. */
function strikeFrom(unit: CombatUnit, hex: HexCoord, units: CombatUnit[], hazards: ArenaHazard[], target: CombatUnit): AIAction[] {
  const walk: AIAction[] = hexKey(hex) === hexKey(unit.position) ? [] : [{ type: 'move', targetPos: hex }];
  const skill = strikeAt(unit, hex, units, hazards, target);
  return [...walk, ...(skill ? [{ type: 'skill' as const, skill, skillTarget: target.position }] : [{ type: 'endturn' as const }])];
}

/** A hex of the Smash's mark where a push from the cast's origin would not move a hero standing there. */
function bracedHexInRing(
  unit: CombatUnit,
  attack: PreparedAttack,
  units: CombatUnit[],
  hazards: ArenaHazard[],
): HexCoord | undefined {
  const ring = new Set(attack.hexes.map(hexKey));
  const distance = attack.skill.pushDistance ?? 0;
  return getMovementRange(unit, units, hazards)
    .filter((h) => ring.has(hexKey(h)))
    .filter((h) => {
      const move = traceForcedMove(attack.origin, { ...unit, position: h }, distance, units, hazards);
      return !move.moved && (move.blockedBy?.kind === 'boundary' || move.blockedBy?.kind === 'hazard');
    })
    .sort((a, b) => a.q - b.q || a.r - b.r)[0];
}

/**
 * How `unit` answers an open warning of the Troll Chieftain by standing in it, or null to leave the turn
 * to the ordinary step. `order` is the turn order (ids), `hazards` the arena's standing ground.
 */
export function trollStand(
  unit: CombatUnit,
  units: CombatUnit[],
  hazards: ArenaHazard[],
  prepared: readonly PreparedAttack[],
  order: readonly string[],
): TrollStand | null {
  const boss = units.find((u) => !u.isPlayer && u.currentHp > 0 && isTroll(u));
  if (!boss || !isHero(unit)) return null;
  const attack = prepared.find((p) => p.casterId === boss.id);
  if (!attack) return null;

  const inside = threatensUnit(attack, unit, units);

  const shared = !!answerOf(attack, 'share');
  // The roof: everyone under it shares it, so the pair stays together when each survives its half
  if (shared) {
    const under = affectedBy(attack, units).filter(isHero);
    if (inside && under.length >= 2 && under.every((h) => survives(attack, boss, h, units, 1 / under.length))) {
      return { kind: 'stay', reason: 'shares the roof' };
    }
    // Alone under it, with a partner who still acts this round and can walk in: wait for them
    if (inside && under.length === 1) {
      const joining = laterHeroes(unit, units, boss, order)
        .find((p) => !threatensUnit(attack, p, units) && roofSpot(p, attack, units, hazards)
          && survives(attack, boss, p, units, 1 / 2) && survives(attack, boss, unit, units, 1 / 2));
      if (joining) return { kind: 'stay', reason: 'waits under the roof for the partner' };
    }
    // The partner alone under it: walk in and take half, when both survive the half
    if (!inside && under.length === 1 && survives(attack, boss, unit, units, 1 / 2) && survives(attack, boss, under[0], units, 1 / 2)) {
      const spot = roofSpot(unit, attack, units, hazards);
      if (spot) return { kind: 'move', reason: "walks under the partner's roof", actions: strikeFrom(unit, spot, units, hazards, boss) };
    }
  }

  // The Smash: rubble or the wall at the back keeps the hex and the turn
  if (answerOf(attack, 'brace') && inside && survives(attack, boss, unit, units, 1)) {
    const braced = previewPrepared(attack, units, hazards).braced;
    if (braced.includes(unit.id)) return { kind: 'stay', reason: 'braced against the rubble' };
    const reach = unit.skills.some((s) => !!s.damage && s.range <= 2);
    const hex = reach ? bracedHexInRing(unit, attack, units, hazards) : undefined;
    if (hex) {
      return { kind: 'move', reason: 'braces against the rubble', actions: [{ type: 'move', targetPos: hex }, { type: 'endturn' }] };
    }
  }

  // A round he would otherwise regenerate: the last hero to act strikes rather than step
  if (inside && willRegenerate(boss, units)) {
    const share = shared ? 1 / Math.max(1, affectedBy(attack, units).filter(isHero).length) : 1;
    if (survives(attack, boss, unit, units, share) && laterStrikers(unit, units, boss, attack, order).length === 0) {
      return { kind: 'stay', reason: 'strikes so he does not regenerate', needsStrike: true };
    }
  }
  return null;
}

// ─── The fort, between his warnings ─────────────────────────────────────────

/** A Sweep is worth taking cover from when it would take this share of the hero's health or more. */
const COVER_FROM = 0.4;

/** Where `unit` could stand this turn: where it is, and every hex it can walk to. */
const standable = (unit: CombatUnit, units: CombatUnit[], hazards: ArenaHazard[]): HexCoord[] =>
  [unit.position, ...getMovementRange(unit, units, hazards)];

/** Every hex a warning of his covers, so a fort move never walks into one. */
const warnedGround = (bossId: string, prepared: readonly PreparedAttack[]): Set<string> =>
  new Set(prepared.filter((p) => p.casterId === bossId).flatMap((p) => p.hexes.map(hexKey)));

/**
 * What a simulated hero does with the Troll's fort on a turn no warning of his has claimed
 * (`trollStand` has had its say), or null to leave the turn to the rest of the policy:
 *
 * - **Bait the Prey onto rubble** with the sturdier hero. When his next move is Farthest Prey, the hero
 *   with the most health walks to a hex beside a heap that leaves it the farthest from him, so the mark
 *   will hold the heap and he comes down on it Exposed (the hero still steps out of the mark once it is cast).
 *   The partner does not wander farther out than the bait while it is set.
 * - **Take cover** when his next action is a Sweep that would take `COVER_FROM` of the hero's health: a hex
 *   with a heap between the hero and him, which spares the hero and costs the heap.
 * - **Fight him from the side away from the heaps** the pair wants for the Smash: a hero that strikes him up
 *   close picks, among the hexes it can strike from, the one whose Sweep arc holds the fewest heaps.
 */
export function trollFort(
  unit: CombatUnit,
  units: CombatUnit[],
  hazards: ArenaHazard[],
  prepared: readonly PreparedAttack[],
): { reason: string; actions: AIAction[] } | null {
  const boss = units.find((u) => !u.isPlayer && u.currentHp > 0 && isTroll(u));
  if (!boss || !isHero(unit)) return null;
  const heaps = heapsOf(boss.id, hazards);
  if (heaps.length === 0) return null;
  const heroes = units.filter(isHero);
  const open = prepared.some((p) => p.casterId === boss.id);
  const next = upcomingMoves(boss, 1)[0];
  const warned = warnedGround(boss.id, prepared);
  const spots = standable(unit, units, hazards).filter((h) => !warned.has(hexKey(h)));
  const ownStrike = (hex: HexCoord) => strikeAt(unit, hex, units, hazards, boss);

  // Bait: the next thing he casts is the Prey, at whoever is farthest
  if (!open && next === 'prey' && heroes.length >= 2) {
    const sturdiest = [...heroes].sort((a, b) => b.currentHp - a.currentHp || (a.id < b.id ? -1 : 1))[0];
    const others = heroes.filter((h) => h.id !== sturdiest.id);
    const reach = (hex: HexCoord) => hexDistance(boss.position, hex);
    const baits = (hex: HexCoord) => heaps.some((h) => hexDistance(h, hex) <= BALANCE.TROLL_PREY_RADIUS);
    if (unit.id === sturdiest.id) {
      const farthest = Math.max(...others.map((o) => reach(o.position)));
      const set = spots
        .filter((h) => baits(h) && reach(h) > farthest)
        .sort((a, b) => Number(!!ownStrike(b)) - Number(!!ownStrike(a)) || hexDistance(a, unit.position) - hexDistance(b, unit.position))[0];
      if (set) return { reason: 'baits the Prey onto rubble', actions: strikeFrom(unit, set, units, hazards, boss) };
    } else if (baits(sturdiest.position) && reach(sturdiest.position) > reach(unit.position)) {
      // The bait is set: stay nearer him than it, striking from the best hex that does
      const line = reach(sturdiest.position);
      const near = spots.filter((h) => reach(h) < line);
      const pick = near.find((h) => hexKey(h) === hexKey(unit.position) && ownStrike(h)) ?? near.find(ownStrike);
      if (pick && reach(pick) < line) return { reason: 'stays nearer him than the bait', actions: strikeFrom(unit, pick, units, hazards, boss) };
    }
  }

  const sweep = boss.skills.find((s) => trollMoveOfSkill(s) === 'sweep');
  if (!sweep) return null;
  const sweepsNext = !open && (next === 'sweep' || isFurious(boss));
  const covered = (hex: HexCoord) => heapsBetween(boss.position, hex, heaps).length > 0;

  // Cover: a Sweep that would take a large share of this hero's health is worth a heap
  if (sweepsNext && !covered(unit.position) && hexDistance(unit.position, boss.position) <= (sweep.aoeRadius ?? 2)) {
    const blow = calculateDamage(boss, unit, sweep, 'front', units) * (isFurious(boss) ? 2 : 1);
    if (blow >= COVER_FROM * unit.currentHp) {
      const shelter = spots.filter(covered)
        .sort((a, b) => Number(!!ownStrike(b)) - Number(!!ownStrike(a)) || hexDistance(a, unit.position) - hexDistance(b, unit.position))[0];
      if (shelter) return { reason: 'takes cover behind a heap', actions: strikeFrom(unit, shelter, units, hazards, boss) };
    }
  }

  // Away from the heaps: where it strikes him up close, the side his Sweep at it would break the fewest heaps
  const melee = unit.skills.some((s) => !!s.damage && s.range <= 2 && canUseSkill(unit, s));
  if (!melee) return null;
  const inArc = (hex: HexCoord) => {
    const arc = new Set(arcHexes(sweep, boss.position, hex).map(hexKey));
    return heaps.filter((h) => arc.has(hexKey(h))).length;
  };
  const near = spots.filter((h) => hexDistance(h, boss.position) <= 2 && ownStrike(h));
  if (near.length === 0) return null;
  const best = [...near].sort((a, b) =>
    inArc(a) - inArc(b) || hexDistance(a, unit.position) - hexDistance(b, unit.position) || a.q - b.q || a.r - b.r)[0];
  // Only worth a different hex when the one it would take anyway costs heaps the best does not
  const here = near.find((h) => hexKey(h) === hexKey(unit.position));
  if (here && inArc(here) <= inArc(best)) return null;
  return inArc(best) === 0 || !here
    ? { reason: 'fights him from the side away from the heaps', actions: strikeFrom(unit, best, units, hazards, boss) }
    : null;
}
