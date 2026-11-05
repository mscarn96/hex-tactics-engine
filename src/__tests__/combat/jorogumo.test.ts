import { AfflictionType, AuraType, CombatUnit, HeroSkill, SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { useCombatStore } from '@/stores/combatStore';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { isPreparedDue } from '@/systems/combat/preparedAttacks';
import { resolveDuePrepared } from '@/systems/combat/preparedResolve';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { hasEffect, isHiddenFrom } from '@/systems/combat/statusEffects';
import { beginTurn } from '@/systems/combat/turnStart';
import { scriptsBetweenTurns } from '@/systems/combat/scriptRegistry';
import { warningLines } from '@/data/display/preparedDisplay';
import { previewPrepared } from '@/systems/combat/preparedAttacks';
import { THREAD_KIND, venomTarget, volleySize, WEB_KIND, weaverPerch } from '@/systems/combat/yokaiKits';
import { canopyVenom } from '@/data/skills/yokaiSkills';
import { JOROGUMO_GROUND_SKILLS } from '@/data/templates/jorogumoWeaver';
import { decideEnemyAction as decide } from '@/systems/combat/enemyAI';
import { hexKey } from '@/utils/hexUtils';
import { hexDistance } from '@/utils/hexUtils';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * The Jorōgumo, the Silk Hollow's boss, pinned as rules (`systems/combat/yokaiKits`):
 *
 * - she opens hanging over her perch on three threads, each an objective on the board;
 *   while any stands nothing can aim at her, harm her or afflict her, and she never walks;
 * - from the canopy her web reaches every hero, and her bite drops her beside the webbed
 *   hero, still out of reach, until she climbs back to her perch between turns;
 * - cutting the last thread drags her down into her second phase, on the board.
 *
 * And her web, as it was when she was the Yokai's elite:
 *
 * - a web is an attackable 1-health objective on the hero's hex, and holds the hero out
 *   of the fight while it stands;
 * - any hit cuts it, and so does an area blow that catches its hex;
 * - the bite lands only on a hero a web still holds, and only once every free hero has
 *   had a turn since the volley — never in the round the web was spun;
 * - her turns run web → bite-or-attack → attack, the volleys escalating one, two, three,
 *   four, and every volley leaves at least one hero free to answer.
 */

const swing = makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 8 });
const tap = makeSkill({ id: 'tap' as HeroSkill['id'], damage: 0.05, range: 8 });
const burst = makeSkill({
  id: 'burst' as HeroSkill['id'], damage: 0.05, range: 8, targetType: SkillTargetType.Ring, aoeRadius: 1,
});

const hero = (id: string, position = at(0, 2), over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id, heroId: id, name: id, position,
    stats: makeStats({ maxHp: 4000, attack: 30, defense: 0, speed: 5, critChance: 0, dodgeChance: 0 }),
    skills: [swing, tap, burst],
    ...over,
  });

const units = () => useCombatStore.getState().units;
const find = (id: string) => units().find((u) => u.id === id)!;
const spider = () => units().find((u) => u.templateId === 'jorogumo')!;
const prepared = () => useCombatStore.getState().preparedAttacks;
const webs = () => units().filter((u) => u.objective?.kind === WEB_KIND && u.currentHp > 0);
const threads = () => units().filter((u) => u.objective?.kind === THREAD_KIND && u.currentHp > 0);
const hanging = () => hasEffect(spider(), AuraType.Suspended);
/** Cut every thread: the last one drags her down. */
function dragDown() {
  for (const t of threads()) useCombatStore.getState().damageUnit(t.id, 999999);
}
const webbed = () => units().filter((u) => u.isPlayer && hasEffect(u, AuraType.Webbed)).map((u) => u.id).sort();

function start(heroes: CombatUnit[]) {
  const store = useCombatStore.getState();
  store.reset();
  const [jorogumo] = createEnemyUnits(['jorogumo'], [at(0, -3)], 1, 1);
  store.initCombat(heroes, [jorogumo]);
}

/** Every free hero has had their turn since the warning. */
function partyAnswers() {
  const store = useCombatStore.getState();
  for (const p of prepared()) store.updatePreparedAttack(p.id, { responded: p.responders });
}

/** One regular turn of hers through the real turn start and the real AI. */
function spiderTurn(): 'resolved' | 'acted' | string {
  const unit = spider();
  const start = beginTurn(unit.id, SILENT_SINK);
  if (start.kind === 'resolved') return 'resolved';
  if (start.kind !== 'act') return start.kind;
  executeAIActions(unit, decideEnemyAction(spider(), units()));
  return 'acted';
}

const fourHeroes = () => [
  hero('a', at(0, 0), { stats: makeStats({ maxHp: 4000, attack: 60, defense: 0, speed: 5, critChance: 0, dodgeChance: 0 }) }),
  hero('b', at(2, -1)),
  hero('c', at(-2, 1)),
  hero('d', at(1, 1)),
];

describe('the web', () => {
  it('wraps the hardest hitter in a 1-health web that stands on their hex', () => {
    start(fourHeroes());
    expect(spiderTurn()).toBe('acted');
    const [web] = webs();
    expect(webs()).toHaveLength(1);
    expect(web.currentHp).toBe(1);
    expect(web.stats.maxHp).toBe(1);
    expect(web.position).toEqual(find('a').position);
    expect(webbed()).toEqual(['a']);
    // A lookup by hex finds the web, not the hero inside it
    expect(useCombatStore.getState().getUnitAt(find('a').position)?.id).toBe(web.id);
  });

  it('holds the webbed hero out of the fight: no turn, no harm, not a target', () => {
    start(fourHeroes());
    spiderTurn();
    const before = find('a').currentHp;
    useCombatStore.getState().damageUnit('a', 500);
    expect(find('a').currentHp).toBe(before);
    expect(isHiddenFrom(find('a'), swing)).toBe(true);
    expect(beginTurn('a', SILENT_SINK).kind).toBe('inert');
  });

  it('is cut by any hit: the hero is freed and, with no web left, the bite is called off', () => {
    start(fourHeroes());
    spiderTurn();
    const [web] = webs();
    resolveSkillUse(find('b'), tap, web.position, SILENT_SINK);
    expect(find(web.id).currentHp).toBe(0);
    expect(webbed()).toEqual([]);
    expect(prepared()).toHaveLength(0);
  });

  it('is torn away by an area blow that catches its hex, and the hero inside is not hurt', () => {
    start(fourHeroes());
    spiderTurn();
    const [web] = webs();
    // Centred beside the web, so only the ring's edge catches it
    resolveSkillUse(find('d'), burst, at(1, 0), SILENT_SINK);
    expect(find(web.id).currentHp).toBe(0);
    expect(webbed()).toEqual([]);
    expect(find('a').currentHp).toBe(find('a').stats.maxHp);
  });
});

describe('the bite', () => {
  it('is announced over the webbed hero and owed a turn by every free hero', () => {
    start(fourHeroes());
    spiderTurn();
    const warning = prepared()[0];
    expect(warning.scripted).toBe('web');
    expect(warning.hexes).toEqual([find('a').position]);
    expect(warning.responders.sort()).toEqual(['b', 'c', 'd']);
    expect(isPreparedDue(warning, units())).toBe(false);
    // The banner says who is held and that she bites them next
    const line = warningLines(prepared(), prepared().map((p) => previewPrepared(p, units())), units())[0];
    expect(line.detail).toMatch(/a is webbed and cannot act/);
    // Hanging on her threads, she drops rather than dashes
    expect(line.detail).toMatch(/next turn she drops onto them and bites/);
    expect(line.detail).toMatch(/1 health/);
  });

  it('never lands in the round the web was spun: it waits on every free hero', () => {
    start(fourHeroes());
    spiderTurn();
    // Her very next chance, before the party has had its turns, lands nothing
    expect(resolveDuePrepared(spider().id, SILENT_SINK)).toHaveLength(0);
    // Two of the three free heroes have answered: still nothing
    const warning = prepared()[0];
    useCombatStore.getState().updatePreparedAttack(warning.id, { responded: ['b', 'c'] });
    expect(resolveDuePrepared(spider().id, SILENT_SINK)).toHaveLength(0);
    expect(webbed()).toEqual(['a']);
  });

  it('lands on her next turn on a hero still webbed: she dashes beside them and bites hard', () => {
    start(fourHeroes());
    spiderTurn();
    partyAnswers();
    expect(spiderTurn()).toBe('resolved');
    expect(hexDistance(spider().position, find('a').position)).toBe(1);
    expect(webbed()).toEqual([]);
    expect(webs()).toHaveLength(0);
    const lost = find('a').stats.maxHp - find('a').currentHp;
    expect(lost).toBeGreaterThan(0);
    expect(hasEffect(find('a'), AfflictionType.Poison)).toBe(true);
  });

  it('bites only a hero a web still holds', () => {
    start(fourHeroes());
    // Second volley: two webs
    spiderTurn();
    partyAnswers();
    spiderTurn();
    spiderTurn();
    spiderTurn();
    expect(webs()).toHaveLength(2);
    const [cut, kept] = webs();
    const freedId = cut.objective!.linkedUnitId!;
    const heldId = kept.objective!.linkedUnitId!;
    const freedHp = find(freedId).currentHp;
    resolveSkillUse(find(['a', 'b', 'c', 'd'].find((id) => !webbed().includes(id))!), tap, cut.position, SILENT_SINK);
    partyAnswers();
    expect(spiderTurn()).toBe('resolved');
    expect(find(freedId).currentHp).toBe(freedHp);
    expect(find(heldId).currentHp).toBeLessThan(find(heldId).stats.maxHp);
  });

  it('is not broken by a Stun while she hangs: up there nothing reaches her', () => {
    start(fourHeroes());
    spiderTurn();
    const bash = makeSkill({
      id: 'bash' as HeroSkill['id'], damage: 0.1, range: 8,
      appliesEffect: { type: AfflictionType.Stun, magnitude: 1, duration: 1 },
    });
    resolveSkillUse(find('b'), bash, spider().position, SILENT_SINK);
    expect(prepared()).toHaveLength(1);
  });

  it('is broken by a Stun on her once she is dragged down', () => {
    start(fourHeroes());
    dragDown();
    spiderTurn();
    const bash = makeSkill({
      id: 'bash' as HeroSkill['id'], damage: 0.1, range: 8,
      appliesEffect: { type: AfflictionType.Stun, magnitude: 1, duration: 1 },
    });
    resolveSkillUse(find('b'), bash, spider().position, SILENT_SINK);
    expect(prepared()).toHaveLength(0);
    // The web still holds: the party has bought a round, not the hero
    expect(webbed()).toEqual(['a']);
  });

  it('with every web cut, her bite turn is an ordinary attack', () => {
    start(fourHeroes());
    spiderTurn();
    resolveSkillUse(find('b'), tap, webs()[0].position, SILENT_SINK);
    partyAnswers();
    expect(spiderTurn()).toBe('acted');
    expect(webs()).toHaveLength(0);
    expect(prepared()).toHaveLength(0);
  });
});

describe('her cycle', () => {
  it('runs web → bite → attack, and the volleys grow one, two, then three while one hero stays free', () => {
    start(fourHeroes());
    const log: string[] = [];
    const note = (what: string) => log.push(`${what}:${webbed().length}`);

    spiderTurn(); note('web1');
    partyAnswers();
    expect(spiderTurn()).toBe('resolved'); note('bite');
    spiderTurn(); note('attack');
    spiderTurn(); note('web2');
    partyAnswers();
    expect(spiderTurn()).toBe('resolved'); note('bite');
    spiderTurn(); note('attack');
    // Third volley wants three, but one web is still standing from the second: the free
    // heroes are three, so it spins two and leaves one free
    spiderTurn(); note('web3');
    expect(log).toEqual(['web1:1', 'bite:0', 'attack:0', 'web2:2', 'bite:1', 'attack:1', 'web3:3']);
    expect(units().filter((u) => u.isPlayer && u.currentHp > 0 && !hasEffect(u, AuraType.Webbed))).toHaveLength(1);
    // and the web left from before is warned of again
    expect(prepared()[0].hexes).toHaveLength(3);
  });

  it('escalates to four, then to every hero she can, never leaving the party without a free hero', () => {
    expect([1, 2, 3, 4, 5, 6].map((v) => volleySize(v, 9))).toEqual([1, 2, 3, 4, 8, 8]);
    expect(volleySize(4, 3)).toBe(2);
    expect(volleySize(1, 1)).toBe(0);
    expect(BALANCE.JOROGUMO_ESCALATING_VOLLEYS).toBe(4);
  });

  it('never webs the last free hero', () => {
    start([hero('solo', at(0, 0))]);
    spiderTurn();
    expect(webs()).toHaveLength(0);
    expect(prepared()).toHaveLength(0);
  });

  it('keeps a web turn she could not use: dragged down and out of reach, she closes and webs next time', () => {
    start([hero('a', at(0, 5)), hero('b', at(-1, 5))]);
    dragDown();
    useCombatStore.getState().moveUnit(spider().id, at(3, -5));
    spiderTurn();
    expect(webs()).toHaveLength(0);
    // Closer now; once in reach she webs on the next turn
    let tries = 0;
    while (webs().length === 0 && tries++ < 4) spiderTurn();
    expect(webs()).toHaveLength(1);
  });
});

describe('a web gives way', () => {
  it('when she falls', () => {
    start(fourHeroes());
    spiderTurn();
    dragDown();
    useCombatStore.getState().damageUnit(spider().id, 999999);
    expect(webbed()).toEqual([]);
    expect(webs()).toHaveLength(0);
  });

  it('when no hero is left free to answer it', () => {
    start([hero('a', at(0, 0), { stats: makeStats({ maxHp: 4000, attack: 60, speed: 5 }) }), hero('b', at(2, -1))]);
    spiderTurn();
    expect(webbed()).toEqual(['a']);
    useCombatStore.getState().damageUnit('b', 999999);
    scriptsBetweenTurns(SILENT_SINK);
    expect(webbed()).toEqual([]);
    expect(webs()).toHaveLength(0);
  });
});

describe('the canopy weaver', () => {
  it('opens hanging over her perch on three threads, out of reach of everything', () => {
    start(fourHeroes());
    expect(threads()).toHaveLength(3);
    expect(hexKey(spider().position)).toBe(hexKey(weaverPerch()));
    expect(hanging()).toBe(true);
    expect(isHiddenFrom(spider(), swing)).toBe(true);
    expect(isHiddenFrom(spider(), burst)).toBe(true);
    const hp = spider().currentHp;
    useCombatStore.getState().damageUnit(spider().id, 500);
    expect(spider().currentHp).toBe(hp);
    useCombatStore.getState().applyEffect(spider().id, { type: AfflictionType.Stun, magnitude: 1, duration: 1 });
    expect(hasEffect(spider(), AfflictionType.Stun)).toBe(false);
    // The threads are what can be struck
    expect(isHiddenFrom(threads()[0], swing)).toBe(false);
  });

  it('webs from the canopy any hero on the board, however far', () => {
    start([hero('far', at(-3, 5), { stats: makeStats({ maxHp: 4000, attack: 90, speed: 5 }) }), hero('b', at(0, 4))]);
    expect(hexDistance(spider().position, find('far').position)).toBeGreaterThan(BALANCE.JOROGUMO_WEB_RANGE);
    spiderTurn();
    expect(webbed()).toEqual(['far']);
  });

  it('never walks while she hangs', () => {
    start([hero('a', at(0, 5)), hero('b', at(-1, 5))]);
    for (let i = 0; i < 4; i++) {
      const actions = decide(spider(), units());
      expect(actions.some((a) => a.type === 'move')).toBe(false);
      spiderTurn();
      partyAnswers();
    }
  });

  it('drops onto a webbed hero to bite, still out of reach, and climbs back up between turns', () => {
    start(fourHeroes());
    spiderTurn();
    partyAnswers();
    expect(spiderTurn()).toBe('resolved');
    expect(hexDistance(spider().position, find('a').position)).toBe(1);
    expect(find('a').currentHp).toBeLessThan(find('a').stats.maxHp);
    expect(hanging()).toBe(true);
    expect(isHiddenFrom(spider(), swing)).toBe(true);
    scriptsBetweenTurns(SILENT_SINK);
    expect(hexKey(spider().position)).toBe(hexKey(weaverPerch()));
  });

  it('stays up while any thread stands, and the last one cut drags her down to fight on the board', () => {
    start(fourHeroes());
    const [first, second, last] = threads();
    useCombatStore.getState().damageUnit(first.id, 999999);
    useCombatStore.getState().damageUnit(second.id, 999999);
    expect(hanging()).toBe(true);
    expect(spider().bossPhase ?? 0).toBe(0);
    useCombatStore.getState().damageUnit(last.id, 999999);
    expect(spider().bossPhase).toBe(1);
    expect(hanging()).toBe(false);
    expect(isHiddenFrom(spider(), swing)).toBe(false);
    expect(spider().skills.map((s) => s.id)).toEqual(JOROGUMO_GROUND_SKILLS.map((s) => s.id));
    const hp = spider().currentHp;
    resolveSkillUse(find('b'), swing, spider().position, SILENT_SINK);
    expect(spider().currentHp).toBeLessThan(hp);
  });

  it('pays a backlash for every thread cut while she hangs, and the last one also drags her down', () => {
    start(fourHeroes());
    const max = spider().stats.maxHp;
    const step = Math.max(1, Math.round(max * BALANCE.JOROGUMO_WEAVER.THREAD_BACKLASH));
    const [first, second, last] = threads();
    useCombatStore.getState().damageUnit(first.id, 999999, 'a');
    expect(hanging()).toBe(true);
    expect(spider().currentHp).toBe(max - step);
    useCombatStore.getState().damageUnit(second.id, 999999, 'a');
    expect(hanging()).toBe(true);
    expect(spider().currentHp).toBe(max - 2 * step);
    // Still out of reach of everything else while one thread holds her
    useCombatStore.getState().damageUnit(spider().id, 500, 'a');
    expect(spider().currentHp).toBe(max - 2 * step);
    useCombatStore.getState().damageUnit(last.id, 999999, 'a');
    expect(spider().currentHp).toBe(max - 3 * step);
    expect(spider().bossPhase).toBe(1);
    expect(hanging()).toBe(false);
  });

  it('spits Canopy Venom at the hero farthest from her threads on her attack turn', () => {
    start(fourHeroes());
    spiderTurn();
    // Every web cut: her bite turn is an ordinary attack, from the canopy
    for (const w of webs()) useCombatStore.getState().damageUnit(w.id, 1, 'b');
    const mark = venomTarget(spider(), units(), canopyVenom)!;
    const before = new Map(units().filter((u) => u.isPlayer).map((u) => [u.id, u.currentHp]));
    const start2 = beginTurn(spider().id, SILENT_SINK);
    expect(start2.kind).toBe('act');
    const actions = decideEnemyAction(spider(), units());
    const cast = actions.find((a) => a.type === 'skill');
    expect(cast?.skill?.id).toBe('canopy_venom');
    expect(cast?.skillTarget).toEqual(mark.position);
    executeAIActions(spider(), actions);
    const hurt = units().filter((u) => u.isPlayer && u.currentHp < before.get(u.id)!).map((u) => u.id);
    expect(hurt).toEqual([mark.id]);
  });

  it('pays nothing when a web is cut', () => {
    start(fourHeroes());
    spiderTurn();
    expect(webs()).toHaveLength(1);
    const hp = spider().currentHp;
    useCombatStore.getState().damageUnit(webs()[0].id, 1, 'b');
    expect(webs()).toHaveLength(0);
    expect(spider().currentHp).toBe(hp);
  });

  it('dragged down, runs her web cycle again from one web', () => {
    start(fourHeroes());
    dragDown();
    spiderTurn();
    expect(webs()).toHaveLength(1);
  });
});
