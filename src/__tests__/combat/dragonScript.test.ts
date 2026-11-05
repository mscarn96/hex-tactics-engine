import { SILENT_SINK } from '@/systems/combat/combatSink';
import { spyDice } from '../support/dice';
import { useCombatStore } from '@/stores/combatStore';
import { BALANCE } from '@/data/balanceConstants';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import {
  cinderRift,
  dragonClaw,
  DRAGON_FOLLOW_UPS,
  DRAGON_SKILLS,
  flameWave,
  furnaceHeart,
  skyfire,
  wingThrust,
} from '@/data/templates/emeraldDragon';
import * as skillData from '@/data/skills/skillData';
import { ALL_SKILLS } from '@/data/skills/skillData';
import {
  AfflictionType,
  CombatUnit,
  HexCoord,
  SkillTargetType,
  StatusEffectType,
  VfxSpec,
} from '@/models/types';
import { arcHexes, arenaHexes, discAround, HEX_DIRS } from '@/systems/combat/arenaGeometry';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { getMovementRange } from '@/systems/combat/movement';
import { getSkillTargets } from '@/systems/combat/targeting';
import { requireUnit } from '@/systems/combat/unitLookup';
import { applySkillStatus } from '@/systems/combat/combatEvents';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { isPreparedDue, preparedBy, previewPrepared, responsesOwed } from '@/systems/combat/preparedAttacks';
import { resolveDuePrepared } from '@/systems/combat/preparedResolve';
import { CombatSink } from '@/systems/combat/skillResolution';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import {
  chooseDragonMove,
  clawOnCarrier,
  DragonMove,
  DragonOffer,
  FIRST_TURN,
  heartCarrier,
  heartRoundsLeft,
  isDragon,
  riftActive,
  riftFollowsWing,
  riftLine,
  riftTargets,
  SIGNATURE_GAP,
  skyfireLandingCentre,
  waveFootprint,
  wholeArena,
} from '@/systems/combat/dragonScript';
import { castDragonMove } from '@/systems/combat/dragonActions';
import { scriptsBeginTurn } from '@/systems/combat/scriptRegistry';
import { HEAT_FIRST, HEAT_WHIFF, heatFloorOf, heatOf, heatStrength } from '@/systems/combat/dragonHeat';
import { bossReadout } from '@/systems/combat/bossRegistry';
import { warningLines } from '@/data/display/preparedDisplay';
import { answersOf, cancellingObjectives } from '@/systems/combat/warnedAnswers';
import { routesConnected } from '@/systems/combat/trollScript';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { at, makeStats, makeUnit } from '../support/fixtures';

/**
 * The Emerald Dragon's fight — the rules, not the numbers.
 *
 * Every assertion is something the plan promises the party: the Claw is a wide
 * arc and Breath is gone; a Wing Thrust is two ticks over the ground the shove
 * lands on; a Rift is a line that erupts after the party's turn and burns as
 * non-solid ground that costs a crossing fire; a Furnace Heart is a countdown of
 * two full hero rounds that a focused party can break; Skyfire burns every hex,
 * is cancelled by Stun, Silence, Freeze or Taunt, lands where it said it would,
 * and leaves the Dragon exposed for a full hero window when it is broken. Tuned
 * values (`DRAGON_*` in `balanceConstants`) are used by name.
 */

const store = () => useCombatStore.getState();
const unitOf = (id: string) => requireUnit(store().units, id);
const fx = { log: () => {} };

const boss = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({
    id: 'boss',
    name: 'Dragon',
    isPlayer: false,
    templateId: 'dragon',
    stats: makeStats({ maxHp: 1000, attack: 30, magic: 30, defense: 20, speed: 5, moveRange: 2, maxMana: 0 }),
    position: at(-4, 0),
    skills: DRAGON_SKILLS,
    ...over,
  });

const hero = (id: string, position: HexCoord, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({
    id,
    name: id,
    heroId: id,
    position,
    stats: makeStats({ maxHp: 600, attack: 20, defense: 5, magic: 20, speed: 8, maxMana: 40 }),
    ...over,
  });

function arena(over: { heroes?: CombatUnit[]; boss?: Partial<CombatUnit> } = {}) {
  store().reset();
  const heroes = over.heroes ?? [hero('a', at(0, 1)), hero('b', at(1, 0))];
  store().initCombat(heroes, [boss(over.boss)]);
  store().patchBossScript('boss', { phaseTurns: 8 });
}

const prepared = () => preparedBy('boss', store().preparedAttacks);
const sinkLog: string[] = [];
const specs: VfxSpec[] = [];
const sink: CombatSink = {
  log: (text) => { sinkLog.push(text); },
  float: () => {},
  vfx: (spec) => { specs.push(spec); },
  status: () => {},
};
const cast = (skill: typeof wingThrust, target: HexCoord) =>
  executeAIActions(unitOf('boss'), [{ type: 'skill', skill, skillTarget: target }], { ...SILENT_SINK, log: (t) => { sinkLog.push(t); } });

/** A hero's turn ends: the one funnel every response is counted through. */
const heroTurnEnds = (id: string, bonus = false) => {
  useCombatStore.setState({
    currentUnitId: id,
    bonusTurn: { pending: null, active: bonus },
  });
  store().nextTurn();
};
/** Every hero takes one regular turn: one full response round. */
const heroRound = () => {
  for (const u of store().units.filter((x) => x.isPlayer && !x.objective && x.currentHp > 0)) heroTurnEnds(u.id);
};
const land = () => resolveDuePrepared('boss', sink);

beforeEach(() => {
  sinkLog.length = 0;
  specs.length = 0;
  // These are script/terrain rules; independent crits and dodges obscure damage comparisons.
  spyDice().mockReturnValue(0.99);
  setTempoRandom(() => 1);
});
afterEach(() => {
  jest.restoreAllMocks();
  setTempoRandom(() => 1);
});

// ─── The kit's own shape ─────────────────────────────────────────────────────

describe('the kit', () => {
  it('makes the repeatable move a wide arc, with no single-target Claw and no Breath', () => {
    expect(dragonClaw.targetType).toBe(SkillTargetType.Arc);
    expect(dragonClaw.aoeRadius).toBeGreaterThanOrEqual(3);
    expect(dragonClaw.prepares).toBeUndefined();
    const everyId = new Set<string>(enemyTemplates.flatMap((t) => t.skills.map((s) => s.id)));
    expect(everyId.has('dragon_breath')).toBe(false);
    expect(ALL_SKILLS.map((s) => s.id as string).some((id) => id === 'dragon_breath' || id === 'dragon_claw')).toBe(false);
    expect('dragonBreath' in skillData).toBe(false);
  });

  it('has the Claw and four signatures; all but the instant Wing Thrust are warnings, on the template', () => {
    expect(DRAGON_SKILLS.map((s) => s.id)).toEqual([
      'dragon_claw', 'wing_thrust', 'cinder_rift', 'furnace_heart', 'skyfire',
    ]);
    for (const skill of [cinderRift, furnaceHeart, skyfire]) expect(skill.prepares).toBeDefined();
    expect(wingThrust.prepares).toBeUndefined();
    expect(enemyTemplates.find((t) => t.id === 'dragon')!.skills).toEqual(DRAGON_SKILLS);
    expect(DRAGON_FOLLOW_UPS.map((s) => s.id)).toEqual(['flame_wave', 'skyfire_landing']);
  });

  it('lets Skyfire be broken by Stun, Silence, Freeze or Taunt and nothing else', () => {
    expect(skyfire.prepares?.interruptedBy).toEqual(['stun', 'silence', 'freeze']);
    expect(skyfire.prepares?.tauntCancels).toBe(true);
    expect(wingThrust.prepares?.interruptedBy).toBeUndefined();
  });

  it('makes the Heart a five-round countdown the whole party answers, carried by a hero', () => {
    expect(furnaceHeart.prepares?.windows).toBe(BALANCE.DRAGON_HEART_WINDOWS);
    expect(BALANCE.DRAGON_HEART_WINDOWS).toBe(5);
    expect(furnaceHeart.prepares?.everyone).toBe(true);
    expect(furnaceHeart.prepares?.carried).toBe(true);
    // The script throws it onto a hero: nothing is planted on the ground
    expect(furnaceHeart.places).toBeUndefined();
    expect(furnaceHeart.damage).toBe(BALANCE.DRAGON_HEART_BURST);
    expect(furnaceHeart.aoeRadius).toBe(1);
  });

  it('is only the Emerald Dragon who is scripted', () => {
    expect(isDragon(boss())).toBe(true);
    expect(isDragon(boss({ templateId: 'troll_chieftain' as never }))).toBe(false);
    expect(isDragon(boss({ isPlayer: true }))).toBe(false);
  });
});

// ─── Choosing the move ───────────────────────────────────────────────────────

const OFFER: DragonOffer = { available: true, value: 2.2 };
const NONE: DragonOffer = { available: false, value: 0 };
const offers = (over: Partial<Record<DragonMove, DragonOffer>> = {}): Record<DragonMove, DragonOffer> => ({
  claw: { available: true, value: 1 },
  wing: OFFER,
  rift: OFFER,
  heart: OFFER,
  skyfire: OFFER,
  ...over,
});
const ctx = (over: Partial<Parameters<typeof chooseDragonMove>[0]> = {}) => ({
  boss: boss(),
  units: [] as CombatUnit[],
  hazards: [],
  majorPending: false,
  turns: 10,
  lastUsed: {},
  lastSignature: 0,
  offers: offers(),
  ...over,
});

describe('choosing a move', () => {
  const WARNINGS: DragonMove[] = ['rift', 'heart', 'skyfire'];

  it('never raises a second warning while one stands; only the instant wing or the claw is made', () => {
    expect(['claw', 'wing']).toContain(chooseDragonMove(ctx({ majorPending: true })));
    expect(chooseDragonMove(ctx({ majorPending: true, offers: offers({ wing: NONE }) }))).toBe('claw');
  });

  it('makes no warning in the turns after a signature, so two never come back to back', () => {
    for (let turns = 11; turns < 10 + SIGNATURE_GAP; turns++) {
      expect(WARNINGS).not.toContain(chooseDragonMove(ctx({ turns, lastSignature: 10 })));
    }
    expect(WARNINGS).toContain(
      chooseDragonMove(ctx({ turns: 10 + SIGNATURE_GAP, lastSignature: 10, offers: offers({ wing: NONE }) })),
    );
  });

  it('opens with the Claw, and keeps Skyfire for later so the party has seen the rest first', () => {
    expect(chooseDragonMove(ctx({ turns: 1 }))).toBe('claw');
    const onlySkyfire = offers({ wing: NONE, rift: NONE, heart: NONE });
    expect(chooseDragonMove(ctx({ turns: FIRST_TURN.skyfire - 1, offers: onlySkyfire }))).toBe('claw');
    expect(chooseDragonMove(ctx({ turns: FIRST_TURN.skyfire, offers: onlySkyfire }))).toBe('skyfire');
  });

  it('never makes a move the board gives nothing to do', () => {
    expect(chooseDragonMove(ctx({ offers: offers({ wing: NONE, rift: NONE, heart: NONE, skyfire: NONE }) }))).toBe('claw');
    expect(chooseDragonMove(ctx({ offers: offers({ wing: NONE, rift: NONE, heart: NONE }) }))).toBe('skyfire');
  });

  it('shows all four signatures over a long fight, none starved and no cycle', () => {
    const lastUsed: Record<string, number> = {};
    const rest: Record<string, number> = { wing: 3, rift: 4, heart: 5, skyfire: 6 };
    let lastSignature = 0;
    const picks: DragonMove[] = [];
    for (let turns = 1; turns <= 60; turns++) {
      // His cooldowns, as the real turn counts them
      const ready = (m: DragonMove) => lastUsed[m] === undefined || turns - lastUsed[m] > rest[m];
      const move = chooseDragonMove(ctx({
        turns, lastUsed, lastSignature,
        offers: offers({
          wing: ready('wing') ? { available: true, value: 1.2 } : NONE,
          rift: ready('rift') ? OFFER : NONE,
          heart: ready('heart') ? OFFER : NONE,
          skyfire: ready('skyfire') ? OFFER : NONE,
        }),
      }));
      // A wing made while the Rift was ready and no warning was near brings the Rift with it
      const withRift = move === 'wing' && ready('rift') && turns >= FIRST_TURN.rift
        && (lastSignature === 0 || turns - lastSignature >= SIGNATURE_GAP);
      picks.push(withRift ? 'rift' : move);
      lastUsed[move] = turns;
      if (withRift) lastUsed.rift = turns;
      if (WARNINGS.includes(move) || withRift) lastSignature = turns;
    }
    for (const move of ['wing', 'rift', 'heart', 'skyfire'] as const) expect(picks).toContain(move);
    // The claw is a real share of his turns
    expect(picks.filter((m) => m === 'claw').length).toBeGreaterThanOrEqual(15);
  });

  it('asks the board through the real brain: a scripted turn is one of his five moves', () => {
    arena();
    const actions = decideEnemyAction(unitOf('boss'), store().units);
    const skill = actions.find((a) => a.skill)?.skill;
    if (skill) expect(DRAGON_SKILLS.map((s) => s.id)).toContain(skill.id);
  });
});

// ─── Dragon Claw: it hunts the Heart's carrier ───────────────────────────────

describe('the Claw hunts the Heart\'s carrier', () => {
  const dragon = boss({ position: at(0, 0) });
  const wedgeOf = (aim: HexCoord) => new Set(arcHexes(dragonClaw, dragon.position, aim).map(hexKey));

  it('turns a wedge that catches the carrier, the first in facing order when several catch as many', () => {
    const carrier = hero('carrier', at(1, 0));
    const aim = clawOnCarrier(dragon, dragonClaw, carrier, [dragon, carrier])!;
    expect(wedgeOf(aim).has(hexKey(carrier.position))).toBe(true);
    const first = HEX_DIRS.find((d) => wedgeOf({ q: d.q, r: d.r }).has(hexKey(carrier.position)))!;
    expect(aim).toEqual({ q: first.q, r: first.r });
  });

  it('prefers the wedge that catches the carrier and more heroes besides', () => {
    const carrier = hero('carrier', at(1, 0));
    const friends = [hero('f1', at(1, 1)), hero('f2', at(0, 2))];
    const aim = clawOnCarrier(dragon, dragonClaw, carrier, [dragon, carrier, ...friends])!;
    const wedge = wedgeOf(aim);
    expect(wedge.has(hexKey(carrier.position))).toBe(true);
    const caught = friends.filter((f) => wedge.has(hexKey(f.position))).length;
    for (const d of HEX_DIRS) {
      const other = wedgeOf({ q: d.q, r: d.r });
      if (!other.has(hexKey(carrier.position))) continue;
      expect(friends.filter((f) => other.has(hexKey(f.position))).length).toBeLessThanOrEqual(caught);
    }
  });

  it('reaches as deep as the Claw\'s wedge and no further', () => {
    expect(clawOnCarrier(dragon, dragonClaw, hero('c', at(3, 0)), [dragon])).not.toBeNull();
    expect(clawOnCarrier(dragon, dragonClaw, hero('c', at(4, 0)), [dragon])).toBeNull();
  });
});

// ─── Wing Thrust ─────────────────────────────────────────────────────────────

describe('Wing Thrust', () => {
  const wingArena = () => {
    arena({ heroes: [hero('a', at(-2, 0)), hero('b', at(-2, 1))] });
    store().setFacing('boss', at(-2, 0));
  };
  const strike = () =>
    executeAIActions(unitOf('boss'), [{ type: 'skill', skill: wingThrust, skillTarget: at(-2, 0) }],
      { ...SILENT_SINK, log: (t) => { sinkLog.push(t); }, vfx: (spec) => { specs.push(spec); } });

  it('is instant: no warning, no window, and the heroes are hit and thrown at once', () => {
    wingArena();
    // With the Rift resting, the wing comes alone
    store().startCooldown('boss', cinderRift);
    strike();
    expect(prepared()).toHaveLength(0);
    expect(wingThrust.prepares).toBeUndefined();
    expect(unitOf('a').currentHp).toBeLessThan(600);
    expect(unitOf('boss').cooldowns?.wing_thrust).toBeGreaterThan(0);
  });

  it('is two ticks: the wing, then a flame wave over the arc and where the shove put them', () => {
    wingArena();
    const before = store().units.filter((u) => u.isPlayer).map((u) => hexKey(u.position));
    strike();
    const after = store().units.filter((u) => u.isPlayer).map((u) => hexKey(u.position));
    expect(after).not.toEqual(before);
    const ticks = specs.filter((s) => s.hitUnitIds.length > 0);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[ticks.length - 1].delayMs ?? 0).toBeGreaterThan(0);
    // The wave covers the arc and the landing hexes
    const arcHexes = [at(-2, 0), at(-2, 1)];
    const wave = waveFootprint(arcHexes, [at(0, 0)]);
    expect(wave.map(hexKey)).toEqual(expect.arrayContaining([...arcHexes, at(0, 0)].map(hexKey)));
  });

  it('has forty percent of the power the warned attack had', () => {
    expect(BALANCE.DRAGON_WING_DAMAGE).toBeCloseTo(1.1 * 0.4, 5);
    expect(BALANCE.DRAGON_WAVE_DAMAGE).toBeCloseTo(1.0 * 0.4, 5);
  });

  it('can be made while one of his warnings is open', () => {
    wingArena();
    castDragonMove(unitOf('boss'), skyfire, fx);
    expect(prepared()).toHaveLength(1);
    strike();
    expect(prepared()).toHaveLength(1);
    expect(unitOf('a').currentHp).toBeLessThan(600);
  });

  it('keeps the wave a magic blow and the wing a physical one', () => {
    expect(flameWave.scaling).toBe('magic');
    expect(wingThrust.scaling ?? 'attack').toBe('attack');
  });
});

// ─── Cinder Rift ─────────────────────────────────────────────────────────────

describe('Cinder Rift', () => {
  it('is stepped out of, and the plate names what a landing on nobody does', () => {
    expect(answersOf(cinderRift.prepares!)).toEqual([{ kind: 'step' }]);
    arena({ heroes: [hero('a', at(0, -1)), hero('b', at(0, 1)), hero('c', at(1, 0))] });
    castDragonMove(unitOf('boss'), cinderRift, fx);
    const [attack] = prepared();
    const [line] = warningLines([attack], [previewPrepared(attack, store().units, store().hazards)], store().units);
    expect(line.detail).toContain('erupts, then burns for three of his turns');
    expect(line.detail).toContain('if nobody is struck: his fire climbs a step');
  });

  it('rakes two lines in an X through the party, and leaves out his own hex', () => {
    arena({ heroes: [hero('a', at(0, -1)), hero('b', at(0, 1)), hero('c', at(1, 0))] });
    const plan = riftLine(unitOf('boss'), store().units)!;
    expect(plan).not.toBeNull();
    expect(plan.split[0]).toBeGreaterThan(0);
    expect(plan.split[1]).toBeGreaterThan(0);
    expect(plan.hexes.some((h) => hexKey(h) === hexKey(unitOf('boss').position))).toBe(false);
    // Two lines, not one: longer than any single row of the arena, and crossing at one hex
    expect(plan.hexes.length).toBeGreaterThan(11);
    const pivot = plan.hexes.filter((h) => plan.hexes.filter((o) => hexDistance(o, h) === 1).length >= 4);
    expect(pivot.length).toBeGreaterThan(0);
  });

  it('marks the line now, strikes nothing, and erupts only after the party has had its turn', () => {
    arena({ heroes: [hero('a', at(0, 0)), hero('b', at(1, 1))] });
    castDragonMove(unitOf('boss'), cinderRift, fx);
    expect(prepared()).toHaveLength(1);
    expect(unitOf('a').currentHp).toBe(600);
    expect(resolveDuePrepared('boss', sink)).toEqual([]);
    expect(store().hazards).toHaveLength(0);
    heroRound();
    land();
    expect(store().hazards).toHaveLength(1);
  });

  it('leaves traversable burning ground: not solid, never a wall, burning for three of his turns', () => {
    arena({ heroes: [hero('a', at(0, 0)), hero('b', at(1, 1))] });
    castDragonMove(unitOf('boss'), cinderRift, fx);
    heroRound();
    land();
    const [rift] = store().hazards;
    expect(rift.solid).toBe(false);
    expect(rift.label).toBe('bossLog.hazard.cinderRift');
    // It counts its own turns of his (the one it erupted on has begun already), and a new Rift would replace it
    expect(rift.turnsLeft).toBe(BALANCE.DRAGON_RIFT_TURNS + 1);
    expect(rift.lasts).toBe('replaced');
    expect(riftActive(unitOf('boss'), store().hazards)).toBe(true);
    // Every open hex can still be reached from every other: nothing is blocked
    expect(routesConnected(new Set())).toBe(true);
    const reach = getMovementRange(unitOf('a'), store().units, store().hazards);
    expect(reach.length).toBeGreaterThan(0);
  });

  it('costs fire to cross, once per move, and nothing to stay clear of or walk along', () => {
    arena({ heroes: [hero('a', at(0, -2)), hero('b', at(1, 1))] });
    const line = [at(0, 0), at(1, 0), at(-1, 0), at(2, 0), at(-2, 0), at(3, 0)];
    store().addHazard({
      id: 'r', hexes: line, solid: false, label: 'Cinder Rift', turnsLeft: 2, ownerId: 'boss', crossDamage: 40,
    });
    // A step that stays on one side costs nothing
    store().moveUnit('a', at(0, -1));
    expect(unitOf('a').currentHp).toBe(600);
    // A step across the line pays once, however many of its hexes the path touches
    store().moveUnit('a', at(0, 2));
    expect(unitOf('a').currentHp).toBe(560);
    // Its own side is never burned by it
    store().moveUnit('boss', at(0, 1));
    expect(unitOf('boss').currentHp).toBe(1000);
  });

  it('burns a hero the Wing Thrust throws across it, once', () => {
    arena({ heroes: [hero('a', at(-2, 0)), hero('b', at(3, 3))] });
    store().setFacing('boss', at(-2, 0));
    // Ground behind the arc: the shove must cross it
    store().addHazard({
      id: 'r', hexes: arenaHexes().filter((h) => h.q === -1).map((h) => ({ q: h.q, r: h.r })), solid: false,
      label: 'Cinder Rift', turnsLeft: 2, ownerId: 'boss', crossDamage: 50,
    });
    const without = (() => {
      store().removeHazard('r');
      executeAIActions(unitOf('boss'), [{ type: 'skill', skill: wingThrust, skillTarget: at(-2, 0) }]);
      return 600 - unitOf('a').currentHp;
    })();
    arena({ heroes: [hero('a', at(-2, 0)), hero('b', at(3, 3))] });
    store().setFacing('boss', at(-2, 0));
    store().addHazard({
      id: 'r', hexes: arenaHexes().filter((h) => h.q === -1).map((h) => ({ q: h.q, r: h.r })), solid: false,
      label: 'Cinder Rift', turnsLeft: 2, ownerId: 'boss', crossDamage: 50,
    });
    executeAIActions(unitOf('boss'), [{ type: 'skill', skill: wingThrust, skillTarget: at(-2, 0) }]);
    expect(600 - unitOf('a').currentHp).toBe(without + 50);
  });

  it('is never cast on top of a burning one, or while a warning stands', () => {
    arena();
    castDragonMove(unitOf('boss'), cinderRift, fx);
    expect(castDragonMove(unitOf('boss'), cinderRift, fx).ok).toBe(false);
    expect(prepared()).toHaveLength(1);
  });
});

// ─── Furnace Heart ───────────────────────────────────────────────────────────

describe('the carried Furnace Heart', () => {
  const heartArena = (heroes = [hero('a', at(0, 0)), hero('b', at(1, 0))]) => arena({ heroes });
  const toss = () => cast(furnaceHeart, at(0, 0));
  const crystal = () => store().units.find((u) => u.objective?.kind === 'furnace_heart' && u.currentHp > 0)!;

  it('is thrown onto the hero with the most health, ties by the lower id', () => {
    const units = [hero('b', at(0, 0)), hero('a', at(1, 0)), hero('c', at(2, 0), { currentHp: 300 })];
    expect(heartCarrier(units)?.id).toBe('a');
    expect(heartCarrier([hero('a', at(0, 0), { currentHp: 200 }), hero('b', at(1, 0))])?.id).toBe('b');
    expect(heartCarrier([])).toBeNull();
  });

  it('rides on its carrier: on their hex, after them in the roster, and the hex answers with the hero', () => {
    heartArena([hero('a', at(0, 0), { currentHp: 500 }), hero('b', at(1, 0))]);
    toss();
    const heart = crystal();
    expect(heart.objective?.carrierId).toBe('b');
    expect(hexKey(heart.position)).toBe(hexKey(at(1, 0)));
    const ids = store().units.map((u) => u.id);
    expect(ids.indexOf(heart.id)).toBeGreaterThan(ids.indexOf('b'));
    expect(store().getUnitAt(at(1, 0))?.id).toBe('b');
    const [attack] = prepared();
    expect(attack.scripted).toBe('heart');
    expect(attack.bound).toEqual(['b']);
    expect(attack.hexes.map(hexKey).sort()).toEqual(discAround(at(1, 0), 1).map(hexKey).sort());
  });

  it('goes wherever its carrier goes, and its burst is drawn round them', () => {
    heartArena();
    toss();
    const carrier = crystal().objective!.carrierId!;
    store().moveUnit(carrier, at(2, -2), 'walk');
    expect(hexKey(crystal().position)).toBe(hexKey(at(2, -2)));
    expect(prepared()[0].hexes.map(hexKey).sort()).toEqual(discAround(at(2, -2), 1).map(hexKey).sort());
  });

  it('is answered by passing it or breaking it, and runs alongside his other warnings', () => {
    expect(answersOf(furnaceHeart.prepares!)).toEqual([{ kind: 'pass' }, { kind: 'cancel', objective: 'furnace_heart' }]);
    heartArena();
    toss();
    const [attack] = prepared();
    expect(cancellingObjectives(attack, store().units).map((u) => u.id)).toEqual([crystal().id]);
    // A Rift or a Skyfire may still be raised while the Heart is carried
    expect(castDragonMove(unitOf('boss'), skyfire, fx).ok).toBe(true);
    expect(prepared()).toHaveLength(2);
    // But never a second Heart
    expect(castDragonMove(unitOf('boss'), furnaceHeart, fx).ok).toBe(false);
    expect(store().units.filter((u) => u.objective?.kind === 'furnace_heart')).toHaveLength(1);
  });

  it('counts five full rounds of hero turns, and a speed-granted turn is not a round', () => {
    heartArena();
    toss();
    for (let round = 1; round < BALANCE.DRAGON_HEART_WINDOWS; round++) {
      heroRound();
      heroTurnEnds('a', true);
      expect(isPreparedDue(prepared()[0], store().units)).toBe(false);
      expect(heartRoundsLeft(prepared()[0], store().units)).toBe(BALANCE.DRAGON_HEART_WINDOWS - round);
    }
    heroRound();
    expect(isPreparedDue(prepared()[0], store().units)).toBe(true);
    expect(heartRoundsLeft(prepared()[0], store().units)).toBe(0);
  });

  it('is owed by every hero, even one standing clear of the burst at the cast', () => {
    arena({ heroes: [hero('a', at(0, 0)), hero('far', at(5, -3))] });
    toss();
    expect(prepared()[0].responders.sort()).toEqual(['a', 'far']);
  });

  it('names who holds it and the rounds left on the banner and the boss panel, and says the rule', () => {
    heartArena();
    toss();
    const [attack] = prepared();
    const [line] = warningLines([attack], [previewPrepared(attack, store().units, store().hazards)], store().units);
    expect(line.detail).toContain('On a');
    expect(line.detail).toContain('5 rounds left');
    expect(line.detail).toContain('pass it, break it, or let whoever holds it take the blast; if its carrier falls, it bursts at once');
    expect(bossReadout({ units: store().units, prepared: store().preparedAttacks, hazards: store().hazards }).gauge)
      .toContainEqual({ kind: 'heart', carrierId: 'a', rounds: 5 });
  });
});

// ─── Skyfire ─────────────────────────────────────────────────────────────────

describe('Skyfire', () => {
  const fire = () => {
    arena({ heroes: [hero('a', at(0, 0)), hero('b', at(3, -2)), hero('c', at(-1, 3))] });
    castDragonMove(unitOf('boss'), skyfire, fx);
  };
  const interrupt = (type: StatusEffectType, magnitude = 1) =>
    applySkillStatus(
      unitOf('a'), 'boss', { type, magnitude, duration: 2, sourceUnitId: 'a' }, { log: () => {}, float: () => {} },
    );

  it('marks the whole arena and a landing area, and names both and the answer', () => {
    fire();
    const [attack] = prepared();
    expect(attack.hexes).toHaveLength(arenaHexes().length);
    expect(attack.landing?.length).toBeGreaterThan(0);
    expect(attack.hexes).toEqual(wholeArena());
    const [line] = warningLines([attack], [previewPrepared(attack, store().units, store().hazards)], store().units);
    expect(line.title).toContain('Skyfire');
    expect(line.detail).toMatch(/Stun, Silence, Freeze or Taunt him to stop it/);
  });

  it('is answered by the interrupt, the trench and the sprawl, and not by a step: it covers the arena', () => {
    expect(answersOf(skyfire.prepares!)).toEqual([
      { kind: 'break' }, { kind: 'shelter', onHazard: 'bossLog.hazard.cinderRift' }, { kind: 'sprawl' },
    ]);
  });

  it('picks a landing area on the far half of the arena from him, biased toward the middle', () => {
    arena({ heroes: [hero('a', at(0, 0)), hero('b', at(1, 0))], boss: { position: at(-5, 0) } });
    const centre = skyfireLandingCentre(unitOf('boss'), store().units, store().hazards)!;
    // Past the middle, from where he stands
    expect(hexDistance(centre, unitOf('boss').position)).toBeGreaterThanOrEqual(
      hexDistance(at(0, 0), unitOf('boss').position),
    );
    // Not the far rim when the middle will do
    expect(hexDistance(centre, at(0, 0))).toBeLessThanOrEqual(3);
  });

  it('is owed by the whole party for one full response window', () => {
    fire();
    const [attack] = prepared();
    expect(attack.responders.sort()).toEqual(['a', 'b', 'c']);
    expect(attack.windows).toBeUndefined();
    heroTurnEnds('a');
    heroTurnEnds('b');
    expect(isPreparedDue(prepared()[0], store().units)).toBe(false);
    // His own bonus turn changes nothing about it
    store().patchBossScript('boss', { phaseTurns: 9 });
    expect(isPreparedDue(prepared()[0], store().units)).toBe(false);
    heroTurnEnds('c');
    expect(isPreparedDue(prepared()[0], store().units)).toBe(true);
  });

  it.each([
    [AfflictionType.Stun, 'a Stun'],
    [AfflictionType.Silence, 'a Silence'],
    [AfflictionType.Freeze, 'a Freeze'],
    [AfflictionType.Taunt, 'a Taunt'],
  ])('is cancelled by %s, with neither the flame nor the landing', (type) => {
    fire();
    const before = store().units.map((u) => [u.id, u.currentHp, hexKey(u.position)]);
    interrupt(type);
    expect(prepared()).toHaveLength(0);
    heroRound();
    expect(land()).toEqual([]);
    expect(store().units.map((u) => [u.id, u.currentHp, hexKey(u.position)])).toEqual(before);
  });

  it('is not cancelled by Root, Burn or anything unlisted', () => {
    fire();
    interrupt(AfflictionType.Root);
    interrupt(AfflictionType.Burn);
    interrupt(AfflictionType.AttackDown);
    expect(prepared()).toHaveLength(1);
  });

  it('leaves him exposed for a full hero window when broken, even if the interrupter acts last', () => {
    fire();
    const before = getCombatEffectiveStats(unitOf('boss')).defense;
    interrupt(AfflictionType.Stun);
    const exposed = getCombatEffectiveStats(unitOf('boss')).defense;
    expect(exposed).toBeLessThan(before);
    expect(exposed).toBeCloseTo(before * (1 - BALANCE.DRAGON_EXPOSED_DEFENSE), 0);
    // The window: still down through his next turn start and the whole round of heroes after it
    store().tickEffectsOnUnit('boss');
    expect(getCombatEffectiveStats(unitOf('boss')).defense).toBe(exposed);
    // ...and gone at the one after, which is a full round later
    store().tickEffectsOnUnit('boss');
    expect(getCombatEffectiveStats(unitOf('boss')).defense).toBe(before);
    // No crash and no stun beyond the interrupt's own effect: a boss ignores a Stun entirely
    expect(unitOf('boss').activeEffects.some((e) => e.type === AfflictionType.Stun)).toBe(false);
  });

  it('burns every hex of the arena, no safe tile, then lands where it warned', () => {
    fire();
    const [attack] = prepared();
    const landing = attack.landing!.map(hexKey);
    // The party scatters to the corners: nowhere is outside the flame
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === 'b' ? { ...u, position: at(-3, 3) } : u)),
    }));
    heroRound();
    land();
    for (const id of ['a', 'b', 'c']) expect(unitOf(id).currentHp).toBeLessThan(600);
    // He came down inside the marked area, not on anybody
    expect(landing).toContain(hexKey(unitOf('boss').position));
    const others = store().units.filter((u) => u.id !== 'boss').map((u) => hexKey(u.position));
    expect(others).not.toContain(hexKey(unitOf('boss').position));
  });

  it('locks the landing at the cast: heroes who move do not move it', () => {
    fire();
    const [attack] = prepared();
    const marked = attack.landing!.map(hexKey).sort();
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === 'a' ? { ...u, position: at(3, 1) } : u)),
    }));
    expect(prepared()[0].landing!.map(hexKey).sort()).toEqual(marked);
  });

  it('strikes the landing area a second time, harder on those left standing in it', () => {
    arena({ heroes: [hero('a', at(2, 0)), hero('b', at(-3, 3))], boss: { position: at(-4, 0) } });
    castDragonMove(unitOf('boss'), skyfire, fx);
    const [attack] = prepared();
    const inLanding = attack.landing!.some((h) => hexKey(h) === hexKey(at(2, 0)));
    heroRound();
    land();
    if (inLanding) {
      const lost = 600 - unitOf('a').currentHp;
      const flameOnly = 600 - unitOf('b').currentHp;
      expect(lost).toBeGreaterThan(flameOnly);
    }
    expect(specs.filter((s) => s.hitUnitIds.length > 0).length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Rising Fire ─────────────────────────────────────────────────────────────

describe('Rising Fire, read off the heat gauge', () => {
  const atTurn = (turn: number) => {
    arena({ boss: { passives: ['risingFire'] } });
    store().patchBossScript('boss', { heat: turn });
    return getCombatEffectiveStats(unitOf('boss'));
  };

  it('is on the template, so every Dragon has it', () => {
    expect(enemyTemplates.find((t) => t.id === 'dragon')!.passives).toContain('risingFire');
  });

  it('opens weak, is at full strength on his sixth turn and climbs after it', () => {
    const base = 30;
    expect(atTurn(1).attack).toBeLessThan(base);
    expect(atTurn(1).magic).toBeLessThan(base);
    expect(atTurn(BALANCE.DRAGON_RISE_FULL_TURN).attack).toBe(base);
    expect(atTurn(BALANCE.DRAGON_RISE_FULL_TURN).magic).toBe(base);
    expect(atTurn(7).attack).toBeGreaterThan(base);
    expect(atTurn(12).attack).toBeGreaterThan(atTurn(7).attack);
  });

  it('gains the same each turn: a twentieth of his attack and magic', () => {
    expect(BALANCE.DRAGON_RISE_START).toBeCloseTo(1 - (BALANCE.DRAGON_RISE_FULL_TURN - 1) * BALANCE.DRAGON_RISE_STEP, 5);
    const gain = atTurn(8).attack - atTurn(7).attack;
    expect(gain).toBeGreaterThanOrEqual(1);
    expect(gain).toBeLessThanOrEqual(2);
  });

  it('touches neither his defence nor his health', () => {
    const early = atTurn(1);
    const late = atTurn(15);
    expect(early.defense).toBe(late.defense);
    expect(early.maxHp).toBe(late.maxHp);
  });
});

// ─── The heat gauge ──────────────────────────────────────────────────────────

describe('the heat gauge', () => {
  const heat = () => heatOf(unitOf('boss'));
  const attackNow = () => getCombatEffectiveStats(unitOf('boss')).attack;
  const withFire = () => arena({ boss: { passives: ['risingFire'] } });

  it('reads the first step on his first turn and climbs one step on each regular turn after it', () => {
    withFire();
    expect(unitOf('boss').bossScript?.heat).toBeUndefined();
    expect(heat()).toBe(1);
    scriptsBeginTurn(unitOf('boss'), SILENT_SINK);
    expect(heat()).toBe(1);
    scriptsBeginTurn(unitOf('boss'), SILENT_SINK);
    expect(heat()).toBe(2);
    scriptsBeginTurn(unitOf('boss'), SILENT_SINK);
    expect(heat()).toBe(3);
  });

  const stunned = () => applySkillStatus(
    unitOf('a'), 'boss', { type: AfflictionType.Stun, magnitude: 1, duration: 2, sourceUnitId: 'a' }, { log: () => {}, float: () => {} },
  );

  it('is knocked down a few steps when Skyfire is broken, and climbs again from there', () => {
    withFire();
    store().patchBossScript('boss', { heat: 9 });
    castDragonMove(unitOf('boss'), skyfire, fx);
    stunned();
    expect(heat()).toBe(9 - BALANCE.DRAGON_QUENCH_STEPS);
    scriptsBeginTurn(unitOf('boss'), SILENT_SINK);
    expect(heat()).toBe(10 - BALANCE.DRAGON_QUENCH_STEPS);
  });

  it('never falls below the first step, nor below a floor that rises with his turns', () => {
    withFire();
    store().patchBossScript('boss', { heat: 2, phaseTurns: 0 });
    castDragonMove(unitOf('boss'), skyfire, fx);
    stunned();
    expect(heat()).toBe(1);

    // Late in a long fight a quench still cools him, but only to his floor
    withFire();
    const turns = 20;
    const floor = 1 + Math.floor(turns * BALANCE.DRAGON_QUENCH_FLOOR);
    store().patchBossScript('boss', { heat: floor + 1, phaseTurns: turns });
    expect(heatFloorOf(unitOf('boss'))).toBe(floor);
    castDragonMove(unitOf('boss'), skyfire, fx);
    stunned();
    expect(heat()).toBe(floor);
    expect(heatStrength(floor)).toBeGreaterThan(1);
  });

  it('is what his attack and magic follow: weaker after a quench, stronger after a stoked step', () => {
    withFire();
    store().patchBossScript('boss', { heat: 8 });
    const hot = attackNow();
    expect(getCombatEffectiveStats(unitOf('boss')).magic).toBeGreaterThan(30);
    store().patchBossScript('boss', { heat: HEAT_FIRST });
    const cold = attackNow();
    expect(cold).toBeLessThan(hot);
    expect(cold).toBeLessThan(30);
    store().patchBossScript('boss', { heat: 9 });
    expect(attackNow()).toBeGreaterThan(hot);
  });

  it('shows the strength now and on his next turn on the panel, before he takes it', () => {
    withFire();
    store().patchBossScript('boss', { heat: 4 });
    const heat = () => bossReadout({ units: store().units, prepared: store().preparedAttacks, hazards: [] })
      .gauge.find((f) => f.kind === 'heat');
    expect(heat()).toEqual({ kind: 'heat', now: heatStrength(4), next: heatStrength(5) });
    expect(heatStrength(4)).toBeCloseTo(0.9, 5);
    expect(heatStrength(5)).toBeCloseTo(0.95, 5);
    store().patchBossScript('boss', { heat: HEAT_FIRST });
    expect(heat()).toMatchObject({ kind: 'heat', now: heatStrength(HEAT_FIRST) });
    expect(heatStrength(HEAT_FIRST)).toBeCloseTo(0.75, 5);
    expect(heatStrength(1)).toBeCloseTo(BALANCE.DRAGON_RISE_START, 5);
  });
});

// ─── The Rift's lifetime and the thinner side ────────────────────────────────

describe('the Cinder Rift follows the Wing Thrust and burns for three of his turns', () => {
  const lay = () => {
    arena({ heroes: [hero('a', at(0, 0)), hero('b', at(1, 1))] });
    castDragonMove(unitOf('boss'), cinderRift, fx);
    heroRound();
    land();
  };
  const riftsBurning = () => store().hazards.filter((h) => h.crossDamage !== undefined);
  /** One regular turn of his begins: his own start, and his ground counted down. */
  const hisTurn = () => {
    scriptsBeginTurn(unitOf('boss'), SILENT_SINK);
    store().tickHazards('boss');
  };
  const wing = (target: HexCoord) =>
    executeAIActions(unitOf('boss'), [{ type: 'skill', skill: wingThrust, skillTarget: target }], SILENT_SINK);

  it('is never chosen on its own: the wing is valued with it, and only when one would follow', () => {
    const rift = { available: true, value: 2.6 };
    expect(riftFollowsWing({ majorPending: false, turns: 10, lastSignature: 0, rift })).toBe(true);
    expect(riftFollowsWing({ majorPending: true, turns: 10, lastSignature: 0, rift })).toBe(false);
    expect(riftFollowsWing({ majorPending: false, turns: 10, lastSignature: 9, rift })).toBe(false);
    expect(riftFollowsWing({ majorPending: false, turns: FIRST_TURN.rift - 1, lastSignature: 0, rift })).toBe(false);
    expect(riftFollowsWing({ majorPending: false, turns: 10, lastSignature: 0, rift: NONE })).toBe(false);
    for (let turns = 1; turns < 30; turns++) {
      expect(chooseDragonMove(ctx({ turns, offers: offers({ wing: NONE, heart: NONE, skyfire: NONE }) }))).toBe('claw');
    }
    // A weak wing is chosen for the Rift it brings
    const weakWing = offers({ wing: { available: true, value: 0.5 }, heart: NONE, skyfire: NONE });
    expect(chooseDragonMove(ctx({ offers: weakWing, lastUsed: { wing: 10 } }))).toBe('wing');
    expect(chooseDragonMove(ctx({ offers: { ...weakWing, rift: NONE }, lastUsed: { wing: 10 } }))).toBe('claw');
  });

  it('is raised with the Wing Thrust, after the shove, over the party as the wing left it', () => {
    arena({ heroes: [hero('a', at(-2, 0)), hero('b', at(-2, 1)), hero('c', at(2, -1))] });
    store().setFacing('boss', at(-2, 0));
    const before = riftLine(unitOf('boss'), store().units)!.hexes.map(hexKey).sort();
    wing(at(-2, 0));
    const [attack] = prepared();
    expect(attack.skill.id).toBe('cinder_rift');
    const after = riftLine(unitOf('boss'), store().units)!.hexes.map(hexKey).sort();
    expect(attack.hexes.map(hexKey).sort()).toEqual(after);
    expect(after).not.toEqual(before);
    // Remembered as his last signature
    expect(unitOf('boss').bossScript?.lastUsed?.cinder_rift ?? unitOf('boss').bossScript?.lastUsed?.rift).toBe(8);
    expect(unitOf('boss').bossScript?.step).toBe(8);
  });

  it('burns through his next three turns, whatever he casts, and is gone after the third; Skyfire leaves it', () => {
    // Erupted on his turn; his next begins
    lay();
    hisTurn();
    castDragonMove(unitOf('boss'), skyfire, fx);
    heroRound();
    // His second: Skyfire lands, and the trench is there to shelter in
    hisTurn();
    land();
    expect(riftsBurning()).toHaveLength(1);
    // His third: still burning
    hisTurn();
    expect(riftsBurning()).toHaveLength(1);
    // Gone as the turn after his third begins
    hisTurn();
    expect(riftsBurning()).toHaveLength(0);
  });

  it('holds the wing back while a ready Rift waits out a warning, so the Rift is not starved', () => {
    const waiting = offers({ wing: { available: true, value: 3 }, heart: NONE, skyfire: NONE });
    // Just after a signature: the Rift cannot follow yet, and the wing waits for it
    expect(chooseDragonMove(ctx({ turns: 11, lastSignature: 10, offers: waiting }))).toBe('claw');
    // With no Rift to wait for, the wing is made alone as before
    expect(chooseDragonMove(ctx({ turns: 11, lastSignature: 10, offers: { ...waiting, rift: NONE } }))).toBe('wing');
    // Once it may follow, the wing brings it
    expect(chooseDragonMove(ctx({ turns: 13, lastSignature: 10, offers: waiting }))).toBe('wing');
  });

  it('burns one at a time: a Wing Thrust while one burns, or while a warning of his stands, comes alone', () => {
    lay();
    store().setFacing('boss', at(0, 0));
    wing(at(0, 0));
    expect(prepared()).toHaveLength(0);
    expect(riftsBurning()).toHaveLength(1);
    // With Skyfire open the wing comes alone too
    arena({ heroes: [hero('a', at(-2, 0)), hero('b', at(-2, 1))] });
    castDragonMove(unitOf('boss'), skyfire, fx);
    wing(at(-2, 0));
    expect(prepared().map((p) => p.skill.id)).toEqual(['skyfire']);
  });

  it('survives a Skyfire that is broken', () => {
    lay();
    castDragonMove(unitOf('boss'), skyfire, fx);
    applySkillStatus(
      unitOf('a'), 'boss', { type: AfflictionType.Stun, magnitude: 1, duration: 2, sourceUnitId: 'a' }, { log: () => {}, float: () => {} },
    );
    expect(prepared()).toHaveLength(0);
    expect(riftsBurning()).toHaveLength(1);
  });

  it('is replaced, not stacked, if a second is somehow laid', () => {
    lay();
    const first = riftsBurning()[0].id;
    heroRound();
    castDragonMove(unitOf('boss'), cinderRift, fx);
    heroRound();
    land();
    expect(riftsBurning()).toHaveLength(1);
    expect(riftsBurning()[0].id).not.toBe(first);
  });
});

describe('the thinner side of the Rift', () => {
  /** Two full rows crossing at the middle: r = 0 and q = 0. His own hex is the gap in the first. */
  const burn = () => {
    const gap = hexKey(unitOf('boss').position);
    const hexes = arenaHexes().filter((h) => (h.r === 0 || h.q === 0) && hexKey(h) !== gap);
    store().addHazard({
      id: 'x', hexes: hexes.map((h) => ({ q: h.q, r: h.r })), solid: false, label: 'Cinder Rift',
      lasts: 'replaced', kind: 'cinder_rift', ownerId: 'boss', crossDamage: 10,
    });
  };
  const ids = (units: CombatUnit[]) => units.map((u) => u.id).sort();
  const targets = () => ids(riftTargets(unitOf('boss'), store().units.filter((u) => u.isPlayer), store().hazards));

  it('is everyone while no Rift burns', () => {
    arena({ heroes: [hero('a', at(1, 1)), hero('b', at(-2, -1))] });
    expect(targets()).toEqual(['a', 'b']);
  });

  it('goes to the side with fewer heroes', () => {
    arena({ heroes: [hero('a', at(1, 1)), hero('b', at(2, 1)), hero('c', at(-2, -1))] });
    burn();
    expect(targets()).toEqual(['c']);
  });

  it('keeps a hero standing in the fire within reach of both sides', () => {
    arena({ heroes: [hero('a', at(1, 1)), hero('b', at(2, 1)), hero('c', at(-2, -1)), hero('fire', at(0, 2))] });
    burn();
    expect(targets()).toEqual(['c', 'fire']);
  });

  it('breaks a tie in numbers toward the side holding the weaker hero', () => {
    arena({ heroes: [hero('a', at(1, 1)), hero('b', at(-2, -1), { currentHp: 100 })] });
    burn();
    expect(targets()).toEqual(['b']);
    arena({ heroes: [hero('a', at(1, 1), { currentHp: 100 }), hero('b', at(-2, -1))] });
    burn();
    expect(targets()).toEqual(['a']);
  });

  it('breaks a tie in health toward the side nearer where he faces', () => {
    arena({ heroes: [hero('a', at(2, 2)), hero('b', at(-2, 3))], boss: { position: at(0, 4) } });
    burn();
    store().setFacing('boss', at(-3, 4));
    const facingB = targets();
    store().setFacing('boss', at(2, 2));
    const facingA = targets();
    expect([facingB, facingA]).toEqual([['b'], ['a']]);
  });

  it('is what his Claw is aimed by: the wedge turns toward the thin side', () => {
    arena({ heroes: [hero('a', at(-2, 1)), hero('b', at(-1, 2)), hero('c', at(-2, -2))] });
    burn();
    for (const skill of [wingThrust, furnaceHeart, cinderRift, skyfire]) store().startCooldown('boss', skill);
    store().setFacing('boss', at(-2, 1));
    store().patchBossScript('boss', { phaseTurns: 8 });
    const action = decideEnemyAction(unitOf('boss'), store().units).find((a) => a.skill);
    expect(action?.skill?.id).toBe('dragon_claw');
    const struck = getSkillTargets(dragonClaw, unitOf('boss').position, action!.skillTarget!, store().units).map(hexKey);
    expect(struck).toContain(hexKey(at(-2, -2)));
    expect(struck).not.toContain(hexKey(at(-2, 1)));
  });
});
