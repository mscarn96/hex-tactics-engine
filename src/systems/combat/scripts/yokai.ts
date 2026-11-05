import { HexCoord } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { canPrepare } from '@/systems/combat/preparedCast';
import { activeTaunt } from '@/systems/combat/taunt';
import { launchIntent, strikeDelivery } from '@/systems/combat/soundIntents';
import { beginNueTurn, castWebVolley, climbBack, cloakNue, landBite, releaseStrandedWebs } from '@/systems/combat/yokaiActions';
import { canVolley, freeHeroes, isHanging, isJorogumo, isNue, jorogumoMemory, nextSlot, slotIndex, venomTarget } from '@/systems/combat/yokaiKits';
import { canUseSkill } from '@/systems/combat/cooldowns';
import type { AIAction } from '@/systems/combat/aiTypes';
import type { EncounterScript } from '@/systems/combat/encounterScript';
import { skillName } from '@/data/gameText';

/**
 * The Yokai's scripted two (`yokaiKits` has the rules): the Nue, the roaming elite, whose
 * turn start is its thundercloud and tail and whose Black Thunder hides it; and the
 * Jorōgumo, the Silk Hollow's boss.
 *
 * On her threads she never walks: Canopy Venom is her attack from above, and the bite drops
 * her onto the webbed hero and leaves her to climb back up between turns. Dragged down, she
 * fights as below.
 *
 * Her turns run web → bite-or-attack → attack. A web turn casts the volley when it can;
 * one that cannot (nobody in reach, a warning still standing, a Taunt on her) keeps the
 * slot and she fights or closes instead. The bite is the warning landing from her turn
 * start; when every web was cut it never lands and the turn is an ordinary attack. From the
 * canopy her attack is Canopy Venom on the hero farthest from every standing thread
 * (`venomTarget`); on the ground her attacks are the ordinary scoring, restricted to her fangs
 * and her snare.
 */
export const yokaiScript: EncounterScript = {
  id: 'yokai',

  decide(ctx) {
    const { enemy, foes, allUnits, trace } = ctx;
    if (!isJorogumo(enemy)) return null;
    const taunter = activeTaunt(enemy, allUnits);
    const web = enemy.skills.find((s) => s.id === 'jorogumo_web');

    if (web && !taunter && jorogumoMemory(enemy).slot === 'web' && canPrepare(enemy.id) && canVolley(enemy, allUnits)) {
      trace(`${skillName(web)} (scripted)`, { choseSkillId: web.id }); // i18n-exempt: AI trace, shown only on the dev sim panel
      return [{ type: 'skill', skill: web, skillTarget: enemy.position }];
    }

    // Canopy Venom seeks the hero farthest from every standing thread; a Taunt still turns it
    const venom = enemy.skills.find((s) => s.id === 'canopy_venom');
    const marked = venom && !taunter && canUseSkill(enemy, venom) ? venomTarget(enemy, allUnits, venom) : null;
    if (venom && marked) {
      trace(`${skillName(venom)} (farthest from the threads)`, { choseSkillId: venom.id }); // i18n-exempt: AI trace, shown only on the dev sim panel
      return [{ type: 'skill', skill: venom, skillTarget: marked.position }];
    }

    const attacks = enemy.skills.filter((s) => s.id !== 'jorogumo_web');
    const aimed = ctx.aim(attacks, taunter ? [taunter] : foes);
    if (aimed) {
      trace(`${skillName(aimed.skill)} (${aimed.value.toFixed(1)})`, { choseSkillId: aimed.skill.id }); // i18n-exempt: AI trace, shown only on the dev sim panel
      return [{ type: 'skill', skill: aimed.skill, skillTarget: aimed.targetPos }];
    }
    // On her threads she never walks: with nothing to strike from the canopy she waits
    if (isHanging(enemy)) {
      trace('hanging — nothing in reach'); // i18n-exempt: AI trace, shown only on the dev sim panel
      return [{ type: 'endturn' }];
    }
    // Close on whoever can still be reached: a webbed hero is out of the fight until bitten
    const free = foes.filter((f) => freeHeroes(allUnits).some((h) => h.id === f.id));
    const moveTarget: HexCoord | null = ctx.approach(taunter ? [taunter] : free.length > 0 ? free : foes);
    trace(moveTarget ? 'no skill in reach — advances' : 'no skill in reach — holds ground'); // i18n-exempt: AI trace, shown only on the dev sim panel
    const actions: AIAction[] = moveTarget ? [{ type: 'move', targetPos: moveTarget }] : [];
    return [...actions, { type: 'endturn' }];
  },

  cast({ caster, skill, sink }) {
    if (skill.id !== 'jorogumo_web') return false;
    if (castWebVolley(caster, sink).ok) {
      sink.sound?.(launchIntent(caster, skill, strikeDelivery(skill, caster)));
      useCombatStore.getState().markActed(caster.id);
    }
    return true;
  },

  /**
   * Her turn takes its place in the cycle before the bite can land from it. The Nue's
   * turn start is its thundercloud and its tail.
   */
  beginTurn(unit, sink) {
    if (isNue(unit)) {
      beginNueTurn(unit, sink);
      return;
    }
    if (!isJorogumo(unit)) return;
    const memory = jorogumoMemory(unit);
    useCombatStore.getState().patchBossScript(unit.id, { step: slotIndex(nextSlot(memory)) });
  },

  land(landing, caster, sink) {
    if (landing.attack.scripted !== 'web') return false;
    landBite(landing, caster, sink);
    return true;
  },

  /** Black Thunder struck: the Nue's cloud closes over it. */
  afterCast(caster, skill, kind, sink) {
    if (kind === 'strike' && isNue(caster) && skill.id === 'nue_black_thunder') cloakNue(caster, sink);
  },

  betweenTurns(sink) {
    // The canopy weaver back up her silk after a bite, then any web left with nobody to answer it
    climbBack(sink);
    releaseStrandedWebs(sink);
  },
};
