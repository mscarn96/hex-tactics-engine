import { spyDice } from '../support/dice';
import { useCombatStore } from '@/stores/combatStore';
import { CombatSink, resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { getSkillRangeHexes } from '@/systems/combat/targeting';
import { requireUnit } from '@/systems/combat/unitLookup';
import { strikeScales, weaponStrikes } from '@/systems/combat/statusEffects';
import { withBloodRush } from '@/systems/combat/passives';
import { bloodRushDash } from '@/systems/combat/passiveFormulas';
import { beginTurn } from '@/systems/combat/turnStart';
import { setTempoRandom } from '@/systems/combat/turnTempo';
import { masteryPassiveRanks } from '@/systems/progression/mastery';
import { bloodthirst, rend } from '@/data/skills/masterySkills';
import { findMasteryNode, findMasteryPath } from '@/data/skills/masteryData';
import { BALANCE } from '@/data/balanceConstants';
import { hexDistance } from '@/utils/hexUtils';
import {
  AfflictionType, AuraType, CombatUnit, HeroStats, HexCoord, PassiveId, PassiveRank,
} from '@/models/types';
import { at, makeEffect, makeFoe, makeHero, makeSkill, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * The Berserker remaster, as rules: Blood Rush at the centre (a 2 / 3 / 4-hex dash
 * once per cast), Carnage as two full hits however many weapons are held, and
 * Undying's floor of 1 HP until two real response turns have been played.
 */

const RANKS: PassiveRank[] = [1, 2, 3].map((level) => ({ level, scale: [0.75, 1, 1.25][level - 1] }));
const state = () => useCombatStore.getState();
const unitNow = (id: string) => requireUnit(state().units, id);
const hp = (id: string) => unitNow(id).currentHp;
const window = (id: string) => unitNow(id).activeEffects.find((e) => e.type === AuraType.UndyingWindow);
const stats = (over: Partial<HeroStats> = {}): HeroStats =>
  makeStats({ maxHp: 100, attack: 20, defense: 0, critChance: 0, dodgeChance: 0, speed: 10, maxMana: 100, ...over });

const berserker = (passives: PassiveId[] = [], level = 2, over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id: 'bers',
    position: at(0, 0),
    stats: stats(),
    passives,
    passiveRanks: Object.fromEntries(passives.map((p) => [p, RANKS[level - 1]])),
    ...over,
  });
const foe = (id: string, q: number, r: number, over: Partial<CombatUnit> = {}) =>
  makeFoe({ id, position: at(q, r), stats: stats({ maxHp: 2000, speed: 5 }), ...over });

const recorder = () => {
  const floats: string[] = [];
  const sink: CombatSink = { ...SILENT_SINK, float: (_at: HexCoord, text: string) => { floats.push(text); } };
  return { sink, floats };
};

beforeEach(() => {
  resetFixtureIds();
  setTempoRandom(() => 1);
  state().reset();
  spyDice().mockReturnValue(0.5);
});

afterEach(() => jest.restoreAllMocks());

// ─── The tree ────────────────────────────────────────────────────────────────

describe('the Berserker tree', () => {
  const nodes = findMasteryPath('berserker')!.nodes;
  const at1 = (column: number) => nodes.find((n) => n.tier === 1 && n.column === column && !n.sideTree);

  it('puts Blood Rush in the centre of the first row and Offhand Fury where Thick Hide was', () => {
    expect(at1(2)?.id).toBe('berserker_blood_rush');
    expect(at1(2)?.grantsPassive).toBe('bloodRush');
    expect(at1(1)?.id).toBe('berserker_offhand_fury');
    expect(at1(1)?.statBonus?.critChance).toBe(10);
    expect(nodes.map((n) => n.id)).not.toContain('berserker_thick_hide');
    expect(nodes.filter((n) => n.tier === 1 && !n.sideTree)).toHaveLength(5);
  });

  it('gives the Undying capstone its own save, leaving Last Breath to the Bog Hulk', () => {
    expect(findMasteryNode('berserker_undying')!.node.grantsPassive).toBe('undyingFury');
  });
});

// ─── Blood Rush ──────────────────────────────────────────────────────────────

describe('Blood Rush', () => {
  it('dashes exactly 1 / 2 / 3 hexes by rank, reaching one hex further', () => {
    expect(RANKS.map(bloodRushDash)).toEqual([1, 2, 3]);
    for (const [i, rank] of RANKS.entries()) {
      const rushed = withBloodRush(bloodthirst, { bloodRush: rank });
      expect(rushed.selfMove).toEqual({ kind: 'dash', range: [1, 2, 3][i] });
      expect(rushed.range).toBe([2, 3, 4][i]);
      // The strike itself is Bloodthirst's own
      expect(rushed.damage).toBe(bloodthirst.damage);
      expect(rushed.lifesteal).toBe(bloodthirst.lifesteal);
    }
  });

  it('touches nothing without the node, and no skill but Bloodthirst', () => {
    expect(withBloodRush(bloodthirst, {})).toBe(bloodthirst);
    expect(withBloodRush(rend, { bloodRush: RANKS[2] })).toBe(rend);
  });

  it('reaches the hero through the tree rank', () => {
    const hero = makeHero({
      masteryPath: 'berserker',
      masteryNodes: { berserker_blood_rush: 3 },
    });
    expect(withBloodRush(bloodthirst, masteryPassiveRanks(hero)).selfMove?.range).toBe(3);
  });

  const rushing = (level: number, foeAt: HexCoord, over: Partial<CombatUnit> = {}) => {
    const skill = withBloodRush(bloodthirst, { bloodRush: RANKS[level - 1] });
    state().initCombat(
      [berserker(['bloodRush'], level, { skills: [skill], currentHp: 50, ...over })],
      [foe('prey', foeAt.q, foeAt.r)],
    );
    return skill;
  };

  it('lands beside a target the dash reaches, then strikes and heals', () => {
    const skill = rushing(1, at(2, 0));
    const result = resolveSkillUse(unitNow('bers'), skill, at(2, 0), SILENT_SINK);
    expect(result.ok).toBe(true);
    expect(hexDistance(unitNow('bers').position, at(2, 0))).toBe(1);
    expect(hexDistance(at(0, 0), unitNow('bers').position)).toBeLessThanOrEqual(1);
    expect(hp('prey')).toBeLessThan(2000);
    expect(hp('bers')).toBeGreaterThan(50);
  });

  it('does not reach a target the dash cannot close on', () => {
    const skill = rushing(1, at(4, 0));
    const reach = getSkillRangeHexes(skill, unitNow('bers'));
    expect(reach.some((h) => h.q === 4 && h.r === 0)).toBe(false);
  });

  it('strikes an adjacent enemy without moving', () => {
    const skill = rushing(2, at(1, 0));
    resolveSkillUse(unitNow('bers'), skill, at(1, 0), SILENT_SINK);
    expect(unitNow('bers').position).toEqual(at(0, 0));
    expect(hp('prey')).toBeLessThan(2000);
  });

  it('dashes once and then strikes twice under Carnage', () => {
    const skill = rushing(3, at(4, 0), {
      activeEffects: [makeEffect(AuraType.Carnage, { duration: 3 })],
    });
    const rec = recorder();
    resolveSkillUse(unitNow('bers'), skill, at(4, 0), rec.sink);
    expect(hexDistance(unitNow('bers').position, at(4, 0))).toBe(1);
    expect(rec.floats.filter((t) => t.startsWith('-'))).toHaveLength(2);
  });
});

// ─── Carnage ─────────────────────────────────────────────────────────────────

describe('Carnage', () => {
  const carnage = () => berserker([], 2, { activeEffects: [makeEffect(AuraType.Carnage, { duration: 3 })] });
  const dualBasic = makeSkill({ id: 'basic_attack', damage: 1, dualWield: true });
  const oneHandBasic = makeSkill({ id: 'basic_attack', damage: 1 });
  const blows = (unit: CombatUnit, skill = dualBasic) =>
    strikeScales(unit, skill).flatMap((pass) => weaponStrikes(skill, unit).map((hand) => pass * hand));

  it('makes a dual-wield Basic Attack two full hits, one per weapon', () => {
    expect(blows(carnage())).toEqual([1, 1]);
    // Without Carnage the pair is still two half hands
    expect(blows(berserker())).toEqual([BALANCE.DUAL_WIELD_STRIKE_SCALE, BALANCE.DUAL_WIELD_STRIKE_SCALE]);
  });

  it('makes a one-weapon Basic Attack two full hits too', () => {
    expect(blows(carnage(), oneHandBasic)).toEqual([1, 1]);
  });

  it('keeps Bloodthirst at two full repetitions and repeats nothing else', () => {
    expect(blows(carnage(), bloodthirst)).toEqual([1, 1]);
    expect(blows(carnage(), rend)).toEqual([1]);
  });
});

// ─── Undying ─────────────────────────────────────────────────────────────────

describe('Undying', () => {
  const fight = (over: Partial<CombatUnit> = {}) => {
    state().initCombat(
      [berserker(['undyingFury'], 2, over)],
      [foe('e1', 3, 0), foe('e2', 3, -1), foe('e3', 2, 1)],
    );
  };
  /** Plays one whole Berserker turn: the start verdict, then the hand-over. */
  const berserkerTurn = () => {
    useCombatStore.setState({ currentUnitId: 'bers', bonusTurn: { pending: null, active: false } });
    const verdict = beginTurn('bers', SILENT_SINK);
    state().nextTurn();
    return verdict.kind;
  };

  it('keeps the Berserker alive through the rest of the enemy sequence (the designer\'s scenario)', () => {
    fight();
    state().damageUnit('bers', 40, 'e1');
    expect(hp('bers')).toBe(60);
    state().damageUnit('bers', 70, 'e2');
    expect(hp('bers')).toBe(1);
    expect(window('bers')?.magnitude).toBe(BALANCE.UNDYING_RESPONSE_TURNS);
    state().damageUnit('bers', 500, 'e3');
    expect(hp('bers')).toBe(1);
  });

  // PT-34: the save fired in silence; it is now floated and heard, from a blow or a tick
  it('floats and sounds UNDYING when the save fires, from a blow or a tick', () => {
    fight();
    const saved = state().damageUnit('bers', 999, 'e1');
    const undying = saved.deathEvents?.find((e) => e.text === 'UNDYING');
    expect(undying?.sound).toEqual(expect.objectContaining({ kind: 'save', save: 'undying', unitId: 'bers' }));
    // The floor holds now, so a second blow does not fire it again
    expect(state().damageUnit('bers', 999, 'e2').deathEvents?.some((e) => e.text === 'UNDYING')).toBeFalsy();

    fight({ currentHp: 3, activeEffects: [makeEffect(AfflictionType.Bleed, { magnitude: 50, duration: 3, sourceUnitId: 'e1' })] });
    const events = state().tickEffectsOnUnit('bers');
    expect(hp('bers')).toBe(1);
    expect(events.filter((e) => e.text === 'UNDYING')).toHaveLength(1);
    expect(events.find((e) => e.text === 'UNDYING')?.sound).toEqual(expect.objectContaining({ kind: 'save', save: 'undying' }));
  });

  it('protects through both response turns and the enemies between them, then lifts', () => {
    fight();
    state().damageUnit('bers', 999, 'e1');
    expect(berserkerTurn()).toBe('act');
    expect(window('bers')?.magnitude).toBe(1);
    // Healing counts, and the floor still holds between the turns
    state().healUnit('bers', 30);
    expect(hp('bers')).toBe(31);
    state().damageUnit('bers', 999, 'e2');
    expect(hp('bers')).toBe(1);
    expect(berserkerTurn()).toBe('act');
    expect(window('bers')).toBeUndefined();
    // The save is spent and the floor is gone
    state().damageUnit('bers', 999, 'e3');
    expect(hp('bers')).toBe(0);
  });

  it('leaves the real HP when the window closes, never forcing it back to 1', () => {
    fight();
    state().damageUnit('bers', 999, 'e1');
    state().healUnit('bers', 50);
    berserkerTurn();
    berserkerTurn();
    expect(window('bers')).toBeUndefined();
    expect(hp('bers')).toBe(51);
  });

  it('does not spend a response turn on a stunned turn', () => {
    fight();
    state().damageUnit('bers', 999, 'e1');
    state().applyEffect('bers', makeEffect(AfflictionType.Stun, { duration: 1, sourceUnitId: 'e1' }));
    expect(berserkerTurn()).toBe('stunned');
    expect(window('bers')?.magnitude).toBe(2);
    expect(berserkerTurn()).toBe('act');
    expect(window('bers')?.magnitude).toBe(1);
  });

  it('counts a regular turn and its bonus turn as one response', () => {
    fight();
    state().damageUnit('bers', 999, 'e1');
    useCombatStore.setState({ currentUnitId: 'bers', bonusTurn: { pending: null, active: false } });
    beginTurn('bers', SILENT_SINK);
    useCombatStore.setState({ bonusTurn: { pending: 'bers', active: false } });
    state().nextTurn();
    // The bonus turn begins: the response is not over yet
    expect(state().bonusTurn.active).toBe(true);
    expect(window('bers')?.magnitude).toBe(2);
    beginTurn('bers', SILENT_SINK);
    state().nextTurn();
    expect(window('bers')?.magnitude).toBe(1);
  });

  it('does not count the turn the save happened on', () => {
    fight();
    useCombatStore.setState({ currentUnitId: 'bers' });
    state().damageUnit('bers', 999, 'e1');
    state().nextTurn();
    expect(window('bers')?.magnitude).toBe(2);
  });

  it('holds the floor against damage over time, and opens from a lethal tick', () => {
    fight({ currentHp: 10 });
    state().applyEffect('bers', makeEffect(AfflictionType.Bleed, { magnitude: 50, duration: 3, sourceUnitId: 'e1' }));
    state().applyEffect('bers', makeEffect(AfflictionType.Burn, { magnitude: 50, duration: 3, sourceUnitId: 'e1' }));
    state().tickEffectsOnUnit('bers');
    expect(hp('bers')).toBe(1);
    expect(window('bers')?.magnitude).toBe(2);
    state().tickEffectsOnUnit('bers');
    expect(hp('bers')).toBe(1);
  });

  it('holds the comeback Attack and lifesteal for exactly the window', () => {
    fight();
    const before = getCombatEffectiveStats(unitNow('bers'));
    state().damageUnit('bers', 999, 'e1');
    const during = getCombatEffectiveStats(unitNow('bers'));
    expect(during.attack).toBeGreaterThan(before.attack);
    expect(during.lifesteal ?? 0).toBeGreaterThan(before.lifesteal ?? 0);
    berserkerTurn();
    expect(getCombatEffectiveStats(unitNow('bers')).attack).toBe(during.attack);
    berserkerTurn();
    expect(getCombatEffectiveStats(unitNow('bers')).attack).toBe(before.attack);
  });

  it('leaves the Bog Hulk\'s Last Breath a plain save with no window', () => {
    state().initCombat([berserker()], [foe('hulk', 1, 0, { passives: ['lastBreath'], currentHp: 5 })]);
    state().damageUnit('hulk', 999, 'bers');
    expect(hp('hulk')).toBe(1);
    expect(window('hulk')).toBeUndefined();
    state().damageUnit('hulk', 999, 'bers');
    expect(hp('hulk')).toBe(0);
  });
});
