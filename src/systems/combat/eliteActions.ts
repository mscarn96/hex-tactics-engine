import { AfflictionType, AuraType, CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import type { BossFx } from '@/systems/combat/bossActions';
import { expectedDamage } from '@/systems/combat/damageCalc';
import { BALANCE } from '@/data/balanceConstants';
import { findSummonHexes } from '@/systems/combat/summoning';
import {
  canBeSeized,
  canCallBackup,
  fracturedHeroes,
  orderStanding,
  warbandOf,
  fractureFootprint,
  isFeastSlash,
} from '@/systems/combat/eliteKits';
import { isImmuneToPush } from '@/systems/combat/passives';
import { canPrepare } from '@/systems/combat/preparedCast';
import { hasEffect, isHiddenFrom, meetsTargetRequirement } from '@/systems/combat/statusEffects';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { heroesOf } from '@/systems/combat/targetLegality';

/**
 * The store-writing half of the elites' signatures.
 *
 * `eliteKits` decides and measures; this puts it on the board. Shared by every
 * driver — the scene, the headless simulator, a harness — because the AI's executor
 * calls it, so an elite's signature raised in the app and one raised in a measured
 * fight are one rule.
 */

/**
 * Whatever an elite's own cast spends or sets up, once the cast has happened.
 *
 * The Berserker's feast spends its Rage when it is *announced*, not when it lands:
 * the swing is committed, the footprint is fixed, and the Rage it fed on starts
 * again from nothing while the party answers.
 */
export function afterEliteCast(caster: CombatUnit, skill: HeroSkill, fx: BossFx): void {
  if (isFeastSlash(skill)) {
    useCombatStore.getState().removeEffect(caster.id, AuraType.Rage);
    fx.log('  ' + t('bossLog.elite.feastSpent', { name: unitName(caster) }), '#ff5a3c');
  }
}

// ── what the AI makes of an elite's signature ────────────────────────────────

export interface EliteValue {
  skill: HeroSkill;
  targetPos: HexCoord;
  value: number;
}

/**
 * What an elite's signature skill is worth to its AI, or `undefined` when the skill
 * is an ordinary one and the generic scoring should run.
 *
 * The signatures strike nobody at the cast (a mark, a curse, a seed), so a score
 * built from expected damage would be zero and the elite would never use the thing
 * that makes it that elite. Each is scored on what it buys, and always above an
 * at-will swing when it is legal at all: it is on a cooldown, and its cooldown is
 * what limits it.
 */
export function eliteSkillValue(
  caster: CombatUnit,
  skill: HeroSkill,
  foes: CombatUnit[],
  allUnits: CombatUnit[],
): EliteValue | null | undefined {
  switch (skill.id) {
    case 'mind_control': {
      // The one who would hurt the party most if turned: the hardest hitter, then the
      // sturdiest. Never one already held, and never the last hero standing.
      const target = foes
        .filter(
          (f) =>
            canBeSeized(f, allUnits) &&
            !hasEffect(f, AfflictionType.MindControl) &&
            !isHiddenFrom(f, skill) &&
            meetsTargetRequirement(caster, f, skill) &&
            hexDistance(caster.position, f.position) <= skill.range,
        )
        .sort(
          (a, b) =>
            Math.max(b.stats.attack, b.stats.magic) - Math.max(a.stats.attack, a.stats.magic) ||
            b.stats.maxHp - a.stats.maxHp ||
            (a.id < b.id ? -1 : 1),
        )[0];
      return target
        ? { skill, targetPos: target.position, value: ELITE_SIGNATURE_VALUE + Math.max(target.stats.attack, target.stats.magic) }
        : null;
    }
    case 'mire_undertow': {
      // The slam, scored as an ordinary Ground Slam is: what it does to those beside him.
      // The marsh is worth a bonus for each hero it would drag in from further out, which
      // is what makes it a reason to slam with the rest of the party at range two or three.
      const adjacent = foes.filter((f) => hexDistance(caster.position, f.position) <= 1);
      const slam = adjacent.reduce((n, f) => n + expectedDamage(caster, f, skill, 'front', allUnits), 0);
      // The slam has to strike somebody for the cast to happen at all: the resolver
      // refuses a ring that hits nobody, and the marsh is laid only after a cast that
      // went off. Scored on the drag alone, a party standing two or three hexes off
      // made him "cast" into a refusal and spend his turn standing still (PT-14).
      // With nobody beside him he walks in; the marsh drags the rest next turn.
      if (slam <= 0) return null;
      const dragged = canPrepare(caster.id)
        ? foes.filter(
            (f) =>
              !f.objective &&
              hexDistance(caster.position, f.position) > 1 &&
              hexDistance(caster.position, f.position) <= BALANCE.MIRE_RADIUS &&
              !isImmuneToPush(f),
          ).length
        : 0;
      const value = slam + dragged * MIRE_VALUE_PER_HERO;
      return value > 0 ? { skill, targetPos: caster.position, value } : null;
    }
    case 'fracture_slam': {
      // With the party Fractured the slam covers the ground round every marked hero too
      const marked = canPrepare(caster.id) ? fracturedHeroes(allUnits) : [];
      const footprint = new Set(
        (marked.length > 0
          ? fractureFootprint(caster.position, marked.map((h) => h.position))
          : fractureFootprint(caster.position, [])
        ).map(hexKey),
      );
      const struck = foes.filter((f) => !f.objective && footprint.has(hexKey(f.position)));
      const value =
        struck.reduce((n, f) => n + expectedDamage(caster, f, skill, 'front', allUnits), 0) +
        marked.length * FRACTURE_VALUE_PER_MARK;
      return value > 0 ? { skill, targetPos: caster.position, value } : null;
    }
    case 'warband_order': {
      // One order at a time, and worth giving only if something will answer it: an Orc
      // standing, or room to call a Grunt (the order is then the call). No room and nobody
      // standing, and the Warchief swings at the party instead.
      if (orderStanding(caster, allUnits)) return null;
      if (
        warbandOf(caster, allUnits).length === 0 &&
        (!canCallBackup(caster, allUnits) || findSummonHexes(caster.position, 1, allUnits).length === 0)
      ) {
        return null;
      }
      // The hero the warband can reach soonest: nearest to the Warchief, then the most hurt
      const target = foes
        .filter(
          (f) =>
            heroesOf(allUnits).some((h) => h.id === f.id) &&
            !isHiddenFrom(f, skill) &&
            meetsTargetRequirement(caster, f, skill) &&
            hexDistance(caster.position, f.position) <= skill.range,
        )
        .sort(
          (a, b) =>
            hexDistance(caster.position, a.position) - hexDistance(caster.position, b.position) ||
            a.currentHp - b.currentHp ||
            (a.id < b.id ? -1 : 1),
        )[0];
      return target
        ? { skill, targetPos: target.position, value: ELITE_SIGNATURE_VALUE + 10 * warbandOf(caster, allUnits).length }
        : null;
    }
    case 'witchs_geas': {
      // Wasted on a hero already carrying one, or with a warning of hers still open to answer it
      if (!canPrepare(caster.id) || heroesOf(allUnits).some((h) => hasEffect(h, AfflictionType.Geas))) {
        return null;
      }
      // The hero with the deepest well of spells: the one the curse will meet most often
      const target = foes
        .filter(
          (f) =>
            heroesOf(allUnits).some((h) => h.id === f.id) &&
            !isHiddenFrom(f, skill) &&
            meetsTargetRequirement(caster, f, skill) &&
            hexDistance(caster.position, f.position) <= skill.range,
        )
        .sort(
          (a, b) =>
            b.stats.maxMana - a.stats.maxMana ||
            b.stats.magic - a.stats.magic ||
            (a.id < b.id ? -1 : 1),
        )[0];
      return target
        ? { skill, targetPos: target.position, value: ELITE_SIGNATURE_VALUE + target.stats.maxMana / 10 }
        : null;
    }
    default:
      return undefined;
  }
}

/** What each hero the marsh would drag in, and each Fracture a slam would detonate, is worth to the AI. */
const MIRE_VALUE_PER_HERO = 14;
const FRACTURE_VALUE_PER_MARK = 12;

/** Above any at-will swing and below a sure kill: the signatures are what these units are for. */
export const ELITE_SIGNATURE_VALUE = 60;
