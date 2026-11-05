import { skillName } from '@/data/gameText';
import { canAim } from '@/systems/combat/targetLegality';
import { resolveSkillUse } from '@/systems/combat/skillResolution';
import { scriptCast, scriptDecide, scriptsAfterCast } from '@/systems/combat/scriptRegistry';
import { withDice } from '@/systems/combat/dice';
import { CombatSink, SILENT_SINK } from '@/systems/combat/combatSink';
import { rampartBlocksShot } from '@/systems/combat/ramparts';
import { AfflictionType, CombatUnit, HeroSkill, SkillTargetType, HexCoord } from '@/models/types';
import { hexDistance } from '@/utils/hexUtils';
import { findMovePath, getMovementRange } from '@/systems/combat/movement';
import { getValidSkillTargetHexes, getSkillTargets, isAoESkill } from '@/systems/combat/targeting';
import { selfMoveBlocked } from '@/systems/combat/forcedMovement';
import { calculateHealing, calculateLifesteal, expectedDamage } from '@/systems/combat/damageCalc';
import { useCombatStore } from '@/stores/combatStore';
import { findSummonHexes } from '@/systems/combat/summoning';
import { findSummonTemplate } from '@/data/templates/summonTemplates';
import { canUseSkill } from '@/systems/combat/cooldowns';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { fallbackBasicAttack } from '@/systems/combat/enemyBasicAttack';
import { canPrepare } from '@/systems/combat/preparedCast';
import { eliteSkillsFor, warbandTargetFor } from '@/systems/combat/eliteKits';
import { eliteSkillValue } from '@/systems/combat/eliteActions';
import { factionEliteSkillValue } from '@/systems/combat/factionEliteActions';
import { draconicHostSkillValue } from '@/systems/combat/draconicHostAI';
import { fallenOrderSkillValue } from '@/systems/combat/fallenOrderKits';
import { planTwinRaid } from '@/systems/combat/factionEliteKits';
import { duelBars } from '@/systems/combat/duelRules';
import { canPrepareReaction } from '@/systems/combat/reactions';
import { objectiveHexes, standingObjectives } from '@/systems/combat/objectiveBoard';
import { activeTaunt } from '@/systems/combat/taunt';
import { hasEffect, isActionLocked, isAffliction, isSilenced, skillEffects, skillVariantFor } from '@/systems/combat/statusEffects';
import { BALANCE } from '@/data/balanceConstants';
import { applyOnMove } from '@/systems/combat/combatEvents';
import { unitById } from '@/systems/combat/unitLookup';
import { moveIntent, walkIntent } from '@/systems/combat/soundIntents';
import { behindLineFloor, keepsBehindLine, lineIsMarching } from '@/systems/combat/formation';

import type { AIAction, AIConsideration, AITrace, SkillResult } from '@/systems/combat/aiTypes';
export type { AIAction, AIConsideration, AITrace };

export function decideEnemyAction(
  enemy: CombatUnit,
  allUnits: CombatUnit[],
  onTrace?: (trace: AITrace) => void
): AIAction[] {
  const considered: AIConsideration[] = onTrace ? [] : undefined!;
  const trace = (chose: string, over: Partial<AITrace> = {}) =>
    onTrace?.({ unitId: enemy.id, unitName: enemy.name, considered: considered ?? [], chose, ...over });
  // Relative to the actor, not to "the player". For an enemy this is exactly
  // what it always was, since `enemy.isPlayer` is false — but stated this way
  // the same brain drives a hero, which is what lets the tuning harness run a
  // whole fight without a human in it.
  // An elite may choose among a different set of skills this turn than its sheet lists
  // (the Berserker's Slash is the feast while its Rage is full)
  const view = eliteSkillsFor(enemy);
  if (view !== enemy.skills) enemy = { ...enemy, skills: view };
  // Whoever the Jarl's rune circle lets it reach: inside a duel, the other duelist and nobody
  // else; outside one, everybody but the two who are inside
  const foes = allUnits.filter(
    (u) => u.isPlayer !== enemy.isPlayer && u.currentHp > 0 && !duelBars(enemy, u),
  );
  if (foes.length === 0) {
    trace('nothing left to fight'); // i18n-exempt: AI trace, shown only on the dev sim panel
    return [{ type: 'endturn' }];
  }

  // The Basic Attack a unit falls back on rather than passing its turn (playtest
  // 2026-10-23): its own if it carries one, else one read off its kit
  const basicAt = (against: CombatUnit[]): SkillResult | null =>
    findBestSkill({ ...enemy, skills: [fallbackBasicAttack(enemy)] }, against, allUnits, considered);

  // A silenced unit keeps its Basic Attack (PT-19), so one that carries one — a hero
  // the AI drives — chooses among that alone, and the rest of the turn runs as ever
  if (isSilenced(enemy)) {
    const basic = enemy.skills.filter((s) => s.id === BASIC_ATTACK_ID);
    if (basic.length > 0) enemy = { ...enemy, skills: basic };
  }
  // A silenced enemy strikes with the fallback if it can; failing that it repositions,
  // so it does not simply pass its turn
  if (isSilenced(enemy) && !enemy.skills.some((s) => s.id === BASIC_ATTACK_ID)) {
    const taunter = activeTaunt(enemy, allUnits);
    const basic = basicAt(taunter ? [taunter] : foes);
    if (basic) {
      trace('silenced — Basic Attack', { silenced: true, choseSkillId: basic.skill.id }); // i18n-exempt: AI trace, shown only on the dev sim panel
      return [{ type: 'skill', skill: basic.skill, skillTarget: basic.targetPos }];
    }
    const moveTarget = chooseMoveTarget(enemy, foes, allUnits);
    // `chooseMoveTarget` returns null both for a unit that cannot move and for
    // one already standing where it wants to be, so the wording covers both —
    // "cannot move" about a unit that simply likes its hex is the sort of trace
    // line that sends the next reader looking for a Root that is not there.
    trace(moveTarget ? 'silenced — repositions' : 'silenced — holds ground', { silenced: true }); // i18n-exempt: AI trace, shown only on the dev sim panel
    return moveTarget ? [{ type: 'move', targetPos: moveTarget }, { type: 'endturn' }] : [{ type: 'endturn' }];
  }

  const actions: AIAction[] = [];

  // A scripted boss or elite does not score its skills against each other: the
  // sequence — preparations that must run to the end, delayed payoffs, objectives —
  // is not something a highest-damage pick can hold together
  const scripted = scriptDecide({
    enemy, foes, allUnits, trace, considered,
    aim: (skills, against) => findBestSkill({ ...enemy, skills }, against, allUnits, considered),
    approach: (against) => chooseApproach(enemy, against, allUnits),
  });
  if (scripted) return scripted;

  // Taunt: must target the taunting unit. `activeTaunt` resolves which taunt
  // wins and whether its source is still alive — a taunt from a corpse returns
  // null here and the normal AI continues (CombatScene cleans up the effect).
  const taunter = activeTaunt(enemy, allUnits);
  if (taunter) {
    // Only consider non-AoE skills targeting the taunter
    const taunterPlayers = [taunter];
    const nonAoeSkills = enemy.skills.filter((s) => !isAoESkill(s));
    const enemyForSkill = { ...enemy, skills: nonAoeSkills };
    // Nothing in the kit that may be aimed at the taunter alone (an elite of area
    // skills, or all of them cooling): the Basic Attack, rather than a lost turn
    const bestSkillResult = findBestSkill(enemyForSkill, taunterPlayers, allUnits, considered)
      ?? basicAt(taunterPlayers);
    if (bestSkillResult) {
      actions.push({ type: 'skill', skill: bestSkillResult.skill, skillTarget: bestSkillResult.targetPos });
      trace(`taunted — ${skillName(bestSkillResult.skill)}`, { // i18n-exempt: AI trace, shown only on the dev sim panel
        forcedBy: taunter.name,
        choseSkillId: bestSkillResult.skill.id,
      });
      return actions;
    }
    // Move toward taunter if out of range
    // A taunt is answered whatever the formation says
    const moveTarget = chooseMoveTarget(enemy, taunterPlayers, allUnits, false);
    if (moveTarget) actions.push({ type: 'move', targetPos: moveTarget });
    trace(moveTarget ? 'taunted — closes in' : 'taunted — holds ground', { forcedBy: taunter.name }); // i18n-exempt: AI trace, shown only on the dev sim panel
    actions.push({ type: 'endturn' });
    return actions;
  }

  // The Orc Warchief's order: an Orc of his warband makes for the hero he named, and strikes
  // them if it can, for as long as the order stands and he can still shout it
  const ordered = warbandTargetFor(enemy, allUnits);
  if (ordered) {
    const answer = findBestSkill(enemy, [ordered], allUnits, considered);
    if (answer) {
      trace(`ordered at ${ordered.name} — ${skillName(answer.skill)}`, { choseSkillId: answer.skill.id }); // i18n-exempt: AI trace, shown only on the dev sim panel
      return [{ type: 'skill', skill: answer.skill, skillTarget: answer.targetPos }];
    }
    const walk = chooseMoveTarget(enemy, [ordered], allUnits, false);
    trace(walk ? `ordered at ${ordered.name} — closes in` : `ordered at ${ordered.name} — holds ground`); // i18n-exempt: AI trace, shown only on the dev sim panel
    return walk ? [{ type: 'move', targetPos: walk }, { type: 'endturn' }] : [{ type: 'endturn' }];
  }

  let bestSkillResult = findBestSkill(enemy, foes, allUnits, considered);

  // A formation buff that would land on nobody but the caster is the last thing
  // worth a turn, not the first (playtest PT-08): the Brigand Captain opened
  // every fight Rallying himself while his warband walked away from him. Any
  // other skill that reaches something is taken over it; failing that he walks
  // toward the fight — his warband is between him and it — and the buff waits
  // for a turn on which it covers somebody. Only a unit with nowhere to go
  // casts it on itself.
  if (bestSkillResult && isLonelyFormationBuff(enemy, bestSkillResult.skill, allUnits)) {
    const lonely = bestSkillResult.skill;
    const other = findBestSkill(
      { ...enemy, skills: enemy.skills.filter((s) => s.id !== lonely.id) }, foes, allUnits,
    );
    if (other) {
      bestSkillResult = other;
    } else {
      const walk = chooseMoveTarget(enemy, foes, allUnits);
      if (walk) {
        trace(`${skillName(lonely)} would cover only itself — closes on the fight`); // i18n-exempt: AI trace, shown only on the dev sim panel
        return [{ type: 'move', targetPos: walk }, { type: 'endturn' }];
      }
    }
  }

  // The Herd-Khan's Twin Raid is two dashes in one action. The first is made as the ordinary
  // move the scene already walks and waits on; the action that follows bursts where he lands
  // and, if a second dash is legal, makes it and bursts again
  if (bestSkillResult?.skill.id === 'twin_raid') {
    const legs = planTwinRaid(enemy, allUnits, useCombatStore.getState().hazards);
    if (legs.length > 0) {
      trace(`Twin Raid (${bestSkillResult.value.toFixed(1)})`, { choseSkillId: 'twin_raid' }); // i18n-exempt: AI trace, shown only on the dev sim panel
      return [
        { type: 'move', targetPos: legs[0].to, dash: legs[0].path },
        { type: 'skill', skill: bestSkillResult.skill, skillTarget: (legs[1] ?? legs[0]).to },
      ];
    }
  }

  // If already in range — act first, then optionally move
  if (bestSkillResult) {
    actions.push({
      type: 'skill',
      skill: bestSkillResult.skill,
      skillTarget: bestSkillResult.targetPos,
    });
    trace(`${skillName(bestSkillResult.skill)} (${bestSkillResult.value.toFixed(1)})`, { // i18n-exempt: AI trace, shown only on the dev sim panel
      choseSkillId: bestSkillResult.skill.id,
    });
    return actions;
  }

  // Nothing in the kit reaches, or all of it is cooling: a foe within the Basic
  // Attack's reach is struck with that rather than walked away from
  const basic = basicAt(foes);
  if (basic) {
    trace('no skill usable — Basic Attack', { choseSkillId: basic.skill.id }); // i18n-exempt: AI trace, shown only on the dev sim panel
    return [{ type: 'skill', skill: basic.skill, skillTarget: basic.targetPos }];
  }

  // Not in range — move only (mirrors the player one-action-per-turn rule)
  const moveTarget = chooseMoveTarget(enemy, foes, allUnits);
  if (moveTarget) {
    actions.push({ type: 'move', targetPos: moveTarget });
  }

  trace(moveTarget ? 'no skill in reach — advances' : 'no skill in reach — holds ground'); // i18n-exempt: AI trace, shown only on the dev sim panel
  actions.push({ type: 'endturn' });
  return actions;
}





/**
 * Where an Emperor walks to reach the party: the hex nearest the closest hero.
 * Not `chooseMoveTarget`, whose kiting rule reads any skill of range three or
 * more as a ranged attacker — his writ reaches six and he is not an archer.
 */
function chooseApproach(
  enemy: CombatUnit,
  foes: CombatUnit[],
  allUnits: CombatUnit[],
): HexCoord | null {
  const reach = getMovementRange(enemy, allUnits, useCombatStore.getState().hazards);
  const nearest = (pos: HexCoord) =>
    foes.reduce((best, f) => Math.min(best, hexDistance(pos, f.position)), 99);
  let best: HexCoord | null = null;
  let bestScore = nearest(enemy.position);
  for (const pos of reach) {
    const score = nearest(pos);
    if (score < bestScore) {
      bestScore = score;
      best = pos;
    }
  }
  return best;
}

/** How close an enemy must be before the AI thinks a Reaction worth a turn. */
const REACTION_THREAT_REACH = 3;


function findBestSkill(
  enemy: CombatUnit,
  foes: CombatUnit[],
  allUnits: CombatUnit[],
  considered?: AIConsideration[]
): SkillResult | null {
  let best: SkillResult | null = null;

  for (const skill of enemy.skills) {
    // A skill that cannot be cast must not be scored — otherwise the AI picks
    // its best option, finds it unavailable at execution time, and wastes the
    // turn doing nothing at all
    // A second warning while one is still pending would be a pattern with no
    // safe answer, which the cast refuses — so it must not be scored either.
    if (
      !canUseSkill(enemy, skill) ||
      (skill.prepares && !canPrepare(enemy.id)) ||
      (skill.reaction && !canPrepareReaction(enemy.id, useCombatStore.getState().reactions))
    ) {
      considered?.push({
        skillId: skill.id,
        skillName: skillName(skill),
        value: null,
        rejected: 'unusable',
      });
      continue;
    }
    // Find best target for this skill
    const result = evaluateSkill(enemy, skill, foes, allUnits);
    considered?.push(
      result
        ? {
            skillId: skill.id,
            skillName: skillName(skill),
            value: result.value,
            targetPos: result.targetPos,
          }
        : { skillId: skill.id, skillName: skillName(skill), value: null, rejected: 'no-target' }
    );
    if (result && (!best || result.value > best.value)) {
      best = result;
    }
  }

  return best;
}

/**
 * What a buff is worth, measured over the allies it would actually land on.
 *
 * Every other scoring path is denominated in damage, and a skill that deals none
 * scored zero — so a pure support skill could never win the comparison and was
 * never cast. `rally` has been on the orc warchief since the faction rosters
 * landed without ever going off once.
 *
 * Allies already carrying the effect are worth nothing, which is what stops a
 * Sentinel spending every turn refreshing the same dome over the same two
 * soldiers. Scored per *ally covered*, so a buff is worth casting in a formation
 * and not worth casting alone — which is the behaviour that makes a shield wall
 * read as a shield wall.
 *
 * Only self-centred support is scored. Every buff in the game is a Self or a
 * range-0 Ring, because that is what a formation ability is; a buff aimed at a
 * distant ally would need its own targeting pass, and nothing asks for one.
 */
function supportValue(
  caster: CombatUnit,
  skill: HeroSkill,
  affected: HexCoord[],
  allUnits: CombatUnit[],
): number {
  // Scored off the auras only. A skill carrying both a blessing and a curse is
  // worth casting for the blessing regardless of what else rides along, and
  // nothing here has ever valued afflictions.
  const auras = skillEffects(skill).filter((e) => !isAffliction(e.type));
  if (auras.length === 0) return 0;

  let value = 0;
  for (const hex of affected) {
    const ally = allUnits.find(
      (u) => u.currentHp > 0 &&
             !u.objective &&
             u.isPlayer === caster.isPlayer &&
             u.position.q === hex.q && u.position.r === hex.r
    );
    // Already carrying every aura this would grant, so it buys nothing. One
    // missing entry is enough to make the cast worthwhile.
    if (!ally || auras.every((e) => hasEffect(ally, e.type))) continue;
    // The caster's own hex counts for half. These are formation abilities: a
    // shield wall of one is not a wall, and without the discount a lone soldier
    // would stand in the open buffing itself instead of swinging. It still has
    // to count for *something*, because a pure self-buff — the Stalker melting
    // away — has nobody else to score against and would never be cast at all.
    value += ally.id === caster.id
      ? BALANCE.AI_SUPPORT_VALUE_PER_ALLY / 2
      : BALANCE.AI_SUPPORT_VALUE_PER_ALLY;
  }
  return value;
}

/**
 * A formation buff — a range-0 ring of auras and nothing else — that would land
 * on nobody but its caster: every ally is out of its radius or already wears
 * what it grants. `supportValue` still scores the caster's own hex at half, so
 * such a cast is a legal choice; `decideEnemyAction` makes it the last one.
 * A pure `Self` buff (the Stalker melting away) is never "lonely": it has
 * nobody else to cover by design.
 */
export function isLonelyFormationBuff(
  caster: CombatUnit,
  skill: HeroSkill,
  allUnits: CombatUnit[],
): boolean {
  if (skill.targetType === SkillTargetType.Self || skill.range || !(skill.aoeRadius || skill.arenaWide)) {
    return false;
  }
  if (skill.damage || skill.healing || skill.summons || skill.places || skill.reaction) return false;
  const auras = skillEffects(skill).filter((e) => !isAffliction(e.type));
  if (auras.length === 0) return false;
  const affected = getSkillTargets(skill, caster.position, caster.position, allUnits);
  return !affected.some((hex) => allUnits.some(
    (u) => u.id !== caster.id &&
           u.currentHp > 0 &&
           !u.objective &&
           u.isPlayer === caster.isPlayer &&
           u.position.q === hex.q && u.position.r === hex.r &&
           !auras.every((e) => hasEffect(u, e.type)),
  ));
}

/**
 * The formation buff a unit could cast now, if it carries one: what pulls it
 * toward its own side when it walks (`chooseMoveTarget`).
 */
function readyFormationBuff(unit: CombatUnit): HeroSkill | undefined {
  return unit.skills.find(
    (s) => s.targetType !== SkillTargetType.Self && !s.range && !!s.aoeRadius &&
           !s.damage && !s.healing && !s.summons && !s.places && !s.reaction &&
           skillEffects(s).some((e) => !isAffliction(e.type)) &&
           canUseSkill(unit, s),
  );
}

/** The afflictions that take a turn or a choice away: what a control skill is for. */
const CONTROL_TYPES = new Set<string>([AfflictionType.Stun, AfflictionType.Freeze, AfflictionType.Root, AfflictionType.Silence]);

/**
 * Whether a cooldown skill's control would be spent on nobody new: every foe it
 * reaches is already held (stunned, frozen, asleep, kneeling) or already carries
 * each control it applies.
 *
 * Playtest 2026-10-14: two Delve Breakers in one fight cast Cave-In on the same
 * hero in the same round, and the second Stun merged into the first. Each AI
 * decides from the live board, so the second one sees the first's Stun — this is
 * what it now reads off it. A cast that kills somebody is never called wasted.
 */
export function controlWasted(skill: HeroSkill, targets: CombatUnit[], kills: boolean): boolean {
  if (!skill.cooldown || kills || targets.length === 0) return false;
  const controls = skillEffects(skill).filter((e) => !e.selfOnly && CONTROL_TYPES.has(e.type));
  if (controls.length === 0) return false;
  return targets.every((t) => isActionLocked(t) || controls.every((c) => hasEffect(t, c.type)));
}

function evaluateSkill(
  caster: CombatUnit,
  skill: HeroSkill,
  foes: CombatUnit[],
  allUnits: CombatUnit[]
): SkillResult | null {
  // An elite's signature strikes nobody at the cast, so it is scored on what it buys
  const signature = eliteSkillValue(caster, skill, foes, allUnits);
  if (signature !== undefined) return signature;
  // And so is each of the new-faction elites' (Undermine, Twin Raid, the Challenge, the Tomb)
  const northern = factionEliteSkillValue(caster, skill, foes, allUnits);
  if (northern !== undefined) return northern;
  // And the Draconic Host's (the Warlord's Doom, the Daitengu's Gale)
  const draconic = draconicHostSkillValue(caster, skill, foes, allUnits);
  if (draconic !== undefined) return draconic;
  // The Fallen Order's: the Warden's Bastion, the Abbot's Vow, the Bell-Keeper's toll and ring
  const order = fallenOrderSkillValue(caster, skill, foes, allUnits, useCombatStore.getState().hazards);
  if (order !== undefined) return order;

  // Summons score before the damage paths, which all return null at zero damage —
  // a summon deals none, so without this branch it would never be cast at all.
  if (skill.summons) return evaluateSummon(caster, skill, allUnits);

  // A Reaction deals nothing now, so a damage score would never pick it. Worth
  // preparing in proportion to the opposition close enough to set it off, and
  // never worth a turn with nobody near.
  if (skill.reaction) {
    const near = foes.filter((f) => hexDistance(caster.position, f.position) <= REACTION_THREAT_REACH);
    return near.length > 0 ? { skill, targetPos: caster.position, value: 4 + 3 * near.length } : null;
  }

  // Raising an objective is a setup move: it deals nothing now, so a damage-only
  // score would be zero and the AI would never plant a banner. It is scored on
  // what it buys (`evaluateObjectives`), plus whatever the same cast strikes.
  if (skill.places) {
    const setup = evaluateObjectives(caster, skill, foes, allUnits);
    if (setup) return setup;
    if (!skill.damage) return null;
  }

  // Self-centred skills, and self-centred rings — a Ring at range 0 (Smash,
  // Life Drain) is aimed at the caster's own hex, so it can never satisfy the
  // `dist <= range` test in the targeted branch below and would never be cast.
  if (skill.targetType === SkillTargetType.Self || (!skill.range && (skill.aoeRadius || skill.arenaWide))) {
    let totalValue = 0;
    let damageDealt = 0;
    const struck: CombatUnit[] = [];
    let kills = false;
    const affected = getSkillTargets(skill, caster.position, caster.position, allUnits);
    for (const hex of affected) {
      const target = allUnits.find(
        (u) => u.currentHp > 0 && u.position.q === hex.q && u.position.r === hex.r
      );
      if (!target) continue;
      if (target.isPlayer !== caster.isPlayer && !target.objective) struck.push(target);
      // Value damage on the *other* side. This read was inverted, so a
      // self-centred blast was scored by how hard it hit the caster's own allies.
      if (skill.damage && target.isPlayer !== caster.isPlayer) {
        const dmg = expectedDamage(caster, target, skill, 'front', allUnits);
        damageDealt += dmg;
        totalValue += dmg;
        if (dmg >= target.currentHp) { totalValue += 50; kills = true; }
      }
      if (skill.healing && target.isPlayer === caster.isPlayer && !target.objective) {
        totalValue += calculateHealing(caster, skill, target);
      }
    }
    if (!skill.healing && controlWasted(skill, struck, kills)) return null;
    // Random strikes reach only some of the enemies they could pick: value the
    // expected share rather than every candidate
    if (skill.randomEnemies && affected.length > skill.randomEnemies) {
      totalValue *= skill.randomEnemies / affected.length;
      damageDealt *= skill.randomEnemies / affected.length;
    }
    totalValue += calculateLifesteal(skill, damageDealt);
    // A line still marching locks shields when the fight arrives, not before (PT-12):
    // cast now, the wall runs out on the walk and the line arrives behind its own backliners
    if (!lineIsMarching(caster, foes)) totalValue += supportValue(caster, skill, affected, allUnits);
    if (totalValue > 0) {
      return { skill, targetPos: caster.position, value: totalValue };
    }
    return null;
  }

  // Find best single/aoe target among foes
  let best: SkillResult | null = null;

  for (const foe of foes) {
    // Aimed at a body, a skill with an `occupiedVariant` is that variant: Shadowstep
    // is a dash and a poisoned strike there, and scored as its blink it reached
    // nobody and was never cast. The skill itself is what is returned — the
    // resolver picks the variant from the same hex.
    const cast = skillVariantFor(skill, true);
    // Stealth hides the unit from single-target skills, and scoring a target the
    // resolver would refuse means the AI picks a move, spends its turn on it and does
    // nothing — the same class of bug as highlighting an illegal hex. The predicate the
    // board's highlights read, so the two cannot disagree.
    if (!canAim(caster, foe, cast)) continue;
    const dist = hexDistance(caster.position, foe.position);
    // Cover stops an enemy's shot as it stops a hero's: it does not aim over rubble or glass
    if (dist > cast.range || rampartBlocksShot(cast, caster.position, foe.position, allUnits, useCombatStore.getState().hazards)) continue;
    // A gap-closer that cannot close the gap is not an option. Same predicate
    // the highlight pass and `skillResolution` use, so Root and a target hemmed
    // in on all six sides are refused identically on both sides of the line —
    // without it the AI scored the cast, the resolver declined the approach and
    // a charge landed its melee damage from three hexes away.
    if (selfMoveBlocked(caster, cast, foe.position, allUnits, useCombatStore.getState().hazards)) continue;

    const affected = getSkillTargets(cast, caster.position, foe.position, allUnits, useCombatStore.getState().hazards);
    let value = 0;
    let damageDealt = 0;
    const struck: CombatUnit[] = [];
    let kills = false;

    for (const hex of affected) {
      const target = allUnits.find(
        (u) =>
          u.currentHp > 0 &&
          u.position.q === hex.q &&
          u.position.r === hex.r &&
          u.isPlayer !== caster.isPlayer
      );
      if (!target) continue;
      struck.push(target);
      if (cast.damage) {
        const dmg = expectedDamage(caster, target, cast, 'front', allUnits);
        // Extra value for finishing blows and low-HP targets
        value += dmg;
        damageDealt += dmg;
        if (dmg >= target.currentHp) { value += 50; kills = true; }
        if (target.currentHp < target.stats.maxHp * 0.3) value += 20;
      }
    }

    // A control cooldown spent on bodies that are already held is a turn thrown away
    if (controlWasted(cast, struck.filter((t) => !t.objective), kills)) continue;

    value += calculateLifesteal(cast, damageDealt);

    if (value > 0 && (!best || value > best.value)) {
      best = { skill, targetPos: foe.position, value };
    }
  }

  return best;
}

/**
 * Values raising objectives, which strike nobody. The score is what the objective
 * buys its owner — protection and the effects it will leave — rather than damage,
 * crowded down per one already standing so the AI does not replant a full field.
 * Scored zero when there is nowhere to place it, so a boxed-in caster does not
 * burn its turn on a cast that cannot resolve.
 */
function evaluateObjectives(
  caster: CombatUnit,
  skill: HeroSkill,
  foes: CombatUnit[],
  allUnits: CombatUnit[],
): SkillResult | null {
  const spec = skill.places;
  if (!spec) return null;

  // Aimed at the nearest foe for an aimed placement, since it has to be near
  // the party; beside the caster otherwise.
  const nearest = [...foes].sort(
    (a, b) => hexDistance(caster.position, a.position) - hexDistance(caster.position, b.position),
  )[0];
  let aim = spec.placement === 'aimed' && nearest ? nearest.position : caster.position;
  if (spec.kind === 'rampart') {
    const candidates = getValidSkillTargetHexes(skill, caster, allUnits, useCombatStore.getState().hazards)
      .sort((a, b) => (nearest ? hexDistance(a, nearest.position) - hexDistance(b, nearest.position) : 0));
    if (!candidates.length) return null;
    aim = candidates[0];
  }
  const hexes = objectiveHexes(caster, skill, aim, allUnits);
  if (hexes.length === 0) return null;

  const standing = standingObjectives(caster, spec.kind, allUnits);
  const crowding = 1 / (1 + standing);
  const worth =
    BALANCE.AI_OBJECTIVE_VALUE +
    (spec.protection ?? 0) * BALANCE.AI_OBJECTIVE_PROTECTION_VALUE;
  const value = worth * hexes.length * crowding;
  return value > 0 ? { skill, targetPos: aim, value } : null;
}

/**
 * How much of a summon's theoretical lifetime damage to actually count.
 *
 * A direct hit is certain; a summon's damage is contingent on it surviving,
 * reaching something, and connecting — and it arrives later, when the fight may
 * already be decided. At face value the AI summons on every single turn,
 * because "attack × turns alive" beats any one spell it owns.
 */
const SUMMON_DISCOUNT = 0.35;

/**
 * Values a summon as roughly "damage it will deal before it dies".
 *
 * A summon's worth is spread over future turns rather than delivered now, so it
 * cannot be scored the way a damage skill is. `attack × expected turns` puts it
 * on the same scale as a direct hit without needing a second notion of value.
 *
 * Two guards keep it from being spammed: the score decays with how many summons
 * the caster already has out, and it drops to nothing when there is no room to
 * place one — otherwise a boxed-in caster would burn every turn on a spell that
 * cannot resolve.
 */
function evaluateSummon(
  caster: CombatUnit,
  skill: HeroSkill,
  allUnits: CombatUnit[]
): SkillResult | null {
  const spec = skill.summons;
  if (!spec) return null;

  // A staged summon is a three-cast plan aimed at a hex the AI has no way to
  // pick, and nothing enemy-side carries one. Refusing to score it is cheaper
  // than teaching this function a chain it will never be asked to run.
  if (spec.stages) return null;

  const template = findSummonTemplate(spec.templateId);
  if (!template) return null;

  const room = findSummonHexes(caster.position, spec.count, allUnits).length;
  if (room === 0) return null;

  // A companion swings nothing: it is worth the share of every spell it echoes,
  // one a turn, for its lifetime — and nothing while one already stands
  if (template.companion) {
    if (allUnits.some((u) => u.currentHp > 0 && u.companion && u.summonedBy === caster.id)) return null;
    const echoed = caster.stats.magic * (spec.echoMagic ?? 0) * (spec.duration ?? 1);
    return { skill, targetPos: caster.position, value: echoed * SUMMON_DISCOUNT };
  }

  const existing = allUnits.filter((u) => u.currentHp > 0 && u.summonedBy === caster.id).length;
  // Halves per summon already standing — the second is worth much less than the first
  const crowding = 1 / (1 + existing);

  // A summon spends its first turn closing the distance, so it does not get to
  // swing on every turn it is alive for
  const swings = Math.max(1, (spec.duration ?? 4) - 1);

  const value =
    template.baseStats.attack * swings * Math.min(room, spec.count) * crowding * SUMMON_DISCOUNT;

  return { skill, targetPos: caster.position, value };
}

/**
 * Where a unit wants to stand, or `null` to leave it where it is.
 *
 * Two rules here are the whole of "the Delve Breaker sometimes does nothing on
 * its turn", and both are general rather than about that template:
 *
 * **Positioning reads the skills that are actually castable.** `isRanged` and
 * `primarySkillRange` used to be taken from the unit's whole kit, cooldowns
 * ignored — so a melee brute carrying one long-reach ability was classed as a
 * ranged kiter for the entire fight and deliberately held station at range 2,
 * where its at-will swing could not reach. The Breaker's Cave-In has a cooldown
 * of 4, so on four turns out of five it stood at its ideal distance with nothing
 * it could do from there and nothing telling it to close. Eight templates had
 * the same hole and it is the same hole in every one: the Dire Wolf, the Orc
 * Berserker and the Troll Chieftain with Charge, the Giant Spider with Web, the
 * Revenant with Bone Shards, the Dread Knight with Dread Charge, and Aethelred.
 *
 * **Standing still is scored, not chosen by accident.** `getHexesInRange`
 * includes its own centre, so the unit's current hex was one of the candidates
 * and a unit already at its ideal distance would "move" onto the hex it was
 * already standing on — a store write that changes nothing, a turn spent, and
 * absolutely nothing on screen. Staying put is now the baseline every other hex
 * has to *beat*, which both removes the no-op and stops a unit shuffling
 * sideways between hexes it likes exactly as much.
 */
function chooseMoveTarget(
  enemy: CombatUnit,
  foes: CombatUnit[],
  allUnits: CombatUnit[],
  /** False where something overrides the formation: a taunt, the Warchief's order. */
  holdLine = true,
): HexCoord | null {
  const moveRange = getMovementRange(enemy, allUnits, useCombatStore.getState().hazards);
  if (moveRange.length === 0) return null;

  // What it could cast if it were in position. A unit with everything on
  // cooldown falls back to its whole kit rather than to nothing: it still has
  // to stand somewhere, and where it wants to be next turn is the best guess
  // available.
  const ready = enemy.skills.filter((s) => canUseSkill(enemy, s));
  const usable = ready.length > 0 ? ready : enemy.skills;

  // Ranged enemies: keep distance (prefer positions 2-3 away from nearest foe).
  // Read off what strikes or heals from where the caster stands: a dash's, a
  // blink's or an escape's range is how far it travels (a retreat shoots first,
  // so its range is a shot's), and a mark hits nothing. Read off the whole kit,
  // the Shadowblade's Assassinate (range 20) held it nineteen hexes off a fight
  // its daggers had to be in (PvP playtest 2026-10-25)
  const reaches = usable.filter(
    (s) => ((s.damage ?? 0) > 0 || (s.healing ?? 0) > 0) &&
      (!s.selfMove || s.selfMove.kind === 'retreat'),
  );
  const isRanged = reaches.some((s) => s.range >= 3);
  const primarySkillRange = Math.max(...reaches.map((s) => s.range), 1);
  // Same list again: clustering for an area skill that is on cooldown is how a
  // brute talks itself into standing in the open.
  const wantsCrowd = usable.some((s) => s.targetType === SkillTargetType.Ring || s.aoeRadius);

  // Target: lowest HP player
  const target = [...foes].sort((a, b) => a.currentHp - b.currentHp)[0];
  const formation = readyFormationBuff(enemy);

  const scoreOf = (pos: HexCoord): number => {
    const dist = hexDistance(pos, target.position);
    // Ranged wants its ideal range; melee closes the gap
    const idealDist = Math.max(2, primarySkillRange - 1);
    let score = isRanged ? -Math.abs(dist - idealDist) : -dist;
    // A melee unit whose way to its target is walled off by its own side strikes
    // whoever it can stand beside, rather than waiting two hexes off (PT-12)
    if (!isRanged && foes.some((f) => hexDistance(pos, f.position) <= 1)) {
      score += BALANCE.AI_MELEE_CONTACT_BONUS;
    }

    // Prefer positions that enable more skill targets (AoE value)
    if (wantsCrowd) {
      score += foes.filter((p) => hexDistance(pos, p.position) <= primarySkillRange).length * 10;
    }
    // A unit holding a formation buff walks to where its next cast would cover
    // somebody — the Captain closes on the fight through his warband rather
    // than past it (PT-08)
    if (formation) {
      score += BALANCE.AI_FORMATION_PULL_PER_ALLY * allUnits.filter(
        (u) => u.id !== enemy.id && u.currentHp > 0 && !u.objective && u.isPlayer === enemy.isPlayer &&
               hexDistance(pos, u.position) <= (formation.aoeRadius ?? 0),
      ).length;
    }
    return score;
  };

  // A `behind` unit keeps behind its line's front until the line engages (PT-12)
  const floor = holdLine ? behindLineFloor(enemy, allUnits, foes) : null;

  let bestPos: HexCoord | null = null;
  // Scored explicitly rather than relying on `moveRange` containing the hex:
  // it does today, and a unit standing outside the arena would not be in it.
  let bestScore = scoreOf(enemy.position);

  for (const pos of moveRange) {
    if (pos.q === enemy.position.q && pos.r === enemy.position.r) continue;
    if (floor !== null && !keepsBehindLine(enemy, pos, floor, foes)) continue;
    const score = scoreOf(pos);
    if (score > bestScore) {
      bestScore = score;
      bestPos = pos;
    }
  }

  return bestPos;
}

export function executeAIActions(
  enemy: CombatUnit,
  actions: AIAction[],
  /** Where the turn is shown; `SILENT_SINK` for a headless run. */
  sink: CombatSink = SILENT_SINK,
  opts: { rng?: () => number } = {},
): void {
  withDice(opts.rng, () => runAIActions(enemy, actions, sink));
}

/** One walk of the AI's, around whatever stands in the way, as a hero's move is. */
function walkTo(enemy: CombatUnit, mover: CombatUnit, to: HexCoord, sink: CombatSink): void {
  const store = useCombatStore.getState();
  const from = mover.position;
  const path = findMovePath(mover, to, store.units, store.hazards) ?? undefined;
  store.moveUnit(enemy.id, to, 'walk', undefined, undefined, path);
  sink.sound?.(walkIntent(mover, from, to, path && path.length - 1));
  store.markMoved(enemy.id);
  applyOnMove(enemy, sink);
}

/**
 * A cast the resolver refused is not allowed to be the whole turn (PT-14): the unit
 * walks toward the fight instead, if it has not moved or acted yet and has somewhere
 * better to stand. The scoring and the resolver are meant to agree — the Bog Hulk's
 * Mire Undertow did not, and he stood still whenever the party waited two or three
 * hexes off — and this stops the next disagreement from swallowing a turn.
 */
function walkInsteadOfRefusedCast(enemy: CombatUnit, sink: CombatSink): void {
  const live = useCombatStore.getState();
  const mover = unitById(live.units, enemy.id);
  if (!mover || mover.currentHp <= 0 || mover.hasMoved || mover.hasActed) return;
  const foes = live.units.filter((u) => u.isPlayer !== mover.isPlayer && u.currentHp > 0 && !duelBars(mover, u));
  if (foes.length === 0) return;
  const to = chooseMoveTarget(mover, foes, live.units);
  if (to) walkTo(enemy, mover, to, sink);
}

function runAIActions(enemy: CombatUnit, actions: AIAction[], sink: CombatSink): void {
  const store = useCombatStore.getState();

  for (const action of actions) {
    switch (action.type) {
      case 'move':
        if (action.targetPos) {
          // Walked around whatever stands in the way, as a hero's move is; a scripted
          // step with no route falls back to the straight line
          const live = useCombatStore.getState();
          const mover = unitById(live.units, enemy.id) ?? enemy;
          const from = mover.position;
          if (action.dash) {
            store.moveUnit(enemy.id, action.targetPos, 'dash', undefined, undefined, [from, ...action.dash]);
            sink.sound?.(moveIntent(enemy.id, from, action.targetPos, 'dash'));
            store.markMoved(enemy.id);
            applyOnMove(enemy, sink);
            break;
          }
          walkTo(enemy, mover, action.targetPos, sink);
        }
        break;
      case 'skill': {
        if (!action.skill || !action.skillTarget) break;
        // Read from the store: the unit may have moved earlier in this sequence,
        // making the `enemy` snapshot stale.
        const caster = unitById(useCombatStore.getState().units, enemy.id) ?? enemy;
        if (scriptCast(caster, action.skill, action.skillTarget, action.bossStep, sink)) break;
        // Everything else is cast by the resolver a hero's cast goes through
        const cast = resolveSkillUse(caster, action.skill, action.skillTarget, sink);
        if (!cast.ok) {
          walkInsteadOfRefusedCast(enemy, sink);
          break;
        }
        // A hero's free cast (Reposition, a kill refund) leaves the turn open, as it does for the
        // player, so a planned follow-up can still act; a monster's cast always spends its action
        if (cast.endsTurn || !caster.heroId) store.markActed(enemy.id);
        if (action.bossStep !== undefined) store.patchBossScript(enemy.id, { step: action.bossStep });
        // What an elite's cast leaves behind: a warning's riders, the Hulk's marsh, the Matriarch's seed
        if (action.skill.prepares) scriptsAfterCast(caster, action.skill, 'prepare', sink);
        else if (!action.skill.reaction) scriptsAfterCast(caster, action.skill, 'strike', sink);
        break;
      }
    }
  }
}
