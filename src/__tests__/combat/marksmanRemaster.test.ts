import { useCombatStore } from '@/stores/combatStore';
import { CombatSink, resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { getMovementRange } from '@/systems/combat/movement';
import { requireUnit } from '@/systems/combat/unitLookup';
import { applyPassiveOutcomes, applySkillStatus } from '@/systems/combat/combatEvents';
import { chargeStage } from '@/systems/combat/chargedCast';
import { canUseSkill, cooldownLeft } from '@/systems/combat/cooldowns';
import { aimLocked, skillBlockedReason } from '@/systems/combat/skillAvailability';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { flushReactions } from '@/systems/combat/reactionResolve';
import { beginTurn } from '@/systems/combat/turnStart';
import { PASSIVE_DEFS, penetrationAgainst, resolvePassives } from '@/systems/combat/passives';
import { markAndMoveRange, settleInPen } from '@/systems/combat/passiveFormulas';
import { nodeSkillAt } from '@/systems/progression/mastery';
import { basicAttackWith } from '@/systems/combat/basicAttack';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { withDice } from '@/systems/combat/dice';
import { BALANCE } from '@/data/balanceConstants';
import { aimedShot, coveringFire, markTarget, ricochetShot } from '@/data/skills/masterySkills';
import { findMasteryNode, findMasteryPath } from '@/data/skills/masteryData';
import { AfflictionType, AuraType, CombatUnit, HeroStats, PassiveId, PassiveRank } from '@/models/types';
import { hexDistance } from '@/utils/hexUtils';
import { at, makeFoe, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * The Marksman remaster, as rules: Mark and Move, Ricochet Shot, the two-turn
 * Aimed Shot, Covering Fire, Escape Route and Settle In. Numbers come from the
 * definitions; what is pinned is the shape.
 */

const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({
    maxHp: 300, attack: 30, magic: 10, defense: 0, magicDefense: 0, maxMana: 200,
    critChance: 0, dodgeChance: 0, speed: 10, ...over,
  });

const state = () => useCombatStore.getState();
const nodeOf = (id: string) => findMasteryNode(id)?.node;
const unitNow = (id: string) => requireUnit(state().units, id);
const RANKS: PassiveRank[] = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));

const archer = (passives: PassiveId[] = [], level = 2, over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'archer',
    position: at(0, 0),
    stats: stats(),
    currentMana: 200,
    skills: [markTarget],
    passives,
    passiveRanks: Object.fromEntries(passives.map((p) => [p, RANKS[level - 1]])),
    ...over,
  });

const foe = (over: Partial<CombatUnit> = {}) =>
  makeFoe({ id: 'foe', position: at(2, 0), stats: stats({ maxHp: 1000 }), ...over });

const recording = () => {
  const floats: string[] = [];
  const sink: CombatSink = { ...SILENT_SINK, float: (_at, text) => { floats.push(text); } };
  return { sink, floats };
};
const damageFloats = (floats: string[]) =>
  floats.filter((f) => /^-\d+!?$/.test(f)).map((f) => Number(f.replace(/[-!]/g, '')));

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  state().reset();
});

// ─── Mark Target ──────────────────────────────────────────────────────────────

describe('Mark Target', () => {
  // The resolver once rounded every magnitude to a whole point, so the +40% Mark landed as +100%
  it('lays its Mark at the authored fraction, not rounded to a whole point', () => {
    useCombatStore.setState({ units: [archer(), foe()] });
    resolveSkillUse(unitNow('archer'), markTarget, at(2, 0), SILENT_SINK);
    const mark = unitNow('foe').activeEffects.find((e) => e.type === AfflictionType.Mark);
    const authored = [markTarget.appliesEffect].flat()[0]!;
    expect(mark?.magnitude).toBe(authored.magnitude);
    expect(mark!.magnitude).toBeLessThan(1);
  });
});

// ─── Mark and Move ────────────────────────────────────────────────────────────

describe('Mark and Move', () => {
  it('sits in the centre of the first row, where Evasion was', () => {
    const node = nodeOf('marks_mark_and_move')!;
    expect(node.tier).toBe(1);
    expect(node.column).toBe(2);
    expect(node.grantsPassive).toBe('markAndMove');
    expect(nodeOf('marks_evasion')).toBeUndefined();
  });

  it('leaves a short move after Mark Target instead of ending the turn', () => {
    useCombatStore.setState({ units: [archer(['markAndMove']), foe()] });
    const result = resolveSkillUse(unitNow('archer'), markTarget, at(2, 0), SILENT_SINK);
    expect(result).toEqual(expect.objectContaining({ ok: true, endsTurn: false }));
    const after = unitNow('archer');
    expect(after.hasActed).toBe(true);
    expect(after.hasMoved).toBe(false);
    expect(after.repositionCap).toBe(markAndMoveRange(RANKS[1]));
    const reach = getMovementRange(after, state().units);
    expect(reach.length).toBeGreaterThan(0);
    for (const hex of reach) expect(hexDistance(after.position, hex)).toBeLessThanOrEqual(markAndMoveRange(RANKS[1]));
  });

  it('reaches further with each rank', () => {
    const ranges = RANKS.map(markAndMoveRange);
    expect(ranges[0]).toBeLessThan(ranges[1]);
    expect(ranges[1]).toBeLessThan(ranges[2]);
  });

  it('grants nothing to a Rooted Marksman, or without the node', () => {
    const rooted = archer(['markAndMove'], 2, {
      activeEffects: [{ type: AfflictionType.Root, magnitude: 1, duration: 2 }],
    });
    useCombatStore.setState({ units: [rooted, foe()] });
    expect(resolveSkillUse(unitNow('archer'), markTarget, at(2, 0), SILENT_SINK).endsTurn).toBe(true);

    state().reset();
    useCombatStore.setState({ units: [archer(), foe()] });
    expect(resolveSkillUse(unitNow('archer'), markTarget, at(2, 0), SILENT_SINK).endsTurn).toBe(true);
  });

  it('is spent by the move, and gone when the next turn begins', () => {
    useCombatStore.setState({ units: [archer(['markAndMove']), foe()] });
    resolveSkillUse(unitNow('archer'), markTarget, at(2, 0), SILENT_SINK);
    state().markMoved('archer');
    expect(unitNow('archer').repositionCap).toBeUndefined();
  });
});

// ─── The Mark and the Basic Attack (playtest PT-04) ──────────────────────────

describe('a Basic Attack cashes the Mark in', () => {
  const bow = basicAttackWith({ slot: 'mainHand', form: 'bow', motif: 'plain', id: 'Bow' });
  const marked = (owner: string) => ({
    type: AfflictionType.Mark, magnitude: 0.4, duration: 4, sourceUnitId: owner,
  });
  const hasMark = (id: string) => unitNow(id).activeEffects.some((e) => e.type === AfflictionType.Mark);

  it('takes the Mark bonus on its landed hit and removes the Mark', () => {
    useCombatStore.setState({ units: [archer([], 2, { skills: [markTarget, bow] }), foe({ activeEffects: [marked('archer')] })] });
    const plain = calculateDamage(unitNow('archer'), { ...unitNow('foe'), activeEffects: [] }, bow);
    const boosted = calculateDamage(unitNow('archer'), unitNow('foe'), bow);
    expect(boosted).toBeGreaterThan(plain);
    const { sink, floats } = recording();
    resolveSkillUse(unitNow('archer'), bow, at(2, 0), sink);
    expect(damageFloats(floats)).toEqual([boosted]);
    expect(hasMark('foe')).toBe(false);

    // The next one is a plain shot
    const next = recording();
    resolveSkillUse(unitNow('archer'), bow, at(2, 0), next.sink);
    expect(damageFloats(next.floats)).toEqual([plain]);
  });

  it('keeps the Mark through a dodge', () => {
    useCombatStore.setState({
      units: [archer([], 2, { skills: [bow] }), foe({ stats: stats({ maxHp: 1000, dodgeChance: 60 }), activeEffects: [marked('archer')] })],
    });
    const { sink, floats } = recording();
    withDice(() => 0, () => resolveSkillUse(unitNow('archer'), bow, at(2, 0), sink));
    expect(damageFloats(floats)).toEqual([]);
    expect(hasMark('foe')).toBe(true);
  });

  it('leaves the Mark for every other skill, and for anyone else\'s Basic Attack', () => {
    useCombatStore.setState({
      units: [
        archer([], 2, { skills: [ricochetShot, bow] }),
        makeUnit({ id: 'ally', position: at(1, 1), stats: stats(), skills: [bow] }),
        foe({ activeEffects: [marked('archer')] }),
      ],
    });
    resolveSkillUse(unitNow('archer'), ricochetShot, at(2, 0), SILENT_SINK);
    expect(hasMark('foe')).toBe(true);
    resolveSkillUse(unitNow('ally'), bow, at(2, 0), SILENT_SINK);
    expect(hasMark('foe')).toBe(true);
  });
});

// ─── Ricochet Shot ────────────────────────────────────────────────────────────

describe('Ricochet Shot', () => {
  it('replaces Piercing Shot in the tree', () => {
    expect(nodeOf('marks_ricochet')?.grantsSkill).toBe('ricochet_shot');
    expect(nodeOf('marks_piercing')).toBeUndefined();
  });

  it('bounces to at most two more enemies within two hexes, each hit softer, nobody twice', () => {
    useCombatStore.setState({
      units: [
        archer([], 2, { skills: [ricochetShot] }),
        foe({ id: 'a', position: at(3, 0) }),
        foe({ id: 'b', position: at(3, 1) }),
        foe({ id: 'c', position: at(3, 2) }),
        // One more in reach of the last bounce: the chain stops at two bounces
        foe({ id: 'd', position: at(2, 3) }),
      ],
    });
    const { sink, floats } = recording();
    expect(resolveSkillUse(unitNow('archer'), ricochetShot, at(3, 0), sink).ok).toBe(true);
    const hits = damageFloats(floats);
    expect(hits).toHaveLength(3);
    expect(unitNow('d').currentHp).toBe(1000);
    expect(hits[1]).toBeLessThan(hits[0]);
    expect(hits[2]).toBeLessThan(hits[1]);
    expect(hits[1] / hits[0]).toBeCloseTo(ricochetShot.chainFalloff!, 1);
  });

  it('does not bounce further than two hexes from the last body', () => {
    useCombatStore.setState({
      units: [
        archer([], 2, { skills: [ricochetShot] }),
        foe({ id: 'a', position: at(3, 0) }),
        foe({ id: 'far', position: at(0, 4) }),
      ],
    });
    const { sink, floats } = recording();
    resolveSkillUse(unitNow('archer'), ricochetShot, at(3, 0), sink);
    expect(damageFloats(floats)).toHaveLength(1);
    expect(unitNow('far').currentHp).toBe(1000);
  });
});

// ─── Aimed Shot ───────────────────────────────────────────────────────────────

describe('Aimed Shot', () => {
  const aiming = () => unitNow('archer').activeEffects.find((e) => e.type === AuraType.Aiming);
  const nextTurn = () => state().tickEffectsOnUnit('archer');
  const setup = (extra: CombatUnit[] = []) =>
    useCombatStore.setState({
      units: [archer([], 2, { skills: [aimedShot, markTarget, basicAttackWith(undefined)] }), foe(), ...extra],
    });
  const aim = (to = at(2, 0)) => resolveSkillUse(unitNow('archer'), aimedShot, to, SILENT_SINK);

  it('aims on the first use: no damage, mana paid once, the aim names its target', () => {
    setup();
    const mana = unitNow('archer').currentMana;
    expect(aim().ok).toBe(true);
    expect(unitNow('foe').currentHp).toBe(1000);
    expect(aiming()?.aimAt).toBe('foe');
    expect(unitNow('archer').currentMana).toBe(mana - aimedShot.manaCost);
  });

  it('cannot shoot on the turn it aimed', () => {
    setup();
    aim();
    const stage = chargeStage(unitNow('archer'), aimedShot);
    expect(stage.releasing).toBe(true);
    expect(stage.chargePending).toBe(true);
    expect(canUseSkill(unitNow('archer'), stage)).toBe(false);
  });

  it('locks every other skill, Basic Attack included, while it aims', () => {
    setup();
    aim();
    const holder = unitNow('archer');
    for (const skill of holder.skills.filter((s) => s.id !== 'aimed_shot')) {
      expect(canUseSkill(holder, skill)).toBe(false);
      expect(skillBlockedReason(skill, holder)).toBe(aimLocked());
    }
  });

  it('shoots the aimed enemy next turn, for free, ignoring its own cooldown, and only that enemy', () => {
    setup([foe({ id: 'other', position: at(0, 2) })]);
    aim();
    nextTurn();
    const stage = chargeStage(unitNow('archer'), aimedShot);
    expect(stage.chargePending).toBeUndefined();
    expect(cooldownLeft(unitNow('archer'), stage)).toBe(0);
    expect(canUseSkill(unitNow('archer'), stage)).toBe(true);

    expect(resolveSkillUse(unitNow('archer'), aimedShot, at(0, 2), SILENT_SINK).ok).toBe(false);
    expect(unitNow('other').currentHp).toBe(1000);

    const mana = unitNow('archer').currentMana;
    expect(resolveSkillUse(unitNow('archer'), aimedShot, at(2, 0), SILENT_SINK).ok).toBe(true);
    expect(unitNow('foe').currentHp).toBeLessThan(1000);
    expect(unitNow('archer').currentMana).toBe(mana);
    expect(aiming()).toBeUndefined();
  });

  it('a bonus turn after the aim arms it, so the extra turn can shoot (PT-15)', () => {
    setup();
    aim();
    useCombatStore.setState({ currentUnitId: 'archer', bonusTurn: { pending: null, active: true } });
    expect(beginTurn('archer', SILENT_SINK).kind).toBe('act');
    expect(aiming()?.duration).toBe(BALANCE.CHARGE_DURATION);
    expect(aiming()?.armed).toBe(true);
    const stage = chargeStage(unitNow('archer'), aimedShot);
    expect(stage.chargePending).toBeUndefined();
    expect(canUseSkill(unitNow('archer'), stage)).toBe(true);
    expect(resolveSkillUse(unitNow('archer'), aimedShot, at(2, 0), SILENT_SINK).ok).toBe(true);
    expect(unitNow('foe').currentHp).toBeLessThan(1000);
    useCombatStore.setState({ bonusTurn: { pending: null, active: false } });
  });

  /** Started at the aim one turn longer, so it runs three turns from the shot. */
  it('starts its cooldown at the aim, so a dropped aim still costs it', () => {
    setup();
    aim();
    expect(unitNow('archer').cooldowns?.aimed_shot).toBe(aimedShot.cooldown! + 2);
    state().markMoved('archer');
    expect(aiming()).toBeUndefined();
    expect(cooldownLeft(unitNow('archer'), aimedShot)).toBeGreaterThan(0);
  });

  it('deals damage in proportion to the distance at the moment it lands', () => {
    const release = chargeStage(
      archer([], 2, { activeEffects: [{ type: AuraType.Aiming, magnitude: 1, duration: 1, aimAt: 'foe' }] }),
      aimedShot,
    );
    const shooter = archer();
    const near = calculateDamage(shooter, foe({ position: at(2, 0) }), release);
    const ref = calculateDamage(shooter, foe({ position: at(0, BALANCE.AIMED_SHOT_REFERENCE_DISTANCE) }), release);
    const far = calculateDamage(shooter, foe({ position: at(0, 8) }), release);
    expect(ref).toBe(Math.round(stats().attack * release.damage!));
    expect(near).toBeLessThan(ref);
    expect(far).toBeGreaterThan(ref);
    expect(far / near).toBeCloseTo(4, 1);
  });

  it('carries 1.2 / 1.6 / 2.0x Attack at four hexes by rung, range 9', () => {
    const node = nodeOf('marks_aimed')!;
    const damage = [1, 2, 3].map((level) => nodeSkillAt(node, level)!.charge!.release.damage);
    expect(damage).toEqual([1.2, 1.6, 2]);
    expect(aimedShot.range).toBe(9);
  });

  it.each([AfflictionType.Stun, AfflictionType.Silence, AfflictionType.Taunt])(
    'is dropped by %s on the Marksman', (type) => {
      setup();
      aim();
      applySkillStatus(unitNow('foe'), 'archer', { type, magnitude: 1, duration: 2, sourceUnitId: 'foe' }, SILENT_SINK);
      expect(aiming()).toBeUndefined();
    },
  );

  it('is dropped when its target falls before the next turn', () => {
    setup();
    aim();
    state().damageUnit('foe', 5000);
    useCombatStore.setState({ currentUnitId: 'archer' });
    beginTurn('archer', SILENT_SINK);
    expect(aiming()).toBeUndefined();
  });

  it('fades if it is not fired on the next turn', () => {
    setup();
    aim();
    nextTurn();
    expect(aiming()).toBeDefined();
    nextTurn();
    expect(aiming()).toBeUndefined();
  });
});

// ─── Covering Fire ────────────────────────────────────────────────────────────

describe('Covering Fire', () => {
  const ally = () => makeUnit({ id: 'ally', position: at(1, 0), stats: stats({ maxHp: 1000 }) });
  const setup = () => {
    useCombatStore.setState({
      units: [archer([], 2, { skills: [coveringFire] }), ally(), foe({ id: 'foe', position: at(3, 0) })],
    });
    expect(resolveSkillUse(unitNow('archer'), coveringFire, at(0, 0), SILENT_SINK).ok).toBe(true);
  };
  const enemyHitsAlly = (targets: string[] = ['ally']) => {
    for (const id of targets) state().damageUnit(id, 10, 'foe');
    flushReactions(SILENT_SINK);
  };

  it('replaces Follow-Through and retires its free-turn passive', () => {
    const node = nodeOf('marks_covering_fire')!;
    expect(node.grantsSkill).toBe('covering_fire');
    expect(node.grantsPassive).toBeUndefined();
    expect('followThrough' in PASSIVE_DEFS).toBe(false);
    const path = findMasteryPath('marksman')!;
    expect(path.nodes.some((n) => n.id === 'marks_follow_through')).toBe(false);
  });

  it('shoots an enemy that damages an ally, and keeps watching', () => {
    setup();
    enemyHitsAlly();
    expect(unitNow('foe').currentHp).toBeLessThan(1000);
    expect(state().reactions).toHaveLength(1);
  });

  it('answers at most twice a round, refilling on the Marksman’s turn', () => {
    setup();
    const hp = () => unitNow('foe').currentHp;
    enemyHitsAlly();
    const afterOne = hp();
    enemyHitsAlly();
    const afterTwo = hp();
    enemyHitsAlly();
    expect(afterTwo).toBeLessThan(afterOne);
    expect(hp()).toBe(afterTwo);
    state().tickReactionsFor('archer');
    enemyHitsAlly();
    expect(hp()).toBeLessThan(afterTwo);
  });

  it('answers one attacking cast once, however many allies it struck', () => {
    useCombatStore.setState({
      units: [
        archer([], 2, { skills: [coveringFire] }), ally(),
        makeUnit({ id: 'ally2', position: at(0, 1), stats: stats({ maxHp: 1000 }) }),
        foe({ id: 'foe', position: at(3, 0) }),
      ],
    });
    resolveSkillUse(unitNow('archer'), coveringFire, at(0, 0), SILENT_SINK);
    enemyHitsAlly(['ally', 'ally2']);
    expect(state().reactions[0].shotsLeft).toBe(coveringFire.reaction!.shotsPerRound! - 1);
  });

  it('never answers a Reaction’s own blow', () => {
    setup();
    useCombatStore.setState({ answeringReaction: true });
    state().damageUnit('ally', 10, 'foe');
    useCombatStore.setState({ answeringReaction: false });
    flushReactions(SILENT_SINK);
    expect(unitNow('foe').currentHp).toBe(1000);
  });

  it('ignores the Marksman being hit, and enemies out of reach', () => {
    setup();
    state().damageUnit('archer', 10, 'foe');
    flushReactions(SILENT_SINK);
    expect(unitNow('foe').currentHp).toBe(1000);
    useCombatStore.setState({ units: state().units.map((u) => (u.id === 'foe' ? { ...u, position: at(0, -5) } : u.id === 'archer' ? { ...u, position: at(0, 5) } : u)) });
    state().damageUnit('ally', 10, 'foe');
    flushReactions(SILENT_SINK);
    expect(unitNow('foe').currentHp).toBe(1000);
  });

  it('expires after three of the Marksman’s turns (REACTION_TURNS)', () => {
    setup();
    for (let i = 1; i < BALANCE.REACTION_TURNS; i++) {
      state().tickReactionsFor('archer');
      expect(state().reactions).toHaveLength(1);
    }
    state().tickReactionsFor('archer');
    expect(state().reactions).toHaveLength(0);
  });

  it('ranks its reaction shot with the node', () => {
    const node = nodeOf('marks_covering_fire')!;
    const damage = [1, 2, 3].map((level) => nodeSkillAt(node, level)!.reaction!.response.damage!);
    expect(damage[0]).toBeLessThan(damage[1]);
    expect(damage[2]).toBeGreaterThan(damage[1]);
  });
});

// ─── Escape Route ─────────────────────────────────────────────────────────────

describe('Escape Route', () => {
  const runner = (over: Partial<CombatUnit> = {}) => archer(['escapeRoute'], 1, over);
  const hit = (self: CombatUnit, attacker: CombatUnit) =>
    resolvePassives('onDamaged', { self, allUnits: [self, attacker], other: attacker, amount: 10 });

  it('replaces Sure Footing as the side-tree starter, Settle In replacing Braced', () => {
    expect(nodeOf('marks_escape_route')?.grantsPassive).toBe('escapeRoute');
    expect(nodeOf('marks_settle_in')?.requires).toEqual(['marks_escape_route']);
    expect(nodeOf('marks_fleet')?.requires).toEqual(['marks_escape_route']);
    expect(nodeOf('marks_sure_footing')).toBeUndefined();
    expect(nodeOf('marks_braced')).toBeUndefined();
  });

  it('retreats after a hit from within two hexes, and not from further', () => {
    expect(hit(runner(), foe({ position: at(1, 0) }))).toEqual([expect.objectContaining({ kind: 'retreat' })]);
    expect(hit(runner(), foe({ position: at(3, 0) }))).toEqual([]);
  });

  it('stays put while Rooted, Stunned or Frozen, or once spent this round', () => {
    for (const type of [AfflictionType.Root, AfflictionType.Stun, AfflictionType.Freeze]) {
      expect(hit(runner({ activeEffects: [{ type, magnitude: 1, duration: 2 }] }), foe({ position: at(1, 0) }))).toEqual([]);
    }
    expect(hit(runner({ escapeRouteSpent: true }), foe({ position: at(1, 0) }))).toEqual([]);
  });

  it('steps directly away, marks the round spent, and refreshes on a regular turn', () => {
    useCombatStore.setState({ units: [runner(), foe({ position: at(1, 0) })] });
    applyPassiveOutcomes(hit(unitNow('archer'), unitNow('foe')));
    const moved = unitNow('archer');
    expect(hexDistance(moved.position, at(1, 0))).toBe(1 + BALANCE.ESCAPE_ROUTE_RETREAT);
    expect(moved.escapeRouteSpent).toBe(true);
    // Not a move of its own turn: Settle In and an aim do not see it
    expect(moved.voluntaryMoved).toBeFalsy();
    useCombatStore.setState({ turnOrder: ['foe', 'archer'], currentUnitId: 'foe' });
    state().nextTurn();
    expect(unitNow('archer').escapeRouteSpent).toBe(false);
  });
});

// ─── Settle In ────────────────────────────────────────────────────────────────

describe('Settle In', () => {
  const settled = () => unitNow('archer').activeEffects.find((e) => e.type === AuraType.SettledAim);
  const startTurn = (over: Partial<CombatUnit>) => {
    useCombatStore.setState({ units: [archer(['settleIn'], 2, over), foe()], currentUnitId: 'archer' });
    beginTurn('archer', SILENT_SINK);
  };

  it('lays one charge after a turn spent without moving, and none after a move', () => {
    startTurn({ previousTurnStationary: true });
    expect(settled()?.magnitude).toBe(settleInPen(RANKS[1]));
    state().reset();
    startTurn({ previousTurnStationary: false });
    expect(settled()).toBeUndefined();
  });

  it('pierces Physical Defense on a ranged damaging cast only', () => {
    const holder = archer(['settleIn'], 2, {
      activeEffects: [{ type: AuraType.SettledAim, magnitude: 20, duration: -1 }],
    });
    const target = foe();
    expect(penetrationAgainst(holder, target, markTarget)).toBe(20);
    expect(penetrationAgainst(holder, target, { ...markTarget, range: 1 })).toBe(0);
    expect(penetrationAgainst(holder, target, coveringFire)).toBe(0);
    // Armour penetration: a magic ranged hit is not sharpened by it
    expect(penetrationAgainst(holder, target, { ...markTarget, damageType: 'magic' })).toBe(0);
  });

  it('is spent by the one cast it sharpened', () => {
    useCombatStore.setState({
      units: [
        archer(['settleIn'], 2, { activeEffects: [{ type: AuraType.SettledAim, magnitude: 20, duration: -1 }] }),
        foe({ stats: stats({ maxHp: 1000, defense: 20 }) }),
      ],
    });
    resolveSkillUse(unitNow('archer'), markTarget, at(2, 0), SILENT_SINK);
    expect(settled()).toBeUndefined();
  });

  it('scales with its rank', () => {
    expect(settleInPen(RANKS[0])).toBeLessThan(settleInPen(RANKS[2]));
  });
});
