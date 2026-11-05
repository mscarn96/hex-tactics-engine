import { BALANCE } from '@/data/balanceConstants';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { AuraType, CombatUnit, HexCoord, SoundIntent, VfxSpec } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { inArena } from '@/systems/combat/arenaGeometry';
import { unitById } from '@/systems/combat/unitLookup';
import { inDuelCircle } from '@/systems/combat/duelRules';
import { hasPassive, passiveRank } from '@/systems/combat/passives';
import { ECHO_STEALTH_MARK, shadowEchoCost, shadowEchoPerks } from '@/systems/combat/passiveFormulas';
import { moveIntent } from '@/systems/combat/soundIntents';
import { isActionLocked, isRooted } from '@/systems/combat/statusEffects';

/**
 * Shadow Echo, the Shadowblade's Signature node (2026-10 remaster).
 *
 * A Shadowstep that actually moved the caster leaves the caster's echo at the hex
 * it left (`AuraType.ShadowEcho`, the hex in `zone[0]`). While it stands, the
 * caster may return to it for mana **without spending the action**: before acting
 * (the action is still there afterwards) or after acting (the turn waits for the
 * return or End Turn, `combatStore.holdForEcho`). One echo per caster — the next
 * Shadowstep replaces it — and it is spent by the return, which neither refreshes
 * Shadowstep's cooldown nor leaves a new echo. It stands for the turn it was left
 * and the caster's next regular turn (`SHADOW_ECHO_TURNS`, ticked like any aura).
 *
 * The price is flat; the node's rungs add to the return (`shadowEchoPerks`): from
 * rank 2 it grants Stealth, and at rank 3 that Stealth carries `ECHO_STEALTH_MARK`,
 * which makes the first attack out of it a certain critical hit (the passive's
 * `critAgainst`; attacking breaks the Stealth, so it is one attack).
 *
 * Pure rules: the scene asks `echoReturnBlock` for the button and calls
 * `returnToEcho`; nothing here knows a camera.
 */

/** The channels a return reports through: the `CombatSink` subset it uses. */
export interface EchoSink {
  log: (text: string, color: string) => void;
  vfx?: (spec: VfxSpec) => void;
  sound?: (intent: SoundIntent) => void;
}

/** The echo's purple, on the ground marker and the return's flash. */
export const SHADOW_ECHO_COLOR = '#9b6bff';

/** Where the unit's echo stands, if it has one. */
export function echoHex(unit: CombatUnit): HexCoord | undefined {
  return unit.activeEffects.find((e) => e.type === AuraType.ShadowEcho)?.zone?.[0];
}

/** What a return costs this unit now, in mana (0 without the node). */
export function echoReturnCost(unit: CombatUnit): number {
  return hasPassive(unit, 'shadowEcho') ? shadowEchoCost() : 0;
}

/**
 * Why this unit cannot return to its echo now, or null when it can.
 *
 * The refusals are the ordinary control rules for a voluntary move: Stun, Freeze,
 * sleep or kneeling (anything that locks the turn) and Root refuse it; Silence and
 * Taunt do not, because a return is not a spell and strikes nobody. The echo's hex
 * must be free: a body or rubble on it refuses the return, and nothing is charged.
 */
export function echoReturnBlock(unit: CombatUnit, units: CombatUnit[]): string | null {
  const at = echoHex(unit);
  if (!at || unit.currentHp <= 0) return t('combatLog.refuse.noShadow');
  if (isActionLocked(unit)) return t('combatLog.refuse.cannotMove');
  if (isRooted(unit)) return t('combatLog.refuse.rootedShort');
  if (unit.position.q === at.q && unit.position.r === at.r) return t('combatLog.refuse.alreadyThere');
  const hazards = useCombatStore.getState().hazards;
  const blocked = !inArena(at) || !inDuelCircle(unit, at)
    || units.some((u) => u.id !== unit.id && u.currentHp > 0 && u.position.q === at.q && u.position.r === at.r)
    || hazards.some((h) => h.solid && h.hexes.some((x) => x.q === at.q && x.r === at.r));
  if (blocked) return t('combatLog.refuse.shadowCovered');
  if (unit.currentMana < echoReturnCost(unit)) return t('combatLog.refuse.noMana');
  return null;
}

/**
 * Leaves `caster`'s echo at `from`, replacing any it had. Called by
 * `resolveSkillUse` after a Shadowstep that moved, for a holder of the node.
 */
export function leaveEcho(casterId: string, from: HexCoord): void {
  const store = useCombatStore.getState();
  store.removeEffect(casterId, AuraType.ShadowEcho);
  store.applyEffect(casterId, {
    type: AuraType.ShadowEcho, magnitude: 1, duration: BALANCE.SHADOW_ECHO_TURNS,
    sourceUnitId: casterId, zone: [from],
  });
}

/**
 * The return: pays the mana, moves the caster to its echo and spends the echo.
 * The action flags are not touched — before acting the action is still there,
 * after acting the scene ends the turn. Returns whether it happened; a refused
 * return changes and charges nothing.
 */
export function returnToEcho(unitId: string, sink: EchoSink): boolean {
  const store = useCombatStore.getState();
  const unit = unitById(store.units, unitId);
  if (!unit || echoReturnBlock(unit, store.units) !== null) return false;
  const to = echoHex(unit)!;
  const from = unit.position;
  const cost = echoReturnCost(unit);
  if (cost > 0) store.spendMana(unit.id, cost);
  store.removeEffect(unit.id, AuraType.ShadowEcho);
  store.moveUnit(unit.id, to, 'walk');
  const perks = shadowEchoPerks(passiveRank(unit, 'shadowEcho'));
  if (perks.stealth) {
    store.applyEffect(unit.id, {
      type: AuraType.Stealth, magnitude: perks.crit ? ECHO_STEALTH_MARK : 1,
      duration: BALANCE.STEALTH_DURATION, sourceUnitId: unit.id,
    });
  }
  sink.sound?.(moveIntent(unit.id, from, to, 'blink'));
  sink.log(`  ${t('combatLog.log.returnsShadow', { name: unitName(unit), cost })}`, SHADOW_ECHO_COLOR);
  sink.vfx?.({
    kind: 'buff', delivery: 'spell', casterId: '', casterPos: from, targetCoord: to,
    hitUnitIds: [unit.id], hitCoords: [from, to], color: SHADOW_ECHO_COLOR, durationScale: 0.7,
  });
  return true;
}
