import { AfflictionType, AuraType, CombatUnit, HeroSkill, HexCoord, PreparedAttack, SkillTargetType } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { AIAction, decideEnemyAction } from '@/systems/combat/enemyAI';
import { getMovementRange } from '@/systems/combat/movement';
import { isShieldingBody, landingPlan, statusInterrupts } from '@/systems/combat/preparedAttacks';
import { canUseSkill } from '@/systems/combat/cooldowns';
import { BALANCE } from '@/data/balanceConstants';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { calculateDamage, calculateHealing } from '@/systems/combat/damageCalc';
import { combatMaxHp } from '@/systems/combat/forms';
import { getSkillTargets, getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { skillTargetKind } from '@/systems/combat/targetKind';
import { hasEffect, isAffliction, isCleansable, skillEffects } from '@/systems/combat/statusEffects';
import { activeTaunt } from '@/systems/combat/taunt';
import { skillsForForm } from '@/systems/combat/wildshape';
import { aethelredTwist, STANDARD_KIND, standardsOf } from '@/systems/combat/bossScript';
import { ANCHOR_KIND, SPIRE_KIND } from '@/systems/combat/heartScript';
import { answerOf, cancellingObjectives } from '@/systems/combat/warnedAnswers';
import type { WarnedAnswer } from '@/models/types';
import { respondingPolicy, warnedFor } from '@/systems/sim/emperorMeasure';
import { trollFort, trollStand } from './trollAnswers';
import { crystalWorthBreaking, heartPotato } from './heartAnswers';
import { cutTheWeb, shedTaint, withoutTheRepeat } from './jadeveilAnswers';
import { THREAD_KIND } from '@/systems/combat/yokaiKits';
import { PartyRole, roleOf, tauntsOthers } from '@/systems/combat/roles';

export { roleOf };
export type { PartyRole };
import { hexDistance, hexKey } from '@/utils/hexUtils';

/**
 * The party a sensible player fields, for the balance simulator only.
 *
 * The plain brain (`decideEnemyAction`) scores damage and nothing else: it never casts a single-target
 * heal, never answers a boss's warning, and a hero whose only way to hurt the boss is a short-range
 * strike can stand three hexes off forever. Enemies are built for that brain, so it stays as it is in
 * the game; this wrapper is what only the simulator's heroes get. It is basic tactics, not a model of
 * an expert: break the warning a Stun, Silence, Freeze or Taunt can break, break the objective a
 * warning is tied to, heal and shield whoever needs it, taunt to take the boss off the others, and
 * walk to where the best strike reaches.
 *
 * A warning is answered by what it says its answers are (`warnedAnswers.answersOf`), never by its id, so
 * each branch below is one kind of answer and a policy chooses among them. Order of a hero's turn: take a
 * shape (Wildshape) → break a warning (the interrupt first) → the Dragon's carried Heart, passed before its
 * carrier falls or the burst lands on the wrong hero (`pass`, `heartAnswers`) → sprawl the caster or shelter on
 * the hazard when no interrupt is ready (`sprawl`) → break what a warning is tied to (`cancel`) → stand on the ground an objective shelters (melee and tanks,
 * `shelter`) → give the block, cleanse a chain, pay a seal, shield a crown point or hold the ground (`block`, `cleanse`,
 * `toll`, `hold`) → Jadeveil's own (shed Taint on a Jade Shard, cut a web: `jadeveilAnswers`) → stand in the
 * Troll's warning where that is an answer (`trollStand`: `share`, `brace`) → step out of a footprint
 * (`respondingPolicy`) → support → taunt → the Troll's fort (`trollFort`: bait the Prey onto rubble, take
 * cover, fight from the side away from the heaps) → the plain brain's strike on the objective that matters
 * → walk into reach.
 */

const isHero = (u: CombatUnit) => u.isPlayer && !u.objective && !u.summonedBy && u.currentHp > 0;
const wholeParty = (unit: CombatUnit, units: CombatUnit[]) =>
  units.filter((u) => u.isPlayer === unit.isPlayer && u.currentHp > 0 && !u.objective);
const foesOf = (unit: CombatUnit, units: CombatUnit[]) =>
  units.filter((u) => u.isPlayer !== unit.isPlayer && u.currentHp > 0);
const missingShare = (u: CombatUnit) => 1 - Math.max(0, u.currentHp) / Math.max(1, combatMaxHp(u));
const strikes = (skill: HeroSkill) => !!skill.damage && skill.targetType !== SkillTargetType.Self;

const hazardsNow = () => useCombatStore.getState().hazards;
const skillAction = (skill: HeroSkill, at: HexCoord): AIAction[] => [{ type: 'skill', skill, skillTarget: at }];

// ─── Taking a shape ──────────────────────────────────────────────────────────

/** How close a target must be before Apex is worth entering: the Antler Charge dashes four, then strikes. */
const APEX_OPENS_WITHIN = 5;

/**
 * A Wildshape hero never fights upright: it takes a shape the first turn it can, and again whenever it
 * is out of one. The Apex shape comes first when the hero has it and a target is within a charge; then
 * the bear if nobody else in the party taunts (Maul and Roar are taunts, and a bear has the body for them);
 * then the wolf, the hawk. The plain brain never casts a shift, which deals and heals nothing, so
 * without this the Wildshape path is only ever a druid who cannot heal.
 */
function takeShape(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  if (unit.wildForm) return null;
  const shifts = unit.skills.filter((s) => s.shiftsTo && canUseSkill(unit, s));
  if (shifts.length === 0) return null;
  const covered = wholeParty(unit, units).some((a) => a.id !== unit.id && a.skills.some(tauntsOthers));
  // Apex is a three-turn burst that ends in the upright shape, and its dash is four hexes: it is for a
  // fight that is within a charge of the hero, not for the walk in
  const near = focusUnits(unit, units).some((u) => u.isPlayer !== unit.isPlayer && u.currentHp > 0 && hexDistance(u.position, unit.position) <= APEX_OPENS_WITHIN);
  const order = covered ? ['wolf', 'hawk', 'bear'] : ['bear', 'wolf', 'hawk'];
  const pick = [...(near ? ['apex'] : []), ...order].map((form) => shifts.find((s) => s.shiftsTo === form)).find(Boolean);
  if (!pick) return null;
  const shift = skillAction(pick, unit.position);
  if (pick.shiftsTo !== 'apex') return shift;
  // Entering Apex is free and the shape lasts three turns counting this one: strike this turn with its kit
  const apex = { ...unit, skills: skillsForForm('apex', unit.skills, unit.masteryModifiers) };
  const follow = decideEnemyAction(apex, focusUnits(unit, units)).filter((a) => a.type !== 'endturn');
  return [...shift, ...follow];
}

// ─── 1. Answering a warning ───────────────────────────────────────────────────

/** The warnings an enemy has open, and the skills of this hero that break one. */
function answerWarning(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  const store = useCombatStore.getState();
  for (const attack of store.preparedAttacks) {
    const caster = units.find((u) => u.id === attack.casterId);
    if (!caster || caster.isPlayer === unit.isPlayer || caster.currentHp <= 0) continue;
    const breakers = unit.skills.filter(
      (s) => canUseSkill(unit, s) &&
        skillEffects(s).some((e) => !e.selfOnly && statusInterrupts(attack, e.type)),
    );
    for (const skill of breakers) {
      const aims = getValidSkillTargetHexes(skill, unit, units, hazardsNow());
      if (aims.some((h) => hexKey(h) === hexKey(caster.position))) return skillAction(skill, caster.position);
    }
    // Out of reach of its own answer: close in, so the next turn (or the next hero's) can land it
    if (breakers.length > 0) {
      const reach = Math.max(...breakers.map((s) => s.range));
      const closer = getMovementRange(unit, units, hazardsNow())
        .filter((h) => hexDistance(h, caster.position) <= reach)
        .sort((a, b) => hexDistance(a, unit.position) - hexDistance(b, unit.position))[0];
      if (closer) return [{ type: 'move', targetPos: closer }, { type: 'endturn' }];
    }
  }
  return null;
}

// ─── 1b. Sprawling the caster, sheltering on the hazard ──────────────────────

/** The first open warning of the other side's, with its caster standing, that has an answer of `kind`. */
function openWith<K extends WarnedAnswer['kind']>(
  unit: CombatUnit,
  units: CombatUnit[],
  kind: K,
  where?: (answer: Extract<WarnedAnswer, { kind: K }>) => boolean,
): { attack: PreparedAttack; answer: Extract<WarnedAnswer, { kind: K }> } | undefined {
  for (const attack of useCombatStore.getState().preparedAttacks) {
    const caster = units.find((u) => u.id === attack.casterId);
    if (!caster || caster.isPlayer === unit.isPlayer || caster.currentHp <= 0) continue;
    const answer = answerOf(attack, kind, where);
    if (answer) return { attack, answer };
  }
  return undefined;
}

/** Whether any hero of the party holds a skill, off cooldown, that breaks this warning. */
const partyCanBreak = (attack: PreparedAttack, party: CombatUnit[]) =>
  party.some((h) => h.skills.some((s) => canUseSkill(h, s) && skillEffects(s).some((e) => !e.selfOnly && statusInterrupts(attack, e.type))));

/** A turn spent holding the ground a hero stands on: the plain brain's strike if it needs no step, else nothing. */
function holdAndStrike(unit: CombatUnit, units: CombatUnit[]): AIAction[] {
  const base = decideEnemyAction(unit, focusUnits(unit, units));
  return base[0]?.type === 'skill' ? base : [{ type: 'endturn' }];
}

/** A hero below this share of its health does not take the landing blow on purpose. */
const SPRAWL_MIN_HEALTH = 0.6;

/**
 * A warning that can be sprawled (Skyfire) with no interrupt in the party's hands (the interrupt, when there
 * is one, is `answerWarning`'s and comes first): **walk into fire**. The sturdiest hero, if it is healthy,
 * goes into the landing mark and sprawls him (Exposed, his fire cooled), on a hex of the sheltering hazard
 * (the burning Cinder Rift) when one lies there, since the flame then passes over it; every other hero steps
 * onto that hazard (the trench) when it can reach it, and takes the flame where it stands when it cannot.
 * The Rift is entered at the price of its crossing fire.
 */
function sprawlOrShelter(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  const open = openWith(unit, units, 'sprawl');
  if (!open) return null;
  const { attack } = open;
  const party = wholeParty(unit, units).filter(isHero);
  if (partyCanBreak(attack, party)) return null;

  const onHazard = answerOf(attack, 'shelter', (a) => !!a.onHazard)?.onHazard;
  const rift = new Set(hazardsNow().filter((h) => !!onHazard && h.label === onHazard).flatMap((h) => h.hexes.map(hexKey)));
  const mark = new Set((attack.landing ?? []).map(hexKey));
  const reach = [unit.position, ...getMovementRange(unit, units, hazardsNow())];
  const nearest = (a: HexCoord, b: HexCoord) => hexDistance(a, unit.position) - hexDistance(b, unit.position) || a.q - b.q || a.r - b.r;

  const sprawler = [...party].sort((a, b) => b.currentHp - a.currentHp || (a.id < b.id ? -1 : 1))[0];
  if (sprawler?.id === unit.id && mark.size > 0 && missingShare(unit) <= 1 - SPRAWL_MIN_HEALTH) {
    const into = reach.filter((h) => mark.has(hexKey(h)))
      .sort((a, b) => Number(rift.has(hexKey(b))) - Number(rift.has(hexKey(a))) || nearest(a, b))[0];
    if (into) {
      return hexKey(into) === hexKey(unit.position) ? holdAndStrike(unit, units) : [{ type: 'move', targetPos: into }, { type: 'endturn' }];
    }
  }

  if (rift.size > 0) {
    if (rift.has(hexKey(unit.position))) return holdAndStrike(unit, units);
    const trench = reach.filter((h) => rift.has(hexKey(h))).sort((a, b) =>
      Number(mark.has(hexKey(a))) - Number(mark.has(hexKey(b))) || nearest(a, b))[0];
    if (trench) return [{ type: 'move', targetPos: trench }, { type: 'endturn' }];
  }
  return null;
}

/**
 * A warning is up that spares the ground beside a standing objective (Creeping Winter, beside an anchor):
 * **a melee hero or a tank stands there** (the anchors are what it strikes anyway), a ranged hero or a healer
 * keeps its distance and steps out of the footprint like any other warning. On the ring already, it holds
 * and strikes.
 */
function standBesideObjective(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  const attack = openWith(unit, units, 'shelter', (a) => !!a.besideObjective)?.attack;
  const ring = new Set((attack?.sheltered ?? []).map(hexKey));
  if (!attack || ring.size === 0) return null;
  const role = roleOf(unit);
  if (role === 'ranged' || role === 'healer') return null;
  if (ring.has(hexKey(unit.position))) return holdAndStrike(unit, units);
  const spot = getMovementRange(unit, units, hazardsNow())
    .filter((h) => ring.has(hexKey(h)))
    .sort((a, b) => hexDistance(a, unit.position) - hexDistance(b, unit.position) || a.q - b.q || a.r - b.r)[0];
  return spot ? [{ type: 'move', targetPos: spot }, { type: 'endturn' }] : null;
}

/**
 * While a warning that destroying something cancels is open (`cancel`: the Furnace Heart's crystal,
 * the spires of Whiteout Convergence, the anchor Icebound Reprisal strains against), **a hero standing clear
 * of it strikes what it is tied to**, and only that: a round's damage goes into the anchor the chain is bound
 * to, not into whichever anchor is nearest, because the chain snaps as hard as that anchor is whole. Of two
 * anchors bound to one warning it strikes the weaker, to break one line rather than chip both.
 */
function breakBound(unit: CombatUnit, units: CombatUnit[]): { kinds: string[]; actions: AIAction[] } | null {
  // From a hex the warning covers the better turn is to leave it: the objective is rarely cleared in one round
  if (warnedFor(unit, units).has(hexKey(unit.position))) return null;
  const tied = useCombatStore.getState().preparedAttacks
    .filter((p) => {
      const caster = units.find((u) => u.id === p.casterId);
      return !!caster && caster.isPlayer !== unit.isPlayer;
    })
    .flatMap((p) => cancellingObjectives(p, units));
  if (tied.length === 0) return null;
  // A warning shared by two (the Heart's Reprisal from tier 3): one line broken is worth more than two
  // chipped, so every blow goes to the weaker anchor, then the lower id
  const shared = tied.filter((u) => u.objective?.boundHexes)
    .sort((a, b) => a.currentHp - b.currentHp || (a.id < b.id ? -1 : 1));
  const struck = shared.length > 1 ? tied.filter((u) => !u.objective?.boundHexes || u === shared[0]) : tied;
  const view = units.filter((u) => u.isPlayer === unit.isPlayer || struck.includes(u));
  const actions = decideEnemyAction(unit, view);
  if (!actions.some((a) => a.type === 'skill')) return null;
  // A crystal riding on a hero (the Furnace Heart, about a seventh of his health) is struck by whoever can
  // reach it from where they stand, and only while those heroes could break it before it bursts; nobody
  // walks the round away to it
  if (tied.every((u) => u.objective?.carrierId)
    && (actions.some((a) => a.type === 'move') || !tied.some((u) => crystalWorthBreaking(u, units)))) return null;
  return { kinds: [...new Set(tied.map((u) => u.objective!.kind))], actions };
}

// ─── 2b. Aethelred's answers: the block, the toll and the held ground ─────────

/** The strike the plain brain would make from where the hero stands, or null when it would not strike. */
function strikeInPlace(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  const base = decideEnemyAction(unit, focusUnits(unit, units));
  return base.some((a) => a.type === 'skill') ? base : null;
}

/**
 * The Imperial Cleave's block. A hero in the wedge holding a Barrier stops the blade, so the party puts
 * one on the healthiest hero in the wedge before the landing (a support's turn); once one holds, the others
 * in the wedge are spared and strike instead of stepping out.
 */
function blockTheBlade(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  const attack = openWith(unit, units, 'block')?.attack;
  // A crown point held behind a shield spares nobody else: that is `shieldTheCrown`, not this
  if (!attack?.spec.blockedBy) return null;
  const inWedge = units.filter((u) => isHero(u) && u.isPlayer === unit.isPlayer && attack.hexes.some((h) => hexKey(h) === hexKey(u.position)));
  if (inWedge.length === 0) return null;

  const plan = landingPlan(attack, units, hazardsNow());
  if (plan.blocked) return inWedge.some((u) => u.id === unit.id) ? strikeInPlace(unit, units) : null;

  const wedge = [...inWedge].sort((a, b) => b.currentHp / combatMaxHp(b) - a.currentHp / combatMaxHp(a) || (a.id < b.id ? -1 : 1));
  return guardOneOf(unit, units, wedge);
}

/** A Barrier skill of this hero's that deals nothing, off cooldown. */
const guardSkills = (unit: CombatUnit) => unit.skills.filter(
  (s) => canUseSkill(unit, s) && skillEffects(s).some((e) => e.type === AuraType.Barrier) && !s.damage,
);

/** Casts this hero's Barrier on the first of `allies` it can reach (a self-only Barrier only on itself). */
function guardOneOf(unit: CombatUnit, units: CombatUnit[], allies: readonly CombatUnit[]): AIAction[] | null {
  for (const skill of guardSkills(unit)) {
    for (const ally of allies) {
      if (skill.targetType === SkillTargetType.Self ? ally.id !== unit.id : false) continue;
      const aims = getValidSkillTargetHexes(skill, unit, units, hazardsNow());
      const aim = skill.targetType === SkillTargetType.Self ? unit.position : ally.position;
      if (skill.targetType === SkillTargetType.Self || aims.some((h) => hexKey(h) === hexKey(aim))) return skillAction(skill, aim);
    }
  }
  return null;
}

/**
 * Chains of Tribute after the throw: **a hero who can cleanse breaks the chain** when one end is in reach. The pair
 * regrouping is the other answer, and is `respondingPolicy`'s, for a party with no cleanse in reach.
 */
function cleanseTheChain(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  if (!openWith(unit, units, 'cleanse')) return null;
  const chained = units.filter((u) => isHero(u) && u.isPlayer === unit.isPlayer && hasEffect(u, AfflictionType.Chained));
  if (chained.length === 0) return null;
  for (const skill of unit.skills) {
    if (!skill.cleanse || !canUseSkill(unit, skill)) continue;
    if (skill.targetType === SkillTargetType.Self) {
      if (chained.some((u) => u.id === unit.id)) return skillAction(skill, unit.position);
      continue;
    }
    const aims = new Set(getValidSkillTargetHexes(skill, unit, units, hazardsNow()).map(hexKey));
    const end = chained.find((u) => aims.has(hexKey(u.position)));
    if (end) return skillAction(skill, end.position);
  }
  return null;
}

/**
 * Foreclosure's toll, from the hero's own seal. A hero weighs what the turn is worth against the hit:
 *
 * - a healer with someone to mend casts the heal from the seal (it pays in blood and the eruption still
 *   lands) while there is health to spare, and otherwise steps off;
 * - a class skill that hits at least twice as hard as the basic attack is cast while the hero would still
 *   stand well above half their health after the toll and the eruption;
 * - otherwise a basic attack that reaches him pays the seal for nothing;
 * - a hero who can do none of that steps off, and the orb takes a charge.
 */
function payTheSeal(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  const attack = openWith(unit, units, 'toll')?.attack;
  if (!attack?.bound || !attack.centres) return null;
  const index = attack.bound.indexOf(unit.id);
  if (index < 0 || hexKey(attack.centres[index]) !== hexKey(unit.position)) return null;
  if (attack.tolls?.some((toll) => toll.unitId === unit.id)) return null;
  const boss = units.find((u) => u.id === attack.casterId);
  if (!boss) return null;
  const reaches = (skill: HeroSkill) =>
    getValidSkillTargetHexes(skill, unit, units, hazardsNow()).some((h) => hexKey(h) === hexKey(boss.position));

  const max = combatMaxHp(unit);
  const toll = Math.round(max * BALANCE.AETHELRED_TOLL_HP);
  const hit = calculateDamage(boss, unit, attack.skill, 'front', units);
  const spare = (share: number) => unit.currentHp - toll - hit > share * max;

  const care = support(unit, units);
  if (care?.some((a) => a.type === 'skill')) return spare(0.4) ? care : null;

  const basic = unit.skills.find((s) => s.id === BASIC_ATTACK_ID && canUseSkill(unit, s) && reaches(s));
  const basicDamage = basic ? calculateDamage(unit, boss, basic, 'front', units) : 0;
  const cast = unit.skills
    .filter((s) => s.id !== BASIC_ATTACK_ID && strikes(s) && canUseSkill(unit, s) && reaches(s))
    .map((s) => ({ skill: s, damage: calculateDamage(unit, boss, s, 'front', units) }))
    .sort((a, b) => b.damage - a.damage)[0];
  if (cast && cast.damage >= 2 * basicDamage && spare(basic ? 0.5 : 0.25)) return skillAction(cast.skill, boss.position);
  return basic ? skillAction(basic, boss.position) : null;
}

/**
 * Holding outer ground against a warning that ruins what it falls on empty (`hold`: Crownfall). A crown point
 * that falls on empty ground leaves black glass, so a party that dodges every point gives up the outer arena. The healthiest hero in the crown who would still be
 * well above a third of their health after the point stays and strikes; everyone else steps in. One body is
 * enough to keep its hex and a way to it open (`glassHexes`).
 */
function holdOuterGround(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  const attack = openWith(unit, units, 'hold')?.attack;
  if (!attack || !attack.hexes.some((h) => hexKey(h) === hexKey(unit.position))) return null;
  const boss = units.find((u) => u.id === attack.casterId);
  if (!boss) return null;
  const holder = crownHolder(attack, unit, units);
  const shielded = !!attack.spec.heldBy && isShieldingBody(unit);
  if (holder?.id !== unit.id && !shielded) return null;
  if (!standsAfterPoint(attack, unit, boss, units, shielded)) return null;
  // Held behind a shield the hex is the answer, in reach of him or not
  if (shielded) return holdAndStrike(unit, units);
  // The holder a Barrier is on its way to stays for it, while a hero who can cast it stands
  const guarded = !!attack.spec.heldBy && wholeParty(unit, units).some((a) => guardSkills(a).length > 0);
  if (guarded && standsAfterPoint(attack, unit, boss, units, true)) return holdAndStrike(unit, units);
  return strikeInPlace(unit, units);
}

/** What a hero can take: health and any Barrier standing on them. */
const worthOf = (u: CombatUnit) =>
  u.currentHp + u.activeEffects.filter((e) => e.type === AuraType.Barrier).reduce((sum, e) => sum + e.magnitude, 0);

/** The hero best fit to stay on outer ground: the healthiest in the crown, by share. */
function crownHolder(attack: PreparedAttack, unit: CombatUnit, units: CombatUnit[]): CombatUnit | undefined {
  const share = (u: CombatUnit) => worthOf(u) / combatMaxHp(u);
  const outer = units.filter((u) => isHero(u) && u.isPlayer === unit.isPlayer && attack.hexes.some((h) => hexKey(h) === hexKey(u.position)));
  return [...outer].sort((a, b) => share(b) - share(a) || (a.id < b.id ? -1 : 1))[0];
}

/** Whether the hero would stand well above a third of their health after the point, whole or at the held share. */
function standsAfterPoint(attack: PreparedAttack, unit: CombatUnit, boss: CombatUnit, units: CombatUnit[], held: boolean): boolean {
  const hit = calculateDamage(boss, unit, attack.skill, 'front', units) * (held ? attack.spec.heldBy?.share ?? 1 : 1);
  return worthOf(unit) - hit > combatMaxHp(unit) / 3;
}

/**
 * Crownfall's block (`PreparedSpec.heldBy`): **a hero who can cast a Barrier puts it on the hero who will hold a
 * crown point**, the healthiest in the crown, when the Barrier makes the difference or that hero means to stay.
 */
function shieldTheCrown(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  const attack = openWith(unit, units, 'hold')?.attack;
  if (!attack?.spec.heldBy || guardSkills(unit).length === 0) return null;
  const boss = units.find((u) => u.id === attack.casterId);
  const holder = crownHolder(attack, unit, units);
  if (!boss || !holder || isShieldingBody(holder)) return null;
  return standsAfterPoint(attack, holder, boss, units, true) ? guardOneOf(unit, units, [holder]) : null;
}

/** The block, the toll, the cleanse and the held ground: answers that are neither a step nor a break (Aethelred's). */
function aethelredAnswers(unit: CombatUnit, units: CombatUnit[]): { branch: string; actions: AIAction[] } | null {
  const blocked = blockTheBlade(unit, units);
  if (blocked) return { branch: 'blocks the blade', actions: blocked };
  const cleansed = cleanseTheChain(unit, units);
  if (cleansed) return { branch: 'cleanses the chain', actions: cleansed };
  const paid = payTheSeal(unit, units);
  if (paid) return { branch: 'pays the seal', actions: paid };
  const crowned = shieldTheCrown(unit, units);
  if (crowned) return { branch: 'shields the crown point', actions: crowned };
  const held = holdOuterGround(unit, units);
  if (held) return { branch: 'holds the outer ground', actions: held };
  return null;
}

// ─── 3. Support ───────────────────────────────────────────────────────────────

/** Heal the wounded, shield and bless whoever is under fire, cleanse what can be cleansed. */
function support(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  const party = wholeParty(unit, units);
  const foes = foesOf(unit, units).filter((f) => !f.objective);
  const warned = (ally: CombatUnit) =>
    useCombatStore.getState().preparedAttacks.some((p) => {
      const c = units.find((u) => u.id === p.casterId);
      return !!c && c.isPlayer !== unit.isPlayer && p.hexes.some((h) => hexKey(h) === hexKey(ally.position));
    });
  const pressed = (ally: CombatUnit) => warned(ally) || foes.some((f) => hexDistance(f.position, ally.position) <= 2);

  let best: { skill: HeroSkill; at: HexCoord; value: number; urgent: boolean } | null = null;
  for (const skill of unit.skills) {
    if (!canUseSkill(unit, skill) || skillTargetKind(skill) !== 'support') continue;
    const auras = skillEffects(skill).filter((e) => !isAffliction(e.type));
    for (const at of getValidSkillTargetHexes(skill, unit, units, hazardsNow())) {
      let value = 0;
      let urgent = false;
      for (const hex of getSkillTargets(skill, unit.position, at, units)) {
        const ally = party.find((u) => hexKey(u.position) === hexKey(hex));
        if (!ally) continue;
        const missing = missingShare(ally) * combatMaxHp(ally);
        if (skill.healing || skill.healingBasis) {
          const useful = Math.min(calculateHealing(unit, skill, ally), missing);
          // A heal that mostly overheals is not worth the turn
          if (useful >= 0.5 * calculateHealing(unit, skill, ally) && useful >= 15) value += useful;
          if (missingShare(ally) >= 0.55) { value += 40; urgent = true; }
        }
        if (skill.cleanse && ally.activeEffects.some((e) => isCleansable(e.type))) value += 30;
        if (auras.length > 0 && !auras.every((e) => hasEffect(ally, e.type))) {
          value += pressed(ally) ? 35 : 0;
          value += missingShare(ally) * 30;
        }
      }
      if (value > 0 && (!best || value > best.value)) best = { skill, at, value, urgent };
    }
  }
  if (best && (best.urgent || best.value >= 30)) return skillAction(best.skill, best.at);

  // Someone is hurt and out of reach of every heal: walk into reach of them
  const healers = unit.skills.filter((s) => canUseSkill(unit, s) && skillTargetKind(s) === 'support' && s.healing && s.range > 0);
  if (healers.length > 0) {
    const hurt = party.filter((a) => a.id !== unit.id && missingShare(a) >= 0.45).sort((a, b) => b.currentHp - a.currentHp)[0];
    const reach = Math.max(...healers.map((s) => s.range));
    if (hurt && hexDistance(unit.position, hurt.position) > reach) {
      const covered = warnedFor(unit, units);
      const closer = getMovementRange(unit, units, hazardsNow())
        .filter((h) => !covered.has(hexKey(h)) && hexDistance(h, hurt.position) <= reach)
        .sort((a, b) => hexDistance(a, unit.position) - hexDistance(b, unit.position))[0];
      if (closer) return [{ type: 'move', targetPos: closer }, { type: 'endturn' }];
    }
  }
  return null;
}

// ─── 4. Taunt ─────────────────────────────────────────────────────────────────

/** A tank takes the boss off the others: taunt it, unless it is already on this hero. */
function taunt(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  const party = wholeParty(unit, units);
  // Nobody to cover: a party of tanks gains nothing from a taunt, and each would only spend a turn on it
  if (!party.some((a) => a.id !== unit.id && roleOf(a) !== 'tank')) return null;
  const boss = foesOf(unit, units).filter((f) => !f.objective).sort((a, b) => b.stats.maxHp - a.stats.maxHp)[0];
  // Held by another hero on this side: leave it. Held by this hero it is renewed as soon as a taunt is ready,
  // because the boss acts more often than the tank does and a taunt of two turns is gone by the tank's next
  const held = boss && activeTaunt(boss, units);
  if (!boss || (held && held.isPlayer === unit.isPlayer && held.id !== unit.id && boss.activeEffects.some((e) => e.type === AfflictionType.Taunt && e.duration > 1))) return null;
  for (const skill of unit.skills) {
    if (!tauntsOthers(skill) || !canUseSkill(unit, skill)) continue;
    const aims = getValidSkillTargetHexes(skill, unit, units, hazardsNow());
    if (aims.some((h) => hexKey(h) === hexKey(boss.position))) return skillAction(skill, boss.position);
  }
  return null;
}

// ─── 5. Which foes the strike goes to, and where to stand ────────────────────

/**
 * Only the objective that matters is a target while one stands: spires, then anchors, then the Jorōgumo's threads
 * (nothing can reach her while she hangs from them), then the rest. The
 * Dragon's carried Heart is not among them: it is struck by whoever reaches it where they stand (`breakBound`),
 * and the rest of the party's blows go to him. The units themselves are the store's; only the choice is narrowed.
 */
function focusUnits(unit: CombatUnit, units: CombatUnit[]): CombatUnit[] {
  const standing = (kind: string) => units.some((u) => !u.isPlayer && u.currentHp > 0 && u.objective?.kind === kind);
  const kind = [SPIRE_KIND, ANCHOR_KIND, THREAD_KIND].find(standing);
  if (!kind) return units.filter((u) => !u.objective?.carrierId && !chippedInVain(u, units));
  return units.filter((u) => u.isPlayer === unit.isPlayer || u.objective?.kind === kind);
}

/**
 * Aethelred's castle tier 2 mends the Standards left standing when one falls, so a blow on any but the weakest is
 * wasted: the party's blows at the banners all go to the weakest (then the lower id), and the others are not targets.
 */
function chippedInVain(target: CombatUnit, units: CombatUnit[]): boolean {
  if (target.objective?.kind !== STANDARD_KIND || target.currentHp <= 0) return false;
  const owner = units.find((u) => u.id === target.objective!.ownerId);
  if (!owner || !aethelredTwist(owner, 'mendingStandards')) return false;
  const [weakest] = standardsOf(owner, units).sort((a, b) => a.currentHp - b.currentHp || (a.id < b.id ? -1 : 1));
  return weakest.id !== target.id;
}

/** A tank stands next to the boss: that is where its taunt, its shield and its blows are worth most. */
function closeInOnBoss(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  const boss = foesOf(unit, units).filter((f) => !f.objective).sort((a, b) => b.stats.maxHp - a.stats.maxHp)[0];
  if (!boss || hexDistance(unit.position, boss.position) <= 1) return null;
  const covered = warnedFor(unit, units);
  const next = getMovementRange(unit, units, hazardsNow())
    .filter((h) => !covered.has(hexKey(h)) && hexDistance(h, boss.position) <= 1)
    .sort((a, b) => hexDistance(a, unit.position) - hexDistance(b, unit.position))[0];
  if (next) return [{ type: 'move', targetPos: next }, { type: 'endturn' }];
  // Not within a turn's walk: as near as one turn gets it
  const nearer = getMovementRange(unit, units, hazardsNow())
    .filter((h) => !covered.has(hexKey(h)))
    .sort((a, b) => hexDistance(a, boss.position) - hexDistance(b, boss.position))[0];
  return nearer && hexDistance(nearer, boss.position) < hexDistance(unit.position, boss.position)
    ? [{ type: 'move', targetPos: nearer }, { type: 'endturn' }]
    : null;
}

/** Walks to where the unit's best strike reaches: close for a brawler, at full range for an archer. */
function walkIntoReach(unit: CombatUnit, units: CombatUnit[], role: PartyRole): AIAction[] | null {
  const foes = foesOf(unit, units);
  const strikers = unit.skills.filter((s) => strikes(s) && canUseSkill(unit, s));
  if (foes.length === 0 || strikers.length === 0) return null;

  const top = Math.max(...strikers.map((s) => s.damage ?? 0));
  const reach = Math.max(...strikers.filter((s) => (s.damage ?? 0) >= 0.6 * top).map((s) => s.range));
  const target = foes.slice().sort((a, b) => hexDistance(unit.position, a.position) - hexDistance(unit.position, b.position))[0];
  const covered = warnedFor(unit, units);
  const standsOff = role === 'ranged' || role === 'healer';

  let options = getMovementRange(unit, units, hazardsNow()).filter((h) => !covered.has(hexKey(h)));
  const zones = standsOff ? reachZones(unit, units) : [];
  const distance = (h: HexCoord) => hexDistance(h, target.position);
  let inReach = options.filter((h) => distance(h) <= reach);
  // Out of an immobile foe's reach when the strike still lands from there
  const safe = inReach.filter((h) => outside(h, zones));
  if (safe.length > 0) inReach = safe;
  if (inReach.length > 0) {
    const pick = inReach.sort((a, b) =>
      standsOff ? distance(b) - distance(a) || hexDistance(a, unit.position) - hexDistance(b, unit.position)
                : distance(a) - distance(b) || hexDistance(a, unit.position) - hexDistance(b, unit.position))[0];
    return [{ type: 'move', targetPos: pick }, { type: 'endturn' }];
  }
  if (zones.length > 0 && options.some((h) => outside(h, zones))) options = options.filter((h) => outside(h, zones));
  const nearest = options.sort((a, b) => distance(a) - distance(b))[0];
  return nearest && distance(nearest) < distance(unit.position)
    ? [{ type: 'move', targetPos: nearest }, { type: 'endturn' }]
    : null;
}

// ─── Standing out of reach of something that cannot walk ─────────────────────

/**
 * The ground an immobile foe (the Heart of Winter) can hit: its longest repeatable blow, from where it
 * stands. A hero outside it is never the target, so an archer that can still strike from there should.
 * A follow-up that rides on another blow (the Pulse's Fracture, which hits the hex behind its target) is
 * not an aim of its own.
 */
function reachZones(unit: CombatUnit, units: CombatUnit[]): { at: HexCoord; reach: number }[] {
  return foesOf(unit, units)
    .filter((f) => !f.objective && f.stats.moveRange === 0)
    .map((f) => ({
      at: f.position,
      reach: Math.max(0, ...f.skills.filter((s) => s.damage && !s.prepares && !s.cooldown && !s.id.includes('fracture')).map((s) => s.range)),
    }))
    .filter((z) => z.reach > 0);
}

const outside = (h: HexCoord, zones: { at: HexCoord; reach: number }[]) => zones.every((z) => hexDistance(h, z.at) > z.reach);

/** An archer or healer inside such a zone steps to a hex outside it, if it can still strike from there. */
function standOff(unit: CombatUnit, units: CombatUnit[]): AIAction[] | null {
  const zones = reachZones(unit, units);
  if (zones.length === 0 || outside(unit.position, zones)) return null;
  const strikers = unit.skills.filter((s) => strikes(s) && canUseSkill(unit, s));
  if (strikers.length === 0) return null;
  const reach = Math.max(...strikers.map((s) => s.range));
  const targets = focusUnits(unit, units).filter((u) => u.isPlayer !== unit.isPlayer && u.currentHp > 0);
  const covered = warnedFor(unit, units);
  const spots = getMovementRange(unit, units, hazardsNow())
    .filter((h) => !covered.has(hexKey(h)) && outside(h, zones) && targets.some((t) => hexDistance(h, t.position) <= reach))
    .sort((a, b) => hexDistance(a, unit.position) - hexDistance(b, unit.position));
  return spots[0] ? [{ type: 'move', targetPos: spots[0] }, { type: 'endturn' }] : null;
}

/**
 * Primal Surge (a Wildshape capstone) cleanses, brings the shape's skills two turns closer and does not
 * spend the turn. It deals nothing, so the plain brain scores it at zero and never casts it. It is cast
 * first when a skill of the shape is cooling down or an affliction can be shed, and the turn's action
 * follows it.
 */
function withFreeRefresh(unit: CombatUnit, then: AIAction[]): AIAction[] {
  const surge = unit.skills.find((s) => s.refreshesFormSkills && s.freeAction && canUseSkill(unit, s));
  if (!surge || !then.some((a) => a.type === 'skill')) return then;
  const cooling = unit.skills.some((s) => s.formSkill && s.formSkill !== 'apex' && (unit.cooldowns?.[s.id] ?? 0) > 0);
  const shed = unit.activeEffects.some((e) => isCleansable(e.type));
  return cooling || shed ? [skillAction(surge, unit.position)[0], ...then] : then;
}

// ─── The policy ──────────────────────────────────────────────────────────────

/**
 * The turn of a simulated hero; null for anything that is not one (the plain brain plays it).
 * `why` names the branch taken, for a replay's transcript.
 */
export function partyPolicy(hero: CombatUnit, units: CombatUnit[], why?: (branch: string) => void): AIAction[] | null {
  if (!isHero(hero)) return null;
  // The Last Lesson parries a repeated skill: in his fight it is not among the hero's strikes this turn
  const unit = withoutTheRepeat(hero, units);
  const role = roleOf(unit);
  const took = (branch: string, actions: AIAction[]) => { why?.(`${role}: ${branch}`); return actions; };

  const shifted = takeShape(unit, units);
  if (shifted) return took('takes a shape', shifted);

  const answered = answerWarning(unit, units);
  if (answered) return took('answers a warning', answered);

  // The Dragon's carried Heart: pass it before its carrier falls or the burst lands on the wrong hero
  const potato = heartPotato(unit, units);
  if (potato) return took(potato.reason, potato.actions);

  const walked = sprawlOrShelter(unit, units);
  if (walked) return took('walks into Skyfire\'s fire', walked);

  const broke = breakBound(unit, units);
  if (broke) return took(`breaks the ${broke.kinds.join(' and ')} the warning is tied to`, broke.actions);

  const sheltered = standBesideObjective(unit, units);
  if (sheltered) return took('stands beside an anchor, sheltered from the ice', sheltered);

  const tactical = aethelredAnswers(unit, units);
  if (tactical) return took(tactical.branch, tactical.actions);

  // Jadeveil: a hero Kairen's Verdant Judgement would punish sheds its Taint on a Jade Shard; a web is cut before the bite
  const shed = shedTaint(unit, units);
  if (shed) return took('breaks a Jade Shard to shed its Taint', shed);
  const cut = cutTheWeb(unit, units);
  if (cut) return took('cuts a web', cut);

  // The Troll's warnings have answers besides the step: share the roof, brace against rubble, keep him from regenerating
  const store = useCombatStore.getState();
  let stand = trollStand(unit, units, store.hazards, store.preparedAttacks, store.turnOrder);
  if (stand?.kind === 'move') return took(stand.reason, stand.actions);
  // Standing in a regeneration round is only worth it if the strike is there to be made from this hex
  if (stand?.kind === 'stay' && stand.needsStrike && !decideEnemyAction(unit, focusUnits(unit, units)).some((a) => a.type === 'skill')) stand = null;
  const staying = stand?.kind === 'stay';

  const responded = staying ? null : respondingPolicy(unit, units);
  if (responded) return took('steps out of a warning', responded);

  const supported = support(unit, units);
  // Support that walks off the hex is not an option for a hero who is staying
  if (supported && !(staying && supported.some((a) => a.type === 'move'))) return took('supports', supported);

  if (role === 'tank' && !staying) {
    const taunted = taunt(unit, units);
    if (taunted) return took('taunts', taunted);
  }

  // The Troll's fort, on a turn no warning has claimed: bait the Prey, take cover, keep the heaps out of his front
  const fort = staying ? null : trollFort(unit, units, store.hazards, store.preparedAttacks);
  if (fort) return took(fort.reason, fort.actions);

  if (role === 'tank' && !staying) {
    const adjacent = closeInOnBoss(unit, units);
    if (adjacent) return took('closes on the boss', adjacent);
  }

  if (role === 'ranged' || role === 'healer') {
    const away = standOff(unit, units);
    if (away) return took('stands out of its reach', away);
  }

  const base = decideEnemyAction(unit, focusUnits(unit, units));
  const refreshed = withFreeRefresh(unit, base);
  if (refreshed !== base) return took('refreshes its shape, then acts', refreshed);
  if (base.some((a) => a.type === 'skill')) return took(staying ? `${stand!.reason}, strikes` : 'strikes', base);
  if (staying) return took(`${stand!.reason}, holds`, [{ type: 'endturn' }]);
  // The plain brain found nothing in reach: walk to where something is, rather than hold ground
  const walk = walkIntoReach(unit, focusUnits(unit, units), role);
  return took(walk ? 'walks into reach' : base.some((a) => a.type === 'move') ? 'advances' : 'holds', walk ?? base);
}
