import { AfflictionType, AuraType, CombatUnit, HeroSkill, HexCoord, SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { skillName } from '@/data/gameText';
import { useCombatStore } from '@/stores/combatStore';
import { canUseSkill } from '@/systems/combat/cooldowns';
import { canPrepare } from '@/systems/combat/preparedCast';
import { carrierOf, threatensUnit } from '@/systems/combat/preparedAttacks';
import { clawOnCarrier, nextHeartBurn } from '@/systems/combat/dragonScript';
import { dragonClaw } from '@/data/templates/emeraldDragon';
import { barActions } from '@/systems/combat/barActions';
import { canPrepareReaction } from '@/systems/combat/reactions';
import { getMovementRange } from '@/systems/combat/movement';
import { getSkillTargets, getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { combatMaxHp } from '@/systems/combat/forms';
import { expectedDamage } from '@/systems/combat/damageCalc';
import { hasEffect } from '@/systems/combat/statusEffects';
import { beginTurn } from '@/systems/combat/turnStart';
import { fightOutcome } from '@/systems/combat/waveResolve';
import { SILENT_SINK } from '@/systems/combat/combatSink';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import type { AIAction, AIConsideration, AITrace } from '@/systems/combat/aiTypes';
import { inSandbox } from '@/systems/combat/sandbox';
import { healsOthers, PartyRole, roleOf } from '@/systems/combat/roles';
import { skillTargetKind } from '@/systems/combat/targetKind';
import { hexDistance, hexKey } from '@/utils/hexUtils';

/**
 * A hero team played the way a player plays it (the private project notes), for the PvP rival.
 *
 * 1. **Turns a player could take.** A hero moves *or* acts: hold, walk anywhere reachable, or cast
 *    any usable skill from where it stands at any aim that touches a body. A cast that leaves the turn
 *    open (a free action, a kill refund) is followed by every next step, and one that grants a
 *    reposition by every walk it allows. Each turn is played once in the real rules (`inSandbox`).
 * 2. **A team plan**, read off the board the turn leaves: each unit's role (`roleOf`), the danger on
 *    every hex (who could strike it next turn, and how hard), whether a tank is engaged.
 * 3. **One board score** for the turn's result, from the deciding side: health kept on each side (a
 *    wounded foe's health counting more, which is focus fire), kills and deaths, control landed on
 *    dangerous foes, the danger the side stands in (a tank minds it least), and the decider's own
 *    place by role — a tank in front, melee ahead of the tank only once it is engaged, ranged at
 *    reach and distance, a healer behind with its allies in reach.
 * 4. **Lookahead** (normal, hard): the best few turns are played on through the next turns of the
 *    decider, with everyone played by the ordinary brain, and scored again where that leaves them.
 *
 * Difficulty (`BALANCE.TACTICAL_AI`) is the lookahead's budget and how often the brain errs.
 */

export type TacticalLevel = 'easy' | 'normal' | 'hard';
export const TACTICAL_LEVELS: TacticalLevel[] = ['easy', 'normal', 'hard'];

export interface TacticalOptions {
  rng?: () => number;
  /**
   * The time a decision may take before it settles for the best so far (`BALANCE.TACTICAL_AI.MAX_MS`).
   * The balance lab passes Infinity: a decision cut by the clock would not replay the same.
   */
  maxMs?: number;
  onTrace?: (trace: AITrace) => void;
}

export interface TacticalDecision {
  actions: AIAction[];
  candidates: number;
  /** Candidates played forward by the lookahead. */
  lookedAhead: number;
  ms: number;
}

const W = BALANCE.TACTICAL_AI;
const CONTROL: string[] = [AfflictionType.Stun, AfflictionType.Freeze, AfflictionType.Root, AfflictionType.Silence, AfflictionType.Taunt];
/** Steps one turn may chain (free casts before the last action). */
const MAX_STEPS = 3;
/** Unit turns a rehearsal plays at most, whatever its depth. */
const MAX_REHEARSED_TURNS = 40;

const same = (a: HexCoord, b: HexCoord) => a.q === b.q && a.r === b.r;
const alive = (u: CombatUnit) => u.currentHp > 0 && !u.objective;
const unitOf = (id: string) => useCombatStore.getState().units.find((u) => u.id === id);

/** A hero moves or acts, never both: walking hands the turn over, as `CombatScene`'s `walkTo` does. */
export const movesOrActs = (unit: CombatUnit): boolean => !!unit.heroId && !unit.summonedBy;

/** Health and barrier: what it takes to drop the unit. */
function effectiveHp(u: CombatUnit): number {
  if (u.currentHp <= 0) return 0;
  const barrier = u.activeEffects.filter((e) => e.type === AuraType.Barrier).reduce((sum, e) => sum + Math.max(0, e.magnitude), 0);
  return u.currentHp + barrier;
}

const damaging = (s: HeroSkill) => !!s.damage && s.targetType !== SkillTargetType.Self;

// ─── The turns a player could take ───────────────────────────────────────────

function castable(unit: CombatUnit, skill: HeroSkill): boolean {
  return canUseSkill(unit, skill)
    && !(skill.prepares && !canPrepare(unit.id))
    && !(skill.reaction && !canPrepareReaction(unit.id, useCombatStore.getState().reactions));
}

/**
 * Aims for `skill` cast from `from` that touch somebody it is for: a foe for an attack, an ally for
 * support, either for a mixed skill (or nobody needed: a self cast, a summon). A Roar whose ring holds
 * only the caster is refused by the rules, and a refused cast is no turn.
 */
function aimsFrom(unit: CombatUnit, skill: HeroSkill, from: HexCoord, units: CombatUnit[]): HexCoord[] {
  const { hazards } = useCombatStore.getState();
  const caster = { ...unit, position: from };
  const board = units.map((u) => (u.id === unit.id ? caster : u));
  const aims = getValidSkillTargetHexes(skill, caster, board, hazards);
  if (skill.targetType === SkillTargetType.Self || skill.summons) return aims.slice(0, 1);
  // Pass the Heart is aimed at the ally it goes to, or the carrier it is taken from: every legal aim
  if (skill.passesHeart) return aims;
  const kind = skillTargetKind(skill);
  const wanted = (u: CombatUnit) => u.currentHp > 0
    && (kind === 'mixed' || (kind === 'support') === (u.isPlayer === unit.isPlayer));
  return aims.filter((aim) => getSkillTargets(skill, from, aim, board, hazards)
    .some((hex) => board.some((u) => wanted(u) && same(u.position, hex))));
}

/** A cast the rules refused: nothing paid, nothing spent, so nothing happened. */
function refused(before: CombatUnit, after: CombatUnit | undefined, skill: HeroSkill): boolean {
  return !!after && !after.hasActed && after.currentMana === before.currentMana
    && (after.cooldowns?.[skill.id] ?? 0) === (before.cooldowns?.[skill.id] ?? 0);
}

/** The single steps open to the unit as it stands: walks (when it may still move) and casts (when it may act). */
function openSteps(unit: CombatUnit): AIAction[] {
  const { units, hazards } = useCombatStore.getState();
  const steps: AIAction[] = [];
  // A walk is open until the unit has walked, and after acting only when the cast granted a reposition
  if (!unit.hasMoved && (!unit.hasActed || unit.repositionCap != null)) {
    for (const pos of getMovementRange(unit, units, hazards)) steps.push({ type: 'move', targetPos: pos });
  }
  if (!unit.hasActed) {
    // The kit, and what the fight lends the hero while it is legal (the Dragon's Pass the Heart)
    const kit = [...unit.skills, ...barActions(unit, units)];
    for (const skill of kit.filter((s) => castable(unit, s))) {
      for (const aim of aimsFrom(unit, skill, unit.position, units)) steps.push({ type: 'skill', skill, skillTarget: aim });
    }
  }
  return steps;
}

interface Judged {
  turn: AIAction[];
  /** The board score straight after the turn. */
  score: number;
}

/**
 * Every turn the unit could take from here, each played once and scored where it leaves the board.
 * Called inside a sandbox holding the turn so far (`prefix`); a walk ends a turn, a cast ends it
 * unless it left the unit able to act or to move again.
 */
function expandTurns(unitId: string, prefix: AIAction[], judge: () => number, rng: () => number, deadline: number): Judged[] {
  const unit = unitOf(unitId);
  if (!unit || unit.currentHp <= 0) return [];
  const out: Judged[] = [{ turn: prefix, score: judge() }];
  if (prefix.length >= MAX_STEPS || fightOutcome() !== 'ongoing') return out;
  for (const step of openSteps(unit)) {
    // Out of time, the turns found so far are the ones weighed
    if (Date.now() > deadline && out.length > 1) break;
    try {
      out.push(...inSandbox(() => {
        executeAIActions(unit, [step], SILENT_SINK, { rng });
        const turn = [...prefix, step];
        const after = unitOf(unitId);
        if (step.type === 'skill' && step.skill && refused(unit, after, step.skill)) return [];
        const goesOn = step.type === 'skill' && !!after && after.currentHp > 0
          && (!after.hasActed || (after.repositionCap != null && !after.hasMoved));
        return goesOn ? expandTurns(unitId, turn, judge, rng, deadline) : [{ turn, score: judge() }];
      }));
    } catch {
      // A turn the rules refuse to play is not a turn
    }
  }
  return out;
}

// ─── The team plan and the board score ───────────────────────────────────────

interface Plan {
  side: boolean;
  allies: CombatUnit[];
  foes: CombatUnit[];
  role: (u: CombatUnit) => PartyRole;
  /** Expected damage foes could land on each hex next turn. */
  danger: Map<string, number>;
  /** Each foe's hardest expected blow on the deciding side, for control and danger. */
  threat: Map<string, number>;
  tankEngaged: boolean;
}

const roleCache = new WeakMap<CombatUnit['skills'], PartyRole>();
function cachedRole(u: CombatUnit): PartyRole {
  let role = roleCache.get(u.skills);
  if (!role) { role = roleOf(u); roleCache.set(u.skills, role); }
  return role;
}

/** How far a unit strikes next turn: its longest damaging reach, plus a walk for a monster that walks and strikes. */
function strikeReach(u: CombatUnit): number {
  const reach = Math.max(-1, ...u.skills.filter(damaging).map((s) => s.range + (s.aoeRadius ?? 0)));
  return reach < 0 ? -1 : reach + (movesOrActs(u) ? 0 : (u.stats.moveRange ?? 0));
}

function planOf(units: CombatUnit[], side: boolean): Plan {
  const allies = units.filter((u) => alive(u) && u.isPlayer === side);
  const foes = units.filter((u) => alive(u) && u.isPlayer !== side);
  const threat = new Map<string, number>();
  for (const foe of foes) {
    let worst = 0;
    for (const skill of foe.skills.filter(damaging)) {
      for (const ally of allies) worst = Math.max(worst, expectedDamage(foe, ally, skill, 'front', units));
    }
    threat.set(foe.id, worst);
  }
  const danger = new Map<string, number>();
  const tiles = new Set<string>();
  const hexes: HexCoord[] = [];
  for (const u of allies) if (!tiles.has(hexKey(u.position))) { tiles.add(hexKey(u.position)); hexes.push(u.position); }
  for (const hex of hexes) {
    let sum = 0;
    for (const foe of foes) if (hexDistance(foe.position, hex) <= strikeReach(foe)) sum += threat.get(foe.id) ?? 0;
    danger.set(hexKey(hex), sum);
  }
  const tankEngaged = allies.some((a) => cachedRole(a) === 'tank' && foes.some((f) => hexDistance(f.position, a.position) <= 1));
  return { side, allies, foes, role: cachedRole, danger, threat, tankEngaged };
}

const nearestFoe = (plan: Plan, at: HexCoord) => Math.min(99, ...plan.foes.map((f) => hexDistance(f.position, at)));

interface Snapshot {
  eff: Map<string, number>;
  max: Map<string, number>;
  share: Map<string, number>;
  controlled: Set<string>;
}

function snapshot(units: CombatUnit[]): Snapshot {
  const snap: Snapshot = { eff: new Map(), max: new Map(), share: new Map(), controlled: new Set() };
  for (const u of units) {
    snap.eff.set(u.id, effectiveHp(u));
    snap.max.set(u.id, Math.max(1, combatMaxHp(u)));
    snap.share.set(u.id, Math.max(0, u.currentHp) / Math.max(1, combatMaxHp(u)));
    if (CONTROL.some((c) => hasEffect(u, c as AfflictionType))) snap.controlled.add(u.id);
  }
  return snap;
}

interface Weights {
  danger: number;
  focus: number;
}

/**
 * The board as the deciding side sees it, against `before`. In shares of a side's maximum health,
 * so a hit, a kill and a bad place to stand weigh against each other in one unit.
 */
function boardScore(deciderId: string, side: boolean, before: Snapshot, w: Weights): number {
  const units = useCombatStore.getState().units;
  const plan = planOf(units, side);
  let allyMax = 0, foeMax = 0;
  for (const u of units) {
    if (u.objective || !before.max.has(u.id)) continue;
    if (u.isPlayer === side) allyMax += before.max.get(u.id)!; else foeMax += before.max.get(u.id)!;
  }
  allyMax = Math.max(1, allyMax);
  foeMax = Math.max(1, foeMax);

  let score = 0;
  for (const u of units) {
    if (!before.eff.has(u.id)) continue;
    const lost = before.eff.get(u.id)! - effectiveHp(u);
    const died = before.eff.get(u.id)! > 0 && u.currentHp <= 0;
    if (u.objective) {
      // What the foes' objectives shield or feed (the Heart's anchors, a crystal) is worth breaking, by its own health
      if (u.isPlayer !== side) score += W.OBJECTIVE * (lost / before.max.get(u.id)!) + (died ? W.KILL : 0);
      continue;
    }
    if (u.isPlayer === side) {
      score -= lost / allyMax;
      if (died) score -= W.DEATH;
    } else {
      // A wounded foe's health is worth more: finishing one beats spreading the same damage
      score += (lost / foeMax) * (1 + w.focus * (1 - (before.share.get(u.id) ?? 1)));
      if (died) score += W.KILL;
      if (u.currentHp > 0 && !before.controlled.has(u.id) && CONTROL.some((c) => hasEffect(u, c as AfflictionType))) {
        score += W.CONTROL * Math.min(1, (plan.threat.get(u.id) ?? 0) / allyMax);
      }
    }
  }

  // Where the side stands: the danger on each ally's hex, a tank minding it least
  for (const ally of plan.allies) {
    const exposed = Math.min(ally.currentHp, plan.danger.get(hexKey(ally.position)) ?? 0) / allyMax;
    score -= w.danger * W.DANGER[plan.role(ally)] * exposed;
  }

  // A warned attack that names an ally lands on it unless the turn took it out or broke the warning
  const { preparedAttacks } = useCombatStore.getState();
  if (preparedAttacks.length) {
    for (const ally of plan.allies) {
      if (preparedAttacks.some((p) => threatensUnit(p, ally, units))) score -= w.danger * W.WARNED;
    }
  }

  // A carried Heart on an ally the next burn and the Claw could fell bursts at once where they fall
  for (const attack of preparedAttacks) {
    const carrier = plan.allies.find((a) => a.id === carrierOf(attack));
    const dragon = carrier && units.find((u) => u.id === attack.casterId && u.currentHp > 0);
    if (!carrier || !dragon) continue;
    const claw = clawOnCarrier(dragon, dragonClaw, carrier, units) ? expectedDamage(dragon, carrier, dragonClaw, 'front', units) : 0;
    if (nextHeartBurn(dragon, carrier, units) + claw >= effectiveHp(carrier)) score -= W.CARRIER_FALLS;
  }

  // The decider's own place, by role
  const me = units.find((u) => u.id === deciderId);
  if (me && me.currentHp > 0 && plan.foes.length) score += placeScore(me, plan, units, foeMax);
  return score;
}

function placeScore(me: CombatUnit, plan: Plan, units: CombatUnit[], foeMax: number): number {
  const role = plan.role(me);
  const near = nearestFoe(plan, me.position);
  const others = plan.allies.filter((a) => a.id !== me.id);
  const tanks = others.filter((a) => plan.role(a) === 'tank');
  // What it could strike next turn from here, without walking (a hero moves or acts)
  let next = 0;
  for (const skill of me.skills.filter(damaging)) {
    if (role === 'ranged' && skill.range < 3) continue;
    for (const foe of plan.foes) {
      if (hexDistance(me.position, foe.position) <= skill.range) next = Math.max(next, expectedDamage(me, foe, skill, 'front', units));
    }
  }
  let score = W.OPPORTUNITY * (next / foeMax);
  // Closing in matters when nothing is in reach yet: a step toward the nearest foe is worth a little
  if (next === 0) score -= W.APPROACH * Math.max(0, near - 1);
  switch (role) {
    case 'tank':
      // In front: no other ally closer to the enemy than the tank
      if (others.every((a) => nearestFoe(plan, a.position) >= near)) score += W.TANK_FRONT;
      break;
    case 'melee':
      // Ahead of an unengaged tank is where a melee hero gets caught
      if (!plan.tankEngaged && tanks.some((t) => nearestFoe(plan, t.position) > near)) score -= W.MELEE_EXPOSED;
      break;
    case 'ranged':
      if (near < 3) score -= W.RANGED_CLOSE * (3 - near);
      break;
    case 'healer': {
      const range = Math.max(0, ...me.skills.filter(healsOthers).map((s) => s.range));
      const covered = others.filter((a) => hexDistance(a.position, me.position) <= range).length;
      score += W.HEALER_REACH * (others.length ? covered / others.length : 1);
      // Nobody between the healer and the enemy
      if (others.length && others.every((a) => nearestFoe(plan, a.position) >= near)) score -= W.HEALER_FRONT;
      break;
    }
  }
  return score;
}

// ─── Deciding ────────────────────────────────────────────────────────────────

/** Plays the fight on from the turn just taken until the decider has taken `ownTurns` more, everyone on the ordinary brain. */
function playOn(deciderId: string, ownTurns: number, rng: () => number): void {
  let own = 0;
  for (let i = 0; own < ownTurns && i < MAX_REHEARSED_TURNS && fightOutcome() === 'ongoing'; i++) {
    useCombatStore.getState().nextTurn();
    const current = useCombatStore.getState().getCurrentUnit();
    if (!current) break;
    const started = beginTurn(current.id, SILENT_SINK);
    if (started.kind === 'inert' && started.deadlocked) break;
    if (current.id === deciderId) own++;
    if (started.kind !== 'act') continue;
    const units = useCombatStore.getState().units;
    executeAIActions(current, decideEnemyAction(current, units), SILENT_SINK, { rng });
  }
}

/** One label for a turn, for the harness's AI trace: `→` is a walk, `·` a hold, `+` joins steps. */
function describe(turn: AIAction[]): { skillId: string; skillName: string; targetPos?: HexCoord } {
  if (turn.length === 0) return { skillId: 'hold', skillName: '·' };
  const cast = turn.find((a) => a.type === 'skill' && a.skill);
  return {
    skillId: cast?.skill?.id ?? 'move',
    skillName: turn.map((a) => (a.type === 'skill' && a.skill ? skillName(a.skill) : '→')).join(' + '),
    targetPos: cast?.skillTarget,
  };
}

export function decideTactically(unit: CombatUnit, level: TacticalLevel, options: TacticalOptions = {}): TacticalDecision {
  const started = Date.now();
  const rng = options.rng ?? Math.random;
  const budget = W.LEVELS[level];
  // Easy sometimes forgets where the danger is; it never focuses
  const weights: Weights = {
    danger: rng() < budget.ignoreDanger ? 0 : 1,
    focus: budget.focus,
  };
  const live = useCombatStore.getState();
  const self = live.units.find((u) => u.id === unit.id) ?? unit;
  const before = snapshot(live.units);
  const judge = () => boardScore(self.id, self.isPlayer, before, weights);

  // One deadline over the whole decision: listing the turns (a chain of free casts multiplies them)
  // and playing the best on
  const deadline = started + (options.maxMs ?? W.MAX_MS);
  const judged = expandTurns(self.id, [], judge, rng, deadline);
  judged.sort((a, b) => b.score - a.score);

  // The best few, played on through the decider's next turns and scored again where they end
  const finalists: Judged[] = [];
  if (budget.ownTurns > 0) {
    for (const j of judged.slice(0, budget.shortlist)) {
      if (finalists.length > 0 && Date.now() > deadline) break;
      let total = 0, n = 0;
      for (let k = 0; k < budget.scenarios; k++) {
        if (n > 0 && Date.now() > deadline) break;
        try {
          total += inSandbox(() => {
            executeAIActions(self, j.turn, SILENT_SINK, { rng });
            playOn(self.id, budget.ownTurns, rng);
            return judge();
          });
          n++;
        } catch {
          // A future the rules refuse to play counts for nothing
        }
      }
      finalists.push({ turn: j.turn, score: n ? total / n : -Infinity });
    }
    finalists.sort((a, b) => b.score - a.score);
  }
  const ranked = finalists.length ? finalists : judged;

  // The mistakes a weaker player makes: now and then the second or third best
  let pick = 0;
  if (ranked.length > 1 && rng() < budget.slip) pick = 1 + Math.floor(rng() * Math.min(2, ranked.length - 1));
  const chosen = ranked[pick]?.turn ?? [];

  if (options.onTrace) {
    const considered: AIConsideration[] = ranked.slice(0, 8)
      .map((r) => ({ ...describe(r.turn), value: Math.round(r.score * 1000) / 10 }));
    options.onTrace({
      unitId: unit.id, unitName: unit.name, considered,
      // Symbols and counts only: the trace is the harness's, and its words would need the catalogs
      chose: `${describe(chosen).skillName} · ${cachedRole(self)} · ${finalists.length}/${judged.length}`,
      choseSkillId: describe(chosen).skillId,
    });
  }
  return { actions: chosen, candidates: judged.length, lookedAhead: finalists.length, ms: Date.now() - started };
}
