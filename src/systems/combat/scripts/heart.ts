import { useCombatStore } from '@/stores/combatStore';
import { canUseSkill } from '@/systems/combat/cooldowns';
import { preparedBy } from '@/systems/combat/preparedAttacks';
import { activeTaunt } from '@/systems/combat/taunt';
import {
  chooseHeartMove, convergencePlan, HEART_RECHAINED_FIRST_TURN, HEART_RECHAINED_PHASE, HeartMove, HeartOffer,
  heartMoveOfSkill, isHeart, isHeartScriptedSkill, reprisalPlan, winterHexes,
} from '@/systems/combat/heartScript';
import { beginHeartTurn, castHeartMove } from '@/systems/combat/heartActions';
import { landHeartWarning, strikePulse } from '@/systems/combat/heartLanding';
import type { AIAction } from '@/systems/combat/aiTypes';
import type { EncounterScript } from '@/systems/combat/encounterScript';
import { skillName } from '@/data/gameText';

/**
 * The Heart of Winter.
 *
 * The move the board offers it the most, made as well as it allows. No fixed rhythm
 * (`chooseHeartMove`): each warned spell is on offer only off its cooldown and only
 * when the board gives it something to do, and none while one of its warnings is
 * open. The Pulse is what it does otherwise, aimed by the ordinary scoring. **Taunt
 * changes where its Pulse goes and nothing else.** It is chained and never walks: with
 * nothing in reach it waits.
 */
export const heartScript: EncounterScript = {
  id: 'heart',

  decide(ctx) {
    const { enemy, foes, allUnits, trace } = ctx;
    if (!isHeart(enemy)) return null;
    const store = useCombatStore.getState();
    const taunter = activeTaunt(enemy, allUnits);
    const majorPending = preparedBy(enemy.id, store.preparedAttacks).length > 0;
    const skillFor = (move: HeartMove) => enemy.skills.find((s) => heartMoveOfSkill(s) === move);
    const ready = (move: HeartMove) => {
      const skill = skillFor(move);
      return skill !== undefined && canUseSkill(enemy, skill) ? skill : undefined;
    };

    const pulseSkill = ready('pulse');
    const pulse = pulseSkill ? ctx.aim([pulseSkill], taunter ? [taunter] : foes) : null;
    const winterSkill = majorPending ? undefined : ready('winter');
    const winter = winterSkill ? winterHexes(enemy, allUnits, store.hazards) : [];
    const reprisalSkill = majorPending ? undefined : ready('reprisal');
    const reprisal = reprisalSkill ? reprisalPlan(enemy, allUnits) : null;
    const convergenceSkill = majorPending ? undefined : ready('convergence');
    const convergence = convergenceSkill ? convergencePlan(enemy, allUnits, store.hazards) : null;

    const none: HeartOffer = { available: false, value: 0 };
    const chosen = chooseHeartMove({
      majorPending,
      turns: enemy.bossScript?.phaseTurns ?? 0,
      lastUsed: enemy.bossScript?.lastUsed ?? {},
      lastSignature: enemy.bossScript?.step ?? 0,
      offers: {
        pulse: pulse ? { available: true, value: 1 } : none,
        winter: winter.length > 0 ? { available: true, value: 1.8 } : none,
        reprisal: reprisal ? { available: true, value: reprisal.caught > 0 ? 2.6 : 1.6 } : none,
        convergence: convergence ? { available: true, value: convergence.caught > 0 ? 2.8 : 2 } : none,
      },
      // The tier-5 chain is short: its Reprisal comes on its second turn
      ...(enemy.bossPhase === HEART_RECHAINED_PHASE && { firstTurn: HEART_RECHAINED_FIRST_TURN }),
    });

    const attempt = (move: HeartMove): AIAction | null => {
      switch (move) {
        case 'pulse':
          return pulse && pulseSkill ? { type: 'skill', skill: pulseSkill, skillTarget: pulse.targetPos } : null;
        case 'winter':
          return winter.length > 0 && winterSkill ? { type: 'skill', skill: winterSkill, skillTarget: enemy.position } : null;
        case 'reprisal':
          return reprisal && reprisalSkill ? { type: 'skill', skill: reprisalSkill, skillTarget: enemy.position } : null;
        case 'convergence':
          return convergence && convergenceSkill
            ? { type: 'skill', skill: convergenceSkill, skillTarget: enemy.position }
            : null;
      }
    };

    const action = attempt(chosen) ?? attempt('pulse');
    if (action?.skill) {
      trace(`${skillName(action.skill)} (scripted)`, { choseSkillId: action.skill.id }); // i18n-exempt: AI trace, shown only on the dev sim panel
      return [action];
    }
    trace('nothing in reach — holds ground'); // i18n-exempt: AI trace, shown only on the dev sim panel
    return [{ type: 'endturn' }];
  },

  cast({ caster, skill, target, sink }) {
    if (!isHeart(caster)) return false;
    const store = useCombatStore.getState();
    // The Heart remembers what it made and when, for the same reason the Dragon does
    const move = heartMoveOfSkill(skill);
    if (move) {
      const script = caster.bossScript;
      const turns = script?.phaseTurns ?? 0;
      store.patchBossScript(caster.id, {
        lastUsed: { ...(script?.lastUsed ?? {}), [move]: turns },
        ...(move !== 'pulse' && { step: turns }),
      });
    }
    // The Pulse is made on the spot: no warning, two blows
    if (move === 'pulse') {
      strikePulse(caster, skill, target, sink);
      store.markActed(caster.id);
      return true;
    }
    // The chain, the ice and the spires: footprints the Heart's script builds
    if (isHeartScriptedSkill(skill)) {
      if (castHeartMove(caster, skill, sink).ok) store.markActed(caster.id);
      return true;
    }
    return false;
  },

  beginTurn: (unit, sink) => beginHeartTurn(unit.id, sink),
  land: (landing, caster, sink) => landHeartWarning(landing, caster, sink, sink),
};
