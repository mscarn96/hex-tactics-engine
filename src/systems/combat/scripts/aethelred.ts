import { AfflictionType, CombatUnit } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { hexDistance } from '@/utils/hexUtils';
import { canUseSkill } from '@/systems/combat/cooldowns';
import { preparedBy } from '@/systems/combat/preparedAttacks';
import { activeTaunt } from '@/systems/combat/taunt';
import { objectiveHexes } from '@/systems/combat/objectiveBoard';
import { hasEffect } from '@/systems/combat/statusEffects';
import { BossMove, chooseMove, foreclosureTargets, isScripted, isScriptedSkill, moveOfSkill, realmIsOwed } from '@/systems/combat/bossScript';
import {
  afterAethelredLanded, beginBossTurn, castScriptedMove, cleaveWhiffed, landScripted, resolveBossResponses, spendOrbOnCleave,
} from '@/systems/combat/bossActions';
import type { AIAction } from '@/systems/combat/aiTypes';
import type { EncounterScript } from '@/systems/combat/encounterScript';
import { settleRotationCast } from '@/systems/combat/scripts/rotationCast';
import { skillName } from '@/data/gameText';

/**
 * The Obsidian Emperor.
 *
 * A scripted boss's turn: the move its rotation reaches, made as well as the
 * board allows. The sword and the wedge are aimed by the ordinary scoring,
 * restricted to that one skill, so it still picks the target that catches the most
 * of the party. The banners and the writ are placed directly, because they strike
 * nobody and a damage score would never pick them. The moves with a footprint of
 * their own are handed to `castScriptedMove`. **Taunt changes where his basic sword
 * stroke goes and nothing else**: the wedge, the writ and every spell carry on as
 * if he were free. A taunt that forced him to the sword alone would let two heroes
 * hold him forever while the rest stood out of reach, which a playtest found within
 * a fight.
 */
export const aethelredScript: EncounterScript = {
  id: 'aethelred',

  decide(ctx) {
    const { enemy, foes, allUnits, trace } = ctx;
    if (!isScripted(enemy)) return null;
    const store = useCombatStore.getState();
    const taunter = activeTaunt(enemy, allUnits);
    const skillFor = (move: BossMove) => enemy.skills.find((s) => moveOfSkill(s) === move);
    const chosen = chooseMove({
      boss: enemy,
      units: allUnits,
      hazards: store.hazards,
      majorPending: preparedBy(enemy.id, store.preparedAttacks).length > 0,
      ready: (move) => {
        const skill = skillFor(move);
        if (!skill) return false;
        // The black sun his last throw called comes whatever its cooldown (tier 5)
        const cooled = move === 'realm' && realmIsOwed(enemy) ? { ...enemy, cooldowns: { ...enemy.cooldowns, [skill.id]: 0 } } : enemy;
        return canUseSkill(cooled, skill);
      },
    });

    const attempt = (move: BossMove): AIAction | null => {
      const skill = skillFor(move);
      if (!skill) return null;
      if (isScriptedSkill(skill)) {
        return { type: 'skill', skill, skillTarget: enemy.position, bossStep: chosen.nextStep };
      }
      if (move === 'standards') {
        return objectiveHexes(enemy, skill, enemy.position, allUnits).length > 0
          ? { type: 'skill', skill, skillTarget: enemy.position, bossStep: chosen.nextStep }
          : null;
      }
      if (move === 'writ') {
        const target = foreclosureTargets(enemy, allUnits, 99).find(
          (h) => !hasEffect(h, AfflictionType.Writ) && hexDistance(enemy.position, h.position) <= skill.range,
        );
        return target
          ? { type: 'skill', skill, skillTarget: target.position, bossStep: chosen.nextStep }
          : null;
      }
      // The sword and the wedge: aimed by the ordinary scoring, one skill only
      const aimed = ctx.aim([skill], taunter && move === 'blade' ? [taunter] : foes);
      return aimed
        ? { type: 'skill', skill, skillTarget: aimed.targetPos, bossStep: chosen.nextStep }
        : null;
    };

    const action = attempt(chosen.move) ?? attempt('blade');
    if (action?.skill) {
      trace(`${skillName(action.skill)} (scripted)`, { choseSkillId: action.skill.id }); // i18n-exempt: AI trace, shown only on the dev sim panel
      return [action];
    }

    // Nothing in reach: close the distance — the one thing he does without a skill
    const moveTarget = ctx.approach(taunter ? [taunter] : foes);
    trace(moveTarget ? 'no skill in reach — advances' : 'no skill in reach — holds ground'); // i18n-exempt: AI trace, shown only on the dev sim panel
    return moveTarget
      ? [{ type: 'move', targetPos: moveTarget }, { type: 'endturn' }]
      : [{ type: 'endturn' }];
  },

  cast({ caster, skill, bossStep, sink }) {
    if (!isScriptedSkill(skill)) return false;
    if (castScriptedMove(caster, skill, sink).ok) settleRotationCast(caster, bossStep);
    return true;
  },

  betweenTurns: (sink) => resolveBossResponses(sink),
  beginTurn: (unit: CombatUnit, sink) => beginBossTurn(unit.id, sink),
  land: (landing, caster, sink) => landScripted(landing, caster, sink),
  afterLanding: (attack, caster, sink) => afterAethelredLanded(attack, caster, sink),
  whiff: (attack, caster, sink) => cleaveWhiffed(attack, caster, sink),
  /** A Cleave raised with charges on the orb spends them on the floor beside its wedge, as every orb warning does. */
  afterCast(caster, skill, kind, sink) {
    if (kind === 'prepare' && isScripted(caster) && moveOfSkill(skill) === 'cleave') spendOrbOnCleave(caster, sink);
  },
};
