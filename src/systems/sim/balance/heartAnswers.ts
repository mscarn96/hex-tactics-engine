import { AuraType, CombatUnit, HexCoord, PreparedAttack } from '@/models/types';
import { dragonClaw, furnaceHeart, passHeart } from '@/data/templates/emeraldDragon';
import { BALANCE } from '@/data/balanceConstants';
import { useCombatStore } from '@/stores/combatStore';
import { calculateDamage, expectedDamage } from '@/systems/combat/damageCalc';
import { canUseSkill } from '@/systems/combat/cooldowns';
import {
  clawOnCarrier, heartBurnBlow, heartRoundsLeft, heartWarning, isDragon, nextHeartBurn, passTargets,
} from '@/systems/combat/dragonScript';
import type { AIAction } from '@/systems/combat/enemyAI';
import { getMovementRange } from '@/systems/combat/movement';
import { resolvedSkill } from '@/systems/combat/preparedAttacks';
import { activeTaunt } from '@/systems/combat/taunt';
import { hexDistance } from '@/utils/hexUtils';

/**
 * The simulated party's hot potato with the Emerald Dragon's carried Furnace Heart
 * (`docs/combat.md`, the Emerald Dragon; designed in the private project notes). Basic tactics,
 * like the rest of the party policy:
 *
 * - **Pass before the carrier could fall.** A carrier the next burn and his Claw (when a wedge of it reaches
 *   them) could fell together hands it to the sturdiest hero within reach who would not be felled in turn,
 *   and a hero within reach of such a carrier — or a walk from it — takes it from them. A fallen carrier sets
 *   the Heart off at once, so this comes before anything but stopping Skyfire.
 * - **Pass before the burn outgrows the carrier.** Once the next burn would take `OUTGROWN` of what the carrier
 *   has left, the carrier hands it on to a hero who would take its first step for less.
 * - **Hand it to a sturdy hero before the burst.** On its last round a carrier the burst would fell, or one
 *   with an ally within reach markedly sturdier, passes it to the sturdiest.
 * - **Keep the carrier out of the Claw.** A carrier the Claw and the next burn could fell, with nobody in reach
 *   to take it, steps to a hex no wedge of the Claw reaches (a hero moves or acts, so the step is the turn).
 * - **Break the crystal with whoever can reach it** (`partyPolicy.breakBound`), when the heroes who reach it
 *   where they stand could break it before it bursts (`crystalWorthBreaking`): otherwise their blows go to him,
 *   since a crystal left standing is a seventh of his health struck for nothing.
 *
 * Keeping off a carrier's neighbours is the ordinary step out of a drawn footprint (`emperorMeasure.warnedFor`,
 * which shows the burst only when it is near).
 */

/** The share of what the carrier has left the next burn must take before the burn has outgrown them. */
const OUTGROWN = 0.2;
/** How much sturdier a hero must be to be handed the Heart on its last round when the carrier would live through the burst. */
const STURDIER = 1.3;

const isHero = (u: CombatUnit) => u.isPlayer && !u.objective && !u.summonedBy && u.currentHp > 0;

/** Health and Barrier: what it takes to fell the hero. */
const sturdiness = (u: CombatUnit) =>
  u.currentHp + u.activeEffects.filter((e) => e.type === AuraType.Barrier).reduce((sum, e) => sum + e.magnitude, 0);

/** The Claw's blow on `hero` when a wedge of it reaches them from where he stands now (a Taunt sends it elsewhere). */
function clawOn(dragon: CombatUnit, hero: CombatUnit, units: CombatUnit[]): number {
  const taunter = activeTaunt(dragon, units);
  if (taunter && taunter.id !== hero.id) return 0;
  return clawOnCarrier(dragon, dragonClaw, hero, units) ? calculateDamage(dragon, hero, dragonClaw, 'front', units) : 0;
}

/** What could fall on a carrier before they act again: his Claw on them, then their next burn. */
function threatTo(dragon: CombatUnit, hero: CombatUnit, units: CombatUnit[], fresh: boolean): number {
  const burn = fresh ? calculateDamage(dragon, hero, heartBurnBlow(0), 'front', units) : nextHeartBurn(dragon, hero, units);
  return burn + clawOn(dragon, hero, units);
}

const burstOn = (dragon: CombatUnit, hero: CombatUnit, units: CombatUnit[]) =>
  calculateDamage(dragon, hero, resolvedSkill(furnaceHeart), 'front', units);

interface Heart {
  attack: PreparedAttack;
  dragon: CombatUnit;
  carrier: CombatUnit;
}

/** The Heart the Dragon has on a hero of `unit`'s side, if one is carried. */
function carriedHeart(unit: CombatUnit, units: CombatUnit[]): Heart | null {
  const prepared = useCombatStore.getState().preparedAttacks;
  for (const dragon of units.filter((u) => u.currentHp > 0 && isDragon(u) && u.isPlayer !== unit.isPlayer)) {
    const attack = heartWarning(dragon, prepared);
    const carrier = units.find((u) => u.id === attack?.bound?.[0] && u.currentHp > 0);
    if (attack && carrier) return { attack, dragon, carrier };
  }
  return null;
}

/** Why the carrier should be rid of it now, or null when it can keep it. */
function passReason(heart: Heart, units: CombatUnit[]): 'falls' | 'outgrown' | 'burst' | null {
  const { attack, dragon, carrier } = heart;
  if (threatTo(dragon, carrier, units, false) >= sturdiness(carrier)) return 'falls';
  if (heartRoundsLeft(attack, units) <= 1) return 'burst';
  return nextHeartBurn(dragon, carrier, units) >= OUTGROWN * sturdiness(carrier) ? 'outgrown' : null;
}

/**
 * Who should hold it next among `candidates`: a hero the burn and the Claw would not fell, and on its last
 * round one the burst would not fell either if any; then the sturdiest, then the lower id.
 */
function bestHolder(heart: Heart, candidates: CombatUnit[], units: CombatUnit[], reason: 'falls' | 'outgrown' | 'burst'): CombatUnit | null {
  const { dragon, carrier } = heart;
  const safe = candidates.filter((h) => sturdiness(h) > threatTo(dragon, h, units, true));
  const lasts = reason === 'burst' ? safe.filter((h) => sturdiness(h) > burstOn(dragon, h, units)) : safe;
  const pool = (lasts.length > 0 ? lasts : safe)
    .sort((a, b) => sturdiness(b) - sturdiness(a) || (a.id < b.id ? -1 : 1));
  const best = pool[0];
  if (!best) return null;
  // Its last round: only worth the turn when the carrier would fall to the burst, or the other is markedly sturdier
  if (reason === 'burst' && sturdiness(carrier) > burstOn(dragon, carrier, units)
    && sturdiness(best) < STURDIER * sturdiness(carrier)) return null;
  // Outgrown: only to a hero whose first step burns less than the carrier's next
  if (reason === 'outgrown' && calculateDamage(dragon, best, heartBurnBlow(0), 'front', units) >= nextHeartBurn(dragon, carrier, units)) return null;
  return best;
}

const passAt = (to: HexCoord): AIAction[] => [{ type: 'skill', skill: passHeart, skillTarget: { ...to } }];

/** A hex `unit` can walk to and stand within reach of `to` (nearest walk first), or none. */
function walkWithin(unit: CombatUnit, to: CombatUnit, units: CombatUnit[]): HexCoord | null {
  const reach = BALANCE.DRAGON_HEART_PASS_RANGE;
  return getMovementRange(unit, units, useCombatStore.getState().hazards)
    .filter((h) => hexDistance(h, to.position) <= reach)
    .sort((a, b) => hexDistance(a, unit.position) - hexDistance(b, unit.position) || a.q - b.q || a.r - b.r)[0] ?? null;
}

/** The hero's turn with the Heart, or null when the Heart asks nothing of it. */
export function heartPotato(unit: CombatUnit, units: CombatUnit[]): { reason: string; actions: AIAction[] } | null {
  if (!isHero(unit)) return null;
  const heart = carriedHeart(unit, units);
  if (!heart) return null;
  const { dragon, carrier } = heart;
  const reason = passReason(heart, units);

  if (carrier.id === unit.id) {
    if (reason) {
      const to = bestHolder(heart, passTargets(unit, units), units, reason);
      if (to) return { reason: `passes the Heart (${reason})`, actions: passAt(to.position) };
    }
    // Keep it out of his Claw when the Claw and the burn could fell it and nobody took it: a hex no wedge reaches
    if (reason === 'falls' && clawOn(dragon, unit, units) > 0) {
      const out = getMovementRange(unit, units, useCombatStore.getState().hazards)
        .filter((h) => !clawOnCarrier(dragon, dragonClaw, { ...unit, position: h }, units))
        .sort((a, b) => hexDistance(a, unit.position) - hexDistance(b, unit.position) || a.q - b.q || a.r - b.r)[0];
      if (out) return { reason: 'keeps the Heart out of his Claw', actions: [{ type: 'move', targetPos: out }, { type: 'endturn' }] };
    }
    return null;
  }

  // Another hero takes it from a carrier who is in danger, or who should hand it on and cannot reach anyone
  if (!reason) return null;
  const others = units.filter((u) => isHero(u) && u.id !== carrier.id);
  const best = bestHolder(heart, others, units, reason);
  if (!best || best.id !== unit.id) {
    // Not the one best placed to hold it: still take it from a carrier about to fall, if nobody better can
    if (reason !== 'falls' || !best || passTargets(best, units).some((u) => u.id === carrier.id) || !bestHolder(heart, [unit], units, reason)) return null;
  }
  if (passTargets(unit, units).some((u) => u.id === carrier.id)) {
    return { reason: `takes the Heart (${reason})`, actions: passAt(carrier.position) };
  }
  // A carrier about to fall is worth the walk: within reach now, the Heart is taken next turn
  if (reason !== 'falls') return null;
  const spot = walkWithin(unit, carrier, units);
  return spot ? { reason: 'walks to take the Heart', actions: [{ type: 'move', targetPos: spot }, { type: 'endturn' }] } : null;
}

/** For the tests and the tuning notes: why a carrier would pass now, read the way the policy reads it. */
export const heartPassReason = (unit: CombatUnit, units: CombatUnit[]) => {
  const heart = carriedHeart(unit, units);
  return heart ? passReason(heart, units) : null;
};

/**
 * Whether the heroes who can strike `crystal` where they stand could break it before it bursts: each one's best
 * expected blow on it, summed, times the rounds left (at least one), against its health. A crystal they cannot
 * break in time is left to the pass, and their blows go to him.
 */
export function crystalWorthBreaking(crystal: CombatUnit, units: CombatUnit[]): boolean {
  const prepared = useCombatStore.getState().preparedAttacks;
  const attack = prepared.find((p) => p.id === crystal.objective?.linkedPreparedId);
  if (!attack) return false;
  let round = 0;
  for (const hero of units.filter((u) => isHero(u) && u.isPlayer !== crystal.isPlayer)) {
    const reach = hexDistance(hero.position, crystal.position);
    let best = 0;
    for (const skill of hero.skills) {
      if (!skill.damage || !canUseSkill(hero, skill) || skill.range < reach) continue;
      best = Math.max(best, expectedDamage(hero, crystal, skill, 'front', units));
    }
    round += best;
  }
  return round * Math.max(1, heartRoundsLeft(attack, units)) >= crystal.currentHp;
}
