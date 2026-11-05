import { skillName, statusName } from '@/data/gameText';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { FLOAT_COLOR } from '@/data/display/floatColors';
import { AfflictionType, ArenaHazard, AuraType, CombatUnit, HeroSkill, HexCoord, VfxSpec } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { unitById } from '@/systems/combat/unitLookup';
import { calculateDamage, calculateHealing } from '@/systems/combat/damageCalc';
import { applySkillStatus } from '@/systems/combat/combatEvents';
import { playTickEvents } from '@/systems/combat/tickEvents';
import { duelBars } from '@/systems/combat/duelRules';
import { crownedPreyFor } from '@/systems/combat/statusEffects';

/**
 * Wild Sanctuary's living ground (Lifewarden remaster, 2026-10).
 *
 * The cast itself is an ordinary aimed area resolved by `skillResolution`: it
 * heals the allies and hurts the enemies standing in it, with every passive that
 * a cast fires. Then `laySanctuary` leaves the footprint as an `ArenaHazard`
 * carrying `sanctuary`, and `pulseSanctuaries` — called from the owner's regular
 * turn start, before `tickHazards` counts the ground down — pulses it again:
 * the skill's `healing` onto allies and its `damage` onto enemies inside, from
 * the owner's live Magic. A pulse is ground, not a cast, so it rolls no critical
 * hit or dodge and raises no `onHeal` (regeneration never has).
 *
 * The Root is owed once per enemy per cast, on the first pulse that catches it
 * (the cast's own included). The hazard remembers who has had it, so stepping
 * out and back in, or standing in it for three turns, is never a second Root.
 * Control-immune enemies still take the damage; `applySkillStatus` refuses only
 * the Root.
 */

/** The narrow sink this needs; `CombatSink` satisfies it. */
export interface SanctuarySink {
  log(text: string, color: string): void;
  float(at: HexCoord, text: string, color: string): void;
  vfx(spec: VfxSpec): void;
  status?(at: HexCoord, label: string, color: string): void;
}

const HEAL_COLOR = FLOAT_COLOR.heal;
const THORN_COLOR = '#9be86a';

export const sanctuaryId = (ownerId: string) => `sanctuary:${ownerId}`;

const inside = (hexes: HexCoord[], at: HexCoord) => hexes.some((h) => h.q === at.q && h.r === at.r);

/**
 * Lays (or relays — one per caster, a recast replaces it) the sanctuary over
 * `hexes` after the cast resolved, then Roots the enemies the cast caught.
 */
export function laySanctuary(caster: CombatUnit, skill: HeroSkill, hexes: HexCoord[], sink: SanctuarySink): void {
  if (!skill.sanctuary) return;
  const store = useCombatStore.getState();
  const hazard: ArenaHazard = {
    id: sanctuaryId(caster.id),
    hexes,
    solid: false,
    skillId: skill.id,
    turnsLeft: skill.sanctuary.turns,
    ownerId: caster.id,
    sanctuary: { skillId: skill.id, rooted: [] },
  };
  store.removeHazard(hazard.id);
  store.addHazard(hazard);
  rootNewcomers(caster, skill, hazard.id, sink);
}

/**
 * Roots every enemy standing in the sanctuary that this cast has not Rooted yet,
 * and writes them down. A boss refuses the Root and is still written down: the
 * exposure happened, and asking again every turn would only repeat "IMMUNE".
 */
function rootNewcomers(owner: CombatUnit, skill: HeroSkill, hazardId: string, sink: SanctuarySink): void {
  const store = useCombatStore.getState();
  const hazard = store.hazards.find((h) => h.id === hazardId);
  if (!hazard?.sanctuary || !skill.sanctuary) return;
  const fresh: string[] = [];
  for (const unit of store.units) {
    if (unit.currentHp <= 0 || unit.objective || unit.isPlayer === owner.isPlayer) continue;
    if (!inside(hazard.hexes, unit.position) || hazard.sanctuary.rooted.includes(unit.id)) continue;
    if (duelBars(owner, unit)) continue;
    applySkillStatus(owner, unit.id, {
      type: AfflictionType.Root, magnitude: 1, duration: skill.sanctuary.rootTurns, sourceUnitId: owner.id,
    }, sink);
    fresh.push(unit.id);
  }
  if (fresh.length === 0) return;
  useCombatStore.setState((s) => ({
    hazards: s.hazards.map((h) =>
      h.id === hazardId && h.sanctuary ? { ...h, sanctuary: { ...h.sanctuary, rooted: [...h.sanctuary.rooted, ...fresh] } } : h,
    ),
  }));
}

/**
 * The start of `owner`'s regular turn: each sanctuary it owns pulses once. Ground
 * whose skill the owner no longer holds simply stays quiet until it withers.
 */
export function pulseSanctuaries(owner: CombatUnit, sink: SanctuarySink): void {
  const store = useCombatStore.getState();
  for (const hazard of store.hazards) {
    if (!hazard.sanctuary || hazard.ownerId !== owner.id) continue;
    const skill = owner.skills.find((s) => s.id === hazard.sanctuary!.skillId);
    if (!skill) continue;
    const hitUnitIds: string[] = [];
    for (const unit of useCombatStore.getState().units) {
      if (unit.currentHp <= 0 || unit.objective || !inside(hazard.hexes, unit.position)) continue;
      if (duelBars(owner, unit)) continue;
      if (unit.isPlayer === owner.isPlayer) {
        if (!skill.healing) continue;
        const landed = store.healUnit(unit.id, calculateHealing(owner, skill, unit), owner.id);
        if (landed > 0) {
          sink.float(unit.position, `+${landed}`, HEAL_COLOR);
          sink.log(`  ${unitName(unit)} +${landed}`, HEAL_COLOR);
        }
      } else {
        if (!skill.damage) continue;
        const thorns = calculateDamage(owner, unit, skill);
        // A Crowned Prey charge rides on any damaging hit of the side, a pulse included
        if (crownedPreyFor(owner, unit)) store.spendMarkCharge(unit.id, AfflictionType.CrownedPrey);
        const result = store.damageUnit(unit.id, thorns, owner.id);
        sink.float(unit.position, `-${result.hpLost + result.absorbed}`, THORN_COLOR);
        sink.log(`  ${t('combatLog.log.sourcedDamage', { name: unitName(unit), amount: result.hpLost, source: statusName(AuraType.Thorns) })}`, THORN_COLOR);
        if (result.deathEvents) playTickEvents(result.deathEvents, sink);
      }
      hitUnitIds.push(unit.id);
    }
    sink.log(t('combatLog.log.pulses', { name: unitName(owner), skill: skillName(skill) }), THORN_COLOR);
    sink.vfx({
      kind: 'bloom', delivery: 'spell',
      casterId: owner.id,
      casterPos: owner.position,
      targetCoord: hazard.hexes[0],
      hitUnitIds,
      hitCoords: hazard.hexes,
      color: skill.vfxColor ?? THORN_COLOR,
    });
    const live = unitById(useCombatStore.getState().units, owner.id) ?? owner;
    rootNewcomers(live, skill, hazard.id, sink);
  }
}
