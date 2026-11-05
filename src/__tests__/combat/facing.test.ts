import { BALANCE } from '@/data/balanceConstants';
import { CombatUnit, HexCoord, HexDirection, HeroSkill, ReactionSpec, SkillTargetType } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { flankOf, hexesBehind, landingBehind, standableFor } from '@/systems/combat/facing';
import { flushReactions } from '@/systems/combat/reactionResolve';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { requireUnit } from '@/systems/combat/unitLookup';
import { getNeighbors, hexDistance } from '@/utils/hexUtils';
import { at, makeFoe, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * Facing and flanks: every unit faces one of the six hex directions, and an
 * adjacent attacker on its two rear-side hexes deals the flank bonus, on its back
 * hex the backstab. What is pinned is the rule — which approach earns which
 * multiplier, and what turns a unit — through the real resolver, for every one of
 * the six approach hexes after each way a unit's facing is set.
 */

const stats = (over = {}) =>
  makeStats({ maxHp: 5000, attack: 100, defense: 0, magic: 0, critChance: 0, dodgeChance: 0, speed: 5, ...over });

const blow: HeroSkill = makeSkill({ id: 'test_blow' as HeroSkill['id'], name: 'Blow', damage: 1, range: 1 });
const shot: HeroSkill = makeSkill({ id: 'test_shot' as HeroSkill['id'], name: 'Shot', damage: 1, range: 4 });

const state = () => useCombatStore.getState();
const unit = (id: string) => requireUnit(state().units, id);
const ROLL = () => 0.5;

function start(players: CombatUnit[], enemies: CombatUnit[]) {
  setTempoRandom(() => 1);
  state().reset();
  state().initCombat(players, enemies);
}

/**
 * What `striker` deals to `targetId` from each of the six hexes around it, as a
 * multiple of the front blow, keyed by the approach's turn from the target's
 * facing (0 = straight ahead, 3 = behind). Everyone else is cleared off the board
 * first, so only the target's facing decides; the board is put back afterwards.
 */
function sweep(targetId: string): number[] {
  const board = state().units;
  const target = unit(targetId);
  const facing = target.facing;
  if (facing === undefined) throw new Error('target has no facing');
  const around = getNeighbors(target.position);
  const dealt: number[] = [];
  for (let turn = 0; turn < 6; turn++) {
    const striker = makeUnit({
      id: 'striker', isPlayer: !target.isPlayer, position: around[(facing + turn) % 6], stats: stats(), skills: [blow],
    });
    useCombatStore.setState({ units: [{ ...target, currentHp: 5000, activeEffects: [] }, striker] });
    resolveSkillUse(unit('striker'), blow, target.position, SILENT_SINK, { rng: ROLL });
    dealt.push(5000 - unit(targetId).currentHp);
  }
  useCombatStore.setState({ units: board });
  return dealt.map((d) => d / dealt[0]);
}

/** The rule itself: front three plain, rear sides the flank, the back the backstab. */
const RULE = [1, 1, BALANCE.FLANK_MULTIPLIER, BALANCE.BACKSTAB_MULTIPLIER, BALANCE.FLANK_MULTIPLIER, 1];

function expectRule(ratios: number[]) {
  ratios.forEach((r, turn) => expect({ turn, ratio: r }).toEqual({ turn, ratio: expect.closeTo(RULE[turn], 2) }));
}

const dirOf = (from: HexCoord, to: HexCoord) =>
  getNeighbors(from).findIndex((n) => n.q === to.q && n.r === to.r) as HexDirection;

describe('the side and back multipliers', () => {
  it('replace nothing at the front and stack only for adjacent attackers', () => {
    expect(BALANCE.FLANK_MULTIPLIER).toBeGreaterThan(1);
    expect(BALANCE.BACKSTAB_MULTIPLIER).toBeGreaterThan(BALANCE.FLANK_MULTIPLIER);
  });

  it('read the approach against the target\'s facing, whichever side swings', () => {
    for (const isPlayer of [true, false]) {
      const target = makeUnit({ id: 't', isPlayer, position: at(0, 0), facing: 2 });
      const around = getNeighbors(target.position);
      const flanks = around.map((hex) => flankOf(makeUnit({ isPlayer: !isPlayer, position: hex }), target));
      expect(flanks).toEqual(['side', 'front', 'front', 'front', 'side', 'back']);
    }
  });

  it('are never earned from range, nor against a unit with no front', () => {
    const target = makeUnit({ id: 't', position: at(0, 0), facing: 0 });
    // Two hexes straight behind: not adjacent, so a plain blow
    expect(flankOf(makeFoe({ position: at(-2, 0) }), target)).toBe('front');
    const banner = makeUnit({ id: 'b', position: at(0, 0), facing: 0, objective: { kind: 'standard' } as CombatUnit['objective'] });
    expect(flankOf(makeFoe({ position: at(-1, 0) }), banner)).toBe('front');
    expect(flankOf(makeFoe({ position: at(-1, 0) }), makeUnit({ position: at(0, 0) }))).toBe('front');
  });

  it('leave a ranged attack from behind untouched', () => {
    start([makeUnit({ id: 'hero', position: at(0, 2), stats: stats() })],
      [makeFoe({ id: 'archer', position: at(0, -1), stats: stats(), skills: [shot] })]);
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'hero' ? { ...u, facing: 5 as HexDirection } : u)) }));
    const front = (() => {
      resolveSkillUse(unit('archer'), shot, at(0, 2), SILENT_SINK, { rng: ROLL });
      return 5000 - unit('hero').currentHp;
    })();
    // Same distance, now straight at its back: still the front blow
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === 'hero' ? { ...u, currentHp: 5000, facing: 2 as HexDirection } : u)),
    }));
    resolveSkillUse(unit('archer'), shot, at(0, 2), SILENT_SINK, { rng: ROLL });
    expect(5000 - unit('hero').currentHp).toBe(front);
  });
});

describe('what sets a unit\'s facing', () => {
  it('faces the enemy side at deployment', () => {
    start(
      [makeUnit({ id: 'a', position: at(0, 4), stats: stats() }), makeUnit({ id: 'b', position: at(-2, 4), stats: stats() })],
      [makeFoe({ id: 'x', position: at(0, -4), stats: stats() }), makeFoe({ id: 'y', position: at(2, -4), stats: stats() })],
    );
    for (const id of ['a', 'b', 'x', 'y']) {
      const u = unit(id);
      const ahead = getNeighbors(u.position)[u.facing!];
      // One step ahead brings it closer to the other side's centre
      const foes = state().units.filter((f) => f.isPlayer !== u.isPlayer);
      const toward = (h: HexCoord) => foes.reduce((n, f) => n + hexDistance(h, f.position), 0);
      expect(toward(ahead)).toBeLessThan(toward(u.position));
    }
    expectRule(sweep('a'));
    expectRule(sweep('x'));
  });

  it('a move turns it to its last step', () => {
    start([makeUnit({ id: 'hero', position: at(0, 2), stats: stats() })], [makeFoe({ id: 'foe', position: at(0, -3), stats: stats() })]);
    // A bent route: north-west, then east
    const path = [at(0, 2), at(0, 1), at(1, 1)];
    state().moveUnit('hero', at(1, 1), 'walk', true, undefined, path);
    expect(unit('hero').facing).toBe(dirOf(at(0, 1), at(1, 1)));
    expectRule(sweep('hero'));
  });

  it('an attack turns it toward its target', () => {
    start([makeUnit({ id: 'hero', position: at(0, 0), stats: stats(), skills: [blow] })],
      [makeFoe({ id: 'foe', position: at(-1, 1), stats: stats() })]);
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'hero' ? { ...u, facing: 0 as HexDirection } : u)) }));
    resolveSkillUse(unit('hero'), blow, at(-1, 1), SILENT_SINK, { rng: ROLL });
    expect(unit('hero').facing).toBe(dirOf(at(0, 0), at(-1, 1)));
    expectRule(sweep('hero'));
  });

  it('a Reaction answer turns it toward the attacker', () => {
    const counter = makeSkill({ id: 'test_counter' as HeroSkill['id'], name: 'Counter', damage: 1, range: 1 });
    const brace = makeSkill({
      id: 'test_brace' as HeroSkill['id'], name: 'Brace', targetType: SkillTargetType.Self, range: 0,
      reaction: { trigger: { kind: 'struck', melee: true }, duration: 2, response: counter } as ReactionSpec,
    });
    start([makeUnit({ id: 'tank', position: at(0, 0), stats: stats(), skills: [brace] })],
      [makeFoe({ id: 'goblin', position: at(0, 1), stats: stats() })]);
    resolveSkillUse(unit('tank'), brace, at(0, 0), SILENT_SINK);
    // Looking away from the goblin when it strikes
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'tank' ? { ...u, facing: 2 as HexDirection } : u)) }));
    state().damageUnit('tank', 10, 'goblin');
    flushReactions(SILENT_SINK);
    expect(unit('tank').facing).toBe(dirOf(at(0, 0), at(0, 1)));
    expectRule(sweep('tank'));
  });

  it('a push moves the body and leaves it looking where it looked', () => {
    const shove = makeSkill({ id: 'test_shove' as HeroSkill['id'], name: 'Shove', damage: 1, range: 1, pushDistance: 1 });
    start([makeUnit({ id: 'hero', position: at(0, 0), stats: stats(), skills: [shove] })],
      [makeFoe({ id: 'foe', position: at(1, 0), stats: stats() })]);
    // The foe looks north-west; the shove throws it east
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'foe' ? { ...u, facing: 2 as HexDirection } : u)) }));
    const angle = unit('foe').facingAngle;
    resolveSkillUse(unit('hero'), shove, at(1, 0), SILENT_SINK, { rng: ROLL });
    expect(unit('foe').position).toEqual(at(2, 0));
    expect(unit('foe').facing).toBe(2);
    expect(unit('foe').facingAngle).toBe(angle);
    expectRule(sweep('foe'));
  });
});

describe('landing behind a target', () => {
  const target = makeFoe({ id: 't', position: at(0, 0), facing: 0 });
  const behind = hexesBehind(target);

  it('takes the back hex when it is free', () => {
    expect(behind[0]).toEqual(getNeighbors(at(0, 0))[3]);
    const mover = makeUnit({ id: 'm', position: at(2, 0) });
    expect(landingBehind(target, mover.position, standableFor('m', [target, mover], []))).toEqual(behind[0]);
  });

  it('falls back to a rear side, then to nowhere', () => {
    const mover = makeUnit({ id: 'm', position: at(2, 0) });
    const back = makeUnit({ id: 'b', position: behind[0] });
    const side = landingBehind(target, mover.position, standableFor('m', [target, mover, back], []));
    expect(side && behind.slice(1).some((h) => h.q === side.q && h.r === side.r)).toBe(true);
    const walls = behind.map((h, i) => makeUnit({ id: `w${i}`, position: h }));
    expect(landingBehind(target, mover.position, standableFor('m', [target, mover, ...walls], []))).toBeUndefined();
  });
});
