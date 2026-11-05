import { ArenaHazard, CombatUnit, HeroSkill, HexCoord, VfxSpec } from '@/models/types';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { useCombatStore } from '@/stores/combatStore';
import { inArena } from '@/systems/combat/arenaGeometry';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { hasPassive, passiveName, passiveRank } from '@/systems/combat/passives';
import { aftershockMultiplier } from '@/systems/combat/passiveFormulas';
import { playTickEvents } from '@/systems/combat/tickEvents';
import { duelBars } from '@/systems/combat/duelRules';

/**
 * Aftershock (Stoneshaper remaster, 2026-10): Tremor's ground erupts again.
 *
 * A Tremor cast by a holder of the node leaves its footprint as an `ArenaHazard`
 * carrying `aftershock` (`markAftershock`, called by `skillResolution` after the
 * cast resolved). At the start of the owner's next regular turn — before
 * `tickHazards` counts the ground out — `eruptAftershocks` strikes every enemy
 * still standing on it for the rung's share of the owner's live Magic, as a
 * physical hit through the ordinary defence formula. It is ground, not a cast: no
 * critical roll, no dodge, no Stun and no on-hit passives. Then the mark is spent.
 *
 * Timing and cancellation, settled here once:
 * - One mark per owner; a new Tremor replaces an unspent one.
 * - The owner dying takes the mark with it (`tickHazards` clears ground whose
 *   owner is gone), so a dead Stoneshaper's aftershock never lands.
 * - A Stun or Silence on the owner does not stop it: the ground was already
 *   broken, and the eruption happens before the turn is lost.
 * - Enemies who walked off the marked hexes are spared; ones who walked on are hit.
 */

/** The narrow sink this needs; `CombatSink` satisfies it. */
export interface AftershockSink {
  log(text: string, color: string): void;
  float(at: HexCoord, text: string, color: string): void;
  vfx(spec: VfxSpec): void;
}

const ROCK_COLOR = '#c8a878';

export const aftershockId = (ownerId: string) => `aftershock:${ownerId}`;

const inside = (hexes: HexCoord[], at: HexCoord) => hexes.some((h) => h.q === at.q && h.r === at.r);

/**
 * Marks Tremor's footprint for the repeat eruption when `caster` holds Aftershock.
 * Off-board hexes are dropped, so the warning never draws outside the arena.
 */
export function markAftershock(caster: CombatUnit, skill: HeroSkill, hexes: HexCoord[]): boolean {
  if (skill.id !== 'tremor' || !hasPassive(caster, 'aftershock')) return false;
  const ground = hexes.filter(inArena);
  if (ground.length === 0) return false;
  const store = useCombatStore.getState();
  const hazard: ArenaHazard = {
    id: aftershockId(caster.id),
    hexes: ground,
    solid: false,
    passiveId: 'aftershock',
    turnsLeft: 1,
    ownerId: caster.id,
    aftershock: { multiplier: aftershockMultiplier(passiveRank(caster, 'aftershock')) },
  };
  store.removeHazard(hazard.id);
  store.addHazard(hazard);
  return true;
}

/** The start of `owner`'s regular turn: its marked Tremor ground erupts once, then is spent. */
export function eruptAftershocks(owner: CombatUnit, sink: AftershockSink): void {
  const store = useCombatStore.getState();
  for (const hazard of store.hazards) {
    if (!hazard.aftershock || hazard.ownerId !== owner.id) continue;
    const tremor = owner.skills.find((s) => s.id === 'tremor');
    // The wave: Tremor's own hit at the rung's share, and nothing else of Tremor
    const wave: HeroSkill | undefined = tremor && {
      ...tremor, damage: hazard.aftershock.multiplier, appliesEffect: undefined,
    };
    const hitUnitIds: string[] = [];
    if (wave) {
      for (const unit of useCombatStore.getState().units) {
        if (unit.currentHp <= 0 || unit.isPlayer === owner.isPlayer || !inside(hazard.hexes, unit.position)) continue;
        if (duelBars(owner, unit)) continue;
        const result = useCombatStore.getState().damageUnit(unit.id, calculateDamage(owner, unit, wave), owner.id);
        sink.float(unit.position, `-${result.hpLost + result.absorbed}`, ROCK_COLOR);
        sink.log(`  ${t('combatLog.log.sourcedDamage', { name: unitName(unit), amount: result.hpLost, source: passiveName('aftershock') })}`, ROCK_COLOR);
        if (result.deathEvents) playTickEvents(result.deathEvents, sink);
        hitUnitIds.push(unit.id);
      }
    }
    sink.log(t('combatLog.log.aftershockErupts', { name: unitName(owner), source: passiveName('aftershock') }), ROCK_COLOR);
    sink.vfx({
      kind: 'quake', delivery: 'blunt',
      casterId: owner.id,
      casterPos: hazard.hexes[0],
      targetCoord: hazard.hexes[0],
      hitUnitIds,
      hitCoords: hazard.hexes,
      color: ROCK_COLOR,
      durationScale: 0.8,
    });
    // Spent: one repeat eruption per Tremor
    useCombatStore.getState().removeHazard(hazard.id);
  }
}
