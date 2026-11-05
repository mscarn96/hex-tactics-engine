import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { CombatUnit, HeroSkill, HexCoord, SoundIntent, VfxSpec } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { FLOAT_COLOR } from '@/data/display/floatColors';
import { useCombatStore } from '@/stores/combatStore';
import { calculateHealing } from '@/systems/combat/damageCalc';
import { beaconPulseTargets, isLanternBeacon, moteHexes, moteId } from '@/systems/combat/fireflyRules';
import { combatMaxHp } from '@/systems/combat/forms';
import { unitById } from '@/systems/combat/unitLookup';
import { mendIntent } from '@/systems/combat/soundIntents';

/**
 * The Firefly's capstones that live on the board after the cast
 * (the private project notes, "### Firefly"): the store-touching halves of
 * `fireflyRules`.
 *
 * - **Firefly Motes** are laid here (`layMotes`, called by `skillResolution` for a
 *   skill carrying `motes`) as one non-solid `ArenaHazard` per hex. What arriving
 *   on one does is `combatStore.moveUnit`'s, because every arrival route — a step,
 *   a dash or blink landing, a shove — already comes through it. The AI's moves do
 *   not read motes, so an enemy puts one out only by passing that way.
 * - **The Lantern Beacon** is an ordinary stationary companion summon; its pulse
 *   and its burn run here (`tendBeacon`), on its Firefly's regular turn start
 *   (`turnStart.tickCompanions`), and its light is `combatStore.syncBeacons`.
 */

/** The narrow sink this needs; `CombatSink` satisfies it. */
export interface FireflyGroundSink {
  log(text: string, color: string): void;
  float(at: HexCoord, text: string, color: string): void;
  vfx(spec: VfxSpec): void;
  sound?(intent: SoundIntent): void;
}

const AMBER = '#ff9e00';
const F = () => BALANCE.FIREFLY;

/**
 * Lays a cast's motes round the caster. Each carries the heal it will give,
 * fixed now from the caster's Magic and healing power through the ordinary heal
 * formula. Returns the hexes laid on — empty when there was no free ground.
 */
export function layMotes(caster: CombatUnit, skill: HeroSkill, sink: FireflyGroundSink): HexCoord[] {
  if (!skill.motes) return [];
  const store = useCombatStore.getState();
  const hexes = moteHexes(caster, store.units, store.hazards, skill.motes.count);
  const heal = Math.max(1, calculateHealing(caster, { ...skill, healing: skill.motes.heal }));
  for (const hex of hexes) {
    store.removeHazard(moteId(caster.id, hex));
    store.addHazard({
      id: moteId(caster.id, hex), hexes: [hex], solid: false, skillId: skill.id,
      ownerId: caster.id, mote: { heal },
    });
  }
  if (hexes.length > 0) {
    sink.log(`  ${t('combatLog.log.motesSettle', { count: hexes.length })}`, AMBER);
    sink.vfx({
      kind: 'bloom', delivery: 'spell', casterId: caster.id, casterPos: caster.position, targetCoord: caster.position,
      hitUnitIds: [], hitCoords: hexes, color: AMBER,
    });
  }
  return hexes;
}

/**
 * A Lantern Beacon's turn, which is its Firefly's: first it heals every ally in
 * its light for `BEACON_HEAL` × the Firefly's Magic, then it burns
 * `BEACON_DECAY` of its maximum through `damageUnit`, so healing it lengthens
 * its life and every blow shortens it. Pulse before burn, so the turn it burns
 * out on still heals. Returns whether it still stands.
 */
export function tendBeacon(beacon: CombatUnit, owner: CombatUnit, sink: FireflyGroundSink): boolean {
  const store = useCombatStore.getState();
  if (!isLanternBeacon(beacon)) return false;
  const pulse = { id: 'lantern_beacon', healing: F().BEACON_HEAL } as HeroSkill;
  const healed: CombatUnit[] = [];
  for (const ally of beaconPulseTargets(beacon, store.units)) {
    const restored = store.healUnit(ally.id, calculateHealing(owner, pulse, ally), owner.id);
    if (restored > 0) {
      sink.sound?.(mendIntent(ally));
      sink.float(ally.position, `+${restored}`, FLOAT_COLOR.heal);
      healed.push(ally);
    }
  }
  if (healed.length > 0) {
    sink.log(`  ${t('combatLog.log.healsAll', { name: unitName(beacon), targets: healed.map(unitName).join(', ') })}`, AMBER);
    sink.vfx({
      kind: 'bloom', delivery: 'spell', casterId: beacon.id, casterPos: beacon.position, targetCoord: beacon.position,
      hitUnitIds: healed.map((u) => u.id), hitCoords: healed.map((u) => u.position), color: AMBER,
    });
  }
  const loss = Math.ceil(combatMaxHp(beacon) * F().BEACON_DECAY);
  const result = useCombatStore.getState().damageUnit(beacon.id, loss);
  sink.float(beacon.position, `-${result.hpLost}`, AMBER);
  const left = unitById(useCombatStore.getState().units, beacon.id);
  if (!left || left.currentHp <= 0) {
    sink.log(`  ${t('combatLog.log.burnsOut', { name: unitName(beacon) })}`, AMBER);
    return false;
  }
  return true;
}
