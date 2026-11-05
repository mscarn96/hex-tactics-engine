import { useCombatStore } from '@/stores/combatStore';
import { BALANCE } from '@/data/balanceConstants';
import { JUMP_MS } from '@/data/display/combatMotion';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import {
  bonebreakerSweep,
  boundarySmash,
  farthestPrey,
  TROLL_PHASES,
  TROLL_SKILLS,
  warrenCollapse,
} from '@/data/templates/trollChieftain';
import { AfflictionType, AuraType, CombatUnit, HexCoord, VfxSpec } from '@/models/types';
import { arcHexes, arenaHexes } from '@/systems/combat/arenaGeometry';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { getMovementRange } from '@/systems/combat/movement';
import { requireUnit } from '@/systems/combat/unitLookup';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { isPreparedDue, preparedBy, previewPrepared, warnedPushes } from '@/systems/combat/preparedAttacks';
import { resolveDuePrepared } from '@/systems/combat/preparedResolve';
import { CombatSink, SILENT_SINK } from '@/systems/combat/skillResolution';
import { beginTurn } from '@/systems/combat/turnStart';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import {
  actionsPerTurn,
  chooseTrollMove,
  collapseCentre,
  collapseFootprint,
  heapsOf,
  isFurious,
  isTroll,
  preyFootprint,
  preyLanding,
  preyTarget,
  PREY_EXPOSED_TURNS,
  routesConnected,
  rubbleHexes,
  RUBBLE_KIND,
  TROLL_CYCLE,
  trollIntent,
  trollPreyLanding,
  upcomingMoves,
} from '@/systems/combat/trollScript';
import { castTrollMove } from '@/systems/combat/trollActions';
import { hasEffect } from '@/systems/combat/statusEffects';
import { directionToward } from '@/systems/combat/facing';
import { warningLines } from '@/data/display/preparedDisplay';
import { answersOf } from '@/systems/combat/warnedAnswers';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { at, makeStats, makeUnit } from '../support/fixtures';

/**
 * The Troll Chieftain's fight — the rules, not the numbers.
 *
 * Every assertion is something the plan promises the party: the cycle is fixed
 * and a bonus turn takes the next slot rather than skipping one; a warning is
 * the attack that lands and nothing a bonus action does can bring it forward;
 * the wound stacks until cleansed; Fury adds a Sweep without advancing the
 * cycle; rubble never lies under a unit or seals the board and goes after a
 * round. Tuned values (`TROLL_*` in `balanceConstants`) are used by name.
 */

const store = () => useCombatStore.getState();
const unitOf = (id: string) => requireUnit(store().units, id);
const fx = { log: () => {} };

const boss = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({
    id: 'boss',
    name: 'Troll',
    isPlayer: false,
    templateId: 'troll_chieftain',
    stats: makeStats({ maxHp: 1000, attack: 30, magic: 0, defense: 10, speed: 5, moveRange: 2, maxMana: 0 }),
    position: at(0, -1),
    skills: TROLL_PHASES[0].skills,
    ...over,
  });

const hero = (id: string, position: HexCoord, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({
    id,
    name: id,
    heroId: id,
    position,
    stats: makeStats({ maxHp: 300, attack: 20, defense: 12, magic: 20, speed: 8, maxMana: 40 }),
    ...over,
  });

function arena(over: { heroes?: CombatUnit[]; boss?: Partial<CombatUnit> } = {}) {
  store().reset();
  const heroes = over.heroes ?? [hero('a', at(0, 2)), hero('b', at(2, 1))];
  store().initCombat(heroes, [boss(over.boss)]);
  // The boss opens the fight, so the tests can hand over turns without a roll
  store().patchBossScript('boss', { phaseTurns: 1 });
}

const prepared = () => preparedBy('boss', store().preparedAttacks);
/** The Sweep's arc from where he stands, aimed at `target`. */
const getSkillTargetsOf = (target: HexCoord) => arcHexes(bonebreakerSweep, unitOf('boss').position, target);
const fury = (): void => {
  store().applyEffect('boss', {
    type: AuraType.Fury,
    magnitude: BALANCE.TROLL_FURY_DAMAGE,
    duration: -1,
    sourceUnitId: 'boss',
  });
};
const rubble = () => store().hazards.filter((h) => h.solid).flatMap((h) => h.hexes);
/** Lays heaps of his rubble, as a Collapse would have. */
const heaps = (...hexes: HexCoord[]) =>
  store().addHazard({ id: 'fort', hexes, solid: true, label: 'bossLog.hazard.rubble', lasts: 'replaced', kind: RUBBLE_KIND, ownerId: 'boss' });
const standing = () => heapsOf('boss', store().hazards).map(hexKey).sort();
/** Hands the turn to him, as the order would have, so a test can end it. */
const bossToAct = () => useCombatStore.setState({ currentUnitId: 'boss' });

afterEach(() => setTempoRandom(() => 1));

// ─── The kit's own shape ─────────────────────────────────────────────────────

describe('the kit', () => {
  it('makes the repeatable move an arc, never a single-target fallback', () => {
    expect(bonebreakerSweep.targetType).toBe('arc');
    expect(bonebreakerSweep.prepares).toBeUndefined();
  });

  it('puts the three signatures through the one preparation rule', () => {
    for (const skill of [farthestPrey, boundarySmash, warrenCollapse]) expect(skill.prepares).toBeDefined();
  });

  it('names each signature\'s answers: the leap is stepped out of, the Smash braced against, the roof shared', () => {
    const kinds = (skill: typeof farthestPrey) => answersOf(skill.prepares!).map((a) => a.kind);
    expect(kinds(farthestPrey)).toEqual(['step']);
    expect(kinds(boundarySmash)).toEqual(['step', 'brace']);
    expect(kinds(warrenCollapse)).toEqual(['share', 'step']);
  });

  it('has four distinct moves and nothing else, none shared with another enemy', () => {
    expect(TROLL_SKILLS.map((s) => s.id)).toEqual([
      'bonebreaker_sweep', 'farthest_prey', 'boundary_smash', 'warren_collapse',
    ]);
    for (const template of enemyTemplates.filter((t) => t.id !== 'troll_chieftain')) {
      for (const skill of template.skills) {
        expect(TROLL_SKILLS.map((s) => s.id)).not.toContain(skill.id);
      }
    }
  });

  it('no longer regenerates', () => {
    const template = enemyTemplates.find((t) => t.id === 'troll_chieftain')!;
    expect(template.passives ?? []).not.toContain('regeneration');
    expect(template.skills).toEqual(TROLL_PHASES[0].skills);
  });

  it('is only the Troll Chieftain who is scripted', () => {
    expect(isTroll(boss())).toBe(true);
    expect(isTroll(boss({ templateId: 'troll' as never }))).toBe(false);
    expect(isTroll(boss({ isPlayer: true }))).toBe(false);
  });
});

// ─── The fixed cycle ─────────────────────────────────────────────────────────

describe('the six-turn cycle', () => {
  it('is Farthest Prey, Sweep, Sweep, Boundary Smash, Sweep, Sweep', () => {
    expect(TROLL_CYCLE).toEqual(['prey', 'sweep', 'sweep', 'smash', 'sweep', 'sweep']);
  });

  it('gives the Collapse no slot of its own: however long the fight, no turn casts it', () => {
    expect(TROLL_CYCLE).not.toContain('collapse');
    arena();
    for (let i = 0; i < 24; i++) {
      const chosen = chooseTrollMove({ boss: unitOf('boss'), units: store().units, majorPending: false });
      expect(chosen.move).not.toBe('collapse');
      store().patchBossScript('boss', { step: chosen.nextStep });
    }
    // Nor does the AI, at any step of the cycle
    for (let step = 0; step < TROLL_CYCLE.length; step++) {
      arena({ heroes: [hero('a', at(0, 1)), hero('b', at(1, 0))] });
      store().patchBossScript('boss', { step });
      const actions = decideEnemyAction(unitOf('boss'), store().units);
      expect(actions.some((a) => a.skill?.id === 'warren_collapse')).toBe(false);
    }
  });

  it('takes one slot per turn and wraps', () => {
    arena();
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      const chosen = chooseTrollMove({ boss: unitOf('boss'), units: store().units, majorPending: false });
      seen.push(chosen.move);
      store().patchBossScript('boss', { step: chosen.nextStep });
    }
    expect(seen).toEqual([...TROLL_CYCLE, ...TROLL_CYCLE]);
  });

  it('holds a delayed attack behind one already open, without losing its slot', () => {
    arena();
    const chosen = chooseTrollMove({ boss: unitOf('boss'), units: store().units, majorPending: true });
    expect(chosen).toEqual({ move: 'sweep', nextStep: 0 });
  });

  it('never opens a second warning while one stands, whatever the cycle says', () => {
    arena();
    const caster = unitOf('boss');
    castTrollMove(caster, farthestPrey, fx);
    expect(prepared()).toHaveLength(1);
    // The next slot is a Sweep; but even a hand that forced a signature is refused
    expect(castTrollMove(unitOf('boss'), warrenCollapse, fx).ok).toBe(false);
    expect(prepared()).toHaveLength(1);
  });

  it('gives a speed-granted bonus turn the next slot, never skipping one', () => {
    // Fast enough that the roll can pass (the dice are pinned low for this test)
    setTempoRandom(() => 0);
    arena({ boss: { stats: makeStats({ maxHp: 1000, attack: 30, speed: 40, moveRange: 2, maxMana: 0 }) } });
    const slots: string[] = [];
    const takeTurn = () => {
      const chosen = chooseTrollMove({ boss: unitOf('boss'), units: store().units, majorPending: prepared().length > 0 });
      slots.push(chosen.move);
      store().patchBossScript('boss', { step: chosen.nextStep });
    };
    expect(store().bonusTurn.pending).toBe('boss');
    // Regular turn, then the bonus turn
    takeTurn();
    store().nextTurn();
    expect(store().bonusTurn.active).toBe(true);
    takeTurn();
    expect(slots).toEqual(['prey', 'sweep']);
  });
});

// ─── Bonebreaker Sweep and the wound ─────────────────────────────────────────

describe('the Bonebreak wound', () => {
  const wound = () =>
    store().applyEffect('a', {
      type: AfflictionType.Wound,
      magnitude: BALANCE.TROLL_WOUND_DEFENSE,
      duration: -1,
      sourceUnitId: 'boss',
    });
  const carried = () => unitOf('a').activeEffects.find((e) => e.type === AfflictionType.Wound);

  it('adds a stack per hit and has no cap', () => {
    arena();
    for (let i = 0; i < 12; i++) wound();
    expect(carried()?.stacks).toBe(12);
    expect(carried()?.magnitude).toBe(12 * BALANCE.TROLL_WOUND_DEFENSE);
  });

  it('takes defence from both defences while it stays', () => {
    arena();
    const before = getCombatEffectiveStats(unitOf('a'));
    wound();
    wound();
    const after = getCombatEffectiveStats(unitOf('a'));
    expect(after.defense).toBeLessThan(before.defense);
    expect(after.magicDefense).toBeLessThan(before.magicDefense ?? Infinity);
  });

  it('never wears off on its own, however many turns pass', () => {
    arena();
    wound();
    for (let i = 0; i < 25; i++) store().tickEffectsOnUnit('a');
    expect(carried()?.stacks).toBe(1);
    expect(carried()?.duration).toBe(-1);
  });

  it('is lifted only by a cleanse', () => {
    arena();
    wound();
    wound();
    store().removeAllAfflictions('a');
    expect(carried()).toBeUndefined();
  });

  it('is left by the Sweep on every hero it catches, one stack each', () => {
    arena({ heroes: [hero('a', at(0, 1)), hero('b', at(1, 0))] });
    const caster = unitOf('boss');
    store().setFacing('boss', at(0, 1));
    executeAIActions(caster, [{ type: 'skill', skill: bonebreakerSweep, skillTarget: at(0, 1) }]);
    expect(carried()?.stacks).toBe(1);
    const second = unitOf('b').activeEffects.find((e) => e.type === AfflictionType.Wound);
    expect(second === undefined || second.stacks === 1).toBe(true);
    // A second Sweep is a second stack
    store().beginTurnFlags('boss');
    executeAIActions(unitOf('boss'), [{ type: 'skill', skill: bonebreakerSweep, skillTarget: at(0, 1) }]);
    expect(carried()?.stacks).toBe(2);
  });
});

// ─── Farthest Prey ───────────────────────────────────────────────────────────

describe('Farthest Prey', () => {
  it('picks the hero farthest from him, anywhere in the arena', () => {
    arena({ heroes: [hero('near', at(0, 1)), hero('mid', at(1, 2)), hero('far', at(-2, 4))] });
    expect(preyTarget(unitOf('boss'), store().units)?.id).toBe('far');
  });

  it('breaks a tie on the lower health, then the lower id — the same board, the same hero', () => {
    arena({
      heroes: [
        hero('x', at(3, -1), { currentHp: 200 }),
        hero('y', at(-3, 2), { currentHp: 120 }),
        hero('z', at(0, 2), { currentHp: 120 }),
      ],
    });
    const boss0 = unitOf('boss');
    const d = (id: string) => hexDistance(boss0.position, unitOf(id).position);
    expect(d('x')).toBe(d('y'));
    expect(d('y')).toBe(d('z'));
    expect(preyTarget(boss0, store().units)?.id).toBe('y');
  });

  it('marks the one-hex area around that hero before anything happens', () => {
    arena({ heroes: [hero('a', at(0, 3)), hero('b', at(1, 0))] });
    expect(castTrollMove(unitOf('boss'), farthestPrey, fx).ok).toBe(true);
    const [attack] = prepared();
    expect(attack.scripted).toBe('prey');
    expect(attack.aim).toEqual(at(0, 3));
    expect(attack.hexes.map(hexKey).sort()).toEqual(preyFootprint(at(0, 3)).map(hexKey).sort());
    expect(attack.hexes.every((h) => hexDistance(h, at(0, 3)) <= BALANCE.TROLL_PREY_RADIUS)).toBe(true);
    // Nothing has been struck and he has not moved
    expect(unitOf('a').currentHp).toBe(300);
    expect(unitOf('boss').position).toEqual(at(0, -1));
  });

  it('lands in the marked ground on a free hex, never on anybody and never on rubble', () => {
    arena({ heroes: [hero('a', at(0, 3)), hero('b', at(1, 3)), hero('c', at(-1, 4))] });
    const footprint = preyFootprint(at(0, 3));
    const hazards = [{ id: 'r', hexes: [at(0, 2)], solid: true, label: 'Rubble' }];
    const landing = preyLanding(at(0, 3), footprint, unitOf('boss'), store().units, hazards)!;
    expect(landing).not.toBeNull();
    expect(store().units.some((u) => hexKey(u.position) === hexKey(landing))).toBe(false);
    expect(hexKey(landing)).not.toBe(hexKey(at(0, 2)));
    expect(footprint.map(hexKey)).toContain(hexKey(landing));
  });

  it('finds a free hex outside the mark when every hex inside it is taken', () => {
    const crowd = preyFootprint(at(0, 3)).map((h, i) => hero(`h${i}`, h));
    arena({ heroes: crowd });
    const landing = preyLanding(at(0, 3), preyFootprint(at(0, 3)), unitOf('boss'), store().units)!;
    expect(landing).not.toBeNull();
    expect(store().units.some((u) => u.id !== 'boss' && hexKey(u.position) === hexKey(landing))).toBe(false);
  });

  it('waits out the whole response window, then leaps in, strikes and stuns', () => {
    arena({ heroes: [hero('a', at(0, 3)), hero('b', at(3, -1))] });
    castTrollMove(unitOf('boss'), farthestPrey, fx);
    expect(isPreparedDue(prepared()[0], store().units)).toBe(false);
    // Nothing lands while a hero in the mark has yet to take a turn
    expect(resolveDuePrepared('boss', SILENT_SINK)).toEqual([]);
    expect(unitOf('boss').position).toEqual(at(0, -1));

    store().nextTurn(); // boss -> hero (order is by speed; walk the order round)
    let guard = 0;
    while (!isPreparedDue(prepared()[0], store().units) && guard++ < 6) store().nextTurn();
    expect(isPreparedDue(prepared()[0], store().units)).toBe(true);

    const specs: VfxSpec[] = [];
    const sink: CombatSink = { ...SILENT_SINK, vfx: (spec) => specs.push(spec) };
    expect(resolveDuePrepared('boss', sink)).toHaveLength(1);
    const lair = unitOf('boss').position;
    expect(hexDistance(lair, at(0, 3))).toBeLessThanOrEqual(BALANCE.TROLL_PREY_RADIUS);
    expect(unitOf('a').currentHp).toBeLessThan(300);
    expect(unitOf('a').activeEffects.some((e) => e.type === AfflictionType.Stun)).toBe(true);
    // The hero outside the mark is untouched
    expect(unitOf('b').currentHp).toBe(300);
    // The knock-up is drawn on the struck, and only drawn
    expect(specs.some((s) => s.knockUpIds?.includes('a'))).toBe(true);
    // The leap itself supplies the descent; its VFX is a ground impact after arrival.
    expect(specs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'nova', delayMs: JUMP_MS, casterId: 'boss' }),
    ]));
    expect(specs.some((s) => s.kind === 'meteor')).toBe(false);
  });

  it('draws a knock-up and changes nothing about height or turn order', () => {
    arena({ heroes: [hero('a', at(0, 3)), hero('b', at(3, -1))] });
    const order = [...store().turnOrder];
    castTrollMove(unitOf('boss'), farthestPrey, fx);
    let guard = 0;
    while (!isPreparedDue(prepared()[0], store().units) && guard++ < 6) store().nextTurn();
    const before = unitOf('a').position;
    resolveDuePrepared('boss', SILENT_SINK);
    // Stunned, but standing where it stood, and the queue is as it was
    expect(unitOf('a').position).toEqual(before);
    expect(store().turnOrder).toEqual(order);
    expect(Object.keys(unitOf('a')).includes('elevation')).toBe(false);
  });

  it('comes down on rubble in its mark: the heap breaks under him and he is Exposed for exactly one hero round', () => {
    arena({ heroes: [hero('a', at(0, 3)), hero('b', at(3, -1))] });
    // One heap in the mark, beside the hunted hero; one far away, which the leap leaves alone
    heaps(at(1, 2), at(-3, 1));
    castTrollMove(unitOf('boss'), farthestPrey, fx);
    const [attack] = prepared();
    // The banner says so before he leaps, and the landing it names is the one he makes
    const preview = previewPrepared(attack, store().units, store().hazards);
    const [line] = warningLines(prepared(), [preview], store().units, store().hazards);
    expect(line.detail).toContain('rubble in the mark');
    const named = trollPreyLanding(attack.aim, attack.hexes, unitOf('boss'), store().units, store().hazards);
    expect(named).toEqual({ hex: at(1, 2), onRubble: true });

    let guard = 0;
    while (!isPreparedDue(prepared()[0], store().units) && guard++ < 6) store().nextTurn();
    resolveDuePrepared('boss', SILENT_SINK);
    // He stands where the heap stood, the heap is gone, the other is not
    expect(unitOf('boss').position).toEqual(named!.hex);
    expect(standing()).toEqual([hexKey(at(-3, 1))]);
    const exposed = unitOf('boss').activeEffects.find((e) => e.type === AuraType.Exposed);
    expect(exposed?.magnitude).toBe(BALANCE.TROLL_PREY_EXPOSED);
    expect(exposed?.duration).toBe(PREY_EXPOSED_TURNS);
    // The pair's blows land harder while it holds
    const open = calculateDamage(unitOf('b'), unitOf('boss'), bonebreakerSweep);
    // A Fury action or a bonus turn of his ticks no clock: still Exposed
    useCombatStore.setState({ currentUnitId: 'boss', furyExtra: { active: true } });
    beginTurn('boss', SILENT_SINK);
    useCombatStore.setState({ furyExtra: { active: false } });
    expect(hasEffect(unitOf('boss'), AuraType.Exposed)).toBe(true);
    // His own next regular turn is the end of it
    useCombatStore.setState({ currentUnitId: 'boss', bonusTurn: { pending: null, active: false } });
    beginTurn('boss', SILENT_SINK);
    expect(hasEffect(unitOf('boss'), AuraType.Exposed)).toBe(false);
    expect(calculateDamage(unitOf('b'), unitOf('boss'), bonebreakerSweep)).toBeLessThan(open);
  });

  it('takes the heap nearest the centre of the mark, and lands as before when the mark holds none', () => {
    arena({ heroes: [hero('a', at(0, 3)), hero('b', at(3, -1))] });
    const footprint = preyFootprint(at(0, 3));
    const fort = (hexes: HexCoord[]) => [{ id: 'f', hexes, solid: true, label: 'Rubble', lasts: 'replaced' as const, kind: RUBBLE_KIND, ownerId: 'boss' }];
    // Both heaps are one from the centre; the one nearer where he leaps from wins the tie
    const near = trollPreyLanding(at(0, 3), footprint, unitOf('boss'), store().units, fort([at(0, 2), at(0, 4)]));
    expect(near).toEqual({ hex: at(0, 2), onRubble: true });
    // No heap of his in the mark: the free hex the ordinary leap takes, and nothing breaks
    const plain = trollPreyLanding(at(0, 3), footprint, unitOf('boss'), store().units, fort([at(-3, 0)]));
    expect(plain?.onRubble).toBe(false);
    expect(plain?.hex).toEqual(preyLanding(at(0, 3), footprint, unitOf('boss'), store().units, fort([at(-3, 0)])));
    // Solid ground that is not his rubble is still refused
    const glass = [{ id: 'g', hexes: [at(0, 2)], solid: true, label: 'Glass' }];
    expect(trollPreyLanding(at(0, 3), footprint, unitOf('boss'), store().units, glass)?.onRubble).toBe(false);
  });

  it('says nothing of rubble on the banner when the mark holds none', () => {
    arena({ heroes: [hero('a', at(0, 3)), hero('b', at(3, -1))] });
    heaps(at(-3, 1));
    castTrollMove(unitOf('boss'), farthestPrey, fx);
    const preview = previewPrepared(prepared()[0], store().units, store().hazards);
    const [line] = warningLines(prepared(), [preview], store().units, store().hazards);
    expect(line.detail).not.toContain('rubble in the mark');
  });

  it('misses an empty mark: a hero who steps out is not struck', () => {
    arena({ heroes: [hero('a', at(0, 3)), hero('b', at(3, -1))] });
    castTrollMove(unitOf('boss'), farthestPrey, fx);
    store().moveUnit('a', at(-3, 3));
    let guard = 0;
    while (!isPreparedDue(prepared()[0], store().units) && guard++ < 6) store().nextTurn();
    resolveDuePrepared('boss', SILENT_SINK);
    expect(unitOf('a').currentHp).toBe(300);
    expect(unitOf('a').activeEffects.some((e) => e.type === AfflictionType.Stun)).toBe(false);
  });
});

// ─── Boundary Smash ──────────────────────────────────────────────────────────

describe('Boundary Smash', () => {
  const smash = () => {
    const caster = unitOf('boss');
    executeAIActions(caster, [{ type: 'skill', skill: boundarySmash, skillTarget: caster.position }]);
  };

  it('is a warning first: nothing is struck or moved at the cast', () => {
    arena({ heroes: [hero('a', at(0, 0)), hero('b', at(1, 0))] });
    smash();
    expect(prepared()).toHaveLength(1);
    expect(unitOf('a').position).toEqual(at(0, 0));
    expect(unitOf('a').currentHp).toBe(300);
  });

  it('lands every hero exactly where the warning said they would land', () => {
    arena({ heroes: [hero('a', at(0, 1)), hero('b', at(1, 0)), hero('c', at(-1, 1))] });
    smash();
    const attack = prepared()[0];
    const preview = previewPrepared(attack, store().units, store().hazards);
    expect(preview.landings.length).toBeGreaterThan(0);
    let guard = 0;
    while (!isPreparedDue(prepared()[0], store().units) && guard++ < 6) store().nextTurn();
    resolveDuePrepared('boss', SILENT_SINK);
    for (const move of preview.landings) {
      expect(unitOf(move.unitId).position).toEqual(move.to);
    }
  });

  it('throws a hero away from him, and stops short of the wall rather than through it', () => {
    arena({ boss: { position: at(0, 4) }, heroes: [hero('a', at(0, 5)), hero('b', at(3, -3))] });
    smash();
    const preview = previewPrepared(prepared()[0], store().units, store().hazards);
    const move = preview.landings.find((m) => m.unitId === 'a')!;
    // A hero already on the boundary has nowhere to go: the landing is the start
    expect(move.moved).toBe(false);
    expect(move.blockedBy?.kind).toBe('boundary');
  });

  // PT-06: the landing was drawn as a dim hex in the warning's violet, one ring
  // outside the smash, and read as a stray hex of the footprint. It is a push,
  // drawn as an arrow from the body to where it lands.
  it('names each push as a body and its landing, so a landing outside the footprint is not a lit hex', () => {
    const bossAt = at(0, 0);
    arena({ boss: { position: bossAt }, heroes: [hero('a', at(0, 2)), hero('b', at(3, -3))] });
    smash();
    const attack = prepared()[0];
    const pushes = warnedPushes(attack, store().units, store().hazards);
    const footprint = new Set(attack.hexes.map(hexKey));
    const a = pushes.find((p) => p.unitId === 'a')!;
    expect(a.from).toEqual(at(0, 2));
    expect(hexDistance(bossAt, a.to)).toBeGreaterThan(BALANCE.TROLL_SMASH_RADIUS);
    expect(footprint.has(hexKey(a.to))).toBe(false);
    // Only bodies that move: b stands outside the smash
    expect(pushes.map((p) => p.unitId)).toEqual(['a']);
    // And the arrow is the landing the resolution will use
    const landing = previewPrepared(attack, store().units, store().hazards).landings.find((m) => m.unitId === 'a')!;
    expect(a.to).toEqual(landing.to);
  });

  it('never lands two bodies on one hex', () => {
    arena({ heroes: [hero('a', at(0, 1)), hero('b', at(0, 2)), hero('c', at(1, 1))] });
    smash();
    let guard = 0;
    while (!isPreparedDue(prepared()[0], store().units) && guard++ < 6) store().nextTurn();
    resolveDuePrepared('boss', SILENT_SINK);
    const keys = store().units.filter((u) => u.currentHp > 0).map((u) => hexKey(u.position));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('brings the roof down as it lands, over the cluster as the throw left it', () => {
    // Side by side round him before the throw; thrown to opposite walls by it
    arena({ boss: { position: at(0, 0) }, heroes: [hero('a', at(1, 0)), hero('b', at(-1, 0))] });
    const before = collapseCentre(store().units);
    smash();
    const preview = previewPrepared(prepared()[0], store().units, store().hazards);
    const thrown = store().units.map((u) => {
      const move = preview.landings.find((m) => m.unitId === u.id);
      return move ? { ...u, position: move.to } : u;
    });
    const after = collapseCentre(thrown);
    expect(after).not.toEqual(before);
    let guard = 0;
    while (!isPreparedDue(prepared()[0], store().units) && guard++ < 6) store().nextTurn();
    resolveDuePrepared('boss', SILENT_SINK);
    // The Smash has landed and the Collapse is the warning now open, on the cluster where they ended up
    const [roof] = prepared();
    expect(roof.skill.id).toBe('warren_collapse');
    expect(roof.scripted).toBe('collapse');
    expect(roof.aim).toEqual(after);
    expect(roof.hexes.map(hexKey).sort()).toEqual(collapseFootprint(after!).map(hexKey).sort());
    // It keeps the response rule: it waits for the heroes it marked
    expect(isPreparedDue(roof, store().units)).toBe(false);
    // The cycle did not move for it
    expect(unitOf('boss').bossScript?.step ?? 0).toBe(0);
  });

});

// ─── Warren Collapse ─────────────────────────────────────────────────────────

describe('Warren Collapse', () => {
  it('marks the densest cluster of heroes', () => {
    const heroes = [
      hero('a', at(-3, 2)),
      hero('b', at(2, 0)),
      hero('c', at(2, 1)),
      hero('d', at(1, 1)),
    ];
    arena({ heroes });
    const centre = collapseCentre(store().units)!;
    const caught = heroes.filter((h) => hexDistance(centre, h.position) <= BALANCE.TROLL_COLLAPSE_RADIUS);
    expect(caught.map((h) => h.id).sort()).toEqual(['b', 'c', 'd']);
  });

  it('picks the same centre for the same board', () => {
    arena({ heroes: [hero('a', at(0, 2)), hero('b', at(2, 1))] });
    const first = collapseCentre(store().units);
    for (let i = 0; i < 5; i++) expect(collapseCentre(store().units)).toEqual(first);
  });

  it('fixes the footprint at the cast, on every hex it would later strike', () => {
    arena({ heroes: [hero('a', at(0, 2)), hero('b', at(1, 2))] });
    expect(castTrollMove(unitOf('boss'), warrenCollapse, fx).ok).toBe(true);
    const [attack] = prepared();
    expect(attack.scripted).toBe('collapse');
    expect(attack.hexes.map(hexKey).sort()).toEqual(collapseFootprint(attack.aim).map(hexKey).sort());
    expect(attack.responders.sort()).toEqual(['a', 'b']);
  });

  it('is not hurried by bonus turns or Fury actions: it waits for every hero in it', () => {
    arena({ heroes: [hero('a', at(0, 2)), hero('b', at(1, 2))] });
    castTrollMove(unitOf('boss'), warrenCollapse, fx);
    fury();
    // A bonus turn and a Fury action are short-road turns: neither lands anything
    store().patchBossScript('boss', { step: 4 });
    useCombatStore.setState({ furyExtra: { active: true } });
    beginTurn('boss', SILENT_SINK);
    expect(prepared()).toHaveLength(1);
    expect(unitOf('a').currentHp).toBe(300);
    expect(isPreparedDue(prepared()[0], store().units)).toBe(false);
    useCombatStore.setState({ furyExtra: { active: false } });
    useCombatStore.setState({ bonusTurn: { pending: null, active: true } });
    beginTurn('boss', SILENT_SINK);
    expect(prepared()).toHaveLength(1);
    expect(unitOf('a').currentHp).toBe(300);
  });

  describe('once it falls', () => {
    const fall = () => {
      let guard = 0;
      while (!isPreparedDue(prepared()[0], store().units) && guard++ < 8) store().nextTurn();
      resolveDuePrepared('boss', SILENT_SINK);
    };

    it('leaves rubble on empty impact hexes only, never under a living unit', () => {
      arena({ heroes: [hero('a', at(0, 2)), hero('b', at(1, 2))] });
      castTrollMove(unitOf('boss'), warrenCollapse, fx);
      const marked = prepared()[0].hexes;
      fall();
      const heaps = rubble();
      expect(heaps.length).toBeGreaterThan(0);
      const occupied = new Set(store().units.filter((u) => u.currentHp > 0).map((u) => hexKey(u.position)));
      for (const h of heaps) {
        expect(occupied.has(hexKey(h))).toBe(false);
        expect(marked.map(hexKey)).toContain(hexKey(h));
      }
      expect(unitOf('a').currentHp).toBeLessThan(300);
    });

    it('never seals the arena: the open ground stays one connected floor', () => {
      arena({ heroes: [hero('a', at(0, 2)), hero('b', at(1, 2))] });
      castTrollMove(unitOf('boss'), warrenCollapse, fx);
      fall();
      expect(routesConnected(new Set(rubble().map(hexKey)))).toBe(true);
    });

    it('blocks movement onto it for heroes and for him', () => {
      arena({ heroes: [hero('a', at(0, 2)), hero('b', at(2, 2))] });
      castTrollMove(unitOf('boss'), warrenCollapse, fx);
      fall();
      const blocked = new Set(rubble().map(hexKey));
      for (const id of ['a', 'b', 'boss']) {
        const reach = getMovementRange(unitOf(id), store().units, store().hazards);
        expect(reach.some((h) => blocked.has(hexKey(h)))).toBe(false);
      }
      // And without the ground's memory the same hexes are open: it is the rubble doing it
      const open = getMovementRange(unitOf('a'), store().units);
      expect(open.some((h) => blocked.has(hexKey(h)))).toBe(blocked.size > 0 && open.some((h) => blocked.has(hexKey(h))));
    });

    it('stands through his turns, Fury actions and rounds: no clock counts it down', () => {
      arena({ heroes: [hero('a', at(0, 2)), hero('b', at(1, 2))] });
      castTrollMove(unitOf('boss'), warrenCollapse, fx);
      fall();
      const laid = rubble().map(hexKey);
      expect(laid.length).toBeGreaterThan(0);
      expect(store().hazards.every((h) => h.turnsLeft === undefined)).toBe(true);
      store().nextTurn();
      bossToAct();
      useCombatStore.setState({ furyExtra: { active: true } });
      beginTurn('boss', SILENT_SINK);
      useCombatStore.setState({ furyExtra: { active: false } });
      for (let i = 0; i < 4; i++) {
        useCombatStore.setState({ currentUnitId: 'boss' });
        beginTurn('boss', SILENT_SINK);
      }
      expect(rubble().map(hexKey)).toEqual(laid);
    });
  });

  it('keeps every route open however the board is already blocked (rubble choice)', () => {
    arena({ heroes: [hero('a', at(0, 2))] });
    // Wall off a ring but for one gap; the last hex of the ring must be refused
    const ring = arenaHexes().filter((h) => hexDistance(at(0, 0), h) === 2);
    const solid = new Set(ring.slice(1).map(hexKey));
    const picked = rubbleHexes([ring[0]], store().units, [
      { id: 'ring', hexes: ring.slice(1), solid: true, label: 'Rubble' },
    ]);
    expect(picked).toEqual([]);
    expect(routesConnected(solid)).toBe(true);
  });
});

// ─── Fury ────────────────────────────────────────────────────────────────────

describe('Fury', () => {
  it('lights at half health with a red aura, once he has begun a turn', () => {
    arena();
    expect(isFurious(unitOf('boss'))).toBe(false);
    store().damageUnit('boss', 400, 'a');
    expect(isFurious(unitOf('boss'))).toBe(false);
    store().damageUnit('boss', 150, 'a');
    expect(isFurious(unitOf('boss'))).toBe(true);
    expect(unitOf('boss').bossPhase).toBe(1);
    expect(unitOf('boss').activeEffects.some((e) => e.type === AuraType.Fury)).toBe(true);
  });

  it('is held until he has begun a turn, so no phase is skipped', () => {
    arena();
    store().patchBossScript('boss', { phaseTurns: 0 });
    store().damageUnit('boss', 700, 'a');
    expect(isFurious(unitOf('boss'))).toBe(false);
    // His first turn is the one he lives in; the change comes at the start of the next
    bossToAct();
    beginTurn('boss', SILENT_SINK);
    expect(isFurious(unitOf('boss'))).toBe(false);
    bossToAct();
    beginTurn('boss', SILENT_SINK);
    expect(isFurious(unitOf('boss'))).toBe(true);
  });

  it('adds half again to every blow, and nothing to the ones before it', () => {
    arena();
    const before = calculateDamage(unitOf('boss'), unitOf('a'), bonebreakerSweep);
    fury();
    const after = calculateDamage(unitOf('boss'), unitOf('a'), bonebreakerSweep);
    expect(after).toBeGreaterThan(before);
    expect(after / before).toBeCloseTo(1 + BALANCE.TROLL_FURY_DAMAGE, 1);
  });

  it('keeps the script: a warning in the air still lands and the cycle is untouched', () => {
    arena({ heroes: [hero('a', at(0, 2)), hero('b', at(1, 2))] });
    castTrollMove(unitOf('boss'), warrenCollapse, fx);
    store().patchBossScript('boss', { step: 5 });
    store().damageUnit('boss', 600, 'a');
    expect(isFurious(unitOf('boss'))).toBe(true);
    expect(prepared()).toHaveLength(1);
    expect(unitOf('boss').bossScript?.step).toBe(5);
  });

  it('grants a second action after the turn, and it is the Sweep', () => {
    arena();
    fury();
    expect(actionsPerTurn(unitOf('boss'))).toBe(2);
    bossToAct();
    store().nextTurn();
    expect(store().currentUnitId).toBe('boss');
    expect(store().furyExtra.active).toBe(true);
    const actions = decideEnemyAction(unitOf('boss'), store().units);
    const skill = actions.find((a) => a.type === 'skill')?.skill;
    expect(skill?.id === 'bonebreaker_sweep' || actions.every((a) => a.type !== 'skill')).toBe(true);
  });

  it('does not advance the cycle for the extra action', () => {
    arena({ heroes: [hero('a', at(0, 1)), hero('b', at(1, 0))] });
    fury();
    store().patchBossScript('boss', { step: 2 });
    bossToAct();
    store().nextTurn(); // into the Fury action
    const actions = decideEnemyAction(unitOf('boss'), store().units);
    expect(actions.every((a) => a.bossStep === undefined)).toBe(true);
  });

  it('does not grant an extra action before Fury', () => {
    arena();
    store().nextTurn();
    expect(store().currentUnitId).not.toBe('boss');
    expect(store().furyExtra.active).toBe(false);
  });

  it('stacks with a speed bonus turn into four actions, and never into five', () => {
    setTempoRandom(() => 0);
    arena({ boss: { stats: makeStats({ maxHp: 1000, attack: 30, speed: 40, moveRange: 2, maxMana: 0 }) } });
    fury();
    expect(store().currentUnitId).toBe('boss');
    expect(store().bonusTurn.pending).toBe('boss');
    const turns: string[] = [];
    const mark = () => turns.push(`${store().bonusTurn.active ? 'bonus' : 'regular'}${store().furyExtra.active ? '+fury' : ''}`);
    mark();               // regular
    store().nextTurn(); mark();   // fury of the regular
    store().nextTurn(); mark();   // bonus
    store().nextTurn(); mark();   // fury of the bonus
    store().nextTurn();
    expect(turns).toEqual(['regular', 'regular+fury', 'bonus', 'bonus+fury']);
    expect(store().currentUnitId).not.toBe('boss');
  });

  it('ticks no clock on the extra action: it is action and never time', () => {
    arena();
    fury();
    store().damageUnit('boss', 1, 'a');
    store().startCooldown('boss', { ...bonebreakerSweep, cooldown: 3 });
    const running = unitOf('boss').cooldowns?.[bonebreakerSweep.id];
    expect(running).toBeGreaterThan(0);
    bossToAct();
    store().nextTurn();
    beginTurn('boss', SILENT_SINK);
    expect(unitOf('boss').cooldowns?.[bonebreakerSweep.id]).toBe(running);
  });
});

// ─── The AI plays the script ────────────────────────────────────────────────

describe('the Troll AI', () => {
  it('opens on Farthest Prey and advances the cycle only once it is cast', () => {
    arena({ heroes: [hero('a', at(0, 3)), hero('b', at(1, 0))] });
    const actions = decideEnemyAction(unitOf('boss'), store().units);
    expect(actions[0].skill?.id).toBe('farthest_prey');
    expect(actions[0].bossStep).toBe(1);
    // Deciding wrote nothing
    expect(unitOf('boss').bossScript?.step).toBe(0);
    executeAIActions(unitOf('boss'), actions);
    expect(unitOf('boss').bossScript?.step).toBe(1);
    expect(prepared()).toHaveLength(1);
  });

  it('sweeps on the second beat, aimed at the hero in front of him', () => {
    arena({ heroes: [hero('a', at(0, 0)), hero('b', at(3, 2))] });
    store().patchBossScript('boss', { step: 1 });
    const actions = decideEnemyAction(unitOf('boss'), store().units);
    expect(actions[0].skill?.id).toBe('bonebreaker_sweep');
    expect(actions[0].bossStep).toBe(2);
  });

  it('sweeps toward the hero it would hurt, not one a heap shields', () => {
    // c stands behind a heap two hexes off; u stands in the open beside him, on the other side
    arena({ boss: { position: at(0, 0) }, heroes: [hero('c', at(0, 2)), hero('u', at(0, -1))] });
    heaps(at(0, 1));
    store().patchBossScript('boss', { step: 1 });
    const [action] = decideEnemyAction(unitOf('boss'), store().units);
    expect(action.skill?.id).toBe('bonebreaker_sweep');
    const arc = new Set(getSkillTargetsOf(action.skillTarget!).map(hexKey));
    expect(arc.has(hexKey(at(0, -1)))).toBe(true);
    expect(arc.has(hexKey(at(0, 1)))).toBe(false);
  });

  it('sweeps at a shielded hero when nobody else is in reach, and the heap takes the club', () => {
    arena({ boss: { position: at(0, 0) }, heroes: [hero('c', at(0, 2)), hero('far', at(3, -5))] });
    heaps(at(0, 1));
    store().patchBossScript('boss', { step: 1 });
    const actions = decideEnemyAction(unitOf('boss'), store().units);
    expect(actions[0].skill?.id).toBe('bonebreaker_sweep');
    executeAIActions(unitOf('boss'), actions);
    expect(unitOf('c').currentHp).toBe(300);
    expect(unitOf('c').activeEffects.some((e) => e.type === AfflictionType.Wound)).toBe(false);
    expect(standing()).toEqual([]);
    // The swing was made: the cycle moved on
    expect(unitOf('boss').bossScript?.step).toBe(2);
  });

  it('keeps the smash slot when nobody is within reach of it, and walks instead', () => {
    arena({ heroes: [hero('a', at(3, 3)), hero('b', at(-3, 3))] });
    store().patchBossScript('boss', { step: 2 });
    const actions = decideEnemyAction(unitOf('boss'), store().units);
    expect(actions.some((a) => a.skill?.id === 'boundary_smash')).toBe(false);
    expect(actions.some((a) => a.bossStep === 3)).toBe(false);
  });

  it('is taunted onto the sweep alone: the leap still goes to the farthest hero', () => {
    arena({ heroes: [hero('a', at(0, 1)), hero('b', at(0, 4))] });
    store().applyEffect('boss', { type: AfflictionType.Taunt, magnitude: 1, duration: 3, sourceUnitId: 'a' });
    const actions = decideEnemyAction(unitOf('boss'), store().units);
    expect(actions[0].skill?.id).toBe('farthest_prey');
  });
});

// ─── Regeneration ────────────────────────────────────────────────────────────

describe('He regenerates when unharmed', () => {
  const regularTurn = (sink: CombatSink = SILENT_SINK) => {
    useCombatStore.setState({ currentUnitId: 'boss', bonusTurn: { pending: null, active: false }, furyExtra: { active: false } });
    return beginTurn('boss', sink);
  };
  const hp = () => unitOf('boss').currentHp;
  const setHp = (value: number) =>
    useCombatStore.setState((st) => ({ units: st.units.map((u) => (u.id === 'boss' ? { ...u, currentHp: value } : u)) }));
  const share = Math.round(1000 * BALANCE.TROLL_REGEN_SHARE);

  it('heals exactly when the counter says unharmed and never after any hero damage', () => {
    arena();
    // true: a hero damaged him between his last turn and this one
    const struckBefore = [false, false, true, false, false, true, true, false, true, false, false, false];
    struckBefore.forEach((struck, i) => {
      setHp(600);
      if (struck) store().damageUnit('boss', 1, 'a');
      const counter = unitOf('boss').bossScript?.unharmedRounds ?? 0;
      const before = hp();
      regularTurn();
      const healed = hp() - before;
      // The counter read before the turn adds to it is what decides
      expect(healed).toBe(counter >= 1 ? share : 0);
      // ...which is the plain statement of the rule: no hero damage since his last turn began
      expect(healed > 0).toBe(i > 0 && !struck);
    });
  });

  it('does not heal on the first turn of a fight, or at full health', () => {
    arena();
    setHp(600);
    regularTurn();
    expect(hp()).toBe(600);
    setHp(1000);
    regularTurn();
    expect(hp()).toBe(1000);
  });

  it('is not triggered or counted by a Fury action or a speed bonus turn', () => {
    arena();
    regularTurn();
    setHp(600);
    useCombatStore.setState({ currentUnitId: 'boss', bonusTurn: { pending: null, active: true } });
    beginTurn('boss', SILENT_SINK);
    expect(hp()).toBe(600);
    useCombatStore.setState({ currentUnitId: 'boss', bonusTurn: { pending: null, active: false }, furyExtra: { active: true } });
    beginTurn('boss', SILENT_SINK);
    expect(hp()).toBe(600);
    expect(unitOf('boss').bossScript?.unharmedRounds).toBe(1);
    // His next regular turn is the one that heals
    regularTurn();
    expect(hp()).toBe(600 + share);
  });

  it('is a number over him, a line in the log and a sound', () => {
    arena();
    regularTurn();
    setHp(600);
    const floats: string[] = [];
    const logs: string[] = [];
    const sounds: string[] = [];
    regularTurn({
      ...SILENT_SINK,
      float: (_at, text) => floats.push(text),
      log: (text) => logs.push(text),
      sound: (intent) => sounds.push(intent.kind),
    });
    expect(floats).toEqual([`+${share} regen`]);
    expect(logs.some((l) => l.includes('regenerates'))).toBe(true);
    expect(sounds).toContain('mend');
  });

  it('stays within the band of the phase he is in', () => {
    arena();
    regularTurn();
    store().damageUnit('boss', 520, 'a');
    regularTurn();
    regularTurn();
    expect(isFurious(unitOf('boss'))).toBe(true);
    for (let i = 0; i < 12; i++) regularTurn();
    // Fury's band ends at half: regeneration cannot undo the work that lit it
    expect(hp()).toBeLessThanOrEqual(500);
  });
});

// ─── Farthest Prey: the facing ───────────────────────────────────────────────

describe('Farthest Prey faces its prey and does not turn until he acts', () => {
  it('lands facing the marked hero and keeps that facing through the party\'s turns', () => {
    arena({ heroes: [hero('a', at(0, 3)), hero('b', at(3, -1))] });
    castTrollMove(unitOf('boss'), farthestPrey, fx);
    let guard = 0;
    while (!isPreparedDue(prepared()[0], store().units) && guard++ < 6) store().nextTurn();
    resolveDuePrepared('boss', SILENT_SINK);
    const boss = unitOf('boss');
    const facing = boss.facing;
    expect(facing).toBe(directionToward(boss.position, at(0, 3)));

    // Everything the party can do before he acts: step, strike him, take turns
    store().moveUnit('a', at(-2, 3));
    store().moveUnit('b', at(2, 0));
    store().damageUnit('boss', 5, 'b');
    for (let i = 0; i < 4; i++) store().nextTurn();
    expect(unitOf('boss').facing).toBe(facing);
    // His own turn beginning does not turn him either; only his action does
    useCombatStore.setState({ currentUnitId: 'boss' });
    beginTurn('boss', SILENT_SINK);
    expect(unitOf('boss').facing).toBe(facing);
  });

  it('commits the facing at the cast: he already faces the hero he hunts', () => {
    arena({ heroes: [hero('a', at(0, 3)), hero('b', at(3, -1))] });
    castTrollMove(unitOf('boss'), farthestPrey, fx);
    expect(unitOf('boss').facing).toBe(directionToward(unitOf('boss').position, at(0, 3)));
  });
});

// ─── Boundary Smash: braced against rubble or the wall ──────────────────────

describe('Boundary Smash does not move a hero with rubble or the wall at their back', () => {
  const smash = () => {
    const caster = unitOf('boss');
    executeAIActions(caster, [{ type: 'skill', skill: boundarySmash, skillTarget: caster.position }]);
  };
  const land = () => {
    let guard = 0;
    while (!isPreparedDue(prepared()[0], store().units) && guard++ < 6) store().nextTurn();
    resolveDuePrepared('boss', SILENT_SINK);
  };

  it('marks the braced hero as not moving, and the landing agrees', () => {
    arena({ boss: { position: at(0, 0) }, heroes: [hero('a', at(0, 1)), hero('b', at(1, 0))] });
    // Rubble directly behind a (the way he would be thrown); nothing behind b
    store().addHazard({ id: 'heap', hexes: [at(0, 2)], solid: true, label: 'Rubble', lasts: 'replaced', kind: 'troll_rubble', ownerId: 'boss' });
    smash();
    const preview = previewPrepared(prepared()[0], store().units, store().hazards);
    expect(preview.braced).toEqual(['a']);
    expect(warnedPushes(prepared()[0], store().units, store().hazards).map((p) => p.unitId)).toEqual(['b']);
    const [line] = warningLines(prepared(), [preview], store().units);
    expect(line.detail).toContain('no throw');
    const b = preview.landings.find((m) => m.unitId === 'b')!;
    land();
    expect(unitOf('a').position).toEqual(at(0, 1));
    expect(unitOf('b').position).toEqual(b.to);
    expect(unitOf('a').currentHp).toBeLessThan(300);
  });

  it('braces against the wall as it does against rubble', () => {
    arena({ boss: { position: at(0, 4) }, heroes: [hero('a', at(0, 5)), hero('b', at(3, -3))] });
    smash();
    expect(previewPrepared(prepared()[0], store().units, store().hazards).braced).toEqual(['a']);
    land();
    expect(unitOf('a').position).toEqual(at(0, 5));
  });

  it('breaks the heap a braced hero leaned on, and only that one', () => {
    arena({ boss: { position: at(0, 0) }, heroes: [hero('a', at(0, 1)), hero('b', at(1, 0))] });
    heaps(at(0, 2), at(-3, 1));
    smash();
    const preview = previewPrepared(prepared()[0], store().units, store().hazards);
    expect(preview.braced).toEqual(['a']);
    land();
    // a kept the hex; the heap at a's back broke; the other heap stands
    expect(unitOf('a').position).toEqual(at(0, 1));
    expect(standing()).toEqual([hexKey(at(-3, 1))]);
  });

  it('breaks nothing for a brace against the wall', () => {
    arena({ boss: { position: at(0, 4) }, heroes: [hero('a', at(0, 5)), hero('b', at(3, -3))] });
    heaps(at(-3, 1), at(2, -4));
    smash();
    land();
    expect(unitOf('a').position).toEqual(at(0, 5));
    expect(standing()).toEqual([hexKey(at(-3, 1)), hexKey(at(2, -4))].sort());
  });

  it('names nobody when every hero will be thrown', () => {
    arena({ boss: { position: at(0, 0) }, heroes: [hero('a', at(0, 1)), hero('b', at(1, 0))] });
    smash();
    const preview = previewPrepared(prepared()[0], store().units, store().hazards);
    expect(preview.braced).toEqual([]);
    const [line] = warningLines(prepared(), [preview], store().units);
    expect(line.detail).not.toContain('no throw');
  });
});
