import { AfflictionType, AuraType, CombatUnit, HeroSkill } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { axeHew } from '@/data/skills/skillData';
import { twinRaidBurst } from '@/data/skills/factionEliteSkills';
import { useCombatStore } from '@/stores/combatStore';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { getMovementRange } from '@/systems/combat/movement';
import { resolvePush, resolveSelfMove } from '@/systems/combat/forcedMovement';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { answerChallenge } from '@/systems/combat/factionEliteActions';
import {
  canChallenge,
  canTomb,
  duelBars,
  mitesOf,
  planTwinRaid,
  TOMB_KIND,
  tombOf,
} from '@/systems/combat/factionEliteKits';
import { isPreparedDue } from '@/systems/combat/preparedAttacks';
import { resolveDuePrepared } from '@/systems/combat/preparedResolve';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { hasEffect, isHiddenFrom } from '@/systems/combat/statusEffects';
import { warningLines } from '@/data/display/preparedDisplay';
import { previewPrepared } from '@/systems/combat/preparedAttacks';
import { beginTurn } from '@/systems/combat/turnStart';
import { performTwinRaid } from '@/systems/combat/factionEliteActions';
import { hexDistance } from '@/utils/hexUtils';
import { at, makeFoe, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * The four new-faction elites' signatures, pinned as rules: what each announces, what each
 * answer really does, and the lines the plan draws (nothing about the Burrowmother's sand
 * can be struck, a hero caught by both of the Khan's arrivals takes both, the Jarl's circle
 * binds two bodies and nobody else, a tomb can be broken from outside).
 */

const swing = makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 8 });
const basic = makeSkill({ id: BASIC_ATTACK_ID as HeroSkill['id'], damage: 0.5, range: 8 });

const hero = (id: string, position = at(0, 2), extra: Partial<CombatUnit> = {}) =>
  makeUnit({
    id, heroId: id, name: id, position,
    stats: makeStats({ maxHp: 4000, attack: 30, defense: 0, speed: 5, critChance: 0, dodgeChance: 0, maxMana: 50 }),
    skills: [swing, basic],
    ...extra,
  });

const units = () => useCombatStore.getState().units;
const find = (id: string) => units().find((u) => u.id === id)!;
const byTemplate = (t: string): CombatUnit => units().find((u) => u.templateId === t)!;
const prepared = () => useCombatStore.getState().preparedAttacks;
const hazards = () => useCombatStore.getState().hazards;

function start(template: string, at0: ReturnType<typeof at>, heroes: CombatUnit[]) {
  const store = useCombatStore.getState();
  store.reset();
  const [elite] = createEnemyUnits([template], [at0], 1, 1);
  store.initCombat(heroes, [elite]);
  return elite.id;
}

/** One turn of the elite through the real AI, a skill forced when `only` names one. */
function eliteTurn(template: string, only?: string) {
  const unit = byTemplate(template);
  useCombatStore.getState().beginTurnFlags(unit.id);
  const view = only ? { ...unit, skills: unit.skills.filter((s) => s.id === only) } : unit;
  const actions = decideEnemyAction(view, units());
  executeAIActions(unit, actions);
  return actions;
}

/** Every responder has had their turn: whatever is open lands from its caster's turn. */
function land(template: string) {
  const store = useCombatStore.getState();
  for (const p of prepared()) store.updatePreparedAttack(p.id, { responded: p.responders });
  resolveDuePrepared(byTemplate(template).id, SILENT_SINK);
}

// ── Burrowmother: Undermine ──────────────────────────────────────────────────

describe('Undermine', () => {
  const MOTHER = at(0, -3);
  const startMother = (heroes = [hero('a', at(0, 1)), hero('b', at(1, 1))]) => start('burrowmother', MOTHER, heroes);

  it('burrows her: nothing can aim at her and nothing lands on her', () => {
    startMother();
    eliteTurn('burrowmother', 'undermine');
    const mother = byTemplate('burrowmother');
    expect(hasEffect(mother, AuraType.Burrowed)).toBe(true);
    expect(isHiddenFrom(mother, swing)).toBe(true);
    const before = mother.currentHp;
    useCombatStore.getState().damageUnit(mother.id, 500);
    expect(find(mother.id).currentHp).toBe(before);
    // and no affliction either, so a Stun cannot take the eruption from her
    useCombatStore.getState().applyEffect(mother.id, {
      type: AfflictionType.Stun, magnitude: 1, duration: 1, sourceUnitId: 'a',
    });
    expect(hasEffect(find(mother.id), AfflictionType.Stun)).toBe(false);
  });

  it('marks the ground under the party and opens two vents on its edge', () => {
    startMother();
    eliteTurn('burrowmother', 'undermine');
    const warning = prepared()[0];
    expect(warning.scripted).toBe('undermine');
    const centre = warning.centres![0];
    expect(warning.vents).toHaveLength(2);
    for (const v of warning.vents!) expect(hexDistance(centre, v)).toBe(BALANCE.UNDERMINE_RADIUS);
    for (const h of warning.hexes) expect(hexDistance(centre, h)).toBeLessThanOrEqual(BALANCE.UNDERMINE_RADIUS);
    // Both heroes are in it and so owe a window
    expect(warning.responders.sort()).toEqual(['a', 'b']);
  });

  it('shows one compact Undermine explanation for multiple Burrowmothers', () => {
    startMother();
    eliteTurn('burrowmother', 'undermine');
    const first = prepared()[0];
    const second = { ...first, id: 'second-undermine', responded: first.responders };
    const attacks = [first, second];
    const lines = warningLines(attacks, attacks.map((attack) => previewPrepared(attack, units(), hazards())), units());
    expect(lines).toHaveLength(1);
    expect(lines[0].title).toBe('Undermine ×2');
    expect(lines[0].imminent).toBe(true);
    expect(lines[0].detail).toContain('Waiting:');
    expect(lines[0].detail).toContain('knock-up');
    expect(lines[0].detail).toContain('Exposed');
    expect(lines[0].detail.length).toBeLessThan(220);
  });

  it('opens three vents against a party of three', () => {
    startMother([hero('a', at(0, 1)), hero('b', at(1, 1)), hero('c', at(0, 2))]);
    eliteTurn('burrowmother', 'undermine');
    expect(prepared()[0].vents).toHaveLength(BALANCE.UNDERMINE_VENTS_LARGE_PARTY);
  });

  it('does not come up until every hero standing in the footprint has had a turn', () => {
    startMother();
    eliteTurn('burrowmother', 'undermine');
    const id = byTemplate('burrowmother').id;
    expect(isPreparedDue(prepared()[0], units())).toBe(false);
    expect(resolveDuePrepared(id, SILENT_SINK)).toHaveLength(0);
    // Her turn comes round and she simply is not there
    expect(beginTurn(id, SILENT_SINK).kind).toBe('inert');
    expect(hasEffect(find(id), AuraType.Burrowed)).toBe(true);
  });

  it('erupts with damage, from the footprint, and is no longer burrowed', () => {
    startMother();
    eliteTurn('burrowmother', 'undermine');
    const centre = prepared()[0].centres![0];
    const before = find('a').currentHp;
    land('burrowmother');
    const mother = byTemplate('burrowmother');
    expect(hasEffect(mother, AuraType.Burrowed)).toBe(false);
    expect(hexDistance(mother.position, centre)).toBeLessThanOrEqual(BALANCE.UNDERMINE_RADIUS);
    expect(find('a').currentHp).toBeLessThan(before);
    expect(find('b').currentHp).toBeLessThan(find('b').stats.maxHp);
    // The knock-up is the picture of the blow: nobody loses a turn to it
    expect(hasEffect(find('a'), AfflictionType.Stun)).toBe(false);
    expect(prepared()).toHaveLength(0);
  });

  it('surfaces by a swift dash, not a walk across the arena (playtest 2026-10-09)', () => {
    startMother();
    eliteTurn('burrowmother', 'undermine');
    const from = byTemplate('burrowmother').position;
    land('burrowmother');
    const mother = byTemplate('burrowmother');
    expect(mother.position).not.toEqual(from);
    expect(mother.movement?.mode).toBe('dash');
  });

  it('spares a hero who left the footprint, and still opens every vent', () => {
    startMother();
    eliteTurn('burrowmother', 'undermine');
    const vents = prepared()[0].vents!;
    useCombatStore.getState().moveUnit('a', at(-3, 3));
    useCombatStore.getState().moveUnit('b', at(3, 3));
    land('burrowmother');
    expect(find('a').currentHp).toBe(find('a').stats.maxHp);
    expect(find('b').currentHp).toBe(find('b').stats.maxHp);
    expect(mitesOf(byTemplate('burrowmother'), units())).toHaveLength(vents.length);
  });

  it('opens no Sand Mite at a vent a hero is holding', () => {
    startMother();
    eliteTurn('burrowmother', 'undermine');
    const [held, open] = prepared()[0].vents!;
    useCombatStore.getState().moveUnit('a', held);
    land('burrowmother');
    const mites = mitesOf(byTemplate('burrowmother'), units());
    expect(mites).toHaveLength(1);
    expect(mites[0].position).toEqual(open);
    // and the hero holding it is still where they stood
    expect(find('a').position).toEqual(held);
  });

  it('never has more than its cap of mites standing', () => {
    startMother();
    eliteTurn('burrowmother', 'undermine');
    const mother = byTemplate('burrowmother');
    const spare = createEnemyUnits(
      Array.from({ length: BALANCE.UNDERMINE_MITE_CAP }, () => 'sand_mite'),
      [at(-4, 0), at(-4, 1), at(-4, 2), at(-4, 3)],
      1,
      1,
    ).map((m) => ({ ...m, summonedBy: mother.id }));
    useCombatStore.getState().addUnits(spare);
    land('burrowmother');
    expect(mitesOf(byTemplate('burrowmother'), units())).toHaveLength(BALANCE.UNDERMINE_MITE_CAP);
  });

  it('leaves her Exposed for exactly one round: it ends when her own next turn begins', () => {
    startMother();
    eliteTurn('burrowmother', 'undermine');
    land('burrowmother');
    const id = byTemplate('burrowmother').id;
    const exposed = find(id).activeEffects.find((e) => e.type === AuraType.Exposed);
    expect(exposed).toBeDefined();
    expect(exposed!.duration).toBe(BALANCE.UNDERMINE_EXPOSED_TURNS);
    // a hero's blow lands harder while it holds
    const hit = (u: CombatUnit) => calculateDamage(find('a'), u, swing);
    const open = hit(find(id));
    beginTurn(id, SILENT_SINK);
    expect(hasEffect(find(id), AuraType.Exposed)).toBe(false);
    expect(hit(find(id))).toBeLessThan(open);
  });

  it('is not cast again while she is under, and rests for her cooldown after', () => {
    startMother();
    eliteTurn('burrowmother', 'undermine');
    expect(prepared()).toHaveLength(1);
    eliteTurn('burrowmother', 'undermine');
    expect(prepared()).toHaveLength(1);
    land('burrowmother');
    const actions = decideEnemyAction(
      { ...byTemplate('burrowmother'), skills: byTemplate('burrowmother').skills.filter((s) => s.id === 'undermine') },
      units(),
    );
    expect(actions.some((a) => a.skill?.id === 'undermine')).toBe(false);
  });
});

// ── Herd-Khan: Twin Raid ─────────────────────────────────────────────────────

describe('Twin Raid', () => {
  const KHAN = at(0, -3);
  const startKhan = (heroes = [hero('a', at(0, 0))]) => start('herd_khan', KHAN, heroes);

  it('plans two dashes of at most three hexes, the second starting where the first landed', () => {
    startKhan();
    const legs = planTwinRaid(byTemplate('herd_khan'), units(), hazards());
    expect(legs).toHaveLength(2);
    expect(legs[0].from).toEqual(KHAN);
    expect(legs[1].from).toEqual(legs[0].to);
    for (const leg of legs) {
      expect(leg.path.length).toBeGreaterThan(0);
      expect(leg.path.length).toBeLessThanOrEqual(BALANCE.TWIN_RAID_DASH);
    }
  });

  it('never routes through, or lands on, a body', () => {
    startKhan([hero('a', at(0, 0)), hero('b', at(0, -2)), hero('c', at(1, -2))]);
    const legs = planTwinRaid(byTemplate('herd_khan'), units(), hazards());
    const bodies = new Set(units().filter((u) => u.id !== byTemplate('herd_khan').id).map((u) => `${u.position.q},${u.position.r}`));
    for (const leg of legs) for (const h of leg.path) expect(bodies.has(`${h.q},${h.r}`)).toBe(false);
  });

  it('is not planned when no arrival would catch a hero', () => {
    startKhan([hero('a', at(-5, 5))]);
    expect(planTwinRaid(byTemplate('herd_khan'), units(), hazards())).toEqual([]);
  });

  it('bursts at each arrival, damaging and bleeding every hero within one hex', () => {
    startKhan([hero('a', at(0, 0)), hero('b', at(3, 3))]);
    const khan = byTemplate('herd_khan');
    const legs = planTwinRaid(khan, units(), hazards());
    eliteTurn('herd_khan', 'twin_raid');
    expect(find('a').currentHp).toBeLessThan(find('a').stats.maxHp);
    expect(hasEffect(find('a'), AfflictionType.Bleed)).toBe(true);
    expect(find('b').currentHp).toBe(find('b').stats.maxHp);
    expect(find(khan.id).position).toEqual(legs[legs.length - 1].to);
  });

  it('hits a hero caught by both arrivals twice, and Bleed refreshes rather than stacking', () => {
    startKhan();
    const khan = byTemplate('herd_khan');
    const legs = planTwinRaid(khan, units(), hazards());
    expect(legs.every((l) => l.caught.includes('a'))).toBe(true);
    const one = calculateDamage(khan, find('a'), twinRaidBurst);
    eliteTurn('herd_khan', 'twin_raid');
    const lost = find('a').stats.maxHp - find('a').currentHp;
    expect(lost).toBeGreaterThan(one * 1.5);
    expect(find('a').activeEffects.filter((e) => e.type === AfflictionType.Bleed)).toHaveLength(1);
  });

  it('makes both raid legs as dashes along their routes, never as walks (playtest 2026-10-09)', () => {
    startKhan();
    const khan = byTemplate('herd_khan');
    const legs = planTwinRaid(khan, units(), hazards());
    expect(legs).toHaveLength(2);
    const moves: NonNullable<CombatUnit['movement']>[] = [];
    const unsubscribe = useCombatStore.subscribe((next, previous) => {
      const now = next.units.find((u) => u.id === khan.id), was = previous.units.find((u) => u.id === khan.id);
      if (now?.movement && now.movement !== was?.movement) moves.push(now.movement);
    });
    try { eliteTurn('herd_khan', 'twin_raid'); } finally { unsubscribe(); }
    expect(moves.map((m) => m.mode)).toEqual(['dash', 'dash']);
    expect(moves.map((m) => m.path)).toEqual(legs.map((l) => [l.from, ...l.path]));
  });

  it('deals nothing along the route', () => {
    // The hero stands on the Khan's straight line to his first landing, two hexes beyond any landing
    startKhan([hero('a', at(0, 0)), hero('mid', at(-2, -1))]);
    const legs = planTwinRaid(byTemplate('herd_khan'), units(), hazards());
    const landings = legs.flatMap((l) => [l.to]);
    const bystander = find('mid');
    const nearLanding = landings.some((l) => hexDistance(l, bystander.position) <= BALANCE.TWIN_RAID_RADIUS);
    eliteTurn('herd_khan', 'twin_raid');
    if (!nearLanding) expect(find('mid').currentHp).toBe(find('mid').stats.maxHp);
  });

  it('ends after the first burst when the second dash is not legal, and does not refund anything', () => {
    startKhan();
    const khan = byTemplate('herd_khan');
    useCombatStore.getState().moveUnit(khan.id, at(0, -1));
    const here = find(khan.id);
    const blocked = at(1, -1);
    useCombatStore.getState().addUnits([makeFoe({ id: 'wall', position: blocked })]);
    performTwinRaid(here, blocked, SILENT_SINK);
    expect(find(khan.id).position).toEqual(at(0, -1));
    expect(find('a').currentHp).toBeLessThan(find('a').stats.maxHp);
  });

  it('rests for its cooldown afterwards', () => {
    startKhan();
    eliteTurn('herd_khan', 'twin_raid');
    expect(find(byTemplate('herd_khan').id).cooldowns?.twin_raid).toBeGreaterThan(0);
  });
});

// ── Rime Jarl: Jarl's Challenge ──────────────────────────────────────────────

describe("Jarl's Challenge", () => {
  const JARL = at(0, -1);
  const fx = () => SILENT_SINK;
  const startJarl = (heroes = [hero('a', at(0, 1)), hero('b', at(3, 0))]) => start('rime_jarl', JARL, heroes);
  const challenge = () => {
    eliteTurn('rime_jarl', 'jarls_challenge');
  };

  it('names one hero, marks them, and leaves everyone else alone', () => {
    startJarl();
    challenge();
    expect(find('a').challenge).toBeDefined();
    expect(find('a').challenge!.jarlId).toBe(byTemplate('rime_jarl').id);
    expect(find('a').challenge!.centre).toEqual(JARL);
    expect(hasEffect(find('a'), AuraType.Challenged)).toBe(true);
    expect(find('b').challenge).toBeUndefined();
    // Nothing is displaced and nothing is struck by the challenge itself
    expect(find('a').position).toEqual(at(0, 1));
    expect(find('a').currentHp).toBe(find('a').stats.maxHp);
  });

  it('allows only one challenge or duel at a time', () => {
    startJarl([hero('a', at(0, 1)), hero('b', at(1, 0))]);
    challenge();
    expect(canChallenge(byTemplate('rime_jarl'), find('b'), units(), hazards())).toBe(false);
    answerChallenge('a', true, fx());
    expect(canChallenge(byTemplate('rime_jarl'), find('b'), units(), hazards())).toBe(false);
  });

  it('accepts: both are bound, the Jarl hits harder, and neither can leave the circle', () => {
    startJarl();
    const jarl = byTemplate('rime_jarl');
    const plain = calculateDamage(jarl, find('a'), axeHew);
    challenge();
    answerChallenge('a', true, fx());
    expect(find('a').duel?.partnerId).toBe(jarl.id);
    expect(find(jarl.id).duel?.partnerId).toBe('a');
    expect(find('a').challenge).toBeUndefined();
    const bonus = calculateDamage(find(jarl.id), find('a'), axeHew);
    expect(bonus / plain).toBeCloseTo(1 + BALANCE.DUEL_DAMAGE_BONUS, 1);
    for (const id of ['a', jarl.id]) {
      for (const h of getMovementRange(find(id), units(), hazards())) {
        expect(hexDistance(h, JARL)).toBeLessThanOrEqual(BALANCE.CHALLENGE_RADIUS);
      }
    }
    // and a shove cannot carry one out of it either
    expect(resolvePush(JARL, find('a'), 2, units(), hazards())).toBeNull();
  });

  it('keeps a duelling Jarl\'s Charge inside the circle: it lands in the circle or does not land', () => {
    startJarl([hero('a', at(0, 1))]);
    const jarl = byTemplate('rime_jarl');
    const charge = jarl.skills.find((sk) => sk.id === 'charge')!;
    challenge();
    answerChallenge('a', true, fx());
    const landing = resolveSelfMove(find(jarl.id), charge, find('a').position, units());
    if (landing) expect(hexDistance(landing, JARL)).toBeLessThanOrEqual(BALANCE.CHALLENGE_RADIUS);
    // A hero stood on the far side of the edge cannot be reached from outside it
    useCombatStore.getState().moveUnit(jarl.id, at(0, -2));
    const outside = resolveSelfMove(find(jarl.id), charge, find('a').position, units());
    if (outside) expect(hexDistance(outside, JARL)).toBeLessThanOrEqual(BALANCE.CHALLENGE_RADIUS);
  });

  it('lets nobody else affect either duelist, and neither duelist affect anybody else', () => {
    startJarl([hero('a', at(0, 1)), hero('b', at(1, 0), { currentHp: 1000 })]);
    const jarl = byTemplate('rime_jarl');
    challenge();
    answerChallenge('a', true, fx());
    expect(duelBars(find('b'), find('a'))).toBe(true);
    expect(duelBars(find('b'), find(jarl.id))).toBe(true);
    expect(duelBars(find('a'), find('b'))).toBe(true);
    expect(duelBars(find('a'), find(jarl.id))).toBe(false);
    expect(duelBars(find('a'), find('a'))).toBe(false);

    // An outsider's heal does not reach a duelist, and a duelist's does not reach an outsider
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'a' ? { ...u, currentHp: 100 } : u)) }));
    const heal = makeSkill({ id: 'mend' as HeroSkill['id'], healing: 500, range: 8, targetSide: 'ally' });
    resolveSkillUse(find('b'), heal, find('a').position, SILENT_SINK);
    expect(find('a').currentHp).toBe(100);
    resolveSkillUse(find('a'), heal, find('b').position, SILENT_SINK);
    expect(find('b').currentHp).toBe(1000);

    // An enemy standing outside it cannot hurt either, and the Jarl cannot hurt the outsider
    const goblin = makeFoe({ id: 'goblin', position: at(2, 2), skills: [swing] });
    useCombatStore.getState().addUnits([goblin]);
    const before = find('a').currentHp;
    resolveSkillUse(find('goblin'), swing, find('a').position, SILENT_SINK);
    expect(find('a').currentHp).toBe(before);
    const jarlSwing = makeSkill({ id: 'jarl_swing' as HeroSkill['id'], damage: 1, range: 8 });
    resolveSkillUse(find(jarl.id), jarlSwing, find('b').position, SILENT_SINK);
    expect(find('b').currentHp).toBe(1000);
    // while the two of them can still hit each other
    resolveSkillUse(find('a'), swing, find(jarl.id).position, SILENT_SINK);
    expect(find(jarl.id).currentHp).toBeLessThan(find(jarl.id).stats.maxHp);
  });

  it('refuses: no circle, no mark, and only the Jarl is wrapped in a Barrier worth his maximum health', () => {
    startJarl();
    const jarl = byTemplate('rime_jarl');
    challenge();
    answerChallenge('a', false, fx());
    expect(find('a').duel).toBeUndefined();
    expect(find(jarl.id).duel).toBeUndefined();
    expect(find('a').challenge).toBeUndefined();
    expect(hasEffect(find('a'), AuraType.Challenged)).toBe(false);
    const barrier = find(jarl.id).activeEffects.find((e) => e.type === AuraType.Barrier);
    expect(barrier?.magnitude).toBe(Math.round(jarl.stats.maxHp * BALANCE.REFUSE_BARRIER));
    expect(barrier?.duration).toBe(BALANCE.REFUSE_BARRIER_TURNS + 1);
    // Nobody gains Fury and no hero is denied an action
    expect(units().some((u) => hasEffect(u, AuraType.Fury))).toBe(false);
    expect(find('a').activeEffects).toHaveLength(0);
  });

  it('does not stack a second refusal on the first', () => {
    startJarl();
    const jarl = byTemplate('rime_jarl');
    challenge();
    answerChallenge('a', false, fx());
    useCombatStore.getState().issueChallenge(jarl.id, 'a');
    answerChallenge('a', false, fx());
    const barriers = find(jarl.id).activeEffects.filter((e) => e.type === AuraType.Barrier);
    expect(barriers).toHaveLength(1);
    expect(barriers[0].magnitude).toBe(Math.round(jarl.stats.maxHp * BALANCE.REFUSE_BARRIER));
  });

  it('runs out when both have ended two regular turns, and the Jarl kneels', () => {
    startJarl();
    const jarl = byTemplate('rime_jarl');
    challenge();
    answerChallenge('a', true, fx());
    const store = useCombatStore.getState();
    store.noteDuelTurn('a');
    store.noteDuelTurn(jarl.id);
    store.noteDuelTurn('a');
    expect(find('a').duel).toBeDefined();
    store.noteDuelTurn(jarl.id);
    expect(find('a').duel).toBeUndefined();
    expect(find(jarl.id).duel).toBeUndefined();
    expect(hasEffect(find(jarl.id), AuraType.Duel)).toBe(false);
    expect(hasEffect(find(jarl.id), AuraType.Kneeling)).toBe(true);
    // His next regular turn is lost, and a speed-granted one cannot bypass it
    useCombatStore.setState({ bonusTurn: { pending: null, active: true } });
    expect(beginTurn(jarl.id, SILENT_SINK).kind).toBe('kneeling');
    useCombatStore.setState({ bonusTurn: { pending: null, active: false } });
    expect(beginTurn(jarl.id, SILENT_SINK).kind).toBe('kneeling');
    expect(hasEffect(find(jarl.id), AuraType.Kneeling)).toBe(false);
  });

  it('counts regular turns only: a bonus turn never advances the duel', () => {
    startJarl();
    challenge();
    answerChallenge('a', true, fx());
    useCombatStore.setState({ currentUnitId: 'a', bonusTurn: { pending: null, active: true } });
    useCombatStore.getState().nextTurn();
    expect(find('a').duel!.turns).toBe(0);
    useCombatStore.setState({ currentUnitId: 'a', bonusTurn: { pending: null, active: false } });
    useCombatStore.getState().nextTurn();
    expect(find('a').duel!.turns).toBe(1);
  });

  it('ends at once, with no punishment, when either duelist falls', () => {
    startJarl();
    const jarl = byTemplate('rime_jarl');
    challenge();
    answerChallenge('a', true, fx());
    useCombatStore.getState().damageUnit('a', 999999);
    expect(find(jarl.id).duel).toBeUndefined();
    expect(hasEffect(find(jarl.id), AuraType.Duel)).toBe(false);
    expect(hasEffect(find(jarl.id), AuraType.Kneeling)).toBe(false);
  });

  it('lets a pending challenge lapse if the hero leaves the circle that was shown', () => {
    startJarl();
    challenge();
    useCombatStore.getState().moveUnit('a', at(3, 3));
    beginTurn('a', SILENT_SINK);
    expect(find('a').challenge).toBeUndefined();
    expect(hasEffect(find('a'), AuraType.Challenged)).toBe(false);
  });

  it('is answered by policy when nobody is at the controls, and never left hanging', () => {
    startJarl();
    challenge();
    beginTurn('a', SILENT_SINK);
    expect(find('a').challenge).toBeUndefined();
    const answered = find('a').duel !== undefined || hasEffect(byTemplate('rime_jarl'), AuraType.Barrier);
    expect(answered).toBe(true);
  });

  it('is put to a person, not answered for them, when one is steering', () => {
    startJarl();
    challenge();
    beginTurn('a', { ...SILENT_SINK, interactive: true });
    expect(find('a').challenge).toBeDefined();
  });
});

// ── Glacier Colossus: Glacial Tomb ───────────────────────────────────────────

describe('Glacial Tomb', () => {
  const COLOSSUS = at(0, -3);
  const startColossus = (heroes?: CombatUnit[]) =>
    start('glacier_colossus', COLOSSUS, heroes ?? [
      hero('a', at(0, 0), { stats: makeStats({ maxHp: 4000, attack: 50, defense: 0, speed: 5, critChance: 0, dodgeChance: 0 }) }),
      hero('b', at(3, 0)),
    ]);
  const tomb = () => tombOf(byTemplate('glacier_colossus'), units())!;

  it('seals the hardest hitter in an attackable block that stands on their hex', () => {
    startColossus();
    eliteTurn('glacier_colossus', 'glacial_tomb');
    const block = tomb();
    const colossus = byTemplate('glacier_colossus');
    expect(block.objective?.kind).toBe(TOMB_KIND);
    expect(block.position).toEqual(find('a').position);
    expect(block.currentHp).toBe(Math.round(colossus.stats.maxHp * BALANCE.TOMB_HP));
    expect(block.stats.defense).toBe(0);
    expect(block.stats.magicDefense).toBe(0);
    expect(hasEffect(find('a'), AuraType.Encased)).toBe(true);
    // A lookup by hex finds the block, not the hero under it
    expect(useCombatStore.getState().getUnitAt(find('a').position)?.id).toBe(block.id);
  });

  it('holds the hero out of the fight: no damage, no new statuses, no turn, nothing ticking', () => {
    startColossus();
    useCombatStore.getState().applyEffect('a', {
      type: AfflictionType.Poison, magnitude: 5, duration: 3, sourceUnitId: byTemplate('glacier_colossus').id,
    });
    eliteTurn('glacier_colossus', 'glacial_tomb');
    const before = find('a').currentHp;
    useCombatStore.getState().damageUnit('a', 500);
    expect(find('a').currentHp).toBe(before);
    expect(isHiddenFrom(find('a'), swing)).toBe(true);
    useCombatStore.getState().applyEffect('a', {
      type: AfflictionType.Bleed, magnitude: 1, duration: 3, sourceUnitId: byTemplate('glacier_colossus').id,
    });
    expect(hasEffect(find('a'), AfflictionType.Bleed)).toBe(false);
    const poison = find('a').activeEffects.find((e) => e.type === AfflictionType.Poison)!;
    expect(beginTurn('a', SILENT_SINK).kind).toBe('inert');
    expect(find('a').currentHp).toBe(before);
    expect(find('a').activeEffects.find((e) => e.type === AfflictionType.Poison)!.duration).toBe(poison.duration);
  });

  it('owes the window to every other hero, and never to the sealed one', () => {
    startColossus([
      hero('a', at(0, 0), { stats: makeStats({ maxHp: 4000, attack: 50, defense: 0, speed: 5 }) }),
      hero('b', at(3, 0)),
      hero('c', at(-3, 3)),
    ]);
    eliteTurn('glacier_colossus', 'glacial_tomb');
    const warning = prepared()[0];
    expect(warning.scripted).toBe('tomb');
    expect(warning.responders.sort()).toEqual(['b', 'c']);
    expect(isPreparedDue(warning, units())).toBe(false);
  });

  it('has at most one tomb, and none against a party down to its last hero', () => {
    startColossus();
    eliteTurn('glacier_colossus', 'glacial_tomb');
    expect(canTomb(byTemplate('glacier_colossus'), units())).toBe(false);
    eliteTurn('glacier_colossus', 'glacial_tomb');
    expect(units().filter((u) => u.objective?.kind === TOMB_KIND && u.currentHp > 0)).toHaveLength(1);

    startColossus([hero('solo', at(0, 0))]);
    expect(canTomb(byTemplate('glacier_colossus'), units())).toBe(false);
  });

  it('can be hit by the sealed hero\'s allies with any attack', () => {
    startColossus();
    eliteTurn('glacier_colossus', 'glacial_tomb');
    const block = tomb();
    const before = block.currentHp;
    // A light blow, so the block takes it and stands
    const tap = makeSkill({ id: 'tap' as HeroSkill['id'], damage: 0.1, range: 8 });
    resolveSkillUse(find('b'), tap, find('a').position, SILENT_SINK);
    expect(find(block.id).currentHp).toBeLessThan(before);
    expect(find(block.id).currentHp).toBeGreaterThan(0);
    expect(find('a').currentHp).toBe(find('a').stats.maxHp);
  });

  it('collapses inward when left standing: heavy magic damage and a Chill that stays a Chill', () => {
    startColossus();
    useCombatStore.getState().applyEffect('a', {
      type: AfflictionType.Chill, magnitude: 3, duration: 3, sourceUnitId: byTemplate('glacier_colossus').id,
    });
    eliteTurn('glacier_colossus', 'glacial_tomb');
    land('glacier_colossus');
    expect(units().some((u) => u.objective?.kind === TOMB_KIND && u.currentHp > 0)).toBe(false);
    expect(hasEffect(find('a'), AuraType.Encased)).toBe(false);
    expect(find('a').currentHp).toBeLessThan(find('a').stats.maxHp);
    expect(hasEffect(find('a'), AfflictionType.Chill)).toBe(true);
    expect(hasEffect(find('a'), AfflictionType.Freeze)).toBe(false);
    expect(prepared()).toHaveLength(0);
  });

  it('shatters outward when broken from outside: the hero is freed, the collapse is cancelled, and the party is spared', () => {
    startColossus();
    const colossus = byTemplate('glacier_colossus');
    const beside = makeFoe({
      id: 'beside', position: at(0, -1), stats: makeStats({ maxHp: 4000, defense: 0, magicDefense: 0 }),
    });
    useCombatStore.getState().addUnits([beside]);
    eliteTurn('glacier_colossus', 'glacial_tomb');
    const block = tomb();
    const aHp = find('a').currentHp;
    const bHp = find('b').currentHp;
    useCombatStore.getState().damageUnit(block.id, block.currentHp, 'b');
    expect(hasEffect(find('a'), AuraType.Encased)).toBe(false);
    expect(prepared()).toHaveLength(0);
    // Whatever stood beside the block is hurt; the heroes are not
    expect(find('beside').currentHp).toBeLessThan(find('beside').stats.maxHp);
    expect(find('a').currentHp).toBe(aHp);
    expect(find('b').currentHp).toBe(bHp);
    expect(find(colossus.id).currentHp).toBe(colossus.currentHp);
  });

  it('frees the hero if the Colossus falls with the tomb still standing', () => {
    startColossus();
    eliteTurn('glacier_colossus', 'glacial_tomb');
    useCombatStore.getState().damageUnit(byTemplate('glacier_colossus').id, 999999);
    expect(hasEffect(find('a'), AuraType.Encased)).toBe(false);
    expect(units().some((u) => u.objective?.kind === TOMB_KIND && u.currentHp > 0)).toBe(false);
  });
});
