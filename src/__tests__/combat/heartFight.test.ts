import { spyDice } from '../support/dice';
import { AuraType, CombatUnit, HeroSkill } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { useCombatStore } from '@/stores/combatStore';
import { arenaHexes } from '@/systems/combat/arenaGeometry';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { getMovementRange } from '@/systems/combat/movement';
import { requireUnit } from '@/systems/combat/unitLookup';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { beginHeartTurn, castHeartMove } from '@/systems/combat/heartActions';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { decideEnemyAction } from '@/systems/combat/enemyAI';
import { strikePulse } from '@/systems/combat/heartLanding';
import {
  anchorsOf,
  ANCHOR_KIND,
  anchorSpots,
  chooseHeartMove,
  convergencePlan,
  fractureHex,
  HEART_FIRST_TURN,
  HEART_ICE_ID,
  HEART_RECHAINED_PHASE,
  HEART_TORN_PHASE,
  HEART_TWIST,
  heartIntent,
  heartStart,
  heartTierOf,
  heartTwist,
  iceOf,
  HeartMoveContext,
  isFrozen,
  reprisalPlan,
  reprisalPlans,
  SPIRE_KIND,
  spiresOf,
  reprisalGrade,
  winterCount,
  winterHexes,
  winterShelter,
} from '@/systems/combat/heartScript';
import { resolveDuePrepared } from '@/systems/combat/preparedResolve';
import { previewPrepared } from '@/systems/combat/preparedAttacks';
import { warningLines } from '@/data/display/preparedDisplay';
import { answersOf, cancellingObjectives } from '@/systems/combat/warnedAnswers';
import { SILENT_SINK } from '@/systems/combat/skillResolution';
import { getHexesInRange, hexDistance, hexKey } from '@/utils/hexUtils';
import { HEART_PHASES } from '@/data/templates/heartOfWinter';
import { partyPolicy } from '@/systems/sim/balance/partyPolicy';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * The Heart of Winter's fight, held at the rules the plan agreed: three anchors that
 * soak 99 / 66 / 33 per cent by count, an anchor that answers a Reprisal, a release by
 * the last anchor that exposes it and one by health that does not, spires that can
 * each be broken, and ice that costs a movement point and shatters under a Pulse.
 */

const fx = { log: () => {}, float: () => {} };

const hero = (id: string, position = at(0, 3)) =>
  makeUnit({
    id,
    heroId: id,
    name: id,
    position,
    stats: makeStats({ maxHp: 5000, attack: 60, speed: 5, critChance: 0, dodgeChance: 0, moveRange: 3 }),
    skills: [makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 6 })],
  });

const units = () => useCombatStore.getState().units;
const heart = (): CombatUnit => units().find((u) => u.templateId === 'heart_of_winter')!;
const anchors = () => anchorsOf(heart(), units());
const spires = () => spiresOf(heart(), units());
const prepared = () => useCombatStore.getState().preparedAttacks;

function start(heroes: CombatUnit[] = [hero('h1'), hero('h2', at(2, 3))]) {
  const store = useCombatStore.getState();
  store.reset();
  const [boss] = createEnemyUnits(['heart_of_winter'], [at(0, -4)], 1, 1);
  store.initCombat(heroes, [boss]);
  // Begin a turn in the phase, which a health release waits for
  store.patchBossScript(heart().id, { phaseTurns: 1 });
}

const skillOf = (id: string): HeroSkill => heart().skills.find((s) => s.id === id)!;

/** Lets every responder have their turn, and lands what is open. */
function land() {
  const store = useCombatStore.getState();
  for (const p of prepared()) store.updatePreparedAttack(p.id, { responded: p.responders });
  resolveDuePrepared(heart().id, SILENT_SINK);
}

describe('the opening', () => {
  it('starts near the middle of the arena with three anchors on distinct free hexes around it', () => {
    start();
    expect(heart().position).toEqual(heartStart());
    expect(anchors()).toHaveLength(3);
    const keys = anchors().map((a) => hexKey(a.position));
    expect(new Set(keys).size).toBe(3);
    for (const a of anchors()) {
      expect(hexDistance(a.position, heart().position)).toBe(BALANCE.HEART_ANCHOR_RING);
      expect(a.isPlayer).toBe(false);
      expect(a.objective?.kind).toBe(ANCHOR_KIND);
    }
    expect(keys).not.toContain(hexKey(heart().position));
  });

  it('keeps the anchors out of the turn order and out of the way of the party', () => {
    start();
    expect(useCombatStore.getState().turnOrder).toEqual(
      expect.not.arrayContaining(anchors().map((a) => a.id)),
    );
    expect(anchorSpots(heartStart())).toHaveLength(3);
  });

  it('gives each anchor a twentieth of the Heart’s health, and no defence', () => {
    start();
    for (const a of anchors()) {
      expect(a.currentHp).toBe(Math.round(heart().stats.maxHp * BALANCE.HEART_ANCHOR_HP));
      expect(a.stats.defense).toBe(0);
    }
  });
});

describe('the free Pulse between spells', () => {
  it('grants a bonus turn after a warned spell, and none from inside a bonus turn', () => {
    start();
    expect(castHeartMove(heart(), skillOf('creeping_winter'), fx).ok).toBe(true);
    expect(useCombatStore.getState().bonusTurn.pending).toBe(heart().id);

    start();
    useCombatStore.setState({ bonusTurn: { pending: null, active: true } });
    expect(castHeartMove(heart(), skillOf('creeping_winter'), fx).ok).toBe(true);
    expect(useCombatStore.getState().bonusTurn.pending).toBeNull();
  });

  it('spends that free turn on a Pulse, the open warning leaving it nothing else', () => {
    start([hero('h1', at(0, 1)), hero('h2', at(1, 1))]);
    useCombatStore.setState({ currentUnitId: heart().id });
    expect(castHeartMove(heart(), skillOf('creeping_winter'), fx).ok).toBe(true);
    useCombatStore.getState().nextTurn();
    expect(useCombatStore.getState().bonusTurn.active).toBe(true);
    expect(useCombatStore.getState().currentUnitId).toBe(heart().id);
    const skill = decideEnemyAction(heart(), units()).find((a) => a.type === 'skill');
    expect(skill?.skill?.id).toBe('splintering_pulse');
  });
});

describe('anchor protection', () => {
  const taken = (blow: number) => {
    const before = heart().currentHp;
    useCombatStore.getState().damageUnit(heart().id, blow, 'h1');
    return before - heart().currentHp;
  };

  it('soaks 99, 66 and 33 per cent by the number standing, and nothing once none do', () => {
    start();
    const blow = 400;
    expect(taken(blow)).toBeLessThanOrEqual(Math.round(blow * 0.011));
    useCombatStore.getState().removeObjective(anchors()[0].id);
    expect(taken(blow)).toBe(Math.round(blow * 0.34));
    useCombatStore.getState().removeObjective(anchors()[0].id);
    expect(taken(blow)).toBe(Math.round(blow * 0.67));
    useCombatStore.getState().removeObjective(anchors()[0].id);
    expect(taken(blow)).toBe(blow);
  });

  it('never lets a real blow through for nothing', () => {
    start();
    expect(taken(5)).toBeGreaterThanOrEqual(1);
  });
});

describe('the last anchor', () => {
  const breakAll = () => {
    for (const a of anchors()) useCombatStore.getState().damageUnit(a.id, 9999, 'h1');
  };

  it('releases it into the unbound phase and exposes it for one full window', () => {
    start();
    breakAll();
    const boss = heart();
    expect(boss.bossPhase).toBe(1);
    expect(boss.skills.map((s) => s.id)).toContain('whiteout_convergence');
    expect(boss.skills.map((s) => s.id)).not.toContain('icebound_reprisal');
    const open = boss.activeEffects.find((e) => e.type === AuraType.Exposed);
    expect(open?.magnitude).toBe(BALANCE.HEART_EXPOSED);
    expect(open?.duration).toBe(BALANCE.HEART_EXPOSED_TURNS);
    // No health is taken by the release: it is exactly what the party dealt
    expect(boss.currentHp).toBe(boss.stats.maxHp);
    expect(boss.hpCeiling).toBeUndefined();
  });

  it('exposes it to a quarter more from every blow', () => {
    start();
    const striker = hero('h1');
    const skill = makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 6 });
    const before = calculateDamage(striker, heart(), skill);
    breakAll();
    const after = calculateDamage(striker, heart(), skill);
    expect(after).toBe(Math.round(before * (1 + BALANCE.HEART_EXPOSED)));
  });

  it('hits a fifth harder once released', () => {
    start();
    const power = heart().stats.magic;
    breakAll();
    const boss = heart();
    expect(boss.formStats).toEqual(HEART_PHASES[1].stats);
    expect(Math.round(power * BALANCE.HEART_UNBOUND_POWER)).toBeGreaterThan(power);
  });

  it('cancels a warning that was open', () => {
    start();
    expect(castHeartMove(heart(), skillOf('creeping_winter'), fx).ok).toBe(true);
    expect(prepared()).toHaveLength(1);
    breakAll();
    expect(prepared()).toHaveLength(0);
  });
});

// PT-39 (playtest 2026-10-21): phase-1 time pressure — standing anchors feed it
describe('the anchors feed it while it is chained', () => {
  const feed = () => heart().activeEffects.filter((e) =>
    (e.type === AuraType.AttackBuff || e.type === AuraType.MagicBuff) && e.sourceUnitId === heart().id);

  it('stacks Attack and Magic per standing anchor on each of its turns, and says so', () => {
    start();
    const base = heart().stats.magic;
    const lines: string[] = [];
    beginHeartTurn(heart().id, { log: (text) => lines.push(text) });
    expect(feed()).toHaveLength(2);
    expect(feed()[0].stacks).toBe(3);
    expect(getCombatEffectiveStats(heart()).magic).toBe(base + Math.round(base * BALANCE.HEART_ANCHOR_EMPOWER * 3));
    expect(lines.join(' ')).toContain('3 anchors');

    // One anchor down: the next turn adds two, on top of the three
    useCombatStore.getState().damageUnit(anchors()[0].id, 9999, 'h1');
    beginHeartTurn(heart().id);
    expect(feed()[0].stacks).toBe(5);
    expect(getCombatEffectiveStats(heart()).magic).toBe(base + Math.round(base * BALANCE.HEART_ANCHOR_EMPOWER * 5));
    expect(feed()).toHaveLength(2);
  });

  it('sheds the feed on its first unbound turn', () => {
    start();
    beginHeartTurn(heart().id);
    expect(feed()).toHaveLength(2);
    for (const a of anchors()) useCombatStore.getState().damageUnit(a.id, 9999, 'h1');
    expect(heart().bossPhase).toBe(1);
    beginHeartTurn(heart().id);
    expect(feed()).toHaveLength(0);
  });

  it('trims its base Magic to 26', () => {
    const [boss] = createEnemyUnits(['heart_of_winter'], [at(0, -4)], 1, 1);
    expect(boss.stats.magic).toBeLessThanOrEqual(26);
  });
});

describe('release by health', () => {
  it('tears free at half health without the reward, and keeps every point of damage', () => {
    start();
    const max = heart().stats.maxHp;
    // Through the 99% protection, so lay the health down directly the way a long fight would
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === heart().id ? { ...u, currentHp: Math.round(max * 0.45) } : u)),
    }));
    const hp = heart().currentHp;
    useCombatStore.getState().damageUnit(heart().id, 100, 'h1');
    const boss = heart();
    expect(boss.bossPhase).toBe(1);
    expect(anchors()).toHaveLength(0);
    expect(boss.activeEffects.some((e) => e.type === AuraType.Exposed)).toBe(false);
    expect(boss.currentHp).toBeLessThan(hp);
    expect(boss.currentHp).toBeGreaterThan(0);
  });

  it('clears the chained phase\'s warning rather than landing it unexplained', () => {
    start();
    castHeartMove(heart(), skillOf('icebound_reprisal'), fx);
    expect(prepared()).toHaveLength(1);
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === heart().id ? { ...u, currentHp: Math.round(u.stats.maxHp * 0.5) } : u)),
    }));
    useCombatStore.getState().damageUnit(heart().id, 100, 'h1');
    expect(heart().bossPhase).toBe(1);
    expect(prepared()).toHaveLength(0);
  });
});

describe('Icebound Reprisal', () => {
  it('strains against one surviving anchor and marks the chain to the Heart, ends excluded', () => {
    start();
    const plan = reprisalPlan(heart(), units())!;
    expect(anchors().map((a) => a.id)).toContain(plan.anchor.id);
    expect(plan.hexes.length).toBeGreaterThan(0);
    const keys = plan.hexes.map(hexKey);
    expect(keys).not.toContain(hexKey(plan.anchor.position));
    expect(keys).not.toContain(hexKey(heart().position));
  });

  it('is cancelled by destroying its anchor, which costs the Heart 5% of its health through the protection', () => {
    start();
    castHeartMove(heart(), skillOf('icebound_reprisal'), fx);
    const bound = anchors().find((a) => a.objective?.bindsPrepared)!;
    expect(bound.objective?.backlash).toBe(BALANCE.HEART_REPRISAL_BACKLASH);
    const before = heart().currentHp;
    useCombatStore.getState().damageUnit(bound.id, 9999, 'h1');
    expect(prepared()).toHaveLength(0);
    expect(before - heart().currentHp).toBe(Math.round(heart().stats.maxHp * BALANCE.HEART_REPRISAL_BACKLASH));
    // Two anchors left, and the protection with them
    expect(anchors()).toHaveLength(2);
  });

  it('an anchor not named by a warning costs the Heart nothing when it falls', () => {
    start();
    const before = heart().currentHp;
    useCombatStore.getState().damageUnit(anchors()[0].id, 9999, 'h1');
    expect(heart().currentHp).toBe(before);
  });

  it('snaps taut when it is left standing: damage on the line and a Barrier for the Heart', () => {
    start();
    const plan = reprisalPlan(heart(), units())!;
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === 'h1' ? { ...u, position: plan.hexes[0] } : u)),
    }));
    castHeartMove(heart(), skillOf('icebound_reprisal'), fx);
    const hp = requireUnit(units(), 'h1').currentHp;
    land();
    expect(requireUnit(units(), 'h1').currentHp).toBeLessThan(hp);
    const barrier = heart().activeEffects.find((e) => e.type === AuraType.Barrier);
    expect(barrier?.magnitude).toBe(Math.round(heart().stats.maxHp * BALANCE.HEART_REPRISAL_BARRIER));
    // Breaking it afterwards is an ordinary kill, not a backlash
    const before = heart().currentHp;
    const bound = anchors().find((a) => a.objective?.kind === ANCHOR_KIND)!;
    useCombatStore.getState().damageUnit(bound.id, 9999, 'h1');
    expect(heart().currentHp).toBe(before);
  });
});

describe('Whiteout Convergence', () => {
  const unbind = () => {
    for (const a of anchors()) useCombatStore.getState().damageUnit(a.id, 9999, 'h1');
    // The exposure window is over for these rules
    useCombatStore.getState().removeEffect(heart().id, AuraType.Exposed);
  };

  it('raises up to eight distinct spires, each a zero-defence objective, and warns their blasts', () => {
    start();
    unbind();
    expect(castHeartMove(heart(), skillOf('whiteout_convergence'), fx).ok).toBe(true);
    expect(spires().length).toBeGreaterThan(0);
    expect(spires().length).toBeLessThanOrEqual(BALANCE.HEART_SPIRES);
    expect(new Set(spires().map((s) => hexKey(s.position))).size).toBe(spires().length);
    for (const s of spires()) expect(s.stats.defense).toBe(0);
    const footprint = new Set(prepared()[0].hexes.map(hexKey));
    for (const s of spires()) expect(footprint.has(hexKey(s.position))).toBe(true);
  });

  it('leaves every hero somewhere to stand that no blast covers', () => {
    start();
    unbind();
    const plan = convergencePlan(heart(), units(), [])!;
    expect(plan).not.toBeNull();
    const covered = new Set(plan.footprint.map(hexKey));
    const bodies = new Set(plan.spires.map(hexKey));
    for (const h of [requireUnit(units(), 'h1'), requireUnit(units(), 'h2')]) {
      const reach = [...getMovementRange(h, units(), []), h.position];
      expect(reach.some((x) => !covered.has(hexKey(x)) && !bodies.has(hexKey(x)))).toBe(true);
    }
  });

  it('is cancelled spire by spire: each one sends a pulse into the Heart, and clearing all of them tears it open', () => {
    start();
    unbind();
    castHeartMove(heart(), skillOf('whiteout_convergence'), fx);
    const all = spires();
    const before = heart().currentHp;
    useCombatStore.getState().damageUnit(all[0].id, 9999, 'h1');
    expect(before - heart().currentHp).toBe(Math.round(heart().stats.maxHp * BALANCE.HEART_SPIRE_PULSE));
    if (all.length > 1) {
      expect(prepared()).toHaveLength(1);
      expect(heart().activeEffects.some((e) => e.type === AuraType.Exposed)).toBe(false);
    }
    for (const s of all.slice(1)) useCombatStore.getState().damageUnit(s.id, 9999, 'h1');
    expect(prepared()).toHaveLength(0);
    const open = heart().activeEffects.find((e) => e.type === AuraType.Exposed);
    expect(open?.magnitude).toBe(BALANCE.HEART_EXPOSED);
  });

  it('detonates every spire left standing, then takes them away', () => {
    start();
    unbind();
    castHeartMove(heart(), skillOf('whiteout_convergence'), fx);
    const [first] = spires();
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === 'h1' ? { ...u, position: first.position } : u)),
    }));
    const hp = requireUnit(units(), 'h1').currentHp;
    land();
    expect(requireUnit(units(), 'h1').currentHp).toBeLessThan(hp);
    expect(spires()).toHaveLength(0);
    expect(prepared()).toHaveLength(0);
  });
});

describe('Creeping Winter and the ice', () => {
  it('marks half the arena, none on a body', () => {
    start();
    const hexes = winterHexes(heart(), units(), []);
    expect(hexes.length).toBe(winterCount());
    expect(winterCount()).toBe(Math.round(arenaHexes().length * 0.5));
    expect(new Set(hexes.map(hexKey)).size).toBe(hexes.length);
    for (const h of hexes) {
      expect(units().some((u) => u.currentHp > 0 && hexKey(u.position) === hexKey(h) && !u.isPlayer)).toBe(false);
    }
  });

  it('never marks the ice it has already made', () => {
    start();
    castHeartMove(heart(), skillOf('creeping_winter'), fx);
    land();
    expect(isFrozen(prepared()[0]?.hexes[0] ?? useCombatStore.getState().hazards[0].hexes[0], useCombatStore.getState().hazards)).toBe(true);
    const ice = useCombatStore.getState().hazards.find((h) => h.id === HEART_ICE_ID)!;
    expect(ice.hexes).toHaveLength(winterCount());
    const next = winterHexes(heart(), units(), useCombatStore.getState().hazards);
    const frozen = new Set(ice.hexes.map(hexKey));
    for (const h of next) expect(frozen.has(hexKey(h))).toBe(false);
  });

  it('costs a hero one more movement point to enter', () => {
    start([hero('h1', at(0, 0))]);
    const mover = requireUnit(units(), 'h1');
    const open = getMovementRange(mover, units(), []);
    const ground = at(1, 0);
    expect(open.some((h) => hexKey(h) === hexKey(ground))).toBe(true);
    // Every hex in reach is frozen, bodies' hexes included, so no step is cheap
    const frozen = getHexesInRange(mover.position, 3).filter((h) => hexKey(h) !== hexKey(mover.position));
    const ice = [{
      id: HEART_ICE_ID, hexes: frozen, solid: false, label: 'Frozen ground',
      ownerId: heart().id, moveCost: BALANCE.HEART_ICE_COST,
    }];
    const slowed = getMovementRange(mover, units(), ice);
    expect(slowed.length).toBeLessThan(open.length);
    // Move range 3 over ground that costs two a step: one step, and no more
    expect(slowed.every((h) => hexDistance(h, mover.position) <= 1)).toBe(true);
    expect(slowed.length).toBeGreaterThan(0);
  });

  it('shatters under a Pulse for extra damage, and the ground is clear again', () => {
    // Compare the terrain bonus with the same non-critical, non-dodged strikes.
    const random = spyDice().mockReturnValue(0.99);
    try {
      start([hero('h1', at(0, 0))]);
      useCombatStore.getState().addHazard({
        id: HEART_ICE_ID, hexes: [at(0, 0)], solid: false, label: 'Frozen ground',
        ownerId: heart().id, moveCost: BALANCE.HEART_ICE_COST,
      });
      const pulse = skillOf('splintering_pulse');
      const hp = requireUnit(units(), 'h1').currentHp;
      strikePulse(heart(), pulse, at(0, 0), SILENT_SINK);
      expect(isFrozen(at(0, 0), useCombatStore.getState().hazards)).toBe(false);
      const onIce = hp - requireUnit(units(), 'h1').currentHp;

      start([hero('h1', at(0, 0))]);
      const hp2 = requireUnit(units(), 'h1').currentHp;
      strikePulse(heart(), pulse, at(0, 0), SILENT_SINK);
      const bare = hp2 - requireUnit(units(), 'h1').currentHp;
      expect(onIce).toBeGreaterThan(bare);
    } finally { random.mockRestore(); }
  });

  it('fractures onto the hero directly behind the target, and onto nobody when the hex is empty', () => {
    const from = at(0, -2);
    const target = at(0, 0);
    const behind = fractureHex(from, target)!;
    expect(hexDistance(target, behind)).toBe(1);
    expect(hexDistance(from, behind)).toBe(hexDistance(from, target) + 1);

    start([hero('h1', target), hero('h2', behind)]);
    const hp = requireUnit(units(), 'h2').currentHp;
    strikePulse(heart(), skillOf('splintering_pulse'), target, SILENT_SINK);
    expect(requireUnit(units(), 'h2').currentHp).toBeLessThan(hp);

    expect(fractureHex(at(0, 4), at(0, 5))).toBeNull();
  });
});

describe('choosing the move', () => {
  const offers = (value = 2) => ({
    pulse: { available: true, value: 1 },
    winter: { available: true, value },
    reprisal: { available: true, value },
    convergence: { available: true, value },
  });
  const ctx = (over: Partial<HeartMoveContext>): HeartMoveContext => ({
    majorPending: false,
    turns: 6,
    lastUsed: {},
    lastSignature: 0,
    offers: offers(),
    ...over,
  });

  it('never raises a warning while one is open, or on the turn after one landed', () => {
    expect(chooseHeartMove(ctx({ majorPending: true }))).toBe('pulse');
    expect(chooseHeartMove(ctx({ turns: 7, lastSignature: 6 }))).toBe('pulse');
    expect(chooseHeartMove(ctx({ turns: 8, lastSignature: 6 }))).toBe('pulse');
    expect(chooseHeartMove(ctx({ turns: 9, lastSignature: 6 }))).not.toBe('pulse');
  });

  it('opens with the Pulse and brings Creeping Winter in before the first Reprisal', () => {
    expect(chooseHeartMove(ctx({ turns: 1 }))).toBe('pulse');
    expect(HEART_FIRST_TURN.winter).toBeLessThan(HEART_FIRST_TURN.reprisal);
    const second = chooseHeartMove(ctx({ turns: HEART_FIRST_TURN.winter, offers: { ...offers(), convergence: { available: false, value: 0 } } }));
    expect(second).toBe('winter');
  });

  it('is not a rotation: the unused move gains worth the longer it waits', () => {
    const base = ctx({ offers: { ...offers(), winter: { available: true, value: 2 }, reprisal: { available: true, value: 2 }, convergence: { available: false, value: 0 } } });
    const longWait = chooseHeartMove({ ...base, lastUsed: { winter: 5, reprisal: 1 } });
    const other = chooseHeartMove({ ...base, lastUsed: { winter: 1, reprisal: 5 } });
    expect(longWait).toBe('reprisal');
    expect(other).toBe('winter');
  });
});

describe('Creeping Winter is sheltered beside a standing anchor', () => {
  const ring = () => winterShelter(heart(), units());
  const ringKeys = () => new Set(ring().map(hexKey));
  const place = (id: string, position: ReturnType<typeof at>) =>
    useCombatStore.setState((st) => ({ units: st.units.map((u) => (u.id === id ? { ...u, position } : u)) }));
  const hp = (id: string) => requireUnit(units(), id).currentHp;
  const frozenKeys = () =>
    new Set((useCombatStore.getState().hazards.find((h) => h.id === HEART_ICE_ID)?.hexes ?? []).map(hexKey));
  /** Casts it with h1 standing on the sheltered ring and h2 on ground it marks. */
  function castBesideAnchor() {
    start();
    const beside = ring().find((h) => !units().some((u) => u.currentHp > 0 && hexKey(u.position) === hexKey(h)))!;
    place('h1', beside);
    const open = winterHexes(heart(), units(), []).find((h) => hexKey(h) !== hexKey(beside))!;
    place('h2', open);
    castHeartMove(heart(), skillOf('creeping_winter'), fx);
    return { beside, open, attack: prepared()[0] };
  }

  it('leaves every hex beside a living anchor out of the footprint', () => {
    start();
    expect(ring().length).toBeGreaterThan(0);
    const marked = winterHexes(heart(), units(), []).map(hexKey);
    for (const a of anchors()) {
      for (const h of getHexesInRange(a.position, 1)) expect(marked).not.toContain(hexKey(h));
    }
    // Half the arena is still marked: the shelter takes from the candidates, not from the count
    expect(marked).toHaveLength(winterCount());
  });

  it('shows the same ring in the preview as the landing spares, and strikes only the footprint', () => {
    const { beside, open, attack } = castBesideAnchor();
    expect(attack.hexes.map(hexKey)).toContain(hexKey(open));
    expect(attack.hexes.map(hexKey)).not.toContain(hexKey(beside));
    const preview = previewPrepared(attack, units(), useCombatStore.getState().hazards);
    expect(new Set(preview.sheltered.map(hexKey))).toEqual(ringKeys());
    expect(preview.targetIds).toEqual(['h2']);
    const hp1 = hp('h1');
    const hp2 = hp('h2');
    land();
    expect(hp('h1')).toBe(hp1);
    expect(hp('h2')).toBeLessThan(hp2);
    for (const key of ringKeys()) expect(frozenKeys().has(key)).toBe(false);
    expect(frozenKeys().size).toBe(winterCount());
  });

  it('is fixed at the cast: an anchor that falls afterwards changes nothing', () => {
    const { beside, attack } = castBesideAnchor();
    const footprint = attack.hexes.map(hexKey);
    const spared = (attack.sheltered ?? []).map(hexKey);
    useCombatStore.getState().damageUnit(anchors()[0].id, 99999, 'h1');
    expect(prepared()[0].hexes.map(hexKey)).toEqual(footprint);
    expect(prepared()[0].sheltered?.map(hexKey)).toEqual(spared);
    const hp1 = hp('h1');
    land();
    expect(hp('h1')).toBe(hp1);
    expect(frozenKeys().has(hexKey(beside))).toBe(false);
  });

  it('says so on the banner, and tallies the hero who walked onto the ring as unharmed, not stepped', () => {
    const { attack, beside } = castBesideAnchor();
    const preview = previewPrepared(attack, units(), useCombatStore.getState().hazards);
    const [line] = warningLines(prepared(), [preview], units());
    expect(line.detail).toContain('sheltered');
    // h2 stood in the footprint at the cast: owed an answer. h1 stood on the ring: owed none
    expect(attack.threatened).toEqual(['h2']);
    place('h2', beside);
    land();
    expect(useCombatStore.getState().answerTally.creeping_winter).toMatchObject({ unharmed: 1, took: 0, stepped: 0 });
    // The other answers: stay and take it, or leave the ring and the footprint both
    castBesideAnchor();
    land();
    expect(useCombatStore.getState().answerTally.creeping_winter).toMatchObject({ unharmed: 0, took: 1, stepped: 0 });
    castBesideAnchor();
    const clear = arenaHexes().find((h) => !attack.hexes.some((x) => hexKey(x) === hexKey(h))
      && !ringKeys().has(hexKey(h)) && !units().some((u) => u.currentHp > 0 && hexKey(u.position) === hexKey(h)))!;
    place('h2', clear);
    land();
    expect(useCombatStore.getState().answerTally.creeping_winter).toMatchObject({ unharmed: 0, took: 0, stepped: 1 });
  });

  it('spares nothing once the Heart is unbound and no anchor stands', () => {
    start();
    for (const a of anchors()) useCombatStore.getState().damageUnit(a.id, 99999, 'h1');
    expect(anchors()).toHaveLength(0);
    expect(ring()).toEqual([]);
    castHeartMove(heart(), skillOf('creeping_winter'), fx);
    expect(prepared()[0].sheltered).toBeUndefined();
  });
});

describe('Icebound Reprisal is graded by the anchor', () => {
  /** A fresh fight, the chain cast over h1, the bound anchor at `fraction` of its health; returns what landed. */
  function snap(fraction: number) {
    const random = spyDice().mockReturnValue(0.99);
    try {
      start();
      const plan = reprisalPlan(heart(), units())!;
      useCombatStore.setState((st) => ({
        units: st.units.map((u) => (u.id === 'h1' ? { ...u, position: plan.hexes[0] } : u)),
      }));
      castHeartMove(heart(), skillOf('icebound_reprisal'), fx);
      const bound = anchors().find((a) => a.objective?.bindsPrepared)!;
      const wound = Math.round(bound.currentHp * (1 - fraction));
      if (wound > 0) useCombatStore.getState().damageUnit(bound.id, wound, 'h1');
      const grade = reprisalGrade(prepared()[0].id, units());
      const before = requireUnit(units(), 'h1').currentHp;
      land();
      const barrier = heart().activeEffects.find((e) => e.type === AuraType.Barrier)?.magnitude ?? 0;
      return { grade, damage: before - requireUnit(units(), 'h1').currentHp, barrier };
    } finally { random.mockRestore(); }
  }

  it('lands at the whole chain with a whole anchor, and at half with a half-broken one', () => {
    const whole = snap(1);
    const half = snap(0.5);
    expect(whole.grade).toBe(1);
    expect(whole.barrier).toBe(Math.round(heart().stats.maxHp * BALANCE.HEART_REPRISAL_BARRIER));
    expect(half.grade).toBeCloseTo(0.5, 1);
    expect(half.damage).toBeGreaterThan(0);
    expect(half.damage / whole.damage).toBeCloseTo(half.grade, 1);
    expect(half.barrier / whole.barrier).toBeCloseTo(half.grade, 1);
  });

  it('is cancelled by a killed anchor: nothing lands, and the backlash is paid as before', () => {
    start();
    castHeartMove(heart(), skillOf('icebound_reprisal'), fx);
    const attackId = prepared()[0].id;
    const bound = anchors().find((a) => a.objective?.bindsPrepared)!;
    const before = heart().currentHp;
    useCombatStore.getState().damageUnit(bound.id, 99999, 'h1');
    expect(reprisalGrade(attackId, units())).toBe(0);
    expect(prepared()).toHaveLength(0);
    expect(before - heart().currentHp).toBe(Math.round(heart().stats.maxHp * BALANCE.HEART_REPRISAL_BACKLASH));
    expect(heart().activeEffects.some((e) => e.type === AuraType.Barrier)).toBe(false);
  });

  it('shows the scaled number on the banner', () => {
    start();
    castHeartMove(heart(), skillOf('icebound_reprisal'), fx);
    const bound = anchors().find((a) => a.objective?.bindsPrepared)!;
    useCombatStore.getState().damageUnit(bound.id, Math.round(bound.currentHp / 2), 'h1');
    const preview = previewPrepared(prepared()[0], units(), useCombatStore.getState().hazards);
    const [line] = warningLines(prepared(), [preview], units());
    expect(line.detail).toContain('50%');
  });
});

describe('Whiteout Convergence is untouched by the shelter and the grade', () => {
  it('lays no sheltered ring, and every spire left standing still blasts the heroes in it', () => {
    start([hero('h1', at(0, 1)), hero('h2', at(2, 1))]);
    for (const a of anchors()) useCombatStore.getState().damageUnit(a.id, 9999, 'h1');
    useCombatStore.getState().removeEffect(heart().id, AuraType.Exposed);
    expect(castHeartMove(heart(), skillOf('whiteout_convergence'), fx).ok).toBe(true);
    expect(prepared()[0].sheltered).toBeUndefined();
    const hp = ['h1', 'h2'].map((id) => requireUnit(units(), id).currentHp);
    land();
    const lost = ['h1', 'h2'].map((id, i) => hp[i] - requireUnit(units(), id).currentHp);
    expect(Math.max(...lost)).toBeGreaterThan(0);
    expect(spires()).toHaveLength(0);
  });
});

describe('what the party is told, and the answers each warning has', () => {
  const plate = () => warningLines(prepared(), prepared().map((p) => previewPrepared(p, units(), useCombatStore.getState().hazards)), units())[0].detail;

  it('Creeping Winter: step out of it, or stand on the ground beside a standing anchor', () => {
    expect(answersOf(skillOf('creeping_winter').prepares!)).toEqual([
      { kind: 'step' }, { kind: 'shelter', besideObjective: ANCHOR_KIND },
    ]);
    start();
    castHeartMove(heart(), skillOf('creeping_winter'), fx);
    expect(plate()).toContain('erupts, then freezes');
    expect(plate()).toContain('the ground beside a standing anchor is sheltered');
  });

  it('Icebound Reprisal: step off the line, or destroy the anchor it strains against, which grades it until then', () => {
    expect(answersOf(skillOf('icebound_reprisal').prepares!)).toEqual([
      { kind: 'step' }, { kind: 'cancel', objective: ANCHOR_KIND, graded: true },
    ]);
    start();
    castHeartMove(heart(), skillOf('icebound_reprisal'), fx);
    const bound = anchors().find((a) => a.objective?.bindsPrepared)!;
    // Only the anchor it strains against cancels it, not whichever anchor is nearest
    expect(cancellingObjectives(prepared()[0], units()).map((u) => u.id)).toEqual([bound.id]);
    expect(plate()).toContain('Destroy the marked anchor to cancel it, or the chain snaps taut');
    expect(plate()).toContain('it stands at 100%');
  });

  it('Whiteout Convergence: step out of the blasts, or destroy the spires', () => {
    start();
    for (const a of anchors()) useCombatStore.getState().damageUnit(a.id, 9999, 'h1');
    useCombatStore.getState().removeEffect(heart().id, AuraType.Exposed);
    castHeartMove(heart(), skillOf('whiteout_convergence'), fx);
    expect(answersOf(prepared()[0].spec)).toEqual([{ kind: 'step' }, { kind: 'cancel', objective: SPIRE_KIND }]);
    expect(cancellingObjectives(prepared()[0], units()).map((u) => u.id).sort()).toEqual(spires().map((u) => u.id).sort());
    expect(plate()).toContain('Destroy the spires to cancel their blasts; clear them all to tear it open');
  });
});

// ── The Winter Seal tiers (the private project notes, *The Heart's twists*) ──

/** The fight at a Winter Seal tier: the Heart carries it as `challengeTier`, as the refight builds it. */
function startAt(tier: number, heroes: CombatUnit[] = [hero('h1'), hero('h2', at(2, 3))]) {
  const store = useCombatStore.getState();
  store.reset();
  const [boss] = createEnemyUnits(['heart_of_winter'], [at(0, -4)], 1, 1);
  store.initCombat(heroes, [{ ...boss, challengeTier: tier }]);
  store.patchBossScript(heart().id, { phaseTurns: 1 });
}

const breakAnchors = () => {
  for (const a of anchors()) useCombatStore.getState().damageUnit(a.id, 9999, 'h1');
};

describe('the tiers keep the lair’s fight at the bottom and stack upward', () => {
  it('reads its tier off challengeTier, 1 when it has none, and each twist from its tier up', () => {
    start();
    expect(heartTierOf(heart())).toBe(1);
    for (const twist of Object.keys(HEART_TWIST) as (keyof typeof HEART_TWIST)[]) {
      for (let tier = 1; tier <= BALANCE.HEART_SEAL.MAX_TIER; tier++) {
        startAt(tier);
        expect(heartTwist(heart(), twist)).toBe(tier >= HEART_TWIST[twist]);
      }
    }
    expect(Object.values(HEART_TWIST).sort()).toEqual([2, 3, 4, 5]);
  });
});

describe('tier 2: the Pulse’s fracture runs on down a line of heroes', () => {
  /** Three heroes standing one behind another, as the Heart sees them from its start. */
  const line = () => {
    const target = at(0, 0);
    const second = fractureHex(heartStart(), target)!;
    const third = fractureHex(target, second)!;
    return { target, second, third };
  };

  it('stops at the hero directly behind in the lair and at tier 1', () => {
    const { target, second, third } = line();
    startAt(1, [hero('h1', target), hero('h2', second), hero('h3', third)]);
    const hp = requireUnit(units(), 'h3').currentHp;
    strikePulse(heart(), skillOf('splintering_pulse'), target, SILENT_SINK);
    expect(requireUnit(units(), 'h2').currentHp).toBeLessThan(5000);
    expect(requireUnit(units(), 'h3').currentHp).toBe(hp);
  });

  it('runs on to every hero behind from tier 2, and stops at the first hex with nobody on it', () => {
    const { target, second, third } = line();
    const fourth = fractureHex(second, third)!;
    const fifth = fractureHex(third, fourth)!;
    startAt(2, [hero('h1', target), hero('h2', second), hero('h3', third), hero('h5', fifth)]);
    strikePulse(heart(), skillOf('splintering_pulse'), target, SILENT_SINK);
    expect(requireUnit(units(), 'h2').currentHp).toBeLessThan(5000);
    expect(requireUnit(units(), 'h3').currentHp).toBeLessThan(5000);
    // The hex between is empty: the chain ends there
    expect(requireUnit(units(), 'h5').currentHp).toBe(5000);
  });
});

describe('tier 3: Icebound Reprisal binds two anchors at once', () => {
  it('binds one anchor below tier 3', () => {
    startAt(2);
    castHeartMove(heart(), skillOf('icebound_reprisal'), fx);
    expect(anchors().filter((a) => a.objective?.bindsPrepared)).toHaveLength(1);
    expect(anchors().some((a) => a.objective?.boundHexes)).toBe(false);
  });

  it('binds the two best anchors from tier 3, one warning over both lines', () => {
    startAt(3);
    const plans = reprisalPlans(heart(), units(), 2);
    castHeartMove(heart(), skillOf('icebound_reprisal'), fx);
    const bound = anchors().filter((a) => a.objective?.bindsPrepared);
    expect(bound.map((a) => a.id).sort()).toEqual(plans.map((p) => p.anchor.id).sort());
    expect(prepared()).toHaveLength(1);
    const keys = new Set(prepared()[0].hexes.map(hexKey));
    for (const p of plans) for (const h of p.hexes) expect(keys.has(hexKey(h))).toBe(true);
  });

  it('breaking one bound anchor takes its line and its backlash; breaking the other cancels the warning', () => {
    startAt(3);
    castHeartMove(heart(), skillOf('icebound_reprisal'), fx);
    const [first, second] = anchors().filter((a) => a.objective?.bindsPrepared);
    const firstLine = first.objective!.boundHexes!.map(hexKey);
    const secondLine = new Set(second.objective!.boundHexes!.map(hexKey));
    const before = heart().currentHp;
    useCombatStore.getState().damageUnit(first.id, 9999, 'h1');
    expect(before - heart().currentHp).toBe(Math.round(heart().stats.maxHp * BALANCE.HEART_REPRISAL_BACKLASH));
    expect(prepared()).toHaveLength(1);
    const left = new Set(prepared()[0].hexes.map(hexKey));
    for (const key of firstLine) expect(left.has(key)).toBe(secondLine.has(key));
    useCombatStore.getState().damageUnit(second.id, 9999, 'h1');
    expect(prepared()).toHaveLength(0);
  });

  it('snaps each line still standing, and lends a Barrier share for each', () => {
    startAt(3);
    const [a, b] = reprisalPlans(heart(), units(), 2);
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === 'h1' ? { ...u, position: a.hexes[0] } : u.id === 'h2' ? { ...u, position: b.hexes[0] } : u)),
    }));
    castHeartMove(heart(), skillOf('icebound_reprisal'), fx);
    land();
    expect(requireUnit(units(), 'h1').currentHp).toBeLessThan(5000);
    expect(requireUnit(units(), 'h2').currentHp).toBeLessThan(5000);
    const barrier = heart().activeEffects.find((e) => e.type === AuraType.Barrier);
    expect(barrier?.magnitude).toBe(Math.round(heart().stats.maxHp * BALANCE.HEART_REPRISAL_BARRIER * 2));
    expect(anchors().some((x) => x.objective?.bindsPrepared || x.objective?.boundHexes)).toBe(false);
  });
});

describe('tier 4: a spire left standing freezes the ground it bursts over', () => {
  const convergeAndLand = (tier: number, breakOne = false) => {
    startAt(tier);
    breakAnchors();
    useCombatStore.getState().removeEffect(heart().id, AuraType.Exposed);
    castHeartMove(heart(), skillOf('whiteout_convergence'), fx);
    const all = spires();
    const broken = breakOne ? all[0] : undefined;
    if (broken) useCombatStore.getState().damageUnit(broken.id, 9999, 'h1');
    const standing = spires().map((s) => s.position);
    land();
    return { standing, broken: broken?.position };
  };

  it('leaves no ice below tier 4, as in the lair', () => {
    convergeAndLand(3);
    expect(iceOf(heart(), useCombatStore.getState().hazards)).toHaveLength(0);
  });

  it('freezes every blast of a spire that burst from tier 4, and nothing a broken spire would have covered', () => {
    const { standing, broken } = convergeAndLand(4, true);
    const ice = new Set(iceOf(heart(), useCombatStore.getState().hazards).map(hexKey));
    expect(ice.size).toBeGreaterThan(0);
    const covered = new Set(standing.flatMap((s) => getHexesInRange(s, BALANCE.HEART_CONVERGENCE_RADIUS)).map(hexKey));
    for (const key of ice) expect(covered.has(key)).toBe(true);
    for (const s of standing) expect(ice.has(hexKey(s))).toBe(true);
    if (broken && !covered.has(hexKey(broken))) expect(ice.has(hexKey(broken))).toBe(false);
  });
});

describe('tier 5: at a quarter health two anchors rise and chain it again', () => {
  /** Unbound, a turn lived in the phase, and brought to just above a quarter of its health. */
  const toTheQuarter = (tier: number) => {
    startAt(tier);
    breakAnchors();
    useCombatStore.getState().removeEffect(heart().id, AuraType.Exposed);
    useCombatStore.getState().patchBossScript(heart().id, { phaseTurns: 1 });
    const max = heart().stats.maxHp;
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === heart().id ? { ...u, currentHp: Math.round(max * 0.3) } : u)),
    }));
    useCombatStore.getState().damageUnit(heart().id, Math.round(max * 0.1), 'h1');
  };

  it('stays unbound to the end below tier 5', () => {
    toTheQuarter(4);
    expect(heart().bossPhase).toBe(1);
    expect(anchors()).toHaveLength(0);
  });

  it('raises two anchors apart on the ring, far from the heroes, and takes 66% less while they stand', () => {
    toTheQuarter(5);
    const boss = heart();
    expect(boss.bossPhase).toBe(HEART_RECHAINED_PHASE);
    expect(anchors()).toHaveLength(BALANCE.HEART_SEAL.RECHAIN_ANCHORS);
    const [a, b] = anchors();
    expect(hexDistance(a.position, b.position)).toBeGreaterThanOrEqual(2);
    for (const x of anchors()) expect(hexDistance(x.position, boss.position)).toBe(BALANCE.HEART_ANCHOR_RING);
    expect(heartIntent(boss, units()).protection).toBeCloseTo(0.66);
    // The chained kit, at the unbound power
    expect(boss.skills.map((s) => s.id)).toContain('icebound_reprisal');
    expect(boss.skills.map((s) => s.id)).not.toContain('whiteout_convergence');
    expect(boss.formStats).toEqual(HEART_PHASES[1].stats);
  });

  it('is fed by the risen anchors again, and binds both with its Reprisal', () => {
    toTheQuarter(5);
    beginHeartTurn(heart().id);
    const feed = heart().activeEffects.find((e) => e.type === AuraType.MagicBuff && e.duration === -1);
    expect(feed?.stacks).toBe(2);
    castHeartMove(heart(), skillOf('icebound_reprisal'), fx);
    expect(anchors().filter((x) => x.objective?.boundHexes)).toHaveLength(2);
  });

  it('is torn open by the last risen anchor, with the unbound kit back, and never chained a third time', () => {
    toTheQuarter(5);
    breakAnchors();
    const boss = heart();
    expect(boss.bossPhase).toBe(HEART_TORN_PHASE);
    expect(boss.activeEffects.find((e) => e.type === AuraType.Exposed)?.magnitude).toBe(BALANCE.HEART_EXPOSED);
    expect(boss.skills.map((s) => s.id)).toContain('whiteout_convergence');
    useCombatStore.getState().patchBossScript(heart().id, { phaseTurns: 1 });
    useCombatStore.getState().damageUnit(heart().id, 10, 'h1');
    expect(heart().bossPhase).toBe(HEART_TORN_PHASE);
    expect(anchors()).toHaveLength(0);
  });
});

describe('the simulator’s party against two bound anchors', () => {
  it('strikes the weaker of the two, to break one line rather than chip both', () => {
    startAt(3, [{ ...hero('h1', at(0, 3)), skills: [makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 12 })] }]);
    castHeartMove(heart(), skillOf('icebound_reprisal'), fx);
    const [a, b] = anchors().filter((x) => x.objective?.boundHexes);
    // Clear of both lines, and with the first anchor worn down, then the second
    for (const [worn, whole] of [[a, b], [b, a]]) {
      useCombatStore.setState((s) => ({
        units: s.units.map((u) => (u.id === worn.id ? { ...u, currentHp: 1 } : u.id === whole.id ? { ...u, currentHp: u.stats.maxHp } : u)),
      }));
      const actions = partyPolicy(requireUnit(units(), 'h1'), units()) ?? [];
      const strike = actions.find((x) => x.type === 'skill');
      expect(strike?.skillTarget).toEqual(worn.position);
    }
  });
});
