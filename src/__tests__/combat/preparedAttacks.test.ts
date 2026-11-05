import {
  AfflictionType,
  AuraType,
  CombatUnit,
  HeroSkill,
  SkillTargetType,
} from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { requireUnit } from '@/systems/combat/unitLookup';
import { isPreparedDue, previewPrepared, responsesOwed } from '@/systems/combat/preparedAttacks';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { beginTurn } from '@/systems/combat/turnStart';
import { warningLines } from '@/data/display/preparedDisplay';
import { shelterGroupHexes, warnedGroups } from '@/data/display/boardOverlays';
import { SCRIPTS } from '@/systems/combat/scriptRegistry';
import { at, makeFoe, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * A warned attack is a fixed footprint, a response window, and one landing.
 *
 * What is pinned is the rule — nothing resolves before every threatened hero has
 * had a turn, what the preview names is what lands, and a phase change clears
 * rather than ambushes — and not the numbers the tests happen to use.
 */

const smash = (over: Partial<HeroSkill> = {}): HeroSkill =>
  makeSkill({
    id: 'test_smash' as HeroSkill['id'],
    name: 'Test Smash',
    targetType: SkillTargetType.Ring,
    range: 0,
    aoeRadius: 1,
    damage: 2,
    manaCost: 5,
    cooldown: 3,
    prepares: {},
    ...over,
  });

const boss = (over: Partial<CombatUnit> = {}) =>
  makeFoe({
    id: 'boss',
    name: 'Boss',
    position: at(0, 0),
    stats: makeStats({ maxHp: 400, attack: 30, speed: 20, critChance: 0, dodgeChance: 0 }),
    skills: [smash()],
    ...over,
  });

const hero = (id: string, position: ReturnType<typeof at>, speed: number) =>
  makeUnit({
    id,
    name: id,
    heroId: id,
    position,
    stats: makeStats({ maxHp: 300, defense: 0, speed, critChance: 0, dodgeChance: 0, moveRange: 2 }),
  });

const units = () => useCombatStore.getState().units;
const unitOf = (id: string) => requireUnit(units(), id);
const pending = () => useCombatStore.getState().preparedAttacks;

function start(extra: CombatUnit[] = [], bossOver: Partial<CombatUnit> = {}) {
  const store = useCombatStore.getState();
  store.reset();
  store.initCombat([hero('a', at(1, 0), 10), hero('b', at(-1, 0), 5), ...extra], [boss(bossOver)]);
  useCombatStore.setState({ currentUnitId: 'boss' });
}

const cast = (skill: HeroSkill = smash()) =>
  resolveSkillUse(unitOf('boss'), skill, at(0, 0), SILENT_SINK);

/** One full lap: every unit's turn ends once, starting with whoever holds it. */
const passTurns = (n: number) => {
  for (let i = 0; i < n; i++) useCombatStore.getState().nextTurn();
};

describe('casting a preparation', () => {
  it('announces instead of striking, and pays for it now', () => {
    start();
    const result = cast();

    expect(result.ok).toBe(true);
    expect(result.endsTurn).toBe(true);
    expect(pending()).toHaveLength(1);
    // Nothing was dealt
    expect(unitOf('a').currentHp).toBe(300);
    expect(unitOf('b').currentHp).toBe(300);
    // And the price is paid at the cast
    expect(unitOf('boss').cooldowns?.test_smash).toBeGreaterThan(0);
  });

  it('fixes the footprint, the aim and who is owed a response', () => {
    start();
    cast();
    const [attack] = pending();

    expect(attack.hexes).toContainEqual(at(1, 0));
    expect(attack.hexes).toContainEqual(at(-1, 0));
    expect(new Set(attack.responders)).toEqual(new Set(['a', 'b']));
    expect(attack.responded).toEqual([]);
  });

  it('refuses a second warning while one is pending', () => {
    start();
    cast();
    const again = cast(smash({ id: 'other_smash' as HeroSkill['id'], cooldown: 0 }));
    expect(again.ok).toBe(false);
    expect(pending()).toHaveLength(1);
  });
});

describe('the response window', () => {
  it('cannot resolve before every threatened hero has had a turn', () => {
    start();
    cast();
    const [attack] = pending();

    expect(isPreparedDue(attack, units())).toBe(false);
    expect(responsesOwed(attack, units())).toEqual(['a', 'b']);

    passTurns(2); // boss ends, then a ends: a has answered, b has not
    const midway = pending()[0];
    expect(midway.responded).toEqual(['a']);
    expect(isPreparedDue(midway, units())).toBe(false);

    passTurns(1); // b ends
    expect(isPreparedDue(pending()[0], units())).toBe(true);
  });

  it('does not count the caster acting again as an answer', () => {
    start();
    cast();
    // The boss takes turn after turn with nobody else acting in between
    for (let i = 0; i < 3; i++) {
      const started = beginTurn('boss', SILENT_SINK);
      expect(started.kind).toBe('act');
    }
    expect(pending()).toHaveLength(1);
    expect(unitOf('a').currentHp).toBe(300);
  });

  it('does not wait on a responder who died', () => {
    start();
    cast();
    useCombatStore.getState().damageUnit('b', 9999);
    passTurns(2);
    expect(isPreparedDue(pending()[0], units())).toBe(true);
  });

  it('does not wait on a unit with no turn of its own, and still strikes it', () => {
    // A Thunder Elemental beside the boss: it never takes a turn, so a window owed
    // by it would never close (playtest 2026-10-23, the Burrowmother's Undermine)
    const elemental = makeUnit({
      id: 'elemental', name: 'elemental', position: at(0, 1), companion: true, summonedBy: 'a',
      stats: makeStats({ maxHp: 300, defense: 0, speed: 1, critChance: 0, dodgeChance: 0 }),
    });
    start([elemental]);
    cast();
    const [attack] = pending();
    expect(attack.responders).not.toContain('elemental');

    passTurns(3); // boss, a, b
    expect(isPreparedDue(pending()[0], units())).toBe(true);
    beginTurn('boss', SILENT_SINK);
    expect(unitOf('elemental').currentHp).toBeLessThan(300);
  });

  it('is due at once when the footprint is empty, and then strikes nothing', () => {
    start();
    // Aimed at a self-centred ring with nobody beside the boss
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.heroId ? { ...u, position: at(u.id === 'a' ? 3 : -3, 0) } : u)),
    }));
    cast();
    expect(isPreparedDue(pending()[0], units())).toBe(true);

    const started = beginTurn('boss', SILENT_SINK);
    expect(started.kind).toBe('resolved');
    expect(pending()).toHaveLength(0);
  });
});

describe('landing', () => {
  it('resolves from beginTurn once the window is over, and is that turn', () => {
    start();
    cast();
    passTurns(3); // boss -> a -> b -> boss
    expect(useCombatStore.getState().currentUnitId).toBe('boss');

    const started = beginTurn('boss', SILENT_SINK);

    expect(started.kind).toBe('resolved');
    expect(pending()).toHaveLength(0);
    expect(unitOf('a').currentHp).toBeLessThan(300);
    expect(unitOf('b').currentHp).toBeLessThan(300);
  });

  it('waits when the window is not over, and the caster acts normally', () => {
    start();
    cast();
    passTurns(2);
    // The boss's turn arrives at a later lap in this fixture only if b answers;
    // here it begins early, which a speed bonus turn would do
    const started = beginTurn('boss', SILENT_SINK);
    expect(started.kind).toBe('act');
    expect(pending()).toHaveLength(1);
  });

  it('hits the warned hexes even if the caster moved since', () => {
    start();
    cast();
    const warned = pending()[0].hexes;
    useCombatStore.getState().moveUnit('boss', at(0, -3));
    passTurns(3);

    beginTurn('boss', SILENT_SINK);

    // a and b were inside the warned footprint, nowhere near where the boss is now
    expect(warned).toContainEqual(at(1, 0));
    expect(unitOf('a').currentHp).toBeLessThan(300);
  });

  it('does not hit a hero who left the footprint during the window', () => {
    start();
    cast();
    useCombatStore.getState().moveUnit('a', at(3, 0));
    passTurns(3);
    beginTurn('boss', SILENT_SINK);

    expect(unitOf('a').currentHp).toBe(300);
    expect(unitOf('b').currentHp).toBeLessThan(300);
  });

  it('does not charge the cost a second time', () => {
    start();
    cast();
    const manaAfterCast = unitOf('boss').currentMana;
    passTurns(3);
    beginTurn('boss', SILENT_SINK);
    expect(unitOf('boss').currentMana).toBe(manaAfterCast);
  });
});

describe('the preview', () => {
  it('names the units the strike then strikes', () => {
    start();
    cast();
    const preview = previewPrepared(pending()[0], units());

    expect(new Set(preview.targetIds)).toEqual(new Set(['a', 'b']));
    passTurns(3);
    beginTurn('boss', SILENT_SINK);

    const hurt = units().filter((u) => u.heroId && u.currentHp < 300).map((u) => u.id);
    expect(new Set(hurt)).toEqual(new Set(preview.targetIds));
  });

  it('shows the push landing the resolution then produces', () => {
    start([], { skills: [smash({ pushDistance: 2 })] });
    cast(smash({ pushDistance: 2 }));
    const preview = previewPrepared(pending()[0], units());
    const expected = Object.fromEntries(preview.landings.map((m) => [m.unitId, m.to]));
    expect(Object.keys(expected).sort()).toEqual(['a', 'b']);

    passTurns(3);
    beginTurn('boss', SILENT_SINK);

    expect(unitOf('a').position).toEqual(expected.a);
    expect(unitOf('b').position).toEqual(expected.b);
  });

  it('pushes from where the caster stood at the cast', () => {
    start([], { skills: [smash({ pushDistance: 1 })] });
    cast(smash({ pushDistance: 1 }));
    const [attack] = pending();
    useCombatStore.getState().moveUnit('boss', at(0, -3));
    passTurns(3);
    beginTurn('boss', SILENT_SINK);

    // a stood at (1,0) with the boss at (0,0): pushed along +q, not toward the new boss hex
    expect(attack.origin).toEqual(at(0, 0));
    expect(unitOf('a').position).toEqual(at(2, 0));
  });

  it('reads out what it is waiting on, then that it lands next', () => {
    start();
    cast();
    const lines = () => warningLines(pending(), pending().map((p) => previewPrepared(p, units())), units());

    expect(lines()[0].detail).toContain('Waiting on');
    expect(lines()[0].imminent).toBe(false);
    passTurns(3);
    expect(lines()[0].imminent).toBe(true);
  });
});

describe('a phase change', () => {
  it('clears the old warning instead of landing it in the new phase', () => {
    start([], { templateId: 'aethelred', stats: makeStats({ maxHp: 400, speed: 20 }) });
    cast();
    expect(pending()).toHaveLength(1);

    // He has lived a turn in the opening phase; then cross the first threshold
    useCombatStore.getState().patchBossScript('boss', { phaseTurns: 1 });
    useCombatStore.getState().damageUnit('boss', 400 * 0.4);

    expect(pending()).toHaveLength(0);
    expect(unitOf('a').currentHp).toBe(300);
  });
});

describe('interrupts do not touch the response window of other warnings', () => {
  it('leaves a Stun-immune ordinary turn alone', () => {
    start([], { templateId: 'aethelred' });
    cast(smash({ prepares: { interruptedBy: ['stun'] } }));
    // A different status that the spec does not list does not cancel it
    useCombatStore.getState().applyEffect('boss', {
      type: AfflictionType.Bleed, magnitude: 1, duration: 2,
    });
    expect(pending()).toHaveLength(1);
  });
});

// ── shared damage, the whiff hook, blockers and shelter ──────────────────────

/** Lands the warning in the store: every hero answers, then the boss begins his turn. */
function land() {
  passTurns(3);
  return beginTurn('boss', SILENT_SINK);
}
const lost = (id: string) => 300 - unitOf(id).currentHp;
const wardedBy = (id: string, over: Partial<CombatUnit> = {}) =>
  useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === id ? { ...u, ...over } : u)) }));
const move = (id: string, to: ReturnType<typeof at>) =>
  useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === id ? { ...u, position: to } : u)) }));

/** What one hero loses to the plain landing, for the shares to be measured against. */
function plainLoss(): number {
  start();
  move('b', at(-3, 0));
  cast();
  land();
  return lost('a');
}

describe('shared damage (PreparedSpec.split)', () => {
  const shared = smash({ prepares: { split: true } });

  it('divides the landing by the number struck, and a hero alone takes all of it', () => {
    const whole = plainLoss();
    expect(whole).toBeGreaterThan(10);

    start();
    cast(shared);
    land();
    // Two struck: each takes half (rounding may cost a point)
    expect(Math.abs(lost('a') - whole / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(lost('b') - whole / 2)).toBeLessThanOrEqual(1);

    start();
    move('b', at(-3, 0));
    cast(shared);
    land();
    expect(lost('a')).toBe(whole);
    expect(lost('b')).toBe(0);
  });

  it('previews the shares the landing then deals', () => {
    start();
    cast(shared);
    const preview = previewPrepared(pending()[0], units());
    expect(preview.splitBy).toBe(2);
    expect(preview.shares.map((s) => s.share)).toEqual([0.5, 0.5]);
    expect(new Set(preview.shares.map((s) => s.unitId))).toEqual(new Set(preview.targetIds));

    land();
    expect(lost('a')).toBe(lost('b'));
    expect(lost('a')).toBeGreaterThan(0);
  });

  it('says so on the banner, and says when it is struck alone', () => {
    start();
    cast(shared);
    const text = () => warningLines(pending(), pending().map((p) => previewPrepared(p, units())), units())[0].detail;
    expect(text()).toContain('shared by 2');
    move('b', at(-3, 0));
    expect(text()).toContain('struck alone');
  });
});

describe('the whiff hook (PreparedSpec.onWhiff)', () => {
  const whiffing = smash({ prepares: { onWhiff: 'test_whiff' } });
  let spy: jest.Mock;
  beforeEach(() => {
    spy = jest.fn();
    SCRIPTS[0].whiff = spy;
  });
  afterEach(() => {
    delete SCRIPTS[0].whiff;
  });

  it('fires exactly once when the landing strikes nobody', () => {
    start();
    move('a', at(3, 0));
    move('b', at(-3, 0));
    cast(whiffing);
    expect(previewPrepared(pending()[0], units()).whiffsNow).toBe('test_whiff');
    land();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].spec.onWhiff).toBe('test_whiff');
  });

  it('never fires when someone is struck', () => {
    start();
    move('b', at(-3, 0));
    cast(whiffing);
    expect(previewPrepared(pending()[0], units()).whiffsNow).toBeUndefined();
    land();
    expect(lost('a')).toBeGreaterThan(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('is stated on the banner, with its own words when the catalog has them', () => {
    start();
    cast(whiffing);
    const text = warningLines(pending(), pending().map((p) => previewPrepared(p, units())), units())[0].detail;
    expect(text).toContain('if nobody is struck');
  });
});

describe('blockers (PreparedSpec.blockedBy)', () => {
  const blockable = (over: Partial<HeroSkill> = {}) => smash({
    pushDistance: 2,
    appliesEffect: { type: AfflictionType.Bleed, magnitude: 3, duration: 2 },
    prepares: { blockedBy: { share: 0.5, casterStatus: { type: AuraType.Exposed, magnitude: 0.3, duration: 2 } } },
    ...over,
  });
  const immovable = { passives: ['immovable' as never] };

  it('strikes only the blocker at the share, drops the push and the affliction, and costs the caster', () => {
    const whole = plainLoss();
    start();
    wardedBy('a', immovable);
    cast(blockable());
    const before = { a: unitOf('a').position, b: unitOf('b').position };
    land();

    expect(Math.abs(lost('a') - whole / 2)).toBeLessThanOrEqual(1);
    expect(lost('b')).toBe(0);
    expect(unitOf('a').position).toEqual(before.a);
    expect(unitOf('b').position).toEqual(before.b);
    expect(unitOf('a').activeEffects.some((e) => e.type === AfflictionType.Bleed)).toBe(false);
    expect(unitOf('boss').activeEffects.some((e) => e.type === AuraType.Exposed)).toBe(true);
  });

  it('an unblocked landing still pushes and afflicts', () => {
    start();
    cast(blockable());
    land();
    expect(lost('a')).toBeGreaterThan(0);
    expect(lost('b')).toBeGreaterThan(0);
    expect(unitOf('a').position).not.toEqual(at(1, 0));
    expect(unitOf('boss').activeEffects.some((e) => e.type === AuraType.Exposed)).toBe(false);
  });

  it('a Barrier is a block, and the preview names the hero the landing then hits', () => {
    start();
    wardedBy('b', { activeEffects: [{ type: AuraType.Barrier, magnitude: 1, duration: 3 }] });
    cast(blockable());
    const preview = previewPrepared(pending()[0], units());
    expect(preview.blockerId).toBe('b');
    expect(preview.targetIds).toEqual(['b']);
    expect(preview.landings.filter((m) => m.moved)).toHaveLength(0);
    const text = warningLines(pending(), [preview], units())[0].detail;
    expect(text).toContain('b holds the line');

    land();
    expect(lost('a')).toBe(0);
    expect(lost('b')).toBeGreaterThan(0);
  });

  it('chooses the shielded hero nearest the caster, ties by lower id', () => {
    start([hero('near', at(1, 0), 4), hero('far', at(2, 0), 3)], { skills: [smash({ aoeRadius: 2 })] });
    wardedBy('near', immovable);
    wardedBy('far', immovable);
    cast(blockable({ aoeRadius: 2 }));
    expect(previewPrepared(pending()[0], units()).blockerId).toBe('near');

    // Equal distance: the lower id (a) holds it, not b
    start();
    wardedBy('a', immovable);
    wardedBy('b', immovable);
    cast(blockable());
    expect(previewPrepared(pending()[0], units()).blockerId).toBe('a');
    land();
    expect(lost('a')).toBeGreaterThan(0);
    expect(lost('b')).toBe(0);
  });

  it('states what stops it while nobody yet holds the line', () => {
    start();
    cast(blockable());
    const text = warningLines(pending(), pending().map((p) => previewPrepared(p, units())), units())[0].detail;
    expect(text).toContain('stops it');
  });
});

describe('shelter (PreparedSpec.shelter)', () => {
  it('spares hexes beside a living objective of the kind, and draws them apart', () => {
    start();
    useCombatStore.setState((s) => ({
      units: [...s.units, makeFoe({
        id: 'wall', name: 'Wall', position: at(1, 1), objective: { kind: 'wall', ownerId: 'boss' },
        stats: makeStats({ maxHp: 50 }),
      })],
    }));
    cast(smash({ prepares: { shelter: { besideObjective: 'wall' } } }));
    const [attack] = pending();
    const preview = previewPrepared(attack, units());

    // Both footprint hexes beside the wall: the one a hero stands on and the empty one next to it
    expect(preview.sheltered).toEqual(expect.arrayContaining([at(1, 0), at(0, 1)]));
    expect(preview.sheltered).toHaveLength(2);
    expect(preview.targetIds).toEqual(['b']);
    expect(warnedGroups(pending(), units(), []).flatMap((g) => g.hexes)).not.toContainEqual(at(1, 0));
    expect(shelterGroupHexes(pending(), units(), [])).toHaveLength(2);
    expect(warningLines(pending(), [preview], units())[0].detail).toContain('sheltered');

    land();
    expect(lost('a')).toBe(0);
    expect(lost('b')).toBeGreaterThan(0);
  });

  it('spares hexes lying on a hazard of the kind', () => {
    start();
    useCombatStore.getState().addHazard({ id: 'trench', hexes: [at(-1, 0)], solid: false, label: 'trench' });
    cast(smash({ prepares: { shelter: { onHazard: 'trench' } } }));
    expect(previewPrepared(pending()[0], units(), useCombatStore.getState().hazards).sheltered).toEqual([at(-1, 0)]);
    land();
    expect(lost('b')).toBe(0);
    expect(lost('a')).toBeGreaterThan(0);
  });

  it('a whiff is a landing that strikes nobody, sheltered or not', () => {
    start();
    useCombatStore.getState().addHazard({ id: 'trench', hexes: [at(1, 0), at(-1, 0)], solid: false, label: 'trench' });
    cast(smash({ prepares: { shelter: { onHazard: 'trench' }, onWhiff: 'x' } }));
    const preview = previewPrepared(pending()[0], units(), useCombatStore.getState().hazards);
    expect(preview.targetIds).toEqual([]);
    expect(preview.whiffsNow).toBe('x');
  });
});
