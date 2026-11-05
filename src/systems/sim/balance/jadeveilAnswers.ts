import { CombatUnit, HeroSkill, SkillTargetType } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { AIAction, decideEnemyAction } from '@/systems/combat/enemyAI';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { canUseSkill } from '@/systems/combat/cooldowns';
import { kairenOf, shardsOf, taintOf } from '@/systems/combat/kairenRules';
import { lastLessonOf, lessonMemory } from '@/systems/combat/lastLessonRules';
import { getMovementRange } from '@/systems/combat/movement';
import { answerOf } from '@/systems/combat/warnedAnswers';
import { WEB_KIND } from '@/systems/combat/yokaiKits';
import { warnedFor } from '@/systems/sim/emperorMeasure';
import { hexDistance, hexKey } from '@/utils/hexUtils';

/**
 * What the simulator's party does about Jadeveil's three bosses, beyond the steps every warning already gets:
 * basic tactics, as the rest of `partyPolicy` is. Which warning answers what is read off the warning; what is here
 * is how the two answers that are not a step are played, and the one rule of the Last Lesson's that a hero can keep
 * without giving up its turn. His four lessons are not played: a hero takes the rebuke and strikes.
 */

const strikes = (skill: HeroSkill) => !!skill.damage && skill.targetType !== SkillTargetType.Self;

/** A hero below this share of its health does not take a shard's burst on purpose. */
const SHARD_MIN_HEALTH = 0.25;
/** Taint that is worth a walk with no Verdant Judgement open: at this many stacks the next one is costly. */
const TAINT_WORTH_SHEDDING = 2;

/** The hero's cheapest strike that reaches `at` from `from` on the map, basic attack first. */
function strikeOf(unit: CombatUnit): HeroSkill | undefined {
  const usable = unit.skills.filter((s) => strikes(s) && canUseSkill(unit, s) && s.targetType === SkillTargetType.Single);
  return usable.find((s) => s.id === BASIC_ATTACK_ID) ?? usable.sort((a, b) => (a.manaCost ?? 0) - (b.manaCost ?? 0))[0];
}

/**
 * Kairen's Verdant Judgement is met by shedding Taint, and only a Jade Shard sheds it, for every hero beside it as
 * it breaks. A tainted hero under the Judgement, or carrying two stacks or more, walks beside a shard and breaks it.
 */
export function shedTaint(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  const boss = kairenOf(units);
  if (!boss) return null;
  const stacks = taintOf(unit);
  const judged = useCombatStore.getState().preparedAttacks.some((p) => p.casterId === boss.id && !!answerOf(p, 'cleanse'));
  if (stacks === 0 || (!judged && stacks < TAINT_WORTH_SHEDDING)) return null;
  if (unit.currentHp / Math.max(1, unit.stats.maxHp) < SHARD_MIN_HEALTH) return null;
  const skill = strikeOf(unit);
  if (!skill) return null;
  const shards = shardsOf(boss, units).sort((a, b) => hexDistance(a.position, unit.position) - hexDistance(b.position, unit.position) || (a.id < b.id ? -1 : 1));
  const covered = warnedFor(unit, units);
  for (const shard of shards) {
    if (hexDistance(unit.position, shard.position) === 1) return [{ type: 'skill', skill, skillTarget: shard.position }];
    const beside = getMovementRange(unit, units, useCombatStore.getState().hazards)
      .filter((h) => hexDistance(h, shard.position) === 1 && !covered.has(hexKey(h)))
      .sort((a, b) => hexDistance(a, unit.position) - hexDistance(b, unit.position) || a.q - b.q || a.r - b.r)[0];
    if (beside) return [{ type: 'move', targetPos: beside }, { type: 'skill', skill, skillTarget: shard.position }];
  }
  return null;
}

/**
 * A web holds a hero out of the fight and the bite lands only on a hero a web still holds, so a free hero cuts one
 * while one stands: any hit will do, so with the cheapest strike that reaches it, the whole kit only if none does.
 */
export function cutTheWeb(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  const webs = units.filter((u) => u.currentHp > 0 && u.objective?.kind === WEB_KIND);
  if (webs.length === 0) return null;
  const view = units.filter((u) => u.isPlayer === unit.isPlayer || webs.includes(u));
  const basic = unit.skills.find((s) => s.id === BASIC_ATTACK_ID);
  const cheap = basic ? decideEnemyAction({ ...unit, skills: [basic] }, view) : [];
  if (cheap.some((a) => a.type === 'skill')) return cheap;
  const any = decideEnemyAction(unit, view);
  return any.some((a) => a.type === 'skill') ? any : null;
}

/**
 * The Last Lesson parries a blow on him with the skill the hero used on its previous turn, and ripostes. In his fight a
 * hero's strikes this turn leave that skill out: with nothing else to strike with, it lets the round go, and then may
 * use it again. Anything else in its kit, and anyone else's fight, is untouched.
 */
export function withoutTheRepeat(unit: CombatUnit, units: CombatUnit[]): CombatUnit {
  const boss = lastLessonOf(units);
  if (!boss) return unit;
  const last = lessonMemory(boss).history[unit.id]?.last;
  if (!last) return unit;
  return { ...unit, skills: unit.skills.filter((s) => !(s.id === last && strikes(s))) };
}
