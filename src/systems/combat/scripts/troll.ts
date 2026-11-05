import { HexCoord } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { preparedBy } from '@/systems/combat/preparedAttacks';
import { activeTaunt } from '@/systems/combat/taunt';
import { chooseTrollMove, isCoveredFrom, isTroll, isTrollScriptedSkill, TrollMove, trollMoveOfSkill } from '@/systems/combat/trollScript';
import { afterTrollLanding, beforeTrollLanding, beginTrollTurn, castTrollMove, strikeSweep } from '@/systems/combat/trollActions';
import type { AIAction } from '@/systems/combat/aiTypes';
import type { EncounterScript } from '@/systems/combat/encounterScript';
import { settleRotationCast } from '@/systems/combat/scripts/rotationCast';
import { skillName } from '@/data/gameText';

/**
 * The Troll Chieftain.
 *
 * The move his six-turn cycle is at, made as well as the board allows. The sweep
 * and the smash are aimed by the ordinary scoring, restricted to that one skill, so
 * the club still falls where it catches the most of the party; the leap has a
 * footprint of its own (`isTrollScriptedSkill`) and is handed to `castTrollMove`, and
 * the roof is cast by the Smash's landing, never from a slot. **A move that cannot be
 * made does not use up its slot**: with nobody inside the smash's reach he sweeps what
 * he can, or walks, and the smash is still next. The Sweep goes toward the hero it
 * would hurt most — a hero a heap of rubble shields is worth nothing to it while
 * someone it would hurt is in reach — and is struck through the fort (`strikeSweep`):
 * the heroes a heap shields are spared and every heap in the arc breaks. Taunt changes
 * where the sweep goes and nothing else.
 *
 * In Fury a turn carries a second action, and it is always the Sweep, and it never
 * advances the cycle (`furyExtra` in the store marks that turn).
 */
export const trollScript: EncounterScript = {
  id: 'troll',

  decide(ctx) {
    const { enemy, foes, allUnits, trace } = ctx;
    if (!isTroll(enemy)) return null;
    const store = useCombatStore.getState();
    const taunter = activeTaunt(enemy, allUnits);
    const skillFor = (move: TrollMove) => enemy.skills.find((s) => trollMoveOfSkill(s) === move);

    const sweep = (step?: number): AIAction | null => {
      const skill = skillFor('sweep');
      if (!skill) return null;
      // The hero the arc would hurt most: one a heap shields takes nothing, so is aimed at only
      // when nobody else is in reach (and then the heap takes the club)
      const exposed = foes.filter((f) => !isCoveredFrom(enemy, f, store.hazards));
      const aimed = taunter
        ? ctx.aim([skill], [taunter])
        : (exposed.length > 0 ? ctx.aim([skill], exposed) : null) ?? ctx.aim([skill], foes);
      return aimed
        ? { type: 'skill', skill, skillTarget: aimed.targetPos, ...(step !== undefined && { bossStep: step }) }
        : null;
    };
    const advance = (): AIAction[] => {
      const moveTarget: HexCoord | null = ctx.approach(taunter ? [taunter] : foes);
      trace(moveTarget ? 'no skill in reach — advances' : 'no skill in reach — holds ground'); // i18n-exempt: AI trace, shown only on the dev sim panel
      return moveTarget
        ? [{ type: 'move', targetPos: moveTarget }, { type: 'endturn' }]
        : [{ type: 'endturn' }];
    };

    // Fury's second action: the Sweep, and the cycle stays where it is
    if (store.furyExtra.active && store.currentUnitId === enemy.id) {
      const action = sweep();
      if (action?.skill) {
        trace(`${skillName(action.skill)} (Fury)`, { choseSkillId: action.skill.id }); // i18n-exempt: AI trace, shown only on the dev sim panel
        return [action];
      }
      return advance();
    }

    const chosen = chooseTrollMove({
      boss: enemy,
      units: allUnits,
      majorPending: preparedBy(enemy.id, store.preparedAttacks).length > 0,
    });

    const attempt = (move: TrollMove): AIAction | null => {
      const skill = skillFor(move);
      if (!skill) return null;
      const advancing = move === chosen.move ? chosen.nextStep : undefined;
      if (isTrollScriptedSkill(skill)) {
        return { type: 'skill', skill, skillTarget: enemy.position, bossStep: advancing };
      }
      if (move === 'sweep') return sweep(advancing);
      // The smash: aimed by the ordinary scoring, so it is only made with a hero in reach
      const aimed = ctx.aim([skill], foes);
      return aimed
        ? { type: 'skill', skill, skillTarget: aimed.targetPos, bossStep: advancing }
        : null;
    };

    const action = attempt(chosen.move) ?? sweep();
    if (action?.skill) {
      trace(`${skillName(action.skill)} (scripted)`, { choseSkillId: action.skill.id }); // i18n-exempt: AI trace, shown only on the dev sim panel
      return [action];
    }
    return advance();
  },

  cast({ caster, skill, target, bossStep, sink }) {
    if (!isTroll(caster)) return false;
    // The club through the fort: the heroes a heap shields are spared, and the heaps in the arc break
    if (trollMoveOfSkill(skill) === 'sweep') {
      if (strikeSweep(caster, skill, target, sink)) settleRotationCast(caster, bossStep);
      return true;
    }
    // The leap and the roof: footprints the Troll's script builds
    if (!isTrollScriptedSkill(skill)) return false;
    if (castTrollMove(caster, skill, sink).ok) settleRotationCast(caster, bossStep);
    return true;
  },

  beginTurn: (unit, sink) => beginTrollTurn(unit.id, sink),
  beforeLanding: (attack, striker, sink) => beforeTrollLanding(attack, striker, sink),
  afterLanding: (attack, caster, sink, held) => afterTrollLanding(attack, caster, sink, held),
};
