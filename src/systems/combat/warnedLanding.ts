import { skillName } from '@/data/gameText';
import { unitName } from '@/data/templates/unitText';
import { formatPercent, t } from '@/i18n';
import type { CombatUnit, HeroSkill, HexCoord, PreparedAttack } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { classifyBroken, classifyLanding, moveIdOf } from '@/systems/combat/answerTally';
import type { Landing } from '@/systems/combat/encounterScript';
import { retireLinkedObjectives } from '@/systems/combat/objectiveBoard';
import { LandingPlan, landingPlan, opposedBy, previewPrepared, unitsOnHexes } from '@/systems/combat/preparedAttacks';
import { scriptLand, scriptsAfterLanding, scriptsWhiff, scriptStriker } from '@/systems/combat/scriptRegistry';
import { CombatSink, resolveSkillUse } from '@/systems/combat/skillResolution';
import { unitById } from '@/systems/combat/unitLookup';

/**
 * A warned attack landing, every blow of it.
 *
 * `landWarning` is the whole of it, in this order:
 *
 * 1. **Hold.** The plan (`landingPlan`, read through `previewPrepared` so the braced bodies come
 *    from the same trace) is fixed as the board stands, before anything is retired or struck, so
 *    a body that dies half way through cannot change who the rest of it was shared with. The
 *    heroes owed an answer are read here too, so a hero the landing kills is still counted.
 * 2. **Strike.** The warning is taken off the board, whatever rode on it is retired, and either a
 *    script lands it whole (`EncounterScript.land`, handed the `Landing`) or the ordinary strike
 *    runs from wherever the scripts say the striker stands (`beforeLanding`).
 * 3. **Every further blow** goes through the same `Landing` — a spire's blast, Skyfire's landing
 *    blow, a chain's settlement, a bite — and each adds who it reached to one set: who the landing
 *    actually struck.
 * 4. **Count.** The answer tally is classified from that set (`classifyLanding`), so a hero the
 *    footprint covered but no blow reached is `unharmed`, and one only a second blow reached `took` it.
 * 5. **After, and the whiff.** `afterLanding` runs, handed the preview the landing held (the Troll
 *    breaks the heaps the braced heroes leaned on); a landing that struck nobody fires the warning's
 *    whiff hook (`PreparedSpec.onWhiff`) once.
 *
 * The plan travels in the `Landing` itself, so there is nothing to release when a landing ends,
 * however it ends. It sits beside the resolver because it must call it.
 */

/** A blocked blow carries nothing but its damage: the push and the afflictions are dropped. */
function withoutRiders(skill: HeroSkill): HeroSkill {
  const { pushDistance: _push, appliesEffect: _effects, collisionEffect: _slam, ...rest } = skill;
  return rest;
}

/** Lands `attack` from `caster`, every blow of it, and counts how it was answered. */
export function landWarning(attack: PreparedAttack, caster: CombatUnit, sink: CombatSink): void {
  const store = useCombatStore.getState();
  // Who the landing will strike, fixed before anything is retired or hit
  const board = store.units;
  const held = previewPrepared(attack, board, store.hazards);
  const landing = openLanding(attack, held.plan);

  store.removePreparedAttack(attack.id);
  // The strike is on its way; whatever was built to ride on the warning goes
  // with it (a Furnace Heart detonates and is spent).
  retireLinkedObjectives(attack.id);
  sink.log(t('combatLog.log.preparedLands', { name: unitName(caster), skill: skillName(attack.skill) }), '#ffaa44');
  // A scripted warning lands its own way (a chain settles on the people it links, a
  // rift or an eruption is drawn by its script); the rest is the ordinary resolver,
  // run from wherever the scripts say the striker stands
  if (!scriptLand(landing, caster, sink)) {
    // Farthest Prey is a leap: he comes down in the marked ground, and the blow
    // lands from there. Its knock-up is drawn on whoever it strikes and changes
    // nothing about where they stand or when they act.
    // The Burrowmother comes up in the footprint and the Colossus's tomb gives way, and the blow
    // is made from there
    const striker = scriptStriker(attack, caster, sink);
    const thrown: CombatSink =
      attack.scripted === 'prey' || attack.scripted === 'undermine'
        ? { ...sink, vfx: (spec) => sink.vfx({ ...spec, knockUpIds: spec.hitUnitIds }) }
        : sink;
    // Its numbers wait for its picture, as any cast's do
    sink.lands?.(attack.skill, striker.position, attack.aim);
    landing.strike(striker, thrown);
  }

  // How the heroes it threatened answered it, from who it actually struck
  const struckIds = [...landing.struck];
  useCombatStore.getState().noteAnswers(
    moveIdOf(attack),
    landing.wasBroken
      ? classifyBroken(attack, board)
      : classifyLanding(attack, board, { struckIds, blockerId: held.plan.blockerId, braced: held.braced, holders: held.plan.holders }),
  );
  scriptsAfterLanding(attack, caster, sink, held);
  // A landing that struck nobody fires the warning's whiff hook, once
  if (attack.spec.onWhiff && struckIds.length === 0) scriptsWhiff(attack, caster, sink);
  sink.warningLanded?.(attack, board);
}

/** The `Landing` a script is handed, and what it has gathered for the count. */
interface OpenLanding extends Landing {
  /** Every body any blow of this landing reached, by id, in the order they were reached. */
  readonly struck: Set<string>;
  readonly wasBroken: boolean;
}

function openLanding(attack: PreparedAttack, plan: LandingPlan): OpenLanding {
  const struck = new Set<string>();
  let wasBroken = false;
  /** Counts the bodies among `units` the warning lands on. */
  const count = (units: readonly CombatUnit[]) => {
    const opposing = opposedBy(attack, useCombatStore.getState().units);
    for (const u of units) if (u.currentHp > 0 && opposing(u)) struck.add(u.id);
  };

  return {
    attack,
    struck,
    get wasBroken() {
      return wasBroken;
    },

    strike(striker, sink, over = {}) {
      const store = useCombatStore.getState();
      // A different area of the same warning has different bodies in it, so it gets its own plan
      const blow = over.hexes ? landingPlan(attack, store.units, store.hazards, over.hexes) : plan;
      for (const id of blow.struckIds) struck.add(id);
      strikeByPlan(striker, attack, blow, sink, over);
    },

    blow(striker, skill, aim, sink, hexes) {
      count(unitsOnHexes(hexes, useCombatStore.getState().units));
      resolveSkillUse(striker, skill, aim, sink, { resolving: true, fixedHexes: hexes });
    },

    hit(unitIds) {
      count(useCombatStore.getState().units.filter((u) => unitIds.includes(u.id)));
    },

    broken() {
      wasBroken = true;
    },
  };
}

/**
 * One blow over ground by `plan`: the authored rules of the warning (`PreparedSpec.split`,
 * `blockedBy`, `shelter`) applied in one place, from the plan the preview showed.
 */
function strikeByPlan(
  striker: CombatUnit,
  attack: PreparedAttack,
  plan: LandingPlan,
  sink: CombatSink,
  over: { skill?: HeroSkill; aim?: HexCoord; pushOrigin?: HexCoord | null },
): void {
  const store = useCombatStore.getState();
  const skill = over.skill ?? attack.skill;
  const pushOrigin = over.pushOrigin === undefined ? attack.origin : over.pushOrigin ?? undefined;

  if (plan.blocked && plan.blockerId) {
    const blocker = unitById(store.units, plan.blockerId);
    if (blocker) {
      sink.log(`  ${t('combatLog.log.blocked', { blocker: unitName(blocker), skill: skillName(attack.skill) })}`, '#9ad0ff');
    }
  } else if (plan.sheltered.length > 0) {
    sink.log(`  ${t('combatLog.log.sheltered', { count: plan.sheltered.length })}`, '#9ad0ff');
  }
  // Each hero who held their hex behind a shield (a crown point) is named
  for (const id of plan.holders ?? []) {
    const holder = unitById(store.units, id);
    if (holder) sink.log(`  ${t('combatLog.log.held', { name: unitName(holder), skill: skillName(attack.skill), share: formatPercent(attack.spec.heldBy?.share ?? 1) })}`, '#9ad0ff');
  }

  resolveSkillUse(striker, plan.blocked ? withoutRiders(skill) : skill, over.aim ?? attack.aim, sink, {
    resolving: true,
    landing: true,
    fixedHexes: plan.hexes,
    ...(pushOrigin && { pushOrigin }),
    ...(Object.keys(plan.shares).length > 0 && { shares: plan.shares }),
  });

  // The caster pays for being stopped: a status for the round (a blocked Cleave leaves him Exposed)
  const cost = plan.blocked ? attack.spec.blockedBy?.casterStatus : undefined;
  if (cost) {
    const live = unitById(useCombatStore.getState().units, attack.casterId);
    if (live && live.currentHp > 0) {
      useCombatStore.getState().applyEffect(live.id, {
        type: cost.type, magnitude: cost.magnitude, duration: cost.duration, sourceUnitId: live.id,
      });
    }
  }
}
