import {
  AfflictionType,
  CombatUnit,
  HeroSkill,
  ReactionSpec,
  SkillTargetType,
} from '@/models/types';
import { reactionLines } from '@/data/display/reactionDisplay';
import { skillEffectLines } from '@/data/display/skillDisplay';
import { useCombatStore } from '@/stores/combatStore';
import { requireUnit } from '@/systems/combat/unitLookup';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { flushReactions } from '@/systems/combat/reactionResolve';
import { reactionSummary, reactionsMatching } from '@/systems/combat/reactions';
import { CombatSink, resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { beginTurn } from '@/systems/combat/turnStart';
import { at, makeEffect, makeFoe, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * Prepared Reactions: trade the turn for a conditional answer.
 *
 * What is pinned is the contract — the turn is spent, the trigger fires once at
 * the documented moment, an unmet reaction expires without a free action, bonus
 * turns do not extend it, and heroes and enemies share one resolver — not the
 * numbers the tests happen to use.
 */

const strike = (over: Partial<HeroSkill> = {}): HeroSkill =>
  makeSkill({ id: 'test_counter' as HeroSkill['id'], name: 'Counter', damage: 2, range: 1, ...over });

const reactionSkill = (over: Partial<ReactionSpec> = {}, skill: Partial<HeroSkill> = {}): HeroSkill =>
  makeSkill({
    id: 'test_brace' as HeroSkill['id'],
    name: 'Brace',
    targetType: SkillTargetType.Self,
    range: 0,
    manaCost: 4,
    cooldown: 3,
    reaction: { trigger: { kind: 'struck', melee: true }, duration: 2, response: strike(), ...over },
    ...skill,
  });

const stats = (over = {}) => makeStats({ maxHp: 500, attack: 20, defense: 0, critChance: 0, dodgeChance: 0, ...over });

const tank = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'tank', heroId: 'tank', position: at(0, 0), stats: stats({ speed: 10 }), skills: [reactionSkill()], ...over });
const ally = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'ally', heroId: 'ally', position: at(-1, 1), stats: stats({ speed: 8 }), ...over });
const goblin = (over: Partial<CombatUnit> = {}) =>
  makeFoe({ id: 'goblin', position: at(1, 0), stats: stats({ speed: 6 }), ...over });

const state = () => useCombatStore.getState();
const units = () => state().units;
const unit = (id: string) => requireUnit(units(), id);

function start(players: CombatUnit[], enemies: CombatUnit[]) {
  setTempoRandom(() => 1);
  state().reset();
  state().initCombat(players, enemies);
}

const logs: string[] = [];
const sink: CombatSink = { ...SILENT_SINK, log: (text) => { logs.push(text); } };
beforeEach(() => { logs.length = 0; });

const prepare = (id = 'tank', skill = reactionSkill()) =>
  resolveSkillUse(unit(id), skill, unit(id).position, SILENT_SINK);
const hit = (target: string, attacker: string, amount = 10) => state().damageUnit(target, amount, attacker);

describe('preparing', () => {
  it('spends the whole turn and deals nothing now', () => {
    start([tank()], [goblin()]);
    const result = prepare();

    expect(result.ok).toBe(true);
    expect(result.endsTurn).toBe(true);
    expect(state().reactions).toHaveLength(1);
    expect(unit('goblin').currentHp).toBe(500);
    // Move and action both: a Reaction is the turn
    expect(unit('tank').hasMoved).toBe(true);
    expect(unit('tank').hasActed).toBe(true);
    // Paid at the cast
    expect(unit('tank').currentMana).toBeLessThan(50);
    expect(unit('tank').cooldowns?.test_brace).toBeGreaterThan(0);
  });

  it('is one at a time: a second cast while one stands is refused', () => {
    start([tank()], [goblin()]);
    prepare();
    const again = prepare('tank', reactionSkill({}, { id: 'test_brace_2' as HeroSkill['id'], cooldown: 0 }));
    expect(again.ok).toBe(false);
    expect(state().reactions).toHaveLength(1);
  });

  it('says what sets it off and for how long, from one rule', () => {
    const skill = reactionSkill();
    expect(reactionSummary(skill)).toBe('When struck in melee · ready 2 turns');
    expect(skillEffectLines(skill).join(' ')).toContain('struck in melee');

    start([tank()], [goblin()]);
    prepare();
    const [line] = reactionLines(state().reactions, units());
    expect(line.title).toContain('tank');
    expect(line.detail).toContain('struck in melee');
    expect(line.detail).toContain('2 turns left');
  });

  it('leaves the banner when its owner falls (playtest 2026-10-23b, PT-02)', () => {
    start([tank()], [goblin()]);
    prepare();
    const fallen = units().map((u) => (u.id === 'tank' ? { ...u, currentHp: 0 } : u));
    expect(reactionLines(state().reactions, fallen)).toHaveLength(0);
  });
});

describe('firing', () => {
  it('answers a melee blow with the response, once, and is then spent', () => {
    start([tank()], [goblin()]);
    prepare();

    hit('tank', 'goblin');
    flushReactions(sink);
    expect(unit('goblin').currentHp).toBeLessThan(500);
    expect(state().reactions).toHaveLength(0);
    expect(logs.some((l) => l.includes('Brace') && l.includes('answers'))).toBe(true);

    const after = unit('goblin').currentHp;
    hit('tank', 'goblin');
    flushReactions(sink);
    expect(unit('goblin').currentHp).toBe(after);
  });

  it('waits for the action that set it off to finish: recording is not firing', () => {
    start([tank()], [goblin()]);
    prepare();
    hit('tank', 'goblin');
    // The blow is on the record and nothing has answered yet
    expect(state().reactionEvents).toHaveLength(1);
    expect(unit('goblin').currentHp).toBe(500);
    expect(state().reactions).toHaveLength(1);
  });

  it('lands before the next unit acts: beginTurn answers what is owed first', () => {
    start([tank()], [goblin()]);
    prepare();
    hit('tank', 'goblin');
    beginTurn('goblin', sink);
    expect(unit('goblin').currentHp).toBeLessThan(500);
    expect(state().reactions).toHaveLength(0);
    expect(state().reactionEvents).toHaveLength(0);
  });

  it('is judged once the whole blow has landed: one reaction, however many hits', () => {
    start([tank()], [goblin(), makeFoe({ id: 'g2', position: at(1, -1), stats: stats() })]);
    prepare();
    hit('tank', 'goblin');
    hit('tank', 'g2');
    flushReactions(sink);
    // Spent on the first; the second finds nothing waiting
    const struck = ['goblin', 'g2'].filter((id) => unit(id).currentHp < 500);
    expect(struck).toEqual(['goblin']);
  });

  it('does not answer a blow that is not what it waits for', () => {
    start([tank()], [goblin({ position: at(3, 0) })]);
    prepare();
    // A melee stance ignores a blow from three hexes away
    hit('tank', 'goblin');
    flushReactions(sink);
    expect(state().reactions).toHaveLength(1);
    // And damage with no author is nobody's hostile act
    state().damageUnit('tank', 10);
    expect(state().reactionEvents).toHaveLength(0);
    // Nor does a blow on somebody else
    start([tank(), ally()], [goblin()]);
    prepare();
    hit('ally', 'goblin');
    flushReactions(sink);
    expect(state().reactions).toHaveLength(1);
  });

  it('can wait on an ally being struck instead', () => {
    const guard = reactionSkill({ trigger: { kind: 'allyStruck' }, duration: 1 });
    start([tank({ skills: [guard] }), ally()], [goblin()]);
    prepare('tank', guard);
    hit('tank', 'goblin');
    flushReactions(sink);
    expect(state().reactions).toHaveLength(1); // the owner itself is not an ally
    hit('ally', 'goblin');
    flushReactions(sink);
    expect(state().reactions).toHaveLength(0);
    expect(unit('goblin').currentHp).toBeLessThan(500);
  });

  it('can wait on a foe coming close', () => {
    const watch = reactionSkill({ trigger: { kind: 'foeApproaches', reach: 1 }, duration: 1 });
    start([tank({ skills: [watch] })], [goblin({ position: at(3, 0) })]);
    prepare('tank', watch);

    state().moveUnit('goblin', at(2, 0));
    flushReactions(sink);
    expect(state().reactions).toHaveLength(1); // still outside its reach

    state().moveUnit('goblin', at(1, 0));
    flushReactions(sink);
    expect(state().reactions).toHaveLength(0);
    expect(unit('goblin').currentHp).toBeLessThan(500);
  });

  it('cannot answer while stunned, and keeps waiting', () => {
    start([tank()], [goblin()]);
    prepare();
    state().applyEffect('tank', makeEffect(AfflictionType.Stun, { duration: 1 }));
    hit('tank', 'goblin');
    flushReactions(sink);
    expect(unit('goblin').currentHp).toBe(500);
    expect(state().reactions).toHaveLength(1);
  });

  it('never fires for an owner that has fallen', () => {
    start([tank()], [goblin()]);
    prepare();
    hit('tank', 'goblin', 99999);
    flushReactions(sink);
    expect(unit('goblin').currentHp).toBe(500);
  });
});

describe('ordering', () => {
  it('answers one event in the order the reactions were prepared', () => {
    const answer = (name: string) =>
      reactionSkill({ trigger: { kind: 'allyStruck' }, duration: 2, response: strike({ name, damage: 0.1 }) },
        { id: `brace_${name}` as HeroSkill['id'], name: `Brace ${name}` });
    const first = answer('one');
    const second = answer('two');
    start(
      [
        makeUnit({ id: 'p1', heroId: 'p1', position: at(0, 0), stats: stats(), skills: [first] }),
        makeUnit({ id: 'p2', heroId: 'p2', position: at(0, 1), stats: stats(), skills: [second] }),
        ally(),
      ],
      [goblin({ position: at(1, 0) })],
    );
    // Prepared in the order p2 then p1 — and that, not the roster, is the order
    prepare('p2', second);
    prepare('p1', first);

    hit('ally', 'goblin');
    const matches = reactionsMatching(state().reactionEvents[0], state().reactions, units());
    expect(matches.map((m) => m.reaction.ownerId)).toEqual(['p2', 'p1']);

    flushReactions(sink);
    const order = logs.filter((l) => l.includes('answers')).map((l) => l.split("'s")[0]);
    expect(order).toEqual(['p2', 'p1']);
  });

  it('lets answers set off answers, each only once, and so always ends', () => {
    const retort = (name: string) =>
      reactionSkill({ trigger: { kind: 'struck' }, duration: 3, response: strike({ name, damage: 0.1 }) },
        { id: `retort_${name}` as HeroSkill['id'], name: `Retort ${name}` });
    const a = retort('a');
    const b = retort('b');
    start(
      [makeUnit({ id: 'a', heroId: 'a', position: at(0, 0), stats: stats(), skills: [a] })],
      [makeFoe({ id: 'b', position: at(1, 0), stats: stats(), skills: [b] })],
    );
    prepare('a', a);
    resolveSkillUse(unit('b'), b, unit('b').position, SILENT_SINK);
    expect(state().reactions).toHaveLength(2);

    hit('a', 'b');
    flushReactions(sink);
    expect(state().reactions).toHaveLength(0);
    expect(logs.filter((l) => l.includes('answers'))).toHaveLength(2);
  });
});

describe('expiring', () => {
  it('counts down on the owner\'s own regular turns and expires with no free action', () => {
    start([tank()], [goblin()]);
    prepare();
    expect(state().reactions[0].turnsLeft).toBe(2);

    beginTurn('tank', sink);
    expect(state().reactions[0].turnsLeft).toBe(1);
    expect(state().reactions).toHaveLength(1);

    beginTurn('tank', sink);
    expect(state().reactions).toHaveLength(0);
    expect(logs.some((l) => l.includes('fades unused'))).toBe(true);
    // The turn it cost is not refunded: nothing was dealt, nothing is owed
    expect(unit('goblin').currentHp).toBe(500);
  });

  it('is not counted down by other units\' turns', () => {
    start([tank(), ally()], [goblin()]);
    prepare();
    beginTurn('ally', sink);
    beginTurn('goblin', sink);
    expect(state().reactions[0].turnsLeft).toBe(2);
  });

  it('is never extended or shortened by a bonus turn', () => {
    setTempoRandom(() => 0);
    state().reset();
    // A tank twice as fast as the goblin is granted a bonus turn after its first
    state().initCombat(
      [tank({ stats: stats({ speed: 20 }) })],
      [goblin({ stats: stats({ speed: 8 }) })],
    );
    expect(state().bonusTurn.pending).toBe('tank');
    prepare();
    expect(state().reactions[0].turnsLeft).toBe(2);

    state().nextTurn(); // the bonus turn
    expect(state().bonusTurn.active).toBe(true);
    beginTurn('tank', sink);
    expect(state().reactions[0].turnsLeft).toBe(2);
    // …and it may not prepare a second while the first stands
    const second = reactionSkill({}, { id: 'second_brace' as HeroSkill['id'], cooldown: 0 });
    expect(resolveSkillUse(unit('tank'), second, unit('tank').position, SILENT_SINK).ok).toBe(false);
    setTempoRandom(() => 1);
  });
});

describe('one resolver for both sides', () => {
  it('lets an enemy prepare and fire a Reaction exactly as a hero does', () => {
    const lurk = reactionSkill({ trigger: { kind: 'foeApproaches', reach: 1 }, duration: 2 });
    const ambusher = makeFoe({ id: 'goblin', position: at(2, 0), stats: stats({ speed: 6 }), skills: [lurk] });
    start([makeUnit({ id: 'tank', heroId: 'tank', position: at(5, 0), stats: stats() })], [ambusher]);

    // The AI scores it when someone is near enough to matter…
    const actions = decideEnemyAction(unit('goblin'), units());
    const cast = actions.find((a) => a.type === 'skill');
    expect(cast?.skill?.id as string).toBe('test_brace');
    // …and prepares it through the shared cast
    executeAIActions(unit('goblin'), actions, { ...SILENT_SINK, log: (t) => { logs.push(t); } });
    expect(state().reactions).toHaveLength(1);
    expect(state().reactions[0].ownerId).toBe('goblin');
    expect(unit('goblin').hasActed).toBe(true);

    // A hero walking up to it sets it off, answered by the same flush
    state().moveUnit('tank', at(4, 0));
    flushReactions(sink);
    expect(state().reactions).toHaveLength(1);
    state().moveUnit('tank', at(3, 0));
    flushReactions(sink);
    expect(state().reactions).toHaveLength(0);
    expect(unit('tank').currentHp).toBeLessThan(500);
  });

  it('is not prepared by the AI with nobody near, nor twice', () => {
    const lurk = reactionSkill({ trigger: { kind: 'struck' }, duration: 2 });
    start(
      [makeUnit({ id: 'tank', heroId: 'tank', position: at(3, 5), stats: stats() })],
      [makeFoe({ id: 'goblin', position: at(0, -5), stats: stats(), skills: [lurk] })],
    );
    const far = decideEnemyAction(unit('goblin'), units());
    expect(far.some((a) => (a.skill?.id as string) === 'test_brace')).toBe(false);

    state().moveUnit('tank', at(0, -3));
    resolveSkillUse(unit('goblin'), lurk, unit('goblin').position, SILENT_SINK);
    const again = decideEnemyAction(unit('goblin'), units());
    expect(again.some((a) => (a.skill?.id as string) === 'test_brace')).toBe(false);
  });
});
