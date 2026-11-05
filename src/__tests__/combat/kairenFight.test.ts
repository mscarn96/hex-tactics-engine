import { AfflictionType, AuraType, CombatUnit, HeroSkill, PreparedAttack } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { useCombatStore } from '@/stores/combatStore';
import { arenaHexes, inArena } from '@/systems/combat/arenaGeometry';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { beginTurn } from '@/systems/combat/turnStart';
import { fightOutcome } from '@/systems/combat/waveResolve';
import { CombatSink, resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { resolveDuePrepared } from '@/systems/combat/preparedResolve';
import { previewPrepared, warnedPushes } from '@/systems/combat/preparedAttacks';
import { isHiddenFrom } from '@/systems/combat/statusEffects';
import { encounterPowerScale } from '@/systems/combat/encounterSetup';
import {
  broodAlive, broodCount, canBrood, chooseKairenMove,
  downdraftHexes, initialKairenMemory, kairenMemory, MAJOR_WARNINGS, novaRing, SHARD_KIND, shardsOf, taintOf,
  galeSheltered, verdantMultiplier, windFor, windMoves,
} from '@/systems/combat/kairenRules';
import { castKairenMove, castStorm, landStorm, summonBrood, syncKairenBoard } from '@/systems/combat/kairenActions';
import { cloudDive, coilLash, galeDowndraft, jadeOrbBolt, orbBolt, orbNova, thunderhead, verdantJudgement } from '@/data/templates/kairen';
import { answersOf } from '@/systems/combat/warnedAnswers';
import { warningLines } from '@/data/display/preparedDisplay';
import { shelterGroupHexes } from '@/data/display/boardOverlays';
import { summitEncounterId, summitTierScale } from '@/systems/world/summit';
import { neutralDepth } from '@/systems/world/threat';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { at, makeSkill, makeStats, makeUnit } from '../support/fixtures';
import { spyDice } from '../support/dice';

/**
 * Jadeveil: Kairen's fight held at the rules the plan agreed (the private project notes):
 * every warning's footprint is what lands, every lethal pattern has an answer, Jade Taint
 * caps at three and is cured only by the phase's answer, the brood waits for the last
 * wyrmling, the wind stops at the edge and at a body, and wrath's power never reaches him.
 */

const K = BALANCE.KAIREN;
const units = () => useCombatStore.getState().units;
const kairen = (): CombatUnit => units().find((u) => u.templateId === 'kairen')!;
const prepared = () => useCombatStore.getState().preparedAttacks;
const live = (id: string) => units().find((u) => u.id === id)!;
const sink: CombatSink = { ...SILENT_SINK };

const hero = (id: string, q: number, r: number, over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id, heroId: id, name: id, position: at(q, r),
    stats: makeStats({ maxHp: 9000, attack: 60, magic: 40, defense: 5, speed: 5, critChance: 0, dodgeChance: 0, moveRange: 3 }),
    skills: [makeSkill({ id: 'swing' as HeroSkill['id'], damage: 1, range: 6 })],
    ...over,
  });

function start(heroes: CombatUnit[], tier = 1, phase = 0) {
  const store = useCombatStore.getState();
  store.reset();
  const [boss] = createEnemyUnits(['kairen'], [at(0, -4)], 25, summitTierScale(tier)).map((u) => ({ ...u, challengeTier: tier }));
  store.initCombat(heroes, [boss]);
  store.patchBossScript(kairen().id, { phaseTurns: 1 });
  if (phase > 0) {
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === kairen().id ? { ...u, bossPhase: phase } : u)) }));
    syncKairenBoard(sink);
  }
}

/** Every responder has had its turn: what is open is due. */
function allRespond() {
  const store = useCombatStore.getState();
  for (const p of prepared()) store.updatePreparedAttack(p.id, { responded: [...p.responders, ...p.responders] });
}

const setTaint = (id: string, stacks: number) => {
  useCombatStore.getState().removeEffect(id, AfflictionType.JadeTaint);
  if (stacks > 0) useCombatStore.getState().applyEffect(id, { type: AfflictionType.JadeTaint, magnitude: stacks, duration: -1 });
};

describe('the summit', () => {
  it('opens with Kairen near the top and nothing solid on the board', () => {
    start([hero('h1', 0, 3), hero('h2', 1, 3)]);
    expect(kairen().position).toEqual(at(K.START_Q, K.START_R));
    expect(useCombatStore.getState().hazards.filter((h) => h.solid)).toEqual([]);
  });

  it('turns the weather on a phase change and moves nobody', () => {
    start([hero('h1', 1, -1), hero('h2', 0, 4)]);
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === kairen().id ? { ...u, bossPhase: 1 } : u)) }));
    syncKairenBoard(sink);
    expect(kairenMemory(kairen()).boardPhase).toBe(1);
    expect(live('h1').position).toEqual(at(1, -1));
    expect(live('h2').position).toEqual(at(0, 4));
    expect(useCombatStore.getState().hazards.filter((h) => h.solid)).toEqual([]);
  });
});

describe('the answers his warnings name', () => {
  it('is stepped out of, but for the Verdant Judgement, which is met by shedding Taint first', () => {
    const kinds = (skill: HeroSkill) => answersOf(skill.prepares!).map((a) => a.kind);
    for (const skill of [cloudDive, galeDowndraft, thunderhead, orbNova]) expect(kinds(skill)).toEqual(['step']);
    expect(kinds(verdantJudgement)).toEqual(['cleanse']);
  });
});

describe('Jade Taint', () => {
  it('stacks to three and no further, from any source', () => {
    start([hero('h1', 0, 3)]);
    for (let i = 0; i < 5; i++) useCombatStore.getState().applyEffect('h1', { type: AfflictionType.JadeTaint, magnitude: 1, duration: -1 });
    expect(taintOf(live('h1'))).toBe(3);
    setTaint('h1', 2);
    useCombatStore.getState().applyEffect('h1', { type: AfflictionType.JadeTaint, magnitude: 3, duration: -1 });
    expect(taintOf(live('h1'))).toBe(K.TAINT_CAP);
  });

  it('is laid by the Orb Bolt and never decays on its own', () => {
    start([hero('h1', 0, 1)]);
    resolveSkillUse(kairen(), orbBolt, live('h1').position, sink);
    expect(taintOf(live('h1'))).toBe(1);
    for (let i = 0; i < 4; i++) useCombatStore.getState().tickEffectsOnUnit('h1');
    expect(taintOf(live('h1'))).toBe(1);
  });

  it('is not stripped by a cleanse', () => {
    start([hero('h1', 0, 3)]);
    setTaint('h1', 2);
    useCombatStore.getState().applyEffect('h1', { type: AfflictionType.Poison, magnitude: 5, duration: 3 });
    useCombatStore.getState().removeAllAfflictions('h1');
    expect(taintOf(live('h1'))).toBe(2);
    expect(live('h1').activeEffects.some((e) => e.type === AfflictionType.Poison)).toBe(false);
  });

  it('multiplies Verdant Judgement: a light blow at none, near lethal at three', () => {
    expect(verdantMultiplier(0)).toBeCloseTo(K.VERDANT_BASE);
    expect(verdantMultiplier(3)).toBeGreaterThan(verdantMultiplier(0) * 5);
    // No crit and no dodge, so the two blows differ by their Taint alone
    spyDice().mockReturnValue(0.99);
    start([hero('clean', -1, 3), hero('dirty', 1, 3)]);
    setTaint('dirty', 3);
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === kairen().id ? { ...u, bossPhase: 1 } : u)) }));
    expect(castKairenMove(kairen(), 'verdant', sink)).toBe(true);
    const open = prepared().find((p) => p.scripted === 'kairen_verdant')!;
    expect(open.hexes).toEqual([]);
    expect(open.responders.sort()).toEqual(['clean', 'dirty']);
    allRespond();
    resolveDuePrepared(kairen().id, sink);
    const lostClean = 9000 - live('clean').currentHp;
    const lostDirty = 9000 - live('dirty').currentHp;
    expect(lostClean).toBeGreaterThan(0);
    expect(lostDirty).toBeGreaterThan(lostClean * 5);
  });
});

describe('Gale and Downdraft', () => {
  it('pushes every body exactly where the arrows say, and the Downdraft strikes exactly who the wind left on its rows', () => {
    start([hero('h1', -2, 3), hero('h2', 1, 2), hero('h3', 2, 1)]);
    expect(castKairenMove(kairen(), 'gale', sink)).toBe(true);
    const gale = prepared().find((p) => p.scripted === 'kairen_gale')!;
    expect(gale.wind).toEqual(windFor(0));
    expect(gale.landing).toEqual(downdraftHexes(windFor(0), useCombatStore.getState().hazards));
    expect(gale.responders.sort()).toEqual(['h1', 'h2', 'h3']);
    const arrows = warnedPushes(gale, units(), useCombatStore.getState().hazards);
    const before = new Map(units().map((u) => [u.id, u.position]));
    const rows = new Set(gale.landing!.map(hexKey));
    const predicted = previewPrepared(gale, units(), useCombatStore.getState().hazards).landings;
    const willBeStruck = predicted.filter((m) => m.unitId.startsWith('h') && rows.has(hexKey(m.to))).map((m) => m.unitId).sort();
    allRespond();
    resolveDuePrepared(kairen().id, sink);
    for (const arrow of arrows) expect(live(arrow.unitId).position).toEqual(arrow.to);
    for (const [id, from] of before) {
      if (!arrows.some((a) => a.unitId === id)) expect(live(id).position).toEqual(from);
    }
    const struck = ['h1', 'h2', 'h3'].filter((id) => live(id).currentHp < 9000).sort();
    expect(struck).toEqual(willBeStruck);
    expect(struck.length).toBeGreaterThan(0);
  });

  it('is stopped by the cliff edge and by a body, and pushes two hexes from tier 3', () => {
    // On the east edge nothing moves, and the hero upwind of it is blocked by its body
    start([hero('blocked', 2, 0), hero('edge', 3, 0), hero('open', -3, 4)]);
    const hazards = useCombatStore.getState().hazards;
    const moves = windMoves({ q: 1, r: 0 }, 1, kairen().id, units(), hazards);
    expect(moves.find((m) => m.unitId === 'blocked')?.moved).toBe(false);
    expect(moves.find((m) => m.unitId === 'edge')?.moved).toBe(false);
    expect(moves.find((m) => m.unitId === 'open')?.to).toEqual(at(-2, 4));
    expect(moves.every((m) => inArena(m.to))).toBe(true);
    expect(windMoves({ q: 1, r: 0 }, 2, kairen().id, units(), hazards).find((m) => m.unitId === 'open')?.to).toEqual(at(-1, 4));
    start([hero('open', -3, 4)], 3);
    castKairenMove(kairen(), 'gale', sink);
    expect(prepared().find((p) => p.scripted === 'kairen_gale')?.windDistance).toBe(K.GALE_PUSH_TIER3);
  });

  it('names as sheltered exactly the heroes a body keeps off the Downdraft, and the landing spares exactly them', () => {
    // A line packed against the east edge: the edge holds the first, each holds the next. 'packed' stands
    // off the rows and alone would be blown onto them; 'open' is blown nowhere near them; 'onRows' is struck anyway
    start([hero('edge', 3, 0), hero('onRows', 2, 0), hero('packed', 1, 0), hero('open', -3, 4)]);
    castKairenMove(kairen(), 'gale', sink);
    const gale = prepared().find((p) => p.scripted === 'kairen_gale')!;
    const hazards = useCombatStore.getState().hazards;
    const rows = new Set(gale.landing!.map(hexKey));
    const preview = previewPrepared(gale, units(), hazards);
    expect(preview.windSheltered).toEqual(['packed']);
    expect(galeSheltered(gale, units(), hazards)).toEqual(['packed']);
    expect(rows.has(hexKey(at(1, 0)))).toBe(false);
    // Alone on the board, the wind would have put them on the rows
    const alone = windMoves(gale.wind!, gale.windDistance!, kairen().id, [live('packed')], hazards)[0];
    expect(rows.has(hexKey(alone.to))).toBe(true);
    // Drawn in the shelter colour where they will stand, and named on the banner
    expect(shelterGroupHexes([gale], units(), hazards).map(hexKey)).toEqual([hexKey(at(1, 0))]);
    const [line] = warningLines([gale], [preview], units(), hazards);
    expect(line.detail).toContain('packed');
    expect(line.detail.lastIndexOf('packed')).toBeGreaterThan(line.detail.lastIndexOf('onRows'));

    // The landing: off the rows and unharmed are exactly the sheltered and those the wind never brought near
    allRespond();
    resolveDuePrepared(kairen().id, sink);
    const spared = ['edge', 'onRows', 'packed', 'open'].filter((id) => live(id).currentHp === 9000);
    expect(spared.sort()).toEqual(['open', 'packed']);
    const offRowsWhoWouldNot = spared.filter((id) => id !== 'open');
    expect(offRowsWhoWouldNot).toEqual(preview.windSheltered);
  });

  it('counts Kairen himself as a body that holds: the hero just upwind of him off the rows is sheltered', () => {
    start([hero('h1', -3, 4), hero('h2', 0, 3)]);
    // He stands on the Downdraft's inner row (east edge of row 0 is (3, 0)); the hero just west of him
    useCombatStore.getState().moveUnit(kairen().id, at(2, 0), 'walk', false);
    useCombatStore.getState().moveUnit('h2', at(1, 0), 'walk', false);
    castKairenMove(kairen(), 'gale', sink);
    const gale = prepared().find((p) => p.scripted === 'kairen_gale')!;
    const hazards = useCombatStore.getState().hazards;
    const rows = new Set(gale.landing!.map(hexKey));
    expect(rows.has(hexKey(at(2, 0)))).toBe(true);
    expect(rows.has(hexKey(at(1, 0)))).toBe(false);
    expect(previewPrepared(gale, units(), hazards).windSheltered).toEqual(['h2']);
    allRespond();
    resolveDuePrepared(kairen().id, sink);
    expect(live('h2').position).toEqual(at(1, 0));
    expect(live('h2').currentHp).toBe(9000);
  });

  it('always leaves a hero somewhere to stand that the wind does not throw into the Downdraft', () => {
    start([hero('h1', 0, 3)]);
    const hazards = useCombatStore.getState().hazards;
    for (const wind of [windFor(0), windFor(1)]) {
      const rows = new Set(downdraftHexes(wind, hazards).map(hexKey));
      const safe = arenaHexes().filter((h) => {
        const moved = windMoves(wind, K.GALE_PUSH_TIER3, kairen().id, [{ ...live('h1'), position: h }, kairen()], hazards)[0];
        return !hazards.some((z) => z.hexes.some((x) => hexKey(x) === hexKey(h))) && moved && !rows.has(hexKey(moved.to));
      });
      expect(safe.length).toBeGreaterThan(10);
    }
  });
});

describe('Cloud Dive', () => {
  it('lifts him out of reach, strikes exactly the line and lands him Exposed at its far end', () => {
    start([hero('on', 0, 2), hero('off', 2, 3)]);
    expect(castKairenMove(kairen(), 'dive', sink)).toBe(true);
    const dive = prepared().find((p) => p.scripted === 'kairen_dive')!;
    expect(dive.hexes.map(hexKey)).toContain(hexKey(at(0, 2)));
    expect(dive.hexes.map(hexKey)).not.toContain(hexKey(at(2, 3)));
    expect(kairen().activeEffects.some((e) => e.type === AuraType.Aloft)).toBe(true);
    expect(isHiddenFrom(kairen(), makeSkill({ range: 9 }))).toBe(true);
    const end = dive.hexes[dive.hexes.length - 1];
    allRespond();
    resolveDuePrepared(kairen().id, sink);
    expect(live('on').currentHp).toBeLessThan(9000);
    expect(live('off').currentHp).toBe(9000);
    expect(kairen().position).toEqual(end);
    expect(kairen().activeEffects.some((e) => e.type === AuraType.Aloft)).toBe(false);
    expect(kairen().activeEffects.some((e) => e.type === AuraType.Exposed)).toBe(true);
  });
});

describe('Thunderhead', () => {
  it('marks a round ahead, never on his hex, and a struck hero is hurt and cleansed of all Taint', () => {
    start([hero('h1', 0, 3), hero('h2', 2, 2)], 1, 1);
    setTaint('h1', 3);
    castStorm(kairen(), sink);
    const storm = prepared().find((p) => p.scripted === 'kairen_storm')!;
    expect(storm.hexes.length).toBe(K.THUNDER_MARKS);
    expect(storm.hexes.some((h) => hexKey(h) === hexKey(kairen().position))).toBe(false);
    // h1 steps onto a mark
    const mark = storm.hexes.find((h) => !units().some((u) => u.currentHp > 0 && hexKey(u.position) === hexKey(h)))!;
    useCombatStore.getState().moveUnit('h1', mark, 'walk', false);
    allRespond();
    landStorm(prepared().find((p) => p.scripted === 'kairen_storm')!, kairen(), sink);
    expect(live('h1').currentHp).toBeLessThan(9000);
    expect(taintOf(live('h1'))).toBe(0);
  });

  it('leaves him Exposed when a hero draws a bolt beside him', () => {
    start([hero('rod', 0, 3)], 1, 1);
    castStorm(kairen(), sink);
    const storm = prepared().find((p) => p.scripted === 'kairen_storm')!;
    const beside = storm.hexes.find((h) => hexDistance(h, kairen().position) === 1)!;
    expect(beside).toBeDefined();
    useCombatStore.getState().moveUnit('rod', beside, 'walk', false);
    allRespond();
    landStorm(storm, kairen(), sink);
    expect(kairen().activeEffects.some((e) => e.type === AuraType.Exposed)).toBe(true);
  });

  it('strikes twice a round from tier 4', () => {
    start([hero('h1', 0, 3), hero('h2', 2, 2)], 4, 1);
    castStorm(kairen(), sink);
    const storms = prepared().filter((p) => p.scripted === 'kairen_storm');
    expect(storms).toHaveLength(2);
    expect(new Set(storms.flatMap((p) => p.hexes).map(hexKey)).size).toBe(storms.flatMap((p) => p.hexes).length);
  });
});

describe('Orb Nova and the Jade Shards', () => {
  it('rings him two to three out, leaves two shards and calls Verdant Judgement a window later', () => {
    start([hero('h1', 0, 1), hero('h2', -2, 3)], 1, 2);
    expect(novaRing(kairen(), useCombatStore.getState().hazards).every((h) => {
      const d = hexDistance(h, kairen().position);
      return d >= K.NOVA_INNER && d <= K.NOVA_OUTER;
    })).toBe(true);
    castKairenMove(kairen(), 'nova', sink);
    const nova = prepared().find((p) => p.scripted === 'kairen_nova')!;
    const inRing = ['h1', 'h2'].filter((id) => nova.hexes.some((h) => hexKey(h) === hexKey(live(id).position)));
    allRespond();
    resolveDuePrepared(kairen().id, sink);
    for (const id of inRing) expect(taintOf(live(id))).toBe(3);
    expect(shardsOf(kairen(), units())).toHaveLength(K.SHARDS);
    expect(prepared().some((p) => p.scripted === 'kairen_verdant')).toBe(true);
    expect(prepared().find((p) => p.scripted === 'kairen_verdant')!.responders.length).toBe(2);
  });

  it('a broken shard cleanses every hero beside it, and only its breaker takes the burst', () => {
    start([hero('tank', 0, 0), hero('beside', 1, 0), hero('far', -2, 4), hero('archer', 2, 3)], 1, 2);
    for (const id of ['tank', 'beside', 'far', 'archer']) setTaint(id, 3);
    const shard = { ...units().find((u) => u.id === 'tank')!, id: 'shard', name: 'Jade Shard', heroId: undefined, isPlayer: false,
      position: at(1, -1), currentHp: 1, stats: makeStats({ maxHp: 1, defense: 0 }),
      objective: { kind: SHARD_KIND, ownerId: kairen().id } };
    useCombatStore.getState().addUnits([shard as CombatUnit]);
    // The archer breaks it from afar: it takes the burst and no cleanse; the two beside it are cleansed
    useCombatStore.getState().damageUnit('shard', 5, 'archer');
    expect(live('shard').currentHp).toBe(0);
    expect(taintOf(live('tank'))).toBe(0);
    expect(taintOf(live('beside'))).toBe(0);
    expect(taintOf(live('far'))).toBe(3);
    expect(taintOf(live('archer'))).toBe(3);
    expect(live('archer').currentHp).toBeLessThan(9000);
    expect(live('tank').currentHp).toBe(9000);
    expect(live('beside').currentHp).toBe(9000);
  });
});

describe('Brood of the Orb', () => {
  it('comes on entering the Thunderhead, six and one more a tier, and cannot come again while one lives', () => {
    start([hero('h1', 0, 3), hero('h2', 1, 3)], 2);
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === kairen().id ? { ...u, bossPhase: 1 } : u)) }));
    syncKairenBoard(sink);
    const memory = kairenMemory(kairen());
    expect(broodCount(2)).toBe(K.BROOD_COUNT + 1);
    expect(broodAlive(memory, units())).toHaveLength(broodCount(2));
    // Long after its gap, a single wyrmling alive still bars the next
    useCombatStore.getState().patchBossScript(kairen().id, { kairen: { ...memory, turns: memory.turns + 10 } });
    const [last, ...rest] = broodAlive(kairenMemory(kairen()), units());
    for (const w of rest) useCombatStore.getState().damageUnit(w.id, 9999);
    expect(canBrood(kairenMemory(kairen()), units())).toBe(false);
    useCombatStore.getState().damageUnit(last.id, 9999);
    expect(canBrood(kairenMemory(kairen()), units())).toBe(true);
    expect(summonBrood(kairen(), sink)).toBe(broodCount(2));
  });

  it('waits its gap after a brood even once every wyrmling is dead', () => {
    const memory = { ...initialKairenMemory(), turns: 5, broodTurn: 4, brood: [] };
    expect(canBrood(memory, [])).toBe(false);
    expect(canBrood({ ...memory, turns: 4 + K.BROOD_GAP }, [])).toBe(true);
  });

  it('bites for a stack of Taint', () => {
    start([hero('h1', 0, 3)], 1, 1);
    const wyrm = broodAlive(kairenMemory(kairen()), units())[0];
    useCombatStore.getState().moveUnit(wyrm.id, at(0, 2), 'walk', false);
    resolveSkillUse(live(wyrm.id), live(wyrm.id).skills[0], at(0, 3), sink);
    expect(taintOf(live('h1'))).toBe(1);
  });
});

describe('his choices', () => {
  it('never raises a warned move while another of his is open', () => {
    for (let phase = 0; phase < 3; phase++) {
      for (let n = 0; n < 12; n++) {
        const move = chooseKairenMove({ phase, tier: 5, phaseTurns: n, memory: initialKairenMemory(), majorOpen: true, broodReady: false });
        expect(move).toBe('attack');
      }
    }
  });

  it('opens each phase on its own warned move', () => {
    const memory = initialKairenMemory();
    expect(chooseKairenMove({ phase: 0, tier: 1, phaseTurns: K.GALE_FIRST, memory, majorOpen: false, broodReady: false })).toBe('gale');
    expect(chooseKairenMove({ phase: 1, tier: 1, phaseTurns: K.VERDANT_FIRST, memory, majorOpen: false, broodReady: false })).toBe('verdant');
    expect(chooseKairenMove({ phase: 2, tier: 1, phaseTurns: K.NOVA_FIRST, memory, majorOpen: false, broodReady: false })).toBe('nova');
    expect(chooseKairenMove({ phase: 2, tier: 5, phaseTurns: 9, memory: { ...memory, turns: 9, lastUsed: { nova: 9, dive: 9 } }, majorOpen: false, broodReady: false })).toBe('gale');
  });

  /**
   * Tier 2's twist: the bolt strikes the two heroes carrying the least Taint, each +1
   * (+3 in the Jade Tempest); the story fight's strikes one.
   */
  it.each([
    [1, 0, [1, 1, 2]],
    [2, 0, [1, 2, 2]],
    [2, 2, [3, 3, 2]],
  ])('at tier %d in phase %d bolts the least tainted, leaving Taint %j', (tier, phase, after) => {
    start([hero('h0', -1, 3), hero('h1', 0, 3), hero('h2', 1, 3)], tier, phase);
    setTaint('h0', 0);
    setTaint('h1', 1);
    setTaint('h2', 2);
    // No brood due: the turn is his ordinary attack
    useCombatStore.getState().patchBossScript(kairen().id, { kairen: { ...kairenMemory(kairen()), turns: 0, broodTurn: 0 } });
    const actions = decideEnemyAction(kairen(), units());
    expect(actions[0]?.skill?.id).toBe((phase >= 2 ? jadeOrbBolt : orbBolt).id);
    executeAIActions(kairen(), actions, sink);
    expect(['h0', 'h1', 'h2'].map((id) => taintOf(live(id)))).toEqual(after);
  });

  it('lashes a hero beside his head', () => {
    start([hero('near', 0, -1), hero('far', 0, 4)]);
    const actions = decideEnemyAction(kairen(), units());
    expect(actions[0]?.skill?.id).toBe(coilLash.id);
  });
});

describe('his power', () => {
  it('is his tier’s, never wrath’s', () => {
    const terms = { threatBand: 4 as const, groundDepth: neutralDepth(4), haunted: false, guardsChest: false };
    const base = { encounterId: summitEncounterId(1), terms, castleRun: null, sim: { active: false, powerScale: 1 } };
    expect(encounterPowerScale({ ...base, wrathPower: 1.25 })).toBe(1);
    expect(encounterPowerScale({ ...base, encounterId: summitEncounterId(3), wrathPower: 1.25 })).toBeCloseTo(1.4);
  });

  it('carries his orb’s footprint as a ring skill that taints in full', () => {
    expect(orbNova.appliesEffect).toEqual({ type: AfflictionType.JadeTaint, magnitude: K.TAINT_CAP, duration: -1 });
  });
});

describe('a whole fight, headless', () => {
  it('runs every phase without throwing, with one warned move open at a time', () => {
    start([hero('h1', -1, 3), hero('h2', 0, 3), hero('h3', 1, 3), hero('h4', 2, 3)], 5);
    let peak = 0;
    const phases = new Set<number>();
    for (let turn = 0; turn < 600; turn++) {
      if (fightOutcome() !== 'ongoing') break;
      const current = useCombatStore.getState().getCurrentUnit();
      if (!current) break;
      // The party hits him hard enough to see every phase
      const started = beginTurn(current.id, sink);
      if (started.kind === 'act') {
        const fresh = live(current.id);
        executeAIActions(fresh, decideEnemyAction(fresh, units()), sink);
        if (fresh.isPlayer && kairen() && !kairen().activeEffects.some((e) => e.type === AuraType.Aloft)) {
          useCombatStore.getState().damageUnit(kairen().id, Math.round(kairen().stats.maxHp * 0.02), fresh.id);
        }
      }
      const boss = units().find((u) => u.templateId === 'kairen');
      if (boss) phases.add(boss.bossPhase ?? 0);
      const majors = prepared().filter((p: PreparedAttack) => p.scripted && MAJOR_WARNINGS.has(p.scripted));
      peak = Math.max(peak, majors.length);
      useCombatStore.getState().nextTurn();
    }
    expect(peak).toBeLessThanOrEqual(1);
    expect([...phases].sort()).toEqual([0, 1, 2]);
  });
});
