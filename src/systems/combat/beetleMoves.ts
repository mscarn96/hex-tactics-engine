import { skillName } from '@/data/gameText';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { passiveName } from '@/systems/combat/passives';
import type { CombatSink } from '@/systems/combat/combatSink';
import { CombatUnit, HeroSkill, HexCoord, ReactionEvent } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { unitById } from '@/systems/combat/unitLookup';
import { applySkillStatus } from '@/systems/combat/combatEvents';
import { calculateDamage, resolveEntryMagnitude } from '@/systems/combat/damageCalc';
import { traceForcedMove } from '@/systems/combat/forcedMovement';
import { isAffliction, isRooted, settleMagnitude, skillEffects, effectLands } from '@/systems/combat/statusEffects';
import { playTickEvents } from '@/systems/combat/tickEvents';
import { moveIntent, strikeDetail, strikeIntent, strikeOutcome } from '@/systems/combat/soundIntents';
import { duelBars } from '@/systems/combat/duelRules';
import { bastionHazard, retributionBlow, vengefulCover, wardCover } from '@/systems/combat/beetle';
import { getNeighbors, hexDistance } from '@/utils/hexUtils';

/**
 * The Beetle's three capstones, where they act on the board
 * (the private project notes, "Beetle", tier 3). The rules they read are pure
 * and live in `beetle.ts`; this is the half that moves bodies and writes the
 * store, called by the resolver at the one moment each belongs to.
 *
 * - **Vengeful Shell** (`interceptBlow`): before a single-target blow lands on an
 *   ally, the Beetle leaps beside them and becomes the body the blow strikes.
 * - **Carapace Bastion** (`layBastion`): the cast leaves static ground; the split
 *   itself is the damage funnel's (`damageFunnel.damageUnit`).
 * - **Shell Swap** (`swapPlaces`): two bodies trade hexes at once.
 * - **Retribution** (`retribute`): the attacker of a blow taken or split is struck back.
 */

/** The carapace's amber, for what the Beetle does for others. */
const BEETLE_AMBER = '#e0a83c';

type MoveSink = Pick<CombatSink, 'log' | 'float' | 'vfx' | 'status' | 'sound'>;

/**
 * Vengeful Shell takes the blow `attacker` is about to land on `target`, when a
 * prepared one covers it: the Beetle leaps to its landing, one of the round's
 * answers is spent, the answer at the attacker is queued for once the action has
 * resolved, and the Beetle is returned as the body the blow now strikes. The
 * target itself, untouched, when nothing covers it.
 */
export function interceptBlow(
  attacker: CombatUnit,
  target: CombatUnit,
  skill: HeroSkill,
  sink: MoveSink,
): CombatUnit {
  const store = useCombatStore.getState();
  const cover = vengefulCover(attacker, target, skill, store.reactions, store.units, store.hazards);
  if (!cover) return target;
  const { reaction, owner, landing } = cover;
  if (landing.q !== owner.position.q || landing.r !== owner.position.r) {
    store.moveUnit(owner.id, landing, 'jump', false);
    sink.sound?.(moveIntent(owner.id, owner.position, landing, 'dash'));
  }
  store.setFacing(owner.id, attacker.position);
  const event: ReactionEvent = { kind: 'intercepted', reactionId: reaction.id, attackerId: attacker.id };
  useCombatStore.setState((s) => ({
    reactions: s.reactions.map((r) => (r.id === reaction.id ? { ...r, shotsLeft: (r.shotsLeft ?? 1) - 1 } : r)),
    reactionEvents: [...s.reactionEvents, event],
  }));
  const taker = unitById(useCombatStore.getState().units, owner.id) ?? owner;
  sink.log(`  ${t('combatLog.log.takesBlowFor', { name: unitName(owner), skill: skillName(reaction.skill), target: unitName(target) })}`, BEETLE_AMBER);
  sink.status(taker.position, t('combatLog.float.shell'), BEETLE_AMBER);
  return taker;
}

/**
 * Carapace Leap, before the blow `attacker` is about to land on `target`: when a
 * prepared Leap watches this ally, the Beetle leaps beside them, both gain the
 * response's Barriers and the Reaction is spent, so the blow that follows is
 * soaked by the ward's new Barrier. Nothing when no Leap watches `target`.
 */
export function shieldWard(attacker: CombatUnit, target: CombatUnit, sink: MoveSink): boolean {
  const store = useCombatStore.getState();
  const cover = wardCover(attacker, target, store.reactions, store.units, store.hazards);
  if (!cover) return false;
  const { reaction, owner, landing } = cover;
  const response = reaction.spec.response;
  store.removeReaction(reaction.id);
  if (landing.q !== owner.position.q || landing.r !== owner.position.r) {
    playTickEvents(store.moveUnit(owner.id, landing, 'jump', false), sink);
    sink.sound?.(moveIntent(owner.id, owner.position, landing, 'dash'));
  }
  const leapt = unitById(useCombatStore.getState().units, owner.id) ?? { ...owner, position: landing };
  sink.log(`  ${t('combatLog.log.skillShields', { name: unitName(owner), skill: skillName(reaction.skill), target: unitName(target) })}`, BEETLE_AMBER);
  for (const entry of skillEffects(response)) {
    if (isAffliction(entry.type) || !effectLands(entry)) continue;
    const recipient = unitById(useCombatStore.getState().units, entry.selfOnly ? owner.id : target.id);
    if (!recipient || recipient.currentHp <= 0) continue;
    applySkillStatus(leapt, recipient.id, {
      type: entry.type,
      magnitude: settleMagnitude(entry.type, resolveEntryMagnitude(entry, leapt, recipient, response.scaling)),
      duration: entry.duration,
      sourceUnitId: owner.id,
    }, sink);
  }
  useCombatStore.getState().setFacing(owner.id, attacker.position);
  return true;
}

/** Lays Carapace Bastion's ground over the cast's footprint, replacing the caster's last. */
export function layBastion(caster: CombatUnit, skill: HeroSkill, hexes: HexCoord[], sink: MoveSink): boolean {
  const ground = bastionHazard(caster, skill, hexes);
  if (!ground) return false;
  const store = useCombatStore.getState();
  store.removeHazard(ground.id);
  store.addHazard(ground);
  sink.log(`  ${t('combatLog.log.plantsBastion', { name: unitName(caster) })}`, BEETLE_AMBER);
  return true;
}

export type SwapRefusal = 'rooted' | 'no-targets';

/**
 * Shell Swap: the Beetle and the ally aimed at trade hexes, two bodies at once.
 * The skill's aura entries land on the ally here (the footprint, the hex the
 * Beetle now stands on, gives the Beetle its own); every enemy beside the
 * Beetle's new hex is shoved directly away and takes the skill's afflictions.
 *
 * Refused while the Beetle is Rooted, and when the ally is out of reach.
 */
export function swapPlaces(
  caster: CombatUnit,
  skill: HeroSkill,
  ally: CombatUnit | undefined,
  sink: MoveSink,
): { ok: true; caster: CombatUnit } | { ok: false; refusal: SwapRefusal } {
  const spec = skill.swapsPlaces;
  if (!spec || !ally || ally.id === caster.id || ally.isPlayer !== caster.isPlayer || ally.objective || ally.currentHp <= 0) {
    return { ok: false, refusal: 'no-targets' };
  }
  if (hexDistance(caster.position, ally.position) > skill.range) return { ok: false, refusal: 'no-targets' };
  if (isRooted(caster)) return { ok: false, refusal: 'rooted' };

  const store = useCombatStore.getState();
  const from = caster.position;
  const to = ally.position;
  store.moveUnit(caster.id, to, 'dash');
  store.moveUnit(ally.id, from, 'jump', false);
  sink.sound?.(moveIntent(caster.id, from, to, 'dash'));
  sink.log(`  ${t('combatLog.log.tradesPlaces', { name: unitName(caster), target: unitName(ally) })}`, BEETLE_AMBER);

  const entries = skillEffects(skill);
  const moved = unitById(useCombatStore.getState().units, caster.id) ?? { ...caster, position: to };
  const swapped = unitById(useCombatStore.getState().units, ally.id);
  if (swapped) {
    for (const entry of entries) {
      if (isAffliction(entry.type) || !effectLands(entry)) continue;
      applySkillStatus(moved, swapped.id, {
        type: entry.type,
        magnitude: settleMagnitude(entry.type, resolveEntryMagnitude(entry, caster, swapped, skill.scaling)),
        duration: entry.duration,
        sourceUnitId: caster.id,
      }, sink);
    }
  }

  // The enemies round the landing, nearest the axis first so a shove into a hex a
  // neighbour is about to leave is read on the board as it stands
  const around = getNeighbors(to);
  for (const hex of around) {
    const live = useCombatStore.getState();
    const enemy = live.units.find((u) => u.currentHp > 0 && !u.objective && u.isPlayer !== caster.isPlayer
      && u.position.q === hex.q && u.position.r === hex.r);
    if (!enemy || duelBars(moved, enemy)) continue;
    const shove = traceForcedMove(to, enemy, spec.push, live.units, live.hazards);
    if (shove.moved) {
      playTickEvents(store.moveUnit(enemy.id, shove.to, 'walk', false), sink);
      sink.sound?.(moveIntent(enemy.id, enemy.position, shove.to, 'shove'));
      sink.log(`  ${t('combatLog.log.pushedBack', { name: unitName(enemy) })}`, '#ffaa44');
    }
    const after = unitById(useCombatStore.getState().units, enemy.id);
    if (!after || after.currentHp <= 0) continue;
    for (const entry of entries) {
      if (!isAffliction(entry.type) || !effectLands(entry)) continue;
      applySkillStatus(moved, after.id, {
        type: entry.type,
        magnitude: settleMagnitude(entry.type, resolveEntryMagnitude(entry, caster, after, skill.scaling)),
        duration: entry.duration,
        sourceUnitId: caster.id,
      }, sink);
    }
  }
  return { ok: true, caster: unitById(useCombatStore.getState().units, caster.id) ?? moved };
}

/**
 * Retribution: the Beetle that took a blow for an ally (Vengeful Shell) or split
 * one with them (Carapace Bastion) strikes the attacker back at once, wherever it
 * stands — a certain blow (no dodge, no critical), answered by Physical Defense.
 * Nothing for a Beetle without the passive, a fallen one, or a fallen attacker.
 * Returns the HP the attacker lost.
 */
export function retribute(ownerId: string, attackerId: string, sink: MoveSink): number {
  const store = useCombatStore.getState();
  const owner = unitById(store.units, ownerId);
  const attacker = unitById(store.units, attackerId);
  if (!owner || !attacker || owner.currentHp <= 0 || attacker.currentHp <= 0 || owner.isPlayer === attacker.isPlayer) return 0;
  const blow = retributionBlow(owner);
  if (!blow) return 0;
  const damage = calculateDamage(owner, attacker, blow, 'front', store.units);
  const taken = store.damageUnit(attacker.id, damage, owner.id, { difficultyApplied: true });
  const { hpLost, deathEvents } = taken;
  // The shell struck back with: a weight landing, heard with its number
  sink.sound?.(strikeIntent(
    attacker, 'blunt', strikeOutcome({ dodged: false, crit: false }, hpLost), undefined, undefined, strikeDetail(undefined, taken),
  ));
  sink.float(attacker.position, `-${damage}`, BEETLE_AMBER);
  sink.log(`  ${passiveName('retribution')}: ${unitName(attacker)} -${hpLost}`, BEETLE_AMBER);
  playTickEvents(deathEvents ?? [], sink);
  return hpLost;
}
