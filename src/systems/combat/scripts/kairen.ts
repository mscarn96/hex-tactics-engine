import { useCombatStore } from '@/stores/combatStore';
import { preparedBy } from '@/systems/combat/preparedAttacks';
import { activeTaunt } from '@/systems/combat/taunt';
import {
  broodOfTheOrb, cloudDive, coilLash, galeDowndraft, jadeOrbBolt, orbBolt, orbNova, verdantJudgement,
} from '@/data/templates/kairen';
import { BALANCE } from '@/data/balanceConstants';
import {
  canBrood, chooseKairenMove, isAloft, isKairen, KairenMove, kairenMemory, MAJOR_WARNINGS, orbBoltCount, orbBoltTarget, tierOf,
} from '@/systems/combat/kairenRules';
import { beginKairenTurn, castKairenMove, castOrbBolt, kairenCastIntent, landKairenWarning, syncKairenBoard } from '@/systems/combat/kairenActions';
import { hexDistance } from '@/utils/hexUtils';
import type { HeroSkill } from '@/models/types';
import type { AIAction } from '@/systems/combat/aiTypes';
import type { EncounterScript } from '@/systems/combat/encounterScript';
import { skillName } from '@/data/gameText';

/**
 * Jadeveil: Kairen, the Cloud-Crowned Dragon.
 *
 * His warned moves come by rule (`chooseKairenMove`): each phase's own, on its first
 * turn and its gap, one at a time; between them the Coil Lash for a hero beside his
 * head and the Orb Bolt for the hero carrying the least Taint (from tier 2, the next
 * least tainted too). **Taunt changes where his lash and first bolt go and nothing
 * else.** The storm, the weather and the brood on entering
 * the Thunderhead are his weather, kept between turns and at his turn start
 * (`kairenActions`); they never spend his action.
 */

const MOVE_SKILL: Record<Exclude<KairenMove, 'attack'>, HeroSkill> = {
  gale: galeDowndraft,
  dive: cloudDive,
  verdant: verdantJudgement,
  nova: orbNova,
  brood: broodOfTheOrb,
};
const SKILL_MOVE: Record<string, Exclude<KairenMove, 'attack'>> = Object.fromEntries(
  Object.entries(MOVE_SKILL).map(([move, skill]) => [skill.id, move as Exclude<KairenMove, 'attack'>]),
);

export const kairenScript: EncounterScript = {
  id: 'kairen',

  decide(ctx) {
    const { enemy, foes, allUnits, trace } = ctx;
    if (!isKairen(enemy)) return null;
    // Up in the clouds there is nothing to do but wait for the line to come due
    if (isAloft(enemy)) {
      trace('in the clouds — waits on the dive'); // i18n-exempt: AI trace, shown only on the dev sim panel
      return [{ type: 'endturn' }];
    }
    const store = useCombatStore.getState();
    const memory = kairenMemory(enemy);
    const phase = enemy.bossPhase ?? 0;
    const move = chooseKairenMove({
      phase,
      tier: tierOf(enemy),
      phaseTurns: enemy.bossScript?.phaseTurns ?? 0,
      memory,
      majorOpen: preparedBy(enemy.id, store.preparedAttacks).some((p) => p.scripted !== undefined && MAJOR_WARNINGS.has(p.scripted)),
      broodReady: canBrood(memory, allUnits),
    });
    if (move !== 'attack') {
      const skill = MOVE_SKILL[move];
      trace(`${skillName(skill)} (scripted)`, { choseSkillId: skill.id }); // i18n-exempt: AI trace, shown only on the dev sim panel
      return [{ type: 'skill', skill, skillTarget: enemy.position }];
    }

    const taunter = activeTaunt(enemy, allUnits);
    const against = taunter ? [taunter] : foes;
    const beside = against.filter((u) => hexDistance(u.position, enemy.position) === 1);
    if (beside.length > 0) {
      const lash = ctx.aim([coilLash], beside);
      if (lash) {
        trace('Coil Lash (scripted)', { choseSkillId: coilLash.id }); // i18n-exempt: AI trace, shown only on the dev sim panel
        return [{ type: 'skill', skill: coilLash, skillTarget: lash.targetPos }];
      }
    }
    const bolt = phase >= 2 ? jadeOrbBolt : orbBolt;
    const target = orbBoltTarget(enemy, against, BALANCE.KAIREN.ORB_BOLT_RANGE);
    if (target) {
      trace(`${skillName(bolt)} at ${target.name} (scripted)`, { choseSkillId: bolt.id }); // i18n-exempt: AI trace, shown only on the dev sim panel
      return [{ type: 'skill', skill: bolt, skillTarget: target.position }];
    }
    const step = ctx.approach(against);
    trace(step ? 'nothing in reach — closes in' : 'nothing in reach — holds'); // i18n-exempt: AI trace, shown only on the dev sim panel
    return step ? [{ type: 'move', targetPos: step } as AIAction, { type: 'endturn' }] : [{ type: 'endturn' }];
  },

  cast({ caster, skill, target, sink }) {
    if (!isKairen(caster)) return false;
    // Tier 2's twist: one bolt at two heroes. In the story fight it is an ordinary cast
    if ((skill.id === orbBolt.id || skill.id === jadeOrbBolt.id) && orbBoltCount(tierOf(caster)) > 1) {
      if (castOrbBolt(caster, skill, target, sink)) useCombatStore.getState().markActed(caster.id);
      return true;
    }
    const move = SKILL_MOVE[skill.id];
    if (!move) return false;
    if (castKairenMove(caster, move, sink)) {
      sink.sound?.(kairenCastIntent(caster, skill));
      useCombatStore.getState().markActed(caster.id);
    }
    return true;
  },

  betweenTurns: (sink) => syncKairenBoard(sink),
  beginTurn: (unit, sink) => beginKairenTurn(unit.id, sink),
  land: (landing, caster, sink) => landKairenWarning(landing, caster, sink),
};
